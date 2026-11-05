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

Measurements retry only a timing miss, up to three independent executions.
They stop at the first passing sample. Each sample must meet the original
absolute ceiling; there is no subtraction of runner delay or adaptive ceiling.
Operation errors propagate immediately. Worker inputs are rebuilt before each
sample because transferring a buffer consumes it. Synthetic fixture creation
and copying remain outside the measured product operation.

| Test file | Previous assertion | Replacement and why a regression fails |
| --- | --- | --- |
| `save-transfer-response-bounds.test.mjs` | One maximum event-loop gap below 50 ms. | Up to three independent preview/serialization/hash measurements, each with the same 50 ms ceiling. All string, record and wire caps and exact saved-value checks remain. A repeatable 250+ ms stall breaches every sample. A synthetic 275 ms negative control verifies rejection; another test verifies fresh transferred inputs and immediate propagation of functional failures. |
| `save-transfer-publication.test.mjs` | One gap below 200 ms for mapping and prepared replies. | Up to three samples of each read-only operation, still below 200 ms. The 128/64 MiB label fixtures, reply caps, exact saved bytes and publication checks remain. A repeatable 250+ ms reply stall still fails. |
| `save-transfer-wide-hook.test.mjs` | One gap below 100 ms across a million-entry hook round trip. | Up to three independent previews below 100 ms. Exactly one hook invocation is required per sample; the final apply/export must retain all one million entries. Repeated wide-dictionary blocking still breaches every sample. |
| `save-transfer-regressions.test.mjs` | Single 2000 ms linear-preview, 100 ms hostile-import and 500 ms delimiter-scan measurements; wedged import's timer below 100 ms and completion below 2000 ms. | Read-only probes use up to three samples at their original ceilings. A recurring quadratic lookup, backtracking scan or hostile-import stall still fails. The wedged worker uses a controlled 100 ms active deadline: the event loop must run, rejection must remain pending at 99 ms, the next millisecond must reject the job, and the queued parser must complete. Losing the deadline or poisoning the queue fails even when the host is slow to start or terminate a worker. The 120-second production import budget remains enforced. |
| `live-timings.test.mjs` | Stop/close must win a 150 ms host-time race. | Mock cleanup timeouts after acknowledged admission. Assert cleanup remains pending at 19 ms and completes at the configured 20 ms, with the missing acknowledgement withheld. Real inspector/file work is joined separately. Missing cleanup bounds, premature retirement, starting another calculator or failing to stop a late handle still fail. The existing native profiler integration test remains. |
| `process-profiles.test.mjs` | 1000/150 ms acknowledgement races and a 120 ms sleep for retirement. | Controlled Date/timers test the 30 ms capture and 20 ms cleanup deadlines on either side of the boundary. A withheld acknowledgement, missing stop, premature retirement, wrong retirement or missed late-handle cleanup fails. |
| `scheduler.test.mjs` | Shutdown below 1000 ms with an unresponsive worker. | Shutdown remains pending at 19 virtual ms and resolves at the requested 20 ms; active/queued requests must reject. A missing shutdown bound leaves the close promise unresolved. |
| `session-residency.test.mjs` | Pooled shutdown below 500 ms, with a 1000 ms outer test timeout. | The same 19/20 ms check, plus close-promise identity and final closed state. A 30-second test watchdog only catches deadlocks; the product deadline is asserted at 20 virtual ms. |
| `identity-index-scale.test.mjs` | A 5000-entry shared-alias snapshot below 1500 ms. | Count Set iteration during the real snapshot: fewer than 32 visits per catalogue entry, with exact entries/aliases still checked. Current behavior visits 30000 entries. A mutation removing shared-alias deduplication failed at 50020000 visits; production source was then restored byte for byte. |
| `backup-file-browser.test.mjs` | Assume pointer layout is ready after a 50 ms sleep; probe immediately after navigation. | Wait for page load, animation-frame layout and centre hit ownership before native pointer input. Existing 10-second readiness and 60-second scenario backstops remain. Inoperable controls, missing native chooser events, incorrect accessibility relationships and any preview write still fail. Error names/messages are retained in diagnostics. The original CI failure's cause remains unconfirmed. |

The transfer targets remain below 100 ms where originally specified. A
repeatable stall above 250 ms fails the transfer probes changed here even
without an `origin/main` comparison. Passing samples do not establish a
production latency guarantee under every scheduler or GC pause.

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
| `save-transfer-regressions.test.mjs` | Real worker duration below `IMPORT_TIMEOUT_MS` (120000 ms). This is the enforced product budget. |
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

All 157 tests in the ten changed test files passed on Windows / Node v26.13.0,
one file at a time. No full suite was run. Linux / Node 24 validation belongs to
the PR's hosted checks.

| Test file | Passed |
| --- | ---: |
| `backup-file-browser.test.mjs` | 3 |
| `identity-index-scale.test.mjs` | 5 |
| `live-timings.test.mjs` | 25 |
| `process-profiles.test.mjs` | 16 |
| `save-transfer-publication.test.mjs` | 4 |
| `save-transfer-regressions.test.mjs` | 12 |
| `save-transfer-response-bounds.test.mjs` | 3 |
| `save-transfer-wide-hook.test.mjs` | 2 |
| `scheduler.test.mjs` | 53 |
| `session-residency.test.mjs` | 34 |

`git diff --check`, test-file registration and the affected files' port-policy
check passed. New cases live in an already registered test file; the new helper
is not a standalone test file. No production code changes are included.
