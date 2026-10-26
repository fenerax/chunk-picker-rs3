# Save command performance

Measured on Windows with Node 24.19, comparing commit `80aaf88` with this fix. Each run started the CLI on a fresh, isolated copy of the same real save, used a loopback ephemeral port, and sent authenticated commands with the current revision and matching Origin. Gzip was enabled. Map assets were read from the existing cache. No live server or save was modified.

The save was approximately 25.9 MB, with about 24,000 catalogue rows and 91,000 aliases. Its active history contained only eight events, so history compaction did not cause this regression.

## End-to-end results

Times include receipt of the complete HTTP response body; JSON parsing is shown separately. Commands ran in order after initial state/definitions loading. The chunk started locked and was selected, then cleared with status `locked`.

| Command | Before response | After response | Before JSON parse | After JSON parse |
| --- | ---: | ---: | ---: | ---: |
| Set preference | 12,973 ms | 109 ms | 321 ms | 3 ms |
| Select chunk | 9,239 ms | 103 ms | 246 ms | 2 ms |
| Clear chunk | 8,758 ms | 96 ms | 268 ms | 1 ms |

Earlier reproduction under concurrent machine load took approximately 18–26 seconds for a preference command, consistent with the reported regression. The final paired runs above used the same measurement method. These are local observations, not hardware-independent latency guarantees.

The requested theme value `gray` is invalid at `80aaf88`; the successful preference benchmark used the supported grayscale theme `mono`.

Fresh-copy startup fell from 12,690 ms to 6,756 ms, including first-time creation of static sidecars. Already-current migration is checked once instead of repeatedly cloning, validating, and projecting the complete save. The static fingerprint is prepared before readiness.

## Request-stage profile

In-memory instrumentation wrapped the original and changed functions without adding profiling code to production. The preference request gives the clearest comparison. Nested measurements overlap and must not be summed.

| Stage | Before | After |
| --- | ---: | ---: |
| Command application, including validation and undo delta | 5,002 ms | 19 ms |
| Validation copies, nested across the request | 1,700 ms / 15 calls | 4 ms for changed gameplay |
| JSON cloning, nested across the request | 3,681 ms / 21 calls | 3 ms for mutable fields/new event |
| Migration/preparation | 1,822 ms | <1 ms |
| Undo delta calculation, nested in application | 73 ms | 2 ms |
| History compaction | <1 ms, below threshold | <1 ms, below threshold |
| Previous-state backup, including gzip and synchronized write | 1,058 ms | 9 ms |
| Atomic current-state write | 1,746 ms | 14 ms |
| Full current-state serialization | 311 ms | Skipped; compact document only |
| Full-state return/subscriber copies | 1,331 ms | Skipped |
| Gameplay fingerprint, nested in subscriber | 483 ms | <1 ms |
| Revision broadcast and task-worker supersession | 1,230 ms | <1 ms |
| Roll pools / command response snapshot | 27 ms | 27 ms |
| Response serialization/compression | 830 ms | 6 ms |
| Total instrumented server command | 12,632 ms | 77 ms |

Alias migration was repeatedly checked in the old preparation stage. Ordinary preference/chunk commands now reuse an already migrated, fully validated baseline; task ID resolution and new registrations still validate their identities. Task-worker supersession is measured above; task re-evaluation runs separately and is not awaited by the save response. Periodic backup packing was not due in these three requests and now uses a separate maintenance queue.

Compaction also preserves the validated static trees instead of revalidating the entire save. A separate synthetic run with a 6 MiB provenance field measured a compaction-triggering store command at 112 ms: history archival 13 ms, prior backup 11 ms, changed provenance serialization/hash/compression/write 74 ms, and current atomic write 14 ms. This measurement excludes response transfer and parsing. Full history export and undo across that archive are covered by the storage regression test.

## Why the fix stays durable

The old request repeatedly traversed and copied the entire catalogue, alias registry, and exact migration archives, then rewrote and backed up a roughly 25 MB snapshot. Those costs applied even when changing one preference.

Storage now owns a validated baseline, copies mutable gameplay fields, and shares unchanged immutable trees. Public imports, hooks, and undo retain full validation. New undo events are isolated from editable gameplay; large catalogue undo restoration uses one index rather than repeated catalogue scans. Static fingerprints and field JSON are cached by private immutable object identity.

Large static fields use synchronized, hash-checked, content-addressed sidecars. Before acknowledging a command, storage synchronizes the preceding snapshot backup and atomically replaces the current compact snapshot. Referenced sidecars are written first and retained. Downloads and retained-backup reads hydrate a full portable state; missing or corrupt dependencies fail closed. Packing retains the existing checkpoints/pinned snapshots and drains on graceful shutdown.

Command responses omit only unchanged large fields, anchored to `baseRevision`. The browser merges the exact submitted snapshot and falls back to a full GET if it cannot. Conflicts and GETs return full state. The browser waits for its command queue before handling revision notifications, preventing its own save notification from starting a redundant full-state download.

## Regression coverage

`tests/command-performance.test.mjs` creates an approximately 25.6 MiB state with 24,000 tasks, 90,000 aliases, thousands of statuses per player, and 1,200 history events. It measures complete preference/select/clear responses with a generous 5-second threshold for shared CI machines, and independently asserts that ordinary commands perform zero whole-state JSON copies. The focused run measured 232/181/180 ms.

The same test checks exact retained-field reconstruction, immutable undo guards, backup contents, sidecar hashes, revision-conflict durability, and restart recovery. Focused storage/state tests also exercise atomic-write failures, retention packing, alias registration, undo, migration hooks, and corrupt or missing sidecars.

Full validation: `npm test` passed all 792 tests, with zero failures, cancellations, or skips (144.7 seconds). Under that parallel suite load, the synthetic preference/select/clear commands took 1,781/771/1,009 ms, below the generous regression threshold, with zero whole-state JSON copies. The private reproduction copies and logs were deleted after profiling.

## Note response projection trial — 2026-10-26

START: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd`.

A scale-400 synthetic companion produces a 103,514,448-byte portable save;
unchanged large fields already use sidecars, leaving a 4,663-byte current
snapshot after the measured edits. The largest avoidable note-save cost here
was rebuilding the sparse browser task/identity projection by scanning the
unchanged catalogue. This fixture has little personal progress, so it does not
reproduce every cost in a long-running duo save.

`store.mjs` now reuses an already cached projection only for a built-in
`set-note` whose preparation returned the exact authored state. It takes notes,
History and all other display fields from the newly durable state. Preparation
hooks and other commands use the ordinary projection path. The write queue,
backups, synchronized temp file, rename and atomic action receipt remain the
same. This change speeds the response after persistence; it does not make the
write itself faster.

Seven fresh-process pairs alternated START/changed and changed/START. Node
24.19.0, process calculators, a 3 GiB server heap, Linux, five logical AMD EPYC
9V74 CPUs. Results are milliseconds, with medians and full min–max ranges:

| Scenario | START | Changed | Median paired change |
| --- | ---: | ---: | ---: |
| One note, through HTTP parsing/merge and Saved status reducer | 17.91 (16.43–20.69) | 12.50 (10.94–14.88) | −5.95 ms / −30.5% |
| Four sequential acknowledged note edits | 54.53 (52.90–66.36) | 31.78 (30.49–35.79) | −22.04 ms / −41.4% |

The median paired change is calculated from each pair, separately from the two
variant medians. Every complete response plus reconstructed client state and
portable save had identical hashes across all 14 runs (only the random receipt
request ID is normalized). Each edit carries a real scoped action receipt.

| Inclusive stage, one note | START median | Changed median |
| --- | ---: | ---: |
| Request JSON parsing | 0.256 | 0.278 |
| Command validation and mutation | 0.526 | 0.558 |
| Preparation | 0.006 | 0.006 |
| Compact disk document serialization | 0.063 | 0.065 |
| Prior backup, including gzip and atomic write | 2.205 | 2.345 |
| Both atomic writes together | 3.022 | 2.883 |
| Temp file writes, nested in atomic writes | 0.168 | 0.262 |
| File fsyncs, nested in atomic writes | 2.012 | 1.891 |
| Renames, nested in atomic writes | 0.183 | 0.189 |
| Synchronous revision subscribers/broadcast | 0.365 | 0.323 |
| Roll pools / partner connections | 0.424 | 0.416 |
| Sparse play projection, nested in response snapshot | 5.175 | 0.006 |
| Complete response snapshot assembly | 5.754 | 0.482 |
| Response encoding/send | 0.673 | 0.596 |

These stages overlap; do not sum them. Request-to-commit median was 8.79 →
8.92 ms. The removed projection was about 29% of the original local
request-to-status action and about 37% of the four-edit burst. Note saves keep
the existing unchanged-task-results branch; task calculator results are not
awaited by the save response.

Server peak RSS median: 1,508.18 → 1,506.67 MiB, ranges 1,494.52–1,518.53 →
1,464.89–1,523.65 MiB. This is the process high-water mark including startup,
not the combined calculator/browser total; it does not establish a memory win.
Raw samples and summaries: `scripts/perf/save-path-results.json`.

The client endpoint is the actual save-status reducer with a lightweight badge,
not a running browser. DOM rendering, IndexedDB receipt handling, phone CPU,
internet latency and delivery to a second browser are unmeasured. The burst is
four note edits, not a mixed unlock/completion/settings burst. These synthetic
results do not establish a user-visible win on the duo's real save. Run the
required scrubbed-save benchmark on its two-CPU Linux runner before merging.

Reproduce without network access, from the repository root:

```sh
mkdir -p .local/perf/save-start
# Substitute the START commit above if comparing this trial.
git archive 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd app scripts/lib | tar -x -C .local/perf/save-start
node scripts/perf/scale-dataset.mjs --out .local/perf/save-scale400 --scale 400
node scripts/perf/save-path.mjs --companion .local/perf/save-scale400 --baseline .local/perf/save-start --pairs 7 --out .local/perf/save-paired.json
```

The generator needs three small runtime repairs: keep permanent task-ID syntax
when converting open-f2p identities, supply empty topology summary counts, and
supply empty synthetic identity history. The existing dataset-pack tests cover
those fields. Existing storage-play tests compare all saved fields and pools
against independent projections for both members, locked/unlocked chunks and
Group view on/off, including history compaction and preparation-hook fallback.
A new storage reliability test kills a child after its next temp file is synced
but before rename, then verifies the earlier acknowledged revision survives
and both receipt retries remain exactly once.

Validation environment notes: Node 24.19.0 reports a native coverage-count
mismatch in `ci-coverage-reporter.test.mjs`; an untouched START copy reproduces
it (4 passed, 1 failed), while the supplied Node 24.20.0 passes all 5 cases.
Initial Node 24.19 runs finished quick at 2,311 passed / 1 failed / 65 skipped,
and full at 5,344 passed / 2 failed / 137 skipped. The second failure was the
unchanged orphan-calculator test: this container runs `tail` as PID 1, which
does not reap orphaned calculator zombies. Untouched START on Node 24.20
reproduces that failure without a reaper (0 passed / 1 failed), and passes with
a temporary Linux child subreaper (1 passed / 0 failed). No calculator code was
changed. Final validation uses the supplied Node 24.20 runtime; full runs under
a temporary Python parent using `prctl(PR_SET_CHILD_SUBREAPER, 1)` and `wait()`.
The plain Node 24.20 full trial was stopped early to use this environment.

Final Node 24.20 validation: `npm run test:quick` passed 2,312 tests, zero
failures, 65 skips; then `npm test` under the child subreaper passed 5,346
tests, zero failures or cancellations, 137 skips (416.4 seconds). The earlier
plain Node 24.20 full trial stopped at 66 passed / 0 failed / 1 cancelled /
7 skipped when switching to the reaper environment. All new cases live in
existing classified test files. No new test-file classification is needed.
