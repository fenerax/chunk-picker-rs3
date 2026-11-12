# Task quota HTTP test investigation

The failing assertion is the second login's first `GET /api/tasks?memberId=owner` in `tests/picker-limits-http.test.mjs`. The original failure recorded status 503 but discarded the response body. The test and this assertion originate in `5f02ea6a`, before the launch-basics branch. Neither `786d0803` nor `19ff12a0` changes the cold admission or calculator deadline implementation.

Classification: a confirmed load-dependent test design, with the exact historical 503 source still unproven. The one allowed instrumented run retained admission transitions, context-open diagnostics, calculator lifecycle events and response status/body. It completed both cold opens and returned 200 for the second login, with no worker errors, deadline expiries or restarts. It did not reproduce the failure and is not credited as passing verification of the original failing run.

The deterministic regression below establishes one concrete 503 mechanism: a cold context held behind its directory barrier receives `Picker admission deadline` when the admission clock reaches the existing deadline. The old quota test allowed ordinary filesystem latency and rule preparation to trigger that same deadline before it could exercise its intended quota assertion. This mechanism predates the branch; the missing historical response body prevents claiming it was the particular event that fired in the earlier run. No new cap/limiter 503 regression was found.

## Response paths

The request first acquires an owned picker context, then charges the expensive-request quota, then evaluates tasks. A new login has a registry picker directory but no resident context. OAuth completion does not prepare that context.

| Boundary | Possible response and relevance |
| --- | --- |
| Cold picker admission (`app/picker-admission.mjs:5`) | 503 for deadline, account-full, queue-full, cancellation, shutdown or a failed cold-start lease. The unchanged 2,000 ms deadline includes waiting, filesystem work, sidecar opening and rule preparation, not just calculator queueing. |
| Residency (`app/picker-router.mjs:18`, `:82`) | 503 when closing, when only the compatibility context is permitted, when an opened context becomes unavailable, or when no slot becomes available before bounded acquisition attempts are exhausted. The fixture permits seven contexts and opens only two owned pickers sequentially. |
| Cold factory (`app/server.mjs:456`, `:474`) | 503 for a nonempty unbound directory or a saved roster incompatible with registry membership. Fresh synthetic stores have neither condition. Untyped factory/filesystem failures also become a generic 503 at the router catch (`app/picker-router.mjs:319`). |
| Context admission (`app/picker-context.mjs:2084`) | 503 when closing, frozen or in standby, including `PICKER_UPDATING` from handover. This test performs no shutdown, backup, restore or writer transfer during requests. |
| Task availability (`app/picker-context.mjs:1361`) | 503 without a task worker. The fixture starts a worker before listening; successful requests from the first login also establish its presence. |
| Calculator admission (`app/tasks/scheduler.mjs:31`, `:1344`) | Fairness, queue and waiter capacity return 429. Closed/retired picker or restart-required worker returns 503. A stuck health flag alone does not reject a request. |
| Calculator deadlines (`app/tasks/scheduler.mjs:965`, `:972`) | Queue wait returns 504 with `CALCULATION_WAIT_TIMEOUT`; execution/first-calculation expiry also returns 504. Worker startup failure, crash, memory retirement or explicit restart can interrupt work with 503 (`:883`, `:1176`, `:1219`, `:1624`). Worker-returned ordinary calculation errors can also produce 503. Lifecycle diagnostics distinguish these from cold admission. |
| Foreground readiness (`app/picker-context.mjs:638`) | The list-loading wait can return 503 for side calculations. This full task-list request uses `evaluate` on the foreground lane and does not call that wait. |
| Store busy (`app/storage/store.mjs:1036`, `:1210`) | Storage mutation admission can return 503 while frozen/closing. This GET reads the committed calculation snapshot; it does not enter those mutation queues. Context handover fencing above remains applicable. |
| Other routes | Backup-import admission, service checkpoint capture, full-state response budgets and plugin-key revoke recovery have 503 responses, but their route/method guards exclude this GET. The checkpoint coordinator waits for capture completion on ordinary requests. |
| Launch caps and quotas | Registry ceilings return 409. Expensive-request, plugin-key and key-change quotas return 429. The cold-start lease is the limiter's only 503 path and is unchanged by the accounting commit (`app/security/picker-limits.mjs:162`). No plugin key is created or revoked by the failing case. |

## Other quota assumptions

Each fixture owns a new limiter; restart reconstructs active key counts from synthetic storage and starts new rate windows. Counting attempted key-management operations conservatively, including active-key refusals:

| Case | Maximum changes per login/member in one window |
| --- | --- |
| Context eviction/restart/global-key quota | Two before restart; at most two afterwards. |
| Three-per-member cap | Three before restart; one afterwards. |
| Plugin traffic budgets | Two for the first login, one for the second. Plugin polling uses a separate budget. |
| Key churn refusal | Explicit four-change allowance: create, revoke, duplicate revoke, create. The following create and revoke must be refused without changing registry or key-file bytes. |
| Picker/account deletion | Three for the first login across deletion/recreation; one for the second and two for the third. Deletion releases active key quota, not the key-change budget. |
| Remaining cases | Zero key changes. |

All ordinary cases remain below the default 12 changes per minute per login/member. Incremental counts are exercised by the restart, eviction, quota refusal and deletion cases; their storage assertions must remain in place.

## Rebuild and coverage

Cold admission now accepts a timer clock, passed through the router from the server's existing `schedulingClock`. Defaults still use real timers with the same 2,000 ms deadline. The HTTP fixture uses its own manual clock, so filesystem progress cannot race that deadline. The quota case also uses the existing synthetic worker-factory seam: it retains real HTTP, OAuth, sessions, registry, limiter and scheduler behavior while completing synthetic task work through microtasks. Other cases retain native workers. Admission metrics still measure real elapsed time; no test asserts those measurements.

| Original coverage | Rebuilt coverage |
| --- | --- |
| Two sessions consume the same login's two-request budget | Both still return 200; the next request returns 429 with Retry-After. |
| Another login retains its own allowance and shares the service budget | Its first request still returns 200; its next returns 429. Synthetic result markers also verify the selected picker. |
| Cold opening happened incidentally under a real deadline | Both successful opens are observed; no deadline is advanced in the quota case. A separate held-directory test explicitly advances the unchanged deadline and checks the exact 503 message and Retry-After. |
| Registry and key quotas across eviction, restart and deletion | Remaining cases and storage-preservation assertions retained, with cold-admission deadlines controlled by the fixture clock. |

The held-directory test registers release cleanup before setup, holds the existing storage barrier without changing storage code, waits for observed admission start, advances the manual clock and verifies zero calculator dispatches and unchanged registry records. Its `finally` releases the barrier and awaits observed lease release. A subsequent declared request returns 200 under a one-request task allowance, proving cold refusal did not consume that allowance; the following request returns 429. These are explicit lifecycle phases, not retries seeking a pass. No deadline was raised and no per-test timeout, wall-time assertion or repetition loop was added.

## Local verification

After the rebuild, `tests/picker-limits-http.test.mjs` ran once: **15 passed, zero failed/cancelled/skipped/todo**. This includes the original quota assertions, the controlled admission-deadline response and all key-churn/count/persistence cases. The run used Node 24.20.0, the complete per-file environment, the shared heavy lock, BelowNormal priority and `--test-concurrency=1`. Fixtures were synthetic and ports were ephemeral. No other test file or repetition loop was run for this follow-up. The preceding single-case diagnostic is recorded separately and does not erase the historical failure. Syntax checks and `git diff --check` also passed.

The repository's hosted stability receipts and full CI remain landing requirements; a single local file run does not establish those receipts.
