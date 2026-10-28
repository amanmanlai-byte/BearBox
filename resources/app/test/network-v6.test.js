'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process'); const { EventEmitter } = require('events');
const { GeoService, resolveHost, dechunk } = require('../src/backend/geo');
const { buildConfig, DEFAULT_SETTINGS } = require('../src/backend/config');
const { AppService } = require('../src/backend/service');
const { Core } = require('../src/backend/core');
const net = require('net'); const dgram = require('dgram');
const root = path.resolve(__dirname, '..');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bearbox-v6-'));
test('FakeIP and all IPv6 strategies are accepted by the bundled custom kernel', () => {
  const dir = temp();
  try { for (const ipv6Mode of ['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only']) for (const fakeip of [true, false]) {
    const { config } = buildConfig({ nodes: [{ type: 'socks', tag: 'test', server: 'localhost', server_port: 1080 }], settings: { mode: 'global', ipv6Mode, fakeip }, cachePath: path.join(dir, 'cache.db') });
    assert.equal(config.route.default_domain_resolver.strategy, ipv6Mode);
    assert.equal(config.dns.servers.some(s => s.type === 'fakeip'), fakeip);
    const f = path.join(dir, 'config.json'); fs.writeFileSync(f, JSON.stringify(config));
    execFileSync(path.join(root, 'core/sing-box-windows-amd64.exe'), ['check', '-c', f], { windowsHide: true, stdio: 'pipe' });
  } } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('DNS resolver honors IPv6 preference and strict modes, rejecting synthetic IPs', async () => {
  const calls = []; const transports = { resolve: async (_, family) => { calls.push(family); return family === 6 ? ['2606:4700:4700::1111'] : ['1.1.1.1']; } };
  assert.equal(await resolveHost('example.org', { strategy: 'prefer_ipv6', transports }), '2606:4700:4700::1111'); assert.deepEqual(calls, [6]);
  assert.equal(await resolveHost('1.1.1.1', { strategy: 'ipv6_only', transports }), null);
});
test('real kernel answers A and AAAA DNS queries with configured FakeIP ranges', { timeout: 15000 }, async () => {
  const dir = temp();
  const port = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => resolve(n)); }); });
  const socket = dgram.createSocket('udp4'); await new Promise(r => socket.bind(0, '127.0.0.1', r));
  const dnsPort = socket.address().port; socket.close();
  const apiPort = await port(); let mixedPort = await port(); while (mixedPort === apiPort) mixedPort = await port();
  const { config } = buildConfig({ nodes: [{ type: 'direct', tag: 'test-local' }], settings: { mode: 'global', fakeip: true, apiPort, mixedPort }, cachePath: path.join(dir, 'cache.db') });
  config.inbounds.push({ type: 'direct', tag: 'test-dns', listen: '127.0.0.1', listen_port: dnsPort, network: 'udp' });
  config.route.rules.unshift({ inbound: ['test-dns'], action: 'hijack-dns' });
  const core = new Core({ binary: path.join(root, 'core/sing-box-windows-amd64.exe'), workDir: dir });
  const query = type => new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4'); const timer = setTimeout(() => finish(new Error('DNS timeout')), 3000);
    const finish = (err, value) => { clearTimeout(timer); client.close(); err ? reject(err) : resolve(value); };
    client.once('error', finish); client.once('message', msg => finish(null, msg));
    const header = Buffer.alloc(12); header.writeUInt16BE(0x1234); header.writeUInt16BE(0x100, 2); header.writeUInt16BE(1, 4);
    const question = Buffer.concat('offline-fakeip.test'.split('.').map(x => Buffer.concat([Buffer.from([x.length]), Buffer.from(x)])).concat(Buffer.from([0, 0, type, 0, 1])));
    client.send(Buffer.concat([header, question]), dnsPort, '127.0.0.1');
  });
  try {
    await core.start({ config, apiPort, secret: '' });
    for (const type of [1, 28]) {
      const answer = await query(type); assert.equal(answer.readUInt16BE(0), 0x1234); assert.equal(answer[3] & 15, 0); assert.ok(answer.readUInt16BE(6) > 0);
      if (type === 1) { const bytes = answer.subarray(-4); assert.equal(bytes[0], 198); assert.ok(bytes[1] === 18 || bytes[1] === 19); }
      else assert.equal(answer.subarray(-16)[0], 0xfc);
    }
  } finally { await core.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('self detection verifies family, falls back only for prefer modes and keeps the proxy path', async () => {
  const dir = temp(); const requests = []; let mode = 'prefer_ipv6';
  const transports = {
    direct: async () => { throw new Error('direct fallback forbidden'); },
    viaProxy: async (host, req) => { requests.push([host, req]);
      if (host === 'api-ipv6.ip.sb') throw new Error('no IPv6 route');
      if (req === '/ip') return '1.1.1.1\n';
      return JSON.stringify({ ip: '1.1.1.1', country_code: 'AU' });
    }
  };
  const geo = new GeoService({ userData: dir, transports, getStrategy: () => mode, getProxy: () => ({ host: '127.0.0.1', port: 2080 }) });
  try { const result = await geo.self(); assert.equal(result.ipVersion, 4); assert.equal(result.viaProxy, true); assert.equal(result.latitude, null);
    mode = 'ipv6_only'; requests.length = 0; await assert.rejects(geo.self(), /IPv6/); assert.equal(requests.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('geolocation validates returned IP, accepts country without coordinates and deduplicates lookups', async () => {
  const dir = temp(); let calls = 0;
  const geo = new GeoService({ userData: dir, transports: { direct: async () => { calls++; return JSON.stringify({ ip: '1.1.1.1', country_code: 'AU' }); } } });
  try { const [a, b] = await Promise.all([geo.lookup('1.1.1.1'), geo.lookup('1.1.1.1')]); assert.equal(calls, 1); assert.equal(a.country_code, b.country_code);
    await assert.rejects(geo.lookup('not-an-ip'), /无效/); await assert.rejects(geo.lookup('8.8.8.8'), /不一致/);
  } finally { clearTimeout(geo._flushT); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('chunk decoder preserves Chinese split across HTTP chunks', () => {
  const data = Buffer.from('中国'); const parts = [data.subarray(0, 2), data.subarray(2)];
  const body = Buffer.concat(parts.flatMap(b => [Buffer.from(b.length.toString(16) + '\r\n'), b, Buffer.from('\r\n')]).concat(Buffer.from('0\r\n\r\n')));
  assert.equal(dechunk(body), '中国');
});
test('shutdown disables Windows proxy even if the client never enabled it, including core-stop failure', async () => {
  for (const fail of [false, true]) {
    const dir = temp(); const core = new EventEmitter(); let disabled = 0;
    core.stop = async () => { if (fail) throw new Error('stop failure'); }; core.state = 'stopped';
    const svc = new AppService({ userData: dir, appRoot: root, core, sysproxy: { supported: true, disable: async (backup) => { assert.equal(backup, undefined); disabled++; return { ok: true }; } } });
    try { svc.d.settings.setSystemProxy = false; svc.d.sysproxyBackup = { backup: { ProxyEnable: { data: '1' } } };
      if (fail) await assert.rejects(svc.shutdown(), /stop failure/); else await svc.shutdown();
      assert.equal(disabled, 1); assert.equal(svc.d.sysproxyBackup, null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});
test('new DNS settings reject invalid values and obsolete brightness controls are removed', () => {
  const dir = temp(); const core = new EventEmitter(); core.state = 'stopped';
  const svc = new AppService({ userData: dir, appRoot: root, core });
  try { assert.throws(() => svc._normalizeSettings({ ipv6Mode: 'invalid' }), /IPv6/); assert.throws(() => svc._normalizeSettings({ fakeip: 'yes' }), /DNS/); assert.equal('wallpaperVeil' in DEFAULT_SETTINGS, false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
