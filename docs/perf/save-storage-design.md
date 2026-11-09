# Save history storage design

Study of `ad0e89817fef99f50df4969ce819876f9d484b79`. Measured on 2026-11-09.
Sections 1-5 describe the unchanged application baseline; section 6 measures
the retention fix. All inputs were synthetic. No real save was opened.

Recommend keeping the file backend. First, remove redundant stored-state
imports from packing and cold archive indexing. Cache validated immutable
dependencies within a pass. Keep every restore point. Archived History already
uses shared segments. Consider sharing the active tail and restore provenance
only after measuring the smaller maintenance fix at nominal catalogue size.
Section 5 measures the nominal capacity shape.

## 1. Current storage and measured costs

### What the code does

`openStore` owns one group directory and one revision queue. A second queue
owns retention and backup reads. Both participate in the snapshot barrier.
See `app/storage/store.mjs:95`, `:1038`, `:873` and
`app/storage/snapshot.mjs:15`. The barrier tracks accepted writes. It is not a
mutex between arbitrary filesystem writers.

| Stored data | When it is written | Source |
| --- | --- | --- |
| `state.json` | Initialization and each accepted gameplay command. Also some same-revision settings, cleanup and observation writes. Contains current gameplay, active History/Undo and private receipt/coordination/currency metadata. | `app/storage/store.mjs:299`, `:1084`, `:1489`, `:1512` |
| `backups/<revision>-<random>.json.gz` | The **preceding** state is retained before every ordinary gameplay publication. Startup progress observation and catalogue refresh can also retain it. A failed commit can leave an additional preimage. This is not a timer-based snapshot policy. | `app/storage/store.mjs:597`, `:965`, `:1001`, `:1095` |
| Pinned preimages and optional label metadata | Whole-save replacement and catalogue refresh pin the preceding save. A members transition makes a full portable, labelled pinned preimage. | `app/storage/store.mjs:603`, `:616`, `:1188` |
| `history/history-*.json.gz` | When active History exceeds twice `historyEntries`, default 1,000. Usually keeps the newest 1,000 events. Pending rolls, the latest Undo and linked Undo markers can require a longer tail. Old events and later overrides are preserved in immutable segments. | `app/storage/store.mjs:75`, `:665`, `:707` |
| `static/static-<sha256>.json.gz` | Changed `tasks`, `identityRegistry`, `legacy` or `provenance` fields at least 256 KiB. A reference replaces the field in disk documents. Unchanged immutable field objects reuse bytes and hashes. Portable exports hydrate them. | `app/storage/store.mjs:74`, `:262`, `:380`, `:394` |
| `backups/archives/archive-*.json.gz` | Retention packs eligible standalone preimages into JSON envelopes. Each batch has at most 32 snapshots or about 8 MiB expanded JSON, except one oversized snapshot. Compression uses best compression. | `app/storage/store.mjs:796`, `:813`, `:849` |
| Other group files | Invitations, access credentials, plugin observations/journals, action acknowledgements and other sidecars have separate lifecycles. They are not one cross-file gameplay transaction. The probe has no plugin input. | `app/storage/store.mjs:133`, `app/storage/invites.mjs`, `app/storage/plugin-currency.mjs`, `docs/save-surface.json` |
| Progress timeline tuples | Daily counters in state, at most 3,660 days. These are not durable restore-point copies. | `app/core/progress-timeline.mjs:66`, `app/core/progress-snapshots.mjs:2` |

Retention keeps all recent standalone copies for 90 days. Beyond that it keeps
the latest standalone copy for each UTC day, plus the first and latest copies.
Pinned copies stay standalone. Other old copies move into archives. **No
restore point expires under this policy.** `backupDays` is a packing threshold,
not a deletion age. See `app/storage/store.mjs:798` and `:853`.

An already packed snapshot is excluded from a new pack at
`app/storage/store.mjs:815`. An unchanged pass does not recompress old packs.
The index is cached only for the lifetime of the open store. A cold index reads,
decompresses and imports every archived snapshot (`:777`). A duplicate left by
an interrupted pass can cause another verification before its standalone copy
is removed (`:830`).

New packing does expensive repeated work. Each candidate is imported before
batching (`:854`), after writing and rereading the pack (`:824`), and again
before unlink (`:842`). History is then hydrated and validated (`:845`, `:703`).
This is three full stored-state imports plus one History validation per newly
packed snapshot. Static dependencies are loaded repeatedly in writable stores.
The static-field read cache is enabled only for read-only stores (`:308-317`).
An imported field is also serialized and hashed again after normalization
(`:368-376`). The History hydration cache is bounded to 8 MiB. Successful
packing removes the standalone file only after these checks. One undecodable
candidate aborts the pass; the error becomes `retention.failure` (`:854`, `:863`).

Retention runs at writable open, every 50 ordinary writes, explicit
`prepareSnapshot`, and close (`app/storage/store.mjs:1020`, `:1120`, `:1434`,
`:1701`). Commands do not await the scheduled packing pass. It still consumes
the same process CPU, I/O and snapshot-barrier work.

`prepareSnapshot` itself creates no restore point. The private operator route
calls it before raw snapshot capture (`app/picker-context.mjs:1513`). This
distinction matters when attributing fixture time.

### Cost model

Let R be roster size. Let H be active History entries, and E their average
encoded size, including inverses. Let G(R) be other mutable gameplay bytes.
Let T be inline catalogue/evidence bytes and C the complete hydrated catalogue.
The hot document has roughly S = G(R) + H*E + T bytes. Large immutable fields
may already be external. Externalizing C saves disk writes, not validation.
Let V(H,R,C) be full validation cost. It includes shape checks, inverses and
reverse replay. Bulk map replacements can have much larger inverses than notes.
There is no measured universal constant per History entry or player.

| Operation | CPU and bytes from the implementation | Sync operations on Linux |
| --- | --- | --- |
| Ordinary command and preimage | Trusted command copies members and the History array. Serialization reuses immutable field and History-prefix encodings. It still assembles/writes S bytes and gzip-compresses the preceding S bytes at best speed. A full-state return also clones hydrated C and provenance; serialized replies differ. | Normally two file syncs plus two parent-directory syncs. One atomic publication per preimage and state. |
| History compaction | Serialize/compress newly archived events, write a segment, then publish the referencing state. Dependency rules can extend H beyond the nominal tail. | One additional file and directory sync per new segment. |
| New static field | Serialize/hash/compress changed large field once. Later documents refer to it. | One additional file and directory sync per new field. |
| New retention batch | Read candidate gzip files. Import each candidate three times and validate hydrated History once. Serialize/compress the pack, reread it twice, compare exact documents, then unlink the standalone copies. Work includes repeated O(C) catalogue hydration/validation as well as History and dependency bytes. | One file and directory sync per pack. Unlinks have no separate directory sync here. |
| Unchanged warm retention | Enumerate/stat remaining standalone files, sort them and select daily tiers. Cached archive index. Normally no payload reads or writes. Pinned non-daily candidates can still be opened and parsed before being skipped. | None. |
| Cold archive index | Read/decompress every pack and import every contained state just to check its revision. Work includes O(N*C) catalogue processing and the archived states' History validation. | None for indexing. Store open separately publishes its lock record. |

Publication uses an exclusive temporary file, file sync, rename, then parent
directory sync. This checkout has stronger directory durability than the old
SC1 description in `docs/storage-contract.md`. Use the current code:
`app/storage/atomic-write.mjs:7`, `app/storage/publication.mjs:5` and `:15`.
Dependencies fail closed on sync errors. After the authoritative state rename,
a directory-sync error can publish the new in-memory state and receipt with a
durability warning (`app/storage/store.mjs:1054`). Windows tolerates specific
unsupported directory-sync errors. This study does not prove power-loss safety.

Public `applyCommand` fully validates/copies its input and validates its result.
Live `store.command` uses `applyValidatedCommand` on owned, validated input.
It copies members, shallow-copies History and validates affected gameplay.
Older or complex Undo can cross the full validation path. See
`app/core/state.mjs:634`, `:649`, `:821`, `:876`, `:1414`, `:1431`, `:2324` and
`app/storage/store.mjs:1146`. Changing fixture code to skip public validation
would affect preliminary growth only. The capacity fixture already uses
`store.command` for all 1,300 durable notes (`scripts/perf/capacity/fixture-group.mjs:39`).
It would not fix that loop or retained snapshot costs.

Before compaction, active-prefix storage and validation can cost sum(H_i).
Archived events are already shared by reference in preimages after compaction
(`app/storage/store.mjs:707-738`). Ordinary disk writes do not contain every
old event. The usual active tail is about 1,000-2,000 events, with exceptions
for pending rolls and Undo. Packing's `hydrateHistory` still materializes and
validates the complete prefix for each point. This repeats full-history work
even when old bytes are already shared. Nominal catalogue work is a separate,
larger term in the follow-up measurements.

Whole-save replacement has another growth path. It hydrates both complete
Histories, folds prior `restore.previousHistory` into the preceding chain, and
stores `incomingHistory`, `previousHistory` and incoming provenance under
`provenance.restore` (`app/storage/store.mjs:1205-1219`). Active-tail compaction
does not trim those arrays. Repeated restores accumulate this evidence. A large
provenance field can leave `state.json` through static storage, but changing it
still serializes, hashes and writes a new field. Any later History redesign
must cover this path and preserve the restore Undo boundary.

### Original 500-task probe and limits

Run `scripts/perf/save-storage-probe.mjs` from this worktree with Node 24.
The measured run used the task's supplied Node 24.20.0 executable. The machine
was Windows on an Intel i7-8700K. The process used BelowNormal priority.
No HTTP server or application test suite was started. Store ownership used
Windows named pipes. Any future server probe must use port 0.

The script accepts no save path. It creates a new ignored
`.local/save-storage-probe-<time>-<random>` directory and leaves its results
there. It clears inherited `RS3_*` configuration before app imports and selects
the public `open-starter` provider. The injected world has synthetic data only.
It instruments selected functions in memory. It does not edit application files.

| Synthetic size | Players | History before measured writes | Seeded restore points | Tasks | Chunks unlocked/player |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 1 | 12 | 12 | 500 | 32 |
| Typical, chosen for this probe | 3 | 200 | 60 | 500 | 32 |
| Grown | 5 | 1,000 | 300 | 500 | 32 |

Inputs use real note commands and inverses. The script directly seeds valid
preimage envelopes with the same best-speed gzip and atomic writer. This avoids
replaying hundreds of disk commits just to measure one retention pass. It then
measures three real `store.command` calls at each size. Seeded preimages are
12 hours apart. The first pass uses the end of that timeline. The next advances
the synthetic clock by 400 days. Daily/first/latest rules remain enabled.
The grown timeline already spans 150 days, so its first pass packs some copies.

This is a bounded storage probe, not the capacity fixture or a target-server
benchmark. It has no large identity/migration fields, plugin journals or History
compaction. Roster and History grow together, so the table does not isolate
their individual coefficients. Source inspection supplies the cost model above.
The owner-reported Linux fixture result remains external evidence:

| Reported capacity evidence, not rerun here | Value |
| --- | ---: |
| Fixture groups | 500 |
| History commands plus additional snapshot commands per grown group | About 1,000 + 300 |
| Retained copies seen per grown group | About 1,300 |
| Reported CPU setup cost | About 25 minutes/grown group; about 12 hours total |

The additional 300 commands also create History and preimages. They do not
replace the first 1,000 copies. See `scripts/perf/capacity/fixture-group.mjs:37`
and the explicit caveat in `scripts/perf/capacity/model.mjs:63`.

The probe records inclusive wall and process CPU times. Nested rows must not be
added to their parents. Windows CPU accounting is coarse for short calls. A
zero CPU sample does not mean zero work. Shared-machine scheduling and GC make
short wall timings noisy. Instrumentation adds promise and timing overhead.
These are five core samples after warm-up and three
durable samples, not latency percentiles.

| Mean milliseconds | Small | Typical | Grown |
| --- | ---: | ---: | ---: |
| Public `applyCommand`, wall / CPU | 11.43 / 9.60 | 29.83 / 25.00 | 111.57 / 53.20 |
| Trusted `applyValidatedCommand`, wall / CPU | 0.34 / 0.00 | 1.05 / 0.00 | 1.85 / 3.20 |
| Full `validateState`, wall / CPU | 2.92 / 6.20 | 16.99 / 12.60 | 48.14 / 43.80 |
| Durable command including preimage and returned state clone, wall / CPU | 151.79 / 20.67 | 99.59 / 57.33 | 128.75 / 62.67 |
| Preimage path, inclusive wall | 70.09 | 38.47 | 36.37 |
| Preimage gzip, within that path, wall | 6.12 | 8.43 | 5.56 |
| Disk-state serialization, wall | 14.08 | 0.33 | 1.82 |
| Both temporary-file writes, wall | 9.51 | 2.71 | 3.44 |
| File and directory sync attempts, wall | 15.96 | 6.76 | 3.74 |
| Bytes written per durable command | 47,219 | 128,570 | 469,071 |

Each command made two file writes, two renames and four sync attempts. Two
file syncs succeeded. Two Windows directory syncs returned tolerated `EPERM`.
The remaining command time includes sidecar checks, preparation, publication,
other filesystem waits and response cloning. It was not separately attributed.
The small case's large serialization sample shows why these timings should not
be used as a server latency forecast.

| Retention measurement | Small | Typical | Grown |
| --- | ---: | ---: | ---: |
| First pass wall ms | 18.50 | 9.08 | 16,077.59 |
| First pass newly packed copies | 0 | 0 | 59 |
| Aged pass wall / CPU ms | 422.94 / 313 | 3,007.40 / 2,843 | 17,325.88 / 15,453 |
| Aged pass newly packed copies | 7 | 31 | 92 |
| Aged pass import calls | 21 | 93 | 276 |
| Aged pass stored-state imports, wall ms | 171.26 | 1,589.87 | 9,787.13 |
| Aged pass History hydration, wall ms | 22.14 | 443.27 | 2,623.16 |
| Aged pass gzip / gunzip, wall ms | 11.39 / 39.28 | 123.95 / 260.80 | 730.44 / 1,172.47 |
| Aged pass enumeration/stat, wall ms | 29.97 | 14.13 | 40.20 |
| Aged pass pack sync attempts, wall ms | 2.21 | 4.91 | 7.72 |
| Aged pass new packs / bytes written | 1 / 23,912 | 1 / 246,737 | 5 / 2,316,510 |
| Aged pass sync attempts / successful file syncs | 2 / 1 | 2 / 1 | 10 / 5 |
| Aged pass wall ms per newly packed copy | 60.42 | 97.01 | 188.32 |
| Unchanged warm pass wall ms | 2.63 | 2.58 | 12.58 |
| Unchanged warm pass payload bytes read / written | 0 / 0 | 0 / 0 | 0 / 0 |
| Cold writable open wall ms | 387.27 | 774.25 | 4,319.68 |
| Cold archive-index wall ms, within open | 268.84 | 678.37 | 4,264.64 |

Across both grown packing passes, 151 copies took 33.40 seconds wall and 26.03
seconds process CPU. Of the wall time, stored-state imports took 17.65 seconds,
History hydration 4.63 seconds, gzip 1.49 seconds and gunzip 3.60 seconds.
Other work includes JSON parsing/string comparison and unlink. Existing pack
hashes stayed identical after the later pass. All packs stayed identical after
the unchanged pass. This result supports reducing redundant imports and replay.
It does not establish History as the dominant cost at nominal catalogue shape,
or show that every pass repacks all old archives.

Sizes below are actual file lengths after the aged pass. They exclude allocation
rounding and the transient owner record. The probe writes no feedback, registry,
dataset pack, plugin data or service backup. Those costs are additional.

| Bytes and files per group | Small | Typical | Grown |
| --- | ---: | ---: | ---: |
| `state.json`, including three new events | 43,665 | 118,452 | 435,719 |
| Standalone preimages, bytes / files | 29,339 / 8 | 302,492 / 32 | 4,429,432 / 152 |
| Archive packs, bytes / files | 23,912 / 1 | 246,737 / 1 | 3,600,155 / 8 |
| Access token, bytes | 44 | 44 | 44 |
| Total before packing, bytes | 99,346 | 715,822 | 9,274,386 |
| Total after packing, bytes | 96,960 | 667,725 | 8,465,350 |
| Logical restore points after packing | 15 | 63 | 303 |
| Portable current backup, bytes | 43,664 | 118,451 | 435,718 |

Packing saved only about 9% of the grown group in this layout. Daily copies
remain standalone and archives still contain full snapshot documents. This is
not the size of a 1,300-copy capacity group. Multiplying identical grown probe
directories gives the following arithmetic, not a population forecast:

| Storage scenario | 500 groups | 1,000 groups |
| --- | ---: | ---: |
| One current copy of the measured grown layout | 4.23 GB | 8.47 GB |
| Thirty complete undeduplicated copies of that layout | 126.98 GB | 253.96 GB |

Raw results are kept locally in
`.local/save-storage-probe-1794199851973-4b649e70/results.json`. The script can
reproduce the experiment without that artifact. Its assertions check retained
counts, portable History, reading a historical restore point, cold reopening,
retention failures and unchanged pack hashes. A separate focused check also
read a packed restore point and its full History at each size. Existing
contract tests below were inspected, not run. No full suite was run.

## 2. Contracts to preserve

| Named contract | Required behavior | Implementation and existing tests |
| --- | --- | --- |
| History is complete | Paging, filters, actor labels and on-demand details span archives. Latest projections override older copies. Restore preserves the preceding chain for History. Do not truncate old events to meet a storage budget. | `app/storage/store.mjs:665`, `:1272`, `:1333`; `tests/history-pagination-storage.test.mjs:23`, `:87`, `:103` |
| Undo keeps its meaning | Latest reversible action remains undoable. Guarded older personal Undo preserves independent later edits and rejects overlapping edits. Undo records its own new revision and marks its target. Archived Undo works after restart. A whole-save restore creates an Undo boundary. | `app/core/state.mjs:1330`, `:2256`; `tests/undo-safety.test.mjs:19`, `:82`; `tests/storage-reliability.test.mjs:180`; `tests/backup-import-server.test.mjs:349` |
| Every retained restore point survives | Preimages retain exact prior gameplay. Preserve IDs, revisions, timestamps, pinned labels, daily tiers and all packed points. A 90-day threshold must not become expiration. Corruption must not cause removal of the sole good copy. | `app/storage/store.mjs:597`, `:796`, `:1451`; `tests/storage-reliability.test.mjs:275`, `:308`; `tests/storage-static.test.mjs:249`, `:297` |
| Publication is ordered and crash safe | Durably publish dependencies before state can reference them. Acknowledge committed state with its receipt. Preserve pre-rename refusal and post-rename warning/adoption behavior. Interrupted archives may leave duplicates, never lost sole copies. | `app/storage/atomic-write.mjs:7`, `app/storage/store.mjs:1054`; `tests/storage-publication.test.mjs:23`; `tests/storage-durability.test.mjs:162`, `:208`, `:255`; `tests/storage-reliability.test.mjs:203`, `:347` |
| Exactly one writer owns a group | Preserve canonical-path kernel ownership plus the owner file, conservative stale-owner recovery, revision conflicts and queue draining before unlock. | `app/storage/process-guard.mjs:7`, `app/storage/store-lock.mjs:69`, `app/storage/store.mjs:1030`; `tests/storage-reliability.test.mjs:35`, `:110`, `:121` |
| Portable saves stay schema 1 | Export full History and referenced static data. Keep dataset identity, roster mappings and registered optional plugin evidence. Import remains validated and revision/permission checked. Imported private receipt ledgers must not replace the destination ledger. Accept existing JSON, gzip and supported completion-encoded inputs. | `app/core/state.mjs:949`, `app/save-transfer.mjs:26`, `app/storage/store.mjs:1435`; `tests/storage-static.test.mjs:32`; `tests/backup-import-server.test.mjs:23`, `:236`, `:262`, `:282`; `tests/restore-picker.test.mjs:62`, `:91`; `docs/save-schema.md:3` |
| Server exports remain recoverable | `/api/backup` and retained-backup downloads must materialize portable saves. The server export path must not leak credentials. Raw operator snapshots and sanitized multiplayer service backups must include every new storage dependency and bind the correct dataset. | `app/picker-context.mjs:1454`, `:1473`, `:1513`; `scripts/linux/service-checkpoint.mjs:12`, `:76`, `:109`, `:227`; `tests/online-snapshot.test.mjs:31`, `:74`; `tests/linux-multi-picker.test.mjs:111`, `:123`, `:574` |
| Snapshot barriers protect a complete cut | Drain accepted writes before capture. Respect the file/deadline/free-space limits. Linux raw capture pins immutable file descriptors before copying outside the hold. A mutable log needs a different capture protocol. | `app/storage/snapshot.mjs:38`, `:43`, `:135`; `tests/online-snapshot.test.mjs:61`, `:142`; `tests/linux-multi-picker.test.mjs:81`, `:156`, `:165` |
| Plugin wire format stays unchanged | Preserve existing reports, sequencing, durable acknowledgement and replay suppression. Plugin observations are not all gameplay commands. Retain decisions through Undo and restore. Storage internals must not add a client protocol requirement. | `docs/plugin-api.md:321`, `:435`; `tests/game-plugin-routes.test.mjs:210`, `:294`; `tests/game-plugin-achievements.test.mjs:231`; `tests/game-plugin-items.test.mjs:37`; `tests/plugin-suppression-publication.test.mjs:46` |
| Old saves and rollback remain explicit | Dual-read existing inline state, history archives, static references and old packs. Migration preserves originals until the new representation is verified. Update the save-surface manifest, service export allowlist and actual frozen-reader evidence. Schema-1 portable compatibility alone does not prove old binaries can open new private files. | `docs/save-schema.md:3`, `docs/save-surface.json`; `tests/save-surface.test.mjs:11`, `:60`; `tests/storage-owned-load.test.mjs:142`, `:228`; `tests/frozen-release-rollback.test.mjs:14` |

These tests cover synthetic failures, process interruption and recovery. They
are not a filesystem power-loss proof. The older storage-contract document is
useful inventory, but its START line numbers and durability claims are dated.

## 3. Concrete options

All options stay behind `openStore` and its existing command, History, backup
and restore methods. Callers keep supplying an expected revision. Successful
calls publish one committed result; conflicts and frozen/closing refusals keep
their meaning. No generic backend abstraction is needed for this study.
For example, `store.command(note, revision)`, `store.readBackup(id)` and
`store.exportBackup(...)` retain their current caller contracts in every option.
Filesystem ownership, codecs and export materialization belong inside storage.
There is no remote storage dependency in these designs.

For estimates, let D be newly committed event/inverse bytes, K a checkpoint
interval, N retained restore points, and M newly eligible points. H_total is
all History, including archived events. Numbers below are **planning guesses**.
No redesigned backend was implemented or benchmarked. Disk formulas are more
reliable than numeric speed guesses.

### A. Cheaper maintenance, then optional active-tail sharing

Keep atomic file publication. First, stop using repeated semantic imports as
physical-copy verification. Use shallow archive metadata for listing. Verify
new pack bytes and all required dependencies before unlinking a source. Cache
static-field hydration/validation by content hash within the pass. Untrusted
or unqualified legacy data still needs semantic validation. Portable imports
and actual restores keep their validation boundary.
Cache keys must include schema, rules and roster context where checks depend
on them. Per-state member/task references still need validation.

This first step changes no gameplay or portable save format. A persistent,
rebuildable metadata index can follow separately if shallow pack reads remain
too costly. It must never authorize deletion without verifying the pack.

If needed next, each new restore point records gameplay plus a reference to an
immutable History prefix. Existing archived segments already provide part of
this sharing. Extend it to the active tail and restore-provenance Histories.
Keep later Undo projections as versioned committed records; a historical root
must not pick up a future Undo override. Preserve same-revision backup IDs.
Reference unchanged catalogue and evidence fields as storage already does for
large fields. A persistent index records restore-point metadata, blob hashes,
dependency hashes and segment ranges. It is a rebuildable cache, not the
authority for gameplay or deletion.

Retention moves only newly eligible immutable objects. Seal new packs once.
Verify byte identity and referenced dependencies before removing any source.
Validate semantics at the original command/import boundary. Do not replay the
same entire History for every physical copy. Untrusted legacy files still need
one full validation before they enter the new index. A missing or inconsistent
index triggers a bounded rebuild. Hashes are not permission to accept an
unvalidated imported save. Corrupt/missing dependencies still fail closed.

Keep an ordered, persistent prefix index. Copying a growing list of all prior
segment IDs into every snapshot would recreate quadratic metadata growth.
History and restore readers follow the prefix through the requested revision.
Random notes and exact inverse/actor data remain available for export and Undo.

| A estimate | Expected cost |
| --- | --- |
| Per action, maintenance step | Same S-byte state and preimage publication as today. No new foreground format or sync. Maintenance CPU falls; foreground catalogue response cloning remains. |
| Per action, optional sharing step | Roughly compressed gameplay plus D and a small root record per preimage. Current disk state may also reference the tail. File syncs remain ordered; new segment/index roots add publication syncs. |
| Retention pass | O(M metadata + newly sealed bytes + unique dependency checks), after qualifying legacy data. No repeated semantic replay for byte-identical copies. Shallow cold indexing still parses pack payloads; a persistent metadata index removes that dependency. |
| Disk | Maintenance alone leaves size essentially unchanged. Optional sharing removes repeated active-tail and restore-provenance copies. Archived History and large static fields are already shared. Gameplay copies remain. |
| Original 500-task layout guess after sharing | About 1-3 MiB/group, versus measured 8.07 MiB now. This is an untested optimistic range, not a nominal-catalogue forecast. At 500/1,000 identical probe groups, about 0.52-1.57 / 1.05-3.15 GB. |
| Scale implication | Per-write cost does not include all retained restore points. At an assumed 20 actual saves/second, a 5 ms CPU budget for maintenance amortized per save would use 0.1 CPU core. This is a proposed acceptance budget, not a prediction. |
| Migration and rollback | Keep reading old packs. Convert lazily into new immutable objects under the group lock. Journal progress; verify every logical restore point and portable export before releasing its old copy. Preserve originals through rollout. Before downgrade, materialize legacy storage with the new reader and verify it with the frozen binary. |
| Risk / work guess | Maintenance: small, roughly 3-5 developer days, with corruption/dependency checks. Optional sharing: medium, another 3-5 developer weeks. Versioned Undo, restore provenance, export allowlists and interrupted migration are the hard parts. |

The maintenance step removes redundant catalogue and complete-History replay
from copy verification. The optional format step reduces repeated active-tail
bytes. It does not introduce archived-History sharing for the first time.
Neither step promises a constant-size gameplay state or free portable exports.

### B. Append-only committed transitions with periodic checkpoints

Replace per-action state/preimage rewrites with framed committed transitions.
Record resolved effects, exact History/inverse data, actor, revision, receipt
and relevant private replay decisions together. Do not replay raw commands
against later rules, fresh randomness, a new clock or external APIs.
Checkpoint current gameplay periodically. Every prior revision remains a
logical restore point through a checkpoint plus transitions.

Use a checksummed length-delimited transaction format. Ignore only a torn
unacknowledged tail. Sync before acknowledgement. Publish checkpoint and index
roots before retiring a covered log segment. Keep the existing group lock.
Rotate or pin a committed byte-length under the snapshot barrier. The current
raw descriptor-copy assumption is unsafe for an actively appended file.

| B estimate | Expected cost |
| --- | --- |
| Per action | O(D) append and one log sync in the normal case. Checkpoint work amortizes to O(G/K). Large bulk actions still write their large effects/inverses. |
| Retention pass | O(newly sealed segments + M restore metadata). No old snapshot packing. Checkpoint creation costs O(G); indexed restore replays at most K transitions when checkpoints cover the requested period. |
| Disk | H_total effects/inverses + checkpoints + restore index. No N copies of History. With K=100, the probe is plausibly 0.5-1.5 MiB/group; this is unmeasured. At 500/1,000 identical groups, about 0.26-0.79 / 0.52-1.57 GB. |
| Scale implication | At 20 saves/second and a guessed 1 KiB durable frame, about 20 KiB/second plus checkpoints. There are still 20 durability waits/second without group commit. Plugin polls do not imply 20 or 120 durable saves/second. |
| Migration and rollback | Import the existing current state as a validated checkpoint. Preserve old retained backups through the legacy reader. Record new transitions only after atomic activation of the new root. Legacy history is evidence, not a promise that every old command can be replayed under current rules. Downgrade requires offline materialization. |
| Risk / work guess | High. Exactly-once receipts, restore boundaries, versioned replay, snapshot capture and exporter changes all affect crash recovery. About 6-10 developer weeks. |

### C. Content-addressed gameplay blocks and History roots

Store immutable, hashed blocks for member data, note pages, catalogue chunks,
History segments and private metadata. A restore point is a root hash. New
commands create only changed blocks and a new root. Roots include the receipt
and replay state needed for publication. Use small map pages; hashing one whole
member after a note edit would still copy all that member's accumulated notes.

| C estimate | Expected cost |
| --- | --- |
| Per action | O(changed blocks + D + changed index paths), plus ordered file/root syncs. A bulk member replacement remains proportional to that member. |
| Retention pass | O(new roots/blocks), with periodic reachable-block checks. Every retained root remains a GC root. Keeping every restore point means changed old facts cannot simply be collected. |
| Disk | Unique compressed blocks + History + roots. Probe guess 0.5-2 MiB/group. At 500/1,000 identical groups, about 0.26-1.05 / 0.52-2.10 GB. Chunk size and metadata could erase much of that saving. |
| Scale implication | A guessed 2-8 KiB changed-block write at 20 saves/second is 40-160 KiB/second before packing/checkpoints. Many small-file syncs may dominate unless blocks are safely batched. No latency prediction is available. |
| Migration and rollback | Build blocks from validated existing states and each old restore point. Publish the new root only after all dependencies are durable. Keep old readers and source copies until equivalence checks pass. Export recursively materializes schema-1 saves; downgrade also needs materialization. |
| Risk / work guess | Highest. Root corruption, reachability/GC errors and file-count growth become new failure modes. Cross-group dedup also couples group deletion and backup ownership. Start with per-group blocks if tried. About 8-12 developer weeks. |

## 4. Recommendation and independently shippable stages

Choose A, starting with its small maintenance step. It keeps the existing
ownership and atomic-publication model and targets the nominal catalogue cost.
B offers the best eventual write cost. Its log transaction and capture protocol
are a larger recovery change.
C adds block and GC complexity before this workload has justified it.

The first stage does not need a new History format. Existing packs already
stay immutable, and archived History already shares segments. Remove repeated
imports, catalogue validation and full-history replay from maintenance first.
A scheduling-only change leaves that work outstanding. Keep all restore points;
expiry would change the contract and is outside this recommendation.

| Stage | Shippable result | Acceptance evidence before enabling it |
| --- | --- | --- |
| 1. Remove redundant maintenance imports | Build a shallow archive index. Verify synced/reread pack records with exact bytes or recorded hashes plus format/ID/revision and dependency checks. Avoid three imports and a full-history replay for every new physical copy. Qualify untrusted/legacy states once; cache immutable static validation within a pass. Keep the existing writer and formats. | Rerun section 5 at nominal shape and a bounded Linux fixture. Corrupt/truncated packs, bad revisions, missing/corrupt static or History dependencies and interrupted writes must preserve the source. Every point still restores/exports through validated readers. Unchanged passes preserve pack hashes. Cold listing must not semantically import each point. Existing retention/static/durability tests remain gates. |
| 2. Measure, then share active History and restore provenance if needed | Reuse existing archived segments. Add roots for the active tail and `restore.incomingHistory`/`previousHistory`, including accumulated provenance. Version later Undo projections by the historical view. Preserve same-revision backup IDs. Start new-format writes with dual readers; keep schema-1 portable output. A persistent metadata index is a separately testable substep if shallow cold scans still hurt. | Compare every logical restore point and full portable History/Undo to the old writer. Include chained restores, selected Undo, pending rolls, compaction, same-revision writes and frozen-reader materialization. Hold gameplay fixed while growing total History and restore chains. Fault every dependency/root/state boundary. Test server export and service restore with the new dependency inventory. |
| 3. Convert old storage incrementally | Convert one group in bounded resumable batches. Keep original files until inventory, portable export and per-restore-point digests agree. Export tools support mixed old/new storage throughout. Publish progress and bytes so an operator can pause between batches. | Interrupt every conversion boundary and reopen. Missing index rebuilds safely. Compare retained IDs/times/labels and event/Undo meaning, not just counts. Service backup/restore works halfway through conversion. Disk reserve covers old and new copies together. |
| 4. Re-measure before choosing a transition log | Only pursue B if hot gameplay writes, fsyncs or backup volume still miss budgets after the smaller steps. Check full-state command-return cloning separately; it is visible in the fixture. | Separate browser requests, plugin polls and actual durable writes. Measure command CPU, event-loop delay, retention backlog, cold opens, export latency and backup/restore size on Linux. Use the intended roster mix for about 2,000 players and 500-1,000 groups. Concurrency and overlapping backups remain unmeasured here. |

Proposed performance gates are guesses until tested on the Linux server class:

| Gate | Proposed threshold or invariant |
| --- | --- |
| Unchanged warm retention | No old payload decompression, semantic replay, recompression or writes. Metadata enumeration may remain until the index is authoritative for scheduling. |
| New retention work | CPU and bytes scale with newly sealed bytes and unique dependencies. No sum of every retained History prefix on each pass or cold open. |
| Amortized retention CPU | Aim below 5 ms per actual durable action on the target dataset. Report backlog and errors independently of command success. |
| Storage growth after optional sharing | With fixed gameplay size, new events and restore roots grow linearly. Document active-tail, restore-provenance, changed-gameplay and Undo payloads separately. Maintenance alone does not reduce retained bytes. |
| Durability and compatibility | No acknowledged loss, missing restore point or weaker dependency check. Same plugin wire format and schema-1 portable exports. Explicit downgrade proof for private storage. |

The server can have many dormant groups. Their history should cost disk and
explicit restore/export work, without forcing repeated semantic replay whenever
a picker is opened or retention runs. That is the first storage change to ship.

## 5. Attribution at nominal catalogue shape

### Method and fixture parity

The original probe cannot attribute the reported Linux fixture time. Its small
catalogue misses repeated hydration and validation of the nominal task field.
The follow-up uses `scripts/perf/save-storage-attribution.mjs`. It changes only
in-memory module loading and records nested spans plus exclusive CPU categories.
Application source files stay unchanged.

Use the supplied Node 24.20.0 executable from this worktree:

```text
node scripts/perf/save-storage-attribution.mjs --catalogue-shape nominal
node scripts/perf/save-storage-fixture-model.mjs .local/save-storage-attribution-<run>/results.json
```

`--catalogue-shape smoke` selects a small check. `--history-points` and `--copies`
bound the work. `--control` disables module, JSON, clone and filesystem probes.
There is no input-save option. Every run creates a fresh synthetic directory.
The process sets BelowNormal priority and uses one worker. No server starts.
An 18-minute deadline terminates a probe that overruns. The final nominal run
finished in about 127 seconds. The full fixture would exceed 20 minutes here,
so its command and packing counts were reduced and then extrapolated.

The probe uses the capacity harness's `catalogue`, `createTaskEngine` projection,
`planFixture` and `growthCommands`. See `scripts/perf/capacity/fixture.mjs:29`,
`scripts/perf/capacity/fixture-group.mjs:18` and `:30-47`, and
`scripts/perf/capacity/profiles/nominal.json:6-7`. A worker matches the fixture's
local replacement path. It performs the actual pinned replacement first.
It then generates anchor states in memory through the trusted command path.
The last 300 notes restart their chunk sequence, as the fixture does.

| Shape or sampling choice | Value |
| --- | ---: |
| Players in the nominal grown group | 4 |
| Chunks / unlocked chunks per member | 4,096 / 2,048 |
| Synthetic task definitions / dependency depth / cross-links | 200,000 / 16 / 8 |
| Actual saved task rows, including engine defaults and 12 growth tasks | 200,079 |
| Expanded saved task JSON / compressed shared task field | 18,986,921 / 1,049,076 bytes |
| Completed durable notes at anchors | 0, 560, 1,120, 1,300 |
| Active History entries at those anchors | 1, 561, 1,121, 1,301 |
| Actual durable commands per anchor | 6 |
| Newly packed points / new packs per anchor | 2 / 1 |

Each anchor opens a new store, performs six actual `store.command` calls with
12-hour clock steps, and ages the clock by 400 days. Daily/first/latest rules
then select two points for packing. The probe checks a repeat pass and a cold
writable reopen. Here, cold means a new store and empty archive/static caches;
the OS file cache remains warm. This measures marginal packing and indexing,
not a complete 1,301-point directory. No History segment compaction fires at
these active-tail lengths. Restore provenance from the initial growth remains.
Anchor counts are before the six measured writes. Cold open sees six additional
History entries.

### Measured command, packing and open costs

CPU is process CPU, including zlib and GC threads. It can exceed wall time.
Windows accounting is coarse for short spans. Async gzip/gunzip spans can
include GC CPU while awaiting the codec. Their CPU is not isolated codec CPU.
JSON and catalogue probes add overhead. Parallel metadata stats also make
nested wall spans unsuitable for additive accounting. CPU categories conserve
the total; they are an operational attribution, not a sampling-profiler trace.

| Milliseconds, CPU / wall | 0 notes | 560 notes | 1,120 notes | 1,300 notes |
| --- | ---: | ---: | ---: | ---: |
| Mean durable command, including returned state clone | 534 / 646 | 451 / 483 | 563 / 550 | 417 / 406 |
| Packing per newly packed point | 6,227 / 6,112 | 5,859 / 4,714 | 7,438 / 6,679 | 5,071 / 4,164 |
| Whole cold writable open, two archived points | 4,922 / 3,844 | 4,563 / 3,883 | 5,406 / 4,431 | 4,156 / 3,299 |
| Archive-index portion per archived point | 1,711 / 1,267 | 1,625 / 1,185 | 1,805 / 1,511 | 1,539 / 1,134 |
| Unchanged warm pass, wall only | 3.82 | 1.70 | 0.82 | 0.80 |

The samples are noisy and do not increase monotonically with History. A control
at 560 notes, with instrumentation disabled, took 14,374 CPU ms for two packed
points and 5,672 CPU ms for cold open. The instrumented equivalents above are
11,718 and 4,563 CPU ms. Separate runs cannot establish a precise probe-overhead
percentage. They do show that the multi-second packing/import cost survives
without instrumentation.

At 1,120 notes, one measured durable command took 548 CPU ms and 617.82 wall ms.
Its returned-state `structuredClone` took 391 CPU ms and 405.15 wall ms. It wrote
735,796 bytes through two file writes and two renames, with four sync attempts.
The six-command mean clone cost was 456.5 CPU ms. No full catalogue validation
or static-field hydration occurred in those ordinary notes. The returned clone
still includes the large catalogue. This is the fixture's `store.command` API;
the live server's serialized response path has different return work
(`app/storage/store.mjs:1128-1130`). Do not project that clone cost onto every
live command.

Packing two points made six stored-state imports, six task-field loads and two
`hydrateHistory` calls. It read 6,625,816 bytes, wrote a 97,276-byte pack, made
two sync attempts and unlinked two standalone files. Cold open imported the
current state plus both archived points. It read 3,912,533 bytes and wrote the
180-byte owner record. Disk measurements describe API calls and bytes, not
uncached device traffic. After the six commands, `state.json` was 667,985 bytes
at the 1,120 anchor and 739,445 bytes at the 1,300 anchor. These small-window
directories are not measurements of full nominal fixture disk usage.
Each packed point decompresses/parses about 57 MB of task JSON across its three
imports. Across 560 points that is about 31.9 GB of expanded task JSON, although
the shared compressed field occupies only about 1 MB on disk.

The next table partitions CPU at the 1,120-note anchor. Rows are exclusive and
add to the total. Catalogue work includes JSON shape checks, task row validation
and catalogue maps/sets, including those built inside History replay. History
checks exclude that catalogue work and separately timed JSON/clone operations.
Static self work includes field checksums and post-validation normalization
hashing; its JSON, gunzip and disk costs appear in their own rows.

| Exclusive CPU milliseconds | Packing per point | Whole cold open |
| --- | ---: | ---: |
| Task-catalogue validation and indexes | 3,507.5 | 2,157 |
| Static hydration/normalization self work | 491.0 | 609 |
| History validation and replay self work | 1,641.0 | 1,045 |
| Other state validation, including inside `hydrateHistory` | 110.0 | 16 |
| JSON parse | 358.5 | 407 |
| JSON stringify | 469.0 | 329 |
| JSON equality self work, excluding its stringifies | 0 | 0 |
| Gunzip spans | 758.0 | 749 |
| Gzip spans | 8.0 | 0 |
| Structured clone | 63.0 | 47 |
| Filesystem calls | 31.5 | 31 |
| History assembly and remaining work | 0 | 16 |
| Total | 7,437.5 | 5,406 |

Zero CPU means below accounting resolution. For example, pack comparison still
took 8.90 wall ms per point, including its stringifies. The following nested
table locates the import work. **Do not add nested rows to their parent.**
The cold-open column covers three imports; packing covers three per point.

| Inclusive path, CPU / wall ms | Packing per point | Whole cold open |
| --- | ---: | ---: |
| Stored-state import | 5,539.0 / 5,121.7 | 5,343 / 4,381.5 |
| Static-field hydration within import, including read/gunzip/parse/hash | 1,398.5 / 895.8 | 1,624 / 754.3 |
| Post-validation static normalization/hash within import | 367.0 / 423.8 | 329 / 360.5 |
| Catalogue checks/indexes within import, exclusive of other work | 2,328.5 / 2,466.6 | 2,157 / 2,143.6 |
| History checks within import, exclusive of catalogue/JSON/clone | 1,194.5 / 893.1 | 1,045 / 764.8 |
| Other validation within import | 102.0 / 42.3 | 16 / 17.4 |
| Additional `hydrateHistory`, outside the imports | 1,835.5 / 1,480.5 | No call |

Of that additional `hydrateHistory` CPU per point, catalogue processing took
1,179 ms, History checks 446.5 ms, JSON 202 ms and other validation 8 ms.
Thus a span called History hydration is not a measure of History-only work.

The repeated paths are visible at `app/storage/store.mjs:354-376`, `:777-791`
and `:824`, `:842`, `:845`, `:854`. Static bytes are checksum-verified at
`app/storage/static-field.mjs:15-29`. Catalogue traversal/index construction is
at `app/core/state.mjs:604-632`, `:683-687`, `:778` and `:878-879`.
Other History validation is at `:767-910`. JSON costs also include restored
provenance and gameplay. The probe does not assign every JSON byte to tasks.

### Applying the samples to one fixture build

`save-storage-fixture-model.mjs` models the actual timestamps and retention
selection. It interpolates the six-command means and packing CPU per point
between anchors. Packing uses each preimage's completed-note count, not its age
at the later pass. It also checks that delaying all packing to the final pass
selects the same points. It does not execute the full fixture.

| Timeline result | Count or time |
| --- | ---: |
| Growth ticks / expected ticks in the fixture clock formula | 8,218 / 9,517 |
| Replacement preimage clock | 2024-12-20 12:00 UTC |
| Final clock | 2026-10-01 12:00 UTC |
| Pinned replacement plus durable-note preimages | 1 + 1,300 = 1,301 |
| Newly packed points / remaining standalone points | 560 / 741 |
| Packed preimages' completed-note positions | 0, 2, ..., 1,118 |
| Scheduled selection passes plus final explicit pass | 26 + 1 |
| First packing pass | Note 199, packing 9 points |
| Modeled standalone stat visits in those passes | 12,319 |

The replacement increments the 50-write maintenance counter. Selection passes
therefore occur after notes 49, 99, and so on. Close adds an unchanged pass.
Background scheduling can change intermediate scan counts and pack batches.
The model uses two-point measured batches; normal batches allow 32 points or
about 8 MiB. Larger batches amortize codec/pack overhead. Repeated per-point
imports remain. These are limits on the extrapolation.

| Fixture operation, interpolated PC CPU | Minutes | Share |
| --- | ---: | ---: |
| 1,300 durable commands | 10.79 | 15.4% |
| Packing 560 distinct points once | 59.22 | 84.3% |
| Preliminary growth, initial open and pinned replacement | 0.25 | 0.4% |
| Total | 70.26 | 100% |

| Exclusive cost across that estimate | CPU minutes | Share |
| --- | ---: | ---: |
| Task-catalogue validation and indexes | 30.54 | 43.5% |
| Static hydration/normalization self work | 4.63 | 6.6% |
| History checks/replay self work | 7.49 | 10.7% |
| Other validation, including inside History hydration | 0.37 | 0.5% |
| JSON parse/stringify/compare | 8.55 | 12.2% |
| Gunzip spans | 7.71 | 11.0% |
| Gzip spans | 0.19 | 0.3% |
| Structured clone, mostly the command return | 9.36 | 13.3% |
| Filesystem calls | 0.84 | 1.2% |
| History assembly and remaining work | 0.58 | 0.8% |
| Total | 70.26 | 100% |

Cold opens are excluded: `fixture-group.mjs` never cold-reopens the group.
The combined catalogue generation/engine/world setup took 25.77 CPU seconds.
Catalogue generation and engine compilation are shared setup; only world
construction belongs to each group. That combined phase is excluded rather
than charged to every group. Catalogue-array preparation, registry/key setup,
final state digests and metadata-only pass overhead are also excluded.
Those omissions, batch size, GC and scheduling prevent an exact full-build
prediction. Initial public-command growth took 0.87 CPU seconds. It cannot explain tens of
CPU-minutes in this run.

The PC estimate exceeds the reported 25 CPU-minutes by about 2.8 times.
Replacing interpolation with sampled minimum/maximum costs gives roughly
55-86 CPU-minutes. This is a sensitivity envelope, not a confidence interval.
The measurement supplies enough repeated work to explain tens of CPU-minutes;
it does **not** reproduce the Linux result or establish its exact percentages.
There is no same-hardware Linux calibration. Do not invent a correction factor
to force the result to 25 minutes.

The largest measured cost is catalogue validation and index construction,
amplified by repeated stored-state imports. Static reread/gunzip/parse/hash work
adds to it. History is a secondary cost here. Moving History alone would leave
the dominant catalogue work in place. First ship the bounded maintenance fix
from stage 1, then rerun this probe and a bounded Linux fixture before choosing
the active-tail format change.

Final raw results and arithmetic remain locally under
`.local/save-storage-attribution-1794206133868-e40cc38a/`.
The uninstrumented control is under
`.local/save-storage-attribution-1794205478949-071ac147/`.
The scripts are committed; generated saves/results remain ignored. Assertions
check retention success, CPU-category totals, repeat-pass writes, archive hash
stability on reopen, retained timeline counts and delayed-packing selection.
The smoke, nominal and control probes ran. Existing application tests were
inspected only. No full suite or server was run.

## 6. After the retention fix

Paired nominal runs on the same Windows PC, supplied Node 24.20.0, one worker,
BelowNormal priority and the shared heavy lock: one before application edits,
one after. Each uses the four section-5 anchors and two newly packed points per
anchor. These fresh baseline numbers differ from section 5 because process CPU,
GC and shared-machine load vary. No repetitions or Linux calibration were run.
After measurement, the shallow schema guard was corrected to accept existing
completion-coded version-2 envelopes; the nominal samples use version 1. The
codec/retained-plugin tests and all new regressions passed after that correction;
the nominal probe was not repeated.

| CPU milliseconds | 0 notes | 560 notes | 1,120 notes | 1,300 notes |
| --- | ---: | ---: | ---: | ---: |
| Packing per point, before | 4,312.5 | 4,679.5 | 5,180.0 | 5,390.5 |
| Packing per point, after | 586.5 | 719.0 | 859.5 | 945.0 |
| Whole cold writable open, before | 3,577 | 3,876 | 4,327 | 4,562 |
| Whole cold writable open, after | 1,203 | 1,593 | 1,375 | 1,422 |

| Modeled grown group, CPU minutes | Before | After |
| --- | ---: | ---: |
| 1,300 durable commands | 7.76 | 7.92 |
| Packing the same 560 points | 43.98 | 6.73 |
| Preliminary growth, initial open and pinned replacement | 0.16 | 0.16 |
| Total | 51.90 | 14.81 |

Packing's modeled CPU falls 84.7%; total modeled CPU falls 71.5%. This is still
interpolation, not an executed complete fixture or a server forecast. The
two-point batches amortize a shared field less than the normal 32-point limit.
The model now includes startup-only CPU categories: removing maintenance History
hydration exposed a previously hidden omission of 16 CPU ms in this after run.
Probe anchors were updated for the changed code; total CPU remains measured
around the same operations. Category boundaries around first field validation
have moved, so the table compares totals rather than claiming a precise new
category breakdown.

Per two-point pack, stored-state imports fall from six to two. The shared task
field is read/checksummed/parsed/JSON-checked once while cached; its frozen task
rows and indexes are schema-checked once for that roster. Full rules, member
references, optional evidence and History checks still run for each candidate.
Unknown-provenance candidates always receive this up-front check, including full
History dependency hydration when referenced; a failing candidate stays
standalone and reports retention failure. No trust marker or prior-pass cache
authorizes deletion. Checksums in `static-field.mjs` are unchanged.

New packs retain the decoded standalone JSON as exact UTF-8 text in the existing
`document` slot. No pack field, version, dependency or `state.json` format is
added. Publication syncs before reread; the complete decoded pack bytes and every
source document/metadata must match before any source in that batch is unlinked.
Existing object-valued packs still compare canonical JSON for interrupted
duplicates. Semantic archive validation happens on use, rather than indexing.
Cold-open imports fall from three to one (current state only). Repeat passes
write zero bytes at all anchors; pack hashes survive reopen. All four
`state.json` lengths match the baseline. At 1,120 notes the pack grows from
97,278 to 100,226 bytes because JSON text is escaped; size reduction is not this
fix's goal. New packs are now capped at `MAX_PORTABLE_BACKUP_BYTES` for the
complete decoded JSON envelope, including document escaping and metadata.
An oversized singleton stays standalone. Verification rereads use the same
decompression bound, including interrupted duplicates, before source deletion.
Reader limits and the existing pack representation remain unchanged.

Rollback proof uses the actual `06e15939dbf73ecd1a0e7bc9c29088e0281ca11e`
store module with this checkout's helper modules. Its `retainedArchiveIndex`
at line 769 and `readBackup` at line 1253 call `importStoredBackup`, whose
line 422 calls `parseSavedDocument`; line 32 accepts JSON strings before static
hydration and semantic import. The focused regression lists and reads every
new point through those frozen index/reader functions. This is reader-format
evidence, not a complete frozen-release deployment rehearsal.

At measured commit `e5d9651`, all 160 cases in twelve focused files passed
(25 new retention cases, zero skips).
They cover batch corruption, unknown candidates/dependencies, static cache
counts/checksums/rosters, every retained ID/time, portable historical reads,
old packs, frozen readers, History/Undo, locks, publication, snapshot barriers,
server transfer, completion-coded retention, plugin replay suppression and the
service-checkpoint dependency allowlist. No full suite,
CI stability loop or live activation ran. Existing History replay per candidate
and current-state import/response cloning remain. Linux fixture/full CI and owner
approval remain release gates.

Round-1 review fixes isolate cached History JSON from owned validation by
cloning the assembled events before normalization. A shared segment can resolve
the same old claim ID through different snapshot registries without contaminating
the next candidate. The static cache roots remain deeply frozen: identity
projection clones its input, task/registry validation only reads those roots,
and diagnostics/evidence normalization replaces provenance rather than mutating
it. A regression covers normalization and projection using the frozen roots.

The pass cache now has a 32 MiB decoded-JSON budget with least-recently-used
eviction. Fields larger than the budget are fully validated without caching;
evicted hashes must be read, checksummed and validated again. The nominal
18,986,921-byte task field fits. Serialized strings, normalized markers and
catalogue validation/index caches have weak keys, so evicted field versions
are not kept alive by those caches. This is an encoded-content budget, not a
32 MiB heap ceiling: parsed objects, indexes and the current candidate add memory.
The count-based regression uses a reduced budget and 34 candidates across two
published batches; one shared catalogue remains validated once while distinct
fields are evicted and oversized fields never enter the cache.

All three review regressions failed against `e5d9651` before their fixes. The
size regressions also cover envelope overhead and exact-limit packs through
the actual frozen `06e1593` index and `readBackup(..., { forImport: true })`,
with the same reduced limit in both readers. No new performance run was made
for these review fixes; the measurements above describe the earlier measured
source, before the History clone, cache budget and pack-size guard.
Round-1 focused verification passed all 166 cases across the same twelve files,
including 31 retention cases (six additional), with zero failures or skips on
Node 24.20.0. No full suite, retries or stability repetition loop ran locally.

Raw before results and model:
`.local/save-storage-attribution-1794207607855-c4abe1ea/`.
Raw after results and model:
`.local/save-storage-attribution-1794208707871-b2ca91b3/`.
