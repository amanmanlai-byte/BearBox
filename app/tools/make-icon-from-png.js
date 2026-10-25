'use strict';
// Build assets/icon.ico, icon.png, tray.png and renderer/assets/brand.png from
// pre-resized square PNGs (produced by resize-icon.ps1 from the user's artwork).
// PNG decode: zlib inflate + scanline unfilter (RGBA8, non-interlaced only).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC = process.env.JJ_ICON_DIR || 'C:/Users/Lenovo/AppData/Local/Temp/jj-bear-icon-out';
const APP = path.join(__dirname, '..');

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let off = 8; let w = 0; let h = 0; let idat = []; let depth = 8; let ctype = 6;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; if (data[12] !== 0) throw new Error('interlaced PNG unsupported'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (ctype !== 6 && ctype !== 2)) throw new Error(`unsupported PNG ${file}: depth=${depth} ctype=${ctype}`);
  const bpp = ctype === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff; }
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4; const s = x * bpp;
      px[d] = cur[s]; px[d + 1] = cur[s + 1]; px[d + 2] = cur[s + 2]; px[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { w, h, d: px };
}

// ---------- PNG encode (from make-icons.js) ----------
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function pngEncode(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) { raw[y * (img.w * 4 + 1)] = 0; Buffer.from(img.d.buffer, y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- ICO with BMP entries ----------
function bmpEntry(img) {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0); head.writeInt32LE(img.w, 4); head.writeInt32LE(img.h * 2, 8);
  head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
  const px = Buffer.alloc(img.w * 4 * img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const s = ((img.h - 1 - y) * img.w + x) * 4; const d = (y * img.w + x) * 4;
    px[d] = img.d[s + 2]; px[d + 1] = img.d[s + 1]; px[d + 2] = img.d[s]; px[d + 3] = img.d[s + 3];
  }
  const maskRow = Buffer.alloc((img.w + 31) >> 5 << 2);
  return Buffer.concat([head, px, Buffer.concat(Array.from({ length: img.h }, () => maskRow))]);
}
function icoEncode(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  const blobs = []; let off = 6 + 16 * images.length;
  images.forEach((im, i) => {
    const e = i * 16;
    entries[e] = im.size >= 256 ? 0 : im.size; entries[e + 1] = im.size >= 256 ? 0 : im.size;
    entries.writeUInt16LE(1, e + 4); entries.writeUInt16LE(32, e + 6);
    entries.writeUInt32LE(im.data.length, e + 8); entries.writeUInt32LE(off, e + 12);
    off += im.data.length; blobs.push(im.data);
  });
  return Buffer.concat([head, entries, ...blobs]);
}

const load = (s) => decodePng(path.join(SRC, `icon-${s}.png`));
const i256 = load(256);
const assets = path.join(APP, 'assets');
const rAssets = path.join(APP, 'src', 'renderer', 'assets');
fs.mkdirSync(assets, { recursive: true }); fs.mkdirSync(rAssets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.ico'), icoEncode([16, 24, 32, 48, 64].map((sz) => ({ size: sz, data: bmpEntry(load(sz)) })).concat([{ size: 256, data: pngEncode(i256) }])));
fs.writeFileSync(path.join(assets, 'icon.png'), pngEncode(i256));
fs.writeFileSync(path.join(assets, 'tray.png'), pngEncode(load(32)));
fs.writeFileSync(path.join(rAssets, 'brand.png'), pngEncode(load(128)));
console.log('Bear Box icons written:', fs.readdirSync(assets).join(', '), '| renderer:', fs.readdirSync(rAssets).join(', '));
