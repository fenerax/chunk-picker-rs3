# Owned storage codec: slice 3 (flag off)

`openStore` defaults to `ownedFormat2: false`. No production caller, environment
variable or startup profile enables it. The legacy-shared context continues to
use its existing always-resident, format-1 path. Opt-in requires an explicit
object with an owned `pickerId` (never `legacy-shared`), external `catalogueRoot`,
release `dataset`/`manifest`, and optionally exact pinned `releaseBytes` for
initial publication. The root must be outside picker trees and their deletion
roots; the caller owns service-level placement. Lexical and realpath overlap
with the individual picker is refused. Completion-codec encoding must be off:
the envelope and logical schema remain 1, while **storage.schemaVersion is 2**.

With the flag off, format-1 field loops, bytes, static references, retention,
metadata validation and hooks retain their existing adapters. Storage-2 and
unknown storage versions fail the existing static-metadata check. The frozen
rollback release `06e15939` also requires storage schema 1 and refuses storage-2
metadata before reading gameplay. It cannot mistake a delta for a full save.
The rollback pin is unchanged; direct old-release opening is unsupported until
slice 6 inflates every owned save and retained snapshot to format 1.

## Representation and boundaries

`owned-codec.mjs` stores group payload in `state`, with no tasks/identityRegistry.
`storage.base` has only `datasetDigest`/`sha256`. `storage.delta` contains root
field-presence/order keys, full task replacements keyed by ID, an ordered recipe
of `[start,count]` base spans and replacement IDs, and registry presence/header,
unresolved discoveries and dictionary deltas. Dictionary deltas contain full
replacements, deleted base keys and an optional explicit logical key order.
Absent and empty registries differ. No ordering is inferred by sorting; complete
row JSON (including property order) decides whether a row can be stripped.
Duplicate/unused task rows, invalid spans, unknown metadata and malformed order
or presence recipes refuse. Optional schema-1 field references remain available
for group-owned legacy/provenance only.

Every open validates the complete inflated logical state, including Undo, before
sharing the verified frozen base through slice-2 resident dictionaries/flat task
arrays. Hook proofs keep their existing contract and see complete tasks and
hydrated History. Fallible hooks, public snapshots, exports and existing worker
boundaries receive detached flat JSON. Archive hydration owns events before
coordination cancellation/validation. Commands use resident copy boundaries;
there is no new History or Redo format (Redo reapplies the original command).
Shared base indexes/encoding and weak per-version delta caches prevent ordinary
payload writes from serializing/hashing or rewriting the complete base. New task
arrays are scanned to form spans; touched nonbase rows retain exact JSON. No
per-group full identity dictionary/string cache is introduced. Current full
calculator/display boundary materialization remains a slice-7 optimization gate.

## Publication and recovery

`owned-storage.mjs` verifies release pins and uses the slice-1 bounded,
hash-before-parse cold reader. Only verified root/hash opens populate its cache;
one parsed base/encoding is shared per hash/isolate. A missing/corrupt referenced
base refuses the affected group with the exact-base repair diagnostic, even if
release bytes were supplied. Startup never seeds an empty replacement or repairs
corrupt bytes. There is no newest-base fallback.

Owned mutations hold a catalogue-root lease through preimage and reference
publication. In-isolate publishers queue and deduplicate; a competing process
fails closed on the kernel lease rather than publishing concurrently. New root
edges and their ancestry are synced. Each attempted command first retains its
own uniquely named durable compact preimage. The state temporary is synced,
then the existing fallible hook runs, dependencies are durably published, and
the verified base is published before the state rename/parent sync. Only then
do current memory, receipts, notifications and the response advance. Receipts
remain in that same authoritative replacement. Dependency sync failures are
strict; state-parent sync retains the existing durability-warning/adoption rule.
The injected `crash(point)` covers root creation, preimage, state temporary,
hook completion, base temporary/publication, dependencies, state rename/sync
and memory publication. These callbacks are test seams, not application hooks.

Collection remains absent/disabled: no base or static-field unlink is added.
Slice 4 owns artifact/capture/off-site dependency closure, restore/verifiers,
capture barriers/manifests and deletion recovery. Slice 5 owns explicit rebases
and dataset upgrades; slice 6 owns the stopped-service inflater and actual frozen
loader rollback verification. Slice 7 owns digest calculator transport, full
cache/residency audit and 50-group acceptance. Browser negotiation and exclusive
mark/sweep closure verification remain slices 8/9. This slice authorizes no
activation, real-save migration, repair, backup-completeness or residency claim.
