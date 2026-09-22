// previewStep.js
// Full-screen "Preview" step shown when the user clicks Export (top bar or
// step 4). Renders the exact exported SVG (already built by docActions.js'
// exportAll, halls filtered out) scaled to fit, beside a legend and the
// current checklist state. "Back to editing" closes the panel with no side
// effects; "Download files" runs the existing export dialog (download +
// building-extras.json snippet).
// Depends on: js/view/panels/legend.js, js/view/panels/validation.js (checklistHtml).

import { legendHtml, LEGEND_NOTE } from './legend.js';
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
        <p class="legend-note">Hallway (guide, not exported)</p>
        <p class="legend-note">${LEGEND_NOTE}</p>
        <div class="section-title">Checklist</div>
        <ul class="checklist">${checklistHtml(validation || [])}</ul>
      </aside>
    </div>
    <div class="preview-actions">
      <button type="button" id="preview-back">Back to editing</button>
      <div class="preview-download-group">
        <button type="button" id="preview-download" class="btn-primary">${downloadLabel}</button>
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
      r.setAttribute('fill', '#cfe3ff');
      r.setAttribute('fill-opacity', '0.5');
      r.setAttribute('stroke', 'none');
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
  }

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
  el.querySelector('#preview-download').addEventListener('click', () => { if (onDownload) onDownload(); });

  return { close };
}
