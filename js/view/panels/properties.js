// properties.js
// Right-panel property editor for the current selection: fields for a single
// room/door/stair/compass/floor, plus alignment tools for multi-selection.
// Depends on: js/model/document.js (getItem, updateItem, roomPolygon, STD).

import { getItem, updateItem, STD } from '../../model/document.js';
import { rectToPoints, bbox, dist } from '../../model/geometry.js';

const CLASS_OPTIONS = ['room', 'big', 'ours', 'core', 'void'];

function selectedItems(app) {
  const ids = [...app.selection];
  return ids.map((id) => getItem(app.doc, id)).filter(Boolean);
}

function bboxOf(item) {
  if (item.shape === 'poly') {
    const xs = item.points.map((p) => p[0]);
    const ys = item.points.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function mountProperties(el, app) {
  function render() {
    const items = selectedItems(app);
    if (items.length === 0) {
      el.innerHTML = '<p class="section-title">Nothing selected</p><p style="color:var(--muted)">Pick a tool or click an item to edit its properties.</p>';
      return;
    }
    if (items.length === 1) {
      renderSingle(items[0]);
      return;
    }
    renderMulti(items);
  }

  function renderSingle(item) {
    if (item.type === 'room') return renderRoom(item);
    if (item.type === 'door') return renderDoor(item);
    if (item.type === 'stair') return renderStair(item);
    if (item.type === 'compass') return renderCompass(item);
    if (item.floor !== undefined || item.points) return renderFloorMaybe(item);
    el.innerHTML = '<p>Unsupported selection.</p>';
  }

  function renderFloorMaybe() {
    // floor selection is represented specially by main.js via app.selection
    // containing '__floor__'; handled below in renderFloor().
  }

  function commitField(id, patch, label) {
    app.commit(updateItem(app.doc, id, patch), label);
  }

  function renderRoom(item) {
    const b = bboxOf(item);
    el.innerHTML = `
      <div class="section-title">Room</div>
      <div class="form-row">
        <label for="p-number">Number</label>
        <input type="text" id="p-number" value="${escapeAttr(item.number || '')}">
      </div>
      <div class="form-row">
        <label for="p-name">Name</label>
        <input type="text" id="p-name" value="${escapeAttr(item.name || '')}">
      </div>
      <div class="form-row">
        <label>Class</label>
        <div class="radio-row" id="p-class">
          ${CLASS_OPTIONS.map((c, i) => `<label><input type="radio" name="p-class" value="${c}" ${item.cls === c ? 'checked' : ''}>${i + 1} ${c}</label>`).join('')}
        </div>
      </div>
      <div class="form-row-inline">
        <label><input type="checkbox" id="p-showname" ${item.showName ? 'checked' : ''}> Show name</label>
      </div>
      <div class="form-row">
        <label for="p-fontsize">Font size</label>
        <select id="p-fontsize">
          <option value="" ${!item.label.fontSize ? 'selected' : ''}>Auto</option>
          <option value="24" ${item.label.fontSize === 24 ? 'selected' : ''}>24</option>
          <option value="19" ${item.label.fontSize === 19 ? 'selected' : ''}>19</option>
          <option value="custom">Custom…</option>
        </select>
        <input type="number" id="p-fontsize-custom" style="margin-top:4px" placeholder="px" value="${item.label.fontSize && ![24, 19].includes(item.label.fontSize) ? item.label.fontSize : ''}">
      </div>
      <div class="pin-row">
        ${item.label.pinned ? '<span class="pinned" title="Label pinned">&#128204;</span>' : ''}
        <button type="button" id="p-recenter" ${item.label.pinned ? '' : 'disabled'}>Re-center label</button>
      </div>
      ${item.section !== undefined ? sectionSelect(item) : ''}
      <div class="form-grid2">
        <div class="form-row"><label>X</label><input type="number" id="p-x" value="${b.x}" ${item.shape === 'poly' ? 'disabled' : ''}></div>
        <div class="form-row"><label>Y</label><input type="number" id="p-y" value="${b.y}" ${item.shape === 'poly' ? 'disabled' : ''}></div>
        <div class="form-row"><label>W</label><input type="number" id="p-w" value="${b.w}" ${item.shape === 'poly' ? 'disabled' : ''}></div>
        <div class="form-row"><label>H</label><input type="number" id="p-h" value="${b.h}" ${item.shape === 'poly' ? 'disabled' : ''}></div>
      </div>
      <div class="form-row-inline">
        ${item.shape === 'poly'
          ? '<button type="button" id="p-add-corner">Add corner</button><button type="button" id="p-make-rect">Make rectangle</button>'
          : '<button type="button" id="p-edit-corners">Edit corners</button>'}
      </div>
      <button type="button" id="p-route">Route preview</button>
    `;

    el.querySelector('#p-number').addEventListener('change', (e) => commitField(item.id, { number: e.target.value.trim() }, 'Edit number'));
    el.querySelector('#p-name').addEventListener('change', (e) => commitField(item.id, { name: e.target.value }, 'Edit name'));
    el.querySelectorAll('#p-class input').forEach((r) => {
      r.addEventListener('change', (e) => commitField(item.id, { cls: e.target.value }, 'Change class'));
    });
    el.querySelector('#p-showname').addEventListener('change', (e) => commitField(item.id, { showName: e.target.checked }, 'Toggle name'));

    const fsSelect = el.querySelector('#p-fontsize');
    const fsCustom = el.querySelector('#p-fontsize-custom');
    fsSelect.addEventListener('change', () => {
      if (fsSelect.value === 'custom') { fsCustom.focus(); return; }
      const val = fsSelect.value === '' ? null : parseInt(fsSelect.value, 10);
      commitField(item.id, { label: { fontSize: val } }, 'Font size');
    });
    fsCustom.addEventListener('change', () => {
      const val = fsCustom.value ? parseInt(fsCustom.value, 10) : null;
      commitField(item.id, { label: { fontSize: val } }, 'Font size');
    });

    el.querySelector('#p-recenter').addEventListener('click', () => {
      commitField(item.id, { label: { pinned: false, x: null, y: null } }, 'Re-center label');
    });

    const sectionEl = el.querySelector('#p-section');
    if (sectionEl) {
      sectionEl.addEventListener('change', (e) => commitField(item.id, { section: e.target.value || null }, 'Change section'));
    }

    if (item.shape !== 'poly') {
      ['x', 'y', 'w', 'h'].forEach((k) => {
        el.querySelector(`#p-${k}`).addEventListener('change', (e) => {
          const val = parseInt(e.target.value, 10);
          if (Number.isNaN(val)) return;
          commitField(item.id, { [k]: val }, `Edit ${k}`);
        });
      });
    }

    el.querySelector('#p-route').addEventListener('click', () => app.routeToRoom(item.id));

    const editCornersBtn = el.querySelector('#p-edit-corners');
    if (editCornersBtn) {
      editCornersBtn.addEventListener('click', () => {
        const points = rectToPoints(bboxOf(item));
        commitField(item.id, { shape: 'poly', points }, 'Edit corners');
      });
    }
    const addCornerBtn = el.querySelector('#p-add-corner');
    if (addCornerBtn) {
      addCornerBtn.addEventListener('click', () => {
        const pts = item.points;
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const len = dist(a, b);
          if (!best || len > best.len) best = { len, i, mid: [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)] };
        }
        if (!best) return;
        const newPts = pts.slice(0, best.i + 1).concat([best.mid], pts.slice(best.i + 1));
        commitField(item.id, { points: newPts }, 'Add corner');
      });
    }
    const makeRectBtn = el.querySelector('#p-make-rect');
    if (makeRectBtn) {
      makeRectBtn.addEventListener('click', () => {
        const b = bboxOf(item);
        commitField(item.id, { shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h }, 'Make rectangle');
      });
    }
  }

  function sectionSelect(item) {
    const sections = app.doc.sections || [];
    return `
      <div class="form-row">
        <label for="p-section">Section</label>
        <select id="p-section">
          <option value="">None</option>
          ${sections.map((s) => `<option value="${escapeAttr(s.id)}" ${item.section === s.id ? 'selected' : ''}>${escapeAttr(s.title)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  function renderDoor(item) {
    el.innerHTML = `
      <div class="section-title">Door</div>
      <div class="form-row">
        <label>Kind</label>
        <div class="radio-row">
          <label><input type="radio" name="p-kind" value="EXIT" ${item.kind === 'EXIT' ? 'checked' : ''}> EXIT</label>
          <label><input type="radio" name="p-kind" value="Door" ${item.kind === 'Door' ? 'checked' : ''}> Door</label>
        </div>
      </div>
    `;
    el.querySelectorAll('input[name="p-kind"]').forEach((r) => {
      r.addEventListener('change', (e) => commitField(item.id, { kind: e.target.value }, 'Door kind'));
    });
  }

  function renderStair(item) {
    el.innerHTML = `
      <div class="section-title">Stair</div>
      <div class="form-row">
        <label>Direction</label>
        <div class="radio-row">
          <label><input type="radio" name="p-dir" value="v" ${item.dir === 'v' ? 'checked' : ''}> Vertical treads</label>
          <label><input type="radio" name="p-dir" value="h" ${item.dir === 'h' ? 'checked' : ''}> Horizontal treads</label>
        </div>
      </div>
      <div class="form-grid2">
        <div class="form-row"><label>X</label><input type="number" id="p-x" value="${item.x}"></div>
        <div class="form-row"><label>Y</label><input type="number" id="p-y" value="${item.y}"></div>
        <div class="form-row"><label>W</label><input type="number" id="p-w" value="${item.w}"></div>
        <div class="form-row"><label>H</label><input type="number" id="p-h" value="${item.h}"></div>
      </div>
    `;
    el.querySelectorAll('input[name="p-dir"]').forEach((r) => {
      r.addEventListener('change', (e) => commitField(item.id, { dir: e.target.value }, 'Stair direction'));
    });
    ['x', 'y', 'w', 'h'].forEach((k) => {
      el.querySelector(`#p-${k}`).addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (Number.isNaN(val)) return;
        commitField(item.id, { [k]: val }, `Edit ${k}`);
      });
    });
  }

  function renderCompass(item) {
    el.innerHTML = `
      <div class="section-title">Compass</div>
      <div class="form-row">
        <label for="p-deg">Rotation (deg)</label>
        <input type="number" id="p-deg" value="${item.deg}">
      </div>
    `;
    el.querySelector('#p-deg').addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      commitField(item.id, { deg: val }, 'Rotate compass');
    });
  }

  function renderFloor() {
    const floor = app.doc.floor;
    el.innerHTML = `
      <div class="section-title">Floor outline</div>
      <p>${floor ? floor.points.length : 0} points</p>
      <button type="button" id="p-remove-floor">Remove outline</button>
    `;
    el.querySelector('#p-remove-floor').addEventListener('click', async () => {
      const ok = await app.confirm('Remove the floor outline?');
      if (ok) app.commit({ ...app.doc, floor: null }, 'Remove outline');
    });
  }

  function renderMulti(items) {
    const rooms = items.filter((it) => it.type === 'room');
    el.innerHTML = `
      <div class="section-title">${items.length} items selected</div>
      ${rooms.length >= 2 ? `
      <div class="align-grid">
        <button type="button" data-align="left">Left</button>
        <button type="button" data-align="right">Right</button>
        <button type="button" data-align="top">Top</button>
        <button type="button" data-align="bottom">Bottom</button>
        <button type="button" data-align="center-h">Center H</button>
        <button type="button" data-align="center-v">Center V</button>
        <button type="button" data-align="distribute-h">Distribute H</button>
        <button type="button" data-align="distribute-v">Distribute V</button>
        <button type="button" data-align="match-w">Match width</button>
        <button type="button" data-align="match-h">Match height</button>
        <button type="button" data-align="square">Square up</button>
      </div>` : '<p style="color:var(--muted)">Select 2+ rooms to align.</p>'}
    `;
    el.querySelectorAll('[data-align]').forEach((btn) => {
      btn.addEventListener('click', () => runAlign(btn.dataset.align, rooms));
    });
  }

  function rectBoxes(rooms) {
    return rooms.filter((r) => r.shape !== 'poly').map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  function runAlign(kind, rooms) {
    const boxes = rectBoxes(rooms);
    if (boxes.length < 2) return;
    let doc = app.doc;

    if (kind === 'left') {
      const min = Math.min(...boxes.map((b) => b.x));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: min }); });
    } else if (kind === 'right') {
      const max = Math.max(...boxes.map((b) => b.x + b.w));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: max - b.w }); });
    } else if (kind === 'top') {
      const min = Math.min(...boxes.map((b) => b.y));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: min }); });
    } else if (kind === 'bottom') {
      const max = Math.max(...boxes.map((b) => b.y + b.h));
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: max - b.h }); });
    } else if (kind === 'center-h') {
      const cx = boxes.reduce((s, b) => s + b.x + b.w / 2, 0) / boxes.length;
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { x: Math.round(cx - b.w / 2) }); });
    } else if (kind === 'center-v') {
      const cy = boxes.reduce((s, b) => s + b.y + b.h / 2, 0) / boxes.length;
      boxes.forEach((b) => { doc = updateItem(doc, b.id, { y: Math.round(cy - b.h / 2) }); });
    } else if (kind === 'match-w') {
      const w = boxes[0].w;
      boxes.slice(1).forEach((b) => { doc = updateItem(doc, b.id, { w }); });
    } else if (kind === 'match-h') {
      const h = boxes[0].h;
      boxes.slice(1).forEach((b) => { doc = updateItem(doc, b.id, { h }); });
    } else if (kind === 'distribute-h') {
      const sorted = [...boxes].sort((a, b) => a.x - b.x);
      const first = sorted[0], last = sorted[sorted.length - 1];
      const totalSpan = (last.x + last.w) - first.x;
      const totalW = sorted.reduce((s, b) => s + b.w, 0);
      const gap = (totalSpan - totalW) / (sorted.length - 1);
      let cursor = first.x;
      sorted.forEach((b) => {
        doc = updateItem(doc, b.id, { x: Math.round(cursor) });
        cursor += b.w + gap;
      });
    } else if (kind === 'distribute-v') {
      const sorted = [...boxes].sort((a, b) => a.y - b.y);
      const first = sorted[0], last = sorted[sorted.length - 1];
      const totalSpan = (last.y + last.h) - first.y;
      const totalH = sorted.reduce((s, b) => s + b.h, 0);
      const gap = (totalSpan - totalH) / (sorted.length - 1);
      let cursor = first.y;
      sorted.forEach((b) => {
        doc = updateItem(doc, b.id, { y: Math.round(cursor) });
        cursor += b.h + gap;
      });
    } else if (kind === 'square') {
      const g = STD.grid;
      const roundTo = (v) => Math.round(v / g) * g;
      const squared = boxes.map((b) => ({
        id: b.id,
        x: roundTo(b.x), y: roundTo(b.y), w: roundTo(b.w), h: roundTo(b.h),
      }));
      // make near-equal widths/heights equal within 4 units
      for (let i = 0; i < squared.length; i++) {
        for (let j = 0; j < squared.length; j++) {
          if (i === j) continue;
          if (Math.abs(squared[i].w - squared[j].w) <= 4) squared[j].w = squared[i].w;
          if (Math.abs(squared[i].h - squared[j].h) <= 4) squared[j].h = squared[i].h;
        }
      }
      squared.forEach((b) => { doc = updateItem(doc, b.id, { x: b.x, y: b.y, w: b.w, h: b.h }); });
    }

    app.commit(doc, `Align ${kind}`);
  }

  function update(evt) {
    if (!evt || evt.type === 'selection' || evt.type === 'doc' || evt.type === 'project') {
      const ids = [...app.selection];
      if (ids.length === 1 && ids[0] === 'floor') {
        renderFloor();
        return;
      }
      render();
    }
  }

  const unsub = app.subscribe(update);
  update();

  return {
    update,
    destroy() {
      unsub();
      el.innerHTML = '';
    },
  };
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
