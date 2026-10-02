// fixnumbers.test.js
// Pure tests for the staged "fill in the missing room number" proposals.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findNumberFixes, findManualNumbers } from '../js/model/fixNumbers.js';

const room = (id, x, y, w, h, number) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '' });
const row = (list, y = 0, w = 100, h = 80, id = 'r') => list.map((n, i) => room(`${id}${i}`, i * (w + 4), y, w, h, n));
const col = (list, x = 0, w = 80, h = 100) => list.map((n, i) => room(`c${i}`, x, i * (h + 4), w, h, n));
const apply = (doc) => { let d = doc; for (let g = 0; g < 50; g++) { const f = findNumberFixes(d); if (!f.length) break; d = f[0].doc; } return d; };
const nums = (doc) => doc.items.map((i) => i.number);
const one = (items) => { const f = findNumberFixes({ items }); assert.equal(f.length, 1); return f[0]; };

test('letter run: 128B 128C [?] 128E -> 128D, skipping I and O', () => {
  const f = one(row(['128B', '128C', '', '128E']));
  assert.deepEqual(nums(f.doc), ['128B', '128C', '128D', '128E']);
  assert.deepEqual(f.ids, ['r2']);
  assert.match(f.notes[0], /between 128C and 128E becomes 128D/);
  assert.equal(f.kind, 'number');
  assert.equal(f.key, 'number:r2');
  assert.equal(one(row(['128H', '', '128K'])).doc.items[1].number, '128J');
  assert.equal(one(row(['128N', '', '128Q'])).doc.items[1].number, '128P');
  // N and P are neighbours (no O): nothing fits between them
  assert.equal(findNumberFixes({ items: row(['128N', '', '128P']) }).length, 0);
});

test('numeric steps 1, 2, 5, 10, keeps prefix and leading zeros', () => {
  assert.equal(one(row(['124', '', '128'])).doc.items[1].number, '126');
  assert.equal(one(row(['101', '', '103'])).doc.items[1].number, '102');
  assert.equal(one(row(['100', '', '110'])).doc.items[1].number, '105');
  assert.equal(one(row(['100', '', '120'])).doc.items[1].number, '110');
  assert.equal(one(row(['S115', '', 'S117'])).doc.items[1].number, 'S116');
  assert.equal(one(row(['005', '', '009'])).doc.items[1].number, '007');
  assert.equal(one(row(['130', '', '126'])).doc.items[1].number, '128');
});

test('several consecutive blanks fill together in one fix', () => {
  const f = one(row(['128C', '', '', '128F']));
  assert.deepEqual(nums(f.doc), ['128C', '128D', '128E', '128F']);
  assert.equal(f.ids.length, 2);
  assert.equal(f.notes.length, 2);
  assert.deepEqual(nums(one(row(['101', '', '', '104'])).doc), ['101', '102', '103', '104']);
});

test('ambiguous or impossible gaps give no fix but a precise manual note', () => {
  const items = row(['128B', '', '128E']);
  assert.equal(findNumberFixes({ items }).length, 0);
  const m = findManualNumbers({ items });
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].ids, ['r1']);
  assert.match(m[0].message, /neighbours 128B and 128E leave 128C or 128D, type it yourself/);
  for (const l of [['124', '', '129'], ['128B', '', '128C'], ['128C', '', '128B'], ['A101', '', 'B103'], ['128B', '', '129C']]) {
    assert.equal(findNumberFixes({ items: row(l) }).length, 0, l.join());
    assert.equal(findManualNumbers({ items: row(l) }).length, 1, l.join());
  }
});

test('one neighbour only is not enough', () => {
  const items = row(['128B', '128C', '']);
  assert.equal(findNumberFixes({ items }).length, 0);
  const m = findManualNumbers({ items });
  assert.equal(m.length, 1);
  assert.match(m[0].message, /only one neighbour \(128C\)/);
  assert.equal(findNumberFixes({ items: row(['', '128C', '128D']) }).length, 0);
});

test('never makes a duplicate: a number used elsewhere blocks the fix', () => {
  const items = [...row(['128B', '128C', '', '128E']), room('x', 0, 500, 50, 50, '128D')];
  assert.equal(findNumberFixes({ items }).length, 0);
  const m = findManualNumbers({ items });
  assert.equal(m.length, 1);
  assert.match(m[0].message, /128D is already used/);
});

test('edge cases: empty, no rooms, one room, all numbered, none numbered', () => {
  const docs = [null, undefined, {}, { items: [] }, { items: [room('a', 0, 0, 10, 10, '')] },
    { items: row(['101', '102', '103', '104']) }, { items: row(['', '', '', '']) }];
  for (const d of docs) {
    assert.deepEqual(findNumberFixes(d), []);
    // a room that stays blank is never silent: one Manual that names it (the "else" case)
    const blanks = ((d && d.items) || []).filter((i) => !i.number).map((i) => i.id);
    assert.deepEqual(findManualNumbers(d).flatMap((m) => m.ids), blanks);
  }
});

test('voids and halls are never numbered and are not neighbours', () => {
  const items = row(['101', '', '103']);
  items[1].cls = 'void';
  assert.equal(findNumberFixes({ items }).length, 0);
  const items2 = [room('a', 0, 0, 100, 80, '101'), { ...room('h', 104, 0, 100, 80, ''), cls: 'hall' }, room('b', 208, 0, 100, 80, '102'), room('c', 312, 0, 100, 80, '103')];
  assert.equal(findNumberFixes({ items: items2 }).length, 0);
});

test('both sides of a corridor are separate runs (odd / even)', () => {
  const top = row(['101', '', '105'], 0, 100, 80, 't');
  const bottom = row(['102', '104', '106'], 200, 100, 80, 'b');
  const f = findNumberFixes({ items: [...top, ...bottom] });
  assert.equal(f.length, 1);
  assert.equal(f[0].doc.items[1].number, '103');
  // top 101 [?] 104 does not fit a step; the other side must not rescue it
  const f2 = findNumberFixes({ items: [...row(['101', '', '104'], 0, 100, 80, 't'), ...row(['102', '103', '105'], 200, 100, 80, 'b')] });
  assert.equal(f2.length, 0);
});

test('rotated plan: a column works the same as a row', () => {
  assert.equal(one(col(['128B', '128C', '', '128E'])).doc.items[2].number, '128D');
  assert.equal(one(col(['124', '', '128'])).doc.items[1].number, '126');
});

test('tolerates small misalignment and very different sizes in a row', () => {
  const items = row(['128B', '', '128D']);
  items[0].y = 6; items[2].y = -7; items[1].h = 70;
  assert.equal(one(items).doc.items[1].number, '128C');
  const mixed = [room('a', 0, 0, 40, 200, '101'), room('b', 44, 60, 300, 80, ''), room('c', 348, 70, 60, 60, '103')];
  assert.equal(findNumberFixes({ items: mixed }).length, 1);
});

test('polygon rooms use their bounding box', () => {
  const items = row(['128B', '', '128D']);
  items[1] = { id: 'p', type: 'room', cls: 'room', shape: 'poly', number: '', name: '', points: [[104, 0], [204, 0], [204, 40], [150, 80], [104, 80]] };
  const f = one(items);
  assert.equal(f.doc.items[1].number, '128C');
  assert.equal(f.doc.items[1].shape, 'poly');
});

test('a gap too large breaks a run', () => {
  const items = [room('a', 0, 0, 100, 80, '101'), room('b', 104, 0, 100, 80, '102'), room('c', 1000, 0, 100, 80, ''), room('d', 1104, 0, 100, 80, '104')];
  assert.equal(findNumberFixes({ items }).length, 0);
});

test('obvious slip: a duplicate or invalid number pinned by both neighbours is corrected', () => {
  const f = one(row(['128B', '128C', '128C', '128E']));
  assert.equal(f.doc.items[2].number, '128D');
  assert.deepEqual(f.ids, ['r2']);
  assert.equal(one(row(['101', '102', '102', '104'])).doc.items[2].number, '103');
  assert.equal(one(row(['128B', '128C', '12?8', '128E'])).doc.items[2].number, '128D');
});

test('a different valid number is left alone; a slip never creates a duplicate', () => {
  assert.equal(findNumberFixes({ items: row(['128B', '128C', '128H', '128E']) }).length, 0);
  assert.equal(findNumberFixes({ items: row(['101', '102', '110', '104']) }).length, 0);
  const items = [...row(['128B', '128C', '128C', '128E']), room('x', 0, 500, 50, 50, '128D')];
  assert.equal(findNumberFixes({ items }).length, 0);
});

test('does not mutate the input and is idempotent', () => {
  const doc = { items: row(['128B', '', '', '128E', '', '128G']), extra: 1 };
  const snap = JSON.stringify(doc);
  const fixes = findNumberFixes(doc);
  assert.equal(JSON.stringify(doc), snap);
  assert.ok(fixes.length);
  assert.notEqual(fixes[0].doc, doc);
  assert.equal(fixes[0].doc.extra, 1);
  const done = apply(doc);
  assert.deepEqual(nums(done), ['128B', '128C', '128D', '128E', '128F', '128G']);
  assert.deepEqual(findNumberFixes(done), []);
  assert.deepEqual(findManualNumbers(done), []);
});

test('Hardman & Jacobs top row with blanks fills to the true numbers', () => {
  const top = ['128B', '128C', '', '128E', '128F', '128G', '', '128J', '128K', '128L'];
  assert.deepEqual(nums(apply({ items: row(top) })), ['128B', '128C', '128D', '128E', '128F', '128G', '128H', '128J', '128K', '128L']);
});

test('huge doc: 2000 rooms in under 300 ms', () => {
  const items = [];
  for (let r = 0; r < 100; r++) for (let c = 0; c < 20; c++) items.push(room(`q${r}_${c}`, c * 104, r * 200, 100, 80, c % 5 === 2 ? '' : String.fromCharCode(65 + (r % 26)) + String(100 + Math.floor(r / 26) * 20 + c)));  // A100.. (3 digits: the studio's own number form)
  const t = Date.now();
  const f = findNumberFixes({ items });
  findManualNumbers({ items });
  const ms = Date.now() - t;
  assert.ok(ms < 300, `${ms} ms`);
  assert.ok(f.length > 0);
});
