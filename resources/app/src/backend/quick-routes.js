'use strict';
// Curated 2026-10-26. Primary sources and shared-endpoint limits: docs/QUICK_ROUTING.md.
const CATALOG = [
  { id: 'telegram', name: 'Telegram', domains: ['telegram.org', 'telegram.me', 't.me', 'tdesktop.com', 'telegra.ph', 'telesco.pe', 'telegram-cdn.org'], ips: ['91.108.56.0/22','91.108.4.0/22','91.108.8.0/22','91.108.16.0/22','91.108.12.0/22','149.154.160.0/20','91.105.192.0/23','91.108.20.0/22','185.76.151.0/24','2001:b28:f23d::/48','2001:b28:f23f::/48','2001:67c:4e8::/48','2001:b28:f23c::/48','2a0a:f280::/32'] },
  { id: 'chatgpt', name: 'ChatGPT', domains: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com', 'oaistatsig.com', 'openaimerge.com'] },
  { id: 'codex', name: 'Codex', domains: ['api.openai.com', 'codex.openai.com', 'codex.chatgpt.com'], processes: ['codex.exe', 'codex'] },
  { id: 'claude', name: 'Claude', domains: ['claude.ai', 'claude.com', 'anthropic.com', 'claudeusercontent.com'] },
  { id: 'claudeCode', name: 'Claude Code', domains: ['api.anthropic.com', 'platform.claude.com', 'code.claude.com', 'downloads.claude.ai'], processes: ['claude.exe', 'claude'] },
  { id: 'grok', name: 'Grok', domains: ['grok.com', 'x.ai'] },
  { id: 'gemini', name: 'Gemini', domains: ['gemini.google.com', 'aistudio.google.com', 'generativelanguage.googleapis.com', 'alkalimakersuite-pa.clients6.google.com', 'makersuite.google.com'] },
];
const IDS = ['allAI', ...CATALOG.map((p) => p.id)];
function resolveQuickRoutes(saved = {}, nodes = []) {
  const resolved = {}; const warnings = [];
  for (const id of IDS) {
    const p = saved[id]; if (!p?.enabled) continue;
    let tag = 'proxy';
    if (p.target) {
      const n = nodes.find((n) => n.subId === p.target.subId && n.outbound.tag === p.target.tag);
      if (n) tag = n.outbound.tag;
      else warnings.push(`快捷分流 ${id} 的节点已失效，临时跟随当前代理节点，请重新选择`);
    }
    resolved[id] = { enabled: true, tag };
  }
  return { resolved, warnings };
}
function quickRules(resolved = {}) {
  const rules = [];
  // Specific CLI/API overrides before broad provider-domain matches.
  const order = ['codex', 'claudeCode', 'telegram', 'chatgpt', 'claude', 'grok', 'gemini'];
  for (const id of order) {
    const p = CATALOG.find((p) => p.id === id);
    const setting = resolved[id] || (id !== 'telegram' ? resolved.allAI : null);
    if (!setting?.enabled) continue;
    const outbound = setting.tag;
    if (p.processes) rules.push({ process_name: p.processes, outbound });
    rules.push({ domain_suffix: p.domains, outbound });
    if (p.ips) rules.push({ ip_cidr: p.ips, outbound });
  }
  return rules;
}
module.exports = { CATALOG, IDS, resolveQuickRoutes, quickRules };
