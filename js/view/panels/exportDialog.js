// exportDialog.js
// Triggers the .svg and -posted.jpg downloads and shows a modal with the
// building-extras.json snippet and the build commands, each with Copy.
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

export function showExportDialog({ svgText, jpgDataUrl, meta }) {
  const host = document.getElementById('dialogs');
  const names = exportFileNames(meta);
  const snippet = exportExtrasSnippet(meta);
  const commands = exportCommands().split('\n').filter(Boolean);

  function doDownloads() {
    downloadBlob(names.svg, new Blob([svgText], { type: 'image/svg+xml' }));
    if (jpgDataUrl) downloadBlob(names.jpg, dataUrlToBlob(jpgDataUrl));
  }
  doDownloads();

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.maxWidth = '520px';
  backdrop.appendChild(modal);

  modal.innerHTML = `
    <h3>Exported ${escapeHtml(names.svg)}</h3>
    <p style="color:var(--muted)">Downloads started for <code>${escapeHtml(names.svg)}</code> and <code>${escapeHtml(names.jpg)}</code>.</p>
    <div class="section-title">building-extras.json snippet</div>
    <div class="export-snippet" id="ed-snippet">${escapeHtml(snippet)}</div>
    <button type="button" id="ed-copy-snippet">Copy snippet</button>
    <div class="section-title">Run</div>
    ${commands.map((c, i) => `<div class="export-cmd"><code>${escapeHtml(c)}</code><button type="button" data-cmd="${i}">Copy</button></div>`).join('')}
    <div class="modal-actions">
      <button type="button" id="ed-redownload">Download again</button>
      <button type="button" id="ed-close" class="btn-primary">Done</button>
    </div>
  `;
  host.appendChild(backdrop);

  modal.querySelector('#ed-copy-snippet').addEventListener('click', () => {
    navigator.clipboard && navigator.clipboard.writeText(snippet);
  });
  modal.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = commands[parseInt(btn.dataset.cmd, 10)];
      navigator.clipboard && navigator.clipboard.writeText(cmd);
    });
  });
  modal.querySelector('#ed-redownload').addEventListener('click', doDownloads);

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }
  modal.querySelector('#ed-close').addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
