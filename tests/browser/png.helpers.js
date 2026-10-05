// tests/browser/png.helpers.js
// A tiny PNG encoder for the browser specs: a solid colour with a darker border and a diagonal, so pictures
// are distinguishable. Depends on: node:zlib.

import { deflateSync } from 'node:zlib';

// ---- a tiny PNG encoder (solid colour with a darker border and a diagonal, so the pictures are distinguishable)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 6 || y < 6 || x >= w - 6 || y >= h - 6 || Math.abs(x - y) < 4;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = edge ? r >> 1 : r; raw[o + 1] = edge ? g >> 1 : g; raw[o + 2] = edge ? b >> 1 : b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const IMG = (name, w, h, rgb) => ({ name, mimeType: 'image/png', buffer: png(w, h, rgb) });
export const A = () => IMG('a.png', 800, 600, [230, 120, 90]);
export const B = () => IMG('b.png', 500, 700, [90, 160, 230]);
export const C = () => IMG('c.png', 600, 600, [110, 200, 120]);

