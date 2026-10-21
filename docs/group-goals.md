# Shared group goals

The task panel shows **Group goals** above Active Tasks in both personal and
Group view. On a phone, open **Tasks**. Add a short plan, optionally choose an
existing task or item, and choose **Each player** or **Once for the group**.
Edit, move up/down, mark done, reopen, and remove use the same shared save as
the map. View-only links display goals and progress without editing controls.

Each-player goals are done when every player is ticked. The overall Done tick
checks or clears everyone together. Group goals have one Done tick. These are
planning checks: they do not record personal game progress, satisfy a chunk
task, claim dibs, or change the F2P finish line. An optional picker link provides
context; it does not tick either the linked task or the goal automatically.

## What existed before A7

Personal pins live in `member.taskStatus[taskId].favorite`. The existing
`set-task-status` command saves them with revision checks and Undo. Personal
Active Tasks sort favorites first; task dialogs offer “Pin to the top of the
list”, and Filter & sort offers “Pinned only”. Group rows honor each owner's
pins and filters. History says “Pinned/Unpinned … for Player 1/Player 2”.

The retained original picker has no dedicated shared goal list. Imported
`chunkinfo.favoriteTasks` become each map owner's personal pins; checks,
backlogs, custom `userTasks` and notes remain their existing task/map records.
Raw allowlisted original gameplay stays under `legacy.maps`. Unknown nested
fields remain there, while unsupported top-level fields are omitted with an
import warning. Existing pins are never promoted into shared goals.

The October 13 copied-save check found `activeTasks` in both original maps and
`checkedAllTasks` in QXA; neither retained original map had a top-level goal
field. These are original task records, not a shared free-text plan.

## Save and command boundary

`app/core/group-goals.mjs` owns the five commands and goal validation.
`groupGoals` is an optional ordered root array, bounded at 100 goals with
200-character goal text. IDs are stable; each goal stores its completion mode,
player checks, overall done state, and optional picker reference with a saved
label. Labels survive a linked custom task's deletion. New links must reference
the current task catalogue or a known picker item entity.

Every mutation uses `expectedRevision`. The inline editor keeps its opening
revision and draft if another save arrives, so a stale editor cannot overwrite
the partner's change. History retains the goal wording, including after removal.
Undo guards both sides of the bounded shared list and restores optional-field
absence. Shared goal Undo follows the newest-change order; independent older
personal Undo preserves the goals.

Goals travel with backups and durable saves but are excluded from task
calculation inputs and fingerprints. Goal edits reuse current task results.
No original map, imported pin, or personal task completion is changed.

## Verification

Focused model, controller, History and server tests cover commands, per-player
and group completion, order, links, Undo, malformed input, stale revisions,
backup/restart preservation, and viewer write denial. Server tests use isolated
synthetic stores; screenshot acceptance uses a disposable copy of the duo save.

On October 13, the copied-save browser session exercised add, edit, reorder,
group ticks, remove/Undo, and a live update while a draft stayed open. Desktop
1440 × 900 and phone 390 × 844 displayed three sample goals without overflow.
The viewer saw the goals without controls, and a write attempt returned 403.
There were no browser exceptions or CSP errors. The session stopped its owned
browser/server, deleted its copied save, and verified the original state hash.
Screenshots and the acceptance report are under `.local/screens/group-goals-*`.

The final focused goal/History/server run passed 35 tests; the quick suite
passed 1,066. The one locked full run recorded 3,472 passes, 251 failures and
one skip (3,724 tests). All failures came from five fixtures missing the new
goal factory/command-type bindings or the snapshot renderer's optional goal
callback. Those fixtures were repaired, and a focused rerun of all five files
passed all 272 tests. The full suite was not repeated, following the job's
once-only rule. The feature's real-browser checks remain the separate evidence
above.

Repeat acceptance with
`powershell -NoProfile -File .local/with-heavy.ps1 node scripts/review-group-goals.mjs`.
The script pauses after screenshots so they can be inspected in the same session;
write `{"recapture":false}` to
`.local/screens/group-goals-review-continue.json` to finish the viewer checks and
cleanup (or `{"recapture":true}` to reload and recapture both viewports first).
