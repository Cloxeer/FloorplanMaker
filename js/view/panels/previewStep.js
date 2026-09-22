// previewStep.js
// Full-screen "Preview" step shown when the user clicks Export (top bar or
// step 4). Renders the exact exported SVG (already built by docActions.js'
// exportAll, halls filtered out) scaled to fit, beside a legend and the
// current checklist state. "Back to editing" closes the panel with no side
// effects; "Download files" runs the existing export dialog (download +
// building-extras.json snippet).
// Depends on: js/view/panels/legend.js, js/view/panels/validation.js (checklistHtml).

import { legendHtml, legendSvgGroup, LEGEND_NOTE } from './legend.js';
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
  svgText, validation, twoFiles, svgName, jpgName, halls,
}, { onBack, onDownload }) {
  const host = document.getElementById('dialogs');
  const el = document.createElement('div');
  el.id = 'preview';
  el.className = 'preview-screen';
  const downloadLabel = twoFiles ? 'Download files' : 'Download file';
  const downloadNote = twoFiles
    ? `You get two files: ${svgName} is the plan itself; ${jpgName} is the flattened photo, kept next to it for reference.`
    : `You get one file: ${svgName} is the plan itself.`;
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
        <label class="preview-legend-toggle">
          <input type="checkbox" id="preview-include-legend">
          Include the legend in the downloaded SVG
        </label>
        <button type="button" id="preview-download" class="btn-primary">${downloadLabel}</button>
        <p class="preview-download-note">This legend is a preview aid.</p>
        <p class="preview-download-note">${downloadNote}</p>
      </div>
    </div>
  `;
  host.appendChild(el);

  // Inline the exported SVG verbatim so the preview matches the download
  // byte-for-byte (only CSS scales it to fit the panel).
  el.querySelector('#preview-svg-wrap').innerHTML = svgText;
  const svgEl = el.querySelector('#preview-svg-wrap svg');
  if (svgEl) {
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';
    svgEl.style.background = '#ffffff';

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

  let includeLegend = false;
  const legendToggle = el.querySelector('#preview-include-legend');
  legendToggle.addEventListener('change', () => { includeLegend = legendToggle.checked; });

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
  el.querySelector('#preview-download').addEventListener('click', () => { if (onDownload) onDownload(includeLegend); });

  return { close };
}
