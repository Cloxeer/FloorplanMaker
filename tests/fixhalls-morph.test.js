// fixhalls-morph.test.js
// Rooms beside a hallway are served by MORPHING it (its facing edge moves out to the room edge), not by
// connectors: rows of rooms with small gaps, rooms on both sides, ends, blocked strips, odd input.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findHallFixes, findManualHalls } from '../js/model/fixHalls.js';
import { roomsNotTouchingHall, overlappingHalls, unconnectedHalls } from '../js/model/attention.js';

const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const room = (id, x, y, w, h, extra = {}) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '', ...extra });
const box = [[0, 0], [600, 0], [600, 500], [0, 500]];
const mk = (items, pts = box) => ({ floor: pts ? { points: pts } : undefined, items });
const halls = (d) => d.items.filter((i) => i.type === 'hall');
const rm = (d) => roomsNotTouchingHall(d.items).length;
const applyAll = (doc) => { let d = doc; for (let g = 0; g < 40; g++) { const f = findHallFixes(d); if (!f.length) break; d = f[0].doc; } return d; };
const hit = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;
const noRoomHit = (d) => halls(d).every((h) => d.items.filter((i) => i.type === 'room' && Number.isFinite(i.x)).every((r) => !hit(h, r)));

test('row of rooms with gaps 8 / 12 / 20: one hall morph serves all, no connectors', () => {
  const d = mk([hall('a', 0, 100, 400, 20), room('1', 20, 128, 60, 60), room('2', 90, 132, 60, 60), room('3', 160, 140, 60, 60)]);
  assert.equal(rm(d), 3);
  const f = findHallFixes(d);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'room-hall');
  assert.equal(rm(f[0].doc), 0);
  assert.ok(halls(f[0].doc).every((h) => h.h >= 20 && [h.x, h.y, h.w, h.h].every(Number.isInteger)));
  assert.ok(halls(f[0].doc).length <= 5);
  assert.ok(noRoomHit(f[0].doc));
  assert.equal(overlappingHalls(f[0].doc.items).length, 0);
  assert.equal(unconnectedHalls(f[0].doc).length, 0);
  assert.match(f[0].notes.join(' '), /Widen/);
});

test('rooms on both sides of a corridor: both sides touch after one fix', () => {
  const d = mk([hall('a', 0, 200, 500, 20), room('N', 50, 120, 80, 70), room('N2', 140, 112, 80, 78), room('S', 60, 236, 80, 70), room('S2', 150, 240, 80, 70)]);
  assert.equal(rm(d), 4);
  const r = applyAll(d);
  assert.equal(rm(r), 0);
  assert.ok(noRoomHit(r));
  assert.ok(halls(r).every((h) => h.h <= 100));
  assert.equal(overlappingHalls(r.items).length, 0);
});

test('a room beyond the end of a hall: the end is extended, same width', () => {
  const d = mk([hall('a', 0, 100, 200, 20), room('R', 260, 95, 60, 40)]);
  const r = applyAll(d);
  assert.equal(rm(r), 0);
  assert.equal(halls(r).length, 1);
  assert.equal(halls(r)[0].h, 20);
});

test('far room over free space (3.5x its size) is reached by lengthening the hall', () => {
  const d = mk([hall('a', 0, 100, 100, 20), room('R', 330, 95, 60, 40)]);
  const r = applyAll(d);
  assert.equal(rm(r), 0);
  assert.ok(noRoomHit(r));
});

test('a strip blocked by another room is not morphed through it', () => {
  const d = mk([hall('a', 0, 100, 400, 20), room('B', 100, 125, 100, 20), room('R', 100, 160, 100, 60)]);
  const r = applyAll(d);
  assert.ok(noRoomHit(r));
  assert.ok(findManualHalls(r).every((m) => m.message.trim()));
});

test('too wide a gap is not morphed: connector or manual, never a fat blob', () => {
  const d = mk([hall('a', 0, 100, 400, 20), room('R', 100, 260, 60, 60)]);
  const r = applyAll(d);
  assert.ok(noRoomHit(r));
  assert.ok(halls(r).every((h) => Math.min(h.w, h.h) <= 100));
});

test('L-shaped corridor: a room inside the bend is reached', () => {
  const d = mk([hall('a', 0, 100, 300, 20), hall('b', 280, 100, 20, 300), room('R', 220, 160, 50, 50)]);
  assert.equal(rm(d), 1);
  assert.equal(rm(applyAll(d)), 0);
});

test('the outline forbids growing out of the building', () => {
  const pts = [[0, 0], [600, 0], [600, 500], [0, 500]];
  const d = mk([hall('a', 0, 2, 400, 20), room('R', 100, 40, 60, 60)], pts);
  const r = applyAll(d);
  assert.ok(halls(r).every((h) => h.y >= -2));
});

test('rooms enclosed by other rooms are reported, nothing is drawn through them', () => {
  const ring = [room('c', 100, 100, 100, 100), room('n', 100, 0, 100, 100), room('s', 100, 200, 100, 100), room('w', 0, 100, 100, 100), room('e', 200, 100, 100, 100), hall('h', 500, 100, 20, 200)];
  const r = applyAll(mk(ring));
  assert.ok(noRoomHit(r));
  assert.ok(findManualHalls(r).some((m) => m.ids.includes('c')));
});

test('rows that cannot be linked are grouped with the side they are on', () => {
  const rows = [hall('a', 0, 400, 500, 20)];
  for (let i = 0; i < 3; i++) rows.push(room('t' + i, 20 + i * 100, 20, 90, 60), room('m' + i, 20 + i * 100, 100, 90, 250));
  const man = findManualHalls(mk(rows));
  assert.ok(man.some((m) => m.ids.length === 3 && /3 rooms along the top/.test(m.message)), JSON.stringify(man));
});

test('polygon rooms, NaN, duplicates and missing outline do not break anything', () => {
  const poly = { id: 'P', type: 'room', cls: 'room', shape: 'poly', points: [[100, 160], [160, 160], [160, 220], [100, 220]], number: 'P', name: '' };
  const d = mk([hall('a', 0, 100, 400, 20), poly, room('N', NaN, 5, 40, 40), hall('a', 0, 100, 400, 20), room('1', 20, 130, 60, 60), room('1', 20, 130, 60, 60)], null);
  const s = JSON.stringify(d);
  const r = applyAll(d);
  assert.equal(JSON.stringify(d), s);
  assert.deepEqual(findHallFixes(findHallFixes(d).length ? d : d).map((f) => f.key), findHallFixes(d).map((f) => f.key));
});

test('idempotent and deterministic', () => {
  const d = mk([hall('a', 0, 100, 400, 20), room('1', 20, 128, 60, 60), room('2', 90, 132, 60, 60), room('3', 160, 140, 60, 60)]);
  const a = findHallFixes(d).map((f) => f.key), b = findHallFixes(d).map((f) => f.key);
  assert.deepEqual(a, b);
  const r = applyAll(d);
  assert.deepEqual(findHallFixes(r).filter((f) => f.kind === 'room-hall'), []);
});

test('huge doc with rooms beside many halls stays fast', () => {
  const items = [];
  for (let i = 0; i < 300; i++) items.push(hall('h' + i, (i % 20) * 120, Math.floor(i / 20) * 100 + 40, 100, 12));
  for (let i = 0; i < 2000; i++) items.push(room('r' + i, (i % 50) * 48, Math.floor(i / 50) * 60 + 62, 40, 30));
  const d = mk(items, null);
  const t = Date.now();
  findHallFixes(d); findManualHalls(d);
  assert.ok(Date.now() - t < 500, `took ${Date.now() - t} ms`);
});
