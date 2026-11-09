# Save history storage design

Study of `ad0e89817fef99f50df4969ce819876f9d484b79`. Measured on 2026-11-09.
No application changes. All inputs were synthetic. No real save was opened.

Recommend keeping the file backend. First, make restore points share immutable
History segments and make retention process only new bytes. Keep every restore
point. Then remove old History from ordinary state writes. An event log can
follow if measurements still justify the larger migration.

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
| `backups/<revision>-<random>.json.gz` | The **preceding** state is retained before every ordinary gameplay publication. A failed commit can leave an additional preimage. This is not a timer-based snapshot policy. | `app/storage/store.mjs:597`, `:1095` |
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
packed snapshot. Static dependencies can also be loaded repeatedly. The
History hydration cache is bounded to 8 MiB. Successful packing removes the
standalone file only after these checks.

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
Let T be inline catalogue/evidence bytes. The hot document has roughly
S = G(R) + H*E + T bytes. Large immutable fields may already be external.
Let V(H,R,T) be full validation cost. It includes shape checks, inverses and
reverse replay. Bulk map replacements can have much larger inverses than notes.
There is no measured universal constant per History entry or player.

| Operation | CPU and bytes from the implementation | Sync operations on Linux |
| --- | --- | --- |
| Ordinary command and preimage | Trusted command copies members and the History array. Serialization reuses immutable field and History-prefix encodings. It still assembles/writes S bytes and gzip-compresses the preceding S bytes at best speed. Cost remains dependent on R and H. | Normally two file syncs plus two parent-directory syncs. One atomic publication per preimage and state. |
| History compaction | Serialize/compress newly archived events, write a segment, then publish the referencing state. Dependency rules can extend H beyond the nominal tail. | One additional file and directory sync per new segment. |
| New static field | Serialize/hash/compress changed large field once. Later documents refer to it. | One additional file and directory sync per new field. |
| New retention batch | Read candidate gzip files. Import each candidate three times and validate hydrated History once. Serialize/compress the pack, reread it twice, compare exact documents, then unlink the standalone copies. Work grows with the sum of candidate histories and dependency bytes. | One file and directory sync per pack. Unlinks have no separate directory sync here. |
| Unchanged warm retention | Enumerate/stat remaining standalone files, sort them and select daily tiers. Cached archive index. Normally no payload reads or writes. Pinned non-daily candidates can still be opened and parsed before being skipped. | None. |
| Cold archive index | Read/decompress every pack and import every contained state. Work grows with all archived snapshot histories. | None for indexing. Store open separately publishes its lock record. |

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
would improve setup time. It would not fix retained snapshot costs.

With N successive actions and histories H_i approximately i, retaining and
revalidating full prefixes costs proportional to sum(H_i), or quadratic work
before compaction. Packing each snapshot only once does not remove that term.
The hot state and preimage bytes also grow with those prefixes. Compaction
bounds common active-tail cases, but full-history restore/export still grows.

### Probe and limits

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
the unchanged pass. This result supports removing repeated History validation;
it does not support claiming that every pass repacks all old archives.

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

### A. Shared History segments and incremental immutable restore points

Keep atomic file publication. Each new restore point records gameplay plus a
reference to an immutable History prefix. Write each event/inverse once into
bounded segments. Keep later Undo overrides as committed records. Reference
unchanged catalogue and evidence fields as storage already does for large
fields. A persistent index records restore-point metadata, blob hashes,
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
| Per action, first stage | Current hot-state write still costs S. Preimage adds roughly compressed gameplay plus D and a small root record, rather than another full History prefix. File syncs remain ordered; new segment/index roots add publication syncs. |
| Retention pass | O(M metadata + newly sealed bytes + unique new dependency checks). Unchanged passes read no History. Cold listing uses the persistent metadata index. Legacy conversion can still cost the sum of old histories once. |
| Disk | One retained History stream + gameplay per restore point + index + hot state. Roughly H_total*E + sum(compressed G_i) + metadata, with shared static fields. All restore points remain. |
| Grown probe layout guess | About 1-3 MiB/group, versus measured 8.07 MiB now. Compression and root layout need measurement. At 500/1,000 identical groups, about 0.52-1.57 / 1.05-3.15 GB. |
| Scale implication | Per-write cost does not include all retained restore points. At an assumed 20 actual saves/second, a 5 ms CPU budget for maintenance amortized per save would use 0.1 CPU core. This is a proposed acceptance budget, not a prediction. |
| Migration and rollback | Keep reading old packs. Convert lazily into new immutable objects under the group lock. Journal progress; verify every logical restore point and portable export before releasing its old copy. Preserve originals through rollout. Before downgrade, materialize legacy storage with the new reader and verify it with the frozen binary. |
| Risk / work guess | Medium. Undo overrides, segment dependencies, export allowlists and interrupted migration are the hard parts. About 3-5 developer weeks including focused compatibility/crash coverage. |

This option removes the quadratic full-History term from **new retention work**.
It does not immediately remove the whole-History hot-state write term.
Changing only scheduling or adding a cached archive index would leave both
new-snapshot prefix storage and much of the first-packing cost in place.

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

Choose A. It keeps the existing ownership and atomic-publication model and
targets the measured imports/History work. B offers the best eventual write
cost. Its log transaction and capture protocol are a larger recovery change.
C adds block and GC complexity before this workload has justified it.

The first implementation stage must include shared History prefixes **and**
incremental packing. A scheduling-only change is not completion. Existing
packs already stay immutable. Do not describe that existing property as a new
optimization. The stage removes repeated full-prefix validation from new
maintenance work. The separate hot-state write term remains explicit.

| Stage | Shippable result | Acceptance evidence before enabling it |
| --- | --- | --- |
| 1. Share restore-point History and process only new retention work | Add immutable History prefix roots and a persistent restore-point index. Dual-read old preimages/packs. New restore points preserve every revision without repeating full History in each copy. Seal packs once and verify new bytes/dependencies before removing their source. Keep the current authoritative `state.json` publication. | Repeat-pass pack hashes and zero payload writes. One new note must not import every old snapshot. Compare all logical restore points and portable History/Undo to the old writer on synthetic histories, including selected Undo and pinned restores. Fault before/after dependency, index, pack and state publication. Missing/corrupt dependency leaves the source copy. Test the actual server export and service restore paths with the new allowlist/manifest. |
| 2. Remove archived History from hot disk writes | Store the current History prefix through the same private roots and keep only the required active tail in `state.json`. Readers materialize the existing gameplay/portable shape. Preserve complete hooks and archive-aware Undo. This bounds common writes by gameplay plus the active tail and new events. | Hold roster/gameplay fixed and compare synthetic histories of increasing length. Doubling total old History must not double ordinary note-write bytes or CPU. Run existing compaction, archived Undo, hook isolation and migration tests. Round-trip every existing save representation and verify downgrade materialization with the frozen reader. |
| 3. Convert old storage incrementally | Convert one group in bounded resumable batches. Keep original files until inventory, portable export and per-restore-point digests agree. Export tools support mixed old/new storage throughout. Publish progress and bytes so an operator can pause between batches. | Interrupt every conversion boundary and reopen. Missing index rebuilds safely. Compare retained IDs/times/labels and event/Undo meaning, not just counts. Service backup/restore works halfway through conversion. Disk reserve covers old and new copies together. |
| 4. Re-measure before choosing a transition log | Run the same focused probe, then a separate Linux target-scale synthetic run. Only pursue B if hot gameplay writes, fsyncs or backup volume still miss budgets after A. | Separate browser requests, plugin polls and actual durable writes. Measure command CPU, event-loop delay, retention backlog, cold opens, export latency and backup/restore size. Use the intended roster mix for about 2,000 players and 500-1,000 groups. Concurrency and overlapping backups remain unmeasured here. |

Proposed performance gates are guesses until tested on the Linux server class:

| Gate | Proposed threshold or invariant |
| --- | --- |
| Unchanged warm retention | No old payload decompression, semantic replay, recompression or writes. Metadata enumeration may remain until the index is authoritative for scheduling. |
| New retention work | CPU and bytes scale with newly sealed bytes and unique dependencies. No sum of every retained History prefix on each pass or cold open. |
| Amortized retention CPU | Aim below 5 ms per actual durable action on the target dataset. Report backlog and errors independently of command success. |
| Storage growth | With fixed gameplay size, events and restore roots grow linearly. Document the separate growth from changed gameplay and Undo payloads. |
| Durability and compatibility | No acknowledged loss, missing restore point or weaker dependency check. Same plugin wire format and schema-1 portable exports. Explicit downgrade proof for private storage. |

The server can have many dormant groups. Their history should cost disk and
explicit restore/export work, without forcing repeated semantic replay whenever
a picker is opened or retention runs. That is the first storage change to ship.
