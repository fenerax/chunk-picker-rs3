# Capacity harness realism evidence

Implemented on `perf/capacity-harness-realism`, based on `605d37c`.
All inputs and stores used for verification were synthetic.

## Changes

| Source | Change |
| --- | --- |
| `scripts/perf/capacity/profiles/nominal.json:6`, `profiles/step-up.json:6` | 23,939 ordinary tasks, 91,000 identity aliases, 15,400,000-byte seed target; no forced rotation. |
| `scripts/perf/capacity/profiles/churn.json:7` | Separate five-minute full-cohort rotation experiment using the same catalogue targets. |
| `scripts/perf/capacity/fixture.mjs:30`, `fixture-worker.mjs:12` | Compile the production calculator handshake once and share its ordinary/dynamic catalogues and migration inputs with fixture workers. |
| `scripts/perf/capacity/fixture-migration.mjs:6`, `fixture-group.mjs:31`, `model.mjs:42` | Use real gameplay migration and dataset identity preparation before durable fixture writes. Calibrated profiles give synthetic tasks permanent identities, so migration creates real registry entries and aliases. Size valid synthetic identity aliases instead of inflating the executable graph. |
| `app/open-diagnostics.mjs:3`, `app/server.mjs:451` | Optional owned-open callback with success/failure, elapsed time and before/after RSS/heap snapshots. Disabled without an observer; observer exceptions are isolated. |
| `app/picker-context.mjs:128`, `app/storage/store.mjs:948` | Dataset verification, hydration/validation, migration/hook validation, retention, sidecars, fingerprints and rule preparation timings. No edits to `prepared()` or the owned membership/identity preparation hook. |
| `app/picker-admission.mjs:12` | Correlated queued, started, completed, deadline and rejected transitions, refusal reasons and optional failure codes; includes immediate refusals. |
| `scripts/perf/capacity/client.mjs:5`, `driver.mjs:116` | Reuse the browser request reader for Retry-After cooldowns and bounded warming/updating read retries; coalesce session preflights; retain scoped picker headers. Writes remain single dispatch. |
| `scripts/perf/capacity/driver.mjs:134`, `client.mjs:16` | Spread initial stream connections, preserve retained clients across stages, reconnect with exponential backoff/jitter and Retry-After; use a separate header deadline per attempt. Attribute disconnects/rejections to their current stage. |
| `scripts/perf/capacity/driver.mjs:157`, `server.mjs:84` | Command type/status latency distributions and sampled event-loop utilisation, active/idle time, and delay percentiles. |
| `scripts/perf/capacity/run.mjs:96`, `report.mjs:4` | Persist owned opens, admission transitions, command distributions and loop measurements in `results.json`, with phase/memory/command/loop/admission tables in `summary.md`. |

## Targeted verification

Node 24.20.0, TAP reporter, one test worker, BelowNormal priority and the shared
heavy lock. The final invocation selected only:

```text
--test --test-concurrency=1 --test-reporter=tap
tests/capacity-realism.test.mjs tests/capacity-harness.test.mjs
```

Result: **24 passed, 0 failed, 0 skipped**, exit 0. The integration case uses a
tiny public-dataset fixture and proves that the first owned serving open keeps
its stored revision while emitting every phase. Retry/backoff checks use fake
clocks/transports, with no wall-time thresholds or per-test time limits.

An earlier invocation found an SSE accounting regression: header deadline aborts
were mistaken for planned shutdown. It was repaired before the passing checks.
The final check also covers stream failures crossing a stage boundary.

No full suite, stability repetitions or longer capacity profile was run.

## One existing smoke profile

Command: `node scripts/perf/capacity/run.mjs --profile smoke --output var/capacity-realism-smoke`.
The output directory is ignored and contains only this run's synthetic state.
The existing profile offered 5 seconds of warm-up and 15 measured seconds.

Result: exit 0; **123 arrivals/completions, 242 HTTP requests, 0 rejects,
0 timeouts, 0 client drops, 0 telemetry errors**, four opened streams, two owned
context opens and clean shutdown. Setup took 10.272 seconds; complete wall time
was 41.279 seconds. Five offered lifecycle/switch actions remain unsupported.

Examples present in both `results.json` and `summary.md`:

| Field | Sample |
| --- | --- |
| `contextOpens[0].totalMs` | 59.67 ms |
| `.timingMs.datasetVerifyMs` | 11.63 ms |
| `.timingMs.storeHydrateValidateMs` | 1.32 ms |
| `.timingMs.storeMigrateValidateMs` | 1.25 ms |
| `.timingMs.retentionMs` | 0.51 ms |
| `.timingMs.sidecarsMs` | 4.07 ms |
| `.timingMs.fingerprintsMs` | 0.10 ms |
| `.timingMs.rulePrepMs` | 0.90 ms |
| `.memory.after.rss` | 314,216,448 bytes |
| `.memory.after.heapUsed` | 171,089,992 bytes |
| `.memory.delta.rss` / `.heapUsed` | 3,125,248 / 2,768,960 bytes |
| `load.commands`, `set-note`, status 200 | 4 samples; p50 52.27 ms, p95 105.89 ms |
| A measured sample's `server.eventLoop.utilization` | 0.04378 |
| Same sample's `activeMs` / `idleMs` | 87.80 / 1,917.43 ms |
| Same sample's delay p50 / p95 / p99 / max | 15.49 / 16.74 / 20.94 / 25.23 ms |
| `admissionTransitions` | 3 queued, 3 started, 3 completed, 3 released; each has correlation ID, reason, wait/service duration and queue counts |

There were no deadline/refusal samples in this short run. Synthetic tests cover
refusal reasons; absence of an event is not a zero-latency observation.

The smoke source-tree digest was
`94332cb7204444965654c9c3d4402999859b9dde990be3758d917838b2a9385e`.
After this single smoke run, stream counter attribution was corrected for
connections spanning stages and permanent identity metadata was added to the
large profiles' synthetic tasks. Both are covered by targeted tests. The latter
does not apply to the existing smoke profile. Smoke was not repeated; the
sampled field definitions are unchanged.

## Calibration limits

The large profiles were not executed. Their task/alias/seed-byte targets use
only the permitted aggregate evidence; synthetic historical label lengths
approximate storage volume. Custom and referenced dynamic rows can increase the
final task count, and durable History/observations increase final state bytes.
Production dependency depth/cross-link distribution, geography, roster and
retention distributions remain uncalibrated. Depth 4, two cross-links and 4,096
chunks are explicit synthetic assumptions.

Per-open RSS/heap values describe the shared server process. Concurrent work
and GC affect their deltas, so they do not isolate group allocation. Calculator
heaps remain separately sampled. Linux process-tree CPU/RSS gates are unavailable
on Windows; the smoke result remains incomplete capacity evidence, with browser
rendering, overload/recovery, backup overlap and soak acceptance unmeasured.
