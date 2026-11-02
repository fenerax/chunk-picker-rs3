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

- `app/startup-read.mjs` supplies a 35-second deadline covering fetch and body
  consumption, aborts timed-out requests, and races the deadline even when a
  transport ignores abort. Late answers cannot complete the abandoned startup
  attempt.
- Bootstrap reads retry network/unreadable responses, 429 and server errors
  for as long as the document remains open. Delays are 1, 2, 4, 8, 16, then
  30 seconds; a longer Retry-After in seconds or HTTP-date form takes priority.
  Commands keep their existing durable outbox behavior.
- The screen bootstrap owns retries instead of nesting the old bounded reader
  retry loop. It retries individual reads rather than re-running UI factories.
  A terminal error cancels the parallel startup reads.
- Updating/warming errors show "Updating, retrying…"; other transient failures
  show "Connecting, retrying…". A 401/403 shows sign-in and invitation recovery.
  Existing multi-picker identity retirement still reloads the document.
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

After the change:

```text
tests 6
pass 6
fail 0
```

The focused cases also cover repeated failures beyond the old retry budget,
network errors, 502/504, longer Retry-After values, hung headers and bodies,
cancellation and authentication recovery. Synthetic deadlines keep these cases
well below the 120-second per-test limit; the file completed in about 4 seconds.

The existing screen VM harness verifies each of the five startup API endpoints
can return 503 once, then recover, paint tasks and open exactly one stream
without duplicating UI listeners. It also verifies hung artwork does not block
startup. Session tests verify a timed-out shared check can be tried again and
preserves updating status and Retry-After.

A scratch browser replay using the real open-f2p app and Player 1 observed:

- Dataset bootstrap: `503, 503, 200`, followed by map, Player 1, rendered tasks
  and "Saved", without reloading.
- State bootstrap: `503, 503, 200`; the badge first read "Updating, retrying…",
  then "Saved" in the same document.
- Startup 401: one request, "Sign-in required", a visible recovery panel and
  `/auth/signin` link; no endless retry.

Relevant test files were run sequentially at BelowNormal priority. No full
suite was run. The original screen file passed 365 tests; its subsequent
startup-focused run passed 8 tests including the added endpoint cases.
Startup retry, request failures, picker browser session, live-swap client,
browser module graph and test selection files also passed.
Artwork fallback tests passed all 9 cases.

## Remaining uncertainty

The incident log has no URIs, and no browser network trace was captured.
The bootstrap failure is reproduced, but the exact failed request in the
rel37 incident cannot be established. A stalled artwork read or a JavaScript
asset failure could also produce an unchanged shell. No deployment or live
verification was performed.
