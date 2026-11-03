# Before/after engine differential

Node 24.20+ (CI: 24.21.0), Git and Linux /proc; no npm dependencies, network,
servers, stores, released packs or private saves. All inherited RS3_* selectors
are rejected. Calculator refs run in clean, owned detached worktrees with empty
pack/map/data directories. Never point this harness at a private save.

The production dataset digest intentionally includes DATASET_SOURCE_INPUTS,
including app/tasks/engine.mjs, as evidence alongside input bytes, capabilities,
contract and overlay order. It binds saves and workers to the same calculation
semantics and prevents mixing packs or definitions. It is deliberately too
strict for comparing changed engine implementations. This harness does not
change that digest, the app, or the scheduled y03 cold/warm deep campaign.

## PR checks and local reproduction

The `Tests` workflow calls `Public differential`. Its separate `PR engine
differential` job checks out the PR head with full history and compares that
head against its merge base with the PR base SHA. Missing history fails; there
is no self-comparison fallback. Relevance uses the calculator roots' import
closures at both refs, calculator/data paths and `reference/`. An unrelated PR
runs the job successfully with a **not relevant** summary, rather than skipping
its required check. The scheduled y03 deep campaign is unchanged.

The reusable workflow's combined result feeds `RS3_COVERAGE_DIFFERENTIAL_RESULT`
in the coverage gate. A failed comparison, input verification, collapsed harvest,
timeout, memory breach or cancelled job fails that gate. A not-relevant decision
exits zero. Required harvest floors remain `MIN_HARVEST_PAIRS = 500` and
`MIN_HARVEST_RESULTS = 400`; matching error replies do not satisfy the latter.

The job has a 15-minute limit, a 14-minute comparison step, a 720000 ms campaign
deadline and a 780000 ms outer deadline. `workflow_call` inputs `q2-request-ms`,
`q2-wall-ms`, `q2-outer-ms`, `q2-rss-mib` and `q2-tree-rss-mib` configure the
bounds (defaults: 30000, 720000, 780000, 768, 2048). Keep deadlines below the
step/job limits to leave time for cleanup and upload. Node 24.21.0 runs in a
disposable container, with inherited selectors removed and no packs mounted.
The existing RSS sampler bounds the owned process group; it is not a cgroup
hard limit. Runner teardown disposes of descendants even after SIGKILL.

A local reproduction uses the same job script and limits (choose a fresh output
directory, and make both histories available first):

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/experiments/q2-diff-engine/pr.mjs --base-ref BASE_SHA --head-ref PR_HEAD_SHA --out /tmp/pr-engine-diff --request-ms 30000 --wall-ms 720000 --outer-ms 780000 --rss-mib 768 --tree-rss-mib 2048
```

### Reading a failure

Open **Public differential / PR engine differential**, then the Q2 job summary.
Download `q2-pr-differential-RUN_ID-RUN_ATTEMPT`: `summary.json` and `summary.md`
contain the resolved merge base and head, compared/result/error pair counts,
harvest counts and floors, difference count, wall time and sampled peak group
RSS. For a mismatch, `firstDifference.requestType` names the operation and
`firstDifference.path` identifies its first differing result field. Compared
values and captured states are omitted. The first mismatch stops the campaign,
so its difference count covers only pairs reached before stopping.

Exit 10 means a result difference: reproduce locally and inspect that operation
and field. Exit 14 includes unequal input bytes, incomplete reports and a harvest
below either floor; check input/fixture changes before interpreting it as an
engine difference. Exits 11/15/124 are request/campaign/outer deadlines, 13 is RSS,
12 a crash and 16 an unexpected engine error. The local output also retains
`comparison/campaign/report.json`, `comparison/supervisor.json` and campaign
logs for investigation. If no summary artifact exists, inspect checkout/setup or
cancellation logs; absence never proves success. Fix the cause instead of
lowering floors or weakening comparison. A deliberate game/input change needs
separate review because this gate requires byte-identical inputs and results.

Direct comparisons, independent of PR relevance, remain available:

```sh
node scripts/experiments/q2-diff-engine/supervise.mjs --reference-ref BASE_SHA --candidate-ref HEAD_SHA --out /tmp/engine-diff
```

## Input gate and corpus

Before any corpus request, both refs independently verify every selected public
dataset: actual bytes of all non-evidence input records and data evidence files
(JSON, gzip, CSV, TSV, text), plus materialized value snapshots, contract,
capabilities, definition-overlay selection/order and game defaults. Executable
source evidence is excluded; its materialized definition values remain bound.
Hashes are SHA-256 of exact bytes, with lengths and paths retained. A changed
byte (including whitespace), missing input, value, option or rule refuses the run.
Definition bytes, dataset options and extra rules are rechecked for each bundle.
No result canonicalization or volatile exclusions apply to the input gate.
Public packs are explicitly absent on both sides; released/private packs are not
supported by this public harness.

The corpus is built once from the reference and the exact same serialized frames
are sent to both sides. Twelve synthetic states (configurable --cases, minimum 2)
use the existing y03 generator. The existing calc-check capture instrumentation
harvests planning.test.mjs, engine-hotspots.test.mjs and game-plugin-mapping.test.mjs,
including all their captured states and both public dataset selections, without
sampling away captures. These are the three files used by calc-check's existing
harvest integration test. This is a bounded selection, not the entire test tree.
The public fixtures include partial and intermediate command states. They retain
the calc-check completeFixtureState normalization and history; only synthetic
saves receive full saved-state validation. No private data is consulted.

Every state runs prepare-rules and, per member, evaluate (full and play-v1 with
duo/sidebar projections), roll-pool, predict (with prepared reuse), death-estimates,
chunk-planning, sandbox, area-check and how-task. Some harvested negative cases
return errors. Their full error replies are compared and counted as errorPairs;
resultPairs counts successful result pairs separately. Synthetic errors fail.
Acceptance requires successful results from both corpus sources and successful
coverage of all nine operations, every expected pair, no differences or harness
errors and intact deadlines. Matching negative cases cannot satisfy success
coverage. Common-mode bugs and production-scale performance are outside this gate.

Results decode all worker JSON transports/reuse payloads and use the existing
calc-check compareValues implementation and volatile.json unchanged. Transport
id/type/timingMs/evaluationMs envelopes are removed. Arrays and gameplay counters
remain significant. The one provenance rebinding is how-task result.context.datasetDigest:
it must equal that side's attested production digest, then becomes the shared
input-manifest digest. This compares the proof context without treating a
code-inclusive identity as gameplay. No other digest field is rewritten.

report.json records refs, source/corpus/input hashes, expected/compared pairs,
result/error counts, operation/source coverage, first differing request type and
field path, side durations and peak RSS. Difference paths use the existing
comparator's hashed dictionary-key segments. The first mismatch stops the run.

## Bounds and controls

Defaults: --request-ms 10000 (absolute per request, including init), --wall-ms
780000 including setup/harvest/cleanup, --outer-ms 900000, --rss-mib 768 per
bridge (worker threads included), --tree-rss-mib 2048 for the owned group.
The independent supervisor samples the entire process group, including corpus
harvest subprocesses, every 50 ms and kills it on wall/RSS breach or interruption.
Per-bridge RSS/VmHWM is sampled every 20 ms, including final reply and retirement.
Heap ceilings are 512 MiB for the coordinator and 256 MiB for each bridge; workers
also request a 512 MiB old-generation ceiling (Node's inherited cap can be lower).
RSS sampling can overshoot; this is not a cgroup guarantee. CI should use a
disposable container to dispose of descendants if the supervisor gets SIGKILL.
Owned worktrees/scratch are removed; reports/logs remain outside scratch. Normal
retirement, timeout, RSS and SIGTERM must leave no live process group members;
non-reaping PID 1 can leave zombies. Cleanup errors fail the supervisor.

Exit codes follow y03: 0 pass, 10 difference, 11 request timeout, 12 crash, 13 RSS,
14 setup/input/protocol, 15 wall budget, 16 unexpected engine error. Supervisor
wall timeout is 124 and interruption 143. A zero child exit alone is insufficient:
the supervisor parses and validates the complete report before passing.

For a local uncommitted fault control only, --candidate-patch /tmp/fault.patch
applies a patch to the owned candidate worktree and records its hash. Neither
calculator ref nor the main checkout is modified. Do not pass this flag in CI.
The opt-in engine-differential integration test makes a one-line counter error on a
scratch branch, never commits it, and requires /full/metrics/catalogueCount to
be caught. It also checks a whitespace-only data change, deadlines, RSS and
cleanup. The existing differential suite and scheduled deep campaign do not select this
longer detector suite. Ordinary quick tests cover input verification, the comparator, provenance
rebinding and report acceptance. Run:

```sh
node --test tests/q2-diff-engine.test.mjs
node scripts/test.mjs engine-differential
npm run test:quick
```

## Historical public evidence from PR #103 (2026-11-02)

START: c185bd7c932d96642506b10c3c0935fb689b7d02. Linux, Node v24.21.0.
The harness runs from the working tree and records its source hashes; calculator
code comes from the recorded committed refs (plus the explicit local fault patch
when requested). The three final PR-entrypoint runs used identical harness source
hashes. Each run harvested once and sent the exact same frames to both refs;
fresh harvests have their own corpus hashes and can vary in order/negative-case mix.

No merge for PR #101 exists in the supplied local history, including all local
refs. No GitHub access or fetch was attempted. The available substitute compares
START against e7d9981dbfcbff935ebf7c9a679264b00fbd30aa, the first parent of
profiler merge #95 (e29ad7e26c7e452218bbf9d0af54e5fc2fde07e1). This is not the
requested pre-#101 proof; that proof remains outstanding.

| Check | Samples | Pairs per run | Differences / outcome | Wall seconds | Peak sampled RSS MiB |
| --- | ---: | ---: | --- | --- | ---: |
| Existing y03, same historical refs | 1 | 0 | Refused unequal production digests | 15.76 | 936.6 |
| Q2 PR entrypoint, historical merge base vs START | 3 | 1548 | 0 differences in each run | Median 173.53; range 165.31–177.14 | 1212.6 |
| Uncommitted one-line engine counter fault | 1 | 2 | 2 differing fields; exit 10 | 36.68 | 1033.0 |
| Whitespace-only public data change | 1 | 0 | Refused data bytes; exit 14 | 27.24 | 865.7 |

Q2 RSS is the entire owned process group, including harvest subprocesses and both
calculator bridges, sampled every 50 ms. The old y03 row uses its own reported
campaign duration and aggregate RSS. Before/after means comparison coverage here;
the old run stopped during setup, so these rows are not a speedup comparison.
The final Q2 runs contain 1246–1247 successful result pairs and 301–302 matching
negative-case error pairs, with successful coverage of all nine operations.
Production dataset digests differ for 19 of 20 bundles in each run while the
separate data attestations match. The explicit PR command resolved the expected
merge base and never fell back to a self-comparison.

The fault changed only `catalogueCount: compiled.length` to
`catalogueCount: compiled.length + 1` in a scratch worktree, without committing it.
First difference: `evaluate`, `/full/metrics/catalogueCount`. The patch hash is
`4374fef430bc6136ca887474c0ff7a88ab595f468a9a93a0520a3ca6e8b632d4`. The integration test removed its scratch branch
and worktree. Deadline and memory controls returned 124 and 13 respectively,
with no remaining live owned group members.

Validation:

- Focused Q2, y03 unit and test-selection files: 21 passed, 0 failed.
- Q2 real-process integration: 1 passed, 0 failed (five campaigns, including the
  full 1403-pair two-synthetic-state control; 1101 successful results and 302
  matching negative-case errors).
- Existing y03 integration: initial concurrent attempt 2 passed, 1 failed at
  its shrinker-size assertion; isolated rerun 3 passed, 0 failed. The rerun passed
  without changing that test or its shrinker.
- `npm run test:quick`, once: 3405 passed, 0 failed, 68 existing skips
  (3473 cases; 762.96 seconds). No full npm test run.

At that task’s completion, remaining work was permission to edit `.github/workflows/differential.yml` and its
`.github/workflows/test.yml` caller for CI activation, plus the unavailable local
pre-#101 ref. The supplied scripts/tests-only scope was preserved. No private
save or released/private pack was opened, and no lab-data file was modified.

CI activation and fresh comparisons on the required main base are recorded in
[`docs/perf/q2-ci-2026-11.md`](../../../docs/perf/q2-ci-2026-11.md).
