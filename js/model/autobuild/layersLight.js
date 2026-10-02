// layersLight.js
// Lighting side of layers: paper-brightness field (lightField), polarity / tint / dimness
// balance (flatten) and the photo's noise level. Pure.
// Depends on: js/model/autobuild/raster.js.

import { toGray, boxBlur, erode } from './raster.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// value at fraction p of a 0..255 histogram of `arr` (every `step`-th sample)
export function percentile(arr, p, step = 1) {
  const hist = new Int32Array(256);
  let n = 0;
  for (let i = 0; i < arr.length; i += step) { hist[arr[i]]++; n++; }
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p * n) return v; }
  return 255;
}

// Smooth paper-brightness field at low resolution: a max filter (ink and text vanish)
// then a blur. Returns a sampler (x, y) -> brightness.
export function lightField(gray, w, h, L, reach = 45) {
  const cell = Math.max(2, Math.round(L / 200));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const mx = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = ((y / cell) | 0) * gw + ((x / cell) | 0);
    if (gray[y * w + x] > mx[k]) mx[k] = gray[y * w + x];
  }
  const k = Math.max(2, Math.round(L / reach / cell));
  const tmp = new Uint8Array(gw * gh), big = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let d = -k; d <= k; d++) { const xx = clamp(x + d, 0, gw - 1); if (mx[y * gw + xx] > m) m = mx[y * gw + xx]; }
    tmp[y * gw + x] = m;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let d = -k; d <= k; d++) { const yy = clamp(y + d, 0, gh - 1); if (tmp[yy * gw + x] > m) m = tmp[yy * gw + x]; }
    big[y * gw + x] = m;
  }
  const smooth = boxBlur(big, gw, gh, k);
  const p90 = percentile(smooth, 0.9);
  const at = (x, y) => {
    const fx = clamp(x / cell - 0.5, 0, gw - 1), fy = clamp(y / cell - 0.5, 0, gh - 1);
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    return (smooth[y0 * gw + x0] * (1 - ax) + smooth[y0 * gw + x1] * ax) * (1 - ay) + (smooth[y1 * gw + x0] * (1 - ax) + smooth[y1 * gw + x1] * ax) * ay;
  };
  return { at, paper: Math.max(40, p90) };
}

// Photo -> working RGB copy: dark prints (blue-prints) inverted, strongly tinted paper
// colour-balanced. Also returns `light(x, y)` in 0.8..1: how much darker than the
// brightest paper this spot is (shadow), so absolute brightness limits can follow it.
export function flatten(img) {
  const { width: w, height: h } = img;
  const L = Math.max(w, h);
  const g0 = toGray(img);
  // light-on-dark print (blue-print): the strokes are brighter than their surroundings, not darker.
  // (A merely dark photo of a normal poster has dark strokes on a dim paper.)
  let inverted = false;
  const med = percentile(g0, 0.5, 7);
  if (med < 130 && percentile(g0, 0.8, 7) < 170) {
    const tau = Math.max(40, 0.35 * med); // clearly off the paper level, either way
    let lighter = 0, darker = 0;
    for (let i = 0; i < g0.length; i += 3) { if (g0[i] > med + tau) lighter++; else if (g0[i] < med - tau) darker++; }
    inverted = lighter > 2 * darker && lighter > 0.002 * (g0.length / 3);
    // a blue-print's light strokes are thin; a light poster on a dark wall is a wide bright area that survives
    // an erosion wider than a line
    if (inverted) {
      const bright = new Uint8Array(w * h);
      for (let i = 0; i < bright.length; i++) bright[i] = g0[i] > med + tau ? 1 : 0;
      const wide = erode(bright, w, h, Math.max(3, Math.round(L / 150)));
      let nb = 0, nw = 0;
      for (let i = 0; i < bright.length; i++) { nb += bright[i]; nw += wide[i]; }
      if (nw > 0.35 * nb) inverted = false;
    }
  }
  let src = img.data;
  if (inverted) { src = new Uint8ClampedArray(img.data); for (let i = 0; i < src.length; i += 4) { src[i] = 255 - src[i]; src[i + 1] = 255 - src[i + 1]; src[i + 2] = 255 - src[i + 2]; } }
  const gray = inverted ? g0.map((v) => 255 - v) : g0;
  const fld = lightField(gray, w, h, L);
  const light = (x, y) => clamp(fld.at(x, y) / fld.paper, 0.8, 1);
  // wide-reach version (sidebars and caption bands are narrower than its window): how much a shadow or
  // lighting gradient darkens the paper here, down to 0.45
  const big = lightField(gray, w, h, L, 30);
  const shade = (x, y) => clamp(big.at(x, y) / big.paper, 0.45, 1);
  // paper chroma: mean colour of pixels at paper brightness
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const i = y * w + x;
    if (gray[i] < 0.93 * fld.paper || gray[i] > 1.04 * fld.paper) continue;
    sum[0] += src[i * 4]; sum[1] += src[i * 4 + 1]; sum[2] += src[i * 4 + 2]; n++;
  }
  const pc = n > 200 ? sum.map((v) => v / n) : [fld.paper, fld.paper, fld.paper];
  // only strongly tinted paper (cream, blue-print) is colour-balanced; neutral paper keeps its levels
  const tinted = (Math.max(...pc) - Math.min(...pc)) / Math.max(1, Math.max(...pc)) > 0.1;
  // a dim photo (paper itself well under 185) is brightened so the fixed brightness limits keep their meaning
  const gain = fld.paper < 185 ? Math.min(2.2, 215 / fld.paper) : 1;
  let out = src;
  if (tinted || gain > 1) {
    out = new Uint8ClampedArray(src.length);
    const mx = Math.max(...pc);
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) out[i + c] = src[i + c] * gain * (tinted ? Math.min(3, mx / Math.max(30, pc[c])) : 1);
      out[i + 3] = 255;
    }
  }
  return { img: inverted || tinted || gain > 1 ? { width: w, height: h, data: out } : img, inverted, tinted, light, shade, paperLevel: fld.paper * gain };
}

// noise (sigma, gray levels) from the 3x3 high-pass residual of the flat paper
export function noiseSigma(gray, w, h) {
  const bl = boxBlur(gray, w, h, 1);
  const hist = new Int32Array(256);
  let n = 0;
  for (let i = 0; i < gray.length; i += 3) { hist[Math.abs(gray[i] - bl[i])]++; n++; }
  let acc = 0, med = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
  return med * 1.4826 * 1.2;
}

// Noise-averaging that keeps thin dark lines and small text: each pixel is replaced by its mean along
// the direction (horizontal, vertical, either diagonal; 2r+1 taps) in which its neighbourhood varies least,
// i.e. along a stroke rather than across it. Strokes keep their contrast and do not fatten, flat paper
// loses its noise by about sqrt(2r+1). A 3x3 average would fade 1-2 px lines.
export function lineDenoise(gray, w, h, r = 3) {
  const out = new Uint8Array(w * h);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const rd = Math.max(1, Math.round(r * 0.7)); // diagonal taps are 1.4 px apart
  const cl = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity, bestMean = gray[y * w + x];
      for (let d = 0; d < 4; d++) {
        const dx = dirs[d][0], dy = dirs[d][1], rr = d < 2 ? r : rd;
        let s = 0, q = 0;
        for (let k = -rr; k <= rr; k++) { const v = gray[cl(y + k * dy, h - 1) * w + cl(x + k * dx, w - 1)]; s += v; q += v * v; }
        const n = 2 * rr + 1, m = s / n, vr = q / n - m * m;
        if (vr < bestVar) { bestVar = vr; bestMean = m; }
      }
      out[y * w + x] = bestMean + 0.5;
    }
  }
  return out;
}

// How blurred the photo is: the 25th percentile of the rise width (px) of strong edges (a sharp photo
// of a printed plan gives 2.0-2.6, extra blur of sigma 1 gives about 3, sigma 2 about 5; noise changes it little).
// Returns 0 when there are too few strong edges to tell.
export function edgeWidth(gray, w, h) {
  const ws = [];
  const s = (j) => Math.abs(gray[j + 1] - gray[j - 1]);
  for (let y = 5; y < h - 5; y += 1) {
    for (let x = 5; x < w - 5; x += 1) {
      const i = y * w + x;
      const D4 = gray[i + 4] - gray[i - 4];
      if (Math.abs(D4) < 70) continue;
      const c = s(i);
      if (c < s(i - 1) || c < s(i + 1) || c < 0.2 * Math.abs(D4)) continue; // a peak that holds the transition, not a flat spot beside one
      ws.push((2 * Math.abs(D4)) / Math.max(1, c));
    }
  }
  if (ws.length < 200) return 0;
  ws.sort((a, b) => a - b);
  return ws[ws.length >> 2];
}

// Undo a mild blur: unsharp mask with the blur radius estimated from the edge width. Returns gray itself when sharp.
export function sharpenIfBlurred(gray, w, h, ew = edgeWidth(gray, w, h)) {
  if (ew <= 2.9) return gray;
  const sig = Math.sqrt(Math.max(0, ew * ew - 2.4 * 2.4)) / 2.5; // extra blur, px
  const r = clamp(Math.round(sig * 1.4), 1, 3), amount = clamp(sig * 1.6, 0.8, 3);
  const bl = boxBlur(gray, w, h, r);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < out.length; i++) out[i] = clamp(gray[i] + amount * (gray[i] - bl[i]), 0, 255) + 0.5;
  return out;
}
