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

## Multi-picker capacity (EN6)

START `ff08cea7af6696a2d4f97efe0b1820e7c698eed0`. Measurement only; no application or calculator changes. EN5 was not merged at this START. These are measurements of the current reference, not an EN5 comparison or a native rewrite forecast.

**Light-workload bound:** one reference process carries all **32 tested synthetic public pickers** within the cold-evaluate <10 s and warm-repeat <2 s targets. Even with affinity limited to two CPUs, the worst of five run-level p95s is **176 ms cold / 147 ms repeat**, excluding worker wake. No latency-target knee was reached through 32. This is a calculator capacity result for small new public accounts, not a measured limit for grown saves, arbitrary rule variants or a mixed live fleet.

### Reproduction, identity and measurement boundary

```sh
node scripts/perf/multi-picker-capacity.mjs --runs 5 --include-32 \
  --output /tmp/en6-capacity.json
taskset -c 0,1 node scripts/perf/multi-picker-capacity.mjs --runs 5 \
  --pickers 1,32 --separate 0 --output /tmp/en6-two-cpu.json
# Separate diagnostic, excluded from all timing tables:
mkdir -p /tmp/en6-coverage
NODE_V8_COVERAGE=/tmp/en6-coverage node scripts/perf/multi-picker-capacity.mjs \
  --trial-pickers 16 --trial-workers 1 --trial-run=0 > /tmp/en6-coverage-trial.json
```

Node 24.19.0, Linux x86-64, AMD EPYC 9V45 96-Core Processor; 5 visible logical CPUs, 4 available to the default process, cgroup quota `400000 100000` (4 cores), 16 GiB memory limit. The affinity run reports 2 available CPUs under the same quota. Five repetitions per topology, rotating case order; fresh driver and fresh calculators every trial. The 32-picker case was admitted by a separate successful 16-picker pilot (<10 s cold, <2 s repeat, <2 GiB combined RSS), then interleaved with the other cases. No tests or other benchmarks overlapped timed trials. Process/engine caches are cold at spawn; OS file caches are warm and were not flushed. The eight-worker public case had ample memory headroom; no private packs or save were opened.

The benchmark forces `open-f2p`, clears inherited pack/profile/defaults selections, and constructs synthetic members named `Player x`. Each picker has two members with intentionally colliding member IDs, revision numbers and input fingerprints across identities. Valid MP3 picker IDs isolate their jobs. Three gameplay inputs unlock zero, one or two additional public cells. There is no imported history, progression or identity registry. This deliberately measures new-account calculator work; it does not reproduce the much larger prepared snapshot in the earlier open-f2p profile.

The real `calculator/reference/main.mjs --protocol 1` endpoint hosts the unchanged task worker. One worker here means one such process, including its host and task isolates. All requests use compact `evaluate` (`play-v1`), not the unprojected object-returning control or full view. Every endpoint has one active request; the driver owns a FIFO queue. Latency starts when a job is submitted, before that queue, and ends after the complete protocol reply is decoded. A missing state reference is retried with its body and the original latency clock. Thus state LRU eviction is included, not bypassed.

Cold submits the first evaluate for every identity together. Repeat submits an identical complete round after cold, so it measures cross-picker cache pressure. Local repeat is an additional hot-cache control: each picker is primed and immediately repeated, with no intervening picker; only repeats enter its latency quantiles, while CPU, RSS and completed throughput include both jobs. Alternating queues six rounds over three genuine gameplay inputs (1,2,0,1,2,0), beyond both two-entry caches. Prediction queues three eligible candidates per picker and receives owner/partner reuse parts. Burst queues a post-save calculation with a new revision/body followed by a task-list reference for every picker in one synchronous turn. There is no save protocol verb: this measures calculator work after a save, including its task-list read; it does not measure storage writes, HTTP routing or scheduler-side result caches. All phase arrivals in each ordinary round occur within one second, even when completion takes longer.

Ready wall runs from process spawn through init, compilation and ready catalogue decoding, excluding fixture preparation. Core-seconds sum Linux process `utime+stime` across the driver and calculator processes, including all their threads, at 100 ticks/s. Sub-10-ms CPU costs can quantize to zero; the table is not evidence of zero CPU consumption. RSS includes the fresh driver and all calculators, but excludes the idle outer experiment controller. Steady is post-reply RSS without forced GC. Combined peak is sampled synchronously every 25 ms; the sum of final process `VmHWM` values provides a conservative lifetime upper bound, since individual peaks need not coincide. Startup CPU and RSS are separate from the request-phase table. No allocator carry-over from a previous trial enters the measurement.

Each reported cell is a median over five fresh trials; brackets give the minimum–maximum. p50 and p95 use the nearest-rank quantile within each trial, then the median of those five quantiles (not a pooled population percentile). One-picker cold/repeat trials each contain one latency, so their p95 spread is a five-sample range. Throughput counts completed protocol jobs per elapsed phase second, including priming for the local control. A prediction batch completes 3N jobs, alternating 6N and burst 2N. There is no sustained arrival-rate or soak-test claim.


| Input pin | Value |
| --- | --- |
| Dataset digest | `f129828c58260ba4894f2cb6ed7287c07c8f5360cb8d0a1716a5f26ddb9dfbc0` |
| Init SHA-256 | `618b63209f8fa4bec9b4d90e6fc949f9f1d17dd578cf4f6ddff2e61544fab452` |
| Source hash inventory | 60 records; SHA-256 `e435ed4ccf4b07b195d1ea0d86a3736001fa277519dbcb843445a3e6597aef2c` |
| Installed pack hashes | `[]` (public in-tree fixture; no installed packs) |
| Benchmark SHA-256 | `19b1db1d3971f17bbdf5716dbe65472204a8de0cbdf337607be2b82266ef5e2f` |
| Synthetic input 0 SHA-256 | `2ce988fed5e3ef144ad80223718e14eab9139d5abda7224cdd36784d7134891b` |
| Synthetic input 1 SHA-256 | `712fab13b679d13b87f51fdfbee31af6af5ffe4e046bd639afa9ebc1a9871d06` |
| Synthetic input 2 SHA-256 | `158c65c17b24b42eeec51fee08f65c18ecb4e738f8367d9f82162e907e13646b` |

The inventory hash is over compact JSON of sorted `{sha256,bytes}` source records, as retained in the numeric report. Timing and affinity report fingerprint differences: 0.

### Light-workload bound: startup and lifetime memory (4-core quota)

| Pickers / workers | Ready ms | Ready core-s | Ready combined MiB | Lifetime sampled peak MiB | Largest HWM-sum upper bound MiB |
| --- | --- | --- | --- | --- | ---: |
| 1 / 1 | 206.3 [194.1–225.0] | 0.26 [0.25–0.27] | 161.0 [159.9–161.1] | 218.9 [217.3–220.0] | 220.0 |
| 4 / 1 | 210.3 [197.3–217.1] | 0.25 [0.25–0.28] | 161.6 [160.4–162.0] | 357.2 [322.9–361.9] | 364.6 |
| 8 / 1 | 201.9 [195.7–215.4] | 0.26 [0.25–0.30] | 161.6 [160.0–161.9] | 375.5 [370.5–377.5] | 380.6 |
| 16 / 1 | 217.8 [209.2–231.7] | 0.29 [0.27–0.30] | 161.2 [160.6–161.7] | 435.1 [425.6–461.1] | 464.2 |
| 32 / 1 | 210.2 [201.4–218.9] | 0.28 [0.26–0.28] | 162.1 [159.9–162.4] | 508.6 [482.5–528.3] | 536.2 |
| 8 / 8 | 601.5 [594.3–612.4] | 2.33 [2.30–2.35] | 915.0 [913.2–919.4] | 1356.8 [1350.1–1360.1] | 1361.9 |

### Light-workload bound: request patterns (4-core quota)

RSS cells show median steady / median sampled peak MiB; lifetime peak spread and its conservative upper bound are above. CPU and p95 include their across-run spread. p50 and completed throughput are medians.

| Pickers / workers | Pattern | Core-s | p50 ms | p95 ms | RSS steady / peak MiB | Completed / s |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 1 / 1 | cold | 0.04 [0.03–0.05] | 29.9 | 29.9 [28.0–31.5] | 169.0 / 169.0 | 33.3 |
| 1 / 1 | warm-round | 0.00 [0.00–0.00] | 1.8 | 1.8 [1.7–2.0] | 169.5 / 169.5 | 561.2 |
| 1 / 1 | warm-local | 0.00 [0.00–0.02] | 1.3 | 1.3 [1.2–2.6] | 170.2 / 170.2 | 700.3 |
| 1 / 1 | alternating | 0.10 [0.09–0.12] | 35.5 | 67.0 [61.5–68.3] | 202.1 / 202.1 | 89.4 |
| 1 / 1 | prediction-3 | 0.10 [0.09–0.12] | 42.2 | 59.5 [56.6–64.6] | 216.7 / 216.7 | 50.4 |
| 1 / 1 | save-list-burst | 0.01 [0.01–0.02] | 7.4 | 9.2 [8.7–10.9] | 218.9 / 218.9 | 215.6 |
| 4 / 1 | cold | 0.05 [0.05–0.06] | 33.7 | 42.1 [40.6–42.8] | 171.4 / 171.4 | 94.8 |
| 4 / 1 | warm-round | 0.03 [0.02–0.04] | 8.0 | 17.6 [15.1–19.6] | 179.2 / 179.2 | 226.1 |
| 4 / 1 | warm-local | 0.02 [0.02–0.03] | 1.0 | 1.5 [1.3–1.7] | 188.3 / 188.3 | 447.9 |
| 4 / 1 | alternating | 0.21 [0.19–0.23] | 75.8 | 130.6 [127.6–137.2] | 248.6 / 248.6 | 178.5 |
| 4 / 1 | prediction-3 | 0.43 [0.39–0.47] | 129.4 | 258.2 [231.2–280.7] | 340.2 / 340.2 | 46.5 |
| 4 / 1 | save-list-burst | 0.04 [0.03–0.04] | 13.6 | 20.9 [19.5–24.2] | 357.2 / 357.2 | 379.6 |
| 8 / 1 | cold | 0.08 [0.06–0.09] | 40.8 | 57.3 [54.9–59.5] | 179.1 / 179.1 | 139.1 |
| 8 / 1 | warm-round | 0.04 [0.03–0.05] | 14.1 | 26.9 [25.8–30.0] | 191.1 / 191.1 | 296.3 |
| 8 / 1 | warm-local | 0.05 [0.04–0.06] | 1.1 | 2.9 [2.0–5.7] | 207.2 / 207.2 | 434.1 |
| 8 / 1 | alternating | 0.32 [0.30–0.36] | 119.0 | 206.3 [204.5–225.2] | 290.4 / 290.4 | 226.3 |
| 8 / 1 | prediction-3 | 0.77 [0.76–0.84] | 243.5 | 444.2 [403.3–461.7] | 374.6 / 374.6 | 52.4 |
| 8 / 1 | save-list-burst | 0.05 [0.04–0.06] | 21.4 | 37.5 [31.8–38.4] | 374.9 / 375.5 | 417.6 |
| 16 / 1 | cold | 0.12 [0.11–0.13] | 61.9 | 89.3 [88.3–90.5] | 193.1 / 193.1 | 178.7 |
| 16 / 1 | warm-round | 0.09 [0.08–0.10] | 33.6 | 63.8 [53.9–67.8] | 220.2 / 220.2 | 250.6 |
| 16 / 1 | warm-local | 0.12 [0.11–0.14] | 1.0 | 3.0 [2.4–4.3] | 244.7 / 244.7 | 417.6 |
| 16 / 1 | alternating | 0.53 [0.52–0.58] | 199.5 | 360.6 [347.6–382.2] | 342.7 / 342.7 | 258.7 |
| 16 / 1 | prediction-3 | 1.43 [1.38–1.47] | 473.4 | 845.9 [831.9–876.9] | 430.3 / 434.8 | 54.7 |
| 16 / 1 | save-list-burst | 0.08 [0.08–0.09] | 36.1 | 63.3 [59.7–71.4] | 429.6 / 430.3 | 497.0 |
| 32 / 1 | cold | 0.19 [0.17–0.22] | 85.1 | 135.7 [124.8–144.5] | 221.1 / 221.1 | 230.6 |
| 32 / 1 | warm-round | 0.18 [0.16–0.19] | 60.0 | 109.8 [106.7–118.1] | 254.4 / 254.4 | 281.9 |
| 32 / 1 | warm-local | 0.19 [0.18–0.21] | 0.9 | 5.0 [2.0–6.4] | 317.2 / 317.2 | 493.5 |
| 32 / 1 | alternating | 0.98 [0.93–1.02] | 340.2 | 620.8 [598.8–644.0] | 409.1 / 409.1 | 299.1 |
| 32 / 1 | prediction-3 | 2.60 [2.50–2.69] | 823.3 | 1519.7 [1482.6–1597.9] | 504.9 / 508.6 | 60.9 |
| 32 / 1 | save-list-burst | 0.17 [0.16–0.22] | 65.4 | 117.3 [113.8–129.3] | 494.9 / 504.9 | 526.3 |
| 8 / 8 | cold | 0.35 [0.34–0.36] | 75.1 | 82.0 [80.7–87.1] | 977.4 / 977.4 | 97.4 |
| 8 / 8 | warm-round | 0.02 [0.00–0.03] | 5.5 | 6.7 [6.2–7.8] | 980.5 / 980.5 | 1178.7 |
| 8 / 8 | warm-local | 0.03 [0.00–0.04] | 1.2 | 1.4 [1.3–1.8] | 983.9 / 983.9 | 639.7 |
| 8 / 8 | alternating | 0.98 [0.96–0.99] | 145.9 | 225.9 [212.6–234.0] | 1242.1 / 1242.1 | 200.5 |
| 8 / 8 | prediction-3 | 1.00 [0.94–1.05] | 159.7 | 252.3 [242.7–255.3] | 1343.7 / 1343.8 | 94.7 |
| 8 / 8 | save-list-burst | 0.14 [0.12–0.15] | 26.0 | 33.4 [32.1–35.2] | 1356.8 / 1356.8 | 477.1 |

### Light-workload bound: two-CPU reservation check

Five interleaved repetitions of 1 and 32 pickers, each using one calculator. This is an actual affinity restriction, not a 6/4 multiplier applied to latency.

| Pickers | Pattern | Core-s | p50 ms | p95 ms | RSS steady / peak MiB | Completed / s |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 1 | cold | 0.03 [0.03–0.06] | 31.4 | 31.4 [30.0–39.3] | 169.8 / 169.8 | 31.7 |
| 1 | warm-round | 0.01 [0.00–0.01] | 2.1 | 2.1 [1.9–3.1] | 170.3 / 170.3 | 480.5 |
| 1 | warm-local | 0.00 [0.00–0.01] | 1.3 | 1.3 [1.2–1.6] | 171.2 / 171.2 | 640.7 |
| 1 | alternating | 0.10 [0.09–0.11] | 37.1 | 64.8 [62.4–73.0] | 201.6 / 201.6 | 92.5 |
| 1 | prediction-3 | 0.10 [0.10–0.13] | 49.2 | 70.0 [62.7–87.7] | 219.1 / 219.1 | 42.8 |
| 1 | save-list-burst | 0.01 [0.01–0.01] | 8.1 | 10.6 [9.4–12.3] | 220.7 / 220.7 | 186.7 |
| 32 | cold | 0.19 [0.18–0.25] | 99.6 | 154.8 [152.2–175.8] | 222.7 / 222.7 | 195.2 |
| 32 | warm-round | 0.17 [0.14–0.18] | 67.3 | 133.2 [125.1–146.7] | 256.7 / 256.7 | 233.8 |
| 32 | warm-local | 0.21 [0.19–0.23] | 1.0 | 5.8 [3.1–6.5] | 318.7 / 318.7 | 379.8 |
| 32 | alternating | 0.95 [0.93–1.04] | 402.2 | 738.4 [708.8–767.0] | 413.1 / 416.2 | 251.7 |
| 32 | prediction-3 | 2.56 [2.50–2.64] | 928.1 | 1726.9 [1672.8–1837.4] | 499.3 / 502.7 | 53.9 |
| 32 | save-list-burst | 0.18 [0.16–0.19] | 79.8 | 143.5 [137.9–149.9] | 502.9 / 504.2 | 428.6 |

### Answers and server recommendation

**1. How many can be active?** At least 32 of these public synthetic pickers on one calculator: all five runs pass both evaluate latency targets, including rotating repeats that miss the caches. At the 4-core quota, 32-picker median p95 is 136 ms cold and 110 ms repeat; worst-run p95 is 145 / 118 ms. With two pinned CPUs, median p95 is 155 / 133 ms and worst-run p95 is 176 / 147 ms. The largest observed ready-plus-cold-p95 sum on two CPUs is 428 ms. These observations establish a tested floor, not a maximum picker count; counts above 32 were not tested. Predictions are more expensive: 32 simultaneous batches of three have median p95 1.52 s at the default quota and 1.73 s on two CPUs, with a worst-run 1.84 s. Mixed foreground/prediction arrivals or larger queues can exceed the isolated-pattern latency figures.

**2. Is compilation shared?** Yes for the tested dataset/rule variant. A separate V8 precise-coverage diagnostic for the 16-picker workload records **273** calls to the variant resolver and **1** call each to `createTaskEngine` and `createCompiledTaskEngine` in the task isolate; the adapter host records 0 compiler calls. `app/tasks/worker.mjs` creates its engine once at module initialization; `app/tasks/engine.mjs:createTaskEngine` retains a map keyed by the three guide-rule booleans, not picker identity. What gets rebuilt is the evaluated baseline graph (tasks, collection, equipment and presentation), not the compiled dataset: the worker's result LRU and both transferred-state LRUs have only two global entries. At 4, 8, 16 and 32 pickers every job in the repeat round performs engine work and resends its missing state; immediate local repeats perform none. For 8 identities, sharing versus 8 separate processes reduces median startup CPU **2.33 → 0.26 core-s** (2.07 saved), ready combined RSS **915 → 162 MiB**, lifetime sampled peak **1356.8 → 375.5 MiB** (981.3 saved), and complete-workload CPU **4.81 → 1.61 core-s**. Eight separate workers do retain warm round results and improve prediction p95 (252 versus 444 ms), at much greater startup and memory cost. These public-fixture measurements do not validate or replace item 5's 43.9 core-s / 4.70 GiB duplicate estimate for the released packs. No per-picker compiled-state rebuild was found; no implementation fix is proposed as part of EN6. A later experiment could budget result/state entries across picker identities under an explicit byte cap; increasing entries blindly would trade cache misses for retained graphs.

**3. Where is the knee?** The first observed knee is cache capacity between 2 and 4 identities, followed by queueing on the single active calculator request. At 32, the default-quota prediction median p95 is 1520 ms, with 1503 ms spent waiting in the driver queue; cold p95 is 136 ms with 132 ms queued. The available 4-core quota cannot make a serial worker execute several requests at once. Separate workers hit CPU competition: eight cold requests have worse p95 (82 versus 57 ms) despite having eight processes, and prediction gains far less than eightfold. RSS is not the first limit on this public workload: the largest lifetime sampled peak through 32 is 528 MiB, with a 536 MiB HWM-sum upper bound; the two-CPU run bounds it by 552 MiB. There is no measured hard CPU/RSS admission ceiling or sustained-rate knee at 32. Long idle/wake churn, larger saves, full views, other guide variants, cancellation, mixed revisions and concurrent HTTP/storage work remain outside this benchmark.

The previous 32-context production recommendation is withdrawn. These public-fixture tables establish only a light-workload bound and omit server-context residency. A production limit must combine released-pack grown-save latency, server RSS, calculator RSS, the 1.5 GiB OS/Caddy reserve and 20% headroom. The follow-up measurements below replace that recommendation; no setting was changed.

### Initial EN6 validation

The new protocol smoke test runs both layouts at two pickers, all six patterns, three-input cache pressure and deliberately invalid inherited dataset settings in under 60 seconds. It is explicitly classified quick and open-f2p in `scripts/test-selection.mjs`. Application/result behaviour changes: 0; private input copies: 0; private checkout modifications: 0. Timing runs: 30 primary trials plus one admission pilot and 10 affinity trials; the coverage diagnostic is separate. START quick: 2533 tests, 2465 passed, 0 failed, 68 skipped. EN6 quick: 2534 tests, 2466 passed, 0 failed, 68 skipped (68.26 s): exactly START plus the new test. The standalone smoke test passed 1/1 in 1.31 s, with 0 failures. `npm test`: 5765 tests, 5625 passed, 0 failed, 140 skipped (268.94 s). No failing-file reruns or START failure reproductions were needed. `git diff --check`: 0 errors. No tests were weakened or skipped to change the outcome.

### Released-pack follow-up (EN6-F1)

The public tables above are a light-workload bound and do not set production admission. The released-pack workload below replaces that capacity evidence. Application/calculator changes remain 0.

Prepared inputs are created in a separate process under `/tmp`. The grown input is copied, including its dataset binding, before `createServer` opens it; the original checkout is never opened as writable storage. The required packs and local-defaults override are explicit. Fresh uses a native empty initial save with two synthetic members, then the same server catalogue/identity preparation as the grown save. Both retain the full prepared task catalogue. The grown calculation hash matches the earlier EN3 profile exactly (hash differences: 0). No gameplay text, identifiers or catalogue paths are written to these reports.

The production measurements use the existing `ProcessWorker` endpoint, the native MP3 picker key, JSON-shared state/result transport for compact task lists, and object state transport for predictions, as the production scheduler does. Definitions are normalized to the production byte input. No worker or engine code is edited. The original public tables use the framed reference adapter. These transports are deliberately labelled: they are not a speedup comparison. Production ready includes the ordinary V8 ready catalogue; client input normalization and IPC are included in ready CPU/wall. The prepared-init hash below precedes transport normalization.

A separate framed-adapter diagnostic failed before evaluation while JSON-encoding the released ready catalogue (`calculator/reference/codec.mjs:78`, `RangeError`). The supported `omitReadyCatalogue` switch lets framed calculations run, but that path has more residency: a one-picker diagnostic reached 2447 MiB worker HWM; a four-picker diagnostic reached 3667 MiB. Those diagnostics are excluded from production capacity tables. The adapter problem is outside this task's permitted files and was not repaired or hidden by altering app/calculator code.

Every picker identity receives the same complete grown snapshot in the grown cases, as requested; picker IDs separate states/results. Each case starts fresh processes. Three repetitions per full case are used because real evaluations, alternating rounds and prediction batches take minutes; case order rotates between repetitions. Timed cases and tests never overlap. One request per calculator is active, with queue-inclusive caller latency. The same six arrival patterns and completion accounting as the public benchmark apply. Three gameplay inputs add zero, one or two candidates; metadata is otherwise preserved. Grown revision is preserved, and the burst increments that revision. Fresh has 0 eligible candidates before choosing a start; its three prediction hypotheses use known surface candidates instead, without changing game command behaviour. Grown has 3 eligible candidates. These are exact-copy workloads, not diverse rule configurations or a mixed foreground/advisory service load.

The host remains Node 24.19.0 / AMD EPYC 9V45, 5 visible CPUs, 4 available cores/quota and 16 GiB RAM. No 6/4 latency scaling is applied. Combined RSS includes the fresh benchmark driver and its calculator processes; **calculator HWM** excludes the driver and is the sum of process high-water marks, an upper bound on simultaneous calculator RSS. Context budgeting must use server RSS plus calculator-only RSS, rather than adding the driver again. Phase steady and peak combined RSS, CPU, throughput and quantiles retain the definitions above.

```sh
# Run each preparation in its own process. --data-dir is omitted for fresh inputs.
node scripts/perf/multi-picker-capacity.mjs --dataset duo-legacy \
  --packs "$RS3_PACKS_DIR" --game-defaults-file "$RS3_GAME_DEFAULTS_FILE" \
  --data-dir "$COPY_INPUT_DIR" --prepare-output /tmp/en6-grown-input
node scripts/perf/multi-picker-capacity.mjs --dataset duo-legacy \
  --packs "$RS3_PACKS_DIR" --game-defaults-file "$RS3_GAME_DEFAULTS_FILE" \
  --prepared-dir /tmp/en6-grown-input --transport production --runs 3 \
  --pickers 1,4,8 --separate 8 --worker-peak-bytes 1698629632 \
  --output /tmp/en6-grown-capacity.json
# Fresh: separately prepare without --data-dir, then use --pickers 1,4,8,16.
# --worker-peak-bytes is an admission input from a completed one-worker pilot;
# remeasure it on another pack/host. A separate run is refused if estimated
# worker RSS plus 2 GiB for driver/reserve exceeds current cgroup headroom.
```

Output/checkpoint files must be new and under `/tmp`; private prepared binaries are mode 0600 in mode-0700 directories. The `.partial` numeric report is checkpointed after each trial. Private binary inputs are not repository artifacts.


| Input | Pin / count / size |
| --- | --- |
| Dataset digest | `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f` |
| Pack 1 manifest SHA-256 | `5e23b5dfb1bf1ed265e7ef1d6edbc9067a820418baa5781e6f3c13864e781da1` |
| Pack 2 manifest SHA-256 | `dfe952dccd200dbad0fde4082cc823f7f2c40a7e9edf9a43898acace7092d077` |
| Local defaults SHA-256 | `1ab931d329b526e55b6283ed401b929023e7153e3e1dcd04604d85de8b4fabf0` |
| Grown source-state SHA-256 | `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc` |
| Grown calculation SHA-256 | `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1` |
| Grown input | 2 members; 23939 task rows; 15707693 bytes |
| Fresh calculation SHA-256 | `b71ffc3682483b5a0f3ca0ecc6b0ce35a5a05e691a714d753b6260b70b39af00` |
| Fresh input | 2 members; 23939 task rows; 15436572 bytes |
| Prepared grown init SHA-256 | `2eb961bf1f4f1e75874adca2d94a0933a82e14fedc128213ba313dd4fd4b0e1e` |
| Grown source inventory | 100 records; SHA-256 `5835fb660604f069a866ae2af8efffe1c1d5c2bbe8f7bf1fe0c86ed77183ab5a` |
| Prepared fresh init SHA-256 | `2eb961bf1f4f1e75874adca2d94a0933a82e14fedc128213ba313dd4fd4b0e1e` |
| Fresh source inventory | 100 records; SHA-256 `5835fb660604f069a866ae2af8efffe1c1d5c2bbe8f7bf1fe0c86ed77183ab5a` |

#### Grown-save startup and lifetime memory

Medians [minimum–maximum], 3 trials per row. Calculator HWM is a conservative sum, not an assertion that all individual peaks coincide.

| Pickers / calculators | Ready ms | Ready core-s | Ready combined MiB | Lifetime sampled combined peak MiB | Calculator HWM MiB |
| --- | --- | --- | --- | --- | --- |
| 1 / 1 | 2823.0 [2787.1–2887.5] | 4.83 [4.78–4.92] | 1343.2 [1343.1–1351.9] | 2281.7 [2278.7–2328.6] | 1633.2 [1580.7–1690.9] |
| 4 / 1 | 2853.4 [2766.3–3234.6] | 4.91 [4.73–5.50] | 1333.7 [1315.8–1372.4] | 2583.2 [2424.5–2664.9] | 1923.7 [1713.3–1926.5] |
| 8 / 1 | 2819.3 [2762.4–2900.0] | 4.80 [4.66–4.81] | 1336.4 [1308.6–1372.4] | 2729.5 [2689.9–2871.4] | 2005.5 [1927.2–2121.4] |
| 8 / 8 | 10729.3 [10506.1–15608.1] | 40.81 [39.75–56.08] | 7174.1 [7165.6–7174.7] | 13025.9 [12745.5–13126.8] | 11768.6 [11622.6–11969.9] |

#### Grown-save arrival patterns

p50 and throughput are medians. p95 and CPU show median [min–max]; RSS is median steady / median sampled peak combined MiB.

| Pickers / calculators | Pattern | Core-s | p50 ms | p95 ms | RSS steady / peak MiB | Completed / s |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 1 / 1 | cold | 4.92 [4.23–5.48] | 2905.9 | 2905.9 [2812.0–3522.9] | 1621.9 / 1621.9 | 0.34 |
| 1 / 1 | warm-round | 0.06 [0.05–0.43] | 40.7 | 40.7 [40.3–100.3] | 1643.1 / 1643.1 | 24.54 |
| 1 / 1 | warm-local | 0.80 [0.63–1.29] | 49.9 | 49.9 [42.6–60.6] | 1740.4 / 1779.7 | 5.62 |
| 1 / 1 | alternating | 23.66 [23.05–25.17] | 7611.5 | 14523.3 [13831.6–15742.2] | 2058.1 / 2148.2 | 0.41 |
| 1 / 1 | prediction-3 | 14.93 [14.72–15.42] | 6748.6 | 10006.6 [9632.0–10452.4] | 2144.9 / 2281.7 | 0.30 |
| 1 / 1 | save-list-burst | 3.63 [3.05–3.85] | 2231.0 | 2273.3 [2204.1–2285.4] | 2169.2 / 2221.3 | 0.88 |
| 4 / 1 | cold | 8.45 [8.15–8.56] | 3486.9 | 4480.0 [4450.9–4661.2] | 1789.4 / 1898.9 | 0.89 |
| 4 / 1 | warm-round | 4.49 [3.81–4.55] | 1110.2 | 2026.1 [1920.2–2042.3] | 2049.2 / 2076.9 | 1.97 |
| 4 / 1 | warm-local | 5.58 [5.34–5.75] | 43.5 | 86.0 [76.0–87.2] | 2094.4 / 2195.4 | 3.48 |
| 4 / 1 | alternating | 42.51 [41.80–42.66] | 12199.5 | 22989.6 [22965.5–23130.6] | 2192.6 / 2279.1 | 1.02 |
| 4 / 1 | prediction-3 | 68.00 [67.20–69.98] | 23425.7 | 47531.6 [47284.4–48203.1] | 2299.5 / 2583.2 | 0.25 |
| 4 / 1 | save-list-burst | 6.82 [6.60–7.23] | 2811.0 | 3958.8 [3813.1–4020.4] | 2423.9 / 2450.9 | 2.02 |
| 8 / 1 | cold | 12.25 [11.96–12.55] | 4435.1 | 6320.4 [6222.2–6374.0] | 1966.5 / 2050.4 | 1.27 |
| 8 / 1 | warm-round | 9.04 [8.61–9.11] | 2014.8 | 3934.1 [3816.4–3998.1] | 2119.0 / 2218.5 | 2.03 |
| 8 / 1 | warm-local | 10.35 [10.00–10.67] | 43.2 | 89.1 [79.3–93.8] | 2176.4 / 2236.1 | 3.62 |
| 8 / 1 | alternating | 69.25 [68.83–69.77] | 18238.2 | 34763.3 [34654.1–34902.2] | 2351.5 / 2441.1 | 1.35 |
| 8 / 1 | prediction-3 | 134.32 [131.23–135.67] | 47358.0 | 91911.0 [90763.4–92045.4] | 2590.0 / 2729.5 | 0.25 |
| 8 / 1 | save-list-burst | 11.07 [11.02–11.84] | 3833.9 | 6030.1 [5810.5–6068.4] | 2629.7 / 2689.9 | 2.65 |
| 8 / 8 | cold | 46.54 [45.26–49.71] | 11176.4 | 11951.1 [11662.3–13254.2] | 8407.0 / 8407.0 | 0.67 |
| 8 / 8 | warm-round | 1.05 [0.75–1.55] | 110.0 | 247.0 [169.6–378.2] | 8348.8 / 8424.8 | 32.37 |
| 8 / 8 | warm-local | 7.36 [6.39–9.78] | 53.0 | 149.2 [68.0–181.9] | 8765.0 / 8830.8 | 6.49 |
| 8 / 8 | alternating | 206.87 [202.95–227.57] | 30772.5 | 51792.7 [50692.2–57493.1] | 11548.9 / 11860.5 | 0.92 |
| 8 / 8 | prediction-3 | 134.24 [129.35–134.60] | 21359.1 | 33087.6 [32368.1–33664.5] | 12489.2 / 12556.5 | 0.71 |
| 8 / 8 | save-list-burst | 35.11 [34.14–36.95] | 8673.3 | 9350.4 [8916.0–9759.2] | 12428.7 / 13025.9 | 1.71 |

#### Fresh-state startup and lifetime memory

Three trials per row; same units and memory definitions as the grown table.

| Pickers / calculators | Ready ms | Ready core-s | Ready combined MiB | Lifetime sampled combined peak MiB | Calculator HWM MiB |
| --- | --- | --- | --- | --- | --- |
| 1 / 1 | 2791.0 [2788.0–2831.4] | 4.59 [4.49–4.71] | 1304.3 [1296.2–1306.2] | 1982.7 [1936.4–2027.8] | 1346.9 [1318.5–1384.7] |
| 4 / 1 | 2769.3 [2765.0–2863.3] | 4.73 [4.58–4.89] | 1325.7 [1308.3–1328.8] | 2301.0 [2215.8–2340.6] | 1607.3 [1517.2–1653.6] |
| 8 / 1 | 2820.0 [2796.2–2903.3] | 4.74 [4.70–4.83] | 1335.1 [1309.9–1365.0] | 2501.9 [2240.4–2557.9] | 1805.5 [1548.8–1835.3] |
| 16 / 1 | 2838.9 [2752.4–2845.1] | 4.82 [4.62–4.91] | 1323.5 [1308.5–1324.0] | 2350.9 [2303.1–2377.7] | 1658.3 [1584.6–1664.9] |
| 8 / 8 | 10748.8 [10568.6–10762.6] | 40.91 [40.90–41.09] | 7155.9 [6936.0–7167.4] | 9891.7 [9779.1–9944.0] | 8698.7 [8622.8–8815.2] |

#### Fresh-state arrival patterns


| Pickers / calculators | Pattern | Core-s | p50 ms | p95 ms | RSS steady / peak MiB | Completed / s |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 1 / 1 | cold | 1.80 [1.78–1.80] | 919.0 | 919.0 [908.7–955.6] | 1419.6 / 1473.2 | 1.09 |
| 1 / 1 | warm-round | 0.05 [0.05–0.06] | 37.2 | 37.2 [36.5–38.6] | 1434.3 / 1434.3 | 26.87 |
| 1 / 1 | warm-local | 0.58 [0.58–0.65] | 31.9 | 31.9 [31.6–36.0] | 1546.8 / 1553.9 | 7.19 |
| 1 / 1 | alternating | 9.58 [9.13–9.91] | 2053.2 | 4203.2 [4139.3–4307.6] | 1670.0 / 1742.6 | 1.43 |
| 1 / 1 | prediction-3 | 6.60 [6.56–6.62] | 2480.9 | 3384.8 [3322.5–3411.2] | 1886.7 / 1982.7 | 0.89 |
| 1 / 1 | save-list-burst | 1.91 [1.72–2.07] | 760.1 | 792.9 [760.1–831.0] | 1862.3 / 1965.4 | 2.52 |
| 4 / 1 | cold | 5.08 [5.05–5.24] | 1429.4 | 2313.8 [2313.1–2378.4] | 1673.8 / 1748.1 | 1.73 |
| 4 / 1 | warm-round | 4.10 [3.62–4.39] | 893.2 | 1723.3 [1656.6–1808.0] | 1902.8 / 1949.8 | 2.32 |
| 4 / 1 | warm-local | 4.90 [4.75–5.17] | 32.8 | 47.8 [47.5–60.9] | 2015.6 / 2055.0 | 3.86 |
| 4 / 1 | alternating | 27.45 [26.09–28.30] | 6272.5 | 11843.7 [11823.7–12073.0] | 2087.9 / 2152.6 | 1.96 |
| 4 / 1 | prediction-3 | 32.92 [31.60–32.95] | 8755.1 | 17579.9 [17330.9–18097.0] | 2164.6 / 2301.0 | 0.68 |
| 4 / 1 | save-list-burst | 5.20 [5.18–5.79] | 1253.6 | 2311.7 [2267.2–2404.5] | 2186.8 / 2260.0 | 3.46 |
| 8 / 1 | cold | 8.84 [8.11–9.08] | 2304.9 | 4036.6 [3866.1–4080.3] | 1888.0 / 1944.8 | 1.98 |
| 8 / 1 | warm-round | 7.56 [7.52–8.37] | 1764.9 | 3437.3 [3396.5–3491.6] | 2035.4 / 2103.9 | 2.33 |
| 8 / 1 | warm-local | 9.35 [8.81–9.93] | 34.3 | 49.2 [47.4–49.6] | 1952.7 / 2086.0 | 4.19 |
| 8 / 1 | alternating | 49.94 [49.82–51.08] | 11614.6 | 22186.6 [21903.6–22380.0] | 2170.8 / 2253.0 | 2.08 |
| 8 / 1 | prediction-3 | 62.88 [62.42–63.05] | 18051.6 | 33751.9 [33601.1–34232.5] | 2352.5 / 2501.9 | 0.69 |
| 8 / 1 | save-list-burst | 10.17 [10.09–10.36] | 2330.0 | 4453.4 [4393.8–4456.1] | 2345.3 / 2462.6 | 3.59 |
| 16 / 1 | cold | 17.21 [16.97–17.45] | 4088.5 | 7754.7 [7573.1–7757.7] | 2023.5 / 2077.3 | 2.06 |
| 16 / 1 | warm-round | 15.54 [15.49–16.01] | 3487.1 | 6913.2 [6842.1–7052.9] | 2028.2 / 2106.0 | 2.31 |
| 16 / 1 | warm-local | 19.33 [18.31–19.46] | 37.0 | 76.6 [67.0–85.3] | 1982.0 / 2081.4 | 4.03 |
| 16 / 1 | alternating | 96.31 [95.49–100.40] | 22442.0 | 42938.3 [42575.4–43660.8] | 2099.9 / 2193.0 | 2.15 |
| 16 / 1 | prediction-3 | 127.81 [127.08–127.93] | 36109.9 | 68826.6 [68379.3–68851.5] | 2141.1 / 2350.9 | 0.68 |
| 16 / 1 | save-list-burst | 20.39 [19.67–20.53] | 4524.8 | 8654.1 [8556.7–8821.3] | 2157.0 / 2264.2 | 3.68 |
| 8 / 8 | cold | 19.19 [18.57–20.12] | 4824.5 | 5112.1 [5018.5–5322.2] | 7319.7 / 7859.5 | 1.56 |
| 8 / 8 | warm-round | 0.79 [0.72–0.97] | 137.1 | 199.3 [188.3–237.5] | 7337.5 / 7349.7 | 40.11 |
| 8 / 8 | warm-local | 5.11 [4.68–5.22] | 37.3 | 85.4 [50.9–87.2] | 7774.7 / 7799.2 | 7.76 |
| 8 / 8 | alternating | 79.09 [77.83–80.75] | 12056.7 | 20540.8 [20249.4–20892.3] | 9257.2 / 9662.5 | 2.33 |
| 8 / 8 | prediction-3 | 53.48 [53.10–54.49] | 9230.4 | 13315.3 [13186.3–13665.0] | 9276.5 / 9750.5 | 1.79 |
| 8 / 8 | save-list-burst | 14.77 [11.47–15.74] | 3530.7 | 4001.3 [3137.6–4264.4] | 9678.9 / 9858.5 | 4.00 |

Grown 16 was not run because every 8-picker repeat trial exceeded 2 s. Fresh 32 was not run because every 16-picker repeat trial exceeded 2 s. Eight separate production calculators were admitted and completed on the 16 GiB host; the unrun eight-worker framed diagnostic is not a substitute for those measurements.


#### Server contexts and production budget: historical follow-up 1

**Historical blocker, resolved by the routed-server measurements below.** `createPickerContext` is absent at START: source inspection found 0 definitions/references in `app/`, `tests/` and `docs/`, and 0 implementations across the available local refs. The available server exposes monolithic `createServer`, which is not a substitute for the MP2 factory's sharing and ownership. Constructing N whole servers would measure a different architecture. App changes are forbidden in this task, so no factory was invented or copied into the benchmark. The required MP2 commit/checkout and its dependencies are needed to run these measurements.

| Workload | Context counts requested | Server RSS measurements | Per-context increment |
| --- | --- | ---: | --- |
| Fresh | 1, 4, 8 | 0 | Not measured |
| Grown | 1, 4, 8 | 0 | Not measured |

The separate MP4 evidence supplied for this task is 1554 MiB peak server RSS at 3 open contexts. It is not a measured fresh/grown curve in this checkout, and no slope is inferred from that single point. In particular, server-side context memory cannot be omitted from admission.

Use the conservative full-machine interpretation of headroom: `11 − 1.5 − 0.20 × 11 = 7.3 GiB` available for **server + all calculators**. A candidate `(N, C)` must satisfy `serverPeakRSS(N) + calculatorPeakRSS(C) <= 7.3 GiB`, with the shared context included in N. This budget is separate from the 16 GiB experiment host's admission check. The pending server measurements prevent a validated production `maxOpenContexts`; the former value 32 is withdrawn, and no replacement setting is asserted from the light tables or a fitted guess. Current sign-up/admission settings are unchanged.

#### Grown-save latency boundary

Five interleaved repetitions per row, cold plus complete repeat round only. Two-calculator cases assign picker identities round-robin. RSS here is a shorter cold/repeat interval, so the full-pattern HWM above remains the budget input. Passing means both targets hold in all five observed run-level p95s, not a statistical latency guarantee.

| Pickers / calculators | Ready ms | Cold p50 ms | Cold p95 ms | Repeat p50 ms | Repeat p95 ms | Combined sampled peak MiB | All five pass? |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| 2 / 1 | 2846.9 [2695.8–2959.0] | 3140.4 | 3622.4 [3383.8–3726.6] | 42.3 | 82.8 [78.8–85.3] | 1756.1 [1753.3–1795.7] | Yes |
| 3 / 1 | 2928.1 [2620.0–2958.4] | 3470.3 | 4055.0 [3946.0–4143.1] | 910.5 | 1481.7 [1391.8–1500.7] | 2060.9 [1970.4–2117.8] | Yes |
| 4 / 1 | 2881.6 [2733.7–2910.2] | 3490.4 | 4476.3 [4352.7–4603.2] | 1076.8 | 1990.8 [1873.6–2032.4] | 1986.2 [1947.5–2049.2] | No |
| 4 / 2 | 3284.7 [3249.3–3321.3] | 3427.0 | 3907.6 [3817.2–4036.7] | 69.6 | 122.1 [95.0–176.8] | 2855.7 [2820.0–2957.8] | Yes |
| 6 / 2 | 3276.9 [3233.3–3359.8] | 3947.2 | 4946.5 [4517.5–5212.2] | 1175.2 | 2198.9 [2006.3–2245.1] | 3413.6 [3189.7–3437.4] | No |
| 8 / 2 | 3340.8 [3188.9–3415.0] | 3999.6 | 5386.1 [5265.0–5481.4] | 1583.3 | 2629.0 [2572.4–2811.6] | 3473.7 [3288.8–3494.4] | No |

**Measured calculator capacity.** For grown saves, one production calculator meets the declared raw-worker targets at 3 identities: median p95 4.06 s cold / 1.48 s repeat, with worst-run p95 4.14 / 1.50 s. Four identities on one calculator are borderline and fail the repeat target in observed runs. Two production calculators meet both targets at 4 identities: median p95 3.91 s cold / 0.12 s repeat, worst-run 4.04 / 0.18 s. Six identities on two calculators fail (repeat p95 2.20 [2.01–2.25] s); eight also fail (2.63 [2.57–2.81] s). Thus the largest tested passing layout is **4 grown identities / 2 calculators**. This is not yet a production `maxOpenContexts` recommendation: server residency is unmeasured, and these repeat figures bypass HTTP/scheduler caches and exclude simultaneous advisory traffic. The earlier 32-context production recommendation remains withdrawn.

**Sharing and duplication.** At 8 grown identities, one shared calculator versus eight separate calculators reduces median startup CPU 40.81 → 4.80 core-s (36.01 saved), ready calculator-only RSS 5788.2 → 713.0 MiB, conservative lifetime calculator HWM sum 11768.6 → 2005.5 MiB, and full-workload CPU 473.21 → 251.22 core-s. Combined driver/calculator sampled peak is 13025.9 → 2729.5 MiB. Eight separate calculators have faster repeat and prediction queues, but do not fit the server budget: observed calculator-only phase-end RSS reached 10871.9 MiB in the first run; adding just the 1536 MiB OS/Caddy reserve already exceeds 11264 MiB. This is a measured real-pack comparison, not a multiplication of the light fixture or the earlier item-5 estimate. The compiled engine remains shared per dataset/rule variant; full evaluated graphs and transferred states still churn in two-entry caches.

**Knee.** Queueing after cache eviction is the first single-calculator latency knee. At 8 grown identities, median repeat p95 is 3934 ms, with 3460 ms queued; prediction p95 is 91911 ms, with 88850 ms queued. That prediction phase uses about 1.41 core-s per wall second despite a 4-core quota: a single active JavaScript calculation cannot consume the remaining capacity as parallel requests. Adding calculators is not linear: two calculators at 6 identities still miss the repeat SLO, and eight calculators consume too much RAM and have cold p95 11.95 [11.66–13.25] s at this quota. These observations locate calculator cache/queue and duplicate-worker memory limits. They do not locate the server-context RSS knee, which still needs the missing MP2 implementation. No engine/cache fix was implemented.

**Budget candidate, not deployment approval.** Retaining the worst full-pattern single-calculator HWM (2121.4 MiB) twice leaves about **3.16 GiB for server RSS** inside the 7.3 GiB app budget. A four-context/two-calculator candidate therefore requires a measured `serverPeakRSS(4) <= 3.16 GiB`, including the shared context. The supplied 1554 MiB point at 3 contexts cannot establish that bound for 4 grown contexts or supply per-context increments. The calculator-only cold/repeat expectations for that candidate are the measured **3.91 / 0.12 s p95** above, under equal arrival schedules and no prediction ahead in the same queue. Six-vCPU transfer assumes comparable per-core speed and reserves four cores for the measured calculator/driver demand, leaving two for server/OS work; latency is not divided by 6/4. Active prediction coexistence, rule diversity, grown server-context memory and HTTP/storage overhead remain unmeasured. A final `maxOpenContexts` and calculator count must wait for those server measurements; public admission should not be raised on this evidence alone.


#### Follow-up validation and remaining work

- Full production-pattern trials: 27 completed (15 fresh, 12 grown), with 3 repetitions per layout and 0 rejected layouts. Boundary trials: 30 completed, with 5 repetitions per row. Framed/pilot diagnostics are separate and do not enter the production medians.
- Expanded smoke test: 1 passed, 0 failed, in 2.50 s; both transports and both two-picker topologies are covered, with inherited dataset settings deliberately invalid. It remains one quick/open-f2p test.
- Follow-up `npm run test:quick`: 2534 tests, 2466 passed, 0 failed, 68 skipped, 69.62 s. START: 2533 tests, 2465 passed, 0 failed, 68 skipped. Exactly START plus one; no tests weakened or skipped to change the result. The initial EN6 full-suite result remains historical; the follow-up required quick suite was rerun, and app/calculator source changes are 0.
- Current benchmark SHA-256: `5256e58e3b0d47dd27dfca819e273d70d58116c0a4282fac36a9beaa26ba9530`. Private input contents added to the repository: 0. Source-state hash differences from EN3: 0. No commits were pushed and no PR was opened.
- The follow-up-1 MP2 blocker is resolved by the unmodified multiplayer worktree measured below. Its previous budget candidate is superseded by the routed-server budget, including the updated 2 GiB service reserve. App/calculator changes remain 0.


#### Routed-server capacity (EN6 follow-up 2)

These measurements supersede the missing-runtime blocker and the production-budget candidate above. The open-f2p tables remain a **light-workload bound**. EN5 was not merged at START.

Runtime commit: `5e15efe13a1dc34100ebbb1f2381f7c25ab43c07`, in an isolated multiplayer worktree. Application, calculator and pack changes: **0**. The runtime's calculator/worker/planning source differs from START in **0** files. The new `scripts/perf/multi-picker-server-capacity.mjs` runs real `createServer`, synthetic-provider OAuth, signed-in routing and process-mode calculators. Registry, picker and tombstone storage are temporary. N includes the always-open shared context and N−1 signed-in contexts; `maxOpenContexts` includes that shared context too. Fresh owned contexts use the actual one-member sign-up default. Grown contexts preserve the two-member save shape and have distinct picker/account identities.

The dataset and both pack hashes are unchanged from the released-pack section. Defaults SHA-256: `1ab931d329b526e55b6283ed401b929023e7153e3e1dcd04604d85de8b4fabf0`. Source-state SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`. The grown seed is normalized through the real store codec, with **0** logical-state hash differences before/after normalization: logical backup **70,394,809 bytes**, compact state **765,849 bytes**. Earlier probes that directly stored a full logical backup are excluded from every table below. They were fixture diagnostics, not capacity evidence.

Three rotating repetitions per fresh/grown/count case; a fresh server process for every trial. Five were impractical for the full routed matrix. Same CPU/model/quota as above: 5 visible CPUs, 4-core quota, AMD EPYC 9V45, 16 GiB cgroup RAM. No other timed workload overlaps. File caches are warm; no manual GC. Prediction prewarm and retention are disabled; one-hour context/calculator idle retirement keeps residents open. “Idle” means all requested contexts are open but no explicit task-list request has been made: opening itself prepares rules, state representations and roll pools, and already starts the foreground calculator. “Warm” follows one task-list evaluate per context and one complete repeat round. These task-list HTTP requests are sequential, not the simultaneous raw-worker burst measured above.

RSS includes the entire server process and all calculator descendants. The loopback load client runs in the server process, so its response buffering is included. Steady values are phase-end observations after 250 ms; they do not imply a GC equilibrium. Sampled peaks are measured every 50 ms when the event loop is available, with child discovery every 250 ms. Synchronous server work can prevent sampling; kernel high-water marks are checked separately below. Peaks are reset before opening and before evaluation. MiB = 2²⁰ bytes. Every cell is median [min–max] across completed runs.

##### Residency with one foreground calculator

| Owned shape | Total contexts | Server idle MiB | Whole-tree idle MiB | Whole-tree opening peak MiB |
| --- | ---: | --- | --- | --- |
| fresh | 1 | 1152.8 [1115.2–1155.9] | 1983.2 [1963.8–1994.9] | 1983.2 [1963.8–1994.9] |
| fresh | 2 | 1179.1 [1170.6–1180.6] | 2117.8 [2039.0–2127.3] | 2144.1 [2082.6–2156.5] |
| fresh | 4 | 1632.3 [1627.3–1638.5] | 2619.5 [2567.9–2637.4] | 2627.6 [2581.9–2645.2] |
| fresh | 8 | 2508.5 [2461.7–2513.4] | 3479.5 [3478.2–3539.4] | 3547.8 [3487.9–3579.1] |
| fresh | 16 | 2896.0 [2888.6–2936.8] | 3855.6 [3851.0–3953.7] | 4368.4 [4118.0–4388.3] |
| grown | 1 | 1150.7 [1140.8–1151.3] | 2019.8 [2018.1–2025.1] | 2019.8 [2018.1–2025.1] |
| grown | 2 | 1813.8 [1807.3–1820.3] | 2826.3 [2722.2–2845.9] | 2826.3 [2807.9–2861.2] |
| grown | 4 | 2397.3 [2393.2–2421.9] | 3464.4 [3406.4–3537.8] | 3584.0 [3444.7–3619.7] |
| grown | 8 | 3617.0 [3598.2–3629.5] | 4711.2 [4690.4–4726.7] | 4736.0 [4735.6–4763.0] |
| grown | 16 | Heap limit | Not completed | Not completed |

| Owned shape | Total contexts | Server warm MiB | Calculator warm MiB | Whole-tree warm MiB | Whole-tree evaluation/repeat peak MiB |
| --- | ---: | --- | --- | --- | --- |
| fresh | 1 | 1168.8 [1152.6–1170.7] | 1007.6 [1006.8–1021.4] | 2177.6 [2160.2–2190.2] | 2228.3 [2184.3–2261.9] |
| fresh | 2 | 1071.7 [1069.0–1084.9] | 1106.4 [1079.9–1134.5] | 2175.4 [2164.8–2206.1] | 2264.7 [2244.0–2274.0] |
| fresh | 4 | 1402.4 [1394.5–1404.3] | 1236.0 [1211.9–1250.7] | 2630.5 [2616.2–2653.0] | 2789.9 [2747.4–2790.2] |
| fresh | 8 | 2094.6 [2052.0–2094.6] | 1425.1 [1396.8–1469.9] | 3491.4 [3477.1–3564.5] | 3564.5 [3503.4–3629.4] |
| fresh | 16 | 2918.9 [2882.4–2956.0] | 1527.7 [1514.7–1540.1] | 4459.0 [4397.2–4483.7] | 4488.9 [4466.2–4499.3] |
| grown | 1 | 1166.6 [1156.7–1167.2] | 1062.2 [1014.9–1063.8] | 2220.5 [2181.5–2229.4] | 2280.0 [2245.5–2294.6] |
| grown | 2 | 1447.4 [1410.1–1459.9] | 1216.6 [1163.3–1241.4] | 2651.4 [2610.7–2676.5] | 3065.7 [2992.6–3085.1] |
| grown | 4 | 2002.5 [1997.7–2055.1] | 1409.2 [1346.2–1425.0] | 3411.8 [3344.0–3480.1] | 3724.6 [3712.4–3736.0] |
| grown | 8 | 3257.3 [3235.1–3261.8] | 1399.2 [1324.4–1502.3] | 4656.5 [4559.5–4764.0] | 4906.9 [4872.6–4978.9] |
| grown | 16 | Not completed | Not completed | Not completed | Not completed |

Per-extra-context server RSS increments below use `(median RSS(N) − median RSS(1)) / (N−1)`, not a fitted extrapolation. The curve includes GC/allocation effects; it is not a constant retained-object size.

| Owned shape | Total contexts | Idle MiB / extra context | Warm MiB / extra context |
| --- | ---: | ---: | ---: |
| fresh | 2 | 26.3 | -97.1 |
| fresh | 4 | 159.8 | 77.9 |
| fresh | 8 | 193.7 | 132.3 |
| fresh | 16 | 116.2 | 116.7 |
| grown | 2 | 663.0 | 280.8 |
| grown | 4 | 415.5 | 278.6 |
| grown | 8 | 352.3 | 298.7 |

The default-heap grown-16 attempt failed while opening: **12** contexts reached the last checkpoint, **3,961,654,208 bytes** heap used against a **4,496,293,888-byte** heap limit, with **6,058,885,120 bytes** combined RSS at that checkpoint. One attempt failed; two further default-heap repetitions were not admitted after the same failure. This is a V8 heap boundary before the physical-RAM boundary, not a socket-test failure.


##### Opening cost and calculator lanes

A new routed request includes context materialization, compact-state loading, preparation, roll-pool work and the first task-list response. It is not comparable to a request issued after `/api/session` has already opened/prepared the context. The next measurements open N−1 contexts, evaluate them, activate the requested advisory lanes through real HTTP, then send the final picker's first task request directly. OAuth provisioning is completed before timing. All lanes are resident but their activation requests have finished before the newcomer arrives; these are not measurements of a newcomer queued behind an active prediction batch.

The multiplayer scheduler has **one foreground lane**, plus lazy prediction, peer and death lanes. Counts 2/3/4 below activate those existing lanes in that order. They do not create a pool of 2/3/4 foreground evaluators. Thus the earlier **3.91 s** raw-worker result for four identities distributed across two foreground workers measures a different topology, and excludes routed context opening. The retained per-context HTTP task-result cache also explains why a routed warm repeat can be fast after a complete round, even where raw-worker caches have evicted earlier inputs. A save/input change must re-enter the worker queues; the full-pattern results above remain relevant.

Three repetitions per row. “Peak” is sampled whole-tree RSS over all evaluation/advisory/newcomer/repeat requests. “HWM upper bound” adds the server and child kernel RSS high-water marks; those maxima need not coincide. The latter guards against event-loop sampling gaps.

| Total contexts | Calculator processes | Server warm MiB | Calculators warm MiB | Whole-tree warm MiB | Whole-tree peak MiB | HWM upper bound MiB |
| ---: | ---: | --- | --- | --- | --- | --- |
| 2 | 4 | 1473.8 [1449.4–1524.0] | 4345.8 [4298.7–4411.6] | 5822.7 [5819.6–5861.0] | 6273.7 [6247.3–6293.5] | 6601.0 [6598.9–6611.7] |
| 4 | 3 | 2068.1 [2016.5–2082.1] | 3437.9 [3308.0–3503.4] | 5519.9 [5376.1–5520.0] | 5909.3 [5897.7–5975.7] | 6223.7 [6221.5–6280.1] |
| 4 | 4 | 2087.1 [2079.0–2089.7] | 4606.9 [4541.5–4750.4] | 6696.6 [6620.5–6837.5] | 7113.3 [7082.8–7223.6] | 7418.3 [7398.4–7547.1] |
| 8 | 2 | 3240.2 [3235.3–3288.6] | 2646.4 [2587.9–2714.3] | 5881.7 [5828.1–6002.8] | 6337.3 [6331.6–6412.3] | 6648.9 [6586.0–6728.3] |
| 8 | 3 | 3287.2 [3236.6–3294.1] | 3558.6 [3551.2–3565.8] | 6838.4 [6802.4–6852.7] | 7237.2 [7195.7–7268.5] | 7542.0 [7539.6–7542.4] |
| 8 | 4 | 3292.3 [3233.7–3294.8] | 4700.6 [4694.0–4808.0] | 7992.9 [7927.7–8102.7] | 8527.2 [8364.8–8535.9] | 8826.0 [8674.5–8847.3] |

| Total contexts | Calculator processes | Newcomer cold ms, median [min–max] | Newcomer empirical p95 ms | Warm task-list p95 ms, median [min–max] |
| ---: | ---: | --- | ---: | --- |
| 2 | 4 | 8108.6 [7810.3–8188.7] | 8188.7 | 16.1 [16.0–47.4] |
| 4 | 3 | 5669.3 [5660.7–5934.8] | 5934.8 | 25.9 [14.2–50.4] |
| 4 | 4 | 5752.8 [5705.7–5870.8] | 5870.8 | 54.8 [26.0–111.9] |
| 8 | 2 | 6081.0 [5825.0–6356.0] | 6356.0 | 893.7 [877.3–925.2] |
| 8 | 3 | 6219.7 [6091.2–6466.0] | 6466.0 | 921.1 [855.5–930.9] |
| 8 | 4 | 6196.7 [6066.3–6641.9] | 6641.9 | 889.7 [847.0–901.5] |

There are only three newcomer observations per row: nearest-rank empirical p95 is the maximum, not a reliable population-tail estimate. Warm p95 uses the complete context repeat round in each run, then reports the median/range of those run-level p95s. At N=2 the newcomer has no previously opened owned clone; at larger N, other owned clones are already resident. The copied saves intentionally share gameplay inputs, so these rows do not establish a tail for diverse saves, rules or simultaneous arrivals. The lower N=4/8 cold figures cannot be interpreted as higher load making arbitrary new pickers faster.

**Does adding three or four calculators cut cold latency?** In the actual MP4 topology, no clear improvement is observed. At eight contexts the newcomer medians are **6.08 / 6.22 / 6.20 s** for 2/3/4 resident processes, while sampled peak medians are **6.19 / 7.07 / 8.33 GiB**. Additional processes run advisory lanes; foreground remains serial. Their activation has finished before timing, so these figures also exclude CPU contention from concurrent advisory work. Three and four calculators fit the 9 GiB hard application budget at eight contexts for these requests, but both exceed the 6.8 GiB budget retaining the earlier 20% headroom. More processes are not a demonstrated cold-latency improvement at this setting.

Reproduction uses private inputs only as explicit external paths; the harness copies before opening:

```sh
node scripts/perf/multi-picker-server-capacity.mjs   --runtime "$RUNTIME" --packs "$PACKS" --defaults "$DEFAULTS"   --source "$SAVE" --output /tmp/routed-capacity.json   --counts 1,2,4,8,16 --shape both --runs 3
# Additional residency/newcomer rows:
# --counts 8 --shape grown --runs 3 --direct-last --lanes 2
# --counts 8 --shape grown --runs 3 --direct-last --lanes 3
# --counts 4,8 --shape grown --runs 3 --direct-last --lanes 4
# --counts 4 --shape grown --runs 3 --direct-last --lanes 3
# --counts 2 --shape grown --runs 3 --direct-last --lanes 4
# Larger-heap diagnostic: --counts 16 --shape grown --runs 3 --heap-mb 8192
```


##### Live-box budget and recommendation

Use **11 GiB total − 2 GiB OS/other services = 9 GiB** as the hard application allowance. Keeping the previously requested **20% of total RAM** as headroom leaves **6.8 GiB = 6963.2 MiB** for the complete server/calculator process tree. The shared context is included in every count. Both sampled peak and the more conservative sum of kernel high-water marks must fit. This is a measured operating envelope for the HTTP requests above; the full alternating/prediction stress series was calculator-only and must not be presented as an integrated server stress test.

| Budget | Largest tested passing total contexts | Calculator processes | Maximum sampled peak MiB | Maximum HWM upper bound MiB | Qualification |
| --- | ---: | ---: | ---: | ---: | --- |
| 6.8 GiB with headroom | 8 | 2 | 6412.3 | 6728.3 | Requires a global process cap of 2 |
| 6.8 GiB with headroom | 4 | 3 | 5975.7 | 6280.1 | Requires a global process cap of 3 |
| 6.8 GiB with headroom | 2 | 4 | 6293.5 | 6611.7 | Existing MP4 maximum lane count |
| 9 GiB without 20% headroom | 8 | 4 | 8535.9 | 8847.3 | Fits measured requests; loses requested headroom |
| 9 GiB without 20% headroom | 16 | 1 | 7692.7 | 7866.0 | Requires 8 GiB old-space; loses requested headroom |

**Recommended setting for unchanged MP4: `maxOpenContexts = 2`, with at most its four existing calculator lanes resident (one foreground job at a time).** This is the largest tested grown context count that retains the requested headroom when all four lanes can open. It includes the shared picker and one other open picker; additional signed-in pickers can exist on disk, but these measurements do not cover eviction/reopening churn. At this setting, the measured newcomer first-task p95 is **8.19 s**, median **8.11 [7.81–8.19] s**; warm task-list p95 is median **16 [16–47] ms**, with worst observed **47 ms**. These figures assume advisory activation has finished and no foreground queue is ahead of the newcomer. They meet the requested 10 s cold / 2 s warm bounds in the three observed runs, with limited cold margin.

**Conditional larger setting: `maxOpenContexts = 8` with a hard global calculator cap of 2.** The measured newcomer p95 is **6.36 s**, median **6.08 [5.82–6.36] s**; warm p95 is median **0.89 [0.88–0.93] s**, and worst summed RSS HWM is **6.57 GiB**. Four contexts with three calculators are another measured memory frontier. MP4 exposes lazy lane creation, not a configurable global two/three-process pool. Thus neither larger setting is enforceable simply by changing `maxOpenContexts`; the multiplayer lane would need process admission/retirement or a bounded pool. No such behavior change was implemented here. Allowing all four MP4 processes at eight contexts is not equivalent to the two-process recommendation.

On a 6-vCPU host, these latency expectations assume comparable per-core speed, at least the measured four cores available for calculator/server work, and two additional cores for HTTP/storage/OS work. No latency is divided by 6/4. Six CPUs are not evidence that four independent cold compiles/evaluates become proportionally faster. Concurrent predictions, rule variants, state growth and storage stalls can move both boundaries; the observed p95s are measurements of the stated schedules, not admission guarantees for arbitrary traffic.


##### Sixteen grown contexts with a larger heap

All three fresh-process repetitions completed with `--max-old-space-size=8192` (also inherited by calculator children). The measured V8 heap limit is **8,791,261,184 bytes**. This is a separate configuration variant; it does not erase the default-heap failure. There is still only one foreground calculator.

| Contexts / calculators | Server idle MiB | Whole-tree idle MiB | Opening peak MiB | Server warm MiB | Calculator warm MiB | Whole-tree warm MiB | Evaluation/repeat peak MiB | HWM upper bound MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 / 1 | 5884.0 [5869.7–5928.6] | 6982.2 [6973.2–7035.5] | 7058.5 [7023.8–7084.6] | 5573.7 [5554.4–5598.6] | 1565.4 [1540.8–1575.8] | 7130.3 [7114.5–7164.0] | 7204.6 [7154.0–7278.6] | 7754.1 [7686.1–7828.9] |

The largest tested context count fitting the **9 GiB hard allowance** is therefore **16 / 1**, with a larger heap and worst HWM sum **7.68 GiB** including the direct-newcomer trials below. The largest tested calculator count fitting that hard allowance is **8 / 4**, worst HWM sum **8.64 GiB**. Neither retains the requested 20% headroom. No maximum beyond the tested grid is inferred, and 16 / 2 was not measured. Requesting the first task list after every context has already opened/prepared gives p95 **1.78 [1.77–1.91] s**; repeat p95 is **1.11 [1.04–1.14] s**. Those first-list values exclude opening and are not newcomer cold-latency estimates. There is no recommendation to increase the heap or deploy sixteen contexts from these results.


##### Prospective foreground pool: 2 versus 3 versus 4

These are **raw production ProcessWorker** measurements, not the advisory-lane topology or integrated HTTP server. Two-worker rows are the five-run boundary series above. Three/four-worker rows add five rotating repetitions each, cold and full-repeat rounds only, using the same pinned grown calculation-state hash. All **20** added trials completed; memory admission rejections: **0**. No other benchmark overlapped. Picker assignments are round-robin; MP4 does not currently wire this foreground pool. The complete server RSS must be added before treating these worker-only figures as a production configuration.

| Pickers / foreground workers | Ready ms | Startup core-s | Calculator HWM upper bound MiB | Driver + calculators sampled peak MiB |
| --- | --- | --- | --- | --- |
| 4 / 2 | 3284.7 [3249.3–3321.3] | 9.8 [9.6–9.9] | 2098.1 [2065.1–2120.4] | 2855.7 [2820.0–2957.8] |
| 4 / 3 | 4125.1 [4013.2–4209.1] | 15.1 [14.7–15.4] | 2876.5 [2819.9–2904.5] | 3688.4 [3637.9–3770.8] |
| 4 / 4 | 5264.3 [5208.1–5606.4] | 19.9 [19.8–21.0] | 3636.6 [3563.7–3700.3] | 4669.3 [4528.3–4678.1] |
| 8 / 2 | 3340.8 [3188.9–3415.0] | 10.0 [9.6–10.2] | 2701.8 [2552.1–2747.3] | 3473.7 [3288.8–3494.4] |
| 8 / 3 | 4129.5 [4074.3–4179.2] | 15.0 [14.6–15.2] | 3599.6 [3500.6–3717.5] | 4289.6 [4194.2–4517.9] |
| 8 / 4 | 5256.1 [5113.1–5358.3] | 19.7 [19.0–19.9] | 4200.0 [4162.2–4275.4] | 5125.7 [5090.3–5200.0] |

| Pickers / workers | Pattern | Core-s | p50 ms | Queue-inclusive p95 ms | Combined steady / peak MiB | Completed / s |
| --- | --- | --- | ---: | --- | ---: | ---: |
| 4 / 2 | cold | 11.6 [11.1–12.0] | 3427.0 | 3907.6 [3817.2–4036.7] | 2855.0 / 2855.0 | 1.02 |
| 4 / 2 | warm-round | 0.3 [0.2–0.7] | 69.6 | 122.1 [95.0–176.8] | 2839.2 / 2855.7 | 32.71 |
| 4 / 3 | cold | 15.8 [14.8–16.3] | 3898.4 | 4417.4 [4124.4–4572.1] | 3682.3 / 3682.3 | 0.91 |
| 4 / 3 | warm-round | 0.2 [0.2–0.2] | 56.1 | 94.5 [85.7–111.5] | 3688.4 / 3688.4 | 42.28 |
| 4 / 4 | cold | 19.4 [19.1–20.4] | 4937.6 | 5266.3 [5136.2–5320.9] | 4634.9 / 4640.6 | 0.76 |
| 4 / 4 | warm-round | 0.4 [0.4–0.5] | 69.8 | 109.7 [102.2–119.0] | 4669.3 / 4669.3 | 36.43 |
| 8 / 2 | cold | 16.6 [16.2–17.0] | 3999.6 | 5386.1 [5265.0–5481.4] | 3021.3 / 3046.1 | 1.49 |
| 8 / 2 | warm-round | 8.1 [7.3–9.5] | 1583.3 | 2629.0 [2572.4–2811.6] | 3369.2 / 3473.7 | 3.04 |
| 8 / 3 | cold | 20.9 [20.3–21.7] | 4602.9 | 5683.4 [5484.2–5895.1] | 4048.2 / 4230.7 | 1.41 |
| 8 / 3 | warm-round | 7.2 [6.4–8.3] | 950.0 | 2174.8 [2063.4–2344.2] | 4289.6 / 4289.6 | 3.68 |
| 8 / 4 | cold | 24.7 [23.7–24.9] | 5548.9 | 6402.6 [6188.4–6503.1] | 5035.7 / 5125.7 | 1.25 |
| 8 / 4 | warm-round | 0.9 [0.7–1.6] | 139.1 | 221.3 [176.7–391.6] | 5049.6 / 5065.7 | 36.13 |

**Plain answer for a foreground pool:** three or four workers do **not** cut the four-picker cold p95 below the two-worker **3.91 s**. It rises to **4.42 / 5.27 s** on the four-core quota; median startup CPU rises **9.8 → 15.1 → 19.9 core-s**, and median calculator HWM rises **2098 → 2877 → 3637 MiB**. Four workers do improve eight-picker warm repeats: **2.63 → 0.22 s p95**, with all five four-worker repeat runs below 2 s; three workers remain above 2 s. The cost at eight pickers is **2702 → 4200 MiB** median calculator HWM, about **1.46 GiB extra**, plus server contexts. Even using the separate measured server HWM at eight contexts, that larger foreground pool exceeds the 6.8 GiB allowance with headroom. It can fit the hard 9 GiB allowance on a summed-envelope calculation, but that is not an integrated server/pool measurement. Buying four foreground workers therefore buys warm-cache capacity at a RAM/CPU cost, not a demonstrated improvement to the current two-worker cold p95. A true six-core calculator allocation needs its own measurement; it is not forecast here.


##### Answers and limits

**1. How many active pickers?** The calculator-only simultaneous-arrival boundary is four grown identities on two foreground workers at **3.91 s cold / 0.12 s repeat p95**. Eight require four foreground workers to meet both raw-worker bounds in this measured grid (**6.40 s / 0.22 s**), and that larger pool loses the required memory headroom once server residency is included. The actual routed server answers cached warm task lists for eight contexts and opens a newcomer within the targets with two resident processes, but this is a quiescent-advisory, single-newcomer schedule, not eight simultaneous saves. For unchanged MP4 with every existing lane allowed, use the measured two-context/four-process operating point above; eight/two is conditional on a global process cap. Open-context capacity, raw active-worker capacity and HTTP cache-hit capacity are different measured limits.

**2. Is compiled state shared?** Yes within a calculator for the tested dataset/rule variant; picker identity does not cause recompilation. The original resolver/compiler coverage and released-pack startup comparison above establish this; the routed implementation passes one shared runtime, indexed world and scheduler into contexts. Each picker gets a `forPicker` facade and separate store/state/cache representations, not another compiled dataset. At eight grown contexts, warm server RSS alone is about **3.18 GiB**, with roughly **301 MiB per extra context** relative to the one-context baseline; compiled sharing does not eliminate that cost. Source inspection points to per-context store snapshots, serialized state/response caches and retained task results. Their individual retained-byte attribution was not heap-profiled, so no precise allocation breakdown is claimed. Investigating bounded response/snapshot retention or shared immutable catalogue representations is a possible follow-up; no cache/state behavior changed here.

**3. Where is the knee?** Raw-worker queueing/cache eviction misses the warm bound before CPU quota or total RAM is exhausted on one calculator. Adding three/four foreground workers then contends for the four-core quota and increases cold CPU/latency and duplicate compilation. In the integrated server, the context heap is a second knee: default-heap grown-16 fails during opening, while an 8 GiB old-space setting permits it at higher physical RSS. The production whole-tree budget is a third boundary: at eight contexts, two processes preserve the requested headroom, three/four do not. Raising the heap only moves the heap boundary; it does not make additional contexts or calculator lanes free. The recommendation is constrained by measured memory and traffic shape, not a six-vCPU speedup forecast.


##### Newcomer at the hard-budget sixteen-context boundary

Three additional larger-heap, one-calculator trials open/evaluate fifteen contexts, then time the sixteenth context's direct first task request. This closes the opening-cost gap in the larger-heap table; it does not remove the headroom objection.

| Total contexts / calculators | Newcomer cold ms median [min–max] | Newcomer empirical p95 ms | Warm p95 ms median [min–max] | Whole-tree peak MiB | HWM upper bound MiB |
| --- | --- | ---: | --- | --- | --- |
| 16 / 1 | 7189.3 [7127.4–8056.8] | 8056.8 | 1191.7 [1154.9–1195.5] | 7588.7 [7499.0–7692.7] | 7789.4 [7745.0–7866.0] |

The measured hard-budget newcomer p95 is therefore **8.06 s**, warm p95 at most **1.20 s**; both targets hold in these three runs. Only one calculator is resident and advisory requests are quiescent. Four lazy lanes at this context count were not admitted or measured, and sixteen contexts still do not fit the 6.8 GiB headroom allowance.


##### Final follow-up validation

- Reported routed-server trials: **51 completed**, **1 default-heap failure**, **2 further default-heap cases not admitted**. Full-backup fixture diagnostics, the missing-revision request probe and the interrupted trial are excluded from the tables. The interrupted run was restarted in a fresh process; no partial timing enters a median.
- Added prospective foreground-pool trials: **20 completed**, **0 rejected**, five repetitions per layout. Actual routed rows use three repetitions; all results carry that sample-size limitation.
- Final `npm run test:quick`: **2534 tests, 2466 passed, 0 failed, 68 skipped**, **69.67 s**. START: **2533 tests, 2465 passed, 0 failed, 68 skipped**. Exactly START plus the classified open-f2p smoke test. Both benchmark scripts pass syntax checks; the server benchmark help command succeeds.
- The initial full-suite result remains historical: **5765 tests, 5625 passed, 0 failed, 140 skipped**, **268.94 s**. This follow-up reran the required quick suite; application/calculator changes are **0**.
- Server benchmark SHA-256: `7216d6d7bba81e8bcae1d0be8d369085654852350ac2c5028b750097e4fdd541`. Worker benchmark SHA-256 remains `5256e58e3b0d47dd27dfca819e273d70d58116c0a4282fac36a9beaa26ba9530`.
- Multiplayer-worktree modifications: **0**. Private-checkout modifications: **0**. Source-state hash differences: **0**. Private named-value/path matches in added repository text: **0**. Prepared private fixtures and temporary server trees remaining: **0**. No push or PR.

**MERGE-CANDIDATE for the measurement scripts and report.** Production admission above the unchanged-MP4 recommendation remains conditional on calculator process admission. Diverse saves/rules, context eviction/reopening churn and concurrent advisory traffic remain outside the integrated server measurements. The earlier full-pattern calculator tables quantify their CPU/queue/memory pressure but do not substitute for an integrated stress run. No application setting or game behavior was changed.


## EN7: byte budgets for shared calculator caches

START `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`.

The original measurement and validation control was `2856d0d8d19b49c4d36718bbb2cff1d61e080610`.
The merged lane adds EN6 and plugin changes; calculator, engine, rules, dataset
and checker source differences between those two controls are **0**. The tables
from the initial study retain that original control. Current merged validation
and the additional two-picker measurements are reported at the end.

The default is 384 MiB across complete snapshots, sandbox snapshots and
all eligibility variants in one calculator process. One third is reserved for
shared eligibility proofs (128 MiB); the other two thirds form one snapshot pool
(256 MiB) with LRU
eviction across all pickers and both snapshot kinds. A picker's snapshots can
occupy at most half the total (192 MiB). Even if it supplies every proof, it cannot occupy
the whole budget. A fixed 512-entry global ceiling also bounds accounting keys
and callbacks. `RS3_CALCULATOR_CACHE_BYTES` overrides the default in integer bytes.

Proofs retain lossless gzip level-1 V8 envelopes in exact backing buffers. Hits
restore fresh mutable results and the existing non-enumerable processing facts.
Snapshots retain live graphs, charged by V8 serialized bytes for their baseline,
state, deferred views, planning maps, projections and estimates, plus keys.
Prediction closures own a separately validated state clone; its payload is
charged independently even when the input aliases the baseline state. Lazy
growth is remeasured; estimate additions are charged before asynchronous yields.
Oversized or unsupported snapshots bypass retention and still return normal
calculation results. Computation, picker-scoped keys and production message
formats are unchanged. State transfer remains a separate two-entry cache.

The hard bound is measured retained payload: 402653184 bytes, including
full proof Buffer backing stores. It is not a universal V8 heap or RSS bound.
Object headers, allocator overhead, compiled pack/index storage and active
requests are additional; active requests can retain evicted graphs until they
finish. The benchmark below tests the requested RSS constraint directly.

### Cache inventory

“Identity” below describes the existing key, not a new identity mechanism.
Definition/catalogue caches deliberately share immutable pack facts. Weak caches
release entries with their keys; their capacity is the live owner population,
not an independent numeric LRU limit. Evaluation-local caches cannot be evicted
by another picker because they are recreated for each evaluation. Compiled
lookup tables used as the algorithm's primary indexes are not result caches.

| Cache / module | Key and identity boundary | Capacity at START → EN7 | Retained value | Typical START payload bytes, median |
| --- | --- | --- | --- | --- |
| Complete snapshots, `worker` | Member + opaque picker-scoped input (or revision) + group/member/legacy rules | 2 → shared snapshot byte pool; global 512-entry ceiling | Full baseline, lazy prediction closure, planning index, estimates | 54,490,773 |
| Sandbox snapshots, `worker` | Complete calculation key + normalized changes | 2 → shared snapshot byte pool; global 512-entry ceiling | Hypothetical state, baseline, lazy play projection and delta | 44,547,112 |
| Saved state snapshots, `worker` | Picker ID + input | 2, unchanged | Parsed save; references can require resend after eviction | 15,352,594 |
| Death estimates, `worker` | Resolved death settings + candidate, inside one complete snapshot | 256 per complete snapshot | Estimate result; parent snapshot supplies state/member identity | 16,091 |
| Prediction closure, `worker` | One per complete or sandbox snapshot | 1 per snapshot | Baseline and immutable state, not per-candidate predictions | Current admission charges captured state; no isolated START closure sample |
| Planning index, `worker` | One per complete or sandbox snapshot | 1 per snapshot | Location-to-task/evidence associations | Included in parent snapshot; no isolated sample |
| Sandbox projection and delta, `worker` | Owning hypothetical snapshot | 1 each per draft | Play result and baseline-to-hypothetical delta | Included in parent snapshot; no isolated sample |
| Map projections, `worker.mapLocationResults` | Result object identity | Weak, live results | Projected map locations | 160 |
| Deferred views, `worker.viewContexts` | Result object identity | Weak; removed after full view materialization | Equipment, state and member context | 15,433,016 |
| Sandbox task indexes, `worker` | State object identity | Weak, live states | Task catalogue lookup for draft normalization | 62,810,079 |
| Serialized sizes, `worker` | State object identity | Weak, live transported states | Integer byte length used for transport validation | not sampled |
| Compiled variants, `engine` | Three feature booleans; definitions belong to engine | At most 8 per engine | Compiled evaluator and access indexes | 4,922,545 |
| Eligibility results, `eligibility-cache` | SHA-256 of conservative travel content + member + options; includes relevant partner state | 2 → 64 per dataset-bound variant; injected engines remain 2 | gzip level-1 V8 envelope; fresh mutable copy on hit | 24,705,823 |
| Shared cache budget | Buffer or snapshot object identity, shared by one worker and all engine variants | 384 MiB total measured payload and 512 entries across both snapshots and all variants | LRU ownership ledger; eviction removes the owning cache entry | New bounded ledger; bookkeeping overhead unmeasured |
| Obligations, `obligation-cache` | Task object, with visiting-path/read-footprint validation | 4096 per evaluation pass | Boolean proof + 256-bit read mask | 52 |
| Obligation masks, `obligation-cache` | Task key | 32768 per evaluation pass | 256-bit mask | 85 |
| Automatic transport baselines | Engine identity + exact travel content + member | 2 signatures per engine; member map per signature | Transport-disabled capability proof | 34,387,725 |
| Automatic transport derived facts | World identity + exact travel content + member | 1 signature per world | Personal travel facts, renewable budgets and evidence | 46,259,755 |
| Automatic transport implicit engines/configuration | World identity | Weak, live worlds | Compiled evaluator/configuration; immutable definitions | not sampled; 13,296,485 |
| Teleport return proofs | World + member + evaluated routes, roots, blocks, costs, home and catalogue content | 16 per world | Return-path decisions | 67,295 |
| Roll-pool results, `rules` | Member + task-content fingerprint + roll inputs (full state for custom hooks) | 16 per cache | Frozen pool and partner connections | 6,016 |
| Prepared pool tokens, `rules` | Token object identity | Weak, live tokens | Exact revision/input/world/registry-bound prepared pool | not sampled |
| Static fingerprint digests, `unlock-reuse` | Immutable tasks/registry/legacy object identity | Weak, live static trees | SHA-256 digest | 74 |
| Item-source index, `access.itemCache` | Definitions object identity | Weak, live definitions | Gates, drop tables and parsed-rate closure | 80,346 |
| Parsed rates, `access.compileItems` | Raw rate | Distinct rates in fixed definitions | Parsed probability | 24 |
| Access metadata and diagnostic keys, `access` | Access result identity | Weak, live results | Spawn/source metadata and diagnostic deduplication set | 483; 127 |
| Equipment catalogues, `presentation` | Equipment object + exact identity-bearing entry fields | Weak, live equipment dictionaries | Frozen task identities and field snapshot | 1,191,504 |
| Boss gear catalogues, `boss-gates` | Equipment object identity | Weak, live equipment dictionaries | Tier/class/slot catalogue | 112,652 |
| Location declarations, `chunk-planning-index` | Definitions object identity | Weak, live definitions | Sources, locations and aliases | 463,229 |
| Catalogue aliases, `fact-projection` | Catalogue identity, then saved ID/category | Weak, live catalogues; queried aliases retained, including misses | Alias targets/category indexes | 539,766 |
| Dynamic catalogue projections, `migration` | Task object within one dynamic catalogue index | Weak, lifetime of that index | Projected task identity | Not sampled by this workload |
| Membership lookup/indexes, `data/item-membership*` | Immutable catalogue identity, then exact/folded name | Weak, live fixed catalogues | Item/entity/alias/review indexes and lookup closure | not sampled; 532; 57,939; 24,165 |
| Dataset parsed inputs and values, `datasets` / `dataset-runtime` | Validated input path or value key within selected dataset | Fixed selected input/value inventory | Parsed JSON and frozen module values | 146,779; 415 |
| Replay access, `engine` | Evaluation-local task read proof/order | Evaluation lifetime, bounded by discovery work | Own/shared access and connections | not sampled; not sampled; not sampled |
| Replay raw access | Access index + member, transport mode, collection mode, territory + task reads | Evaluation lifetime | Raw access proofs | 11 |
| Replay surface eligibility | World + claimed bases, overrides, F2P flag | Evaluation lifetime | Eligibility predicate | 11 |
| Replay spatial failures | Access object + task | Evaluation lifetime | Failed spatial checks | 11 |
| Replay base sources / ownership | Source view + task reads; source entry + own-access/object identity | Evaluation lifetime | Base item-source records and ownership flags | 11,267; 6,243 |
| Replay expansions, `engine` / `access` | Table item, quantity/rate types and values, source/location + task reads | Evaluation lifetime | Drop-table expansion events and reads | 1,839 |
| Replay output expansion | Category + output | Evaluation lifetime | Expanded output rows | 1,983 |
| Replay rate cutoffs | Cutoff kind + probability, inside fixed evaluation rules | Evaluation lifetime | Boolean cutoff decision | 17; 17; 17 |
| Membership decisions, `engine` | Definitions/item; kind/category/name/location, fixed evaluation F2P mode | Evaluation lifetime | Item/source/access blockers | 160 |
| Preparation membership roots | Category/output or item, fixed definitions | One preparation call | Expanded membership outputs/blockers | 20 |
| Transport memo routes/graphs | World + state object + member/options | Evaluation lifetime | Evaluated routes and graph | 375,493 |
| Presentation membership names/tokens and legacy fields | Name/token/field/category within one state/definitions projection | Presentation-call lifetime | Membership decisions and decoded legacy lookups | not sampled; not sampled; 25; 25 |
| Death skill estimates, `time-estimates` | Skill + target level within fixed prediction | Estimate-call lifetime | Skill time estimate | 807 |
| Collection satisfaction, `collection` | Completion-family key within fixed state/member rules | Collection-call lifetime | Member IDs satisfying a completion family | not sampled |
| Identity materialization / mapped labels, `identity` | Registered ID or category/label within one identity index | Index lifetime; bounded by registered/queried identity population | Materialized registry entries and decoded labels | Not sampled by this workload |
| Completion family facts, `progress-index` | Completion-array identity / family content within one state facts index | Facts-index lifetime | Normalized IDs, member completion facts | Not sampled by this workload |
| Fact-resolution memo, `fact-projection` | Saved ID + category within one projection | Projection-call lifetime | Resolved task ID | 27 |
| Protocol adapter parsed states, `calculator/reference/host` | Picker ID + opaque input; revision restamped on reference | 2, unchanged | Parsed state for protocol body/ref transport | Not sampled by this workload |
| Protocol adapter sent-state markers, `calculator/reference/host` | Picker ID + opaque input | 2, unchanged | Boolean marker for the worker transfer LRU | Not sampled by this workload |

The production process-worker benchmark does not traverse the protocol adapter.
Its two extra transfer caches are exercised by calc-check; their entry sizes
and hit rates were not separately sampled.

The prediction response/unlock-result cache used by the scheduler is not
instantiated by the calculator. Request registries, revision/supersession
bookkeeping, identity registries, and immutable compiled definition indexes are
not calculation result caches and are outside this change.

### Measurement and selection

The initial study’s Candidate columns use 256 MiB. The approved 384 MiB
default corresponds to the explicit 384 MiB point and the current validation
section below; historical measurements are retained without relabeling them.

With the pack/default environment configured and a disposable copied save, run:

```sh
node scripts/perf/engine-cache-profile.mjs --app-dir "$START_WORKTREE" \
  --data-dir "$COPIED_SAVE" --counts 1,2,4,8 --runs 3 --rounds 2 \
  --output /tmp/cache-start.json
for budget_mib in 256 384 512; do
  node scripts/perf/engine-cache-profile.mjs --data-dir "$COPIED_SAVE" \
    --counts 8 --runs 3 --rounds 2 --cache-bytes "$((budget_mib * 1048576))" \
    --output "/tmp/cache-${budget_mib}.json"
done
node scripts/perf/engine-cache-budget-report.mjs /tmp/cache-start.json \
  /tmp/cache-256.json /tmp/cache-384.json /tmp/cache-512.json
```

Use `--only prepare-rules` for the separate unprimed preparation trials, and
`--sizes --runs 1 --rounds 1` for payload diagnostics. Add `--resume` to continue
completed trials after interruption; incomplete trials restart from a fresh worker.

Node 24; identical released-pack, source-state and eight grown-state hashes on
both sides. Every picker retains the same member IDs and revision but has
different progress and synthetic display names. One active member per picker
is measured; regression tests also interleave both members of eight pickers.
One unmeasured roll-pool request per picker selects a candidate and can prime
caches before timing. Each fresh worker then receives one cold workload round
followed by two warm rounds. A round
contains seven request types per picker. Three independent workers are used
for each budget point. START uses the matching first two warm rounds from its
three original trials; later rounds are excluded from these comparisons.
Warm p95 is computed per trial, then reported as median [minimum, maximum].
The mixed p95 pools the seven request types within a trial; per-type p95s follow.
Linux VmHWM includes the calculator process relay and isolate, excluding the
input-preparation driver. Only one calculator runs during a timed trial.

An unreserved shared LRU allowed large snapshots to evict small proofs. The
fixed reservation fixes that measured churn. The initial 16-entry experiment
also exceeded the revised memory constraint: its eight-picker median peak was
3377.8 MiB versus 2487.2 MiB across the original five-round START trials. Those
results are archived in the numeric artifact and are not the current candidate.
Trials overlapped during one interrupted restart; all affected data was discarded.
The final budget points use the same frozen implementation and isolated workers.

| Budget MiB | Mixed warm p95 ms | Area-check warm p95 ms | Warm round ms | Peak worker MiB |
| ---: | ---: | ---: | ---: | ---: |
| START | 2974.7 [2912.2, 3022.6] | 1941.4 [1932.5, 1993.6] | 77892.3 [76743.4, 77908.0] | 2476.3 [2387.0, 2522.3] |
| 256 | 2157.3 [2132.2, 2190.8] | 1516.2 [1507.2, 1558.1] | 60814.4 [59862.9, 61325.1] | 2120.0 [2091.0, 2138.5] |
| 384 | 2474.0 [2465.9, 2549.5] | 1846.7 [1844.7, 1988.2] | 68335.0 [67985.3, 68796.0] | 2215.4 [2102.6, 2297.6] |
| 512 | 2656.2 [2647.5, 2707.3] | 2088.8 [2074.2, 2096.3] | 74196.7 [73973.4, 74621.8] | 2220.6 [2165.8, 2305.8] |

The initial study selected 256 MiB: it was the smallest RSS-qualified point within 5% of
the fastest qualified mixed warm p95. Qualification checks both median and
maximum peak against the corresponding START value plus 300 MiB. Its median
RSS difference is -356.3 MiB. This is a practical selection rule,
not a claim of statistical significance from three trials.

| Budget MiB | Complete snapshot warm hit % | Sandbox warm hit % | Eligibility warm hit % |
| ---: | ---: | ---: | ---: |
| START | 83.3 [83.3, 83.3] | 0.0 [0.0, 0.0] | 42.9 [42.9, 42.9] |
| 256 | 83.3 [83.3, 83.3] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] |
| 384 | 83.3 [83.3, 83.3] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] |
| 512 | 83.3 [83.3, 83.3] | 0.0 [0.0, 0.0] | 100.0 [100.0, 100.0] |

The numeric artifact preserves every observed cache hit/miss count and rate.
Raw Map/WeakMap lookups include accounting and proof-validation lookups; a
successful container lookup is not necessarily a usable computation proof.
In particular, context/projection lookups now also support byte accounting.

| Pickers | Mixed warm p95 ms, START | Candidate | Peak MiB, START | Candidate |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2966.1 [2897.5, 3080.8] | 1272.7 [1252.1, 1317.9] | 1997.6 [1842.2, 1999.3] | 1761.9 [1739.7, 1773.5] |
| 2 | 3330.0 [3241.4, 3333.6] | 1956.3 [1955.4, 1970.8] | 2201.6 [2185.0, 2218.9] | 1943.5 [1925.7, 1998.6] |
| 4 | 2935.7 [2909.1, 3091.0] | 2156.1 [2091.0, 2172.6] | 2317.1 [2311.1, 2368.6] | 2077.0 [1994.4, 2129.5] |
| 8 | 2974.7 [2912.2, 3022.6] | 2157.3 [2132.2, 2190.8] | 2476.3 [2387.0, 2522.3] | 2120.0 [2091.0, 2138.5] |

| Pickers | Cache | Warm hit %, START | Candidate | START hits / misses | Candidate hits / misses |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | Complete | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 36 / 0 | 36 / 0 |
| 1 | Sandbox | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 6 / 0 | 6 / 0 |
| 1 | Eligibility | 37.5 [37.5, 37.5] | 100.0 [100.0, 100.0] | 9 / 15 | 24 / 0 |
| 2 | Complete | 100.0 [100.0, 100.0] | 83.3 [83.3, 83.3] | 72 / 0 | 60 / 12 |
| 2 | Sandbox | 100.0 [100.0, 100.0] | 0.0 [0.0, 0.0] | 12 / 0 | 0 / 12 |
| 2 | Eligibility | 25.0 [25.0, 25.0] | 100.0 [100.0, 100.0] | 12 / 36 | 84 / 0 |
| 4 | Complete | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 120 / 24 | 120 / 24 |
| 4 | Sandbox | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0 / 24 | 0 / 24 |
| 4 | Eligibility | 42.9 [42.9, 42.9] | 100.0 [100.0, 100.0] | 72 / 96 | 168 / 0 |
| 8 | Complete | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 240 / 48 | 240 / 48 |
| 8 | Sandbox | 0.0 [0.0, 0.0] | 0.0 [0.0, 0.0] | 0 / 48 | 0 / 48 |
| 8 | Eligibility | 42.9 [42.9, 42.9] | 100.0 [100.0, 100.0] | 144 / 192 | 336 / 0 |

| Pickers | Total warm round ms, START | Candidate |
| ---: | ---: | ---: |
| 1 | 4512.3 [4484.0, 4525.6] | 2746.4 [2675.4, 2758.7] |
| 2 | 10602.4 [10594.6, 10650.3] | 14758.8 [14390.6, 14970.4] |
| 4 | 38149.7 [38089.4, 39263.2] | 29426.7 [29302.7, 29675.0] |
| 8 | 77892.3 [76743.4, 77908.0] | 60814.4 [59862.9, 61325.1] |

At 256 MiB and two pickers the total warm round regresses by 39.2%, despite lower mixed
p95 and area-check p95. Byte pressure rebuilds several previously warm snapshots;
the full per-type table below makes that tradeoff visible. That initial 256 MiB choice prioritized the eight-picker objective; the
approved 384 MiB default resolves this measured two-picker regression.

| Pickers | Request | Cold p95 ms, START | Candidate | Warm p95 ms, START | Candidate |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | evaluate | 1968.1 [1929.5, 2087.0] | 2314.6 [2284.0, 2410.5] | 538.3 [503.8, 618.0] | 606.4 [581.4, 612.5] |
| 1 | chunk-planning | 206.9 [197.1, 279.3] | 548.8 [545.4, 551.9] | 1.5 [1.4, 1.6] | 1.8 [1.5, 3.3] |
| 1 | sandbox | 2585.4 [2460.7, 2605.4] | 3570.5 [3547.5, 3580.8] | 62.5 [59.6, 63.4] | 71.2 [59.2, 74.5] |
| 1 | area-check | 1749.6 [1745.6, 1848.7] | 1930.1 [1907.8, 2197.2] | 2966.1 [2897.5, 3080.8] | 1272.7 [1252.1, 1317.9] |
| 1 | roll-pool | 79.6 [77.1, 95.1] | 92.2 [87.9, 102.3] | 115.7 [107.7, 116.3] | 110.1 [91.9, 110.7] |
| 1 | predict | 1884.8 [1815.4, 2084.3] | 2396.2 [2282.5, 2468.3] | 1433.4 [1429.3, 1434.8] | 927.6 [881.4, 938.3] |
| 1 | death-estimates | 235.4 [224.2, 245.0] | 552.0 [530.4, 562.1] | 1.4 [1.2, 4.9] | 1.7 [1.3, 10.1] |
| 1 | prepare-rules (isolated) | 924.6 [865.2, 959.5] | 916.0 [904.7, 954.2] | 528.8 [478.9, 537.6] | 446.1 [428.8, 524.0] |
| 2 | evaluate | 2973.7 [2856.2, 2985.6] | 3483.8 [3414.0, 3521.5] | 604.1 [536.3, 650.8] | 1429.1 [1370.5, 1589.8] |
| 2 | chunk-planning | 221.5 [199.0, 245.1] | 714.8 [691.6, 790.2] | 5.7 [2.4, 7.4] | 864.5 [837.1, 951.8] |
| 2 | sandbox | 2912.3 [2742.6, 3090.6] | 3661.3 [3514.0, 3699.0] | 63.8 [61.3, 68.1] | 1489.1 [1421.0, 1510.1] |
| 2 | area-check | 1886.8 [1869.2, 1906.9] | 2040.9 [1999.2, 2096.4] | 4326.4 [4187.0, 4374.1] | 1065.8 [1057.6, 1078.8] |
| 2 | roll-pool | 87.0 [85.7, 94.8] | 105.3 [99.3, 107.1] | 85.3 [84.8, 93.0] | 115.1 [112.8, 119.1] |
| 2 | predict | 2138.0 [1827.6, 2225.0] | 2431.2 [2380.6, 2522.8] | 1138.4 [1133.2, 1163.0] | 2186.6 [2011.6, 2300.5] |
| 2 | death-estimates | 265.6 [262.0, 316.2] | 567.6 [564.2, 617.0] | 1.9 [1.5, 5.2] | 997.4 [959.5, 1011.6] |
| 2 | prepare-rules (isolated) | 963.1 [913.1, 1004.3] | 941.2 [940.5, 1027.2] | 438.8 [415.2, 457.8] | 426.3 [409.0, 456.8] |
| 4 | evaluate | 3152.0 [3098.1, 3487.7] | 3588.6 [3517.9, 3670.1] | 3183.9 [3147.5, 3292.6] | 1524.7 [1482.5, 1551.1] |
| 4 | chunk-planning | 242.7 [206.1, 412.6] | 770.0 [555.0, 808.9] | 270.6 [213.0, 276.3] | 910.0 [853.0, 943.6] |
| 4 | sandbox | 2860.2 [2726.8, 4170.9] | 3672.1 [3610.0, 3721.3] | 2881.2 [2814.5, 2935.7] | 1461.4 [1420.1, 1524.4] |
| 4 | area-check | 1967.5 [1898.0, 1984.3] | 2023.1 [2009.7, 2331.9] | 1904.7 [1870.4, 1921.4] | 1133.2 [1112.6, 1221.6] |
| 4 | roll-pool | 93.9 [89.6, 123.0] | 109.7 [108.8, 111.3] | 123.2 [90.1, 135.2] | 118.8 [115.7, 129.6] |
| 4 | predict | 2020.2 [1942.6, 2162.1] | 2581.4 [2477.5, 2656.7] | 2002.5 [1945.4, 2029.0] | 2300.8 [2269.0, 2300.8] |
| 4 | death-estimates | 275.2 [271.2, 279.8] | 605.2 [579.3, 618.4] | 310.9 [249.4, 313.3] | 772.4 [749.0, 997.4] |
| 4 | prepare-rules (isolated) | 987.9 [928.2, 1054.3] | 900.2 [875.4, 1063.8] | 426.2 [414.6, 441.2] | 411.7 [411.0, 427.4] |
| 8 | evaluate | 3204.9 [3005.6, 3205.5] | 4307.7 [3629.9, 4555.4] | 3298.3 [3267.7, 3449.3] | 1684.7 [1539.3, 1831.0] |
| 8 | chunk-planning | 216.6 [216.0, 217.4] | 828.2 [815.7, 838.3] | 220.6 [219.5, 388.6] | 992.0 [971.1, 1017.2] |
| 8 | sandbox | 2825.7 [2747.5, 2898.2] | 3623.9 [3598.2, 3780.6] | 2946.9 [2918.1, 2959.1] | 1630.2 [1568.4, 1764.2] |
| 8 | area-check | 2004.1 [1890.9, 2011.1] | 2190.0 [2052.3, 2262.4] | 1941.4 [1932.5, 1993.6] | 1516.2 [1507.2, 1558.1] |
| 8 | roll-pool | 98.8 [98.1, 103.6] | 113.5 [109.5, 119.4] | 106.6 [102.6, 122.2] | 126.5 [122.6, 248.4] |
| 8 | predict | 2610.6 [2490.4, 2635.8] | 3343.8 [3113.6, 3382.0] | 2729.1 [2600.6, 2824.3] | 2315.1 [2287.5, 2321.7] |
| 8 | death-estimates | 326.5 [288.3, 354.7] | 707.3 [634.0, 749.9] | 330.3 [311.3, 338.9] | 1088.1 [1036.7, 1154.5] |
| 8 | prepare-rules (isolated) | 974.5 [933.7, 1090.7] | 950.4 [929.7, 1006.7] | 454.7 [430.2, 502.5] | 497.3 [409.5, 603.0] |

Prepare-rules uses separate fresh-worker trials with full state bodies and no
roll-pool priming; it is excluded from the mixed timing and RSS comparisons.
Cold means the first workload round: earlier requests can prime later types.
Counter overhead is included on both sides. Subsequent runs record source and harness hashes; the original START run
predates those metadata fields and its pinned worktree remains unchanged. The selected default uses the same construction path and numeric budget as its
explicit-budget trials.

### Typical cache entry sizes

Same pack/state cohort, separate eight-picker size diagnostics from the initial
experiment. The graph representation is unchanged; current admission additionally
charges captured state and deferred contexts. These are serialized payload
proxies, not marginal retained heap; overlapping containers must not be summed.
Live samples are preferred, then admission samples. At most 32 recent values
are sampled per cache. Functions are omitted; unsampled is not zero memory.
The artifact preserves sample counts and Buffer backing-store measurements.

| Cache / probe | START bytes, median [min, max] | Compressed-proof representation |
| --- | ---: | ---: |
| `/core/automatic-transport.mjs:baseline-members` | 22419456.0 [22396263.0, 26819911.0] | 24619675.5 [22396269.0, 26819905.0] |
| `/core/automatic-transport.mjs:baseline-signatures` | 34387724.5 [22627093.0, 46148356.0] | 34387724.5 [22627099.0, 46148350.0] |
| `/core/automatic-transport.mjs:baselines` | 65451938.0 [65451938.0, 65451938.0] | 65451938.0 [65451938.0, 65451938.0] |
| `/core/automatic-transport.mjs:configurations` | 13296485.0 [13296485.0, 13296485.0] | 13296485.0 [13296485.0, 13296485.0] |
| `/core/automatic-transport.mjs:derived` | 46259755.0 [46259755.0, 46259755.0] | 46259749.0 [27130127.0, 46259749.0] |
| `/core/automatic-transport.mjs:engines` | not sampled | not sampled |
| `/core/rules.mjs:entries` | 6016.0 [4565.0, 7696.0] | 6016.0 [4565.0, 7696.0] |
| `/core/rules.mjs:preparedRollPools` | not sampled | not sampled |
| `/core/teleport-return-cache.mjs:return-decisions` | 67295.0 [66252.0, 86263.0] | 67295.0 [66252.0, 86263.0] |
| `/core/teleport-return-cache.mjs:worlds` | 1108091.5 [172521.0, 1170938.0] | 1108091.5 [172521.0, 1170938.0] |
| `/core/transport-access.mjs:routes-and-graphs` | 375493.0 [222.0, 911005.0] | 375493.0 [222.0, 911005.0] |
| `/data/item-membership-aliases.mjs:indexes` | 57939.0 [57939.0, 57939.0] | 57939.0 [57939.0, 57939.0] |
| `/data/item-membership-review.mjs:indexes` | 24165.0 [24165.0, 24165.0] | 24165.0 [24165.0, 24165.0] |
| `/data/item-membership.mjs:entityIndexes` | 532.0 [532.0, 532.0] | 532.0 [532.0, 532.0] |
| `/data/item-membership.mjs:lookups` | not sampled | not sampled |
| `/dataset-runtime.mjs:recorded` | 414.5 [78.0, 4111.0] | 414.5 [78.0, 4111.0] |
| `/datasets.mjs:parsed` | 146778.5 [683.0, 7806358.0] | 146778.5 [683.0, 7806358.0] |
| `/tasks/access.mjs:accessDetails` | 483.0 [31.0, 483.0] | 483.0 [31.0, 483.0] |
| `/tasks/access.mjs:cutoffCache` | 17.0 [10.0, 17.0] | 17.0 [10.0, 17.0] |
| `/tasks/access.mjs:diagnosticKeys` | 127.0 [11.0, 127.0] | 127.0 [11.0, 127.0] |
| `/tasks/access.mjs:itemCache` | 80346.0 [80346.0, 80346.0] | 80346.0 [80346.0, 80346.0] |
| `/tasks/access.mjs:parsedRates` | 24.0 [16.0, 30.0] | 24.0 [16.0, 30.0] |
| `/tasks/boss-gates.mjs:gearCatalogues` | 112652.0 [112652.0, 112652.0] | 112652.0 [112652.0, 112652.0] |
| `/tasks/chunk-planning-index.mjs:definitionIndexes` | 463229.0 [463229.0, 463229.0] | 463229.0 [463229.0, 463229.0] |
| `/tasks/collection.mjs:satisfaction` | not sampled | not sampled |
| `/tasks/eligibility-cache.mjs:entries` | 24705823.0 [22447662.0, 26963984.0] | 2214236.0 [2103540.0, 2773877.0] |
| `/tasks/engine.mjs:accessSources` | not sampled | not sampled |
| `/tasks/engine.mjs:itemMembership` | 159.5 [14.0, 224.0] | 159.5 [14.0, 224.0] |
| `/tasks/engine.mjs:memberItems` | not sampled | not sampled |
| `/tasks/engine.mjs:memberSources` | not sampled | not sampled |
| `/tasks/engine.mjs:membershipOutputRoots` | 20.0 [18.0, 25.0] | 20.0 [18.0, 25.0] |
| `/tasks/engine.mjs:primary-cutoff` | 17.0 [10.0, 17.0] | 17.0 [10.0, 17.0] |
| `/tasks/engine.mjs:rare-cutoff` | 17.0 [9.0, 17.0] | 17.0 [9.0, 17.0] |
| `/tasks/engine.mjs:replay.base` | 11267.0 [1808.0, 214606.0] | 11267.0 [1808.0, 214606.0] |
| `/tasks/engine.mjs:replay.baseOwnership` | 6242.5 [3630.0, 46169.0] | 6242.5 [3630.0, 46169.0] |
| `/tasks/engine.mjs:replay.expansions` | 1838.5 [136.0, 4401.0] | 1838.5 [136.0, 4401.0] |
| `/tasks/engine.mjs:replay.outputCache` | 1983.0 [377.0, 11534.0] | 1983.0 [377.0, 11534.0] |
| `/tasks/engine.mjs:replay.rawAccess` | 11.0 [11.0, 11.0] | 11.0 [11.0, 11.0] |
| `/tasks/engine.mjs:replay.spatialFailures` | 11.0 [11.0, 11.0] | 11.0 [11.0, 11.0] |
| `/tasks/engine.mjs:replay.surfaceEligibility` | 11.0 [11.0, 11.0] | 11.0 [11.0, 11.0] |
| `/tasks/engine.mjs:variants` | 4922545.0 [4922543.0, 4922547.0] | 4922545.0 [4922543.0, 4922547.0] |
| `/tasks/fact-projection.mjs:catalogueAliasIndexes` | 539766.0 [539741.0, 539791.0] | 80.0 [80.0, 80.0] |
| `/tasks/fact-projection.mjs:index` | 25.0 [25.0, 25.0] | 25.0 [25.0, 25.0] |
| `/tasks/fact-projection.mjs:resolutions` | 27.0 [27.0, 27.0] | 27.0 [27.0, 27.0] |
| `/tasks/obligation-cache.mjs:entries` | 52.0 [36.0, 60.0] | 52.0 [36.0, 60.0] |
| `/tasks/obligation-cache.mjs:masks` | 84.5 [59.0, 106.0] | 84.5 [59.0, 106.0] |
| `/tasks/presentation.mjs:equipmentCatalogues` | 1191504.0 [1191504.0, 1191504.0] | 1191504.0 [1191504.0, 1191504.0] |
| `/tasks/presentation.mjs:legacyCategories` | 25.0 [19.0, 31.0] | 25.0 [19.0, 31.0] |
| `/tasks/presentation.mjs:legacyFields` | 25.0 [19.0, 31.0] | 25.0 [19.0, 31.0] |
| `/tasks/presentation.mjs:names` | not sampled | not sampled |
| `/tasks/presentation.mjs:tokens` | not sampled | not sampled |
| `/tasks/time-estimates.mjs:skillCache` | 807.0 [739.0, 7487.0] | 807.0 [744.0, 870.0] |
| `/tasks/unlock-reuse.mjs:staticDigests` | 74.0 [74.0, 74.0] | 74.0 [74.0, 74.0] |
| `/tasks/worker.mjs:death-estimates` | 16091.0 [16091.0, 16091.0] | 18025.0 [14941.0, 52303.0] |
| `/tasks/worker.mjs:mapLocationResults` | 160.0 [142.0, 178.0] | 142.0 [72.0, 178.0] |
| `/tasks/worker.mjs:sandboxSnapshots` | 44547112.0 [44390201.0, 44704023.0] | 44325352.0 [44189959.0, 44704017.0] |
| `/tasks/worker.mjs:sandboxTaskIndexes` | 62810079.0 [62810079.0, 62810079.0] | 62810079.0 [62810079.0, 62810079.0] |
| `/tasks/worker.mjs:serializedStateSizes` | not sampled | not sampled |
| `/tasks/worker.mjs:snapshots` | 54490773.0 [54194552.0, 54786994.0] | 54016031.0 [53949665.0, 54786994.0] |
| `/tasks/worker.mjs:stateSnapshots` | 15352594.0 [15352579.0, 15352609.0] | 15352530.0 [15352403.0, 15352603.0] |
| `/tasks/worker.mjs:viewContexts` | 15433016.0 [15432381.0, 15433649.0] | 15424517.0 [15409527.0, 15505837.0] |

The shared ledger, owner totals and snapshot slot maps are accounting indexes,
not additional result caches. They have at most 512 live entries; empty owner
records are removed. Snapshot metadata/result reverse indexes are weak.

### Original correctness and tests

Public preparation originally ran as
`RS3_DATASET=open-f2p node /tmp/en7/prepare-public.mjs`. Its first error lines were:

```text
file:///workspace/chunk-picker-rs3/tools/calc-check/fixture-tools.mjs:24
    if (code !== 0) throw new Error('fixture-capture-failed');
                          ^

Error: fixture-capture-failed
```

Reproducing on untouched START identified a dataset-policy mismatch in the
first legacy fixture file. Running capture with the normal legacy suite policy
and without private game defaults passed 2073 tests, failed 0 and skipped 2
across 179 files, producing 3962 captures. No checker tooling changed. A subsequent mixed-corpus launch failed with DATASET_PACK_INVALID because a legacy capture inherited open-f2p; using the legacy base policy also fixed that pin mismatch. Dataset pins and all fixtures remain intact.
The public check uses the generated transport-definition corpus plus every
capture and checked-in fixture; all sixteen paired shards pass the strict full-coverage
merger. Private comparison reuses one completed 2-state shard plus six single-state shards, including the current save: 8 distinct states of 414.

| Gate | States | Compared requests | Differences | Errors | Corpus hash |
| --- | ---: | ---: | ---: | ---: | --- |
| Public | 4067 | 70377 | 0 | 0 | `118defbe939382c3bf021b3f1546c79e708e97c15fbdfb98166c4c2a25e6340f` |
| Private | 8 | 265 | 0 | 0 | `cdf50309f628d6b676044135fb6063b185fc9b0e0d213cbb4224dd8be40760ba` |

Sequence requests are included in compared-request counts, not added again.
Gate memory observations in the numeric artifact cover protocol-adapter process
trees; they are distinct from the production-worker RSS used for selection.
Only counts, hashes, sizes and durations derived from private inputs are retained.

| Build | Suite | Pass | Fail | Skip |
| --- | --- | ---: | ---: | ---: |
| START | quick | 2464 | 0 | 68 |
| START | full | 5614 | 3 | 140 |
| candidate | quick | 2481 | 0 | 68 |
| candidate | full | 5631 | 3 | 140 |

Individual cache files pass: eligibility 7, snapshot accounting 7, worker
isolation/churn 3, and worker timings 18. Only the authorized eviction-capacity
case changed in the existing timing file; its two-entry state-transfer checks
remain. New tests cover colliding member IDs/revisions with different states,
shared byte eviction, per-picker limits, proof reservation, oversized bypass,
lazy estimate replacement and independently charged prediction clones.

The three pre-existing START failures are:

- `art-pack-server.test.mjs`: “surface, cache, category, sprite, optimized and interior route families preserve pack bytes”.
- `cache-resources-server.test.mjs`: “browser resource imports and retained rollback mode are served by an isolated server”.
- `map-assets-server.test.mjs`: file-level “test failed”; Node reported no named subtest.

All three reproduced individually on START and the candidate. Candidate quick
and full each ran once with `RS3_TEST_CONCURRENCY=1`; each failing file then
ran once in isolation. No existing test was skipped or weakened.
The benchmark covers sequential interleaving; concurrent active jobs can retain
evicted graphs, and other state sizes can change the payload-to-RSS ratio.
The full 414-state private corpus and full-roster memory capacity are not claimed.

### Merged lane follow-up at 256 MiB

Merged `origin/lane/engine` at `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`; the checkout originally fetched only
`main`, so its stale lane tracking ref was synchronized to the fetched lane tip.
The report conflict retained both EN6 and EN7. The test selector retains the
EN6 smoke test and all three EN7 files. Only the authorized eviction-capacity
case differs in the existing timing file; its separate two-entry state-transfer
assertions remain unchanged. All task changes are staged.

The merged follow-up initially kept the 256 MiB default. A separate bounded admission
trace (excluded from latency measurements) identifies the two-picker regression:

- Mature complete snapshots cost about 81 MiB each after planning and prediction;
  sandbox snapshots cost about 42.5 MiB each. The desired four-entry working set
  is 247.3 MiB. Each picker needs about 123.8 MiB, below its 128 MiB ceiling.
- The fixed one-third proof reservation leaves only 170.7 MiB for snapshots.
  All 6 traced evictions hit this shared snapshot-pool limit; owner-limit and
  whole-ledger-limit evictions are both 0. A picker’s planning growth evicts the
  other picker’s sandbox, then its new sandbox evicts the other complete snapshot.
- Thus warm complete hits fall from 72/72 to 60/72 and sandbox hits from 12/12
  to 0/12 across the three two-picker trials. Planning indexes, prediction
  closures and death estimates then rebuild too. State-transfer capacity remains
  two and is not the cause. Eligibility hits improve, making area-check p95
  lower, but the extra medium-cost requests raise total round time by 39.2%.

New three-trial two-picker runs test the existing 384 and 512 MiB options.
Input/state hashes and calculator/harness hashes match the initial candidate.
Both larger budgets restore complete hits to 72/72 and sandbox hits to 12/12,
removing the regression. The eight-picker columns reuse the original three
trials of the identical calculator and numeric budgets; they are not new runs.
All figures are median [minimum–maximum].

| Budget MiB | Two-picker warm round ms | Two-picker peak MiB | Eight-picker mixed warm p95 ms | Eight-picker peak MiB |
| ---: | ---: | ---: | ---: | ---: |
| Original START | 10602.4 [10594.6–10650.3] | 2201.6 [2185.0–2218.9] | 2974.7 [2912.2–3022.6] | 2476.3 [2387.0–2522.3] |
| 256 | 14758.8 [14390.6–14970.4] | 1943.5 [1925.7–1998.6] | 2157.3 [2132.2–2190.8] | 2120.0 [2091.0–2138.5] |
| 384 | 6459.6 [5997.9–6965.7] | 2126.2 [2046.7–2162.6] | 2474.0 [2465.9–2549.5] | 2215.4 [2102.6–2297.6] |
| 512 | 5894.4 [5849.9–5966.0] | 2110.9 [2017.9–2180.7] | 2656.2 [2647.5–2707.3] | 2220.6 [2165.8–2305.8] |

A 384 MiB budget therefore avoids the two-picker regression and retains an
eight-picker improvement: mixed warm p95 remains 16.8% below the control, with
median peak RSS 260.9 MiB lower. At 512 MiB, the corresponding gains are 10.7%
and 255.7 MiB. Neither preserves the full 256 MiB point’s 27.5% p95 gain and
356.3 MiB RSS reduction. The approved default is now 384 MiB: it removes the two-picker regression while
retaining an eight-picker gain and staying below the control RSS. This trades
some of the 256 MiB point’s eight-picker gain for better two-picker throughput.
`RS3_CALCULATOR_CACHE_BYTES` still allows an explicit operator override.
Changing LRU ordering cannot make a 247 MiB working set fit the fixed 170.7 MiB
snapshot pool; a priority or lazy-field demotion policy could trade different
misses, but no such policy is claimed as measured or implemented here.

Reproduce the larger-budget runs with `--counts 2 --runs 3 --rounds 2` and
`--cache-bytes 402653184` or `536870912` in `engine-cache-profile.mjs`. For the
separate diagnostic, preload `engine-cache-admission-probe.mjs` through
`NODE_OPTIONS=--import=...` and set `RS3_CACHE_ADMISSION_TRACE` to a `/tmp/` path.
The trace records at most 4096 events, only sizes/counts and public cache/request
kinds; it records no state bodies or member identifiers.

| Merged check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| tests/engine-cache-eligibility.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-snapshot.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-worker.test.mjs | 3 | 0 | 0 |
| tests/worker-timings.test.mjs | 18 | 0 | 0 |
| npm run test:quick (final recorded run, one file at a time) | 2482 | 1 | 68 |

The first merged quick run passed 2482, failed 1 and skipped 68. Its only
failure was the EN6 capacity assertion at `tests/multi-picker-capacity.test.mjs:43`:
expected engineWorkCount 12, actual 4. The byte caches retain the alternating
inputs, so four unique calculations replace twelve cold calculations. The
production transport independently confirms 4 with both one and two workers.
With explicit additional approval, only this expected count changed from 12
to 4. The separate two-entry state-transfer assertions in the worker timing
file remain unchanged. Current verification at the 384 MiB default follows.

Fresh merged-control fixture preparation: 179 files, 2073 passed, 0 failed,
2 skipped, 3962 captures. Merged public calc-check: **4067 states,
70384 comparisons, 0 differences, 0 errors**, all 16 shards accepted by the
strict coverage merger. Corpus SHA-256: `294216d56f7b33c7e5a6e978876b50c340cc67ddc6ac2a5860acc48e5bf5b4f5`.
The earlier eight-state private check remains historical; calculator and input
hashes are unchanged. The full-suite counts above are also pre-merge history.
The requested merged focused files, quick suite and public gate were rerun.
Numeric follow-up: [en7-cache-merge-results.json](../../scripts/perf/en7-cache-merge-results.json).

### Approved 384 MiB default

The approved default is **384 MiB (402653184 bytes)**. The process-wide ledger
reserves 128 MiB for shared proofs and 256 MiB for both snapshot caches, with
a 192 MiB snapshot ceiling per picker and 512 retained entries globally.
Both the worker factory and the engine’s standalone shared-ledger fallback
now use 384 MiB; explicit overrides and the separate two-entry state-transfer
LRU retain their existing behavior. The only application changes since the
measured explicit-budget candidate are those two default constants.

This selection removes the measured two-picker regression: warm round time
is 6459.6 [5997.9–6965.7] ms versus the control’s
10602.4 [10594.6–10650.3] ms. Warm complete and sandbox hit rates are both 100%.
The existing explicit-384-MiB eight-picker trials retain a 16.8% mixed p95 gain
and a 260.9 MiB median peak-RSS reduction against the control. These eight-picker
figures reuse the measured identical cache policy at the selected numeric
budget; no new eight-picker timing is claimed for this final default edit.

A fresh three-trial one-picker run uses the actual default, with no byte-budget
override. Every telemetry sample reports a 402653184-byte limit, stays within
that limit and has at most 512 entries. Peak worker RSS MiB, median [min–max]:

| Control | Approved default |
| ---: | ---: |
| 1997.6 [1842.2–1999.3] | 1758.3 [1690.6–1817.5] |

Only the approved EN6 assertion changed: alternating engineWorkCount is now
4 instead of 12. It verifies four cold unique calculations and eight reused
requests on the small synthetic corpus. The test passes with both transports
and both worker layouts; no other assertion in that file changed. Existing
cache tests contained no 256 MiB default pin to update. The timing-file change
remains confined to its eviction-capacity case, including its unchanged
two-entry state-transfer assertions.

| Final default-384 check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| tests/engine-cache-eligibility.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-snapshot.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-worker.test.mjs | 3 | 0 | 0 |
| tests/worker-timings.test.mjs | 18 | 0 | 0 |
| tests/multi-picker-capacity.test.mjs | 1 | 0 | 0 |
| npm run test:quick | 2483 | 0 | 68 |

The five focused files ran individually, followed by one quick-suite run with
RS3_TEST_CONCURRENCY=1 and one complete public calc-check. The full suite was
not rerun, as requested. The public fixture capture remains the complete
merged-control capture; the control and selected fixtures did not change.

Public calc-check at the 384 MiB default: **4067 states, 70384 comparisons,
0 differences, 0 errors**, all 16 shards accepted by the strict coverage
merger. Corpus SHA-256: `294216d56f7b33c7e5a6e978876b50c340cc67ddc6ac2a5860acc48e5bf5b4f5`.
Application SHA-256: `9dfc690b696dd74405c05976ec8c9b80953b8321d6c955da1f5e3bb7e3954a41`.
Earlier validation, the failed pre-fix quick run and the 256 MiB admission trace
remain labeled as history in the numeric report. The private gate and full-suite
counts above are historical, not new runs for this default-only edit.

**MERGE-CANDIDATE.** All changes are staged. The byte quota bounds measured
payload, not total heap/RSS; compiled data, active jobs and allocator overhead
remain additional. Full-roster and other save-size memory behavior are not
claimed by the one-active-member-per-picker benchmark.


### EN7 fix: retained sandbox projections follow snapshot ownership

START `dcccaa8bf7fd36ffb6f39a13d65437540fc09514`; calculator-check reference
`1c2a07cb584f7762c9f4bc4e5af5c8acc7220462` (fetched origin/lane/engine).
An empty sandbox draft reuses a complete snapshot. Its retained play projection
and delta were assigned after the projection helper refreshed that snapshot,
then only the sandbox cache was refreshed. Refreshing both caches after these
assignments charges the owning complete cache immediately. The other retained
assignments in worker.mjs already refresh their owner: map locations, deferred
views, planning indexes, prediction clones and estimates. No other site changed.

Regression: “empty sandbox retained projections are charged to their owning cache
before reply” in tests/engine-cache-worker.test.mjs. It fails on untouched START
application code: 75651 measured bytes versus 54091 charged bytes. After the fix,
48 requests retain and evict multiple inputs while measured snapshot bytes equal
the ledger charge at every reply. Whole-ledger, snapshot-pool and per-picker
limits hold. Oversized bypass alone cannot satisfy the test. Its test-only loader
observes retained entries and the ledger without changing the production protocol.
The existing test file is already classified and assigned open-f2p.

Node 24.21.0; AMD EPYC 9V74; four-core cgroup quota; 16 GiB memory limit.
Three fresh process-worker trials per build and picker count, each with one cold
and two warm rounds, at 402653184 bytes. All reported trials run sequentially
without test workloads. Two incomplete overlapping attempts were discarded.
Input, dataset and harness hashes match between builds; input and dataset hashes
also match EN7. Historical timings used a different host (EPYC 7763), so the
fresh START comparison is the control for this fix. Values are median [min–max].

| Metric, ms | Historical EN7 at 384 MiB | Fresh START | Fix |
| --- | ---: | ---: | ---: |
| Two-picker warm round | 6459.6 [5997.9–6965.7] | 8537.4 [8079.1–8684.7] | 8044.6 [7792.6–8789.3] |
| Eight-picker mixed warm p95 | 2474.0 [2465.9–2549.5] | 3454.2 [3403.9–3476.8] | 3503.4 [3487.9–3516.3] |

The two-picker median moves down 5.8%, with overlapping ranges. Eight-picker p95
moves up 1.4% in these trials. There are zero cache-counter/hit-result differences
across 630 paired request rows. These small timing movements do not establish a
causal performance effect: this harness uses non-empty drafts, where the added
complete-cache refresh has no owning entry. EN7's historical eight-picker gain
was 16.8% against its pre-cache control; that older control was not rerun here,
so the historical relative gain is not newly established on this host.

| Peak worker RSS, MiB | Historical EN7 | Fresh START | Fix |
| --- | ---: | ---: | ---: |
| Two pickers | 2126.2 [2046.7–2162.6] | 2043.0 [2004.1–2068.8] | 2075.7 [1995.3–2097.5] |
| Eight pickers | 2215.4 [2102.6–2297.6] | 2048.3 [2047.6–2081.4] | 2072.9 [2006.3–2073.9] |

Every latency-probe ledger sample reports the 402653184-byte limit and stays
within it and the 512-entry bound. This is serialized payload admission, not a
heap/RSS ceiling; active jobs and compiled data remain additional.

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| tests/engine-cache-worker.test.mjs | 4 | 0 | 0 |
| tests/engine-cache-snapshot.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-eligibility.test.mjs | 7 | 0 | 0 |
| tests/worker-timings.test.mjs | 18 | 0 | 0 |
| npm run test:quick | 2485 | 0 | 67 |

The focused files ran individually, followed by one quick-suite run with
RS3_TEST_CONCURRENCY=1. The full suite was not run, as requested.
Numeric evidence: [en7fix-cache-results.json](../../scripts/perf/en7fix-cache-results.json).


Correctness checks use seed 17, the default request caps and sequence bound 8,
with serial reference/candidate calculators. Fresh fixture capture passed 2073,
failed 0 and skipped 2 across 179 files, producing 3962 captures. All sixteen
public shards pass the strict full-coverage merger. The private diagnostic
includes eight selected states and the current state is included; it is not the
full 414-state private gate.

| Check | States | Compared requests | Differences | Errors | Corpus SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Public | 4067 | 71980 | 0 | 0 | `b0409d442682c5496f2c59219d3b51993b23fcad9de52ab332dd6c1fce710afb` |
| Private sample | 8 | 216 | 0 | 0 | `18991b15ed60a0319dde3f836a69a7f688a6b9a7af22b4861c523ad9f98dd502` |

No checker, game behavior, byte-budget constant, state-transfer bound or existing
test assertion changed. The only production change is the owning-cache refresh.
**MERGE-CANDIDATE.**

## EN7 latency follow-up: serial evaluate

START `dcccaa8bf7fd36ffb6f39a13d65437540fc09514`; reference `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`.
Node v24.21.0, four-core cgroup quota, 16 GiB memory limit. All timing
trials run sequentially with no test or checker workload running beside them.
One calculator is resident at a time. The private input checkout is read only;
all save opening and protocol input files use disposable copies under /tmp.

### Reproduction and measurement boundary

`scripts/perf/engine-cache-latency.mjs` builds the seed-17 save corpus once,
then selects zero-based positions 4, 7 and 19: one input each from shards 5/48,
8/48 and 20/48. Each state gets five fresh reference/candidate pairs in A B A B
order. The final rerun repeats both sides after the cache change. Each calculator
receives prepare-rules, then play/full evaluate requests for both member slots,
with both duo projections. Full-view requests include the adapter's additional
projection request. State references, adapter, Node executable and input bundle
are identical between sides. Each side has 60 evaluate requests per run.

These are isolated evaluate sequences through the same protocol adapter used by
calc-check, not a replay of every request in a full private shard. The table is
median [minimum–maximum] of five trial medians; each trial median covers four
wire requests, including response decoding. It does not measure HTTP cache hits.

With the documented private pack/default environment and a disposable save copy:

```sh
node scripts/perf/engine-cache-latency.mjs \
  --reference /tmp/en7lat-reference --candidate "$PWD" \
  --data-dir "$COPIED_SAVE" --positions 4,7,19 --runs 5 \
  --output /tmp/latency.json
```

The reference directory must be a worktree at the reference commit above.
The final source fingerprint across worker, engine, eligibility-cache and
snapshot-cache is `c559fbba07914287049b19a747ab67f31e65103ade7adbcb868f426f722f3ce7`. Both timing runs have the same complete
corpus manifest hash, `cdf50309f628d6b676044135fb6063b185fc9b0e0d213cbb4224dd8be40760ba`, and identical per-state hashes.

| Sample shard | Reference before, ms | EN7 before, ms | Reference rerun, ms | Revised, ms |
| --- | ---: | ---: | ---: | ---: |
| 5/48 | 2285 [2218–2532] | 3153 [3119–3327] | 2513 [2364–2657] | 2619 [2488–2870] |
| 8/48 | 2391 [2350–2475] | 3102 [3046–3172] | 2403 [2347–2645] | 2651 [2539–2821] |
| 20/48 | 2345 [2213–2538] | 3143 [3033–3419] | 2307 [2272–2468] | 2637 [2534–2768] |

Revised latency is 14.5–16.9% lower than EN7,
but still 4.2–14.3% above the fresh reference controls.
The original gap is real without two calculators sharing the sandbox.

Calculator-process peak RSS, including adapter isolates, GiB:

| Sample shard | EN7 before | Revised |
| --- | ---: | ---: |
| 5/48 | 2.29 [2.18–2.33] | 2.20 [2.17–2.27] |
| 8/48 | 2.22 [2.17–2.23] | 2.22 [2.19–2.30] |
| 20/48 | 2.23 [2.18–2.29] | 2.22 [2.22–2.26] |

This shorter request mix does not reproduce the whole-shard peak-RSS workload.

### Cause and local change

A separate diagnostic preload times serialization, compression, decoding and
travel-input key construction; an admission trace logs only numeric costs and
public cache kinds. Instrumented runs are excluded from latency tables.
Before the change, snapshot serialization costs 948–1191 ms per cold evaluate
(two whole-graph measurements), plus 465–510 ms when promoting to the full view.
The trace records zero admission rejections and zero evictions in this sample.
Key construction costs about 11 ms; gzip costs 108–112 ms per cold proof.
Snapshot payload measurement is the dominant added work in these requests.

snapshot-cache.mjs caches the bulk graph's measured cost until a bulk root
changes. Large planning and sandbox graphs stay in that measurement so shared
references remain deduplicated. Views, locations and estimates are measured as
separate components only when changed; forced refresh still remeasures all
components. Dropping a deferred context keeps its old charge until a later bulk
measurement, without retaining that context. Unsupported data drops the cache
entry; repaired or evicted snapshots are fully measured on readmission.

The total quota, per-picker quota, proof reservation and 512-entry bound are
unchanged. Small aliases across components may be charged more than once, so
accounting remains conservative. Prediction clones remain independently charged.
The hard bound is serialized payload, not total V8 heap or process RSS.
worker.mjs, including the separately assigned snapshot-ownership fix, is untouched.

After the fix, cold snapshot serialization totals 460–471 ms (one bulk walk plus
small components), and full-view promotion costs 23–26 ms. The first measurement
and roughly 0.11 s of proof compression explain the remaining cold-path cost.

The preload also records a complete baseBytes span, which contains the nested
snapshot.serialize span; those times must not be added together. Numeric spans
and all per-request measurements are in the accompanying results artifact.
The initial whole-graph measurement and proof compression remain on cold paths.

### Multi-picker probes and verification

The existing engine-cache-profile/probe harness runs three fresh trials per
case, one cold and two warm rounds, with all seven request kinds. The revised
branch explicitly uses 402653184 bytes. The reference retains its entry-bound
policy. Dataset, source-state, grown-state and harness hashes match between sides.
Eight-picker trials use the final accounting implementation; final two-picker
trials rerun after grouping the large aliased graphs.

| Probe, median [min–max] | Reference | Revised |
| --- | ---: | ---: |
| 2 pickers, warm round ms | 16474 [16208–17101] | 8128 [7982–8583] |
| 8 pickers, mixed warm p95 ms | 4800 [4747–4890] | 2491 [2337–2508] |
| 2 pickers, peak worker RSS MiB | 2176.5 [2146.6–2203.7] | 2038.7 [1997.3–2042.6] |
| 8 pickers, peak worker RSS MiB | 2443.9 [2422.4–2475.3] | 1999.7 [1984.6–2015.9] |

All revised budget telemetry stays at or below 402653184 bytes and 512 entries.
The results artifact includes complete/sandbox hit rates and charged-byte ranges.
Only one active member per picker is used by these existing capacity probes;
other roster sizes and request mixes are not covered by their memory result.

Four synthetic accounting tests were added to the existing classified snapshot
test file: avoiding repeated baseline walks, deferred-context replacement and
forced growth, failed-measurement readmission, and deduplication of large aliases.
Focused files run individually, followed by exactly one quick-suite run.

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| tests/engine-cache-snapshot.test.mjs | 11 | 0 | 0 |
| tests/engine-cache-eligibility.test.mjs | 7 | 0 | 0 |
| tests/engine-cache-worker.test.mjs | 3 | 0 | 0 |
| tests/worker-timings.test.mjs | 18 | 0 | 0 |
| tests/multi-picker-capacity.test.mjs | 1 | 0 | 0 |
| npm run test:quick | 2488 | 0 | 67 |

Public fixture preparation: 179 files,
2073 passed, 0 failed,
2 skipped, 3962 captures. Public calc-check against
the pinned reference: **4067 states, 71970 comparisons,
0 differences, 0 errors**;
all 16 shards accepted by the strict full-coverage merger. The full npm test suite
and full private correctness gate were not rerun for this task.

Numeric evidence: [en7-cache-latency-results.json](../../scripts/perf/en7-cache-latency-results.json).
Recommendation: **NEEDS-WORK**. Repeated size walks are removed and
the multi-picker gains remain, but single-picker evaluate still has a material
cold-path cost relative to the reference.

## EN7 reply-path continuation after snapshot ownership fix

START `db42342eb2bb71d1babf3bb71bf5c0cbbfa8bd16`; reference `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`.
The preceding latency section records the first iteration. This continuation
rebases that patch onto the ownership fix and reruns its gates on Node v24.21.0,
with a four-core quota and a 16 GiB memory limit. worker.mjs is unchanged.

The same three corpus positions receive five interleaved A/B pairs each, using
the existing serial latency harness and process settings. Calculators run one
at a time, with no tests or checker workload beside them. Values below are
median [minimum–maximum] of the five trial medians, in milliseconds.

| Sample shard | Reference | Candidate | Difference |
| --- | ---: | ---: | ---: |
| 5/48 | 2,398 [2,311–2,537] | 2,542 [2,441–2,775] | +6.0% |
| 8/48 | 2,529 [2,281–2,660] | 2,592 [2,402–2,729] | +2.5% |
| 20/48 | 2,561 [2,383–2,638] | 2,521 [2,499–2,793] | -1.6% |

Two samples meet the requested 3% limit; the first remains 6.0% slower. This
fails the merge criterion. The paired inputs retain manifest hash
`cdf50309f628d6b676044135fb6063b185fc9b0e0d213cbb4224dd8be40760ba`.
The final four-module source fingerprint is `050c746e985fbba445894c9fbd4963a7e4f8eaa543e1c78b03a1e12fb6e5c006`.

Calculator process-tree peak RSS, median [minimum–maximum], MiB:

| Sample shard | Reference | Candidate |
| --- | ---: | ---: |
| 5/48 | 2,272 [2,229–2,358] | 2,279 [2,211–2,309] |
| 8/48 | 2,273 [2,179–2,373] | 2,321 [2,257–2,359] |
| 20/48 | 2,314 [2,244–2,368] | 2,321 [2,297–2,349] |

### Local changes and remaining cost

- snapshot-cache.mjs keeps the prior component accounting and four regression
  tests. It now measures each immutable state once through a weak-key size map,
  then charges that measured size separately to every retaining snapshot. The
  matching deferred-view state is omitted from the bulk measurement; distinct
  context states remain in it. Forced refresh remeasures the state and components.
- eligibility-cache.mjs retains and charges the complete uncompressed backing
  store first. A coalesced setImmediate job reads current cache entries and
  replaces them with smaller Zstandard level-1 buffers. Evicted entries have no
  pending strong reference and cannot be readmitted by the idle job. Small
  proofs and raw proofs larger than their owner quota compact synchronously.
  Decoding preserves the original mutable-result and hidden-fact behavior.
- The existing snapshot tests add independent native-size checks during a burst
  of large inserts, shared-state measurement reuse, and forced remeasurement.
  The eligibility tests add a large burst before idle compression, full raw
  charging, unchanged entry counts after eviction, and oversized-raw admission.

The byte quota, per-picker quota, reserved proof space and entry limit remain
unchanged. State memoization uses the calculator's immutable-state contract.
Compression replaces an entry only with a smaller charged backing store; its
job reads current cache entries. Prediction work can run idle jobs during its
existing event-loop yields. RSS remains a separate measure
from serialized-payload admission.

A separate instrumented trial measures 223–235 ms for the remaining cold bulk
baseline pass, 24–25 ms for full-view growth, and 10–11 ms for key construction.
The first state measurement takes 367 ms in that diagnostic; the second member
reuses it. Proof serialization takes 196–197 ms, and queued compression takes
43–103 ms after the cold evaluate reply. These nested spans are not additive.
The isolated admission trace records zero evictions and zero rejections.

An attempted conservative JavaScript graph walk took 700–723 ms and caused
additional exact sizing under pressure. It was discarded. A second prototype
privately froze and measured 20,389 compiled records (3,547,181 serialized bytes). Projecting those records out of a roughly 48 MB
baseline raised its sizing span to 542–556 ms; it too was discarded.
The remaining cold baseline pass is still on the reply path. A sufficiently
cheap, proven bound for that graph remains open. The 6% sample prevents a merge recommendation.

### Rerun gates

Each cache probe uses three fresh trials, one cold and two warm rounds, with all
seven request kinds. The candidate explicitly uses 402653184 bytes. Inputs and
harness hashes match between sides. Only one calculator runs at a time.

| Probe, median [minimum–maximum] | Reference | Candidate |
| --- | ---: | ---: |
| 2 pickers, warm round ms | 17,009 [16,934–17,864] | 8,237 [8,223–8,841] |
| 8 pickers, warm p95 ms | 5,037 [4,926–5,172] | 2,435 [2,429–2,527] |
| 2 pickers, peak worker RSS MiB | 2,178 [2,104–2,206] | 1,996 [1,959–2,020] |
| 8 pickers, peak worker RSS MiB | 2,453 [2,429–2,453] | 2,032 [1,977–2,051] |

All candidate telemetry remains within 402653184 bytes and 512 entries. The
numeric artifact retains charged-byte ranges and warm hit/miss counts.

Focused files ran separately, and the same final source passed one quick-suite
run. Discarded prototypes were reverted to the validated source fingerprint,
then focused tests ran again before the final candidate probe:

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| tests/engine-cache-snapshot.test.mjs | 13 | 0 | 0 |
| tests/engine-cache-eligibility.test.mjs | 8 | 0 | 0 |
| tests/engine-cache-worker.test.mjs | 4 | 0 | 0 |
| tests/worker-timings.test.mjs | 18 | 0 | 0 |
| tests/multi-picker-capacity.test.mjs | 1 | 0 | 0 |
| npm run test:quick | 2492 | 0 | 67 |

The public checker reused the prior reference fixture captures and their
unchanged corpus specification. All 16 newly executed shards merge with full
coverage: **4067 states, 71970 comparisons,
0 differences, 0 errors**. Manifest hash:
`f4f6eef17780043e1defd9f278a4985764c709ae64b829533afd638b4a775305`.
The full npm test suite and full private correctness corpus were not rerun.

Numeric evidence: [en7-cache-latency-reply-results.json](../../scripts/perf/en7-cache-latency-reply-results.json).
Recommendation: **NEEDS-WORK**.

## EN7 latency: sandbox, planning and area checks

START `2f9ed9949095d90532352c771f335c7c26fae3ab`; reference `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`.

Node v24.21.0. Five fresh interleaved reference/EN7 pairs per selected state, alternating A/B and B/A order. No test, checker or second calculator workload overlaps accepted timing trials. Two incomplete overlapping setup attempts were stopped and discarded. Diagnostic runs are separate from timing evidence.

The seed-17 eight-state sample has manifest SHA-256 `18991b15ed60a0319dde3f836a69a7f688a6b9a7af22b4861c523ad9f98dd502`. Three sample positions, 0, 3 and 7, are frozen once under /tmp and reused on every side. Each fresh calculator prepares rules, then for each member evaluates play and full views before two planning requests, one ordinary sandbox draft and one area check. Header and body transport match the reference protocol; the requests bypass HTTP scheduler caches. Selected identities and result contents are never reported.

Each cell below is the median [minimum–maximum] of five trial medians, in milliseconds. Planning includes a first index build and a repeat lookup; sandbox and area each have one request per member. Calculator process-tree peak RSS includes protocol adapter isolates and excludes the preparation driver.

### Before

| Sample position | Request | Reference ms | START ms | Difference |
| ---: | --- | ---: | ---: | ---: |
| 0 | chunk-planning | 278 [264–341] | 813 [715–841] | +192.8% |
| 0 | sandbox | 3,015 [2,767–3,071] | 4,038 [3,966–4,187] | +33.9% |
| 0 | area-check | 11,070 [9,903–12,446] | 14,274 [12,500–15,332] | +28.9% |
| 3 | chunk-planning | 296 [281–358] | 796 [662–866] | +169.4% |
| 3 | sandbox | 3,399 [3,054–3,627] | 4,342 [4,246–4,717] | +27.7% |
| 3 | area-check | 8,254 [7,792–9,265] | 12,153 [11,443–13,261] | +47.2% |
| 7 | chunk-planning | 173 [151–189] | 353 [347–406] | +103.8% |
| 7 | sandbox | 1,958 [1,833–2,275] | 3,155 [3,146–3,275] | +61.1% |
| 7 | area-check | 7,868 [7,473–9,183] | 9,389 [8,981–9,884] | +19.3% |

All nine observed before gaps exceed 5%.

### Profile and changes

- Planning growth reserializes the baseline and full association graph. A separate diagnostic expands the bulk measurement from 48,382,766 to 104,088,245 bytes; its two member spans are 919–1,479 ms. The added native sizing pass dominates the planning regression.
- Sandbox admission measures its hypothetical baseline before the projection exists, then measures it again after the projection and delta are assigned. The input state receives another full sizing pass. A diagnostic records 1,337 ms in these snapshot serializations, including the nested bulk spans.
- A 146,885,017-byte planned complete snapshot and an 89,343,573-byte sandbox snapshot exceed the 201,326,592-byte per-picker ceiling together. Sandbox admission evicts the complete baseline. The following area check pays 283 ms for proof decompression, 2,251 ms for decoding, and 289 ms for snapshot sizing in the diagnostic. Key construction is 5–28 ms; queued compression is 41–107 ms. The raw-buffer copy fix is unchanged.

`snapshot-cache.mjs` uses a conservative fixed-shape planning bound for immutable indexes registered by the worker. Weak references verify the baseline and map roots. Variable strings allow two bytes per UTF-16 unit plus framing; native measurements cover the literal property names. Object references and ID growth are bounded. Unknown formats, unregistered indexes and forced refreshes use joint native sizing. The complete cache reads its state owner from the deferred view context instead of retaining an additional state root after views materialize.

`worker.mjs` registers newly built planning indexes, enables context-owned state for complete snapshots, and delays ordinary sandbox admission until its reusable projection and delta are ready. Ordinary drafts retain those UI graphs; detailed requests rehydrate a full hypothetical baseline when needed. Empty drafts continue to charge their owning complete snapshot. These small request-level choices require worker changes because the cache cannot infer whether full hypothetical work will be requested.

The 384 MiB total, 128 MiB proof reservation, 256 MiB snapshot pool, 192 MiB per-picker ceiling and 512-entry limit are unchanged. The bound measures retained payload, not total V8 heap or RSS; compiled data, transfer states and active requests remain additional.

Existing classified test files add independent native-byte checks, agreement between producer and validated sizing, forced-proof revocation, deferred state ownership, and ordinary-to-detailed sandbox result parity. No existing assertion, comparison exclusion or game rule changes.

Numeric probes now recognize projection-only sandbox entries, include planning/reference-bound spans, and use hoisted native wrappers for startup-time sizing. The new request harness preserves frozen inputs outside the checkout; the optional CPU and loop diagnostics also write only under /tmp.

### Verification completed before final timings

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| engine-cache-snapshot | 16 | 0 | 0 |
| engine-cache-worker | 5 | 0 | 0 |
| engine-cache-eligibility | 12 | 0 | 0 |
| worker-timings | 18 | 0 | 0 |
| multi-picker-capacity | 1 | 0 | 0 |
| npm run test:quick | 2500 | 0 | 67 |
| Public fixture preparation, 179 files / 3962 captures | 2073 | 0 | 2 |

Application source fingerprint (worker, engine, snapshot-cache, eligibility-cache joined with NUL): `052efbe68125bc4a3ba9f1b72d3563e2fac84eea79455af21ce2b904264759c4`.

### After and the 5% target

| Sample position | Request | Reference ms | Revised ms | Difference | Within 5% |
| ---: | --- | ---: | ---: | ---: | :---: |
| 0 | chunk-planning | 308 [273–333] | 321 [319–389] | +4.2% | yes |
| 0 | sandbox | 2,975 [2,852–3,116] | 2,865 [2,752–3,069] | -3.7% | yes |
| 0 | area-check | 11,009 [9,739–11,555] | 11,702 [11,476–12,333] | +6.3% | no |
| 3 | chunk-planning | 302 [285–344] | 321 [315–340] | +6.3% | no |
| 3 | sandbox | 3,052 [2,969–3,202] | 2,980 [2,925–3,200] | -2.4% | yes |
| 3 | area-check | 8,175 [8,136–8,434] | 8,874 [8,698–9,368] | +8.5% | no |
| 7 | chunk-planning | 186 [163–214] | 181 [176–192] | -2.3% | yes |
| 7 | sandbox | 2,094 [1,785–2,146] | 2,002 [1,966–2,298] | -4.4% | yes |
| 7 | area-check | 8,292 [6,523–9,330] | 8,358 [6,513–8,410] | +0.8% | yes |

**Six of nine comparisons meet the target; three do not.** Planning at position 3 is +6.3%; area checks at positions 0 and 3 are +6.3% and +8.5%. Ordinary sandbox meets the target at all three positions. No before gap was below 5%.

Pooling the fifteen trial medians per request type gives the following additional summary. It does not replace the per-state gate. The after series has its own fresh reference trials.

| Phase | Request | Reference ms | Candidate ms | Difference |
| --- | --- | ---: | ---: | ---: |
| before | chunk-planning | 278 [151–358] | 721 [347–866] | +159.6% |
| before | sandbox | 3,015 [1,833–3,627] | 4,038 [3,146–4,717] | +33.9% |
| before | area-check | 9,109 [7,473–12,446] | 12,153 [8,981–15,332] | +33.4% |
| after | chunk-planning | 285 [163–344] | 319 [176–389] | +11.9% |
| after | sandbox | 2,969 [1,785–3,202] | 2,865 [1,966–3,200] | -3.5% |
| after | area-check | 8,434 [6,523–11,555] | 8,874 [6,513–12,333] | +5.2% |

The cold evaluate control differs by +8.2%, +14.1% and −2.0% at the three positions. That control is retained in the numeric evidence; it is not used to excuse misses in the requested gate.

The revised ordinary-request diagnostic has zero rejected admissions. The complete planned snapshot is charged at 158,619,841–158,948,441 bytes and the projection-only sandbox at 4,224,312–4,246,719 bytes, so an ordinary draft no longer evicts its baseline. Planning accounting still walks the evidence graph: 53–76 ms in the separate instrumented run. The following area requests show no snapshot sizing or proof decompression; they still serialize two proofs in 335–482 ms and run queued compression in 53–56 ms. CPU samples also show substantial engine work and garbage collection. These observations remove the original eviction explanation for the remaining area gap; they do not fully attribute its residual 6–9% difference. The raw buffer-copy fix remains unchanged.

After-series median process-tree peak RSS is 3,098, 3,129 and 3,675 MiB for the three positions, against 3,413, 3,493 and 3,735 MiB for their references. Full ranges are in the numeric evidence.

### Detailed sandbox check

Five additional fresh interleaved pairs use one queried member while retaining the complete input state. Each sequence makes an ordinary draft, a detailed request with both prediction and planning, repeats that detailed request, and returns to the ordinary draft. One invalid reference setup was discarded before selecting a valid setup; no validation rule or input state was changed. All ten measured trials completed.

| Request in sequence | Reference ms | Revised ms | Difference |
| --- | ---: | ---: | ---: |
| ordinary | 2,815 [2,648–2,936] | 2,945 [2,771–3,310] | +4.6% |
| detail-first | 2,794 [2,712–3,231] | 9,041 [8,589–9,497] | +223.6% |
| detail-repeat | 2,384 [1,380–3,022] | 13,868 [13,118–15,157] | +481.7% |
| ordinary-after | 60 [57–86] | 6,728 [6,570–7,295] | +11074.8% |

This check fails decisively. A separate final diagnostic charges the detailed snapshot at 231,269,835 bytes on its first detailed request and 230,824,186 on its repeat, above the unchanged 201,326,592-byte owner ceiling. The conservative planning bound contributes 103,027,895 bytes to each charge; this pessimistic bound makes detailed admission harder even though ordinary admission improves. Admitting the intermediate hypothetical graph first evicts the 157,080,602-byte complete baseline; adding planning then correctly rejects the oversized entry. The repeated request decodes three proofs in 6,874 ms, decompresses them in 734 ms and spends 1,397 ms in native snapshot serialization. The next ordinary draft decodes two proofs in 3,852 ms. Nested spans overlap and must not be added. This is retention/admission churn, not a change in draft key or game results.

Detailed-sequence process-tree peak RSS, median [minimum–maximum]: reference 3,668 [3,602–3,984] MiB; revised 4,236 [4,211–4,260] MiB.

### Capacity at 384 MiB

The unchanged EN7 capacity harness runs three fresh trials per version and picker count, one cold and two warm rounds of all seven request kinds. Each trial's warm-round number is the median of its two round totals; the table then summarizes the three trial medians. Warm p95 is calculated over all warm requests within each trial. Only one calculator runs at a time. Source-input, dataset and harness hashes match between versions; compile cache is disabled for these performance runs.

| Pickers | Metric | Reference | Revised |
| ---: | --- | ---: | ---: |
| 2 | compile ms | 1,729 [1,672–1,812] | 1,687 [1,683–1,869] |
| 2 | warm round ms | 16,818 [15,901–18,345] | 7,587 [7,562–7,786] |
| 2 | warm p95 ms | 5,326 [4,991–5,813] | 1,639 [1,482–1,783] |
| 2 | peak worker RSS MiB | 2,199 [2,122–2,212] | 2,007 [1,990–2,050] |
| 8 | compile ms | 1,745 [1,697–1,875] | 1,661 [1,601–1,662] |
| 8 | warm round ms | 121,524 [120,946–124,967] | 61,670 [61,259–63,722] |
| 8 | warm p95 ms | 4,755 [4,741–4,902] | 2,173 [2,171–2,243] |
| 8 | peak worker RSS MiB | 2,429 [2,413–2,460] | 1,973 [1,951–1,975] |

Two-picker warm rounds improve by 54.9%; eight-picker warm p95 improves by 54.3%. The multi-picker gain is retained. Maximum sampled charges are 237,039,655 bytes / 12 entries at two pickers and 336,351,503 bytes / 37 entries at eight, within 402,653,184 bytes / 512 entries. These are retained-payload charges; RSS is reported separately.

### Correctness and disposition

The private eight-state sample completes **216 comparisons, zero differences and zero errors**. All 16 public shards merge with full coverage: **4,067 states, 70,369 comparisons, 0 differences and 0 errors**. Manifest SHA-256: `881b78571688e613160a299e26124eea442dbfd70e3ed5c1cbe4374c0b9a8cda`.

Focused tests: **52 pass, 0 fail**. The single final quick run: **2,500 pass, 0 fail, 67 skip**. Fixture preparation: **2,073 pass, 0 fail, 2 skip**. No full npm test run was made. The application source remains at the fingerprint above throughout these gates.

The ordinary-request changes improve all initial gaps and preserve multi-picker gains, but the 5% target is missed and detailed sandbox remains much slower. A follow-up needs tighter planning accounting and an admission strategy that preserves reusable baseline/projection data when detailed graphs cannot fit. Moving accounting into the planning producer would require a change to app/tasks/chunk-planning-index.mjs, outside this brief's permitted app changes; it was not changed. The residual area gap also needs attribution.

Numeric evidence: [en7-request-latency-results.json](../../scripts/perf/en7-request-latency-results.json). **Recommendation: NEEDS-WORK**.

### Reproduction

Use Node 24.20 or later and a copied save, its sibling dataset binding, the
released packs and the matching game defaults. Set `RS3_DATASET=duo-legacy`,
`RS3_TASK_WORKER_MODE=process`, `RS3_PACKS_DIR` and
`RS3_GAME_DEFAULTS_FILE` as described by the private input README. Never open
the source save directly. All measurement outputs and frozen inputs stay
under `/tmp`.

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/engine-request-latency.mjs \
  --reference "$REFERENCE_WORKTREE" --candidate "$PWD" \
  --data-dir "$COPIED_SAVE" --inputs /tmp/request-inputs \
  --output /tmp/request-latency.json
node scripts/perf/engine-cache-profile.mjs \
  --app-dir "$VERSION_WORKTREE" --data-dir "$COPIED_SAVE" \
  --counts 2,8 --runs 3 --rounds 2 --cache-bytes 402653184 \
  --output /tmp/cache-capacity.json
```

The latency harness freezes three positions from the seed-17 eight-state
sample once; reuse that inputs directory for the START and revised series.
Its `--trial` mode accepts `--detailed` and an optional numeric `--member-slot` to follow an ordinary sandbox draft with
first and repeated detailed requests, then another ordinary request.
Run every timing series without other calculator, checker or
test workloads.

`engine-request-profile.mjs` is an optional `--import` preload for separate
CPU, cache-span, admission and planning-loop diagnostics. Its trace and profile
locations must be under `/tmp`. Instrumented runs never enter timing tables.

## EN7 latency round 4: transactional admission and producer accounting

START `2f9ed9949095d90532352c771f335c7c26fae3ab`; reference `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`. The previous round's staged work is retained above. Node v24.21.0; frozen five-file source SHA-256 `c3fef33517d6235c717945bab2fa162253370253c8ad54d0f0e5a79783b12cdd`. Source hash order: worker, engine, snapshot-cache, eligibility-cache, chunk-planning-index, UTF-8 joined with NUL.

This round stages hypothetical snapshots without publishing intermediate graphs. Final admission preflights the owner, pool, total-byte and entry ceilings before eviction. Rejection preserves the complete baseline and previous draft. Sandbox caches release deferred full-view context and source state after projection; prediction owns a separately charged clone. A detailed entry that fits alone may replace the baseline; cached draft replies then use retained projections and deltas without rebuilding that baseline. When possible, only the baseline optional planning index is released after proving the combined charge fits. An entry above the unchanged 192 MiB owner ceiling is served uncached. Shared workers retain small ordinary projections.

The planning producer accumulates fixed-shape wire bounds during construction. Every string receives a conservative two-byte bound, including Latin-1 slices that can keep two-byte backing in V8. The same counter runs in Node and the browser. Independent validation reads native encodings, and regression cases cover sliced strings, long wide strings and encoding-width boundaries. The producer uses string lengths and fixed framing costs without hashing or rewalking the evidence graph afterwards. Weak metadata verifies baseline and map roots; forced or unknown shapes retain native fallback. Prediction clone bounds reuse a measured immutable source plus changed top-level graphs, covering reference-ID widening. Native tests cover these bounds independently. Large temporary sizing buffers are released immediately after measurement; caller-owned buffers remain intact.

One picker keeps its newest raw proof only when its complete backing store fits half the unchanged proof quota. Older proofs compact, and shared pickers retain full compaction. Raw decoding copies host views individually, preserving repeated-view identity and cache isolation, rather than copying the complete wire buffer. No ceiling is raised.

### After: ordinary request types

Five fresh interleaved A/B pairs at each frozen sample position, alternating pair order. Each cell is median [minimum–maximum] of five trial medians, in milliseconds. Accepted timing runs have no concurrent checker, test or second calculator.

| Position | Request | Reference ms | Revised ms | Difference |
| ---: | --- | ---: | ---: | ---: |
| 0 | chunk-planning | 279 [264–360] | 294 [274–305] | +5.2% |
| 0 | sandbox | 2,974 [2,915–3,011] | 3,122 [2,991–3,268] | +5.0% |
| 0 | area-check | 10,084 [9,389–10,703] | 10,913 [10,700–11,160] | +8.2% |
| 3 | chunk-planning | 284 [264–364] | 294 [289–304] | +3.5% |
| 3 | sandbox | 2,977 [2,938–3,044] | 3,320 [3,170–3,473] | +11.5% |
| 3 | area-check | 7,966 [7,243–8,481] | 8,451 [8,433–8,872] | +6.1% |
| 7 | chunk-planning | 170 [156–188] | 158 [155–177] | -7.0% |
| 7 | sandbox | 1,972 [1,826–2,012] | 2,233 [2,042–2,399] | +13.2% |
| 7 | area-check | 8,081 [7,871–8,177] | 6,694 [6,546–7,772] | -17.2% |

### After: detailed sandbox

Five fresh interleaved pairs use the same valid setup and full input state as the prior round, with one queried member. An ordinary draft precedes these three requests.

| Request | Reference ms | Revised ms | Difference |
| --- | ---: | ---: | ---: |
| detail-first | 3,179 [2,910–3,624] | 4,099 [3,183–4,460] | +28.9% |
| detail-repeat | 2,512 [1,468–2,662] | 1,972 [1,471–2,233] | -21.5% |
| ordinary-after | 66 [59–112] | 61 [58–71] | -7.3% |

**6 of 12 comparisons meet the 5% target; 6 miss it.**

### Capacity at 384 MiB

Three fresh trials per side and count; one cold and two warm rounds of all seven request kinds. The warm-round value is each trial's median of its two round totals; warm p95 covers all warm requests in that trial. Peak RSS here is the worker's high-water mark, while the request harness records the whole calculator process tree. Matching input, dataset and harness hashes are retained in the numeric evidence.

| Pickers | Metric | Reference | Revised |
| ---: | --- | ---: | ---: |
| 2 | warm round ms | 16,523 [16,335–16,963] | 7,744 [7,739–7,869] |
| 2 | warm p95 ms | 5,252 [5,129–5,340] | 1,668 [1,563–1,810] |
| 2 | peak worker RSS MiB | 2,166 [2,128–2,181] | 2,058 [1,963–2,095] |
| 8 | warm round ms | 117,784 [115,445–119,925] | 62,769 [61,335–63,220] |
| 8 | warm p95 ms | 4,636 [4,551–4,670] | 2,137 [2,083–2,172] |
| 8 | peak worker RSS MiB | 2,427 [2,421–2,477] | 2,163 [2,143–2,191] |

Maximum sampled charge at 2 pickers: 257,006,468 bytes / 12 entries.

Maximum sampled charge at 8 pickers: 341,583,133 bytes / 38 entries.

The limits remain 402,653,184 total bytes, 134,217,728 proof bytes, 268,435,456 snapshot bytes, 201,326,592 bytes per picker and 512 entries. These are retained-payload charges, not RSS.

### Area profile evidence and limits

Before changing the area path, separate reference/revised diagnostics reproduced the two gaps. The area requests contain no snapshot sizing, baseline decoding or raw-buffer-copy spans. At position 3, engine time is 9,055 → 9,743 ms and 3,065 → 3,402 ms; native proof serialization is 467 → 542 ms and 315 → 335 ms. The revised path also runs 49–54 ms of queued compression. CPU samples attribute most of the remaining difference to the engine fixed point: exclusive engine samples are 4,367 → 4,956 ms and 1,292 → 1,434 ms; GC samples are 1,817 → 1,777 ms and 1,122 → 1,026 ms. Position 0 also has increased engine and GC samples. Instrumented spans are not timing-table evidence, and nested spans are not additive.

No area calculation or fixed-point engine code changed in this round. The earlier profiles locate substantial time in app/tasks/engine.mjs. They do not establish a single root cause or justify changing game rules. Final-source evidence below also finds remaining cache compression costs.

### Checks

Touched and related focused files ran one at a time before one final quick-suite run.

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| engine-cache-snapshot | 21 | 0 | 0 |
| engine-cache-eligibility | 14 | 0 | 0 |
| engine-cache-worker | 7 | 0 | 0 |
| chunk-planning | 11 | 0 | 0 |
| worker-timings | 18 | 0 | 0 |
| multi-picker-capacity | 1 | 0 | 0 |
| quick | 2509 | 0 | 67 |

Final-source profiles identify 254–305 ms of hypothetical-baseline measurement on ordinary sandbox requests. Engine time is slightly lower than reference in those instrumented requests; decoding and buffer-copy spans are absent. This is still a cache sizing cost and the ordinary sandbox target remains unresolved on two samples.

The detailed candidate is measured at 179,988,907 bytes before successful admission; it fits the unchanged 201,326,592-byte owner ceiling. It then evicts the 144,253,504-byte complete baseline, and subsequent draft hits do not rebuild it. Separate first-detail profiles show only 0.6 ms of reference-bound work, 0.2 ms of planning accounting, and raw proof decoding at 1,334 ms versus 1,318 ms reference. In accepted trials, median prediction time is 3,509 ms versus 2,683 ms and engine time is 1,791 ms versus 1,387 ms. Separate CPU samples show GC at 506 ms versus 407 ms. The first-detail residual is in prediction preparation/eligibility-hit execution and allocation, rather than repeated final admission or baseline rebuilding. These diagnostics identify locations and do not prove a single root cause.

Final-source area diagnostics add an unresolved cache-path cost: proof compression totals 660 ms and 108 ms in the two candidate request windows. The first candidate window also has 365 ms of exclusive buffer-internal samples, while exclusive engine samples are 4,313 versus 4,179 ms and GC samples are 998 versus 1,206 ms. These samples indicate compression/allocation overhead in eligibility-cache.mjs, as well as engine execution. Span collection can include queued work between replies, so the compression total is not proven to be entirely on the request critical path. Snapshot sizing and baseline decoding spans remain absent. A safe compaction/admission policy meeting all latency targets is still unresolved; this round does not claim the area gap is wholly outside the cache files.

The five-pair planning residual at position 0 is +5.2%; position 3 is +3.5% and position 7 is -7.0%. Producer accounting removes the repeated graph traversal, but one planning comparison still narrowly misses the target. No successful row compensates for a failed row.

Private sample: **8 states, 188 comparisons, 0 differences, 0 errors**. Manifest SHA-256: `18991b15ed60a0319dde3f836a69a7f688a6b9a7af22b4861c523ad9f98dd502`.

Public strict 16-shard merge: **4,067 states, 70,369 comparisons, 0 differences, 0 errors**. Manifest SHA-256: `881b78571688e613160a299e26124eea442dbfd70e3ed5c1cbe4374c0b9a8cda`.

The private sample uses normal parallel comparison with the same eight-state manifest, default request caps and sequence length 8. It stays in one calculator batch; the earlier serial run split it into four two-state batches. Recorded comparisons are 188 versus 216 because prepare-rules deduplication and batch-level replay counts differ. No state or request type is excluded. Memory headroom was checked before enabling parallel calculators.

Both correctness corpora are rerun because producer and proof-decoding code changed. Prior public fixture captures are reused; caps, sequence length, assertions and exclusions are unchanged. The public checker alone uses Node's compilation cache. Performance probes do not.

Recommendation: **NEEDS-WORK**. Full numeric evidence: [en7-request-latency-results.json](../../scripts/perf/en7-request-latency-results.json).

## EN7 latency final round: reuse proof sizing

START `2f9ed9949095d90532352c771f335c7c26fae3ab`; reference `1c2a07cb584f7762c9f4bc4e5af5c8acc7220462`. Node v24.21.0; final five-file source SHA-256 `88c832ae608962a17880ee24feeb9fb1ed44e227a71f67684ff2ba07bd0284f6` (worker, engine, snapshot-cache, eligibility-cache, chunk-planning-index, UTF-8 joined with NUL). The previous staged work is preserved.

This round changes caching and sizing only. A single-picker sandbox reuses the eligibility producer's existing native wire size, conservatively bounding reference-ID widening, UTF-16 alignment and completion-overlay growth. The worker records immutable engine roots before appending its collection/equipment rows; snapshot accounting measures those additions, projections and diagnostic tails separately. Shared roots/rows receive conservative reference charges. Unknown or forced measurements use native fallback. The independent diagnostic helper checks the producer charge against a full native floor, keeping strict ledger assertions. No ceiling changes.

Wire measurement metadata is created only for a scoped sandbox-producing evaluation. The consumed wire reference is cleared after deriving its bound; metadata does not strongly retain buffers. Future prediction and area evaluations do not create this metadata. Shared-picker admission and compression policies are unchanged.

### Focused profiles

One state-7 sandbox request after its normal warm-up was profiled against START, reference, and the previous staged source. START spends 586 ms in snapshot serialization versus 135 ms for the staged source; the reference has no snapshot serialization. The producer-sizing pilot reduces snapshot base measurement from 137 to 32 ms. Its ordinary draft before detailed work measures at 43 ms. These are diagnostic runs, not accepted timing trials; the pilot precedes the final measurement-scope restriction, and both hashes are retained in the numeric evidence.

For the first detailed request, the staged source spends 2,934 ms in prediction versus 2,207 ms reference; cache measurement is below 1 ms. The ordinary request already supplies the evaluated hypothetical baseline. The detailed reply additionally needs a validated frozen prediction input and its future evaluation, so that work cannot be moved after the response without withholding the requested prediction. No prediction result calculation changed.

### Updated affected rows

Five fresh interleaved reference/candidate pairs. Cells are milliseconds, median [minimum–maximum] across five trial medians. The normal request sequence is retained as warm-up; only affected rows are reported. Detailed repeat and following ordinary rows check that the admission fix remains warm. No other calculator, tests or checker ran alongside accepted timing trials.

| State position | Request | Reference ms | Revised ms | Change |
| ---: | --- | ---: | ---: | ---: |
| 0 | sandbox | 2,866 [2,699–3,024] | 2,832 [2,703–2,908] | -1.2% |
| 0 | area-check | 9,734 [9,219–10,196] | 11,077 [10,182–11,258] | +13.8% |
| 3 | sandbox | 3,046 [2,830–3,188] | 3,029 [2,847–3,057] | -0.6% |
| 3 | area-check | 7,653 [7,246–8,441] | 8,316 [7,555–8,744] | +8.7% |
| 7 | sandbox | 1,915 [1,830–2,015] | 2,043 [1,980–2,170] | +6.7% |
| 0 | detail-first | 3,113 [2,704–3,196] | 3,349 [2,650–4,069] | +7.6% |
| 0 | detail-repeat | 1,645 [1,445–2,654] | 2,245 [1,394–2,668] | +36.5% |
| 0 | ordinary-after | 83 [59–122] | 67 [51–98] | -19.6% |

3 of 8 comparisons meet 5%; 5 remain above target.

### Capacity probes, 384 MiB

One new candidate probe at each count, with one cold and two warm rounds of all seven request types. Previous reference and candidate columns are the prior round's three-trial medians; the new column is one probe's median [range] of its two warm rounds. Input, dataset and harness hashes match the prior probes. These single probes can reveal a large trade, but cannot establish a small latency change statistically.

| Pickers | Previous reference warm-round ms | Previous candidate ms | New candidate ms | New warm p95 ms | New peak worker RSS bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 16,523 [16,335–16,963] | 7,744 [7,739–7,869] | 7,818 [7,601–8,035] | 1806 | 2117128192 |
| 8 | 117,784 [115,445–119,925] | 62,769 [61,335–63,220] | 60,537 [60,421–60,654] | 2119 | 2183532544 |

Maximum sampled charge at 2 pickers: 257738888 bytes / 12 entries.

Maximum sampled charge at 8 pickers: 341581342 bytes / 38 entries.

Limits remain 402,653,184 total bytes, 134,217,728 proof bytes, 268,435,456 snapshot bytes, 201,326,592 bytes per picker and 512 entries. Retained-payload accounting is distinct from process RSS.

### Checks

Focused files ran one at a time before one quick-suite run on the final source.

| Check | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| engine-cache-snapshot | 22 | 0 | 0 |
| engine-cache-eligibility | 16 | 0 | 0 |
| engine-cache-worker | 7 | 0 | 0 |
| chunk-planning | 11 | 0 | 0 |
| worker-timings | 18 | 0 | 0 |
| multi-picker-capacity | 1 | 0 | 0 |
| quick | 2512 | 0 | 67 |

The full checkers were not rerun, as explicitly permitted for caching/sizing-only changes. The previous source passed the private sample (8 states, 188 comparisons, 0 differences/errors) and all 16 public shards (4,067 states, 70,369 comparisons, 0 differences/errors); those are prior validation, not newly claimed results. The current worker and accounting tests cover output parity, overlays, aliases, independent native bounds, forced fallback, rejected admissions and warm detailed/ordinary reuse.

An ordinary what-if on the remaining slower samples takes up to about 128 ms longer. Producer sizing removes the duplicate large traversal, but remaining projection/serialization and allocation work still exceeds the target.

The first detailed check after a fresh calculator takes about 0.24 s longer. Its prediction still needs validation and a future evaluation before it can be returned, and the existing ordinary baseline is already reused.

A repeated detailed check has a 0.60 s slower median here. It still evaluates the future and decodes its proof before replying; the exact cause of the additional time remains unresolved.

An area check on the remaining slower samples takes up to about 1343 ms longer. Earlier profiles locate engine execution, proof compression and allocation costs; this round leaves the shared compression policy unchanged to preserve the multi-picker behavior.

Recommendation: **NEEDS-WORK**. Numeric evidence: [en7-request-latency-results.json](../../scripts/perf/en7-request-latency-results.json).
