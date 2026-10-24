'use strict';
// Hand-drawn canvas charts. No chart library: CSP is default-src 'self' and the
// data (1s polls) is simple enough to render directly. All charts are DPR aware
// and re-read CSS variables on every draw so theme switches apply instantly.

const CVAR = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function prep(canvas) {
  const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth || 1; const hgt = canvas.clientHeight || 1;
  const need = Math.max(1, Math.round(w * dpr)) + 'x' + Math.max(1, Math.round(hgt * dpr));
  if (canvas.width + 'x' + canvas.height !== need) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
  return { g, w, h: hgt };
}
function niceMax(v) {
  if (!(v > 0)) return 1;
  const steps = [1, 2, 2.5, 5, 10]; const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of steps) if (s * p >= v) return s * p; return 10 * p;
}
/** Nice axis maximum in the 1024-based unit the labels use (KB/MB/GB). */
function niceMaxBytes(v) {
  if (!(v > 0)) return 1024;
  const k = Math.max(0, Math.floor(Math.log(v) / Math.log(1024))); const unit = Math.pow(1024, k);
  return niceMax(v / unit) * unit;
}
function roundRect(g, x, y, w, h2, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r);
  g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/** Smooth polyline through points using quadratic midpoints. */
function smoothPath(g, pts) {
  if (!pts.length) return;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2; const my = (pts[i].y + pts[i + 1].y) / 2;
    g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last.x, last.y);
}

/** Live upload/download speed chart with hover crosshair and tooltip. */
class SpeedChart {
  constructor(canvas) {
    this.canvas = canvas; this.samples = []; this.running = false; this.windowSec = 120; this.hover = null;
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
  }
  update(samples, running) { this.samples = samples || []; this.running = !!running; this.draw(); }
  draw() {
    const { g, w, h: H } = prep(this.canvas);
    const pad = { l: 72, r: 14, t: 12, b: 22 };
    const pw = w - pad.l - pad.r; const ph = H - pad.t - pad.b;
    const pts = this.samples.slice(-this.windowSec);
    const font = '11px ' + CVAR('--font');
    g.font = font; g.textBaseline = 'middle';

    // grid + y labels
    const max = niceMaxBytes(Math.max(100 * 1024, ...pts.map((p) => Math.max(p.up || 0, p.down || 0))));
    g.strokeStyle = CVAR('--line-2'); g.lineWidth = 1; g.fillStyle = CVAR('--ink-3');
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ph - (ph * i) / 4;
      g.beginPath(); g.moveTo(pad.l, Math.round(y) + .5); g.lineTo(w - pad.r, Math.round(y) + .5); g.stroke();
      g.textAlign = 'right'; g.fillText(i === 0 ? '0' : fmtSpeed((max * i) / 4), pad.l - 8, y);
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = CVAR('--ink-3');
    g.fillText(`${this.windowSec} 秒前`, pad.l, H - 5); g.textAlign = 'right'; g.fillText('现在', w - pad.r, H - 5);

    if (!this.running || pts.length < 2) {
      g.fillStyle = CVAR('--ink-3'); g.textAlign = 'center'; g.font = '12.5px ' + CVAR('--font');
      g.fillText(this.running ? '正在采集数据…' : '内核未运行，暂无实时数据', pad.l + pw / 2, pad.t + ph / 2);
      return;
    }
    const X = (i) => pad.l + ((i + (this.windowSec - pts.length)) / (this.windowSec - 1)) * pw;
    const Y = (v) => pad.t + ph - (v / max) * ph;
    const mk = (key) => pts.map((p, i) => ({ x: X(i), y: Y(p[key] || 0) }));

    // download area + line
    const down = mk('down');
    const grad = g.createLinearGradient(0, pad.t, 0, pad.t + ph);
    grad.addColorStop(0, CVAR('--down-soft')); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.beginPath(); smoothPath(g, down);
    g.lineTo(down[down.length - 1].x, pad.t + ph); g.lineTo(down[0].x, pad.t + ph); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath(); smoothPath(g, down); g.strokeStyle = CVAR('--down'); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    // upload line
    g.beginPath(); smoothPath(g, mk('up')); g.strokeStyle = CVAR('--up'); g.lineWidth = 1.8; g.stroke();

    // hover crosshair + tooltip
    if (this.hover != null && this.hover >= pad.l && this.hover <= w - pad.r) {
      const idx = Math.max(0, Math.min(pts.length - 1, Math.round(((this.hover - pad.l) / pw) * (this.windowSec - 1) - (this.windowSec - pts.length))));
      const p = pts[idx]; if (p) {
        const x = X(idx);
        g.strokeStyle = CVAR('--ink-3'); g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, pad.t + ph); g.stroke(); g.setLineDash([]);
        for (const [key, color] of [['down', CVAR('--down')], ['up', CVAR('--up')]]) {
          g.beginPath(); g.arc(x, Y(p[key] || 0), 3.2, 0, Math.PI * 2); g.fillStyle = color; g.fill();
          g.strokeStyle = CVAR('--card'); g.lineWidth = 1.5; g.stroke();
        }
        const ago = Math.max(0, pts.length - 1 - idx);
        const lines = [`${ago === 0 ? '现在' : ago + ' 秒前'}`, `↓ ${fmtSpeed(p.down || 0)}`, `↑ ${fmtSpeed(p.up || 0)}`];
        g.font = '11.5px ' + CVAR('--font');
        const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 20;
        const th = lines.length * 17 + 10;
        let bx = x + 12; if (bx + tw > w - 6) bx = x - tw - 12;
        const by = pad.t + 8;
        g.fillStyle = CVAR('--ink'); roundRect(g, bx, by, tw, th, 7); g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1;
        g.fillStyle = CVAR('--bg'); g.textAlign = 'left'; g.textBaseline = 'top';
        lines.forEach((l, i) => { if (i > 0) g.fillStyle = i === 1 ? CVAR('--down') : CVAR('--up'); g.fillText(l, bx + 10, by + 6 + i * 17); });
        g.textBaseline = 'middle';
      }
    }
  }
}

/** Stacked daily traffic bars with hover tooltip. days = [{key,label,up,down}] */
class DailyBars {
  constructor(canvas) { this.canvas = canvas; this.days = []; this.hover = -1;
    canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; this.draw(); });
    canvas.addEventListener('pointerleave', () => { this.hover = -1; this.draw(); });
  }
  update(days) { this.days = days || []; this.draw(); }
  draw() {
    const { g, w, h: H } = prep(this.canvas);
    const pad = { l: 72, r: 8, t: 10, b: 22 };
    const pw = w - pad.l - pad.r; const ph = H - pad.t - pad.b;
    const days = this.days;
    g.font = '11px ' + CVAR('--font'); g.textBaseline = 'middle';
    const max = niceMaxBytes(Math.max(1024 * 1024, ...days.map((d) => (d.down || 0) + (d.up || 0))));
    g.strokeStyle = CVAR('--line-2'); g.fillStyle = CVAR('--ink-3'); g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + ph - (ph * i) / 3;
      g.beginPath(); g.moveTo(pad.l, Math.round(y) + .5); g.lineTo(w - pad.r, Math.round(y) + .5); g.stroke();
      g.textAlign = 'right'; g.fillText(i === 0 ? '0' : fmtBytes((max * i) / 3), pad.l - 8, y);
    }
    if (!days.length) return;
    const bw = pw / days.length; const gap = Math.min(8, bw * 0.34);
    let hit = -1;
    days.forEach((d, i) => {
      const x = pad.l + i * bw + gap / 2; const wd = Math.max(1, bw - gap);
      if (this.hover >= x - gap / 2 && this.hover < x + wd + gap / 2) hit = i;
      const hd = ((d.down || 0) / max) * ph; const hu = ((d.up || 0) / max) * ph;
      const dim = this.hover >= 0 && hit !== i;
      g.globalAlpha = dim ? 0.35 : 1;
      g.fillStyle = CVAR('--down'); g.fillRect(x, pad.t + ph - hd, wd, hd);
      if (hu > 0.5) { g.fillStyle = CVAR('--up'); g.fillRect(x, pad.t + ph - hd - hu, wd, hu); }
      g.globalAlpha = 1;
      if (days.length <= 10 || i % Math.ceil(days.length / 10) === 0) {
        g.fillStyle = hit === i ? CVAR('--ink') : CVAR('--ink-3'); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.fillText(d.label, x + wd / 2, H - 5); g.textBaseline = 'middle';
      }
    });
    if (hit >= 0) {
      const d = days[hit];
      const lines = [d.key, `↓ ${fmtBytes(d.down)}`, `↑ ${fmtBytes(d.up)}`];
      g.font = '11.5px ' + CVAR('--font');
      const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 20;
      const th = lines.length * 17 + 10;
      const bx = Math.min(Math.max(4, pad.l + hit * bw + bw / 2 - tw / 2), w - tw - 4);
      const by = pad.t + 4;
      g.fillStyle = CVAR('--ink'); roundRect(g, bx, by, tw, th, 7); g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1;
      g.textAlign = 'left'; g.textBaseline = 'top';
      lines.forEach((l, i) => { g.fillStyle = i === 0 ? CVAR('--bg') : i === 1 ? CVAR('--down') : CVAR('--up'); g.fillText(l, bx + 10, by + 6 + i * 17); });
      g.textBaseline = 'middle';
    }
  }
}

/** Static donut. parts = [{value, color}] (labels live in HTML). */
function drawDonut(canvas, parts, centerText, centerSub) {
  const { g, w, h: H } = prep(canvas);
  const cx = w / 2; const cy = H / 2; const R = Math.min(w, H) / 2 - 6; const r = R * 0.68;
  if (R < 3) return; // canvas not laid out yet (zero size): skip, next draw paints it
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (!total) {
    g.strokeStyle = CVAR('--line-2'); g.lineWidth = R - r;
    g.beginPath(); g.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2); g.stroke();
  } else {
    let a = -Math.PI / 2;
    for (const p of parts) {
      if (!p.value) continue;
      const a2 = a + (p.value / total) * Math.PI * 2;
      g.strokeStyle = p.color; g.lineWidth = R - r; g.lineCap = 'butt';
      g.beginPath(); g.arc(cx, cy, (R + r) / 2, a, a2); g.stroke();
      a = a2;
    }
  }
  g.fillStyle = CVAR('--ink'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 16px ' + CVAR('--font');
  if (centerText != null) g.fillText(centerText, cx, centerSub ? cy - 8 : cy);
  if (centerSub != null) { g.fillStyle = CVAR('--ink-3'); g.font = '11px ' + CVAR('--font'); g.fillText(centerSub, cx, cy + 11); }
}

/** Mini sparkline with optional soft fill. values = number[] */
function drawSpark(canvas, values, { color = '--down', fill = true } = {}) {
  const { g, w, h: H } = prep(canvas);
  const vs = (values || []).filter((v) => Number.isFinite(v));
  if (vs.length < 2) return;
  const stroke = CVAR(color);
  const pad = 2; const max = Math.max(...vs, 1); const min = Math.min(...vs, 0);
  const span = max - min || 1;
  const X = (i) => pad + (i / (vs.length - 1)) * (w - pad * 2);
  const Y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const pts = vs.map((v, i) => ({ x: X(i), y: Y(v) }));
  if (fill) {
    g.beginPath(); smoothPath(g, pts); g.lineTo(pts[pts.length - 1].x, H); g.lineTo(pts[0].x, H); g.closePath();
    g.save(); g.clip();
    g.globalAlpha = 0.12; g.fillStyle = stroke; g.fillRect(0, 0, w, H);
    g.restore(); g.globalAlpha = 1;
  }
  g.beginPath(); smoothPath(g, pts); g.strokeStyle = stroke; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
  const lastP = pts[pts.length - 1];
  g.beginPath(); g.arc(lastP.x, lastP.y, 2.4, 0, Math.PI * 2); g.fillStyle = stroke; g.fill();
}

// ---------------- world map with day/night terminator ----------------

/** Sub-solar point for a given Date (declination + longitude), good to ~1 degree. */
function subsolarPoint(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = (date.getTime() - start) / 86400000; // day of year, fractional
  const decl = -23.44 * Math.cos((2 * Math.PI / 365.24) * (n + 10)); // degrees
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = -15 * (utcH - 12); // ignore equation of time (±4°, invisible at map scale)
  return { decl, lon: ((lon + 540) % 360) - 180 };
}

/**
 * Draw an equirectangular world map with a real-time day/night terminator.
 * world: GeoJSON FeatureCollection. opts.markers = [{lon,lat,color,r,label,pulse}],
 * opts.arcs = [{from:{lon,lat}, to:{lon,lat}, color, width}] (great-circle-ish quadratic).
 */
function drawWorldMap(canvas, world, opts = {}) {
  const { g, w, h: H } = prep(canvas);
  const PX = (lon) => ((lon + 180) / 360) * w;
  const PY = (lat) => ((90 - lat) / 180) * H;

  // ocean
  g.fillStyle = CVAR('--card-2');
  g.fillRect(0, 0, w, H);
  // graticule
  g.strokeStyle = CVAR('--line-2'); g.lineWidth = 1;
  for (let lon = -150; lon <= 150; lon += 30) { g.beginPath(); g.moveTo(PX(lon), 0); g.lineTo(PX(lon), H); g.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); g.moveTo(0, PY(lat)); g.lineTo(w, PY(lat)); g.stroke(); }

  // land
  g.fillStyle = CVAR('--ink');
  g.globalAlpha = 0.10;
  g.strokeStyle = CVAR('--ink-3'); g.lineWidth = 0.7;
  for (const f of world.features || []) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      for (const ring of poly) {
        if (!ring.length) continue;
        g.beginPath();
        for (let i = 0; i < ring.length; i++) { const x = PX(ring[i][0]); const y = PY(ring[i][1]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.closePath(); g.fill(); g.globalAlpha = 0.28; g.stroke(); g.globalAlpha = 0.10;
      }
    }
  }
  g.globalAlpha = 1;

  // night hemisphere
  const now = opts.date || new Date();
  const { decl, lon: subLon } = subsolarPoint(now);
  const dRad = (decl * Math.PI) / 180;
  g.fillStyle = 'rgba(4, 8, 22, 0.45)';
  g.beginPath();
  const closeSouth = decl > 0; // night contains the pole opposite the sun's declination
  const steps = 90;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const lon = -180 + (360 * i) / steps;
    const hAngle = ((lon - subLon) * Math.PI) / 180;
    const lat = Math.atan(-Math.cos(hAngle) / Math.tan(dRad)) / (Math.PI / 180);
    pts.push([PX(lon), PY(lat)]);
  }
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) g.lineTo(p[0], p[1]);
  const poleY = closeSouth ? H : 0;
  g.lineTo(w, poleY); g.lineTo(0, poleY);
  g.closePath(); g.fill();

  // arcs (below markers)
  for (const a of opts.arcs || []) {
    const x1 = PX(a.from.lon); const y1 = PY(a.from.lat); const x2 = PX(a.to.lon); const y2 = PY(a.to.lat);
    const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2 - Math.min(90, Math.hypot(x2 - x1, y2 - y1) * 0.25);
    g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2);
    g.strokeStyle = a.color || CVAR('--accent'); g.lineWidth = a.width || 1.4; g.globalAlpha = a.alpha == null ? 0.75 : a.alpha; g.stroke(); g.globalAlpha = 1;
  }

  // markers
  for (const m of opts.markers || []) {
    const x = PX(m.lon); const y = PY(m.lat); const r = m.r || 4;
    if (m.pulse) {
      const t = (Date.now() % 1600) / 1600;
      g.beginPath(); g.arc(x, y, r + t * 12, 0, Math.PI * 2);
      g.strokeStyle = m.color; g.globalAlpha = (1 - t) * 0.5; g.lineWidth = 1.5; g.stroke(); g.globalAlpha = 1;
    }
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = m.color; g.fill();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = CVAR('--card'); g.lineWidth = 1.5; g.stroke();
    if (m.label) {
      g.font = '600 11px ' + CVAR('--font');
      const tw = g.measureText(m.label).width;
      const bx = Math.min(Math.max(x + 8, 4), w - tw - 14); const by = Math.max(14, y - 10);
      g.fillStyle = CVAR('--ink'); roundRect(g, bx - 4, by - 9, tw + 8, 15, 4); g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
      g.fillStyle = CVAR('--bg'); g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(m.label, bx, by - 1);
    }
  }
  return { subsolar: { decl, lon: subLon } };
}
