# Live timings and on-demand CPU profiles

START: a9e2cd27b744e529fc44df8e917b966a6387423a. Linux, Node v24.21.0, process calculators. No npm dependencies or calculator algorithms changed.

## Changes

- `app/live-timings.mjs`: process-wide request context, fixed action/stage allowlists, 168 hourly summaries with logarithmic duration buckets, and a 2,048-event ring. Captures HTTP arrival through response finish/close, failed requests included. Actions distinguish full/play/duo/sidebar/inspection task views, Preview first answer and partner-ready, How, Why, pool/ranking, planning, sandbox, command saves, and state views. Calculator wake and physical worker startup are separate events.
- `app/picker-context.mjs` and `app/picker-context-http.mjs`: route permissions and existing cache/evaluation metadata. Roll pool is an internal subaction because it is also used by state loads and commands. Why rebuilds its chain from retained evidence and counts as computed; ranking reads retained prediction results. Cache-hit share describes retained responses or scheduler results, rather than every internal engine memoization hit. Coalesced followers are counted separately from cache hits. Stage totals sum measured work within a request; cache hits do not replay their original computation stages.
- `app/server.mjs`: shared collector/profile ownership, HTTP arrival wrapper and physical calculator lifecycle callbacks. Standby releases neither collect nor persist; freezing flushes and pauses the outgoing collector, and activation reloads its summary. Freezing also stops an active profile before writer handover. Failed startup and shutdown close collector resources.
- `app/tasks/scheduler.mjs` and `app/tasks/calculator-pool.mjs`: small observer additions for coalesced/cold-start flags, pooled cold starts, wake-to-dispatch duration and Preview partner-ready completion. The latter counts completed producers that served an explicit Preview, once per producer, from initial admission through partner completion. It can outlive the first HTTP response. No scheduler admission, priority, cancellation, retention, or calculation policy changed.
- `app/deep-profiles.mjs`, `app/tasks/process-worker.mjs` and `app/tasks/process-worker-host.mjs`: bounded inspector capture of the picker, calculator isolates and relay main isolates. Node's Worker CPU profiling API profiles running calculators without restart flags or calculator protocol changes. New calculators join an active capture at the thread-online boundary, including subsequent initialization. OS spawn and relay initialization before the control message arrives are outside that capture. Thread mode also supports calculator-isolate capture. Termination may discard an unfinished calculator capture and is never delayed to preserve it.
- `app/live-timings-route.mjs`, `app/web/live-timings.*`, `app/web/index.html`: Admin → Live timings, using the existing style tokens. Private administrator authentication is required for the page, assets, summary, switch and downloads. Viewer/player/plugin requests receive 403. Profiles default to 180 seconds, reject durations over 600 seconds, stop at their deadline and on close, and can be stopped manually.
- `scripts/perf/live-timings-load.mjs`: reproducible fresh-process synthetic HTTP and isolated collector measurements. `scripts/perf/live-calculator-profile.mjs`: calculator-only real-pack profile overhead and resident/peak RSS, with canonical hashes. `scripts/perf/vps-hotspots.mjs`: low-priority, memory-bounded recovery-copy runner. `scripts/perf/hotspots-engine.mjs`: optional full canonical result hashes and coverage of all nine calculator operations. Existing output remains compatible.
- `tests/live-timings*.test.mjs` and `scripts/test-selection.mjs`: classified acceptance coverage for recording, views, flags, privacy, retention, restart, standby activation, permissions, profile lifecycle, downloads and caps.

## Bounds and interpretation

`live-timings.json` is atomically replaced under the data directory, mode 0600, every 60 seconds and at orderly shutdown. It is capped at 8 MiB. Each hourly action summary contains counts, a bounded histogram, maxima and numeric stage totals. At extreme saturation, persistence retains the newest complete hourly summaries that fit the byte cap. Memory is bounded independently by 168 hours, 18 action names, fixed stage names and 2,048 recent events; it does not grow per player. Input files larger than the cap are rejected before reading their contents. Unknown persisted keys are never reflected into output.

The 24-hour and seven-day views contain the current partial hour and the previous 23 or 167 hours. Their oldest boundary is rounded forward to an hour. Percentiles use upper bounds of 5% logarithmic buckets, capped at the observed maximum. The slowest list is the largest 20 durations among the most recent 2,048 events still within 24 hours. It is not an unlimited historical slow-query log. An abrupt crash can lose up to one flush interval.

Timing records contain fixed action/stage names, durations, timestamps and boolean flags only. They contain no URLs, request bodies, identifiers, labels, errors or gameplay text. Tests inspect stored bytes against synthetic identifiers and names. CPU profiles are a separate, explicitly requested administrator artifact containing code frames. Finished profiles are limited to 12 files, 128 MiB total and 32 MiB per file. Oversized captures are discarded and increment the error count. Writes are serialized, atomic and mode 0600; interrupted temporary files are removed at the next writer startup.

## VPS runner (root commands)

Choose an immutable, already verified recovery backup. For a legacy recovery, select its `store` directory; for a service recovery, select one initialized directory beneath `pickers`. The runner verifies each copied gameplay file's size and SHA-256 against that backup's manifest. It copies only `state.json` and `static`, validates static references in the calculator harness, opens no store/server and creates no credentials. It does not restore a backup over the live data directory. Symlinks, overlapping input/output/live paths and an existing output directory are rejected.

Edit the paths below to the installed release and selected recovery inputs. Keep pack/default selection identical to the backup. The example uses the standard operator live-data path; the picker selection and input paths are operator-supplied placeholders, not production data.

```sh
sudo -i
export PATH=/opt/node/bin:$PATH
node --version                         # stop unless >=24.20
cd /opt/chunk-picker/releases/REPLACE_WITH_RELEASE
export RS3_DATASET=duo-legacy
export RS3_PACKS_DIR=/REPLACE_WITH_RECOVERY_PACKS
export RS3_GAME_DEFAULTS_FILE=/REPLACE_WITH_RECOVERY_DEFAULTS
export RS3_TASK_WORKER_MODE=process
install -d -m 0700 /var/tmp/chunk-picker-profiles

systemd-run --scope --unit=chunk-picker-hotspots \
  -p MemoryMax=5G -p MemorySwapMax=0 -p CPUWeight=10 \
  nice -n 15 /opt/node/bin/node scripts/perf/vps-hotspots.mjs \
  --recovery-save /REPLACE_WITH_RECOVERY_STORE \
  --live-data-dir /var/lib/chunk-picker/data/game \
  --out /var/tmp/chunk-picker-profiles/live-timings-2026-11 \
  --rss-mib 5120 --profile
```

The runner performs five fresh trials serially, uses `nice -n 15` for the profiler process group, samples aggregate group RSS every 100 ms, and kills the group above its configured cap or a 30-minute deadline. The systemd scope supplies the hard memory limit; sampling can otherwise overshoot. A 1,536 MiB V8 heap ceiling also applies to the profiler coordinator. Stop with Ctrl-C; the owned group is killed and its scratch copy removed. SIGKILL cannot run cleanup. The scratch copy and temporary reports live in the operator's `/tmp`; budget for their bytes if that mount is tmpfs. The scope inherits the operator's mount namespace. The completed report tree is copied to the fresh output directory. `measurements.json` has the existing hotspot report format. Omit `--profile` for an unprofiled run. This command is for the operator; it was not run on a VPS in this task.

Reproduce the public overhead measurement with:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/live-timings-load.mjs --requests 1000 --out /tmp/live-timings-load.json
node scripts/perf/live-timings-load.mjs --micro > /tmp/live-timings-micro.json
```

## Validation and measurements

Durations and RSS below are median [minimum–maximum] across five samples unless a validation row states otherwise.

### Real-pack START versus candidate

Five fresh runs per side, serial calculators, identical copied input. The same public measurement script was used on both application trees; only the baseline's measurement script was updated, not its application sources. Optional hash work runs after each measured reply and can affect subsequent allocation/GC behavior. These are complete-sequence timings, not standalone cold-screen predictions.

Input file SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`. Calculation-state SHA-256: `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1`. Dataset SHA-256: `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`. Counts: 2 members, 23939 saved tasks, 2594 chunks.

28 canonical reply hashes per run, 140 paired before/after comparisons, 0 differences. All nine calculator operations are covered; JSON transports and prepared-reuse payloads are decoded before hashing with the existing canonicalizer. Aggregate hash of the complete per-request hash map: `880ae177998ab8da4dff1949e662dd01fae385f1662da9a3d30a01b576385a88`.

| Duration, ms | START median [min–max] | Candidate median [min–max] |
| --- | ---: | ---: |
| Worker startup | 5660.93 [4905.67–7658.61] | 5717.68 [4868.56–6497.58] |
| tasks-0-cold | 8516.01 [8166.11–9016.37] | 8463.83 [7273.58–59931.09] |
| tasks-1-cold | 2936.11 [2580.46–3060.96] | 3363.07 [3077.62–5061.52] |
| pool-0-cold | 730.24 [650.05–796.17] | 814.02 [656.66–1811.10] |
| prediction-cold | 8828.65 [8203.31–9994.05] | 10319.24 [8861.96–25189.00] |
| accept-recalculate-0 | 2538.88 [2202.79–2972.56] | 2748.61 [2570.06–6029.62] |
| why-full-result | 977.90 [906.42–1034.74] | 974.89 [853.91–3213.14] |
| why-0-cold | 598.54 [468.00–770.47] | 446.28 [304.44–811.15] |
| how-0-cold | 501.26 [471.73–670.48] | 624.97 [599.65–1057.58] |
| prepare-rules | 1.15 [0.68–1.43] | 0.84 [0.71–4.97] |
| planning-0 | 406.50 [396.68–509.78] | 447.02 [386.68–3218.08] |
| sandbox-0 | 520.80 [431.37–681.82] | 507.81 [439.60–749.89] |
| area-0 | 4464.31 [4035.42–6310.84] | 4574.35 [4232.97–17371.98] |
| death-0 | 2.05 [1.56–5.06] | 1.78 [1.44–220.24] |

| Peak RSS, MiB | START median [min–max] | Candidate median [min–max] |
| --- | ---: | ---: |
| parent | 1240.33 [1229.85–1247.56] | 1240.21 [1215.05–1254.02] |
| worker | 2442.12 [1938.39–2814.56] | 2267.01 [2037.05–2431.24] |

RSS above is each process’s Linux high-water mark, not the sum of simultaneous sampled RSS. Resident idle RSS and active-profile overhead are measured separately below. The full sequence retains more cached work than a single calculation; the VPS runner defaults to a 5 GiB group limit. No performance win is claimed from these noisy before/after measurements.

| Canonical reply | Decoded parts | SHA-256, identical before/after |
| --- | ---: | --- |
| tasks-0-cold | 2 | `5874f1d75b825beaea3596122cc16503a93167099e91e63506318d2a77cfd34f` |
| tasks-0-warm | 2 | `5874f1d75b825beaea3596122cc16503a93167099e91e63506318d2a77cfd34f` |
| tasks-1-cold | 2 | `3a2256f9d5f94c36e4a2a190bf3140b408db9305c6016e525f996e479767b53e` |
| tasks-1-warm | 2 | `3a2256f9d5f94c36e4a2a190bf3140b408db9305c6016e525f996e479767b53e` |
| pool-0-cold | 1 | `8cdf00b0621360d40e2c0b951db82af8fdce3bcf8a1d9a40d4858021e6a0e9f9` |
| pool-0-warm | 1 | `8cdf00b0621360d40e2c0b951db82af8fdce3bcf8a1d9a40d4858021e6a0e9f9` |
| pool-1-cold | 1 | `77f02dc586a07c8df2e46dccf7439f45a3ddba6b1d9d0d9c623ada2cee4b099a` |
| pool-1-warm | 1 | `77f02dc586a07c8df2e46dccf7439f45a3ddba6b1d9d0d9c623ada2cee4b099a` |
| prediction-cold | 3 | `cd183237b1bb4dd760a5400ce9576495359bff4ad713af33898a3d961e62dee5` |
| prediction-warm | 3 | `cd183237b1bb4dd760a5400ce9576495359bff4ad713af33898a3d961e62dee5` |
| accept-recalculate-0 | 2 | `6a2fc0672d9db57b2a7430f0810f9572417632225a4b4bc729929683855e533d` |
| accept-recalculate-1 | 2 | `dbcadaa16568d7a236472ffe987f3f9325b2cdda8d87e796176ac45fc6bf9f6f` |
| why-full-result | 2 | `d47363e61ead9c8f8cccf38b76396c52bb0ace376d5eef5be05e4280a842ef46` |
| how-0-cold | 1 | `d04d2fe349aeb1bd49e934b2347e95c1d69aa6af12ffdf72170621be7053d5e3` |
| how-0-warm | 1 | `d04d2fe349aeb1bd49e934b2347e95c1d69aa6af12ffdf72170621be7053d5e3` |
| how-354-cold | 1 | `f476b9648c803498c7a6a4c090fdbadf58ec695de66a165d9880969f53f3c2b1` |
| how-354-warm | 1 | `f476b9648c803498c7a6a4c090fdbadf58ec695de66a165d9880969f53f3c2b1` |
| how-707-cold | 1 | `612cb166fae7e6d45f624d91efb0245855bb3d3aad094971ffe1196a49c9e7e1` |
| how-707-warm | 1 | `612cb166fae7e6d45f624d91efb0245855bb3d3aad094971ffe1196a49c9e7e1` |
| prepare-rules | 1 | `aa071b1c746184c823a94e2dc12c65bbce3e0a07957a27d564b8b9efb36ed21b` |
| planning-0 | 1 | `c9e603e2d1bd7a33d6f0d6688d446c467dc03201d299a829b6b6c023573b7d4c` |
| sandbox-0 | 1 | `6132c5599c2f2c57982554abbf70785cfac6ca8366c0695f5dafec385137ffd6` |
| area-0 | 1 | `72b0620e2a1396e7a5115f84c79fc856efbe0ce846dbd50551c81d7a25369756` |
| death-0 | 1 | `cd7432516997e3ff2063ce86895d13023fd4aa3c9d7ec7cd89d7003201cfc51f` |
| planning-1 | 1 | `4a73d0c908be57f4fdb1148d6435e55645555eb761b51f972b30334ffa877b60` |
| sandbox-1 | 1 | `2079b4673d672e83816eea652f383c9e862b431bf0868e4a7c88d7fcb3edba3c` |
| area-1 | 1 | `b401ab2af14229164c22413cb94ea3776557478d62500407030e41efc01ac566` |
| death-1 | 1 | `80c6051fd68e8450102a40a1d9b113e8a75dbcff6ed618dda1f9737c29a3ae3b` |

### Active profiling on real-pack calculators

Five fresh trials per mode, alternating off/on, one calculator at a time. This harness imports no server/store, reads and validates the copied state with plain filesystem access, and uses ordinary process workers. Capture starts after worker readiness and covers both members’ cold/warm task responses, serialization, transport and a 250 ms idle interval. CPU profile start/stop and file writes are outside the request-duration windows. Future-calculator startup capture is covered by a separate synthetic lifecycle test.

| Duration, ms | Profile off median [min–max] | Profile on median [min–max] | Median difference |
| --- | ---: | ---: | ---: |
| tasks-0-cold | 7922.35 [7121.77–10620.11] | 8777.13 [7387.97–21056.82] | 10.8% |
| tasks-0-warm | 151.10 [131.55–173.56] | 172.33 [146.43–237.83] | 14.0% |
| tasks-1-cold | 2996.16 [2616.36–3841.01] | 3398.54 [2884.91–3624.68] | 13.4% |
| tasks-1-warm | 146.53 [138.65–187.02] | 382.83 [302.12–482.94] | 161.3% |

| RSS, MiB | Profile off median [min–max] | Profile on median [min–max] |
| --- | ---: | ---: |
| peakRSS, parent | 890.14 [872.59–1017.55] | 887.74 [877.43–1016.68] |
| peakRSS, worker | 1200.00 [1016.93–1217.68] | 1199.78 [1045.26–1220.37] |
| idleRSS, parent | 836.80 [832.48–840.37] | 856.46 [853.88–860.15] |
| idleRSS, worker | 1087.15 [990.16–1104.45] | 1108.89 [1024.17–1112.07] |

20 paired canonical reply comparisons, 0 differences. 15 completed profile files, 3414240 bytes, 0 capture errors. Idle RSS means resident calculators after 250 ms without a request; it is not post-retirement RSS. Small warm-response percentages are sensitive to scheduling and GC. These short captures measure request overhead, not a ten-minute soak.

With the same pack/default environment and an already copied, validated scratch input:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/live-calculator-profile.mjs --data-dir /tmp/REPLACE_WITH_SAVE_COPY --out /tmp/REPLACE_WITH_FRESH_OUTPUT
```

### Always-on timing overhead and synthetic profile load

Five fresh processes per mode, 3,000 HTTP requests per trial (1,000 cycles of cached play state, cached play tasks and How). The HTTP client runs in the picker process; sampling therefore includes driver work. The synthetic fixture injects a larger expensive-request budget so throttling does not define the result. Production limits are unchanged. Warmup, profile switch calls, final flushing and profile file writes are outside the measured HTTP loop. No other tests or calculator jobs ran during these final trials.

| Mode | ms/request, median [min–max] | Loop ms, median [min–max] | Parent CPU ms, median [min–max] |
| --- | ---: | ---: | ---: |
| off | 2.356 [1.992–2.921] | 7067.499 [5974.776–8762.046] | 8419.477 [7260.702–9462.995] |
| on | 3.352 [1.848–8.039] | 10055.875 [5543.945–24117.824] | 11269.525 [6749.686–27411.333] |
| profile | 2.750 [2.101–4.466] | 8249.479 [6303.478–13397.337] | 9755.148 [7393.464–14492.881] |

Median HTTP difference with timings enabled: 42.28%. Active CPU profiling versus timings enabled: -17.96%. These differences include ordinary scheduling/GC variation; the isolated collector measurement below is the direct overhead evidence.

| Synthetic RSS, MiB | Off median [min–max] | On median [min–max] | Profile median [min–max] |
| --- | ---: | ---: | ---: |
| parentPeak | 476.723 [452.996–484.926] | 453.547 [438.660–476.785] | 457.418 [449.430–460.039] |
| workerPeak | 260.297 [258.707–260.836] | 260.945 [257.645–269.887] | 264.648 [248.363–273.391] |
| parentIdle | 476.723 [452.996–484.926] | 453.547 [438.660–476.785] | 457.418 [449.430–460.039] |
| workerIdle | 259.184 [247.859–260.598] | 260.945 [257.645–269.887] | 263.586 [234.148–272.813] |

The isolated collector experiment runs 100,000 synthetic request completions per sample, five samples per setting, without HTTP, workers or gameplay. It exercises request classification, async context, numeric stage handling, event-ring updates and histogram recording.

| Collector | µs/request, median [min–max] | Final flush ms, median [min–max] |
| --- | ---: | ---: |
| off | 0.209 [0.150–0.264] | 0.041 [0.022–0.251] |
| on | 3.496 [3.188–4.413] | 5.119 [2.952–22.099] |

Added median collector work: 3.287 µs/request. The final flush measurement is for a saturated recent-event ring, not a worst-case seven-day histogram. Persistence serializes only once per minute and on orderly shutdown.

### Final steady-state HTTP control

The earlier HTTP run showed a 42.28% median increase with timings enabled, while its profiled arm was faster than its timings-only arm. That result did not establish a stable overhead estimate. The final application fixes also keep inspector unloaded until capture is requested and keep diagnostic metadata out of serialized scheduler replies.

A separate five-fresh-process-per-mode control uses 50 warmup cycles and three explicit garbage collections before the measurement window. It runs after other tests and calculators have stopped, with 3,000 requests per trial and the same injected synthetic request budgets. This measures warmed steady-state behavior and does not establish cold-start overhead.

| Mode | ms/request, median [min–max] | Parent CPU ms, median [min–max] | Prepared heap MiB, median [min–max] |
| --- | ---: | ---: | ---: |
| off | 2.757 [2.172–3.381] | 9904.276 [7478.187–13255.490] | 154.036 [152.773–154.060] |
| on | 2.444 [2.162–3.002] | 8701.180 [7474.000–11190.643] | 154.118 [152.847–154.133] |
| profile | 2.695 [2.225–5.216] | 10804.693 [8005.895–21208.342] | 155.501 [153.982–155.515] |

Timings-on versus off median: -11.34%; profile versus timings-on median: 10.26%. The ranges overlap. These HTTP runs do not resolve the small collector cost or demonstrate a speed improvement. The isolated cache-hit collector measurement adds a median 3.287 µs/request; end-to-end measurements remain sensitive to process/GC/scheduling variation. Active profiling adds about 11–13% to the real-pack cold task medians above and should be treated as an on-demand diagnostic cost.

## Validation and integration fixes

The first quick run completed with 3,434 passed, 3 failed and 68 skipped (3,505 cases). Its failures exposed eager inspector loading, enumerable diagnostic fields changing scheduler reply bytes, and a broken y06 trace-loader source seam. The fixes lazy-load inspector only on capture, make diagnostic fields non-enumerable, and preserve the existing tracing seams. No existing assertion was relaxed. The expanded targeted run then passed 150 tests with 0 failures. A further peer-cache regression confirmed that old coalescing/start flags could survive promotion; discarding those waiter-only fields passed 151 focused tests with 0 failures. It includes the two original failing test files, the new timing/profile acceptance tests, scheduler/process transport, HTTP actions, permissions, test classification and writer handover.

The added lifecycle test also found and fixed capture-before-online for newly created calculators. Process and thread modes now wait for their online boundary. Private result hashes and real-pack request windows above were captured on the already-ready worker path; the later integration fixes affect loading, metadata enumeration and the new-worker profile boundary. They do not alter calculator requests, computations or returned gameplay values. The final public differential and targeted byte-compatibility tests exercise the corrected sources.

### Public Q2 differential

All runs used the existing supervisor, its 10,000 ms request deadline, 780,000 ms campaign budget and 2 GiB group RSS cap. Candidate runs apply the staged patch to a detached START worktree; no calculator ref or test expectation was changed. The full synthetic and fixture-harvest corpus covers all nine operations.

| Run | Compared pairs | Successful / matching error pairs | Differences | Outcome | Duration ms | Sampled peak group RSS MiB |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| Initial candidate | 1548 | 1247 / 301 | 0 | PASS | 144321.51 | 1159.06 |
| Concurrent candidate attempt | 1498 | 1217 / 281 | 0 | request timeout | 154651.91 | 1217.89 |
| Isolated candidate attempt | 0 | 0 / 0 | 0 | request timeout | 36708.74 | 1022.53 |
| Untouched START control | 1548 | 1247 / 301 | 0 | PASS | 107174.67 | 1188.55 |
| Final isolated candidate | 1548 | 1247 / 301 | 0 | PASS | 115555.69 | 1246.68 |

The final candidate passed 1548/1548 pairs with 0 harness errors and successful coverage of every operation. The two timeout attempts remain recorded: one overlapped the first quick suite; one occurred in isolation before any result pair. The unchanged START control and the final candidate then passed in isolation with the same deadline. This host showed substantial timing variation; no request budget was raised to obtain a pass. Final candidate patch SHA-256: `8dd86689e8c05883fa11e093891e1b7271648c17444232b796dd083564ead594`. Final corpus SHA-256: `ea550399b545047cee4b3340b767c37b132bac309f41c41af67f42446089fbf1`. After this passing snapshot, a focused cache-promotion regression exposed stale waiter flags. The follow-up removes only those diagnostic properties when retaining peer results; the final focused and quick results below cover that correction. Calculator engine/worker bodies and request encodings are unchanged.

Private checks: 0 changes in the input checkout, 0 credential files in the copied save, 0 state-file byte differences after measurement. No private server/store was opened, and no access tokens, invites or keys were created against the private copy. No full `npm test` was run.

The first corrected quick rerun passed 3,437 tests with 0 failures and 68 skips (3,505 cases, 476.10 seconds), using the supported four-file concurrency cap. The final cache-promotion test adds one case; the last quick selection is reported below.

### Final quick gate

Final focused tests: **151 passed, 0 failed** (32.86 seconds). The peer-cache test first reproduced stale producer/follower flags, then passed after cache copies dropped those diagnostic fields.

Final complete quick selection: **3,438 passed, 0 failed, 68 skipped**, 3,506 cases in 503.81 seconds, using `RS3_TEST_CONCURRENCY=4 npm run test:quick`. A detached supervisor recorded exit code 0 and no signal. One earlier final attempt was terminated by a tool-transport reset before a completion summary; it is treated as interrupted, not as a passing run. No assertion, deadline, source comparator or skip condition was weakened. Existing skipped cases were retained.

The implementation is staged on `perf/t1-live-timings`; no push, PR or deployment was performed. The shared hotspot edits are confined to `app/server.mjs`, `app/tasks/scheduler.mjs`, `app/tasks/calculator-pool.mjs` and the process-worker adapter/host. `app/tasks/engine.mjs`, `app/tasks/worker.mjs`, game rules/state behavior, changelog and roadmap are unchanged.

## Remaining limits

- Hourly window boundaries and 5% percentile buckets are approximations; the recent slow-event list is bounded to 2,048 events. Extreme byte-cap saturation can shorten persisted hourly history.
- HTTP microbenchmarks on this host show substantial variance. The low-level collector cost is small; the HTTP samples do not establish a precise end-to-end overhead bound.
- Active profiling has a measured diagnostic cost and can lose captures from calculators retired before completion. The error count exposes discarded captures.
- The VPS runner has guard and manifest checks but has not been executed on the operator's VPS. Its actual VPS output remains an operator action using the root commands above.

### Exact final-source differential

After the cache-promotion correction, the exact staged application source passed a further isolated differential: **1548/1548 pairs, 1247 successful result pairs, 301 matching negative-case pairs, 0 differences, 0 harness errors**. Duration 106591.76 ms; sampled peak group RSS 1220.86 MiB. Request deadline remains 10,000 ms. Candidate patch SHA-256: `8a3774c2f4e78d9771bcdb7f46d12d4aa1be17aa8a01828b34e2eddf9bb1e86c`; corpus SHA-256: `e5d8635cad3f2994649fcc1bf63573b008a1ffda5bd7b1698965eb9b7c8b007b`. Only report completion and scratch cleanup follow this source snapshot.

Recommendation: **MERGE-CANDIDATE**. Status: **SHIP**.
