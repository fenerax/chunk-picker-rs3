# Reference calculator profile and bake-off plan

START `9995140f3d0211500f2fe4f2555132b900f7eb8a`.

> Since this was measured: the self-contained init bundle (EN2, `calculator/bundle/`) is on this lane, so the "init bundle is currently incomplete" note below is resolved; and the `roll-pool` request (M0) moves pool evaluation off the HTTP thread on main. The numbers below are unchanged START measurements.

Measurement only: 0 application changes. Cold/warm are cache states of the same reference calculator; no replacement or optimisation was implemented, so there is no measured implementation before/after speedup.

## Reproduction and interpretation

Node 24.19.0, Linux x86-64, AMD EPYC 7763, 5 visible logical CPUs, cgroup quota 4 CPU cores, memory limit 16 GiB. Sequential trials; no concurrent benchmark or test workload. Memory admission checked before running a preparation process alongside one process worker. These are VPS-shaped capacity measurements, not a production VPS latency guarantee.

```sh
node scripts/perf/engine-profile.mjs --dataset open-f2p --output /tmp/open-timing.json
node scripts/perf/engine-profile.mjs --dataset duo-legacy \
  --packs "$RS3_PACKS_DIR" --data-dir "$COPY_INPUT_DIR" \
  --game-defaults-file "$RS3_GAME_DEFAULTS_FILE" --output /tmp/reference-timing.json
mkdir -p /tmp/reference-profiles
node --cpu-prof --cpu-prof-dir=/tmp/reference-profiles \
  --heap-prof --heap-prof-dir=/tmp/reference-profiles \
  scripts/perf/engine-profile.mjs --dataset duo-legacy \
  --packs "$RS3_PACKS_DIR" --data-dir "$COPY_INPUT_DIR" \
  --game-defaults-file "$RS3_GAME_DEFAULTS_FILE" \
  --profile --output /tmp/reference-profile.json
```

For source-located CPU rankings, run the same command with `--cpu-only --runs 1`, omit `--heap-prof`/`--heap-prof-dir`, and use a separate output file. This is a diagnostic interval, not a timing benchmark. Repeat the profiled command with `--dataset open-f2p`, omitting the input arguments. `--runs` is at least 5 for timings and joint CPU/heap profiling; a separate CPU-only diagnostic permits 1; `--candidates` defaults to 3. `--only chunk-planning,sandbox,area-check` reruns selected worker types and omits pool trials. Output must be under `/tmp`. Each input save is copied to a fresh temporary directory, including its dataset binding, before `createServer` opens it. The production server prepares/migrates the copy, its `getCalculationSnapshot` provides the calculator input, then it closes. Scratch saves are removed. Runtime-default configuration: 1 temporary file; 0 input-checkout modifications.

Every worker request kind gets 5 fresh `ProcessWorker` instances, each followed by an identical warm request. Warm repeats reference the same worker state snapshot. Shared JSON state/result transport, ready-catalogue policy, definition preparation ledger and dataset selection match the production foreground/advisory lanes. `evaluate` is the direct object-returning control; `play` and `full` are the server's JSON result variants. `duo` and `duo-sidebar` set the two production projection flags separately; both currently call `projectDuoSidebarResult`. Only `evaluateRollPool` measures both roster positions independently, in fresh main-thread processes. The open-f2p fixture uses the provider's 2 default members and starting cell, with no saved progression.

Predict measures a sequential batch of 3 numerically sorted eligible candidates. Both owner and partner reuse results are produced. Death estimates use the same 3 candidates. Chunk planning uses 1 candidate; sandbox unlocks 1 candidate; area check audits 1 candidate. No candidate identities are reported. Cold means no calculator snapshot/estimate cache, not an empty OS page cache. Warm predict still computes hypotheses; warm death estimates and sandbox can hit their own caches. HTTP scheduler caches are deliberately bypassed: these are calculator measurements, not HTTP cache-hit latencies.

Timing tables use the unprofiled run only. Each cell is median [minimum, maximum], with 5 trials unless specified. Wall time covers dispatch, state parsing, work, projection, serialization and process relay back to the caller. CPU is core-seconds across caller and every task of the worker-host process, using `process.cpuUsage` plus Linux `/proc` scheduling counters. It includes V8 GC/compiler threads, so CPU may exceed wall seconds. CPU sampling boundaries add a small measurement floor to sub-millisecond fixture requests. Worker-only execution CPU and stage times are also retained in the JSON report.

Profile runs are separate. `--cpu-prof`/`--heap-prof` capture process diagnostics; the diagnostic preload uses the same V8 Inspector CPU and heap samplers inside the task isolate, since `ProcessWorker` explicitly overrides worker `execArgv`. CPU sampling is 1 ms, started after ready and stopped after the cold/warm pair. Requests shorter than 1 second receive additional warm repeats until the interval reaches 1 second. Rankings therefore describe this declared cold-plus-warm workload; they are not pure cold-only profiles. `(idle)`, `(garbage collector)` and module-scoped anonymous functions remain visible. Profile time is sampled wall time, not CPU core-seconds. Inspector and harness frames are measurement/transfer overhead; they remain visible and are not treated as application optimisation targets. Full per-frame self-time totals are kept in the numeric report; 5-trial grouped profiles support hotspot comparisons; the source-located rankings below use the separate CPU-only diagnostic without the heap sampler. Source locations distinguish anonymous closures. Capacity conclusions use the 5-run unprofiled measurements.

Heap sampling starts in the task preload before application module loading at 32 KiB allocation intervals. After both request temperatures and any profile repeats, `HeapProfiler.collectGarbage` runs before `stopSampling`. Tables give sampled live bytes by allocation site. These are live allocation estimates, not exact dominator retained sizes; they exclude allocations before the preload and native allocator overhead. Main-thread pool samples also include module loading. Inspector-owned profile objects can remain sampled live, especially in the small fixture; they are diagnostic overhead, not application-retained structures. RSS remains the capacity metric. Native heap/CPU files stay outside the repository.

## Input fingerprints
| Input | Dataset digest | Calculation SHA-256 | Calculation bytes | Members |
| --- | --- | --- | ---: | ---: |
| Released packs | `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f` | `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1` | 15707693 | 2 |
| open-f2p | `f129828c58260ba4894f2cb6ed7287c07c8f5360cb8d0a1716a5f26ddb9dfbc0` | `1d67dc1ac8653c7266a0870bc8cbe2c4a45f436e3d94e69ab4ecbcc407354879` | 246242 | 2 |
Released input state SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
## Startup
| Input | Samples | Reported compile ms | Spawn to ready ms | Worker CPU to ready, core-s | RSS at ready, MiB |
| --- | ---: | --- | --- | --- | --- |
| Released packs | 50 | 1813.653 [1669.504, 1964.663] | 4281.143 [3753.856, 4910.926] | 6.278 [5.813, 6.929] | 688.0 [506.0, 760.8] |
| open-f2p | 50 | 18.993 [17.631, 24.846] | 277.893 [262.617, 305.009] | 0.333 [0.312, 0.367] | 74.2 [72.2, 75.1] |
`compileMs` starts after module imports and definition preparation, ending after engine, collection and catalogue construction. Spawn-to-ready also includes pack verification, module materialisation, parsing, world cloning and the ready catalogue relay. It is the relevant wake cost. Rule-dependent engine variants may still compile during a cold request; ready does not mean every variant is compiled. Foreground catalogue transfer is included for evaluate/play/full/sidebar/planning/sandbox/area-check; advisory duo/predict/death omit the unused catalogue.

## Request timings
### Released packs
| Request | Cold wall ms | Warm wall ms | Cold CPU core-s | Warm CPU core-s |
| --- | --- | --- | --- | --- |
| `evaluate` | 5949.236 [5796.714, 6379.631] | 947.380 [784.203, 1043.142] | 9.608 [9.264, 10.616] | 2.328 [1.255, 2.373] |
| `play` | 4807.891 [4714.696, 4890.865] | 54.256 [50.951, 60.420] | 8.194 [8.124, 8.320] | 0.070 [0.063, 0.090] |
| `full` | 5540.922 [5365.449, 5748.059] | 388.776 [366.223, 744.118] | 9.258 [8.687, 9.500] | 0.787 [0.677, 2.038] |
| `duo` | 4651.262 [4489.337, 4865.487] | 105.770 [102.504, 117.108] | 6.859 [6.574, 7.097] | 0.194 [0.179, 0.211] |
| `duo-sidebar` | 4842.744 [4766.169, 4881.965] | 103.706 [98.386, 109.662] | 8.220 [8.110, 8.325] | 0.186 [0.180, 0.194] |
| `predict` | 20635.743 [20317.772, 20840.130] | 13768.521 [13365.858, 13991.712] | 30.974 [30.828, 31.490] | 19.106 [18.336, 20.025] |
| `death-estimates` | 16090.139 [15477.525, 16211.324] | 2.035 [1.588, 2.338] | 22.826 [22.025, 23.834] | 0.008 [0.006, 0.009] |
| `chunk-planning` | 5197.135 [4961.757, 5279.742] | 2.064 [1.777, 2.804] | 8.849 [8.050, 9.102] | 0.008 [0.007, 0.009] |
| `sandbox` | 8477.552 [8246.900, 8561.572] | 34.732 [33.371, 52.730] | 13.607 [13.167, 13.657] | 0.038 [0.037, 0.056] |
| `area-check` | 10366.146 [9942.372, 10518.298] | 1232.945 [1224.796, 1319.977] | 16.072 [15.096, 16.162] | 1.736 [1.711, 1.950] |
| `evaluateRollPool` 0 | 3278.236 [3043.296, 3365.487] | 66.598 [61.760, 68.580] | 5.491 [5.042, 5.804] | 0.128 [0.091, 0.141] |
| `evaluateRollPool` 1 | 2764.997 [2731.765, 2800.945] | 58.596 [57.836, 65.115] | 5.251 [5.143, 5.328] | 0.134 [0.133, 0.143] |

### open-f2p
| Request | Cold wall ms | Warm wall ms | Cold CPU core-s | Warm CPU core-s |
| --- | --- | --- | --- | --- |
| `evaluate` | 87.026 [82.442, 90.221] | 11.962 [11.458, 12.278] | 0.109 [0.104, 0.153] | 0.017 [0.016, 0.018] |
| `play` | 57.124 [55.728, 59.411] | 1.969 [1.812, 2.110] | 0.075 [0.073, 0.083] | 0.006 [0.006, 0.007] |
| `full` | 80.773 [78.593, 84.415] | 9.579 [8.855, 10.971] | 0.102 [0.098, 0.108] | 0.017 [0.013, 0.052] |
| `duo` | 61.649 [57.939, 63.845] | 3.215 [2.799, 4.724] | 0.078 [0.076, 0.086] | 0.011 [0.007, 0.013] |
| `duo-sidebar` | 63.075 [58.429, 65.647] | 3.473 [3.038, 4.141] | 0.083 [0.076, 0.116] | 0.012 [0.010, 0.013] |
| `predict` | 203.540 [199.066, 231.061] | 87.925 [84.225, 117.909] | 0.290 [0.281, 0.349] | 0.170 [0.152, 0.182] |
| `death-estimates` | 143.589 [135.615, 148.299] | 1.827 [1.741, 1.939] | 0.216 [0.194, 0.252] | 0.006 [0.005, 0.007] |
| `chunk-planning` | 58.195 [57.320, 60.500] | 1.002 [0.871, 1.300] | 0.079 [0.077, 0.116] | 0.004 [0.004, 0.036] |
| `sandbox` | 80.762 [77.674, 96.772] | 1.669 [1.533, 1.742] | 0.117 [0.112, 0.140] | 0.005 [0.004, 0.005] |
| `area-check` | 104.177 [103.168, 112.923] | 14.195 [13.079, 14.748] | 0.156 [0.140, 0.179] | 0.019 [0.018, 0.021] |
| `evaluateRollPool` 0 | 1.670 [1.624, 1.843] | 0.259 [0.218, 0.328] | 0.002 [0.002, 0.003] | 0.000 [0.000, 0.000] |
| `evaluateRollPool` 1 | 1.747 [1.640, 2.059] | 0.258 [0.217, 0.389] | 0.003 [0.002, 0.003] | 0.000 [0.000, 0.000] |

## Memory
| Input | Request | Baseline warm-end RSS, MiB (5 trials) | CPU-only kernel peak RSS, MiB (1 interval) |
| --- | --- | --- | ---: |
| Released packs | `evaluate` | 1208.0 [1161.4, 1239.4] | 1173.5 |
| Released packs | `play` | 880.7 [878.2, 903.9] | 896.2 |
| Released packs | `full` | 1055.1 [999.7, 1075.6] | 1058.6 |
| Released packs | `duo` | 895.7 [890.5, 918.4] | 918.6 |
| Released packs | `duo-sidebar` | 901.5 [892.0, 907.3] | 895.7 |
| Released packs | `predict` | 1352.0 [1322.1, 1369.4] | 1420.2 |
| Released packs | `death-estimates` | 1249.4 [1222.9, 1272.1] | 1402.9 |
| Released packs | `chunk-planning` | 959.1 [940.1, 970.3] | 960.2 |
| Released packs | `sandbox` | 1070.0 [1058.3, 1077.5] | 1049.9 |
| Released packs | `area-check` | 1349.2 [1335.6, 1392.7] | 1344.5 |
| Released packs | `evaluateRollPool` 0 | — | 684.6 |
| Released packs | `evaluateRollPool` 1 | — | 715.8 |
| open-f2p | `evaluate` | 91.6 [91.5, 91.8] | 116.8 |
| open-f2p | `play` | 83.8 [83.3, 84.1] | 127.4 |
| open-f2p | `full` | 92.1 [91.7, 94.4] | 222.5 |
| open-f2p | `duo` | 83.7 [82.9, 83.8] | 126.1 |
| open-f2p | `duo-sidebar` | 85.0 [84.6, 85.6] | 127.0 |
| open-f2p | `predict` | 130.1 [127.6, 132.2] | 169.9 |
| open-f2p | `death-estimates` | 106.9 [104.6, 107.1] | 117.9 |
| open-f2p | `chunk-planning` | 84.2 [83.7, 84.3] | 95.9 |
| open-f2p | `sandbox` | 88.3 [87.9, 88.5] | 140.4 |
| open-f2p | `area-check` | 97.6 [97.0, 101.2] | 151.0 |
| open-f2p | `evaluateRollPool` 0 | — | 75.7 |
| open-f2p | `evaluateRollPool` 1 | — | 76.4 |
Worker RSS includes its relay-host and task isolate, not the preparation/caller process. Baseline warm-end RSS is measured from `/proc` after the reply and is not post-GC RSS. The separate CPU-only diagnostic records Linux `VmHWM` after its cold/warm work and any additional warm repeats, before CPU-profile materialisation. These are 1-interval instrumented peaks, including startup and CPU-sampler overhead, not 5-run unprofiled peak estimates. Pool peaks cover their whole fresh main-thread process, including preparation.

The initial worker-side `process.resourceUsage().maxRSS` sample preceded result cloning/relay completion. It was below later post-reply RSS in 45 of 100 released-pack samples, by up to 281288704 bytes, and therefore did not measure the complete operation peak. Those pre-relay values are discarded for capacity reporting. The retained baseline end-RSS values remain valid. The final harness uses the kernel process high-water counter for new baseline runs too. Heap-sampled RSS is not substituted for a baseline peak.

## Stage timings

Cold stage wall time, median [minimum, maximum] ms, 5 trials. Stages can nest (especially prediction), so they must not be summed as independent costs.
| Input | Request | engineMs | collectionMs | presentationMs | activityMs | predictionMs |
| --- | --- | --- | --- | --- | --- | --- |
| Released packs | `play` | 4148.901 [4105.234, 4212.230] | 94.354 [92.583, 96.108] | 118.486 [115.382, 123.408] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| Released packs | `full` | 4176.759 [4049.289, 4281.084] | 101.095 [91.996, 137.992] | 122.841 [116.518, 127.594] | 273.011 [268.953, 286.542] | 0.000 [0.000, 0.000] |
| Released packs | `predict` | 17011.943 [16885.337, 17289.582] | 151.602 [150.414, 191.351] | 950.580 [890.553, 983.093] | 0.000 [0.000, 0.000] | 10627.556 [10440.031, 10760.880] |
| Released packs | `death-estimates` | 13905.572 [13428.656, 14127.847] | 127.453 [120.840, 147.997] | 522.163 [462.867, 590.611] | 0.000 [0.000, 0.000] | 10625.998 [10518.464, 11030.072] |
| Released packs | `sandbox` | 7300.140 [7058.728, 7415.765] | 105.659 [101.187, 108.186] | 247.975 [223.499, 290.448] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| Released packs | `area-check` | 8790.416 [8427.690, 8965.769] | 111.961 [106.462, 119.596] | 345.089 [334.906, 379.971] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| open-f2p | `play` | 41.022 [39.969, 44.238] | 1.014 [0.990, 1.075] | 4.083 [3.779, 4.491] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| open-f2p | `full` | 42.093 [40.402, 45.923] | 1.037 [0.970, 1.076] | 3.982 [3.943, 4.273] | 13.671 [13.499, 13.852] | 0.000 [0.000, 0.000] |
| open-f2p | `predict` | 122.158 [118.221, 139.865] | 1.614 [1.594, 1.800] | 14.728 [12.677, 15.718] | 0.000 [0.000, 0.000] | 62.973 [62.218, 71.439] |
| open-f2p | `death-estimates` | 90.899 [88.607, 95.457] | 1.437 [1.392, 1.525] | 11.193 [8.987, 11.333] | 0.000 [0.000, 0.000] | 67.339 [66.143, 74.091] |
| open-f2p | `sandbox` | 57.625 [54.805, 68.836] | 1.176 [1.127, 1.403] | 5.831 [5.568, 7.108] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| open-f2p | `area-check` | 70.394 [69.736, 77.757] | 1.348 [1.275, 1.723] | 8.040 [7.380, 8.411] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
## Port surface

Physical source lines at START, including comments and blanks. These are behavior owners, not a claim that each file should be translated line-for-line. A conservative traversal of literal relative `.mjs` imports from `worker.mjs` and `rules.mjs` reaches 138 modules / 18,281 lines, including storage-independent command validation, dataset loaders and optional providers. It excludes JSON assets and computed dynamic imports. The following table identifies the main executable surface; supporting modules and dataset values remain required wherever referenced.

| Module | Lines | Port obligation |
| --- | ---: | --- |
| `app/tasks/worker.mjs` | 424 | Request dispatch, bounded snapshots, views, caches, cancellation, serialization |
| `app/tasks/engine.mjs` | 1498 | Compilation, task metadata, capability fixed point, training, source gates |
| `app/tasks/access.mjs` | 872 | Source indexes, sections, access closure and access copies |
| `app/tasks/collection.mjs` | 360 | Collection identities, obligations, rates and source evidence |
| `app/tasks/equipment.mjs` | 463 | Gear search, scores, loadouts, recommendations and ties |
| `app/tasks/presentation.mjs` | 360 | Goal selection, primary/alternative ordering and hidden obligations |
| `app/tasks/time-estimates.mjs` | 327 | Drop/training/supply estimates and unknown results |
| `app/tasks/activity.mjs` | 129 | Activity output |
| `app/tasks/activity-readiness.mjs` | 97 | Activity readiness gates |
| `app/tasks/area-check.mjs` | 216 | Hypothetical scenarios and method comparison |
| `app/tasks/area-check-tasks.mjs` | 23 | Task differences |
| `app/tasks/chunk-planning-index.mjs` | 108 | Location/clue index and evidence |
| `app/tasks/map-task-locations.mjs` | 33 | Map projection |
| `app/tasks/unlock-reuse.mjs` | 184 | Exact reuse fingerprint and compressed reusable results |
| `app/tasks/training-availability.mjs` | 115 | Training facts |
| `app/tasks/training-planner.mjs` | 314 | Training plans and blockers |
| `app/tasks/processing.mjs` | 162 | Processing capability discovery |
| `app/tasks/reviewed-supplies.mjs` | 85 | Supply requirements and finite rewards |
| `app/tasks/boss-gates.mjs` | 169 | Boss gates and gear requirements |
| `app/tasks/house-storage.mjs` | 91 | Derived storage goals |
| `app/tasks/rates.mjs` | 53 | Probability composition, cutoff semantics and evidence |
| `app/tasks/identity.mjs` | 329 | Permanent/generated identities and aliases |
| `app/tasks/migration.mjs` | 968 | Legacy compatibility and fact projection; consume prepared state where possible |
| `app/tasks/fact-projection.mjs` | 127 | Personal fact semantics |
| `app/tasks/eligibility-cache.mjs` | 79 | Completion overlay and mutable result replay |
| `app/tasks/obligation-cache.mjs` | 42 | Own obligations and bounded reuse |
| `app/core/planning.mjs` | 153 | Unlock prediction and task/access deltas |
| `app/core/rules.mjs` | 494 | Roll candidates, exclusions, reasons and access policy |
| `app/core/rule-registry.mjs` | 53 | Defaults, validation and hook registry |
| `app/core/automatic-transport.mjs` | 222 | Task-engine-backed travel supplies and baseline caches |
| `app/core/transport-access.mjs` | 460 | Routes, costs, budgets and reachability paths |
| `app/core/territory.mjs` | 215 | Partner connections |
| `app/core/cache-surface.mjs` | 84 | Surface/component reachability |
| `app/core/map-boundaries.mjs` | 38 | Entry sections and boundary gates |
| `app/core/teleport-returns.mjs` | 117 | Personal teleport semantics |
| `app/core/travel-inputs.mjs` | 48 | Conservative travel fingerprints |
| `app/core/state.mjs` | 2295 | Prediction validates state and applies unlock semantics; port the reachable subset |
| `app/play-view.mjs` | 124 | Compact task/result representation |
| `app/duo-play-view.mjs` | 73 | Group/sidebar projection |
| `app/sandbox.mjs` | 135 | Draft normalization, application and deltas |
| `app/dataset-runtime.mjs` | 119 | Provider value resolution and immutable values |
| `app/dataset-pipeline.mjs` | 78 | Preparation ledger and corrections order |
| `app/datasets.mjs` | 410 | Selection, pack verification, contract and digest |
| `app/data/world.mjs` | 143 | Prepared topology representation |
Additional training/banking/fishing/processing helpers, membership policies, skill-guide overlays, reviewed corrections and settings must follow their imported contracts. Reuse pinned JSON and rule-text inputs, never executable pack code. The init bundle is currently incomplete for another language: `datasetValue`/`datasetJSON` still read selected pack values directly. Agree a self-contained, hash-verified input bundle or explicit named pack files through the protocol process before implementation. No protocol, server, worker or state change is included here.

Hard port boundaries:

- Rule candidate/exclusion closures are authored JavaScript hooks with frozen, sometimes `Map`/`Set` contexts. Reimplement each built-in hook by stable identity; retain reference fallback for unsupported custom hooks. Do not interpret pack text as executable code.
- Preserve capability fixed-point order, personal completion versus shared access, backlog semantics, membership, section overrides, finite supplies, route budgets and exact cache keys. Compiled metadata contains shared object identity and non-enumerable facts; a plain JSON round trip is insufficient.
- Match JavaScript IEEE-754 arithmetic, `Infinity`/unknown handling, epsilon ties, `toFixed` rounding, drop-rate composition and `Math.log1p` estimates. Keep formatted evidence strings byte-compatible. Match UTF-16 ordering and ICU `localeCompare` ties explicitly; Rust default string sorting/formatting is not equivalent.
- Preserve stable identities, legacy alias resolution, deterministic arrays, missing versus null fields, compressed reuse CRC/length semantics, per-picker cancellation/supersession and snapshot-miss resends. Cross-language state references must not assume the fallback process has already seen that state.

## Bake-off decision

The numerical interpretation and proposed first target follow below. Estimates are capacity bounds or acceptance targets, not measured replacement results.
1. Port `evaluate` first under the existing request-type `supports` fallback, including all its views and projection flags. Use `play-v1` as the first internal development milestone, without advertising support until all evaluate variants pass. Cold play costs 4.808 s and 8.194 core-s; `engineMs` owns most cold work. This exercises the common engine/access/collection/equipment/presentation core reused by prediction and advisory requests. Keep every non-evaluate request on the reference initially. The current `supports` field is request-type granular, so a play-only spike cannot claim `evaluate` support; it must remain an internal benchmark until full views/projections pass too.
2. Address `roll-pool` immediately after that core is available. It blocks the HTTP thread for 3.278 s cold and 66.598 ms warm at roster position 0. It is not an independent small graph walk: `automatic-transport.mjs` can instantiate/evaluate the task engine. Moving it to a process removes event-loop blocking but does not itself reduce its measured core-seconds. `roll-pool` is a new protocol operation; reference support/adapter routing is a prerequisite owned by the orchestrator, not a change in this task.
3. Run an optimised-JS contender on exactly the same boundary. Reuse each worker's compiled dataset across pickers with bounded picker/input caches, use compact results by default, and avoid rebuilding full views or serializing the same result twice. Warm full costs 388.776 ms versus 54.256 ms for compact play. Real-pool profiles rank `obligation-cache.mjs:evaluate`, `createCompiledTaskEngine`, `check` and GC highly. Precompute task/membership identities and conservative obligation masks; benchmark an incrementally maintained recursion-path mask with collision-safe stack accounting instead of rebuilding it from `visiting` for every lookup. Extend the existing conditional access-index sharing to other immutable compile metadata when the relevant definition branches are identical. Target source/access/fixed-point allocations with integer indexes, reusable worklists and cached immutable projections; avoid repeated JSON/clone/fingerprint work only where exact invalidation is proven. Carry current non-enumerable metadata and caller mutation isolation forward. Judge changes by core-seconds/RSS, not just a cached same-state wall time.
4. Compare reference, optimised JS and native with 1, 8 and 32 picker identities, one dataset digest, equal arrival schedules and the same bounded cache budget. Run idle/wake, cold new picker, exact warm repeat, alternating inputs beyond 2-entry caches, prediction batches of 1/3/10, changed preferences/rules, cancellation and 2 mixed picker revisions. Use at least 5 independent interleaved runs per contender; report median/min/max ready wall, core-s, p50/p95 queue-inclusive latency, steady/peak combined RSS and completed throughput. Keep the server/process mode and pack hashes fixed. During partial rollout count both the candidate and any resident reference fallback in combined RSS and CPU; coexistence can erase a per-calculator memory win. The 32-picker case must use a bounded calculator pool, not 32 unbounded concurrent reference workers.
5. Baseline worker startup is 4.281 s, 6.278 core-s and 688.0 MiB ready RSS. For 8 pickers using the same measured compiled variant, at 8 independent starts, startup alone sums to about 50.2 core-s and 5.38 GiB ready RSS. Sharing one compiled instance has an upper-bound removable duplicate cost of 43.9 core-s and 4.70 GiB, before per-picker state/results and concurrency overhead. There are up to 8 combinations of the 3 guide-variant booleans in `createTaskEngine`; sharing must key the complete variant and preserve conditional index sharing. Both JS and native can gain from pooling; these are not language-specific wins. At a 4-core quota, the measured cold-play CPU implies an ideal upper bound of 0.49 evaluations/s before queue/other-server costs. A 50% CPU reduction would approximately double that CPU-bound ceiling; RSS reduction must be demonstrated separately.
6. Require zero checker differences across all supported requests, real-save copies and public/synthetic edge cases before switching traffic. Compare ordered result parts and full reusable owner/partner outputs, not just task counts. Include rule variants, unknown estimates, scalar formatting, cold/warm equivalence, mutation safety, stale snapshots, cache eviction and cancellation. Native and JS must start from the same prepared input; a smaller or less-reviewed dataset is not a win. Proposed promotion bar: at least 2x lower cold CPU and 2x lower steady worker RSS, without worse startup or correctness; treat these as targets to test, not forecasts. If JS reaches the same envelope, prefer its smaller semantic migration cost.
## CPU self-time rankings

Each row lists the top 15 sampled function/module/source-location frames in descending self time, with 1-based line and column (0 marks a native/no-source frame). Values are seconds from 1 separate CPU-only fresh-worker diagnostic interval per request/roster position; five earlier joint CPU/heap runs also support the named-hotspot conclusions. The CPU-only interval avoids heap-sampler overhead and separates anonymous closures by source location. Short intervals include the documented additional warm repetitions. V8 frames and anonymous module frames are kept rather than misattributed. Sampled time can include scheduling pauses; use the unprofiled CPU table for capacity.
### Released packs
`roll-pool-0`: 3.727 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(garbage collector):0:0` | 0.371 |
| 2 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.363 |
| 3 | `obligation-cache.mjs:evaluate:18:13` | 0.360 |
| 4 | `node:inspector:post:115:7` | 0.183 |
| 5 | `engine.mjs:check:882:19` | 0.168 |
| 6 | `engine.mjs:(anonymous):798:55` | 0.152 |
| 7 | `transport-access.mjs:baseOf:11:16` | 0.110 |
| 8 | `obligation-cache.mjs:mask:7:16` | 0.105 |
| 9 | `engine.mjs:(anonymous):1277:31` | 0.097 |
| 10 | `engine.mjs:evaluatePass:383:25` | 0.088 |
| 11 | `engine.mjs:ownItemOrigin:791:27` | 0.079 |
| 12 | `transport-access.mjs:transportReachabilityPaths:358:43` | 0.066 |
| 13 | `engine.mjs:obligation:817:24` | 0.062 |
| 14 | `identity.mjs:permanentTaskId:78:32` | 0.062 |
| 15 | `cache-resources.mjs:applyCacheResources:31:36` | 0.054 |

`roll-pool-1`: 3.155 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.382 |
| 2 | `v8:(garbage collector):0:0` | 0.270 |
| 3 | `engine.mjs:check:882:19` | 0.234 |
| 4 | `node:inspector:post:115:7` | 0.175 |
| 5 | `engine.mjs:evaluatePass:383:25` | 0.147 |
| 6 | `engine.mjs:(anonymous):1277:31` | 0.138 |
| 7 | `engine.mjs:normalize:112:19` | 0.069 |
| 8 | `identity.mjs:permanentTaskId:78:32` | 0.057 |
| 9 | `engine.mjs:variant:156:19` | 0.053 |
| 10 | `obligation-cache.mjs:evaluate:18:13` | 0.053 |
| 11 | `engine.mjs:computeEligibility:1365:30` | 0.052 |
| 12 | `engine.mjs:prepareEvaluation:319:29` | 0.044 |
| 13 | `transport-access.mjs:baseOf:11:16` | 0.043 |
| 14 | `cache-resources.mjs:applyCacheResources:31:36` | 0.039 |
| 15 | `engine.mjs:compileAlias:102:22` | 0.037 |

`evaluate`: 8.014 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 1.956 |
| 2 | `obligation-cache.mjs:evaluate:18:13` | 0.754 |
| 3 | `node:inspector:post:115:7` | 0.430 |
| 4 | `v8:(garbage collector):0:0` | 0.393 |
| 5 | `engine.mjs:check:882:19` | 0.356 |
| 6 | `engine.mjs:(anonymous):1277:31` | 0.259 |
| 7 | `obligation-cache.mjs:mask:7:16` | 0.246 |
| 8 | `engine.mjs:(anonymous):798:55` | 0.243 |
| 9 | `engine-profile.mjs:parentPort.postMessage:37:28` | 0.215 |
| 10 | `engine.mjs:evaluatePass:383:25` | 0.199 |
| 11 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.173 |
| 12 | `engine.mjs:ownItemOrigin:791:27` | 0.146 |
| 13 | `worker.mjs:serializedState:272:25` | 0.139 |
| 14 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.128 |
| 15 | `engine.mjs:obligation:817:24` | 0.124 |

`play`: 5.494 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 0.721 |
| 2 | `v8:(garbage collector):0:0` | 0.402 |
| 3 | `node:inspector:post:115:7` | 0.379 |
| 4 | `engine.mjs:check:882:19` | 0.325 |
| 5 | `obligation-cache.mjs:mask:7:16` | 0.291 |
| 6 | `engine.mjs:(anonymous):1277:31` | 0.245 |
| 7 | `engine.mjs:(anonymous):798:55` | 0.231 |
| 8 | `engine.mjs:evaluatePass:383:25` | 0.218 |
| 9 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.182 |
| 10 | `engine.mjs:ownItemOrigin:791:27` | 0.144 |
| 11 | `engine.mjs:obligation:817:24` | 0.109 |
| 12 | `transport-access.mjs:personalFacts:102:23` | 0.108 |
| 13 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.107 |
| 14 | `worker.mjs:serializedState:272:25` | 0.107 |
| 15 | `node:v8:serialize:453:19` | 0.092 |

`full`: 6.525 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 0.724 |
| 2 | `worker.mjs:sharedJSON:255:20` | 0.520 |
| 3 | `v8:(garbage collector):0:0` | 0.415 |
| 4 | `node:inspector:post:115:7` | 0.375 |
| 5 | `engine.mjs:check:882:19` | 0.332 |
| 6 | `obligation-cache.mjs:mask:7:16` | 0.283 |
| 7 | `engine.mjs:(anonymous):798:55` | 0.256 |
| 8 | `engine.mjs:(anonymous):1277:31` | 0.233 |
| 9 | `engine.mjs:evaluatePass:383:25` | 0.203 |
| 10 | `v8:(idle):0:0` | 0.191 |
| 11 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.183 |
| 12 | `engine.mjs:ownItemOrigin:791:27` | 0.143 |
| 13 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.113 |
| 14 | `engine.mjs:obligation:817:24` | 0.106 |
| 15 | `transport-access.mjs:personalFacts:102:23` | 0.104 |

`duo`: 5.318 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 0.779 |
| 2 | `v8:(garbage collector):0:0` | 0.317 |
| 3 | `node:inspector:post:115:7` | 0.312 |
| 4 | `engine.mjs:check:882:19` | 0.300 |
| 5 | `engine.mjs:(anonymous):798:55` | 0.261 |
| 6 | `engine.mjs:(anonymous):1277:31` | 0.215 |
| 7 | `obligation-cache.mjs:mask:7:16` | 0.214 |
| 8 | `engine.mjs:ownItemOrigin:791:27` | 0.183 |
| 9 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.164 |
| 10 | `engine.mjs:evaluatePass:383:25` | 0.143 |
| 11 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.121 |
| 12 | `transport-access.mjs:personalFacts:102:23` | 0.108 |
| 13 | `engine.mjs:obligation:817:24` | 0.102 |
| 14 | `node:v8:serialize:453:19` | 0.084 |
| 15 | `v8:(idle):0:0` | 0.083 |

`duo-sidebar`: 5.444 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 0.691 |
| 2 | `node:inspector:post:115:7` | 0.439 |
| 3 | `v8:(garbage collector):0:0` | 0.374 |
| 4 | `obligation-cache.mjs:mask:7:16` | 0.301 |
| 5 | `engine.mjs:check:882:19` | 0.300 |
| 6 | `engine.mjs:(anonymous):798:55` | 0.244 |
| 7 | `engine.mjs:(anonymous):1277:31` | 0.236 |
| 8 | `engine.mjs:ownItemOrigin:791:27` | 0.198 |
| 9 | `engine.mjs:evaluatePass:383:25` | 0.187 |
| 10 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.159 |
| 11 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.120 |
| 12 | `worker.mjs:serializedState:272:25` | 0.118 |
| 13 | `transport-access.mjs:personalFacts:102:23` | 0.101 |
| 14 | `engine.mjs:obligation:817:24` | 0.093 |
| 15 | `node:v8:serialize:453:19` | 0.088 |

`predict`: 37.938 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 5.723 |
| 2 | `engine.mjs:check:882:19` | 3.128 |
| 3 | `v8:(garbage collector):0:0` | 2.919 |
| 4 | `engine.mjs:(anonymous):1277:31` | 2.050 |
| 5 | `obligation-cache.mjs:mask:7:16` | 1.738 |
| 6 | `engine.mjs:evaluatePass:383:25` | 1.621 |
| 7 | `engine.mjs:(anonymous):798:55` | 1.470 |
| 8 | `engine.mjs:ownItemOrigin:791:27` | 1.388 |
| 9 | `node:v8:serialize:453:19` | 1.305 |
| 10 | `transport-access.mjs:personalFacts:102:23` | 1.241 |
| 11 | `engine.mjs:obligation:817:24` | 0.914 |
| 12 | `v8:(idle):0:0` | 0.749 |
| 13 | `transport-access.mjs:baseOf:11:16` | 0.597 |
| 14 | `presentation.mjs:selectPresentedTasks:92:37` | 0.527 |
| 15 | `transport-access.mjs:transportReachabilityPaths:358:43` | 0.412 |

`death-estimates`: 16.700 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 3.055 |
| 2 | `v8:(garbage collector):0:0` | 1.187 |
| 3 | `engine.mjs:check:882:19` | 1.040 |
| 4 | `obligation-cache.mjs:mask:7:16` | 1.023 |
| 5 | `engine.mjs:(anonymous):1277:31` | 0.834 |
| 6 | `engine.mjs:(anonymous):798:55` | 0.818 |
| 7 | `v8:(idle):0:0` | 0.622 |
| 8 | `transport-access.mjs:personalFacts:102:23` | 0.578 |
| 9 | `engine.mjs:evaluatePass:383:25` | 0.577 |
| 10 | `engine.mjs:ownItemOrigin:791:27` | 0.537 |
| 11 | `transport-access.mjs:baseOf:11:16` | 0.450 |
| 12 | `engine.mjs:obligation:817:24` | 0.376 |
| 13 | `node:v8:serialize:453:19` | 0.336 |
| 14 | `node:inspector:post:115:7` | 0.315 |
| 15 | `transport-access.mjs:transportReachabilityPaths:358:43` | 0.233 |

`chunk-planning`: 5.748 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 0.720 |
| 2 | `node:inspector:post:115:7` | 0.469 |
| 3 | `v8:(garbage collector):0:0` | 0.399 |
| 4 | `engine.mjs:check:882:19` | 0.347 |
| 5 | `obligation-cache.mjs:mask:7:16` | 0.274 |
| 6 | `engine.mjs:(anonymous):798:55` | 0.265 |
| 7 | `engine.mjs:(anonymous):1277:31` | 0.226 |
| 8 | `engine.mjs:evaluatePass:383:25` | 0.214 |
| 9 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.189 |
| 10 | `chunk-planning-index.mjs:add:46:15` | 0.144 |
| 11 | `engine.mjs:ownItemOrigin:791:27` | 0.134 |
| 12 | `worker.mjs:serializedState:272:25` | 0.127 |
| 13 | `transport-access.mjs:personalFacts:102:23` | 0.111 |
| 14 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.109 |
| 15 | `engine.mjs:obligation:817:24` | 0.104 |

`sandbox`: 9.276 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 1.556 |
| 2 | `engine.mjs:check:882:19` | 0.646 |
| 3 | `v8:(garbage collector):0:0` | 0.594 |
| 4 | `obligation-cache.mjs:mask:7:16` | 0.489 |
| 5 | `engine.mjs:(anonymous):798:55` | 0.463 |
| 6 | `node:inspector:post:115:7` | 0.451 |
| 7 | `engine.mjs:(anonymous):1277:31` | 0.449 |
| 8 | `engine.mjs:evaluatePass:383:25` | 0.320 |
| 9 | `engine.mjs:ownItemOrigin:791:27` | 0.295 |
| 10 | `transport-access.mjs:personalFacts:102:23` | 0.219 |
| 11 | `engine.mjs:obligation:817:24` | 0.214 |
| 12 | `node:v8:serialize:453:19` | 0.182 |
| 13 | `engine.mjs:createCompiledTaskEngine:184:34` | 0.179 |
| 14 | `fact-projection.mjs:projectMemberTaskFacts:32:39` | 0.139 |
| 15 | `worker.mjs:serializedState:272:25` | 0.130 |

`area-check`: 12.328 sampled s, 0 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `obligation-cache.mjs:evaluate:18:13` | 1.882 |
| 2 | `v8:(garbage collector):0:0` | 0.894 |
| 3 | `engine.mjs:check:882:19` | 0.712 |
| 4 | `obligation-cache.mjs:mask:7:16` | 0.647 |
| 5 | `js_transferable:structuredClone:113:25` | 0.632 |
| 6 | `engine.mjs:(anonymous):1277:31` | 0.562 |
| 7 | `engine.mjs:(anonymous):798:55` | 0.523 |
| 8 | `engine.mjs:evaluatePass:383:25` | 0.460 |
| 9 | `node:inspector:post:115:7` | 0.409 |
| 10 | `engine.mjs:ownItemOrigin:791:27` | 0.378 |
| 11 | `area-check.mjs:candidateMethods:49:26` | 0.300 |
| 12 | `engine.mjs:obligation:817:24` | 0.261 |
| 13 | `node:v8:serialize:453:19` | 0.254 |
| 14 | `transport-access.mjs:personalFacts:102:23` | 0.241 |
| 15 | `node:v8:deserialize:466:21` | 0.240 |

### open-f2p
`roll-pool-0`: 0.999 sampled s, 56126 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `rules.mjs:evaluateRollPool:325:33` | 0.202 |
| 2 | `rules.mjs:candidates:107:36` | 0.147 |
| 3 | `rules.mjs:normalizeReasons:339:28` | 0.123 |
| 4 | `rules.mjs:(anonymous):339:63` | 0.088 |
| 5 | `rules.mjs:placeName:34:19` | 0.080 |
| 6 | `rules.mjs:(anonymous):130:55` | 0.070 |
| 7 | `rules.mjs:blockersFor:341:23` | 0.069 |
| 8 | `map-boundaries.mjs:isWalkingSectionEdge:9:37` | 0.032 |
| 9 | `rules.mjs:connectionIsReachable:217:31` | 0.025 |
| 10 | `rules.mjs:(anonymous):131:23` | 0.023 |
| 11 | `node:inspector:post:115:7` | 0.022 |
| 12 | `v8:(garbage collector):0:0` | 0.020 |
| 13 | `engine-profile.mjs:main:98:20` | 0.019 |
| 14 | `rules.mjs:(anonymous):352:169` | 0.013 |
| 15 | `rules.mjs:checkedDetail:193:23` | 0.010 |

`roll-pool-1`: 0.999 sampled s, 54098 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `rules.mjs:evaluateRollPool:325:33` | 0.232 |
| 2 | `rules.mjs:candidates:107:36` | 0.187 |
| 3 | `rules.mjs:normalizeReasons:339:28` | 0.092 |
| 4 | `rules.mjs:(anonymous):339:63` | 0.078 |
| 5 | `rules.mjs:blockersFor:341:23` | 0.069 |
| 6 | `rules.mjs:(anonymous):130:55` | 0.051 |
| 7 | `rules.mjs:placeName:34:19` | 0.046 |
| 8 | `v8:(garbage collector):0:0` | 0.032 |
| 9 | `rules.mjs:connectionIsReachable:217:31` | 0.031 |
| 10 | `map-boundaries.mjs:isWalkingSectionEdge:9:37` | 0.028 |
| 11 | `node:inspector:post:115:7` | 0.025 |
| 12 | `engine-profile.mjs:main:98:20` | 0.024 |
| 13 | `rules.mjs:(anonymous):131:23` | 0.023 |
| 14 | `rules.mjs:checkedDetail:193:23` | 0.015 |
| 15 | `rules.mjs:reachableSections:257:34` | 0.011 |

`evaluate`: 1.004 sampled s, 93 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.767 |
| 2 | `engine-profile.mjs:parentPort.postMessage:37:28` | 0.120 |
| 3 | `node:inspector:post:115:7` | 0.031 |
| 4 | `engine.mjs:evaluatePass:383:25` | 0.009 |
| 5 | `activity.mjs:order:45:17` | 0.008 |
| 6 | `v8:postMessage:0:0` | 0.007 |
| 7 | `engine.mjs:computeEligibility:1365:30` | 0.003 |
| 8 | `boss-gates.mjs:evaluateGateGear:108:26` | 0.003 |
| 9 | `v8:cpuUsage:0:0` | 0.003 |
| 10 | `engine.mjs:check:882:19` | 0.002 |
| 11 | `training-planner.mjs:trainingMethodBlockers:76:39` | 0.002 |
| 12 | `engine.mjs:(anonymous):1277:31` | 0.002 |
| 13 | `engine.mjs:has:807:19` | 0.002 |
| 14 | `presentation.mjs:selectPresentedTasks:92:37` | 0.002 |
| 15 | `engine.mjs:source:1393:13` | 0.002 |

`play`: 1.005 sampled s, 737 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.451 |
| 2 | `worker.mjs:sharedJSON:255:20` | 0.153 |
| 3 | `worker.mjs:(anonymous):297:26` | 0.109 |
| 4 | `play-view.mjs:projectPlayResult:87:34` | 0.060 |
| 5 | `play-view.mjs:projectPlayTask:69:32` | 0.057 |
| 6 | `node:inspector:post:115:7` | 0.032 |
| 7 | `v8:postMessage:0:0` | 0.026 |
| 8 | `v8:(anonymous):0:0` | 0.017 |
| 9 | `v8:(garbage collector):0:0` | 0.012 |
| 10 | `helper-task-levels.mjs:helperTaskLevels:4:33` | 0.009 |
| 11 | `v8:cpuUsage:0:0` | 0.006 |
| 12 | `v8:(program):0:0` | 0.005 |
| 13 | `engine.mjs:evaluatePass:383:25` | 0.004 |
| 14 | `engine.mjs:check:882:19` | 0.003 |
| 15 | `boss-gates.mjs:(anonymous):109:42` | 0.003 |

`full`: 1.005 sampled s, 116 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `worker.mjs:sharedJSON:255:20` | 0.516 |
| 2 | `v8:(idle):0:0` | 0.183 |
| 3 | `buffer:utf8Write:982:19` | 0.109 |
| 4 | `v8:(anonymous):0:0` | 0.047 |
| 5 | `node:inspector:post:115:7` | 0.031 |
| 6 | `v8:(garbage collector):0:0` | 0.020 |
| 7 | `play-view.mjs:projectPlayTask:69:32` | 0.010 |
| 8 | `activity.mjs:order:45:17` | 0.009 |
| 9 | `play-view.mjs:projectPlayResult:87:34` | 0.008 |
| 10 | `engine.mjs:evaluatePass:383:25` | 0.003 |
| 11 | `v8:(program):0:0` | 0.003 |
| 12 | `node:v8:serialize:453:19` | 0.002 |
| 13 | `engine.mjs:check:882:19` | 0.002 |
| 14 | `engine.mjs:prepareEvaluation:319:29` | 0.002 |
| 15 | `engine-profile.mjs:parentPort.postMessage:37:28` | 0.002 |

`duo`: 0.999 sampled s, 545 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.347 |
| 2 | `worker.mjs:sharedJSON:255:20` | 0.230 |
| 3 | `play-view.mjs:projectPlayTask:69:32` | 0.064 |
| 4 | `play-view.mjs:projectPlayResult:87:34` | 0.037 |
| 5 | `progress-index.mjs:createTaskFactsIndex:6:37` | 0.037 |
| 6 | `node:inspector:post:115:7` | 0.032 |
| 7 | `v8:(garbage collector):0:0` | 0.025 |
| 8 | `fact-projection.mjs:resolvePersistedIdentity:6:41` | 0.024 |
| 9 | `worker.mjs:(anonymous):297:26` | 0.022 |
| 10 | `progress-index.mjs:get:33:8` | 0.021 |
| 11 | `progress-index.mjs:(anonymous):12:61` | 0.012 |
| 12 | `v8:(anonymous):0:0` | 0.012 |
| 13 | `progress-index.mjs:(anonymous):16:68` | 0.011 |
| 14 | `engine.mjs:evaluatePass:383:25` | 0.009 |
| 15 | `event_target:(anonymous):793:20` | 0.008 |

`duo-sidebar`: 1.000 sampled s, 520 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.339 |
| 2 | `worker.mjs:sharedJSON:255:20` | 0.262 |
| 3 | `play-view.mjs:projectPlayTask:69:32` | 0.056 |
| 4 | `progress-index.mjs:createTaskFactsIndex:6:37` | 0.040 |
| 5 | `play-view.mjs:projectPlayResult:87:34` | 0.032 |
| 6 | `node:inspector:post:115:7` | 0.032 |
| 7 | `v8:(anonymous):0:0` | 0.023 |
| 8 | `duo-play-view.mjs:projectDuoSidebarResult:61:40` | 0.020 |
| 9 | `v8:(garbage collector):0:0` | 0.016 |
| 10 | `progress-index.mjs:(anonymous):12:61` | 0.014 |
| 11 | `progress-index.mjs:get:33:8` | 0.014 |
| 12 | `duo-play-view.mjs:projectRows:27:21` | 0.013 |
| 13 | `fact-projection.mjs:resolvePersistedIdentity:6:41` | 0.013 |
| 14 | `worker.mjs:(anonymous):297:26` | 0.012 |
| 15 | `progress-index.mjs:(anonymous):16:68` | 0.011 |

`predict`: 1.023 sampled s, 8 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.084 |
| 2 | `node:v8:serialize:453:19` | 0.080 |
| 3 | `v8:(garbage collector):0:0` | 0.076 |
| 4 | `engine.mjs:(anonymous):1277:31` | 0.060 |
| 5 | `engine.mjs:check:882:19` | 0.046 |
| 6 | `worker.mjs:sharedJSON:255:20` | 0.042 |
| 7 | `boss-gates.mjs:evaluateBossGate:130:33` | 0.042 |
| 8 | `boss-gates.mjs:(anonymous):109:42` | 0.040 |
| 9 | `v8:writeSync:0:0` | 0.035 |
| 10 | `engine.mjs:evaluatePass:383:25` | 0.033 |
| 11 | `node:inspector:post:115:7` | 0.033 |
| 12 | `presentation.mjs:selectPresentedTasks:92:37` | 0.024 |
| 13 | `play-view.mjs:projectPlayTask:69:32` | 0.013 |
| 14 | `engine.mjs:computeEligibility:1365:30` | 0.012 |
| 15 | `boss-gates.mjs:evaluateGateGear:108:26` | 0.011 |

`death-estimates`: 0.999 sampled s, 917 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.690 |
| 2 | `engine-profile.mjs:parentPort.postMessage:37:28` | 0.074 |
| 3 | `node:inspector:post:115:7` | 0.032 |
| 4 | `v8:postMessage:0:0` | 0.028 |
| 5 | `v8:(program):0:0` | 0.021 |
| 6 | `engine.mjs:computeEligibility:1365:30` | 0.008 |
| 7 | `v8:(garbage collector):0:0` | 0.008 |
| 8 | `engine.mjs:(anonymous):1346:20` | 0.008 |
| 9 | `engine.mjs:evaluatePass:383:25` | 0.007 |
| 10 | `worker.mjs:(anonymous):297:26` | 0.006 |
| 11 | `engine.mjs:(anonymous):1277:31` | 0.006 |
| 12 | `node:v8:serialize:453:19` | 0.004 |
| 13 | `engine.mjs:markBaseSources:682:29` | 0.004 |
| 14 | `boss-gates.mjs:evaluateBossGate:130:33` | 0.004 |
| 15 | `boss-gates.mjs:(anonymous):109:42` | 0.003 |

`chunk-planning`: 0.999 sampled s, 1646 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.692 |
| 2 | `engine-profile.mjs:parentPort.postMessage:37:28` | 0.056 |
| 3 | `v8:postMessage:0:0` | 0.055 |
| 4 | `node:inspector:post:115:7` | 0.033 |
| 5 | `v8:cpuUsage:0:0` | 0.026 |
| 6 | `worker.mjs:(anonymous):297:26` | 0.017 |
| 7 | `play-view.mjs:projectPlayTask:69:32` | 0.012 |
| 8 | `v8:(program):0:0` | 0.011 |
| 9 | `worker.mjs:(anonymous):184:121` | 0.009 |
| 10 | `v8:(garbage collector):0:0` | 0.008 |
| 11 | `engine.mjs:evaluatePass:383:25` | 0.007 |
| 12 | `engine.mjs:check:882:19` | 0.004 |
| 13 | `event_target:(anonymous):793:20` | 0.004 |
| 14 | `worker.mjs:snapshotFor:156:21` | 0.004 |
| 15 | `helper-task-levels.mjs:helperTaskLevels:4:33` | 0.004 |

`sandbox`: 1.000 sampled s, 729 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `v8:(idle):0:0` | 0.458 |
| 2 | `worker.mjs:sharedJSON:255:20` | 0.195 |
| 3 | `worker.mjs:(anonymous):392:66` | 0.115 |
| 4 | `node:inspector:post:115:7` | 0.033 |
| 5 | `v8:postMessage:0:0` | 0.019 |
| 6 | `v8:(anonymous):0:0` | 0.016 |
| 7 | `v8:(program):0:0` | 0.013 |
| 8 | `v8:cpuUsage:0:0` | 0.011 |
| 9 | `engine.mjs:evaluatePass:383:25` | 0.011 |
| 10 | `event_target:(anonymous):793:20` | 0.010 |
| 11 | `sandbox.mjs:object:14:16` | 0.009 |
| 12 | `v8:(garbage collector):0:0` | 0.008 |
| 13 | `worker.mjs:sandboxFor:189:20` | 0.008 |
| 14 | `engine.mjs:(anonymous):1277:31` | 0.006 |
| 15 | `node:buffer:from:337:28` | 0.003 |

`area-check`: 1.002 sampled s, 80 additional warm batch repetitions.
| Rank | Function/module | Self seconds |
| ---: | --- | ---: |
| 1 | `node:v8:deserialize:466:21` | 0.278 |
| 2 | `js_transferable:structuredClone:113:25` | 0.148 |
| 3 | `v8:(garbage collector):0:0` | 0.117 |
| 4 | `v8:(idle):0:0` | 0.050 |
| 5 | `presentation.mjs:selectPresentedTasks:92:37` | 0.049 |
| 6 | `node:inspector:post:115:7` | 0.034 |
| 7 | `presentation.mjs:legacyFlags:128:23` | 0.018 |
| 8 | `eligibility-cache.mjs:(anonymous):32:29` | 0.014 |
| 9 | `presentation.mjs:membersEquipmentRequirement:31:44` | 0.012 |
| 10 | `worker.mjs:evaluateFull:108:22` | 0.011 |
| 11 | `worker.mjs:(anonymous):122:59` | 0.011 |
| 12 | `presentation.mjs:isSkill:108:19` | 0.010 |
| 13 | `engine.mjs:evaluatePass:383:25` | 0.008 |
| 14 | `area-check-tasks.mjs:(anonymous):18:46` | 0.008 |
| 15 | `engine.mjs:check:882:19` | 0.007 |

## Steady-state sampled live allocations

The top 15 allocation function/module groups for each request below use the median sampled-live byte count across the 5 steady-state samples, treating a missing group in a run as 0. Anonymous allocation sites are combined within a module; these heap groups are deliberately broader than the source-located CPU frames. Source interpretation: `resolveDataset`/decoders retain provider catalogues; `createTaskEngine`/`buildAccessIndex` retain compiled records/indexes; `snapshotFor`, evaluation and projection sites retain bounded result graphs, serialized proofs and view/index caches. These are source-based structure descriptions; the measured quantities are allocation-site live sizes, not dominator ownership.
### Released packs
`roll-pool-0`: sampled live MiB 333.32 [331.56, 339.52].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 70.447 |
| 2 | `engine-profile.mjs:main` | 53.096 |
| 3 | `engine.mjs:createCompiledTaskEngine` | 43.547 |
| 4 | `v8:set` | 19.541 |
| 5 | `engine.mjs:(anonymous)` | 18.311 |
| 6 | `v8:filter` | 10.234 |
| 7 | `v8:Set` | 9.933 |
| 8 | `datasets.mjs:loadPack` | 9.690 |
| 9 | `v8:push` | 7.768 |
| 10 | `v8:entries` | 6.785 |
| 11 | `cache-topology.mjs:applyCacheTopology` | 5.569 |
| 12 | `item-membership-index.mjs:createItemMembershipLookup` | 5.510 |
| 13 | `engine.mjs:check` | 5.440 |
| 14 | `identity.mjs:(anonymous)` | 5.129 |
| 15 | `engine.mjs:add` | 4.758 |

`roll-pool-1`: sampled live MiB 341.51 [337.16, 347.09].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 69.707 |
| 2 | `engine-profile.mjs:main` | 53.971 |
| 3 | `engine.mjs:createCompiledTaskEngine` | 43.239 |
| 4 | `engine.mjs:(anonymous)` | 22.830 |
| 5 | `v8:set` | 19.433 |
| 6 | `datasets.mjs:loadPack` | 10.540 |
| 7 | `v8:Set` | 9.839 |
| 8 | `v8:filter` | 9.558 |
| 9 | `v8:push` | 8.442 |
| 10 | `v8:entries` | 6.910 |
| 11 | `cache-topology.mjs:applyCacheTopology` | 5.912 |
| 12 | `engine.mjs:check` | 5.221 |
| 13 | `item-membership-index.mjs:createItemMembershipLookup` | 5.135 |
| 14 | `v8:replace` | 5.067 |
| 15 | `engine.mjs:add` | 4.977 |

`evaluate`: sampled live MiB 490.48 [485.49, 494.22].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 75.257 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 43.341 |
| 3 | `v8:set` | 33.432 |
| 4 | `worker.mjs:serializedState` | 31.297 |
| 5 | `worker.mjs:takeDefinitions` | 26.299 |
| 6 | `engine.mjs:(anonymous)` | 23.951 |
| 7 | `v8:replace` | 22.837 |
| 8 | `node:v8:serialize` | 21.688 |
| 9 | `collection.mjs:addCatalogue` | 20.180 |
| 10 | `v8:Set` | 18.383 |
| 11 | `collection.mjs:visit` | 14.177 |
| 12 | `v8:filter` | 10.743 |
| 13 | `v8:push` | 9.941 |
| 14 | `datasets.mjs:loadPack` | 9.655 |
| 15 | `engine.mjs:add` | 9.015 |

`play`: sampled live MiB 490.12 [488.56, 493.24].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 76.225 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 42.504 |
| 3 | `v8:set` | 33.592 |
| 4 | `worker.mjs:serializedState` | 31.181 |
| 5 | `worker.mjs:takeDefinitions` | 25.195 |
| 6 | `engine.mjs:(anonymous)` | 23.544 |
| 7 | `v8:replace` | 22.023 |
| 8 | `node:v8:serialize` | 21.124 |
| 9 | `collection.mjs:addCatalogue` | 20.430 |
| 10 | `v8:Set` | 19.855 |
| 11 | `collection.mjs:visit` | 13.989 |
| 12 | `v8:push` | 11.039 |
| 13 | `v8:filter` | 10.716 |
| 14 | `datasets.mjs:loadPack` | 9.853 |
| 15 | `engine.mjs:add` | 9.735 |

`full`: sampled live MiB 495.24 [485.83, 497.45].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 75.820 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 42.246 |
| 3 | `v8:set` | 33.576 |
| 4 | `worker.mjs:serializedState` | 32.082 |
| 5 | `worker.mjs:takeDefinitions` | 25.868 |
| 6 | `engine.mjs:(anonymous)` | 23.480 |
| 7 | `v8:replace` | 22.649 |
| 8 | `node:v8:serialize` | 22.094 |
| 9 | `collection.mjs:addCatalogue` | 20.023 |
| 10 | `v8:Set` | 19.855 |
| 11 | `collection.mjs:visit` | 13.958 |
| 12 | `v8:filter` | 10.549 |
| 13 | `v8:push` | 10.388 |
| 14 | `datasets.mjs:loadPack` | 9.950 |
| 15 | `engine.mjs:add` | 9.579 |

`duo`: sampled live MiB 499.26 [497.17, 505.51].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 74.755 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 43.319 |
| 3 | `collection.mjs:addCatalogue` | 34.886 |
| 4 | `v8:set` | 33.779 |
| 5 | `worker.mjs:serializedState` | 32.145 |
| 6 | `worker.mjs:takeDefinitions` | 25.519 |
| 7 | `engine.mjs:(anonymous)` | 25.294 |
| 8 | `v8:replace` | 22.217 |
| 9 | `v8:Set` | 19.574 |
| 10 | `collection.mjs:visit` | 13.676 |
| 11 | `identity.mjs:generatedGoalId` | 11.912 |
| 12 | `v8:filter` | 10.391 |
| 13 | `datasets.mjs:loadPack` | 10.383 |
| 14 | `engine.mjs:add` | 9.517 |
| 15 | `v8:push` | 9.386 |

`duo-sidebar`: sampled live MiB 494.63 [486.12, 498.10].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 74.518 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 43.308 |
| 3 | `v8:set` | 33.830 |
| 4 | `worker.mjs:serializedState` | 32.021 |
| 5 | `worker.mjs:takeDefinitions` | 25.399 |
| 6 | `engine.mjs:(anonymous)` | 24.830 |
| 7 | `v8:replace` | 22.588 |
| 8 | `node:v8:serialize` | 21.594 |
| 9 | `v8:Set` | 19.918 |
| 10 | `collection.mjs:addCatalogue` | 19.586 |
| 11 | `collection.mjs:visit` | 14.270 |
| 12 | `v8:filter` | 10.881 |
| 13 | `datasets.mjs:loadPack` | 10.097 |
| 14 | `v8:push` | 9.815 |
| 15 | `engine.mjs:add` | 9.673 |

`predict`: sampled live MiB 550.31 [546.77, 552.12].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 74.526 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 42.693 |
| 3 | `engine.mjs:(anonymous)` | 34.378 |
| 4 | `collection.mjs:addCatalogue` | 33.884 |
| 5 | `v8:set` | 33.621 |
| 6 | `v8:(V8 API)` | 32.150 |
| 7 | `state.mjs:jsonClone` | 27.578 |
| 8 | `worker.mjs:takeDefinitions` | 24.910 |
| 9 | `v8:replace` | 22.649 |
| 10 | `engine.mjs:check` | 20.424 |
| 11 | `v8:Set` | 19.109 |
| 12 | `collection.mjs:visit` | 13.395 |
| 13 | `identity.mjs:generatedGoalId` | 12.225 |
| 14 | `v8:filter` | 10.547 |
| 15 | `v8:join` | 10.053 |

`death-estimates`: sampled live MiB 552.79 [543.60, 554.76].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 75.871 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 41.943 |
| 3 | `engine.mjs:(anonymous)` | 34.628 |
| 4 | `collection.mjs:addCatalogue` | 33.666 |
| 5 | `v8:set` | 33.305 |
| 6 | `v8:(V8 API)` | 32.393 |
| 7 | `state.mjs:jsonClone` | 28.062 |
| 8 | `worker.mjs:takeDefinitions` | 25.727 |
| 9 | `v8:replace` | 23.181 |
| 10 | `engine.mjs:check` | 19.518 |
| 11 | `v8:Set` | 18.478 |
| 12 | `collection.mjs:visit` | 13.708 |
| 13 | `identity.mjs:generatedGoalId` | 12.256 |
| 14 | `v8:filter` | 10.861 |
| 15 | `v8:join` | 10.604 |

`chunk-planning`: sampled live MiB 567.16 [562.62, 573.34].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 75.885 |
| 2 | `chunk-planning-index.mjs:add` | 56.281 |
| 3 | `v8:set` | 41.778 |
| 4 | `engine.mjs:createCompiledTaskEngine` | 41.584 |
| 5 | `worker.mjs:serializedState` | 30.880 |
| 6 | `worker.mjs:takeDefinitions` | 25.945 |
| 7 | `engine.mjs:(anonymous)` | 24.326 |
| 8 | `node:v8:serialize` | 22.845 |
| 9 | `v8:replace` | 22.432 |
| 10 | `v8:Set` | 19.886 |
| 11 | `collection.mjs:addCatalogue` | 19.617 |
| 12 | `collection.mjs:visit` | 13.676 |
| 13 | `v8:filter` | 10.672 |
| 14 | `v8:push` | 10.393 |
| 15 | `datasets.mjs:loadPack` | 9.843 |

`sandbox`: sampled live MiB 552.23 [547.08, 554.79].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 75.441 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 43.233 |
| 3 | `v8:set` | 42.272 |
| 4 | `engine.mjs:(anonymous)` | 40.335 |
| 5 | `worker.mjs:serializedState` | 31.084 |
| 6 | `node:v8:serialize` | 25.600 |
| 7 | `worker.mjs:takeDefinitions` | 24.765 |
| 8 | `v8:replace` | 21.805 |
| 9 | `collection.mjs:addCatalogue` | 20.744 |
| 10 | `v8:Set` | 19.698 |
| 11 | `engine.mjs:check` | 18.920 |
| 12 | `engine.mjs:add` | 16.903 |
| 13 | `collection.mjs:visit` | 14.208 |
| 14 | `v8:push` | 11.243 |
| 15 | `v8:filter` | 11.111 |

`area-check`: sampled live MiB 509.16 [503.81, 513.30].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `datasets.mjs:json` | 76.041 |
| 2 | `engine.mjs:createCompiledTaskEngine` | 43.220 |
| 3 | `v8:set` | 33.408 |
| 4 | `engine.mjs:(anonymous)` | 31.565 |
| 5 | `worker.mjs:serializedState` | 31.254 |
| 6 | `worker.mjs:takeDefinitions` | 25.524 |
| 7 | `v8:replace` | 21.960 |
| 8 | `node:v8:serialize` | 21.407 |
| 9 | `collection.mjs:addCatalogue` | 20.148 |
| 10 | `v8:Set` | 18.948 |
| 11 | `engine.mjs:check` | 14.291 |
| 12 | `collection.mjs:visit` | 14.146 |
| 13 | `engine.mjs:add` | 12.959 |
| 14 | `v8:filter` | 10.422 |
| 15 | `datasets.mjs:loadPack` | 10.316 |

### open-f2p
`roll-pool-0`: sampled live MiB 5.89 [5.07, 6.22].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `open-f2p.mjs:resolveOpenF2P` | 1.385 |
| 2 | `encoding:decode` | 0.952 |
| 3 | `engine-profile.mjs:main` | 0.706 |
| 4 | `node:inspector:post` | 0.697 |
| 5 | `utils:compileSourceTextModule` | 0.439 |
| 6 | `js_transferable:structuredClone` | 0.156 |
| 7 | `v8:set` | 0.124 |
| 8 | `open-f2p.mjs:freeze` | 0.063 |
| 9 | `open-f2p.mjs:(anonymous)` | 0.063 |
| 10 | `resolve:defaultResolve` | 0.063 |
| 11 | `identity.mjs:legacyTaskId` | 0.063 |
| 12 | `node:zlib:(anonymous)` | 0.035 |
| 13 | `identity.mjs:(anonymous)` | 0.033 |
| 14 | `v8:fromEntries` | 0.033 |
| 15 | `module_map:set` | 0.032 |

`roll-pool-1`: sampled live MiB 5.80 [5.44, 6.42].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `open-f2p.mjs:resolveOpenF2P` | 1.409 |
| 2 | `encoding:decode` | 0.942 |
| 3 | `engine-profile.mjs:main` | 0.836 |
| 4 | `node:inspector:post` | 0.595 |
| 5 | `utils:compileSourceTextModule` | 0.377 |
| 6 | `js_transferable:structuredClone` | 0.094 |
| 7 | `v8:set` | 0.089 |
| 8 | `v8:fromEntries` | 0.064 |
| 9 | `open-f2p.mjs:(anonymous)` | 0.063 |
| 10 | `v8:map` | 0.063 |
| 11 | `module_job:syncLink` | 0.063 |
| 12 | `world.mjs:buildWorld` | 0.035 |
| 13 | `rules.mjs:(anonymous)` | 0.032 |
| 14 | `v8:add` | 0.031 |
| 15 | `open-f2p.mjs:freeze` | 0.031 |

`evaluate`: sampled live MiB 9.59 [9.52, 10.97].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.818 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.471 |
| 3 | `node:inspector:post` | 1.268 |
| 4 | `utils:compileSourceTextModule` | 0.691 |
| 5 | `worker.mjs:takeDefinitions` | 0.380 |
| 6 | `worker.mjs:serializedState` | 0.301 |
| 7 | `engine.mjs:(anonymous)` | 0.222 |
| 8 | `engine.mjs:createCompiledTaskEngine` | 0.188 |
| 9 | `open-f2p.mjs:(anonymous)` | 0.156 |
| 10 | `v8:map` | 0.156 |
| 11 | `js_transferable:structuredClone` | 0.126 |
| 12 | `v8:push` | 0.125 |
| 13 | `v8:filter` | 0.125 |
| 14 | `v8:set` | 0.117 |
| 15 | `worker.mjs:(anonymous)` | 0.101 |

`play`: sampled live MiB 9.94 [9.10, 10.18].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.691 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.291 |
| 3 | `node:inspector:post` | 1.165 |
| 4 | `utils:compileSourceTextModule` | 0.634 |
| 5 | `worker.mjs:serializedState` | 0.408 |
| 6 | `engine.mjs:createCompiledTaskEngine` | 0.253 |
| 7 | `engine.mjs:(anonymous)` | 0.252 |
| 8 | `worker.mjs:takeDefinitions` | 0.221 |
| 9 | `v8:filter` | 0.219 |
| 10 | `v8:push` | 0.188 |
| 11 | `js_transferable:structuredClone` | 0.188 |
| 12 | `v8:set` | 0.121 |
| 13 | `worker.mjs:(anonymous)` | 0.105 |
| 14 | `v8:map` | 0.094 |
| 15 | `open-f2p.mjs:freeze` | 0.094 |

`full`: sampled live MiB 10.05 [9.41, 10.49].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.723 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.722 |
| 3 | `node:inspector:post` | 1.139 |
| 4 | `utils:compileSourceTextModule` | 0.508 |
| 5 | `worker.mjs:serializedState` | 0.286 |
| 6 | `worker.mjs:takeDefinitions` | 0.284 |
| 7 | `v8:push` | 0.251 |
| 8 | `engine.mjs:(anonymous)` | 0.219 |
| 9 | `engine.mjs:createCompiledTaskEngine` | 0.188 |
| 10 | `v8:filter` | 0.188 |
| 11 | `worker.mjs:(anonymous)` | 0.163 |
| 12 | `v8:map` | 0.156 |
| 13 | `open-f2p.mjs:(anonymous)` | 0.125 |
| 14 | `js_transferable:structuredClone` | 0.094 |
| 15 | `open-starter-data.mjs:(anonymous)` | 0.094 |

`duo`: sampled live MiB 9.87 [9.60, 11.05].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.694 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.659 |
| 3 | `node:inspector:post` | 1.115 |
| 4 | `utils:compileSourceTextModule` | 0.663 |
| 5 | `worker.mjs:takeDefinitions` | 0.347 |
| 6 | `worker.mjs:serializedState` | 0.266 |
| 7 | `v8:join` | 0.220 |
| 8 | `engine.mjs:createCompiledTaskEngine` | 0.195 |
| 9 | `v8:set` | 0.193 |
| 10 | `engine.mjs:(anonymous)` | 0.188 |
| 11 | `v8:filter` | 0.188 |
| 12 | `v8:push` | 0.157 |
| 13 | `js_transferable:structuredClone` | 0.125 |
| 14 | `v8:map` | 0.125 |
| 15 | `identity.mjs:legacyTaskId` | 0.125 |

`duo-sidebar`: sampled live MiB 9.76 [9.36, 10.18].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.662 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.377 |
| 3 | `node:inspector:post` | 1.108 |
| 4 | `utils:compileSourceTextModule` | 0.595 |
| 5 | `worker.mjs:serializedState` | 0.329 |
| 6 | `worker.mjs:takeDefinitions` | 0.314 |
| 7 | `js_transferable:structuredClone` | 0.188 |
| 8 | `v8:push` | 0.188 |
| 9 | `v8:set` | 0.171 |
| 10 | `engine.mjs:createCompiledTaskEngine` | 0.157 |
| 11 | `v8:filter` | 0.157 |
| 12 | `worker.mjs:(anonymous)` | 0.135 |
| 13 | `v8:map` | 0.126 |
| 14 | `engine.mjs:evaluatePass` | 0.126 |
| 15 | `engine.mjs:(anonymous)` | 0.125 |

`predict`: sampled live MiB 11.16 [10.10, 11.71].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.703 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.449 |
| 3 | `node:inspector:post` | 1.218 |
| 4 | `utils:compileSourceTextModule` | 0.628 |
| 5 | `v8:(V8 API)` | 0.503 |
| 6 | `worker.mjs:takeDefinitions` | 0.345 |
| 7 | `state.mjs:jsonClone` | 0.266 |
| 8 | `v8:push` | 0.188 |
| 9 | `v8:filter` | 0.188 |
| 10 | `engine.mjs:createCompiledTaskEngine` | 0.164 |
| 11 | `worker.mjs:(anonymous)` | 0.163 |
| 12 | `js_transferable:structuredClone` | 0.159 |
| 13 | `engine.mjs:(anonymous)` | 0.157 |
| 14 | `identity.mjs:legacyTaskId` | 0.156 |
| 15 | `v8:set` | 0.151 |

`death-estimates`: sampled live MiB 10.57 [9.86, 10.95].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.707 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.318 |
| 3 | `node:inspector:post` | 1.091 |
| 4 | `utils:compileSourceTextModule` | 0.628 |
| 5 | `v8:(V8 API)` | 0.480 |
| 6 | `worker.mjs:takeDefinitions` | 0.376 |
| 7 | `state.mjs:jsonClone` | 0.333 |
| 8 | `engine.mjs:createCompiledTaskEngine` | 0.258 |
| 9 | `v8:push` | 0.219 |
| 10 | `v8:set` | 0.204 |
| 11 | `engine.mjs:(anonymous)` | 0.156 |
| 12 | `worker.mjs:(anonymous)` | 0.131 |
| 13 | `v8:map` | 0.125 |
| 14 | `identity.mjs:legacyTaskId` | 0.125 |
| 15 | `v8:filter` | 0.125 |

`chunk-planning`: sampled live MiB 10.15 [8.96, 10.33].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.780 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.472 |
| 3 | `node:inspector:post` | 0.996 |
| 4 | `utils:compileSourceTextModule` | 0.721 |
| 5 | `worker.mjs:takeDefinitions` | 0.470 |
| 6 | `worker.mjs:serializedState` | 0.360 |
| 7 | `v8:push` | 0.282 |
| 8 | `engine.mjs:createCompiledTaskEngine` | 0.253 |
| 9 | `engine.mjs:(anonymous)` | 0.219 |
| 10 | `js_transferable:structuredClone` | 0.156 |
| 11 | `v8:set` | 0.130 |
| 12 | `resolve:defaultResolve` | 0.125 |
| 13 | `v8:filter` | 0.125 |
| 14 | `engine.mjs:evaluatePass` | 0.104 |
| 15 | `worker.mjs:(anonymous)` | 0.096 |

`sandbox`: sampled live MiB 10.87 [10.46, 11.06].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.708 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.472 |
| 3 | `node:inspector:post` | 1.161 |
| 4 | `utils:compileSourceTextModule` | 0.658 |
| 5 | `worker.mjs:serializedState` | 0.333 |
| 6 | `worker.mjs:takeDefinitions` | 0.314 |
| 7 | `v8:filter` | 0.282 |
| 8 | `engine.mjs:(anonymous)` | 0.251 |
| 9 | `engine.mjs:createCompiledTaskEngine` | 0.228 |
| 10 | `v8:push` | 0.219 |
| 11 | `open-f2p.mjs:(anonymous)` | 0.157 |
| 12 | `engine.mjs:add` | 0.157 |
| 13 | `js_transferable:structuredClone` | 0.156 |
| 14 | `resolve:defaultResolve` | 0.156 |
| 15 | `v8:set` | 0.130 |

`area-check`: sampled live MiB 10.15 [9.58, 10.20].
| Rank | Allocation function/module | Median live MiB |
| ---: | --- | ---: |
| 1 | `encoding:decode` | 1.736 |
| 2 | `open-f2p.mjs:resolveOpenF2P` | 1.539 |
| 3 | `node:inspector:post` | 1.125 |
| 4 | `utils:compileSourceTextModule` | 0.721 |
| 5 | `worker.mjs:takeDefinitions` | 0.283 |
| 6 | `worker.mjs:serializedState` | 0.282 |
| 7 | `v8:push` | 0.252 |
| 8 | `v8:filter` | 0.219 |
| 9 | `v8:map` | 0.188 |
| 10 | `engine.mjs:createCompiledTaskEngine` | 0.188 |
| 11 | `engine.mjs:evaluatePass` | 0.126 |
| 12 | `js_transferable:structuredClone` | 0.125 |
| 13 | `engine.mjs:(anonymous)` | 0.125 |
| 14 | `v8:set` | 0.117 |
| 15 | `worker.mjs:(anonymous)` | 0.094 |

## Validation and remaining risks
- Syntax check and import-only check: 2 pass, 0 fail. Harness `--help`: 1 pass, 0 fail. No new test files; classification changes are unnecessary.
- `npm run test:quick`: tests 2513, pass 2445, fail 0, skipped 68.
- `npm test`: tests 5715, pass 5573, fail 2, skipped 140.
Failed full-suite files were rerun individually with the same test policy and pack selection, then on a disposable untouched START worktree. No tests were edited or skipped to change the outcome.
| Module | Current standalone pass / fail | START standalone pass / fail | Failure-title hash differences |
| --- | ---: | ---: | ---: |
| `tests/cache-resources-server.test.mjs` | 0 / 1 | 0 / 1 | 0 |
| `tests/map-assets-server.test.mjs` | 0 / 1 | 0 / 1 | 0 |
All observed full-suite failing modules reproduce the same failing test titles on START. Application/test source differences from START: 0. Repairs to those existing tests or their required input configuration are outside the 2-file EN3 scope.
- Request measurements cover 5 cold/warm pairs for each of 10 worker variants on each dataset, plus 5 cold/warm main-thread pool pairs for each of 2 roster positions. Joint CPU/heap profile intervals are an additional 5 per variant/position, per dataset, followed by 1 CPU-only diagnostic interval per variant/position for precise function locations. No application behavior was changed. Timing/profile dataset and calculation hash differences: 0 for both inputs.
- A single saved input and 3 candidates establish a reference cost profile, not fleet workload frequency, leak freedom or correctness of a replacement. Larger candidate batches, long picker churn and production arrival rates remain unmeasured.
- Native builds measured: 0; Rust is unavailable in this environment. Replacement performance remains an experiment to run.
- OS file caches are warm; process/engine caches are cold as specified. Sampled heap estimates and instrumented profile timings must not be substituted for exact retained sizes or unprofiled latency.
- The protocol input bundle needs agreement before a native implementation; request-type support cannot silently become view-specific support. Per-picker cache/supersession isolation is a correctness prerequisite for shared calculators.
