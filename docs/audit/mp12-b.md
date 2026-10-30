# MP12B: sessions, sign-in and owner UI

START `828cf30cb36e00e45d6ca25c6acd42bac5200460`. Read the rebuild lanes and the MP1 registry, MP6 browser and MP9 owner-control contract sections. Used synthetic providers and temporary roots only. No application changes or private-data workloads. Public sign-up approval remains outstanding.

Counts: **P0: 0; P1: 0; P2: 1; P3: 0.**

| id | severity | route or file:line | attacker steps | impact | suggested fix | test name |
| --- | --- | --- | --- | --- | --- | --- |
| MP12B-1 | P2 | `app/web/account-panel.mjs:108`, `app/picker-router-deletion.mjs:17` (`POST /api/account/delete`) | Keep an account-deletion dialog open for account A on the shared picker. A second tab signs in as account B after the dialog's session preflight response is produced and before deletion dispatch. The browser sends B's cookie with the same `legacy` picker selector and an empty body. | The server deletes B although the confirmed dialog names A; A survives. Requires two legitimate sessions in the same browser and a cookie-switch race. This is a stale UI integrity failure; the test does not demonstrate remote session theft or arbitrary-account deletion using A's cookie alone. | Issue an opaque account/session-bound destructive-action token during confirmation, require it on deletion, and validate against the current session inside the deletion queue. A picker selector alone cannot distinguish accounts sharing a picker. | `MP12B: shared deletion stays bound to the account confirmed by the dialog` |

The reproducer executes the real account panel against real HTTP routes. It injects a cookie replacement between the session response and deletion request, without changing application code or fabricating server permissions. Observed: deletion HTTP 200, A's session HTTP 200, B's session HTTP 401. The TODO asserts refusal (401, 403 or 409) and survival of both accounts. With distinct owned pickers, the equivalent race is refused with 403; both accounts survive. MP9's temporary account-action lock prevents a monitor from retiring the document during confirmation, but cannot lock cookies against another tab.

## Checked areas

- OAuth state, cookie binding, provider mix-up, duplicate state and replay: new callback regression passes; `app/signin.mjs:246` consumes the pending entry and validates a single matching state/provider before exchange.
- OAuth expiry and bounded pending state: existing `signin-provider` capacity/expiry test and `signin-server` expiry test pass; pending entries expire after 10 minutes and are capped at 1,000.
- OAuth redirects and provider exchange: new redirect regression verifies fixed provider and callback origins and root-only success redirect; existing PKCE, 10-second timeout, response-size and generic-error tests pass. No browser-supplied token is accepted.
- Google claims: new nonce-mismatch regression and existing issuer/audience/expiry/issued-at regressions pass. The ID token is received only from the fixed TLS token endpoint (`app/signin.mjs:189`); this is a source review and synthetic-provider test, not a live-provider integration test.
- Session fixation and logout: new rotation/logout regression confirms independently generated tokens and server-side invalidation of the signed-out token; existing account-storage tests confirm hashed storage, session bounds and expiry. Existing other-device sessions intentionally remain valid.
- Provider linking: new test logs out during a blocked provider exchange while another session for the same account survives; the callback returns 401, no new cookie is issued and the second provider is not linked. The exact initiating session is rechecked inside the mutation queue (`app/signin.mjs:269`).
- Revoked/deleted accounts: new deletion test invalidates every old token for that account while another account survives; existing sign-in/account-storage tests cover invitation revocation, provider removal, account deletion and session revocation. Registry tombstones and active membership/provider checks gate session resolution (`app/storage/invites.mjs:99`).
- MP6 stale documents and cookies: all 30 existing browser-session tests pass, including same-picker account switches, cancelled queued writes, retired pages, delayed responses, scoped storage and failed-cleanup refusal. New distinct-owned-picker deletion-race regression confirms the server's picker selector fence. The shared destructive-action exception is MP12B-1.
- Public admin cookies: new HTTP regression tests both raw master cookies and issued admin-session cookies; pages expire the stale cookie and APIs, public sign-out and master bearer requests return 403. Private administration remains available.
- Owner UI and server authority: all 16 existing MP9 tests pass; new tests confirm account/invitation/overlay administration, process control and raw snapshots are refused to owners. Forging owner role/shared flags in the browser still cannot delete the shared picker. Supplied account targets and foreign-origin deletion are refused.

## Validation

Node 24.19.0. Focused files ran one at a time:

| File | Pass | Fail | TODO |
| --- | ---: | ---: | ---: |
| `tests/picker-audit-b.test.mjs` | 8 | 0 | 1 (fails at the intended account-preservation assertion) |
| `tests/signin-provider.test.mjs` | 2 | 0 | 0 |
| `tests/signin-server.test.mjs` | 24 | 0 | 0 |
| `tests/picker-owner-ui.test.mjs` | 16 | 0 | 0 |
| `tests/picker-browser-session.test.mjs` | 30 | 0 | 0 |
| `tests/accounts-storage.test.mjs` | 8 | 0 | 0 |

The new file is classified quick/open-f2p in `scripts/test-selection.mjs`. Ran the quick suite exactly once at the end, using `RS3_TEST_CONCURRENCY=1 npm run test:quick`: **2,672 passed, 0 failed, 68 skipped, 1 TODO; exit 0; 249.58 seconds; 300 files**. The TODO failed at the intended account-preservation assertion, not fixture setup. The unchanged START files contributed **2,664 passes**, and the new non-TODO tests contributed **8**; their sum is the final pass count. This is accounting from the single final run, not a separately timed baseline run. Existing test files are unchanged; classification adds only the new file. Focused total: **88 passed, 0 failed, 1 TODO**. Full `npm test` was not run; no application code changed.

`git diff START --check` passed, and all three changed files were staged with `git add -A`. Recommendation for opening sign-up: **NEEDS-WORK** until MP12B-1 is fixed or explicitly accepted by the owner. There is no second or third confirmed finding in this part.

Application-file differences against START: **0**. Performance before/after medians, spread and peak memory were not measured because executable application code is unchanged. No service-capacity conclusion is made. The reproduced shared-account race is the open fix before sign-up approval; no P0/P1 isolation or server-crash finding was reproduced in these areas. This limited audit does not certify the other multiplayer areas.

## Outside my scope

- Global registration/provisioning quotas and shared admission pressure belong to the parallel limits audit; no additional finding is claimed here.
