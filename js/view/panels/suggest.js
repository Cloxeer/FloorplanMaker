// suggest.js
// "Suggest rooms" flow: rasterize the project photo, post to trace.worker for
// region detection, show ghosts on the canvas, run OCR on each region, then
// let the user accept/dismiss via a small floating bar.
// Depends on: js/model/document.js (addItem, makeRoom), js/model/geometry.js
// (polygonsOverlap, rectToPoints, polygonArea), app.canvas, app.doc.

import {
  addItem, makeRoom, roomPolygon, setFloor, doorFor, newId,
} from '../../model/document.js';
import { rectToPoints, polygonsOverlap, polygonArea } from '../../model/geometry.js';

const FLOOR_PAD = 12;

function proposeFloorOutline(app, regions) {
  if (!regions.length || app.doc.floor) return;
  const xs = [], ys = [];
  regions.forEach((r) => { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); });
  const minX = Math.min(...xs) - FLOOR_PAD;
  const minY = Math.min(...ys) - FLOOR_PAD;
  const maxX = Math.max(...xs) + FLOOR_PAD;
  const maxY = Math.max(...ys) + FLOOR_PAD;
  const points = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  app.commit(setFloor(app.doc, points), 'Propose floor outline');
}

function overlapsExisting(region, doc) {
  const regionPts = rectToPoints(region);
  const regionArea = Math.abs(polygonArea(regionPts));
  for (const item of doc.items) {
    if (item.type !== 'room') continue;
    const pts = roomPolygon(item);
    if (polygonsOverlap(regionPts, pts)) {
      // approximate overlap fraction via bbox intersection area
      const ib = intersectBoxArea(region, boundsOf(pts));
      if (regionArea > 0 && ib / regionArea > 0.5) return true;
    }
  }
  return false;
}

function boundsOf(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function intersectBoxArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

export function mountSuggest(app) {
  let worker = null;
  let ghosts = [];
  let bar = null;
  let ocrStatus = null; // "12/39" while OCR is running, shown in the suggest bar

  function makeBar() {
    const host = document.getElementById('dialogs');
    const div = document.createElement('div');
    div.className = 'suggest-bar';
    host.appendChild(div);
    return div;
  }

  function renderBar() {
    if (!bar) return;
    const statusText = ocrStatus
      ? `Reading room numbers… ${ocrStatus}`
      : `We found ${ghosts.length} room${ghosts.length === 1 ? '' : 's'}. Tap a room to keep it, or Keep all.`;
    bar.innerHTML = `
      <span>${statusText}</span>
      <button type="button" id="sg-accept-all">Keep all</button>
      <button type="button" id="sg-dismiss">Dismiss</button>
    `;
    bar.querySelector('#sg-accept-all').addEventListener('click', acceptAll);
    bar.querySelector('#sg-dismiss').addEventListener('click', dismiss);
  }

  function pushGhostsToCanvas() {
    app.canvas.setGhosts(ghosts.map((g, i) => ({ ...g, index: i })));
  }

  function onGhostAccept(e) {
    if (guideMode) return;
    const idx = e.detail && e.detail.index;
    acceptOne(idx);
  }

  function keepGhost(index, number) {
    const g = ghosts[index];
    if (!g) return;
    const item = makeRoom('room', g.x, g.y, g.w, g.h, number || '');
    app.commit(addItem(app.doc, item), 'Accept suggestion');
    ghosts = ghosts.filter((_, i) => i !== index).map((gg, i) => ({ ...gg, index: i }));
    pushGhostsToCanvas();
    renderBar();
    if (ghosts.length === 0) dismiss();
  }

  function acceptOne(index) {
    const g = ghosts[index];
    if (!g) return;
    if (!g.number) {
      // No number was read off the photo (ghost shows "?") — ask before
      // keeping it, same prompt used elsewhere for room numbers.
      app.prompt('Room number', '', { validate: 'roomNumber' }).then((value) => {
        if (value == null) return;
        keepGhost(index, value);
      });
      return;
    }
    keepGhost(index, g.number);
  }

  function acceptAll() {
    let doc = app.doc;
    ghosts.forEach((g) => {
      doc = addItem(doc, makeRoom('room', g.x, g.y, g.w, g.h, g.number || ''));
    });
    app.commit(doc, 'Accept all suggestions');
    ghosts = [];
    pushGhostsToCanvas();
    dismiss();
  }

  function dismiss() {
    ghosts = [];
    ocrStatus = null;
    guideMode = null;
    app.canvas.setGhosts([]);
    if (bar) { bar.remove(); bar = null; }
    app.setHint('');
  }

  function terminateWorker() {
    if (worker) { worker.terminate(); worker = null; }
  }

  function getPhotoPixels() {
    const photo = app.project && app.project.photo;
    if (!photo) return null;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = ('OffscreenCanvas' in window)
          ? new OffscreenCanvas(img.width, img.height)
          : document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ width: img.width, height: img.height, data: data.data });
      };
      img.onerror = () => reject(new Error('Could not load the photo for tracing.'));
      img.src = photo.dataUrl;
    });
  }

  async function run() {
    let pixelData;
    try {
      pixelData = await getPhotoPixels();
    } catch (err) {
      app.toast(err && err.message ? err.message : 'Could not read the photo.');
      return;
    }
    if (!pixelData) {
      app.toast('No photo to trace yet.');
      return;
    }
    terminateWorker();
    worker = new Worker(new URL('../../workers/trace.worker.js', import.meta.url), { type: 'module' });

    bar = makeBar();
    ghosts = [];
    ocrStatus = null;
    renderBar();
    app.setHint('Tracing rooms from the photo…');

    worker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.kind === 'trace-progress') {
        app.setHint(`Tracing rooms from the photo… ${msg.progress != null ? Math.round(msg.progress * 100) + '%' : ''}`);
      } else if (msg.kind === 'trace-result') {
        const regions = (msg.regions || []).filter((r) => !overlapsExisting(r, app.doc));
        ghosts = regions.map((r, i) => ({ x: r.x, y: r.y, w: r.w, h: r.h, number: '', index: i }));
        proposeFloorOutline(app, regions);
        pushGhostsToCanvas();
        renderBar();
        app.setHint(`We found ${ghosts.length} rooms. Running text recognition…`);
        worker.postMessage({ id: 'ocr', kind: 'ocr', width: pixelData.width, height: pixelData.height, data: pixelData.data, regions: ghosts });
      } else if (msg.kind === 'ocr-progress') {
        ocrStatus = `${msg.done}/${msg.total}`;
        renderBar();
      } else if (msg.kind === 'ocr-result') {
        const idx = msg.index;
        if (ghosts[idx]) {
          ghosts[idx] = { ...ghosts[idx], number: msg.number || '' };
          pushGhostsToCanvas();
        }
      } else if (msg.kind === 'ocr-done') {
        ocrStatus = null;
        renderBar();
        app.setHint(ghosts.length ? 'Review the suggested rooms, then accept or dismiss.' : 'No rooms detected.');
      } else if (msg.kind === 'error') {
        app.toast(`Suggest rooms failed: ${msg.message || 'unknown error'}`);
      }
    });

    const outline = app.doc && app.doc.floor && app.doc.floor.points ? app.doc.floor.points : null;
    worker.postMessage({
      id: 'trace', kind: 'trace', width: pixelData.width, height: pixelData.height, data: pixelData.data, outline,
    });
  }

  // --- shared "guide" ghost handling (stairs/doors and hallways) ---
  let guideMode = null; // 'stairs' | 'halls' | null

  function makeGuideItem(g) {
    if (g.kind === 'stair') return { id: newId(), type: 'stair', x: g.x, y: g.y, w: g.w, h: g.h, dir: 'v' };
    if (g.kind === 'hall') return { id: newId(), type: 'hall', x: g.x, y: g.y, w: g.w, h: g.h };
    if (g.kind === 'door') {
      const outline = app.doc.floor && app.doc.floor.points;
      const mid = { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 };
      const door = doorFor(outline, mid);
      if (!door) return null;
      return { id: newId(), type: 'door', ...door, kind: 'EXIT' };
    }
    return null;
  }

  function keepGuideGhost(index) {
    const g = ghosts[index];
    if (!g) return;
    const item = makeGuideItem(g);
    if (!item) return;
    app.commit(addItem(app.doc, item), g.kind === 'door' ? 'Accept door' : g.kind === 'stair' ? 'Accept stair' : 'Accept hallway');
    ghosts = ghosts.filter((_, i) => i !== index).map((gg, i) => ({ ...gg, index: i }));
    pushGhostsToCanvas();
    renderGuideBar();
    if (ghosts.length === 0) dismiss();
  }

  function acceptAllGuides() {
    let doc = app.doc;
    ghosts.forEach((g) => {
      const item = makeGuideItem(g);
      if (item) doc = addItem(doc, item);
    });
    app.commit(doc, guideMode === 'stairs' ? 'Accept all doors/stairs' : 'Accept all hallways');
    ghosts = [];
    pushGhostsToCanvas();
    dismiss();
  }

  function renderGuideBar() {
    if (!bar) return;
    let statusText;
    if (guideMode === 'stairs') {
      const nDoors = ghosts.filter((g) => g.kind === 'door').length;
      const nStairs = ghosts.filter((g) => g.kind === 'stair').length;
      statusText = `We found ${nDoors} door${nDoors === 1 ? '' : 's'} and ${nStairs} stair${nStairs === 1 ? '' : 's'}. Tap one to keep it, or Keep all.`;
    } else {
      statusText = `We found ${ghosts.length} hallway${ghosts.length === 1 ? '' : 's'}. Tap one to keep it, or Keep all.`;
    }
    bar.innerHTML = `
      <span>${statusText}</span>
      <button type="button" id="sg-accept-all">Keep all</button>
      <button type="button" id="sg-dismiss">Dismiss</button>
    `;
    bar.querySelector('#sg-accept-all').addEventListener('click', acceptAllGuides);
    bar.querySelector('#sg-dismiss').addEventListener('click', dismiss);
  }

  function onGhostAcceptGuide(e) {
    const idx = e.detail && e.detail.index;
    keepGuideGhost(idx);
  }

  let guideWorker = null;

  function terminateGuideWorker() {
    if (guideWorker) { guideWorker.terminate(); guideWorker = null; }
  }

  async function runStairs() {
    let pixelData;
    try {
      pixelData = await getPhotoPixels();
    } catch (err) {
      app.toast(err && err.message ? err.message : 'Could not read the photo.');
      return;
    }
    if (!pixelData) {
      app.toast('No photo to trace yet.');
      return;
    }
    terminateGuideWorker();
    guideWorker = new Worker(new URL('../../workers/trace.worker.js', import.meta.url), { type: 'module' });
    guideMode = 'stairs';
    bar = makeBar();
    ghosts = [];
    renderGuideBar();
    app.setHint('Finding doors and stairs on the photo…');

    guideWorker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.kind === 'stairs') {
        const stairs = (msg.stairs || []).map((r) => ({ ...r, kind: 'stair' }));
        const doors = (msg.doors || []).map((r) => ({ ...r, kind: 'door' }));
        ghosts = doors.concat(stairs).map((g, i) => ({ ...g, index: i }));
        pushGhostsToCanvas();
        renderGuideBar();
        app.setHint(ghosts.length ? 'Review the suggested doors/stairs, then accept or dismiss.' : 'No doors or stairs detected.');
      } else if (msg.kind === 'error' || msg.error) {
        app.toast(`Find doors and stairs failed: ${msg.message || msg.error || 'unknown error'}`);
      }
    });

    const outline = app.doc && app.doc.floor && app.doc.floor.points ? app.doc.floor.points : null;
    guideWorker.postMessage({
      id: 'stairs', kind: 'stairs', width: pixelData.width, height: pixelData.height, data: pixelData.data, outline,
    });
  }

  async function runHalls() {
    let pixelData;
    try {
      pixelData = await getPhotoPixels();
    } catch (err) {
      app.toast(err && err.message ? err.message : 'Could not read the photo.');
      return;
    }
    if (!pixelData) {
      app.toast('No photo to trace yet.');
      return;
    }
    terminateGuideWorker();
    guideWorker = new Worker(new URL('../../workers/trace.worker.js', import.meta.url), { type: 'module' });
    guideMode = 'halls';
    bar = makeBar();
    ghosts = [];
    renderGuideBar();
    app.setHint('Finding hallways on the photo…');

    guideWorker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.kind === 'halls') {
        const halls = (msg.halls || []).map((r) => ({ ...r, kind: 'hall' }));
        ghosts = halls.map((g, i) => ({ ...g, index: i }));
        pushGhostsToCanvas();
        renderGuideBar();
        app.setHint(ghosts.length ? 'Review the suggested hallways, then accept or dismiss.' : 'No hallways detected.');
      } else if (msg.kind === 'error' || msg.error) {
        app.toast(`Find hallways failed: ${msg.message || msg.error || 'unknown error'}`);
      }
    });

    const outline = app.doc && app.doc.floor && app.doc.floor.points ? app.doc.floor.points : null;
    guideWorker.postMessage({
      id: 'halls', kind: 'halls', width: pixelData.width, height: pixelData.height, data: pixelData.data, outline,
    });
  }

  window.addEventListener('ghost-accept', (e) => {
    if (guideMode && ghosts.length && ghosts[0].kind) onGhostAcceptGuide(e);
  });
  window.addEventListener('ghost-accept', onGhostAccept);

  return {
    run,
    runStairs,
    runHalls,
    destroy() {
      terminateGuideWorker();
      window.removeEventListener('ghost-accept', onGhostAccept);
      terminateWorker();
      dismiss();
    },
  };
}
