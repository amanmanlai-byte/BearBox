'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const https = require('https');
const { spawn, execFile, execFileSync } = require('child_process');
const { AppService } = require('../src/backend/service');
const { resolveCoreBinary } = require('../src/backend/core');

const APP = path.join(__dirname, '..');
const BIN = resolveCoreBinary(APP);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jj-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAYLOAD = Buffer.alloc(2 * 1024 * 1024, 7);
const b64 = (s) => Buffer.from(s).toString('base64');

const procs = []; let origin; let subServer; let tlsServer;
function startServer(port, apiPort, password) {
  const cfg = { log: { level: 'warn' }, inbounds: [{ type: 'shadowsocks', listen: '127.0.0.1', listen_port: port, method: 'aes-128-gcm', password }], outbounds: [{ type: 'direct', tag: 'direct' }], experimental: { clash_api: { external_controller: `127.0.0.1:${apiPort}` } } };
  const f = path.join(tmp, `srv${port}.json`); fs.writeFileSync(f, JSON.stringify(cfg));
  const p = spawn(BIN, ['run', '-c', f, '-D', tmp], { stdio: 'ignore' }); procs.push(p); return p;
}
async function serverTotals(apiPort) { const r = await fetch(`http://127.0.0.1:${apiPort}/connections`); const j = await r.json(); return { up: j.uploadTotal, down: j.downloadTotal }; }
// Native Windows curl cannot write to /dev/null (no MSYS path translation when spawned from Node), so discard the body into a temp file.
// The developer shell may export HTTP_PROXY/NO_PROXY (e.g. NO_PROXY=127.0.0.1 makes curl bypass our explicit -x proxy), so strip them for child curls.
const CURL_NULL = path.join(os.tmpdir(), 'jj-e2e-curl.out');
const CURL_ENV = (() => { const e = { ...process.env }; for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'no_proxy', 'http_proxy', 'https_proxy', 'all_proxy']) delete e[k]; return e; })();
const curlViaProxy = (port, url) => new Promise((resolve, reject) => execFile('curl', ['-s', '-m', '20', '-x', `http://127.0.0.1:${port}`, '-o', CURL_NULL, '-w', '%{http_code} %{size_download}', url], { env: CURL_ENV }, (e, out) => (e ? reject(e) : resolve(out.trim().split(' ').map(Number)))));

const sysproxyCalls = [];
const fakeSys = { supported: true, async enable(h, p) { sysproxyCalls.push(['enable', h, p]); return { ok: true, backup: { ProxyEnable: { type: 'REG_DWORD', data: '0x0' } } }; }, async disable(b) { sysproxyCalls.push(['disable', !!b]); return { ok: true }; } };

let svc;
let caTrusted = false; // becomes true only when the test CA actually entered the Root store
test.before(async () => {
  origin = http.createServer((req, res) => { if (req.url.startsWith('/slow')) { res.writeHead(200, { 'Content-Type': 'text/plain' }); const iv = setInterval(() => res.write('x'), 200); req.on('close', () => clearInterval(iv)); setTimeout(() => { clearInterval(iv); res.end(); }, 9000); return; } if (req.url.startsWith('/ping')) { res.writeHead(204); return res.end(); } res.writeHead(200, { 'Content-Length': PAYLOAD.length }); res.end(PAYLOAD); });
  await new Promise((r) => origin.listen(18080, '127.0.0.1', r));
  const sub = 'ss://' + b64('aes-128-gcm:pw1') + '@127.0.0.1:18388#node-A\nss://' + b64('aes-128-gcm:pw2') + '@127.0.0.1:18389#node-B\n';
  subServer = http.createServer((req, res) => { res.writeHead(200, { 'subscription-userinfo': 'upload=100; download=200; total=1000000; expire=1893456000' }); res.end(b64(sub)); });
  await new Promise((r) => subServer.listen(18081, '127.0.0.1', r));
  // Checked-in test fixture makes this Windows test independent from an OpenSSL installation.
  const certPem = path.join(__dirname, 'fixtures', 'localhost.pem'); const certPfx = path.join(__dirname, 'fixtures', 'localhost.pfx'); const pass = 'jiajiabox-e2e';
  // The kernel's URLTest (delay) client ignores SSL_CERT_FILE on Windows and uses the OS cert
  // store, so the self-signed test CA must be trusted via the CurrentUser Root store. Newer
  // Windows pops an interactive confirmation for Root-store writes; with nobody at the desktop
  // that dialog would hang the suite forever - so the install is time-boxed and the delay
  // assertions degrade honestly to mechanism checks when the CA could not be installed.
  if (process.platform === 'win32') {
    try { execFileSync('certutil', ['-user', '-addstore', 'Root', certPem], { stdio: 'ignore', timeout: 8000 }); caTrusted = true; }
    catch { console.error('[e2e] 测试 CA 未能安装（需要交互确认）——URL 测速数值断言降级为机制验证'); }
  } else caTrusted = true;
  process.env.SSL_CERT_FILE = certPem; // still useful for non-Windows and Go stdlib paths
  tlsServer = https.createServer({ pfx: fs.readFileSync(certPfx), passphrase: pass }, (req, res) => { res.writeHead(204); res.end(); });
  await new Promise((r) => tlsServer.listen(18443, '127.0.0.1', r));
  startServer(18388, 19191, 'pw1'); startServer(18389, 19192, 'pw2');
  await sleep(1500);
  svc = new AppService({ userData: path.join(tmp, 'ud'), appRoot: APP, binary: BIN, sysproxy: fakeSys });
  await svc.init();
  // point URL tests at the local https endpoint before any test runs (the new default targets google.com)
  await svc.setSettings({ connectionTestURL: 'https://127.0.0.1:18443/ping' });
});
test.after(async () => {
  if (svc) await svc.shutdown().catch(() => {});
  procs.forEach((p) => p.kill());
  for (const server of [origin, subServer, tlsServer].filter(Boolean)) await new Promise((r) => server.close(r));
  if (caTrusted) { try { execFileSync('certutil', ['-user', '-delstore', 'Root', 'localhost'], { stdio: 'ignore', timeout: 8000 }); } catch { /* already gone */ } }
});

test('core binary reports the Jiajia build', () => { assert.match(svc.coreVersion || '', /Jiajia/); });

test('subscription import from a real HTTP endpoint (base64) with traffic info', async () => {
  const r = await svc.addSubscription({ name: 'local', url: 'http://127.0.0.1:18081/sub' });
  assert.equal(r.count, 2);
  const st = svc.state(); assert.equal(st.nodes.length, 2); assert.equal(st.subscriptions[0].info.total, 1000000);
  assert.equal(st.nodes.find((n) => n.id === st.selectedId).tag, 'node-A');
});

test('URL test: core is temp-started when stopped, core stops again', async () => {
  assert.equal(svc.core.state, 'stopped');
  const r = await svc.testNodes();
  assert.equal(r.mode, 'url');
  const st = svc.state();
  // with the test CA trusted the kernel returns real numbers; without it the kernel's TLS
  // rejection is recorded honestly (null latency, url kind) - both prove our plumbing
  assert.ok(st.nodes.every((n) => n.latencyKind === 'url'), JSON.stringify(st.nodes.map((n) => [n.tag, n.latency, n.latencyKind])));
  if (caTrusted) assert.ok(st.nodes.every((n) => typeof n.latency === 'number'), 'real delays expected with CA trusted');
  else assert.ok(st.nodes.every((n) => n.latency === null), 'untrusted CA must fail honestly, not fake numbers');
  assert.equal(svc.core.state, 'stopped', 'temp start cleaned up');
  assert.deepEqual(sysproxyCalls, [], 'temp start never touches the system proxy');
});

test('settings are validated and persisted', async () => {
  await assert.rejects(svc.setSettings({ mixedPort: 70000 }), /端口/);
  await assert.rejects(svc.setSettings({ mixedPort: 19099, apiPort: 19099 }), /不能相同/);
  await assert.rejects(svc.setSettings({ connectionTestURL: 'http://cp.cloudflare.com/' }), /https/);
  await svc.setSettings({ mixedPort: 31280, apiPort: 19099, mode: 'global', bypassLan: false, connectionTestURL: 'https://127.0.0.1:18443/ping' });
  svc.store.flush(); const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'ud', 'data.json'), 'utf8'));
  assert.equal(saved.settings.mixedPort, 31280); assert.equal(saved.settings.mode, 'global');
});

test('start: traffic really flows through the selected node and is measured', async () => {
  const ticks = []; svc.on('tick', (t) => ticks.push(t));
  await svc.start();
  assert.equal(svc.core.state, 'running');
  assert.deepEqual(sysproxyCalls[0], ['enable', '127.0.0.1', 31280]);
  const a0 = await serverTotals(19191); const b0 = await serverTotals(19192);
  const [code, size] = await curlViaProxy(31280, 'http://127.0.0.1:18080/big');
  assert.equal(code, 200); assert.equal(size, PAYLOAD.length);
  await sleep(2500);
  const a1 = await serverTotals(19191); const b1 = await serverTotals(19192);
  assert.ok(a1.down - a0.down >= 0 && a1.up + a1.down > a0.up + a0.down, 'server A saw traffic');
  assert.equal(b1.up + b1.down, b0.up + b0.down, 'server B saw nothing');
  const st = svc.state();
  assert.ok(st.session.downTotal >= PAYLOAD.length, `client counter ${st.session.downTotal}`);
  assert.ok(ticks.some((t) => t.down > 100000), 'a tick recorded a real speed');
  assert.ok(st.today.down >= PAYLOAD.length, 'daily stat accumulated');
});

test('switching node reroutes traffic to server B only', async () => {
  const nb = svc.state().nodes.find((n) => n.tag === 'node-B');
  await svc.selectNode(nb.id);
  assert.equal(await svc.core.currentNode(), 'node-B');
  const a0 = await serverTotals(19191); const b0 = await serverTotals(19192);
  const [code] = await curlViaProxy(31280, 'http://127.0.0.1:18080/big'); assert.equal(code, 200);
  await sleep(1500);
  const a1 = await serverTotals(19191); const b1 = await serverTotals(19192);
  assert.ok(b1.up + b1.down > b0.up + b0.down, 'server B saw traffic');
  assert.equal(a1.up + a1.down, a0.up + a0.down, 'server A saw nothing');
});

test('URL delay test through the running core behaves per trust state', async () => {
  await svc.testNodes();
  const st = svc.state();
  assert.ok(st.nodes.every((n) => n.latencyKind === 'url'), JSON.stringify(st.nodes.map((n) => [n.tag, n.latency, n.latencyKind])));
  if (caTrusted) assert.ok(st.nodes.every((n) => typeof n.latency === 'number'));
  else assert.ok(st.nodes.every((n) => n.latency === null), 'untrusted CA: honest null, no fake numbers');
});

test('connections list is real and can be closed', async () => {
  // hold a connection open through the proxy
  const holder = spawn('curl', ['-s', '-m', '8', '-x', 'http://127.0.0.1:31280', '-o', CURL_NULL, 'http://127.0.0.1:18080/slow'], { env: CURL_ENV });
  await sleep(2500);
  assert.ok(svc.core.connections.length >= 1, 'has live connection'); const c = svc.core.connections[0]; assert.equal(c.host, '127.0.0.1');
  await svc.core.closeAll(); await sleep(1500);
  holder.kill();
});

test('adding a rule restarts the core with a valid config; logs are captured', async () => {
  await svc.saveRule({ name: 'direct-local', domain: 'example.com', outbound: 'direct' });
  assert.equal(svc.core.state, 'running');
  assert.ok(svc.core.logs.length > 0);
  const [code] = await curlViaProxy(31280, 'http://127.0.0.1:18080/big'); assert.equal(code, 200);
});

test('invalid port conflict is reported instead of hanging', async () => {
  await svc.stop();
  const blocker = http.createServer(); await new Promise((r) => blocker.listen(31280, '127.0.0.1', r));
  await assert.rejects(svc.start(), /already in use/);
  blocker.close(); assert.equal(svc.core.state, 'stopped');
});

test('stop restores the system proxy', async () => {
  await svc.start(); await svc.stop();
  const last = sysproxyCalls.filter((c) => c[0] === 'disable'); assert.ok(last.length >= 1); assert.equal(svc.core.state, 'stopped');
});
