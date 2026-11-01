# Picker stack profiler

Requires Node 24.20+ and Chrome/Chromium. No npm dependencies or Rust.

```sh
# Default: spans only, five fresh server/Chrome repetitions.
node scripts/perf/profile-stack.mjs --scenario all --runs 5 --out /tmp/picker-spans

# Opt-in captures; either flag also works independently.
node scripts/perf/profile-stack.mjs --scenario all --runs 5 --cpu --trace --out /tmp/picker-full
```

Open `report.html` in a modern browser with DecompressionStream support; it is
self-contained. Its embedded data is gzip compressed and scenario waterfalls
are constructed on expansion to keep full traces usable. `profile.json` contains spans,
clock handshakes, gap intervals, revision checks and startup observations.
CPU profiles exist only with `--cpu`; renderer trace events exist only with
`--trace`. Default spans-only installs no inspector session or GC/event-loop
observers. Use `--chrome PATH` or `CHROME_PATH` if `/usr/bin/chromium` is absent.
`--profile off` is the common-driver comparison arm, not a production browser
setting. Ordinary pages receive no probe and never send the profile header.

The runner owns an ephemeral loopback server, Chrome profile and synthetic
`open-f2p` save in `/tmp`. It clears inherited pack/default/storage/ingress
settings. It accepts no existing save or external server URL. Authentication
uses synthetic credentials in scratch/IPC, never report output. Processes stop
before scratch removal. Keep generated artifacts outside tracked source.
Private-state profiling is unsupported and explicitly rejected; no private
save is opened. Process mode is the default; `RS3_TASK_WORKER_MODE=thread`
selects thread mode. Both calculator isolates and process relay main isolates
support opt-in CPU capture.

## Scenarios and boundaries

| Scenario | Actions and cache state |
| --- | --- |
| cold | First authenticated app navigation; browser HTTP cache cleared. Server startup precedes this window. |
| reload | Reload with HTTP/server caches retained. |
| roll | Roll two choices, view one, open Preview, await prediction, accept, refresh tasks. |
| complete | Check a task, confirm its player in the duo chooser when needed, refresh tasks. |
| why | Open a visible task's Why explanation, including its full-result fetch. |
| how | Open its How proof. Partial proofs are valid responses, with their actual engine work recorded. |
| map | Center the visible map, zoom in/out and drag; synthetic geometry without external art. |
| settings | Open Settings, then Chunk Rules, toggle shared access and await recalculation. |

A selected single action includes an unmeasured cold preparation. Every run
starts a fresh server and Chrome. Later actions in that run retain caches.
Revision checks require two gameplay edits for roll/accept and one for task
completion and the rule change. They run outside the measured wall window.

Each scenario is a wall window with a root profile ID; each DOM click has a
child ID. The browser fetch header `x-rs3-profile` propagates through server
async context, scheduler entries and calculator messages. Expand input trees
for per-click spans. Multi-click scenarios keep the complete sequence visible.
Renderer and harness intervals are split at observed input timestamps. Input
windows run to the next input (or scenario end), forming a nonoverlapping
partition. Their coverage includes concurrent work caused by earlier inputs;
causal ownership is retained separately in the tree and raw references. An
asynchronous span ending later does not stretch an earlier input window.
This temporal attribution does not prove asynchronous render causality.

## Harness time and real gaps

Every awaited CDP send/evaluation in the measured action has a `harness`
span, as do polling sleeps and deliberate animation-frame waits:

| Harness phase | What it measures |
| --- | --- |
| `poll.sleep` | Actual awaited polling timers, including delayed wake-up. |
| `settlement.frames` | Two requested animation frames at settlement. |
| `driver.frames` | Requested frames before dispatching an input. |
| `driver.evaluate`, `driver.Page.*`, `driver.Input.*`, etc. | Actual driver RPC round trip, including response delivery and any browser work it awaits. |

There is **no whole-scenario fallback span**. A wait span is only the start/end
of a real await; it is not filled to a target percentage. App work takes
precedence over overlapping harness waits. Thus the displayed harness share
is its exclusive remainder, not gross elapsed await time. In spans-only mode,
untraced browser work inside a driver wait cannot be separated from that wait;
a high harness share is not proof the browser was idle.

With `--trace`, `CrRendererMain` top-level tasks are reconstructed from complete
and paired B/E events. Observed tasks are partitioned by nested categories:
script (top-level function or normalized URL), style, layout, paint, GC,
observed idle callbacks, and other top-level tasks. Other-task rows retain the
actual task name/category. Blank intervals are **never inferred idle**.
Only renderer main threads are used; GPU/compositor completion is outside this
measurement. Every raw trace remains available for inspection.

The coverage table partitions wall time once: engine, relay, server, browser,
then harness. Observed browser idle yields to harness waits. Shorter spans win
within a layer, with explicit frame/sleep waits preferred over generic driver
RPC envelopes. This is an overlap convention, not an inferred critical path.
Request/routing/fetch/round-trip envelopes are visible but excluded from work
coverage. `accounted + unaccounted = wall`; gaps retain their actual timestamps
and reconciliation error is reported. Medians of separate rows need not sum
to median wall. Percent shares use ratios of medians.

## Worker queue breakdown

Queue residence is split using spawn/ready and job dispatch/completion clocks:

| Phase | Evidence |
| --- | --- |
| `worker.startup.spawn` | Synchronous worker factory/fork interval that overlaps this request's wait. |
| `worker.startup.module.load` | Loader callback elapsed time; source loading, not presumed V8 compile time. Public module pathname retained. |
| `worker.startup.module.evaluate` | Module body evaluation, including its top-level awaits. |
| `worker.startup.dataset.evaluate` | Dataset-runtime body evaluation, including dataset loading/validation within it. |
| `worker.startup.calculator.initialize` | Worker body initialization through its ready callback. |
| `worker.startup.runtime/relay` | Remaining observed spawn-to-ready wait: Node bootstrap, V8 parse/link, relay initialization and scheduling not individually separable. |
| `worker.queue.behind` | Actual overlapping preceding jobs; `blockingJob` records job ID, type and originating profile ID. Shown in the input tree. |
| `worker.queue.scheduler` | Queued while no measured startup/job overlap explains residence. |
| `worker.dispatch.prepare` | Dispatch bookkeeping before sending. |
| `worker.message.send` | Synchronous serialization/enqueue at the sender. |
| `worker.message.inbound` | Sender-to-calculator receipt: clone/relay/transport and receiver dispatch scheduling. |
| `worker.message.return` | Calculator send-to-parent receipt with the same delivery/scheduling caveat. |

A runner-only preload uses Node's module hooks to time source loading and
inject numeric evaluation boundaries in memory. It does not change source
files, collect state, or examine input contents. Dataset and initialization
spans take precedence over broader module-evaluation spans when nested.
Process/worker IDs join startup records to the request that waited for them.
Only the overlapping part of startup is charged to that click. Startup before
a click is retained as raw observations, not charged to its wall window.
These are elapsed boundaries, not invented CPU slices. Runtime/relay time is
explicitly unresolved below that boundary; consult CPU profiles for sampled
functions. Shared-pool virtual endpoints never receive diagnostic jobs;
pooled-calculator inspector control remains unsupported.

## Default-off hook audit

Each of these seven app modules reads `RS3_PROFILE` exactly once into module
constant `PROFILE_ENABLED`, then conditionally imports `profile-spans.mjs`:
`server`, `picker-router`, `picker-context`, `picker-admission`, `tasks/scheduler`,
`tasks/worker`, `tasks/engine`. No hook reads the environment per request/job.
Each conditional hook costs at most one constant flag branch when off;
startup-selected aliases have no per-call flag branch. No diagnostic clocks,
objects, observers, file writes, inspector or module preload are installed off.
This is a code audit, separate from the paired measurements below.

All app hook sites are listed here; line numbers are from this patch:

| File:line | Hook and off path |
| --- | --- |
| `server.mjs:489` | Select profiled HTTP handler once; off aliases the original handler. Existing y06 literal seams remain intact. |
| `picker-router.mjs:132` | Bind/open context; one cold-acquisition flag branch. |
| `picker-admission.mjs:45` | Queue-start observation; one flag branch. |
| `picker-admission.mjs:64` | Capture admitted context/timestamp; one flag branch, no empty-object spread off. |
| `picker-context.mjs:76` | Select representation encoding/cache wrapper once. |
| `picker-context.mjs:170` | Decorate store command/snapshot methods at context creation only. |
| `picker-context.mjs:259` | Decorate pool-ranking methods at context creation only. |
| `tasks/engine.mjs:1615` | Select eligibility callback once per compiled engine; off directly aliases original computation. |
| `tasks/worker.mjs:33` | Initialization start clock; one startup flag branch. |
| `tasks/worker.mjs:82` | Select timed-stage wrapper once; off aliases original timer function. |
| `tasks/worker.mjs:284` | Select shared-JSON wrapper once; off aliases original serializer. |
| `tasks/worker.mjs:444` | Reply send timestamp and serialization boundary; one flag branch. |
| `tasks/worker.mjs:451` | Select profiled/native message listener once. |
| `tasks/worker.mjs:464` | Initialization end/ready observation; one startup flag branch. |
| `tasks/scheduler.mjs:490` | Allocate diagnostic lane only when enabled. |
| `tasks/scheduler.mjs:740` | Dispatch/job/queue observation; one flag branch. |
| `tasks/scheduler.mjs:781` | Prepare outgoing context and measure send; one flag branch, original postMessage off. |
| `tasks/scheduler.mjs:799` | Factory start observation; one launch flag branch. |
| `tasks/scheduler.mjs:803` | Constructed-worker observation; one launch flag branch. |
| `tasks/scheduler.mjs:809` | Ignore diagnostic replies; one flag branch before checking reply fields. |
| `tasks/scheduler.mjs:811` | Ready observation, clock/control attachment; one flag branch. |
| `tasks/scheduler.mjs:841` | Completion/return-delivery observation; one flag branch. |
| `tasks/scheduler.mjs:1019,1124,1159` | Foreground, warm evaluation and warm prediction enqueue; one flag branch per site. |

`profile-spans.mjs` is absent from the off import graph. Within that enabled-only
module, CPU selection is also a startup constant. `--cpu` permits inspector,
GC observers and event-loop delay; spans-only imports no inspector and creates
none of those observers. Runner-only hooks are the injected browser fetch/parse/
input/long-task probe, FileHandle write/sync observation, loader/evaluation
preload, relay CPU control, harness await recorder, and optional CDP tracing.
Their existence is controlled by the runner, never ordinary web startup.

## Statistics and comparisons

```sh
git worktree add --detach /tmp/picker-start START_SHA
# Defaults to 20 pairs; the optional final positional count must be >=20.
node scripts/perf/profile-stack/compare-routes.mjs /tmp/picker-start /tmp/route-comparison 20

# Five blocks: off → spans → full, then reversed; each repetition is fresh.
node scripts/perf/profile-stack/compare-browser.mjs /tmp/browser-comparison
```

The route benchmark measures startup and first tasks, warms 30 state/task
pairs, then measures 100 of each warm route in each fresh process. Both arms
use identical synthetic state, gzip, Node and observer code. AB/BA alternates
for 20 independent pairs. The 95% percentile bootstrap resamples the **20
paired differences of process-level medians**, with 20,000 draws and seed 1729.
It does not treat 2,000 requests as 2,000 independent processes. Raw timings,
paired differences, intervals and method are retained in `routes.json`.
A confidence interval containing zero means no detected difference at this
precision, not mathematical proof of zero cost. Its upper bound states the
remaining uncertainty. No automatic equivalence threshold is substituted.

Browser comparison records off/spans/full wall medians/min/max and paired
full-minus-spans differences. The common driver, readiness probe and memory
sampling remain in all arms. Total repetition time also includes startup,
CPU/trace controls, trace export, attribution and cleanup outside input wall
windows. Artifact JSON/HTML encoding and file writes follow that timer and
are excluded from `totalRunMs`.
Run comparisons after tests, without competing benchmarks.

Node clocks share the local OS monotonic timebase. Server/worker round-trip
handshakes report midpoint offsets and RTT/2 bounds; noisy estimates are not
subtracted from their common-clock timestamps. Chrome and each page clock
have separate midpoint calibrations. Drift/remote machines are not claimed.
CPU self-time uses inspector sample deltas and is filtered to the action
window; GC/delay summaries cover the full inspector interval. Sampling targets
1 ms. Linux server-tree RSS is sampled every 50 ms during action windows using
numeric `ps` metadata; it excludes Chrome/runner, counts shared pages per
process and can miss peaks, especially during control/export operations.

Shared HTTP serialization, stream/native compression, rename/directory sync,
compositor/GPU presentation and exact async render causality remain blind spots.
Loader prefixes can shift raw V8 source positions by one line; function names
and module paths are preserved.
Spans-only intentionally cannot partition untraced renderer work out of a
harness RPC. Virtual calculator-pool controls and private-engine mode remain
unsupported. Missing phases are unexercised/unobserved, never assumed free.


## Round 2 measured evidence — 2026-11-01

START `56a8a617ceb447578d6ba569d2be2da0715fe16e`; Node `v24.21.0`; Linux, synthetic
open-f2p, process workers. Targeted tests: 45 passed, zero failed, including
all 12 added tests. Quick: 3,285 passed, zero failed, 68 skipped (3,353 total).
All 12 added tests passed again after report presentation and input-window corrections.
No full npm test run; no private save opened. Measurements started after tests.

### Flag unset versus START: 20 paired AB/BA runs

Milliseconds, median [min–max]; differences are branch minus START.

| Phase | START | Branch off | Median paired difference | 95% paired bootstrap interval |
| --- | ---: | ---: | ---: | ---: |
| startup | 584.393 [551.494–622.570] | 592.094 [551.749–628.855] | 3.013 | [-8.794, 16.167] |
| cold-tasks | 64.409 [57.365–96.547] | 63.669 [57.165–104.929] | -1.129 | [-6.404, 3.448] |
| warm-state | 0.640 [0.595–0.925] | 0.640 [0.568–0.801] | 0.009 | [-0.015, 0.028] |
| warm-tasks | 1.899 [1.786–2.548] | 1.895 [1.730–2.155] | -0.037 | [-0.055, 0.024] |

All four intervals contain zero: no detected default-off regression in these
20 pairs. This is not proof of exact zero cost. The remaining 95% upper bounds
are startup +16.167 ms, cold-tasks +3.448 ms, warm-state +0.028 ms, warm-tasks +0.024 ms.
The earlier five-run point estimate is superseded by this paired experiment.

### Synthetic scenario summary: full mode, five runs

Milliseconds, median [min–max]. Top phases exclude harness rows; harness has
its own exclusive-share column. Shares are ratios of medians.

| Scenario | Wall ms | Largest three application phases (share) | Real gap share | Harness share |
| --- | ---: | --- | ---: | ---: |
| cold | 1414.9 [1315.5–1705.1] | server:worker.startup.runtime/relay 17.6%; server:response.compression-or-cache.encoded 11.6%; browser:main.other:ThreadControllerImpl::RunTask 9.8% | 0.033% | 19.8% |
| reload | 886.2 [853.3–1042.3] | server:response.compression-or-cache.encoded 18.1%; browser:main.other:ThreadControllerImpl::RunTask 15.3%; browser:main.other:RunTask 12.0% | 0.015% | 28.0% |
| roll | 1558.1 [1471.1–1616.7] | server:worker.startup.runtime/relay 17.3%; engine:eligibility 8.3%; browser:main.other:RunTask 7.2% | 0.062% | 32.5% |
| complete | 366.1 [330.8–396.5] | browser:main.other:RunTask 12.6%; browser:main.paint 11.8%; engine:eligibility 8.2% | 0.047% | 38.2% |
| why | 243.8 [237.4–248.6] | browser:main.paint 8.1%; engine:eligibility 6.4%; browser:main.other:RunTask 4.2% | 0.063% | 59.0% |
| how | 217.3 [210.2–224.5] | engine:howMs 16.8%; browser:main.paint 11.3%; browser:main.other:RunTask 3.9% | 0.166% | 60.6% |
| map | 399.2 [393.9–414.4] | browser:main.paint 15.2%; browser:main.script:/map.mjs 5.5%; browser:main.other:RunTask 3.5% | 0.093% | 65.6% |
| settings | 1039.1 [1012.9–1096.1] | browser:main.paint 9.8%; browser:main.style 7.8%; browser:main.other:RunTask 7.6% | 0.046% | 53.4% |

Worst individual scenario gap: full 0.189%; spans-only
0.244%. Every scenario meets the 15% target. Maximum
absolute reconciliation residual is 0 ms (floating-point scale).
The residual gaps are between measured awaits and observed tasks: driver JS
bookkeeping plus calibration/interval-boundary uncertainty. No missing interval
was turned into idle. In spans-only mode, untraced browser work can remain
inside known harness awaits; only full mode separates observed renderer tasks.

### Mode overhead

| Scenario | Off wall ms | Spans-only wall ms | CPU + trace wall ms | Full vs spans median change |
| --- | ---: | ---: | ---: | ---: |
| cold | 1223.4 [1161.9–1249.0] | 1382.6 [1257.6–1416.4] | 1414.9 [1315.5–1705.1] | 2.3% |
| reload | 708.5 [653.6–735.0] | 764.2 [742.7–798.5] | 886.2 [853.3–1042.3] | 16.0% |
| roll | 1280.3 [1263.1–1319.0] | 1363.1 [1307.2–1446.5] | 1558.1 [1471.1–1616.7] | 14.3% |
| complete | 380.5 [332.0–402.9] | 381.4 [308.5–476.4] | 366.1 [330.8–396.5] | -4.0% |
| why | 244.5 [228.5–265.5] | 244.9 [231.5–326.5] | 243.8 [237.4–248.6] | -0.4% |
| how | 228.8 [203.0–267.4] | 227.1 [210.8–264.8] | 217.3 [210.2–224.5] | -4.3% |
| map | 415.3 [396.4–427.0] | 413.0 [407.4–447.9] | 399.2 [393.9–414.4] | -3.4% |
| settings | 933.0 [852.2–952.0] | 891.6 [847.9–990.1] | 1039.1 [1012.9–1096.1] | 16.5% |

Negative point estimates are frame/scheduling noise, not acceleration.
Repetition lifecycle (excluding final artifact JSON/HTML encoding/writing):

| Mode | Duration ms | Sampled per-run server-tree peak MiB |
| --- | ---: | ---: |
| off | 6653.5 [6559.8–6837.7] | 489.2 [478.4–495.3] |
| spans | 7098.1 [6912.6–7979.6] | 471.4 [458.9–485.5] |
| full | 15200.3 [14731.4–15975.3] | 500.5 [487.9–514.9] |

Spans-only lifecycle overhead versus off: 6.7%. Full versus spans-only:
114.1%. These include trace export and CPU attribution; they are not
just website input latency. Linux RSS sampling excludes Chrome/runner and
post-window allocation peaks, and counts shared pages per process.

### Queue/startup/delivery decomposition

Partitioned wall contributions, median [min–max] ms. Raw job spans and complete
spawn-to-ready records also remain available; concurrent rows must not simply
be added as independent CPU costs.

| Phase | Cold | Roll/accept |
| --- | ---: | ---: |
| worker.startup.spawn | 0.00 [0.00–0.00] | 0.00 [0.00–0.00] |
| worker.startup.module.load | 7.68 [7.05–9.99] | 9.27 [7.14–11.47] |
| worker.startup.module.evaluate | 48.53 [44.11–53.86] | 51.90 [45.54–60.23] |
| worker.startup.dataset.evaluate | 35.09 [34.33–38.49] | 33.93 [29.78–40.13] |
| worker.startup.calculator.initialize | 25.89 [21.15–28.23] | 25.72 [23.25–34.03] |
| worker.startup.runtime/relay | 249.17 [234.98–265.93] | 269.53 [244.69–293.07] |
| worker.queue.behind | 0.00 [0.00–0.00] | 0.00 [0.00–0.00] |
| worker.queue.scheduler | 1.32 [1.10–1.70] | 0.66 [0.51–0.85] |
| worker.dispatch.prepare | 0.39 [0.30–0.48] | 1.14 [0.97–2.24] |
| worker.message.inbound | 4.94 [2.95–8.41] | 32.04 [25.45–40.75] |
| worker.message.return | 3.09 [1.94–3.98] | 11.04 [8.20–13.19] |

There are 15 complete worker factory-to-ready records. Their synchronous
factory spans have median 3.83 [2.48–8.10] ms.
Spawn contributes zero to these request-queue slices because it finishes before
the waiting job is enqueued; it is not assumed free. Observed blocking job
types were roll-pool, evaluate, with IDs and origin profile IDs retained.
The dominant remaining startup sub-bucket is explicitly runtime/relay: V8
parse/link, bootstrap and scheduling below the loader/evaluation boundaries.
It is a measured startup wait with unresolved internals, not a fabricated
module-load or dataset duration. Message send boundaries are retained raw;
they overlap the inclusive inbound-delivery interval in the wall partition.

### Artifact validation and provenance

Full mode: 40 windows, 148626 unique spans, 300 CPU profiles,
6985 raw startup observations. Spans-only: zero CPU profiles and zero
trace events. All gameplay mutation revision checks passed in all modes.
Full report Chrome check: 40 scenario headers, nine summary rows, a lazily
expanded waterfall with 8,620 bars, zero script exceptions. Data is embedded
compressed and process intervals are packed into compact waterfall rows.

The final five browser blocks are 2, 3, 4, 5, 6. Block 1 was excluded solely
because schema v1 omitted raw startup retention, before timing analysis; one
fresh reverse-order block replaced it. Both orders remain represented.
This reporting-field change was outside the measured action windows.
Raw individual blocks, mode comparisons, paired route results and numeric
summary are under `/tmp/rs3-profiler-r2-evidence`.

| Mode/artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| spans/profile.json | 7045157 | `25a367119c36182c0676b0677cca58ff012759c57e36663701b0b5190eb1b9e2` |
| spans/report.html | 874296 | `6ef66929ad74a78ad57184a28cf692d74a88beeff565145abaf887f8f711e9bf` |
| full/profile.json | 264502149 | `85a37ce440e1eca901abe256dde03fba27e6931ab13a96a18d4021862edd39d6` |
| full/report.html | 3800816 | `63d1ff5c001dd9c0bb75a835b2c16835fdc351312778a0f38fb2b12893efaf50` |

Recommendation: **MERGE-CANDIDATE** for this synthetic profiling workflow.
The measurable off-regression gate has no detected difference at the reported
precision, all scenarios pass the real-gap target, and capture costs are
explicit. Native startup internals, GPU presentation, exact async causality and
virtual-pool inspector controls remain the stated limits.

Input-window validation also meets the target: worst full-mode input/preamble
window gap 1.773%; worst spans-only 1.457%.
An earlier click's asynchronous span does not stretch its time window. Coverage
uses all observed concurrent work; causal references remain separate.
