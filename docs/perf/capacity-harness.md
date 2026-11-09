# Synthetic capacity harness

This implements capacity-plan step 2: build disposable stores and measure today's
server without changing the application. It is not a public-launch acceptance
certificate. The proposed workload and gates are in
[groups and accounts](../groups-and-accounts.md#proposed-acceptance-workload-and-gates).

Use a fresh **Linux scratch host**, Node **24.20.0 or newer 24.x**, Git and this
checkout. No npm installation, credentials, environment file, game cache,
provider account or existing save is needed. Run from the checkout root:

```sh
node scripts/perf/capacity/run.mjs --profile smoke --output /tmp/rs3-capacity-smoke
node scripts/perf/capacity/run.mjs --profile nominal --output /tmp/rs3-capacity-nominal
node scripts/perf/capacity/run.mjs --profile step-up --output /tmp/rs3-capacity-step-up
```

Each output directory must be new; its parent must exist. Every command generates
its own fixture before starting the timed server. Commands are independent, not
an instruction to run them concurrently. The runner never accepts a server URL.
It binds its own child to loopback on port 0 (or a configured 8900–8999 port).
`--host` accepts only literal loopback names; redirects are refused. Ports
8788/8789 and arbitrary remote targets are refused. Inherited `RS3_*`, provider
secrets, Node flags and external provider transports are not used. The only
outbound app integration supplied to this server is an in-process fake.

The complete bundled `duo-legacy` **public runtime metadata** is used with an
injected synthetic catalogue and world through existing `createServer` options.
No legacy save is read. The small `open-f2p` dataset disables account sync and
some progress commands, so it cannot exercise the required full HTTP mix.
Every generated label/name/progress observation is synthetic. The custom world
also supplies its own surface and neighbor graph rather than using that
dataset's geographic crop.

## Profiles and duration

| Profile | Population | Offered interval, excluding fixture setup |
| --- | --- | --- |
| smoke | 2 duo groups, 4 logins, 32 tasks, 4 keys | 5 s warm-up + 15 s measured |
| nominal | 500 four-player groups, 2,000 logins, 6,000 keys | 2 min ramp/warm-up + 60 min measured |
| step-up | Same stored population | 18 min: warm-up, 25/50/100/200/300/400 users, five-minute nominal return |

Allow up to the 30-second client deadline for draining, plus server startup and
shutdown. Large-fixture generation remains a scratch-host measurement; the
reduced Windows measurement and extrapolation below are planning estimates.
The nominal fixture performs roughly 0.5 million
durable History/snapshot writes, plus initial growth, key and registry writes.
Its 200,000-task dependency graph and recovery preimages can need substantial
RAM and disk. `fixture-progress.json` reports completed groups and the current
group, roster, phase, completed/total operations, command type when starting an
operation, timestamp, sequence and elapsed time. It publishes before slow work,
on phase/group boundaries and at least once per second between operations.
A synchronous command cannot emit a heartbeat while blocked; an unchanged
timestamp identifies its last known phase. Writes are awaited and atomically
renamed, so readers never see a partially written document. `setupSeconds`
reports actual generation cost. A setup failure is preserved in `failure.json`;
it is a failure envelope observation, not an invitation to change app limits.

On the shared Windows PC, run **only smoke**, at BelowNormal priority under
the shared heavy lock from [testing](../testing.md), releasing within ten
minutes. Do not use nominal/step-up there. The runner refuses their profile
names on Windows and caps a smoke offered interval at two minutes. Linux is
required for complete process-tree resource measurements.

For another experiment, copy a profile JSON and pass its path to `--profile`.
The full resolved profile and its digest are recorded. Fields:

- `seed`: seeded shape, shuffle, action and arrival randomness.
- `fixture`: number of groups; five `rosterMix` weights for sizes 1–5;
  `freshFraction`; `unlockFraction`; History events, additional snapshot writes
  and keys/member (0–3). Largest remainders make the roster counts exact before
  shuffling. `[1,1,1,1,6]` at 500 groups gives the contract's mixed 2,000 slots;
  1,000 groups with `[0,1,0,0,0]` gives its two-player layout.
- `catalogue`: synthetic chunks/tasks, bounded dependency depth and cross-links.
  Tasks use real engine `Tasks`, `Items`, `Skills` and `Chunks` requirements.
  JSON byte size, compiled catalogue count and shape digests are recorded. Counts
  do not establish equivalence to a private graph; calibrate against permitted
  aggregate measurements before interpreting this as a production target.
- `stages`: seconds, distinct logins (`users`), `activeGroups`, browser actions/s,
  plugin requests/s, sync previews/minute, `measured` and a required
  `classification`: `nominal`, `overload` or `recovery`. `measured: false`
  excludes warm-up regardless of classification. Active groups must have enough
  distinct roster logins. The step-up profile classifies 300/400 users as overload
  and the final five minutes as recovery.
- `rotationSeconds` (optional, default 300): replace the active cohort with the
  next population slice and reopen its streams. It is login/group churn, not an
  implementation of the missing picker-switch product operation.
- `requestDeadlineMs`: client deadline, 30,000 in supplied profiles; app deadlines
  remain unchanged. `maxClientInFlight`: client safety bound; overflow is recorded
  as a failed offered arrival, never silently queued away.
- `sampleSeconds`, `diskSampleSeconds`, `osReserveBytes`: telemetry cadence and
  the proposed memory-headroom comparison reserve.
- `upstreamScenarios`: deterministic uncached pairs of `ok`, `private`, `unknown`,
  `malformed`, `oversized`, `timeout`, `429`. Normal cache/coalescing still applies.
  A failure can be converted to plugin fallback by today's application; both
  fake-call counters and HTTP outcomes remain observable. Nominal uses success;
  smoke supplies varied responses but is too short to cover every scenario.

## Fixture and configuration boundary

The generator uses `firstLogin`, `ensureIdentity`, `reserveTransferMembers` and
`attachMembership`; `createGroupState`, engine catalogue construction,
`openStore`, `applyCommand` and durable store commands; dataset binding;
`openInviteStore.issuePickerSession`; and key-store creation/capability indexing.
It never authors registry, save, History archive, backup or authentication JSON.
Only harness manifests/reports are serialized by the harness.

Fresh groups retain empty progress. Grown groups unlock a broad surface, receive
private custom goals, synthetic skill/quest/item observations and rule variants,
then create a pinned replacement boundary, History and snapshot writes. Historical
fixture dates advance by 12 hours per write, ending around October 2026, so
ordinary retention can pack old preimages. Actual History/archive/snapshot counts
are recorded per group. A command's preimage is a retained snapshot: 1,000 History
commands plus 300 extra writes produces **at least 1,301 snapshots**, not exactly
300. Production retention (90 days and 1,000 active History entries) stays enabled.

### Bounded initial growth and realism trade

Initial unlocks use the existing real `replace-member` map-restore command,
once per member, followed by the same skill, custom-task, completion, plugin
observation and rule commands. Every command still crosses public `applyCommand`
validation. The harness adds its synthetic catalogue as before; `openStore`
fully validates the resulting seed before writing. There is no hand-authored
History, validator bypass, shared mutable group template or app change.

This bounds initial growth to `7 * rosterSize + 2` commands, at most 37,
independent of unlocked-chunk count. The supplied nominal/step-up shape uses
30 rather than 8,218 commands per grown group. Each batch and its inverse still
grow with chunk count, but the harness no longer replays an expanding chain of
thousands of unlock inverses on every unlock. A fresh group uses zero growth
commands. Reuse/re-keying is unnecessary with this existing command.

The trade is the initial action history: one batch map replacement and its Undo
per member replaces thousands of individual unlock actions and inverses. The
member progress, task catalogue, rule variants and observation dates match the
individual-command recipe. Logical fixture dates still advance by the original
unlock count. Initial revision numbers, History/archive content, preimage bytes
and state digests change. This fixture models imported grown maps followed by
normal edits, not a lifetime of individual manual unlocks. It therefore provides
no evidence for the cost of retaining/replaying that older unlock history.
The pinned replacement and all configured History/snapshot commands still run
independently through the real store with unchanged retention. Registry,
membership, sessions and keys still use their real APIs.

Fast deterministic tests compare gameplay against individual unlocks across
rosters 1–5 and all four variants, check batch Undo and rejection of malformed
batch state, and exercise progress boundaries/throttling/write failures with an
injected clock. They contain no elapsed-time assertions.

### Command CPU probe

```sh
node scripts/perf/capacity/command-cost.mjs --profile smoke --output /tmp/rs3-command-smoke
node scripts/perf/capacity/command-cost.mjs --profile nominal --output /tmp/rs3-command-nominal
```

The output directory must be new. `command-cost.json` contains every sample,
state byte size, roster size, catalogue count and actual History count;
`command-cost.md` is a short endpoint table. Three samples per cell follow one
untimed warm-up; `--iterations` accepts 1–10. There are no timing assertions,
server, network requests or durable writes. Every input has a genuine command
History/Undo chain and crosses the real validator with the complete catalogue.
Setup builds History before appending the inert catalogue to avoid charging
catalogue cloning to each setup action. The measured calls include it fully.

The matrix covers rosters 1–5, zero/half/maximum profile unlocks and
zero/half/maximum configured History events. `historyEntries` includes batch
growth events too. Each command changes a fresh copy of the same baseline;
samples do not grow that baseline. The commands are `set-chunk`, `set-note` and
`complete-task`. The script measures public `applyCommand` and the existing
storage-owned `applyValidatedCommand` boundary separately. **Live
`store.command` already uses `applyValidatedCommand`**, not the harness's public
full-clone entry point (`app/storage/store.mjs`, command execution). Its input
was validated at load, and it validates new gameplay/inverses. Public command
cost alone cannot establish live save latency. Neither CPU column includes
store serialization, retention, snapshot IO, hooks or HTTP/calculation work.

On Windows the probe permits only a tiny `smoke` profile (at most 64 chunks,
500 tasks and 20 History writes); use the same heavy-lock, priority and lease
rules as the runner. The checked-in `profiles/smoke-fixture.json` is a reduced
four-player shape, with 4 groups, 64 chunks, 500 tasks, 20 History writes and
10 additional snapshot writes. Pass its path to either CLI. Nominal/step-up
have identical fixture shapes; full-size command-cost and fixture estimates
must be calibrated on Linux before making live-capacity claims.

### Reduced measurement and generation estimate (2026-11-08)

One Windows run used Node 24.21.0 at BelowNormal priority under the shared
heavy lock, with `smoke-fixture.json`. The command probe and smoke ran
sequentially; each lock lease stayed below ten minutes. No full suite,
nominal/step-up fixture or repeated workload was run on the PC.
[The measurement JSON](capacity-smoke-measurement.json) retains all CPU samples,
resolved profile, source digests, per-group setup costs and the projection.
The source is base `15c6b86` with the batching/progress changes, identified by
the recorded working-tree digest. No capabilities or saves are published.

The probe covers 45 baselines and 270 command/boundary cells. It compiled 567
task rows from 500 synthetic challenges plus generated rows. Means below are
for the grown endpoint (32 unlocks per member, 20 note History events plus
one batch event per member); each cell has three samples after one warm-up.

| Roster | State KiB | Public chunk / note / task ms | Storage chunk / note / task ms |
| --- | --- | --- | --- |
| 1 | 60.0 | 5.157 / 5.672 / 5.439 | 0.248 / 0.122 / 0.155 |
| 2 | 61.0 | 5.781 / 6.148 / 5.823 | 0.278 / 0.271 / 0.221 |
| 3 | 62.0 | 9.872 / 8.263 / 5.759 | 0.289 / 0.246 / 0.231 |
| 4 | 62.9 | 6.875 / 5.275 / 4.766 | 0.308 / 0.432 / 0.206 |
| 5 | 63.9 | 4.352 / 5.114 / 4.542 | 0.411 / 0.194 / 0.262 |

These small-state results are noisy and non-monotonic. They show the cost of
the public validation boundary, but do **not** establish a save-size growth
rate or live capacity at 2,048 unlocks/member and 1,000 active History entries.
The Linux profile matrix is required to answer whether per-action CPU grows
materially at those sizes. The existing live storage boundary is substantially
cheaper in this reduced sample; optimizing public `applyCommand` alone could
miss the live bottleneck.

Fixture setup took **24.312 seconds**; the whole smoke took 58.919 seconds.
The fresh group took 1.612 seconds. Three grown groups took 4.453, 7.075 and
4.864 seconds, including 0.551, 1.162 and 0.093 seconds of in-memory growth.
Their durable phases (open, pinned replacement, 30 note writes, snapshot
preparation) took 3.275, 4.426 and 4.191 seconds. Each used 30 growth commands,
retained 31 real snapshots and finished with 31 active History entries.
The initial grown saves were about 106.3 KiB, versus 52.4 KiB fresh.

For **both nominal and step-up's 500-group fixture**, a write-count projection
is **17.54 hours**, with **14.53–19.56 hours** from the observed durable-phase
rate spread. The calculation uses 125 fresh and 375 grown groups, carries the
measured non-durable group overhead, and scales each grown durable phase by
`1301 / 31` (replacement plus configured note writes). Initialization is small
at this reduced size and excluded from that formula.

This is an optimistic **fixed-save-size scenario**, not a measured full-size
completion time or an upper bound. Nominal has 400 times the input challenges,
64 times the unlocked chunks and roughly 43 times the durable commands per
grown group. Serialization, gzip preimages, registry/file-count growth and
History packing can increase its per-write cost; the host/OS also differs.
For sensitivity, assigning *all* durable-phase cost the 400-fold challenge
increase produces about 289 days. That is not a forecast: the reduced sample
does not separate fixed filesystem latency from byte-dependent CPU/IO well
enough to choose between those models. Plan for at least day-scale setup,
then measure a full-shape fresh/grown subset on Linux before scheduling all
500 groups. Batching removes the observed unlock-chain blocker; it does not
remove the approximately 488,000 real durable writes or certify a short run.

The smoke drained 155/155 offered actions, with zero timeouts, client drops or
stream failures and a clean shutdown. Five rejections occurred during warm-up.
One measured Why action received an unintentional HTTP 409, correctly failing
`expensiveWarm` and `nominalAdmission`. Cheap latency and event-loop gates
passed. This observation is preserved without retry or an application change.
All 12 focused harness tests passed; complete CI and hosted stability remain
required before landing.

### Save-path follow-up proposal (requires owner approval)

Run the full command matrix and a full-shape grown-store subset on Linux,
separating command CPU, retained-inverse validation, serialization, gzip,
fsync and retention packing. Compare public `applyCommand` with the already
optimized storage-owned path before attributing live latency to full-state
validation. If the live path materially grows with save size, propose a
separate save-path change scoped to the measured work, preserving full
validation at load/import and equivalent validation/Undo/recovery guarantees
for writes. Obtain the owner's approval for that design before implementing
it. This PR changes no app code, limits, validation or retention.

Seeds reproduce catalogue/roster/progress/action shapes. Application-issued UUIDs,
session/key entropy and backup filenames remain intentionally random. The run
records logical plan, actual state and catalogue digests; reruns are not expected
to have byte-identical credentials or storage file names.

Setup uses offline APIs rather than rate-limited HTTP onboarding. This is a
separate setup mode, not timed server configuration. Proposed entity caps
`accounts=3000`, `pickers=3500`, `capabilities=20000` are explicit in the profiles
and used when reopening the registry. **All runtime traffic, body, stream, key,
context, calculator, prewarming, retention and admission/deadline defaults are
unchanged.** In particular, seven contexts, 64 global streams, 192 stored-key
admission budget and 128 plugin requests/s remain current-code limits. Offline
stored-key creation does not assert the HTTP key-creation budgets permit it.
The server owns an additional synthetic legacy context with two unowned slots;
reports count it separately from the target roster/logins.

## Traffic and metrics

Arrivals are stratified, seeded schedules independent of request completions.
They do not wait for an earlier action, group edit or plugin request. Plugin
kinds and five-second session checks cycle across clients with jittered arrivals;
browser actions select clients independently. There are no retries or raised
server timeouts. A request rejected during a product action ends that action;
multi-request actions are not silently restarted.

The browser action distribution follows the contract: 50% state/history,
20% task/group/How/Why, 15% note/check/skill edits, 5% switch, 8 1/3% expensive
(40% task misses, 30% Preview, 20% roll/accept, 10% pool/Undo), 1 2/3% lifecycle.
Task misses toggle a real rule before requesting tasks. Reported cache hit/miss
metadata determines what actually happened; requested misses are not certified
misses. Rolls use the real two-choice/accept path where the pool permits it and
one-choice direct commits otherwise. Empty pools remain explicit outcomes.
Ten percent of edit attempts deliberately use a stale revision; other 409s are
reported separately. Five-second session checks are additional offered actions.
Plugin traffic is 40% reports, 40% status, 20% tasks (100/s at 200 clients).
Reports carry synthetic skill/position observations, not an item journal replay.

| Metric | Meaning |
| --- | --- |
| `latencyMs` | Scheduled arrival to complete body/error/timeout; includes driver dispatch lateness, connection wait and server queues. |
| `startLagMs` | Client dispatch time minus scheduled arrival. Growing lag or client drops invalidates throughput claims. |
| `httpWallMs` | Actual action start to terminal completion; the difference from latency is client dispatch wait. |
| `requests[]` | Each underlying route, HTTP status, wall duration and available cache/evaluation/stage timing metadata. No response bodies or credentials. |
| `latency` / `successfulLatency` | Per-stage, per-operation empirical percentiles for all terminal outcomes / successes only. Sample counts accompany tails. |
| `validLatency` | Gate percentiles excluding intentional stale conflicts and explicitly unsupported actions; all unexpected failures remain included. |
| `unexpectedFailures` | Per-stage/action count of network errors and unexpected HTTP errors (including 500/502/504). 429/503, timeouts, deliberate 409s and unsupported actions have separate counters. Unintentional 409s are unexpected failures. |
| Cache counts | Observed response `cache.hit`, not an inference from route names. Unavailable cache classes stay unknown. |
| Server `memory` / `calculatorHeaps` | Writer RSS/heap/external bytes plus available calculator host/thread heap probes. RSS is not summed across threads. |
| Tree RSS/PSS | Linux process descendants' sampled resident/proportional bytes; PSS is null if unavailable. Windows has writer metrics only. |
| Tree CPU | Sampled lifetime user+system ticks, preserving last observations of retired processes; normalized to host logical CPUs. Short-lived between-sample processes can be missed; consult recorded cgroup `cpu.max` on constrained hosts. |
| Event-loop delay | Native writer histogram, p99/max per sampling window; the gate uses the worst window p99, not a fabricated whole-run percentile. |
| Queue/context | Private health `service.openContexts`, shared scheduler/lane queue depth/oldest wait, calculator diagnostics and cold-admission counters/latest pending/active/wait/service values. |
| Disk / IO | Recursive logical file bytes/count of this run directory; Linux per-process physical read/write bytes and swap. Disk includes retained stores and result logs. IO sums are sampled live processes, so retired-process totals can decrease. |
| Streams | Open/rejected/unexpected-ended connections by stage. Planned cohort replacement/abort is not a capacity disconnect. Streams are consumed but render/ack propagation is not measured. |

Telemetry uses two private operator HTTP reads and calculator heap probes per
sample, separately from offered product requests. Disk walks are less frequent
and never overlap. Arrivals and telemetry share one monotonic workload start,
captured after initial telemetry and driver preparation. Resource windows that
span stage boundaries, pre-run sampling and post-run sampling are retained but
excluded from gates. `elapsedMs` and `windowStartElapsedMs` describe that shared
clock; pre-run timestamps are null. The measurement-only worker preload reads
heap usage without forcing GC. `samples.jsonl` includes generator CPU/heap and active requests
to expose co-located load-generator contention. Telemetry failures are counted.
Cgroup files describe the containing cgroup, which may include the generator.

## Results and limits

`results.json` is the machine-readable profile/source/fixture metadata, time
series, action distributions, error/reject counts and gate verdicts. The source
commit and digest of app, library and harness bytes identify even an uncommitted
smoke run. `events.jsonl` retains **every** offered action, including dropped and
unsupported work. `samples.jsonl` preserves time series during interrupted runs.
`summary.md` lists the proposed gates and missing evidence. `server.log` and
`failure.json` explain setup/execution failure. A completed experiment exits zero
even when capacity gates fail; execution/setup failure exits nonzero. Inspect the
gate statuses, not just shell success.

`fixture.json` contains only synthetic local capabilities and stays mode 0600 in
the disposable directory; do not publish it. Results omit their values. No output
is committed automatically and no process is aimed at an existing server.

Warm latency, admission, CPU and event-loop gates use measured **nominal** stages
only; warm-up remains visible in raw/global counts. Any unexpected failure fails
admission and its applicable latency gate, even with fast responses. Admission
requires 429/503/timeouts below 0.1% of valid HTTP requests; intentional stale
409s are excluded from that denominator and from latency gates. Unsupported
actions are reported separately. Stream refusals and unexpected endings fail
admission independently.

`overloadObservations` reports overload counts and streams separately. Observed
429/503 are allowed with Retry-After; missing headers, unexpected errors,
timeouts, unplanned stream endings or an unclean server exit fail this check.
Overload latency and resource samples do not affect nominal gates. This check
does not establish fairness or bounded memory/disk/queues. `recoveryHTTP` applies
the nominal admission and cheap/expensive latency limits to recovery stages
alone; absent operation classes remain unmeasured. It does not measure the
instant nominal service returns. The full `overloadRecovery` gate remains
unmeasured pending five-minute time-to-recovery, fairness and fault experiments.

Every report remains **INCOMPLETE** or **FAIL** overall. Today's APIs do not
represent durable characters, multi-character logins, picker switching, the new
invitation/move/leave/handover lifecycle or Past maps; those offered actions are
explicit `unsupported` outcomes. Offline memberships represent one login per
slot and do not simulate 2,000 automatic solo defaults followed by consolidation.
Solo/3/4/5 rosters can be generated, but duo-only members/bank-start commands are
not extended or claimed as supported by this harness.

Browser rendering, ack-to-event propagation, item journal durability/replay,
fault/restart recovery, near-import-limit groups, off-site backup/capture overlap,
full graph calibration, fairness and five-minute recovery assertions need their
own acceptance experiments. Three independent 60-minute trials and a 12–24-hour
soak are still required by the proposed contract. No absent evidence gets a pass.

The fast pure checks are `tests/capacity-harness.test.mjs`, classified quick with
the first-line metadata consumed by `scripts/test-selection.mjs`. They use a
logical clock and held promises, not elapsed-time assertions, servers or retries.

Review-fix verification on Node 24.21.0: all five focused tests passed in one
run. One Windows smoke completed 139/139 arrivals and 156 HTTP requests, with
two warm-up rejections, zero measured 429/503s, zero timeouts/client drops/stream
failures and a clean shutdown. One intentional edit conflict was excluded;
one unintentional 409 from a Why request correctly failed `expensiveWarm` and
`nominalAdmission`, so the report was FAIL. Cheap latency and event-loop gates
passed. Setup took 4.1 seconds; the complete run took 33.9 seconds. No rerun or
application change was made to remove that observed conflict. Nominal, step-up
and Linux `/proc` telemetry were not run on the shared PC. Hosted stability and
full-suite checks remain CI work.
