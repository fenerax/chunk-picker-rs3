# CI timing assertion audit

Audited on 5 November 2026 against `origin/main` at
`ff7aa00a213976ac1659e5f158f602c55466e54f`. All test sources were searched for
wall clocks, elapsed-time comparisons, timer races and readiness deadlines.
Failed-job logs from all 177 failed `Tests` workflows listed for 22 October
through 5 November were inspected, together with both PR #122 attempt-2 logs.
This distinguishes a timing assertion failure from another assertion failing
in a file that also contains a timing check.

## Confirmed failures

| Test | Run / attempt | Logged failure |
| --- | --- | --- |
| `save-transfer-response-bounds.test.mjs` | [serial control, attempt 2](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42000763938/attempts/2) | `every preview string source shares the wire cap and a sub-50 ms main-thread response gap`; `ERR_ASSERTION`, actual `false`, expected `true`. |
| Same response test | [parallel head, attempt 2](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42000811880/attempts/2) | Same assertion. The aggregate log omitted the numerical gap. |
| `live-timings.test.mjs` | [parallel head, attempt 2](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42000811880/attempts/2) | `a missing calculator start acknowledgement bounds close and retires uncertain cleanup`; actual `false`, expected `true` from the 150 ms race. Also failed in runs [41947364272](https://github.com/fenerax/chunk-picker-rs3/actions/runs/41947364272) and [41956858510](https://github.com/fenerax/chunk-picker-rs3/actions/runs/41956858510). |
| `save-transfer-regressions.test.mjs` | [41968034452](https://github.com/fenerax/chunk-picker-rs3/actions/runs/41968034452) | `timeout terminates a wedged worker, releases the global queue, and cannot apply a partial result`; actual `false`, expected `true`; total test duration 2058.1 ms against a 2000 ms completion assertion. The log does not identify which timing assertion failed. |
| `backup-file-browser.test.mjs` | [41999622061](https://github.com/fenerax/chunk-picker-rs3/actions/runs/41999622061) | `backup file purpose and filename in Chromium (pointer)`, followed only by `{}`. This does not establish a timing cause. |

PR #122 run `42000811880` was rerun with `--failed` before implementation;
its completion was not awaited. PR #123's earlier run `42003860256` failed
`browser-module-graph.test.mjs` on `node:fs`, outside this timing class.

## Changed assertions and regression protection

Only tests with a cited CI failure remain changed. Response measurements run
three independent executions, including the cold path. **Every sample must
stay below 250 ms**, and the best sample must stay below the original 50 ms
target. A hard-ceiling miss or operation failure rejects immediately; a passing
sample never ends the measurement early. Worker inputs are rebuilt before each
sample because transferring a buffer consumes it. Fixture creation and copying
remain outside the measured product operation. No runner delay is subtracted.

The timing trade-off is deliberate: a repeatable stall is caught at the tight
50 ms bound, and any single stall of 250 ms or more is caught by the hard
ceiling. A one-off cold stall between the tight bound and 250 ms is accepted
as indistinguishable from runner noise. A single-sample 50 ms ceiling would
restore the flake this sampling is intended to avoid.

Sampling never relaxes functional validation. The helper returns every result,
and every response passes the original string, key, record and wire caps,
completion/note/task counts, inflated-egress checks and exact saved-value
assertions. Each sampled transfer uses a separate synthetic revision-zero
destination so its own ticket can be applied and backed up. Setup and all
functional validation remain outside the preview/serialization/hash timing
window. The helper's synthetic transfer test also checks all three returned
values. No other test changed by this PR repeats product operations for timing.

The deadline cases retain real clocks and actual elapsed-time assertions.
The calculator's 150 ms race becomes a 250 ms race plus an explicit real-time
250 ms ceiling, so a synchronous stall cannot win merely by delaying the
watchdog callback. The wedged import's 100 ms response-timer assertion becomes
250 ms, and its 2000 ms completion assertion becomes 3000 ms. Run `41968034452`
logged the wedged test at `2026-11-05T04:44:26.7636318Z` with duration
`2058.055005ms`; its aggregate error does not distinguish the two assertions.
Run `42000811880`, attempt 2, logged calculator-close failure at
`2026-11-05T09:47:30.1230643Z` (`457.556562ms` total test duration). These are
the only deadline ceilings loosened, and a 300 ms main-thread stall still fails.

| Test file | Previous assertion | Replacement and why a regression fails |
| --- | --- | --- |
| `save-transfer-response-bounds.test.mjs` | One maximum event-loop gap below 50 ms. | Three preview/serialization/hash samples: each below 250 ms, best below 50 ms. Constant, alternating and cold 300 ms stalls fail the hard ceiling. Synthetic controls also reject a stall after an initially fast sample and consistently missing the tight bound. Fresh transferable inputs, functional-error propagation, string/record/wire caps and exact saved values remain checked. |
| `save-transfer-publication.test.mjs` | One gap below 200 ms for mapping and prepared replies. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. Constant and alternating 300 ms stalls fail the real gap assertion. |
| `save-transfer-wide-hook.test.mjs` | One gap below 100 ms across a million-entry hook round trip. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. Constant and alternating 300 ms stalls fail; the million-entry apply/export and hook-count checks remain. |
| `save-transfer-regressions.test.mjs` | Single 2000 ms preview, 100 ms hostile-import and 500 ms delimiter scans; wedged-worker timer below 100 ms and completion below 2000 ms. | Preview/import/delimiter assertions restored to `origin/main`, including cold-path coverage. Only the CI-failing wedged case changes: real timer below 250 ms and total completion below 3000 ms, with timeout rejection and queued parsing still required. A 300 ms main-thread stall fails. |
| `live-timings.test.mjs` | Calculator close must win a 150 ms host-time race. | Only the CI-failing calculator case changes: a 250 ms real race plus elapsed time below 250 ms. A 300 ms profile-write stall fails even if the race's timer is delayed. Picker acknowledgement tests retain their original 150 ms races; retirement, admission and late-handle assertions remain. |
| `process-profiles.test.mjs` | 1000/150 ms acknowledgement races and a 120 ms retirement sleep. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. Both 1100 ms cleanup mutations fail. |
| `scheduler.test.mjs` | Shutdown below 1000 ms with an unresponsive worker. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. An 1100 ms shutdown stall fails. |
| `session-residency.test.mjs` | Pooled shutdown below 500 ms, with a 1000 ms outer test timeout. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. A 600 ms shutdown stall fails. |
| `identity-index-scale.test.mjs` | A 5000-entry shared-alias snapshot below 1500 ms. | Restored byte for byte to `origin/main`: no exact-test CI timing failure was cited. The real 1500 ms ceiling rejects a 1700 ms snapshot stall. |
| `backup-file-browser.test.mjs` | Assume pointer layout is ready after a 50 ms sleep; probe immediately after navigation. | Wait for page load, animation-frame layout and centre hit ownership before native pointer input. Existing 10-second readiness and 60-second scenario backstops remain. Inoperable controls, missing native chooser events, incorrect accessibility relationships and any preview write still fail. Error names/messages are retained in diagnostics. The original CI failure's cause remains unconfirmed. |

The backup-browser 300 ms activation mutation is the explicit exception: it
also passed the original tests. Native chooser activation, purpose/filename
accessibility, preview immutability and all three input methods remain covered;
disabling the chooser must fail. Passing samples do not establish a production
latency guarantee under every scheduler or GC pause.

## Mutation verification

All 22 scenarios from `review-evidence.json` were rerun with the exact recorded
production replacements and `--test-name-pattern`, one test file per process.
The original production bytes were restored after each scenario, including
failures. The first two result columns come from the supplied review evidence;
the rework column is a fresh local run. `Old` is the original `origin/main`
test; `Reviewed` is PR head `0a46991d45ddb3c798e3bf04a09c223149b83b25`.

| Scenario | Old | Reviewed | Rework |
| --- | --- | --- | --- |
| `save-transfer-response-bounds-always-300ms` | FAIL | FAIL | FAIL |
| `save-transfer-response-bounds-periodic-300ms` | FAIL | FAIL | FAIL |
| `save-transfer-publication-always-300ms` | FAIL | FAIL | FAIL |
| `save-transfer-publication-periodic-300ms` | FAIL | PASS | FAIL |
| `save-transfer-wide-hook-always-300ms` | FAIL | FAIL | FAIL |
| `save-transfer-wide-hook-periodic-300ms` | FAIL | PASS | FAIL |
| `hostile-import-always-300ms` | FAIL | FAIL | FAIL |
| `hostile-import-periodic-300ms` | FAIL | PASS | FAIL |
| `large-preview-always-2200ms` | FAIL | FAIL | FAIL |
| `large-preview-periodic-2200ms` | FAIL | PASS | FAIL |
| `delimiter-scan-always-600ms` | FAIL | FAIL | FAIL |
| `delimiter-scan-cold-600ms` | FAIL | PASS | FAIL |
| `live-calculator-close-300ms` | FAIL | PASS | FAIL |
| `process-profile-cleanup-1100ms` | FAIL | FAIL | FAIL |
| `scheduler-shutdown-1100ms` | FAIL | PASS | FAIL |
| `pooled-shutdown-600ms` | FAIL | PASS | FAIL |
| `identity-snapshot-1700ms` | FAIL | PASS | FAIL |
| `backup-native-activation-300ms` (allowed exception) | PASS | PASS | PASS |
| `backup-native-chooser-disabled` | FAIL | FAIL | FAIL |
| `response-cold-300ms` | FAIL | PASS | FAIL |
| `process-profile-native-cleanup-1100ms` | FAIL | PASS | FAIL |
| `wedged-main-thread-300ms` | FAIL | PASS | FAIL |

## Remaining absolute timing assertions

These checks remain active. No matching latency-assertion failure was found in
the audited logs. They involve stateful scenarios, OS/inspector integration or
external process lifetime, so replaying just the measured expression would
change what is being tested. They need a dedicated harness change rather than
a mechanical retry around a consumed ticket, socket or child process.

| Test file | Absolute assertion still present |
| --- | --- |
| `account-reclaim.test.mjs` | A newly issued expiry is more than 86300000 ms in the future. This is a token lifetime check. |
| `calc-check.test.mjs` | A decode failure returns within 10000 ms, before its request watchdog. Historical 30000/120000 ms fixture-harvest test timeouts were separate from this assertion. |
| `command-performance.test.mjs` | Each ordinary save completes below 5000 ms, with zero whole-state JSON copies. Historical failures were saved-content hash mismatches. Commands mutate revisions. |
| `online-snapshot.test.mjs` | Snapshot barrier hold below 30000 ms. |
| `picker-audit-c2.test.mjs` | Trickle rejection below 3000 ms; deletion below 1000 ms; another account's read below 250 ms. The 10 ms waits assert that deliberately held uploads remain pending. |
| `picker-fairness-isolation.test.mjs` | Fair p95 below 500 ms and less than half FIFO p95; picker close below 2000 ms while work is held. |
| `prewarm-process-tree.test.mjs` | Process tree ready within 1500 ms and killed within a 2500 + 500 ms budget. Linux process-group integration. |
| `process-worker.test.mjs` | Inspector capture span below 500000 microseconds; deadline requests at 80 ms; disconnected calculator exit within 5000 ms. Historical failures were `/proc` `ESRCH` races, not a deadline assertion. |
| `release-runtime-v2.test.mjs` | Foreground pipes close below 10000 ms while a detached Windows child lives. |
| `save-transfer-regressions.test.mjs` | Real worker duration below `IMPORT_TIMEOUT_MS` (120000 ms); unchanged single-sample 2000 ms linear preview, 100 ms hostile-import gap and 500 ms delimiter scan. |
| `save-transfer-publication.test.mjs` / `save-transfer-wide-hook.test.mjs` | Original 200/100 ms response-gap ceilings. |
| `process-profiles.test.mjs` | Original 1000/150 ms completion races and real deadline waits. |
| `scheduler.test.mjs` / `session-residency.test.mjs` | Original 1000/500 ms shutdown ceilings. |
| `identity-index-scale.test.mjs` | Original 1500 ms shared-alias snapshot ceiling. |
| `save-transfer-responsiveness.test.mjs` | Preview/apply/JSON export/gzip export gaps below 150 ms; preview gap no larger than a same-run main-preparation baseline. The scenario mutates the store and consumes its publication ticket. |
| `server-reliability.test.mjs` | Repeated server close below 5000 ms; synchronous closed-store admission must reject within a 1000 ms backstop. |
| `tasks.test.mjs` | Real catalogue evaluation below 10000 ms. Historical failures were changed catalogue counts. |
| `warm-restart-worker.test.mjs` | Worker recovery below 5000 ms rather than waiting for the stale-lock minute. |

Additional completion races guard held resources rather than benchmark CPU
work: `invites-server.test.mjs` (2000 ms SSE closure),
`linux-multi-picker.test.mjs` (1000 ms independent picker progress),
`live-swap-client.test.mjs` (1000 ms ACK), `picker-jobs.test.mjs` (2000 ms close),
and `task-claim-server.test.mjs` (3000 ms task response).

Readiness polling with a deadline also appears in `duo-server.test.mjs`,
`live-timings-server.test.mjs`, `live-timings.test.mjs`,
`plugin-reads-server.test.mjs`, `prepared-collection.test.mjs`,
`process-worker.test.mjs`, `scheduler.test.mjs`,
`scheduling-server.test.mjs`, `scheduling-server.private.test.mjs`,
`warm-restart-worker.test.mjs`, `warmstart-server.test.mjs`, and
`y03-fuzz-ci-integration.test.mjs`. Browser scenarios use readiness backstops
through `until`. Test-wide watchdogs and child-command timeouts remain in
place; they prevent hangs and were not treated as latency benchmarks.

Injected-clock assertions, nonnegative telemetry checks, fixture durations,
same-run relative comparisons and Promise races between two explicit events
were inspected and excluded from the absolute-latency list.

## Local validation

All 22 exact production-code mutations from the review evidence were rerun,
one scenario/test file at a time, restoring production bytes after each scenario:
21 failed and only the allowed activation exception passed. All 161 tests in
the ten affected or restored files passed both normally and under contention,
sequentially on Windows / Node v26.13.0. Contention used exactly one Idle-priority
busy-loop process, whose priority was verified and which was stopped in a
`finally` block. No full suite was run. Linux / Node 24 validation belongs to
the PR's hosted checks.

Final runs used each file's normal dataset selection. An initial harness-wide
`open-starter` override caused an unrelated identity semantic failure and was
removed before rerunning the affected files and mutations. Response gaps were
27.6/53.3/65.7 ms normally and 34.3/62.9/45.6 ms under contention: every sample
met the hard ceiling and the best met the original target in both runs.

| Test file | Normal passed | Contention passed |
| --- | ---: | ---: |
| `backup-file-browser.test.mjs` | 3 | 3 |
| `identity-index-scale.test.mjs` | 5 | 5 |
| `live-timings.test.mjs` | 25 | 25 |
| `process-profiles.test.mjs` | 16 | 16 |
| `save-transfer-publication.test.mjs` | 4 | 4 |
| `save-transfer-regressions.test.mjs` | 12 | 12 |
| `save-transfer-response-bounds.test.mjs` | 7 | 7 |
| `save-transfer-wide-hook.test.mjs` | 2 | 2 |
| `scheduler.test.mjs` | 53 | 53 |
| `session-residency.test.mjs` | 34 | 34 |
| **Total** | **161** | **161** |

`git diff --check`, test-file registration and the affected files' port-policy
check passed. New cases live in an already registered test file; the new helper
is not a standalone test file. No production code changes are included.

### Final functional-sampling fix

The follow-up review demonstrated that an oversized display field in only the
first large response passed at head `1b734fb` while the original main test
rejected it. Every sampled result is now retained and checked. All assertions
from the original response test run for each sample, including applying that
sample's ticket and comparing the backed-up saved values. The helper's
synthetic transferable-input test also checks every returned value. Other
sampling/readiness loops in the four changed test files were inspected; none
repeats a product operation for a timing statistic.

These temporary first-sample-only mutations were run sequentially on Windows /
Node v26.13.0 and reverted byte for byte. Each failed on the intended functional
assertion, rather than a timing ceiling.

| Mutation | Result |
| --- | --- |
| Exact reviewer injection: a 4,096-character display field in only the first large response | FAIL: 512-character display cap |
| Only the first large response reports zero added tasks | FAIL: expected added-task count 2 |
| Only the first large response returns an invalid publication ticket | FAIL: validated import result required |
| Only the first synthetic helper result returns 43 instead of 42 | FAIL: all-results equality |

After reverting all injections, only the four changed test files were rerun,
one file at a time. No full suite or contention run was started for this fix.

| Test file | Passed | Duration |
| --- | ---: | ---: |
| `save-transfer-response-bounds.test.mjs` | 7 | 16.41 s |
| `save-transfer-regressions.test.mjs` | 12 | 23.77 s |
| `live-timings.test.mjs` | 25 | 11.12 s |
| `backup-file-browser.test.mjs` | 3 | 37.08 s |
| **Total** | **47** | |

All three response sizes were 17,835 bytes; measured gaps were
23.6/43.5/55.1 ms. Every gap stayed below 250 ms and the best stayed below
50 ms. `git diff --check`, registration (740 files, without test execution)
and the affected files' port-policy check passed. Production files have no
diff against main; Linux / Node 24 checks remain the hosted CI's responsibility.
