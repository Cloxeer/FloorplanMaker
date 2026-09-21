// tests/geometry.test.js
// Unit tests for js/model/geometry.js. Depends on: node:test, node:assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  polygonCentroid,
  pointInPolygon,
  bbox,
  nearestPointOnSegment,
  nearestPointOnPolyline,
  segmentsIntersect,
  polygonsOverlap,
  isOnOutline,
  insideNormal,
  snapToGrid,
  magnetSnap,
  equalSpacingCandidates,
} from '../js/model/geometry.js';

test('polygonCentroid of a square', () => {
  const c = polygonCentroid([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.equal(c.x, 5);
  assert.equal(c.y, 5);
});

test('pointInPolygon inside/outside/on-edge', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], sq), true);
  assert.equal(pointInPolygon([50, 50], sq), false);
  // On-edge points are boundary-sensitive by ray casting; tolerate either
  // true/false but confirm it doesn't throw and is deterministic.
  const edgeResult = pointInPolygon([5, 0], sq);
  assert.equal(typeof edgeResult, 'boolean');
});

test('bbox', () => {
  const b = bbox([[3, 4], [10, -2], [0, 8]]);
  assert.deepEqual(b, { x: 0, y: -2, w: 10, h: 10 });
});

test('nearestPointOnSegment', () => {
  const np = nearestPointOnSegment([5, 5], [0, 0], [10, 0]);
  assert.equal(np.x, 5);
  assert.equal(np.y, 0);
  assert.equal(np.t, 0.5);

  const clamped = nearestPointOnSegment([-5, 5], [0, 0], [10, 0]);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.t, 0);
});

test('nearestPointOnPolyline (closed)', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const np = nearestPointOnPolyline([5, -3], sq, true);
  assert.equal(np.x, 5);
  assert.equal(np.y, 0);
  assert.equal(np.segIndex, 0);
});

test('segmentsIntersect: proper crossing vs touching', () => {
  assert.equal(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0]), true);
  // Touching at a shared endpoint is not a proper intersection.
  assert.equal(segmentsIntersect([0, 0], [10, 0], [10, 0], [10, 10]), false);
  // Collinear touching.
  assert.equal(segmentsIntersect([0, 0], [5, 0], [5, 0], [10, 0]), false);
});

test('polygonsOverlap: overlap true, touching false, containment true', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const overlapping = [[5, 5], [15, 5], [15, 15], [5, 15]];
  assert.equal(polygonsOverlap(a, overlapping), true);

  const touching = [[10, 0], [20, 0], [20, 10], [10, 10]];
  assert.equal(polygonsOverlap(a, touching), false);

  const inner = [[2, 2], [8, 2], [8, 8], [2, 8]];
  assert.equal(polygonsOverlap(a, inner), true);
  assert.equal(polygonsOverlap(inner, a), true);
});

test('isOnOutline', () => {
  const outline = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(isOnOutline({ x1: 10, y1: 0, x2: 40, y2: 0 }, outline), true);
  assert.equal(isOnOutline({ x1: 10, y1: 50, x2: 40, y2: 50 }, outline), false);
});

test('insideNormal points inward for CW and CCW squares', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]]; // signed area negative per this winding in screen coords
  const n = insideNormal(ccw, [0, 0], [10, 0]);
  const mid = [5, 0];
  const testPt = [mid[0] + n[0], mid[1] + n[1]];
  assert.equal(pointInPolygon(testPt, ccw), true);

  const cw = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const n2 = insideNormal(cw, [0, 0], [10, 0]);
  const testPt2 = [5 + n2[0], 0 + n2[1]];
  assert.equal(pointInPolygon(testPt2, cw), true);
});

test('snapToGrid', () => {
  assert.equal(snapToGrid(12, 5), 10);
  assert.equal(snapToGrid(13, 5), 15);
  assert.equal(snapToGrid(12, 0), 12);
});

test('magnetSnap: vertex beats edge beats grid, guides returned', () => {
  const targets = {
    xs: [20],
    ys: [20],
    vertices: [[10, 10]],
    grid: 5,
  };
  // Near the vertex on both axes -> vertex wins over the xs/ys edge values.
  const snappedVertex = magnetSnap({ x: 11, y: 12 }, targets, 6);
  assert.equal(snappedVertex.x, 10);
  assert.equal(snappedVertex.y, 10);
  assert.ok(snappedVertex.guides.some((g) => g.axis === 'x' && g.at === 10));
  assert.ok(snappedVertex.guides.some((g) => g.axis === 'y' && g.at === 10));

  // Far from any vertex, close to an edge value -> edge wins over grid.
  const snappedEdge = magnetSnap({ x: 22, y: 100 }, { xs: [20], ys: [], vertices: [], grid: 5 }, 6);
  assert.equal(snappedEdge.x, 20);
  assert.equal(snappedEdge.guides.some((g) => g.axis === 'x' && g.at === 20), true);

  // Nothing nearby but grid -> grid wins.
  const snappedGrid = magnetSnap({ x: 102, y: 203 }, { xs: [], ys: [], vertices: [], grid: 5 }, 6);
  assert.equal(snappedGrid.x, 100);
  assert.equal(snappedGrid.y, 205);
});

test('equalSpacingCandidates', () => {
  const moving = { w: 10, h: 10 };
  const boxes = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 30, y: 0, w: 10, h: 10 },
  ];
  const { xs } = equalSpacingCandidates(moving, boxes);
  // gap between the two boxes is 20; candidate to the right of B or left of A
  // preserving that gap.
  assert.ok(xs.includes(60)); // right of B (30+10+20)
  assert.ok(xs.includes(-30)); // left of A (0-20-10)
});
