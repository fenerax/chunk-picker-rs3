# Sustained HTTP load experiment

This is the human-rate speed experiment that replaces a simultaneous 50-group
burst as the proposed speed evidence for launch. It drives the actual
`createServer` HTTP server, its router, file stores, process calculators and SSE.
It does not establish browser render time, usability, isolation or backup restore
correctness. Synthetic format-2 serving is available through a default-off
injected configuration. **Activation and character switching remain blocked.**
A passing format-1 comparison cannot approve format-2 launch.

The harness uses injected synthetic definitions/world, diagnostics, context-open and
admission observers. Existing runtime admission/residency/calculator defaults
remain enabled. The scratch wrapper adds an `x-capacity-server-id` response
header and includes that random per-process identity in readiness and telemetry
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

## Measurements and verdicts

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

Default runtime limits still include 7 resident contexts (legacy included),
64 global streams, one concurrent cold open and 192 global key admissions.
They may refuse this workload. No proposed higher limit is silently enabled to
make the graph pass. `profile.json`, exact source/tree digest and health/diagnostic
samples bind each run to its settings. If another track changes defaults, use a
fresh fixture from that exact source and compare both reports.

## Exact scratch-host commands

Use an already rented, isolated Linux scratch host with 16 vCPU / 32 GB RAM,
local writable disk and **Node 24.20.0 or newer 24.x already installed**. No npm
dependencies or cloud APIs are needed. Allow at least 100 GB free disk for the
sealed fixture, its measured-run copy and logs; the earlier larger-catalogue
fixture was about 22 GB. Keep other load off the host. The generator shares this
host, so inspect its utilization before attributing a failure solely to the app.

Before transferring source, export this committed branch locally (PowerShell,
from the worktree). This is a local Git bundle, not a push:

```powershell
git bundle create .local/sustained/sustained.bundle codex/f2-serving
git bundle verify .local/sustained/sustained.bundle
```

After the operator transfers that bundle to the scratch host as
`/srv/scratch/sustained.bundle`, run the following there. All output directories
must be new. These commands do not provision or contact a host:

```sh
cd /srv/scratch
git clone --branch codex/f2-serving ./sustained.bundle picker-sustained
cd picker-sustained
node --version
git rev-parse HEAD
mkdir -p /srv/scratch/sustained-results

# Once: build and seal the synthetic 500-group format-1 fixture.
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --fixture-workers 14 --fixture-only \
  --output /srv/scratch/sustained-results/fixture-f1

# Verify/copy the sealed fixture, then cold opens + the 30-minute workload.
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format1 --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f1 \
  --output /srv/scratch/sustained-results/run-f1

cat /srv/scratch/sustained-results/run-f1/summary.md
```

Expected durations are planning estimates, not measurements of this new profile:
budget **about four hours for fixture generation**, plus **32 minutes of
scheduled load**, fixture verification/copy (allow roughly 5–15 minutes on local
SSD), and up to a few minutes for pending HTTP/backoff/shutdown drain. Reserve
about **4 h 50 min total** initially and inspect `fixture-progress.json` rather
than interpreting a long history/retention phase as a hung run. A previous
500-group, 14-worker, larger-catalogue run took 227 minutes for setup; the new
23,939-task plus alias/state calibration has **not** been timed at full scale.
It may exceed this budget. `setup-summary.json.setupSeconds` and per-group setup
timings provide the actual fixture cost; the measured run's `setupSeconds`
includes verified copying. Reuse requires the exact same implementation/config
digest and preserves historical mtimes. Never use a previously measured/mutated
run as the reusable fixture.

For a synthetic format-2 comparison on this branch, prepare a separate fixture
and run directory. Preserve the format-1 results; its fixture cannot be reused
or relabelled as format 2. These scratch-host commands enable only the synthetic
owned fixture. Real-save use and deployment remain at the owner approval boundary.

```sh
nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format2 --fixture-workers 14 --fixture-only \
  --output /srv/scratch/sustained-results/fixture-f2

nice -n 10 node scripts/perf/capacity/run.mjs \
  --profile sustained --format format2 --fixture-workers 14 \
  --fixture-from /srv/scratch/sustained-results/fixture-f2 \
  --output /srv/scratch/sustained-results/run-f2

cat /srv/scratch/sustained-results/run-f2/summary.md
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
