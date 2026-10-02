// fixHalls.js
// Staged fixes for the three hallway notes of the checklist: "Hallways overlap", "Some hallways aren't
// connected" and "Some rooms don't reach a hallway". Pure: each Fix is a full proposed doc (the input is
// never changed) that the UI previews and the user confirms; what cannot be done safely is a Manual.
//   Fix    = { key, kind, title, notes[], ids[], doc }      Manual = { ids[], message }
// Order of the list: overlaps, unconnected, rooms. Every Fix is checked with the checklist's own rules
// (js/model/attention.js) and is only offered when it improves its note without making another worse.
// Geometry of the links lives in fixHallsLink.js. Depends on: attention.js, document.js, geometry.js.

import { newId, roomPolygon } from './document.js';
import { bbox } from './geometry.js';
import { overlappingHalls, unconnectedHalls, roomsNotTouchingHall } from './attention.js';
import { linkCands, isH } from './fixHallsLink.js';
import { morphHall, thicknessCap } from './fixHallsMorph.js';
import { groupManual } from './fixHallsManual.js';
import { tidyHalls } from './fixHallsTidy.js';
import { insideOutline, bucketGrid } from './fixHallsGeo.js';

// A link is never drawn through a room or a stair (more than MAX_THROUGH units) to reach a ROOM: that is
// left to the user as a Manual note. Joining a cut-off hallway may run through at most two items, since
// the corridor probably continues under a mis-drawn room; the Fix says so and the user confirms it.
const MAX_THROUGH = 10;
const MAX_STRIP = 6000; // no connector longer than this (a plan is a few thousand units wide)
const TOL = 1, PAD = 4, BUDGET_MS = 60, HARD_MS = 220, FAR = 2.5, FAR_FREE = 4; // FAR_FREE: reach by lengthening a hallway over free space only
const linked = (a, b) => {
  const gx = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), gy = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return (gx <= TOL && gy <= 0) || (gy <= TOL && gx <= 0);
};
const touchPad = (a, b) => !(a.x + a.w + PAD < b.x || b.x + b.w < a.x - PAD || a.y + a.h + PAD < b.y || b.y + b.h < a.y - PAD);
const rectOf = (it) => ({ x: it.x, y: it.y, w: it.w, h: it.h });
const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const sameAxisOverlap = (a, b) => isH(a) === isH(b) && Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
const gapDist = (a, b) => { const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)); return Math.sqrt(dx * dx + dy * dy); };
const isRect = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite);
const label = (r) => (isH(r) ? 'horizontal' : 'vertical');
const roomName = (r) => [r.name, r.number].filter(Boolean).join(' ') || (Number.isFinite(r.x) ? `the room at ${Math.round(r.x)}, ${Math.round(r.y)}` : 'a room');

// ---- environment: halls, obstacles (rooms/stairs, in a coarse grid), outline ----
function makeEnv(doc) {
  const items = (doc && doc.items) || [];
  const halls = items.filter((it) => it.type === 'hall' && isRect(it)).map((it) => ({ id: it.id, rect: rectOf(it), item: it }));
  const pts = doc && doc.floor && Array.isArray(doc.floor.points) && doc.floor.points.length >= 3 ? doc.floor.points : null;
  const obst = bucketGrid(), hallGrid = bucketGrid();
  const put = (o) => obst.put(o);
  halls.forEach((h) => hallGrid.put(h));
  for (const it of items) {
    if (it.type === 'stair' && isRect(it)) put({ rect: rectOf(it), name: 'a stair' });
    else if (it.type === 'room') {
      let r = isRect(it) ? rectOf(it) : null;
      if (!r) { try { r = bbox(roomPolygon(it)); } catch { r = null; } }
      if (isRect(r)) put({ rect: r, name: roomName(it) });
    }
  }
  const crossing = (r) => {
    let total = 0, thru = 0; const names = [];
    const vert = r.h >= r.w;
    for (const o of obst.near(r)) {
      const a = inter(r, o.rect);
      if (!(a > 0)) continue;
      total += a; names.push(o.name);
      // how far the strip really runs through it (not a sliver along an edge)
      const iw = Math.min(r.x + r.w, o.rect.x + o.rect.w) - Math.max(r.x, o.rect.x), ih = Math.min(r.y + r.h, o.rect.y + o.rect.h) - Math.max(r.y, o.rect.y);
      if ((vert ? iw >= 0.6 * r.w : ih >= 0.6 * r.h)) thru = Math.max(thru, vert ? ih : iw);
    }
    return { total, names, thru };
  };
  return { items, halls, rects: new Map(halls.map((h) => [h.id, h.rect])), outline: pts, crossing, hallsNear: (r) => hallGrid.near(r), obstNear: (r) => obst.near(r), t0: Date.now() };
}

// ---- checking a candidate ----
function connected(rects) {
  const seen = new Set([0]), stack = [0];
  while (stack.length) { const i = stack.pop(); rects.forEach((r, j) => { if (!seen.has(j) && linked(rects[i], r)) { seen.add(j); stack.push(j); } }); }
  return seen.size === rects.length;
}
function overlapsOf(env, touched) { // same-axis overlaps involving a touched rect (Map id -> rect)
  let n = 0;
  const ids = [...touched.keys()];
  ids.forEach((id, i) => {
    for (const h of env.hallsNear(touched.get(id))) if (!touched.has(h.id) && sameAxisOverlap(touched.get(id), h.rect)) n++;
    for (let j = i + 1; j < ids.length; j++) if (sameAxisOverlap(touched.get(id), touched.get(ids[j]))) n++;
  });
  return n;
}
// ctx: { P, Q, reach(rects)->bool, members: [rect] extra rects that must end up linked }
function bestLink(env, ctx) {
  const first = linkOnce(env, ctx, [1]); // preferred form: reaching a few units into a crossing hallway
  if (first && first.cross === 0) return first;
  const second = linkOnce(env, ctx, [0]); // fallback: only touching
  if (!first || (second && second.cross < first.cross)) return second;
  return first;
}
function linkOnce(env, ctx, scales) {
  const ranked = linkCands(ctx.P, ctx.Q, scales).filter((c) => c.strips.every((r) => r.w <= MAX_STRIP && r.h <= MAX_STRIP)).filter((c) => !ctx.maxLen || c.strips.reduce((n, r) => n + Math.max(r.w, r.h), 0) <= ctx.maxLen).map((c) => {
    const cr = c.strips.map((s) => env.crossing(s));
    const cross = cr.reduce((s, x) => s + x.total, 0);
    const base = c.strips.reduce((s, r) => s + Math.max(r.w, r.h), 0) + c.adds.length * 100; // lengths: extending beats adding
    return { c, cross, base, len: c.strips.reduce((n, r) => n + Math.max(r.w, r.h), 0), thru: Math.max(0, ...cr.map((x) => x.thru)), names: [...new Set(cr.flatMap((x) => x.names))] };
  }).filter((k) => (!ctx.freeAbove || k.len <= ctx.freeAbove || (k.cross === 0 && !k.c.adds.length)) && (k.thru <= MAX_THROUGH || (ctx.through && k.names.length <= 2))).sort((a, b) => (a.cross - b.cross) || (a.base - b.base));
  const old = env.rects;
  for (const k of ranked) {
    const { c } = k;
    if (!c.strips.every((s) => insideOutline(env, s))) continue;
    const mods = new Map(c.mods.map((m) => [m.id, m.rect]));
    const before = new Map([...mods.keys()].map((id) => [id, old.get(id)]));
    const after = new Map(mods);
    c.adds.forEach((r, i) => after.set('new' + i, r));
    if (overlapsOf(env, after) > overlapsOf(env, before)) continue;
    const touchedRects = [...after.values()];
    const group = [ctx.P.id ? (mods.get(ctx.P.id) || ctx.P.rect) : null, ctx.Q.id ? (mods.get(ctx.Q.id) || ctx.Q.rect) : null].filter(Boolean);
    const all = [...new Set([...group, ...touchedRects, ...(ctx.members || [])])];
    if (!connected(all)) continue;
    if (!ctx.reach(touchedRects.concat(group))) continue;
    return k;
  }
  return null;
}

// ---- metrics: the three notes ----
function metrics(doc) {
  const items = doc.items || [];
  const halls = items.filter((it) => it.type === 'hall');
  const parent = halls.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) if (linked(halls[i], halls[j])) parent[find(i)] = find(j);
  const g = new Set(halls.map((_, i) => find(i))).size;
  const floating = g === 1 && unconnectedHalls(doc).length > 0 ? 1 : 0;
  return { ov: overlappingHalls(items).length, conn: g > 1 ? 2 * (g - 1) : floating, rooms: roomsNotTouchingHall(items).filter(isRect).length }; // (attention.js counts polygon rooms differently below/above 24 hallways)
}
const improves = (env, before, built, key) => {
  if (Date.now() - env.t0 > BUDGET_MS) return true; // huge docs: rely on the local checks
  const m = metrics(built.doc || built);
  return m[key] < before[key] && Object.keys(m).every((k) => k === key || m[k] <= before[k]);
};

// ---- building the proposed doc ----
// (the doc is built on first use: huge docs would otherwise copy the item list for every fix)
function apply(doc, cand) {
  const mods = new Map(cand.mods.map((m) => [m.id, m.rect]));
  const added = cand.adds.map((r) => ({ id: newId(), type: 'hall', x: r.x, y: r.y, w: r.w, h: r.h }));
  let built = null;
  return {
    addedIds: added.map((a) => a.id),
    get doc() {
      if (!built) { const its = doc.items.map((it) => (mods.has(it.id) ? { ...it, ...mods.get(it.id) } : it)).concat(added); built = { ...doc, items: cand.notes ? tidyHalls(its, new Set([...mods.keys(), ...added.map((a) => a.id)])) : its }; } // (cand.notes: a morph, kept tight)
      return built;
    },
  };
}
function describe(env, cand, where) {
  if (cand.notes) return cand.notes;
  const old = env.rects;
  const notes = [];
  for (const m of cand.mods) {
    const o = old.get(m.id), n = m.rect;
    const parts = [];
    if (n.x < o.x) parts.push(`${o.x - n.x} to the left`);
    if (n.x + n.w > o.x + o.w) parts.push(`${n.x + n.w - o.x - o.w} to the right`);
    if (n.y < o.y) parts.push(`${o.y - n.y} up`);
    if (n.y + n.h > o.y + o.h) parts.push(`${n.y + n.h - o.y - o.h} down`);
    notes.push(`Lengthen a ${label(o)} hallway ${parts.join(' and ')} ${where}`);
  }
  for (const r of cand.adds) notes.push(`Add a short ${r.w} x ${r.h} connector hallway ${where}`);
  return notes;
}
const crossNote = (names) => (names.length ? [`The link runs through ${names.slice(0, 3).join(', ')}; every other way was blocked`] : []);

// ---- (1) overlapping hallways ----
function overlapFixes(env, doc, before, out, manual) {
  const hs = env.halls;
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const A = hs[i], B = hs[j];
    if (!sameAxisOverlap(A.rect, B.rect)) continue;
    const key = `halls:overlap:${A.id}+${B.id}`;
    const a = A.rect, b = B.rect, ov = inter(a, b);
    const ux = Math.min(a.x, b.x), uy = Math.min(a.y, b.y);
    const U = { x: ux, y: uy, w: Math.max(a.x + a.w, b.x + b.w) - ux, h: Math.max(a.y + a.h, b.y + b.h) - uy };
    const options = [];
    if (area(U) <= 1.15 * (area(a) + area(b) - ov) && isH(U) === isH(a) && (insideOutline(env, U) || !(insideOutline(env, a) && insideOutline(env, b)))) {
      const host = area(a) >= area(b) ? A : B, gone = host === A ? B : A;
      options.push({ title: 'Merge two overlapping hallways', notes: ['Merge the two hallways into one rectangle'], ids: [A.id, B.id],
        make: () => ({ ...doc, items: doc.items.filter((it) => it.id !== gone.id).map((it) => (it.id === host.id ? { ...it, ...U } : it)) }) });
    }
    // trim the overlap off one hallway (the shorter first), keeping it touching the other
    const trims = [];
    for (const [S, O] of [[A, B], [B, A]]) {
      const s = S.rect, o = O.rect;
      const short = Math.max(s.w, s.h) <= Math.max(o.w, o.h);
      const x0 = Math.max(s.x, o.x), x1 = Math.min(s.x + s.w, o.x + o.w), y0 = Math.max(s.y, o.y), y1 = Math.min(s.y + s.h, o.y + o.h);
      const cuts = [];
      if (x0 <= s.x !== x1 >= s.x + s.w) cuts.push(x0 > s.x ? { ...s, w: x0 - s.x } : { ...s, x: x1, w: s.x + s.w - x1 });
      if (y0 <= s.y !== y1 >= s.y + s.h) cuts.push(y0 > s.y ? { ...s, h: y0 - s.y } : { ...s, y: y1, h: s.y + s.h - y1 });
      for (const r of cuts) if (r.w >= 5 && r.h >= 5 && linked(r, o)) trims.push({ S, O, r, key: (area(s) - area(r)) * (short ? 1 : 1.5) });
    }
    trims.sort((p, q) => p.key - q.key);
    for (const t of trims.slice(0, 2)) {
      options.push({ title: 'Trim two overlapping hallways', notes: [`Shorten a ${label(t.S.rect)} hallway so it ends where the other begins`], ids: [A.id, B.id],
        make: () => ({ ...doc, items: doc.items.map((it) => (it.id === t.S.id ? { ...it, ...t.r } : it)) }) });
    }
    const hit = options.map((o) => ({ o, d: o.make() })).find((x) => improves(env, before, x.d, 'ov'));
    if (hit) out.push({ key, kind: 'hall-overlap', title: hit.o.title, notes: hit.o.notes, ids: hit.o.ids, doc: hit.d });
    else manual.push({ ids: [A.id, B.id], message: 'These two hallways overlap in an awkward way; move or resize one of them by hand.' });
  }
}

// ---- (2) unconnected hallways ----
function groupsOf(halls) {
  const parent = halls.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < halls.length; i++) for (let j = i + 1; j < halls.length; j++) if (linked(halls[i].rect, halls[j].rect)) parent[find(i)] = find(j);
  const m = new Map();
  halls.forEach((h, i) => { const r = find(i); if (!m.has(r)) m.set(r, []); m.get(r).push(h); });
  return [...m.values()];
}
const party = (h) => ({ id: h.id, rect: h.rect, hall: true, thick: Math.min(h.rect.w, h.rect.h) });
const nearestPairs = (G, M, k) => {
  const ps = [];
  for (const g of G) for (const m of M) ps.push([gapDist(g.rect, m.rect), g, m]);
  return ps.sort((a, b) => a[0] - b[0]).slice(0, k);
};

function anchors(env) {
  const out = [];
  for (const it of env.items) {
    if (it.type === 'stair' && isRect(it)) out.push({ rect: rectOf(it), kind: 'a stair', reach: 0, test: (r) => linked(r, rectOf(it)) });
    if (it.type === 'door' && [it.x1, it.y1, it.x2, it.y2].every(Number.isFinite)) {
      const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2;
      out.push({ rect: { x: mx - 1, y: my - 1, w: 2, h: 2 }, kind: 'a door', reach: 1, test: (r) => mx >= r.x - 1 && mx <= r.x + r.w + 1 && my >= r.y - 1 && my <= r.y + r.h + 1 });
    }
  }
  const p = env.outline;
  if (p) for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    const seg = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    out.push({ rect: seg, kind: 'the building edge', reach: 0, test: (r) => linked(r, seg) });
  }
  return out;
}

function connectFixes(env, doc, before, out, manual) {
  const groups = groupsOf(env.halls);
  const main = [...groups].sort((a, b) => b.length - a.length)[0];
  if (groups.length > 1) {
    // nearest cut-off group first; each links to the network so far (the biggest group plus the groups
    // already joined), so a chain of small groups is joined end to end instead of by one long link
    let rest = groups.filter((g) => g !== main).map((G) => ({ G, ps: nearestPairs(G, main, 4) }));
    while (rest.length) {
      if (Date.now() - env.t0 > HARD_MS) { manual.push({ ids: rest.flatMap((r) => r.G.map((h) => h.id)), message: 'Many hallways are still cut off; apply the fixes above, then check again for the rest.' }); break; }
      let at = 0;
      rest.forEach((r, i) => { if (r.ps[0][0] < rest[at].ps[0][0]) at = i; });
      const { G, ps } = rest[at];
      rest.splice(at, 1);
      let best = null;
      for (const [, g, m] of ps) {
        const k = bestLink(env, { through: true, P: party(g), Q: party(m), reach: () => true, members: G.map((h) => h.rect) });
        if (k && (!best || k.cross < best.cross || (k.cross === best.cross && k.base < best.base))) best = k;
      }
      const ids = G.map((h) => h.id), key = `halls:join:${ids.slice().sort()[0]}`;
      const built = best && apply(doc, best.c);
      if (built && improves(env, before, built, 'conn')) {
        const where = 'to join the cut-off hallway to the others';
        out.push({ key, kind: 'hall-connect', title: ids.length > 1 ? 'Join a cut-off group of hallways' : 'Join a cut-off hallway', notes: [...describe(env, best.c, where), ...crossNote(best.names)], ids: [...ids, ...best.c.mods.map((m) => m.id), ...built.addedIds], get doc() { return built.doc; } });
        for (const r of rest) r.ps = r.ps.concat(nearestPairs(r.G, G, 4)).sort((a, b) => a[0] - b[0]).slice(0, 4);
      } else manual.push({ ids, message: "This hallway can't be joined to the others cleanly (the link would leave the building or be awkward). Draw a connecting hallway by hand." });
    }
    return;
  }
  if (!unconnectedHalls(doc).length) return;
  const all = env.halls.map((h) => h.id), anc = anchors(env);
  if (!anc.length) { manual.push({ ids: all, message: "The hallways don't reach a stair, a door or the building edge. Add the building outline, a door or a stair first." }); return; }
  let best = null;
  const ps = [];
  for (const h of env.halls) for (const a of anc) ps.push([gapDist(h.rect, a.rect), h, a]);
  ps.sort((a, b) => a[0] - b[0]);
  for (const [, h, a] of ps.slice(0, 10)) {
    const k = bestLink(env, { through: true, P: party(h), Q: { rect: a.rect, hall: false, thick: 10, reach: a.reach }, reach: (rs) => rs.some(a.test), members: env.halls.map((x) => x.rect) });
    if (k && (!best || k.cross < best.cross || (k.cross === best.cross && k.base < best.base))) best = { ...k, kind: a.kind };
  }
  const built = best && apply(doc, best.c);
  if (built && improves(env, before, built, 'conn')) {
    out.push({ key: 'halls:anchor', kind: 'hall-connect', title: `Connect the hallways to ${best.kind}`, notes: [...describe(env, best.c, `until it reaches ${best.kind}`), ...crossNote(best.names)], ids: [...all.slice(0, 1), ...best.c.mods.map((m) => m.id), ...built.addedIds], get doc() { return built.doc; } });
  } else manual.push({ ids: all, message: "The hallways don't reach a stair, a door or the building edge, and no clean link was found. Draw a hallway to one by hand." });
}

// ---- (3) rooms that do not reach a hallway ----
// first choice: morph a nearby hallway sideways so this room (and the lonely rooms beside it) touch it
function morphFor(env, doc, before, r, near, lgrid, served) {
  env.cap = env.cap || thicknessCap(env.items);
  const ctx = { cap: env.cap, inside: (s) => insideOutline(env, s), free: (s) => ![...env.obstNear(s)].some((o) => inter(s, o.rect) > 0) };
  let best = null;
  for (const [d, h] of near) {
    if (d > 60) continue;
    const box = { x: h.rect.x - 60, y: h.rect.y - 60, w: h.rect.w + 120, h: h.rect.h + 120 };
    const rooms = [...lgrid.near(box)].map((e) => e.room).filter((o) => !served.has(o.id) && isRect(o)).map((o) => ({ id: o.id, rect: rectOf(o) }));
    const c = rooms.some((o) => o.id === r.id) && morphHall({ id: h.id, rect: h.rect }, rooms, ctx);
    if (!c || !c.served.includes(r.id)) continue;
    const key = c.area / c.served.length;
    if (best && key >= best.key) continue;
    const after = new Map(c.mods.map((m) => [m.id, m.rect])), prior = new Map(c.mods.map((m) => [m.id, env.rects.get(m.id)]));
    c.adds.forEach((x, i) => after.set('new' + i, x));
    if (overlapsOf(env, after) > overlapsOf(env, prior) || !improves(env, before, apply(doc, c), 'rooms')) continue;
    best = { c, key, cross: 0, base: 0, names: [] };
  }
  return best;
}
function roomFixes(env, doc, before, out, manual) {
  if (!env.halls.length) return;
  const lonely = roomsNotTouchingHall(env.items).filter(isRect);
  const served = new Set(), lgrid = bucketGrid(), stuck = [];
  lonely.forEach((o) => lgrid.put({ rect: { x: o.x - PAD, y: o.y - PAD, w: o.w + 2 * PAD, h: o.h + 2 * PAD }, room: o }));
  for (const r of lonely) {
    if (served.has(r.id)) continue;
    if (Date.now() - env.t0 > HARD_MS) { // huge plan: the rest is offered after these are applied
      manual.push({ ids: lonely.filter((o) => !served.has(o.id)).map((o) => o.id), message: 'Many rooms are still cut off from hallways; apply the fixes above, then check again for the rest.' }); break;
    }
    const rr = rectOf(r), size = Math.max(r.w, r.h);
    const near = [];
    for (const h of env.halls) { const d = gapDist(rr, h.rect); if (near.length < 6 || d < near[5][0]) { near.push([d, h]); near.sort((a, b) => a[0] - b[0]); if (near.length > 6) near.pop(); } }
    let best = morphFor(env, doc, before, r, near, lgrid, served);
    if (!best && near[0][0] > FAR_FREE * size) { stuck.push({ room: r, far: true, hall: near[0][1].rect }); continue; }
    const Q = { rect: rr, hall: false, thick: Math.min(r.w, r.h), reach: 0 };
    if (!best) for (const [, h] of near) {
      const k = bestLink(env, { P: party(h), Q, maxLen: FAR_FREE * size + 20, freeAbove: FAR * size + 20, reach: (rects) => rects.some((x) => touchPad(rr, x)) });
      if (k && (!best || k.cross < best.cross || (k.cross === best.cross && k.base < best.base))) best = k;
    }
    const built = best && apply(doc, best.c);
    if (!built || !improves(env, before, built, 'rooms')) { stuck.push({ room: r, far: false, hall: near[0][1].rect }); continue; }
    const rects = best.c.mods.map((m) => m.rect).concat(best.c.adds);
    const cand = new Set(); rects.forEach((x) => lgrid.near(x).forEach((e) => cand.add(e.room)));
    const also = [...cand].filter((o) => !served.has(o.id) && rects.some((x) => touchPad(rectOf(o), x)));
    also.forEach((o) => served.add(o.id)); served.add(r.id);
    const ids = also.map((o) => o.id);
    out.push({ key: `halls:room:${ids.join('+')}`, kind: 'room-hall', title: ids.length > 1 ? `Connect ${ids.length} rooms to a hallway` : `Connect ${roomName(r)} to a hallway`,
      notes: [...describe(env, best.c, ids.length > 1 ? 'so these rooms reach it' : `so ${roomName(r)} reaches it`), ...crossNote(best.names)],
      ids: [...ids, ...best.c.mods.map((m) => m.id), ...built.addedIds], get doc() { return built.doc; } });
  }
  const rs = env.items.filter((it) => isRect(it) && it.type !== 'door'), x0 = Math.min(...rs.map((it) => it.x)), y0 = Math.min(...rs.map((it) => it.y));
  const plan = { x: x0, y: y0, w: Math.max(...rs.map((it) => it.x + it.w)) - x0, h: Math.max(...rs.map((it) => it.y + it.h)) - y0 };
  manual.push(...groupManual(stuck.filter((e) => !served.has(e.room.id)), plan));
}

const cache = new WeakMap();
function analyze(doc) {
  if (doc && typeof doc === 'object' && cache.has(doc)) return cache.get(doc);
  const out = [], manual = [], d = doc && Array.isArray(doc.items) ? doc : { ...(doc || {}), items: [] };
  const env = makeEnv(d);
  if (!env.halls.length) {
    const rooms = roomsNotTouchingHall(env.items);
    if (rooms.length) manual.push({ ids: rooms.map((r) => r.id), message: 'There is no hallway yet. Draw a hallway first, then check again.' });
  } else {
    const before = metrics(d);
    overlapFixes(env, d, before, out, manual);
    connectFixes(env, d, before, out, manual);
    roomFixes(env, d, before, out, manual);
  }
  const res = { fixes: out, manual };
  if (doc && typeof doc === 'object') cache.set(doc, res);
  return res;
}

export const findHallFixes = (doc) => analyze(doc).fixes;
export const findManualHalls = (doc) => analyze(doc).manual;
