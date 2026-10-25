# Group personal-filter investigation

Baseline: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd` (START; no comparison to cached origin/main).

## Reproduce

Requires Node 24 and Chromium; no npm packages, installed saves, game server or calculator processes.

```sh
node scripts/perf/scale-dataset.mjs --out /tmp/group-filter-scale400 --scale 400
node scripts/perf/group-personal-filter.mjs --companion /tmp/group-filter-scale400 --base 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd --runs 7 --profile --out /tmp/group-filter-paired.json
node --expose-gc --max-old-space-size=3072 scripts/perf/group-filter-check.mjs --companion /tmp/group-filter-scale400 --base 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd
```

The existing scale generator needed no changes. Scale 400 produces 469,226,078 bytes of synthetic pack inputs. The browser fixture derives 110,398 tasks from those definitions, 106,591 result rows per member, 44,161 / 44,159 completed references, historical and ambiguous aliases, completion families, owner-specific locked tasks, imported rows absent from current results, and 20,000 history entries. The serialized fixture is 313,161,929 bytes.

The harness executes the shipped `screen-tasks` functions, duo selectors, display filters, fact indexes and actual duo row controls. Screen imports are supplied explicitly, as in the repository's existing screen tests. Results and state are already loaded. Icons, map, hover, copy controls, Why controls and the closed Backlog disclosure are stubbed. Category painting uses the shipped first-70-rows limit and animation-frame yielding. The measured action ends after painting and the following animation frame.

Seven fresh-process pairs alternate before/after, after/before. Each process warms all six member/filter actions, primes player 1's Group list, then measures the same sequence. `group:one` measures returning to Group on the same player. `group:two` includes selecting player 2 and rebuilding the completed/backlog lists. The same sequence is used on both revisions. Each Chromium renderer has a 3 GiB old-space limit. Process-tree RSS is sampled every 100 ms, including warmup; it is not a kernel high-water mark and can miss short peaks. The Node harness's separate peak RSS is reported separately.

Machine: Linux x64, four available CPUs, Node v24.19.0, Chromium 154.0.8037.57. No tests or other heavy work ran during the timed measurements.

## Diagnosis and change

The unmodified scale-400 profile reproduces a substantial Not done / Group **selection** gap (roughly 5.4 s / 1.8 s). It does not reproduce the real save's much larger Not done / Only player difference: both personal filters inspect the full catalogue here.

An initial same-player Not done phase sample spent 2,370 ms in completion facts/union construction (44%), 1,636 ms recovering candidates (30%), 1,115 ms computing availability (21%), and 291 ms elsewhere. Selection was 5,412 ms of the 5,842 ms local action (93%). Painting was 14 ms. History is carried in state but is not scanned by this selector. A Chromium CPU profile independently identified `selectDuoTasks`, the imported-row predicate, `createTaskFactsIndex.get`, member projection and identity resolution as the main work.

`app/web/duo-tasks.mjs` now projects each member once within a personal-filter invocation and supplies those projections to the fact indexes. There is no retained cache or cache-key comparison across actions, members or revisions. Normal Group selection retains its original projection path. Candidate recovery builds a completed-ID Set once per inspected member, replacing repeated linear scans for each saved task missing from the current result. The existing never-show availability lookup is unchanged.

The benchmark's `availability` phase ends immediately before `combined` is constructed; after the change it includes the new one-time member projections. Compare `availability + factsAndUnion` together between revisions. All timings are instrumentation from the same source anchors on both revisions.

## Results

All times below are seconds. Brackets are the minimum and maximum across seven runs per revision. Paired percentages are the median of the seven per-pair changes, rather than the change between the two independent medians.

| Action | Before median [min, max] | After median [min, max] | Median paired change |
|---|---:|---:|---:|
| Group, player 1 (same player) | 2.143 [2.069, 2.332] | 2.225 [2.148, 2.335] | 4.6% |
| Not done, player 1 | 5.801 [5.683, 6.560] | 3.845 [3.685, 3.962] | -34.0% |
| Only player, player 1 | 5.661 [5.462, 5.940] | 3.715 [3.554, 3.919] | -34.6% |
| Group, switch to player 2 | 6.129 [6.048, 6.697] | 5.781 [5.611, 6.206] | -7.2% |
| Not done, player 2 | 5.941 [5.672, 6.177] | 4.268 [3.983, 4.392] | -27.8% |
| Only player, player 2 | 5.566 [5.416, 6.028] | 3.685 [3.495, 3.995] | -32.9% |

Same-player Group rendering increased by 3.8% between medians (+4.6% median paired change); its run ranges overlap. The measured Group player switch improved by 5.7% between medians (-7.2% paired). No real-save switching result is implied.

The selector is the main part of the local action. Not done selection medians were 5.392 → 3.430 s for player 1 and 5.535 → 3.872 s for player 2. Median imported-candidate recovery was 1.719 → 0.315 s / 1.790 → 0.313 s. Availability plus projection/facts/union was 3.426 → 2.778 s / 3.445 → 3.215 s. The complete local action improved by 1.956 s / 1.673 s (33.7% / 28.2% between medians). Most of the measured gain comes from candidate recovery.

Raw paired local-action times (before → after):

| Pair / order | Group P1 | Not done P1 | Only player P1 | Group switch P2 | Not done P2 | Only player P2 |
|---|---:|---:|---:|---:|---:|---:|
| 1 / AB | 2.128 → 2.225 | 5.749 → 3.962 | 5.462 → 3.681 | 6.048 → 5.611 | 5.686 → 4.268 | 5.416 → 3.756 |
| 2 / BA | 2.118 → 2.208 | 5.683 → 3.883 | 5.650 → 3.852 | 6.129 → 5.612 | 5.972 → 4.368 | 5.492 → 3.685 |
| 3 / AB | 2.229 → 2.335 | 5.801 → 3.828 | 5.661 → 3.704 | 6.089 → 6.081 | 5.941 → 4.246 | 6.028 → 3.678 |
| 4 / BA | 2.332 → 2.148 | 5.756 → 3.739 | 5.633 → 3.554 | 6.105 → 5.779 | 6.177 → 3.983 | 5.566 → 3.995 |
| 5 / AB | 2.069 → 2.200 | 5.849 → 3.887 | 5.848 → 3.715 | 6.205 → 6.206 | 5.894 → 4.341 | 5.787 → 3.495 |
| 6 / BA | 2.143 → 2.316 | 5.957 → 3.685 | 5.940 → 3.824 | 6.697 → 5.781 | 6.120 → 4.392 | 5.602 → 3.603 |
| 7 / AB | 2.204 → 2.275 | 6.560 → 3.845 | 5.909 → 3.919 | 6.411 → 5.892 | 5.672 → 4.098 | 5.561 → 3.776 |

The timing run completed all 84 observations, then Chrome profile cleanup raced with a final file write. Its timing log was preserved, and cleanup now retries. The original in-memory RSS records were lost. A recovery attempt also exposed invalid zero readings: this managed `/proc` omits `task/<pid>/children`; the sampler now enumerates status/PPid entries and rejects an empty observation. RSS is therefore reported from one separate matched BA recheck, not seven memory pairs. Those recheck timings are excluded from the table above. The harness now checkpoints observations before cleanup.

Correctness: 576 complete duo responses match START (both members, three completion policies, all personal and owner filters, locked/unlocked maps, blocked/completed switches). Another 12 rendered solo-screen snapshots match before/after. The regression test also checks that selection does not mutate its inputs.

Sampled browser-tree RSS in the separate BA recheck: before 2.584 GiB, after 2.559 GiB. This is one matched pair, with no memory spread or improvement claim. The recheck runner's own peak RSS was 1.400 GiB and is excluded from the browser figures. RSS sums process resident sets, including shared pages; it is not proportional memory.

The independent large-fixture oracle matched all six complete responses (both members, all three personal filters), hashing every output field and array row in order. Its separate Node process peaked at 0.981 GiB RSS. Full-response hashes:

| Member | Filter | Rows | SHA-256 |
|---|---|---:|---|
| one | group | 12600 | `8e54c3e60a01c59296aafc913ae1f6c94525b27cc1b4d2bda235d69809abb845` |
| one | not-done | 31812 | `02be8975c4dfb1bdbf4d19c9e8d115e06e78c2ec390d747ca344ffbc3fa844e7` |
| one | only-player | 7054 | `21f85a2e185671d97ab0c21869617a0a0fdb63861d08b01e59e734db4db9c2ed` |
| two | group | 12600 | `d43506d2eb241723def64d54520ef5383a8a768ea9168241a05800eeddea4e4e` |
| two | not-done | 31824 | `91fdb81a80dd8b7694bf9d332575337c956f00f55523fd04cae1daa17826c4f2` |
| two | only-player | 7066 | `88c8d5871f5c2fa096dee12599ba37640e90c2f95c2492da1675b36768055992` |

`npm run test:quick`: **2,311 passed, 1 failed, 65 skipped** (2,377 tests, 271 files). The failure is `tests/ci-coverage-reporter.test.mjs:77`, “real adaptive native events report nested cases, imported helpers and skipped suites”: `Native coverage count mismatch: tests/fixture.test.mjs` under Node v24.19.0. Running that file alone gives 4 passed / 1 failed. An isolated local `git archive START` of its unchanged tests/scripts gives the same 4 passed / 1 failed with the same error. No coverage or runner files were changed.

Focused duo tests: **21 passed, 0 failed**, including the 576-case complete-response regression. No new test files were added; `duo-tasks.test.mjs` retains its existing full-suite classification.

`npm test`: **5,342 passed, 2 failed, 137 skipped** (5,481 tests, 612 files; 369.264 s). The duo regression passed. The two failures are the same coverage-count test and `tests/process-worker.test.mjs:166`, “an owned calculator exits when its parent disappears without calling terminate.” The latter times out waiting for PID disappearance after parent IPC disconnect. Running that exact test against the isolated START archive with `RS3_DATASET=open-f2p` also fails (0 passed / 1 failed) with the same assertion. Neither failure is introduced by the patch; calculator/server/test-infrastructure files were left unchanged.

All five new measurement/helper modules pass `node --check`. Application changes are confined to `app/web/duo-tasks.mjs`.

## Limits

This is a public synthetic browser fixture, not a calculator-generated real-save response. The synthetic imported-row tail and completion mix influence the win. Absolute times are not comparable to the duo's real-save figures. The GitHub 2-CPU benchmark with process calculators and a 3 GiB **server** heap remains necessary before merging; this harness's heap bound applies to Chromium instead. Network time, server readiness, planning, unlocks and member-switch request scheduling are outside this measurement.
