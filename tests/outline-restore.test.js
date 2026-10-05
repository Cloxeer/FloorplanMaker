// tests/outline-restore.test.js
// Bringing a deleted building outline back (js/model/outlineRestore.js).
// Depends on: node:test, js/model/outlineRestore.js, js/model/turn.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberOutline, restoreOutline, autoOutline, snapDoorsTo, hasOutline } from '../js/model/outlineRestore.js';
import { turnSelection } from '../js/model/turn.js';
import { polygonArea, pointInPolygon } from '../js/model/geometry.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, label: { pinned: false, x: null, y: null } });
const base = () => ({
  version: 1, meta: {}, viewBox: { x: 0, y: 0, w: 2000, h: 2000 },
  floor: { points: [[100, 100], [500, 100], [500, 300], [100, 300]] },
  items: [room('a', 100, 100, 200, 200), room('b', 300, 100, 200, 100), room('c', 300, 200, 200, 100),
  ],
});
const without = (d) => ({ ...d, floor: null });
const inside = (pts, it) => [[it.x, it.y], [it.x + it.w, it.y], [it.x, it.y + it.h], [it.x + it.w, it.y + it.h]]
  .every(([x, y]) => pointInPolygon([x + (x === it.x ? 1 : -1), y + (y === it.y ? 1 : -1)], pts));

test('nothing to remember without an outline; hasOutline sees the difference', () => {
  assert.equal(rememberOutline(without(base())), null);
  assert.equal(hasOutline(base()), true);
  assert.equal(hasOutline(without(base())), false);
});

test('restoring when nothing moved gives the same outline back', () => {
  const mem = rememberOutline(base());
  const r = restoreOutline(mem, without(base()));
  assert.equal(r.how, 'same');
  assert.deepEqual(r.points, base().floor.points);
});

test('the plan moved: the outline follows it', () => {
  const mem = rememberOutline(base());
  const d = without(base());
  d.items = d.items.map((it) => ({ ...it, x: it.x + 400, y: it.y + 250 }));
  const r = restoreOutline(mem, d);
  assert.equal(r.how, 'moved');
  assert.deepEqual(r.points, [[500, 350], [900, 350], [900, 550], [500, 550]]);
  assert.deepEqual([r.dx, r.dy], [400, 250]);
});

test('the plan was turned a quarter: the outline turns with it', () => {
  const mem = rememberOutline(base());
  const turned = turnSelection(base(), ['a', 'b', 'c', 'floor'], 1, 5);
  const r = restoreOutline(mem, without(turned));
  assert.equal(r.turned, 1);
  const f = turned.floor.points, got = r.points;
  assert.equal(polygonArea(got), polygonArea(f));
  for (const it of turned.items) assert.ok(inside(got, it), `${it.id} inside`);
  const sorted = (p) => p.map((q) => q.join(',')).sort();
  assert.deepEqual(sorted(got), sorted(f));
});

test('a room moved out on its own: the restored outline is widened to hold it', () => {
  const mem = rememberOutline(base());
  const d = without(base());
  d.items = d.items.map((it) => (it.id === 'c' ? { ...it, x: 500, y: 300 } : it));
  const r = restoreOutline(mem, d);
  assert.equal(r.how, 'refit');
  for (const it of d.items) assert.ok(inside(r.points, it), `${it.id} inside`);
});

test('auto outline hugs the rooms that are there now, whatever the old one was', () => {
  const d = without(base());
  d.items = d.items.map((it) => ({ ...it, x: it.x + 1000, y: it.y + 700 }));
  const r = autoOutline(d);
  for (const it of d.items) assert.ok(inside(r.points, it), `${it.id} inside`);
  assert.equal(polygonArea(r.points), 400 * 200);
  assert.ok(r.points.length <= 8);
});

test('auto outline of an L shape is an L, and a gap between rooms is bridged', () => {
  const d = { ...base(), floor: null, items: [room('a', 0, 0, 100, 300), room('b', 105, 200, 200, 100)] };
  const r = autoOutline(d);
  assert.equal(polygonArea(r.points) >= 100 * 300 + 200 * 100, true);
  assert.ok(r.points.length >= 6);
  assert.equal(autoOutline({ ...base(), items: [] }), null);
});

test('doors left on the old wall are brought to the new one', () => {
  const d = without(base());
  d.items = [...d.items, { id: 'd', type: 'door', kind: 'Door', x1: 100, y1: 150, x2: 100, y2: 186, label: { x: 155, y: 168 } }];
  const next = snapDoorsTo(d, [[90, 90], [510, 90], [510, 310], [90, 310]]);
  const door = next.items.find((i) => i.id === 'd');
  assert.equal(door.x1, 90);
  assert.equal(door.x2, 90);
  assert.equal(snapDoorsTo(d, [[100, 100], [500, 100], [500, 300], [100, 300]]), d, 'already on the wall: untouched');
});

test('a far-off room is never left outside: auto outline bridges it, restore falls back to a fresh outline', () => {
  const d = { ...base(), floor: null, items: [room('a', 200, 200, 300, 200), room('b', 500, 200, 300, 200), room('c', 200, 400, 300, 300), room('far', 1000, 200, 300, 200)] };
  const r = autoOutline(d);
  for (const it of d.items) assert.ok(inside(r.points, it), `${it.id} inside the auto outline`);
  const mem = rememberOutline({ ...base(), items: d.items.slice(0, 3), floor: { points: [[200, 200], [800, 200], [800, 400], [500, 400], [500, 700], [200, 700]] } });
  const back = restoreOutline(mem, d);
  for (const it of d.items) assert.ok(inside(back.points, it), `${it.id} inside the restored outline`);
});
