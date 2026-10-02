// fixauto.test.js
// "Fix all": safe fixes are applied together without asking; fixes that guess, add or reshape are
// held back for approval and nothing is invented.

import test from 'node:test';
import assert from 'node:assert/strict';
import { autoFixAll, approvalReason, needsApproval } from '../js/model/fixAuto.js';
import { nextFix, manualLeft } from '../js/model/fixNotes.js';

const room = (id, x, y, w, h, number = id) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '', label: { pinned: false, x: null, y: null, fontSize: null } });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const door = (id, x1, y1, x2, y2) => ({ id, type: 'door', x1, y1, x2, y2, kind: 'EXIT', label: { x: x1 + 20, y: y1 } });
const floor = { points: [[0, 0], [700, 0], [700, 400], [0, 400]] };

test('inferred room numbers are held for approval, never applied silently', () => {
  const doc = { items: [room('128B', 0, 0, 100, 100), room('x', 100, 0, 100, 100, ''), room('128D', 200, 0, 100, 100), hall('h', 0, 100, 300, 30), door('d', 0, 110, 0, 120)], floor };
  const r = autoFixAll(doc);
  assert.equal(r.doc.items.find((i) => i.id === 'x').number, '', 'number not filled without approval');
  assert.ok(r.held.some((h) => h.kind === 'number'));
  const f = nextFix(r.doc, new Set());
  assert.equal(needsApproval(f, r.doc), true);
});

test('a small shared-edge overlap and a tiny hall overlap are fixed without asking, as one batch', () => {
  const doc = {
    items: [room('A', 0, 0, 100, 100), room('B', 95, 0, 100, 100), hall('h1', 0, 100, 300, 30), hall('h2', 200, 105, 150, 30), door('d', 0, 110, 0, 120)],
    floor,
  };
  const r = autoFixAll(doc);
  assert.ok(r.applied.length >= 1);
  const a = r.doc.items.find((i) => i.id === 'A'), b = r.doc.items.find((i) => i.id === 'B');
  assert.ok(a.x + a.w <= b.x, 'rooms no longer overlap');
  assert.equal(r.held.filter((h) => h.kind === 'overlap').length, 0);
});

test('a fix that adds a new piece, reshapes a room or removes text needs approval', () => {
  const before = { items: [room('A', 0, 0, 300, 200), room('S', 250, 150, 100, 100)] };
  const lshape = { kind: 'overlap', notes: ['trimmed'], doc: { items: [{ ...room('A', 0, 0, 300, 200), shape: 'poly', points: [[0, 0], [300, 0], [300, 150], [250, 150], [250, 200], [0, 200]] }, before.items[1]] } };
  assert.match(approvalReason(lshape, before), /reshape/);
  const added = { kind: 'hall-connect', notes: [], doc: { items: [...before.items, hall('new', 0, 0, 10, 10)] } };
  assert.match(approvalReason(added, before), /adds/);
  assert.match(approvalReason({ kind: 'void-label', doc: before }, before), /removes text/);
  assert.match(approvalReason({ kind: 'hall-connect', notes: ['The link runs through Room A'], doc: before }, before), /through a room/);
  assert.equal(approvalReason({ kind: 'label', doc: before }, before), '');
  assert.match(approvalReason({ kind: 'mystery', doc: before }, before), /unrecognised/);
});

test('a clean plan: nothing applied, nothing held', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 100, 0, 100, 100), hall('h', 0, 100, 300, 30), door('d', 0, 110, 0, 120)], floor };
  const r = autoFixAll(doc);
  assert.equal(r.applied.length, 0);
  assert.equal(r.held.length, 0);
  assert.equal(r.doc, doc);
});

test('empty and broken docs do not throw; input is never mutated; deterministic', () => {
  assert.deepEqual(autoFixAll({ items: [] }).applied, []);
  assert.doesNotThrow(() => autoFixAll({}));
  assert.doesNotThrow(() => autoFixAll(null));
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 95, 0, 100, 100)], floor };
  const copy = JSON.stringify(doc);
  const r1 = autoFixAll(doc), r2 = autoFixAll(doc);
  assert.equal(JSON.stringify(doc), copy);
  assert.equal(JSON.stringify(r1.doc), JSON.stringify(r2.doc));
});

test('whatever is left after Fix all is explained: held fixes or manual notes', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('far', 2000, 2000, 100, 100), hall('h', 0, 100, 300, 30)], floor: { points: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]] } };
  const r = autoFixAll(doc);
  assert.ok(r.held.length > 0 || manualLeft(r.doc).length > 0, 'something explains the far room');
});
