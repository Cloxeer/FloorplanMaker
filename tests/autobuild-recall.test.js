// autobuild-recall.test.js
// Room-cell recall: cells under the translucent You-Are-Here pin, cells with a red symbol on a wall,
// tiny cells, a wall with a door gap, and (just as important) things that must NOT become rooms.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/model/autobuild/layers.js';
import { extractFaces } from '../js/model/autobuild/faces.js';
import { recoverUnlabeledCells } from '../js/model/autobuild/recall.js';
import { makeImage } from '../js/model/autobuild/raster.js';
import { fillRect, strokeRect, drawLine } from './autobuild-geometry.helpers.js';

const WALL = [30, 30, 30], T = 3, TEXTH = 8;

function paper() {
  const img = makeImage(1600, 1000, 255);
  strokeRect(img, 100, 100, 1500, 900, T, WALL); // the building
  return img;
}
const label = (img, cx, cy, w = 22, h = TEXTH) => fillRect(img, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, [40, 40, 40]);

function disc(img, cx, cy, r, rgb, rim) {
  const { width: w, data } = img;
  for (let y = cy - r - 6; y <= cy + r + 6; y++) for (let x = cx - r - 6; x <= cx + r + 6; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r + rim) continue;
    const c = d > r ? [25, 35, 60] : rgb;
    const i = (y * w + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
  }
}

function recover(img, extra = {}) {
  const { width: w, height: h } = img;
  const layers = analyze(img);
  const F1 = extractFaces(img, layers, { closeR: 1 });
  const footArea = F1.footMask.reduce((s, v) => s + v, 0);
  const got = recoverUnlabeledCells(F1, layers, { w, h, textH: TEXTH, footArea, taken: [], icons: [], ...extra });
  return { got, F1, layers };
}
const hit = (got, x, y) => got.find((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);

const box = (img, x0, y0, x1, y1) => strokeRect(img, x0, y0, x1, y1, T, WALL);

test('cells in a plain grid are all found, a blank walled gap is not', () => {
  const img = paper();
  const cells = [[120, 120, 320, 280], [320, 120, 520, 280], [520, 120, 720, 280], [120, 280, 320, 440], [520, 280, 720, 440]];
  for (const c of cells) { box(img, ...c); label(img, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2); }
  box(img, 320, 280, 520, 440); // blank paper inside walls
  const { got } = recover(img);
  for (const c of cells) assert.ok(hit(got, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2), `cell ${c}`);
  assert.equal(hit(got, 420, 360), undefined, 'a blank walled gap is not a room');
});

test('a room hidden under the translucent pin is rebuilt from the faint walls and its numbers', () => {
  const img = paper();
  box(img, 120, 120, 320, 280); label(img, 220, 200);
  // a cell (390..510 x 240..340) sitting fully under a pin; walls and number seen faintly through the tint
  disc(img, 450, 290, 92, [50, 90, 180], 5);
  strokeRect(img, 390, 240, 510, 340, 2, [38, 74, 150]);
  fillRect(img, 425, 300, 475, 312, [30, 55, 125]);
  const { got, layers } = recover(img);
  assert.ok(layers.pin, 'the pin is found');
  const c = hit(got, 450, 290);
  assert.ok(c, 'the cell under the pin is recovered');
  assert.equal(c.reason, 'under-pin');
  assert.ok(c.w > 80 && c.w < 150 && c.h > 70 && c.h < 130, `cell size ${c.w}x${c.h}`);
});

test('walls running behind the pin are carried straight across so the cells around it stay apart', () => {
  const img = paper();
  const q = [[250, 200, 450, 350], [450, 200, 650, 350], [250, 350, 450, 500], [450, 350, 650, 500]];
  for (const c of q) { box(img, ...c); label(img, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2); }
  disc(img, 450, 350, 45, [50, 90, 180], 5); // hides the crossing
  const { got } = recover(img);
  const found = q.map((c) => hit(got, (c[0] + c[2]) / 2, (c[1] + c[3]) / 2));
  assert.ok(found.every(Boolean), 'four cells');
  assert.equal(new Set(found).size, 4, 'four separate cells');
});

test('a red extinguisher or pull station on a wall does not merge or hide the cells', () => {
  const img = paper();
  box(img, 250, 200, 450, 350); box(img, 450, 200, 650, 350);
  label(img, 350, 275); label(img, 550, 275);
  fillRect(img, 444, 250, 456, 300, [200, 30, 30]); // red symbol sitting on the shared wall
  const { got } = recover(img);
  const a = hit(got, 350, 275), b = hit(got, 550, 275);
  assert.ok(a && b && a !== b);
});

test('tiny cells with a small number are recovered', () => {
  const img = paper();
  for (let k = 0; k < 4; k++) {
    const x = 150 + k * 40;
    strokeRect(img, x, 150, x + 40, 172, 2, WALL);
    label(img, x + 20, 161, 14, 5);
  }
  const { got } = recover(img);
  for (let k = 0; k < 4; k++) assert.ok(hit(got, 170 + k * 40, 161), `tiny cell ${k}`);
});

test('a number touching the walls cuts the cell in two pieces that are joined again', () => {
  const img = paper();
  box(img, 250, 200, 450, 420);
  fillRect(img, 250, 300, 450, 309, [40, 40, 40]); // number band spanning the cell width
  const { got } = recover(img);
  const c = hit(got, 350, 250);
  assert.ok(c, 'cell above the band');
  assert.ok(c.reason === 'split-cell' || c.h > 150, `rejoined (${c.reason}, ${c.h})`);
});

test('a door gap in a wall does not open the cell', () => {
  const img = paper();
  box(img, 250, 200, 450, 380);
  fillRect(img, 249, 280, 253, 282, [255, 255, 255]); // 2 px gap in the left wall (closed by the wall dilation)
  label(img, 350, 290);
  const { got } = recover(img);
  const c = hit(got, 350, 290);
  assert.ok(c && c.w < 230 && c.h < 200);
});

test('no false rooms: corridor strips, arrows, stair treads, double wall lines, symbols', () => {
  const img = paper();
  box(img, 150, 150, 750, 200); // corridor: long thin walled strip with an evacuation arrow
  fillRect(img, 300, 170, 400, 180, [30, 80, 170]); fillRect(img, 400, 165, 415, 185, [30, 80, 170]);
  box(img, 200, 300, 300, 400); // stair treads
  for (let y = 310; y < 400; y += 12) drawLine(img, 203, y, 297, y, 2, WALL);
  fillRect(img, 450, 300, 750, 303, WALL); fillRect(img, 450, 312, 750, 315, WALL); // double wall line
  box(img, 450, 400, 520, 450); fillRect(img, 455, 405, 515, 445, [190, 30, 30]); // red exit sign
  const { got } = recover(img);
  assert.equal(hit(got, 450, 175), undefined, 'corridor');
  assert.equal(hit(got, 250, 350), undefined, 'stair treads');
  assert.equal(hit(got, 600, 308), undefined, 'double wall line');
  assert.equal(hit(got, 485, 425), undefined, 'exit sign');
});

test('cells already made into rooms or symbols are not offered again', () => {
  const img = paper();
  box(img, 250, 200, 450, 350); box(img, 450, 200, 650, 350);
  label(img, 350, 275); label(img, 550, 275);
  const { got } = recover(img, { taken: [{ x: 250, y: 200, w: 200, h: 150 }] });
  assert.equal(hit(got, 350, 275), undefined);
  assert.ok(hit(got, 550, 275));
});
