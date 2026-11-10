# Owned resident state: slice 2

This is an inert, explicit opt-in. Only tests call `createResidentState`,
`validateResidentState` and `applyResidentCommand` in `app/core/state.mjs`.
No store, reader, writer, startup hook or legacy-shared path selects it.
Envelope/state schemas, existing storage-1 serialization and History stay unchanged.

`createResidentState(logical, verifiedBase)` crosses complete logical validation
before sharing byte-identical rows and identity values from the frozen slice-1
base. The caller owns base verification/discovery and one parsed base per hash
per isolate. A WeakMap shares its task index and dictionary key arrays. Group
task arrays stay ordinary flat arrays; immutable arrays/rows enforce copy on edit.
Property order, task slots, assignment rows and optional registry presence survive.
Absent and empty registries differ: registering into an absent registry starts
with empty dictionaries, without introducing unrelated base identities.

`app/tasks/identity-dictionary.mjs` owns opaque immutable dictionary versions.
Use `identityValue`, `identityKeys` and `identityEntries` for logical access;
ordinary bracket access, spread and Object.keys are not the dictionary API.
There is no Proxy. Accidental JSON serialization throws and accidental writes
to dictionary views, shared rows, entries and candidate arrays throw in modules.
Versions retain only edits/tombstones and added/reinserted keys over shared base
keys. Edits clone/freeze touched values and copy delta containers, without copying
the full base dictionary or chaining retained older versions. Array-index keys
follow JSON enumeration rules. Nondefault imported order uses an explicit key
recipe; ordinary base-order groups need none. Candidate order is never sorted.

Identity lookup and completion projection accept both flat and sparse dictionaries.
Generated registration replaces the registry and touched dictionary versions;
task edits copy the array and replace the touched row. Core's existing indexes,
guards, historical row JSON and Undo preparation remain authoritative. Role-specific
WeakSets reuse immutable base JSON/schema checks; each new version validates its
edits, while every group's members, references, rules and complete Undo chain
still cross validation. Untrusted imports always cross full logical validation.

`cloneResidentState` in `app/core/resident-copy.mjs` is the explicit validation,
command-snapshot and archive-hydration boundary: share only frozen task trees and
the immutable registry; detach every other group field and every History/event
tree. Archive readers must first supply the existing complete ordered History.
Resident validation checks the original tree's JSON invariants before cloning;
cloning cannot erase symbol properties or normalize custom prototypes first.
Undo previews copy their task working array before applying inverses. No new
History or Redo representation exists; Redo tests reapply the original command.

`materializeResidentState` produces detached flat JSON. Public `validateState`
and portable export use this boundary for resident input; ordinary flat input
retains its existing path. Rare alias normalization explicitly materializes for
the existing identity migration, then reconciles validated output into sparse
versions. Hooks, workers, raw snapshots and portable import/export/rollback
callers requiring flat JSON must materialize, validate where applicable and
release their bounded working trees. Never structuredClone a resident dictionary.

Slice 3 must adopt these boundaries at store preparation, archive hydration,
getState/response, hook and publication seams, alongside the codec/preimages.
This slice does not enable those seams or write storage-2 metadata. Base caching
by verified hash, backup closure, rebase, rollback, calculator transport, residency
acceptance, browser negotiation and collection remain later slices. No heap or
50-group acceptance claim follows from these small deterministic fixtures.
