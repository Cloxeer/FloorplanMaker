// projects.js
// Start-screen project list: cards with Open/Delete, "Start blueprint" button
// wiring, and the "Open .json project" file input.
// Depends on: js/store/autosave.js (listProjects, deleteProject), showConfirm from blueprint.js.

import { listProjects, deleteProject } from '../../store/autosave.js';
import * as folderStore from '../../store/folderStore.js';
import { showConfirm } from './blueprint.js';

function formatSavedAgo(ts) {
  if (!ts) return 'never saved';
  const d = new Date(ts);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function mountProjects(el, app, { onStart, onOpen, onImport, onImportSvg } = {}) {
  const startBtn = document.getElementById('btn-start-blueprint');
  const openInput = document.getElementById('open-json-input');
  const importSvgInput = document.getElementById('import-svg-input');

  function onStartClick() {
    if (onStart) onStart();
  }
  if (startBtn) startBtn.addEventListener('click', onStartClick);

  async function onFileChange() {
    const file = openInput.files[0];
    if (!file) return;
    const text = await file.text();
    if (onImport) onImport(text);
    openInput.value = '';
  }
  if (openInput) openInput.addEventListener('change', onFileChange);

  async function onImportSvgChange() {
    const file = importSvgInput.files[0];
    if (!file) return;
    const text = await file.text();
    if (onImportSvg) onImportSvg(text);
    importSvgInput.value = '';
  }
  if (importSvgInput) importSvgInput.addEventListener('change', onImportSvgChange);

  async function refresh() {
    el.innerHTML = '<p style="color:var(--muted)">Loading projects…</p>';
    let idbList = [];
    try {
      idbList = await listProjects();
    } catch (e) {
      el.innerHTML = '<p style="color:var(--muted)">Could not load saved projects.</p>';
      return;
    }
    const folderHandle = app.folder && app.folder.state === 'granted' ? app.folder.handle : null;
    let folderList = [];
    if (folderHandle) {
      try { folderList = await folderStore.listProjects(folderHandle); } catch { /* ignore */ }
    }
    const bySlug = new Map();
    for (const p of idbList) bySlug.set(p.slug, { ...p, onDisk: false, hasIdb: true });
    for (const p of folderList) {
      const existing = bySlug.get(p.slug);
      bySlug.set(p.slug, { ...p, id: existing ? existing.id : null, onDisk: true, hasIdb: !!existing });
    }
    const list = [...bySlug.values()];
    if (!list.length) {
      el.innerHTML = '<p style="color:var(--muted)">No saved projects yet. Start a blueprint to begin.</p>';
      return;
    }
    el.innerHTML = '';
    list
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
      .forEach((p) => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
          <h3>${escapeHtml(p.building || p.name || 'Untitled')}</h3>
          <div class="meta">Floor ${escapeHtml(String(p.floor))} &middot; ${escapeHtml(p.slug || '')} ${p.onDisk ? '<span class="chip">on disk</span>' : ''}</div>
          <div class="meta">Saved ${formatSavedAgo(p.savedAt)}</div>
          <div class="row">
            <button type="button" class="btn-open">Open</button>
            <button type="button" class="btn-delete">Delete</button>
          </div>
        `;
        card.querySelector('.btn-open').addEventListener('click', () => {
          if (onOpen) onOpen(p);
        });
        card.querySelector('.btn-delete').addEventListener('click', async () => {
          const ok = await showConfirm(`Delete "${p.building || p.name}"? This cannot be undone.`);
          if (!ok) return;
          try {
            if (p.hasIdb && p.id) await deleteProject(p.id);
            if (p.onDisk && folderHandle) await folderStore.deleteProject(folderHandle, p.slug);
          } catch (err) {
            el.insertAdjacentHTML('afterbegin', `<p style="color:#b3261e">${escapeHtml(err && err.message ? err.message : 'Could not delete that project.')}</p>`);
          }
          refresh();
        });
        el.appendChild(card);
      });
  }

  refresh();

  return {
    refresh,
    destroy() {
      if (startBtn) startBtn.removeEventListener('click', onStartClick);
      if (openInput) openInput.removeEventListener('change', onFileChange);
      if (importSvgInput) importSvgInput.removeEventListener('change', onImportSvgChange);
      el.innerHTML = '';
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
