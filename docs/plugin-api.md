# Game plugin API v1

The picker accepts player reports; it never sends commands to the game. This API
works for beta and live worlds. A beta world is a separate character copy:
review its progress carefully before applying it. Unique achievement matches
tick automatically on live worlds only, with Undo.

Start and authenticate the picker as described in the [README](../README.md).
No game-client plugin installer is included in this repository; manual play
needs none. The simulator below exercises this API with synthetic data.

Create a key in **More → Game plugin** in the picker. Players manage their own keys;
administrators can manage any player's. Viewers cannot manage keys or apply
progress. Each player can have three active keys. Copy a newly created key once
and paste it into the plugin. Only SHA-256 hashes are stored in the separate
key sidecar. Keys can be revoked. Never put them in URLs, logs, or saves.

All three routes require `Authorization: Bearer gpk_…` with a dedicated plugin key.
Cookies, picker master/invite credentials and overlay keys cannot authorize
them. A plugin key cannot authorize any other route, even alongside a valid
picker cookie. An Origin header is optional, including through Funnel. If sent,
it must satisfy the picker's normal origin check. Cross-site browser requests
are refused. There is no CORS access.

## POST /api/plugin/v1/report

Use `Content-Type: application/json`. Maximum body: **16,384 bytes**, including
unknown fields (which are rejected). Four requests per second per key, shared
with status reads. Errors use `{ "message": "…" }`; rate limits return 429 and
`Retry-After: 1`. Invalid payloads return 400, credentials 401, stale sequence
409, oversized bodies 413. Successful reports return status, below.

```json
{
  "v": 1,
  "seq": 1,
  "sentAt": "2026-10-19T12:00:00.000Z",
  "world": { "id": 1, "beta": true },
  "position": { "x": 50, "z": 50, "floor": 0 },
  "skills": {
    "ATTACK": { "level": 12, "xp": 1584 },
    "RUNECRAFTING": { "level": 3, "xp": 174 }
  },
  "quests": {
    "finished": ["Cook's Assistant"],
    "started": ["THE_BLOOD_PACT"]
  }
}
```

`v`, `seq`, `sentAt`, and `position` are required. `seq` is a nonnegative safe
integer, increasing per key during a server session. Use Unix milliseconds to
start a new plugin session without reusing sequence numbers. Retries with an
old sequence return 409 without changing anything. `sentAt` is a valid ISO UTC
timestamp with seconds and optional 1–3 fractional digits.

`x`/`z` are **game map squares**, integers 0–199, not tile coordinates. `floor` is an
integer 0–3. The wire chunk ID is the decimal string `x*256+z`: Lumbridge `(50,50)` is
`"12850"`; `(53,45)` is `"13613"`. Position expires after ten minutes and never
enters the save, History, Undo or backups. It never unlocks a chunk. The server
translates displaced map drawings into picker IDs internally; all plugin wire
chunk IDs remain game IDs. See [coordinate membership and verification](game-coordinates.md).

`world` is optional; when supplied it needs integer `id` 1–10000 and boolean
`beta`. Send it on each report. `skills` and `quests` are optional; position-only
updates retain a waiting proposal. Skill fields merge into unapplied progress;
a supplied quests object replaces the earlier quest lists. Switching between
beta and live starts a new proposal; ordinary world hops retain progress. Reports
containing progress replace an earlier review token; review again before apply.

`diagnostics` is optional: an array of at most 80 single-line strings of up to
160 characters, the plugin's own status lines. The latest set for each key is
kept in memory only and shown under that key in the Game plugin dialog to the
key's player and administrators. Never put the key or other secrets in it.

All 29 skill names accept Title Case or uppercase enum spelling. `RUNECRAFT`
and `RUNECRAFTING` both map to `Runecrafting`; `HITPOINTS` maps to `Constitution`.
Unknown skills, duplicate aliases and unknown fields are rejected. Level is an
integer 1–120; XP is a finite number 0–200,000,000 in **actual XP**, not tenths.

Both quest arrays are required when `quests` is supplied, at most 500 names
each. Names are trimmed strings of 1–160 characters without control characters.
Matching uses the existing whole-quest mapping, Unicode normalization, case
folding, punctuation and underscore-to-space normalization, plus the existing
Vampire/Vampyre alias. Ambiguous or absent matches appear in the review as
unmatched; the picker never guesses. Started quests are informational and do
not mark completion. Finished quests and skill observations become an in-memory
proposal that waits for review. Only the player or an administrator can Apply or Dismiss.
Apply uses the normal revision-checked command and records `source:"game-plugin"`
with the matching player ID in History/Undo. A restart discards positions and
pending proposals; send progress again after reconnecting.

### Completed achievements

Read `accepts` in status before sending optional capability-gated fields. This
picker advertises `"achievements"`, `"items"` and optional extensions in `accepts`.
Send `achievements` or `items` only when it is listed.
An achievement part has the normal required report fields and optional `world`,
but no `skills`, `quests` or `diagnostics`:

```json
{
  "v": 1,
  "seq": 2,
  "sentAt": "2026-10-19T12:00:01.000Z",
  "world": { "id": 1, "beta": false },
  "position": { "x": 50, "z": 50, "floor": 0 },
  "achievements": {
    "snapshot": "0123456789abcdef",
    "part": 1,
    "parts": 2,
    "complete": [[354, "Second Shrubbery", 3, -1], [1201, "No Time to Lose", 5, 2]]
  }
}
```

`achievements` has exactly `snapshot`, `part`, `parts` and `complete`. `snapshot`
is 16 lowercase hexadecimal characters identifying the whole set. `parts` is
an integer 1–8; `part` is an integer 1–`parts`. Each `complete` row has exactly
`[id, name, category, subCategory]`. IDs are nonnegative safe integers, sorted
and unique within each part. Names contain 1–120 characters without controls.
Category and subcategory are safe integers at least -1. Send an empty set as
one part with `complete: []`. The **16,384-byte** report limit still applies.
Unknown fields and invalid parts return 400.

Send parts in order, waiting for a 2xx before sending the next. Part 1 starts
a new assembly for this player, replacing an unfinished one. The next part
must have the same snapshot and parts count, with `part = received + 1`.
Repeating a received part does nothing. Other out-of-order parts return 200 and
are ignored. Use the response's `achievements` to resume or restart. Multiple
keys for one player share the assembly. The picker remembers the last eight
completed snapshots per player in memory, including each snapshot's aggregate
world (`live`, `beta` or `unknown`). Replaying a cached snapshot becomes the
current assembly with `{snapshot, received: parts, parts}` without matching
again, except that a cached non-live snapshot is not acknowledged as complete
when the incoming part explicitly reports `world.beta: false`. Any report with
`world.beta: false`, including an ordinary position, skills or quests report,
invalidates a current completed non-live assembly and its cache entry. Status
then returns `achievements: null` until parts are sent again; the same snapshot
hash may be resent because it identifies achievement data independently of
world. A restart forgets assemblies, this replay cache, summaries and review lists.
Persisted handled achievement IDs prevent later reports, including new snapshots
and replays after a restart or cache eviction, from reversing Undo or manual unticks.
A new snapshot can still apply newly completed, unhandled achievements.

Matching uses the quest Unicode, case and punctuation normalization. Only Diary
tasks with an exact raw label `~|Family#Group|~ Achievement name` participate.
The retained task identity supplies this raw label when its display label has
been flattened. Other Diary labels stay unmatched. Unmatched achievements are
counted and ignored. Already completed tasks stay unchanged.

Exactly one matching task becomes an automatic tick only if **every part**
explicitly reports `world.beta: false`. Several tasks sharing a name are always
unclear. Beta-world and missing-world matches also wait for review. A failed
automatic command leaves its candidates in review. No report failure is caused
by a failed automatic tick.

Automatic ticks use one revision-checked `apply-game-progress` command per batch,
with `source: "game-plugin"` in History and the owner in `command.memberId`.
Each tick stores its achievement title, in-game ID, source, fetched timestamp
and member ID in `member.achievementProgress`. Completed shows “ticked by the
game”. Normal Undo reverses the whole batch and removes its provenance.

The existing proposal preview includes an `achievements` array. Each row has
exactly this shape (no optional fields):

```json
{
  "achievementId": 354,
  "title": "Second Shrubbery",
  "candidates": [{ "taskId": "diary:example", "label": "Second Shrubbery" }],
  "reason": "unclear",
  "world": "beta"
}
```

`achievementId` is the nonnegative safe integer from the report; `title` is its
reported name. `candidates` contains objects with exactly `taskId` and `label`
(strings). `reason` is `unclear`, `beta`, `world-unknown` or `retry`. `world` is
`live` only when **every part** explicitly reported `world.beta: false`, `beta`
when any part reported `world.beta: true`, and `unknown` otherwise. World
provenance belongs to each row, independently of its reason and the preview's
outer `world` (which may describe earlier skills or quests). The dialog shows a
beta or unknown-world warning on each such row, including unclear matches.
Already handled IDs are omitted. At most **200 rows** are retained for review;
`achievementsMore` counts additional rows. Choose a candidate task or leave a
row skipped. Apply accepts optional `achievements: [{achievementId, taskId}]`
beside `previewId` and `expectedRevision`. Only reviewed candidates are accepted;
each achievement and task can be chosen once. Only the player or an administrator
can Apply or Dismiss. Apply records one undoable batch. Applying or dismissing a
review handles every live-world row shown, including skipped and omitted choices,
so those choices persist. Beta and unknown-world rows are never handled, even
when selected and applied; a later live report can offer or tick them again.
Rows beyond the 200-row review limit are not handled by that review.

### Handled achievement sidecar

`plugin-achievements.json` lives in `dataDir` beside `plugin-keys.json`:

```json
{ "v": 1, "players": { "player1": { "handled": [354, 1201] } } }
```

It records achievement IDs the picker has already acted on for each existing
player. Arrays are sorted, unique nonnegative safe integers, with at most
**20,000 IDs per player**. Writes retain existing IDs first, then admit new IDs
in ascending order until full; excess IDs remain unhandled. Deleted players
are pruned on the next handled write. The file uses serialized, atomic writes
with the same private file permissions and save-directory lock as plugin keys.
Missing means empty. A corrupt or wrong-shape file logs one warning at open and
is treated as empty; reads do not overwrite it. The next successful handled
write archives the bad file as `plugin-achievements.json.corrupt-<timestamp>`
(with a numeric suffix if necessary) before replacing it.

Successful automatic batches handle all matched IDs whose tasks were ticked
(including several IDs that map to the same single task); failed
automatic commands leave `retry` rows and do not handle their IDs. Unmatched
IDs and matches whose tasks are already complete are not handled, so later task
list changes can still use them. This sidecar is **outside the save, Undo and
save backups**. Undo removes ticks and `achievementProgress`, but keeps handled
IDs. Deleting the sidecar re-enables automatic ticks for completions the picker
sees again. Keep it alongside the save when moving the picker to preserve these
choices.

IDs accepted for handling count as handled in memory while their sidecar write
is pending, preventing repeats or reoffers. Sidecar writes and retries run in
the background; a failure does not fail or block status, report, Apply or
Dismiss. A failure streak is logged once, with opportunistic retries at most
once per minute and a final retry on close after accepted mutations drain. The
save and sidecar are separate writes, so termination between them can still
lose a handled record; a persistence failure that remains after the final retry
can also leave handled IDs unpersisted at exit.

The Game plugin dialog shows each player's current part count, last complete
achievement count, matched task count and last automatic batch's count and time.
These summaries are in memory only and visible with that player's keys.

### Worn and backpack items

Send `items` only when status `accepts` lists `"items"`, in a report without
`skills`, `quests`, `diagnostics` or `achievements`:

```json
"items": {
  "snapshot": "0123456789abcdef",
  "worn": [[4, 34830, 1, "Gud raider chainbody"]],
  "backpack": [[0, 857, 1, "Yew shortbow"]],
  "journal": { "id": "aaaaaaaaaaaaaaaa", "events": [[1, 34830, "Gud raider chainbody", "live"]] }
}
```

`snapshot` is 16 lowercase hex characters naming the plugin's current reading.
`worn` and `backpack` are each `null` when the container could not be read
(never `[]` for "unknown") or at most 64 rows of `[slot, itemId, count, name]`:
a unique slot from 0 to 63, a game item ID from 0 to 1,000,000, a count of at
least 1 and the game's item name, 1–80 characters without controls. The
`journal` holds up to 32 worn observations the plugin made while the picker
may not have been listening. When `accepts` includes `"item-journal-world"`,
use `[eventId, itemId, name, environment]`, where `environment` is `"live"`,
`"beta"` or `"unknown"`. Capture it **when the wearing is observed**, using
that observation's world, and retain it unchanged with the event through offline
queues, lost replies, retries and world transitions. Missing observation-world
information means `"unknown"`; never fill it from the later delivery world.
The current report's `world` still describes its current containers and position.
One journal can contain events from several environments. Event IDs must be
strictly increasing positive integers across that journal, regardless of environment.
`journal.id` is 16 hex characters chosen when the plugin starts a journal; a new
ID restarts event counting, but does not change retained events' environments.
The same journal ID/event ID must always retain the same item, name and environment.

Legacy `[eventId, itemId, name]` triples are still accepted and keep the earlier
rule: they take the **delivery** report's world. In a live report they can persist
live owned/worn facts and tick live goals; in a beta or unknown-world report they
stay labelled review rows. So an item worn on beta and still queued when a live
report is sent counts as live. Closing that gap is what the four-field form is for.
After a sender upgrade, send old queued events as `"unknown"` unless their
observation environment was actually retained.
Send four-field events only after observing `"item-journal-world"` in status;
older receivers reject them. A sender requiring reliable historical live evidence
must upgrade to retain and send the observation environment. This repository's
simulator does not implement item journals; external game-client behavior has not
been verified.

The picker matches **numeric IDs only**, through a reviewed table in
`app/integrations/game-items.mjs`. Each row was checked against the wiki
infobox ID, the decoded game cache name and slot, and the picker entity. Names
are shown, never matched. Unmapped IDs are listed in review (first 30) and
otherwise ignored.

Evidence stays separate: owned now (this snapshot), ever observed owned, and
ever observed worn. Possession proposes the item's source-neutral BiS
"Obtain" goal (any tier or noted copy counts; a transfer counts). Wear tasks
need worn evidence, from `worn` or the journal; noted IDs are never worn
evidence. Source-specific tasks (collection rows such as "(Asgarnia &
Misthalin) Obtain …", drops, crafts) are not in the table and never match.

**Live owned items tick their BiS goals.** For current live containers
(`world.beta === false`) or a journal event explicitly observed on `"live"`, an
owned match for an open BiS "Obtain" goal is
applied at once through `apply-game-progress` `items`, in one History/Undo
entry, and the goal is marked handled so Undo or an untick is not re-ticked by
the next report. If that write fails, the matches fall back to review. Wear
tasks, and every match from a beta or unknown world, still never tick: each
becomes a review row with `taskId`, `label`, `gameItemId`, `gameName`,
`evidence` (`owned` or `worn`), `seen` and `world`. `seen` is "owned when
first seen; source unknown" for items present in the player's first readable
snapshot (both containers read), "new since <time>" for later gains and "worn
<time>" for Wear rows; ticks keep the same label in `itemProgress`. Beta and
unknown-world rows are labelled. A synthetic scratch save may start the server
with the in-process option `pluginItemsBetaAsLive: true`, which treats beta
items as live; there is no environment variable for it, and live pickers never
set it. The proposal preview carries `items`,
`itemsMore`, `unmappedItems` and `unmappedItemsMore`. Apply accepts optional
`items: [{taskId}]` chosen from the preview; omitted rows stay unticked. The
command records `member.itemProgress` (see the save schema). Apply and
Dismiss mark every shown row handled so it is not offered again.

Live-world evidence (current live containers or explicitly live journal events)
is saved in `plugin-items.json`
beside `plugin-achievements.json`, with the same atomic writes and corrupt-file
archive. Per player it keeps `baselineAt`, reviewed `items` facts
(`name`, `ownedAt`, `wornAt`, `first`), sorted `handled` task IDs (at most
2,000) and the last acknowledged `journal` `{id, event}`. Beta and
unknown-world evidence stays in memory only and never mixes with live evidence.
The sidecar is outside the save, Undo and backups.

Status `items` is null until the first items report, then exactly
`{snapshot, journal}`: the last snapshot processed and the newest journal event
processed (`null` before the first readable look). The plugin resends when its
snapshot differs or journal events remain unacknowledged, even if the containers
have not changed. It drops journal events at or below the acknowledged event
for the same journal ID. An acknowledgement covers all environments in the
received journal prefix; it does not certify live provenance or a task tick.
Any live evidence and its watermark must reach the sidecar before that prefix is
acknowledged. If the write fails, the prior journal acknowledgement is retained
for retry. Beta and unknown evidence stays in memory and does not survive a
receiver restart without a retransmission. A beta or unknown-world report's own
containers and legacy triples share one memory slot, as before: the next beta or
unknown report replaces it. Four-field beta and unknown events keep their own
record per environment, and their rows stay in every later review (items or
bank) until handled, even after the sender drops the acknowledged events. Legacy
triples receive the same delivery acknowledgement in their delivery world.
A lost reply must be retried with the original event environment, even after a
world transition. No existing evidence or saves are reclassified by this change;
actual sender exposure would need separate verification before any migration.

## GET /api/plugin/v1/status

No body or query parameters. Report and status return the same exact shape:

```json
{
  "v": 1,
  "player": { "id": "player1", "name": "Explorer 1" },
  "accepts": ["achievements", "items", "item-journal-world", "toolbelt", "pouch", "bank"],
  "achievements": { "snapshot": "0123456789abcdef", "received": 1, "parts": 2 },
  "chunkId": "12850",
  "chunkName": "Lumbridge",
  "state": "unlocked",
  "activeTaskCount": null,
  "unlockedChunkCount": 1,
  "pendingProgress": true,
  "seenAt": "2026-10-19T12:00:00.000Z",
  "nearby": [
    { "chunkId": "12336", "state": "locked" },
    { "chunkId": "12592", "state": "available" },
    { "chunkId": "12850", "state": "unlocked", "by": "partner" },
    "… 25 rows in all …"
  ],
  "pickableCount": 3,
  "pendingRoll": [{ "chunkId": "12593", "chunkName": "Draynor" }],
  "partners": [{ "name": "Explorer 2", "chunkId": "12850", "chunkName": "Lumbridge", "seenAt": "2026-10-19T12:00:00.000Z" }]
}
```

`chunkId`, `chunkName`, `seenAt`, and `nearby` can be null. `state` is `unlocked`, `locked`,
`available`, or `unknown`. Unlocked respects the saved shared-access rule;
available means eligible in an already cached roll pool or already offered/selected.
Unknown means no recent position or no dataset chunk. A chunk known to be
unlocked still returns unlocked if it lacks dataset metadata.
`unlockedChunkCount` counts the player's own saved unlocks. `activeTaskCount`
is the length of the in-game task list (below) once the plugin has read it at
the current save revision, and null otherwise. Status caches saved ownership
per revision, reuses an existing roll pool when present, and never runs the
task engine. `pendingProgress` means a proposal is waiting for
review, including proposals containing only unmatched/informational quests or
achievement matches.

`accepts` is exactly `["achievements", "items"]`. `items` is described under
"Worn and backpack items". `achievements` is null before this
player starts an assembly; otherwise it has exactly `snapshot`, `received` and
`parts`. `received` counts accepted parts, from 1 to `parts`, and equals `parts`
once complete. This field describes assembly only; it contains no task or
achievement names. Report and status responses use the same fields.

`nearby` lists the 5×5 block of map squares centred on the reported position,
so the plugin can shade neighbouring chunks. It is null whenever `chunkId` is
null. Each row has exactly `chunkId` and `state`, with the same rules and cached
sets as the top-level `state`. Rows run from the south-west corner, x fastest:
`(x-2, z-2)`, `(x-1, z-2)`, … `(x+2, z+2)`, so row 12 is the current chunk. Map
squares outside 0–199 are omitted, which leaves fewer than 25 rows at the map
edge. Match rows by `chunkId`, not by index. When access is shared and the
group has more than one player, unlocked rows also carry `by`: `me`, `partner`
or `both`, saying whose saved unlocks contain the chunk.

`pickableCount` is how many chunks the roll pool offers, or null until a pool
exists. Status never calculates a pool inside its reply: when none exists it
schedules one calculation after replying, so a later status has it. Roll summaries
only peek at cached predictions and never start one.
`pendingRoll` lists a roll's choices still waiting for this player to pick
(empty when none). `partners` has one row per other player with the chunk
their own plugin last reported; `chunkId`, `chunkName` and `seenAt` are null
when that report is older than ten minutes. Exact tiles are never shared.

### Roll choice and candidate summaries

Status and report replies also contain `rollChoice: boolean`. It follows the
picker UI's `roll2` preference: the member override, then the legacy map setting,
then the UI default (`true`). This enables the “Roll two chunks and keep one”
button; it does not force the player to use Roll 2.

Each existing `pendingRoll` entry additionally contains `summary`, either `null`
or an object with:

- `newTasks: { skills: number, quests: number, diaries: number, other: number }`.
  Counts partition the cached prediction's `delta.tasksAdded`. Named skill
  categories and `Skills` map to `skills`; `Quest`/`Quests` to `quests`;
  `Diary`/`Diaries` and `Achievement Diary`/`Achievement Diaries` to `diaries`;
  everything else maps to `other`.
- `highlights: string[]`: at most four plain-text strings, each at most 60
  characters. These describe banks, quest starts, newly trainable skills and
  resources where the existing data provides them.

The source for candidate task numbers is the same unlock prediction used by
`app/web/chunk-planning.mjs` (“If unlocked”) and `app/tasks/pool-ranking.mjs`.
The server uses `taskWorker.peekPrediction` with the current calculation input;
it never requests a prediction. Counts include all `tasksAdded`, as pool ranking
does. Chunk Info displays the highest task per skill first and puts lower tasks
in a separate section; the summary counts both sections. Highlights use indexed
Chunk Info `Object`, `NPC` and `Quest` contents, prediction training transitions
from no primary method to a primary method, and newly available objects/items.
These are advisory contents, not a promise that a quest can be completed.

`summary: null` means there is no valid cached prediction yet (or it was cancelled
or evicted). A later status may fill it in after the picker computes it. Zero
counts with an empty highlights array mean a checked prediction added nothing.
Summaries are cached without keeping large prediction results alive.

There is currently no `lastRoll` field: after Roll 1 the unlocked state has a new
calculation scope, so the pre-unlock prediction cannot be safely read as a delta
against that state. The plugin can still display the rolled chunk from its usual
state information; this route does not calculate or persist a before/after delta.

Existing v1 active fields, ordering, pagination and counts keep their meanings.
The added summary on a pending option does not change its chunk ID or name.

## GET /api/plugin/v1/tasks

No body. One optional query parameter, `from` (a row number, 0 to 999999),
picks where `all` starts; any other query is refused with 400. Returns the
player's active tasks for the game panel, read from the task list the picker
last saved for that player:

```json
{
  "v": 1,
  "ready": true,
  "stale": false,
  "stateRevision": 42,
  "chunkId": "12850",
  "hereKnown": true,
  "here": [{ "id": "rs3:Skills:Cut%20a%20tree", "label": "Cut a tree", "category": "Skills", "level": 1 }],
  "all": ["… up to 100 rows …"],
  "allFrom": 0,
  "hereCount": 1,
  "allCount": 37
}
```

Rows use the picker's Active Tasks order: favourites, then category, then
highest level, then label. They are the player's own default list: blocked,
hidden, backlogged and completed tasks are left out. `level` is omitted when the
task has none. Labels have control characters removed and are cut at 120
characters. `all` holds at most 100 rows, starting at row `allFrom` (the `from` asked
for, else 0), and `here` at most 50; `allCount` and `hereCount` give the true
totals. A plugin reaches rows past the first 100 by asking again with
`?from=100` and so on; a `from` past the end returns an empty `all`. Pickers
before `allFrom` existed refuse any query, so a plugin should send `from` only
after a response that included `allFrom`.

`here` lists the tasks whose picker map locations include the translated chunk
from the player's latest report. The response `chunkId` stays a game ID (null
after ten minutes without a report). `hereKnown`
is false when there is no recent position or the saved list has no map
locations; `here` is then empty.

The route never calculates tasks. The picker saves a player's list whenever
someone opens that player's tasks in the picker. A tick, unlock or other change
clears that saved list; the plugin then keeps serving the last list it had,
with `stale: true`, after applying the current save's completions, backlog and
favourites. New unlocks appear once the picker saves a new list; an open picker
page does that on its own. `ready` is
false, with empty lists, when no list has been saved since the picker started:
open the picker's task list once.

### Recently finished tasks

Every tasks response also has a top-level `done` object:

```json
{
  "done": {
    "here": [],
    "all": [{ "id": "example-task", "label": "Example task", "category": "Mining", "level": 1,
              "done": true, "doneAt": "2026-10-30T12:00:00.000Z" }],
    "hereCount": 0,
    "allCount": 1,
    "hereKnown": false
  }
}
```

Finished rows use the active row fields (`id`, `label`, `category`, optional
positive integer `level`), plus `done: true` and `doneAt: string | null`. The date
is the member's recorded finish/check time, normalized to ISO UTC. The existing
Completed Tasks ledger supplies personal ticks, actual completions, aliases,
completion families and undo handling. A partner's finish never supplies a row
or its date. No new completion data is persisted.

The recent set is newest first, with task ID breaking equal-time ties, capped
at **20** rows finished within the preceding **7 × 24 hours**
(inclusive boundary, future dates excluded). `done.here` uses the same translated
surface-chunk location rule as active `here`, including interior suffix removal.
`done.here` is the subset of that recent set belonging to the current chunk.
Its locations are recovered from the same chunk-planning index as Chunk Info,
even when recalculated map badges omit completed tasks. At most 20 rows are
indexed per member/revision and their locations are cached.
Generated goals (such as equipment "Obtain" goals) have no authored record, so
they keep the chunks they had on the map while active (up to 512 per member,
in memory). A finish whose location cannot be established is in `done.all` only.
`done.hereKnown` is false without a recent position, and `done.here` is then
empty. With a position, `done.here` lists every finish known to be in this
chunk, and `done.hereKnown` is false only if some finish's location is unknown. Counts describe the capped lists; there is no paging,
and active `from` never changes these lists.

`doneAt` is null when the save cannot establish a finish time. Such rows cannot
be proven to fall within seven days and are omitted from these recent lists.
An import date or sync observation date is never substituted for a finish date.

The top-level `ready`, `stale` and `stateRevision` apply to both active and
finished lists. Before any saved result exists, `done` is empty. Retained stale
results apply current personal completion evidence, but can lack newly unlocked
rows or locations until the picker loads a fresh result. Active and finished
rows share the existing per-revision row cache; time expiry is checked on every
read, including reads at the same revision. Reading tasks never calculates.

If live History starts less than seven days ago, the picker schedules a background
read of the newest archive segments needed to cover that window. It streams
only those segments and retains compact completion evidence per revision; it
never hydrates the full history or reads archives on every request. Until that
cache is ready, the route returns finishes known from live History. A later read
fills in archived finish dates at the same revision.
Finished rows never enter active `here` or `all`, or change their counts or order.
Responses remain `v: 1`.

## Simulator

Use the README's Node version from the checkout root. Start a separate scratch
F2P game in an empty directory and leave its terminal running:

```sh
npm start -- --port 8953 --data-dir var/plugin-demo
```

Open `http://127.0.0.1:8953/join/<token>` with the token read locally from
`var/plugin-demo/access-token`. Finish or skip setup and select the intended
player's map. Open **More → Game plugin**, enter a key label and choose
**Create plugin key**. Copy
the new `gpk_…` key once. This is a dedicated plugin key, not the administrator
access token or an invitation token.

In a second terminal at the checkout root, set `RS3_PLUGIN_KEY` to that key.
For a POSIX shell, the following reads it without echoing it or placing it in
shell history:

```sh
printf 'Paste plugin key: '
stty -echo
IFS= read -r RS3_PLUGIN_KEY
stty echo
printf '\n'
export RS3_PLUGIN_KEY
node scripts/plugin-sim.mjs http://127.0.0.1:8953
unset RS3_PLUGIN_KEY
```

In PowerShell:

```powershell
$pluginSecret = Read-Host 'Paste plugin key' -AsSecureString
$env:RS3_PLUGIN_KEY = [System.Net.NetworkCredential]::new('', $pluginSecret).Password
node scripts/plugin-sim.mjs http://127.0.0.1:8953
Remove-Item Env:RS3_PLUGIN_KEY
Remove-Variable pluginSecret
```

The simulator prints four status responses without the credential. It walks
four chunks then sends synthetic skills/quests flagged as beta. Reopen
**More → Game plugin** to review the pending progress; applying it changes only
this scratch save and is undoable. No game client, real account or private data
is used. Revoke the demo key when done and stop the scratch server with Ctrl+C.

Set `RS3_PLUGIN_PATH` to comma-separated chunk IDs for a different player's
path, and use a key for that player. If port 8953 is already occupied, choose
another free port in 8900–8999 and use it in the start command, join URL and
simulator command. Never run the simulator against a save you want to keep.
