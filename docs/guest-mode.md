# Guest mode

Issue #297. Guests get the same map-first picker at `/guest/`: the map image,
chunk states and selection, rolls, automatic task refresh, task views, How? and
Why not?, settings, chunk notes and the map journal. The member shell, screen
factories, map renderer and task dialogs are shared; there is no separate simple
guest page or hand-refreshed task list. The sign-in page offers
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

The guest browser adapter presents the existing screen API and command-client
contracts. It sends no authenticated requests, action receipts, SSE, usage or
integration calls. Startup world/definitions/rules arrive with new/load in the
same worker response. Task results include the existing equipment, collection,
presentation, BiS and activity views; duplicate task reads for the same browser
revision share one promise. New read operations (`why`, `chunk-sections`,
`chunk-planning`, `profile-preview`, `predict`, `teleports`) are explicitly allowlisted, validated and calculated in
the disposable worker, as are the solo settings, note and task commands.
Undo eligibility accompanies saved-state replies; it never needs a saved-picker
context. Browser display preferences have a guest-specific storage scope.

The guest shell and browser dependencies use `/guest/` URLs and no-store
responses. A read-only seam shares the member static allowlist and checked art
assets; it never enters authentication, picker routing, gallery or API handlers.
Module imports retain their existing graph inside this namespace. Member URLs
and authentication requirements remain unchanged.

An opaque admission token is sent in a header, never a URL. The process retains
only its hash, IP rate key and expiry in memory; it carries no account authority.
Restart invalidates tokens. Expiry never deletes the browser save: reopening
guest mode obtains fresh admission and resumes that save.
The current tab retains its admission in sessionStorage and reuses it on reload
without extending its original expiry or consuming another admission slot.

## Initial limits

These conservative limits protect the existing beta; they are not capacity proof.
The disposable guest isolate has the existing calculator's 2 GiB old-generation
heap ceiling. It receives no inherited Node flags or logging/cache environment.
Browser writes use Web Locks plus a stored-base comparison; current browsers
without Web Locks report that saving is unavailable instead of risking overwrite.

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
groups retain their current scheduler and budgets; guests have no speculative
warming, SSE or background calculations and at most one separate worker.
An explicit chunk prediction uses the same disposable request budget.

## Disabled features

Guests cannot join or inspect existing groups, create invitations, access account
or operator controls, sync RuneMetrics/Platform API or game-plugin observations,
issue plugin keys, use overlays, submit stored feedback/usage, or use cloud/server
backups. These need durable identity, external integrations or server persistence.
The guest UI hides their entry points and explains the account requirement in
**About guest mode**. The visible **Export / Import** dialog explains why cloud
backups are unavailable and offers portable download/import. The persistent
browser-save notice puts these controls one click away on phone and desktop.
Bulk Sandbox, roll-pool and membership comparisons, area checks and the training
helper are disabled with an account explanation: guests use explicit one-chunk
previews within the existing calculation limits. Ordinary task views, chunk tasks,
How?/Why not?, rule profiles and settings remain available.

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

## Implementation verification

### Request timing (public F2P, synthetic solo save)

Measured locally with Node.js 24.20.0 at BelowNormal priority in the shared test
lane. Each duration includes HTTP upload, a new disposable worker, calculation,
response parsing and worker disposal. The save has Lumbridge (`12850`) unlocked;
commands change a synthetic chunk note, and How? uses an available task. Three
samples per operation, except one fresh new request. These are local observations
under varying shared-PC load, not a speedup or deployment-capacity claim.

| Operation | Original simple page API (ms) | Shared picker API (ms) |
| --- | --- | --- |
| New | 926 | 506 |
| Load | 581, 813, 664 | 519, 432, 433 |
| Command | 494, 844, 582 | 402, 407, 459 |
| Tasks | 591, 1174, 486 | 557, 683, 569 |
| How? | 1361, 1135, 686 | 532, 515, 634 |

The richer task response includes equipment, collection and activity views.
Consecutive command + tasks samples total 959, 1090 and 1028 ms; none exceeds
the approximately three-second calculation threshold. Keep per-request disposal
and the existing limits. No server-side guest cache or longer-lived worker was
introduced. Tab-local sharing of identical reads and including startup metadata
with new/load avoid redundant admissions without retaining server guest data.

Focused checks use Node.js 24.20.0, synthetic stores and one test worker. The
guest HTTP workflow compares every durable filename and file hash before and
after play, rejects account/group routes, and exercises the existing signed-in
session afterward. Save and limit tests cover portable round trips, reloads,
stale tabs, storage errors, fixed expiry and bounded worker disposal. The server,
browser module graph and sign-in regressions remain part of verification.

A headless Edge walkthrough on an isolated public F2P server exercised first
visit, unlocking, rolling, automatic task refresh/checks, How?, settings, chunk
notes, reload and portable download/import. A separate synthetic legacy server
checked real map artwork, blocked-task explanations and chunk task views. The
independent public F2P dataset intentionally has no artwork provider, matching
its signed-in presentation. Guest explanation buttons remain visible on touch
screens, and background chunk refreshes preserve the selected phone tab.
Phone (390 px) and desktop (1920 and 2560 px) layouts were inspected, including
Settings and the browser-save controls. Stale tabs require reload and refuse a
write after another tab changes the save. These are synthetic local observations;
the full hosted CI and stability gates must still pass before merge.