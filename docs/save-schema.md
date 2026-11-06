# Save and live update compatibility

The portable backup remains `rs3-chunk-picker` schema 1 (the authoritative
`BACKUP_FORMAT` and `SCHEMA_VERSION` constants are in `app/core/state.mjs`).
Private storage metadata lives beside `state` in the atomic `state.json`
replacement. Portable exports and History/Undo exclude this metadata. Importing
or restoring gameplay preserves the current storage receipt ledger; imported
receipts never replace it.

The checked-in [save-surface manifest](save-surface.json) and
[frozen save contract](save-surface.md) enumerate per-picker paths and their
rollback policies. CI runs the actual `06e15939` dependency graph. The retained
`tests/fixtures/rollback-main/` fixture is a fast hybrid check: five of its 22
live app imports changed after the pin, so it is not a frozen runtime.

## Plugin item journal retention

The portable schema and `state.json` format are unchanged. Live item evidence
still uses the version 1 `plugin-items.json` sidecar. Two optional additive
sidecars, `plugin-item-journal-beta.json` and
`plugin-item-journal-unknown.json`, retain acknowledged non-live worn journals;
legacy three-field events belong to unknown. Each file is
`{v: 1, players: {[memberId]: record}}`, using the existing item record shape:
`{baselineAt, items, handled, journal}`. Item facts contain
`{name, ownedAt, wornAt, first}`; `journal` is a processed `{id, event}` watermark.
Each player has at most 500 distinct item IDs and 2,000 handled task IDs per
file; names have at most 80 characters. Journal facts include unmapped IDs.
Member records are pruned against current save membership on writes. A full
record refuses the write and journal acknowledgement, preserving existing facts.

Files use the existing queued, synced atomic sidecar replacement and corrupt-file
archive. An acknowledgement is issued only after every affected scope has been
saved; a partial write leaves the prefix unacknowledged for idempotent retry.
Retained journal records rebuild labelled review rows at startup and after every
successful whole-picker or member import, without a report or restart. Rebuilding
does not issue completion commands, including for live evidence. Non-live records never
become live facts or automatic completions. Non-live containers remain ephemeral.
Member imports preserve other players' item dismissals and container-only
reviews while refreshing only the imported player's review. Dismissing unmapped
items records `unmapped:<itemId>` in the scope's bounded `handled` list without
removing retained facts. Retained beta/unknown journal dismissals persist through
restart and portable recovery; ephemeral container dismissals remain session-only.

`plugin-item-journal-commits.json` is a separate version 1 sidecar containing
`{v: 1, players: {[memberId]: {journals: [{id, committed, pending}]}}}`.
Each player has at most eight journal identities and 256 pending events across
them. Pending events retain the original `[eventId, itemId, name, world]` evidence
before any scope's processing watermark advances. Only resolved identities may
age out. `committed` advances only after every pending event has reached its
own durable scope, followed by a successful commit-ledger write. A delayed
subset after restart must still satisfy the retained pending prefix. Per-scope
processing watermarks never produce acknowledgements. Successfully saved live
evidence can complete tasks independently of another scope's failure.
When the pending-event or journal-identity ledger bound is full, the receiver
drains its existing durable pending work first. The rejected incoming suffix
stays unacknowledged and can be accepted on the next retry.

Portable exports include the optional envelope
`optionalSidecarEvidence: {schemaVersion: 1, entries: {pluginItems: {version: 1, players: ...}}}`.
The common envelope contains code-owned evidence types; journals occupy one entry,
using the same envelope contract as replay suppression. The adapters' internal
plain-data shape remains `{v: 1, players: ...}`.
Exports also put the same validated evidence in
`state.provenance.pluginItemEvidence`. This compatibility copy is required:
release `06e15939` preserves free-form provenance through portable import,
edits, Undo, and export, but discards the optional envelope. Its whole-save
restore moves provenance into `restore.incomingProvenance`. Current loaders
recover evidence through every such nested restore boundary, applying archived
`transferRoster.mapping` chains to incoming evidence before combining it with
the current owner's root evidence. Transfers resolve these archives before
changing member IDs. Historical archives remain unchanged; unrelated provenance
and History are never searched for journal records. Copies are deduplicated,
and the same bounds apply to the recovered union before publication. A union
that exceeds a bound refuses the load or import without changing the save.
`provenance.pluginItemEvidenceReconciled: 1` seals the current provenance node's
incoming archive as historical. Once sealed, only its active compatibility copy
contributes evidence; older archive copies cannot refill facts removed later.
A frozen restore wraps this sealed node in a new unsealed boundary, so current
loaders recover its active copy and seal the new boundary. Normal writable
startup durably publishes any newly recovered copy and marker before accepting
reports, without a gameplay revision. Read-only readers never write; a strict
live swap refuses an unsealed archive until an ordinary offline reopen seals it.
Each player contains `records` keyed by `live`, `beta`, or `unknown`, and
`commits` with the ledger shape above. The fixed-file adapters
`exportPluginItemEvidence` and `importPluginItemEvidence` in `app/plugin-items.mjs`
return plain validated data and accept one player-ID mapper. They never write
filenames supplied by an import. Restores publish the mapped evidence in
`state.provenance.pluginItemEvidence` atomically with gameplay. Active readers
combine that imported state with the fixed sidecars. Source-member mapping
filters other source players before remapping. Whole-picker replacement merges
retained destination evidence rather than revoking previous acknowledgements.
Portable backup, backup-ID/member restore, transfer, and direct replacement all
use this path. Invalid records, conflicting pending identities, or oversized
unions refuse publication without changing the destination.
Prepared import, restore, and transfer tickets also bind to the fixed sidecar
generations captured before preparation. A sidecar change requires a new preview,
even when the gameplay revision is unchanged. Publication checks that binding
inside the mutation queue while excluding sidecar replacements. Direct replacement
previews and commits validate the latest unions under the same gate. A report
prepared before publication must validate its record against the newly imported
evidence before writing. Item, handled-task, player, journal, and pending-event
bounds therefore apply to the active combined view, not just individual files.

All portable exports, transfer exports, directory snapshots, and service backups
use one generation-checked capture of the fixed scope files, commit ledger, and
`state.json` (including inherited evidence). Atomic file identities and timestamps
must remain unchanged before and after the complete capture; a concurrent write
retries the capture, up to eight attempts, then returns a retryable export error.
This also covers writes from other worker isolates. No acknowledgement can be
exported with an older scope or inherited-evidence snapshot.

These records remain outside gameplay Undo and are included in operational
snapshots and service-recovery backups. Older releases ignore the optional
top-level envelope and free-form provenance extension, and still load the
unchanged live record shape. Portable round-trips through the old release retain
the compatibility provenance copy, including when its restore archives it.
Retain the fixed sidecars during rollback; the old
receiver cannot display non-live review rows or provide this durability guarantee
for new acknowledgements.

A full scope refuses new facts without evicting evidence or advancing its
acknowledgement. Live tasks continue to complete. The progress review displays
the failure, the 500-ID limit, and the recovery instruction. An operator can
export the complete evidence, obtain the player's review of retained facts, stop
the receiver, and remove only those reviewed facts from that scope's sidecar
and the active `provenance.pluginItemEvidence` copy. First reopen the save with
the current receiver so its archive boundary is durably sealed, then stop it
again before editing. Preserve `pluginItemEvidenceReconciled: 1`, all historical
archives, the commit ledger
and its pending events. Restarting and retrying drains the durable pending
prefix once space is available; no sender retransmission is required.
When editing a portable export instead of the stored save, remove the same fact
from both its active provenance copy and optional envelope. Keep the marker;
never clear historical archives to make room. Dismissal hides review rows but
retains their evidence, so it does not itself free an item-ID slot.

## Game plugin current currency

The optional private envelope field `pluginCurrency` uses format 2. Its `keys`,
`players` and `facts` maps each hold at most 1,000 entries; `origins` caches at
most 1,000 ownership transitions. This ledger is outside portable gameplay and
is written atomically with every current correction or invalidation.

- Each credential UUID in `keys` holds `highSeq`, `seq`, `generation`, `sentAt`,
  `receivedAt` and `epoch`. Sequences and generations are nonnegative safe
  integers. `highSeq` never decreases, even when a sequence resets. `epoch` is
  a server-generated 32-character hex runtime ID or null. Times are ISO UTC or
  null. Client `sentAt` is only a plausibility filter, never a server-time fence.
- Each member in `players` holds `keyId`, `receivedAt`, `recoverAfter`,
  `historyAt` and `historyRevision`. Recovery uses only server receive time;
  History fields identify an optional coalescing group and confer no ownership.
- `facts` identifies current provenance with `{coins, source}`. Coins are null
  or a safe integer from zero to one trillion; source is `manual`, `plugin` or
  `legacy`. An unchanged readable legacy observation establishes plugin
  provenance without inventing a History revision. A matching manual amount
  remains manual.
- `origins` entries contain `revision`, `memberId`, `before` and `after` facts.
  Ordinary History entries also carry an additive `currencyOrigins` dictionary
  for affected members, each with the same fixed-size `before`/`after` facts.
  These annotations survive archival and portable restores, so eviction from
  the bounded cache cannot change Undo ownership. They contain no replay fence.

Portable `state.provenance.pluginCurrencyFacts` holds at most 1,000 member-ID
entries with the same `{coins, source}` facts. Ownership updates copy this map;
unchanged legacy adoption writes it without changing the gameplay revision or
adding a History entry. Export, import and roster transfer retain it (remapping
only member IDs). Before a mapped transfer archives History or changes member
IDs, it resolves each source member's current ownership from History and the
portable map. This also recovers Undo performed by the frozen rollback release,
whose portable map can still describe the amount before Undo.
Restore reads the selected source's map; Undo's per-entry
annotations take precedence over an older map preserved by a rollback release.
The map carries ownership only, never sequence or timestamp fences. Previous
releases accept and preserve it as additive provenance.

Manual travel edits establish manual provenance, even for an unchanged amount.
Undo restores the target fact's provenance, including manual amounts and plugin
amounts restored after a manual zero. Currency invalidation removes only a
plugin or legacy coin fact and preserves other currencies and travel facts.
History coalescing requires an inverse; optional reconstruction failures start
an ordinary new group. Public inverse patches retain their existing format.

Sequences that reset, key changes, replay and clock ambiguity make plugin
currency unknown and request a fresh snapshot. A stable stream can recover
after a 60-second server-time quarantine. Rejected timestamps do not advance
sequence/time fences or extend that quarantine. Future timestamps and reports
over 30 seconds old cannot publish current currency. Increasing sequence and
nondecreasing plausible time are required within a stream; client time alone
never orders different keys. Format-1 ledgers migrate without adopting their
untrusted client timestamps as server fences.

Known limitations accepted for plugin 1.0.0: a retired stream can re-enter with
a plausible clock-skewed timestamp, and a delayed report generated before a
manual correction or restore can overwrite that correction. Receive ordering,
sequence checks and client timestamp filters cannot prove when a report was
generated relative to those boundaries. These cases can leave an incorrect
known balance across restart. Closing them requires a plugin-side freshness
challenge, planned for plugin 1.1 after store moderation; this release does not
change the plugin wire format or add a manual confirmation mode.

Keys are never evicted to admit old traffic. Invalid metadata fails closed on
load. Undo and restore retain active replay fences; imported private metadata
cannot replace them. Restore uses preserved fact provenance; an older portable
backup without ownership annotations establishes manual facts. Standby
activation and import publication carry the ledger atomically.
Member restores derive ownership from the selected source member's preserved
History annotations, even if its coin count equals the destination. Their
ordinary Undo restores the destination's previous ownership; source ordering
metadata is never imported.

The public backup remains schema 1. Current facts use the existing
`transportFacts.currencies.coins` field; unknown removes only the plugin-owned
coin entry. History uses ordinary `set-transport-facts` commands and inverse
patches, including coalesced updates. The frozen previous-release loader can
load these saves and undo the currency changes. Older releases ignore private
envelope metadata and can drop it when writing, while preserving the additive
History annotations; retain the original save to preserve freshness fences
when rolling forward after such a rollback.

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
`evidence` (`owned` or `worn`), `seen` (the review label, such as "owned when
first seen; source unknown", "new since <time>" or "worn <time>"; 1–80
characters without controls), `source: "game-plugin"`, `fetchedAt` and
`memberId` matching the owner. It records what the game plugin saw, not where
the item came from.

`apply-game-progress` accepts an optional `items` array of
`{taskId, title, gameItemId, evidence, seen}`. A generated Obtain goal absent from
`tasks` is registered from the trusted server catalogue, as `complete-task`
does; payloads cannot supply task metadata. New item ticks join
`completedTasks` in the same History/Undo batch. Manual unticks, Undo, task
deletion and restore previews treat `itemProgress` like `achievementProgress`.
The field stays absent until an item tick is applied.

Automatic plugin ticks also store `provenance.pluginAutoHandled`, keyed by member
ID, with sorted `achievements` (up to 20,000 numeric IDs) and `items` (up to 2,000
task IDs). The store publishes this replay policy with the tick, outside gameplay
Undo deltas. Unticking or Undo therefore cannot make an automatic observation
eligible again after a sidecar failure and restart. The extension stays absent
on older saves until an automatic tick or startup folds in earlier decisions
from the legacy handled sidecars. Backups and whole-picker restores retain the extension,
and portable roster mapping remaps its member keys.

Writable startup strictly validates both legacy handled sidecars and durably
folds their union into this provenance before serving, preserving revision,
History and Undo. It then reconciles committed decisions back into the legacy
sidecars. Standby activation requires a restart if new legacy decisions need
folding. One shared pre-publication guard captures all registered evidence and
validates both union limits against destination sidecars before changing the
checkpoint. Commands (including automatic ticks, Undo and note edits), cleanup,
restore, import and transfer all use it. Overflow never commits an unstartable
save. Live handled decisions from registered item evidence join the same union;
beta and unknown decisions retain their world scope. Unreadable or invalid
evidence refuses the operation.
The frozen `06e15939` loader preserves this extension, but its plugin controller
ignores it. All service starts, including frozen rollback, pass the installed
[`start-check.mjs`](../scripts/linux/start-check.mjs) ExecStartPre as described in
[the Linux rollback steps](linux-operator.md#plugin-replay-suppression-before-rollback).
It validates all stores before publication, restores preimages on failure and
keeps refused picker data byte-identical. Refusal keeps the site down and uses
the unit's existing start limit and OnFailure alert; no degraded start or manual
reconciliation step exists. An owner Undo deliberately retains automatic replay
suppression through restore, transfer and rollback.
