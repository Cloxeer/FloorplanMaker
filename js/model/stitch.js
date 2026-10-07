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
    if (m) P.push({ a: centre(it), b: centre(m), ba: boxOf(it), bb: boxOf(m), exact: it.number === m.number });
  }
  if (!P.length) return [];
  const hint = compassTurn(a, b);
  const out = [];
  const tolOf = (p) => 0.6 * Math.min(p.ba.w, p.ba.h, 150);
  const consider = (q, s, tx, ty, why) => {
    const B = P.map((p) => spin(p.b[0], p.b[1], q));
    const pairs = [];
    P.forEach((p, k) => { if (Math.hypot(s * B[k][0] + tx - p.a[0], s * B[k][1] + ty - p.a[1]) <= tolOf(p)) pairs.push([p.a[0], p.a[1], p.b[0], p.b[1]]); });
    if (!pairs.length) return;
    out.push({ q, s, tx, ty, inl: pairs.length, pairs, why });
  };
  for (const q of [0, 1, 2, 3]) {
    if (hint == null || q !== hint) continue; // one shared room is only believed with both compasses (they say which way), and only an exact number
    // seed: one shared room (the compass fixes the turn, the room's size the scale)
    for (const p of P) {
      if (!p.exact || p.ba.w * p.ba.h < 4000) continue;
      const [rw, rh] = q % 2 ? [p.bb.h, p.bb.w] : [p.bb.w, p.bb.h];
      const s = Math.max(0.7, Math.min(1.4, Math.sqrt((p.ba.w * p.ba.h) / Math.max(1, rw * rh))));
      const [bx, by] = spin(p.b[0], p.b[1], q);
      consider(q, s, p.a[0] - s * bx, p.a[1] - s * by, 'one');
    }
  }
  // seed: two shared rooms (fixes turn, scale and shift by itself); any turn
  for (const q of [0, 1, 2, 3]) {
    const B = P.map((p) => spin(p.b[0], p.b[1], q));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const vax = P[j].a[0] - P[i].a[0], vay = P[j].a[1] - P[i].a[1], vbx = B[j][0] - B[i][0], vby = B[j][1] - B[i][1];
      const la = Math.hypot(vax, vay), lb = Math.hypot(vbx, vby);
      if (la < 60 || lb < 60) continue;
      const sc = la / lb;
      if (sc < 0.7 || sc > 1.45 || (vax * vbx + vay * vby) / (la * lb) < 0.97) continue;
      consider(q, sc, P[i].a[0] - sc * B[i][0], P[i].a[1] - sc * B[i][1], 'two');
    }
  }
  // best first; a turn against the compasses is kept only with 4+ agreeing rooms
  const keep = out.filter((c) => (hint == null || c.q === hint || c.inl >= 4) && (c.inl >= 4 || (c.s >= 0.8 && c.s <= 1.3))).sort((x, y) => y.inl - x.inl || (x.why === 'two' ? -1 : 1));
  const res = [];
  for (const c of keep) {
    if (res.length >= 4) break;
    if (res.some((r) => r.q === c.q && Math.hypot(r.tx - c.tx, r.ty - c.ty) < 40)) continue;
    const fit = c.pairs.length >= 2 ? fitScaleShift(c.pairs, c.q) : { s: c.s, tx: c.tx, ty: c.ty, rms: 0 };
    res.push({ q: c.q, s: fit.s, tx: fit.tx, ty: fit.ty, n: c.inl, labelled: c.inl, rms: fit.rms, score: 3 * c.inl, how: 'rooms' });
  }
  return res;
}

export function alignByShape(a, b) {
  const byLabel = alignByLabels(a, b);
  if (byLabel.length) return byLabel;
  const one = alignShapeOnly(a, b);
  return one ? [one] : [];
}

function alignShapeOnly(a, b) {
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
  if (!ea.length || !eb0.length) return [];
  const hint = compassTurn(a, b);
  const all = [];
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
        all.push({ q, s: 1, tx, ty, how: 'hallway', cost });
      }
    }
  }
  all.sort((m, n) => m.cost - n.cost);
  const out = [];
  for (const c of all) { if (out.length >= 8) break; if (!out.some((o) => o.q === c.q && Math.hypot(o.tx - c.tx, o.ty - c.ty) < 40)) out.push(c); }
  return out;
}

// rooms of plan b (placed by tb) that land ON rooms of plan a (placed by ta) without being the same room: a join that stacks the photos
export function stackConflicts(a, ta, b, tb) {
  const box = (it, t) => {
    const bx = boxOf(it), [x0, y0] = apply(t, bx.x, bx.y), [x1, y1] = apply(t, bx.x + bx.w, bx.y + bx.h);
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  };
  const A = a.items.filter((it) => it.type === 'room' && it.cls !== 'void' && (it.points || (ok(it.x) && ok(it.w)))).map((it) => ({ it, b: box(it, ta) }));
  let n = 0;
  for (const it of b.items) {
    if (it.type !== 'room' || it.cls === 'void' || !(it.points || (ok(it.x) && ok(it.w)))) continue;
    const r = box(it, tb);
    for (const p of A) {
      const ox = Math.max(0, Math.min(r.x1, p.b.x1) - Math.max(r.x0, p.b.x0)), oy = Math.max(0, Math.min(r.y1, p.b.y1) - Math.max(r.y0, p.b.y0));
      const small = Math.min((r.x1 - r.x0) * (r.y1 - r.y0), (p.b.x1 - p.b.x0) * (p.b.y1 - p.b.y0));
      if (small <= 0 || ox * oy < 0.45 * small) continue;
      const same = it.number && p.it.number && digits(it.number) === digits(p.it.number);
      const c0 = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], c1 = [(p.b.x0 + p.b.x1) / 2, (p.b.y0 + p.b.y1) / 2];
      const close = Math.hypot(c0[0] - c1[0], c0[1] - c1[1]) < 0.4 * Math.min(r.x1 - r.x0, r.y1 - r.y0, p.b.x1 - p.b.x0, p.b.y1 - p.b.y0);
      if (!same && !close) n++;
    }
  }
  return n;
}

// Room numbers starting with W are the west wing: a join that puts the W rooms to the east of the others is wrong. (Weak evidence
// such as a corridor end is checked against it; shared rooms are not.) Only when both kinds are present.
const isW = (n) => /^W\d/.test(String(n || ''));
function westConflict(plans, tfs, root, newPlan, cand) {
  const xs = (plan, t, w) => plan.items.filter((it) => it.type === 'room' && it.number && isW(it.number) === w && (it.points || (ok(it.x) && ok(it.w)))).map((it) => apply(t, ...centre(it))[0]);
  let wx = xs(newPlan, cand, true), ox = xs(newPlan, cand, false);
  plans.forEach((p, k) => { if (tfs[k] && tfs[k].root === root) { wx = wx.concat(xs(p, tfs[k], true)); ox = ox.concat(xs(p, tfs[k], false)); } });
  if (wx.length < 2 || ox.length < 2) return false;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return mean(wx) > mean(ox) + 80;
}

// ---- all plans into plan 0's frame
// Strongest evidence first: every pair's candidate joins are sorted by weight and taken one by one (like Kruskal) when they join two
// groups of photos without putting rooms on top of each other. -> { tfs, roots }: tfs[i] maps plan i into the frame of ITS group's root plan
// (plan 0 is the root of its group); a group nothing connects to the first has its own root, and the caller decides where that group
// goes (placeBeside).
export function alignPlans(plans) {
  const n = plans.length;
  const tfs = Array(n).fill(null), roots = [];
  if (!n) return { tfs, roots };
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const cands = alignByShape(plans[i], plans[j]); // each maps j into i, best first
    cands.forEach((t, k) => edges.push({ from: i, to: j, k, t, weight: 10 * t.score + 50 * (t.labelled || 0) - k, strong: true }));
    if (!cands.length) alignByHallways(plans[i], plans[j]).forEach((hall, k) => edges.push({ from: i, to: j, k, t: hall, weight: 1 - hall.cost - 0.01 * k, strong: false }));
  }
  edges.sort((a, b) => b.weight - a.weight);
  const root = plans.map((_, i) => i), tf = plans.map(() => ({ q: 0, s: 1, tx: 0, ty: 0 })); // tf[i]: plan i -> its group root
  const groupOf = (g) => plans.map((_, i) => i).filter((i) => root[i] === g);
  const done = new Set();
  for (const e of edges) {
    if (root[e.from] === root[e.to]) continue;
    const key = `${e.from}>${e.to}#${e.k}`;
    if (done.has(key)) continue;
    // plan e.to into plan e.from's group frame; the whole group of e.to follows
    const A = tf[e.from], T = e.t;
    const [tx, ty] = apply(A, T.tx, T.ty);
    const toInA = { q: (A.q + T.q) % 4, s: A.s * T.s, tx, ty };
    const inv = invertT(tf[e.to]); // group-of-to frame -> plan e.to
    const movers = groupOf(root[e.to]);
    const moved = new Map(movers.map((m) => [m, composeT(toInA, composeT(inv, tf[m]))]));
    // conflicts against the group it joins: rooms of the movers landing on rooms there
    const stay = groupOf(root[e.from]);
    let bad = 0;
    for (const m of movers) for (const k of stay) bad += stackConflicts(plans[k], tf[k], plans[m], moved.get(m));
    const nm = movers.reduce((c, m) => c + rooms(plans[m]).length, 0);
    const wrongSide = !e.strong && westConflictGroups(plans, stay.map((k) => [k, tf[k]]), movers.map((m) => [m, moved.get(m)]));
    const weak = (e.t.n || 0) < 3 && e.t.how !== 'rooms-many';
    if (bad > (weak ? 0 : Math.max(2, 0.12 * nm)) || wrongSide) { done.add(key); continue; }
    const target = root[e.from];
    for (const m of movers) { tf[m] = { ...moved.get(m), how: m === e.to ? T.how : (tf[m].how && tf[m].how !== 'group root' ? tf[m].how : T.how), n: m === e.to ? T.n || 0 : tf[m].n || 0, rms: m === e.to ? T.rms || 0 : 0, labelled: m === e.to ? T.labelled || 0 : tf[m].labelled || 0 }; root[m] = target; }
  }
  // plan 0's group is framed on plan 0; other groups on their lowest plan
  const seen = new Set();
  for (let g = 0; g < n; g++) {
    const r = root[g];
    if (seen.has(r)) continue;
    seen.add(r);
    const members = groupOf(r);
    const base = members.includes(0) ? 0 : members[0];
    const inv = invertT(tf[base]);
    for (const m of members) tfs[m] = { ...composeT(inv, tf[m]), how: m === base ? (base === 0 ? 'reference' : 'group root') : tf[m].how, n: tf[m].n || 0, rms: tf[m].rms || 0, labelled: tf[m].labelled || 0, root: base };
    roots.push(base);
  }
  roots.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
  return { tfs, roots };
}

// p -> s R(q) p + t composed / inverted
export function composeT(F, T) { const [tx, ty] = apply(F, T.tx, T.ty); return { q: (F.q + T.q) % 4, s: F.s * T.s, tx, ty }; }
export function invertT(t) {
  const iq = (4 - t.q) % 4, is = 1 / t.s, [rx, ry] = spin(t.tx, t.ty, iq);
  return { q: iq, s: is, tx: -is * rx, ty: -is * ry };
}
function westConflictGroups(plans, a, b) {
  const xs = (list, w) => list.flatMap(([k, t]) => plans[k].items.filter((it) => it.type === 'room' && it.number && isW(it.number) === w && (it.points || (ok(it.x) && ok(it.w)))).map((it) => apply(t, ...centre(it))[0]));
  const wx = [...xs(a, true), ...xs(b, true)], ox = [...xs(a, false), ...xs(b, false)];
  if (wx.length < 2 || ox.length < 2) return false;
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  return mean(wx) > mean(ox) + 80;
}

// All the steps in one: the plans' transforms into plan 0's frame, with a note for everything that deserves a second look.
// opts: { boardTf(i) -> transform | null, arranged: the user placed the photos by hand (board transforms win), forced: [transform] }
export function layoutPlans(plans, opts = {}) {
  const notes = [], boardTf = opts.boardTf || (() => null);
  let { tfs, roots } = alignPlans(plans);
  if (opts.forced) { tfs = plans.map((_, i) => ({ ...opts.forced[i], how: 'given', root: 0, final: true, n: 0, rms: 0 })); roots = [0]; }
  else if (opts.arranged && plans.every((_, i) => i === 0 || boardTf(i))) {
    tfs = plans.map((_, i) => ({ ...(i === 0 ? { q: 0, s: 1, tx: 0, ty: 0 } : boardTf(i)), how: 'board', root: 0, final: true, n: 0, rms: 0 }));
    roots = [0];
    notes.push('Photos placed as you arranged them on the board.');
  }
  for (const root of roots.slice(1)) {
    const group = tfs.map((t, i) => (t.root === root ? i : -1)).filter((i) => i >= 0);
    const so = mergePlans(plans, tfs.map((t) => (t.root === 0 || t.final ? t : null))).items;
    const bt = opts.arranged ? boardTf(root) : null;
    const F = bt || placeBeside(plans, group, tfs, so);
    for (const i of group) tfs[i] = { ...compose(F, tfs[i]), final: true, how: i === root ? F.how : tfs[i].how };
    notes.push(`${group.map((i) => `Photo ${i + 1}`).join(' and ')} ${group.length > 1 ? 'share' : 'shares'} no room numbers or hallway with the others, so ${group.length > 1 ? 'they were' : 'it was'} placed ${bt ? 'where you put it on the board' : 'beside them'}. Check how it joins.`);
  }
  tfs.forEach((t, i) => {
    if (i === 0 || t.final) { if (i > 0 && t.final && !['beside', 'board', 'group root', 'given'].includes(t.how)) notes.push(`Photo ${i + 1}: joined by ${t.how}; check the join.`); return; }
    if (t.how === 'hallway') notes.push(`Photo ${i + 1} was joined to the others by its hallway; check the join.`);
    else if (t.n === 1) notes.push(`Photo ${i + 1} was joined by a single shared room; check the join.`);
  });
  return { tfs, notes };
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
  const wShare = (list) => { const n = list.filter((it) => it.type === 'room' && it.number); return n.length ? n.filter((it) => isW(it.number)).length / n.length : 0; };
  // W-numbered rooms are the west wing: a group of them goes to the left of the others (and the other way round); otherwise the numbers decide
  const wm = wShare(members), wp = wShare(placed);
  const after = wm - wp > 0.5 ? false : wp - wm > 0.5 ? true : (!mine.length || !theirs.length || Math.min(...mine) >= Math.max(...theirs) - 20);
  const rot = { q, s: 1, tx: 0, ty: 0 };
  const turned = members.map((it) => placeItem(it, rot));
  const bb = (list) => { const bs = list.filter((it) => (it.type === 'room' || it.type === 'hall' || it.type === 'stair') && (it.points || (ok(it.x) && ok(it.w)))).map(boxOf); return bs.length ? { x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)), x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)) } : { x0: 0, y0: 0, x1: 0, y1: 0 }; };
  const B = bb(placed), M = bb(turned);
  const gap = 60;
  let tx = after ? B.x1 + gap - M.x0 : B.x0 - gap - M.x1;
  let ty = B.y0 - M.y0;
  // corridors meet end to end: the placed corridor that reaches furthest towards the newcomer and the newcomer's corridor that
  // reaches furthest back are put on one line, touching (when that does not put rooms on rooms)
  const long = (list) => list.filter((it) => it.type === 'hall' && ok(it.w) && it.w >= 1.6 * it.h && it.w >= 150);
  const hp = long(placed), hn = long(turned);
  if (hp.length && hn.length) {
    const a = after ? hp.reduce((m, h) => (h.x + h.w > m.x + m.w ? h : m)) : hp.reduce((m, h) => (h.x < m.x ? h : m));
    const b = after ? hn.reduce((m, h) => (h.x < m.x ? h : m)) : hn.reduce((m, h) => (h.x + h.w > m.x + m.w ? h : m));
    const dty = a.y + a.h / 2 - (b.y + b.h / 2), dtx = after ? a.x + a.w - b.x : a.x - (b.x + b.w);
    const trial = { q, s: 1, tx: dtx, ty: dty };
    const bad = stackConflicts({ items: placed }, { q: 0, s: 1, tx: 0, ty: 0 }, { items: members }, trial);
    if (bad === 0 && Math.abs(a.h - b.h) <= 0.6 * Math.max(a.h, b.h)) return { ...trial, how: 'beside', n: 0, rms: 0 };
    ty = dty; // the corridors at least on one line
  }
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
