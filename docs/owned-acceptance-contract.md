# Owned acceptance: slice 7b (synthetic only)

`scripts/perf/owned-acceptance.mjs` measures the retained storage/calculator
seams delivered by 7a. It enables `ownedFormat2` only in its synthetic format-2
process. The application default remains off. No server, account, plugin or
browser protocol is changed. This contract defines a measurement, not a result:
landing the harness or passing its smoke test does not establish acceptance.

## Fixture and lifetime

The recorded seed is `owned-acceptance-7b-2026-11-10-v1`. Each format gets the
same 24,000 base tasks, 100,000 aliases (including ordered collisions), 256
synthetic chunks, four members, one distinct generated goal and custom row per
group, distinct assignments/completions and 1,000 active History events plus
two 100-event archived segments per group. Extra goal/custom rows are above the
24,000 base rows. Capacity's deterministic PRNG, task dependencies and synthetic
world generator are reused. Real note commands build guarded Undo inverses;
the group stamp changes both sides of each inverse together. No account records,
account identifiers, private saves, external fetches or operational inputs enter
the fixture. Fixture/final logical hashes must match between formats. Final
hashes replace entropy-bearing archive filenames with hashes of archive bytes,
as the capacity fixture does; no History content is removed from the comparison.
Fixture preparation provisions each store's `backups/` and a deterministic,
synthetic-only `access-token`. The extra stopped-rebase store never opens a
writer; its read-only source/import readers cannot create that required token,
and rebase staging needs the backup directory for its pinned preimage. Neither
input comes from a Windows checkout, a pack cache or an existing save.

The launcher runs each selected format in a separate fresh Node process,
clearing inherited dataset, asset, profile and Node options. Fixture preparation
is outside timed opens and writes; the base is durably published once. One
shared rule/world runtime and one physical process calculator are warmed on the
full catalogue, including commands, responses and identity lookup. The warmup
group is closed before the shared baseline; none of the measured groups closes.

After forced GC in the controller, relay and calculator isolates, the harness
records the baseline. It then opens 50 durable owned stores sequentially and
retains all handles, bound scheduler facades, four action sessions and four
live scheduler session leases per group. Each increment gets a GC sample;
`checkpoints` selects 1/10/25/50. There is no group/session eviction or manual
cache flushing. Existing bounded result/snapshot LRU policies remain intact.
Post-GC barrier receipts live in immutable per-sequence directories, separate
from append-only peak-sample journals. The controller appends complete request
lines; readers consume only complete lines. No publication replaces a target
that a Windows reader may hold open. An isolate acknowledges a sequence only
after publishing its receipt. Any publication/GC failure writes a terminal error
receipt which the controller checks at each barrier; it fails immediately rather
than skipping the request or retrying a rename. A missing isolate or retired
calculator invalidates the run instead of reducing its reported memory.

Every group receives ticks, notes, Undo, native digest/full calculator transport,
full response serialization, play/claim projection and narrow identity lookup.
A simultaneous round overlaps all 50 request streams with all handles retained.
Both formats explicitly select `RS3_MEMORY_PROFILE=budget-672` in fresh trial
processes, before any application import. The receipt records `memoryProfile`.
This is the opt-in profile defined below; the live default keeps its existing
cache capacities. Queue, deadline and process resource limits are unchanged. Rejections are
recorded without retry and prevent an acceptance claim. After settling and GC,
one read-only round warms the resulting cache working set, followed by four
identical rounds. Their receipts are written outside the store root and released
between rounds, so growing measurement arrays do not cause the leak check.

Both formats submit calculation input through the production
`deferredTaskInput(store, taskInputKey)` provider used by native picker contexts.
Admission retains the resident store and input identity, then the scheduler
loads the revision-fenced capture only when a calculator is available. Format 1
therefore encodes its full `stateJSON` at dispatch, while format 2 loads its owned
input at dispatch. Neither queues an eagerly encoded full save. Command counts,
full result transport, refusals and deadlines are unchanged. Both formats use
the same byte/count limits.

Five additional mutation rounds run **tick → Undo → note → Undo** on every
retained group, then calculate and serialize full/play responses at the new
revision. The first round warms this path; four subsequent rounds are measured
as `mutationRepeated`. This tests revision-keyed caches that identical reads
cannot exercise. Tick and note state are restored, while four real History events
per group/round remain durable (at most 20 new events over the phase). Retention
and guarded Undo can archive events or retain a longer suffix; their policies
are unchanged. Each round records revisions, active-event deltas, archive counts
and logical History bytes against `mutationHistoryBaseline`, and checks this
workload bound. Mutation timing/History receipts are released before GC and read
back only after all repeated measurements finish.

## Dispatch scope (owner decision, 2026-11-11)

The default `diagnostic` scope measures Ubuntu fresh run 1 in both formats.
It still checks paired fixture/final hashes and every reject gate. Only `full`
scope, with both OSes and all five fresh runs, can establish final acceptance:

```sh
gh workflow run format2-acceptance.yml --ref main -f scope=full -f snapshots=false
```

Every job checks out the dispatch's immutable `github.sha`, including a branch
dispatch. The earlier `ref: main` prevented measuring an unmerged branch; its
introducing commit records no further safety rationale. SHA-pinned actions,
`contents: read`, `persist-credentials: false`, synthetic inputs and hosted-only
full measurements remain in force. A branch dispatch receives no write token.
The full OS × run × format matrix has twenty jobs, at most two active; each measures one format
with its own unchanged 60-minute timeout. Each format is a fresh process at BelowNormal priority, on Node
24.21.0 (the harness requires 24.20+ within 24.x). There are no package dependencies.
The full harness refuses execution outside hosted Actions. Never run its
50-group mode on the shared PC. Normal tests discover the tiny deterministic
`tests/owned-acceptance.test.mjs`; it checks plumbing and structure only.
Its fixture uses one group, three tasks, two aliases/chunks, one active History event
and one single-event archive, with one warmup and one measured round per phase.
Both formats, mutation commands, isolate receipts, bounded lanes and aggregation
use the full harness path. The 50-group fixture and its five rounds are unchanged.
Test cancellation propagates over IPC to the trial's AbortSignal and every
calculator child; the launcher waits for process closure before removing stores
or returning. Cancellation does not start the second format.

`--format format1` and `--format format2` select individual measurements; omitting
`--format` keeps the sequential local smoke/comparison path. Single-format
summaries explicitly make no acceptance claim. The aggregate job reads both
ordinary artifacts for each OS/run, recomputes fixture/final hash equivalence
and the comparison decision, and requires all ten comparisons to pass as before.
Missing/duplicate receipts, failed processes, command errors in either format,
base rewrites in either format, or mismatched commit, seed, Node/V8/architecture,
dispatch/attempt, smoke or snapshot settings prevent acceptance. Format 1 remains
the control; its memory target is reported, while format 2 must meet every
hard limit and growth gate. Targets are reported goals. There are no retries.
`scope` must match in the format receipts and aggregate's requested scope;
missing or mismatched scope, extra OS/run receipts and incomplete pairs fail.
`scopePassed` records whether the requested set passed. A diagnostic aggregate
always has `acceptanceClaim: false`. Launcher decisions retain `gatePassed` for
the per-trial verdict and suppress claims in diagnostic artifacts too.

The contract requires the same OS/run and runtime, not the same physical runner.
Each format measures heap increments against its own warmed shared baseline;
no gate divides or subtracts one format's measurement from the other. Separate
hosted VMs therefore preserve those gates and logical equivalence. Both hosts'
metadata remains in each aggregate comparison. Timing percentiles are descriptive
samples across hosted machines, not a paired-hardware speedup claim; snapshots
remain a separate diagnostic dispatch. Splitting jobs removes the combined
timeout without extending either format's measurement allowance.

Artifacts `owned-acceptance-<OS>-<1..5>-<format1|format2>` contain `results.json`,
`summary.txt`, per-format results and isolate probe receipts, also uploaded on
failure. The aggregate artifact records each OS/run comparison, decision and
human summary alongside the existing pooled percentiles. Keep all twenty
measurements and their exact commit/runtime/host/OS/seed metadata. A failed
process can leave only partial probe evidence; that is an incomplete run. No
single run, median across runs or average group cost establishes acceptance.

`calculatorLifecycle` preserves each physical worker's ID/PID, start context and
replacement flag, initiation events, original worker errors (name/code/message/
stack), and observed exit code/context. Each receipt identifies the stage,
current barrier and last completed barrier. Initiation events identify deadline,
memory ceiling, crash, idle, generation retirement, explicit restart, profiling
retirement or capacity eviction, with the scheduler's existing diagnostics and
active job kind/age, effective deadline allowance and deadline age. Pool events
also retain pool diagnostics. These come from an optional, in-process
`onCalculatorLifecycle` observer before retirement/recovery clears the state;
worker messages, client responses, limits and scheduling policy are unchanged.

On a trial failure, `<format>/failure.json` retains this evidence, the failure
stack, scheduler diagnostics and already collected command errors/timing records.
The controller includes it in `results.json` under `failures` and explains each
incident in `summary.txt`, including the exit code. `schedulerLifecycle` records
failures or explicit restarts with no physical worker currently owned. Normal
teardown is excluded; a previously observed incident can still receive its exit
details during teardown. An exit not observed is reported explicitly, never
guessed. Cancellation remains cancellation. Missing residency evidence still
fails the trial; these diagnostic receipts cannot establish acceptance.

The final summary job pools wall/CPU percentiles by OS and format into
`owned-acceptance-aggregate/aggregate.json`, checks the exact requested scope at
the same commit/runtime/seed, and requires every format-2 trial to meet the bar.

## Accounting and interpretation

`baseline.total` is the shared charge, counted once per format process tree.
`sharedCharge` includes its allocation change since imports and canonical base
byte length for orientation. Actual parsed bases, immutable dictionary roots,
key arrays, task indexes, wire encoding, dataset engine and transport copies in
each physical isolate are included in the measured heap. Baseline heap is never
estimated by serializing the state or subtracting a guessed base size.

`openSamples`, `commandSamples`, `settled`, `repeated` and `mutationRepeated` contain every measured
isolate's post-GC heap used/total, external and array-buffer bytes; relay and
calculator heaps are separate. RSS and process CPU are counted once per PID,
because their values are process-wide. The total heap sums isolate-local heaps.
WeakMap-held sparse graphs, task arrays/indexes and retained result graphs are
therefore charged even when V8's snapshot-size estimate cannot see through an
opaque dictionary. Backing buffers, including full unnegotiated response bytes,
are reported separately, never mistaken for zero-cost heap storage. Each handle
retains the actual response-cache/representation primitives at the context's
32-entry/48-MiB limits, including plain and gzip bytes; `responseCaches` records
their retained bytes. The harness builds the same state envelope without a server.

Per-group attribution conservatively adds positive open and command heap
increments with all previous groups retained. The report includes every signed
increment, maximum, nearest-rank p50/p95/max and least-squares open slope. This is
allocator-level attribution, with GC noise; optional dominators explain outliers.
It does not divide aggregate heap by 50 and call that proof. Aggregate rejection
uses the greatest post-GC group heap above baseline at any measured stage.
Positive growth after the serial attribution phase is also reported as
`unattributedGrowthBytes`. The worst possible individual owner is charged that
whole residual for target/hard-limit decisions until dominators can explain it;
the harness never spreads uncertain concurrent growth over fifty groups.

Targets are **every group ≤5 MiB** and **total group heap ≤250 MiB**. The
**owner decision, 2026-11-11** makes these goals, not approval requirements. `targetMet`
remains computed from the same raw measurements. `target-met` and
`within-hard-limits-target-missed` both carry a per-trial acceptance claim when
the run is not smoke and has no reject reasons. Final acceptance also requires
full CI scope and both formats' equivalence.

Any attributable
group **>15 MiB**, aggregate **>750 MiB**, or positive heap growth in every interval
of the four identical read-only rounds rejects the run unless the ledger rule
below proves steady state. Missing proof preserves the original raw gates.
The mutation gate also rejects a positive least-squares retained-heap slope
across the four measured mutation rounds. `decision.mutationGrowth` reports the
raw slope per round/per command and deltas, alongside the bounded History
accounting and logical-byte slope. History remains charged in every heap limit;
JSON bytes are not a V8 retained-size estimate and are never subtracted. Positive
growth requires evidence; bounded filling and GC noise can also reject a run.
Neither a History subtraction nor averaging groups can waive a hard limit.
Smoke always says `smoke-only` with `acceptanceClaim: false`.

## Steady-state rule (owner decision, 2026-11-11)

The allowlist is History (active events and archive), response caches, the hot
snapshot and shared snapshot/eligibility ledger, engine variants, stateSnapshots,
and compiled code/feedback. In-code ledgers supply their current entries/charges
and enforced caps at immutable isolate barriers. Sampling asserts existing caps;
a numerically proven owner cap violation rejects the trial. An unlisted owner
or missing/malformed proof denies the waiver; the original raw gates then decide.
Logical/wire/backing bytes are explicitly labelled and never converted to
guessed V8 bytes.
Ledger censuses remain in the immutable probe files during measurement and load
after the repeat phases. They do not accumulate under retained open receipts.

Warm-up must derive its admissions from the workload and the enforced entry
caps, or an enumerated finite working set. For example, two new full/play
response keys per mutation cycle need at most ceil(32/2) admission cycles before
entry saturation, unless the 48 MiB byte bound causes earlier eviction. A cap
assertion or complete working-set assertion is required; being below a cap for
a guessed number of rounds proves nothing. All owners must reach their cap or
steady working set before the post-warm-up measurements. Each ledger dimension
must then be flat, with the same complete owner inventory at every barrier.

The waiver must account for the largest forward heap increase from any preceding
checkpoint minimum across the measured interval. An earlier peak or decrease
cannot hide growth within the read-only or mutation repeats. Compiled code/feedback
is the sole unledgered allowance: at most **1 MiB across the entire process tree and entire
measured interval**, backed by non-native compiled-code/feedback heap evidence.
`getHeapCodeStatistics()` is reported for diagnosis but cannot certify that
attribution. Missing code attribution permits no positive residual. Native and
backing-store changes are reported separately and cannot offset heap growth.
An `uncoveredMaximum` always vetoes a waiver. All raw heap measurements, the
conservative worst-owner residual, targets and hard reject lines stay charged.

`decision.steadyState` is machine-checkable and explains why proof is unavailable.
The source audit still has a History blocker, so this implementation emits no
successful warm-up assertion and runs the original rounds/growth gates:

| Owner | Default profile (existing live policy) | Opt-in `budget-672` profile |
| --- | --- | --- |
| Group response cache, including saved-Why | 32 entries / 48 MiB per group | Same local cap, within global response quota |
| Sandbox pool response cache | 32 entries / 4 MiB per group | Same local cap, within global response quota |
| Static responses | 128 entries / 48 MiB | Same local cap, within global response quota |
| Generic response cache | 64 entries / 32 MiB | Same local cap, within global response quota |
| Service response aggregate | **Report-only bytes and entries; no global eviction** | **128 MiB / 4,096 entries** across the above owners |
| Scheduler foreground and advisory results | **8 entries / 128 MiB each** | 8 entries / 48 MiB each |
| Scheduler duo results | **4 entries / 32 MiB** | 4 entries / 16 MiB |
| Preview and saved-unlock reuse | **256 entries / 16 MiB each**, 32 MiB combined | 256 entries / 8 MiB each, 16 MiB combined |
| Scheduler aggregate | 320 MiB, derived from independent lane caps | **128 MiB service-wide** |
| Hot snapshot | One graph / 128 MiB per calculator; included in worker charge | Same local cap, also limited by worker share |
| Worker snapshot/eligibility cache | **512 entries / 384 MiB per calculator** | 512 entries per calculator / **256 MiB across calculators** |
| Engine variants and lazy indexes | 16 combinations; byte ledger report-only | 16 combinations / **128 MiB parsed charge across calculators**, plus fixed input charge `B` |
| stateSnapshots | Two entries per calculator; byte ledger report-only | Two entries per calculator / **16 MiB across calculators** |
| Installed calculator bases | Entry and byte ledgers report-only | Two entries per calculator / **16 MiB across calculators** |
| History | Existing compaction; byte ledger report-only | Unchanged; pending-roll/Undo suffixes, archives, payloads and provenance lack a hard cap |
| Production saved viewer task results | Eight entries / 32 MiB compact + 16 MiB full gzip per group | Unchanged; outside managed quota because eviction changes read-only replies |

Every owner reports real numeric byte usage in both profiles. Missing default
bounds are `cap: null, enforced: false, complete: false`; report-only dimensions
cannot establish a waiver. The opt-in acceptance census retains complete enforced
entry/byte dimensions for the bounded owners; History still blocks a certificate.
`includedInOtherCap` excludes
subset rows only from additive projections; it never exempts their evidence
from validation. The hot graph is charged by its worker, and group responses
by the service response ledger. Those subset charges enter the total once.
Independently retained inputs conservatively charge their complete reachable
graphs, including any shared immutable base; those source charges are not exact
physical heap attribution.

### One managed service budget (owner decision, 2026-11-11)

With no budget overrides, including `RS3_MEMORY_PROFILE=default`, the default profile
preserves the live per-owner limits pinned from `origin/main` at `bcd3c92b`.
Worker partitions remain 192 MiB per picker, 128 MiB eligibility and 256 MiB
snapshots within each 384 MiB calculator cap. Existing entry eviction, byte
measurement, ledgers and census remain active. The service response aggregate
is **report-only by default**, including its entry count. A finite global cap
could tighten behavior as more groups open, so no new aggregate eviction is
enabled. Engine and input byte ledgers are also report-only where the existing
path had no byte limit; installed bases retain their existing unbounded Map
policy. This profile makes no complete service-bound claim.

`RS3_MEMORY_PROFILE=budget-672` explicitly enables **672 MiB**. Setting
`RS3_SERVICE_CACHE_BYTES=704643072` enables the same allocation without the named
profile; other integer values select a scaled custom budget. Its partitions are 128 MiB
responses, 128 MiB scheduler results, 256 MiB worker snapshot/eligibility caches,
128 MiB parsed engines and 32 MiB inputs (snapshots and installed bases). Physical calculators divide
the last three partitions by the configured maximum calculator count; they do
not each receive the whole allocation. Without a pool, four lane shares cover
foreground, advisory, Preview and duo. Replacement/retirement remains governed
by the existing physical-worker lifetime and RSS controls.

In a budget profile, `RS3_RESPONSE_CACHE_BYTES` overrides the response partition
and must not exceed the service budget. With no override it receives 4/21 of the total. The remainder
is divided 8:4:1:4 between worker caches, parsed engines, inputs and scheduler
results. `RS3_CALCULATOR_CACHE_BYTES`, `RS3_ENGINE_VARIANT_BYTES` and
`RS3_STATE_SNAPSHOT_BYTES` can lower a calculator's assigned share; larger values
are clamped to that share. For input residency the option lowers each half-share
(snapshots and installed bases). Quotas use integer bytes, rounding down.
In the default profile, a lone `RS3_RESPONSE_CACHE_BYTES` opts into only that
global byte limit (no global entry cap); it does not shrink the other owners.
Individual worker/engine/input overrides remain available without a service
budget. Unknown profile names and invalid byte budgets are refused at startup.

The opt-in allocation gives responses an average 1.28 MiB/group at 100 active
groups when fully occupied, compared with about 18 MB/group observed in the
capacity work. Pressure can increase recalculation latency. Speed has priority;
the budget profile must be load-tested before becoming the live default
(owner decision, 2026-11-11). The 5 MiB/group goal is reported only. The managed
672 MiB total leaves 78 MiB below the 750 MiB hard measured total for fixed
inputs, History and other residency. This is a budget choice to load-test, not
evidence that those remaining owners fit. The fixed engine source/catalogue
charge `B` is measured at construction, reported separately and cannot grow by
cache admission. It is included in cap projections in addition to 672 MiB.
The 15 MiB/group and 750 MiB total reject gates are unchanged. Launch remains a
capped beta of about 25–50 groups within a load-tested envelope of about 100
active groups and about 200 online; 2,000 players remains the design ceiling.

When global enforcement is enabled, response eviction prefers globally old entries from groups above a soft 64 KiB
floor, then falls back to global LRU. The floor cannot override the byte/entry
cap. In-flight saved-Why decoder reservations remain charged and cannot be
evicted until they settle. New admissions decline if pinned reservations leave
insufficient room. Completed identity/gzip/brotli growth rebalances the same
ledger. The caller still receives uncached results; response bytes, ETags,
conditional requests and saved bytes are unchanged.

In the budget profile, at **100 groups** and **500 groups**, the known managed subtotal is the same
`704,643,072 + B` bytes, instead of multiplying the group response cap. The full
projected worst case remains **unbounded** at both group counts because History
has no finite payload/reference cap. The diagnostic projection therefore returns
`null` for complete totals at both counts. An arbitrary observed History size
must not be substituted for its missing cap.

This is the synthetic harness subtotal. Production saved viewer results add
48 MiB/group outside that allocation: the identified bounded subtotal is at
least **5,472 MiB + B** at 100 groups and **24,672 MiB + B** at 500 groups,
before other roots.
[Remaining service residency gaps](f2-memory-residency-gaps.md) records those
owners and the reply-preservation requirements for follow-up. This change does
not establish a complete service-wide memory bound.

The default profile has no finite managed service total: response allowances
scale with group count, and parsed engines/input bytes have no finite caps.
The full worst case is unbounded at both 100 and 500 groups in both profiles.

### Sustained load harness forwarding

The inspected `perf/sustained-load` harness cannot yet forward either selector.
`scripts/perf/capacity/run.mjs` constructs an OS-only child environment, and
`scripts/perf/capacity/server.mjs` deletes every `RS3_` key before importing the
server. That branch needs to allowlist `RS3_MEMORY_PROFILE`,
`RS3_SERVICE_CACHE_BYTES` and optional `RS3_RESPONSE_CACHE_BYTES` in **both**
places. Preserve only those values through sanitization and restore them before
the first application import. Use the same values on initial server launch and
restart, and record the selected profile/effective budget in the receipt.
Keep the remaining synthetic-only environment filtering intact. Then the harness
can compare no overrides against `RS3_MEMORY_PROFILE=budget-672` (or the byte
selector above). No harness branch is edited by this change. Its current
format-2 HTTP refusal remains separate from profile forwarding.

The warm-up preflight stops with these blockers instead of running an unbounded
loop or inventing limits. Resolving them requires source ownership/budget work;
this change does not impose a new History policy or change save/wire formats.
[History residency design](f2-history-residency-design.md) records why a hard
bound would cross the task's compatibility stop condition. No default-off load
option is implemented or enabled in this change.
`retention.caps` reports the per-group sum and projections to 100 and 500 groups, plus
shared caps, as diagnostics only. Complete totals are `null` while any byte cap
is missing; known subtotals remain numeric and identify overlapping charges.

Usable full-shape snapshots are not required for a complete ledger proof. If
ledger proof is unavailable, snapshots cannot replace it: the original raw
growth gates apply unchanged, with the reason recorded. This supersedes the
earlier snapshot-only waiver requirement. Spot checks may veto a proof but
cannot supply missing caps or offset unexplained heap.

`times` contains p50/p95/max wall, controller CPU and child process CPU for opens
and each command/request kind. Child CPU is sampled at explicit before/after
barriers and includes measurement overhead. Simultaneous per-request CPU is
`null` because intervals overlap; `simultaneous` reports the batch CPU once.
Open times include opening four action sessions. Ready time spans the warm
shared baseline to all stores/sessions open, including measurement barriers.

`speedBar` records the owner's advisory targets beside the wall percentiles:
everyday actions p95 <300 ms, heavy calculations <3,000 ms, cold open <2,000 ms,
and all groups ready about 300,000 ms after restart. These never gate 7b. The
ready/open measurements here do not include a cold service restart or browser
readiness; the later full load test owns that proof.

The harness-only preload wraps successful filesystem writes and sync attempts
in the generated store tree. `setupIO` separates fixture/base publication from
`measuredIO`. A callback immediately after the single base publication captures
the independent counter origin for `postPublicationIO` and `allPostPublicationIO`;
both include fixture completion, warm open and warm commands, and the latter
also includes bounded lanes. Base rewrites during warmup therefore reject the
run even though warmup is outside ordinary group timing. Counts include
successful/attempted fsync, successful bytes/write calls, and catalogue file
writes (including temporaries), which must be zero after publication. Windows
directory sync remains best effort under the existing publication contract;
attempt and success counts expose the distinction. Format 1 uses identical
commands and instrumentation, with its own time/write counts.

Each isolate reports sampled temporary peaks at intervals, filesystem and result
send boundaries, plus OS `maxRSSBytes`. These are observed lower bounds for
temporary heap, with an OS process RSS high-water mark, not exact allocation
maxima. `bounded` separately measures exceptional dictionary enumeration recipes,
a configured full commit hook, flat compatibility snapshot plus portable export,
and a stopped rebase to the same verified base. Extra synthetic stores avoid
closing any measured handle. Import-worker endpoint samples are retained as
`transientIsolates`. None of these bounded lanes is folded into ordinary group
attribution. Compatibility snapshot counts are explicit; ordinary format-2
materialization/copy counts come from 7a's existing counting seam.

## Outlier attribution and next slice

Dispatch with `snapshots=true` to run a **separate reduced diagnostic job** after
the measured jobs have exited. It uses three synthetic groups, 2,400 tasks and
10,000 aliases, with the ordinary History/membership shape and five rounds.
It cannot establish full-shape acceptance or certify another process's growth.
The measured jobs never capture snapshots. Their process/pool ceilings are
unchanged, and the diagnostic job uses those same ceilings. Full-catalogue
capture previously exceeded the 3 GiB process ceiling; a sequential streaming
experiment instead hit the shared PC's lower dynamic pool budget (~1.54 GB).
Neither observation justifies raising a ceiling. Reducing the separate spot-check
shape avoids making full-catalogue snapshot RSS a prerequisite for the gate.

The diagnostic pass captures each live format-2 controller/relay/calculator
isolate at the shared baseline, first/last group,
the end of serial commands, settling, every read-only and mutation round, and
after bounded lanes. After the trial and its calculators have exited, the
launcher automatically writes `<format>/dominators/index.json` and per-isolate
interval reports. These cover the serial-to-maximum residual and all repeat
intervals, preserving the raw heap/external/array-buffer deltas and snapshot
SHA-256 identities. A missing snapshot or isolate fails diagnostic publication;
it cannot silently remove an isolate from the comparison.

The offline analyzer computes immediate dominators with Lengauer–Tarjan over
V8's strong-edge graph (weak edges excluded). Reports include retained-size
paths, shortest strong retainer paths, signed constructor/self-size changes,
and stable closure-binding comparisons, including `current.history`. Stable
binding comparisons distinguish a replacement History array or hot snapshot
from additional retained copies. Retained subtrees overlap; never sum the
largest-object deltas. Native self sizes include backing stores and are reported
separately from non-native snapshot sizes. Neither snapshot size is a substitute
for the measured `heapUsed` or a permitted subtraction from it.

These reports are diagnostic evidence, not automatic certificates of a bound
on future growth. They preserve all rejection reasons and change no decision,
threshold, History accounting, cache policy or workload. An unexplained residual
still rejects. `snapshotAttribution` in the outer receipt links the report index;
the ordinary JSON artifact includes all reports. Raw snapshots remain in the
separate explicitly requested artifact. To compare two generated snapshots
independently, run:

```sh
node scripts/perf/owned-acceptance/heap-dominators.mjs before.heapsnapshot after.heapsnapshot dominators.json
```

Load the `.heapsnapshot` artifacts in Chrome DevTools Memory.
Use Comparison against the same isolate's baseline, then Dominators/Retainers
to attribute growth: `__ownedAcceptanceHandles`, store closures, dictionary
WeakMaps, base/key arrays, task Maps, result caches and response buffers. A base
copy in each physical calculator belongs to its shared baseline; a dictionary
or index repeated under every handle belongs to group cost. Snapshots are large
and perturb timing, so use a separate diagnostic dispatch rather than treating
its wall times as clean speed evidence. They contain generated synthetic data,
including the seed-derived fixture `access-token` value, and are not redacted.
Only an explicit `snapshots=true` dispatch uploads the separate
`owned-dominator-spot-check` artifact (14-day retention), containing receipts,
reports and raw snapshots. Its name and directory are outside the aggregate's
ordinary `owned-acceptance-*` receipt selection. Locally use `--spot-check`
for the same reduced shape; it always implies smoke/no acceptance claim.

7c still owns synthetic activation, pinned-dataset preparation, retirement
filtering and current-name display, plus investigation/fixes for any failed
measurement and the later full load/restart/speed proof. Browser negotiation
and catalogue GC remain slices 8 and 9. This change authorizes no production
activation or real-save migration.
