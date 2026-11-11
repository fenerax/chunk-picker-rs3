# Snapshot prediction and preservation validation

Follow-up to PR #200 head `fe49c1b`. Synthetic fixtures only, Node 24.20.0, complete per-file `testRunPolicy` environments, one test process at a time at BelowNormal priority. No full suite, repetition campaign or acceptance workflow was run.

Selection used `rg` over `tests/` for worker, scheduler and snapshot module paths, prediction/planning modules and candidate callers; helper-backed resident-planning GC and calculation equivalence were included explicitly. Configuration-only mentions and unrelated workers/schedulers were excluded after the broad initial scan. Completed extra invocations remain in the table below.

All 122 files in the module/caller inventory were invoked sequentially; 121 exited successfully and 1 has the main-source control failure described below. Including broad-grep extras, 146 files were invoked: 1886 passing cases, 31 skipped, 2 reported failures, 0 cancelled. One reported failure is the interrupted configuration-only extra described below.

The HTTP detail baseline-hit assertion in `death-worker.test.mjs` fails locally. Substituting unchanged main `202cd5d` versions of `worker.mjs`, `scheduler.mjs` and `core/planning.mjs` reproduces that same assertion (six passing cases, one failure). Diagnostic probes show a fresh cache for the detail request, without measurement or demotion errors. This control does not substitute the entire application. That test is unchanged and no lane admission code was changed.

The expanded run exposed an owned-dictionary retention regression. It was fixed by making both cached prediction state and deferred-view state explicit data. The original owned-calculator comparison plus a new prediction-first/resident-planning/deferred-view equivalence case pass after that fix. Affected differential, engine-equivalence, prediction-output and snapshot-accounting files were rechecked after the code change. Table entries show the latest result per file; diagnostic runs were not pass-seeking retries.

The sandbox consumer test also assumed the removed shared memoized parse. Application sandbox consumers use signatures/revisions and result fields, not scheduler object identity. The test now checks complete deep equality and one parse per object consumer, retaining all byte-laziness and quota assertions.

`linux-multi-picker.test.mjs` only matched because its server fixture disables prediction prewarming. It stalled during the broad-grep extra run and its confirmed owned test process was stopped. It is outside the module/caller inventory, was not retried, and is reported as interrupted rather than an application assertion failure.

Brief synthetic latency recheck: warm p95 96 ms (seven actions); cold p95 1214 ms (eight groups). This is an unpaired sanity sample. The earlier paired main/candidate measurements remain in [the retention report](calculation-retention.md).

| Test file | Passed | Skipped | Failed | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| [advisory-retirement.test.mjs](../tests/advisory-retirement.test.mjs) | 8 | 0 | 0 | 0 |
| [area-check-controller.test.mjs](../tests/area-check-controller.test.mjs) (extra) | 15 | 0 | 0 | 0 |
| [area-check-server.private.test.mjs](../tests/area-check-server.private.test.mjs) (extra) | 5 | 0 | 0 | 0 |
| [area-check-server.test.mjs](../tests/area-check-server.test.mjs) | 1 | 0 | 0 | 0 |
| [area-check-worker.test.mjs](../tests/area-check-worker.test.mjs) | 1 | 0 | 0 | 0 |
| [area-check.private.test.mjs](../tests/area-check.private.test.mjs) | 15 | 0 | 0 | 0 |
| [area-check.test.mjs](../tests/area-check.test.mjs) | 7 | 0 | 0 | 0 |
| [art-pack-server.test.mjs](../tests/art-pack-server.test.mjs) (extra) | 1 | 6 | 0 | 0 |
| [automatic-travel-integration.test.mjs](../tests/automatic-travel-integration.test.mjs) (extra) | 8 | 0 | 0 | 0 |
| [backup-file-browser.test.mjs](../tests/backup-file-browser.test.mjs) (extra) | 3 | 0 | 0 | 0 |
| [backup-import-server.test.mjs](../tests/backup-import-server.test.mjs) (extra) | 15 | 0 | 0 | 0 |
| [backup-watchdog-server.test.mjs](../tests/backup-watchdog-server.test.mjs) | 1 | 0 | 0 | 0 |
| [browser-module-graph.test.mjs](../tests/browser-module-graph.test.mjs) | 1 | 0 | 0 | 0 |
| [cache-comparison.test.mjs](../tests/cache-comparison.test.mjs) | 4 | 0 | 0 | 0 |
| [calc-check.test.mjs](../tests/calc-check.test.mjs) | 11 | 0 | 0 | 0 |
| [calculation-equivalence.test.mjs](../tests/calculation-equivalence.test.mjs) | 2 | 0 | 0 | 0 |
| [calculation-feedback.test.mjs](../tests/calculation-feedback.test.mjs) | 3 | 0 | 0 | 0 |
| [calculation-retention.test.mjs](../tests/calculation-retention.test.mjs) | 1 | 0 | 0 | 0 |
| [calculator-bundle-worker.test.mjs](../tests/calculator-bundle-worker.test.mjs) | 1 | 0 | 0 | 0 |
| [capacity-fixture.test.mjs](../tests/capacity-fixture.test.mjs) | 3 | 1 | 0 | 0 |
| [capacity-harness.test.mjs](../tests/capacity-harness.test.mjs) | 16 | 0 | 0 | 0 |
| [capacity-realism.test.mjs](../tests/capacity-realism.test.mjs) | 12 | 0 | 0 | 0 |
| [chunk-colours-server.test.mjs](../tests/chunk-colours-server.test.mjs) (extra) | 3 | 0 | 0 | 0 |
| [chunk-planning.test.mjs](../tests/chunk-planning.test.mjs) | 11 | 0 | 0 | 0 |
| [chunk-resource-ui.test.mjs](../tests/chunk-resource-ui.test.mjs) (extra) | 6 | 0 | 0 | 0 |
| [ci-release-rehearsal.test.mjs](../tests/ci-release-rehearsal.test.mjs) (extra) | 30 | 0 | 0 | 0 |
| [clue-display-labels.test.mjs](../tests/clue-display-labels.test.mjs) | 3 | 0 | 0 | 0 |
| [custom-tasks-server.test.mjs](../tests/custom-tasks-server.test.mjs) (extra) | 2 | 0 | 0 | 0 |
| [dataset-startup.test.mjs](../tests/dataset-startup.test.mjs) | 6 | 0 | 0 | 0 |
| [death-worker.test.mjs](../tests/death-worker.test.mjs) | 6 | 0 | 1 | 0 |
| [duo-focus-browser.test.mjs](../tests/duo-focus-browser.test.mjs) (extra) | 27 | 0 | 0 | 0 |
| [duo-server.test.mjs](../tests/duo-server.test.mjs) | 14 | 0 | 0 | 0 |
| [eligibility-reuse.test.mjs](../tests/eligibility-reuse.test.mjs) | 8 | 0 | 0 | 0 |
| [engine-cache-multi-picker.test.mjs](../tests/engine-cache-multi-picker.test.mjs) | 1 | 0 | 0 | 0 |
| [engine-cache-snapshot.test.mjs](../tests/engine-cache-snapshot.test.mjs) | 24 | 0 | 0 | 0 |
| [engine-cache-worker.test.mjs](../tests/engine-cache-worker.test.mjs) | 7 | 0 | 0 | 0 |
| [equipment-corrections.test.mjs](../tests/equipment-corrections.test.mjs) | 11 | 0 | 0 | 0 |
| [equipment-permanence-worker.test.mjs](../tests/equipment-permanence-worker.test.mjs) | 1 | 0 | 0 | 0 |
| [finish-line-server.test.mjs](../tests/finish-line-server.test.mjs) (extra) | 3 | 0 | 0 | 0 |
| [frontdoor-ingress.test.mjs](../tests/frontdoor-ingress.test.mjs) (extra) | 3 | 0 | 0 | 0 |
| [gallery-server.test.mjs](../tests/gallery-server.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [game-plugin-routes.test.mjs](../tests/game-plugin-routes.test.mjs) (extra) | 13 | 0 | 0 | 0 |
| [game-plugin-shutdown.test.mjs](../tests/game-plugin-shutdown.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [group-goals-server.test.mjs](../tests/group-goals-server.test.mjs) (extra) | 3 | 0 | 0 | 0 |
| [helper-server.test.mjs](../tests/helper-server.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [history-pagination-server.test.mjs](../tests/history-pagination-server.test.mjs) (extra) | 2 | 0 | 0 | 0 |
| [house-storage-server.test.mjs](../tests/house-storage-server.test.mjs) | 1 | 0 | 0 | 0 |
| [idle-memory-server.private.test.mjs](../tests/idle-memory-server.private.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [idle-memory-server.test.mjs](../tests/idle-memory-server.test.mjs) | 6 | 0 | 0 | 0 |
| [incremental-engine-profile.test.mjs](../tests/incremental-engine-profile.test.mjs) | 6 | 0 | 0 | 0 |
| [invites-server.private.test.mjs](../tests/invites-server.private.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [invites-server.test.mjs](../tests/invites-server.test.mjs) | 25 | 0 | 0 | 0 |
| [journal-server.private.test.mjs](../tests/journal-server.private.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [journal-server.test.mjs](../tests/journal-server.test.mjs) (extra) | 1 | 0 | 0 | 0 |
| [linux-multi-picker.test.mjs](../tests/linux-multi-picker.test.mjs) (extra) (interrupted) | 14 | 0 | 1 | 0 |
| [live-swap-server.test.mjs](../tests/live-swap-server.test.mjs) | 14 | 0 | 0 | 0 |
| [live-timings-server.test.mjs](../tests/live-timings-server.test.mjs) | 5 | 0 | 0 | 0 |
| [live-timings.test.mjs](../tests/live-timings.test.mjs) | 29 | 0 | 0 | 0 |
| [map-availability.test.mjs](../tests/map-availability.test.mjs) | 4 | 0 | 0 | 0 |
| [overlay-routes.test.mjs](../tests/overlay-routes.test.mjs) | 9 | 0 | 0 | 0 |
| [owned-acceptance-lifecycle.test.mjs](../tests/owned-acceptance-lifecycle.test.mjs) | 11 | 0 | 0 | 0 |
| [owned-calculator.test.mjs](../tests/owned-calculator.test.mjs) | 7 | 0 | 0 | 0 |
| [partner.test.mjs](../tests/partner.test.mjs) | 18 | 0 | 0 | 0 |
| [perf-probe.test.mjs](../tests/perf-probe.test.mjs) | 2 | 0 | 0 | 0 |
| [perf-stack-server.test.mjs](../tests/perf-stack-server.test.mjs) | 1 | 0 | 0 | 0 |
| [phase1-acceptance.test.mjs](../tests/phase1-acceptance.test.mjs) | 21 | 0 | 0 | 0 |
| [phone-controls-browser.test.mjs](../tests/phone-controls-browser.test.mjs) | 6 | 0 | 0 | 0 |
| [picker-audit-c2.test.mjs](../tests/picker-audit-c2.test.mjs) | 11 | 0 | 0 | 0 |
| [picker-calculator-cap.test.mjs](../tests/picker-calculator-cap.test.mjs) | 29 | 0 | 0 | 0 |
| [picker-context.test.mjs](../tests/picker-context.test.mjs) | 30 | 0 | 0 | 0 |
| [picker-deletion.test.mjs](../tests/picker-deletion.test.mjs) | 14 | 0 | 0 | 0 |
| [picker-fairness-isolation.test.mjs](../tests/picker-fairness-isolation.test.mjs) | 16 | 0 | 0 | 0 |
| [picker-jobs.test.mjs](../tests/picker-jobs.test.mjs) | 12 | 0 | 0 | 0 |
| [picker-limits-http.test.mjs](../tests/picker-limits-http.test.mjs) | 9 | 0 | 0 | 0 |
| [picker-routing.test.mjs](../tests/picker-routing.test.mjs) | 38 | 0 | 0 | 0 |
| [planning.private.test.mjs](../tests/planning.private.test.mjs) | 1 | 0 | 0 | 0 |
| [planning.test.mjs](../tests/planning.test.mjs) | 11 | 0 | 0 | 0 |
| [play-server.test.mjs](../tests/play-server.test.mjs) | 12 | 0 | 0 | 0 |
| [plugin-reads-server.test.mjs](../tests/plugin-reads-server.test.mjs) | 4 | 0 | 0 | 0 |
| [plugin-reads.test.mjs](../tests/plugin-reads.test.mjs) | 10 | 0 | 0 | 0 |
| [pool-ranking-client.test.mjs](../tests/pool-ranking-client.test.mjs) | 9 | 0 | 0 | 0 |
| [pool-ranking-server.test.mjs](../tests/pool-ranking-server.test.mjs) | 4 | 0 | 0 | 0 |
| [pool-ranking.test.mjs](../tests/pool-ranking.test.mjs) | 8 | 0 | 0 | 0 |
| [prediction-cache.test.mjs](../tests/prediction-cache.test.mjs) | 33 | 0 | 0 | 0 |
| [prediction-output.private.test.mjs](../tests/prediction-output.private.test.mjs) | 7 | 0 | 0 | 0 |
| [prediction-output.test.mjs](../tests/prediction-output.test.mjs) | 3 | 0 | 0 | 0 |
| [prediction-server.private.test.mjs](../tests/prediction-server.private.test.mjs) | 3 | 0 | 0 | 0 |
| [prediction-server.test.mjs](../tests/prediction-server.test.mjs) | 7 | 0 | 0 | 0 |
| [prepared-collection.test.mjs](../tests/prepared-collection.test.mjs) | 18 | 0 | 0 | 0 |
| [preview-proof-seed.test.mjs](../tests/preview-proof-seed.test.mjs) | 14 | 0 | 0 | 0 |
| [prewarm-process-tree.test.mjs](../tests/prewarm-process-tree.test.mjs) | 0 | 1 | 0 | 0 |
| [process-worker.test.mjs](../tests/process-worker.test.mjs) | 58 | 0 | 0 | 0 |
| [public-candidate-server.test.mjs](../tests/public-candidate-server.test.mjs) | 1 | 0 | 0 | 0 |
| [q2-diff-engine.test.mjs](../tests/q2-diff-engine.test.mjs) | 8 | 0 | 0 | 0 |
| [request-failures.test.mjs](../tests/request-failures.test.mjs) | 10 | 0 | 0 | 0 |
| [resident-planning-gc.test.mjs](../tests/resident-planning-gc.test.mjs) | 2 | 0 | 0 | 0 |
| [resident-planning.test.mjs](../tests/resident-planning.test.mjs) | 29 | 0 | 0 | 0 |
| [roll-pool-worker.test.mjs](../tests/roll-pool-worker.test.mjs) | 8 | 0 | 0 | 0 |
| [rules-fixes.private.test.mjs](../tests/rules-fixes.private.test.mjs) | 7 | 0 | 0 | 0 |
| [rules-fixes.test.mjs](../tests/rules-fixes.test.mjs) | 26 | 0 | 0 | 0 |
| [rules-review-preview.test.mjs](../tests/rules-review-preview.test.mjs) | 4 | 0 | 0 | 0 |
| [sandbox-client.test.mjs](../tests/sandbox-client.test.mjs) | 14 | 0 | 0 | 0 |
| [sandbox-server.test.mjs](../tests/sandbox-server.test.mjs) | 9 | 0 | 0 | 0 |
| [scheduler.test.mjs](../tests/scheduler.test.mjs) | 58 | 0 | 0 | 0 |
| [scheduling-server.private.test.mjs](../tests/scheduling-server.private.test.mjs) | 3 | 0 | 0 | 0 |
| [scheduling-server.test.mjs](../tests/scheduling-server.test.mjs) | 10 | 0 | 0 | 0 |
| [serialized-snapshot-cache.test.mjs](../tests/serialized-snapshot-cache.test.mjs) | 10 | 0 | 0 | 0 |
| [server-memory-sharing.test.mjs](../tests/server-memory-sharing.test.mjs) | 5 | 0 | 0 | 0 |
| [server-reliability.private.test.mjs](../tests/server-reliability.private.test.mjs) | 1 | 0 | 0 | 0 |
| [server-reliability.test.mjs](../tests/server-reliability.test.mjs) | 7 | 0 | 0 | 0 |
| [server.test.mjs](../tests/server.test.mjs) | 27 | 0 | 0 | 0 |
| [session-residency.test.mjs](../tests/session-residency.test.mjs) | 34 | 0 | 0 | 0 |
| [skill-guides-runtime.test.mjs](../tests/skill-guides-runtime.test.mjs) | 8 | 0 | 0 | 0 |
| [startup-timing.test.mjs](../tests/startup-timing.test.mjs) | 5 | 0 | 0 | 0 |
| [startup-warmup.test.mjs](../tests/startup-warmup.test.mjs) | 11 | 0 | 0 | 0 |
| [state.private.test.mjs](../tests/state.private.test.mjs) | 18 | 0 | 0 | 0 |
| [state.test.mjs](../tests/state.test.mjs) | 59 | 0 | 0 | 0 |
| [task-claim-server.test.mjs](../tests/task-claim-server.test.mjs) | 19 | 0 | 0 | 0 |
| [task-how-server.test.mjs](../tests/task-how-server.test.mjs) | 2 | 0 | 0 | 0 |
| [task-why-display-server.test.mjs](../tests/task-why-display-server.test.mjs) | 2 | 0 | 0 | 0 |
| [task-why-display.test.mjs](../tests/task-why-display.test.mjs) | 9 | 0 | 0 | 0 |
| [task-why-scale-server.test.mjs](../tests/task-why-scale-server.test.mjs) | 1 | 0 | 0 | 0 |
| [task-why-scale.test.mjs](../tests/task-why-scale.test.mjs) | 4 | 0 | 0 | 0 |
| [time-estimates.private.test.mjs](../tests/time-estimates.private.test.mjs) | 12 | 0 | 0 | 0 |
| [time-estimates.test.mjs](../tests/time-estimates.test.mjs) | 10 | 0 | 0 | 0 |
| [topbar-status-browser.test.mjs](../tests/topbar-status-browser.test.mjs) | 7 | 0 | 0 | 0 |
| [unlock-calc-harness.test.mjs](../tests/unlock-calc-harness.test.mjs) | 3 | 0 | 0 | 0 |
| [unlock-reuse.test.mjs](../tests/unlock-reuse.test.mjs) | 51 | 0 | 0 | 0 |
| [viewer-permissions.test.mjs](../tests/viewer-permissions.test.mjs) | 14 | 0 | 0 | 0 |
| [viewer-task-response.test.mjs](../tests/viewer-task-response.test.mjs) | 5 | 0 | 0 | 0 |
| [warm-candidate.test.mjs](../tests/warm-candidate.test.mjs) | 23 | 21 | 0 | 0 |
| [warm-restart-server.test.mjs](../tests/warm-restart-server.test.mjs) | 1 | 0 | 0 | 0 |
| [warm-restart-worker.test.mjs](../tests/warm-restart-worker.test.mjs) | 5 | 0 | 0 | 0 |
| [warm-store.test.mjs](../tests/warm-store.test.mjs) | 15 | 0 | 0 | 0 |
| [warmstart-scheduler.test.mjs](../tests/warmstart-scheduler.test.mjs) | 17 | 0 | 0 | 0 |
| [warmstart-server.test.mjs](../tests/warmstart-server.test.mjs) | 5 | 0 | 0 | 0 |
| [web-browser.private.test.mjs](../tests/web-browser.private.test.mjs) | 3 | 0 | 0 | 0 |
| [web-browser.test.mjs](../tests/web-browser.test.mjs) | 383 | 0 | 0 | 0 |
| [worker-memory-ceilings.test.mjs](../tests/worker-memory-ceilings.test.mjs) | 4 | 0 | 0 | 0 |
| [worker-native-zlib.test.mjs](../tests/worker-native-zlib.test.mjs) | 6 | 0 | 0 | 0 |
| [worker-picker-keys.test.mjs](../tests/worker-picker-keys.test.mjs) | 7 | 0 | 0 | 0 |
| [worker-timings.private.test.mjs](../tests/worker-timings.private.test.mjs) | 2 | 0 | 0 | 0 |
| [worker-timings.test.mjs](../tests/worker-timings.test.mjs) | 18 | 0 | 0 | 0 |
| [worker-watchdog.test.mjs](../tests/worker-watchdog.test.mjs) | 7 | 0 | 0 | 0 |
| [workers-idle.test.mjs](../tests/workers-idle.test.mjs) | 11 | 0 | 0 | 0 |
| [y03-fuzz-ci-integration.test.mjs](../tests/y03-fuzz-ci-integration.test.mjs) | 1 | 2 | 0 | 0 |
