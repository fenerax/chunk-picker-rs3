# Active Task filters

The Active Tasks sidebar has a Skill picker, Doable now, Pinned only, player
claim filters and a Sort menu. Filter & sort opens these controls on phones.
Text search waits 100 ms after typing stops.

Beside Filter & sort, **Collapse all** folds every skill group currently shown.
When they are all folded it becomes **Expand all**. This follows search, skill
and player filters, including All possible tasks, and remembers the same browser
preference as individual folds. Groups outside the view keep their folds. Empty
views hide the button.

Doable now uses the task's existing availability and listed blockers. It does
not calculate new inventory, skill or quest facts. In Group view, filters must
match the same player on a shared task. Hide tasks my partner is doing removes
tasks claimed by another player; Only my claimed tasks keeps tasks claimed by
the signed-in player. These filters use saved claims.

Default order keeps pinned tasks first, followed by skill and descending level.
Level sorts from low to high, with missing levels last. Skill sorts headings
alphabetically, then task names. Name sorts task names alphabetically. Tasks
retain their category headings; equal sort keys keep their existing order.

Clear resets search, player scope, selected skills, claim filters, Doable now,
Pinned only and sorting. Category folds stay as chosen. The browser remembers
filters, sorting and folds in `rs3:active-task-filters:v1`; corrupt or unavailable
storage falls back to the normal list. These choices never send a gameplay
command.

Folded categories do not construct task rows. Both personal and Group lists
initially paint at most 70 rows per open category, with Show more for the rest.
Expand all uses the existing sliced paint queue and cancels stale rendering.
