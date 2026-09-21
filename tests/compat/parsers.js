// tests/compat/parsers.js
// A regex-based, DOM-free JS reader of the BetterNMSUMaps SVG dialect,
// mirroring what tools/build_rooms.py and tools/build_entrances.py are
// described to do in docs/DIALECT.md (their source is unavailable; this
// implements the described rules). No dependency on js/model/*.

const LABEL_RE = /<text class="(lbl|lblS)"[^>]*\sx="(-?\d+(?:\.\d+)?)"[^>]*\sy="(-?\d+(?:\.\d+)?)"[^>]*>([^<]*)<\/text>/g;
const SHAPE_RE = /<(rect|polygon) class="(room|big|ours|core)"([^>]*)\/>/g;
const DOOR_RE = /<line class="door" x1="(-?\d+(?:\.\d+)?)" y1="(-?\d+(?:\.\d+)?)" x2="(-?\d+(?:\.\d+)?)" y2="(-?\d+(?:\.\d+)?)"\/>/g;
const EXIT_RE = /<text class="exit"[^>]*?\sx="(-?\d+(?:\.\d+)?)"[^>]*?\sy="(-?\d+(?:\.\d+)?)"[^>]*>([^<]*)<\/text>/g;
const STAIR_GROUP_RE = /<g class="stair">([\s\S]*?)<\/g>/g;
const STAIR_LINE_RE = /<line x1="(-?\d+(?:\.\d+)?)" y1="(-?\d+(?:\.\d+)?)" x2="(-?\d+(?:\.\d+)?)" y2="(-?\d+(?:\.\d+)?)"\/>/g;
const FLOOR_RE = /<polygon class="floor" points="([^"]*)"\/>/;
const NUMBER_RE = /(?:^|\s)([A-Z]?\d{3}[A-Z]?)$/;

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parsePoints(str) {
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split(',').map(Number));
}

function parseAttr(attrStr, name) {
  const re = new RegExp(`\\s${name}="([^"]*)"`);
  const m = re.exec(attrStr);
  return m ? m[1] : null;
}

function rectToPoints(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function pointInPolygon(pt, pts) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function collectShapes(svgText) {
  const shapes = [];
  SHAPE_RE.lastIndex = 0;
  let m;
  while ((m = SHAPE_RE.exec(svgText))) {
    const [, tag, cls, attrStr] = m;
    if (tag === 'rect') {
      const x = Number(parseAttr(attrStr, 'x'));
      const y = Number(parseAttr(attrStr, 'y'));
      const w = Number(parseAttr(attrStr, 'width'));
      const h = Number(parseAttr(attrStr, 'height'));
      shapes.push({ cls, points: rectToPoints(x, y, w, h) });
    } else {
      const pointsStr = parseAttr(attrStr, 'points') || '';
      shapes.push({ cls, points: parsePoints(pointsStr) });
    }
  }
  return shapes;
}

export function readRooms(svgText) {
  const shapes = collectShapes(svgText);
  const rooms = [];

  LABEL_RE.lastIndex = 0;
  let m;
  while ((m = LABEL_RE.exec(svgText))) {
    const [, , xStr, yStr, rawText] = m;
    const text = decodeEntities(rawText.trim());
    const numMatch = NUMBER_RE.exec(text);
    if (!numMatch) continue;
    const number = numMatch[1];
    const idx = text.lastIndexOf(number);
    const name = text.slice(0, idx).trim();
    const lx = Number(xStr);
    const ly = Number(yStr);

    let matchedShape = null;
    for (const shape of shapes) {
      if (pointInPolygon([lx, ly], shape.points)) {
        matchedShape = shape;
        break;
      }
    }
    if (!matchedShape) continue;

    rooms.push({
      number,
      name,
      cls: matchedShape.cls,
      points: matchedShape.points,
      label: { x: lx, y: ly },
    });
  }

  rooms.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
  return rooms;
}

export function readEntrances(svgText) {
  const doors = [];
  DOOR_RE.lastIndex = 0;
  let m;
  while ((m = DOOR_RE.exec(svgText))) {
    const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4]);
    doors.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  }

  const exits = [];
  EXIT_RE.lastIndex = 0;
  while ((m = EXIT_RE.exec(svgText))) {
    const x = Number(m[1]), y = Number(m[2]);
    const content = decodeEntities(m[3].trim());
    exits.push({ x, y, kind: content === 'Door' ? 'Door' : 'EXIT' });
  }

  const entrances = doors.map((d) => {
    let best = null, bestDist = Infinity;
    for (const e of exits) {
      const dist = Math.hypot(e.x - d.x, e.y - d.y);
      if (dist <= 100 && dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return { x: d.x, y: d.y, kind: best ? best.kind : 'EXIT' };
  });

  entrances.sort((a, b) => a.x - b.x || a.y - b.y);
  return entrances;
}

export function readStairs(svgText) {
  const stairs = [];
  STAIR_GROUP_RE.lastIndex = 0;
  let gm;
  while ((gm = STAIR_GROUP_RE.exec(svgText))) {
    const body = gm[1];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    STAIR_LINE_RE.lastIndex = 0;
    let lm;
    while ((lm = STAIR_LINE_RE.exec(body))) {
      const x1 = Number(lm[1]), y1 = Number(lm[2]), x2 = Number(lm[3]), y2 = Number(lm[4]);
      minX = Math.min(minX, x1, x2);
      maxX = Math.max(maxX, x1, x2);
      minY = Math.min(minY, y1, y2);
      maxY = Math.max(maxY, y1, y2);
    }
    if (isFinite(minX)) {
      stairs.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    }
  }
  stairs.sort((a, b) => a.x - b.x || a.y - b.y);
  return stairs;
}

export function readFloor(svgText) {
  const m = FLOOR_RE.exec(svgText);
  if (!m) return null;
  return parsePoints(m[1]);
}
