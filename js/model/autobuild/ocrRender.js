// ocrRender.js
// Crops a text line out of the straightened plan and prepares it for the OCR engine: bicubic enlargement of the
// REAL grey pixels (not a mask of them), local contrast stretch, an optional sharpen and a crisp binarisation, then
// a white border. Tiny labels (7-12 px tall) read far better this way than from a bold mask. Pure.
// Depends on: nothing.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Catmull-Rom weights
function cr(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

// Bicubic enlargement of a w*h grey array by factor f -> { data: Float32Array, w, h } (values may leave 0..255 a little)
export function cubicUpscale(g, w, h, f) {
  const W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f));
  const tmp = new Float32Array(W * h);
  for (let x = 0; x < W; x++) {
    const sx = (x + 0.5) / f - 0.5, x1 = Math.floor(sx), wts = cr(sx - x1);
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += wts[k] * g[y * w + clamp(x1 - 1 + k, 0, w - 1)];
      tmp[y * W + x] = v;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) / f - 0.5, y1 = Math.floor(sy), wts = cr(sy - y1);
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += wts[k] * tmp[clamp(y1 - 1 + k, 0, h - 1) * W + x];
      out[y * W + x] = v;
    }
  }
  return { data: out, w: W, h: H };
}

function otsu(vals) {
  const hist = new Float64Array(256);
  for (const v of vals) hist[clamp(Math.round(v), 0, 255)]++;
  const total = vals.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// box { x0, y0, x1, y1 } in the plan image. opts: { height (target text height px, default 48), mode: 'soft'|'binary'|'sharp', pad, border }
// -> { data: Uint8Array, w, h }  black text on white, ready for Tesseract
export function renderCrop(gray, w, h, box, opts = {}) {
  const { height = 48, mode = 'binary', pad = 3, border = 20, keep = null } = opts; // keep(x, y) -> true for pixels that belong to the text (the rest becomes paper)
  const x0 = Math.max(0, box.x0 - pad), y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(w - 1, box.x1 + pad), y1 = Math.min(h - 1, box.y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = !keep || keep(x0 + x, y0 + y) ? gray[(y0 + y) * w + x0 + x] : 255;
  // contrast stretch from the crop's own extremes (paper level = high percentile, ink = low percentile)
  const sorted = Float32Array.from(crop).sort();
  const lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.9)];
  const span = Math.max(30, hi - lo);
  for (let i = 0; i < crop.length; i++) crop[i] = clamp(((crop[i] - lo) / span) * 255, 0, 255);
  const f = clamp(height / Math.max(4, box.y1 - box.y0 + 1), 1.5, 10);
  const up = cubicUpscale(crop, cw, ch, f);
  let d = up.data;
  if (mode === 'sharp' || mode === 'binary') { // unsharp: subtract a blurred copy (box blur radius ~ half a stroke at the new size)
    const r = Math.max(1, Math.round(f * 0.6));
    const bl = boxBlurF(d, up.w, up.h, r);
    d = d.map((v, i) => clamp(v + 1.4 * (v - bl[i]), 0, 255));
  }
  let outv = d;
  if (mode === 'binary') {
    const t = otsu(d);
    outv = d.map((v) => (v < t ? 0 : 255));
  }
  const W = up.w + 2 * border, H = up.h + 2 * border;
  const out = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < up.h; y++) for (let x = 0; x < up.w; x++) out[(y + border) * W + x + border] = clamp(Math.round(outv[y * up.w + x]), 0, 255);
  return { data: out, w: W, h: H };
}

function boxBlurF(a, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += a[y * w + clamp(x + r + 1, 0, w - 1)] - a[y * w + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}
