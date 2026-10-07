// tools/gt-eval.mjs: how close is AutoBuild's draft to the hand-finished floor?
//   node tools/gt-eval.mjs <draftDir> <finalDir> [slug...]      (files <slug>.floorplan.json in both; the finished one is the truth)
// Rooms matched by number: share found / wrong numbers / mean box IoU. Halls and outline: precision / recall / IoU on a 5-unit raster.
import { readFileSync, existsSync } from 'node:fs';
import { roomPolygon } from '../js/model/document.js';
import { pointInPolygon } from '../js/model/geometry.js';

const [draftDir, finalDir, ...only] = process.argv.slice(2);
const slugs = only.length ? only : ['hh-1', 'hh-2', 'gn-1', 'gn-2', 'bx-1', 'rh-1'];
const G = 5;
const load = (d, s) => { const f = `${d}/${s}.floorplan.json`; return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).doc : null; };
const box = (it) => {
  if (it.points) { const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
  return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
};
const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const i = w * h, u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
  return u > 0 ? i / u : 0;
};
function mask(doc, kind, W, H) {
  const m = new Uint8Array(W * H);
  const fillBox = (b) => { for (let y = Math.max(0, Math.floor(b.y0 / G)); y < Math.min(H, Math.ceil(b.y1 / G)); y++) for (let x = Math.max(0, Math.floor(b.x0 / G)); x < Math.min(W, Math.ceil(b.x1 / G)); x++) m[y * W + x] = 1; };
  if (kind === 'hall') doc.items.filter((i) => i.type === 'hall').forEach((h) => fillBox(box(h)));
  else if (doc.floor) {
    const p = doc.floor.points, b = box({ points: p });
    for (let y = Math.max(0, Math.floor(b.y0 / G)); y < Math.min(H, Math.ceil(b.y1 / G)); y++) for (let x = Math.max(0, Math.floor(b.x0 / G)); x < Math.min(W, Math.ceil(b.x1 / G)); x++) if (pointInPolygon([(x + 0.5) * G, (y + 0.5) * G], p)) m[y * W + x] = 1;
  }
  return m;
}
const pr = (a, b) => { let i = 0, na = 0, nb = 0; for (let k = 0; k < a.length; k++) { na += a[k]; nb += b[k]; i += a[k] & b[k]; } return { p: na ? i / na : 0, r: nb ? i / nb : 0, iou: na + nb - i ? i / (na + nb - i) : 0 }; };

// the draft's frame can differ from the finished plan's (scale follows the median room): fit scale + shift on the rooms both have
function align(d, f) {
  const dm = new Map(d.items.filter((i) => i.type === 'room' && i.number).map((r) => [r.number, box(r)]));
  const ar = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  let pairs = f.items.filter((i) => i.type === 'room' && i.number && dm.has(i.number)).map((r) => [dm.get(r.number), box(r)]);
  pairs = pairs.sort((p, q) => ar(q[0]) - ar(p[0])).slice(0, Math.max(3, Math.ceil(pairs.length / 2))); // the big ones: small stubs have no reliable size
  if (pairs.length < 3) return d;
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const s = med(pairs.map(([a, b]) => Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0)))));
  const tx = med(pairs.map(([a, b]) => (b.x0 + b.x1) / 2 - s * (a.x0 + a.x1) / 2)), ty = med(pairs.map(([a, b]) => (b.y0 + b.y1) / 2 - s * (a.y0 + a.y1) / 2));
  const P = (p) => [p[0] * s + tx, p[1] * s + ty];
  const items = d.items.map((it) => {
    if (it.points) return { ...it, points: it.points.map(P) };
    if (it.x === undefined) return it;
    return { ...it, x: it.x * s + tx, y: it.y * s + ty, w: it.w * s, h: it.h * s };
  });
  return { ...d, items, floor: d.floor && { ...d.floor, points: d.floor.points.map(P) } };
}
let tot = { found: 0, want: 0, wrong: 0, iou: 0, nIou: 0 };
for (const s of slugs) {
  let d = load(draftDir, s); const f = load(finalDir, s);
  if (d && f) {
    const mi = (x) => { const m = new Map(x.items.filter((i) => i.type === 'room' && i.number).map((r) => [r.number, r])); let a = 0, n = 0; for (const r of f.items) { const q = r.type === 'room' && r.number && m.get(r.number); if (q) { a += iou(box(q), box(r)) > 0.3 ? 1 : 0; n++; } } return n ? a / n : 0; };
    const al = align(d, f);
    if (process.env.DBG) console.log("align", mi(d), mi(al));
    if (mi(al) > mi(d)) d = al;
  }
  if (!d || !f) { console.log(s.padEnd(6), 'missing'); continue; }
  const W = Math.ceil(Math.max(d.viewBox.w, f.viewBox.w, 3000) / G), H = Math.ceil(Math.max(d.viewBox.h, f.viewBox.h, 3000) / G);
  const dr = new Map(d.items.filter((i) => i.type === 'room' && i.number).map((r) => [r.number, r]));
  const fr = f.items.filter((i) => i.type === 'room' && i.number);
  let found = 0, sum = 0;
  for (const r of fr) { const m = dr.get(r.number); if (m) { found++; sum += iou(box(m), box(r)); } }
  const fnum = new Set(fr.map((r) => r.number));
  const wrong = [...dr.keys()].filter((n) => !fnum.has(n)).length;
  const blank = d.items.filter((i) => i.type === 'room' && !i.number && i.cls === 'room').length;
  const hall = pr(mask(d, 'hall', W, H), mask(f, 'hall', W, H)), out = pr(mask(d, 'floor', W, H), mask(f, 'floor', W, H));
  console.log(`${s.padEnd(6)} rooms found ${found}/${fr.length} wrong ${wrong} blank ${blank} boxIoU ${found ? (sum / found).toFixed(2) : '-'} | halls prec ${hall.p.toFixed(2)} rec ${hall.r.toFixed(2)} | outline IoU ${out.iou.toFixed(2)}`);
  tot.found += found; tot.want += fr.length; tot.wrong += wrong; tot.iou += sum; tot.nIou += found;
}
console.log(`TOTAL rooms found ${tot.found}/${tot.want} wrong ${tot.wrong} mean box IoU ${(tot.iou / Math.max(1, tot.nIou)).toFixed(2)}`);
