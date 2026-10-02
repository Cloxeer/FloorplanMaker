// compass.js
// AutoBuild: multi-cue compass finder. A compass is a small, isolated mark made of some of:
//   ring (Hough circle), needle (a long thin ink stroke through the centre), the "N" glyph
//   beyond one needle end (letter-shape test in the compass' own, possibly tilted, frame).
// Candidates (rings + small ink components) are ranked by the cues they show; direction = the
// needle end that carries the "N". Pure and synchronous: `opts.ocrN({x,y,w,h}) -> bool` may veto
// or confirm the "N" glyph box when a caller has OCR.
// -> { x, y, deg, r, via } (deg = clockwise from straight up, like compassBearing) or null.
// Depends on: nothing (reads layers.ink/colored/pin/gray/bg from layers.js).

const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (d) => ((d % 360) + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// 5x5 letter N: two stems and the diagonal
const N_ON = ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X'];
const N_ON_N = 13, N_OFF_N = 10; // off cells on the top/bottom rows count half (a frame line may touch the glyph)

export function findCompassBest(layers, comps, footMask, w, h, textH, opts = {}) {
  // dark ink only: the compass is black/grey, the arrows (blue), exit signs and extinguishers (red) are not.
  // (layers.paper is not used: a filled needle half is not paper-coloured)
  const col = layers.colored, pin = layers.pin;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = layers.ink[i] && !(col && col[i]) && !(pin && pin[i]) ? 1 : 0;
  const px = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] ? 1 : 0; };
  const ink1 = new Uint8Array(w * h); // ink within one pixel: strokes are 1-2 px wide and centres are only known to a pixel
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!ink[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) ink1[Y * w + X] = 1; }
  }
  const hit = (x, y) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < w && y < h ? ink1[y * w + x] : 0; };
  const rMin = Math.max(4, Math.round(textH * 0.65)), rMax = Math.max(rMin + 2, Math.round(textH * 3));
  const maxSide = Math.max(textH * 12, 40);

  // free surroundings: share of the ring-shaped zone around the mark that holds no ink,
  // leaving out the needle/N sectors
  const isolation = (cx, cy, r, ths) => {
    let free = 0, n = 0;
    for (let a = 0; a < 36; a++) {
      const ang = a * 10;
      if (ths.some((t) => Math.abs(((ang - t + 540) % 360) - 180) < 22)) continue;
      for (const d of [r + 3, r + 5, r * 2.2 + 2]) { n++; free += hit(cx + d * Math.sin(ang * RAD), cy - d * Math.cos(ang * RAD)) ? 0 : 1; }
    }
    return n ? free / n : 0;
  };
  // ---- candidate centres -------------------------------------------------------------------
  const small = comps.filter((c) => Math.max(c.x1 - c.x0, c.y1 - c.y0) + 1 <= maxSide && c.area >= 6);
  const isSmall = new Uint8Array(w * h);
  let pts = [];
  for (const c of small) for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (px(x, y)) { pts.push(x, y); isSmall[y * w + x] = 1; }
  // a compass touching a wall or the frame is not a small component: also take the ink outside the building body
  if (footMask) for (let i = 0; i < w * h; i++) if (ink[i] && !isSmall[i] && !footMask[i]) pts.push(i % w, (i / w) | 0);
  const cap = 9000;
  if (pts.length / 2 > cap) { const k = Math.ceil(pts.length / 2 / cap); const q = []; for (let i = 0; i < pts.length; i += 2 * k) q.push(pts[i], pts[i + 1]); pts = q; }
  if (pts.length < 40) return null;
  const cands = [];
  const acc = new Int16Array(w * h);
  const stepR = Math.max(1, Math.ceil((rMax - rMin) / 40));
  for (let r = rMin; r <= rMax; r += stepR) {
    acc.fill(0);
    const steps = Math.max(24, Math.round(r * 3));
    const cs = [], sn = [];
    for (let a = 0; a < steps; a++) { cs.push(Math.cos((a * 2 * Math.PI) / steps)); sn.push(Math.sin((a * 2 * Math.PI) / steps)); }
    for (let k = 0; k < pts.length; k += 2) {
      for (let a = 0; a < steps; a++) {
        const cx = Math.round(pts[k] + r * cs[a]), cy = Math.round(pts[k + 1] + r * sn[a]);
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) acc[cy * w + cx]++;
      }
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const v0 = acc[y * w + x];
      if (v0 < steps * 0.12) continue;
      let v = 0, mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = acc[(y + dy) * w + x + dx]; v += a; if (a > mx) mx = a; }
      if (v0 < mx) continue;
      cands.push({ v: v / steps, x, y, r });
    }
  }
  // the circle itself is sampled for the real ring coverage (a vote count is not enough)
  // ring coverage with a one-pixel lateral tolerance: broken, blobby small rings still count
  const ringLoose = (cx, cy, r) => {
    let best = 0;
    for (const rr of [r - 1, r, r + 1]) {
      let n = 0;
      for (let a = 0; a < 48; a++) n += hit(cx + rr * Math.cos((a / 48) * 2 * Math.PI), cy + rr * Math.sin((a / 48) * 2 * Math.PI));
      best = Math.max(best, n / 48);
    }
    return best;
  };
  const ringCover = (cx, cy, r) => {
    let n = 0;
    const bins = 60;
    for (let a = 0; a < bins; a++) {
      const co = Math.cos((a / bins) * 2 * Math.PI), si = Math.sin((a / bins) * 2 * Math.PI);
      n += px(cx + (r - 1) * co, cy + (r - 1) * si) | px(cx + r * co, cy + r * si) | px(cx + (r + 1) * co, cy + (r + 1) * si);
    }
    return n / bins;
  };
  const ranked = cands.map((c) => ({ ...c, ring: ringLoose(c.x, c.y, c.r) })).filter((c) => c.ring >= 0.45);
  for (const c of ranked) c.cheap = c.ring * (0.3 + 0.7 * isolation(c.x, c.y, c.r, []));
  ranked.sort((a, b) => b.cheap - a.cheap);
  const centres = [];
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < Math.max(3, Math.min(a.r, b.r) * 0.5);
  for (const c of ranked) { if (centres.length >= 90) break; if (!centres.some((t) => near(t, c))) centres.push({ x: c.x, y: c.y, r: c.r, ring: c.ring }); }
  // stars / arrows / needles without a ring: the middle of a small sparse component
  for (const c of small) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, m = Math.max(bw, bh);
    if (m < textH * 1.6 || c.area / (bw * bh) > 0.4) continue;
    for (const [x, y] of [[(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2], [c.sx / c.area, c.sy / c.area]]) {
      const t = { x: Math.round(x), y: Math.round(y), r: Math.max(rMin, Math.round(m * 0.14)), ring: 0 };
      if (centres.length < 110 && !centres.some((o) => near(o, t))) centres.push(t);
    }
  }

  // a thick needle (filled arrow, tiny ring): elongated component, centred on its centroid
  for (const c of small) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, len = Math.hypot(bw, bh);
    if (len < textH * 3.5 || c.area / (bw * bh) > 0.35) continue;
    const t = { x: Math.round(c.sx / c.area), y: Math.round(c.sy / c.area), r: Math.max(rMin, Math.round(len * 0.13)), ring: 0 };
    if (!centres.some((o) => near(o, t))) centres.push(t);
  }
  if (opts.debug) opts.debug.centres = centres;

  // ---- cues ------------------------------------------------------------------------------
  // length of the solid stroke from the centre along bearing th (>= 80% of the pixels on it are ink)
  const reach = (cx, cy, th, lmax) => {
    const dx = Math.sin(th * RAD), dy = -Math.cos(th * RAD);
    let last = 0, gap = 0, n = 0;
    for (let t = 0; t <= lmax; t++) {
      if (hit(cx + dx * t, cy + dy * t)) { n++; gap = 0; if (n >= 0.8 * (t + 1)) last = t; } else if (++gap > 5) break;
    }
    return last;
  };
  // needle axes through (cx,cy): up to 3 distinct long solid strokes { phi, len, R0, R1 } (len = reach both ways)
  const axesOf = (cx, cy, r) => {
    const lmax = r * 9, R = new Float32Array(360);
    for (let k = 0; k < 360; k++) R[k] = reach(cx, cy, k, lmax);
    const A = Array.from({ length: 180 }, (_, k) => R[k] + R[k + 180]);
    const out = [];
    for (const k of A.map((v, i) => i).sort((i, j) => A[j] - A[i])) {
      if (out.length >= 3 || A[k] < 4.5 * r) break;
      if (out.some((o) => angDiff(o.k * 2, k * 2) < 30)) continue;
      // centre of the plateau of near-best axes (a thin needle is hit over a few degrees)
      let s = 0, n = 0;
      for (let d = -6; d <= 6; d++) { const q = (k + d + 180) % 180; if (A[q] >= A[k] - 2) { s += d; n++; } }
      // a needle ends; a wall or a frame line runs on past the search length
      if (R[k] < lmax * 0.9 && R[k + 180] < lmax * 0.9) out.push({ k, phi: wrap(k + s / Math.max(1, n)), len: A[k], R0: R[k], R1: R[k + 180] });
    }
    return out;
  };
  // share of the needle's centre line that is ink on the side of bearing th: a filled wedge ~1,
  // an outlined arm much less (its inside is empty), a hairline 1
  const armFill = (cx, cy, th, r) => {
    const ux = Math.sin(th * RAD), uy = -Math.cos(th * RAD);
    let best = 0;
    for (const lat of [-1, 0, 1]) {
      let k = 0, n = 0;
      for (let t = r * 1.3; t <= r * 3.2; t++) { k += px(cx + ux * t - uy * lat, cy + uy * t + ux * lat); n++; }
      best = Math.max(best, n ? k / n : 0);
    }
    return best;
  };
  // letter N at distance t along bearing th: recall of the stems/diagonal minus ink in the gaps
  // (the glyph sits at bearing th, tilted by ori: with the compass, or upright when ori = 0)
  const nMatch = (cx, cy, th, t, gh, lat, ori = th) => {
    const ux = Math.sin(ori * RAD), uy = -Math.cos(ori * RAD), rx = -uy, ry = ux, gw = gh * 0.8;
    const ox = cx + Math.sin(th * RAD) * t + Math.cos(th * RAD) * lat, oy = cy - Math.cos(th * RAD) * t + Math.sin(th * RAD) * lat;
    let on = 0, off = 0, fill = 0;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      let hits = 0;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const u = (i + (a + 0.5) / 3) / 5 - 0.5, v = 0.5 - (j + (b + 0.5) / 3) / 5; // v up
        hits += px(ox + rx * u * gw + ux * v * gh, oy + ry * u * gw + uy * v * gh);
      }
      fill += hits;
      if (hits >= 2) { if (N_ON[j][i] === 'X') on++; else off += j === 0 || j === 4 ? 0.5 : 1; }
    }
    let sc = on / N_ON_N - 0.6 * (off / N_OFF_N);
    // a glyph of ~6 px is a blob: take any half-filled lone mark there (the other cues decide)
    const fl0 = fill / 225;
    if (gh <= 10 && fl0 >= 0.3 && fl0 <= 0.85) sc = Math.max(sc, 0.45);
    if (sc < 0.4) return sc;
    // a lone letter: free space left and right of it (a letter inside a word has neighbours)
    let fl = 0, fr = 0;
    for (let k = 0; k < 7; k++) {
      const v = (k / 6 - 0.5) * 0.7, du = 0.5 + (gh * 0.3) / gw;
      const bx = ox + ux * v * gh, by = oy + uy * v * gh;
      fl += hit(bx - rx * du * gw, by - ry * du * gw) ? 0 : 1;
      fr += hit(bx + rx * du * gw, by + ry * du * gw) ? 0 : 1;
    }
    return Math.min(fl, fr) / 7 >= 0.7 ? sc : sc * 0.5;
  };
  const nSearch = (cx, cy, r, th, reachLen) => {
    let best = { s: -1, th, t: 0, gh: 0, lat: 0, ori: th };
    const sizes = [r * 0.9, r * 1.2, r * 1.6, textH * 0.7, textH];
    const t1 = Math.max(reachLen, r) + textH * 2.5;
    for (const gh of sizes) {
      if (gh < 5) continue;
      const t0 = reachLen > r * 1.6 ? reachLen * 0.7 + gh * 0.3 : r + gh * 0.6 + 2; // beyond the needle, not on it
      for (let t = t0; t <= t1; t += Math.max(1, gh / 8)) {
        for (const lat of [-gh * 0.15, 0, gh * 0.15]) {
          for (const ori of [th, 0]) {
            const s = nMatch(cx, cy, th, t, gh, lat, ori);
            if (s > best.s) best = { s, th, t, gh, lat, ori };
          }
        }
      }
    }
    // refine the glyph's own tilt a little
    for (const d of [-8, -4, 4, 8]) {
      const b = best;
      const s = nMatch(cx, cy, b.th, b.t, b.gh, b.lat, b.ori + d);
      if (s > best.s + 0.03) best = { ...b, s, ori: b.ori + d };
    }
    return best;
  };
  // principal direction of the needle's ink (a ray from a slightly wrong centre is biased)
  const refineAxis = (cx, cy, deg, ax, r) => {
    const ux = Math.sin(deg * RAD), uy = -Math.cos(deg * RAD), half = Math.max(2.5, r * 0.5);
    const fwd = Math.abs(((deg - ax.phi + 540) % 360) - 180) < 90 ? ax.R0 : ax.R1, back = fwd === ax.R0 ? ax.R1 : ax.R0;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let t = -back; t <= fwd; t += 0.5) for (let o = -half; o <= half; o += 1) {
      const x = cx + ux * t - uy * o, y = cy + uy * t + ux * o;
      if (!px(x, y)) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    if (n < 12) return deg;
    const mx = sx / n, my = sy / n, a = sxx / n - mx * mx, b = syy / n - my * my, c = sxy / n - mx * my;
    const th = 0.5 * Math.atan2(2 * c, a - b); // major axis, image coordinates
    let d = (Math.atan2(Math.cos(th), -Math.sin(th)) * 180) / Math.PI; // bearing, clockwise from up
    if (angDiff(d, deg) > 90) d += 180;
    return angDiff(d, deg) < 12 ? wrap(d) : deg;
  };
  // how black the darkest ink around the mark is (0 = washed out ... 1 = solid black): a compass has a filled
  // black needle half, wall-texture noise and thin print do not. (gray / local paper level, 5th percentile)
  const darkness = (cx, cy, rad) => {
    if (!layers.gray || !layers.bg) return 0.5;
    const v = [];
    for (let y = Math.max(0, Math.round(cy - rad)); y <= Math.min(h - 1, Math.round(cy + rad)); y++) for (let x = Math.max(0, Math.round(cx - rad)); x <= Math.min(w - 1, Math.round(cx + rad)); x++) {
      const i = y * w + x;
      if (ink[i]) v.push(layers.gray[i] / Math.max(1, layers.bg[i]));
    }
    if (v.length < 8) return 0;
    v.sort((a, b) => a - b);
    return clamp((0.62 - v[Math.floor(v.length * 0.05)]) / 0.35, 0, 1);
  };
  // grey-level spread of the paper around the mark: a compass sits on smooth paper, not on a wall or
  // a sheet edge (grainy wall texture, white fill, frame): std of the gray values away from any ink
  const bgSpread = (cx, cy, rad) => {
    if (!layers.gray) return 0;
    let n = 0, sum = 0, sq = 0;
    const x0 = Math.max(2, Math.round(cx - rad)), x1 = Math.min(w - 3, Math.round(cx + rad)), y0 = Math.max(2, Math.round(cy - rad)), y1 = Math.min(h - 3, Math.round(cy + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let near = 0;
      for (let o = -2; o <= 2; o += 2) for (let q = -2; q <= 2; q += 2) near += ink[(y + q) * w + x + o];
      if (near) continue;
      const g = layers.gray[y * w + x];
      n++; sum += g; sq += g * g;
    }
    return n > 20 ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
  };
  // ink in the compass' neighbourhood that is neither ring, needle nor N: a compass sits in clear space
  const clutter = (cx, cy, r, ax, nb) => {
    const ux = Math.sin(ax.phi * RAD), uy = -Math.cos(ax.phi * RAD), half = Math.max(4, r * 0.7);
    const reachR = Math.max(ax.R0, ax.R1, r * 2) + r;
    const nx = nb ? cx + Math.sin(nb.th * RAD) * nb.t : 0, ny = nb ? cy - Math.cos(nb.th * RAD) * nb.t : 0;
    let ink = 0, area = 0;
    const x0 = Math.floor(cx - reachR), x1 = Math.ceil(cx + reachR), y0 = Math.floor(cy - reachR), y1 = Math.ceil(cy + reachR);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > reachR || x < 0 || y < 0 || x >= w || y >= h) continue;
      if (d <= r + 2.5) continue; // ring and what is inside it
      const t = dx * ux + dy * uy, lat = Math.abs(-dx * uy + dy * ux);
      if (lat <= half && t >= -ax.R1 - 1 && t <= ax.R0 + 1) continue; // needle band
      if (nb && Math.hypot(x - nx, y - ny) <= nb.gh * 0.9) continue; // the N
      if (!px(x, y)) { area++; continue; }
      // solid dark areas (caption bar, symbols) are not clutter
      let near = 0;
      for (let o = -2; o <= 2; o += 2) for (let q = -2; q <= 2; q += 2) near += px(x + o, y + q);
      if (near >= 8) continue;
      area++; ink++;
    }
    return area ? ink / area : 1;
  };
  // corner = 1; the outer fifth of the sheet on any side = 0.6 (compasses sit in the margins)
  const placement = (x, y) => {
    const cornerX = x < 0.3 * w || x > 0.7 * w, cornerY = y < 0.25 * h || y > 0.75 * h;
    const band = x < 0.2 * w || x > 0.8 * w || y < 0.2 * h || y > 0.8 * h;
    return cornerX && cornerY ? 1 : band ? 0.6 : 0;
  };

  // ---- ranking ---------------------------------------------------------------------------
  const results = [];
  const NOAX = { phi: 0, len: 0, R0: 0, R1: 0 };
  // snap the ring (centre +-2 px, radius +-1) to its roundest fit
  const snap = (c0) => {
    const c = { ...c0 };
    let bestS = -1;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dr = -1; dr <= 1; dr++) {
      if (c0.r + dr < rMin) continue;
      const v = ringCover(c0.x + dx, c0.y + dy, c0.r + dr) - 0.02 * (Math.abs(dx) + Math.abs(dy) + Math.abs(dr));
      if (v > bestS) { bestS = v; c.x = c0.x + dx; c.y = c0.y + dy; c.r = c0.r + dr; }
    }
    return c;
  };
  const balanced = (a) => !a.len || Math.min(a.R0, a.R1) >= 0.4 * Math.max(a.R0, a.R1);
  // cheap first pass (round ring + a needle through it), then the full cue set for the most compass-like few
  const snapped = centres.map((c0) => {
    const c = snap(c0);
    c.ring = c0.ring;
    c.axes = axesOf(c.x, c.y, c.r).filter(balanced);
    const a = c.axes[0] || NOAX;
    const as = clamp((a.len - 2.8 * c.r) / (3 * c.r), 0, 1), prop = a.len / c.r >= 7.5 && a.len / c.r <= 12 ? 1 : 0;
    c.pre = (0.45 * ringCover(c.x, c.y, c.r) + 0.2 * (c0.ring || ringLoose(c.x, c.y, c.r)) + 0.25 * as + 0.1 * prop) * (0.3 + 0.7 * isolation(c.x, c.y, c.r, as >= 0.25 ? [a.phi, a.phi + 180] : []));
    return c;
  }).sort((a, b) => b.pre - a.pre);
  // one candidate = ring (cx, cy, r) + one needle axis: cues -> accept / reject -> score
  const evaluate = (c, cx, cy, ax) => {
    const axisScore = clamp((ax.len - 2.8 * c.r) / (3 * c.r), 0, 1);
    const ringL = c.ring || ringLoose(cx, cy, c.r), ringS = ringCover(cx, cy, c.r), ring = ringL;
    if (axisScore < 0.5 && ringS < 0.7) return; // no needle and no round ring: nothing to accept below
    const tilts = axisScore >= 0.25 ? [ax.phi, wrap(ax.phi + 180)] : Array.from({ length: 36 }, (_, i) => i * 10);
    let bestN = null, otherS = 0;
    for (const th of tilts) {
      const rl = Math.max(reach(cx, cy, th, c.r * 9), reach(cx, cy, th - 1.5, c.r * 9), reach(cx, cy, th + 1.5, c.r * 9));
      const n = nSearch(cx, cy, c.r, th, rl);
      n.asym = axisScore >= 0.25 ? armFill(cx, cy, th, c.r) - armFill(cx, cy, th + 180, c.r) : 0;
      n.pick = clamp(n.s, 0, 1) + (n.s >= 0.5 ? 1 : 0) + (n.s >= 0.5 ? 0.2 : 0.9) * n.asym; // a letter-shaped N outweighs arm shape
      if (!bestN || n.pick > bestN.pick) { if (bestN) otherS = bestN.s; bestN = n; } else otherS = Math.max(otherS, n.s);
    }
    const nOk = bestN.s >= 0.5, nBlob = bestN.s >= 0.45;
    let nOk2 = nOk;
    if (nOk && opts.ocrN) {
      const gx = cx + Math.sin(bestN.th * RAD) * bestN.t, gy = cy - Math.cos(bestN.th * RAD) * bestN.t;
      nOk2 = opts.ocrN({ x: gx - bestN.gh, y: gy - bestN.gh, w: bestN.gh * 2, h: bestN.gh * 2 }) !== false;
    }
    const iso = isolation(cx, cy, c.r, nBlob ? [bestN.th] : axisScore >= 0.25 ? [ax.phi, ax.phi + 180] : []);
    const place = placement(cx, cy);
    const clut = clutter(cx, cy, c.r, ax, nBlob ? bestN : null), dark = darkness(cx, cy, Math.max(ax.R0, ax.R1, 2 * c.r));
    if (opts.debug) opts.debug.push({ ringS: +ringS.toFixed(2), clut: +clut.toFixed(3), pre: +c.pre.toFixed(2), x: cx, y: cy, r: c.r, ring: +ring.toFixed(2), axis: +axisScore.toFixed(2), len: ax.len, phi: Math.round(ax.phi), n: +bestN.s.toFixed(2), nth: Math.round(bestN.th), asym: +bestN.asym.toFixed(2), other: +otherS.toFixed(2), iso: +iso.toFixed(2), dark: +dark.toFixed(2), place });
    let deg, via;
    // the needle axis is the precise direction; the N / the filled arm says which end
    const axisDeg = angDiff(bestN.th, ax.phi) < 45 ? ax.phi : wrap(ax.phi + 180);
    if (nOk2 && ((ringL >= 0.5 && axisScore >= 0.5) || ringS >= 0.7 || (axisScore >= 0.5 && place >= 0.5 && clut <= 0.06))) {
      deg = axisScore >= 0.35 ? axisDeg : bestN.th; via = axisScore >= 0.5 ? (ringL >= 0.5 ? 'ring+needle+n' : 'needle+n') : 'ring+n';
    } else if (nBlob && axisScore >= 0.5 && ring >= 0.55 && (bestN.asym >= 0.25 || otherS < 0.4) && place >= 0.5) {
      deg = axisDeg; via = 'ring+needle+n';
    } else if (axisScore >= 0.7 && ringL >= 0.7 && place >= 0.5 && iso >= 0.7) {
      deg = axisDeg; via = 'ring+needle'; // a clean ring + needle in a corner whose N is cut off or unreadable
    } else return;
    // the needle runs through the ring: both halves are there, not a ring at the end of a stroke
    if (ax.len && Math.min(ax.R0, ax.R1) < 0.4 * Math.max(ax.R0, ax.R1)) return;
    if (iso < 0.6 || clut > 0.1) return;
    if (bgSpread(cx, cy, Math.max(12, c.r * 2.2)) > 14) return;
    // needle ~9 ring radii end to end (a shorter one only on a ring as big as the lettering: no letter holes)
    if (ax.len && ax.len < (c.r >= 0.9 * textH ? 4.8 : 7) * c.r) return;
    if (place === 0 && !(nOk2 && ringS >= 0.7 && clut <= 0.04)) return; // away from the margins only when unmistakable
    // a compass needle is about 9 ring radii long (both halves); the ring itself must be round
    const prop = ax.len / c.r >= 7.5 && ax.len / c.r <= 12 ? 1 : 0;
    const score = 0.4 * ringS + 0.15 * ringL + 0.1 * axisScore + 0.12 * clamp(bestN.s, 0, 1) + 0.08 * Math.max(0, bestN.asym) + 0.1 * place + 0.1 * iso + 0.08 * prop + 0.05 * dark
      + (nOk2 ? 0.1 : nBlob ? 0.04 : 0) - 1.2 * clut;
    results.push({ score, c: { x: cx, y: cy, deg, r: c.r, via }, ax, refine: axisScore >= 0.35 });
  };
  for (const c of snapped.slice(0, 24)) for (const ax of c.axes.length ? c.axes : [NOAX]) evaluate(c, c.x, c.y, ax);
  if (opts.debug) opts.debug.results = results.map((r) => ({ score: +r.score.toFixed(2), ...r.c }));
  if (!results.length) return null;
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (best.refine) best.c.deg = refineAxis(best.c.x, best.c.y, best.c.deg, best.ax, best.c.r);
  best.c.deg = Math.round(best.c.deg) % 360;
  return best.c;
}
