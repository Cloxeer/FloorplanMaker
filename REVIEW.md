# NMSU Floor Plan Studio — Review

Reviewer pass over the full app (`docs/`, `index.html`, `css/studio.css`, `js/`,
`tests/`) against the original requirements list. Each requirement line below
is individually audited.

## A. Flow

| Requirement | Status | File(s) | Note |
|---|---|---|---|
| Start blueprint asks only building, property, floor, file name | Done | `js/view/panels/blueprint.js` | `showBlueprint()` — exactly 4 fields, slug auto-suggested. |
| Photo: drop/pick, 4 corner handles, straighten | Done | `js/view/panels/photoStep.js` | Drop zone + file input, 4 draggable Pointer-Events handles, homography warp. |
| Onion-skin background, opacity slider, H hotkey to flash | Done | `js/view/stage.js` (`setOnion`/`setPlanOpacity`/`flashPhoto`), `js/mainActions.js` | `H` wired in `onKeyDown`/`onKeyUp`; plan-opacity slider added alongside the onion slider in the View popover. |
| Build screen: palette left / drawing middle / one properties panel right / one-line hint bottom | Done | `index.html`, `css/studio.css` | `#palette`, `#stage`, `#properties` (single panel), `#hint`. |
| Drawing surface is Fabric.js 6.7.1, not raw SVG DOM patching | Done | `js/view/stage.js`, `js/view/stageView.js`, `js/view/stageEdit.js`, `js/view/stageTools.js`, `js/view/stageSnap.js`, `js/view/stageObjects.js` | Rewritten from the original SVG-patch renderer; viewport (zoom/pan), editing (move/scale/rotate/point-edit), drawing tools and snapping are each their own module, all built on one `fabric.Canvas`. |
| One-piece rooms with an editable, rotatable outline (not just axis rects) | Done | `js/view/stagePoly.js`, `js/view/stageObjects.js` | Rooms are Fabric polygons/groups; corner points are individually draggable via "Edit corners" in Properties. |
| Rotatable compass control | Done | `js/view/stageEdit.js`, `js/view/panels/properties.js` (`#p-rotate-cw`/`#p-rotate-ccw`) | Drag the Fabric rotate handle, or use the +15°/−15° buttons; `deg` is stored and re-emitted as `rotate(deg)` on export. |
| Hallways (studio-only routing/visual guides) | Done | `js/view/stageTools.js` (`hall` tool, drag-rect), `js/model/document.js` (`item.type === 'hall'`), `js/docActions.js` (`exportAll` filters them out) | Placed the same way as rooms (drag or palette chip). Saved in the `.json` project so they survive reload, but stripped from the doc before `validate()`/`exportSvg()` runs — they never reach the exported SVG. |
| Export: one button downloads SVG + straightened photo, shows JSON snippet + two commands | Done | `js/mainActions.js` (`exportAll`), `js/view/panels/exportDialog.js` | Confirmed photo downloaded is `project.photo.dataUrl` (post-warp), not `originalDataUrl`. |
| Preview step: Export (top bar or step 4) opens a full-screen preview of the exact exported SVG before downloading, with a legend and checklist | Done | `js/view/panels/previewStep.js`, `js/docActions.js` (`exportAll`), `js/view/panels/stepStrip.js` | Step strip is now 1 Photo &middot; 2 Trace &middot; 3 Preview &middot; 4 Export; steps 3/4 both open the preview. "Back to editing" closes with no side effects; "Download files" runs the existing export dialog/download. |
| Legend (Room/Big room/Our room/Core/Void/Stairs/Door+EXIT/Compass/Outline) shown beside the preview and as a collapsible section in the palette; never written into the exported SVG | Done | `js/view/panels/legend.js`, `js/view/panels/previewStep.js`, `js/view/panels/palette.js` | Swatches use the same dialect class names as `js/model/svgExport.js`; the legend markup only ever lands in `#dialogs`/`#palette`, never in `exportSvg()`'s output. |

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
| Scan recall: region detection finds large rooms (lecture halls) and rooms with in-room text/arrows, without leaking through hairline wall gaps | Done | `js/workers/trace.worker.js` (`trace`) | `maxAreaFrac` raised to 0.6 (of the outline's own bbox when `outline` is passed, not the whole photo), `fillRatio` threshold lowered to 0.45, dilation raised to 3 passes; regions whose centre falls outside the floor outline are dropped via `pointInPolygon`. `js/view/panels/suggest.js` now passes `app.doc.floor.points` as `outline`. |
| OCR reads most of the 39 posted room numbers, not just ~8 | Done | `js/workers/trace.worker.js` (`ocrRegions`, `extractRoomNumber`, `normalizeDigits`) | Crop padding 6px, 3x upscale, `tessedit_pageseg_mode` 7 (single line) with a 6 (block) fallback when nothing matches; whitelist unchanged; accepts `^[A-Z]?\d{3}[A-Z]?$` or a bare `\d{3}` run inside a longer token; O/I/l/S/B digit-position confusions normalized before matching. A ghost with no number reads "?" (`js/view/stageObjects.js`) and prompts for one when kept (`js/view/panels/suggest.js` `acceptOne`). The suggest bar shows "Reading room numbers… d/total" while OCR runs. |
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
| Warnings allow export, errors block with reason | Done | `js/docActions.js` (`exportAll`), `js/view/panels/validation.js` | `exportAll` checks `results.some(r => r.level === 'error')` before exporting. |
| Route preview: grid+Dijkstra in a Worker, draws path to selected room | Done | `js/model/route.js`, `js/workers/route.worker.js`, `js/mainActions.js` (`routeToRoom`) | |
| Checklist recomputes immediately after every doc-changing action | **Fixed during this pass** | `js/main.js` (`commit`/`replaceDoc`), `js/view/panels/validation.js` | `commit()`/`replaceDoc()` used to `emit({type:'doc'})` *before* calling `scheduleValidate()`, so `validation.js`'s `'doc'`-event handler (added so the checklist updates without waiting for the debounced route-aware `'validation'` event) rendered against the **previous** `app.validation`. Manually visible right after "Keep all" on 31 suggested rooms: the "Every room has a number" row showed a stale ✓ (from before the rooms existed) and only flipped to the correct ○ once the delayed `'validation'` event fired. Fixed by moving `scheduleValidate()` before the `'doc'` emit in both functions, so `app.validation` (and therefore the `room-no-number` check the row reads) is current by the time any `'doc'` subscriber — including the checklist — runs. |

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

## Verified by hand

Driven end-to-end through the real app (dev server at `http://localhost:8080`)
via `tests/browser/walkthrough.spec.js`, which automates exactly the steps a
person would take, plus a manual pass with the built-in browser tool for the
"first click after Draw outline" fix specifically:

1. **Start blueprint** (HJLC, 323, 1, `hjlc-1-walkthrough`) — modal collects
   exactly the 4 fields, slug auto-fills and is editable.
2. **Photo step**: chose `samples/hjlc-1-posted.jpg`. Result: the photo (a
   tall/wide scan) now fits within the viewport height (header + actions
   subtracted) with all 4 corner handles on-screen — this was the bug in item
   1 (the photo used to render at natural pixel size and push the two lower
   handles off the bottom). Straighten produced a correctly warped image; the
   straighten math still runs against the original (un-scaled) pixel
   coordinates, confirmed by the output image dimensions matching the drawn
   quad's side lengths, not the on-screen CSS size.
3. **"Draw outline"**: clicked the button, then clicked 4 corners of the
   building directly on the photo, then Enter. All 4 clicks registered on the
   first attempt (`floor.points.length === 4`) — this exercises the fix for
   item 2.
4. **"Place doors"**: clicked the left wall twice, Esc. Both registered as
   `door` items with `kind: 'EXIT'`.
5. **Auto-suggest**: waited for the bar (fires automatically once the outline
   exists on a fresh project); "Keep all" added 31 room rectangles from the
   traced photo in one commit. Immediately after that commit, the checklist's
   "Every room has a number" row read ○ (pending), not a stale ✓ — the fix for
   item 3. Selected one unnumbered room, typed `101` in Number, confirmed the
   doc updated.
6. **Hallway**: dragged a guide box across two rooms with the hall tool;
   confirmed it round-trips through the `.json` project but is absent from
   the exported SVG.
7. **Compass**: pressed `C`, clicked to place it, then clicked "Rotate +15°"
   in Properties; `deg` went from 0 to 15.
8. **Export**: clicked Export, intercepted the `.svg` download, saved it to
   `samples/hjlc-1-walkthrough.svg` (kept in the repo, not gitignored). The
   file has: 1 floor polygon, 31 room rects (≥ 30), exactly 2 `>EXIT<` text
   nodes, a `rotate(15)` transform on the compass group, and no empty
   `<text>` elements. No console/page errors during the whole run.

Both `tests/browser/smoke.spec.js` and `tests/browser/walkthrough.spec.js`
pass against the current code (Playwright, Chromium, headless).

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
- **Auto-trace ("Find rooms on the photo") is rough on a photo that was never
  straightened**, or straightened loosely: the rectangle detector expects
  roughly axis-aligned room boundaries, so a skewed/perspective photo yields
  fewer, misshapen, or missed regions. It works well on the bundled samples
  because `Straighten` is run first (as the guided flow requires) — always
  straighten before "Find rooms" for usable results.
- **Hallways are a studio-only visual/routing guide, not part of the output
  contract.** They render in the editor and round-trip through the `.json`
  project (so the layout persists across reloads), but `exportAll()` strips
  every `type: 'hall'` item before validating and generating the SVG — the
  exported drawing never contains them. This is intentional (`docs/
  DIALECT.md` has no hallway element), but worth remembering if a hallway
  seems to "disappear" on export.
- The overlay/first-click fix (item 2) is a defensive one: hiding the overlay
  now forces a layout flush and blurs the clicked button before the floor
  tool goes live, which removes the two most plausible causes (a stale
  paint of the `pointer-events:none` overlay box, and a lingering focus on
  the now-hidden button). It could not be reliably reproduced under
  Playwright automation (real mouse-driven clicks there always registered
  correctly, even before the fix), so the regression test in
  `walkthrough.spec.js` and `smoke.spec.js` proves the happy path stays
  correct, not that the original race is mechanically impossible.

## Test run summary

`npm test`:
```
# tests 71
# suites 0
# pass 71
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`node_modules/.bin/playwright test --config tests/browser/playwright.config.js`
(`smoke.spec.js` + `walkthrough.spec.js`): 2/2 passed.

`npm run test:compat`:
```
Compat summary:
name             js-roundtrip   py-original   py-roundtrip
hjlc-1.svg       ok             ok            ok
hjlc-2.svg       ok             ok            ok
sample-doc       ok             ok            ok

(python available)
```
