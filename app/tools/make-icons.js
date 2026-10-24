'use strict';
// Generates the app icon set with zero external dependencies:
//   assets/icon.ico      multi-size ICO (BMP entries 16-64 + PNG entry 256)
//   assets/icon.png      256x256 PNG (window/Linux use)
//   assets/tray.png      32x32 PNG (tray)
// Logo: rounded square with a blue→violet diagonal gradient and a white lightning bolt.
// Run: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

// ---------- pixel canvas ----------
function rgba(w, h) { return { w, h, d: new Uint8ClampedArray(w * h * 4) }; }
function put(img, x, y, r, g, b, a) {
  const i = (y * img.w + x) * 4;
  // alpha compositing (source over)
  const sa = a / 255; const da = img.d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) { img.d[i] = img.d[i + 1] = img.d[i + 2] = img.d[i + 3] = 0; return; }
  img.d[i] = Math.round((r * sa + img.d[i] * da * (1 - sa)) / oa);
  img.d[i + 1] = Math.round((g * sa + img.d[i + 1] * da * (1 - sa)) / oa);
  img.d[i + 2] = Math.round((b * sa + img.d[i + 2] * da * (1 - sa)) / oa);
  img.d[i + 3] = Math.round(oa * 255);
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Bolt outline in unit square coordinates (percent-based polygon, tuned by eye). */
const BOLT = [[0.555, 0.06], [0.27, 0.52], [0.44, 0.52], [0.375, 0.94], [0.73, 0.42], [0.545, 0.42], [0.675, 0.06]];
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawLogo(size) {
  const img = rgba(size, size);
  const S = 3; // supersampling
  const c1 = [0x3b, 0x82, 0xf6]; // blue #3b82f6
  const c2 = [0x8b, 0x5c, 0xf6]; // violet #8b5cf6
  const radius = size * 0.225;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0; let gt = 0; let bolt = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S; const py = y + (sy + 0.5) / S;
          // signed distance to the rounded-rect boundary, <0 inside
          const qx = Math.max(Math.abs(px - size / 2) - (size / 2 - radius), 0);
          const qy = Math.max(Math.abs(py - size / 2) - (size / 2 - radius), 0);
          const sd = Math.sqrt(qx * qx + qy * qy) - radius;
          const c = 1 - smooth(-1, 1, sd);
          cov += c;
          if (c > 0.5) {
            gt += (px + py) / (2 * size);
            if (inPoly(px / size, py / size, BOLT)) bolt++;
          }
        }
      }
      const covA = cov / (S * S);
      if (covA <= 0) continue;
      const gtAvg = gt / Math.max(1, cov);
      const r = lerp(c1[0], c2[0], gtAvg); const g = lerp(c1[1], c2[1], gtAvg); const b = lerp(c1[2], c2[2], gtAvg);
      put(img, x, y, r, g, b, covA * 255);
      if (bolt > 0) {
        // bolt subsamples only count inside the covered area; scale back to full pixel alpha
        const boltA = Math.min(1, bolt / cov) * covA;
        if (boltA > 0) put(img, x, y, 255, 255, 255, boltA * 255);
      }
    }
  }
  return img;
}

// ---------- PNG encode ----------
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngEncode(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0; // filter none
    Buffer.from(img.d.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO ----------
function bmpEntry(img) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(img.w, 4); head.writeInt32LE(img.h * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  const px = Buffer.alloc(img.w * 4 * img.h); // bottom-up BGRA
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const s = ((img.h - 1 - y) * img.w + x) * 4; const d = (y * img.w + x) * 4;
      px[d] = img.d[s + 2]; px[d + 1] = img.d[s + 1]; px[d + 2] = img.d[s]; px[d + 3] = img.d[s + 3];
    }
  }
  const maskRow = Buffer.alloc((img.w + 31) >> 5 << 2); // all zeros: alpha is authoritative
  const mask = Buffer.concat(Array.from({ length: img.h }, () => maskRow));
  return Buffer.concat([head, px, mask]);
}
function icoEncode(images) {
  const count = images.length;
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  const blobs = [];
  let off = 6 + 16 * count;
  images.forEach((im, i) => {
    const e = 16 * i;
    entries[i * 16 + 0] = im.size >= 256 ? 0 : im.size;
    entries[e + 1] = im.size >= 256 ? 0 : im.size;
    entries[e + 2] = 0; entries[e + 3] = 0;
    entries.writeUInt16LE(1, e + 4); entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(im.data.length, e + 8); entries.writeUInt32LE(off, e + 12);
    off += im.data.length;
    blobs.push(im.data);
  });
  return Buffer.concat([head, entries, ...blobs]);
}

// ---------- build ----------
fs.mkdirSync(OUT, { recursive: true });
const big = drawLogo(256);
fs.writeFileSync(path.join(OUT, 'icon.png'), pngEncode(big));
fs.writeFileSync(path.join(OUT, 'tray.png'), pngEncode(drawLogo(32)));
const ico = icoEncode([16, 24, 32, 48, 64].map((s) => ({ size: s, data: bmpEntry(drawLogo(s)) })).concat([{ size: 256, data: pngEncode(big) }]));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
console.log('icons written to', OUT, fs.readdirSync(OUT).join(', '));
