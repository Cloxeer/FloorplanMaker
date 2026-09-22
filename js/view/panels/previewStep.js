// previewStep.js
// Full-screen "Preview" step shown when the user clicks Export (top bar or
// step 4). Renders the exact exported SVG (already built by docActions.js'
// exportAll, halls filtered out) scaled to fit, beside a legend and the
// current checklist state. "Back to editing" closes the panel with no side
// effects; "Download files" runs the existing export dialog (download +
// building-extras.json snippet).
// Depends on: js/view/panels/legend.js, js/view/panels/validation.js (checklistHtml).

import {
  legendHtml, legendSvgGroupAt, legendGroupSize, LEGEND_NOTE,
} from './legend.js';
import { checklistHtml } from './validation.js';
import { pointInPolygon, segmentsIntersect } from '../../model/geometry.js';

function hallIntersection(a, b) {
  const axisA = a.w > a.h ? 'h' : 'v';
  const axisB = b.w > b.h ? 'h' : 'v';
  if (axisA !== axisB) return null;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

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

export function showPreviewStep({
  svgText, validation, halls, rooms, initialLegendPos,
}, { onBack, onExport }) {
  const host = document.getElementById('dialogs');
  const el = document.createElement('div');
  el.id = 'preview';
  el.className = 'preview-screen';
  el.innerHTML = `
    <header class="preview-header">
      <button type="button" id="preview-back-top">&larr; Back to editing</button>
      <h2>Preview</h2>
      <p>This is exactly what will be exported. Hallway guides are left out.</p>
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
  if (svgEl) {
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.background = '#ffffff';

    // Snapshot of the plan's own footprint (rooms/floor/doors/etc, before
    // any preview-only overlays are appended) — used to place the legend
    // in blank margin, never over the plan.
    try { planBBox = svgEl.getBBox(); } catch { planBBox = null; }

    // Hallways are studio-only guides, left out of the exported SVG text.
    // Overlay them here (and their overlaps) into the inline preview SVG
    // only — never mutate svgText itself.
    const ns = 'http://www.w3.org/2000/svg';
    const halls_ = halls || [];
    for (const h of halls_) {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', h.x);
      r.setAttribute('y', h.y);
      r.setAttribute('width', h.w);
      r.setAttribute('height', h.h);
      r.setAttribute('fill', '#d7dbe0');
      svgEl.appendChild(r);
    }
    for (let i = 0; i < halls_.length; i += 1) {
      for (let j = i + 1; j < halls_.length; j += 1) {
        const rect = hallIntersection(halls_[i], halls_[j]);
        if (rect) {
          const r = document.createElementNS(ns, 'rect');
          r.setAttribute('x', rect.x);
          r.setAttribute('y', rect.y);
          r.setAttribute('width', rect.w);
          r.setAttribute('height', rect.h);
          r.setAttribute('fill', '#e5484d');
          r.setAttribute('fill-opacity', '0.35');
          r.setAttribute('stroke', 'none');
          svgEl.appendChild(r);
        }
      }
    }

    // Elevator/restroom icons and the void criss-cross hatch are now part of
    // svgText itself (see roomExtraLine in js/model/svgExport.js), so the
    // preview no longer needs to draw them separately — it already matches
    // the download byte-for-byte on this front. `rooms` is only kept for
    // the hall overlay above.
    void rooms;

    // Paper-frame preview aid: a thin grey Letter-ratio rectangle centered
    // on the plan bbox with ~6% margin, so the user sees how it fits a
    // printed sheet. Preview only — never written into svgText.
    const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      const [vx, vy, vw, vh] = vb;
      const cx = vx + vw / 2;
      const cy = vy + vh / 2;
      const margin = 0.06;
      const targetW = vw * (1 + margin * 2);
      const targetH = vh * (1 + margin * 2);
      const letterRatio = vw >= vh ? 11 / 8.5 : 8.5 / 11;
      let frameW;
      let frameH;
      if (targetW / targetH > letterRatio) { frameW = targetW; frameH = targetW / letterRatio; }
      else { frameH = targetH; frameW = frameH * letterRatio; }
      const fx = cx - frameW / 2;
      const fy = cy - frameH / 2;
      const frame = document.createElementNS(ns, 'rect');
      frame.setAttribute('x', fx);
      frame.setAttribute('y', fy);
      frame.setAttribute('width', frameW);
      frame.setAttribute('height', frameH);
      frame.setAttribute('fill', 'none');
      frame.setAttribute('stroke', '#9aa0a8');
      frame.setAttribute('stroke-width', Math.max(1, vw / 500));
      frame.setAttribute('stroke-dasharray', `${Math.max(2, vw / 200)} ${Math.max(2, vw / 200)}`);
      svgEl.appendChild(frame);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', fx + frameW * 0.02);
      label.setAttribute('y', fy + frameH * 0.03 + (vw / 60));
      label.setAttribute('fill', '#9aa0a8');
      label.setAttribute('font-size', Math.max(10, vw / 60));
      label.setAttribute('font-family', 'sans-serif');
      label.textContent = 'Letter sheet';
      svgEl.appendChild(label);
    }
  }

  // --- Draggable legend placement --------------------------------------
  const placeBtn = el.querySelector('#preview-place-legend');
  const saveBtn = el.querySelector('#preview-save-legend');
  const removeBtn = el.querySelector('#preview-remove-legend');
  const exportBtn = el.querySelector('#preview-export');
  const NS = 'http://www.w3.org/2000/svg';
  const MARGIN = 20;
  let baseVB = null;
  function ensureBaseVB() {
    if (!baseVB) baseVB = getViewBox();
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
    let { x, y } = pos;
    const plan = planBBox
      ? { x: planBBox.x, y: planBBox.y, w: planBBox.width, h: planBBox.height }
      : null;
    if (plan && rectsOverlap({ x, y, w: gw, h: gh }, plan)) {
      // Keep the legend off the plan: park it in the right-hand margin.
      x = plan.x + plan.w + MARGIN;
      y = Math.max(vb.y, plan.y);
    }
    if (y < vb.y) y = vb.y;
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
    fitViewBox(pos);
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

  function enterPlacement() {
    if (!svgEl) return;
    placementMode = true;
    exportBtn.disabled = true;
    placeBtn.hidden = true;
    saveBtn.hidden = false;
    removeBtn.hidden = false;
    renderLegendAt(savedLegendPos || defaultLegendPos());
  }
  function exitPlacement() {
    placementMode = false;
    exportBtn.disabled = false;
    placeBtn.hidden = false;
    saveBtn.hidden = true;
    removeBtn.hidden = true;
    removeSelectionUI();
  }

  if (savedLegendPos) renderLegendAt(savedLegendPos);

  placeBtn.addEventListener('click', enterPlacement);
  saveBtn.addEventListener('click', () => {
    const pos = clampLegendPos(currentTransformState());
    savedLegendPos = pos;
    renderLegendAt(pos);
    exitPlacement();
  });
  removeBtn.addEventListener('click', () => {
    savedLegendPos = null;
    if (legendGroupEl && legendGroupEl.parentNode) legendGroupEl.parentNode.removeChild(legendGroupEl);
    legendGroupEl = null;
    lastGrownVB = null;
    fitViewBox(null);
    exitPlacement();
  });

  function close() {
    document.removeEventListener('keydown', onKeyDown);
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
