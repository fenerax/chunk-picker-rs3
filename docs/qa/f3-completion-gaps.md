# F3 completion and result gaps

START: `e431da314b682946c27f601ec78f17eab8a790eb`. Node: `v24.21.0`.
Branch: `test/f3-completion-gaps`. Tests, test classification and this report only;
production app diff against START is zero. No private inputs were used.

## Rescreen before adding tests

The x10 report describes an older main. Each operator below was recreated at
its corresponding unique source context on START in a detached temporary
worktree. Relevant existing quick and full-only tests were run first. Every
mutation was restored in `finally`; the primary checkout's app files were never
mutated. No full `npm test` run was needed.

Twenty priorities were screened: 16 already have assertion-based detection and
four escaped the relevant existing tests. The required completion truth table
was added even though newer existing engine coverage already rejects both
completion mutants. No additional tests were added for the other covered rows.

| Rank | Report mutant | Existing detection, or added coverage |
| ---: | --- | --- |
| 1 | `9f03791f98ba` | Existing `engine-hotspots.test.mjs`: completion scopes preserve canonical false flags and partner completion. Also killed by the required new truth table. |
| 2 | `797cd5446ed2` | Same existing completion-scope test; also killed by the new truth table. |
| 3 | `4a66d881faa3` | Existing `f2p-task-membership.test.mjs`: member items, outputs and aliases. |
| 4 | `d63bf04eb9d5` | Existing quick `xp-choices-state.test.mjs`: chosen XP replaces imported allocation, including an exact level-2 assertion. Broader XP rescreen caught this after the initial engine subset did not. |
| 5 | `63046035a768` | Existing `rules-fixes.private.test.mjs`, synthetic `D:` cases: independent output probabilities and primary evidence. |
| 6 | `9381df9f268d` | Existing `tasks.test.mjs`: authored source unblocking and produced-item backlog. |
| 7 | `d2037e0234b3` | Existing `cache-resources-retained-access.test.mjs`: member-base compatibility and explicit override. |
| 8 | `99ac01463981` | Existing `collection.private.test.mjs`, synthetic Kill X cases: Skiller suppression. |
| 9 | `37cad9a8aeda` | Existing `collection.test.mjs`: generators are opt-in, personal rule precedence, and nest independence. |
| 10 | `eb75e2a69737` | Gap: added independent item-backlog and RDT-off assertions with a nested-table positive control. |
| 11 | `c474a0638447` | Gap in the primary comparison: added level 9/10 boundaries with independent primary and passive evidence, without boosts. Both comparisons on the reported line were mutated independently. |
| 12 | `d42e4236b718` | Existing `rules.private.test.mjs`, synthetic F2P exclusion and walkability cases. |
| 13 | `622db9107e33` | Existing `rules.private.test.mjs`, synthetic personal/group and consumable teleport cases. |
| 14 | `65b201daf87f` | Gap: added a confirmed automatic teleport into section 7; assert candidate and roll-reason section metadata explicitly. |
| 15 | `3cd6f1a8a755` | Gap: added absent source section 0 beside reachable section 1, with a valid sibling-edge control; assert rolls and owned-section reachability. |
| 16 | `a4902c60a46f` | Existing `f2p-task-membership.test.mjs`: nested member output tables. |
| 17 | `ba9c9277f8de` | Existing `f2p-task-membership.test.mjs`: counted aliases need distinct admitted choices. |
| 18 | `b3baa3151f0b` | Existing `equipment.test.mjs`: tank, weight and upgrade-path score ordering. |
| 19 | `52c24f36e041` | Existing `equipment.test.mjs`: exact dual-wield score and shared-ammunition damage. |
| 20 | `1025e861f9e6` | Existing `f2p-equipment-membership.test.mjs`: free, mixed and unknown specialist alternatives. |

The rescreen covered 26 distinct existing files. Synthetic cases in
`engine.private.test.mjs`, `rules-fixes.private.test.mjs`,
`collection.private.test.mjs` and `rules.private.test.mjs` ran by name pattern;
`engine-hotspots.private.test.mjs` and `xp-choices-state.private.test.mjs` ran
in full. All used the tracked default dataset with inherited `RS3_*` overrides
removed.
Across 29 baseline file executions (including repeated files), 260 tests passed,
zero failed and zero skipped. Existing-test mutation trials recorded 564 passes
and 38 expected assertion failures. These are bounded relevant-test rescreens,
not a claim that every test was run against every mutant.

## Added tests and observed kills

| New test file and cases | Report mutant killed | Mutated run: pass / expected fail |
| --- | --- | ---: |
| `completion-truth-table.test.mjs`: 18 explicit booleans, three evidence combinations × three scopes × two synthetic owners | `9f03791f98ba`, evidence OR → AND | 6 / 12 |
| Same truth table | `797cd5446ed2`, personal-owner equality inverted | 12 / 6 |
| `collection-boundaries.test.mjs`: nested rare table, unrestricted / item backlog alone / RDT off alone | `eb75e2a69737`, collection restriction OR → AND | 5 / 2 |
| Same file: primary and passive Slayer levels 9 and 10, required level 10, zero boost | `c474a0638447`, primary threshold ≥ → < | 5 / 2 |
| `roll-boundaries.test.mjs`: automatic route to nonzero section | `65b201daf87f`, split index 1 → 2 | 1 / 1 |
| Same file: nonexistent source section zero | `3cd6f1a8a755`, early return removed | 1 / 1 |

The collection file's seven cases run together in each trial. An additional
mutation of the passive Slayer comparison produced 4 passes / 3 expected
failures, verifying that the independent evidence cases detect either operator
on that line. All seven deliberate mutations failed assertions, without errors,
skips, cancellations or timeouts. Restored START passed all 27 new cases.

The collection inputs supply independent source evidence at the public
`createCollectionEngine().evaluate()` boundary. This prevents upstream item or
monster filtering from concealing a broken collection guard. The automatic
route uses invented public-grid geography, an explicit personal confirmation,
and a personal return route; its availability is asserted before section
metadata. No real game bug was found.

All three files are explicitly classified quick in `scripts/test-selection.mjs`.

## Validation and measurements

- Added tests plus selection, classification-contract and run-policy tests:
  **36 passes / 0 failures / 0 skips**.
- `npm run test:quick`, once: **3,008 passes / 0 failures / 68 existing skips**,
  3,076 tests across 323 files, 254.736 seconds. No full `npm test` run.
- Five interleaved before/after pairs alternated order, with no concurrent test
  workload. Before: START's `engine-hotspots.test.mjs` (11 tests). After: the
  same file plus all three added files (38 tests). Each run used
  `node --test --test-concurrency=1 --test-reporter=tap`, with inherited
  `RS3_*` overrides removed. All 245 measured assertions passed.

| Regression workload | Seconds, median [min–max] | Maximum child RSS (MiB) |
| --- | ---: | ---: |
| Before, 11 tests | 0.973 [0.961–1.106] | 373.2 |
| After, 38 tests | 2.006 [1.995–2.028] | 333.2 |

Wall time uses Python `time.perf_counter()` around the Node process. Peak RSS
uses Linux `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss` in a fresh wrapper
for each trial: the largest individual child high-water mark, not a sum over the
process tree or PSS. The table measures added regression-runner cost; it is not
an engine performance or memory improvement claim.

- No app, pack, changelog or roadmap files changed; no private save was opened.
- All 20 priorities are addressed; none deferred. Mutation IDs identify the
  supplied report's operators, recreated by current source context rather than
  older byte offsets. This does not establish exhaustive mutation coverage.

Recheck the added files and classification contracts:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version  # must be >=24.20
node --test --test-concurrency=1 tests/completion-truth-table.test.mjs tests/collection-boundaries.test.mjs tests/roll-boundaries.test.mjs tests/test-selection.test.mjs tests/test-selection-contract.test.mjs tests/test-run-policy.test.mjs
npm run test:quick
```
