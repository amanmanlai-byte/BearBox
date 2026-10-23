'use strict';
// DOM helpers. Text is always inserted as text nodes: node names and logs come from subscriptions, so they are untrusted.
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
const SVG = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };

function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
const fmtSpeed = (n) => fmtBytes(n) + '/s';
function fmtDur(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); const hh = Math.floor(m / 60); return hh ? `${hh}时${m % 60}分` : m ? `${m}分${s % 60}秒` : `${s}秒`; }
function fmtTime(t) { if (!t) return '从未'; const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function latClass(n) { if (n.testedAt == null) return 'none'; if (n.latency == null) return 'bad'; return n.latency <= 200 ? 'good' : n.latency <= 500 ? 'mid' : 'slow'; }
const LAT_COLOR = { good: 'var(--ok)', mid: '#7cc24a', slow: 'var(--warn)', bad: 'var(--bad)', none: '#c3cbdb' };

function toast(msg, isErr) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), isErr ? 6500 : 3200);
}
async function api(name, args) { const r = await window.jj.call(name, args); if (r.error) throw new Error(r.error); return r.data; }
async function act(fn, okMsg, btn) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
function modal(title, body, actions) {
  const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) bg.remove(); } }, h('div', { class: 'modal' }, h('h3', {}, title), body, h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } }, actions(() => bg.remove()))));
  document.body.append(bg); return bg;
}
