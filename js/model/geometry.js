// geometry.js
// Pure geometry helpers for the floorplan model: polygons, distances,
// segment intersection, snapping (magnet + equal spacing). No DOM/window.
// Depends on: nothing (pure ES module).

export function polygonCentroid(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0 };
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area = area / 2;
  if (Math.abs(area) < 1e-9) {
    const b = bbox(pts);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return { x: cx, y: cy };
}

export function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

export function pointInPolygon(pt, pts) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function bbox(pts) {
  if (!pts || pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectToPoints({ x, y, w, h }) {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function dist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function nearestPointOnSegment(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + dx * t, y: ay + dy * t, t };
}

export function edgesOf(pts) {
  const edges = [];
  if (!pts || pts.length < 2) return edges;
  for (let i = 0; i < pts.length; i++) {
    edges.push([pts[i], pts[(i + 1) % pts.length]]);
  }
  return edges;
}

export function nearestPointOnPolyline(p, pts, closed = true) {
  if (!pts || pts.length === 0) return null;
  if (pts.length === 1) {
    return { x: pts[0][0], y: pts[0][1], segIndex: 0, dist: dist(p, pts[0]) };
  }
  let best = null;
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const np = nearestPointOnSegment(p, a, b);
    const d = dist(p, [np.x, np.y]);
    if (!best || d < best.dist) {
      best = { x: np.x, y: np.y, segIndex: i, dist: d };
    }
  }
  return best;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, c) {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  // Shared endpoints or collinear touching = false (proper intersection only)
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;

  if (o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0) return true;
  return false;
}

export function polygonsOverlap(a, b) {
  const edgesA = edgesOf(a);
  const edgesB = edgesOf(b);
  for (const [a1, a2] of edgesA) {
    for (const [b1, b2] of edgesB) {
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  const ca = polygonCentroid(a);
  const cb = polygonCentroid(b);
  if (pointInPolygon([ca.x, ca.y], b)) return true;
  if (pointInPolygon([cb.x, cb.y], a)) return true;
  return false;
}

export function isOnOutline(seg, outline, tol = 2) {
  if (!outline || outline.length < 2) return false;
  const p1 = [seg.x1, seg.y1];
  const p2 = [seg.x2, seg.y2];
  const edges = edgesOf(outline);
  const near = (p) => {
    for (const [a, b] of edges) {
      const np = nearestPointOnSegment(p, a, b);
      if (dist(p, [np.x, np.y]) <= tol) return true;
    }
    return false;
  };
  return near(p1) && near(p2);
}

export function insideNormal(outline, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // Two perpendicular candidates
  const n1 = [-dy / len, dx / len];
  const n2 = [dy / len, -dx / len];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const test = [mid[0] + n1[0] * 1e-3, mid[1] + n1[1] * 1e-3];
  if (pointInPolygon(test, outline)) return n1;
  return n2;
}

export function snapToGrid(v, g) {
  if (!g) return v;
  return Math.round(v / g) * g;
}

export function magnetSnap(point, targets, tol = 6) {
  const { xs = [], ys = [], vertices = [], grid = null } = targets || {};
  const guides = [];

  let snappedX = point.x;
  let snappedY = point.y;

  // Determine best vertex candidate (within tol on both axes preferred)
  let vertexBoth = null;
  let bestBothDist = Infinity;
  for (const v of vertices) {
    const dx = Math.abs(v[0] - point.x);
    const dy = Math.abs(v[1] - point.y);
    if (dx <= tol && dy <= tol) {
      const d = dx + dy;
      if (d < bestBothDist) {
        bestBothDist = d;
        vertexBoth = v;
      }
    }
  }

  if (vertexBoth) {
    snappedX = vertexBoth[0];
    snappedY = vertexBoth[1];
    guides.push({ axis: 'x', at: snappedX });
    guides.push({ axis: 'y', at: snappedY });
    return { x: snappedX, y: snappedY, guides };
  }

  // X axis: vertex-x beats edge-x (xs) beats grid
  let bestVX = null, bestVXDist = Infinity;
  for (const v of vertices) {
    const dx = Math.abs(v[0] - point.x);
    if (dx <= tol && dx < bestVXDist) {
      bestVXDist = dx;
      bestVX = v[0];
    }
  }
  let bestEX = null, bestEXDist = Infinity;
  for (const x of xs) {
    const dx = Math.abs(x - point.x);
    if (dx <= tol && dx < bestEXDist) {
      bestEXDist = dx;
      bestEX = x;
    }
  }
  if (bestVX !== null) {
    snappedX = bestVX;
    guides.push({ axis: 'x', at: snappedX });
  } else if (bestEX !== null) {
    snappedX = bestEX;
    guides.push({ axis: 'x', at: snappedX });
  } else if (grid) {
    snappedX = snapToGrid(point.x, grid);
    if (snappedX !== point.x) guides.push({ axis: 'x', at: snappedX });
  }

  // Y axis: vertex-y beats edge-y (ys) beats grid
  let bestVY = null, bestVYDist = Infinity;
  for (const v of vertices) {
    const dy = Math.abs(v[1] - point.y);
    if (dy <= tol && dy < bestVYDist) {
      bestVYDist = dy;
      bestVY = v[1];
    }
  }
  let bestEY = null, bestEYDist = Infinity;
  for (const y of ys) {
    const dy = Math.abs(y - point.y);
    if (dy <= tol && dy < bestEYDist) {
      bestEYDist = dy;
      bestEY = y;
    }
  }
  if (bestVY !== null) {
    snappedY = bestVY;
    guides.push({ axis: 'y', at: snappedY });
  } else if (bestEY !== null) {
    snappedY = bestEY;
    guides.push({ axis: 'y', at: snappedY });
  } else if (grid) {
    snappedY = snapToGrid(point.y, grid);
    if (snappedY !== point.y) guides.push({ axis: 'y', at: snappedY });
  }

  return { x: snappedX, y: snappedY, guides };
}

export function equalSpacingCandidates(movingBox, boxes) {
  const xs = [];
  const ys = [];
  const sortedX = [...boxes].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sortedX.length - 1; i++) {
    const A = sortedX[i];
    const B = sortedX[i + 1];
    const g = B.x - (A.x + A.w);
    if (g < 0) continue;
    // moving box sits at gap g to the right of B
    xs.push(B.x + B.w + g);
    // moving box sits at gap g to the left of A
    xs.push(A.x - g - movingBox.w);
  }
  const sortedY = [...boxes].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sortedY.length - 1; i++) {
    const A = sortedY[i];
    const B = sortedY[i + 1];
    const g = B.y - (A.y + A.h);
    if (g < 0) continue;
    ys.push(B.y + B.h + g);
    ys.push(A.y - g - movingBox.h);
  }
  return { xs, ys };
}
