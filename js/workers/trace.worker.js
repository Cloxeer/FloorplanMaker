// trace.worker.js
// Module worker for the "Suggest rooms" feature: finds rectangular room-like
// regions in a straightened floorplan photo (flood fill on an adaptive
// threshold), then optionally OCRs each region's room number via Tesseract.js
// (lazy dynamic import). Depends on: nothing at module scope (pure worker);
// Tesseract.js loaded lazily from CDN for the 'ocr' message.
//
// Messages in:
//   { id, kind:'trace', width, height, data:Uint8ClampedArray(RGBA),
//     minArea=1500, maxAreaFrac=0.25 }
//     -> posts { id, kind:'trace', regions:[{x,y,w,h,area}] } (top-to-bottom, left-to-right)
//   { id, kind:'ocr', width, height, data, regions }
//     -> posts progress { id, kind:'ocr-progress', done, total }
//     -> posts { id, kind:'ocr', numbers:{ [regionIndex]: '128B' } }
// On error: posts { id, error: message }

const NUMBER_RE = /^[A-Z]?\d{3}[A-Z]?$/;
let tesseractWorkerPromise = null;

self.onmessage = async (e) => {
  const msg = e.data || {};
  const { id, kind } = msg;
  try {
    if (kind === 'trace') {
      const regions = trace(msg.width, msg.height, msg.data, msg.minArea ?? 1500, msg.maxAreaFrac ?? 0.25);
      self.postMessage({ id, kind: 'trace-result', regions });
    } else if (kind === 'ocr') {
      await ocrRegions(id, msg.width, msg.height, msg.data, msg.regions);
      self.postMessage({ id, kind: 'ocr-done' });
    } else {
      self.postMessage({ id, kind: 'error', message: `unknown kind: ${kind}` });
    }
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: err && err.message ? err.message : String(err) });
  }
};

// ---------- trace: grayscale -> adaptive threshold -> dilate -> flood fill ----------

function trace(width, height, data, minArea, maxAreaFrac) {
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

  // Dilate ink by 2px (two passes of 1px 4-connected dilation via SAT-free
  // simple neighbour scan for correctness on small kernel).
  let dilated = ink;
  for (let pass = 0; pass < 2; pass++) {
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

  // Flood fill non-ink (walkable) regions, 4-connectivity, iterative scanline-ish BFS.
  const labels = new Int32Array(n).fill(-1);
  const regions = [];
  const stack = new Int32Array(n);
  const maxArea = maxAreaFrac * width * height;

  for (let start = 0; start < n; start++) {
    if (dilated[start] || labels[start] !== -1) continue;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = -2; // in-progress marker
    let minX = width, minY = height, maxX = -1, maxY = -1, area = 0;
    let touchesBorder = false;
    const cellsForThisRegion = [];

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      cellsForThisRegion.push(idx);
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
        labels[ni] = -2;
        stack[sp++] = ni;
      }
      if (area > maxArea + 1) {
        // bail early; region too large to matter
      }
    }

    const regionId = regions.length;
    for (const idx of cellsForThisRegion) labels[idx] = regionId;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const bboxArea = w * h;
    const fillRatio = bboxArea > 0 ? area / bboxArea : 0;

    if (
      area >= minArea &&
      area <= maxArea &&
      fillRatio > 0.6 &&
      !touchesBorder
    ) {
      regions.push({ x: minX, y: minY, w, h, area });
    } else {
      regions.push(null); // placeholder to keep regionId indexing simple; filtered below
    }
  }

  const kept = regions.filter(Boolean);
  kept.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return kept;
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
    const pad = 4;
    const scale = 2;
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
    let best = null;
    const words = (result && result.words) || [];
    for (const w of words) {
      const token = (w.text || '').trim().toUpperCase();
      if (NUMBER_RE.test(token)) { best = token; break; }
    }
    if (best) numbers[ri] = best;
    self.postMessage({ id, kind: 'ocr-result', index: ri, number: best || '' });

    done++;
    self.postMessage({ id, kind: 'ocr-progress', done, total });
  }

  return numbers;
}
