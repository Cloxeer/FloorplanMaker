// photoStep.js
// Photo straighten step: drop zone / file input, draggable corner handles
// (Pointer Events), homography warp on a canvas via Gaussian elimination.
// Depends on: js/view/panels/autobuild.js (the AutoBuild button).

import { autoStraighten } from './autobuild.js';
import { warpToCanvas } from './photoWarp.js';
import { mountFlattenStage } from './flattenStage.js';
import { layoutExtras } from '../../model/photos.js';

const MAX_ORIGINAL = 2400;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downscale(img, maxSide) {
  const long = Math.max(img.width, img.height);
  let w = img.width, h = img.height;
  if (long > maxSide) {
    const scale = maxSide / long;
    w = Math.round(img.width * scale);
    h = Math.round(img.height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

export function mountPhotoStep(containerEl, { onDone, onSkip, onBackToProjects, initial } = {}) {
  containerEl.innerHTML = `
    <div class="ps-wrap">
      <div class="ps-drop" id="ps-drop">
        <p class="ps-navrow"><button type="button" class="ps-back" id="ps-back-projects">&larr; Back to projects</button></p>
        <p>Drag a photo here, or</p>
        <label class="btn btn-secondary" for="ps-file">Choose a photo</label>
        <input type="file" id="ps-file" accept="image/*" hidden>
        <p id="ps-error" style="color:#b3261e; display:none"></p>
        <p style="margin-top:16px"><button type="button" id="ps-skip-initial">Skip for now</button> <button type="button" id="ps-multi-initial" title="One photo per floor is best. Use this only if the plan needs several photos.">Add multiple photos</button></p>
        <input type="file" id="ps-multi-file" accept="image/*" multiple hidden>
        <p class="ps-tip">The better the photo, the better AutoBuild works: shoot straight on, fill the frame, no glare or flash.</p>
      </div>
      <div class="ps-editor" id="ps-editor" hidden>
        <p class="ps-navrow"><button type="button" class="ps-back" id="ps-back-corners">&larr; Choose a different photo</button></p>
        <div class="ps-canvas-wrap">
          <canvas id="ps-canvas"></canvas>
          <svg id="ps-overlay"></svg>
        </div>
        <p class="ps-tip">Best results: shoot straight on, fill the frame, no glare.</p>
        <div class="ps-actions">
          <button type="button" id="ps-straighten" class="btn-primary">Flatten</button>
          <button type="button" id="ps-skip">Skip for now</button>
          <button type="button" id="ps-multi" title="Add more photos of this floor and line them up before tracing">Add multiple photos</button>
        </div>
      </div>
      <div class="ps-flat" id="ps-flat" hidden>
        <p class="ps-navrow"><button type="button" class="ps-back" id="ps-back-flat">&larr; Back</button></p>
        <div id="ps-flat-body"></div>
      </div>
    </div>
  `;

  // minimal inline styles so this works even before studio.css catches up
  const style = document.createElement('style');
  style.textContent = `
    .ps-wrap { display:flex; flex-direction:column; gap:12px; align-items:center; }
    .ps-drop { border:2px dashed #c7cbd1; border-radius:10px; padding:40px; text-align:center; width:100%; max-width:600px; }
    .ps-canvas-wrap { position:relative; max-width:100%; touch-action:none; display:inline-block; }
    .ps-canvas-wrap canvas { display:block; max-width:100%; height:auto; }
    /* Cap the image's on-screen height to whatever room is left below the
       header/actions so tall photos never push the corner handles off the
       bottom of the viewport; width scales to match (aspect preserved via
       the canvas's own intrinsic width/height attributes). */
    .ps-canvas-wrap.ps-fit canvas { max-height: var(--ps-max-h, 60vh); width: auto; }
    .ps-canvas-wrap svg { position:absolute; top:0; left:0; width:100%; height:100%; }
    .ps-handle { fill:#2f6feb; stroke:#fff; stroke-width:2; cursor:grab; }
    .ps-actions { display:flex; gap:10px; margin-top:10px; }
    .ps-tip { margin:8px 0 0; font-size:12px; color:#6b7078; text-align:center; }
    .ps-flat { width:100%; }
    .ps-navrow { margin:0 0 6px; text-align:left; }
    .ps-back { border:0; background:none; padding:4px 0; color:var(--accent,#2f6feb); cursor:pointer; font-size:14px; }
    .ps-back:hover { text-decoration:underline; }
    .ps-actions .btn-primary { font-size:16px; padding:11px 30px; }
  `;
  containerEl.appendChild(style);

  const dropEl = containerEl.querySelector('#ps-drop');
  const editorEl = containerEl.querySelector('#ps-editor');
  const fileInput = containerEl.querySelector('#ps-file');
  const canvasWrap = containerEl.querySelector('.ps-canvas-wrap');
  const canvas = containerEl.querySelector('#ps-canvas');
  const overlay = containerEl.querySelector('#ps-overlay');
  const straightenBtn = containerEl.querySelector('#ps-straighten');
  const skipBtn = containerEl.querySelector('#ps-skip');
  const skipInitialBtn = containerEl.querySelector('#ps-skip-initial');
  const errorEl = containerEl.querySelector('#ps-error');
  const flatEl = containerEl.querySelector('#ps-flat');
  const flatBody = containerEl.querySelector('#ps-flat-body');
  const headerEl = document.querySelector('.photo-step-header');
  const HEADERS = {
    drop: ['Add your floor plan photo', 'Drop in a photo of the plan. You will straighten it next.'],
    corners: ['Flatten the photo', 'Took the photo at an angle? Drag the four corners onto the corners of the map and press Flatten, so rooms line up.'],
    flat: ['Flattened', 'Check the walls look straight, then choose how to continue.'],
  };
  let mode = 'drop';
  let flat = null; // { key, base: canvas, vals } kept across Back
  let stage = null;
  function show(next) {
    mode = next;
    dropEl.hidden = next !== 'drop';
    editorEl.hidden = next !== 'corners';
    flatEl.hidden = next !== 'flat';
    if (headerEl) {
      headerEl.querySelector('h2').textContent = HEADERS[next][0];
      headerEl.querySelector('p').textContent = HEADERS[next][1];
    }
    if (next === 'corners') fitToViewport();
  }
  const ctx = canvas.getContext('2d');

  // Fit the photo (and its handle overlay, which scales with it) into
  // whatever vertical room is left below the header/actions, so the bottom
  // corner handles of a tall photo stay on screen. The canvas's own
  // width/height attributes (and therefore `corners`/straighten math) stay
  // in original downscaled-image pixel space regardless of display size.
  function fitToViewport() {
    if (!canvasWrap || editorEl.hidden) return;
    const top = canvasWrap.getBoundingClientRect().top;
    const actionsEl = containerEl.querySelector('.ps-actions');
    const actionsH = actionsEl ? actionsEl.getBoundingClientRect().height + 20 : 60;
    const maxH = Math.max(200, window.innerHeight - top - actionsH - 56);
    canvasWrap.style.setProperty('--ps-max-h', `${maxH}px`);
    canvasWrap.classList.add('ps-fit');
  }
  window.addEventListener('resize', fitToViewport);

  function showError(err) {
    if (!errorEl) return;
    errorEl.textContent = (err && err.message) ? err.message : 'Could not read that photo. Try a different file.';
    errorEl.style.display = '';
  }

  let displayImg = null; // downscaled canvas for display/original storage
  let originalDataUrl = null;
  let corners = null; // [[x,y]x4] in display-canvas pixel space
  let dragIndex = -1;
  let cornersTouched = false; // the user placed the corners themselves

  function defaultCorners(w, h) {
    const ix = w * 0.05, iy = h * 0.05;
    return [
      [ix, iy], [w - ix, iy], [w - ix, h - iy], [ix, h - iy],
    ];
  }

  function drawOverlay() {
    overlay.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    overlay.innerHTML = '';
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', corners.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'rgba(47,111,235,0.1)');
    poly.setAttribute('stroke', '#2f6feb');
    poly.setAttribute('stroke-width', '2');
    overlay.appendChild(poly);
    corners.forEach((p, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', p[0]);
      c.setAttribute('cy', p[1]);
      c.setAttribute('r', 12);
      c.setAttribute('class', 'ps-handle');
      c.dataset.index = String(i);
      overlay.appendChild(c);
    });
  }

  function overlayPointFromEvent(e) {
    const rect = overlay.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [
      clamp((e.clientX - rect.left) * scaleX, 0, canvas.width),
      clamp((e.clientY - rect.top) * scaleY, 0, canvas.height),
    ];
  }

  function onPointerDown(e) {
    const target = e.target;
    if (target && target.dataset && target.dataset.index !== undefined) {
      dragIndex = parseInt(target.dataset.index, 10);
      cornersTouched = true;
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }
  function onPointerMove(e) {
    if (dragIndex < 0) return;
    corners[dragIndex] = overlayPointFromEvent(e);
    drawOverlay();
  }
  function onPointerUp() {
    dragIndex = -1;
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);

  async function loadFromDataUrl(dataUrl) {
    const img = await loadImage(dataUrl);
    const { canvas: dsCanvas, w, h } = downscale(img, MAX_ORIGINAL);
    originalDataUrl = dsCanvas.toDataURL('image/jpeg', 0.9);
    displayImg = dsCanvas;

    // Fit the *display* canvas element to a reasonable on-screen size too,
    // but keep internal pixel size = downscaled original for accurate warp.
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(dsCanvas, 0, 0);

    corners = (initial && initial.corners) ? initial.corners.map((p) => [...p]) : defaultCorners(w, h);

    flat = null;
    show('corners');
    drawOverlay();
  }

  // Several photos for one floor: read them all, keep the straight-on one as the main photo (the current photo
  // when one is already open, else the first), put the others beside it and go straight to arranging them.
  async function readPhoto(file) {
    const img = await loadImage(await fileToDataUrl(file));
    const { canvas: c, w, h } = downscale(img, MAX_ORIGINAL);
    return { dataUrl: c.toDataURL('image/jpeg', 0.9), width: w, height: h };
  }
  async function addMultiple(files, fromEditor) {
    try {
      const picked = await Promise.all([...files].filter((f) => /^image\//.test(f.type || 'image/')).map(readPhoto));
      const main = fromEditor && originalDataUrl ? { dataUrl: originalDataUrl, width: displayImg.width, height: displayImg.height } : picked.shift();
      if (!main) return;
      if (!picked.length && !fromEditor) { fileToDataUrl(files[0]).then(loadFromDataUrl).catch(showError); return; } // one photo: the normal flow
      if (onDone) onDone(main, { multi: true, extraPhotos: layoutExtras(main, picked) });
    } catch (err) { showError(err); }
  }
  const multiFile = containerEl.querySelector('#ps-multi-file');
  const pickMore = (fromEditor) => { multiFile.dataset.from = fromEditor ? 'editor' : 'drop'; multiFile.value = ''; multiFile.click(); };
  containerEl.querySelector('#ps-multi-initial').addEventListener('click', () => pickMore(false));
  containerEl.querySelector('#ps-multi').addEventListener('click', () => pickMore(true));
  multiFile.addEventListener('change', () => { if (multiFile.files.length) addMultiple(multiFile.files, multiFile.dataset.from === 'editor'); });

  function onFileChange() {
    const file = fileInput.files[0];
    if (!file) return;
    fileToDataUrl(file).then(loadFromDataUrl).catch(showError);
  }
  function onDragOver(e) { e.preventDefault(); }
  function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (e.dataTransfer.files.length > 1) { addMultiple(e.dataTransfer.files, false); return; } // several dropped at once
    fileToDataUrl(file).then(loadFromDataUrl).catch(showError);
  }
  fileInput.addEventListener('change', onFileChange);
  dropEl.addEventListener('dragover', onDragOver);
  dropEl.addEventListener('drop', onDrop);

  if (initial && initial.originalDataUrl) {
    loadFromDataUrl(initial.originalDataUrl).catch(showError);
  }

  function unmountStage() { if (stage) { stage.destroy(); stage = null; } }

  function toPixels(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: d.data };
  }

  async function runAutoBuild({ photo, canvas }, adjusted) {
    // the user's own corners or sliders win; otherwise refine from the plan's walls
    let built = null;
    if (!adjusted && !cornersTouched) built = await autoStraighten(canvas, originalDataUrl);
    if (!onDone) return;
    if (built) {
      const corners0 = corners.map((p) => [...p]);
      onDone({ ...built.photo, corners: corners0, originalDataUrl }, { autoBuild: true, pixels: built.pixels });
    } else onDone(photo, { autoBuild: true, pixels: toPixels(canvas) });
  }

  straightenBtn.addEventListener('click', () => {
    if (!corners || !displayImg) return;
    const key = JSON.stringify(corners.map((p) => p.map(Math.round)));
    if (!flat || flat.key !== key) {
      flat = { key, base: warpToCanvas(displayImg, corners), vals: { tilt: 0, turn: 0, roll: 0, grid: false } };
    }
    unmountStage();
    stage = mountFlattenStage(flatBody, {
      base: flat.base, vals: flat.vals, corners, originalDataUrl,
      onBack: backToCorners,
      onStart: (photo) => { if (onDone) onDone(photo); },
      onAutoBuild: runAutoBuild,
    });
    show('flat');
  });

  function backToCorners() { unmountStage(); show('corners'); }
  function backToDrop() {
    unmountStage();
    initial = null; flat = null; displayImg = null; originalDataUrl = null; corners = null; cornersTouched = false;
    fileInput.value = '';
    errorEl.style.display = 'none';
    show('drop');
  }
  function onBackProjects() { if (onBackToProjects) onBackToProjects(); else if (onSkip) onSkip(); }
  containerEl.querySelector('#ps-back-projects').addEventListener('click', onBackProjects);
  containerEl.querySelector('#ps-back-corners').addEventListener('click', backToDrop);
  containerEl.querySelector('#ps-back-flat').addEventListener('click', backToCorners);
  function onKey(e) {
    if (e.key !== 'Escape' || containerEl.offsetParent === null) return;
    if (mode === 'flat') backToCorners(); else if (mode === 'corners') backToDrop(); else onBackProjects();
  }
  document.addEventListener('keydown', onKey);
  show('drop');

  skipBtn.addEventListener('click', () => {
    if (onSkip) onSkip();
  });
  if (skipInitialBtn) {
    skipInitialBtn.addEventListener('click', () => {
      if (onSkip) onSkip();
    });
  }

  return {
    destroy() {
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerUp);
      fileInput.removeEventListener('change', onFileChange);
      dropEl.removeEventListener('dragover', onDragOver);
      dropEl.removeEventListener('drop', onDrop);
      window.removeEventListener('resize', fitToViewport);
      document.removeEventListener('keydown', onKey);
      unmountStage();
      containerEl.innerHTML = '';
    },
  };
}
