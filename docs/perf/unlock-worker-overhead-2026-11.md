# Unprepared unlock worker overhead — November 16, 2026

Partial improvement for [issue #294](https://github.com/fenerax/chunk-picker-rs3/issues/294).
The final comparison reduced median worker time outside the engine by 25.3%,
below the required 50%. Keep the issue open. End-to-end latency did not improve
in that comparison; the core engine was substantially slower on the shared PC.

## Final comparison

Seconds, **median / nearest-rank p95 / maximum**, over 20 completed rolls on
each implementation. Compute each remainder per roll before aggregating it.

| Interval | Before | After |
| --- | ---: | ---: |
| Roll to tasks shown | 6.548 / 9.111 / 11.219 | 7.314 / 11.134 / 11.743 |
| Worker calculation | 5.164 / 6.873 / 9.483 | 5.213 / 7.035 / 8.805 |
| Core engine | 2.082 / 3.089 / 3.590 | 3.063 / 4.405 / 5.574 |
| Worker outside core engine | 3.101 / 4.788 / 5.893 | 2.316 / 2.780 / 3.230 |
| Worker less all named stages | 2.909 / 4.609 / 5.478 | 2.037 / 2.556 / 2.706 |

An earlier 20-roll comparison, before the encoder change, reduced median
outside-engine time from 4.428 to 2.731 seconds (38.3%). Its roll-to-tasks
medians were 9.073 and 7.813 seconds. Both comparisons matched all 20 normalized
task-result hashes and counts. Neither establishes the acceptance target.
There were no failed timed rolls in these four completed runs. One final-code
launch failed before navigation because a disposable wrapper left an empty
idle-timeout environment variable; a fresh shell corrected it. It contributed
no timed observations.

## Profile and change

The unchanged-runtime HTTP diagnostic profiled the same unlock of `12085` as
[PR #293](https://github.com/fenerax/chunk-picker-rs3/pull/293). Across its two
evaluations, snapshot-cache measurement had 4.125 seconds of inclusive sampled
time, including 2.394 seconds in the wire encoder. Heap walking had 1.724
seconds of self samples. Inclusive stacks overlap and must not be added.

The worker admitted a baseline before projecting its map-task locations. Adding
the locations immediately refreshed that snapshot. Full-data graphs exceeded
the hot bound, so both admissions walked and serialized the same large baseline.
HTTP evaluations now prepare locations before their first cache admission.
The later projection refresh finds the same content version and reuses its cost
and bytes. Other callers retain their existing lazy refreshes.

Heap admission now stops once its conservative charge exceeds the existing
128 MiB hot bound. That partial charge proves the graph cannot be hot; it is
never used to admit a hot graph. Fitting graphs still receive their complete
charge. Cold entries still pay their exact dedicated backing allocation plus
the existing key/owner allowance. The partial meter is discarded before reuse.
Owner, worker, eligibility, snapshot-partition and hot-set limits, preservation
preflights, LRU eviction and forced-refresh paths remain in place.

The remaining encoder scans matching words four bytes at a time, then finds
the exact byte boundary. On a captured synthetic snapshot, both the baseline
and new encoder produced the same 8,135,515 bytes from 58,098,264 native bytes.
The baseline decoder read the new bytes exactly. The encoded SHA-256 was
`a30287f87be9f3085bc3eb7c6d92e50c7f9ef817176a6f8c6baa3f6b4aee4d5c`.
This is a compatibility check, not an end-to-end performance claim. Save,
native snapshot and LZ4 formats are unchanged.

A new ownership baseline still requires one complete cold snapshot encoding.
Reusing separately encoded baseline components would require another snapshot
representation. This change stops before introducing that representation or
changing what the current release can read. Further work must still demonstrate
the 50% reduction; these results do not close #294.

## Reproduction and scope

The baseline is `681b89c323c37ee229ff9067aecd675218cf26ad`. Reuse #293's existing
page-load harness, probe, network collector, CDP client, input helpers and HTTP/
worker profiler through disposable ignored adapters. No harness or CI job is
added. Both implementations use the full `duo-legacy` provider, digest
`b9ab7bc8e5ad7358919210d3585842ce07a5ad166f2e2ee8d3964d47a6de6c7c`.

Use the same synthetic BFS-grown 40-chunk maps, default rules, skipped setup,
seed 1729, 20 chunks in the same order, and 14+6 process boundary as #293.
Keep prediction disabled, Preview unused, one calculator, Personal view and
`tasks` settlement. Every measured response must report an unprepared miss.
Fixture hashes remain
`a192d67f184699638eadb725190663e3707084e54f952ed01efd3dcc048db690` and
`ec1d193765023d89d6081c1e782a2a6bb425327da0313e1f5ccedbf4860f0978`.
Compare result SHA-256 hashes after recursively removing cache, revision and
timing metadata, retaining all other fields and task order. Counts remain
20,605–20,621 tasks. The comparisons matched all chunks, hashes and counts.

Run sequentially under the shared heavy-work lock at BelowNormal priority,
admit at 5 GiB free RAM or more, and release each lease within ten minutes.
Keep ordinary runtime admission enabled. Use Node 24.20.0, Chrome
157.0.8103.51, 1440×900 at DPR 1, and the existing 30 Mbps / 40 ms network
emulation. Cold initialization precedes timing. Shared-PC contention varied
substantially; these are localhost synthetic observations, not public-network
or Group-view measurements. Raw reports, full inputs and adapters stay ignored.

## Verification

Run focused files individually through `runSelectedTests` with `testRunPolicy`,
one worker, normal free-memory admission and the same shared lock/priority:
all 84 cases in these ten files passed, with no failures or skips.

- `tests/serialized-snapshot-cache.test.mjs`
- `tests/snapshot-wire.test.mjs`
- `tests/engine-cache-worker.test.mjs`
- `tests/engine-cache-snapshot.test.mjs`
- `tests/engine-cache-eligibility.test.mjs`
- `tests/engine-cache-multi-picker.test.mjs`
- `tests/engine-cache-probe.test.mjs`
- `tests/map-task-locations.test.mjs`
- `tests/unlock-calc-harness.test.mjs`
- `tests/unlock-paired-harness.test.mjs`

The added regressions count encodes, compare complete fitting heap charges,
exercise early rejection and cold readback, and check both retained ledgers.
They contain no wall-clock assertions. Full CI and the changed worker test's
hosted stability proof remain merge requirements.
