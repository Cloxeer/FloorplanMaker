// autobuildMulti.js
// AutoBuild for a floor posted as SEVERAL photos: each photo is built on its own (same worker, same pipeline) and its plan is
// left over its own photo, where the merge board has it. Nothing is joined, turned or guessed: each plan's items are tagged
// piece: "Photo N" and the person combines the pieces afterwards. Everything is in the first photo's plan units.
// Depends on: js/workers/autobuild.worker.js, js/model/stitch.js (placeItem only), js/model/photos.js.

import { placeItem } from '../../model/stitch.js';
import { newId } from '../../model/document.js';
import { photoCorners, tOf, translateDoc } from '../../model/photos.js';
import { autoDraw } from '../../model/autoDraw.js';

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

// Pixels of a photo that was just straightened: handing them on as they are keeps AutoBuild reading exactly what the
// single-photo flow reads (a JPEG round trip of a small poster changes what the text reader sees).
const kept = new Map();
export function rememberPixels(dataUrl, pixels) { kept.set(dataUrl, pixels); }

const loadImage = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
export async function pixelsOf(dataUrl) {
  if (kept.has(dataUrl)) { const k = kept.get(dataUrl); kept.delete(dataUrl); return k; }
  const im = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data };
}

// The board's placement of photo i as a transform of plan i into plan 0 (used when the user arranged the board by hand).
// `origin`: where the first photo sits, so a first photo that was moved takes the others with it.
function boardTransform(i, results, boards, origin = { x: 0, y: 0 }) {
  const sc0 = results[0].scale, sci = results[i].scale;
  const b = boards[i];
  if (b && b.t) {
    const t = { ...tOf(b), x: tOf(b).x - origin.x, y: tOf(b).y - origin.y };
    const q = ((Math.round(t.a / 90) % 4) + 4) % 4;
    // plan_i = sci * pixel; board frame = main pixel frame; plan_0 = sc0 * board
    const s = (sc0 * t.s) / sci;
    // rotation about the photo's top-left corner: p0 = sc0 * (t.xy + t.s R(a) p) with p = plan_i / sci
    return { q, s, tx: sc0 * t.x, ty: sc0 * t.y, how: 'board', n: 0, rms: 0 };
  }
  return null;
}

// every photo through the worker, one after the other -> the workers' results
async function buildPlans(list, opts) {
  const n = list.length, results = [];
  for (let i = 0; i < n; i++) {
    const job = buildInWorker(list[i].pixels, opts.floor, (frac, label) => opts.onProgress((i + frac) / n * 0.92, n > 1 ? `Photo ${i + 1} of ${n}: ${label}` : label));
    if (opts.onWorker) opts.onWorker(job.cancel);
    results.push(await job.promise);
  }
  if (typeof window !== 'undefined') window.__multiResults = results; // for debugging (tools/)
  return results;
}

// Everything the plan needs once every photo has its transform: the items moved into place (piece-tagged by `pieceOf(i)` unless
// `items` is given), the photos' placements, and the whole thing shifted so it sits in positive coordinates. `extra` = { floor, outlines }
// (already in the same frame) travels with the items.
function placeAll(results, list, tfs, items, extra = {}) {
  const layout = list.map((l, i) => {
    const t = tfs[i];
    return { t: { x: t.tx, y: t.ty, s: t.s * results[i].scale, a: 90 * t.q } };
  });
  // everything moves so the plan and its photos sit in positive coordinates
  const probe = list.map((l, i) => ({ width: i === 0 ? results[0].viewW : l.photo.width, height: i === 0 ? results[0].viewH : l.photo.height, t: i === 0 ? { x: 0, y: 0, s: 1, a: 0 } : layout[i].t }));
  let x0 = 0, y0 = 0;
  for (const p of probe) for (const [x, y] of photoCorners(p)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  for (const it of items) for (const [x, y] of it.points || [[it.x, it.y]]) if (Number.isFinite(x)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  const dx = x0 < 0 ? Math.ceil(-x0 / 5) * 5 + 20 : 0, dy = y0 < 0 ? Math.ceil(-y0 / 5) * 5 + 20 : 0;
  const moved = dx || dy ? translateDoc({ items: [...items, ...(extra.outlines || [])], floor: extra.floor || null }, dx, dy) : { items: [...items, ...(extra.outlines || [])], floor: extra.floor || null };
  const lay = layout.map((l, i) => ({ t: { ...l.t, x: l.t.x + dx, y: l.t.y + dy }, main: i === 0 }));
  lay[0].t = { x: dx, y: dy, s: 1, a: 0 };
  let ub = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  probe.forEach((p, i) => { for (const [x, y] of photoCorners({ ...p, t: lay[i].t })) ub = { x0: Math.min(ub.x0, x), y0: Math.min(ub.y0, y), x1: Math.max(ub.x1, x), y1: Math.max(ub.y1, y) }; });
  for (const it of moved.items) for (const [x, y] of it.points || [[it.x + (it.w || 0), it.y + (it.h || 0)]]) if (Number.isFinite(x)) { ub = { ...ub, x1: Math.max(ub.x1, x), y1: Math.max(ub.y1, y) }; }
  return {
    items: moved.items, floor: moved.floor, layout: lay, transforms: tfs,
    report: { placed: tfs.map((t, i) => ({ id: `photo ${i + 1}`, how: t.how })), dropped: [], unplaced: [] },
    scale: results[0].scale, viewW: Math.round(ub.x1), viewH: Math.round(ub.y1), ocr: results.every((m) => m.ocr), results,
  };
}

// list: [{ pixels, photo: { dataUrl, width, height }, board: placement | null }]. opts: { floor, onProgress(frac, label), onWorker(cancelFn) }
// -> { items, floor, review, scale, viewW, viewH, layout: [{ t }], notes: [string], transforms }
export async function buildMany(list, opts) {
  const n = list.length;
  const results = await buildPlans(list, opts);
  // Nothing is joined or guessed: every photo is built on its own and its plan is left exactly over its own photo, where the
  // merge board has that photo (the person lined them up there). Each plan's items carry piece: "Photo N"; turning, moving and
  // combining the pieces is the person's job afterwards (Layers: select / hide a piece, then move / turn it as a group).
  opts.onProgress(0.94, 'Placing each plan on its photo');
  const boards = list.map((l) => l.board || null);
  const tfs = [];
  results.forEach((m, i) => {
    if (i === 0) { tfs.push({ q: 0, s: 1, tx: 0, ty: 0, how: 'reference' }); return; }
    const b = boardTransform(i, results, boards);
    if (b) { tfs.push(b); return; }
    // no board placement at all: to the right of the plans before it, with a gap
    let right = 0;
    for (let k = 0; k < i; k++) right = Math.max(right, tfs[k].tx + results[k].viewW * (tfs[k].s || 1));
    tfs.push({ q: 0, s: 1, tx: right + 100, ty: 0, how: 'beside' });
  });
  const used = new Set();
  const items = [];
  results.forEach((m, i) => {
    for (const raw of m.items) {
      const it = { ...placeItem(raw, tfs[i]), piece: `Photo ${i + 1}` };
      if (used.has(it.id)) it.id = newId();
      used.add(it.id);
      items.push(it);
    }
  });
  const notes = [`${n} photos were built separately, one piece each (Photo 1 to Photo ${n}). Line them up yourself (Layers), then use Auto-outline.`];
  const placed = placeAll(results, list, tfs, items);
  return { ...placed, review: results.flatMap((m) => m.review || []), notes };
}

// AUTO DRAW: every photo is built, then drawn as BUILDINGS (js/model/autoDraw.js): photos with the same room numbers are one
// section (lined up on each other when the numbers say how, rooms on both kept once) with one outline round it, photos with
// the same letter prefix are one building, anything else keeps the place its photo has. Rooms, halls and stairs come with it.
// -> like buildMany, plus floor (the biggest building's outline) and outlines (the other buildings, as outline items)
export async function buildAuto(list, opts) {
  const results = await buildPlans(list, opts);
  opts.onProgress(0.94, 'Drawing the buildings');
  const origin = list[0] && list[0].board && list[0].board.t ? tOf(list[0].board) : { x: 0, y: 0 };
  const boards = [];
  results.forEach((m, i) => {
    const b = i === 0 ? { q: 0, s: 1, tx: 0, ty: 0, how: 'reference' } : boardTransform(i, results, list.map((l) => l.board || null), origin);
    if (b) { boards.push(b); return; }
    let right = 0; // no placement at all: to the right of the others, with a gap
    for (let k = 0; k < i; k++) right = Math.max(right, boards[k].tx + results[k].viewW * (boards[k].s || 1));
    boards.push({ q: 0, s: 1, tx: right + 100, ty: 0, how: 'beside' });
  });
  const plans = results.map((m, i) => { const c = m.items.find((it) => it.type === 'compass'); return { id: `Photo ${i + 1}`, items: m.items, floor: m.floor, compass: c ? { x: c.x, y: c.y, deg: c.deg } : null }; });
  const out = autoDraw(plans, boards);
  const used = new Set();
  const items = out.items.map((it) => { const o = used.has(it.id) ? { ...it, id: newId() } : it; used.add(o.id); return o; });
  const notes = [...out.notes];
  // a photo turned by hand is drawn in quarter turns only
  list.forEach((l, i) => { const a = l.board && l.board.t ? tOf(l.board).a : 0; if (i && Math.abs(a - 90 * out.tfs[i].q) > 1) notes.push(`Photo ${i + 1} was turned ${Math.round(a)}\u00b0; its drawing only turns in quarter turns, so the photo was set to ${90 * out.tfs[i].q}\u00b0.`); });
  const placed = placeAll(results, list, out.tfs, items, { floor: out.floor, outlines: out.outlines });
  return { ...placed, review: results.flatMap((m) => m.review || []), notes, buildings: out.buildings };
}
