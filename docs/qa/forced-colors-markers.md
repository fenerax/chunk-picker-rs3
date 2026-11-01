# Selected and current markers in forced colors

Branch: `fix/w36-forced-colors-markers`

START: `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`

On START, Chromium forced-colors emulation paints the transparent inactive
borders in Chunk Info and Helper navigation. Selected/current controls then
have the same effective foreground, background and borders as inactive controls.
Their ARIA state remains correct. This reproduces through Search → View →
Chunk Info and the wired Helper button using a disposable synthetic save.

The fix adds a 2px text underline with an offset to the selected Chunk Info tab
and current Helper section, only inside `@media(forced-colors:active)`. The
underline remains distinct from keyboard focus's outline. System color
substitution stays enabled; normal-mode styling and navigation semantics do not
change. No game, storage or calculator code changes.

## Reproduce and validate

Node 24.20+ and an externally installed `playwright-core` plus Chromium are
required. There are no added project dependencies. Export the two START styles
to a temporary directory, then run the browser regression harness:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
BASELINE=$(mktemp -d)
git show a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9:app/web/style.css > "$BASELINE/style.css"
git show a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9:app/web/helper.css > "$BASELINE/helper.css"
RS3_DATASET=duo-legacy node scripts/perf/forced-colors-markers.mjs \
  --playwright /path/to/playwright-core/index.mjs \
  --baseline-web "$BASELINE" --output /tmp/forced-colors-results
```

The harness creates and deletes its own synthetic save and binds an ephemeral
loopback port. Do not supply private packs, defaults or a real save. It loads the
full app and exercises the wired navigation. Baseline styles are served only
for the baseline observations; the current styles must pass the assertions.
Baseline observations never assert that a missing marker is correct behavior.

Coverage includes 1440px and 390px viewports, dark and light app themes, dark and
light Chromium emulated system palettes, forced colors on and off, two selected
states per surface, and unfocused/current-focused/inactive-focused controls.
Assertions cover effective painted state differences, visible text and hit
targets, the selected-only underline, keyboard focus's separate outline, browser
exceptions, and unchanged gameplay state. Chromium's native focus border recoloring
is excluded from the selected-marker comparison so focus cannot count as a
selection cue. Paired normal-mode control screenshots
must be byte-identical. Screenshots and detailed effective styles are written to
the supplied output directory. Three alternating before/after rounds are the
default.

This is Linux Chromium emulation. Native Windows high-contrast settings, other
browsers and human legibility have not been verified; no real-Windows coverage
is claimed. The harness timings describe validation cost, not UI performance.

## Validation results (2026-11-01)

Node 24.21.0. The exported baseline styles match START by SHA-256 (2/2).

- `node --test --test-concurrency=1 tests/accessibility-focus.test.mjs tests/design-tokens.test.mjs tests/helper-view.test.mjs tests/helper-server.test.mjs tests/web-browser.test.mjs`: 381 passed, 0 failed, 0 skipped (9.10s).
- `npm run test:quick`: 3,011 passed, 0 failed, 68 existing skips (266.62s).

The standalone browser regression harness lives under `scripts/perf/`; no new
`tests/*.test.mjs` file or test-selection entry is needed.

Chromium 154.0.8037.57 completed three alternating comparison rounds: 576
current-style observations passed, 0 failed; 576 baseline observations measured.

| Measurement | START styles | Fixed styles |
| --- | ---: | ---: |
| Forced-color selected/current distinction | 0/288 | 288/288 |
| Normal-mode selected/current distinction | 288/288 | 288/288 |
| Forced-color distinctions per round: median (min–max), out of 96 | 0 (0–0) | 96 (96–96) |
| Browser round duration: median (min–max) | 24.206s (24.049–36.802s) | 24.907s (24.582–33.504s) |

Normal-mode screenshot differences: 0/20 paired crops. Control geometry
differences: 0/576 paired observations. Browser exceptions: 0. Synthetic gameplay
state differences after navigation: 0. Captured screenshots were also visually
inspected for the underline and separate focus outline, including phone layouts
and both emulated palettes.

Round durations include navigation and validation; the first round also captures
screenshots. These are harness costs, not an application speed comparison. Peak
memory was not measured for this CSS-only change. Detailed observations and
screenshots from this run remain at `/tmp/forced-colors-results-final/` in the
task workspace; the harness regenerates them.
