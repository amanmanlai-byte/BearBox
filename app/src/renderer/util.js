'use strict';
// DOM helpers and shared UI utilities. Text is always inserted as text nodes:
// node names, log lines and subscription content come from untrusted input.

function h(tag, props, ...kids) {
  const e = document.createElement(tag); const post = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') post.push([k, v]);
    else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  for (const [k, v] of post) e[k] = v;
  return e;
}
function svgIcon(d) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  for (const dd of [].concat(d)) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', dd); s.append(p); }
  return s;
}

// 24x24 line icon paths
const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10.5V20h5v-6h3v6h5v-9.5',
  nodes: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  subs: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  rules: 'M4 6h16M4 12h10M4 18h6M18 14l3 3-3 3',
  conns: 'M8 7h8M8 17h8M5 4v6M19 14v6M5 10a2 2 0 1 0 0-4M19 20a2 2 0 1 0 0-4',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  logs: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z'],
  power: 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0',
  bolt: 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13 6 5h12l2 8v6H4v-6z',
  close: 'M6 6l12 12M18 6 6 18',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z',
  toolbox: 'M13 3v4h8V3zM11 3H3v18h8zM13 9v12h8V9zM15.5 12.5h3M15.5 15.5h3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  pin: 'M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  gauge: 'M12 20a8 8 0 1 1 8-8M12 12l4.5-4.5M2.5 12h2M12 2.5v2',
};

// ---------- formatters ----------
function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
const fmtSpeed = (n) => fmtBytes(n) + '/s';
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); const hh = Math.floor(m / 60); return hh ? `${hh}时${m % 60}分` : m ? `${m}分${s % 60}秒` : `${s}秒`; }
function fmtTime(t) { if (!t) return '从未'; const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function fmtDate(t) { if (!t) return '-'; const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function latClass(n) { if (n.testedAt == null) return 'none'; if (n.latency == null) return 'bad'; return n.latency <= 200 ? 'good' : n.latency <= 500 ? 'mid' : 'slow'; }
const LAT_COLOR = { good: 'var(--ok)', mid: '#84cc16', slow: 'var(--warn)', bad: 'var(--bad)', none: 'var(--ink-3)' };
const LAT_NAME = { good: '良好 ≤200ms', mid: '一般 ≤500ms', slow: '较慢 >500ms', bad: '超时/失败', none: '未测试' };

// ---------- api plumbing ----------
async function api(name, args) { const r = await window.jj.call(name, args); if (r.error) throw new Error(r.error); return r.data; }
async function act(fn, okMsg, btn) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
function toast(msg, isErr) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), isErr ? 6500 : 3200);
}
function modal(title, body, actions, wide) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h('div', { class: 'modal', style: wide ? { width: 'min(720px, 94vw)' } : null }, h('h3', {}, title), body,
      h('div', { class: 'modal-foot' }, actions(() => bg.remove()))));
  document.body.append(bg); return bg;
}

// ---------- page building blocks ----------
function pageHead(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'sub-title' }, subtitle) : null), h('div', { class: 'sp' }), h('div', { class: 'actions' }, actions));
}
function emptyState(icon, title, text, ...actions) {
  return h('div', { class: 'card' }, h('div', { class: 'empty' }, svgIcon(ICONS[icon] || ICONS.inbox), h('b', {}, title), h('div', { class: 'note' }, text), actions.length ? h('div', { class: 'actions' }, actions) : null));
}
const goto = (p) => window.__go(p);

// ---------- node flag emoji (display-only; the original name is never modified) ----------
const FLAG_CN = [
  ['香港', '\u{1F1ED}\u{1F1F0}'], ['台湾', '\u{1F1F9}\u{1F1FC}'], ['日本', '\u{1F1EF}\u{1F1F5}'],
  ['韩国', '\u{1F1F0}\u{1F1F7}'], ['新加坡', '\u{1F1F8}\u{1F1EC}'], ['美国', '\u{1F1FA}\u{1F1F8}'],
  ['英国', '\u{1F1EC}\u{1F1E7}'], ['德国', '\u{1F1E9}\u{1F1EA}'], ['法国', '\u{1F1EB}\u{1F1F7}'],
  ['巴西', '\u{1F1E7}\u{1F1F7}'], ['荷兰', '\u{1F1F3}\u{1F1F1}'], ['土耳其', '\u{1F1F9}\u{1F1F7}'],
  ['俄罗斯', '\u{1F1F7}\u{1F1FA}'], ['印度', '\u{1F1EE}\u{1F1F3}'], ['加拿大', '\u{1F1E8}\u{1F1E6}'],
  ['澳大利亚', '\u{1F1E6}\u{1F1FA}'], ['澳洲', '\u{1F1E6}\u{1F1FA}'], ['马来西亚', '\u{1F1F2}\u{1F1FE}'],
  ['马来', '\u{1F1F2}\u{1F1FE}'], ['泰国', '\u{1F1F9}\u{1F1ED}'], ['越南', '\u{1F1FB}\u{1F1F3}'],
  ['菲律宾', '\u{1F1F5}\u{1F1ED}'], ['印尼', '\u{1F1EE}\u{1F1E9}'], ['阿根廷', '\u{1F1E6}\u{1F1F7}'],
  ['意大利', '\u{1F1EE}\u{1F1F9}'], ['西班牙', '\u{1F1EA}\u{1F1F8}'], ['瑞典', '\u{1F1F8}\u{1F1EA}'],
  ['瑞士', '\u{1F1E8}\u{1F1ED}'], ['爱尔兰', '\u{1F1EE}\u{1F1EA}'], ['以色列', '\u{1F1EE}\u{1F1F1}'],
  ['阿联酋', '\u{1F1E6}\u{1F1EA}'], ['波兰', '\u{1F1F5}\u{1F1F1}'], ['乌克兰', '\u{1F1FA}\u{1F1E6}'],
  ['蒙古', '\u{1F1F2}\u{1F1F3}'], ['埃及', '\u{1F1EA}\u{1F1EC}'], ['南非', '\u{1F1FF}\u{1F1E6}'],
  ['墨西哥', '\u{1F1F2}\u{1F1FD}'], ['智利', '\u{1F1E8}\u{1F1F1}'], ['哥伦比亚', '\u{1F1E8}\u{1F1F4}'],
];
const FLAG_CODE = [
  ['HK', '\u{1F1ED}\u{1F1F0}'], ['TW', '\u{1F1F9}\u{1F1FC}'], ['JP', '\u{1F1EF}\u{1F1F5}'],
  ['KR', '\u{1F1F0}\u{1F1F7}'], ['SG', '\u{1F1F8}\u{1F1EC}'], ['US', '\u{1F1FA}\u{1F1F8}'],
  ['UK', '\u{1F1EC}\u{1F1E7}'], ['GB', '\u{1F1EC}\u{1F1E7}'], ['DE', '\u{1F1E9}\u{1F1EA}'],
  ['FR', '\u{1F1EB}\u{1F1F7}'], ['BR', '\u{1F1E7}\u{1F1F7}'], ['NL', '\u{1F1F3}\u{1F1F1}'],
  ['TR', '\u{1F1F9}\u{1F1F7}'], ['RU', '\u{1F1F7}\u{1F1FA}'], ['IN', '\u{1F1EE}\u{1F1F3}'],
  ['CA', '\u{1F1E8}\u{1F1E6}'], ['AU', '\u{1F1E6}\u{1F1FA}'], ['MY', '\u{1F1F2}\u{1F1FE}'],
  ['TH', '\u{1F1F9}\u{1F1ED}'], ['VN', '\u{1F1FB}\u{1F1F3}'], ['PH', '\u{1F1F5}\u{1F1ED}'],
  ['ID', '\u{1F1EE}\u{1F1E9}'], ['AR', '\u{1F1E6}\u{1F1F7}'], ['IT', '\u{1F1EE}\u{1F1F9}'],
  ['ES', '\u{1F1EA}\u{1F1F8}'],
];
// Detect the country flag for a node name. Returns '' if no match or a flag is already present.
function nodeFlag(name) {
  if (!name) return '';
  if (/\u{1F1E6}-\u{1F1FF}/u.test(name)) return '';
  for (const pair of FLAG_CN) { if (name.includes(pair[0])) return pair[1]; }
  const m = /^[A-Z]{2}(?=[\d\s\-_\u00b7]|$)/.exec(name.trim());
  if (m) { for (const pair of FLAG_CODE) { if (pair[0] === m[0]) return pair[1]; } }
  return '';
}
// Node display name: flag prefix + original tag (the original is never modified).
function nodeDisplayName(tag) { const f = nodeFlag(tag); return f ? f + ' ' + tag : tag; }

/**
 * Preserve the focused input across a full page re-render.
 * Elements opt in with data-keep="key"; call keepFocus.save() before replacing
 * the DOM and keepFocus.restore(root) after.
 */
const keepFocus = {
  save() {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && a.dataset.keep) {
      this._s = { key: a.dataset.keep, value: a.value, selStart: a.selectionStart, selEnd: a.selectionEnd, tag: a.tagName };
    } else this._s = null;
  },
  restore(root) {
    if (!this._s) return;
    const el = root.querySelector(`[data-keep="${CSS.escape(this._s.key)}"]`);
    if (el && el.tagName === this._s.tag) {
      el.value = this._s.value; el.focus();
      try { el.setSelectionRange(this._s.selStart, this._s.selEnd); } catch { /* not a text input */ }
    }
    this._s = null;
  },
};
