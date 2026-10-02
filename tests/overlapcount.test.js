// overlapcount.test.js
// The red dot on View / View layers is driven by countOverlaps: it must agree with the Layers panel
// (allOverlapPairs), be cheap on big plans, and reach zero once the overlaps are fixed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { countOverlaps } from '../js/model/overlapCount.js';
import { allOverlapPairs, overlapClusters } from '../js/model/overlaps.js';
import { proposeFix } from '../js/model/fixOverlaps.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const stair = (id, x, y, w, h) => ({ id, type: 'stair', x, y, w, h, dir: 'v' });

test('no dot when nothing overlaps, edges that only touch do not count', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 100, 0, 100, 100), room('C', 0, 100, 100, 100)] };
  assert.equal(countOverlaps(doc).pairs, 0);
});

test('a crossing room pair and a room over a stair are counted; stair over stair is not', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), stair('S', 0, 90, 40, 40), stair('T', 10, 100, 40, 40)] };
  const r = countOverlaps(doc);
  assert.equal(r.pairs, 2); // A-B and A-S; T only touches A, and stair-on-stair never counts
  assert.ok(r.ids.has('A') && r.ids.has('B') && r.ids.has('S'));
});

test('agrees with the Layers panel on a messy plan', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const items = [];
  for (let i = 0; i < 120; i++) items.push(room('r' + i, Math.round(rnd() * 800), Math.round(rnd() * 800), 40 + Math.round(rnd() * 100), 40 + Math.round(rnd() * 100)));
  for (let i = 0; i < 10; i++) items.push(stair('s' + i, Math.round(rnd() * 800), Math.round(rnd() * 800), 40, 60));
  const doc = { items };
  assert.equal(countOverlaps(doc).pairs, allOverlapPairs(doc).length);
});

test('handles empty, missing and broken items without throwing', () => {
  assert.equal(countOverlaps(null).pairs, 0);
  assert.equal(countOverlaps({}).pairs, 0);
  assert.equal(countOverlaps({ items: [null, { type: 'room' }, room('A', NaN, 0, 10, 10), room('B', 0, 0, 10, 10)] }).pairs, 0);
});

test('is fast on thousands of rooms', () => {
  const items = [];
  for (let i = 0; i < 2500; i++) items.push(room('r' + i, (i % 50) * 60, Math.floor(i / 50) * 60, 55, 55));
  const t0 = performance.now();
  const r = countOverlaps({ items });
  assert.equal(r.pairs, 0);
  assert.ok(performance.now() - t0 < 400, 'under 400 ms');
});

test('drops to zero after the overlap fixer has run on every cluster', () => {
  let doc = { items: [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), room('C', 150, 60, 100, 100)] };
  assert.ok(countOverlaps(doc).pairs > 0);
  for (const c of overlapClusters(doc)) doc = proposeFix(doc, c).doc;
  assert.equal(countOverlaps(doc).pairs, 0);
});
