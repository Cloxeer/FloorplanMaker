// flatten.js
// Fine flattening of an (already roughly flat) plan image with three "axes":
//   tilt (up/down), turn (left/right), roll (in-plane), in degrees, as if the camera were
//   rotated about its centre (pinhole model). applyAxes() re-projects the image;
//   estimateAxes() reads the plan's own wall lines and suggests the correction.
// Sign convention: tilt > 0 makes the TOP of the picture recede (top edge shorter),
//   turn > 0 makes the RIGHT side recede (right edge shorter), roll > 0 is clockwise.
// Pure; images are { width, height, data: RGBA Uint8ClampedArray }.
// Depends on: js/model/autobuild/raster.js.

import { warp, downscale, toGray, boxBlur, dilate, erode, components } from './raster.js';

const RAD = Math.PI / 180;
export const LIMITS = { tilt: 35, turn: 35, roll: 15 }; // slider ranges (estimateAxes output)
const HARD = { tilt: 45, turn: 45, roll: 30 };          // applyAxes clamps (never absurd)

// ---- 3x3 helpers (row-major arrays of 9) ----
function mul(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
function inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
function apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}
const num = (v, lim) => (Number.isNaN(v) || v == null ? 0 : Math.max(-lim, Math.min(lim, v)));
function cleanAngles(a) {
  a = a || {};
  return { tilt: num(+a.tilt, HARD.tilt), turn: num(+a.turn, HARD.turn), roll: num(+a.roll, HARD.roll) };
}

// Forward map (source -> output) on centred pixel coords for a camera rotation, focal f px.
function forwardMatrix({ tilt, turn, roll }, f) {
  const t = tilt * RAD, u = turn * RAD, r = roll * RAD;
  const Rx = [1, 0, 0, 0, Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t)];
  const Ry = [Math.cos(u), 0, -Math.sin(u), 0, 1, 0, Math.sin(u), 0, Math.cos(u)];
  const Rz = [Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0, 0, 0, 1];
  const R = mul(Rz, mul(Rx, Ry));
  return mul([f, 0, 0, 0, f, 0, 0, 0, 1], mul(R, [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1]));
}

function insideConvex(q, x, y) {
  let sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sgn && s !== sgn) return false;
    sgn = s;
  }
  return true;
}

// Largest rectangle with the source aspect inside quad q (search over centre and scale k <= 1).
function insideRect(q, hw, hh) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  let best = { k: 0, cx: 0, cy: 0 };
  const G = 16;
  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      const cx = bx0 + ((bx1 - bx0) * i) / G, cy = by0 + ((by1 - by0) * j) / G;
      if (!insideConvex(q, cx, cy)) continue;
      let lo = 0, hi = 1;
      const ok = (k) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => insideConvex(q, cx + sx * hw * k, cy + sy * hh * k));
      if (ok(1)) lo = 1;
      else for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
      if (lo > best.k + 1e-6 || (Math.abs(lo - best.k) < 1e-6 && Math.hypot(cx, cy) < Math.hypot(best.cx, best.cy))) best = { k: lo, cx, cy };
    }
  }
  return best;
}

// { H (3x3 dst->src, pixel coords), outW, outH } for the camera rotation `axes`.
export function axesHomography(width, height, axes = {}, opts = {}) {
  opts = opts || {};
  const w = Math.max(1, Math.round(width) || 1), h = Math.max(1, Math.round(height) || 1);
  const a = cleanAngles(axes);
  const maxSide = Math.max(1, opts.maxSide || 2400);
  const cropMode = opts.crop || 'inside';
  const same = a.tilt === 0 && a.turn === 0 && a.roll === 0;
  const hw = (w - 1) / 2, hh = (h - 1) / 2; // centred pixel extents
  let step = 1; // source px per output px
  const sized = (ow, oh) => {
    const long = Math.max(ow, oh);
    if (long > maxSide) { step = long / maxSide; return [Math.max(1, Math.round(ow / step)), Math.max(1, Math.round(oh / step))]; }
    return [ow, oh];
  };
  if ((same && cropMode !== 'bbox') || (w < 3 && h < 3) || Math.max(w, h) < 3) {
    const [outW, outH] = sized(w, h);
    const sc = outW > 1 ? (w - 1) / (outW - 1) : 1;
    return { H: [sc, 0, 0, 0, sc, 0, 0, 0, 1], outW, outH, identity: same && sc === 1 };
  }
  const f = opts.focal > 0 ? opts.focal : 1.2 * Math.max(w, h);
  let M = forwardMatrix(a, f);
  const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  // a corner swinging behind / next to the camera plane would explode the output: ease the angles
  for (let it = 0; it < 40 && corners.some(([x, y]) => M[6] * x + M[7] * y + M[8] < 0.25); it++) {
    a.tilt *= 0.9; a.turn *= 0.9; a.roll *= 0.9; M = forwardMatrix(a, f);
  }
  const q = corners.map(([x, y]) => apply(M, x, y));
  let cx = 0, cy = 0, rw = 2 * hw, rh = 2 * hh;
  if (cropMode === 'bbox') {
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2; cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    rw = Math.max(...xs) - Math.min(...xs); rh = Math.max(...ys) - Math.min(...ys);
  } else if (cropMode !== 'same') {
    const r = insideRect(q, hw - 0.5, hh - 0.5);
    const k = Math.max(0.6, r.k);
    cx = r.cx; cy = r.cy; rw = 2 * (hw - 0.5) * k; rh = 2 * (hh - 0.5) * k;
  }
  const [outW, outH] = sized(Math.max(1, Math.floor(rw) + 1), Math.max(1, Math.floor(rh) + 1));
  // output pixel (X,Y) -> forward coords -> inverse map -> source pixel
  const T = [step, 0, cx - ((outW - 1) / 2) * step, 0, step, cy - ((outH - 1) / 2) * step, 0, 0, 1];
  const H = mul([1, 0, hw, 0, 1, hh, 0, 0, 1], mul(inv(M), T));
  return { H, outW, outH };
}

// Re-project `image` as if the camera were rotated by { tilt, turn, roll } degrees.
export function applyAxes(image, axes = {}, opts = {}) {
  const { H, outW, outH, identity } = axesHomography(image.width, image.height, axes, opts);
  if (identity && outW === image.width && outH === image.height) {
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }
  return warp(image, H, outW, outH);
}

// ---------------------------------------------------------------------------------------
// estimateAxes: wall-line measurements -> camera rotation
// ---------------------------------------------------------------------------------------

// Dark thin lines on bright paper -> { ink mask, w, h, work scale }; thick rims dropped.
function inkMask(work) {
  const { width: w, height: h } = work;
  let g = toGray(work);
  const sorted = Uint8Array.from(g).sort();
  if (sorted[sorted.length >> 1] < 110) g = g.map((v) => 255 - v); // light lines on a dark sheet
  const mean = boxBlur(g, w, h, Math.max(6, Math.round(Math.max(w, h) / 45)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = g[i] < mean[i] - (10 + 0.06 * mean[i]) && mean[i] > 90 ? 1 : 0;
  const r = Math.max(3, Math.round(Math.max(w, h) / 250));
  const thick = dilate(erode(ink, w, h, r), w, h, r + 1);
  const out = ink.slice();
  let kept = 0, was = 0;
  for (let i = 0; i < out.length; i++) { was += ink[i]; if (thick[i]) out[i] = 0; kept += out[i]; }
  return kept > 300 && kept > 0.4 * was ? out : ink;
}

// Points (centred px, flat [x,y,...]) of the biggest ink cluster, plus its bbox.
function planPoints(ink, w, h, cap = 40000) {
  const bridge = Math.max(4, Math.round(Math.max(w, h) / 90));
  const { labels, comps } = components(dilate(ink, w, h, bridge), w, h, 1);
  if (!comps.length) return null;
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0];
  const all = [];
  for (let y = main.y0; y <= main.y1; y++) for (let x = main.x0; x <= main.x1; x++) if (ink[y * w + x] && labels[y * w + x] === main.id) all.push(x, y);
  const n = all.length / 2;
  if (n < 300) return null;
  const stride = Math.max(1, Math.ceil(n / cap));
  const cx = (w - 1) / 2, cy = (h - 1) / 2, pts = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += stride) {
    const x = all[2 * i], y = all[2 * i + 1];
    pts.push(x - cx, y - cy);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { pts, x0: x0 - cx, x1: x1 - cx, y0: y0 - cy, y1: y1 - cy };
}

// Angle (deg) at which the lines of one family are sharpest among `pts`.
//  'h': direction (cos a, sin a), 'v': direction (sin a, cos a) (a = lean off the axis).
function familyAngle(pts, kind, range, diag) {
  const n = pts.length / 2;
  if (n < 150) return null;
  const hist = new Float32Array(Math.ceil(diag) + 8);
  const score = (a, bin) => {
    const s = Math.sin(a * RAD) / bin, c = Math.cos(a * RAD) / bin, off = diag / (2 * bin) + 2;
    hist.fill(0);
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      hist[((kind === 'h' ? -x * s + y * c : x * c - y * s) + off) | 0]++;
    }
    let t = 0;
    for (let i = 0; i < hist.length; i++) t += hist[i] * hist[i];
    return t;
  };
  let best = 0, bs = -1, sum = 0, cnt = 0;
  for (let a = -range; a <= range + 1e-9; a += 0.5) {
    const s = score(a, 2);
    sum += s; cnt++;
    if (s > bs) { bs = s; best = a; }
  }
  const strength = bs / (sum / cnt);
  let fb = best, fs = -1;
  const vals = [];
  for (let a = best - 0.7; a <= best + 0.7 + 1e-9; a += 0.05) { const s = score(a, 1); vals.push([a, s]); if (s > fs) { fs = s; fb = a; } }
  // centroid of the top plateau (robust to the flat top of thick lines)
  let sw = 0, sa = 0;
  for (const [a, s] of vals) if (s >= 0.97 * fs) { sw += s; sa += a * s; }
  return { angle: sa / sw, strength };
}

// Cost of a rotation for the measured line samples.
function fitCost(v, samples, f, L = 60) {
  const M = forwardMatrix({ tilt: v[0], turn: v[1], roll: v[2] }, f);
  let s = 0;
  for (const m of samples) {
    const dx = m.kind === 'h' ? Math.cos(m.ang) : Math.sin(m.ang), dy = m.kind === 'h' ? Math.sin(m.ang) : Math.cos(m.ang);
    const p = apply(M, m.x - dx * L / 2, m.y - dy * L / 2), q = apply(M, m.x + dx * L / 2, m.y + dy * L / 2);
    const r = (m.kind === 'h' ? Math.atan2(q[1] - p[1], q[0] - p[0]) : Math.atan2(q[0] - p[0], q[1] - p[1])) / RAD;
    const a = Math.abs(r);
    s += m.wt * (a < 0.8 ? r * r : 1.6 * a - 0.64); // Huber: a stray band cannot drag the fit
  }
  return s + 1e-4 * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function fit(samples, f) {
  let v = [0, 0, 0], step = [4, 4, 2], best = fitCost(v, samples, f);
  for (let it = 0; it < 200 && step[0] > 0.004; it++) {
    let improved = false;
    for (let k = 0; k < 3; k++) {
      for (const sg of [1, -1]) {
        const t = v.slice(); t[k] += sg * step[k];
        const c = fitCost(t, samples, f);
        if (c < best) { best = c; v = t; improved = true; }
      }
    }
    if (!improved) step = step.map((s) => s * 0.5);
  }
  return { v, cost: best };
}

// Band/strip measurements of the line families in `pts`: samples for fit(), plus the angle lists.
function measure(pts, range, diag, NB = 6, minStrength = 1.3) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  const samples = [], hList = [], vList = [];
  for (let k = 0; k < NB; k++) {
    const last = k === NB - 1 ? 1 : 0;
    const by0 = y0 + ((y1 - y0) * k) / NB, by1 = y0 + ((y1 - y0) * (k + 1)) / NB + last;
    const bx0 = x0 + ((x1 - x0) * k) / NB, bx1 = x0 + ((x1 - x0) * (k + 1)) / NB + last;
    const hp = [], vp = [];
    let hx = 0, hy = 0, vx = 0, vy = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (y >= by0 && y < by1) { hp.push(x, y); hx += x; hy += y; }
      if (x >= bx0 && x < bx1) { vp.push(x, y); vx += x; vy += y; }
    }
    const a = familyAngle(hp, 'h', range, diag), b = familyAngle(vp, 'v', range, diag);
    if (a && a.strength > minStrength) { samples.push({ x: hx / (hp.length / 2), y: hy / (hp.length / 2), ang: a.angle * RAD, kind: 'h', wt: Math.min(8, a.strength) }); hList.push(+a.angle.toFixed(2)); }
    if (b && b.strength > minStrength) { samples.push({ x: vx / (vp.length / 2), y: vy / (vp.length / 2), ang: b.angle * RAD, kind: 'v', wt: Math.min(8, b.strength) }); vList.push(+b.angle.toFixed(2)); }
  }
  return { samples, hList, vList };
}

// Suggest { tilt, turn, roll, confidence 0..1, detail } that makes the walls axis-aligned and parallel.
// Closed loop: fit from the line angles, apply, re-measure the corrected points, refine (3 passes).
export function estimateAxes(image, opts = {}) {
  const none = (detail) => ({ tilt: 0, turn: 0, roll: 0, confidence: 0, detail });
  if (!image || !(image.width > 8) || !(image.height > 8) || !image.data) return none({ reason: 'no image' });
  const { img: work, scale } = downscale(image, opts.workSide || 900);
  const w = work.width, h = work.height, L = Math.max(w, h);
  const plan = planPoints(inkMask(work), w, h);
  if (!plan) return none({ reason: 'no plan found' });
  const f = opts.focal > 0 ? opts.focal * scale : 1.2 * L;
  const diag = 2 * Math.hypot(w, h);
  let v = [0, 0, 0], first = null, last = null, rms = 0;
  for (let pass = 0; pass < 3; pass++) {
    let pts = plan.pts;
    if (pass) {
      const M = forwardMatrix({ tilt: v[0], turn: v[1], roll: v[2] }, f);
      pts = new Array(plan.pts.length);
      for (let i = 0; i < pts.length; i += 2) { const p = apply(M, plan.pts[i], plan.pts[i + 1]); pts[i] = p[0]; pts[i + 1] = p[1]; }
    }
    const m = measure(pts, pass ? 4 : (opts.range || 15), diag);
    if (m.hList.length + m.vList.length < 3) { if (!pass) return none({ reason: 'too few lines', h: m.hList, v: m.vList }); break; }
    if (!first) first = m;
    last = m;
    const d = fit(m.samples, f);
    const totW = m.samples.reduce((t, s) => t + s.wt, 0);
    rms = Math.sqrt(Math.max(0, d.cost - 1e-4 * (d.v[0] ** 2 + d.v[1] ** 2 + d.v[2] ** 2)) / totW);
    v = v.map((x, k) => x + d.v[k]);
    if (Math.max(...d.v.map(Math.abs)) < 0.03) break;
  }
  const nh = first.hList.length, nv = first.vList.length;
  const avgStrength = first.samples.reduce((t, s) => t + s.wt, 0) / first.samples.length;
  const support = Math.min(1, (nh + nv) / 8) * (nh >= 3 && nv >= 3 ? 1 : 0.6);
  const confidence = Math.max(0, Math.min(1, support * Math.min(1, avgStrength / 3) / (1 + (rms / 0.8) ** 2)));
  return {
    tilt: num(v[0], LIMITS.tilt), turn: num(v[1], LIMITS.turn), roll: num(v[2], LIMITS.roll), confidence,
    detail: { h: first.hList, v: first.vList, hLeft: last.hList, vLeft: last.vList, rmsDeg: +rms.toFixed(3), samples: first.samples.length },
  };
}
