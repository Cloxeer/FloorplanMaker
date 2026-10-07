// stageTools.js
// Drawing tools for the Fabric stage: floor outline, doors, hallways, rooms,
// stairs and the compass, plus palette drops (stage.dropPiece). Each tool is a
// small state machine driven by Fabric's own mouse events; only the live
// preview is drawn here — everything else goes through app.commit.
// Depends on: fabric@6.7.1, js/model/document.js, js/model/geometry.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import {
  STD, newId, addItem, setFloor, makeRoom, doorFor, doorSpanFor, NUMBERED_CLASSES, findLegend,
} from '../model/document.js';
import { legendGroupSize } from './panels/legend.js';
import { snapToGrid, dist, nearestPointOnPolyline } from '../model/geometry.js';
import { openingCentres, wallAt, outlinesOf, OPENING } from '../model/connect.js';

const DOOR_REACH = 12;
const DOOR_START_REACH = 40; // plan units: how close to the wall a door drag may start
const MIN_DOOR = 12; // plan units: drag shorter than this = a plain click (default width)
const MIN_BOX = 10;
const CORNER_RADIUS = 8; // screen px, scaled by 1/zoom
const CLOSE_REACH = 12; // screen px

const HINTS = {
  select: 'Click a room to select it. Drag to move. Delete removes it.',
  floor: 'Click each corner of the building. Press Enter or click the first corner to finish.',
  door: 'Click the outside wall for a doorway, or drag along it to size the opening. Press Esc when done.',
  hall: 'Drag a box along the hallway. Press Esc when done.',
  room: 'Drag a box over a room on the photo.',
  poly: 'Drag a box over a room on the photo.',
  stair: 'Drag a box over the stairwell.',
  compass: 'Click where the compass should sit.',
  pan: 'Drag to move around the plan.',
  authwall: 'Click the start, then the end (or drag) to draw a staff-only wall. Press Esc when done.',
  connect: 'Click a wall of a building. Press Esc to cancel.',
};
const SNAP_OPENING = 18; // screen px: how near a hallway end must come to the middle of an opening to lock onto it

export function attachTools(ctx, editing) {
  const { canvas, app, render, toPlan, getDoc, getView } = ctx;
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

  // ------------------------------------------- hallway meets an opening --
  // The middle of the opening a point is near (the magnet; off while Alt is held), or null.
  function openingNear(p) {
    if (!app.magnet) return null;
    const reach = SNAP_OPENING / (canvas.getZoom() || 1);
    let best = null;
    for (const o of openingCentres(app.doc)) {
      const d = Math.hypot(o.centre[0] - p.x, o.centre[1] - p.y);
      if (d <= reach && (!best || d < best.d)) best = { ...o, d };
    }
    return best;
  }
  // The hallway box dragged from `a` to `b`. An end on an opening sits exactly on its middle, and the hallway is
  // centred on it, across the wall (the far end only says how wide: twice its distance, else the opening's width).
  function hallBox(a, b, oa, ob) {
    const box = boxOf(a, b);
    if (oa && ob) {
      if (oa.horizontal !== ob.horizontal) return box;
      const vert = oa.horizontal; // walls run along x, so the hallway runs along y and its width is along x
      const gap = vert ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
      if (gap >= MIN_BOX) return box;
      const mid = vert ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
      return vert ? { ...box, x: Math.round(mid - OPENING / 2), w: OPENING } : { ...box, y: Math.round(mid - OPENING / 2), h: OPENING };
    }
    const o = oa || ob;
    if (!o) return box;
    const e = oa ? a : b, far = oa ? b : a;
    if (o.horizontal) {
      const d = Math.abs(far.x - e.x), half = d * 2 >= MIN_BOX ? d : OPENING / 2;
      return { x: e.x - half, w: 2 * half, y: Math.min(e.y, far.y), h: Math.abs(far.y - e.y) };
    }
    const d = Math.abs(far.y - e.y), half = d * 2 >= MIN_BOX ? d : OPENING / 2;
    return { y: e.y - half, h: 2 * half, x: Math.min(e.x, far.x), w: Math.abs(far.x - e.x) };
  }
  function snapRings(list) {
    const zoom = canvas.getZoom() || 1;
    draft.rings = draft.rings || [];
    list.forEach((o, i) => {
      if (!draft.rings[i]) {
        draft.rings[i] = addPreview(new fabric.Circle({ originX: 'center', originY: 'center', fill: 'transparent', strokeWidth: 3 }));
      }
      draft.rings[i].set({ left: o.centre[0], top: o.centre[1], radius: 10 / zoom, stroke: o.color, strokeWidth: 3 / zoom, visible: true });
      draft.rings[i].setCoords();
    });
    for (let i = list.length; i < draft.rings.length; i += 1) draft.rings[i].set({ visible: false });
  }

  const MIN_STAIR = 20;

  async function finishBox(kind, box) {
    if (kind === 'hall') {
      const item = { id: newId(), type: 'hall', x: box.x, y: box.y, w: box.w, h: box.h };
      app.commit(addItem(app.doc, item), 'Draw hallway');
      return;
    }
    if (kind === 'stair') {
      if (box.w < MIN_STAIR || box.h < MIN_STAIR) return;
      const item = { id: newId(), type: 'stair', x: box.x, y: box.y, w: box.w, h: box.h, dir: 'v' };
      app.commit(addItem(app.doc, item), 'Draw stairs');
      return;
    }
    // Room-tool box draw: the active piece (set by the palette chip that
    // switched into this tool) picks the class/name; plain "Draw a room"
    // defaults to the bare 'room' piece.
    const pieceKey = app.pendingRoomPiece || 'room';
    const std = STD.palette[pieceKey] || STD.palette.room;
    const cls = std.cls || 'room';
    if (cls === 'void') {
      app.commit(addItem(app.doc, makeRoom('void', box.x, box.y, box.w, box.h, '')), 'Draw void');
      return;
    }
    let number = '';
    if (NUMBERED_CLASSES.has(cls)) {
      const value = await app.prompt('Room number', '', { validate: 'roomNumber' });
      if (value == null) return;
      number = value;
      app.lastNumber = value;
    }
    const item = makeRoom(cls, box.x, box.y, box.w, box.h, number);
    if (std.name) { item.name = std.name; item.showName = true; }
    app.commit(addItem(app.doc, item), 'Draw room');
  }

  // ---------------------------------------------------------- staff wall --
  function authwallPreview() {
    const b = draft.hover || draft.start;
    if (!draft.line) {
      draft.line = addPreview(new fabric.Line([draft.start.x, draft.start.y, b.x, b.y], {
        stroke: '#7c3aed', strokeWidth: 6, strokeDashArray: [10, 8], strokeUniform: true,
      }));
    } else {
      draft.line.set({ x1: draft.start.x, y1: draft.start.y, x2: b.x, y2: b.y });
      draft.line.setCoords();
    }
    render();
  }
  function midInsideHall(a, b) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return app.doc.items.some((it) => it.type === 'hall'
      && mx >= it.x && mx <= it.x + it.w && my >= it.y && my <= it.y + it.h);
  }
  function finishAuthwall(a, b) {
    if (dist([a.x, a.y], [b.x, b.y]) < MIN_BOX) return;
    if (!midInsideHall(a, b)) {
      app.toast('Staff walls go inside a hallway.');
      return;
    }
    const item = {
      id: newId(), type: 'authwall',
      x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y),
    };
    app.commit(addItem(app.doc, item), 'Draw staff wall');
  }

  // --------------------------------------------------------------- doors --
  // A door is placed on the outer wall. Two ways, both starting on the wall:
  //   - a plain click drops a default-width opening centered where you clicked;
  //   - dragging along the wall sizes the opening to the drag length.
  // While dragging we show a live green bar (matching the EXIT green) so it is
  // obvious how wide the entrance will be.
  function outline() {
    const doc = app.doc;
    return doc.floor && doc.floor.points && doc.floor.points.length >= 3 ? doc.floor.points : null;
  }
  function nearWall(pt) {
    const o = outline();
    if (!o) return null;
    const near = nearestPointOnPolyline([pt.x, pt.y], o, true);
    if (!near) return null;
    return dist([near.x, near.y], [pt.x, pt.y]) <= DOOR_START_REACH ? near : null;
  }
  function doorPreview(door) {
    if (!door) return;
    if (!draft.line) {
      draft.line = addPreview(new fabric.Line([door.x1, door.y1, door.x2, door.y2], {
        stroke: '#1a7f37', strokeWidth: 10, strokeUniform: true, strokeLineCap: 'butt', opacity: 0.9,
      }));
    } else {
      draft.line.set({ x1: door.x1, y1: door.y1, x2: door.x2, y2: door.y2 });
      draft.line.setCoords();
    }
    render();
  }
  function commitDoor(door) {
    // Drop the transient `span` field; the door item only needs its geometry.
    const { span, ...geom } = door;
    void span;
    app.commit(addItem(app.doc, { id: newId(), type: 'door', ...geom, kind: 'EXIT' }), 'Place door');
  }

  // ------------------------------------------------ connect point (a link) --
  // The palette arms one point of a link (app.connectArm = { pair, slot, color }); the next click on a wall of a building
  // places it ON that wall. Placing it again moves it.
  function placeConnect(raw) {
    const arm = app.connectArm;
    if (!arm) { app.setTool('select'); return; }
    const hit = wallAt(app.doc, [raw.x, raw.y], Math.max(40, 24 / (canvas.getZoom() || 1)));
    if (!hit) { app.toast('Click on a wall of a building.'); return; }
    const o = outlinesOf(app.doc).find((i) => i.id === hit.outline);
    const item = { id: newId(), type: 'connect', pair: arm.pair, slot: arm.slot, color: arm.color, outline: hit.outline, piece: o && o.piece, x: hit.x, y: hit.y };
    const rest = app.doc.items.filter((i) => !(i.type === 'connect' && i.pair === arm.pair && i.slot === arm.slot));
    app.connectArm = null;
    app.commit({ ...app.doc, items: [...rest, item] }, 'Place connection point');
    app.setTool('select');
  }
  const connectHint = () => (app.connectArm ? `Click a wall of a building for point ${app.connectArm.slot}. Press Esc to cancel.` : HINTS.connect);

  // ------------------------------------------------------- mouse plumbing --
  function drawing() {
    const n = app.toolName;
    return n && n !== 'select' && n !== 'pan' && !ctx.isPanning();
  }

  canvas.on('mouse:down', (opt) => {
    if (!drawing() || !opt.e || opt.e.button === 1) return;
    const tool = app.toolName;
    if (tool === 'connect') { placeConnect(toPlan(opt.e.clientX, opt.e.clientY)); return; }
    let pt = snapPt(toPlan(opt.e.clientX, opt.e.clientY), opt.e);
    let startOpen = null;
    if (tool === 'hall') {
      startOpen = openingNear(toPlan(opt.e.clientX, opt.e.clientY));
      if (startOpen) pt = { x: startOpen.centre[0], y: startOpen.centre[1] };
    }
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
    if (tool === 'door') {
      if (!outline()) { app.toast('Draw the building outline first.'); return; }
      if (!nearWall(pt)) return; // ignore clicks/drags that don't start on the wall
      draft = { kind: 'door', downPt: pt, objs: [], door: null };
      return;
    }
    if (tool === 'authwall') {
      if (draft && draft.kind === 'authwall') {
        const a = draft.start;
        clearDraft();
        finishAuthwall(a, pt);
        app.setTool('select');
        return;
      }
      draft = { kind: 'authwall', start: pt, objs: [] };
      return;
    }
    if (tool === 'compass') {
      const doc = app.doc;
      const items = doc.items.filter((it) => it.type !== 'compass');
      app.commit({ ...doc, items: [...items, { id: newId(), type: 'compass', x: pt.x, y: pt.y, deg: 0 }] }, 'Place compass');
      app.setTool('select');
      return;
    }
    draft = { kind: tool, start: pt, box: { x: pt.x, y: pt.y, w: 0, h: 0 }, objs: [], startOpen };
  });

  canvas.on('mouse:move', (opt) => {
    if (!draft || !opt.e) return;
    const pt = snapPt(toPlan(opt.e.clientX, opt.e.clientY), opt.e);
    if (draft.kind === 'floor') {
      draft.hover = [pt.x, pt.y];
      floorPreview();
      return;
    }
    if (draft.kind === 'authwall') {
      draft.hover = pt;
      authwallPreview();
      return;
    }
    if (draft.kind === 'door') {
      const o = outline();
      const span = o && doorSpanFor(o, draft.downPt, pt);
      // Preview the dragged opening once it is meaningfully wide; before that,
      // preview the default-width opening so the user sees where it will land.
      draft.door = (span && span.span >= MIN_DOOR) ? span : (o && doorFor(o, draft.downPt));
      doorPreview(draft.door);
      return;
    }
    if (draft.kind === 'hall') {
      const endOpen = openingNear(toPlan(opt.e.clientX, opt.e.clientY));
      const end = endOpen ? { x: endOpen.centre[0], y: endOpen.centre[1] } : pt;
      draft.box = hallBox(draft.start, end, draft.startOpen, endOpen);
      snapRings([draft.startOpen, endOpen].filter(Boolean));
      boxPreview('rgba(120,176,224,0.22)', '#5b9bd5');
      return;
    }
    draft.box = boxOf(draft.start, pt);
    boxPreview('rgba(47,111,235,0.10)', '#2f6feb');
  });

  canvas.on('mouse:dblclick', () => {
    if (draft && draft.kind === 'floor' && draft.points.length >= 3) closeFloor();
  });

  canvas.on('mouse:up', () => {
    if (!draft || draft.kind === 'floor') return;
    if (draft.kind === 'door') {
      const o = outline();
      const downPt = draft.downPt;
      const dragged = draft.door;
      clearDraft();
      if (!o) return;
      // A real drag sizes the opening; a plain click (or a tiny drag) drops the
      // default-width opening centered on where the wall was clicked.
      const door = (dragged && dragged.span >= MIN_DOOR) ? dragged : doorFor(o, downPt);
      if (door) commitDoor(door);
      return; // stay in the door tool so several doors can be placed in a row
    }
    if (draft.kind === 'authwall') {
      const end = draft.hover || draft.start;
      if (dist([end.x, end.y], [draft.start.x, draft.start.y]) >= MIN_BOX) {
        const a = draft.start;
        clearDraft();
        finishAuthwall(a, end);
        app.setTool('select');
      }
      // else: a plain click with no drag — keep the draft, wait for the
      // second click (click-start, click-end flow).
      return;
    }
    const kind = draft.kind;
    const box = draft.box;
    clearDraft();
    if (!box || box.w < MIN_BOX || box.h < MIN_BOX) return;
    finishBox(kind === 'poly' ? 'room' : kind, box);
  });

  // ------------------------------------------------------- palette drops --
  // One legend per plan. Dropped: centered where it lands. Clicked (no point):
  // in the first spot that's on screen — beside the building, else below it,
  // else the visible bottom-right corner. Sized to about a third of the
  // building's height (never taller than most of the screen). Resize it
  // afterwards with the corner handles.
  function placeLegend(pt) {
    const doc = app.doc;
    if (findLegend(doc)) {
      app.toast('This plan already has a legend. Select it and press Delete to remove it first.');
      return;
    }
    const { w, h } = legendGroupSize();
    const fl = doc.floor && doc.floor.points && doc.floor.points.length >= 3 ? doc.floor.points : null;
    const xs = fl ? fl.map((p) => p[0]) : [doc.viewBox.x, doc.viewBox.x + doc.viewBox.w];
    const ys = fl ? fl.map((p) => p[1]) : [doc.viewBox.y, doc.viewBox.y + doc.viewBox.h];
    const b = { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), btm: Math.max(...ys) };
    const v = getView ? getView() : { x: b.l, y: b.t, w: b.r - b.l, h: b.btm - b.t };
    let scale = Math.min(8, Math.max(0.3, ((b.btm - b.t) * 0.35) / h), (v.h * 0.8) / h);
    scale = Math.round(scale * 100) / 100;
    const lw = w * scale;
    const lh = h * scale;
    const gap = 30;
    let at;
    if (pt) at = { x: pt.x - lw / 2, y: pt.y - lh / 2 };
    else if (b.r + gap + lw <= v.x + v.w - 10) at = { x: b.r + gap, y: Math.max(b.t, v.y + 10) };
    else if (b.btm + gap + lh <= v.y + v.h - 10) at = { x: Math.max(b.l, v.x + 10), y: b.btm + gap };
    else at = { x: v.x + v.w - lw - 20, y: v.y + v.h - lh - 20 };
    at = { x: Math.round(at.x), y: Math.round(at.y) };
    const item = { id: newId(), type: 'legend', x: at.x, y: at.y, scale };
    app.commit(addItem(doc, item), 'Place legend');
    if (app.setSelection) app.setSelection([item.id]);
  }

  async function dropPieceAt(key, pt) {
    if (key === 'legend') { placeLegend(pt); return; }
    if (key === 'door') {
      app.setTool('door');
      app.toast('Click the outside wall, or drag along it to size the opening');
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
    if (clientX == null) return dropPieceAt(key, null); // clicked, not dropped
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
  for (const name of ['select', 'floor', 'door', 'hall', 'room', 'poly', 'stair', 'compass', 'pan', 'authwall', 'connect']) {
    stubs[name] = { name, get hint() { return name === 'connect' ? connectHint() : (HINTS[name] || ''); }, onKey, cancel: clearDraft };
  }

  void getDoc;
  return {
    stubs,
    dropPiece,
    cancel: clearDraft,
    destroy() { clearDraft(); void editing; },
  };
}
