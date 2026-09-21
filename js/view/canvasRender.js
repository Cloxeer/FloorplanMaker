// canvasRender.js
// Attribute/element builders used by canvas.js to keep it under the line
// budget: room/door/stair/compass/floor node creation+update, and selection
// handle drawing. Depends on: js/model/document.js (labelPos, labelClass,
// labelText, roomPolygon, stairTreads), js/model/geometry.js (bbox).

import { labelPos, labelClass, labelText, roomPolygon, stairTreads } from '../model/document.js';
import { bbox } from '../model/geometry.js';

const XLINK = 'http://www.w3.org/1999/xlink';

function setShapeAttrs(shapeNode, item) {
  if (item.shape === 'poly') {
    shapeNode.setAttribute('points', item.points.map((p) => p.join(',')).join(' '));
  } else {
    shapeNode.setAttribute('x', item.x);
    shapeNode.setAttribute('y', item.y);
    shapeNode.setAttribute('width', item.w);
    shapeNode.setAttribute('height', item.h);
  }
}

export function renderRoom(item, roomsLayer, labelsLayer, el, rec) {
  const isVoid = item.cls === 'void';
  const tag = item.shape === 'poly' ? 'polygon' : 'rect';
  if (!rec) {
    const shapeNode = el(tag, { class: item.cls, 'data-id': item.id, 'data-part': 'body' });
    setShapeAttrs(shapeNode, item);
    roomsLayer.appendChild(shapeNode);

    let label = null;
    let name = null;
    if (!isVoid) {
      const p = labelPos(item);
      label = el('text', {
        class: labelClass(item), x: p.x, y: p.y,
        'data-id': item.id, 'data-part': 'label',
      });
      label.textContent = labelText(item);
      if (item.label && item.label.fontSize) label.setAttribute('font-size', `${item.label.fontSize}px`);
      labelsLayer.appendChild(label);

      if (item.showName && item.name) {
        name = el('text', {
          class: 'name', x: p.x, y: p.y - 30,
          'data-id': item.id, 'data-part': 'label',
        });
        name.textContent = item.name;
        labelsLayer.appendChild(name);
      }
    }
    return { root: shapeNode, label, name, kind: 'room' };
  }

  // update existing
  const wasTag = rec.root.tagName.toLowerCase();
  if (wasTag !== tag) {
    // shape type changed (rect<->poly): rebuild shape node in place
    const newShape = el(tag, { class: item.cls, 'data-id': item.id, 'data-part': 'body' });
    setShapeAttrs(newShape, item);
    rec.root.parentNode.replaceChild(newShape, rec.root);
    rec.root = newShape;
  } else {
    rec.root.setAttribute('class', item.cls);
    setShapeAttrs(rec.root, item);
  }

  if (isVoid) {
    if (rec.label && rec.label.parentNode) rec.label.parentNode.removeChild(rec.label);
    if (rec.name && rec.name.parentNode) rec.name.parentNode.removeChild(rec.name);
    rec.label = null;
    rec.name = null;
  } else {
    const p = labelPos(item);
    if (!rec.label) {
      rec.label = el('text', { class: labelClass(item), x: p.x, y: p.y, 'data-id': item.id, 'data-part': 'label' });
      labelsLayer.appendChild(rec.label);
    } else {
      rec.label.setAttribute('class', labelClass(item));
      rec.label.setAttribute('x', p.x);
      rec.label.setAttribute('y', p.y);
    }
    rec.label.textContent = labelText(item);
    if (item.label && item.label.fontSize) {
      rec.label.setAttribute('font-size', `${item.label.fontSize}px`);
    } else {
      rec.label.removeAttribute('font-size');
    }

    if (item.showName && item.name) {
      if (!rec.name) {
        rec.name = el('text', { class: 'name', x: p.x, y: p.y - 30, 'data-id': item.id, 'data-part': 'label' });
        labelsLayer.appendChild(rec.name);
      } else {
        rec.name.setAttribute('x', p.x);
        rec.name.setAttribute('y', p.y - 30);
      }
      rec.name.textContent = item.name;
    } else if (rec.name) {
      if (rec.name.parentNode) rec.name.parentNode.removeChild(rec.name);
      rec.name = null;
    }
  }
  return rec;
}

export function renderDoor(item, doorsLayer, el, rec) {
  if (!rec) {
    const line = el('line', {
      class: 'door', x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2,
      'data-id': item.id, 'data-part': 'body',
    });
    doorsLayer.appendChild(line);
    const label = el('text', {
      class: 'exit', x: item.label.x, y: item.label.y,
      'data-id': item.id, 'data-part': 'label',
    });
    if (item.kind === 'Door') label.setAttribute('fill', '#5f6368');
    label.textContent = item.kind === 'Door' ? 'Door' : 'EXIT';
    doorsLayer.appendChild(label);
    return { root: line, label, kind: 'door' };
  }
  rec.root.setAttribute('x1', item.x1);
  rec.root.setAttribute('y1', item.y1);
  rec.root.setAttribute('x2', item.x2);
  rec.root.setAttribute('y2', item.y2);
  rec.label.setAttribute('x', item.label.x);
  rec.label.setAttribute('y', item.label.y);
  rec.label.textContent = item.kind === 'Door' ? 'Door' : 'EXIT';
  if (item.kind === 'Door') rec.label.setAttribute('fill', '#5f6368');
  else rec.label.removeAttribute('fill');
  return rec;
}

export function renderStair(item, stairsLayer, el, rec) {
  const treads = stairTreads(item);
  if (!rec) {
    const g = el('g', { class: 'stair', 'data-id': item.id, 'data-part': 'body' });
    for (const t of treads) {
      g.appendChild(el('line', { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }));
    }
    stairsLayer.appendChild(g);
    return { root: g, kind: 'stair' };
  }
  while (rec.root.firstChild) rec.root.removeChild(rec.root.firstChild);
  for (const t of treads) {
    rec.root.appendChild(el('line', { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 }));
  }
  return rec;
}

export function renderCompass(item, floorLayer, el, rec) {
  if (!rec) {
    const g = el('g', {
      class: 'compass', transform: `translate(${item.x},${item.y}) rotate(${item.deg})`,
      'data-id': item.id, 'data-part': 'body',
    });
    g.appendChild(el('circle', { r: 26, fill: 'none', stroke: '#8a8690', 'stroke-width': 2 }));
    g.appendChild(el('polygon', { class: 'compass-north', points: '0,-24 7,0 -7,0' }));
    g.appendChild(el('polygon', { points: '0,24 7,0 -7,0', fill: '#8a8690' }));
    const t = el('text', { class: 'compass-letter', y: -32 });
    t.textContent = 'N';
    g.appendChild(t);
    floorLayer.appendChild(g);
    return { root: g, kind: 'compass' };
  }
  rec.root.setAttribute('transform', `translate(${item.x},${item.y}) rotate(${item.deg})`);
  return rec;
}

export function renderFloor(floor, floorLayer, el) {
  const poly = el('polygon', {
    class: 'floor', points: floor.points.map((p) => p.join(',')).join(' '),
    'data-id': 'floor', 'data-part': 'body',
  });
  floorLayer.insertBefore(poly, floorLayer.firstChild);
  return { poly };
}

// ---- selection handles ----

const HANDLE_ORDER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function handlePoints(x, y, w, h) {
  return {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y],
    e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h],
    sw: [x, y + h], w: [x, y + h / 2],
  };
}

export function updateSelectionHandles(doc, ids, selectionLayer, el, view, svgEl) {
  const scale = view && view.w ? (svgEl.clientWidth || 1) / view.w : 1;
  const handleSize = scale > 0 ? 10 / scale : 10;

  for (const id of ids) {
    if (id === 'floor') {
      if (!doc.floor) continue;
      doc.floor.points.forEach((p, i) => {
        selectionLayer.appendChild(el('circle', {
          cx: p[0], cy: p[1], r: Math.max(3, handleSize / 2.5),
          class: 'floor-vertex-handle', 'data-id': 'floor', 'data-part': `floor-vertex:${i}`,
        }));
      });
      const pts = doc.floor.points.map((p) => p.join(',')).join(' ');
      selectionLayer.appendChild(el('polygon', {
        points: pts, class: 'selection-outline', fill: 'none',
      }));
      continue;
    }
    const item = doc.items.find((it) => it.id === id);
    if (!item) continue;
    const pts = roomPolygonSafe(item);
    const b = bbox(pts);
    const outline = el(item.shape === 'poly' ? 'polygon' : 'rect', {
      class: 'selection-outline', fill: 'none', 'stroke-dasharray': '4 3',
    });
    if (item.shape === 'poly') {
      outline.setAttribute('points', item.points.map((p) => p.join(',')).join(' '));
    } else {
      outline.setAttribute('x', item.x);
      outline.setAttribute('y', item.y);
      outline.setAttribute('width', item.w);
      outline.setAttribute('height', item.h);
    }
    selectionLayer.appendChild(outline);

    if (ids.length === 1 && item.shape === 'poly') {
      item.points.forEach((p, i) => {
        selectionLayer.appendChild(el('circle', {
          cx: p[0], cy: p[1], r: Math.max(3, handleSize / 2.5),
          class: 'resize-handle', 'data-id': id, 'data-part': `vertex:${i}`,
        }));
      });
    }

    if (ids.length === 1 && item.shape === 'rect') {
      const hp = handlePoints(item.x, item.y, item.w, item.h);
      for (const key of HANDLE_ORDER) {
        const [hx, hy] = hp[key];
        selectionLayer.appendChild(el('rect', {
          x: hx - handleSize / 2, y: hy - handleSize / 2,
          width: handleSize, height: handleSize,
          class: 'resize-handle', 'data-id': id, 'data-part': `handle:${key}`,
        }));
      }
      const repeatX = item.x + item.w + handleSize * 1.5;
      const repeatY = item.y + item.h / 2;
      selectionLayer.appendChild(el('circle', {
        cx: repeatX, cy: repeatY, r: Math.max(4, handleSize / 2),
        class: 'repeat-handle', 'data-id': id, 'data-part': 'repeat',
      }));
    }
  }
}

function roomPolygonSafe(item) {
  if (item.shape === 'poly') return item.points;
  return [[item.x, item.y], [item.x + item.w, item.y], [item.x + item.w, item.y + item.h], [item.x, item.y + item.h]];
}

// ---- overlay builders (guides, ghosts, route, photo, grid) ----

export function clearGroup(g) {
  while (g.firstChild) g.removeChild(g.firstChild);
}

export function renderGuides(guides, guidesLayer, el, view) {
  clearGroup(guidesLayer);
  if (!guides) return;
  for (const g of guides) {
    if (g.axis === 'x') {
      guidesLayer.appendChild(el('line', {
        x1: g.at, y1: view.y - 10000, x2: g.at, y2: view.y + 10000, class: 'guide',
      }));
    } else {
      guidesLayer.appendChild(el('line', {
        x1: view.x - 10000, y1: g.at, x2: view.x + 10000, y2: g.at, class: 'guide',
      }));
    }
  }
}

export function renderGhosts(ghosts, ghostsLayer, el) {
  clearGroup(ghostsLayer);
  if (!ghosts) return;
  ghosts.forEach((g, i) => {
    const idx = g.index != null ? g.index : i;
    ghostsLayer.appendChild(el('rect', {
      x: g.x, y: g.y, width: g.w, height: g.h, class: 'ghost', 'data-part': `ghost:${idx}`,
    }));
    const txt = el('text', {
      x: g.x + g.w / 2, y: g.y + g.h / 2, class: 'ghost-label', 'data-part': `ghost:${idx}`,
    });
    txt.textContent = g.number != null ? g.number : String(idx);
    ghostsLayer.appendChild(txt);
  });
}

export function renderRoutePath(pts, routeLayer, svgEl, el) {
  clearGroup(routeLayer);
  if (!pts || pts.length < 2) return;
  let defs = svgEl.querySelector('defs');
  if (!defs) {
    defs = el('defs');
    svgEl.insertBefore(defs, svgEl.firstChild);
  }
  if (!defs.querySelector('#route-arrow')) {
    const marker = el('marker', {
      id: 'route-arrow', markerWidth: 10, markerHeight: 10,
      refX: 6, refY: 3, orient: 'auto', markerUnits: 'strokeWidth',
    });
    marker.appendChild(el('path', { d: 'M0,0 L6,3 L0,6 Z', fill: '#1a7f37' }));
    defs.appendChild(marker);
  }
  const points = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  routeLayer.appendChild(el('polyline', {
    points, class: 'route', fill: 'none', 'marker-end': 'url(#route-arrow)',
  }));
}

export function renderPhoto(photo, photoLayer, el, opacity) {
  clearGroup(photoLayer);
  if (!photo) return;
  const img = el('image', {
    href: photo.dataUrl, x: 0, y: 0, width: photo.width, height: photo.height, opacity,
  });
  img.setAttributeNS(XLINK, 'href', photo.dataUrl);
  photoLayer.appendChild(img);
}

export function ensureGridPattern(gridLayer, svgEl, el) {
  if (gridLayer.firstChild) return;
  let defs = svgEl.querySelector('defs');
  if (!defs) {
    defs = el('defs');
    svgEl.insertBefore(defs, svgEl.firstChild);
  }
  if (!defs.querySelector('#grid-pattern')) {
    const pattern = el('pattern', {
      id: 'grid-pattern', width: 20, height: 20, patternUnits: 'userSpaceOnUse',
    });
    pattern.appendChild(el('path', {
      d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: '#cfd4da', 'stroke-width': 0.5,
    }));
    defs.appendChild(pattern);
  }
  gridLayer.appendChild(el('rect', {
    x: -100000, y: -100000, width: 200000, height: 200000, fill: 'url(#grid-pattern)',
  }));
}
