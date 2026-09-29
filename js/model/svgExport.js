// svgExport.js — renders a floorplan doc to the exact SVG
// dialect described in docs/DIALECT.md. Pure string building, no DOM.
// Depends on: ./document.js (roomPolygon, labelPos, labelClass, labelText,
// stairTreads, STD).

import { labelPos, labelClass, labelText, stairTreads } from './document.js';
import { bbox } from './geometry.js';
import { iconForRoom, iconSvg } from '../view/icons.js';
import {
  ROOM_LOOK, cssDecl, exportClass, hatchLinesSvg, rectPoints,
} from './look.js';

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
  const cls = exportClass(item.cls); // a big room is written as a room
  if (item.shape === 'rect') {
    return `${IND}<rect class="${cls}" x="${r(item.x)}" y="${r(item.y)}" width="${r(item.w)}" height="${r(item.h)}"/>`;
  }
  return `${IND}<polygon class="${cls}" points="${pointsAttr(item.points)}"/>`;
}

function roomLabelLines(item) {
  const lines = [];
  if (item.cls === 'void') return lines;
  const pos = labelPos(item);
  const cls = labelClass(item);
  const text = item.showName && item.name ? (item.number || '') : labelText(item);
  if (!text) return lines; // an unnumbered shape gets no label at all
  const fontAttr = item.label && item.label.fontSize ? ` font-size="${r(item.label.fontSize)}"` : '';
  lines.push(`${IND}<text class="${cls}" x="${r(pos.x)}" y="${r(pos.y)}"${fontAttr}>${esc(text)}</text>`);
  if (item.showName && item.name) {
    lines.push(`${IND}<text class="name" x="${r(pos.x)}" y="${r(pos.y - 30)}">${esc(item.name)}</text>`);
  }
  return lines;
}

function roomBox(item) {
  if (item.shape === 'rect') return { x: item.x, y: item.y, w: item.w, h: item.h };
  return bbox(item.points);
}

// Icon / void-mesh decoration for a room, a pure function of cls+name+shape,
// so it never needs to be stored — export always regenerates it. Uses
// classes ("icon" / "void-hatch") outside the parser's known set (see
// tools/build_rooms.py), so it is silently ignored there and by svgImport.
// A void gets the "transparent" criss-cross mesh from look.js, clipped to
// its exact outline — the same pattern Trace and the legend draw.
function roomExtraLine(item) {
  if (item.cls === 'void') {
    const pts = item.shape === 'rect' ? rectPoints(item.x, item.y, item.w, item.h) : item.points;
    return `${IND}<g class="void-hatch">${hatchLinesSvg(pts, ROOM_LOOK.void.hatch, r)}</g>`;
  }
  const box = roomBox(item);
  const key = iconForRoom(item);
  if (!key) return null;
  return `${IND}${iconSvg(key, box.x, box.y, box.w, box.h, 0.5)}`;
}

function roomBlock(item) {
  const [lbl, ...rest] = roomLabelLines(item);
  const extra = roomExtraLine(item);
  const lines = [roomShapeLine(item) + (lbl ? lbl.trim() : ''), ...rest];
  if (extra) lines.push(extra);
  return lines;
}

// Hallways: solid grey corridors with no border, matching buildHall() in
// stageObjects.js so the SVG looks like the trace view. Drawn behind rooms.
// The "hall" class is outside the parser's known set, so build_rooms.py and
// svgImport.js both ignore these on read-back (halls live in the .json project).
// Where the "Hallway" label goes: the hall's center, unless a staff wall's
// padlock sits there — then the middle of the longer stretch beside the wall.
function hallLabelPos(item, walls) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const across = item.w >= item.h; // label runs along the hall's long side
  for (const w of walls) {
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    if (mx < item.x || mx > item.x + item.w || my < item.y || my > item.y + item.h) continue;
    if (across && Math.abs(mx - cx) < 60) {
      return mx - item.x > item.x + item.w - mx ? { x: (item.x + mx) / 2, y: cy } : { x: (mx + item.x + item.w) / 2, y: cy };
    }
    if (!across && Math.abs(my - cy) < 20) {
      return my - item.y > item.y + item.h - my ? { x: cx, y: (item.y + my) / 2 } : { x: cx, y: (my + item.y + item.h) / 2 };
    }
  }
  return { x: cx, y: cy };
}

function hallLines(item, walls = []) {
  const lines = [];
  lines.push(`${IND}<rect class="hall" x="${r(item.x)}" y="${r(item.y)}" width="${r(item.w)}" height="${r(item.h)}"/>`);
  // Skip the label on very thin/short segments so it never overflows the box.
  if (item.w >= 80 && item.h >= 28) {
    const p = hallLabelPos(item, walls);
    lines.push(`${IND}<text class="hall-lbl" x="${r(p.x)}" y="${r(p.y)}">Hallway</text>`);
  }
  return lines;
}

// Padlock glyph centered on (cx, cy), the same shape as lockGlyph() on the
// stage (stageObjects.js): a purple shackle over a white body.
function authwallLock(cx, cy) {
  return `<g class="authwall-lock" fill="#ffffff" stroke="#7c3aed" stroke-width="2">`
    + `<path d="M${cx - 5},${cy - 3} V${cy - 6} A5,5 0 0 1 ${cx + 5},${cy - 6} V${cy - 3}" fill="none"/>`
    + `<rect x="${cx - 7}" y="${cy - 3}" width="14" height="11" rx="2"/></g>`;
}

function stairLines(item) {
  const lines = [];
  lines.push(`${IND}<rect class="core" x="${r(item.x)}" y="${r(item.y)}" width="${r(item.w)}" height="${r(item.h)}"/>`);
  const treads = stairTreads(item).map((t) => `<line x1="${r(t.x1)}" y1="${r(t.y1)}" x2="${r(t.x2)}" y2="${r(t.y2)}"/>`);
  lines.push(`${IND}<g class="stair">${treads.join('')}</g>`);
  if (item.label) {
    const cls = Math.min(item.w, item.h) < 70 ? 'lblS' : 'lbl';
    lines.push(`${IND}<text class="${cls}" x="${r(item.x + item.w / 2)}" y="${r(item.y + item.h - 20)}">${esc(item.label)}</text>`);
  }
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
  // Same drawing as the existing hand-traced plans (only the translate/rotate values change).
  const I2 = IND + IND;
  return [
    `${IND}<!-- Which way the building really faces; matches the compass on the posted evacuation map. -->`,
    `${IND}<g class="compass" transform="translate(${r(item.x)},${r(item.y)}) rotate(${r(item.deg || 0)})">`,
    `${I2}<circle r="80" fill="#ffffff" stroke="#1d1f23" stroke-width="3"/>`,
    `${I2}<circle r="49" fill="none" stroke="#f0f0f3" stroke-width="2"/>`,
    `${I2}<path d="M0,-38 L11,0 L-11,0 Z" fill="#8C0B42"/>`,
    `${I2}<path d="M0,38 L11,0 L-11,0 Z" fill="#c7c7cc"/>`,
    `${I2}<circle r="4.5" fill="#ffffff" stroke="#8a8690" stroke-width="2"/>`,
    `${I2}<text class="compass-letter compass-north" x="0" y="-52">N</text>`,
    `${I2}<text class="compass-letter" x="0" y="62">S</text>`,
    `${I2}<text class="compass-letter" x="57" y="6">E</text>`,
    `${I2}<text class="compass-letter" x="-57" y="6">W</text>`,
    `${IND}</g>`,
  ];
}

export function exportSvg(doc) {
  const { meta, viewBox } = doc;
  const lines = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r(viewBox.x)} ${r(viewBox.y)} ${r(viewBox.w)} ${r(viewBox.h)}" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif">`
  );

  lines.push('  <!--');
  lines.push(`    ${meta.building} (bldg ${meta.property}) - FLOOR ${meta.floor}`);
  lines.push('    Traced from the posted "Emergency Evacuation Plan" photo. Coordinates use the');
  lines.push("    photo's own pixel positions, so any shape can be checked against the photo.");
  lines.push('    One wall weight for outside walls, one for inside walls; nothing in between.');
  lines.push('  -->');

  lines.push('  <style>');
  lines.push('    .floor { fill: #ffffff; stroke: #3a3d42; stroke-width: 6; stroke-linejoin: round; }');
  // Room kinds come from look.js — the same values the legend draws with.
  for (const cls of ['room', 'ours', 'core', 'void']) {
    lines.push(`    .${cls.padEnd(5)} { ${cssDecl(ROOM_LOOK[cls])} }`);
  }
  const mesh = ROOM_LOOK.void.hatch;
  lines.push(`    .void-hatch { stroke: ${mesh.stroke}; stroke-width: ${mesh.width}; }`);
  lines.push('    .stair { stroke: #8f959c; stroke-width: 2; }');
  lines.push('    .hall  { fill: #d7dbe0; stroke: none; }');
  lines.push('    .hall-lbl { fill: #6b7280; font-size: 18px; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('    .authwall { stroke: #7c3aed; stroke-width: 6; stroke-dasharray: 10 8; }');
  lines.push('    .door  { stroke: #ffffff; stroke-width: 10; }');
  lines.push('    .lbl   { fill: #2b2e33; font-size: 24px; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('    .lblS  { fill: #2b2e33; font-size: 19px; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('    .name  { fill: #1d1f23; font-size: 30px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('    .exit  { fill: #1a7f37; font-size: 20px; font-weight: 700; text-anchor: middle; dominant-baseline: middle; }');
  lines.push('    .compass-letter { font-size: 22px; font-weight: 600; fill: #8a8690; text-anchor: middle; }');
  lines.push('    .compass-north  { fill: #8C0B42; }');
  lines.push('    .floor-edge { fill:none; stroke:#3a3d42; stroke-width:6; stroke-linejoin:round; }');
  lines.push('  </style>');
  lines.push('');

  if (doc.floor && doc.floor.points && doc.floor.points.length) {
    lines.push(`${IND}<!-- OUTSIDE WALLS -->`);
    lines.push(`${IND}<polygon class="floor" points="${pointsAttr(doc.floor.points)}"/>`);
    lines.push('');
  }

  const halls = doc.items.filter((it) => it.type === 'hall');
  if (halls.length) {
    lines.push(`${IND}<!-- HALLWAYS -->`);
    const walls = doc.items.filter((it) => it.type === 'authwall');
    for (const hall of halls) lines.push(...hallLines(hall, walls));
    lines.push('');
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
    for (const room of secRooms) lines.push(...roomBlock(room));
    lines.push('');
  }

  if (unsectioned.length) {
    lines.push(`${IND}<!-- ROOMS -->`);
    for (const room of unsectioned) lines.push(...roomBlock(room));
    lines.push('');
  }

  const stairs = doc.items.filter((it) => it.type === 'stair');
  for (const stair of stairs) {
    for (const l of stairLines(stair)) lines.push(l);
  }

  // Staff-only walls: dashed purple lines inside hallways with a small padlock
  // at the middle, as drawn in trace (and shown in the legend). The
  // "authwall" / "authwall-lock" classes are outside the map-build parsers'
  // known set.
  const authwalls = doc.items.filter((it) => it.type === 'authwall');
  for (const w of authwalls) {
    lines.push(`${IND}<line class="authwall" x1="${r(w.x1)}" y1="${r(w.y1)}" x2="${r(w.x2)}" y2="${r(w.y2)}"/>`);
    lines.push(`${IND}${authwallLock(r((w.x1 + w.x2) / 2), r((w.y1 + w.y2) / 2))}`);
  }

  // Redraw the outer wall as a stroke-only line so rooms/halls flush to it
  // never cover it. Doors come AFTER this so their white opening cuts through
  // the wall line (a visible gap = the entrance) instead of being painted over.
  if (doc.floor && doc.floor.points && doc.floor.points.length) {
    lines.push(`${IND}<polygon class="floor-edge" points="${pointsAttr(doc.floor.points)}"/>`);
  }

  const doors = doc.items.filter((it) => it.type === 'door');
  for (const door of doors) {
    const [d, t] = doorLines(door);
    lines.push(d + t.trim());
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
