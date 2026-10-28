'use strict';
const path = require('path');
const { probeQuickRoute } = require('./route-probe');
const { CATALOG, IDS, resolveQuickRoutes } = require('./quick-routes');
const { EventEmitter } = require('events');
const { Store, dayKey } = require('./store');
const { Core, resolveCoreBinary, resolveRulesetDir, tcpPing } = require('./core');
const { buildConfig, DEFAULT_SETTINGS, parseRuleFile } = require('./config');
const { parseSubscriptionBody, dedupeTags, fetchSubscription } = require('./subscription');
const { parseLinks } = require('./links');
const { SystemProxy } = require('./sysproxy');
const { GeoService } = require('./geo');

// Settings that only affect the UI or app shell; changing them must not restart a running core.
const NO_RESTART_KEYS = ['setSystemProxy', 'autoStartCore', 'connectionTestURL', 'testConcurrency', 'theme', 'closeToTray', 'autoUpdateSubsMin', 'wallpaper', 'wallpaperOpacity', 'wallpaperBlur', 'glassEnabled', 'glassOpacity', 'fontColor', 'uiColor', 'appearanceMode', 'accentColor', 'fontSize', 'uiDensity', 'sidebarWidth', 'sidebarCollapsed', 'windowOpacity'];
const LEGACY_TEST_URL = 'https://cp.cloudflare.com/generate_204'; // default before v0.2.2

class AppService extends EventEmitter {
  constructor({ userData, appRoot, resourcesPath, sysproxy, binary, fetchSub = fetchSubscription, autoUpdateTimer = null, core = null }) {
    super();
    this.store = new Store(path.join(userData, 'data.json'));
    this.core = core || new Core({ binary: binary || resolveCoreBinary(appRoot, resourcesPath), workDir: path.join(userData, 'core-run') });
    this.rulesetDir = resolveRulesetDir(appRoot, resourcesPath);
    this.geo = new GeoService({ userData, getStrategy: () => this.d.settings.ipv6Mode, getProxy: () => (this.core.state === 'running' ? { host: '127.0.0.1', port: Number(this.d.settings.mixedPort) } : null) });
    this._testing = false; this._testStop = false; this._testDone = 0;
    this.sysproxy = sysproxy || new SystemProxy();
    this.fetchSub = fetchSub;
    this._settingsTask = Promise.resolve();
    this._proxyTask = Promise.resolve(); this._routeTask = Promise.resolve();
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
    // crash recovery: a previous run may have left the system proxy pointing at a dead port.
    // This MUST succeed before anything else - if it fails, the user's internet is broken.
    if (this.d.sysproxyBackup) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await this.sysproxy.disable(this.d.sysproxyBackup.backup);
          if (!result.ok) throw new Error(result.reason || '系统代理恢复失败');
          this.d.sysproxyBackup = null; this.proxyApplied = false; this.store.flush();
          break;
        } catch (e) { if (attempt === 2) this.core.pushLog('ERROR 启动时还原系统代理失败（已重试 3 次）: ' + e.message); }
      }
    }
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
      quickRoutes: d.quickRoutes || {}, routeCatalog: CATALOG, settings: d.settings, subscriptions: d.subscriptions, rules: d.rules,
      nodes: d.nodes.map((n) => ({ id: n.id, subId: n.subId, tag: n.outbound.tag, type: n.outbound.type, server: n.outbound.server, port: n.outbound.server_port, latency: n.latency ?? null, latencyKind: n.latencyKind || null, testedAt: n.testedAt || null })),
      selectedId: d.selectedId, today, daily: d.daily,
      routePreview: this.routePreview,
      testing: this._testing === true,
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
    if (this.core.state === 'running') {
      await this.core.selectNode(n.outbound.tag);
      // verify the runtime pick (the API may silently drop a bad tag); retry once
      try {
        const now = await this.core.currentNode();
        if (now !== n.outbound.tag) { await this.core.selectNode(n.outbound.tag); }
      } catch { /* verification is best effort */ }
      // keep-alive connections opened through the previous node keep exiting there;
      // drop them so the new node is used immediately (same as Clash dashboards)
      await this.core.closeAll().catch(() => {});
    }
    this.d.selectedId = id; this.store.save(); this.emitState();
  }

  /**
   * URL test (real HTTPS request through each node, done by the kernel). If the core is
   * stopped it is started temporarily without touching the system proxy and stopped again
   * afterwards. TCP connect timing is only a fallback when the kernel cannot start, and the
   * result is reported so the UI can say so - never silently.
   */
  async testNodes(ids) {
    if (this._testing) throw new Error('测速正在进行，请等待完成或停止当前测速');
    this._testing = true; this._testStop = false; this._testDone = 0;
    this.emitState();
    try { return await this._testNodes(ids); }
    finally { this._testing = false; this.emitState(); }
  }

  async _testNodes(ids) {
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
    const workers = Math.max(1, Math.min(32, Number(this.d.settings.testConcurrency) || 3));
    let i = 0;
    this.emitState();
    // warm-up: one request through the selected node establishes the connection pool and
    // DNS cache. Without this, the first batch of concurrent tests competes for a cold
    // DNS resolver and fresh TLS sessions, inflating every latency by hundreds of ms.
    if (running && this.d.selectedId) {
      const sel = this.d.nodes.find((n) => n.id === this.d.selectedId);
      if (sel) { try { await this.core.delay(sel.outbound.tag, url, 5000); } catch { /* warm-up failure is fine */ } }
    }
    const worker = async () => {
      while (i < list.length && !this._testStop) {
        const n = list[i++];
        try {
          if (running) n.latency = await this.core.delay(n.outbound.tag, url, 10000);
          else n.latency = await tcpPing(n.outbound.server, n.outbound.server_port, 5000);
        } catch { n.latency = null; }
        n.latencyKind = mode; n.testedAt = Date.now(); this._testDone++; this.emitState();
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(workers, list.length) }, worker));
    } finally {
      if (tempStarted) await this.stop();
      this.store.save();
    }
    return { mode, count: list.length, done: this._testDone, stopped: this._testStop === true, error: fallbackError };
  }

  /** User-requested cancellation of a running URL test. In-flight checks (<=6s) finish, queued ones are dropped. */
  stopTestNodes() {
    if (this._testing) this._testStop = true;
    return { stopping: this._testing === true };
  }

  // ---------- start / stop ----------
  build({ forTest = false } = {}) {
    const d = this.d;
    const nodes = d.nodes.map((n) => n.outbound);
    const sel = d.nodes.find((n) => n.id === d.selectedId)?.outbound.tag;
    const quick = resolveQuickRoutes(d.quickRoutes, d.nodes);
    const r = buildConfig({ quickRoutes: quick.resolved, nodes, selectedTag: sel, settings: forTest ? { ...d.settings, tun: false } : d.settings, userRules: d.rules, secret: d.secret, cachePath: 'cache.db', rulesetDir: this.rulesetDir });
    r.warnings.push(...quick.warnings);
    this.routePreview = r.routePreview;
    return r;
  }

  async start({ forTest } = {}) {
    if (this.starting || this.core.state !== 'stopped') return;
    this.starting = true; this.lastError = null; this.emitState();
    try {
      const { config, warnings } = this.build({ forTest });
      warnings.forEach((w) => this.core.pushLog('WARN ' + w));
      await this.core.start({ config, apiPort: this.d.settings.apiPort, secret: this.d.secret });
      // make the UI selection authoritative: after a restart the runtime pick must
      // match selectedId regardless of what the kernel's cache file restored
      const selTag = this.d.nodes.find((n) => n.id === this.d.selectedId)?.outbound.tag;
      if (selTag) await this.core.selectNode(selTag).catch((e) => this.core.pushLog('WARN 启动后应用节点选择失败: ' + e.message));
      if (!forTest && this.d.settings.setSystemProxy && !this.d.settings.tun) await this.applyProxy();
    } catch (e) {
      this.lastError = e.message; await this.core.stop().catch(() => {}); await this.cleanupProxy();
      throw e;
    } finally { this.starting = false; this.emitState(); }
  }

  async stop() { await this.core.stop(); await this.cleanupProxy(); this.emitState(); }
  async restart() { await this.stop(); await this.start(); }

  _queueProxy(operation) {
    const task = this._proxyTask.then(operation);
    this._proxyTask = task.catch(() => {});
    return task;
  }
  applyProxy() { return this._queueProxy(() => this._applyProxy()); }
  cleanupProxy() { return this._queueProxy(() => this._cleanupProxy()); }

  async _applyProxy() {
    if (!this.sysproxy.supported || this.proxyApplied) return;
    if (this.d.sysproxyBackup) {
      await this._cleanupProxy();
      if (this.d.sysproxyBackup) throw new Error('原系统代理尚未恢复，请重试后再开启');
    }
    const host = '127.0.0.1'; const port = this.d.settings.mixedPort;
    const r = await this.sysproxy.enable(host, port, (backup) => {
      this.d.sysproxyBackup = { backup, port }; this.store.flush();
    });
    if (r.ok) { this.d.sysproxyBackup = { backup: r.backup, port }; this.proxyApplied = true; this.store.flush(); }
  }
  async _cleanupProxy() {
    if (!this.proxyApplied && !this.d.sysproxyBackup) return;
    try {
      const result = await this.sysproxy.disable(this.d.sysproxyBackup && this.d.sysproxyBackup.backup);
      if (!result.ok) throw new Error(result.reason || '系统代理恢复失败');
      // only clear the backup on success - if disable() throws and we cleared it,
      // the next startup would have no backup to restore from (internet stays broken)
      this.proxyApplied = false; this.d.sysproxyBackup = null; this.store.flush();
    } catch (e) {
      this.core.pushLog('ERROR 还原系统代理失败: ' + e.message);
      // keep proxyApplied and sysproxyBackup so the next startup retries the restore
    }
  }

  async toggleSystemProxy(on) {
    if (this.core.state !== 'running') throw new Error('请先启动内核');
    if (on && this.d.settings.tun) throw new Error('TUN 模式已接管流量，无需重复开启系统代理');
    if (on) await this.applyProxy(); else await this.cleanupProxy();
    this.emitState();
  }

  // ---------- settings / rules ----------
  _normalizeSettings(patch, base = this.d.settings) {
    const s = { ...base };
    for (const k of Object.keys(patch)) if (k in DEFAULT_SETTINGS) s[k] = patch[k];
    if (!['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'].includes(s.ipv6Mode)) throw new Error('IPv6 策略无效');
    for (const k of ['fakeip', 'dnsCache', 'dnsReverseMapping']) if (typeof s[k] !== 'boolean') throw new Error('DNS 开关必须为布尔值');
    const port = Number(s.mixedPort); const api = Number(s.apiPort);
    if (!Number.isInteger(port) || !Number.isInteger(api) || !(port > 0 && port < 65536) || !(api > 0 && api < 65536)) throw new Error('端口必须在 1-65535 之间');
    if (port === api) throw new Error('代理端口与 API 端口不能相同');
    if (!/^https:\/\//i.test(String(s.connectionTestURL))) throw new Error('测速地址必须以 https:// 开头（内核会忽略 http:// 地址）');
    s.mixedPort = port; s.apiPort = api;
    const mtu = Number(s.mtu);
    if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 9000) throw new Error('TUN MTU 必须是 1280-9000 之间的整数');
    s.mtu = mtu;
    if (!['mixed', 'system', 'gvisor'].includes(s.tunStack)) throw new Error('不支持的 TUN 协议栈');
    if (typeof s.tun !== 'boolean' || typeof s.tunStrictRoute !== 'boolean') throw new Error('TUN 开关必须为布尔值');
    if (!Number.isFinite(Number(s.testConcurrency)) || Number(s.testConcurrency) < 1) s.testConcurrency = 3; else s.testConcurrency = Math.min(32, Math.floor(Number(s.testConcurrency)));
    const updateMin = Number(s.autoUpdateSubsMin);
    if (!Number.isFinite(updateMin) || updateMin < 0 || updateMin * 60000 > 2147483647) throw new Error('订阅更新间隔必须在 0-35791 分钟之间');
    s.autoUpdateSubsMin = updateMin;
    // repair slider-era values that were persisted on percent scales (e.g. opacity 55 -> 0.55)
    for (const [k, max] of [['wallpaperOpacity', 1], ['glassOpacity', 1]]) {
      const v = Number(s[k]);
      if (Number.isFinite(v) && v > max) s[k] = v > max * 10 ? v / 100 : max;
    }
    for (const [key, min, max] of [['glassOpacity', 0, 1], ['wallpaperOpacity', 0, 1], ['wallpaperBlur', 0, 50]]) {
      const value = Number(s[key]); s[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : DEFAULT_SETTINGS[key];
    }
    if (!['forest', 'forest-dark', 'light', 'dark'].includes(s.theme)) s.theme = DEFAULT_SETTINGS.theme;
    if (typeof s.uiColor !== 'string' || (s.uiColor && !/^#[0-9a-f]{6}$/i.test(s.uiColor))) throw new Error('界面颜色必须是 #RRGGBB 格式');
    if (!['', 'light', 'dark', 'system'].includes(s.appearanceMode)) throw new Error('显示模式无效');
    if (typeof s.accentColor !== 'string' || (s.accentColor && !/^#[0-9a-f]{6}$/i.test(s.accentColor))) throw new Error('主题主色必须是 #RRGGBB 格式');
    if (!['small', 'standard', 'large'].includes(s.fontSize) || !['compact', 'standard', 'spacious'].includes(s.uiDensity)) throw new Error('字体大小或界面密度无效');
    for (const [key, min, max] of [['sidebarWidth', 180, 280], ['windowOpacity', .7, 1]]) {
      const value = Number(s[key]); if (!Number.isFinite(value) || value < min || value > max) throw new Error(key + ' 超出允许范围'); s[key] = value;
    }
    if (typeof s.sidebarCollapsed !== 'boolean') throw new Error('侧边栏折叠状态无效');
    return s;
  }

  setSettings(patch) {
    const task = this._settingsTask.then(() => this._setSettings(patch));
    this._settingsTask = task.catch(() => {});
    return task;
  }

  async _setSettings(patch) {
    const previous = { ...this.d.settings };
    const s = this._normalizeSettings(patch);
    if (['forest', 'forest-dark'].includes(s.theme) && ['fontColor', 'uiColor', 'accentColor'].some((key) => Object.hasOwn(patch, key) && s[key] !== previous[key])) throw new Error('森林主题使用专属配色，请先切换到简约风格再修改颜色');
    delete s.windowBlur;
    delete s.wallpaperVeil;
    const needRestart = this.core.state === 'running' && JSON.stringify(s) !== JSON.stringify(this.d.settings) && Object.keys(patch).some((k) => !NO_RESTART_KEYS.includes(k));
    this.d.settings = s; this.store.save(); this.emitState();
    if (Object.keys(patch).some((k) => k === 'autoUpdateSubsMin')) this.scheduleAutoUpdate();
    if (needRestart) {
      try { await this.restart(); } catch (error) {
        this.d.settings = previous; this.store.flush(); this.scheduleAutoUpdate();
        let recovery = '已恢复原设置与连接';
        try { await this.stop(); await this.start(); } catch (restoreError) { recovery = '原设置已恢复，但重新连接失败：' + restoreError.message; }
        this.lastError = '应用设置失败：' + error.message + '；' + recovery; this.emitState();
        throw new Error(this.lastError);
      }
    }
    return { restarted: needRestart };
  }

  testQuickRoute(id) {
    if (this._routeProbe) throw new Error('分流测试正在进行');
    this._routeProbe = true;
    this._routeProbeTask = probeQuickRoute(this, id).finally(() => { this._routeProbe = false; this._routeProbeTask = null; });
    return this._routeProbeTask;
  }
  setQuickRoute(patch) {
    const task = this._routeTask.then(() => this._setQuickRoute(patch));
    this._routeTask = task.catch(() => {});
    return task;
  }
  async _setQuickRoute({ id, enabled, nodeId }) {
    if (!IDS.includes(id)) throw new Error('未知的快捷分流项目');
    if (typeof enabled !== 'boolean') throw new Error('分流开关无效');
    const existing = this.d.quickRoutes || {};
    let target = existing[id]?.target || null;
    if (nodeId !== undefined) {
      const n = nodeId && this.d.nodes.find((n) => n.id === nodeId);
      if (nodeId && !n) throw new Error('所选节点不存在，请重新选择');
      target = n ? { subId: n.subId, tag: n.outbound.tag } : null;
    }
    this.d.quickRoutes = { ...existing, [id]: { enabled, target } };
    this.store.save(); this.emitState();
    if (this.core.state === 'running') await this.restart();
    return { ok: true };
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
    const sig = (r) => JSON.stringify([r.domain || '', r.ip || '', r.port || '', r.sourceIp || '', r.sourcePort || '', r.processName || '', r.network || 'any', r.protocol || '', r.outbound || 'proxy']);
    const existing = new Set(this.d.rules.map(sig));
    let dup = 0;
    for (const r of rules) {
      const s = sig(r);
      if (existing.has(s)) { dup++; continue; } // re-importing the same file must not double the rules (BUG J-02)
      existing.add(s);
      this.d.rules.push({ id: this.store.id(), name: r.name || '导入规则', enabled: r.enabled !== false, domain: r.domain || '', ip: r.ip || '', port: r.port || '', sourceIp: r.sourceIp || '', sourcePort: r.sourcePort || '', processName: r.processName || '', network: r.network || 'any', protocol: r.protocol || '', outbound: r.outbound || 'proxy' });
    }
    this.store.save(); this.emitState();
    if (this.core.state === 'running') await this.restart();
    return { imported: rules.length - dup, skipped, dup, warnings: warnings.slice(0, 10) };
  }

  // ---------- toolbox: backup / export ----------
  /** Full data backup (settings, subscriptions, nodes, rules, daily stats). Contains credentials. */
  exportBackup() {
    this.store.flush();
    return JSON.stringify({ app: 'JiajiaBox', backupVersion: 1, exportedAt: new Date().toISOString(), data: { ...this.d, sysproxyBackup: null } }, null, 2);
  }

  /** Restore a backup produced by exportBackup. Validates the shape before replacing anything. */
  async importBackup(text) {
    let j;
    try { j = JSON.parse(String(text)); } catch { throw new Error('不是有效的 JSON 备份文件'); }
    if (!j || j.app !== 'JiajiaBox' || !j.data || !Array.isArray(j.data.nodes) || !Array.isArray(j.data.subscriptions)) throw new Error('不是 JiajiaBox 备份文件（缺少数据结构）');
    if (j.backupVersion !== 1) throw new Error('不支持的备份版本');
    const record = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const validIds = (xs) => xs.every((x) => record(x) && typeof x.id === 'string' && x.id) && new Set(xs.map((x) => x.id)).size === xs.length;
    if (!validIds(j.data.nodes) || !validIds(j.data.subscriptions) ||
        j.data.nodes.some((n) => !record(n.outbound) || typeof n.outbound.tag !== 'string' || !n.outbound.tag || typeof n.outbound.type !== 'string') ||
        (j.data.settings !== undefined && !record(j.data.settings)) ||
        (j.data.rules !== undefined && (!Array.isArray(j.data.rules) || j.data.rules.some((r) => !record(r))))) {
      throw new Error('备份数据结构无效，已保留当前数据');
    }
    const settings = this._normalizeSettings(j.data.settings || {}, DEFAULT_SETTINGS);
    const wasRunning = this.core.state === 'running';
    if (wasRunning) await this.stop();
    // Recovery state belongs to this machine, never to an imported backup.
    if (this.d.sysproxyBackup) throw new Error('原系统代理尚未恢复，无法导入备份');
    const d = j.data;
    d.sysproxyBackup = null;
    d.settings = settings;
    d.rules = Array.isArray(d.rules) ? d.rules : [];
    d.daily = record(d.daily) ? d.daily : {};
    d.selectedId = d.nodes.some((n) => n.id === d.selectedId) ? d.selectedId : (d.nodes[0] && d.nodes[0].id) || null;
    d.secret = d.secret || this.d.secret;
    this.store.data = d; this.store.flush(); this.scheduleAutoUpdate(); this.emitState();
    if (wasRunning) await this.start().catch((e) => { this.lastError = '恢复备份后重启内核失败：' + e.message; });
    return { ok: true, nodes: d.nodes.length, subscriptions: d.subscriptions.length };
  }

  /** The exact sing-box config that would be written for the current state (for export/inspection). */
  exportCoreConfig() {
    const { config } = this.build();
    return JSON.stringify(config, null, 2);
  }

  /** Import a subscription from a local file's content (same formats as URL subscriptions). */
  async importSubFile({ name, content }) {
    const parsed = parseSubscriptionBody(content);
    if (!parsed.nodes.length) throw new Error('文件中没有解析出任何节点' + (parsed.errors[0] ? `（${parsed.errors[0].error}）` : ''));
    let sub = this.d.subscriptions.find((s) => !s.url && s.name === (name || '手动导入'));
    if (!sub) { sub = { id: this.store.id(), name: name || '手动导入', url: null, updatedAt: Date.now(), info: null, error: null }; this.d.subscriptions.push(sub); }
    // file imports replace that subscription's nodes (same semantics as a URL update);
    // appending here used to duplicate nodes on every re-import (BUG J-01)
    this._ingest(sub, parsed);
    sub.updatedAt = Date.now(); this.store.save(); this.emitState();
    return { count: parsed.nodes.length, errors: parsed.errors };
  }

  /** Rename a subscription (manual imports included). */
  async renameSubscription(id, name) {
    const sub = this.d.subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error('订阅不存在');
    const n = String(name || '').trim();
    if (!n) throw new Error('名称不能为空');
    if (this.d.subscriptions.some((s) => s.id !== id && s.name === n)) throw new Error('已有同名订阅');
    sub.name = n; this.store.save(); this.emitState();
    return { ok: true };
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

  async shutdown() { this._shuttingDown = true; if (this._routeProbeTask) await this._routeProbeTask.catch(() => {}); if (this._autoHandle) { this._autoTimer.clear(this._autoHandle); this._autoHandle = null; } try { await this.core.stop(); } finally { try { await this._queueProxy(async () => { await this.sysproxy.disable(); this.proxyApplied = false; this.d.sysproxyBackup = null; }); } finally { this.store.flush(); } } }
}

module.exports = { AppService };
