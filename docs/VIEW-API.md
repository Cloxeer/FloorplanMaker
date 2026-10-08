# View-layer API (what main.js wires together)

All view modules are ES modules that receive the shared `app` object. Nothing
in `js/model` touches the DOM; everything in `js/view` may.

## `app` (created in js/main.js)

```js
app = {
  project,            // project record (see ARCHITECTURE.md) or null on the start screen
  doc,                // current document (immutable snapshots)
  selection: Set,     // item ids
  tool,               // current tool object
  toolName,           // 'select' | 'room' | 'poly' | 'floor' | 'door' | 'stair' | 'compass' | 'pan'
  magnet: true,       // Alt held -> temporarily false (main.js tracks the key)
  gridOn: true,
  onion: 0.5,         // photo opacity 0..1
  canvas,             // canvas object (see below)
  validation: [],     // last validate() results (+ room-unreachable warnings from the route worker)
  clipboard: null,

  commit(newDoc, label)        // push undo snapshot, set app.doc, emit 'doc', autosave
  replaceDoc(newDoc)           // no undo entry (used by undo/redo/import)
  undo() / redo()
  setSelection(ids)            // emits 'selection'
  setTool(name)                // cancels current tool, emits 'tool', updates hint
  setHint(text)                // bottom one-line hint
  snap(pt, opts)               // -> {x,y,guides}; applies magnet+grid using geometry.magnetSnap; opts: { ignoreIds:Set, box:{x,y,w,h} }
                               // also calls canvas.setGuides(guides). Returns pt unchanged when app.magnet is false and grid off.
  prompt(title, defaultValue)  // -> Promise<string|null>; small inline dialog (number entry). Enter confirms, Esc cancels.
  confirm(text)                // -> Promise<boolean>
  toast(text)                  // transient message
  subscribe(fn)                // fn(evt) with evt.type in 'doc'|'selection'|'tool'|'view'|'saved'|'validation'|'project'|'route'; returns unsubscribe
  duplicateInRow(id)           // clone room flush against the previous one (to the right, or below if it would leave the floor bbox), ask for the number (auto-incremented), commit
  copy() / paste()             // multi-selection with relative layout; paste offers auto-increment via app.confirm
  routeToRoom(id)              // asks the route worker; emits 'route' with {roomId, reachable, path}; canvas.setRoutePath
  exportAll()                  // runs validate; if errors -> shows the validation panel and refuses; else downloads svg+jpg and shows the export dialog
  openProject(project) / closeProject()
}
```

## `stage.js` (the Fabric.js drawing surface)

`app.canvas` is the stage object returned by
`createStage(containerEl, app)` (`containerEl` is `#stage`, which holds
`<canvas id="canvas">`). It is built on Fabric.js 6.7.1, pinned:

```js
import * as fabric from 'https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs';
```

```js
createStage(containerEl, app) -> stage
stage.setDoc(doc)                  // diff by item id + identity; rebuild only what changed
stage.setSelection(ids)            // ids are item ids, or 'floor'; round-trips with app.setSelection
stage.setPhoto(photo|null)         // onion skin as canvas.backgroundImage (async)
stage.setOnion(op) / flashPhoto(on)
stage.setPlanOpacity(op)           // opacity on every item object
stage.setGrid(on)                  // cached 20-unit pattern rect behind everything
stage.setGuides([{axis,at}])       // magnet guide lines drawn during a drag
stage.setGhosts([{x,y,w,h,number,index}])  // clicking one fires window 'ghost-accept' {index}
stage.setRoutePath([[x,y]...])     // orange polyline + arrowhead
stage.dropPiece(key, clientX, clientY, alt) // palette chip drop (snapped exactly like previewDrop)
stage.previewDrop(key, clientX, clientY, alt) // while a chip is dragged: draws the guides, returns where the piece will sit {x,y} in client px, or null off the plan
stage.endPreviewDrop()                     // clears those guides
stage.toPlan(clientX, clientY) -> {x,y}
stage.zoomTo(fit=true) / getView() -> {x,y,w,h,zoom} / setView({x,y,zoom})
stage.destroy()
stage.fabricCanvas                 // escape hatch, used only by tests/browser/perf.spec.js
```

There is no `patchNode` / `patchLabel` / `patchItem` / `hitTest` / `onPointer`
and there are no tool modules: Fabric does selection, dragging, scaling,
rotation, marquee selection and hit-testing, and the stage turns the finished
transform into a single `app.commit`.

### Object mapping

| item | Fabric object |
|---|---|
| room, `shape:'rect'` | `Group([Rect, FabricText])` — box and number are one object, rotation locked, `mtr` control hidden; `object:modified` converts scale into integer `w`/`h` snapped to the 5-unit grid |
| room, `shape:'poly'` | `Polygon` with one round control per vertex (`polygonPositionHandler` / `anchorWrapper` / `actionHandler`), scaling and rotation locked, plus a companion label `FabricText` |
| floor | `Polygon`, class `floor` look, always at the back, movement locked, vertex controls, edge hover dot, double-click an edge inserts a vertex |
| hall | grey `Group([Rect, "Hallway"])`, below rooms, exported as grey `.hall` corridors |
| stair | `Group([core Rect, tread Lines, label?])`, rotation locked ("Rotate" in properties flips `dir`) |
| door | `Group([white Line, "EXIT" text])`, fully locked but selectable and deletable |
| compass | `Group` drawn like the export, movable and rotatable with Fabric's rotate control (`snapAngle: 1`; `object:modified` writes `deg`) |
| ghosts / guides / route | overlay objects, `selectable:false` (ghosts stay `evented`) |

### Tools (`stageTools.js`)

`app._tools` holds `{ name, hint, onKey(e), cancel() }` stubs for
`select | floor | door | hall | room | poly | stair | compass | pan`;
`app.setTool(name)` still drives them. 'select' is plain Fabric behaviour
(including marquee selection); the drawing tools set `skipTargetFind` and a
crosshair cursor, Esc returns to select, Enter closes the outline.

### Snapping (`stageSnap.js`)

`object:moving` / `object:scaling` snap the moving box's edges and centre to
other items' edges/centres and the outline's vertices (within 5 screen px) and
to walls (6 px); the 5-unit grid pulls only from inside 3 screen px (or half a
square when zoomed out, where that is smaller). All distances are in screen
pixels, so a drag feels the same at every zoom and follows the pointer instead
of hopping a grid square at a time. Guides are drawn during the drag (only when
they change) and Alt disables magnets. A press must travel 3 px before it is a
drag (`stageEdit.js` `DRAG_PX`); a drag that ends where it began commits nothing
(no undo step) and the object is rebuilt exactly. A commit rounds to whole plan
units: the live snapping already placed the object. Targets are collected once
per drag and cached, so a move stays cheap on a 2,000-room plan (see
`tests/browser/perf.spec.js`).

### Navigation: the scroll wheel (`stageView.js`, `wheelIntent.js`)

`app.navMode` (View > Navigation, remembered in `localStorage` as `fp.navMode`) is Lucid's
navigation mode:

* `'mouse'` (default): a straight up / down wheel event ALWAYS zooms about the pointer, whatever the mouse
  sends (any pixel size, hi-res free-spin, smooth-scroll drivers, lines mode); small events zoom
  proportionally, a notch is a 10% step, and the zoom glides (`createZoomSmoother`). Sideways scroll
  (a trackpad, a tilt wheel, Shift + wheel) moves the map; Ctrl / pinch zooms. The first two-direction
  scroll shows a one-time toast that says where to switch to Trackpad.
* `'trackpad'`: the classifier reads the stream: a two-finger drag moves the map (axis-locked, no OS
  momentum), a lone wheel notch (`wheelDeltaY` a whole number of 120s, so display scaling and page zoom
  do not matter) or a pinch zooms.

The Preview step follows the same setting. The zoom range is 2% to 800%.

Holding Space, the hand tool and the wheel button all grab the map the same way: the press is taken
before Fabric sees it, so nothing under the pointer moves and the selection stays.

### Hit-testing the outline

The outline polygon is filled but only its wall counts as "under the pointer"
(`stagePoly.wallOnlyHit`, read through the stage's `_pointIsInObjectSelectionArea`
hook), and only its wall counts for Fabric's selection box. A drag that starts in
the empty floor is therefore a selection box, and clicking the wall selects the
outline.

### Drawn boxes

A room / stair box stays on the plan (dashed) until the piece exists - a room asks
for its number first - and the room and stair tools hand back to Select when the
piece is placed (door and hallway stay armed to repeat). The same goes for a
dropped chip: its box stays while the number is asked for.

## Panels (`js/view/panels/*.js`)

Each: `mountXxx(containerEl, app) -> { update(evt), destroy() }` and subscribes via `app.subscribe`.

* `palette.js`: four guided steps in order - "1. Outline the building",
  "2. Add doors", "3. Add hallways", "4. Add rooms". Steps 2-4 (and the chips)
  are greyed out with the title "Draw the outline first" until a floor exists.
  Dragging a chip onto the stage (Pointer Events, works on touch) calls
  `app.canvas.dropPiece(key, clientX, clientY, alt)`, which places the piece at the
  pointer with the standard size from `STD.palette`, snapped; rooms prompt for
  the number. While the chip is dragged over the plan the picture sits where
  the piece will land (`previewDrop`) and the guide lines show.
* `properties.js`: for the selection: number, name, class (radio 1-5), show name
  toggle, font-size override (auto / 24 / 19 / custom), label "Re-center" (un-pin,
  shows a pin icon when pinned), section dropdown, door kind toggle EXIT/Door,
  stair direction, compass rotation, x/y/w/h numeric fields, plus align buttons
  when 2+ selected: left, right, top, bottom, center-h, center-v, distribute-h,
  distribute-v, match width, match height, square up. Floor selected: point count
  and "Remove outline".
* `validation.js`: list of problems; click -> select item and center it; shows
  counts; errors block export (export button disabled with reason).
* `projects.js`: start screen: list of projects (open, delete, duplicate), "Start
  blueprint" button, "Open .json project" file input.
* `blueprint.js`: `showBlueprint() -> Promise<{building, property, floor, slug}|null>` modal with 4 fields, slug auto-suggested (e.g. hjlc-1), validation.
* `photoStep.js`: `mountPhotoStep(containerEl, { onDone(photo), onSkip() })`. Drop zone / file input, shows image on a `<canvas>`, four draggable corner handles (Pointer Events), "Straighten" computes a homography from the 4 corners to an axis-aligned rect whose size is the average of the quad's side lengths (rounded), warps by inverse mapping per pixel (nearest neighbour is fine), produces JPEG dataUrl (quality 0.85), returns `{dataUrl, width, height, corners, originalDataUrl}`. Corners default to 5% inset.
* `suggest.js`: "Suggest rooms" button: sends the photo pixels to trace.worker, shows ghosts via canvas.setGhosts, then runs OCR on the regions (progress bar), fills numbers; "Accept all" / click one to accept / "Dismiss". Accepted ghosts become rect rooms (class room) via app.commit. Nothing enters the doc until accepted.
* `exportDialog.js`: `showExportDialog(app, {svgText, jpgDataUrl, meta})` downloads `<slug>.svg` and `<slug>-posted.jpg`, shows the JSON snippet and the two commands with copy buttons.

## index.html ids

`#start` (projects screen), `#photo-step`, `#studio` (the build screen),
`#topbar` (project name, undo/redo, View popover with the onion slider `#onion`,
plan opacity `#plan-opacity`, grid and "Find rooms on the photo" `#btn-suggest`,
Save .json, Export, saved chip `#saved-chip`), `#palette`, `#stage` containing
`<canvas id="canvas">`, `#props`, `#validation`, `#hint`, `#dialogs`.
Screens toggled with the `hidden` attribute.
