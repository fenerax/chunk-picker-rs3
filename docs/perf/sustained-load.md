# Sustained HTTP load experiment

This is the human-rate speed experiment that replaces a simultaneous 50-group
burst as the proposed speed evidence for launch. It drives the actual
`createServer` HTTP server, its router, file stores, process calculators and SSE.
It does not establish browser render time, usability, isolation or backup restore
correctness. **Format 2 serving and character switching are blocked.** A passing
format-1 comparison cannot approve format-2 launch.

No application source or behavior changes are included. The harness uses
existing injected synthetic definitions/world, diagnostics, context-open and
admission observers. Existing runtime admission/residency/calculator defaults
remain enabled. The scratch wrapper adds an `x-capacity-server-id` response
header and includes that random per-process identity in readiness and telemetry
IPC receipts; production application code is unchanged. Synthetic offline
provisioning uses the existing proposed
entity caps (3,000 accounts / 3,500 pickers / 20,000 capabilities), just as the
earlier capacity profiles do. Those caps do not implement product account quotas.
No real saves, identities, providers, plugin clients, Platform or Hiscores calls
are used. The runner accepts only loopback HTTP and port 0 or 8900–8999.

## Format 2 prerequisites: stop at the activation boundary

There is no environment flag that safely enables format 2 for this server.
`--format format2` deliberately refuses **before output creation, fixture setup
or server startup**, including `--fixture-only`. Do not patch a loader or force a
store flag to obtain a result. Minimum missing serving work is:

1. Prepare a canonical synthetic catalogue base and independent release manifest
   from the **same prepared dataset and migration identities** as the runtime.
   Supply its dataset pin, manifest, exact release bytes and external catalogue
   directory; keep that directory outside picker/deletion trees. The existing
   building blocks are `app/storage/owned-base.mjs:buildOwnedBase`,
   `app/storage/owned-base-schema.mjs:createOwnedBaseManifest` and
   `app/storage/owned-storage.mjs:createPinnedStorage`. The lower-level acceptance
   harness in `scripts/perf/owned-acceptance/` is not HTTP server activation.
2. Thread a verified, owned-picker-only configuration through
   `app/server.mjs:createServer`'s `openContext` into
   `app/picker-context.mjs:createPickerContext`, then into `openStore`.
   `app/storage/store.mjs:openStore` defaults `ownedFormat2 = false`;
   `createPickerContext` currently has no such option and omits it at its store
   call. Legacy must remain outside owned storage. The fixture builder also
   currently uses format-1 stores (`scripts/perf/capacity/fixture-group.mjs`).
3. Prepare load/command/import hooks against the save's pinned dataset and
   identity base, with independently retained manifests across a restart.
   `app/game-profile.mjs:prepareOwnedPickerState` and
   `app/server.mjs`'s current migration pipeline assume the running dataset.
   A base alone cannot reconstruct an older runtime's semantics. Existing
   `app/storage/owned-rebase.mjs` is a stopped-writer API, not startup activation.
   Retirement filtering and current-name display also remain 7c work.

These are the explicit boundaries in
[the calculator contract](../owned-calculator-contract.md),
[the acceptance contract](../owned-acceptance-contract.md) (last paragraph), and
[the rebase contract](../owned-rebase-contract.md). No activation, migration,
retirement or browser-negotiation work is implemented here. Future activation
must add a format-specific fixture/seal identity and a genuine HTTP/restart proof
before removing the refusal. It must not relabel a format-1 fixture as format 2.

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
showing all 100 resident together through a post-deadline confirmation, no later
than two sampling intervals after the deadline. Serial visits through an eviction
loop and transient residency cannot pass. The other 400 resident disk groups remain
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
immediately closed handshakes cannot pass.
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

| Speed bar | PASS requires |
| --- | --- |
| Everyday | Every planned action/phase completes, with valid p50/p95/p99, p95 < 300 ms, and no terminal failures. |
| Heavy | All four expensive classes complete every planned action/phase, p95 < 3,000 ms, and no terminal failures. Actual task-miss coverage requires one successful cache-miss action per intended miss, not an aggregate of failed/repeated attempts. |
| Cold open | One successful initial-process state + tasks readiness open for each distinct active group, p95 < 2,000 ms. Initial requests include HTTP queuing and client retries. |
| Restart | Exactly one clean restart; distinct active groups return current replacement-process state/tasks and remain healthy/resident through the confirmation described above, with recovery before 300 seconds. Smoke uses a 30-second recovery window. |
| Plugin / sync | Configured report, status, tasks and sync classes must complete every planned action/phase without terminal failures. Their p95 is reported per phase; browser latency limits do not apply. |
| SSE recovery | Every expected client holds established replacement-process streams at the deadline and confirmation, with recorded lifetimes and closure reasons. Bounded planned reconnect handoffs require live replacements. |
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
git bundle create .local/sustained/sustained.bundle perf/sustained-load
git bundle verify .local/sustained/sustained.bundle
```

After the operator transfers that bundle to the scratch host as
`/srv/scratch/sustained.bundle`, run the following there. All output directories
must be new. These commands do not provision or contact a host:

```sh
cd /srv/scratch
git clone --branch perf/sustained-load ./sustained.bundle picker-sustained
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

For a future format-2 comparison, stop here until the activation prerequisites
above land; `--format format2` currently returns the deliberate 7c diagnostic.
There is no valid format-2 scratch command yet. Preserve the format-1 results.

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
responses. Syntax checks, `git diff --check`, and the real CLI's format-2
refusal before output creation also passed. No full suite or hosted CI ran.

PR #211 gate review added four regressions for replacement-generation readiness,
failed/missing plugin and sync work, signal exits, and immediately closed SSE.
The gate sweep added twelve regressions covering incomplete latency/completion,
confirmed session coalescing, phase evidence, duplicate/missing cohort identities,
invalid stream lifetimes,
stale task revisions, transient/unhealthy residency, aggregate cache-miss masking,
missing telemetry/accounting/truncated duration, isolated telemetry snapshots,
incomplete Retry-After evidence, and non-SSE HTTP 200 responses. The existing
real-server capacity test also checks the scratch identity response header.

Review-fix verification passed **52 cases in the same three files**: sustained
(24), harness (16), realism (12), with zero failures or skips, Node 24.20.0,
complete `testRunPolicy` environments, one worker, BelowNormal priority and the
shared lock. No new smoke, full suite, or hosted CI ran. Historical smoke artifacts
are unchanged; they lack the new process/lifetime/accounting receipts and cannot
satisfy the hardened gates or establish recovery under the new rules.
