// stairs.js
// Finds stairs on a straightened poster plan: a set of short parallel treads,
// stacked at an even spacing (>= 3 of them), faint or bold, big or tiny.
// Works on the soft "darker than the surroundings" field, not on the binary ink, so treads
// 2 px apart, grey treads and treads broken by a handrail still read. Scale-free: every
// threshold is a multiple of textH. Pure.
// Depends on: js/model/autobuild/raster.js.

import { components, dilate } from './raster.js';

// signed darkness field (paper = 0, line = positive); coloured symbols (exit signs) are blanked
function darkField(layers, w, h, textH) {
  const D = new Float32Array(w * h);
  const { gray, bg, ink } = layers;
  if (gray && bg) for (let i = 0; i < D.length; i++) D[i] = bg[i] - gray[i];
  else for (let i = 0; i < D.length; i++) D[i] = ink[i] * 60;
  const col = new Uint8Array(w * h);
  for (let i = 0; i < col.length; i++) col[i] = layers.red[i] | layers.blue[i] | (layers.green ? layers.green[i] : 0);
  const cd = dilate(col, w, h, 2);
  const occ = new Uint8Array(w * h);
  for (let i = 0; i < D.length; i++) if (cd[i]) { D[i] = 0; occ[i] = 1; }
  // exit signs: whole box (the white pictogram inside has strokes of its own)
  const sig = new Uint8Array(w * h);
  for (let i = 0; i < sig.length; i++) sig[i] = layers.red[i] | (layers.green ? layers.green[i] : 0);
  const { comps } = components(dilate(sig, w, h, 1), w, h, 1, true);
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    if (Math.min(bw, bh) < textH * 1.8 || c.area / (bw * bh) < 0.4) continue;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) D[y * w + x] = 0;
  }
  return { D, occ };
}

// a route arrow lying across treads hides part of them: bridge each hidden stretch along the row
function bridge(A, OC, W, H, maxRun) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!OC[y * W + x]) continue;
      let e = x;
      while (e < W && OC[y * W + e]) e++;
      if (x > 0 && e < W && e - x <= maxRun) {
        const l = A[y * W + x - 1], r = A[y * W + e];
        for (let q = x; q < e; q++) A[y * W + q] = l + ((r - l) * (q - x + 1)) / (e - x + 1);
      }
      x = e;
    }
  }
}

function transpose(D, w, h) {
  const T = new D.constructor(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) T[x * h + y] = D[y * w + x];
  return T;
}

// local maxima of s[0..n) with plateaus collapsed to their middle: [{ y, v }]
function maxima(s, n) {
  const out = [];
  for (let y = 1; y < n - 1; y++) {
    if (s[y] <= s[y - 1]) continue;
    let e = y;
    while (e + 1 < n && s[e + 1] === s[y]) e++;
    if (e + 1 < n && s[e + 1] < s[y]) out.push({ y: (y + e) >> 1, v: s[y] });
    y = e;
  }
  return out;
}

// periodic chains in one window profile. -> [[{y,v}...]] (>= 3 treads each)
function chainsOf(s, n, P) {
  const raw = maxima(s, n);
  const valley = (a, b) => { let m = Infinity; for (let y = Math.max(0, Math.ceil(a)); y <= Math.min(n - 1, Math.floor(b)); y++) if (s[y] < m) m = s[y]; return m; };
  // keep maxima that stand out from the floor on both sides
  let pk = raw.filter((p, i) => {
    const lo = i ? raw[i - 1].y : Math.max(0, p.y - P.maxGap);
    const hi = i < raw.length - 1 ? raw[i + 1].y : Math.min(n - 1, p.y + P.maxGap);
    const lv = valley(Math.max(lo, p.y - P.maxGap), p.y), rv = valley(p.y, Math.min(hi, p.y + P.maxGap));
    return p.v - Math.max(lv, rv) >= P.amp;
  });
  const chains = [];
  let i = 0;
  const promOf = (k) => { const a = pk[k], lv = valley(k ? pk[k - 1].y : a.y - P.maxGap, a.y), rv = valley(a.y, k < pk.length - 1 ? pk[k + 1].y : a.y + P.maxGap); return a.v - Math.max(lv, rv); };
  pk = pk.map((p, k) => ({ ...p, pr: promOf(k) }));
  // halo ripples next to a real line are not lines
  pk = pk.filter((p) => !pk.some((q) => q !== p && Math.abs(q.y - p.y) <= P.maxGap && p.pr < 0.25 * q.pr));
  while (i < pk.length) {
    const ch = [pk[i]];
    let gap = 0, skipped = false, j = i + 1;
    for (; j < pk.length; j++) {
      const g = pk[j].y - ch[ch.length - 1].y;
      if (g > P.maxGap * 2.2) break;
      let ok = g >= P.minGap && g <= P.maxGap && (!gap || (g >= gap * 0.68 && g <= gap * 1.4 + 0.5));
      if (!ok && gap && !skipped && ch.length >= 3 && g >= gap * 1.7 && g <= gap * 2.3) { ok = true; skipped = true; }
      if (!ok) { if (g < P.minGap || pk[j].v < 0.5 * ch[ch.length - 1].v) continue; break; }
      // the dip between neighbours must be real, and the strengths alike
      const vmin = valley(ch[ch.length - 1].y, pk[j].y), top = Math.min(ch[ch.length - 1].v, pk[j].v);
      if (top - vmin < P.amp || Math.max(ch[ch.length - 1].v, pk[j].v) > 3.2 * top) break;
      if (!skipped || g <= gap * 1.4 + 0.5) gap = g;
      ch.push(pk[j]);
    }
    if (ch.length >= 3) { chains.push(ch); i = j; } else i++;
  }
  return chains;
}

// scan one direction: treads run along the first axis, stack along the second.
// -> blocks { a0, a1 (tread extent), ys (tread rows), p0, p1 }
function scan(A, W, H, P, OC, LB) {
  const pre = new Float64Array((W + 1) * H);
  for (let y = 0; y < H; y++) { let s = 0; const o = y * (W + 1); for (let x = 0; x < W; x++) { s += A[y * W + x]; pre[o + x + 1] = s; } }
  const step = Math.max(2, P.Lw >> 1);
  const cells = []; // chains per window position
  const s = new Float32Array(H);
  for (let x0 = 0; x0 + P.Lw <= W; x0 += step) {
    for (let y = 0; y < H; y++) s[y] = (pre[y * (W + 1) + x0 + P.Lw] - pre[y * (W + 1) + x0]) / P.Lw;
    for (const ch of chainsOf(s, H, P)) cells.push({ x0, x1: x0 + P.Lw - 1, ys: ch.map((p) => p.y), pr: ch.map((p) => p.pr) });
  }
  // link chains of neighbouring windows that share their tread rows
  const par = cells.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const tol = (c) => Math.max(1.5, 0.3 * ((c.ys[c.ys.length - 1] - c.ys[0]) / (c.ys.length - 1)));
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      if (b.x0 - a.x0 > step * 2.5) break;
      if (b.x0 === a.x0) continue;
      let m = 0;
      for (const y of a.ys) if (b.ys.some((q) => Math.abs(q - y) <= tol(a))) m++;
      if (m >= 3 || (m >= 2 && m === Math.min(a.ys.length, b.ys.length))) par[find(j)] = find(i);
    }
  }
  const groups = new Map();
  cells.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  const blocks = [];
  for (const g of groups.values()) {
    // tread rows: clusters of the members' rows that most windows agree on
    const all = g.flatMap((c) => c.ys).sort((a, b) => a - b);
    const rows = [];
    for (const y of all) {
      const last = rows[rows.length - 1];
      if (last && y - last.y1 <= Math.max(1, P.minGap * 0.6)) { last.y1 = y; last.n++; last.sum += y; } else rows.push({ y1: y, n: 1, sum: y });
    }
    const need = Math.max(1, Math.ceil(g.length * 0.4));
    const ys = rows.filter((r) => r.n >= need).map((r) => Math.round(r.sum / r.n));
    if (ys.length < 3) continue;
    // a few widely spaced parallel lines are as likely a box or walls as a flight
    if (ys.length <= 4 && (ys[ys.length - 1] - ys[0]) / (ys.length - 1) > 0.75 * P.textH) continue;
    let a0 = Math.min(...g.map((c) => c.x0)), a1 = Math.max(...g.map((c) => c.x1));
    const prs = g.flatMap((c) => c.pr).sort((p, q) => p - q);
    const hthr = Math.max(1.5, 0.4 * prs[prs.length >> 1]);
    // ridge strength of tread k at column x: the tread row against the rows midway to its neighbours
    const gapAt = (k) => (k < ys.length - 1 ? ys[k + 1] - ys[k] : ys[k] - ys[k - 1]);
    const gapBefore = (k) => (k > 0 ? ys[k] - ys[k - 1] : ys[1] - ys[0]);
    const at = (x, y) => (y >= 0 && y < H ? A[y * W + x] : -1e3);
    const ridge = (x, k) => {
      const y = ys[k];
      const top = Math.max(at(x, y - 1), at(x, y), at(x, y + 1));
      return top - 0.5 * (at(x, Math.round(y - gapBefore(k) / 2)) + at(x, Math.round(y + gapAt(k) / 2)));
    };
    const on = (x, k) => (x < 0 || x >= W ? 0 : (ridge(Math.max(0, x - 1), k) + ridge(x, k) + ridge(Math.min(W - 1, x + 1), k)) / 3 > hthr ? 1 : 0);
    const hit = (x) => { let n = 0; for (let k = 0; k < ys.length; k++) n += on(x, k); return n >= Math.max(2, 0.55 * ys.length); };
    let x = a0, miss = 0;
    while (x > 0 && miss <= 2) { x--; if (hit(x)) { a0 = x; miss = 0; } else miss++; }
    x = a1; miss = 0;
    while (x < W - 1 && miss <= 2) { x++; if (hit(x)) { a1 = x; miss = 0; } else miss++; }
    while (a0 < a1 && !hit(a0)) a0++;
    while (a1 > a0 && !hit(a1)) a1--;
    const len = a1 - a0 + 1;
    if (len < P.minLen || len > P.maxLen) continue;
    // each tread row must be one mostly unbroken line along the extent (rejects text, scattered marks)
    let cov = 0, worst = 1;
    const runs = [];
    for (let k = 0; k < ys.length; k++) {
      let c = 0, run = 0, top = 0, hole = 0;
      for (let q = a0; q <= a1; q++) {
        if (on(q, k)) { c++; run += 1 + hole; hole = 0; if (run > top) top = run; } else if (run && hole < 1) hole++; else { run = 0; hole = 0; }
      }
      cov += c / len; worst = Math.min(worst, c / len); runs.push(top);
    }
    if (cov / ys.length < 0.72 || worst < 0.5) continue;
    // a glyph row is never an unbroken line wider than a letter: a tread is
    runs.sort((p, q) => p - q);
    if (runs[runs.length >> 1] < P.minRun) continue;
    // treads mostly hidden under a coloured symbol are inferred, not seen
    let hid = 0;
    for (let q = a0; q <= a1; q++) { let o = 0; for (const y of ys) o += OC[y * W + q]; if (o >= 0.5 * ys.length) hid++; }
    if (hid > 0.4 * len) continue;
    // ink under a tread is one or two strokes (a handrail may split it), not a row of letters
    const shares = [];
    for (let k = 0; k < ys.length; k++) {
      const cnt = new Map();
      let inkOn = 0;
      for (let q = a0; q <= a1; q++) {
        if (!on(q, k)) continue;
        let l = 0;
        for (let d = -1; d <= 1 && !l; d++) { const yy = ys[k] + d; if (yy >= 0 && yy < H) l = LB[yy * W + q]; }
        if (l) { inkOn++; cnt.set(l, (cnt.get(l) || 0) + 1); }
      }
      if (inkOn >= 0.4 * len) { const v = [...cnt.values()].sort((p, q) => q - p); shares.push(((v[0] || 0) + (v[1] || 0)) / inkOn); }
    }
    shares.sort((p, q) => p - q);
    if (shares.length && shares[shares.length >> 1] < 0.75) continue;
    // between treads the paper shows (a handrail or arrow crossing is a column or two); glyph strokes fill it
    let vs = 0, vn = 0;
    for (let k = 0; k + 1 < ys.length; k++) {
      if (ys[k + 1] - ys[k] < 5) continue;
      const ym = Math.round((ys[k] + ys[k + 1]) / 2);
      let on = 0, tot = 0;
      for (let q = a0; q <= a1; q++) {
        const tv = Math.min(Math.max(at(q, ys[k] - 1), at(q, ys[k]), at(q, ys[k] + 1)), Math.max(at(q, ys[k + 1] - 1), at(q, ys[k + 1]), at(q, ys[k + 1] + 1)));
        if (tv < hthr) continue;
        tot++;
        if (at(q, ym) > 0.5 * tv) on++;
      }
      if (tot) { vs += on / tot; vn++; }
    }
    if (vn < 0.6 * (ys.length - 1)) { vn = 0; }
    if (vn && vs / vn > 0.3) continue;
    // treads too close to tell from a glyph's strokes: only a longer, fuller flight counts
    if (!vn && (ys.length < 5 || len < 1.6 * P.textH)) continue;
    blocks.push({ a0, a1, ys, p0: ys[0], p1: ys[ys.length - 1], treads: ys.length });
  }
  return blocks;
}

// Stairs: >= 3 parallel treads. -> [{ dir, x, y, w, h, treads }]
export function findStairs(layers, w, h, textH) {
  const info = layers.info || {};
  const { D, occ } = darkField(layers, w, h, textH);
  const weakC = Math.max(4, info.weakContrast || 9), sig = info.sigma || 2;
  const P = {
    Lw: Math.max(4, Math.round(textH * 0.6)),
    minGap: Math.max(1.5, textH * 0.2), maxGap: textH * 1.2,
    minLen: Math.max(7, Math.round(textH * 1.4)), maxLen: Math.round(textH * 9.5),
    textH,
    minRun: Math.max(5, Math.round(textH * 1.0)),
    amp: Math.max(0.45 * weakC, 0.8 * sig),
  };
  const ink8 = components(layers.ink, w, h, 1, true);
  const labels = ink8.labels;
  // letters: small squarish blobs. Two or more inside a block make it a word, not a stair.
  const glyphs = ink8.comps.filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, hi = Math.max(bw, bh), lo = Math.min(bw, bh);
    return hi >= 0.4 * textH && hi <= 1.7 * textH && hi / lo <= 3 && lo >= 2;
  });
  // a blurred word is one dense blob one letter tall (treads leave gaps: their fill is lower)
  const blobsW = ink8.comps.filter((c) => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, hi = Math.max(bw, bh), lo = Math.min(bw, bh);
    return lo >= 0.55 * textH && lo <= 1.6 * textH && hi >= 1.5 * lo && c.area / (bw * bh) >= 0.5;
  });
  // coloured symbols (pins, pictograms, route arrows) are not stairs; a thin arrow across one is fine
  const colouredShare = (b) => {
    const m = Math.round(textH * 0.5);
    let n = 0, t = 0;
    for (let y = Math.max(0, b.y - m); y < Math.min(h, b.y + b.h + m); y++) for (let x = Math.max(0, b.x - m); x < Math.min(w, b.x + b.w + m); x++) { t++; n += occ[y * w + x]; }
    return n / t;
  };
  const isWord = (b) => {
    let n = 0;
    for (const c of blobsW) if (c.x0 >= b.x - 2 && c.x1 <= b.x + b.w + 1 && c.y0 >= b.y - 2 && c.y1 <= b.y + b.h + 1) return true;
    for (const c of glyphs) if (c.x0 >= b.x - 2 && c.x1 <= b.x + b.w + 1 && c.y0 >= b.y - 2 && c.y1 <= b.y + b.h + 1) n++;
    return n >= 2;
  };
  const found = [];
  for (const dir of ['v', 'h']) {
    const A = dir === 'v' ? D.slice() : transpose(D, w, h);
    const OC = dir === 'v' ? occ : transpose(occ, w, h);
    bridge(A, OC, dir === 'v' ? w : h, dir === 'v' ? h : w, Math.round(textH * 2.5));
    const blocks = scan(A, dir === 'v' ? w : h, dir === 'v' ? h : w, P, OC, dir === 'v' ? labels : transpose(labels, w, h));
    for (const b of blocks) {
      const al = b.a1 - b.a0 + 1, ac = b.p1 - b.p0 + 1;
      found.push(dir === 'v'
        ? { dir, x: b.a0, y: b.p0, w: al, h: ac, treads: b.treads }
        : { dir, x: b.p0, y: b.a0, w: ac, h: al, treads: b.treads });
    }
  }
  // only stairs on the paper (not the wall, carpet or frame around the poster)
  const onPaper = (s) => {
    if (!layers.paper) return true;
    let n = 0, t = 0;
    const m = Math.round(textH * 2);
    for (let y = Math.max(0, s.y - m); y < Math.min(h, s.y + s.h + m); y++) for (let x = Math.max(0, s.x - m); x < Math.min(w, s.x + s.w + m); x++) { t++; n += layers.paper[y * w + x] | occ[y * w + x]; }
    return n >= 0.6 * t;
  };
  const kept = found.filter((b) => onPaper(b) && !isWord(b) && colouredShare(b) < (b.treads >= 4 ? 0.4 : 0.2));
  return mergeStairs(kept, textH);
}

// duplicates (a block read in both directions), and the two flights of one stair
function mergeStairs(found, textH) {
  const out = [];
  for (const s of found.sort((a, b) => b.treads - a.treads)) {
    const dup = out.find((o) => Math.abs((o.x + o.w / 2) - (s.x + s.w / 2)) < textH * 3 && Math.abs((o.y + o.h / 2) - (s.y + s.h / 2)) < textH * 3);
    if (!dup) out.push(s);
  }
  // half-flights: same direction, same tread length, continuing the stack or side by side
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length && !again; j++) {
        const a = out[i], b = out[j];
        if (a.dir !== b.dir) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const gx = -ox, gy = -oy;
        const stackAxis = a.dir === 'v' ? 'y' : 'x';
        const along = stackAxis === 'y' ? [ox, Math.min(a.w, b.w), gy] : [oy, Math.min(a.h, b.h), gx]; // [overlap along treads, shorter tread, gap across]
        const side = stackAxis === 'y' ? [oy, Math.min(a.h, b.h), gx] : [ox, Math.min(a.w, b.w), gy];
        const stacked = along[0] >= 0.7 * along[1] && along[2] <= textH * 1.5;
        const flights = side[0] >= 0.7 * side[1] && side[2] <= textH * 1.0 && side[2] > -1;
        if (!stacked && !flights) continue;
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
        if (Math.max(x1 - x0, y1 - y0) > textH * 11) continue;
        out[i] = { dir: a.dir, x: x0, y: y0, w: x1 - x0, h: y1 - y0, treads: a.treads + b.treads };
        out.splice(j, 1);
        again = true;
      }
    }
  }
  return out;
}
