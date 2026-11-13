# Sustained HTTP load experiment

This is the human-rate speed experiment that replaces a simultaneous 50-group
burst as the proposed speed evidence for launch. It drives the actual
`createServer` HTTP server, its router, file stores, process calculators and SSE.
It does not establish browser render time, usability, isolation or backup restore
correctness. Synthetic format-2 serving is available through a default-off
injected configuration. **Activation and character switching remain blocked.**
A passing format-1 comparison cannot approve format-2 launch.

The harness uses injected synthetic definitions/world, diagnostics, context-open and
admission observers. Memory and residency are separate explicit selections;
omitting both keeps the application's defaults. The scratch wrapper adds an
`x-capacity-server-id` response header and includes that random per-process identity in readiness and telemetry
IPC receipts. Synthetic offline
provisioning uses the existing proposed
entity caps (3,000 accounts / 3,500 pickers / 20,000 capabilities), just as the
earlier capacity profiles do. Those caps do not implement product account quotas.
No real saves, identities, providers, plugin clients, Platform or Hiscores calls
are used. The runner accepts only loopback HTTP and port 0 or 8900–8999.

## Format 2 prerequisites: stop at the activation boundary

There is no environment flag that enables format 2 for this server. Slice 7c
adds an explicitly injected, default-off configuration for owned contexts only.
`--format format2` now prepares and serves a synthetic format-2 fixture, including
`--fixture-only`; omitting it keeps format 1. Real-save use or deployment still
requires explicit approval (owner decision, 2026-11-11).

1. The fixture prepares a canonical synthetic catalogue base and independent
   release manifest
   from the **same prepared dataset and migration identities** as the runtime.
   It supplies the dataset pin, manifest, exact release bytes and external
   catalogue directory, kept outside picker/deletion trees. The existing
   building blocks are `app/storage/owned-base.mjs:buildOwnedBase`,
   `app/storage/owned-base-schema.mjs:createOwnedBaseManifest` and
   `app/storage/owned-storage.mjs:createPinnedStorage`. The lower-level acceptance
   harness in `scripts/perf/owned-acceptance/` is not HTTP server activation.
2. A verified, owned-picker-only configuration travels through
   `app/server.mjs:createServer`'s `openContext` into
   `app/picker-context.mjs:createPickerContext`, then into `openStore`.
   `app/storage/store.mjs:openStore` defaults `ownedFormat2 = false`;
   `createPickerContext` passes that option for owned contexts. Legacy stays in
   format 1. The fixture builder uses the requested physical storage format.
3. Load/command/import hooks prepare against the save's pinned dataset and
   identity base, with independently retained manifests across a restart.
   The selected process must already run that pinned dataset; another dataset
   refuses before preparation. The pinned catalogue supplies migration currency
   and identities rather than selecting a newer release's base.
   A base alone cannot reconstruct an older runtime's semantics. Existing
   `app/storage/owned-rebase.mjs` is a stopped-writer API, not startup activation.
   Enabled owned consumers filter retired obligations and display current names
   without rewriting saved rows or History/Undo.

These are the explicit boundaries in
[the calculator contract](../owned-calculator-contract.md),
[the acceptance contract](../owned-acceptance-contract.md) (last paragraph), and
[the rebase contract](../owned-rebase-contract.md). The
[serving contract](../owned-serving-contract.md) records slice 7c's configuration,
refusals and tiny HTTP/process-restart proof. Fixture configuration and seals
include the storage format and verify physical group documents/base pins;
format-1 fixtures cannot be relabelled as format 2. No real-save migration,
retirement/name-change rebase commit, browser negotiation or deployment is enabled.

Character switches have a separate product gap: no durable character entity,
multi-character login or authorized cross-picker switch exists. See
`docs/groups-and-accounts.md`, “Gaps against current code”, and
`scripts/perf/capacity/model.mjs:knownGaps`. The driver offers the switch share
and records `unsupported`, with a BLOCKED coverage verdict. It does not count a
same-member read or a different login as a character switch. Lifecycle actions
and the multiple-character login distribution also need later product work.

## Profile and arrival model

`scripts/perf/capacity/profiles/sustained.json` has 500 groups on disk, four
characters and three stored keys per character (2,000 slots, 6,000 keys).
Only a fixed 100-group cohort is active, with two clients per group, 200 clients
and one retained SSE per client. There is no whole-cohort rotation. Every prefix
keeps the configured 25% fresh / 75% grown mix. The catalogue has 23,939 tasks,
4,096 chunks, about 91,000 aliases and a 15.4 MB serialized-state calibration
target. Dependency depth four, cross-links two, unlock geography and alias
semantics are synthetic assumptions rather than a measured production mix.

Grown groups request 1,000 recent History edits and 300 snapshot-generating edits
through real stores. Existing retention, pinned replacement and packing stay
enabled. Because each command retains a preimage, this produces **at least 1,301
restore points**, rather than exactly 300; actual retention inventory is in the
fixture manifest/results. Fixing the application's retention semantics is outside
this harness. Fresh groups are not silently grown during fixture generation.

The initial 120 seconds stagger one authenticated cold state + task-list open
per active group. No browser, plugin, session or SSE traffic is offered in this
phase. Then 30 minutes of sustained traffic run without waiting for prior work:

| Offered source | Rate and actions |
| --- | --- |
| Browser product actions | 20/s: 50% state/history; 20% personal/group task views and How/Why; 15% note/tick/Undo; 5% unsupported character switches; 8⅓% expensive work; remaining 1⅔% Undo. Each includes resulting HTTP calls and session preflights. If fresh history has no reversible action, Undo first makes a real note edit; both acknowledgements count toward latency and amplification. |
| Heavy work | 100/minute, staggered over the fixed active groups: 40% task misses, 30% Preview, 20% roll/accept, 10% pool/Undo. Each group cycles through all four classes. Task misses advance a synthetic Attack level each pass to avoid alternating between two cached states; plugin Mining reports do not reset it. Report actual cache misses separately because concurrent views/prewarm can still share computation. Preview rotates valid candidates. Empty pools and conflicts remain visible failures, not successful heavy samples. |
| Plugin clients | 200 clients, each report every 5 s, status every 5 s, tasks every 10 s: 40 + 40 + 20 = 100 HTTP arrivals/s with stratified jitter. Monotonic per-key report sequence survives the server restart in the driver. Reports carry synthetic position/skill observations. This is not a multipart journal/replay or slow-client proof. |
| Idle session checks | One jittered check per login every 5 s, plus actual browser-request preflights, measured separately. |
| SSE | 200 long-lived connections, initial connection spread over 10 s, plus staggered planned disconnects every 5 min/client. Actual failures also reconnect with exponential backoff and Retry-After. Planned disconnects are distinguished from unexpected stream ends. |
| Web sync | 10 synthetic previews/minute; fake upstream transport prevents real API traffic. |

The replacement server is a new process using the same synthetic storage. One
graceful stop/restart occurs at workload second 1,020 (15 minutes into sustained
traffic), including a bounded 15-second stop fallback. A forced kill is reported
as a failed generator/control gate. Arrivals and the workload clock keep running
through shutdown, downtime and recovery; port 0 may select a new loopback port.
The harness updates its clients' scratch origin when the replacement announces
readiness. This tests process/store recovery, not a reverse proxy or real DNS.

Safe GETs use at most six attempts within their configured retry window, with
exponential jitter and the server's Retry-After as a minimum. Their original
arrival timestamp is retained. HTTP attempts have their own timeout. Writes
stay single-dispatch, including plugin reports: the next scheduled report has a
new sequence; ambiguous commands/rolls/accepts are never replayed. No revision
conflict is retried. Existing per-login route cooldowns are shared across
actions. This is a bounded synthetic reconnect policy, not a claim that every
current browser transport error retries automatically.

For five minutes after restart, independent staggered state + task readiness
probes revisit each active group every five seconds until its first valid success.
The recovery gate counts all **100 active groups**, including groups that never
recover, from the shutdown request (including any wait for in-flight telemetry).
Both state and tasks must identify the replacement process, and the tasks
revision must be at least the returned state revision. Successful responses
from a draining process are discarded and cannot suppress later probes, even
when the replacement reuses its port. The gate then requires healthy samples
showing all 100 resident together before the deadline, confirmed by a health
observation received **strictly after** the deadline and within two sampling
intervals. They must stay healthy and resident in every subsequent health
observation through the final post-workload health receipt. A later unhealthy
result invalidates recovery even after a successful confirmation; recovery
after the deadline cannot repair that verdict. Sampling gaps remain bounded.
This is stability as observed by periodic probes, not a claim about unobserved
instants between them. Serial visits through an eviction loop and transient
residency cannot pass. The other 400 resident disk groups remain
dormant. “All groups ready” here means the active workload cohort; this does not
prove that all 500 can open simultaneously. SSE recovery counts all 200 clients
by distinct group/member identity. A successful event-stream handshake records
its opening and closure times, serving process, and closure reason (planned
reconnect, cohort change, restart, workload end, or unexpected end). Every expected
client must hold an established replacement-process connection at the recovery
deadline and confirmation, lasting at least one sampling interval. A planned
reconnect handoff may span that boundary for up to one sampling interval (or
1.5 seconds, if larger, for normal reconnect jitter), provided its replacement
is live at confirmation. Unexpected ends cannot bridge that boundary, and
immediately closed handshakes cannot pass. Established streams must remain live
through workload stop, permitting the same bounded planned reconnect handoffs.
An unexpected end after confirmation invalidates recovery even if the client
later reconnects. Planned final disconnects happen at workload stop, before
SSE teardown/drain; their cleanup duration cannot extend the workload horizon.
Concurrent same-group edits may naturally return 409; those appear
separately in statuses and fail the relevant speed bar rather than being hidden.

`streamRecovery.rawReplacementCoverage` always reports distinct replacement
clients live at the recovery deadline and ever connected, plus both client-ID
lists. These raw observations do not depend on residency confirmation. The
existing `reopened`, continuity checks and pass/fail gate retain their meaning.

## Measurements and verdicts

Action receipts retain bounded `error` name/code/cause chains. Each HTTP attempt
has `requestId` and `actionId`; `sharedPreflights` records shared preflight IDs,
the owner action and coalescing. Failed actions can carry
`inheritedPreflightId`, `inheritedCooldownId` and `inheritedRequestId`, including
followers with no HTTP attempt of their own. A terminal timeout or inherited
503 remains that failure; it does not become an extra network-error attempt.
The scratch wrapper joins request IDs to `admissionTransitions[].requestId`
and returns the local admission ID in `requests[].admissionId`. Combine that
admission ID with the serving process identity/generation. Scheduler diagnostics
add `rejections.byReason`, `byKind` and `byReasonAndKind` on each lane; reasons
include `byte-cap`, `per-picker-outstanding`, `waiters`, `job-count` and
`kind-outstanding`. These counters do not alter admission.

`telemetry.jsonl` and `results.telemetryObservations` retain each IPC part with
its own receipt timestamp and sample ID, including late calculator heaps.
Main-isolate metrics, health and diagnostics no longer await heap probes.
`samples[].server.memoryObservation` identifies the main-isolate receipt;
health and diagnostics keep their existing independent observation fields.
Partial samples retain their available parts and `errorReasons`.
`telemetryErrorReasons` records collection errors and optional heap errors;
missing or failed optional heap observations do not increment
`telemetryErrors`. Heap data is now in `sample-heap` receipts' `calculatorHeaps`,
rather than being required on `samples[].server`. Only one heap collection runs
at a time; `HeapProbeBusy` records a skipped overlapping probe. Required receipt
coverage, gap rules and every acceptance bar are unchanged.

`--cpu-profile` opts the measured server children into Node's `--cpu-prof`,
writing profiles under the output's `cpu-profiles/`. Calculator host processes
inherit the flag; fixture children do not. The manifest's `cpuProfile` records
that scope. Calculator Worker isolates are **not** captured by this option:
their explicit heap-probe imports filter process-only flags. Retaining isolate
profiles across Worker retirement needs separate lifecycle-owned start/stop and
rotation; no product profiling lifecycle is added here. Profiling is off by
default and changes no acceptance threshold.

`--memory-profile default|budget-672` selects server memory caps independently
of the workload `--profile` and storage `--format`; omission means `default`.
The runner still forwards only its OS-variable allowlist. The child purges every
inherited `RS3_*` setting, then sets `RS3_MEMORY_PROFILE=budget-672` only for that
explicit selection. A default run sets no `RS3_MEMORY_PROFILE`, even if the
operator's shell has it or `RS3_SERVICE_CACHE_BYTES` set. Unknown selections fail
before output creation. Arbitrary environment overrides are never forwarded.

The application implementation of `budget-672` comes from **PR #213**, which is
separate from this harness change. The scratch checkout must include that change
before a budget-profile measurement can establish its effect. Its profile flag
selects the 704,643,072-byte service cache budget; this harness supplies the flag,
without implementing or inferring those caps. Before announcing readiness, each
server generation must report `memoryBudget` in its own health or diagnostics
HTTP output. A budget run requires `profile: "budget-672"` and `enforced: true`;
missing, disabled, custom or contradictory summaries refuse the run with
`memory-profile-unverified` and a nonzero exit, before measured traffic starts.
Default runs require `enforced: false` when a summary exists; an absent summary
is recorded as `unavailable` and is acceptable for default only. Every retained
sample is rechecked, so a replacement process or later contradictory observation
cannot inherit earlier proof. Format-2 synthetic serving is already on main
through **PR #215**; it does not depend on #213.

At `origin/codex/f2-memory-budget` commit `30725f30`, #213 constructs the budget
internally but **does not expose it over health or diagnostics HTTP**. The
minimal required addition there is `memoryBudget` in the scheduler's
`getDiagnostics()` return value, using the actual budget object constructed for
that scheduler. `app/picker-context.mjs` already spreads those diagnostics into
the authenticated `GET /api/diagnostics` body, which would expose
`diagnostics.memoryBudget: { profile, enforced, totalBytes, ... }` to this runner.
Alternatively, expose that same effective object as `health.memoryBudget` or
`health.service.memoryBudget`. Recomputing a budget from the requested environment
inside the harness is not proof and is deliberately refused. Until #213 exposes
one of these summaries, its budget runs fail this check too.

`profile.json`, `run-manifest.json`, `setup-summary.json` / `failure.json`,
`results.json`, action/HTTP receipts in `events.jsonl`, and telemetry receipts in
`samples.jsonl` distinguish the requested profile from a verified applied
`memoryProfile`. Before verification (including fixture-only setup), and on a
verification failure, the manifest keeps `requestedMemoryProfile` while
`memoryProfile` is null. No measured result or speed report is published for an
unverified run. Offline reports also label failed proof as `unverified` and fail
the profile and speed gates. The manifest's `profileDigest` includes the selection.
Reports label verified selections and compare them with the speed bars
below independently: **both profiles must meet the same bars**. The report
evaluator rejects missing or contradictory labels and mixed-profile operations,
readiness, restart or telemetry receipts; results from the two profiles cannot
be combined into one verdict. Historical unlabelled runs need fresh evidence.

Every server sample retains the actual health/diagnostics responses and an
`effectiveCaps` summary of their exposed memory/cache fields. The report includes
one such receipt per process generation, including its independent HTTP receipt
times. Main already exposes calculator cache entry/byte limits and cache usage;
it does not expose a complete service memory budget. Missing summaries are
explicitly `unavailable`; usage is never converted into an invented cap.
#213 can add richer summaries without changing this collection rule.

Every product receipt measures **scheduled arrival to full HTTP completion**,
including dispatch lag, preflights, HTTP amplification, queue time, client
cooldown and retries. A slow server never reduces offered arrivals. The bounded
client-in-flight cap records dropped arrivals and fails the generator gate.
Phase labels separate cold-open, before-restart, restart-recovery and
after-recovery observations. Each action/phase has p50/p95/p99, terminal statuses,
HTTP-attempt status counts and raw refusal Retry-After histograms.
Session checks sharing an in-flight preflight record a confirmed coalesced check
only after that HTTP request succeeds; zero-request completions need that proof.

Observation times are local monotonic **receipt times**, captured before any
unrelated collection or callback work. `collectedAt` records persistence assembly
time only and never supplies recovery, coverage or phase evidence:

| Observation | Timestamp and window used |
| --- | --- |
| Health and residency | Dedicated health IPC receipt, sent immediately after the health HTTP body arrives, before heap probes. The gate uses `server.healthObservation`, independently of the final memory snapshot receipt. |
| Queue depth | Dedicated diagnostics IPC receipt in `server.diagnosticsObservation`. Coverage follows these receipts, not later memory or disk collection. |
| Server memory and event loop | Final server IPC receipt; the event-loop window spans successive server receipts. |
| Process tree and CPU | Process-tree return receipt and the interval between successive tree receipts; CPU delta uses that same interval. CPU/event-loop windows spanning stage boundaries are excluded from stage resource bars. RSS uses each source's instantaneous receipt. |
| Disk | Scan return receipt. A cached disk reading retains its original receipt and phase when reused. |
| Client and SSE | Client counters are stamped before requesting server telemetry. SSE header/open and body-end receipts are captured before notification/cleanup callbacks. Attempt starts and handshake receipts have separate per-stage counters; receipts outside configured stages stay in `tailStreams`. |
| State/tasks and restart readiness | Each completed HTTP body and the replacement's ready IPC have their own receipts. Composite readiness uses the later body receipt, retaining both; it cannot inherit later processing time. |
| Workload horizon | `workloadCompletedAt` is captured when scheduled work finishes; `streamShutdownAt` marks the start of planned SSE shutdown. `completedAt` includes teardown and cannot establish offered workload duration. |

The `run.mjs`/`driver.mjs` await sweep also checked context-open/admission IPC
events (already stamped in their handlers), restart placeholders (stamped before
log writes), and setup/total durations (deliberately end-to-end completion
durations). Action latency still includes all completion work and uses the
**scheduled arrival phase**, as required for open-loop comparisons. Observation
phase labels and deadline/coverage gates use each observation's own receipt.
Missing or inconsistent receipt metadata fails validation; collection completion
is never a fallback timestamp.

| Speed bar | PASS requires |
| --- | --- |
| Everyday | Every planned action/phase completes, with valid p50/p95/p99, p95 < 300 ms, and no terminal failures. |
| Heavy | All four expensive classes complete every planned action/phase, p95 < 3,000 ms, and no terminal failures. Actual task-miss coverage requires one successful cache-miss action per intended miss, not an aggregate of failed/repeated attempts. |
| Cold open | One successful initial-process state + tasks readiness open for each distinct active group, p95 < 2,000 ms. Initial requests include HTTP queuing and client retries. |
| Restart | Exactly one clean restart; distinct active groups return current replacement-process state/tasks before 300 seconds and remain healthy/resident through the final post-workload health receipt, with genuine post-deadline confirmation. Smoke uses a 30-second recovery window. |
| Plugin / sync | Configured report, status, tasks and sync classes must complete every planned action/phase without terminal failures. Their p95 is reported per phase; browser latency limits do not apply. |
| SSE recovery | Every expected client holds established replacement-process streams at the deadline and confirmation, maintained through workload stop. Bounded planned reconnect handoffs require live replacements; later unexpected ends fail. |
| Generator / controls | Explicit unforced exit-code-zero receipts with no signal for both shutdowns; no drops or telemetry errors; complete offered/completed/skipped accounting and full run duration; valid memory, queue and event-loop time series from both generations. Gaps may not exceed twice the larger of the sampling interval and five-second telemetry IPC timeout. Restart placeholders are allowed only during stop/start. |
| Refusal headers | HTTP and SSE 429/503 totals reconcile with nonempty, valid Retry-After histograms, including cold opens. Missing counters or observations cannot stand in for zero refusals. |

Refusals, timeouts and failures remain in latency distributions. An all-refusal
run cannot pass because its responses are fast. Missing classes fail, and blocked
format/switch coverage prevents a launch claim even when measured speed bars pass.
This experiment applies the tighter user-requested bars above; older proposed
1-second/15-second bars in `groups-and-accounts.md` do not override them.

`events.jsonl` retains every executed arrival and all its HTTP attempts, response
cache class/timing, command and revision observations. `results.json` includes
per-phase distributions, fixture/source/configuration digests, open phase
timings and memory snapshots, admission transitions and restart/recovery data.
`samples.jsonl` records RSS/heap/external/arrayBuffers, event-loop delay and
utilization, diagnostic calculator queues, cold-open pending/active depth,
residency, Linux process-tree CPU/memory and generator CPU/memory/in-flight work
every five seconds. Context/admission events have a server generation and
parent-observed elapsed time, so child process clock resets are unambiguous.
Sampling gaps during restart are explicit; missing ordinary telemetry fails.

The report is `summary.md`; inspect `results.json` for complete metrics. The
runner exits zero when the experiment completed even if speed gates fail;
automation must read the gate verdicts. A harness failure writes `failure.json`
and exits nonzero. These files include synthetic credentials in `fixture.json`;
retain full artifacts locally and share only reviewed summaries.

With `--memory-profile default --residency default`, runtime limits still include 7 resident contexts
(legacy included), 64 global streams, one concurrent cold open and 192 global key admissions.
They may refuse this workload. No proposed higher limit is silently enabled to
make the graph pass. The opt-in selection requests the application's budget
profile instead. `profile.json`, exact source/tree digest and health/diagnostic
samples bind each run to its settings. If another track changes defaults, reuse
the same compatible sealed fixture and compare both reports; the server source
and fixture source are recorded independently.

## Opt-in residency trial

`--residency default|trial` defaults to `default`, which injects no residency
overrides. The independent `--memory-profile` option retains its current default.
The trial implements the proposed limits in [groups and accounts](../groups-and-accounts.md),
rows `coldStartsPerAccount / Global`, Router `maxOpenContexts / idleCloseMs`,
and Cold admission `maxPending / perAccount / deadlineMs`:

| Effective limit | Default | Trial |
| --- | --- | --- |
| Open contexts, including legacy | 7 | 128 |
| Idle close | 600,000 ms | 600,000 ms |
| Concurrent cold opens per account / global | 1 / 1 | 1 / 4 |
| Cold admission pending / per account | 64 / 2 | 256 / 2 |
| Cold admission deadline | 2,000 ms | 30,000 ms |

These are scratch-server injections, with no environment variable or production
default change. The longer deadline does not relax cold latency gates. The
server's admin diagnostics report the effective router, picker-limits and cold
admission values. Before measured traffic, and again after restart, the harness
requires those observed values to match the request; missing or mismatched
evidence fails with `residency-unverified`. Telemetry and final verdicts retain
the same check. The run manifest, `results.json` and `summary.md` record requested
and observed residency beside memory selection, including each server generation.
Different residency selections cannot be combined into one verdict. Historical
unlabelled artifacts supply no verified residency claim.

Reuse an intact stored format-1 fixture on the scratch host with this exact command
(the output directory must be new):

```sh
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --fixture-workers 14 \
  --residency trial --memory-profile default \
  --fixture-from /srv/scratch/sustained-results/fixture-f1 \
  --output /srv/scratch/sustained-results/run-f1-residency-trial
```

Residency selection changes the run digest, while leaving the fixture-content
digest unchanged. Keep default and trial reports separate, even when they use
the same fixture and memory selection.

## Sealed fixture reuse across code versions

`--fixture-from` accepts a different implementation digest. It still requires a
complete schema-1 seal, the requested fixture-content configuration and a matching
or proven evidence-only dataset digest and format label, the exact file inventory
(including sizes and `modifiedMs`),
every file checksum, the logical fixture digest, and the physical group storage
format. Format 2 also verifies the retained catalogue release and requires its
owned base pin and bytes to match what the current runtime prepares. These
checks run before a measured server starts. Running new server code on older
compatible saves models the deployment case; a server-only change does not
require rebuilding 500 groups.

Rebuild when the content configuration changes (seed, catalogue shape, fixture
population/growth/history/keys, entity caps, dataset inputs or format), the
application's writer schema changes, the synthetic builder's output changes, or
the format-2 runtime's canonical owned base changes. Writer schemas come from
`SCHEMA_VERSION`, `COMPLETION_BACKUP_VERSION`, and, for format 2,
`OWNED_STORAGE_SCHEMA_VERSION`, `OWNED_BASE_FORMAT` and
`OWNED_BASE_GENERATOR_VERSION`. Flat static-field metadata has no exported
application constant; its writer version is recorded explicitly as `flatStatic`
and tested with a tiny fixture large enough to use static fields.
The separate `fixtureContentVersion` covers
builder semantics with no application version constant: plan/catalogue generation,
growth commands, migration/identity preparation and retention output. Tests pin
the deterministic output of tiny fresh/grown fixtures for both formats to that
version; an output change requires advancing it and adding a new golden. Keep
the old golden as the historical content-version definition. The goldens cover
logical saved states/History, revisions, retention, roster/key counts, task
identities and physical document schemas; random credentials, file names and
setup timings are excluded. Ordinary traffic, memory-profile, reporting and
server changes leave that version alone. Damaged,
incomplete or relabelled fixtures are refused; restore an intact original or
rebuild rather than editing its seal.

Original seals from format-1 main `12f402c2` and format-2 main `0a543b7e`
remain valid without resealing when the dataset matches. Missing content/schema
metadata means the original content version 1 and historical writer versions
(state 1, completion 2, flat static 1; owned 2,
base 1, base generator 1 for format 2). New seals add `fixtureContentVersion`,
`storageSchema`, and `sourceCommit` when the builder receives it (the runner
supplies it). The existing seal `schemaVersion` stays 1.

For format 1, an evidence-only dataset update can reuse the fixture. The same
production proof must reconstruct the old digest with the running dataset's
identical input records, id/contract, capabilities, overlay order and definition
overlays. New fixture manifests retain `datasetEvidence`. A sealed
`legacy/dataset-evidence.json` can also supply old records. An old seal or source
commit alone cannot prove compatibility. With a retained operator evidence
history for that exact old digest, pass
`--fixture-evidence-from /absolute/store-or-evidence-directory` alongside
`--fixture-from`; the reader uses that directory's `dataset-evidence.json` and
checks the same cryptographic proof. It never writes that directory. Without a
matching proof, an original `12f402c2` fixture with digest `6e8cefd8…` is refused
by a different running dataset, even if its only actual changes were evidence.
Never edit an old source seal to bypass this check.

The harness first verifies every source byte and copies it with historical
mtimes. Only the copy is opened through production owned-picker preparation and
the normal store migration: each picker receives a preimage backup, one revision
increment and a `catalogue-refresh` event. The copy receives the new dataset
stamp, updated logical metrics and its own new completion seal. The original
source remains byte-identical and its seal remains valid. Input changes and
unprovable stamps fail closed. Format 2 still requires its explicit base rebase;
this option cannot change an immutable base pin.

The run manifest, `results.json` and `summary.md` report exact implementation
reuse or reuse across versions, the fixture implementation digest, the current
implementation digest, and the fixture source commit when recorded. Reuse also
records `fixtureReuse.datasetTransition`: old/new digests, what was applied,
refreshed-picker/backup/revision/event counts, and original/upgraded logical
fixture digests. Exact dataset reuse records `applied: none`. Fixture-only runs
carry this receipt in `run-manifest.json` and `setup-summary.json`. Old runner
fixtures can supply that commit from their original `run-manifest.json`; absent
provenance is explicitly unknown. `fixtureDigest`, the fixture-content digest,
remains the comparison key between runs. The current run's source commit/tree
digest continues to identify the measured server code.

Fixture content version 2 adds a final production retention pass at the serving
wall clock, after generation or verified copying and any evidence-only refresh.
Version-1 sources remain accepted and immutable; only the working copy is opened
and receives its own manifest and seal. `retentionNormalization` in `fixture.json`
and, for reuse, `fixtureReuse.retentionNormalization` records the pass timestamp,
per-store metadata-selection candidates before/after, validated standalone
removals (`packedSnapshots`) and archive pack counts. Candidates precede document
pin checks, so pinned candidates can correctly remain. Normalization can change
physical retention layout and the logical fixture digest. Compare the recorded
digest and normalization receipt when attributing results. The deterministic
format-1/format-2 aged-store regressions still require actual validation/packing;
the unchanged-clock pass then has zero candidates. Original version-1 goldens
remain the historical definition; the tiny version-2 goldens retain that same
output because none of their backups age beyond the policy.

Progress JSON is informational and written in place, serialized by the builder.
A concurrent reader can see an incomplete progress write; the completion seal,
inventory and checksums are the authority for reuse.

Keep the sealed source immutable. The harness verifies and streams copies into
the new output directory, preserves file mtimes, then runs the measured server
only on that copy. It never opens a source store or reseals the source. Output
trees overlapping the source are refused, including directory aliases. A fixture
may live on a separate disk: pass that directory to `--fixture-from` directly;
there is no need to first copy it beside the checkout. **Preserve file modification
times when storing, transferring and restoring a fixture** (for example, use an
archive or copy tool that retains mtimes). The inventory compares `modifiedMs`,
and retention uses historical ages. Preserve the original seal and, for old
fixtures, the original run manifest alongside its managed files.

## Exact scratch-host commands

Use an already rented, isolated Linux scratch host with 16 vCPU / 32 GB RAM,
local writable disk and **Node 24.20.0 or newer 24.x already installed**. No npm
dependencies or cloud APIs are needed. Allow at least 100 GB free disk for the
sealed fixture, its measured-run copy and logs; the earlier larger-catalogue
fixture was about 22 GB. Keep other load off the host. The generator shares this
host, so inspect its utilization before attributing a failure solely to the app.

Before transferring source, export this committed branch locally (PowerShell,
from the worktree). Include both this harness change and #213 with the HTTP
summary described above before export, using the same commit for both measurements. These commands use
the implementation branch name; if integrating into another branch, replace that
name in both bundle and clone commands. This is a local Git bundle, not a push:

```powershell
New-Item -ItemType Directory -Force .local/sustained | Out-Null
git bundle create .local/sustained/sustained.bundle perf/load-memory-profile
git bundle verify .local/sustained/sustained.bundle
```

After the operator transfers that bundle to the scratch host as
`/srv/scratch/sustained.bundle`, run the following there. All output directories
must be new. These commands do not provision or contact a host:

```sh
cd /srv/scratch
git clone --branch perf/load-memory-profile ./sustained.bundle picker-sustained
cd picker-sustained
node --version
git rev-parse HEAD
mkdir -p /srv/scratch/sustained-results

# Once: build and seal the synthetic 500-group format-1 fixture.
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --fixture-workers 14 --fixture-only \
  --output /srv/scratch/sustained-results/fixture-f1

# Default caps: verify/copy the sealed fixture, then cold opens + 30 minutes.
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --memory-profile default --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f1 \
  --output /srv/scratch/sustained-results/run-f1-default

# Immediately after the first run exits, on this same host and source.
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --memory-profile budget-672 --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f1 \
  --output /srv/scratch/sustained-results/run-f1-budget-672

cat /srv/scratch/sustained-results/run-f1-default/summary.md
cat /srv/scratch/sustained-results/run-f1-budget-672/summary.md
```

Expected durations are planning estimates, not measurements of this new profile:
budget **about four hours for fixture generation**, plus **32 minutes of
scheduled load per measured run**, fixture verification/copy (allow roughly
5–15 minutes on local SSD per copy), and up to a few minutes for pending
HTTP/backoff/shutdown drain. Reserve about **5 h 40 min total for the back-to-back
pair** initially and inspect `fixture-progress.json` rather than interpreting a
long history/retention phase as a hung run. A previous
500-group, 14-worker, larger-catalogue run took 227 minutes for setup; the new
23,939-task plus alias/state calibration has **not** been timed at full scale.
It may exceed this budget. `setup-summary.json.setupSeconds` and per-group setup
timings provide the actual fixture cost; the measured run's `setupSeconds`
includes verified copying. Both profiles copy the same sealed fixture; memory
selection changes the run digest but not the fixture-content digest. Reuse
follows the compatibility rule above and preserves historical mtimes across
storage/restore and measured-run copying. Never use a previously measured/mutated
run as the reusable fixture.

For a synthetic format-2 comparison on this branch, prepare a separate fixture
and two separate run directories, again back to back on the same host. Preserve
the format-1 results; its fixture cannot be reused
or relabelled as format 2. These scratch-host commands enable only the synthetic
owned fixture. Real-save use and deployment remain at the owner approval boundary.

```sh
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format2 --fixture-workers 14 --fixture-only \
  --output /srv/scratch/sustained-results/fixture-f2

nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format2 --memory-profile default --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f2 \
  --output /srv/scratch/sustained-results/run-f2-default

nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format2 --memory-profile budget-672 --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f2 \
  --output /srv/scratch/sustained-results/run-f2-budget-672

cat /srv/scratch/sustained-results/run-f2-default/summary.md
cat /srv/scratch/sustained-results/run-f2-budget-672/summary.md
```

The fixture retains its release manifest, exact release bytes and published base
in its external `catalogue/` directory. Verification and copying include that
directory, so the replacement server reloads the same independent trust inputs.
No full-scale format-2 timing or disk-size estimate has been measured.

## Local verification

`sustained-smoke` is the only added Windows profile: two groups, four clients,
32 tasks, 120 seconds total (10 cold + 110 sustained), one restart at 65 seconds,
planned SSE reconnects and a 30-second recovery budget. Run it only once under
the repository's shared heavy lock at BelowNormal priority, on port 0. The
profile itself enforces the tiny Windows fixture/rate limits. Focused unit tests
are in `tests/capacity-sustained.test.mjs`; they use logical timestamps and fake
waits, with no machine-timing assertions. Also run `capacity-harness.test.mjs`
and `capacity-realism.test.mjs` for the reused client/scheduler/observer contracts.

One local smoke was run on 2026-11-11 with Node 24.20.0, BelowNormal priority,
the shared lock and an assigned port. The workload lasted 120 seconds; setup was
10.38 seconds and total process time was 140.83 seconds. The source base was
`daa221d931ef6dd1c4dd725821ecf0e80faf071c`; the measured source-tree digest was
`6712ca219d34e8db2d807b8576b77f74e5cd342752b6704723c0e4d108a85f63`.

| Smoke observation | Result |
| --- | --- |
| Arrivals / HTTP attempts | 464 scheduled; 456 executed plus 8 already-ready recovery probes skipped; 764 HTTP attempts. |
| Refusals / timeouts / dropped arrivals | 3 HTTP 429/503 refusals; 0 timeouts; 0 drops. SSE separately had 1 refused handshake. |
| Cold-open p95 | 221.0 ms for two groups, PASS. |
| Restart readiness | First successful state/tasks for both groups by 7.66 s; a sample confirms both resident together at 9.38 s, PASS within the smoke's 30-second limit. |
| SSE recovery | All four clients reopened by 8.15 s, PASS. |
| Everyday / heavy speed | FAIL: recovery-phase p95s reached roughly 4.3–4.5 s; two Why reads returned revision-conflict 409; a later note took 780 ms. |
| Intended task misses | 3 observed misses / 4 intended, FAIL. One action reused a cached alternating rule state. |
| Telemetry / controls | 0 telemetry errors; clean restart and final shutdown; lock released; no owned child remained. |
| Coverage | Six unsupported character-switch arrivals; format 2 BLOCKED. |

The smoke exposed a harness realism issue: alternating two rule states can reuse
old cached calculations, and choosing both action and group from the same
ordinal permanently assigns one heavy class to each group. The final driver
advances synthetic Attack input each pass and rotates heavy classes per group;
deterministic tests cover both corrections. It also records SSE handshake
timings/refusal headers and explicitly classifies the planned server restart's
disconnects, and prepares a reversible note for Undo on empty fresh history.
These post-smoke changes were verified with focused tests, **without
a second smoke run**. The original smoke artifacts are preserved, including
its original verdicts; the 9.38-second residency result is a stricter offline
evaluation of its existing samples. A tiny fixture is a protocol/driver smoke,
never a capacity acceptance result.

Initial implementation verification passed **36 cases in three files**:
`tests/capacity-sustained.test.mjs` (8), `tests/capacity-harness.test.mjs` (16),
and `tests/capacity-realism.test.mjs` (12), using Node 24.20.0, their complete
`testRunPolicy` environments, `--test-concurrency=1`, BelowNormal priority and
the shared lock for the combined run. The reused SSE regressions caught and
verified a correction to handshake observation with injected headerless test
responses. Syntax checks, `git diff --check`, and the then-required CLI format-2
refusal before output creation also passed at that harness revision. Slice 7c
replaces the refusal with the synthetic serving proof above. No full suite or
hosted CI ran.

PR #211 gate review added four regressions for replacement-generation readiness,
failed/missing plugin and sync work, signal exits, and immediately closed SSE.
The gate sweep added twelve regressions covering incomplete latency/completion,
confirmed session coalescing, phase evidence, duplicate/missing cohort identities,
invalid stream lifetimes,
stale task revisions, transient/unhealthy residency, aggregate cache-miss masking,
missing telemetry/accounting/truncated duration, isolated telemetry snapshots,
incomplete Retry-After evidence, and non-SSE HTTP 200 responses. The existing
real-server capacity test also checks the scratch identity response header.

The first review-fix verification passed **52 cases in the same three files**: sustained
(24), harness (16), realism (12), with zero failures or skips, Node 24.20.0,
complete `testRunPolicy` environments, one worker, BelowNormal priority and the
shared lock. No new smoke, full suite, or hosted CI ran. Historical smoke artifacts
are unchanged; they lack the new process/lifetime/accounting receipts and cannot
satisfy the hardened gates or establish recovery under the new rules.

The observation-timestamp follow-up adds the delayed healthy-receipt regression
and nine sweep regressions: independent health/heap receipts, later unhealthy
health observations, receipt validation/coverage, resource windows and cached
disk/CPU timing, SSE callback receipts, cross-stage SSE counts, later unexpected
SSE closure, HTTP/restart readiness receipts, and the pre-teardown workload
horizon. All use logical clocks, without machine-timing assertions.

Timestamp verification passed **62 cases in three capacity files**: sustained
(34), harness (16), realism (12), with zero failures or skips, using Node 24.20.0,
complete `testRunPolicy` environments, BelowNormal priority, the shared lock and
`--test-concurrency=1`. No new smoke, full suite, or hosted CI ran. Application
source and admission behavior are unchanged; only scratch-harness observation
collection, evidence validation and reporting changed.

Slice 7c preserves those receipt timestamps and evidence gates while adding
default-off synthetic owned format-2 serving. Its format coverage uses the same
distinct-group and process/receipt proofs; it cannot replace speed, resident-cohort,
telemetry or generator evidence. The historical smoke remains format 1. No
format-2 sustained speed result, full suite or hosted CI is claimed.
