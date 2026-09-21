// trace.worker.js
// Module worker for the "Suggest rooms" feature: finds rectangular room-like
// regions in a straightened floorplan photo (flood fill on an adaptive
// threshold), then optionally OCRs each region's room number via Tesseract.js
// (lazy dynamic import). Depends on: nothing at module scope (pure worker);
// Tesseract.js loaded lazily from CDN for the 'ocr' message.
//
// Messages in:
//   { id, kind:'trace', width, height, data:Uint8ClampedArray(RGBA),
//     minArea=1500, maxAreaFrac=0.6, outline?:[[x,y],...] }
//     When `outline` (the floor polygon, in the same photo-pixel space) is
//     given, regions whose centre falls outside it are dropped, and the
//     max-area check uses the outline's own bbox area instead of the whole
//     photo (so a big lecture hall inside a small building doesn't get
//     dropped just because the photo has wide margins).
//     -> posts { id, kind:'trace', regions:[{x,y,w,h,area}] } (top-to-bottom, left-to-right)
//   { id, kind:'ocr', width, height, data, regions }
//     -> posts progress { id, kind:'ocr-progress', done, total }
//     -> posts { id, kind:'ocr', numbers:{ [regionIndex]: '128B' } }
//   { id, kind:'halls', width, height, data, outline }
//     Reuses the same adaptive-threshold ink mask as 'trace'. Finds light
//     (non-ink) regions inside `outline` (required to be meaningful; regions
//     outside it, or touching the image border, are dropped) that are:
//       - hallways: bbox aspect ratio (long/short side) >= 3, long side >=
//         120 plan units, short side between 20 and 140.
//       - stair candidates: short side between 30 and 120, and the region's
//         interior contains >= 3 dark (ink) line runs parallel to the
//         region's short axis, each consecutive pair spaced <= 40 units
//         apart (i.e. evenly spaced stair treads).
//     -> posts { id, kind:'halls', halls:[{x,y,w,h}], stairs:[{x,y,w,h}] }
// On error: posts { id, error: message }

const NUMBER_RE = /^[A-Z]?\d{3}[A-Z]?$/;
const EMBEDDED_NUMBER_RE = /\d{3}/;
let tesseractWorkerPromise = null;

// Common OCR confusions, fixed up only in the digit run of a candidate token
// (so a real letter prefix/suffix like "A" or "B" in "A101"/"101B" survives).
function normalizeDigits(token) {
  const m = token.match(/^([A-Z]?)(.+?)([A-Z]?)$/);
  if (!m) return token;
  const [, prefix, mid, suffix] = m;
  const fixed = mid.replace(/O/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  return prefix + fixed + suffix;
}

function extractRoomNumber(text) {
  const tokens = (text || '').split(/\s+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  for (const raw of tokens) {
    const token = normalizeDigits(raw);
    if (NUMBER_RE.test(token)) return token;
  }
  for (const raw of tokens) {
    const token = normalizeDigits(raw);
    const m = token.match(EMBEDDED_NUMBER_RE);
    if (m) return m[0];
  }
  return null;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  const { id, kind } = msg;
  try {
    if (kind === 'trace') {
      const regions = trace(msg.width, msg.height, msg.data, msg.minArea ?? 1500, msg.maxAreaFrac ?? 0.6, msg.outline || null);
      self.postMessage({ id, kind: 'trace-result', regions });
    } else if (kind === 'ocr') {
      await ocrRegions(id, msg.width, msg.height, msg.data, msg.regions);
      self.postMessage({ id, kind: 'ocr-done' });
    } else if (kind === 'halls') {
      const { halls, stairs } = findHallsAndStairs(msg.width, msg.height, msg.data, msg.outline || null);
      self.postMessage({ id, kind: 'halls', halls, stairs });
    } else {
      self.postMessage({ id, kind: 'error', message: `unknown kind: ${kind}` });
    }
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: err && err.message ? err.message : String(err) });
  }
};

// ---------- trace: grayscale -> adaptive threshold -> dilate -> flood fill ----------

// Point-in-polygon (ray casting); `pt` and `poly` points are [x,y] pairs.
function pointInPolygon(pt, poly) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonBboxArea(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return Math.max(0, w) * Math.max(0, h);
}

// Grayscale -> adaptive threshold (via summed-area table local mean) -> 3px
// dilation. Shared by trace() and findHallsAndStairs() so both classifiers
// see the same wall mask.
function computeInkMask(width, height, data) {
  const n = width * height;
  const gray = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  // Summed-area table for fast local-mean adaptive threshold.
  const sat = new Float64Array((width + 1) * (height + 1));
  const satW = width + 1;
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      sat[(y + 1) * satW + (x + 1)] = sat[y * satW + (x + 1)] + rowSum;
    }
  }
  const boxLocalMean = (x, y, half) => {
    const x0 = Math.max(0, x - half);
    const y0 = Math.max(0, y - half);
    const x1 = Math.min(width - 1, x + half);
    const y1 = Math.min(height - 1, y + half);
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    const sum =
      sat[(y1 + 1) * satW + (x1 + 1)] -
      sat[y0 * satW + (x1 + 1)] -
      sat[(y1 + 1) * satW + x0] +
      sat[y0 * satW + x0];
    return sum / area;
  };

  const half = 15; // 31px box
  const ink = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const mean = boxLocalMean(x, y, half);
      ink[i] = gray[i] < mean - 18 ? 1 : 0;
    }
  }

  // Dilate ink by 3px (three passes of 1px 4-connected dilation via SAT-free
  // simple neighbour scan for correctness on small kernel) so hairline
  // breaks in walls close up instead of leaking regions together.
  let dilated = ink;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (dilated[i]) { next[i] = 1; continue; }
        let hit = 0;
        if (x > 0 && dilated[i - 1]) hit = 1;
        else if (x < width - 1 && dilated[i + 1]) hit = 1;
        else if (y > 0 && dilated[i - width]) hit = 1;
        else if (y < height - 1 && dilated[i + width]) hit = 1;
        next[i] = hit;
      }
    }
    dilated = next;
  }
  return { ink, dilated };
}

// Calls `visit({ minX, minY, maxX, maxY, area, touchesBorder })` for every
// connected non-`dilated` (walkable) region, 4-connectivity, iterative BFS.
function floodFillRegions(width, height, dilated, visit) {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);

  for (let start = 0; start < n; start++) {
    if (dilated[start] || labels[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = 1; // visited marker
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    let touchesBorder = false;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      const nb = [idx - 1, idx + 1, idx - width, idx + width];
      const validX = [x > 0, x < width - 1, true, true];
      const validY = [true, true, y > 0, y < height - 1];
      for (let k = 0; k < 4; k++) {
        if (!validX[k] || !validY[k]) continue;
        const ni = nb[k];
        if (ni < 0 || ni >= n) continue;
        if (dilated[ni] || labels[ni] !== -1) continue;
        labels[ni] = 1;
        stack[sp++] = ni;
      }
    }

    visit({ minX, minY, maxX, maxY, area, touchesBorder });
  }
}

function trace(width, height, data, minArea, maxAreaFrac, outline) {
  const { dilated } = computeInkMask(width, height, data);
  const outlineArea = outline && outline.length >= 3 ? polygonBboxArea(outline) : null;
  const maxArea = maxAreaFrac * (outlineArea || (width * height));
  const regions = [];

  floodFillRegions(width, height, dilated, ({ minX, minY, maxX, maxY, area, touchesBorder }) => {
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const bboxArea = w * h;
    const fillRatio = bboxArea > 0 ? area / bboxArea : 0;
    const cx = minX + w / 2;
    const cy = minY + h / 2;
    const insideOutline = !outline || pointInPolygon([cx, cy], outline);

    if (
      area >= minArea &&
      area <= maxArea &&
      fillRatio > 0.45 &&
      !touchesBorder &&
      insideOutline
    ) {
      regions.push({ x: minX, y: minY, w, h, area });
    }
  });

  regions.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  // eslint-disable-next-line no-console
  console.log(`[trace.worker] regions kept: ${regions.length}`);
  return regions;
}

// ---------- halls: same ink mask, classify light regions by shape ----------

// Counts, within `ink`, rows/columns (whichever run parallel to the region's
// short axis) that are mostly dark, clustering adjacent hits into a single
// "line run". Returns true when there are >= 3 runs each <= 40 units apart
// (evenly spaced stair treads).
function countLineRuns(ink, width, bbox) {
  const { x, y, w, h } = bbox;
  const vertical = h >= w; // long axis is y -> tread lines are horizontal rows
  const primary = vertical ? h : w;
  const secondary = vertical ? w : h;
  const positions = [];
  for (let p = 0; p < primary; p++) {
    let dark = 0;
    for (let s = 0; s < secondary; s++) {
      const xi = vertical ? x + s : x + p;
      const yi = vertical ? y + p : y + s;
      if (ink[yi * width + xi]) dark++;
    }
    if (secondary > 0 && dark / secondary >= 0.5) positions.push(p);
  }
  if (!positions.length) return false;
  const runs = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] - positions[i - 1] > 3) runs.push(positions[i]);
  }
  if (runs.length < 3) return false;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i] - runs[i - 1] > 40) return false;
  }
  return true;
}

function findHallsAndStairs(width, height, data, outline) {
  const { ink, dilated } = computeInkMask(width, height, data);
  const halls = [];
  const stairs = [];

  floodFillRegions(width, height, dilated, ({ minX, minY, maxX, maxY, touchesBorder }) => {
    if (touchesBorder) return;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cx = minX + w / 2;
    const cy = minY + h / 2;
    if (outline && outline.length >= 3 && !pointInPolygon([cx, cy], outline)) return;

    const longSide = Math.max(w, h);
    const shortSide = Math.min(w, h);
    const aspect = shortSide > 0 ? longSide / shortSide : Infinity;

    if (aspect >= 3 && longSide >= 120 && shortSide >= 20 && shortSide <= 140) {
      halls.push({ x: minX, y: minY, w, h });
    } else if (shortSide >= 30 && shortSide <= 120) {
      if (countLineRuns(ink, width, { x: minX, y: minY, w, h })) {
        stairs.push({ x: minX, y: minY, w, h });
      }
    }
  });

  return { halls, stairs };
}

// ---------- ocr: lazy-load Tesseract.js, crop + recognize each region ----------

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js');
      const Tesseract = mod.default || mod;
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '7', // single line, the common case for a room-number tag
      });
      return worker;
    })();
  }
  return tesseractWorkerPromise;
}

async function ocrRegions(id, width, height, data, regions) {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OCR needs a modern browser with OffscreenCanvas support');
  }
  const worker = await getTesseractWorker();
  const numbers = {};
  const total = regions.length;
  let done = 0;

  for (let ri = 0; ri < regions.length; ri++) {
    const region = regions[ri];
    const pad = 6;
    const scale = 3;
    const sx = Math.max(0, region.x - pad);
    const sy = Math.max(0, region.y - pad);
    const ex = Math.min(width, region.x + region.w + pad);
    const ey = Math.min(height, region.y + region.h + pad);
    const cw = Math.max(1, ex - sx);
    const ch = Math.max(1, ey - sy);

    const srcCanvas = new OffscreenCanvas(cw, ch);
    const srcCtx = srcCanvas.getContext('2d');
    const imgData = srcCtx.createImageData(cw, ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const srcIdx = ((sy + y) * width + (sx + x)) * 4;
        const dstIdx = (y * cw + x) * 4;
        imgData.data[dstIdx] = data[srcIdx];
        imgData.data[dstIdx + 1] = data[srcIdx + 1];
        imgData.data[dstIdx + 2] = data[srcIdx + 2];
        imgData.data[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    srcCtx.putImageData(imgData, 0, 0);

    const outCanvas = new OffscreenCanvas(cw * scale, ch * scale);
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = true;
    outCtx.drawImage(srcCanvas, 0, 0, cw * scale, ch * scale);

    const { data: result } = await worker.recognize(outCanvas);
    let best = extractRoomNumber(result && result.text);
    if (!best) {
      // Fall back to "assume a block of text" segmentation when the
      // single-line pass found nothing (e.g. the number wraps or sits next
      // to other text in the crop).
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      const retry = await worker.recognize(outCanvas);
      best = extractRoomNumber(retry.data && retry.data.text);
      await worker.setParameters({ tessedit_pageseg_mode: '7' });
    }
    if (best) numbers[ri] = best;
    self.postMessage({ id, kind: 'ocr-result', index: ri, number: best || '' });

    done++;
    self.postMessage({ id, kind: 'ocr-progress', done, total });
  }

  return numbers;
}
