// tools/floorkit.mjs: look at and correct a finished floor (a .floorplan.json) without the browser UI.
//   node tools/floorkit.mjs show   <file.floorplan.json>             list rooms / halls / stairs / doors / outline, with ids
//   node tools/floorkit.mjs apply  <file.floorplan.json> <ops.json>  apply corrections (a JSON array of ops), save, re-render
//   node tools/floorkit.mjs render <file.floorplan.json>             re-render <file>.overlay.png (plan over the photo) and <file>.svg.png
//   node tools/floorkit.mjs check  <file.floorplan.json>             the app's own checks (errors block export): duplicate numbers, labels outside shapes, wrong-floor numbers, overlaps ...
//   node tools/floorkit.mjs view   <file.floorplan.json> x y w h     zoomed overlay of that plan-unit region -> <file>.view.png (grid labelled in plan units)
// Ops (a room is found by "id", or "number", or "at":[x,y] = the smallest room that contains that plan point):
//   {"op":"setNumber","number":"123","to":"132"}              {"op":"setNumber","at":[x,y],"to":"132E"}
//   {"op":"setBox","at":[x,y],"x":..,"y":..,"w":..,"h":..}    move / resize a room (it becomes a plain rectangle)
//   {"op":"setName","number":"100","name":"Lecture Hall","cls":"room|core|void"}   (cls optional; a core room is a restroom / elevator, a void is "open to below")
//   {"op":"addRoom","number":"112","x":..,"y":..,"w":..,"h":..,"cls":"room"}
//   {"op":"deleteRoom","at":[x,y]}   {"op":"deleteItem","id":".."}
//   {"op":"addHall","x":..,"y":..,"w":..,"h":..}   {"op":"setHall","id":"..","x":..,"y":..,"w":..,"h":..}   {"op":"deleteHall","id":".."}
//   {"op":"addStair","x":..,"y":..,"w":..,"h":..,"dir":"v|h","label":"ST1"}
//   {"op":"addDoor","x1":..,"y1":..,"x2":..,"y2":..,"kind":"EXIT|Door"}    {"op":"moveItem","id":"..","dx":..,"dy":..}
//   {"op":"setOutline","points":[[x,y],...]}    {"op":"setCompass","x":..,"y":..,"deg":..}
// Coordinates are plan units, the numbers `show` prints. The overlay png is drawn at the scale and origin that
// `apply` / `render` print: plan x = pixelX / scale + x0, plan y = pixelY / scale + y0.
import { readFileSync, writeFileSync } from 'node:fs';
import { newId, roomPolygon } from '../js/model/document.js';
import { pointInPolygon, polygonArea } from '../js/model/geometry.js';
import { renderProject } from './lib/render.mjs';
import { validate } from '../js/model/validate.js';

const [cmd, file, opsFile] = process.argv.slice(2);
const project = JSON.parse(readFileSync(file, 'utf8'));
const doc = project.doc;
const base = file.replace(/\.floorplan\.json$/, '');

const roomAt = (x, y) => {
  let best = null, ba = Infinity;
  for (const it of doc.items) {
    if (it.type !== 'room') continue;
    const poly = roomPolygon(it);
    if (!pointInPolygon([x, y], poly)) continue;
    const a = Math.abs(polygonArea(poly));
    if (a < ba) { best = it; ba = a; }
  }
  return best;
};
const find = (op) => {
  if (op.id) return doc.items.find((it) => it.id === op.id);
  if (op.at) return roomAt(op.at[0], op.at[1]);
  if (op.number) return doc.items.find((it) => it.type === 'room' && it.number === op.number);
  return null;
};
const r5 = (v) => Math.round(v);

function show() {
  console.log(`${doc.meta.building} floor ${doc.meta.floor} (${doc.meta.slug})  viewBox ${JSON.stringify(doc.viewBox)}`);
  console.log('outline', JSON.stringify(doc.floor && doc.floor.points));
  for (const it of doc.items) {
    if (it.type === 'room') console.log(`room  ${it.id}  ${(it.number || '-').padEnd(6)} ${it.cls.padEnd(5)} ${it.shape === 'poly' ? 'poly ' + JSON.stringify(it.points) : `x${it.x} y${it.y} w${it.w} h${it.h}`} ${it.name ? 'name=' + it.name : ''}`);
    else if (it.type === 'hall') console.log(`hall  ${it.id}  x${it.x} y${it.y} w${it.w} h${it.h}`);
    else if (it.type === 'stair') console.log(`stair ${it.id}  x${it.x} y${it.y} w${it.w} h${it.h} dir ${it.dir} ${it.label || ''}`);
    else if (it.type === 'door') console.log(`door  ${it.id}  (${it.x1},${it.y1})-(${it.x2},${it.y2}) ${it.kind}`);
    else if (it.type === 'compass') console.log(`compass ${it.id} (${it.x},${it.y}) deg ${it.deg}`);
    else console.log(`${it.type} ${it.id}`);
  }
}

function applyOp(op) {
  const room = ['setNumber', 'setBox', 'setName', 'deleteRoom'].includes(op.op) ? find(op) : null;
  switch (op.op) {
    case 'setNumber': if (!room) throw new Error('no room for ' + JSON.stringify(op)); room.number = op.to; break;
    case 'setName': if (!room) throw new Error('no room for ' + JSON.stringify(op)); room.name = op.name; room.showName = !!op.name && room.cls === 'room'; if (op.cls) room.cls = op.cls; break;
    case 'setBox': if (!room) throw new Error('no room for ' + JSON.stringify(op)); Object.assign(room, { shape: 'rect', x: r5(op.x), y: r5(op.y), w: r5(op.w), h: r5(op.h) }); delete room.points; break;
    case 'addRoom': doc.items.push({ id: newId(), type: 'room', cls: op.cls || 'room', shape: 'rect', x: r5(op.x), y: r5(op.y), w: r5(op.w), h: r5(op.h), number: op.number || '', name: op.name || '', label: { pinned: false, x: null, y: null, fontSize: null }, showName: !!op.name, section: null }); break;
    case 'deleteRoom': if (!room) throw new Error('no room for ' + JSON.stringify(op)); doc.items = doc.items.filter((it) => it !== room); break;
    case 'deleteItem': case 'deleteHall': doc.items = doc.items.filter((it) => it.id !== op.id); break;
    case 'addHall': doc.items.push({ id: newId(), type: 'hall', x: r5(op.x), y: r5(op.y), w: r5(op.w), h: r5(op.h) }); break;
    case 'setHall': { const h = doc.items.find((it) => it.id === op.id); if (!h) throw new Error('no hall ' + op.id); Object.assign(h, { x: r5(op.x), y: r5(op.y), w: r5(op.w), h: r5(op.h) }); break; }
    case 'addStair': doc.items.push({ id: newId(), type: 'stair', x: r5(op.x), y: r5(op.y), w: r5(op.w), h: r5(op.h), dir: op.dir || 'v', ...(op.label ? { label: op.label } : {}) }); break;
    case 'addDoor': { const mx = (op.x1 + op.x2) / 2, my = (op.y1 + op.y2) / 2; doc.items.push({ id: newId(), type: 'door', x1: r5(op.x1), y1: r5(op.y1), x2: r5(op.x2), y2: r5(op.y2), kind: op.kind || 'EXIT', label: { x: r5(op.lx ?? mx), y: r5(op.ly ?? my + 55) } }); break; }
    case 'moveItem': {
      const it = doc.items.find((q) => q.id === op.id);
      if (!it) throw new Error('no item ' + op.id);
      for (const [a, b] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2']]) if (Number.isFinite(it[a])) { it[a] += op.dx; it[b] += op.dy; }
      if (it.points) it.points = it.points.map(([x, y]) => [x + op.dx, y + op.dy]);
      if (it.label && Number.isFinite(it.label.x)) it.label = { ...it.label, x: it.label.x + op.dx, y: it.label.y + op.dy };
      break;
    }
    case 'setOutline': doc.floor = { points: op.points.map(([x, y]) => [r5(x), r5(y)]) }; break;
    case 'setCompass': {
      let c = doc.items.find((it) => it.type === 'compass');
      if (!c) { c = { id: newId(), type: 'compass', x: 0, y: 0, deg: 0 }; doc.items.push(c); }
      Object.assign(c, { x: r5(op.x), y: r5(op.y), deg: op.deg ?? c.deg });
      break;
    }
    default: throw new Error('unknown op ' + op.op);
  }
}

if (cmd === 'show') show();
else if (cmd === 'check') {
  const v = validate(doc);
  console.log(v.length ? v.map((x) => `${x.level.toUpperCase()} ${x.code}: ${x.message}`).join(String.fromCharCode(10)) : 'no problems');
}
else if (cmd === 'apply') {
  const ops = JSON.parse(readFileSync(opsFile, 'utf8'));
  let n = 0;
  for (const op of ops) { try { applyOp(op); n++; } catch (e) { console.log('SKIPPED', JSON.stringify(op), e.message); } }
  writeFileSync(file, JSON.stringify(project));
  console.log(`applied ${n}/${ops.length} ops`);
  const r = await renderProject(file, base, { svgOut: `${base}.svg` });
  console.log(`rendered ${base}.overlay.png (scale ${r.scale.toFixed(3)} px/unit, origin ${Math.round(r.x0)},${Math.round(r.y0)}) and ${base}.svg.png`);
} else if (cmd === 'render') {
  const r = await renderProject(file, base, { svgOut: `${base}.svg` });
  console.log(`rendered ${base}.overlay.png (scale ${r.scale.toFixed(3)} px/unit, origin ${Math.round(r.x0)},${Math.round(r.y0)}) and ${base}.svg.png`);
} else if (cmd === 'view') {
  const [x, y, w, h] = process.argv.slice(4).map(Number);
  const r = await renderProject(file, base, { region: [x, y, w, h], tag: 'view' });
  console.log(`rendered ${base}.view.png (region ${x},${y} ${w}x${h}, ${r.scale.toFixed(2)} px/unit)`);
} else console.log('usage: floorkit.mjs show|apply|render <file.floorplan.json> [ops.json]');
