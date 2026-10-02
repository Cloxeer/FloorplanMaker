// recall.js
// Recall helpers for AutoBuild: (1) the translucent blue "You are here" pin hides
// wall lines and room numbers; pinPass() re-reads the faint strokes under it and
// carries walls straight across it, so the cells under the pin become real faces;
// (2) recoverUnlabeledCells() lists walled cells the label-driven passes of the
// pipeline did not turn into rooms, with the reason, and rejects corridors,
// symbols, stair hatches and blank paper. Pure, scale-invariant (every radius
// follows the image size or the text height).
// Depends on: js/model/autobuild/raster.js.

import { boxBlur, dilate, erode, components } from './raster.js';

// Big, compact blue blob = the pin. Arrows are thin, legend swatches small.
export function findPin(blue, w, h, L) {
  const R = Math.max(2, Math.round(L / 250));
  const closed = erode(dilate(blue, w, h, R), w, h, R);
  const { labels, comps } = components(closed, w, h, 1, true);
  let best = null;
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (Math.min(bw, bh) < 0.022 * L || Math.max(bw, bh) / Math.min(bw, bh) > 2.4) continue;
    if (c.area / (bw * bh) < 0.4) continue;
    if (!best || c.area > best.area) best = c;
  }
  if (!best) return null;
  const mask = new Uint8Array(w * h);
  for (let y = best.y0; y <= best.y1; y++) for (let x = best.x0; x <= best.x1; x++) if (labels[y * w + x] === best.id) mask[y * w + x] = 1;
  // fill the holes (extinguisher, text) : background pieces not reaching the box edge
  const bx0 = Math.max(0, best.x0 - 1), by0 = Math.max(0, best.y0 - 1), bx1 = Math.min(w - 1, best.x1 + 1), by1 = Math.min(h - 1, best.y1 + 1);
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  const inv = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) inv[y * bw + x] = mask[(y + by0) * w + x + bx0] ? 0 : 1;
  const bg = components(inv, bw, bh, 1);
  const outer = new Set();
  for (let x = 0; x < bw; x++) { outer.add(bg.labels[x]); outer.add(bg.labels[(bh - 1) * bw + x]); }
  for (let y = 0; y < bh; y++) { outer.add(bg.labels[y * bw]); outer.add(bg.labels[y * bw + bw - 1]); }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (inv[y * bw + x] && !outer.has(bg.labels[y * bw + x])) mask[(y + by0) * w + x + bx0] = 1;
  return { mask, bbox: { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 } };
}

// thin dark lines of one orientation under a smooth tint: response = side average minus centre, averaged along the line
function lineResponse(gray, w, h, box, half, off, vertical) {
  const resp = new Float32Array(w * h);
  const n = 2 * half + 1;
  const m = half + off + 1;
  for (let y = Math.max(m, box.y0); y <= Math.min(h - 1 - m, box.y1); y++) for (let x = Math.max(m, box.x0); x <= Math.min(w - 1 - m, box.x1); x++) {
    let a = 0, b = 0;
    for (let k = -half; k <= half; k++) {
      if (vertical) { a += gray[(y + k) * w + x]; b += gray[(y + k) * w + x - off] + gray[(y + k) * w + x + off]; }
      else { a += gray[y * w + x + k]; b += gray[(y - off) * w + x + k] + gray[(y + off) * w + x + k]; }
    }
    resp[y * w + x] = (b / 2 - a) / n;
  }
  return resp;
}

// Re-reads the pin: clears the pin (and its dark rim) from `ink` / `colored`, adds the faint wall lines
// and the number strokes seen through it, and carries walls across it. Mutates ink and colored.
// Returns the pin mask (rim included) or null when there is no pin.
export function pinPass({ gray, blue, red, green, ink, colored, w, h }) {
  const L = Math.max(w, h);
  const pin = findPin(blue, w, h, L);
  if (!pin) return null;
  const rimW = Math.max(3, Math.round(L / 330));
  const P = dilate(pin.mask, w, h, rimW);
  const off = Math.max(2, Math.round(L / 580)), half = Math.max(4, Math.round(L / 190));
  const inner = erode(P, w, h, rimW + off + 1);
  const box = { x0: pin.bbox.x0 - rimW - 2, y0: pin.bbox.y0 - rimW - 2, x1: pin.bbox.x1 + rimW + 2, y1: pin.bbox.y1 + rimW + 2 };
  // strokes seen through the tint: numbers (darker than a small neighbourhood) ...
  const bg = boxBlur(gray, w, h, Math.max(2, Math.round(L / 430)));
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < seen.length; i++) if (inner[i] && bg[i] - gray[i] > 12) seen[i] = 1;
  // ... and long faint lines (walls)
  const T = 3, minLen = 3 * half;
  for (const vertical of [false, true]) {
    const resp = lineResponse(gray, w, h, box, half, off, vertical);
    const cand = new Uint8Array(w * h);
    for (let i = 0; i < cand.length; i++) if (inner[i] && resp[i] > T) cand[i] = 1;
    const { labels, comps } = components(cand, w, h, 1, true);
    const keep = new Uint8Array(comps.length + 1);
    for (const c of comps) {
      const len = vertical ? c.y1 - c.y0 + 1 : c.x1 - c.x0 + 1, wid = vertical ? c.x1 - c.x0 + 1 : c.y1 - c.y0 + 1;
      if (len >= minLen && wid <= 2 * off + 3) keep[c.id] = 1;
    }
    for (let i = 0; i < cand.length; i++) if (labels[i] && keep[labels[i]]) seen[i] = 1;
  }
  const sym = dilate(red.map((v, i) => (v | green[i]) & 1), w, h, 1);
  for (let i = 0; i < ink.length; i++) {
    if (!P[i]) continue;
    ink[i] = seen[i] && !sym[i] ? 1 : 0;
    colored[i] = sym[i];
  }
  // walls carried straight across the pin: a wall touching the pin on both sides, or on one side and a line seen inside
  const reach = Math.round(0.6 * Math.min(pin.bbox.x1 - pin.bbox.x0, pin.bbox.y1 - pin.bbox.y0));
  const gap = rimW + off + 4, minOut = Math.max(8, Math.round(L / 150));
  const outside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && !P[y * w + x] && ink[y * w + x];
  const bridge = (vertical) => {
    const add = [];
    for (let p = vertical ? box.x0 : box.y0; p <= (vertical ? box.x1 : box.y1); p++) {
      let s = -1;
      for (let a = vertical ? box.y0 : box.x0; a <= (vertical ? box.y1 : box.x1) + 1; a++) {
        const inP = a <= (vertical ? box.y1 : box.x1) && P[vertical ? a * w + p : p * w + a];
        if (inP && s < 0) s = a;
        if (!inP && s >= 0) {
          const e = a - 1;
          const px = (q) => (vertical ? [p, q] : [q, p]);
          // a wall continues outwards from the pin: a straight run of ink, not a glyph stroke
          const nearOut = (q, dir) => {
            for (let k = 0; k < 3; k++) {
              let n = 0;
              for (let j = 0; j < minOut; j++) { const [x, y] = px(q + dir * (k + j)); if (outside(x, y)) n++; }
              if (n >= 0.9 * minOut) return true;
            }
            return false;
          };
          const lo = nearOut(s - 1, -1), hi = nearOut(e + 1, 1);
          // the first stroke seen inside that crosses this line (a wall running the other way), within reach
          const crossing = (q) => {
            let n = 0;
            for (let j = -minOut; j <= minOut; j++) { const x = vertical ? p + j : q, y = vertical ? q : p + j; if (x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x]) n++; }
            return n >= 0.7 * minOut;
          };
          const firstIn = (from, dir) => {
            for (let k = 0; k <= reach; k++) { const q = from + dir * k, [x, y] = px(q); if (!P[y * w + x]) break; if (ink[y * w + x] && (k <= gap || crossing(q))) return q; }
            return null;
          };
          if (lo && hi) for (let q = s; q <= e; q++) add.push(px(q));
          else if (lo) { const q = firstIn(s, 1); if (q != null) for (let k = s; k <= q; k++) add.push(px(k)); }
          else if (hi) { const q = firstIn(e, -1); if (q != null) for (let k = q; k <= e; k++) add.push(px(k)); }
          s = -1;
        }
      }
    }
    for (const [x, y] of add) ink[y * w + x] = 1;
  };
  bridge(false);
  bridge(true);
  return P;
}

// share of box `a` inside box `b`
function share(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.max(1, a.w * a.h);
}

// Walled cells (level-1 faces) that are not rooms yet. ctx: { w, h, textH, footArea, taken: boxes of the
// rooms/stairs already made, icons: symbol boxes, stairs: stair boxes, blankIds: Set of paper-only faces }.
// Returns [{ x, y, w, h, f, ids, reason }] (x..y is the cell interior; reason 'walled-cell', 'split-cell' = text or a
// symbol cut the cell into pieces that were joined again, 'under-pin' = walls re-read from under the pin).
// A cell needs ink walls on all four sides (an open side is grown outwards until a wall) AND something inside it (a number, symbol or pin text), so blank paper,
// corridor strips between double walls and empty gaps never become rooms. Also rejected: corridors (evacuation
// arrows inside, long thin shapes), symbols (mostly red/green), cells beside stairs, double wall lines, shapes
// that are not rectangular, cells already covered by a room or a symbol.
export function recoverUnlabeledCells(F1, layers, ctx) {
  const { w, h, textH, footArea, taken = [], icons = [], stairs = [], blankIds = new Set() } = ctx;
  const minArea = Math.max(24, textH * textH * 1.2), minSide = Math.max(5, textH * 0.7);
  const band = Math.max(2, Math.round(textH * 0.3));
  const bm = new Uint8Array(w * h);
  const wi = layers.wallInk || layers.ink;
  for (let i = 0; i < bm.length; i++) bm[i] = wi[i] | layers.seal[i];
  const wall = dilate(bm, w, h, 1); // ink walls only: a red sign is not a wall
  const frac = (xa, ya, xb, yb) => {
    let n = 0, t = 0;
    for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) { t++; if (wall[y * w + x]) n++; }
    return t ? n / t : 0;
  };
  const near = stairs.map((b) => ({ x: b.x - textH * 1.5, y: b.y - textH * 1.5, w: b.w + textH * 3, h: b.h + textH * 3 }));
  const frags = [];
  for (const f of F1.faces) {
    if (blankIds.has(f.id)) continue;
    const bw = f.x1 - f.x0 + 1, bh = f.y1 - f.y0 + 1;
    if (f.area < minArea * 0.3 || Math.min(bw, bh) < minSide * 0.5 || f.area > 0.2 * footArea) continue;
    const box = { x: f.x0, y: f.y0, w: bw, h: bh };
    let blue = 0, col = 0, tot = 0;
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
      const i = y * w + x;
      tot++;
      if (layers.blue[i] && !(layers.pin && layers.pin[i])) blue++;
      if (layers.red[i] || (layers.green && layers.green[i])) col++;
    }
    if (blue > 0.03 * tot || col > 0.2 * tot) continue;
    if (icons.some((b) => share(box, b) > 0.4)) continue;
    frags.push({ f, box });
  }
  // stair treads: four or more parallel strokes across (or along) the cell and just beyond it
  const hatched = (b) => {
    const E = Math.round(textH * 3.5);
    const count = (vertical) => {
      let n = 0, prev = -9;
      const a0 = (vertical ? b.x : b.y) - E, a1 = (vertical ? b.x + b.w : b.y + b.h) + E;
      const k0 = (vertical ? b.y : b.x) + band + 1, k1 = (vertical ? b.y + b.h : b.x + b.w) - band - 1;
      for (let a = a0; a < a1; a++) {
        let c = 0;
        for (let k = k0; k < k1; k++) {
          const x = vertical ? a : k, y = vertical ? k : a;
          if (x >= 0 && y >= 0 && x < w && y < h) c += layers.ink[y * w + x];
        }
        if (c >= 0.6 * (k1 - k0)) { if (a - prev > 2) n++; prev = a; }
      }
      return n;
    };
    return count(false) >= 4 || count(true) >= 4;
  };
  // share of a face's outline that runs along an ink wall (an octagonal hall is not a box, but is just as closed)
  const rim = (f) => {
    let n = 0, t = 0;
    const d = 2;
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
      if (F1.labels[y * w + x] !== f.id) continue;
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (F1.labels[yy * w + xx] === f.id) continue;
        t++;
        if (wall[yy * w + xx]) n++;
        break;
      }
    }
    return t ? n / t : 0;
  };
  const why = (r) => { if (ctx.debug) ctx.debug.push(r); return null; };
  // text or a symbol touching a wall can cut a cell short: push each open side outwards until a wall is met
  const grow = (b0) => {
    let { x, y, w: bw, h: bh } = b0;
    const lim = Math.round(textH * 3);
    const sides = () => [
      frac(x - band, y, x - 1, y + bh - 1), frac(x + bw, y, x + bw + band - 1, y + bh - 1),
      frac(x, y - band, x + bw - 1, y - 1), frac(x, y + bh, x + bw - 1, y + bh + band - 1),
    ];
    for (let k = 0; k < lim; k++) {
      const s = sides();
      if (s.every((v) => v >= 0.6)) break;
      if (s[0] < 0.6 && x > 0 && x > b0.x - lim) { x--; bw++; }
      if (s[1] < 0.6 && x + bw < w - 1 && x + bw < b0.x + b0.w + lim) bw++;
      if (s[2] < 0.6 && y > 0 && y > b0.y - lim) { y--; bh++; }
      if (s[3] < 0.6 && y + bh < h - 1 && y + bh < b0.y + b0.h + lim) bh++;
    }
    return { x, y, w: bw, h: bh };
  };
  // a number sitting on a wall hides the wall behind it: the cell reaches on to the first straight wall line
  const snap = (b, ids) => {
    let { x, y, w: bw, h: bh } = b;
    const lim = Math.round(textH * 2.5);
    const line = (vertical, pos, a0, a1) => {
      let n = 0, o = 0;
      for (let a = a0; a <= a1; a++) {
        const px = vertical ? pos : a, py = vertical ? a : pos;
        if (px < 0 || py < 0 || px >= w || py >= h) return { wall: 0, other: 1 };
        if (wall[py * w + px]) n++;
        const id = F1.labels[py * w + px];
        if (id && !ids.has(id)) o++;
      }
      return { wall: n / (a1 - a0 + 1), other: o / (a1 - a0 + 1) };
    };
    const reach = (vertical, start, dir, a0, a1) => {
      for (let k = 1; k <= lim; k++) {
        const r = line(vertical, start + dir * k, a0, a1);
        if (r.other > 0.3) return k - 1;
        if (r.wall >= 0.8) return k - 1;
      }
      return 0;
    };
    const l = reach(true, x - 1, -1, y, y + bh - 1), r = reach(true, x + bw, 1, y, y + bh - 1);
    const t = reach(false, y - 1, -1, x, x + bw - 1), d = reach(false, y + bh, 1, x, x + bw - 1);
    // only the sides that were not already against a wall line
    const here = (vertical, pos, a0, a1) => line(vertical, pos, a0, a1).wall >= 0.8;
    const k = [here(true, x - 1, y, y + bh - 1) ? 0 : l, here(true, x + bw, y, y + bh - 1) ? 0 : r, here(false, y - 1, x, x + bw - 1) ? 0 : t, here(false, y + bh, x, x + bw - 1) ? 0 : d];
    return { x: x - k[0], y: y - k[2], w: bw + k[0] + k[1], h: bh + k[2] + k[3] };
  };
  const test = (box0, parts) => check(box0, parts) || check(grow(box0), parts);
  const check = (box, parts) => {
    const ids = new Set(parts.map((p) => p.f.id));
    const sh = Math.min(box.w, box.h), lg = Math.max(box.w, box.h);
    if (sh < minSide || lg / sh > 5 || (sh < textH * 1.6 && lg / sh > 2.5)) return why({ box, r: 'shape' });
    let area = 0, other = 0, ink = 0, pinN = 0;
    for (const p of parts) area += p.f.area;
    if (area < minArea || box.w * box.h > 0.2 * footArea) return why({ box, r: 'area' });
    const x1 = box.x + box.w - 1, y1 = box.y + box.h - 1;
    for (let y = box.y; y <= y1; y++) for (let x = box.x; x <= x1; x++) {
      const i = y * w + x, id = F1.labels[i];
      if (id && !ids.has(id)) other++;
      if (layers.pin && layers.pin[i]) pinN++;
      if (layers.ink[i] && x > box.x + band && x < x1 - band && y > box.y + band && y < y1 - band) ink++;
    }
    if (other > 0.15 * box.w * box.h) return why({ box, r: 'other', other });
    if (ink < Math.max(10, (pinN > 0.15 * box.w * box.h ? 0.04 : 0.12) * textH * textH)) return why({ box, r: 'noink', ink });
    if (taken.some((b) => share(box, b) > 0.3)) return why({ box, r: 'taken' });
    if (near.some((b) => share(box, b) > 0.3)) return why({ box, r: 'stair' });
    const side = Math.min(frac(box.x - band, box.y, box.x - 1, y1), frac(x1 + 1, box.y, x1 + band, y1), frac(box.x, box.y - band, x1, box.y - 1), frac(box.x, y1 + 1, x1, y1 + band));
    if (hatched(box)) return why({ box, r: 'stair-hatch' });
    if (box.w * box.h > 0.05 * footArea && (parts.length > 1 || rim(parts[0].f) < 0.85)) return why({ box, r: 'big', side: rim(parts[0].f) });
    // a pin hides part of the walls: its cells are judged more gently (and flagged for review)
    if (box.w * box.h <= 0.05 * footArea && side < (pinN > 0.15 * box.w * box.h ? 0.35 : 0.6)) return why({ box, r: 'walls', side });
    const fin = snap(box, ids);
    return { x: fin.x, y: fin.y, w: fin.w, h: fin.h, f: parts[0].f, ids: [...ids], walled: side, reason: pinN > 0.15 * box.w * box.h ? 'under-pin' : parts.length > 1 ? 'split-cell' : 'walled-cell' };
  };
  const out = [], used = new Set();
  const order = frags.slice().sort((a, b) => b.f.area - a.f.area);
  const gapMax = Math.max(4, textH * 1.4);
  for (const a of order) {
    if (used.has(a.f.id)) continue;
    let hit = test(a.box, [a]);
    if (!hit) {
      for (const b of order) {
        if (b === a || used.has(b.f.id)) continue;
        const gx = Math.max(a.box.x, b.box.x) - Math.min(a.box.x + a.box.w, b.box.x + b.box.w);
        const gy = Math.max(a.box.y, b.box.y) - Math.min(a.box.y + a.box.h, b.box.y + b.box.h);
        if (gx > gapMax || gy > gapMax) continue;
        const x0 = Math.min(a.box.x, b.box.x), y0 = Math.min(a.box.y, b.box.y);
        const U = { x: x0, y: y0, w: Math.max(a.box.x + a.box.w, b.box.x + b.box.w) - x0, h: Math.max(a.box.y + a.box.h, b.box.y + b.box.h) - y0 };
        hit = test(U, [a, b]);
        if (hit) break;
      }
    }
    if (hit && !out.some((o) => share(hit, o) > 0.3 || share(o, hit) > 0.3)) { hit.ids.forEach((id) => used.add(id)); out.push(hit); }
  }
  return out;
}
