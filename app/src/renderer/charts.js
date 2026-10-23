'use strict';
const CSS = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function prep(canvas) {
  const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth; const hgt = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(hgt * dpr));
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
  return { g, w, h: hgt };
}
function niceMax(v) {
  const steps = [1, 2, 2.5, 5, 10]; const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of steps) if (s * p >= v) return s * p; return 10 * p;
}
/** Nice axis maximum that lands on round numbers in the unit the labels use (1024-based: KB, MB, GB). */
function niceMaxBytes(v) {
  const k = Math.max(0, Math.floor(Math.log(v) / Math.log(1024))); const unit = Math.pow(1024, k);
  return niceMax(v / unit) * unit;
}

/** Live speed chart. `samples` are real 1-second polls of the core's byte counters. */
function drawSpeed(canvas, samples, { running, windowSec = 60 } = {}) {
  const { g, w, h: H } = prep(canvas); const pad = { l: 76, r: 10, t: 8, b: 20 };
  const pw = w - pad.l - pad.r; const ph = H - pad.t - pad.b;
  const pts = samples.slice(-windowSec);
  const max = niceMaxBytes(Math.max(100 * 1024, ...pts.map((p) => Math.max(p.up, p.down))));
  g.font = '11px ' + CSS('--font'); g.textBaseline = 'middle';
  g.strokeStyle = CSS('--line'); g.fillStyle = CSS('--ink-3'); g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ph - (ph * i) / 4; g.beginPath(); g.moveTo(pad.l, Math.round(y) + .5); g.lineTo(w - pad.r, Math.round(y) + .5); g.stroke();
    g.textAlign = 'right'; g.fillText(i === 0 ? '0' : fmtSpeed((max * i) / 4), pad.l - 8, y);
  }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(`${windowSec} 秒前`, pad.l, H - 4); g.textAlign = 'right'; g.fillText('现在', w - pad.r, H - 4);
  if (!running || pts.length < 2) {
    g.fillStyle = CSS('--ink-3'); g.textAlign = 'center'; g.font = '13px ' + CSS('--font');
    g.fillText(running ? '正在采集数据…' : '内核未运行，没有实时数据', pad.l + pw / 2, pad.t + ph / 2); return;
  }
  const X = (i) => pad.l + ((i + (windowSec - pts.length)) / (windowSec - 1)) * pw; const Y = (v) => pad.t + ph - (v / max) * ph;
  const line = (key, color, fill) => {
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[key])) : g.moveTo(X(i), Y(p[key]))));
    g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    if (fill) { g.lineTo(X(pts.length - 1), pad.t + ph); g.lineTo(X(0), pad.t + ph); g.closePath(); g.fillStyle = fill; g.fill(); }
  };
  line('down', CSS('--down'), CSS('--down-soft')); line('up', CSS('--up'), null);
}

/** Stacked daily bars: download (blue) + upload (rose). `days` = [{label, down, up}] */
function drawDaily(canvas, days) {
  const { g, w, h: H } = prep(canvas); const pad = { l: 76, r: 6, t: 8, b: 20 };
  const pw = w - pad.l - pad.r; const ph = H - pad.t - pad.b;
  const max = niceMaxBytes(Math.max(1024 * 1024, ...days.map((d) => d.down + d.up)));
  g.font = '11px ' + CSS('--font'); g.strokeStyle = CSS('--line'); g.fillStyle = CSS('--ink-3'); g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + ph - (ph * i) / 3; g.beginPath(); g.moveTo(pad.l, Math.round(y) + .5); g.lineTo(w - pad.r, Math.round(y) + .5); g.stroke();
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(i === 0 ? '0' : fmtBytes((max * i) / 3), pad.l - 8, y);
  }
  const bw = pw / days.length; const gap = Math.min(10, bw * 0.3);
  days.forEach((d, i) => {
    const x = pad.l + i * bw + gap / 2; const wd = bw - gap;
    const hd = (d.down / max) * ph; const hu = (d.up / max) * ph;
    g.fillStyle = CSS('--down'); g.fillRect(x, pad.t + ph - hd, wd, hd);
    g.fillStyle = CSS('--up'); g.fillRect(x, pad.t + ph - hd - hu, wd, hu);
    if (days.length <= 10 || i % Math.ceil(days.length / 10) === 0) { g.fillStyle = CSS('--ink-3'); g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(d.label, x + wd / 2, H - 4); }
  });
}
