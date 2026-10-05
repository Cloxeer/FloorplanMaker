// turn.js
// Turning a group of plan pieces as ONE rigid body, in quarter turns (90 degrees clockwise each), about a
// shared pivot. Rooms, halls and stairs are straight-sided boxes, so a quarter turn keeps them boxes (width
// and height swap, stairs flip direction); poly rooms, the outline, doors and staff walls turn point by
// point; the compass keeps pointing at real north (its angle turns with the plan); the legend is a page
// annotation and stays put. Pure and immutable: returns a new doc. Depends on: nothing.

const ok = (v) => Number.isFinite(v);
const norm = (q) => ((Math.round(q) % 4) + 4) % 4;

// one quarter turn clockwise (screen coordinates, y down) about (cx, cy), repeated q times
function spin(x, y, q, cx, cy) {
  const dx = x - cx, dy = y - cy;
  switch (q) {
    case 1: return [cx - dy, cy + dx];
    case 2: return [cx - dx, cy - dy];
    case 3: return [cx + dy, cy - dx];
    default: return [x, y];
  }
}
const spinPt = (p, q, cx, cy) => { const [x, y] = spin(p[0], p[1], q, cx, cy); return [Math.round(x), Math.round(y)]; };

function turnBox(it, q, cx, cy) {
  const [mx, my] = spin(it.x + it.w / 2, it.y + it.h / 2, q, cx, cy);
  const w = q % 2 ? it.h : it.w, h = q % 2 ? it.w : it.h;
  return { x: Math.round(mx - w / 2), y: Math.round(my - h / 2), w, h };
}

function turnLabel(label, q, cx, cy) {
  if (!label || !ok(label.x) || !ok(label.y)) return label;
  const [x, y] = spinPt([label.x, label.y], q, cx, cy);
  return { ...label, x, y };
}

export function turnItem(it, q, cx, cy) {
  switch (it.type) {
    case 'room':
      if (it.shape === 'poly') return { ...it, points: it.points.map((p) => spinPt(p, q, cx, cy)), label: turnLabel(it.label, q, cx, cy) };
      return { ...it, ...turnBox(it, q, cx, cy), label: turnLabel(it.label, q, cx, cy) };
    case 'hall':
      return { ...it, ...turnBox(it, q, cx, cy) };
    case 'stair':
      return { ...it, ...turnBox(it, q, cx, cy), dir: q % 2 ? (it.dir === 'h' ? 'v' : 'h') : it.dir };
    case 'door': {
      const [x1, y1] = spinPt([it.x1, it.y1], q, cx, cy);
      const [x2, y2] = spinPt([it.x2, it.y2], q, cx, cy);
      return { ...it, x1, y1, x2, y2, label: turnLabel(it.label, q, cx, cy) };
    }
    case 'authwall': {
      const [x1, y1] = spinPt([it.x1, it.y1], q, cx, cy);
      const [x2, y2] = spinPt([it.x2, it.y2], q, cx, cy);
      return { ...it, x1, y1, x2, y2 };
    }
    case 'compass': {
      const [x, y] = spinPt([it.x, it.y], q, cx, cy);
      return { ...it, x, y, deg: (((it.deg || 0) + 90 * q) % 360 + 360) % 360 };
    }
    default:
      return it; // the legend (and anything unknown) stays where it is
  }
}

// Turn the items in `ids` (and the outline when `floor` is true) by `quarters` clockwise quarter turns about
// (cx, cy). -> a new doc; the input is untouched.
export function turnDoc(doc, ids, quarters, cx, cy, floor = false) {
  const q = norm(quarters);
  if (!doc || !q) return doc;
  const want = new Set(ids);
  const items = doc.items.map((it) => (want.has(it.id) ? turnItem(it, q, cx, cy) : it));
  const pts = doc.floor && Array.isArray(doc.floor.points) ? doc.floor.points : null;
  const out = { ...doc, items };
  if (floor && pts) out.floor = { ...doc.floor, points: pts.map((p) => spinPt(p, q, cx, cy)) };
  return out;
}

// The box round the given pieces (+ outline), for choosing a pivot. -> { x0, y0, x1, y1 } | null
export function selectionBox(doc, ids, floor = false) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (ok(x) && ok(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  const want = new Set(ids);
  for (const it of doc.items) {
    if (!want.has(it.id) || it.type === 'legend') continue;
    if (ok(it.w) && ok(it.h)) { add(it.x, it.y); add(it.x + it.w, it.y + it.h); }
    else if (it.type === 'door' || it.type === 'authwall') { add(it.x1, it.y1); add(it.x2, it.y2); }
    else if (it.type === 'compass') add(it.x, it.y);
    if (Array.isArray(it.points)) it.points.forEach((p) => add(p[0], p[1]));
  }
  if (floor && doc.floor && Array.isArray(doc.floor.points)) doc.floor.points.forEach((p) => add(p[0], p[1]));
  return ok(x0) ? { x0, y0, x1, y1 } : null;
}

// A pivot on the grid (so pieces that sat on the grid still do) at the middle of the selection.
export function pivotFor(box, grid = 5) {
  const g = (v) => (grid > 1 ? Math.round(v / grid) * grid : Math.round(v));
  return { cx: g((box.x0 + box.x1) / 2), cy: g((box.y0 + box.y1) / 2) };
}

// Convenience for the buttons: turn the whole selection about its own middle. -> new doc
export function turnSelection(doc, ids, quarters, grid = 5) {
  const floor = ids.includes('floor');
  const real = ids.filter((id) => id !== 'floor');
  const box = selectionBox(doc, real, floor);
  if (!box) return doc;
  const { cx, cy } = pivotFor(box, grid);
  return turnDoc(doc, real, quarters, cx, cy, floor);
}
