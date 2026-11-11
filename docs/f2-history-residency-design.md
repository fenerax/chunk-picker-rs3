# History residency: implementation stopped at the compatibility boundary

The requested hard History bound cannot be added to the current resident state
without changing a reply or a save. The implementation therefore stops at a byte
ledger. History remains an explicit blocker for steady-state certification.
No History load behavior, retention policy, save or wire format has changed.

## Why ordinary cache eviction is insufficient

`app/storage/store.mjs` exposes `current.history` and
`current.provenance.historyArchive` directly through synchronous `getState`,
`getReadState`, `getStateJSONParts`, `getHistory`, `getRecentHistory`,
`getHistoryEvent`, `getUndoEligibility` and the state serialization path.
Removing an event from that array changes those results even when an archive
still contains the event. Removing a reference changes serialized provenance
and removes a dependency used by `hydrateHistory`, `visitHistory`, backup and
restore. The existing readers deliberately ignore unreferenced interrupted
archive writes; scanning every file would change that recovery rule.

`compactHistory` is a retention policy, not a byte cap. It preserves the pending
roll, the latest Undo target, and the transitive suffix of Undo markers and their
targets. Either a protected event or the suffix can contain an arbitrarily large
payload. Further compaction would change active History replies and saved bytes.
Discarding inverse data would change what Undo can reach. The reference array can
grow with every new segment. `provenance.restore.previousHistory` also preserves
the preceding live chain and cannot be silently dropped.

Load preparation has a separate constraint. `prepareLoadedState` hydrates and
validates complete archived History before currency predicates and preparation
hooks run. Those hooks receive complete History today. A bounded page iterator
would change their contract. The task requires a default-off option for every
History load-path behavior change, and enabling it requires owner approval.

## Proposed follow-up, requiring a separate decision

Keep `historyResidency` off by default. Before enabling it, provide a private
residency layer with a bounded payload cache and a bounded archive-reference
window. Preserve an exact durable preimage before releasing any object. The
layer must distinguish committed references from interrupted files, preserve
reference order and event overrides, and recover after a crash between writing
the preimage and publishing a new resident view.

Every synchronous consumer listed above must first be made able to read that
layer without returning a partial array. Serialization must emit the exact old
bytes, including reference names/order and active-versus-archived placement.
Undo must load the same target and apply the same guards. Preparation hooks need
an explicit compatible mechanism to consume complete History. A design that
cannot meet these requirements needs an owner decision about the changed
contract before implementation.

Tests must compare every affected reply and saved byte sequence with the option
off and on. They must cover pending rolls, large inverse payloads, transitive
Undo suffixes, archived overrides, restore provenance, crash recovery, repeated
eviction/reload and Undo of an old archived event. The present tests establish
existing archive reload and Undo behavior after closing/reopening a store; they
do not claim a newly bounded History implementation.

Decision reference: owner decision, 2026-11-11.
