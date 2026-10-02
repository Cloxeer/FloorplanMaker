# AutoBuild — design spec (no code yet)

A button on the Photo step. After a reference photo is loaded (and straightened),
**AutoBuild** turns it into a first-draft plan in one go: floor outline, rooms
(numbers + names), stairs, exits, elevator, voids, compass. The result lands in
Trace as ordinary, fully editable items in a **single undo step**.

> Status: **v1 built** (single photo). Sections 0-10 below are the design;
> section 11 says what was actually built, how it did on the three test
> photos, and what is still open. Accuracy numbers are only the ones in
> section 11; everything else in the doc is a target.

## 0. Ground rules

- **Free, in-browser, no account, no paid API.** Photos never leave the machine.
- Fits the existing stack: plain ES modules, no build step, libraries only from
  cdnjs / jsDelivr (version-pinned), heavy work in Workers, `js/model/*` pure,
  files under 400 lines.
- Output is the existing document model (`docs/ARCHITECTURE.md`): rooms
  (`rect`/`poly`, cls `room|core|void|ours`), `stair`, `door` (EXIT/Door),
  `compass`, `floor` polygon. Nothing new in the export dialect.
- **Honesty contract:** "perfect in one shot" is the goal, not a promise. Phone
  photos through glass have glare, blur and skew; some labels are physically
  covered by the You-Are-Here pin. So AutoBuild must (a) get everything it can
  right, (b) **know what it is unsure about and flag it**, (c) never silently
  invent. A flagged room the user fixes in 2 seconds beats a confident wrong one.

## 1. The corpus (14 photos, 8 floors)

Stored in `tests/fixtures/autobuild/` (these are the 768 px previews from the
chat; **drop the full-resolution originals next to them** — OCR quality depends
on it).

| # | File | Building / floor | Shape / notes |
|---|------|------------------|---------------|
| 01 | `01-hjlc-f1` | Hardman & Jacobs ULC, floor 1 | Portrait, framed. Dense: ~50 rooms, big named halls (Lecture Hall, Computer Lab, Classroom, Help Desk, Student Success/Upward Bound). Pin covers **128O/M132/T130**. Glare dot on Lecture Hall. Gold truth exists: `samples/hjlc-1.floorplan.json`. |
| 02 | `02-hjlc-f2` | Hardman & Jacobs ULC, floor 2 | Portrait, framed, photo slightly keystoned. 4 "Open to Below" voids, DOWN stairs, ICT Training Lab, 4 Classrooms. Gold truth: `samples/hjlc-2.floorplan.json`. |
| 03 | `03-sci-f1` | Science Hall, floor 1 | Portrait, dim, **L-shaped**, ~90 small rooms, legend in a banner on top (not left). Tiny text. Stair/elevator cluster in the middle. |
| 04 | `04-sci-f2` | Science Hall, floor 2 | Landscape, paper in sleeve (curl, glare). Mixed orientation of the building; compass bottom-right. |
| 05 | `05-sci-f3` | Science Hall, floor 3 | Landscape, **plain paper print, low contrast, perspective skew, no frame**. Courtyard ring of rooms. Compass top-right. Legend text is washed out. |
| 06 | `06-jett-b-a` | Jett Hall, basement | Landscape. Long E–W corridor, rooms 0xx. Rooms numbered **00x–01x** (leading zeros). |
| 07–11 | `07…11-jett-f1-a…e` | Jett Hall, floor 1 | **Five different posters of the same floor** — different crops, different "You Are Here" pins, and 08 is portrait. #11 is the building **rotated 180°** vs #07 (compass top-left instead of bottom-right). Includes "Jett Annex" outline, FAAP box, 3 exit-sign variants. |
| 12–14 | `12…14-jett-f2-a…c` | Jett Hall, floor 2 | Three posters of floor 2. #14 is #13 rotated 180° **with a person's reflection in the glass**. 204 and 250 have **angled walls**. |

Corpus-level lessons (these drive the design):

1. **Every poster has the same anatomy** (section 2). That is a template we can
   exploit, not a free-form drawing problem.
2. **Plan = grayscale linework. Everything non-geometry is saturated colour**
   (blue pin/arrows, red exit/extinguisher/pull-station/FAAP, maroon sidebar,
   grey-blue caption band). Colour separation removes ~all clutter for free.
3. **Orientation is not constant** (#11, #14 are rotated 180°). Never assume
   north-up; the compass sets `compass.deg`, the plan stays as photographed.
4. **Jett floors are covered by several posters each** → later we can stitch and
   cross-vote OCR (section 8).
5. **The pin hides things.** Pin is opaque blue and sits on a room (01: over
   M132/T130; 08: over 159G; 12/13: over 224/216). Occluded labels must be
   inferred from neighbours, or flagged — not guessed from noise.
6. Photo defects seen: keystone, glass glare/reflections (#1, #14), paper curl
   (#4, #5), low contrast (#5), tiny text (#3), motion softness.

## 2. Poster anatomy (what the detector can rely on)

```
┌───────────────────────────────────────────────┐
│ (Sci-1 only: legend banner on top)            │
├───────┬───────────────────────────────────────┤
│ maroon│                                       │
│ side- │          PLAN (white paper,           │
│ bar   │          black hairline walls)        │
│ with  │                                       │
│ legend│     overlays: pin, blue arrows, red   │
│ + 911 │     exit/extinguisher/pull-station,   │
│ text  │     elevator icon, FAAP/FACP, compass │
├───────┴───────────────────────────────────────┤
│ grey-blue caption: "Emergency Evacuation Plan"│
│ <Building name> (<property #>)                │
│ <street address>                              │
└───────────────────────────────────────────────┘
```

- **Caption band** gives `meta.building` and `meta.property` (e.g. "Science Hall
  (391)", "Jett Hall (189)", "Hardman and Jacobs Undergraduate Learning Center
  (323)"). It does **not** give the floor.
- **Floor** is inferred from room numbers: the dominant leading digit of numbered
  rooms (1xx → 1, 2xx → 2, 3xx → 3, 0xx → basement). The user's blueprint
  answer always wins; the inference is a cross-check ("you said floor 2 but the
  rooms look like floor 1").
- **Sidebar/banner/caption are excluded from the plan region** by colour. Legend
  text, "In Case of Emergency Call 911" and the phone number must never reach
  the room-label OCR (they would produce garbage "rooms").
- The studio draws its own legend item; AutoBuild does **not** copy the poster's.

## 3. Pipeline overview

All stages run in Workers off the main thread, each with a progress message so
the button can show "Straightening… Reading text… Finding walls… Building
rooms… Checking…".

```
S0 ingest → S1 rectify → S2 layout → S3 colour layers → S4 text → S5 walls
        → S6 faces/rooms → S7 classify → S8 exits/doors/compass → S9 assemble
        → S10 self-check loop → commit + review list
```

### S0 Ingest
- Apply EXIF orientation. Keep original; work copy ≤ 2400 px long side (the
  existing `MAX_ORIGINAL/MAX_OUTPUT`). Crucially, **OCR runs on the original
  resolution crops**, not the 2400 px copy, when the original is larger.

### S1 Rectify (reuse + automate `photoStep.js`)
- If the user already placed/adjusted the 4 corners, use them as-is.
- Otherwise auto-propose corners: largest bright quadrilateral (paper/plan
  area) via edge map → Hough lines → intersect the 4 dominant lines. Fallback:
  keep the manual handles and tell the user.
- **Refine with the plan's own geometry:** collect long near-horizontal and
  near-vertical wall segments, estimate the two vanishing points, and correct
  the residual homography so walls are orthogonal. This is what makes later
  alignment exact. Output a rectified canvas (existing `computeHomography`).
- Quality gate: if the median wall angle after refinement is > 1° off axis,
  re-run once; if still bad, warn "photo is too skewed — straighten manually".

### S2 Layout segmentation
- Find the maroon sidebar, grey-blue caption band, top legend banner by colour
  clustering (hue/sat, large connected rectangles touching the poster edge).
  Everything left = **plan region**. Output a plan mask + the caption crop.
- OCR the caption crop → building name + property number (regex
  `\((\d{3})\)`; name = line above). Prefill the blueprint if empty.

### S3 Colour layers
HSV split of the plan region:
- **Ink** (walls, text, icons-in-black): low saturation, dark. Adaptive
  threshold (local mean, as the existing `computeInkMask`) so glare patches
  don't whiten whole regions.
- **Blue layer**: pin + evacuation arrows. **Red layer**: exit signs,
  extinguishers, pull stations, FAAP/FACP boxes, elevator? (no — elevator icon
  is black).
- Inpaint the blue/red layers out of the ink image (fill with local paper
  colour) so they stop being mistaken for walls/text.
- **Do not throw the overlays away — they are signals:**
  - blue arrows trace the **corridor centrelines** → corridor hint, and a
    sanity check that corridors stay empty floor;
  - red exit signs → doors (S8);
  - the pin location → "labels near here may be hidden" (S4 occlusion rule).

### S4 Text: detect → read → validate  (the part that must be strongest)
Free engine: **Tesseract.js** (already lazy-loaded in `trace.worker.js`). It is
weak on tiny numerals, so we do not feed it the raw page; we engineer the input
and then *validate against a grammar*, with several independent chances to fix
each label.

1. **Detect text blobs without OCR first.** Connected components on the ink
   mask (after wall removal); keep components with glyph-like height (8–40 px
   at rectified scale), group by baseline/proximity into **tokens**. Remove
   anything inside the icon/legend regions. Rooms are labelled once, near the
   cell centre; names (bold caps, larger) sit above the number.
2. **Prepare each token crop:** upscale ×3–×4 (Lanczos) so x-height ≥ ~24 px,
   per-crop Otsu, light unsharp, 2 px padding. Try 2–3 thresholds.
3. **OCR single-line** (`psm 7`), whitelist `A–Z 0–9`, per token. Also run
   names with a second pass allowing lowercase for Title-Case names.
4. **Grammar validation** (hard constraints from the corpus):
   - Room number: `^(?:[RSTMJEH])?\d{3}[A-Z]?$` — prefix letters seen:
     R, S, T, M, J, E, H; stair tags `ST\d`; suffix any letter. (Existing
     `NUMBER_RE` is the same shape and must remain the final gate.)
   - **Confusion repair inside digit slots:** O/Q/D→0, I/l/|→1, S→5, B→8,
     Z→2, G→6; inside the prefix/suffix slot the reverse (0→O, 5→S).
   - **Suffix alphabet skips I and O** (observed: 128H → 128J, 128L → 128N/P),
     which kills the classic 1/I and 0/O ambiguity.
   - Name vocabulary seen: CLASSROOM, LECTURE HALL, COMPUTER LAB, HELP DESK,
     ICT, ICT TRAINING LAB, STUDENT SUCCESS/UPWARD BOUND, Open to Below, DOWN,
     UP, Jett Annex, FAAP/FACP. Fuzzy-match (edit distance ≤ 1–2) against a
     vocabulary list that grows from the corpus.
   - Leading-zero numbers (Jett basement `005`, `016`, `H001A`) are valid; do
     not strip zeros.
5. **Context repair.** Rooms come in numeric runs along corridors
   (`124 126 128 130 132 134 136 138` even numbers on one side, odd on the
   other; `128B 128C 128D …`). Use neighbours to:
   - fix a low-confidence token to the value that completes the run,
   - **fill an occluded label** (under the pin) *only* if the run makes it
     unambiguous; mark it `inferred` and flag it for review.
6. **Confidence** per label = OCR conf × grammar match × run-consistency.
   Below threshold → keep the room, leave `number` empty/flagged, never emit a
   guessed-looking value silently.
7. **Cross-check against the floor:** the digit-majority rule from section 2.
   A token whose first digit disagrees with the floor and sits in a numeric run
   that agrees is almost certainly an OCR error → repaired or flagged.

Upgrade path if Tesseract proves too weak in measurement (section 9): add a
second recogniser (a PaddleOCR-class model through ONNX Runtime Web, loaded
lazily from a CDN) and vote between engines. **Unverified:** whether a suitable
model is hosted on an allowed CDN; decide during the spike, not now.

### S5 Walls (lines) — "powerful line detection"
After S1 the plan is near-Manhattan, so lead with the cheap, precise method and
add generality on top:

1. **Axis-aligned segments** by run-length scanning along rows/columns of the
   cleaned ink mask (the idea already in `tools/lines.py`), gap-bridging ≤ ~4 px
   for dashed/anti-aliased lines, min length scaled to plan size.
2. **Oblique walls** (Jett 204/250, Science, HJLC): Hough / LSD-style detector on
   the *residual* ink (after removing axis-aligned lines and text), keeping only
   long, straight, isolated segments. Walls that are 45°±8° or other angles are
   kept as true angled walls (same rule as `rectify.js`).
3. **Double-line walls → one wall.** Exterior walls are drawn as two close
   parallel lines (or a thin grey band). Collapse pairs ≤ ~8 px apart into one
   centreline and mark it **exterior** (stroke 6) vs interior (stroke 2).
4. **Coordinate clustering = perfect alignment.** Cluster all x (and all y)
   values of vertical (horizontal) walls within ~3 px into one shared
   coordinate; snap endpoints to the intersection of the clusters they touch.
   This is what makes neighbouring rooms share exact edges with zero gaps or
   overlaps, then snap to the studio's 5-unit grid.
5. **Door gaps / T-junctions:** extend dangling ends to the nearest wall within
   a small tolerance so cells close; never extend across a gap larger than a
   door (~40 px), that would swallow a real opening.

### S6 Faces → rooms
1. Rasterise the cleaned wall graph, flood-fill the background → label image.
   Each enclosed face is a candidate room. (Replaces the existing
   `floodFillRegions` on a raw dilated mask, which merges/loses cells whenever
   a line has a hole.)
2. **Floor outline:** flood-fill "outside" from the plan-region border; the
   complement (union of all faces + corridors) is the footprint. Simplify
   (Douglas–Peucker → orthogonal snap), then run `rectify.js`. Courtyards and
   the L-shape of Science Hall come out as holes/concavities correctly.
3. **Shape fit:** face-area / bbox-area ≥ 0.92 → `rect` (integer, grid-snapped);
   else `poly` (rectilinear/angled simplified polygon). Reject sliver faces.
4. **Corridors:** large unlabelled faces with aspect ≥ 3 → not rooms; left as
   empty floor (matches the dialect: "corridors are empty floor"). Blue-arrow
   pixels inside confirm it.
5. **Label ↔ face assignment:** token centroid inside face; one number per face;
   name+number pair merged (`name`, `showName` only for the big named halls, as
   in hjlc-1/2). Face with two competing numbers → flag. Numbered face with no
   token → flag "missing label".

### S7 Classify
| Evidence | Result |
|---|---|
| Elevator pictogram (black box with ↑↓ and two figures) | `core`, name "Elevator" (the app has an elevator icon now) |
| Parallel evenly spaced treads (≥3, spacing ~18 in plan units) in a ~30–120 box, or "DOWN"/"UP" text, or `ST\d` tag | `stair`, `dir` from tread orientation |
| Text "Open to Below" inside a face | `void` (dashed + "Open to below") |
| Face with only a stair/elevator/closet look, no valid number | `core` |
| Numbered face | `room`; big named halls (Lecture Hall, Computer Lab, Classroom, Help Desk, ICT Training Lab) keep their `name` |
| Student Success / Upward Bound | name only; `ours` is **never auto-assigned** (can't be seen on a poster) |

Icon recognition uses **template matching** (multi-scale normalised
cross-correlation) with sprites cut from the corpus — elevator, exit-sign
variants (left/right/up/down-stairs), pull-station, extinguisher (horizontal and
vertical), FAAP/FACP. Colour gating (red/blue) removes most false positives.

### S8 Exits, doors, compass
- **Exit signs → `door` items** (`kind: 'EXIT'`): each red sign's centre → nearest
  point on the floor outline via the existing `doorFor()`; the sign's arrow
  direction picks the correct edge when two edges are close. The "running man
  with ↓" variant on upper floors marks a stair exit; it becomes a door only
  when it is actually on the outline, otherwise it just confirms a `stair`.
- **Compass:** find the small circle + "N" glyph (Hough circle at the expected
  radius, verify N by OCR on 4 rotations). Angle = direction from circle centre
  to the N/filled needle half. Emit `compass {x,y,deg}` at its poster position.
  Validate: the angle must agree with how the posters were rotated (#11/#14
  show ~180° relative to #07/#13).
- Pull stations, extinguishers, FAAP, arrows, pin → deliberately **ignored**
  (not modelled); they are only used as hints above.

### S9 Assemble
Create one `doc` with `createDoc(meta, viewBox)`, `setFloor`, `addItem`… and
**one** `app.commit(doc, 'AutoBuild')` so Undo removes everything at once.
Attach per-item `confidence` + `reasons` in a side structure (not exported) to
power the review list.

### S10 Self-check loop (what makes it "perfect" instead of "plausible")
1. Run `validate(doc)`; for every error code that has a deterministic fix, fix it
   (`label-outside-shape` → move label to centroid, `door-off-outline` →
   re-snap, `duplicate-number` → re-inspect the lower-confidence one).
2. **Reproject and compare:** render the built doc's walls to a raster at the
   photo's size, compute chamfer distance against the cleaned ink mask. Per-room
   score = fraction of its edges within 3 px of real ink. Edges that miss →
   re-snap to the nearest ink line within 6 px and re-score; still bad → flag.
3. **Coverage check:** every ink component of glyph size that was never
   assigned to a label/icon/overlay is listed as "unexplained text" for review.
4. **Overlap/gap check:** `polygonsOverlap` between rooms must be false;
   adjacent shared edges must have equal coordinates.
5. Loop at most 2–3 rounds; report a **score** (0–100) and the list of flagged
   items.

## 4. Review UX (small, honest)
- Progress label on the button; cancellable.
- After building: toast "AutoBuild placed 52 rooms · 6 need a look".
- "Need a look" items get a visible highlight in Trace and appear as a list
  (click → select + zoom). Reasons: *label hidden by pin (inferred 128O)*, *low
  OCR confidence*, *two numbers in one room*, *wall not found in photo*.
- Everything is normal, editable items; Onion-skin shows the photo behind for
  checking. No separate mode.
- If the photo is clearly unusable (blank, not a floor plan, too small), refuse
  with a reason instead of generating junk.

## 5. Per-photo expectations (what each one will stress)
| # | Main risk | Mitigation that matters |
|---|-----------|-------------------------|
| 01 | Pin over 128O/M132/T130; many 3-char tiny labels; large named halls with grey fill | Occlusion + run inference, colour inpaint of pin, big-hall name parse |
| 02 | 4 voids; keystone; stairs marked "DOWN" | Void text match, VP refinement, stair detector |
| 03 | ~90 small rooms, dim, tiny text, legend on top | Highest-res crops for OCR, banner excluded by colour, run repair |
| 04 | Curl + glare, rotated building | Local adaptive threshold, deskew by walls not by paper edge |
| 05 | Low contrast print, skew, no frame, washed legend | Auto-corners from paper quad, contrast normalisation (CLAHE-style) |
| 06 | Leading-zero numbers, long corridor | Do not strip zeros; floor "0/basement" mapping (open question 1) |
| 07–11 | Same floor ×5, #11 rotated 180°, Annex outline, pin differs | Orientation-agnostic pipeline, compass; later stitching (section 8) |
| 12–14 | Angled walls (204/250), reflection in #14 | Oblique-wall pass; reflection = low-sat blob removal, flag |

## 6. Where it plugs into the code
- `js/view/panels/photoStep.js`: add the **AutoBuild** button next to the
  existing controls (enabled once a photo is loaded).
- New: `js/workers/autobuild.worker.js` (orchestrates stages; imports pure
  modules), `js/model/autobuild/*.js` (pure: colour layers, lines, clustering,
  faces, grammar/context repair, assemble). Pure modules are unit-tested in
  Node with synthetic rasters — same pattern as `tests/rectify.test.js`.
- Reuse, don't rewrite: `rectify.js`, `geometry.js`, `document.js` (`doorFor`,
  `makeRoom`, `nextNumber`), `validate.js`, Tesseract loader in
  `trace.worker.js`.
- Existing "Suggest rooms" stays; AutoBuild supersedes it for full builds.
- Heavier libs only if measurement demands (OpenCV.js from jsDelivr is the
  candidate for LSD/Hough/CLAHE; it is large, so lazy-load and only if the
  hand-written JS is not enough). Decision belongs to the spike, not this spec.

## 7. Risks and how we stay honest
- **OCR on glass-covered, phone-shot, 8 px text is the hard limit.** Mitigation
  is grammar + run repair + resolution + flagging; the ceiling is set by input
  quality. Tell the user to shoot straight-on, no flash, high resolution.
- **Over-merging / under-splitting rooms** where a wall line has a hole. Mitigated
  by gap bridging + reprojection check, but this is the most likely failure.
- **Perspective not fully removed** → everything drifts. The VP refinement and
  the median-angle gate are the guard.
- **Overlays touching walls** (arrows crossing doors, extinguishers on walls):
  colour inpainting can nick a wall; wall pass tolerates ≤ 6 px breaks.
- **Never auto-guess** `ours`, floor number conflicts, or occluded numbers
  without a flag.

## 8. Roadmap
1. **v1 – single photo AutoBuild** (this document, sections 3–6).
2. **v1.1 – multi-photo, same floor** (Jett f1 ×5, f2 ×3): match shared room
   numbers between photos (they are natural anchors), solve similarity
   transform (rotation incl. 180°, scale, translation) with RANSAC on ≥2 shared
   numbers, merge geometry, and **vote OCR** across photos — the same room is
   read 2–3 times, which is the biggest free accuracy gain available.
3. **v1.2 – learn from corrections:** every manual fix after AutoBuild is a
   labelled example; keep the vocabulary list and per-poster-template
   parameters (colour thresholds, sidebar position) in a small JSON the app
   improves over time.

## 9. How we "train" and prove it (no ML training required)
There is nothing to train in the neural-net sense; the "training" is **tuning
thresholds and vocabularies against a gold set**, scored automatically.

- **Gold files:** `samples/hjlc-1.floorplan.json`, `samples/hjlc-2.floorplan.json`
  exist already. For the other 12 photos, build gold once in the studio and
  export the `.floorplan.json` into `tests/fixtures/autobuild/gold/` (the
  fastest route: run AutoBuild, fix what is wrong, save — that fix *is* the gold).
- **Harness (`tools/autobuild-eval.mjs`)**, headless Playwright + Node, prints
  per photo and overall:
  - room **match rate** (IoU ≥ 0.9 between predicted and gold face),
  - **number accuracy** (exact string match on matched rooms),
  - **edge error** in plan units (median/p95),
  - false-positive rooms, missed rooms,
  - stairs/doors/voids/compass precision-recall, compass angle error,
  - floor-outline IoU, runtime, and the number of items flagged.
- **Acceptance targets (v1, clean photo):** floor IoU ≥ 0.98; ≥ 95 % rooms
  matched; ≥ 90 % numbers exact, and **every wrong number is flagged**;
  edge error p95 ≤ 4 units; no overlapping rooms; runtime ≤ 20 s for a 2400 px
  photo. "Hard" photos (03, 05) get relaxed targets, and the harness reports
  them separately.
- Leave-one-out discipline: tune on some posters, check on others (e.g. tune on
  Jett, verify on Science) so we do not overfit these 14 photos.

## 10. Build order when we start coding
1. Harness + gold set + metrics (so every later step is measurable).
2. S1–S3: rectify + layout + colour layers (testable visually, cheap).
3. S5–S6: walls → faces → floor + rooms (geometry only, no text) → score.
4. S4: text detect/OCR/grammar/context repair → numbers score.
5. S7–S8: classify, exits, compass.
6. S9–S10 + review UX + the button.
7. Hard photos (03–05), then multi-photo stitching (v1.1).

## Open questions for the owner
1. **Basement numbering:** should Jett's `0xx` floor map to `meta.floor = 0`, `-1`, or
   stay "B"? (Floor is numeric today.)
2. **Jett has several posters per floor** — OK to defer stitching to v1.1, or
   do you need it in v1?
3. **Gold truth:** are you OK hand-fixing AutoBuild output for the 12 photos
   without gold, once, to create it?
4. **Hallway items:** the studio has an optional `hall` visual. Emit them from the
   blue-arrow corridors, or leave corridors as empty floor (the dialect default)?
5. **Originals:** can you add the full-resolution photos? 768 px previews are
   enough to design with, not to measure OCR on.

## 11. What was built (v1) and how it did

Code: `js/model/autobuild/*` (pure: rectify, layers, faces, text, symbols,
shapes, pipeline), `js/workers/autobuild.worker.js`, `js/view/panels/autobuild.js`
(button logic, progress bar, build animation, "to double-check" list), tests in
`tests/autobuild.test.js`. Existing files touched, additively: `photoStep.js`
(the AutoBuild button) and `mainActions.js` (mount + one call after the studio
opens). Nothing else in the original app changed.

How it works in the app: Photo step -> **AutoBuild** -> the photo is straightened
from the plan's own walls (rotation + keystone, no corner dragging; if you moved
the corners yourself, those win) -> the studio opens and builds the plan in front
of you with a progress bar (outline, hallways, rooms, stairs, elevator, exits)
-> one undo step; rooms it is unsure about are listed to click through.

Method changes versus the design, found while testing on the photos:
- Straightening uses wall tilt measured in bands/strips + a fitted homography,
  not paper corners (paper edges were unreliable: frames, cut-off posters).
- Walls are hysteresis-thresholded ink (faint hairlines count when attached to
  strong ones); the building outline is a large closing + hole fill.
- Rooms are faces of the wall raster, found at several gap-closing sizes: a face
  whose labels sit side by side is two rooms joined by a wall gap, so it is
  retried with wider closing. Open-plan rooms are grown from their text until
  they meet walls.
- Numbers: 4 renderings x Tesseract, voted through the room-number grammar,
  duplicates resolved, odd leading digit flagged.

Results (768-1024 px previews from the chat; the HJLC floor 1 photo in `samples/`
is 1500x2000):

| Photo | Rooms drawn | Numbers read right | Notes |
|---|---|---|---|
| Jett basement (873 px plan) | 19 of ~22 | 11 of 13 numbered | R001, H001A, J003, T005, M002, 017A left blank/flagged; M017B read as "114" (flagged) |
| HJLC floor 1 (1500x2000 photo) | ~46 | most of the ~40 legible ones (all the top-row 128x, R/J/S/T tags) | Open-plan Computer Lab / Lecture Hall are approximations; pin hides M132/T130/128O (flagged); Classroom 126 not enclosed in the photo |
| Science Hall floor 1 (768x1024 photo) | ~81 | 1 of ~90 | Geometry is good (L-shaped outline, aligned rooms, doors, halls) but the digits are ~5 px tall, below what Tesseract can read. A full-resolution photo is needed |

Known limits / open items:
- Digits under ~8 px tall cannot be read: use the original full-resolution photo.
- Compass: only placed when a ring plus an "N" are found (it was wrong too often
  otherwise); restrooms, voids ("Open to Below") and staff walls are not printed
  on these three posters, so they are not detected yet (void text matching and
  restroom words are in the vocabulary, untested on a real poster).
- Legend item is not placed automatically.
- Existing app issue (not changed): re-entering the studio for an already-open
  project (Change photo -> Flatten, or opening `#/p/<slug>/photo` directly) throws
  "fabric: canvas already initialized" in `enterStudio`; AutoBuild is meant for
  the first photo of a new project, where it works.

### 11b. Second pass (scale, edge-sealing, adaptivity)

- **One scale for every plan:** after the build the plan and photo are resized so the
  median room's short side is about 100 plan units (`opts.targetRoom`), so rooms are never
  cramped and floors of different buildings come out at the same scale.
- **Plans cut off by the paper edge** (Hardman & Jacobs Classroom 126) are closed along the
  paper edge between wall ends, so those rooms are found.
- **Outline** is always rectilinear (thin attachments such as the compass are cut off first).
- **Small cells** that hold text (S122, T106) are rooms; walled-in cells whose text cannot be
  read are blank rooms flagged for review. A number that breaks the floor's own pattern and
  was not read firmly is left blank (the guess is shown in the review note).
- **Nothing is invented:** only existing components are emitted (room/core/void, hall, stair,
  door, compass); filling numbers from neighbours is off by default (`profile.inferRuns`).
- **Adaptive:** `profile` object (`opts.profile`), number-format inference from the plan's own
  numbers (B-104, 2105, ENG 101 ...), adaptive ink thresholds (faint, thick, double-line,
  inverted, tinted prints), green exit signs, compass found with needle + "N".
- **Tools:** `tools/autobuild-eval.mjs` scores the fixtures (see its header for env vars);
  tests are `tests/autobuild*.test.js`.
- Current harness numbers (with OCR): Jett 12/20 numbers right (precision 0.8), Hardman &
  Jacobs 42/50 (precision 0.93), Science Hall geometry only (digits too small).
