// fixhalls.test.js
// Staged hallway fixes: overlaps merge/trim, cut-off groups get joined (extend or connector / L),
// rooms get a hallway; never mutates, stays on the 5-grid / integers, inside the outline, idempotent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findHallFixes, findManualHalls } from '../js/model/fixHalls.js';
import { overlappingHalls, unconnectedHalls, roomsNotTouchingHall } from '../js/model/attention.js';

const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const box = [[0, 0], [500, 0], [500, 400], [0, 400]];
const mk = (items, pts = box) => ({ floor: pts ? { points: pts } : undefined, items });
const notes = (d) => ({ ov: overlappingHalls(d.items).length, un: unconnectedHalls(d).length, rm: roomsNotTouchingHall(d.items).length });
const halls = (d) => d.items.filter((i) => i.type === 'hall');
const applyAll = (doc, kind) => {
  let d = doc;
  for (let g = 0; g < 60; g++) {
    const f = findHallFixes(d).filter((x) => !kind || x.kind === kind);
    if (!f.length) break;
    d = f[0].doc;
  }
  return d;
};
const insideBox = (d) => halls(d).every((h) => h.x >= -2 && h.y >= -2 && h.x + h.w <= 502 && h.y + h.h <= 402);

test('no halls: manual, no fixes, no throw', () => {
  const d = mk([room('101', 10, 10, 50, 50)]);
  assert.deepEqual(findHallFixes(d), []);
  assert.match(findManualHalls(d)[0].message, /Draw a hallway first|no hallway/i);
  assert.deepEqual(findHallFixes({}), []);
  assert.deepEqual(findHallFixes(null), []);
});

test('one hallway reaching the outline: nothing to do', () => {
  const d = mk([hall('a', 0, 100, 200, 20)]);
  assert.deepEqual(findHallFixes(d), []);
});

test('collinear gap: the nearer end is extended, widths kept, grid kept', () => {
  const d = mk([hall('a', 0, 100, 150, 20), hall('b', 200, 100, 100, 20)]);
  const before = JSON.stringify(d);
  const [f] = findHallFixes(d);
  assert.equal(JSON.stringify(d), before);
  assert.equal(f.doc.items.length, 2);
  assert.equal(notes(f.doc).un, 0);
  assert.ok(halls(f.doc).every((h) => h.h === 20 && h.x % 5 === 0 && h.w % 5 === 0));
  assert.ok(f.key && f.title && f.notes.length && f.ids.length);
});

test('perpendicular facing: the hallway reaches a few units into the other', () => {
  const d = mk([hall('a', 100, 0, 20, 300), hall('b', 200, 180, 100, 20)]);
  const [f] = findHallFixes(d);
  assert.equal(f.doc.items.length, 2);
  assert.equal(notes(f.doc).un, 0);
  const b = f.doc.items.find((i) => i.id === 'b');
  assert.ok(b.x < 120 && b.x + b.w >= 120 && b.x <= 115);
});

test('corner-only proximity (no shared edge) counts as unconnected and is fixed', () => {
  const d = mk([hall('a', 0, 100, 100, 20), hall('b', 105, 125, 20, 100)]);
  assert.equal(notes(d).un, 1);
  assert.equal(notes(applyAll(d)).un, 0);
});

test('diagonal gap: one connector or an L, never outside the outline', () => {
  const d = mk([hall('a', 0, 100, 100, 20), hall('b', 300, 250, 100, 20)]);
  const r = applyAll(d);
  assert.equal(notes(r).un, 0);
  assert.ok(insideBox(r));
  assert.ok(halls(r).length <= 4);
  assert.ok(halls(r).every((h) => [h.x, h.y, h.w, h.h].every(Number.isInteger)));
});

test('outline forbids the straight link: other route or manual, never outside', () => {
  const pts = [[0, 0], [500, 0], [500, 100], [300, 100], [300, 400], [0, 400]];
  const d = mk([hall('a', 0, 20, 150, 20), hall('b', 350, 20, 100, 20), hall('c', 20, 200, 20, 150)], pts);
  const r = applyAll(d);
  for (const h of halls(r)) {
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    assert.ok(!(cx > 300 && cy > 100), 'centre in the cut-out corner');
  }
  assert.ok(notes(r).un <= notes(d).un);
});

test('lone network that never reaches an anchor is extended to the outline', () => {
  const d = mk([hall('a', 100, 100, 200, 20)]);
  assert.equal(notes(d).un, 1);
  const r = applyAll(d);
  assert.equal(notes(r).un, 0);
  assert.equal(halls(r).length, 1);
});

test('lone network with no anchors at all: manual', () => {
  const d = mk([hall('a', 100, 100, 200, 20)], null);
  assert.deepEqual(findHallFixes(d), []);
  assert.equal(findManualHalls(d).length, 1);
});

test('doc without floor still joins hallways', () => {
  const d = mk([hall('a', 0, 100, 150, 20), hall('b', 200, 100, 100, 20), { id: 's', type: 'stair', x: 0, y: 100, w: 20, h: 20 }], null);
  assert.equal(notes(applyAll(d)).un, 0);
});

test('a link avoids swallowing a room when another way exists', () => {
  const d = mk([hall('a', 0, 100, 100, 20), hall('b', 250, 100, 100, 20), room('X', 150, 60, 40, 40), room('Y', 150, 130, 40, 40)]);
  const r = applyAll(d, 'hall-connect');
  assert.equal(notes(r).un, 0);
  const rooms = d.items.filter((i) => i.type === 'room');
  for (const h of halls(r)) for (const m of rooms) {
    const ix = Math.min(h.x + h.w, m.x + m.w) - Math.max(h.x, m.x), iy = Math.min(h.y + h.h, m.y + m.h) - Math.max(h.y, m.y);
    assert.ok(!(ix > 0 && iy > 0), 'hall inside a room');
  }
});

test('overlapping hallways: a clean union is merged', () => {
  const d = mk([hall('a', 0, 100, 200, 20), hall('b', 150, 100, 200, 20)]);
  const [f] = findHallFixes(d);
  assert.equal(f.kind, 'hall-overlap');
  assert.equal(halls(f.doc).length, 1);
  assert.deepEqual([halls(f.doc)[0].x, halls(f.doc)[0].w], [0, 350]);
});

test('nested hallways merge into the outer one', () => {
  const d = mk([hall('a', 0, 100, 300, 40), hall('b', 50, 110, 100, 20)]);
  assert.equal(halls(applyAll(d, 'hall-overlap')).length, 1);
});

test('messy overlap is trimmed off the shorter one, still touching', () => {
  const d = mk([hall('a', 0, 100, 300, 20), hall('b', 250, 110, 60, 30)]);
  const r = applyAll(d, 'hall-overlap');
  assert.equal(notes(r).ov, 0);
  assert.equal(halls(r).length, 2);
  assert.equal(notes(r).un, 0);
});

test('rooms: in line gets an extension, off to the side one connector', () => {
  const d = mk([hall('a', 0, 100, 100, 20), room('R1', 150, 95, 40, 30), room('R2', 40, 150, 40, 40)]);
  assert.equal(notes(d).rm, 2);
  assert.equal(findHallFixes(d).length, 2);
  const r = applyAll(d);
  assert.equal(notes(r).rm, 0);
  assert.ok(halls(r).length <= 2);
});

test('rooms on every side of a hallway get linked', () => {
  const items = [hall('a', 150, 150, 200, 20), room('N', 200, 60, 60, 60), room('S', 200, 220, 60, 60), room('W', 60, 140, 40, 40), room('E', 400, 140, 40, 40)];
  const r = applyAll(mk(items));
  assert.equal(notes(r).rm, 0);
  assert.equal(notes(r).un, 0);
});

test('room far from every hallway: manual', () => {
  const d = mk([hall('a', 0, 0, 50, 10), room('F', 400, 350, 30, 30)]);
  assert.deepEqual(findHallFixes(d).filter((f) => f.kind === 'room-hall'), []);
  assert.match(findManualHalls(d).find((m) => m.ids.includes('F')).message, /too far/);
});

test('hallway longer than the building does not break anything', () => {
  const d = mk([hall('a', -100, 100, 800, 20), hall('b', 200, 300, 50, 10)]);
  assert.equal(notes(applyAll(d)).un, 0);
});

test('fixes never mutate the input and never make another note worse', () => {
  const d = mk([hall('a', 0, 100, 100, 20), hall('b', 130, 100, 100, 20), hall('c', 80, 100, 60, 20), room('R', 300, 90, 40, 40)]);
  const s = JSON.stringify(d), m0 = notes(d);
  for (const f of findHallFixes(d)) {
    const m = notes(f.doc);
    assert.ok(m.ov <= m0.ov && m.rm <= m0.rm);
  }
  assert.equal(JSON.stringify(d), s);
});

test('idempotent: after applying everything, the notes are gone', () => {
  const d = mk([hall('a', 0, 100, 150, 20), hall('b', 200, 100, 100, 20), hall('c', 250, 200, 20, 60), room('R', 400, 100, 40, 40), room('S', 200, 270, 40, 40)]);
  const r = applyAll(d);
  assert.deepEqual(notes(r), { ov: 0, un: 0, rm: 0 });
  assert.deepEqual(findHallFixes(r), []);
});

test('huge doc: 2000 rooms and 300 halls under 500 ms', () => {
  const items = [];
  for (let i = 0; i < 300; i++) items.push(hall('h' + i, (i % 20) * 120, Math.floor(i / 20) * 100 + 40, i % 3 ? 90 : 60, 12));
  for (let i = 0; i < 2000; i++) items.push(room('r' + i, (i % 50) * 48, Math.floor(i / 50) * 60 + 80, 40, 30));
  const d = mk(items, null);
  const t = Date.now();
  const f = findHallFixes(d), m = findManualHalls(d);
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
  assert.ok(f.length + m.length > 0);
});
