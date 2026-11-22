# Unprepared roll measurements — November 16, 2026

Measurement for [issue #285](https://github.com/fenerax/chunk-picker-rs3/issues/285).

The measured unprepared path misses the three-second target. This PR records
measurements and options; it changes no application code. Even the unchanged-code
repeat has a 4.43-second maximum in core task calculation alone. Reaching the
target for every measured chunk requires reducing calculation work as well as
the surrounding work. Stop at the measurement boundary allowed by the issue;
the deeper calculation change needs its own implementation and equivalence checks.

## Results

Seconds, over the same 20 completed rolls per run. Each cell is
**median / nearest-rank p95 / maximum**. “After” is an unchanged-runtime control,
not an optimization. Background activity on this shared machine varied.

| Interval | Before | After: unchanged-runtime control |
| --- | ---: | ---: |
| Roll → tasks shown | 11.303 / 17.665 / 22.377 | 6.902 / 9.513 / 9.677 |
| Worker calculation total | 8.886 / 14.778 / 19.318 | 5.631 / 7.804 / 7.840 |
| Core engine | 3.410 / 5.849 / 9.652 | 2.332 / 3.363 / 4.432 |
| Collection | 0.008 / 0.012 / 0.015 | 0.005 / 0.009 / 0.015 |
| Equipment | 0.070 / 0.208 / 0.341 | 0.049 / 0.085 / 0.177 |
| Presentation | 0.206 / 0.297 / 0.323 | 0.174 / 0.268 / 0.269 |
| Worker total less named stages | 4.899 / 8.624 / 9.213 | 2.852 / 4.120 / 4.538 |
| Browser after task JSON | 1.955 / 4.044 / 4.464 | 1.124 / 1.545 / 1.547 |
| JSON read/parse | 0.062 / 0.097 / 0.112 | 0.043 / 0.070 / 0.071 |
| Roll → successful command response complete | 10.804 / 17.157 / 21.904 | 6.649 / 9.167 / 9.273 |
| Browser after both command and task inputs | 0.488 / 0.528 / 0.530 | 0.328 / 0.428 / 0.451 |

Core engine time exceeds three seconds on 13/20 baseline rolls and 4/20 repeat
rolls. Every completed end-to-end observation exceeds three seconds. The worker
remainder is not an exclusive serialization measurement. The browser intervals
measure observable adoption/drawing and scheduling, not exclusive rendering CPU.

The baseline first attempted a continuous 20-roll sequence. Roll 15 returned a
task HTTP 504 and exceeded the 60-second observation window. Its latency is
**at least 60 seconds**, not 22.377 seconds. Retain the first 14 completed rolls,
then measure the remaining six from a fresh process with the grown map. This
14+6 boundary was chosen after the failure and reused for the control; neither
20-row summary establishes a successful continuous 20-roll run. An earlier cold
attempt returned HTTP 503 under memory pressure and was excluded. Subsequent
runs waited for at least 5 GiB free RAM before admission; resource admission
remained enabled. These failures matter alongside the completed-roll statistics.

## Inputs and method

The application baseline is `8e72d2957bb2e457c944865a4e23e6beac5f2977`.
The full `duo-legacy` data provider has digest
`b9ab7bc8e5ad7358919210d3585842ce07a5ad166f2e2ee8d3964d47a6de6c7c`,
2,556 chunk definition records and 1,116 surface chunks. This is not the
included F2P slice.

Both maps are synthetic. Start with `createGroupState`, players `player1` and
`player2`, and default rules. Give each player 40 surface chunks by breadth-first
traversal of `buildWorld(...).neighbors`, starting at `12850` and `12854`
respectively. Sort each node's neighbors numerically before enqueueing them,
ignore already visited and nonsurface chunks, and stop at 40. Set the setup
guide preference to `skipped`. Leave tasks, completions, selections, pending
rolls, equipment and observed account progress empty. Serialize the normal
backup envelope. No personal saves or installed server are inputs.

Reuse `scripts/perf/page-load.mjs`, `probe.mjs`, `network-collector.mjs`,
`cdp.mjs`, and `inputs.mjs` in a disposable, ignored adapter. The adapter injects
`seededRandom(1729)` and a one-calculator limit into its scratch server and
replaces the single manual unlock with clicks of the ordinary one-chunk Roll button. Each click grows
player1's map by one chunk; player2 stays at 40 chunks. Restore the same starting
fixture and random seed for the comparison run. Measure rolls 1–14 in one process
and rolls 15–20 in another, starting the latter with the first 14 chunks already
owned and advancing the random source by 14 draws. Use the same batch boundaries
for the comparison. Disable prediction prewarming,
leave Preview unused, and require a prediction miss on every measured roll.
Cold page/server initialization precedes the timed interactions.

The desktop has an Intel i7-8700K, 12 logical CPUs and about 32 GiB RAM.
Use Node v24.20.0 and headless Chrome/157.0.8103.51 at 1440×900, DPR 1.
Keep the existing page-load harness network emulation: 30 Mbps and 40 ms latency.
Initialize the normal browser-storage task-view preference before navigation;
setting the checkbox alone is overwritten by the current preference loader.

The browser uses Personal view. Settlement follows the existing `tasks` policy:
current selected-player tasks and visible terrain are ready. Background advisories
may still be running. These measurements do not cover Group view or a public
network.

Run sequentially on the desktop under the shared heavy-work lock at BelowNormal
priority, within the ten-minute lease. Application source, data digest and
fixture hash must match across runs. Keep raw reports, the adapter and full-data
inputs outside tracked source; no standing harness or CI job is added.

## Timing boundaries

- Roll to tasks: the browser timestamp immediately before clicking Roll through
  the application's `tasks-shown` event for the new revision.
- Worker calculation: the existing response's `cache.evaluationMs` and
  `cache.timingMs`. Engine, collection, equipment and presentation stages belong
  to this worker total.
- Browser after JSON: `tasks-shown` minus completion of the selected response's
  existing `Response.json()` call. This includes result adoption, rendering and
  scheduling, and can include waiting for command acknowledgement. It is not an
  exclusive CPU profile of rendering.
- Browser after both inputs: `tasks-shown` minus the later of task JSON completion
  and successful command-response body completion. This separates the preceding
  command wait from subsequent browser adoption/drawing and scheduling.
- Command response: Roll through completion of the successful command response,
  including any client retries. It is not the duration of just the last retry.
- Response JSON read/parse: the existing probe's `Response.json()` interval.
  It can include waiting for body bytes as well as parsing.

Worker work can overlap command-response pool construction. These intervals
must not be added as if they were serial stages. Report medians and nearest-rank
p95/max over the 20 individual rolls, retaining each chunk's observation.

## Task comparison

After each timed interaction, read the cached Personal `play-v1` task result
for that revision. Compare SHA-256 hashes after removing cache, revision and
timing metadata, preserving task order and all other result fields. Do this
outside the timed interval. A comparison run must roll the same 20 chunks in
the same order and match all 20 result hashes and task counts.

The control matched all 20 SHA-256 hashes and task counts (20,605–20,621 tasks).
Both batches matched the application fingerprint
`b23fecb0b807444cba8e1ba9a50a5dd48f77d6f2d4f6716f58d3c64e4e44c323`
and full-data digest. Initial fixture hashes were
`a192d67f184699638eadb725190663e3707084e54f952ed01efd3dcc048db690`
and `ec1d193765023d89d6081c1e782a2a6bb425327da0313e1f5ccedbf4860f0978`
for the first and second batches respectively. No result-equivalence claim is
made for the failed attempt.

The rolled chunks, in order, were `13620, 11570, 12341, 12342, 12343, 12080,
12086, 12087, 11569, 13365, 11827, 12598, 12085, 11831, 12855, 11828, 11830,
11829, 12084, 13110`. Every measured response reported an unprepared prediction
miss. There is no prepared-hit result in these aggregates.

## Calculation boundary and options

A separate diagnostic reused `scripts/perf/interactions.mjs` and the existing
`app/profile-spans.mjs` CPU/span capture. Start with the first 12 measured chunks
added to the initial fixture; tick and untick an available task, roll two choices,
then profile unlocking `12085`. Keep prediction disabled and one calculator.
This HTTP diagnostic refreshes both members and has instrumentation overhead;
exclude it from the browser statistics above. It is evidence about work, not a
second latency benchmark or an equivalent task-result control.

The diagnostic command took 16.497 seconds, including two worker evaluations
of 7.557 and 7.312 seconds. Their core stages were 3.155 and 2.983 seconds;
profiled eligibility spans were 2.838 and 2.734 seconds. The main server thread
was predominantly waiting for the calculator. Durable save preceded command
completion (0.145 seconds), so command acknowledgement is not just disk latency.

Sampled worker stacks locate substantial work outside eligibility in cache
accounting and snapshot representation. Across the diagnostic scenario,
`serialized-snapshot-cache.measure` had about 6.447 seconds of inclusive sampled
time, including `wire` at 3.929 seconds. The heap meter's `visit` had 2.509 seconds
of self samples, V8 `serialize` 2.193 seconds, and `encodeSnapshotBytes` 1.433
seconds. Garbage-collector self samples contributed 0.925 seconds. These sampled
weights include two evaluations and related work; inclusive stacks overlap and
must not be summed. They do not assign every millisecond of the baseline
remainder to one function. Existing result-serialization spans were only about
0.039–0.055 seconds for each evaluation, so HTTP JSON serialization alone does
not explain that remainder.

`app/tasks/scheduler.mjs` can promote an exact prepared result through
`preparedEvaluation`. The bounded unlock cache keys the hypothetical ownership
state and retains the completed task projections. A miss takes the ordinary
worker evaluation path. `app/tasks/worker.mjs` already compiles the engine once
and omits Current BiS and Activity Info when serving `play-v1`; removing those
views again cannot shorten this path.

An ownership change invalidates the eligibility proof. In
`app/tasks/engine.mjs`, eligibility reaches a fixed point over access, sources,
skills, prerequisites and processing. Shared access can also change the other
player's proof. Reusing the old proof solely because most owned chunks stayed
the same would change results.

The implementation options to assess against the measurements are:

1. Reduce repeated heap accounting and snapshot serialization/compression while
   preserving the existing memory caps, owner charges and lazy-field refreshes.
   The profile makes this a useful candidate for a separate bounded change.
   Skipping the accounting or raising cache caps is not a safe shortcut on a
   shared, memory-constrained machine. Even eliminating all worker remainder
   would leave measured core calls above three seconds. Browser adoption and
   response projection offer smaller additional savings.
2. Prepare more likely chunks using the existing prediction lane. This can
   increase hits, but leaves unprepared misses and consumes more background
   calculation and cache capacity. It cannot establish a maximum for misses.
3. Change task calculation to update newly reachable sources and their
   transitive consumers, including shared items, skills, recipes and access.
   This is the deeper rewrite described by the issue. Preserve cold full-result
   equivalence, negative prerequisites and partner effects when designing it.

The issue permits stopping after measurement if the third option is needed.
Its cited 2–5 days is a planning estimate, not a measured implementation time.
The measurements support taking that boundary: there is no demonstrated small
cut that brings every miss below three seconds while preserving task semantics.
The large change should compare full cold results against incremental results
on these same chunks, plus partner-access and negative-prerequisite cases.

## Verification

- Two 20-chunk browser runs on full data, with equal normalized task results,
  chunk order, data digest, application fingerprint and per-batch fixture hashes.
- One separately instrumented synthetic unlock using the existing HTTP profiler.
- `tests/unlock-calc-harness.test.mjs`: 3 passed, no failures or skips.
- `tests/unlock-paired-harness.test.mjs`: 7 passed, no failures or skips.

Run the focused files individually through `runSelectedTests` in
`scripts/test.mjs`, applying `testRunPolicy` and a one-worker cap, under the shared
lock at BelowNormal priority. No tests or runtime files changed, no timing
assertions were added, and no new harness or CI job is retained. Full CI remains
the merge gate; these local Windows checks do not establish hosted CI success.

## Follow-up measurements — November 21, 2026

Re-measured after engine hot-path and warm-closure optimizations (`#350`, `#351`,
`#352`) and the Option 1 worker/snapshot overhead cut (compact deferred-view state
so full-data snapshots stay within the 128 MiB hot-graph budget, exact-revision
`stateJSON` aliasing for `roll-pool`, `retainedDataBytes` primitive fast path,
parallel `prepareRollPools`, and `play-v1` task/registry projection reuse when
saved task references are unchanged).

Measured over 20 continuous unprepared one-chunk rolls on the same synthetic
40-chunk BFS fixture (`12850` / `12854`, `seededRandom(1729)`, full `duo-legacy`
dataset, `predictionPrewarm: false`, `maxCalculators: 1`, HTTP `POST /api/command?view=play-v1`
followed by `GET /api/tasks?memberId=player1&view=play-v1`). Both runs rolled the
exact same 20 chunks (`13365, 11825, 12855, 12856, 13110, 12341, 12599, 12600,
11570, 13366, 12080, 13111, 12598, 12344, 13112, 12088, 12342, 12345, 12601, 13368`)
with 0 prediction hits, 0 failures, and identical normalized `play-v1` SHA-256 hashes
across all 20 rolls (combined digest `93ac8aa64ec679fc51d0fa361d7204755cc5c6ad5eb4804b9cd7a750f96c143c`).

Each cell is **median / p95 / maximum** in seconds (back-to-back runs on the same
desktop; `engineMs` median `0.911s` vs `0.906s` confirms matched CPU load):

| Interval | Before (`67953997`) | After (`bf646864`) |
| --- | ---: | ---: |
| Total (`POST /api/command` + `GET /api/tasks`) | 3.172 / 3.994 / 4.510 | 2.684 / 3.784 / 3.941 |
| Command response | 3.100 / 3.880 / 4.420 | 2.619 / 3.709 / 3.869 |
| Task fetch (`GET /api/tasks`, `hit: true`) | 0.066 / 0.114 / 0.117 | 0.064 / 0.090 / 0.097 |
| Worker evaluation total | 2.142 / 2.909 / 3.081 | 1.535 / 2.100 / 2.183 |
| Core engine (`engineMs`) | 0.911 / 1.314 / 1.361 | 0.906 / 1.216 / 1.271 |
| Collection | 0.004 / 0.007 / 0.007 | 0.003 / 0.007 / 0.007 |
| Equipment | 0.043 / 0.055 / 0.055 | 0.033 / 0.072 / 0.072 |
| Presentation | 0.130 / 0.165 / 0.173 | 0.089 / 0.168 / 0.185 |
| Worker total less named stages | 0.995 / 1.517 / 1.518 | 0.463 / 0.666 / 0.704 |
| Rolls exceeding 3.0 s total | 11 / 20 | 4 / 20 (0 / 20 worker) |

