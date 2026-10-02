// hallfill.test.js: second hallway pass (js/model/hallFill.js) on synthetic plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillHallways } from '../js/model/hallFill.js';
import { roomsNotTouchingHall } from '../js/model/attention.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const box = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const mk = (items, pts = box(800, 400)) => ({ floor: pts ? { points: pts } : undefined, items });
const halls = (d) => d.items.filter((i) => i.type === 'hall');
const ovl = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0;
const row = (y, n = 6, x0 = 0) => Array.from({ length: n }, (_, i) => room(`r${y}_${i}`, x0 + i * 100, y, 100, 100));
const noRoomOverlap = (d) => halls(d).every((h) => d.items.filter((i) => i.type === 'room').every((r) => !(Math.min(h.x + h.w, r.x + r.w) - Math.max(h.x, r.x) > 2 && Math.min(h.y + h.h, r.y + r.h) - Math.max(h.y, r.y) > 2)));

test('corridor between two room rows becomes one tight hall; idempotent; input untouched', () => {
  const d = mk([...row(0), ...row(200)], box(600, 300));
  const snap = JSON.stringify(d);
  const r = fillHallways(d);
  assert.equal(JSON.stringify(d), snap);
  assert.equal(r.added.length, 1);
  const h = halls(r.doc)[0];
  assert.deepEqual([h.x, h.y, h.w, h.h], [0, 100, 600, 100]);
  assert.equal(roomsNotTouchingHall(r.doc.items).length, 0);
  const r2 = fillHallways(r.doc);
  assert.deepEqual([r2.added, r2.extended], [[], []]);
});

test('degenerate input: no outline, zero rooms, junk, NaN, huge coordinates', () => {
  assert.equal(fillHallways(null).added.length, 0);
  assert.equal(fillHallways({}).added.length, 0);
  assert.match(fillHallways(mk([])).notes[0], /No rooms/);
  const nan = mk([room('a', NaN, 0, 10, 10), { type: 'room', shape: 'poly', points: [[0, 0]] }, null, ...row(0), ...row(200)], null);
  const r = fillHallways(nan);
  assert.equal(r.added.length, 1);
  assert.match(r.notes.join(' '), /No outline/);
  const big = mk([room('a', 1e9, 1e9, 100, 100), room('b', 1e9 + 300, 1e9 + 300, 100, 100)], box(1e9, 1e9));
  assert.doesNotThrow(() => fillHallways(big));
  const dup = mk([room('a', 0, 0, 100, 100), room('a', 0, 200, 100, 100), room('a', 100, 0, 100, 100), room('a', 100, 200, 100, 100)], box(200, 300));
  const rd = fillHallways(dup);
  assert.equal(new Set(rd.doc.items.map((i) => i.id)).size, 1 + rd.added.length);
});

test('rooms fill the outline: nothing added', () => {
  const r = fillHallways(mk([...row(0), ...row(100), ...row(200)], box(600, 300)));
  assert.equal(r.added.length, 0);
  assert.equal(r.doc.items.length, 18);
});

test('T junction and cross link up (pieces touch)', () => {
  // stem between two column blocks meets a horizontal bar
  const items = [...row(0, 8), ...row(200, 4), ...row(200, 3, 500), ...row(300, 4), ...row(300, 3, 500)];
  const r = fillHallways(mk(items, box(800, 400)));
  const hs = halls(r.doc);
  assert.ok(hs.length >= 2);
  const touch = (a, b) => Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w) <= 1 && Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h) <= 1;
  for (const h of hs) assert.ok(hs.some((o) => o !== h && touch(h, o)));
  assert.ok(noRoomOverlap(r.doc));
  assert.equal(roomsNotTouchingHall(r.doc.items).filter((x) => x.y < 300).length, 0);
});

test('L-shaped outline with a corridor around the corner', () => {
  const L = [[0, 0], [500, 0], [500, 300], [200, 300], [200, 500], [0, 500]];
  const items = [room('a', 0, 0, 100, 100), room('b', 0, 200, 100, 100), room('c', 0, 400, 100, 100), room('d', 400, 0, 100, 100), room('e', 200, 200, 100, 100), room('f', 400, 200, 100, 100)];
  const r = fillHallways(mk(items, L));
  assert.ok(r.added.length >= 1);
  for (const h of halls(r.doc)) assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= 500 && h.y + h.h <= 500 && !(h.x + h.w > 200 && h.y + h.h > 300 && h.x + h.w > 200 && h.y > 300 && h.x >= 200));
  assert.ok(noRoomOverlap(r.doc));
});

test('polygon rooms are no-go; donut courtyard is not filled as a hall', () => {
  const poly = { id: 'p', type: 'room', cls: 'room', shape: 'poly', points: [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]] };
  const r = fillHallways(mk([poly, room('q', 0, 400, 100, 100), room('s', 200, 200, 100, 100)], box(400, 500)));
  assert.ok(noRoomOverlap(r.doc));
  for (const h of halls(r.doc)) assert.ok(!(h.x < 100 && h.y < 100 && h.x + h.w > 2 && h.y + h.h > 2 && h.x + h.w > 2 && h.x < 100 - 2 && h.y < 100 - 2));
  // donut: ring of rooms around a big open court, plus a ring corridor wider than the cap
  const ring = [room('n', 0, 0, 500, 100), room('s2', 0, 400, 500, 100), room('w', 0, 100, 100, 300), room('e', 400, 100, 100, 300)];
  assert.equal(fillHallways(mk(ring, box(500, 500))).added.length, 0);
});

test('existing hall partly covering the corridor is extended, not duplicated', () => {
  const d = mk([...row(0), ...row(200), hall('h', 0, 100, 300, 100)], box(600, 300));
  const r = fillHallways(d);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.extended, ['h']);
  const h = halls(r.doc)[0];
  assert.deepEqual([h.x, h.y, h.w, h.h], [0, 100, 600, 100]);
});

test('dead-end corridor stops at the wall and does not poke into rooms', () => {
  const items = [...row(0, 4), ...row(200, 4), room('end', 400, 0, 100, 300), room('x', 500, 0, 100, 300)];
  const r = fillHallways(mk(items, box(600, 300)));
  assert.equal(r.added.length, 1);
  const h = halls(r.doc)[0];
  assert.deepEqual([h.x, h.w, h.y, h.h], [0, 400, 100, 100]);
});

test('2000 rooms stay fast', () => {
  const items = [];
  for (let b = 0; b < 20; b++) for (let i = 0; i < 100; i++) items.push(room(`r${b}_${i}`, i * 100, b * 250, 100, 100), room(`s${b}_${i}`, i * 100, b * 250 + 150, 100, 100));
  const t = Date.now();
  const r = fillHallways(mk(items, box(10000, 5000)));
  assert.ok(Date.now() - t < 1500, 'took ' + (Date.now() - t));
  assert.ok(r.added.length > 0);
});
