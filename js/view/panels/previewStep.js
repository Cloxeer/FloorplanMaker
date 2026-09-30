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
  svgText, validation, page: initialPage = 'fit', print: initialPrint = {}, frameFor,
}, { onBack, onExport, onPageChange, onLayoutChange }) {
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
  function sizeSheet() {
    if (!svgEl) return;
    const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return;
    const pad = 24;
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

  return { close };
}
