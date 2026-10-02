// autobuild.worker.js
// Module worker for AutoBuild. Two jobs:
//   { kind:'rectify', width, height, data }     -> { kind:'rectified', width, height, data, corners } | { kind:'rectify-failed' }
//   { kind:'build',   width, height, data }     -> { kind:'progress', frac, label }* then { kind:'result', floor, items, review, stats, ocr, outlineInfo }
// Room numbers are read with Tesseract.js (lazy, from jsDelivr, three workers in parallel);
// when it cannot load (offline) the plan is still built, just without numbers.
// Depends on: js/model/autobuild/{rectify,pipeline}.js.

import { rectify } from '../model/autobuild/rectify.js';
import { buildFromPlan } from '../model/autobuild/pipeline.js';

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ';

async function makeOcrPool(n) {
  const mod = await import(TESS_URL);
  const Tesseract = mod.default || mod;
  const workers = [];
  for (let i = 0; i < n; i++) {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: '7' });
    workers.push({ worker, psm: '7', busy: false });
  }
  const waiting = [];
  const acquire = () => new Promise((resolve) => {
    const free = workers.find((w) => !w.busy);
    if (free) { free.busy = true; resolve(free); } else waiting.push(resolve);
  });
  const release = (w) => {
    const next = waiting.shift();
    if (next) next(w); else w.busy = false;
  };
  return {
    async ocr({ data, w, h }, { psm = '7' } = {}) {
      const slot = await acquire();
      try {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = data[i];
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        if (slot.psm !== psm) { await slot.worker.setParameters({ tessedit_pageseg_mode: psm }); slot.psm = psm; }
        const { data: res } = await slot.worker.recognize(canvas);
        return { text: (res.text || '').trim(), conf: res.confidence || 0 };
      } finally { release(slot); }
    },
    async close() { await Promise.all(workers.map((w) => w.worker.terminate())); },
  };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const img = { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.data) };
    if (msg.kind === 'rectify') {
      const r = rectify(img);
      if (!r) { self.postMessage({ kind: 'rectify-failed' }); return; }
      self.postMessage({
        kind: 'rectified', width: r.image.width, height: r.image.height, data: r.image.data.buffer, corners: r.corners,
      }, [r.image.data.buffer]);
      return;
    }
    if (msg.kind === 'build') {
      let pool = null;
      let ocrOk = false;
      self.postMessage({ kind: 'progress', frac: 0.01, label: 'Warming up the text reader' });
      try { pool = await makeOcrPool(3); ocrOk = true; } catch { pool = null; }
      const result = await buildFromPlan(img, {
        ocr: pool ? (im, o) => pool.ocr(im, o) : null,
        concurrency: 3,
        onProgress: (frac, label) => self.postMessage({ kind: 'progress', frac, label }),
      });
      if (pool) await pool.close();
      self.postMessage({
        kind: 'result', floor: result.floor, items: result.items, review: result.review, stats: result.stats, ocr: ocrOk,
        scale: result.scale, viewW: result.viewW, viewH: result.viewH,
        outlineInfo: result.outlineInfo, outlinePx: result.outlinePx,
        hallAdded: (result.hallPass && result.hallPass.added) || [],
        hallExtended: (result.hallPass && result.hallPass.extended) || [],
        hallBefore: (result.hallPass && result.hallPass.hallBefore) || {},
      });
    }
  } catch (err) {
    self.postMessage({ kind: 'error', message: err && err.message ? err.message : String(err) });
  }
};
