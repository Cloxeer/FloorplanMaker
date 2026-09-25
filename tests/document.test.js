// tests/document.test.js
// Unit tests for js/model/document.js. Depends on: node:test, node:assert,
// ./helpers.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDoc,
  addItem,
  updateItem,
  removeItems,
  makeRoom,
  nextNumber,
  labelClass,
  labelPos,
  doorFor,
  doorSpanFor,
  stairTreads,
} from '../js/model/document.js';

test('nextNumber cases', () => {
  assert.equal(nextNumber('128B'), '128C');
  assert.equal(nextNumber('128'), '129');
  assert.equal(nextNumber('S117'), 'S118');
  assert.equal(nextNumber('128Z'), '128Z');
  assert.equal(nextNumber(''), '');
});

test('labelClass thresholds: 70 -> lbl, 69 -> lblS', () => {
  const big = makeRoom('room', 0, 0, 70, 100, '100');
  assert.equal(labelClass(big), 'lbl');
  const small = makeRoom('room', 0, 0, 69, 100, '101');
  assert.equal(labelClass(small), 'lblS');
});

test('labelPos: pinned vs centroid', () => {
  const room = makeRoom('room', 0, 0, 100, 50, '100');
  const centroidPos = labelPos(room);
  assert.deepEqual(centroidPos, { x: 50, y: 25 });

  const pinned = { ...room, label: { pinned: true, x: 10, y: 10, fontSize: null } };
  assert.deepEqual(labelPos(pinned), { x: 10, y: 10 });
});

test('doorFor on each side of a square', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];

  const top = doorFor(sq, { x: 50, y: 0 });
  assert.equal(top.y1, 0);
  assert.equal(top.y2, 0);
  assert.equal(Math.hypot(top.x2 - top.x1, top.y2 - top.y1), 36);
  assert.ok(top.label.y > 0); // inward = +y

  const right = doorFor(sq, { x: 100, y: 50 });
  assert.equal(right.x1, 100);
  assert.equal(right.x2, 100);
  assert.equal(Math.hypot(right.x2 - right.x1, right.y2 - right.y1), 36);
  assert.ok(right.label.x < 100); // inward = -x

  const bottom = doorFor(sq, { x: 50, y: 100 });
  assert.equal(bottom.y1, 100);
  assert.ok(bottom.label.y < 100);

  const left = doorFor(sq, { x: 0, y: 50 });
  assert.equal(left.x1, 0);
  assert.ok(left.label.x > 0);

  // Near a corner: door clamps to stay inside the edge (doesn't run past it).
  const nearCorner = doorFor(sq, { x: 5, y: 0 });
  assert.ok(nearCorner.x1 >= 0 && nearCorner.x2 >= 0);
  assert.ok(nearCorner.x1 <= 100 && nearCorner.x2 <= 100);
  assert.equal(Math.hypot(nearCorner.x2 - nearCorner.x1, nearCorner.y2 - nearCorner.y1), 36);
});

test('doorSpanFor sizes the opening to the drag along one wall edge', () => {
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];

  // Drag along the top edge from x=20 to x=80 -> a 60-wide opening on y=0.
  const d = doorSpanFor(sq, { x: 20, y: 0 }, { x: 80, y: 2 });
  assert.equal(d.y1, 0);
  assert.equal(d.y2, 0);
  assert.equal(Math.hypot(d.x2 - d.x1, d.y2 - d.y1), 60);
  assert.equal(d.span, 60);
  assert.ok(d.label.y > 0); // label sits inside the building

  // The drag end is projected onto the SAME edge the drag started on, and the
  // span is clamped to the edge length (can't run past the corner).
  const clamped = doorSpanFor(sq, { x: 60, y: 0 }, { x: 500, y: 0 });
  assert.ok(clamped.x1 <= 100 && clamped.x2 <= 100);
  assert.ok(clamped.x1 >= 0 && clamped.x2 >= 0);
});

test('stairTreads spacing 18', () => {
  const vStair = { x: 0, y: 0, w: 100, h: 60, dir: 'v' };
  const treads = stairTreads(vStair);
  assert.ok(treads.length > 1);
  for (let i = 1; i < treads.length; i++) {
    assert.equal(treads[i].y1 - treads[i - 1].y1, 18);
  }
  assert.equal(treads[0].y1, 9);
  for (const t of treads) {
    assert.ok(t.y1 < 60);
  }

  const hStair = { x: 0, y: 0, w: 60, h: 100, dir: 'h' };
  const hTreads = stairTreads(hStair);
  for (let i = 1; i < hTreads.length; i++) {
    assert.equal(hTreads[i].x1 - hTreads[i - 1].x1, 18);
  }
});

test('immutability of addItem/updateItem/removeItems', () => {
  const doc = createDoc({ building: 'B', property: '1', floor: 1, slug: 's' }, { x: 0, y: 0, w: 100, h: 100 });
  const room = makeRoom('room', 0, 0, 10, 10, '100');

  const doc2 = addItem(doc, room);
  assert.equal(doc.items.length, 0);
  assert.equal(doc2.items.length, 1);
  assert.notEqual(doc, doc2);

  const doc3 = updateItem(doc2, room.id, { number: '101' });
  assert.equal(doc2.items[0].number, '100');
  assert.equal(doc3.items[0].number, '101');
  assert.notEqual(doc2, doc3);

  const doc4 = removeItems(doc3, [room.id]);
  assert.equal(doc3.items.length, 1);
  assert.equal(doc4.items.length, 0);
  assert.notEqual(doc3, doc4);
});
