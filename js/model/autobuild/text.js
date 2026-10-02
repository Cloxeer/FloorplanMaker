// text.js
// Finds the text on a straightened plan (without OCR): glyph blobs, grouped
// into lines inside each face; renders clean line crops for the OCR engine;
// (repair/vocabulary/voting/runs live in grammar.js, vocab.js, vote.js, runs.js and are re-exported).
// Pure. Depends on: js/model/autobuild/raster.js.

import { components, upscaleGray } from './raster.js';

// Most common glyph height (the room-number font) among small blobs.
export function estimateTextHeight(comps, L) {
  const hist = new Float32Array(200);
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (bh < 4 || bh > 0.03 * L || bw > bh * 1.4 || bw < bh * 0.15 || c.area < 6) continue;
    hist[Math.min(199, bh)]++;
  }
  let best = 8, score = -1;
  for (let h = 4; h < 120; h++) {
    const s = hist[h - 1] * 0.5 + hist[h] + hist[h + 1] * 0.5;
    if (s > score) { score = s; best = h; }
  }
  return best;
}

// ink8 = components(ink, w, h, 1, true). Glyph blobs (8-connected ink comps of letter size) with the face each belongs to.
export function findGlyphs(ink8, w, h, labels, outsideIds, textH, reach = 3) {
  const { comps, labels: inkLabels } = ink8;
  const glyphs = [];
  const lo = textH * 0.55, hi = textH * 2.4;
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    const isDot = bh <= textH * 0.4 && bw <= textH * 0.4; // periods, i-dots, slash bits
    if (!isDot && (bh < lo * 0.5 || bh > hi || bw > hi * 1.3)) continue;
    if (c.area < 3) continue;
    // face = majority of free pixels hugging the blob's bbox
    const votes = new Map();
    const probe = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const id = labels[y * w + x];
      if (id && !outsideIds.has(id)) votes.set(id, (votes.get(id) || 0) + 1);
    };
    for (let x = c.x0 - reach; x <= c.x1 + reach; x++) { probe(x, c.y0 - reach); probe(x, c.y1 + reach); }
    for (let y = c.y0 - reach; y <= c.y1 + reach; y++) { probe(c.x0 - reach, y); probe(c.x1 + reach, y); }
    let face = 0, vb = 0;
    for (const [id, n] of votes) if (n > vb) { vb = n; face = id; }
    glyphs.push({ ...c, bw, bh, face, dot: isDot });
  }
  return { glyphs, inkLabels, comps };
}

// Group a face's glyphs into text lines: [{ glyphs, x0,y0,x1,y1, h }]
export function buildLines(glyphs, textH) {
  const byFace = new Map();
  for (const g of glyphs) {
    if (!g.face || g.dot) continue;
    if (!byFace.has(g.face)) byFace.set(g.face, []);
    byFace.get(g.face).push(g);
  }
  const out = new Map();
  for (const [face, gs] of byFace) {
    gs.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const rows = [];
    for (const g of gs) {
      const cy = (g.y0 + g.y1) / 2;
      const row = rows.find((r) => Math.abs(r.cy - cy) <= Math.max(g.bh, r.h) * 0.55);
      if (row) { row.g.push(g); row.cy = (row.cy * (row.g.length - 1) + cy) / row.g.length; row.h = Math.max(row.h, g.bh); }
      else rows.push({ g: [g], cy, h: g.bh });
    }
    const lines = [];
    for (const r of rows) {
      r.g.sort((a, b) => a.x0 - b.x0);
      // split a row where the gap is very large (two separate captions)
      let cur = [r.g[0]];
      const flush = () => {
        const x0 = Math.min(...cur.map((g) => g.x0)), x1 = Math.max(...cur.map((g) => g.x1));
        const y0 = Math.min(...cur.map((g) => g.y0)), y1 = Math.max(...cur.map((g) => g.y1));
        lines.push({ glyphs: cur, x0, y0, x1, y1, h: y1 - y0 + 1, face });
      };
      for (let i = 1; i < r.g.length; i++) {
        if (r.g[i].x0 - r.g[i - 1].x1 > textH * 3.2) { flush(); cur = []; }
        cur.push(r.g[i]);
      }
      flush();
    }
    // keep reading order, drop single specks
    out.set(face, lines.filter((l) => l.glyphs.length >= 2 || l.h >= textH * 0.8).sort((a, b) => a.y0 - b.y0));
  }
  return out;
}

// Clean gray crop of one line: only that line's own glyph pixels, black on
// white, padded and scaled so the letters are ~targetH tall.
export function renderLine(gray, labelsInk, w, h, line, targetH = 44) {
  const pad = 3;
  const x0 = Math.max(0, line.x0 - pad), y0 = Math.max(0, line.y0 - pad);
  const x1 = Math.min(w - 1, line.x1 + pad), y1 = Math.min(h - 1, line.y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const ids = new Set(line.glyphs.map((g) => g.id));
  const crop = new Uint8Array(cw * ch).fill(255);
  // local contrast stretch from the glyph pixels
  let lo = 255, hi = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (ids.has(labelsInk[y * w + x])) { lo = Math.min(lo, gray[y * w + x]); hi = Math.max(hi, gray[y * w + x]); }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const near = ids.has(labelsInk[y * w + x])
        || ids.has(labelsInk[Math.max(0, y - 1) * w + x]) || ids.has(labelsInk[Math.min(h - 1, y + 1) * w + x])
        || ids.has(labelsInk[y * w + Math.max(0, x - 1)]) || ids.has(labelsInk[y * w + Math.min(w - 1, x + 1)]);
      if (near) {
        const v = gray[y * w + x];
        crop[(y - y0) * cw + (x - x0)] = ids.has(labelsInk[y * w + x]) ? Math.max(0, Math.min(255, ((v - lo) / Math.max(30, 190 - lo)) * 140)) : 255;
      }
    }
  }
  const f = Math.max(1.5, Math.min(8, targetH / Math.max(4, line.h)));
  const up = upscaleGray(crop, cw, ch, f);
  // 20 px white border all round helps Tesseract
  const B = 20, W = up.w + 2 * B, H = up.h + 2 * B;
  const out = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < up.h; y++) out.set(up.data.subarray(y * up.w, (y + 1) * up.w), (y + B) * W + B);
  return { data: out, w: W, h: H };
}

// --- grammar, vocabulary, voting, runs: split into sibling modules, re-exported here ---
export { repairNumber, repairNumberLegacy, parseNumber, inferFormat, floorPrior, flagOutliers } from './grammar.js';
export { NAME_VOCAB, matchName, titleCase, classify } from './vocab.js';
export { voteReads } from './vote.js';
export { repairRuns } from './runs.js';
