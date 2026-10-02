// fixHallsMorph.js
// "Morphing" a hallway toward the rooms beside it: instead of adding a connector, the hallway's facing
// edge is moved out to the room edge (one bulge per room, snapped to the room edge, merged where the
// edges line up), on one or both sides, so a corridor ends up touching the rooms along every side.
// The hallway is cut into collinear pieces (touching, never overlapping): the original id keeps the
// biggest piece. Pure rectangles in, a candidate { mods, adds, notes, served, area } out; fixHalls.js
// verifies it with the checklist's own rules. Everything is on whole numbers.
// Depends on: nothing.

const MIN_FACE = 5; // a room must face the hallway over at least this much to be served by a bulge
const BRIDGE = 16; // gaps shorter than this between two bulges (or a bulge and the hallway end) are filled in
const T = (r) => ({ x: r.y, y: r.x, w: r.h, h: r.w });
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

// widest a corridor may become: ~1.6x the median short side of the rooms (never below its own width)
export function thicknessCap(items) {
  const sh = items.filter((it) => it.type === 'room' && [it.x, it.y, it.w, it.h].every(Number.isFinite)).map((it) => Math.min(it.w, it.h));
  return 1.6 * median(sh);
}

// ctx: { free(rect) -> no room/stair inside it, inside(rect) -> within the outline, cap }
// H: { id, rect }; rooms: [{ id, rect }]. Returns null when no room can be served by morphing this hallway.
export function morphHall(H, rooms, ctx) {
  const h = H.rect, vert = h.h > h.w;
  const hh = vert ? T(h) : h; // work with a horizontal hallway
  const back = vert ? T : (r) => r;
  const thick = hh.h, cap = Math.max(thick, ctx.cap || 0), maxGap = Math.max(20, thick);
  const okStrip = (s) => s.w >= 1 && s.h >= 1 && ctx.free(back({ x: s.x + 1, y: s.y + 1, w: Math.max(0, s.w - 2), h: Math.max(0, s.h - 2) })) && ctx.inside(back(s));
  const sides = { lo: [], hi: [] };
  for (const room of rooms) {
    const q = vert ? T(room.rect) : room.rect;
    const x0 = Math.max(Math.round(q.x), hh.x), x1 = Math.min(Math.round(q.x + q.w), hh.x + hh.w);
    if (x1 - x0 < Math.min(MIN_FACE, q.w)) continue;
    let side, e, strip;
    if (q.y + q.h <= hh.y) { side = 'lo'; e = Math.round(q.y + q.h); strip = { x: x0, y: e, w: x1 - x0, h: hh.y - e }; }
    else if (q.y >= hh.y + hh.h) { side = 'hi'; e = Math.round(q.y); strip = { x: x0, y: hh.y + hh.h, w: x1 - x0, h: e - hh.y - hh.h }; }
    else continue;
    if (strip.h < 1 || strip.h > maxGap || !okStrip(strip)) continue;
    sides[side].push({ s0: x0, s1: x1, e, id: room.id, gap: strip.h });
  }
  if (!sides.lo.length && !sides.hi.length) return null;
  const nearer = (side, a, b) => (side === 'lo' ? Math.max(a, b) : Math.min(a, b));
  const stripOf = (side, s0, s1, e) => (side === 'lo' ? { x: s0, y: e, w: s1 - s0, h: hh.y - e } : { x: s0, y: hh.y + hh.h, w: s1 - s0, h: e - hh.y - hh.h });
  for (const side of ['lo', 'hi']) { // tight: fill short gaps between bulges / to the hallway end
    const L = sides[side].sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1), extra = [];
    const bridge = (s0, s1, e) => { if (s1 - s0 > 0 && s1 - s0 < BRIDGE && okStrip(stripOf(side, s0, s1, e))) extra.push({ s0, s1, e, gap: Math.abs(e - (side === 'lo' ? hh.y : hh.y + hh.h)) }); };
    if (L.length) {
      bridge(hh.x, L[0].s0, L[0].e);
      for (let i = 0; i + 1 < L.length; i++) bridge(L[i].s1, L[i + 1].s0, nearer(side, L[i].e, L[i + 1].e));
      bridge(L[L.length - 1].s1, hh.x + hh.w, L[L.length - 1].e);
    }
    sides[side] = L.concat(extra);
  }
  for (let guard = 0; guard < 12; guard++) {
    const bps = [...new Set([hh.x, hh.x + hh.w, ...['lo', 'hi'].flatMap((s) => sides[s].flatMap((b) => [b.s0, b.s1]))])].filter((v) => v >= hh.x && v <= hh.x + hh.w).sort((a, b) => a - b);
    const pieces = [];
    let worst = null;
    for (let i = 0; i + 1 < bps.length; i++) {
      const m = (bps[i] + bps[i + 1]) / 2;
      const ext = (side, dflt) => sides[side].filter((b) => b.s0 <= m && m <= b.s1).reduce((v, b) => (v === null ? b.e : nearer(side, v, b.e)), null) ?? dflt;
      const lo = ext('lo', hh.y), hi = ext('hi', hh.y + hh.h);
      if (hi - lo > cap + 0.5) { // too fat: drop the bulge that asks for the most here
        const cs = ['lo', 'hi'].flatMap((s) => sides[s].filter((b) => b.s0 <= m && m <= b.s1).map((b) => ({ s, b })));
        const w = cs.sort((p, q) => q.b.gap - p.b.gap)[0];
        if (w && (!worst || w.b.gap > worst.b.gap)) worst = w;
        continue;
      }
      const last = pieces[pieces.length - 1];
      if (last && last.lo === lo && last.hi === hi && last.x1 === bps[i]) last.x1 = bps[i + 1];
      else pieces.push({ x0: bps[i], x1: bps[i + 1], lo, hi });
    }
    if (worst) { sides[worst.s] = sides[worst.s].filter((b) => b !== worst.b); continue; }
    const real = (p) => p.lo !== hh.y || p.hi !== hh.y + hh.h;
    const served = [...new Set(['lo', 'hi'].flatMap((s) => sides[s].filter((b) => b.id).map((b) => b.id)))];
    if (!served.length || !pieces.some(real)) return null;
    const rects = pieces.map((p) => back({ x: p.x0, y: p.lo, w: p.x1 - p.x0, h: p.hi - p.lo }));
    const big = rects.reduce((bi, r, i) => (r.w * r.h > rects[bi].w * rects[bi].h ? i : bi), 0);
    const added = rects.reduce((s, r) => s + r.w * r.h, 0) - h.w * h.h;
    return { mods: [{ id: H.id, rect: rects[big] }], adds: rects.filter((_, i) => i !== big), served, area: added, notes: [describeMorph(sides, vert, served.length)] };
  }
  return null;
}

function describeMorph(sides, vert, n) {
  const dirs = vert ? { lo: 'left', hi: 'right' } : { lo: 'up', hi: 'down' };
  const parts = ['lo', 'hi'].filter((s) => sides[s].some((b) => b.id)).map((s) => `${dirs[s]} (by up to ${Math.max(...sides[s].map((b) => b.gap))})`);
  return `Widen a ${vert ? 'vertical' : 'horizontal'} hallway ${parts.join(' and ')} so ${n > 1 ? n + ' rooms touch' : 'a room touches'} it`;
}
