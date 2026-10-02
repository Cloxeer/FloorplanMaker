// Synthetic poster generator for the AutoBuild geometry tests (text-free).
// Draws a building (rooms on both sides of a corridor) in a configurable style
// and returns the image plus the ground-truth room rectangles.

import { makeImage } from '../js/model/autobuild/raster.js';

// deterministic PRNG
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function fillRect(img, x0, y0, x1, y1, rgb) {
  const { width: w, height: h, data } = img;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(h, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(w, Math.round(x1)); x++) {
      const i = (y * w + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
}

// rectangle outline `t` thick, centred on the rect edge
export function strokeRect(img, x0, y0, x1, y1, t, rgb) {
  const a = t / 2;
  fillRect(img, x0 - a, y0 - a, x1 + a, y0 + a, rgb);
  fillRect(img, x0 - a, y1 - a, x1 + a, y1 + a, rgb);
  fillRect(img, x0 - a, y0 - a, x0 + a, y1 + a, rgb);
  fillRect(img, x1 - a, y0 - a, x1 + a, y1 + a, rgb);
}

export function drawLine(img, x0, y0, x1, y1, t, rgb) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
    fillRect(img, x - t / 2, y - t / 2, x + t / 2, y + t / 2, rgb);
  }
}

// style: { W,H, wall (gray 0-255), t (wall px), double (gap px or 0), tint [r,g,b]|null,
//          noise, glare (0-1 gradient strength), blur (box radius), paper (gray), inverted }
export function poster(style = {}) {
  const s = {
    W: 1000, H: 760, wall: 30, t: 2, double: 0, tint: null, noise: 0, glare: 0, blur: 0, paper: 255,
    cols: 5, lShape: false, seed: 3, ...style,
  };
  const img = makeImage(s.W, s.H, 255);
  fillRect(img, 0, 0, s.W, s.H, s.paperRGB || [s.paper, s.paper, s.paper]);
  const bx0 = Math.round(s.W * 0.12), bx1 = Math.round(s.W * 0.88);
  const by0 = Math.round(s.H * 0.16), by1 = Math.round(s.H * 0.84);
  const rowH = Math.round((by1 - by0) * 0.34);
  const midY0 = by0 + rowH, midY1 = by1 - rowH; // corridor band
  const colW = (bx1 - bx0) / s.cols;
  const wallRgb = s.wallRGB || [s.wall, s.wall, s.wall];
  const rooms = [];
  const cutCol = s.lShape ? s.cols - 2 : s.cols; // L: bottom row stops short
  for (let c = 0; c < s.cols; c++) {
    const x0 = Math.round(bx0 + c * colW), x1 = Math.round(bx0 + (c + 1) * colW);
    rooms.push({ x: x0, y: by0, w: x1 - x0, h: rowH });
    if (c < cutCol) rooms.push({ x: x0, y: midY1, w: x1 - x0, h: rowH });
  }
  if (s.tint) for (const r of rooms) fillRect(img, r.x, r.y, r.x + r.w, r.y + r.h, s.tint);
  for (const r of rooms) {
    if (s.double) {
      strokeRect(img, r.x - s.double, r.y - s.double, r.x + r.w + s.double, r.y + r.h + s.double, s.t, wallRgb);
      strokeRect(img, r.x + s.double, r.y + s.double, r.x + r.w - s.double, r.y + r.h - s.double, s.t, wallRgb);
    } else strokeRect(img, r.x, r.y, r.x + r.w, r.y + r.h, s.t, wallRgb);
  }
  // corridor outer walls (building outline)
  const lastX = Math.round(bx0 + cutCol * colW);
  drawLine(img, bx0, midY0, bx0, midY1, s.t, wallRgb);
  drawLine(img, bx1, midY0, bx1, midY1, s.t, wallRgb);
  if (s.lShape) {
    drawLine(img, lastX, midY1, bx1, midY1, s.t, wallRgb);
    drawLine(img, lastX, midY1, lastX, midY1 + rowH, s.t, wallRgb);
  }
  // post effects
  const rand = rng(s.seed);
  const { data } = img;
  if (s.glare || s.noise) {
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      const i = (y * s.W + x) * 4;
      const g = s.glare ? s.glare * 255 * Math.exp(-(((x - s.W * 0.7) ** 2 + (y - s.H * 0.35) ** 2) / (2 * (s.W * 0.2) ** 2))) : 0;
      const shade = s.glare ? -s.glare * 60 * (x / s.W) : 0;
      for (let c = 0; c < 3; c++) {
        const n = s.noise ? (rand() + rand() + rand() - 1.5) * 2 * s.noise : 0;
        data[i + c] = Math.max(0, Math.min(255, data[i + c] + g * (1 - data[i + c] / 600) + shade + n));
      }
    }
  }
  if (s.blur) {
    const src = new Uint8ClampedArray(data);
    const r = s.blur;
    for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) {
      for (let c = 0; c < 3; c++) {
        let t = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= s.W || yy >= s.H) continue;
          t += src[(yy * s.W + xx) * 4 + c]; n++;
        }
        data[(y * s.W + x) * 4 + c] = t / n;
      }
    }
  }
  if (s.inverted) for (let i = 0; i < data.length; i += 4) { data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2]; }
  return { img, rooms, building: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, style: s };
}

export function addExitSign(img, x, y, w, h, rgb) {
  fillRect(img, x, y, x + w, y + h, rgb);
  fillRect(img, x + w * 0.2, y + h * 0.3, x + w * 0.8, y + h * 0.7, [255, 255, 255]);
}

// compass: ring, needle (dark half points north, light half south) and an "N" beyond the dark tip
export function addCompass(img, cx, cy, r, deg, ink = [20, 20, 20]) {
  const a = (deg * Math.PI) / 180;
  const dir = [Math.sin(a), -Math.cos(a)], perp = [-dir[1], dir[0]];
  const ringN = Math.ceil(r * 12);
  for (let k = 0; k < ringN; k++) {
    const t = (k / ringN) * Math.PI * 2;
    const x = cx + r * Math.cos(t), y = cy + r * Math.sin(t);
    fillRect(img, x - 0.5, y - 0.5, x + 0.5, y + 0.5, ink);
  }
  const len = r * 4.2;
  for (let s = 0; s <= len; s += 0.5) {
    const wdt = (1 - s / len) * r * 0.45;
    for (let u = -wdt; u <= wdt; u += 0.5) {
      const x = cx + dir[0] * s + perp[0] * u, y = cy + dir[1] * s + perp[1] * u;
      fillRect(img, x - 0.5, y - 0.5, x + 0.5, y + 0.5, ink);
    }
  }
  drawLine(img, cx, cy, cx - dir[0] * len * 0.8, cy - dir[1] * len * 0.8, 1, [90, 90, 90]);
  // N glyph, upright, centred beyond the tip
  const gx = cx + dir[0] * (len + r * 1.6), gy = cy + dir[1] * (len + r * 1.6), gh = Math.max(6, r * 1.1), gw = gh * 0.7;
  drawLine(img, gx - gw / 2, gy + gh / 2, gx - gw / 2, gy - gh / 2, 1.5, ink);
  drawLine(img, gx + gw / 2, gy + gh / 2, gx + gw / 2, gy - gh / 2, 1.5, ink);
  drawLine(img, gx - gw / 2, gy - gh / 2, gx + gw / 2, gy + gh / 2, 1.5, ink);
}

// stair treads: `n` parallel lines (vertical when dir is 'v')
export function addStair(img, x, y, len, n, gap, dir, rgb = [25, 25, 25]) {
  for (let k = 0; k < n; k++) {
    if (dir === 'v') drawLine(img, x + k * gap, y, x + k * gap, y + len, 1, rgb);
    else drawLine(img, x, y + k * gap, x + len, y + k * gap, 1, rgb);
  }
}
