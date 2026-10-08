// photos.js
// Several photos for one floor. The first photo is the floor's photo (project.photo); any others live in
// project.extraPhotos. Each photo carries a placement t = { x, y, s, a }: where its top-left corner sits on
// the plan, a size multiplier and a rotation in degrees (about that corner). These helpers are pure: place the
// extras apart from each other, hit-test a click against the photos, move / resize / turn one about its
// centre, and slide a whole drawing.
// Depends on: nothing.

const ok = (v) => Number.isFinite(v);
export const T0 = { x: 0, y: 0, s: 1, a: 0 };
export const tOf = (p) => ({ ...T0, ...((p && p.t) || {}) });
const rad = (d) => (d * Math.PI) / 180;

// the photo's four corners on the plan, clockwise from its top-left
export function photoCorners(p) {
  const t = tOf(p), w = (p.width || 0) * t.s, h = (p.height || 0) * t.s;
  const ux = Math.cos(rad(t.a)), uy = Math.sin(rad(t.a));
  const vx = -uy, vy = ux;
  return [[t.x, t.y], [t.x + ux * w, t.y + uy * w], [t.x + ux * w + vx * h, t.y + uy * w + vy * h], [t.x + vx * h, t.y + vy * h]];
}

export function photoCentre(p) {
  const c = photoCorners(p);
  return [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
}

// the top-most photo under plan point `pt` (later photos draw on top), or -1
export function hitPhoto(photos, pt) {
  for (let i = photos.length - 1; i >= 0; i--) {
    const p = photos[i], t = tOf(p);
    const dx = pt[0] - t.x, dy = pt[1] - t.y;
    const ux = Math.cos(rad(t.a)), uy = Math.sin(rad(t.a));
    const lx = dx * ux + dy * uy, ly = -dx * uy + dy * ux; // into the photo's own axes
    if (lx >= 0 && ly >= 0 && lx <= (p.width || 0) * t.s && ly <= (p.height || 0) * t.s) return i;
  }
  return -1;
}

// the box round a (possibly turned) photo
export function photoBox(p) {
  const c = photoCorners(p);
  const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// Magnet for a photo being dragged, the way rooms snap: its left / middle / right line meets another photo's
// left / middle / right line (so photos touch edge to edge, or line up top and bottom) when within `tol`,
// separately for x and y. -> { dx, dy, guides:[{axis,at}] }: how much more to move, and the lines that caught.
export function snapPhoto(p, others, tol) {
  const b = photoBox(p);
  const mine = { x: [b.x0, (b.x0 + b.x1) / 2, b.x1], y: [b.y0, (b.y0 + b.y1) / 2, b.y1] };
  let bx = null, by = null;
  for (const o of others || []) {
    const t = photoBox(o);
    const theirs = { x: [t.x0, (t.x0 + t.x1) / 2, t.x1], y: [t.y0, (t.y0 + t.y1) / 2, t.y1] };
    for (const m of mine.x) for (const q of theirs.x) { const d = q - m; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: q }; }
    for (const m of mine.y) for (const q of theirs.y) { const d = q - m; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: q }; }
  }
  const guides = [];
  if (bx) guides.push({ axis: 'x', at: bx.at });
  if (by) guides.push({ axis: 'y', at: by.at });
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, guides };
}

export function unionBox(photos) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of photos) for (const [x, y] of photoCorners(p)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return ok(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Gives each extra photo a spot to the right of the one before it, with a gap, and a size that matches the
// first photo's height (within 0.5x..2x), so they arrive apart and about the same size.
// -> new array of extras with .t set (the inputs are not changed)
export function layoutExtras(primary, extras, gapOverride) {
  const base = primary && primary.height ? primary.height * tOf(primary).s : 1000;
  const gap = gapOverride != null ? gapOverride : Math.max(80, ((primary && primary.width) || 1000) * 0.06);
  let right = primary ? photoCorners(primary)[1][0] : 0;
  return (extras || []).map((e) => {
    const s = e.height ? Math.max(0.5, Math.min(2, base / e.height)) : 1;
    const x = right + gap;
    right = x + (e.width || 0) * s;
    return { ...e, t: { x, y: tOf(primary).y, s, a: 0 } };
  });
}

// ---- placing one photo (returns a new photo; the input is not changed)
export function moved(p, dx, dy) { const t = tOf(p); return { ...p, t: { ...t, x: t.x + dx, y: t.y + dy } }; }
function about(p, next) { // keep the centre where it is while s / a change
  const [cx, cy] = photoCentre(p);
  const q = { ...p, t: { ...tOf(p), ...next } };
  const [nx, ny] = photoCentre(q);
  return moved(q, cx - nx, cy - ny);
}
export function scaledBy(p, f) { const t = tOf(p); return about(p, { s: Math.max(0.05, Math.min(10, t.s * f)) }); }
// grow or shrink about a fixed point (a corner being dragged leaves the opposite corner where it is); the size stays within 0.05x..10x
export function scaledAbout(p, f, [ax, ay]) {
  const t = tOf(p), s = Math.max(0.05, Math.min(10, t.s * f)), k = s / t.s;
  return { ...p, t: { ...t, s, x: ax + (t.x - ax) * k, y: ay + (t.y - ay) * k } };
}
export function turnedBy(p, deg) { const t = tOf(p); return about(p, { a: ((t.a + deg) % 360 + 360) % 360 }); }

// ---- the drawing: slide everything by (dx, dy)
const mv = (n, d) => (ok(n) ? n + d : n);
export function translateDoc(doc, dx, dy) {
  if (!doc || (!dx && !dy)) return doc;
  const items = (doc.items || []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const n = { ...it };
    if (ok(n.x) && ok(n.y)) { n.x += dx; n.y += dy; }
    for (const [a, b] of [['x1', 'y1'], ['x2', 'y2']]) if (ok(n[a]) && ok(n[b])) { n[a] += dx; n[b] += dy; }
    if (Array.isArray(n.points)) n.points = n.points.map((p) => [mv(p[0], dx), mv(p[1], dy)]);
    if (n.label && typeof n.label === 'object' && ok(n.label.x) && ok(n.label.y)) n.label = { ...n.label, x: n.label.x + dx, y: n.label.y + dy };
    return n;
  });
  const floor = doc.floor && Array.isArray(doc.floor.points) ? { ...doc.floor, points: doc.floor.points.map((p) => [mv(p[0], dx), mv(p[1], dy)]) } : doc.floor;
  return { ...doc, floor, items };
}

// ---- the drawing: grow or shrink everything by one factor about a point (always 1:1, never stretched).
// Positions land on the 5-unit grid; two edges that shared a coordinate still share it afterwards.
// Compass and legend keep their size and only move. -> a new doc (the input is not changed)
export function scaleDoc(doc, f, ox, oy, grid = 5) {
  if (!doc || !(f > 0) || f === 1) return doc;
  const g = (v) => Math.round(v / grid) * grid;
  const mx = (x) => g(ox + (x - ox) * f), my = (y) => g(oy + (y - oy) * f);
  const pt = (p) => [mx(p[0]), my(p[1])];
  const items = (doc.items || []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const n = { ...it };
    if (ok(n.x) && ok(n.y)) {
      if (n.type === 'compass' || n.type === 'legend' || !ok(n.w) || !ok(n.h)) { n.x = mx(n.x); n.y = my(n.y); }
      else { const x1 = mx(n.x + n.w), y1 = my(n.y + n.h); n.x = mx(n.x); n.y = my(n.y); n.w = Math.max(grid, x1 - n.x); n.h = Math.max(grid, y1 - n.y); }
    }
    for (const [a, b] of [['x1', 'y1'], ['x2', 'y2']]) if (ok(n[a]) && ok(n[b])) { n[a] = mx(it[a]); n[b] = my(it[b]); }
    if (Array.isArray(n.points)) n.points = n.points.map((p) => (ok(p[0]) && ok(p[1]) ? pt(p) : p));
    if (n.label && typeof n.label === 'object' && ok(n.label.x) && ok(n.label.y)) n.label = { ...n.label, x: Math.round(ox + (n.label.x - ox) * f), y: Math.round(oy + (n.label.y - oy) * f) };
    return n;
  });
  const floor = doc.floor && Array.isArray(doc.floor.points) ? { ...doc.floor, points: doc.floor.points.map((p) => (ok(p[0]) && ok(p[1]) ? pt(p) : p)) } : doc.floor;
  return { ...doc, floor, items };
}

// ---- one photo is the plan's frame: express the others in the first photo's own pixels, so the first photo
// ends up with no placement at all (identity) and the others keep their exact look. A placement maps a photo's
// pixel p to  t.xy + t.s * R(t.a) * p  on the plan. -> new array (the inputs are not changed)
export function normalizeToMain(photos) {
  if (!photos || !photos.length) return [];
  const m = tOf(photos[0]);
  const c = Math.cos(rad(-m.a)), s = Math.sin(rad(-m.a));
  const into = (x, y) => { const dx = x - m.x, dy = y - m.y; return [(dx * c - dy * s) / m.s, (dx * s + dy * c) / m.s]; };
  return photos.map((p, i) => {
    if (i === 0) { const { t, ...rest } = p; void t; return rest; }
    const t = tOf(p), [x, y] = into(t.x, t.y);
    return { ...p, t: { x, y, s: t.s / m.s, a: (((t.a - m.a) % 360) + 360) % 360 } };
  });
}
