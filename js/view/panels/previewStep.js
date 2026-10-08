// previewStep.js
// Full-screen "Preview" step shown when the user clicks Export (top bar or
// step 4). Renders the exact exported SVG (already built by docActions.js'
// exportAll, with every traced item in it — including the legend, which is
// placed and sized in Trace like the compass) beside the legend key and the
// checklist. Page size: Fit to SVG (default) or a paper sheet, where the
// drawing can be moved/resized on the page. "Back to editing" closes the
// panel with no side effects; "Export →" goes to the Export step.
// Depends on: js/view/panels/legend.js, js/view/panels/validation.js
// (checklistHtml), js/view/panels/pageLayout.js.

import { legendHtml, LEGEND_NOTE } from './legend.js';
import { checklistHtml } from './validation.js';
import { createLayoutBox } from './pageLayout.js';
import { mountPreviewScope } from './previewScope.js';
import { createZoomSmoother, createDragFilter, zoomFactor } from '../wheelIntent.js';

const PAGE_BUTTONS = [
  ['fit', 'Fit to SVG'],
  ['letter', 'Letter 8.5 × 11 (US printer paper)'],
  ['a4', 'A4 (international)'],
];
const ORIENT_BUTTONS = [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']];

function pageNote(page, frame) {
  if (page === 'fit') {
    return 'The SVG is sized automatically to hold everything — plan, compass and legend — so nothing is cut off. Use this for the map.';
  }
  const paper = page === 'a4' ? 'A4 (210 × 297 mm)' : 'Letter (8.5 × 11 in)';
  return `The white sheet is the whole printed page: ${paper}, ${frame.orientation}. `
    + 'Drag the dashed box to move the drawing, or pull a corner to resize it. The download prints at this size.';
}

export function showPreviewStep({
  svgText, validation, page: initialPage = 'fit', print: initialPrint = {}, frameFor, floorsPromise, floorScope, finalSvgFor,
}, { onBack, onExport, onPageChange, onLayoutChange, onScope }) {
  const host = document.getElementById('dialogs');
  const el = document.createElement('div');
  el.id = 'preview';
  el.className = 'preview-screen';
  el.innerHTML = `
    <header class="preview-header">
      <button type="button" id="preview-back-top">&larr; Back to editing</button>
      <h2>Preview</h2>
      <p>This is exactly what will be exported, hallways included.</p>
      <div class="page-controls">
        <span class="page-controls-label">Page size</span>
        <div class="seg" id="preview-page" role="group" aria-label="Page size">
          ${PAGE_BUTTONS.map(([k, t]) => `<button type="button" data-page="${k}">${t}</button>`).join('')}
        </div>
        <div class="seg" id="preview-orient" role="group" aria-label="Orientation">
          ${ORIENT_BUTTONS.map(([k, t]) => `<button type="button" data-orient="${k}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="page-controls size-controls" id="preview-size">
        <label class="page-controls-label" for="preview-size-range">Size on page</label>
        <button type="button" class="size-step" id="preview-size-down" aria-label="Smaller">−</button>
        <input type="range" id="preview-size-range" min="20" max="100" step="1" value="100">
        <button type="button" class="size-step" id="preview-size-up" aria-label="Bigger">+</button>
        <output id="preview-size-val" for="preview-size-range">100%</output>
        <button type="button" class="btn-link" id="preview-size-reset">Center &amp; fit to page</button>
      </div>
      <p class="page-note" id="preview-page-note"></p>
    </header>
    <div class="preview-body">
      <div class="preview-svg-wrap" id="preview-svg-wrap"></div>
      <aside class="preview-side">
        <div class="section-title">Legend</div>
        ${legendHtml('legend-list')}
        <p class="legend-note">${LEGEND_NOTE}</p>
        <div class="section-title">Checklist</div>
        <ul class="checklist">${checklistHtml(validation || [])}</ul>
      </aside>
    </div>
    <div class="preview-actions">
      <button type="button" id="preview-back">Back to editing</button>
      <button type="button" id="preview-export" class="btn-primary">Export &rarr;</button>
    </div>
  `;
  host.appendChild(el);

  // Inline the exported SVG verbatim so the preview matches the download
  // byte-for-byte (only CSS scales it to fit the panel).
  const wrapEl = el.querySelector('#preview-svg-wrap');
  wrapEl.innerHTML = svgText;
  const svgEl = wrapEl.querySelector('svg');
  if (svgEl) {
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.classList.add('preview-sheet');
  }

  // The <svg> is shown as a white sheet whose edges ARE the file's edges (its
  // viewBox), sized to the largest box of that shape that fits the panel.
  const zoom = { z: 1, tx: 0, ty: 0 };
  function sizeSheet() {
    if (!svgEl) return;
    if (zoom.z !== 1 && page !== 'fit') resetZoom(); // zoom is for the Fit to SVG view
    const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return;
    const pad = 12;
    const availW = Math.max(40, wrapEl.clientWidth - pad * 2);
    const availH = Math.max(40, wrapEl.clientHeight - pad * 2);
    const ratio = vb[2] / vb[3];
    let w = availW;
    let h = w / ratio;
    if (h > availH) { h = availH; w = h * ratio; }
    svgEl.style.width = `${Math.floor(w)}px`;
    svgEl.style.height = `${Math.floor(h)}px`;
  }
  if (svgEl) new MutationObserver(sizeSheet).observe(svgEl, { attributes: true, attributeFilter: ['viewBox'] });

  // --- Click to zoom (Fit to SVG view) ---------------------------------------
  // Click the plan to zoom in on that spot (click again to fit), mouse wheel zooms at the
  // pointer, drag pans while zoomed, and +/-/Fit buttons sit in the corner.
  const ZMAX = 8;
  function applyZoom() {
    if (!svgEl) return;
    const wr = wrapEl.getBoundingClientRect();
    // (SVG elements have no offsetWidth/Left: the sheet's size is the style we set, and it is centred)
    const bw = parseFloat(svgEl.style.width) || svgEl.getBoundingClientRect().width / zoom.z;
    const bh = parseFloat(svgEl.style.height) || svgEl.getBoundingClientRect().height / zoom.z;
    const w = bw * zoom.z, h = bh * zoom.z;
    const base = { x: (wr.width - bw) / 2, y: (wr.height - bh) / 2 };
    // keep at least 80 px of the sheet inside the panel
    const minTx = 80 - w - base.x, maxTx = wr.width - 80 - base.x;
    const minTy = 80 - h - base.y, maxTy = wr.height - 80 - base.y;
    zoom.tx = Math.min(maxTx, Math.max(minTx, zoom.tx));
    zoom.ty = Math.min(maxTy, Math.max(minTy, zoom.ty));
    svgEl.style.transformOrigin = '0 0';
    svgEl.style.transform = zoom.z === 1 ? '' : `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.z})`;
    wrapEl.classList.toggle('is-zoomed', zoom.z !== 1);
    if (zoomOut) zoomOut.textContent = `${Math.round(zoom.z * 100)}%`;
  }
  function resetZoom() { zoom.z = 1; zoom.tx = 0; zoom.ty = 0; applyZoom(); }
  function zoomAt(clientX, clientY, z2) {
    z2 = Math.min(ZMAX, Math.max(1, z2));
    if (z2 === zoom.z) return;
    if (z2 === 1) { resetZoom(); return; }
    if (zoom.z === 1) { zoom.tx = 0; zoom.ty = 0; }
    const r = svgEl.getBoundingClientRect();
    const lx = (clientX - r.left) / zoom.z, ly = (clientY - r.top) / zoom.z; // point on the unzoomed sheet
    zoom.tx += (zoom.z - z2) * lx;
    zoom.ty += (zoom.z - z2) * ly;
    zoom.z = z2;
    applyZoom();
  }
  let zoomOut = null;
  const dragFilter = createDragFilter();
  const zs = createZoomSmoother({ min: 1, max: ZMAX, get: () => zoom.z, set: (z, x, y) => zoomAt(x, y, z) });
  if (svgEl) {
    const st = document.createElement('style');
    st.textContent = `
      #preview-svg-wrap.zoomable svg.preview-sheet { cursor: zoom-in; }
      #preview-svg-wrap.zoomable.is-zoomed svg.preview-sheet { cursor: grab; }
      #preview-svg-wrap.zoomable.panning svg.preview-sheet { cursor: grabbing; }
      #preview-svg-wrap.is-paper svg.preview-sheet { cursor: default; }
      .pv-zoom { position:absolute; right:10px; top:10px; z-index:5; display:flex; align-items:center; gap:4px; background:#fff; border:1px solid #d5d9df; border-radius:8px; padding:3px; box-shadow:0 2px 8px rgba(20,30,50,.12); font:12px system-ui,sans-serif; }
      .pv-zoom button { font:inherit; min-width:28px; height:26px; border:1px solid #d5d9df; border-radius:6px; background:#fff; cursor:pointer; }
      .pv-zoom button:hover { background:#eef3fe; }
      .pv-zoom output { min-width:40px; text-align:center; color:#6b7078; }
      .pv-hint { position:absolute; left:12px; bottom:10px; z-index:5; font:12px system-ui,sans-serif; color:#6b7078; background:rgba(255,255,255,.85); padding:3px 8px; border-radius:6px; pointer-events:none; }
    `;
    el.appendChild(st);
    wrapEl.classList.add('zoomable');
    const bar = document.createElement('div');
    bar.className = 'pv-zoom';
    bar.innerHTML = '<button type="button" data-z="out" aria-label="Zoom out">&minus;</button><output>100%</output><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="fit">Fit</button>';
    wrapEl.appendChild(bar);
    zoomOut = bar.querySelector('output');
    const hint = document.createElement('div');
    hint.className = 'pv-hint';
    hint.textContent = 'Click to zoom in · two-finger drag or drag to move · pinch or +/− to zoom · Fit to reset';
    wrapEl.appendChild(hint);
    const center = () => { const r = wrapEl.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || page !== 'fit') return;
      const [cx, cy] = center();
      if (b.dataset.z === 'in') zoomAt(cx, cy, zoom.z * 1.6);
      else if (b.dataset.z === 'out') zoomAt(cx, cy, zoom.z / 1.6);
      else resetZoom();
    });
    // Two-finger scroll on a trackpad (or the wheel) moves the plan once it is zoomed; pinch
    // (ctrl/cmd + wheel) zooms at the pointer. At fit, the wheel leaves the page alone.
    wrapEl.addEventListener('wheel', (e) => {
      if (page !== 'fit') return;
      if (e.ctrlKey || e.metaKey) { // pinch / ctrl + scroll: eased, so a burst (or the tail of a gesture) glides
        e.preventDefault();
        zs.push(zoomFactor(e, 'pinch'), e.clientX, e.clientY);
        return;
      }
      if (zoom.z === 1) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : 1;
      const [fx, fy] = dragFilter(e.deltaX * k, e.deltaY * k, e.timeStamp);
      zoom.tx -= fx;
      zoom.ty -= fy;
      applyZoom();
    }, { passive: false });

    // Pointers: one finger / the mouse drags (when zoomed); two fingers pan and pinch together.
    // A plain click zooms in once from fit; it never zooms back out (use Fit or the buttons).
    svgEl.style.touchAction = 'none';
    const pts = new Map();
    let down = null, pinch = null;
    const mid = () => { const v = [...pts.values()]; return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1 }; };
    svgEl.addEventListener('pointerdown', (e) => {
      if (page !== 'fit' || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1)) return;
      if (e.button === 1) e.preventDefault(); // the scroll wheel pressed in grabs and drags the plan
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, mid: e.button === 1 });
      try { svgEl.setPointerCapture(e.pointerId); } catch { /* synthetic / already released pointer */ }
      if (pts.size === 2) { pinch = mid(); if (down) down.moved = true; return; }
      if (pts.size === 1) down = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty, moved: e.button === 1 }; // a wheel press never counts as a click
    });
    svgEl.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && pinch) {
        const m = mid();
        zoomAt(m.x, m.y, zoom.z * (m.d / pinch.d));
        if (zoom.z > 1) { zoom.tx += m.x - pinch.x; zoom.ty += m.y - pinch.y; }
        pinch = m;
        applyZoom();
        return;
      }
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 5) return;
      down.moved = true;
      if (zoom.z === 1) return; // nothing to move at fit
      wrapEl.classList.add('panning');
      zoom.tx = down.tx + dx; zoom.ty = down.ty + dy;
      applyZoom();
    });
    const lift = (e, cancelled) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 1 && down) { const v = [...pts.values()][0]; down = { x: v.x, y: v.y, tx: zoom.tx, ty: zoom.ty, moved: true }; return; }
      if (pts.size > 0) return;
      wrapEl.classList.remove('panning');
      const click = down && !down.moved && !cancelled;
      down = null;
      if (click && page === 'fit' && zoom.z === 1) zoomAt(e.clientX, e.clientY, 2.5);
    };
    svgEl.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no auto-scroll circle
    svgEl.addEventListener('pointerup', (e) => lift(e, false));
    svgEl.addEventListener('pointercancel', (e) => lift(e, true));
    svgEl.addEventListener('dblclick', (e) => { if (page === 'fit' && zoom.z > 1) zoomAt(e.clientX, e.clientY, zoom.z * 1.6); });
  }
  // On a window resize the sheet changes size, so the box's handles (sized in
  // screen pixels) are redrawn too.
  const resizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => applyPage()) : null;
  if (resizeObs) resizeObs.observe(wrapEl);

  // --- Page size: Fit to SVG (default) or a paper sheet --------------------
  // Fit to SVG is automatic. On paper, each size keeps its own layout
  // { orientation, scale, fx, fy }: "Auto" centers the drawing and picks the
  // orientation; moving or resizing it switches Auto to the orientation in use.
  let page = initialPage;
  const print = {
    letter: { orientation: 'auto', ...(initialPrint.letter || {}) },
    a4: { orientation: 'auto', ...(initialPrint.a4 || {}) },
  };
  const pageSeg = el.querySelector('#preview-page');
  const orientSeg = el.querySelector('#preview-orient');
  const pageNoteEl = el.querySelector('#preview-page-note');
  const sizeRow = el.querySelector('#preview-size');
  const sizeRange = el.querySelector('#preview-size-range');
  const sizeVal = el.querySelector('#preview-size-val');
  const isPaper = () => page !== 'fit';
  function currentFrame() {
    return frameFor ? frameFor(page, isPaper() ? print[page] : null) : null;
  }
  let layoutBox = null;
  // Show exactly the frame the download will use.
  function applyPage() {
    const frame = currentFrame();
    const layout = isPaper() ? print[page] : null;
    for (const b of pageSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.page === page));
    for (const b of orientSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(!!layout && b.dataset.orient === layout.orientation));
    orientSeg.hidden = !isPaper();
    sizeRow.hidden = !isPaper();
    wrapEl.classList.toggle('is-paper', isPaper());
    if (frame) pageNoteEl.textContent = pageNote(page, frame);
    if (frame && isPaper()) {
      sizeRange.max = String(Math.floor(frame.maxScale * 100));
      sizeRange.value = String(Math.round(frame.scale * 100));
      sizeVal.textContent = `${Math.round(frame.scale * 100)}%`;
    }
    if (svgEl && frame) svgEl.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
    sizeSheet();
    if (layoutBox) {
      if (isPaper() && frame) layoutBox.render(frame);
      else layoutBox.hide();
    }
  }
  // The user moved or resized the drawing: keep the clamped result, and leave
  // "Auto" for the orientation actually showing so it doesn't flip under them.
  function setLayout(next) {
    const cur = print[page];
    const orientation = cur.orientation === 'auto' ? currentFrame().orientation : cur.orientation;
    print[page] = { ...cur, ...next, orientation };
    const f = currentFrame();
    print[page] = { orientation, scale: f.scale, fx: f.fx, fy: f.fy };
    applyPage();
  }
  function commitLayout() {
    if (onLayoutChange && isPaper()) onLayoutChange(page, { ...print[page] });
  }
  pageSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (!b) return;
    page = b.dataset.page;
    if (onPageChange) onPageChange(page);
    applyPage();
  });
  orientSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-orient]');
    if (!b || !isPaper()) return;
    const o = b.dataset.orient;
    // Auto starts over: centered and fitted to the page in the best orientation.
    print[page] = o === 'auto' ? { orientation: 'auto' } : { ...print[page], orientation: o };
    applyPage();
    commitLayout();
  });
  sizeRange.addEventListener('input', () => setLayout({ scale: Number(sizeRange.value) / 100 }));
  sizeRange.addEventListener('change', commitLayout);
  const stepSize = (d) => {
    const f = currentFrame();
    setLayout({ scale: Math.round(f.scale * 100 + d) / 100 });
    commitLayout();
  };
  el.querySelector('#preview-size-down').addEventListener('click', () => stepSize(-5));
  el.querySelector('#preview-size-up').addEventListener('click', () => stepSize(5));
  el.querySelector('#preview-size-reset').addEventListener('click', () => {
    print[page] = { orientation: print[page].orientation };
    applyPage();
    commitLayout();
  });
  if (svgEl) {
    layoutBox = createLayoutBox(svgEl, { onChange: setLayout, onEnd: commitLayout });
  }
  applyPage();

  function close() {
    zs.cancel();
    document.removeEventListener('keydown', onKeyDown);
    if (resizeObs) resizeObs.disconnect();
    el.remove();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { close(); if (onBack) onBack(); }
  }
  document.addEventListener('keydown', onKeyDown);

  el.querySelector('#preview-back').addEventListener('click', () => { close(); if (onBack) onBack(); });
  el.querySelector('#preview-back-top').addEventListener('click', () => { close(); if (onBack) onBack(); });
  el.querySelector('#preview-export').addEventListener('click', () => { if (onExport) onExport(); });

  mountPreviewScope(el, { floorsPromise, scope: floorScope, finalSvgFor, getPage: () => page, onScope });
  return { close };
}
