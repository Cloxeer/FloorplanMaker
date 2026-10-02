// fixHallsLink.js
// Geometry for "fix hallway notes": every clean way to link a hallway P to a target Q (another hallway,
// a room, or an anchor such as a stair box / door / outline edge). Pure rectangles in, candidates out;
// fixHalls.js ranks and validates them. All hallways are axis-aligned rects {x,y,w,h}.
//
// A party is { id?, rect, hall: bool, thick, reach? } (id present = a hallway we may change).
// A candidate is { mods:[{id, rect}], adds:[rect], strips:[rect], tier } where strips are the newly
// covered areas (extension strips and new connectors) and tier 0 is the preferred form (a hallway
// that is extended or a connector reaches a few units INTO a crossing hallway), tier 1 only touches.
// Candidates: extend a facing hallway, one short connector, extend-then-connect for diagonal gaps,
// or an L of two connectors (both orientations). Everything is on whole numbers.
// Depends on: nothing.

export const snap5 = (v) => Math.round(v / 5) * 5;
const fl5 = (v) => (v >= 5 ? Math.floor(v / 5) * 5 : 0);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
export const isH = (r) => r.w > r.h;
const T = (r) => ({ x: r.y, y: r.x, w: r.h, h: r.w });
const Tp = (p) => ({ ...p, rect: T(p.rect) });
const Tc = (c) => ({ ...c, mods: c.mods.map((m) => ({ ...m, rect: T(m.rect) })), adds: c.adds.map(T), strips: c.strips.map(T) });

// how far a connector/extension reaches into the target (0 = just touch)
function marg(Q, horizontal, along, sc) {
  if (!Q.hall) return Math.min(Q.reach || 0, Math.floor(along / 2));
  return isH(Q.rect) === horizontal ? 0 : Math.min(Math.round(5 * sc), Math.floor(along / 2));
}

// P and Q face each other along x (their y ranges overlap, x ranges are apart)
function facingX(P, Q, sc) {
  const a = P.rect, b = Q.rect, out = [];
  const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h), ov = hi - lo;
  if (ov < Math.min(5, b.h)) return out;
  const left = a.x + a.w <= b.x, right = b.x + b.w <= a.x;
  if (!left && !right) return out;
  if (a.w >= a.h) { // extend P along its own length
    const mg = marg(Q, true, b.w, sc);
    if (left) {
      const x2 = Math.round(b.x) + mg;
      if (x2 > a.x + a.w) out.push({ mods: [{ id: P.id, rect: { ...a, w: x2 - a.x } }], adds: [], strips: [{ x: a.x + a.w, y: a.y, w: x2 - a.x - a.w, h: a.h }] });
    } else {
      const x1 = Math.round(b.x + b.w) - mg;
      if (x1 < a.x) out.push({ mods: [{ id: P.id, rect: { ...a, x: x1, w: a.x + a.w - x1 } }], adds: [], strips: [{ x: x1, y: a.y, w: a.x - x1, h: a.h }] });
    }
  }
  if (Q.id && b.w >= b.h) { // or extend Q toward P
    const mg = marg(P, true, a.w, sc);
    if (left) {
      const x1 = Math.round(a.x + a.w) - mg;
      if (x1 < b.x) out.push({ mods: [{ id: Q.id, rect: { ...b, x: x1, w: b.x + b.w - x1 } }], adds: [], strips: [{ x: x1, y: b.y, w: b.x - x1, h: b.h }] });
    } else {
      const x2 = Math.round(a.x) + mg;
      if (x2 > b.x + b.w) out.push({ mods: [{ id: Q.id, rect: { ...b, w: x2 - b.x } }], adds: [], strips: [{ x: b.x + b.w, y: b.y, w: x2 - b.x - b.w, h: b.h }] });
    }
  }
  // or one short connector between them, as wide as the narrower one, centred on the overlap
  const t = fl5(Math.min(P.thick, Q.thick, ov));
  if (t >= 5) {
    const mA = marg(P, true, a.w, sc), mB = marg(Q, true, b.w, sc);
    const x1 = left ? a.x + a.w - mA : Math.round(b.x + b.w) - mB;
    const x2 = left ? Math.round(b.x) + mB : a.x + mA;
    // centred on the overlap first; sliding to either side lets it miss rooms that sit in the way
    const mid = (lo + hi) / 2 - t / 2, ys = [mid, lo, hi - t, (lo + mid) / 2, (mid + hi - t) / 2].map((v) => Math.round(clamp(snap5(v), lo, hi - t)));
    if (x2 - x1 >= 5) for (const y0 of new Set(ys)) { const r = { x: x1, y: y0, w: x2 - x1, h: t }; out.push({ mods: [], adds: [r], strips: [r] }); }
  }
  return out;
}

// P and Q are apart on both axes: stretch a hallway along its length until the two face each other,
// then link them as above (extension of the other one, or one connector).
function diagMove(M, O, sc) {
  const m = M.rect, o = O.rect, out = [];
  if (m.w < m.h || !(m.x + m.w <= o.x || o.x + o.w <= m.x)) return out;
  const inset = Math.min(o.w, 10);
  let nr, strip;
  if (m.x + m.w <= o.x) { const x2 = Math.round(o.x) + inset; if (x2 <= m.x + m.w) return out; nr = { ...m, w: x2 - m.x }; strip = { x: m.x + m.w, y: m.y, w: x2 - m.x - m.w, h: m.h }; }
  else { const x1 = Math.round(o.x + o.w) - inset; if (x1 >= m.x) return out; nr = { ...m, x: x1, w: m.x + m.w - x1 }; strip = { x: x1, y: m.y, w: m.x - x1, h: m.h }; }
  for (const sub of facingX(Tp({ ...M, rect: nr }), Tp(O), sc)) {
    const s = Tc(sub);
    out.push({ mods: [{ id: M.id, rect: nr }, ...s.mods], adds: s.adds, strips: [strip, ...s.strips] });
  }
  return out;
}

// An L of two connectors: horizontal out of P's side, then vertical into Q (P left/right, above/below Q).
function lShape(P, Q, sc) {
  const a = P.rect, b = Q.rect;
  const left = a.x + a.w <= b.x, right = b.x + b.w <= a.x, above = a.y + a.h <= b.y, below = b.y + b.h <= a.y;
  const t = fl5(Math.min(P.thick, Q.thick));
  if (!(left || right) || !(above || below) || t < 5) return [];
  const y1 = Math.round(clamp(snap5(a.y + a.h / 2 - t / 2), a.y, a.y + a.h - t));
  const c0 = Math.round(clamp(snap5(b.x + b.w / 2 - t / 2), b.x, b.x + b.w - t));
  const mA = marg(P, true, a.w, sc), mB = marg(Q, false, b.h, sc);
  const bar1 = left ? { x: a.x + a.w - mA, y: y1, w: c0 + t - (a.x + a.w - mA), h: t } : { x: c0, y: y1, w: a.x + mA - c0, h: t };
  const ya = above ? y1 : Math.round(b.y + b.h) - mB;
  const bar2 = above ? { x: c0, y: y1, w: t, h: Math.round(b.y) + mB - y1 } : { x: c0, y: ya, w: t, h: y1 + t - ya };
  if (bar1.w < 5 || bar2.h < 5) return [];
  return [{ mods: [], adds: [bar1, bar2], strips: [bar1, bar2] }];
}

export function linkCands(P, Q, scales = [1, 0]) {
  const out = [];
  for (const sc of scales) {
    const tier = sc === 1 ? 0 : 1;
    const push = (list, tr) => { for (const c of list) out.push({ ...(tr ? Tc(c) : c), tier }); };
    push(facingX(P, Q, sc), false);
    push(facingX(Tp(P), Tp(Q), sc), true);
    for (const [M, O] of [[P, Q], [Q, P]]) {
      if (!M.id) continue;
      push(diagMove(M, O, sc), false);
      push(diagMove(Tp(M), Tp(O), sc), true);
    }
    push(lShape(P, Q, sc), false);
    push(lShape(Tp(P), Tp(Q), sc), true);
  }
  return out;
}
