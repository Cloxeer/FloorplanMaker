// rectify.js
// "Straighten lines" for the floor outline. Pure math, no DOM.
//
//   - A wall that is NEARLY straight (within 10° of level or upright) is made
//     exactly straight. A wall close to 45° (within 8°) is made exactly 45°.
//     Any other angle is a real angled wall and is left as drawn.
//   - If the nearly-straight walls all lean the same small amount (the photo
//     was taken a bit tilted), they're squared up along that lean instead of
//     the page, so the outline still matches the photo, rooms and doors. The
//     result says how much, so the UI can point at "Flatten the photo".
//   - Each wall is fixed where it was drawn (it keeps passing through its own
//     middle); corners are where neighbouring walls meet. Nothing drifts.
//   - Level/upright walls snap to the 5-unit grid (when there's no lean), and
//     corners that no longer turn are dropped.
// Depends on: nothing.

const GRID = 5;
const NEAR_STRAIGHT = 10; // degrees: this close to level/upright gets squared
const NEAR_DIAGONAL = 8; // degrees: this close to 45° becomes exactly 45°
const MIN_TILT = 1; // degrees: a smaller lean is just hand wobble
const RAD = Math.PI / 180;

// Angle of the line through a->b, in degrees, folded into [0, 180).
function lineAngle(a, b) {
  const d = Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD;
  return ((d % 180) + 180) % 180;
}
// Signed smallest difference between two line angles, in (-90, 90].
function angleDiff(a, b) {
  let d = ((a - b) % 180 + 180) % 180;
  if (d > 90) d -= 180;
  return d;
}

// The building's own lean: the length-weighted median of how far the
// nearly-straight walls sit off level/upright, if they agree; else 0.
function buildingTilt(pts) {
  const n = pts.length;
  const devs = [];
  let perimeter = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    perimeter += len;
    const ang = lineAngle(a, b);
    const dev = angleDiff(ang, Math.round(ang / 90) * 90);
    if (Math.abs(dev) <= NEAR_STRAIGHT) devs.push({ dev, len });
  }
  const total = devs.reduce((s, d) => s + d.len, 0);
  if (!total || total < perimeter * 0.6) return 0;
  devs.sort((p, q) => p.dev - q.dev);
  let acc = 0;
  let median = 0;
  for (const d of devs) { acc += d.len; if (acc >= total / 2) { median = d.dev; break; } }
  // Only a real lean if the walls agree with it (not just random wobble).
  const spread = devs.reduce((s, d) => s + d.len * Math.abs(d.dev - median), 0) / total;
  return Math.abs(median) >= MIN_TILT && spread <= 1.5 ? median : 0;
}

// Where two lines (point + angle in degrees) cross; null if parallel.
function intersect(l1, l2) {
  const d1 = [Math.cos(l1.ang * RAD), Math.sin(l1.ang * RAD)];
  const d2 = [Math.cos(l2.ang * RAD), Math.sin(l2.ang * RAD)];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((l2.p[0] - l1.p[0]) * d2[1] - (l2.p[1] - l1.p[1]) * d2[0]) / den;
  return [l1.p[0] + d1[0] * t, l1.p[1] + d1[1] * t];
}

export function straightenOutline(points) {
  if (!points || points.length < 3) {
    return { points: points ? points.map((p) => p.slice()) : points, tilt: 0 };
  }
  const pts = points.map(([x, y]) => [x, y]);
  const n = pts.length;
  const tilt = buildingTilt(pts);

  // Each wall becomes a line through its own middle, at its corrected angle.
  const lines = [];
  for (let i = 0; i < n; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ang = lineAngle(a, b);
    const rel = angleDiff(ang, tilt); // angle measured from the building's own "level"
    const toStraight = angleDiff(rel, Math.round(rel / 90) * 90);
    const toDiagonal = angleDiff(rel, Math.round((rel - 45) / 90) * 90 + 45);
    let target = ang; // a real angled wall: keep it
    let kind = 'kept';
    if (Math.abs(toStraight) <= NEAR_STRAIGHT) { target = ang - toStraight; kind = 'straight'; }
    else if (Math.abs(toDiagonal) <= NEAR_DIAGONAL) { target = ang - toDiagonal; kind = 'diagonal'; }
    target = ((target % 180) + 180) % 180;
    // Level/upright walls (no lean) sit on the 5-unit grid.
    if (kind === 'straight' && tilt === 0) {
      if (Math.round(target) % 180 === 0) mid[1] = Math.round(mid[1] / GRID) * GRID;
      else mid[0] = Math.round(mid[0] / GRID) * GRID;
    }
    lines.push({ p: mid, ang: target, kind });
  }

  // Corner i is where wall i-1 meets wall i.
  const corners = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const hit = intersect(prev, cur);
    if (hit) { corners.push(hit); continue; }
    // Parallel neighbours: on the same line the corner simply goes away;
    // otherwise (a rare offset) keep the drawn corner.
    const off = Math.abs((cur.p[0] - prev.p[0]) * Math.sin(prev.ang * RAD) - (cur.p[1] - prev.p[1]) * Math.cos(prev.ang * RAD));
    if (off > 3) corners.push(pts[i].slice());
  }

  // Tidy up: whole units, no repeated points, no corners that don't turn.
  let out = corners.map(([x, y]) => [Math.round(x), Math.round(y)]);
  out = out.filter((p, i) => { const q = out[(i + 1) % out.length]; return !(q && q !== p && q[0] === p[0] && q[1] === p[1]); });
  for (let i = out.length - 1; i >= 0 && out.length > 3; i -= 1) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    if (Math.abs(cross) / scale < 0.01) out.splice(i, 1);
  }
  if (out.length < 3) return { points: pts.map((p) => p.slice()), tilt: 0 };
  return { points: out, tilt };
}

export function rectifyOutline(points) {
  return straightenOutline(points).points;
}
