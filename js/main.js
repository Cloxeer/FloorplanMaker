// main.js
// App entry point: the shared `app` object documented in docs/VIEW-API.md
// (commit/undo/redo/selection/snap/subscribe) plus startup wiring. The
// heavier studio screen controller and document-editing actions live in
// js/mainActions.js so this file stays under the 400-line budget.
// Depends on: js/model/document.js, js/model/geometry.js, js/model/validate.js,
// js/store/autosave.js, js/view/panels/blueprint.js,
// js/view/panels/projects.js, js/mainActions.js.

import { STD } from './model/document.js';
import { magnetSnap } from './model/geometry.js';
import { openingCentres } from './model/connect.js';
import { validate } from './model/validate.js';
import { installAutosaveHooks, onExternalChange } from './store/autosave.js';
import { isSupported as folderIsSupported, getFolder, pickFolder as pickFolderHandle } from './store/folderStore.js';
import { mountBuildings } from './view/panels/buildingsHome.js';
import { mountBuildingPage } from './view/panels/buildingPage.js';
import { showPrompt, showConfirm, showToast } from './view/panels/blueprint.js';
import { createActions, createStudio } from './mainActions.js';

// ---------------------------------------------------------------- screens --
const screens = {
  start: document.getElementById('start'),
  building: document.getElementById('building'),
  photoStep: document.getElementById('photo-step'),
  studio: document.getElementById('studio'),
};
function showScreen(name) {
  for (const key in screens) screens[key].hidden = key !== name;
}

// ---------------------------------------------------------------- router --
// Every screen has a URL: #/projects, #/new, #/p/<slug>/photo|trace|preview.
// Navigation call sites set location.hash; this hashchange handler (also run
// once on load) is the only place that performs the actual screen switch, so
// reload and browser back/forward both work. `currentRouteHash` guards
// against re-entering a hash we've already applied.
let currentRouteHash = null;
// True while applyRoute is running: navigation triggered *by* the screen
// logic it calls (e.g. a fresh blueprint immediately showing its photo step)
// must not re-enter the router, or it'll look up a project that hasn't been
// saved yet and bounce back to #/projects. Such calls just update the URL.
let routing = false;
function setRoute(hash) {
  if (location.hash === hash) return;
  if (routing) { history.replaceState(null, '', hash); currentRouteHash = hash; return; }
  location.hash = hash;
}
async function applyRoute(studio) {
  if (!location.hash) { setRoute('#/projects'); return; }
  const hash = location.hash;
  if (hash === currentRouteHash) return;
  currentRouteHash = hash;
  routing = true;
  try {
    const m = hash.match(/^#\/p\/([^/]+)\/(photo|trace|preview|export)$/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      const ok = await studio.openBySlug(slug);
      if (!ok) {
        showToast('Could not find that project.');
        setRoute('#/projects');
        return;
      }
      if (m[2] === 'photo') studio.gotoPhoto();
      else if (m[2] === 'preview') studio.gotoPreview();
      else if (m[2] === 'export') studio.gotoExport();
      else studio.gotoTrace();
      return;
    }
    const bnew = hash.match(/^#\/b\/([^/]+)\/new$/);
    if (bnew) { // "Start blueprint" on a building page: a new floor of that building
      const name = decodeURIComponent(bnew[1]);
      if (app.project) await studio.closeProject(`#/b/${bnew[1]}`);
      showScreen('building');
      const b = await buildingPageHandle.show(name);
      const started = await studio.onStartBlueprint({ building: (b && b.building) || name, property: (b && b.property) || '' });
      if (!started) { setRoute(`#/b/${bnew[1]}`); showScreen('building'); }
      return;
    }
    const bm = hash.match(/^#\/b\/([^/]+)$/);
    if (bm) { // a building: its floors
      if (app.project) await studio.closeProject(hash);
      showScreen('building');
      await buildingPageHandle.show(decodeURIComponent(bm[1]));
      return;
    }
    if (hash === '#/new') {
      showScreen('start');
      await studio.onStartBlueprint();
      return;
    }
    if (app.project) studio.closeProject();
    else { showScreen('start'); if (projectsHandle) projectsHandle.refresh(); } // the list may be stale (a building was just created / emptied)
  } finally {
    routing = false;
  }
}

// ---------------------------------------------------------------- route worker --
const routeWorker = new Worker(new URL('./workers/route.worker.js', import.meta.url), { type: 'module' });
let routeReqId = 0;
const routeResolvers = new Map();
function routeRequest(kind, payload) {
  return new Promise((resolve, reject) => {
    const id = ++routeReqId;
    routeResolvers.set(id, { resolve, reject });
    routeWorker.postMessage({ id, kind, ...payload });
  });
}
routeWorker.addEventListener('message', (e) => {
  const { id, error, result } = e.data || {};
  const r = routeResolvers.get(id);
  if (!r) return;
  routeResolvers.delete(id);
  if (error) r.reject(new Error(error));
  else r.resolve(result);
});

// ---------------------------------------------------------------- app object --
const subscribers = [];
function emit(evt) { for (const fn of subscribers.slice()) fn(evt); }
function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

const app = {
  project: null,
  doc: null,
  selection: new Set(),
  tool: null,
  toolName: null,
  magnet: true,
  gridOn: true,
  onion: 0.5,
  canvas: null,
  validation: [],
  clipboard: null,
  lastNumber: '',
  folder: { handle: null, state: 'none' },
  isFolderSupported: folderIsSupported,
  subscribe,
  emit,
};

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) undoBtn.disabled = !(app.project && app.project.history.past.length);
  if (redoBtn) redoBtn.disabled = !(app.project && app.project.history.future.length);
}

function scheduleValidate() {
  if (!app.doc) return;
  const results = validate(app.doc);
  const routeWarnings = (app.validation || []).filter((v) => v.code === 'room-unreachable');
  app.validation = results.concat(routeWarnings);
  emit({ type: 'validation' });
}

app.commit = function commit(newDoc, label) {
  if (!app.project) return;
  app.project.history.past.push(JSON.stringify(app.doc));
  app.project.history.future = [];
  app.doc = newDoc;
  app.project.doc = newDoc;
  app.canvas.setDoc(newDoc);
  scheduleValidate();
  emit({ type: 'doc', label });
  actions.scheduleRouteValidation();
  updateUndoRedoButtons();
};
app.replaceDoc = function replaceDoc(newDoc) {
  app.doc = newDoc;
  if (app.project) app.project.doc = newDoc;
  if (app.canvas) app.canvas.setDoc(newDoc);
  scheduleValidate();
  emit({ type: 'doc' });
  actions.scheduleRouteValidation();
  updateUndoRedoButtons();
};
app.undo = function undo() {
  if (!app.project || !app.project.history.past.length) return;
  const prev = app.project.history.past.pop();
  app.project.history.future.push(JSON.stringify(app.doc));
  app.replaceDoc(JSON.parse(prev));
};
app.redo = function redo() {
  if (!app.project || !app.project.history.future.length) return;
  const next = app.project.history.future.pop();
  app.project.history.past.push(JSON.stringify(app.doc));
  app.replaceDoc(JSON.parse(next));
};
app.setSelection = function setSelection(ids) {
  const hid = app.hiddenIds ? app.hiddenIds() : null; // hidden items (the eye in Layers) are never selected
  app.selection = new Set(hid && hid.size ? [...ids].filter((id) => !hid.has(id)) : ids);
  if (app.canvas) app.canvas.setSelection([...app.selection]);
  emit({ type: 'selection' });
};
const HINT_OVERRIDES = {
  floor: 'Click each corner of the building. Press Enter or click the first corner to finish.',
  door: 'Click the outside wall for a doorway, or drag along it to size the opening. Press Esc when done.',
  room: 'Drag a box over a room on the photo.',
  select: 'Click a room to select it. Drag to move. Delete removes it.',
};
app.setTool = function setTool(name) {
  if (app.tool) app.tool.cancel();
  const t = app._tools && app._tools[name];
  if (!t) return;
  app.toolName = name;
  app.tool = t;
  emit({ type: 'tool' });
  app.setHint(HINT_OVERRIDES[name] || t.hint);
};
app.setHint = function setHint(text) {
  const el = document.getElementById('hint');
  if (el) el.textContent = text || '';
};
// Back to the current tool's own hint (after a temporary one such as "Turning the selection...").
app.resetHint = function resetHint() {
  app.setHint(HINT_OVERRIDES[app.toolName] || (app.tool && app.tool.hint) || '');
};
app.snap = function snap(pt, opts = {}) {
  if (!app.doc) return { x: pt.x, y: pt.y, guides: [] };
  const grid = app.gridOn ? STD.grid : null;
  const vertices = [];
  if (app.magnet && app.doc.floor && app.doc.floor.points) vertices.push(...app.doc.floor.points);
  if (app.magnet) vertices.push(...openingCentres(app.doc).map((o) => o.centre)); // the middle of each opening between buildings
  const targets = { xs: [], ys: [], vertices, grid };
  const result = magnetSnap(pt, opts.targets ? { ...opts.targets, grid } : targets);
  if (app.canvas) app.canvas.setGuides(result.guides);
  return result;
};
app.prompt = showPrompt;
app.confirm = showConfirm;
app.toast = showToast;
app.setRoute = setRoute;

const actions = createActions(app, { routeRequest });
app.duplicateInRow = actions.duplicateInRow;
app.copy = actions.copy;
app.paste = actions.paste;
app.routeToRoom = actions.routeToRoom;
app.exportAll = actions.exportAll;

// ---------------------------------------------------------------- folder --
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function renderFolderLine() {
  const line = document.getElementById('folder-line');
  if (!line) return;
  if (!folderIsSupported()) {
    line.textContent = 'Your browser keeps projects inside the browser; use Save to download a copy.';
    return;
  }
  const { handle, state } = app.folder;
  if (!handle) {
    line.innerHTML = 'No folder yet &mdash; <button type="button" id="folder-choose-btn" class="btn-link">Choose folder</button>';
    const btn = document.getElementById('folder-choose-btn');
    if (btn) btn.addEventListener('click', onChooseFolder);
    return;
  }
  if (state === 'granted') {
    line.innerHTML = `Folder: ${escapeHtml(handle.name)} <button type="button" id="folder-change-btn" class="btn-link">Change</button>`;
    const btn = document.getElementById('folder-change-btn');
    if (btn) btn.addEventListener('click', onChooseFolder);
  } else {
    line.innerHTML = `Folder: ${escapeHtml(handle.name)} <button type="button" id="folder-reconnect-btn" class="btn-link">Reconnect folder</button>`;
    const btn = document.getElementById('folder-reconnect-btn');
    if (btn) btn.addEventListener('click', onReconnectFolder);
  }
}
async function onChooseFolder() {
  try {
    const handle = await pickFolderHandle();
    app.folder = { handle, state: 'granted' };
  } catch { /* cancelled or unsupported */ }
  renderFolderLine();
  if (projectsHandle) projectsHandle.refresh();
}
async function onReconnectFolder() {
  app.folder = await getFolder({ request: true });
  renderFolderLine();
  if (projectsHandle) projectsHandle.refresh();
}
async function refreshFolder() {
  app.folder = await getFolder();
  renderFolderLine();
}
app.pickFolderThenContinue = onChooseFolder;

// ------------------------------------------------------------------- init --
let projectsHandle = null;
let buildingPageHandle = null;

async function init() {
  const studio = createStudio(app, {
    screens,
    showScreen,
    scheduleValidate,
    updateUndoRedoButtons,
    onClosed: () => projectsHandle && projectsHandle.refresh(),
  });
  app.openProject = studio.onOpenProject;
  app.closeProject = studio.closeProject;

  await refreshFolder();

  const enc = encodeURIComponent;
  projectsHandle = mountBuildings(document.getElementById('projects'), app, {
    onOpenBuilding: (name) => app.setRoute(`#/b/${enc(name)}`),
    onImport: studio.onImportJson,
  });
  buildingPageHandle = mountBuildingPage(app, {
    onBack: () => app.setRoute('#/projects'),
    onOpenFloor: (f) => app.setRoute(`#/p/${f.slug}/trace`),
    onStart: (b) => app.setRoute(`#/b/${enc(b.building)}/new`),
    onImport: studio.onImportJson,
    onImportSvg: studio.onImportSvg,
  });

  installAutosaveHooks(() => app.project);
  onExternalChange(({ id }) => studio.onExternalChangeForProject(id));
  setInterval(() => emit({ type: 'saved' }), 15000);

  window.addEventListener('unhandledrejection', (e) => {
    showToast(`Unexpected error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`);
  });
  window.addEventListener('error', (e) => {
    showToast(`Unexpected error: ${e.message}`);
  });

  window.addEventListener('hashchange', () => applyRoute(studio));
  await applyRoute(studio);
}

// Exposed for the browser test suite (tests/browser/perf.spec.js).
window.__app = app;

init();
