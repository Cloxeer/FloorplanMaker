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
  // Solid opaque grey with no border, so overlapping/connecting halls merge into
  // one open corridor: no seam line where they meet, no opacity doubling.
  const rect = new fabric.Rect({
    left: item.x, top: item.y, width: item.w, height: item.h,
    fill: '#d7dbe0', stroke: null, strokeWidth: 0,
    strokeUniform: true, objectCaching: false,
  });
  const t = new fabric.FabricText('Hallway', {
    left: item.x + item.w / 2, top: item.y + item.h / 2, originX: 'center', originY: 'center',
    fontSize: 18, fill: '#6b7280', fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
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
// Detection ghosts look like the real piece they'd become (same geometry as
// buildStair/buildDoor/buildHall/buildRoomRect) but drawn in a yellow
// "found, not yet placed" scheme, with a small "Found" tag above each.
const GHOST_FILL = '#fff3b0';
const GHOST_STROKE = '#e0a800';
const GHOST_TEXT = '#7a5c00';

function ghostTag(cx, top) {
  return new fabric.FabricText('Found', {
    left: cx, top: top - 6, originX: 'center', originY: 'bottom',
    fontSize: 12, fontWeight: 700, fill: GHOST_TEXT, fontFamily: FONT,
    selectable: false, evented: false, objectCaching: false,
  });
}

export function buildGhost(g, index) {
  const kids = [];
  let cx = g.x + (g.w || 0) / 2;
  let top = g.y;

  if (g.kind === 'door') {
    kids.push(new fabric.Line([g.x1, g.y1, g.x2, g.y2], {
      stroke: GHOST_STROKE, strokeWidth: 8, opacity: 0.8, strokeUniform: true,
      selectable: false, evented: false, objectCaching: false,
    }));
    const mid = { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 };
    kids.push(new fabric.FabricText('EXIT', {
      left: mid.x, top: mid.y, originX: 'center', originY: 'center',
      fontSize: 20, fontWeight: 700, fill: GHOST_TEXT, fontFamily: FONT,
      selectable: false, evented: false, objectCaching: false,
    }));
    cx = mid.x;
    top = Math.min(g.y1, g.y2) - 20;
  } else if (g.kind === 'stair') {
    kids.push(new fabric.Rect({
      left: g.x, top: g.y, width: g.w, height: g.h,
      fill: GHOST_FILL, opacity: 0.8, stroke: GHOST_STROKE, strokeWidth: 2,
      strokeUniform: true, objectCaching: false,
    }));
    for (const t of stairTreads({ x: g.x, y: g.y, w: g.w, h: g.h, dir: g.dir || 'v' })) {
      kids.push(new fabric.Line([t.x1, t.y1, t.x2, t.y2], {
        stroke: GHOST_STROKE, strokeWidth: 2, strokeUniform: true,
        selectable: false, evented: false, objectCaching: false,
      }));
    }
  } else if (g.kind === 'hall') {
    kids.push(new fabric.Rect({
      left: g.x, top: g.y, width: g.w, height: g.h,
      fill: GHOST_FILL, opacity: 0.8, stroke: GHOST_STROKE, strokeWidth: 2,
      strokeUniform: true, objectCaching: false,
    }));
  } else {
    kids.push(new fabric.Rect({
      left: g.x, top: g.y, width: g.w, height: g.h,
      fill: GHOST_FILL, opacity: 0.8, stroke: GHOST_STROKE, strokeWidth: 2,
      strokeUniform: true, objectCaching: false,
    }));
    kids.push(new fabric.FabricText(g.number ? String(g.number) : '?', {
      left: g.x + g.w / 2, top: g.y + g.h / 2, originX: 'center', originY: 'center',
      fontSize: 22, fill: GHOST_TEXT, fontFamily: FONT, selectable: false, evented: false, objectCaching: false,
    }));
  }
  kids.push(ghostTag(cx, top));

  const grp = new fabric.Group(kids, {
    selectable: false, evented: true, hoverCursor: 'pointer', objectCaching: false,
  });
  grp.ghostIndex = index;
  grp.itemType = 'ghost';
  grp.zLayer = LAYER.ghost;
  grp.overlay = true;
  return grp;
}

// One 0.25 -> 0.6 -> 0.25 pulse over ~600ms to draw the eye to freshly
// detected ghosts. Fabric's own `.animate()` handles the tween + repaint.
export function pulseGhost(obj, render) {
  if (!obj || typeof obj.animate !== 'function') return;
  obj.animate('opacity', 0.6, {
    duration: 300,
    onChange: render,
    onComplete: () => {
      obj.animate('opacity', 0.25, { duration: 300, onChange: render });
    },
  });
}

export function buildGuide(guide, view) {
  if (guide.axis === 'wall') {
    const line = new fabric.Line([guide.x1, guide.y1, guide.x2, guide.y2], {
      stroke: '#e0a800', strokeWidth: 6, strokeUniform: true,
      selectable: false, evented: false, objectCaching: false,
    });
    line.zLayer = LAYER.guide;
    line.overlay = true;
    return line;
  }
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

// A hall's long axis: 'h' when it runs wider than tall, else 'v'. Two halls
// crossing at a T/+ junction (one 'h', one 'v') are a normal junction, not a
// stack-up — only same-axis overlap counts as "on top of".
export function hallAxis(item) {
  return item.w > item.h ? 'h' : 'v';
}

// Rect intersection of two axis-aligned hall items sharing the same long
// axis, or null when they don't overlap (touching edges only, area 0, or
// crossing at a T/+ junction, doesn't count).
export function hallIntersection(a, b) {
  if (hallAxis(a) !== hallAxis(b)) return null;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function buildHallOverlap(rect) {
  const r = new fabric.Rect({
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    fill: 'rgba(229,72,77,0.35)', stroke: null,
    selectable: false, evented: false, objectCaching: false,
  });
  r.zLayer = LAYER.guide;
  r.overlay = true;
  return r;
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
