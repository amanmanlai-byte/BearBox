'use strict';
// IP geolocation via ip.sb (https://api.ip.sb/geoip) and DNS-over-HTTPS fallback.
// When the core is running, requests go through the local mixed proxy (HTTP CONNECT + TLS)
// so the "self" lookup reflects the proxy exit; otherwise they go direct. Geo results are
// cached on disk (30 days) so the API is never hammered.
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const dns = require('dns');

const GEO_HOST = 'api.ip.sb';
const CACHE_TTL = 30 * 24 * 3600 * 1000;

/** Minimal HTTPS GET through an HTTP proxy via CONNECT. Returns the body string. */
function httpsViaProxy(host, reqPath, proxyHost, proxyPort, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxyHost, port: proxyPort });
    sock.setTimeout(timeoutMs);
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.once('error', fail); sock.once('timeout', () => fail(new Error('代理连接超时')));
    sock.once('connect', () => {
      sock.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`);
      let head = '';
      const onData = (d) => {
        head += d.toString('latin1');
        const idx = head.indexOf('\r\n\r\n');
        if (idx < 0) return;
        sock.removeListener('data', onData);
        if (!/^HTTP\/1\.[01] 200/.test(head)) return fail(new Error('代理拒绝 CONNECT: ' + head.split('\r\n')[0]));
        const tlsSock = tls.connect({ socket: sock, servername: host }, () => {
          tlsSock.write(`GET ${reqPath} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: JiajiaBox/0.4\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
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
            if (m) { const len = +m[1]; out = Buffer.from(body, 'utf8').slice(0, len).toString('utf8'); }
            else if (/transfer-encoding:\s*chunked/i.test(headers)) out = dechunk(body);
            if (/^2\d\d/.test((headers.split('\r\n')[0] || '').trim())) resolve(out); else reject(new Error('HTTP 错误: ' + headers.split('\r\n')[0]));
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

async function httpsDirect(host, reqPath, timeoutMs = 10000) {
  const res = await fetch(`https://${host}${reqPath}`, { headers: { 'User-Agent': 'JiajiaBox/0.4', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const isIpLiteral = (host) => /^[\d.]+$/.test(host) || String(host || '').includes(':');

/**
 * Resolve a hostname to an IPv4. Order: system DNS, then DoH (Cloudflare through the
 * proxy when the core runs / direct otherwise, then AliDNS direct). CN DNS commonly
 * NXDOMAINs proxy-server domains, which is exactly why the DoH fallback exists.
 */
async function resolveHost(host, { proxy = null, transports = null, timeoutMs = 4000 } = {}) {
  if (!host) return null;
  if (isIpLiteral(host)) return host;
  const t = transports || { viaProxy: httpsViaProxy, direct: httpsDirect };
  const tryGet = async (url, viaProxy) => {
    const u = new URL(url);
    const raw = viaProxy && proxy
      ? await t.viaProxy(u.hostname, u.pathname + u.search, proxy.host, proxy.port, timeoutMs + 4000)
      : await t.direct(u.hostname, u.pathname + u.search, timeoutMs);
    const j = JSON.parse(raw);
    const a = (j.Answer || []).find((r) => r.type === 1);
    return a ? String(rdataIp(a.data)) : null;
  };
  const rdataIp = (data) => {
    const m = /(\d+\.\d+\.\d+\.\d+)/.exec(String(data)); // DoH answers may be "xx.xx.xx.xx.in-addr..." escaped or plain
    return m ? m[1] : null;
  };
  // 1. system DNS
  try {
    const r = await Promise.race([dns.promises.resolve4(host), new Promise((_, rej) => setTimeout(() => rej(new Error('DNS 超时')), timeoutMs))]);
    if (r && r[0]) return r[0];
  } catch { /* fall through */ }
  // 2. DoH: cloudflare (via proxy if possible, else direct), then alidns direct
  for (const [url, via] of [['https://cloudflare-dns.com/dns-query', true], ['https://223.5.5.5/resolve', false]]) {
    try {
      const ip = await tryGet(`${url}?name=${encodeURIComponent(host)}&type=A`, via);
      if (ip) return ip;
    } catch { /* next */ }
  }
  return null;
}

/**
 * IP purity assessment derived purely from the ip.sb response (the reference project's
 * only IP API): classifies the ISP/ASN as datacenter/hosting vs residential carrier.
 * This is a transparent heuristic - NOT a third-party risk-database score - and the
 * UI labels it as such. Pure function.
 */
function assessPurity(geo) {
  if (!geo || geo.error) return null;
  const text = `${geo.isp || ''} ${geo.organization || ''} ${geo.asn_organization || ''}`.toLowerCase();
  const dcHits = ['amazon', 'aws', 'google', 'microsoft', 'azure', 'ovh', 'digitalocean', 'linode', 'akamai', 'vultr',
    'hetzner', 'oracle', 'alibaba', 'tencent', 'huawei cloud', 'byteplus', 'volcano', 'choopa', 'm247', 'leaseweb',
    'datacamp', 'datacamp london', 'contabo', 'scaleway', 'cloudflare', 'fastly', 'hostinger', 'namecheap', 'godaddy',
    'server', 'hosting', 'datacenter', 'data center', 'colo', 'cloud', 'vps', 'dedicated'].filter((k) => text.includes(k));
  const residentialHits = ['telecom', 'mobile communications', 'china telecom', 'china unicom', 'china mobile', 'comcast',
    'verizon', 'at&t', 'deutsche telekom', 'orange', 'vodafone', 'british telecom', 'kddi', 'ntt communications',
    'sk broadband', 'kt corp', 'charter', 'cox comm', 'telefonica', 'telekom', 'cable', 'isp', 'internet access'].filter((k) => text.includes(k));
  let score; let level; let basis;
  if (dcHits.length && dcHits.length >= residentialHits.length) { score = 40; level = '机房'; basis = `ISP/ASN 命中机房/云商标记（${dcHits[0]}…）`; }
  else if (residentialHits.length) { score = 95; level = '住宅'; basis = `ISP/ASN 为运营商网络（${residentialHits[0]}…）`; }
  else { score = 72; level = '一般'; basis = 'ISP/ASN 无法明确归类'; }
  return { score, level, basis, note: '基于 ip.sb 的 ISP/ASN 归属推断，非商业风控数据库评分' };
}

class GeoService {
  constructor({ userData, getProxy = () => null, transports = null, now = () => Date.now() }) {
    this.cacheFile = path.join(userData, 'geo-cache.json');
    this.getProxy = getProxy;
    this.t = transports || { viaProxy: (host, p, ph, pp, tm) => httpsViaProxy(host, p, ph, pp, tm), direct: (host, p, tm) => httpsDirect(host, p, tm) };
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
      try { raw = await this.t.viaProxy(GEO_HOST, reqPath, proxy.host, proxy.port); }
      catch (e) { raw = await this.t.direct(GEO_HOST, reqPath); } // proxy path failed: fall back to direct
    } else raw = await this.t.direct(GEO_HOST, reqPath);
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

  /** Self lookup (no ip = whatever the request egress is). direct=true forces the direct path. */
  async self({ direct = false } = {}) {
    const geo = await this._fetchJson('/geoip', { forceDirect: direct });
    return { ...geo, viaProxy: !direct && !!this.getProxy(), purity: assessPurity(geo) };
  }

  /** Resolve + locate a hostname (node servers). proxy comes from getProxy(). */
  async locate(host) {
    const proxy = this.getProxy();
    const ip = await resolveHost(host, { proxy });
    if (!ip) return { error: '域名解析失败（系统 DNS 与 DoH 均未返回结果）' };
    try { return { ip, ...(await this.lookup(ip)) }; } catch (e) { return { ip, error: e.message }; }
  }
}

module.exports = { GeoService, resolveHost, assessPurity, httpsViaProxy, httpsDirect, dechunk };
