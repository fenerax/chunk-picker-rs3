# Owned HTTP serving: slice 7c (default off)

`createServer({ ownedFormat2 })` can serve synthetic owned groups through the
real HTTP router, stores and process calculators. The option defaults to
`false`. No environment flag, production entry point, deployment or automatic
conversion enables it. Real-save use and deployment require explicit approval
(owner decision, 2026-11-11).

## Release preparation and trust

`prepareOwnedServingRelease` prepares a fresh group with the runtime's dataset,
rule registry and migration pipeline, then passes only its catalogue and
identities to `buildOwnedBase`. `createOwnedBaseManifest` pins the exact canonical
release bytes. Group saves, saved identities and clocks are not release inputs.

Offline `retainOwnedServingRelease` writes hash-named release bytes followed by
an independent manifest. It retains earlier files. The configuration supplies
`dataset`, `manifest`, `releaseBytes`, `catalogueRoot`, `manifestPath`,
`releasePath` and optional `retainedManifestPaths`. All files must reside in the
external catalogue directory. That directory must be outside the legacy store,
picker, tombstone and registry trees, including junction ancestors and missing
leaves below them. Publication uses existing atomic writes and directory sync;
the existing Windows directory-sync limitation still applies.

Startup reads the independent files, checks supplied bytes and pins, verifies
retained manifests and their published bases, and compares the current release
with fresh runtime preparation. Missing, inconsistent, corrupt or unverifiable
inputs refuse startup. `RS3_COMPLETION_CODEC=1` is incompatible and also refuses.
Release preparation is an offline action; startup never reconstructs a manifest
from a save reference or repairs a missing referenced base.

## Save selection and preparation

The verified configuration travels through `createServer` → `openContext` →
`createPickerContext` → `openStore`. Only owned contexts receive it. The legacy
context continues to use format 1, even when owned format 2 is configured.

Before load preparation, serving selects the document's exact base reference
using independent current or retained manifests. Several manifests may pin
different bases for the same dataset digest. A newer current base never replaces
the saved selection. Admission checks that the save still names that selected
pin before recovery or preparation. Existing format-1 owned saves refuse; this
path cannot convert them. Fresh owned groups use the verified current release.

Each context prepares load, command and import state with its pinned catalogue
and identity base. Migration currency checks all pinned catalogue IDs, plus the
existing owner, alias, journal and registry checks. Imported registry overrides
retain their existing meaning. Backups and replacement/import workers use the
same independent trust inputs and preserve catalogue provenance.

The process must already run the save's pinned dataset. A different dataset
refuses before preparation. The base cannot reconstruct another dataset's world,
definitions or providers, and runtime dataset selection requires a new process.
Dataset upgrades remain explicit stopped-writer transactions.

## Consumers and compatibility

Only enabled owned calculation and display consumers interpret
`provenance.ownedCatalogue`. Retired IDs cannot create new task, collection or
equipment obligations. Current-name metadata supplies display labels. Saved
rows, aliases, History and Undo preimages retain their historical values.
Calculation and eligibility caches include this metadata when the consumer is
enabled. Default lower-level calculator and projection APIs retain slice-7a
transport parity.

The verified context's display option also applies to detached command,
conflict and compatibility snapshots. Import jobs receive the effective option;
storage format alone never enables the transfer reply's display overlay.
Owned storage validates active catalogue provenance before load/import
preparation and before publication: the optional `retiredIds` field contains
unique nonempty string IDs, and optional `names` is an object mapping nonempty
IDs to string labels. Unknown fields and malformed values refuse with an
`Invalid provenance.ownedCatalogue` diagnostic. Existing malformed saves refuse
to open; preparation never silently repairs or rewrites them. Invalid backups
cannot pass preview or restore, and the preceding saved bytes/replies remain
available. Historical provenance retained as restore evidence stays opaque.
Format-1 storage retains its existing provenance validation and bytes.

`deltaValidation` remains a separate, default-off `openStore` option. Neither
`createServer` nor `createPickerContext` forwards it, so enabling owned HTTP
serving does not enable delta validation. Explicit lower-level stores can combine
the two options. Delta proofs freeze catalogue provenance with the whole exact
snapshot; hook output and fresh opens cross full validation. Owned play-projection
reuse also requires identical catalogue metadata, and task/eligibility cache keys
include it. Focused coverage compares note/tick/Undo replies and saved bytes with
delta validation off/on, then checks metadata changes, refused publication, old
response snapshots and restart while saved rows remain historical.

The format-1 path, browser wire schema and plugin 1.0.0 fields and meanings stay
unchanged. Full state and portable backups remain complete logical documents;
catalogue negotiation is still slice 8. No plugin catalogue fetch is required.
Retirement/name-change rebase commit gates and alias-conflict decisions remain
as specified in [the rebase contract](owned-rebase-contract.md).

## Synthetic proof and remaining gates

`owned-serving-config.test.mjs` covers deterministic releases, independent trust,
containment, preparation, admission races and opted-in consumers.
`owned-serving-crash.test.mjs` exits and throws at both sides of release bytes
and manifest publication, and after save-pin selection. Recovery requires
explicit offline re-preparation; saves remain intact.

`owned-serving-http.test.mjs` compares format 1 and enabled format 2 for the same
tiny synthetic commands, full/play state and task replies, History/Undo, plugin
1.0.0 reads and portable replacement. It covers older retained bases, relocated
sealed fixtures, refusal paths and current-name/retirement consumers. It also
uses the actual capacity child wrapper to provision format 2, serve HTTP writes,
stop, start a fresh process from disk and continue writing. Every test listens
on port 0.

The capacity fixture configuration, manifest and completion seal bind the storage
format. Verification inspects physical group documents and their base pins.
Format-1 fixtures cannot be relabelled or reused as format 2. The synthetic
`--format format2` harness option is available after this HTTP/restart proof.
The harness still defaults to format 1.

This proof does not establish the full sustained workload's speed, 50-group
memory acceptance, hosted stability, browser usability or production readiness.
Character switching, browser negotiation and catalogue GC remain outside this
slice. Activation and any real-save conversion still need the owner's explicit
approval.
