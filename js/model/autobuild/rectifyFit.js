// rectifyFit.js
// The homography side of rectify: 3x3 helpers and the robust fit of rotation + shear +
// keystone to measured wall tilts. Pure.
// Depends on: nothing.

export const RAD = Math.PI / 180;

// 3x3 helpers (row-major arrays of 9)
export function mul(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}
export function inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
export function apply(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

// Direction (as angle off the target axis, radians) of a photo-space direction after mapping.
export function residual(Hc, x, y, ang, kind) {
  const L = 40;
  const dx = kind === 'h' ? Math.cos(ang) : Math.sin(ang);
  const dy = kind === 'h' ? Math.sin(ang) : Math.cos(ang);
  const a = apply(Hc, x - dx * L / 2, y - dy * L / 2), b = apply(Hc, x + dx * L / 2, y + dy * L / 2);
  const vx = b[0] - a[0], vy = b[1] - a[1];
  return kind === 'h' ? Math.atan2(vy, vx) : Math.atan2(vx, vy);
}

// rotation * shear * keystone. The shear makes the two wall families perpendicular when the
// photo's own skew (not just perspective) leaves them at an angle.
export function buildHc(theta, p, q, shear = 0) {
  const K = [1, 0, 0, 0, 1, 0, p, q, 1];
  const c = Math.cos(theta), s = Math.sin(theta);
  return mul(mul([c, -s, 0, s, c, 0, 0, 0, 1], [1, shear, 0, 0, 1, 0, 0, 0, 1]), K);
}

// weighted squared residual of the samples, each residual clipped at `clip` radians
function costOf(samples, v, scaleL, totalW, clip, mode) {
  const Hc = buildHc(v[0], v[1] / scaleL, v[2] / scaleL, mode === 'rot' ? 0 : v[3]);
  let s = 0;
  for (const m of samples) {
    const r = Math.min(Math.abs(residual(Hc, m.x, m.y, m.ang, m.kind)), clip);
    s += m.wt * r * r;
  }
  // a tiny pull toward "no shear": noise alone never shears the plan
  return s + 0.02 * totalW * v[3] * v[3];
}

// Coordinate-descent fit of (theta, p, q, shear). Samples are { x, y, ang, kind, wt } in centred
// working px. mode 'rot' fits the rotation only (p = q = shear = 0). Residuals are clipped at 1.5 degrees
// (a redescending loss), so a few wrong bands cannot drag the fit; v starts at the weighted median angle.
export function fitHomography(samples, scaleL, mode = 'full') {
  const totalW = samples.reduce((t, m) => t + m.wt, 0) || 1;
  const clip = 1.5 * RAD;
  const med = medianAngle(samples);
  const free = mode === 'rot' ? [0] : [0, 1, 2, 3];
  let best = null;
  const starts = [med, 0, ...samples.map((m) => m.ang).sort((a, b) => a - b).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 8)) === 0)];
  for (const start of starts) {
    let v = [start, 0, 0, 0], step, c0;
    // first fit with an unclipped loss (smooth basin), then refine with the clipped one
    for (const cl of [10, clip]) {
      c0 = costOf(samples, v, scaleL, totalW, cl, mode);
      step = [0.02, 0.2, 0.2, 0.01];
      for (let it = 0; it < 120; it++) {
        let improved = false;
        for (const k of free) {
          for (const sg of [1, -1]) {
            const t = v.slice(); t[k] += sg * step[k];
            const c = costOf(samples, t, scaleL, totalW, cl, mode);
            if (c < c0) { c0 = c; v = t; improved = true; }
          }
        }
        if (!improved) step = step.map((s) => s * 0.5);
        if (step[0] < 1e-5) break;
      }
    }
    if (!best || c0 < best.cost) best = { v, cost: c0 };
  }
  return best;
}

function medianAngle(samples) {
  const a = samples.map((m) => m.ang).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
}

// Weighted RMS residual (degrees) of the samples under the fit and the share within 0.7 degrees.
export function fitResidual(samples, Hc) {
  let s = 0, w = 0, ok = 0;
  for (const m of samples) {
    const r = residual(Hc, m.x, m.y, m.ang, m.kind) / RAD;
    s += m.wt * r * r; w += m.wt;
    if (Math.abs(r) < 0.7) ok++;
  }
  return { rms: w ? Math.sqrt(s / w) : 0, inlierFrac: samples.length ? ok / samples.length : 0 };
}
