// hallFill.js
// Second hallway pass for AutoBuild: after rooms, stairs and the outline exist, the free space INSIDE the
// outline that looks like a corridor becomes tight hallway rectangles (hugging the rooms), but only where
// it serves a room that reaches no hallway yet or links two hallway groups.
//   fillHallways(doc, opts?) -> { doc, added: [id], extended: [id], notes: [string] }
// Pure (input never changed), deterministic, integer coordinates. Only hall rects are added or grown.
// Method: coarse raster (step ~ median/20) of free space, minus rooms/stairs/halls -> opened by a small
// square (no slivers) -> fat blobs (lobbies) removed -> row/column partition into rects -> each rect is
// fitted exactly (clipped to the outline, grown to the nearest room edge) -> merged -> kept only if useful.
// Depends on: document.js (newId).

import { newId } from './document.js';

const fin = Number.isFinite;
const rectOk = (r) => !!r && fin(r.x) && fin(r.y) && fin(r.w) && fin(r.h) && r.w > 0 && r.h > 0;
const CORE = new Set(['Elevator', 'Restrooms', 'Utility']);
const needsHall = (r) => r.cls === 'room' || r.cls === 'big' || r.cls === 'ours' || (r.cls === 'core' && CORE.has(r.name));
const touchPad = (a, b, p) => !(a.x + a.w + p < b.x || b.x + b.w < a.x - p || a.y + a.h + p < b.y || b.y + b.h < a.y - p);
const ovl = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const r5 = (v) => Math.round(v / 5) * 5;
const ptsOk = (p) => Array.isArray(p) && p.length >= 3 && p.every((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]));

function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// the polygon's interior meets the open box
function hitsPoly(poly, x0, y0, x1, y1) {
  if (inPoly(poly, (x0 + x1) / 2, (y0 + y1) / 2)) return true;
  for (const p of poly) if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) return true;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    let t0 = 0, t1 = 1;
    const clip = (p, q) => { if (p === 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
    if (clip(-(bx - ax), ax - x0) && clip(bx - ax, x1 - ax) && clip(-(by - ay), ay - y0) && clip(by - ay, y1 - ay) && t1 > t0) {
      const tm = (t0 + t1) / 2, mx = ax + tm * (bx - ax), my = ay + tm * (by - ay);
      if (mx > x0 && mx < x1 && my > y0 && my < y1) return true;
    }
  }
  return false;
}
// rectangle (0.5 slack) lies inside the polygon
function rectIn(poly, r) {
  const e = 0.5, x0 = r.x + e, y0 = r.y + e, x1 = r.x + r.w - e, y1 = r.y + r.h - e;
  if (!(inPoly(poly, x0, y0) && inPoly(poly, x1, y0) && inPoly(poly, x0, y1) && inPoly(poly, x1, y1) && inPoly(poly, (x0 + x1) / 2, (y0 + y1) / 2))) return false;
  for (const p of poly) if (p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1) return false;
  return true;
}
const area2 = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };
const bboxOf = (p) => { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]), x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };

// ---- spatial hash over {x,y,w,h} objects (own stamp key per hash) ----
let hashId = 0;
function hash(cell = 200) {
  const m = new Map(), key = '_s' + hashId++; let stamp = 0;
  const each = (b, pad, fn) => { for (let cx = Math.floor((b.x - pad) / cell); cx <= Math.floor((b.x + b.w + pad) / cell); cx++) for (let cy = Math.floor((b.y - pad) / cell); cy <= Math.floor((b.y + b.h + pad) / cell); cy++) fn(cx + ',' + cy); };
  return {
    add(o) { each(o, 0, (k) => { const a = m.get(k); if (a) a.push(o); else m.set(k, [o]); }); },
    query(b, pad, fn) { stamp++; each(b, pad, (k) => { const a = m.get(k); if (a) for (const o of a) if (o[key] !== stamp) { o[key] = stamp; fn(o); } }); },
  };
}

// ---- grid helpers ----
function integral(g, gw, gh) {
  const P = new Int32Array((gw + 1) * (gh + 1));
  for (let j = 0; j < gh; j++) { let row = 0; for (let i = 0; i < gw; i++) { row += g[j * gw + i]; P[(j + 1) * (gw + 1) + i + 1] = P[j * (gw + 1) + i + 1] + row; } }
  return P;
}
const sumBox = (P, gw, i0, j0, i1, j1) => P[j1 * (gw + 1) + i1] - P[j0 * (gw + 1) + i1] - P[j1 * (gw + 1) + i0] + P[j0 * (gw + 1) + i0];
// union of all s x s squares that fit inside the mask
function opening(g, gw, gh, s) {
  const P = integral(g, gw, gh), ero = new Uint8Array(gw * gh);
  for (let j = 0; j + s <= gh; j++) for (let i = 0; i + s <= gw; i++) if (sumBox(P, gw, i, j, i + s, j + s) === s * s) ero[j * gw + i] = 1;
  const E = integral(ero, gw, gh), out = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (sumBox(E, gw, Math.max(0, i - s + 1), Math.max(0, j - s + 1), i + 1, j + 1) > 0) out[j * gw + i] = 1;
  return out;
}
// scan partition into cell rects ({i,j,w,h}); vertical = column-major
function partition(g, gw, gh, vertical) {
  const seen = new Uint8Array(gw * gh), out = [];
  const A = vertical ? gh : gw, B = vertical ? gw : gh;
  const at = (a, b) => (vertical ? a * gw + b : b * gw + a); // a along the scan axis, b across
  const free = (a, b) => g[at(a, b)] && !seen[at(a, b)];
  for (let b = 0; b < B; b++) for (let a = 0; a < A; a++) {
    if (!free(a, b)) continue;
    let la = 1; while (a + la < A && free(a + la, b)) la++;
    let lb = 1;
    for (;;) { if (b + lb >= B) break; let ok = true; for (let k = 0; k < la; k++) if (!free(a + k, b + lb)) { ok = false; break; } if (!ok) break; lb++; }
    for (let k = 0; k < la; k++) for (let q = 0; q < lb; q++) seen[at(a + k, b + q)] = 1;
    out.push(vertical ? { i: b, j: a, w: lb, h: la } : { i: a, j: b, w: la, h: lb });
  }
  return mergeCells(out);
}
function mergeCells(rs) {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const horiz of [true, false]) {
      const kf = (r) => (horiz ? `${r.j},${r.h},${r.i}` : `${r.i},${r.w},${r.j}`);
      const byStart = new Map(), dead = new Set();
      rs.forEach((r, k) => byStart.set(kf(r), k));
      rs.forEach((r, k) => {
        if (dead.has(k)) return;
        const nk = byStart.get(horiz ? `${r.j},${r.h},${r.i + r.w}` : `${r.i},${r.w},${r.j + r.h}`);
        if (nk === undefined || dead.has(nk) || nk === k) return;
        if (horiz) r.w += rs[nk].w; else r.h += rs[nk].h;
        dead.add(nk); changed = true; byStart.set(kf(r), k);
      });
      rs = rs.filter((_, k) => !dead.has(k));
    }
    if (!changed) break;
  }
  return rs;
}

// longest axis-parallel stretch of a room's edges within `pad` of a side of rect P
function contact(room, P, pad = 4) {
  let best = 0;
  const p = room.poly;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
    if (ax === bx && (Math.abs(ax - P.x) <= pad || Math.abs(ax - P.x - P.w) <= pad)) best = Math.max(best, ovl(Math.min(ay, by), Math.max(ay, by), P.y, P.y + P.h));
    if (ay === by && (Math.abs(ay - P.y) <= pad || Math.abs(ay - P.y - P.h) <= pad)) best = Math.max(best, ovl(Math.min(ax, bx), Math.max(ax, bx), P.x, P.x + P.w));
  }
  return best;
}
const adj = (a, b, tol = 1) => { const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h); return (gx <= tol && gy < 0) || (gy <= tol && gx < 0); };
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

export function fillHallways(doc, opts = {}) {
  const none = (note) => ({ doc, added: [], extended: [], notes: note ? [note] : [] });
  const items = doc && Array.isArray(doc.items) ? doc.items : null;
  if (!items) return none('No plan to fill.');
  const rooms = [], stairs = [], doors = [], halls = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (it.type === 'room') {
      let poly = null;
      if (it.shape === 'poly' && ptsOk(it.points)) poly = it.points;
      else if (rectOk(it)) poly = [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]];
      if (!poly) continue;
      const b = bboxOf(poly);
      if (!(b.w > 0 && b.h > 0)) continue;
      rooms.push({ ...b, poly, item: it, rect: Math.abs(area2(poly) - b.w * b.h) < 1 });
    } else if (it.type === 'stair' && rectOk(it)) stairs.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    else if (it.type === 'door' && [it.x1, it.y1, it.x2, it.y2].every(fin)) doors.push([(it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2]);
    else if (it.type === 'hall' && rectOk(it)) halls.push({ x: it.x, y: it.y, w: it.w, h: it.h, item: it });
  }
  if (!rooms.length) return none('No rooms: nothing to fill.');
  const sides = rooms.map((r) => Math.min(r.w, r.h)).sort((a, b) => a - b);
  const med = Math.max(10, sides[sides.length >> 1]);
  const notes = [];
  let outline = doc.floor && ptsOk(doc.floor.points) ? doc.floor.points : null;
  if (!outline) {
    const all = [...rooms, ...stairs, ...halls];
    const x0 = Math.min(...all.map((r) => r.x)), y0 = Math.min(...all.map((r) => r.y)), x1 = Math.max(...all.map((r) => r.x + r.w)), y1 = Math.max(...all.map((r) => r.y + r.h));
    outline = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    notes.push('No outline: used the bounding box of the rooms.');
  }
  const ob = bboxOf(outline);
  let step = Math.max(5, Math.round(med / 20));
  const nCells = () => Math.ceil(ob.w / step) * Math.ceil(ob.h / step);
  while (nCells() > 600000 && step < med / 3) step += 5;
  if (!(ob.w > 0 && ob.h > 0) || step > med / 3 || nCells() > 600000) return none('Plan too large or flat to analyse.');
  const ox = Math.floor(ob.x / step) * step, oy = Math.floor(ob.y / step) * step;
  const gw = Math.ceil((ob.x + ob.w - ox) / step), gh = Math.ceil((ob.y + ob.h - oy) / step);
  const minShort = Math.max(10, Math.round(0.25 * med)), maxShort = Math.round(1.6 * med), maxElong = Math.round(2.2 * med);

  // ---- free-space mask ----
  const free = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const yc = oy + (j + 0.5) * step, xs = [];
    for (let k = 0; k < outline.length; k++) {
      const [x0, y0] = outline[k], [x1, y1] = outline[(k + 1) % outline.length];
      if ((y0 > yc) !== (y1 > yc)) xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.max(0, Math.ceil((xs[k] - ox) / step - 0.5)); i <= Math.min(gw - 1, Math.ceil((xs[k + 1] - ox) / step - 0.5) - 1); i++) free[j * gw + i] = 1;
    }
  }
  const block = (b, poly) => {
    const i0 = Math.max(0, Math.floor((b.x - ox) / step)), i1 = Math.min(gw - 1, Math.ceil((b.x + b.w - ox) / step) - 1);
    const j0 = Math.max(0, Math.floor((b.y - oy) / step)), j1 = Math.min(gh - 1, Math.ceil((b.y + b.h - oy) / step) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (poly && !hitsPoly(poly, ox + i * step, oy + j * step, ox + (i + 1) * step, oy + (j + 1) * step)) continue;
      free[j * gw + i] = 0;
    }
  };
  for (const r of rooms) block(r, r.rect ? null : r.poly);
  for (const s of stairs) block(s, null);
  for (const h of halls) block(h, null);

  // ---- corridor-like part of the free space: no slivers, no lobbies ----
  const opened = opening(free, gw, gh, Math.max(2, Math.round((0.2 * med) / step) - 1));
  const fat = opening(opened, gw, gh, Math.floor(maxShort / step) + 1), lab = new Uint8Array(gw * gh);
  for (let c = 0; c < gw * gh; c++) {
    if (!fat[c] || lab[c]) continue;
    const q = [c]; lab[c] = 1; let i0 = gw, i1 = 0, j0 = gh, j1 = 0;
    for (let h = 0; h < q.length; h++) {
      const v = q[h], i = v % gw, j = (v / gw) | 0;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      for (const nn of [i > 0 ? v - 1 : -1, i < gw - 1 ? v + 1 : -1, j > 0 ? v - gw : -1, j < gh - 1 ? v + gw : -1]) if (nn >= 0 && fat[nn] && !lab[nn]) { lab[nn] = 1; q.push(nn); }
    }
    const sh = Math.min(i1 - i0 + 1, j1 - j0 + 1) * step, lg = Math.max(i1 - i0 + 1, j1 - j0 + 1) * step;
    if (sh <= maxElong && lg / sh >= 3) for (const v of q) fat[v] = 0; // wide but elongated: a corridor
  }
  const mask = new Uint8Array(gw * gh), fatP = integral(fat, gw, gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (opened[j * gw + i] && sumBox(fatP, gw, Math.max(0, i - 1), Math.max(0, j - 1), Math.min(gw, i + 2), Math.min(gh, j + 2)) === 0) mask[j * gw + i] = 1;
  }
  const pa = partition(mask, gw, gh, false), pb = partition(mask, gw, gh, true);
  const cells = pb.length < pa.length ? pb : pa;
  if (cells.length > 4000) notes.push('Very many corridor pieces; only the first 4000 were considered.');

  // ---- fit every piece exactly ----
  const stat = hash(), live = hash(), hallSet = new Set(halls);
  for (const r of rooms) stat.add(r);
  for (const s of stairs) stat.add(s);
  for (const h of halls) stat.add(h);
  const maxG = Math.round(step * 1.5), padL = 2 * step + 4, padH = Math.round(med);
  const pieces = cells.slice(0, 4000).map((c) => ({ x: ox + c.i * step, y: oy + c.j * step, w: c.w * step, h: c.h * step }));
  for (const P of pieces) { P.dead = Math.min(P.w, P.h) + 2 * maxG < minShort; live.add(P); }
  const cap = (P) => { const sh = Math.min(P.w, P.h), lg = Math.max(P.w, P.h); return sh <= maxShort || (sh <= maxElong && lg / sh >= 3); };
  const hitsPolyArea = (poly, P) => P.w > 4 && P.h > 4 && hitsPoly(poly, P.x + 2, P.y + 2, P.x + P.w - 2, P.y + P.h - 2);
  const clear = (P, ignore) => { // no room/stair/hall/piece cut by more than 2 units, inside the outline
    if (!rectIn(outline, P)) return false;
    let ok = true;
    const chk = (o) => {
      if (!ok || o.dead || ignore.includes(o)) return;
      const dx = ovl(P.x, P.x + P.w, o.x, o.x + o.w), dy = ovl(P.y, P.y + P.h, o.y, o.y + o.h);
      if (dx <= 0 || dy <= 0) return;
      if (o.poly && !o.rect) { if (hitsPolyArea(o.poly, P)) ok = false; } else if (Math.min(dx, dy) > 2) ok = false;
    };
    stat.query(P, padH, chk); live.query(P, padL, chk);
    return ok;
  };
  const SIDES = [
    { strip: (P, g) => ({ x: P.x + P.w, y: P.y, w: g, h: P.h }), lim: (P, o) => (ovl(P.y, P.y + P.h, o.y, o.y + o.h) > 0 && o.x >= P.x + P.w - 0.5 ? o.x - (P.x + P.w) : Infinity), set: (P, g) => { P.w += g; }, grid: (P) => r5(P.x + P.w) - (P.x + P.w) },
    { strip: (P, g) => ({ x: P.x - g, y: P.y, w: g, h: P.h }), lim: (P, o) => (ovl(P.y, P.y + P.h, o.y, o.y + o.h) > 0 && o.x + o.w <= P.x + 0.5 ? P.x - (o.x + o.w) : Infinity), set: (P, g) => { P.x -= g; P.w += g; }, grid: (P) => P.x - r5(P.x) },
    { strip: (P, g) => ({ x: P.x, y: P.y + P.h, w: P.w, h: g }), lim: (P, o) => (ovl(P.x, P.x + P.w, o.x, o.x + o.w) > 0 && o.y >= P.y + P.h - 0.5 ? o.y - (P.y + P.h) : Infinity), set: (P, g) => { P.h += g; }, grid: (P) => r5(P.y + P.h) - (P.y + P.h) },
    { strip: (P, g) => ({ x: P.x, y: P.y - g, w: P.w, h: g }), lim: (P, o) => (ovl(P.x, P.x + P.w, o.x, o.x + o.w) > 0 && o.y + o.h <= P.y + 0.5 ? P.y - (o.y + o.h) : Infinity), set: (P, g) => { P.y -= g; P.h += g; }, grid: (P) => P.y - r5(P.y) },
  ];
  const trial = (P, s, g) => { const c = { x: P.x, y: P.y, w: P.w, h: P.h }; s.set(c, g); return c; };
  const fit = (P) => {
    for (const s of SIDES) for (let t = 0; t < maxG && !rectIn(outline, P) && P.w > 2 && P.h > 2; t++) s.set(P, -1);
    if (!rectIn(outline, P)) return false;
    for (const s of SIDES) {
      let g = maxG, hard = false;
      const look = (o) => { if (o === P || o.dead) return; const l = s.lim(P, o); if (l < g) { g = Math.max(0, l); hard = true; } };
      const probe = s.strip(P, maxG);
      stat.query(probe, 0, look); live.query(probe, padL, look);
      g = Math.floor(g);
      while (g > 0 && !rectIn(outline, trial(P, s, g))) { g--; hard = true; }
      if (g > 0) s.set(P, g);
      if (!hard) { // open end: tidy to the 5-grid when that stays valid
        const d = s.grid(P);
        if (d !== 0) { const c = trial(P, s, d); if (c.w > 0 && c.h > 0 && clear(c, [P])) s.set(P, d); }
      }
    }
    P.x = Math.round(P.x); P.y = Math.round(P.y); P.w = Math.round(P.w); P.h = Math.round(P.h);
    return P.w >= minShort && P.h >= minShort && Math.max(P.w, P.h) >= 20 && cap(P) && clear(P, [P]);
  };
  let cand = pieces.filter((P) => !P.dead && (fit(P) || (P.dead = true, false)));

  // ---- merge neighbours (candidates and existing halls) when the union is a clean rectangle ----
  const tolC = Math.max(5, step);
  const mergeable = (a, b, gap) => {
    const sameY = Math.abs(a.y - b.y) <= tolC && Math.abs(a.y + a.h - b.y - b.h) <= tolC && ovl(a.y, a.y + a.h, b.y, b.y + b.h) > 0;
    const sameX = Math.abs(a.x - b.x) <= tolC && Math.abs(a.x + a.w - b.x - b.w) <= tolC && ovl(a.x, a.x + a.w, b.x, b.x + b.w) > 0;
    const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
    return (sameY && gx <= gap && gx >= -2) || (sameX && gy <= gap && gy >= -2);
  };
  const extended = new Set();
  const mergePass = (list, withHalls) => {
    for (let pass = 0, any = true; pass < 6 && any; pass++) {
      any = false;
      const hl = hash(), all = withHalls ? [...halls, ...list] : [...list], dead = new Set();
      for (const o of all) hl.add(o);
      for (const a of all) {
        if (dead.has(a)) continue;
        hl.query(a, padH, (b) => {
          if (b === a || dead.has(a) || dead.has(b)) return;
          const aH = hallSet.has(a), bH = hallSet.has(b);
          if (aH && bH) return;
          if (!mergeable(a, b, aH || bH ? Math.round(0.5 * med) : 2)) return;
          const U = union(a, b);
          if (!cap(U) && Math.min(U.w, U.h) > Math.max(Math.min(a.w, a.h), Math.min(b.w, b.h)) + 5) return;
          if (!clear(U, [a, b])) return;
          const keep = bH ? b : a, gone = keep === a ? b : a;
          Object.assign(keep, U); dead.add(gone); gone.dead = true; any = true;
          if (hallSet.has(keep)) { extended.add(keep); stat.add(keep); } else live.add(keep);
          hl.add(keep);
        });
      }
      list = list.filter((p) => !dead.has(p));
    }
    return list;
  };
  cand = mergePass(cand, false);

  // ---- keep only what serves a room or links hall groups ----
  const uf = halls.map((_, i) => i), find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
  for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) if (adj(halls[i], halls[j])) uf[find(i)] = find(j);
  const rh = hash(), ch = hash();
  for (const r of rooms) if (needsHall(r.item) && !halls.some((h) => touchPad(r, h, 4))) rh.add(r);
  const n = cand.length, nb = cand.map(() => []), groups = cand.map(() => new Set()), serves = cand.map(() => new Set());
  cand.forEach((p, i) => { p.k = i; ch.add(p); });
  cand.forEach((p, i) => {
    ch.query(p, 2, (q) => { if (q !== p && adj(p, q)) nb[i].push(q.k); });
    halls.forEach((h, hi) => { if (adj(p, h)) groups[i].add(find(hi)); });
    rh.query(p, 4, (r) => { if (contact(r, p) >= 10) serves[i].add(r); });
  });
  const keep = new Set(), seen = new Uint8Array(n);
  const onEdge = (p) => !rectIn(outline, { x: p.x - 3, y: p.y - 3, w: p.w + 6, h: p.h + 6 }) || stairs.some((s) => touchPad(p, s, 3)) || doors.some(([x, y]) => x >= p.x - 3 && x <= p.x + p.w + 3 && y >= p.y - 3 && y <= p.y + p.h + 3);
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0]) continue;
    const comp = [s0]; seen[s0] = 1;
    for (let h = 0; h < comp.length; h++) for (const q of nb[comp[h]]) if (!seen[q]) { seen[q] = 1; comp.push(q); }
    const par = new Map(), org = new Map(), queue = [];
    const anchors = comp.filter((i) => groups[i].size);
    if (anchors.length) for (const i of anchors) { par.set(i, -1); org.set(i, Math.min(...groups[i])); queue.push(i); }
    else {
      const a = comp.find((i) => onEdge(cand[i])), sv = comp.filter((i) => serves[i].size);
      if (!sv.length || (a === undefined && new Set(sv.flatMap((i) => [...serves[i]])).size < 2)) continue;
      const root = a !== undefined ? a : sv[0]; par.set(root, -1); org.set(root, -1); queue.push(root);
    }
    for (let h = 0; h < queue.length; h++) for (const q of nb[queue[h]]) if (!par.has(q)) { par.set(q, queue[h]); org.set(q, org.get(queue[h])); queue.push(q); }
    const chain = (i) => { for (let v = i; v !== -1 && !keep.has(v); v = par.get(v)) keep.add(v); };
    for (const i of comp) {
      if (!par.has(i)) continue;
      if (serves[i].size) chain(i);
      if (!anchors.length) continue;
      for (const g of groups[i]) if (g !== org.get(i)) chain(i); // reaches a second hall group
      for (const q of nb[i]) if (org.get(q) !== org.get(i)) { chain(i); chain(q); } // two origins meet
    }
  }
  cand.forEach((p, i) => { if (!keep.has(i)) p.dead = true; });
  const chosen = mergePass(cand.filter((p, i) => keep.has(i)), true);
  if (!chosen.length && !extended.size) { notes.push('No corridor-like free space serves a room.'); return { doc, added: [], extended: [], notes }; }

  // ---- result ----
  const used = new Set(items.map((it) => it && it.id));
  const addedItems = chosen.map((p) => { let id = newId(); while (used.has(id)) id = newId(); used.add(id); return { id, type: 'hall', x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) }; });
  const grew = new Map(); for (const h of extended) grew.set(h.item, h);
  const out = items.map((it) => { const h = grew.get(it); return h ? { ...it, x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.w), h: Math.round(h.h) } : it; });
  const extIds = [...new Set([...grew.keys()].map((it) => it.id))];
  if (addedItems.length) notes.push(`Added ${addedItems.length} hallway${addedItems.length > 1 ? 's' : ''} along free corridor space.`);
  if (extIds.length) notes.push(`Extended ${extIds.length} hallway${extIds.length > 1 ? 's' : ''} into the corridor.`);
  return { doc: { ...doc, items: [...out, ...addedItems] }, added: addedItems.map((h) => h.id), extended: extIds, notes };
}
