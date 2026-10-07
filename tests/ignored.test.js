// ignored.test.js
// "Ignore": problems the person leaves alone are left out of the lists, the export check, the outlines and Fix all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { noteGroups } from '../js/model/noteGroups.js';
import { validate } from '../js/model/validate.js';
import { docChecklistCodes } from '../js/view/panels/validation.js';
import { applyIgnores, ignoredIds, pruneIgnored } from '../js/model/ignored.js';
import { attentionTargets } from '../js/model/attention.js';
import { nextFix, manualLeft } from '../js/model/fixNotes.js';
import { autoFixAll } from '../js/model/fixAuto.js';

const room = (id, x, y, w, h, number = id) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '', label: { pinned: false, x: null, y: null, fontSize: null } });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const results = (doc) => validate(doc).concat(docChecklistCodes(doc));
const blank = () => ({ items: [room('a', 0, 0, 100, 100, ''), room('b', 300, 0, 100, 100, ''), room('c', 0, 200, 100, 100, ''), room('ok', 100, 0, 100, 100, '101')], floor: null });

test('ignored stops leave their group, the count follows, and mode "ignored" lists only them', () => {
  const doc = blank(), ign = new Set(['b']);
  const act = noteGroups(doc, results(doc), ign).find((x) => x.kind === 'number');
  assert.equal(act.count, 2);
  assert.match(act.title, /^2 rooms need a number$/);
  assert.deepEqual(act.stops.map((s) => s.ids[0]), ['a', 'c']);
  const only = noteGroups(doc, results(doc), ign, 'ignored').find((x) => x.kind === 'number');
  assert.match(only.title, /^1 room needs a number$/);
  assert.deepEqual(only.stops.map((s) => s.ids[0]), ['b']);
  assert.equal(noteGroups(doc, results(doc), new Set(['a', 'b', 'c'])).find((x) => x.kind === 'number'), undefined, 'a group with everything ignored is gone');
});

test('ignored items drop out of the results; an error that was ignored no longer blocks', () => {
  const doc = blank();
  doc.items.push({ id: 'dup', type: 'room', cls: 'room', shape: 'rect', x: 500, y: 0, w: 100, h: 100, number: '101', name: '', label: {} });
  const all = results(doc);
  const dupErr = all.filter((r) => r.code === 'duplicate-number');
  assert.ok(dupErr.length > 0);
  const kept = applyIgnores(doc, all, new Set(dupErr.map((r) => r.itemId)));
  assert.ok(!kept.some((r) => r.code === 'duplicate-number'));
  assert.equal(applyIgnores(doc, all, new Set()), all, 'nothing ignored: the same list');
});

test('hallway notes without an item go when every hallway they are about is ignored', () => {
  const doc = { items: [hall('h1', 0, 0, 200, 40), hall('h2', 400, 0, 200, 40), room('r', 0, 100, 100, 100, '101')], floor: null };
  const all = results(doc);
  assert.ok(all.some((r) => r.code === 'hall-unconnected'));
  assert.ok(!applyIgnores(doc, all, new Set(['h1', 'h2'])).some((r) => r.code === 'hall-unconnected'));
  assert.ok(applyIgnores(doc, all, new Set(['h1'])).some((r) => r.code === 'hall-unconnected'), 'only one of the two ignored: still a note');
});

test('outlines and Fix all leave ignored items alone', () => {
  const doc = { items: [room('A', 0, 0, 100, 100), room('B', 90, 0, 100, 100), room('C', 600, 0, 100, 100), room('D', 650, 10, 100, 100)], floor: null };
  assert.ok(attentionTargets(doc, validate(doc)).has('A'));
  assert.ok(!attentionTargets(doc, validate(doc), new Set(['A'])).has('A'));
  const ign = new Set(['A', 'B']);
  const f = nextFix(doc, new Set(), { ignoredIds: ign });
  assert.ok(!f || !f.ids.every((i) => ign.has(i)), 'no fix is for the ignored overlap only');
  const r = autoFixAll(doc, { ignoredIds: ign });
  const byId = (d, id) => d.items.find((i) => i.id === id);
  assert.deepEqual([byId(r.doc, 'A').x, byId(r.doc, 'A').w, byId(r.doc, 'B').x, byId(r.doc, 'B').w], [0, 100, 90, 100], 'the ignored rooms were not trimmed');
  assert.ok(manualLeft(doc, ign).every((m) => !m.ids.length || !m.ids.every((i) => ign.has(i))));
});

test('the project keeps the ignored ids; ones that left the plan are forgotten', () => {
  const doc = blank();
  assert.deepEqual([...ignoredIds({ ignored: ['a', 'gone', 5] })].sort(), ['a', 'gone']);
  assert.deepEqual([...pruneIgnored(doc, new Set(['a', 'gone']))], ['a']);
  assert.equal(ignoredIds({}).size, 0);
});
