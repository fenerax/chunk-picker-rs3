# Copy lists as text

**Copy** beside the map counts exports the selected player's unlocked chunks or
current roll pool, including chunk names and IDs. **Copy** beside Active Tasks
and Completed Tasks exports those lists as displayed. Active Tasks respects its
search and filters; Completed Tasks respects its current search.
Active tasks follow the displayed category and item order, including folded
categories and tasks behind **Show more**. Group view copies the combined list.

Each export starts with the player name, list name, total count and today's
local date. Items use Discord bullets, with category headings for task lists.
Formatting keeps one complete prefix within 2,000 characters. Longer lists end
with **…and N more**; **Copied · X of Y** also makes that omission visible.
An unusually long item is omitted whole rather than shortened.

Successful clipboard writes show **Copied** beside the button. If clipboard
access is unavailable or denied, a read-only text box opens beside the list with
all its text selected. **Select all** repeats the selection, and **Close** returns
focus to Copy. The same formatted text is used for both paths.

Copy works on view-only links and never saves or changes gameplay. Sandbox
exports are labelled Sandbox. Discord markdown in names is escaped and mentions
are neutralized.

**Completed Tasks → Review all → Copy** exports the complete filtered review,
including its date range, search and evidence filters, folded categories and
later pages. Its header uses the reviewed player(s), range and task count. Rows
include completion attribution and dates and follow category or recent ordering.
This review export includes every match, so long copies can exceed Discord's
single-message limit; the sidebar and map copies retain their 2,000-character cap.

Formatting lives in `app/web/copy-list-model.mjs`; clipboard and recovery live in
`copy-list-control.mjs`. `copy-lists.mjs` attaches them to the two screen renderers.
Focused model, controller and small-fixture integration tests run in the quick
suite.
