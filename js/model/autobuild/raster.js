// raster.js
// Small pure raster toolkit for AutoBuild: grayscale, blur, dilation,
// connected components, homography warp, rotation, crops, resampling.
// Images are { width, height, data } with data = RGBA Uint8ClampedArray.
// Depends on: nothing (no DOM), so it runs in a Worker and in Node tests.

export function makeImage(width, height, fill = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill != null) data.fill(fill);
  return { width, height, data };
}

export function toGray(img) {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114 + 500) / 1000;
  }
  return g;
}

// Box blur (radius r, edge-clamped) of a w*h Uint8Array via running sums.
export function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(s / (d * d));
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Binary dilation by a (2r+1) square (separable) of a 0/1 Uint8Array.
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1e9;
    const hit = new Int32Array(w);
    for (let x = 0; x < w; x++) { if (mask[row + x]) last = x; hit[x] = last; }
    let next = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x]) next = x;
      if (x - hit[x] <= r || next - x <= r) tmp[row + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    const hit = new Int32Array(h);
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; hit[y] = last; }
    let next = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) next = y;
      if (y - hit[y] <= r || next - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

// Binary erosion by a (2r+1) square.
export function erode(mask, w, h, r) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

// Labelling of mask===target. Returns { labels:Int32Array, comps:[{id,area,x0,y0,x1,y1,sx,sy}] }.
export function components(mask, w, h, target = 1, eight = false) {
  const labels = new Int32Array(w * h);
  const comps = [];
  const stack = new Int32Array(w * h);
  let id = 0;
  for (let i = 0; i < w * h; i++) {
    if (mask[i] !== target || labels[i]) continue;
    id++;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    const c = { id, area: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0 };
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      c.area++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      const push = (q) => { if (mask[q] === target && !labels[q]) { labels[q] = id; stack[sp++] = q; } };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
      if (eight) {
        if (x > 0 && y > 0) push(p - w - 1);
        if (x < w - 1 && y > 0) push(p - w + 1);
        if (x > 0 && y < h - 1) push(p + w - 1);
        if (x < w - 1 && y < h - 1) push(p + w + 1);
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const pv = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// H with [sx,sy,1] ~ H [dx,dy,1] (dst -> src), from 4 point pairs.
export function homography(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dstPts[i];
    const [xp, yp] = srcPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]); b.push(xp);
    A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]); b.push(yp);
  }
  return [...solve8(A, b), 1];
}

// Bilinear warp of src into an outW*outH image using the dst->src homography.
export function warp(src, H, outW, outH) {
  const out = makeImage(outW, outH, 255);
  const { width: sw, height: sh, data: sd } = src;
  const od = out.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) continue;
      const x0 = sx | 0, y0 = sy | 0;
      const fx = sx - x0, fy = sy - y0;
      const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const oi = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = sd[(y0 * sw + x0) * 4 + c], b = sd[(y0 * sw + x1) * 4 + c];
        const d = sd[(y1 * sw + x0) * 4 + c], e = sd[(y1 * sw + x1) * 4 + c];
        od[oi + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    }
  }
  return out;
}

// Same as warp() with bicubic (Catmull-Rom) sampling: keeps thin lines sharp where bilinear would blur
// them by up to a pixel (and the AutoBuild readers are sensitive to that). Slight overshoot is clamped.
export function warpSharp(src, H, outW, outH) {
  const out = makeImage(outW, outH, 255);
  const { width: sw, height: sh, data: sd } = src;
  const od = out.data;
  const wx = new Float64Array(4), wy = new Float64Array(4);
  const cr = (t, w) => { // Catmull-Rom weights for the 4 taps around fractional position t
    const t2 = t * t, t3 = t2 * t;
    w[0] = -0.5 * t3 + t2 - 0.5 * t; w[1] = 1.5 * t3 - 2.5 * t2 + 1; w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t; w[3] = 0.5 * t3 - 0.5 * t2;
  };
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / w;
      const sy = (H[3] * x + H[4] * y + H[5]) / w;
      if (!(sx >= 0 && sy >= 0 && sx <= sw - 1 && sy <= sh - 1)) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      cr(sx - x0, wx); cr(sy - y0, wy);
      const oi = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let j = 0; j < 4; j++) {
          const yy = Math.min(sh - 1, Math.max(0, y0 - 1 + j)) * sw;
          let r = 0;
          for (let i = 0; i < 4; i++) r += wx[i] * sd[(yy + Math.min(sw - 1, Math.max(0, x0 - 1 + i))) * 4 + c];
          v += wy[j] * r;
        }
        od[oi + c] = v; // Uint8ClampedArray clamps
      }
    }
  }
  return out;
}

// Rotate by `deg` clockwise about the centre; same size, white fill.
export function rotateImage(src, deg) {
  const { width: w, height: h } = src;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const cx = w / 2, cy = h / 2;
  const H = [cos, sin, cx - cos * cx - sin * cy, -sin, cos, cy + sin * cx - cos * cy, 0, 0, 1];
  return warp(src, H, w, h);
}

export function crop(src, x, y, w, h) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.min(src.width - x, Math.round(w));
  h = Math.min(src.height - y, Math.round(h));
  const out = makeImage(w, h, 255);
  for (let r = 0; r < h; r++) {
    out.data.set(src.data.subarray(((y + r) * src.width + x) * 4, ((y + r) * src.width + x + w) * 4), r * w * 4);
  }
  return out;
}

// Area-average downscale to at most maxSide on the long side -> { img, scale }.
export function downscale(src, maxSide) {
  const long = Math.max(src.width, src.height);
  if (long <= maxSide) return { img: src, scale: 1 };
  const s = maxSide / long;
  const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
  const out = makeImage(w, h, 255);
  const k = 1 / s;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * k), y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * k), x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * k)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = 255;
    }
  }
  return { img: out, scale: s };
}

// Bilinear upscale of a gray Uint8Array by factor f -> { data, w, h }.
export function upscaleGray(g, w, h, f) {
  const W = Math.round(w * f), H = Math.round(h * f);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = sy | 0, y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = sx | 0, x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      out[y * W + x] = (g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy)
        + (g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy;
    }
  }
  return { data: out, w: W, h: H };
}
