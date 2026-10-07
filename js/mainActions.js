// mainActions.js — kept separate from main.js to stay under 400 lines each.
// The studio screen controller (canvas/tools/panels wiring, hotkeys,
// enter/close/photo-step flow, .json/.svg import). Document-editing actions
// (duplicateInRow, copy/paste, routeToRoom, exportAll) live in js/docActions.js
// to keep this file under the line budget. main.js keeps only the `app` core
// and startup, and re-exports createActions from js/docActions.js.
// Depends on: js/model/*, js/store/autosave.js, js/view/stage.js, js/view/panels/*.js.

import { createDoc, mergeBigRooms, legendFromView } from './model/document.js';
import { importSvg } from './model/svgImport.js';
import {
  loadProject, listProjects, saveProject, saveNow, importProjectJson, exportProjectJson, suspend, resume, lastSavedAt, formatSavedAgo,
} from './store/autosave.js';
import * as folderStore from './store/folderStore.js';
import { createStage } from './view/stage.js';
import { mountPalette } from './view/panels/palette.js';
import { mountStepStrip } from './view/panels/stepStrip.js';
import { mountProperties } from './view/panels/properties.js';
import { mountValidation, checklistReady, docChecklistCodes } from './view/panels/validation.js';
import { ignoredIds as ignoredOf, pruneIgnored, applyIgnores } from './model/ignored.js';
import { showBlueprint, slugify } from './view/panels/blueprint.js';
import { mountPhotoStep } from './view/panels/photoStep.js';
import { mountSuggest } from './view/panels/suggest.js';
import { mountAutoBuild } from './view/panels/autobuild.js'; import { mountLayers } from './view/panels/layers.js'; import { mountAttention } from './view/attention.js'; import { mountOverlapDot } from './view/overlapDot.js'; import { mountFixAll } from './view/fixAll.js';
import { mountOutlineEdit } from './view/outlineEdit.js'; import { mountFloors } from './view/panels/floors.js'; import { mountPhotoLayer } from './view/photoLayer.js'; import { mountOutlinePrompt } from './view/outlinePrompt.js'; import { mountMultiPhoto } from './view/panels/multiPhoto.js'; import { freeSlug, UNNAMED } from './model/building.js'; import { mountFixGuide } from './view/panels/fixguide.js';

export { createActions } from './docActions.js';

// ---- studio screen controller ----
const TOOL_KEYS = { v: 'select', r: 'room', f: 'floor', o: 'door', a: 'hall', s: 'stair', c: 'compass' };

export function createStudio(app, deps) {
  const { screens, showScreen, scheduleValidate, updateUndoRedoButtons } = deps;
  let paletteHandle = null, propertiesHandle = null, validationHandle = null, suggestHandle = null, stepStripHandle = null, autoBuildHandle = null;
  let photoStepHandle = null, studioUnsub = null, reloadBarShown = false;
  const studioListeners = [];
  const extraUnsubs = [];
  function onStudio(target, type, fn, opts) { target.addEventListener(type, fn, opts); studioListeners.push([target, type, fn, opts]); }

  let folderWriteFailedShown = false;
  function persistToFolder(project) {
    if (!project || !app.folder || app.folder.state !== 'granted' || !app.folder.handle) return;
    folderStore.writeProject(app.folder.handle, project).catch(() => {
      if (!folderWriteFailedShown) { folderWriteFailedShown = true; app.toast('Could not write to the folder'); }
    });
  }
  function showChooseFolderModal() {
    return new Promise((resolve) => {
      const host = document.getElementById('dialogs');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal folder-modal';
      modal.innerHTML = `
        <h3>Choose a folder to keep your floor plans</h3>
        <div class="modal-actions">
          <button type="button" id="folder-modal-skip">Not now</button>
          <button type="button" id="folder-modal-choose" class="btn-primary">Choose folder</button>
        </div>
      `;
      backdrop.appendChild(modal);
      host.appendChild(backdrop);
      function cleanup() { backdrop.remove(); }
      modal.querySelector('#folder-modal-skip').addEventListener('click', () => { cleanup(); resolve(); });
      modal.querySelector('#folder-modal-choose').addEventListener('click', async () => {
        cleanup();
        if (app.pickFolderThenContinue) await app.pickFolderThenContinue();
        resolve();
      });
    });
  }

  function toggleGrid() {
    app.gridOn = !app.gridOn;
    app.canvas.setGrid(app.gridOn);
    const btn = document.getElementById('btn-grid');
    if (btn) btn.setAttribute('aria-pressed', String(app.gridOn));
    scheduleSaveView();
  }
  function scheduleSaveView() {
    if (!app.project) return;
    const v = app.canvas.getView();
    const { print } = app.project.view || {}; // paper layouts, set by the Preview step
    app.project.view = { zoom: app.doc.viewBox.w / (v.w || 1), panX: v.x, panY: v.y, onion: app.onion, gridOn: app.gridOn, planOpacity: app.planOpacity, print };
    saveProject(app.project);
    persistToFolder(app.project);
    app.emit({ type: 'view' });
  }
  app.saveView = scheduleSaveView;
  // "Ignore": problems the person chose to leave alone (kept in the project; see js/model/ignored.js)
  app.ignoredIds = () => (app.project && app.doc ? pruneIgnored(app.doc, ignoredOf(app.project)) : new Set());
  // "Hide" (the eye in the Layers list): items that are only hidden from view while working. Nothing is deleted or changed, and
  // hidden items are still exported; the list lives in the project (project.hidden = [item ids]).
  app.hiddenIds = () => (app.project && app.doc ? pruneIgnored(app.doc, ignoredOf({ ignored: app.project.hidden })) : new Set());
  app.setHidden = (ids, on) => {
    if (!app.project) return;
    const cur = ignoredOf({ ignored: app.project.hidden });
    for (const id of ids) { if (on) cur.add(id); else cur.delete(id); }
    app.project.hidden = [...cur];
    saveNow(app.project);
    app.emit({ type: 'hidden' });
  };
  app.setIgnored = (ids, on) => {
    if (!app.project) return;
    const cur = ignoredOf(app.project);
    for (const id of ids) { if (on) cur.add(id); else cur.delete(id); }
    app.project.ignored = [...cur];
    saveNow(app.project);
    persistToFolder(app.project);
    app.emit({ type: 'validation' });
  };
  function isTypingTarget(e) {
    if (document.querySelector('.modal-backdrop')) return true;
    const t = e.target;
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }
  function onKeyDown(e) {
    if (isTypingTarget(e)) return;
    if (app.tool && app.tool.onKey && app.tool.onKey(e)) { e.preventDefault(); return; }
    const key = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && key.toLowerCase() === 'z') { e.preventDefault(); app.undo(); return; }
    if (mod && ((e.shiftKey && key.toLowerCase() === 'z') || key.toLowerCase() === 'y')) { e.preventDefault(); app.redo(); return; }
    if (mod && key.toLowerCase() === 'c') { e.preventDefault(); app.copy(); return; }
    if (mod && key.toLowerCase() === 'v') { e.preventDefault(); app.paste(); return; }
    if (mod) return;
    if (key === 'g' || key === 'G') { toggleGrid(); return; }
    if (key === 'h' || key === 'H') { app.canvas.flashPhoto(true); return; }
    if (key === 'Alt') { app.magnet = false; return; }
    const toolName = TOOL_KEYS[key.toLowerCase()];
    if (toolName) app.setTool(toolName);
  }
  function onKeyUp(e) {
    if (e.key === 'h' || e.key === 'H') app.canvas.flashPhoto(false);
    if (e.key === 'Alt') app.magnet = true;
  }
  function onWindowBlur() { app.magnet = true; if (app.canvas) app.canvas.flashPhoto(false); }

  function updateTopbar() {
    const nameEl = document.getElementById('project-name');
    const floorEl = document.getElementById('project-floor');
    if (nameEl) nameEl.textContent = (app.project && (app.project.name || app.project.doc.meta.building)) || 'Untitled';
    if (floorEl && app.project) floorEl.textContent = `Floor ${app.project.doc.meta.floor}`;
  }
  function updateSavedChip() {
    const chip = document.getElementById('saved-chip');
    if (!chip) return;
    let text = formatSavedAgo(lastSavedAt());
    if (app.folder && app.folder.state === 'granted') text = text.replace('Saved', 'Saved to folder');
    chip.textContent = text;
    chip.classList.remove('flash');
    // eslint-disable-next-line no-unused-expressions
    chip.offsetWidth; // force reflow so the fade-in restarts
    chip.classList.add('flash');
  }
  function hasDoorOrStair(doc) {
    return !!(doc && doc.items && doc.items.some((it) => it.type === 'door' || it.type === 'stair'));
  }
  function hasHall(doc) {
    return !!(doc && doc.items && doc.items.some((it) => it.type === 'hall'));
  }
  function updateSuggestButton() {
    const btn = document.getElementById('btn-suggest');
    if (btn) {
      const ok = hasHall(app.doc);
      btn.disabled = !ok;
      btn.title = ok ? '' : 'Finish the previous step first';
    }
    const hallsBtn = document.getElementById('btn-suggest-halls');
    if (hallsBtn) {
      const ok = hasDoorOrStair(app.doc);
      hallsBtn.disabled = !ok;
      hallsBtn.title = ok ? '' : 'Finish the previous step first';
    }
  }
  function updateExportButton() {
    const btn = document.getElementById('btn-export');
    if (!btn) return;
    const results = applyIgnores(app.doc, (app.validation || []).concat(docChecklistCodes(app.doc)), app.ignoredIds());
    const ready = checklistReady(results);
    btn.disabled = !ready;
    btn.title = ready ? '' : 'Finish the checklist first';
  }
  function updateOverlay() {
    if (app._outlinePrompt) app._outlinePrompt.update();
  }
  // where back goes: the building's floors page (or the buildings list for a project with no building)
  const buildingRoute = (project) => {
    const b = project && project.doc && project.doc.meta && project.doc.meta.building;
    return `#/b/${encodeURIComponent(b || UNNAMED)}`;
  };
  let toolBeforePan = 'select';
  function toggleHandTool() {
    const btn = document.getElementById('btn-hand-toggle');
    if (app.toolName === 'pan') {
      app.setTool(toolBeforePan || 'select');
    } else {
      toolBeforePan = app.toolName || 'select';
      app.setTool('pan');
    }
    if (btn) btn.setAttribute('aria-pressed', String(app.toolName === 'pan'));
  }
  function zoomBy(factor) {
    if (!app.canvas) return;
    const v = app.canvas.getView();
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const zoom = Math.max(0.1, Math.min(8, v.zoom * factor));
    const w = (v.w * v.zoom) / zoom;
    const h = (v.h * v.zoom) / zoom;
    app.canvas.setView({ zoom, x: cx - w / 2, y: cy - h / 2 });
    scheduleSaveView();
  }
  function wireZoomControls() {
    onStudio(document.getElementById('btn-zoom-in'), 'click', () => zoomBy(1.25));
    onStudio(document.getElementById('btn-zoom-out'), 'click', () => zoomBy(0.8));
    onStudio(document.getElementById('btn-zoom-fit'), 'click', () => {
      if (app.canvas) { app.canvas.zoomTo(true); scheduleSaveView(); }
    });
  }
  function wireViewPopover() {
    const btn = document.getElementById('btn-view');
    const pop = document.getElementById('view-popover');
    if (!btn || !pop) return;
    onStudio(btn, 'click', (e) => {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
    });
    onStudio(document, 'click', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
    });
    onStudio(document, 'keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) pop.hidden = true;
    });
    extraUnsubs.push(app.subscribe((evt) => { if (evt.type === 'tool') pop.hidden = true; }));
  }
  function setupCanvas() {
    app.canvas = createStage(document.getElementById('stage'), app);
  }
  function setupPanels() {
    paletteHandle = mountPalette(document.getElementById('palette'), app);
    propertiesHandle = mountProperties(document.getElementById('properties'), app);
    validationHandle = mountValidation(document.getElementById('validation'), app);
    suggestHandle = mountSuggest(app);
    app.suggest = suggestHandle;
    autoBuildHandle = mountAutoBuild(app); app._layers = mountLayers(app); app._attention = mountAttention(app); app._ovDot = mountOverlapDot(app); app._guide = mountFixGuide(app); app._fixAll = mountFixAll(app); app._outlineEdit = mountOutlineEdit(app); app._floors = mountFloors(app); app._photoLayer = mountPhotoLayer(app); app._outlinePrompt = mountOutlinePrompt(app);
    app.autoBuild = autoBuildHandle;
    const stripEl = document.getElementById('step-strip');
    if (stripEl) {
      stepStripHandle = mountStepStrip(stripEl, app, {
        onPhoto: () => onChangePhoto(),
        onPreview: () => { if (!app._previewHandle && !app._exportHandle) app.exportAll(); },
        onExport: () => { if (!app._previewHandle && !app._exportHandle) app.exportAll(); },
      });
    }
    studioUnsub = app.subscribe((evt) => {
      if (evt.type === 'doc') { updateUndoRedoButtons(); updateOverlay(); updateSuggestButton(); }
      if (evt.type === 'doc' || evt.type === 'validation') updateExportButton();
      if (evt.type === 'saved' || evt.type === 'view') updateSavedChip();
    });
  }
  function wireTopbar() {
    onStudio(document.getElementById('btn-undo'), 'click', () => app.undo());
    onStudio(document.getElementById('btn-redo'), 'click', () => app.redo());
    onStudio(document.getElementById('btn-photo'), 'click', onChangePhoto);
    onStudio(document.getElementById('onion'), 'input', (e) => {
      app.onion = parseFloat(e.target.value);
      app.canvas.setOnion(app.onion);
      scheduleSaveView();
    });
    onStudio(document.getElementById('plan-opacity'), 'input', (e) => {
      app.planOpacity = parseFloat(e.target.value);
      app.canvas.setPlanOpacity(app.planOpacity);
      scheduleSaveView();
    });
    onStudio(document.getElementById('btn-grid'), 'click', toggleGrid);
    onStudio(document.getElementById('btn-save-json'), 'click', () => {
      const text = exportProjectJson(app.project);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${app.project.slug || 'project'}.floorplan.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
    onStudio(document.getElementById('btn-export'), 'click', () => app.exportAll());
    onStudio(document.getElementById('btn-close'), 'click', () => {
      if (app.setRoute && app.project) app.setRoute(buildingRoute(app.project));
      else closeProject();
    });
    onStudio(document.getElementById('btn-hand-toggle'), 'click', toggleHandTool);
    onStudio(document.getElementById('btn-overlay-draw'), 'click', (e) => {
      const overlay = document.getElementById('start-overlay');
      if (overlay) {
        overlay.hidden = true;
        // Force the hide to land in the render tree before the canvas goes
        // "hot" for drawing, so the very next physical click can't be eaten
        // by a stale layout/paint of the (pointer-events:none) overlay box.
        void overlay.offsetHeight;
      }
      // A mouse click can leave the button focused; an invisible focused
      // element occasionally swallows the immediately-following pointer
      // event while the browser resolves focus, so drop it explicitly.
      if (e.currentTarget && typeof e.currentTarget.blur === 'function') e.currentTarget.blur();
      app.setTool('floor');
    });
    wireViewPopover();
    wireZoomControls();
  }

  async function onChangePhoto() {
    const hasContent = app.doc.items.length > 0 || !!app.doc.floor;
    if (hasContent && !(await app.confirm('This project already has content, so the plan size will not change. Re-straighten the photo?'))) return;
    showPhotoStepFor(app.project, app.project.photo || null);
  }
  function showReloadBar(id) {
    if (reloadBarShown) return;
    reloadBarShown = true;
    const host = document.getElementById('dialogs');
    const bar = document.createElement('div');
    bar.className = 'suggest-bar';
    bar.innerHTML = '<span>This project changed in another tab.</span><button type="button" id="reload-bar-btn">Reload</button>';
    host.appendChild(bar);
    bar.querySelector('#reload-bar-btn').addEventListener('click', async () => {
      bar.remove();
      reloadBarShown = false;
      const fresh = await loadProject(id);
      resume(id);
      if (fresh) { teardownStudio(); enterStudio(fresh); }
    });
  }
  function teardownStudio() {
    for (const [target, type, fn, opts] of studioListeners) target.removeEventListener(type, fn, opts);
    studioListeners.length = 0;
    for (const unsub of extraUnsubs) unsub();
    extraUnsubs.length = 0;
    if (app.tool && app.tool.cancel) app.tool.cancel();
    app.tool = null; app.toolName = null; app._tools = null;
    if (paletteHandle) paletteHandle.destroy();
    if (propertiesHandle) propertiesHandle.destroy();
    if (validationHandle) validationHandle.destroy();
    if (suggestHandle) suggestHandle.destroy();
    if (app._outlinePrompt) { app._outlinePrompt.destroy(); app._outlinePrompt = null; } if (app._photoLayer) { app._photoLayer.destroy(); app._photoLayer = null; } if (app._floors) { app._floors.destroy(); app._floors = null; } if (app._outlineEdit) { app._outlineEdit.destroy(); app._outlineEdit = null; } if (app._guide) { app._guide.destroy(); app._guide = null; } if (app._fixAll) { app._fixAll.destroy(); app._fixAll = null; } if (app._ovDot) { app._ovDot.destroy(); app._ovDot = null; } if (app._attention) { app._attention.destroy(); app._attention = null; } if (app._layers) { app._layers.destroy(); app._layers = null; } if (autoBuildHandle) autoBuildHandle.destroy();
    autoBuildHandle = null;
    app.autoBuild = null;
    if (stepStripHandle) stepStripHandle.destroy();
    paletteHandle = propertiesHandle = validationHandle = suggestHandle = stepStripHandle = null;
    app.suggest = null;
    if (studioUnsub) { studioUnsub(); studioUnsub = null; }
    if (app.canvas) app.canvas.destroy();
    app.canvas = null;
  }
  function enterStudio(project, opts = {}) {
    // Idempotent: a studio that is already set up (Change photo, #/p/<slug>/photo
    // then Flatten) is torn down first, so the Fabric canvas, panels and
    // window listeners are never created twice.
    if (app.canvas || studioListeners.length || paletteHandle || studioUnsub) teardownStudio();
    app.project = project;
    project.doc = mergeBigRooms(project.doc); // older projects: a big room is a room
    // Older projects placed the legend in the Preview; it's now a plan item.
    project.doc = legendFromView(project.doc, project.view);
    if (project.view && project.view.legendPos) { const { legendPos, ...rest } = project.view; void legendPos; project.view = rest; }
    app.doc = project.doc;
    app.selection = new Set();
    app.magnet = true;
    app.gridOn = project.view ? project.view.gridOn !== false : true;
    app.onion = (project.view && project.view.onion) || 0.5;
    app.planOpacity = (project.view && project.view.planOpacity) || 1;
    app.validation = [];
    app.clipboard = null;
    app.lastNumber = '';

    showScreen('studio');
    if (app.setRoute) app.setRoute(`#/p/${project.slug}/trace`);
    setupCanvas();
    setupPanels();
    wireTopbar();
    onStudio(window, 'keydown', onKeyDown);
    onStudio(window, 'keyup', onKeyUp);
    onStudio(window, 'blur', onWindowBlur);
    onStudio(window, 'pointerup', scheduleSaveView);
    // every document change is saved too (debounced), so work that arrives without a click, like an AutoBuild result, is never lost
    extraUnsubs.push(app.subscribe((e) => { if (e.type === 'doc' && app.project) { saveProject(app.project); persistToFolder(app.project); } }));

    app.canvas.setDoc(app.doc);
    app.canvas.setPhoto(project.photo);
    app.canvas.setOnion(app.onion);
    app.canvas.setGrid(app.gridOn);
    app.canvas.setPlanOpacity(app.planOpacity);
    const gridBtn = document.getElementById('btn-grid');
    if (gridBtn) gridBtn.setAttribute('aria-pressed', String(app.gridOn));
    const onionEl = document.getElementById('onion');
    if (onionEl) onionEl.value = String(app.onion);
    const opacityEl = document.getElementById('plan-opacity');
    if (opacityEl) opacityEl.value = String(app.planOpacity);

    app.canvas.zoomTo(true);
    if (!opts.freshView && project.view && typeof project.view.panX === 'number') {
      app.canvas.setView({ x: project.view.panX, y: project.view.panY });
    }

    app.setTool('select');
    scheduleValidate();
    updateTopbar();
    updateUndoRedoButtons();
    updateSavedChip();
    updateOverlay();

    updateSuggestButton();
    updateExportButton();
  }

  async function closeProject(afterHash) {
    const back = typeof afterHash === 'string' ? afterHash : '#/projects';
    if (!app.project) { showScreen('start'); if (app.setRoute) app.setRoute(back); return; }
    try { await saveNow(app.project); persistToFolder(app.project); } catch { /* ignore */ }
    teardownStudio();
    app.project = null; app.doc = null; app.selection = new Set(); app.validation = [];
    showScreen('start');
    if (app.setRoute) app.setRoute(back);
    if (deps.onClosed) deps.onClosed();
  }
  function showPhotoStepFor(project, existingPhoto) {
    showScreen('photoStep');
    if (app.setRoute) app.setRoute(`#/p/${project.slug}/photo`);
    if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
    const host = document.getElementById('photo-step-body');
    const finish = (photo, extra) => {
      const hadContent = project.doc.items.length > 0 || !!project.doc.floor;
      project.photo = photo;
      project.extraPhotos = (extra && extra.extraPhotos) || project.extraPhotos || [];
      if (!hadContent) project.doc = { ...project.doc, viewBox: { x: 0, y: 0, w: photo.width, h: photo.height } };
      if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
      enterStudio(project, { freshView: true });
      if (app.saveView) app.saveView(); // the new photo(s) are saved right away
      if (extra && extra.autoBuild && app.autoBuild) app.autoBuild.run(extra.pixels);
      if (extra && extra.autoBuildMulti && app.autoBuild) { extra.autoBuildMulti.arranged = extra.arranged; app.autoBuild.runMulti(extra.autoBuildMulti); }
    };
    photoStepHandle = mountPhotoStep(host, {
      initial: existingPhoto || undefined,
      onBackToProjects: () => { if (app.setRoute) app.setRoute(buildingRoute(project)); else closeProject(); },
      onDone: finish,
      // several photos of one floor: flatten each, then line them up side by side (Back from the first returns here)
      onMulti: (srcs, corners) => {
        if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
        photoStepHandle = mountMultiPhoto(host, { srcs, firstCorners: corners, onDone: finish, onCancel: (msg) => { showPhotoStepFor(project, existingPhoto); if (msg && app.toast) app.toast(msg); } });
      },
      onSkip: () => {
        if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
        enterStudio(project, { freshView: true });
      },
    });
  }

  async function onStartBlueprint(defaults) {
    if (app.isFolderSupported && app.isFolderSupported() && !(app.folder && app.folder.handle)) {
      await showChooseFolderModal();
    }
    const result = await showBlueprint(defaults);
    if (!result) return false;
    const meta = { building: result.building, property: result.property, floor: result.floor, slug: result.slug };
    const project = { id: crypto.randomUUID(), slug: result.slug, name: result.building, createdAt: Date.now(), savedAt: 0, doc: createDoc(meta, { x: 0, y: 0, w: 1000, h: 1000 }), photo: null, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] } };
    showPhotoStepFor(project, null);
    return true;
  }


  // ---- floors of one building: each floor is its own project; these two move between them ----
  async function saveCurrent() {
    if (!app.project) return;
    try { await saveNow(app.project); persistToFolder(app.project); } catch { /* the autosave will retry */ }
  }
  async function switchFloor(slug) {
    if (!slug || (app.project && app.project.slug === slug)) return;
    await saveCurrent();
    app.setRoute(`#/p/${slug}/trace`);
    // a floor with no photo and no outline yet starts at the photo step, like a new one
    for (let i = 0; i < 40 && !(app.project && app.project.slug === slug); i++) await new Promise((r) => setTimeout(r, 50));
    const p = app.project;
    if (p && p.slug === slug && !p.photo && !(p.doc && p.doc.floor)) app.setRoute(`#/p/${slug}/photo`);
  }
  async function startFloor(floor) {
    const cur = app.project;
    if (!cur || !app.doc) return;
    await saveCurrent();
    const { building, property } = app.doc.meta || {};
    const taken = (await listProjects()).map((p) => p.slug);
    const slug = freeSlug(slugify(building || 'unnamed', floor), taken);
    const meta = { building, property, floor, slug };
    const project = { id: crypto.randomUUID(), slug, name: cur.name || building, createdAt: Date.now(), savedAt: 0, doc: createDoc(meta, { x: 0, y: 0, w: 1000, h: 1000 }), photo: null, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] } };
    await saveNow(project);
    persistToFolder(project);
    app.setRoute(`#/p/${slug}/photo`);
  }
  app.switchFloor = switchFloor;
  app.startFloor = startFloor;

  async function onOpenProject(entry) {
    const isFolderEntry = entry && typeof entry === 'object' && entry.onDisk;
    let project = null;
    if (isFolderEntry && app.folder && app.folder.state === 'granted' && app.folder.handle) {
      try { project = await folderStore.readProject(app.folder.handle, entry.slug); } catch { /* fall through */ }
    }
    if (!project) {
      const id = entry && typeof entry === 'object' ? entry.id : entry;
      if (id) project = await loadProject(id);
    }
    if (!project) { app.toast('Could not open that project.'); return; }
    if (!project.history) project.history = { past: [], future: [] };
    enterStudio(project);
  }

  async function onImportJson(text) {
    try {
      const project = importProjectJson(text);
      await saveNow(project);
      persistToFolder(project);
      enterStudio(project, { freshView: true });
    } catch (err) {
      app.toast(err && err.message ? err.message : 'Could not import that file.');
    }
  }
  async function onImportSvg(text) {
    try {
      const { doc } = importSvg(text);
      if (!doc.meta.building) throw new Error('That file does not look like a floor plan SVG (missing header comment).');
      doc.meta = { ...doc.meta, slug: doc.meta.slug || slugify(doc.meta.building, doc.meta.floor) };
      const project = { id: crypto.randomUUID(), slug: doc.meta.slug, name: doc.meta.building, createdAt: Date.now(), savedAt: 0, doc, photo: null, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] } };
      await saveNow(project);
      persistToFolder(project);
      enterStudio(project, { freshView: true });
    } catch (err) { app.toast(err && err.message ? err.message : 'Could not import that SVG file.'); }
  }
  function onExternalChangeForProject(id) {
    if (app.project && app.project.id === id) { suspend(id); showReloadBar(id); }
  }

  // ---- hash-router support: load a project by slug (folder first, then the
  // IndexedDB store), and switch between the trace/photo/preview steps of an
  // already-open project without a reload. ----
  async function openBySlug(slug) {
    if (app.project && app.project.slug === slug) return true;
    let project = null;
    if (app.folder && app.folder.state === 'granted' && app.folder.handle) {
      try { project = await folderStore.readProject(app.folder.handle, slug); } catch { /* fall through */ }
    }
    if (!project) {
      const list = await listProjects();
      const entry = list.find((p) => p.slug === slug);
      if (entry) project = await loadProject(entry.id);
    }
    if (!project) return false;
    if (!project.history) project.history = { past: [], future: [] };
    enterStudio(project);
    return true;
  }
  function gotoTrace() {
    if (app._previewHandle) { app._previewHandle.close(); app._previewHandle = null; }
    if (app._exportHandle) { app._exportHandle.close(); app._exportHandle = null; }
    if (app.project) showScreen('studio');
    app.emit({ type: 'step' });
  }
  function gotoPhoto() {
    if (!app.project) return;
    showPhotoStepFor(app.project, app.project.photo || null);
  }
  function gotoPreview() {
    if (app._previewHandle || app._exportHandle) return;
    if (app.exportAll) app.exportAll();
  }
  function gotoExport() {
    if (app._exportHandle) return;
    if (app._previewHandle) return;
    if (app.exportAll) app.exportAll();
  }

  return {
    onStartBlueprint, onOpenProject, onImportJson, onImportSvg, closeProject, onExternalChangeForProject,
    openBySlug, gotoTrace, gotoPhoto, gotoPreview, gotoExport,
  };
}
