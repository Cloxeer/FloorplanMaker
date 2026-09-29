// previewStep.js
// Full-screen "Preview" step shown when the user clicks Export (top bar or
// step 4). Renders the exact exported SVG (already built by docActions.js'
// exportAll, with every traced item in it) scaled to fit, beside a legend and the
// current checklist state. "Back to editing" closes the panel with no side
// effects; "Download files" runs the existing export dialog (download +
// building-extras.json snippet).
// Depends on: js/view/panels/legend.js, js/view/panels/validation.js (checklistHtml).

import {
  legendHtml, legendSvgGroupAt, legendGroupSize, LEGEND_NOTE,
} from './legend.js';
import { checklistHtml } from './validation.js';
import { createLayoutBox } from './pageLayout.js';
import { pointInPolygon, segmentsIntersect } from '../../model/geometry.js';

// Reads the building outline's own points straight out of the preview SVG
// (the <polygon class="floor"> the export writes), so the red/blue legend
// warning tracks the actual wall shape, not just its bounding box.
function floorPolygonPoints(svgEl) {
  if (!svgEl) return null;
  const poly = svgEl.querySelector('polygon.floor');
  if (!poly) return null;
  const raw = (poly.getAttribute('points') || '').trim();
  if (!raw) return null;
  const pts = raw.split(/\s+/).map((pair) => pair.split(',').map(Number));
  if (pts.some((p) => p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  return pts.length >= 3 ? pts : null;
}

// True only when the legend rectangle actually intersects the outline
// polygon: any rect corner inside the polygon, any polygon vertex inside the
// rect, or any polygon edge crossing any rect edge. A legend sitting in blank
// margin within the bbox but outside the outline reports false.
function rectIntersectsPolygon(rect, poly) {
  if (!poly || poly.length < 3) return false;
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ];
  for (const c of corners) if (pointInPolygon(c, poly)) return true;
  for (const v of poly) {
    if (v[0] >= rect.x && v[0] <= rect.x + rect.w && v[1] >= rect.y && v[1] <= rect.y + rect.h) return true;
  }
  const rectEdges = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (const [r1, r2] of rectEdges) {
      if (segmentsIntersect(a, b, r1, r2)) return true;
    }
  }
  return false;
}

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
  svgText, validation, halls, rooms, initialLegendPos,
  page: initialPage = 'fit', print: initialPrint = {}, frameFor,
}, { onBack, onExport, onSaveLegend, onPageChange, onLayoutChange }) {
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
      <div class="preview-download-group">
        <div class="preview-legend-controls">
          <button type="button" id="preview-place-legend">Place legend</button>
          <button type="button" id="preview-save-legend" hidden>Save legend position</button>
          <button type="button" id="preview-remove-legend" hidden>Remove legend</button>
        </div>
        <button type="button" id="preview-export" class="btn-primary">Export &rarr;</button>
        <p class="preview-download-note">Drag the legend in the preview once placed; it's never over the plan.</p>
      </div>
    </div>
  `;
  host.appendChild(el);

  // Inline the exported SVG verbatim so the preview matches the download
  // byte-for-byte (only CSS scales it to fit the panel).
  el.querySelector('#preview-svg-wrap').innerHTML = svgText;
  const svgEl = el.querySelector('#preview-svg-wrap svg');
  let planBBox = null;
  const floorPoly = floorPolygonPoints(svgEl);
  const wrapEl = el.querySelector('#preview-svg-wrap');
  if (svgEl) {
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.classList.add('preview-sheet');

    // Snapshot of the plan's own footprint (rooms/floor/doors/etc, before
    // the legend is appended) — used to place the legend in blank margin,
    // never over the plan.
    try { planBBox = svgEl.getBBox(); } catch { planBBox = null; }

    // Hallways, staff walls, icons and void hatches are all part of svgText
    // itself, so the preview draws nothing extra over the plan.
    void halls;
    void rooms;
  }

  // The <svg> is shown as a white sheet whose edges ARE the file's edges (its
  // viewBox), sized to the largest box of that shape that fits the panel.
  function sizeSheet() {
    if (!svgEl || !wrapEl) return;
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
  if (resizeObs && wrapEl) resizeObs.observe(wrapEl);

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
    return frameFor ? frameFor(savedLegendPos, page, isPaper() ? print[page] : null) : null;
  }
  let layoutBox = null;
  // Show exactly the frame the download will use (not while placing the
  // legend, which temporarily widens the view so there's room to drag).
  function applyPage() {
    const frame = currentFrame();
    const layout = isPaper() ? print[page] : null;
    for (const b of pageSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.page === page));
    for (const b of orientSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(!!layout && b.dataset.orient === layout.orientation));
    orientSeg.hidden = !isPaper();
    sizeRow.hidden = !isPaper();
    if (wrapEl) wrapEl.classList.toggle('is-paper', isPaper());
    if (frame) pageNoteEl.textContent = pageNote(page, frame);
    if (frame && isPaper()) {
      sizeRange.max = String(Math.floor(frame.maxScale * 100));
      sizeRange.value = String(Math.round(frame.scale * 100));
      sizeVal.textContent = `${Math.round(frame.scale * 100)}%`;
    }
    if (svgEl && frame && !placementMode) svgEl.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
    sizeSheet();
    if (layoutBox) {
      if (isPaper() && !placementMode && frame) layoutBox.render(frame);
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

  // --- Draggable legend placement --------------------------------------
  const placeBtn = el.querySelector('#preview-place-legend');
  const saveBtn = el.querySelector('#preview-save-legend');
  const removeBtn = el.querySelector('#preview-remove-legend');
  const exportBtn = el.querySelector('#preview-export');
  const NS = 'http://www.w3.org/2000/svg';
  const MARGIN = 20;
  let baseVB = null;
  // The plan on its own, fitted (no legend) — what legend placement grows from.
  function ensureBaseVB() {
    if (!baseVB) baseVB = frameFor ? frameFor(null, 'fit', 'auto') : getViewBox();
    return baseVB;
  }
  // Grow the preview's viewBox so a legend placed beside/below the plan is
  // visible (the plan's own viewBox has no blank margin). pos=null restores it.
  let lastGrownVB = null; // the full-fit viewBox for the current legend pos; zoom never exceeds it
  function fitViewBox(pos) {
    const vb = ensureBaseVB();
    if (!vb || !svgEl) return;
    if (!pos) { svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); return; }
    const { w: gw0, h: gh0 } = legendGroupSize();
    const sc = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
    const minX = Math.min(vb.x, pos.x - MARGIN);
    const minY = Math.min(vb.y, pos.y - MARGIN);
    const maxX = Math.max(vb.x + vb.w, pos.x + gw0 * sc + MARGIN);
    const maxY = Math.max(vb.y + vb.h, pos.y + gh0 * sc + MARGIN);
    const grown = {
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
    };
    lastGrownVB = grown;
    svgEl.setAttribute('viewBox', `${Math.round(grown.x)} ${Math.round(grown.y)} ${Math.round(grown.w)} ${Math.round(grown.h)}`);
  }

  // Zoom the preview viewBox toward/away from the legend's center, so the
  // user can position it precisely. Clamped to never exceed the full-fit
  // viewBox (lastGrownVB) and never go narrower than ~200 units.
  const MIN_ZOOM_W = 200;
  function legendCenter() {
    const t = currentTransformState();
    const { w: gw0, h: gh0 } = legendGroupSize();
    return { cx: t.x + (gw0 * t.scale) / 2, cy: t.y + (gh0 * t.scale) / 2 };
  }
  function zoomLegend(factor) {
    if (!svgEl || !legendGroupEl) return;
    const cur = getViewBox();
    if (!cur) return;
    const { cx, cy } = legendCenter();
    const ratio = cur.h / cur.w;
    const cap = lastGrownVB || cur;
    let w = cur.w * factor;
    w = Math.min(cap.w, Math.max(MIN_ZOOM_W, w));
    const h = w * ratio;
    const x = cx - w / 2;
    const y = cy - h / 2;
    svgEl.setAttribute('viewBox', `${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}`);
    syncSelectionUI();
  }

  // Simple pan: when zoomed in (viewBox smaller than the full fit), dragging
  // empty preview space moves the view. Dragging the legend/handles/buttons is
  // left to their own handlers.
  let panState = null;
  function onPanDown(evt) {
    if (!svgEl) return;
    if (legendGroupEl && (legendGroupEl.contains(evt.target)
      || (selHandle && selHandle.contains && selHandle.contains(evt.target))
      || (zoomInBtn && zoomInBtn.contains(evt.target))
      || (zoomOutBtn && zoomOutBtn.contains(evt.target)))) return;
    const vb = getViewBox();
    const cap = lastGrownVB || baseVB || vb;
    if (!vb || !cap || vb.w >= cap.w - 1) return; // only when zoomed in
    panState = { x: evt.clientX, y: evt.clientY, vb };
    svgEl.style.cursor = 'grabbing';
    svgEl.setPointerCapture(evt.pointerId);
    svgEl.addEventListener('pointermove', onPanMove);
    svgEl.addEventListener('pointerup', onPanUp);
  }
  function onPanMove(evt) {
    if (!panState) return;
    const rect = svgEl.getBoundingClientRect();
    const cap = lastGrownVB || baseVB || panState.vb;
    const unit = panState.vb.w / (rect.width || 1);
    let nx = panState.vb.x - (evt.clientX - panState.x) * unit;
    let ny = panState.vb.y - (evt.clientY - panState.y) * unit;
    nx = Math.min(Math.max(nx, cap.x), cap.x + cap.w - panState.vb.w);
    ny = Math.min(Math.max(ny, cap.y), cap.y + cap.h - panState.vb.h);
    svgEl.setAttribute('viewBox', `${Math.round(nx)} ${Math.round(ny)} ${Math.round(panState.vb.w)} ${Math.round(panState.vb.h)}`);
    syncSelectionUI();
  }
  function onPanUp() {
    panState = null;
    if (svgEl) {
      svgEl.style.cursor = '';
      svgEl.removeEventListener('pointermove', onPanMove);
      svgEl.removeEventListener('pointerup', onPanUp);
    }
  }
  if (svgEl) svgEl.addEventListener('pointerdown', onPanDown);

  let savedLegendPos = initialLegendPos || null; // {x,y,scale} in SVG user units, confirmed via Save
  let placementMode = false;
  let legendGroupEl = null;
  let dragOffset = null;
  let selRect = null;
  let selHandle = null;
  let resizeStart = null;
  let zoomInBtn = null;
  let zoomOutBtn = null;

  function getViewBox() {
    const vb = (svgEl && svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !vb.every((n) => Number.isFinite(n))) return null;
    const [x, y, w, h] = vb;
    return {
      x, y, w, h,
    };
  }

  function defaultLegendPos() {
    const vb = ensureBaseVB();
    const { w: gw, h: gh } = legendGroupSize();
    if (!vb) return { x: 0, y: 0, scale: 1 };
    const plan = planBBox || {
      x: vb.x, y: vb.y, width: vb.w, height: vb.h,
    };
    const rightSpace = (vb.x + vb.w) - (plan.x + plan.width);
    if (rightSpace >= gw + MARGIN) {
      return { x: plan.x + plan.width + MARGIN, y: Math.max(vb.y, plan.y), scale: 1 };
    }
    return { x: Math.max(vb.x, plan.x), y: plan.y + plan.height + MARGIN, scale: 1 };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function clampLegendPos(pos) {
    const vb = ensureBaseVB();
    const { w: gw0, h: gh0 } = legendGroupSize();
    const scale = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
    if (!vb) return { ...pos, scale };
    const gw = gw0 * scale;
    const gh = gh0 * scale;
    const { x, y } = pos;
    // Only reposition if the legend actually sits ON the building outline
    // (not merely within the plan's bounding box over white space); otherwise
    // keep it exactly where the user dropped it.
    if (floorPoly && floorPoly.length >= 3
      && rectIntersectsPolygon({ x, y, w: gw, h: gh }, floorPoly) && planBBox) {
      return { x: planBBox.x + planBBox.width + MARGIN, y: Math.max(vb.y, planBBox.y), scale };
    }
    return { x, y, scale };
  }

  function renderLegendAt(pos) {
    if (!svgEl) return;
    const scale = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
    // Parse the legend markup in the SVG namespace. Setting innerHTML on an SVG
    // element parses children as HTML, which never renders — so build a real
    // SVG node tree with DOMParser and import it.
    const parsed = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${legendSvgGroupAt(pos.x, pos.y, scale)}</svg>`,
      'image/svg+xml',
    );
    const newGroup = document.importNode(parsed.documentElement.firstElementChild, true);
    if (legendGroupEl && legendGroupEl.parentNode) legendGroupEl.parentNode.removeChild(legendGroupEl);
    legendGroupEl = newGroup;
    svgEl.appendChild(legendGroupEl);
    legendGroupEl.style.cursor = 'grab';
    legendGroupEl.addEventListener('pointerdown', onLegendPointerDown);
    if (placementMode) fitViewBox(pos);
    else applyPage();
    syncSelectionUI();
  }

  function svgPointFromEvent(evt) {
    const pt = svgEl.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  }

  function currentTransformState() {
    const t = (legendGroupEl && legendGroupEl.getAttribute('transform')) || '';
    const m = t.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)(?:\s*scale\(([-\d.]+)\))?/);
    return m
      ? { x: parseFloat(m[1]), y: parseFloat(m[2]), scale: m[3] ? parseFloat(m[3]) : 1 }
      : { x: 0, y: 0, scale: 1 };
  }
  function setLegendTransform(x, y, scale) {
    legendGroupEl.setAttribute('transform', `translate(${Math.round(x)},${Math.round(y)}) scale(${scale})`);
  }

  // A selection outline + a single bottom-right resize handle, drawn as
  // siblings positioned in SVG space (not inside the scaled legend group)
  // so their stroke/handle sizes stay constant on screen regardless of the
  // legend's own scale.
  function syncSelectionUI() {
    if (!placementMode || !svgEl || !legendGroupEl) return;
    const t = currentTransformState();
    const { w: gw0, h: gh0 } = legendGroupSize();
    const w = gw0 * t.scale;
    const h = gh0 * t.scale;
    if (!selRect) {
      selRect = document.createElementNS(NS, 'rect');
      selRect.setAttribute('fill', 'none');
      selRect.setAttribute('stroke', '#1a73e8');
      selRect.setAttribute('stroke-width', '2');
      selRect.setAttribute('stroke-dasharray', '6 4');
      selRect.setAttribute('pointer-events', 'none');
      svgEl.appendChild(selRect);
    }
    selRect.setAttribute('x', t.x - 2);
    selRect.setAttribute('y', t.y - 2);
    selRect.setAttribute('width', w + 4);
    selRect.setAttribute('height', h + 4);
    // Red warning only when the legend rect actually crosses the building
    // outline — not merely when it's within the plan's bounding box (which
    // includes blank margin around an irregular building shape).
    const overPlan = !!(floorPoly && rectIntersectsPolygon({
      x: t.x, y: t.y, w, h,
    }, floorPoly));
    selRect.setAttribute('stroke', overPlan ? '#e5484d' : '#1a73e8');
    const bg = legendGroupEl && legendGroupEl.querySelector('rect');
    if (bg) { bg.setAttribute('fill', overPlan ? '#ffdede' : '#ffffff'); bg.setAttribute('stroke', overPlan ? '#e5484d' : '#c7cad0'); }
    if (!selHandle) {
      selHandle = document.createElementNS(NS, 'circle');
      selHandle.setAttribute('r', '7');
      selHandle.setAttribute('fill', '#ffffff');
      selHandle.setAttribute('stroke', '#1a73e8');
      selHandle.setAttribute('stroke-width', '2');
      selHandle.style.cursor = 'nwse-resize';
      selHandle.addEventListener('pointerdown', onResizePointerDown);
      svgEl.appendChild(selHandle);
    }
    const hr = Math.max(7, Math.min(w, h) * 0.11);
    selHandle.setAttribute('r', String(Math.round(hr)));
    selHandle.setAttribute('cx', t.x + w);
    selHandle.setAttribute('cy', t.y + h);

    if (!zoomInBtn) {
      zoomInBtn = makeZoomButton('+', () => zoomLegend(0.7));
      zoomOutBtn = makeZoomButton('−', () => zoomLegend(1.4));
      svgEl.appendChild(zoomInBtn);
      svgEl.appendChild(zoomOutBtn);
    }
    // Big buttons that scale up/down with the legend's rendered size. Sized
    // generously in SVG units because the whole preview is scaled down to fit.
    const bs = Math.max(90, Math.min(w, h) * 0.9);
    const gap = bs * 0.2;
    const by = t.y - 2 - bs - gap;
    positionZoomButton(zoomInBtn, t.x - 2, by, bs);
    positionZoomButton(zoomOutBtn, t.x - 2 + bs + gap, by, bs);
  }
  function removeSelectionUI() {
    if (selRect && selRect.parentNode) selRect.parentNode.removeChild(selRect);
    if (selHandle && selHandle.parentNode) selHandle.parentNode.removeChild(selHandle);
    if (zoomInBtn && zoomInBtn.parentNode) zoomInBtn.parentNode.removeChild(zoomInBtn);
    if (zoomOutBtn && zoomOutBtn.parentNode) zoomOutBtn.parentNode.removeChild(zoomOutBtn);
    selRect = null;
    selHandle = null;
    zoomInBtn = null;
    zoomOutBtn = null;
  }

  function makeZoomButton(label, onClick) {
    const g = document.createElementNS(NS, 'g');
    g.style.cursor = 'pointer';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('rx', '3');
    rect.setAttribute('fill', '#ffffff');
    rect.setAttribute('stroke', '#1a73e8');
    rect.setAttribute('stroke-width', '1.5');
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', '#1a73e8');
    text.setAttribute('font-size', '13');
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('pointer-events', 'none');
    text.textContent = label;
    g.appendChild(rect);
    g.appendChild(text);
    g.addEventListener('pointerdown', (evt) => { evt.preventDefault(); evt.stopPropagation(); });
    g.addEventListener('click', (evt) => { evt.preventDefault(); evt.stopPropagation(); onClick(); });
    g._rect = rect;
    g._text = text;
    return g;
  }
  function positionZoomButton(g, x, y, size) {
    g._rect.setAttribute('x', x);
    g._rect.setAttribute('y', y);
    g._rect.setAttribute('width', size);
    g._rect.setAttribute('height', size);
    g._rect.setAttribute('rx', String(Math.round(size * 0.16)));
    g._text.setAttribute('x', x + size / 2);
    g._text.setAttribute('y', y + size / 2);
    g._text.setAttribute('font-size', String(Math.round(size * 0.62)));
  }

  function onLegendPointerDown(evt) {
    if (!placementMode) return;
    evt.preventDefault();
    const p = svgPointFromEvent(evt);
    const cur = currentTransformState();
    dragOffset = { x: p.x - cur.x, y: p.y - cur.y };
    legendGroupEl.style.cursor = 'grabbing';
    legendGroupEl.setPointerCapture(evt.pointerId);
    legendGroupEl.addEventListener('pointermove', onLegendPointerMove);
    legendGroupEl.addEventListener('pointerup', onLegendPointerUp);
  }
  function onLegendPointerMove(evt) {
    if (!dragOffset) return;
    const p = svgPointFromEvent(evt);
    const x = p.x - dragOffset.x;
    const y = p.y - dragOffset.y;
    const { scale } = currentTransformState();
    setLegendTransform(x, y, scale);
    syncSelectionUI();
  }
  function onLegendPointerUp(evt) {
    dragOffset = null;
    if (legendGroupEl) {
      legendGroupEl.style.cursor = 'grab';
      legendGroupEl.removeEventListener('pointermove', onLegendPointerMove);
      legendGroupEl.removeEventListener('pointerup', onLegendPointerUp);
    }
  }

  // Uniform resize from the bottom-right handle: scale is driven by the
  // distance from the legend's (fixed) top-left corner to the pointer, so
  // the box always keeps its aspect ratio.
  function onResizePointerDown(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    const p = svgPointFromEvent(evt);
    const t = currentTransformState();
    resizeStart = { ox: t.x, oy: t.y };
    void p;
    selHandle.setPointerCapture(evt.pointerId);
    selHandle.addEventListener('pointermove', onResizePointerMove);
    selHandle.addEventListener('pointerup', onResizePointerUp);
  }
  function onResizePointerMove(evt) {
    if (!resizeStart) return;
    const p = svgPointFromEvent(evt);
    const { w: gw0, h: gh0 } = legendGroupSize();
    const baseDiag = Math.hypot(gw0, gh0);
    const dx = Math.max(0, p.x - resizeStart.ox);
    const dy = Math.max(0, p.y - resizeStart.oy);
    let scale = Math.hypot(dx, dy) / baseDiag;
    scale = Math.min(4, Math.max(0.3, scale));
    setLegendTransform(resizeStart.ox, resizeStart.oy, scale);
    syncSelectionUI();
  }
  function onResizePointerUp() {
    resizeStart = null;
    if (selHandle) {
      selHandle.removeEventListener('pointermove', onResizePointerMove);
      selHandle.removeEventListener('pointerup', onResizePointerUp);
    }
  }

  // On-screen arrow scrollers, shown only during placement, so the view can
  // always be moved even after zooming/placing the legend off-screen.
  let panPad = null;
  function panBy(fx, fy) {
    const vb = getViewBox();
    const cap = lastGrownVB || baseVB || vb;
    if (!vb || !cap) return;
    let nx = vb.x + fx * vb.w * 0.3;
    let ny = vb.y + fy * vb.h * 0.3;
    nx = Math.min(Math.max(nx, cap.x), Math.max(cap.x, cap.x + cap.w - vb.w));
    ny = Math.min(Math.max(ny, cap.y), Math.max(cap.y, cap.y + cap.h - vb.h));
    svgEl.setAttribute('viewBox', `${Math.round(nx)} ${Math.round(ny)} ${Math.round(vb.w)} ${Math.round(vb.h)}`);
    syncSelectionUI();
  }
  function showPanPad() {
    if (panPad) { panPad.hidden = false; return; }
    const wrap = el.querySelector('#preview-svg-wrap');
    if (!wrap) return;
    panPad = document.createElement('div');
    panPad.id = 'preview-pan-pad';
    const defs = [['up', '▲', 0, -1], ['down', '▼', 0, 1], ['left', '◀', -1, 0], ['right', '▶', 1, 0]];
    for (const [dir, glyph, fx, fy] of defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pan-arrow pan-${dir}`;
      b.textContent = glyph;
      b.addEventListener('click', (e) => { e.preventDefault(); panBy(fx, fy); });
      panPad.appendChild(b);
    }
    wrap.appendChild(panPad);
  }
  function hidePanPad() { if (panPad) panPad.hidden = true; }

  function enterPlacement() {
    if (!svgEl) return;
    placementMode = true;
    if (layoutBox) layoutBox.hide();
    exportBtn.disabled = true;
    placeBtn.hidden = true;
    saveBtn.hidden = false;
    removeBtn.hidden = false;
    renderLegendAt(savedLegendPos || defaultLegendPos());
    showPanPad();
  }
  function exitPlacement() {
    placementMode = false;
    exportBtn.disabled = false;
    placeBtn.hidden = false;
    saveBtn.hidden = true;
    removeBtn.hidden = true;
    removeSelectionUI();
    hidePanPad();
    applyPage();
  }

  if (savedLegendPos) renderLegendAt(savedLegendPos);
  applyPage();

  placeBtn.addEventListener('click', enterPlacement);
  saveBtn.addEventListener('click', () => {
    const pos = clampLegendPos(currentTransformState());
    savedLegendPos = pos;
    renderLegendAt(pos);
    exitPlacement();
    if (onSaveLegend) onSaveLegend(pos);
  });
  removeBtn.addEventListener('click', () => {
    savedLegendPos = null;
    if (legendGroupEl && legendGroupEl.parentNode) legendGroupEl.parentNode.removeChild(legendGroupEl);
    legendGroupEl = null;
    lastGrownVB = null;
    fitViewBox(null);
    exitPlacement();
    if (onSaveLegend) onSaveLegend(null);
  });

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
  exportBtn.addEventListener('click', () => { if (onExport) onExport(savedLegendPos); });

  return { close };
}
