# Keep-warm CI investigation — 2026-11-03

START: `f47a8e4ed30b14d533a5bb478668d71de3360bbb`.
Main baseline: `00e48b6aa95ecdb7308b73584e990c978ed91512`.
Node: v24.21.0. Linux, four CPU quota, 16 GiB memory limit.
Synthetic fixture states only; no lab save was opened or modified.

## Root cause

The new calculator tests in `tests/picker-context.test.mjs` ran under the
runner's `open-f2p` policy. Their mock runtime inherited disabled `training`
and `rsCatalogues` capabilities. The routes therefore returned HTTP 422 before
scheduling a calculation. The tests waited indefinitely for a worker message
in `while (...) await setImmediate(...)` loops.

The file exceeded a 360-second diagnostic deadline. An isolated reproduction
with the same dataset also timed out; active-resource snapshots still contained
an `Immediate` after Node's three-second test timeout. An outer six-second
process deadline was needed to stop that diagnostic. Running the file without
the per-file dataset policy progressed normally. This is a fixture error about
correct route gating, not a reason to change application route availability.
The reported `opaque.test.mjs` is a temporary fixture created by
`tests/postmerge-retry-policy.test.mjs`. That self-test deliberately prints the
FLAKY warning during a passing run; it does not identify a flaky repository
file. The reproducing stalled file is `picker-context.test.mjs`.

The fixture now explicitly supplies synthetic training/drop capabilities.
All existing worker dispatch, privacy, failure/recovery and residency assertions
remain. The three polling tests have ten-second deadlines and observe their
test cancellation signal.

## Application fixes

- `app/tasks/calculator-pool.mjs`: pool close is idempotent and bounded; physical
  workers are unref'd and force-stopped, including already-retiring workers.
  Maintenance and slot timers are cleared. Profiling attaches to physical
  calculators so native clock and CPU controls survive pooling.
- `app/tasks/scheduler.mjs`: lane and pool shutdown run concurrently with the
  same deadline. Task-preparation readiness checks the same picker activity
  admission as its queue; bound facades preserve their picker scope.
- `tests/session-residency.test.mjs`: four new cases cover warm shutdown,
  escalation, an unresponsive terminator and picker-scoped preparation readiness.
- `tests/warmstart-server.test.mjs`: establishes an authenticated session before
  expecting prepare-ahead, retaining every cache-hit and save-integrity check.
- `scripts/perf/ci-test-files.mjs`, `ci-test-cli.mjs`, `warm-shutdown.mjs`:
  reusable file timing, unchanged npm entrypoint timing/RSS and shutdown probes.
- `scripts/perf/y06/trace.mjs`: accepts both the main and START retirement
  signatures while retaining its required-seam assertions. The old hook failed
  on untouched START; all 12 profiling tests pass after the repair.

No calculator computation, game rules, pack data, changelog or roadmap changed.
No new test file was added, so classification changes were unnecessary.

## Per-file screening

The adaptive runner used its real per-file environment/solo policy, a cap of
three files, and a fresh shared Node compile cache per run. Main selected 125
matching files; START selected 126. This is a targeted screening run, not a
full-suite timing. Main used a 120-second diagnostic file deadline; START used
360 seconds after long browser files exceeded the first limit. Censored times
are lower bounds. These single observations rank suspects, not independent
causal estimates: START's spinning file also consumed CPU beside other files.

Main screening wall time: 594.387 s. START screening wall time: 889.526 s.
The different diagnostic deadlines make these wall times unsuitable as an
overall improvement estimate.

Top 15 observed duration increases (seconds):

| File | Main | START | Delta |
| --- | ---: | ---: | ---: |
| `tests/picker-context.test.mjs` | 29.231 | >360.011 | >330.780 |
| `tests/phone-controls-browser.test.mjs` | 90.003 | 131.469; failed | +41.465 |
| `tests/picker-routing.test.mjs` | 32.476 | 54.653 | +22.178 |
| `tests/runemetrics-server.test.mjs` | 18.355 | 27.942 | +9.588 |
| `tests/server.test.mjs` | 31.196 | 38.552 | +7.356 |
| `tests/sandbox-server.test.mjs` | 4.088 | 10.793 | +6.705 |
| `tests/signin-server.test.mjs` | 12.872 | 17.337 | +4.465 |
| `tests/rule-reviews-server.test.mjs` | 3.359 | 6.403 | +3.044 |
| `tests/picker-deletion.test.mjs` | 9.321 | 12.259 | +2.938 |
| `tests/picker-audit-c2.test.mjs` | 10.091 | 12.756 | +2.665 |
| `tests/public-ingress-server.test.mjs` | 3.769 | 6.398 | +2.629 |
| `tests/picker-audit-b.test.mjs` | 5.327 | 7.938 | +2.611 |
| `tests/picker-limits-http.test.mjs` | 4.543 | 7.143 | +2.601 |
| `tests/backup-file-browser.test.mjs` | 30.996 | 33.444 | +2.449 |
| `tests/picker-audit-a.test.mjs` | 5.905 | 8.216 | +2.311 |

Files with a censored main baseline are excluded from that ranking:
`duo-focus-browser.test.mjs`, `linux-multi-picker.test.mjs` and
`short-height-browser.test.mjs`. Longer main checks and final-suite outcomes
are recorded below. The browser and operator work uses synthetic fixtures.

## Affected files after the fix

After values are medians with min–max spread over three runs of the same eight
files through the adaptive runner and actual per-file policy. Main/START
screening columns are single observations. A failing START file's shorter
runtime does not represent a performance win.

| File | Main seconds | START seconds | After seconds, median (range) |
| --- | ---: | ---: | ---: |
| `tests/picker-context.test.mjs` | 29.231 | >360.011 | 14.158 (12.970–14.795) |
| `tests/warmstart-server.test.mjs` | 8.027 | 4.693 failed | 7.419 (7.173–7.955) |
| `tests/perf-stack-server.test.mjs` | 12.581 | 6.501 failed | 9.225 (9.079–9.456) |
| `tests/session-residency.test.mjs` | — | 1.329 | 1.173 (1.162–1.186) |
| `tests/scheduler.test.mjs` | 1.494 | 1.910 | 1.825 (1.801–1.894) |
| `tests/picker-calculator-cap.test.mjs` | 8.374 | 2.765 | 4.499 (4.197–4.643) |
| `tests/startup-warmup.test.mjs` | 0.168 | 0.204 | 0.246 (0.225–0.471) |
| `tests/warmstart-scheduler.test.mjs` | 2.333 | 1.052 | 1.373 (1.111–1.678) |

All eight affected files passed **166/166 tests in each run**, zero failures,
zero cancellations and zero skips (498 passes across the three repetitions).
The additional files were `startup-warmup.test.mjs` and
`warmstart-scheduler.test.mjs`. Residency coverage increased from 26 to 30 cases.
The profiling integration failed on isolated untouched START at its missing
clock-span assertion and passed after physical calculator attachment was fixed.

Affected-run wall seconds: 16.513 (16.268–17.057).
Sampled process-tree peak RSS: median 1215.5 MiB, range 1210.4–1226.9 MiB (250 ms sampling; shared pages count per process).

## Shutdown reproduction

A synthetic calculator holds its warm job and acknowledges termination only
when forced. Three runs use a requested 20 ms close deadline and a 200 ms
observation limit. No application store or save is involved.

| Revision | Close milliseconds, median (range) |
| --- | ---: |
| Main | 20.569 (20.361–21.590) |
| START | >200 in all three runs; no finite median |
| After | 0.229 (0.220–1.451) |

The first two shutdown regressions timed out before the fix. All four new
regressions now pass. Native termination tracing in the slow server screening
showed tens of milliseconds per retirement; the multi-minute CI hang was the
uncancelled fixture poll, not a measured multi-minute native termination.

## Gates and remaining baseline checks

The isolated unchanged-main phone-browser retry passed 5 cases and failed 1
(83.419 s wall). Longer main measurements passed `duo-focus-browser.test.mjs`
(219.233 s), failed `short-height-browser.test.mjs` (231.346 s), and reached the
360-second diagnostic deadline for `linux-multi-picker.test.mjs`. START also
reached that operator-file deadline while continuing to complete cases. These
baseline failures/censored timings are not attributed to the picker-context fix.

The first quick run completed 3,546 cases: 3,476 passed, 1 failed, 1 cancelled,
68 existing skips, in 694.917 s. Its failure was the stale y06 trace hook,
also reproduced on untouched START and now repaired. Its cancellation was a
20-second OAuth crash-recovery deadline; that unchanged file subsequently
passed all 6 cases in isolation in 9.842 s. No assertion or deadline was weakened.
Final quick: **3,478 passed, 0 failed, 0 cancelled, 68 existing skips**
(3,546 cases), 592.271 s wall; sampled tree peak RSS
1359.2 MiB. The trace hook and all crash-recovery
cases pass in the complete final quick run.

The single final `npm test` run completed all **710 files** (706 passed,
4 failed). Its **7,074 cases** comprised **6,929 passed, 5 failed, zero
cancelled and 140 existing skips**. Wall time was **1,423.354 s (23m43s)**;
250 ms process-tree RSS sampling peaked at **3,774.8 MiB (3.69 GiB)**.
All affected files and new regression cases passed in this run. The operator
file also completed, including two slow quarantine-repair cases (182 s and
262 s); it did not hang indefinitely.

The five failures came from four files. Each file was retried alone with the
adaptive runner's actual environment; remaining failures were also checked
alone on untouched START:

| File | Full run pass/fail | Isolated after pass/fail; seconds | Isolated START pass/fail; seconds |
| --- | ---: | ---: | ---: |
| `tests/backup-file-browser.test.mjs` | 2/1 | 3/0; 25.394 | Not needed |
| `tests/calc-check.test.mjs` | 10/1 | 11/0; 34.117 | Not needed |
| `tests/duo-focus-browser.test.mjs` | 25/2 | 25/2; 196.272 | 27/0; 123.950 |
| `tests/short-height-browser.test.mjs` | 0/1 | 0/1; 52.309 | 1/0; 192.024 |

A further native-reporter diagnostic of the unchanged after-fix focus-browser
file passed **27/27**, zero failures, in **117.442 s**. This confirms variability,
but does not erase either failed run. Short-height failed waiting for the next
page's saved-state readiness after four completed viewport flows. Its earlier
main failure does not establish that this after/START discrepancy is harmless.
The calculator-check failure was its existing reference-adapter request deadline;
its complete isolated retry passed without changes to the adapter or checker.

**Remaining gate:** the local full run is not green and exceeds 20 minutes.
The fixture spin and unbounded warm shutdown are repaired, but restoration of
the GitHub CI budget is unverified. Browser failures need further diagnosis or
reproduction in CI before merge. No existing assertion, timeout or test
selection was weakened; no new skips were introduced. The full npm entrypoint
was run only once. The private-save and real-pack lane checks were deliberately
not run because this brief requires synthetic data only.

## Reproduction

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
RS3_TEST_CONCURRENCY=3 node scripts/perf/ci-test-files.mjs /tmp/main /tmp/main-files.jsonl
RS3_TEST_CONCURRENCY=3 node scripts/perf/ci-test-files.mjs /tmp/w1-start /tmp/start-files.jsonl
RS3_TEST_CONCURRENCY=3 node scripts/perf/ci-test-files.mjs . /tmp/affected.jsonl '^(picker-context|session-residency|warmstart-server|scheduler|picker-calculator-cap|startup-warmup|warmstart-scheduler|perf-stack-server)\.test' 3
node scripts/perf/warm-shutdown.mjs .
node scripts/perf/ci-test-cli.mjs quick . /tmp/quick
node scripts/perf/ci-test-cli.mjs full . /tmp/full
```
