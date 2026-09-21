// stageObjects.js
// Builds one Fabric object per model item (room rect group, room polygon,
// hall, stair, door, compass) plus the floor outline, ghosts, guides and the
// route path. Every object carries `itemId` / `itemType` / `zLayer` so
// stage.js can diff, restack and read them back.
// Depends on: fabric@6.7.1 (jsDelivr), js/model/document.js, js/view/stagePoly.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { labelPos, labelClass, labelText, stairTreads, STD } from '../model/document.js';
import { attachPolyControls, setPolyPoints } from './stagePoly.js';

export const FONT = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
export const FILLS = {
  room: '#eef1f4', big: '#e6ecf5', ours: '#f5e3ea', core: '#dfe3e8', void: '#d9dce1',
};
export const STROKE = '#8f959c';

// Back-to-front draw order.
export const LAYER = {
  grid: 0, floor: 1, hall: 2, route: 3, room: 4, stair: 4, door: 5,
  compass: 6, ghost: 7, guide: 8,
};

const BASE = {
  strokeUniform: true,
  objectCaching: true,
  borderColor: '#1a73e8',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#1a73e8',
  cornerStyle: 'circle',
  cornerSize: 10,
  transparentCorners: false,
  padding: 0,
};

function fitText(text, maxW, maxH) {
  const sx = text.width > 0 ? Math.min(1, (maxW - 8) / text.width) : 1;
  const sy = text.height > 0 ? Math.min(1, (maxH - 4) / text.height) : 1;
  const s = Math.max(0.05, Math.min(sx, sy));
  text.set({ scaleX: s, scaleY: s });
}

// Mirrors svgExport: when the name is shown on its own line the label below
// it carries the number only.
function mainLabelText(item) {
  return item.showName && item.name ? (item.number || '') : labelText(item);
}

function makeLabel(item, p, maxW, maxH) {
  const kids = [];
  const txt = mainLabelText(item);
  if (txt) {
    const t = new fabric.FabricText(txt, {
      left: p.x, top: p.y, originX: 'center', originY: 'center',
      fontSize: (item.label && item.label.fontSize) || (labelClass(item) === 'lblS' ? STD.lblS : STD.lbl),
      fill: '#2b2e33', fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
    });
    fitText(t, maxW, maxH);
    kids.push(t);
  }
  if (item.showName && item.name) {
    const n = new fabric.FabricText(item.name, {
      left: p.x, top: p.y - 30, originX: 'center', originY: 'center',
      fontSize: 30, fontWeight: 700, fill: '#1d1f23', fontFamily: FONT,
      selectable: false, evented: false, objectCaching: false,
    });
    fitText(n, maxW, maxH);
    kids.push(n);
  }
  return kids;
}

function tag(obj, item, type) {
  obj.itemId = item.id;
  obj.itemType = type;
  obj.zLayer = LAYER[type] != null ? LAYER[type] : LAYER.room;
  return obj;
}

// ---------------------------------------------------------------- rooms ----
function buildRoomRect(item) {
  const rect = new fabric.Rect({
    left: item.x, top: item.y, width: item.w, height: item.h,
    fill: FILLS[item.cls] || FILLS.room, stroke: STROKE, strokeWidth: 2,
    strokeDashArray: item.cls === 'void' ? [6, 4] : null,
    strokeUniform: true, objectCaching: false,
  });
  const kids = [rect];
  if (item.cls !== 'void') kids.push(...makeLabel(item, labelPos(item), item.w, item.h));
  const g = new fabric.Group(kids, {
    ...BASE, subTargetCheck: false, lockRotation: true, lockSkewingX: true, lockSkewingY: true,
  });
  g.set({ left: item.x, top: item.y, width: item.w, height: item.h });
  g.setControlVisible('mtr', false);
  g.setCoords();
  return tag(g, item, 'room');
}

function buildRoomPoly(item, grid) {
  const poly = new fabric.Polygon(item.points.map(([x, y]) => ({ x, y })), {
    ...BASE, fill: FILLS[item.cls] || FILLS.room, stroke: STROKE, strokeWidth: 2,
    strokeDashArray: item.cls === 'void' ? [6, 4] : null,
    lockRotation: true, lockScalingX: true, lockScalingY: true,
  });
  attachPolyControls(poly, grid);
  poly.setControlVisible('mtr', false);
  return tag(poly, item, 'room');
}

// Poly rooms carry their number in a separate, non-interactive text object so
// the polygon itself stays a plain Fabric.Polygon (point editing needs that).
function buildPolyLabel(item) {
  if (item.cls === 'void' || !mainLabelText(item)) return null;
  const p = labelPos(item);
  const t = new fabric.FabricText(mainLabelText(item), {
    left: p.x, top: p.y, originX: 'center', originY: 'center',
    fontSize: (item.label && item.label.fontSize) || (labelClass(item) === 'lblS' ? STD.lblS : STD.lbl),
    fill: '#2b2e33', fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
  });
  t.itemId = `${item.id}:lbl`;
  t.itemType = 'roomlabel';
  t.labelOwner = item.id;
  t.zLayer = LAYER.room;
  return t;
}

// ---------------------------------------------------- hall / stair / door --
function buildHall(item) {
  const rect = new fabric.Rect({
    left: item.x, top: item.y, width: item.w, height: item.h,
    fill: 'rgba(120,176,224,0.22)', stroke: '#5b9bd5', strokeWidth: 2,
    strokeDashArray: [8, 5], strokeUniform: true, objectCaching: false,
  });
  const t = new fabric.FabricText('Hallway', {
    left: item.x + item.w / 2, top: item.y + item.h / 2, originX: 'center', originY: 'center',
    fontSize: 18, fill: '#2f6feb', fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
  });
  fitText(t, item.w, item.h);
  const g = new fabric.Group([rect, t], {
    ...BASE, subTargetCheck: false, lockRotation: true,
  });
  g.set({ left: item.x, top: item.y, width: item.w, height: item.h });
  g.setControlVisible('mtr', false);
  g.setCoords();
  return tag(g, item, 'hall');
}

function buildStair(item) {
  const kids = [new fabric.Rect({
    left: item.x, top: item.y, width: item.w, height: item.h,
    fill: FILLS.core, stroke: STROKE, strokeWidth: 2, strokeUniform: true, objectCaching: false,
  })];
  for (const t of stairTreads(item)) {
    kids.push(new fabric.Line([t.x1, t.y1, t.x2, t.y2], {
      stroke: STROKE, strokeWidth: 2, strokeUniform: true, selectable: false, evented: false, objectCaching: false,
    }));
  }
  if (item.label) {
    kids.push(new fabric.FabricText(String(item.label), {
      left: item.x + item.w / 2, top: item.y + item.h - 20, originX: 'center', originY: 'center',
      fontSize: Math.min(item.w, item.h) < 70 ? STD.lblS : STD.lbl,
      fill: '#2b2e33', fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
    }));
  }
  const g = new fabric.Group(kids, { ...BASE, subTargetCheck: false, lockRotation: true });
  g.set({ left: item.x, top: item.y, width: item.w, height: item.h });
  g.setControlVisible('mtr', false);
  g.setCoords();
  return tag(g, item, 'stair');
}

function buildDoor(item) {
  const line = new fabric.Line([item.x1, item.y1, item.x2, item.y2], {
    stroke: '#ffffff', strokeWidth: 10, strokeUniform: true, selectable: false, evented: false, objectCaching: false,
  });
  const isDoor = item.kind === 'Door';
  const label = new fabric.FabricText(isDoor ? 'Door' : 'EXIT', {
    left: item.label.x, top: item.label.y, originX: 'center', originY: 'center',
    fontSize: 20, fontWeight: 700, fill: isDoor ? '#5f6368' : '#1a7f37', fontFamily: FONT,
    selectable: false, evented: false, objectCaching: false,
  });
  const g = new fabric.Group([line, label], {
    ...BASE, subTargetCheck: false, hasControls: false,
    lockMovementX: true, lockMovementY: true, lockRotation: true,
    lockScalingX: true, lockScalingY: true,
  });
  return tag(g, item, 'door');
}

// -------------------------------------------------------------- compass ----
function buildCompass(item) {
  const kids = [
    // Invisible square so the group's bounding box is centred on the needle.
    new fabric.Rect({ left: -70, top: -70, width: 140, height: 140, fill: 'rgba(0,0,0,0)', objectCaching: false }),
    new fabric.Circle({ radius: 62, originX: 'center', originY: 'center', left: 0, top: 0, fill: '#ffffff', stroke: '#e6e6ea', strokeWidth: 3, objectCaching: false }),
    new fabric.Circle({ radius: 49, originX: 'center', originY: 'center', left: 0, top: 0, fill: 'rgba(0,0,0,0)', stroke: '#f0f0f3', strokeWidth: 2, objectCaching: false }),
    new fabric.Polygon([{ x: 0, y: -38 }, { x: 11, y: 0 }, { x: -11, y: 0 }], { fill: '#8C0B42', objectCaching: false }),
    new fabric.Polygon([{ x: 0, y: 38 }, { x: 11, y: 0 }, { x: -11, y: 0 }], { fill: '#c7c7cc', objectCaching: false }),
    new fabric.Circle({ radius: 4.5, originX: 'center', originY: 'center', left: 0, top: 0, fill: '#ffffff', stroke: '#8a8690', strokeWidth: 2, objectCaching: false }),
  ];
  const letters = [['N', 0, -52, '#8C0B42'], ['S', 0, 62, '#8a8690'], ['E', 57, 6, '#8a8690'], ['W', -57, 6, '#8a8690']];
  for (const [ch, lx, ly, fill] of letters) {
    kids.push(new fabric.FabricText(ch, {
      left: lx, top: ly, originX: 'center', originY: 'center', fontSize: 22, fontWeight: 600,
      fill, fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
    }));
  }
  const g = new fabric.Group(kids, {
    ...BASE, subTargetCheck: false, lockScalingX: true, lockScalingY: true, snapAngle: 1,
  });
  g.set({ originX: 'center', originY: 'center' });
  g.set({ left: item.x, top: item.y, angle: item.deg || 0 });
  g.setCoords();
  return tag(g, item, 'compass');
}

// ---------------------------------------------------------------- floor ----
export function buildFloor(points, grid) {
  const poly = new fabric.Polygon(points.map(([x, y]) => ({ x, y })), {
    ...BASE, fill: 'rgba(255,255,255,0.35)', stroke: '#3a3d42', strokeWidth: 6,
    lockMovementX: true, lockMovementY: true, lockRotation: true,
    lockScalingX: true, lockScalingY: true, hoverCursor: 'default',
  });
  attachPolyControls(poly, grid);
  poly.setControlVisible('mtr', false);
  poly.itemId = 'floor';
  poly.itemType = 'floor';
  poly.zLayer = LAYER.floor;
  return poly;
}

export function rebuildFloorPoints(poly, points) {
  setPolyPoints(poly, points);
  attachPolyControls(poly, poly.snapGrid);
}

// ------------------------------------------------------------ dispatcher ---
// Returns [mainObject, ...extras] for an item, or [] for an unknown type.
export function buildItem(item, grid) {
  if (item.type === 'room') {
    if (item.shape === 'poly') {
      const label = buildPolyLabel(item);
      return label ? [buildRoomPoly(item, grid), label] : [buildRoomPoly(item, grid)];
    }
    return [buildRoomRect(item)];
  }
  if (item.type === 'hall') return [buildHall(item)];
  if (item.type === 'stair') return [buildStair(item)];
  if (item.type === 'door') return [buildDoor(item)];
  if (item.type === 'compass') return [buildCompass(item)];
  return [];
}

// ------------------------------------------------- overlays (no item id) ---
// Ghost color/label by kind: plain room suggestions are blue with the read
// (or "?") room number; 'hall'/'stair' ghosts (from the "Find hallways and
// stairs" trace) are blue/grey respectively, labelled by kind.
const GHOST_STYLE = {
  hall: { color: '#2f6feb', label: 'Hall' },
  stair: { color: '#7f8c8d', label: 'Stairs' },
};

export function buildGhost(g, index) {
  const style = GHOST_STYLE[g.kind];
  const color = style ? style.color : '#2f6feb';
  const label = style ? style.label : (g.number ? String(g.number) : '?');
  const rect = new fabric.Rect({
    left: g.x, top: g.y, width: g.w, height: g.h,
    fill: `${color}1f`, stroke: color,
    strokeWidth: 2, strokeDashArray: [7, 5], strokeUniform: true, objectCaching: false,
  });
  const t = new fabric.FabricText(label, {
    left: g.x + g.w / 2, top: g.y + g.h / 2, originX: 'center', originY: 'center',
    fontSize: 22, fill: color, fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
  });
  const grp = new fabric.Group([rect, t], {
    selectable: false, evented: true, hoverCursor: 'pointer', objectCaching: false,
  });
  grp.ghostIndex = index;
  grp.zLayer = LAYER.ghost;
  grp.overlay = true;
  return grp;
}

export function buildGuide(guide, view) {
  const pts = guide.axis === 'x'
    ? [guide.at, view.y - view.h, guide.at, view.y + view.h * 2]
    : [view.x - view.w, guide.at, view.x + view.w * 2, guide.at];
  const line = new fabric.Line(pts, {
    stroke: '#17b8c4', strokeWidth: 1, strokeUniform: true,
    selectable: false, evented: false, objectCaching: false,
  });
  line.zLayer = LAYER.guide;
  line.overlay = true;
  return line;
}

export function buildRoute(pts) {
  const flat = [];
  for (const p of pts) flat.push({ x: p[0], y: p[1] });
  const line = new fabric.Polyline(flat, {
    stroke: '#e8710a', strokeWidth: 5, fill: 'rgba(0,0,0,0)', strokeUniform: true,
    selectable: false, evented: false, objectCaching: false,
  });
  line.zLayer = LAYER.route;
  line.overlay = true;
  const out = [line];
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90;
  const head = new fabric.Triangle({
    left: b[0], top: b[1], originX: 'center', originY: 'center', width: 18, height: 18,
    angle, fill: '#e8710a', selectable: false, evented: false, objectCaching: false,
  });
  head.zLayer = LAYER.route;
  head.overlay = true;
  out.push(head);
  return out;
}
