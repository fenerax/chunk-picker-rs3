# Full-suite test speed

The [October 15 regression audit](research/test-speed-2026-10-15.md) records the
current three-file measurements, startup costs, fixture changes and public CI
verification. The results below retain the earlier October 13 experiments.

Measured 2026-10-13 on the release PC, Windows desktop, Intel Core i7-8700K @ 3.70GHz, 12 logical CPUs, 31.95 GiB RAM, Node v24.20.0. The live picker stayed running. Shared-lock queue wait is excluded.

The four-file CLI trial reached **3m 43.7s**, but its **3717 MiB** peak was 74% above the baseline. The ordered trial was slower and used more memory. The committed runner therefore keeps **concurrency 2**. The combined under-four-minute and near-baseline-memory goal is **not established**. All three allowed full runs were used; the final cleanup changes received focused checks rather than a fourth full run. Final full-suite time and peak at concurrency 2 remain unmeasured.

## Full-run results

| Run | Concurrency / policy | Files | Tests / passed / existing skips / failures | Total wall seconds | Peak Node MiB |
| --- | --- | ---: | --- | ---: | ---: |
| Baseline | 2, standard CLI | 325 | 3394 / 3393 / 1 / 0 | 907.74 | 2131 |
| After trial | 4, standard CLI | 329 | 3394 / 3393 / 1 / 0 | 223.69 | 3717 |
| Confirmation trial | 4, large-save first then long files | 329 | 3394 / 3393 / 1 / 0 | 251.73 | 4116 |

The earlier approximate 7.5-minute estimate did not reproduce: the measured baseline was 15m 7.7s. The CLI C4 trial was 75.4% faster than that baseline. The third run took 4m 11.7s, so its ordering/API runner experiment was removed. No test cases or existing assertions were deleted, merged away, or newly skipped. The existing skill-icons PNG-byte/hash/dimension/alpha case skips when private generated PNGs are unavailable. Counts include that same one skip throughout; every full run also had zero cancellations and zero TODOs.

Five unchanged Windows-helper cases were split from operations.test.mjs into five files to let Node overlap their independent temporary fixtures. Their original test body, configurations, deadlines, descriptions and assertions are retained in tests/helpers/picker-operations.mjs. This explains 325 -> 329 files with exactly the same 3394 test cases. The four new files are explicitly classified full-only.

## Changes retained

- The only production-code change is createServer's optional schedulingClock (now, setTimeout, clearTimeout) in app/server.mjs. Its default still uses performance.now and native timers. Startup admission remains 10 seconds, foreground grace 15 seconds, quiet time 1 second, list wait 30 seconds and list polling 250 ms. Worker, lease, HTTP and shutdown deadlines still use real time.
- Prediction, scheduling and task-claim tests advance a manual clock chronologically instead of sleeping through application admission windows. Existing checks remain; boundary checks now cover 9999/10000 ms startup, 999/1000 ms quiet time and the missing peer at 14999/15000/16000 ms. Real asynchronous worker/HTTP completion is still awaited.
- Ordinary fixtures in prediction, task-claim, play, RuneMetrics, sandbox, server and viewer-permissions use the existing shutdownDeadlineMs option at 500 ms. Tests specifically checking shutdown reliability keep their own deadlines. Scheduling already used 500 ms. Closed fixture-owned server references are released during teardown; RuneMetrics also clears its closed-server array. These releases alone did not materially solve the C4 memory peak.
- The remaining members-start-server fixed listener uses port 0. Suite discovery now audits all top-level test files even during quick runs, rejecting literal 8000-9999 listen ports and simple constant bindings. No allow-list is needed. Assertions for the guard were added inside an existing quick-suite case, so case count stays unchanged.
- test:timing captures whole-file timing and rough Node memory under the shared lock. It rejects invalid/duplicate targeted paths, checks report file count, invalidates a previous same-label report before launch, preserves failure exit status and redacts invite/Bearer tokens from failure output. Quick remains concurrency 2. No heap cap or custom ordering runner is retained.

## Focused memory follow-up

These are targeted checks, **not full-suite results**. They do not prove final full-suite wall time or peak.

| Targeted group after reference cleanup | Concurrency | Tests / passed / failed | Wall seconds | Peak Node MiB | Decision |
| --- | ---: | --- | ---: | ---: | --- |
| Four files active at the third full run's peak: play-server, runemetrics-server, sandbox-server, server | 4 | 50 / 50 / 0 | 31.10 | 3976 | Memory still too high |
| Same four files plus command-performance, with experimental 256 MiB old-generation heap limit | 4 | 51 / 50 / 1 | 46.20 | 3356 | Large-save case failed; heap limit removed |
| Same four peak files, normal Node defaults | 2 | 50 / 50 / 0 | 44.24 | 2109 | Retain two-file concurrency |

The failed heap experiment's reporter captured a generic child-test failure rather than its stderr; the reporter now forwards redacted stderr. Heap exhaustion was not conclusively diagnosed, and no heap cap remains. The two-file targeted peak is near the full baseline's 2131 MiB; this is evidence for retaining the original concurrency, not a final whole-suite memory measurement.

## Final functional checks

After removing the heap cap and releasing fixture owners, the four peak files passed all 50 cases in the locked C2 check. Prediction, scheduling, task-claim, viewer-permissions and the uncapped large-save regression then passed 49/49 with --test-timeout=120000 and concurrency 2. The large-save preference and chunk commands remained below their existing 5000 ms limit (249/193/188 ms). The final quick run passed 841/841 across 86 files in 20.7 seconds, including the port guard. The split Windows helper files had previously passed 5/5. Syntax checks and git diff --check passed. No browser session or screenshots were needed for this test-infrastructure change.

## Measurement method and reruns

All six timing checks above ran through .local/with-heavy.ps1. Only the first three were full-suite runs. Whole-file wall time comes from Node 24's outer FileTest test:complete event, covering process startup, imports, cases and teardown. It excludes the queue before a file starts; overlapping file times must not be summed to infer suite wall time. Suite wall starts immediately before spawning the runner and stops at runner exit, before waiting for the sampler's last poll. Full runs use the standard CLI's native defaults; the rejected third run used the public test-runner API and combined its phase summaries. Focused checks use --test-timeout=120000; current full timing uses the same no-global-timeout setting as npm test.

Memory sums WorkingSetSize for the runner and descendants connected through Node parents, sampled after a CIM query with two-second pauses. It excludes the live picker, unrelated processes, PowerShell and fixture Node children reached through PowerShell parents. Shared pages can be counted more than once and brief peaks can be missed. All reported runs use the same rough ownership and sampling method. The third full run's peak snapshot named play-server, server, sandbox-server and runemetrics-server; isolating command-performance did not solve it.

Raw JSON is in this worktree's ignored .local/test-speed directory: baseline.json, after-c4.json, after-ordered-c4.json, fixture-retention-c4.json, heap-256-c4.json and fixture-retention-c2.json. The ranked tables below preserve the baseline and fastest full-trial evidence in version control. Any further full confirmation needs a new run allowance; none was run after the cap was reached.

For future authorized full measurements, use the runner's selected concurrency:

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 npm run test:timing -- comparison
```

For a targeted measurement, supply concurrency and explicit files after the label. These reports identify scope as targeted. Node 24 is required for the per-file reporter's event shape. Port regression feedback is included in npm run test:quick.

## Before/after top 15 by whole-file wall time

The two after columns are the actual full trials, both rejected as everyday settings because of memory. The final default is C2 and has no after full measurement.

| Rank | Baseline C2 file | Seconds | CLI C4 file | Seconds | Ordered C4 file | Seconds |
| --- | --- | ---: | --- | ---: | --- | ---: |
| 1 | play-server.test.mjs | 120.25 | server.test.mjs | 38.17 | server.test.mjs | 40.01 |
| 2 | prediction-server.test.mjs | 109.40 | storage-reliability.test.mjs | 28.35 | storage-reliability.test.mjs | 30.39 |
| 3 | scheduling-server.test.mjs | 93.13 | identity-startup.test.mjs | 25.39 | identity-startup.test.mjs | 28.96 |
| 4 | operations.test.mjs | 88.62 | play-server.test.mjs | 23.50 | worker-timings.test.mjs | 27.21 |
| 5 | server.test.mjs | 85.51 | task-claim-server.test.mjs | 21.67 | play-server.test.mjs | 25.77 |
| 6 | sandbox-server.test.mjs | 71.54 | identity-records.test.mjs | 20.02 | identity-records.test.mjs | 23.28 |
| 7 | runemetrics-server.test.mjs | 59.70 | duo-server.test.mjs | 18.22 | task-claim-server.test.mjs | 22.14 |
| 8 | server-reliability.test.mjs | 46.42 | viewer-permissions.test.mjs | 17.80 | duo-server.test.mjs | 21.96 |
| 9 | preview-resource-contents.test.mjs | 45.55 | command-performance.test.mjs | 17.56 | watchdog-script.test.mjs | 20.27 |
| 10 | task-claim-server.test.mjs | 39.64 | watchdog-script.test.mjs | 16.82 | sandbox-server.test.mjs | 19.74 |
| 11 | preview-archaeology.test.mjs | 37.86 | sandbox-server.test.mjs | 16.82 | runemetrics-server.test.mjs | 18.42 |
| 12 | skill-guides-data.test.mjs | 36.62 | worker-timings.test.mjs | 16.66 | scheduling-server.test.mjs | 16.91 |
| 13 | identity-startup.test.mjs | 30.48 | runemetrics-server.test.mjs | 15.70 | death-worker.test.mjs | 16.10 |
| 14 | invites-server.test.mjs | 30.19 | training-server.test.mjs | 15.07 | viewer-permissions.test.mjs | 15.68 |
| 15 | duo-server.test.mjs | 28.80 | preview-resource-contents.test.mjs | 14.56 | preview-resource-contents.test.mjs | 15.47 |

## Baseline complete ranking

| Rank | File in tests/ | Wall seconds |
| --- | --- | ---: |
| 1 | play-server.test.mjs | 120.25 |
| 2 | prediction-server.test.mjs | 109.40 |
| 3 | scheduling-server.test.mjs | 93.13 |
| 4 | operations.test.mjs | 88.62 |
| 5 | server.test.mjs | 85.51 |
| 6 | sandbox-server.test.mjs | 71.54 |
| 7 | runemetrics-server.test.mjs | 59.70 |
| 8 | server-reliability.test.mjs | 46.42 |
| 9 | preview-resource-contents.test.mjs | 45.55 |
| 10 | task-claim-server.test.mjs | 39.64 |
| 11 | preview-archaeology.test.mjs | 37.86 |
| 12 | skill-guides-data.test.mjs | 36.62 |
| 13 | identity-startup.test.mjs | 30.48 |
| 14 | invites-server.test.mjs | 30.19 |
| 15 | duo-server.test.mjs | 28.80 |
| 16 | command-performance.test.mjs | 28.64 |
| 17 | original-sync-server.test.mjs | 25.71 |
| 18 | preview-equipment-corrections.test.mjs | 25.44 |
| 19 | obtained-equipment-server.test.mjs | 25.34 |
| 20 | storage-reliability.test.mjs | 24.99 |
| 21 | prediction-output.test.mjs | 24.73 |
| 22 | pool-ranking-server.test.mjs | 22.17 |
| 23 | identity-records.test.mjs | 19.87 |
| 24 | death-worker.test.mjs | 19.69 |
| 25 | journal-server.test.mjs | 17.94 |
| 26 | worker-timings.test.mjs | 16.54 |
| 27 | watchdog-script.test.mjs | 16.03 |
| 28 | viewer-permissions.test.mjs | 14.82 |
| 29 | parity-progress-aliases.test.mjs | 13.01 |
| 30 | preview-metadata-corrections.test.mjs | 12.33 |
| 31 | training-server.test.mjs | 11.28 |
| 32 | original-sync-local.test.mjs | 11.26 |
| 33 | transport-access.test.mjs | 10.94 |
| 34 | engine.test.mjs | 9.90 |
| 35 | migration.test.mjs | 9.29 |
| 36 | area-check-server.test.mjs | 9.00 |
| 37 | cache-island-policy.test.mjs | 8.49 |
| 38 | identity.test.mjs | 8.38 |
| 39 | mining-rates.test.mjs | 8.36 |
| 40 | map-assets-server.test.mjs | 8.27 |
| 41 | multisticker-server.test.mjs | 8.14 |
| 42 | migration-scale.test.mjs | 8.08 |
| 43 | map-info-server.test.mjs | 7.97 |
| 44 | multisticker-picker.test.mjs | 7.43 |
| 45 | interiors-v2-catalogue.test.mjs | 7.17 |
| 46 | skill-guides-preview.test.mjs | 7.04 |
| 47 | interiors-v2-server.test.mjs | 6.96 |
| 48 | npcs-and-shops-application.test.mjs | 6.87 |
| 49 | runemetrics.test.mjs | 5.95 |
| 50 | interior-maps.test.mjs | 5.73 |
| 51 | members-start-server.test.mjs | 5.61 |
| 52 | roll-stats-server.test.mjs | 5.46 |
| 53 | activity.test.mjs | 5.44 |
| 54 | roll-stats-storage.test.mjs | 5.39 |
| 55 | processing-parity.test.mjs | 4.94 |
| 56 | equipment-corrections.test.mjs | 4.93 |
| 57 | metadata-corrections.test.mjs | 4.92 |
| 58 | rules-fixes.test.mjs | 4.86 |
| 59 | lodestone-metadata.test.mjs | 4.64 |
| 60 | cache-resources-catalogue.test.mjs | 4.59 |
| 61 | multisticker-state.test.mjs | 4.59 |
| 62 | preview-source-loss.test.mjs | 4.52 |
| 63 | invite-attribution.test.mjs | 4.37 |
| 64 | helper-server.test.mjs | 4.36 |
| 65 | archmaps-server.test.mjs | 4.35 |
| 66 | custom-tasks-server.test.mjs | 4.32 |
| 67 | house-storage-server.test.mjs | 4.21 |
| 68 | web-browser.test.mjs | 4.18 |
| 69 | map-connections.test.mjs | 4.14 |
| 70 | backup-status.test.mjs | 4.12 |
| 71 | presentation.test.mjs | 4.00 |
| 72 | skill-guides-runtime.test.mjs | 3.92 |
| 73 | state.test.mjs | 3.88 |
| 74 | cache-resources-expanded-application.test.mjs | 3.76 |
| 75 | storage-static.test.mjs | 3.73 |
| 76 | original-task-sync.test.mjs | 3.68 |
| 77 | tasks.test.mjs | 3.65 |
| 78 | cache-resources-retained-access.test.mjs | 3.57 |
| 79 | history-pagination-server.test.mjs | 3.50 |
| 80 | cache-comparison.test.mjs | 3.49 |
| 81 | parity-diary-equipment.test.mjs | 3.47 |
| 82 | automatic-travel-integration.test.mjs | 3.44 |
| 83 | transport-audit.test.mjs | 3.42 |
| 84 | partner.test.mjs | 3.31 |
| 85 | backup-watchdog-server.test.mjs | 3.31 |
| 86 | rules.test.mjs | 3.31 |
| 87 | retained-entry-corrections.test.mjs | 3.23 |
| 88 | terrain-assets-server.test.mjs | 3.21 |
| 89 | icons-server.test.mjs | 3.20 |
| 90 | skill-guide-milestones.test.mjs | 3.13 |
| 91 | calculation-equivalence.test.mjs | 3.12 |
| 92 | chunk-sections.test.mjs | 3.05 |
| 93 | task-claims.test.mjs | 3.00 |
| 94 | cache-task-access.test.mjs | 2.92 |
| 95 | equipment-permanence-worker.test.mjs | 2.92 |
| 96 | requirement-alternatives.test.mjs | 2.87 |
| 97 | planning.test.mjs | 2.81 |
| 98 | rules-panel.test.mjs | 2.79 |
| 99 | runemetrics-state.test.mjs | 2.74 |
| 100 | obtained-equipment.test.mjs | 2.65 |
| 101 | cache-resources-application.test.mjs | 2.63 |
| 102 | cache-archaeology-provenance.test.mjs | 2.62 |
| 103 | cache-resources-server.test.mjs | 2.61 |
| 104 | storage.test.mjs | 2.60 |
| 105 | cache-unresolved-access.test.mjs | 2.52 |
| 106 | progress-timeline.test.mjs | 2.51 |
| 107 | partner-interior-access.test.mjs | 2.51 |
| 108 | access.test.mjs | 2.49 |
| 109 | reference.test.mjs | 2.38 |
| 110 | original-sync-web.test.mjs | 2.38 |
| 111 | cache-topology-application.test.mjs | 2.36 |
| 112 | search.test.mjs | 2.34 |
| 113 | projection-reuse.test.mjs | 2.28 |
| 114 | cache-archaeology-application.test.mjs | 2.26 |
| 115 | equipment-reuse.test.mjs | 2.26 |
| 116 | play-view.test.mjs | 2.24 |
| 117 | collection.test.mjs | 2.23 |
| 118 | history-pagination-storage.test.mjs | 2.22 |
| 119 | original-sync.test.mjs | 2.17 |
| 120 | parity-source-regressions.test.mjs | 2.14 |
| 121 | local-parity-model.test.mjs | 2.11 |
| 122 | repository-provenance.test.mjs | 2.10 |
| 123 | f2p-task-membership.test.mjs | 2.08 |
| 124 | map-corrections.test.mjs | 2.08 |
| 125 | retained-task-corrections.test.mjs | 2.07 |
| 126 | task-map-history.test.mjs | 2.05 |
| 127 | map-overlay.test.mjs | 2.04 |
| 128 | engine-hotspots.test.mjs | 2.01 |
| 129 | sandbox.test.mjs | 2.00 |
| 130 | unlock-reuse.test.mjs | 1.98 |
| 131 | coordination-view.test.mjs | 1.96 |
| 132 | migration-scope.test.mjs | 1.93 |
| 133 | area-check-worker.test.mjs | 1.93 |
| 134 | task-ui-server.test.mjs | 1.90 |
| 135 | map-assets-import.test.mjs | 1.89 |
| 136 | progress.test.mjs | 1.89 |
| 137 | invites-storage.test.mjs | 1.85 |
| 138 | migration-identity.test.mjs | 1.79 |
| 139 | map-display-sizes.test.mjs | 1.77 |
| 140 | journal-state.test.mjs | 1.77 |
| 141 | map.test.mjs | 1.76 |
| 142 | archaeology-task-corrections.test.mjs | 1.76 |
| 143 | storage-play.test.mjs | 1.72 |
| 144 | achievement-rules.test.mjs | 1.71 |
| 145 | achievement-metadata-evidence.test.mjs | 1.69 |
| 146 | interiors-v2-view.test.mjs | 1.69 |
| 147 | settings-panel.test.mjs | 1.66 |
| 148 | cache-shop-f2p-membership.test.mjs | 1.64 |
| 149 | retained-wording-corrections.test.mjs | 1.64 |
| 150 | item-membership-data.test.mjs | 1.62 |
| 151 | equipment.test.mjs | 1.62 |
| 152 | map-tools.test.mjs | 1.61 |
| 153 | equipment-permanence-rule.test.mjs | 1.58 |
| 154 | helper-view.test.mjs | 1.57 |
| 155 | item-icons.test.mjs | 1.55 |
| 156 | original-sync-state.test.mjs | 1.53 |
| 157 | review-task-icons.test.mjs | 1.53 |
| 158 | custom-tasks-state.test.mjs | 1.49 |
| 159 | f2p-equipment-membership.test.mjs | 1.49 |
| 160 | scheduler.test.mjs | 1.48 |
| 161 | fishing-planner.test.mjs | 1.48 |
| 162 | completed-view.test.mjs | 1.46 |
| 163 | cache-terrain-renderer.test.mjs | 1.46 |
| 164 | transport-routes.test.mjs | 1.45 |
| 165 | house-storage.test.mjs | 1.44 |
| 166 | roll-stats.test.mjs | 1.42 |
| 167 | area-check.test.mjs | 1.37 |
| 168 | storage-owned-load.test.mjs | 1.36 |
| 169 | map-search-layer.test.mjs | 1.35 |
| 170 | map-capture.test.mjs | 1.34 |
| 171 | light-facts.test.mjs | 1.30 |
| 172 | storage-undo-safety.test.mjs | 1.28 |
| 173 | npc-metadata-evidence.test.mjs | 1.22 |
| 174 | runemetrics-web.test.mjs | 1.20 |
| 175 | task-equipment.test.mjs | 1.19 |
| 176 | automatic-transport.test.mjs | 1.19 |
| 177 | members-start-command.test.mjs | 1.19 |
| 178 | prediction-cache.test.mjs | 1.17 |
| 179 | activity-readiness.test.mjs | 1.17 |
| 180 | mining-preferences.test.mjs | 1.16 |
| 181 | identity-index-scale.test.mjs | 1.15 |
| 182 | settings.test.mjs | 1.14 |
| 183 | map-pin-details.test.mjs | 1.11 |
| 184 | profile-model.test.mjs | 1.08 |
| 185 | map-info-hooks.test.mjs | 1.06 |
| 186 | display-world.test.mjs | 1.06 |
| 187 | chunk-resource-ui.test.mjs | 1.03 |
| 188 | profile-view.test.mjs | 1.03 |
| 189 | world.test.mjs | 1.01 |
| 190 | time-estimates.test.mjs | 0.99 |
| 191 | backlog-reason.test.mjs | 0.95 |
| 192 | death-settings.test.mjs | 0.94 |
| 193 | training-planner.test.mjs | 0.93 |
| 194 | duo-task-lists.test.mjs | 0.93 |
| 195 | skill-guides-extraction.test.mjs | 0.91 |
| 196 | completed-model.test.mjs | 0.89 |
| 197 | duo-peer-view.test.mjs | 0.89 |
| 198 | info-panels.test.mjs | 0.88 |
| 199 | monster-membership-review.test.mjs | 0.88 |
| 200 | item-membership-review.test.mjs | 0.84 |
| 201 | advisory-retirement.test.mjs | 0.79 |
| 202 | cache-collision.test.mjs | 0.78 |
| 203 | death-ui.test.mjs | 0.77 |
| 204 | cache-membership.test.mjs | 0.77 |
| 205 | item-membership-flags.test.mjs | 0.76 |
| 206 | equipment-permanence.test.mjs | 0.75 |
| 207 | original-parity.test.mjs | 0.72 |
| 208 | advanced-preference.test.mjs | 0.72 |
| 209 | duo-tasks.test.mjs | 0.71 |
| 210 | helper-model.test.mjs | 0.70 |
| 211 | screenshot-mode.test.mjs | 0.69 |
| 212 | membership-compile-cache.test.mjs | 0.68 |
| 213 | equipment-weights.test.mjs | 0.68 |
| 214 | feedback-web.test.mjs | 0.67 |
| 215 | map-travel-lines.test.mjs | 0.66 |
| 216 | undo-safety.test.mjs | 0.64 |
| 217 | quest-metadata-evidence.test.mjs | 0.64 |
| 218 | backlog-search.test.mjs | 0.61 |
| 219 | viewer-start.test.mjs | 0.60 |
| 220 | viewer-task-response.test.mjs | 0.59 |
| 221 | item-membership-aliases.test.mjs | 0.59 |
| 222 | map-task-count-renderer.test.mjs | 0.58 |
| 223 | original-parity-diff.test.mjs | 0.56 |
| 224 | source-membership.test.mjs | 0.56 |
| 225 | perf-network-collector.test.mjs | 0.56 |
| 226 | cache-game-data-items.test.mjs | 0.55 |
| 227 | feedback-storage.test.mjs | 0.53 |
| 228 | perf-probe.test.mjs | 0.53 |
| 229 | web-personal.test.mjs | 0.53 |
| 230 | cache-game-data-npcs.test.mjs | 0.53 |
| 231 | woodcutting-preferences.test.mjs | 0.52 |
| 232 | sandbox-client.test.mjs | 0.52 |
| 233 | skill-icons.test.mjs | 0.49 |
| 234 | invites-web.test.mjs | 0.49 |
| 235 | retained-item-icons.test.mjs | 0.49 |
| 236 | map-display-panel.test.mjs | 0.48 |
| 237 | capture.test.mjs | 0.46 |
| 238 | history-reader.test.mjs | 0.46 |
| 239 | pool-ranking-client.test.mjs | 0.45 |
| 240 | map-task-counts.test.mjs | 0.45 |
| 241 | map-terrain.test.mjs | 0.44 |
| 242 | task-icons.test.mjs | 0.42 |
| 243 | map-task-count-obstacles.test.mjs | 0.42 |
| 244 | pool-ranking.test.mjs | 0.41 |
| 245 | chunk-sections-ui.test.mjs | 0.40 |
| 246 | map-rendering-cost.test.mjs | 0.39 |
| 247 | interiors-v2-connections.test.mjs | 0.39 |
| 248 | perf-harness.test.mjs | 0.38 |
| 249 | provenance-hash.test.mjs | 0.36 |
| 250 | map-pin-renderer-cache.test.mjs | 0.36 |
| 251 | combat-level.test.mjs | 0.35 |
| 252 | members-start-web.test.mjs | 0.35 |
| 253 | map-pin-filters.test.mjs | 0.35 |
| 254 | members-start-pools.test.mjs | 0.34 |
| 255 | duo-coordination.test.mjs | 0.34 |
| 256 | roll-stats-dialog.test.mjs | 0.32 |
| 257 | chunk-notes.test.mjs | 0.32 |
| 258 | helper-training.test.mjs | 0.31 |
| 259 | helper-progress-view.test.mjs | 0.31 |
| 260 | training-catalogue.test.mjs | 0.31 |
| 261 | chunk-quest-filters.test.mjs | 0.30 |
| 262 | cache-game-data-objects.test.mjs | 0.30 |
| 263 | map-task-locations.test.mjs | 0.29 |
| 264 | unlock-equivalence-harness.test.mjs | 0.29 |
| 265 | history-dialog.test.mjs | 0.29 |
| 266 | duo-backlog.test.mjs | 0.28 |
| 267 | chunk-planning.test.mjs | 0.28 |
| 268 | tier-item-icons.test.mjs | 0.28 |
| 269 | cache-archaeology-catalogue.test.mjs | 0.27 |
| 270 | quest-map-controls.test.mjs | 0.27 |
| 271 | chunk-sections-map.test.mjs | 0.26 |
| 272 | map-terrain-alignment.test.mjs | 0.24 |
| 273 | cache-selector-mapping.test.mjs | 0.24 |
| 274 | automatic-teleport-catalogue.test.mjs | 0.23 |
| 275 | cache-resource-selectors-expanded.test.mjs | 0.23 |
| 276 | backup-status-web.test.mjs | 0.23 |
| 277 | equipment-correction-builder.test.mjs | 0.23 |
| 278 | fishing-rates.test.mjs | 0.22 |
| 279 | quest-map-model.test.mjs | 0.21 |
| 280 | fishing-display.test.mjs | 0.21 |
| 281 | duo-web.test.mjs | 0.21 |
| 282 | task-filters-view.test.mjs | 0.20 |
| 283 | copy-list-control.test.mjs | 0.20 |
| 284 | http-response.test.mjs | 0.20 |
| 285 | cache-game-data-shops.test.mjs | 0.19 |
| 286 | custom-tasks-view.test.mjs | 0.19 |
| 287 | task-filters.test.mjs | 0.19 |
| 288 | area-check-selection.test.mjs | 0.19 |
| 289 | area-check-controller.test.mjs | 0.19 |
| 290 | copy-lists-view.test.mjs | 0.19 |
| 291 | cache-pins.test.mjs | 0.19 |
| 292 | command-state.test.mjs | 0.18 |
| 293 | equipment-wiki.test.mjs | 0.18 |
| 294 | bis-compare.test.mjs | 0.18 |
| 295 | backlog-tools.test.mjs | 0.18 |
| 296 | activity-filters.test.mjs | 0.18 |
| 297 | completed-range-preference.test.mjs | 0.17 |
| 298 | task-hover.test.mjs | 0.17 |
| 299 | activity-view.test.mjs | 0.17 |
| 300 | woodcutting-rates.test.mjs | 0.17 |
| 301 | helper-custom-tasks.test.mjs | 0.17 |
| 302 | history-text.test.mjs | 0.16 |
| 303 | cache-game-data-common.test.mjs | 0.16 |
| 304 | gameplay-fingerprint.test.mjs | 0.16 |
| 305 | cache-pin-application.test.mjs | 0.16 |
| 306 | terrain-viewport.test.mjs | 0.16 |
| 307 | cache-game-data-quests.test.mjs | 0.16 |
| 308 | teleports-web.test.mjs | 0.16 |
| 309 | workers-idle.test.mjs | 0.16 |
| 310 | cache-reader.test.mjs | 0.15 |
| 311 | copy-list-model.test.mjs | 0.15 |
| 312 | icons.test.mjs | 0.15 |
| 313 | task-icon-painter.test.mjs | 0.15 |
| 314 | completed-range.test.mjs | 0.15 |
| 315 | skillguide-combat-corrections.test.mjs | 0.15 |
| 316 | stream-safe.test.mjs | 0.15 |
| 317 | cache-game-data-recipes.test.mjs | 0.14 |
| 318 | worker-watchdog.test.mjs | 0.14 |
| 319 | sticker-flyout.test.mjs | 0.14 |
| 320 | bis-controls.test.mjs | 0.14 |
| 321 | updates.test.mjs | 0.13 |
| 322 | unlock-calc-harness.test.mjs | 0.12 |
| 323 | unlock-paired-harness.test.mjs | 0.11 |
| 324 | task-claims-web.test.mjs | 0.11 |
| 325 | test-selection.test.mjs | 0.10 |

## Fastest full trial complete ranking (C4, rejected memory setting)

| Rank | File in tests/ | Wall seconds |
| --- | --- | ---: |
| 1 | server.test.mjs | 38.17 |
| 2 | storage-reliability.test.mjs | 28.35 |
| 3 | identity-startup.test.mjs | 25.39 |
| 4 | play-server.test.mjs | 23.50 |
| 5 | task-claim-server.test.mjs | 21.67 |
| 6 | identity-records.test.mjs | 20.02 |
| 7 | duo-server.test.mjs | 18.22 |
| 8 | viewer-permissions.test.mjs | 17.80 |
| 9 | command-performance.test.mjs | 17.56 |
| 10 | watchdog-script.test.mjs | 16.82 |
| 11 | sandbox-server.test.mjs | 16.82 |
| 12 | worker-timings.test.mjs | 16.66 |
| 13 | runemetrics-server.test.mjs | 15.70 |
| 14 | training-server.test.mjs | 15.07 |
| 15 | preview-resource-contents.test.mjs | 14.56 |
| 16 | scheduling-server.test.mjs | 14.43 |
| 17 | transport-access.test.mjs | 14.35 |
| 18 | preview-archaeology.test.mjs | 13.00 |
| 19 | skill-guides-data.test.mjs | 12.97 |
| 20 | death-worker.test.mjs | 12.87 |
| 21 | server-reliability.test.mjs | 12.80 |
| 22 | preview-equipment-corrections.test.mjs | 12.34 |
| 23 | prediction-server.test.mjs | 11.72 |
| 24 | pool-ranking-server.test.mjs | 11.55 |
| 25 | operations.test.mjs | 11.33 |
| 26 | operations-forced.test.mjs | 10.34 |
| 27 | area-check-server.test.mjs | 9.14 |
| 28 | operations-owner.test.mjs | 8.95 |
| 29 | original-sync-server.test.mjs | 8.93 |
| 30 | invites-server.test.mjs | 8.50 |
| 31 | parity-progress-aliases.test.mjs | 7.59 |
| 32 | multisticker-picker.test.mjs | 7.14 |
| 33 | cache-island-policy.test.mjs | 7.04 |
| 34 | prediction-output.test.mjs | 6.95 |
| 35 | operations-graceful.test.mjs | 6.59 |
| 36 | obtained-equipment-server.test.mjs | 6.18 |
| 37 | operations-degraded.test.mjs | 5.89 |
| 38 | journal-server.test.mjs | 5.80 |
| 39 | engine.test.mjs | 5.78 |
| 40 | identity.test.mjs | 5.27 |
| 41 | activity.test.mjs | 5.24 |
| 42 | skill-guides-preview.test.mjs | 4.81 |
| 43 | preview-metadata-corrections.test.mjs | 4.79 |
| 44 | storage-static.test.mjs | 4.77 |
| 45 | tasks.test.mjs | 4.75 |
| 46 | terrain-assets-server.test.mjs | 4.17 |
| 47 | state.test.mjs | 4.09 |
| 48 | web-browser.test.mjs | 4.04 |
| 49 | cache-resources-catalogue.test.mjs | 3.90 |
| 50 | transport-audit.test.mjs | 3.88 |
| 51 | house-storage-server.test.mjs | 3.81 |
| 52 | migration.test.mjs | 3.75 |
| 53 | helper-server.test.mjs | 3.63 |
| 54 | backup-status.test.mjs | 3.62 |
| 55 | migration-scale.test.mjs | 3.61 |
| 56 | cache-comparison.test.mjs | 3.53 |
| 57 | automatic-travel-integration.test.mjs | 3.51 |
| 58 | skill-guides-runtime.test.mjs | 3.34 |
| 59 | map-info-server.test.mjs | 3.32 |
| 60 | icons-server.test.mjs | 3.28 |
| 61 | task-claims.test.mjs | 3.23 |
| 62 | mining-rates.test.mjs | 3.17 |
| 63 | map-assets-server.test.mjs | 3.08 |
| 64 | interiors-v2-server.test.mjs | 3.05 |
| 65 | equipment-corrections.test.mjs | 2.99 |
| 66 | metadata-corrections.test.mjs | 2.95 |
| 67 | cache-resources-retained-access.test.mjs | 2.95 |
| 68 | history-pagination-server.test.mjs | 2.93 |
| 69 | original-sync-local.test.mjs | 2.91 |
| 70 | storage.test.mjs | 2.89 |
| 71 | backup-watchdog-server.test.mjs | 2.88 |
| 72 | archmaps-server.test.mjs | 2.86 |
| 73 | cache-resources-expanded-application.test.mjs | 2.85 |
| 74 | task-map-history.test.mjs | 2.75 |
| 75 | members-start-server.test.mjs | 2.65 |
| 76 | runemetrics.test.mjs | 2.56 |
| 77 | unlock-reuse.test.mjs | 2.56 |
| 78 | task-ui-server.test.mjs | 2.41 |
| 79 | custom-tasks-server.test.mjs | 2.40 |
| 80 | npcs-and-shops-application.test.mjs | 2.40 |
| 81 | lodestone-metadata.test.mjs | 2.30 |
| 82 | roll-stats-server.test.mjs | 2.29 |
| 83 | processing-parity.test.mjs | 2.24 |
| 84 | cache-archaeology-provenance.test.mjs | 2.24 |
| 85 | cache-resources-server.test.mjs | 2.22 |
| 86 | interiors-v2-catalogue.test.mjs | 2.21 |
| 87 | chunk-sections.test.mjs | 2.13 |
| 88 | multisticker-server.test.mjs | 2.12 |
| 89 | cache-task-access.test.mjs | 2.09 |
| 90 | transport-routes.test.mjs | 2.05 |
| 91 | preview-source-loss.test.mjs | 2.04 |
| 92 | history-pagination-storage.test.mjs | 1.99 |
| 93 | area-check-worker.test.mjs | 1.96 |
| 94 | cache-archaeology-application.test.mjs | 1.95 |
| 95 | retained-entry-corrections.test.mjs | 1.87 |
| 96 | calculation-equivalence.test.mjs | 1.84 |
| 97 | rules-fixes.test.mjs | 1.81 |
| 98 | interior-maps.test.mjs | 1.80 |
| 99 | equipment-permanence-worker.test.mjs | 1.80 |
| 100 | cache-resources-application.test.mjs | 1.78 |
| 101 | original-task-sync.test.mjs | 1.72 |
| 102 | cache-unresolved-access.test.mjs | 1.63 |
| 103 | engine-hotspots.test.mjs | 1.61 |
| 104 | access.test.mjs | 1.60 |
| 105 | requirement-alternatives.test.mjs | 1.60 |
| 106 | f2p-task-membership.test.mjs | 1.59 |
| 107 | partner.test.mjs | 1.58 |
| 108 | storage-undo-safety.test.mjs | 1.56 |
| 109 | collection.test.mjs | 1.54 |
| 110 | roll-stats-storage.test.mjs | 1.52 |
| 111 | helper-view.test.mjs | 1.52 |
| 112 | task-equipment.test.mjs | 1.50 |
| 113 | storage-play.test.mjs | 1.49 |
| 114 | planning.test.mjs | 1.45 |
| 115 | achievement-rules.test.mjs | 1.45 |
| 116 | invite-attribution.test.mjs | 1.45 |
| 117 | cache-topology-application.test.mjs | 1.43 |
| 118 | time-estimates.test.mjs | 1.43 |
| 119 | parity-diary-equipment.test.mjs | 1.42 |
| 120 | reference.test.mjs | 1.41 |
| 121 | cache-shop-f2p-membership.test.mjs | 1.41 |
| 122 | area-check.test.mjs | 1.40 |
| 123 | rules.test.mjs | 1.39 |
| 124 | runemetrics-state.test.mjs | 1.39 |
| 125 | progress-timeline.test.mjs | 1.37 |
| 126 | parity-source-regressions.test.mjs | 1.37 |
| 127 | partner-interior-access.test.mjs | 1.35 |
| 128 | automatic-transport.test.mjs | 1.34 |
| 129 | training-planner.test.mjs | 1.33 |
| 130 | map-connections.test.mjs | 1.33 |
| 131 | skill-guide-milestones.test.mjs | 1.32 |
| 132 | house-storage.test.mjs | 1.32 |
| 133 | coordination-view.test.mjs | 1.32 |
| 134 | equipment.test.mjs | 1.31 |
| 135 | archaeology-task-corrections.test.mjs | 1.31 |
| 136 | storage-owned-load.test.mjs | 1.30 |
| 137 | obtained-equipment.test.mjs | 1.29 |
| 138 | equipment-reuse.test.mjs | 1.24 |
| 139 | f2p-equipment-membership.test.mjs | 1.23 |
| 140 | fishing-planner.test.mjs | 1.22 |
| 141 | activity-readiness.test.mjs | 1.22 |
| 142 | projection-reuse.test.mjs | 1.21 |
| 143 | rules-panel.test.mjs | 1.21 |
| 144 | equipment-permanence-rule.test.mjs | 1.19 |
| 145 | presentation.test.mjs | 1.18 |
| 146 | progress.test.mjs | 1.17 |
| 147 | world.test.mjs | 1.16 |
| 148 | multisticker-state.test.mjs | 1.15 |
| 149 | map-corrections.test.mjs | 1.09 |
| 150 | item-icons.test.mjs | 1.08 |
| 151 | cache-terrain-renderer.test.mjs | 1.07 |
| 152 | interiors-v2-view.test.mjs | 1.04 |
| 153 | local-parity-model.test.mjs | 1.04 |
| 154 | map-display-sizes.test.mjs | 1.01 |
| 155 | retained-task-corrections.test.mjs | 1.00 |
| 156 | completed-view.test.mjs | 1.00 |
| 157 | map-capture.test.mjs | 0.99 |
| 158 | migration-identity.test.mjs | 0.98 |
| 159 | map-overlay.test.mjs | 0.98 |
| 160 | original-sync.test.mjs | 0.97 |
| 161 | search.test.mjs | 0.96 |
| 162 | identity-index-scale.test.mjs | 0.95 |
| 163 | migration-scope.test.mjs | 0.95 |
| 164 | custom-tasks-state.test.mjs | 0.93 |
| 165 | backlog-reason.test.mjs | 0.91 |
| 166 | retained-wording-corrections.test.mjs | 0.90 |
| 167 | play-view.test.mjs | 0.89 |
| 168 | scheduler.test.mjs | 0.86 |
| 169 | viewer-start.test.mjs | 0.83 |
| 170 | map.test.mjs | 0.83 |
| 171 | runemetrics-web.test.mjs | 0.82 |
| 172 | prediction-cache.test.mjs | 0.81 |
| 173 | map-tools.test.mjs | 0.80 |
| 174 | item-membership-data.test.mjs | 0.80 |
| 175 | repository-provenance.test.mjs | 0.80 |
| 176 | journal-state.test.mjs | 0.80 |
| 177 | settings-panel.test.mjs | 0.78 |
| 178 | sandbox.test.mjs | 0.77 |
| 179 | undo-safety.test.mjs | 0.76 |
| 180 | chunk-resource-ui.test.mjs | 0.75 |
| 181 | display-world.test.mjs | 0.75 |
| 182 | completed-model.test.mjs | 0.75 |
| 183 | map-search-layer.test.mjs | 0.74 |
| 184 | original-sync-web.test.mjs | 0.73 |
| 185 | advisory-retirement.test.mjs | 0.73 |
| 186 | cache-membership.test.mjs | 0.72 |
| 187 | viewer-task-response.test.mjs | 0.72 |
| 188 | cache-collision.test.mjs | 0.71 |
| 189 | death-ui.test.mjs | 0.71 |
| 190 | roll-stats.test.mjs | 0.70 |
| 191 | web-personal.test.mjs | 0.70 |
| 192 | original-sync-state.test.mjs | 0.67 |
| 193 | skill-guides-extraction.test.mjs | 0.67 |
| 194 | profile-view.test.mjs | 0.66 |
| 195 | mining-preferences.test.mjs | 0.65 |
| 196 | members-start-command.test.mjs | 0.64 |
| 197 | advanced-preference.test.mjs | 0.64 |
| 198 | death-settings.test.mjs | 0.63 |
| 199 | profile-model.test.mjs | 0.62 |
| 200 | source-membership.test.mjs | 0.61 |
| 201 | duo-task-lists.test.mjs | 0.61 |
| 202 | duo-tasks.test.mjs | 0.60 |
| 203 | cache-game-data-items.test.mjs | 0.60 |
| 204 | cache-game-data-npcs.test.mjs | 0.58 |
| 205 | helper-model.test.mjs | 0.58 |
| 206 | invites-storage.test.mjs | 0.58 |
| 207 | review-task-icons.test.mjs | 0.58 |
| 208 | woodcutting-preferences.test.mjs | 0.58 |
| 209 | task-icons.test.mjs | 0.57 |
| 210 | duo-peer-view.test.mjs | 0.57 |
| 211 | light-facts.test.mjs | 0.53 |
| 212 | map-assets-import.test.mjs | 0.51 |
| 213 | npc-metadata-evidence.test.mjs | 0.50 |
| 214 | backlog-search.test.mjs | 0.50 |
| 215 | map-pin-details.test.mjs | 0.47 |
| 216 | skill-icons.test.mjs | 0.45 |
| 217 | history-reader.test.mjs | 0.45 |
| 218 | achievement-metadata-evidence.test.mjs | 0.45 |
| 219 | feedback-web.test.mjs | 0.43 |
| 220 | equipment-permanence.test.mjs | 0.42 |
| 221 | map-info-hooks.test.mjs | 0.41 |
| 222 | item-membership-review.test.mjs | 0.40 |
| 223 | equipment-weights.test.mjs | 0.40 |
| 224 | training-catalogue.test.mjs | 0.39 |
| 225 | quest-metadata-evidence.test.mjs | 0.39 |
| 226 | monster-membership-review.test.mjs | 0.38 |
| 227 | map-travel-lines.test.mjs | 0.37 |
| 228 | tier-item-icons.test.mjs | 0.36 |
| 229 | unlock-equivalence-harness.test.mjs | 0.36 |
| 230 | membership-compile-cache.test.mjs | 0.35 |
| 231 | automatic-teleport-catalogue.test.mjs | 0.35 |
| 232 | feedback-storage.test.mjs | 0.34 |
| 233 | item-membership-flags.test.mjs | 0.32 |
| 234 | map-task-count-renderer.test.mjs | 0.31 |
| 235 | info-panels.test.mjs | 0.30 |
| 236 | item-membership-aliases.test.mjs | 0.28 |
| 237 | helper-training.test.mjs | 0.28 |
| 238 | task-filters.test.mjs | 0.27 |
| 239 | cache-game-data-objects.test.mjs | 0.27 |
| 240 | backup-status-web.test.mjs | 0.26 |
| 241 | cache-archaeology-catalogue.test.mjs | 0.26 |
| 242 | map-terrain.test.mjs | 0.26 |
| 243 | chunk-sections-map.test.mjs | 0.25 |
| 244 | helper-progress-view.test.mjs | 0.25 |
| 245 | test-selection.test.mjs | 0.24 |
| 246 | history-dialog.test.mjs | 0.24 |
| 247 | chunk-planning.test.mjs | 0.24 |
| 248 | fishing-rates.test.mjs | 0.24 |
| 249 | retained-item-icons.test.mjs | 0.24 |
| 250 | task-hover.test.mjs | 0.24 |
| 251 | screenshot-mode.test.mjs | 0.23 |
| 252 | chunk-sections-ui.test.mjs | 0.22 |
| 253 | task-filters-view.test.mjs | 0.22 |
| 254 | woodcutting-rates.test.mjs | 0.22 |
| 255 | map-rendering-cost.test.mjs | 0.22 |
| 256 | task-icon-painter.test.mjs | 0.21 |
| 257 | cache-resource-selectors-expanded.test.mjs | 0.21 |
| 258 | map-pin-renderer-cache.test.mjs | 0.21 |
| 259 | sandbox-client.test.mjs | 0.21 |
| 260 | backlog-tools.test.mjs | 0.20 |
| 261 | terrain-viewport.test.mjs | 0.20 |
| 262 | cache-selector-mapping.test.mjs | 0.20 |
| 263 | pool-ranking.test.mjs | 0.19 |
| 264 | settings.test.mjs | 0.19 |
| 265 | sticker-flyout.test.mjs | 0.19 |
| 266 | cache-game-data-shops.test.mjs | 0.19 |
| 267 | duo-web.test.mjs | 0.19 |
| 268 | invites-web.test.mjs | 0.18 |
| 269 | activity-view.test.mjs | 0.18 |
| 270 | original-parity-diff.test.mjs | 0.18 |
| 271 | map-pin-filters.test.mjs | 0.18 |
| 272 | updates.test.mjs | 0.18 |
| 273 | roll-stats-dialog.test.mjs | 0.18 |
| 274 | stream-safe.test.mjs | 0.17 |
| 275 | http-response.test.mjs | 0.17 |
| 276 | duo-backlog.test.mjs | 0.17 |
| 277 | members-start-web.test.mjs | 0.17 |
| 278 | area-check-controller.test.mjs | 0.17 |
| 279 | perf-probe.test.mjs | 0.17 |
| 280 | cache-game-data-common.test.mjs | 0.17 |
| 281 | map-display-panel.test.mjs | 0.17 |
| 282 | perf-harness.test.mjs | 0.17 |
| 283 | pool-ranking-client.test.mjs | 0.16 |
| 284 | fishing-display.test.mjs | 0.16 |
| 285 | provenance-hash.test.mjs | 0.16 |
| 286 | teleports-web.test.mjs | 0.16 |
| 287 | custom-tasks-view.test.mjs | 0.16 |
| 288 | copy-list-model.test.mjs | 0.16 |
| 289 | chunk-notes.test.mjs | 0.16 |
| 290 | capture.test.mjs | 0.16 |
| 291 | map-task-count-obstacles.test.mjs | 0.16 |
| 292 | map-task-counts.test.mjs | 0.16 |
| 293 | icons.test.mjs | 0.16 |
| 294 | chunk-quest-filters.test.mjs | 0.16 |
| 295 | skillguide-combat-corrections.test.mjs | 0.15 |
| 296 | task-claims-web.test.mjs | 0.15 |
| 297 | members-start-pools.test.mjs | 0.15 |
| 298 | cache-game-data-quests.test.mjs | 0.15 |
| 299 | cache-pins.test.mjs | 0.15 |
| 300 | gameplay-fingerprint.test.mjs | 0.15 |
| 301 | history-text.test.mjs | 0.15 |
| 302 | perf-network-collector.test.mjs | 0.15 |
| 303 | original-parity.test.mjs | 0.15 |
| 304 | helper-custom-tasks.test.mjs | 0.15 |
| 305 | cache-pin-application.test.mjs | 0.15 |
| 306 | equipment-correction-builder.test.mjs | 0.15 |
| 307 | duo-coordination.test.mjs | 0.14 |
| 308 | map-terrain-alignment.test.mjs | 0.14 |
| 309 | copy-lists-view.test.mjs | 0.14 |
| 310 | unlock-paired-harness.test.mjs | 0.14 |
| 311 | quest-map-controls.test.mjs | 0.14 |
| 312 | unlock-calc-harness.test.mjs | 0.14 |
| 313 | workers-idle.test.mjs | 0.14 |
| 314 | quest-map-model.test.mjs | 0.14 |
| 315 | cache-game-data-recipes.test.mjs | 0.13 |
| 316 | activity-filters.test.mjs | 0.13 |
| 317 | combat-level.test.mjs | 0.13 |
| 318 | command-state.test.mjs | 0.13 |
| 319 | copy-list-control.test.mjs | 0.13 |
| 320 | bis-compare.test.mjs | 0.13 |
| 321 | interiors-v2-connections.test.mjs | 0.13 |
| 322 | completed-range-preference.test.mjs | 0.13 |
| 323 | worker-watchdog.test.mjs | 0.13 |
| 324 | completed-range.test.mjs | 0.13 |
| 325 | bis-controls.test.mjs | 0.13 |
| 326 | cache-reader.test.mjs | 0.13 |
| 327 | map-task-locations.test.mjs | 0.12 |
| 328 | equipment-wiki.test.mjs | 0.12 |
| 329 | area-check-selection.test.mjs | 0.12 |

## Merge decision (2026-10-13)

Claude measured one full run at three files after merging: 3,413 tests, 3,412 passed, zero failures, 4m25s wall, about 3,262 MiB peak working set. The previous merged batch took 6m14s at two files. Three is now the default (`fullConcurrency`); `RS3_TEST_CONCURRENCY` overrides it for a single run. Four files saved about 40 more seconds for roughly 450 MiB more and was left out because the live picker shares this PC.
