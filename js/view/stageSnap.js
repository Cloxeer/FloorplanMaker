// stageSnap.js
// Magnet snapping for the Fabric stage: collects edge/centre/vertex targets
// from the document once per drag (cached, so `object:moving` stays cheap on
// big plans), then snaps a moving or scaling box to the 5-unit grid and to
// nearby geometry, returning the guide lines to draw. Alt disables magnets.
// Depends on: fabric@6.7.1 (jsDelivr), js/model/document.js, js/model/geometry.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { STD } from '../model/document.js';
import { bbox, snapToGrid } from '../model/geometry.js';

const TOL = 6;
const WALL_TOL = 8;

function itemBox(item) {
  if (item.type === 'room' && item.shape === 'poly') return bbox(item.points);
  if (item.type === 'door') {
    const x = Math.min(item.x1, item.x2);
    const y = Math.min(item.y1, item.y2);
    return { x, y, w: Math.abs(item.x2 - item.x1), h: Math.abs(item.y2 - item.y1) };
  }
  if (typeof item.w === 'number') return { x: item.x, y: item.y, w: item.w, h: item.h };
  return null;
}

export function createSnapper(app) {
  let cache = null;
  let cacheDoc = null;
  let cacheKey = '';

  function invalidate() {
    cache = null;
    cacheDoc = null;
    wallCache = null;
    wallCacheDoc = null;
  }

  let wallCache = null;
  let wallCacheDoc = null;

  // Axis-aligned wall segments from the floor outline, for the "snap to the
  // outline" magnet: each segment remembers its constant coordinate and the
  // span along it, so a snapped edge can be flush to the wall and the guide
  // overlay can be drawn as that exact segment.
  function collectWalls() {
    const doc = app.doc;
    if (wallCache && wallCacheDoc === doc) return wallCache;
    const walls = [];
    const pts = doc && doc.floor && doc.floor.points;
    if (pts && pts.length >= 2) {
      for (let i = 0; i < pts.length; i += 1) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if (Math.abs(x1 - x2) < 0.01) {
          walls.push({ orient: 'v', at: (x1 + x2) / 2, min: Math.min(y1, y2), max: Math.max(y1, y2) });
        } else if (Math.abs(y1 - y2) < 0.01) {
          walls.push({ orient: 'h', at: (y1 + y2) / 2, min: Math.min(x1, x2), max: Math.max(x1, x2) });
        }
      }
    }
    wallCache = walls;
    wallCacheDoc = doc;
    return walls;
  }

  function collect(ignoreIds) {
    const key = [...(ignoreIds || [])].sort().join(',');
    if (cache && cacheDoc === app.doc && cacheKey === key) return cache;
    const xs = [];
    const ys = [];
    const doc = app.doc;
    if (doc) {
      for (const item of doc.items) {
        if (ignoreIds && ignoreIds.has(item.id)) continue;
        const b = itemBox(item);
        if (!b) continue;
        xs.push(b.x, b.x + b.w / 2, b.x + b.w);
        ys.push(b.y, b.y + b.h / 2, b.y + b.h);
      }
      if (doc.floor && doc.floor.points) {
        for (const [px, py] of doc.floor.points) {
          xs.push(px);
          ys.push(py);
        }
      }
    }
    cache = { xs, ys };
    cacheDoc = doc;
    cacheKey = key;
    return cache;
  }

  // Best snap for one coordinate against a candidate list.
  function best(value, list) {
    let bestDelta = null;
    let at = null;
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i] - value;
      if (Math.abs(d) <= TOL && (bestDelta === null || Math.abs(d) < Math.abs(bestDelta))) {
        bestDelta = d;
        at = list[i];
      }
    }
    return bestDelta === null ? null : { delta: bestDelta, at };
  }

  // Snap a whole box (move). edges: which coordinates may snap.
  // Returns { dx, dy, guides }.
  function snapBox(box, opts = {}) {
    const alt = !!opts.alt;
    const magnet = app.magnet && !alt;
    const grid = app.gridOn && !alt ? STD.grid : null;
    const guides = [];
    let dx = 0;
    let dy = 0;
    const cx = opts.xEdges || [box.x, box.x + box.w / 2, box.x + box.w];
    const cy = opts.yEdges || [box.y, box.y + box.h / 2, box.y + box.h];
    if (magnet) {
      const { xs, ys } = collect(opts.ignoreIds);
      let bx = null;
      for (const v of cx) {
        const r = best(v, xs);
        if (r && (bx === null || Math.abs(r.delta) < Math.abs(bx.delta))) bx = r;
      }
      let by = null;
      for (const v of cy) {
        const r = best(v, ys);
        if (r && (by === null || Math.abs(r.delta) < Math.abs(by.delta))) by = r;
      }
      if (bx) { dx = bx.delta; guides.push({ axis: 'x', at: bx.at }); }
      if (by) { dy = by.delta; guides.push({ axis: 'y', at: by.at }); }
    }
    if (grid) {
      if (dx === 0 && cx.length) dx = snapToGrid(cx[0], grid) - cx[0];
      if (dy === 0 && cy.length) dy = snapToGrid(cy[0], grid) - cy[0];
    }
    if (magnet) {
      const walls = collectWalls();
      const left = box.x + dx;
      const right = box.x + box.w + dx;
      const top = box.y + dy;
      const bottom = box.y + box.h + dy;
      let wallDx = null;
      let wallDy = null;
      for (const w of walls) {
        if (w.orient === 'v') {
          if (bottom < w.min - WALL_TOL || top > w.max + WALL_TOL) continue;
          for (const edge of [left, right]) {
            const d = w.at - edge;
            if (Math.abs(d) <= WALL_TOL && (wallDx === null || Math.abs(d) < Math.abs(wallDx.delta))) {
              wallDx = { delta: d, wall: w };
            }
          }
        } else {
          if (right < w.min - WALL_TOL || left > w.max + WALL_TOL) continue;
          for (const edge of [top, bottom]) {
            const d = w.at - edge;
            if (Math.abs(d) <= WALL_TOL && (wallDy === null || Math.abs(d) < Math.abs(wallDy.delta))) {
              wallDy = { delta: d, wall: w };
            }
          }
        }
      }
      if (wallDx) {
        dx += wallDx.delta;
        guides.push({ axis: 'wall', x1: wallDx.wall.at, y1: wallDx.wall.min, x2: wallDx.wall.at, y2: wallDx.wall.max });
      }
      if (wallDy) {
        dy += wallDy.delta;
        guides.push({ axis: 'wall', x1: wallDy.wall.min, y1: wallDy.wall.at, x2: wallDy.wall.max, y2: wallDy.wall.at });
      }
    }
    return { dx, dy, guides };
  }

  return { snapBox, invalidate, collect };
}

// Absolute box of a Fabric object, valid inside or outside an ActiveSelection
// (an object nested in one has group-relative left/top, so go via the matrix).
export function absBox(obj) {
  const dec = fabric.util.qrDecompose(obj.calcTransformMatrix());
  const w = obj.width * Math.abs(dec.scaleX);
  const h = obj.height * Math.abs(dec.scaleY);
  return {
    x: dec.translateX - w / 2, y: dec.translateY - h / 2, w, h, angle: dec.angle,
  };
}

