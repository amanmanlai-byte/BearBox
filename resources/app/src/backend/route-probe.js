'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const net = require('net'); const tls = require('tls'); const crypto = require('crypto');
const { Core } = require('./core');
const { httpsViaProxy } = require('./geo');
const { CATALOG, resolveQuickRoutes } = require('./quick-routes');
const HOSTS = { telegram: 'api.telegram.org', chatgpt: 'chatgpt.com', codex: 'api.openai.com', claude: 'claude.ai', claudeCode: 'api.anthropic.com', grok: 'grok.com', gemini: 'gemini.google.com' };
const port = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
function tunnel(host, proxyPort) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxyPort, '127.0.0.1'); let tlsSock; let settled = false;
    const timer = setTimeout(() => fail(new Error('探测超时')), 12000);
    const fail = (e) => { clearTimeout(timer); sock.destroy(); tlsSock?.destroy(); if (!settled) { settled = true; reject(e); } };
    sock.once('error', fail); sock.once('close', () => { if (!settled) fail(new Error('探测连接已关闭')); });
    sock.once('connect', () => {
      const sourcePort = sock.localPort; let header = '';
      sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
      const onData = (d) => {
        header += d.toString('latin1'); if (!header.includes('\r\n\r\n')) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/1.[01] 200/.test(header)) return fail(new Error('探测代理拒绝连接'));
        tlsSock = tls.connect({ socket: sock, servername: host }, () => {
          clearTimeout(timer); settled = true;
          resolve({ sourcePort, close: () => tlsSock.destroy() });
        }); tlsSock.once('error', fail);
      }; sock.on('data', onData);
    });
  });
}
function expectedRoute(id, saved, nodes, selectedTag) {
  const effective = saved[id]?.enabled ? saved[id] : id !== 'telegram' && saved.allAI?.enabled ? saved.allAI : null;
  if (!effective) return null;
  const resolved = resolveQuickRoutes({ [id]: effective }, nodes);
  if (resolved.warnings.length) return null;
  const tag = resolved.resolved[id]?.tag;
  return tag === 'proxy' ? selectedTag : tag;
}
async function probeQuickRoute(svc, id, deps = {}) {
  if (id !== 'allAI' && !HOSTS[id]) throw new Error('未知分流项目');
  if (svc.core.state !== 'running') throw new Error('内核未运行');
  const createCore = deps.createCore || ((opts) => new Core(opts));
  const openTunnel = deps.tunnel || tunnel; const geoGet = deps.geoGet || httpsViaProxy;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-route-test-'));
  let probe;
  try {
    // The active process's loaded configuration is authoritative, not a newly built draft.
    const config = deps.config || JSON.parse(fs.readFileSync(path.join(svc.core.workDir, 'config.json'), 'utf8'));
    const c = structuredClone(config); const selected = await svc.core.currentNode();
    const ports = new Set(); while (ports.size < 3) ports.add(await port());
    const [mixedPort, apiPort, geoPort] = [...ports];
    const selector = 'diagnostic-' + crypto.randomBytes(6).toString('hex');
    const tags = c.outbounds.filter((o) => !['selector','urltest','block','dns'].includes(o.type)).map((o) => o.tag);
    c.outbounds.find((o) => o.tag === 'proxy').default = selected;
    c.outbounds.push({ type: 'selector', tag: selector, outbounds: tags, default: tags[0] });
    c.inbounds = [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: mixedPort }, { type: 'mixed', tag: selector, listen: '127.0.0.1', listen_port: geoPort }];
    c.route.rules.unshift({ inbound: [selector], outbound: selector });
    c.experimental = { clash_api: { external_controller: `127.0.0.1:${apiPort}`, secret: selector } };
    c.log = { level: 'error' };
    probe = createCore({ binary: svc.core.binary, workDir: dir });
    if (svc._shuttingDown) throw new Error('测试已取消');
    await probe.start({ config: c, apiPort, secret: selector });
    const ids = id === 'allAI' ? CATALOG.filter((p) => p.id !== 'telegram').map((p) => p.id) : [id];
    const results = [];
    for (const profile of ids) {
      if (svc._shuttingDown) throw new Error('测试已取消');
      let connection; let actual = null; let latency = null; let country = null; let error = null;
      try {
        const start = performance.now(); connection = await openTunnel(HOSTS[profile], mixedPort);
        latency = Math.round(performance.now() - start);
        const data = await probe.get('/connections');
        const flow = data.connections?.find((x) => Number(x.metadata?.sourcePort) === connection.sourcePort);
        // Clash chain order differs across cores, select only a concrete outbound.
        actual = flow?.chains?.find((tag) => tags.includes(tag)) || null;
        if (!actual) throw new Error('无法确认实际出口节点');
        await probe.request('PUT', '/proxies/' + encodeURIComponent(selector), { name: actual });
        const geo = JSON.parse(await geoGet('api.ip.sb', '/geoip', '127.0.0.1', geoPort));
        country = geo.country || geo.country_code || null;
        if (!country) error = '出口国家查询失败';
      } catch (e) { error = e.message; }
      finally { connection?.close(); }
      const expected = expectedRoute(profile, svc.d.quickRoutes || {}, svc.d.nodes, selected);
      results.push({ id: profile, name: CATALOG.find((p) => p.id === profile).name, applied: !!expected && !!actual && actual === expected, country, node: actual, latency, error });
    }
    return { results };
  } finally {
    try { if (probe) await probe.stop(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}
module.exports = { probeQuickRoute, expectedRoute, HOSTS };
