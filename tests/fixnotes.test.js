// fixnotes.test.js
// The aggregator behind "Fix these": priority order, skipping, termination, manual leftovers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFix, manualLeft, fixAll } from '../js/model/fixNotes.js';

const room = (id, x, y, w, h, number = id, extra = {}) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '', label: { pinned: false, x: null, y: null, fontSize: null }, ...extra });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const mk = (items) => ({ floor: { points: [[0, 0], [1000, 0], [1000, 600], [0, 600]] }, items });
const kinds = (doc, skipped = new Set()) => { const f = nextFix(doc, skipped); return f && f.kind; };

const overlapItems = () => [room('201', 0, 300, 100, 100), room('202', 95, 300, 100, 100)];
const labelItems = () => [room('301', 400, 300, 100, 100, '301', { label: { pinned: true, x: 900, y: 500, fontSize: null } })];
const numberItems = () => ['128B', '128C', '', '128E'].map((n, i) => room(`n${i}`, i * 104, 100, 100, 80, n));
const hallItems = () => [hall('ha', 0, 190, 150, 20), hall('hb', 200, 190, 150, 20)];

test('nothing to fix -> null; empty or broken docs -> null', () => {
  const clean = mk([hall('h', 0, 182, 400, 20), room('101', 0, 100, 100, 80), room('102', 110, 100, 100, 80)]);
  assert.equal(nextFix(clean, new Set()), null);
  assert.deepEqual(manualLeft(clean), []);
  assert.equal(nextFix(null, new Set()), null);
  assert.equal(nextFix({}, new Set()), null);
  assert.equal(nextFix(mk([]), new Set()), null);
  assert.deepEqual(manualLeft(null), []);
});

test('every kind is offered, in priority order', () => {
  assert.equal(kinds(mk([...overlapItems(), ...labelItems(), ...numberItems(), ...hallItems()])), 'overlap');
  assert.equal(kinds(mk([...labelItems(), ...numberItems(), ...hallItems()])), 'label');
  assert.equal(kinds(mk([...numberItems(), ...hallItems()])), 'number');
  const h = nextFix(mk([...hallItems()]), new Set());
  assert.ok(h && /hall|room/.test(h.kind));
  // each fix has the full contract and really changes the doc
  const doc = mk([...overlapItems(), ...labelItems(), ...numberItems(), ...hallItems()]);
  const f = nextFix(doc, new Set());
  assert.ok(f.key.startsWith('overlap:') && f.title && Array.isArray(f.notes) && f.ids.length && f.doc);
  assert.notDeepEqual(f.doc, doc);
});

test('a skipped key never comes back; skipping everything ends in null', () => {
  const doc = mk([...overlapItems(), ...labelItems(), ...numberItems(), ...hallItems()]);
  const skipped = new Set(), seen = [];
  for (let i = 0; i < 20; i++) {
    const f = nextFix(doc, skipped);
    if (!f) break;
    assert.ok(!skipped.has(f.key));
    seen.push(f.kind);
    skipped.add(f.key);
  }
  assert.equal(nextFix(doc, skipped), null);
  assert.ok(seen.indexOf('overlap') < seen.indexOf('label') && seen.indexOf('label') < seen.indexOf('number'));
  assert.ok(seen.length >= 4);
});

test('re-evaluates after each applied fix with the new doc', () => {
  let doc = mk([...overlapItems(), ...labelItems(), ...numberItems()]);
  const order = [];
  for (let i = 0; i < 10; i++) {
    const f = nextFix(doc, new Set());
    if (!f) break;
    order.push(f.kind);
    doc = f.doc;
  }
  assert.deepEqual(order.slice(0, 3), ['overlap', 'label', 'number']);
  assert.equal(order.filter((k) => k === 'overlap').length, 1);
});

test('a fix that would not change the doc is never returned (accepts a plain array of skipped keys)', () => {
  const doc = mk([...labelItems()]);
  const f = nextFix(doc, []);
  assert.ok(f);
  assert.equal(nextFix(f.doc, new Set()), null);
});

test('manualLeft combines every source', () => {
  const inside = [room('401', 600, 300, 200, 200), room('402', 650, 350, 50, 50)]; // contained: cannot be fixed
  const noNumber = [room('r1', 0, 0, 90, 80, '128B'), room('r2', 94, 0, 90, 80, ''), room('r3', 188, 0, 90, 80, '128K')]; // 128B..128K: ambiguous
  const void1 = { ...room('v', 800, 100, 50, 50, '204'), cls: 'void' };
  const m = manualLeft(mk([...inside, ...noNumber, void1]));
  const ids = new Set(m.flatMap((x) => x.ids));
  assert.ok(ids.has('401') || ids.has('402'), 'overlap left over');
  assert.ok(ids.has('v'), 'void with a number');
  assert.ok(m.every((x) => typeof x.message === 'string' && x.message && Array.isArray(x.ids)));
});

test('a full loop on a messy doc terminates with only manual items left', () => {
  const messy = mk([
    ...overlapItems(), ...labelItems(), ...numberItems(), ...hallItems(),
    room('401', 600, 300, 200, 200), room('402', 650, 350, 50, 50),
    { ...room('v', 800, 100, 50, 50, '204'), cls: 'void' },
  ]);
  const before = JSON.stringify(messy);
  const r = fixAll(messy);
  assert.equal(JSON.stringify(messy), before, 'input untouched');
  assert.ok(r.applied.length >= 4 && r.applied.length < 100);
  assert.equal(nextFix(r.doc, new Set()), null);
  assert.ok(r.manual.length >= 1);
  const again = fixAll(r.doc);
  assert.equal(again.applied.length, 0, 'idempotent');
});

test('the loop is capped', () => {
  const r = fixAll(mk([...overlapItems(), ...labelItems(), ...numberItems()]), { maxSteps: 1 });
  assert.equal(r.applied.length, 1);
});
