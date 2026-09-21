// rectify.js
// Pure helpers to straighten a floor outline: every edge becomes exactly
// horizontal or vertical, coordinates snap to the 5-unit grid, and
// redundant points are dropped. Depends on: nothing (pure math).

const GRID = 5;
const snap = (v) => Math.round(v / GRID) * GRID;

export function rectifyOutline(points) {
  if (!points || points.length < 3) return points ? points.map((p) => p.slice()) : points;
  const pts = points.map(([x, y]) => [x, y]);
  const n = pts.length;
  for (let i = 0; i < n - 1; i += 1) {
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const dx = nx - cx;
    const dy = ny - cy;
    if (Math.abs(dx) >= Math.abs(dy)) pts[i + 1][1] = cy;
    else pts[i + 1][0] = cx;
  }
  // Closing edge: adjust the first point so the last edge is axis-aligned.
  const last = pts[n - 1];
  const first = pts[0];
  const dx = first[0] - last[0];
  const dy = first[1] - last[1];
  if (Math.abs(dx) >= Math.abs(dy)) first[1] = last[1];
  else first[0] = last[0];

  const snapped = pts.map(([x, y]) => [snap(x), snap(y)]);

  const out = [];
  for (const p of snapped) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  for (let i = out.length - 1; i >= 0 && out.length > 3; i -= 1) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
  }
  return out;
}

// Re-straighten only the two edges touching `idx` (the vertex just dragged)
// by nudging its neighbours, leaving the dragged point itself untouched.
export function rectifyVertexEdges(points, idx) {
  if (!points || points.length < 3) return points;
  const pts = points.map(([x, y]) => [x, y]);
  const n = pts.length;
  const cur = pts[idx];
  const prevI = (idx - 1 + n) % n;
  const nextI = (idx + 1) % n;
  const prev = pts[prevI];
  const next = pts[nextI];

  const dxp = cur[0] - prev[0];
  const dyp = cur[1] - prev[1];
  if (Math.abs(dxp) >= Math.abs(dyp)) prev[1] = cur[1];
  else prev[0] = cur[0];

  const dxn = next[0] - cur[0];
  const dyn = next[1] - cur[1];
  if (Math.abs(dxn) >= Math.abs(dyn)) next[1] = cur[1];
  else next[0] = cur[0];

  pts[prevI] = [snap(prev[0]), snap(prev[1])];
  pts[nextI] = [snap(next[0]), snap(next[1])];
  pts[idx] = [snap(cur[0]), snap(cur[1])];
  return pts;
}
