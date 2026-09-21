// tests/validate.test.js
// One test per validate() rule code, plus a clean-doc sanity check.
// Depends on: node:test, node:assert, js/model/*, ./helpers.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../js/model/validate.js';
import { createDoc, setFloor, addItem, makeRoom, doorFor } from '../js/model/document.js';
import { makeSampleDoc } from './helpers.js';

const meta = { building: 'B', property: '1', floor: 1, slug: 's' };
const vb = { x: 0, y: 0, w: 200, h: 200 };
const sq = [[0, 0], [200, 0], [200, 200], [0, 200]];

function codes(doc) {
  return validate(doc).map((p) => p.code);
}

test('no-floor', () => {
  const doc = createDoc(meta, vb);
  assert.ok(codes(doc).includes('no-floor'));
});

test('floor-not-closed', () => {
  const doc = setFloor(createDoc(meta, vb), [[0, 0], [10, 10]]);
  assert.ok(codes(doc).includes('floor-not-closed'));
});

test('room-no-number', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  doc = addItem(doc, makeRoom('room', 10, 10, 20, 20, ''));
  assert.ok(codes(doc).includes('room-no-number'));
});

test('bad-number-format', () => {
  for (const bad of ['12A', '1234', 'ab123']) {
    let doc = setFloor(createDoc(meta, vb), sq);
    doc = addItem(doc, makeRoom('room', 10, 10, 20, 20, bad));
    assert.ok(codes(doc).includes('bad-number-format'), `expected bad-number-format for "${bad}"`);
  }
});

test('duplicate-number', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  doc = addItem(doc, makeRoom('room', 10, 10, 20, 20, '100'));
  doc = addItem(doc, makeRoom('room', 50, 10, 20, 20, '100'));
  assert.ok(codes(doc).includes('duplicate-number'));
});

test('door-off-outline', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  doc = addItem(doc, { id: 'd1', type: 'door', x1: 90, y1: 90, x2: 126, y2: 90, kind: 'EXIT', label: { x: 108, y: 120 } });
  assert.ok(codes(doc).includes('door-off-outline'));
});

test('door-no-exit-label', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  const d = doorFor(sq, { x: 100, y: 0 });
  doc = addItem(doc, { id: 'd1', type: 'door', ...d, kind: 'EXIT', label: { x: d.label.x, y: d.label.y + 500 } });
  assert.ok(codes(doc).includes('door-no-exit-label'));
});

test('void-with-label', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  const v = { ...makeRoom('void', 10, 10, 20, 20, '100') };
  doc = addItem(doc, v);
  assert.ok(codes(doc).includes('void-with-label'));
});

test('label-outside-shape', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  const room = makeRoom('room', 10, 10, 20, 20, '100');
  doc = addItem(doc, { ...room, label: { pinned: true, x: 500, y: 500, fontSize: null } });
  assert.ok(codes(doc).includes('label-outside-shape'));
});

test('door-no-floor', () => {
  let doc = createDoc(meta, vb); // no floor
  doc = addItem(doc, { id: 'd1', type: 'door', x1: 0, y1: 0, x2: 36, y2: 0, kind: 'EXIT', label: { x: 18, y: 55 } });
  assert.ok(codes(doc).includes('door-no-floor'));
});

test('transform-present', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  doc = { ...doc, problems: [{ code: 'transform-present' }] };
  assert.ok(codes(doc).includes('transform-present'));
});

test('overlapping-rooms (warning)', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  doc = addItem(doc, makeRoom('room', 10, 10, 40, 40, '100'));
  doc = addItem(doc, makeRoom('room', 30, 30, 40, 40, '101'));
  const probs = validate(doc);
  const w = probs.find((p) => p.code === 'overlapping-rooms');
  assert.ok(w);
  assert.equal(w.level, 'warning');
});

test('label-tiny (warning)', () => {
  let doc = setFloor(createDoc(meta, vb), sq);
  const room = makeRoom('room', 10, 10, 20, 20, '100');
  doc = addItem(doc, { ...room, label: { pinned: false, x: null, y: null, fontSize: 8 } });
  const probs = validate(doc);
  const w = probs.find((p) => p.code === 'label-tiny');
  assert.ok(w);
  assert.equal(w.level, 'warning');
});

test('clean sample doc yields zero errors', () => {
  const doc = makeSampleDoc();
  const probs = validate(doc);
  const errors = probs.filter((p) => p.level === 'error');
  assert.deepEqual(errors, []);
});
