# Startup recovery after a restart

Investigation base: `19f9d5425b962ca0a0c53a8905eb81ca147d073a` (rel37).
All reproductions used loopback scratch servers and synthetic player state.
The live server was not contacted.

## Confirmed failure and startup map

The closest match for the unchanged static shell is the browser branch of
`app/dataset-runtime.mjs`, originally lines 15–17. Its top-level dataset JSON
fetch had no retry or deadline. A 503, network error, gateway error, unreadable
body or indefinitely pending request prevented main's imports from finishing.
The error handler at the end of `app/web/main.mjs` was never installed. Dataset
JSON loaded by imported modules had the same problem and cached rejections.

After imports finish, main constructs the screen factories once and calls
`screen.start()`. Startup loads `/api/session` through `invites.loadSession()`,
then reads state, display definitions, rules and display world concurrently.
It previously also awaited `/api/art-status`, despite artwork being optional.
Any unsettled fetch or response body in this chain could hold the static shell.

The screen API uses `createRequestReader` in `app/web/live-swap-client.mjs`.
That reader already retried named warming/updating 503s, but stopped after
30 attempts or 45 seconds, refused waits over 3 seconds, and did not bound each
request. Network failures, 502/504s and ordinary 503s were single-dispatch.
An exhausted retry or a 401 reached main's manual Retry panel; that changes
the badge to "Load failed", so it alone does not explain an unchanged badge.
A hanging request, including one that eventually fails, had no deadline.

Startup adopts state, builds the map, starts tasks and binds controls before
calling `connectEvents()`. Therefore the initial stream cannot reconnect while
that document's first state load is unfinished: it does not exist yet.
`screen-live.mjs` already reopens CLOSED streams with backoff and retries failed
revision reconciliation. It is not a bootstrap recovery mechanism.

Multi-picker requests also share an account preflight promise. An indefinitely
pending account check previously blocked all later reads, even if their own
transport was retried. That preflight now has a deadline too.

The Caddy navigation Updating page described in the incident refreshes after
5 seconds, before application startup is involved. Its refresh behavior needs
no client change. The repository's app-owned warming navigation page similarly
has a script-free meta refresh (2 seconds) in `app/startup.mjs`.

An unsuccessful JavaScript module download also occurs before main's handler.
This change covers JSON bootstrap and application startup reads; it does not
install a general fallback for failed JavaScript asset delivery.

## Change

- `app/startup-read.mjs` supplies a 150-second header deadline. The scheduler's
  first cold calculation allows 120 seconds (`app/tasks/scheduler.mjs`); the
  extra 30 seconds leaves room for request handling and delivery. After headers,
  JSON reads use a separate 35-second inactivity window, reset by every nonempty
  decoded body chunk. There is no total body deadline: a healthy 375 KB Brotli
  response taking 47 seconds at 8 KB/s, or a longer trickling response, can finish.
  Timeout or cancellation aborts the transport and cancels the body reader. A
  raced deadline also bounds transports that ignore abort, and late answers
  cannot complete an abandoned startup attempt.
- Bootstrap reads retry network/unreadable responses, 429 and server errors
  for as long as the document remains open. Base delays are 1, 2, 4, 8, 16, then
  30 seconds, with independent ±20% jitter clamped to 1–30 seconds. A longer
  Retry-After in seconds or HTTP-date form remains a minimum, including values
  larger than a browser timer can hold (the wait is split into timer-sized parts).
  Commands keep their existing durable outbox behavior.
- The screen bootstrap owns retries instead of nesting the old bounded reader
  retry loop. It retries individual reads rather than re-running UI factories.
  A terminal error cancels the parallel startup reads.
- Startup passes its chunk-aware JSON reader through the shared API reader.
  Multi-picker scoped fetches retain abort forwarding through these body reads;
  startup releases the connection in `finally` after success, failure or timeout.
  Ordinary fetches still detach at headers: callers can ignore their bodies,
  and a dispatched unload keepalive must survive document retirement. The
  post-read identity check also refuses streamed results after retirement when
  a transport ignores cancellation.
- Updating/warming errors show "Updating, retrying…"; other transient failures
  show "Connecting, retrying…". A 401/403 offers sign-in only for a writable
  account whose already-loaded `/api/session` has `signIn.mode` set to
  `optional` or `required`. Invitation and view-only sessions, sign-in-off
  sessions (which normally omit `signIn`), and failures before session loading
  tell the user to reopen their invitation link or ask the administrator for a
  new one, without an `/auth/signin` link. No additional access-mode request is
  needed. Existing multi-picker identity retirement still reloads the document.
- Artwork no longer blocks startup and its optional request is bounded.
- No screen context fields or renderer cache inputs were added.

## Reproduction and verification

The new `tests/startup-retry.test.mjs` runs the shipped browser dataset branch
in a VM through a real loopback proxy. The proxy first returns
`503 PICKER_UPDATING` with Retry-After, then forwards to a synthetic upstream.

```sh
node --test --test-concurrency=1 --test-timeout=120000 tests/startup-retry.test.mjs
```

Before the change, the regression produced:

```text
fail 1
Error: Game data could not be loaded. Reload the picker.
```

After the review fixes:

```text
tests 9
pass 9
fail 0
```

The focused cases also cover repeated failures beyond the old retry budget,
network errors, 502/504, longer Retry-After values, hung headers and bodies,
cancellation, jitter bounds and authentication recovery for both access modes.
A synthetic clock verifies headers arriving at 149 seconds, followed by a
210-second trickling body with no retry, and a mid-body stall retried after
35 seconds of inactivity. These clocks keep the tests below the 120-second
per-test limit.

The existing screen VM harness verifies each of the five startup API endpoints
can return 503 once, then recover, paint tasks and open exactly one stream
without duplicating UI listeners. It also verifies hung artwork does not block
startup. Session tests verify a timed-out shared check can be tried again and
preserves updating status and Retry-After.

The multi-picker regression runs the real shared screen API through scoped
fetch and native fetch against a synthetic loopback HTTP server. It receives a
partial JSON body, triggers inactivity expiry, asserts the actual transport
signal is aborted before retrying, observes the server response close, and
recovers on the second request. Separate checks preserve ordinary header-time
cleanup and unread keepalive responses. The screen VM also checks that session
access mode reaches a subsequent state-403 recovery panel.

The original implementation's scratch browser replay using the real open-f2p
app and Player 1 observed (before these review fixes):

- Dataset bootstrap: `503, 503, 200`, followed by map, Player 1, rendered tasks
  and "Saved", without reloading.
- State bootstrap: `503, 503, 200`; the badge first read "Updating, retrying…",
  then "Saved" in the same document.
- Startup 401: one request, "Sign-in required", a visible recovery panel and
  `/auth/signin` link; no endless retry.

Review-fix verification runs only these files, one at a time at BelowNormal
priority, with synthetic data and scratch outputs inside this worktree:

| File | Pass | Fail | Skipped |
| --- | ---: | ---: | ---: |
| `tests/startup-retry.test.mjs` | 9 | 0 | 0 |
| `tests/web-browser.test.mjs` | 371 | 0 | 0 |
| `tests/picker-browser-session.test.mjs` | 36 | 0 | 0 |
| `tests/request-failures.test.mjs` | 10 | 0 | 0 |

The full suite and a new Playwright/browser replay were not run for these fixes.

## Remaining uncertainty

The incident log has no URIs, and no browser network trace was captured.
The bootstrap failure is reproduced, but the exact failed request in the
rel37 incident cannot be established. A stalled artwork read or a JavaScript
asset failure could also produce an unchanged shell. No deployment or live
verification was performed.
