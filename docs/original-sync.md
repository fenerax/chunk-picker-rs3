# Sync from original picker

Open **More → Sync from original picker** to fetch Player 1’s QXA map and Player 2’s QXB map. Fetching reads their public original-picker gameplay data and creates a temporary review. It does not save changes to either original map or the local app.

The review shows each player’s last successful sync, chunks to unlock or lock, selected candidates and their order, blacklist changes, pending roll choices, rule differences and task progress. Changed map groups are checked by default. Rules and Tasks are optional and unchecked by default. Applying an F2P rule changes the shared content rules for both players.

Local unlocks and task cleanup appear under **Kept from this picker**. Sync reads History to find each chunk’s last ownership change and each task’s last completion or backlog choice. A chunk unlocked here stays unlocked even if the original still has it locked, selected or pending. A task unticked or backlogged here cannot be re-ticked by an old original check. This includes the bulk removal of checks credited to the other player. Other original changes remain available to apply.

These choices survive later syncs that leave them unchanged, including syncs of other groups. Undoing a local choice releases its protection; clearing a backlog releases that backlog choice. Note and favorite edits do not count as cleanup. History from retained archives is included, and protections stay separate for each player. A whole-save restore uses the restored save’s active History, rather than earlier History kept only for inspection.

Choose the groups to apply, then press **Apply selected changes**. The selected groups use the shared save queue and form one undoable local command. Unchecked groups keep their current values. Moves between unlocked chunks, selected candidates and pending choices may require selecting the related groups together; a validation error explains the conflict without saving a partial change.

Tasks shows counted, expandable lists of original checks to mark complete, local completions to keep, backlog entries to add with their reasons, local backlog entries to keep, unmapped records and differing backlog reasons. Selecting Tasks imports completion checks and backlog additions together. Missing or unchecked original records never clear local completion or backlog. Local favorites and nonempty task notes stay intact; an original backlog reason fills an absent or empty note. Existing backlog entries keep their reasons even if the original differs. Tasks starts unchecked because manual/historical checkmarks and reasons deserve an explicit review; fetching a newer map alone should not choose that progress import for the player.

Original notes, task checks and custom tasks also remain available as raw inspection evidence. Sync does not replace chunk notes, custom tasks, RuneMetrics progress or other personal progress. A full original export remains available through the existing capture/import workflow when needed.

**Cancel** closes the review without applying. Fetch failures show an error and **Retry fetch**. Incoming shared saves invalidate the review; fetch and review again before applying. Closing or replacing the dialog also invalidates it, including a queued Apply that has not started. A request already sent to the server can complete and update shared state. Expired previews require a new fetch.

## API and verification

`POST /api/original-sync/preview` with `{}` returns an opaque `previewId`, `currentRevision`, capture and expiry times, warnings and per-member differences. The UI submits only that token and selected member groups through `POST /api/command` with the reviewed revision:

```json
{
  "expectedRevision": 7,
  "command": {
    "type": "sync-original",
    "previewId": "server-issued-token",
    "members": [{ "memberId": "player1", "groups": ["chunks", "selections"] }]
  }
}
```

The server resolves the temporary token to trusted captured targets with local protections already applied and rejects stale, expired or invalid reviews. Sync freshness is recorded per player in `member.originalPickerSync`; the preview exposes its last applied time as `lastSynced`. Protected-only groups have no apply checkbox. The applied History command records only the resulting targets, using the existing revision checks and Undo; no additional save fields are needed.

The endpoint requires the picker’s existing private invitation authentication and same-origin JSON request protection. It calls `capturePublicMaps` with its public gameplay whitelist and only HTTP GET requests. Captures are cached in memory for 30 seconds; previews expire after 10 minutes. Nothing polls the original service. Network failures and invalid chunk/rule shapes return clear errors without applying a partial capture. Source map IDs, capture time, applied time, hash and chosen groups stay in History and per-player provenance; Undo restores the preceding provenance too.

Rule comparisons use the player’s current rule precedence and the shared F2P setting. A missing effective override is displayed as inherited; sync does not guess defaults for the original’s unrecorded rule keys. Applying rules retains custom app-only keys. Captured challenge checkmarks remain review evidence and never become observed personal quest completions.

## Original task semantics and mapping

The [original public JavaScript](https://source-chunk.github.io/chunk-picker-rs3/index.js), checked on October 8, 2026, matches the retained reference behavior:

| Original field | Meaning | Imported effect |
| --- | --- | --- |
| `checkedAllTasks` | Independent checkbox/highlight in the full skill-task list, counted in that list’s progress display. | A positive check is evidence of challenge satisfaction. |
| `checkedChallenges` | Checked task in the current active challenge list, before archiving. | A positive check is evidence of challenge satisfaction. |
| `completedChallenges` | Archived checks. Rolling or manual challenge completion calls `completeChallenges()`, which moves active checks here and clears `checkedChallenges`. | A positive check is evidence of challenge satisfaction. |

The full-list checkbox does not automatically update the other two fields. See retained `reference/original-picker/index.js` lines 10468–10516, 12502–12541 and 12660–12678, with archival calls at 3028, 3508 and 10800. The capture’s public `version` field is metadata, not proof of the JavaScript version; the deployed JavaScript was checked directly.

Sync unions only boolean `true` checks from the three sources per member, resolves identities and deduplicates aliases. It writes `taskStatus[id].challengeCompleted`, following the existing migration. It does **not** write `completedTasks`, personal quests, skills or rewards. Either member’s evidence can satisfy the duo’s obligation under the existing shared completion policy; it does not create a personal completion for the partner. The preview keeps the three source names visible. History records the applied task IDs/reasons and the original capture hash/time; it does not recreate the upstream active/archive UI stages.

Mapping uses the same `buildIdentityIndex` as migration: authored identities, the saved identity registry, current `reference/original-picker/tasksMap.json`, historical/tombstoned mappings and ordinary/generated catalogues. Resolution is category-aware; colliding IDs are never guessed. A known identity absent from saved rows and the current trusted catalogues is also withheld, so a retired generated task cannot make the entire apply fail. An unmapped record retains its original category, ID, label when available and source fields. A backlog entry with an empty reason is still a backlog entry. Conflicting original reasons from multiple aliases of one task are withheld for manual review. Completion checks can be imported for hidden/member tasks as historical evidence, but Tasks never changes membership rules, task eligibility, ownership or obligation generation.

`tasks` is one additional selected group in the API example above. The server resolves it to trusted positive task IDs and backlog reasons; clients cannot supply task metadata or remove progress. It uses the same revision checks, expiring preview token, save queue, History and one-command Undo as the map groups. Undo restores statuses, reasons, registered task rows and sync provenance. Identity aliases materialized by trusted registration remain useful after Undo, as for ordinary task commands.

Run `node --test tests/original-sync*.test.mjs tests/original-task-sync.test.mjs` for diff, identity/semantics, command/Undo, HTTP and UI checks, then `npm test` for the full suite. `tests/fixtures/original-sync/capture.json` records real public QXA/QXB chunks, selection ranks and rules; its metadata lists sampled notes/check fields. Tests replay fixtures with an injected HTTP client and never fetch live original maps. A small task-engine fixture verifies that imported checks satisfy the duo while preserving personal completion and F2P eligibility.
