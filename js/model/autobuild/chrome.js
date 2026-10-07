// chrome.js
// Every NMSU evacuation poster has the same furniture around the plan: a maroon sidebar with the legend on one side and a
// grey caption band ("Emergency Evacuation Plan, <building>, <address>") along the bottom. Neither is part of the building,
// yet their text, boxes and edges produce phantom rooms and stretch the outline. This finds them by colour and paints them
// paper-white before AutoBuild looks at the plan. Pure; { width, height, data } RGBA in and out (a copy).
// Depends on: ./raster.js (components).

import { components } from './raster.js';

const isMaroon = (r, g, b) => r > 55 && r < 215 && g < 0.5 * r && b < 0.7 * r && r - g > 35;
// the caption's blue-grey band: dull, mid-dark, a touch bluer or neutral (paper is bright, plan lines are thin)
const isBand = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx >= 62 && mx <= 200 && mx - mn <= 42 && b >= r - 14; };

// The plan area of a poster photo: the paper between the sidebar and the caption band. -> { x0, y0, x1, y1 } | null (neither found)
export function posterRoi(img) {
  const { width: w, height: h } = img;
  const m = maskPosterChrome(img);
  if (!m.sidebar && !m.caption) return null;
  let x0 = 0, x1 = w - 1;
  if (m.sidebar) { if (m.sidebar.x0 === 0) x0 = Math.min(w - 2, m.sidebar.x1 + 1); else x1 = Math.max(1, m.sidebar.x0 - 1); }
  const y0 = 0, y1 = m.caption ? Math.max(1, m.caption.y0 - 1) : h - 1;
  return x1 - x0 > 0.3 * w && y1 - y0 > 0.3 * h ? { x0, y0, x1, y1 } : null;
}

// -> { img, sidebar: {x0,y0,x1,y1}|null, caption: {y0}|null }
export function maskPosterChrome(img) {
  const { width: w, height: h } = img, src = img.data;
  const maroon = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < maroon.length; i++, j += 4) if (isMaroon(src[j], src[j + 1], src[j + 2])) maroon[i] = 1;
  // the sidebar: the biggest tall maroon blob. Its legend (grey boxes on top of the maroon) lies inside its bounding box.
  let sidebar = null;
  const { comps } = components(maroon, w, h, 1, true);
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (bh < 0.35 * h || bw < 0.025 * w || bw > 0.4 * w || c.area < 0.012 * w * h) continue;
    if (!sidebar || c.area > sidebar.area) sidebar = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area };
  }
  // it hugs the left or the right side of the poster
  if (sidebar && !(sidebar.x0 < 0.18 * w || sidebar.x1 > 0.82 * w)) sidebar = null;
  // its real width: the columns that are maroon over a good part of the height (an exit sign next to it is maroon too, but short)
  if (sidebar) {
    const cols = new Int32Array(w);
    for (let y = sidebar.y0; y <= sidebar.y1; y++) for (let x = sidebar.x0; x <= sidebar.x1; x++) cols[x] += maroon[y * w + x];
    const need = 0.22 * (sidebar.y1 - sidebar.y0 + 1), left = sidebar.x0 < 0.18 * w, gapMax = Math.max(3, Math.round(0.03 * w));
    let edge = left ? sidebar.x0 : sidebar.x1, gap = 0, last = edge;
    for (let x = edge; left ? x <= sidebar.x1 : x >= sidebar.x0; x += left ? 1 : -1) {
      if (cols[x] >= need) { last = x; gap = 0; } else if (++gap > gapMax) break;
    }
    if (left) sidebar.x1 = last; else sidebar.x0 = last;
  }
  const out = new Uint8ClampedArray(src);
  const white = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) { const j = (y * w + x) * 4; out[j] = out[j + 1] = out[j + 2] = 255; out[j + 3] = 255; }
  };
  let sx0 = 0, sx1 = -1;
  if (sidebar) {
    const pad = Math.round(0.012 * w);
    const left = sidebar.x0 < 0.18 * w;
    sx0 = left ? 0 : Math.max(0, sidebar.x0 - pad); sx1 = left ? Math.min(w - 1, sidebar.x1 + pad) : w - 1;
    white(sx0, 0, sx1, h - 1);
  }
  // the caption band: rows (in the lower half, beside the sidebar) that are mostly band-coloured
  const colA = sx1 < 0.5 * w ? sx1 + 1 : 0, colB = sx0 > 0.5 * w ? sx0 - 1 : w - 1;
  const rowHit = new Float32Array(h);
  for (let y = Math.floor(0.45 * h); y < h; y++) {
    let n = 0, t = 0;
    for (let x = colA; x <= colB; x += 2) { const j = (y * w + x) * 4; t++; if (isBand(src[j], src[j + 1], src[j + 2])) n++; }
    rowHit[y] = t ? n / t : 0;
  }
  // longest run of rows with >= 55% band colour (a gap of a few rows for the caption's text is allowed)
  let best = null, run = null, gap = 0;
  for (let y = Math.floor(0.45 * h); y < h; y++) {
    if (rowHit[y] >= 0.55) { if (!run) run = { y0: y, y1: y }; run.y1 = y; gap = 0; } else if (run && ++gap > Math.max(4, 0.012 * h)) { if (!best || run.y1 - run.y0 > best.y1 - best.y0) best = run; run = null; gap = 0; }
  }
  if (run && (!best || run.y1 - run.y0 > best.y1 - best.y0)) best = run;
  let caption = null;
  if (best && best.y1 - best.y0 >= 0.04 * h && best.y1 >= 0.8 * h) {
    caption = { y0: Math.max(0, best.y0 - Math.round(0.006 * h)) };
    white(0, caption.y0, w - 1, h - 1);
  }
  return { img: { width: w, height: h, data: out }, sidebar: sidebar ? { x0: sx0, y0: 0, x1: sx1, y1: h - 1 } : null, caption };
}
