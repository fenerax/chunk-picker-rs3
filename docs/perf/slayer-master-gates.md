# Current Slayer master gates validation

START: `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`
Branch: `fix/w03-slayer-master-gate`
Runtime: Node 24.21.0, process workers.

The public full-definition regression fails on START application code (0 passed,
1 failed) because a Combat-30 master has a doable current assignment at Combat 29.
It passes after the fix, including Combat 30 and 31. Small engine fixtures also
cover a master-only Slayer requirement, pending/personal quest completion,
missing observations, an unresolved prerequisite, and a shared assignment from
an accessible lower master. The shipped panel module renders the synthetic
engine results in normal and advanced modes; its copy and denominator agree.
This is module rendering with DOM collaborators, not a live-browser observation.
The pending-quest test additionally projects an available method to check that
current access independently enforces personal completion. The engine already
blocks direct pending master quest requirements; that behavior is unchanged.

Affected tests: 59 passed, 0 failed. Configured `npm run test:quick`: 3014 passed,
0 failed, 68 existing skips (3082 total). Existing test-file classifications are
unchanged; the new fixture is not a test entry point. No full `npm test` run.

## Comparison method

`scripts/perf/slayer-master-gates.mjs --baseline <START-checkout>` compares full
production process-worker results and public roll-pool calculations. The public
workload repeats Combat 29/30/31 three times with full public definitions.

For a copied save, add `--source <temporary-save-directory>` and set the matching
`RS3_DATASET`, `RS3_PACKS_DIR`, `RS3_GAME_DEFAULTS_FILE`, and
`RS3_TASK_WORKER_MODE=process`. A sibling dataset binding is required. The harness
makes further temporary copies before opening the save and samples seven evenly
spaced historical states plus the current state. Temporary copies are deleted.
Only counts, hashes, durations and memory measurements are reported.

Comparison normalizes timing fields and permits changes only to ordinary Slayer
masters' `currentAccess`, current warnings, and assignments' `currentUnlocked`,
`currentStatus`, and `currentQuests`. All other result fields, including planning,
tasks, training, presentation and Death's current fields, must match exactly.
Roll pools and input-state hashes must also match. Full `tools/calc-check` is
unavailable on main; these bounded comparisons do not replace its full corpus.

## Public measurements

9 evaluations: 0 input differences, 0 stable-result differences, 0 pool differences.
9 full-result differences contain the allowed current-access changes. The
stable-result aggregate SHA-256 is identical before and after:
`3e0d53c5058c41791b8fc493480bb167f32790521796487cbb4c0da9a54513e3`.

Durations are median [minimum, maximum] in milliseconds. Worker compilation is
outside the evaluation timing; the first calculation is included. RSS is sampled
for the whole comparison child process tree at 100 ms intervals, including the
harness and calculator, and is not a production picker footprint. Public timing
ran alongside the quick suite; these are diagnostics, not a speed claim.

| Measurement | START | Candidate |
| --- | ---: | ---: |
| Activity Info ms | 185.57 [165.58, 290.60] | 226.91 [170.03, 292.60] |
| Full evaluation ms | 1962.79 [1825.03, 2584.35] | 2010.08 [1699.89, 2599.73] |
| Peak process-tree RSS MiB | 2403.5 | 2487.0 |


## Private sample measurements

8 states, 16 member evaluations: 0 input differences, 0 stable-result differences,
0 pool differences. 16 full-result differences contain only the allowed current
fields. Stable-result aggregate SHA-256 before and after:
`27c6f43a4f5182c91d3ab2b6b0cdc4f3c855f11a8de7dc92b865f6511ad840c4`.

| Measurement | START | Candidate |
| --- | ---: | ---: |
| Activity Info ms | 224.86 [173.42, 395.17] | 231.56 [164.61, 318.43] |
| Full evaluation ms | 2634.57 [1087.78, 4106.79] | 2735.22 [983.84, 3927.04] |
| Peak process-tree RSS MiB | 5419.8 | 5510.2 |

These are paired workload measurements with one calculator at a time. The sample
is bounded, and timing spread includes different states and first calculations.
No inference about game-wide gate completeness or speed improvement is made.
The laboratory checkout has 0 changed files after validation.
