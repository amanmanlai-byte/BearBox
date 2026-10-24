'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { AppService } = require('../src/backend/service');
const { buildConfig, describeRule } = require('../src/backend/config');
const { mapConnection } = require('../src/backend/core');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jj-svc-'));
const fakeSys = { supported: false, async enable() { return { ok: true, backup: null }; }, async disable() { return { ok: true }; } };
const mkSvc = (opts = {}) => new AppService({ userData: tmp(), appRoot: path.join(__dirname, '..'), sysproxy: fakeSys, binary: 'x.exe', ...opts });

test('mapConnection prefers sniffed host and extracts the process basename', () => {
  const c = mapConnection({
    id: 'a', upload: 1, download: 2, start: '2026-01-01T00:00:00Z', chains: ['proxy', 'n1'], rule: 'domain', rulePayload: 'x.com',
    metadata: { host: 'x.com', sniffHost: 'real.x.com', destinationIP: '1.2.3.4', destinationPort: '443', network: 'tcp', type: 'Http', sourceIP: '127.0.0.1', processPath: 'C:\\Program Files\\App\\app.exe' },
  });
  assert.equal(c.host, 'real.x.com');
  assert.equal(c.process, 'app.exe');
  assert.equal(c.network, 'tcp');
});

test('mapConnection falls back to host then destination IP, handles missing process', () => {
  const c = mapConnection({ id: 'b', metadata: { host: '', destinationIP: '9.9.9.9', destinationPort: '80' } });
  assert.equal(c.host, '9.9.9.9');
  assert.equal(c.process, '');
});

test('buildConfig returns a readable routePreview of the real rule chain', () => {
  const { routePreview } = buildConfig({
    nodes: [{ type: 'socks', tag: 'n', server: '1.2.3.4', server_port: 1080 }],
    selectedTag: 'n',
    settings: { mode: 'rule', bypassLan: true, trafficSniffing: true },
    userRules: [{ name: 'ads', enabled: true, domain: 'keyword:ads', outbound: 'block' }],
  });
  const matches = routePreview.map((r) => r.match);
  assert.ok(matches.includes('全部入站流量'));
  assert.ok(matches.includes('DNS 请求'));
  assert.ok(matches.includes('私有/局域网地址'));
  assert.ok(matches.some((m) => m.startsWith('关键字')));
  const block = routePreview.find((r) => /^拦截/.test(r.outbound));
  assert.ok(block, 'user block rule present');
  assert.match(block.match, /关键字 ads/);
  const cn = routePreview.find((r) => /geosite-cn/.test(r.match));
  assert.ok(cn, 'CN ruleset rule present');
  assert.equal(cn.outbound, '直连');
  const last = routePreview[routePreview.length - 1];
  assert.equal(last.match, '其余全部流量');
  assert.match(last.outbound, /代理/);
});

test('describeRule keeps descriptions short for long lists', () => {
  const d = describeRule({ domain_suffix: ['a.com', 'b.com', 'c.com', 'd.com'], outbound: 'direct' }, 0);
  assert.match(d.match, /等/);
  assert.equal(d.outbound, '直连');
});

test('subscription auto-update timer follows settings and can be disabled', async () => {
  const fired = [];
  const handles = [];
  const timer = { set: (fn, ms) => { handles.push({ fn, ms }); return handles.length; }, clear: (h) => { handles.splice(h - 1, 1); } };
  const sub = 'ss://' + Buffer.from('aes-128-gcm:pw').toString('base64') + '@127.0.0.1:1#n';
  const svc = mkSvc({ autoUpdateTimer: timer, fetchSub: async () => ({ body: sub, info: null }) });
  svc.importLinks({ text: sub });
  await svc.setSettings({ autoUpdateSubsMin: 10 });
  assert.equal(handles.length, 1);
  assert.equal(handles[0].ms, 10 * 60 * 1000);
  // fire it: updateAllSubscriptions runs against the fetchSub stub (no real network)
  await handles[0].fn();
  assert.equal(svc.d.subscriptions[0].count, 1);
  await svc.setSettings({ autoUpdateSubsMin: 0 });
  assert.equal(handles.length, 0);
});

test('UI-only settings never restart a running core', async () => {
  const svc = mkSvc();
  svc.core.state = 'running';
  let restarted = false;
  svc.restart = async () => { restarted = true; };
  await svc.setSettings({ theme: 'dark', closeToTray: false, autoUpdateSubsMin: 30 });
  assert.equal(restarted, false);
  assert.equal(svc.d.settings.theme, 'dark');
  await svc.setSettings({ mixedPort: 2081 });
  assert.equal(restarted, true);
});

test('state() exposes the route preview after build()', () => {
  const svc = mkSvc();
  svc.importLinks({ text: 'ss://' + Buffer.from('aes-128-gcm:pw').toString('base64') + '@127.0.0.1:1#n' });
  svc.build();
  assert.ok(svc.state().routePreview.length >= 3);
});
