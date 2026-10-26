'use strict';
const yaml = require('js-yaml');
const { parseLinks, b64decode, isB64 } = require('./links');

const NODE_TYPES = new Set(['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'socks', 'http', 'anytls', 'shadowtls', 'ssh', 'naive', 'hysteria', 'wireguard']);

function fromSingBoxJson(obj) {
  const list = Array.isArray(obj.outbounds) ? obj.outbounds : [];
  const nodes = list.filter((o) => o && NODE_TYPES.has(o.type) && o.tag).map((o) => ({ ...o }));
  return { nodes, errors: [] };
}

/** SIP008 (shadowsocks.org subscription spec): {version, servers:[{server,server_port,method,password,remarks}]} */
function fromSip008(obj) {
  const servers = Array.isArray(obj.servers) ? obj.servers : [];
  const nodes = []; const errors = [];
  for (const s of servers) {
    if (!s || !s.server || !s.server_port || !s.method || s.password == null) { errors.push({ line: s && s.server, error: 'SIP008 条目缺少必要字段' }); continue; }
    nodes.push({ type: 'shadowsocks', tag: s.remarks || s.remark || `${s.server}:${s.server_port}`, server: String(s.server), server_port: Number(s.server_port), method: String(s.method), password: String(s.password) });
  }
  return { nodes, errors };
}

function clashTls(c, host) {
  if (!(c.tls || c.security === 'tls')) return undefined;
  const tls = { enabled: true, server_name: c.servername || c.sni || host };
  if (c['skip-cert-verify']) tls.insecure = true;
  if (Array.isArray(c.alpn)) tls.alpn = c.alpn;
  if (c['client-fingerprint']) tls.utls = { enabled: true, fingerprint: c['client-fingerprint'] };
  const ro = c['reality-opts'];
  if (ro) { tls.reality = { enabled: true, public_key: ro['public-key'], short_id: ro['short-id'] || '' }; tls.utls = tls.utls || { enabled: true, fingerprint: 'chrome' }; }
  return tls;
}

function clashTransport(c) {
  const net = c.network;
  if (net === 'ws') {
    const o = c['ws-opts'] || {};
    const t = { type: 'ws', path: o.path || '/' };
    if (o.headers && (o.headers.Host || o.headers.host)) t.headers = { Host: o.headers.Host || o.headers.host };
    return t;
  }
  if (net === 'grpc') return { type: 'grpc', service_name: (c['grpc-opts'] || {})['grpc-service-name'] || '' };
  if (net === 'h2') { const o = c['h2-opts'] || {}; return { type: 'http', path: o.path || '/', host: [].concat(o.host || []) }; }
  return undefined;
}

function fromClash(doc) {
  const nodes = []; const errors = [];
  for (const c of doc.proxies || []) {
    try {
      const base = { tag: String(c.name), server: c.server, server_port: Number(c.port) };
      let o;
      switch (c.type) {
        case 'ss': o = { type: 'shadowsocks', ...base, method: c.cipher, password: String(c.password) };
          if (c.plugin) { o.plugin = c.plugin === 'obfs' ? 'obfs-local' : c.plugin; const po = c['plugin-opts'] || {}; o.plugin_opts = Object.entries(po).map(([k, v]) => `${k === 'mode' ? 'obfs' : k === 'host' ? 'obfs-host' : k}=${v}`).join(';'); }
          break;
        case 'vmess': o = { type: 'vmess', ...base, uuid: c.uuid, security: c.cipher || 'auto', alter_id: c.alterId || 0, tls: clashTls(c, c.server), transport: clashTransport(c) }; break;
        case 'vless': o = { type: 'vless', ...base, uuid: c.uuid, flow: c.flow || undefined, packet_encoding: 'xudp', tls: clashTls({ ...c, tls: c.tls }, c.server), transport: clashTransport(c) }; break;
        case 'trojan': o = { type: 'trojan', ...base, password: String(c.password), tls: clashTls({ ...c, tls: true }, c.server), transport: clashTransport(c) }; break;
        case 'hysteria2': o = { type: 'hysteria2', ...base, password: String(c.password), tls: { enabled: true, server_name: c.sni || c.server, insecure: !!c['skip-cert-verify'] || undefined } };
          if (c.obfs) o.obfs = { type: c.obfs, password: c['obfs-password'] || '' };
          break;
        case 'tuic': o = { type: 'tuic', ...base, uuid: c.uuid, password: String(c.password || ''), congestion_control: c['congestion-controller'] || 'bbr', tls: { enabled: true, server_name: c.sni || c.server, insecure: !!c['skip-cert-verify'] || undefined } }; break;
        case 'socks5': o = { type: 'socks', version: '5', ...base, username: c.username, password: c.password }; break;
        case 'http': o = { type: 'http', ...base, username: c.username, password: c.password, tls: c.tls ? { enabled: true, server_name: c.sni || c.server } : undefined }; break;
        default: errors.push({ line: `${c.name}`, error: `unsupported clash type: ${c.type}` }); continue;
      }
      Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
      nodes.push(o);
    } catch (e) { errors.push({ line: String(c && c.name), error: e.message }); }
  }
  return { nodes, errors };
}

/** Decode raw subscription body into nodes. Order: sing-box JSON, SIP008, JSON array of links,
 *  Clash YAML, base64 list, plain link list. */
function parseSubscriptionBody(body) {
  const text = String(body).replace(/^\uFEFF/, '').trim();
  if (!text) return { nodes: [], errors: [{ line: '', error: 'empty subscription' }], format: 'empty' };
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      if (j.outbounds) return { ...fromSingBoxJson(j), format: 'sing-box' };
      if (Array.isArray(j.servers)) return { ...fromSip008(j), format: 'sip008' };
    } catch { /* fall through */ }
  }
  if (text.startsWith('[')) {
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j) && j.every((x) => typeof x === 'string')) return { ...parseLinks(j.join('\n')), format: 'links' };
      if (Array.isArray(j) && j.every((x) => x && typeof x === 'object')) return { ...fromSip008({ servers: j }), format: 'sip008' };
    } catch { /* fall through */ }
  }
  if (/^\s*(proxies|port|mixed-port|proxy-groups)\s*:/m.test(text)) {
    try { const d = yaml.load(text); if (d && d.proxies) return { ...fromClash(d), format: 'clash' }; } catch { /* fall through */ }
  }
  if (!text.includes('://') && isB64(text.replace(/\s+/g, ''))) {
    try { const dec = b64decode(text.replace(/\s+/g, '')); const r = parseLinks(dec); if (r.nodes.length || r.errors.length) return { ...r, format: 'base64' }; } catch { /* fall through */ }
  }
  return { ...parseLinks(text), format: 'links' };
}

/** 'upload=1; download=2; total=3; expire=4' header (same fields the Android SubscriptionInfo reads). */
function parseUserInfo(h) {
  if (!h) return null;
  const o = {};
  for (const part of String(h).split(';')) { const [k, v] = part.split('=').map((s) => s && s.trim()); if (k && v && /^\d+$/.test(v)) o[k] = Number(v); }
  if (o.total === undefined && o.upload === undefined && o.download === undefined) return null;
  return { upload: o.upload || 0, download: o.download || 0, total: o.total || 0, expire: o.expire || 0 };
}

/** Make tags unique within a node list while keeping them readable. */
function dedupeTags(nodes, reserved = []) {
  const seen = new Set(reserved);
  for (const n of nodes) {
    let t = n.tag || `${n.server}:${n.server_port}`; let i = 1; const base = t;
    while (seen.has(t)) t = `${base} #${++i}`;
    n.tag = t; seen.add(t);
  }
  return nodes;
}

// Many airport panels block unknown User-Agents (403 "The User-Agent has been blocked").
// Proxy-client UAs are the industry whitelist; try them in order before giving up.
const SUB_UA_CHAIN = ['clash.meta/1.18.0', 'v2rayN/6.23', 'Shadowrocket/2072', 'JiajiaBox/0.4 (Windows)'];

async function fetchSubscription(url, { userAgent = null, timeoutMs = 20000, allowInsecure = false } = {}) {
  const chain = userAgent ? [userAgent] : SUB_UA_CHAIN;
  let lastErr = null;
  for (const ua of chain) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: '*/*' }, signal: ctl.signal, redirect: 'follow' });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}（服务器拒绝了 User-Agent "${ua}"）`); continue; }
      const body = await res.text();
      if (!body.trim()) { lastErr = new Error(`HTTP 200 但内容为空（UA "${ua}"）`); continue; }
      const info = parseUserInfo(res.headers.get('subscription-userinfo'));
      return { body, info };
    } catch (e) { lastErr = e; }
    finally { clearTimeout(timer); }
  }
  throw lastErr || new Error('订阅下载失败');
}

module.exports = { parseSubscriptionBody, parseUserInfo, dedupeTags, fetchSubscription };
