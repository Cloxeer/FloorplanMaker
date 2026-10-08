// autoDraw.js
// "Auto draw": what the plans AutoBuild made from the photos of one floor become when they are drawn as BUILDINGS. Pure.
//   autoDraw(plans, boards) -> { tfs, items, floor, outlines, buildings, notes }
//  - Photos that show the same part of a building are found by their room numbers (127 on one photo is 127 on the other):
//    those are lined up on each other, the rooms that are on both photos are kept once, and ONE outline goes round the lot.
//  - Photos whose rooms carry the same letter prefix (W191, W187 ...) are one building too.
//  - Everything else is a building of its own and keeps exactly the place the person gave its photo: nothing is moved
//    towards another building. A building whose photos lie far apart gets an outline for each stretch, never a thin bridge.
//  - The biggest building's outline is the plan's outline (floor); each other building is an outline item with its name.
// plans[i] = { id, items, floor, compass } in plan i's own units; boards[i] = a transform of plan i into the project's frame
// (where its photo was put). Depends on: ./stitch.js.

import { alignPlans, apply, compose, mergePlans, placeItem, unionRings } from './stitch.js';
import { newId } from './document.js';

const GAP = 400; // photos of one building whose contents lie further apart than this (plan units) are outlined one by one
const FACE = 60; // and they must face each other over at least this much of their length to be joined
const ok = (v) => Number.isFinite(v);
const solid = (it) => it && (it.type === 'room' || it.type === 'hall' || it.type === 'stair') && (it.points || (ok(it.x) && ok(it.w)));

// the letters a plan's room numbers share (W191, W187 ...), when most of its numbered rooms have them; else ''
export function prefixOf(plan) {
  const nums = plan.items.filter((it) => it.type === 'room' && it.cls !== 'void' && it.number).map((it) => /^([A-Z]{1,2})\d/.exec(String(it.number)));
  if (nums.length < 3) return '';
  const count = new Map();
  for (const m of nums) if (m) count.set(m[1], (count.get(m[1]) || 0) + 1);
  const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  return n / nums.length >= 0.5 ? best : '';
}

// the box of what a plan holds once it is placed with t
function placedBox(plan, t) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (ok(x) && ok(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } };
  for (const raw of plan.items) {
    if (!solid(raw)) continue;
    const it = placeItem(raw, t);
    if (it.points) it.points.forEach(([x, y]) => add(x, y)); else { add(it.x, it.y); add(it.x + it.w, it.y + it.h); }
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}
// two placed boxes next to each other: the gap between them along one axis, and how much of the other axis they share
function facing(a, b) {
  const gx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1), gy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
  if (gx <= 0 && gy <= 0) return { gap: 0, slab: null }; // they lie on each other
  if (gx > 0 && gy <= 0) { const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1); return { gap: gx, span: -gy, slab: [[Math.min(a.x1, b.x1), y0], [Math.max(a.x0, b.x0), y0], [Math.max(a.x0, b.x0), y1], [Math.min(a.x1, b.x1), y1]] }; }
  if (gy > 0 && gx <= 0) { const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1); return { gap: gy, span: -gx, slab: [[x0, Math.min(a.y1, b.y1)], [x1, Math.min(a.y1, b.y1)], [x1, Math.max(a.y0, b.y0)], [x0, Math.max(a.y0, b.y0)]] }; }
  return { gap: Math.max(gx, gy), span: 0, slab: null }; // only corner to corner
}
const near = (f) => f.gap === 0 || (f.gap <= GAP && f.span >= FACE);

export function autoDraw(plans, boards, opts = {}) {
  const n = plans.length, notes = [];
  const { tfs: rel, roots } = alignPlans(plans, { strongOnly: true });
  const identity = { q: 0, s: 1, tx: 0, ty: 0 };
  // every plan into the project's frame: lined up on the others of its group (shared numbers), the group where its root photo is
  const tfs = plans.map((_, i) => {
    const r = rel[i].root, F = boards[r] || identity;
    return { ...compose(F, rel[i]), how: rel[i].how, n: rel[i].n, rms: rel[i].rms, labelled: rel[i].labelled, root: r };
  });
  // groups of photos that are one building: the same room numbers on them, or the same letter prefix
  const parent = plans.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  plans.forEach((_, i) => join(i, rel[i].root));
  const pre = plans.map(prefixOf);
  const numbers = plans.map((p) => new Set(p.items.filter((it) => it.type === 'room' && it.cls !== 'void' && it.number).map((it) => it.number)));
  const sharedNumbers = (i, j) => [...numbers[i]].filter((x) => numbers[j].has(x));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (pre[i] && pre[i] === pre[j]) join(i, j);
    else if (sharedNumbers(i, j).length >= 2) join(i, j); // 127 is on both photos: the same part of the same building
  }

  // a photo whose numbers could not be read says nothing about its building: it belongs to the one it lies next to
  const placed = plans.map((p, i) => placedBox(p, tfs[i]));
  plans.forEach((_, i) => {
    if (numbers[i].size >= 2 || find(i) !== i || plans.some((__, j) => j !== i && find(j) === i)) return; // readable, or already grouped
    let best = null;
    plans.forEach((__, j) => { if (j === i || numbers[j].size < 2 || !placed[i] || !placed[j]) return; const f = facing(placed[i], placed[j]); if (near(f) && (!best || f.gap < best.gap)) best = { j, gap: f.gap }; });
    if (best) join(i, best.j);
  });
  const groups = new Map();
  plans.forEach((_, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
  const order = [...groups.values()].sort((a, b) => a[0] - b[0]);
  const items = [], rings = [];
  let other = 0;
  for (const members of order) {
    const prefix = members.map((i) => pre[i]).find((p) => p) || '';
    const base = prefix ? `${prefix} building` : members.includes(0) ? 'Main building' : `Building ${++other + 1}`;
    // stretches of photos that really are next to each other
    const boxes = members.map((i) => placed[i]);
    const sp = members.map((_, k) => k);
    const f = (k) => (sp[k] === k ? k : (sp[k] = f(sp[k])));
    for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
      if (!boxes[a] || !boxes[b] || near(facing(boxes[a], boxes[b])) || rel[members[a]].root === rel[members[b]].root) sp[f(a)] = f(b);
    }
    const stretches = new Map();
    members.forEach((i, k) => { const g = f(k); if (!stretches.has(g)) stretches.set(g, []); stretches.get(g).push(i); });
    let part = 0;
    for (const list of [...stretches.values()].sort((a, b) => a[0] - b[0])) {
      part++;
      const name = part === 1 ? base : `${base} (${part})`;
      const merged = mergePlans(list.map((i) => plans[i]), list.map((i) => tfs[i]), { twinsOverlap: true });
      for (const it of merged.items) items.push({ ...it, piece: name });
      // the photos' own outlines, and a filled block where two of them face each other across a gap (never a thin bridge)
      const own = list.map((i) => (plans[i].floor && plans[i].floor.points || []).map(([x, y]) => apply(tfs[i], x, y).map(Math.round))).filter((r) => r.length >= 3);
      const slabs = [];
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        if (!placed[list[a]] || !placed[list[b]]) continue;
        const fa = facing(placed[list[a]], placed[list[b]]);
        if (fa.slab && fa.gap > 0 && near(fa)) slabs.push(fa.slab.map((p) => p.map(Math.round)));
      }
      const joined = unionRings([...own, ...slabs], merged.items);
      const ring = joined && joined.points.length >= 3 ? joined.points : (merged.floor && merged.floor.points && merged.floor.points.length >= 3 ? merged.floor.points : null);
      if (ring) rings.push({ name, points: ring, rooms: merged.items.filter((it) => it.type === 'room' && it.cls !== 'void').length });
      if (list.length > 1) {
        const lined = list.filter((i) => tfs[i].how === 'rooms'), weak = lined.filter((i) => tfs[i].n === 1);
        const kept = [...new Set(merged.report.dropped)].slice(0, 6);
        notes.push(`${name}: ${list.length} photos, one outline.${lined.length ? ` ${lined.length === 1 ? 'One was' : `${lined.length} were`} lined up on shared room numbers.` : ' Kept where you put them.'}${kept.length ? ` ${kept.join(', ')} ${kept.length === 1 ? 'was' : 'were'} on two photos and kept once.` : ''}${weak.length ? ' One joined on a single shared room: check it.' : ''}`);
      }
    }
    if (stretches.size > 1) {
      const far = [...stretches.values()];
      const same = [];
      for (let a = 0; a < far.length; a++) for (let b = a + 1; b < far.length; b++) for (const i of far[a]) for (const j of far[b]) for (const x of sharedNumbers(i, j)) if (!same.includes(x)) same.push(x);
      notes.push(`${base}: its photos lie apart, so each stretch has its own outline${same.length ? ` (${same.slice(0, 5).join(', ')} ${same.length === 1 ? 'is' : 'are'} on more than one photo: use Shift photos to put them on top of each other)` : ''}. Put the photos together and Auto draw again to get one outline.`);
    }
  }
  // the biggest building is the plan's outline; the others are outline items of their own
  rings.sort((a, b) => b.rooms - a.rooms);
  const first = rings[0];
  const outlines = rings.slice(1).map((r) => ({ id: newId(), type: 'outline', name: r.name, piece: r.name, points: r.points }));
  return {
    tfs, items, floor: first ? { points: first.points } : null, outlines,
    buildings: rings.map((r) => ({ name: r.name, rooms: r.rooms })), notes,
  };
}

