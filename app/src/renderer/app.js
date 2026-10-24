'use strict';
// App shell: sidebar navigation, theme, IPC wiring. Pages live in pages.js and
// receive live updates through view.tick / view.log callbacks instead of re-renders.
const NAV = [
  ['home', '概览', ICONS.home],
  ['nodes', '节点', ICONS.nodes],
  ['subs', '订阅', ICONS.subs],
  ['rules', '代理规则', ICONS.rules],
  ['conns', '连接', ICONS.conns],
  ['stats', '流量统计', ICONS.stats],
  ['logs', '运行日志', ICONS.logs],
  ['settings', '设置', ICONS.settings],
];
// Shared mutable context: current state snapshot, live sample buffer, log buffer, UI prefs.
const X = {
  S: null, samples: [], logs: [],
  nodeFilter: '', nodeSort: 'default', nodeSubFilter: 'all',
  logLevel: 'all', logSearch: '', logFollow: true,
  connSearch: '', connNet: 'all',
};
let page = 'home'; let view = null; let footRefs = null;

const isRunning = () => X.S && X.S.core.state === 'running';
const modeName = (m) => (m === 'global' ? '全局' : '规则');
const dayKeyOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function renderNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...NAV.map(([id, label, icon]) => h('button', { class: id === page ? 'on' : '', onclick: () => go(id), 'aria-current': id === page ? 'page' : null }, svgIcon(icon), label)));
  // sidebar footer: live status, rebuilt only on state changes; tick updates go through footRefs
  const S = X.S; const st = S ? S.core.state : 'stopped';
  const sel = S ? S.nodes.find((n) => n.id === S.selectedId) : null;
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
  view = PAGES[page]();
  const main = document.getElementById('main'); const top = main.scrollTop;
  main.replaceChildren(view.el); main.scrollTop = top;
  keepFocus.restore(view.el);
  renderNav();
}
function go(p) { page = p; render(); document.getElementById('main').scrollTop = 0; }
window.__go = go; window.__render = render;

function applyTheme() {
  const t = X.S && X.S.settings && X.S.settings.theme === 'dark' ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}

function applyState(S) {
  X.S = S;
  applyTheme();
  if (S.samples && S.samples.length && !X.samples.length) X.samples = S.samples.slice();
  if (S.core.state !== 'running') X.samples = [];
  // never wipe a settings form the user is editing; other pages re-render
  if (page === 'settings' && document.activeElement && document.activeElement.closest && document.activeElement.closest('.main') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    renderNav(); return;
  }
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
          'JiajiaBox 的界面必须由 JiajiaBox.exe 加载，浏览器里没有它的数据通道，所以这里没有内容。',
          h('br'), '请到程序文件夹中双击 JiajiaBox.exe 启动。'))));
    return;
  }
  try { X.logs = await api('logs'); applyState(await api('state')); } catch (e) {
    const main = document.getElementById('main'); if (main) main.textContent = '加载失败：' + e.message;
  }
})();
