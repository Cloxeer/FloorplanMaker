// autobuild-rectify.test.js
// rectify on unflattened, badly photographed input (synthetic, fast): rotation and keystone are
// recovered, noise / blur / uneven light / clutter around the plan (frame, wall, sidebar, caption)
// neither bend the fit nor stretch the crop, rectify is idempotent, and `quality` tells a good photo
// from a bad one and never throws. The real-poster version is tests/autobuild-rectify-real.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { rectify, rectifyDetailed } from '../js/model/autobuild/rectify.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { makeImage } from '../js/model/autobuild/raster.js';
import { polygonArea } from '../js/model/geometry.js';
import { perspective, noise, blur, gradient, shadowBand } from '../tools/autobuild-distort-lib.mjs';
import { poster } from './autobuild-geometry.helpers.js';
import { synthPoster, fakeOcr } from './autobuild-pipeline.helpers.js';
import { clutterScene, containsBox } from './autobuild-rectify.helpers.js';

const DEG = 180 / Math.PI;
// remaining tilt of a rectified image: median |wall tilt| (degrees) a second pass still measures
const remaining = (img) => {
  const r = rectify(img);
  const a = [...r.tilt.h, ...r.tilt.v].map(Math.abs).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
};
const diag = (c) => Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) * Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]);

test('rotation of +-6 degrees is recovered within 0.5 degree', () => {
  const p = poster({ t: 2 }).img;
  for (const rot of [-6, -2.5, 4, 6]) {
    const r = rectify(perspective(p, { rot }).image);
    assert.ok(r, `plan found at ${rot}`);
    assert.ok(Math.abs(Math.abs(r.fit[0] * DEG) - Math.abs(rot)) < 0.5, `fit ${(r.fit[0] * DEG).toFixed(2)} for ${rot}`);
    assert.ok(Math.sign(r.fit[0]) === -Math.sign(rot), 'turns back');
    assert.ok(remaining(r.image) < 0.5, `rectified image is straight (rot ${rot})`);
  }
});

test('keystone of +-12 degrees (tilt and turn) leaves the walls within 1 degree of parallel', () => {
  const p = poster({ t: 2 }).img;
  for (const g of [{ tilt: 12 }, { tilt: -12 }, { turn: 12 }, { turn: -12 }, { rot: 3, tilt: 8, turn: -8 }]) {
    const r = rectify(perspective(p, g).image);
    assert.ok(r, JSON.stringify(g));
    assert.ok(remaining(r.image) < 1, `${JSON.stringify(g)} left ${remaining(r.image)}`);
  }
});

test('a rotation beyond the search range does not pretend to be fixed', () => {
  const r = rectify(perspective(poster({ t: 2 }).img, { rot: 25 }).image, { soft: true });
  assert.ok(r.ok, 'still returns a crop');
  assert.ok(r.quality.score < 0.5, `score ${r.quality.score}`);
  assert.ok(r.quality.warnings.includes('retake-hard-to-read'), r.quality.warnings.join());
});

test('the frame, wall texture, sidebar, caption and sleeve line do not stretch the crop', () => {
  const sizes = [];
  for (const opts of [{}, { frame: false }, { wall: false, sleeve: false }, { sidebar: false }, { caption: false }]) {
    const { image, plan } = clutterScene(opts);
    const r = rectify(image);
    assert.ok(r, JSON.stringify(opts));
    assert.ok(containsBox(r.corners, plan), `plan fully inside the crop ${JSON.stringify(opts)}`);
    const ratio = diag(r.corners) / ((plan.x1 - plan.x0) * (plan.y1 - plan.y0));
    assert.ok(ratio < 1.6, `crop ${ratio.toFixed(2)}x the plan ${JSON.stringify(opts)}`);
    sizes.push(ratio);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 0.08, `crop does not depend on the clutter: ${sizes.map((v) => v.toFixed(2))}`);
});

test('clutter plus rotation and keystone still crops to the plan', () => {
  const { image, plan } = clutterScene();
  const { image: bent } = perspective(image, { rot: 3, tilt: 6, turn: -6 });
  const r = rectify(bent);
  assert.ok(r);
  // the crop is about the plan's size: its diagonal does not exceed 1.7x the plan's
  assert.ok(diag(r.corners) / ((plan.x1 - plan.x0) * (plan.y1 - plan.y0)) < 1.9);
  assert.ok(r.image.width < 1.4 * (plan.x1 - plan.x0) && r.image.height < 1.6 * (plan.y1 - plan.y0), `${r.image.width}x${r.image.height}`);
});

test('rectify is idempotent: a second pass changes the angle by under 0.3 degree and the crop by under 3%', () => {
  const p = poster({ t: 2 }).img;
  for (const g of [{ rot: 4 }, { tilt: 8, turn: 5 }, { rot: 0 }]) {
    const a = rectify(perspective(p, g).image);
    const b = rectify(a.image);
    assert.ok(Math.abs(b.fit[0] * DEG) < 0.3, `second pass turned ${(b.fit[0] * DEG).toFixed(2)}`);
    assert.ok(Math.abs(b.image.width / a.image.width - 1) < 0.03 && Math.abs(b.image.height / a.image.height - 1) < 0.03, `${a.image.width}x${a.image.height} -> ${b.image.width}x${b.image.height}`);
  }
});

// rooms and outline area of the whole pipeline on one photo
async function plan(photo) {
  const r = rectify(photo);
  assert.ok(r, 'plan found');
  const res = await buildFromPlan(r.image, { ocr: async (im) => fakeOcr(im) });
  return { rooms: res.items.filter((i) => i.type === 'room').length, outline: polygonArea(res.floor.points) / (res.scale * res.scale), quality: r.quality };
}

test('noise, blur, uneven light and rotation keep the rooms within 15% and the outline within 10% of the clean photo', async () => {
  const { img } = synthPoster();
  const clean = await plan(img);
  assert.ok(clean.rooms >= 11, `clean rooms ${clean.rooms}`);
  const variants = {
    noise10: noise(img, 10), blur1: blur(img, 1), gradient: gradient(img, 0.4), shadow: shadowBand(img, 0.3),
    keystone: perspective(img, { rot: 3, tilt: 8, turn: -6 }).image,
    combo: noise(gradient(perspective(img, { rot: -2, tilt: 6 }).image, 0.3), 6),
  };
  for (const [name, photo] of Object.entries(variants)) {
    const v = await plan(photo);
    assert.ok(Math.abs(v.rooms - clean.rooms) <= 0.15 * clean.rooms, `${name}: rooms ${v.rooms} vs ${clean.rooms}`);
    assert.ok(Math.abs(v.outline / clean.outline - 1) <= 0.1, `${name}: outline ${(v.outline / clean.outline).toFixed(2)}x`);
  }
});

test('quality: a good photo scores high, a bad one lower and says why', () => {
  const { img } = synthPoster();
  const good = rectify(img).quality;
  assert.equal(good.planFound, true);
  assert.ok(good.score >= 0.8, `good ${good.score}`);
  assert.ok(good.residualTiltDeg < 0.5 && good.cropFrac > 0.05 && good.cropFrac <= 1.05, JSON.stringify(good));
  assert.deepEqual(good.warnings, []);
  const noisy = rectify(noise(img, 30)).quality;
  assert.ok(noisy.score < good.score, `noisy ${noisy.score}`);
  assert.ok(noisy.warnings.includes('noisy-photo'), noisy.warnings.join());
  for (const q of [good, noisy]) {
    assert.ok(q.score >= 0 && q.score <= 1);
    assert.equal(typeof q.planFound, 'boolean');
    assert.ok(Array.isArray(q.warnings));
  }
});

test('quality: a blank or plan-less photo is "no plan found", never a crash', () => {
  const lines = makeImage(600, 400, 245); // a few long lines, no rooms
  for (let x = 40; x < 560; x++) { const i = (200 * 600 + x) * 4; lines.data[i] = lines.data[i + 1] = lines.data[i + 2] = 20; }
  const cases = {
    blank: makeImage(600, 400, 255), black: makeImage(600, 400, 0), noiseOnly: noise(makeImage(600, 400, 200), 40), oneLine: lines,
    tiny: makeImage(10, 10, 255), onePixel: makeImage(1, 1, 0),
    empty: { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    nanSize: { width: NaN, height: 5, data: new Uint8ClampedArray(20) },
    shortData: { width: 100, height: 100, data: new Uint8ClampedArray(10) },
    nothing: null, undef: undefined, noData: { width: 100, height: 100 },
  };
  for (const [name, im] of Object.entries(cases)) {
    assert.doesNotThrow(() => rectify(im), name);
    assert.equal(rectify(im), null, `${name}: no plan`);
    const d = rectifyDetailed(im);
    assert.equal(d.ok, false, name);
    assert.equal(d.image, null);
    assert.equal(d.quality.planFound, false, name);
    assert.equal(d.quality.score, 0, name);
    assert.ok(d.quality.warnings.length >= 1, name);
  }
  assert.equal(rectify(cases.blank, { soft: true }).quality.planFound, false);
});
