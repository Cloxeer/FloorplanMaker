import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelIntent, zoomFactor, createZoomSmoother, createDragFilter, createMomentumCut } from '../js/view/wheelIntent.js';

const ev = (dy, t, o = {}) => ({ deltaX: 0, deltaY: dy, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: t, ...o });
const run = (list) => { const c = createWheelIntent(); return list.map((e) => c(e)); };

test('a slow two-finger drag moves the map', () => {
  assert.deepEqual(run([ev(3, 0), ev(7, 10), ev(12, 20), ev(20, 30)]), ['drag', 'drag', 'drag', 'drag']);
});

test('a fast flick (big whole numbers in a quick stream) still moves the map', () => {
  assert.deepEqual(run([ev(60, 0), ev(90, 8), ev(130, 16), ev(160, 24), ev(100, 32), ev(200, 40)]), ['drag', 'drag', 'drag', 'drag', 'drag', 'drag']);
});

test('a flick that happens to start on exactly 100 only zooms one step, then drags on', () => {
  const k = run([ev(100, 0), ev(130, 8), ev(150, 16), ev(100, 24)]);
  assert.equal(k[0], 'wheel');
  assert.deepEqual(k.slice(1), ['drag', 'drag', 'drag'].map((x, i) => (i === 2 ? 'drag' : x)));
});

test('mouse wheel notches (alone, 100 / 120) zoom, also several in a row', () => {
  assert.deepEqual(run([ev(100, 0), ev(-100, 400), ev(120, 900)]), ['wheel', 'wheel', 'wheel']);
  assert.deepEqual(run([ev(100, 0), ev(100, 40), ev(100, 80)]), ['wheel', 'wheel', 'wheel']); // spun quickly
});

test('pinch (ctrl + small deltas) zooms; ctrl + a big notch zooms; fractional or sideways deltas drag; lines mode is a wheel', () => {
  assert.deepEqual(run([ev(-4, 0, { ctrlKey: true }), ev(6, 10, { ctrlKey: true })]), ['pinch', 'pinch']);
  assert.equal(run([ev(100, 0, { ctrlKey: true })])[0], 'pinch'); // ctrl + scroll is one continuous zoom
  assert.equal(run([ev(7.5, 0)])[0], 'drag');
  assert.equal(run([ev(0, 0, { deltaX: 12 })])[0], 'drag');
  assert.equal(run([ev(3, 0, { deltaMode: 1 })])[0], 'wheel');
});

test('a pause ends a drag: the next lone notch zooms again', () => {
  assert.deepEqual(run([ev(5, 0), ev(9, 10), ev(100, 500)]), ['drag', 'drag', 'wheel']);
});

test('zoomFactor: continuous and capped for pinch / ctrl+scroll; a wheel notch is a fixed 10% step', () => {
  const f = (dy, kind, o = {}) => zoomFactor({ deltaY: dy, deltaMode: 0, ...o }, kind);
  assert.ok(f(-4, 'pinch') > 1 && f(4, 'pinch') < 1);
  assert.ok(f(-2, 'pinch') < f(-4, 'pinch') && f(-4, 'pinch') < f(-8, 'pinch'), 'bigger delta, bigger step');
  assert.equal(f(-40, 'pinch'), f(-500, 'pinch'), 'one huge event never jumps past the cap');
  assert.ok(f(-500, 'pinch') < 1.25, 'and the cap is gentle (about 22%)');
  assert.ok(Math.abs(f(-500, 'pinch') * f(500, 'pinch') - 1) < 1e-9, 'in and out cancel');
  assert.ok(Math.abs(f(-100, 'wheel') - 1.1) < 1e-9);
  assert.ok(Math.abs(f(-120, 'wheel') - 1.1 ** 1.2) < 1e-9);
  assert.ok(f(-100, 'wheel', { deltaMode: 1 }) > 1.1, 'lines mode counts for more');
});

test('zoom smoother: glides toward the target over several frames, merges a burst, never overshoots', () => {
  let z = 1, frames = [], seen = [];
  const raf = (fn) => { frames.push(fn); return frames.length; };
  const sm = createZoomSmoother({ min: 0.1, max: 8, get: () => z, set: (v) => { z = v; seen.push(v); }, raf, caf: () => { frames = []; } });
  for (let i = 0; i < 5; i++) sm.push(1.05, 5, 5); // a burst of five events in one frame
  assert.ok(Math.abs(sm.target() - 1.05 ** 5) < 1e-9);
  let n = 0;
  while (frames.length && n++ < 300) { const fn = frames.shift(); fn(); }
  assert.ok(seen.length >= 5, `eased over ${seen.length} frames`);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'monotonic: no spike back');
  assert.ok(Math.max(...seen) <= 1.05 ** 5 + 1e-9, 'no overshoot');
  assert.ok(Math.abs(z - 1.05 ** 5) < 1e-9, 'lands exactly on the target');
  assert.equal(sm.active(), false);
  // no frame changes the zoom by more than ~4%
  let prev = 1; for (const v of seen) { assert.ok(Math.abs(Math.log(v / prev)) <= 0.0401, 'step too big'); prev = v; }
  // cancel stops it
  sm.push(1.2, 0, 0); sm.cancel(); assert.equal(sm.active(), false);
});

test('zoom smoother: a long burst cannot queue a long tail, and the limits hold (no flying between two extremes)', () => {
  let z = 1, frames = [];
  const raf = (fn) => { frames.push(fn); return frames.length; };
  const sm = createZoomSmoother({ min: 0.1, max: 8, get: () => z, set: (v) => { z = v; }, raf, caf: () => { frames = []; } });
  for (let i = 0; i < 200; i++) sm.push(1.2, 0, 0); // a huge burst, e.g. a trackpad's momentum
  assert.ok(sm.target() <= Math.exp(0.3) + 1e-9, `target ${sm.target()}`);
  let n = 0; while (frames.length && n++ < 300) frames.shift()();
  assert.ok(z <= Math.exp(0.3) + 1e-9 && z > 1.2);
  // zooming out the same way comes back through the middle, not to the far end
  for (let i = 0; i < 200; i++) sm.push(1 / 1.2, 0, 0);
  n = 0; while (frames.length && n++ < 300) frames.shift()();
  assert.ok(z > 0.6 && z < 1.3, `z ${z}`);
  // the hard limits
  for (let r = 0; r < 20; r++) { sm.push(1.3, 0, 0); n = 0; while (frames.length && n++ < 300) frames.shift()(); }
  assert.equal(z, 8);
  for (let r = 0; r < 40; r++) { sm.push(1 / 1.3, 0, 0); n = 0; while (frames.length && n++ < 300) frames.shift()(); }
  assert.equal(z, 0.1);
});

test('drag filter: a straight vertical drag with a little sideways skew does not creep sideways', () => {
  const f = createDragFilter();
  let sumX = 0, sumY = 0;
  for (let i = 0; i < 40; i++) { const [x, y] = f(3, 20, i * 8); sumX += x; sumY += y; }
  assert.equal(sumY, 800, 'vertical travel is kept in full');
  assert.ok(sumX <= 12, `sideways creep ${sumX}`); // only the first few events, before the direction is clear
  // the same, the other way round
  const g = createDragFilter(); let ax = 0, ay = 0;
  for (let i = 0; i < 40; i++) { const [x, y] = g(-25, -2, i * 8); ax += x; ay += y; }
  assert.equal(ax, -1000); assert.ok(Math.abs(ay) <= 12);
});

test('drag filter: a real diagonal keeps both directions; a pause starts a new gesture', () => {
  const f = createDragFilter();
  let sx = 0, sy = 0;
  for (let i = 0; i < 30; i++) { const [x, y] = f(12, 15, i * 8); sx += x; sy += y; }
  assert.deepEqual([sx, sy], [360, 450]);
  // a new gesture after a pause: vertical, then sideways, each judged on its own
  const [a, b] = [f(0, 30, 2000), f(0, 30, 2008)];
  assert.deepEqual([a[1], b[1]], [30, 30]);
  const h = createDragFilter();
  for (let i = 0; i < 6; i++) h(2, 30, i * 8);
  const [lx] = h(40, 0, 3000); // 3 s later: a fresh gesture, so sideways travel is allowed again
  assert.equal(lx, 40);
});

test('momentum cut: fingers down (sizes jumping around) is never cut; the shrinking run after lift-off is', () => {
  const c = createMomentumCut();
  const noisy = [20, 18, 23, 19, 25, 17, 22, 21, 26, 18, 24, 20, 23, 19, 27, 22];
  noisy.forEach((m, i) => assert.equal(c(0, m, i * 8), false, `contact event ${i} was cut`));
  // lift-off: a steady run of shrinking events (the OS momentum)
  let v = 30, t = noisy.length * 8, dropped = 0, kept = 0;
  for (let i = 0; i < 40; i++) { const cut = c(0, v, t); if (cut) dropped++; else kept++; v *= 0.94; t += 8; }
  assert.ok(dropped >= 30, `dropped ${dropped} of 40`);
  assert.ok(kept <= 8, `kept ${kept} (the run has to show itself first)`);
});

test('momentum cut: a new push ends the cut, a pause starts afresh, slow even drags are untouched', () => {
  const c = createMomentumCut();
  let t = 0;
  [40, 38, 36, 34, 32, 30, 28, 26].forEach((m) => c(0, m, (t += 8)));
  assert.equal(c(0, 24, (t += 8)), true); // coasting is being dropped
  assert.equal(c(0, 60, (t += 8)), false); // a new, bigger movement: let it through
  assert.equal(c(0, 22, 5000), false); // a fresh gesture after a pause
  const slow = createMomentumCut();
  for (let i = 0; i < 60; i++) assert.equal(slow(0, 6, i * 16), false); // a steady slow drag
  const ramp = createMomentumCut();
  for (let i = 0; i < 30; i++) assert.equal(ramp(0, 5 + i, i * 8), false); // speeding up
});

test('a mouse-wheel notch zooms whatever its pixel size (display scaling / page zoom): wheelDeltaY is always whole 120s', () => {
  const notch = (dy, t, o = {}) => ev(dy, t, { wheelDeltaY: dy > 0 ? -120 : 120, ...o });
  for (const px of [80, 66.67, 53, 111.1, 125, 33.33]) {
    assert.deepEqual(run([notch(px, 0), notch(-px, 400)]), ['wheel', 'wheel'], `${px}px notch`);
  }
  assert.deepEqual(run([notch(80, 0), notch(80, 40), notch(80, 80)]), ['wheel', 'wheel', 'wheel']); // spun quickly
  // and a trackpad stream (small odd wheelDeltaY) still moves the map
  assert.deepEqual(run([ev(9, 0, { wheelDeltaY: -10 }), ev(14, 16, { wheelDeltaY: -17 }), ev(22, 32, { wheelDeltaY: -26 })]), ['drag', 'drag', 'drag']);
  // a flick that starts as a drag never turns into zoom steps, even when one event happens to read 120
  assert.deepEqual(run([ev(9, 0, { wheelDeltaY: -10 }), ev(100, 16, { wheelDeltaY: -120 }), ev(30, 32, { wheelDeltaY: -36 })]), ['drag', 'drag', 'drag']);
});

test('zoomFactor: a wheel notch is a 10% step whatever the pixel size', () => {
  const f = (dy, wd) => zoomFactor({ deltaY: dy, deltaMode: 0, wheelDeltaY: wd }, 'wheel');
  for (const px of [100, 80, 66.67, 53, 125]) {
    assert.ok(Math.abs(f(-px, 120) - 1.1) < 1e-9, `${px}px in`);
    assert.ok(Math.abs(f(px, -120) - 1 / 1.1) < 1e-9, `${px}px out`);
  }
  assert.ok(Math.abs(f(-240, 240) - 1.1 ** 2) < 1e-9, 'two notches reported as one event');
});

test('a small straight up / down stream is a two-finger drag', () => {
  assert.equal(createWheelIntent()(ev(7, 0)), 'drag');
});
