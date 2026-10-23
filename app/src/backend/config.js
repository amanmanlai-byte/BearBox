'use strict';
// Builds a sing-box 1.14 config. Tag names (mixed-in, tun-in, dns-remote, dns-direct, proxy, direct) follow the
// Android ConfigBuilderKt constants found in smali. Defaults come from res/xml/global_preferences.xml.

const DEFAULT_SETTINGS = {
  mixedPort: 2080,
  allowAccess: false,          // 允许来自局域网的连接
  bypassLan: true,             // 绕过局域网地址
  mode: 'rule',                // rule | global
  trafficSniffing: true,       // 启用流量探测
  remoteDns: 'https://dns.google/dns-query',
  directDns: 'https://223.5.5.5/dns-query',
  ipv6Mode: 'prefer_ipv4',     // prefer_ipv4 | prefer_ipv6 | ipv4_only | ipv6_only
  connectionTestURL: 'https://cp.cloudflare.com/generate_204', // the Jiajia core's Clash API ignores http:// test URLs (clashapi/proxies.go), so https is required
  logLevel: 'info',
  apiPort: 9090,
  tun: false,                  // TUN mode (needs admin + wintun.dll on Windows; not verified in the sandbox)
  mtu: 9000,
  setSystemProxy: true,
  autoStartCore: false,
  rulesProviderBase: 'https://raw.githubusercontent.com/SagerNet',
};

function parseDnsAddress(addr, tag, extra = {}) {
  const raw = String(addr || '').trim();
  if (!raw || raw === 'local') return { type: 'local', tag, ...extra };
  let m;
  const withScheme = raw.includes('://') ? raw : `udp://${raw}`;
  let u;
  try { u = new URL(withScheme); } catch { throw new Error(`Invalid DNS address: ${addr}`); }
  const type = u.protocol.replace(':', '');
  if (!['udp', 'tcp', 'tls', 'https', 'quic', 'h3'].includes(type)) throw new Error(`Unsupported DNS scheme: ${type}`);
  const s = { type, tag, server: u.hostname.replace(/^\[|\]$/g, ''), ...extra };
  if (u.port) s.server_port = parseInt(u.port, 10);
  if ((type === 'https' || type === 'h3') && u.pathname && u.pathname !== '/') s.path = u.pathname + u.search;
  return s;
}

const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':');

/** Map the Android route-rule fields (domain/ip/port/source/network/protocol) to a sing-box rule. */
function userRuleToSingBox(r) {
  const rule = {}; const warns = [];
  const lines = (v) => String(v || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const dom = lines(r.domain);
  for (const d of dom) {
    if (d.startsWith('full:')) (rule.domain ||= []).push(d.slice(5));
    else if (d.startsWith('keyword:')) (rule.domain_keyword ||= []).push(d.slice(8));
    else if (d.startsWith('regexp:')) (rule.domain_regex ||= []).push(d.slice(7));
    else if (d.startsWith('geosite:')) warns.push(`rule '${r.name || ''}': ${d} needs a rule-set, skipped`);
    else (rule.domain_suffix ||= []).push(d.replace(/^domain:/, ''));
  }
  for (const ip of lines(r.ip)) {
    if (ip.startsWith('geoip:')) warns.push(`rule '${r.name || ''}': ${ip} needs a rule-set, skipped`);
    else (rule.ip_cidr ||= []).push(ip);
  }
  for (const ip of lines(r.sourceIp)) (rule.source_ip_cidr ||= []).push(ip);
  const ports = (v, single, range, key) => { for (const p of lines(v)) { if (/^\d+$/.test(p)) (rule[single] ||= []).push(+p); else if (/^\d+[-:]\d*$|^\d*[-:]\d+$/.test(p)) (rule[range] ||= []).push(p.replace('-', ':')); } void key; };
  ports(r.port, 'port', 'port_range');
  ports(r.sourcePort, 'source_port', 'source_port_range');
  if (r.network && r.network !== 'any') rule.network = r.network;
  const protos = lines(r.protocol); if (protos.length) rule.protocol = protos;
  if (r.processName) rule.process_name = lines(r.processName);
  if (Object.keys(rule).length === 0) return { rule: null, warns: warns.length ? warns : [`rule '${r.name || ''}' has no conditions, skipped`] };
  if (r.outbound === 'block') rule.action = 'reject';
  else rule.outbound = r.outbound === 'direct' ? 'direct' : 'proxy';
  return { rule, warns };
}

function buildConfig({ nodes, selectedTag, settings = {}, userRules = [], secret = '', cachePath = 'cache.db' }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const warnings = [];
  if (!nodes || nodes.length === 0) throw new Error('No nodes available');
  const tags = nodes.map((n) => n.tag);
  const sel = tags.includes(selectedTag) ? selectedTag : tags[0];

  // DNS
  const dnsRemote = parseDnsAddress(s.remoteDns, 'dns-remote', { detour: 'proxy' });
  const dnsDirect = parseDnsAddress(s.directDns, 'dns-direct');
  const servers = [dnsDirect, dnsRemote, { type: 'local', tag: 'dns-local' }];
  if (dnsRemote.server && !isIp(dnsRemote.server)) dnsRemote.domain_resolver = 'dns-direct';
  if (dnsDirect.server && !isIp(dnsDirect.server)) dnsDirect.domain_resolver = 'dns-local';

  const nodeHosts = [...new Set(nodes.map((n) => n.server).filter((h) => h && !isIp(h)))];
  const dnsRules = [];
  if (nodeHosts.length) dnsRules.push({ domain: nodeHosts, server: 'dns-direct' });
  if (s.mode === 'rule') dnsRules.push({ rule_set: ['geosite-cn'], server: 'dns-direct' });
  const dns = { servers, rules: dnsRules, final: 'dns-remote', strategy: s.ipv6Mode === 'ipv4_only' ? 'ipv4_only' : s.ipv6Mode === 'ipv6_only' ? 'ipv6_only' : s.ipv6Mode, independent_cache: true };

  // Inbounds
  const inbounds = [{ type: 'mixed', tag: 'mixed-in', listen: s.allowAccess ? '0.0.0.0' : '127.0.0.1', listen_port: Number(s.mixedPort) }];
  if (s.tun) inbounds.push({ type: 'tun', tag: 'tun-in', address: ['172.19.0.1/28', 'fdfe:dcba:9876::1/126'], mtu: Number(s.mtu) || 9000, auto_route: true, strict_route: true, stack: 'mixed' });

  // Route
  const rules = [];
  if (s.trafficSniffing) rules.push({ action: 'sniff' });
  rules.push({ protocol: 'dns', action: 'hijack-dns' });
  if (s.bypassLan) rules.push({ ip_is_private: true, outbound: 'direct' });
  for (const ur of userRules.filter((r) => r.enabled !== false)) {
    const { rule, warns } = userRuleToSingBox(ur); warnings.push(...warns); if (rule) rules.push(rule);
  }
  const ruleSets = [];
  if (s.mode === 'rule') {
    rules.push({ rule_set: ['geosite-cn', 'geoip-cn'], outbound: 'direct' });
    const base = s.rulesProviderBase.replace(/\/$/, '');
    ruleSets.push(
      { type: 'remote', tag: 'geosite-cn', format: 'binary', url: `${base}/sing-geosite/rule-set/geosite-cn.srs`, download_detour: 'proxy', update_interval: '7d' },
      { type: 'remote', tag: 'geoip-cn', format: 'binary', url: `${base}/sing-geoip/rule-set/geoip-cn.srs`, download_detour: 'proxy', update_interval: '7d' },
    );
  }
  const route = { rules, final: 'proxy', default_domain_resolver: { server: 'dns-direct' }, auto_detect_interface: true };
  if (ruleSets.length) route.rule_set = ruleSets;

  const outbounds = [
    ...nodes.map((n) => { const o = { ...n }; delete o._meta; return o; }),
    { type: 'selector', tag: 'proxy', outbounds: tags, default: sel },
    { type: 'direct', tag: 'direct' },
  ];

  const config = {
    log: { level: s.logLevel, timestamp: true },
    dns, inbounds, outbounds, route,
    experimental: {
      clash_api: { external_controller: `127.0.0.1:${s.apiPort}`, secret },
      cache_file: { enabled: true, path: cachePath },
    },
  };
  return { config, warnings, selected: sel };
}

module.exports = { buildConfig, DEFAULT_SETTINGS, parseDnsAddress, userRuleToSingBox };
