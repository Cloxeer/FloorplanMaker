// attention.js
// Which plan items the checklist is asking about ("Worth a look" / "Fix these"), so the stage can
// outline every one of them. Items named by a validation result (itemId) plus the ones behind the
// panel-level notes that do not carry an id: hallways that overlap or are not connected, and rooms
// that do not reach a hallway. Mirrors the rules in js/view/panels/validation.js (docChecklistCodes);
// tests/attention.test.js keeps the two in agreement.
// Pure. Depends on: nothing.

const HALL_TOUCH_PAD = 4;
const TOUCH_TOL = 1;
const CORE_TOUCH_NAMES = new Set(['Elevator', 'Restrooms', 'Utility']);

const inflatedTouch = (a, b, pad) => !(a.x + a.w + pad < b.x || b.x + b.w < a.x - pad || a.y + a.h + pad < b.y || b.y + b.h < a.y - pad);

function rectsLinked(a, b, tol) {
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return (gapX <= tol && gapY <= 0) || (gapY <= tol && gapX <= 0);
}
const pointNearBox = (px, py, b, tol) => px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;

// Rooms that do not reach any hallway (same room set as the checklist uses).
export function roomsNotTouchingHall(items) {
  const halls = items.filter((it) => it.type === 'hall');
  const rooms = items.filter((it) => {
    if (it.type !== 'room') return false;
    if (it.cls === 'room' || it.cls === 'big' || it.cls === 'ours') return true;
    return it.cls === 'core' && CORE_TOUCH_NAMES.has(it.name);
  });
  // (polygon rooms have no x/y/w/h, and the checklist treats them as touching; this matches it)
  if (!halls.length) return rooms;
  if (halls.length < 24) return rooms.filter((r) => !halls.some((h) => inflatedTouch(r, h, HALL_TOUCH_PAD)));
  // many hallways: bucket them on a coarse grid so each room only meets its neighbours
  const CELL = 200, grid = new Map();
  const cells = (b, pad, fn) => {
    for (let cx = Math.floor((b.x - pad) / CELL); cx <= Math.floor((b.x + b.w + pad) / CELL); cx++) {
      for (let cy = Math.floor((b.y - pad) / CELL); cy <= Math.floor((b.y + b.h + pad) / CELL); cy++) fn(`${cx},${cy}`);
    }
  };
  for (const h of halls) cells(h, 0, (k) => { const a = grid.get(k); if (a) a.push(h); else grid.set(k, [h]); });
  return rooms.filter((r) => {
    if (!Number.isFinite(r.x + r.y + r.w + r.h)) return false; // polygon rooms count as touching, same as the path above and the checklist
    let hit = false;
    cells(r, HALL_TOUCH_PAD, (k) => { if (!hit) { const a = grid.get(k); if (a && a.some((h) => inflatedTouch(r, h, HALL_TOUCH_PAD))) hit = true; } });
    return !hit;
  });
}

// Hallways that overlap another hallway running the same way.
export function overlappingHalls(items) {
  const halls = items.filter((it) => it.type === 'hall').sort((a, b) => a.x - b.x);
  const out = new Set();
  for (let i = 0; i < halls.length; i++) {
    const a = halls[i];
    for (let j = i + 1; j < halls.length; j++) {
      const b = halls[j];
      if (b.x >= a.x + a.w) break; // sorted by x: nothing further right can overlap a
      if ((a.w > a.h ? 'h' : 'v') !== (b.w > b.h ? 'h' : 'v')) continue;
      if (Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)) { out.add(a); out.add(b); }
    }
  }
  return [...out];
}

// Hallways that are cut off: not in the biggest connected group, or (when there is one group) a group
// that never reaches a stair, a door or the building outline.
export function unconnectedHalls(doc) {
  const items = (doc && doc.items) || [];
  const halls = items.filter((it) => it.type === 'hall');
  if (!halls.length) return [];
  const parent = halls.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) {
    if (rectsLinked(halls[i], halls[j], TOUCH_TOL)) parent[find(i)] = find(j);
  }
  const groups = new Map();
  halls.forEach((h, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(h); });
  if (groups.size > 1) {
    const biggest = [...groups.values()].sort((a, b) => b.length - a.length)[0];
    return halls.filter((h) => !biggest.includes(h));
  }
  const stairs = items.filter((it) => it.type === 'stair'), doors = items.filter((it) => it.type === 'door');
  const pts = (doc && doc.floor && doc.floor.points) || null;
  const reaches = halls.some((h) => {
    if (stairs.some((s) => rectsLinked(h, s, TOUCH_TOL))) return true;
    if (doors.some((d) => pointNearBox((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, h, TOUCH_TOL))) return true;
    if (pts && pts.length >= 2) {
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        const seg = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        if (rectsLinked(h, seg, TOUCH_TOL)) return true;
      }
    }
    return false;
  });
  return reaches ? [] : halls;
}

// -> Map(itemId -> { level: 'warning'|'error', reasons: [string] })
export function attentionTargets(doc, validation) {
  const out = new Map();
  const add = (id, level, reason) => {
    if (!id) return;
    const cur = out.get(id) || { level: 'warning', reasons: [] };
    if (level === 'error') cur.level = 'error';
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason);
    out.set(id, cur);
  };
  for (const v of validation || []) if (v.itemId) add(v.itemId, v.level === 'error' ? 'error' : 'warning', v.message);
  const items = (doc && doc.items) || [];
  for (const h of overlappingHalls(items)) add(h.id, 'warning', "Hallways overlap — a hallway can't sit on top of another");
  for (const h of unconnectedHalls(doc)) add(h.id, 'warning', "This hallway isn't connected to the others");
  for (const r of roomsNotTouchingHall(items)) add(r.id, 'warning', "This room doesn't reach a hallway");
  return out;
}
