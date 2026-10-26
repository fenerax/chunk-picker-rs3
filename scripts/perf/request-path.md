# Process calculator request path

This benchmark uses only `scale-dataset.mjs` synthetic companions. It rejects
companions without that generator's synthetic provenance. It never opens an
installed save, fetches data, or changes scheduler admission, planning or engine
rules. Both application revisions consume the same generated pack.

## Reproduce

Use Node 24. Generate the companion with the candidate's repaired generator,
then reconstruct the baseline from the recorded START using local Git objects:

```sh
node --max-old-space-size=3072 scripts/perf/scale-dataset.mjs --scale 400 --out /tmp/request-scale400
mkdir /tmp/request-before
git archive 90dcb2aaf181e036dfd9dacf9807ecf59d9720cd | tar -x -C /tmp/request-before
taskset -c 0,1 node scripts/perf/request-path-paired.mjs \
  --before /tmp/request-before --after "$PWD" \
  --companion /tmp/request-scale400 --pairs 7 --mode http \
  --output /tmp/request-pairs.json
```

Choose two CPUs in the machine's allowed affinity. The driver starts fresh,
sequential server processes with process calculators and a 3072 MiB heap. Each
pair alternates AB/BA order. Do not run heavy tests alongside measurements.
Per-run JSON reports, event logs and stderr sit beside the requested output;
the aggregate includes raw observations, medians, min/max, order-statistic
quartiles and within-pair deltas. It asserts equality of hashes of **complete**
normalized Preview and post-unlock Tasks responses in every pair. It removes
only duration fields. Ordered rows, counts, cache flags and revision metadata
remain in those hashes. Command bodies and save contents are not retained.

The HTTP scenario opens the selected member's tasks and warms a prediction
calculator, changes gameplay to invalidate its snapshot, and opens current
tasks. It then times Preview of a different locked surface chunk, the matching
unlock command, and refreshed Tasks. `set-chunk` performs the deterministic
unlock transition without relying on random roll pools. Group view is off in
the timed HTTP scenario; the worker regression checks both members, both Group
projections, full/compact results, and locked/unlocked chunks against native
thread responses. The HTTP duration includes body reading, parsing and response
hashing. It excludes browser rendering and operator interaction.

For a lower-level idle calculator round trip, use `--mode object` or `--mode json`.
These modes compare full normalized compact response hashes. To inspect one run:

```sh
node --expose-internals --expose-gc --max-old-space-size=3072 \
  --import ./scripts/perf/request-path-probe.mjs scripts/perf/request-path.mjs \
  --companion /tmp/request-scale400 --output /tmp/request-one.json --requests 1
```

## Measurement boundaries

The diagnostic preload is never imported by normal application code. It uses
Node's internal channel codec **only for measurement** (`--expose-internals`).
This Node 24 build uses native IPC serialization that bypasses public V8 class
hooks, so the probe observes the actual buffer passed to `writeBuffer` and the
fork channel's native read callback. No second serialization occurs on the
timed path.

- Capture: the server's lazy structured clone of the calculation state.
- Queue: scheduler enqueue to dispatch, with normal scheduler rules unchanged.
- Encode: the JS graph copy/replacement pass in `encodeProcessMessage`.
- IPC serialization: channel codec entry to the serialized buffer write.
- Bytes: exact serialized envelope bytes, excluding the four-byte frame header.
- IPC read: final frame reassembly, native deserialization and dispatch setup.
  Earlier fragment processing is accounted for in delivery/queueing.
- IPC delivery/queue: send return to the start of that final channel read.
- Shared restoration: reconstruct buffers/views and substitute placeholders.
- Thread serialization: the host's synchronous `worker.postMessage` call.
- Thread receive/queue: that call's return to the calculator's first listener;
  native thread deserialization and scheduling cannot be separated by this probe.
- Receipt: the HTTP action start to calculator message receipt, before engine work.

RSS is sampled from Linux `/proc` every 50 ms across the server and its entire
owned process tree, with action and whole-run peaks reported separately. The
report also retains each process's kernel RSS high-water mark; those independent
maxima must not be added as though they occurred simultaneously. Sampling can
miss short simultaneous tree peaks.

## Scope and validation

The candidate copies ordinary properties with assignment (retaining the
`__proto__` data-slot special case) and records direct owners of shared
placeholders. The owned receiver repairs only those slots. A four-byte
cancellation word no longer forces traversal of the whole ordinary save. Cycles,
Map keys, Set order, shared views, roots and aliases retain their identities.
Older envelopes fall back to the original complete restoration walk. There is
no new state cache, persistent buffer, lifecycle or revision protocol.

The generator repairs are limited to missing empty topology/history metadata
and permanent synthetic task IDs accepted by the duo-shaped save validator.

The container's PID 1 does not reap orphaned children. Run lifecycle tests below
an ordinary Linux init/subreaper so the existing orphan-cleanup assertion observes
exited children disappearing, rather than unreaped zombies. The application and
the assertion remain unchanged.

The checked-in results are synthetic measurements, not evidence from the duo's
scrubbed save or GitHub runner. That real-save benchmark remains the merge gate.

## Scale-400 results

START: `90dcb2aaf181e036dfd9dacf9807ecf59d9720cd`. Node v24.19.0, two allowed CPUs, process calculators, 3072 MiB heap, seven alternating AB/BA pairs. Synthetic inputs: 459.9 MiB; captured JSON state: 106.3 MiB. All 14 normalized response signatures matched.

Times are milliseconds; parentheses show the full min–max range. RSS rows are MiB. Raw observations, quartiles, paired deltas and source hashes are in [request-path-results.json](request-path-results.json).

| Measurement | START median (range) | Candidate median (range) | Paired median delta |
|---|---:|---:|---:|
| Server state clone | 1008.11 (977.70–1084.06) | 971.99 (943.28–1056.88) | -34.42 |
| Scheduler queue | 0.06 (0.05–0.09) | 0.06 (0.06–0.08) | +0.00 |
| Transport graph encode | 1052.76 (968.06–1094.12) | 568.66 (482.39–591.96) | -474.65 |
| Native IPC serialization | 399.57 (374.13–450.38) | 401.53 (380.57–417.92) | +6.44 |
| IPC reassembly/deserialization | 794.96 (694.79–913.59) | 786.28 (678.28–1021.71) | -8.68 |
| IPC delivery/fragment processing/queue | 443.05 (264.27–500.43) | 464.40 (273.15–519.48) | +47.43 |
| Shared placeholder restoration | 435.11 (355.86–502.02) | 0.05 (0.04–0.07) | -435.07 |
| Host → calculator serialization | 363.03 (337.51–387.50) | 336.12 (319.53–367.70) | -22.49 |
| Calculator deserialization/queue | 1385.23 (1328.36–1477.64) | 1341.00 (704.19–1542.87) | -43.74 |
| HTTP action → calculator receipt | 5935.12 (5669.64–6076.69) | 4691.04 (4239.57–5262.26) | -1025.43 |
| HTTP Preview | 26528.74 (25578.64–27449.44) | 25794.18 (24399.97–27032.06) | -1655.26 |
| HTTP Preview → Unlock → Tasks | 27409.76 (26600.45–28240.51) | 26694.92 (25140.92–27800.01) | -1371.45 |
| Sampled action process-tree peak RSS | 7104.84 (7079.10–7143.40) | 6839.50 (6784.74–6930.32) | -265.31 |

The targeted graph copy plus restoration fell from 1463 to 569 ms. The paired median saving was 910 ms, or 3.3% of the baseline whole action. Calculator receipt improved in every pair. Whole-action paired differences ranged from −2549 to +915 ms: one candidate action was slower, so the end-to-end improvement is smaller and less consistent than the isolated transport result.

Exact outgoing envelopes were 109,944,368 bytes before and 109,944,384 after (16 metadata bytes added). The ordinary state still crosses both native boundaries; the patch does not reduce its volume. Existing JSON-byte evaluations avoid the ordinary graph copy already; across the warm-up requests their state parsing medians were 990/1063 ms before/after (14 samples per variant).

The HTTP benchmark times one selected member with Group view off. Both members, Group projections on/off, complete/full and compact bytes, and locked/unlocked chunks are checked in the regression test. Browser paint, a busy scheduler, and the real scrubbed duo save remain unmeasured.

## Verification

| Run | Passed | Failed | Skipped |
|---|---:|---:|---:|
| `npm run test:quick` | 2313 | 1 | 65 |
| `npm test` | 5345 | 1 | 137 |
| Focused process worker/transport files | 17 | 0 | 0 |
| Coverage reporter file unchanged at START | 4 | 1 | 0 |

Both required-suite failures are the same existing assertion in
`tests/ci-coverage-reporter.test.mjs`: **Native coverage count mismatch:
 tests/fixture.test.mjs**. It reproduces at START on this Node 24.19 environment.
The coverage reporter, test runner, scheduler, planning and engine are unchanged.

The suite commands ran below a temporary Linux `PR_SET_CHILD_SUBREAPER` ancestor
so the container behaves like a normally reaping init for the existing orphan
cleanup regression. The first unwrapped focused run failed only that orphan
assertion because its exited child remained a zombie; final focused tests pass
unchanged under the reaper.
