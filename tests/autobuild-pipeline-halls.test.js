// autobuild-pipeline-halls.test.js
// AutoBuild's second hallway pass (js/model/autobuild/hallpass.js) on the synthetic poster:
// never worse than without it, nothing outside the outline, rooms untouched, compass last,
// deterministic, idempotent, and a failing fillHallways leaves a valid result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { runHallPass } from '../js/model/autobuild/hallpass.js';
import { roomsNotTouchingHall } from '../js/model/attention.js';
import { newId, roomPolygon } from '../js/model/document.js';
import { synthPoster, fakeOcr } from './autobuild-pipeline.helpers.js';

const ocr = async (im) => fakeOcr(im);
const poster = () => synthPoster().img;
const inside = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// ids are random per build: compare shapes only
const strip = (items) => JSON.stringify(items.map(({ id, ...rest }) => rest));
const nonHall = (items) => strip(items.filter((i) => i.type !== 'hall' && i.type !== 'compass'));

let off, on;
async function both() {
  if (!off) {
    off = await buildFromPlan(poster(), { ocr, hallPass: false });
    on = await buildFromPlan(poster(), { ocr });
  }
  return { off, on };
}

// a stand-in for fillHallways: one new hall in the gap between the two rows of rooms
function corridorFill(res) {
  const rooms = res.items.filter((i) => i.type === 'room' && i.cls === 'room');
  const ys = rooms.map((r) => roomPolygon(r)[0][1]).sort((a, b) => a - b);
  const mid = ys[Math.floor(ys.length / 2)];
  const top = rooms.filter((r) => roomPolygon(r)[0][1] < mid), low = rooms.filter((r) => roomPolygon(r)[0][1] >= mid);
  const bottomOf = (r) => Math.max(...roomPolygon(r).map((p) => p[1]));
  const y0 = Math.max(...top.map(bottomOf)), y1 = Math.min(...low.map((r) => Math.min(...roomPolygon(r).map((p) => p[1]))));
  const x0 = Math.min(...rooms.map((r) => Math.min(...roomPolygon(r).map((p) => p[0])))), x1 = Math.max(...rooms.map((r) => Math.max(...roomPolygon(r).map((p) => p[0]))));
  return (doc) => ({ doc: { ...doc, items: [...doc.items, { id: newId(), type: 'hall', x: x0, y: y0, w: x1 - x0, h: y1 - y0 }] }, added: [], extended: [], notes: [] });
}

test('second pass: never more rooms off a hallway, nothing outside, rooms unchanged', async () => {
  const { off, on } = await both();
  assert.ok(roomsNotTouchingHall(on.items).length <= roomsNotTouchingHall(off.items).length);
  assert.equal(nonHall(on.items), nonHall(off.items), 'rooms, stairs and doors are as before');
  assert.deepEqual(on.floor, off.floor);
  for (const h of on.items.filter((i) => i.type === 'hall')) {
    for (const [x, y] of [[h.x + 1, h.y + 1], [h.x + h.w - 1, h.y + h.h - 1]]) assert.ok(inside(on.floor.points, x, y), 'hall inside the outline');
  }
  assert.ok(on.hallPass && Array.isArray(on.hallPass.added) && Array.isArray(on.hallPass.extended));
  assert.ok(on.hallPass.notesLeft && 'roomsNotTouching' in on.hallPass.notesLeft && 'unconnected' in on.hallPass.notesLeft);
});

test('second pass: deterministic', async () => {
  const { on } = await both();
  const again = await buildFromPlan(poster(), { ocr });
  assert.deepEqual(JSON.parse(JSON.stringify(again.hallPass)), JSON.parse(JSON.stringify(on.hallPass)));
  assert.equal(again.items.filter((i) => i.type === 'hall').length, on.items.filter((i) => i.type === 'hall').length);
});

test('second pass: injected hall is added, compass stays last, rooms unchanged, idempotent', async () => {
  const { off } = await both();
  const bare = off.items.filter((i) => i.type !== 'hall');
  const withCompass = { floor: off.floor, items: [...bare, { id: newId(), type: 'compass', x: 5, y: 5, deg: 0 }] };
  const opts = { fillHallways: corridorFill(off) };
  const r = await runHallPass(withCompass, opts);
  assert.equal(r.items[r.items.length - 1].type, 'compass', 'compass is the last item');
  assert.equal(r.items.filter((i) => i.type === 'compass').length, 1);
  assert.equal(nonHall(r.items), nonHall(off.items));
  assert.equal(r.hallPass.added.length >= 1, true, 'the new hall is reported');
  for (const id of r.hallPass.added) assert.ok(r.items.some((i) => i.id === id && i.type === 'hall'));
  assert.ok(roomsNotTouchingHall(r.items).length <= roomsNotTouchingHall(bare).length);
  // idempotence: a second run with a pass that finds nothing more changes nothing
  const again = await runHallPass({ floor: off.floor, items: r.items }, { fillHallways: (d) => ({ doc: d, added: [], extended: [], notes: [] }) });
  assert.equal(again.hallPass.added.length, 0);
  assert.equal(again.hallPass.extended.length, 0);
  assert.equal(JSON.stringify(again.items), JSON.stringify(r.items));
});

test('second pass: a hall that leaves the outline is refused', async () => {
  const { off } = await both();
  const bad = (doc) => ({ doc: { ...doc, items: [...doc.items, { id: newId(), type: 'hall', x: -500, y: -500, w: 100, h: 40 }] } });
  const r = await runHallPass({ floor: off.floor, items: off.items }, { fillHallways: bad });
  assert.equal(r.hallPass.added.length, 0);
  assert.equal(JSON.stringify(r.items), JSON.stringify(off.items));
});

test('second pass: a throwing fillHallways, or hallPass:false, leaves a valid result', async () => {
  const { off } = await both();
  const boom = await buildFromPlan(poster(), { ocr, fillHallways: () => { throw new Error('boom'); } });
  assert.equal(strip(boom.items), strip(off.items));
  assert.deepEqual(boom.hallPass.added, []);
  assert.ok(boom.floor.points.length >= 4);
  assert.deepEqual(off.hallPass.added, []);
});
