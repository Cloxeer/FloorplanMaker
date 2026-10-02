// symbols.js
// Finds the non-room things printed on a poster plan: exit signs, the
// elevator pictogram, stair treads and the compass. Pure; works on a
// straightened plan raster and its layers.
// Depends on: js/model/autobuild/raster.js.

import { components, dilate } from './raster.js';

// Exit signs = big, solid red or green boxes (extinguishers are thin, pull stations small).
// Green running-man signs are the common alternative to red ones.
export function findExitSigns(layers, w, h, textH) {
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = layers.red[i] | (layers.green ? layers.green[i] : 0);
  const sig = dilate(raw, w, h, 1);
  const { comps } = components(sig, w, h, 1, true);
  const out = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const fill = c.area / (bw * bh);
    const lo = Math.min(bw, bh), hi = Math.max(bw, bh);
    if (lo < textH * 2.2 || hi < textH * 3 || hi / lo > 2.6 || fill < 0.42) continue;
    let g = 0;
    if (layers.green) for (let y = c.y0; y <= c.y1; y += 2) for (let x = c.x0; x <= c.x1; x += 2) g += layers.green[y * w + x];
    out.push({ x: c.x0, y: c.y0, w: bw, h: bh, cx: (c.x0 + c.x1) / 2, cy: (c.y0 + c.y1) / 2, color: g > 0.3 * (c.area / 4) ? 'green' : 'red' });
  }
  return out;
}

// Elevator pictogram: a closed square box with arrows and two tall figures in it.
// Slides a square window over the ink; accepts a window whose four sides are
// inked, whose inside is busy, and that holds >=2 tall figure blobs.
export function findElevators(layers, w, h, textH, comps) {
  const ink = layers.ink;
  // row / column prefix sums of ink, so side coverage is O(1)
  const rowP = new Int32Array((w + 1) * h), colP = new Int32Array(w * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowP[y * (w + 1) + x + 1] = rowP[y * (w + 1) + x] + ink[y * w + x];
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) colP[(y + 1) * w + x] = colP[y * w + x] + ink[y * w + x];
  const sumP = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) { run += ink[y * w + x]; sumP[(y + 1) * (w + 1) + x + 1] = sumP[y * (w + 1) + x + 1] + run; }
  }
  const rowSum = (y, x0, x1) => rowP[y * (w + 1) + x1 + 1] - rowP[y * (w + 1) + x0];
  const colSum = (x, y0, y1) => colP[(y1 + 1) * w + x] - colP[y0 * w + x];
  const box = (x0, y0, x1, y1) => sumP[(y1 + 1) * (w + 1) + x1 + 1] - sumP[y0 * (w + 1) + x1 + 1] - sumP[(y1 + 1) * (w + 1) + x0] + sumP[y0 * (w + 1) + x0];
  const out = [];
  const smin = Math.round(textH * 2.2), smax = Math.round(textH * 4.6);
  const ins = Math.max(3, Math.round(smin * 0.07)); // inset that skips the box outline
  for (let s = smin; s <= smax; s++) {
    for (let y = 1; y + s < h - 1; y += 1) {
      for (let x = 1; x + s < w - 1; x += 1) {
        // top side first (cheap reject)
        if (rowSum(y, x, x + s) + rowSum(y + 1, x, x + s) < 1.0 * s) continue;
        if (rowSum(y + s, x, x + s) + rowSum(y + s - 1, x, x + s) < 1.0 * s) continue;
        if (colSum(x, y, y + s) + colSum(x + 1, y, y + s) < 1.0 * s) continue;
        if (colSum(x + s, y, y + s) + colSum(x + s - 1, y, y + s) < 1.0 * s) continue;
        const inner = box(x + ins, y + ins, x + s - ins, y + s - ins) / ((s - 2 * ins + 1) * (s - 2 * ins + 1));
        if (inner < 0.26 || inner > 0.75) continue;
        let tall = 0;
        for (const c of comps) {
          if (c.x0 < x + 2 || c.x1 > x + s - 2 || c.y0 < y + 2 || c.y1 > y + s - 2) continue;
          if (c.y1 - c.y0 + 1 >= 0.3 * s) tall++;
        }
        if (tall < 2) continue;
        out.push({ x, y, w: s + 1, h: s + 1, cx: x + s / 2, cy: y + s / 2, density: inner });
      }
    }
  }
  out.sort((a, b) => b.density - a.density);
  const kept = [];
  for (const o of out) if (!kept.some((k) => Math.abs(k.cx - o.cx) < textH * 3 && Math.abs(k.cy - o.cy) < textH * 3)) kept.push(o);
  return kept;
}

// Stairs live in stairs.js (same signature).
export { findStairs } from './stairs.js';

// Needle of a compass: the ink connected to the ring, outside the ring itself, is one
// elongated stroke through the middle; its heavier (filled, dark) half points north.
// -> { deg, elong, skew, len } or null.
function needleOf(ink, w, h, cx, cy, r) {
  const reach = r * 6.5;
  const seen = new Set();
  const stack = [];
  const x0 = Math.round(cx), y0 = Math.round(cy);
  const rr = Math.ceil(r + 2);
  for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (dx * dx + dy * dy <= (r + 2) * (r + 2) && x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x]) { seen.add(y * w + x); stack.push(y * w + x); }
  }
  const pts = [];
  while (stack.length && seen.size < 6000) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d > r + 2) pts.push([dx, dy]);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (!ink[q] || seen.has(q) || Math.hypot(nx - cx, ny - cy) > reach) continue;
      seen.add(q); stack.push(q);
    }
  }
  if (pts.length < 8) return null;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += x * x; syy += y * y; sxy += x * y; } // about the ring centre
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let sp = 0, sa = 0, mxp = 0;
  for (const [x, y] of pts) { const p = x * ux + y * uy; sp += p; sa += Math.abs(p); if (Math.abs(p) > mxp) mxp = Math.abs(p); }
  const skew = sa ? sp / sa : 0;
  const sign = skew >= 0 ? 1 : -1;
  const deg = (Math.atan2(sign * ux, -(sign * uy)) * 180) / Math.PI;
  return { deg: ((deg % 360) + 360) % 360, elong: Math.sqrt(l1 / l2), skew: Math.abs(skew), len: mxp / r };
}

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Compass: a small ring outside the building (circle Hough on ink). North comes from the
// "N" letter next to it, refined by the needle inside; a ring with a clear arrow needle
// but no readable "N" is accepted too. -> { x, y, deg, r } or null.
export function findCompass(comps, footMask, w, h, textH, paper, ink) {
  const rMin = Math.max(5, Math.round(textH * 0.9)), rMax = Math.round(textH * 2.6);
  let px = [];
  const L = Math.max(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    // compasses sit outside the building, usually toward a corner or an edge of the plan
    if (ink[i] && !footMask[i] && (!paper || paper[i])) px.push(x, y);
  }
  if (px.length < 80) return null;
  const cap = 9000; // Hough votes cost px * radii * steps: sample very busy margins
  let keepFrac = 1;
  if (px.length / 2 > cap) { const k = Math.ceil(px.length / 2 / cap); px = px.filter((_, j) => ((j >> 1) % k) === 0); keepFrac = 1 / k; }
  const cands = [];
  const acc = new Int16Array(w * h);
  for (let r = rMin; r <= rMax; r++) {
    acc.fill(0);
    const steps = Math.max(24, Math.round(r * 5));
    for (let k = 0; k < px.length; k += 2) {
      for (let a = 0; a < steps; a++) {
        const cx = Math.round(px[k] + r * Math.cos((a * 2 * Math.PI) / steps)), cy = Math.round(px[k + 1] + r * Math.sin((a * 2 * Math.PI) / steps));
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx]++;
      }
    }
    const need = 2 * Math.PI * r * 0.55 * keepFrac;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (acc[y * w + x] < need * 0.25) continue;
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += acc[(y + dy) * w + x + dx];
      v /= 2.2;
      if (v < need) continue;
      // a compass has its needle through the middle; a letter O is hollow
      let mid = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mid += ink[(y + dy) * w + x + dx];
      if (mid < 3) continue;
      cands.push({ score: v / (2 * Math.PI * r), x, y, r });
    }
  }
  if (!cands.length) return null;
  const corner = (c) => ((c.x < 0.32 * w || c.x > 0.68 * w) && (c.y < 0.22 * h || c.y > 0.78 * h) ? 1 : 0);
  cands.sort((a, b) => corner(b) - corner(a) || b.score - a.score);
  // best few distinct rings; the first one that is a compass wins
  const tried = [], results = [];
  for (const best of cands) {
    if (tried.length >= 14) break;
    if (tried.some((t) => Math.hypot(t.x - best.x, t.y - best.y) < Math.max(3, best.r * 0.4))) continue;
    tried.push(best);
    const nd = needleOf(ink, w, h, best.x, best.y, best.r);
    const clean = nd && nd.elong >= 4 && nd.len >= 2;
    // the "N": a small glyph in the cone one end of the needle points into (the other end when
    // the shading misleads), or, without a needle, the glyph nearest the ring
    const glyphIn = (centreDeg) => {
      let found = null, bd = 1e9;
      for (const c of comps) {
        const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
        if (bh < textH * 0.55 || bh > textH * 1.8 || bw > textH * 1.6) continue;
        const sx = (c.x0 + c.x1) / 2, sy = (c.y0 + c.y1) / 2;
        const d = Math.hypot(sx - best.x, sy - best.y);
        if (d < best.r * 0.9 || d > best.r * 3.4 + textH * 2 + (clean ? best.r * 3 : 0)) continue;
        if (centreDeg != null) {
          const a = ((Math.atan2(sx - best.x, -(sy - best.y)) * 180) / Math.PI + 360) % 360;
          if (angDiff(a, centreDeg) > 30) continue;
        }
        if (d < bd) { bd = d; found = { sx, sy }; }
      }
      return found;
    };
    let nBox = null, ndeg = nd ? nd.deg : 0, rank = 0;
    if (clean) {
      const fwd = glyphIn(nd.deg), back = glyphIn((nd.deg + 180) % 360);
      if (fwd) { nBox = fwd; rank = 3; }
      else if (back) { nBox = back; ndeg = (nd.deg + 180) % 360; rank = 2; }
      else rank = 1;
    } else nBox = glyphIn(null);
    if (clean && (nBox || (corner(best) && nd.skew >= 0.3))) {
      results.push({ rank, score: best.score, c: { x: best.x, y: best.y, deg: Math.round(ndeg) % 360, r: best.r, via: nBox ? 'needle+n' : 'needle' } });
      continue;
    }
    if (nBox && corner(best) && !clean) {
      const deg = (Math.atan2(nBox.sx - best.x, -(nBox.sy - best.y)) * 180) / Math.PI;
      results.push({ rank: 0.5, score: best.score, c: { x: best.x, y: best.y, deg: Math.round(((deg % 360) + 360) % 360) % 360, r: best.r, via: 'n' } });
    }
  }
  if (results.length) {
    results.sort((a, b) => b.rank - a.rank || b.score - a.score);
    return results[0].c;
  }
  return null;
}
