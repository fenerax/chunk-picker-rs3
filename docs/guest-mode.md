# Guest mode

Issue #297. Guests get a solo picker at `/guest/`, with chunk selection, rolls,
task checks, How explanations and rule settings. The sign-in page offers
**Try without signing in**. This does not enable public account registration.

## Browser ownership

The browser keeps the existing schema-1 `rs3-chunk-picker` portable envelope in
localStorage, under a dataset-specific guest key. No new gameplay fields are
needed. A persistent notice says **This save is only on this browser** and
explains that clearing site data removes it. Export downloads that envelope;
import validates the same format and dataset before replacing anything. Guest
imports must be solo. Corrupt or unavailable browser storage produces a visible
error; it must never silently replace an unreadable save. Writes are acknowledged
as saved only after browser storage succeeds. Multiple tabs detect a changed
base save and require reload rather than overwrite it.

## Server calculations

Each same-origin POST to `/guest/api/run` sends the browser's complete portable
save plus an allowlisted operation. The server does not resolve a picker ID or
accept account/group selectors. A separate worker uses the existing core command,
rule and task engine modules. The worker receives public runtime definitions and
the submitted guest snapshot, returns the result, and is terminated before its
capacity is released. There is no saved-picker context, store, registry,
invitation, plugin, telemetry, backup or warm-result writer in this path.
Calculation state and caches exist only while that request runs. Disconnect,
deadline, expiry and shutdown terminate the worker too. Responses are no-store.
Errors use fixed public messages, never submitted data or exception payloads.
Guest requests bypass request timing/profiling recorders. No guest payloads,
tokens, addresses or error contents are logged by this feature.

An opaque admission token is sent in a header, never a URL. The process retains
only its hash, IP rate key and expiry in memory; it carries no account authority.
Restart invalidates tokens. Expiry never deletes the browser save: reopening
guest mode obtains fresh admission and resumes that save.

## Initial limits

These conservative limits protect the existing beta; they are not capacity proof.

| Budget | Per IP | Global |
| --- | --- | --- |
| Active admission sessions | 2 | 8 |
| New admissions per minute | 4 | 16 |
| Calculation/command requests per minute | 12 | 30 |
| Running requests (no guest queue) | 1 | 1 |

Admission lasts 30 minutes, without sliding renewal. Requests have a 30-second
deadline including worker startup. Request JSON is capped at 2 MiB and rejected
before worker admission when oversized. Bounded in-memory rate buckets expire;
unknown guest API routes fail closed before reading a body. Client IP comes from
the existing trusted ingress policy, never an arbitrary forwarded header. Busy
responses use 429 and Retry-After with a message to wait or sign in. Signed-in
groups retain their current scheduler and budgets; guests have no prediction,
warming, SSE or background calculations and at most one separate worker.

## Disabled features

Guests cannot join or inspect existing groups, create invitations, access account
or operator controls, sync RuneMetrics/Platform API or game-plugin observations,
issue plugin keys, use overlays, submit stored feedback/usage, or use cloud/server
backups. These need durable identity, external integrations or server persistence.
The guest UI offers manual progress and portable download/import instead.

## Signing in later

Signing in opens the ordinary account flow and leaves the browser save intact.
Export is available before sign-in. The existing member-restore workflow can
import that portable solo save into a new signed-in picker; automatic handover
is a follow-up. Guest admission never claims an invitation or existing group.

## Format and verification boundary

No durable save, registry, auth sidecar or recovery format changes. Guest-local
storage uses the existing portable envelope. If implementation requires a durable
format change, server-side guest persistence/logging, or existing-group access,
stop and record the blocker in this PR instead of implementing it.

Tests must exercise real HTTP isolation with synthetic stores, before/after
durable-tree equality, denied routes, body/rate/concurrency/expiry limits,
worker disposal, browser reload/export/import/conflict/storage errors, and
unchanged authenticated access. New browser/static routes also require the
server and browser-module-graph tests and the complete CI gate. Explore the solo
workflow on an isolated synthetic server before handoff.
