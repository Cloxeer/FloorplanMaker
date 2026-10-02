// layers.js
// Colour layers of a photographed poster: black linework ("ink"), the red and
// green symbols (exit signs, extinguishers, pull stations), the blue pin/arrows
// and where the plan paper is. Adaptive: the paper level, lighting gradient,
// paper tint, polarity (light-on-dark prints), noise and line darkness are
// estimated per image, and every pixel radius scales with the image size.
// Pure; { width, height, data } in, Uint8Array masks out.
// Depends on: js/model/autobuild/{raster,recall,layersLight}.js.

import { toGray, boxBlur, dilate, erode, components } from './raster.js';
import { pinPass } from './recall.js';
import { flatten, noiseSigma, percentile, clamp, lineDenoise, sharpenIfBlurred, edgeWidth } from './layersLight.js';

export { flatten };

// A shadow or lighting gradient that darkens the paper to under 85% scales brightness limits with it;
// ordinary vignetting (85..100%) changes nothing.
const relax = (shade, lo) => (shade >= 0.85 ? 1 : clamp(shade, lo, 1));

// Typical wall thickness (px): width of the runs that cross long vertical/horizontal strokes.
export function wallThickness(ink, w, h, L, q = 0.5) {
  const longLen = Math.round(0.05 * L), maxT = Math.max(4, Math.round(0.025 * L));
  const runs = [];
  for (const alongX of [true, false]) {
    const P = alongX ? h : w, A = alongX ? w : h;
    for (let p = 0; p < P; p += 2) {
      let s = -1;
      for (let a = 0; a <= A; a++) {
        const on = a < A && ink[alongX ? p * w + a : a * w + p];
        if (on && s < 0) s = a;
        if (!on && s >= 0) {
          const len = a - s; s = -1;
          if (len < longLen) continue;
          // a long stroke along this axis: its thickness is the run across it at its middle
          const mid = (a - len / 2) | 0;
          let t = 1;
          for (let q = p + 1; q < P; q++) { if (!ink[alongX ? q * w + mid : mid * w + q]) break; t++; }
          for (let q = p - 1; q >= 0; q--) { if (!ink[alongX ? q * w + mid : mid * w + q]) break; t++; }
          if (t <= maxT) runs.push(t);
        }
      }
    }
  }
  if (runs.length < 10) return 2;
  runs.sort((x, y) => x - y);
  return runs[Math.floor(runs.length * q)];
}

// opts.contrast / opts.weak: override the adaptive thresholds (gray levels).
export function analyze(img0, opts = {}) {
  const { width: w, height: h } = img0;
  const L = Math.max(w, h);
  const fl = opts.flat === false ? { img: img0, inverted: false, light: () => 1, shade: () => 1, paperLevel: 255 } : flatten(img0);
  const img = fl.img, data = img.data;
  let gray = toGray(img);
  // noisy photo: averaged along the line directions first (noise drops ~2.5x, thin lines keep their contrast)
  const noisy = noiseSigma(gray, w, h) > 5;
  if (noisy) gray = lineDenoise(gray, w, h);
  const blurWidth = edgeWidth(gray, w, h);
  gray = sharpenIfBlurred(gray, w, h, blurWidth);
  const r0 = Math.max(5, Math.round(L / 160));
  // after the line-aware average the estimator still reads the leftover structure as noise: scaled back
  const sigma = noiseSigma(gray, w, h) * (noisy ? 0.65 : 1);
  const lightK = new Float32Array(w * h);
  const shadeK = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { lightK[y * w + x] = fl.light(x, y); shadeK[y * w + x] = fl.shade(x, y); }
  // a dim photo (paper itself at 130) lowers the paper brightness bar; a bright one keeps 140
  const paperMin = 140 * clamp(fl.paperLevel / 205, 0.6, 1);
  const red = new Uint8Array(w * h), blue = new Uint8Array(w * h), green = new Uint8Array(w * h);
  const sat = new Uint8Array(w * h);
  // noisy photo: colour decisions use 3x3-averaged channels (per-channel noise fakes red/blue on dark pixels)
  let cd = data;
  if (noisy) {
    cd = new Uint8ClampedArray(data.length);
    for (let c = 0; c < 3; c++) {
      const ch = new Uint8Array(w * h);
      for (let i = 0; i < ch.length; i++) ch[i] = data[i * 4 + c];
      const bl = boxBlur(ch, w, h, 1);
      for (let i = 0; i < ch.length; i++) cd[i * 4 + c] = bl[i];
    }
  }
  for (let i = 0, j = 0; i < sat.length; i++, j += 4) {
    const R = cd[j], G = cd[j + 1], B = cd[j + 2];
    const v = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat[i] = v ? Math.round(((v - mn) / v) * 255) : 0;
    if (R > G + 50 && R > B + 40 && R > 90) red[i] = 1;
    else if (B > R + 40 && B > G + 8 && B > 90) blue[i] = 1;
    else if (G > R + 32 && G > B + 18 && G > 80) green[i] = 1;
  }
  // big pastel patches are room tints (blue, green, pink fills), not symbols
  for (const m of [red, blue, green]) {
    const { labels, comps } = components(m, w, h, 1, true);
    const sums = new Float64Array(comps.length + 1);
    for (let i = 0; i < m.length; i++) if (labels[i]) sums[labels[i]] += sat[i];
    const tint = new Uint8Array(comps.length + 1);
    for (const c of comps) {
      const fill = c.area / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1));
      if (c.area > 0.002 * w * h && fill > 0.75 && sums[c.id] / c.area < 135) tint[c.id] = 1;
    }
    for (let i = 0; i < m.length; i++) if (labels[i] && tint[labels[i]]) m[i] = 0;
  }
  // ink = darker than the neighbourhood (window radius r); a wall thicker than the window is
  // darker than nothing around it, so the window grows to twice the wall thickness
  const inkPass = (r) => {
    const bg = boxBlur(gray, w, h, r);
    const dark = new Uint8Array(w * h);
    for (let i = 0; i < dark.length; i++) dark[i] = clamp(bg[i] - gray[i], 0, 255);
    const lineC = Math.max(25, percentile(dark, 0.992, 2));
    const contrast = opts.contrast || Math.max(lineC >= 45 ? 22 : 0.45 * lineC, (noisy ? 4.2 : 5) * sigma);
    const weakContrast = opts.weak || noisy ? Math.max(5, 1.8 * sigma) : Math.max(lineC >= 45 ? 9 : 0.18 * lineC, 2.5 * sigma);
    // faint-line prints (light grey on white): raise the absolute brightness cap to where the line pixels are
    const ch = new Int32Array(256);
    let cn = 0;
    for (let i = 0; i < gray.length; i += 2) if (gray[i] < bg[i] - contrast) { ch[gray[i]]++; cn++; }
    let med = 0;
    for (let v = 0, acc = 0; v < 256; v++) { acc += ch[v]; if (acc >= cn / 2) { med = v; break; } }
    const capS = clamp(med + 55, 175, 232), capW = capS + 25;
    const ink = new Uint8Array(w * h), weak = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < ink.length; i++, j += 4) {
      const v = Math.max(cd[j], cd[j + 1], cd[j + 2]);
      const k = lightK[i];
      const cs = relax(shadeK[i], 0.6);
      if (gray[i] < bg[i] - contrast * cs && gray[i] < capS * k && v < (capS + 40 + 8 * sigma) * k) ink[i] = 1;
      if (gray[i] < bg[i] - weakContrast * cs && gray[i] < capW * k && v < (capW + 25 + 8 * sigma) * k) weak[i] = 1;
    }
    return { bg, ink, weak, lineC, contrast, weakContrast };
  };
  let r = r0;
  let P = inkPass(r);
  {
    // wall thickness from clearly dark pixels (a thick wall's first-pass ink is only its two edges)
    const dk = new Uint8Array(w * h);
    for (let i = 0; i < dk.length; i++) dk[i] = gray[i] < 0.45 * fl.paperLevel && sat[i] < 90 ? 1 : 0;
    const t = Math.max(wallThickness(dk, w, h, L, 0.25), wallThickness(P.ink, w, h, L));
    if (t >= r0 * 0.9 + 1) { r = Math.min(Math.round(L / 40), Math.round(t * 2.2) + 2); P = inkPass(r); }
  }
  const { bg, ink, weak, lineC, contrast, weakContrast } = P;
  // hysteresis: faint line pixels count when they connect to strong ones
  {
    const { labels, comps } = components(weak, w, h, 1, true);
    const strong = new Uint8Array(comps.length + 1);
    for (let i = 0; i < ink.length; i++) if (ink[i] && labels[i]) strong[labels[i]] = 1;
    for (let i = 0; i < ink.length; i++) if (labels[i] && strong[labels[i]]) ink[i] = 1;
  }
  // coloured pixels (and their anti-aliased fringe) are not ink
  const colored = dilate(red.map((v, i) => (v | blue[i] | green[i]) & 1), w, h, 1);
  for (let i = 0; i < ink.length; i++) if (colored[i]) ink[i] = 0;
  // the translucent You-Are-Here pin: its walls and numbers are re-read from under the tint
  const pin = pinPass({ gray, blue, red, green, ink, colored, w, h });
  // paper: bright, unsaturated surroundings
  // (coloured symbols count as neutral so their halos don't read as caption)
  const satN = sat.map((v, i) => (colored[i] || ink[i] ? 0 : v));
  const satBlur = boxBlur(satN, w, h, r * 2);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < paper.length; i++) paper[i] = bg[i] >= paperMin * relax(shadeK[i], 0.55) && satBlur[i] < 40 ? 1 : 0;
  // frame: everything that is not paper and touches the photo edge (frame, sidebar, caption, wall):
  // the plan paper ends there, so it closes the plan like a wall does
  const frame = new Uint8Array(w * h);
  {
    const np = new Uint8Array(w * h);
    for (let i = 0; i < np.length; i++) np[i] = paper[i] ? 0 : 1;
    const { labels, comps } = components(np, w, h, 1);
    const edge = new Uint8Array(comps.length + 1);
    const mark = (i) => { if (labels[i]) edge[labels[i]] = 1; };
    for (let x = 0; x < w; x++) { mark(x); mark((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { mark(y * w); mark(y * w + w - 1); }
    const big = new Uint8Array(comps.length + 1);
    for (const c of comps) if (edge[c.id] && c.area > 0.004 * w * h) big[c.id] = 1;
    for (let i = 0; i < frame.length; i++) if (labels[i] && big[labels[i]]) frame[i] = 1;
  }
  const seal = sealPaperEdge(ink, frame, paper, w, h);
  const wallT = wallThickness(ink, w, h, L);
  const wallInk = mergeDoubleWalls(ink, paper, w, h, L);
  // half the thickness of a wall as faces see it (one stroke, or a merged double line): rooms grow by this to reach the centre line
  const wallHalf = Math.max(1, Math.round((wallInk === ink ? wallT : wallThickness(wallInk, w, h, L)) / 2));
  return {
    gray, bg, ink, red, blue, green, pin, paper, colored, frame, seal, wallInk, wallT, wallHalf,
    info: { inverted: fl.inverted, paperLevel: fl.paperLevel, sigma, lineC, contrast, weakContrast, noisy, blurWidth },
  };
}

// Keep only ink that sits on paper (drops frame edges, sidebar and caption text).
export function inkOnPaper(layers) {
  const out = layers.ink.slice();
  for (let i = 0; i < out.length; i++) if (!layers.paper[i]) out[i] = 0;
  return out;
}

// Walls drawn as two close parallel lines: long thin strips of free paper between
// ink strokes are filled, so the pair acts as one wall. Text counters, stair
// treads and other short gaps are left alone. Returns ink itself when nothing is filled.
export function mergeDoubleWalls(ink, paper, w, h, L) {
  const G = Math.max(3, Math.round(L / 110)); // widest gap that still counts as "one wall"
  const rd = G >> 1;
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = ink[i] ? 0 : 1;
  const open = dilate(erode(free, w, h, rd), w, h, rd);
  const thin = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < thin.length; i++) if (free[i] && !open[i] && paper[i]) { thin[i] = 1; any++; }
  if (!any) return ink;
  const { labels, comps } = components(thin, w, h, 1, true);
  const keep = new Uint8Array(comps.length + 1);
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (Math.max(bw, bh) >= 0.06 * L && c.area >= 0.06 * L * 2) keep[c.id] = 1;
  }
  const out = ink.slice();
  let filled = 0;
  for (let i = 0; i < out.length; i++) if (labels[i] && keep[labels[i]]) { out[i] = 1; filled++; }
  // only a print drawn in double lines throughout (the fill is as much as the ink itself); a few
  // incidental narrow gaps in an ordinary plan are left as they are
  let inkN = 0;
  for (let i = 0; i < ink.length; i++) inkN += ink[i];
  return filled > 0.5 * inkN ? out : ink;
}

// Where the plan is cut off by the paper edge, wall lines run into the frame and
// the rooms between them are open on that side. Draw a wall along the frame
// between every two wall ends that touch it (not too far apart).
function sealPaperEdge(ink, frame, paper, w, h) {
  const seal = new Uint8Array(w * h);
  const L = Math.max(w, h);
  const near = dilate(frame, w, h, Math.max(10, Math.round(L / 55)));
  const contact = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < contact.length; i++) if (ink[i] && paper[i] && near[i]) { contact[i] = 1; any++; }
  if (!any) return seal;
  const { comps } = components(dilate(contact, w, h, 2), w, h, 1, true);
  const pts = comps.filter((c) => c.area > 6).map((c) => [c.sx / c.area, c.sy / c.area]);
  if (pts.length < 2 || pts.length > 400) return seal;
  const far = dilate(frame, w, h, Math.max(10, Math.round(L / 55)));
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const dx0 = pts[b][0] - pts[a][0], dy0 = pts[b][1] - pts[a][1];
      const d = Math.hypot(dx0, dy0);
      if (d < 0.03 * L || d > 0.3 * L) continue;
      // along the paper edge: straight up/down or left/right, and nothing else touches in between
      const axisOff = Math.min(Math.abs(dx0), Math.abs(dy0));
      if (axisOff > 0.06 * d) continue;
      const alongX = Math.abs(dx0) > Math.abs(dy0);
      const lo = alongX ? Math.min(pts[a][0], pts[b][0]) : Math.min(pts[a][1], pts[b][1]);
      const hi = alongX ? Math.max(pts[a][0], pts[b][0]) : Math.max(pts[a][1], pts[b][1]);
      const lane = alongX ? (pts[a][1] + pts[b][1]) / 2 : (pts[a][0] + pts[b][0]) / 2;
      const between = pts.some((q, k) => k !== a && k !== b
        && (alongX ? q[0] : q[1]) > lo + 4 && (alongX ? q[0] : q[1]) < hi - 4
        && Math.abs((alongX ? q[1] : q[0]) - lane) < 0.03 * L);
      if (between) continue;
      let ok = 0;
      const N = 24;
      for (let k = 0; k <= N; k++) {
        const x = Math.round(pts[a][0] + ((pts[b][0] - pts[a][0]) * k) / N), y = Math.round(pts[a][1] + ((pts[b][1] - pts[a][1]) * k) / N);
        if (far[y * w + x]) ok++;
      }
      if (ok < 0.9 * (N + 1)) continue;
      const steps = Math.ceil(d);
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(pts[a][0] + ((pts[b][0] - pts[a][0]) * k) / steps), y = Math.round(pts[a][1] + ((pts[b][1] - pts[a][1]) * k) / steps);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) seal[yy * w + xx] = 1;
        }
      }
    }
  }
  return seal;
}
