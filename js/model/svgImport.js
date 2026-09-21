// svgImport.js — parses the BetterNMSUMaps SVG dialect (docs/DIALECT.md) back
// into a floorplan doc, using a hand-written regex tokenizer (no DOM, works
// in Node). Must be the exact inverse of svgExport.js.
// Depends on: ./document.js (createDoc, newId, STD, NUMBER_RE).

import { createDoc, newId, roomCentroid, STD } from './document.js';

const TAG_RE = /<!--([\s\S]*?)-->|<([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>|<\/([a-zA-Z][\w-]*)>/g;

function parseAttrs(attrStr) {
  const attrs = {};
  const re = /([\w:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrStr))) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

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

// Tokenize into a flat list: { kind:'comment'|'open'|'close'|'selfclose', name, attrs, raw, text (for content between open/close) }
function tokenize(svgText) {
  const tokens = [];
  let lastIndex = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(svgText))) {
    const [full, commentBody, openName, attrStr, closeName] = m;
    // capture any text content since the previous tag as belonging to the
    // token right before it (used for <text>...</text>)
    if (tokens.length) {
      const between = svgText.slice(lastIndex, m.index);
      tokens[tokens.length - 1].trailingText = between;
    }
    lastIndex = TAG_RE.lastIndex;

    if (commentBody !== undefined) {
      tokens.push({ kind: 'comment', text: commentBody.trim(), raw: full });
    } else if (openName !== undefined) {
      const selfClosing = full.endsWith('/>');
      tokens.push({
        kind: selfClosing ? 'selfclose' : 'open',
        name: openName,
        attrs: parseAttrs(attrStr || ''),
        raw: full,
      });
    } else if (closeName !== undefined) {
      tokens.push({ kind: 'close', name: closeName, raw: full });
    }
  }
  return tokens;
}

function numberFromLabelText(text) {
  const m = text.match(/(?:^|\s)([A-Z]?\d{3}[A-Z]?)$/);
  return m ? m[1] : '';
}

function nameFromLabelText(text, number) {
  if (!number) return text.trim();
  const idx = text.lastIndexOf(number);
  return text.slice(0, idx).trim();
}

export function importSvg(svgText) {
  const problems = [];
  const tokens = tokenize(svgText);

  let viewBox = { x: 0, y: 0, w: 0, h: 0 };
  const svgOpen = tokens.find((t) => (t.kind === 'open' || t.kind === 'selfclose') && t.name === 'svg');
  if (svgOpen && svgOpen.attrs.viewBox) {
    const parts = svgOpen.attrs.viewBox.trim().split(/\s+/).map(Number);
    viewBox = { x: parts[0] || 0, y: parts[1] || 0, w: parts[2] || 0, h: parts[3] || 0 };
  }

  let meta = { building: '', property: '', floor: 1, slug: '' };
  let headerFound = false;
  const sectionsById = [];
  const sectionTitleToId = new Map();
  let currentSectionId = null;

  const doc0 = createDoc(meta, viewBox);
  const items = [];

  // Track state while walking tokens
  let lastRoom = null; // most recently emitted room item, for attaching lbl/name texts
  const headerRe = /^\s*(.+?) \(bldg (\S+)\) - FLOOR (\d+)/;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.kind === 'comment') {
      if (!headerFound) {
        const hm = headerRe.exec(t.text);
        if (hm) {
          meta = { building: hm[1], property: hm[2], floor: Number(hm[3]), slug: '' };
          headerFound = true;
          continue;
        }
      }
      // Section comment: only meaningful before/around rooms (not inside style etc.)
      const title = t.text.trim();
      if (title && !/^</.test(title)) {
        let id = sectionTitleToId.get(title);
        if (!id) {
          id = newId();
          sectionTitleToId.set(title, id);
          sectionsById.push({ id, title });
        }
        currentSectionId = title === 'ROOMS' ? null : id;
      }
      continue;
    }

    if (t.kind === 'open' && t.name === 'style') {
      // skip to </style>
      while (i < tokens.length && !(tokens[i].kind === 'close' && tokens[i].name === 'style')) i++;
      continue;
    }

    if ((t.kind === 'selfclose' || t.kind === 'open') && t.name === 'polygon' && t.attrs.class === 'floor') {
      const points = parsePoints(t.attrs.points || '');
      doc0.floor = { points };
      continue;
    }

    if ((t.kind === 'selfclose') && t.name === 'rect' && /^(room|big|ours|core|void)$/.test(t.attrs.class || '')) {
      const item = {
        id: newId(),
        type: 'room',
        cls: t.attrs.class,
        shape: 'rect',
        x: Number(t.attrs.x),
        y: Number(t.attrs.y),
        w: Number(t.attrs.width),
        h: Number(t.attrs.height),
        number: '',
        name: '',
        label: { pinned: false, x: null, y: null, fontSize: null },
        showName: false,
        section: currentSectionId,
      };
      items.push(item);
      lastRoom = item;
      continue;
    }

    if ((t.kind === 'selfclose') && t.name === 'polygon' && /^(room|big|ours|core|void)$/.test(t.attrs.class || '')) {
      const item = {
        id: newId(),
        type: 'room',
        cls: t.attrs.class,
        shape: 'poly',
        points: parsePoints(t.attrs.points || ''),
        number: '',
        name: '',
        label: { pinned: false, x: null, y: null, fontSize: null },
        showName: false,
        section: currentSectionId,
      };
      items.push(item);
      lastRoom = item;
      continue;
    }

    if (t.kind === 'open' && t.name === 'text' && /^(lbl|lblS)$/.test(t.attrs.class || '')) {
      const textContent = decodeEntities((t.trailingText || '').trim());
      const number = numberFromLabelText(textContent);
      const name = nameFromLabelText(textContent, number);
      if (lastRoom) {
        lastRoom.number = number;
        lastRoom.name = name;
        const x = Number(t.attrs.x);
        const y = Number(t.attrs.y);
        const centroid = roomCentroid(lastRoom);
        const diff = Math.hypot(x - centroid.x, y - centroid.y);
        if (diff > 1) {
          lastRoom.label.pinned = true;
          lastRoom.label.x = x;
          lastRoom.label.y = y;
        }
        if (t.attrs['font-size']) {
          const fm = /^(\d+(?:\.\d+)?)px$/.exec(t.attrs['font-size']);
          if (fm) lastRoom.label.fontSize = Number(fm[1]);
        }
      }
      continue;
    }

    if (t.kind === 'open' && t.name === 'text' && t.attrs.class === 'name') {
      const textContent = decodeEntities((t.trailingText || '').trim());
      if (lastRoom) {
        lastRoom.showName = true;
        lastRoom.name = textContent;
      }
      continue;
    }

    if (t.kind === 'open' && t.name === 'g' && t.attrs.class === 'stair') {
      const lines = [];
      let j = i + 1;
      while (j < tokens.length && !(tokens[j].kind === 'close' && tokens[j].name === 'g')) {
        if (tokens[j].name === 'line') {
          lines.push(tokens[j].attrs);
        }
        j++;
      }
      i = j; // skip to closing g
      if (lines.length) {
        const xs = [], ys = [];
        for (const l of lines) {
          xs.push(Number(l.x1), Number(l.x2));
          ys.push(Number(l.y1), Number(l.y2));
        }
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const spanX = Math.max(...xs) - minX;
        const spanY = Math.max(...ys) - minY;
        // horizontal lines (y1===y2) stacked down y axis -> dir 'v'
        const first = lines[0];
        const horizontal = Number(first.y1) === Number(first.y2);
        // stairTreads() places treads at edge+9, edge+9+18, ... while
        // offset < span, where edge is item.x or item.y. Reconstruct the
        // exact edge/span that reproduce the same tread positions: the
        // first tread sits at edge+9, and span = lastOffset + tread (the
        // upper bound of the range that yields the same count).
        const x = horizontal ? minX : minX - 9;
        const y = horizontal ? minY - 9 : minY;
        const w = horizontal ? spanX : spanX + STD.tread;
        const h = horizontal ? spanY + STD.tread : spanY;
        items.push({
          id: newId(),
          type: 'stair',
          x, y, w, h,
          dir: horizontal ? 'v' : 'h',
        });
      }
      continue;
    }

    if (t.kind === 'selfclose' && t.name === 'line' && t.attrs.class === 'door') {
      const x1 = Number(t.attrs.x1), y1 = Number(t.attrs.y1);
      const x2 = Number(t.attrs.x2), y2 = Number(t.attrs.y2);
      const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
      // find following exit text within 100 units
      let kind = null;
      let label = { x: midX, y: midY };
      for (let j = i + 1; j < tokens.length && j < i + 6; j++) {
        const tt = tokens[j];
        if (tt.kind === 'open' && tt.name === 'text' && tt.attrs.class === 'exit') {
          const lx = Number(tt.attrs.x), ly = Number(tt.attrs.y);
          const dist = Math.hypot(lx - midX, ly - midY);
          if (dist <= 100) {
            const content = decodeEntities((tt.trailingText || '').trim());
            kind = content === 'Door' ? 'Door' : 'EXIT';
            label = { x: lx, y: ly };
          }
          break;
        }
      }
      items.push({
        id: newId(),
        type: 'door',
        x1, y1, x2, y2,
        kind: kind || 'EXIT',
        label,
      });
      continue;
    }

    if ((t.kind === 'open' || t.kind === 'selfclose') && t.name === 'g' && t.attrs.class === 'compass') {
      const transform = t.attrs.transform || '';
      const tm = /translate\(([-\d.]+)[,\s]+([-\d.]+)\)/.exec(transform);
      const rm = /rotate\(([-\d.]+)\)/.exec(transform);
      const x = tm ? Number(tm[1]) : 0;
      const y = tm ? Number(tm[2]) : 0;
      const deg = rm ? Number(rm[1]) : 0;
      items.push({ id: newId(), type: 'compass', x, y, deg });
      // skip to closing g if open
      if (t.kind === 'open') {
        let j = i + 1;
        while (j < tokens.length && !(tokens[j].kind === 'close' && tokens[j].name === 'g')) j++;
        i = j;
      }
      continue;
    }

    // Anything else with a transform attribute (outside compass, already handled)
    if ((t.kind === 'open' || t.kind === 'selfclose') && t.attrs && t.attrs.transform) {
      problems.push({ code: 'transform-present', message: `Unexpected transform on <${t.name}>` });
      continue;
    }

    if (t.kind === 'open' || t.kind === 'selfclose') {
      if (!/^(svg|text|line)$/.test(t.name)) {
        problems.push({ code: 'unknown-element', message: `Unknown element <${t.name}>` });
      }
    }
  }

  doc0.meta = meta;
  doc0.items = items;
  doc0.sections = sectionsById;

  return { doc: doc0, problems };
}
