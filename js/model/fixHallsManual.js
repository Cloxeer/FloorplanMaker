// fixHallsManual.js
// Turns the rooms that could not be linked into a hallway into a few precise Manual notes: rooms that
// sit in one row (or one column) with the nearest hallway on the same side are named together, with
// the side of the plan they are on ("3 rooms along the top have no free strip to a hallway; draw one").
// Pure. Depends on: nothing.

const BAND = 30; // rooms whose facing edge is within this of each other count as one row / column
const name = (r) => [r.name, r.number].filter(Boolean).join(' ') || (Number.isFinite(r.x) ? `the room at ${Math.round(r.x)}, ${Math.round(r.y)}` : 'a room');

// list: [{ room, far: bool, hall: rect|null }]; plan: bounding box of every rect item
export function groupManual(list, plan) {
  const groups = new Map();
  for (const e of list) {
    const r = e.room, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let dir = 'none';
    if (e.hall) {
      const dx = e.hall.x + e.hall.w / 2 - cx, dy = e.hall.y + e.hall.h / 2 - cy;
      dir = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'above' : 'below') : (dx < 0 ? 'left' : 'right');
    }
    const row = dir === 'above' || dir === 'below' ? Math.round((dir === 'above' ? r.y : r.y + r.h) / BAND) : dir === 'none' ? 0 : Math.round((dir === 'left' ? r.x : r.x + r.w) / BAND);
    const key = `${e.far ? 'far' : 'blocked'}|${dir}|${row}`;
    if (!groups.has(key)) groups.set(key, { far: e.far, dir, rooms: [] });
    groups.get(key).rooms.push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    const ids = g.rooms.map((r) => r.id);
    if (g.rooms.length === 1) {
      const r = g.rooms[0];
      out.push({ ids, message: g.far ? `${name(r)} is too far from any hallway; draw one.` : `${name(r)} can't be linked to a hallway cleanly (something is in the way${g.dir !== 'none' ? `; the nearest hallway is ${g.dir === 'above' ? 'above' : g.dir === 'below' ? 'below' : 'to the ' + g.dir}` : ''}); draw a short hallway to it by hand.` });
      continue;
    }
    const x0 = Math.min(...g.rooms.map((r) => r.x)), y0 = Math.min(...g.rooms.map((r) => r.y));
    const x1 = Math.max(...g.rooms.map((r) => r.x + r.w)), y1 = Math.max(...g.rooms.map((r) => r.y + r.h));
    const wide = x1 - x0 >= y1 - y0, W = Math.max(1, plan.w), H = Math.max(1, plan.h);
    const fx = ((x0 + x1) / 2 - plan.x) / W, fy = ((y0 + y1) / 2 - plan.y) / H;
    const where = wide ? (fy < 0.25 ? 'along the top wall' : fy > 0.75 ? 'along the bottom wall' : 'in one row') : (fx < 0.25 ? 'along the left wall' : fx > 0.75 ? 'along the right wall' : 'in one column');
    const why = g.far ? 'are too far from any hallway' : 'have no free strip to a hallway';
    out.push({ ids, message: `${g.rooms.length} rooms ${where} ${why}${g.far ? '' : ' (other rooms are in the way)'}; draw a hallway along them.` });
  }
  return out;
}
