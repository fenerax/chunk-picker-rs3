# QFIX1 quest requirements

START: `26aa6baa3cf828b279ae384cf061392d50e07b4b`. Node v24.21.0.

The core-owned, versioned definition overlay corrects prepared rows for released
legacy packs. Immutable inputs and existing task identities are unchanged.
Each patch has an exact before-record guard and a pinned RuneScape Wiki revision.
Independent datasets do not inherit the corrections.

| Finding | Status | Correction |
| --- | --- | --- |
| H01 | done | Separate boostable Slayer 32 and mogre/flippers gate; retain unboostable Necromancy 50 and either urn route. |
| H02 | done | Strength 35 and Fishing 55 for barehanded tuna. |
| H03 | done | Six complete corresponding metal/log/level routes for both training steps; retain the steel route. |
| H04 | done | Thieving OR access to Zanaris, through a task-alternative selector. |
| H05 | done | Only the Thieving alternative permits boosting. |
| H06 | done | Raw cod OR inactive/active ring. |
| H07 | done | Remove the personal Cooking 25 prerequisite. |
| H08 | done | Cooking permits boosting; Agility remains unboostable. |
| H09 | done | Cooking permits boosting. |
| H10 | done | Cooking permits boosting. |
| H11 | done | Firemaking permits boosting. |
| H12 | done | Agility permits boosting. |
| H13 | done | Firemaking permits boosting; Crafting and Herblore remain unboostable. |
| H14 | done | Exact case-sensitive area alias correction. |
| H15 | done | Correct the restored artefact alias. |
| H16 | done | Correct the 5kg granite alias. |
| H17 | done | Remove the ordinary black full helm requirement. |
| H18 | done | Correct the raw potato ingredient alias. |

The public source check verifies five declarations: the flippers, corrected area,
restored artefact, granite size and raw potato. Synthetic tests exercise both
sides of level thresholds, boost rules and available boost supplies, both Cold
War routes, every paired smithing recipe, mismatched recipes, urn independence,
alias cardinality and retained disguise items.

H01 makes its task harder. H03 widens the choice while preserving the existing
steel recipe. H17 makes its task easier by removing a requirement. The flippers
item/source models the necromancy kill; the engine does not separately record
combat style or item delivery.

## Comparison scope

`scripts/perf/quest-requirements-check.mjs` compares the explicit START checkout
with the candidate. Public comparisons use tracked definitions and three fixed
generated states (five member evaluations). Private comparisons read a copied
save and use the selected released packs without changing saved rules. All
calculators run one at a time in process mode. Each side runs in a fresh process;
three paired repetitions must produce identical difference counts. Task rows
are compared in full, including requirements, blockers and sources. Existing-row
status changes and added helper rows are counted separately. Roll comparisons
include eligible, excluded and accessible entries. Prepared public definitions
are compared against the exact patch-path allowlist. Result rows must also
belong to the exact named-row allowlist, including the new helpers.

The checkout has no `tools/calc-check` implementation. This bounded comparison
covers prepared definitions, full task rows and roll pools; it does not claim
the full calculator-protocol corpus, historical saves, prediction requests or
all possible game states. The synthetic boundary tests cover the intended
availability changes that these sampled states may not encounter.

Wall times include loading, compilation, evaluation, roll pools and hash output,
excluding copying input saves. RSS is sampled every 50ms and summed across the
child process tree; it is an observed peak rather than an allocation bound.

## Public differences against START

31 guarded definition differences: 13 existing quest rows, 11 new helper rows
and seven selectors. Five existing source declarations checked. All 20,375
existing task identities checked: zero changes. Across each five-evaluation
corpus: 121 different task rows (66 existing and 55 added helpers), zero
existing-row status changes, zero out-of-scope rows and zero pool-entry changes.
All three repetitions agree.

| Quest | Step(s) | Existing result rows changed | Added helper result rows |
| --- | --- | ---: | ---: |
| Kili's Knowledge | III | 5 | 5 |
| Barbarian Training | 2b4a1, 2b4a4, 2b4a6 | 15 | 30 |
| Cold War | 1, 10 | 10 | 10 |
| RFD: Freeing Evil Dave | 1 | 5 | 0 |
| RFD: Freeing King Awowogei | 1 | 5 | 5 |
| RFD: Freeing Pirate Pete | 1 | 5 | 0 |
| RFD: Freeing Skrach Uglogwee | 1 | 5 | 0 |
| Regicide | 1 | 5 | 0 |
| Shades of Mort'ton | 1 | 5 | 5 |
| God Emissaries Exploration | 4 (selector) | 0 | 0 |
| Beneath Scabaras' Sands | 6 (selector) | 0 | 0 |
| King's Ransom | 6 | 5 | 0 |
| Big Chompy Bird Hunting | 8 (selector) | 1 | 0 |

H14 and H15 change their prepared selectors without changing evaluated task
rows in this generated corpus. H18 changes one evaluated row. Counts are per
corpus, rather than the sum of three identical repetitions.

## Private comparison counts

Three repetitions agree. 49 different result rows: 27 existing rows and 22
added helper rows. Existing-row status changes: zero. Out-of-scope result rows:
zero. Pool-entry changes: zero, so every correction group has zero pool-entry
changes. Counts below are per comparison, not summed over repetitions.

| Finding group | Existing result rows changed | Added helper result rows | Status changes | Pool-entry changes |
| --- | ---: | ---: | ---: | ---: |
| H01 | 2 | 2 | 0 | 0 |
| H02-H03 | 6 | 12 | 0 | 0 |
| H04-H06 | 4 | 4 | 0 | 0 |
| H07 | 2 | 0 | 0 | 0 |
| H08 | 2 | 2 | 0 | 0 |
| H09 | 2 | 0 | 0 | 0 |
| H10-H11 | 2 | 0 | 0 | 0 |
| H12 | 2 | 0 | 0 | 0 |
| H13 | 2 | 2 | 0 | 0 |
| H14 | 0 | 0 | 0 | 0 |
| H15 | 0 | 0 | 0 | 0 |
| H16-H17 | 2 | 0 | 0 | 0 |
| H18 | 1 | 0 | 0 | 0 |

Copied input SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.

## Measurements

Three fresh-process trials per revision; median with minimum–maximum spread.

| Corpus | Wall seconds before | Wall seconds after | Peak tree RSS MiB before | Peak tree RSS MiB after |
| --- | --- | --- | --- | --- |
| Public | 22.64 (22.18–22.80) | 22.70 (21.47–23.02) | 2308.17 (2218.62–2402.80) | 2357.80 (2306.70–2362.91) |
| Private | 37.89 (35.00–39.21) | 38.99 (38.30–42.74) | 3177.29 (2769.12–3292.70) | 3221.45 (3165.05–3227.88) |

These are regression observations, not a performance improvement claim.

## Tests

Focused files: 27 passed, zero failed (`quest-requirements-corrections`,
`requirements-corrections`, and `test-selection`). The new synthetic file
contains nine tests.

`npm run test:quick` ran once: 319 files, 2,970 passed, one failed, 68 skipped.
The failure was the real decoder-migration case in `linux-multi-picker`. Its
release fixture copies `git ls-files`; the fixture was created before the new
correction module was staged, so its copied import was missing. All new files
were then staged before rerunning that file alone. No test was changed or
skipped to resolve the fixture.

Standalone `node --test tests/linux-multi-picker.test.mjs`: 54 passed, zero
failed, zero skipped. The formerly failing decoder-migration case passed.
The quick suite was not rerun. No full `npm test` was run.

Private checkout changed entries after comparison: zero. Disposable private
input and per-trial copies were removed.
