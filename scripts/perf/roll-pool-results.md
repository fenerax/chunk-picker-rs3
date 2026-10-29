# M0 roll-pool measurements

START `9995140f3d0211500f2fe4f2555132b900f7eb8a`. Node 24.19.0, Linux, process-hosted calculators. Five sequential trials per version, with no test jobs running during measurement. START was a detached worktree; cached origin/main was not used.

Each trial opens a fresh temporary save copy and sibling binding. The source is never opened for writing. The supplied defaults file was absent; scratch servers used a temporary private defaults file. No private inputs are included in this repository.

`state-load` measures `listen()` preparing its first state response, excluding imports, `createServer()` and initial calculator compilation. Subsequent state GETs use the normal warm response cache. Other phases measure complete HTTP requests, including response consumption. Death requests completed with HTTP 200 and 7 estimates in every trial of both versions. Restore uses a portable backup and includes validation, migration and serialization.

The harness uses a main-process-only loader probe around the unchanged inline evaluator. Loop histograms use 10 ms resolution, with 30 ms settling before/after each phase; wall times exclude settling. Values below are medians with min–max spread across five trials. A single long stall can leave p99 comparatively low, so maximum delay is also reported.

## Changes by file

- `app/core/rules.mjs`: bounded world/registry-scoped pool cache and local precomputed-pool tokens. The evaluator and rule hooks are unchanged.
- `app/core/state.mjs`: optional precomputed pool, checked against world, registry, member, revision and input; the original inline draw remains the fallback.
- `app/tasks/worker.mjs`: cached `roll-pool` requests, optional drafts and connection projections; rebuild native topology in the calculator.
- `app/tasks/scheduler.mjs`: capability reporting, shared state/draft transport and no supersession from hypothetical pool reads.
- `app/server.mjs`: await cached/worker pools at state, ranking, death and sandbox paths; retain small native init payloads and preserve explicitly supplied worlds.
- `app/storage/store.mjs`: share the cache, prepare roll inputs and serialized responses asynchronously when worker-backed, and return mutable defensive pool copies.
- `tests/roll-pool-worker.test.mjs` and `scripts/test-selection.mjs`: public fixture equivalence, invalidation, deterministic draws, stale-result rejection, mutable responses and member-ID compatibility; classified full-only with open-f2p policy.
- `scripts/perf/roll-pool*.mjs`: reusable measurement, equivalence and summary tools.

Cache entries are scoped to an immutable world and registry. Their input combines the existing conservative task fingerprint with every member’s selected, pending and blacklisted chunks. Display-only saves can reuse entries across revisions. Both HTTP and calculator pool caches are bounded to 16 entries.

## Equivalence and tests

The current copied save plus 50 evenly sampled earlier retained revisions produced 102 pools across 51 snapshots, with 0 differences. Before and after SHA-256 over canonical pool JSON plus a newline, in sample order:

`sha256:282cceeea1cd9cb049d40c38bb181af0459061a1e9345ff58fec48f4cb21e0a7`

Open-f2p fixtures compared 7 pools with zero differences (three saved-state variants for both members, plus a draft). Their shared canonical SHA-256:

`sha256:d1aa4f077e60b35f781e1c95ff2937f610e8cffc3cbff67456abb8633ecddb93`

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `npm run test:quick` | 2445 | 0 | 68 |
| `npm test` | 5588 | 0 | 140 |

## End-to-end times

Milliseconds; median (min–max).

| Phase | START | After |
| --- | ---: | ---: |
| Cold state preparation | 2941.5 (2862.9–3282.7) | 2788.1 (2615.6–2862.6) |
| State GET (warm) | 13.2 (12.9–35.3) | 13.0 (12.4–24.3) |
| Pool ranking | 189.8 (182.4–221.0) | 186.1 (174.6–236.3) |
| Sandbox | 5367.1 (5177.7–5823.4) | 5512.8 (5306.0–5669.7) |
| Death estimates | 19817.0 (19060.7–20939.9) | 19998.7 (19482.8–20495.7) |
| Roll | 2029.0 (1660.4–2143.2) | 2374.7 (2075.4–2456.4) |
| State GET after roll | 16.3 (15.5–30.4) | 15.9 (14.0–17.9) |
| Restore envelope | 10560.2 (10333.3–14245.4) | 10115.2 (9861.0–10606.6) |

## Main event-loop delay

Milliseconds; median (min–max) of each trial’s maximum and p99.

| Phase | START max | After max | START p99 | After p99 |
| --- | ---: | ---: | ---: | ---: |
| Cold state preparation | 2447.4 (2405.4–2682.3) | 105.6 (87.2–125.8) | 13.0 (12.1–14.9) | 14.1 (13.1–17.0) |
| State GET (warm) | 13.6 (13.3–17.7) | 13.5 (10.6–13.8) | 13.6 (13.3–17.7) | 13.5 (10.6–13.8) |
| Pool ranking | 187.8 (180.7–206.3) | 184.5 (173.0–236.2) | 187.8 (180.7–206.3) | 184.5 (173.0–236.2) |
| Sandbox | 88.7 (78.6–252.8) | 83.3 (80.9–125.8) | 13.5 (13.0–13.9) | 13.2 (12.6–13.5) |
| Death estimates | 208.0 (191.4–213.0) | 184.0 (161.3–208.3) | 12.9 (12.6–13.1) | 12.9 (12.7–13.3) |
| Roll | 1750.1 (1552.9–2057.3) | 28.2 (25.9–38.9) | 1750.1 (1552.9–2057.3) | 13.9 (13.5–17.7) |
| State GET after roll | 10.6 (10.5–13.0) | 10.8 (10.5–12.6) | 10.6 (10.5–13.0) | 10.8 (10.5–12.6) |
| Restore envelope | 4735.4 (4534.0–4865.4) | 4831.8 (4601.2–4957.7) | 1493.2 (1475.3–1527.8) | 1262.5 (1225.8–1377.8) |

## Inline evaluator call sites

START costs in milliseconds. Counts were identical in all five trials. **After: zero inline evaluator calls at every measured HTTP call site.** Warm state reads made zero inline calls in both versions.

| Phase | Call site | Calls/request | Per-call median (range) | Combined/request median (range) |
| --- | --- | ---: | ---: | ---: |
| Cold state preparation | `rollPools` | 2 | 1236.0 (557.3–1916.7) | 2387.3 (2342.2–2622.9) |
| Pool ranking | `rankingPoolIds` | 1 | 73.0 (59.4–77.7) | 73.0 (59.4–77.7) |
| Sandbox | `sandbox` | 1 | 34.9 (33.7–37.9) | 34.9 (33.7–37.9) |
| Death estimates | `death-estimates` | 1 | 40.6 (33.2–74.2) | 40.6 (33.2–74.2) |
| Roll | `applyCommandCopy` | 1 | 72.4 (58.1–194.5) | 72.4 (58.1–194.5) |
| Roll | `rollPools` | 2 | 923.4 (542.3–1052.4) | 1604.3 (1458.9–1929.8) |
| Restore envelope | `stateEnvelope` | 2 | 98.5 (33.9–162.8) | 192.0 (184.1–215.5) |

## Memory and limits

| Lifetime peak RSS, MiB | START | After |
| --- | ---: | ---: |
| Main process | 4248.6 | 3768.3 |
| Largest calculator process | 1697.4 | 1762.3 |

Main peaks use `resourceUsage().maxRSS` across the five-trial process, including portable restores and allocator retention. Calculator peaks use per-process `/proc` VmHWM sampled after responses, including processes later retired by a save. These are lifetime peaks, not simultaneous tree RSS or idle-picker footprint; they do not establish capacity.

Cold roll wall median rose from 2029.0 ms to 2374.7 ms while its maximum loop delay fell sharply. Ranking and large restores retain synchronous work outside pool evaluation; restore still stalls for roughly 4–5 seconds. Custom JavaScript hooks and injected workers without `roll-pool` support preserve inline fallback behavior. A calculator error (restarting, unavailable or closing) also falls back to the inline evaluator, so a roll or state send never fails because of the calculator. No remaining pool differences were observed.

## Reproduction

Set the matching dataset, packs and defaults environment and `RS3_TASK_WORKER_MODE=process`. Use a stopped source copy and output paths outside the checkout. The scripts create and remove their own writable copies.

```sh
git worktree add --detach /tmp/roll-pool-start 9995140f3d0211500f2fe4f2555132b900f7eb8a
node scripts/perf/roll-pool.mjs --app-dir /tmp/roll-pool-start/app --store /scratch/store --out /tmp/before.json
node scripts/perf/roll-pool.mjs --store /scratch/store --out /tmp/after.json
node scripts/perf/roll-pool-summary.mjs /tmp/before.json /tmp/after.json
node scripts/perf/roll-pool-equivalence.mjs --store /scratch/store --out /tmp/equivalence.json
```
