# Bounded cold-open admission

> Historical round-1 interpretation: survivor-only latency gates are superseded by the [round-2 all-attempt rejudgment](y06-admission-fairness.round2-measurements.md) and [causal follow-up](y06-admission-fairness.round2.md). Original numeric evidence is retained.

START: `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`.
Branch: `perf/y06-admission-fairness`.

## Declared protocol (before candidate measurements)

Public open-f2p only, process calculator workers, one measured server tree at a time.
Baseline uses an untouched START worktree. Candidate changes admission alone.
Existing limits stay at residency 7 including legacy, global cold opens 1,
calculator hosts 2, outstanding jobs/picker 4, advisory queue 8 and expensive
requests 600/account, 600/picker, 1200 globally per 60 seconds.

Admission bounds: 64 outstanding cold acquisitions globally (queued plus active),
2/account; FIFO within each account, round-robin eligible accounts; same existing
1/account and 1/global cold lease. Maximum admission time 2000 ms including
opening, no automatic request retry. Residency contention retries at most every
25 ms within that deadline (at most 80 waits). Cancelled active opens retain
account/global accounting until settlement; late results are closed before reuse.
Queue-full/account-full/deadline/cancel/shutdown/error are separate telemetry.
No resident-context entitlement; busy residency may still cause deadline refusal.

Arrival seeds: 17, 73, 211. 20 independent accounts: 2 noisy, 4 light, 14 idle.
Two noisy accounts each replenish four draft streams at 150 ms after replies;
every 13th request disconnects after 2 ms, retries once after 1000 ms, and
refusals back off by Retry-After (capped at 2000 ms). These streams jointly
pressure the unchanged global expensive quota; their throughput is closed-loop.
Quiet arrivals are independent: light every 2000 ms repeating state/state/tasks/
draft, idle every 6000 ms. A seeded generator assigns initial offsets in [0,1000)
ms. Maximum 2 quiet in-flight requests; local shedding is an explicit failure.
Initial simultaneous state storm is separate from steady arrivals; no storm
retry. Prewarm half sequentially, then warm advisory before starting arrivals.
Revision change / old-revision draft / state probes run after arrivals.

Requests have an absolute 5000 ms client deadline. Drain is at most 5000 ms;
three drain/RSS samples 250 ms apart after a 1000 ms settling interval are
required, with a serialized sampler handshake (never an undefined skipped
sample). Tree RSS is sampled every 50 ms with PID/start-tick fencing; stop at
3072 MiB or any OOM delta. Each trial has a 240-second wall deadline. Campaign
budget: 50 minutes for measured workload, checkpoint after every trial. Planned
primary: 5 interleaved baseline/candidate 24-second pairs per seed. Planned long:
5 matched 120-second pairs across seeds 17,73,211,17,73. No 50/100 or residency
variation unless the primary gate passes; these would be separately labeled.

Gate: zero quiet refusals, deadline failures or local shedding, every scheduled
quiet arrival successful within 5000 ms, every quiet picker completion 100%.
For each quiet endpoint, median per-trial successful p95 <= baseline + max(5 ms,
10% of baseline). Report each range, investigate every >300 ms quiet tail;
unexplained regressions fail the gate. Short trials have only 12 light drafts;
long trials provide 60 each, still limited tail evidence. Report all-attempt and
successful p50/p95/p99 with counts, scheduled arrivals, retries, reasons and
per-picker minima. No stale/cross/invalid successful responses, residency >7,
calculator hosts >2, missing post-drain sample, nonzero normal-close descendants,
OOM or memory-guard breach is acceptable. Baseline advisory timing is sampled,
not exact: START overrides the supplied observer in its advisory lane. No
calculator module will be changed to repair that diagnostic limitation.

Private HTTP/server modes do not exist in this harness. Private incremental RSS,
mixed-load behavior and deployment remain outside this public validation.

Baseline reproduction before app edits: seed 17, one 24-second public trial,
quiet steady 83/104 successes, 21 cold-open refusals; storm 7/20 successes,
13 cold-open refusals. Per-picker aggregates are retained in the reproduction
artifact. This trial and the 3-second candidate smoke are excluded from paired
measurements.

The harness uses the same timing-only Node source hook on both revisions to
record exact acquisition/factory boundaries without modifying START on disk.
Candidate admission events provide exact cold queue wait and service intervals.
Factory time excludes eviction; admission service includes eviction/checkpoint/
residency waits. Foreground calculator intervals use its existing observer;
advisory oldest age and depth are sampled separately. Unknown calculator/rate
refusal attribution is retained explicitly. Load RSS and CPU start after prewarm;
provisioning is excluded. Artifact source hashes identify the actual app bytes.

## Timing refinement and safety boundary

Before the long campaign, the public harness adds a timing-only loader probe at
START's internal advisory completion observer, identically for both revisions.
This supplies exact queued/start/completion intervals for observed completed
advisory jobs. Prepared-result messages and duplicate callbacks are excluded by
object identity; cancelled queued jobs without completion callbacks remain in
HTTP outcome/cancellation counts. It changes no scheduling or calculator result
code on disk. The primary campaign retains its original harness hash and sampled
advisory coverage; the long campaign records its distinct harness hash. Neither
trial-wide maxima nor queue percentiles identify the cause of an individual
HTTP tail. Unexplained >300 ms candidate tails remain gate failures.

A separate short matched public check uses `--drain-cycles 3`: after each drain,
rotate all twenty synthetic contexts again, drain, then collect three fresh RSS
samples. It is lifecycle evidence, separate from the primary and long latency
gates. No defaults or resource limits change for this check.

Pending cold work is bounded by 64 globally and 2 per account, including opens
whose clients have gone away. The 2-second deadline ends the request's admission
wait, not the underlying filesystem operation. A running factory is cooperatively
fenced at its boundaries; its lease stays held until it settles, and a late
context is closed before publication. Shutdown rejects queued/running admission
waiters, fences retries, and drains the existing factory before evicting contexts.
A hung filesystem operation can still delay that drain; freeing its lease early
would permit overlapping writers. No storage cancellation contract is introduced.

No private save copy, private server/store open, private credential creation or
private HTTP measurement is performed. Calculator computation files are unchanged;
no new calculator equivalence or private capacity claim is made. Private
incremental context RSS and mixed-load behavior remain unmeasured and are required
separately before any deployment decision. The task changes no production limit.

## Primary result and interpretation

All 15 matched pairs completed (5 per seed). Baseline quiet work completed
1241/1560 arrivals; candidate completed 1560/1560. Baseline light/idle counts
were 652/720 and 589/840; candidate counts were 720/720 and 840/840.
Every baseline trial had a quiet picker with zero successful steady requests;
every candidate quiet picker completed all its scheduled work. Baseline storms
completed 105/300 attempts; candidate storms completed 300/300.

This improvement fails the declared latency gate: 8/9 seed/endpoint checks fail.
Across the 15 trials per mode, median per-trial successful state p95 was
34.2 [29.5–40.2] to 52.7 [40.9–64.1] ms; task p95 46.6 [40.8–74.9] to
52.7 [43.5–302.6] ms; draft p95 78.7 [43.2–275.4] to
152.4 [59.6–343.9] ms. The primary report lists every retained >300 ms
trial/endpoint maximum and the contemporaneous admission, factory, foreground
and sampled queue evidence. Individual request causality remains unestablished;
these regressions are not accepted or explained away. Short trials have at most
12 task/draft observations each, so their tails are observed maxima, not stable
population estimates. More accepted work, reopening and cache churn differ;
CPU/RSS observations are not equal-work speedup or per-context sizing estimates.

Primary lifecycle checks: 90/90 valid post-drain RSS samples, zero detected
stale/cross-picker/invalid successful responses, zero failed drains, zero normal
close descendants, zero OOM events/kills and zero sampled RSS-guard breaches.
Observed bounds were 7 contexts including legacy, 2 calculator hosts, 1 active
cold lease and 15 pending acquisitions. Cold accounting recorded 1649 queued,
1647 started, 1646 completed, 3 cancelled and 1647 released acquisitions;
2 cancellations were queued and 1 active. Final pending count was zero in every
trial. The 34 account-full refusals belonged to noisy work; quiet work had none.

## Changed files

| File | Purpose |
| --- | --- |
| `app/picker-admission.mjs` | Finite account round-robin cold queue, deadline/cancellation accounting and observer. |
| `app/picker-router.mjs` | Integrate the queue, preserve snapshot/LRU/revision boundaries, fence disconnected and late opens, drain shutdown. |
| `app/server.mjs` | Forward the optional admission observer. |
| `tests/picker-admission.test.mjs` | Narrow queue, fairness, lifecycle and residency regression checks. |
| `tests/picker-limits.test.mjs` | Assert correct waiting behavior instead of the former immediate-refusal defect. |
| `scripts/test-selection.mjs` | Classify the new tests in quick and open-f2p policy. |
| `scripts/perf/y06/admission.mjs` | Public matched HTTP workload, exact boundary probes, limits, cancellation and drain checks. |
| `scripts/perf/y06/runtime.mjs` | Node gate, nearest-rank summaries and serialized PID-fenced process sampling support. |
| `scripts/perf/y06/summarize-admission.mjs` | Reproduce aggregate tables and declared gates from numeric artifacts. |
| `docs/experiments/y06-admission-fairness.md` | Protocol, outcome, coverage and handoff. |
| `docs/experiments/y06-admission-fairness.measurements.md` | Generated primary/long tables, ranges, reasons and tail evidence. |
| `docs/experiments/y06-admission-fairness.primary.results.json` | All 30 matched primary trials. |
| `docs/experiments/y06-admission-fairness.long.results.json` | Five matched long pairs, kept separate. |
| `docs/experiments/y06-admission-fairness.cycles.results.json` | Separate repeated-drain lifecycle check. |
| `docs/experiments/y06-admission-fairness.reproduction.results.json` | Pre-edit START defect reproduction and per-picker outcomes. |

## Reproduction commands

Use Node 24.20 or newer; this run used 24.21.0. Create the untouched START
worktree once, then run one workload at a time:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
git worktree add --detach /tmp/y06-start a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9
node scripts/perf/y06/admission.mjs --out /tmp/y06-primary.json --pairs 5 --seeds 17,73,211 --seconds 24
node scripts/perf/y06/admission.mjs --out /tmp/y06-long.json --pairs 1 --seeds 17,73,211,17,73 --seconds 120
node scripts/perf/y06/admission.mjs --out /tmp/y06-cycles.json --pairs 1 --seeds 17 --seconds 3 --drain-cycles 3
node scripts/perf/y06/summarize-admission.mjs --primary /tmp/y06-primary.json --long /tmp/y06-long.json --out /tmp/y06-measurements.md
```

The primary artifact's original harness is recoverable from commit `f71e25a`;
the final harness adds the advisory timing probe and optional repeated-drain
check. Arrival schedules and numerical admission/acceptance bounds were committed
in `c9f02c8` before candidate measurement. App code remains fixed from `b48b7c4`
through primary and long measurement; source hashes are retained in every trial.

Sampling uses verified 4096-byte pages and 100 CPU ticks/second on this host.
Tree RSS includes each process once, can count shared pages across processes,
and is not PSS. Fifty-millisecond sampling can miss brief peaks or short-lived
children. Post-close counts refer to known PID/start-tick-fenced descendants.
CPU is sampled server-tree core-seconds over storm, warmup, arrivals, probes and
drain; it excludes provisioning and the supervisor. No CPU-capacity or memory
stability claim follows from these bounded observations.

The pre-edit reproduction specifically completed 36/56 idle reads, with 20 idle
cold-open refusals. It is retained separately from the matched campaign.

## Long result, drains and handoff

All five matched 120-second pairs completed across seeds 17,73,211,17,73.
Quiet completions were 1863/2600 baseline and 2359/2600 candidate. Baseline lost
515 at cold-open admission, 221 to request-rate admission and 1 to unattributed
calculator admission. Candidate lost 0 at cold admission, 240 to request-rate
admission and 1 to unattributed calculator admission. All 1400 candidate idle
reads succeeded; candidate light requests completed 959/1200. Thus the long
service gate fails too. Account/global rate attribution and per-picker/global
calculator-queue attribution remain combined where the HTTP message combines
them. The limits stay fixed; no rejection is hidden as a retry success.

Long median per-trial state p95 was 33.6 [31.0–35.1] to 51.2 [49.3–60.0] ms;
task p95 51.6 [40.7–56.6] to 65.6 [59.4–94.2] ms; draft p95
232.1 [117.3–359.7] to 252.6 [103.4–329.8] ms. Successful task/draft samples
were 168/156 baseline and 180/179 candidate, out of 300 scheduled for each
endpoint/mode. These refused samples limit tail inference. Exact advisory queue
p95 was 137.4 [120.2–235.4] to 229.8 [64.3–234.7] ms; service p95 was
18.1 [17.2–19.3] to 18.1 [17.3–20.2] ms. Queuing dominates the large advisory
intervals, but aggregate timings do not match individual quiet HTTP requests to
host readiness, retirement or queue events. The generated table retains the
large tail maxima and their contemporaneous exact/sampled evidence. Further
attribution is required; no scheduler, pool, calculator or storage implementation
was changed to explain these regressions.

Primary peak tree RSS median [min–max] was 664.8 [632.2–725.5] to
683.8 [653.4–782.3] MiB. Long peak RSS was 753.8 [748.1–780.3] to
773.8 [770.1–886.8] MiB. MiB means 2^20 bytes. The three-cycle check retained
baseline medians 561.9,565.1,559.8 MiB and candidate medians
607.8,626.9,628.7 MiB, with three valid samples per cycle. Candidate completed
40/40 additional rotation reads versus 14/40 baseline. This is three drain
cycles, not a long-term retained-memory or leak conclusion.

Across the 40 matched primary/long trials and 2 separate cycle trials:
60533 HTTP attempts, 138/138 valid drain samples, zero detected successful
response validation differences, zero failed drains, zero known post-close
children, zero OOM events/kills and zero sampled memory-guard breaches.
All observed residency/calculator/cold/pending bounds held. The measured campaign
spanned 2240.1 seconds (37.3 minutes), including synthetic provisioning and
between-trial setup, beneath the declared 50-minute budget. The pre-edit
reproduction and excluded 3-second smoke are separate.

No 50/100-session exploration, residency variation or higher-concurrency/budget
experiment ran because the declared primary gate failed. Hours-long stability,
private incremental RSS and private mixed-load capacity remain unmeasured.
The next work must attribute the quiet advisory tails and address shared-budget
quiet-service behavior under independent noisy accounts before adoption.

Recommendation: **NEEDS-WORK**. The bounded admission implementation improves
cold-open progress but fails the declared latency and extended-service gates.
Players would see fewer opening errors and longer waits on some requests.

## Final verification

- Final focused run: `picker-admission.test.mjs`, `picker-limits.test.mjs`,
  `picker-routing.test.mjs`, `picker-limits-http.test.mjs`,
  `picker-calculator-cap.test.mjs`, `picker-fairness-isolation.test.mjs` and
  `test-selection.test.mjs`: **114 passed, 0 failed, 0 skipped**, 15.0 seconds.
- `npm run test:quick`, once: **3024 passed, 0 failed, 68 skipped** (3092 tests),
  238.8 seconds. No full `npm test` run. No test was weakened or skipped to pass.
- Earlier development checks: narrow **22/0** and focused **110/0**; the final
  focused run above validates the completed account-rotation refinement and the
  additional two-flooder/deadline/observer regressions.
- Six final app/harness syntax checks passed. Staged diff whitespace check passed.
- All 42 retained paired/lifecycle artifacts validate; candidate app source hashes
  have exactly 1 unique set across all 21 candidate trials. The aggregate upper
  bound on successful quiet response time plus arrival lag is 378.7 ms, within
  the declared 5000 ms deadline. Quiet timeout/local-shedding counts are zero;
  refused work is counted separately and fails the service gate.
- Numeric artifacts contain no credential fields/values or private paths in the
  content audit. Private changed paths **0**; private copies **0**; private
  server/store runs **0**. Untouched START changed paths **0**. Remaining owned
  harness scratch directories **0** before final scratch/worktree cleanup.

All changes are local on `perf/y06-admission-fairness`; there is no deployment or
capacity/default adoption recommendation. The failed gates are part of the
handoff, with all hard residency, calculator and request-rate limits preserved.
