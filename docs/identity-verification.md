# Permanent identity verification

Run on October 7, 2026 with Node.js v24.19.0 in the isolated `codex/ids` worktree.
All fixtures and temporary stores stayed inside the worktree. No live gameplay store or server was used.

Final gate: `npm test` passed all 538 tests, with zero failures, cancellations or skips, in 94.74 seconds.
Test temporary paths used worktree-local `TEMP`/`TMP`; the temporary servers closed on teardown.

The authored registry contains 20,375 ordinary tasks, 19,609 entities and 5,376 compact historical
source/equipment bindings. The identity suite checks that every one of the 124,526 current collection
goals and 3,550 equipment goals has registered entity components and that its preceding label ID
resolves to the exact permanent goal. Rate/quantity corrections, task and equipment renames, category
changes, reused legacy codes and unresolved aliases have separate regression coverage.

`tests/identity-records.test.mjs` combines the existing connected-duo fixture with the full retained
definitions and real legacy decoders. It independently accounts for 710 saved facts and evidence
values: each value is recoverable from the active canonical projection, an exact original archive,
or the unchanged raw legacy map. Zero values are missing. The four fixture tests also verify backup
alias/provenance preservation, migration idempotence, reviewed clears, unknown IDs with retained
catalogue rows, collision boundaries and collision-free undo. This is a synthetic compatibility
fixture, not a claim about either player's current game progress.

The historical regeneration suite checks all 92,638 baseline mappings and all 35 reused `t_*` codes,
removed/resurrected labels, conflicting assignments and category-aware imports after regeneration.

## Paired performance measurement

`node scripts/benchmark-identities.mjs --baseline .local/identity-baseline/app` compared the new engine
with an isolated copy of the preceding committed engine (`386d614`), using the same retained 20,375 task definitions
and synthetic duo state containing 300 old task rows and 200 saved statuses. There were two warmups,
then seven interleaved duo evaluations, five compilation samples and nine batches of 100,000 lookups.

| Measurement | New engine | Preceding engine |
| --- | ---: | ---: |
| Median warm duo task calculation | 3,723.65 ms | 3,803.88 ms |
| Warm calculation range | 2,266.17–7,350.64 ms | 2,005.48–5,443.00 ms |
| Median definition compilation | 1,054.06 ms | 666.58 ms |

The warm median ratio was 0.979; this run showed no noticeable task-calculation slowdown. Wide sample
ranges reflect concurrent workstation load and do not establish a speed improvement. Indexed alias
resolution took 1.06 microseconds per lookup, and projecting both members' saved facts took a median
1.84 ms. Building the alias index took 523.07 ms once at the catalogue boundary. Compilation includes
the additional identity metadata; its one-time cost increased in this run. Measurements exclude module
loading, JSON reading, worker transport and browser rendering. They have no flaky wall-clock test threshold.

For a future paired run, create the baseline copy inside this worktree, run the command, then remove
that copy. The benchmark also runs without `--baseline` to measure only the current implementation.

## Changed files

| Responsibility | Files |
| --- | --- |
| Identity data and lookup | `app/data/identity-registry.mjs`, `app/data/legacy-task-history.json`, `app/tasks/identity.mjs` |
| Calculation and progress | `app/tasks/engine.mjs`, `app/tasks/collection.mjs`, `app/tasks/equipment.mjs`, `app/tasks/presentation.mjs`, `app/tasks/activity.mjs`, `app/core/progress.mjs`, `app/core/rules.mjs` |
| Migration, storage contract and review | `app/tasks/migration.mjs`, `app/core/state.mjs`, `app/server.mjs`, `app/web/main.mjs` |
| Maintenance and measurement | `scripts/update-identities.mjs`, `scripts/updateTasksMap.js`, `scripts/benchmark-identities.mjs` |
| Documentation | `docs/architecture.md`, `docs/migration.md`, `docs/identity-verification.md` |
| Tests | `tests/identity.test.mjs`, `tests/identity-records.test.mjs`, `tests/migration-identity.test.mjs`, `tests/task-map-history.test.mjs`, `tests/collection.test.mjs`, `tests/engine.test.mjs`, `tests/equipment.test.mjs`, `tests/migration.test.mjs`, `tests/presentation.test.mjs`, `tests/progress.test.mjs`, `tests/server.test.mjs` |

Archival root executable files and retained JSON were unchanged. Actual game-plugin event submission
and native game-ID mapping remain future work; the identity lookup is read-only.

## Saved-state startup regression

Identity projection now groups original catalogue IDs by resolved identity in one pass. Previously,
each duplicate row scanned and resolved the entire catalogue again. Catalogue upgrades also avoid
adding a permanent counterpart for an already represented objective, while retaining competing
alias candidates. Potential generated rows contribute metadata only when a saved task, fact,
alternative or undo record needs it. Decoder mappings still retain every candidate for referenced
codes, and unresolved competing targets survive portable backup restoration.

`tests/migration-scale.test.mjs` generates 4,000 collision pairs, thousands of member statuses,
two legacy maps and 2,000 history events. It checks exact retained evidence and backup restoration,
limits full-catalogue predicate visits deterministically, and uses a generous 60-second subprocess
timeout. The deterministic guard rejects the preceding quadratic implementation without depending
on workstation speed. The fixture is entirely synthetic.

`tests/identity-startup.test.mjs` covers the storage boundary: trusted identity migration can project
history, while caller preparation hooks must preserve its revision and history. Retained segments,
collision archives, sparse undo, no-op reopening and failed writes have separate coverage.
`validateOwnedState` runs the same JSON and schema checks as `validateState` without cloning an
already private state; it is reserved for trusted storage preparation. Caller hooks continue to
receive and return detached copies.

Native task workers read shared definition JSON to avoid cloning the full definition graph.
Injected workers retain their existing object input. Public catalogues and gameplay messages keep
their structured-clone boundary and the existing bounded worker restart policy.

Private state files validate their owned JSON directly. Load comparison ignores object key order,
so it avoids serializing a changed migration archive before writing the same archive to disk.
Storage still preserves the original revision as a backup before replacement and isolates caller
hooks. `tests/storage-owned-load.test.mjs` checks public validation error parity and unchanged loads.

For private-state verification, run each server against a fresh local copy, use a separate port,
compare counts and retained evidence against an exported preceding build, and remove the data
directory after each run. Keep private state, profiles and audit output outside committed fixtures.
