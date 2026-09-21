// floor.js
// Floor tool: click outline corners to draw the floor polygon; Enter or
// double-click closes it. If a floor already exists, dragging a vertex edits
// it and clicking an edge inserts a new vertex. Depends on:
// js/model/document.js (setFloor), js/model/geometry.js (nearestPointOnSegment,
// dist, edgesOf via nearestPointOnPolyline).
// eslint-disable-next-line
import { setFloor } from '../../model/document.js';
import { nearestPointOnPolyline, dist } from '../../model/geometry.js';

const VERTEX_TOL = 10;
const EDGE_TOL = 8;

export function createFloorTool(app) {
  let drawPts = null; // while creating a new floor
  let vertexDrag = null; // { index, startPts }

  function hasFloor() {
    return !!(app.doc.floor && app.doc.floor.points && app.doc.floor.points.length >= 3);
  }

  // --- pointer ghost: a dot at the snapped point + a rubber-band line from
  // the last placed corner, drawn straight into the guides layer. ---
  function guidesLayer() {
    const svg = document.getElementById('canvas');
    return svg && svg.querySelector('.layer-guides');
  }
  function clearGhost() {
    const layer = guidesLayer();
    if (!layer) return;
    const dot = layer.querySelector('.floor-ghost-dot');
    const line = layer.querySelector('.floor-ghost-line');
    if (dot) dot.remove();
    if (line) line.remove();
  }
  function drawGhost(x, y) {
    const layer = guidesLayer();
    if (!layer) return;
    let dot = layer.querySelector('.floor-ghost-dot');
    if (!dot) {
      dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('class', 'floor-ghost-dot');
      dot.setAttribute('r', '4');
      layer.appendChild(dot);
    }
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    if (drawPts && drawPts.length) {
      const last = drawPts[drawPts.length - 1];
      let line = layer.querySelector('.floor-ghost-line');
      if (!line) {
        line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'floor-ghost-line');
        layer.appendChild(line);
      }
      line.setAttribute('x1', last[0]);
      line.setAttribute('y1', last[1]);
      line.setAttribute('x2', x);
      line.setAttribute('y2', y);
    } else {
      const line = layer.querySelector('.floor-ghost-line');
      if (line) line.remove();
    }
  }

  function onDown(e, pt) {
    if (hasFloor()) {
      const pts = app.doc.floor.points;
      // check vertex hit
      for (let i = 0; i < pts.length; i++) {
        if (dist([pt.x, pt.y], pts[i]) <= VERTEX_TOL) {
          vertexDrag = { index: i, startPts: pts.map((p) => [...p]) };
          return;
        }
      }
      // check edge hit -> insert vertex
      const near = nearestPointOnPolyline([pt.x, pt.y], pts, true);
      if (near && near.dist <= EDGE_TOL) {
        const newPts = pts.map((p) => [...p]);
        newPts.splice(near.segIndex + 1, 0, [Math.round(near.x), Math.round(near.y)]);
        const doc = setFloor(app.doc, newPts);
        app.commit(doc, 'Insert floor vertex');
      }
      return;
    }

    const snapped = app.snap(pt, {});
    if (!drawPts) {
      drawPts = [[Math.round(snapped.x), Math.round(snapped.y)]];
    } else {
      const first = drawPts[0];
      if (Math.hypot(snapped.x - first[0], snapped.y - first[1]) <= VERTEX_TOL && drawPts.length >= 3) {
        finish();
        return;
      }
      drawPts.push([Math.round(snapped.x), Math.round(snapped.y)]);
    }
  }

  function onMove(e, pt) {
    if (vertexDrag) {
      const pts = vertexDrag.startPts.map((p) => [...p]);
      pts[vertexDrag.index] = [Math.round(pt.x), Math.round(pt.y)];
      vertexDrag.lastPts = pts;
      const node = document.querySelector('[data-id="floor"]');
      if (node) node.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      return;
    }
    if (!hasFloor()) {
      const snapped = app.snap(pt, {});
      drawGhost(snapped.x, snapped.y);
    }
  }

  function onUp() {
    if (vertexDrag && vertexDrag.lastPts) {
      const doc = setFloor(app.doc, vertexDrag.lastPts);
      app.commit(doc, 'Edit floor');
    }
    vertexDrag = null;
  }

  function finish() {
    if (!drawPts || drawPts.length < 3) return;
    const doc = setFloor(app.doc, drawPts);
    drawPts = null;
    clearGhost();
    app.commit(doc, 'Set floor');
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      drawPts = null;
      vertexDrag = null;
      clearGhost();
      return true;
    }
    if (e.key === 'Enter' && drawPts) {
      finish();
      return true;
    }
    return false;
  }

  function onDoubleClick() {
    if (drawPts) finish();
  }

  function cancel() {
    drawPts = null;
    vertexDrag = null;
    clearGhost();
  }

  return {
    name: 'floor',
    hint: hasFloor()
      ? 'Drag a vertex to edit the outline; click an edge to add a point.'
      : 'Click each corner of the building. Press Enter or click the first corner to finish.',
    onDown,
    onMove,
    onUp,
    onKey,
    onDoubleClick,
    cancel,
  };
}
