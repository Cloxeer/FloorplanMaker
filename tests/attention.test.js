// attention.test.js
// The items outlined on the plan must be exactly the ones the "Worth a look" notes are about.

import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionTargets, roomsNotTouchingHall, unconnectedHalls, overlappingHalls } from '../js/model/attention.js';
import { docChecklistCodes } from '../js/view/panels/validation.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const codes = (doc) => new Set(docChecklistCodes(doc).map((c) => c.code));

test('a room away from every hallway is outlined, and the note exists', () => {
  const doc = { items: [hall('h1', 0, 100, 300, 30), room('a', 0, 0, 100, 100), room('far', 500, 500, 100, 100)], floor: null };
  assert.deepEqual(roomsNotTouchingHall(doc.items).map((r) => r.id), ['far']);
  assert.ok(codes(doc).has('room-not-touching-hall'));
  assert.ok(attentionTargets(doc, []).has('far'));
  assert.ok(!attentionTargets(doc, []).has('a'));
});

test('separate hallway groups: the smaller group is outlined', () => {
  const doc = { items: [hall('h1', 0, 0, 300, 30), hall('h2', 300, 0, 200, 30), hall('lost', 0, 400, 200, 30)], floor: null };
  assert.deepEqual(unconnectedHalls(doc).map((h) => h.id), ['lost']);
  assert.ok(codes(doc).has('hall-unconnected'));
  assert.ok(attentionTargets(doc, []).has('lost'));
});

test('overlapping hallways are outlined', () => {
  const doc = { items: [hall('a', 0, 0, 300, 30), hall('b', 100, 10, 300, 30)], floor: null };
  assert.deepEqual(overlappingHalls(doc.items).map((h) => h.id).sort(), ['a', 'b']);
  assert.ok(codes(doc).has('hall-overlap'));
});

test('validation results with an itemId are outlined; errors are marked as errors', () => {
  const doc = { items: [room('r1', 0, 0, 10, 10), room('r2', 20, 0, 10, 10)] };
  const t = attentionTargets(doc, [{ level: 'warning', code: 'room-no-number', message: 'no number', itemId: 'r1' }, { level: 'error', code: 'x', message: 'bad', itemId: 'r2' }]);
  assert.equal(t.get('r1').level, 'warning');
  assert.equal(t.get('r2').level, 'error');
});

test('nothing is flagged on a tidy plan', () => {
  const door = { id: 'd', type: 'door', x1: 0, y1: 115, x2: 0, y2: 125, kind: 'EXIT' };
  const doc = { items: [hall('h', 0, 100, 300, 30), room('a', 0, 0, 100, 100), room('b', 100, 0, 100, 100), door], floor: null };
  assert.equal(attentionTargets(doc, []).size, 0);
});

test('polygon rooms count as touching with few AND with many hallways (same rule as the checklist)', () => {
  const poly = { id: 'p', type: 'room', cls: 'room', shape: 'poly', points: [[0, 0], [50, 0], [50, 50], [0, 50]], number: '101', name: '' };
  const few = { items: [poly, hall('h0', 900, 900, 100, 30)] };
  const many = { items: [poly, ...Array.from({ length: 30 }, (_, i) => hall('h' + i, 900 + i * 200, 900, 100, 30))] };
  assert.equal(roomsNotTouchingHall(few.items).length, 0);
  assert.equal(roomsNotTouchingHall(many.items).length, 0);
});
