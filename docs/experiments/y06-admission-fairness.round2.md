# Round 2: completion-aware latency and causal admission checks

Original START: `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`.
Round-2 starting HEAD: `b48b7c476b660dc27debd4acb63aff36ac2810e0`.
Branch: `perf/y06-admission-fairness`. All round-1 staged work is preserved.

## Before further app changes

The historical all-attempt response-time quantiles are retained exactly.
Replacing refusals/timeouts with the 2000 ms never-served ceiling gives exact
cross-trial median p95 and p99 values of 2000 ms for baseline in all nine
seed/endpoint groups. Counts and retained successful quantile ranks prove these
values; raw samples are not reconstructed or interpolated. Candidate primary
quiet losses are zero. All nine completion-aware gates pass; the apparent
service regression disappears under this definition. The original successful-
only 8/9 failure verdict is invalid as a service gate and is superseded.
Observed time-to-response still fails 8/9: fast refusals make that metric appear
better while leaving work unserved. Both definitions are reported side by side.

Historical long candidate failures: 240 request-rate and 1 calculator-admission;
0 cold account-full/global-full/deadline/lease refusals. Cold pending peaked at
15 of 64; active leases peaked at 1. The account-full events all belonged to
noisy requests. Further tracing will distinguish global/account request quota
and calculator cap where possible, and correlate quiet tails with acquisition,
factory, scheduler queue/service and host readiness.

## Round-2 protocol declared before measurement

Preserve every existing hard limit and all round-1 numerical guards: residency
7, calculator hosts 2, global/account cold leases 1, outstanding calculator jobs
4/picker, advisory queue 8, expensive quota 600/account/picker and 1200 globally
per 60 seconds. Cold admission stays 64 outstanding globally, 2/account, 2000 ms.
Client deadline 5000 ms, drain 5000 ms, tree RSS guard 3072 MiB, samples every
50 ms with three valid post-drain samples, trial wall deadline 240 seconds.

One workload at a time, maximum 25 minutes of round-2 measurement, checkpoint
at every trial. Planned causal comparison: round-1 candidate versus any in-scope
fix, 3 interleaved 24-second pairs per seed 17,73,211 (18 trials). Two additional
matched 120-second pairs at seeds 17,73 (4 trials) trace shared quota windows;
this is partial repetition relative to round 1's five long pairs, labeled
separately. No residency/host/lease/job/rate bound changes or high-tier ramp.

Tracing is diagnostic-only, identically injected into both revisions at load
time. Retain only numeric request IDs, endpoint/phase/outcome, durations, counts
and bounded categorical reasons; no cookies, identities, headers or bodies.
Per-request job correlation must avoid assigning another queued request's async
context to a cold factory. Histories from round 1 remain unchanged. Correct
production tests must prove warm progress during another account's stalled cold
factory and preserve snapshot, cancellation, revision and shutdown contracts.

## Proven router defect and minimal fix

A new correct regression test failed on the round-1 candidate: after priming a
quiet warm context, another account held a stalled cold factory and the warm
request could not finish even one event-loop turn later. The test releases the
factory before asserting, so the reproduction drains normally. The round-2
router fix removes only the global serialization of warm acquisition. Checking
closed/lifecycle/closing and incrementing active has no intervening await, so
it is atomic with capacity-victim selection on the event loop. The per-directory
checkpoint barrier remains. A second regression verifies its own held checkpoint
still blocks that warm context while an unrelated warm context progresses.
The completed admission test file passes 15/0 after the fix.

This establishes a real head-of-line fairness bug for a stalled cold open,
without claiming it explains ordinary round-1 draft tails. The observed normal
quiet warm-path p95 is already small in both versions. The fix matters when an
unrelated factory or drain is slow, and changes no residency entitlement or
factory/lease concurrency.

## Causal evidence and overload interpretation

The first traced reproduction of calculator refusal hit a global advisory queue
at depth 8, limit 8, with queued shares [3,3,1,1] across four pickers. The refused
quiet picker had no queued job. No picker exceeded the existing four-outstanding
job cap. This is the existing finite calculator overload bound, not the new
2/account cold bound, 64 global cold bound or 2000 ms admission deadline.
The single historical calculator refusal cannot be retroactively assigned an
internal sub-limit from its aggregate file; the new exact reproduction identifies
the global queue case without inventing historical attribution.

One traced 300.4 ms draft spent 22.8 ms acquiring its context, 245.5 ms queued
for the advisory calculator and 23.6 ms in that calculator's service. Its queue
interval overlapped replacement-host startup for 189.2 ms. A second 314.3 ms
case spent 19.2 ms acquiring, 264.3 ms queued and 23.3 ms in service, including
158.5 ms of startup overlap. These request-correlated intervals explain actual
large tails; they are not unrelated trial maxima. Neither hit an admission
deadline. A warm 272.0 ms round-2 draft acquired in 0.036 ms and still spent
238.0 ms queued, including 158.3 ms of host startup, independently ruling out
router cold-open ordering as its dominant delay.

The shared pool has one advisory slot under the unchanged two-host limit.
Retiring/replacing that host delays queued drafts until it is ready; subsequent
fair queue turns add waiting. `app/tasks/scheduler.mjs` and
`app/tasks/calculator-pool.mjs` own that lifecycle. They are unchanged on disk,
and no scheduling decisions were changed by the probes. Altering host
retirement/cancellation is outside the permitted production seams for round 2;
it is not attempted. The original 302.6 ms task-read outlier coincided with a
278.6 ms factory maximum, but its historical request was not retained, so exact
retroactive attribution remains unavailable. New traces retain every quiet
failure and every successful quiet response >=250 ms to avoid this limitation.

## Fixed confirmation after the initial comparison

The initial 18 short trials complete quiet work 935/936 before and 936/936 after.
Overall median raw p95 values are state 68.8→68.8 ms, tasks 72.9→72.8 ms and
draft 227.7→207.6 ms. Nonetheless seed 73 fails three endpoint p95 checks with
zero failures in either version of that seed, so those failures are not survivor
bias. The other six seed/endpoint checks pass. This new before/after comparison
is distinct from the original-main nine gates, which all pass at the failure
ceiling. Both must be reported.

Before observing any confirmation result, allocate exactly two more matched
24-second pairs at seed 73, retaining the same code, arrival pattern, trace hooks,
limits and thresholds. Run them after the already sequenced long comparisons and
quick suite, one measured workload at a time, with no test workload alongside.
This brings seed 73 to five short pairs; seeds 17/211 remain three in round 2.
It stays beneath the overall 25-minute measurement budget. Report all results,
including the original three failures, regardless of the confirmation outcome.

The initial seed-73 median p95 state requests acquired in 73.3 ms before and
97.6 ms after, with factory time 20.7 versus 42.9 ms. Task representatives
acquired in 53.8 versus 67.3 ms, with factory service 25.7 versus 25.7 ms and
calculator service 17.3 versus 17.4 ms. Thus their changed tails sit mainly in
cold opening/queueing. The draft representatives acquired in 0.029 versus
0.046 ms but queued for 207.0 versus 324.0 ms. These are different requests;
the traces decompose each without summing overlapping intervals. The fixed
confirmation will determine whether the aggregate regressions persist across
five matched pairs.

## Completed round-2 result

All planned work completed without censoring: 18 initial short trials, 4 long
trials, and 4 fixed confirmation trials. The initial short comparison served
935/936 quiet requests before and 936/936 after. Its single before failure was
the exactly traced 8-slot advisory queue refusal. Both versions served all 208
quiet requests in the confirmation. Across the new-code short trials this is
1144/1144 quiet completions; there were no cold-account/global/deadline refusals.

The two long pairs served 945/1040 quiet requests before and 944/1040 after.
All 95 before and 96 after failures were traced to the existing global expensive
quota at 1200/1200. The affected quiet accounts/pickers were below 600 (one
observed example was 8/600). There were no quiet cold or calculator refusals in
these long trials. The original 241 therefore splits into 240 request-quota
refusals and 1 calculator-bound refusal, not a failed cold fair queue. The exact
reproductions establish the global quota and global advisory-queue cases while
preserving the historical one-event attribution limit. Spent quota tokens are
not leases and cannot be returned by the cold admission code. The existing
quota does not reserve future tokens for quiet accounts; changing that policy
would be a separate request-budget allocation change.

The fixed confirmation brings seed 73 to five pairs with both versions serving
every request. Its median per-trial p95 [min–max], observed and ceiling alike:

| Endpoint | Before ms | After ms | Before p99 ms | After p99 ms | Gate |
| --- | --- | --- | --- | --- | --- |
| State | 79.1 [57.0–82.8] | 85.0 [75.2–112.4] | 107.0 | 96.9 | PASS |
| Tasks | 72.9 [60.5–87.1] | 83.0 [58.8–127.1] | 72.9 | 83.0 | FAIL |
| Draft | 239.8 [124.4–364.1] | 357.7 [83.2–384.2] | 239.8 | 357.7 | FAIL |

The state concern no longer fails after the fixed confirmation; task and draft
regressions persist. With the other seeds' three pairs, the new comparison
passes 7/9 completion-aware p95 checks. This is a genuine residual concern,
not the invalid survivor comparison from round 1. Task/draft trials still have
only twelve observations per endpoint, so short p95/p99 are maxima and are not
stable population-tail estimates. The five-pair task threshold is 80.2 ms and
the draft threshold 263.8 ms; neither is relaxed.

The largest new short draft was 421.9 ms: acquisition 64.2 ms, advisory queue
319.5 ms, advisory service 21.0 ms. Its trace records the replacement advisory
host becoming ready during the queue interval. A warm 357.7 ms draft acquired
in 0.046 ms, queued 324.0 ms and serviced in 23.3 ms, independently showing that
removing warm acquisition blocking does not remove advisory-host startup tails.
These calculator lifecycle changes belong to `app/tasks/scheduler.mjs` and
`app/tasks/calculator-pool.mjs`, outside the allowed production changes. The
remaining task-read interval needs context-open/factory profiling through
`app/picker-context.mjs` before choosing a further change; aggregate factory
and queue delays alone do not prove which storage or preparation subphase to
optimize. No changes to those files or storage were made.

Initial short peak tree RSS was 733.4 [702.7–755.7] before and
682.2 [644.4–739.1] MiB after. These are identically traced paired workloads,
not a comparison to untraced round-1 timing or an inherent memory-saving claim.
Closed-loop noisy throughput, cache state and host replacement differ; the
public fixture supplies no private per-context capacity evidence.

Across all 26 round-2 trials: 33480 HTTP attempts, 78/78 valid post-drain RSS
samples, zero detected successful-response validation differences, zero known
post-close children, zero OOM events/kills and zero sampled memory-guard
breaches. Observed bounds stayed at 7 contexts and 2 calculator hosts; cold
leases, pending accounting and numerical defaults remained unchanged. The
three measured phases total 1214.3 seconds (20.2 minutes), below the declared
25-minute measurement budget. Functional tests ran separately, and the final
confirmation ran after the quick suite. New-code long coverage is two matched
pairs at seeds 17/73, explicitly partial relative to the historical five-pair
long campaign; no hours-long, private-capacity or high-tier claims are made.

## Files and verification

Round-1 staged work and all four historical numeric artifacts are retained.
Additional production change: `app/picker-router.mjs` only, for warm pinning
outside the cold residency mutex. `tests/picker-admission.test.mjs` adds the
stalled-factory progress and own-checkpoint regression tests; its existing quick
classification remains valid. `scripts/perf/y06/admission.mjs` adds optional
numeric request traces and a finite budget override; `trace.mjs` contains the
diagnostic-only loader probes. `round2-summary.mjs` rejudges all nine historical
gates with rank proofs, and `round2-traces.mjs` generates new paired latency,
refusal and causal tables. The historical summarizer/reports are labeled as
superseded interpretations rather than silently rewriting their measurements.

Retained evidence: `y06-admission-fairness.round2-measurements.md`,
`y06-admission-fairness.round2-traces.md`, and the adjacent
`round2-primary`, `round2-long`, `round2-confirm` numeric result files.

- Correct pre-fix warm-progress regression: 1 failed, 0 passed (expected defect
  reproduction); after the fix, the admission file passed 15/0.
- Final focused seven-file run: 116 passed, 0 failed, 0 skipped, 14.7 seconds.
- `npm run test:quick`, once in round 2: 3026 passed, 0 failed, 68 existing
  skips (3094 total), 240.9 seconds. No full `npm test`; no assertion was weakened.

Verdict: **NEEDS-WORK**, on the new uncensored task/draft regressions. The original
survivor-only reason for rejection is withdrawn: all nine historical gates pass
when unserved work is charged at 2000 ms. The deliberate existing overload bounds
are reported separately from cold fairness, and the warm progress defect is fixed.
Further tail changes require scope beyond the allowed router/admission/server
production seams. Private capacity remains unvalidated; no deployment is proposed.

A player's already-open picker no longer waits for another picker's cold open.

Final artifact checks passed for all 26 trials: identical harness/probe hashes
across phases; one frozen app-source hash set per before/after variant; complete
quiet request/trace correspondence; correct global-quota counters; valid queue
share bounds; all RSS/drain/child/response bounds; and no credential fields or
private paths in numeric output. Seven final syntax checks passed. Original
round-1 numeric artifacts have zero unstaged content differences. Private
changed paths 0; private copies 0; private store/server runs 0. Remaining owned
harness data directories 0 before scratch cleanup.

Reproduce the separated phases from the working tree on Node 24.20+ (24.21.0
here), one workload at a time. The confirmation is exactly two pairs regardless
of its result. Keep the overall measured workload below 25 minutes; the measured
sum above excludes the separately run functional tests.

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
git worktree add --detach /tmp/y06-r2-before b48b7c476b660dc27debd4acb63aff36ac2810e0
node scripts/perf/y06/round2-summary.mjs
node scripts/perf/y06/admission.mjs --baseline /tmp/y06-r2-before --out /tmp/y06-r2-primary.json --pairs 3 --seeds 17,73,211 --seconds 24 --trace --budget-minutes 25
node scripts/perf/y06/admission.mjs --baseline /tmp/y06-r2-before --out /tmp/y06-r2-long.json --pairs 1 --seeds 17,73 --seconds 120 --trace --budget-minutes 15
node scripts/perf/y06/admission.mjs --baseline /tmp/y06-r2-before --out /tmp/y06-r2-confirm.json --pairs 2 --seeds 73 --seconds 24 --trace --budget-minutes 6
node scripts/perf/y06/round2-traces.mjs --primary /tmp/y06-r2-primary.json --long /tmp/y06-r2-long.json --confirmation /tmp/y06-r2-confirm.json
```

The three new numeric evidence files use one compact JSON trial per line for
review size; parse/deep-equality checks confirm zero logical differences from
the original measurements. The four round-1 numeric files remain unchanged.
