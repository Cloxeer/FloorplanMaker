// tests/stitch.test.js: joining the plans of several photos of one floor (js/model/stitch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignByShape, alignByHallways, alignPlans, layoutPlans, mergePlans, placeItem, apply } from '../js/model/stitch.js';

const room = (n, x, y, w, h) => ({ id: `r${n}`, type: 'room', cls: 'room', shape: 'rect', number: n, x, y, w, h, label: {} });
const hall = (x, y, w, h) => ({ id: `h${x}-${y}`, type: 'hall', x, y, w, h });
// plan A: a corridor with rooms 101-104 above and 105-108 below
const A = () => ({
  id: 'A', w: 900, h: 400, compass: { x: 20, y: 20, deg: 0 },
  items: [hall(0, 100, 800, 100), ...[101, 102, 103, 104].map((n, i) => room(String(n), i * 200, 0, 200, 100)), ...[105, 106, 107, 108].map((n, i) => room(String(n), i * 200, 200, 200, 100))],
  floor: { points: [[0, 0], [800, 0], [800, 300], [0, 300]] },
});
// plan B shows rooms 103-108 and two more (109, 110) to the right, drawn with an offset
const B = (dx = -400, dy = 50) => ({
  id: 'B', w: 900, h: 400, compass: { x: 20, y: 20, deg: 0 },
  items: [hall(dx + 0, dy + 100, 1200, 100), ...[103, 104, 109, 110].map((n, i) => room(String(n), dx + 400 + i * 200 - 400 + 400 - 400 + (i > 1 ? 0 : 0), dy, 200, 100)), ...[107, 108].map((n, i) => room(String(n), dx + 600 + i * 200, dy + 200, 200, 100))],
  floor: { points: [[dx, dy], [dx + 1200, dy], [dx + 1200, dy + 300], [dx, dy + 300]] },
});

test('shared room numbers fix the shift between two photos', () => {
  const a = A(), b = B(-400, 50);
  // in B, rooms 103/104 sit at x = 400..., in A at 400... : make the shift explicit
  b.items = [room('103', 0, 50, 200, 100), room('104', 200, 50, 200, 100), room('109', 400, 50, 200, 100), room('110', 600, 50, 200, 100), hall(0, 150, 800, 100)];
  const t = alignByShape(a, b)[0];
  assert.equal(t.q, 0); assert.equal(t.n, 2);
  assert.ok(Math.abs(t.tx - 400) < 1 && Math.abs(t.ty + 50) < 1 && Math.abs(t.s - 1) < 0.01, JSON.stringify(t));
});

test('a plan photographed turned a quarter is turned back, and a different scale is found', () => {
  const a = A();
  const turned = { id: 'T', compass: { x: 0, y: 0, deg: 90 }, items: a.items.filter((i) => i.type === 'room' && ['101', '102', '105', '106'].includes(i.number)).map((r) => placeItem(r, { q: 1, s: 0.8, tx: 300, ty: 40 })), floor: null };
  const t = alignByShape(a, turned)[0];
  // a -> turned is q=1, s=0.8; so turned -> a is q=3, s=1.25
  assert.equal(t.q, 3);
  assert.ok(Math.abs(t.s - 1.25) < 0.02, String(t.s));
  const back = turned.items.map((r) => placeItem(r, { q: t.q, s: t.s, tx: t.tx, ty: t.ty }));
  back.forEach((r) => { const o = a.items.find((i) => i.number === r.number); assert.ok(Math.abs(r.x - o.x) <= 3 && Math.abs(r.y - o.y) <= 3 && Math.abs(r.w - o.w) <= 3, r.number); });
});

test('with no shared number, a corridor that leaves one plan meets the corridor that arrives in the other', () => {
  const a = { id: 'A', compass: { deg: 0 }, items: [hall(0, 100, 600, 80), room('101', 0, 0, 200, 100)], floor: { points: [[0, 0], [600, 0], [600, 300], [0, 300]] } };
  const b = { id: 'B', compass: { deg: 0 }, items: [hall(0, 40, 500, 80), room('201', 0, 120, 200, 100)], floor: { points: [[0, 0], [500, 0], [500, 220], [0, 220]] } };
  const t = alignByHallways(a, b)[0];
  assert.equal(t.how, 'hallway');
  const [x, y] = apply(t, 0, 80);
  assert.ok(Math.abs(x - 600) < 2 && Math.abs(y - 140) < 2, `${x},${y}`);
});

test('alignPlans chains: C joins B which joins A', () => {
  const a = A();
  const b = { id: 'B', compass: { deg: 0 }, items: [room('103', 0, 50, 200, 100), room('104', 200, 50, 200, 100), room('109', 400, 50, 200, 100)], floor: null };
  const c = { id: 'C', compass: { deg: 0 }, items: [room('109', 0, 0, 200, 100), room('110', 200, 0, 200, 100)], floor: null };
  const { tfs: tf } = alignPlans([a, b, c]);
  assert.equal(tf[0].how, 'reference');
  assert.ok(tf[1] && tf[2]);
  assert.ok(Math.abs(tf[2].tx - 800) < 3 && Math.abs(tf[2].ty - 0) < 3, JSON.stringify(tf[2]));
});

test('mergePlans keeps a shared room once, drops overlapping repeats and gives one outline', () => {
  const a = A(), b = { id: 'B', compass: { deg: 0 }, items: [room('103', 0, 50, 200, 100), room('104', 200, 50, 200, 100), room('109', 400, 50, 200, 100)], floor: { points: [[0, 50], [600, 50], [600, 250], [0, 250]] } };
  const { tfs: tf } = alignPlans([a, b]);
  const m = mergePlans([a, b], tf);
  const nums = m.items.filter((i) => i.type === 'room').map((r) => r.number).sort();
  assert.deepEqual(nums, ['101', '102', '103', '104', '105', '106', '107', '108', '109']);
  assert.ok(m.floor && m.floor.points.length >= 4);
  const xs = m.floor.points.map((p) => p[0]);
  assert.ok(Math.max(...xs) >= 1000);
});

test('photos with nothing in common are not combined: they are reported as apart, and left out of the plan', () => {
  const a = A();
  // another floor: other numbers, no corridor to meet, different shapes
  const other = { id: 'Z', w: 500, h: 300, compass: { x: 10, y: 10, deg: 0 }, items: [room('401', 0, 0, 130, 90), room('402', 130, 0, 90, 150), room('403', 220, 0, 170, 60)], floor: { points: [[0, 0], [390, 0], [390, 150], [0, 150]] } };
  const { tfs, notes, loose } = layoutPlans([a, other], { apart: true });
  assert.deepEqual(loose, [1]);
  assert.ok(notes.some((n) => /not combined/.test(n)), notes.join(' | '));
  const merged = mergePlans([a, other], tfs.map((t, i) => (loose.includes(i) ? null : t)));
  assert.ok(!merged.items.some((i) => i.number === '401'), 'the other floor must not be in the plan');
  assert.ok(merged.items.some((i) => i.number === '101'));
  // the same photos on a hand-lined-up board are used as the person placed them (tools may also ask for them to be joined anyway)
  const joined = layoutPlans([a, other], {});
  assert.deepEqual(joined.loose, []);
});
