// stagePoly.js
// Fabric.js polygon point editing: the official "custom controls polygon"
// recipe adapted to Fabric 6 (one Control per vertex, polygonPositionHandler,
// anchorWrapper, actionHandler) plus helpers to read/write a polygon's points
// in absolute plan coordinates and to insert a vertex on an edge.
// Depends on: fabric@6.7.1 (jsDelivr), js/model/geometry.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { nearestPointOnSegment, snapToGrid } from '../model/geometry.js';

// A polygon built from absolute plan points keeps points in plan space and
// derives left/top from pathOffset. This is the constant offset between the
// two, which stays fixed while the shape is edited and changes when the whole
// polygon is dragged.
export function polyOffset(poly) {
  // A point p renders at (centre + p - pathOffset), so the plan-space offset
  // of the stored points is simply centre - pathOffset.
  const c = poly.getCenterPoint();
  return { dx: c.x - poly.pathOffset.x, dy: c.y - poly.pathOffset.y };
}

// Absolute plan coordinates of a polygon's points, [[x,y], ...].
export function polyPoints(poly) {
  const { dx, dy } = polyOffset(poly);
  return poly.points.map((p) => [p.x + dx, p.y + dy]);
}

// Replace the points (absolute plan coords) and re-anchor the object so the
// drawn shape lands exactly on those coordinates.
export function setPolyPoints(poly, pts) {
  poly.points = pts.map(([x, y]) => new fabric.Point(x, y));
  poly.setBoundingBox(true);
  poly.setCoords();
}

function renderDot(ctx, left, top, styleOverride, fabricObject) {
  const size = 9;
  ctx.save();
  ctx.translate(left, top);
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Screen position of vertex `pointIndex` (viewport transform included).
function polygonPositionHandler(dim, finalMatrix, poly) {
  const p = poly.points[this.pointIndex];
  if (!p) return new fabric.Point(0, 0);
  const local = { x: p.x - poly.pathOffset.x, y: p.y - poly.pathOffset.y };
  return fabric.util.transformPoint(
    local,
    fabric.util.multiplyTransformMatrices(poly.canvas.viewportTransform, poly.calcTransformMatrix())
  );
}

// Move one vertex to the pointer (x, y are scene coordinates). The polygon is
// always kept unscaled and unrotated, so scene space == plan space.
function actionHandler(eventData, transform, x, y) {
  const poly = transform.target;
  const control = poly.controls[poly.__corner];
  if (!control) return false;
  const off = polyOffset(poly);
  const grid = poly.snapGrid;
  const useGrid = grid && !(eventData && eventData.altKey);
  const px = useGrid ? snapToGrid(x, grid) : x;
  const py = useGrid ? snapToGrid(y, grid) : y;
  poly.points[control.pointIndex] = new fabric.Point(px - off.dx, py - off.dy);
  return true;
}

// Keeps the rest of the shape pinned while one vertex moves: re-derive the
// bounding box, then restore the polygon's plan-space offset.
function anchorWrapper(fn) {
  return function wrapped(eventData, transform, x, y) {
    const poly = transform.target;
    const off = polyOffset(poly);
    const performed = fn(eventData, transform, x, y);
    poly.setDimensions();
    poly.setPositionByOrigin(
      new fabric.Point(poly.pathOffset.x + off.dx, poly.pathOffset.y + off.dy),
      'center',
      'center'
    );
    poly.setCoords();
    return performed;
  };
}

// One round control per vertex. Called again whenever the point count changes.
export function attachPolyControls(poly, grid) {
  poly.snapGrid = grid || null;
  const controls = {};
  poly.points.forEach((_, index) => {
    controls[`p${index}`] = new fabric.Control({
      positionHandler: polygonPositionHandler,
      actionHandler: anchorWrapper(actionHandler),
      actionName: 'modifyPolygon',
      render: renderDot,
      sizeX: 12,
      sizeY: 12,
      pointIndex: index,
    });
  });
  poly.controls = controls;
  poly.hasBorders = true;
  poly.objectCaching = false;
}

// Nearest edge to a plan point: { index, x, y, dist } where index is the index
// of the edge's first vertex.
export function nearestEdge(pts, point) {
  let best = null;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const near = nearestPointOnSegment([point.x, point.y], a, b);
    const d = Math.hypot(near.x - point.x, near.y - point.y);
    if (!best || d < best.dist) best = { index: i, x: near.x, y: near.y, dist: d };
  }
  return best;
}

// Insert a vertex on the edge nearest `point`; returns new absolute points.
export function insertVertex(pts, point) {
  const edge = nearestEdge(pts, point);
  if (!edge) return pts;
  const next = pts.slice();
  next.splice(edge.index + 1, 0, [Math.round(edge.x), Math.round(edge.y)]);
  return next;
}
