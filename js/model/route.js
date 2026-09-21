// route.js — faithful port of tools/indoor_routes.py: a grid of
// STEP-unit squares over the floor outline, Dijkstra from every entrance at
// once (doors on floor 1, stairs above), a wall-clearance penalty so routes
// keep to the middle of hallways, and "string pulling" to straighten paths.
// Pure: no DOM. Depends on: geometry.js (pointInPolygon), document.js (roomPolygon).
// Used by js/workers/route.worker.js, tools/check.mjs and the tests.

import { pointInPolygon } from './geometry.js';
import { roomPolygon } from './document.js';

export const STEP = 6;
const WALL_CLEARANCE = 3;
const WALL_PENALTY = 2.0;

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function distanceToEdge(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dy = by - ay;
    const along = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ((dx * dx + dy * dy) || 1)));
    best = Math.min(best, Math.hypot(x - (ax + along * dx), y - (ay + along * dy)));
  }
  return best;
}

// Blocking shapes: rooms of every class (incl. void) and stair boxes (exported as core rects).
function blockersOf(doc) {
  const out = [];
  for (const it of doc.items) {
    if (it.type === 'room') out.push(roomPolygon(it));
    else if (it.type === 'stair') out.push([[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]]);
  }
  return out.map((pts) => ({ pts, box: bounds(pts) }));
}

export function buildGrid(doc) {
  if (!doc.floor || !doc.floor.points || doc.floor.points.length < 3) return null;
  const outline = doc.floor.points;
  const b = bounds(outline);
  const cols = Math.floor((b.maxX - b.minX) / STEP) + 1;
  const rows = Math.floor((b.maxY - b.minY) / STEP) + 1;
  const walkable = new Uint8Array(rows * cols);
  const blockers = blockersOf(doc);
  for (let r = 0; r < rows; r++) {
    const y = b.minY + (r + 0.5) * STEP;
    for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * STEP;
      if (!pointInPolygon([x, y], outline)) continue;
      let open = true;
      for (const { pts, box } of blockers) {
        if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && pointInPolygon([x, y], pts)) { open = false; break; }
      }
      walkable[r * cols + c] = open ? 1 : 0;
    }
  }
  // wall distance: BFS rings from every blocked square, capped at WALL_CLEARANCE
  const wallDist = new Uint8Array(rows * cols);
  let frontier = [];
  for (let i = 0; i < rows * cols; i++) {
    if (walkable[i]) wallDist[i] = WALL_CLEARANCE; else frontier.push(i);
  }
  for (let level = 1; level < WALL_CLEARANCE; level++) {
    const next = [];
    for (const i of frontier) {
      const r = (i / cols) | 0, c = i % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const j = nr * cols + nc;
        if (wallDist[j] > level) { wallDist[j] = level; next.push(j); }
      }
    }
    frontier = next;
  }
  const centre = (i) => [b.minX + ((i % cols) + 0.5) * STEP, b.minY + (((i / cols) | 0) + 0.5) * STEP];
  return { rows, cols, walkable, wallDist, left: b.minX, top: b.minY, centre };
}

function nearestWalkable(grid, x, y) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < grid.walkable.length; i++) {
    if (!grid.walkable[i]) continue;
    const [cx, cy] = grid.centre(i);
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function entrancesOf(doc) {
  const out = [];
  if ((doc.meta.floor | 0) <= 1) {
    for (const it of doc.items) if (it.type === 'door') out.push([(it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2]);
  } else {
    for (const it of doc.items) {
      if (it.type !== 'stair') continue;
      const treads = it.treads && it.treads.length ? it.treads : null;
      if (treads) {
        const xs = treads.flatMap((t) => [t.x1, t.x2]), ys = treads.flatMap((t) => [t.y1, t.y2]);
        out.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
      } else out.push([it.x + it.w / 2, it.y + it.h / 2]);
    }
  }
  return out;
}

// Binary heap keyed by cost. Returns { cost, cameFrom } over all squares.
function dijkstra(grid, starts) {
  const n = grid.rows * grid.cols;
  const cost = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const heapC = [], heapI = [];
  const push = (c, i) => {
    let k = heapC.length; heapC.push(c); heapI.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (heapC[p] <= heapC[k]) break; [heapC[p], heapC[k]] = [heapC[k], heapC[p]]; [heapI[p], heapI[k]] = [heapI[k], heapI[p]]; k = p; }
  };
  const pop = () => {
    const c = heapC[0], i = heapI[0]; const lc = heapC.pop(), li = heapI.pop();
    if (heapC.length) {
      heapC[0] = lc; heapI[0] = li; let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < heapC.length && heapC[l] < heapC[s]) s = l; if (r < heapC.length && heapC[r] < heapC[s]) s = r; if (s === k) break; [heapC[s], heapC[k]] = [heapC[k], heapC[s]]; [heapI[s], heapI[k]] = [heapI[k], heapI[s]]; k = s; }
    }
    return [c, i];
  };
  for (const s of starts) { cost[s] = 0; push(0, s); }
  while (heapC.length) {
    const [c, i] = pop();
    if (c > cost[i]) continue;
    const r = (i / grid.cols) | 0, col = i % grid.cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = col + dc;
      if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue;
      const j = nr * grid.cols + nc;
      if (!grid.walkable[j]) continue;
      const len = dr && dc ? Math.SQRT2 : 1;
      const nc2 = c + len * (grid.wallDist[j] < WALL_CLEARANCE ? WALL_PENALTY : 1);
      if (nc2 < cost[j]) { cost[j] = nc2; cameFrom[j] = i; push(nc2, j); }
    }
  }
  return { cost, cameFrom };
}

function clearLine(grid, a, b) {
  const r1 = (a / grid.cols) | 0, c1 = a % grid.cols, r2 = (b / grid.cols) | 0, c2 = b % grid.cols;
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const j = Math.round(r1 + (r2 - r1) * t) * grid.cols + Math.round(c1 + (c2 - c1) * t);
    if (!grid.walkable[j] || grid.wallDist[j] < 2) return false;
  }
  return true;
}

function straighten(grid, squares) {
  const kept = [squares[0]];
  let i = 0;
  while (i < squares.length - 1) {
    let j = squares.length - 1;
    while (j > i + 1 && !clearLine(grid, squares[i], squares[j])) j--;
    kept.push(squares[j]);
    i = j;
  }
  return kept;
}

// Shared search: returns a function roomPath(polygon) -> path | null.
function planner(doc) {
  const grid = buildGrid(doc);
  const entrances = entrancesOf(doc);
  if (!grid || !entrances.length) return { grid, reason: grid ? 'no-entrance' : 'no-floor', pathTo: () => null };
  const startOf = new Map();
  for (const [x, y] of entrances) { const s = nearestWalkable(grid, x, y); if (s >= 0) startOf.set(s, [x, y]); }
  const { cost, cameFrom } = dijkstra(grid, [...startOf.keys()]);
  const pathTo = (pts) => {
    const b = bounds(pts), pad = STEP * 1.5;
    const c0 = Math.max(0, Math.floor((b.minX - pad - grid.left) / STEP)), c1 = Math.min(grid.cols - 1, Math.ceil((b.maxX + pad - grid.left) / STEP));
    const r0 = Math.max(0, Math.floor((b.minY - pad - grid.top) / STEP)), r1 = Math.min(grid.rows - 1, Math.ceil((b.maxY + pad - grid.top) / STEP));
    let goal = -1;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * grid.cols + c;
      if (cost[i] === Infinity) continue;
      const [x, y] = grid.centre(i);
      if (distanceToEdge(pts, x, y) > pad) continue;
      if (goal < 0 || cost[i] < cost[goal]) goal = i;
    }
    if (goal < 0) return null;
    const squares = [];
    for (let s = goal; s >= 0; s = cameFrom[s]) squares.push(s);
    squares.reverse();
    const path = [startOf.get(squares[0])];
    for (const k of straighten(grid, squares)) path.push(grid.centre(k));
    return path.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  };
  return { grid, pathTo };
}

export function routeToRoom(doc, roomId) {
  const room = doc.items.find((it) => it.id === roomId && it.type === 'room');
  if (!room) return { reachable: false, path: [], reason: 'no-room' };
  const p = planner(doc);
  const path = p.pathTo(roomPolygon(room));
  return path ? { reachable: true, path } : { reachable: false, path: [], reason: p.reason || 'blocked' };
}

export function routeAll(doc) {
  const p = planner(doc), out = {};
  for (const it of doc.items) if (it.type === 'room' && it.cls !== 'void') out[it.id] = !!p.pathTo(roomPolygon(it));
  return out;
}

// Same shape as routes_for_floor(): { roomNumber: [[x,y],...] } for numbered rooms.
export function routesForFloor(doc) {
  const p = planner(doc), out = {};
  for (const it of doc.items) {
    if (it.type !== 'room' || it.cls === 'void' || !it.number) continue;
    const path = p.pathTo(roomPolygon(it));
    if (path) out[it.number] = path;
  }
  return out;
}

// Kept for callers that still pass a cell size.
export function findPath(doc, roomId) { return routeToRoom(doc, roomId); }
