// autobuild-distort-lib.mjs
// Known distortions for a poster image { width, height, data RGBA }: in-plane rotation,
// perspective (tilt/turn), plan-in-photo scale with wall background, brightness gradient,
// shadow band, glare, blur, noise, JPEG-like quantisation. Pure (raster.js only), seeded.
// Used by tools/autobuild-distort.mjs and the rectify robustness tests.
// Depends on: js/model/autobuild/raster.js

import { makeImage, warp, downscale } from '../js/model/autobuild/raster.js';

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
const mul3 = (a, b) => {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
};

// Grey wall with a faint texture (low-frequency blotches + fine speckle).
export function wallBackground(w, h, seed = 7, tone = [128, 124, 118]) {
  const img = makeImage(w, h, 255);
  const r = rng(seed);
  const gw = Math.ceil(w / 40) + 2, gh = Math.ceil(h / 40) + 2;
  const grid = Array.from({ length: gw * gh }, () => (r() - 0.5) * 36);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / 40, fy = y / 40, x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    const v = (grid[y0 * gw + x0] * (1 - ax) + grid[y0 * gw + x0 + 1] * ax) * (1 - ay) + (grid[(y0 + 1) * gw + x0] * (1 - ax) + grid[(y0 + 1) * gw + x0 + 1] * ax) * ay + (r() - 0.5) * 14;
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) img.data[i + c] = clamp8(tone[c] + v);
  }
  return img;
}

// Poster scaled to occupy `frac` of the photo width/height, centred (+ offset), on a wall.
// Returns { image, rect: {x,y,w,h} of the poster in the photo }.
export function placeInPhoto(img, frac, opts = {}) {
  const cap = opts.maxSide || 3000;
  let src = img;
  let W = Math.round(img.width / frac), H = Math.round(img.height / frac);
  if (Math.max(W, H) > cap) { const d = downscale(img, Math.round((Math.max(img.width, img.height) * cap) / Math.max(W, H))); src = d.img; W = Math.round(src.width / frac); H = Math.round(src.height / frac); }
  const out = opts.bg || wallBackground(W, H, opts.seed || 7);
  const ox = Math.round((W - src.width) / 2 + (opts.dx || 0) * W), oy = Math.round((H - src.height) / 2 + (opts.dy || 0) * H);
  for (let y = 0; y < src.height; y++) {
    const yy = y + oy;
    if (yy < 0 || yy >= H) continue;
    for (let x = 0; x < src.width; x++) {
      const xx = x + ox;
      if (xx < 0 || xx >= W) continue;
      const i = (yy * W + xx) * 4, j = (y * src.width + x) * 4;
      out.data[i] = src.data[j]; out.data[i + 1] = src.data[j + 1]; out.data[i + 2] = src.data[j + 2];
    }
  }
  return { image: out, rect: { x: ox, y: oy, w: src.width, h: src.height } };
}

// Camera-like distortion about the image centre: in-plane `rot`, `tilt` about x, `turn` about y (degrees).
// Pixels that fall outside the source take `bg(x, y)` (default the wall tone). Returns { image, H (src->dst) }.
export function perspective(img, { rot = 0, tilt = 0, turn = 0, f = 1.3 } = {}) {
  const { width: w, height: h } = img;
  const L = Math.max(w, h), d = f * L, R = Math.PI / 180;
  const [cz, sz, cx, sx, cy, sy] = [Math.cos(rot * R), Math.sin(rot * R), Math.cos(tilt * R), Math.sin(tilt * R), Math.cos(turn * R), Math.sin(turn * R)];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1], Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rm = mul3(Rz, mul3(Rx, Ry));
  const P = [Rm[0], Rm[1], 0, Rm[3], Rm[4], 0, Rm[6] / d, Rm[7] / d, 1];
  const Hs = mul3([1, 0, w / 2, 0, 1, h / 2, 0, 0, 1], mul3(P, [1, 0, -w / 2, 0, 1, -h / 2, 0, 0, 1]));
  const Hd = inv3(Hs);
  const ink = warp(img, Hd, w, h);
  const probe = makeImage(w, h, 0);
  const inside = warp(probe, Hd, w, h);
  const bgImg = wallBackground(w, h, 11);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (inside.data[o] > 128) for (let c = 0; c < 3; c++) ink.data[o + c] = bgImg.data[o + c];
    else if (inside.data[o] > 0) { const a = inside.data[o] / 255; for (let c = 0; c < 3; c++) ink.data[o + c] = ink.data[o + c] * (1 - a) + bgImg.data[o + c] * a; }
  }
  return { image: ink, H: Hs };
}

function eachPixel(img, fn) {
  const { width: w, height: h, data } = img;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const k = fn(x, y, w, h);
    if (k) for (let c = 0; c < 3; c++) data[i + c] = clamp8(k.mul != null ? data[i + c] * k.mul : data[i + c] + k.add);
  }
  return img;
}
const copy = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

// brightness falls off linearly across the photo (strength 0..1: darkest side loses that share)
export function gradient(img, strength = 0.35, angle = 25) {
  const a = (angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  return eachPixel(copy(img), (x, y, w, h) => ({ mul: 1 - strength * (0.5 + ((x / w - 0.5) * ca + (y / h - 0.5) * sa) / (Math.abs(ca) + Math.abs(sa))) }));
}
// soft dark band (the shadow of a bar, a hand or the photographer) across the photo, about a quarter of the width
export function shadowBand(img, strength = 0.4) {
  return eachPixel(copy(img), (x, y, w, h) => { const t = (x / w - y / h * 0.4 - 0.45) / 0.17; return { mul: 1 - strength * Math.exp(-t * t) }; });
}
export function glare(img, strength = 0.9, cx = 0.65, cy = 0.35, rad = 0.12) {
  return eachPixel(copy(img), (x, y, w, h) => { const g = Math.exp(-(((x / w - cx) ** 2 + (y / h - cy) ** 2) / (2 * rad * rad))); return { add: strength * 120 * g * (1 - 0) }; });
}
export function noise(img, sigma = 12, seed = 5) {
  const r = rng(seed), out = copy(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() + r() + r() + r() - 2) * 1.732 * sigma; // ~ N(0, sigma)
    const c = (r() + r() + r() + r() - 2) * 0.5 * sigma;
    d[i] = clamp8(d[i] + n + c); d[i + 1] = clamp8(d[i + 1] + n); d[i + 2] = clamp8(d[i + 2] + n - c);
  }
  return out;
}
export function blur(img, sigma = 1.5) {
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.ceil(sigma * 3)), k = [];
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const pass = (src, horiz) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let t = 0;
      for (let i = -r; i <= r; i++) {
        const xx = horiz ? Math.min(w - 1, Math.max(0, x + i)) : x, yy = horiz ? y : Math.min(h - 1, Math.max(0, y + i));
        t += src[(yy * w + xx) * 4 + c] * k[i + r];
      }
      out[(y * w + x) * 4 + c] = t;
    }
    return out;
  };
  const a = pass(img.data, true), b = pass(a, false);
  const out = copy(img);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = b[i + c] + 0.5;
  return out;
}
// 8x8 DCT quantisation of every channel (JPEG-like blocking and ringing); q 1..100
export function jpegLike(img, q = 35) {
  const { width: w, height: h } = img;
  const sc = q < 50 ? 5000 / q : 200 - 2 * q;
  const base = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
  const Q = base.map((v) => Math.max(1, Math.round((v * sc) / 100)));
  const C = Array.from({ length: 8 }, (_, u) => Array.from({ length: 8 }, (_, x) => (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
  const out = copy(img);
  const blk = new Float64Array(64), tmp = new Float64Array(64);
  for (let by = 0; by + 8 <= h; by += 8) for (let bx = 0; bx + 8 <= w; bx += 8) for (let c = 0; c < 3; c++) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = img.data[((by + y) * w + bx + x) * 4 + c] - 128;
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let t = 0; for (let x = 0; x < 8; x++) t += blk[y * 8 + x] * C[u][x]; tmp[y * 8 + u] = t; }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let t = 0; for (let y = 0; y < 8; y++) t += tmp[y * 8 + u] * C[v][y]; blk[v * 8 + u] = Math.round(t / Q[v * 8 + u]) * Q[v * 8 + u]; }
    for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let t = 0; for (let u = 0; u < 8; u++) t += blk[v * 8 + u] * C[u][x]; tmp[v * 8 + x] = t; }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let t = 0; for (let v = 0; v < 8; v++) t += tmp[v * 8 + x] * C[v][y]; out.data[((by + y) * w + bx + x) * 4 + c] = clamp8(t + 128); }
  }
  return out;
}

// name -> (img) => { image, truth: { rot, tilt, turn, frac } }
const geo = (rot, tilt, turn) => (img) => ({ image: perspective(img, { rot, tilt, turn }).image, truth: { rot, tilt, turn } });
const frac = (f) => (img) => ({ image: placeInPhoto(img, f).image, truth: { frac: f } });
const photo = (fn) => (img) => ({ image: fn(img), truth: {} });
export const DISTORTIONS = {
  'rot+1': geo(1, 0, 0), 'rot-3': geo(-3, 0, 0), 'rot+3': geo(3, 0, 0), 'rot+6': geo(6, 0, 0), 'rot-6': geo(-6, 0, 0),
  'tilt+5': geo(0, 5, 0), 'tilt-10': geo(0, -10, 0), 'tilt+18': geo(0, 18, 0),
  'turn+5': geo(0, 0, 5), 'turn-10': geo(0, 0, -10), 'turn+18': geo(0, 0, 18),
  'frac70': frac(0.7), 'frac40': frac(0.4),
  'gradient': photo((i) => gradient(i, 0.45)), 'shadow': photo((i) => shadowBand(i, 0.4)), 'glare': photo((i) => glare(i, 1)),
  'blur1': photo((i) => blur(i, 1)), 'blur2': photo((i) => blur(i, 2)),
  'noise6': photo((i) => noise(i, 6)), 'noise12': photo((i) => noise(i, 12)), 'noise20': photo((i) => noise(i, 20)),
  'jpeg': photo((i) => jpegLike(i, 30)),
  'combo-mild': (img) => { const p = placeInPhoto(img, 0.8).image; return { image: noise(blur(gradient(perspective(p, { rot: 2, tilt: 6, turn: -5 }).image, 0.3), 1), 8), truth: { rot: 2, tilt: 6, turn: -5, frac: 0.8 } }; },
  'combo-hard': (img) => { const p = placeInPhoto(img, 0.6).image; return { image: jpegLike(noise(blur(shadowBand(gradient(perspective(p, { rot: -4, tilt: -12, turn: 10 }).image, 0.4), 0.4), 1), 12), 40), truth: { rot: -4, tilt: -12, turn: 10, frac: 0.6 } }; },
};
