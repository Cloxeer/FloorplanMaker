// mainActions.js — kept separate from main.js to stay under 400 lines each.
// The studio screen controller (canvas/tools/panels wiring, hotkeys,
// enter/close/photo-step flow, .json/.svg import). Document-editing actions
// (duplicateInRow, copy/paste, routeToRoom, exportAll) live in js/docActions.js
// to keep this file under the line budget. main.js keeps only the `app` core
// and startup, and re-exports createActions from js/docActions.js.
// Depends on: js/model/*, js/store/autosave.js, js/view/stage.js, js/view/panels/*.js.

import { createDoc } from './model/document.js';
import { importSvg } from './model/svgImport.js';
import {
  loadProject, saveProject, saveNow, importProjectJson, exportProjectJson, suspend, resume, lastSavedAt, formatSavedAgo,
} from './store/autosave.js';
import { createStage } from './view/stage.js';
import { mountPalette } from './view/panels/palette.js';
import { mountStepStrip } from './view/panels/stepStrip.js';
import { mountProperties } from './view/panels/properties.js';
import { mountValidation } from './view/panels/validation.js';
import { showBlueprint, slugify } from './view/panels/blueprint.js';
import { mountPhotoStep } from './view/panels/photoStep.js';
import { mountSuggest } from './view/panels/suggest.js';

export { createActions } from './docActions.js';

// ---- studio screen controller ----
const TOOL_KEYS = { v: 'select', r: 'room', f: 'floor', o: 'door', a: 'hall', s: 'stair', c: 'compass' };

function hasFloor(doc) {
  return !!(doc && doc.floor && doc.floor.points && doc.floor.points.length >= 3);
}

export function createStudio(app, deps) {
  const { screens, showScreen, scheduleValidate, updateUndoRedoButtons } = deps;
  let paletteHandle = null, propertiesHandle = null, validationHandle = null, suggestHandle = null, stepStripHandle = null;
  let photoStepHandle = null, studioUnsub = null, reloadBarShown = false;
  const studioListeners = [];
  const extraUnsubs = [];
  function onStudio(target, type, fn, opts) { target.addEventListener(type, fn, opts); studioListeners.push([target, type, fn, opts]); }

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
    app.project.view = { zoom: app.doc.viewBox.w / (v.w || 1), panX: v.x, panY: v.y, onion: app.onion, gridOn: app.gridOn, planOpacity: app.planOpacity };
    saveProject(app.project);
    app.emit({ type: 'view' });
  }
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
    chip.textContent = formatSavedAgo(lastSavedAt());
    chip.classList.remove('flash');
    // eslint-disable-next-line no-unused-expressions
    chip.offsetWidth; // force reflow so the fade-in restarts
    chip.classList.add('flash');
  }
  function updateSuggestButton() {
    const btn = document.getElementById('btn-suggest');
    if (!btn) return;
    const ok = hasFloor(app.doc);
    btn.disabled = !ok;
    btn.title = ok ? '' : 'Draw the outline first';
  }
  function updateOverlay() {
    const overlay = document.getElementById('start-overlay');
    if (!overlay) return;
    const hasFloor = !!(app.doc && app.doc.floor && app.doc.floor.points && app.doc.floor.points.length >= 3);
    overlay.hidden = hasFloor;
  }
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
    const stripEl = document.getElementById('step-strip');
    if (stripEl) {
      stepStripHandle = mountStepStrip(stripEl, app, {
        onPhoto: () => onChangePhoto(),
        onExport: () => app.exportAll(),
      });
    }
    studioUnsub = app.subscribe((evt) => {
      if (evt.type === 'doc') { updateUndoRedoButtons(); updateOverlay(); updateSuggestButton(); }
      if (evt.type === 'saved' || evt.type === 'view') updateSavedChip();
    });
  }
  function wireTopbar() {
    onStudio(document.getElementById('btn-undo'), 'click', () => app.undo());
    onStudio(document.getElementById('btn-redo'), 'click', () => app.redo());
    onStudio(document.getElementById('btn-suggest'), 'click', () => suggestHandle && suggestHandle.run());
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
    onStudio(document.getElementById('btn-close'), 'click', () => closeProject());
    onStudio(document.getElementById('btn-hand-toggle'), 'click', toggleHandTool);
    onStudio(document.getElementById('btn-overlay-draw'), 'click', () => {
      const overlay = document.getElementById('start-overlay');
      if (overlay) overlay.hidden = true;
      app.setTool('floor');
    });
    wireViewPopover();
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
    if (stepStripHandle) stepStripHandle.destroy();
    paletteHandle = propertiesHandle = validationHandle = suggestHandle = stepStripHandle = null;
    if (studioUnsub) { studioUnsub(); studioUnsub = null; }
    if (app.canvas) app.canvas.destroy();
    app.canvas = null;
  }
  function enterStudio(project, opts = {}) {
    app.project = project;
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
    setupCanvas();
    setupPanels();
    wireTopbar();
    onStudio(window, 'keydown', onKeyDown);
    onStudio(window, 'keyup', onKeyUp);
    onStudio(window, 'blur', onWindowBlur);
    onStudio(window, 'pointerup', scheduleSaveView);

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
    if (opts.autoSuggest && suggestHandle) {
      // Room detection only makes sense once the building outline exists, so
      // wait for the first floor commit instead of running straight away.
      if (hasFloor(app.doc)) suggestHandle.run();
      else {
        const stop = app.subscribe((evt) => {
          if (evt.type === 'doc' && hasFloor(app.doc)) { stop(); if (suggestHandle) suggestHandle.run(); }
        });
        extraUnsubs.push(stop);
      }
    }
  }

  async function closeProject() {
    if (!app.project) { showScreen('start'); return; }
    try { await saveNow(app.project); } catch { /* ignore */ }
    teardownStudio();
    app.project = null; app.doc = null; app.selection = new Set(); app.validation = [];
    showScreen('start');
    if (deps.onClosed) deps.onClosed();
  }
  function showPhotoStepFor(project, existingPhoto) {
    showScreen('photoStep');
    if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
    photoStepHandle = mountPhotoStep(document.getElementById('photo-step-body'), {
      initial: existingPhoto || undefined,
      onDone: (photo) => {
        const hadContent = project.doc.items.length > 0 || !!project.doc.floor;
        project.photo = photo;
        if (!hadContent) project.doc = { ...project.doc, viewBox: { x: 0, y: 0, w: photo.width, h: photo.height } };
        if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
        const hasRooms = project.doc.items.some((it) => it.type === 'room');
        enterStudio(project, { freshView: true, autoSuggest: !hasRooms });
      },
      onSkip: () => {
        if (photoStepHandle) { photoStepHandle.destroy(); photoStepHandle = null; }
        enterStudio(project, { freshView: true });
      },
    });
  }

  async function onStartBlueprint() {
    const result = await showBlueprint();
    if (!result) return;
    const meta = { building: result.building, property: result.property, floor: result.floor, slug: result.slug };
    const project = { id: crypto.randomUUID(), slug: result.slug, name: result.building, createdAt: Date.now(), savedAt: 0, doc: createDoc(meta, { x: 0, y: 0, w: 1000, h: 1000 }), photo: null, view: { zoom: 1, panX: 0, panY: 0, onion: 0.5 }, history: { past: [], future: [] } };
    showPhotoStepFor(project, null);
  }

  async function onOpenProject(id) {
    const project = await loadProject(id);
    if (!project) { app.toast('Could not open that project.'); return; }
    if (!project.history) project.history = { past: [], future: [] };
    enterStudio(project);
  }

  async function onImportJson(text) {
    try {
      const project = importProjectJson(text);
      await saveNow(project);
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
      enterStudio(project, { freshView: true });
    } catch (err) { app.toast(err && err.message ? err.message : 'Could not import that SVG file.'); }
  }
  function onExternalChangeForProject(id) {
    if (app.project && app.project.id === id) { suspend(id); showReloadBar(id); }
  }

  return { onStartBlueprint, onOpenProject, onImportJson, onImportSvg, closeProject, onExternalChangeForProject };
}
