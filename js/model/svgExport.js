// svgExport.js — renders a floorplan doc to the exact BetterNMSUMaps SVG
// dialect described in docs/DIALECT.md. Pure string building, no DOM.
// Depends on: ./document.js (roomPolygon, labelPos, labelClass, labelText,
// stairTreads, STD).

import { labelPos, labelClass, labelText, stairTreads } from './document.js';

const IND = '  ';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function r(n) {
  return Math.round(n);
}

function pointsAttr(pts) {
  return pts.map(([x, y]) => `${r(x)},${r(y)}`).join(' ');
}

function roomShapeLine(item) {
  if (item.shape === 'rect') {
    return `${IND}<rect class="${item.cls}" x="${r(item.x)}" y="${r(item.y)}" width="${r(item.w)}" height="${r(item.h)}"/>`;
  }
  return `${IND}<polygon class="${item.cls}" points="${pointsAttr(item.points)}"/>`;
}

function roomLabelLines(item) {
  const lines = [];
  if (item.cls === 'void') return lines;
  const pos = labelPos(item);
  const cls = labelClass(item);
  const text = labelText(item);
  const fontAttr = item.label && item.label.fontSize ? ` font-size="${r(item.label.fontSize)}px"` : '';
  lines.push(`${IND}<text class="${cls}" x="${r(pos.x)}" y="${r(pos.y)}"${fontAttr}>${esc(text)}</text>`);
  if (item.showName && item.name) {
    lines.push(`${IND}<text class="name" x="${r(pos.x)}" y="${r(pos.y - 30)}">${esc(item.name)}</text>`);
  }
  return lines;
}

function stairLines(item) {
  const lines = [];
  lines.push(`${IND}<g class="stair">`);
  for (const t of stairTreads(item)) {
    lines.push(`${IND}${IND}<line x1="${r(t.x1)}" y1="${r(t.y1)}" x2="${r(t.x2)}" y2="${r(t.y2)}"/>`);
  }
  lines.push(`${IND}</g>`);
  return lines;
}

function doorLines(item) {
  const lines = [];
  lines.push(`${IND}<line class="door" x1="${r(item.x1)}" y1="${r(item.y1)}" x2="${r(item.x2)}" y2="${r(item.y2)}"/>`);
  const lx = r(item.label.x);
  const ly = r(item.label.y);
  if (item.kind === 'Door') {
    lines.push(`${IND}<text class="exit" fill="#5f6368" x="${lx}" y="${ly}">Door</text>`);
  } else {
    lines.push(`${IND}<text class="exit" x="${lx}" y="${ly}">EXIT</text>`);
  }
  return lines;
}

function compassLines(item) {
  const lines = [];
  const rot = item.deg ? ` rotate(${r(item.deg)})` : '';
  lines.push(`${IND}<g class="compass" transform="translate(${r(item.x)},${r(item.y)})${rot}">`);
  lines.push(`${IND}${IND}<circle r="26" fill="none" stroke="#8a8690" stroke-width="2"/>`);
  lines.push(`${IND}${IND}<polygon class="compass-north" points="0,-24 7,0 -7,0"/>`);
  lines.push(`${IND}${IND}<polygon points="0,24 7,0 -7,0" fill="#8a8690"/>`);
  lines.push(`${IND}${IND}<text class="compass-letter" y="-32">N</text>`);
  lines.push(`${IND}</g>`);
  return lines;
}

export function exportSvg(doc) {
  const { meta, viewBox } = doc;
  const lines = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(viewBox.x)} ${r(viewBox.y)} ${r(viewBox.w)} ${r(viewBox.h)}" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif">`
  );

  lines.push('<!--');
  lines.push(`  ${meta.building} (bldg ${meta.property}) - FLOOR ${meta.floor}`);
  lines.push('  Traced from the posted "Emergency Evacuation Plan" photo. Coordinates use the');
  lines.push("  photo's own pixel positions, so any shape can be checked against the photo.");
  lines.push('  One wall weight for outside walls, one for inside walls; nothing in between.');
  lines.push('-->');

  lines.push('<style>');
  lines.push('.floor { fill: #ffffff; stroke: #3a3d42; stroke-width: 6; stroke-linejoin: round; }');
  lines.push('.room  { fill: #eef1f4; stroke: #8f959c; stroke-width: 2; }');
  lines.push('.big   { fill: #e6ecf5; stroke: #8f959c; stroke-width: 2; }');
  lines.push('.ours  { fill: #f5e3ea; stroke: #8f959c; stroke-width: 2; }');
  lines.push('.core  { fill: #dfe3e8; stroke: #8f959c; stroke-width: 2; }');
  lines.push('.stair { stroke: #8f959c; stroke-width: 2; }');
  lines.push('.door  { stroke: #ffffff; stroke-width: 10; }');
  lines.push('.lbl   { fill: #2b2e33; font-size: 24px; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('.lblS  { fill: #2b2e33; font-size: 19px; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('.name  { fill: #1d1f23; font-size: 30px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('.exit  { fill: #1a7f37; font-size: 20px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('.compass-letter { font-size: 22px; font-weight: 600; fill: #8a8690; text-anchor: middle; }');
  lines.push('.compass-north  { fill: #8C0B42; }');
  lines.push('</style>');

  if (doc.floor && doc.floor.points && doc.floor.points.length) {
    lines.push(`${IND}<polygon class="floor" points="${pointsAttr(doc.floor.points)}"/>`);
  }

  const rooms = doc.items.filter((it) => it.type === 'room');
  const sections = doc.sections || [];
  const roomsBySection = new Map();
  const unsectioned = [];
  for (const room of rooms) {
    if (room.section) {
      if (!roomsBySection.has(room.section)) roomsBySection.set(room.section, []);
      roomsBySection.get(room.section).push(room);
    } else {
      unsectioned.push(room);
    }
  }

  for (const section of sections) {
    const secRooms = roomsBySection.get(section.id);
    if (!secRooms || !secRooms.length) continue;
    lines.push(`${IND}<!-- ${section.title} -->`);
    for (const room of secRooms) {
      lines.push(roomShapeLine(room));
      for (const l of roomLabelLines(room)) lines.push(l);
    }
  }

  if (unsectioned.length) {
    lines.push(`${IND}<!-- ROOMS -->`);
    for (const room of unsectioned) {
      lines.push(roomShapeLine(room));
      for (const l of roomLabelLines(room)) lines.push(l);
    }
  }

  const stairs = doc.items.filter((it) => it.type === 'stair');
  for (const stair of stairs) {
    for (const l of stairLines(stair)) lines.push(l);
  }

  const doors = doc.items.filter((it) => it.type === 'door');
  for (const door of doors) {
    for (const l of doorLines(door)) lines.push(l);
  }

  const compasses = doc.items.filter((it) => it.type === 'compass');
  for (const compass of compasses) {
    for (const l of compassLines(compass)) lines.push(l);
  }

  lines.push('</svg>');

  return lines.join('\n') + '\n';
}

export function exportExtrasSnippet(meta) {
  return `"${meta.property}": {\n  "name": "${esc(meta.building)}",\n  "floors": { "${meta.floor}": "${meta.slug}" }\n}`;
}

export function exportCommands() {
  return 'python tools/build_rooms.py\npython tools/build_entrances.py';
}

export function exportFileNames(meta) {
  return {
    svg: `data/floors/${meta.slug}.svg`,
    jpg: `data/floors/${meta.slug}-posted.jpg`,
  };
}
