# Multiplayer storage contract

Audited START: `b42defc930df99262b36ade59b157b201f309145` (SC1).
This is a description of the existing file backend and a proposed boundary for a
SQLite trial. The SC3 startup rule below updates the implementation; gameplay
behavior is unchanged. Other inventory anchors describe SC1.

## Scope and counting

There are **37 durable file families**, numbered below. A family groups files
with one lifecycle and format (for example compressed retained backups and their
label metadata). Allocated picker directories count because their existence and
fsync order are part of provisioning. Temporary files belong to their destination
family; scratch copies, completed journal history, and corrupt archives are
explicitly included. “Durable” here means persisted application output, not a
claim that every writer survives power loss.

The inventory covers the server, `app/storage/`, `app/picker-router*.mjs`,
and every writer in `scripts/linux/`, including plugin sidecars outside storage.
Read-only helpers (`registry-legacy`, `history-reader`, `json-stream`, and
fingerprinting) do not create additional families. Linux runtime/serve and systemd
units invoke the writers; systemd's own journal is not an application store.
Release installation, research/performance fixture generators, browser storage,
and standalone map-capture CLI exports are outside this server/operator scope.
The server's optional startup log is included.

There are **7 bypassing live writer entry points**: functions that directly
replace, move, or delete another module's authoritative store files, listed in
the bypass section. Replica/scratch writers are listed separately and are not
counted as live bypasses. Calls through an owning module's API are not bypasses.

All source/test line anchors below refer to START. No private save was opened,
copied, or used to derive this document.

## Shared guarantees and ownership

* **R**: `app/storage/registry-lock.mjs:28` writes an exclusive random temporary
  file (0600), fsyncs it, renames it over the destination, then fsyncs the parent.
  Windows retries replacement and tolerates only specified unsupported directory
  fsync errors (`:8`). `durableDirectory` (`:16`) flushes created directory
  ancestry. A post-rename error can leave the new file installed even though the
  call rejects; registry save failures poison that instance until restart
  (`app/storage/registry.mjs:152`, `:157`).
* **F**: `scripts/linux/files.mjs:30` writes/chmods/fsyncs an exclusive temporary
  file, renames, and fsyncs the parent on non-Windows. It is a byte-writing helper,
  not a lock, schema validator, queue, or multi-file transaction.
* **A**: gameplay `app/storage/store.mjs:207`, invite/account
  `app/storage/invites.mjs:54`, feedback `app/storage/feedback.mjs:46`, usage
  `app/storage/usage.mjs:47`, plugin-key
  `app/plugin-keys.mjs:26`, overlay `app/overlays.mjs:39`, and plugin sidecar
  `app/plugin-achievements.mjs:47` use exclusive temporary files, file fsync,
  and rename. **These helpers do not fsync the parent directory.** Replacement
  retries on Windows do not strengthen that guarantee.
* **T**: `scripts/linux/service-checkpoint.mjs:16` fsyncs every file and then
  directories bottom-up; Windows flushes files through writable handles and
  skips directory flushes. `:26` flushes a single directory on non-Windows.
  Copying via `files.mjs:61` verifies source/destination inventories and hashes;
  it does not itself fsync or publish a tree.
* A registry instance holds kernel guards plus `registry.lock` in both registry
  and tombstone roots for its full lifetime (`registry.mjs:265`). Mutations and
  metadata checkpoints share its promise queue (`:166`). Reads return copies
  from committed in-memory indexes, filtered by the current ledger; ordinary
  reads do not take the queue.
* A writable gameplay store holds a canonical-path kernel guard and owner file
  for its lifetime (`store.mjs:135`, `:161`, `:244`). Revision writes share
  one queue (`:944`); maintenance/backup reads use a separate queue (`:844`).
  Both enter `withStoreWrite`. Sidecars have separate queues under the same
  store ownership. This is **not** one cross-sidecar transaction.
* `app/storage/snapshot.mjs:13` is an in-process barrier participant, not a
  writer mutex. It tracks active work; nested work joins the same scope.
  `withDirectoryBarriers` (`:120`) closes admission before draining accepted
  work, releases gates on errors/deadlines, and never cancels an accepted write.
  It cannot protect arbitrary out-of-process file writes.
* Router residency serialization (`app/picker-router.mjs:41`) keeps closing
  contexts present until close drains (`:45`). Cold open enters the per-picker
  write barrier before residency serialization (`:69`;
  `app/picker-router-checkpoint.mjs:25`). Service metadata capture closes global
  admission only around the registry-queue roster read (`:33`); it does not
  wait for unrelated HTTP handlers or hold all picker copies globally.
* Operator exclusion is `scripts/linux/service-lock.mjs:10` for multiplayer
  and `scripts/linux/files.mjs:84` for single-store operation. Stopped proofs
  (`service-operator.mjs:30`, `operator.mjs:41`) check systemd and released
  storage ownership; the multiplayer proof temporarily acquires both registry
  root locks, then releases them. This is a proof under operator exclusion,
  not a registry lease held throughout the later filesystem installation.

Tests exercise process exits, thrown write failures, synthetic interrupted intents,
reopening, and concurrency. None of the cited tests simulates filesystem power
loss. File/directory fsync claims above come from implementation inspection.
`tests/linux-service-crash.test.mjs` does not exist at START; the service
interruption evidence is in `tests/linux-multi-picker.test.mjs`.

## SC3: missing registry beside a used ledger

SC3 START: `602876bc88088ba97f06d163eaec95b63fcc7eb0`.
`openRegistry` refuses a missing `registryDir/registry.json` when the validated
`tombstoneDir/ledger.json` contains any issued picker ID, picker tombstone, or
retired account. The operator error names both paths and asks for `registry.json`
from a service backup or known-good checkpoint, keeping the existing ledger.
Refusal neither creates the registry nor rewrites the ledger; temporary writer
locks are acquired and released normally. Never delete the ledger to bypass this
check. A present registry still requires its ledger, as before.

An empty ledger is the first-startup exception: with all three arrays empty,
a missing registry starts normally. Startup durably writes the ledger before the
registry, so a process crash between those writes must remain recoverable.
An issued ID alone counts as used even when provisioning never completed;
retired accounts count even when no picker was ever issued.

Repository-wide caller review, including `scripts/linux/` (no operator flow
changes required):

| Caller / flow | Can reach the refusal? / result |
| --- | --- |
| `app/storage/registry.mjs` startup (`saveLedger`, `save`), called by `app/server.mjs` / Linux `runtime.mjs`, `serve.mjs` | Yes after registry loss beside a used ledger: deliberately refuses. Fresh install with neither file, or a crash after the initial empty ledger write, starts. Existing registry provisioning/deletion crash recovery still reconciles normally. |
| Registry allocation, deletion and `reconcileTombstones`; `app/storage/tombstones.mjs` purge | No missing-registry open during these operations; the registry is already open. Purge removes picker data/bindings, keeps registry/ledger, and resumes against both documents. |
| `scripts/linux/service-recovery.mjs` `reconcileServiceRecoveryTombstones` (planning and application) | No: atomically seeds scratch `registry.json` from the sanitized checkpoint **before** opening against the existing live ledger. Never initializes or restores a ledger. |
| `restoreServiceStopped`, including interrupted/resumed recovery | No: uses the seeded adapter, then journals and publishes live `registry.json` before completion/startup. Empty target beside a used ledger is supported. `start-check.mjs` blocks incomplete recovery; unguarded app startup now also refuses while the registry is absent. |
| `releaseServiceQuarantine`, including install/cleanup resume | No: normal release reads the existing registry and uses the seeded adapter. Missing registry already refuses that read. Completed cleanup resume does not open a registry or replace either metadata file. |
| `scripts/linux/service-checkpoint.mjs` `captureServiceCheckpoint`, `publishServiceBackup`; `service-operator.mjs` `serviceBackup`; `online.mjs` capture/cleanup | No: write/copy/move/remove backup or spool registry images only, never the live registry or ledger. Stopped backup reads the existing registry; online capture uses its open owner. |
| `service-operator.mjs` stopped proof, list/inspect, deploy, ownership repair | No registry open: read existing metadata, acquire/release locks, or repair ownership only. Missing registry cannot be silently recreated by these operations. Deploy startup goes through the server rule. |
| Single-store `recovery.mjs`, `operator.mjs`, `probe.mjs`; install/runtime setup; `rehearse.mjs` | No registry/ledger creation, move or restore. Single-store recovery touches gameplay roots only; service mode dispatches to service recovery. Offline probes omit multiplayer configuration; rehearsal refuses service configuration. |
| `scripts/release/vps/release.mjs` stage/activate with `--go-live`, `bundle.mjs`; PC/private-companion release preparation | No metadata initialization: VPS activation delegates to `scripts/linux/operator.mjs` deploy and its service-root checks; release preparation writes release inputs. Per-store compatibility probes omit multiplayer configuration. Normal service startup still applies the refusal. |
| `scripts/perf/duo-compatibility.mjs`, `picker-footprint.mjs` | Fresh temporary registry/ledger roots per server trial; cleanup removes the complete trial root. No used-ledger/missing-registry pairing. |

Synthetic evidence: `tests/registry.test.mjs` covers issued-only history,
picker tombstones, retired-account-only history, repeated refusal without file
writes, checkpoint restoration and lock release. Its first-startup child exits
before the registry rename, after the empty ledger is durable, then reopens.
`tests/linux-multi-picker.test.mjs` verifies direct opening of an empty restore
target refuses against a used ledger, while stopped restore succeeds and the
published registry reopens with tombstones applied. Existing quarantine/resume
cases exercise the same adapter.

Independent gate review at `d7b2fb63371f60b7b813a99e0c1754b9d08307b6`
found no P1/P2/P3 defect in the SC3 change. A further synthetic process-crash
regression stops at `id-reserved`, before any picker record or directory exists,
then removes the registry. Refusal preserves ledger bytes and leaves neither
writer lock nor temporary file; restoring the checkpoint allows startup, and a
forced collision confirms the orphan issued ID is never reused. This is metadata
loss after a provisioning crash; the crash alone retains a valid registry and
continues to recover normally. The additional regression fails against the
integration baseline `c299c4f` with "Missing expected rejection" and passes here.

Gate validation on Node v24.21.0 (passed / failed / skipped): registry 30/0/0,
linux-multi-picker 33/0/0, linux-service-crash 21/0/1, phase1-acceptance 12/0/0,
picker-deletion 13/0/0. The service-crash skip requires root for native chown.
Then `npm run test:quick`: 2807/0/68 in 179.5 seconds; `npm test`: 5955/0/140
in 442.6 seconds. Existing platform/environment skips were retained; no tests
were weakened. These are single-run test durations; no performance comparison,
median, spread or peak-memory measurement was made for this review gate.

## Durable inventory

“Readers/coordination” below describes the normal read path; the snapshot and
recovery families also read/copy the applicable files as described later.

### Registry and store roots

**1. `registryDir/registry.json`**

Owner: `app/storage/registry.mjs`. JSON schemaVersion 1 with accounts,
identities, memberships, default-picker links, picker lifecycle/provisioning, and
hash-only capability indexes (`:38`). All owner writes converge at `:154`:
startup/reconcile `:247`, `:276`; provisioning `:227`, `:238`; identity,
membership, legacy import, and capability mutations `:297`, `:303`, `:309`,
`:317`, `:324`, `:353`, `:369`; deletion applies the ledger through
`:375`, `:388`, `:396`, `:411`. Uses R, full-lifetime dual-root locks,
and one queue. Startup validates both documents before writing; a missing ledger
with an existing registry is fatal (`:267`). Readers: router, sign-in/session
and capability checks through `:286`–`:295`, `:364`; recovery metadata via
queue-held `withRecoveryCheckpoint` (`:285`). Operator list/stopped backup/
deploy also read JSON directly (`service-recovery.mjs:338`;
`service-operator.mjs:45`, `:73`, `:138`), with no read lease for list/inspect.
**Live bypass:** `scripts/linux/service-recovery.mjs:329` installs a sanitized
checkpoint with F after journaling old/new hashes at `:328`; service must be
stopped. Scratch/backup registry writers are listed below.
Relied-on recovery: one default per identity, unique provider subjects and scoped
capabilities, no resurrection after ledger reconciliation.
Evidence: `tests/registry.test.mjs:39`, `:56`, `:69`, `:86`, `:209`,
`:229`, `:294`; real OAuth process exits
`tests/picker-routing-crash.test.mjs:71`.

**2. `tombstoneDir/ledger.json`**

Owner/writer: `app/storage/registry.mjs:159`; JSON schemaVersion 1,
`issuedPickerIds`, picker deletion records, retired-account records and optional
purgeProgress (`:21`). Call sites: reserve before registry allocation (`:210`),
startup (`:276`), begin/complete picker deletion (`:374`, `:387`), account
deletion (`:396`), purge checkpoints (`:408`). Uses R, the same queue, and its
own lifetime root lock, also excluding registries that share this ledger.
Readers: registry startup, allocation and filtered indexes; tombstone reconciler
through the API; recovery explicitly opens the **existing live ledger**
(`service-recovery.mjs:19`, `:33`). No direct external ledger writer was found:
operator reconciliation delegates to openRegistry and repairs ownership
(`:71`; `service-operator.mjs:26`). The ledger is outside restorable roots,
never copied from a service backup, and must remain after deletion.
A durable tombstone precedes registry cleanup and synchronous delivery fencing;
progress is replayable, including completed purges.
Evidence: `tests/registry.test.mjs:101`, `:248`, `:260`, `:267`;
`tests/picker-deletion-crash.test.mjs:157`;
`tests/linux-multi-picker.test.mjs:261`, `:315`, `:397`, `:415`.

**3. `registry.lock` in registry, tombstone, and control/service-operation roots**

Owner/writer: `app/storage/registry-lock.mjs:49` (publish `:76`, hard link
`:77`, release `:85`, stale removal `:73`). Unversioned JSON
`pid, host, nonce`. R creates a complete temporary owner record, then an
exclusive hard link publishes ownership and directory fsync seals it.
A full-lifetime canonical-path kernel mutex serializes inspection/reclaim;
only a provably dead local PID permits reclaim. Foreign/malformed/live owner
records fail closed. Readers: lock acquisition/release and operator stopped proof
`service-operator.mjs:37`, while holding or acquiring that guard.
Kernel ownership dies with a process; stale disk evidence remains.
Evidence: `tests/registry.test.mjs:267`, `:275`;
`tests/linux-multi-picker.test.mjs:516`, `:745`.

**4. Allocated `pickerRoot/p_<id>/` directory entries**

Owner/writer: `app/storage/registry.mjs:220`, fsync directory and pickerRoot
at `:225`, publish ready only afterward at `:227`; reserved ID is already in
family 2. No file schema; IDs have 128 random bits, fixed validated path syntax.
Registry reads lstat while queued; router opens only active/ready entries.
No pre-existing unregistered directory or orphan binding is adopted (`:204`).
Deletion writer `app/storage/tombstones.mjs:20` removes the tree and fsyncs
parent before advancing progress; recovery installer/quarantine also creates/
replaces these directories. Provisioning resumes after interruption without
reusing an issued ID. Evidence: `tests/registry.test.mjs:69`, `:101`,
`:118`, `:306`; deletion crash tests `:157`.

**5. `<dataDir>.dataset.json` sibling bindings**

Owner: `app/dataset-binding.mjs`; JSON schemaVersion 1, datasetId,
datasetContractVersion, digest, optional requiresPack (`:8`).
Writer `bindDatasetStorage` (`:42`) writes exclusive temp (`:49`), links
for first creation (`:55`, `:56`), or renames a verified matching promotion
(`:54`), then revalidates. **No fsync**; not independently locked.
Server owned cold-open calls it at `app/server.mjs:415` inside router's cold
barrier/residency queue; independent-game startup also delegates through
`app/game-profile.mjs:22` from `app/server.mjs:128`. Verification occurs before
gameplay open.
Live bypasses: `scripts/linux/operator.mjs:108`, `:125`;
`scripts/linux/recovery.mjs:103`; `service-recovery.mjs:168`, `:184`.
Deletion removes/fsyncs parent at `app/storage/tombstones.mjs:23`.
Replica writers: `recovery.mjs:37`, `service-checkpoint.mjs:141`,
`service-recovery.mjs:152`, `:245`, `:305`, `:399`,
`online.mjs:32`, `rehearse.mjs:36`.
Store and binding installation are two renames, recoverable through family 26/27,
not one atomic pair. Evidence: `tests/datasets.test.mjs:216`, `:229`;
`tests/linux-multi-picker.test.mjs:110`, `:632`;
`tests/linux-operator.test.mjs:92`, `:258`.

**6. `dataDir/store.lock`, `store.lock.recovery`**

Owner/writer: `app/storage/store.mjs:127` creates synchronized complete temp
records then exclusive hard links; normal acquire `:183`, recovery acquire
`:189`, checked removal `:117`, `:180`, `:200`, `:201`.
Unversioned JSON with PID, host, process-start proof, nonce, createdAt.
Uses A for temp data, plus kernel guard; no parent fsync on link/removal.
Owner/recovery readers are serialized by that full-lifetime guard. PID reuse
requires verified process-start evidence; uncertain/foreign ownership refuses.
Operator `files.mjs:74` refuses either file's existence; snapshots omit them.
Read-only standby takes neither writer lock; activation acquires original locks
before reading the final checkpoint. Evidence: `tests/storage-reliability.test.mjs:33`,
`:60`, `:96`, `:108`, `:119`, `:146`;
`tests/live-swap-storage.test.mjs:50`, `:202`.

### Gameplay and related evidence (under each dataDir)

**7. `state.json`, including private receipts and coordination**

Owner/writer: `app/storage/store.mjs`; JSON `format: rs3-chunk-picker`,
schemaVersion 1 (`app/core/state.mjs:30`), state plus optional storage metadata
schemaVersion 1, coordination schemaVersion 1, actionReceipts format 2 (legacy
replay-only bridge accepted; `app/storage/action-receipts.mjs:23`).
Write sites: initialize `:885`, catalogue refresh `:912`, startup daily
observation `:927`, command/replace/claim cleanup through persist `:962`,
action-session registration `:1269`. Uses A, lifetime store lock and revision
queue; initial writes happen before the queue is exposed (owned cold open is
barrier-covered). Maintenance never changes the authoritative state.
Readers: openStore, snapshots, API projections from committed memory, standby
and activation. A commit writes dependencies and prior backup first, then replaces
state **with its action outcome in the same replacement**; memory, notifications,
and acknowledgement follow. Revisions conflict inside the queue. Orphan outputs
of an interrupted commit are ignored. Startup can write without a revision bump
(daily observation); action-session writes also preserve revision.
Live recovery can replace it by copying/moving the whole store (bypass list).
Evidence: `tests/storage.test.mjs:42`, `:81`, `:103`, `:191`;
`tests/live-swap-storage.test.mjs:22`, `:38`, `:236`, `:248`;
`tests/receipt-quarantine.test.mjs:41`.

**8. `static/static-<sha256>.json.gz`**

Owner/writer: `store.mjs:434` / `:442`. Gzip JSON field value; checksum in
filename and state.storage schemaVersion 1 reference (`:403`, `:466`).
A, store ownership, prepared before state reference publication. Existing content
must validate; reads verify location/hash and decode during load/backup hydration.
Unreferenced interrupted blobs are harmless; missing/corrupt referenced blobs fail.
No pruning writer exists. Evidence: `tests/storage-static.test.mjs:32`, `:77`,
`:219`, `:267`.

**9. `history/history-<range>-<random>.json.gz`**

Owner/writer: `store.mjs:698` / `:726`. Gzip
`{format: rs3-chunk-picker-history, events}`, no numeric schema version.
A, revision queue and barrier; state provenance publishes references last.
Store hydration/history queries and `app/storage/history-reader.mjs:8` read only
referenced segments under store ownership (or a captured immutable state);
later segments and live history override earlier revisions. Failed publication
must retain old history/Undo, ignoring orphans. No segment pruning writer exists.
Evidence: `tests/storage-reliability.test.mjs:178`, `:201`;
`tests/storage-static.test.mjs:159`.

**10. `backups/<revision>-<random>.json[.gz]` and `.meta.json` labels**

Owner/writer: `store.mjs:610`, bytes `:619`, optional label `:620`,
mtime `:622`; pruning `:818`. Current writes gzip a schemaVersion 1 backup
envelope; older plain JSON is readable. Optional retentionPinned/retentionLabel;
unversioned label JSON `{label}`. A; prior backup completes before authoritative
replacement. Label and backup are separate writes. Backup reads/listing share
maintenance queue to exclude pruning; exports hydrate static/history references.
Pinned migration/restore/member-transition evidence survives pruning.
Evidence: `tests/storage.test.mjs:103`, `:167`;
`tests/storage-reliability.test.mjs:235`; `tests/storage-static.test.mjs:243`.

**11. `backups/archives/archive-<random>.json.gz`**

Owner/writer: `store.mjs:784` / `:792`; gzip
`{format: rs3-chunk-picker-retained-archive, snapshots}`, no numeric version.
A, separate maintenance queue/barrier. Store re-reads and validates preserved
documents and dependencies before unlinking standalone backups (`:793`–`:818`).
Crashes may leave duplicate copies; caller expects no sole snapshot removed.
Reads initialize archive index and retrieve historical backups under maintenance
ownership. No directory fsync: this is not proven power-loss-safe copy-before-delete.
Evidence: `tests/storage-reliability.test.mjs:235`, `:263`, `:296`;
`tests/storage-static.test.mjs:219`, `:267`.

**12. `action-acknowledgements.json`**

Owner/writer: `store.mjs:1284`; schemaVersion 1, bounded entries (32 slots),
exact client/generation/principal/scope/sequence/request/fingerprint/revision.
A, revision queue/barrier. Load/activation read via `:265` without rewriting
state. Only an exact matching durable receipt is pruned; missing, malformed,
oversized or stale ACKs retain replay outcomes. ACK failure retains memory/disk
receipt; next gameplay write embeds watermark. Evidence:
`tests/action-acknowledgements.test.mjs:42`, `:61`, `:72`, `:87`, `:99`,
`:112`, `:140`.

**13. `receipt-quarantine/<sha256>.json`**

Owner/writer: `store.mjs:308` / `:318`. JSON schemaVersion 1 with revision,
reason, rejected actionReceipts; content-addressed private evidence.
A; created before any explicit replacement drops rejected metadata. Startup and
standby retain source bytes; evidence failure refuses mutation. Reads check any
existing same-hash evidence; ordinary gameplay backups/pruning exclude this
family, raw snapshots retain it. Evidence: `tests/receipt-quarantine.test.mjs:57`,
`:80`, `:92`, `:148`.

**14. `access-token`**

Owner/writer: `store.mjs:862` / `:866`; unversioned 43-character base64url
token plus newline. A, exclusive store startup ownership; malformed file refuses
startup. Store caches it; private operator `operator.mjs:46` reads directly for
Bearer requests without acquiring the store lock. Must survive restart; excluded
from sanitized service recovery, included in raw single-store recovery.
Evidence: `tests/storage.test.mjs:67`; service exclusion
`tests/linux-multi-picker.test.mjs:110`. No dedicated token power-loss test.

### Sidecars

Each following sidecar's owner reads it on open while its caller owns the store;
normal reads use its in-memory committed view. Missing files start empty in
memory; corruption does not authorize resetting credentials. All use separate
queues and A, with the noted barrier exceptions. No parent fsync guarantee or
general cross-file rollback exists. The service gameplay export excludes 15–20;
raw single-store snapshots/recovery copy them.

**15. `accounts.json`** — owner `app/storage/accounts.mjs:39`; JSON
schemaVersion 1 with identity timestamps, invitation-linked memberships.
Every mutation (identity/link/unlink/touch/membership/delete/revokeDeletion)
writes at `:56` inside queue/barrier `:53`. Readers also include sign-in,
invite authorization, read-only legacy import (`registry-legacy.mjs:16`), and
server legacy synchronization (`server.mjs:331`). Stopped recovery revokes via
the owner API (`service-recovery.mjs:47`, `:50`), then syncs dataDir (`:63`).
Evidence: `tests/accounts-storage.test.mjs:37`, `:68`, `:97`, `:209`
(reopen/failure validation, not power-cut tests).

**16. `invites.json`** — owner `app/storage/invites.mjs:72`; JSON
schemaVersion 1 with invitations and hashed sessions; all mutations, expiry,
touches, session issuance/sign-out/revocation converge at `:87` inside
queue/barrier `:83`. Authorization additionally checks current account/registry
membership and tombstones; an old session alone grants nothing. Legacy import
reads the file. Stopped recovery uses owner revoke APIs (`service-recovery.mjs:48`,
`:50`, `:53`), not a restored issuer image. Evidence:
`tests/invites-storage.test.mjs:35`, `:92`, `:121`, `:147`;
`tests/picker-deletion.test.mjs:223`.

**17. `feedback.json`** — owner `app/storage/feedback.mjs:64`; JSON
schemaVersion 1 with items and optional per-actor seen sets. Add, status and
markSeen write at `:76` inside queue/barrier `:73`. APIs read copies; feedback
never enters gameplay History/Undo/backups. Evidence:
`tests/feedback-storage.test.mjs:20`, `:36` (reopen/identity behavior);
no dedicated abrupt-process-death test for this sidecar.

**18. `usage.json`** — owner `app/storage/usage.mjs:65`; JSON
schemaVersion 1 with aggregate counts. Writers: startup retention `:78`,
queued add `:100`, read-triggered retention `:107`. Queue/barrier `:82`;
startup retention is outside this local barrier and relies on cold initialization
ownership. Standby suppresses all these disk writes. Authenticated aggregate
read also queues; retention rechecks UTC day. Evidence:
`tests/usage-storage.test.mjs:28`, `:44`, `:59`;
`tests/live-swap-storage.test.mjs:82`. No dedicated power/crash test.

**19. `plugin-keys.json`** — owner `app/plugin-keys.mjs:41`; JSON
schemaVersion 1 with scoped hash-only keys. Create/revoke/revokeDeletion/flush
write at `:53` inside queue/barrier `:50`; close flushes dirty touches at
`:86`. `:83` changes last-use/world in memory; callers cannot assume a touch
alone is durable. Authentication/listing use owner memory. Router's separate
registry capability write (`app/picker-router.mjs:198`, revoke `:204`) is a
second commit, not atomic with this sidecar. Recovery strips both credentials
and capability index. Evidence: `tests/picker-deletion.test.mjs:223`,
`tests/picker-audit-a.test.mjs:271`; no cross-file transaction/power-loss proof.

**20. `overlays.json`** — owner `app/overlays.mjs:88`; JSON schemaVersion 1
with scoped hash-only links. Management writes `:194` via local queue and
injected `serializeMutation` (context queue/barrier at
`app/picker-context.mjs:425`). Deletion revoke writes `:290` after draining
its own queue, **outside that injected barrier**; it relies on delivery fencing
and subsequent context drain/purge. Readers: overlay auth and streams.
Revocation closes streams after commit; deletion fences them before async work.
Evidence: `tests/overlay-routes.test.mjs:52`, `:134`, `:221`, `:235`;
`tests/picker-deletion.test.mjs:223`. Barrier participation during deletion is
a trial risk, not an existing transactional guarantee.

**21. `plugin-achievements.json`, `.corrupt-<time>[-n]`** — owner
`app/plugin-achievements.mjs:71`; JSON `v:1, players` with sorted handled IDs.
Writer `:118` uses shared replaceSidecar `:47` inside queue/barrier `:101`.
Reads tolerate corruption in memory until a changed write. Corrupt original
renames to a collision-safe archive (`:55`) before replacement; failed
replacement attempts to restore original (`:60`). A process exit between
those renames can leave only the archive; there is no journal or parent fsync.
Evidence: `tests/plugin-achievements.test.mjs:32`, `:84`, `:129`, `:142`,
`:159` (failure/retry coverage, not proof of atomic two-rename recovery).
Service export allowlists the exact active filename, not corrupt archives.

**22. `plugin-items.json`, `.corrupt-<time>[-n]`** — owner
`app/plugin-items.mjs:42`; JSON `v:1, players`, item evidence, handled task IDs,
journal acknowledgement and optional bank snapshot. Put at `:66`, queue/barrier
`:61`, shared replacement/archive method and limitations as family 21.
Reads return copies; removed members are pruned on write. Service export
allowlists only active filename. Evidence:
`tests/game-plugin-items.test.mjs:172`, `:198`, `:244`, `:294`.

### Snapshot and backup products

**23. `<dataDir>.snapshots/<uuid>/store/**`, `store.dataset.json`, `complete.json` (raw)**

Owner/writer: `app/storage/snapshot.mjs:41`; creates directories `:81`–`:89`,
copies pinned descriptors `:94`–`:103`, writes unversioned `{id, heldMs}`
completion marker exclusively at `:107`. File copies fsync, but marker and
directories do not. Raw files retain their original schemas, excluding only
store.lock/recovery. Gates drain all participants, pin regular single-link files,
then on Linux release before copying; Windows holds through copy/descriptor close.
Readers: `scripts/linux/online.mjs:16` requires matching completion before
copying; backup/probes use the private copy. Cleanup at `snapshot.mjs:110`,
`online.mjs:40`. Completion means finished application copy, not proven
power-loss-durable publication. Evidence: `tests/online-snapshot.test.mjs:31`,
`:61`, `:142`; `tests/linux-multi-picker.test.mjs:130`.

**24. Service snapshot spool and `backupDir/service-<uuid>/`**

Owner: `scripts/linux/service-checkpoint.mjs`. Writers: copyGameplay `:75`
(files `:81`), bindings `:141`, inputs `:161`, `:166`, `:170`, sanitized
registry `:186`, manifest `:193`, completion `:194`; publication copies via
`:258`, fsyncs T, renames pending tree and fsyncs backupDir (`:259`); retention
removes verified older trees (`:267`). Manifest format
`picker-service-recovery-v1`, with picker roster/bindings/absent flags, input pins,
file sizes/hashes. Complete metadata has id/counts/timings, no numeric version.
The roster is queue-held and credential-free; each gameplay copy has its own
directory barrier (`:130`). Initial roster defines inclusion; final registry
read removes vanished scopes/data (`:176`–`:184`) and never adds new IDs.
It is **not one global gameplay instant**. Copy includes only state/static/history/
backups and active plugin evidence plus pinned input payloads; never live ledger,
issuer credentials or capabilities. T precedes manifest/complete F publication.
Readers: online capture, verifier `:199`, publisher and stopped restore; source
and published copies are verified against inventory/allowlists. Evidence:
`tests/linux-multi-picker.test.mjs:80`, `:110`, `:143`, `:453`, `:466`,
`:552`, `:615`. Per-picker copy holds must not stall unrelated residency
(`:675`, `:709` tests).

**25. `backupDir/recovery-<timestamp>-<uuid>/` (single-store)**

Owner/writer: `scripts/linux/recovery.mjs:39`; snapshot copies via `:35`,
portable probe output via `:52`, manifest exclusive write `:56`,
rename publication `:61`, validated retention deletion `:65`.
Manifest format `picker-recovery-v1`, createdAt and file inventory; raw store,
binding, portable rs3-chunk-picker schemaVersion 1 export. **No tree/directory
fsync on this path**; copy verification and rename do not imply power-loss safety.
Reads: verifier `:70` and restore `:82`, under operator exclusion with released
store ownership; probes open disposable copies only. Raw images may contain
credentials; this differs intentionally from service recovery.
Restore direct writes at `:103`, `:107` use exclusive creation/copies into
empty targets and verify inventory; partial restore stays stopped, without a
service-style resumable install journal. Evidence:
`tests/linux-operator.test.mjs:92`, `:112`, `:341`.

### Operator journals, quarantine and control

**26. `controlDir/service-restore/progress.json`, `progress.complete-<time>.json`**

Owner/writer: `scripts/linux/service-recovery.mjs:194`, save closure `:276`;
completed journal archives by rename/fsync `:222`. Unversioned JSON:
backupSha256, targetIdentity (roots/release), phase, per-picker statuses and
checked/install digests, binding hash, installStage/destinationReady/installing,
plus previous/new registry hashes. Uses F under serviceOperation and repeated
stopped/release proofs. Installer `:119` records a destination-filesystem stage
(`:134`, `:135`), copies/verifies/fsyncs it (`:144`, `:152`, `:155`),
then saves readiness/intent (`:156`) **before** live store/binding renames
(`:163`, `:168`). Fsync target parent/local stage then journal restored
(`:171`, `:172`); cleanup syncs stage parent (`:105`).
Readers: resume logic `:213`, install verification `:112`, privileged startup
gate `start-check.mjs:19`. Incomplete journal blocks startup. Same backup/target
can resume; changed source/target rejects; completed journal can become history.
Final registry publication journals both acceptable hashes (`:328`), installs
(`:329`), then marks complete (`:330`). It is a filesystem saga, not one
transaction. Evidence: `tests/linux-multi-picker.test.mjs:188`, `:214`, `:492`,
`:589`, `:632`. Most interruption cases throw/model intent; do not label them
all real process-death tests.

**27. `controlDir/release-<pickerId>/progress.json`**

Owner/writer: `service-recovery.mjs:352`; F saves at `:360`, `:364`, `:392`,
`:405`, plus shared installPicker save callbacks `:135`, `:156`, `:172`.
Unversioned JSON with id, releaseIdentity, status, install intent/digests/stage.
Single operator, deliberately stopped service; reconcile the live ledger again
before release. Readers: retry path `:367` and installer. Persist installed
before deleting quarantine payload/record; persist released after cleanup.
An installed/released journal can finish after the record is gone, with exact
installed-byte checks when needed. Evidence:
`tests/linux-multi-picker.test.mjs:237`, `:269`, `:632`.

**28. `controlDir/quarantine/<id>/**`, sibling binding and `<id>.json`;
live `operator-quarantine.json`**

Owner/writers: `service-recovery.mjs:175` moves payload/binding (`:182`,
`:184`), F writes live marker `{id}` (`:189`) and private record
`{id, kind, reason: incompatible}` (`:190`), fsyncs parents (`:191`) then
journals quarantined. Formats otherwise preserve gameplay bytes; marker/record
unversioned. Release copies to probe stage (`:398`, `:399`), removes live
marker (`:409`), installs through family 26 helper, cleans private payload/
record with directory sync (`:361`, `:362`). Reads: operator inspect
(`:344`), release, service backup refusal (`service-checkpoint.mjs:133`),
owned cold-open refusal for an unbound nonempty directory
(`app/server.mjs:412`, `:414`); the placeholder retains that fence. Operation lock/stopped proofs serialize mutations; runtime may read
the installed fence after startup. Shared legacy picker must refuse incompatible
restore before live changes and is never quarantined. Evidence:
`tests/linux-multi-picker.test.mjs:201`, `:237`, `:529`, `:615`.
Quarantine moves are separate filesystem effects, not DB-atomic.

**29. `controlDir/operation.lock`**

Writers: single-store `files.mjs:84` exclusive open/write `:86`, `:88`,
remove `:89`; multiplayer `service-lock.mjs:28` F, checked dead-owner
removal `:25`, matching-owner release `:31`.
Unversioned JSON pid/startedAt, plus host for multiplayer. Single-store helper
has no fsync; multiplayer additionally holds family 3 control guard.
Readers: operators, privileged startup gate `start-check.mjs:29`, guarded
systemd start `operator.mjs:32`. Busy health skips; multiplayer stale reclaim
is restricted to restore/quarantine-release and verified dead local ownership.
Single-store abandoned evidence needs explicit reconciliation.
Evidence: `tests/linux-operator.test.mjs:280`, `:291`;
`tests/linux-multi-picker.test.mjs:516`.

**30. `controlDir/maintenance.json`**

Writers: `operator.mjs:207` F, success removal `:243`;
`service-operator.mjs:107` F, success removal `:148`.
Unversioned command/start-time or service-restore backup/quarantine ID.
Reads: next operator invocation (`operator.mjs:176`,
`service-operator.mjs:93`), privileged start gate `start-check.mjs:23`,
under operation exclusion for mutations. Interrupted failures retain evidence;
service resume requires matching operation identity. Removals do not explicitly
fsync parent; a crash can conservatively retain evidence. Evidence:
`tests/linux-operator.test.mjs:291`; service resume/gate tests
`tests/linux-multi-picker.test.mjs:188`, `:589`.

**31. `controlDir/activation.json`**

Owner/writer: `operator.mjs:106` F before binding/pointer changes;
removal `:112`, `:132`. Unversioned prepared phase, previous pointer and
binding bytes base64, candidate pointer hash. Operator reads existence at next
start gate (`start-check.mjs:23`); no automatic disk-journal replay is implemented
here. Single operator plus stopped ownership and byte CAS protect activation.
Rollback re-probes latest candidate-written gameplay before restoring selection;
uncertainty retains maintenance/start refusal. No explicit parent fsync on removal.
Evidence: `tests/linux-operator.test.mjs:246`, `:258`, `:291`.

**32. `controlDir/start-permit.json`**

Owner/writer: guarded systemd start `operator.mjs:35` F; finally removal `:37`.
Unversioned lockSha256, pointerSha256, processIdentity, expiresAt (30-second cap).
Reader/deleter: privileged `start-check.mjs:25`, `:28`, validates `:31`
against operation.lock, exact pointer and live boot/process start identity.
One attempt consumes permit even on refusal. Operation lock serializes issuance;
no parent fsync on consumption, expiry/live identity still gates replay.
Evidence: `tests/linux-operator.test.mjs:291`.

**33. Configured current-release pointer**

Owner: `scripts/linux/operator.mjs`; F candidate write `:110`, rollback
`:126` after byte-hash CAS. JSON config path/hash (no numeric schema).
Readers: `runtime.mjs:8` validates immutable release tree/input pins;
`start-check.mjs:32` binds permit to exact bytes.
Operation exclusion + stopped ownership; pointer and binding changes are separate
writes protected by activation breadcrumb/start gate. Rehearsal seeds an isolated
pointer at `rehearse.mjs:44`. Evidence:
`tests/linux-operator.test.mjs:175`, `:246`, `:258`, `:312`.

**34. `dirname(dataDir)/backup-status.json`**

Writer/owner: `scripts/linux/recovery.mjs:142`, F at `:146`, mode 0644.
Unversioned lastRunAt/result/byteSize/lastSuccessAt; failed runs retain prior success.
Callers `operator.mjs:215`, `:224`, `:225`, `:248`;
`service-operator.mjs:116`, `:117`.
Reader module `app/storage/backup-status.mjs:58` does bounded unlocked reads,
sanitizes allowlisted metadata; operators also read it directly
(`operator.mjs:182`, `service-operator.mjs:60`).
Single operator serializes writes; status success follows verified backup
publication, but is not atomic with it. It is observability, not proof a backup
still exists. Evidence: `tests/backup-status.test.mjs:28`, `:40`, `:61`;
`tests/linux-multi-picker.test.mjs:362`.

**35. `dirname(dataDir)/backup-destination`**

Writer/owner: `operator.mjs:213`, `:221`, `service-operator.mjs:113`;
F mode 0644, unversioned text `managed\n`. Written under operator exclusion.
Reader `backup-status.mjs:60` bounded/unlocked; nonblank first line indicates
configured. It records configuration, not successful completion.
Legacy `backup.log` is an optional read-only fallback (`backup-status.mjs:67`,
`:73`); no writer exists in the audited server/Linux paths, so it adds no
written family. Evidence: `tests/backup-status.test.mjs:49`, `:76`, `:89`.

**36. Operation-owned scratch/probe/rehearsal trees and outputs**

Owners/writers: `files.mjs:61` generic verified copy (files `:67`),
`recovery.mjs:35`, `:50`, `:51`, `:96`, `:130`;
`online.mjs:27`, `:31`, `:32`; `service-recovery.mjs:28` F registry seed,
`:243`–`:245`, `:303`–`:305`, `:398`–`:399`;
`rehearse.mjs:36`, `:38`, `:42`, `:44` (new store, origin/config/pointer);
`probe.mjs:17` exclusive portable output; compatibility output delegated to
`scripts/private-companion/release-pack-check.mjs:249`.
Formats: preserved original schemas, portable backup schemaVersion 1,
unversioned compatibility digest report/config/pointer/text. Private new paths,
exclusive file creation/copy and input inventory validation; no general fsync
unless caller explicitly uses F/T. Probe child opens copied store through normal
owners and exits before another picker probe starts. Readers: only owning
operator/probe chain; recovery install stages retained in controlDir are instead
part of family 26/27. Cleanup `recovery.mjs:68`, `:113`, `:140`,
`online.mjs:35`, `rehearse.mjs:66`, `service-recovery.mjs:81`; interrupted
scratch may remain but is not a committed recovery or authorization source.
Evidence: `tests/linux-operator.test.mjs:92`, `:129`, `:334`;
`tests/linux-multi-picker.test.mjs:492`, `:529`.

**37. Optional `RS3_STARTUP_TIMING_LOG`**

Owner/writer: `app/startup-timing.mjs:16`; unversioned JSONL phase/pid/thread/at,
appendFileSync from server and calculator isolates. No lock/fsync/atomic record
transaction; concurrent appenders and partial tail are diagnostic concerns.
Reader: performance tooling, no gameplay or authorization reader.
Errors are intentionally ignored and do not affect startup (`:17`).
No crash durability contract or dedicated crash proof.

## Bypassing writers and existing call paths

The **seven live bypass entry points** counted above are:

| Entry point | Direct effect outside the owning API | Current required protection |
| --- | --- | --- |
| `app/storage/tombstones.mjs:9` reconcileTombstones | Removes complete picker tree `:20` and binding `:23` | Ledger committed first; fence/revoke, drain accepted writes, fsync parent, then advance purge |
| `scripts/linux/recovery.mjs:82` restoreStopped | Creates binding `:103` and all store files `:107` directly | Operator exclusion, stopped/released ownership, empty targets, verified source/probe; partial failure stays stopped |
| `scripts/linux/operator.mjs:93` deployStopped | Replaces binding `:108`, `:125` | Activation journal, stopped proof, byte CAS, forward/reverse compatibility checks |
| `scripts/linux/service-recovery.mjs:119` installPicker | Copies then renames complete store `:144`, `:163` and binding `:152`, `:168` | Destination-local fsynced staging; durable intent; exact digests; stopped service |
| `scripts/linux/service-recovery.mjs:175` quarantine | Moves store/binding `:182`, `:184`, writes live fence `:189` | Intent before effects; exclusive stopped operator; parent sync; no legacy quarantine |
| `scripts/linux/service-recovery.mjs:194` restoreServiceStopped | Installs live registry.json directly at `:329` | Journal previous/new hashes before F; repeated stopped/release proofs; reconcile live ledger |
| `scripts/linux/service-recovery.mjs:352` releaseServiceQuarantine | Removes live fence `:409`; delegates install; deletes quarantined store copies `:361` | Same operator/ledger proofs; install/cleanup journal; installed digest checks |

Replica writers also bypass owner serialization to create **images**, not live
records: raw snapshotStore, service copyGameplay/captureServiceCheckpoint,
publishServiceBackup, recovery.snapshot/backupStopped, captureOnline, rehearsal,
and service recovery's scratch seeding/probe copies (families 23–25 and 36).
A SQLite adapter must give these callers an export/copy capability; allowing them
to continue copying a live database pathname is not an equivalent implementation.

Current owner-API callers that must keep working include:

* Server boot/legacy import (`app/server.mjs:331`, `:392`, `:402`), sign-in
  provisioning/linking/session issuance, router capability index/unindex
  (`app/picker-router.mjs:196`, `:200`), picker deletion
  (`app/picker-router-deletion.mjs:30`), and shutdown draining (`:62`).
* Router cold admission and eviction (`app/picker-router.mjs:65`, `:45`);
  capture coordinator (`app/picker-router-checkpoint.mjs:33`), service roster
  and final exclusion reads (`service-checkpoint.mjs:111`, `:176`).
* Stopped operator backup/deploy/list/inspect (`service-operator.mjs:66`,
  `:138`; `service-recovery.mjs:334`), recovery planning/application
  (`service-recovery.mjs:15`), startup gate (`start-check.mjs:17`), and
  ownership repair (`service-operator.mjs:19`). Recovery revocations use account/
  invite owner APIs while deliberately stopped, without opening a gameplay store.

## Smallest proposed interface

Keep domain validation/authorization in the current owners. The trial needs an
implementation boundary, not a generic “execute SQL” API. These six operation
groups cover the existing calls; filesystem effects remain explicit because a
database cannot transactionally rename a picker directory.

| Operation group | Required result and guarantee | Existing caller mapping |
| --- | --- | --- |
| `open(scope, mode) -> handle; close(handle)` | Canonical scope and schema validation; exclusive writer/recovery ownership; read-only open never mutates; refuse unknown/missing authoritative ledger; close rejects new work and drains accepted work before releasing | openRegistry, store/sidecar owners, serviceOperation, assertServiceStopped, standby activation |
| `readView(handle, query)` | Detached committed account/picker/capability/deletion/journal/status view; tombstones dominate stale registry rows immediately; no subjects/capabilities in recovery projection; explicit fresh read for resume | Synchronous registry getters/router auth; operator list/inspect; startup gate and recovery resume |
| `commit(handle, command, expected?)` | Serialized validated domain mutation; uniqueness/caps and compare conditions checked inside transaction; resolve only after specified durability; publish caches/fences only after commit; uncertain failure closes/poisons handle; ledger reserve/delete/progress are explicit commands | Existing registry methods, owner sidecar mutations, backup status writes; preserve gameplay revision+receipt atomicity in its existing backend |
| `checkpoint(handle, projection, work)` | Queue-held stable metadata projection and ordered cut; per-directory write gate/drain with deadline; release on every failure; raw image versus sanitized service image explicitly selected; never abandon accepted writers or open dormant calculators | withRecoveryCheckpoint, router capture, snapshotStore/withDirectoryBarriers, service backup |
| `journal(handle, id, expected, next)` | Read/advance/finish/archive operation intent by identity and expected phase; durable intent before effects, exact backup/release/root/digest binding, idempotent resume and completion; startup obtains read access even when app cannot read controlDir | service restore and release journals; maintenance/activation/permit evidence (single-use consume is compare-and-delete); live registry replacement intent |
| `applyFiles(lease, intent, effect)` | Only named allocate/install/quarantine/purge/bind/publish effects; verify paths/ownership/bytes and target filesystem; fsync required data/parents before journal completion; re-run safely after crash; return an installed/exported digest | All seven live bypasses and image writers; current pointer CAS, retention copy-before-delete, ownership repair |

These are capabilities with typed domain commands/effects, not six global
transactions. `journal` can use the same commit primitive internally; its distinct
contract prevents callers from treating “row saved” as “filesystem work finished.”
An implementation may combine readView/checkpoint or lease APIs without weakening
their guarantees. It must not run arbitrary asynchronous filesystem callbacks
inside long-held SQL transactions. Capture metadata, release the database
transaction, then perform journaled per-picker work.

The first trial can adapt registry, external ledger and operator journals only.
Gameplay, sidecars and file products stay under their existing owners and
barriers. Seven bypass entry points must call applyFiles/registry installation
capabilities or an explicitly documented compatibility adapter; replica writers
must call checkpoint export. Direct list/inspect JSON reads become readView;
privileged start-check needs a small supported journal reader, not an import of
the full application or calculator.

## SQLite preservation and intentional changes

| Scope | Must preserve | What changes and must be made explicit |
| --- | --- | --- |
| Registry | Existing schema validation, identity uniqueness, one owned default, membership/capability scope, caps, detached reads, fail-closed startup/error behavior; reserve ID before filesystem provisioning; restart repairs reserved directory without ID reuse; sanitized recovery retains explicit IDs/memberships but drops identities/capabilities | Rows/constraints replace whole-JSON rewrites; SQL transaction replaces one-file R, not the entire directory saga. Existing synchronous in-memory lookup API needs commit-ordered cache publication/invalidation. Replace direct registry.json reads/write and byte-hash installation CAS with versioned projection/import plus a logical generation/digest |
| External ledger | Issued IDs never reused, account retirement, delete-before-cleanup ordering, immediate read filtering/fencing, idempotent purge including completed records; live ledger wins over every old checkpoint; no recovery initializes a missing ledger | Keep independent retention/restore domain (prefer separate database/path). Putting it in a DB restored with registry would resurrect deleted scopes. Two databases do not automatically provide one crash-atomic transaction, especially with WAL; preserve existing ordered ledger-first protocol. Define corruption/schema/missing-file checks before connecting, because SQLite connect may create an empty file |
| Recovery journals/control | Operation/backup/release/root identity, exact installed bytes and binding hash, previous/new registry acceptance, intent before any rename, complete only after fsync/verification, interrupted-resume behavior, startup refusal, quarantine cleanup after installed, dead-local-owner proof and ownership hand-back | SQL row update can replace F for intent but cannot atomically include directory/binding renames, pointer swap, chown, or deletion. Privileged start gate must read the new journal without app credentials; retain filesystem maintenance/permit compatibility until that gate changes. Define journal schema/version/migration and archival policy (currently unversioned), and digest compatibility for old pending intents |

For all three, select and record journal_mode, synchronous level, busy timeout,
checkpoint policy, SQLite version, filesystem assumptions and disk-full/error
handling. Verify the chosen commit mode provides at least the current R/F
durability before acknowledging. A database lock alone does not replace the
existing service/process ownership boundary or sidecar/snapshot gates.

A database pathname is mutable in place. Linux's raw snapshot algorithm pins
immutable replaced inodes; that assumption fails for a live SQLite database.
WAL state may span database, -wal and -shm files. Use SQLite's supported online
backup/export mechanism from a consistent read transaction (or close/quiesce
connections and prove a complete checkpoint before offline copy). Never copy only
the main file while writers run. Export a stable schema-versioned sanitized
registry document for service recovery; do not export the whole credential DB.
Keep the external ledger outside that artifact. Define how database side files,
ownership/modes, verifier allowlists, storage identity hashes, and restore import
are handled before enabling the trial.

## Acceptance evidence and remaining limits

The existing baseline checks are the tests cited per family, especially registry
provision/deletion process exits, deletion fence/drain tests, raw snapshot barrier
tests, and service interrupted-install/quarantine/start-gate tests. A backend
comparison must preserve their observable behavior and error/refusal boundaries.
Also exercise crashes before/after SQL commit, ledger commit before registry
update, every file-effect intent window, old-backup restore with a newer live
ledger, missing/corrupt ledger, concurrent operators/server startup, WAL backup
under writes, disk-full after commit/rename, and resuming old JSON journals.

There are no performance before/after measurements for SC1: only documentation
changes; no calculator/save benchmark was run. Quick-suite results are reported
with the handoff. No claim of host power-loss testing or complete real-process
crash coverage for service restore is made.

## Top three SQLite-trial risks

1. **Deletion resurrection:** restoring registry and tombstones together, silently
   creating a missing ledger DB, or publishing an auth cache before ledger commit
   breaks permanent retirement and immediate revocation.
2. **Incomplete backups:** raw file copies/open-descriptor snapshots of a mutable
   DB can miss WAL commits or mix registry/gameplay cuts; whole-DB exports can
   also leak credentials into sanitized service backups.
3. **Journal/filesystem split and startup ownership:** SQL commit cannot cover
   store/binding renames or quarantine cleanup. Losing ordered intent/digest
   checks, privileged start refusal, or compatibility with seven live bypasses
   can expose partially installed data or allow a second writer.

START `b42defc930df99262b36ade59b157b201f309145`; 37 durable file families;
7 bypassing live writers. The three risks are deletion resurrection, incomplete
backups, and journal/filesystem/startup ownership divergence.
