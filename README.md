# NMSU Floor Plan Studio

A free, browser-only tool for tracing phone photos of the evacuation maps posted
in NMSU buildings into floor-plan SVG files that drop straight into the
BetterNMSUMaps repo. No sign-up, no server, no install, no build step.

## Open it

Any static file server works (ES modules need `http://`, not `file://`):

```bash
npx --yes serve -l 8080 .
```

Then open <http://localhost:8080/>. On GitHub Pages just publish the repo root.

## The flow

1. **Start blueprint.** Building name, NMSU property number, floor number, file name (e.g. `hjlc-1`).
2. **Add the reference photo.** Drop the photo, drag the four corners onto the map's corners, press *Straighten*. The photo becomes the onion-skin background (opacity slider, hold **H** to flash it).
3. **Build.** Palette on the left, drawing in the middle, properties on the right, a one-line hint at the bottom.
4. **Export.** Downloads `<slug>.svg` and `<slug>-posted.jpg` and shows the `building-extras.json` snippet plus the two commands to run.

Everything autosaves to IndexedDB (and on pointer-up, tab hide and page close).
*Save .json* writes a single project file with the photo embedded so it can be
moved or committed.

## Hotkeys

| Key | Action |
|---|---|
| V / R / P / F / O / S | Select / Room / Polygon room / Outline / Door / Stair |
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
a JS and a Python port of the BetterNMSUMaps parser rules and diffs the result.
Browser steps are in `tests/MANUAL.md`; a Playwright smoke test lives in
`tests/browser/` if Playwright is installed.

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
