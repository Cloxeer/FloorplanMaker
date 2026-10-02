// notegroups.test.js
// The "Worth a look" notes regrouped into walkable stops.

import test from 'node:test';
import assert from 'node:assert/strict';
import { noteGroups, boxOfIds } from '../js/model/noteGroups.js';
import { validate } from '../js/model/validate.js';
import { docChecklistCodes } from '../js/view/panels/validation.js';

const room = (id, x, y, w, h, number = id) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '', label: { pinned: false, x: null, y: null, fontSize: null } });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const results = (doc) => validate(doc).concat(docChecklistCodes(doc));

test('rooms without a number become one group with a stop per room, in reading order', () => {
  const doc = { items: [room('b', 300, 0, 100, 100, ''), room('a', 0, 0, 100, 100, ''), room('c', 0, 200, 100, 100, ''), room('ok', 100, 0, 100, 100, '101')], floor: null };
  const g = noteGroups(doc, results(doc)).find((x) => x.kind === 'number');
  assert.ok(g, 'a number group exists');
  assert.equal(g.count, 3);
  assert.match(g.title, /^3 rooms need a number$/);
  assert.deepEqual(g.stops.map((s) => s.ids[0]), ['a', 'b', 'c']);
});

test('overlapping rooms come as clusters, one stop each', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), room('C', 600, 0, 100, 100), room('D', 650, 10, 100, 100)], floor: null };
  const g = noteGroups(doc, results(doc)).find((x) => x.kind === 'overlap');
  assert.equal(g.stops.length, 2);
  assert.ok(g.stops.every((s) => s.cluster && s.ids.length === 2));
});

test('hallway notes name the right items even though validation gives no item id', () => {
  const doc = { items: [hall('h1', 0, 0, 300, 30), hall('lost', 0, 400, 200, 30), room('far', 900, 900, 100, 100)], floor: null };
  const groups = noteGroups(doc, results(doc));
  assert.deepEqual(groups.find((x) => x.kind === 'hall').stops.map((s) => s.ids[0]), ['lost']);
  assert.ok(groups.find((x) => x.kind === 'room-hall').stops.some((s) => s.ids[0] === 'far'));
});

test('a clean plan, an empty plan and junk give no groups and never throw', () => {
  const door = { id: 'd', type: 'door', x1: 0, y1: 115, x2: 0, y2: 125, kind: 'EXIT', label: { x: 20, y: 120 } };
  const clean = { items: [hall('h', 0, 100, 300, 30), room('a', 0, 0, 100, 100, '101'), room('b', 100, 0, 100, 100, '102'), door], floor: null };
  assert.deepEqual(noteGroups(clean, results(clean)).filter((g) => g.kind !== 'door'), []);
  assert.deepEqual(noteGroups({ items: [] }, []), []);
  assert.deepEqual(noteGroups(null, null), []);
  assert.doesNotThrow(() => noteGroups({ items: [null, { type: 'room' }] }, [{ code: 'room-no-number', itemId: 'zzz' }]));
});

test('boxOfIds is the box around the items (and null when none exist)', () => {
  const doc = { items: [room('a', 10, 20, 100, 50), room('b', 200, 100, 40, 40)] };
  assert.deepEqual(boxOfIds(doc, ['a', 'b']), { x: 10, y: 20, w: 230, h: 120 });
  assert.equal(boxOfIds(doc, ['nope']), null);
});
