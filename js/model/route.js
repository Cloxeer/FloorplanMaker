// route.js
// Pure grid + Dijkstra pathfinding from building entrances (doors on floor 1,
// or stair rects on upper floors) to a target room, for the "route to room"
// feature and the validation panel's room-unreachable warning.
// Depends on: geometry.js (pointInPolygon), document.js (roomPolygon).
// No DOM/window. Used directly and from js/workers/route.worker.js.

import { pointInPolygon } from './geometry.js';
import { roomPolygon } from './document.js';

// ---- Binary min-heap of {d, idx} ----
class MinHeap {
  constructor() {
    this.d = [];
    this.idx = [];
    this.n = 0;
  }
  push(dist, idx) {
    let i = this.n++;
    this.d[i] = dist;
    this.idx[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      this._swap(p, i);
      i = p;
    }
  }
  pop() {
    if (this.n === 0) return null;
    const outD = this.d[0];
    const outI = this.idx[0];
    this.n--;
    if (this.n > 0) {
      this.d[0] = this.d[this.n];
      this.idx[0] = this.idx[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < this.n && this.d[l] < this.d[s]) s = l;
        if (r < this.n && this.d[r] < this.d[s]) s = r;
        if (s === i) break;
        this._swap(s, i);
        i = s;
      }
    }
    return { dist: outD, idx: outI };
  }
  _swap(a, b) {
    const td = this.d[a]; this.d[a] = this.d[b]; this.d[b] = td;
    const ti = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = ti;
  }
  get size() { return this.n; }
}

function bboxOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function stairPolygon(item) {
  return [
    [item.x, item.y],
    [item.x + item.w, item.y],
    [item.x + item.w, item.y + item.h],
    [item.x, item.y + item.h],
  ];
}

/**
 * Rasterize the floor polygon (and blockers: rooms, voids, stairs) into a
 * walkability grid.
 * @returns {{cols,rows,cell,ox,oy,walkable:Uint8Array,cost:Float64Array}}
 */
export function buildGrid(doc, cell = 10) {
  const vb = doc.viewBox || { x: 0, y: 0, w: 0, h: 0 };
  const cols = Math.max(1, Math.ceil(vb.w / cell));
  const rows = Math.max(1, Math.ceil(vb.h / cell));
  const ox = vb.x, oy = vb.y;
  const n = cols * rows;
  const walkableBase = new Uint8Array(n); // 1 = inside floor & not blocked (pre-inflation)
  const floorPts = doc.floor && doc.floor.points && doc.floor.points.length >= 3 ? doc.floor.points : null;

  // Collect blocker polygons (rooms/voids + stairs). Any room item counts
  // (including 'void' class) as a blocker per spec ("not inside any
  // room/void polygon"); stairs use their rect.
  const blockerPolys = [];
  for (const item of doc.items || []) {
    if (item.type === 'room') {
      blockerPolys.push(roomPolygon(item));
    } else if (item.type === 'stair') {
      blockerPolys.push(stairPolygon(item));
    }
  }
  // Precompute bboxes for quick reject
  const blockerBoxes = blockerPolys.map(bboxOfPoints);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = ox + (c + 0.5) * cell;
      const cy = oy + (r + 0.5) * cell;
      let walk = 0;
      if (!floorPts || pointInPolygon([cx, cy], floorPts)) {
        if (!floorPts) walk = 1;
        else {
          walk = 1;
          for (let i = 0; i < blockerPolys.length; i++) {
            const b = blockerBoxes[i];
            if (cx < b.minX || cx > b.maxX || cy < b.minY || cy > b.maxY) continue;
            if (pointInPolygon([cx, cy], blockerPolys[i])) { walk = 0; break; }
          }
        }
      }
      walkableBase[r * cols + c] = walk;
    }
  }

  // Inflate blocked cells (walk=0, including outside-floor cells) by 1 cell
  // ring so paths don't hug walls.
  const walkable = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!walkableBase[i]) { walkable[i] = 0; continue; }
      let ok = 1;
      for (let dr = -1; dr <= 1 && ok; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue; // out of grid: not a blocker
          if (!walkableBase[rr * cols + cc]) { ok = 0; break; }
        }
      }
      walkable[i] = ok;
    }
  }

  return { cols, rows, cell, ox, oy, walkable };
}

function cellCenter(grid, idx) {
  const c = idx % grid.cols;
  const r = (idx / grid.cols) | 0;
  return [grid.ox + (c + 0.5) * grid.cell, grid.oy + (r + 0.5) * grid.cell];
}

function toCellIndex(grid, x, y) {
  const c = Math.floor((x - grid.ox) / grid.cell);
  const r = Math.floor((y - grid.oy) / grid.cell);
  if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) return -1;
  return r * grid.cols + c;
}

const NEI = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

/**
 * Multi-source Dijkstra over the grid from `starts` (array of cell indices)
 * to `goals` (Set/array of cell indices). Returns {dist:Float64Array, prev:Int32Array}.
 */
function dijkstra(grid, startIdxs) {
  const { cols, rows, walkable } = grid;
  const n = cols * rows;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  const heap = new MinHeap();

  for (const s of startIdxs) {
    if (s < 0 || s >= n || !walkable[s]) continue;
    if (dist[s] > 0) { dist[s] = 0; heap.push(0, s); }
  }

  while (heap.size) {
    const { dist: d, idx } = heap.pop();
    if (visited[idx]) continue;
    if (d > dist[idx]) continue;
    visited[idx] = 1;
    const c = idx % cols;
    const r = (idx / cols) | 0;
    for (const [dc, dr, w] of NEI) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || cc >= cols || rr < 0 || rr >= rows) continue;
      const ni = rr * cols + cc;
      if (!walkable[ni]) continue;
      if (dc !== 0 && dr !== 0) {
        // no corner cutting: both orthogonal neighbours must be walkable
        const h1 = r * cols + cc;
        const h2 = rr * cols + c;
        if (!walkable[h1] || !walkable[h2]) continue;
      }
      const nd = d + w;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = idx;
        heap.push(nd, ni);
      }
    }
  }

  return { dist, prev };
}

function reconstructPath(grid, prev, endIdx) {
  const pts = [];
  let cur = endIdx;
  while (cur !== -1) {
    pts.push(cellCenter(grid, cur));
    cur = prev[cur];
  }
  pts.reverse();
  return dropCollinear(pts);
}

function dropCollinear(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(cross) > 1e-9) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function getStartIndices(doc, grid) {
  const idxs = [];
  const floor = doc.meta && doc.meta.floor != null ? doc.meta.floor : 1;
  if (floor <= 1) {
    for (const item of doc.items || []) {
      if (item.type === 'door') {
        const mx = (item.x1 + item.x2) / 2;
        const my = (item.y1 + item.y2) / 2;
        const idx = nearestWalkable(grid, mx, my);
        if (idx !== -1) idxs.push(idx);
      }
    }
  } else {
    for (const item of doc.items || []) {
      if (item.type === 'stair') {
        const cx = item.x + item.w / 2;
        const cy = item.y + item.h / 2;
        const idx = nearestWalkable(grid, cx, cy);
        if (idx !== -1) idxs.push(idx);
      }
    }
  }
  return idxs;
}

// Find the nearest walkable cell to (x,y), searching outward in rings
// (handles doors sitting exactly on/outside the outline).
function nearestWalkable(grid, x, y) {
  const base = toCellIndex(grid, x, y);
  const bc = base === -1 ? Math.floor((x - grid.ox) / grid.cell) : base % grid.cols;
  const br = base === -1 ? Math.floor((y - grid.oy) / grid.cell) : (base / grid.cols) | 0;
  for (let ring = 0; ring <= 5; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = bc + dc, r = br + dr;
        if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) continue;
        const idx = r * grid.cols + c;
        if (grid.walkable[idx]) return idx;
      }
    }
  }
  return -1;
}

function getGoalIndices(grid, poly) {
  const goals = [];
  const b = bboxOfPoints(poly);
  const pad = 1.5 * grid.cell;
  const c0 = Math.max(0, Math.floor((b.minX - pad - grid.ox) / grid.cell));
  const c1 = Math.min(grid.cols - 1, Math.ceil((b.maxX + pad - grid.ox) / grid.cell));
  const r0 = Math.max(0, Math.floor((b.minY - pad - grid.oy) / grid.cell));
  const r1 = Math.min(grid.rows - 1, Math.ceil((b.maxY + pad - grid.oy) / grid.cell));
  const threshold = 1.5 * grid.cell;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = r * grid.cols + c;
      if (!grid.walkable[idx]) continue;
      const [cx, cy] = cellCenter(grid, idx);
      if (distToPolyEdges(cx, cy, poly) <= threshold) goals.push(idx);
    }
  }
  return goals;
}

function distToPolyEdges(px, py, poly) {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t, ey = ay + dy * t;
    const d = Math.hypot(px - ex, py - ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Find a shortest path from any of `starts` (cell indices) to the nearest of
 * `goals` (cell indices).
 */
export function findPath(grid, starts, goals) {
  if (!starts.length || !goals.length) return { reachable: false, path: [] };
  const { dist, prev } = dijkstra(grid, starts);
  let bestIdx = -1, bestDist = Infinity;
  for (const g of goals) {
    if (dist[g] < bestDist) { bestDist = dist[g]; bestIdx = g; }
  }
  if (bestIdx === -1 || !isFinite(bestDist)) return { reachable: false, path: [] };
  return { reachable: true, path: reconstructPath(grid, prev, bestIdx) };
}

export function routeToRoom(doc, roomId, cell = 10) {
  const room = (doc.items || []).find((it) => it.id === roomId);
  if (!room) return { reachable: false, path: [], reason: 'no-room' };
  const grid = buildGrid(doc, cell);
  const starts = getStartIndices(doc, grid);
  if (!starts.length) return { reachable: false, path: [], reason: 'no-entrance' };
  const goals = getGoalIndices(grid, roomPolygon(room));
  return findPath(grid, starts, goals);
}

/**
 * Compute reachability for every non-void room in one multi-source Dijkstra.
 * @returns {{[roomId:string]: boolean}}
 */
export function routeAll(doc, cell = 10) {
  const result = {};
  const rooms = (doc.items || []).filter((it) => it.type === 'room' && it.cls !== 'void');
  const grid = buildGrid(doc, cell);
  const starts = getStartIndices(doc, grid);
  if (!starts.length) {
    for (const room of rooms) result[room.id] = false;
    return result;
  }
  const { dist } = dijkstra(grid, starts);
  const threshold = 1.5 * grid.cell;
  for (const room of rooms) {
    const poly = roomPolygon(room);
    const goals = getGoalIndices(grid, poly);
    let reachable = false;
    for (const g of goals) {
      if (isFinite(dist[g])) { reachable = true; break; }
    }
    result[room.id] = reachable;
  }
  return result;
}
