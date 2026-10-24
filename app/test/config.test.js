'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseLink, parseLinks } = require('../src/backend/links');
const { parseSubscriptionBody, parseUserInfo, dedupeTags } = require('../src/backend/subscription');
const { buildConfig } = require('../src/backend/config');
const { Core, resolveCoreBinary } = require('../src/backend/core');

const APP = path.join(__dirname, '..');
const core = new Core({ binary: resolveCoreBinary(APP), workDir: os.tmpdir() });
const b64 = (s) => Buffer.from(s).toString('base64');

const LINKS = {
  vmess: 'vmess://' + b64(JSON.stringify({ v: '2', ps: 'vm-ws', add: 'vm.example.com', port: '443', id: '11111111-2222-3333-4444-555555555555', aid: '0', scy: 'auto', net: 'ws', host: 'cdn.example.com', path: '/ray?ed=2048', tls: 'tls', sni: 'cdn.example.com' })),
  vless_reality: 'vless://11111111-2222-3333-4444-555555555555@vl.example.com:443?type=tcp&security=reality&sni=www.microsoft.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=abcd1234&flow=xtls-rprx-vision#vless-reality',
  vless_grpc: 'vless://11111111-2222-3333-4444-555555555555@vg.example.com:443?type=grpc&serviceName=svc&security=tls&sni=vg.example.com#vless-grpc',
  trojan: 'trojan://pa%24%24word@tj.example.com:443?sni=tj.example.com&type=ws&path=%2Ftj&host=tj.example.com#trojan-ws',
  ss_sip002: 'ss://' + b64('aes-256-gcm:secret') + '@ss.example.com:8388#ss-sip002',
  ss_legacy: 'ss://' + b64('chacha20-ietf-poly1305:secret@ss2.example.com:8389') + '#ss-legacy',
  ss_obfs: 'ss://' + b64('aes-128-gcm:secret') + '@ss3.example.com:8390/?plugin=' + encodeURIComponent('obfs-local;obfs=http;obfs-host=bing.com') + '#ss-obfs',
  hy2: 'hysteria2://hypass@hy.example.com:443?sni=hy.example.com&insecure=1&obfs=salamander&obfs-password=ob#hy2',
  tuic: 'tuic://11111111-2222-3333-4444-555555555555:tpass@tu.example.com:443?congestion_control=bbr&alpn=h3&sni=tu.example.com#tuic',
  socks: 'socks5://user:pass@sk.example.com:1080#socks',
  http: 'http://user:pass@hp.example.com:8080#http',
};

test('every link type parses into the expected outbound type', () => {
  const want = { vmess: 'vmess', vless_reality: 'vless', vless_grpc: 'vless', trojan: 'trojan', ss_sip002: 'shadowsocks', ss_legacy: 'shadowsocks', ss_obfs: 'shadowsocks', hy2: 'hysteria2', tuic: 'tuic', socks: 'socks', http: 'http' };
  for (const [k, l] of Object.entries(LINKS)) assert.equal(parseLink(l).type, want[k], k);
});

test('field details', () => {
  const vm = parseLink(LINKS.vmess);
  assert.equal(vm.transport.type, 'ws'); assert.equal(vm.transport.max_early_data, 2048); assert.equal(vm.transport.path, '/ray');
  assert.equal(vm.tls.server_name, 'cdn.example.com');
  const re = parseLink(LINKS.vless_reality);
  assert.equal(re.tls.reality.public_key.length, 43); assert.equal(re.flow, 'xtls-rprx-vision'); assert.equal(re.tag, 'vless-reality');
  const tj = parseLink(LINKS.trojan); assert.equal(tj.password, 'pa$$word');
  const ss = parseLink(LINKS.ss_legacy); assert.equal(ss.server, 'ss2.example.com'); assert.equal(ss.method, 'chacha20-ietf-poly1305');
  const ob = parseLink(LINKS.ss_obfs); assert.equal(ob.plugin, 'obfs-local'); assert.equal(ob.plugin_opts, 'obfs=http;obfs-host=bing.com');
  assert.equal(parseLink(LINKS.hy2).obfs.type, 'salamander');
});

test('unsupported lines are reported, not dropped silently', () => {
  const r = parseLinks('foo://bar\n' + LINKS.socks);
  assert.equal(r.nodes.length, 1); assert.equal(r.errors.length, 1);
});

test('subscription formats: base64, plain, sing-box json, clash yaml', () => {
  const plain = Object.values(LINKS).join('\n');
  assert.equal(parseSubscriptionBody(plain).nodes.length, 11);
  const bb = parseSubscriptionBody(b64(plain)); assert.equal(bb.format, 'base64'); assert.equal(bb.nodes.length, 11);
  const sj = parseSubscriptionBody(JSON.stringify({ outbounds: [{ type: 'direct', tag: 'direct' }, { type: 'trojan', tag: 'a', server: 's', server_port: 1, password: 'p' }] }));
  assert.equal(sj.format, 'sing-box'); assert.equal(sj.nodes.length, 1);
  const cy = parseSubscriptionBody('proxies:\n  - {name: c1, type: ss, server: 1.2.3.4, port: 8388, cipher: aes-128-gcm, password: x}\n  - {name: c2, type: vmess, server: v.example.com, port: 443, uuid: 11111111-2222-3333-4444-555555555555, cipher: auto, tls: true, network: ws, ws-opts: {path: /p, headers: {Host: h.example.com}}}\n  - {name: c3, type: wireguard, server: w, port: 1}\n');
  assert.equal(cy.format, 'clash'); assert.equal(cy.nodes.length, 2); assert.equal(cy.errors.length, 1);
  assert.equal(parseSubscriptionBody('').format, 'empty');
});

test('subscription-userinfo header', () => {
  assert.deepEqual(parseUserInfo('upload=1; download=2; total=3; expire=4'), { upload: 1, download: 2, total: 3, expire: 4 });
  assert.equal(parseUserInfo(null), null);
});

test('dedupeTags keeps tags unique', () => {
  const n = dedupeTags([{ tag: 'a' }, { tag: 'a' }, { tag: 'b' }], ['b']);
  assert.equal(new Set(n.map((x) => x.tag)).size, 3);
});

// ---- real kernel validation ----
async function checkWith(nodes, settings = {}, userRules = []) {
  const { config, warnings } = buildConfig({ nodes, settings, userRules, secret: 's' });
  const f = path.join(os.tmpdir(), `jj-cfg-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(config)); const r = await core.check(f); fs.unlinkSync(f);
  return { ...r, warnings, config };
}

test('kernel accepts config for every protocol (rule mode)', async () => {
  const nodes = dedupeTags(Object.values(LINKS).map(parseLink));
  const r = await checkWith(nodes, { mode: 'rule' });
  assert.ok(r.ok, r.output);
});

test('bundled local rule-sets are used when present; remote fallback with a warning otherwise', async () => {
  const nodes = [parseLink(LINKS.ss_sip002)];
  const local = buildConfig({ nodes, settings: { mode: 'rule' }, rulesetDir: path.join(APP, 'ruleset') });
  assert.ok(local.config.route.rule_set.every((rs) => rs.type === 'local'), JSON.stringify(local.config.route.rule_set));
  assert.ok(!local.warnings.length, 'no warning expected with local files');
  const f = path.join(os.tmpdir(), `jj-lrs-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify(local.config));
  const chk = await core.check(f); fs.unlinkSync(f);
  assert.ok(chk.ok, chk.output); // proves the bundled .srs files are valid rule-sets

  const fallback = buildConfig({ nodes, settings: { mode: 'rule' }, rulesetDir: null });
  assert.ok(fallback.config.route.rule_set.every((rs) => rs.type === 'remote'));
  assert.ok(fallback.warnings.some((w) => /本地规则集缺失/.test(w)));
});

test('kernel accepts global mode, LAN access, ipv6, custom DNS', async () => {
  const nodes = [parseLink(LINKS.ss_sip002)];
  for (const s of [{ mode: 'global' }, { allowAccess: true, bypassLan: false, trafficSniffing: false }, { ipv6Mode: 'ipv4_only', remoteDns: 'tls://1.1.1.1', directDns: 'local' }, { remoteDns: 'udp://8.8.8.8', directDns: '223.5.5.5' }]) {
    const r = await checkWith(nodes, s); assert.ok(r.ok, JSON.stringify(s) + '\n' + r.output);
  }
});

test('kernel accepts TUN inbound config', async () => {
  const r = await checkWith([parseLink(LINKS.ss_sip002)], { tun: true, mode: 'global' });
  assert.ok(r.ok, r.output);
});

test('custom routing rules map to valid sing-box rules', async () => {
  const rules = [
    { name: 'r1', domain: 'example.com\nfull:a.example.org\nkeyword:ads\nregexp:^x.*\\.y$', outbound: 'direct' },
    { name: 'r2', ip: '10.1.0.0/16, 8.8.8.8/32', port: '80,443,1000-2000', network: 'tcp', outbound: 'proxy' },
    { name: 'r3', domain: 'ad.example.net', outbound: 'block' },
    { name: 'r4', domain: 'geosite:cn', outbound: 'direct' },
    { name: 'off', domain: 'skip.me', enabled: false, outbound: 'direct' },
  ];
  const r = await checkWith([parseLink(LINKS.ss_sip002)], { mode: 'global' }, rules);
  assert.ok(r.ok, r.output);
  assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /geosite/);
  const txt = JSON.stringify(r.config.route.rules);
  assert.ok(txt.includes('"action":"reject"')); assert.ok(!txt.includes('skip.me'));
});

test('empty node list is rejected before reaching the kernel', () => {
  assert.throws(() => buildConfig({ nodes: [] }), /No nodes/);
});
