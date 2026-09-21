// common.js
// Shared helpers for view/tools/*.js: bounding box of an item, moving/resizing
// items, and collecting magnet-snap targets. Depends on: js/model/document.js
// (roomPolygon), js/model/geometry.js (bbox, equalSpacingCandidates).

import { roomPolygon } from '../../model/document.js';
import { bbox, equalSpacingCandidates } from '../../model/geometry.js';

export function boxOf(item) {
  if (item.shape === 'rect') return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.shape === 'poly') return bbox(item.points);
  if (item.type === 'stair') return { x: item.x, y: item.y, w: item.w, h: item.h };
  if (item.type === 'compass') return { x: item.x - 26, y: item.y - 26, w: 52, h: 52 };
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function moveItem(item, dx, dy) {
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (item.shape === 'poly') {
    return { points: item.points.map(([x, y]) => [x + dx, y + dy]) };
  }
  if (item.type === 'room' || item.type === 'stair') {
    return { x: item.x + dx, y: item.y + dy };
  }
  if (item.type === 'compass') {
    return { x: item.x + dx, y: item.y + dy };
  }
  return {};
}

// Resize a rect item via a handle name ('nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w')
// dragging to plan point pt. Returns a patch { x, y, w, h }, min 10x10, integers.
export function resizeRect(item, handle, pt) {
  let { x, y, w, h } = item;
  let x2 = x + w;
  let y2 = y + h;
  const px = Math.round(pt.x);
  const py = Math.round(pt.y);

  if (handle.includes('w')) x = Math.min(px, x2 - 10);
  if (handle.includes('e')) x2 = Math.max(px, x + 10);
  if (handle.includes('n')) y = Math.min(py, y2 - 10);
  if (handle.includes('s')) y2 = Math.max(py, y + 10);

  return { x, y, w: x2 - x, h: y2 - y };
}

// Collect magnet snap targets: vertices of all rooms + floor, xs/ys of
// extended edges, plus equal-spacing candidates. ignoreIds excludes items
// currently being moved/resized. Returns { xs, ys, vertices } consumable by
// geometry.magnetSnap (grid is added by main.js's app.snap).
export function collectSnapTargets(doc, ignoreIds, movingBox) {
  const ignore = ignoreIds instanceof Set ? ignoreIds : new Set(ignoreIds || []);
  const vertices = [];
  const xs = [];
  const ys = [];
  const boxes = [];

  for (const item of doc.items) {
    if (ignore.has(item.id)) continue;
    if (item.type !== 'room') continue;
    const pts = roomPolygon(item);
    for (const p of pts) vertices.push(p);
    const b = bbox(pts);
    xs.push(b.x, b.x + b.w);
    ys.push(b.y, b.y + b.h);
    boxes.push(b);
  }

  if (doc.floor && doc.floor.points) {
    for (const p of doc.floor.points) vertices.push(p);
    const b = bbox(doc.floor.points);
    xs.push(b.x, b.x + b.w);
    ys.push(b.y, b.y + b.h);
  }

  if (movingBox && boxes.length) {
    const eq = equalSpacingCandidates(movingBox, boxes);
    xs.push(...eq.xs);
    ys.push(...eq.ys);
  }

  return { xs, ys, vertices };
}
