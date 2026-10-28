'use strict';
// App shell: sidebar navigation, theme/wallpaper, IPC wiring. Pages live in pages.js and
// receive live updates through view.tick / view.log / view.state callbacks instead of re-renders.
const NAV = [
  ['home', '概览', ICONS.home],
  ['tun', 'TUN 网络', ICONS.bolt],
  ['nodes', '节点', ICONS.nodes],
  ['subs', '订阅', ICONS.subs],
  ['rules', '代理规则', ICONS.rules],
  ['conns', '连接', ICONS.conns],
  ['geo', '地图', ICONS.globe],
  ['stats', '流量统计', ICONS.stats],
  ['logs', '运行日志', ICONS.logs],
  ['toolbox', '工具箱', ICONS.toolbox],
  ['appearance', '界面自定义', ICONS.sun],
  ['settings', '设置', ICONS.settings],
  ['about', '关于', ICONS.about],
];
// Shared mutable context: current state snapshot, live sample buffer, log buffer, UI prefs.
const X = {
  S: null, samples: [], logs: [],
  nodeFilter: '', nodeSort: 'default', nodeSubFilter: 'all',
  logLevel: 'all', logSearch: '', logFollow: true,
  connSearch: '', connNet: 'all',
};
let page = 'home'; let view = null; let footRefs = null; let lastSig = ''; let renderDebounce = null;

const isRunning = () => X.S && X.S.core.state === 'running';
const modeName = (m) => (m === 'global' ? '全局' : '规则');
const dayKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Signature of "structurally important" state. Latency values are deliberately excluded:
 * when only latencies change (during a test run) we do a light in-place update through
 * view.state(S) instead of rebuilding the page - that is what stops the flicker.
 */
function stateSig(S) {
  // On the geo page, core state changes (start/stop) don't rebuild the page - the
  // page's own state() callback handles them in place, so the 3D globe never flashes.
  const coreState = ['geo', 'nodes', 'rules'].includes(page) ? null : S.core.state;
  return JSON.stringify([
    coreState, S.core.tun, S.core.error, S.proxyApplied, S.selectedId,
    Object.fromEntries(Object.entries(S.settings).filter(([k]) => !['theme','wallpaper','wallpaperOpacity','wallpaperBlur','glassEnabled','glassOpacity','fontColor','uiColor','appearanceMode','accentColor','fontSize','uiDensity','sidebarWidth','sidebarCollapsed','windowOpacity'].includes(k))),
    S.subscriptions.map((s) => [s.id, s.name, s.count, s.updatedAt, s.error, s.info]),
    S.rules,
    S.nodes.map((n) => [n.id, n.subId, n.tag, n.type, n.server, n.port]),
    S.routePreview, S.sysproxySupported, S.quickRoutes,
    page === 'nodes' ? null : S.testing === true,
    (page === 'stats' || page === 'home') ? S.daily : null,
  ]);
}
// sig fields that a toolbox export/import changes; the page itself re-renders via normal actions

let lastFootSig = '';
function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav.children.length) nav.replaceChildren(...NAV.map(([id, label, icon]) => h('button', { onclick: () => go(id), title: label, 'aria-label': label }, svgIcon(icon), h('span', { class: 'nav-label' }, label))));
  [...nav.children].forEach((button, i) => {
    const active = NAV[i][0] === page;
    button.classList.toggle('on', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const footSig = JSON.stringify([X.S.core.state, X.S.core.version, X.S.core.binary, X.S.selectedId, X.S.nodes.map((n) => [n.id, n.tag]), X.S.settings.theme, X.S.settings.appearanceMode, document.documentElement.dataset.theme]);
  if (footSig === lastFootSig) return;
  lastFootSig = footSig;
  // sidebar footer: live status, rebuilt only on structural changes; tick updates go through footRefs
  const S = X.S; const st = S.core.state;
  const sel = S.nodes.find((n) => n.id === S.selectedId);
  const foot = document.getElementById('foot');
  foot.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'dot ' + (st === 'running' ? 'run' : st === 'stopped' ? '' : 'wait') }),
      h('b', { ref: 'state' }, { stopped: '内核已停止', starting: '正在启动…', running: '内核运行中', stopping: '正在停止…' }[st] || '内核已停止')),
    h('div', { class: 'row', title: sel ? '当前节点' : '' }, h('span', { class: 't', ref: 'node' }, sel ? nodeDisplayName(sel.tag) : '未选择节点')),
    h('div', { class: 'row', ref: 'speed', style: { visibility: st === 'running' ? 'visible' : 'hidden' } }, '↓ ', h('b', { ref: 'down' }, '-'), '  ↑ ', h('b', { ref: 'up' }, '-')),
    h('div', { class: 'row' }, h('span', { class: 't', title: S && S.core.binary ? S.core.binary : '' }, (S && S.core.version ? S.core.version.replace(/^sing-box version /, 'sing-box ') : '未找到内核')),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn small ghost', title: st === 'running' ? '停止代理' : '启动代理', 'aria-label': st === 'running' ? '停止代理' : '启动代理',
        disabled: st === 'starting' || st === 'stopping' || (st === 'stopped' && !S.nodes.length),
        style: { height: '22px', padding: '0 6px', color: st === 'running' ? 'var(--ok)' : 'var(--ink-3)' },
        onclick: () => act(() => api(st === 'running' ? 'stop' : 'start'), st === 'running' ? '代理已停止' : '代理已启动') },
        svgIcon(ICONS.power)),
      h('button', { class: 'btn small ghost', title: '切换森林/浅色/深色主题', 'aria-label': '切换主题', style: { height: '22px', padding: '0 6px' },
        onclick: () => { const dark = ['dark', 'forest-dark'].includes(document.documentElement.dataset.theme); act(() => api('setSettings', { appearanceMode: dark ? 'light' : 'dark' })); } },
        svgIcon(['dark', 'forest-dark'].includes(document.documentElement.dataset.theme) ? ICONS.sun : ICONS.moon))),
  );
  footRefs = {};
  foot.querySelectorAll('[ref]').forEach((el) => { footRefs[el.getAttribute('ref')] = el; });
}

function render() {
  if (!X.S || window.__composing) return;
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
  applyForest();
}
function go(p) {
  clearTimeout(renderDebounce);
  const changed = page !== p;
  page = p; render(); document.getElementById('main').scrollTop = 0;
  if (changed) view.el.classList.add('viewfade');
  // navigation-only entrance animation (state-driven re-renders stay still: no flicker)

}
window.__go = go; window.__render = render;
window.__applyState = applyState; // test hook: inject a state snapshot (used by verification probes)

const FOREST_CHARACTERS = { home: ['briar', '熊大'], nodes: ['bramble', '熊二'], subs: ['squirrel', '蹦蹦'], rules: ['vick', '光头强'], conns: ['monkey', '毛毛'], geo: ['king', '吉吉'], stats: ['bramble', '熊二'], logs: ['vick', '光头强'], toolbox: ['squirrel', '蹦蹦'], settings: ['king', '吉吉'], about: ['briar', '熊大'] };
function applyForest() {
  if (!view?.el) return;
  const head = view.el.querySelector('.page-head'); if (!head) return;
  let character = head.querySelector('.forest-character');
  if (!character) {
    const [id, name] = FOREST_CHARACTERS[page] || FOREST_CHARACTERS.home;
    character = h('div', { class: 'forest-character character-' + id, role: 'img', 'aria-label': name, title: name });
    head.prepend(character);
  }
}

function applyBrandArtwork() {
  const mark = document.querySelector('.brand .mark');
  if (mark && !mark.style.backgroundImage) mark.style.backgroundImage = "url('assets/brand.png')";
}

function applyTheme() {
  const s = X.S?.settings || {};
  const forest = ['forest', 'forest-dark'].includes(s.theme);
  const isDark = s.appearanceMode === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : s.appearanceMode === 'dark' || (!s.appearanceMode && ['dark', 'forest-dark'].includes(s.theme));
  const t = forest ? (isDark ? 'forest-dark' : 'forest') : (isDark ? 'dark' : 'light');
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}
function applyUiColor(color) {
  const root = document.documentElement;
  if (/^#[0-9a-f]{6}$/i.test(String(color || ''))) { root.style.setProperty('--ui-tint', color); root.dataset.customUi = 'true'; }
  else { root.style.removeProperty('--ui-tint'); delete root.dataset.customUi; }
}
function contrastLuminance(rgb) {
  const linear = rgb.map((v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function parseAppearanceHex(value) {
  const hex = String(value || '').replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return [...hex].map((c) => parseInt(c + c, 16));
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return null;
}
function applyFontColor(color) {
  const root = document.documentElement, rgb = parseAppearanceHex(color);
  const dark = ['dark', 'forest-dark'].includes(root.dataset.theme);
  const bg = parseAppearanceHex(getComputedStyle(root).getPropertyValue('--surface-card').trim()) || (dark ? [25, 29, 36] : [255, 255, 255]);
  const a = rgb && contrastLuminance(rgb), b = contrastLuminance(bg);
  const safe = rgb && (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5;
  if (safe) { const opaque = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''); root.style.setProperty('--ink', opaque); root.style.setProperty('--ink-2', opaque); }
  else { root.style.removeProperty('--ink'); root.style.removeProperty('--ink-2'); }
  root.dataset.fontAdjusted = rgb && !safe ? 'true' : 'false';
}
function applyAccent(color) {
  const root = document.documentElement, rgb = parseAppearanceHex(color);
  for (const name of ['--accent', '--accent-hov', '--accent-soft', '--accent-ink', '--accent-button-text']) root.style.removeProperty(name);
  if (!rgb) return;
  const dark = ['dark', 'forest-dark'].includes(root.dataset.theme);
  const target = dark ? [255, 255, 255] : [0, 0, 0];
  let blend = rgb.slice(); let factor = 0;
  const contrast = (text) => { const a = contrastLuminance(blend), b = contrastLuminance(text); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
  const text = dark ? [15, 20, 17] : [255, 255, 255];
  while (contrast(text) < 4.5 && factor < 1) { factor += .04; blend = rgb.map((v, i) => Math.round(v * (1 - factor) + target[i] * factor)); }
  const hex = '#' + blend.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-hov', `color-mix(in srgb, ${hex}, ${dark ? 'white' : 'black'} 12%)`);
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${hex} ${dark ? 20 : 12}%, var(--surface-card))`);
  root.style.setProperty('--accent-ink', hex);
  root.style.setProperty('--accent-button-text', dark ? '#0f1411' : '#ffffff');
}
function applySkin() {
  const s = X.S && X.S.settings ? X.S.settings : {};
  const allowColors = !['forest', 'forest-dark'].includes(document.documentElement.dataset.theme);
  applyUiColor(allowColors ? s.uiColor : '');
  applyAccent(allowColors ? s.accentColor : '');
  document.documentElement.dataset.fontSize = s.fontSize || 'standard';
  document.documentElement.dataset.density = s.uiDensity || 'standard';
  document.documentElement.style.setProperty('--sidebar-width', (Number(s.sidebarWidth) || 218) + 'px');
  document.querySelector('.side').classList.toggle('collapsed', !!s.sidebarCollapsed);
  const sideToggle = document.getElementById('side-toggle'); sideToggle.setAttribute('aria-expanded', String(!s.sidebarCollapsed));
  // Preserve valid zero opacity and blur values.
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
  document.documentElement.style.setProperty('--wp-blur', num(s.wallpaperBlur, 0) + 'px');
  // frosted glass (independent opacity; text color stays solid)
  document.body.classList.toggle('glass', !!s.glassEnabled);
  document.documentElement.style.setProperty('--glass-pct', Math.round(num(s.glassOpacity, 0.6) * 100) + '%');
  // custom font color: override --ink directly (removing restores the theme default)
  applyFontColor(allowColors ? s.fontColor : '');
}

let lastSkinSig = '';
function applyState(S) {
  const skinSig = JSON.stringify(['theme','wallpaper','wallpaperOpacity','wallpaperBlur','glassEnabled','glassOpacity','fontColor','uiColor','appearanceMode','accentColor','fontSize','uiDensity','sidebarWidth','sidebarCollapsed','windowOpacity'].map((k) => S.settings[k]));
  const skinChanged = skinSig !== lastSkinSig; lastSkinSig = skinSig;
  X.S = S;
  applyBrandArtwork();
  applyTheme(); if (skinChanged) applySkin(); applyForest();
  if (S.samples && S.samples.length && !X.samples.length) X.samples = S.samples.slice();
  if (S.core.state !== 'running') X.samples = [];
  // never wipe a settings form the user is editing
  clearTimeout(renderDebounce);
  if (['settings', 'appearance'].includes(page) && view) {
    renderNav(); if (view.state) view.state(S); return;
  }
  // latency-only changes (a test run is in progress): update in place, no rebuild
  if (stateSig(S) === lastSig && view) { renderNav(); if (view.state) view.state(S); if (skinChanged && view.resize) view.resize(); return; }
  // debounce rapid state changes: multiple pushes within 30ms result in one render
  clearTimeout(renderDebounce);
  renderDebounce = setTimeout(() => render(), 30);
}

window.jj?.on('state', applyState);
document.getElementById('side-toggle').addEventListener('click', () => act(() => api('setSettings', { sidebarCollapsed: !X.S.settings.sidebarCollapsed })));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (X.S?.settings.appearanceMode === 'system') { applyTheme(); applySkin(); renderNav(); if (view?.resize) view.resize(); if (view?.state) view.state(X.S); } });
document.querySelectorAll('[data-window-action]').forEach((button) => button.addEventListener('click', () => act(() => api('winAction', { type: button.dataset.windowAction }))));
window.jj?.on('tick', (t) => {
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
window.jj?.on('log', (l) => { X.logs.push(l); if (X.logs.length > 2000) X.logs.shift(); if (view && view.log) view.log(l); });
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

// Apply the same restrained disclosure motion to expandable lists across every page.
document.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  const details = summary?.parentElement;
  if (!details || details.tagName !== 'DETAILS' || event.target.closest('button,input,select,a') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  event.preventDefault();
  if (details._expanding) return;
  const start = details.getBoundingClientRect().height;
  const opening = !details.open;
  details.open = true;
  const end = opening ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height + parseFloat(getComputedStyle(details).paddingTop) + parseFloat(getComputedStyle(details).paddingBottom) + 2;
  details.style.overflow = 'hidden';
  const animation = details.animate([{ height: start + 'px' }, { height: end + 'px' }], { duration: 220, easing: 'ease-out' });
  const contentAnimations = [...details.children].filter((child) => child !== summary).map((child, index) => child.animate(
    opening
      ? [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translateY(0)' }]
      : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-3px)' }],
    { duration: 180, delay: Math.min(index * 8, 40), easing: 'ease-out', fill: 'both' },
  ));
  details._expanding = animation;
  const settle = () => { clearTimeout(fallback); details.open = opening; details.style.overflow = ''; details._expanding = null; animation.cancel(); contentAnimations.forEach((item) => item.cancel()); };
  const fallback = setTimeout(settle, 260);
  animation.onfinish = settle;
}, true);
