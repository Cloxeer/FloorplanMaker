// tests/turn.test.js
// Turning a selection as one rigid body (js/model/turn.js). Depends on: node:test, js/model/turn.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnDoc, turnSelection, selectionBox, pivotFor } from '../js/model/turn.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, label: { pinned: false, x: null, y: null } });
const doc = () => ({
  version: 1, meta: {}, viewBox: { x: 0, y: 0, w: 1000, h: 1000 },
  floor: { points: [[0, 0], [200, 0], [200, 100], [0, 100]] },
  items: [
    room('a', 0, 0, 100, 100), room('b', 100, 0, 100, 100),
    { id: 's', type: 'stair', x: 0, y: 0, w: 40, h: 20, dir: 'v' },
    { id: 'd', type: 'door', kind: 'Door', x1: 0, y1: 40, x2: 0, y2: 76, label: { x: 55, y: 58 } },
    { id: 'c', type: 'compass', x: 10, y: 10, deg: 0 },
    { id: 'l', type: 'legend', x: 500, y: 500, scale: 1 },
  ],
});
const get = (d, id) => d.items.find((i) => i.id === id);

test('a quarter turn moves the pair as one: it stays touching, and the pair swaps from wide to tall', () => {
  const d = turnSelection(doc(), ['a', 'b'], 1, 5);
  const a = get(d, 'a'), b = get(d, 'b');
  assert.deepEqual([a.w, a.h, b.w, b.h], [100, 100, 100, 100]);
  assert.equal(a.x, b.x, 'both in one column now');
  assert.equal(b.y, a.y + 100, 'b sits right below a (a was left of b, clockwise)');
  const box = selectionBox(d, ['a', 'b']);
  assert.deepEqual([box.x1 - box.x0, box.y1 - box.y0], [100, 200]);
});

test('four quarter turns bring everything back', () => {
  let d = doc();
  const ids = ['a', 'b', 's', 'd', 'c', 'floor'];
  for (let i = 0; i < 4; i++) d = turnSelection(d, ids, 1, 5);
  const o = doc();
  assert.deepEqual(d.items.filter((i) => i.id !== 'c'), o.items.filter((i) => i.id !== 'c'));
  assert.deepEqual(d.floor.points, o.floor.points);
  assert.equal(get(d, 'c').deg, 0);
});

test('stairs swap size and direction, doors and the outline turn with the rooms, the compass keeps pointing north', () => {
  const d = turnDoc(doc(), ['s', 'd', 'c', 'l'], 1, 100, 50, true);
  const s = get(d, 's');
  assert.deepEqual([s.w, s.h, s.dir], [20, 40, 'h']);
  const door = get(d, 'd');
  assert.deepEqual([door.x1, door.y1, door.x2, door.y2], [110, -50, 74, -50]);
  assert.equal(door.y1, door.y2, 'a vertical door becomes horizontal');
  assert.equal(get(d, 'c').deg, 90);
  assert.deepEqual(get(d, 'l'), get(doc(), 'l'), 'the legend does not move');
  assert.equal(d.floor.points.length, 4);
  const xs = d.floor.points.map((p) => p[0]), ys = d.floor.points.map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [50, 150, -50, 150]);
});

test('poly rooms turn point by point and pinned labels follow', () => {
  const d0 = doc();
  d0.items.push({ id: 'p', type: 'room', cls: 'room', shape: 'poly', points: [[0, 0], [60, 0], [0, 40]], number: 'p', label: { pinned: true, x: 10, y: 10 } });
  const d = turnDoc(d0, ['p'], 2, 0, 0);
  const p = get(d, 'p');
  assert.deepEqual(p.points, [[0, 0], [-60, 0], [0, -40]]);
  assert.deepEqual([p.label.x, p.label.y], [-10, -10]);
});

test('untouched pieces and the input doc stay as they were; zero turns is a no-op', () => {
  const d0 = doc(), snap = JSON.stringify(d0);
  const d = turnDoc(d0, ['a'], 1, 50, 50);
  assert.equal(JSON.stringify(d0), snap);
  assert.deepEqual(get(d, 'b'), get(d0, 'b'));
  assert.equal(turnDoc(d0, ['a'], 4, 50, 50), d0);
  assert.equal(turnDoc(d0, ['a'], 0, 50, 50), d0);
});

test('the pivot lands on the grid', () => {
  assert.deepEqual(pivotFor({ x0: 3, y0: 3, x1: 104, y1: 98 }, 5), { cx: 55, cy: 50 });
  assert.deepEqual(pivotFor({ x0: 3, y0: 3, x1: 104, y1: 98 }, 1), { cx: 54, cy: 51 });
});
