// rectify.js
// Straightens a photographed poster using the plan's own walls: measures how
// tilted the horizontal walls are in several bands and the vertical walls in
// several strips, fits a rotation + keystone homography that makes both
// families axis-aligned, then crops to the plan. No paper corners needed.
// Robust to noise, blur, uneven light and clutter around the plan (frame, wall, sidebar, caption):
// only long wall strokes of the biggest plan-like cluster count. When the fit is not trustworthy it
// falls back to rotation only, then to a plain crop, and says so in `quality`.
// Pure; { width, height, data } RGBA in and out.
// Depends on: js/model/autobuild/{raster,layers,rectifyFit,rectifyRegion,rectifyTilt,rectifyQuality}.js

import { downscale, warpSharp, components } from './raster.js';
import { analyze, inkOnPaper } from './layers.js';
import { mul, inv, apply, buildHc, fitHomography, fitResidual, residual, RAD } from './rectifyFit.js';
import { findPlanRegion } from './rectifyRegion.js';
import { tiltSamples } from './rectifyTilt.js';
import { buildQuality, failQuality, polyArea } from './rectifyQuality.js';
import { posterRoi } from './chrome.js';

const KEYSTONE_MAX = 0.6, SHEAR_MAX = 0.35;

// Fits the samples, drops the ones the fit cannot explain, refits. Returns { v, cost, used, rms, inlierFrac, mode }.
function robustFit(samples, L, mode) {
  let used = samples;
  let fit = fitHomography(used, L, mode);
  for (let pass = 0; pass < 2 && used.length > 3; pass++) {
    const Hc = buildHc(fit.v[0], fit.v[1] / L, fit.v[2] / L, fit.v[3]);
    const keep = used.filter((m) => Math.abs(residual(Hc, m.x, m.y, m.ang, m.kind)) < 1.0 * RAD);
    if (keep.length === used.length || keep.length < 3) break;
    used = keep;
    fit = fitHomography(used, L, mode);
  }
  const Hc = buildHc(fit.v[0], fit.v[1] / L, fit.v[2] / L, fit.v[3]);
  // the share of ALL samples the fit explains (outliers dropped above still count against it)
  const all = fitResidual(samples, Hc), inl = fitResidual(used, Hc);
  return { v: fit.v, cost: fit.cost, used, rms: inl.rms, rmsAll: all.rms, inlierFrac: all.inlierFrac, mode };
}

const sane = (v) => Math.abs(v[1]) <= KEYSTONE_MAX && Math.abs(v[2]) <= KEYSTONE_MAX && Math.abs(v[3]) <= SHEAR_MAX;

// Rectified crop rectangle (rect space) around the plan strokes, 7% padding.
function cropRect(mask, ww, wh, box, Hc, cx0, cy0) {
  const xs = [], ys = [];
  const stepPx = Math.max(1, Math.round(Math.sqrt(((box.x1 - box.x0) * (box.y1 - box.y0)) / 60000)));
  for (let y = box.y0; y <= box.y1; y += stepPx) for (let x = box.x0; x <= box.x1; x += stepPx) {
    if (!mask[y * ww + x]) continue;
    const p = apply(Hc, x - cx0, y - cy0);
    xs.push(p[0]); ys.push(p[1]);
  }
  if (xs.length < 50) return null;
  const q = (a, f) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * f)))]; };
  const cut = 0.01; // sparse extremes (a stair edge, a stray line) do not move the crop: keeps a second pass stable
  let rx0 = q(xs, cut), rx1 = q(xs, 1 - cut), ry0 = q(ys, cut), ry1 = q(ys, 1 - cut);
  const padX = (rx1 - rx0) * 0.07 + 6, padY = (ry1 - ry0) * 0.07 + 6;
  rx0 -= padX; rx1 += padX; ry0 -= padY; ry1 += padY;
  return { rx0, rx1, ry0, ry1 };
}

// Always returns an object: { ok, image, H, corners, tilt, fit, cost, quality }. ok is false (and image null)
// when no plan could be found; quality then says why.
// The straightening is only trusted when it looks right: a plan found, a decent score, a crop about the size of the
// plan. Otherwise the poster's own furniture (maroon sidebar, caption band) gives the plan area, the photo is cut to it
// and straightened again: wall texture and sleeve edges can no longer pull the crop off the plan.
const looksWrong = (r) => !r.ok || r.quality.score < 0.85 || r.quality.cropFrac > 1.0 || r.quality.cropFrac < 0.22;

// The biggest bright, unsaturated patch of the picture, cut out as it is. -> a rectify result or null
function paperCrop(img) {
  const { width: w, height: h } = img;
  const layers = analyze(img);
  const { labels, comps } = components(layers.paper, w, h, 1);
  if (!comps.length) return null;
  comps.sort((a, b) => b.area - a.area);
  const c = comps[0];
  const pad = Math.round(0.01 * Math.max(w, h));
  const x0 = Math.max(0, c.x0 + pad), y0 = Math.max(0, c.y0 + pad), x1 = Math.min(w - 1, c.x1 - pad), y1 = Math.min(h - 1, c.y1 - pad);
  void labels;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  if (cw < 0.4 * w || ch < 0.4 * h) return null;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(img.data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + cw) * 4), y * cw * 4);
  return {
    ok: true, image: { width: cw, height: ch, data: out }, H: null, tilt: { h: [], v: [] }, fit: [0, 0, 0, 0], cost: 0,
    corners: [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]],
    quality: { score: 0.6, planFound: true, residualTiltDeg: null, cropFrac: (cw * ch) / (w * h), warnings: ['plain-paper-crop'] },
  };
}

// Straightening, in order of trust: (1) the poster's plan area (between its sidebar and caption) straightened on its own walls;
// (2) the whole photo straightened; (3) the biggest bright patch of the plan area, cut as it is. The first one that looks right wins.
export function rectifyDetailed(img, opts = {}) {
  let roi = null;
  if (!opts.noAnchor) { try { roi = posterRoi(img); } catch { roi = null; } }
  const cut = (r) => {
    const cw = r.x1 - r.x0 + 1, ch = r.y1 - r.y0 + 1, crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) crop.set(img.data.subarray(((r.y0 + y) * img.width + r.x0) * 4, ((r.y0 + y) * img.width + r.x0 + cw) * 4), y * cw * 4);
    return { width: cw, height: ch, data: crop };
  };
  const back = (res) => {
    res.corners = res.corners.map(([x, y]) => [x + roi.x0, y + roi.y0]); // corners are in the whole photo
    res.quality = { ...res.quality, warnings: [...res.quality.warnings, 'cut-to-poster-furniture'] };
    return res;
  };
  let roiImg = null, a = null;
  if (roi) { roiImg = cut(roi); a = rectifyDetailed1(roiImg, opts); if (a.ok && !looksWrong(a)) return back(a); }
  const b = rectifyDetailed1(img, opts);
  if (!looksWrong(b)) return b;
  if (roi) {
    const pc = paperCrop(roiImg);
    if (pc && (!b.ok || pc.quality.cropFrac > 0.3)) return back(pc);
    if (a && a.ok && (!b.ok || a.quality.score >= b.quality.score)) return back(a);
  }
  return b;
}

export function rectifyDetailed1(img, opts = {}) {
  const maxOut = opts.maxOut || 2400;
  const W = img && img.width, Hh = img && img.height;
  if (!img || !Number.isFinite(W) || !Number.isFinite(Hh) || W < 32 || Hh < 32 || !img.data || img.data.length < W * Hh * 4) {
    return { ok: false, image: null, quality: failQuality('image-unusable') };
  }
  try {
    return rectifyInner(img, opts, maxOut);
  } catch (e) {
    return { ok: false, image: null, quality: failQuality('error: ' + (e && e.message)) };
  }
}

function rectifyInner(img, opts, maxOut) {
  const { img: work, scale: s } = downscale(img, 1000);
  const ww = work.width, wh = work.height;
  const layers = analyze(work);
  const region = findPlanRegion(inkOnPaper(layers), ww, wh);
  if (!region) return { ok: false, image: null, quality: failQuality('plan-not-found') };
  const { box, mask } = region;
  const cx0 = ww / 2, cy0 = wh / 2, L = Math.max(ww, wh);
  const warnings = [];

  const samples = tiltSamples(mask, ww, box, cx0, cy0, 4, opts.range || 15);
  if (opts.debug) console.log('clusters', JSON.stringify(region.clusters), 'box', JSON.stringify(box), 'samples', samples.map((m) => `${m.kind}${m.deg}`).join(' '));
  let chosen = null;
  let mode = 'full';
  if (samples.length >= 3) {
    const full = robustFit(samples, L, 'full');
    const rot = robustFit(samples, L, 'rot');
    // keystone terms only when they explain the walls clearly better than a plain rotation
    chosen = sane(full.v) && rot.rmsAll - full.rmsAll >= 0.1 ? full : rot;
    mode = chosen === full ? 'full' : 'rotation';
    if (chosen.rms > 1.3 || chosen.inlierFrac < 0.5) {
      warnings.push('tilt-unreliable');
      chosen = { v: [0, 0, 0, 0], cost: 0, used: [], rms: chosen.rms, inlierFrac: chosen.inlierFrac };
      mode = 'plain-crop';
    }
  } else {
    warnings.push(samples.length ? 'few-walls' : 'no-walls-to-measure');
    chosen = { v: [0, 0, 0, 0], cost: 0, used: [], rms: 0, inlierFrac: 0 };
    mode = 'plain-crop';
  }
  // already straight (under 0.1 degree, no keystone): leave the pixels alone, resampling would only blur them
  if (Math.abs(chosen.v[0]) < 0.0017 && Math.abs(chosen.v[1]) < 0.02 && Math.abs(chosen.v[2]) < 0.02 && Math.abs(chosen.v[3]) < 0.0017) chosen = { ...chosen, v: [0, 0, 0, 0] };
  if (opts.debug) console.log('mode', mode, 'v', chosen.v.map((x) => +x.toFixed(3)), 'used', chosen.used.length, '/', samples.length, 'rms', chosen.rms, chosen.rmsAll);
  let Hc = buildHc(chosen.v[0], chosen.v[1] / L, chosen.v[2] / L, chosen.v[3]);
  let rect = cropRect(mask, ww, wh, box, Hc, cx0, cy0);
  // a crop that blows up (extreme keystone) is not trusted either: rotation only
  if (rect && mode === 'full' && (rect.rx1 - rect.rx0) * (rect.ry1 - rect.ry0) > 2.2 * (box.x1 - box.x0) * (box.y1 - box.y0)) {
    warnings.push('keystone-too-strong');
    chosen = robustFit(samples, L, 'rot'); mode = 'rotation';
    Hc = buildHc(chosen.v[0], chosen.v[1] / L, chosen.v[2] / L, chosen.v[3]);
    rect = cropRect(mask, ww, wh, box, Hc, cx0, cy0);
  }
  if (!rect) return { ok: false, image: null, quality: failQuality('plan-not-found') };
  let { rx0, rx1, ry0, ry1 } = rect;
  // already straight and already about the size of the plan: hand the photo back whole, so running rectify on its
  // own output changes nothing (a crop would shave a little more each time)
  if (!chosen.v.some((v) => v)) {
    const cw = Math.min(rx1, ww - cx0) - Math.max(rx0, -cx0), ch = Math.min(ry1, wh - cy0) - Math.max(ry0, -cy0);
    if (cw > 0 && ch > 0 && (cw * ch) / (ww * wh) >= 0.85) { rx0 = -cx0; rx1 = ww - cx0; ry0 = -cy0; ry1 = wh - cy0; }
  }
  if (s === 1 && !chosen.v.some((v) => v)) { rx0 = Math.round(rx0 + cx0) - cx0; ry0 = Math.round(ry0 + cy0) - cy0; rx1 = Math.round(rx1 + cx0) - cx0; ry1 = Math.round(ry1 + cy0) - cy0; } // pixel-exact crop
  // output scale: keep source resolution (work px -> 1/s full px), capped
  let f = 1 / s;
  const rw = rx1 - rx0, rh = ry1 - ry0;
  if (Math.max(rw, rh) * f > maxOut) f = maxOut / Math.max(rw, rh);
  const outW = Math.max(1, Math.round(rw * f)), outH = Math.max(1, Math.round(rh * f));
  // dst(X,Y) -> rect (u,v) -> work -> full
  const T = [1 / f, 0, rx0, 0, 1 / f, ry0, 0, 0, 1];
  const toWork = mul([1, 0, cx0, 0, 1, cy0, 0, 0, 1], mul(inv(Hc), T));
  const H = mul([1 / s, 0, 0, 0, 1 / s, 0, 0, 0, 1], toWork);
  const image = warpSharp(img, H, outW, outH);
  const corners = [[0, 0], [outW, 0], [outW, outH], [0, outH]].map(([X, Y]) => apply(H, X, Y));
  const tilt = { h: samples.filter((m) => m.kind === 'h').map((m) => m.deg), v: samples.filter((m) => m.kind === 'v').map((m) => m.deg) };
  const quality = buildQuality({
    img, layers, region, samples, chosen, mode, warnings, corners, cropArea: polyArea(corners), box, ww, wh,
  });
  return { ok: true, image, H, corners, tilt, fit: chosen.v, cost: chosen.cost, quality };
}

// Returns { image, H (dst->src of the INPUT image), corners (input px, TL TR BR BL of the output rect),
//   tilt: {h:[deg], v:[deg]}, fit, cost, quality } or null when the plan can't be found.
// opts.soft: always return the detailed result (image null when no plan), e.g. to read quality.
export function rectify(img, opts = {}) {
  const r = rectifyDetailed(img, opts);
  return r.ok || opts.soft ? r : null;
}
