// pageFit.js — decides the exported SVG's frame (its root viewBox, plus a
// physical width/height when laid out for paper). Pure, no DOM, so the
// Preview step and the downloaded file always use the very same numbers.
//
//   fit    : the viewBox hugs everything drawn (plan, labels, doors, compass,
//            legend) with a small margin. Nothing is cut off, whether the
//            building is tall or wide. This is the file the map app shows.
//   letter : US printer paper, 8.5 x 11 in; a4 : 210 x 297 mm (printer paper
//            outside the US). The drawing starts centered inside a print
//            margin ("Auto" picks portrait/landscape by its shape); the user
//            can then move it and resize it (uniformly — its proportions never
//            change) anywhere on the sheet. The SVG gets width/height in in/mm
//            and an @page rule, so it prints at that size and orientation.
//
// Depends on: ./document.js (labelPos, labelText, labelClass, STD),
// ../view/panels/legend.js (legendGroupSize).

import { labelPos, labelText, labelClass, STD, doorSymbol } from './document.js';
import { legendGroupSize } from '../view/panels/legend.js';
import { outlinesOf } from './connect.js';

export const PAGES = {
  fit: { label: 'Fit to SVG' },
  // margin: where "Auto" fits the drawing. safe: the edge band most printers
  // can't print, so the drawing is never moved or enlarged into it.
  letter: { label: 'Letter 8.5 × 11 in', w: 8.5, h: 11, unit: 'in', margin: 0.4, safe: 0.25 },
  a4: { label: 'A4 210 × 297 mm', w: 210, h: 297, unit: 'mm', margin: 10, safe: 6 },
};

export const MIN_SCALE = 0.2; // smallest size on paper, relative to "fits the margins"

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

// The box around everything the export draws, in plan units — including a
// legend item. (`legend` / `legendSize` add an extra legend box, e.g. in tests.)
export function contentBounds(doc, legend = null, legendSize = null) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const floor = doc.floor && doc.floor.points;
  if (floor) for (const [x, y] of floor) growBox(b, x, y, 0, 0, WALL_PAD);
  for (const o of outlinesOf(doc)) for (const [x, y] of o.points) growBox(b, x, y, 0, 0, WALL_PAD); // the other buildings' walls

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
      const sym = doorSymbol(it), lab = sym ? sym.label : it.label;
      if (lab) growBox(b, lab.x - EXIT_HALF_W, lab.y - EXIT_HALF_H, EXIT_HALF_W * 2, EXIT_HALF_H * 2);
      if (sym) for (const lf of sym.leaves) growBox(b, lf.open.x, lf.open.y, 0, 0, 2); // the swing
    } else if (it.type === 'authwall') {
      // 12 covers the padlock drawn at the wall's middle.
      growBox(b, Math.min(it.x1, it.x2), Math.min(it.y1, it.y2), Math.abs(it.x2 - it.x1), Math.abs(it.y2 - it.y1), 12);
    } else if (it.type === 'compass') {
      growBox(b, it.x - COMPASS_REACH, it.y - COMPASS_REACH, COMPASS_REACH * 2, COMPASS_REACH * 2);
    } else if (it.type === 'legend') {
      const size = legendGroupSize();
      const s = it.scale && Number.isFinite(it.scale) ? it.scale : 1;
      growBox(b, it.x, it.y, size.w * s, size.h * s);
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

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// The frame to export: { x, y, w, h } (integer viewBox) and `content` (the
// drawing's box). For paper also { width, height } attribute strings, the
// orientation used, and the placement actually applied after clamping:
// { scale, fx, fy, maxScale } — scale 1 = fits inside the print margin,
// (fx, fy) = where the drawing's center sits on the sheet (0..1).
// `layout` = { scale, fx, fy } from the user (missing = centered, scale 1).
export function pageFrame(bounds, page = 'fit', orientation = 'auto', layout = null) {
  const spec = PAGES[page] || PAGES.fit;
  const bw = Math.max(1, bounds.w);
  const bh = Math.max(1, bounds.h);
  const content = { x: bounds.x, y: bounds.y, w: bw, h: bh };

  if (!spec.unit) {
    const pad = Math.max(16, Math.round(Math.max(bw, bh) * 0.03));
    return { ...intFrame(bounds.x - pad, bounds.y - pad, bw + pad * 2, bh + pad * 2), content };
  }

  const landscape = orientation === 'landscape' || (orientation !== 'portrait' && bw > bh);
  const paperW = landscape ? spec.h : spec.w;
  const paperH = landscape ? spec.w : spec.h;
  // Plan units per inch/mm when the drawing just fits inside the margins.
  const fitPerUnit = Math.max(bw / (paperW - spec.margin * 2), bh / (paperH - spec.margin * 2));
  // Largest size that still keeps the whole drawing inside the printable area.
  const maxScale = Math.min(((paperW - spec.safe * 2) * fitPerUnit) / bw, ((paperH - spec.safe * 2) * fitPerUnit) / bh);
  const scale = clamp(layout && Number.isFinite(layout.scale) ? layout.scale : 1, MIN_SCALE, maxScale);
  const perUnit = fitPerUnit / scale;
  const w = paperW * perUnit;
  const h = paperH * perUnit;
  // Keep the drawing's box inside the printable area: its center can only go
  // so near an edge.
  const halfW = bw / w / 2 + spec.safe / paperW;
  const halfH = bh / h / 2 + spec.safe / paperH;
  const fx = clamp(layout && Number.isFinite(layout.fx) ? layout.fx : 0.5, halfW, 1 - halfW);
  const fy = clamp(layout && Number.isFinite(layout.fy) ? layout.fy : 0.5, halfH, 1 - halfH);
  const cx = bounds.x + bw / 2;
  const cy = bounds.y + bh / 2;
  return {
    ...intFrame(cx - fx * w, cy - fy * h, w, h),
    content,
    width: `${paperW}${spec.unit}`,
    height: `${paperH}${spec.unit}`,
    orientation: landscape ? 'landscape' : 'portrait',
    scale,
    fx,
    fy,
    maxScale,
  };
}

// Integer viewBox that still covers the exact frame.
function intFrame(x, y, w, h) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  return { x: x0, y: y0, w: Math.ceil(x + w) - x0, h: Math.ceil(y + h) - y0 };
}

const PAGE_RULE_RE = /\n?\s*<style class="page">[\s\S]*?<\/style>/;

// Rewrite the root <svg> tag of an exported SVG to use `frame`. For paper, an
// @page rule tells the printer the sheet size and orientation — without it a
// browser prints a landscape SVG shrunk onto a portrait page.
export function applyFrame(svgText, frame) {
  const out = svgText.replace(PAGE_RULE_RE, '').replace(/<svg\b[^>]*>/, (tag) => {
    let root = tag
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/viewBox="[^"]*"/, `viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}"`);
    if (frame.width && frame.height) {
      root = root.replace(/^<svg\b/, `<svg width="${frame.width}" height="${frame.height}"`);
      root += `\n  <style class="page">@page { size: ${frame.width} ${frame.height}; margin: 0; }</style>`;
    }
    return root;
  });
  return out;
}
