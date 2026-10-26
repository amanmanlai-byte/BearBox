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

/** Minimal Core stand-in so testNodes' temp-start path is unit testable. */
function fakeCore({ startOk = true } = {}) {
  const { EventEmitter } = require('events');
  const c = new EventEmitter();
  c.state = 'stopped'; c.binary = 'x.exe'; c.startCalls = []; c.stopCalls = 0; c.delayCalls = [];
  c.selectCalls = []; c.closeAllCalls = 0; c._now = null; // _now: what currentNode() reports
  c.version = async () => 'fake-1.0';
  c.start = async () => { if (!startOk) throw new Error('no kernel'); c.state = 'running'; c.startCalls.push(Date.now()); };
  c.stop = async () => { c.stopCalls++; c.state = 'stopped'; };
  c.delay = async (tag, url) => { c.delayCalls.push([tag, url]); return 42; };
  c.selectNode = async (tag) => { c.selectCalls.push(tag); if (c.followPicks !== false) c._now = tag; };
  c.currentNode = async () => c._now;
  c.closeAll = async () => { c.closeAllCalls++; };
  c.pushLog = () => {};
  c.status = () => ({ state: c.state, apiOk: false });
  c.samples = []; c.logs = []; c.connections = []; c.upTotal = 0; c.downTotal = 0; c.memory = 0;
  return c;
}
const LINK = 'ss://' + Buffer.from('aes-128-gcm:pw').toString('base64') + '@127.0.0.1:1#n';

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
  await svc.setSettings({ theme: 'dark', closeToTray: false, autoUpdateSubsMin: 30, testConcurrency: 3 });
  assert.equal(restarted, false);
  assert.equal(svc.d.settings.theme, 'dark');
  assert.equal(svc.d.settings.testConcurrency, 3);
  await svc.setSettings({ mixedPort: 2081 });
  assert.equal(restarted, true);
});

test('invalid test concurrency falls back to 3', async () => {
  const svc = mkSvc();
  await svc.setSettings({ testConcurrency: NaN });
  assert.equal(svc.d.settings.testConcurrency, 3);
  await svc.setSettings({ testConcurrency: 99 });
  assert.equal(svc.d.settings.testConcurrency, 32);
});

test('testNodes URL-tests by temp-starting the core, then stops it', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  const r = await svc.testNodes();
  assert.equal(r.mode, 'url');
  assert.equal(r.error, null);
  assert.equal(core.startCalls.length, 1);
  assert.equal(core.stopCalls, 1, 'temp start stopped again');
  assert.equal(core.delayCalls.length, 2, 'warm-up + test'); // warm-up through the selected node, then the actual test
  assert.equal(core.delayCalls[1][1], svc.d.settings.connectionTestURL);
  const n = svc.d.nodes[0];
  assert.equal(n.latency, 42); assert.equal(n.latencyKind, 'url');
});

test('selectNode while running verifies the pick and drops old connections', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  const n = svc.d.nodes[0];
  core.state = 'running';
  await svc.selectNode(n.id);
  assert.deepEqual(core.selectCalls, [n.outbound.tag]);
  assert.equal(core.closeAllCalls, 1, 'old keep-alive connections are dropped');
  assert.equal(svc.d.selectedId, n.id);
});

test('selectNode retries once when the runtime pick does not match', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  const n = svc.d.nodes[0];
  core.state = 'running';
  core.followPicks = false; // the kernel does not follow our PUT
  core._now = 'stale-pick'; // currentNode() disagrees -> selectNode must retry
  await svc.selectNode(n.id);
  assert.equal(core.selectCalls.length, 2);
});

test('start() re-applies the UI selection so the kernel cache cannot override it', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  const other = 'ss://' + Buffer.from('aes-128-gcm:pw2').toString('base64') + '@127.0.0.1:2#n2';
  svc.importLinks({ text: other });
  await svc.selectNode(svc.d.nodes[1].id); // select the second node while stopped
  await svc.start();
  assert.ok(core.startCalls.length === 1);
  assert.deepEqual(core.selectCalls, [svc.d.nodes[1].outbound.tag], 'selection applied after boot');
  await svc.stop();
});

test('testNodes falls back to TCP when the kernel cannot start, and says so', async () => {
  const core = fakeCore({ startOk: false });
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  const r = await svc.testNodes();
  assert.equal(r.mode, 'tcp');
  assert.match(r.error, /no kernel/);
  const n = svc.d.nodes[0];
  assert.equal(n.latency, null, 'port 1 refuses instantly');
  assert.equal(n.latencyKind, 'tcp');
});

test('legacy default test URL is migrated to google generate_204 on init', async () => {
  const dir = tmp();
  const data = { version: 1, settings: { connectionTestURL: 'https://cp.cloudflare.com/generate_204' }, subscriptions: [], nodes: [], rules: [], daily: {} };
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data));
  const svc = mkSvc({ userData: dir, core: fakeCore() });
  await svc.init();
  assert.equal(svc.d.settings.connectionTestURL, 'https://www.google.com/generate_204');
  // a custom URL is left alone
  const dir2 = tmp();
  fs.writeFileSync(path.join(dir2, 'data.json'), JSON.stringify({ ...data, settings: { connectionTestURL: 'https://my.example/204' } }));
  const svc2 = mkSvc({ userData: dir2, core: fakeCore() });
  await svc2.init();
  assert.equal(svc2.d.settings.connectionTestURL, 'https://my.example/204');
});

test('state() exposes the route preview after build()', () => {
  const svc = mkSvc();
  svc.importLinks({ text: 'ss://' + Buffer.from('aes-128-gcm:pw').toString('base64') + '@127.0.0.1:1#n' });
  svc.build();
  assert.ok(svc.state().routePreview.length >= 3);
});

test('testNodes can be stopped mid-run; queued nodes are skipped', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  const links = ['a', 'b', 'c', 'd', 'e', 'f'].map((t, i) => 'ss://' + Buffer.from('aes-128-gcm:pw' + i).toString('base64') + '@127.0.0.1:' + (10 + i) + '#' + t).join('\n');
  svc.importLinks({ text: links });
  let callN = 0;
  core.delay = async (tag, url) => { callN++; core.delayCalls.push([tag, url]); if (callN > 3) svc._testStop = true; return 7; }; // stop after warm-up + first batch of 3
  const r = await svc.testNodes();
  assert.equal(r.stopped, true);
  assert.equal(r.done, 3, 'warm-up + first batch (3 concurrent) finished, queued ones skipped');
  assert.equal(core.delayCalls.length, 4, 'warm-up + 3 in-flight');
  assert.equal(svc._testing, false, 'testing flag cleared');
  assert.equal(svc.d.nodes.filter((n) => n.latency === 7).length, 3);
  assert.equal(svc.stopTestNodes().stopping, false, 'stop is a no-op when idle');
});

test('state() exposes the testing flag', async () => {
  const core = fakeCore();
  const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  assert.equal(svc.state().testing, false);
  svc._testing = true;
  assert.equal(svc.state().testing, true);
  svc._testing = false;
});

test('startup keeps the recovery snapshot when all restore attempts fail', async () => {
  let attempts = 0;
  const svc = mkSvc({ core: fakeCore(), sysproxy: { supported: true, async disable() { attempts++; throw new Error('denied'); } } });
  const snapshot = { backup: { ProxyServer: { type: 'REG_SZ', data: 'corp:80' } }, port: 2080 };
  svc.d.sysproxyBackup = snapshot; svc.store.flush();
  await svc.init();
  assert.equal(attempts, 3);
  assert.deepEqual(svc.d.sysproxyBackup, snapshot);
  assert.deepEqual(JSON.parse(fs.readFileSync(svc.store.file)).sysproxyBackup, snapshot);
});

test('startup clears the recovery snapshot only after a successful retry', async () => {
  let attempts = 0;
  const svc = mkSvc({ core: fakeCore(), sysproxy: { supported: true, async disable() { if (++attempts < 3) throw new Error('busy'); return { ok: true }; } } });
  svc.d.sysproxyBackup = { backup: {}, port: 2080 };
  await svc.init();
  assert.equal(attempts, 3);
  assert.equal(JSON.parse(fs.readFileSync(svc.store.file)).sysproxyBackup, null);
});

test('repeated proxy enable preserves the original snapshot', async () => {
  let enabled = 0; let restored;
  const backup = { ProxyServer: { type: 'REG_SZ', data: 'corp:3128' } };
  const svc = mkSvc({ core: fakeCore(), sysproxy: { supported: true,
    async enable(host, port, beforeApply) { enabled++; await beforeApply(backup); return { ok: true, backup }; },
    async disable(value) { restored = value; return { ok: true }; },
  } });
  await svc.applyProxy(); await svc.applyProxy(); await svc.cleanupProxy();
  assert.equal(enabled, 1); assert.deepEqual(restored, backup);
});

test('partial proxy enable failure leaves a durable recovery snapshot', async () => {
  const backup = { ProxyEnable: { type: 'REG_DWORD', data: '0x0' } };
  const svc = mkSvc({ core: fakeCore(), sysproxy: { supported: true,
    async enable(host, port, beforeApply) { await beforeApply(backup); throw new Error('registry failure'); },
    async disable() { return { ok: false, reason: 'unsupported' }; },
  } });
  await assert.rejects(svc.applyProxy(), /registry failure/);
  await svc.cleanupProxy();
  assert.deepEqual(JSON.parse(fs.readFileSync(svc.store.file)).sysproxyBackup.backup, backup);
});

test('invalid numeric settings cannot poison ports or leave concurrency at zero', async () => {
  const svc = mkSvc({ core: fakeCore() });
  const original = svc.d.settings;
  for (const patch of [{ mixedPort: 2080.5 }, { apiPort: 9090.1 }, { mixedPort: Infinity }, { apiPort: 0 }]) {
    await assert.rejects(svc.setSettings(patch), /端口/);
    assert.equal(svc.d.settings, original);
  }
  for (const value of [0.1, Infinity, -1, NaN]) {
    await svc.setSettings({ testConcurrency: value });
    assert.equal(svc.d.settings.testConcurrency, 3);
  }
});

test('failed node selection keeps the previous persisted selection', async () => {
  const core = fakeCore(); const svc = mkSvc({ core });
  svc.importLinks({ text: LINK + '\n' + LINK.replace('#n', '#other') });
  const previous = svc.d.selectedId;
  core.state = 'running'; core.selectNode = async () => { throw new Error('API offline'); };
  await assert.rejects(svc.selectNode(svc.d.nodes[1].id), /API offline/);
  assert.equal(svc.d.selectedId, previous);
});

test('backup excludes machine proxy state and restores the update timer', async () => {
  const handles = [];
  const svc = mkSvc({ core: fakeCore(), autoUpdateTimer: { set(fn, ms) { handles.push(ms); return 1; }, clear() {} } });
  svc.importLinks({ text: LINK });
  svc.d.sysproxyBackup = { backup: { ProxyServer: { data: 'private:80' } } };
  const backup = JSON.parse(svc.exportBackup());
  assert.equal(backup.data.sysproxyBackup, null);
  assert.ok(svc.d.sysproxyBackup, 'export must not mutate live recovery data');
  svc.d.sysproxyBackup = null;
  backup.data.sysproxyBackup = { backup: { ProxyServer: { data: 'another-machine:80' } } };
  backup.data.settings.autoUpdateSubsMin = 17;
  await svc.importBackup(JSON.stringify(backup));
  assert.equal(svc.d.sysproxyBackup, null);
  assert.deepEqual(handles, [17 * 60000]);
});

test('malformed backup is rejected before stopping the core or replacing data', async () => {
  const core = fakeCore(); const svc = mkSvc({ core });
  svc.importLinks({ text: LINK }); core.state = 'running';
  const original = svc.d;
  for (const nodes of [[null], [{ id: 'x' }], [{ id: 'x', outbound: null }]]) {
    const backup = JSON.parse(svc.exportBackup()); backup.data.nodes = nodes;
    await assert.rejects(svc.importBackup(JSON.stringify(backup)), /数据结构/);
    assert.equal(svc.d, original); assert.equal(core.stopCalls, 0);
  }
  const future = JSON.parse(svc.exportBackup()); future.backupVersion = 999;
  await assert.rejects(svc.importBackup(JSON.stringify(future)), /版本/);
});

test('concurrent proxy toggles are serialized and preserve the original snapshot', async () => {
  let enabled = 0; let restored;
  const backup = { ProxyEnable: { type: 'REG_DWORD', data: '0x0' } };
  const svc = mkSvc({ core: fakeCore(), sysproxy: { supported: true,
    async enable(host, port, beforeApply) { enabled++; await new Promise(setImmediate); await beforeApply(backup); return { ok: true, backup }; },
    async disable(value) { restored = value; return { ok: true }; },
  } });
  await Promise.all([svc.applyProxy(), svc.applyProxy(), svc.cleanupProxy()]);
  assert.equal(enabled, 1); assert.deepEqual(restored, backup);
  assert.equal(svc.proxyApplied, false); assert.equal(svc.d.sysproxyBackup, null);
});

test('invalid update intervals and backup settings are rejected before changing state', async () => {
  const core = fakeCore(); const svc = mkSvc({ core });
  for (const value of [-1, Infinity, 40000]) await assert.rejects(svc.setSettings({ autoUpdateSubsMin: value }), /更新间隔/);
  const original = svc.d; core.state = 'running';
  for (const settings of [[], { mixedPort: 2080.5 }, { apiPort: 0 }, { autoUpdateSubsMin: -1 }]) {
    const backup = JSON.parse(svc.exportBackup()); backup.data.settings = settings;
    await assert.rejects(svc.importBackup(JSON.stringify(backup)), /数据结构|端口|更新间隔/);
    assert.equal(svc.d, original); assert.equal(core.stopCalls, 0);
  }
});

test('testing locks before temporary startup and preserves cancellation during startup', async () => {
  const core = fakeCore(); const svc = mkSvc({ core });
  svc.importLinks({ text: LINK });
  let release;
  core.start = async () => { await new Promise((r) => { release = r; }); core.state = 'running'; };
  const pending = svc.testNodes();
  assert.equal(svc._testing, true);
  await assert.rejects(svc.testNodes(), /测速正在进行/);
  svc.stopTestNodes(); release();
  const result = await pending;
  assert.equal(result.done, 0); assert.equal(result.stopped, true);
  assert.equal(svc._testing, false); assert.equal(core.stopCalls, 1);
});
