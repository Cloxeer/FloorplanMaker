// tests/route.test.js
// Tests for js/model/route.js: reachability, floor-2 stair starts, routeAll
// consistency, and a timing/perf smoke test. Depends on: node:test,
// node:assert, js/model/*.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as routeModule from '../js/model/route.js';
import { routeToRoom, routeAll } from '../js/model/route.js';
import { createDoc, setFloor, addItem, makeRoom, doorFor } from '../js/model/document.js';

test('route.js actually exports routeAll (sanity check on module shape)', () => {
  const exportNames = Object.keys(routeModule);
  assert.ok(exportNames.includes('routeAll'), `route.js exports: ${exportNames.join(', ')}`);
  assert.equal(typeof routeAll, 'function');
});

function baseDoc() {
  const meta = { building: 'B', property: '1', floor: 1, slug: 's' };
  const sq = [[0, 0], [300, 0], [300, 300], [0, 300]];
  let doc = createDoc(meta, { x: 0, y: 0, w: 300, h: 300 });
  doc = setFloor(doc, sq);
  const door = doorFor(sq, { x: 150, y: 0 });
  doc = addItem(doc, { id: 'door1', type: 'door', ...door, kind: 'EXIT' });
  return doc;
}

test('reachable room', () => {
  let doc = baseDoc();
  const room = makeRoom('room', 100, 100, 40, 40, '100');
  doc = addItem(doc, { ...room, id: 'r1' });
  const result = routeToRoom(doc, 'r1');
  assert.equal(result.reachable, true);
  assert.ok(result.path.length > 0);
});

test('walled-in room unreachable', () => {
  let doc = baseDoc();
  // Room fully enclosed by 4 wall-like "core" rooms leaving no walkable gap.
  const target = makeRoom('room', 140, 140, 20, 20, '100');
  doc = addItem(doc, { ...target, id: 'r1' });
  // Surround with a thick ring of blocking rooms (a full annulus around target)
  const ring = [
    makeRoom('core', 100, 100, 100, 20, ''), // top
    makeRoom('core', 100, 180, 100, 20, ''), // bottom
    makeRoom('core', 100, 100, 20, 100, ''), // left
    makeRoom('core', 180, 100, 20, 100, ''), // right
  ];
  for (const r of ring) doc = addItem(doc, { ...r, cls: 'void' });
  const result = routeToRoom(doc, 'r1');
  assert.equal(result.reachable, false);
});

test('floor 2 uses stair as start', () => {
  const meta = { building: 'B', property: '1', floor: 2, slug: 's' };
  const sq = [[0, 0], [300, 0], [300, 300], [0, 300]];
  let doc = createDoc(meta, { x: 0, y: 0, w: 300, h: 300 });
  doc = setFloor(doc, sq);
  doc = addItem(doc, { id: 'stair1', type: 'stair', x: 10, y: 10, w: 40, h: 60, dir: 'v' });
  const room = makeRoom('room', 200, 200, 40, 40, '200');
  doc = addItem(doc, { ...room, id: 'r1' });
  const result = routeToRoom(doc, 'r1');
  assert.equal(result.reachable, true);

  // No stairs and no doors -> unreachable, confirming doors are ignored on floor 2.
  const doc2 = { ...doc, items: doc.items.filter((it) => it.type !== 'stair') };
  const result2 = routeToRoom(doc2, 'r1');
  assert.equal(result2.reachable, false);
});

test('routeAll consistent with routeToRoom', () => {
  let doc = baseDoc();
  const r1 = { ...makeRoom('room', 100, 100, 40, 40, '100'), id: 'r1' };
  const r2 = { ...makeRoom('room', 10, 250, 30, 30, '101'), id: 'r2' };
  doc = addItem(doc, r1);
  doc = addItem(doc, r2);

  const all = routeAll(doc);
  for (const id of ['r1', 'r2']) {
    const single = routeToRoom(doc, id);
    assert.equal(all[id], single.reachable, `mismatch for room ${id}`);
  }
});

test('perf: 300 rooms, routeAll under 500ms', () => {
  const meta = { building: 'B', property: '1', floor: 1, slug: 's' };
  const vb = { x: 0, y: 0, w: 1500, h: 2000 };
  let doc = createDoc(meta, vb);
  doc = setFloor(doc, [[0, 0], [1500, 0], [1500, 2000], [0, 2000]]);
  const door = doorFor(doc.floor.points, { x: 750, y: 0 });
  doc = addItem(doc, { id: 'door1', type: 'door', ...door, kind: 'EXIT' });

  const cols = 30; // 30 x 10 = 300 rooms
  const rows = 10;
  const cellW = 1500 / cols;
  const cellH = 2000 / rows;
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      n++;
      const room = makeRoom('room', c * cellW + 5, r * cellH + 5, cellW - 10, cellH - 10, String(100 + n));
      doc = addItem(doc, { ...room, id: `r${n}` });
    }
  }

  const start = performance.now();
  const result = routeAll(doc);
  const ms = performance.now() - start;
  console.log(`  routeAll(300 rooms) took ${ms.toFixed(1)}ms`);
  assert.equal(Object.keys(result).length, 300);
  assert.ok(ms < 500, `routeAll took ${ms.toFixed(1)}ms, expected < 500ms`);
});
