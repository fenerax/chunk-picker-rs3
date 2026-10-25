# Phone and small-window check — 2026-10-25

START: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd`.

Report-first audit: this findings draft was written before changing application CSS. Only the small fixes explicitly named below are in scope. No task logic, dataset inputs, changelog or roadmap changes.

## Method and coverage

Headless system Chromium; Node 24.19.0. Phone: 390 × 844 CSS pixels, DPR 1, mobile viewport and native touch input (`hasTouch`, coarse pointer). Laptop: 1280 × 720, DPR 1, mouse. Fresh isolated stores, deterministic rolls, public `open-f2p` data, two fictional explorers. No external accounts, other repositories, private saves or remote game data.

The public dataset disables Activity Info and the Tasks/Clues Chunk Info tabs. A separate supplementary server uses `tests/fixtures/partner.mjs`, an explicitly synthetic cellar, and enables the `training` / `rsCatalogues` UI capabilities. These captures cover layout and navigation, not full catalogue calculations. The unmodified `scale-dataset.mjs --scale 1 --seed 1` companion was attempted but cannot boot this server because its cache-topology stub lacks `summary`; it was not used as audit evidence. No application changes were made to accommodate that fixture limitation.

Screenshot filenames are ordered by flow inside `phone-check-2026-10-25/before/` and `after/`. Each is a viewport PNG, palette-compressed to fewer than 300,000 bytes, with no cropping or content redaction. Tab and scroll states are captured separately. Detailed coverage and final check results follow below.

## Findings

### Q1 — Tasks overflow target is only 28.5 × 44 px on the phone (medium)

Evidence: [phone Group Tasks](phone-check-2026-10-25/before/phone-07-group-tasks.png). Selector: `.task-sidebar .task-list-menu > summary` (`.task-list-menu-toggle`). Responsible files: `app/web/tick-active-tasks.css` and `app/web/phone-layout.css`.

The component's more-specific `min-width:1.9rem` overrides the phone's 44 px minimum for summaries. The 44 px height already works. **Small fix Q1: enforce the existing 44 px summary minimum width at the phone/touch breakpoint**, matching the existing minimum-height rule. No desktop target sizes change.

### Q2 — Customized More menu extends below a 720 px window (medium)

Evidence: [laptop customized More](phone-check-2026-10-25/before/laptop-21-more-customized.png) and [keyboard focus at its end](phone-check-2026-10-25/before/laptop-22-more-customized-end.png). Selector: `.topbar .more-tools-menu`. Responsible file: `app/web/style.css`.

Reproduce through Settings → Top bar → turn off “Show Info”; its actions move into More. The default menu fits this fixture, but the supported customization makes it taller than the viewport. It has no internal height limit or vertical scrolling. **Small fix Q2: constrain desktop top-bar menus to the available viewport height and allow internal scrolling.** The phone's static More page keeps its existing scrolling container.

### Q3 — Phone task controls occupy the first screen (low; design decision)

Evidence: [phone Group Tasks](phone-check-2026-10-25/before/phone-07-group-tasks.png) and [scrolled task rows](phone-check-2026-10-25/before/phone-09-filtered-rows.png). Selectors: `#backup-status-notice`, `#group-goals`, `.task-heading`, `.duo-task-controls`, `.task-options`. Files: `app/web/phone-layout.css`, `app/web/duo-tasks.css`, `app/web/style.css`.

With the fresh-save backup warning visible and Group view enabled, the first task is below the bottom navigation. Scrolling reaches it and long task names wrap correctly. Decide whether to compact the warning, collapse goals by default, or shorten the Group view controls. No change made.

### Q4 — Laptop controls are often smaller than 44 px (low; design decision)

Evidence: [laptop map](phone-check-2026-10-25/before/laptop-01-map.png), [laptop Group Tasks](phone-check-2026-10-25/before/laptop-07-group-tasks.png). Selectors: `.topbar nav button`, `.more-tools > summary`, `.task-list-menu-toggle`, `.task-row > .icon-button`. Files: `app/web/style.css`, `app/web/tick-active-tasks.css`.

Mouse-oriented controls commonly measure 28.5–36 px high; the overflow control is 28.5 px square. The current 44 px rules apply to phone/touch contexts. Extending that policy to laptop mouse layouts would affect density and toolbar wrapping. No change made.

### Q5 — Access tab begins with a large unavailable outline (low; design decision)

Evidence: [phone Access](phone-check-2026-10-25/before/phone-05-chunk-access.png), [Access after scrolling](phone-check-2026-10-25/before/phone-06-access-scrolled.png). Selectors: `.chunk-section-map`, `.chunk-section-canvas`, `.chunk-section-select`. Files: `app/web/chunk-sections.mjs`, `app/web/style.css`.

The empty 256 px outline is retained when verified geometry is unavailable, pushing the access setting below the panel fold. It remains reachable by scrolling and keyboard. Decide whether the unavailable-art state should collapse the preview. No change made.

### Q6 — Supplementary Preview exposes a fixture-only calculation error (low; coverage limit)

Evidence: [synthetic phone Preview](phone-check-2026-10-25/before/phone-19-synthetic-estimate.png). Selector: `.death-estimate` / Chunk Info Preview content; renderer: `app/web/death-chunks.mjs`.

The minimal synthetic fixture cannot supply all death-estimate fields and displays an “Estimate unavailable” message containing a JavaScript property error. This does not establish a production calculation defect. It wraps within the panel. Leave any error-copy or calculator decision to separate work.

### Q7 — The backup warning moves the map during initial loading (low; design decision)

Evidence: [phone loading](phone-check-2026-10-25/before/phone-00-loading.png) → [settled phone map](phone-check-2026-10-25/before/phone-01-map.png), and the matching laptop captures in the index. Selectors: `#backup-status-notice`, `.workspace`. Files: `app/web/backup-status.mjs`, `app/web/phone-layout.mjs` (`observeScreenBars`).

The asynchronous fresh-save warning appears after the initial map paint and reduces the map height. Loading task counts also settle after the shell appears. This is visible on the small public fixture. Reserving space, delaying the first map paint, or changing warning placement is a product decision; no change made. These screenshots demonstrate movement, not a claim about field Core Web Vitals. The raw layout-shift observer excludes recent input; its whole-flow sums include later menu interaction and were not used as an acceptance benchmark.

## Fixes and verification

- **Q1:** `app/web/phone-layout.css`: one minimum-width priority change, confined to existing phone/touch rules. [After](phone-check-2026-10-25/after/phone-07-group-tasks.png).
- **Q2:** `app/web/style.css`: a viewport height limit and internal vertical scrolling on top-bar menus. The selector no longer matches once navigation moves into the phone More page. [After opening](phone-check-2026-10-25/after/laptop-21-more-customized.png), [after focusing the last control](phone-check-2026-10-25/after/laptop-22-more-customized-end.png).

Both viewport flows were rerun after the fixes. Roll choices and unlocks work; all applicable Chunk Info tabs are reachable; long task names wrap; task search, filter disclosure, Group/personal view, Settings, More, History and Recent Chunks remain usable. Supplementary Activity Info was checked on all six tabs. Access controls below the fold remain reachable by scrolling. No horizontal document overflow was measured in accepted captures.

Keyboard probes: phone tab ArrowRight/End/Home, Chunk Info End/Home, 18 Tab presses in the task dialog, Escape dismissal and visible focus return. Native Chromium's transient body focus while cycling a modal is not counted as focusing a background control. No background control received focus during that probe. This is bounded keyboard coverage, not a full accessibility certification.

## Paired measurements

The harness uses START styles served by Playwright routing and candidate styles from the same working tree. It uses the same public fixture, deterministic rolls, viewport and three pairs per viewport. The order is **before → after; after → before; before → after**. Each trial uses a fresh browser context; menu customization is restored between trials. Assets point only to absent paths inside the owned scratch directory. These are geometry measurements, with medians and min–max spreads; no latency or memory improvement is claimed.

| Measurement (CSS px; n=3 each) | Before median [min–max] | After median [min–max] |
| --- | --- | --- |
| Phone Tasks overflow width | 28.5 [28.5–28.5] | 44 [44–44] |
| Phone Tasks overflow height | 44 [44–44] | 44 [44–44] |
| Laptop customized menu bottom, viewport bottom 720 | 884.44 [884.44–884.44] | 651 [651–651] |
| Laptop page scroll after focusing Light | 164 [164–164] | 0 [0–0] |
| Laptop Tasks overflow width and height | 28.5 [28.5–28.5] | 28.5 [28.5–28.5] |

Every paired difference is identical: phone width +15.5 px; laptop menu bottom −233.44 px; unwanted page scrolling −164 px. Final menu controls remain reachable in every trial. The phone More page still scrolls in its own container. Peak memory is not relevant to these CSS geometry changes and was not measured.

Raw records: [before public](phone-check-2026-10-25/before/checks-baseline-public.json), [after public](phone-check-2026-10-25/after/checks-candidate-public.json), [before synthetic](phone-check-2026-10-25/before/checks-baseline-synthetic.json), [after synthetic](phone-check-2026-10-25/after/checks-candidate-synthetic.json).

## Tests

`npm run test:quick`: **2,311 passed, 1 failed, 65 skipped** (2,377 tests; exit 1). The failure is `tests/ci-coverage-reporter.test.mjs:77`, “real adaptive native events report nested cases, imported helpers and skipped suites”: `Native coverage count mismatch: tests/fixture.test.mjs` under Node 24.19.0.

An isolated rerun and a rerun using untouched reporter/runner/test files extracted from START both produced **4 passed, 1 failed** with the same mismatch. This is a confirmed pre-existing tooling failure; the task does not change those files.

`npm test`: **5,341 passed, 2 failed, 137 skipped** (5,480 tests, 612 files; exit 1). In addition to the coverage failure, `tests/process-worker.test.mjs:166`, “an owned calculator exits when its parent disappears without calling terminate”, times out waiting for the calculator PID to disappear. An isolated public-`open-f2p` rerun on candidate and an identical rerun using untouched START files both produced **0 passed, 1 failed** with “calculator must exit after parent IPC disconnect”. Both full-suite failures therefore reproduce independently of these CSS changes. No tooling or process-lifecycle fix was attempted.

`git diff --check` and `node --check scripts/perf/phone-check.mjs` pass. All browser candidate geometry assertions pass in all three pairs per viewport. The 148 accepted PNGs (74 before, 74 after) totalled 5,909,856 bytes, the largest 81,178 bytes; the 14 kept as evidence are in this folder. No new test files were added, so `scripts/test-selection.mjs` requires no new classification. The reusable browser/measurement harness is `scripts/perf/phone-check.mjs`.

## Reproduction and limits

Use Node 24 and a preinstalled Chromium, `playwright-core` and `sharp`. The repository still has no npm dependencies. On this machine:

```sh
export PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright-core
export SHARP_MODULE=/opt/codex/cua_node/lib/node_modules/sharp
node scripts/perf/phone-check.mjs --out .local/phone-before --baseline 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd --capture baseline --surface public
node scripts/perf/phone-check.mjs --out .local/phone-before --baseline 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd --capture baseline --surface synthetic
node scripts/perf/phone-check.mjs --out .local/phone-after --baseline 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd --capture candidate --surface public
node scripts/perf/phone-check.mjs --out .local/phone-after --baseline 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd --capture candidate --surface synthetic
```

Public and synthetic servers run in separate processes because the application uses a process-wide dataset provider. Each run owns its fresh temporary save, closes Chromium and the server, and removes that save. Baseline styles are read from START with `git show`, not `origin/main`. Chromium version: 154.0.8037.57.

Limits: Linux headless emulation does not establish iOS/Safari behavior, virtual keyboard behavior, screen-reader compatibility or real-device touch accuracy. Private catalogue-specific content and real saves were excluded. Remaining risks are the two known failing baseline tests and the design choices Q3–Q7. The CSS changes do not alter tasks, commands or saved data.


## Screenshot index

The cloud run captured 148 screenshots: 37 states, each at both sizes, before and after the fixes. Only the 14 linked from the findings and fixes above are stored here. To regenerate the full set, use the commands under Reproduction; they write to `.local/`.

Recommendation: **MERGE-CANDIDATE**, with both pre-existing suite failures explicitly recorded above.
