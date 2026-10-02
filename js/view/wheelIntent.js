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
    if (e.ctrlKey || e.metaKey) kind = Math.abs(e.deltaY) < 50 ? 'pinch' : 'wheel'; // pinch sends small deltas; ctrl + a wheel notch is big
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
