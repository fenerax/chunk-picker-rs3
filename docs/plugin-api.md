# Game plugin API v1

The picker accepts player reports; it never sends commands to the game. This API
works for beta and live worlds. A beta world is a separate character copy:
review its progress carefully before applying it.

Create a key in **Game plugin** in the picker. Players manage their own keys;
administrators can manage any player's. Viewers cannot manage keys or apply
progress. Each player can have three active keys. Copy a newly created key once
and paste it into the plugin. Only SHA-256 hashes are stored in the separate
key sidecar. Keys can be revoked. Never put them in URLs, logs, or saves.

Both routes require `Authorization: Bearer gpk_…` with a dedicated plugin key.
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

`x`/`z` are **map squares**, integers 0–199, not tile coordinates. `floor` is an
integer 0–3. Chunk ID is the decimal string `x*256+z`: Lumbridge `(50,50)` is
`"12850"`; `(53,45)` is `"13613"`. Position expires after ten minutes and never
enters the save, History, Undo or backups. It never unlocks a chunk.

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

## GET /api/plugin/v1/status

No body or query parameters. Both successful routes return the same exact shape:

```json
{
  "v": 1,
  "player": { "id": "player1", "name": "Explorer 1" },
  "chunkId": "12850",
  "chunkName": "Lumbridge",
  "state": "unlocked",
  "activeTaskCount": null,
  "unlockedChunkCount": 1,
  "pendingProgress": true,
  "seenAt": "2026-10-19T12:00:00.000Z"
}
```

`chunkId`, `chunkName`, and `seenAt` can be null. `state` is `unlocked`, `locked`,
`available`, or `unknown`. Unlocked respects the saved shared-access rule;
available means eligible in an already cached roll pool or already offered/selected.
Unknown means no recent position or no dataset chunk. A chunk known to be
unlocked still returns unlocked if it lacks dataset metadata.
`unlockedChunkCount` counts the player's own saved unlocks. `activeTaskCount`
is currently always null: status caches saved ownership per revision, reuses an
existing roll pool when present, and
never runs the task engine. `pendingProgress` means a proposal is waiting for
review, including proposals containing only unmatched/informational quests.

## Simulator

On a scratch server, set `RS3_PLUGIN_KEY` and run:

```sh
node scripts/plugin-sim.mjs http://127.0.0.1:8953
```

It walks four chunks then sends synthetic skills/quests flagged as beta. Set
`RS3_PLUGIN_PATH` to comma-separated chunk IDs for a different player's path.
