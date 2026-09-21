// stepStrip.js
// Small "1 Photo · 2 Trace · 3 Export" strip shown at the top of the studio.
// Step 1 always reopens the photo step; step 3 runs export. The current step
// is inferred from doc state (no photo -> 1, photo but no rooms/floor -> 2,
// otherwise -> 2/3 depending on validation). Purely presentational; owns no
// state beyond what it reads from `app` on each update().
// Depends on: app.project, app.doc, app.exportAll, callbacks passed in.

const STEPS = [
  { n: 1, label: 'Photo' },
  { n: 2, label: 'Trace' },
  { n: 3, label: 'Export' },
];

export function mountStepStrip(el, app, { onPhoto, onExport }) {
  function currentStep() {
    const project = app.project;
    if (!project) return 1;
    if (!project.photo) return 1;
    const hasContent = (app.doc && (app.doc.items.length > 0 || app.doc.floor));
    if (!hasContent) return 2;
    return 2;
  }

  function render() {
    const step = currentStep();
    el.innerHTML = STEPS.map((s) => `
      <button type="button" class="step-chip${s.n === step ? ' active' : ''}" data-step="${s.n}">${s.n} ${s.label}</button>
    `).join('<span class="step-sep">&middot;</span>');
    el.querySelectorAll('.step-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const n = parseInt(btn.dataset.step, 10);
        if (n === 1) onPhoto();
        else if (n === 3) onExport();
      });
    });
  }

  render();
  const unsub = app.subscribe((evt) => {
    if (evt.type === 'doc' || evt.type === 'project') render();
  });

  return {
    update: render,
    destroy() {
      unsub();
      el.innerHTML = '';
    },
  };
}
