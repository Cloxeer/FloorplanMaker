// pageFit.js — decides the exported SVG's frame (its root viewBox, plus a
// physical width/height when laid out for paper). Pure, no DOM, so the
// Preview step and the downloaded file always use the very same numbers.
//
//   fit    : the viewBox hugs everything drawn (plan, labels, doors, compass,
//            legend) with a small margin. Nothing is cut off, whether the
//            building is tall or wide. This is the file the map app shows.
//   letter : an 8.5 x 11 in sheet; a4 : a 210 x 297 mm sheet. The content is
//            centered on the page inside a print margin, portrait or
//            landscape, and the SVG gets width/height in in/mm so it prints
//            at that size.
//
// Depends on: ./document.js (labelPos, labelText, labelClass, STD).

import { labelPos, labelText, labelClass, STD } from './document.js';

export const PAGES = {
  fit: { label: 'Fit to SVG' },
  letter: { label: 'Letter 8.5 × 11 in', w: 8.5, h: 11, unit: 'in', margin: 0.4 },
  a4: { label: 'A4 210 × 297 mm', w: 210, h: 297, unit: 'mm', margin: 10 },
};

export const ORIENTATIONS = ['auto', 'portrait', 'landscape'];

// Sizes of things drawn around an item's own coordinates (see svgExport.js).
const COMPASS_REACH = 82; // outer ring r=80 plus half its 3-unit stroke
const WALL_PAD = 3; // half the 6-unit outer wall stroke
const EXIT_HALF_W = 30; // "EXIT" at 20px bold
const EXIT_HALF_H = 12;
const CHAR_W = 0.6; // average glyph width as a fraction of font size

function grow(b, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x < b.minX) b.minX = x;
  if (y < b.minY) b.minY = y;
  if (x > b.maxX) b.maxX = x;
  if (y > b.maxY) b.maxY = y;
}
function growBox(b, x, y, w, h, pad = 0) {
  grow(b, x - pad, y - pad);
  grow(b, x + w + pad, y + h + pad);
}
function growText(b, cx, cy, text, fontSize) {
  if (!text) return;
  const hw = (String(text).length * fontSize * CHAR_W) / 2;
  growBox(b, cx - hw, cy - fontSize * 0.6, hw * 2, fontSize * 1.2);
}

// The box around everything the export draws, in plan units. `legend` is
// { x, y, scale } (or null) and `legendSize` its unscaled { w, h }.
export function contentBounds(doc, legend = null, legendSize = null) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const floor = doc.floor && doc.floor.points;
  if (floor) for (const [x, y] of floor) growBox(b, x, y, 0, 0, WALL_PAD);

  for (const it of doc.items || []) {
    if (it.type === 'room') {
      if (it.shape === 'rect') growBox(b, it.x, it.y, it.w, it.h, 1);
      else for (const [x, y] of it.points || []) growBox(b, x, y, 0, 0, 1);
      if (it.cls !== 'void') {
        const p = labelPos(it);
        const fs = (it.label && it.label.fontSize) || (labelClass(it) === 'lblS' ? STD.lblS : STD.lbl);
        growText(b, p.x, p.y, labelText(it), fs);
        if (it.showName && it.name) growText(b, p.x, p.y - 30, it.name, 30);
      }
    } else if (it.type === 'hall' || it.type === 'stair') {
      growBox(b, it.x, it.y, it.w, it.h, 1);
    } else if (it.type === 'door') {
      growBox(b, Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1), 5);
      if (it.label) growBox(b, it.label.x - EXIT_HALF_W, it.label.y - EXIT_HALF_H, EXIT_HALF_W * 2, EXIT_HALF_H * 2);
    } else if (it.type === 'authwall') {
      growBox(b, Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1), 3);
    } else if (it.type === 'compass') {
      growBox(b, it.x - COMPASS_REACH, it.y - COMPASS_REACH, COMPASS_REACH * 2, COMPASS_REACH * 2);
    }
  }

  if (legend && legendSize) {
    const s = legend.scale && Number.isFinite(legend.scale) ? legend.scale : 1;
    growBox(b, legend.x, legend.y, legendSize.w * s, legendSize.h * s);
  }

  if (!Number.isFinite(b.minX)) {
    const vb = doc.viewBox || { x: 0, y: 0, w: 1000, h: 1000 };
    return { x: vb.x, y: vb.y, w: vb.w, h: vb.h };
  }
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// The frame to export: { x, y, w, h } (integer viewBox), and for paper also
// { width, height } attribute strings and the orientation actually used.
export function pageFrame(bounds, page = 'fit', orientation = 'auto') {
  const spec = PAGES[page] || PAGES.fit;
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);

  if (!spec.unit) {
    const pad = Math.max(16, Math.round(Math.max(bw, bh) * 0.03));
    return intFrame(bounds.x - pad, bounds.y - pad, bw + pad * 2, bh + pad * 2);
  }

  const landscape = orientation === 'landscape' || (orientation !== 'portrait' && bw > bh);
  const paperW = landscape ? spec.h : spec.w;
  const paperH = landscape ? spec.w : spec.h;
  const availW = paperW - spec.margin * 2;
  const availH = paperH - spec.margin * 2;
  const perUnit = Math.max(bw / availW, bh / availH); // plan units per inch/mm
  const w = paperW * perUnit;
  const h = paperH * perUnit;
  const cx = bounds.x + bw / 2;
  const cy = bounds.y + bh / 2;
  return {
    ...intFrame(cx - w / 2, cy - h / 2, w, h),
    width: `${paperW}${spec.unit}`,
    height: `${paperH}${spec.unit}`,
    orientation: landscape ? 'landscape' : 'portrait',
  };
}

// Integer viewBox that still covers the exact frame.
function intFrame(x, y, w, h) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  return { x: x0, y: y0, w: Math.ceil(x + w) - x0, h: Math.ceil(y + h) - y0 };
}

// Rewrite the root <svg> tag of an exported SVG to use `frame`.
export function applyFrame(svgText, frame) {
  return svgText.replace(/<svg\b[^>]*>/, (tag) => {
    let out = tag
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/viewBox="[^"]*"/, `viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}"`);
    if (frame.width && frame.height) {
      out = out.replace(/^<svg\b/, `<svg width="${frame.width}" height="${frame.height}"`);
    }
    return out;
  });
}
