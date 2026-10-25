'use strict';
const path = require('path');
const { EventEmitter } = require('events');
const { Store, dayKey } = require('./store');
const { Core, resolveCoreBinary, resolveRulesetDir, tcpPing } = require('./core');
const { buildConfig, DEFAULT_SETTINGS, parseRuleFile } = require('./config');
const { parseSubscriptionBody, dedupeTags, fetchSubscription } = require('./subscription');
const { parseLinks } = require('./links');
const { SystemProxy } = require('./sysproxy');
const { GeoService, resolveHost } = require('./geo');

// Settings that only affect the UI or app shell; changing them must not restart a running core.
const NO_RESTART_KEYS = ['setSystemProxy', 'autoStartCore', 'connectionTestURL', 'testConcurrency', 'theme', 'closeToTray', 'autoUpdateSubsMin', 'wallpaper', 'wallpaperOpacity', 'wallpaperVeil', 'wallpaperBlur', 'glassEnabled', 'glassOpacity'];
const LEGACY_TEST_URL = 'https://cp.cloudflare.com/generate_204'; // default before v0.2.2

class AppService extends EventEmitter {
  constructor({ userData, appRoot, resourcesPath, sysproxy, binary, fetchSub = fetchSubscription, autoUpdateTimer = null, core = null }) {
    super();
    this.store = new Store(path.join(userData, 'data.json'));
    this.core = core || new Core({ binary: binary || resolveCoreBinary(appRoot, resourcesPath), workDir: path.join(userData, 'core-run') });
    this.rulesetDir = resolveRulesetDir(appRoot, resourcesPath);
    this.geo = new GeoService({ userData, getProxy: () => (this.core.state === 'running' ? { host: '127.0.0.1', port: Number(this.d.settings.mixedPort) } : null) });
    this.sysproxy = sysproxy || new SystemProxy();
    this.fetchSub = fetchSub;
    this.proxyApplied = false; this.starting = false; this.lastError = null; this.coreVersion = null;
    this.routePreview = [];
    this._autoTimer = autoUpdateTimer || { set: (fn, ms) => { const t = setInterval(fn, ms); t.unref(); return t; }, clear: (t) => clearInterval(t) };
    this._autoHandle = null;
    this.core.on('log', (l) => this.emit('log', l));
    this.core.on('status', () => this.emit('state'));
    this.core.on('crashed', (code) => { this.lastError = `内核异常退出 (code ${code})`; this.cleanupProxy().finally(() => this.emit('state')); });
    this.core.on('tick', (t) => this.onTick(t));
  }

  get d() { return this.store.data; }

  async init() {
    this.coreVersion = await this.core.version();
    // migrate the pre-0.2.2 default test URL to the new one; only the untouched default is replaced
    if (this.d.settings.connectionTestURL === LEGACY_TEST_URL) { this.d.settings.connectionTestURL = DEFAULT_SETTINGS.connectionTestURL; this.store.save(); }
    // crash recovery: a previous run may have left the system proxy pointing at a dead port
    if (this.d.sysproxyBackup && this.core.state === 'stopped') { try { await this.sysproxy.disable(this.d.sysproxyBackup.backup); } catch { /* best effort */ } this.d.sysproxyBackup = null; this.store.save(); }
    this.scheduleAutoUpdate();
  }

  /** Background subscription auto-update. Interval comes from settings.autoUpdateSubsMin; 0 disables. */
  scheduleAutoUpdate() {
    if (this._autoHandle) { this._autoTimer.clear(this._autoHandle); this._autoHandle = null; }
    const min = Number(this.d.settings.autoUpdateSubsMin);
    if (!(min > 0)) return;
    this._autoHandle = this._autoTimer.set(() => {
      this.updateAllSubscriptions()
        .then((rs) => rs.forEach((r) => this.core.pushLog(`INFO 订阅自动更新${r.error ? '失败: ' + r.error : '完成: ' + r.count + ' 个节点'}`)))
        .catch((e) => this.core.pushLog('ERROR 订阅自动更新失败: ' + e.message));
    }, min * 60 * 1000);
  }

  // ---------- state ----------
  state() {
    const d = this.d; const today = d.daily[dayKey()] || { up: 0, down: 0 };
    // keep the effective-rule preview fresh even while the core is stopped (throws when there are no nodes)
    try { this.build(); } catch { this.routePreview = []; }
    return {
      core: { ...this.core.status(), version: this.coreVersion, binary: this.core.binary, error: this.lastError },
      proxyApplied: this.proxyApplied, sysproxySupported: this.sysproxy.supported,
      settings: d.settings, subscriptions: d.subscriptions, rules: d.rules,
      nodes: d.nodes.map((n) => ({ id: n.id, subId: n.subId, tag: n.outbound.tag, type: n.outbound.type, server: n.outbound.server, port: n.outbound.server_port, latency: n.latency ?? null, latencyKind: n.latencyKind || null, testedAt: n.testedAt || null })),
      selectedId: d.selectedId, today, daily: d.daily,
      routePreview: this.routePreview,
      session: { upTotal: this.core.upTotal, downTotal: this.core.downTotal, memory: this.core.memory },
      samples: this.core.samples.slice(-120),
    };
  }
  emitState() { this.emit('state'); }

  // ---------- subscriptions ----------
  _ingest(sub, parsed, replaceSubId) {
    const keepTag = this.d.nodes.find((n) => n.id === this.d.selectedId)?.outbound.tag;
    const others = this.d.nodes.filter((n) => n.subId !== (replaceSubId || sub.id));
    const reserved = others.map((n) => n.outbound.tag);
    const outs = dedupeTags(parsed.nodes.map((n) => ({ ...n })), reserved);
    const fresh = outs.map((o) => ({ id: this.store.id(), subId: sub.id, outbound: o }));
    this.d.nodes = [...others, ...fresh];
    sub.count = fresh.length; sub.format = parsed.format; sub.errors = parsed.errors.slice(0, 20);
    if (!this.d.nodes.find((n) => n.id === this.d.selectedId)) {
      const same = keepTag && this.d.nodes.find((n) => n.outbound.tag === keepTag);
      this.d.selectedId = (same || this.d.nodes[0] || {}).id || null;
    }
  }

  async addSubscription({ name, url }) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('订阅链接必须以 http:// 或 https:// 开头');
    const sub = { id: this.store.id(), name: name || new URL(url).hostname, url, updatedAt: null, info: null, error: null };
    const { body, info } = await this.fetchSub(url);
    const parsed = parseSubscriptionBody(body);
    if (!parsed.nodes.length) throw new Error('订阅中没有解析出任何节点' + (parsed.errors[0] ? `（${parsed.errors[0].error}）` : ''));
    sub.info = info; sub.updatedAt = Date.now();
    this.d.subscriptions.push(sub); this._ingest(sub, parsed); this.store.save(); this.emitState();
    return { count: sub.count, errors: parsed.errors };
  }

  importLinks({ name, text }) {
    const parsed = parseLinks(text);
    if (!parsed.nodes.length) throw new Error('没有识别到有效的分享链接' + (parsed.errors[0] ? `（${parsed.errors[0].error}）` : ''));
    let sub = this.d.subscriptions.find((s) => !s.url && s.name === (name || '手动导入'));
    if (!sub) { sub = { id: this.store.id(), name: name || '手动导入', url: null, updatedAt: Date.now(), info: null, error: null }; this.d.subscriptions.push(sub); }
    const existing = this.d.nodes.filter((n) => n.subId === sub.id).map((n) => n.outbound);
    this._ingest(sub, { nodes: [...existing, ...parsed.nodes], errors: parsed.errors, format: 'links' });
    sub.updatedAt = Date.now(); this.store.save(); this.emitState();
    return { count: parsed.nodes.length, errors: parsed.errors };
  }

  async updateSubscription(id) {
    const sub = this.d.subscriptions.find((s) => s.id === id);
    if (!sub || !sub.url) throw new Error('该订阅没有链接，无法更新');
    try {
      const { body, info } = await this.fetchSub(sub.url);
      const parsed = parseSubscriptionBody(body);
      if (!parsed.nodes.length) throw new Error('更新后没有解析出节点，已保留旧节点');
      sub.info = info; sub.updatedAt = Date.now(); sub.error = null;
      this._ingest(sub, parsed, sub.id);
      this.store.save(); this.emitState();
      return { count: sub.count };
    } catch (e) { sub.error = e.message; this.store.save(); this.emitState(); throw e; }
  }

  async updateAllSubscriptions() {
    const res = [];
    for (const s of this.d.subscriptions.filter((x) => x.url)) { try { res.push({ id: s.id, ...(await this.updateSubscription(s.id)) }); } catch (e) { res.push({ id: s.id, error: e.message }); } }
    return res;
  }

  async removeSubscription(id) {
    this.d.subscriptions = this.d.subscriptions.filter((s) => s.id !== id);
    this.d.nodes = this.d.nodes.filter((n) => n.subId !== id);
    if (!this.d.nodes.find((n) => n.id === this.d.selectedId)) this.d.selectedId = this.d.nodes[0]?.id || null;
    this.store.save(); this.emitState();
    if (this.core.state === 'running') await this.restart();
  }

  async removeNode(id) {
    this.d.nodes = this.d.nodes.filter((n) => n.id !== id);
    if (this.d.selectedId === id) this.d.selectedId = this.d.nodes[0]?.id || null;
    this.store.save(); this.emitState();
  }

  // ---------- nodes ----------
  async selectNode(id) {
    const n = this.d.nodes.find((x) => x.id === id); if (!n) throw new Error('节点不存在');
    this.d.selectedId = id; this.store.save();
    if (this.core.state === 'running') await this.core.selectNode(n.outbound.tag);
    this.emitState();
  }

  /**
   * URL test (real HTTPS request through each node, done by the kernel). If the core is
   * stopped it is started temporarily without touching the system proxy and stopped again
   * afterwards. TCP connect timing is only a fallback when the kernel cannot start, and the
   * result is reported so the UI can say so - never silently.
   */
  async testNodes(ids) {
    const list = this.d.nodes.filter((n) => !ids || ids.includes(n.id));
    if (!list.length) return { mode: 'none', count: 0 };
    const url = this.d.settings.connectionTestURL;
    let running = this.core.state === 'running';
    let tempStarted = false;
    let fallbackError = null;
    if (!running) {
      try {
        await this.start({ forTest: true });
        running = this.core.state === 'running';
        tempStarted = running;
      } catch (e) { fallbackError = e.message; this.core.pushLog('WARN URL 测速需临时启动内核失败，改用 TCP 连接测试: ' + e.message); }
    }
    const mode = running ? 'url' : 'tcp';
    const workers = Math.max(1, Math.min(32, Number(this.d.settings.testConcurrency) || 5));
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const n = list[i++];
        try {
          if (running) n.latency = await this.core.delay(n.outbound.tag, url, 6000);
          else n.latency = await tcpPing(n.outbound.server, n.outbound.server_port, 3000);
        } catch { n.latency = null; }
        n.latencyKind = mode; n.testedAt = Date.now(); this.emitState();
      }
    };
    await Promise.all(Array.from({ length: Math.min(workers, list.length) }, worker));
    if (tempStarted) await this.stop();
    this.store.save();
    return { mode, count: list.length, error: fallbackError };
  }

  // ---------- start / stop ----------
  build() {
    const d = this.d;
    const nodes = d.nodes.map((n) => n.outbound);
    const sel = d.nodes.find((n) => n.id === d.selectedId)?.outbound.tag;
    const r = buildConfig({ nodes, selectedTag: sel, settings: d.settings, userRules: d.rules, secret: d.secret, cachePath: 'cache.db', rulesetDir: this.rulesetDir });
    this.routePreview = r.routePreview;
    return r;
  }

  async start({ forTest } = {}) {
    if (this.starting || this.core.state !== 'stopped') return;
    this.starting = true; this.lastError = null; this.emitState();
    try {
      const { config, warnings } = this.build();
      warnings.forEach((w) => this.core.pushLog('WARN ' + w));
      await this.core.start({ config, apiPort: this.d.settings.apiPort, secret: this.d.secret });
      if (!forTest && this.d.settings.setSystemProxy && !this.d.settings.tun) await this.applyProxy();
    } catch (e) {
      this.lastError = e.message; await this.core.stop().catch(() => {}); await this.cleanupProxy();
      throw e;
    } finally { this.starting = false; this.emitState(); }
  }

  async stop() { await this.core.stop(); await this.cleanupProxy(); this.emitState(); }
  async restart() { await this.stop(); await this.start(); }

  async applyProxy() {
    if (!this.sysproxy.supported) return;
    const host = '127.0.0.1'; const port = this.d.settings.mixedPort;
    const r = await this.sysproxy.enable(host, port);
    if (r.ok) { this.d.sysproxyBackup = { backup: r.backup, port }; this.proxyApplied = true; this.store.flush(); }
  }
  async cleanupProxy() {
    if (!this.proxyApplied && !this.d.sysproxyBackup) return;
    try { await this.sysproxy.disable(this.d.sysproxyBackup && this.d.sysproxyBackup.backup); } catch (e) { this.core.pushLog('ERROR 还原系统代理失败: ' + e.message); }
    this.proxyApplied = false; this.d.sysproxyBackup = null; this.store.flush();
  }

  async toggleSystemProxy(on) {
    if (this.core.state !== 'running') throw new Error('请先启动内核');
    if (on) await this.applyProxy(); else await this.cleanupProxy();
    this.emitState();
  }

  // ---------- settings / rules ----------
  async setSettings(patch) {
    const s = { ...this.d.settings };
    for (const k of Object.keys(patch)) if (k in DEFAULT_SETTINGS) s[k] = patch[k];
    const port = Number(s.mixedPort); const api = Number(s.apiPort);
    if (!(port > 0 && port < 65536) || !(api > 0 && api < 65536)) throw new Error('端口必须在 1-65535 之间');
    if (port === api) throw new Error('代理端口与 API 端口不能相同');
    if (!/^https:\/\//i.test(String(s.connectionTestURL))) throw new Error('测速地址必须以 https:// 开头（内核会忽略 http:// 地址）');
    s.mixedPort = port; s.apiPort = api;
    if (!(Number(s.testConcurrency) > 0)) s.testConcurrency = 5; else s.testConcurrency = Math.min(32, Math.floor(Number(s.testConcurrency)));
    const needRestart = this.core.state === 'running' && JSON.stringify(s) !== JSON.stringify(this.d.settings) && Object.keys(patch).some((k) => !NO_RESTART_KEYS.includes(k));
    this.d.settings = s; this.store.save(); this.emitState();
    if (Object.keys(patch).some((k) => k === 'autoUpdateSubsMin')) this.scheduleAutoUpdate();
    if (needRestart) await this.restart();
    return { restarted: needRestart };
  }

  async saveRule(rule) {
    const r = { id: rule.id || this.store.id(), name: rule.name || '', enabled: rule.enabled !== false, domain: rule.domain || '', ip: rule.ip || '', port: rule.port || '', sourceIp: rule.sourceIp || '', sourcePort: rule.sourcePort || '', processName: rule.processName || '', network: rule.network || 'any', protocol: rule.protocol || '', outbound: rule.outbound || 'proxy' };
    const i = this.d.rules.findIndex((x) => x.id === r.id);
    if (i >= 0) this.d.rules[i] = r; else this.d.rules.push(r);
    this.store.save(); this.emitState();
    if (this.core.state === 'running') await this.restart();
  }
  async removeRule(id) { this.d.rules = this.d.rules.filter((r) => r.id !== id); this.store.save(); this.emitState(); if (this.core.state === 'running') await this.restart(); }

  /** Import many rules at once (from a file). One core restart at most. Returns a summary. */
  async importRuleFile(text) {
    const { rules, warnings, skipped } = parseRuleFile(text);
    if (!rules.length) { const e = new Error(warnings[0] || '没有可导入的规则'); e.warnings = warnings; throw e; }
    for (const r of rules) {
      this.d.rules.push({ id: this.store.id(), name: r.name || '导入规则', enabled: r.enabled !== false, domain: r.domain || '', ip: r.ip || '', port: r.port || '', sourceIp: r.sourceIp || '', sourcePort: r.sourcePort || '', processName: r.processName || '', network: r.network || 'any', protocol: r.protocol || '', outbound: r.outbound || 'proxy' });
    }
    this.store.save(); this.emitState();
    if (this.core.state === 'running') await this.restart();
    return { imported: rules.length, skipped, warnings: warnings.slice(0, 10) };
  }

  /** Import a subscription from a local file's content (same formats as URL subscriptions). */
  async importSubFile({ name, content }) {
    const parsed = parseSubscriptionBody(content);
    if (!parsed.nodes.length) throw new Error('文件中没有解析出任何节点' + (parsed.errors[0] ? `（${parsed.errors[0].error}）` : ''));
    let sub = this.d.subscriptions.find((s) => !s.url && s.name === (name || '手动导入'));
    if (!sub) { sub = { id: this.store.id(), name: name || '手动导入', url: null, updatedAt: Date.now(), info: null, error: null }; this.d.subscriptions.push(sub); }
    const existing = this.d.nodes.filter((n) => n.subId === sub.id).map((n) => n.outbound);
    this._ingest(sub, { nodes: [...existing, ...parsed.nodes], errors: parsed.errors, format: parsed.format });
    sub.updatedAt = Date.now(); this.store.save(); this.emitState();
    return { count: parsed.nodes.length, errors: parsed.errors };
  }

  // ---------- stats ----------
  onTick(t) {
    const k = dayKey(); const day = (this.d.daily[k] ||= { up: 0, down: 0 });
    day.up += t.deltaUp; day.down += t.deltaDown;
    const keys = Object.keys(this.d.daily).sort(); while (keys.length > 90) delete this.d.daily[keys.shift()];
    this.store.save();
    this.emit('tick', { ...t, today: day });
  }
  async clearStats() { this.d.daily = {}; this.store.save(); this.emitState(); }

  async shutdown() { if (this._autoHandle) { this._autoTimer.clear(this._autoHandle); this._autoHandle = null; } try { await this.stop(); } finally { this.store.flush(); } }
}

module.exports = { AppService };
