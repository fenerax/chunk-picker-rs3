# Owned rebase: slice 5 (flag off)

`stageOwnedRebase` and `reconcileOwnedRebase` in `app/storage/owned-rebase.mjs`
are explicit stopped-writer APIs. No production caller, job, environment flag or
startup path invokes them. `ownedFormat2` remains off. Live writer ownership
refuses migration; group admission precedes the existing catalogue lease, so
capture drains or precedes the complete transaction. No GC is implemented.

Opted-in readers select the save's pinned reference, never the running release's
current base. Operators supply independent `retainedManifests` for older bases,
including two release manifests when the same dataset digest has different base
bytes. Backup reads cannot change the writer's selected base. Startup refuses
preparation that would change an existing owned save instead of auto-upgrading it.
Format-1 and legacy-shared adapters retain their prior paths and bytes.
Backup closures with several pins for one digest add `retainedManifests`.
Closures from before this change containing only a single `manifest` still
verify unchanged; no format-1 artifact or path adopts this extension.

Staging verifies the old base and the target's pinned release bytes or existing
file, validates complete hydrated History/Undo, and retains a unique pinned gzip
preimage with the original base. Full state, binding and source bytes are staged
and synced before a hash-pinned intent is published. Storage-only rebases require
equal catalogue content (representation/order differences allowed) and exact
inflated logical JSON, deep equality, ordered rows/dictionaries/events and History
SHA-256. New-base differences become overrides or omissions. Backups are untouched.

An intent blocks owned opens, including import/capture readers. Explicit commit
reverifies dependencies and staged/source hashes, publishes/syncs the base before
the binding and state, then clears/syncs the intent. Any interruption after intent
publication requires explicit reconciliation; source or result hashes permit
resumption across either rename. Explicit abort restores the original binding and
state. Pre-intent interruptions leave the old group usable. Pinned preimages and
staging evidence remain on disk. Missing/corrupt/wrong-dataset bases refuse.

`upgrade: true` uses the separate `stageOwnedDatasetUpgrade` migration. Existing
slots and exact saved rows/identities stay intact; only new catalogue rows append.
Removed IDs accumulate in `provenance.ownedCatalogue.retiredIds`, even when a row
is no longer live. New names live in catalogue metadata, never historical JSON.
Removed rows, identities and old alias candidate order remain available. Ambiguous
alias changes use an exact-JSON three-way comparison: an unchanged release keeps
the group's value and order; a changed release replaces only an untouched group
value. New aliases are added unless the group already has a different value.
When both changed, staging retains the group value and commit requires an explicit
alias migration decision; candidate lists are never merged. Aliases removed from
the release remain retained. Reorder,
ID reuse/reassignment, changed task semantics and any live/archived full-catalogue
Undo snapshot that could erase additions refuse with an explicit migration/Undo
boundary diagnostic. Guarded sparse Undo rows and indices are unchanged.

Accepted limits: append-only upgrades can commit. Retirement, name changes and
alias conflicts can be durably staged but commit refuses with its pending
decision; explicitly abort to resume the old group. Retirement needs calculator
filtering and names need a display consumer in slice 7; this slice does not change
calculators. Cross-dataset/contract changes and generator versions unsupported by
the bounded base verifier refuse. Operators must supply the trusted old/new pins
again on reconciliation. Working trees are bounded to one complete group, with
no new memory acceptance claim. Windows directory sync retains slice 3's documented
best-effort limitation. Service deletion must be fenced by the stopped operator.

Slices 6–9 still own stopped-service format-1 inflation and frozen-loader replay
(6); calculator transport, retirement/display consumers, cache/residency audit and
50-group acceptance (7); browser negotiation (8); exclusive GC/retention-root
verification and sweep (9). Activation, real-save upgrades and production jobs
remain outside this slice.
