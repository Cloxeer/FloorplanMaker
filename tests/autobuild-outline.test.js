// autobuild-outline.test.js
// The AutoBuild outline must contain every room / hall / stair, stay rectilinear and keep doors on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeImage } from '../js/model/autobuild/raster.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { assemble } from '../js/model/autobuild/assemble.js';
import { resolveProfile } from '../js/model/autobuild/profile.js';
import { unionBody, extendOutline } from '../js/model/autobuild/outline.js';
import { pointInPolygon, nearestPointOnPolyline } from '../js/model/geometry.js';

const rectilinear = (pts) => pts.length >= 4 && pts.every((a, i) => { const b = pts[(i + 1) % pts.length]; return a[0] === b[0] || a[1] === b[1]; });
const corners = (it) => it.points || [[it.x, it.y], [it.x + it.w, it.y], [it.x, it.y + it.h], [it.x + it.w, it.y + it.h]];
const inOrOn = (pts, p) => [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]].some(([dx, dy]) => pointInPolygon([p[0] + dx, p[1] + dy], pts));

test('unionBody adds shapes that stick out of the footprint, without margins', () => {
  const w = 200, h = 120, foot = new Uint8Array(w * h);
  for (let y = 20; y < 100; y++) for (let x = 20; x < 120; x++) foot[y * w + x] = 1;
  const u = unionBody(foot, [{ x: 100, y: 30, w: 60, h: 40 }], w, h, 6, 3);
  assert.equal(u[50 * w + 150], 1, 'sticking-out room is inside');
  assert.equal(u[50 * w + 170], 0, 'no balloon past the room');
  assert.equal(u[10 * w + 60], 0, 'no margin above the footprint');
});

test('extendOutline: shape outside gets its box added, still rectilinear', () => {
  const outline = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const room = { x: 80, y: 40, w: 60, h: 30 };
  const out = extendOutline(outline, [room, { x: 10, y: 10, w: 20, h: 20 }]);
  assert.ok(rectilinear(out));
  for (const c of corners(room)) assert.ok(inOrOn(out, c));
  assert.equal(extendOutline(outline, [{ x: 10, y: 10, w: 20, h: 20 }]), outline, 'untouched when all inside');
  const far = extendOutline(outline, [{ x: 300, y: 30, w: 40, h: 40 }]);
  for (const c of corners({ x: 300, y: 30, w: 40, h: 40 })) assert.ok(inOrOn(far, c), 'detached shape is bridged');
  assert.ok(rectilinear(far));
});

test('assemble: a room outside the traced outline is contained after assembly; no door is added for an exit sign', () => {
  const w = 300, h = 200, foot = new Uint8Array(w * h);
  for (let y = 20; y < 160; y++) for (let x = 20; x < 180; x++) foot[y * w + x] = 1;
  const poly = [[20, 20], [180, 20], [180, 160], [20, 160]];
  const kept = [
    { kind: 'rect', x: 30, y: 30, w: 60, h: 60, number: '101', name: '', votes: 3, cost: 0, f: {} },
    { kind: 'rect', x: 150, y: 40, w: 100, h: 60, number: '102', name: '', votes: 3, cost: 0, f: {} }, // sticks out
  ];
  const exits = [{ cx: 20, cy: 90, x: 14, y: 80, w: 12, h: 20 }];
  const res = assemble({ w, h, L: 300, textH: 10, kept, halls: [], elevators: [], stairs: [], exits, compass: null, footFinal: foot, polyRing: poly, prof: resolveProfile(), opts: {} });
  assert.ok(rectilinear(res.floor.points));
  for (const it of res.items.filter((i) => i.type === 'room')) for (const c of corners(it)) assert.ok(inOrOn(res.floor.points, c), 'room corner inside');
  assert.equal(res.items.filter((i) => i.type === 'door').length, 0);
});

test('pipeline: every item of a synthetic poster is inside the outline', async () => {
  const img = makeImage(700, 400, 255);
  const ink = [30, 30, 30];
  const box = (x0, y0, x1, y1) => {
    for (let t = 0; t < 3; t++) for (let x = x0; x <= x1; x++) for (const y of [y0 + t, y1 - t]) img.data.set([...ink, 255], (y * 700 + x) * 4);
    for (let t = 0; t < 3; t++) for (let y = y0; y <= y1; y++) for (const x of [x0 + t, x1 - t]) img.data.set([...ink, 255], (y * 700 + x) * 4);
  };
  for (let c = 0; c < 4; c++) { box(100 + c * 120, 100, 220 + c * 120, 200); box(100 + c * 120, 200, 220 + c * 120, 300); }
  const res = await buildFromPlan(img, { ocr: null });
  assert.ok(rectilinear(res.floor.points));
  for (const it of res.items.filter((i) => ['room', 'hall', 'stair'].includes(i.type))) for (const c of corners(it)) assert.ok(inOrOn(res.floor.points, c), `${it.type} corner inside`);
});
