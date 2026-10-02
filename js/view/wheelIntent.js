// wheelIntent.js
// What does one wheel event mean: a two-finger drag on a trackpad (move the map), a pinch (zoom), or a
// notch of a mouse wheel (zoom)? A single event cannot always tell: a fast two-finger flick sends whole
// numbers over 50 just like a mouse wheel does. So the classifier looks at the stream: a mouse wheel notch
// is ONE event, alone, of a standard size (100, 120 ...); a trackpad sends many events a few ms apart, so
// once a stream has started as a drag, every event in it is a drag, however big.
// Pure. Depends on: nothing.

const GAP = 90; // ms: events closer than this belong to one gesture

export function createWheelIntent() {
  let lastT = -Infinity, lastKind = null;
  const standardNotch = (dy) => { const a = Math.abs(dy); return Number.isInteger(dy) && a >= 50 && (a % 100 === 0 || a % 120 === 0 || a % 150 === 0); };
  // e: { deltaX, deltaY, deltaMode, ctrlKey, metaKey, timeStamp } -> 'pinch' | 'wheel' | 'drag'
  return function classify(e) {
    const t = Number.isFinite(e.timeStamp) ? e.timeStamp : Date.now();
    const gap = t - lastT;
    lastT = t;
    let kind;
    if (e.ctrlKey || e.metaKey) kind = 'pinch'; // a pinch, or ctrl + scroll: one continuous zoom
    else if (e.deltaMode !== 0) kind = 'wheel'; // lines / pages: only a mouse wheel does that
    else if (e.deltaX !== 0) kind = 'drag'; // sideways: a trackpad
    else if (gap <= GAP && lastKind === 'drag') kind = 'drag'; // inside a drag already
    else if (standardNotch(e.deltaY) && gap > GAP) kind = 'wheel'; // alone and notch-sized
    else if (gap <= GAP && lastKind === 'wheel' && standardNotch(e.deltaY)) kind = 'wheel'; // spinning a wheel quickly
    else kind = 'drag';
    lastKind = kind === 'pinch' ? lastKind : kind;
    return kind;
  };
}

// ---- how far one wheel / pinch event zooms, as a factor (>1 zooms in)
// One continuous rule for pinch and ctrl + scroll (so slow, fast and trailing "momentum" events all feel the
// same): proportional to the delta, with a cap so one big event never jumps. (Too strong a gain makes the zoom
// fly between its two extremes.) A plain mouse-wheel notch is a
// fixed 10% step, however many pixels the browser reports for it.
export function zoomFactor(e, kind) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dy = (e.deltaY || 0) * unit;
  if (kind === 'wheel') return 1.1 ** -Math.max(-3, Math.min(3, dy / 100));
  return Math.exp(-Math.max(-40, Math.min(40, dy)) * 0.005); // at most about 22% for one event; a pinch (1..8) is 0.5..4%
}

// Eases the zoom toward where the wheel / pinch is asking it to go, a little each animation frame, so a
// burst of events (or the tail of a gesture) glides instead of jumping. get() -> current zoom;
// set(zoom, x, y) applies a zoom about the point (x, y).
export function createZoomSmoother({ get, set, min = 0.05, max = 8, raf = (fn) => requestAnimationFrame(fn), caf = (id) => cancelAnimationFrame(id), ease = 0.4, maxStep = 0.04, maxPending = 0.3 }) {
  // maxStep: the most the zoom may change in one frame (log units, 0.04 = about 4%); maxPending: how far ahead
  // of the current zoom the target may run (0.3 = about 1.35x), so a long burst or a trackpad's trailing
  // momentum cannot queue up a long tail that keeps zooming after you let go.
  let target = null, x = 0, y = 0, id = 0;
  const step = () => {
    id = 0;
    if (target == null) return;
    const z = get();
    const want = Math.log(target / z);
    if (Math.abs(want) < 0.003) { set(target, x, y); target = null; return; }
    const move = Math.max(-maxStep, Math.min(maxStep, want * ease)); // a share of the way, never more than maxStep
    set(z * Math.exp(move), x, y);
    id = raf(step);
  };
  return {
    push(factor, px, py) {
      const z = get();
      const base = target == null ? z : target;
      let t = Math.max(min, Math.min(max, base * factor));
      t = Math.max(z * Math.exp(-maxPending), Math.min(z * Math.exp(maxPending), t));
      target = Math.max(min, Math.min(max, t));
      x = px; y = py;
      if (!id) id = raf(step);
    },
    cancel() { if (id) caf(id); id = 0; target = null; },
    active: () => target != null,
    target: () => target,
  };
}

// ---- axis lock for a two-finger drag
// Fingers never move perfectly straight: a drag meant to go straight up or down also carries a few pixels of
// sideways travel in nearly every event, and over a long drag (or many drags) that adds up, so the map creeps
// to one side until the plan is gone. Like native scrolling, a drag that is clearly mostly one direction
// ignores the small leftover in the other; a real diagonal drag keeps both. Judged over the whole gesture
// (events less than `gap` ms apart), not event by event.
// filter(dx, dy, timeStamp) -> [dx, dy]
export function createDragFilter({ gap = 150, ratio = 0.4, settle = 12 } = {}) {
  let sx = 0, sy = 0, last = -Infinity;
  return (dx, dy, t) => {
    const now = Number.isFinite(t) ? t : Date.now();
    if (now - last > gap) { sx = 0; sy = 0; }
    last = now;
    sx += Math.abs(dx); sy += Math.abs(dy);
    const major = Math.max(sx, sy), minor = Math.min(sx, sy);
    if (major < settle || minor / major >= ratio) return [dx, dy]; // too early to tell, or a real diagonal
    return sy >= sx ? [0, dy] : [dx, 0];
  };
}
