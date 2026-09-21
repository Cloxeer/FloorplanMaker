// mainActions.js — kept separate from main.js to stay under 400 lines each.
// Document-editing actions attached to `app` (duplicateInRow, copy/paste, routeToRoom, exportAll,
// debounced room-unreachable check) AND the studio screen controller (canvas/tools/panels wiring,
// hotkeys, enter/close/photo-step flow, .json/.svg import). main.js keeps only the `app` core and startup.
// Depends on: js/model/*, js/store/autosave.js, js/view/canvas.js, js/view/tools/*.js, js/view/panels/*.js.

import { getItem, addItem, newId, nextNumber, createDoc } from './model/document.js';
import { bbox } from './model/geometry.js';
import { validate } from './model/validate.js';
import { exportSvg } from './model/svgExport.js';
import { importSvg } from './model/svgImport.js';
import {
  loadProject, saveProject, saveNow, importProjectJson, exportProjectJson, suspend, resume, lastSavedAt, formatSavedAgo,
} from './store/autosave.js';
import { createCanvas } from './view/canvas.js';
import { createSelectTool } from './view/tools/select.js';
import { createRoomTool } from './view/tools/room.js';
import { createFloorTool } from './view/tools/floor.js';
import { createDoorTool } from './view/tools/door.js';
import { createStairTool } from './view/tools/stair.js';
import { createCompassTool } from './view/tools/compass.js';
import { createPanTool } from './view/tools/pan.js';
import { mountPalette } from './view/panels/palette.js';
import { mountProperties } from './view/panels/properties.js';
import { mountValidation } from './view/panels/validation.js';
import { showExportDialog } from './view/panels/exportDialog.js';
import { showBlueprint, slugify } from './view/panels/blueprint.js';
import { mountPhotoStep } from './view/panels/photoStep.js';
import { mountSuggest } from './view/panels/suggest.js';

function boxOfItem(item) {
  if (item.shape === 'poly') return bbox(item.points);
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}
function cloneItemAt(item, dx, dy) {
  const clone = JSON.parse(JSON.stringify(item));
  clone.id = newId();
  if (clone.shape === 'poly') clone.points = clone.points.map(([x, y]) => [x + dx, y + dy]);
  else if (typeof clone.x === 'number') { clone.x += dx; clone.y += dy; }
  if (clone.label) clone.label = { pinned: false, x: null, y: null, fontSize: clone.label.fontSize || null };
  return clone;
}

// ---- document-editing actions ----
export function createActions(app, deps) {
  const { routeRequest } = deps;
  let routeAllTimer = null;

  function duplicateInRow(id) {
    const item = getItem(app.doc, id);
    if (!item || item.type !== 'room') return;
    const box = boxOfItem(item);
    const limit = app.doc.floor ? bbox(app.doc.floor.points) : app.doc.viewBox;
    let newX = box.x + box.w;
    let newY = box.y;
    if (newX + box.w > limit.x + limit.w) { newX = box.x; newY = box.y + box.h; }
    const clone = cloneItemAt(item, newX - box.x, newY - box.y);
    app.prompt('Room number', nextNumber(item.number || '')).then((value) => {
      if (value == null) return;
      clone.number = value;
      app.commit(addItem(app.doc, clone), 'Duplicate');
      app.lastNumber = value;
    });
  }
  function copy() {
    const items = [...app.selection].filter((id) => id !== 'floor').map((id) => getItem(app.doc, id)).filter(Boolean);
    if (items.length) app.clipboard = items.map((it) => JSON.parse(JSON.stringify(it)));
  }

  async function paste() {
    if (!app.clipboard || !app.clipboard.length) return;
    const clones = app.clipboard.map((it) => cloneItemAt(it, 20, 20));
    const hasNumbers = clones.some((it) => it.type === 'room' && it.number);
    if (hasNumbers && await app.confirm('Auto-increment room numbers?')) {
      let n = null;
      for (const it of clones) {
        if (it.type !== 'room' || !it.number) continue;
        n = n ? nextNumber(n) : it.number;
        it.number = n;
      }
    }
    let doc = app.doc;
    for (const it of clones) doc = addItem(doc, it);
    app.commit(doc, 'Paste');
    app.setSelection(clones.map((it) => it.id));
  }

  async function routeToRoom(id) {
    try {
      const result = await routeRequest('route', { doc: app.doc, roomId: id, cell: 10 });
      app.canvas.setRoutePath(result.path || []);
      app.emit({ type: 'route', roomId: id, reachable: result.reachable, path: result.path });
    } catch { app.toast('Route preview failed.'); }
  }
  function scheduleRouteValidation() {
    if (routeAllTimer) clearTimeout(routeAllTimer);
    routeAllTimer = setTimeout(async () => {
      routeAllTimer = null;
      const doc = app.doc;
      try {
        const result = await routeRequest('all', { doc, cell: 10 });
        if (app.doc !== doc) return;
        const base = (app.validation || []).filter((v) => v.code !== 'room-unreachable');
        const extra = [];
        for (const room of doc.items) {
          if (room.type !== 'room' || room.cls === 'void') continue;
          if (result[room.id] === false) {
            extra.push({ level: 'warning', code: 'room-unreachable', message: `Room ${room.number || room.id} is not reachable from an entrance.`, itemId: room.id });
          }
        }
        app.validation = base.concat(extra);
        app.emit({ type: 'validation' });
      } catch { /* leave validation as-is */ }
    }, 400);
  }
  function exportAll() {
    const results = validate(app.doc);
    app.validation = results;
    app.emit({ type: 'validation' });
    if (results.some((r) => r.level === 'error')) {
      app.toast('Fix the errors listed in Validation before exporting.');
      return;
    }
    const svgText = exportSvg(app.doc);
    const jpgDataUrl = app.project && app.project.photo ? app.project.photo.dataUrl : null;
    showExportDialog({ svgText, jpgDataUrl, meta: app.doc.meta });
  }

  return { duplicateInRow, copy, paste, routeToRoom, exportAll, scheduleRouteValidation };
}

// ---- studio screen controller ----
const TOOL_KEYS = { v: 'select', r: 'room', p: 'poly', f: 'floor', o: 'door', s: 'stair', c: 'compass' };

export function createStudio(app, deps) {
  const { screens, showScreen, scheduleValidate, updateUndoRedoButtons } = deps;
  let tools = null;
  let paletteHandle = null, propertiesHandle = null, validationHandle = null, suggestHandle = null;
  let photoStepHandle = null, studioUnsub = null, reloadBarShown = false;
  const studioListeners = [];
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
    app.project.view = { zoom: app.doc.viewBox.w / (v.w || 1), panX: v.x, panY: v.y, onion: app.onion, gridOn: app.gridOn };
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
    if (chip) chip.textContent = formatSavedAgo(lastSavedAt());
  }
  function setupCanvas() {
    const svgEl = document.getElementById('canvas');
    app.canvas = createCanvas(svgEl, app);
    app.canvas.onPointer((kind, e, pt) => {
      if (kind === 'down') {
        const hit = app.canvas.hitTest(e.clientX, e.clientY);
        if (hit && hit.part && hit.part.startsWith('ghost:')) {
          const idx = parseInt(hit.part.split(':')[1], 10);
          window.dispatchEvent(new CustomEvent('ghost-accept', { detail: { index: idx } }));
          return;
        }
        if (app.tool) app.tool.onDown(e, pt);
      } else if (kind === 'move') { if (app.tool) app.tool.onMove(e, pt); }
      else if (kind === 'up') { if (app.tool) app.tool.onUp(e, pt); }
      else if (kind === 'cancel') { if (app.tool) app.tool.cancel(); }
    });
    onStudio(svgEl, 'dblclick', (e) => {
      const pt = app.canvas.toPlan(e.clientX, e.clientY);
      if (app.tool && app.tool.onDoubleClick) app.tool.onDoubleClick(e, pt);
    });
  }
  function setupTools() {
    tools = {
      select: createSelectTool(app), room: createRoomTool(app), poly: createRoomTool(app, { poly: true }),
      floor: createFloorTool(app), door: createDoorTool(app), stair: createStairTool(app),
      compass: createCompassTool(app), pan: createPanTool(app),
    };
    app._tools = tools;
  }
  function setupPanels() {
    paletteHandle = mountPalette(document.getElementById('palette'), app);
    propertiesHandle = mountProperties(document.getElementById('properties'), app);
    validationHandle = mountValidation(document.getElementById('validation'), app);
    suggestHandle = mountSuggest(app);
    studioUnsub = app.subscribe((evt) => {
      if (evt.type === 'doc') updateUndoRedoButtons();
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
    if (app.tool) app.tool.cancel();
    if (tools) for (const t of Object.values(tools)) t.cancel && t.cancel();
    tools = null; app.tool = null; app.toolName = null;
    if (paletteHandle) paletteHandle.destroy();
    if (propertiesHandle) propertiesHandle.destroy();
    if (validationHandle) validationHandle.destroy();
    if (suggestHandle) suggestHandle.destroy();
    paletteHandle = propertiesHandle = validationHandle = suggestHandle = null;
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
    app.validation = [];
    app.clipboard = null;
    app.lastNumber = '';

    showScreen('studio');
    setupCanvas();
    setupTools();
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
    const gridBtn = document.getElementById('btn-grid');
    if (gridBtn) gridBtn.setAttribute('aria-pressed', String(app.gridOn));
    const onionEl = document.getElementById('onion');
    if (onionEl) onionEl.value = String(app.onion);

    app.canvas.zoomTo(true);
    if (!opts.freshView && project.view && typeof project.view.panX === 'number') {
      app.canvas.setView({ x: project.view.panX, y: project.view.panY });
    }

    app.setTool('select');
    scheduleValidate();
    updateTopbar();
    updateUndoRedoButtons();
    updateSavedChip();
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
        enterStudio(project, { freshView: true });
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
