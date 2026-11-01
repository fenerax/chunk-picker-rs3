# Map signals and selected-player roll eligibility

START: `e431da314b682946c27f601ec78f17eab8a790eb`
Branch: `fix/y18-map-signals`
Runtime: Node v24.21.0, Chromium, Linux.

## Contract

Only the matching state response's selected-player `pool.eligible` supplies map
candidate numbers. Eligible saved selections retain their relative hand order;
automatic entries follow by ID. Personal and group views have the same candidate
membership. Partner ownership and pending overlays cannot suppress that membership.

Saved hand selections retain their tint and owner-labelled context without
supplying candidate numbers. The legend names the selected player's numbered
options and each visible selection owner. Hover text keeps eligibility, ownership,
pending choices, and saved selection order separate. Disabled hand selections
have an explanation even when the response has no excluded entry. Chunk detail
eligibility and exclusion reasons remain authoritative. Calculator, storage,
roll controls, commands, and save behavior are unchanged.

The three minimized synthetic witnesses reproduced on START against the unchanged
pool evaluator: two false signals and one missing signal.

## Regression checks

No new test files were added; all regression additions use existing classified
files. Final targeted runs:

| Files | Passed | Failed |
| --- | ---: | ---: |
| `map`, `map-task-count-obstacles`, `map-display-sizes`, `map-rendering-cost` | 55 | 0 |
| `web-browser`, `web-personal`, `map-control-discovery`, `chunk-long-press`, `map-task-count-renderer`, `chunk-colours-drawing` | 413 | 0 |

Final `RS3_PACKS_DIR=<released-packs> npm run test:quick`: **2,981 passed,
1 failed, 68 skipped**, 3,050 tests, 332.838 seconds. The sole failure is the
unchanged catalogue coverage check described below. The quick gate remains red;
no test was weakened or skipped to hide it. The full `npm test` was not run, as
requested.

Names in the table refer to `tests/<name>.test.mjs`. Screen checks cover response
adoption, player switches, legend scope, detailed eligibility, retained exclusion
reasons, absent excluded entries, rule changes, and read-only permissions.

The released-input rule-explanation catalogue check independently reports
3 passed / 1 failed on both START and the candidate: coverage is 147 / 149.
The HTTP ownership check passed 4 / 0 when rerun alone after a failure during
the first quick run. Neither file was changed.

## Wired renderer

`scripts/perf/y18-map-signals.mjs` starts actual authenticated synthetic servers
and opens the shipped application. It exposes the screen context by appending a
reference to the entry module and records Canvas text calls while still painting.
Baseline comparisons serve the four original browser modules from START.
Server code and evaluator code are identical for both variants.

The eight states cover disabled selections, partner selections, eligible
partner-owned destinations, eligible hand order, current and partner pending
choices, excluded selections, and disabled selections with automatic eligibility.
Each is exercised at 1280 x 800 and 390 x 844, in personal and group views, with
editor and viewer sessions, before and after: 128 views and 384 cell checks.

| Observation | START | Candidate |
| --- | ---: | ---: |
| Missing numbered eligible cells | 4 | 0 |
| Extra numbered ineligible cells | 20 | 0 |

Across both variants: 0 pool differences, 0 roll-control disagreements, 128 actual
mouse clicks opening details, and 128 permission checks. Pending panels remain
visible; the inspected chunk is positioned on exposed canvas before interaction.

Five warm samples of 1,000 actual model updates on a three-cell synthetic world:

| Model construction | Median | Minimum | Maximum |
| --- | ---: | ---: | ---: |
| START | 141.1 ms | 133.0 ms | 166.0 ms |
| Candidate | 83.7 ms | 75.7 ms | 113.3 ms |

These are sequential smoke measurements in separate browser contexts while tests
were running. They do not establish a performance improvement. Peak memory was
not measured; no calculator code changed.

Reproduce with an existing Playwright installation, Node 24.20 or newer, and
Chromium; no dependency installation is required in the repository:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
PLAYWRIGHT_MODULE=/path/to/playwright-core RS3_DATASET=open-f2p \
  node scripts/perf/y18-map-signals.mjs --baseline e431da314b682946c27f601ec78f17eab8a790eb
```

The browser probe uses public synthetic definitions only. It checks emulated mouse
input at phone widths, not native touch. Canvas calls do not constitute a pixel or
layout audit. Uninstrumented boot, other zoom levels, and concurrent revision
races are outside this probe's coverage. Existing revision-adoption and gesture
regressions remain in the targeted test runs.
