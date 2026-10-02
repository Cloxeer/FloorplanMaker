// overlaps.js
// Pure overlap detection between plan items, for the Layers panel.
// Counted: room/void/core vs room (incl. containment) and room vs stair.
// Halls, doors, compass and legend never count (halls are visual guides).
// Depends on: js/model/geometry.js, js/model/document.js (roomPolygon).

import { bbox } from './geometry.js';
import { overlapAreaAny } from './polyOverlap.js';
import { roomPolygon } from './document.js';

function polyOf(it) {
  if (it.type === 'room' || it.type === 'stair') return roomPolygon(it.type === 'stair' ? { ...it, shape: 'rect' } : it);
  return null;
}

function pairCounts(a, b) {
  if (a.type === 'room' && b.type === 'room') return true;
  return (a.type === 'room' && b.type === 'stair') || (a.type === 'stair' && b.type === 'room');
}

// Bounding-box intersection in px (w x h); cheap size hint, 0 x 0 if only touching.
export function overlapAmount(pa, pb) {
  const a = bbox(pa), b = bbox(pb);
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) };
}

function test(a, b) {
  if (!pairCounts(a, b)) return null;
  const pa = polyOf(a), pb = polyOf(b);
  if (!pa || !pb || pa.length < 3 || pb.length < 3) return null;
  const amt = overlapAmount(pa, pb);
  if (!(amt.w > 0 && amt.h > 0)) return null;
  return overlapAreaAny(pa, pb) > 0 ? amt : null; // exact area: touching edges and notches do not count
}

// Items overlapping item `id`: [{ item, w, h }]
export function findOverlaps(doc, id) {
  const me = doc && doc.items ? doc.items.find((i) => i.id === id) : null;
  if (!me) return [];
  const out = [];
  for (const it of doc.items) {
    if (it.id === id) continue;
    const amt = test(me, it);
    if (amt) out.push({ item: it, ...amt });
  }
  return out;
}

// Every overlapping pair in the plan: [{ a, b, w, h }]
export function allOverlapPairs(doc) {
  const items = ((doc && doc.items) || []).filter((i) => i.type === 'room' || i.type === 'stair');
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const amt = test(items[i], items[j]);
      if (amt) out.push({ a: items[i], b: items[j], ...amt });
    }
  }
  return out;
}

// 'inside' when one shape's box lies fully inside the other's, else 'cross'.
function kindOf(a, b) {
  const A = bbox(polyOf(a)), B = bbox(polyOf(b));
  const within = (p, q) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.w <= q.x + q.w + 1 && p.y + p.h <= q.y + q.h + 1;
  return within(A, B) || within(B, A) ? 'inside' : 'cross';
}

// Overlapping items grouped into clusters (connected groups), so every red item can be
// tied to what it overlaps: [{ items:[item], pairs:[{a,b,w,h,kind}] }], biggest first.
export function overlapClusters(doc) {
  const pairs = allOverlapPairs(doc).map((p) => ({ ...p, kind: kindOf(p.a, p.b) }));
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of pairs) {
    for (const it of [p.a, p.b]) if (!parent.has(it.id)) parent.set(it.id, it.id);
    parent.set(find(p.a.id), find(p.b.id));
  }
  const groups = new Map();
  for (const p of pairs) {
    const root = find(p.a.id);
    if (!groups.has(root)) groups.set(root, { items: new Map(), pairs: [] });
    const g = groups.get(root);
    g.items.set(p.a.id, p.a); g.items.set(p.b.id, p.b);
    g.pairs.push(p);
  }
  return [...groups.values()]
    .map((g) => ({ items: [...g.items.values()], pairs: g.pairs }))
    .sort((x, y) => y.items.length - x.items.length || y.pairs.length - x.pairs.length);
}
