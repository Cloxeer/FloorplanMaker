// autobuild-rectify-real.test.js
// Real posters distorted with KNOWN distortions (tools/autobuild-distort-lib.mjs): rectify must straighten
// them, keep the plan inside the crop, stay idempotent, and AutoBuild must find about as many rooms as on
// the clean photo. Runs only when AUTOBUILD_PNG_DIR holds jett.png / sci.png / hjlcbig.png and pngjs is
// found (TESS_NODE_MODULES); otherwise skipped. Full table: node tools/autobuild-distort.mjs <poster.png>.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { requireDeps, loadPng } from '../tools/autobuild-eval.mjs';
import { rectify } from '../js/model/autobuild/rectify.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { perspective, noise, gradient, placeInPhoto } from '../tools/autobuild-distort-lib.mjs';

const dir = process.env.AUTOBUILD_PNG_DIR;
const deps = dir && fs.existsSync(path.join(dir, 'jett.png')) ? requireDeps() : null;
const skip = !deps && 'needs AUTOBUILD_PNG_DIR (jett.png, sci.png, hjlcbig.png) and pngjs (TESS_NODE_MODULES)';
// rooms found on the clean poster by the current code without OCR (jett 21 / sci 92 / hjlcbig 49 with it)
const GOLDEN = { jett: 20, sci: 92, hjlcbig: 48 };

const rooms = async (img) => (await buildFromPlan(img, { ocr: null })).items.filter((i) => i.type === 'room').length;
const remaining = (img) => {
  const r = rectify(img);
  const a = [...r.tilt.h, ...r.tilt.v].map(Math.abs).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
};

for (const name of ['jett', 'sci', 'hjlcbig']) {
  const file = dir && path.join(dir, name + '.png');
  test(`${name}: clean rooms near the golden count, rectify idempotent`, { skip: skip || !fs.existsSync(file) }, async () => {
    const photo = loadPng(deps.PNG, file);
    const r = rectify(photo);
    assert.ok(r && r.quality.planFound, 'plan found');
    assert.ok(r.quality.score >= 0.6, `quality ${r.quality.score} ${r.quality.warnings}`);
    const n = await rooms(r.image);
    assert.ok(Math.abs(n - GOLDEN[name]) <= 5, `${n} rooms vs golden ${GOLDEN[name]}`);
    const again = rectify(r.image);
    assert.ok(Math.abs(again.fit[0] * 57.3) < 0.3, 'second pass turns under 0.3 degree');
    assert.ok(Math.abs(again.image.width / r.image.width - 1) < 0.03 && Math.abs(again.image.height / r.image.height - 1) < 0.03, 'crop within 3%');
  });

  test(`${name}: rotated, keystoned, small in the photo, noisy and unevenly lit photos give about the same plan`, { skip: skip || !fs.existsSync(file) }, async () => {
    const photo = loadPng(deps.PNG, file);
    const clean = await rooms(rectify(photo).image);
    const variants = {
      rot3: perspective(photo, { rot: 3 }).image,
      keystone: perspective(photo, { tilt: 10, turn: -8 }).image,
      small: placeInPhoto(photo, 0.6).image,
      noise8: noise(photo, 8),
      gradient: gradient(photo, 0.4),
    };
    for (const [v, img] of Object.entries(variants)) {
      const r = rectify(img);
      assert.ok(r, `${v}: plan found`);
      assert.ok(remaining(r.image) < 1, `${v}: straight`);
      const n = await rooms(r.image);
      assert.ok(Math.abs(n - clean) <= 0.25 * clean, `${v}: ${n} rooms vs ${clean}`);
    }
  });
}
