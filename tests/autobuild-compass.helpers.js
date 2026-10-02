// Compass drawing styles + detection harness for the AutoBuild compass tests.

import { analyze } from '../js/model/autobuild/layers.js';
import { footprint } from '../js/model/autobuild/faces.js';
import { components } from '../js/model/autobuild/raster.js';
import { findCompassBest } from '../js/model/autobuild/compass.js';
import { fillRect, drawLine } from './autobuild-geometry.helpers.js';

export const INK = [20, 20, 20];
export const angErr = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function detect(p, textH = 8) {
  const { width: w, height: h } = p.img;
  const layers = analyze(p.img);
  const foot = footprint(layers, w, h, Math.max(w, h));
  const comps = components(layers.ink, w, h, 1, true).comps;
  return findCompassBest(layers, comps, foot.mask, w, h, textH);
}

// N glyph centred at (gx,gy), height gh, tilted by `tilt` degrees (0 = upright)
export function drawN(img, gx, gy, gh, tilt, t = 1.5) {
  const a = (tilt * Math.PI) / 180, gw = gh * 0.7;
  const P = (u, v) => [gx + u * Math.cos(a) - v * Math.sin(a), gy + u * Math.sin(a) + v * Math.cos(a)];
  const seg = (u0, v0, u1, v1) => { const [x0, y0] = P(u0, v0), [x1, y1] = P(u1, v1); drawLine(img, x0, y0, x1, y1, t, INK); };
  seg(-gw / 2, gh / 2, -gw / 2, -gh / 2); seg(gw / 2, gh / 2, gw / 2, -gh / 2); seg(-gw / 2, -gh / 2, gw / 2, gh / 2);
}
export function ring(img, cx, cy, r) {
  for (let k = 0; k < r * 14; k++) { const a = (k / (r * 14)) * Math.PI * 2; fillRect(img, cx + r * Math.cos(a) - 0.5, cy + r * Math.sin(a) - 0.5, cx + r * Math.cos(a) + 0.5, cy + r * Math.sin(a) + 0.5, INK); }
}
export const dirOf = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];

// hairline needle through the ring, N beyond the north tip (tilted with the compass or upright)
export function needleStyle(img, cx, cy, r, deg, tilted) {
  const [dx, dy] = dirOf(deg);
  ring(img, cx, cy, r);
  drawLine(img, cx - dx * r * 2.6, cy - dy * r * 2.6, cx + dx * r * 2.6, cy + dy * r * 2.6, 1, INK);
  drawLine(img, cx + dx * r * 2.6, cy + dy * r * 2.6, cx + dx * r * 2.2 - dy * r * 0.3, cy + dy * r * 2.2 + dx * r * 0.3, 1, INK);
  drawN(img, cx + dx * r * 3.7, cy + dy * r * 3.7, Math.max(8, r * 1.2), tilted ? deg : 0);
}
// four-point star (two crossing diamonds) with the N above the north point
export function starStyle(img, cx, cy, r, deg) {
  const [dx, dy] = dirOf(deg), L = r * 2.4, W = r * 0.45;
  for (const k of [0, 1, 2, 3]) {
    const a = (k * Math.PI) / 2, ex = dx * Math.cos(a) - dy * Math.sin(a), ey = dx * Math.sin(a) + dy * Math.cos(a);
    const len = k === 0 ? L * 1.25 : L;
    for (let s = 0; s <= len; s += 0.5) { const wd = (1 - s / len) * W; for (let u = -wd; u <= wd; u += 0.5) fillRect(img, cx + ex * s - ey * u - 0.5, cy + ey * s + ex * u - 0.5, cx + ex * s - ey * u + 0.5, cy + ey * s + ex * u + 0.5, INK); }
  }
  drawN(img, cx + dx * r * 4.3, cy + dy * r * 4.3, Math.max(8, r * 1.2), 0);
}
// arrow (shaft + filled head), no ring, N beside the head
export function arrowStyle(img, cx, cy, r, deg) {
  const [dx, dy] = dirOf(deg), L = r * 3;
  drawLine(img, cx - dx * L * 0.5, cy - dy * L * 0.5, cx + dx * L * 0.6, cy + dy * L * 0.6, 2, INK);
  for (let s = 0; s <= r; s += 0.5) { const wd = (1 - s / r) * r * 0.6; for (let u = -wd; u <= wd; u += 0.5) fillRect(img, cx + dx * (L * 0.6 + s) - dy * u - 0.5, cy + dy * (L * 0.6 + s) + dx * u - 0.5, cx + dx * (L * 0.6 + s) - dy * u + 0.5, cy + dy * (L * 0.6 + s) + dx * u + 0.5, INK); }
  drawN(img, cx + dx * (L * 0.6 + r * 2.2), cy + dy * (L * 0.6 + r * 2.2), Math.max(8, r * 1.2), 0);
}

