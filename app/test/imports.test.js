'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseLink, parseLinks } = require('../src/backend/links');
const { parseSubscriptionBody } = require('../src/backend/subscription');
const { parseRuleFile } = require('../src/backend/config');
const { AppService } = require('../src/backend/service');

test('trojan-go:// maps onto a trojan outbound with ws transport', () => {
  const n = parseLink('trojan-go://pw%40x@tg.example.com:443?security=tls&type=ws&host=cdn.example.com&path=%2Ftj&sni=tg.example.com#tg-ws');
  assert.equal(n.type, 'trojan');
  assert.equal(n.server, 'tg.example.com');
  assert.equal(n.password, 'pw@x');
  assert.equal(n.tls.enabled, true);
  assert.equal(n.transport.type, 'ws');
  assert.equal(n.transport.headers.Host, 'cdn.example.com');
  // without type/host/path params it is plain trojan over tcp
  const plain = parseLink('trojan-go://pw@tg2.example.com:443#tg-tcp');
  assert.equal(plain.transport, undefined);
});

test('SIP008 subscription (object and bare array) parses into shadowsocks nodes', () => {
  const a = parseSubscriptionBody(JSON.stringify({ version: 1, servers: [
    { server: 's1.example.com', server_port: 8388, method: 'aes-128-gcm', password: 'p1', remarks: 'SIP008 一号' },
    { server: 's2.example.com', server_port: 8389, method: 'chacha20-ietf-poly1305', password: 'p2' },
    { server: 'bad', server_port: 1 },
  ] }));
  assert.equal(a.format, 'sip008');
  assert.equal(a.nodes.length, 2);
  assert.equal(a.nodes[0].tag, 'SIP008 一号');
  assert.equal(a.nodes[1].server_port, 8389);
  assert.equal(a.errors.length, 1);

  const b = parseSubscriptionBody(JSON.stringify([
    { server: 's3.example.com', server_port: 8388, method: 'aes-128-gcm', password: 'p3', remarks: '数组形态' },
  ]));
  assert.equal(b.format, 'sip008');
  assert.equal(b.nodes[0].tag, '数组形态');
});

test('JSON array of link strings parses as a links subscription', () => {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const body = JSON.stringify(['ss://' + b64('aes-128-gcm:p') + '@1.2.3.4:8388#j1', 'trojan://pw@t.example.com:443#j2']);
  const r = parseSubscriptionBody(body);
  assert.equal(r.format, 'links');
  assert.equal(r.nodes.length, 2);
});

test('parseRuleFile reads Clash rule lines with policies and reports skips', () => {
  const r = parseRuleFile([
    '# comment',
    'DOMAIN-SUFFIX,example.com,DIRECT',
    'DOMAIN,ads.example.net,REJECT',
    'DOMAIN-KEYWORD,tracker,PROXY',
    'IP-CIDR,10.0.0.0/8,DIRECT',
    'IP-CIDR6,fd00::/8,DIRECT',
    'PROCESS-NAME,telegram.exe,PROXY',
    'GEOIP,CN,DIRECT',
    'MATCH,PROXY',
    'BOGUS-TYPE,x,PROXY',
  ].join('\n'));
  const out = (rule) => rule.outbound;
  assert.equal(r.rules.length, 6);
  const suffix = r.rules[0];
  assert.equal(suffix.domain, 'example.com'); assert.equal(suffix.outbound, 'direct');
  assert.equal(r.rules[1].domain, 'full:ads.example.net'); assert.equal(r.rules[1].outbound, 'block');
  assert.equal(r.rules[2].domain, 'keyword:tracker');
  assert.equal(r.rules[3].ip, '10.0.0.0/8');
  assert.equal(r.rules[4].ip, 'fd00::/8');
  assert.equal(r.rules[5].processName, 'telegram.exe');
  assert.equal(r.skipped, 3); // GEOIP, MATCH, BOGUS-TYPE
  assert.ok(r.warnings.some((w) => /GEOIP/.test(w)));
  void out;
});

test('parseRuleFile reads a JSON array of rule objects', () => {
  const r = parseRuleFile(JSON.stringify([{ name: 'r1', domain: 'a.com', outbound: 'direct' }, { name: 'r2', ip: '1.1.1.1/32', outbound: 'proxy', enabled: false }]));
  assert.equal(r.rules.length, 2);
  assert.equal(r.rules[0].outbound, 'direct');
  assert.equal(r.rules[1].enabled, false);
});

test('importRuleFile batch-imports with at most one core restart', async () => {
  const fakeSys = { supported: false, async enable() { return { ok: true, backup: null }; }, async disable() { return { ok: true }; } };
  const svc = new AppService({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'jj-imp-')), appRoot: path.join(__dirname, '..'), sysproxy: fakeSys, binary: 'x.exe' });
  svc.core.state = 'running';
  let restarts = 0;
  svc.restart = async () => { restarts++; };
  const r = await svc.importRuleFile('DOMAIN-SUFFIX,example.com,DIRECT\nDOMAIN,bad.example,REJECT');
  assert.equal(r.imported, 2);
  assert.equal(restarts, 1);
  assert.equal(svc.d.rules.length, 2);
  // empty file errors
  await assert.rejects(svc.importRuleFile('# nothing'), /没有可导入|规则/);
});

test('importSubFile ingests a local subscription file', async () => {
  const fakeSys = { supported: false, async enable() { return { ok: true, backup: null }; }, async disable() { return { ok: true }; } };
  const svc = new AppService({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'jj-sub-')), appRoot: path.join(__dirname, '..'), sysproxy: fakeSys, binary: 'x.exe' });
  const b64 = (s) => Buffer.from(s).toString('base64');
  const r = await svc.importSubFile({ name: '本地文件', content: 'ss://' + b64('aes-128-gcm:p1') + '@127.0.0.1:8388#f1\nss://' + b64('aes-128-gcm:p2') + '@127.0.0.1:8389#f2' });
  assert.equal(r.count, 2);
  assert.equal(svc.d.nodes.length, 2);
  assert.equal(svc.d.subscriptions[0].name, '本地文件');
  await assert.rejects(svc.importSubFile({ name: 'x', content: 'not a sub' }), /没有解析出/);
});
