# Owned calculators: slice 7a (flag off)

Slice 7a implements calculator digest transport and audits catalogue copies.
`openStore` still defaults to `ownedFormat2: false`. No production caller, job,
environment variable or browser negotiation enables it. Slice 7b owns the
50-group acceptance harness and measurements. Slice 7c owns activation,
pinned-dataset preparation, retirement filtering and current-name display.
This change preserves existing calculator results, including retired references;
it does not activate semantic dataset upgrades.

## Calculator transport

Storage registers its verified base with its independently retained release pin.
`app/tasks/owned-transport.mjs` shares one wire encoding per verified base in the
server isolate. Calculation captures retain group facts plus the codec's task
and identity delta. They omit the same non-calculator fields as the existing
calculation projection, including ordinary History; random-start History keeps
its existing inclusion rule.

The internal `owned-delta-v1` request contains `ownedDocument`, with group facts
in `state` and the pinned reference/recipes in `storage`. It contains neither a
materialized task array nor a full identity dictionary. The first request for a
digest on a physical worker also carries `ownedBase: {pin, bytes}`. The worker
owns a bounded copy of those bytes and calls slice 1's hash-before-parse verifier.
The default limit is 128 MiB of canonical uncompressed bytes; structural limits,
UTF-8, generator version and all manifest dataset pins remain enforced. The
worker also requires its running dataset digest to match. Tests can lower limits.

Successful installation sends internal progress metadata, `ownedBaseInstalled`.
The pool records that digest on the physical slot; independent lanes and groups
then omit the installation. A nonpooled lane keeps the same knowledge until its
worker restarts. Retiring a slot discards its knowledge; replacement workers
verify their own installation. These caches contain hashes and immutable bases,
not group handles. Group closure does not own a worker's base lifetime.

Missing, corrupt or contradictory pins refuse the current request with
`OWNED_CALCULATOR_BASE_REFUSED` and an exact-base repair diagnostic. Installation
never selects another cached or newer base. A refusal does not replace an
already verified base. The scheduler preserves this diagnostic. Every owned
request carries its group facts and delta, so group correctness does not depend
on a previous group's snapshot. Existing picker-scoped result/snapshot admission
and cancellation remain in effect.

The codec's `{resident:true}` decoder expands the flat task pointer array and
shares frozen base rows. Identity dictionaries contain only replacements,
tombstones and exceptional order recipes over shared base key indexes. It does
not spread, clone or index the full identity dictionary. Receiver inputs are
already owned by the native message boundary; direct callers must supply an
owned document. Worker drafts clone group facts and share immutable catalogue
trees. Predictions still validate their complete logical state.

Format-1 and legacy-shared requests retain their existing object and
`json-shared-v1` message properties, omission rules and bytes. The plugin 1.0.0
and browser response schemas and meanings are unchanged. Full browser replies
still contain their existing catalogue data; slice 8 owns any negotiated change.

## Copy and cache audit

Locations below refer to the slice-7a implementation. Shared task indexes and
per-group flat task arrays remain allowed by the resident-state contract.
"Explicit" means the caller requested a detached flat document or invoked a
hook/transfer boundary; those working trees must be released after the operation.

| Location | Finding and disposition |
| --- | --- |
| `app/storage/store.mjs:531` | Fixed. Identity fingerprints stream exact logical JSON into a hash; only the digest is retained per immutable registry version. No full registry string cache. |
| `app/storage/store.mjs:333`, `app/storage/store.mjs:346` | Fixed. Owned response serialization streams sparse identity entries and avoids the format-1 full task-string cache. It never creates a detached full identity object. |
| `app/storage/store.mjs:548`, `app/play-view.mjs:44` | Fixed. Ordinary play projection reads sparse dictionaries directly. It materializes only the identities referenced by the existing display projection. |
| `app/storage/store.mjs:625`, `app/picker-context.mjs:654`, `app/tasks/scheduler.mjs:923` | Fixed. Native calculation captures and all worker lanes send group facts/delta. Prediction prewarm clones only group facts and shares the immutable catalogue. |
| `app/storage/store.mjs:668`, `app/storage/store.mjs:1324` | Fixed. Pool preparation and roll commands consume resident state directly. No full calculator-boundary clone. |
| `app/core/planning.mjs:114`, `app/tasks/area-check.mjs:37`, `app/core/resident-copy.mjs:29` | Fixed. Prediction validation and area scenarios detach group facts while sharing base identities/rows, including spread sandbox drafts. |
| `app/core/travel-inputs.mjs:24`, `app/duo-play-view.mjs:16` | Fixed. Travel proofs and peer projections resolve sparse aliases with the same candidates as flat transport. |
| `app/tasks/unlock-reuse.mjs:17`, `app/tasks/warm-results.mjs:44` | Fixed. Reuse and optional warm-result hashes stream the same logical JSON as flat state; sparse input does not silently disable warm keys. |
| `app/picker-context.mjs:376`, `app/tasks/identity.mjs:182` | Fixed. Owned ID responses build only the queried identity's layers/reverse aliases and historical mappings, then release the index. Full aliases and mapping sources are scanned, without a per-group full Map or historical-label table. Semantic fallback checks omitted sources; prefix scans preserve suppression of repeated historical mappings before a target joins an alias. Scan cost remains for 7b. |
| `app/picker-context.mjs:1210`, `app/picker-context.mjs:1462`, `app/picker-context.mjs:1480`, `app/picker-context.mjs:1549`, `app/storage/store.mjs:1572` | Fixed. Ordinary XP, migration, roster and overlay reads use resident copies instead of flat snapshots. |
| `app/storage/store.mjs:1678` | Fixed. Plugin currency observations and coalescing share the catalogue and omit an unused full command-result snapshot. Fields and publication semantics are unchanged. |
| `app/storage/owned-codec.mjs:36`, `app/core/resident-copy.mjs:57`, `app/tasks/identity-dictionary.mjs:87` | Shared by base. Row JSON/indexes, dictionary roots and key arrays are weakly keyed by the single frozen base. Delta caches are weakly keyed by immutable group versions and retain only deltas. |
| `app/tasks/identity.mjs:12` | Shared by dataset/isolate. Authored entry, alias, entity and source Maps are module-level read-only indexes, never rebuilt from each group's base. |
| `app/core/state.mjs:1182`, `app/tasks/fact-projection.mjs:31` | Allowed indexes. Core task Maps follow per-group flat task arrays; calculator catalogue alias/category indexes follow the shared engine catalogue. Identity validation caches are WeakSets, not full per-group identity indexes. Charge these graphs in 7b. |
| `app/tasks/identity-dictionary.mjs:120` | Explicit imported enumeration recipe. A nondefault order can require a full key array and a temporary validation Set. Default base-order groups allocate neither. Measure exceptional recipes separately in 7b. |
| `app/storage/owned-codec.mjs:76`, `app/storage/owned-codec.mjs:114`, `app/storage/store.mjs:442`, `app/storage/store.mjs:208` | Explicit cold load/import normalization. Flat decode, complete validation and reconciliation can temporarily own a full dictionary. The resident result keeps sparse dictionaries. This is outside the ordinary command/request path; 7b must measure open peaks. |
| `app/storage/store.mjs:770`, `app/storage/store.mjs:1125`, `app/storage/store.mjs:1141`, `app/storage/store.mjs:1217` | Explicit hooks. Unproven preparation/migration hooks and fallible commit hooks still receive detached complete flat state. Prepared proofs avoid this work on current ordinary commands. A configured full hook remains an explicit full-copy cost for 7b to charge. |
| `app/core/state.mjs:672`, `app/core/state.mjs:679`, `app/core/state.mjs:744`, `app/tasks/identity-dictionary.mjs:160` | Explicit public validation/materialization and rare alias normalization. Untrusted input retains complete logical validation. These APIs intentionally produce detached flat JSON. |
| `app/storage/store.mjs:1186`, `app/storage/store.mjs:1292`, `app/storage/store.mjs:1549`, `app/storage/store.mjs:646` | Explicit compatibility snapshots: `getState`, object-returning `command`, conflict snapshots and the calculation capture's `.state`/`.stateJSON` getters still promise detached flat JSON/bytes. Ordinary HTTP commands use `commandSerialized`; native calculators use `.owned`/`.residentState`. Compatibility callers must not retain these trees as group caches. Count their use in 7b. |
| `app/core/planning.mjs:49`, `app/core/planning.mjs:64`, `app/picker-context.mjs:1711`, `app/picker-context.mjs:1729`, `app/picker-context.mjs:1755` | Explicit rule-profile and progress/original-picker previews retain flat validation/import working trees. They are user-invoked transfer/review operations, not automatic calculator requests. |
| `app/storage/store.mjs:296`, `app/storage/store.mjs:725`, `app/storage/store.mjs:1543`, `app/storage/store.mjs:1608`, `app/storage/store.mjs:1841`, `app/storage/store.mjs:1859`, `app/storage/store.mjs:1876` | Explicit portable backup/checkpoint, import publication, replacement and restore. Complete snapshots and reviewed worker publications remain detached and bounded to the operation. |
| `app/import-worker.mjs:86`, `app/save-transfer.mjs:65`, `app/original-paste.mjs:139`, `app/integrations/original-tasks.mjs:18` | Explicit import/transfer identity remapping. These lanes may build full identity indexes and clone complete flat state. No such index is retained by an ordinary owned context. |
| `app/tasks/migration.mjs:539`, `app/tasks/migration.mjs:757`, `app/tasks/migration.mjs:933`, `app/core/state.mjs:1143` | Explicit initial migration, identity normalization and replacement review. Complete identity indexes, reference Sets and registry JSON comparisons belong to these detached import/migration trees. Ordinary resident commands use the prepared validation path. |
| `app/storage/owned-rebase.mjs:33`, `app/storage/owned-rebase.mjs:160`, `app/storage/owned-rebase.mjs:215`, `scripts/linux/inflate-owned-format-1.mjs:25` | Explicit stopped-writer rebase/upgrade and rollback inflation. Complete logical documents, ordered History and frozen-loader comparisons are required here. Existing bounded-operation contracts apply. |
| `app/storage/store.mjs:713`, `app/storage/store.mjs:1555`, `app/picker-context.mjs:284`, `app/picker-context.mjs:308` | 7b measurement. Unnegotiated full HTTP response bytes and existing display/claim projections can still scale with the catalogue. Response-cache buffers obey the response budget and are released/evicted by that cache. Slice 8, not 7a, changes wire representation. |
| `app/tasks/snapshot-cache.mjs:23`, `app/tasks/snapshot-cache.mjs:133`, `app/tasks/worker.mjs:191` | 7b measurement. Existing result graphs, temporary V8 sizing buffers, task arrays/indexes and worker snapshot accounting still need retained-heap attribution. V8 serializes opaque dictionary wrappers without their hidden base, so its state-size estimate alone cannot prove the memory budget. The acceptance harness must charge the shared base and sparse hidden graphs. |

Ordinary response bytes necessarily contain full data for unnegotiated clients.
The audit removes redundant identity trees and retained dictionary-string caches;
it makes no 50-group retained-heap or throughput claim. Rare full API snapshots
and configured full hooks remain visible costs, not evidence of bounded residency.

## Migration currency and verification

`app/server.mjs:320` calls `hasCompleteMigrationCatalogue`, which constructs its
membership Set from every row in the complete logical `state.tasks` array. A
matching dataset/base digest or a delta containing only changed rows cannot
satisfy this check. Owner, alias, journal and registry checks remain unchanged.

`tests/owned-calculator.test.mjs` compares all state-bearing calculator request
types against full-state transport using a synthetic owned group with generated,
custom, assigned, deleted and retired-referenced rows, aliases and exact Undo
preimages. It compares ordinary results, full/play shared bytes, peer projections,
Preview prepared/final replies and unlock-reuse bytes. A fixed diagnostic clock
makes output comparisons deterministic; no duration or memory threshold decides
success. Separate cases cover process relay, pool sharing, exact fingerprint and
display equivalence, corruption/missing pins, lower byte bounds and migration
currency. `tests/owned-cache.test.mjs` covers plugin-currency coalescing and
contradictory installed pins.

The opt-in counting seam records full identity materializations and flat
dictionary copies. Tests require zero across serialized commands/Undo, ordinary
full/play responses, native pooled requests, receiver reuse and plugin currency
observations. This detects copy regressions without timing or heap assertions.
`tests/owned-lookup.test.mjs` compares ordered historical aliases against a full
index and counts narrow index entries as unrelated mapping/catalogue rows grow.
`tests/owned-lookup-order.test.mjs` covers repeated mapping pairs, later targets,
multi-step chains and cycles without changing historical alias order.
The flat compatibility snapshot, import, export and stopped-writer lanes are
outside that zero-copy assertion and are listed above for later measurement.
