# Save and live update compatibility

The portable backup remains `rs3-chunk-picker` schema 1 (the authoritative
`BACKUP_FORMAT` and `SCHEMA_VERSION` constants are in `app/core/state.mjs`).
Private storage metadata lives beside `state` in the atomic `state.json`
replacement. Portable exports and History/Undo exclude this metadata. Importing
or restoring gameplay preserves the current storage receipt ledger; imported
receipts never replace it.

## Action receipts, format 2

`actionReceipts` is optional. Its current shape is:

```json
{
  "format": 2,
  "slots": [{
    "generation": 1,
    "scope": "11223344-5566-4788-99aa-bbccddeeff00",
    "lastUsed": 1792339200000,
    "clientId": "00112233-4455-4677-8899-aabbccddeeff",
    "principal": "<SHA-256 of stable actor identity>",
    "sequence": 4,
    "acknowledged": 3,
    "receipt": {
      "requestId": "v3.11223344-5566-4788-99aa-bbccddeeff00.0.1.4",
      "fingerprint": "<SHA-256 of canonical actor and command>",
      "revision": 12,
      "outcome": { "type": "roll", "revision": 12, "rolled": ["1-1"] }
    }
  }]
}
```

There are at most 32 slots. Each has a monotonically increasing generation and
sequence, and at most one unacknowledged outcome. Numbers must be safe integers;
exhaustion refuses further use instead of wrapping. New request IDs encode a
server-generated session UUID (`scope`), slot, generation and sequence. An absent
or quarantined ledger cannot recreate an earlier ID, even if the same client UUID
registers again. Existing bridge rows without `scope` retain their v2 IDs and
outcomes unchanged. `lastUsed` is a timestamp updated on registration, command or
acknowledgement; missing bridge timestamps count as oldest. Actor identity binds kind, invitation ID and member ID;
mutable display labels do not change ownership. Fingerprints use sorted object
keys and preserve array order.

`POST /api/action-session` with a tab's UUID returns its slot and watermarks.
Registration retries use the same UUID. The tab persists its session and exact
pending command bytes in one sessionStorage record before sending. A command
carries `requestId`, `requestAck`, `expectedRevision`, and `command`. The server
requires the next consecutive sequence and acknowledgement of its predecessor.
The action, new sequence and retained outcome enter the same synced atomic save
replacement. A repeated pending ID returns the original `receipt` and the full
current state before revision/Undo validation. Random rolls are never rerun.

After receiving the answer, the tab atomically stores its confirmed watermark
and original receipt outcome, and clears the pending bytes. Confirmation rides on
the next command; after five idle seconds the browser sends a single lazy
acknowledgement through `/api/action-session`. Save completion and subsequent
commands never wait for that extra round trip. Page closure also sends the pending
confirmation with fetch keepalive while the tab still owns its session. Neither
delivery is guaranteed. Confirmation lets the server discard the previous outcome. Requests at or below the acknowledged
watermark are refused with `REQUEST_ACKNOWLEDGED`; they never execute. Their
outcome was already durably confirmed by the client. A terminal command rejection
such as a revision conflict or ordinary 403 permission refusal consumes no sequence and keeps the existing explicit
review rules. A newly reviewed action may use that still unused sequence.

Reuse prefers the least recently used fully acknowledged slot. If none is
available, retire the least recently used unacknowledged slot through the same
bounded retirement certificate. Reuse increments the generation and assigns a
fresh scope; all old-generation requests fail with `ACTION_SESSION_RETIRED`.
An evicted committed sequence has no safe-to-retry proof: its original outcome
may be unavailable, but it can never execute again. The browser retains that
uncertain pending change for History review. Even a new session preserves the
reviewed revision, so it cannot double-apply that old change. Closing or killing
any number of unconfirmed tabs cannot exhaust the 32 shared slots. There is no
time expiry. A tab returning after a long absence replays its pending bytes first.

Standalone acknowledgements atomically sync a bounded compact
`action-acknowledgements.json`, never rewrite `state.json`. Each row binds the
exact session scope, client, principal, generation and pending receipt. Startup
and activation apply only matching confirmations; stale or malformed metadata
cannot confirm a new session or replay gameplay. The next gameplay replacement
embeds the updated watermark with its new action receipt. The ACK endpoint also
requires the server scope, so an older delayed confirmation cannot prune a new
session after ledger loss.

If sessionStorage was cleared, the client creates a fresh UUID and session and
loads current state. It does not reconstruct or resubmit an earlier action.
Check History before repeating an uncertain action. A retained pending record
with an account or fingerprint error stays blocked and visible. A retired session
renews automatically only for a freshly dispatched command with no ambiguous
attempt, or when the slot's bounded `retired` certificate proves the old scoped
sequence was never committed (old confirmed sequence plus one). That certificate
retains just the immediately preceding scope, generation, sequence and principal.
Renewal preserves the original command and reviewed revision. An ambiguous old
request without proof remains visible for History recovery. Browser tab duplication can
copy sessionStorage. A Web Lock gives exactly one document ownership of that
session before any dispatch or acknowledgement; the copied tab stops before
sharing a sequence. Return to the original tab, or close it and let the copy
recover the same pending bytes. Browsers without Web Locks refuse saving. An
idle tab whose acknowledged slot was reused opens a fresh session automatically
when its next command is definitively refused before execution. Closing
or manually refreshing a tab can still discard unsent editor input; live updates
never reload pages.

Saving requires both Web Locks (`navigator.locks`) and secure UUID generation
(`crypto.randomUUID`). Use HTTPS or a browser-trusted loopback origin with a
supported browser. Acceptance must verify both the actual private origin and
the actual Funnel origin. Ordinary HTTP at a LAN or Tailscale hostname/IP is
refused before registration, dispatch or ACK, even if APIs were polyfilled.
Missing support gives the same plain HTTPS/localhost guidance; there is no
unlocked or insecure fallback. Existing pending bytes are retained. An insecure origin shows “This address cannot
save safely. Open the HTTPS link or localhost.” once when the page connects,
before any save attempt. That failure never claims an unstored change is retained.

## Migration and rollback

A malformed receipt ledger is quarantined in memory while gameplay loads. Startup
and standby preserve the original save bytes and timestamps. Before the next
replacement, the rejected ledger and reason are atomically synced to private
`receipt-quarantine/<sha256>.json`; failure to retain that evidence blocks the
replacement. Unverifiable outcomes cannot be replayed or automatically reassigned.
If an older release drops receipts, the forward release opens the latest gameplay
unchanged, fences old IDs and creates new server scopes. A fresh, definitively
rejected action renews automatically; an ambiguous pending action requires History
review. Dropping receipts loses retry outcomes, so retain a compatible rollback
build for unattended live updates.

The browser shares a limit of 12 attempts and 120 seconds across registration,
dispatch and safe renewal. Network failures, 5xx responses and malformed answers
consume the same budget; each request and response reader has a deadline. On
exhaustion, `paused: true` is persisted with the exact pending `body`, or the
original `unsent` command if registration has not completed. The page shows
“Save not confirmed” and “Retry save”. Reload and SSE preserve that failure and
do not dispatch it. Only an explicit retry starts another bounded attempt with
the same issued bytes; unsent editor input stays in place. Background ACK
requests run outside the action queue, including when their response stalls.
“Discard pending save” sits beside Retry save for paused or blocked requests.
Its confirmation asks the user to check History first because the action may
already have committed. Discard removes both current and legacy outbox keys,
releases the old tab ownership, loads current state and registers a fresh client
identity for the next action. It does not undo gameplay or reload the page.
The receipt fingerprint remains command plus principal: adding expectedRevision
would invalidate existing format-2 receipts. Identical request replay and Web Lock
ownership remain unchanged; any later fingerprint expansion needs versioned migration.

Saves without receipts open unchanged. The prototype UUID-to-fingerprint ledger
also opens unchanged and is converted in memory to format 2 with an immutable
`legacy` map. Its at most 8192 entries remain replay-only forever; unknown UUID
actions require a sequenced session. Their historical outcome contains the
original revision and `type: "legacy"`, because the prototype did not retain a
roll outcome. Existing prototype pending browser records stop for explicit
History recovery rather than silently acquiring new IDs. Conversion is written
only with the next explicit session or gameplay mutation.

Strict live update startup validates the current save, exact bytes/checkpoint,
and preparation output without any startup rewrite, retention pass or daily
observation write. A changed migration/preparation result refuses activation.
Both candidate and rollback builds must understand format 2 and the current
dataset, pack, sidecar and previous browser contracts. A pre-bridge build is not
a valid rollback after sequenced actions. Rollback always opens the latest
durable save; restoring a pre-update snapshot would lose confirmed play.

## Freeze and operator contract

Authenticated health reports `liveSwapProtocol: 2`, `actionReceiptFormat: 2`,
`saveSchemaVersion`, `standby`, `savesReady`, `revision`, and code `version`.
Standby performs no storage writes and owns no writer lock. `freeze()` refuses
while any excluded request or maintenance flow is active. Otherwise it closes
admission, drains accepted commands and maintenance, ends event streams and
returns `{revision, sha256, schemaVersion}` for the exact durable file. Closing a
frozen store drains existing work and releases its original kernel and owner
locks without starting a new retention pass. Activation checks the checkpoint
after acquiring those same exclusive locks and before any save mutation.
Checkpoint hashes and size limits use physical raw bytes, without UTF-8
normalization. Loading preserves those bytes until an authorized write;
unchanged startup performs no rewrite. Pinning a prior snapshot preserves its
raw document bytes while appending retention metadata and removing trailing
JSON whitespace.
The prepared candidate activates in place: its world, calculator and HTTP
listener stay warm. It reloads the latest gameplay, receipts and auxiliary
stores under the original locks. A bounded cache reuses verified immutable
static fields during this transition. Activation failure closes the candidate;
shutdown waits for any activation already in progress before releasing locks.
Background retention and backup reads also exclude freeze. New maintenance is
refused while frozen, and periodic packing is deferred while accepted commands
drain. A busy maintenance queue leaves the original writer available to retry.
The operator requests `freeze({requireIdle:true})`, which also refuses an
already accepted command. It retries a gap between actions while the old writer
continues normally. The default local API still drains accepted commands.
An optional positive safe integer `maxSaveBytes` caps the UTF-8 bytes of the
latest committed save after that drain. An oversized save returns `LIVE_SWAP_BUSY`
and restores the previous admission state, so an automatic update can defer
without releasing writer ownership. The size check uses the exact committed
bytes in memory and performs no additional disk read in the frozen window.
Privileged callers may supply `liveSwap.onActivationTiming({phase, durationMs})`
to observe activation phases without changing HTTP responses. Reports cover
`store.guard`, `store.ownerLock`, `store.readValidate`, `store.prepare`,
`store.listeners`, `app.sidecarsClose`, `app.sidecarsOpen`, and `app.total`.
Diagnostic callbacks are never awaited; thrown errors and rejected promises
cannot interrupt activation or writer-lock cleanup.

Only the local operator handle can freeze or activate; HTTP exposes neither.
The staged controller owns persistent front-door freeze, exact process identity,
phase recovery and release pins. Unknown ownership must keep admission frozen
with `recovery-required`. The bridge release must include both core and browser
protocols before automatic live promotion can be enabled.


## Game plugin achievement provenance

Schema 1 optionally stores `member.achievementProgress`, a dictionary keyed by
an existing Diary task ID. Each value has exactly `title`, `achievementId`,
`source: "game-plugin"`, `fetchedAt`, and `memberId`. The title contains 1–120
characters, is not whitespace-only, and contains no control characters. The
achievement ID is a nonnegative safe integer; `fetchedAt` is a valid ISO UTC
timestamp and `memberId` matches the owning player. RuneMetrics provenance is
not accepted for achievements.

`apply-game-progress` accepts an optional `achievements` array of
`{taskId, title, achievementId}` entries alongside its `skills` and `quests`
arrays, which may be empty. Omitting achievements is equivalent to an empty
array. Unknown fields, duplicate task IDs, absent tasks and non-Diary tasks are
rejected before any progress applies. New achievement ticks add the task to
`completedTasks` and record provenance in the same History/Undo batch as skills
and quests. Each new game plugin History event also records `source: "game-plugin"`,
with its owner in `command.memberId`; older events may omit the source field.
Already completed tasks retain their existing provenance, including
an absent provenance entry for a manual tick. Undo, task deletion, restore
previews and portable backups include achievement provenance. Manual unticks
clear the matching provenance, and Undo restores it; a subsequent manual tick
does not inherit a previous game observation.

The field remains absent until a new achievement tick is applied. Loading or
round-tripping an older save does not add it or change the schema version.

## Game plugin item provenance

Schema 1 optionally stores `member.itemProgress`, a dictionary keyed by an
existing task ID. Each value has exactly `title` (the game item name, 1–80
characters without controls), `gameItemId` (a nonnegative safe integer),
`evidence` (`owned` or `worn`), `source: "game-plugin"`, `fetchedAt` and
`memberId` matching the owner. It records what the game plugin saw, not where
the item came from.

`apply-game-progress` accepts an optional `items` array of
`{taskId, title, gameItemId, evidence}`. A generated Obtain goal absent from
`tasks` is registered from the trusted server catalogue, as `complete-task`
does; payloads cannot supply task metadata. New item ticks join
`completedTasks` in the same History/Undo batch. Manual unticks, Undo, task
deletion and restore previews treat `itemProgress` like `achievementProgress`.
The field stays absent until an item tick is applied.
