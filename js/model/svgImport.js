// svgImport.js — parses the SVG dialect (docs/DIALECT.md) back
// into a floorplan doc, using a hand-written regex tokenizer (no DOM, works
// in Node). Must be the exact inverse of svgExport.js.
// Depends on: ./document.js (createDoc, newId, STD, NUMBER_RE).

import { createDoc, newId, roomCentroid, roomPolygon, STD } from './document.js';
import { pointInPolygon, polygonArea } from './geometry.js';

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

// Post-pass: a core rect holding a stair group becomes that stair's box; each
// label goes to the SMALLEST room shape containing it (build_rooms.py rule).
function attachTextsAndStairs(items, texts, problems) {
  for (const st of items.filter((it) => it.type === 'stair')) {
    const box = items.find((it) => it.type === 'room' && it.cls === 'core' && it.shape === 'rect' &&
      st.treads.every((l) => l.x1 >= it.x && l.x2 <= it.x + it.w && l.y1 >= it.y && l.y2 <= it.y + it.h));
    if (box) {
      Object.assign(st, { x: box.x, y: box.y, w: box.w, h: box.h });
      items.splice(items.indexOf(box), 1);
    }
  }
  const smallest = (x, y) => {
    let best = null, bestArea = Infinity;
    for (const it of items) {
      if (it.type === 'stair') {
        if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h && it.w * it.h < bestArea) { best = it; bestArea = it.w * it.h; }
      } else if (it.type === 'room' && it.cls !== 'void') {
        const pts = roomPolygon(it);
        if (pointInPolygon([x, y], pts)) {
          const a = Math.abs(polygonArea(pts));
          if (a < bestArea) { best = it; bestArea = a; }
        }
      }
    }
    return best;
  };
  for (const tx of texts) {
    const it = smallest(tx.x, tx.y);
    if (!it) { problems.push({ code: 'label-orphan', message: `Label "${tx.text}" is not inside any shape` }); continue; }
    if (it.type === 'stair') { it.label = tx.text; continue; }
    if (tx.cls === 'name') {
      it.showName = true;
      it.name = it.name ? `${it.name} ${tx.text}` : tx.text;
      continue;
    }
    const number = numberFromLabelText(tx.text);
    it.number = number || tx.text; // cores may carry free text such as "Elev"
    if (number && !it.showName) it.name = nameFromLabelText(tx.text, number);
    const c = roomCentroid(it);
    if (tx.x !== c.x || tx.y !== c.y) it.label = { ...it.label, pinned: true, x: tx.x, y: tx.y };
    if (tx.fontSize) it.label.fontSize = tx.fontSize;
  }
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
  const texts = []; // every lbl/lblS/name text, attached to shapes in a post-pass (like build_rooms.py)
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
      continue;
    }

    if (t.kind === 'open' && t.name === 'text' && /^(lbl|lblS|name)$/.test(t.attrs.class || '')) {
      const fs = t.attrs['font-size'] ? Number(String(t.attrs['font-size']).replace('px', '')) : null;
      texts.push({ cls: t.attrs.class, text: decodeEntities((t.trailingText || '').trim()), x: Number(t.attrs.x), y: Number(t.attrs.y), fontSize: fs });
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
          treads: lines.map((l) => ({ x1: Number(l.x1), y1: Number(l.y1), x2: Number(l.x2), y2: Number(l.y2) })),
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
      // the closest exit text anywhere in the file within 100 units (build_entrances.py rule)
      let best = 100.000001;
      for (const tt of tokens) {
        if (tt.kind === 'open' && tt.name === 'text' && tt.attrs.class === 'exit') {
          const lx = Number(tt.attrs.x), ly = Number(tt.attrs.y);
          const dist = Math.hypot(lx - midX, ly - midY);
          if (dist < best) {
            best = dist;
            const content = decodeEntities((tt.trailingText || '').trim());
            kind = content === 'Door' ? 'Door' : 'EXIT';
            label = { x: lx, y: ly };
          }
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

    // Icon / void-hatch decoration (see roomExtraLine in svgExport.js): a
    // pure function of cls+name+box, never stored on the item, so the
    // importer just skips these groups (and everything inside them) rather
    // than re-deriving anything from them.
    if (t.kind === 'open' && t.name === 'g' && (t.attrs.class === 'icon' || t.attrs.class === 'void-hatch')) {
      let j = i + 1;
      while (j < tokens.length && !(tokens[j].kind === 'close' && tokens[j].name === 'g')) j++;
      i = j;
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
  attachTextsAndStairs(items, texts, problems);
  doc0.items = items;
  doc0.sections = sectionsById;

  return { doc: doc0, problems };
}
