// fixqa.test.js
// Adversarial QA of the whole Fix flow (js/model/fixNotes.js): seeded fuzz with invariants, hand-made edge
// cases and the "else" rule (what cannot be fixed ends as a Manual with a message, never silently).
// Invariants live in tools/fixqa-lib.mjs. The poster test needs the photos: set AUTOBUILD_PNG_DIR (a folder
// with all/*.png) to run it, otherwise it is skipped. Run `node tools/fixqa-posters.mjs` for the full report.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixAll, nextFix, manualLeft } from '../js/model/fixNotes.js';
import { checkFix, smoke } from '../tools/fixqa-lib.mjs';
import { genDoc } from './fixqa.helpers.js';

const room = (id, x, y, w, h, number = '', extra = {}) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number, name: '', label: { pinned: false, x: null, y: null, fontSize: null }, ...extra });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const floor = { points: [[0, 0], [1000, 0], [1000, 600], [0, 600]] };
const row = (nums, y = 100, w = 100, h = 80, p = 'r') => nums.map((n, i) => room(p + i, i * 104, y, w, h, n));
const H = () => [hall('h', 0, 182, 600, 20)];
const numsOf = (doc) => doc.items.filter((i) => i.type === 'room').map((i) => i.number || '_').join(' ');
const run = (items) => fixAll({ floor, items });

test('fuzz: 500 well-formed random plans keep every invariant', () => {
  const bad = [];
  for (let s = 1; s <= 500; s++) {
    const q = checkFix(genDoc(s, 'sane'), { maxMs: 3000 });
    if (q.violations.length) bad.push(`seed ${s}: ${q.violations.slice(0, 3).join('; ')}`);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test('fuzz: 300 junk plans (zero sizes, NaN, missing fields, huge coordinates) never throw or misbehave', () => {
  const bad = [];
  for (let s = 1; s <= 300; s++) {
    const v = smoke(genDoc(s, 'nasty'));
    if (v.length) bad.push(`seed ${s}: ${v[0]}`);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test('numbers: letter runs skip I and O, several blanks fill, ambiguous ones are Manual', () => {
  assert.equal(numsOf(run([...row(['128G', '', '128J']), ...H()]).doc), '128G 128H 128J');
  assert.equal(numsOf(run([...row(['128H', '', '', '128L']), ...H()]).doc), '128H 128J 128K 128L');
  assert.equal(numsOf(run([...row(['101', '', '', '', '105']), ...H()]).doc), '101 102 103 104 105');
  assert.equal(numsOf(run([...row(['101', '', '', '', '109']), ...H()]).doc), '101 103 105 107 109');
  // N and P are neighbours in the alphabet once O is skipped: nothing fits between them
  const tight = run([...row(['128N', '', '128P']), ...H()]);
  assert.equal(numsOf(tight.doc), '128N _ 128P');
  assert.ok(tight.manual.some((m) => m.ids.includes('r1') && /no room/.test(m.message)));
  const odd = run([...row(['101', '', '', '', '110']), ...H()]);
  assert.equal(odd.manual.filter((m) => /steady step/.test(m.message)).length, 3);
});

test('numbers: never reuse a number, mix prefixes or invent a form the studio rejects', () => {
  const used = run([...row(['201', '', '203']), room('x', 0, 400, 100, 80, '202'), ...H()]);
  assert.equal(used.doc.items.find((i) => i.id === 'r1').number, '');
  assert.ok(used.manual.some((m) => m.ids.includes('r1') && /already used/.test(m.message)));
  const mixed = run([...row(['R101', '', '103']), ...H()]);
  assert.equal(mixed.doc.items.find((i) => i.id === 'r1').number, '');
  assert.ok(mixed.manual.some((m) => m.ids.includes('r1')));
  // four digits are not a room number here (validate: bad-number-format), so no fill may produce one
  const four = run([...row(['1000', '', '1002']), ...H()]);
  assert.equal(four.doc.items.find((i) => i.id === 'r1').number, '');
  assert.ok(four.manual.some((m) => m.ids.includes('r1')));
  assert.equal(numsOf(run([...row(['R101', '', 'R103']), ...H()]).doc), 'R101 R102 R103');
  assert.equal(numsOf(run([...row(['001', '', '003']), ...H()]).doc), '001 002 003');
});

test('numbers: blanks on both sides of a corridor fill each side on its own', () => {
  const top = row(['101', '', '105'], 100, 100, 80, 't'), bot = row(['102', '', '106'], 220, 100, 80, 'b');
  const r = run([...top, ...bot, hall('h', 0, 182, 400, 30)]);
  const n = (id) => r.doc.items.find((i) => i.id === id).number;
  assert.deepEqual([n('t1'), n('b1')], ['103', '104']);
});

test('else: a blank room nothing pins down is a Manual that names it', () => {
  const r = run([room('a', 0, 100, 100, 80, ''), room('b', 400, 100, 100, 80, ''), ...H()]);
  const m = r.manual.find((x) => /no number/.test(x.message));
  assert.ok(m && m.ids.includes('a') && m.ids.includes('b'));
  // numbers in a wrong form and numbers used twice are never silent either
  const odd = run([room('a', 0, 100, 100, 80, '12'), room('b', 110, 100, 100, 80, '103'), room('c', 220, 100, 100, 80, '103'), ...H()]);
  assert.ok(odd.manual.some((x) => x.ids.includes('a') && /usual form/.test(x.message)));
  assert.ok(odd.manual.some((x) => x.ids.includes('b') && x.ids.includes('c') && /103/.test(x.message)));
});

test('else: a note no module owns (a door with no label) still ends in the Needs-you list', () => {
  const doc = { floor, items: [...row(['101', '102']), ...H(), { id: 'd', type: 'door', x1: 0, y1: 100, x2: 0, y2: 140 }] };
  const m = manualLeft(doc);
  assert.ok(m.some((x) => x.ids.includes('d') && x.message.trim()));
});

test('halls: touching only at a corner, no hall at all, one room, nothing', () => {
  const corner = run([hall('a', 0, 100, 100, 20), hall('b', 100, 120, 20, 100), room('r', 0, 130, 90, 60, '101')]);
  assert.ok(corner.applied.length >= 1); // the room gets its hallway
  const none = run([room('a', 0, 0, 100, 100, '101'), room('b', 110, 0, 100, 100, '102')]);
  assert.equal(none.applied.length, 0);
  assert.ok(none.manual.some((m) => /no hallway/i.test(m.message) && m.ids.length === 2));
  assert.ok(run([room('a', 0, 0, 100, 100, '101')]).manual.length >= 1);
  for (const d of [{}, { items: [] }, { floor, items: undefined }, null, undefined]) {
    assert.deepEqual(fixAll(d).applied, []);
    assert.deepEqual(fixAll(d).manual, []);
    assert.equal(nextFix(d, new Set()), null);
  }
});

test('halls: never drawn through a room to reach another room (Manual instead)', () => {
  const items = [hall('h', 0, 200, 200, 20), room('r1', 220, 190, 100, 40, '101'), room('r2', 330, 190, 100, 40, '102')];
  const r = run(items);
  const h = r.doc.items.find((i) => i.id === 'h');
  assert.ok(h.x + h.w <= 330, `hall now ends at ${h.x + h.w}`);
  assert.ok(r.doc.items.filter((i) => i.type === 'hall').every((x) => x.x + x.w <= 330));
  assert.ok(r.manual.some((m) => m.ids.includes('r2') && m.message.trim()));
});

test('halls: a room enclosed by other rooms is reported, not linked through them', () => {
  const ring = [room('c', 100, 100, 100, 100, '111'), room('n', 100, 0, 100, 100, '112'), room('s', 100, 200, 100, 100, '113'), room('w', 0, 100, 100, 100, '114'), room('e', 200, 100, 100, 100, '115'), hall('h', 600, 100, 20, 200)];
  const r = run(ring);
  assert.ok(r.manual.some((m) => m.ids.includes('c') && /hallway/.test(m.message)));
  const hs = r.doc.items.filter((i) => i.type === 'hall');
  assert.ok(hs.every((x) => x.x >= 300 - 1 || x.x + x.w <= 0 || x.y >= 300)); // nothing cuts into the cluster
});

test('halls: merging two overlapping hallways never pushes the result outside the outline', () => {
  const items = [hall('a', 0, 0, 550, 20), hall('b', 400, 0, 20, 150), room('r', 100, 40, 100, 80, '101'), room('q', 210, 40, 100, 80, '102')];
  const r = fixAll({ floor: { points: [[0, 0], [550, 0], [550, 600], [0, 600]] }, items });
  for (const x of r.doc.items.filter((i) => i.type === 'hall')) assert.ok(x.x + x.w <= 551 && x.x >= -1);
});

test('duplicate or missing ids: nothing is changed, one Manual explains', () => {
  const items = [room('a', 0, 0, 100, 100, '101'), room('a', 200, 0, 100, 100, ''), hall('h', 0, 100, 400, 20)];
  const doc = { floor, items };
  assert.equal(nextFix(doc, new Set()), null);
  const m = manualLeft(doc);
  assert.equal(m.length, 1);
  assert.ok(m[0].ids.includes('a') && /share an id/.test(m[0].message));
  assert.equal(JSON.stringify(fixAll(doc).doc), JSON.stringify(doc));
});

test('huge coordinates and absurd sizes finish quickly and do not run out of memory', () => {
  const items = [...row(['101', '102', '103']), hall('h1', 0, 182, 600, 20), hall('far', 3e8, 1e9, 210, 40), room('big', 0, 0, 1e9, 1e9, '999')];
  const t = Date.now();
  const r = fixAll({ floor, items });
  assert.ok(Date.now() - t < 2000);
  assert.ok(Array.isArray(r.manual));
});

const POSTERS = process.env.AUTOBUILD_PNG_DIR && path.join(process.env.AUTOBUILD_PNG_DIR, 'all');
test('posters: every real plan keeps the invariants (needs AUTOBUILD_PNG_DIR)', { skip: !(POSTERS && fs.existsSync(POSTERS)) }, async () => {
  const { requireDeps, loadPng } = await import('../tools/autobuild-eval.mjs');
  const { rectify } = await import('../js/model/autobuild/rectify.js');
  const { buildFromPlan } = await import('../js/model/autobuild/pipeline.js');
  const deps = requireDeps();
  assert.ok(deps, 'pngjs not found: set TESS_NODE_MODULES');
  for (const f of fs.readdirSync(POSTERS).filter((x) => x.endsWith('.png'))) {
    const r = rectify(loadPng(deps.PNG, path.join(POSTERS, f)));
    const res = await buildFromPlan(r.image, { ocr: null });
    const q = checkFix({ items: res.items, floor: res.floor });
    assert.deepEqual(q.violations, [], f);
  }
});
