// hallLabels.js
// Where the word "Hallway" goes on the exported plan. Hallways are often many small pieces; one label per
// piece piles up and covers exits. Instead, pieces that touch are one corridor network, and each network
// gets a few labels (one for a small cluster, up to three for a long one), each placed on open floor:
// inside the hallway, clear of rooms, stairs, EXIT / door labels and staff-wall padlocks, and turned
// to run vertically when the corridor is too narrow for the word sideways.
// Pure. Depends on: js/model/document.js (roomPolygon), js/model/geometry.js (pointInPolygon).

import { roomPolygon } from './document.js';
import { pointInPolygon } from './geometry.js';

const STEP = 5; // grid cell, plan units
const LBL_W = 84, LBL_H = 24; // the word at 18px, with a little air
const MAX_LABELS = 3;
const FAR = 220; // labels of one network stay at least this far apart
const MIN_ARM = 160; // a further label needs an arm at least this long
const TOUCH = 4; // pieces closer than this are one corridor
const MAX_CELLS = 360000;

const ok = (v) => Number.isFinite(v);
const validRect = (h) => h && ok(h.x) && ok(h.y) && ok(h.w) && ok(h.h) && h.w > 0 && h.h > 0;

function clusters(halls) {
  const parent = halls.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < halls.length; i++) {
    for (let j = i + 1; j < halls.length; j++) {
      const a = halls[i], b = halls[j];
      if (a.x <= b.x + b.w + TOUCH && b.x <= a.x + a.w + TOUCH && a.y <= b.y + b.h + TOUCH && b.y <= a.y + a.h + TOUCH) parent[find(i)] = find(j);
    }
  }
  const by = new Map();
  halls.forEach((h, i) => { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(h); });
  return [...by.values()];
}

// largest all-true rectangle in a boolean grid -> { x, y, w, h } in cells (or null)
function largestRect(grid, W, H) {
  const hist = new Int32Array(W);
  let best = null, bestArea = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) hist[x] = grid[y * W + x] ? hist[x] + 1 : 0;
    const stack = [];
    for (let x = 0; x <= W; x++) {
      const cur = x === W ? 0 : hist[x];
      let start = x;
      while (stack.length && stack[stack.length - 1].h >= cur) {
        const top = stack.pop();
        const area = top.h * (x - top.x);
        if (area > bestArea) { bestArea = area; best = { x: top.x, y: y - top.h + 1, w: x - top.x, h: top.h }; }
        start = top.x;
      }
      stack.push({ x: start, h: cur });
    }
  }
  return best;
}

// integral image of a boolean grid, to ask "is this whole box open?" in O(1)
function integral(grid, W, H) {
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) { row += grid[y * W + x] ? 1 : 0; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; }
  }
  return (x, y, w, h) => {
    if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
    return S[(y + h) * (W + 1) + x + w] - S[y * (W + 1) + x + w] - S[(y + h) * (W + 1) + x] + S[y * (W + 1) + x] === w * h;
  };
}

// items: the doc's items. -> [{ x, y, vertical }] centre of each label in plan units
export function hallLabels(items) {
  const list = Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : [];
  const halls = list.filter((i) => i.type === 'hall' && validRect(i));
  if (!halls.length) return [];
  const blockers = []; // [x0, y0, x1, y1] boxes that must stay clear
  const polys = [];
  for (const it of list) {
    try {
      if (it.type === 'room') polys.push(roomPolygon(it));
      else if (it.type === 'stair' && validRect(it)) blockers.push([it.x, it.y, it.x + it.w, it.y + it.h]);
      else if (it.type === 'door' && it.label && ok(it.label.x) && ok(it.label.y)) blockers.push([it.label.x - 30, it.label.y - 12, it.label.x + 30, it.label.y + 12]);
      else if (it.type === 'door' && [it.x1, it.y1, it.x2, it.y2].every(ok)) blockers.push([Math.min(it.x1, it.x2) - 6, Math.min(it.y1, it.y2) - 6, Math.max(it.x1, it.x2) + 6, Math.max(it.y1, it.y2) + 6]);
      else if (it.type === 'authwall' && [it.x1, it.y1, it.x2, it.y2].every(ok)) { const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2; blockers.push([mx - 60, my - 60, mx + 60, my + 60]); } // the padlock, with room around it
    } catch (e) { /* skip a damaged item */ }
  }
  const polyBoxes = polys.filter((p) => p && p.length >= 3).map((p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { p, x0, y0, x1, y1 };
  });

  const out = [];
  for (const group of clusters(halls)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const h of group) { x0 = Math.min(x0, h.x); y0 = Math.min(y0, h.y); x1 = Math.max(x1, h.x + h.w); y1 = Math.max(y1, h.y + h.h); }
    let step = STEP;
    while (((x1 - x0) / step) * ((y1 - y0) / step) > MAX_CELLS) step *= 2;
    const W = Math.max(1, Math.ceil((x1 - x0) / step)), H = Math.max(1, Math.ceil((y1 - y0) / step));
    const cx = (i) => x0 + (i + 0.5) * step, cy = (j) => y0 + (j + 0.5) * step;
    const open = new Uint8Array(W * H);
    let area = 0, sx = 0, sy = 0;
    for (const h of group) {
      const i0 = Math.max(0, Math.floor((h.x - x0) / step)), i1 = Math.min(W - 1, Math.ceil((h.x + h.w - x0) / step) - 1);
      const j0 = Math.max(0, Math.floor((h.y - y0) / step)), j1 = Math.min(H - 1, Math.ceil((h.y + h.h - y0) / step) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) open[j * W + i] = 1;
    }
    for (const b of blockers) {
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      const i0 = Math.max(0, Math.floor((b[0] - x0) / step)), i1 = Math.min(W - 1, Math.floor((b[2] - x0) / step));
      const j0 = Math.max(0, Math.floor((b[1] - y0) / step)), j1 = Math.min(H - 1, Math.floor((b[3] - y0) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) open[j * W + i] = 0;
    }
    for (const r of polyBoxes) {
      if (r.x1 < x0 || r.x0 > x1 || r.y1 < y0 || r.y0 > y1) continue;
      const i0 = Math.max(0, Math.floor((r.x0 - x0) / step)), i1 = Math.min(W - 1, Math.floor((r.x1 - x0) / step));
      const j0 = Math.max(0, Math.floor((r.y0 - y0) / step)), j1 = Math.min(H - 1, Math.floor((r.y1 - y0) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (open[j * W + i] && pointInPolygon([cx(i), cy(j)], r.p)) open[j * W + i] = 0;
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (open[j * W + i]) { area++; sx += cx(i); sy += cy(j); }
    if (!area) continue;

    const lw = Math.ceil(LBL_W / step), lh = Math.ceil(LBL_H / step);
    const fits = integral(open, W, H);
    // the best spot for a label of this orientation, nearest to (tx, ty), inside `allow` (a grid) too
    const spot = (vertical, tx, ty, allowFits) => {
      const bw = vertical ? lh : lw, bh = vertical ? lw : lh;
      let best = null, bd = Infinity;
      for (let j = 0; j + bh <= H; j++) {
        for (let i = 0; i + bw <= W; i++) {
          if (!fits(i, j, bw, bh) || (allowFits && !allowFits(i, j, bw, bh))) continue;
          const mx = x0 + (i + bw / 2) * step, my = y0 + (j + bh / 2) * step;
          const d = Math.hypot(mx - tx, my - ty);
          if (d < bd) { bd = d; best = { x: mx, y: my, vertical }; }
        }
      }
      return best ? { ...best, d: bd } : null;
    };

    const long = Math.max(x1 - x0, y1 - y0);
    const centroid = [sx / area, sy / area];
    if (long < 300) { // a small knot of pieces: one label, as near the middle of it as the free floor allows
      const a = spot(false, centroid[0], centroid[1]), b = spot(true, centroid[0], centroid[1]);
      const pick = a && b ? (b.d + 12 < a.d ? b : a) : a || b;
      if (pick) out.push({ x: Math.round(pick.x), y: Math.round(pick.y), vertical: pick.vertical });
      continue;
    }
    const avail = Uint8Array.from(open);
    const placed = [];
    for (let k = 0; k < MAX_LABELS; k++) {
      const r = largestRect(avail, W, H);
      if (!r) break;
      const rw = r.w * step, rh = r.h * step;
      const horizFits = r.w >= lw && r.h >= lh, vertFits = r.w >= lh && r.h >= lw;
      if (!horizFits && !vertFits) break;
      if (k > 0 && Math.max(rw, rh) < MIN_ARM) break;
      const vertical = vertFits && (!horizFits || rh > rw * 1.4);
      const bw = vertical ? lh : lw, bh = vertical ? lw : lh;
      // centre of the arm, on open floor
      const ccx = x0 + (r.x + r.w / 2) * step, ccy = y0 + (r.y + r.h / 2) * step;
      const inRect = (i, j, w, h) => i >= r.x && j >= r.y && i + w <= r.x + r.w && j + h <= r.y + r.h;
      const s = spot(vertical, ccx, ccy, inRect);
      if (!s) { for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) avail[j * W + i] = 0; continue; }
      placed.push(s);
      out.push({ x: Math.round(s.x), y: Math.round(s.y), vertical: s.vertical });
      // keep the next label away from this one
      const gi0 = Math.max(0, Math.floor((s.x - FAR / 2 - x0) / step)), gi1 = Math.min(W - 1, Math.ceil((s.x + FAR / 2 - x0) / step));
      const gj0 = Math.max(0, Math.floor((s.y - FAR / 2 - y0) / step)), gj1 = Math.min(H - 1, Math.ceil((s.y + FAR / 2 - y0) / step));
      for (let j = gj0; j <= gj1; j++) for (let i = gi0; i <= gi1; i++) avail[j * W + i] = 0;
      void bw; void bh;
    }
    if (!placed.length) { // nothing roomy: still label the network once, where it fits best
      const a = spot(false, centroid[0], centroid[1]), b = spot(true, centroid[0], centroid[1]);
      const pick = a && b ? (b.d + 12 < a.d ? b : a) : a || b;
      if (pick) out.push({ x: Math.round(pick.x), y: Math.round(pick.y), vertical: pick.vertical });
    }
  }
  return out;
}
