// autobuild-outline-fit.test.js
// AutoBuild outline quality: the outline hugs the real wall line, tiny non-wall steps disappear,
// every stretch is reported as wall or gap (nothing invented is hidden), and the ring stays closed
// and rectilinear.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRing, measureOutline, pullGaps, cleanRect } from '../js/model/autobuild/outlineFit.js';
import { buildFromPlan } from '../js/model/autobuild/pipeline.js';
import { synthPoster, fakeOcr } from './autobuild-pipeline.helpers.js';

const W = 700, H = 400;
function inkRect(x0, y0, x1, y1, t = 4, sides = 'tblr') {
  const m = new Uint8Array(W * H);
  const fill = (a, b, c, d) => { for (let y = b; y < d; y++) for (let x = a; x < c; x++) m[y * W + x] = 1; };
  if (sides.includes('t')) fill(x0, y0, x1 + t, y0 + t);
  if (sides.includes('b')) fill(x0, y1, x1 + t, y1 + t);
  if (sides.includes('l')) fill(x0, y0, x0 + t, y1 + t);
  if (sides.includes('r')) fill(x1, y0, x1 + t, y1 + t);
  return m;
}
const rectilinear = (p) => p.length >= 4 && p.every((a, i) => { const b = p[(i + 1) % p.length]; return a[0] === b[0] || a[1] === b[1]; });
const OPT = { minStep: 30, reach: 8, wallT: 4 };

test('fitRing: edges move onto the wall stripe (centre), ring stays closed and rectilinear', () => {
  const ink = inkRect(100, 100, 500, 300);
  const out = fitRing([[96, 104], [507, 104], [507, 297], [96, 297]], ink, W, H, OPT);
  assert.ok(rectilinear(out));
  const xs = out.map((p) => p[0]), ys = out.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...xs) - 102) <= 1 && Math.abs(Math.max(...xs) - 502) <= 1, `x ${xs}`);
  assert.ok(Math.abs(Math.min(...ys) - 102) <= 1 && Math.abs(Math.max(...ys) - 302) <= 1, `y ${ys}`);
});

test('fitRing: a double wall snaps to the outer line', () => {
  const ink = inkRect(100, 100, 500, 300, 3);
  const inner = inkRect(108, 108, 492, 292, 3);
  for (let i = 0; i < ink.length; i++) ink[i] |= inner[i];
  const out = fitRing([[104, 104], [504, 104], [504, 304], [104, 304]], ink, W, H, { ...OPT, reach: 10, wallT: 3 });
  assert.ok(Math.min(...out.map((p) => p[1])) <= 103, 'top on the outer line, not the inner one');
  assert.ok(Math.max(...out.map((p) => p[1])) >= 301);
});

test('fitRing: a small notch that is not a wall disappears; a real wall step stays', () => {
  const ink = inkRect(100, 100, 500, 300);
  const notch = [[102, 102], [250, 102], [250, 112], [262, 112], [262, 102], [502, 102], [502, 302], [102, 302]];
  const out = fitRing(notch, ink, W, H, OPT);
  assert.equal(out.length, 4, `notch gone: ${JSON.stringify(out)}`);
  assert.ok(rectilinear(out));
  // a real step: the poster has an extra wall block 80 px wide
  const m = inkRect(100, 100, 500, 300);
  for (let y = 300; y < 340; y++) for (let x = 100; x < 104; x++) m[y * W + x] = 1; // side walls going down
  for (let y = 300; y < 340; y++) for (let x = 180; x < 184; x++) m[y * W + x] = 1;
  for (let y = 338; y < 342; y++) for (let x = 100; x < 184; x++) m[y * W + x] = 1;
  const step = [[102, 102], [502, 102], [502, 302], [182, 302], [182, 340], [102, 340]];
  const kept = fitRing(step, m, W, H, OPT);
  assert.equal(kept.length, 6, `real step stays: ${JSON.stringify(kept)}`);
});

test('fitRing is idempotent', () => {
  const ink = inkRect(100, 100, 500, 300);
  const once = fitRing([[96, 104], [507, 104], [507, 112], [520, 112], [520, 104], [507, 104], [507, 297], [96, 297]], ink, W, H, OPT);
  const twice = fitRing(once, ink, W, H, OPT);
  assert.deepEqual(twice, once);
});

test('measureOutline: walls on all sides -> coverage ~1 and no gap', () => {
  const ink = inkRect(100, 100, 500, 300);
  const info = measureOutline([[102, 102], [502, 102], [502, 302], [102, 302]], ink, W, H, 1, { tol: 3 });
  assert.ok(info.coverage >= 0.95, `coverage ${info.coverage}`);
  assert.equal(info.segments.filter((s) => s.kind === 'gap').length, 0);
  for (const s of info.segments) assert.ok(s.supported >= 0.6 && s.a.length === 2 && s.b.length === 2);
});

test('measureOutline: one wall missing -> exactly one gap, on that side; a door opening is bridged', () => {
  const ink = inkRect(100, 100, 500, 300, 4, 'tbl'); // right wall missing
  for (let y = 180; y < 204; y++) for (let x = 98; x < 108; x++) ink[y * W + x] = 0; // a door in the left wall
  const info = measureOutline([[102, 102], [502, 102], [502, 302], [102, 302]], ink, W, H, 1, { tol: 3, hole: 40 });
  const gaps = info.segments.filter((s) => s.kind === 'gap');
  assert.equal(gaps.length, 1, JSON.stringify(gaps));
  assert.ok(gaps[0].a[0] === 502 && gaps[0].b[0] === 502, 'the gap is the right side');
  assert.ok(info.coverage > 0.75 && info.coverage < 0.9, `coverage ${info.coverage}`);
  assert.ok(info.notes.some((n) => /no wall/.test(n)));
});

test('an invented closing line across paper margin is flagged, and pullGaps shortens it to the rooms', () => {
  const ink = inkRect(100, 100, 400, 300, 4, 'tlr'); // no bottom wall; the outline closes far below
  const ring = [[102, 102], [402, 102], [402, 380], [102, 380]];
  const info = measureOutline(ring, ink, W, H, 1, { tol: 3 });
  const bottom = info.segments.filter((s) => s.a[1] === 380 && s.b[1] === 380);
  assert.ok(bottom.length && bottom.every((s) => s.kind === 'gap'), 'bottom closing line is a gap');
  const items = [{ x: 110, y: 110, w: 280, h: 190 }];
  const pulled = pullGaps(ring, items, ink, W, H, 1, { tol: 3, minPull: 15 });
  assert.ok(rectilinear(pulled));
  assert.equal(Math.max(...pulled.map((p) => p[1])), 300, 'closing line moved up to the rooms');
});

test('cleanRect drops repeated and collinear points', () => {
  assert.deepEqual(cleanRect([[0, 0], [5, 0], [10, 0], [10, 10], [10, 10], [0, 10]]), [[0, 0], [10, 0], [10, 10], [0, 10]]);
});

test('pipeline: synthetic poster reports outlineInfo; closed walls -> high coverage, rectilinear, consistent', async () => {
  const { img } = synthPoster();
  const res = await buildFromPlan(img, { ocr: async (im) => fakeOcr(im) });
  const oi = res.outlineInfo;
  assert.ok(oi && Array.isArray(oi.segments) && oi.segments.length >= 4);
  assert.ok(oi.coverage >= 0.8, `coverage ${oi.coverage}`);
  assert.ok(Array.isArray(oi.notes));
  for (const s of oi.segments) assert.ok(['wall', 'gap'].includes(s.kind) && s.supported >= 0 && s.supported <= 1);
  // the segments run along floor.points exactly: same coordinate system, same ring
  const pts = res.floor.points;
  for (const s of oi.segments) {
    const onEdge = pts.some((a, i) => { const b = pts[(i + 1) % pts.length]; const within = (v, p, q) => v >= Math.min(p, q) - 0.2 && v <= Math.max(p, q) + 0.2; return within(s.a[0], a[0], b[0]) && within(s.a[1], a[1], b[1]) && within(s.b[0], a[0], b[0]) && within(s.b[1], a[1], b[1]); });
    assert.ok(onEdge, 'segment lies on an outline edge');
  }
  assert.ok(rectilinear(pts));
  assert.ok(Array.isArray(res.outlinePx) && res.outlinePx.length >= 4, 'pre-scale polygon kept');
});

test('pipeline: with one outer wall erased no wall is invented there', async () => {
  const { img } = synthPoster();
  // erase the top wall over the first three rooms (x 100..580, y 98..104)
  for (let y = 98; y < 104; y++) for (let x = 100; x < 580; x++) { const i = (y * img.width + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; }
  const res = await buildFromPlan(img, { ocr: async (im) => fakeOcr(im) });
  // wherever the outline still runs along the erased line (y ~ 100) it must say 'gap', never 'wall'
  for (const s of res.outlineInfo.segments) {
    const onErased = Math.abs(s.a[1] - 100) < 8 && Math.abs(s.b[1] - 100) < 8 && Math.min(s.a[0], s.b[0]) < 570 && Math.max(s.a[0], s.b[0]) > 110;
    if (onErased) {
      const lo = Math.max(110, Math.min(s.a[0], s.b[0])), hi = Math.min(570, Math.max(s.a[0], s.b[0]));
      assert.ok(s.kind === 'gap' || hi - lo < 20, `invented wall ${JSON.stringify(s)}`);
    }
  }
  assert.ok(res.outlineInfo.coverage >= 0.8, 'the rest still follows real walls');
});
