// suggest.js
// "Suggest rooms" flow: rasterize the project photo, post to trace.worker for
// region detection, show ghosts on the canvas, run OCR on each region, then
// let the user accept/dismiss via a small floating bar.
// Depends on: js/model/document.js (addItem, makeRoom), js/model/geometry.js
// (polygonsOverlap, rectToPoints, polygonArea), app.canvas, app.doc.

import { addItem, makeRoom, roomPolygon } from '../../model/document.js';
import { rectToPoints, polygonsOverlap, polygonArea } from '../../model/geometry.js';

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

  function makeBar() {
    const host = document.getElementById('dialogs');
    const div = document.createElement('div');
    div.className = 'suggest-bar';
    host.appendChild(div);
    return div;
  }

  function renderBar() {
    if (!bar) return;
    bar.innerHTML = `
      <span>${ghosts.length} suggested room${ghosts.length === 1 ? '' : 's'}</span>
      <button type="button" id="sg-accept-all">Accept all</button>
      <button type="button" id="sg-dismiss">Dismiss</button>
    `;
    bar.querySelector('#sg-accept-all').addEventListener('click', acceptAll);
    bar.querySelector('#sg-dismiss').addEventListener('click', dismiss);
  }

  function pushGhostsToCanvas() {
    app.canvas.setGhosts(ghosts.map((g, i) => ({ ...g, index: i })));
  }

  function onGhostAccept(e) {
    const idx = e.detail && e.detail.index;
    acceptOne(idx);
  }

  function acceptOne(index) {
    const g = ghosts[index];
    if (!g) return;
    const item = makeRoom('room', g.x, g.y, g.w, g.h, g.number || '');
    app.commit(addItem(app.doc, item), 'Accept suggestion');
    ghosts = ghosts.filter((_, i) => i !== index).map((gg, i) => ({ ...gg, index: i }));
    pushGhostsToCanvas();
    renderBar();
    if (ghosts.length === 0) dismiss();
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
    renderBar();
    app.setHint('Tracing rooms from the photo…');

    worker.addEventListener('message', (e) => {
      const msg = e.data || {};
      if (msg.kind === 'trace-progress') {
        app.setHint(`Tracing rooms from the photo… ${msg.progress != null ? Math.round(msg.progress * 100) + '%' : ''}`);
      } else if (msg.kind === 'trace-result') {
        const regions = (msg.regions || []).filter((r) => !overlapsExisting(r, app.doc));
        ghosts = regions.map((r, i) => ({ x: r.x, y: r.y, w: r.w, h: r.h, number: '', index: i }));
        pushGhostsToCanvas();
        renderBar();
        app.setHint(`${ghosts.length} suggested rooms. Running text recognition…`);
        worker.postMessage({ id: 'ocr', kind: 'ocr', width: pixelData.width, height: pixelData.height, data: pixelData.data, regions: ghosts });
      } else if (msg.kind === 'ocr-progress') {
        app.setHint(`Reading room numbers… ${msg.progress != null ? Math.round(msg.progress * 100) + '%' : ''}`);
      } else if (msg.kind === 'ocr-result') {
        const idx = msg.index;
        if (ghosts[idx]) {
          ghosts[idx] = { ...ghosts[idx], number: msg.number || '' };
          pushGhostsToCanvas();
        }
      } else if (msg.kind === 'ocr-done') {
        app.setHint(ghosts.length ? 'Review the suggested rooms, then accept or dismiss.' : 'No rooms detected.');
      } else if (msg.kind === 'error') {
        app.toast(`Suggest rooms failed: ${msg.message || 'unknown error'}`);
      }
    });

    worker.postMessage({
      id: 'trace', kind: 'trace', width: pixelData.width, height: pixelData.height, data: pixelData.data,
    });
  }

  window.addEventListener('ghost-accept', onGhostAccept);

  return {
    run,
    destroy() {
      window.removeEventListener('ghost-accept', onGhostAccept);
      terminateWorker();
      dismiss();
    },
  };
}
