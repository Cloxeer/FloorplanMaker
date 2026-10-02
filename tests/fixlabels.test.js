// fixlabels.test.js
// Label fixes: unpin a label that sits outside / in another room, reset a tiny font, clear text on voids.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findLabelFixes, findManualLabels } from '../js/model/fixLabels.js';
import { validate } from '../js/model/validate.js';

const room = (id, x, y, w, h, extra = {}) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '', label: { pinned: false, x: null, y: null, fontSize: null }, ...extra });
const mk = (items) => ({ items, floor: { points: [[0, 0], [1000, 0], [1000, 800], [0, 800]] } });
const codes = (doc) => validate(doc).map((v) => v.code);
const apply = (doc, f) => f.doc;

test('a pinned label outside its room is unpinned back to the centre', () => {
  const doc = mk([room('101', 0, 0, 200, 100, { label: { pinned: true, x: 500, y: 500, fontSize: null } })]);
  assert.ok(codes(doc).includes('label-outside-shape'));
  const fixes = findLabelFixes(doc);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].kind, 'label');
  assert.deepEqual(fixes[0].ids, ['101']);
  const after = apply(doc, fixes[0]);
  assert.ok(!codes(after).includes('label-outside-shape'));
  assert.equal(after.items[0].label.pinned, false);
  assert.equal(findManualLabels(after).length, 0);
  assert.equal(findLabelFixes(after).length, 0);
});

test('a tiny font is reset', () => {
  const doc = mk([room('101', 0, 0, 200, 100, { label: { pinned: false, x: null, y: null, fontSize: 6 } })]);
  assert.ok(codes(doc).includes('label-tiny'));
  const [f] = findLabelFixes(doc);
  assert.ok(f);
  assert.equal(f.doc.items[0].label.fontSize, null);
  assert.ok(!codes(f.doc).includes('label-tiny'));
});

test('a label sitting in a smaller room moves to a spot of its own', () => {
  // big room with a small room in its middle: the centroid label lands in the small one
  const doc = mk([room('100', 0, 0, 300, 300), room('101', 120, 120, 60, 60)]);
  assert.ok(codes(doc).includes('label-in-other-room'));
  const fixes = findLabelFixes(doc);
  assert.equal(fixes.length, 1);
  assert.deepEqual(fixes[0].ids, ['100']);
  const after = fixes[0].doc;
  assert.ok(!codes(after).includes('label-in-other-room'));
  assert.ok(!codes(after).includes('label-outside-shape'));
  assert.equal(after.items[0].label.pinned, true);
  assert.equal(doc.items[0].label.pinned, false, 'input doc is not mutated');
});

test('an unfixable label is reported as manual', () => {
  // the whole big room is covered by smaller rooms
  const doc = mk([room('100', 0, 0, 100, 100), room('101', 0, 0, 100, 50), room('102', 0, 50, 100, 50)]);
  assert.equal(findLabelFixes(doc).filter((f) => f.ids[0] === '100').length, 0);
  assert.ok(findManualLabels(doc).some((m) => m.ids[0] === '100' && m.message));
});

test('a void with free text is cleared; one with a number is manual', () => {
  const v1 = { ...room('v1', 0, 0, 100, 100), cls: 'void', number: '', name: 'Open' };
  const v2 = { ...room('v2', 200, 0, 100, 100), cls: 'void', number: '204', name: '' };
  const doc = mk([v1, v2]);
  assert.ok(codes(doc).includes('void-with-label'));
  const fixes = findLabelFixes(doc);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].kind, 'void-label');
  assert.equal(fixes[0].doc.items[0].name, '');
  assert.deepEqual(findManualLabels(doc).map((m) => m.ids[0]), ['v2']);
});

test('clean doc: nothing to do; keys are stable and unique', () => {
  const clean = mk([room('101', 0, 0, 200, 100), room('102', 300, 0, 200, 100)]);
  assert.deepEqual(findLabelFixes(clean), []);
  assert.deepEqual(findManualLabels(clean), []);
  const bad = mk([room('101', 0, 0, 200, 100, { label: { pinned: true, x: 900, y: 700, fontSize: 4 } }), room('102', 300, 0, 200, 100, { label: { pinned: true, x: 900, y: 700, fontSize: null } })]);
  const keys = findLabelFixes(bad).map((f) => f.key);
  assert.equal(new Set(keys).size, 2);
  assert.deepEqual(keys, findLabelFixes(bad).map((f) => f.key));
  assert.deepEqual(findLabelFixes(null), []);
  assert.deepEqual(findLabelFixes({}), []);
});
