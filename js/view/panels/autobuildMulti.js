// autobuildMulti.js
// AutoBuild for a floor posted as SEVERAL photos: each photo is built on its own (same worker, same pipeline), then the
// plans are joined (js/model/stitch.js): room numbers on two photos, or a corridor that runs from one photo into the
// next, say where each belongs; whatever nothing connects keeps the place it has on the merge board. The photos
// get placed to match, so the plan sits on its pictures. Everything is in the first photo's plan units.
// Depends on: js/workers/autobuild.worker.js, js/model/stitch.js, js/model/photos.js.

import { layoutPlans, mergePlans } from '../../model/stitch.js';
import { photoCorners, tOf, translateDoc } from '../../model/photos.js';

// One photo through the worker. -> { promise, cancel }; the promise resolves with the worker's result message.
export function buildInWorker(pixels, floor, onProgress) {
  const worker = new Worker(new URL('../../workers/autobuild.worker.js', import.meta.url), { type: 'module' });
  const copy = pixels.data.buffer.slice(0);
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === 'progress') onProgress(m.frac, m.label);
      else if (m.kind === 'result') { worker.terminate(); resolve(m); } else if (m.kind === 'error') { worker.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('AutoBuild could not start.')); };
    worker.postMessage({ kind: 'build', width: pixels.width, height: pixels.height, data: copy, floor }, [copy]);
  });
  return { promise, cancel: () => worker.terminate() };
}

const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
export async function pixelsOf(dataUrl) {
  const im = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data };
}

// The board's placement of photo i as a transform of plan i into plan 0 (used when the user arranged the board by hand).
function boardTransform(i, results, boards) {
  const sc0 = results[0].scale, sci = results[i].scale;
  const b = boards[i];
  if (b && b.t) {
    const t = tOf(b);
    const q = ((Math.round(t.a / 90) % 4) + 4) % 4;
    // plan_i = sci * pixel; board frame = main pixel frame; plan_0 = sc0 * board
    const s = (sc0 * t.s) / sci;
    // rotation about the photo's top-left corner: p0 = sc0 * (t.xy + t.s R(a) p) with p = plan_i / sci
    return { q, s, tx: sc0 * t.x, ty: sc0 * t.y, how: 'board', n: 0, rms: 0 };
  }
  return null;
}

// list: [{ pixels, photo: { dataUrl, width, height }, board: placement | null }]. opts: { floor, onProgress(frac, label), onWorker(cancelFn) }
// -> { items, floor, review, scale, viewW, viewH, layout: [{ t }], notes: [string], transforms }
export async function buildMany(list, opts) {
  const n = list.length, results = [];
  for (let i = 0; i < n; i++) {
    const job = buildInWorker(list[i].pixels, opts.floor, (frac, label) => opts.onProgress((i + frac) / n * 0.92, n > 1 ? `Photo ${i + 1} of ${n}: ${label}` : label));
    if (opts.onWorker) opts.onWorker(job.cancel);
    results.push(await job.promise);
  }
  if (typeof window !== 'undefined') window.__multiResults = results; // for debugging (tools/)
  const plans = results.map((m, i) => ({
    id: `photo ${i + 1}`, items: m.items, floor: m.floor, w: m.viewW, h: m.viewH,
    compass: (() => { const c = m.items.find((it) => it.type === 'compass'); return c ? { x: c.x, y: c.y, deg: c.deg } : null; })(),
  }));
  opts.onProgress(0.94, 'Joining the photos');
  const boards = list.map((l) => l.board || null);
  const forced = (typeof window !== 'undefined' && window.__forceTransforms) || null; // a tool may fix the placements (debugging, tools/)
  const { tfs, notes } = layoutPlans(plans, { boardTf: (i) => boardTransform(i, results, boards), arranged: !!list.arranged, forced });
  const merged = mergePlans(plans, tfs);
  // photo placements in the merged frame: pixel -> plan_i (x scale_i) -> plan_0
  const layout = list.map((l, i) => {
    const t = tfs[i];
    return { t: { x: t.tx, y: t.ty, s: t.s * results[i].scale, a: 90 * t.q } };
  });
  // everything moves so the plan and its photos sit in positive coordinates
  const probe = list.map((l, i) => ({ width: i === 0 ? results[0].viewW : l.photo.width, height: i === 0 ? results[0].viewH : l.photo.height, t: i === 0 ? { x: 0, y: 0, s: 1, a: 0 } : layout[i].t }));
  let x0 = 0, y0 = 0;
  for (const p of probe) for (const [x, y] of photoCorners(p)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  for (const it of merged.items) for (const [x, y] of it.points || [[it.x, it.y]]) if (Number.isFinite(x)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  const dx = x0 < 0 ? Math.ceil(-x0 / 5) * 5 + 20 : 0, dy = y0 < 0 ? Math.ceil(-y0 / 5) * 5 + 20 : 0;
  const moved = dx || dy ? translateDoc({ items: merged.items, floor: merged.floor }, dx, dy) : { items: merged.items, floor: merged.floor };
  const lay = layout.map((l, i) => ({ t: { ...l.t, x: l.t.x + dx, y: l.t.y + dy }, main: i === 0 }));
  lay[0].t = { x: dx, y: dy, s: 1, a: 0 };
  let ub = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  probe.forEach((p, i) => { for (const [x, y] of photoCorners({ ...p, t: lay[i].t })) ub = { x0: Math.min(ub.x0, x), y0: Math.min(ub.y0, y), x1: Math.max(ub.x1, x), y1: Math.max(ub.y1, y) }; });
  const review = results.flatMap((m) => m.review || []);
  for (const d of merged.report.dropped) void d;
  return {
    items: moved.items, floor: moved.floor, review, notes, layout: lay, transforms: tfs, report: merged.report,
    scale: results[0].scale, viewW: Math.round(ub.x1), viewH: Math.round(ub.y1), ocr: results.every((m) => m.ocr), results,
  };
}
