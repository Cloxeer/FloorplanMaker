// photoWarp.js
// Corner-quad -> flat rectangle warp for the photo step (homography via
// Gaussian elimination, nearest-neighbour sampling). Pure canvas math.

export const MAX_OUTPUT = 2400;

function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const pivVal = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// H maps dst (output) -> src, so each output pixel looks up its source pixel.
function computeHomography(srcPts, dstPts) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dstPts[i];
    const [xp, yp] = srcPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
    b.push(xp);
    A.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
    b.push(yp);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// -> canvas holding the flattened photo (white where the quad leaves the source)
export function warpToCanvas(srcCanvas, quad) {
  const [tl, tr, br, bl] = quad;
  let outW = Math.max(10, Math.round((dist(tl, tr) + dist(bl, br)) / 2));
  let outH = Math.max(10, Math.round((dist(tl, bl) + dist(tr, br)) / 2));
  const longest = Math.max(outW, outH);
  if (longest > MAX_OUTPUT) {
    const scale = MAX_OUTPUT / longest;
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);
  }
  const H = computeHomography(quad, [[0, 0], [outW, 0], [outW, outH], [0, outH]]);
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const sdata = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  const out = outCtx.createImageData(outW, outH);
  const odata = out.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(H, x, y);
      const sx = Math.round(p.x), sy = Math.round(p.y);
      const oi = (y * outW + x) * 4;
      if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
        const si = (sy * sw + sx) * 4;
        odata[oi] = sdata[si]; odata[oi + 1] = sdata[si + 1]; odata[oi + 2] = sdata[si + 2]; odata[oi + 3] = 255;
      } else {
        odata[oi] = 255; odata[oi + 1] = 255; odata[oi + 2] = 255; odata[oi + 3] = 255;
      }
    }
  }
  outCtx.putImageData(out, 0, 0);
  return outCanvas;
}
