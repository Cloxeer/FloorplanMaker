// docActions.js — split out of mainActions.js to stay under the 400-line
// budget. Document-editing actions attached to `app`: duplicateInRow,
// copy/paste, routeToRoom, exportAll, debounced room-unreachable check.
// Depends on: js/model/document.js, js/model/geometry.js, js/model/validate.js,
// js/model/svgExport.js, js/view/panels/exportDialog.js.

import { getItem, addItem, newId, nextNumber } from './model/document.js';
import { bbox } from './model/geometry.js';
import { validate } from './model/validate.js';
import { exportSvg } from './model/svgExport.js';
import { showExportStep } from './view/panels/exportDialog.js';
import { showPreviewStep } from './view/panels/previewStep.js';
import { exportProjectJson } from './store/autosave.js';
import { legendSvgGroupAt, legendGroupSize } from './view/panels/legend.js';

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
    // Staff walls (authwall) are studio-only guides: saved in the .json project
    // but never drawn in the exported SVG. Hallways ARE drawn in the SVG (grey
    // corridors, as they appear in trace); the parsers ignore the "hall" class.
    const doc = {
      ...app.doc,
      items: app.doc.items.filter((it) => it.type !== 'authwall'),
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
    const halls = app.doc.items.filter((it) => it.type === 'hall');
    const rooms = doc.items.filter((it) => it.type === 'room');
    let legendPos = (app.project && app.project.view && app.project.view.legendPos) || null;
    const projectJson = app.project ? exportProjectJson(app.project) : null;
    const projectName = app.project ? `${app.project.slug}.floorplan.json` : 'plan.floorplan.json';

    // Splice the legend group in and grow the root viewBox so it isn't clipped.
    function withLegend(text, pos) {
      const g = legendGroupSize();
      const sc = pos.scale && Number.isFinite(pos.scale) ? pos.scale : 1;
      let out = text.replace('</svg>', `${legendSvgGroupAt(pos.x, pos.y, sc)}</svg>`);
      out = out.replace(/viewBox="(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)"/,
        (m, x, y, w, h) => {
          const vx = Number(x); const vy = Number(y); const vw = Number(w); const vh = Number(h);
          const minX = Math.min(vx, pos.x - 20);
          const minY = Math.min(vy, pos.y - 20);
          const maxX = Math.max(vx + vw, pos.x + g.w * sc + 20);
          const maxY = Math.max(vy + vh, pos.y + g.h * sc + 20);
          return `viewBox="${Math.round(minX)} ${Math.round(minY)} ${Math.round(maxX - minX)} ${Math.round(maxY - minY)}"`;
        });
      return out;
    }

    function closePreview() { if (app._previewHandle) { app._previewHandle.close(); app._previewHandle = null; } }
    function closeExport() { if (app._exportHandle) { app._exportHandle.close(); app._exportHandle = null; } }

    function openPreview() {
      closeExport();
      if (app.setRoute && app.project) app.setRoute(`#/p/${app.project.slug}/preview`);
      app._previewHandle = showPreviewStep({
        svgText, validation: results, halls, rooms, initialLegendPos: legendPos,
      }, {
        onBack: () => {
          app._previewHandle = null;
          if (app.setRoute && app.project) app.setRoute(`#/p/${app.project.slug}/trace`);
        },
        onSaveLegend: (pos) => {
          legendPos = pos;
          if (app.project) {
            app.project.view = app.project.view || {};
            app.project.view.legendPos = pos;
            if (app.saveView) app.saveView();
          }
        },
        onExport: (pos) => {
          legendPos = pos != null ? pos : legendPos;
          closePreview();
          openExport();
        },
      });
      app.emit({ type: 'step' });
    }
    function openExport() {
      if (app.setRoute && app.project) app.setRoute(`#/p/${app.project.slug}/export`);
      const finalSvg = legendPos ? withLegend(svgText, legendPos) : svgText;
      const folderApi = {
        supported: !!(app.isFolderSupported && app.isFolderSupported()),
        getHandle: () => ((app.folder && app.folder.state === 'granted' && app.folder.handle) ? app.folder.handle : null),
        pick: async () => {
          if (app.pickFolderThenContinue) await app.pickFolderThenContinue();
          return (app.folder && app.folder.handle) ? app.folder.handle : null;
        },
      };
      app._exportHandle = showExportStep({ svgText: finalSvg, jpgDataUrl, meta: doc.meta, projectJson, projectName, folderApi }, {
        onBack: () => {
          app._exportHandle = null;
          openPreview();
        },
      });
      app.emit({ type: 'step' });
    }

    openPreview();
  }

  return { duplicateInRow, copy, paste, routeToRoom, exportAll, scheduleRouteValidation };
}
