// rectifyTilt.js
// Wall tilt measurement for rectify: the angle that makes the wall strokes of one family
// sharpest when projected, found coarse-to-fine over a wide range; per-band / per-strip samples.
// Pure.
// Depends on: js/model/autobuild/rectifyFit.js (RAD).

import { RAD } from './rectifyFit.js';

const BINS = 4096;
const hist = new Float32Array(BINS);

// sum of squared bin counts of the projected points: grows as the strokes line up
function sharpness(pts, kind, deg) {
  const r = deg * RAD, c = Math.cos(r), s = Math.sin(r);
  hist.fill(0);
  if (kind === 'h') for (let i = 0; i < pts.length; i += 2) hist[(-pts[i] * s + pts[i + 1] * c + BINS / 2) | 0]++;
  else for (let i = 0; i < pts.length; i += 2) hist[(pts[i] * c + pts[i + 1] * s + BINS / 2) | 0]++;
  let score = 0;
  for (let i = 0; i < BINS; i++) score += hist[i] * hist[i];
  return score;
}

// Angle (deg) that makes lines of one family sharpest in a set of centred ink points [x, y, x, y ...].
// kind 'h': horizontal walls (project on y'), 'v': vertical walls (project on x').
// Returns { angle, strength (best / mean score), peak (best / second best distinct peak) } or null.
export function familyTilt(pts, kind, range = 12, minPts = 200) {
  if (pts.length / 2 < minPts) return null;
  const coarse = 0.5;
  const n = Math.round((2 * range) / coarse) + 1;
  const sc = new Float64Array(n);
  let sum = 0, bi = 0;
  for (let k = 0; k < n; k++) {
    sc[k] = sharpness(pts, kind, -range + k * coarse);
    sum += sc[k];
    if (sc[k] > sc[bi]) bi = k;
  }
  const mean = sum / n;
  // the strongest rival peak at least 2 degrees away: a clear winner has a clear margin over it
  let rival = 0;
  for (let k = 0; k < n; k++) if (Math.abs(k - bi) * coarse >= 2 && sc[k] > rival) rival = sc[k];
  let best = -range + bi * coarse, bestScore = sc[bi];
  const lo = best - coarse, hi = best + coarse;
  for (let a = lo; a <= hi + 1e-9; a += 0.05) {
    const s = sharpness(pts, kind, a);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return { angle: best, strength: bestScore / (mean || 1), peak: rival ? bestScore / rival : 9 };
}

// Band / strip samples of a stroke mask inside box [x0..x1] x [y0..y1] (work px): for each of N bands
// across the plan, the tilt of the horizontal walls (kind 'h') and of N strips the vertical walls ('v').
// Returns [{ x, y, ang (rad), kind, wt, deg, strength }] in centred coordinates (cx0, cy0 = image centre).
export function tiltSamples(mask, ww, box, cx0, cy0, N = 4, range = 12) {
  const { x0, y0, x1, y1 } = box;
  const out = [];
  for (let k = 0; k < N; k++) {
    const by0 = y0 + ((y1 - y0) * k) / N, by1 = y0 + ((y1 - y0) * (k + 1)) / N;
    const bx0 = x0 + ((x1 - x0) * k) / N, bx1 = x0 + ((x1 - x0) * (k + 1)) / N;
    const hp = [], vp = [];
    let hx = 0, hy = 0, hn = 0, vx = 0, vy = 0, vn = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * ww;
      const inH = y >= by0 && y < by1;
      for (let x = x0; x <= x1; x++) {
        if (!mask[row + x]) continue;
        if (inH) { hp.push(x - cx0, y - cy0); hx += x; hy += y; hn++; }
        if (x >= bx0 && x < bx1) { vp.push(x - cx0, y - cy0); vx += x; vy += y; vn++; }
      }
    }
    const h = familyTilt(hp, 'h', range), v = familyTilt(vp, 'v', range);
    // a best angle at the edge of the search range is a guess, not a measurement
    const ok = (t) => t && t.strength > 1.2 && Math.abs(t.angle) < range - 0.4;
    if (ok(h)) out.push({ x: hx / hn - cx0, y: hy / hn - cy0, ang: h.angle * RAD, kind: 'h', wt: Math.min(8, h.strength) * Math.min(1.5, 0.5 + h.peak / 4), deg: +h.angle.toFixed(2), strength: h.strength });
    if (ok(v)) out.push({ x: vx / vn - cx0, y: vy / vn - cy0, ang: -v.angle * RAD, kind: 'v', wt: Math.min(8, v.strength) * Math.min(1.5, 0.5 + v.peak / 4), deg: +(-v.angle).toFixed(2), strength: v.strength });
  }
  return out;
}
