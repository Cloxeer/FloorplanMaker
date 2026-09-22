// validation.js
// Renders app.validation as a friendly checklist below the properties panel,
// plus clickable "fix" / "worth a look" lists for remaining problems.
// Depends on: nothing beyond app's public API.

const CHECKLIST = [
  { label: 'Building outline drawn', codes: ['no-floor', 'floor-not-closed'] },
  { label: 'Every room has a number', codes: ['room-no-number', 'bad-number-format'] },
  { label: 'No two rooms share a number', codes: ['duplicate-number'] },
  { label: 'Any doors sit on the outside wall with a label', codes: ['door-off-outline', 'door-no-exit-label', 'door-no-floor'] },
  { label: 'Labels sit inside their rooms', codes: ['label-outside-shape', 'label-in-other-room'] },
  { label: 'At least one door or stairs', codes: ['checklist-no-door'] },
  { label: 'At least one hallway', codes: ['checklist-no-hall'] },
  { label: 'At least two rooms with a number', codes: ['checklist-no-numbered-room'] },
  { label: 'All hallways connect', codes: ['hall-unconnected'] },
];

// Some checklist rows need facts that js/model/validate.js does not report
// (it validates shapes, not "did the user add one of these at all"). We
// synthesize extra pseudo-results from the doc so checklistHtml/Ready can
// treat them the same as any other validation code.
export function docChecklistCodes(doc) {
  const items = (doc && doc.items) || [];
  const hasDoorOrStair = items.some((it) => it.type === 'door' || it.type === 'stair');
  const hasHall = items.some((it) => it.type === 'hall');
  const numberedRoomCount = items.filter((it) => it.type === 'room' && it.number).length;
  const out = [];
  if (!hasDoorOrStair) out.push({ level: 'error', code: 'checklist-no-door', message: 'Add at least one door or stairs.' });
  if (!hasHall) out.push({ level: 'error', code: 'checklist-no-hall', message: 'Add at least one hallway.' });
  if (numberedRoomCount < 2) out.push({ level: 'error', code: 'checklist-no-numbered-room', message: 'Add at least two rooms with a number.' });
  if (hallsOverlap(items)) out.push({ level: 'warning', code: 'hall-overlap', message: "Hallways overlap — a hallway can't sit on top of another" });
  if (hasUnconnectedHall(doc, items)) out.push({ level: 'warning', code: 'hall-unconnected', message: "Some hallways aren't connected — join them so people can walk through." });
  return out;
}

const TOUCH_TOL = 1;

// Strict rect link: real overlap or a shared edge within `tol`, not a mere
// inflated-bbox touch. Requires actual interval overlap on one axis (the
// axis "along" the shared edge) while the other axis is within `tol` of
// touching — corner-only proximity (both axes merely close) doesn't count.
function rectsLinked(a, b, tol) {
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
  return (gapX <= tol && gapY <= 0) || (gapY <= tol && gapX <= 0);
}

function pointNearBox(px, py, box, tol) {
  return px >= box.x - tol && px <= box.x + box.w + tol
    && py >= box.y - tol && py <= box.y + box.h + tol;
}

function segmentNearBox(x1, y1, x2, y2, box, tol) {
  const segBox = {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
  };
  return rectsLinked(box, segBox, tol);
}

// A hall network is "connected" only when every hall belongs to one single
// component (linked by real overlap/shared edges, tol<=1) AND that
// component reaches an anchor — a stair box, a door midpoint, or the floor
// outline edge, also within tol<=1. Two or more separate hall clusters, or
// a lone cluster that never reaches an anchor, both fail.
function hasUnconnectedHall(doc, items) {
  const halls = items.filter((it) => it.type === 'hall');
  if (!halls.length) return false;
  const stairs = items.filter((it) => it.type === 'stair');
  const doors = items.filter((it) => it.type === 'door');
  const outlinePts = (doc && doc.floor && doc.floor.points) || null;

  // Union-find over halls using the strict link.
  const parent = halls.map((_, i) => i);
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(i, j) { const ri = find(i); const rj = find(j); if (ri !== rj) parent[ri] = rj; }
  for (let i = 0; i < halls.length; i += 1) {
    for (let j = i + 1; j < halls.length; j += 1) {
      const a = halls[i];
      const b = halls[j];
      if (rectsLinked({ x: a.x, y: a.y, w: a.w, h: a.h }, { x: b.x, y: b.y, w: b.w, h: b.h }, TOUCH_TOL)) union(i, j);
    }
  }
  const roots = new Set(halls.map((_, i) => find(i)));
  if (roots.size > 1) return true; // 2+ separate clusters

  const reachesAnchor = halls.some((h) => {
    const hBox = { x: h.x, y: h.y, w: h.w, h: h.h };
    if (stairs.some((s) => rectsLinked(hBox, { x: s.x, y: s.y, w: s.w, h: s.h }, TOUCH_TOL))) return true;
    if (doors.some((d) => pointNearBox((d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2, hBox, TOUCH_TOL))) return true;
    if (outlinePts && outlinePts.length >= 2) {
      for (let i = 0; i < outlinePts.length; i += 1) {
        const [x1, y1] = outlinePts[i];
        const [x2, y2] = outlinePts[(i + 1) % outlinePts.length];
        if (segmentNearBox(x1, y1, x2, y2, hBox, TOUCH_TOL)) return true;
      }
    }
    return false;
  });
  return !reachesAnchor;
}

function hallsOverlap(items) {
  const halls = items.filter((it) => it.type === 'hall');
  for (let i = 0; i < halls.length; i += 1) {
    for (let j = i + 1; j < halls.length; j += 1) {
      const a = halls[i];
      const b = halls[j];
      const axisA = a.w > a.h ? 'h' : 'v';
      const axisB = b.w > b.h ? 'h' : 'v';
      if (axisA !== axisB) continue;
      const x1 = Math.max(a.x, b.x);
      const y1 = Math.max(a.y, b.y);
      const x2 = Math.min(a.x + a.w, b.x + b.w);
      const y2 = Math.min(a.y + a.h, b.y + b.h);
      if (x2 > x1 && y2 > y1) return true;
    }
  }
  return false;
}

// Shared with previewStep.js, so the preview panel's checklist always
// matches the one in the properties sidebar.
export function checklistHtml(results) {
  const byCode = new Set(results.map((r) => r.code));
  return CHECKLIST.map((row) => {
    const satisfied = !row.codes.some((c) => byCode.has(c));
    return `<li class="check-${satisfied ? 'ok' : 'pending'}"><span class="check-mark">${satisfied ? '✓' : '○'}</span> ${escapeHtml(row.label)}</li>`;
  }).join('');
}
export function checklistReady(results) {
  const byCode = new Set(results.map((r) => r.code));
  const checklistCodes = new Set(CHECKLIST.flatMap((row) => row.codes));
  const remainingErrors = results.filter((r) => r.level === 'error' && !checklistCodes.has(r.code));
  return CHECKLIST.every((row) => !row.codes.some((c) => byCode.has(c))) && remainingErrors.length === 0;
}

export function mountValidation(el, app) {
  function render() {
    const results = (app.validation || []).concat(docChecklistCodes(app.doc));
    const byCode = new Set(results.map((r) => r.code));

    const checklistCodes = new Set(CHECKLIST.flatMap((row) => row.codes));
    const remainingErrors = results.filter((r) => r.level === 'error' && !checklistCodes.has(r.code));
    const remainingWarnings = results.filter((r) => r.level === 'warning');

    const allSatisfied = checklistReady(results);

    const readyHtml = '';

    const fixListHtml = remainingErrors.length ? `
      <div class="section-title">Fix these before export</div>
      <ul class="fix-list">${remainingErrors.map((r, i) => `<li data-kind="error" data-index="${i}">${escapeHtml(r.message)}</li>`).join('')}</ul>
    ` : '';

    const notesHtml = remainingWarnings.length ? `
      <div class="section-title">Worth a look</div>
      <ul class="notes-list">${remainingWarnings.map((r, i) => `<li data-kind="warning" data-index="${i}">${escapeHtml(r.message)}</li>`).join('')}</ul>
    ` : '';

    el.innerHTML = `
      <div class="section-title">Checklist</div>
      <ul class="checklist">${checklistHtml(results)}</ul>
      ${readyHtml}
      ${fixListHtml}
      ${notesHtml}
    `;

    el.querySelectorAll('.fix-list li').forEach((li) => {
      const idx = parseInt(li.dataset.index, 10);
      const item = remainingErrors[idx];
      if (item && item.itemId) {
        li.addEventListener('click', () => app.setSelection([item.itemId]));
      }
    });
    el.querySelectorAll('.notes-list li').forEach((li) => {
      const idx = parseInt(li.dataset.index, 10);
      const item = remainingWarnings[idx];
      if (item && item.itemId) {
        li.addEventListener('click', () => app.setSelection([item.itemId]));
      }
    });
  }

  function update(evt) {
    if (!evt || evt.type === 'validation' || evt.type === 'doc' || evt.type === 'project') render();
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
