// photoStep.js
// Photo straighten step: drop zone / file input, draggable corner handles
// (Pointer Events), homography warp on a canvas via Gaussian elimination.
// Depends on: nothing (pure DOM + canvas).

const MAX_ORIGINAL = 2400;
const MAX_OUTPUT = 2400;

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

// Solve an 8x8 linear system (Gaussian elimination with partial pivoting).
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

// Homography mapping dst quad -> src quad, i.e. for each output (x,y) gives
// the source pixel to sample (inverse mapping for warp).
function computeHomography(srcPts, dstPts) {
  // Solve for H mapping dst -> src: [x',y',1]^T ~ H [x,y,1]^T
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
  return {
    x: (h[0] * x + h[1] * y + h[2]) / w,
    y: (h[3] * x + h[4] * y + h[5]) / w,
  };
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

export function mountPhotoStep(containerEl, { onDone, onSkip, initial } = {}) {
  containerEl.innerHTML = `
    <div class="ps-wrap">
      <div class="ps-drop" id="ps-drop">
        <p>Drag a photo here, or</p>
        <label class="btn btn-secondary" for="ps-file">Choose a photo</label>
        <input type="file" id="ps-file" accept="image/*" hidden>
        <p id="ps-error" style="color:#b3261e; display:none"></p>
        <p style="margin-top:16px"><button type="button" id="ps-skip-initial">Skip for now</button></p>
      </div>
      <div class="ps-editor" id="ps-editor" hidden>
        <div class="ps-canvas-wrap">
          <canvas id="ps-canvas"></canvas>
          <svg id="ps-overlay"></svg>
        </div>
        <p class="ps-tip">Best results: shoot straight on, fill the frame, no glare.</p>
        <div class="ps-actions">
          <button type="button" id="ps-straighten" class="btn-primary">Flatten</button>
          <button type="button" id="ps-skip">Skip for now</button>
        </div>
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
    .ps-tip { margin:8px 0 0; font-size:12px; color:#6b7078; }
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
    const maxH = Math.max(200, window.innerHeight - top - actionsH - 16);
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

    dropEl.hidden = true;
    editorEl.hidden = false;
    drawOverlay();
    fitToViewport();
  }

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
    fileToDataUrl(file).then(loadFromDataUrl).catch(showError);
  }
  fileInput.addEventListener('change', onFileChange);
  dropEl.addEventListener('dragover', onDragOver);
  dropEl.addEventListener('drop', onDrop);

  if (initial && initial.originalDataUrl) {
    loadFromDataUrl(initial.originalDataUrl).catch(showError);
  }

  straightenBtn.addEventListener('click', () => {
    if (!corners || !displayImg) return;
    const result = straighten(displayImg, corners, originalDataUrl);
    if (onDone) onDone(result);
  });

  skipBtn.addEventListener('click', () => {
    if (onSkip) onSkip();
  });
  if (skipInitialBtn) {
    skipInitialBtn.addEventListener('click', () => {
      if (onSkip) onSkip();
    });
  }

  function straighten(srcCanvas, quad, origDataUrl) {
    // side lengths
    const [tl, tr, br, bl] = quad;
    const topLen = dist(tl, tr);
    const bottomLen = dist(bl, br);
    const leftLen = dist(tl, bl);
    const rightLen = dist(tr, br);
    let outW = Math.round((topLen + bottomLen) / 2);
    let outH = Math.round((leftLen + rightLen) / 2);
    outW = Math.max(10, outW);
    outH = Math.max(10, outH);
    const longest = Math.max(outW, outH);
    if (longest > MAX_OUTPUT) {
      const scale = MAX_OUTPUT / longest;
      outW = Math.round(outW * scale);
      outH = Math.round(outH * scale);
    }

    const dst = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
    // H maps dst -> src (so for each output pixel we look up source pixel)
    const H = computeHomography(quad, dst);

    const srcCtx = srcCanvas.getContext ? srcCanvas.getContext('2d') : ctx;
    const srcImageData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const sw = srcCanvas.width, sh = srcCanvas.height;
    const sdata = srcImageData.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    const outImageData = outCtx.createImageData(outW, outH);
    const odata = outImageData.data;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const p = applyH(H, x, y);
        const sx = Math.round(p.x);
        const sy = Math.round(p.y);
        const oi = (y * outW + x) * 4;
        if (sx >= 0 && sx < sw && sy >= 0 && sy < sh) {
          const si = (sy * sw + sx) * 4;
          odata[oi] = sdata[si];
          odata[oi + 1] = sdata[si + 1];
          odata[oi + 2] = sdata[si + 2];
          odata[oi + 3] = 255;
        } else {
          odata[oi] = 255; odata[oi + 1] = 255; odata[oi + 2] = 255; odata[oi + 3] = 255;
        }
      }
    }
    outCtx.putImageData(outImageData, 0, 0);
    const dataUrl = outCanvas.toDataURL('image/jpeg', 0.85);

    return {
      dataUrl,
      width: outW,
      height: outH,
      corners: quad.map((p) => [...p]),
      originalDataUrl: origDataUrl,
    };
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
      containerEl.innerHTML = '';
    },
  };
}
