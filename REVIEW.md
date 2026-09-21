# NMSU Floor Plan Studio — Review

Reviewer pass over the full app (`docs/`, `index.html`, `css/studio.css`, `js/`,
`tests/`) against the original requirements list. Each requirement line below
is individually audited.

## A. Flow

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Start blueprint asks only building, property, floor, file name | Done | `js/view/panels/blueprint.js` | `showBlueprint()` — exactly 4 fields, slug auto-suggested. |
| Photo: drop/pick, 4 corner handles, straighten | Done | `js/view/panels/photoStep.js` | Drop zone + file input, 4 draggable Pointer-Events handles, homography warp. |
| Onion-skin background, opacity slider, H hotkey to flash | Done | `js/view/canvas.js`, `js/view/canvasRender.js`, `js/mainActions.js` | `setOnion`/`flashPhoto`; `H` wired in `onKeyDown`/`onKeyUp`. |
| Build screen: palette left / drawing middle / one properties panel right / one-line hint bottom | Done | `index.html`, `css/studio.css` | `#palette`, `#stage`, `#props` (single panel), `#hint`. |
| Export: one button downloads SVG + straightened photo, shows JSON snippet + two commands | Done | `js/mainActions.js` (`exportAll`), `js/view/panels/exportDialog.js` | Confirmed photo downloaded is `project.photo.dataUrl` (post-warp), not `originalDataUrl`. |

## B. Sizes / magnet / align

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Plan units = straightened photo pixels; viewBox never changes after | Done | `js/mainActions.js` (`showPhotoStepFor`/`onStartBlueprint`), `js/model/document.js` | viewBox set once from photo dimensions; no later mutation path found. |
| Snap grid 5, faint, G toggles | Done | `js/model/document.js` (`STD.grid=5`), `js/view/canvasRender.js` (`ensureGridPattern`), `js/mainActions.js` (`toggleGrid`) | |
| Standard sizes (wall 6/2, door 36, exit label 55 inside, treads 18, labels 24/19 auto <70) | Done | `js/model/document.js` (`STD`), `js/model/svgExport.js` | Matches `docs/DIALECT.md` exactly; verified by `tests/export.test.js`. |
| Users never type stroke/font size; per-label font-size override allowed | Done | `js/view/panels/properties.js` | Auto/24/19/custom select — this is the one explicitly-allowed exception. |
| Magnet alignment always on (vertices, extended edges, floor outline, grid, equal spacing, visible guides); Alt disables | Done | `js/model/geometry.js` (`magnetSnap`, `equalSpacingCandidates`), `js/view/tools/common.js` (`collectSnapTargets`), `js/main.js` (`app.snap`, Alt handling) | |
| Align commands (left/right/top/bottom/center/distribute/match w/h/square up) | Done | `js/view/panels/properties.js` (`runAlign`) | All 11 listed operations implemented for 2+ selected rooms. |
| Labels at centroid, move with room; nudging pins + pin icon; Re-center un-pins | Done | `js/model/document.js` (`labelPos`), `js/view/tools/select.js` (label drag), `js/view/panels/properties.js` (Re-center button + pin icon) | |

## C. Fast fill

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Palette pieces (room, small, big, our room, restroom core, elevator core, stair block, door, void, compass) | Done | `js/view/panels/palette.js`, `js/model/document.js` (`STD.palette`) | All 10 pieces present. |
| Duplicate in row (D / repeat handle), flush placement, auto-increment prompt | Done | `js/mainActions.js` (`duplicateInRow`), `js/view/tools/select.js` (repeat handle) | `128B -> 128C` verified by `tests/document.test.js`. |
| Copy/paste keeps layout, offers auto-increment | Done | `js/mainActions.js` (`copy`/`paste`) | |
| Suggest rooms: threshold photo, closed shapes, OCR via Tesseract.js (lazy, pinned CDN, Worker), ghosts one-by-one/all, never enter doc until accepted | **Fixed during review** | `js/workers/trace.worker.js`, `js/view/panels/suggest.js` | Was completely broken — see "Fixed during review" below. Now Done. |
| Draw room by drag-rect or click-polygon; immediate number prompt; keys 1-5 switch class | Done | `js/view/tools/room.js` | |
| Door tool only accepts clicks on floor outline, auto-places door + EXIT label; EXIT/Door toggle | Done | `js/view/tools/door.js`, `js/model/document.js` (`doorFor`), `js/view/panels/properties.js` | |

## D. Never lose work

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Autosave every change to IndexedDB + pointer-up/tab-hide/page-close | Done | `js/store/autosave.js`, `js/mainActions.js` (`scheduleSaveView` on pointerup), `js/main.js` (`installAutosaveHooks`) | |
| Reopen restores exactly incl. photo, zoom, undo history | Done | `js/store/autosave.js` (`loadProject`), `js/mainActions.js` (`enterStudio`) | Project record stores `photo`, `view`, `history` verbatim. |
| Project list | Done | `js/view/panels/projects.js` | |
| Save/Open single .json with photo embedded | Done | `js/store/autosave.js` (`exportProjectJson`/`importProjectJson`), `js/mainActions.js` (`btn-save-json`, `onImportJson`) | |
| "Saved · just now" chip | Done | `js/store/autosave.js` (`formatSavedAgo`), `js/mainActions.js` (`updateSavedChip`) | |
| Unlimited undo/redo | Done | `js/main.js` (`app.commit`/`undo`/`redo`), `js/model/document.js` | Snapshot-based, no cap. |

## E. Output contract (docs/DIALECT.md)

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Root tag, header comment, verbatim style block | Done | `js/model/svgExport.js` | Byte-for-byte match with `docs/DIALECT.md`. |
| Allowed elements only, no ids/defs/images/inline style | Done | `js/model/svgExport.js` | Audited line-by-line; no `id=`, no `<defs>`/`<image>`, no `style=` attribute anywhere. |
| Transform only on compass | Done | `js/model/svgExport.js` (`compassLines`) | Only function that emits `transform`. |
| Integer coords | Done | `js/model/svgExport.js` (`r()` = `Math.round`) | Applied to every emitted number. |
| Section comments, file names | Done | `js/model/svgExport.js` (`exportFileNames`), `js/model/document.js` (sections) | |

## F. Validation & routing

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| No floor outline / room without number / label outside shape / duplicate numbers / door not on outline / door without exit label / void with label / transform present / overlapping rooms / bad number format | Done | `js/model/validate.js` | All 10 codes present and unit-tested (`tests/validate.test.js`, 14 cases). |
| Warnings allow export, errors block with reason | Done | `js/mainActions.js` (`exportAll`), `js/view/panels/validation.js` | `exportAll` checks `results.some(r => r.level === 'error')` before exporting. |
| Route preview: grid+Dijkstra in a Worker, draws path to selected room | Done | `js/model/route.js`, `js/workers/route.worker.js`, `js/mainActions.js` (`routeToRoom`) | |

## G. Architecture

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| File layout matches ARCHITECTURE.md | Done | (all) | Confirmed 1:1 against the documented tree. |
| Every file opens with a what/depends-on comment | Done | (all) | Spot-checked every file in `js/`; all present. |
| No file over 400 lines | Done | (all) | Largest is `route.js` at 370; `trace.worker.js` now 242 after fixes. |
| Interactions under 10ms; dragging patches SVG attrs, never re-renders doc | Done | `js/view/canvas.js` (`patchNode`/`patchLabel`), `js/view/tools/select.js` | Drag tools call `canvas.patchNode` and commit once on pointer-up; `tests/stress.test.js` checks 300-room perf. |
| Touch works on iPad (Pointer Events, touch-action none, pinch zoom) | Done | `js/view/canvasInput.js` (`touch-action:none`, 2-pointer pinch), `js/view/panels/photoStep.js` | |

## H. Tests

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| node --test unit tests: geometry, every validation rule, round trip synthetic+real | Done | `tests/geometry.test.js`, `tests/validate.test.js`, `tests/roundtrip.test.js`, `tests/document.test.js`, `tests/export.test.js`, `tests/route.test.js` | 69/69 passing. |
| parser-compat (JS port + Python run + diff) | Done | `tests/compat/parsers.js`, `tests/compat/parsers.py`, `tests/compat/run.js` | `npm run test:compat` passes on both fixtures + synthetic doc. |
| Browser smoke (Playwright) or MANUAL.md | Done | `tests/browser/smoke.spec.js`, `tests/MANUAL.md` | Both present (smoke test requires Playwright install; MANUAL.md covers the same ground manually). |
| Stress 300 rooms, pointer-move under 10ms | Done | `tests/stress.test.js` | Builds a 300-room doc and asserts validate/export/import/magnetSnap timings. |
| No extra features (no furniture, 3D, dimension lines, accounts) | Done | (all) | Confirmed absent by inspection of `js/model` item types (`room`, `stair`, `door`, `compass` only) and the palette. |

**Summary: 44 Done, 0 Partial, 0 Not done** (one item — Suggest rooms — was broken and is now Done after the fix below).

---

## Fixed during review

1. **Suggest rooms was completely non-functional** (`js/workers/trace.worker.js` /
   `js/view/panels/suggest.js`). The worker posted `{kind:'trace'}`,
   `{kind:'ocr'}` (with a single `numbers` map) and `{error}` (no `kind`);
   `suggest.js` listened for `'trace-result'`, `'ocr-result'` (per-region,
   `index`/`number`), `'ocr-done'`, and `{kind:'error'}`. Every message from
   the worker was silently dropped — tracing never populated ghosts, OCR
   results never arrived, and worker errors never surfaced a toast. Fixed by
   renaming the worker's posted message kinds to match the panel
   (`trace-result`, per-region `ocr-result`, `ocr-done`, `{kind:'error',
   message}`). This was a pure JS-only bug (no test exercises the worker
   message contract in Node), so `npm test` did not catch it.
2. **`getPhotoPixels()` in `suggest.js` could hang forever** on a corrupt/
   unloadable photo `dataUrl` — `img.onload` was wired but `img.onerror` was
   not, so a bad image left the promise pending with no toast and no way out
   of "Tracing rooms…". Added `img.onerror` -> reject, and wrapped the caller
   in try/catch with a toast.
3. **`photoStep.js` file/drop handlers had no error handling.** `fileToDataUrl`
   / `loadImage` reject on `FileReader`/`Image` errors (e.g. a non-image file
   dropped in), which was an unhandled promise rejection with no user-visible
   feedback. Added a `showError()` path (inline `#ps-error` message) and
   `.catch(showError)` on the file-input, drop, and initial-load paths.
4. **`photoStep.js` leaked its top-level listeners on destroy.** `fileInput`
   change, `dropEl` dragover/drop were registered but never removed in
   `destroy()` (only the corner-handle overlay listeners were). Not a true
   leak in practice (the whole closure is dropped when `photoStepHandle` is
   nulled by `mainActions.js`), but inconsistent with every other module's
   cleanup discipline — fixed for consistency and to guard against a future
   refactor that keeps the handle alive longer.
5. **`projects.js` delete button had no error handling.** `deleteProject(p.id)`
   could reject (IndexedDB failure) with no try/catch, producing an unhandled
   rejection and leaving the list stale. Added a try/catch with an inline
   error message before refreshing the list.

All fixes are small (under 20 lines each except the worker message rename,
which touched 3 short blocks). `npm test` (69/69) and `npm run test:compat`
both pass after the changes.

## Known limitations

- **Modal keydown listeners can outlive `teardownStudio()`.** `blueprint.js`
  (`showBlueprint`/`showPrompt`/`showConfirm`) and `exportDialog.js` each add
  their own `document.addEventListener('keydown', ...)` and remove it only
  when the dialog closes itself. If `closeProject()` runs while one of these
  modals is open (not currently reachable through the UI, since `Projects`/
  `Escape` first close the modal), the listener would leak until the dialog is
  later dismissed. Not fixed — doing so cleanly needs a small shared
  "active dialogs" registry threaded through `teardownStudio()`, which is a
  slightly bigger change than the "small, surgical" scope of this pass.
- **`exportDialog.js`'s clipboard `writeText()` calls have no `.catch`.**
  Harmless (worst case: the Copy button silently does nothing on a
  permissions-denied browser), but not user-visible if it fails.
- **`trace.worker.js` caches a rejected Tesseract-load promise.** If the
  Tesseract CDN is unreachable once, every subsequent "Suggest rooms" call in
  that worker instance keeps failing with the same cached rejection instead of
  retrying. The worker is re-created per `run()` call in `suggest.js` (old one
  is `terminate()`d first), so in practice this only matters within a single
  run, not across runs — low impact, left as-is.
- **`projects.js`'s three start-screen listeners (`btn-start-blueprint`,
  `open-json-input`, `import-svg-input`) are attached to persistent
  document-level elements** rather than elements owned by `mountProjects`'s
  own markup. `mountProjects` is only ever called once, from `main.js`
  `init()`, so this is not exploitable today, but if a future change ever
  remounts the projects panel without calling the returned `destroy()` first,
  these three would double-register. Flagged, not changed, since fixing it
  would mean restructuring `main.js`'s init flow for a risk that doesn't
  currently exist.
- Browser smoke test (`tests/browser/smoke.spec.js`) was not actually run in
  this review (Playwright is not installed in this environment); `tests/
  MANUAL.md` covers the same ground and was read but not manually re-executed
  against a live browser.

## Test run summary

`npm test`:
```
# tests 69
# suites 0
# pass 69
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`npm run test:compat`:
```
Compat summary:
name             js-roundtrip   py-original   py-roundtrip
hjlc-1.svg       ok             ok            ok
hjlc-2.svg       ok             ok            ok
sample-doc       ok             ok            ok

(python available)
```
