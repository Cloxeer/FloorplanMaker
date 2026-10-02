// rectifyQuality.js
// "How good is this photo?" for rectify: a 0..1 score and plain warnings the UI can show
// ("the photo is hard to read, retake it") from the measurements rectify already made.
// Pure.
// Depends on: nothing.

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; }
  return Math.abs(a) / 2;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function failQuality(reason) {
  return { score: 0, planFound: false, residualTiltDeg: null, cropFrac: 0, warnings: [reason] };
}

// c: { img, layers, region, samples, chosen {rms, inlierFrac}, mode, warnings, corners, cropArea, box, ww, wh }
export function buildQuality(c) {
  const warnings = c.warnings.slice();
  let score = 1;
  const { img, region, samples, chosen, mode } = c;
  const cropFrac = c.cropArea / (img.width * img.height);
  // how many measurements, how well the fit explains them
  const nh = samples.filter((m) => m.kind === 'h').length, nv = samples.length - nh;
  if (samples.length < 8) { score -= samples.length < 3 ? 0.35 : samples.length < 4 ? 0.3 : samples.length < 6 ? 0.15 : 0.05; if (samples.length >= 3) warnings.push('few-walls'); }
  if (samples.length >= 3 && (nh < 2 || nv < 2)) { score -= 0.15; warnings.push('walls-in-one-direction-only'); }
  if (region.rooms < 3) { score -= 0.25; warnings.push('few-room-cells'); }
  if (mode !== 'plain-crop') {
    if (chosen.rms > 0.4) score -= Math.min(0.35, (chosen.rms - 0.4) * 0.35);
    if (chosen.inlierFrac < 0.8) score -= (0.8 - chosen.inlierFrac) * 0.5;
  } else score -= 0.35;
  if (mode === 'rotation' && Math.abs(chosen.v[0]) > 0.17) warnings.push('strongly-rotated');
  if (mode === 'full' && (Math.abs(chosen.v[1]) > 0.35 || Math.abs(chosen.v[2]) > 0.35)) warnings.push('strong-perspective');
  // the plan in the photo
  if (!region.long) { score -= 0.1; warnings.push('wall-lines-broken'); }
  if (region.count < 2500) { score -= 0.1; warnings.push('few-wall-pixels'); }
  if (cropFrac < 0.1) { score -= 0.1; warnings.push('plan-small-in-photo'); }
  if (cropFrac > 1.05) { score -= 0.3; warnings.push('crop-larger-than-photo'); }
  // the plan's walls touch the photo's border: it is probably cut off
  const bx = c.box, m = 2;
  if (bx.x0 <= m || bx.y0 <= m || bx.x1 >= c.ww - 1 - m || bx.y1 >= c.wh - 1 - m) { score -= 0.15; warnings.push('plan-cut-by-photo-edge'); }
  const info = c.layers && c.layers.info;
  if (info) {
    if (info.noisy) { score -= info.sigma > 5 ? 0.15 : 0.05; warnings.push('noisy-photo'); }
    if (info.blurWidth > 3.1) { score -= Math.min(0.4, 0.15 * (info.blurWidth - 3.1) + 0.1); warnings.push('blurry-photo'); }
    if (info.lineC < 25) { score -= 0.1; warnings.push('faint-lines'); }
  }
  if (warnings.includes('tilt-unreliable')) warnings.push('retake-hard-to-read');
  score = clamp01(score);
  if (score < 0.4 && !warnings.includes('retake-hard-to-read')) warnings.push('retake-hard-to-read');
  return { score: +score.toFixed(2), planFound: true, residualTiltDeg: +chosen.rms.toFixed(2), cropFrac: +cropFrac.toFixed(3), warnings: [...new Set(warnings)] };
}
