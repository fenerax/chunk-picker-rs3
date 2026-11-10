# Owned preparation and Undo reader safety

All evidence below uses synthetic data and Node v24.20.0. No existing player
saves or deployment data were inspected.

## Legacy exposure, checked first

On source `605d37c`, a legacy context with `independent: false` and no caller
`prepareState` accepted this HTTP sequence:

1. Add a custom task: 200, revision 1.
2. Edit it: 200, revision 2.
3. Read `/api/coordination`: 200.
4. Edit it again: 200, revision 3.

Closing and recreating the server against that temporary store failed with
`Cannot load the saved state: Stale undo: task catalogue has changed`.
Revision 3 remained on disk byte-for-byte. The loader does not select a previous
backup: only a missing state file permits initialization. Failed startup releases
the store lock. Production startup also closes its early listeners, and its CLI
sets exit status 1 (`app/startup.mjs`, `app/server.mjs`). This establishes source
exposure before the owned-preparation optimization; it does not establish the
condition of any live save or which source a deployment runs.

## Root cause and repair

`prepareUndo` shared `state.tasks` with its inverse preview.
`restoreTaskChanges` optimizes same-position edits by replacing array entries
in place. An eligibility read therefore silently restored an older task row in
the live state, without changing revision or saved bytes. The cached task index
could still reference the newer row. The next edit could then publish a History
chain that full load validation refuses.

The preview now owns a shallow catalogue array whenever it applies task deltas.
Rows and inverse payloads remain isolated as before; both successful and failed
previews preserve the live array and its index. This also fixes legacy contexts.

The read-path audit traced coordination metadata and eligibility through all
inverse helpers, plus state/calculation, History and progress projections.
Member/claim writes already target private copies; rules, finish-line, group-goal
and rule-review inverses replace or clone their values. Progress replay clones
members and rules. No additional live-state mutation was found on those paths.

The owned currency proof now also requires
`legacy.gameplayMigration.report.catalogueTasks === state.tasks.length` when a
migration record exists. A changed count takes full preparation, allowing the
existing migration to refresh its report. Migration reuse conditions themselves
are unchanged. Membership and dataset checks still run before the proof returns.
Replacing, importing and restoring keep full preparation. Existing stale report
loads follow the old full path's revision/History refresh behavior.

## Targeted verification

Run with `node --test --test-reporter=tap --test-concurrency=1`, the matching
dataset environment, and these files only:

| File | Passing cases |
| --- | ---: |
| `tests/owned-picker-preparation.test.mjs` | 17 |
| `tests/storage-reader-purity.test.mjs` | 4 |
| `tests/storage-undo-safety.test.mjs` | 2 |
| `tests/coordination-view.test.mjs` | 9 |

All 32 cases passed on the final source; no skips or cancellations. The reader
regression's four cases were also run against extracted `24555f0` and all failed
as expected, including the exact HTTP sequence for both legacy and owned contexts.
Two invalid new fixture commands were corrected during validation. No suite or
repetition loop was run.

The expanded equivalence sequence covers custom add/edit/delete, task completion,
generated-goal registration by both completion commands, and Undo. It interleaves
coordination, latest/selected Undo eligibility, state/calculation snapshots,
History and progress reads, and reopens after each command and reader step.
State, revision, History, eligibility and migration counts match full preparation.
Separate cases retain authorization, dataset, import/restore and archived History
checks, and repair an existing stale report on reopen.

## Production-size synthetic benchmark

`node scripts/perf/owned-command-current.mjs` builds through real migration:
24,000 tasks, 91,000 aliases, 14,518,982 state bytes. The before variant removes
the owned currency proofs to exercise the original full preparation path.
One sequential sample per variant, fresh-process reopen with a warm filesystem;
includes durable storage and play-response serialization, excludes HTTP, browser,
dataset and calculator startup. Numbers are milliseconds, rounded.

| Operation | Before wall / main CPU | After wall / main CPU |
| --- | ---: | ---: |
| Reopen | 4376 / 2126 | 2140 / 843 |
| Set note | 2241 / 1687 | 259 / 203 |
| Complete task | 2477 / 1734 | 33 / 16 |
| Set rule | 2315 / 1563 | 37 / 31 |
| Undo rule | 3297 / 2500 | 3872 / 2000 |
| Undo completion | 2310 / 1625 | 307 / 32 |
| Set partner note | 2122 / 1704 | 246 / 15 |

Both variants ended at revision 6 with identical state and History digests.
Rule Undo retains its existing full command-validation path. Catalogue count
changes now deliberately take full preparation and are outside this timing
sequence. The fix prevents this corruption trigger; it does not repair a save
whose History chain is already invalid.
