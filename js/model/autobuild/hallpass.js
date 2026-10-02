// hallpass.js
// AutoBuild's second hallway pass. After the plan is assembled (rooms, stairs, doors, outline), fill in
// the corridor space the first pass missed (fillHallways), connect hallways up with the hall fixes of the
// editor (findHallFixes, only fixes whose ONLY change is adding/extending/merging HALL items) and then
// clean up: pockets and slivers go, every new corridor must join the network (bridged through free
// space) or it is dropped. Rounds repeat until nothing changes, so a second run adds nothing.
// Rooms, stairs and doors are never touched. Never throws: on any problem the pre-pass items come back.
//   runHallPass({ items, floor }, opts?) -> { items, hallPass }   (compass items stay last)
//   opts: hallPass:false (skip), fillHallways (inject), findHallFixes (inject), maxSteps, budgetMs
// Depends (lazily): js/model/hallFill.js, js/model/fixHalls.js, js/model/attention.js, js/model/document.js.

const KINDS = new Set(['hall-overlap', 'hall-connect', 'room-hall']);
const MAX_STEPS = 200, BUDGET_MS = 2500, SLACK = 4, ROUNDS = 6;

const empty = () => ({ added: [], extended: [], fixes: 0, hallBefore: {}, notesLeft: { roomsNotTouching: 0, unconnected: 0 } });
const rectKey = (h) => `${h.x},${h.y},${h.w},${h.h}`;
const rectOf = (h) => ({ x: h.x, y: h.y, w: h.w, h: h.h });
const isHall = (i) => i.type === 'hall';
const ovl = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const rkey = (items) => items.filter(isHall).map(rectKey).sort().join('|');

function inPoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// a hall lies in the outline when its corners are inside it (a few units of slack, like the editor)
function hallInside(h, pts) {
  if (!pts || pts.length < 3) return true;
  const s = SLACK, samples = [[h.x, h.y], [h.x + h.w, h.y], [h.x, h.y + h.h], [h.x + h.w, h.y + h.h]];
  // along the edges and the middle too: a hall must not span a notch of the outline
  const nx = Math.min(40, Math.ceil(h.w / 20)), ny = Math.min(40, Math.ceil(h.h / 20));
  for (let i = 1; i < nx; i++) for (const fy of [0, 0.5, 1]) samples.push([h.x + (h.w * i) / nx, h.y + h.h * fy]);
  for (let j = 1; j < ny; j++) for (const fx of [0, 0.5, 1]) samples.push([h.x + h.w * fx, h.y + (h.h * j) / ny]);
  return samples.every(([px, py]) => (
    [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]].some(([dx, dy]) => inPoly(pts, px + dx, py + dy))));
}

// non-hall items as id -> json, to prove the pass left them alone
const others = (items) => new Map(items.filter((i) => i.type !== 'hall').map((i) => [i.id, JSON.stringify(i)]));
function sameOthers(a, b) {
  if (a.size !== b.size) return false;
  for (const [id, j] of a) if (b.get(id) !== j) return false;
  return true;
}
const hallsOk = (doc, pts) => doc.items.every((i) => i.type !== 'hall' || (
  [i.x, i.y, i.w, i.h].every(Number.isFinite) && i.w > 0 && i.h > 0 && hallInside(i, pts)));

// what the checklist would still say about these items
async function notesOf(items, floor) {
  try {
    const att = await import('../attention.js');
    return { roomsNotTouching: att.roomsNotTouchingHall(items).length, unconnected: att.unconnectedHalls({ items, floor }).length };
  } catch { return { roomsNotTouching: 0, unconnected: 0 }; }
}

// ---- clean-up: keep only corridors that look like corridors and join the network ----
const linked = (a, b) => {
  const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return (gx <= 1 && gy <= 0) || (gy <= 1 && gx <= 0);
};
function components(halls) {
  const p = halls.map((_, i) => i), f = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) if (linked(halls[i], halls[j])) p[f(i)] = f(j);
  const g = new Map();
  halls.forEach((h, i) => { const r = f(i); if (!g.has(r)) g.set(r, []); g.get(r).push(h); });
  return [...g.values()];
}
const compArea = (c) => c.reduce((s, h) => s + h.w * h.h, 0);

// a clean bridging rectangle through free space between two hall rects (null when none)
function bridge(P, Q, cx) {
  let best = null;
  const tryIt = (r, gap) => { if (gap > 1 && gap <= 3 * cx.med && (!best || gap < best.gap) && cx.free(r)) best = { gap, r }; };
  const ox = ovl(P.x, P.x + P.w, Q.x, Q.x + Q.w), oy = ovl(P.y, P.y + P.h, Q.y, Q.y + Q.h);
  if (ox >= cx.minShort) {
    const w = Math.min(ox, P.w, P.h, Q.w, Q.h), x = Math.round(Math.max(P.x, Q.x) + (ox - w) / 2);
    if (P.y + P.h <= Q.y) tryIt({ x, y: P.y + P.h, w, h: Q.y - P.y - P.h }, Q.y - P.y - P.h);
    else if (Q.y + Q.h <= P.y) tryIt({ x, y: Q.y + Q.h, w, h: P.y - Q.y - Q.h }, P.y - Q.y - Q.h);
  }
  if (oy >= cx.minShort) {
    const h = Math.min(oy, P.w, P.h, Q.w, Q.h), y = Math.round(Math.max(P.y, Q.y) + (oy - h) / 2);
    if (P.x + P.w <= Q.x) tryIt({ x: P.x + P.w, y, w: Q.x - P.x - P.w, h }, Q.x - P.x - P.w);
    else if (Q.x + Q.w <= P.x) tryIt({ x: Q.x + Q.w, y, w: P.x - Q.x - Q.w, h }, P.x - Q.x - Q.w);
  }
  return best;
}

function clean(items, cx) {
  const off = (it) => cx.att.roomsNotTouchingHall(it).length;
  for (let iter = 0; iter < 40; iter++) {
    const halls = items.filter(isHall);
    // pockets and slivers that were added by the pass go
    const bad = halls.filter((h) => {
      if (cx.prot.has(h.id)) return false;
      const sh = Math.min(h.w, h.h), lg = Math.max(h.w, h.h);
      if (sh < cx.minShort || (sh > 1.3 * cx.med && lg / sh < 3)) return true;
      // a squarish piece is a junction only when two corridors meet in it; otherwise it is a pocket
      return lg / sh < 2.2 && halls.filter((o) => o !== h && linked(o, h)).length < 2;
    });
    if (bad.length) { items = items.filter((i) => !bad.includes(i)); continue; }
    const comps = components(halls);
    if (comps.length < 2) break;
    const prot = (c) => c.filter((h) => cx.orig.has(h.id)).length;
    const oarea = (c) => compArea(c.filter((h) => cx.orig.has(h.id)));
    // cut-off pieces of the pass itself first (they bridge to a real hallway or go), then the rest by size
    comps.sort((a, b) => (prot(a) ? 1 : 0) - (prot(b) ? 1 : 0) || (prot(a) ? prot(b) - prot(a) || oarea(b) - oarea(a) : compArea(a) - compArea(b)));
    const orphans = comps.filter((c) => !prot(c));
    const real = comps.filter((c) => prot(c));
    let changed = false;
    for (const c of [...orphans, ...real.slice(1)]) {
      let best = null;
      for (const o of comps) {
        if (o === c || !prot(o)) continue;
        for (const P of c) for (const Q of o) { const b = bridge(P, Q, cx); if (b && (!best || b.gap < best.gap)) best = b; }
      }
      if (best) {
        const br = { id: cx.newId(), type: 'hall', ...best.r };
        const without = items.filter((i) => !c.includes(i));
        if (prot(c) || off(without) - off([...items, br]) >= 1) { cx.prot.add(br.id); items = [...items, br]; changed = true; break; }
      }
      // cut off and cannot be bridged: new pieces go (an old group that was already cut off stays as it was)
      const gone = c.filter((h) => !cx.orig.has(h.id));
      if (gone.length) { items = items.filter((i) => !gone.includes(i)); changed = true; break; }
    }
    if (!changed) break;
  }
  return items;
}

// rooms and stairs (polygon rooms by their box) block bridges
function obstacles(rest) {
  const obst = [];
  for (const i of rest) {
    if (i.type === 'room' && i.shape === 'poly' && Array.isArray(i.points) && i.points.length) {
      const xs = i.points.map((q) => q[0]), ys = i.points.map((q) => q[1]), x = Math.min(...xs), y = Math.min(...ys);
      obst.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
    } else if ((i.type === 'room' || i.type === 'stair') && [i.x, i.y, i.w, i.h].every(Number.isFinite)) obst.push(i);
  }
  return obst;
}

export async function runHallPass(res, opts = {}) {
  const items0 = res.items;
  const none = async () => ({ items: items0, hallPass: { ...empty(), notesLeft: await notesOf(items0, res.floor) } });
  if (opts.hallPass === false) return none();
  try {
    const compass = items0.filter((i) => i.type === 'compass');
    const rest = items0.filter((i) => i.type !== 'compass');
    const pts = res.floor && res.floor.points;
    const start = { items: rest, floor: res.floor };
    const frozen = others(rest);
    const firstHalls = new Map(rest.filter(isHall).map((h) => [h.id, rectKey(h)]));

    const fill = opts.fillHallways || (await import('../hallFill.js')).fillHallways;
    const find = opts.findHallFixes || (await import('../fixHalls.js')).findHallFixes;
    const att = await import('../attention.js');
    const { newId } = await import('../document.js');
    const touching = (d) => att.roomsNotTouchingHall(d.items).length;
    const loose = (d) => att.unconnectedHalls(d).length;
    const t0 = Date.now(), budget = opts.budgetMs || BUDGET_MS, maxSteps = opts.maxSteps || MAX_STEPS;

    const obst = obstacles(rest);
    const sides = rest.filter((i) => i.type === 'room' && i.cls === 'room' && Number.isFinite(i.w)).map((r) => Math.min(r.w, r.h)).sort((a, b) => a - b);
    const med = Math.max(40, sides[sides.length >> 1] || 50);
    const cx = {
      att, newId, med, minShort: Math.max(10, Math.round(0.2 * med)), prot: new Set(firstHalls.keys()), orig: new Set(firstHalls.keys()),
      free: (r) => hallInside(r, pts) && !obst.some((o) => ovl(r.x, r.x + r.w, o.x, o.x + o.w) > 2 && ovl(r.y, r.y + r.h, o.y, o.y + o.h) > 2),
    };

    let doc = start, fixes = 0;
    for (let round = 0; round < ROUNDS && Date.now() - t0 < budget; round++) {
      const before = rkey(doc.items);
      const f = fill ? fill(doc) : null;
      if (f && f.doc && f.doc.items && sameOthers(frozen, others(f.doc.items))) {
        // a piece that leaves the outline is dropped (new) or put back as it was (grown)
        const orig = new Map(doc.items.filter(isHall).map((h) => [h.id, h]));
        const ok = (h) => hallsOk({ items: [h] }, pts);
        doc = { items: f.doc.items.map((i) => (isHall(i) && !ok(i) ? orig.get(i.id) || null : i)).filter(Boolean), floor: res.floor };
      }
      doc = { items: clean(doc.items, cx), floor: res.floor };
      const seen = new Set([JSON.stringify(doc.items)]);
      for (let step = 0; step < maxSteps && Date.now() - t0 < budget; step++) {
        let next = null;
        for (const fx of find(doc) || []) {
          if (!KINDS.has(fx.kind)) continue;
          const d = fx.doc;
          if (!d || !d.items || (fx.notes || []).some((n) => /runs through|crosses/i.test(n))) continue;
          if (!sameOthers(frozen, others(d.items)) || !hallsOk(d, pts)) continue;
          const key = JSON.stringify(d.items);
          if (seen.has(key)) continue;
          seen.add(key);
          next = { items: d.items, floor: res.floor };
          break;
        }
        if (!next) break;
        doc = next; fixes++;
      }
      doc = { items: clean(doc.items, cx), floor: res.floor };
      if (rkey(doc.items) === before) break;
    }

    // the pass must never make the checklist worse
    if (touching(doc) > touching(start) || loose(doc) > loose(start)) return none();
    const added = [], extended = [], hallBefore = {};
    for (const h of doc.items) {
      if (!isHall(h)) continue;
      if (!firstHalls.has(h.id)) added.push(h.id);
      else if (firstHalls.get(h.id) !== rectKey(h)) {
        extended.push(h.id);
        hallBefore[h.id] = rectOf(rest.find((r) => r.id === h.id));
      }
    }
    return {
      items: [...doc.items, ...compass],
      hallPass: { added, extended, fixes, hallBefore, notesLeft: { roomsNotTouching: touching(doc), unconnected: loose(doc) } },
    };
  } catch {
    return none();
  }
}
