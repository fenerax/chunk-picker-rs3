# Processing source evaluation performance — 2026-10-09

This follows the [processing parity repair](switchover-processing-parity-2026-10-08.md). Claude withheld `4a8020a` from deployment because its staged producer-output gating made uncached tasks and Unlock substantially slower than deployed `bcfd9a3`. The required behavior remains: diamond amulet stringing and enchanting are inactive on both maps, while the black-wool chain and independently supplied processing chains remain eligible.

## Measurement method

All comparisons use one frozen copy of the real save, with state SHA-256 `385ba6a264879354d3b4a3195f8593db7e59dcc7af875673e5d4d9562acabe0b`. Archived `bcfd9a3` and `4a8020a` code lives in ignored folders inside the authorized worktree during measurement. Each endpoint repetition starts a new disposable localhost server on an OS-assigned port and authenticates with its own scratch credential. Main game data and map assets are read-only. No original-picker capture or original-picker mutation is needed for this performance comparison.

Endpoint measurements use prediction prewarming **off** for every variant. The first request is `GET /api/tasks?memberId=player1&view=play-v1`, without a prior task calculation. Unlock measures the command saving pool chunk **11575**, followed by the matching tasks response. Prediction measures a cold `GET /api/predict` for pool chunk **12336** after Unlock, including lazy prediction-worker initialization. The harness verifies that this second chunk remains eligible. Server startup is outside these three timings. Reported request latency includes response transfer and parsing; engine timings are a separate diagnostic.

The normal browser reload check uses `npm run perf`, three independent runs and prediction prewarming **on**. Its prerequisite cold visit warms the server and HTTP caches before the measured reload. It includes rendering and cannot be substituted for a cold API timing. Node is **v24.20.0**. OS file caches are not flushed; endpoint comparisons are sequential, with no test suite or deliberate competing benchmark running.

## Profile and implementation

The `4a8020a` CPU profile attributed about **17.2 seconds** across the first and post-Unlock engine calls to evaluation. Raw access refresh accounted for about **5.0 seconds**, base-item collection **4.3 seconds** and public-row projection **3.2 seconds**. These inclusive figures overlap. The expensive operation was replaying the whole engine for each successive admitted processing frontier, rather than a separate downstream closure for each individual producer.

The engine now resumes discovery when ordinary producer admissions grow and the multistep frontier stays unchanged. Retractions and mode changes start a new closure. Discovery projects only the facts the processing selector needs. A fresh full final evaluation preserves source order, training provenance, Slayer-lock explanations and public metrics. Its selector is checked against the discovered admissions; disagreement, a cycle or a pass limit restarts the original full discovery path before publishing a result.

Invocation-local caches reuse raw access and base-source results only while the task gates actually read by those calculations retain their values. Cached raw access is copied before Slayer filtering or produced objects can mutate it. Base-source keys include each spawn's location and quantity. Nested drop expansion caches replay candidate events through the live item/source gates, preserving diagnostic order. Ownership annotations and output-publication decisions are kept separate from immutable cached inputs.

Additional caches cover fixed membership/rate decisions and repeated output publication. Ordered subsets reduce scans for primary training and point/XP contributions without changing when those updates run. The caches belong to one evaluation; a changed save, member or ruleset starts with fresh dependency state.

The final profile also exposed retained-map access recursively recomputed inside cache-world access, bypassing the outer memo. An optional access resolver now routes that recursion through the same memo. Dependency reads propagate through parent proxies on both misses and hits, so changing a retained task gate invalidates every enclosing result that used it. Standalone access calls retain their normal direct calculation path.

Travel proof and resource collection are separate cached stages. Changing a source-only task gate reruns collection against the unchanged travel result. The collector receives the current task reader; no cached travel result captures a previous closure's reader. Private spawn quantities and public mutable containers are copied before collection. Graph diagnostics remain the prefix of the final diagnostic sequence.

Walking eligibility is cached independently of entry seeds. Its key includes the compiled world, claimed bases, section overrides and F2P mode. Claims and overrides are snapshotted before walking, so later retained-resource projections cannot enlarge the cached walking policy. Traversal still returns components in the same order.

Boolean checks can reuse a prerequisite that still fails. Dynamic requirements are rechecked; fixed spatial failures are reused only for the same immutable access view. A remaining skill failure uses the exact cap, virtual-level and boost conditions and retains the original dependency counter increments. Public explanation checks still run their complete original guard sequence.

The compiler prepares membership and processing metadata only for a variant that is actually evaluated or explicitly prepared. The initial identity catalogue remains eager; its otherwise unused variant no longer duplicates this runtime preparation. Selected lazy preparation remains inside evaluation timing. Root output expansion caches preserve cycle boundaries and distinguish membership's false-entry policy from declared producer outputs.

Source ownership uses private boolean vectors keyed by the immutable base-source entry, personal access identity and produced-object location signature. These annotations are applied to fresh source copies. Boolean checks skip fixed guards already accounted for in the invocation's static-blocked partition; public checks keep their original explanation order. A successful duplicate resource location skips the same fixed source checks it already passed.

Repeated resource and base-item collection share the fixed source/location membership decision within an invocation. The immutable policy table identifies the three kind/name pairs with location-specific restrictions; those use a location key. Other kind/name decisions are uniform across locations and are computed once. The invocation fixes F2P mode. Location policy keeps precedence over the general source policy. Shop-item and drop-table membership branches retain their separate category-aware checks. Standalone access callers retain the original fallback path.

Item-source matching uses a single scan without temporary filtered arrays. Non-shop, allowed-source and source-channel constraints still accept independent witnesses: they do not require one source to satisfy all three. Failed chunk, NPC and shop requirements can be reused across discovery and the final pass only for the identical raw access result. A source-gate change creates a new access result and reopens the check; mutable monster/object and item requirements are excluded.

A trial cache for individual source deduplication keys was removed after profiling showed that its WeakMap bookkeeping and template cloning cost more than recomputing the keys. Strict source equality and ordering retain their original behavior, including colliding JSON keys for null, undefined and nonfinite values. Performance decisions here use measured request costs, not cache-hit counts alone.

## Final endpoint timings

Seconds, medians of three fresh-server runs per column. The deployed/final controls used the same save and ran sequentially as `shipping-paired-bcfd-2` / `final-policy-optimized-1`, `final-policy-bcfd-2` / `final-policy-optimized-2`, and `final-policy-bcfd-3` / `final-policy-optimized-3`. These labels identify ignored scalar reports, not private save contents. All endpoint results were cache misses. The earlier `4a8020a` measurements demonstrate the regression; the adjacent deployed/final pairs establish the comparison with deployed main.

| Request | Deployed `bcfd9a3` | Regressed `4a8020a` | Final | Final vs deployed |
|---|---:|---:|---:|---:|
| First tasks after server start | 2.107 | 10.226 | **2.272** | +7.8% |
| Unlock 11575 → refreshed tasks | 2.108 | 9.710 | **2.028** | −3.8% |
| Cold prediction for 12336 | 8.475 | 23.558 | **8.807** | +3.9% |

Final request ranges were **2.226–2.304s**, **2.016–2.090s**, and **8.526–8.959s** respectively. Deployed ranges were 2.050–2.128s, 2.009–2.152s and 8.451–8.519s. Every measured final Unlock was below the three-second target. This measures command acknowledgement and the refreshed tasks API, not browser drawing after Unlock.

The engine itself meets the approximately 10% evaluation allowance:

| Engine stage | Deployed | Final | Change |
|---|---:|---:|---:|
| First tasks | 1.495 | **1.632** | +9.2% |
| Post-Unlock tasks | 1.531 | **1.438** | −6.1% |
| Cold prediction, total engine work | 3.283 | **3.574** | +8.9% |

Total worker evaluation, including collection, equipment, presentation and serialization, was **1.972 → 2.126s** for first tasks, **1.890 → 1.800s** after Unlock, and **4.396 → 4.853s** for cold prediction. That last diagnostic is **+10.4%**, slightly above an exact 10% cutoff; its engine work and complete request remain within the requested approximate allowance. Cold prediction includes selected-variant compilation and two independent evaluations, one for the baseline and one for the candidate. Neither cost was moved outside evaluation timing. Median server readiness was 8.002s deployed and 7.653s final.

A prior six-run candidate still had first-task evaluation around +12%; its complete measurements remain in ignored reports. It was not selected as the final result. Subsequent policy memoization, immutable wiki compilation and fixed presentation flags were measured again with the final code frozen. No deliberately competing CPU work ran during these comparisons.

## Browser reload

`npm run perf` completed three runs with the same copied save, read-only data/assets and Chrome **154.0.8037.97**. The final report is `processing-optimized-reload-2026-10-09T05-35-37-803Z`. Its revision label is the parent `4a8020a`; the selected entry was the frozen, modified worktree, before the final commit. The paired endpoint reports also record the engine/access code hashes.

| Reload milestone | Deployed `bcfd9a3` | Regressed `4a8020a` | Final |
|---|---:|---:|---:|
| Tasks visible | 0.879s | 0.724s | **0.699s** |
| Terrain visible | 1.815s | 1.610s | **1.612s** |
| Tasks request TTFB | 82ms | 74ms | **73ms** |
| Transfer | 416KiB | 415KiB | **415KiB** |
| Worst browser long task | 133ms | 115ms | **100ms** |

Warm reload hides the original engine regression through result caching; this table is separate from the uncached API comparison. Reload tasks satisfy the two-second target, while terrain remains slightly above the separate 1.5-second target. No terrain implementation was changed in this repair.

## Parity retained

The read-only local parity model compared archived `4a8020a` with the final engine on the same copied save. Complete worker results matched in **4/4** cases after removing only cache/timing metadata: saved and post-Unlock states, for both players. Task arrays, source ordering, ownership, training provenance, diagnostics and public evaluation counters were included in the comparison.

| Scenario | QXA / Player 1 active | QXB / Player 2 active | New active differences against `4a8020a` |
|---|---:|---:|---:|
| Saved state | 20 | 20 | **0 on both maps** |
| After Player 1 unlocks 11575 | 20 | 20 | **0 on both maps** |

On both maps and in both scenarios, **String a diamond amulet** and **Cast Lvl-4 Enchant on a diamond amulet** stay inactive. All three black-wool chain records (`000807`, `000808`, `00080a`) remain available and source-eligible. Regression fixtures also retain processing chains with independent supplies, completed source evidence and the explicit multistep switch.

The exhaustive original-versus-app differences and five quarantined progress questions remain as classified in the [processing parity report](switchover-processing-parity-2026-10-08.md). Player 1's accepted coupled loadout/Rune-arrow pairing and single canonical skill headings are preserved. No eligibility change or prediction-golden update was made here. This was a same-save performance equivalence check; it did not recapture or operate the original picker.

## Files and validation

Runtime changes are in `app/tasks/engine.mjs`, `app/tasks/access.mjs`, `app/tasks/membership.mjs` and `app/core/cache-surface.mjs`. Regressions are in `tests/processing-parity.test.mjs`, `tests/engine-hotspots.test.mjs`, `tests/cache-topology-application.test.mjs` and the new `tests/membership-compile-cache.test.mjs`. Documentation changes are this report, `docs/performance.md` and the deployment-status note in the previous processing report. The Chunk Rules page and rule definitions were not edited.

**Full `npm test`: 1847 tests, 1846 passed, 1 skipped, 0 failed.** The existing optional generated-PNG bytes/hash/dimension/alpha check accounts for the skip. There are **29 new regressions** covering incremental admission, retraction/cycle fallback, ordered provenance, retained access dependencies, spawn quantities, root-table/literal expansion, membership/public mutation isolation, compiled variant preparation, source witnesses and spatial gates reopening. The final affected suite passed **139/139**; all six existing prediction goldens passed unchanged. Independent engine/access reviews and `git diff --check` passed.

The real-save copy retained its source SHA-256 after all checks. Tests used TEMP/TMP inside this worktree. Endpoint and browser servers used disposable localhost ports; main game data and map assets were read-only. The original picker, main tracked checkout, main `.local/duo`, live picker and Tailscale were untouched. No push, rebase or merge was performed. Private copies and task-owned archived code were removed after the checks; only ignored scalar reports, profiles and logs are retained.
