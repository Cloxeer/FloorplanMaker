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

