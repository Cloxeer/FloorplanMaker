// fixHallsGeo.js
// Helpers for fixHalls.js: is a rect inside the building outline (a few units of slack, hallway cells
// count as inside) and a coarse spatial hash of {rect} objects. Pure. Depends on: nothing.

const isRect = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite);

// ---- outline test (rect inside the building outline, a few units of slack) ----
function pointInPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function nearEdge(pts, x, y, d) {
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
    if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= d) return true;
  }
  return false;
}
export function insideOutline(env, r) {
  const pts = env.outline;
  if (!pts) return true;
  const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
  for (const x of xs) for (const y of ys) {
    if (pointInPoly(pts, x, y) || nearEdge(pts, x, y, 2)) continue;
    if (env.halls.some((h) => x >= h.rect.x - 1 && x <= h.rect.x + h.rect.w + 1 && y >= h.rect.y - 1 && y <= h.rect.y + h.rect.h + 1)) continue;
    return false;
  }
  return !pts.some(([px, py]) => px > r.x + 2 && px < r.x + r.w - 2 && py > r.y + 2 && py < r.y + r.h - 2);
}

// coarse spatial hash of {rect} objects: near(r) = the objects whose cells r touches. Absurdly large
// rects (garbage plans) are kept in a side list instead of millions of cells.
export function bucketGrid(cell = 50) {
  const g = new Map(), big = [], all = [];
  const huge = (r) => (r.w / cell + 1) * (r.h / cell + 1) > 4000 || !isRect(r);
  const cells = (r, f) => { for (let i = Math.floor(r.x / cell); i <= Math.floor((r.x + r.w) / cell); i++) for (let j = Math.floor(r.y / cell); j <= Math.floor((r.y + r.h) / cell); j++) f(i + ',' + j); };
  return {
    put: (o) => { all.push(o); if (huge(o.rect)) big.push(o); else cells(o.rect, (k) => { if (!g.has(k)) g.set(k, []); g.get(k).push(o); }); },
    near: (r) => {
      if (huge(r)) return new Set(all);
      const out = new Set(big); cells(r, (k) => { for (const o of g.get(k) || []) out.add(o); }); return out;
    },
  };
}

