# Floor Plan Studio

A free, browser-only tool for tracing phone photos of evacuation maps
into floor-plan SVG files. No sign-up, no server, no install, no build step.

## Libraries

Only two, both version-pinned from a CDN, both loaded straight by the browser:

* **[Fabric.js](http://fabricjs.com/) 6.7.1** from jsDelivr
  (`https://cdn.jsdelivr.net/npm/fabric@6.7.1/dist/index.min.mjs`) — the canvas
  interaction layer behind the drawing stage: selection, move/scale/rotate
  controls, groups, per-vertex polygon controls, zoom and panning.
* **Tesseract.js** (lazy, in a Worker) for reading room numbers off the photo.

## Open it

Any static file server works (ES modules need `http://`, not `file://`):

```bash
npx --yes serve -l 8080 .
```

Then open <http://localhost:8080/>. On GitHub Pages just publish the repo root.

## The flow

The top bar's step strip tracks four steps: **1 Photo &middot; 2 Trace &middot; 3 Preview &middot; 4 Export**.

1. **Start blueprint.** Building name, Property number, floor number, file name (e.g. `hjlc-1`).
2. **Flatten the photo.** Drop the photo, drag the four corners onto the map's corners, press *Flatten*. The photo becomes the onion-skin background (opacity slider, hold **H** to flash it).
3. **Build.** Palette on the left (four guided steps: outline, doors and stairs, hallways, rooms — step 2 unlocks once the outline exists, step 3 once there is at least one door or stair, step 4 once there is at least one hallway, plus a collapsible *Legend* at the bottom), Fabric.js drawing stage in the middle, properties on the right, a one-line hint at the bottom. Hallways are studio-only guides and are never exported.
4. **Preview.** Clicking *Export* (top bar or step 4) opens a full-screen Preview first: the exact SVG that will be exported, rendered on white next to a legend and the checklist. *Back to editing* returns to the plan with no changes; *Download files* runs the download.
5. **Export.** Downloads `<slug>.svg` and `<slug>-posted.jpg` and shows the `building-extras.json` snippet plus the two commands to run.

Everything autosaves to IndexedDB (and on pointer-up, tab hide and page close).
*Save .json* writes a single project file with the photo embedded so it can be
moved or committed.

### Where files are saved

If your browser supports it, you can pick a local folder (from the start
screen, or the modal offered when you start a blueprint). Once a folder is
set, every save writes one `<slug>.floorplan.json` per plan into it &mdash;
atomically (via a temp file and rename) on every change, with undo history
included &mdash; alongside the IndexedDB copy. Browsers without folder access
(File System Access API) fall back to browser storage only; use *Save* to
download a copy by hand.

## Hotkeys

| Key | Action |
|---|---|
| V / R / F / O / A / S / C | Select / Room / Outline / Door / Hallway / Stair / Compass |
| D | Duplicate selected room in a row (auto-increments the number) |
| 1–5 | Room class: room, big, ours, core, void |
| G | Toggle grid |
| H (hold) | Flash the photo |
| Alt (hold) | Disable magnet snapping |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | Undo / Redo |
| Ctrl+C / Ctrl+V | Copy / Paste (keeps layout, offers auto-increment) |
| Delete, arrows, Esc, Enter | Delete, nudge, cancel, confirm |

## Output

The SVG dialect is documented in [docs/DIALECT.md](docs/DIALECT.md). The
module layout and contracts are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and [docs/VIEW-API.md](docs/VIEW-API.md).

## Tests

```bash
npm test
```

```bash
npm run test:compat
```

`npm test` runs the Node unit tests (geometry, every validation rule,
export/import round trips on synthetic docs and the traced HJLC fixtures, route
finding, a 300-room stress test). `test:compat` reads the exported fixtures with
a JS and a Python port of the the map site's tools/build_rooms.py parser rules and diffs the result.
Browser steps are in `tests/MANUAL.md`. `tests/browser/` holds a Playwright
smoke test (the whole outline -> doors -> hallway -> room -> compass -> reload
-> export flow) and a drag-performance test (2,000 rooms):

```bash
node_modules/.bin/playwright test --config tests/browser/playwright.config.js
```

## Pieces

Palette chips render as small live previews using the same look as the exported
plan: Room (grey box, number), Small room (smaller grey box), Big room (larger
bluish box, "Classroom"), Our room (pink box), Restroom core (grey box, "WC"),
Elevator core (grey box, up/down arrow), Stair block (grey box with 4 tread
lines), Door (wall line with a white gap and green "EXIT"), Void (hatched/
dashed grey box), Compass (the compass rose). Dragging a chip shows the same
SVG as the floating ghost, scaled to the current plan zoom.

## License

MIT, see [LICENSE](LICENSE).
