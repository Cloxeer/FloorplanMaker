// stageTools.js
// Drawing tools for the Fabric stage: floor outline, doors, hallways, rooms,
// stairs and the compass, plus palette drops (stage.dropPiece). Each tool is a
// small state machine driven by Fabric's own mouse events; only the live
// preview is drawn here — everything else goes through app.commit.
// Depends on: fabric@6.7.1, js/model/document.js, js/model/geometry.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import {
  STD, newId, addItem, setFloor, makeRoom, doorFor, NUMBERED_CLASSES,
} from '../model/document.js';
import { snapToGrid, dist } from '../model/geometry.js';

const DOOR_REACH = 12;
const MIN_BOX = 10;
const CORNER_RADIUS = 8; // screen px, scaled by 1/zoom
const CLOSE_REACH = 12; // screen px

const HINTS = {
  select: 'Click a room to select it. Drag to move. Delete removes it.',
  floor: 'Click each corner of the building. Press Enter or click the first corner to finish.',
  door: 'Click on the outside wall where a door is. Press Esc when done.',
  hall: 'Drag a box along the hallway. Press Esc when done.',
  room: 'Drag a box over a room on the photo.',
  poly: 'Drag a box over a room on the photo.',
  stair: 'Drag a box over the stairwell.',
  compass: 'Click where the compass should sit.',
  pan: 'Drag to move around the plan.',
};

export function attachTools(ctx, editing) {
  const { canvas, app, render, toPlan, getDoc } = ctx;
  let draft = null; // { kind, points?, start?, objs:[] }

  function snapPt(p, e) {
    if (e && e.altKey) return { x: Math.round(p.x), y: Math.round(p.y) };
    const g = app.gridOn ? STD.grid : null;
    return g ? { x: snapToGrid(p.x, g), y: snapToGrid(p.y, g) } : { x: Math.round(p.x), y: Math.round(p.y) };
  }
  function addPreview(obj) {
    obj.set({ selectable: false, evented: false, objectCaching: false });
    obj.zLayer = 9;
    obj.overlay = true;
    canvas.add(obj);
    draft.objs.push(obj);
    return obj;
  }
  function clearDraft() {
    if (!draft) return;
    for (const o of draft.objs) canvas.remove(o);
    draft = null;
    render();
  }

  // ------------------------------------------------------- floor outline --
  function floorPreview() {
    const pts = draft.points.concat(draft.hover ? [draft.hover] : []);
    if (!draft.line) {
      draft.line = addPreview(new fabric.Polyline(pts.map(([x, y]) => ({ x, y })), {
        stroke: '#2f6feb', strokeWidth: 3, strokeUniform: true, fill: 'rgba(47,111,235,0.08)',
      }));
    } else {
      draft.line.points = pts.map(([x, y]) => new fabric.Point(x, y));
      draft.line.setBoundingBox(true);
      draft.line.setCoords();
    }
    if (draft.points.length >= 1) {
      const zoom = canvas.getZoom() || 1;
      const r = CORNER_RADIUS / zoom;
      const [fx, fy] = draft.points[0];
      const near = draft.points.length >= 3 && draft.hover
        && dist(draft.hover, draft.points[0]) * zoom <= CLOSE_REACH;
      draft.canClose = !!near;
      const color = near ? '#2ecc71' : '#2f6feb';
      if (!draft.ring) {
        draft.ring = addPreview(new fabric.Circle({
          left: fx, top: fy, originX: 'center', originY: 'center', radius: r,
          fill: 'transparent', stroke: color, strokeWidth: 2 / zoom,
        }));
      } else {
        draft.ring.set({ left: fx, top: fy, radius: r, stroke: color, strokeWidth: 2 / zoom });
        draft.ring.setCoords();
      }
    }
    render();
  }
  function closeFloor() {
    if (!draft || draft.kind !== 'floor' || draft.points.length < 3) return;
    const pts = draft.points.map(([x, y]) => [Math.round(x), Math.round(y)]);
    clearDraft();
    app.commit(setFloor(app.doc, pts), 'Draw outline');
    app.setTool('select');
  }

  // ------------------------------------------------------------ box draw --
  function boxPreview(fill, stroke) {
    if (!draft.rect) {
      draft.rect = addPreview(new fabric.Rect({
        left: draft.start.x, top: draft.start.y, width: 1, height: 1,
        fill, stroke, strokeWidth: 2, strokeUniform: true, strokeDashArray: [6, 4],
      }));
    }
    const b = draft.box;
    draft.rect.set({ left: b.x, top: b.y, width: Math.max(1, b.w), height: Math.max(1, b.h) });
    draft.rect.setCoords();
    render();
  }
  function boxOf(a, b) {
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
    };
  }

  async function finishBox(kind, box) {
    if (kind === 'hall') {
      const item = { id: newId(), type: 'hall', x: box.x, y: box.y, w: box.w, h: box.h };
      app.commit(addItem(app.doc, item), 'Draw hallway');
      return;
    }
    if (kind === 'stair') {
      const item = { id: newId(), type: 'stair', x: box.x, y: box.y, w: box.w, h: box.h, dir: 'v' };
      app.commit(addItem(app.doc, item), 'Draw stairs');
      return;
    }
    const value = await app.prompt('Room number', '', { validate: 'roomNumber' });
    if (value == null) return;
    app.commit(addItem(app.doc, makeRoom('room', box.x, box.y, box.w, box.h, value)), 'Draw room');
    app.lastNumber = value;
  }

  // --------------------------------------------------------------- doors --
  function placeDoor(pt) {
    const doc = app.doc;
    const outline = doc.floor && doc.floor.points;
    if (!outline || outline.length < 3) {
      app.toast('Draw the building outline first.');
      return;
    }
    const door = doorFor(outline, pt);
    if (!door) return;
    const mid = { x: (door.x1 + door.x2) / 2, y: (door.y1 + door.y2) / 2 };
    if (dist([mid.x, mid.y], [pt.x, pt.y]) > DOOR_REACH * 4) return;
    app.commit(addItem(doc, { id: newId(), type: 'door', ...door, kind: 'EXIT' }), 'Place door');
  }

  // ------------------------------------------------------- mouse plumbing --
  function drawing() {
    const n = app.toolName;
    return n && n !== 'select' && n !== 'pan' && !ctx.isPanning();
  }

  canvas.on('mouse:down', (opt) => {
    if (!drawing() || !opt.e || opt.e.button === 1) return;
    const tool = app.toolName;
    const pt = snapPt(toPlan(opt.e.clientX, opt.e.clientY), opt.e);
    if (tool === 'floor') {
      if (!draft || draft.kind !== 'floor') draft = { kind: 'floor', points: [], objs: [] };
      const zoom = canvas.getZoom() || 1;
      if (draft.points.length >= 3 && dist([pt.x, pt.y], draft.points[0]) * zoom <= CLOSE_REACH) {
        closeFloor();
        return;
      }
      draft.points.push([pt.x, pt.y]);
      floorPreview();
      return;
    }
    if (tool === 'door') { placeDoor(pt); return; }
    if (tool === 'compass') {
      const doc = app.doc;
      const items = doc.items.filter((it) => it.type !== 'compass');
      app.commit({ ...doc, items: [...items, { id: newId(), type: 'compass', x: pt.x, y: pt.y, deg: 0 }] }, 'Place compass');
      app.setTool('select');
      return;
    }
    draft = { kind: tool, start: pt, box: { x: pt.x, y: pt.y, w: 0, h: 0 }, objs: [] };
  });

  canvas.on('mouse:move', (opt) => {
    if (!draft || !opt.e) return;
    const pt = snapPt(toPlan(opt.e.clientX, opt.e.clientY), opt.e);
    if (draft.kind === 'floor') {
      draft.hover = [pt.x, pt.y];
      floorPreview();
      return;
    }
    draft.box = boxOf(draft.start, pt);
    if (draft.kind === 'hall') boxPreview('rgba(120,176,224,0.22)', '#5b9bd5');
    else boxPreview('rgba(47,111,235,0.10)', '#2f6feb');
  });

  canvas.on('mouse:dblclick', () => {
    if (draft && draft.kind === 'floor' && draft.points.length >= 3) closeFloor();
  });

  canvas.on('mouse:up', () => {
    if (!draft || draft.kind === 'floor') return;
    const kind = draft.kind;
    const box = draft.box;
    clearDraft();
    if (!box || box.w < MIN_BOX || box.h < MIN_BOX) return;
    finishBox(kind === 'poly' ? 'room' : kind, box);
  });

  // ------------------------------------------------------- palette drops --
  async function dropPieceAt(key, pt) {
    if (key === 'door') {
      app.setTool('door');
      app.toast('Now click on the outside wall');
      return;
    }
    if (key === 'compass') {
      const doc = app.doc;
      const p = snapPt(pt);
      const items = doc.items.filter((it) => it.type !== 'compass');
      app.commit({ ...doc, items: [...items, { id: newId(), type: 'compass', x: p.x, y: p.y, deg: 0 }] }, 'Place compass');
      return;
    }
    if (key === 'stair') {
      const std = STD.palette.stair;
      const p = snapPt({ x: pt.x - std.w / 2, y: pt.y - std.h / 2 });
      app.commit(addItem(app.doc, { id: newId(), type: 'stair', x: p.x, y: p.y, w: std.w, h: std.h, dir: 'v' }), 'Place stair');
      return;
    }
    if (key === 'hall') {
      const p = snapPt({ x: pt.x - 150, y: pt.y - 30 });
      app.commit(addItem(app.doc, { id: newId(), type: 'hall', x: p.x, y: p.y, w: 300, h: 60 }), 'Place hallway');
      return;
    }
    const std = STD.palette[key];
    if (!std) return;
    const p = snapPt({ x: pt.x - std.w / 2, y: pt.y - std.h / 2 });
    if (key === 'void') {
      app.commit(addItem(app.doc, makeRoom('void', p.x, p.y, std.w, std.h, '')), 'Place void');
      return;
    }
    let number = '';
    if (NUMBERED_CLASSES.has(std.cls)) {
      const value = await app.prompt('Room number', '', { validate: 'roomNumber' });
      if (value == null) return;
      number = value;
    }
    const item = makeRoom(std.cls, p.x, p.y, std.w, std.h, number);
    if (std.name) {
      item.name = std.name;
      item.showName = true;
    }
    app.commit(addItem(app.doc, item), 'Place room');
  }
  function dropPiece(key, clientX, clientY) {
    return dropPieceAt(key, toPlan(clientX, clientY));
  }

  // --------------------------------------------------------------- stubs --
  function onKey(e) {
    if (e.key === 'Escape') {
      clearDraft();
      if (app.toolName !== 'select') app.setTool('select');
      return true;
    }
    if (e.key === 'Enter' && draft && draft.kind === 'floor') {
      closeFloor();
      return true;
    }
    return false;
  }
  const stubs = {};
  for (const name of ['select', 'floor', 'door', 'hall', 'room', 'poly', 'stair', 'compass', 'pan']) {
    stubs[name] = { name, hint: HINTS[name] || '', onKey, cancel: clearDraft };
  }

  void getDoc;
  return {
    stubs,
    dropPiece,
    cancel: clearDraft,
    destroy() { clearDraft(); void editing; },
  };
}
