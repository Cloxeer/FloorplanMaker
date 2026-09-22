// exportDialog.js
// Full-screen "Export" step (step 4): a format dropdown (SVG / PNG / SVG +
// photo) and a single "Download" button that downloads exactly one thing per
// click. Also shows a short plain-language note, and — collapsed by default,
// behind a "For the map maintainer" <details> — the building-extras.json
// snippet and the two build commands.
// Depends on: js/model/svgExport.js (exportExtrasSnippet, exportCommands, exportFileNames).

import { exportExtrasSnippet, exportCommands, exportFileNames } from '../../model/svgExport.js';

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const isBase64 = header.includes('base64');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function svgPixelSize(svgText) {
  const m = svgText.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/);
  if (m) return { w: Math.round(parseFloat(m[3])), h: Math.round(parseFloat(m[4])) };
  return { w: 1600, h: 1200 };
}

function svgToPngBlob(svgText, w, h) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error('Could not rasterize the plan.'));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterize the plan.')); };
    img.src = url;
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function showExportStep({ svgText, jpgDataUrl, meta }, { onBack }) {
  const host = document.getElementById('dialogs');
  const names = exportFileNames(meta);
  const snippet = exportExtrasSnippet(meta);
  const commands = exportCommands().split('\n').filter(Boolean);

  const el = document.createElement('div');
  el.id = 'export-step';
  el.className = 'export-screen';
  el.innerHTML = `
    <header class="preview-header">
      <button type="button" id="export-back-top">&larr; Back to preview</button>
      <h2>Export</h2>
      <p>Choose what to download.</p>
    </header>
    <div class="export-body">
      <label class="export-format-label" for="export-format">Format</label>
      <select id="export-format">
        <option value="svg" selected>SVG (plan)</option>
        <option value="png">PNG (image)</option>
        ${jpgDataUrl ? '<option value="both">SVG + photo (folder)</option>' : ''}
      </select>
      <button type="button" id="export-download" class="btn-primary">Download</button>
      <p class="export-note">Your file: <code>${escapeHtml(names.svg)}</code>. Hand this to whoever maintains the map.</p>
      <details id="export-maintainer">
        <summary>For the map maintainer</summary>
        <div class="section-title">Add this to data/source/building-extras.json, then run:</div>
        <div class="export-snippet" id="ed-snippet">${escapeHtml(snippet)}</div>
        <button type="button" id="ed-copy-snippet">Copy snippet</button>
        <div class="section-title">Run</div>
        ${commands.map((c, i) => `<div class="export-cmd"><code>${escapeHtml(c)}</code><button type="button" data-cmd="${i}">Copy</button></div>`).join('')}
      </details>
    </div>
    <div class="preview-actions">
      <button type="button" id="export-back">Back to preview</button>
    </div>
  `;
  host.appendChild(el);

  const formatSel = el.querySelector('#export-format');
  const downloadBtn = el.querySelector('#export-download');

  downloadBtn.addEventListener('click', async () => {
    const fmt = formatSel.value;
    downloadBtn.disabled = true;
    try {
      if (fmt === 'svg') {
        downloadBlob(names.svg, new Blob([svgText], { type: 'image/svg+xml' }));
      } else if (fmt === 'png') {
        const { w, h } = svgPixelSize(svgText);
        const pngBlob = await svgToPngBlob(svgText, w, h);
        downloadBlob(names.svg.replace(/\.svg$/i, '.png'), pngBlob);
      } else if (fmt === 'both') {
        downloadBlob(names.svg, new Blob([svgText], { type: 'image/svg+xml' }));
        if (jpgDataUrl) downloadBlob(names.jpg, dataUrlToBlob(jpgDataUrl));
      }
    } catch {
      // eslint-disable-next-line no-alert
      alert('Could not build that download. Try SVG instead.');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  el.querySelector('#ed-copy-snippet').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(snippet);
  });
  el.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = commands[parseInt(btn.dataset.cmd, 10)];
      navigator.clipboard && navigator.clipboard.writeText(cmd);
    });
  });

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    el.remove();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { close(); if (onBack) onBack(); }
  }
  document.addEventListener('keydown', onKeyDown);
  el.querySelector('#export-back').addEventListener('click', () => { close(); if (onBack) onBack(); });
  el.querySelector('#export-back-top').addEventListener('click', () => { close(); if (onBack) onBack(); });

  return { close };
}
