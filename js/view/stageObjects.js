// stageObjects.js
// Builds one Fabric object per model item (room rect group, room polygon,
// hall, stair, door, compass) plus the floor outline, ghosts, guides and the
// route path. Every object carries `itemId` / `itemType` / `zLayer` so
// stage.js can diff, restack and read them back.
// Depends on: fabric@6.7.1 (jsDelivr), js/model/document.js, js/view/stagePoly.js.

import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
import { labelPos, labelClass, labelText, stairTreads, STD } from '../model/document.js';
import { attachPolyControls, setPolyPoints } from './stagePoly.js';
import { ICONS, iconForRoom } from './icons.js';

export const FONT = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
export const FILLS = {
  room: '#eef1f4', big: '#e6ecf5', ours: '#f5e3ea', core: '#dfe3e8', void: '#d9dce1',
};
export const STROKE = '#8f959c';

// Back-to-front draw order.
export const LAYER = {
  grid: 0, floor: 1, hall: 2, route: 3, room: 4, stair: 4, authwall: 4.5, door: 5,
  compass: 6, floorEdge: 6.5, ghost: 7, guide: 8,
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

// Icon (core rooms) + label stacked compactly inside the box: icon in the
// upper portion, a small label below it, both scaled to fit maxW x maxH with
// a margin so neither the icon nor the text ever overflows the room rect.
function makeIconAndLabel(item, cx, cy, maxW, maxH) {
  const margin = 6;
  const innerW = Math.max(4, maxW - margin * 2);
  const innerH = Math.max(4, maxH - margin * 2);
  const hasName = !!(item.showName && item.name);
  const txt = mainLabelText(item);
  const hasLabel = !!txt || hasName;

  // Reserve ~55% of the height for the icon, ~45% for label(s) when both are
  // shown; icon gets the full height when there's no label.
  const iconMaxH = hasLabel ? innerH * 0.58 : innerH;
  const iconCap = Math.min(maxW, maxH) * 0.6;
  const iconSize = Math.max(10, Math.min(innerW * 0.9, iconMaxH, iconCap));
  const iconCy = hasLabel ? cy - innerH / 2 + iconSize / 2 : cy;

  const kids = [];
  const iconKey = iconForRoom(item);
  if (iconKey) {
    kids.push(...iconGlyph(iconKey, cx, iconCy, iconSize));
  }

  if (hasLabel) {
    const labelTop = kids.length ? iconCy + iconSize / 2 + 4 : cy;
    const labelMaxH = kids.length ? Math.max(8, cy + innerH / 2 - labelTop) : innerH;
    const lines = [];
    if (hasName) lines.push({ text: item.name, weight: 700, fill: '#1d1f23' });
    if (txt) lines.push({ text: txt, weight: 400, fill: '#2b2e33' });
    const lineH = labelMaxH / lines.length;
    lines.forEach((ln, i) => {
      const t = new fabric.FabricText(ln.text, {
        left: cx, top: labelTop + lineH * i + lineH / 2, originX: 'center', originY: 'center',
        fontSize: labelClass(item) === 'lblS' ? STD.lblS : STD.lbl,
        fontWeight: ln.weight, fill: ln.fill, fontFamily: FONT,
        selectable: false, evented: false, objectCaching: false,
      });
      fitText(t, innerW, lineH - 2);
      kids.push(t);
    });
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
// Diagonal criss-cross hatch lines filling a w x h box (local coords, top-left
// at 0,0), spaced ~18px apart, for the void fill and the void palette chip.
export function hatchLines(w, h, spacing = 18, opts = {}) {
  const lines = [];
  const stroke = opts.stroke || '#b9bec6';
  const strokeWidth = opts.strokeWidth || 1;
  const step = Math.max(6, spacing);
  for (let d = -h; d < w; d += step) {
    lines.push([d, 0, d + h, h]);
    lines.push([d + h, 0, d, h]);
  }
  return lines.map(([x1, y1, x2, y2]) => new fabric.Line([x1, y1, x2, y2], {
    stroke, strokeWidth, selectable: false, evented: false, objectCaching: false,
  }));
}

// Non-fill contents of a room rect: for core rooms whose name matches a known
// icon (Elevator, Restroom), icon + label are stacked and fit together so
// neither spills outside the box; otherwise just the (fitted) label.
function roomContentKids(item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  if (iconForRoom(item)) {
    return makeIconAndLabel(item, cx, cy, item.w, item.h);
  }
  return makeLabel(item, labelPos(item), item.w, item.h);
}

function buildRoomRect(item) {
  const rect = new fabric.Rect({
    left: item.x, top: item.y, width: item.w, height: item.h,
    fill: FILLS[item.cls] || FILLS.room, stroke: STROKE, strokeWidth: 2,
    strokeDashArray: item.cls === 'void' ? [6, 4] : null,
    strokeUniform: true, objectCaching: false,
  });
  if (item.cls === 'void') {
    // A void has no label, so a plain Rect used to be enough — but Fabric's
    // single-child Group recomputes its own bounding box/layout on move in a
    // way that corrupts width/height, so the hatch overlay is wrapped with
    // the rect in a multi-child Group (safe) rather than a single-child one.
    const hatch = hatchLines(item.w, item.h).map((ln) => {
      ln.set({ left: item.x, top: item.y });
      return ln;
    });
    const g = new fabric.Group([rect, ...hatch], {
      ...BASE, subTargetCheck: false, perPixelTargetFind: false,
      lockRotation: true, lockSkewingX: true, lockSkewingY: true,
    });
    g.set({ left: item.x, top: item.y, width: item.w, height: item.h });
    g.setControlVisible('mtr', false);
    g.setCoords();
    return tag(g, item, 'room');
  }
  const kids = [rect, ...roomContentKids(item)];
  const g = new fabric.Group(kids, {
    ...BASE, subTargetCheck: false, lockRotation: true, lockSkewingX: true, lockSkewingY: true,
  });
  g.set({ left: item.x, top: item.y, width: item.w, height: item.h });
  g.setControlVisible('mtr', false);
  g.setCoords();
  return tag(g, item, 'room');
}

// Icon glyph, drawn from the shared ICONS path data (js/view/icons.js) so the
// stage, the palette chip and the exported SVG all draw the exact same
// user-supplied icon (elevator lift / restroom toilet), centred at (cx, cy)
// and sized to `size` (its full box side length).
function iconGlyph(key, cx, cy, size) {
  const ic = ICONS[key];
  if (!ic) return [];
  const path = new fabric.Path(ic.d, {
    fill: '#5f6368', selectable: false, evented: false, objectCaching: false,
  });
  const s = size / ic.viewBox;
  path.set({
    left: cx, top: cy, originX: 'center', originY: 'center', scaleX: s, scaleY: s,
  });
  return [path];
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

// ---------------------------------------------------------- staff wall ----
// A "wall of authority": a thick dashed purple line with a small lock glyph
// at its midpoint. Studio-only (filtered out of exportSvg in docActions.js,
// same as halls) and never routed/validated (route.js/validate.js only look
// at type === 'room' / 'door' / 'stair', so an 'authwall' item is inert to
// both without any change there).
function lockGlyph(cx, cy, size) {
  const bodyW = size * 0.7, bodyH = size * 0.55;
  const shackleR = size * 0.28;
  const body = new fabric.Rect({
    left: cx, top: cy + bodyH * 0.15, originX: 'center', originY: 'center',
    width: bodyW, height: bodyH, rx: size * 0.06, ry: size * 0.06,
    fill: '#ffffff', stroke: '#7c3aed', strokeWidth: Math.max(1, size * 0.06),
    selectable: false, evented: false, objectCaching: false,
  });
  const shackle = new fabric.Circle({
    left: cx, top: cy - bodyH * 0.25, originX: 'center', originY: 'center',
    radius: shackleR, startAngle: 180, endAngle: 360,
    fill: 'rgba(0,0,0,0)', stroke: '#7c3aed', strokeWidth: Math.max(1, size * 0.08),
    selectable: false, evented: false, objectCaching: false,
  });
  return [shackle, body];
}

function buildAuthwall(item) {
  const line = new fabric.Line([item.x1, item.y1, item.x2, item.y2], {
    stroke: '#7c3aed', strokeWidth: 6, strokeDashArray: [10, 8], strokeUniform: true,
    selectable: false, evented: false, objectCaching: false,
  });
  const mid = { x: (item.x1 + item.x2) / 2, y: (item.y1 + item.y2) / 2 };
  const kids = [line, ...lockGlyph(mid.x, mid.y, 20)];
  const g = new fabric.Group(kids, {
    ...BASE, subTargetCheck: false, hasControls: false,
    lockScalingX: true, lockScalingY: true, lockRotation: true,
  });
  g.setCoords();
  return tag(g, item, 'authwall');
}

// -------------------------------------------------------------- compass ----
function buildCompass(item) {
  const kids = [
    // Invisible square so the group's bounding box is centred on the needle.
    new fabric.Rect({ left: -70, top: -70, width: 140, height: 140, fill: 'rgba(0,0,0,0)', objectCaching: false }),
    new fabric.Circle({ radius: 80, originX: 'center', originY: 'center', left: 0, top: 0, fill: '#ffffff', stroke: '#1d1f23', strokeWidth: 3, objectCaching: false }),
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

// A stroke-only, fill-none copy of the floor outline, drawn topmost (see
// LAYER.floorEdge) so the building wall line is never covered by rooms/halls
// drawn flush to it. Not interactive — the real editable outline is the
// fill polygon from buildFloor(); this is purely a visual guarantee.
export function buildFloorEdge(points) {
  const poly = new fabric.Polygon(points.map(([x, y]) => ({ x, y })), {
    fill: 'rgba(0,0,0,0)', stroke: '#3a3d42', strokeWidth: 6, strokeLineJoin: 'round',
    selectable: false, evented: false, objectCaching: false,
  });
  poly.itemId = 'floor-edge';
  poly.itemType = 'floorEdge';
  poly.zLayer = LAYER.floorEdge;
  return poly;
}

export function rebuildFloorEdgePoints(poly, points) {
  setPolyPoints(poly, points);
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
  if (item.type === 'authwall') return [buildAuthwall(item)];
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
