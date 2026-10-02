// exportScope.js (view)
// On the Export step: choose "This floor only" or "All floors" of the building. All floors are exported
// into one folder named after the building: a single .zip when downloading, or Finished/<Building>/ when
// saving into the connected project folder. Hooks the existing Download / Save buttons (capture phase) so
// the single-floor export code is untouched.
// Depends on: js/model/zip.js, js/model/building.js, js/store/folderStore.js, js/view/panels/exportDialog.js helpers.

import { makeZip } from '../../model/zip.js';
import { buildingFolderName } from '../../model/building.js';
import { writeBuildingFiles } from '../../store/folderStore.js';
import { downloadBlob, dataUrlToBlob, svgPixelSize, svgToPngBlob } from './exportDialog.js';

const enc = new TextEncoder();

export function mountExportScope(root, { floorsPromise, scope = 'this', finalSvgFor, getPage, meta, folderApi, setStatus, onScope }) {
  if (!floorsPromise) return;
  floorsPromise.then((floors) => {
    if (!root.isConnected || !floors || floors.length < 2) return;
    const body = root.querySelector('.export-body');
    const formatSel = root.querySelector('#export-format');
    if (!body || !formatSel) return;
    const folder = buildingFolderName(meta && meta.building);
    const row = document.createElement('div'); row.className = 'export-scope';
    row.innerHTML = `<label class="export-format-label" for="export-scope">What to export</label>
      <select id="export-scope"><option value="this">This floor only</option><option value="all">All ${floors.length} floors in this building (one folder)</option></select>
      <p class="export-note" id="export-scope-note" hidden></p>`;
    body.insertBefore(row, formatSel.previousElementSibling || formatSel);
    const sel = row.querySelector('select'), note = row.querySelector('#export-scope-note');
    sel.value = scope;

    const draw = () => {
      note.hidden = sel.value !== 'all';
      note.innerHTML = `Floors ${floors.map((f) => f.floor).join(', ')} go into a folder named <code>${folder.replace(/</g, '&lt;')}</code>.`;
    };
    sel.addEventListener('change', () => { scope = sel.value; draw(); setStatus(''); if (onScope) onScope(scope); });
    draw();

    const blocking = () => floors.filter((f) => !f.empty && f.errors);
    async function buildFiles(fmt) {
      const pg = getPage ? getPage() : 'fit';
      const files = [];
      for (const f of floors) {
        if (f.empty) continue;
        const svg = finalSvgFor(f, pg);
        if (!svg) continue;
        if (fmt === 'png') { const { w, h } = svgPixelSize(svg); files.push({ name: `${f.slug}.png`, data: new Uint8Array(await (await svgToPngBlob(svg, w, h)).arrayBuffer()) }); }
        else if (fmt === 'project') files.push({ name: `${f.slug}.floorplan.json`, data: f.projectJson() });
        else {
          files.push({ name: `${f.slug}.svg`, data: svg });
          if (fmt === 'both' && f.photo) files.push({ name: `${f.slug}-posted.jpg`, data: new Uint8Array(await dataUrlToBlob(f.photo).arrayBuffer()) });
        }
      }
      return files;
    }
    function guard() {
      const bad = blocking();
      if (!bad.length) return true;
      setStatus(`Fix the errors on ${bad.map((f) => `Floor ${f.floor}`).join(', ')} before exporting all floors.`, true);
      return false;
    }
    const zipDownload = (files) => downloadBlob(`${folder}.zip`, new Blob([makeZip(files.map((f) => ({ name: `${folder}/${f.name}`, data: f.data })))], { type: 'application/zip' }));

    // Download: capture phase, so the single-floor handler never sees it when "All floors" is chosen
    const dl = root.querySelector('#export-download');
    if (dl) dl.addEventListener('click', async (e) => {
      if (sel.value !== 'all') return;
      e.stopImmediatePropagation();
      if (!guard()) return;
      dl.disabled = true; setStatus('');
      try {
        const files = await buildFiles(formatSel.value);
        if (!files.length) { setStatus('There is nothing drawn on these floors yet.', true); return; }
        zipDownload(files);
        setStatus(`Downloaded ${folder}.zip with ${files.length} ${files.length === 1 ? 'file' : 'files'} in a ${folder} folder.`);
      } catch (err) { setStatus('Could not build the building download. Try one floor at a time.', true); }
      finally { dl.disabled = false; }
    }, true);

    const save = root.querySelector('#export-save-finished');
    if (save) save.addEventListener('click', async (e) => {
      if (sel.value !== 'all') return;
      e.stopImmediatePropagation();
      if (!guard()) return;
      save.disabled = true; setStatus('');
      try {
        let handle = folderApi && folderApi.getHandle();
        if (!handle && folderApi) { try { await folderApi.pick(); } catch (err) { /* cancelled */ } handle = folderApi.getHandle(); }
        if (!handle) { setStatus('No folder connected — pick a folder to save into.', true); return; }
        const files = (await buildFiles('svg'));
        if (!files.length) { setStatus('There is nothing drawn on these floors yet.', true); return; }
        const also = root.querySelector('#export-dup-download');
        let path = '', failed = null;
        try { path = await writeBuildingFiles(handle, folder, files.map((f) => ({ name: f.name, data: typeof f.data === 'string' ? f.data : new Blob([f.data]) }))); } catch (err) { failed = err; }
        if (also && also.checked) zipDownload(files);
        setStatus(failed ? `Could not save to the Finished folder (${failed.message}).` : `Saved ${files.length} floors in ${path} in your project folder.${also && also.checked ? ' A zip copy was also downloaded.' : ''}`, !!failed);
      } finally { save.disabled = false; }
    }, true);
  }).catch(() => { /* single floor: nothing to add */ });
}
