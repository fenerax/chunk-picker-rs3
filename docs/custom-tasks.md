# Custom tasks

Custom tasks have a description, an optional skill and level, and an assignment
to Player 1, Player 2 or Both. A selected skill supplies the normal task heading, icon,
Skill filter and sort order. A level needs a skill and must be 1–120.

Each personal list includes only its assigned tasks. Group view shows the chosen
player or Both. Completion follows the current completion rule among assigned
players; earlier checks by a player who is no longer assigned are preserved but
do not satisfy that task. Claim controls follow the assignment too.

Doable now compares a custom level with that player's saved RuneMetrics level for
their current account. Missing levels and observations for a previous account do
not pass. Custom tasks without a level retain their previous behavior. Other task
types keep their existing availability checks. In Group view the same admitted
player must pass both Doable now and Pinned only.

Helper → Our chunk goals includes assigned, unfinished custom skill targets from
the saved catalogue, even when the level has not been reached. Backlogged tasks
are left out. Invention targets show without an XP estimate; unsupported F2P
training targets do not offer a planner action.

Edit task opens the existing form style. Delete task first asks for confirmation;
Cancel and Escape save nothing. Both use revision-checked commands and readable
History. Undo restores edited fields or a deleted row with its checks, notes,
pins, backlog choices, methods and claim. A stale form asks the player to reopen
and review it. Viewer links have no custom write controls, and Sandbox cannot
change saved custom tasks.

Saved rows without `memberIds` default to Both. Older descriptions and categories
remain readable, including imported `rs3:task:custom:` identities. Backup and
identity migration preserve the new fields and custom task History.
Editing a legacy description or assignment preserves its existing category.

Focused coverage lives in `tests/custom-tasks-state.test.mjs`,
`tests/custom-tasks-server.test.mjs`, `tests/custom-tasks-view.test.mjs` and
`tests/helper-custom-tasks.test.mjs`, with the existing state, migration, History,
Undo, filters and shipped browser harness regressions.

The October 12 browser review used a synthetic duo save with production reference
definitions on port 8821. Editing, reassignment, saved-level filtering, delete
confirmation, History, Undo, Helper and viewer restrictions passed. Desktop
1440 × 900 and phone 390 × 844 captures under `.local/screens` have no horizontal
overflow. The scratch server, Chrome profile and save were removed. No live
gameplay save was used. The final full suite passed 2,832 tests with no failures,
cancellations or skips through the shared heavy-work lock.
