# HTTP heap: one versus seven account pickers, before EN7

START `b42defc930df99262b36ade59b157b201f309145`. Measured 30 October 2026 on Linux x86-64, Node **24.21.0**, V8 13.6 (as bundled with that Node), four available CPUs, 16 GiB cgroup memory limit. Only this document changes; no application code, fixtures, packs or tests change. No private packs or saves were opened or copied.

Seven account pickers retain **26.676 MiB HTTP heap** versus **19.893 MiB** for one: **1.13049 MiB additional HTTP heap per account picker**. HTTP RSS marginal is **5.06576 MiB**; combined HTTP/calculator RSS marginal is **10.15951 MiB**. The biggest identified per-picker retainer is the context's **responseCache**, **0.36481 MiB/picker** in the snapshot difference (including retained backing stores).

## Method and count convention

A scratch harness outside the checkout imports the real `createServer`, uses bundled public `open-f2p`, enables `multiPicker`, and sets `RS3_TASK_WORKER_MODE=process`. Each fresh temporary store uses actual local HTTP listeners, HTTPS proxy headers and a synthetic Discord OAuth provider with numeric subjects and Player labels. The flow follows `tests/picker-routing.test.mjs:36`; the brief's `tests/phase1-acceptance.test.mjs` does not exist at START. Provider requests are answered locally. No real OAuth service is contacted.

Three fresh HTTP processes each progress through **0 → 1 → 7 account pickers**. Each account signs in, loads full `/api/state`, completes one full `/api/tasks?memberId=…` request, and then idles. Responses are fully consumed in the separate supervisor, and task responses must report calculator execution. After each measured step the HTTP process idles 1,000 ms, runs `global.gc()`, waits 100 ms and runs GC again under `--expose-gc`; it records `process.memoryUsage()` and the complete numeric fields of `v8.getHeapSpaceStatistics()`. Calculator RSS comes from Linux `/proc/PID/status`. Calculator isolates are not explicitly collected; their RSS includes their normal allocator history. One calculator process remains resident at every step in all trials, including baseline. Its relay and calculator thread share one PID and are counted once.

**Baseline means no account picker open.** The real server always opens its compatibility/legacy context. Thus the columns below contain **1, 2 and 8 total resident contexts**. The router's default `maxOpenContexts=7` includes legacy (`app/picker-router.mjs:17`, `:75`), leaving six account slots. The harness explicitly sets `maxOpenContexts:8` to retain all seven accounts, and uses the routing test's `registrationsPerAccount:20, registrationsGlobal:40` to create them without waiting for the sign-in budget. All other multiplayer residency and calculator defaults remain in effect; the calculator pool limit is two, but sequential work uses one. `predictionPrewarm:false` suppresses automatic prediction work; direct `createServer` startup does not enable the early-listener startup warmup. Contexts remain open, and the run finishes before the ten-minute idle eviction/worker-retirement interval.

The supervisor samples numeric PID ancestry and RSS every 50 ms and terminates on a total above 3,500 MiB, including itself. Ordinary trials peak at **245.73828 [243.74219–245.94141] MiB** for HTTP plus calculator, and **307.60156 [303.50391–308.08984] MiB** including the supervisor. A separate fourth trial takes the two snapshots and peaks at **315.06250 MiB** for the server tree (**379.05859 MiB** including supervision). Snapshot overhead is excluded from all three-trial tables. Sampling can miss peaks between ticks; these are observed peaks, not an OS-enforced memory ceiling. An initial registration-budget refusal and runs with an incomplete process-tree monitor were discarded and repeated in full.

## Post-GC process measurements

All values are MiB (1,048,576 bytes), **median [min–max]**, three trials. The marginal column is **(median at 7 − median at 1) / 6**, calculated before rounding. RSS totals use /proc readings taken just after the IPC memory sample, so small differences from summing the separately timed HTTP and calculator API values are expected.

| Metric | Baseline: 0 accounts | 1 account | 7 accounts | Marginal per account |
| --- | ---: | ---: | ---: | ---: |
| HTTP rss | 86.85938 [86.02344–88.50781] | 91.75781 [90.69531–93.30078] | 122.15234 [121.30078–123.14063] | 5.06576 |
| HTTP heapUsed | 17.98795 [17.98775–17.98849] | 19.89264 [19.67759–20.11069] | 26.67556 [26.67457–26.67654] | 1.13049 |
| HTTP external | 5.28920 [5.28920–5.28920] | 5.70892 [5.70892–5.70892] | 8.20369 [8.20368–8.20369] | 0.41579 |
| HTTP arrayBuffers | 1.93577 [1.93577–1.93577] | 3.28092 [3.28092–3.28092] | 8.87134 [8.87132–8.87134] | 0.93174 |
| HTTP heapTotal | 51.72656 [51.72656–51.97656] | 53.66797 [53.41797–53.91797] | 60.28125 [60.03125–92.28125] | 1.10221 |
| Calculator process RSS (one PID) | 77.41797 [76.80859–77.57031] | 90.53125 [90.49219–90.72656] | 120.99219 [115.85938–121.17969] | 5.07682 |
| HTTP + calculator /proc RSS | 164.60156 [164.26172–165.71875] | 182.93359 [181.77344–184.37500] | 243.89063 [237.66406–244.58984] | 10.15951 |

Paired trial marginals (compute each trial's difference first) are **1.13065 [1.09414–1.16616] MiB heap**, **4.97331 [4.92383–5.24284] MiB HTTP RSS**, and **10.03581 [9.12174–10.35286] MiB combined RSS**. The difference of medians need not equal the median of differences. RSS includes pages left committed by earlier allocations; its calculator slope does not imply a new calculator or a permanently retained graph for each picker. `arrayBuffers` and `external` overlap with V8/native allocation accounting and must not be added to heap or RSS to create a total. SharedArrayBuffer accounting also differs between APIs.

## V8 heap spaces

Same three post-GC samples and units. Each API field is reported; no space is omitted.

| Space / field | Baseline | 1 account | 7 accounts | Marginal per account |
| --- | ---: | ---: | ---: | ---: |
| read_only_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |
| new_space / space_size | 32.00000 [32.00000–32.00000] | 32.00000 [32.00000–32.00000] | 32.00000 [32.00000–64.00000] | 0.00000 |
| new_space / space_used_size | 0.00343 [0.00343–0.00343] | 0.00350 [0.00350–0.00350] | 0.00222 [0.00222–0.00222] | -0.00021 |
| new_space / space_available_size | 15.99560 [15.99560–15.99560] | 15.99552 [15.99552–15.99552] | 15.99680 [15.99680–31.99583] | 0.00021 |
| new_space / physical_space_size | 16.00391 [16.00391–16.00391] | 18.71094 [18.71094–18.71094] | 31.75391 [31.50781–32.25391] | 2.17383 |
| old_space / space_size | 14.16406 [14.16406–14.41406] | 14.91406 [14.91406–15.16406] | 17.91406 [17.66406–17.91406] | 0.50000 |
| old_space / space_used_size | 13.05082 [13.05067–13.05135] | 13.78122 [13.78105–13.78217] | 16.91011 [16.90961–16.91045] | 0.52148 |
| old_space / space_available_size | 0.07618 [0.03423–0.08525] | 0.20341 [0.15002–0.42953] | 0.09682 [0.06773–0.10338] | -0.01777 |
| old_space / physical_space_size | 14.25000 [14.25000–14.50000] | 15.00000 [15.00000–15.25000] | 18.00000 [17.75000–18.00000] | 0.50000 |
| code_space / space_size | 1.25000 [1.25000–1.25000] | 1.50000 [1.50000–1.75000] | 2.25000 [2.25000–2.25000] | 0.12500 |
| code_space / space_used_size | 0.97705 [0.97699–0.97705] | 1.20245 [1.19617–1.20251] | 1.98560 [1.98560–1.98682] | 0.13052 |
| code_space / space_available_size | 0.00000 [0.00000–0.23584] | 0.27121 [0.00000–0.27902] | 0.00000 [0.00000–0.00000] | -0.04520 |
| code_space / physical_space_size | 1.25000 [1.25000–1.25000] | 1.50000 [1.50000–1.75000] | 2.25000 [2.25000–2.25000] | 0.12500 |
| shared_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |
| trusted_space / space_size | 2.62109 [2.62109–2.62109] | 2.87109 [2.87109–3.12109] | 3.12109 [3.12109–3.12109] | 0.04167 |
| trusted_space / space_used_size | 2.28666 [2.28666–2.28667] | 2.59296 [2.59147–2.59297] | 2.85007 [2.84991–2.85017] | 0.04285 |
| trusted_space / space_available_size | 0.33421 [0.17313–0.33423] | 0.20574 [0.00000–0.48901] | 0.00000 [0.00000–0.00000] | -0.03429 |
| trusted_space / physical_space_size | 2.75000 [2.75000–2.75000] | 3.00000 [3.00000–3.25000] | 3.25000 [3.25000–3.25000] | 0.04167 |
| shared_trusted_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |
| new_large_object_space / space_size | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 |
| new_large_object_space / space_used_size | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 |
| new_large_object_space / space_available_size | 16.00000 [16.00000–16.00000] | 16.00000 [16.00000–16.00000] | 16.00000 [16.00000–32.00000] | 0.00000 |
| new_large_object_space / physical_space_size | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 |
| large_object_space / space_size | 1.53516 [1.53516–1.53516] | 1.97656 [1.97656–1.97656] | 4.62500 [4.62500–4.62500] | 0.44141 |
| large_object_space / space_used_size | 1.52130 [1.52130–1.52130] | 1.95601 [1.95601–1.95601] | 4.56425 [4.56425–4.56425] | 0.43471 |
| large_object_space / space_available_size | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 |
| large_object_space / physical_space_size | 1.53516 [1.53516–1.53516] | 1.97656 [1.97656–1.97656] | 4.62500 [4.62500–4.62500] | 0.44141 |
| code_large_object_space / space_size | 0.15625 [0.15625–0.15625] | 0.15625 [0.15625–0.15625] | 0.37109 [0.37109–0.37109] | 0.03581 |
| code_large_object_space / space_used_size | 0.15601 [0.15601–0.15601] | 0.15601 [0.15601–0.15601] | 0.36737 [0.36737–0.36737] | 0.03523 |
| code_large_object_space / space_available_size | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 [0.00000–0.00000] | 0.00000 |
| code_large_object_space / physical_space_size | 0.15625 [0.15625–0.15625] | 0.15625 [0.15625–0.15625] | 0.37109 [0.37109–0.37109] | 0.03581 |
| shared_large_object_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |
| shared_trusted_large_object_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |
| trusted_large_object_space: all four fields | 0 [0–0] | 0 [0–0] | 0 [0–0] | 0 |

## Heap snapshot attribution: top ten identified retainers

One HTTP snapshot at one account and one at seven are taken in a separate fourth process, after the same load/GC sequence. The one-account snapshot is taken before opening the other six; snapshot generation can change V8 sizing/JIT state, so these are attribution samples, not extra performance trials. They contain **212,033 / 255,916 nodes**, with **27,709,549 / 40,898,557 bytes** reachable under the analysis below: **2.09634 MiB marginal graph size**. This graph size includes native backing-store nodes and is not equivalent to `heapUsed`.

The scratch analyzer builds immediate dominators from root node 0 over all non-weak edges (five convergence passes for each snapshot), then sums self sizes through that tree. Named closure variables and store snapshots identify ownership; targets are counted once per owner group. The table ranks the largest identified picker-associated owner groups by (seven-account retained bytes minus one-account retained bytes) / 6. Nested rows such as a response representation's encoding Map are included in their parent and are not counted again. Store calculation snapshots have several references; each unique snapshot target is counted once. Shared dataset roots are excluded. Retained sizes include native backing stores, and this simple strong-edge analysis is not a full V8 ephemeron liveness model.

| Retainer | 1 account, MiB | 7 accounts, MiB | Difference / 6, MiB | Ownership and source |
| --- | ---: | ---: | ---: | --- |
| `picker.responseCache` | 0.30531 | 2.49417 | 0.36481 | Per picker; encoded state response buffers and representation cache (`app/picker-context.mjs:243`) |
| `store.calculationSnapshot` | 0.47238 | 1.88711 | 0.23579 | Per picker; calculation input and lazy shared JSON buffer (`app/storage/store.mjs:540`) |
| `store.currentDiskSerialized` | 0.47073 | 1.88072 | 0.23500 | Per picker; serialized current save (`app/storage/store.mjs:323`) |
| `scheduler.cache` | 0.62627 | 1.86851 | 0.20704 | Per server foreground lane; bounded result cache serving all pickers (`app/tasks/scheduler.mjs:492`) |
| `picker.savedTaskResults` | 0.05724 | 0.69314 | 0.10598 | Per picker; play bytes and compressed full task result (`app/picker-context.mjs:314`) |
| `store.taskCatalogue` | 0.07802 | 0.31207 | 0.03901 | Per picker; Map and copied catalogue rows (`app/picker-context.mjs:159`) |
| `picker.questMapping` | 0.02701 | 0.10803 | 0.01350 | Per picker; quest mapping Map (`app/picker-context.mjs:178`) |
| `picker.gamePlugin` | 0.02093 | 0.08361 | 0.01045 | Per picker; plugin state/closures (`app/picker-context.mjs:202`) |
| `picker.invites` | 0.00587 | 0.02119 | 0.00255 | Per picker; invite/auth sidecar (`app/picker-context.mjs:189`) |
| `picker.signInFlow` | 0.00409 | 0.01503 | 0.00182 | Per picker; sign-in sidecar/closures (`app/picker-context.mjs:191`) |

These ten groups account for **1.21596 MiB per added account** of the snapshot graph difference. The remainder includes state/serialization graphs with several owners, property tables, code/JIT, registry/admission records and other runtime objects. This is an attribution of the HTTP snapshots only; the calculator's extra RSS was not heap-snapshotted. The foreground cache row is a shared cache growing with workload and LRU occupancy, not an independent cache allocation per picker. Its eight-entry limit is already under pressure because both state roll-pool and full-task requests occupy it.

The shared dataset root retains **2.71561 → 2.71516 MiB**, effectively unchanged. Snapshots contain **2 → 8** `createPickerContext` closure contexts, confirming two versus eight total residents. Immutable definitions, world, dataset and the physical calculator pool are shared in the HTTP process; stores, context response caches and sidecars are paid again per picker.

Snapshot provenance (scratch artifacts, not checked in):

| Accounts | File bytes | SHA-256 |
| --- | ---: | --- |
| 1 | 17,520,654 | `10cf0c7fe3698e5af9cf3ef40d39ae55ad0e88f1ace5e810895405356f3ce088` |
| 7 | 21,122,239 | `6c4cb98dbedfed81f8f1cd259773002ec1687a058bc27ef21631f06d30ceb418` |

## EN7 cache ownership and multiplication

EN7 has not landed at START, and this brief supplies no proposed byte sizes or entry-limit changes. The following maps the current cache growth surfaces; it does not claim a measured EN7 after-state. A key containing a picker ID does not make the enclosing cache per picker. File/line references are pinned to START.

| Cache or retained graph EN7 could enlarge | Source at START | Allocation scope / bound |
| --- | --- | --- |
| Prepared engine variants, compiled tasks, by-key/by-ID indexes, access indexes and prepared membership metadata | `app/tasks/engine.mjs:145`, `:165`, `:199`, `:207`, `:319` | Per calculator engine/variant; variants within an engine share compatible access indexes. Not recreated for each picker. |
| Serialized eligibility-result LRU | `app/tasks/engine.mjs:1492`; `app/tasks/eligibility-cache.mjs:51` | Per compiled engine variant in a calculator, two entries; baseline calls with `reuseEligibility:false` bypass it. |
| Automatic-transport engine/baseline/derived caches; return projections | `app/core/automatic-transport.mjs:11`, `:63`, `:70`, `:88`; `app/core/teleport-return-cache.mjs:3` | Per isolate, keyed by world/engine; two baseline signatures and 16 return entries per world. Normally in calculators. An HTTP inline fallback can also create an engine/cache on the shared HTTP world, once per world, not once per context. |
| Ordinary evaluation snapshots, planning indexes, estimates; sandbox snapshots | `app/tasks/worker.mjs:149`, `:164`, `:203`, `:208`, `:228`, `:262` | Per calculator: two ordinary snapshots, two sandbox snapshots, at most 256 estimates per ordinary snapshot. Picker-scoped inputs compete within these bounds. |
| Parsed state-transfer LRU | `app/tasks/worker.mjs:150`, `:341`; `app/tasks/state-transfer.mjs:5` | Two entries per calculator, shared across picker keys; scheduler/pool snapshot hints are small shared server metadata (`app/tasks/calculator-pool.mjs:24`). |
| Collection/equipment catalogues, presentation/location/index memoization | `app/tasks/worker.mjs:43`, `:68`, `:71`, `:75`, `:98`; `app/tasks/collection.mjs:109`; `app/tasks/presentation.mjs:67`; `app/tasks/chunk-planning-index.mjs:3` | Per calculator/isolate, definitions or result keyed; result-keyed WeakMaps survive only with their retained results. |
| Replay access/base/source/output/obligation caches | `app/tasks/engine.mjs:816`, `:1368`; `app/tasks/obligation-cache.mjs:3` | Per evaluation, temporary. Enlarging them affects transient calculator peak; they are not seven persistent context caches. |
| Foreground, duo and prediction result LRUs | `app/tasks/scheduler.mjs:88`, `:157`, `:167`, `:476`, `:594` | Per server/lane across all picker keys. Defaults: foreground eight entries / 128 MiB; duo four / 32 MiB; prediction response half of a 32 MiB combined budget. Budgets are caps, not preallocated bytes. |
| Prepared unlock-result caches | `app/tasks/scheduler.mjs:124`, `:130`; `app/tasks/unlock-reuse.mjs:42` | Per-picker containers, but aggregate limits enforced across pickers: half of prediction's 32 MiB total, with a shared entry bound. Raising aggregate budget costs once per server. |
| HTTP state/response, sandbox and saved viewer result caches | `app/picker-context.mjs:127`, `:243`, `:244`, `:314`, `:370`; `app/core/rules.mjs:334` | Per resident picker. Response 48 MiB, sandbox 4 MiB, viewer play projections 32 MiB / eight members; full gzip results have separate retention. Roll-pool cache defaults to 16 entries. Increasing populated context budgets multiplies by resident contexts. |
| Store task catalogue, serialized current save, lazy calculation snapshots | `app/picker-context.mjs:159`; `app/storage/store.mjs:323`, `:337`, `:540` | Per resident picker. Enlarged task catalogues/results can increase these even without changing an explicit cache limit. |

## Capacity projection

Let **S** be additional populated server-wide cache bytes, **C** additional retained bytes per physical calculator (sum across all warmed variants), and **P** additional retained bytes per resident context, including copies of larger task results in HTTP/store caches. For one warmed calculator, the steady retained growth is **S + C + R×P**; at the default maximum of two calculators it is **S + 2C + R×P**. R counts all resident contexts, with the conservative assumption that each populates the new per-context cache equally; in the measurements the legacy task view is unqueried. If only account views populate a new cache, use seven P in the experiment and six P at the default cap for that cache. Per-evaluation scratch growth affects concurrently active calculator peaks instead. Native allocator/RSS overhead must be measured after EN7 rather than assumed equal to retained-byte growth.

| Case | Account / total context count | Current HTTP heap / RSS, MiB | Current combined RSS, MiB | Retained EN7 increment, one / two calculators |
| --- | --- | --- | ---: | --- |
| Seven accounts in this experiment | 7 / 8 | 26.67556 / 122.15234 (measured medians) | 243.89063 (measured median) | S + C + 8P / S + 2C + 8P |
| Default cap, including always-resident legacy | 6 / 7 | 25.54507 / 117.08659 (linear projection) | 233.73112 (linear projection) | S + C + 7P / S + 2C + 7P |

The current RSS columns contain one calculator. A fully warm two-calculator baseline was not measured; the two-calculator formula describes EN7 cache increments only and does not include the existing cost of starting that second process.

For example, each additional **1 MiB per calculator** costs **1 MiB** in these sequential runs or **2 MiB** with both default slots warm; it does not cost seven. Each additional **1 MiB per context** costs **8 MiB** for this seven-account experiment or **7 MiB** at the actual default context cap. Each additional **1 MiB of shared result-cache budget**, if filled, costs **1 MiB** irrespective of residency. If S=C=P=1 MiB, these increments are **10 / 11 MiB** for the experiment and **9 / 10 MiB** at the default cap. These coefficients are useful before EN7's concrete increments are known; they are not an EN7 performance forecast.

The current **10.15951 MiB/picker combined RSS slope** includes retained buffers, warm-up/JIT and allocator growth. Linear interpolation to six accounts is only a local estimate: scheduler/state/result LRUs saturate, and the calculator retains two parsed states rather than every picker's state. This small public dataset and empty accounts do not establish full-pack or mature-save capacity. In particular, do not scale these values to the private dataset by task count. After EN7 lands, repeat with its actual cache sizes, both calculator slots warm, and independent realistic inputs before revising production capacity.

## Validation

`npm run test:quick` ran once on Node 24.21.0 with the suite unchanged: **2,745 passed, 0 failed, 67 skipped, 0 cancelled** (2,812 tests across 303 selected files), **195.977 seconds**, exit 0. No application code changed, so the brief's final quick-suite gate applies; the full suite was not run for this documentation-only measurement. No tests were added, weakened or reclassified. All measurement trials were complete before testing began.

Final diff against START contains only this document. Scratch harness/analyzer scripts were removed; numeric results, logs and snapshots remain outside the repository for inspection.
