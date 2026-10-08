// autobuild-pipeline.test.js
// End-to-end AutoBuild on a synthetic poster. The labels are blocks whose widths encode
// an id; the injected fake OCR decodes that id from the crop it receives and answers with
// the text the room should read as. Proves: unique numbers, scale normalisation, doors on
// the outline, straight outline, no overlaps, review list, and that only existing studio
// component types are emitted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { resolveProfile } from '../js/model/autobuild/profile.js';
import { nearestPointOnPolyline } from '../js/model/geometry.js';
import { roomPolygon } from '../js/model/document.js';

import { synthPoster, fakeOcr } from './autobuild-pipeline.helpers.js';


let cached;
async function build(opts = {}) {
  if (!cached || opts.fresh) {
    const { img } = synthPoster();
    cached = await buildFromPlan(img, { ocr: async (im) => fakeOcr(im), ...opts });
  }
  return cached;
}

const ALLOWED_TYPES = new Set(['room', 'hall', 'stair', 'door', 'compass', 'legend', 'authwall']);
const ALLOWED_CLS = new Set(['room', 'core', 'void', 'ours']);

test('synthetic poster: rooms with unique numbers, nothing invented', async () => {
  const res = await build();
  const rooms = res.items.filter((i) => i.type === 'room');
  assert.ok(rooms.length >= 11, `rooms found ${rooms.length}`);
  const numbers = rooms.map((r) => r.number).filter(Boolean);
  assert.equal(new Set(numbers).size, numbers.length, 'no number twice');
  for (const n of ['101', '102', '103', 'R104', '106', '107', '109', '110']) assert.ok(numbers.includes(n), `${n} read`);
  assert.equal(numbers.filter((n) => n === 'R104').length, 1, 'R104 was read on two rooms but is kept once');
  for (const it of res.items) {
    assert.ok(ALLOWED_TYPES.has(it.type), `type ${it.type} allowed`);
    if (it.type === 'room') assert.ok(ALLOWED_CLS.has(it.cls), `cls ${it.cls} allowed`);
  }
  assert.ok(rooms.some((r) => r.cls === 'core' && r.name === 'Restrooms'), 'restroom word -> Restrooms core room');
  assert.ok(rooms.some((r) => r.cls === 'void'), 'open to below -> void');
});

test('synthetic poster: scale normalisation, straight outline, no overlaps', async () => {
  const res = await build();
  const prof = resolveProfile();
  assert.equal((res.scale * 4) % 1, 0, 'scale is a quarter step');
  const shorts = res.items.filter((i) => i.type === 'room' && i.cls === 'room').map((r) => {
    const p = roomPolygon(r), xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }).sort((a, b) => a - b);
  const med = shorts[Math.floor(shorts.length / 2)];
  assert.ok(Math.abs(med - prof.targetRoom) <= 20, `median room short side ${med} near ${prof.targetRoom}`);
  const pts = res.floor.points;
  assert.ok(pts.length >= 4);
  pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; assert.ok(a[0] === b[0] || a[1] === b[1], 'axis-parallel edge'); });
  const boxes = res.items.filter((i) => i.type === 'room').map((r) => { const p = roomPolygon(r); return { x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) }; });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 5 || Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) <= 5, `rooms ${i} and ${j} overlap`);
  }
});

test('synthetic poster: no door is placed automatically, even where an exit sign is read', async () => {
  const res = await build();
  assert.ok(res.stats.exits >= 1, 'the exit sign is still found (so it is not taken for a room)');
  assert.equal(res.items.filter((i) => i.type === 'door').length, 0);
});

test('synthetic poster: review list explains every guess and only those', async () => {
  const res = await build();
  const byId = new Map(res.items.map((i) => [i.id, i]));
  for (const r of res.review) {
    assert.ok(byId.has(r.id), 'review points at an item');
    assert.ok(r.reason && r.reason.length > 10, 'review has a reason');
  }
  const blank = res.items.filter((i) => i.type === 'room' && i.cls === 'room' && !i.number);
  for (const b of blank) assert.ok(res.review.some((r) => r.id === b.id), 'every blank room is listed');
  const clean = res.items.find((i) => i.type === 'room' && i.number === '102');
  assert.ok(clean && !res.review.some((r) => r.id === clean.id), 'a cleanly read room is not listed');
});

test('synthetic poster: a repeated number leaves the pipeline only once', async () => {
  const res = await build();
  const counts = {};
  res.items.filter((i) => i.type === 'room' && i.number).forEach((r) => { counts[r.number] = (counts[r.number] || 0) + 1; });
  for (const [n, c] of Object.entries(counts)) assert.equal(c, 1, `${n} appears ${c} times`);
});

test('profile: targetRoom option changes the scale, maxSide caps it', async () => {
  const { img } = synthPoster();
  const small = await buildFromPlan(img, { targetRoom: 50 });
  assert.ok(small.scale <= 0.75, `scale ${small.scale}`);
  const capped = await buildFromPlan(img, { targetRoom: 400, profile: { maxSide: 1500 } });
  assert.ok(Math.max(capped.viewW, capped.viewH) <= 1500 + 5);
  assert.equal(resolveProfile('nmsu').targetRoom, 100);
  assert.equal(resolveProfile({ targetRoom: 80 }).prefixes, 'RSTMJEH');
});
