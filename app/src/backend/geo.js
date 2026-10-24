'use strict';
// IP geolocation via ip.sb (https://api.ip.sb/geoip). When the core is running,
// requests go through the local mixed proxy (HTTP CONNECT + TLS) so the "self"
// lookup reflects the proxy exit; otherwise they go direct. Results are cached
// on disk (30 days) so the API is never hammered.
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const dns = require('dns');

const HOST = 'api.ip.sb';
const CACHE_TTL = 30 * 24 * 3600 * 1000;

/** Minimal HTTPS GET through an HTTP proxy via CONNECT. Returns the body string. */
function httpsViaProxy(reqPath, proxyHost, proxyPort, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxyHost, port: proxyPort });
    sock.setTimeout(timeoutMs);
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.once('error', fail); sock.once('timeout', () => fail(new Error('代理连接超时')));
    sock.once('connect', () => {
      sock.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nHost: ${HOST}:443\r\n\r\n`);
      let head = '';
      const onData = (d) => {
        head += d.toString('latin1');
        const idx = head.indexOf('\r\n\r\n');
        if (idx < 0) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/1\.[01] 200/.test(head)) return fail(new Error('代理拒绝 CONNECT: ' + head.split('\r\n')[0]));
        const tlsSock = tls.connect({ socket: sock, servername: HOST }, () => {
          tlsSock.write(`GET ${reqPath} HTTP/1.1\r\nHost: ${HOST}\r\nUser-Agent: JiajiaBox/0.3\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
          let body = ''; let headers = ''; let headerDone = false;
          tlsSock.on('data', (chunk) => {
            if (!headerDone) {
              headers += chunk.toString('latin1');
              const hi = headers.indexOf('\r\n\r\n');
              if (hi < 0) return;
              headerDone = true;
              body = headers.slice(hi + 4); headers = headers.slice(0, hi);
            } else body += chunk.toString('utf8');
          });
          tlsSock.once('close', () => {
            const m = /content-length:\s*(\d+)/i.exec(headers);
            let out = body;
            if (m) { const len = +m[1]; const buf = Buffer.from(body, 'utf8'); out = buf.slice(0, len).toString('utf8'); }
            else if (/transfer-encoding:\s*chunked/i.test(headers)) out = dechunk(body);
            if (/^2\d\d/.test(headers.split('\r\n')[0] || '')) resolve(out); else reject(new Error('HTTP 错误: ' + headers.split('\r\n')[0]));
          });
          tlsSock.once('error', fail);
        });
        tlsSock.once('error', fail);
      };
      sock.on('data', onData);
    });
  });
}

function dechunk(body) {
  let out = ''; let rest = Buffer.from(body, 'utf8');
  for (;;) {
    const nl = rest.indexOf('\r\n'); if (nl < 0) break;
    const size = parseInt(rest.slice(0, nl).toString(), 16);
    if (!size) break;
    out += rest.slice(nl + 2, nl + 2 + size).toString('utf8');
    rest = rest.slice(nl + 2 + size + 2);
  }
  return out;
}

async function httpsDirect(reqPath, timeoutMs = 10000) {
  const res = await fetch(`https://${HOST}${reqPath}`, { headers: { 'User-Agent': 'JiajiaBox/0.3', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Resolve a hostname to an IPv4 (direct DNS). Returns null on failure or for non-hosts. */
async function resolveHost(host, timeoutMs = 4000) {
  if (!host) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  try {
    const r = await Promise.race([dns.promises.resolve4(host), new Promise((_, rej) => setTimeout(() => rej(new Error('DNS 超时')), timeoutMs))]);
    return r && r[0] ? r[0] : null;
  } catch { return null; }
}

class GeoService {
  constructor({ userData, getProxy = () => null, transports = null, now = () => Date.now() }) {
    this.cacheFile = path.join(userData, 'geo-cache.json');
    this.getProxy = getProxy;
    this.t = transports || { viaProxy: httpsViaProxy, direct: httpsDirect };
    this.now = now;
    this.cache = null; this._flushT = null; this._queue = Promise.resolve();
  }

  _load() {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { this.cache = {}; }
    return this.cache;
  }
  _flush() {
    clearTimeout(this._flushT);
    this._flushT = setTimeout(() => {
      try { fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true }); fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache)); } catch { /* best effort */ }
    }, 400);
    this._flushT.unref?.();
  }

  async _fetchJson(reqPath, { forceDirect = false } = {}) {
    const proxy = forceDirect ? null : this.getProxy();
    let raw;
    if (proxy) {
      try { raw = await this.t.viaProxy(reqPath, proxy.host, proxy.port); }
      catch (e) { raw = await this.t.direct(reqPath); } // proxy path failed: fall back to direct
    } else raw = await this.t.direct(reqPath);
    const j = JSON.parse(raw);
    if (!j || typeof j.latitude !== 'number' || typeof j.longitude !== 'number') throw new Error('返回数据缺少坐标');
    return { ip: j.ip, country: j.country, country_code: j.country_code, region: j.region, city: j.city, isp: j.isp || j.organization, asn: j.asn, latitude: j.latitude, longitude: j.longitude };
  }

  /** Lookup one IP (cached). Serialized so we never parallel-hammer ip.sb. */
  lookup(ip) {
    this._load();
    const hit = this.cache[ip];
    if (hit && this.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.geo);
    const run = async () => {
      const geo = await this._fetchJson(`/geoip/${encodeURIComponent(ip)}`);
      this.cache[ip] = { ts: this.now(), geo }; this._flush();
      return geo;
    };
    const task = this._queue.catch(() => {}).then(run); // single execution, shared by queue and caller
    this._queue = task.catch(() => {});
    return task;
  }

  /** Self lookup (no ip = whatever the request egress is). Not cached. direct=true forces the direct path. */
  async self({ direct = false } = {}) {
    const geo = await this._fetchJson('/geoip', { forceDirect: direct });
    return { ...geo, viaProxy: !direct && !!this.getProxy() };
  }
}

module.exports = { GeoService, resolveHost, httpsViaProxy, httpsDirect, dechunk };
