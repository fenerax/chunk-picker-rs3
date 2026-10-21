# Sandbox predictions and rule profiles

`app/core/planning.mjs` contains pure planning operations. It does not read or write files, contact a server, or save sandbox progress.

## Rule profiles

Profiles are ordinary JSON files:

```json
{
  "format": "rs3-chunk-rule-profile",
  "schemaVersion": 1,
  "rules": {
    "access.shared": true,
    "roll.neighborMode": "accessible",
    "roll.teleportScope": "personal",
    "tasks.completion": "any"
  },
  "taskRules": { "Skills": true, "Quests": true, "Boosting": false }
}
```

- `exportRuleProfile(state, memberId, registry?)` exports the group's explicitly saved rules and that member's task-rule overrides. It excludes progress, notes, ownership, history and raw legacy records.
- `previewRuleProfile(state, profile, memberId, registry?)` accepts an object or JSON string and returns `{changes: {rules, taskRules}, warnings}`. Each change has `id`, `before`, `after`, and `kind`. Group comparisons include registry defaults.
- `applyRuleProfile(state, profile, memberId, options?)` returns a new state after one atomic `set-profile` command. Options match `applyCommand`, including `expectedRevision`, `registry`, and `now`. The caller decides whether to persist this reviewed result.

A profile replaces the saved group-rule map and the target member's task-rule map. Omitted group settings take registry defaults; omitted personal task overrides are removed. Other members' task rules and all members' progress remain unchanged. A single undo restores both maps.

Unknown group IDs, incorrect types, unknown profile fields, nonprimitive task-rule values, and unsupported versions are rejected. Profiles contain data only: adding a new combination of supported settings does not require engine changes. A genuinely new rule behavior needs a registered candidate/exclusion hook or task-engine support. Unsupported task-rule names retain the engine's diagnostic behavior; a profile cannot inject executable code.

## Predicting a possible chunk

```js
const prediction = predictChunk(state, memberId, chunkId, { world, engine, registry });
```

`world.chunks` is a Map; optional `world.surface` limits the supported map crop. `engine.evaluate(state, memberId)` follows the task engine's existing interface.

The function evaluates the current state and a separate hypothetical unlock. It returns `{state, result, delta}`. The returned state is deeply frozen and keeps the original revision and history: no synthetic command/event is created. The function removes that target from personal selected/blacklisted records; if it was a pending choice, the other choice returns to selected. It does not create personal quest or skill completion, seed a random-start section, or persist anything.

`delta.tasksAdded` and `tasksRemoved` contain newly available or no-longer-available visible task rows. `tasksChanged` records status transitions. Item and equipment additions/removals contain their engine records. Base, section, area, object, NPC, monster and shop additions/removals contain IDs/names. `trainingChanged` records before/after potential training data. The engine result carries its diagnostics and coverage limits: a hypothetical unlock does not establish actual account progress or waive unsupported prerequisites.

## Comparing the whole roll pool

Open **Compare pool** beside **Pick Chunk** and **Roll 2**. It lists every chunk in the selected player's saved pool. Rows start with the most new tasks. **Sort by** can compare a skill instead. Each checked row has a count, named task examples, skill counts, and notable quests, shops, resources and travel entries. Click its name to centre the map. The comparison does not unlock a chunk. Sandbox's former eight-chunk sample has been removed; this comparison uses the saved map.

**Checked** means the existing prediction engine finished that chunk. **Still checking** means its count is unknown; an unchecked chunk never appears as zero. Counts are new available, visible obligations for that player, using `delta.tasksAdded.length`. They do not subtract tasks removed or include every task in the partner's chunks. Travel examples are new spell tasks or travel landmarks, not a promise that a personal teleport has been activated. Advanced adds chunk IDs and save details. Normal view keeps calculation details hidden.

`app/tasks/pool-ranking.mjs` keeps small summaries apart from the prepared unlock cache. Existing completed predictions supply rows immediately. Missing chunks join the existing prediction worker's background queue after pending rolls, selected choices, foreground lists and panel preparation. Ranking uses the lowest prepared-cache priority and cannot evict protected choices. Complete prepared pairs also prevent repeat preparation when a ranking delta displaces a response from the ordinary response cache. Neither the task engine nor the worker's calculations have changed.

`GET /api/pool-ranking?memberId=…` only reads saved summaries and prediction deltas. View-only links can read it; they cannot register calculation work. Pool membership uses the same saved-map rules as the map. `POST /api/pool-ranking-intent` registers a writable tab's interest with `{memberId, revision, watchId, visible}`. The client renews its 30-second lease every ten seconds while the section and browser tab are visible and the main lists have settled. Closing, hiding, changing player, entering Sandbox or losing interest cancels queued ranking work. A gameplay change discards old summaries and interests. Display changes and dibs retain matching results.

Ranking adds no worker. Opening a comparison counts as one explicit use; polling, lease renewal and background completion do not reset `RS3_WORKER_IDLE_MS`. Its normal ten-minute sleep still applies. Saved summaries survive that sleep. Rich examples have a 512-row / 2 MiB LRU budget. Small count and skill-count records cover the complete known pools even beyond that budget, so checked chunks do not cycle through repeated calculations. Under that exceptional pressure some examples may be omitted, while every count remains available.

`scripts/perf/pool-ranking.mjs` checks the real copied-save workflow and writes timings, peak picker RSS, and desktop / 390-pixel screenshots under `.local/perf/wholepool/`. Run it through the shared lock:

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/perf/pool-ranking.mjs
```

The harness copies the duo save inside this worktree, excludes `store.lock`, uses an ephemeral loopback port, stops its server and browser, then removes the copy. It leaves the original save untouched.

Desktop observation, October 12, 2026: Player 2's 20-chunk pool started with zero checked rows and finished in 105.55 seconds. Reopening read all saved rows in 16.2 ms. Peak picker process RSS, including its existing worker threads and Group task loading, was 6.83 GiB; this remains substantial memory use. Total and skill sorting, row centring, stopping ranking work on close, and viewer reads without work all passed. Desktop and 390-pixel screenshots and the private report are in `.local/perf/wholepool/2026-10-12T18-48-09-952Z-*`. The original save's SHA-256 stayed unchanged, and the owned browser, server and copied save were removed. These are one-run observations, not latency or memory guarantees.

Verification: the shared-lock full suite passed 2,773 tests with one skipped and none failed. Focused checks cover complete pools beyond both queue and summary budgets, protected prepared results, idle sleep, cancellation, saved reads, viewers, and stale player/save responses. The final fixture cleanup guard also passed its three server checks. No task-engine or worker calculation code changed.
