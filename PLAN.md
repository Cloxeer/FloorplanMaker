# PLAN — Internal hardening (no UI / UX / functionality change)

Goal: make Floor Plan Studio **lighter on the user's CPU and disk, faster, and
easier to maintain**, while keeping the pixels, the flow, and every feature
exactly as they are today. Every phase is independently shippable and reverted
by `git revert` alone.

Phases 0–4 are strictly behavior-preserving. **Phase 5 is the one deliberate
UX change** (mandatory folder) and is gated on explicit owner sign-off — see the
callout there.

---

## The invariants (must hold after EVERY step)

These are checked mechanically after each step. If any fails, the step is not
done.

- **INV-1 No UI change.** No edit to `index.html` structure/text/attributes that
  a user can see, and no edit to `css/studio.css` that changes layout, color,
  spacing, or animation. (Renaming an internal `id` is allowed ONLY once
  `js/ui/dom.js` exists and every reference moves with it — see Phase 2.)
- **INV-2 No UX change.** Same screens, same routes (`#/projects`, `#/new`,
  `#/p/<slug>/{photo,trace,preview,export}`), same hotkeys, same click paths,
  same wording of toasts/hints/dialogs. (Phase 5 is the sole, flagged exception.)
- **INV-3 No functionality change.** Every `app.*` public method keeps its name
  and signature. Import/export bytes are unchanged.
- **INV-4 Output is byte-identical.** `tools/check.mjs` reports `idempotent true`
  and `byte-identical true` for both fixtures, before and after.
- **INV-5 All tests green.** `npm test` and the Playwright suite pass.

### Verify-invariants command (run after every step)

```bash
npm test && node tools/check.mjs tests/fixtures/hjlc-1.svg tests/fixtures/hjlc-2.svg && npx playwright test tests/browser
```

A step is "done" only when that line is clean AND `git diff` touches no
user-visible HTML/CSS (INV-1) — confirmed by the reviewer subagent (see
"Controlled loop" below).

---

## How to execute this plan (loop + subagents)

Work one checkbox at a time. For each step run this **controlled loop**:

1. **Snapshot.** Capture the baseline once at the start of the phase:
   `npm test`, `tools/check.mjs` output, and (Phase 3+) a perf number from
   `tests/browser/perf.spec.js`. Save to `test-results/baseline-<phase>.txt`.
2. **Implement** the single step. Keep the diff minimal.
3. **Verify** with the invariants command above.
4. **Review** — spawn a subagent to audit the diff against INV-1..INV-5 (prompt
   below). If it reports any user-visible or behavioral delta, revert and redo.
5. **Commit** the step alone, with the checkbox ticked in this file.
6. Repeat for the next checkbox. **Do not batch steps into one commit.**

Stop conditions for the loop: a step fails verification twice in a row → stop and
escalate to the owner; do not "force" a green by editing tests.

### Subagent roles

- **Explore agent** (read-only) — before Phase 2/4, map every call site of a
  symbol being moved (e.g. all `getElementById` literals, all `app._*` uses) so
  nothing is missed. It returns the list; you keep the conclusion.
- **Reviewer agent** — after each step, give it the `git diff` and this prompt:
  > "Confirm this diff changes NO user-visible HTML, NO CSS affecting layout/
  > color/spacing/animation, NO route/hotkey/toast wording, and NO public `app.*`
  > signature. List any violation with file:line, else reply CLEAN."
- Run independent read-only explorations in parallel (one message, multiple
  agents). Never parallelize edits to the same file.

---

## Phase 0 — Safety net (add first; pure additions, zero refactor)

You cannot safely simplify without proof that behavior held. These add tests and
gates only.

- [ ] **0.1 Golden round-trip snapshot.** Freeze `exportSvg` output for each
  `samples/*.floorplan.json` and each `tests/fixtures/*.svg` into
  `tests/fixtures/golden/`. New test asserts current export === golden, and that
  `import(export(x)) === export(x)` (idempotence). This is the rope for every
  later phase.
  Verify: `npm test`
- [ ] **0.2 Model-purity lint gate.** Add ESLint `no-restricted-imports` so
  `js/model/**` may not import `js/view/**` or reference `window`/`document`, and
  `js/view/**` may not import from a sibling panel's internal geometry. Expect it
  to FAIL initially (it will flag `docActions.js`→`legend.js` and the geometry in
  `previewStep.js`) — that failure is the Phase-4 to-do list. Wire `npm run lint`
  and leave the known violations documented, not silenced.
  Verify: `npm run lint` (records current violations)
- [ ] **0.3 Doc-drift check.** Extend `tools/check.mjs` (or a new
  `tools/arch-check.mjs`) to assert every `js/**/*.js` file is listed in
  `docs/ARCHITECTURE.md` and to print any file over the stated line budget. Make
  it exit non-zero on drift so the doc can never silently rot again.
  Verify: `node tools/arch-check.mjs`

Exit gate for Phase 0: `npm test` green, golden snapshots committed, lint + arch
checks runnable in CI.

---

## Phase 1 — Storage efficiency (lighter on the hard drive)

Behavior identical; the bytes we persist get smaller and cheaper.

> **DONE 2026-09-24 — write de-duplication (fully invisible).** The persistence
> layer rewrote the entire project blob (including the immutable multi-MB
> straightened photo) on *every* save trigger — including plain clicks, since
> `pointerup → scheduleSaveView → saveProject` fires on every mouse release.
> Added a content signature (`projectSignature` in `autosave.js`, unit-tested in
> `tests/storage.test.js`) so both the IndexedDB write (`autosave.js`) and the
> folder `.floorplan.json` write (`folderStore.js`) skip the physical write when
> nothing that gets stored has changed. All observable effects are preserved —
> the "Saved" chip still advances and the cross-tab broadcast still fires on the
> skip path; only the disk/IDB write is skipped. `saveNow` (close / tab-hide)
> always forces a real write, so nothing can be lost. Verified end-to-end in a
> real browser: photo round-trips intact, no-op saves skip, real edits + forced
> saves write, delete clears the cache. Also `unref()`'d the BroadcastChannel so
> the module can be imported in Node tests without hanging (no-op in browsers).
>
> **Deliberately NOT done under the "no functional-logic change" constraint:**
> 1.1 (cap undo history) changes undo depth = a functional/UX change; 1.3
> (shrink/dedup the photo) changes re-straighten fidelity = functional. Both
> remain below, gated on explicit sign-off. The one remaining pure-storage win
> still open: panning/zooming a photo project still rewrites the whole blob
> because photo + view share one record — separating them changes the on-disk
> file format (a "user files" change) and so needs its own decision.

- [ ] **1.1 Cap undo history.** `main.js` pushes unbounded
  `JSON.stringify(app.doc)` per commit. Add a constant limit (default 100) and
  drop the oldest past entries beyond it; same for redo. Users never notice; a
  long session stops growing without bound in memory AND on disk (history is
  saved with the project). Verify with a stress test that edits 200+ times and
  asserts `history.past.length <= 100` and undo still works to the cap.
  Verify: invariants command + new history-cap test.
- [ ] **1.2 Don't persist redo/undo you don't need to keep.** Confirm whether
  `history` is written to IndexedDB/folder on every autosave. If so, save it
  throttled or trimmed (keep the cap from 1.1). Do NOT change in-session undo
  depth beyond the cap. Measure `saveProject` payload size before/after on a real
  sample.
  Verify: invariants command + before/after byte size logged to
  `test-results/`.
- [ ] **1.3 Photo storage audit.** The straightened photo is stored as a
  data URL in the project. Confirm we store ONE copy at the resolution actually
  used (`viewBox`), not both a full-res original and a warp at oversized
  dimensions unnecessarily. If `originalDataUrl` is retained only for
  re-straightening, verify it isn't duplicated on every save. No visual change —
  same displayed photo. This is the single biggest disk win.
  Verify: invariants command + saved-project size on a real photo project,
  before/after.

Exit gate: measurable drop in saved-project size on `samples/hjlc-1`, identical
render, all invariants green.

---

## Phase 2 — DOM coupling in one place (maintainability, invisible)

- [ ] **2.1 `js/ui/dom.js` registry.** One module maps friendly names → element
  lookups, replacing the ~40 scattered `document.getElementById('...')` literals
  in `main.js` / `mainActions.js` / panels. IDs in `index.html` stay identical
  (INV-1). Now a future rename breaks in one place, not silently.
  Use the Explore agent first to list every literal.
  Verify: invariants command; reviewer confirms `index.html` untouched.

---

## Phase 3 — Rendering performance (lighter on CPU)

- [ ] **3.1 Replace the ">50 item count" full-rebuild heuristic** in `stage.js`
  with a real per-item dirty diff using the existing `itemId → fabric object`
  map (compare identity/shape/geometry; rebuild only changed objects). Removes a
  magic number and makes large edits cheaper. Perf spec must not regress.
  Verify: invariants command + `perf.spec.js` number ≤ baseline.
- [ ] **3.2 Debounce/measure route revalidation.** Confirm
  `scheduleRouteValidation` coalesces bursts (drag = many commits) into one
  worker round-trip. If not, debounce it. No change to which warnings appear,
  only how often we compute them.
  Verify: invariants command + count worker messages during a drag test.

---

## Phase 4 — Structural simplification (maintainability, invisible)

Do this LAST — it's the highest-churn, and Phases 0–3 give it a safety net.

- [ ] **4.1 Move stray model logic out of the view.** `hallIntersection` in
  `previewStep.js` and the legend layout math → `js/model/`. Clears the Phase-0.2
  lint violations. Panels render only.
  Verify: `npm run lint` clean + invariants command.
- [ ] **4.2 Re-cut `main.js` / `mainActions.js` / `docActions.js` by
  responsibility**, not line count. Target: `app/state.js`, `app/commands.js`,
  `app/router.js`, `app/keymap.js`, `app/studio.js`. Delete the
  `createActions` re-export hop. Every `app.*` public name/signature unchanged
  (INV-3). Update `docs/ARCHITECTURE.md` in the SAME commit so 0.3 stays green.
  Verify: invariants command + `node tools/arch-check.mjs` clean.

Explicitly NOT in scope: rewriting `stageObjects.js` or Fabric internals for
tidiness alone (cohesive, high-risk, no current payoff). Adding a build step or
TypeScript (would cost the zero-dependency simplicity that is a real strength).

---

## Phase 5 — Mandatory connected folder  ⚠️ DELIBERATE UX CHANGE — NEEDS SIGN-OFF

> This phase **violates INV-2 on purpose**. It changes the flow so a project can
> never be "stray": the user must have a granted folder, and the project is
> always written there. Do NOT start Phase 5 until the owner confirms the exact
> behavior below. Everything above ships without it.

Intent: users never lose work; storage is always the chosen folder, always
reconnected. Build on the EXISTING `folderStore` + `showChooseFolderModal` so the
change is as small as possible; do not invent new screens.

- [ ] **5.0 Decision (owner):** pick the enforcement level:
  - (a) **Soft** — keep IndexedDB as the always-on safety copy, but make the
    folder modal non-skippable on new project and prompt to reconnect on load if
    permission lapsed. Lowest risk; nothing can be lost. **(Recommended.)**
  - (b) **Hard** — refuse to enter the studio without a granted folder handle;
    IndexedDB becomes cache only.
- [ ] **5.1** On new blueprint, remove the "Not now" escape from the existing
  choose-folder modal (`mainActions.js`); the only way forward is choosing a
  folder. (Wording/visual of the modal otherwise unchanged.)
- [ ] **5.2** On load / reconnect, if the stored handle exists but permission is
  not `granted`, show the existing reconnect affordance and block autosave-to-
  folder until reconnected (already partly implemented — make it the required
  path, not optional).
- [ ] **5.3** Guarantee every save writes to the folder (`persistToFolder`) AND,
  for level (a), to IndexedDB. Surface a single clear failure toast if the folder
  write fails (reuse the existing one).
- [ ] **5.4** Browser without File System Access API (`folderStore.isSupported()`
  false): keep today's IndexedDB behavior and today's message — we cannot force a
  folder where the browser has none. Document this as the one unavoidable
  fallback.
  Verify: `tests/browser/folder.spec.js` extended for the mandatory path;
  full invariants command; reviewer confirms the change is limited to the folder
  flow and nothing else moved.

---

## Suggested commit / branch order

`phase-0-safety` → `phase-1-storage` → `phase-2-dom` → `phase-3-perf` →
`phase-4-structure` → (sign-off) → `phase-5-folder`. One PR per phase; each PR's
description pastes the invariants-command output as proof.
