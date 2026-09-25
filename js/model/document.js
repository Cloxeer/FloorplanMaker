// document.js
// Pure, immutable document model for a floorplan: create/patch the doc,
// item helpers (rooms, doors, stairs), numbering, and the STD constants.
// Depends on: js/model/geometry.js (bbox, polygonCentroid, nearestPointOnPolyline, insideNormal).

import {
  bbox,
  polygonCentroid,
  nearestPointOnPolyline,
  insideNormal,
} from './geometry.js';

export const STD = {
  wallOut: 6,
  wallIn: 2,
  doorLen: 36,
  exitInset: 55,
  tread: 18,
  lbl: 24,
  lblS: 19,
  smallSide: 70,
  grid: 5,
  exitRadius: 100,
  palette: {
    room: { cls: 'room', w: 120, h: 90 },
    small: { cls: 'room', w: 70, h: 60 },
    big: { cls: 'big', w: 300, h: 220 },
    ours: { cls: 'ours', w: 120, h: 90 },
    restroom: { cls: 'core', w: 110, h: 90, name: 'Restrooms' },
    elevator: { cls: 'core', w: 60, h: 60, name: 'Elevator' },
    stair: { w: 60, h: 110 },
    void: { cls: 'void', w: 100, h: 100 },
    closet: { cls: 'core', w: 70, h: 60, name: 'Utility' },
  },
};

export const NUMBER_RE = /^[A-Z]?\d{3}[A-Z]?$/;
// Classes whose label must be a room number. Cores may carry free text ("Elev", "ST1") or nothing.
export const NUMBERED_CLASSES = new Set(['room', 'big', 'ours']);

let idCounter = 0;

export function newId() {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `id${idCounter.toString(36)}${rand}`;
}

export function createDoc(meta, viewBox) {
  return {
    version: 1,
    meta: { ...meta },
    viewBox: { ...viewBox },
    floor: null,
    items: [],
    sections: [],
  };
}

export function addItem(doc, item) {
  return { ...doc, items: [...doc.items, item] };
}

function mergePatch(item, patch) {
  const next = { ...item, ...patch };
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'label')) {
    next.label = { ...(item.label || {}), ...(patch.label || {}) };
  }
  return next;
}

export function updateItem(doc, id, patch) {
  return {
    ...doc,
    items: doc.items.map((it) => (it.id === id ? mergePatch(it, patch) : it)),
  };
}

export function removeItems(doc, ids) {
  const idSet = new Set(ids);
  return { ...doc, items: doc.items.filter((it) => !idSet.has(it.id)) };
}

export function setFloor(doc, points) {
  return { ...doc, floor: points ? { points: points.map((p) => [...p]) } : null };
}

export function addSection(doc, title) {
  const id = newId();
  const doc2 = { ...doc, sections: [...doc.sections, { id, title }] };
  return { doc: doc2, id };
}

export function getItem(doc, id) {
  return doc.items.find((it) => it.id === id);
}

export function roomPolygon(item) {
  if (item.shape === 'poly') {
    return item.points.map((p) => [...p]);
  }
  const { x, y, w, h } = item;
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function roomCentroid(item) {
  const pts = roomPolygon(item);
  const c = polygonCentroid(pts);
  return { x: Math.round(c.x), y: Math.round(c.y) };
}

export function roomShortSide(item) {
  if (item.shape === 'rect') {
    return Math.min(item.w, item.h);
  }
  const b = bbox(item.points);
  return Math.min(b.w, b.h);
}

export function labelPos(item) {
  if (item.label && item.label.pinned && item.label.x != null && item.label.y != null) {
    return { x: Math.round(item.label.x), y: Math.round(item.label.y) };
  }
  return roomCentroid(item);
}

export function labelClass(item) {
  return roomShortSide(item) < STD.smallSide ? 'lblS' : 'lbl';
}

export function labelText(item) {
  const number = item.number || '';
  return item.name ? `${item.name} ${number}` : number;
}

export function nextNumber(n) {
  if (!n) return '';
  const s = String(n);
  const lastChar = s[s.length - 1];
  if (/[A-Z]/.test(lastChar)) {
    if (lastChar === 'Z') return s; // Z stays Z
    const nextLetter = String.fromCharCode(lastChar.charCodeAt(0) + 1);
    return s.slice(0, -1) + nextLetter;
  }
  // increment trailing digit run, keep any leading letter
  const m = s.match(/^([A-Za-z]*)(\d+)$/);
  if (!m) return s;
  const [, prefix, digits] = m;
  const incremented = String(parseInt(digits, 10) + 1).padStart(digits.length, '0');
  return prefix + incremented;
}

export function makeRoom(cls, x, y, w, h, number = '') {
  return {
    id: newId(),
    type: 'room',
    cls,
    shape: 'rect',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    number,
    name: '',
    label: { pinned: false, x: null, y: null, fontSize: null },
    showName: false,
    section: null,
  };
}

export function stairTreads(item) {
  if (item.treads && item.treads.length) return item.treads.map((t) => ({ ...t }));
  const treads = [];
  const { x, y, w, h, dir } = item;
  if (dir === 'v') {
    for (let k = 0; ; k++) {
      const ty = y + 9 + k * STD.tread;
      if (ty >= y + h) break;
      treads.push({ x1: x, y1: ty, x2: x + w, y2: ty });
    }
  } else {
    for (let k = 0; ; k++) {
      const tx = x + 9 + k * STD.tread;
      if (tx >= x + w) break;
      treads.push({ x1: tx, y1: y, x2: tx, y2: y + h });
    }
  }
  return treads;
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function vecLen(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

// Signed distance of a point projected onto edge a->b (in edge units), plus
// the edge length and unit direction. Shared by doorFor / doorSpanFor.
function projectOntoEdge(a, b, point) {
  const edgeVec = vecSub(b, a);
  const L = vecLen(edgeVec);
  if (L === 0) return { s: 0, L: 0, dir: [0, 0] };
  const dir = [edgeVec[0] / L, edgeVec[1] / L];
  const to = vecSub([point.x, point.y], a);
  return { s: to[0] * dir[0] + to[1] * dir[1], L, dir };
}

// Build a door object for the opening between edge-distances s1..s2 on edge
// a->b of the outline. Clamps the span onto the edge and puts the EXIT/Door
// label just inside the wall at the opening's midpoint.
function doorOnEdge(outlinePoints, a, b, s1, s2) {
  const edgeVec = vecSub(b, a);
  const L = vecLen(edgeVec);
  if (L === 0) return null;
  const dir = [edgeVec[0] / L, edgeVec[1] / L];
  let lo = Math.max(0, Math.min(L, Math.min(s1, s2)));
  let hi = Math.max(0, Math.min(L, Math.max(s1, s2)));
  const p1 = [a[0] + dir[0] * lo, a[1] + dir[1] * lo];
  const p2 = [a[0] + dir[0] * hi, a[1] + dir[1] * hi];
  const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const normal = insideNormal(outlinePoints, a, b);
  const label = {
    x: Math.round(mid[0] + normal[0] * STD.exitInset),
    y: Math.round(mid[1] + normal[1] * STD.exitInset),
  };
  return {
    x1: Math.round(p1[0]),
    y1: Math.round(p1[1]),
    x2: Math.round(p2[0]),
    y2: Math.round(p2[1]),
    label,
    span: hi - lo,
  };
}

// A default-width (STD.doorLen) door centered on the wall point nearest to
// `point`. Used for a plain click and for door detection.
export function doorFor(outlinePoints, point) {
  if (!outlinePoints || outlinePoints.length < 3) return null;
  const near = nearestPointOnPolyline([point.x, point.y], outlinePoints, true);
  if (!near) return null;
  const n = outlinePoints.length;
  const a = outlinePoints[near.segIndex];
  const b = outlinePoints[(near.segIndex + 1) % n];
  const { s: sCenter, L } = projectOntoEdge(a, b, { x: near.x, y: near.y });
  if (L === 0) return null;

  const half = STD.doorLen / 2;
  let s1 = sCenter - half;
  let s2 = sCenter + half;
  if (s1 < 0) { s2 += -s1; s1 = 0; }
  if (s2 > L) { s1 -= (s2 - L); s2 = L; }
  if (s1 < 0) s1 = 0;
  return doorOnEdge(outlinePoints, a, b, s1, s2);
}

// A door whose width the user dragged: from the wall point under `pDown` to the
// projection of `pUp` on that SAME edge, so both ends stay on one wall segment.
// Returns { ..., span } so the caller can fall back to doorFor on a tiny drag.
export function doorSpanFor(outlinePoints, pDown, pUp) {
  if (!outlinePoints || outlinePoints.length < 3) return null;
  const near = nearestPointOnPolyline([pDown.x, pDown.y], outlinePoints, true);
  if (!near) return null;
  const n = outlinePoints.length;
  const a = outlinePoints[near.segIndex];
  const b = outlinePoints[(near.segIndex + 1) % n];
  const { s: s1, L } = projectOntoEdge(a, b, pDown);
  if (L === 0) return null;
  const { s: s2 } = projectOntoEdge(a, b, pUp);
  return doorOnEdge(outlinePoints, a, b, s1, s2);
}
