'use strict';
const NAV = [
  ['home', '概览', 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'],
  ['nodes', '节点', 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 100 8 4 4 0 000-8z'],
  ['subs', '订阅', 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3'],
  ['rules', '代理规则', 'M4 6h16M4 12h10M4 18h6M18 14l3 3-3 3'],
  ['conns', '连接', 'M8 7h8M8 17h8M5 4v6M19 14v6M5 10a2 2 0 100-4M19 20a2 2 0 100-4'],
  ['stats', '流量统计', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['logs', '运行日志', 'M4 5h16M4 10h16M4 15h10M4 20h7'],
  ['settings', '设置', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.6 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.6-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'],
];
let page = 'home'; let view = null;

function renderNav() {
  const nav = document.getElementById('nav'); nav.replaceChildren(...NAV.map(([id, label, d]) => h('button', { class: id === page ? 'on' : '', onclick: () => go(id), 'aria-current': id === page ? 'page' : null }, SVG(d), label)));
  const S = X.S; const st = S.core.state;
  const foot = document.getElementById('foot');
  foot.replaceChildren(h('div', { class: 'pill-state' }, h('span', { class: 'dot ' + (st === 'running' ? 'run' : st === 'stopped' ? '' : 'wait') }), h('b', {}, { stopped: '内核已停止', starting: '正在启动', running: '内核运行中', stopping: '正在停止' }[st])),
    h('div', {}, S.core.version ? S.core.version.replace(/^sing-box version /, 'sing-box ') : '未找到内核'));
}

function render() {
  if (!X.S) return;
  if (view && view.destroy) view.destroy();
  view = PAGES[page](); const main = document.getElementById('main'); const top = main.scrollTop;
  main.replaceChildren(view.el); main.scrollTop = top; renderNav();
}
function go(p) { page = p; render(); document.getElementById('main').scrollTop = 0; }
window.__go = go; window.__render = render;

function applyState(S) {
  X.S = S;
  if (S.samples && S.samples.length && !X.samples.length) X.samples = S.samples.slice();
  if (S.core.state !== 'running') X.samples = [];
  const keep = ['settings'].includes(page) && document.activeElement && document.activeElement.closest && document.activeElement.closest('.main') && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (keep) { renderNav(); return; } // don't wipe a form while the user is typing
  render();
}

window.jj.on('state', applyState);
window.jj.on('tick', (t) => { X.samples.push({ t: t.t, up: t.up, down: t.down }); if (X.samples.length > 300) X.samples.shift(); if (X.S) { const d = new Date(); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; X.S.daily = { ...X.S.daily, [k]: t.today }; X.S.today = t.today; X.S.session = { upTotal: t.upTotal, downTotal: t.downTotal, memory: t.memory }; } if (view && view.tick) view.tick(t); });
window.jj.on('log', (l) => { X.logs.push(l); if (X.logs.length > 2000) X.logs.shift(); if (view && view.log) view.log(l); });
window.addEventListener('resize', () => view && view.resize && view.resize());

(async () => {
  try { X.logs = await api('logs'); applyState(await api('state')); } catch (e) { document.getElementById('main').textContent = '加载失败：' + e.message; }
})();
