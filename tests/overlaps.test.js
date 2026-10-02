// tests/overlaps.test.js
// Unit tests for js/model/overlaps.js. Depends on: node:test, node:assert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOverlaps, allOverlapPairs } from '../js/model/overlaps.js';

const room = (id, x, y, w, h, cls = 'room') => ({ id, type: 'room', cls, shape: 'rect', x, y, w, h });
const doc = (items) => ({ items });

test('overlapping rooms are found with px amounts', () => {
  const d = doc([room('a', 0, 0, 100, 100), room('b', 60, 70, 100, 100), room('c', 300, 0, 50, 50)]);
  const r = findOverlaps(d, 'a');
  assert.equal(r.length, 1);
  assert.equal(r[0].item.id, 'b');
  assert.deepEqual([r[0].w, r[0].h], [40, 30]);
  assert.equal(findOverlaps(d, 'c').length, 0);
});

test('containment counts, touching edges do not', () => {
  const d = doc([room('a', 0, 0, 200, 200), room('in', 50, 50, 20, 20), room('t', 200, 0, 50, 50)]);
  assert.deepEqual(findOverlaps(d, 'a').map((o) => o.item.id), ['in']);
});

test('void and core rooms count vs rooms; halls and doors never', () => {
  const d = doc([
    room('a', 0, 0, 100, 100),
    room('v', 50, 50, 100, 100, 'void'),
    { id: 'h', type: 'hall', x: 0, y: 0, w: 500, h: 500 },
    { id: 'd', type: 'door', x1: 10, y1: 10, x2: 10, y2: 40 },
  ]);
  assert.deepEqual(findOverlaps(d, 'a').map((o) => o.item.id), ['v']);
  assert.equal(findOverlaps(d, 'h').length, 0);
  assert.equal(findOverlaps(d, 'd').length, 0);
});

test('stair vs room overlaps; allOverlapPairs lists each pair once', () => {
  const d = doc([
    room('a', 0, 0, 100, 100),
    { id: 's', type: 'stair', x: 90, y: 90, w: 50, h: 50, dir: 'v' },
    room('b', 80, 0, 100, 100),
  ]);
  const pairs = allOverlapPairs(d).map((p) => [p.a.id, p.b.id].sort().join('-')).sort();
  assert.deepEqual(pairs, ['a-b', 'a-s', 'b-s']);
  assert.deepEqual(findOverlaps(d, 'missing'), []);
});

import { overlapClusters } from '../js/model/overlaps.js';

test('overlapClusters groups connected overlaps once, not once per direction', () => {
  const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), room('C', 180, 0, 100, 100), room('D', 600, 0, 50, 50), room('E', 610, 10, 50, 50), room('F', 1000, 0, 40, 40)] };
  const clusters = overlapClusters(doc);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0].items.map((i) => i.id).sort(), ['A', 'B', 'C']);
  assert.equal(clusters[0].pairs.length, 2);
  assert.deepEqual(clusters[1].items.map((i) => i.id).sort(), ['D', 'E']);
});
