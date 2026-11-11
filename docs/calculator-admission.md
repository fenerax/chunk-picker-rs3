# Calculator admission

Each lane accepts at most 128 waiting requests. Named pickers share a default
limit of four outstanding calculations across all lanes, with at most 64
requesters attached to one job. Explicit smaller queue limits remain supported.
The compatibility `legacy-shared` picker retains its old per-picker policy;
global job and input-byte limits still apply. `fairness: false` opts out of
per-picker quotas and round-robin ordering.

Queued requests for the same picker, member, kind, view and arguments share one
slot. Matching task inputs and revision join the existing job even if callers
use different response keys. A changed input replaces that queued slot with a
409 superseded response to its obsolete readers. An older revision cannot
replace a newer slot. Active exact-key followers retain the established
coalescing, cancellation and saved-prediction reuse behavior. Independent
members/kinds remain independent computations; `coalesceQueued: false` supports
callers whose opaque keys intentionally name independent jobs.

Within a priority class, pickers take round-robin turns. Interactive requests
precede full task hydration, planning, sandbox, area checks, death estimates
and peer task calculations. After eight interactive dispatches, one waiting
requested heavy calculation gets a turn. Requested work precedes unsolicited
warming from every picker. This ordering applies inside each lane and across
the existing physical calculator pool. A requested calculation already running
keeps its calculator until completion or its existing cancellation/deadline.

## Deadlines and memory

`waitDeadlineMs` defaults to 240,000 ms and starts on initial admission. Joining
or promoting a job does not extend it. Wait expiry returns HTTP 504 with
`CALCULATION_WAIT_TIMEOUT` and a retry hint, releases the input and admission
quota, and leaves the calculator running. Execution gets its own allowance at
dispatch: the existing 30-second foreground deadline, existing advisory
allowances, and existing bounded first-calculation allowance. Execution expiry
retains worker recovery and lifecycle diagnostics.

Native context task requests carry a deferred store provider, input fingerprint
and revision while waiting. The provider captures transport bytes only after
winning a calculator and checks both revision and fingerprint before sending.
Display-only revision rebinding still works when the task fingerprint matches.
No write is performed by admission or the provider.

Eager compatibility inputs are parked as V8 bytes (or already shared JSON
bytes). Owned inputs serialize the sparse document and share their verified
immutable base installation; they never queue a full resident graph. Each lane
charges at most 64 MiB of parked input/argument bytes and response-key metadata,
including background inputs.
Diagnostics expose this ledger and its ceiling. An immediately idle request
keeps the original dispatch path without a serialization round trip.

Count, waiter or input-byte exhaustion returns the existing retryable HTTP 429.
The finite wait budget handles sustained overload independently of execution
failure. Save sequencing, storage encoding and acceptance gates are unchanged.

## Synthetic measurements, 2026-11-11

Node 24.20.0, Windows, shared PC, BelowNormal priority, one owned process
calculator. These are diagnostics, not hosted acceptance or a production load
claim. Engine/worker sources are identical to main `a317163b` (PR #200).

- A burst of 50 distinct groups over the synthetic 20,560-task worker completed
  with zero refusals and zero errors: 81.35 seconds total, request p95 77.31
  seconds, worker service p95 2.23 seconds, 21,288 charged queue bytes.
- The same burst through main's scheduler refused 41 requests. Its workload
  was therefore incomplete and its total duration is not a throughput baseline.
- Alternating fresh-process, single-group warm probes produced p95 samples of
  357/220 ms on main and 332/238 ms with admission. The initial burst probes
  produced 255/300 ms; the final changed-scheduler burst probe produced 295 ms.
  Eight samples per probe and shared-machine variation
  cannot establish a small speed difference or certify the owner's speed bar.
- A paused synthetic calculator with the acceptance-sized immutable base
  (24,000 tasks, 100,000 aliases) retained 49 queued groups in 52,630 charged bytes
  and approximately 261 KiB of incremental controller heap, including promises,
  picker facades and admission metadata. The shared base predates this delta.

Expected queue-capacity refusals for a healthy 50-group burst are zero when
requests stay within picker/byte limits and service completes within the finite
wait budget. At the measured aggregate service rate, 100 such group opens would
take about 163 seconds plus startup, a projection within the five-minute restart
goal. One calculator does **not** meet the three-second request target during
this simultaneous cache-miss burst. A second lane is a capacity experiment, not
a demonstrated complete fix; no calculators are added here. Sustained capacity
for 100 active groups / 200 online players needs an action-rate workload and
hosted measurements. Cold-start and everyday-action targets remain unproven.

Run the standalone probes with the focused test policy's cleared pack/profile
environment and `RS3_DATASET=open-f2p`:

```sh
node scripts/perf/admission-burst.mjs burst.json 50
node --expose-gc scripts/perf/admission-memory.mjs queue-memory.json
```

The burst probe uses real calculation and process transport without HTTP or
writable saves. The memory probe pauses a synthetic worker and forces GC;
neither dispatches acceptance or changes its workload contract.

Focused local verification (one file/process at a time):

```text
tests/scheduler-admission.test.mjs
tests/scheduler.test.mjs
tests/warmstart-scheduler.test.mjs
tests/picker-fairness-isolation.test.mjs
tests/picker-calculator-cap.test.mjs
tests/owned-acceptance-lifecycle.test.mjs
tests/worker-watchdog.test.mjs
tests/prediction-cache.test.mjs
tests/picker-jobs.test.mjs
tests/resident-planning.test.mjs
tests/advisory-retirement.test.mjs
tests/unlock-reuse.test.mjs
tests/owned-calculator.test.mjs
tests/workers-idle.test.mjs
```

The new admission cases inject application clocks and use one file-level outer
guard. They cover 50-group completion, priority ordering, bounded fairness,
coalescing, supersession, independent cancellation, byte ceilings, deferred
revision checks, unused pool-lease release, wait versus execution expiry and
the exact performance trace anchors. Existing owned and unlock-reuse checks
exercise real result equivalence and saved-prediction behavior. Full CI and
the required hosted stability proof remain landing gates; acceptance is left
to the owner after merge.
