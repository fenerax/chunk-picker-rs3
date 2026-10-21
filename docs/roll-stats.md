# Roll stats

Open **Info → History → Roll stats**. View-only links can open the same view.
It reads the save and complete retained History without changing either.

The step chart counts dated chunks that are still unlocked, for each player and
the duo. The duo counts distinct chunk IDs, so a chunk owned by both players
counts once. The summary includes all currently unlocked chunks, the average
and median time between dated unlocks, the longest completed gap, and dated
unlocks within the preceding seven days.

Undo, locking a chunk, forfeiting it, or replacing a map removes the affected
unlock from the dated series. A later unlock uses its later date. Offering two
chunks does not count until a choice is unlocked; unlocking both produces two
unlocks at the same time, with a zero interval between them.

Retained original-picker roll records (`chunkOrder`, keyed by timestamps) can
date imported chunks that are still unlocked. Repeated records count once.
Imported chunks without a matching unlock date count in totals and appear
in the “chunks have no date” summary. Capture times, sync times, and map-wide
timestamps cannot establish when those chunks were unlocked. The chart and
timing numbers omit them. If either current owner has no recorded date for a
shared chunk, its first appearance in the duo is also unknown. At least two
dated chunks are needed for gap statistics; the wait since the most recent
unlock is not a completed gap.

The pure model is `app/core/roll-stats.mjs`. Storage projects only relevant map
evidence from durable archives and respects later revision overrides. A full
restore uses the incoming save's retained History when available, rather than
borrowing dates from the previous save.

The chart uses SVG geometry and a feature stylesheet, with no inline styles or
scripts. It has a caption, named line patterns, and a summary table with row and
column headers. Focused model, dialog, storage, and viewer API tests cover this
behavior. Desktop and 390 px browser captures use an isolated synthetic save
containing both dated and undated unlocks.
