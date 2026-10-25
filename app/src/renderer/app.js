'use strict';
// App shell: sidebar navigation, theme/wallpaper, IPC wiring. Pages live in pages.js and
// receive live updates through view.tick / view.log / view.state callbacks instead of re-renders.
const NAV = [
  ['home', '概览', ICONS.home],
  ['nodes', '节点', ICONS.nodes],
  ['subs', '订阅', ICONS.subs],
  ['rules', '代理规则', ICONS.rules],
  ['conns', '连接', ICONS.conns],
  ['geo', '地图', ICONS.globe],
  ['stats', '流量统计', ICONS.stats],
  ['logs', '运行日志', ICONS.logs],
  ['toolbox', '工具箱', ICONS.toolbox],
  ['settings', '设置', ICONS.settings],
];
// Shared mutable context: current state snapshot, live sample buffer, log buffer, UI prefs.
const X = {
  S: null, samples: [], logs: [],
  nodeFilter: '', nodeSort: 'default', nodeSubFilter: 'all',
  logLevel: 'all', logSearch: '', logFollow: true,
  connSearch: '', connNet: 'all',
};
let page = 'home'; let view = null; let footRefs = null; let lastSig = '';

const isRunning = () => X.S && X.S.core.state === 'running';
const modeName = (m) => (m === 'global' ? '全局' : '规则');
const dayKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Signature of "structurally important" state. Latency values are deliberately excluded:
 * when only latencies change (during a test run) we do a light in-place update through
 * view.state(S) instead of rebuilding the page - that is what stops the flicker.
 */
function stateSig(S) {
  return JSON.stringify([
    S.core.state, S.core.error, S.proxyApplied, S.selectedId, S.settings,
    S.subscriptions.map((s) => [s.id, s.count, s.updatedAt, s.error, s.info && s.info.total, s.info && s.info.expire]),
    S.rules.map((r) => [r.id, r.enabled]),
    S.nodes.length, S.nodes.map((n) => n.subId).join(','),
    S.routePreview.length, S.sysproxySupported, S.testing === true,
  ]);
}
// sig fields that a toolbox export/import changes; the page itself re-renders via normal actions

let navRebuildTimer = null;
function renderNav() {
  // during a test run the state pushes are frequent; skip the full sidebar REBUILD
  // (it flickers) but still update the active-item highlight in place so switching
  // pages mid-test shows the correct selection immediately
  if (X.S && X.S.testing === true && navRebuildTimer) {
    const nav = document.getElementById('nav');
    nav.querySelectorAll('button').forEach((b, i) => {
      const active = NAV[i] && NAV[i][0] === page;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    return;
  }
  clearTimeout(navRebuildTimer); navRebuildTimer = null;
  const nav = document.getElementById('nav');
  nav.replaceChildren(...NAV.map(([id, label, icon]) => h('button', { class: id === page ? 'on' : '', onclick: () => go(id), 'aria-current': id === page ? 'page' : null }, svgIcon(icon), label)));
  // sidebar footer: live status, rebuilt only on structural changes; tick updates go through footRefs
  const S = X.S; const st = S.core.state;
  const sel = S.nodes.find((n) => n.id === S.selectedId);
  const foot = document.getElementById('foot');
  foot.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'dot ' + (st === 'running' ? 'run' : st === 'stopped' ? '' : 'wait') }),
      h('b', { ref: 'state' }, { stopped: '内核已停止', starting: '正在启动…', running: '内核运行中', stopping: '正在停止…' }[st] || '内核已停止')),
    h('div', { class: 'row', title: sel ? '当前节点' : '' }, h('span', { class: 't', ref: 'node' }, sel ? sel.tag : '未选择节点')),
    h('div', { class: 'row', ref: 'speed', style: { visibility: st === 'running' ? 'visible' : 'hidden' } }, '↓ ', h('b', { ref: 'down' }, '-'), '  ↑ ', h('b', { ref: 'up' }, '-')),
    h('div', { class: 'row' }, h('span', { class: 't', title: S && S.core.binary ? S.core.binary : '' }, (S && S.core.version ? S.core.version.replace(/^sing-box version /, 'sing-box ') : '未找到内核')),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn small ghost', title: '切换浅色/深色主题', 'aria-label': '切换主题', style: { height: '22px', padding: '0 6px' },
        onclick: () => { const cur = X.S && X.S.settings.theme === 'dark'; act(() => api('setSettings', { theme: cur ? 'light' : 'dark' })); } },
        svgIcon(X.S && X.S.settings.theme === 'dark' ? ICONS.sun : ICONS.moon))),
  );
  footRefs = {};
  foot.querySelectorAll('[ref]').forEach((el) => { footRefs[el.getAttribute('ref')] = el; });
}

function render() {
  if (!X.S) return;
  if (view && view.destroy) view.destroy();
  keepFocus.save();
  // preserve scroll positions of inner scroll containers (node/conn tables live in
  // their own .scroll divs; a full re-render must not jump them back to the top)
  const oldKeeps = [...document.querySelectorAll('#main [data-keep-scroll]')].map((el) => el.scrollTop);
  view = PAGES[page]();
  const main = document.getElementById('main'); const top = main.scrollTop;
  main.replaceChildren(view.el); main.scrollTop = top;
  document.querySelectorAll('#main [data-keep-scroll]').forEach((el, i) => { if (oldKeeps[i] != null) el.scrollTop = oldKeeps[i]; });
  keepFocus.restore(view.el);
  lastSig = stateSig(X.S);
  renderNav();
  // charts are drawn synchronously after attach, in the same frame as the DOM swap:
  // the browser paints once, so there is no blank/flash frame in between
  if (view.mount) view.mount();
}
function go(p) {
  page = p; render(); document.getElementById('main').scrollTop = 0;
  // navigation-only entrance animation (state-driven re-renders stay still: no flicker)
  if (view && view.el) { view.el.classList.add('page-nav'); setTimeout(() => view.el.classList.remove('page-nav'), 220); }
}
window.__go = go; window.__render = render;
window.__applyState = applyState; // test hook: inject a state snapshot (used by verification probes)

function applyBrandArtwork() {
  const mark = document.querySelector('.brand .mark');
  if (mark) mark.style.backgroundImage = "url('assets/brand.png')";
}

function applyTheme() {
  const t = X.S && X.S.settings && X.S.settings.theme === 'dark' ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}
function applySkin() {
  const s = X.S && X.S.settings ? X.S.settings : {};
  // wallpaper. NOTE: 0 is a legitimate value (e.g. veil fully off) - only fall back
  // when the setting is missing/not a number, never on falsy-ness (bug: veil 0% jumped back to 55%)
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const on = !!s.wallpaper;
  document.body.classList.toggle('wallpaper', on);
  const wp = document.getElementById('wp');
  if (on) {
    // data URI (base64) works directly; legacy file paths use file://
    const ws = String(s.wallpaper);
    if (ws.startsWith('data:')) wp.style.backgroundImage = `url("${ws}")`;
    else wp.style.backgroundImage = `url("file:///${ws.replace(/\\/g, '/').split('/').map(encodeURI).join('/')}")`;
  } else wp.style.backgroundImage = '';
  document.documentElement.style.setProperty('--wp-o', num(s.wallpaperOpacity, 0.35));
  document.documentElement.style.setProperty('--wp-veil', num(s.wallpaperVeil, 0.55));
  document.documentElement.style.setProperty('--wp-blur', num(s.wallpaperBlur, 0) + 'px');
  // frosted glass (independent opacity; text color stays solid)
  document.body.classList.toggle('glass', !!s.glassEnabled);
  document.documentElement.style.setProperty('--glass-pct', Math.round(num(s.glassOpacity, 0.6) * 100) + '%');
  // custom font color: override --ink directly (removing restores the theme default)
  const fc = String(s.fontColor || '').trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(fc)) {
    document.documentElement.style.setProperty('--ink', fc);
    document.documentElement.style.setProperty('--ink-2', fc); // secondary text follows
  } else {
    document.documentElement.style.removeProperty('--ink');
    document.documentElement.style.removeProperty('--ink-2');
  }
}

function applyState(S) {
  X.S = S;
  applyBrandArtwork();
  applyTheme(); applySkin();
  if (S.samples && S.samples.length && !X.samples.length) X.samples = S.samples.slice();
  if (S.core.state !== 'running') X.samples = [];
  // never wipe a settings form the user is editing
  if (page === 'settings' && document.activeElement && document.activeElement.closest && document.activeElement.closest('.main') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    renderNav(); return;
  }
  // latency-only changes (a test run is in progress): update in place, no rebuild
  if (stateSig(S) === lastSig && view && view.state) { renderNav(); view.state(S); return; }
  render();
}

window.jj.on('state', applyState);
window.jj.on('tick', (t) => {
  X.samples.push({ t: t.t, up: t.up, down: t.down, conn: t.connections, mem: t.memory });
  if (X.samples.length > 300) X.samples.shift();
  if (X.S) {
    const k = dayKeyOf();
    X.S.daily = { ...X.S.daily, [k]: t.today }; X.S.today = t.today;
    X.S.session = { upTotal: t.upTotal, downTotal: t.downTotal, memory: t.memory };
  }
  if (footRefs && footRefs.down) { footRefs.down.textContent = fmtSpeed(t.down); footRefs.up.textContent = fmtSpeed(t.up); }
  if (view && view.tick) view.tick(t);
});
window.jj.on('log', (l) => { X.logs.push(l); if (X.logs.length > 2000) X.logs.shift(); if (view && view.log) view.log(l); });
window.addEventListener('resize', () => view && view.resize && view.resize());

(async () => {
  // Opened outside Electron (e.g. double-clicking index.html in a browser): the
  // preload bridge is missing, so there is no backend and nothing real to show.
  if (!window.jj) {
    const main = document.getElementById('main');
    if (main) main.replaceChildren(h('div', { class: 'page' },
      h('div', { class: 'card', style: { margin: '60px auto', maxWidth: '520px', textAlign: 'center', padding: '36px 28px' } },
        h('b', { style: { fontSize: '16px' } }, '这不是网页，请用桌面程序打开'),
        h('div', { class: 'note', style: { marginTop: '10px', lineHeight: '1.7' } },
          'Bear Box 的界面必须由桌面程序加载，浏览器里没有它的数据通道，所以这里没有内容。',
          h('br'), '请到程序文件夹中双击 Bear Box 启动。'))));
    return;
  }
  try { X.logs = await api('logs'); applyState(await api('state')); } catch (e) {
    const main = document.getElementById('main'); if (main) main.textContent = '加载失败：' + e.message;
  }
})();
