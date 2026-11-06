# Export / Import

Open **More → Export / Import**. The existing dialog offers a **Full
picker backup**, **Import a backup**, and **Copy link for the original picker**.
No reference data, artwork, account credentials or service permissions transfer.

Imports use an [isolated worker queue](backup-import.md) with 120 seconds of
active checking and 120 seconds of queue wait per admission, and a 256 MiB
portable JSON limit (257 MiB on the upload wire). Large catalogues and
retained History are supported without count or combined-work caps.

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

Committed automatic plugin replay decisions also travel with the backup.
Restores combine incoming decisions with the destination's decisions, so an
older backup cannot make an undone observation tick again. Portable transfers
map these decisions to the chosen destination players; member restore imports
only the selected source player's decisions. Undo of a member restore retains
these replay decisions too.

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

## Import isolation and reports

The byte ceiling is 256 MiB for portable restore and export documents (257 MiB
on the upload wire). Admission checks the published progress snapshot, hydrated
History and transfer manifest before accepting a replacement. A generated 20,503-task save
with 82,012 registry aliases, 2,000 History entries and a fully hydrated
pre-migration archive is 51,724,708 bytes (49.33 MiB); its JSON request is
51,724,719 bytes. The reviewed 218,103,808-byte upload leaves 48 MiB of portable
metadata headroom below the document ceiling.
No private save was opened for these measurements. Each
import worker exits after checking; timeout or validation failure leaves the
save unchanged. Reports sample the first 100 unresolved records, truncate long
labels, and say how many more remain. Detailed evidence stays in the portable
save. Preview counts cover the complete import even when displayed changes are
sampled. Synthetic coverage includes 20,503 tasks with 2,000 History entries,
restoring onto 501 destination History entries, and an upload above 32 MiB.
Roster labels are limited to 512 display characters. Mapping uses exact player
IDs of 1–80 characters without control characters, with at most 32 players.
Original names and migration diagnostics remain intact in the saved evidence.

Transfer reports index definitions and completions once. Restore previews also
index catalogue differences, completion differences and task labels, so a large
save does not rescan the catalogue for every completion. Roster mapping remaps
live gameplay and journal migration guards and retains their original attribution
in `provenance.transferRoster.gameplayMigration`. Cleared migrated fields remain
cleared when the destination prepares or reloads the save.

Every worker message carries transferable byte buffers. Bounded binary token
batches rebuild the owned in-memory state in short event-loop turns; the HTTP
thread never clones or parses/stringifies a complete imported state. Workers
prepare static dependencies, their hashes, the preceding checkpoint, replacement
file and apply-response bytes. Caller-supplied `prepareState` hooks receive the
same mutable full state and preparation context as ordinary commands, including
migration context and the caller's world and registry. Transferable batches yield
while sending the input and returned state; the worker validates and applies the
return value (or the mutated input when the hook returns nothing). The writer checks the revision
and private checkpoint, publishes dependencies and the retained backup, then
fsyncs/renames the replacement and adopts its immutable state. Preparation hooks
keep their gameplay transformation contract. Commit hooks receive bounded
summaries and digests.

Hook inputs retain the worker's dictionary-key batches and track property
additions, deletions and enumerability changes. Re-encoding an unchanged wide
dictionary therefore starts yielding without first enumerating all its keys.
Immutable state descriptors are installed during hydration, avoiding a final
whole-dictionary freeze pass.

All import display messages cross one shared bounding helper at worker egress:
512 characters per string, 128 per object key, 100 items per collection and
256 KiB per display payload, with depth and node limits. This includes compact
state, restore differences, roster mapping, diagnostics, samples, migration and
transfer reports, publication summaries and apply metadata. Counts describe the
complete save. Exact saved values and portable publication/export bytes remain
unchanged and use the cooperative binary transport.

Preview reserves required fields, every roster entry and exact member/change
counts before optional samples. Samples shrink further when the complete review
would exceed 256 KiB. Apply replies carry the complete authoritative roll pools
(eligible, excluded, accessible and partner connections) alongside the state,
including replies evaluated by custom caller hooks. Only diagnostic metadata
uses the display limits.

The global queue admits four users including the running job, with at most one
import request per user across pickers. A full queue or duplicate returns 503:
“Backup import is busy. Try again in a moment.” Failed jobs release admission.
Member restore merges the applicable remapped migration guards before migration;
the destination's existing guards and guarded Undo chain remain available.

Round-9 synthetic acceptance on Windows / Node 26.13.0 (5 ms heartbeat, hooks enabled,
worker-prepared play response; preview includes upload parsing and hydration):

| Input | Preview | Preview maximum gap | Apply | Apply maximum gap | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 49.33 MiB realistic save | 16,276 ms | 55.6 ms | 51.1 ms | 20.6 ms | 810.5 MiB |
| 208 MiB reviewed upload | 16,832 ms | 49.8 ms | 51.6 ms | 17.4 ms | 2,037.9 MiB |

These runs use a full-state preparation hook that reads the catalogue and
History and writes a note; the applied/exported state retains that note. The
same hook on the existing main-thread preparation path took 2,826 ms with a
1,661.2 ms maximum gap for the realistic save. Cooperative hook transport keeps
the import gap below that baseline without changing the hook's input or output.
The OS lifetime peaks were 867.3 and 2,073.7 MiB respectively. These isolated
process figures include synthetic fixture setup and worker heaps, not a running
production server. The regression targets 100 ms and allows 150 ms for CI
scheduling variance. The real-sized test also exports and compares the complete
saved state, including the hydrated registry and archive. Standalone JSON/gzip
export gaps were 16.7/27.4 ms for the realistic save and 26.1/25.6 ms for the
reviewed upload. A separate HTTP probe measured JSON/gzip export gaps of
22.6/18.5 ms and 21.0/17.2 ms respectively, with ordinary Undo gaps of 150.0
and 125.1 ms. Identity resolution is reused within each play projection and
progress observation, with fresh results for every subsequent operation. HTTP
play projections yield between batches; Undo validation, preparation and progress
observation run in separate turns. The standalone full-state commit-hook Undo
path remains a follow-up; its gaps were 380.0 and 587.1 ms.
The huge-name regression returned a 640-byte mapping response for a 128 MiB
name, with an 18.9 ms gap; its prepared preview response had a 25.5 ms gap.
The generic response regression discovers string sources from the production
preview helpers and worker egress paths, including future fields. With 53
inflated sources and a 32 MiB completion ID, serialization and hashing returned
a 12,705-byte preview with a 28.1 ms maximum main-thread gap (50 ms ceiling).
The separate capacity regression exports an accepted 268,384,330-byte document
with progress snapshots and hydrated destination History. Verification uses
targeted suites and the release rehearsal; no full test suite was run this round.

Round-10's one-million-entry provenance dictionary with a no-op preparation
hook produced a 4,497-byte preview with an 80.3 ms maximum main-thread gap
(strict 100 ms ceiling). The same input on `origin/main` d97334f produced an
8,498.5 ms gap through its main-thread preview path. The 32-member fixture with
100 notes of 600 characters per member retains every roster row and exact count
in a 171,391-byte review. Worker and custom-hook HTTP replies both retain all
200 eligible hand-selected chunks. At 208 MiB, the ordinary HTTP JSON export,
gzip export and Undo gaps were 18.3, 19.3 and 113.0 ms respectively.
