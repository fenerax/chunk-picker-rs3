# Request failures — 2026-10-25

START: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd`.

Scope: the public web client and public/synthetic fixtures only. No server, catalogue, changelog, roadmap, live save, or GitHub changes. Node 24.20.0 on this test machine. The first attempt used the installed Node 24.19.0; final suites use `/workspace/.tools/node-v24.20.0-linux-x64/bin`.

## Message matrix

The same `api()` boundary serves all calculation routes, including tasks, predict, area-check, teleports, helper-drops, training-plan, death-estimates, chunk-planning, sandbox/evaluate, prediction-intent, pool-ranking-intent, and profile/preview. Read-only POST calculations are not saves. No ordinary request is automatically replayed at this boundary.

| Injected failure | Before | After |
| --- | --- | --- |
| 429, Retry-After | Server message or `Request failed (429)`; header ignored | “Too many requests. Try again in N seconds.” Same route cannot dispatch early, even with changed query parameters. Seconds and HTTP dates work. Without a usable header, the message asks the player to try again in a moment. |
| 503, Retry-After | Raw server message; HTML error pages produce a JSON parsing exception | “The picker is busy or restarting.” Retry guidance uses the header. Non-JSON failure bodies preserve HTTP status and do not expose parser errors. |
| 409, revision conflict | State-bearing save conflicts already adopt authoritative state; other routes expose server text | The existing save-conflict adoption/review guard remains. Other conflicts say “The saved map changed. Review the latest view and try again.” `TASK_RESULTS_UNAVAILABLE` stays a distinct wait-for-a-player condition. |
| 413 | Server text or bare status, with no dependable next step | “This request is too large. Use a smaller file or make a smaller change, then try again.” |
| Offline / dropped fetch / ECONNRESET | Browser/transport error text | “Could not reach the picker. Check your internet connection, then try again.” |
| Interrupted/unreadable successful response | JSON/reader exception | “The response was interrupted or unreadable. Try again.” Saves outside the receipt transport instead say their outcome is unconfirmed and direct the player to History. |
| Abort after changing/closing a view | Existing AbortError guards discard obsolete work | Preserved: aborts are not converted into visible network failures. |

Known HTTP failures ignore their raw message. Other validation errors retain short plain guidance but reject HTML, multiline exceptions, stack text, and transport diagnostics. Codes remain available to existing controllers.

## Failure × surface: before → after

“Retry works” below means the injected failure settles, the fixture supplies a healthy response, and the same screen action succeeds. A request that has not settled at all is a separate limitation below. The shared message matrix applies to every network cell.

| Failure | Tasks sidebar / on-demand Tasks | Chunk Info Tasks (Possible Tasks) and Clues | Chunk Info Preview | Teleports | Training plan (both entry points) | Receipt-backed save |
| --- | --- | --- | --- | --- | --- | --- |
| 429 | Raw message; Retry can be overwritten by health status → plain wait, Retry retained, no dispatch before Retry-After; later Retry works | Existing in-place Retry → same Retry, plain wait, later load succeeds | Error alone; must switch/reopen tab → plain error plus **Retry preview**, successful retry evicts failed prediction | Existing Retry availability → plain wait, busy clears, same retry works | Existing Plan controls → plain wait, inputs retained, busy clears, Plan works later | Terminal rejection cleared pending bytes → bounded retry of the **same** bytes/receipt ID; server wait is persisted; long waits pause with Retry save guidance |
| 503 | Health check could erase Retry with “recovering” text → error and Retry survive health events; on-demand failure clears busy | Existing Retry → plain busy/restart message and working Retry | Error only → plain busy message and working Retry preview | Existing Retry → plain busy message; busy false; retry works | Existing controls → plain busy message; no stuck planning; retry works | Existing finite exponential retries → same receipt protection, now honors Retry-After even for HTML error responses |
| 409 | Raw message → plain conflict; no stale result adopted; Retry works | Existing Retry → plain conflict; Retry works | Failed promise evicted, error only → same eviction plus Retry preview | Existing Retry → plain conflict; retry works | Existing controls → plain conflict; inputs kept; retry works | Existing authoritative-state adoption and explicit review → preserved; a genuine terminal refusal clears pending transport bytes without falsely claiming success |
| 413 | Raw message → smaller-request advice and retained Retry | Existing Retry → smaller-request advice and retry; large inputs must actually be reduced | Error only → smaller-request advice and Retry preview | Existing Retry → smaller-request advice and retry | Existing controls → smaller-request advice and later Plan works | Existing terminal refusal → preserved, now plain advice; no automatic replay of a definite oversized refusal |
| Offline / ECONNRESET | Raw TypeError; health events could replace recovery UI → plain connection advice, Retry stays; both task loaders recover | Existing Retry → plain connection advice; retry works | Error only → connection advice plus working Retry preview | Existing Retry; busy already cleared → same behavior with plain connection advice | Existing controls and busy cleanup → same recovery with plain connection advice | Existing receipt retry → preserved: a commit followed by a lost reply is confirmed once with the original request ID and revision |
| Event stream disconnect | Native EventSource retries dropped links; repeated CLOSED errors could schedule duplicate streams → native retries retained, one CLOSED timer, exponential 1–30 s plus jitter | Existing content remains usable → preserved | Existing content remains usable → preserved | Existing dialog remains usable → preserved | Existing form/draft remains usable → preserved | Pending receipt is never acknowledged merely because the stream opens; no save is replayed by stream reconciliation |
| Stream revision followed by failed state read | “Sync failed”; can stay stale forever if no further revision arrives → read retries at 1, 2, 4…30 s, also respecting Retry-After, then adopts latest state | Existing draft preservation → retained during state reconciliation | Existing invalidation when actual state changes → preserved | Existing review guards → preserved | Existing review guards → preserved | State reads do not send commands; unsent note drafts remain intact |

Additional Chunk Info tabs were inspected in source. Contents, saved notes, and retained access override controls do not require a fresh calculation to remain usable. Filtered quest progress already clears busy and offers **Retry quest progress**. Access geometry already offers **Retry outlines** and keeps override controls available; it intentionally uses a generic outline-loading message rather than exposing HTTP detail. Inside maps evict failed cache entries and display the shared plain error; switching away/back retries. Travel-into-chunk clears its loaded flag on failure; closing/reopening retries. These existing actions were retained. Possible Tasks’ “If unlocked” view can be retried by selecting that filter again; failed predictions are not cached permanently.

Background prediction/pool-ranking preparation intentionally remains quiet: it is speculative, cannot save gameplay, and failure never schedules a hot retry loop. A later explicit action retries through the shared cooldown.

## Save safety

The action-session outbox still persists the intention and frozen command before dispatch, reuses the receipt ID/revision on ambiguous retries, serializes later commands, and requires a valid receipt before confirmation. No new save retry mechanism was added. Tests cover a commit followed by connection loss and then 429/503: three wire attempts, identical bytes, one application of the action. A wait longer than the retry budget remains pending across client recreation, and even manual Retry save cannot send before the stored deadline. Definite 409/413 refusals remain reviewable failures.

Reviewed import/restore, RuneMetrics apply, and ephemeral original-sync are existing one-shot operations outside this receipt transport. They remain single-dispatch, with no newly introduced retry. When a transport/body-read failure makes their outcome unknown, the client now says the save may already have arrived and to check History before repeating it. Exactly-once recovery is asserted for receipt-backed commands; the client cannot prove the outcome of these pre-existing one-shot endpoints without server support.

## Changes by file

| File | Change |
| --- | --- |
| `app/web/live-swap-client.mjs` | Shared JSON/error/cooldown helpers in an already-served browser module; Retry-After-aware receipt retry, persistent wait deadline, safe registration/recovery wording, non-JSON error handling. |
| `app/web/screen-commands.mjs` | Use the shared reader; preserve conflict adoption; warn about uncertain one-shot saves rather than encouraging a blind retry. |
| `app/web/screen-loading.mjs` | Use the reader for provisional tasks too; keep Retry through health updates; show on-demand errors; clear busy when an on-demand request supersedes another player’s load. |
| `app/web/screen-context.mjs` | Explicit task-load-error state. |
| `app/web/screen-chunks.mjs` | In-place Retry preview after failure. |
| `app/web/screen-live.mjs` | Single CLOSED reconnect timer; failed revision-state reads retry with exponential backoff and Retry-After. |
| `tests/browser-screen-harness.mjs` | Install shared helpers and a controllable clock. |
| `tests/request-failures.test.mjs` | New synthetic shared-API failure matrix. |
| `tests/web-browser.test.mjs` | Screen failure/recovery matrix, stream backoff, draft protection, cooldown and busy-state regressions. |
| `tests/live-swap-client.test.mjs` | Receipt safety through throttling/busy/lost replies and persisted cooldown; adapt VM collaborators/plain wording. |
| `tests/helper-training.test.mjs`, `tests/info-panels.test.mjs` | Failure/retry matrix for the two training planners. |
| `tests/viewer-task-response.test.mjs` | Keep viewer metadata tests at the new shared boundary and verify unavailable-task guidance. |
| `scripts/test-selection.mjs` | Classify the new test as quick. |
| `scripts/perf/request-failures.mjs` | Reproducible START/candidate alternating synthetic measurements and behavioral probes. |
| `docs/qa/request-failures-2026-10-25.md` | This matrix, validation evidence, measurements and limits. |

## Harness and validation

- `tests/request-failures.test.mjs`: real shared API, fake fetch, all twelve calculation routes; 429/503/409/413/offline/reset/HTML failures, no implicit retry, healthy retry, cooldown dates/seconds, aborts and unreadable replies. Classified in `scripts/test-selection.mjs`.
- `tests/web-browser.test.mjs`: shipped screen graph and DOM fixtures; six failure kinds across both Tasks loaders, Possible Tasks, Preview and Teleports; Retry-After click suppression; busy cleanup after an aborted player request; duplicate CLOSED errors; state-read retries without save replay or draft loss.
- `tests/helper-training.test.mjs`, `tests/info-panels.test.mjs`: both training-plan surfaces, each failure kind, retained form values, busy cleanup, and successful later calculation.
- `tests/live-swap-client.test.mjs`: exact-byte receipt recovery with rate/busy waits, persistent cooldown, non-JSON throttling, finite pause and existing queue/ownership/receipt guards. Existing VM fixtures explicitly supply the shared helpers.
- `tests/viewer-task-response.test.mjs`: preserves compact task metadata/header behavior and the special saved-task-unavailable condition.

Final quick suite: **2,331 passed, 0 failed, 65 skipped** (2,396 cases; 272 files; 96.47 s), Node 24.20.0. Final full suite: **5,402 passed, 0 failed, 137 skipped** (5,539 cases; 613 files; 406.05 s), with the process/scratch setup below.

The initial quick attempt on Node 24.19.0 reported 2,328 passed, 2 failed, 65 skipped. One failure exposed the static module allowlist; the helper now lives in the already-served `live-swap-client.mjs`. The other was the coverage-reporter’s native-count check; it passes with the provided Node 24.20.0 runtime. Neither required a server/tooling implementation change.

The first full run completed **5,387 passed, 15 failed, 137 skipped** (613 files, 407.28 s). Fourteen failures were `EROFS` while existing synthetic postmerge fixtures created temporary directories under `/workspace/.local`, outside the initially granted writable paths. Re-running those three test files with that scratch path writable passed **15/0**. The remaining failure was the existing orphan-worker test: this container leaves orphaned children as zombie PIDs, so its `kill(pid, 0)` check never observes `ESRCH`. With a process-local Linux subreaper, the unchanged worker test file passed **8/0**. No worker/server/release-tooling implementation or assertion in those failing test files was changed.

The final full run uses the same `npm test`, Node 24.20.0, default adaptive concurrency, writable checkout/`/tmp`/`/workspace/.local`, and this temporary wrapper. It changes process cleanup only:

```python
import ctypes, os, subprocess, sys
assert ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0
os.environ['PATH'] = '/workspace/.tools/node-v24.20.0-linux-x64/bin:' + os.environ['PATH']
child = subprocess.Popen(['npm', 'test'])
while True:
    pid, status = os.waitpid(-1, 0)
    if pid == child.pid:
        sys.exit(os.waitstatus_to_exitcode(status))
```

## Measurements

Run `node scripts/perf/request-failures.mjs 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd` under Node 24.20. It reads baseline client code directly from START, not origin/main. Eight pairs alternate before/after and after/before, each in fresh child processes. Each child warms 2,000 calls, then times 10,000 successful shared-API reads with an identical 100-task synthetic JSON payload. Network and DOM rendering are excluded; calculation-feedback timers are stubbed identically. Peak RSS is the child high-water mark for that dispatch workload, not browser memory. Spread means minimum–maximum.

| Metric | Before median (min–max) | After median (min–max) |
| --- | --- | --- |
| Successful API read, µs/call | 33.37 (32.79–34.90) | 33.91 (32.81–34.91) |
| Child peak RSS, MiB | 39.19 (39.06–39.31) | 39.50 (39.19–39.69) |

Paired latency delta (after minus before): median **+0.14 µs/call**, spread **-0.75 to +2.00**. Timing medians summarize the eight run means; they are not individual-request percentiles.

| Pair | Order | Before µs/call | After µs/call | Delta µs | Before peak MiB | After peak MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | before → after | 32.787 | 34.537 | +1.750 | 39.188 | 39.562 |
| 2 | after → before | 34.903 | 34.150 | -0.753 | 39.309 | 39.684 |
| 3 | before → after | 33.521 | 34.912 | +1.392 | 39.246 | 39.688 |
| 4 | after → before | 32.826 | 34.830 | +2.004 | 39.188 | 39.188 |
| 5 | before → after | 33.493 | 33.442 | -0.051 | 39.184 | 39.434 |
| 6 | after → before | 33.338 | 33.660 | +0.322 | 39.188 | 39.309 |
| 7 | before → after | 33.406 | 33.135 | -0.271 | 39.188 | 39.434 |
| 8 | after → before | 33.136 | 32.811 | -0.326 | 39.059 | 39.562 |

Behavioral probes were identical across all eight pairs:

| Probe | Before | After |
| --- | --- | --- |
| Raw exception/stack messages exposed, six failure kinds | 6/6 | 0/6 |
| Wire dispatches from five immediate retries during a 5-second Retry-After | 5 | 1 |
| Reconnect timers from two repeated CLOSED events | 2 | 1 |

These probes and the timing/RSS samples use START and the candidate in alternating fresh processes. The separate receipt tests assert one committed action despite connection loss and subsequent throttling/busy replies. No production network, physical phone, or browser-memory measurements are implied.

## Risks and limits

- The full suite needs the test scratch permissions and orphan-process reaping described above in this container.
- These are deterministic transport/DOM fixtures, not a physical phone or real offline-radio/browser test. Native EventSource controls reconnect timing while CONNECTING and does not expose HTTP status/Retry-After headers; the client only manages CLOSED backoff and its own state reads.
- A fetch that never settles can still wait on existing browser/network behavior for ordinary calculations. Receipt-backed saves retain their existing request deadlines and finite retry budget. No arbitrary new calculation timeout was imposed on long-running work.
- Cooldowns for calculations are per pathname and per page, intentionally shared across query/player changes; reloads clear them. Save cooldowns persist with the existing session outbox. Headers provide relative/date waits, not a server clock synchronization protocol.
- Failed Tasks keep their Retry action through worker-health events. A player can explicitly retry or a later state/task event can request fresh work; failures do not continuously recalculate merely because health says ready.
- The unsupported one-shot save ambiguity described above remains; the safer message prevents the client from encouraging a blind repeat.

Recommendation: **MERGE-CANDIDATE**.
