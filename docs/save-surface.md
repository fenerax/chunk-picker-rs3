# Frozen save contract

[`save-surface.json`](save-surface.json) declares the current per-picker save
surface against the immutable rollback release `06e15939`. It is a declaration
used by tests, not a migration or a startup gate. This change does not alter
production serialization, Undo, imports, exports or service backup selection.

The manifest lists JSON paths in the disk envelope and hydrated state, plus file
families below `dataDir`. `/[]/` means an array element and `/*/` one dictionary
key. An entry also declares its container prefixes. Only explicitly documented
`opaque` entries include descendants: original legacy input, catalogue metadata,
archived source histories/provenance and historical command/inverse values.
Live envelope, member and provenance roots are never opaque. Adding a new live
field or sidecar requires a declaration and a synthetic writer scenario.

Suppression's atomic provenance, registered portable capsule, legacy handled
sidecars and ownership files are declared explicitly. The corpus uses the real
progress command. Optional plugin evidence cannot veto startup, restore or
export; there is no replay-reconciliation refusal marker or staging protocol.

The frozen policy is one of:

- `preserved`: natively supported, or retained without interpretation. This does
  not promise that a credential or diagnostic enters a portable export.
- `private-droppable`: may disappear; the entry states the roll-forward rule.
  Currency ordering is reconstructed conservatively from portable ownership and
  History annotations, with fresh observations required for ambiguous streams.
- `needs-lower`: requires an explicitly tested projection before old startup.
- `refused`: old startup cannot safely admit the representation.

Today's manifest has no `needs-lower` or `refused` feature. The accepted plugin
rollback limit preserves chunks, task ticks, History and Undo. Plugin decisions
may be offered again by the frozen release; usable evidence is recovered when
returning to the current release. See [the save schema](save-schema.md).

`save-surface.test.mjs` builds synthetic feature saves using the actual store and
sidecar writers. It walks `state.json`, which comes from `serializedDiskState`,
and retained backup envelopes and observes successful filesystem writes so
temporary files and lock recovery are included. It also checks hydrated state so
static-field extraction cannot conceal a new path. Unknown paths and files fail.
Every declared path, file family, member field and feature must be exercised.
The manifest's `checkpoint` file roots must equal `service-checkpoint.mjs`'s
existing `gameplayRoots`.
Production retains its strict allowlist; deriving it here would change the
runtime dependency and release packaging boundary.

`frozen-release-rollback.test.mjs` creates a temporary git worktree of the exact
pin. All its imports, including storage, validators and sidecar writers, come
from that checkout. Current code writes a synthetic save with static fields,
archived History, platform/plugin progress, ownership, receipt metadata and
plugin sidecars. The frozen store opens it, executes Undo on a note sentinel,
publishes the save, updates retained plugin sidecars and exports with its own
exporter. Current code reopens the frozen-written directory and exported state.
History, progress, permanent task IDs and portable plugin evidence are compared
by identity and value, rather than by counts. Plugin sidecar evidence is checked
in the retained directory. Registered replay decisions also travel in provenance
and portable envelopes; raw sidecar files remain separately retained. Undo deliberately
targets a note so no expected removal of progress can mask evidence loss.

Missing git history fails, including on cache hits. CI fetches full history and
caches an independent frozen checkout by OS and full SHA. Each run uses a new
temporary worktree from that cache; the cache never contains a stale pointer
into an earlier runner's `.git/worktrees`. Local checks use Node 24:

```sh
node --test --test-concurrency=1 tests/save-surface.test.mjs tests/frozen-release-rollback.test.mjs tests/platform-rollback.test.mjs
```

The three files in `tests/fixtures/rollback-main/` remain as a **fast hybrid
check**. They pin three source files but import 22 live `app/` modules. Five
imports changed after `06e15939`: `completion-codec.mjs`, `transport-access.mjs`,
`dataset-runtime.mjs`, `tasks/identity.mjs` and `tasks/migration.mjs`. Their source
parity test does not freeze that dependency graph. Keep the fixture until a
separate cleanup; exact-release compatibility comes from the real worktree test.

The scope is per-picker saves, not the complete deployment filesystem. Sibling
dataset bindings, registry/tombstone roots, external snapshots and operator
control journals are described in [`storage-contract.md`](storage-contract.md).
Tests use synthetic data only and do not prove power-loss durability, operation
on a live save or safe frozen startup for future features requiring lowering.
