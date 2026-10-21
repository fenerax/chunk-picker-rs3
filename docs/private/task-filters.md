# Active Task filters

The Active Tasks sidebar has a Skill picker with checkboxes, Doable now,
Pinned only, and a Sort menu. On phones, a Filter button opens these controls.
The existing text search still waits 100 ms after typing stops.

**Hide tasks my partner is doing** removes tasks claimed by any other player.
**Only my claimed tasks** keeps tasks claimed by the signed-in player, even
while viewing the partner's map. The master link uses the player selected above
the map. Both work in personal lists and Group view, alongside the owner chips.
Clear resets these two switches too. These filters use saved claims and do not
ask for another task calculation.

Choose any combination of the categories present in the list. Quests,
Achievements and BiS have their own choices. Achievements selects the existing
Diary heading, and Quests selects Quest. A chosen category stays in the
picker when switching players or searching, even if that view has no matching
tasks, so it can always be unchecked.

Doable now uses the task's existing availability and listed blockers: an
available task with no blockers passes. It does not calculate new skill,
inventory or quest facts. Task availability can use reachable training ceilings;
this filter is a review of the existing task evidence, not a new live account
check. Its plain explanation is always visible beside the controls.

Custom tasks with a skill and level additionally compare that level with the
player's saved RuneMetrics observation for the current account. Missing levels
do not pass. Their assignment controls personal lists and Group ownership; see
[Custom tasks](custom-tasks.md).

In Group view, the owner chips and new filters work together. A Player 1 or Player 2
chip uses that player's own task details and pins. All and Both accept a task
when at least one of the named players passes. If both Doable now and Pinned
only are selected, the same player must pass both. The small star uses the same
owner scope; personal Completed Tasks and Backlog retain their own player's pins.
Show blocked and All possible tasks inspect both personal catalogues on demand.
Text search also includes available tasks outside the normal presentation.
Blocked reasons name their player. Search, skill, Doable now and Pinned only
must match the same player on a shared row.

The secondary Group filter selects tasks the chosen map player has not done,
or tasks only that player can do on their map. It uses personal completion and
current availability even when the partner has already satisfied the challenge.
Counts match the filtered list. Its choice is remembered for each viewer in
`rs3:group-task-filter:v1:<viewer>`; it never changes saved gameplay.

Default order preserves the current pinned-first, skill, highest-level-first
order. Level sorts from low to high, leaving tasks without a level last. Skill
sorts headings alphabetically, then task names. Name sorts task names
alphabetically. Tasks retain their canonical category headings in every mode;
for Level and Name, headings follow the first task encountered in that order.
Equal sort keys keep their existing order.

The hidden count includes text search, owner chips and the new filters. Clear
resets search, owner chips, selected skills, Doable now, Pinned only and sorting.
Category folds stay as chosen, with visible headings and their counts. The
browser remembers skills, checkboxes, sorting and folds in
`rs3:active-task-filters:v1`; corrupt or unavailable local storage falls back to
the normal list. These choices never send a gameplay command.

Folded categories do not construct task rows. Both personal and group lists
initially paint at most 70 rows per open category, with Show more for the rest.
Row painting retains the existing time slices and stale-generation cancellation.
Pin lookup uses saved-favorite indexes instead of scanning the save for each row.
Text and display filters
reuse the current duo selection instead of repeating its facts calculation.

## Verification

Model, controller and shipped-main browser tests cover filters, sorts,
owner interactions, storage errors, persistence, folds, stars, display-only
behavior, the existing debounce and 2,000-row selection.
The full `npm test -- --test-concurrency=1` run passes all 2,252 tests with no
failures or skips. A focused model/controller/browser/comparison run passes
150 tests. Prediction goldens are unchanged.

`node scripts/review-task-filters.mjs` reads a frozen copy at `.local/duo`,
creates one disposable loopback server and browser profile, checks both players
against their existing API presentation, then exercises filtering and reloads.
It pins one existing task only in its disposable copy when a saved pin is needed
for the review. The original copied save is hash checked and untouched. All
scratch processes and their save/profile are closed and removed in `finally`.
Reports and desktop/390px light/gray captures stay local under
`.local/taskfilters-review`. The script rejects ports 8788 through 8791.

The October 10 copied-save review uses state SHA-256
`7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
Unfiltered identity sets match before and after Clear:

| List | Before | After |
| --- | ---: | ---: |
| Player 1 | 25 | 25 |
| Player 2 | 26 | 26 |
| Group | 28 | 28 |

Player 1's Attack filter shows **Wield a gravite melee weapon**; Player 2's
Dungeoneering filter shows **Enter the Al Kharid resource dungeon**. BiS and
Doable now together show six shared goals, including **Brawler's hook
necklace** and the **Gravite 2h sword**. With Show blocked enabled, Doable now
reduces Player 1's 5,409 rows to 1,067 and Player 2's 5,113 to 1,044. These are the
existing availability checks, including reachable training ceilings.

Neither player had saved favorites in the frozen copy. The review pins
Brawler's hook necklace for Player 1 only in its scratch save: Pinned only with
BiS and Doable now shows one row for All, Player 1 and Both, and zero for Player 2.
Clearing restores all 28 original group identities. The source hash stays
unchanged and the scratch save/profile are removed.

The four main captures are `desktop-light.png`, `desktop-gray.png`,
`phone-390-light.png` and `phone-390-gray.png`; a fifth,
`phone-390-gray-collapsed.png`, checks the closed phone controls. These are
headless localhost captures at 1440px and 390px, not real phone measurements.
All capture widths are checked against their viewport.

The paired three-run [performance comparison](performance.md#active-task-filters--october-10)
meets the 10% gate for personal and Group Reload/Unlock task milestones. The
frozen `.local/duo` copy is removed when verification finishes; only local
reports and screenshots remain.
