// Scenes for the rectify robustness tests: the synthetic poster inside the clutter of a real photo
// (wall texture, dark frame, maroon sidebar with text, caption band, sleeve line), with the plan's
// true bounding box returned so a test can check the crop does not stretch to the clutter.
// Depends on: tests/autobuild-pipeline.helpers.js, tests/autobuild-geometry.helpers.js, tools/autobuild-distort-lib.mjs

import { synthPoster } from './autobuild-pipeline.helpers.js';
import { fillRect, rng } from './autobuild-geometry.helpers.js';
import { wallBackground } from '../tools/autobuild-distort-lib.mjs';
import { makeImage } from '../js/model/autobuild/raster.js';

// rows of tiny dark "text" bars (words) in a box
export function textBars(img, x0, y0, x1, y1, rgb, seed = 3) {
  const r = rng(seed);
  for (let y = y0; y + 9 < y1; y += 14) for (let x = x0; x + 10 < x1;) {
    const wd = 6 + Math.floor(r() * 28);
    fillRect(img, x, y, Math.min(x1, x + wd), y + 7, rgb);
    x += wd + 8;
  }
}

// opts: { frame, wall, sidebar, caption, sleeve }  (all default true)
export function clutterScene(opts = {}) {
  const o = { frame: true, wall: true, sidebar: true, caption: true, sleeve: true, ...opts };
  const { img: paper } = synthPoster();
  const PW = paper.width, PH = paper.height; // 1100 x 640; plan walls span x 100..1060, y 100..420
  const plan = { x0: 100, y0: 100, x1: 1060, y1: 420 };
  if (o.sidebar) { fillRect(paper, 0, 0, 92, PH, [120, 20, 35]); textBars(paper, 8, 60, 84, 400, [235, 235, 235]); fillRect(paper, 10, 420, 82, 520, [150, 175, 185]); textBars(paper, 12, 424, 80, 516, [20, 20, 20], 9); }
  if (o.caption) { fillRect(paper, 92, 500, PW, PH, [140, 170, 180]); textBars(paper, 110, 520, 900, 630, [15, 15, 15], 5); }
  const M = 150, frameT = o.frame ? 18 : 0;
  const W = PW + 2 * M, H = PH + 2 * M;
  const scene = o.wall ? wallBackground(W, H, 21, [165, 160, 152]) : makeImage(W, H, 235);
  if (o.frame) fillRect(scene, M - frameT, M - frameT, M + PW + frameT, M + PH + frameT, [18, 18, 18]);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const i = (y * PW + x) * 4, j = ((y + M) * W + x + M) * 4;
    scene.data[j] = paper.data[i]; scene.data[j + 1] = paper.data[i + 1]; scene.data[j + 2] = paper.data[i + 2];
  }
  if (o.sleeve) { // a thin plastic-sleeve edge line, a little inside the wall side of the frame
    const m = frameT + 14;
    fillRect(scene, M - m, M - m, M + PW + m, M - m + 2, [90, 90, 90]); fillRect(scene, M - m, M + PH + m - 2, M + PW + m, M + PH + m, [90, 90, 90]);
    fillRect(scene, M - m, M - m, M - m + 2, M + PH + m, [90, 90, 90]); fillRect(scene, M + PW + m - 2, M - m, M + PW + m, M + PH + m, [90, 90, 90]);
  }
  return { image: scene, plan: { x0: plan.x0 + M, y0: plan.y0 + M, x1: plan.x1 + M, y1: plan.y1 + M } };
}

// True when the quadrilateral `corners` (photo px) contains the box.
export function containsBox(corners, b, slack = 4) {
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  return Math.min(...xs) <= b.x0 + slack && Math.max(...xs) >= b.x1 - slack && Math.min(...ys) <= b.y0 + slack && Math.max(...ys) >= b.y1 - slack;
}
