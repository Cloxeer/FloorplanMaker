// flattenStage.js
// The "Flattened" screen of the photo step: shows the flattened photo large,
// two sliders (Tilt = up/down, Turn = left/right) plus a small Rotate slider
// that re-project it live, Auto-level, a Grid toggle, and two choices:
// Start tracing or AutoBuild (or, when `nextLabel` is given because this is one of several photos, a single
// "next photo" button). Preview runs on a <=1000 px copy; the full
// resolution image is only produced by exportAdjusted() when a choice is made.
// Depends on: js/model/autobuild/flatten.js (applyAxes, estimateAxes).

import { applyAxes, estimateAxes } from '../../model/autobuild/flatten.js';

const PREVIEW_MAX = 1000;
const MAX_OUTPUT = 2400;
const AXES = [
  { key: 'tilt', label: 'Tilt (up / down)', min: -30, max: 30 },
  { key: 'turn', label: 'Turn (left / right)', min: -30, max: 30 },
  { key: 'roll', label: 'Rotate', min: -10, max: 10 },
];

const STYLE = `
.fs-wrap { display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; }
.fs-imgwrap { position:relative; display:inline-block; max-width:100%; background:#fff; border:1px solid var(--border,#dfe3e8); border-radius:8px; overflow:hidden; line-height:0; }
.fs-imgwrap canvas { display:block; max-width:100%; max-height:calc(100vh - 480px); min-height:200px; width:auto; height:auto; margin:0 auto; }
.fs-grid { position:absolute; inset:0; pointer-events:none; display:none;
  background-image:linear-gradient(to right, rgba(47,111,235,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(47,111,235,.35) 1px, transparent 1px);
  background-size:10% 10%; }
.fs-imgwrap.fs-grid-on .fs-grid { display:block; }
.fs-caption { margin:0; color:var(--muted,#6b7280); font-size:14px; text-align:center; max-width:60ch; }
.fs-controls { width:100%; max-width:640px; display:flex; flex-direction:column; gap:6px; }
.fs-row { display:grid; grid-template-columns:150px 1fr 64px 52px; align-items:center; gap:10px; font-size:13px; }
.fs-row.fs-small { opacity:.9; }
.fs-row output { text-align:right; font-variant-numeric:tabular-nums; color:var(--text,#1d1f23); }
.fs-row input[type=range] { width:100%; }
.fs-link { all:unset; cursor:pointer; color:var(--accent,#2f6feb); font-size:12px; text-align:right; }
.fs-link:hover { text-decoration:underline; }
.fs-tools { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:center; }
.fs-status { font-size:12px; color:var(--muted,#6b7280); min-height:16px; margin:0; }
.fs-choices { display:flex; gap:16px; margin-top:6px; }
.fs-choices button { font-size:17px; padding:13px 34px; min-width:190px; }
`;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function canvasPixels(c) { return c.getContext('2d').getImageData(0, 0, c.width, c.height); }

function downscaled(base) {
  const long = Math.max(base.width, base.height);
  if (long <= PREVIEW_MAX) return base;
  const s = PREVIEW_MAX / long;
  const c = document.createElement('canvas');
  c.width = Math.round(base.width * s); c.height = Math.round(base.height * s);
  c.getContext('2d').drawImage(base, 0, 0, c.width, c.height);
  return c;
}

function toCanvas(out) {
  const c = document.createElement('canvas');
  c.width = out.width; c.height = out.height;
  const data = out.data instanceof Uint8ClampedArray ? out.data : new Uint8ClampedArray(out.data);
  c.getContext('2d').putImageData(new ImageData(data, out.width, out.height), 0, 0);
  return c;
}

// base: flattened full-res canvas. vals: shared {tilt, turn, roll, grid} (mutated, survives Back).
export function mountFlattenStage(el, { base, vals, corners, originalDataUrl, onBack, onStart, onAutoBuild, nextLabel }) {
  if (!document.getElementById('fs-style')) {
    const st = document.createElement('style'); st.id = 'fs-style'; st.textContent = STYLE; document.head.appendChild(st);
  }
  el.innerHTML = `
    <div class="fs-wrap">
      <div class="fs-imgwrap"><canvas id="fs-canvas"></canvas><div class="fs-grid"></div></div>
      <p class="fs-caption">${nextLabel ? 'If walls still lean, nudge the sliders. Then go on.' : 'If walls still lean, nudge the sliders. Then pick how to continue.'}</p>
      <div class="fs-controls">
        ${AXES.map((a) => `<div class="fs-row${a.key === 'roll' ? ' fs-small' : ''}">
          <label for="fs-${a.key}">${a.label}</label>
          <input type="range" id="fs-${a.key}" min="${a.min}" max="${a.max}" step="0.1" value="0">
          <output id="fs-${a.key}-out"></output>
          <button type="button" class="fs-link" id="fs-${a.key}-reset">Reset</button></div>`).join('')}
      </div>
      <div class="fs-tools">
        <button type="button" id="fs-auto">Auto-level</button>
        <button type="button" id="fs-grid" aria-pressed="false">Grid</button>
      </div>
      <p class="fs-status" id="fs-status" role="status"></p>
      ${nextLabel ? `<div class="fs-choices">
        <button type="button" id="ps-next-photo" class="btn-primary">${nextLabel}</button>
      </div>` : `<div class="fs-choices">
        <button type="button" id="ps-start-tracing" class="btn-primary">Start tracing</button>
        <button type="button" id="ps-autobuild" class="btn-primary" title="Build the whole plan for you">AutoBuild</button>
      </div>
      <p class="ps-tip">The better the photo, the better AutoBuild works: shoot straight on, fill the frame, no glare or flash.</p>`}
    </div>`;
  const $ = (s) => el.querySelector(s);
  const canvas = $('#fs-canvas');
  const wrap = $('.fs-imgwrap');
  const status = $('#fs-status');
  const preview = downscaled(base);
  let previewPx = null; // lazily read: only needed once a slider moves
  let raf = 0, destroyed = false;

  const isFlat = () => !vals.tilt && !vals.turn && !vals.roll;

  function readouts() {
    for (const a of AXES) {
      $(`#fs-${a.key}`).value = String(vals[a.key]);
      $(`#fs-${a.key}-out`).textContent = `${(+vals[a.key]).toFixed(1)}°`;
    }
    wrap.classList.toggle('fs-grid-on', !!vals.grid);
    $('#fs-grid').setAttribute('aria-pressed', String(!!vals.grid));
  }

  function draw() {
    raf = 0;
    if (destroyed) return;
    let src = preview;
    if (!isFlat()) {
      if (!previewPx) previewPx = canvasPixels(preview);
      src = toCanvas(applyAxes(previewPx, { tilt: vals.tilt, turn: vals.turn, roll: vals.roll }));
    }
    canvas.width = src.width; canvas.height = src.height;
    canvas.getContext('2d').drawImage(src, 0, 0);
  }
  function schedule() { readouts(); if (!raf) raf = requestAnimationFrame(draw); }

  for (const a of AXES) {
    $(`#fs-${a.key}`).addEventListener('input', (e) => { vals[a.key] = clamp(parseFloat(e.target.value) || 0, a.min, a.max); status.textContent = ''; schedule(); });
    $(`#fs-${a.key}-reset`).addEventListener('click', () => { vals[a.key] = 0; schedule(); });
  }
  $('#fs-grid').addEventListener('click', () => { vals.grid = !vals.grid; readouts(); });
  $('#fs-auto').addEventListener('click', () => {
    if (!previewPx) previewPx = canvasPixels(preview);
    let r = null;
    try { r = estimateAxes(previewPx); } catch { r = null; }
    if (!r) { status.textContent = 'Could not tell how to level this one. Adjust by hand.'; return; }
    for (const a of AXES) vals[a.key] = clamp(Math.round((+r[a.key] || 0) * 10) / 10, a.min, a.max);
    status.textContent = r.confidence != null && r.confidence < 0.3 ? 'Not very sure about this one. Check the grid.' : '';
    schedule();
  });

  // Full resolution, only on demand. -> { photo, canvas }
  function exportAdjusted() {
    let out = base;
    if (!isFlat()) out = toCanvas(applyAxes(canvasPixels(base), { tilt: vals.tilt, turn: vals.turn, roll: vals.roll }));
    const long = Math.max(out.width, out.height);
    if (long > MAX_OUTPUT) {
      const s = MAX_OUTPUT / long;
      const c = document.createElement('canvas');
      c.width = Math.round(out.width * s); c.height = Math.round(out.height * s);
      c.getContext('2d').drawImage(out, 0, 0, c.width, c.height);
      out = c;
    }
    return {
      canvas: out,
      photo: { dataUrl: out.toDataURL('image/jpeg', 0.85), width: out.width, height: out.height, corners: corners.map((p) => [...p]), originalDataUrl },
    };
  }

  if (nextLabel) { // one of several photos: just keep this flattened one and move on
    $('#ps-next-photo').addEventListener('click', () => { const x = exportAdjusted(); onStart(x.photo, x.canvas, !isFlat()); });
  } else {
    $('#ps-start-tracing').addEventListener('click', () => { onStart(exportAdjusted().photo); });
    const abBtn = $('#ps-autobuild');
    abBtn.addEventListener('click', async () => {
      abBtn.disabled = true;
      const label = abBtn.textContent;
      abBtn.textContent = 'Preparing…';
      await new Promise((r) => setTimeout(r, 30)); // let the label paint
      try { await onAutoBuild(exportAdjusted(), !isFlat()); }
      finally { abBtn.disabled = false; abBtn.textContent = label; }
    });
  }

  readouts();
  draw();
  return {
    back: () => onBack(),
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); el.innerHTML = ''; },
  };
}
