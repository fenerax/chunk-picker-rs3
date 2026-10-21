# Completed task review

Open **Review all** beside the sidebar's **Completed Tasks** heading, or choose **Completed Tasks** under **More**. The review player selector does not change the map player. **Both** combines the two players' task catalogues and lists each completion family once.

In Group view the sidebar's Completed Tasks combines both personal lists with
owner badges and the Active list's All / Player 1 / Player 2 / Both filter. The heading
and copy button use the displayed scope; copied rows include owners and completion
attribution. Review all starts with the named player for Player 1 or Player 2, and the
combined ledger for All or Both. The review's Both switch means the full union,
so it can include more rows than the sidebar's shared-only Both filter.

Search task names, categories or player names. Evidence filters distinguish personal challenge ticks, a partner's completion, verified RuneMetrics quest observations and known imports from the original picker. Category headings show skill icons and counts and can be collapsed. **Most recently completed** gives a flat list with recorded dates first and unknown dates last. Search and filters include rows beyond the displayed page.

**Date range** offers All time, Today, Last 7 days, Last 30 days and Custom From/To dates. Ranges use local calendar days, including today and both custom end dates. Either custom bound can be left blank. Search, evidence and date filters apply together; the list heading and empty state describe the filtered set. A completion family uses its latest recorded completion date, including shared completions. Undated completions appear only in All time, with a short count beside the list. The overview remains labelled all time.

**Copy** in the review exports every matching task, including folded categories and later pages, in the chosen order. Its header names the reviewed player(s), date range and filtered task count; rows retain completion attribution and dates. Clipboard recovery also works on view-only links. Long review copies can exceed Discord's single-message limit. Quick date choices are remembered in this browser without changing the shared save, History or gameplay fingerprint. Custom bounds stay in the current review; reloading restores the last quick choice.

The summary covers the whole selected player's ledger, independent of the search filter: completed tasks, completions recorded since local Monday, per-category counts and completed versus possible tasks. Shared completion follows the configured challenge policy; in this duo, either player can satisfy a task. Saved completed tasks remain reviewable when they are absent from a current calculation.

Completion dates come from current, non-undone History commands. Imported checks with no dated local action show **Date unknown**. A RuneMetrics fetch date is an observation date, not proof of when a quest was completed. A missing date alone never marks a task as imported. The ledger uses active History in the loaded save; it does not recover dates from archived History. Earlier history that was not retained cannot supply a completion date.

Completion attribution uses the same **Done by …** wording as Group view. Each evidence row adds **(ticked)**, **(in-game)** or **(in-game, RuneMetrics)**, so a saved challenge tick remains distinguishable from personal game progress. The evidence filters retain that distinction.

Select a task name to open the normal task details and use **Back to Completed Tasks** to retain the review player, search and layout. Task controls and source-method navigation use the reviewed player. In **Both**, task details and backlog target the map player; each Untick action names the owner of its saved check.

The October 10 merge keeps this review context, its full-detail loader and its return action alongside the duo row’s owner context. Both task-detail paths preserve the reviewed player when following a source-method link.

**Untick** asks for inline confirmation and sends the normal `set-task-status` command for that completion's owner and canonical source task ID. Another player's tick or personal in-game completion can keep the task completed. In-game observations have no challenge tick to remove. **Backlog** uses the normal optional-reason form; it does not clear a completion. **Undo last change** uses the application's existing shared Undo history.

The panel opens from already loaded task facts and loads at most one catalogue per reviewed player and saved revision. Full requirements load when a task is opened and are cached for the rest of the review. It makes no per-row requests while rendering or scanning. Rows are painted in frame-sized batches and displayed in pages of 60. Closed categories defer their rows; revisions and changed filters invalidate pending painting and stale loads.

`tests/completed-model.test.mjs`, `tests/completed-range.test.mjs`, `tests/completed-range-preference.test.mjs`, `tests/completed-view.test.mjs` and the existing main browser harness cover evidence, scope, canonical commands, local date boundaries, browser preferences, filtering, full filtered copy, pagination, owner-aware task details and stale results. Real-save browser checks and screenshots use a disposable worktree save; they do not verify Player 2's device or the deployed server.
