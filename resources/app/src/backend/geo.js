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
          const chunks = [];
          tlsSock.on('data', (chunk) => chunks.push(chunk));
          tlsSock.once('close', () => {
            const response = Buffer.concat(chunks); const hi = response.indexOf('\r\n\r\n');
            if (hi < 0) return reject(new Error('HTTPS 响应不完整'));
            const headers = response.subarray(0, hi).toString('latin1');
            const payload = response.subarray(hi + 4);
            let out = /transfer-encoding:\s*chunked/i.test(headers) ? dechunk(payload) : payload.toString('utf8');
            const statusLine = (headers.split('\r\n')[0] || '').trim();
            const sm = /HTTP\/1\.[01]\s+(\d+)/.exec(statusLine);
            const sc = sm ? parseInt(sm[1], 10) : 0;
            if (sc >= 200 && sc < 300) resolve(out); else reject(new Error('HTTP ' + (sc || statusLine)));
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
  const chunks = []; let rest = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  for (;;) {
    const nl = rest.indexOf('\r\n'); if (nl < 0) throw new Error('分块响应不完整');
    const size = parseInt(rest.subarray(0, nl).toString(), 16);
    if (!Number.isFinite(size) || size < 0) throw new Error('无效分块长度');
    if (!size) break;
    if (rest.length < nl + 2 + size + 2) throw new Error('分块响应截断');
    chunks.push(rest.subarray(nl + 2, nl + 2 + size)); rest = rest.subarray(nl + 2 + size + 2);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function httpsDirect(host, reqPath, timeoutMs = 10000) {
  const res = await fetch(`https://${host}${reqPath}`, { headers: { 'User-Agent': 'JiajiaBox/0.4', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const isIpLiteral = (host) => net.isIP(String(host || '')) !== 0;
const familiesFor = (strategy) => strategy === 'ipv6_only' ? [6] : strategy === 'ipv4_only' ? [4] : strategy === 'prefer_ipv6' ? [6, 4] : [4, 6];
const canonicalIp = (ip) => net.isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname : ip;

/** Resolve real A/AAAA records in the selected order; never return a synthetic IP. */
async function resolveHost(host, { proxy = null, transports = null, timeoutMs = 4000, strategy = 'prefer_ipv4' } = {}) {
  if (!host) return null;
  if (isIpLiteral(host)) return familiesFor(strategy).includes(net.isIP(host)) ? host : null;
  const t = transports || { viaProxy: httpsViaProxy, direct: httpsDirect };
  const valid = (ip, family) => net.isIP(ip) === family && !/^198\.(18|19)\./.test(ip) && !/^(fc|fd)/i.test(ip);
  for (const family of familiesFor(strategy)) {
    let timer;
    try {
      const resolver = t.resolve || ((name, f) => f === 6 ? dns.promises.resolve6(name) : dns.promises.resolve4(name));
      const records = await Promise.race([resolver(host, family), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS 超时')), timeoutMs); })]);
      const ip = records.find((ip) => valid(ip, family)); if (ip) return ip;
    } catch { /* try DoH */ } finally { clearTimeout(timer); }
    for (const [server, via] of [['cloudflare-dns.com', true], ['223.5.5.5', false]]) {
      try {
        const req = `${server === '223.5.5.5' ? '/resolve' : '/dns-query'}?name=${encodeURIComponent(host)}&type=${family === 6 ? 'AAAA' : 'A'}`;
        const raw = via && proxy ? await t.viaProxy(server, req, proxy.host, proxy.port, timeoutMs) : await t.direct(server, req, timeoutMs);
        const record = (JSON.parse(raw).Answer || []).find((r) => r.type === (family === 6 ? 28 : 1) && valid(String(r.data), family));
        if (record) return String(record.data);
      } catch { /* next resolver */ }
    }
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
  let score; let level; let basis; let hits;
  if (dcHits.length && dcHits.length >= residentialHits.length) { score = 40; level = '机房'; hits = dcHits; basis = `ISP/ASN 命中机房/云商标记（${dcHits.slice(0, 3).join('、')}）`; }
  else if (residentialHits.length) { score = 95; level = '住宅'; hits = residentialHits; basis = `ISP/ASN 为运营商网络（${residentialHits.slice(0, 3).join('、')}）`; }
  else { score = 72; level = '一般'; hits = []; basis = 'ISP/ASN 无法明确归类'; }
  return {
    score, level, basis, hits,
    isp: geo.isp || '', org: geo.organization || '', asnOrg: geo.asn_organization || '',
    asn: geo.asn || null,
    note: '基于 ip.sb 的 ISP/ASN 归属推断，非商业风控数据库评分。可在 ip.sb 查证此 IP。',
  };
}

const IP_COFFEE_HOST = 'ip.net.coffee';

/**
 * Real IP purity/risk lookup via ip.net.coffee (the user's requested API).
 * Returns trust_score (0-100, higher = better), risk flags (vpn/proxy/tor/abuser/
 * datacenter/residential/mobile/crawler), company info, and an AI verdict.
 * Falls back to the keyword heuristic if the API is unreachable.
 */
async function lookupPurity(ip, { proxy = null, transports = null, timeoutMs = 12000 } = {}) {
  const t = transports || { viaProxy: httpsViaProxy, direct: httpsDirect };
  const path = `/api/ip/lookup/${encodeURIComponent(ip)}`;
  let raw;
  if (proxy) {
    try { raw = await t.viaProxy(IP_COFFEE_HOST, path, proxy.host, proxy.port, timeoutMs); }
    catch (e) { raw = await t.direct(IP_COFFEE_HOST, path, timeoutMs); }
  } else raw = await t.direct(IP_COFFEE_HOST, path, timeoutMs);
  const j = JSON.parse(raw);
  if (!j || typeof j !== 'object') throw new Error('ip.net.coffee 返回无效数据');
  const flags = [];
  if (j.is_tor) flags.push('Tor 出口节点');
  if (j.is_vpn) flags.push('VPN');
  if (j.is_proxy) flags.push('代理');
  if (j.is_abuser) flags.push('历史滥用记录');
  if (j.is_crawler) flags.push('爬虫标记');
  const type = j.is_datacenter ? '机房/云商' : j.isResidential ? '住宅' : j.is_mobile ? '移动蜂窝' : j.company_type || '未知';
  // User instruction: trust_score IS the total score. Display it directly, no recalculation.
  const score = typeof j.trust_score === 'number' ? j.trust_score : null;
  const level = flags.length > 0 ? '风险'
    : j.is_datacenter || j.company_type === 'hosting' ? '机房'
    : j.isResidential ? '住宅'
    : j.is_mobile ? '移动' : '一般';
  return {
    score, level, flags, type,
    company: j.company_name || j.asOrganization || '',
    asn: j.asn || null,
    trustScore: j.trust_score,
    redditBlocked: j.reddit_blocked === true,
    abuserScore: (j.intelligence || {}).abuser_score_raw || j.abuser_score || '',
    abuserLevel: (j.intelligence || {}).abuser_level || '',
    threats: Array.isArray((j.intelligence || {}).threats) ? (j.intelligence || {}).threats : [],
    aiVerdict: j.ai_verdict ? { label: j.ai_verdict.label, confidence: j.ai_verdict.confidence, reasoning: j.ai_verdict.reasoning } : null,
    rawData: { is_datacenter: j.is_datacenter, isResidential: j.isResidential, is_vpn: j.is_vpn, is_proxy: j.is_proxy, is_tor: j.is_tor, is_abuser: j.is_abuser, is_mobile: j.is_mobile, is_crawler: j.is_crawler, company_type: j.company_type },
    source: 'ip.net.coffee',
    note: '来自 ip.net.coffee 真实风控数据库，非关键词推断',
  };
}

class GeoService {
  constructor({ userData, getProxy = () => null, getStrategy = () => 'prefer_ipv4', transports = null, now = () => Date.now() }) {
    this.cacheFile = path.join(userData, 'geo-cache.json');
    this.getProxy = getProxy; this.getStrategy = getStrategy; this.inflight = new Map();
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

  async _request(host, reqPath, forceDirect = false) {
    const proxy = forceDirect ? null : this.getProxy();
    return proxy ? this.t.viaProxy(host, reqPath, proxy.host, proxy.port, 6000) : this.t.direct(host, reqPath, 6000);
  }

  async _fetchJson(reqPath, { forceDirect = false, expectedIp = null } = {}) {
    let raw;
    try { raw = await this._request(GEO_HOST, reqPath, forceDirect); }
    catch (error) {
      // An explicit IP lookup is safe to retry directly. Self detection must never
      // label a direct-path IP as the proxy exit.
      if (!expectedIp || forceDirect || !this.getProxy()) throw error;
      raw = await this._request(GEO_HOST, reqPath, true);
    }
    const j = JSON.parse(raw);
    if (!j || !net.isIP(j.ip) || !/^[A-Z]{2}$/.test(j.country_code || '')) throw new Error('定位服务未返回有效 IP 和国家');
    if (expectedIp && canonicalIp(j.ip) !== canonicalIp(expectedIp)) throw new Error('定位返回的 IP 与查询目标不一致');
    return { ip: j.ip, country: j.country, country_code: j.country_code, region: j.region, city: j.city, isp: j.isp || j.organization, asn: j.asn,
      latitude: Number.isFinite(j.latitude) && Math.abs(j.latitude) <= 90 ? j.latitude : null,
      longitude: Number.isFinite(j.longitude) && Math.abs(j.longitude) <= 180 ? j.longitude : null };
  }

  /** Cached, deduplicated and paced requests; a slow query cannot block the batch. */
  lookup(ip) {
    if (!net.isIP(ip)) return Promise.reject(new Error('无效的 IP 地址'));
    this._load();
    const hit = this.cache[ip];
    if (hit && /^[A-Z]{2}$/.test(hit.geo?.country_code || '') && this.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.geo);
    if (this.inflight.has(ip)) return this.inflight.get(ip);
    const scheduled = this._queue.catch(() => {}).then(() => ({ task: (async () => {
      const geo = await this._fetchJson(`/geoip/${encodeURIComponent(ip)}`, { expectedIp: ip });
      this.cache[ip] = { ts: this.now(), geo }; this._flush(); return geo;
    })() }));
    this._queue = scheduled.then(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const task = scheduled.then((result) => result.task).finally(() => this.inflight.delete(ip));
    this.inflight.set(ip, task); return task;
  }

  async self({ direct = false } = {}) {
    const strategy = this.getStrategy(); const errors = [];
    for (const family of familiesFor(strategy)) {
      try {
        const host = family === 6 ? 'api-ipv6.ip.sb' : 'api-ipv4.ip.sb';
        const ip = (await this._request(host, '/ip', direct)).trim();
        if (net.isIP(ip) !== family) throw new Error(`检测服务未返回 IPv${family} 地址`);
        const geo = await this._fetchJson(`/geoip/${encodeURIComponent(ip)}`, { forceDirect: direct, expectedIp: ip });
        return { ...geo, viaProxy: !direct && !!this.getProxy(), ipVersion: family, strategy, purity: assessPurity(geo) };
      } catch (error) { errors.push(`IPv${family}: ${error.message}`); }
    }
    throw new Error(errors.join('；'));
  }

  /** Resolve + locate a hostname (node servers). proxy comes from getProxy(). */
  async locate(host) {
    const proxy = this.getProxy();
    const ip = await resolveHost(host, { proxy, strategy: this.getStrategy() });
    if (!ip) return { error: '域名解析失败（系统 DNS 与 DoH 均未返回结果）' };
    try { return { ip, ...(await this.lookup(ip)) }; } catch (e) { return { ip, error: e.message }; }
  }
}

module.exports = { GeoService, resolveHost, assessPurity, lookupPurity, httpsViaProxy, httpsDirect, dechunk };
