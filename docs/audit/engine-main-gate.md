# Engine into main rehearsal

START: `dcccaa8bf7fd36ffb6f39a13d65437540fc09514` (EN7).
MAIN: `977cc9e36b62d2f4e00d33fe6ceb17f5c2884b84`.
Node: 24.21.0. The merge is deliberately uncommitted.

The real merge uses the lane at `2f9ed99`, which adds three EN7 commits after
this rehearsal (cache charging, size reuse, eligibility buffer copies). They
touch only the EN7 cache files and their tests, so the merge again conflicts
only in `scripts/test-selection.mjs`, resolved as below. On Windows the cache,
worker-key, calculator-cap and capacity tests pass 61/0 (1 skipped) on it.

## Conflict resolution

| Conflicted file | Resolution and reason |
| --- | --- |
| `scripts/test-selection.mjs` | Union both sides of all three conflicts. Preserve the engine quick tests, calculator full-only tests, multiplayer quick tests, `progress-providers` full-only classification, and both open-f2p policies. Deduplicate the shared worker-key entry. Classify the new synthetic routed cache test as quick and open-f2p. No test was removed or reclassified to weaken coverage. |

There were no textual conflicts in app files. The automatic merge in
`app/tasks/engine.mjs` retains MAIN's Slayer gates and Ports scroll behavior
alongside EN7's shared eligibility budget and dataset-bound proof capacity.
`app/tasks/worker.mjs`, `snapshot-cache.mjs` and `eligibility-cache.mjs` retain
EN7's implementation. MAIN's scheduler, calculator pool, process-worker
transport, HTTP routing and per-picker job keys are retained without manual
changes. The global calculator cap remains independent of the cache byte cap.

## Cross-picker isolation

Complete and hypothetical snapshots use the calculation key after the worker
namespaces the opaque input by picker ID. Serialized state references use
`pickerSnapshotKey(pickerId, input)`. Revision high-water marks, cancellation
and supersession remain picker-scoped. Snapshot ownership is separately charged
to the picker in the common byte ledger.

Eligibility entries are keyed by the conservative gameplay-content fingerprint,
member ID and evaluation options, within a compiled rule variant. Equivalent
proof inputs can share compressed bytes; cache hits deserialize private mutable
rows and apply the caller's completion overlay. Different maps cannot reuse an
incompatible proof. The byte ledger is shared across variants, while values are
kept in each variant's own cache.

`tests/engine-cache-multi-picker.test.mjs` enables `multiPicker`, signs in two
synthetic owners, and routes colliding member IDs, revisions and sandbox drafts
through one real calculator (`maxCalculators: 1`). Different unlocked inputs
produce their own available/blocked tasks. Alternating task and sandbox reads
preserve each result; a changed preview key bypasses the scheduler result cache
and proves a warm hypothetical worker snapshot. Existing cache and worker-key
tests cover larger picker churn, content-keyed eligibility copies, byte eviction,
state-reference isolation and picker-scoped cancellation.

## Validation

The real-duo HTTP checker passes against MAIN in both routing modes. Each
mode compares 10 responses; response, byte-size and save difference counts are
all zero. Source SHA-256:
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.

| Routing | MAIN seconds | Merged seconds | MAIN peak RSS bytes | Merged peak RSS bytes | Paired responses | Differences (response / size / save) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Absent | 57.661852016 | 54.655481539 | 1858134016 | 1834557440 | 10 | 0 / 0 / 0 |
| Enabled | 56.577399738 | 57.050676161 | 1874956288 | 1843085312 | 10 | 0 / 0 / 0 |

These are single correctness trials per routing mode, concurrent with other
checks. Across the two modes, wall-time median (min–max) is MAIN 57.119626 s
(56.577400–57.661852), merged 55.853079 s (54.655482–57.050676).
This is descriptive timing, not evidence of a performance improvement.

Both calculator comparisons use seed 17, default request caps, sequence 8 and
serial reference/candidate execution. MAIN has no reference adapter in its tree;
a temporary copy of START's unchanged `calculator/reference` directory points
its relative `app` imports at an untouched MAIN worktree. The candidate uses the
same adapter code with the merged app. Init bundles carry the same dataset pins
and definitions to both calculators. No application file in either comparison
root was patched for the checker.

The public gate uses 16 checker shards, with the strict report merger
checking complete, disjoint state coverage, matching manifests, versions and
configuration. A verified temporary copy of the completed fixture harvest has
4249 captures across 186 test processes; its 9240-file byte inventory SHA-256 is
`69a1e1d7b695d97b6e600ad3013b692b4549442734c58f62216612efc349de35`.
Each shard validates every reused definition and state hash. No fixture was
removed. Public execution initially used one shard during the private sample, then two.
After the private sample and the first complete public shard, its measured
calculator RSS peaks (2481274880 / 2840707072 bytes) supported a cap of three
public shards within the 16 GiB memory limit. Completed reports were retained. A temporary controller restart caused the
execution wrapper to stop its in-flight children, so only missing shard reports
were restarted under one persistent controller. Corpus and configuration stayed
unchanged. Each shard still
runs reference and candidate serially. The preliminary unsharded comparison was
stopped before completion to use this supported workflow; it is not counted as
a passing gate.

The public specification is the documented generated transport corpus
(`steps: 8`) plus the complete fixture inventory. The private specification caps
save states at eight. The save, binding, wire spools and private reports remain
outside the public checkout; the lab checkout is never opened for writing.
The real-duo checker uses a temporary source copy and creates a new isolated
store for each trial.

An initial public capture incorrectly forced `open-f2p` for legacy-specific
fixtures: 0 states, 0 compared requests and 1 preparation error. It was restarted
with the normal legacy base and the repository's per-file dataset overrides.
The individual-file run was likewise restarted under the correct per-file
policy. No assertion, corpus cap, fixture or dataset pin was weakened.

The individual-file run completed 67 files: **1280 pass, 0 fail, 1 skip**.
The one skip is the existing native `chown` case, which requires root.
This includes every changed test file from MAIN plus the engine, cache, adapter,
worker-key, timing and process-worker files, each run on its own. The finalized
routed isolation test also passed separately after strengthening its warm-hit
assertion for each picker.

| Individual test file | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `tests/calc-check.test.mjs` | 11 | 0 | 0 |
| `tests/calculator-bundle-worker.test.mjs` | 1 | 0 | 0 |
| `tests/calculator-bundle.test.mjs` | 5 | 0 | 0 |
| `tests/engine-cache-eligibility.test.mjs` | 7 | 0 | 0 |
| `tests/engine-cache-snapshot.test.mjs` | 7 | 0 | 0 |
| `tests/engine-cache-worker.test.mjs` | 3 | 0 | 0 |
| `tests/engine-cache-multi-picker.test.mjs` | 1 | 0 | 0 |
| `tests/multi-picker-capacity.test.mjs` | 1 | 0 | 0 |
| `tests/worker-picker-keys.test.mjs` | 6 | 0 | 0 |
| `tests/worker-timings.test.mjs` | 18 | 0 | 0 |
| `tests/process-worker.test.mjs` | 9 | 0 | 0 |
| `tests/process-worker-transport.test.mjs` | 6 | 0 | 0 |
| `tests/account-reclaim.test.mjs` | 21 | 0 | 0 |
| `tests/achievement-rules.test.mjs` | 28 | 0 | 0 |
| `tests/backup-transfer.test.mjs` | 10 | 0 | 0 |
| `tests/boss-gates.test.mjs` | 10 | 0 | 0 |
| `tests/chunk-tabs.test.mjs` | 6 | 0 | 0 |
| `tests/group-goals-view.test.mjs` | 19 | 0 | 0 |
| `tests/helper-model.private.test.mjs` | 4 | 0 | 0 |
| `tests/helper-training.private.test.mjs` | 4 | 0 | 0 |
| `tests/helper-training.test.mjs` | 37 | 0 | 0 |
| `tests/helper-view.test.mjs` | 16 | 0 | 0 |
| `tests/json-duplicates.test.mjs` | 4 | 0 | 0 |
| `tests/linux-lock-recovery.test.mjs` | 8 | 0 | 0 |
| `tests/linux-multi-picker.test.mjs` | 54 | 0 | 0 |
| `tests/linux-service-crash.test.mjs` | 21 | 0 | 1 |
| `tests/phase1-acceptance-crash.test.mjs` | 6 | 0 | 0 |
| `tests/phase1-acceptance.test.mjs` | 21 | 0 | 0 |
| `tests/picker-audit-a.test.mjs` | 10 | 0 | 0 |
| `tests/picker-audit-b.test.mjs` | 11 | 0 | 0 |
| `tests/picker-audit-c1.test.mjs` | 5 | 0 | 0 |
| `tests/picker-audit-c2.test.mjs` | 11 | 0 | 0 |
| `tests/picker-browser-session.test.mjs` | 31 | 0 | 0 |
| `tests/picker-calculator-cap.test.mjs` | 25 | 0 | 0 |
| `tests/picker-context.test.mjs` | 16 | 0 | 0 |
| `tests/picker-deletion-crash.test.mjs` | 15 | 0 | 0 |
| `tests/picker-deletion.test.mjs` | 13 | 0 | 0 |
| `tests/picker-fairness-isolation.test.mjs` | 16 | 0 | 0 |
| `tests/picker-jobs.test.mjs` | 12 | 0 | 0 |
| `tests/picker-limits-http.test.mjs` | 9 | 0 | 0 |
| `tests/picker-limits.test.mjs` | 12 | 0 | 0 |
| `tests/picker-owner-ui.test.mjs` | 16 | 0 | 0 |
| `tests/picker-routing-crash.test.mjs` | 6 | 0 | 0 |
| `tests/picker-routing.test.mjs` | 38 | 0 | 0 |
| `tests/prediction-cache.test.mjs` | 23 | 0 | 0 |
| `tests/prediction-output.private.test.mjs` | 7 | 0 | 0 |
| `tests/presentation.private.test.mjs` | 6 | 0 | 0 |
| `tests/processing-chains.test.mjs` | 9 | 0 | 0 |
| `tests/progress-providers.test.mjs` | 25 | 0 | 0 |
| `tests/progress-sources.test.mjs` | 12 | 0 | 0 |
| `tests/reference-integrity.test.mjs` | 10 | 0 | 0 |
| `tests/registry.test.mjs` | 30 | 0 | 0 |
| `tests/release-vps-additions.test.mjs` | 7 | 0 | 0 |
| `tests/requirements-corrections.test.mjs` | 17 | 0 | 0 |
| `tests/rule-explanations.test.mjs` | 4 | 0 | 0 |
| `tests/rule-parent-inheritance.test.mjs` | 10 | 0 | 0 |
| `tests/rules-panel.test.mjs` | 26 | 0 | 0 |
| `tests/runemetrics-server.test.mjs` | 9 | 0 | 0 |
| `tests/runemetrics-web.test.mjs` | 19 | 0 | 0 |
| `tests/scheduler.test.mjs` | 43 | 0 | 0 |
| `tests/search.test.mjs` | 22 | 0 | 0 |
| `tests/settings.test.mjs` | 5 | 0 | 0 |
| `tests/slayer-unlock-gates.test.mjs` | 22 | 0 | 0 |
| `tests/task-why.test.mjs` | 7 | 0 | 0 |
| `tests/tasks.test.mjs` | 25 | 0 | 0 |
| `tests/viewer-permissions.test.mjs` | 14 | 0 | 0 |
| `tests/web-browser.test.mjs` | 338 | 0 | 0 |

`npm run test:quick` ran once after the individual files, with
`RS3_TEST_CONCURRENCY=1`: **2932 pass, 0 fail, 68 skip**, 3000 tests across
319 files, 656938.335183 ms. The normal per-file dataset policy was used.
No full `npm test` run was started. No socket failure or process-parent-death
failure occurred in the focused run.

The private sample passes: **8 states, 216 compared requests, 0 differences,
0 errors**, seed 17, 4 serial batches, 2843528.685439 ms.
Manifest SHA-256: `69197ab94ef9d50e170bd3286e9ccc0a3a7368296f327fb00dd2de02a10a095b`.

Protocol-calculator peak RSS is MAIN **5099327488 bytes**,
merged **5259972608 bytes**. These include adapter processes;
they are separate from the real-duo server measurements above.

| Request | Compared | Timed MAIN / merged | MAIN median ms (min–max) | Merged median ms (min–max) |
| --- | ---: | ---: | ---: | ---: |
| evaluate | 36 | 36 / 36 | 3236.599 (487.724–6009.132) | 4274.682 (1728.684–8147.320) |
| predict | 38 | 40 / 40 | 7431.046 (3858.313–15556.194) | 6846.993 (4080.870–14701.504) |
| death-estimates | 22 | 24 / 24 | 6019.427 (1.095–46173.867) | 7808.866 (0.828–48779.102) |
| chunk-planning | 36 | 36 / 36 | 337.794 (0.866–4089.294) | 1916.225 (1.950–9132.408) |
| sandbox | 20 | 20 / 20 | 3631.483 (2087.097–8696.077) | 6683.066 (5232.702–12907.486) |
| area-check | 20 | 20 / 20 | 11802.877 (6843.687–21269.671) | 16865.942 (6553.162–22410.144) |
| roll-pool | 36 | 36 / 36 | 32.656 (10.146–5184.307) | 44.277 (11.101–4129.768) |
| prepare-rules | 8 | 39 / 39 | 2236.687 (1.118–4840.245) | 2170.160 (0.943–4500.885) |

Timed requests also include priming and cancellation reruns. The values are
checker-reported elapsed times, with concurrent test/checker activity. They do
not establish a speed or memory improvement; the merged protocol RSS peak is
higher in this trial.

MAIN calculator-version SHA-256:
`3a137c4d14b5ea378ffdb32dcb4436ac6752a9e8de8f39f89c68d654d90c43eb`.
Merged calculator-version SHA-256:
`93fcf5491f8d007b3975e700a99bf98b01639d8eae4a3e54597f812671ddaac6`.

The public gate passes: **4354 states, 76267 compared
requests, 0 differences, 0 errors**, seed 17, **16/16 shards**. The strict
merger verified complete, disjoint coverage of the same full manifest, matching
calculator versions, request caps, sequence bound and volatile-field policy.
Manifest SHA-256: `e58b2c9a7305c6efa0e22daf6f94e88310688d61df470bbbac4689e20ae26813`.

Complete shard-pair duration median (min–max): **1118513.385 ms
(880235.036–1326385.245)**; sum of shard durations
17860268.068 ms. Shards overlap, so the sum is not elapsed
wall time. Maximum sampled calculator RSS: MAIN **3411369984 bytes**,
merged **3019063296 bytes**. These are correctness-run measurements,
not an isolated fleet-performance comparison.

| Public shard | States | Compared | Differences | Errors | Pair ms | MAIN peak RSS bytes | Merged peak RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 273 | 4819 | 0 | 0 | 880235.036 | 2481274880 | 2840707072 |
| 2 | 273 | 4764 | 0 | 0 | 1127424.703 | 2647109632 | 2764926976 |
| 3 | 272 | 4744 | 0 | 0 | 1120015.476 | 3205926912 | 2677297152 |
| 4 | 272 | 4788 | 0 | 0 | 1192853.877 | 2615246848 | 2858950656 |
| 5 | 272 | 4810 | 0 | 0 | 1249234.669 | 2782363648 | 2785988608 |
| 6 | 272 | 4856 | 0 | 0 | 1301352.940 | 3411369984 | 2803318784 |
| 7 | 272 | 4777 | 0 | 0 | 1326385.245 | 2753077248 | 3019063296 |
| 8 | 272 | 4789 | 0 | 0 | 1154640.003 | 2530045952 | 2933944320 |
| 9 | 272 | 4726 | 0 | 0 | 1051603.064 | 2651398144 | 2681708544 |
| 10 | 272 | 4763 | 0 | 0 | 1117011.295 | 2250739712 | 2665050112 |
| 11 | 272 | 4728 | 0 | 0 | 1026306.365 | 2296668160 | 2609012736 |
| 12 | 272 | 4721 | 0 | 0 | 1183488.983 | 2617749504 | 2804551680 |
| 13 | 272 | 4700 | 0 | 0 | 1084059.747 | 2703319040 | 2734518272 |
| 14 | 272 | 4795 | 0 | 0 | 1019186.911 | 2689822720 | 2584817664 |
| 15 | 272 | 4768 | 0 | 0 | 1001201.507 | 2612772864 | 2660323328 |
| 16 | 272 | 4719 | 0 | 0 | 1025268.248 | 2496540672 | 2773782528 |

The interrupted unsharded attempt last reported 41279 completed comparisons
and 0 differences; it is excluded from the passing gate above. Incomplete
controller attempts likewise contribute no states or comparisons to the strict
merged report.

## Limits and disposition

All requested correctness gates pass. The private gate is an eight-state sample;
no full-private-corpus or fleet-performance claim is made. The higher private
protocol RSS peak remains visible above. No game rule, fixture, comparator or
request cap was changed to obtain a pass. There is no unresolved merge conflict.

MERGE-CANDIDATE
