// multiPhoto.js
// Several photos of ONE floor, step by step: each photo goes through the same corners -> Flatten screens as a single
// photo does (photoStep.js, in its "one of several" form), then all of them meet on one board side by side
// (mergeStage.js) where you line them up into one floor. Back walks back through the photos; the first Back leaves
// the flow (onCancel(message?)). Finishing calls onDone(mainPhoto, { extraPhotos }) like a single photo, or, for AutoBuild, with the
// photos joined into one picture ({ autoBuild: true, pixels, extraPhotos: [] }).
// Depends on: js/view/panels/photoStep.js, js/view/panels/mergeStage.js.

import { mountPhotoStep } from './photoStep.js';
import { mountMergeStage } from './mergeStage.js';

export function mountMultiPhoto(host, { srcs, firstCorners, onDone, onCancel }) {
  const n = srcs.length;
  const states = srcs.map((_, i) => ({ corners: i === 0 ? firstCorners : null, vals: { tilt: 0, turn: 0, roll: 0, grid: false }, photo: null }));
  let cur = null;
  let kept = null; // { urls, layout } of the board when it was left with Back
  const clear = () => { if (cur) { cur.destroy(); cur = null; } host.innerHTML = ''; };

  function step(i) {
    clear();
    cur = mountPhotoStep(host, {
      initial: { originalDataUrl: srcs[i], corners: states[i].corners || undefined },
      multi: {
        index: i, total: n, vals: states[i].vals,
        nextLabel: i < n - 1 ? `Next photo (${i + 2} of ${n})` : 'Put the photos together',
        onBack: () => (i > 0 ? step(i - 1) : onCancel()),
        onError: () => onCancel('One of those files could not be read as a photo. Pick the photos again.'),
      },
      onDone: (photo) => {
        states[i].corners = photo.corners;
        states[i].photo = photo;
        if (i < n - 1) step(i + 1); else merge();
      },
    });
  }

  function merge() {
    clear();
    const head = document.querySelector('.photo-step-header');
    if (head) {
      head.querySelector('h2').textContent = 'Put the photos together';
      head.querySelector('p').textContent = 'The photos sit side by side. Line them up so they make one floor.';
    }
    const photos = states.map((s) => s.photo);
    const same = kept && kept.urls.length === n && kept.urls.every((u, i) => u === photos[i].dataUrl);
    cur = mountMergeStage(host, {
      photos,
      layout: same ? kept.layout : null,
      onBack: () => { kept = { urls: photos.map((p) => p.dataUrl), layout: cur.layout() }; step(n - 1); },
      onTrace: (main, extras) => onDone(main, { extraPhotos: extras }),
      onAutoBuild: ({ photo, pixels }) => onDone(photo, { autoBuild: true, pixels, extraPhotos: [] }),
    });
  }

  step(0);
  return { destroy() { clear(); } };
}
