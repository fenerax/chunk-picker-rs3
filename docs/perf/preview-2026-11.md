# First roll Preview, November 2026

START `b56861dfbca2d52d5beb16e8386ba2e74e340fd6`.
Branch: `perf/p4-preview`. Linux, Node 24.21.0, process workers.

The owner sees the exact completed Preview before reusable task projections
and partner evaluation finish. The calculator continues preparing the same
owner/partner pair for acceptance. No engine, task, pool or fixed-point logic
changed. Both measured members clear the three-second first-Preview target.

## Before and after

Seconds, median [minimum–maximum], five independently fresh calculators per
member/version. Slots are zero-based indices. Startup is separate from Preview.

| Measurement | START slot 0 | Candidate slot 0 | START slot 1 | Candidate slot 1 |
| --- | ---: | ---: | ---: | ---: |
| First visible Preview | 16.74 [13.24–19.46] | 12.56 [9.64–13.19] | 14.67 [12.54–26.00] | 7.66 [6.38–8.68] |
| Repeat visible Preview | 2.18 [1.84–2.30] | 0.81 [0.78–1.15] | 2.03 [1.52–7.77] | 0.95 [0.79–1.11] |
| Final partner-ready reply | 16.74 [13.24–19.46] | 15.91 [12.99–16.75] | 14.67 [12.54–26.00] | 15.30 [11.96–17.15] |
| Advisory spawn → ready | 3.05 [2.69–4.23] | 2.83 [2.73–5.03] | 2.69 [2.58–3.14] | 3.00 [2.68–3.15] |

Median first-Preview reductions: **4.18 s** and **7.00 s**. CPU work remains on the worker.
Repeated rows exercise the worker path on a scheduler response-cache miss;
ordinary scheduler cache-hit latency was not measured.

## Phase measurements

Seconds, median [minimum–maximum], through the complete final reply.

| Measurement | START slot 0 | Candidate slot 0 | START slot 1 | Candidate slot 1 |
| --- | ---: | ---: | ---: | ---: |
| Baseline snapshot | 6.026 [4.848–7.644] | 5.778 [4.516–6.416] | 4.648 [3.912–6.467] | 4.560 [3.728–5.122] |
| Hypothetical fixed point | 5.904 [4.752–7.537] | 5.686 [4.551–6.278] | 2.399 [1.921–8.870] | 2.391 [1.914–2.805] |
| Partner evaluation | 2.841 [2.405–3.897] | 2.688 [2.514–2.847] | 5.912 [5.360–7.363] | 6.149 [4.982–8.571] |
| Map/play projection | 0.141 [0.113–0.218] | 0.151 [0.136–0.225] | 0.147 [0.131–0.152] | 0.151 [0.122–0.179] |
| Shared JSON serialization | 0.110 [0.083–0.111] | 0.100 [0.091–0.116] | 0.097 [0.086–0.104] | 0.106 [0.082–0.112] |

Baseline includes lazy collection preparation and snapshot admission. Projection
covers map/play projection; serialization covers reusable shared JSON buffers.
Other time includes prepared-state validation, delta/sidebar construction,
fingerprinting and IPC. Medians of phases need not sum to the median wall.

## Options examined and implementation

- Exact baseline reuse: `snapshotFor` already reuses an exact calculation key
  within one worker. Foreground and prediction workers have separate snapshot
  maps, so prediction can recompute a foreground baseline. Unlock reuse holds
  hypothetical compact projections, not the original complete graph.
  `taskReuseFingerprint` excludes only reviewed display/roll bookkeeping.
  Cross-lane baseline transfer needs a new bounded graph admission path; none
  was added here.
- Incremental hypothetical: the current engine constructs fresh source,
  obligation, access and processing state. Exposed result rows are not a complete
  supported seed. New invalidation/cycle proofs would be needed. No engine hot
  function changed.
- Partner work: the browser renders `unlockPreview` when `/api/predict` resolves;
  it needs only the owner's delta/coverage/metrics. Native callers now opt into
  a result-only `prediction-prepared` notification before projection building.
  Existing calculator clients keep their original progress/final sequence.
- Residency: retaining an additional used calculator exceeds 300 MiB. No longer
  or eager residency policy was enabled; existing idle retirement and calculator
  caps remain unchanged.

The scheduler resolves Preview waiters and publishes its summary once. It keeps
its pending entry, fairness admission, hard deadline and physical calculator
lease until the final reply. Active followers can use the same result if the
bounded response cache rejects/evicts it. Explicit Preview interest still
promotes ranking work. Owner/partner bytes retain their existing admission and
saved-state race checks. A later partner failure does not invalidate the complete
owner delta; subsequent work follows ordinary lane recovery. No worker imports
or native codec handles were added.

## Memory

MiB, median [minimum–maximum]. VmHWM includes relay and calculator threads.
Idle is two seconds after Preview, repeat and full evaluation, without forced GC.
Parent peaks include canonical comparison work and are not server forecasts.

| Measurement | START slot 0 | Candidate slot 0 | START slot 1 | Candidate slot 1 |
| --- | ---: | ---: | ---: | ---: |
| Worker peak through Preview repeat | 1419.9 [1416.3–1448.1] | 1430.9 [1373.1–1480.4] | 1490.1 [1471.2–1496.6] | 1477.3 [1451.8–1517.9] |
| Worker peak through full workload | 1544.3 [1541.8–1553.9] | 1538.3 [1509.8–1556.3] | 1587.7 [1579.8–1597.9] | 1581.9 [1569.0–1604.7] |
| Worker idle | 1525.0 [1522.8–1535.1] | 1519.3 [1490.8–1537.1] | 1565.3 [1557.0–1575.3] | 1559.2 [1546.5–1582.3] |
| Parent peak | 1036.3 [1011.8–1073.3] | 1068.0 [1021.8–1559.9] | 1142.8 [1133.6–1664.4] | 1153.0 [1122.2–1431.0] |
| Parent idle | 986.7 [962.0–1023.7] | 1018.2 [965.9–1510.5] | 1075.3 [1017.1–1545.1] | 1069.9 [996.7–1303.9] |

One active delta reference is released at job completion. The completed response
cache retains its existing half of the 32 MiB prediction budget. No additional baseline graph
or worker is retained. Worker peak/idle medians show no increase in
these cells. This is a short bounded-workload check, not a long-duration leak or
mixed-picker capacity test. The host has a four-CPU quota and 16 GiB memory limit;
the six-vCPU/11-GiB deployment was not directly measured.

## Full canonical result equivalence

Canonicalization uses `tools/calc-check/compare.mjs`: array order remains
significant and only its existing volatile fields are excluded. Prediction hashes
cover the complete final delta/coverage/metrics plus both reusable owner/partner
projections and their metadata. Evaluate hashes cover the full result; pool hashes
cover the full pool response. Counts are added tasks, total evaluated tasks and
eligible pool rows respectively.

| Slot | Request | Count | SHA-256, identical before/after |
| --- | --- | ---: | --- |
| 0 | predict (first and repeat) | 13 | `cd183237b1bb4dd760a5400ce9576495359bff4ad713af33898a3d961e62dee5` |
| 0 | evaluate | 20544 | `e9a3c795f81e99b217faf6572eddb2d59c2fddd3a1eda16b8841852a52dc1df9` |
| 0 | roll-pool | 7 | `8cdf00b0621360d40e2c0b951db82af8fdce3bcf8a1d9a40d4858021e6a0e9f9` |
| 1 | predict (first and repeat) | 0 | `288e0243a723d06b8d9690ec127ac193271672169c1390dbc5c5f2f10127a859` |
| 1 | evaluate | 20560 | `ff00b659cbe44328aabda97a16e7f15e544d9d4b5a35c8cdbc5e4f19129bc82f` |
| 1 | roll-pool | 30 | `77f02dc586a07c8df2e46dccf7439f45a3ddba6b1d9d0d9c623ada2cee4b099a` |

Eighty final response fingerprints across twenty retained fresh calculators
match their corresponding reference hashes/counts: zero differences. Twenty
candidate early results match their corresponding final result-only canonical
hashes: zero differences. Synthetic tests compare opted-in early output with
existing final-only behavior and preserve the ordinary progress sequence.

Input receipts:

- datasetHash: `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`.
- sourceHash: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
- stateHash: `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1`.
- Counts: 2 members, 23939 saved task rows, 2594 world chunks.
- Filesystem audit: 431 source files, 431 copied files, 82007295 bytes; 0 file differences, 0 binding differences, 0 credential artifacts, 0 lab changes.

## Method and reproduction

The harness follows the hotspot input loader/workload: plain filesystem reads of
a copied scratch save, checked static hashes, backup validation, and ordinary
process calculators. Server/store imports are refused. No server or normal store
opened the private input; no credentials were created. Each trial requests a pool,
previews its first eligible candidate, repeats Preview, then requests a full
evaluation. Hashing happens after each request timer. Fresh means a new process,
not an evicted OS page cache. Retained cells ran one calculator at a time, without
tests or profilers alongside them. All retained outliers remain included. Earlier
harness-development/pre-final-design cells are excluded.

Supply ordinary dataset/pack/default settings externally, including process mode.
Create the START worktree and scratch copy before these commands. Repeat for
`--member 1` and for the candidate root.

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/preview-engine.mjs --root /tmp/start --member 0 \
  --data-dir /tmp/perfwalk/game --runs 5 --output /tmp/preview-before-0.json
node scripts/perf/preview-engine.mjs --root . --member 0 \
  --data-dir /tmp/perfwalk/game --runs 5 --output /tmp/preview-after-0.json
node scripts/perf/preview-summary.mjs --before /tmp/preview-before-0.json \
  --after /tmp/preview-after-0.json
```

The summary requires five runs per side, identical input hashes, matching full
result hashes/counts, and matching early/final result hashes. A mismatch fails
instead of reporting a speedup.

## Files and gate

- `app/tasks/worker.mjs`: opt-in early immutable Preview notification.
- `app/tasks/scheduler.mjs`: early response/follower handling with partner
  completion, deadlines, idle behavior, ranking promotion and leases preserved.
- `tests/prediction-cache.test.mjs`: early completion, cache limits, summaries,
  cancellation, late errors, deadlines, ranking promotion and pooled leases.
- `tests/unlock-reuse.test.mjs`: full synthetic equivalence for final-only,
  ordinary progress and opted-in early message sequences.
- `scripts/perf/preview-engine.mjs`: rooted calculator-only fresh-run harness.
- `scripts/perf/preview-probe.mjs`: fixed-name stage instrumentation.
- `scripts/perf/preview-summary.mjs`: five-run summary and canonical hash gate.
- This report. No new test files; existing classifications remain valid.

Touched test files: 79 passed, 0 failed, 0 skipped. Related scheduler, prediction
HTTP/output, worker timing/identity, calculator-cap, process transport, idle and
native-codec termination files: 130 passed, 0 failed, 0 skipped. Total targeted:
209 passed, 0 failed across 11 files. The process parent-death test passed.

Final `npm run test:quick`: 344 files, 3,479 tests; 3,411 passed, 0 failed,
68 skipped, 0 cancelled, 564.13 seconds. One earlier attempt was interrupted by
a workspace reconnect before its final summary; the completed rerun used the
unchanged command and policies. No full `npm test` was run.

Limits: one eligible candidate per member; calculator/component measurements;
no real browser/WAN, mixed-picker capacity test or deployment. Immediate
acceptance can still overlap partner preparation; core engine work is unchanged.
The latency threshold clears for both measured members with unchanged canonical
results. Recommendation: **MERGE-CANDIDATE**.

**SHIP**
