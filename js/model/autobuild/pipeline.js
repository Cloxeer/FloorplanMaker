// pipeline.js
// AutoBuild: straightened plan raster in -> floor outline, rooms, hallways,
// stairs, elevators, exits and compass out, as ready-to-add document items
// plus a list of things the user should double-check.
// `opts.ocr(image) -> Promise<{text, conf}>` is injected (Tesseract in the
// worker), so this module stays pure and testable in Node.
// Depends on: raster/layers/faces/text/symbols/shapes (same folder), js/model/document.js.

import { components, erode, dilate } from './raster.js';
import { analyze } from './layers.js';
import { extractFaces, footprint, traceOuter, simplifyRing, orthogonalize } from './faces.js';
import { estimateTextHeight, findGlyphs, buildLines, renderLine, titleCase, repairRuns, floorPrior, inferFormat } from './text.js';
import { readLines, interpret } from './reading.js';
import { renderCrop } from './ocrRender.js';
import { maskPosterChrome } from './chrome.js';
import { resolveProfile } from './profile.js';
import { assemble } from './assemble.js';
import { unionBody } from './outline.js';
import { fitRing } from './outlineFit.js';
import { recoverUnlabeledCells } from './recall.js';
import { findExitSigns, findElevators, findStairs } from './symbols.js';
import { runHallPass } from './hallpass.js';
import { tidyRooms } from '../tidyRooms.js';
import { findCompassBest } from './compass.js';
import { faceShape, hallRects, alignShapes, resolveOverlaps, growFromBox, snapToWalls } from './shapes.js';

// share of box `a` that lies inside box `b`
const overlap = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.max(1, a.w * a.h);
};

// One face holding labels that are not stacked on one another = two rooms glued together by a wall gap.
function leaks(lines, textH, prof) {
  if (lines.length > prof.maxLinesPerRoom) return true;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) > textH * prof.leakCols) return true;
      if (Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) > textH * prof.leakRows) return true;
    }
  }
  return false;
}

// True when long wall strokes close in on (cx, cy) from all four sides
// (the point is inside a room cell, so what was found there is a label, not a compass).
function walledIn(ink, w, h, cx, cy, r, textH) {
  const reach = Math.round(Math.max(10 * r, 12 * textH));
  const need = Math.max(4 * r, 4 * textH);
  const stroke = (x, y, dx, dy) => { // length of the ink stroke through (x,y) perpendicular to the ray
    let n = 1;
    for (let k = 1; k < need * 2; k++) {
      const px = x + (dy ? k : 0), py = y + (dx ? k : 0);
      if (px < w && py < h && ink[py * w + px]) n++; else break;
    }
    for (let k = 1; k < need * 2; k++) {
      const px = x - (dy ? k : 0), py = y - (dx ? k : 0);
      if (px >= 0 && py >= 0 && ink[py * w + px]) n++; else break;
    }
    return n;
  };
  let sides = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = Math.round(3 * r); d <= reach; d++) {
      const x = Math.round(cx + dx * d), y = Math.round(cy + dy * d);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      let hit = false;
      for (let o = -1; o <= 1 && !hit; o++) {
        const xx = dx ? x : x + o, yy = dy ? y : y + o;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && ink[yy * w + xx]) hit = stroke(xx, yy, dx, dy) >= need;
      }
      if (hit) { sides++; break; }
    }
  }
  return sides >= 4;
}

export async function buildFromPlan(img0, opts = {}) {
  const prog = opts.onProgress || (() => {});
  const img = opts.chrome === false ? img0 : maskPosterChrome(img0).img; // the legend sidebar and the caption band are not the building
  const { width: w, height: h } = img;
  const L = Math.max(w, h);
  const prof = resolveProfile(opts.profile);

  prog(0.02, 'Reading the plan');
  const layers = analyze(img);
  const ink8 = components(layers.ink, w, h, 1, true);
  const textH = estimateTextHeight(ink8.comps, L);
  const foot = footprint(layers, w, h, L);
  const footArea = foot.mask.reduce((s, v) => s + v, 0);

  prog(0.08, 'Finding stairs, exits and the elevator');
  const exits = findExitSigns(layers, w, h, textH);
  const elevators = findElevators(layers, w, h, textH, ink8.comps);
  const stairs = findStairs(layers, w, h, textH);
  // the building body without thin things attached to it (a compass can sit within the closing reach)
  const bodyR = Math.max(6, Math.round(foot.R * 1.3));
  const body = dilate(erode(foot.mask, w, h, bodyR), w, h, bodyR);
  let compass = null;
  try { compass = findCompassBest(layers, ink8.comps, body, w, h, textH); } catch { compass = null; }
  // a small room label can look like a compass; a real compass is never walled in on all four sides
  if (compass && walledIn(layers.ink, w, h, compass.x, compass.y, Math.max(compass.r, textH), textH)) compass = null;
  const icons = [
    ...elevators.map((o) => ({ x: o.x - 3, y: o.y - 3, w: o.w + 6, h: o.h + 6 })),
    ...exits.map((o) => ({ x: o.x - 3, y: o.y - 3, w: o.w + 6, h: o.h + 6 })),
    ...stairs.map((o) => ({ x: o.x - 4, y: o.y - 4, w: o.w + 8, h: o.h + 8 })),
  ];
  if (compass) icons.push({ x: compass.x - compass.r * 1.6, y: compass.y - compass.r * 1.6, w: compass.r * 3.2, h: compass.r * 3.2 });
  const inIcon = (l) => {
    const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
    return icons.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
  };

  prog(0.12, 'Finding walls and rooms');
  const e = Math.max(1, Math.round(L / 700));
  const minArea = Math.max(40, textH * textH * 1.4); // small cells (S122, T106) count when they hold text
  const minSide = Math.max(6, textH * 0.6);
  const LEVELS = prof.levels;
  const accepted = []; // { f, lines, F, r, level }
  const takenGlyphs = new Set();
  let F1 = null, lines1 = null;
  for (const r of LEVELS) {
    const F = extractFaces(img, layers, { closeR: r, foot });
    if (r === 1) F1 = F;
    const { glyphs } = findGlyphs(ink8, w, h, F.labels, F.outsideIds, textH, r + 3);
    const lines = buildLines(glyphs, textH);
    if (r === 1) lines1 = lines;
    const byId = new Map(F.faces.map((f) => [f.id, f]));
    for (const [faceId, all] of lines) {
      const ls = all.filter((l) => !inIcon(l) && !takenGlyphs.has(l.glyphs[0].id)).slice(0, prof.maxLinesPerRoom);
      if (!ls.length) continue;
      const f = byId.get(faceId);
      const bw = f.x1 - f.x0 + 1, bh = f.y1 - f.y0 + 1;
      if (f.area < minArea || Math.min(bw, bh) < minSide || f.area > 0.3 * footArea) continue;
      if (icons.some((b) => overlap({ x: f.x0, y: f.y0, w: bw, h: bh }, b) > 0.5)) continue;
      const bad = leaks(ls, textH, prof);
      if (bad && r < LEVELS[LEVELS.length - 1]) continue;
      ls.forEach((l) => l.glyphs.forEach((g) => takenGlyphs.add(g.id)));
      accepted.push({ f, lines: ls, F, r, level: r, leaky: bad });
    }
    prog(0.12 + 0.06 * (r / LEVELS.length), 'Finding walls and rooms');
  }

  // free paper that only exists because the paper edge was sealed (no text, touching the seal) is not building
  const blankIds = new Set();
  {
    const touched = new Set();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!layers.seal[y * w + x]) continue;
      for (let d = 3; d <= 6; d += 3) {
        for (const id of [F1.labels[y * w + x - d], F1.labels[y * w + x + d], F1.labels[(y - d) * w + x], F1.labels[(y + d) * w + x]]) if (id) touched.add(id);
      }
    }
    for (const id of touched) if (!(lines1 && lines1.has(id)) && !accepted.some((c) => c.r === 1 && c.f.id === id)) blankIds.add(id);
  }
  const footFinal = foot.mask.slice();
  if (blankIds.size) for (let i = 0; i < footFinal.length; i++) if (blankIds.has(F1.labels[i])) footFinal[i] = 0;

  // OCR the accepted lines, several renderings each; the grammar votes
  const jobs = [];
  accepted.forEach((c) => c.lines.forEach((l) => jobs.push(l)));
  if (opts.ocr) {
    await readLines(jobs, opts.ocr, (l, th, kind) => (kind === 'old' ? renderLine(layers.gray, ink8.labels, w, h, l, th) : renderCrop(layers.gray, w, h, l, { height: th, mode: 'binary' })), prof, (done, n) => {
      prog(0.2 + 0.65 * (done / Math.max(1, n)), `Reading room numbers ${done}/${n}`);
    }, opts.concurrency || 3);
  }

  prog(0.88, 'Placing rooms');
  const rooms = [];
  const aspectOf = (f) => Math.max(f.x1 - f.x0 + 1, f.y1 - f.y0 + 1) / Math.max(1, Math.min(f.x1 - f.x0 + 1, f.y1 - f.y0 + 1));
  const notRooms = [];
  // the confident numbers tell the floor digit and the number format; both break ties between readings
  const sure = [];
  for (const c of accepted) {
    const d = interpret(c.lines, prof);
    if (d.number && !d.kind && d.votes >= 2 && d.cost === 0) sure.push(d.number);
  }
  const fp = floorPrior(sure);
  const rctx = { prior: fp && fp.share >= 0.5 ? fp.digit : '', format: prof.useFormat && sure.length >= 6 ? inferFormat(sure) : null };
  for (const c of accepted) {
    const d = interpret(c.lines, prof, rctx);
    const { name, ranked } = d;
    const number = d.kind ? '' : d.number;
    // a stair label ("ST1") belongs to the stair symbol, not to a room
    if (d.kind === 'stair') { notRooms.push(c); continue; }
    let shape = faceShape(c.F.labels, w, h, c.f, Math.max(e + c.r, layers.wallHalf || 0));
    const sloppy = c.leaky || (shape.kind === 'rect' && c.f.fill < 0.6);
    if (sloppy) {
      // walls don't close around this room: grow a box out from its text until it meets walls
      const box = {
        x0: Math.min(...c.lines.map((l) => l.x0)), y0: Math.min(...c.lines.map((l) => l.y0)),
        x1: Math.max(...c.lines.map((l) => l.x1)), y1: Math.max(...c.lines.map((l) => l.y1)),
      };
      const g = growFromBox(c.F.wallMask, w, h, box, Math.round(L * 0.5));
      const gg = e + c.r;
      shape = { kind: 'rect', x: g.x0 - gg, y: g.y0 - gg, w: g.x1 - g.x0 + 1 + 2 * gg, h: g.y1 - g.y0 + 1 + 2 * gg };
    }
    let pin = 0;
    for (let y = c.f.y0; y <= c.f.y1; y += 2) for (let x = c.f.x0; x <= c.f.x1; x += 2) if (layers.blue[y * w + x]) pin++;
    const room = {
      ...shape, number, name: name ? titleCase(name) : '', votes: d.votes, cost: d.cost, kind: d.kind, near: d.near, guess: d.guess,
      f: c.f, touchesPin: pin > 12, leaky: c.leaky, id: c.f.id, aspect: aspectOf(c.f), ranked,
    };
    const roomy = room.aspect <= prof.roomAspectMax && c.f.area <= prof.roomAreaMax * footArea;
    if (number || name || d.kind || (opts.keepUnread !== false && prof.unlabeledRooms && roomy)) rooms.push(room); else notRooms.push(c);
  }
  // each room number can be on only one room: the better-voted room keeps it, the other tries its next reading
  {
    const order = rooms.filter((r) => r.number).sort((a, b) => b.votes - a.votes || a.cost - b.cost);
    const used = new Set();
    for (const r of order) {
      const pick = r.ranked.find((c) => !used.has(c.val));
      if (pick) { r.number = pick.val; r.votes = pick.n; r.cost = pick.cost / pick.n; used.add(pick.val); r.altered = pick.val !== r.ranked[0].val; r.near = !!pick.near; }
      else { r.number = ''; r.votes = 0; r.altered = true; }
    }
  }
  // cells that are walled in on all four sides but whose text could not be found: still rooms, number left blank
  {
    const used = new Set(accepted.map((c) => c.f.id));
    const sides = (f) => {
      const near = 3;
      const frac = (xa, ya, xb, yb) => {
        let n = 0, t = 0;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { t++; if (F1.wallMask[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))]) n++; }
        return t ? n / t : 0;
      };
      return Math.min(
        frac(f.x0 - near, f.y0, f.x0 - 1, f.y1), frac(f.x1 + 1, f.y0, f.x1 + near, f.y1),
        frac(f.x0, f.y0 - near, f.x1, f.y0 - 1), frac(f.x0, f.y1 + 1, f.x1, f.y1 + near),
      );
    };
    for (const f of F1.faces) {
      if (used.has(f.id) || blankIds.has(f.id)) continue;
      const bw = f.x1 - f.x0 + 1, bh = f.y1 - f.y0 + 1;
      if (f.area < textH * textH * 14 || f.area > 0.06 * footArea || Math.min(bw, bh) < textH * 2) continue;
      if (Math.max(bw, bh) / Math.min(bw, bh) > 2.6 || f.fill < 0.9) continue;
      const box = { x: f.x0, y: f.y0, w: bw, h: bh };
      if (icons.some((b) => overlap(box, b) > 0.4)) continue;
      if (rooms.some((r) => overlap(box, { x: r.f.x0, y: r.f.y0, w: r.f.x1 - r.f.x0 + 1, h: r.f.y1 - r.f.y0 + 1 }) > 0.3)) continue;
      if (sides(f) < 0.6) continue;
      rooms.push({ kind: 'rect', x: f.x0 - e - 1, y: f.y0 - e - 1, w: bw + 2 * (e + 1), h: bh + 2 * (e + 1), number: '', name: '', votes: 0, cost: 9, f, touchesPin: false, leaky: false, id: f.id, aspect: 1, ranked: [], unlabeled: true });
    }
  }
  // an unnumbered cell that only holds an elevator / stair symbol is that symbol, not a room
  // walled cells the text pass missed (split by a number or symbol, hidden under the pin)
  const recoveredIds = new Set();
  {
    const bx = (r) => ({ x: r.f.x0, y: r.f.y0, w: r.f.x1 - r.f.x0 + 1, h: r.f.y1 - r.f.y0 + 1 });
    const extra = recoverUnlabeledCells(F1, layers, {
      w, h, textH, footArea, blankIds,
      taken: rooms.map(bx),
      icons: icons.filter((b) => !stairs.some((st) => b.x === st.x - 4 && b.y === st.y - 4)),
      stairs: stairs.map((st) => ({ x: st.x, y: st.y, w: st.w, h: st.h })),
    });
    for (const c of extra) {
      rooms.push({
        kind: 'rect', x: c.x - e - 1, y: c.y - e - 1, w: c.w + 2 * (e + 1), h: c.h + 2 * (e + 1),
        number: '', name: '', votes: 0, cost: 9, f: c.f, touchesPin: c.reason === 'under-pin', leaky: false,
        id: c.f.id, aspect: 1, ranked: [], unlabeled: true, recovered: c.reason,
      });
      c.ids.forEach((id) => recoveredIds.add(id));
    }
  }
  const symbolBoxes = [...elevators, ...stairs];
  const sym = (r) => symbolBoxes.some((b) => overlap(b, { x: r.f.x0, y: r.f.y0, w: r.f.x1 - r.f.x0 + 1, h: r.f.y1 - r.f.y0 + 1 }) > 0.5);
  const kept = rooms.filter((r) => (r.kind === 'elevator' || !(r.number || r.name || r.kind) ? !sym(r) : true));
  const keptIds = new Set(kept.map((r) => r.id));

  // corridors: level-1 faces that carry no text and are not room cells
  const roomIds = new Set(accepted.filter((c) => c.r === 1 && keptIds.has(c.f.id)).map((c) => c.f.id));
  const unlabeledIds = new Set(kept.filter((r) => r.unlabeled).map((r) => r.id));
  const corridorMask = new Uint8Array(w * h);
  for (let i = 0; i < corridorMask.length; i++) {
    const id = F1.labels[i];
    if (id && !roomIds.has(id) && !blankIds.has(id) && !unlabeledIds.has(id) && !recoveredIds.has(id)) corridorMask[i] = 1;
  }
  for (let i = 0; i < corridorMask.length; i++) if (layers.colored[i] && foot.mask[i] && !F1.labels[i]) corridorMask[i] = 1;
  for (const r of accepted) {
    if (r.r === 1 || !keptIds.has(r.f.id)) continue;
    // rooms found at coarser levels: carve their area out of the corridor mask
    for (let y = r.f.y0; y <= r.f.y1; y++) for (let x = r.f.x0; x <= r.f.x1; x++) if (r.F.labels[y * w + x] === r.f.id) corridorMask[y * w + x] = 0;
  }
  const halls = hallRects(corridorMask, w, h, Math.max(minSide * 1.5, textH * 2), textH * prof.hallMinLong, L * prof.hallMaxShort);

  // numbers along a row that are missing or off get filled from their neighbours
  if (prof.inferRuns) repairRuns(kept);

  // outline: the building body (thin attachments such as the compass removed), kept to straight walls
  // united with every room / hall / stair / elevator so nothing lies outside it
  const bodyMask = unionBody(footFinal, [...kept, ...halls, ...elevators, ...stairs], w, h, bodyR, Math.max(2, e * 3));
  const ringSrc = erode(bodyMask, w, h, e);
  const ring = orthogonalize(simplifyRing(traceOuter(ringSrc, w, h), Math.max(3, L / 150)), 16);
  // hug the real wall lines: no tiny steps that are not walls, edges on the wall stripe (photo pixels)
  const wallInk = (layers.wallInk || layers.ink).map((v, i) => (v && layers.paper[i] ? 1 : 0)); // wall ink on paper only: not the paper edge, frame or caption
  const sides = kept.filter((r) => !r.unlabeled).map((r) => (r.points ? Math.min(Math.max(...r.points.map((q) => q[0])) - Math.min(...r.points.map((q) => q[0])), Math.max(...r.points.map((q) => q[1])) - Math.min(...r.points.map((q) => q[1]))) : Math.min(r.w, r.h))).filter((v) => v >= textH * 1.2).sort((a, b) => a - b);
  const medRoom = sides.length ? sides[Math.floor(sides.length / 2)] : textH * 6;
  const polyRing = fitRing(ring, wallInk, w, h, {
    minStep: 0.15 * medRoom, reach: Math.max(5, Math.round(textH * 0.8)), wallT: Math.max(2, layers.wallT || 3),
    inside: ([x, y]) => !!bodyMask[Math.max(0, Math.min(h - 1, Math.round(y))) * w + Math.max(0, Math.min(w - 1, Math.round(x)))],
  }).map(([x, y]) => [x, y]);

  const keptRaw = opts.debug ? kept.map((r) => ({ number: r.number, x: r.x, y: r.y, w: r.w, h: r.h, pts: r.points })) : null;
  alignShapes([...kept, ...halls, { points: polyRing }], Math.max(4, e * 3 + 1));
  snapToWalls(kept, layers.wallInk || layers.ink, w, h, Math.max(3, e * 3));
  resolveOverlaps(kept);
  const keptFinal = opts.debug ? kept.map((r) => ({ number: r.number, x: r.x, y: r.y, w: r.w, h: r.h, pts: r.points })) : null;

  prog(0.91, 'Laying out the plan');
  const out = assemble({ w, h, L, textH, kept, halls, elevators, stairs, exits, compass, footFinal: bodyMask, polyRing, ink: wallInk, prof, opts });
  prog(0.93, 'Filling in the hallways');
  const pass = await runHallPass(out, opts); // second hallway pass; never throws, compass stays last
  let items = pass.items;
  try { items = tidyRooms({ floor: out.floor, items }).doc.items; } catch (e) { /* keep the untidied plan */ } // rooms meet the walls and corners on the 5-grid
  prog(0.97, 'Adding the compass');
  prog(1, 'Done');
  return {
    ...out,
    items,
    hallPass: pass.hallPass,
    stats: { w, h, textH, rooms: kept.length, accepted: accepted.length, halls: halls.length, stairs: stairs.length, exits: exits.length, elevators: elevators.length, elevDensity: elevators.map((q) => +q.density.toFixed(2)), lines: jobs.length },
    debug: { compass, exits, elevators, stairs, jobs, gray: layers.gray, inkLabels: ink8.labels, keptRaw, keptFinal },
  };
}
