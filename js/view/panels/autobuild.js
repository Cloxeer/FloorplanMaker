// autobuild.js
// AutoBuild UI: straightens a photo with the plan's own walls (photo step),
// then builds the plan in front of the user (studio) with a progress bar:
// outline, hallways, rooms, stairs, elevator, exits, compass appear one batch
// at a time, and everything lands as ONE undo step. Rooms it is unsure about
// are listed so the user can jump straight to them.
// Depends on: js/workers/autobuild.worker.js, js/model/document.js (setFloor, addItem).

import { setFloor } from '../../model/document.js';
import { ensureTraceStyle, createOutlineTrace, askOutline } from './autobuildTrace.js';
import { buildMany } from './autobuildMulti.js';

const STYLE = `
.ab-overlay { position:absolute; inset:0; z-index:30; display:flex; align-items:flex-start; justify-content:center; pointer-events:none; }
.ab-card { pointer-events:auto; margin-top:18px; background:#fff; border:1px solid #d5d9df; border-radius:12px; box-shadow:0 8px 30px rgba(20,30,50,.18); padding:14px 18px 12px; width:min(420px,92%); font:13px/1.35 system-ui,sans-serif; color:#23272e; }
.ab-card h3 { margin:0 0 2px; font-size:15px; }
.ab-sub { margin:0 0 10px; color:#6b7078; min-height:18px; }
.ab-bar { height:10px; border-radius:6px; background:#e8ebf0; overflow:hidden; }
.ab-fill { height:100%; width:0; background:linear-gradient(90deg,#2f6feb,#5b95ff); border-radius:6px; transition:width .25s ease; }
.ab-row { display:flex; justify-content:space-between; align-items:center; margin-top:8px; color:#6b7078; font-size:12px; }
.ab-row button { font:inherit; }
.ab-review { position:absolute; left:14px; bottom:14px; z-index:30; background:#fff; border:1px solid #d5d9df; border-radius:12px; box-shadow:0 8px 30px rgba(20,30,50,.18); width:min(320px,80%); max-height:45%; overflow:auto; font:13px/1.35 system-ui,sans-serif; color:#23272e; }
.ab-review header { display:flex; justify-content:space-between; align-items:center; padding:10px 12px 6px; font-weight:600; }
.ab-review ul { list-style:none; margin:0; padding:0 6px 8px; }
.ab-review li button { all:unset; display:block; width:calc(100% - 12px); padding:6px; border-radius:6px; cursor:pointer; }
.ab-review li button:hover { background:#eef3fe; }
.ab-review li span { display:block; color:#6b7078; font-size:12px; }
#stage.ab-building #start-overlay { display:none !important; }
.ab-x { all:unset; cursor:pointer; padding:0 6px; font-size:18px; line-height:1; color:#6b7078; }
`;

function ensureStyle() {
  if (document.getElementById('ab-style')) return;
  const el = document.createElement('style');
  el.id = 'ab-style';
  el.textContent = STYLE;
  document.head.appendChild(el);
}

function toPixels(canvas) {
  const ctx = canvas.getContext('2d');
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: d.data };
}

function canvasFrom(pixels) {
  const c = document.createElement('canvas');
  c.width = pixels.width; c.height = pixels.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return c;
}

// Photo step: find the plan, remove tilt and keystone, crop to it.
// -> { photo, pixels } or null when the plan could not be found (caller falls back to manual corners).
export function autoStraighten(srcCanvas, originalDataUrl) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../../workers/autobuild.worker.js', import.meta.url), { type: 'module' });
    const src = toPixels(srcCanvas);
    const copy = src.data.buffer.slice(0);
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === 'rectified') {
        worker.terminate();
        const pixels = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) };
        const out = canvasFrom(pixels);
        resolve({
          photo: {
            dataUrl: out.toDataURL('image/jpeg', 0.88), width: m.width, height: m.height,
            corners: m.corners.map((p) => [...p]), originalDataUrl,
          },
          pixels,
        });
      } else if (m.kind === 'rectify-failed' || m.kind === 'error') { worker.terminate(); resolve(null); }
    };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    worker.postMessage({ kind: 'rectify', width: src.width, height: src.height, data: copy }, [copy]);
  });
}

const STAGES = ['Outline', 'Hallways', 'Rooms', 'Stairs, elevator, doors', 'Filling in the hallways', 'Compass'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function mountAutoBuild(app) {
  ensureStyle();
  ensureTraceStyle();
  let worker = null, overlay = null, reviewEl = null, cancelled = false, skipped = false, trace = null, ask = null, shownDoc = null;
  app._autobuildShown = () => shownDoc; // read by tests/browser/autobuild-reveal.spec.js

  function stageEl() { return document.getElementById('stage'); }

  function showCard() {
    overlay = document.createElement('div');
    overlay.className = 'ab-overlay';
    overlay.innerHTML = `<div class="ab-card ab-main" role="status">
      <h3>AutoBuild</h3><p class="ab-sub">Starting…</p>
      <div class="ab-bar"><div class="ab-fill"></div></div>
      <ul class="ab-stages">${STAGES.map((n) => `<li>${n}</li>`).join('')}</ul>
      <div class="ab-row"><span class="ab-pct">0%</span><span><button type="button" class="ab-skip" hidden>Skip animation</button> &nbsp; <button type="button" class="ab-cancel">Cancel</button></span></div></div>`;
    stageEl().appendChild(overlay);
    stageEl().classList.add('ab-building'); // no "draw the outline" intro while the build runs
    overlay.querySelector('.ab-cancel').addEventListener('click', cancel);
    overlay.querySelector('.ab-skip').addEventListener('click', () => { skipped = true; if (trace) trace.skip(); });
  }
  function setProgress(frac, label) {
    if (!overlay) return;
    const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    overlay.querySelector('.ab-fill').style.width = `${pct}%`;
    overlay.querySelector('.ab-pct').textContent = `${pct}%`;
    if (label) overlay.querySelector('.ab-sub').textContent = `${label}…`;
  }
  function hideCard() {
    shownDoc = null;
    if (ask) { ask.close('cancel'); ask = null; }
    if (trace) { trace.destroy(); trace = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    const st = stageEl();
    if (st) st.classList.remove('ab-building');
  }
  function cancel() {
    cancelled = true;
    if (trace) trace.skip();
    if (worker) { worker.terminate(); worker = null; }
    hideCard();
    app.canvas.setDoc(app.doc);
    app.setHint('');
  }

  // The plan is built at one standard room size, so the photo is resized to match:
  // every plan gets the same scale and rooms have space for their numbers.
  async function rescalePhoto(viewW, viewH) {
    const photo = app.project && app.project.photo;
    if (!photo || (photo.width === viewW && photo.height === viewH)) return;
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = photo.dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = viewW; c.height = viewH;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, viewW, viewH);
    app.project.photo = { ...photo, dataUrl: c.toDataURL('image/jpeg', 0.9), width: viewW, height: viewH };
    app.canvas.setPhoto(app.project.photo);
  }

  // Reveal in distinct, readable stages: 1 outline (then WAIT for the user), 2 hallways, 3 rooms,
  // 4 stairs / elevator / doors, 5 second-pass hallways, 6 compass. Everything lands as ONE undo step.
  // what the stage shows while the build is revealed (the real document only changes at the very end)
  function showDoc(d) { shownDoc = d; app.canvas.setDoc(d); }
  function setStage(i, label) {
    if (!overlay) return;
    overlay.querySelectorAll('.ab-stages li').forEach((li, k) => { li.className = k < i ? 'done' : k === i ? 'on' : ''; });
    if (label) overlay.querySelector('.ab-sub').textContent = `${label}…`;
  }
  const wait = (ms) => (skipped || cancelled ? Promise.resolve() : sleep(ms));

  // Add `list` to the doc in `n` small batches, `ms` apart. Skipping adds the rest at once.
  async function addInBatches(doc, list, n, ms, f0, f1, label) {
    const size = Math.max(1, Math.ceil(list.length / Math.max(1, n)));
    for (let i = 0; i < list.length; i += size) {
      if (cancelled) return doc;
      const chunk = skipped ? list.slice(i) : list.slice(i, i + size);
      doc = { ...doc, items: [...doc.items, ...chunk] };
      showDoc(doc);
      setProgress(f0 + (f1 - f0) * Math.min(1, (i + chunk.length) / list.length), label);
      if (skipped) break;
      await wait(ms);
    }
    return doc;
  }

  async function reveal(result, base) {
    skipped = false;
    const rank = { hall: 1, room: 2, stair: 3, door: 5 };
    const compass = result.items.filter((it) => it.type === 'compass'); // its own last step, after everything else
    // second-pass halls: new ones wait for their own step; extended ones start from their first-pass shape
    const late = new Set(result.hallAdded || []);
    const grown = (result.hallExtended || []).map((id) => result.items.find((it) => it.id === id)).filter(Boolean);
    const before = result.hallBefore || {};
    const lateHalls = result.items.filter((it) => late.has(it.id));
    const early = result.items.filter((it) => it.type !== 'compass' && !late.has(it.id)).map((it) => (before[it.id] ? { ...it, ...before[it.id] } : it)).sort((a, b) => {
      const ra = a.cls === 'core' ? 4 : rank[a.type] || 7, rb = b.cls === 'core' ? 4 : rank[b.type] || 7;
      if (ra !== rb) return ra - rb;
      const ya = a.y != null ? a.y : (a.y1 || 0), yb = b.y != null ? b.y : (b.y1 || 0);
      return ya - yb || (a.x || 0) - (b.x || 0);
    });
    const halls = early.filter((it) => it.type === 'hall');
    const rooms = early.filter((it) => it.type === 'room' && it.cls !== 'core');
    const rest = early.filter((it) => !halls.includes(it) && !rooms.includes(it));
    const pts = result.floor.points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    const info = result.outlineInfo && result.outlineInfo.segments && result.outlineInfo.segments.length
      ? result.outlineInfo
      : { segments: pts.map((a, i) => ({ a, b: pts[(i + 1) % pts.length], supported: 1, kind: 'wall' })), coverage: 1, notes: [] };

    // stage 1: the outline, drawn slowly, then a question the user must answer
    let doc = base;
    showDoc(doc);
    app.canvas.zoomTo(true);
    overlay.querySelector('.ab-skip').hidden = false;
    setStage(0, 'Tracing the outline');
    setProgress(0.9, 'Tracing the outline');
    trace = createOutlineTrace(app);
    await trace.animate(info.segments, 2500);
    if (cancelled) return null;
    doc = setFloor(base, pts);
    showDoc(doc);
    const card = overlay.querySelector('.ab-main');
    card.hidden = true;
    app.setHint('Check the outline: dashed orange parts have no wall in the photo.');
    ask = askOutline(overlay, info);
    const choice = await ask.promise;
    ask = null;
    if (cancelled) return null;
    if (choice === 'cancel') { cancel(); return null; }
    trace.hide();
    if (choice === 'fix') return { doc, stopped: true };
    card.hidden = false;
    skipped = false; // a skip during the outline must not skip the rooms

    // stages 2, 3, 4: hallways, rooms, stairs / elevator / doors
    setStage(1, 'Hallways'); await wait(500);
    doc = await addInBatches(doc, halls, 8, 220, 0.92, 0.93, 'Hallways');
    setStage(2, 'Rooms'); await wait(500);
    doc = await addInBatches(doc, rooms, 25, 75, 0.93, 0.97, 'Rooms');
    setStage(3, 'Stairs, elevator and doors'); await wait(500);
    doc = await addInBatches(doc, rest, 10, 130, 0.97, 0.98, 'Stairs, elevator and doors');
    if ((lateHalls.length || grown.length) && !cancelled) {
      setStage(4, 'Filling in the hallways'); setProgress(0.98, 'Filling in the hallways');
      await wait(600);
      const now = new Map(grown.map((it) => [it.id, it]));
      doc = { ...doc, items: [...doc.items.map((it) => now.get(it.id) || it), ...lateHalls] };
      showDoc(doc);
      await wait(500);
    }
    if (compass.length && !cancelled) {
      setStage(5, 'Adding the compass'); setProgress(0.995, 'Adding the compass');
      await wait(600);
      doc = { ...doc, items: [...doc.items, ...compass] };
      showDoc(doc);
      await wait(400);
    }
    return { doc, stopped: false };
  }

  function showReview(result) {
    if (reviewEl) { reviewEl.remove(); reviewEl = null; }
    if (!result.review.length) return;
    const byId = new Map(result.items.map((it) => [it.id, it]));
    reviewEl = document.createElement('div');
    reviewEl.className = 'ab-review';
    reviewEl.innerHTML = `<header><span>${result.review.length} to double-check</span><button class="ab-x" type="button" aria-label="Close">×</button></header><ul></ul>`;
    const ul = reviewEl.querySelector('ul');
    for (const r of result.review) {
      const it = byId.get(r.id);
      if (!it) continue;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const title = it.number || it.name || 'Room';
      b.innerHTML = `<strong></strong><span></span>`;
      b.querySelector('strong').textContent = title;
      b.querySelector('span').textContent = r.reason;
      b.addEventListener('click', () => app.setSelection([it.id]));
      li.appendChild(b);
      ul.appendChild(li);
    }
    reviewEl.querySelector('.ab-x').addEventListener('click', () => { reviewEl.remove(); reviewEl = null; });
    stageEl().appendChild(reviewEl);
  }

  async function run(pixels) {
    if (!pixels || !app.project) return;
    const had = app.doc.items.length > 0 || !!app.doc.floor;
    if (had) {
      const ok = await app.confirm('AutoBuild will replace what is on the plan now. (You can undo it.) Continue?');
      if (!ok) return;
    }
    // a fresh plan on the new photo: same details, empty drawing, sized to the photo
    const base = { ...app.doc, items: [], floor: null, viewBox: { x: 0, y: 0, w: pixels.width, h: pixels.height } };
    cancelled = false;
    if (worker) worker.terminate();
    showCard();
    app.setHint('AutoBuild is reading the photo…');
    worker = new Worker(new URL('../../workers/autobuild.worker.js', import.meta.url), { type: 'module' });
    const copy = pixels.data.buffer.slice(0);
    worker.onmessage = async (e) => {
      const m = e.data || {};
      if (m.kind === 'progress') setProgress(Math.min(0.89, m.frac * 0.9), m.label);
      else if (m.kind === 'error') {
        hideCard(); worker = null;
        app.toast(`AutoBuild failed: ${m.message}`);
      } else if (m.kind === 'result') {
        worker.terminate(); worker = null;
        const vw = m.viewW || pixels.width, vh = m.viewH || pixels.height;
        try { await rescalePhoto(vw, vh); } catch { /* keep the old photo */ }
        base.viewBox = { x: 0, y: 0, w: vw, h: vh };
        const out = await reveal(m, base);
        if (!out) return;
        hideCard();
        if (out.stopped) {
          app.commit(out.doc, 'AutoBuild outline'); // only the outline: one undo step
          app.canvas.zoomTo(true);
          app.toast('AutoBuild stopped after the outline. Fix it, or undo and run AutoBuild again.');
          app.setHint('Edit the outline, then add rooms.');
          return;
        }
        app.commit(out.doc, 'AutoBuild');
        app.canvas.zoomTo(true);
        const rooms = m.items.filter((it) => it.type === 'room').length;
        const compassNote = m.items.some((it) => it.type === 'compass') ? ' · Compass placed' : ' · No compass found - add it from the palette';
        const pieces = (m.hallAdded || []).length + (m.hallExtended || []).length;
        const hallNote = pieces ? ` · hallways filled in (${pieces} piece${pieces === 1 ? '' : 's'})` : '';
        app.toast(`AutoBuild placed ${rooms} rooms${hallNote}${compassNote}${m.review.length ? ` · ${m.review.length} need a look` : ''}${m.ocr ? '' : ' (text reading unavailable offline, add numbers by hand)'}`);
        app.setHint('Review what AutoBuild drew, then refine.');
        showReview(m);
      }
    };
    worker.onerror = () => { hideCard(); worker = null; app.toast('AutoBuild could not start.'); };
    worker.postMessage({ kind: 'build', width: pixels.width, height: pixels.height, data: copy, floor: app.doc && app.doc.meta ? app.doc.meta.floor : undefined }, [copy]);
  }

  // Several photos of one floor: each is built on its own, the plans are joined, the photos are placed to match.
  // list: [{ pixels, photo, board }] (see autobuildMulti.js). The first photo stays the project's photo.
  async function runMulti(list) {
    if (!list || !list.length || !app.project) return;
    if (list.length === 1) return run(list[0].pixels);
    const had = app.doc.items.length > 0 || !!app.doc.floor;
    if (had && !(await app.confirm('AutoBuild will replace what is on the plan now. (You can undo it.) Continue?'))) return;
    cancelled = false;
    let cancelWorker = null;
    showCard();
    app.setHint('AutoBuild is reading the photos…');
    let m;
    try {
      m = await buildMany(list, { floor: app.doc.meta && app.doc.meta.floor, onProgress: setProgress, onWorker: (c) => { cancelWorker = c; } });
    } catch (err) {
      hideCard();
      if (!cancelled) app.toast(`AutoBuild failed: ${err.message}`);
      return;
    }
    if (cancelled) { if (cancelWorker) cancelWorker(); return; }
    app._lastMulti = m; // read by tools/ (debugging) and the tests
    const vw = m.viewW, vh = m.viewH;
    try { await rescalePhoto(m.results[0].viewW, m.results[0].viewH); } catch { /* keep the old photo */ }
    // the other photos sit where the plan says; the first one too (it may have moved to keep everything on the page)
    const main = { ...app.project.photo, t: m.layout[0].t };
    app.project.photo = main;
    app.project.extraPhotos = list.slice(1).map((l, i) => ({ dataUrl: l.photo.dataUrl, width: l.photo.width, height: l.photo.height, t: m.layout[i + 1].t }));
    const base = { ...app.doc, items: [], floor: null, viewBox: { x: 0, y: 0, w: vw, h: vh } };
    app.canvas.setPhoto(app.project.photo);
    if (app._photoLayer && app._photoLayer.refresh) app._photoLayer.refresh();
    const out = await reveal({ ...m, outlineInfo: null, hallAdded: [], hallExtended: [], hallBefore: {} }, base);
    if (!out) return;
    hideCard();
    if (out.stopped) { app.commit(out.doc, 'AutoBuild outline'); app.canvas.zoomTo(true); return; }
    app.commit(out.doc, 'AutoBuild');
    app.canvas.zoomTo(true);
    const rooms = m.items.filter((it) => it.type === 'room').length;
    app.toast(`AutoBuild joined ${list.length} photos: ${rooms} rooms${m.notes.length ? ` · ${m.notes[0]}` : ''}${m.review.length ? ` · ${m.review.length} need a look` : ''}`);
    app.setHint('Review what AutoBuild drew, then refine.');
    showReview(m);
  }

  return {
    run,
    runMulti,
    destroy() {
      if (worker) { worker.terminate(); worker = null; }
      hideCard();
      if (reviewEl) { reviewEl.remove(); reviewEl = null; }
    },
  };
}
