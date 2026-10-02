// autobuild.test.js
// Pure-module tests for AutoBuild: room-number grammar, name matching,
// coordinate clustering, overlap resolving, and wall-based straightening.

import test from 'node:test';
import assert from 'node:assert/strict';
import { repairNumber, matchName } from '../js/model/autobuild/text.js';
import { clusterSnap } from '../js/model/autobuild/faces.js';
import { alignShapes, resolveOverlaps } from '../js/model/autobuild/shapes.js';
import { makeImage, rotateImage } from '../js/model/autobuild/raster.js';
import { rectify } from '../js/model/autobuild/rectify.js';

test('repairNumber fixes look-alike characters inside digit slots', () => {
  assert.equal(repairNumber('128B').value, '128B');
  assert.equal(repairNumber('I28B').value, '128B');
  assert.equal(repairNumber('O05').value, '005');
  assert.equal(repairNumber('R1O1').value, 'R101');
  assert.equal(repairNumber('T1O6').value, 'T106');
  assert.equal(repairNumber('S122').value, 'S122');
});

test('repairNumber rejects things that are not room numbers', () => {
  assert.equal(repairNumber('HELP'), null);
  assert.equal(repairNumber('12'), null);
  assert.equal(repairNumber(''), null);
});

test('matchName snaps near-misses to the vocabulary', () => {
  assert.equal(matchName('CLASSROOM'), 'CLASSROOM');
  assert.equal(matchName('CLASSR0OM'), 'CLASSROOM');
  assert.equal(matchName('LECTURE HALL'), 'LECTURE HALL');
  assert.equal(matchName('XQZ'), null);
});

test('clusterSnap merges close values and leaves far ones alone', () => {
  const f = clusterSnap([100, 102, 103, 200, 201], 4);
  assert.equal(f(100), f(103));
  assert.equal(f(200), f(201));
  assert.notEqual(f(100), f(200));
});

test('alignShapes gives neighbouring rects a shared edge on the 5-grid', () => {
  const a = { x: 100, y: 100, w: 98, h: 60 };
  const b = { x: 201, y: 101, w: 90, h: 59 };
  alignShapes([a, b], 6);
  assert.equal(a.x + a.w, b.x);
  assert.equal(a.y, b.y);
  for (const v of [a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h]) assert.equal(v % 5, 0);
});

test('resolveOverlaps splits small crossings and ignores deep overlaps', () => {
  const a = { x: 0, y: 0, w: 105, h: 50 };
  const b = { x: 100, y: 0, w: 100, h: 50 };
  resolveOverlaps([a, b]);
  assert.ok(a.x + a.w <= b.x + 0.001);
  const c = { x: 0, y: 0, w: 100, h: 100 };
  const d = { x: 20, y: 20, w: 100, h: 100 };
  resolveOverlaps([c, d]);
  assert.deepEqual([c.w, d.x], [100, 20]);
});

function gridImage(w, h) {
  const img = makeImage(w, h, 240);
  const put = (x, y) => { const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 40; };
  for (let x = 60; x < w - 60; x += 70) for (let y = 40; y < h - 40; y++) { put(x, y); put(x + 1, y); }
  for (let y = 40; y < h - 40; y += 60) for (let x = 60; x < w - 60; x++) { put(x, y); put(x, y + 1); }
  return img;
}

test('rectify removes a tilt from a grid of walls', () => {
  const tilted = rotateImage(gridImage(700, 500), 3);
  const r = rectify(tilted);
  assert.ok(r, 'plan found');
  const again = rectify(r.image);
  assert.ok(again, 'second pass runs');
  assert.ok(Math.abs(again.fit[0]) < Math.abs(r.fit[0]) / 2 + 0.003, `residual tilt shrank (${again.fit[0]} vs ${r.fit[0]})`);
});
