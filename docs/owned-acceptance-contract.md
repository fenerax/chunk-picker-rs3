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

The parent launches format 1 and format 2 in separate fresh Node processes,
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
Post-GC barrier receipts are separate from periodic peak samples and cannot be
overwritten by later allocations. A missing isolate or retired calculator
invalidates the run instead of reducing its reported memory.

Every group receives ticks, notes, Undo, native digest/full calculator transport,
full response serialization, play/claim projection and narrow identity lookup.
A simultaneous round overlaps all 50 request streams with all handles retained.
Scheduler queue/deadline/cache/resource limits are unchanged. Rejections are
recorded without retry and prevent an acceptance claim. After settling and GC,
one read-only round warms the resulting cache working set, followed by four
identical rounds. Their receipts are written outside the store root and released
between rounds, so growing measurement arrays do not cause the leak check.

## Dispatch after merge

In GitHub Actions choose **Owned format 2 acceptance → Run workflow** on `main`,
or run:

```sh
gh workflow run format2-acceptance.yml --ref main -f snapshots=false
```

The workflow always checks out `main`, has no unmerged-ref override, and runs
Ubuntu and Windows five times each, with at most two jobs active. Each job runs
one comparison; each format is a fresh process at BelowNormal priority, on Node
24.21.0 (the harness requires 24.20+ within 24.x). There are no package dependencies.
The full harness refuses execution outside hosted Actions. Never run its
50-group mode on the shared PC. Normal tests discover the tiny deterministic
`tests/owned-acceptance.test.mjs`; it checks plumbing and structure only.

Artifacts `owned-acceptance-<OS>-<1..5>` contain `results.json`, `summary.txt`,
per-format results and isolate probe receipts, also uploaded on failure. Keep
all ten runs and their exact commit/runtime/host/OS/seed metadata. A failed
process can leave only partial probe evidence; that is an incomplete run. No
single run, median across runs or average group cost establishes acceptance.
The final summary job pools wall/CPU percentiles by OS and format into
`owned-acceptance-aggregate/aggregate.json`, checks five distinct receipts per OS
at the same commit/runtime/seed, and requires every format-2 trial to meet the bar.

## Accounting and interpretation

`baseline.total` is the shared charge, counted once per format process tree.
`sharedCharge` includes its allocation change since imports and canonical base
byte length for orientation. Actual parsed bases, immutable dictionary roots,
key arrays, task indexes, wire encoding, dataset engine and transport copies in
each physical isolate are included in the measured heap. Baseline heap is never
estimated by serializing the state or subtracting a guessed base size.

`openSamples`, `commandSamples`, `settled` and `repeated` contain every measured
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

Targets are **every group ≤5 MiB** and **total group heap ≤250 MiB**. Any attributable
group **>15 MiB**, aggregate **>750 MiB**, or positive heap growth in every interval
of the four identical read-only rounds rejects the run. This strict growth flag
needs snapshot attribution if noise is suspected; it is never silently waived.
`target-met` is emitted only when targets and hard limits hold, all commands
complete, no base is rewritten, and the two formats agree. Missing the targets
within the hard limits is reported distinctly and still exits unsuccessfully.
Smoke always says `smoke-only` with `acceptanceClaim: false`.

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
`measuredIO`; `allPostPublicationIO` also includes bounded lanes. Counts include
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

Dispatch with `snapshots=true` to capture V8 heap snapshots for every live
format-2 controller/relay/calculator isolate at the shared baseline, 1 and 50 groups, and
after bounded lanes. Load the `.heapsnapshot` artifacts in Chrome DevTools Memory.
Use Comparison against the same isolate's baseline, then Dominators/Retainers
to attribute growth: `__ownedAcceptanceHandles`, store closures, dictionary
WeakMaps, base/key arrays, task Maps, result caches and response buffers. A base
copy in each physical calculator belongs to its shared baseline; a dictionary
or index repeated under every handle belongs to group cost. Snapshots are large
and perturb timing, so use a separate diagnostic dispatch rather than treating
its wall times as clean speed evidence. They contain generated synthetic data only.

7c still owns synthetic activation, pinned-dataset preparation, retirement
filtering and current-name display, plus investigation/fixes for any failed
measurement and the later full load/restart/speed proof. Browser negotiation
and catalogue GC remain slices 8 and 9. This change authorizes no production
activation or real-save migration.
