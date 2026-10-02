// fixoverlaps.test.js
// Pure tests for the staged "fix overlaps" proposals: small crossings share an edge,
// bigger ones trim the larger room (L / notch polygons), stairs are never moved,
// containment is reported, and the result never overlaps and never grows a room.

import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeFix, clipShape, overlapArea } from '../js/model/fixOverlaps.js';
import { overlapClusters, allOverlapPairs } from '../js/model/overlaps.js';
import { roomPolygon } from '../js/model/document.js';
import { polygonArea } from '../js/model/geometry.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const stair = (id, x, y, w, h) => ({ id, type: 'stair', x, y, w, h, dir: 'v' });
const area = (it) => Math.abs(polygonArea(it.type === 'stair' ? roomPolygon({ ...it, shape: 'rect' }) : roomPolygon(it)));
const fixAll = (items) => {
  let doc = { items };
  const clusters = overlapClusters(doc);
  const unresolved = [];
  for (const c of clusters) {
    const r = proposeFix(doc, c);
    doc = r.doc; unresolved.push(...r.unresolved);
  }
  return { doc, unresolved };
};
const noOverlap = (doc) => {
  const rs = doc.items.filter((i) => i.type === 'room' || i.type === 'stair');
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    if (!((rs[i].type === 'room') || (rs[j].type === 'room'))) continue;
    const pa = roomPolygon(rs[i].type === 'stair' ? { ...rs[i], shape: 'rect' } : rs[i]);
    const pb = roomPolygon(rs[j].type === 'stair' ? { ...rs[j], shape: 'rect' } : rs[j]);
    const a = overlapArea(pa, pb);
    if (a) return false;
  }
  return true;
};

test('a small crossing shares one edge on the 5-grid', () => {
  const { doc, unresolved } = fixAll([room('A', 0, 0, 100, 100), room('B', 95, 0, 100, 100)]);
  assert.equal(unresolved.length, 0);
  const [a, b] = doc.items;
  assert.equal(a.x + a.w, b.x);
  assert.equal(a.x % 5 + a.w % 5 + b.x % 5, 0);
  assert.ok(noOverlap(doc));
});

test('a big room is trimmed around a small one (L shape) and keeps its other area', () => {
  const big = room('BIG', 0, 0, 300, 200), small = room('S', 250, 150, 100, 100);
  const { doc, unresolved } = fixAll([big, small]);
  assert.equal(unresolved.length, 0);
  const nb = doc.items.find((i) => i.id === 'BIG'), ns = doc.items.find((i) => i.id === 'S');
  assert.equal(nb.shape, 'poly');
  assert.equal(nb.points.length, 6);
  assert.deepEqual([ns.x, ns.y, ns.w, ns.h], [250, 150, 100, 100]); // the small room is untouched
  assert.equal(area(nb), 300 * 200 - 50 * 50);
  assert.ok(noOverlap(doc));
});

test('a room poking into the middle of an edge leaves a notched polygon', () => {
  const { doc } = fixAll([room('BIG', 0, 0, 300, 200), room('S', 100, 150, 60, 100)]);
  const nb = doc.items.find((i) => i.id === 'BIG');
  assert.equal(nb.shape, 'poly');
  assert.equal(nb.points.length, 8);
  assert.equal(area(nb), 300 * 200 - 60 * 50);
  assert.ok(noOverlap(doc));
});

test('trimming that spans a whole side stays a rectangle', () => {
  const { doc } = fixAll([room('BIG', 0, 0, 300, 200), room('S', 0, 120, 300, 200)]);
  const nb = doc.items.find((i) => i.id === 'BIG');
  assert.equal(nb.shape, 'rect');
  assert.deepEqual([nb.x, nb.y, nb.w, nb.h], [0, 0, 300, 120]);
});

test('a stair is never changed; the room around it is', () => {
  const { doc, unresolved } = fixAll([room('R', 0, 0, 200, 150), stair('ST', 150, 100, 100, 100)]);
  assert.equal(unresolved.length, 0);
  const st = doc.items.find((i) => i.id === 'ST');
  assert.deepEqual([st.x, st.y, st.w, st.h], [150, 100, 100, 100]);
  assert.ok(noOverlap(doc));
});

test('containment is reported, not guessed', () => {
  const { doc, unresolved } = fixAll([room('OUT', 0, 0, 300, 300), room('IN', 100, 100, 50, 50)]);
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0].reason, /inside/);
  assert.deepEqual(doc.items.map((i) => [i.x, i.y, i.w, i.h]), [[0, 0, 300, 300], [100, 100, 50, 50]]);
});

test('a chain of overlaps in one cluster ends with no overlap and no room grown', () => {
  const items = [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), room('C', 180, 0, 100, 100), room('D', 90, 95, 100, 100)];
  const before = items.map(area);
  const { doc } = fixAll(items);
  assert.ok(noOverlap(doc));
  doc.items.forEach((it, i) => assert.ok(area(it) <= before[i], `${it.id} did not grow`));
  assert.equal(overlapClusters(doc).length, 0);
});

test('clipShape refuses to split a room in two', () => {
  const target = [[0, 0], [300, 0], [300, 100], [0, 100]];
  const cutter = [[100, -50], [150, -50], [150, 150], [100, 150]]; // cuts straight through
  assert.equal(clipShape(target, cutter), null);
});

test('allOverlapPairs agrees there is nothing left after the fix', () => {
  const { doc } = fixAll([room('A', 0, 0, 120, 100), room('B', 100, 20, 120, 60), room('C', 50, 90, 80, 80)]);
  assert.equal(allOverlapPairs(doc).length, 0);
});

test('a room with diagonal edges (octagon hall) is trimmed around a small room with no overlap left', () => {
  const hall = { id: 'H', type: 'room', cls: 'room', shape: 'poly', number: '125', name: 'Hall', points: [[40, 0], [260, 0], [300, 40], [300, 260], [260, 300], [40, 300], [0, 260], [0, 40]] };
  const small = room('M', 0, 30, 70, 90);
  const { doc, unresolved } = fixAll([hall, small]);
  assert.equal(unresolved.length, 0);
  const nh = doc.items.find((i) => i.id === 'H');
  assert.equal(nh.shape, 'poly');
  assert.ok(noOverlap(doc));
  assert.ok(area(nh) < area(hall) && area(nh) > 0.7 * area(hall), 'shrank a little, kept most of the hall');
  assert.equal(allOverlapPairs(doc).length, 0);
});

test('a polygon with repeated points and spikes is cleaned instead of breaking the fixer', async () => {
  const { cleanRing } = await import('../js/model/fixOverlaps.js');
  const ring = cleanRing([[0, 0], [0, 0], [100, 0], [100, 0], [100, 50], [100, 100], [0, 100], [0, 50], [0, 0]]);
  const key = (r) => r.map((q) => q.join(',')).sort().join(' ');
  assert.equal(ring.length, 4);
  assert.equal(key(ring), key([[0, 0], [100, 0], [100, 100], [0, 100]]));
  assert.equal(cleanRing([[0, 0], [100, 100], [100, 0], [0, 100]]), null, 'a bow-tie is rejected');
});
