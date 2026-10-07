// assemble.js
// Last stage of AutoBuild: the detected rooms / halls / symbols in image pixels
// become ready-to-add studio items at the normalised scale, with the outline kept
// to straight walls and a review reason for everything that is a guess.
// Only existing studio item types are emitted: room (cls room / core / void),
// hall, stair, door, compass. Pure. Depends on: ../document.js, ../geometry.js.

import { newId, doorFor } from '../document.js';
import { flagOutliers, floorPrior } from './text.js';
import { cleanRing } from '../fixOverlaps.js';
import { nearestPointOnPolyline, pointInPolygon } from '../geometry.js';
import { extendOutline } from './outline.js';
import { measureOutline, pullGaps } from './outlineFit.js';
import { floorLead, fixForFloor } from './floorRule.js';

const LABEL = () => ({ pinned: false, x: null, y: null, fontSize: null });

// Rooms' median short side -> the scale that makes it prof.targetRoom plan units (quarter steps).
export function pickScale(kept, textH, w, h, prof, targetRoom) {
  const sizes = kept.filter((r) => !r.unlabeled).map((r) => {
    if (r.points) {
      const xs = r.points.map((p) => p[0]), ys = r.points.map((p) => p[1]);
      return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
    return Math.min(r.w, r.h);
  }).filter((v) => v >= textH * 1.2).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  let scale = median ? Math.max(prof.minScale, Math.min(prof.maxScale, Math.round((targetRoom / median) * 4) / 4)) : 1;
  while (scale > prof.minScale && Math.max(w, h) * scale > prof.maxSide) scale -= 0.25;
  return scale;
}

// Every outline edge axis-parallel: a slanted edge becomes a step whose corner lies inside the building.
export function rectilinear(pts, inside) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push(a);
    if (a[0] !== b[0] && a[1] !== b[1]) out.push(inside([b[0], a[1]]) || !inside([a[0], b[1]]) ? [b[0], a[1]] : [a[0], b[1]]);
  }
  const dedup = out.filter((p, i) => { const q = out[(i + 1) % out.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  return dedup.filter((p, i) => {
    const a = dedup[(i + dedup.length - 1) % dedup.length], b = dedup[(i + 1) % dedup.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
}

function reasonFor(r, floorDigit, odd) {
  if (r.kind) return r.leaky ? 'Walls unclear here; check the room shape' : '';
  if (!r.number) {
    if (r.touchesPin) return 'Number hidden under the You-Are-Here pin';
    if (r.guess) return `Number unclear (best guess ${r.guess}); left blank, please check`;
    return r.unlabeled ? 'Walled-in space with no readable number' : 'Text in this room could not be read';
  }
  if (r.floorFixed) return `Read as ${r.floorFixed} but this is floor ${floorDigit}: changed to ${r.number}`;
  if (r.inferred) return 'Number inferred from the rooms beside it';
  if (r.near) return `Read as ${r.number} but one character was unclear`;
  if (r.altered) return `Same number was read on two rooms; this one took its next best reading (${r.number})`;
  if (r.votes < 2) return `Number ${r.number} was read only once; check it`;
  if (r.cost > 0.6) return `Number ${r.number} needed character repairs; check it`;
  if (r.leaky) return 'Walls unclear here; check the room shape';
  if (odd.has(r.number)) return `Number ${r.number} doesn't start with ${floorDigit} like the rest; check it`;
  return '';
}

// ctx: { w, h, L, textH, kept, halls, elevators, stairs, exits, compass, footFinal, polyRing, prof, opts }
export function assemble(ctx) {
  const { w, h, textH, kept, halls, elevators, stairs, exits, compass, footFinal, polyRing, prof, opts } = ctx;
  const inkMask = ctx.ink || null;
  const scale = pickScale(kept, textH, w, h, prof, opts.targetRoom || prof.targetRoom);
  const S = (v) => Math.round((v * scale) / 5) * 5;
  const items = [], review = [];
  halls.forEach((hh) => items.push({ id: newId(), type: 'hall', x: S(hh.x), y: S(hh.y), w: Math.max(5, S(hh.w)), h: Math.max(5, S(hh.h)) }));

  const sure = kept.filter((r) => r.number && r.votes >= 2 && !r.near).map((r) => r.number);
  const odd = new Set(flagOutliers(sure).map((x) => (typeof x === 'string' ? x : x.number)));
  const lead = floorLead(opts.floor);
  const priorAll = lead && lead.length === 1 ? { digit: lead, share: 1, n: 99 } : floorPrior(sure);
  const floorDigit = priorAll ? priorAll.digit : '';
  const isOdd = (n) => flagOutliers([n], priorAll).length > 0;

  const used = new Set();
  for (const r of kept) {
    const cls = r.kind === 'void' ? 'void' : r.kind === 'restroom' || r.kind === 'elevator' ? 'core' : 'room';
    let number = cls === 'room' ? r.number : '';
    let guess = r.guess;
    let floorFixed = '';
    if (number && lead) { const fx = fixForFloor(number, r.ranked, lead, used); number = fx.number; floorFixed = fx.number ? fx.from : ''; if (fx.from && !fx.number) guess = fx.from; }
    // a number that breaks the floor's own pattern and was not read firmly is wrong more often than right: blank it, keep the guess for the note
    if (number && (odd.has(number) || isOdd(number)) && r.votes < 6) { guess = number; number = ''; }
    if (number && used.has(number)) number = ''; // a number never leaves twice
    if (number) used.add(number);
    const name = cls === 'core' ? (r.kind === 'restroom' ? 'Restrooms' : 'Elevator') : cls === 'void' ? '' : r.name;
    const base = {
      id: newId(), type: 'room', cls, number, name, label: LABEL(), showName: cls === 'room' && !!name, section: null,
    };
    // a polygon is cleaned after snapping (no repeated points or spikes); if it collapsed it becomes its box
    const ring = r.points ? cleanRing(r.points.map(([x, y]) => [S(x), S(y)])) : null;
    const pbox = r.points ? (() => {
      const xs = r.points.map((q) => S(q[0])), ys = r.points.map((q) => S(q[1]));
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(5, Math.max(...xs) - Math.min(...xs)), h: Math.max(5, Math.max(...ys) - Math.min(...ys)) };
    })() : null;
    const item = r.points
      ? (ring ? { ...base, shape: 'poly', points: ring } : { ...base, shape: 'rect', ...pbox })
      : { ...base, shape: 'rect', x: S(r.x), y: S(r.y), w: Math.max(5, S(r.x + r.w) - S(r.x)), h: Math.max(5, S(r.y + r.h) - S(r.y)) };
    items.push(item);
    const why = reasonFor({ ...r, number, guess, floorFixed }, floorDigit, odd);
    if (why && cls === 'room') review.push({ id: item.id, reason: why });
  }
  for (const el of elevators) {
    const x0 = S(el.x - 2), y0 = S(el.y - 2);
    items.push({
      id: newId(), type: 'room', cls: 'core', shape: 'rect', x: x0, y: y0,
      w: Math.max(30, S(el.x + el.w + 2) - x0), h: Math.max(30, S(el.y + el.h + 2) - y0),
      number: '', name: 'Elevator', label: LABEL(), showName: false, section: null,
    });
  }
  for (const s of stairs) items.push({ id: newId(), type: 'stair', x: S(s.x), y: S(s.y), w: Math.max(30, S(s.w)), h: Math.max(30, S(s.h)), dir: s.dir });

  const inside = ([x, y]) => {
    const px = Math.round(x / scale), py = Math.round(y / scale);
    return px >= 0 && py >= 0 && px < w && py < h && !!footFinal[py * w + px];
  };
  let outline = rectilinear(polyRing.map(([x, y]) => [S(x), S(y)]), inside);
  // after scaling and snapping, every shape's corners must lie in or on the outline; else add its box
  // a stair symbol well away from the building is a misread of something on the paper margin: not a stair of this floor
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type !== 'stair') continue;
    const near = nearestPointOnPolyline([it.x + it.w / 2, it.y + it.h / 2], outline, true);
    if (!near || (near.dist > 40 + Math.max(it.w, it.h) && !pointInPolygon([it.x + it.w / 2, it.y + it.h / 2], outline))) items.splice(i, 1);
  }
  outline = extendOutline(outline, items.filter((it) => it.type === 'room' || it.type === 'hall' || it.type === 'stair'), 5, 3);
  const mopt = { tol: Math.max(3, Math.round(textH * 0.3)), hole: Math.max(16, textH * 4), minRun: Math.max(10, textH * 2) };
  // a closing line across empty paper (no wall behind it) moves in to the rooms next to it
  if (inkMask) outline = pullGaps(outline, items.filter((it) => it.type === 'room' || it.type === 'hall' || it.type === 'stair'), inkMask, w, h, scale, { ...mopt, minPull: Math.max(15, 2.5 * textH * scale) });
  const reach = Math.max(w, h) * scale * 0.1;
  for (const ex of exits) {
    const near = nearestPointOnPolyline([ex.cx * scale, ex.cy * scale], outline, true);
    if (!near || near.dist > reach) continue;
    const door = doorFor(outline, { x: ex.cx * scale, y: ex.cy * scale });
    if (!door) continue;
    // one doorway per exit sign: a sign seen twice (or two signs beside one door) must not give two doors on top of each other
    const mx = (door.x1 + door.x2) / 2, my = (door.y1 + door.y2) / 2;
    if (items.some((d) => d.type === 'door' && Math.hypot((d.x1 + d.x2) / 2 - mx, (d.y1 + d.y2) / 2 - my) < 60)) continue;
    items.push({ id: newId(), type: 'door', ...door, kind: 'EXIT' });
  }
  if (compass) {
    // the compass graphic is big; slide it away from the building until it clears
    let cx = compass.x * scale, cy = compass.y * scale;
    const ccx = (w * scale) / 2, ccy = (h * scale) / 2;
    const clear = () => {
      for (let a = 0; a < 16; a++) if (inside([cx + 66 * Math.cos((a * Math.PI) / 8), cy + 66 * Math.sin((a * Math.PI) / 8)])) return false;
      return true;
    };
    for (let k = 0; k < 80 && !clear(); k++) {
      const dx = cx - ccx, dy = cy - ccy, n = Math.hypot(dx, dy) || 1;
      cx += (dx / n) * 8; cy += (dy / n) * 8;
    }
    // and it stays on the page (the compass graphic is about 130 units across)
    cx = Math.max(75, Math.min(w * scale - 75, cx)); cy = Math.max(75, Math.min(h * scale - 75, cy));
    items.push({ id: newId(), type: 'compass', x: Math.round(cx), y: Math.round(cy), deg: compass.deg });
  }
  // honest report: which stretches of the outline have a wall behind them in the photo
  const outlineInfo = inkMask ? measureOutline(outline, inkMask, w, h, scale, mopt)
    : { segments: outline.map((a, i) => ({ a, b: outline[(i + 1) % outline.length], supported: 0, kind: 'gap' })), coverage: 0, notes: [] };
  return { floor: { points: outline }, outlineInfo, outlinePx: polyRing, items, review, scale, viewW: Math.round(w * scale), viewH: Math.round(h * scale) };
}
