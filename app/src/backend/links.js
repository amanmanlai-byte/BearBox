'use strict';
// Share-link parsers. Output objects follow the sing-box 1.14 outbound schema.
// Field mapping was cross-checked against the Jiajia native-src option structs and NativeCoreConfig.java.

const b64decode = (s) => {
  s = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
};
const isB64 = (s) => /^[A-Za-z0-9+/_=-]+$/.test(s.trim());
const truthy = (v) => v === '1' || v === 'true' || v === true;
const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const csv = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : undefined);

function tlsFrom(p, { host, forceEnabled = false, defaultSni } = {}) {
  const security = p.security || p.tls || '';
  const enabled = forceEnabled || security === 'tls' || security === 'reality' || security === '1' || security === 'true';
  if (!enabled) return undefined;
  const tls = { enabled: true };
  const sni = p.sni || p.peer || p.serverName || defaultSni || host;
  if (sni) tls.server_name = sni;
  if (truthy(p.allowInsecure) || truthy(p.insecure) || truthy(p.allow_insecure)) tls.insecure = true;
  const alpn = csv(p.alpn);
  if (alpn) tls.alpn = alpn;
  const fp = p.fp || p.fingerprint;
  if (fp || security === 'reality') tls.utls = { enabled: true, fingerprint: fp || 'chrome' };
  if (security === 'reality') tls.reality = { enabled: true, public_key: p.pbk || p.publicKey || '', short_id: p.sid || p.shortId || '' };
  return tls;
}

function transportFrom(p, host) {
  const type = p.type || p.net || 'tcp';
  const path = p.path || '/';
  const hostHeader = p.host || p.obfsParam || undefined;
  switch (type) {
    case 'ws': {
      const t = { type: 'ws', path };
      if (hostHeader) t.headers = { Host: hostHeader };
      const ed = /[?&]ed=(\d+)/.exec(path);
      if (ed) { t.max_early_data = parseInt(ed[1], 10); t.early_data_header_name = 'Sec-WebSocket-Protocol'; t.path = path.replace(/[?&]ed=\d+/, ''); }
      return t;
    }
    case 'grpc': return { type: 'grpc', service_name: p.serviceName || p.path || '' };
    case 'http': case 'h2': {
      const t = { type: 'http', path };
      if (hostHeader) t.host = csv(hostHeader);
      return t;
    }
    case 'httpupgrade': {
      const t = { type: 'httpupgrade', path };
      if (hostHeader) t.host = hostHeader;
      return t;
    }
    default: return undefined; // tcp
  }
}

const clean = (o) => { Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]); return o; };
const qs = (u) => Object.fromEntries(u.searchParams.entries());
const frag = (u, fallback) => { try { return decodeURIComponent(u.hash.replace(/^#/, '')) || fallback; } catch { return u.hash.replace(/^#/, '') || fallback; } };
const hostOf = (u) => u.hostname.replace(/^\[|\]$/g, '');

function parseVmess(link) {
  const body = link.slice('vmess://'.length);
  let j;
  try { j = JSON.parse(b64decode(body.split('#')[0])); } catch { throw new Error('invalid vmess link'); }
  const p = { net: j.net, type: j.net, host: j.host, path: j.path, security: j.tls, sni: j.sni, alpn: j.alpn, fp: j.fp, serviceName: j.path };
  if (j.net === 'grpc') p.type = 'grpc';
  const server = j.add;
  const out = {
    type: 'vmess', tag: j.ps || `${server}:${j.port}`, server, server_port: num(j.port, 443),
    uuid: j.id, security: j.scy || 'auto', alter_id: num(j.aid, 0),
    tls: tlsFrom({ ...p, security: j.tls === 'tls' ? 'tls' : '' }, { host: j.host || server }),
    transport: transportFrom(p, server),
  };
  if (out.tls && !j.sni && !j.host) out.tls.server_name = server;
  return clean(out);
}

function parseVless(link) {
  const u = new URL(link); const p = qs(u); const host = hostOf(u);
  const out = {
    type: 'vless', tag: frag(u, `${host}:${u.port}`), server: host, server_port: num(u.port, 443),
    uuid: decodeURIComponent(u.username), flow: p.flow || undefined,
    packet_encoding: p.packetEncoding || 'xudp',
    tls: tlsFrom(p, { host }), transport: transportFrom(p, host),
  };
  return clean(out);
}

function parseTrojan(link) {
  const u = new URL(link); const p = qs(u); const host = hostOf(u);
  const out = {
    type: 'trojan', tag: frag(u, `${host}:${u.port}`), server: host, server_port: num(u.port, 443),
    password: decodeURIComponent(u.username),
    tls: tlsFrom(p, { host, forceEnabled: true }), transport: transportFrom(p, host),
  };
  return clean(out);
}

/** trojan-go:// shares the trojan wire format; map ws/tls params onto a trojan outbound. */
function parseTrojanGo(link) {
  const u = new URL(link); const p = qs(u); const host = hostOf(u);
  const out = {
    type: 'trojan', tag: frag(u, `${host}:${u.port}`), server: host, server_port: num(u.port, 443),
    password: decodeURIComponent(u.username),
    tls: tlsFrom({ ...p, security: p.security || 'tls' }, { host, forceEnabled: true }),
    transport: transportFrom({ ...p, type: p.type || (p.path || p.host ? 'ws' : 'tcp') }, host),
  };
  return clean(out);
}

function parseSS(link) {
  let rest = link.slice('ss://'.length);
  let tag = '';
  const hi = rest.indexOf('#');
  if (hi >= 0) { try { tag = decodeURIComponent(rest.slice(hi + 1)); } catch { tag = rest.slice(hi + 1); } rest = rest.slice(0, hi); }
  let query = '';
  const qi = rest.indexOf('?');
  if (qi >= 0) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }
  rest = rest.replace(/\/$/, '');
  let userinfo; let hostport;
  if (rest.includes('@')) {
    const at = rest.lastIndexOf('@');
    userinfo = rest.slice(0, at); hostport = rest.slice(at + 1);
    if (!userinfo.includes(':')) userinfo = b64decode(userinfo); else userinfo = decodeURIComponent(userinfo);
  } else {
    const dec = b64decode(rest); const at = dec.lastIndexOf('@');
    if (at < 0) throw new Error('invalid ss link');
    userinfo = dec.slice(0, at); hostport = dec.slice(at + 1);
  }
  const ci = userinfo.indexOf(':');
  const method = userinfo.slice(0, ci); const password = userinfo.slice(ci + 1);
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(hostport);
  if (!m) throw new Error('invalid ss host');
  const out = { type: 'shadowsocks', tag: tag || `${m[1]}:${m[2]}`, server: m[1], server_port: parseInt(m[2], 10), method, password };
  const params = new URLSearchParams(query);
  const plugin = params.get('plugin');
  if (plugin) {
    const [name, ...opts] = decodeURIComponent(plugin).split(';');
    out.plugin = name === 'simple-obfs' ? 'obfs-local' : name;
    out.plugin_opts = opts.join(';');
  }
  return clean(out);
}

function parseHy2(link) {
  const u = new URL(link.replace(/^hy2:/, 'hysteria2:')); const p = qs(u); const host = hostOf(u);
  const out = {
    type: 'hysteria2', tag: frag(u, `${host}:${u.port}`), server: host, server_port: num(u.port, 443),
    password: decodeURIComponent(u.username + (u.password ? ':' + u.password : '')),
    tls: tlsFrom({ ...p, security: 'tls' }, { host, forceEnabled: true }),
  };
  if (p.obfs) out.obfs = { type: p.obfs, password: p['obfs-password'] || '' };
  if (p.mport) out.server_ports = String(p.mport).split(',').map((x) => x.replace('-', ':'));
  return clean(out);
}

function parseTuic(link) {
  const u = new URL(link); const p = qs(u); const host = hostOf(u);
  const out = {
    type: 'tuic', tag: frag(u, `${host}:${u.port}`), server: host, server_port: num(u.port, 443),
    uuid: decodeURIComponent(u.username), password: decodeURIComponent(u.password || ''),
    congestion_control: p.congestion_control || 'bbr', udp_relay_mode: p.udp_relay_mode || undefined,
    tls: tlsFrom({ ...p, security: 'tls' }, { host, forceEnabled: true }),
  };
  return clean(out);
}

function parseSocksHttp(link) {
  const u = new URL(link); const host = hostOf(u); const isHttp = /^https?:/.test(link);
  let user = decodeURIComponent(u.username); let pass = decodeURIComponent(u.password);
  if (!pass && user && isB64(user) && !isHttp) { try { const d = b64decode(user); if (d.includes(':')) [user, pass] = [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]; } catch { /* keep */ } }
  const out = {
    type: isHttp ? 'http' : 'socks', tag: frag(u, `${host}:${u.port}`), server: host,
    server_port: num(u.port, isHttp ? (link.startsWith('https') ? 443 : 80) : 1080),
    username: user || undefined, password: pass || undefined,
  };
  if (!isHttp) out.version = '5';
  if (link.startsWith('https:')) out.tls = { enabled: true, server_name: host };
  return clean(out);
}

const PARSERS = [
  [/^vmess:\/\//i, parseVmess], [/^vless:\/\//i, parseVless], [/^trojan-go:\/\//i, parseTrojanGo], [/^trojan:\/\//i, parseTrojan],
  [/^ss:\/\//i, parseSS], [/^(hysteria2|hy2):\/\//i, parseHy2], [/^tuic:\/\//i, parseTuic],
  [/^(socks5?|socks4a?|https?):\/\//i, parseSocksHttp],
];

function parseLink(line) {
  const s = line.trim();
  for (const [re, fn] of PARSERS) if (re.test(s)) return fn(s);
  throw new Error('unsupported link: ' + s.slice(0, 24));
}

/** Parse many lines; returns { nodes, errors }. Unsupported lines are reported, never silently dropped. */
function parseLinks(text) {
  const nodes = []; const errors = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    try { nodes.push(parseLink(line)); } catch (e) { errors.push({ line: line.slice(0, 60), error: e.message }); }
  }
  return { nodes, errors };
}

module.exports = { parseLink, parseLinks, b64decode, isB64 };
