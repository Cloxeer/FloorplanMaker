// noteGroups.js
// The "Worth a look" notes, regrouped for people: instead of one long line per room, a few groups
// ("4 rooms need a number", "3 hallways aren't connected", "11 overlapping rooms") and, inside each
// group, the individual STOPS the user is walked through (one room, one overlap cluster, one hallway).
// Each stop knows its item ids so the UI can select it, fly the map to it and say what to do.
// Pure. Depends on: js/model/attention.js, js/model/overlaps.js, js/model/document.js (roomPolygon).

import { overlappingHalls, unconnectedHalls, roomsNotTouchingHall } from './attention.js';
import { overlapClusters } from './overlaps.js';
import { roomPolygon } from './document.js';

const plural = (n, one, many) => (n === 1 ? one : many);

// code -> [kind, one-title, many-title]
const BY_CODE = {
  'room-no-number': ['number', 'room needs a number', 'rooms need a number'],
  'bad-number-format': ['numfix', 'room number is in the wrong format', 'room numbers are in the wrong format'],
  'duplicate-number': ['numfix', 'room shares its number with another', 'rooms share a number with another'],
  'room-unreachable': ['route', 'room is not reachable from an entrance', 'rooms are not reachable from an entrance'],
  'label-outside-shape': ['label', 'label sits outside its room', 'labels sit outside their rooms'],
  'label-in-other-room': ['label', 'label sits in another room', 'labels sit in other rooms'],
  'label-tiny': ['label', 'label is too small to read', 'labels are too small to read'],
  'void-with-label': ['label', 'open-to-below space has text', 'open-to-below spaces have text'],
  'door-off-outline': ['door', 'door is off the outside wall', 'doors are off the outside wall'],
  'door-no-exit-label': ['door', 'door has no EXIT label', 'doors have no EXIT label'],
  'door-no-floor': ['door', 'door has no outline to sit on', 'doors have no outline to sit on'],
};
const ORDER = ['number', 'numfix', 'overlap', 'hall-overlap', 'hall', 'room-hall', 'route', 'label', 'door', 'other'];

const bboxOf = (it) => {
  if (it.type === 'room') {
    const p = roomPolygon(it);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (it.type === 'door') return { x: Math.min(it.x1, it.x2), y: Math.min(it.y1, it.y2), w: Math.abs(it.x2 - it.x1), h: Math.abs(it.y2 - it.y1) };
  return { x: it.x || 0, y: it.y || 0, w: it.w || 0, h: it.h || 0 };
};

// bounding box of a set of item ids (null when none exist)
export function boxOfIds(doc, ids) {
  const by = new Map(((doc && doc.items) || []).map((i) => [i.id, i]));
  let b = null;
  for (const id of ids) {
    const it = by.get(id);
    if (!it) continue;
    let q;
    try { q = bboxOf(it); } catch { continue; }
    if (![q.x, q.y, q.w, q.h].every(Number.isFinite)) continue;
    b = b ? { x: Math.min(b.x, q.x), y: Math.min(b.y, q.y), x2: Math.max(b.x2, q.x + q.w), y2: Math.max(b.y2, q.y + q.h) } : { x: q.x, y: q.y, x2: q.x + q.w, y2: q.y + q.h };
  }
  return b ? { x: b.x, y: b.y, w: b.x2 - b.x, h: b.y2 - b.y } : null;
}

// reading order (top to bottom, then left to right) so "next" walks the plan naturally
function readingOrder(doc, ids) {
  const by = new Map(doc.items.filter(Boolean).map((i) => [i.id, i]));
  const box = (id) => { try { return bboxOf(by.get(id)); } catch { return { x: 0, y: 0 }; } };
  return [...new Set(ids)].filter((id) => by.has(id)).sort((a, b) => {
    const pa = box(a), pb = box(b);
    return Math.round(pa.y / 40) - Math.round(pb.y / 40) || pa.x - pb.x;
  });
}

// -> [{ key, kind, title, count, stops:[{ ids, cluster? }] }]
export function noteGroups(rawDoc, validation) {
  if (!rawDoc || !Array.isArray(rawDoc.items)) return [];
  // a damaged file can hold null / non-object items: work on the usable ones only
  const items = rawDoc.items.filter((i) => i && typeof i === 'object');
  const doc = { ...rawDoc, items };
  const byCodeIds = new Map(); // code -> [ids]
  const other = new Map(); // message -> [ids]
  for (const v of validation || []) {
    if (!v || !v.itemId) continue;
    if (BY_CODE[v.code]) {
      if (!byCodeIds.has(v.code)) byCodeIds.set(v.code, []);
      byCodeIds.get(v.code).push(v.itemId);
    } else if (v.code !== 'overlapping-rooms') {
      if (!other.has(v.message)) other.set(v.message, []);
      other.get(v.message).push(v.itemId);
    }
  }
  const groups = [];
  const add = (key, kind, title, stops) => { if (stops.length) groups.push({ key, kind, title, count: stops.length, stops }); };
  const single = (ids) => readingOrder(doc, ids).map((id) => ({ ids: [id] }));

  // one title per KIND (codes of one kind merge: "numbers in the wrong format" covers bad + duplicate)
  const kinds = new Map();
  for (const [code, ids] of byCodeIds) {
    const [kind, one, many] = BY_CODE[code];
    if (!kinds.has(kind)) kinds.set(kind, { ids: [], one, many });
    kinds.get(kind).ids.push(...ids);
  }
  for (const [kind, k] of kinds) {
    const stops = single(k.ids);
    add(`k:${kind}`, kind, `${stops.length} ${plural(stops.length, k.one, k.many)}`, stops);
  }
  // overlapping rooms: one stop per cluster
  const clusters = overlapClusters(doc);
  add('k:overlap', 'overlap', `${clusters.length} ${plural(clusters.length, 'group of rooms overlaps', 'groups of rooms overlap')}`,
    clusters.map((c) => ({ ids: readingOrder(doc, c.items.map((i) => i.id)), cluster: c })));
  // hallways and rooms the hallway notes name
  const hallOverlap = overlappingHalls(items);
  add('k:hall-overlap', 'hall-overlap', `${hallOverlap.length} ${plural(hallOverlap.length, 'hallway overlaps another', 'hallways overlap each other')}`, single(hallOverlap.map((h) => h.id)));
  const cut = unconnectedHalls(doc);
  add('k:hall', 'hall', `${cut.length} ${plural(cut.length, "hallway isn't connected", "hallways aren't connected")}`, single(cut.map((h) => h.id)));
  const far = roomsNotTouchingHall(items);
  add('k:room-hall', 'room-hall', `${far.length} ${plural(far.length, "room doesn't reach a hallway", "rooms don't reach a hallway")}`, single(far.map((r) => r.id)));
  for (const [msg, ids] of other) add(`m:${msg}`, 'other', `${ids.length > 1 ? ids.length + ' x ' : ''}${msg}`, single(ids));
  groups.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return groups;
}

// A short, human line for one stop of a group: "Room near 218", "216 & 214 overlap", "Hallway near 206".
// Returns { title, sub } (sub may be ''). Pure; never throws.
export function stopLabel(rawDoc, stop, kind) {
  try {
    const items = ((rawDoc && rawDoc.items) || []).filter((i) => i && typeof i === 'object');
    const by = new Map(items.map((i) => [i.id, i]));
    const here = (stop.ids || []).map((id) => by.get(id)).filter(Boolean);
    if (!here.length) return { title: 'Item no longer on the plan', sub: '' };
    const centre = (it) => { const b = bboxOf(it); return [b.x + b.w / 2, b.y + b.h / 2]; };
    const numbered = items.filter((i) => i.type === 'room' && i.number && !stop.ids.includes(i.id));
    const near = (it) => {
      const [cx, cy] = centre(it);
      let best = null, bd = Infinity;
      for (const r of numbered) { const [x, y] = centre(r); const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = r; } }
      return best ? best.number : '';
    };
    const name = (it) => (it.number ? it.number + (it.name ? ` ${it.name}` : '') : it.name || '');
    const first = here[0];
    if (kind === 'overlap') {
      const names = here.map((i) => name(i) || (i.type === 'hall' ? 'Hallway' : i.type === 'stair' ? 'Stairs' : 'a room'));
      return { title: names.slice(0, 3).join(' & ') + (names.length > 3 ? ` +${names.length - 3}` : ''), sub: 'overlap' };
    }
    if (first.type === 'room') {
      const nm = name(first), n = near(first);
      if (kind === 'number') return { title: n ? `Room near ${n}` : 'Room', sub: 'needs a number' };
      return { title: nm || (n ? `Room near ${n}` : 'Room'), sub: n && !nm ? `near ${n}` : '' };
    }
    if (first.type === 'hall') { const n = near(first); return { title: n ? `Hallway near ${n}` : 'Hallway', sub: '' }; }
    if (first.type === 'door') { const n = near(first); return { title: n ? `Door near ${n}` : 'Door', sub: '' }; }
    return { title: first.type.charAt(0).toUpperCase() + first.type.slice(1), sub: '' };
  } catch (e) { return { title: 'Item', sub: '' }; }
}
