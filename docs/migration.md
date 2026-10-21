# Legacy gameplay migration

`migrateGameplay(state, { definitions, taskMap, taskMapHistory, catalogue, dynamicCatalogue })` converts gameplay facts that
`importLegacyMaps` deliberately preserves as raw records. It returns a new `{ state, warnings,
report }` value and never mutates the input or the payloads under `state.legacy.maps`.

## Task identity and catalogue

Permanent ordinary task IDs are assigned `rs3:task:<opaque token>` values from the authored identity
registry. Generated collection and equipment goals use `rs3:goal:<objective kind>:<entity tokens>`;
their source/item tokens are assigned picker entity IDs. Labels, categories, rates, quantities and
formatted equipment names are metadata. [architecture.md](architecture.md#permanent-task-and-goal-identity)
defines the scheme and the explicit rename workflow.

The preceding `rs3:${encodeURIComponent(category)}:${encodeURIComponent(rawTaskLabel)}` forms are
retained as aliases. Their category and label text is NFC-normalized while exact spelling and case
remain meaningful for decoding. Display labels remove the old `~|wiki marker#anchor|~`, link
anchors, trailing task flags, and HTML markup. Saved catalogue rows still contain `id`, `label` and
`category`; richer identity/alias metadata lives separately under `state.identityRegistry`.

Migration registers every `definitions.challenges` entry, custom `userTasks`, and encountered BiS
tasks that have one unambiguous label in `taskMap`. Existing `state.tasks` records win on ID
conflicts, so authored and manual tasks survive repeated migration. A supplied catalogue is merged
the same way.

The old `taskMap` is label-to-`t_ID`, and 35 IDs are reused by different labels. The authored historical
ledger retains all 92,638 baseline label/code mappings. Regeneration writes a separate current
catalogue, preserves removed labels as tombstones and never recycles a historical code. Pass the
ledger as `taskMapHistory` so removed decoders continue to work. Migration resolves
those IDs inside the saved category. For example, `t_120947` resolves to the stacked ceramic flower
pot in Construction and elder stock in Fletching. IDs that remain ambiguous or unknown are listed in
both `report.unresolved` and `state.legacy.gameplayMigration.unresolved`; their original records stay
in the legacy map.

The [October 8 parity repairs](research/switchover-parity-fixes-2026-10-08.md) add eight reviewed category/rename aliases. Existing stores retry only previously quarantined records for those aliases once, recorded as `gameplayMigration.progressAliasesVersion: 1`. Startup and detached parity evaluation share this readiness check. Competing persisted/catalogue decoders remain unresolved; explicit canonical false values and checks cleared after migration remain authoritative. The five conflicting quest skill clones are preserved for review. These aliases project challenge evidence, never personal quest completion, inventory or usable lodestones.

## Reversible permanent-ID projection

`migrateTaskIdentities(state, {catalogue, taskMap, history})` resolves materialized saved records
against the authored registry, historical decoders and the state's persisted aliases. It returns
`{state, warnings, report}` without modifying its input. It handles:

- Personal completion arrays and every task-status record, including notes, backlog, favourites
  and challenge checks.
- Saved task alternatives and task-catalogue rows.
- Task IDs in historical commands and both full-snapshot and sparse-delta undo records.

Whenever projection changes these fields, `provenance.taskIdentityMigration.archives` retains the
complete original task rows, members, history and prior identity registry. `conversions` records
the source path, `originalId` and `permanentId`. This archive is the reversal source; the raw imported
maps also remain unchanged, and server replacements keep their existing preceding-state backup.
Portable backup/restore includes the identity registry and migration provenance without requiring
an external decoder file to preserve a discovered alias.

Imported custom `userTasks` are allocated permanent custom tokens once; their old label IDs remain
saved aliases. Legacy alternative choices are decoded once per owner, preserving their raw map
records and respecting explicit authored choices, including null. Category renames move known
alternative preferences into the current category and retain conflicting values in the archive.

Several old keys can address the same objective. Compatible status fields merge; an explicit
permanent-key field wins when values conflict, including false and empty notes. Conflicting evidence
remains in the original archive and conflict report. Unknown and ambiguous IDs retain their keys
and values, gain an `Unresolved` catalogue entry where needed, and appear in `warnings`,
`report.unresolved` and the saved identity diagnostics. They are never silently omitted or assumed
complete. Category context remains required for reused legacy codes.

A collision that merges formerly distinct status or catalogue rows establishes an explicit undo
boundary: active history is cleared with a warning and the complete original history remains in
the archive. Collision-free migrations rewrite both sides of undo deltas and retain working undo.

The identity report includes `recordsBefore`, `recordsAfter`, `recordsPreservedInActiveState`,
`recordsPreservedInArchives` and `lostRecords`. Counts cover saved completion, status and alternative
records; a record merged out of the active projection must still be recoverable from the original
archive. `lostRecords: 0` verifies conservation, not universal mapping success. Unresolved and
conflicting records are separately visible for review.

## Converted facts

- `checkedAllTasks`, `checkedChallenges`, and `completedChallenges` become
  `member.taskStatus[id].challengeCompleted`. They are chunk-challenge progress, so migration never
  adds them to `member.completedTasks`, which records observed personal completions.
- `backlog` and `favoriteTasks` become `backlogged`, `favorite`, and decoded `note` fields in task
  status. `activeTasks` is cached display state and is not treated as progress.
- Status provenance is recorded under `state.legacy.gameplayMigration.taskStatusProvenance` and in
  the report.
- Numeric `chunks.stickeredNotes` become `member.notes`. Map-wide `chunkNotes` and subsection note
  keys have no compatible base-chunk field, so they remain raw and produce a warning.
- `chunkinfo.manualSections` becomes `member.sectionOverrides` with `base-section` keys.
- primitive values from the member's source map `rules` become `member.taskRules`.

Upstream Firebase encoding is decoded recursively, including numeric `*fb*_` keys and `-_-20`
percent escapes. Existing authored member values win when a migrated value addresses the same field.
Raw sticky colours, active task caches, skill/passive profiles, equipment state, and `chunkOrder`
remain available in the legacy map for later overlays, task evaluation, and timeline UI.
