// connect.js
// Joining buildings the person lines up by hand. When a floor was built from several photos, each piece (building / wing) gets its
// own outline item, { type: 'outline', piece, points }. To join two of them the person adds a colored link: point 1 on a wall of
// one outline and point 2 on a wall of the other, { type: 'connect', pair, slot: 1|2, color, outline: <outline id>, x, y }.
// Each point opens its wall (an opening of OPENING units, centred on the point); the person then draws the connecting hallway
// themselves, and its end snaps to the centre of the opening. Once every link has a hallway at both ends the outlines can be merged
// into ONE outline around everything (mergeOutlines). Nothing here draws a hallway or moves a room.
// Pure. Depends on: js/model/geometry.js, js/model/outlineRestore.js (autoOutline), js/model/document.js (newId).

import { nearestPointOnPolyline } from './geometry.js';
import { autoOutline } from './outlineRestore.js';
import { newId } from './document.js';

export const LINK_COLORS = ['#e5484d', '#2f6feb', '#1f9d55', '#f2a900', '#8e4ec6', '#0aa5a5'];
export const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Amber', 'Purple', 'Teal'];
export const OPENING = 60;

const ok = (v) => Number.isFinite(v);
export const outlinesOf = (doc) => ((doc && doc.items) || []).filter((i) => i && i.type === 'outline' && Array.isArray(i.points) && i.points.length >= 3);
export const connectsOf = (doc) => ((doc && doc.items) || []).filter((i) => i && i.type === 'connect' && ok(i.x) && ok(i.y));
export const hasPieces = (doc) => ((doc && doc.items) || []).some((i) => i && typeof i.piece === 'string' && i.piece);

// ---- extra outlines
// A floor with several separate buildings: the first outline is doc.floor (what the checks and the export are built on); every
// other building has an outline item of its own, with the name the person gave it. All of them are drawn, exported and carry doors.
export const floorRing = (doc) => (doc && doc.floor && Array.isArray(doc.floor.points) && doc.floor.points.length >= 3 ? doc.floor.points : null);
export const ringsOf = (doc) => [floorRing(doc), ...outlinesOf(doc).map((o) => o.points)].filter(Boolean);
export const outlineLabel = (o) => o.name || o.piece || 'Outline';
export function nextOutlineName(doc) {
  const used = new Set(outlinesOf(doc).map(outlineLabel));
  for (let n = 2; ; n++) if (!used.has(`Outline ${n}`)) return `Outline ${n}`;
}
// add a building's outline, or (with an id) redraw that one in place: its name and its connection points stay
export function withOutline(doc, points, { id = null, name = '' } = {}) {
  const pts = points.map((p) => [p[0], p[1]]);
  if (id && outlinesOf(doc).some((o) => o.id === id)) return { ...doc, items: doc.items.map((i) => (i.id === id ? { ...i, points: pts } : i)) };
  return { ...doc, items: [...doc.items, { id: newId(), type: 'outline', name: name || nextOutlineName(doc), points: pts }] };
}
export const withoutOutline = (doc, id) => dropOrphanConnects({ ...doc, items: doc.items.filter((i) => !(i && i.id === id && i.type === 'outline')) });

// the point of an outline's wall nearest to (x, y): a click near a wall lands ON the wall
export function onWall(doc, outlineId, [x, y]) {
  const o = outlinesOf(doc).find((i) => i.id === outlineId);
  if (!o) return null;
  const n = nearestPointOnPolyline([x, y], o.points, true);
  return n ? { x: Math.round(n.x), y: Math.round(n.y), edge: n.segIndex } : null;
}
// the outline whose wall is nearest to (x, y), within reach
export function wallAt(doc, [x, y], reach = 40) {
  let best = null;
  for (const o of outlinesOf(doc)) {
    const n = nearestPointOnPolyline([x, y], o.points, true);
    if (n && n.dist <= reach && (!best || n.dist < best.dist)) best = { outline: o.id, x: Math.round(n.x), y: Math.round(n.y), dist: n.dist };
  }
  return best;
}

// the opening a connect point makes in its outline: a stretch of the wall, along the wall, centred on the point
export function openingOf(doc, c) {
  const o = outlinesOf(doc).find((i) => i.id === c.outline);
  if (!o) return null;
  const n = nearestPointOnPolyline([c.x, c.y], o.points, true);
  if (!n) return null;
  const a = o.points[n.segIndex], b = o.points[(n.segIndex + 1) % o.points.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const h = Math.min(OPENING, L) / 2;
  const t = Math.hypot(n.x - a[0], n.y - a[1]);
  const c0 = Math.max(h, Math.min(L - h, t)); // keep the whole opening on this wall
  const mx = a[0] + ux * c0, my = a[1] + uy * c0;
  return { outlineId: o.id, edge: n.segIndex, centre: [Math.round(mx), Math.round(my)], a: [Math.round(mx - ux * h), Math.round(my - uy * h)], b: [Math.round(mx + ux * h), Math.round(my + uy * h)], horizontal: Math.abs(ux) >= Math.abs(uy) };
}

// -> [{ pair, color, one, two }] (one / two are the connect items, or null while a point is not placed yet)
export function linksOf(doc) {
  const by = new Map();
  for (const c of connectsOf(doc)) {
    const l = by.get(c.pair) || { pair: c.pair, color: c.color, one: null, two: null };
    if (c.slot === 2) l.two = c; else l.one = c;
    by.set(c.pair, l);
  }
  return [...by.values()];
}
export const nextColor = (doc) => { const used = new Set(linksOf(doc).map((l) => l.color)); return LINK_COLORS.find((c) => !used.has(c)) || LINK_COLORS[linksOf(doc).length % LINK_COLORS.length]; };

// the connect points whose link has BOTH points placed: only these open their wall
export const openConnects = (doc) => {
  const both = new Set(linksOf(doc).filter((l) => l.one && l.two).map((l) => l.pair));
  return connectsOf(doc).filter((c) => both.has(c.pair));
};

// the wall of an outline drawn as separate stretches with a gap at each opening: [[[x, y], ...], ...] (a closed ring
// when nothing is open). The outline's own points are never changed.
export function wallStretches(doc, outlineId) {
  const o = outlinesOf(doc).find((i) => i.id === outlineId);
  if (!o) return [];
  const P = o.points, n = P.length;
  const ops = openConnects(doc).filter((c) => c.outline === o.id).map((c) => openingOf(doc, c)).filter(Boolean);
  if (!ops.length) return [P.concat([P[0]])];
  const out = [];
  let cur = [P[0]];
  for (let i = 0; i < n; i++) {
    const A = P[i], B = P[(i + 1) % n];
    const here = ops.filter((op) => op.edge === i).sort((p, q) => Math.hypot(p.a[0] - A[0], p.a[1] - A[1]) - Math.hypot(q.a[0] - A[0], q.a[1] - A[1]));
    for (const op of here) { cur.push(op.a); out.push(cur); cur = [op.b]; }
    cur.push(B);
  }
  out[0] = cur.concat(out[0].slice(1)); // the last stretch ends where the first begins
  return out;
}

// removing outlines takes their connect points with them (a point cannot sit on a wall that is gone)
export function dropOrphanConnects(doc) {
  const have = new Set(outlinesOf(doc).map((o) => o.id));
  const items = doc.items.filter((i) => !(i && i.type === 'connect' && !have.has(i.outline)));
  return items.length === doc.items.length ? doc : { ...doc, items };
}

// every opening centre (what a hallway end snaps to)
export const openingCentres = (doc) => connectsOf(doc).map((c) => { const o = openingOf(doc, c); return o && { pair: c.pair, slot: c.slot, color: c.color, centre: o.centre, horizontal: o.horizontal }; }).filter(Boolean);

// a hallway reaches an opening when it covers the opening's centre (within a few units)
export function hallAt(doc, centre, pad = 8) {
  const [x, y] = centre;
  return ((doc && doc.items) || []).find((h) => h && h.type === 'hall' && ok(h.x) && x >= h.x - pad && x <= h.x + h.w + pad && y >= h.y - pad && y <= h.y + h.h + pad) || null;
}
export function linkState(doc, l) {
  const o1 = l.one && openingOf(doc, l.one), o2 = l.two && openingOf(doc, l.two);
  return { placed: !!(o1 && o2), oneHall: !!(o1 && hallAt(doc, o1.centre)), twoHall: !!(o2 && hallAt(doc, o2.centre)) };
}
// ready to become one outline: at least one link, every link placed, and a hallway at both ends of each
export function mergeReady(doc) {
  const ls = linksOf(doc);
  return ls.length > 0 && ls.every((l) => { const s = linkState(doc, l); return s.placed && s.oneHall && s.twoHall; });
}

// one outline per piece, drawn round that piece only (no outline is bridged to another)
export function pieceOutlines(doc) {
  const names = [...new Set(((doc && doc.items) || []).filter((i) => i && typeof i.piece === 'string' && i.piece).map((i) => i.piece))];
  const out = [];
  for (const name of names) {
    const sub = { ...doc, items: doc.items.filter((i) => i && i.piece === name && i.type !== 'outline' && i.type !== 'connect') };
    const r = autoOutline(sub);
    if (r && r.points && r.points.length >= 3) out.push({ id: newId(), type: 'outline', piece: name, points: r.points });
  }
  return out;
}

// the pieces' outlines and the links become ONE outline round everything (the hallways the person drew join the buildings)
export function mergeOutlines(doc) {
  const rest = { ...doc, items: doc.items.filter((i) => i && i.type !== 'outline' && i.type !== 'connect') };
  const r = autoOutline(rest);
  if (!r) return null;
  return { ...rest, floor: { ...(doc.floor || {}), points: r.points } };
}
