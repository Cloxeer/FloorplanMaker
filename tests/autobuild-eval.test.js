// autobuild-eval.test.js
// (1) Unit checks of the evaluation harness metrics. (2) Golden regression on the real
// photos: runs only when converted PNGs and tesseract.js are available (set
// AUTOBUILD_PNG_DIR to the folder with jett.png / sci.png / hjlcbig.png, TESS_NODE_MODULES
// to the folder holding node_modules/{pngjs,tesseract.js}, TESS_LANG_PATH to eng.traineddata);
// otherwise skipped. Thresholds sit a little under the numbers measured when written.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { measure, GROUND_TRUTH, requireDeps, evaluate, makeTesseractOcr } from '../tools/autobuild-eval.mjs';

const room = (number, x, y, w = 100, h = 100, cls = 'room') => ({ id: number + x, type: 'room', cls, shape: 'rect', number, name: '', x, y, w, h });

test('measure: counts duplicates, overlaps, rectilinear outline and number accuracy', () => {
  const res = {
    scale: 1, review: [{}],
    floor: { points: [[0, 0], [300, 0], [300, 100], [0, 100]] },
    items: [room('101', 0, 0), room('101', 100, 0), room('102', 150, 0), room('', 300, 0), { type: 'stair' }],
  };
  const m = measure(res, ['101', '102', '103', 'ST1']);
  assert.equal(m.rooms, 4);
  assert.equal(m.numbered, 3);
  assert.equal(m.duplicates, 1);
  assert.equal(m.overlaps, 1, 'rooms at x=100 and x=150 overlap');
  assert.equal(m.rectilinear, true);
  assert.equal(m.right, 3); // 101, 102 and ST1 via the stair item
  assert.deepEqual(m.missing, ['103']);
  res.floor.points = [[0, 0], [300, 20], [300, 100], [0, 100]];
  assert.equal(measure(res, null).rectilinear, false);
});

test('ground truth lists are present', () => {
  assert.equal(GROUND_TRUTH.jett.split(' ').length, 20);
  assert.equal(GROUND_TRUTH.hjlcbig.split(' ').length, 50);
});

const dir = process.env.AUTOBUILD_PNG_DIR;
const deps = dir && fs.existsSync(path.join(dir, 'jett.png')) ? requireDeps() : null;
const golden = deps && deps.tesseract;

const LIMITS = {
  jett: { recall: 0.45, precision: 0.75, rooms: [15, 30] },
  hjlcbig: { recall: 0.8, precision: 0.9, rooms: [42, 70] },
  sci: { rooms: [60, 120] },
};

test('golden regression on the real posters', { skip: golden ? false : 'needs AUTOBUILD_PNG_DIR + tesseract.js', timeout: 240000 }, async () => {
  const pool = await makeTesseractOcr(deps.PNG, deps.tesseract);
  try {
    for (const name of Object.keys(LIMITS)) {
      const m = await evaluate(path.join(dir, name + '.png'), { ocr: (im, o) => pool.ocr(im, o) }, deps.PNG);
      const L = LIMITS[name];
      assert.equal(m.duplicates, 0, `${name}: duplicate numbers`);
      assert.equal(m.rectilinear, true, `${name}: outline straight`);
      assert.ok(m.overlaps <= 8, `${name}: overlaps ${m.overlaps}`);
      assert.ok(m.rooms >= L.rooms[0] && m.rooms <= L.rooms[1], `${name}: rooms ${m.rooms}`);
      if (L.recall) assert.ok(m.recall >= L.recall, `${name}: recall ${m.recall}`);
      if (L.precision) assert.ok(m.precision >= L.precision, `${name}: precision ${m.precision}`);
      assert.ok(m.ms < 30000, `${name}: ${m.ms} ms`);
    }
  } finally { await pool.close(); }
});
