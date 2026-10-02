// fixLabels.js
// Pure proposals for the label warnings of validate.js: 'label-outside-shape', 'label-in-other-room',
// 'label-tiny', and 'void-with-label'. One Fix per room: reset a tiny font, unpin a label that sits
// outside (it falls back to the centroid) when that puts it inside the room and not inside a smaller
// room, else pin it on an interior point that does. A void that carries free text (not a room-number)
// is cleared; one that carries something number-like is left to the user.
// Fix = { key, kind, title, notes, ids, doc }; Manual = { ids, message }.
// Depends on: js/model/document.js (labelPos, roomCentroid, roomPolygon, NUMBER_RE), js/model/geometry.js.

import { labelPos, roomCentroid, roomPolygon, NUMBER_RE } from './document.js';
import { pointInPolygon, polygonArea, bbox } from './geometry.js';

const MIN_FONT = 12;
const nameOf = (it) => [it.name, it.number].filter(Boolean).join(' ') || it.id;

function makeEnv(doc) {
  const rooms = ((doc && doc.items) || []).filter((it) => it && it.type === 'room' && it.cls !== 'void' && (it.shape === 'poly' ? Array.isArray(it.points) : typeof it.w === 'number'));
  const info = rooms.map((it) => { const pts = roomPolygon(it); return { it, pts, area: Math.abs(polygonArea(pts)), box: bbox(pts) }; });
  const ownerAt = (x, y) => {
    let best = null;
    for (const r of info) {
      const b = r.box;
      if (x < b.x || y < b.y || x > b.x + b.w || y > b.y + b.h) continue;
      if (pointInPolygon([x, y], r.pts) && (!best || r.area < best.area)) best = r;
    }
    return best;
  };
  return { info, ownerAt };
}

// problems of one room's label, as in validate.js
function labelOk(env, r, pos) {
  const owner = env.ownerAt(pos.x, pos.y);
  const hasText = !!(r.it.number || r.it.name);
  if (owner && owner.it !== r.it && hasText) return false;
  return pointInPolygon([pos.x, pos.y], r.pts);
}

// an interior point whose smallest owning room is this one, as far from the edges as a coarse scan finds
function interiorSpot(env, r) {
  const b = r.box, N = 14;
  let best = null, bestScore = -Infinity;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const x = Math.round(b.x + (i + 0.5) * b.w / (N + 1)), y = Math.round(b.y + (j + 0.5) * b.h / (N + 1));
    if (!labelOk(env, r, { x, y })) continue;
    const score = -Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
    if (score > bestScore) { best = { x, y }; bestScore = score; }
  }
  return best;
}

function analyze(doc) {
  const fixes = [], manual = [];
  if (!doc || !Array.isArray(doc.items)) return { fixes, manual };
  const env = makeEnv(doc);
  for (const r of env.info) {
    const it = r.it, lab = it.label || {};
    const tiny = typeof lab.fontSize === 'number' && lab.fontSize < MIN_FONT;
    const bad = !labelOk(env, r, labelPos(it));
    if (!tiny && !bad) continue;
    let label = { ...lab }; const notes = [];
    if (tiny) { label.fontSize = null; notes.push(`${nameOf(it)}: label text size reset to the standard size`); }
    if (bad) {
      const centroid = roomCentroid(it);
      if (labelOk(env, r, centroid)) {
        label = { ...label, pinned: false, x: null, y: null };
        notes.push(`${nameOf(it)}: label moved back to the middle of the room`);
      } else {
        const spot = interiorSpot(env, r);
        if (spot) { label = { ...label, pinned: true, x: spot.x, y: spot.y }; notes.push(`${nameOf(it)}: label moved to a spot inside the room`); }
        else { manual.push({ ids: [it.id], message: `The label for ${nameOf(it)} cannot sit inside its room without landing in another one; move or resize the room.` }); continue; }
      }
    }
    const next = { ...it, label };
    fixes.push({
      key: `label:${it.id}`, kind: 'label', title: `Fix the label of ${nameOf(it)}`, notes, ids: [it.id],
      doc: { ...doc, items: doc.items.map((x) => (x === it ? next : x)) },
    });
  }
  // voids must not carry a number or a name
  for (const it of doc.items) {
    if (!it || it.type !== 'room' || it.cls !== 'void' || !(it.number || it.name)) continue;
    const text = [it.number, it.name].filter(Boolean).join(' ');
    if ((it.number && NUMBER_RE.test(String(it.number))) || /\d/.test(text)) {
      manual.push({ ids: [it.id], message: `The open-to-below space "${text}" has a room number or name on it. It may really be a room; change its type or clear the text yourself.` });
      continue;
    }
    fixes.push({
      key: `label:void:${it.id}`, kind: 'void-label', title: 'Clear the text on an open-to-below space', notes: [`Removed "${text}" from a void (voids carry no name or number)`], ids: [it.id],
      doc: { ...doc, items: doc.items.map((x) => (x === it ? { ...it, number: '', name: '' } : x)) },
    });
  }
  return { fixes, manual };
}

const cache = new WeakMap();
function get(doc) {
  if (doc && typeof doc === 'object') { if (!cache.has(doc)) cache.set(doc, analyze(doc)); return cache.get(doc); }
  return analyze(doc);
}

export const findLabelFixes = (doc) => get(doc).fixes;
export const findManualLabels = (doc) => get(doc).manual;
