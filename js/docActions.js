// docActions.js — split out of mainActions.js to stay under the 400-line
// budget. Document-editing actions attached to `app`: duplicateInRow,
// copy/paste, routeToRoom, exportAll, debounced room-unreachable check.
// Depends on: js/model/document.js, js/model/geometry.js, js/model/validate.js,
// js/model/svgExport.js, js/view/panels/exportDialog.js.

import { getItem, addItem, newId, nextNumber } from './model/document.js';
import { bbox } from './model/geometry.js';
import { validate } from './model/validate.js';
import { exportSvg, exportFileNames } from './model/svgExport.js';
import { showExportDialog } from './view/panels/exportDialog.js';
import { showPreviewStep } from './view/panels/previewStep.js';
import { legendSvgGroupAt } from './view/panels/legend.js';

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
    app.prompt('Room number', nextNumber(item.number || ''), { validate: 'roomNumber' }).then((value) => {
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
    // Hallways and staff walls are studio-only guides: they are saved in the
    // .json project but never reach the exported SVG.
    const doc = {
      ...app.doc,
      items: app.doc.items.filter((it) => it.type !== 'hall' && it.type !== 'authwall'),
    };
    const results = validate(doc);
    app.validation = results;
    app.emit({ type: 'validation' });
    if (results.some((r) => r.level === 'error')) {
      app.toast('Fix the errors listed in Validation before exporting.');
      return;
    }
    const svgText = exportSvg(doc);
    const jpgDataUrl = app.project && app.project.photo ? app.project.photo.dataUrl : null;
    const names = exportFileNames(doc.meta);
    const svgName = names.svg.split('/').pop();
    const jpgName = names.jpg.split('/').pop();
    if (app.setRoute && app.project) app.setRoute(`#/p/${app.project.slug}/preview`);
    const halls = app.doc.items.filter((it) => it.type === 'hall');
    const rooms = doc.items.filter((it) => it.type === 'room');
    app._previewHandle = showPreviewStep({
      svgText, validation: results, twoFiles: !!jpgDataUrl, svgName, jpgName, halls, rooms,
    }, {
      onBack: () => {
        app._previewHandle = null;
        if (app.setRoute && app.project) app.setRoute(`#/p/${app.project.slug}/trace`);
      },
      onDownload: (legendPos) => {
        const finalSvg = legendPos
          ? svgText.replace('</svg>', `${legendSvgGroupAt(legendPos.x, legendPos.y)}</svg>`)
          : svgText;
        showExportDialog({ svgText: finalSvg, jpgDataUrl, meta: doc.meta });
      },
    });
  }

  return { duplicateInRow, copy, paste, routeToRoom, exportAll, scheduleRouteValidation };
}
