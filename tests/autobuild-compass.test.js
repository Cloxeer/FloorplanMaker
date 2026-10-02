// autobuild-compass.test.js
// findCompassBest: ring / needle / "N" cues on synthetic posters (several compass styles, angles,
// scales, corners) and false-positive checks on plans without a compass.

import test from 'node:test';
import assert from 'node:assert/strict';
import { poster, addCompass, drawLine } from './autobuild-geometry.helpers.js';
import { INK, angErr, detect, drawN, ring, needleStyle, starStyle, arrowStyle } from './autobuild-compass.helpers.js';

const SPOTS = [[90, 80], [900, 80], [90, 690], [900, 690]];

test('compass: helper style (ring, tapered needle, N) in every corner and angle', () => {
  for (const [cx, cy] of [SPOTS[0], SPOTS[3]]) for (const deg of [0, 25, 100, 190, 300]) {
    const p = poster({ W: 1000, H: 760 });
    addCompass(p.img, cx, cy, 8, deg);
    const c = detect(p);
    assert.ok(c, `found at ${cx},${cy} deg ${deg}`);
    assert.ok(Math.hypot(c.x - cx, c.y - cy) < 5, `centre ${c.x},${c.y}`);
    assert.ok(angErr(c.deg, deg) <= 10, `deg ${c.deg} vs ${deg}`);
  }
});

test('compass: hairline needle through a ring, N tilted with it or upright', () => {
  for (const [cx, cy] of [SPOTS[1], SPOTS[2]]) for (const deg of [28, 160, 265]) for (const tilted of [true, false]) {
    const p = poster({ W: 1000, H: 760 });
    needleStyle(p.img, cx, cy, 10, deg, tilted);
    const c = detect(p);
    assert.ok(c, `found ${cx},${cy} ${deg} tilted=${tilted}`);
    assert.ok(Math.hypot(c.x - cx, c.y - cy) < 6, 'centre');
    assert.ok(angErr(c.deg, deg) <= 10, `deg ${c.deg} vs ${deg}`);
  }
});

test('compass: four-point star and plain arrow with an N', () => {
  for (const [cx, cy] of [SPOTS[1], SPOTS[2]]) for (const deg of [0, 40, 210]) {
    for (const draw of [starStyle, arrowStyle]) {
      const p = poster({ W: 1000, H: 760 });
      draw(p.img, cx, cy, 10, deg);
      const c = detect(p);
      assert.ok(c, `${draw.name} at ${cx},${cy} deg ${deg}`);
      assert.ok(Math.hypot(c.x - cx, c.y - cy) < (draw === arrowStyle ? 32 : 14), `centre ${c.x},${c.y}`);
      // a plain arrow has no ring or filled half to say which end is north: its axis must be right (the N decides the end)
      const e = draw === arrowStyle ? Math.min(angErr(c.deg, deg), angErr(c.deg, deg + 180)) : angErr(c.deg, deg);
      assert.ok(e <= 14, `${draw.name} deg ${c.deg} vs ${deg}`);
    }
  }
});

test('compass: scales (small and large) and a thick-walled style', () => {
  for (const [r, style, textH] of [[6, { W: 700, H: 540 }, 6], [18, { W: 1600, H: 1200, t: 3 }, 16], [9, { t: 6 }, 8]]) {
    const p = poster(style);
    const W = p.img.width, H = p.img.height;
    needleStyle(p.img, W - 90, 80, r, 30, true);
    const c = detect(p, textH);
    assert.ok(c, `r ${r}`);
    assert.ok(Math.hypot(c.x - (W - 90), c.y - 80) < 6, 'centre');
    assert.ok(angErr(c.deg, 30) <= 10, `deg ${c.deg}`);
    void H;
  }
});

test('compass: none on plans without one (null, no guess)', () => {
  for (const style of [{}, { t: 6 }, { noise: 14, paper: 200, wall: 60 }, { cols: 7 }]) {
    assert.equal(detect(poster({ W: 1000, H: 760, ...style })), null);
  }
});

test('compass: lookalikes are not compasses (lone ring, lone N, a long line, ring + stray text-sized marks)', () => {
  const lone = [
    (img) => ring(img, 900, 80, 10),
    (img) => drawN(img, 900, 80, 14, 0),
    (img) => drawLine(img, 700, 60, 960, 60, 2, INK),
    (img) => { ring(img, 900, 690, 9); ring(img, 940, 690, 9); ring(img, 860, 690, 9); }, // door-swing-like rings
  ];
  for (const f of lone) { const p = poster({ W: 1000, H: 760 }); f(p.img); assert.equal(detect(p), null); }
});
