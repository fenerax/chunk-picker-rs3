# Possible Tasks: cold calculator and repeated baseline work

START: `33932ab3453dec9d6268504b83be80fd76438b13`.

Opening Possible Tasks starts a prediction-lane calculator and evaluates the
member's complete current baseline, even though the client has already awaited
the foreground result. It then builds a location index for every task and
projects the requested chunk. On the largest loadable public synthetic fixture,
the slow first click comes from cold calculator startup and baseline evaluation.
The response and DOM work are small. This is evidence for this synthetic fixture;
it does not establish the phase breakdown of the orchestrator's real save.

No application code was changed. The `before` and `after` trees below contain
identical application code: these are paired controls measuring repeatability,
not a claimed speed improvement. The changes make the synthetic fixture runnable
through production startup and add a reusable observer and regression coverage.

## Fixtures and method

- Node 24.19.0, Linux, application, calculators and Chromium pinned to CPUs 0–1.
- Native `startServer`, normal startup/prediction warming, process calculators,
  3,072 MiB V8 old-space limit inherited by the server/hosts, fresh disposable
  saves and Chromium profiles. No npm packages or external datasets.
- Scale 612, seed 1: 716,982,425 input bytes, 168,910 task definitions, 26,783
  chunk IDs, 173,194 installed saved tasks, 147,492,501 bytes of full-state
  JSON, two members, 200 unlocked chunks each (300 distinct group chunks),
  two selected choices each. Normal save migration installs the task catalogue.
  Saved-task counts/full-state JSON bytes were collected separately on Node
  24.20 using the same pinned packs and normal migration; those allocations are
  excluded from the timing/RSS observations. Full-state bytes are the logical
  JSON state, not the compressed on-disk checkpoint/sidecar size.
- Scale 1,000 is permitted by the generator but exceeds the production 128 MiB
  per-file limit. At 612, the largest catalogue shard is 133,421,702 bytes;
  adding the 154th replica to one shard at 613 crosses 134,217,728 bytes. No
  loader limit was relaxed. Dataset digest:
  `5e3a27706ccbd29622f6f0aba53e7909852c9ecfb158843011b072f72e154185`.
- The maximum fixture completed three observations, then one Group view peer
  calculation exceeded the unchanged 30-second production deadline before a
  planning click. That failed observation is preserved with diagnostics.
- The repeatability batch uses scale 400, seed 1 (468,754,156 input bytes),
  110,398 task definitions, 113,198 installed saved tasks, 18,602 chunk IDs
  and 96,400,633 bytes of full-state JSON,
  keeping 200 unlocked chunks per member and the same request sequence. Its
  dataset digest is
  `9f78c86cf928e9c03b08df47f70b1541fc1756ab0e3d24d87eb3ac0bfbc64bec`.
  Seven pairs per group view. Pair order alternates before/after, then
  after/before, with no concurrent heavy suites. Each cell starts a fresh
  production server and browser. Full-response SHA-256 comparisons exclude
  only volatile `cache` metadata.
- Client timing begins at the real Tasks-tab click and ends when
  `.task-filter-bar` exists and two animation frames pass without a mutation
  anywhere under `#chunk-content`. The ordinary task milestone is awaited
  first; foreground wait here measures the settled-list workflow.
- The unlocked first click is the first planning request for the selected
  member. The locked first click uses the same member's now-warm baseline and
  index. Reopening a chunk can hit the client cache. Separate first/second HTTP
  requests cover both members and four chunks, including another unlocked and
  locked chunk. The second member's first HTTP request uses a cold member
  baseline in an already-running calculator.
- Timing hooks are applied identically to disposable source copies. Worker
  computation uses existing engine/collection/equipment/presentation timings,
  plus location-index/projection timing. Index time is included in projection
  time; these must not be added twice. Remaining worker time includes state
  decoding and baseline assembly. Server serialization is measured separately.
- Queue-to-dispatch includes cold worker initialization. Admission events record
  active request type, whether it is unsolicited warm-up, and both queue depths.
  Foreground warm-up can compete for the two CPUs without being in the same lane.
- Peak RSS adds the server and its native process hosts every 50 ms, excluding
  Chromium and the parent observer. Brief allocation peaks during a blocked main
  event loop may be missed. The raw file also retains kernel main-process
  high-water RSS. Readiness starts at the `startServer` call after fixture
  preparation/module imports, so it is not whole-process cold startup.

Reproduce with the commands in [the performance README](../../scripts/perf/README.md#possible-tasks-cold-lane-breakdown-public-synthetic-data).
The [repeatability observations](possible-tasks-results.json) and
[maximum-fixture observations](possible-tasks-maximum-results.json) contain timings,
queue events, response sizes and full-response hashes, with no response bodies
or credentials. Regenerate the tables using
`scripts/perf/possible-tasks-summary.mjs`.

## Interpretation and next step

The server's `side` classification routes planning to the prediction lane.
Death estimates actually use their own calculator. In the cold-lane observations,
no request or warm queue is ahead of planning at admission: a large queue duration
there means waiting for worker initialization, not waiting behind death estimates.
Use the admission records to distinguish this from future warm-lane contention.

For settled lists, the client foreground wait, JSON serialization and chunk-row
rendering do not explain the long first click. Three mutation observer batches
cover the usual tab/loading/result changes; there is no continuing rerender loop.
A second chunk projects the existing index very cheaply, while changing members
can require another full baseline.

Reusing the foreground baseline is the strongest next lead. A direct reroute is
not included: `tests/scheduler.test.mjs` explicitly protects saves from planning
and full side hydration occupying the saved-list lane. An acceptable reuse path
must retain that scheduling boundary, exact task inputs/status/evidence, worker
retirement behavior and bounded retained memory. Restricting the engine to one
chunk also needs proof that off-chunk prerequisites and source gates retain their
current statuses. Starting another worker earlier
also needs a CPU/RSS tradeoff measurement. This extreme fixture already uses
substantial memory, so a new always-resident planning calculator is not justified.

The maximum fixture cannot reliably initialize both group results within the
production peer deadline, so the seven-pair batch uses a smaller input. This is
not a performance result for the maximum input.

The synthetic template has no interior area IDs, no real saved progress/history,
empty cache catalogues and scrambled geography. It reproduces a cold-worker
latency mechanism, not the real save's complete workload. No production-visible
rows changed; this investigation does not supply the real-save, area-ID parity
proof that would be required for an application optimization.

Recommendation: NEEDS-WORK.

## Measurements

These are identical-code controls, with seven alternating pairs per view. A
negative paired delta is variation, not an optimization. Phase medians need not
sum to the median total because each column is summarized independently.

Baseline: 33932ab3453dec9d6268504b83be80fd76438b13. Completed server/browser observations: 28. Paired full-response comparisons: 224; repeated-response comparisons: 224.
All timings are milliseconds: median [minimum, maximum]. RSS is sampled MiB. Each view uses fresh production servers.

| Group view | Tree | First unlocked click | Second unlocked click | First locked click | Second locked click | Listen-to-ready | Server tree peak RSS | Main peak RSS |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| off | before | 22580.20 [21490.20, 25286.90] | 39.40 [33.80, 45.40] | 69.30 [54.30, 110.90] | 40.20 [31.40, 52.70] | 15866.87 [15554.67, 15980.10] | 6987.48 [6744.82, 7281.86] | 2075.19 [2025.34, 2091.14] |
| off | after | 22019.10 [21559.60, 24888.40] | 37.20 [33.90, 50.10] | 84.80 [61.10, 252.80] | 41.30 [36.60, 52.00] | 15746.69 [15050.32, 16117.68] | 7168.25 [6848.48, 7399.93] | 2094.24 [2034.80, 2178.69] |
| on | before | 21537.20 [19351.90, 24802.80] | 46.60 [34.80, 57.60] | 58.10 [52.70, 104.30] | 37.60 [29.00, 56.30] | 15616.02 [15046.44, 16005.80] | 8672.22 [8408.41, 8789.15] | 2097.65 [2061.47, 2110.44] |
| on | after | 22130.60 [18523.00, 24480.20] | 34.90 [33.90, 52.20] | 75.10 [53.60, 119.30] | 35.00 [24.80, 50.60] | 15722.46 [15630.99, 17295.48] | 8640.84 [8592.24, 8832.25] | 2078.21 [1988.36, 2161.11] |

| Group | Tree | Request | Foreground settle | Queue to dispatch | Worker total | Engine | Collection | Equipment | Presentation | Index | Other worker | Other request/IPC | JSON serialization | Raw bytes | Render | DOM mutation batches |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| off | before | unlocked 1 | 0.60 [0.50, 1.00] | 10114.75 [9726.76, 11544.25] | 11660.15 [11047.59, 13431.49] | 8758.53 [7747.60, 9664.18] | 63.78 [57.07, 116.77] | 37.27 [22.90, 78.34] | 800.97 [585.78, 1252.35] | 529.35 [482.22, 1084.16] | 1265.08 [1195.69, 2538.13] | 658.80 [622.76, 1011.51] | 0.17 [0.16, 13.72] | 41588.00 [41575.00, 41594.00] | 0.90 [0.80, 1.00] | 3.00 [3.00, 3.00] |
| off | before | unlocked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.10 [0.10, 0.30] | 3.00 [3.00, 3.00] |
| off | before | locked 1 | 0.30 [0.30, 0.50] | 0.12 [0.11, 2.76] | 0.22 [0.20, 0.31] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.22 [0.20, 0.31] | 6.09 [3.09, 13.02] | 0.11 [0.10, 0.14] | 39571.00 [39570.00, 39573.00] | 0.30 [0.30, 0.80] | 3.00 [3.00, 3.00] |
| off | before | locked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.30 [0.20, 1.10] | 3.00 [3.00, 3.00] |
| off | after | unlocked 1 | 0.60 [0.50, 1.20] | 9682.70 [8876.78, 10597.36] | 11518.35 [10596.48, 13909.22] | 9023.43 [8300.63, 9711.94] | 62.49 [49.31, 97.51] | 42.62 [24.11, 119.44] | 701.00 [598.03, 1929.77] | 520.13 [497.43, 1584.11] | 1186.44 [1045.25, 1426.70] | 676.54 [607.84, 1114.06] | 0.19 [0.16, 0.28] | 41585.00 [41573.00, 41591.00] | 0.90 [0.80, 1.00] | 3.00 [3.00, 3.00] |
| off | after | unlocked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.20 [0.10, 0.20] | 3.00 [3.00, 3.00] |
| off | after | locked 1 | 0.40 [0.30, 0.70] | 0.12 [0.10, 0.15] | 0.26 [0.21, 0.38] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.26 [0.21, 0.38] | 5.39 [3.12, 14.12] | 0.10 [0.10, 0.12] | 39572.00 [39568.00, 39573.00] | 0.40 [0.20, 0.80] | 3.00 [3.00, 3.00] |
| off | after | locked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.30 [0.20, 5.60] | 3.00 [3.00, 3.00] |
| on | before | unlocked 1 | 0.60 [0.50, 1.00] | 9851.80 [8831.06, 10852.52] | 11166.50 [9439.16, 13230.34] | 8429.73 [6546.89, 8891.46] | 102.79 [56.94, 132.50] | 31.06 [23.41, 94.84] | 786.89 [554.41, 1581.70] | 560.46 [468.60, 874.67] | 1433.17 [970.62, 2474.38] | 611.49 [456.21, 1028.78] | 0.18 [0.15, 0.20] | 41584.00 [41573.00, 41596.00] | 0.80 [0.70, 1.20] | 3.00 [3.00, 3.00] |
| on | before | unlocked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.20 [0.20, 0.30] | 3.00 [3.00, 3.00] |
| on | before | locked 1 | 0.40 [0.30, 1.00] | 0.10 [0.09, 0.12] | 0.27 [0.20, 0.48] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.27 [0.20, 0.48] | 6.07 [3.37, 15.47] | 0.11 [0.10, 0.13] | 39572.00 [39566.00, 39573.00] | 0.30 [0.20, 1.30] | 3.00 [3.00, 3.00] |
| on | before | locked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.30 [0.10, 9.90] | 3.00 [3.00, 3.00] |
| on | after | unlocked 1 | 0.50 [0.50, 2.70] | 9694.93 [8205.19, 10895.57] | 10989.99 [9651.27, 12964.55] | 8651.87 [6742.17, 9262.01] | 110.68 [55.84, 136.47] | 45.50 [19.14, 103.48] | 1137.97 [633.48, 1368.36] | 540.17 [468.72, 913.97] | 1326.98 [1135.71, 1731.63] | 689.72 [578.67, 1149.30] | 0.19 [0.17, 0.21] | 41587.00 [41577.00, 41590.00] | 0.80 [0.70, 1.10] | 3.00 [3.00, 3.00] |
| on | after | unlocked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.20 [0.10, 0.20] | 3.00 [3.00, 3.00] |
| on | after | locked 1 | 0.40 [0.30, 1.10] | 0.12 [0.10, 0.16] | 0.25 [0.20, 0.41] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.25 [0.20, 0.41] | 5.73 [3.68, 16.63] | 0.11 [0.10, 0.18] | 39571.00 [39570.00, 39572.00] | 0.50 [0.20, 0.80] | 3.00 [3.00, 3.00] |
| on | after | locked 2 | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | unmeasured | 0.30 [0.20, 3.50] | 3.00 [3.00, 3.00] |

Prediction-worker compilation within queue-to-dispatch (existing compileMs):
off before: 5232.34 [4963.22, 6039.46].
off after: 5209.47 [4718.31, 5825.34].
on before: 5057.81 [4773.91, 5473.64].
on after: 5149.37 [4277.14, 5636.44].

Browser wire bytes (first unlocked):
off before: encoded 12693.00 [12687.00, 12698.00]; decoded 41588.00 [41575.00, 41594.00].
off after: encoded 12693.00 [12683.00, 12700.00]; decoded 41585.00 [41573.00, 41591.00].
on before: encoded 12692.00 [12688.00, 12700.00]; decoded 41584.00 [41573.00, 41596.00].
on after: encoded 12693.00 [12684.00, 12696.00]; decoded 41587.00 [41577.00, 41590.00].

Paired differences, after minus before (negative is faster):
off first unlocked: -398.50 [-3115.50, 1540.00]; pairs 7.
on first unlocked: 300.30 [-5408.60, 3605.30]; pairs 7.

First HTTP planning for the second member (cold member baseline, locked chunk):
off before: request 8990.53 [7617.14, 10090.85]; worker 8963.89 [7600.88, 10079.16]; repeat 3.42 [2.49, 26.06].
off after: request 8429.34 [6623.33, 9133.70]; worker 8406.13 [6612.75, 9112.80]; repeat 3.30 [2.98, 15.38].
on before: request 9225.98 [7102.39, 10266.29]; worker 9215.06 [7086.69, 10231.46]; repeat 7.41 [2.79, 16.64].
on after: request 8754.67 [6231.92, 8946.36]; worker 8728.42 [6208.72, 8909.69]; repeat 3.23 [2.45, 14.95].

At first unlocked admission, work already in the same lane:
28: {"type":"none","warm":false,"queued":0,"warmQueued":0}

## Early-click diagnostic

One additional pair per view clicks as soon as the map and controls are adopted.
This condition deliberately does not await the task-list milestone. It separates
foreground waiting from the settled-list batch; it is not a seven-pair result.

| Group | Tree | Click total (s) | Foreground wait (s) | Planning API (s) | Render (ms) | Mutation batches |
|---|---|---:|---:|---:|---:|---:|
| off | before | 31.03 | 11.06 | 19.92 | 1.10 | 7 |
| off | after | 31.80 | 10.95 | 20.80 | 0.70 | 7 |
| on | before | 40.86 | 18.13 | 22.69 | 0.60 | 7 |
| on | after | 42.55 | 19.16 | 23.36 | 0.70 | 7 |

Foreground waiting adds 10.9–19.2 seconds in these early probes. Mutation
batches rise from three to seven, but the row renderer still takes about 1 ms.
Opening the panel before lists settle can therefore combine two substantial
waits. Inspect the real benchmark's task-list readiness as well as its API span.
The planning worker reports zero prediction/death time: this section associates
current tasks with a location; the separate If unlocked action is not clicked.

## Maximum-fixture diagnostic

These three completed cells are diagnostic samples, not a seven-pair comparison.
The fourth cell failed while awaiting initial group tasks: the peer calculator
expired at the unchanged 30-second deadline (one requested, zero completed, one
expired, one worker restart). The controller then hit its readiness timeout.

| Group | Tree | First click (s) | Queue to dispatch (s) | Worker total (s) | Engine (s) | Index (s) | Peak tree RSS (GiB) |
|---|---|---:|---:|---:|---:|---:|---:|
| off | before | 36.04 | 14.98 | 20.01 | 12.47 | 2.67 | 10.51 |
| off | after | 32.06 | 13.36 | 17.51 | 13.34 | 0.94 | 10.02 |
| on | before | 35.34 | 15.34 | 18.86 | 14.51 | 0.92 | 12.94 |

## Files changed

| File | Change |
|---|---|
| `scripts/perf/possible-tasks.mjs` | Public synthetic observer, identical temporary hooks, real browser timing, phase/queue/response/memory capture and response parity. |
| `scripts/perf/possible-tasks-summary.mjs` | Reproducible paired/range tables and full-response/repeat checks. |
| `scripts/perf/scale-dataset.mjs` | Valid permanent synthetic IDs, empty legacy history/cache summary, removal of the unsupported public journal goal. |
| `scripts/perf/README.md` | Reproduction, limits and timing boundaries. |
| `tests/dataset-packs.test.mjs` | Fixture shape assertions and production process-worker startup/planning regression for both members. Existing classified test file; no new test file. |
| `docs/perf/possible-tasks.md` | This report. |
| `docs/perf/possible-tasks-results.json` | Seven-pair observations plus separate early-click probes. |
| `docs/perf/possible-tasks-maximum-results.json` | Maximum-fixture observations and production peer-deadline diagnostics. |

## Validation

Application code is identical to START (`app` tree
`1cb028bec6e078aeb5823f09662c6341efc63199`). No new test file was added; the
regression extends the existing classified dataset-packs test file.

| Run | Node | Passed | Failed | Skipped | Seconds |
|---|---|---:|---:|---:|---:|
| Initial quick | 24.19.0 | 2308 | 2 | 65 | 199.97 |
| Final quick | 24.20.0 | 2310 | 0 | 65 | 79.02 |
| Final full | 24.20.0 | 5337 | 0 | 137 | 337.22 |

The initial quick failures were the new regression's inherited `--eval`
launcher (corrected to a temporary `.mjs` entry file), and an unchanged coverage
reporter/native-event count mismatch on Node 24.19. The corrected regression
passed its focused rerun; the unchanged coverage test passes on the provided
Node 24.20. Final quick and full suites both pass on 24.20. No production code
was changed to accommodate either failure. All performance pairs and early
probes used 24.19 consistently.

Numeric artifacts omit repeated lane-health snapshots and zero-valued timing
keys. One historical cache-timing example and one compile time are retained per
run. Full request timings, phase values, queue/serialization events, response
sizes, hashes and RSS samples used by the report remain. Regenerating every
measurement table produces identical text before and after compaction.
