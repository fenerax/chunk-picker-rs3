# Full-suite speed audit, 2026-10-15

The measured before/after runtime fell **29.6%**, from **11m 51.5s** to **8m 20.8s**. All three selected runs met the recorded quiet criteria. The roughly-half target was not met in these runs.

The implementation is frozen at `3ed9514`. No engine code or private dataset input changed. Full-suite assertions and existing skips remain; eight new checks were added across existing classified files and one new quick file.

| Run | Files | Tests / passes / existing skips | Runner wall | Peak Node MiB |
| --- | ---: | --- | ---: | ---: |
| 340a137 control | 331 | 3414 / 3413 / 1 | 4m 12.2s | 2975 |
| Before (79ac5e8) | 418 | 4191 / 4189 / 2 | 11m 51.5s | 2607 |
| After (3ed9514) | 419 | 4199 / 4197 / 2 | 8m 20.8s | 2709 |

| Run | Mean background cores | 95th percentile cores | Minimum free GiB | Maximum active files | Quiet criteria met |
| --- | ---: | ---: | ---: | ---: | --- |
| 340a137 control | 0.79 | 1.31 | 4.98 | 3 | yes |
| Before (79ac5e8) | 0.72 | 1.21 | 5.72 | 3 | yes |
| After (3ed9514) | 0.72 | 1.22 | 5.11 | 3 | yes |

The same source was also measured earlier under heavier recorded background activity. This establishes a host-condition difference directly; it does not isolate CPU from memory/cache effects or identify the causes of historical ship-run variance.

| Source | Earlier wall | Earlier background cores | Selected wall | Selected background cores |
| --- | ---: | ---: | ---: | ---: |
| 340a137 | 6m 18.2s | 3.01 | 4m 12.2s | 0.79 |
| 79ac5e8 | 17m 17.2s | 2.58 | 11m 51.5s | 0.72 |

The quiet gate requires mean background CPU at most one logical core, its 95th percentile at most two cores, and at least 3 GiB free RAM. The machine has 12 logical CPUs. The heavy lock prevents cooperating heavy runs from overlapping, but does not stop browser work, other application activity or unlocked checks. No timing was corrected mathematically for contention. Historical ship logs have no corresponding process measurements, so their 15.1–23.5 minute variation cannot be attributed precisely after the fact.

## Where the time went

Compared with `340a137`, the before suite grew from 3414 to 4191 tests (22.8%). The roughly 2% figure describes only ship batches 20–25, after much of the startup cost had already arrived.

`c7ae870` introduced eager dataset resolution before dependent modules initialize. A guarded probe of the before source inspected **97 inputs**, performing 1,900 lstat calls, 2,000 realpath calls and 97 opens. It took 5.49 seconds; awaited open calls accounted for 4.07 seconds. Each isolated importing test process pays bootstrap cost. Ordinary server fixtures also resolved the same immutable inputs repeatedly. `d0a31a4` moved Windows calculators into processes to recover idle memory, so child startup repeats dataset bootstrap. That isolation remains in place. The code comparison and per-file measurements support these as contributors; they do not assign an independent stopwatch total to each commit.

The current ship helper delegates to `npm.cmd test` through the same shared heavy lock. Its scripts do not override test concurrency or NODE_OPTIONS. Full discovery still puts every file through one alphabetical native Node CLI invocation with three files at once. The sampler observed at most three active files in every measured full run. Cases within a file remain serial; real calculator children still run.

| Suspected file | Before seconds | After seconds |
| --- | ---: | ---: |
| open-f2p.test.mjs | 1.77 | 2.09 |
| open-f2p-equipment.test.mjs | 0.19 | 0.18 |
| public-candidate.test.mjs | 4.71 | 3.98 |
| public-export.test.mjs | 8.70 | 10.12 |
| public-export-scanner.test.mjs | 2.12 | 2.10 |
| public-test-fixtures.test.mjs | 1.38 | 1.41 |
| public-shadow.test.mjs | 0.15 | 0.16 |
| art-pack.test.mjs | 6.50 | 4.27 |
| art-pack-server.test.mjs | 29.05 | 18.39 |
| datasets.test.mjs | 13.53 | 10.21 |
| dataset-startup.test.mjs | 29.46 | 23.45 |
| dataset-parity-clock.test.mjs | 0.18 | 0.23 |
| worker-timings.test.mjs | 45.10 | 32.56 |

The F2P builder, scanner, inventory/fixture and shadow checks remain in the suite. Dataset selection, tampering, binding, startup failure and worker integrity checks still resolve fresh providers. Existing manual-clock tests keep their scheduling boundaries; no assertions, deadlines, real-worker coverage or tests were removed or relaxed.

Data-pack builds run in `datasets.test.mjs` and `dataset-startup.test.mjs`; their combined whole-file wall fell from 42.99 to 33.66 seconds. Those files deliberately create fresh packs for selection and tampering scenarios. They did not dominate the suite. Art-pack build coverage likewise remains fresh.

The slow server files use short polling intervals around real HTTP/worker readiness: 10–20 ms in Sandbox/viewer tests and 100 ms in warmup. One viewer scenario retains a fixed 200 ms wait. Storage-reliability intervals keep crash/mutex children alive; their startup timeouts and dataset-startup's 90-second child timeout are failure bounds, not unconditional waits. The heavy-evaluation server case retains its 20-second timeout and real child calculation. These waits were inspected and left intact; removing them would not explain the multi-minute regression, and replacing real readiness with a simulated clock would change the integration boundary.

## Changes

- Sixteen server-test files reuse an explicitly selected immutable provider within their isolated process. Empty-metadata fixtures share one owned temporary provider. Storage, authentication, HTTP requests, commands and real workers remain fresh per scenario. A new full-only contract check compares shared and freshly resolved fixture digests, files, capabilities and defaults.
- Tracked input validation reads batches of three streams, retaining every path, size, hash and post-read fingerprint check. Results enter maps in declared order. A rejected batch waits for every admitted inspection to settle and starts no later batch. Cheap promise fixtures cover reversed completion, synchronous/asynchronous failure cleanup and empty inputs.
- Safe paths still check every ancestor for links and directory types, plus complete canonical root and target paths before and after reads. Redundant canonicalization of each prefix was removed. A real junction test covers an alias above the supplied root.
- Test runners share Node's source-validated bytecode cache within one run, then remove their owned cache. Modules initialize and assertions run in each isolated test process. Concurrency remains three for full and two for quick. No heap cap or worker-mode change was introduced.
- Timing receipts now retain host load and source state, fail if memory sampling fails, and redact invitation, overlay and bearer credentials in failure output.

The [fixture assertion audit](../../.local/test-speed/assertion-audit.json) reverses only the fixture plumbing and verifies that all sixteen files recover their original `79ac5e8` hashes. The export contract still has 240 pinned omissions, with none added by this work.

## Twenty-five slowest before files

Whole-file times include imports, cases and teardown. Concurrent file times overlap and must not be summed to infer suite wall time. “New” means absent from the older control.

| Rank | File | 340a137 seconds | Before seconds | After seconds |
| ---: | --- | ---: | ---: | ---: |
| 1 | server.test.mjs | 30.55 | 97.25 | 45.75 |
| 2 | identity-startup.test.mjs | 19.78 | 65.93 | 37.79 |
| 3 | play-server.test.mjs | 17.23 | 51.39 | 31.87 |
| 4 | worker-timings.test.mjs | 15.14 | 45.10 | 32.56 |
| 5 | viewer-permissions.test.mjs | 13.65 | 41.95 | 26.22 |
| 6 | task-claim-server.test.mjs | 16.03 | 40.64 | 17.79 |
| 7 | duo-server.test.mjs | 17.91 | 40.62 | 20.51 |
| 8 | runemetrics-server.test.mjs | 16.39 | 39.90 | 23.36 |
| 9 | sandbox-server.test.mjs | 17.50 | 39.21 | 24.94 |
| 10 | warmstart-server.test.mjs | new | 35.20 | 26.25 |
| 11 | training-server.test.mjs | 11.28 | 32.19 | 19.47 |
| 12 | overlay-routes.test.mjs | new | 31.81 | 6.24 |
| 13 | scheduling-server.test.mjs | 14.66 | 31.77 | 11.87 |
| 14 | death-worker.test.mjs | 12.49 | 29.52 | 23.23 |
| 15 | dataset-startup.test.mjs | new | 29.46 | 23.45 |
| 16 | art-pack-server.test.mjs | new | 29.05 | 18.39 |
| 17 | storage-reliability.test.mjs | 21.05 | 27.27 | 24.59 |
| 18 | original-sync-server.test.mjs | 6.60 | 25.49 | 7.46 |
| 19 | operator-cutover.test.mjs | new | 24.96 | 21.22 |
| 20 | preview-equipment-corrections.test.mjs | 12.84 | 24.63 | 19.13 |
| 21 | server-reliability.test.mjs | 12.28 | 24.10 | 11.85 |
| 22 | prediction-server.test.mjs | 8.93 | 24.00 | 12.10 |
| 23 | divination-integration.test.mjs | new | 21.62 | 22.72 |
| 24 | pool-ranking-server.test.mjs | 9.51 | 21.44 | 16.70 |
| 25 | backup-import-server.test.mjs | new | 21.03 | 8.93 |

## Ten slowest after files

| Rank | File | Before seconds | After seconds |
| ---: | --- | ---: | ---: |
| 1 | server.test.mjs | 97.25 | 45.75 |
| 2 | identity-startup.test.mjs | 65.93 | 37.79 |
| 3 | worker-timings.test.mjs | 45.10 | 32.56 |
| 4 | play-server.test.mjs | 51.39 | 31.87 |
| 5 | warmstart-server.test.mjs | 35.20 | 26.25 |
| 6 | viewer-permissions.test.mjs | 41.95 | 26.22 |
| 7 | sandbox-server.test.mjs | 39.21 | 24.94 |
| 8 | storage-reliability.test.mjs | 27.27 | 24.59 |
| 9 | dataset-startup.test.mjs | 29.46 | 23.45 |
| 10 | runemetrics-server.test.mjs | 39.90 | 23.36 |

## Public CI and verification

The export template produces `.github/workflows/test.yml`: push and pull_request, ubuntu-latest, Node 24, quick then full, contents: read, no secrets, a 20-minute timeout, and full action SHA pins with version comments. Checkout does not persist credentials. The workflow has an explicit allowlist/override entry and uses the existing YAML/text leak scan without exceptions. A private tooling test verifies real export bytes and rejection of a planted private fingerprint in the workflow.

The candidate tool requires `--save`. A single copied state file under this worktree's ignored local area supplied member evidence; access-token and store.lock were never copied. The two calls used a captured copy, distinct absent directories outside the repository, and private receipts:

```powershell
node scripts/public-export/candidate.mjs HEAD ../testspeed-public-a-20261015 --save .local/test-speed/export-input/state.json --receipt .local/test-speed/public-a.json --corpus-dir .local/test-speed/export-corpus
node scripts/public-export/candidate.mjs HEAD ../testspeed-public-b-20261015 --save .local/test-speed/export-input/state.json --receipt .local/test-speed/public-b.json --corpus-dir .local/test-speed/export-corpus
```

Both scans were clean. Both output trees, Git trees and single public commits matched. The public tree remained clean after its tests, and had zero remotes. Export SHA-256: `c30d9f6a01c69f1641f8d05ec64b2e9ee951e756d49fa7c0b6b1eb983fddd774`; public commit: `261dfc8685a98c34bc76d1d8c99bb50f089c69d2`. Both export directories and the disposable input state file were deleted. No GitHub access, push, remote creation or publication occurred. Hosted Ubuntu Actions itself was not run.

| Verification | Result |
| --- | --- |
| Private quick | 1458 passed; 1 existing skip; 0 failed |
| Focused changed server/tooling group | 213 passed; no failures or skips |
| Additional startup/process-worker checks | 14 passed; no failures or skips |
| Public quick | 1140 passed; 1 existing skip; 0 failed |
| Public full | 2378 passed; 1 existing skip; 0 failed |
| Disposable-save dataset parity | Zero differences; both read-only hashes unchanged and Undo restored |
| Final private full | 4197 passed; 2 existing skips; 0 failed |

An initial full diagnostic passed but its new memory sampler failed. That unmetered result is retained separately and excluded from the comparison. The sampler was corrected and smoke-tested before the reference runs. Memory is the sampled sum of live descendant Node working sets, not an exact instantaneous peak or total host memory; non-Node helpers and brief spikes are outside that figure. Background CPU is sampled process-time growth outside that Node tree, including possible non-Node test helpers. Two-second sleeps plus query overhead determine the actual sampling interval.

Evidence is under [the local audit directory](../../.local/test-speed/). The selected quiet controls are `quiet-before-attempt2.json` and `quiet-baseline-attempt2.json`, with matching `-gate.json` receipts. The final run is `after.json` and its retained `after.log`. Earlier loaded runs are `before-metered.log` and `baseline-340a137-metered.log`, with corresponding reports. Verification logs include `private-quick.log`, `public-quick.log`, `public-full.log`, `dataset-parity.log` and `startup-targeted.log`, alongside repeat-export receipts. No measured source was edited during the final full run. No UI changed, so no browser session or screenshots were needed.

Both disposable control worktrees were removed after their reports were copied here. No test server or owned Node process remained. The final evidence commit changes documentation only; implementation and export verification refer to the frozen `3ed9514` source above.
