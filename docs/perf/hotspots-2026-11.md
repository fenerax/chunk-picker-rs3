# Where the picker waits — November 2026

Prioritize cold prediction, task evaluation and worker startup. Application code and game behaviour are unchanged; these are baseline measurements and proposed savings.

Linux, Node 24.21.0, process workers, real packs; five fresh processes per timing set. This container has 4 CPU / 16 GiB, versus the VPS’s 6 vCPU / 11 GiB. Times are median [min–max] for local components. Shares name their denominator; overlapping rows must not be added. Ranking is by cache-miss cost; live hit frequency is unmeasured. Details and run labels are in the [evidence](hotspots-2026-11-evidence.md).

| Rank | What the user is doing | Real-size time | Share of measured action | Evidence | Rough saving budget |
| --- | --- | --- | --- | --- | --- |
| 1 | Open first roll Preview | 12.74 [11.08–13.27] s | 80% core engine | B/P1–5; CP | 3–6 s |
| 2 | First task list, player indices 0 / 1 | 7.56 [6.48–9.72] / 4.86 [4.71–6.97] s | 86% / 74% core engine | B/E1–5, M1–5; C0/C1 | 0.5–2 s per calculation |
| 3 | Wake a foreground calculator | 6.48 [5.59–9.57] s | 46% of startup + first-list sum | B/E1–5 startup | 2–4 s per wake |
| 4 | Build first roll pool in a fresh worker | 5.54 [4.81–7.65] s | 79% pool stage | B/P1–5; CP | 0.5–2 s |
| 5 | Open How, sampled row index 354 | 3.57 [2.49–3.89] s | 99% proof stage | B/E1–5, three sampled rows | 0.5–2 s |
| 6 | Refresh both lists after accepting, reuse miss | 2.47 [2.13–3.84] s of worker jobs | 67% of direct request sum | B/E1–5; compute only | 1–2 s through existing reuse; hit rate unknown |
| 7 | Repeat Preview when scheduler cache misses | 1.82 [1.66–2.78] s | 99% worker job | B/P1–5 warm | 1–1.5 s |
| 8 | First saved Why, sampled row index 354 | 0.50 [0.43–0.67] s | 96% first-versus-repeat gap | B/E1–5, three sampled rows | 0.2–0.5 s |

**Cold prediction:** reuse an exact baseline in a bounded, resident prediction calculator, then reduce owner/partner eligibility work. First prediction is 12.74 s versus 1.82 s on repeat; startup adds 6.13 s. Risks are stale-state reuse, foreground contention and RSS. Measure first-Preview p50/p95 under both players, with zero calculator differences and bounded memory.

**Task evaluation:** target `createCompiledTaskEngine`, obligation-cache `evaluate`/`mask`, and `check`/`evaluatePass`. CPU samples repeatedly identify these functions and allocation/GC. Reduce path-mask construction, scans and allocations while preserving conservative cycle handling. Incorrect invalidation can change eligibility. Require zero differences on the full calculator corpus and repeat both independently cold member measurements.

**Worker startup:** target dataset evaluation (1.57 s) and initialization (2.82 s) with hash-keyed prepared data and bounded retention. Module loading is only 12 ms. Retention trades latency for memory: the mixed workload worker peaks at 1.76 GiB. Measure spawn-to-ready and total picker RSS on the 11 GiB VPS before expanding residency.

The Windows multi-second result is **not reproduced**. Full Linux cold/reload walls are 2.13 / 1.24 s. Encoding/cache coverage is 255 / 254 ms (12% / 20%); flush is 109 / 84 ms (5% / 7%). Flush measures `response.end()` to Node `finish`, including OS backpressure and scheduling. No slow-reader dominance is evident here.

Synchronous prediction admission is a smaller shared-thread risk: 54 [47–83] ms in the racing-accept case, 35 [32–59] ms for the final pair alone. Offloading could help responsiveness, with a smaller latency budget than engine work. Response sizes/encoding, startup splits, memory and four top-15 CPU lists are in the [evidence tables](hotspots-2026-11-evidence.md) and [numeric evidence](hotspots-2026-11-evidence.json).

Unmeasured: real browser/WAN latency, durable accept I/O, scheduler reuse rates and contention. Ranked accept compute excludes slower harness object transfer and public-command validation. Why may additionally need a 0.84 s full-result supplement; exact store metadata is excluded from response sizes. Part C was skipped because adapting the scaled companion’s topology into valid browser fixtures was not cheap. These limits prevent an end-to-end VPS promise.

Validation: 13 profiler tests and two writer checks passed, 0 failed. Whole-report stringify fails at the tested limit; streamed output verifies 545,261,090 bytes. Five full browser repetitions complete. No quick/full suite for this measurement-only scope. Private audit: 431 files, 0 differences, 0 credential artifacts, 0 lab changes.

START `c185bd7c932d96642506b10c3c0935fb689b7d02`. Recommendation: **MERGE-CANDIDATE** for the measurement tooling and evidence.
