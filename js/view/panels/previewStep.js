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

  let savedLegendPos = initialLegendPos || null; // {x,y,scale} in SVG user units, confirmed via Save
  let placementMode = false;
  let legendGroupEl = null;
  let dragOffset = null;
  let selRect = null;
  let selHandle = null;
  let resizeStart = null;

  function getViewBox() {
    const vb = (svgEl && svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !vb.every((n) => Number.isFinite(n))) return null;
    const [x, y, w, h] = vb;
    return {
      x, y, w, h,
    };
  }

  function defaultLegendPos() {
    const vb = getViewBox();
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
    const vb = getViewBox();
    const { w: gw0, h: gh0 } = legendGroupSize();
    const scale = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
    if (!vb) return { ...pos, scale };
    const gw = gw0 * scale;
    const gh = gh0 * scale;
    let { x, y } = pos;
    x = Math.min(Math.max(x, vb.x), vb.x + vb.w - gw);
    y = Math.min(Math.max(y, vb.y), vb.y + vb.h - gh);
    const plan = planBBox
      ? {
        x: planBBox.x, y: planBBox.y, w: planBBox.width, h: planBBox.height,
      }
      : null;
    if (plan && rectsOverlap({
      x, y, w: gw, h: gh,
    }, plan)) {
      return defaultLegendPos();
    }
    return { x, y, scale };
  }

  function renderLegendAt(pos) {
    if (!svgEl) return;
    const scale = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
    const wrap = document.createElementNS(NS, 'g');
    wrap.innerHTML = legendSvgGroupAt(pos.x, pos.y, scale);
    const newGroup = wrap.firstElementChild;
    if (legendGroupEl && legendGroupEl.parentNode) legendGroupEl.parentNode.removeChild(legendGroupEl);
    legendGroupEl = newGroup;
    svgEl.appendChild(legendGroupEl);
    legendGroupEl.style.cursor = 'grab';
    legendGroupEl.addEventListener('pointerdown', onLegendPointerDown);
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
    selHandle.setAttribute('cx', t.x + w);
    selHandle.setAttribute('cy', t.y + h);
  }
  function removeSelectionUI() {
    if (selRect && selRect.parentNode) selRect.parentNode.removeChild(selRect);
    if (selHandle && selHandle.parentNode) selHandle.parentNode.removeChild(selHandle);
    selRect = null;
    selHandle = null;
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
