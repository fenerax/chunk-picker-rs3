# Export / Import

Open **More → Saves → Export / Import**. The existing dialog offers a **Full
picker backup**, **Import a backup**, and **Copy link for the original picker**.
No reference data, artwork, account credentials or service permissions transfer.

## Backups between copies

Download the existing `rs3-chunk-picker` schema-version-1 JSON/gzip backup. Sign
in to the destination picker you own and choose that file in the same dialog.
Use a fresh owned destination to keep an existing game untouched. The current
public account model supplies one owned default picker per account; this does
not add a picker-creation or invitation system.

The optional `transfer` manifest describes the dataset ID, contract version,
digest, coordinate system, identity namespace, roster and coverage. Existing
version-1 backups remain accepted under their dataset contract. Pre-manifest
legacy backups without dataset provenance are accepted only by the legacy
dataset. Starter and public F2P coordinates are never treated as legacy RS3.

Preview refuses dataset mismatches before writing. Differing roster IDs or
names require explicit source-to-destination mapping. Every source member maps
once; every assigned destination participant must remain represented. Owners
can add unclaimed gameplay slots for the rest of a group. Those slots confer
no account access. Active task assignments, claims, plugin progress attribution,
goals, finish-line checks and progress-snapshot roster IDs are remapped. Text
and historical attribution remain unchanged. Foreign History/inverses stay in
the portable provenance archive behind the existing restore boundary.

Public Apply requires an unexpired preview receipt tied to the caller, uploaded
bytes/options and current destination revision. A changed mapping/file or
intervening save requires another preview. The upload size, decompression,
origin, session recheck and queued-save limits are unchanged. Operator/admin
routes remain private. View-only invitations cannot download backups or apply
restores. Members can restore only their own destination member; missing task
definitions are added within that scope in the same undoable command.

Whole-save restore retains the preceding save and starts a new Undo boundary.
Use **Browse previous saves** to preview and restore that checkpoint. Ordinary
Undo reverses member restore, including task definitions added by the import
and assignment changes. Matching definitions keep their existing assignments
and add the importing member when needed, so their progress counts. Conflicting
definitions refuse preview and apply without importing records.
Registry roster reservations only grow: a failed replacement may leave unused
slots, which grant no access and do not prevent loading the preceding save.

## Transfer reports and coverage

Preview and completion offer **Download transfer report**. The JSON report has
format `rs3-chunk-transfer-report`, version 1, coverage, counts and records.
Records include owner, source field/key, raw saved value, candidate matches,
reason and outcome. Unknown chunk ownership is quarantined in gameplay
provenance, outside active territory. Unknown saved task definitions/progress,
task rules and migration exclusions remain recoverable and are listed for
review. Member reports also describe shared sections left at the destination.
No retained exclusion is presented as a successfully matched game record.

Backups include saved gameplay, hydrated History, identity registries and
migration archives. They exclude unaccepted plugin observations/review sidecars,
accounts, sessions, invitations, keys, reference datasets and artwork. Already
accepted plugin observations materialized in gameplay remain in the backup;
import does not authorize a live integration or reconnect a plugin client.

## Original picker chunks

Only the full `duo-legacy` / `surface-grid-v1` / `rs3` contract supports the
chunk link. The independently written encoder uses `x = floor(id/256) - 29`,
`y = 70 - (id % 256)`, and `index = x + 47*y`, requiring `0 ≤ x < 47` and
`0 ≤ y < 49`. Each index becomes one comma-separated base-62 token using
`0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`. Sections and
unknown/out-of-grid cells are refused; IDs never wrap into another cell.

The button copies the URL and exposes a selectable fallback. Paste it into
the original picker's **Import from URL** yourself. That action replaces its
chunk sets. **Only unlocked chunks carry over**: no selected candidates, tasks,
rules, progress, notes, group semantics or History. Keep the full backup for
returning to this picker. There is no original database import or rule export
in this feature, and no original implementation code is incorporated.

## Import size and count limits

Saved state accepts at most 32 members, 250,000 task definitions, 100,000
records in each member array or dictionary, and 250,000 entries in any other
JSON collection (including archives). Oversized collections fail validation;
records are never truncated. These ceilings allow ample room above the frozen
save fixtures (two-member rosters; the original-sync capture's largest dictionary
has 153 entries) and the reference dataset's 92,638 task-map entries plus its
index counter. No live saves were read to choose these limits.

Transfer reports index definitions and completions once. Restore previews also
index catalogue differences, completion differences and task labels, so a large
save does not rescan the catalogue for every completion. Roster mapping remaps
live gameplay and journal migration guards and retains their original attribution
in `provenance.transferRoster.gameplayMigration`. Cleared migrated fields remain
cleared when the destination prepares or reloads the save.
