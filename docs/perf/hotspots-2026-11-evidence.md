# Measurement evidence — November 2026

Detailed evidence for the [hotspot ranking](hotspots-2026-11.md). The [numeric evidence](hotspots-2026-11-evidence.json) retains all median/min/max values, phase shares, input hashes and artifact hashes.

START: `c185bd7c932d96642506b10c3c0935fb689b7d02`. Linux, Node 24.21.0, process
workers. The container has a **4 CPU quota and 16 GiB memory limit**; the target
VPS has 6 vCPU and 11 GiB. These are local component measurements, not a claim
about live network or browser latency. Times below are median [min–max].

The evidence includes five mixed-workload calculator processes, five independent member-1 calculators, five fresh prediction
calculators, five spans-only browser repetitions, and five CPU+trace browser
repetitions. Three separate calculator runs collect CPU samples; their times are
not used for latency estimates. Browser runs use synthetic open-f2p and one
unlocked chunk per player. The real-size runs use a validated filesystem copy,
with no server or store opened. Fresh means a new process, not an evicted OS page cache. The input loader rejects imports of those
modules. Pack/default settings are supplied through the ordinary environment.

The E sequence fixes member order at indices 0, 1. The M set separately measures member 1 in a completely fresh worker. “Cold” means the
first request for that member in a fresh worker; the second member can benefit
from the first member's engine caches. Warm requests reuse the state snapshot,
as production does. The separate preview set starts a new advisory calculator,
resolves one roll pool, and predicts its first eligible candidate. Accept is an
in-memory ordinary unlock command followed by both recalculations on a reuse
cache miss. It excludes durable saving, scheduler reuse races and HTTP.

Two engine trials that overlapped a profiler-test run were excluded before
final analysis and replaced. Initial overlapping synthetic runs and incomplete
harness-development trials are also excluded. All retained sets run one
calculator at a time. The numeric evidence records the retained engine run
indices, replacements, input hashes and artifact hashes.

**Part A: Spans only, five fresh repetitions.** Milliseconds, median [min–max]. Top phases use exclusive wall coverage; percentages divide phase medians by wall median.

| Scenario | Wall ms | Top five observed non-harness phases: median ms (share) |
| --- | --- | --- |
| cold | 2196.1 [1749.7–2321.4] | `server:worker.startup.runtime/relay` 385.0 (17.5%)<br>`server:response.compression-or-cache.encoded` 263.2 (12.0%)<br>`engine:eligibility` 112.1 (5.1%)<br>`server:http.write.flush` 94.4 (4.3%)<br>`browser:response.body` 65.7 (3.0%) |
| reload | 1157.6 [1007.1–1213.9] | `server:response.compression-or-cache.encoded` 222.9 (19.3%)<br>`browser:response.body` 83.7 (7.2%)<br>`server:http.write.flush` 60.4 (5.2%)<br>`browser:response.parse` 2.2 (0.2%) |
| roll | 1783.0 [1600.1–1847.2] | `server:worker.startup.runtime/relay` 337.6 (18.9%)<br>`engine:eligibility` 170.6 (9.6%)<br>`server:store.commandSerialized` 90.6 (5.1%)<br>`engine:worker.startup.dataset.evaluate` 49.6 (2.8%)<br>`browser:response.body` 42.1 (2.4%) |
| complete | 445.2 [421.6–492.8] | `engine:eligibility` 40.7 (9.1%)<br>`server:store.commandSerialized` 35.8 (8.0%)<br>`browser:response.body` 28.6 (6.4%)<br>`server:worker.message.return` 8.3 (1.9%)<br>`engine:presentationMs` 6.8 (1.5%) |
| why | 263.1 [237.3–283.6] | `engine:eligibility` 21.8 (8.3%)<br>`browser:response.body` 17.0 (6.5%)<br>`engine:worker.resultSerialization` 8.4 (3.2%)<br>`engine:activityMs` 7.0 (2.7%)<br>`engine:engineMs` 5.5 (2.1%) |
| how | 245.1 [206.8–268.4] | `engine:howMs` 46.2 (18.9%)<br>`server:worker.message.return` 1.2 (0.5%)<br>`browser:response.body` 0.8 (0.3%)<br>`engine:worker.message.inbound` 0.6 (0.3%)<br>`server:http.write.flush` 0.3 (0.1%) |
| map | 422.3 [419.7–476.9] | None observed; renderer is untraced. |
| settings | 1165.8 [1044.4–1252.3] | `browser:response.body` 39.9 (3.4%)<br>`server:store.commandSerialized` 36.1 (3.1%)<br>`engine:eligibility` 34.9 (3.0%)<br>`engine:worker.message.inbound` 13.1 (1.1%)<br>`engine:presentationMs` 8.2 (0.7%) |

**Part A: CPU + trace, five fresh repetitions.** Milliseconds, median [min–max]. Top phases use exclusive wall coverage; percentages divide phase medians by wall median.

| Scenario | Wall ms | Top five observed non-harness phases: median ms (share) |
| --- | --- | --- |
| cold | 2129.8 [2056.7–2228.9] | `server:worker.startup.runtime/relay` 373.4 (17.5%)<br>`server:response.compression-or-cache.encoded` 254.6 (12.0%)<br>`browser:main.other:ThreadControllerImpl::RunTask` 219.9 (10.3%)<br>`browser:main.other:RunTask` 202.2 (9.5%)<br>`engine:eligibility` 133.2 (6.3%) |
| reload | 1241.4 [1167.4–2131.1] | `server:response.compression-or-cache.encoded` 254.0 (20.5%)<br>`browser:main.other:ThreadControllerImpl::RunTask` 170.1 (13.7%)<br>`browser:main.other:RunTask` 145.6 (11.7%)<br>`browser:main.paint` 99.2 (8.0%)<br>`server:http.write.flush` 83.6 (6.7%) |
| roll | 2044.6 [1977.6–3381.2] | `server:worker.startup.runtime/relay` 414.8 (20.3%)<br>`engine:eligibility` 169.8 (8.3%)<br>`browser:main.other:RunTask` 159.6 (7.8%)<br>`browser:main.paint` 157.6 (7.7%)<br>`server:store.commandSerialized` 93.5 (4.6%) |
| complete | 547.5 [468.4–563.7] | `browser:main.paint` 72.0 (13.2%)<br>`engine:eligibility` 63.8 (11.6%)<br>`browser:main.other:RunTask` 58.4 (10.7%)<br>`server:store.commandSerialized` 32.9 (6.0%)<br>`browser:main.layout` 27.4 (5.0%) |
| why | 287.2 [261.0–639.0] | `browser:main.paint` 30.1 (10.5%)<br>`browser:main.other:ThreadControllerImpl::RunTask` 25.8 (9.0%)<br>`engine:eligibility` 25.1 (8.8%)<br>`browser:main.other:RunTask` 17.1 (6.0%)<br>`browser:main.gc` 13.1 (4.6%) |
| how | 259.6 [213.3–501.5] | `engine:howMs` 44.1 (17.0%)<br>`browser:main.paint` 36.4 (14.0%)<br>`browser:main.other:RunTask` 10.4 (4.0%)<br>`browser:main.other:ThreadControllerImpl::RunTask` 4.8 (1.9%)<br>`browser:main.style` 4.0 (1.5%) |
| map | 449.9 [420.5–489.9] | `browser:main.paint` 135.4 (30.1%)<br>`browser:main.script:/map.mjs` 30.4 (6.7%)<br>`browser:main.other:RunTask` 20.0 (4.4%)<br>`browser:main.other:ThreadControllerImpl::RunTask` 10.4 (2.3%)<br>`browser:main.style` 8.9 (2.0%) |
| settings | 1288.8 [1250.5–1297.3] | `browser:main.paint` 177.5 (13.8%)<br>`browser:main.other:RunTask` 116.4 (9.0%)<br>`browser:main.style` 107.2 (8.3%)<br>`browser:main.layout` 69.5 (5.4%)<br>`server:store.commandSerialized` 46.8 (3.6%) |

| Mode | Scenario | Flush ms | Share | Encoding/cache ms | Share |
| --- | --- | --- | --- | --- | --- |
| spans | cold | 94.4 [84.6–185.5] | 4% | 263.2 [249.0–306.1] | 12% |
| spans | reload | 60.4 [55.9–78.8] | 5% | 222.9 [195.6–246.2] | 19% |
| full | cold | 108.9 [74.6–125.8] | 5% | 254.6 [226.2–314.7] | 12% |
| full | reload | 83.6 [60.3–95.9] | 7% | 254.0 [217.5–365.8] | 20% |

The longest individual flush span was 120.9 ms in spans mode and 7.2 ms in full mode. Longest individual encoding/cache spans were 127.9 and 51.7 ms. Scenario coverage aggregates many responses; it is not one response's flush duration. Encoding/cache is a material 12–20% of these small cold/reload actions, but neither phase shows the Windows multi-second dominance.

| Mode | Windows | CPU profiles | Renderer events | Lifecycle ms |
| --- | --- | --- | --- | --- |
| spans | 40 | 0 | 0 | 10014.3 [8616.3–11245.7] |
| full | 40 | 300 | 875821 | 21310.8 [20958.0–25964.9] |

`http.write.flush` starts immediately before `response.end()` and stops at
Node's `finish` event (`app/profile-spans.mjs:67`). This is the wait to hand the
response to the OS, including socket backpressure and event-loop scheduling;
it is not browser rendering or a pure CPU/write syscall measurement. A slow
Chrome reader can extend it. `response.compression-or-cache.encoded` wraps an
awaited cache/encoding promise; its elapsed time can include libuv queueing,
concurrent work and resumption delays. Neither span is compressor self CPU.
The coverage partition gives overlapping engine work priority, so these rows
are not an independent critical path. This run cannot explain the Windows
machine; it rules out the reported multi-second dominance on this Linux setup.

**Part B: startup.** E = retained mixed-workload trials, M = independent member-index-1 trials, P = fresh advisory calculator trials. Each has five fresh processes. E uses original runs 1, 2, 5 and two replacements; original runs 3 and 4 overlapped tests. CPU evidence uses separate fresh C0, C1 and CP runs.

| Boundary | Foreground E1–5 ms | Advisory P1–5 ms |
| --- | --- | --- |
| spawn → ready | 6483.9 [5585.2–9574.7] | 6125.5 [5060.2–7735.6] |
| worker.startup.spawn | 25.2 [21.8–37.3] | 26.2 [24.8–29.8] |
| worker.startup.module.load | 11.6 [9.5–51.8] | 10.6 [9.3–128.8] |
| worker.startup.module.evaluate | 715.9 [637.7–750.5] | 716.4 [666.5–776.2] |
| worker.startup.dataset.evaluate | 1567.6 [1287.4–3179.1] | 1438.8 [1348.7–1603.2] |
| worker.startup.calculator.initialize | 2822.9 [2623.0–3256.8] | 3083.2 [2648.2–5133.0] |
| worker.startup.runtime/relay | 1145.0 [1002.4–2328.3] | 340.8 [328.7–564.1] |

Module/evaluation boundaries are those of the existing profiler. Startup parts partition each trial; medians of parts need not sum to the median total. Remaining preload observation is under 0.01 ms. Factory timing starts after definition-byte preparation. Runtime/relay is unresolved bootstrap, parsing/linking, ready-payload transfer and scheduling.

| Request | Parent wall ms | Worker job ms |
| --- | --- | --- |
| Member 0 cold, fresh worker | 7557.5 [6475.8–9720.6] | 7503.5 [6426.9–9670.1] |
| Member 0 warm | 140.8 [128.1–182.5] | 133.9 [121.8–168.0] |
| Member 1 cold, independent fresh worker | 4860.3 [4712.0–6969.7] | 4801.8 [4661.5–6918.9] |
| Member 1 warm, independent set | 276.7 [146.2–459.9] | 265.5 [138.4–450.3] |
| Member 1 first request after member 0 (context only) | 2758.0 [2632.2–3548.6] | 2751.5 [2616.2–3541.9] |
| Roll pool 0, fresh advisory worker | 5538.5 [4809.8–7647.3] | 4401.9 [3805.2–5544.6] |
| Roll pool 0, after task calculations | 681.9 [636.4–793.3] | 680.0 [634.9–790.9] |
| Roll pool 0 warm | 1.8 [1.2–4.6] | 0.5 [0.5–0.9] |
| Roll pool 1, after task calculations | 1977.2 [1671.7–2234.0] | 1972.9 [1670.5–2190.3] |
| Roll pool 1 warm | 2.3 [1.5–5.1] | 0.7 [0.5–2.1] |
| Preview, fresh advisory baseline | 12740.2 [11077.6–13270.0] | 12722.1 [11043.6–13248.9] |
| Preview repeat in that worker | 1821.2 [1663.9–2779.3] | 1803.6 [1617.6–2761.5] |
| Preview, existing task baseline | 8712.0 [7666.9–12801.3] | 8696.7 [7654.3–12787.3] |
| Preview repeat, existing baseline | 1700.3 [1488.9–2625.3] | 1685.7 [1460.3–2612.6] |
| Accept recalculation, member 0 | 2542.2 [2422.4–3894.9] | 1446.8 [1093.7–2555.0] |
| Accept recalculation, member 1 | 1211.7 [964.8–1380.8] | 1202.7 [957.2–1373.2] |
| Full-result supplement for Why | 838.5 [813.2–969.4] | 758.3 [732.7–869.9] |

Accept's two worker jobs total 2466.9 [2130.5–3838.1] ms; their parent requests total 3687.0 [3498.4–5186.3] ms. The separate public in-memory command costs 1048.2 [941.6–1106.1] ms and includes validation/cloning that an already validated normal store can avoid. The first accept request uses object transfer; production can use shared JSON. These parent request and command times are not production accept estimates. Durable I/O and prediction-reuse hits are unmeasured. Cold pool P also includes an initial object-state transfer; its internal pool stage is 4401.7 [3805.0–5543.6] ms.

Readiness plus first member-0 request sums to 14.24 [12.06–19.30] s. Advisory readiness plus prediction sums to 18.87 [16.14–21.01] s, excluding the preceding pool request. These are serial component sums, not browser measurements.

| Visible-row index | Why first ms | Why repeat ms | How first ms | How repeat ms |
| --- | --- | --- | --- | --- |
| 0 | 468.1 [446.8–563.0] | 17.6 [16.8–37.8] | 2932.3 [2692.5–3332.2] | 2.1 [0.6–3.0] |
| 354 | 498.5 [427.0–674.9] | 18.2 [12.6–49.5] | 3571.2 [2487.7–3886.8] | 0.9 [0.6–4.6] |
| 707 | 490.0 [432.3–726.4] | 13.9 [8.1–53.4] | 3088.8 [2403.3–5365.9] | 1.1 [0.7–7.7] |

The helper receives a freshly compressed copy of the full result for each subject; no private proof text or identifiers are retained. Selection is by index among unhidden obligation rows, without claiming a real-browser filter audit. How partial proofs remain valid responses.

| Process / boundary | RSS high-water MiB, median [min–max] |
| --- | --- |
| Foreground worker at readiness | 793.0 [783.5–803.9] |
| Foreground worker through all E jobs | 1623.2 [1575.1–1804.4] |
| Measurement parent through all E jobs | 1151.4 [1134.2–1164.5] |
| Independent member-1 worker | 931.4 [922.7–941.3] |
| Advisory worker through preview repeats | 1447.7 [1420.0–1479.8] |

RSS uses Linux VmHWM, including relay and calculator threads in the worker process. Parent and worker maxima need not be simultaneous. The measurement parent hydrates extra evidence and projections, so its peak is not a live-server capacity forecast.

Input counts: 2 members, 23939 saved task rows, 2594 world chunks, 708 unhidden obligation candidates. Dataset hash `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`; saved-document hash `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`; calculation-state hash `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1`.

**Part B: response projections.** Bytes and gzip level-1 time, five trials each. Variable byte counts retain their spread. Full tasks are a detail response, rather than the compact startup sidebar.

| Projection | Raw bytes | Gzip bytes | Sync gzip ms | Async gzip ms |
| --- | --- | --- | --- | --- |
| state-projection | 894526 | 102352 | 5.5 [3.6–6.2] | 7.4 [6.1–11.6] |
| definitions-display | 598870 | 190196 | 9.7 [7.4–82.0] | 10.0 [9.3–44.0] |
| rules | 5659 | 1845 | 0.2 [0.2–3.0] | 0.5 [0.3–3.5] |
| display-world | 1167035 | 302797 | 12.2 [10.2–19.4] | 24.9 [15.9–72.0] |
| tasks-0 | 121384 [121383–121391] | 17108 [17107–17111] | 2.5 [1.0–3.2] | 6.1 [4.0–11.8] |
| tasks-1 | 183916 [183908–183916] | 28697 [28694–28698] | 1.4 [1.2–5.6] | 2.2 [1.5–7.4] |
| dataset-runtime | 3205094 | 625592 | 42.2 [24.2–166.1] | 82.2 [40.6–259.0] |
| tasks-full | 26378717 [26378716–26378724] | 2056243 [2056242–2056248] | 100.0 [92.0–113.4] | 100.5 [98.0–109.5] |
| prediction | 17306 | 3279 [3279–3280] | 0.7 [0.3–1.7] | 1.8 [1.0–2.2] |
| reuse-owner-playJSON | 3123987 | 321413 [321411–321414] | 13.4 [11.9–33.7] | 17.3 [14.8–47.4] |
| reuse-partner-playJSON | 3413381 [3413380–3413381] | 365854 [365853–365854] | 20.0 [12.2–22.3] | 17.6 [15.4–19.2] |

Exact unlock-cache calls take 54.4 [47.0–83.3] ms for an owner admission followed by final owner+partner admission (nine synchronous gzip-prefix calls). The final pair alone takes 35.2 [32.1–58.5] ms. The nine-call case models racing acceptance, not every ordinary Preview. It blocks the caller for that duration; native asynchronous compression could remove the main-thread pause without promising an equal reduction in preview completion time. Main-thread responsiveness deserves follow-up under concurrent users, below the multi-second engine waits in this latency ranking.

Encoding calls use the real projections directly and gzip level 1. Sync versus
async times are elapsed durations, measured in that order once per fresh trial;
async is not a promise of faster compression. Sync blocks the caller. Projected
state omits store-only response metadata; task projections omit the route's
small revision/cache suffix. Exact full HTTP envelope sizes, Brotli timing and
cache-hit encoding costs at real size are unmeasured. Projection construction
is outside the encoding timer; JSON serialization is listed separately in the
numeric evidence. Why measures the real saved-evidence helper, including first
inflate/parse, and selects three unhidden obligation rows by index. How uses
ordinary calculator requests; repeats exercise its proof cache.

**Part B: CPU self-time.** One separate inspector capture for each cold task calculation, plus the fresh pool and prediction. Samples are clipped to worker receipt/reply clocks. Inspector start/stop overhead is excluded; no inspector frame appears in the top 15. Instrumentation and GC still perturb work inside the job. These self-time samples are diagnostic; do not divide them by unprofiled latency medians. Public app source positions compensate for the loader prefix. Native/V8 frames have no JavaScript source location and use line 0.

**tasks-0-cold.**

| Function and file:line | Sampled self ms |
| --- | --- |
| `(garbage collector) (V8):0` | 3407.2 |
| `createCompiledTaskEngine app/tasks/engine.mjs:204` | 2817.9 |
| `evaluate app/tasks/obligation-cache.mjs:17` | 1455.3 |
| `decodeUTF8 (V8):0` | 1022.0 |
| `serializedState app/tasks/worker.mjs:342` | 916.7 |
| `permanentTaskId app/tasks/identity.mjs:77` | 674.3 |
| `check app/tasks/engine.mjs:948` | 669.0 |
| `evaluatePass app/tasks/engine.mjs:421` | 453.7 |
| `(anonymous) app/tasks/engine.mjs:1376` | 452.3 |
| `mask app/tasks/obligation-cache.mjs:6` | 397.2 |
| `serialize node:v8:453` | 364.5 |
| `(anonymous) app/tasks/engine.mjs:851` | 355.3 |
| `ownItemOrigin app/tasks/engine.mjs:844` | 234.4 |
| `normalize app/tasks/engine.mjs:121` | 218.3 |
| `projectMemberTaskFacts app/tasks/fact-projection.mjs:31` | 202.8 |

**tasks-1-cold.**

| Function and file:line | Sampled self ms |
| --- | --- |
| `check app/tasks/engine.mjs:948` | 1275.0 |
| `serialize node:v8:453` | 1110.2 |
| `evaluatePass app/tasks/engine.mjs:421` | 936.3 |
| `(garbage collector) (V8):0` | 880.9 |
| `createCompiledTaskEngine app/tasks/engine.mjs:204` | 783.9 |
| `(anonymous) app/tasks/engine.mjs:1376` | 592.5 |
| `serializedState app/tasks/worker.mjs:342` | 459.5 |
| `projectMemberTaskFacts app/tasks/fact-projection.mjs:31` | 452.5 |
| `unknownDropContext app/tasks/unknown-drop-warnings.mjs:43` | 329.6 |
| `prepareEvaluation app/tasks/engine.mjs:357` | 230.6 |
| `computeEligibility app/tasks/engine.mjs:1488` | 203.4 |
| `selectPresentedTasks app/tasks/presentation.mjs:91` | 194.0 |
| `normalize app/tasks/engine.mjs:121` | 190.1 |
| `taskItemMembershipBlockers app/tasks/membership.mjs:40` | 189.9 |
| `requirementAvailable app/tasks/engine.mjs:905` | 161.6 |

**pool-cold.**

| Function and file:line | Sampled self ms |
| --- | --- |
| `evaluate app/tasks/obligation-cache.mjs:17` | 1418.6 |
| `check app/tasks/engine.mjs:948` | 841.4 |
| `(garbage collector) (V8):0` | 805.0 |
| `createCompiledTaskEngine app/tasks/engine.mjs:204` | 595.3 |
| `(anonymous) app/tasks/engine.mjs:1376` | 575.5 |
| `baseOf app/core/transport-access.mjs:10` | 535.1 |
| `evaluatePass app/tasks/engine.mjs:421` | 531.1 |
| `(anonymous) app/tasks/engine.mjs:851` | 449.0 |
| `mask app/tasks/obligation-cache.mjs:6` | 402.0 |
| `digest app/tasks/unlock-reuse.mjs:3` | 338.6 |
| `ownItemOrigin app/tasks/engine.mjs:844` | 327.7 |
| `unknownDropContext app/tasks/unknown-drop-warnings.mjs:43` | 269.1 |
| `personalFacts app/core/transport-access.mjs:101` | 260.3 |
| `prepareEvaluation app/tasks/engine.mjs:357` | 208.8 |
| `transportReachabilityPaths app/core/transport-access.mjs:357` | 199.3 |

**preview-cold.**

| Function and file:line | Sampled self ms |
| --- | --- |
| `evaluate app/tasks/obligation-cache.mjs:17` | 1646.5 |
| `(garbage collector) (V8):0` | 1497.2 |
| `check app/tasks/engine.mjs:948` | 1271.6 |
| `evaluatePass app/tasks/engine.mjs:421` | 757.5 |
| `(anonymous) app/tasks/engine.mjs:1376` | 632.7 |
| `serialize node:v8:453` | 583.6 |
| `mask app/tasks/obligation-cache.mjs:6` | 484.1 |
| `(anonymous) app/tasks/engine.mjs:851` | 475.3 |
| `personalFacts app/core/transport-access.mjs:101` | 434.0 |
| `ownItemOrigin app/tasks/engine.mjs:844` | 374.2 |
| `obligation app/tasks/engine.mjs:870` | 313.5 |
| `unknownDropContext app/tasks/unknown-drop-warnings.mjs:43` | 263.6 |
| `baseOf app/core/transport-access.mjs:10` | 244.1 |
| `jsonClone app/core/state.mjs:625` | 220.3 |
| `transportReachabilityPaths app/core/transport-access.mjs:357` | 218.6 |

No real-size browser run (Part C): adapting the scaled companion's renamed
topology into a valid multi-action browser fixture needs additional fixture and
scenario work. That is beyond the cheap optional extension. Real browser
parse/render, external art, WAN transfer, concurrent-picker contention, queue
fairness, residency policy, exact preview cache hit rates, durable accept I/O,
startup migration, and production scheduler prediction reuse remain unmeasured.
The ordinary server/store path was deliberately excluded from private checks.
These gaps prevent an end-to-end VPS latency promise. Proposed savings are
engineering budgets, not measured improvements, and overlapping rows must not
be added.

Reproduce with Node 24.20+ and externally configured dataset settings:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
# Use a gameplay copy under /tmp. Set RS3_DATASET, RS3_PACKS_DIR,
# RS3_GAME_DEFAULTS_FILE and RS3_TASK_WORKER_MODE=process before these calls.
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --runs 5 --out /tmp/engine
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --fresh-preview --runs 5 --out /tmp/preview
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --fresh-member 1 --runs 5 --out /tmp/member1
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --fresh-member 0 --profile --runs 1 --out /tmp/cpu
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --fresh-member 1 --profile --runs 1 --out /tmp/member1-cpu
node scripts/perf/hotspots-engine.mjs --data-dir /tmp/copied-game --fresh-preview --profile --runs 1 --out /tmp/preview-cpu
node scripts/perf/profile-stack.mjs --scenario all --runs 5 --out /tmp/spans
node scripts/perf/profile-stack.mjs --scenario all --runs 5 --cpu --trace --out /tmp/full
node scripts/perf/hotspots-summary.mjs --engine /tmp/engine --member1 /tmp/member1 --member1-cpu /tmp/member1-cpu --preview /tmp/preview --preview-cpu /tmp/preview-cpu --cpu /tmp/cpu --spans /tmp/spans --full /tmp/full > /tmp/evidence.json
```

Profiler tests: `node --test tests/profile-spans.test.mjs tests/perf-stack-server.test.mjs`, 13 passed, 0 failed, in the final run (earlier runs also passed). No test files were added or changed. No quick/full suite: application code is unchanged. All final timing/profile processes completed, with 85 unprofiled sync/async encoding comparisons and 0 byte differences. Three CPU processes add three more successful comparisons. A small streamed-JSON round trip passed.

Writer limit check: whole-report stringify raised `RangeError`; streamed output successfully wrote 545261090 bytes in 2407.9 ms and matched SHA-256 `04c57bc8f6af6ef3b2d6e4669a903a864960c62f5120a66ab7de1717d9e22c7f`. One check, 0 failures; large scratch file deleted. This is a correctness check, not a latency benchmark. Full five-repetition capture is 269262081 bytes and contains 40 completed windows and 300 CPU profiles.

Private filesystem audit: 431 source files, 431 copied files, 82007295 bytes, 0 differences, 0 credential artifacts, 0 lab working-tree changes. No private server/store was opened.

| Artifact set | Bytes | SHA-256 |
| --- | --- | --- |
| engine | 76961 | `a7c6625057700bc1cb5ac56565ba293ce60b49313c2857066ae91eb0ceba095f` |
| member1 | 13592 | `075da02f9e6bd92b59ff8e7f4e6eba5a1c1e780ba93bf5b796c4ed1a9a58019b` |
| member1Cpu | 4864 | `25c6680b6cf0f2aecbb0db0b010fef795ef7516152cc715b0eff7e51109c3360` |
| previewCpu | 7590 | `115f44c1868cd1d58193f78682a0bb1cb9ded89fa9d0365e17ec6178da13496d` |
| preview | 16683 | `7a3a207476ff8ff8aa1baf9005c765f16a4dcab8ea773c3d9d66eec8d5e4dfc3` |
| cpu | 4774 | `2b557b4a41dc3eeb187593e7e5a733ecc8599cf6120709a2ab19cd6b381fa4ee` |
| spans | 7009189 | `c5fa6bcbcd574938183582ae2fb65c4ae0ff968c11f62fcbbae78a66f1e45dfb` |
| full | 269262081 | `c3f4471cc80dd711c807880199576468125b0b5ed4ca0d460b877f86070cb3e0` |
