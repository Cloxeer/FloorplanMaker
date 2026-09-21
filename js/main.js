// main.js
// App entry point: the shared `app` object documented in docs/VIEW-API.md
// (commit/undo/redo/selection/snap/subscribe) plus startup wiring. The
// heavier studio screen controller and document-editing actions live in
// js/mainActions.js so this file stays under the 400-line budget.
// Depends on: js/model/document.js, js/model/geometry.js, js/model/validate.js,
// js/store/autosave.js, js/view/tools/common.js, js/view/panels/blueprint.js,
// js/view/panels/projects.js, js/mainActions.js.

import { STD } from './model/document.js';
import { magnetSnap } from './model/geometry.js';
import { validate } from './model/validate.js';
import { installAutosaveHooks, onExternalChange } from './store/autosave.js';
import { collectSnapTargets } from './view/tools/common.js';
import { mountProjects } from './view/panels/projects.js';
import { showPrompt, showConfirm, showToast } from './view/panels/blueprint.js';
import { createActions, createStudio } from './mainActions.js';

// ---------------------------------------------------------------- screens --
const screens = {
  start: document.getElementById('start'),
  photoStep: document.getElementById('photo-step'),
  studio: document.getElementById('studio'),
};
function showScreen(name) {
  for (const key in screens) screens[key].hidden = key !== name;
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
  emit({ type: 'doc', label });
  actions.scheduleRouteValidation();
  scheduleValidate();
  updateUndoRedoButtons();
};
app.replaceDoc = function replaceDoc(newDoc) {
  app.doc = newDoc;
  if (app.project) app.project.doc = newDoc;
  if (app.canvas) app.canvas.setDoc(newDoc);
  emit({ type: 'doc' });
  actions.scheduleRouteValidation();
  scheduleValidate();
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
  app.selection = new Set(ids);
  if (app.canvas) app.canvas.setSelection([...app.selection]);
  emit({ type: 'selection' });
};
const HINT_OVERRIDES = {
  floor: 'Click each corner of the building. Press Enter or click the first corner to finish.',
  door: 'Click on the outside wall where a door is. Press Esc when done.',
  room: 'Drag a box over a room on the photo.',
  select: 'Click a room to select it. Drag to move. Delete removes it.',
};
const DRAW_TOOLS = new Set(['room', 'poly', 'floor', 'door', 'stair', 'compass']);
app.setTool = function setTool(name) {
  if (app.tool) app.tool.cancel();
  const t = app._tools && app._tools[name];
  if (!t) return;
  app.toolName = name;
  app.tool = t;
  emit({ type: 'tool' });
  app.setHint(HINT_OVERRIDES[name] || t.hint);
  const svgEl = document.getElementById('canvas');
  if (svgEl) svgEl.style.cursor = DRAW_TOOLS.has(name) ? 'crosshair' : 'default';
};
app.setHint = function setHint(text) {
  const el = document.getElementById('hint');
  if (el) el.textContent = text || '';
};
app.snap = function snap(pt, opts = {}) {
  if (!app.doc) return { x: pt.x, y: pt.y, guides: [] };
  const grid = app.gridOn ? STD.grid : null;
  if (!app.magnet && !grid) {
    if (app.canvas) app.canvas.setGuides([]);
    return { x: pt.x, y: pt.y, guides: [] };
  }
  let targets = opts.targets || collectSnapTargets(app.doc, opts.ignoreIds, opts.box);
  if (!app.magnet) targets = { xs: [], ys: [], vertices: [] };
  targets = { ...targets, grid };
  const result = magnetSnap(pt, targets);
  if (app.canvas) app.canvas.setGuides(result.guides);
  return result;
};
app.prompt = showPrompt;
app.confirm = showConfirm;
app.toast = showToast;

const actions = createActions(app, { routeRequest });
app.duplicateInRow = actions.duplicateInRow;
app.copy = actions.copy;
app.paste = actions.paste;
app.routeToRoom = actions.routeToRoom;
app.exportAll = actions.exportAll;

// ------------------------------------------------------------------- init --
let projectsHandle = null;

function init() {
  const studio = createStudio(app, {
    screens,
    showScreen,
    scheduleValidate,
    updateUndoRedoButtons,
    onClosed: () => projectsHandle && projectsHandle.refresh(),
  });
  app.openProject = studio.onOpenProject;
  app.closeProject = studio.closeProject;

  projectsHandle = mountProjects(document.getElementById('projects'), app, {
    onStart: studio.onStartBlueprint,
    onOpen: studio.onOpenProject,
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

  showScreen('start');
}

init();
