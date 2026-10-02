// hallpass-quality.test.js: what the second hallway pass keeps (js/model/autobuild/hallpass.js):
// corridors that join the network, no pockets, no orphans, nothing across an outline notch, repeatable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHallPass } from '../js/model/autobuild/hallpass.js';
import { fillHallways } from '../js/model/hallFill.js';
import { roomsNotTouchingHall, unconnectedHalls } from '../js/model/attention.js';

const room = (id, x, y, w, h) => ({ id, type: 'room', cls: 'room', shape: 'rect', x, y, w, h, number: id, name: '' });
const hall = (id, x, y, w, h) => ({ id, type: 'hall', x, y, w, h });
const box = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const rowOf = (y, x0, n, p) => Array.from({ length: n }, (_, i) => room(`${p}${i}`, x0 + i * 100, y, 100, 100));
const halls = (r) => r.items.filter((i) => i.type === 'hall');
const adding = (...rects) => (doc) => ({ doc: { ...doc, items: [...doc.items, ...rects.map((r, i) => hall('n' + i, ...r))] }, added: [], extended: [], notes: [] });
const noFix = () => [];
const key = (r) => halls(r).map((h) => `${h.x},${h.y},${h.w},${h.h}`).sort().join('|');
const base = () => ({ floor: { points: box(800, 400) }, items: [...rowOf(0, 0, 7, 'a'), ...rowOf(200, 0, 7, 'b'), hall('h0', 0, 100, 300, 100)] });

test('an orphan corridor that serves nothing and touches no network is dropped', async () => {
  const r = await runHallPass(base(), { fillHallways: adding([0, 310, 300, 30]), findHallFixes: noFix });
  assert.equal(halls(r).length, 1);
});

test('a squarish pocket at the end of a hallway is dropped', async () => {
  const r = await runHallPass(base(), { fillHallways: adding([300, 100, 100, 100]), findHallFixes: noFix });
  assert.equal(halls(r).length, 1);
});

test('a corridor that serves rooms but sits apart is bridged through free space', async () => {
  const doc = base();
  const before = roomsNotTouchingHall(doc.items).length;
  const r = await runHallPass(doc, { fillHallways: adding([400, 100, 300, 100]), findHallFixes: noFix });
  assert.ok(roomsNotTouchingHall(r.items).length < before);
  assert.equal(unconnectedHalls({ items: r.items, floor: doc.floor }).length, 0);
  assert.ok(halls(r).some((h) => h.x === 300 && h.w === 100), 'a bridge fills the gap');
});

test('a hall spanning a notch of the outline is refused', async () => {
  const notch = [[0, 0], [300, 0], [300, 90], [500, 90], [500, 0], [800, 0], [800, 400], [0, 400]];
  const doc = { floor: { points: notch }, items: [...rowOf(200, 0, 7, 'b'), hall('h0', 0, 100, 300, 100)] };
  const r = await runHallPass(doc, { fillHallways: adding([100, 20, 600, 40]), findHallFixes: noFix });
  assert.equal(halls(r).length, 1);
});

test('real fill: connected, nothing across rooms, and a second run changes nothing', async () => {
  const doc = { floor: { points: box(800, 400) }, items: [...rowOf(0, 0, 8, 'a'), ...rowOf(200, 0, 4, 'b'), ...rowOf(200, 500, 3, 'c'), ...rowOf(300, 0, 4, 'd'), ...rowOf(300, 500, 3, 'e')] };
  const r1 = await runHallPass(doc, { fillHallways, findHallFixes: noFix });
  assert.ok(halls(r1).length >= 1);
  assert.equal(unconnectedHalls({ items: r1.items, floor: doc.floor }).length, 0);
  for (const h of halls(r1)) for (const q of doc.items) {
    assert.ok(!(Math.min(h.x + h.w, q.x + q.w) - Math.max(h.x, q.x) > 2 && Math.min(h.y + h.h, q.y + q.h) - Math.max(h.y, q.y) > 2), 'no overlap with ' + q.id);
  }
  const r2 = await runHallPass({ floor: doc.floor, items: r1.items }, { fillHallways, findHallFixes: noFix });
  assert.equal(key(r2), key(r1));
  assert.deepEqual([r2.hallPass.added, r2.hallPass.extended], [[], []]);
});
