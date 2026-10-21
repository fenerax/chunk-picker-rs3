# Restart health and first-use preparation — October 13, 2026

Early listening reduced the first successful private health check from 10.6 to
1.7 seconds idle, and from 13.0 to 1.8 seconds under the quick-test load.
Immediate cold calculations still take about the same time. After a quiet start,
both full task lists arrive from the prepared cache.

The baseline server is `340a137c1c758a31ac680b5add4cdee1e7181eb2`, materialized
under ignored `.local` with numeric stage instrumentation. The implementation is
`a60ef3f`; `93c82a0` adds timing-harness lock verification. Both use this
worktree's unchanged engine and data, the same frozen duo copy, and Node 24.20.0
on Windows. The copy excludes `store.lock` and `access-token`; each cell creates
another scratch copy with a new credential. No original save is written.

Every timing run and the browser session used `.local/with-heavy.ps1`. Busy cells
ran `node scripts/test.mjs quick`, equivalent to `npm run test:quick`, throughout
startup, both first lists and first Preview. All those quick runs passed. Each
condition has one sample; OS file caches were not flushed. These localhost API
measurements exclude browser painting, phone performance and internet latency.

All following times are seconds from process spawn. The two full lists are
requested concurrently after store readiness; Preview follows both responses.
Health is probed throughout startup. Listening is observed independently of the
store-ready handoff.

| Condition | Version | Listening | Health 200 | Player 1 full list | Player 2 full list | First Preview |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Idle | Before | 10.42 | 10.60 | 15.10 | 18.06 | 30.00 |
| Idle | After | 1.10 | 1.68 | 14.92 | 17.99 | 30.62 |
| Busy | Before | 12.71 | 12.96 | 18.05 | 21.60 | 37.88 |
| Busy | After | 1.11 | 1.81 | 17.76 | 21.58 | 36.84 |

The first request durations explain why early health alone does not remove the
cold calculation wait. These durations include downloading the complete body;
the list-batch milestones above also include the harness's JSON parsing. Each
full list is about 56 MiB, with 20,640 Player 1 tasks and 20,592 Player 2 tasks.

| Condition | Version | Player 1 request | Player 2 request | Preview request |
| --- | --- | ---: | ---: | ---: |
| Idle | Before | 4.22 | 7.27 | 11.93 |
| Idle | After | 4.84 | 7.98 | 12.63 |
| Busy | Before | 4.88 | 8.48 | 16.27 |
| Busy | After | 5.59 | 9.59 | 15.26 |

Worker/reference readiness was the largest startup barrier: 4.19 seconds idle
and 5.53 busy in the baseline. Worker engine/catalogue compilation accounted for
2.50 and 3.51 seconds of that barrier. Spawn, imports, parsing and message
transfer occupy the remaining time; registry construction is included in
compilation and was not separately profiled. Main-thread catalogue/world setup
took 0.63/0.65 seconds, store loading/migration 2.26/2.62, auth setup 0.46/0.63,
saved-rule preparation 0.64/0.70 and initial state encoding about 0.07 seconds.
The first idle task calculations spent about 1.8–1.9 seconds each in the engine.
Cold Preview also starts the prediction worker and calculates its current and
hypothetical task graphs. Its stage timers overlap and must not be added together.

A second idle comparison delayed the first state/task requests for exactly
30 seconds after store readiness. Both after task lists were cache hits before
any task request. Both versions' first selected/pending Preview was already
cached by automatic prediction warming.

| First use after the same quiet pause | Before | After |
| --- | ---: | ---: |
| Player 1 full request | 4.47 s | 0.85 s |
| Player 2 full request | 7.55 s | 1.33 s |
| Both lists, including JSON parsing | 7.88 s | 1.82 s |
| First Preview request | 237.6 ms | 4.6 ms |
| Spawn to both lists | 48.46 s | 41.70 s |

The larger Preview difference in this cached comparison is one observation,
not a promised speedup for every chunk. Native integration tests also cover an
arbitrary Preview after baseline preparation, without a selected/pending choice.

RSS includes the entire server process and its worker threads. The warm sample
follows startup preparation and the first/repeated full reads; selected-chunk
warming may still be running. Sleep was accelerated to 60 seconds, compared
with the production ten-minute default. The sleep sample waits for every worker
to report no resident thread and zero retiring threads, then another three
seconds. No GC was forced.

| Condition | Version | Warm RSS (GiB) | After sleep (GiB) | Sampled peak (GiB) |
| --- | --- | ---: | ---: | ---: |
| Immediate idle | Before | 2.59 | 3.76 | 4.07 |
| Immediate idle | After | 2.73 | 3.78 | 4.06 |
| Immediate busy | Before | 2.59 | 3.75 | 4.06 |
| Immediate busy | After | 2.86 | 3.87 | 4.17 |
| Quiet idle | Before | 2.57 | 3.72 | 4.01 |
| Quiet idle | After | 3.48 | 3.78 | 4.07 |

The main heap used about 593 MiB after sleep in every cell. Workers and their
calculation caches retired, but process RSS stayed high in both versions. This
run does not establish why those pages remain resident or prove an idle-RSS
improvement. The quiet warm sample was higher after eager preparation; ongoing
candidate calculations make the warm samples different from fully settled
cache footprints. No extra death or group-peer worker is created by startup
preparation, and background completions do not extend idle timers.

The early dispatcher accepts only private master-bearer health reads. It returns
`warming`, `ready: false` and `savesReady: false`; other requests get 503 with
`Retry-After: 1` before their bodies are consumed. Nothing is queued. The normal
revision-checked command handler takes over after store, migrations, initial
import and auth sidecars succeed. Warmup uses existing bounded background queues
for both full lists, then both compact Preview baselines. Real requests can
follow matching work; queued background work yields to demand. A synchronous
calculation already running finishes before the next queued request.

Production compilation gets a five-minute startup allowance and is not reported
as stalled before that allowance expires. Calculation deadlines and recovery
limits remain unchanged. The CLI's static imports still precede listening. The
reported 90-second extreme startup was not reproduced by this moderate load.

No disk cache was added. The current engine baselines contain compiled and
transient structures; persisting them needs a separate serialization and
code/data-version contract. In-memory results continue using the existing
conservative input keys and disappear on process/data restart. UI, data imports,
watchdog scripts, changelog and roadmap files were left unchanged.

Sanitized raw results are `.local/warmstart/before.json`, `after.json`,
`before-quiet.json` and `after-quiet.json`. Desktop 1440 and phone 390 screenshots
are `.local/screens/warmstart-desktop-1440.png` and
`.local/screens/warmstart-phone-390.png`, captured in one locked server/browser
session. The reusable harness is `scripts/perf/warmstart.mjs`.

The final locked `npm test` ran once: **3,442 passed, 1 skipped, 0 failures**
across 334 files, in 260.8 seconds. The quick suite passed 881 tests during
development; later focused checks passed the added request-following and
compilation-allowance regressions. Full coverage includes early health, denied
writes before readiness, startup failure/cancellation, autonomous native
preparation, coalescing, stale results, cache bounds and idle retirement.
All owned servers/browsers stopped, scratch stores were removed and the frozen
save copy was deleted. Raw measurements, screenshots and the full-suite log
remain under ignored `.local`.
