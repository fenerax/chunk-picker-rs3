# Owned save format 2

Design proposal, 2026-11-10. Source baseline: `605d37c53b323acf0a4a4455554a5d28b549bac0`.
Everything below is proposed unless labelled **Verified**; **Inferred** marks estimates.
Scope: synthetic owned pickers only. `legacy-shared` keeps its current storage,
startup and rollback path. Keep rollback pin `06e15939`; no implementation or rollout
is authorized by this document.

## Evidence and decision

**Verified:** static sidecars cover tasks, identityRegistry, legacy and provenance
(`app/storage/store.mjs:266`). Changed fields serialize/hash as whole values
(`app/storage/store.mjs:402`, `app/storage/store.mjs:420`); no pruning exists
(`docs/storage-contract.md:312`). Assignments and custom tasks belong to groups
(`app/core/state.mjs:225`, `app/core/state.mjs:246`). Generated-goal registration
copies catalogue/identity containers (`app/core/state.mjs:1150`,
`app/core/state.mjs:1173`). Completion is member data (`app/core/state.mjs:699`).

The supplied 15 MB/96% split is **unverified**. Historical measurements describe a
different, much larger migration-heavy state (`docs/backup-import.md:70`); they
cannot establish today's synthetic footprint. Do not size heap from JSON bytes.

Choose **sparse identity dictionaries over one immutable shared base**, retaining
flat task arrays and today's History/Undo semantics. The [memory spike](../perf/format2-memory-spike.md)
compared format 1 (A), flat sharing (B) and sparse identities (C). **Verified:**
[`format2-memory-spike.yml`](../../.github/workflows/format2-memory-spike.yml),
[CI run 42812885144](https://github.com/fenerax/chunk-picker-rs3/actions/runs/42812885144)
ran five fresh comparisons on each of Ubuntu and Windows: only C met the 5 MiB
target, 10/10 runs (about 2.9 MiB/group p50, max ≤3.36 MiB); final logical-state
and ordered History hashes matched across all variants/runs. The full layered
`CatalogueView` is not justified. Full server contexts remain a slice-7 gate.

## Disk representation

Configure one service `catalogueRoot`, outside picker trees and deletion roots.
Store `catalogue-<sha256>.json.gz` there. Its decompressed, minified UTF-8 JSON is:

```text
{baseFormat:1, generatorVersion:1,
 dataset:{id,contractVersion,digest}, tasks:[...],
 identityRegistry:{schemaVersion:1,entries:{...},aliases:{...},unresolved:[]}}
```

Build solely from pinned release dataset/catalogue/identity inputs, without members,
saved registries, clocks or runtime discoveries. Existing authored/index builders
provide inputs (`app/tasks/identity.mjs:171`, `app/tasks/identity.mjs:179`), not a
promise that their current output is already canonical.
Use the pure catalogue projection of fresh owned preparation as the base; potential
generated tasks stay a lookup surface until registered, as today
(`app/tasks/migration.mjs:113`). Do not inflate every group with unused goals.

Specify builder insertion order, alias candidate order and serializer fixtures;
hash the exact decompressed bytes, without trailing newline, using SHA-256. Gzip
encoding is outside that identity. The release manifest maps each dataset digest
to exactly one base hash and builder version. A projection change requires a new
dataset digest. Rebuilding identical inputs must produce identical bytes.

The group's existing envelope/schema remains 1; **storage.schemaVersion** becomes
2. `state` contains every group-owned field except tasks/identityRegistry. Storage
contains `base:{datasetDigest,sha256}` and `delta`:

- Full replacement/additional task rows, keyed by ID, including assignments,
  custom tasks and registered generated goals. Compare complete row JSON before
  stripping; preserve property order because Undo compares JSON strings.
- An ordered task recipe of base spans `[start,count]` and delta-row IDs. Default
  is one whole-base span; omissions delete rows. Overrides replace a base row at
  its slot. Reject duplicate IDs and invalid ranges. Never infer order by sorting.
- Identity entry/alias replacements, deleted-key lists, group `unresolved`, and
  presence markers. Optional span/key recipes preserve dictionary enumeration
  order when default base order plus appended keys differs from the source.

Record presence versus empty values exactly. Group-specific legacy/provenance
remain group-owned; existing schema-1 static references may store those fields.
No completion, assignment or custom row enters a shared base. Paths are derived
from validated hashes, never supplied by a save.

## Resident state and contracts

Use immutable sparse identity entry/alias dictionaries over the shared base;
preserve lookup, alias candidate order and logical key enumeration. Keep ordinary
flat task arrays and core's existing task indexes. Storage owns base discovery,
integrity and sparse encoding. Inject filesystem/release-input edges for tests.
The spike's Proxy is throwaway, not a production interface.

Make clone boundaries explicit in slice 2. Read-only validation, archive hydration
and unchanged command snapshots may share a group's immutable identity view and
frozen base rows/entries/alias arrays. Clone group payload and History/events at
those boundaries. On catalogue edits, copy the flat task array and touched row;
on identity registration/alias edits, create a new sparse dictionary version and
copy only touched entries/alias arrays. Earlier snapshots and other groups must
remain unchanged; never spread a full identity dictionary. Audit every whole-state
`structuredClone`/JSON clone, including validation (`app/core/state.mjs:652`),
Undo and hooks; explicitly materialize detached flat JSON for portable import/
export/rollback and callers requiring it, then release those bounded working trees.

Validate the shared base once per verified hash, then each group's complete logical
state and Undo invariants; sharing must not skip validation. Untrusted imports
cross complete logical validation. Preserve **History/Undo exact-preimage**
semantics unchanged: identical row JSON, indices, guards and event bytes/order,
including archived events (`app/core/state.mjs:574`). No new History representation.

One parsed frozen base and shared base encoding per digest per isolate. Flat task
arrays/indexes remain per-group; identity lookup/key indexes are shared, with no
per-group full identity Map/Set/string caches. Per-group hot
History stays bounded through archives without discarding events. Calculators
remain pooled independently of open group handles. **Inferred budget:** about
5 MiB retained heap/group, including dictionaries/caches; 15 MiB is a rejection threshold,
not permission to evict groups during the acceptance test. This is unproven until
the complete 50-group server-context test passes.

Coordinate with the separate `prepared()` fast-path work
(`app/storage/store.mjs:656`, `app/game-profile.mjs:60`, `app/server.mjs:464`).
Consume its resulting hook contract without replacing it. Migration currency
must count the complete flat task array, not delta rows: today's check requires
every catalogue ID (`app/server.mjs:317`). A digest stamp alone proves neither
membership nor valid migration.

## Integrity, publication and collection

On each cold base open, bound decompression, check realpath containment, hash
decompressed bytes, validate schema and match all dataset pins before caching.
Existing static loading follows that hash/location pattern
(`app/storage/static-field.mjs:14`). Missing/corrupt bases fail only affected
groups closed with a repair diagnostic; never seed an empty save or select the
newest base. An explicit repair can rebuild from the exact retained release
inputs, or restore a verified backup copy. A different hash is refusal. Corrupt
bytes remain available for diagnosis until repair replaces them.

Serialize group writes under existing ownership/revision queues. Normal commands
write group payload/delta, a compact uniquely named preimage, and any new History
segment. They neither serialize/hash nor rewrite the whole base. Generated ticks
write their added rows/identity edits. Cost is O(group payload + delta + hot
History), not necessarily O(one command). Export, import, rebase and portable
pinned checkpoints may scan the catalogue.

Preserve publication order: durable preimage before the fallible commit hook;
sync state temporary; hook; publish/fsync dependencies; rename state and sync
parent; publish memory/receipts/notifications/acknowledgement. Receipts remain in
the same authoritative replacement. Current seams are
`app/storage/store.mjs:1145`, `app/storage/store.mjs:1103` and
`app/storage/atomic-write.mjs:7`. Current parent fsync exists
(`app/storage/publication.mjs:28`); the older description in
`docs/storage-contract.md:55` is stale. Dependencies use strict sync failure;
post-state-rename failure retains today's published-but-durability-uncertain
warning behavior. Include directory creation/ancestry sync for new base roots.
Concurrent publishers deduplicate by verified hash under a catalogue-root lease.

Collection uses mark/sweep, never an authoritative reference count. Roots include
current saves, standalone and packed retained backups, pinned checkpoints,
quarantine, pending publication/recovery intents and in-flight captures/jobs.
Each retained artifact owns its complete dependency closure. Hold a root lease
across base publication and reference commit/capture; GC takes exclusive admission,
drains writers, scans roots and rechecks before unlink/fsync. Unreadable roots
abort collection. Apply the same rule to old per-group static sidecars. Ship GC
disabled until closure verification exists; orphans initially cost disk only.

## Dataset changes

Never rebase merely because the running release is newer. Explicit upgrade first
verifies old/new bases, captures a pinned preimage and stages the entire result.
A storage-only rebase must inflate identically, including row/order and History
hashes; differences from the new base become overrides/omissions.

A semantic dataset upgrade is a separate reviewed migration in that transaction.
Keep existing task slots; append new catalogue rows. Preserve exact old rows while
any live/archived Undo guard needs them; display current names through catalogue
metadata rather than rewriting historical JSON. Retain removed rows and alias
candidate order wherever members, History, Undo or backups reference them.
Persist retired IDs as additive provenance; calculators exclude them from new
obligations but History/Undo can resolve them. Never recycle IDs or guess ambiguous
renames. Reorder, identity reassignment, or full-catalogue Undo snapshots that
would erase appended rows require an explicit migration/Undo-boundary decision
(`app/core/state.mjs:1418`), not automatic rebase. Publish binding, base
reference and migration result through resumable intent; interruption keeps the
group unavailable until reconciled. Backups retain their original base.

## Transfers, recovery and responses

Schema-1 portable export still embeds the full validated logical state
(`app/core/state.mjs:983`), including hydrated History and optional evidence.
Inflate on export; validate the complete incoming document before stripping only
byte-identical base data on import. Preserve differing custom/retired rows and
aliases. Keep dataset, roster, preview and replacement-boundary checks.

Retained preimages may reference bases; portable pinned snapshots remain complete.
Service/raw/per-picker backup and online capture must copy the transitive closure
of each captured document, including packed backups and History dependencies.
Copy bases once per artifact, verify before manifest/complete publication, and
hold capture leases through publication. Current per-picker tree copying cannot
discover an external base (`scripts/linux/service-checkpoint.mjs:76`). Update
backup format/verifiers and restore together. Restore verifies and installs bases
before group references. Off-site delivery includes that closure and verifies its
restored contents before success, extending the existing whole-snapshot check
(`docs/linux-offsite-backup.md:20`). Each off-site snapshot retains its own bases.

Provide stopped-service `inflate-owned-format-1`: stage each owned store and every
format-2 retained/packed snapshot, resolve base/static/History dependencies, emit
format-1 envelopes with embedded tasks/identities, preserve compatible private
receipts/coordination/plugin metadata and optional evidence, and remove storage-2
metadata. Verify logical/History hashes and actual `06e15939` loading before
journaled installation. Resume by source/output digests; insufficient space or
missing dependencies refuses without replacing source. Preserve pre-conversion
copies. Convert all owned stores before starting the old release; never touch
`legacy-shared`. The pinned loader rejects unknown storage metadata (**Verified**
against `06e15939:app/storage/store.mjs:409`).

Calculators can install a verified base once per digest/isolate and accept only
group facts plus delta thereafter. Shared bytes do not imply shared parsed heaps.
Browser clients may opt into digest-addressed catalogue responses with ETags and
group deltas; authenticate dataset access and send only public catalogue fields.
Keep existing full responses for clients without negotiation. Plugin 1.0.0 receives
its existing fields/meanings; any extension is optional and additive
(`docs/plugin-api.md:24`). Catalogue fetches are never a plugin prerequisite.

## Acceptance tests and measurement

Use only isolated synthetic fixtures outside `.local`; no private inputs.

- Format 1 → 2 → inflate: deep equality plus ordered row/event JSON and History
  SHA-256, including generated/custom/assigned/deleted tasks and dictionary order.
  Replay commands/Undo against both adapters; compare errors, revisions and hashes.
- Crash exits and injected I/O failures before/after preimage, hook, dependency
  fsync, state rename/parent sync, backup completion, rebase binding publication,
  GC mark/unlink and rollback installation. Reopen observes old or complete new
  state, never missing dependencies; refusals retain distinct preimages.
- Missing, corrupt, wrong-dataset and path-escaping bases; exact rebuild succeeds,
  different rebuild refuses; concurrent publish/capture/GC remains safe.
- Rebase rename/removal/alias collision and Undo indices, including archived
  guards; portable export/import round-trip; restore into an empty catalogue root;
  packed backups/off-site closure; actual frozen-release rollback replay.
- Deletion fences/drains before purge; shared bases survive other groups and
  backups. Restoring an old backup cannot override live tombstones. Existing
  ordering is `app/storage/tombstones.mjs:9`; new GC never edits that ledger.

Extend the retained-heap approach (`scripts/perf/picker-footprint.mjs:133`) in a
new synthetic-only harness. Run Node 24.20+ on Linux and Windows, BelowNormal and
one worker/lease per `docs/testing.md`; record commit, runtime, host and fixture
seed. Warm one shared runtime/base, force GC and record baseline. Open **50** groups
sequentially without closing earlier handles or dropping sessions. Sample each
increment and totals at 1/10/25/50 after GC. Repeat with distinct generated goals,
assignments, custom rows and realistic archived History; run ticks/notes/Undo and
calculator requests across all groups, then settle/GC without eviction.
Pin a substantial synthetic shape: 24,000 tasks, 100,000 aliases, four members and
1,000 events per group, plus archived segments. Include a simultaneous-request
round with all 50 handles retained; an idle-only pass is insufficient.

Report per-group retained heap deltas/slope and p50/p95/max open/command wall/CPU
time across five fresh-process runs. Include total heap, RSS, external/array-buffer
bytes and child heaps/RSS; charge shared base/runtime separately once. Measure
temporary peaks and bounded export/rebase lanes separately. Target ≤5 MiB/group;
reject any attributable retained group >15 MiB, aggregate >750 MiB above shared
baseline, or growth with each repeated command. Record fsync counts, bytes written
and base-write count (zero after initial publication). Do not claim success from
averages or tiny-catalogue fixtures.
Use synthetic heap snapshots/dominators to attribute outliers; target total group
heap ≤250 MiB. Compare time/write counts against format 1 on identical fixtures.

## Implementation slices

Estimates include tests and contract documentation; sizes are changed lines,
excluding fixtures. Each row is a separate PR; activation waits for slices 1–7.

| PR | Size | Deliverable and contracts touched |
| --- | --- | --- |
| 1 | M, 250–450 | Deterministic base builder, pins, bounded verifier; dataset identity/storage schema. No writer enablement. |
| 2 | M–L, 350–650 | Sparse identity dictionaries, touched-entry edits and explicit clone/materialization boundaries; flat task arrays; differential validation/command/History/Undo tests preserving exact preimages. |
| 3 | M, 300–500 | Owned codec, sparse writes, preimages and crash seams; storage publication/receipts and prepared-hook integration. Flag off. |
| 4 | L, 550–850 | Backup/capture/off-site closure and restore/verifiers; snapshot barriers, manifests, deletion recovery. |
| 5 | M, 300–500 | Lossless rebase and explicit dataset-upgrade staging; binding/migration/Undo contracts. |
| 6 | M, 300–500 | Format-1 inflater, resumable install and frozen-loader checks; rollback/save-surface contracts. Pin unchanged. |
| 7 | M, 300–500 | Calculator digest transport, shared-cache audit, 50-group acceptance; scheduler/resource contracts. Then synthetic activation. |
| 8 | M, 250–450 | Negotiated browser catalogue responses; HTTP/client cache contract, plugin additive-only check. |
| 9 | M, 250–450 | Lease-protected base/static GC; retention/backup closure and tombstones. Enable separately. |

P1 risks name the contract they break: row/order drift breaks **History/Undo exact
preimage**; incomplete closure breaks **self-contained backup/restore**; early
dependency deletion breaks **ordered durable publication**; restored deletion
metadata breaks **tombstone precedence/non-resurrection**; direct old-release open
breaks **frozen rollback compatibility**; per-group full dictionaries/calculators
break **50-group residency budget**. Each requires its acceptance case before activation.

Owner questions, non-blocking for this proposal: Is retaining old saved wording
while Undo needs it acceptable? What cold-open and command p95 time limits should
be required alongside the fixed memory limits? Storage-2 rollout and any real
picker migration require a later explicit go-ahead.
