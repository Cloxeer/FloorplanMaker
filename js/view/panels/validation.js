// validation.js
// Renders app.validation as a friendly checklist below the properties panel,
// plus clickable "fix" / "worth a look" lists for remaining problems.
// Depends on: nothing beyond app's public API.

const CHECKLIST = [
  { label: 'Building outline drawn', codes: ['no-floor', 'floor-not-closed'] },
  { label: 'Every room has a number', codes: ['room-no-number', 'bad-number-format'] },
  { label: 'No two rooms share a number', codes: ['duplicate-number'] },
  { label: 'Doors sit on the outline with an EXIT label', codes: ['door-off-outline', 'door-no-exit-label', 'door-no-floor'] },
  { label: 'Labels sit inside their rooms', codes: ['label-outside-shape', 'label-in-other-room'] },
  { label: 'At least one door or stairs', codes: ['checklist-no-door'] },
  { label: 'At least one hallway or stairs', codes: ['checklist-no-hall'] },
  { label: 'At least one room with a number', codes: ['checklist-no-numbered-room'] },
];

// Some checklist rows need facts that js/model/validate.js does not report
// (it validates shapes, not "did the user add one of these at all"). We
// synthesize extra pseudo-results from the doc so checklistHtml/Ready can
// treat them the same as any other validation code.
export function docChecklistCodes(doc) {
  const items = (doc && doc.items) || [];
  const hasDoorOrStair = items.some((it) => it.type === 'door' || it.type === 'stair');
  const hasHallOrStair = items.some((it) => it.type === 'hall' || it.type === 'stair');
  const hasNumberedRoom = items.some((it) => it.type === 'room' && it.number);
  const out = [];
  if (!hasDoorOrStair) out.push({ level: 'error', code: 'checklist-no-door', message: 'Add at least one door or stairs.' });
  if (!hasHallOrStair) out.push({ level: 'error', code: 'checklist-no-hall', message: 'Add at least one hallway or stairs.' });
  if (!hasNumberedRoom) out.push({ level: 'error', code: 'checklist-no-numbered-room', message: 'Add at least one room with a number.' });
  return out;
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

    const readyHtml = allSatisfied ? '<div class="checklist-ready">Ready to export &#10003;</div>' : '';

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
