// stitch.js
// Joins the plans AutoBuild made from several photos of ONE floor (the wings of a building, or one floor posted in
// pieces) into a single plan. Pure. Everything is in plan units, every piece an axis-aligned box or polygon.
//
//   alignPlans(plans)      -> [{ q, s, tx, ty, how, n, rms } | null]  how plan i maps into plan 0's frame:
//                              p0 = s * R(q quarter turns clockwise) * p_i + (tx, ty)
//   mergePlans(plans, tfs) -> { items, floor, report }  the pieces moved into one frame, duplicates dropped
//
// Alignment, strongest evidence first: (1) room numbers that appear on both photos (two or more fix rotation, scale and
// shift; one fixes the shift); (2) a hallway that leaves one plan where another one's hallway arrives (the compass
// gives the turn). A plan nothing connects to is put beside the others and reported.
// plan = { id, items, floor: { points }, compass: { x, y, deg } | null, w, h }
// Depends on: ./geometry.js, ./autobuild/outline.js.

import { pointInPolygon } from './geometry.js';
import { cellRing, rectilinearRing } from './autobuild/outline.js';
import { joinBlobs } from './outlineRestore.js';

const ok = (v) => Number.isFinite(v);
const G = 5;

// ---- the similarity transform
const spin = (x, y, q) => (q === 1 ? [-y, x] : q === 2 ? [-x, -y] : q === 3 ? [y, -x] : [x, y]); // about the origin, quarter turns clockwise (y down)
export const apply = (t, x, y) => { const [rx, ry] = spin(x, y, t.q); return [t.s * rx + t.tx, t.s * ry + t.ty]; };

function boxOf(it) {
  if (it.points && it.points.length) {
    const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}
const centre = (it) => { const b = boxOf(it); return [b.x + b.w / 2, b.y + b.h / 2]; };
const rooms = (plan) => plan.items.filter((it) => it.type === 'room' && it.number && it.cls !== 'void');
const halls = (plan) => plan.items.filter((it) => it.type === 'hall' && ok(it.x) && ok(it.w));

// least-squares similarity (rotation fixed at q) from point pairs [[ax, ay, bx, by], ...] -> { s, tx, ty, rms }
function fitScaleShift(pairs, q, fixedScale = null) {
  const n = pairs.length;
  const B = pairs.map((p) => spin(p[2], p[3], q));
  let mbx = 0, mby = 0, max = 0, may = 0;
  pairs.forEach((p, i) => { mbx += B[i][0]; mby += B[i][1]; max += p[0]; may += p[1]; });
  mbx /= n; mby /= n; max /= n; may /= n;
  let s = fixedScale;
  if (s == null) {
    let num = 0, den = 0;
    pairs.forEach((p, i) => { const bx = B[i][0] - mbx, by = B[i][1] - mby, ax = p[0] - max, ay = p[1] - may; num += ax * bx + ay * by; den += bx * bx + by * by; });
    s = den > 1e-6 ? num / den : 1;
    s = Math.max(0.5, Math.min(2, s));
  }
  const tx = max - s * mbx, ty = may - s * mby;
  let se = 0;
  pairs.forEach((p, i) => { const dx = s * B[i][0] + tx - p[0], dy = s * B[i][1] + ty - p[1]; se += dx * dx + dy * dy; });
  return { s, tx, ty, rms: Math.sqrt(se / n) };
}

// shared room numbers between a and b -> [[ax, ay, bx, by, wa, ha, wb, hb]]
function shared(a, b) {
  const ra = new Map(rooms(a).map((r) => [r.number, r]));
  const out = [];
  for (const r of rooms(b)) {
    const m = ra.get(r.number);
    if (!m) continue;
    const ca = centre(m), cb = centre(r), ba = boxOf(m), bb = boxOf(r);
    out.push([ca[0], ca[1], cb[0], cb[1], ba.w, ba.h, bb.w, bb.h]);
  }
  return out;
}

// ---- matching rooms between two photos by label AND by shape: a hypothesis (turn, scale, shift) from one pair of rooms
// is scored by how many other rooms of the two plans coincide under it, so a few misread numbers do no harm
const digits = (n) => String(n || '').replace(/^[A-Z]+/, ''); // W292 -> 292 (a misread or lost prefix still matches)
function labelScore(x, y) {
  if (!x || !y) return 0;
  if (x === y) return 3;
  const dx = digits(x), dy = digits(y);
  if (dx.length >= 3 && dx === dy) return 2;
  return 0;
}
function sizeRatio(a, b, q) {
  const [bw, bh] = q % 2 ? [b.h, b.w] : [b.w, b.h];
  const rw = a.w / Math.max(1, bw), rh = a.h / Math.max(1, bh);
  return { s: Math.sqrt(rw * rh), skew: Math.max(rw, rh) / Math.min(rw, rh) };
}
// Rooms that carry the same number on both plans (a lost letter prefix still counts) fix the turn, scale and shift by
// themselves: two of them already do; the pair of pairs that most others agree with wins (a misread number is an outlier).
export function alignByLabels(a, b) {
  const rb = new Map();
  for (const it of b.items) if (it.type === 'room' && it.number && (it.points || (ok(it.x) && ok(it.w)))) { const k = digits(it.number); if (k.length >= 2) rb.set(k, it); }
  const P = [];
  for (const it of a.items) {
    if (it.type !== 'room' || !it.number || !(it.points || (ok(it.x) && ok(it.w)))) continue;
    const m = rb.get(digits(it.number));
    if (m) P.push({ a: centre(it), b: centre(m), ba: boxOf(it), bb: boxOf(m) });
  }
  if (P.length < 2) return null;
  const hint = compassTurn(a, b);
  let best = null;
  for (const q of [0, 1, 2, 3]) {
    const B = P.map((p) => spin(p.b[0], p.b[1], q));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const vax = P[j].a[0] - P[i].a[0], vay = P[j].a[1] - P[i].a[1], vbx = B[j][0] - B[i][0], vby = B[j][1] - B[i][1];
      const la = Math.hypot(vax, vay), lb = Math.hypot(vbx, vby);
      if (la < 60 || lb < 60) continue;
      const s = la / lb;
      if (s < 0.55 || s > 1.9) continue;
      const cos = (vax * vbx + vay * vby) / (la * lb);
      if (cos < 0.97) continue; // the two pairs must point the same way once turned
      const tx = P[i].a[0] - s * B[i][0], ty = P[i].a[1] - s * B[i][1];
      let inl = 0;
      const pairs = [];
      P.forEach((p, k) => { const d = Math.hypot(s * B[k][0] + tx - p.a[0], s * B[k][1] + ty - p.a[1]); if (d <= 0.6 * Math.min(p.ba.w, p.ba.h, 150)) { inl++; pairs.push([p.a[0], p.a[1], p.b[0], p.b[1]]); } });
      const score = inl * (hint != null && q !== hint ? 0.7 : 1);
      if (inl >= 2 && (!best || score > best.score)) best = { q, s, tx, ty, inl, pairs, score };
    }
  }
  if (!best) return null;
  const fit = fitScaleShift(best.pairs, best.q);
  return { q: best.q, s: fit.s, tx: fit.tx, ty: fit.ty, n: best.inl, labelled: best.inl, rms: fit.rms, score: 3 * best.inl, how: 'rooms' };
}

export function alignByShape(a, b, opts = {}) {
  const byLabel = alignByLabels(a, b);
  if (byLabel && byLabel.n >= 2) return byLabel;
  const ra = a.items.filter((it) => it.type === 'room' && it.cls !== 'void' && ok(it.x ?? (it.points && it.points[0][0]))).map((it) => ({ it, b: boxOf(it), c: centre(it) }));
  const rb = b.items.filter((it) => it.type === 'room' && it.cls !== 'void' && ok(it.x ?? (it.points && it.points[0][0]))).map((it) => ({ it, b: boxOf(it), c: centre(it) }));
  if (!ra.length || !rb.length) return null;
  const hint = compassTurn(a, b);
  let best = null;
  for (const q of [0, 1, 2, 3]) {
    const qPenalty = hint == null || hint === q ? 1 : 0.5;
    for (const x of ra) for (const y of rb) {
      const lab = labelScore(x.it.number, y.it.number);
      const { s, skew } = sizeRatio(x.b, y.b, q);
      if (skew > 1.35 || s < (lab ? 0.75 : 0.85) || s > (lab ? 1.35 : 1.18)) continue;
      if (!lab && Math.min(x.b.w, x.b.h) < 40) continue;
      const [rx, ry] = spin(y.c[0], y.c[1], q);
      const tx = x.c[0] - s * rx, ty = x.c[1] - s * ry;
      // score every other room
      let score = 0, labelled = 0, n = 0;
      const pairs = [];
      for (const p of ra) {
        let bestQ = 0, bestR = null;
        for (const r of rb) {
          const [ux, uy] = spin(r.c[0], r.c[1], q);
          const d = Math.hypot(s * ux + tx - p.c[0], s * uy + ty - p.c[1]);
          const lim = 0.35 * Math.min(p.b.w, p.b.h, 120);
          if (d > lim) continue;
          const sr = sizeRatio(p.b, r.b, q);
          if (sr.skew > 1.5 || sr.s / s > 1.35 || sr.s / s < 0.74) continue;
          const l = labelScore(p.it.number, r.it.number);
          const sc = 1 + 1.5 * l - d / lim;
          if (sc > bestQ) { bestQ = sc; bestR = { p, r, l }; }
        }
        if (bestR) { score += bestQ; n++; if (bestR.l) labelled++; pairs.push([bestR.p.c[0], bestR.p.c[1], bestR.r.c[0], bestR.r.c[1]]); }
      }
      // rooms of b that land on rooms of a without coinciding with them: this hypothesis puts the photos on top of each other
      let conflicts = 0;
      for (const r of rb) {
        const [ux, uy] = spin(r.c[0], r.c[1], q);
        const cx = s * ux + tx, cy = s * uy + ty;
        const [bw, bh] = q % 2 ? [r.b.h, r.b.w] : [r.b.w, r.b.h];
        const w2 = s * bw, h2 = s * bh;
        for (const p of ra) {
          const ox = Math.max(0, Math.min(cx + w2 / 2, p.c[0] + p.b.w / 2) - Math.max(cx - w2 / 2, p.c[0] - p.b.w / 2));
          const oy = Math.max(0, Math.min(cy + h2 / 2, p.c[1] + p.b.h / 2) - Math.max(cy - h2 / 2, p.c[1] - p.b.h / 2));
          if (ox * oy < 0.4 * Math.min(w2 * h2, p.b.w * p.b.h)) continue;
          const same = Math.hypot(cx - p.c[0], cy - p.c[1]) < 0.35 * Math.min(p.b.w, p.b.h, 120) && Math.max(w2 / p.b.w, p.b.w / w2) < 1.5;
          if (!same) conflicts++;
        }
      }
      score = (score - 1.2 * conflicts) * qPenalty;
      if (!best || score > best.score) best = { q, s, tx, ty, score, n, labelled, pairs, conflicts };
    }
  }
  if (!best) return null;
  // enough evidence: 3+ rooms that coincide, or 2 with a matching number, or 1 with a long matching number under the compass turn
  const quiet = best.conflicts <= Math.max(1, 0.2 * best.n);
  const strong = quiet && ((best.n >= 4 && best.score >= 3) || (best.n >= 3 && best.labelled >= 1) || (best.n >= 2 && best.labelled >= 2) || (best.labelled >= 1 && best.n >= 1 && best.conflicts === 0 && (hint == null || hint === best.q)));
  if (!strong) return null;
  // refine over the coincident rooms
  let fit = { s: best.s, tx: best.tx, ty: best.ty, rms: 0 };
  if (best.pairs.length >= 3) fit = fitScaleShift(best.pairs, best.q);
  return { q: best.q, s: fit.s, tx: fit.tx, ty: fit.ty, n: best.n, labelled: best.labelled, rms: fit.rms, score: best.score, how: 'rooms' };
}

// compass turn between two plans (quarter turns to rotate b so its north matches a's), or null
export function compassTurn(a, b) {
  if (!a.compass || !b.compass || !ok(a.compass.deg) || !ok(b.compass.deg)) return null;
  return ((Math.round((a.compass.deg - b.compass.deg) / 90) % 4) + 4) % 4;
}

// Best transform of plan b into plan a from shared room numbers. -> { q, s, tx, ty, n, rms, how: 'numbers' } | null
export function alignByNumbers(a, b) {
  const sh = shared(a, b);
  if (!sh.length) return null;
  const hint = compassTurn(a, b);
  let best = null;
  for (const q of [0, 1, 2, 3]) {
    let fit;
    if (sh.length >= 2) fit = fitScaleShift(sh, q);
    else {
      // one room: its size says the scale (same room in both: width / height swap with the turn)
      const [, , , , wa, ha, wb, hb] = sh[0];
      const [rw, rh] = q % 2 ? [hb, wb] : [wb, hb];
      const s = Math.max(0.6, Math.min(1.6, Math.sqrt((wa * ha) / Math.max(1, rw * rh))));
      fit = fitScaleShift(sh, q, s);
    }
    // a turn the compass disagrees with is penalised (needed when only one room is shared)
    const penalty = hint != null && q !== hint ? (sh.length >= 2 ? 1.15 : 3) : 1;
    const score = fit.rms * penalty;
    if (!best || score < best.score) best = { ...fit, q, score };
  }
  return { q: best.q, s: best.s, tx: best.tx, ty: best.ty, n: sh.length, rms: best.rms, how: 'numbers' };
}

// ---- hallway ends: where a corridor runs off the edge of its plan
function hallEnds(plan) {
  const hs = halls(plan);
  const pts = plan.floor && plan.floor.points && plan.floor.points.length ? plan.floor.points : null;
  const all = [...hs, ...plan.items.filter((it) => it.type === 'room')].map(boxOf);
  const x0 = pts ? Math.min(...pts.map((p) => p[0])) : Math.min(...all.map((b) => b.x)), x1 = pts ? Math.max(...pts.map((p) => p[0])) : Math.max(...all.map((b) => b.x + b.w));
  const y0 = pts ? Math.min(...pts.map((p) => p[1])) : Math.min(...all.map((b) => b.y)), y1 = pts ? Math.max(...pts.map((p) => p[1])) : Math.max(...all.map((b) => b.y + b.h));
  const span = Math.max(x1 - x0, y1 - y0), tol = Math.max(30, span * 0.06);
  const ends = [];
  for (const hl of hs) {
    const horiz = hl.w >= hl.h, thick = horiz ? hl.h : hl.w, len = horiz ? hl.w : hl.h;
    if (len < thick * 2.5) continue;
    if (horiz) {
      if (hl.x - x0 <= tol) ends.push({ side: 'W', x: hl.x, y: hl.y + hl.h / 2, thick });
      if (x1 - (hl.x + hl.w) <= tol) ends.push({ side: 'E', x: hl.x + hl.w, y: hl.y + hl.h / 2, thick });
    } else {
      if (hl.y - y0 <= tol) ends.push({ side: 'N', x: hl.x + hl.w / 2, y: hl.y, thick });
      if (y1 - (hl.y + hl.h) <= tol) ends.push({ side: 'S', x: hl.x + hl.w / 2, y: hl.y + hl.h, thick });
    }
  }
  return ends;
}
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const SIDE_Q = { N: 0, E: 1, S: 2, W: 3 };
const turnSide = (side, q) => 'NESW'[(SIDE_Q[side] + q) % 4];

// plan b joined to plan a where b's corridor end meets a's. -> { q, s, tx, ty, how: 'hallway', cost } | null
export function alignByHallways(a, b) {
  const ea = hallEnds(a), eb0 = hallEnds(b);
  if (!ea.length || !eb0.length) return null;
  const hint = compassTurn(a, b);
  let best = null;
  for (const q of hint != null ? [hint] : [0, 1, 2, 3]) {
    for (const x of eb0) {
      const [rx, ry] = spin(x.x, x.y, q);
      const side = turnSide(x.side, q);
      for (const y of ea) {
        if (y.side !== OPP[side]) continue;
        const dt = Math.abs(y.thick - x.thick) / Math.max(y.thick, x.thick);
        if (dt > 0.45) continue;
        const tx = y.x - rx, ty = y.y - ry;
        const cost = dt + 0.001;
        if (!best || cost < best.cost) best = { q, s: 1, tx, ty, how: 'hallway', cost };
      }
    }
  }
  return best;
}

// ---- all plans into plan 0's frame
// -> { tfs, roots }: tfs[i] maps plan i into the frame of ITS group's root plan (roots[0] = 0 is the reference); a group
// that nothing connects to the first one has its own root, and the caller decides where that group goes (placeBeside).
export function alignPlans(plans) {
  const n = plans.length;
  const tfs = Array(n).fill(null), roots = [];
  if (!n) return { tfs, roots };
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const num = alignByShape(plans[i], plans[j]); // maps j into i
    if (num) edges.push({ from: i, to: j, t: num, weight: 10 * num.score + 50 * num.labelled });
    else {
      const hall = alignByHallways(plans[i], plans[j]);
      if (hall) edges.push({ from: i, to: j, t: hall, weight: 1 - hall.cost });
    }
  }
  const grow = (root) => {
    tfs[root] = { q: 0, s: 1, tx: 0, ty: 0, how: root === 0 ? 'reference' : 'group root', n: 0, rms: 0, root };
    roots.push(root);
    for (;;) {
      let pick = null;
      for (const e of edges) if (tfs[e.from] && tfs[e.from].root === root && !tfs[e.to] && (!pick || e.weight > pick.weight)) pick = e;
      if (!pick) break;
      const A = tfs[pick.from], T = pick.t;
      // p_from = T(p_to); p_root = A(p_from)
      const [tx, ty] = apply(A, T.tx, T.ty);
      tfs[pick.to] = { q: (A.q + T.q) % 4, s: A.s * T.s, tx, ty, how: T.how, n: T.n || 0, rms: T.rms || 0, labelled: T.labelled || 0, root };
    }
  };
  grow(0);
  while (tfs.some((t) => !t)) {
    // the next group starts from the unplaced plan with the strongest link to another unplaced one
    let best = -1, bw = -1;
    for (let i = 0; i < n; i++) if (!tfs[i]) { const w = Math.max(0, ...edges.filter((e) => e.from === i && !tfs[e.to]).map((e) => e.weight)); if (w > bw) { bw = w; best = i; } }
    grow(best);
  }
  return { tfs, roots };
}

// compose: p_outer = F(p_root), p_root = T(p) -> p_outer = (F o T)(p)
export function compose(F, T) {
  const [tx, ty] = apply(F, T.tx, T.ty);
  return { ...T, q: (F.q + T.q) % 4, s: F.s * T.s, tx, ty };
}

const numOf = (n) => { const m = /\d{2,4}/.exec(String(n || '')); return m ? parseInt(m[0], 10) : null; };
// the plan's corridor: the biggest hallway (centre line and which way it runs), for lining groups up
function mainHall(items) {
  const hs = items.filter((it) => it.type === 'hall' && ok(it.w)).sort((a, b) => b.w * b.h - a.w * a.h);
  return hs[0] || null;
}

// Where a group with no link to the placed plans goes: beside them, the way its room numbers continue (higher numbers on
// the right / below), turned to the compass of plan 0, with its main corridor in line with theirs. `group` = [plan indexes]
// with their transforms into the group root's frame already in tfs; `placed` = items merged so far. -> a transform for the root
export function placeBeside(plans, group, tfs, placed) {
  const root = tfs[group[0]].root, rootPlan = plans[root];
  const hint = plans[0].compass && rootPlan.compass ? compassTurn(plans[0], rootPlan) : null;
  const q = hint == null ? 0 : hint;
  const members = group.map((i) => placeItem0(plans[i], tfs[i])).flat();
  const mine = members.filter((it) => it.type === 'room' && it.number).map((it) => numOf(it.number)).filter((v) => v != null);
  const theirs = placed.filter((it) => it.type === 'room' && it.number).map((it) => numOf(it.number)).filter((v) => v != null);
  const after = !mine.length || !theirs.length || Math.min(...mine) >= Math.max(...theirs) - 20;
  const rot = { q, s: 1, tx: 0, ty: 0 };
  const turned = members.map((it) => placeItem(it, rot));
  const bb = (list) => { const bs = list.filter((it) => (it.type === 'room' || it.type === 'hall' || it.type === 'stair') && (it.points || (ok(it.x) && ok(it.w)))).map(boxOf); return bs.length ? { x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)), x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)) } : { x0: 0, y0: 0, x1: 0, y1: 0 }; };
  const B = bb(placed), M = bb(turned);
  const gap = 60;
  let tx = after ? B.x1 + gap - M.x0 : B.x0 - gap - M.x1;
  let ty = B.y0 - M.y0;
  const h1 = mainHall(placed), h2 = mainHall(turned);
  if (h1 && h2 && h1.w >= h1.h === h2.w >= h2.h) ty = (h1.y + h1.h / 2) - (h2.y + h2.h / 2);
  return { q, s: 1, tx, ty, how: 'beside', n: 0, rms: 0 };
}
const placeItem0 = (plan, t) => plan.items.map((it) => placeItem(it, t));

// ---- moving pieces
export function placeItem(it, t) {
  const m = (x, y) => apply(t, x, y).map(Math.round);
  const box = (x, y, w, h) => {
    const [a, b] = m(x, y), [c, d] = m(x + w, y + h);
    return { x: Math.min(a, c), y: Math.min(b, d), w: Math.max(5, Math.abs(c - a)), h: Math.max(5, Math.abs(d - b)) };
  };
  const out = { ...it };
  if (it.points) out.points = it.points.map(([x, y]) => m(x, y));
  else if (ok(it.x) && ok(it.w)) Object.assign(out, box(it.x, it.y, it.w, it.h));
  else if (it.type === 'door' || it.type === 'authwall') { [out.x1, out.y1] = m(it.x1, it.y1); [out.x2, out.y2] = m(it.x2, it.y2); }
  else if (ok(it.x)) [out.x, out.y] = m(it.x, it.y);
  if (it.type === 'door' && it.label) { const [lx, ly] = m(it.label.x, it.label.y); out.label = { ...it.label, x: lx, y: ly }; }
  if (it.type === 'stair' && t.q % 2) out.dir = it.dir === 'h' ? 'v' : 'h';
  if (it.type === 'compass') out.deg = (((it.deg || 0) + 90 * t.q) % 360 + 360) % 360;
  if (it.label && it.type === 'room' && ok(it.label.x) && ok(it.label.y)) { const [lx, ly] = m(it.label.x, it.label.y); out.label = { ...it.label, x: lx, y: ly }; }
  return out;
}

const area = (it) => { const b = boxOf(it); return b.w * b.h; };
function overlapShare(a, b) { // share of a inside b
  const A = boxOf(a), B = boxOf(b);
  const x = Math.max(0, Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)), y = Math.max(0, Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y));
  return (x * y) / Math.max(1, A.w * A.h);
}

// Plans moved into one frame; a room on two photos is kept once, overlapping duplicates and repeated symbols dropped.
export function mergePlans(plans, tfs) {
  const items = [], report = { placed: [], dropped: [], unplaced: [] };
  const rings = [];
  plans.forEach((plan, i) => {
    const t = tfs[i];
    if (!t) { report.unplaced.push(plan.id); return; }
    report.placed.push({ id: plan.id, how: t.how, n: t.n, rms: t.rms });
    if (plan.floor && plan.floor.points) rings.push(plan.floor.points.map(([x, y]) => apply(t, x, y).map(Math.round)));
    for (const raw of plan.items) {
      if (raw.type === 'compass' && items.some((it) => it.type === 'compass')) continue;
      const it = placeItem(raw, t);
      if (it.type === 'room' && it.cls !== 'void') {
        const twin = it.number ? items.findIndex((o) => o.type === 'room' && o.number === it.number) : -1;
        if (twin >= 0) { if (area(it) > 1.25 * area(items[twin])) items[twin] = it; report.dropped.push(it.number); continue; }
        if (items.some((o) => o.type === 'room' && o.cls !== 'void' && Math.min(overlapShare(it, o), overlapShare(o, it)) > 0.6)) { report.dropped.push(it.number || '(unnumbered)'); continue; }
      } else if (it.type === 'hall') {
        if (items.some((o) => o.type === 'hall' && overlapShare(it, o) > 0.7)) continue;
      } else if (it.type === 'stair' || it.type === 'door') {
        const c = it.type === 'door' ? [(it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2] : centre(it);
        if (items.some((o) => o.type === it.type && (() => { const d = o.type === 'door' ? [(o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2] : centre(o); return Math.hypot(d[0] - c[0], d[1] - c[1]) < 40; })())) continue;
      }
      items.push(it);
    }
  });
  return { items, floor: unionRings(rings, items), report };
}

// Union of polygons on a 5-unit grid, widened to hold every room / hall / stair. -> { points } | null
export function unionRings(rings, items = []) {
  rings = rings.filter((r) => r.every((p) => ok(p[0]) && ok(p[1])));
  const all = rings.flat();
  items.filter((it) => it.type === 'room' || it.type === 'hall' || it.type === 'stair').forEach((it) => { const b = boxOf(it); all.push([b.x, b.y], [b.x + b.w, b.y + b.h]); });
  if (!all.length) return null;
  const X0 = Math.floor(Math.min(...all.map((p) => p[0])) / G) - 2, Y0 = Math.floor(Math.min(...all.map((p) => p[1])) / G) - 2;
  const W = Math.ceil(Math.max(...all.map((p) => p[0])) / G) - X0 + 3, H = Math.ceil(Math.max(...all.map((p) => p[1])) / G) - Y0 + 3;
  if (W * H > 4e6) return null;
  const m = new Uint8Array(W * H);
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const bx0 = Math.max(0, Math.floor(Math.min(...ring.map((p) => p[0])) / G) - X0), bx1 = Math.min(W - 1, Math.ceil(Math.max(...ring.map((p) => p[0])) / G) - X0);
    const by0 = Math.max(0, Math.floor(Math.min(...ring.map((p) => p[1])) / G) - Y0), by1 = Math.min(H - 1, Math.ceil(Math.max(...ring.map((p) => p[1])) / G) - Y0);
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (pointInPolygon([(X0 + x + 0.5) * G, (Y0 + y + 0.5) * G], ring)) m[y * W + x] = 1;
  }
  for (const it of items) {
    if (!(it.type === 'room' || it.type === 'hall' || it.type === 'stair')) continue;
    const b = boxOf(it);
    for (let y = Math.floor(b.y / G) - Y0; y < Math.ceil((b.y + b.h) / G) - Y0; y++) for (let x = Math.floor(b.x / G) - X0; x < Math.ceil((b.x + b.w) / G) - X0; x++) if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 1;
  }
  const ring = rectilinearRing(cellRing(joinBlobs(m, W, H), W, H).map(([x, y]) => [(X0 + x) * G, (Y0 + y) * G]));
  return ring.length >= 3 ? { points: ring } : null;
}
