# New task options on the map

Branch: `perf/y05-heatmap-overlay`.
START: `e431da314b682946c27f601ec78f17eab8a790eb`.

Open Map display and turn on **New task options**. The choice starts off and
lasts for the current page. It shows the selected player's saved roll-pool
comparison counts, including in group view. Normal map interactions and outer
ownership borders remain in place. The inspection list supports keyboard
navigation and centering the map on any current candidate.

The number is exactly planning's `delta.tasksAdded.length`: newly available,
non-hidden obligatory task IDs with progress held fixed. Completed and backlogged
entries and multiple alternative methods can count. It measures additions,
not unfinished goals, net gain, time, losses, or desirability. Skill filtering
uses the retained complete counts, never the bounded examples.

Gold heat scales checked positive counts. Solid white marks checked zero;
dashed outlines and `?` mark unknown. Unknown counts remain null and do not enter
the scale. The controls and map legend report checked/total and unknown counts.
Zooming in shows numbers; hover and the inspection list provide exact values.

## Work and ownership

The layer uses the existing pool-ranking GET endpoint and its one-second cadence.
It never requests a prediction, creates a comparison-interest lease, calls the
comparison panel's visibility API, or hashes the full save. Existing previews and
comparison controls retain responsibility for calculations. A cold pool lookup
can still acquire the current pool through the existing calculator path.

The server retains its existing bounded rich-summary and complete-pool-count
budgets. No second server cache or prediction graph is added. The browser holds
only the current response and display projection, replacing them on scope changes.

Responses are guarded by member, revision, picker, dataset, candidate membership,
and client generation. Sandbox suspends the layer. Display-only revisions can
reuse retained counts, stamped with the current revision. Task inputs and options
use the existing authoritative input key; calculator and dataset versions are
fixed by the owning runtime. After asynchronous pool lookup the HTTP route checks
both input and revision before touching retained summaries. A stale module reader
also cannot advance or clear a newer owner.

## Verification

The retention defect reproduces on START: checked counts fall from 1 to 0 after an
old captured read. The new HTTP regression holds a pool request across a committed
HTTP save: START incorrectly returns 200; the fix returns 409. Focused module,
client, HTTP, planning, prediction-output golden, and map checks pass: 142 passed,
0 failed. The browser-screen fixture now includes the new feature collaborator.
The required single `npm run test:quick` run reports 2,986 passed, 1 failed,
68 skipped (400.17 s). Its failure is in unchanged
`tests/rule-explanations.test.mjs`. That file was rerun alone on the candidate
and on START with identical inputs: both report 3 passed, 1 failed, with an
identical assertion. The unrelated catalogue failure is left unchanged.

The original map fixture uses the legacy coordinate crop: its 16 failures on
`open-f2p` reproduce on unchanged START. With its intended dataset all 28 current
map tests pass, including the new overlay/hover/terrain/hit-testing regression.
No calculator implementation, storage implementation, task rules, or gameplay
outputs changed. The full engine checker is absent on main; no full corpus claim
is made. No real save was opened.

## Measurements

Node 24.21.0, Linux, headless Chromium, synthetic public fixture. Five interleaved
START/current pairs; each run measures five uncached-pool requests and twenty warm
requests, then 120 state-canvas draws per viewport/mode after twenty warmups.
Uncached requests each follow a distinct candidate-membership edit, with a resident
worker. They include actual pool acquisition and HTTP/JSON costs. Warm requests
include HTTP/JSON costs with current pool membership already acquired.

Values below are median [minimum–maximum] of the five run medians, in milliseconds.
They describe this small synthetic fixture, not released-pack calculator latency.

| Measurement | START | Current |
| --- | --- | --- |
| Uncached pool + ranking HTTP | 6.600 [6.262–7.902] | 6.683 [4.922–7.237] |
| Warm ranking HTTP | 2.210 [2.067–2.269] | 2.016 [1.991–2.240] |
| Desktop state draw, overlay off | 0.4 [0.3–0.4] | 0.4 [0.3–0.6] |
| Desktop state draw, overlay on | unavailable | 0.4 [0.4–0.4] |
| Phone-width state draw, overlay off | 0.2 [0.2–0.2] | 0.2 [0.2–0.3] |
| Phone-width state draw, overlay on | unavailable | 0.2 [0.2–0.2] |

Toggle change through GET completion to the first checked state-canvas draw:
desktop 23.5 [20.8–31.4] ms; phone width 20.4 [18.4–27.1] ms, five observations
each. State draw timings measure the actual map drawing function's synchronous
CPU/canvas submission work, excluding GPU completion and compositor presentation.
Endpoint-phase process peak RSS (including worker threads, excluding Chromium and
subsequent explicit previews): START median 166.88 MiB [166.79–167.71], current
166.78 MiB [165.42–168.30]. These are process footprints, not incremental overlay
memory. These overlapping samples establish no calculator speed improvement or
stable tail estimate.

The wired browser checks cover 1280×800 and 390×844, keyboard toggle, keyboard
inspection/centering, partial/zero/unknown values, player switching, and no page
horizontal overflow. All ten current viewport runs issue zero prediction requests
and zero interest writes. Screenshots were visually inspected. Native touch,
mobile Safari, full released-pack endpoint costs, and dense artwork/pin layouts
remain unmeasured.

Reproduce with `scripts/perf/availability-overlay.mjs`, providing externally
installed Playwright/Chromium paths as documented in that script. An optional
checkout argument permits the same synthetic probe against START. No browser or
npm dependency is added to the application.
