# Idle calculator memory — October 13, 2026

Windows process isolation reduces RSS immediately after calculator retirement
from **3,381 MiB to 614 MiB (82%)**. After ten more idle minutes it is
**973 MiB before and 616 MiB after (37%)**. The first unchanged compact task
list takes **7,346 ms before and 88 ms after**. Both complete full lists take
**12,782 ms before and 1,114 ms after**, requested after that compact list.

These are single paired localhost API observations on Node 24.20.0 and Player 1's
shared Windows desktop. They include response download and JSON parsing, exclude
browser paint and internet latency, and do not establish medians. OS caches were
not flushed. Warm samples include whichever selected-chunk preparation was
running at that instant.

## Method and provenance

The baseline is `a7c5810a346eb778dc1814aa1850125ebc04e74d`, with its application
materialized under ignored `.local/idlemem/baseline/`. Both versions use the same
frozen duo: 119 files / 37,718,144 bytes, copied from the main checkout into this
worktree's `.local/duo`, excluding `store.lock` and `access-token`. Each run makes
another scratch copy, creates its own credential and deletes its scratch store.
The frozen state SHA-256 is
`a1f281dc442d2ef91ad2895b08e6235ce3bfea1bf05f1cc4dd0c823c72ab0c3e`.

`scripts/perf/idlemem.mjs` verifies ownership of `.local/with-heavy.ps1`'s lock.
Each version starts one picker on `127.0.0.1:9151`, keeps startup warm-up enabled,
waits for prepared task/Preview baselines and empty queues, reads both full lists,
then reads the same selected/pending Preview. Retirement is accelerated with
`idleMs: 60000`, matching the earlier warmstart experiment. Production remains
600000 ms. The next sample waits for every calculator to be nonresident and every
termination promise to finish, then another three seconds. The next observation
has **600000 actual milliseconds without application requests**. Low-cost IPC RSS
probes run every 500 ms. Full per-isolate probes run only at the milestones.

No diagnostic GC precedes the observational ten-minute sample or wake timings.
The final version performs its normal idle collection; the baseline has no idle
collector. Both measurement mains have `--expose-gc`. After wake measurements and
another retirement, an optional inspector collection diagnoses remaining garbage.
Inspector is used only in disposable copies. No heap snapshot, OS working-set
trimming or live-process inspection is used.

Raw numeric reports are ignored `.local/idlemem/before.json` and `after.json`.
`after-thread.json` preserves the intermediate cache/GC-only experiment. Final
application fingerprint is
`3f2f593bd50f56714b8b945defef220a7208480323f240c1e3dd30c54f239121`
over 351 app files. Reports retain no tokens, invite links or task/save text.

## RSS before and after

All values are MiB. Before, RSS includes the main and both worker threads in one
process. After, total RSS sums the main and both child hosts; each host's RSS
already includes its calculator thread. RSS cannot be assigned separately to a
thread and no process is added twice. Summed process RSS can count shared OS
pages more than once; it is not a measurement of unique physical RAM. The idle
comparison has only the main process in both versions.

| Milestone | Before total RSS | After total RSS | After main RSS | Resident calculators before / after |
| --- | ---: | ---: | ---: | ---: |
| Start, before app import | 57.8 | 58.2 | 58.2 | 0 / 0 |
| Warm | 2,401.4 | 2,891.4 | 950.8 | 2 / 2 |
| First full lists and Preview | 3,048.9 | 3,078.1 | 1,055.5 | 2 / 2 |
| Every calculator retired + 3 s | 3,381.3 | 614.4 | 614.4 | 0 / 0 |
| Ten more idle minutes | 972.5 | 615.8 | 615.8 | 0 / 0 |
| Sampled peak | 4,204.9 | 4,351.9 | — | — |

## Per-isolate memory

Main metrics are MiB. `external` and `arrayBuffers` overlap and shared-buffer
ownership can be reported by a different allocating isolate. These counters are
not an additive RSS breakdown.

| Version / milestone | Heap used | Heap total | External | Array buffers |
| --- | ---: | ---: | ---: | ---: |
| Before / start | 5.2 | 7.3 | 2.1 | 0.1 |
| After / start | 5.2 | 6.8 | 2.1 | 0.1 |
| Before / warm | 537.9 | 672.0 | 25.5 | 38.9 |
| After / warm | 536.4 | 658.4 | 64.1 | 191.7 |
| Before / first lists and Preview | 604.5 | 694.4 | 158.9 | 172.3 |
| After / first lists and Preview | 665.6 | 796.9 | 68.6 | 213.3 |
| Before / retirement + 3 s | 592.7 | 600.8 | 46.2 | 59.7 |
| After / retirement + 3 s | 461.9 | 482.5 | 34.4 | 41.5 |
| Before / ten more idle minutes | 592.7 | 600.8 | 44.2 | 57.7 |
| After / ten more idle minutes | 462.6 | 481.7 | 34.4 | 41.6 |

The complete worker/host measurements below also use MiB. Before worker RSS is
included in the shared server total above; after host RSS includes its thread.
Retired rows are absent because those threads/processes have exited.

| Version / milestone / isolate | Process RSS | Heap used | Heap total | External | Array buffers |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before / warm / worker 1 | shared | 532.6 | 557.9 | 9.5 | 120.6 |
| Before / warm / worker 2 | shared | 777.3 | 905.6 | 43.7 | 8.8 |
| Before / first use / worker 1 | shared | 532.5 | 557.9 | 9.5 | 120.6 |
| Before / first use / worker 2 | shared | 1,167.3 | 1,291.1 | 45.9 | 26.5 |
| After / warm / host 107704 | 670.2 | 3.8 | 5.8 | 2.0 | 8.6 |
| After / warm / its worker 1 | included | 532.1 | 557.4 | 9.5 | 0.1 |
| After / warm / host 14540 | 1,270.4 | 5.3 | 167.3 | 34.3 | 47.1 |
| After / warm / its worker 1 | included | 779.5 | 907.4 | 43.7 | 8.8 |
| After / first use / host 107704 | 670.2 | 3.8 | 5.8 | 2.0 | 8.6 |
| After / first use / its worker 1 | included | 532.2 | 557.4 | 9.5 | 0.1 |
| After / first use / host 14540 | 1,352.4 | 60.6 | 121.7 | 50.3 | 40.0 |
| After / first use / its worker 1 | included | 971.4 | 1,065.9 | 16.0 | 17.8 |

## What retained memory

The large immediate RSS remainder belongs to the hosting process after retired
worker allocations, rather than a worker that stayed alive. Before retirement,
worker heaps use 1,310 MiB at warm and 1,700 MiB after first use. Both native
workers then exit, with empty scheduler caches and zero retiring threads, yet
RSS remains 3,381 MiB. It falls by 2,409 MiB over the next ten minutes without a
matching heap reduction.

The later baseline inspector collection frees 353 MiB RSS, 88 MiB heap used and
102 MiB array buffers, but leaves 2,984 MiB RSS with only 462 MiB live heap. Moving
the same evaluators into owned processes leaves about 991 MiB main RSS immediately
before idle GC. That is roughly 2,390 MiB less than the thread baseline. Process
exit reclaiming the calculator allocations supports allocator/page retention as
the dominant immediate remainder; this does not identify an individual native
allocator or claim a continuing leak.

The normal final idle collection takes 307 ms wall time. Main heap used falls
from 593 to 462 MiB, array buffers from 298 to 41 MiB, and RSS from 991 to 613 MiB.
Async GC schedules work after the current stack; collection still pauses the
main isolate and could overlap a new request. The final diagnostic collection
after cached wake reads frees only another 17 MiB RSS.

Other retained owners are much smaller:

- The baseline foreground response cache has 120.5 MiB at warm and zero after
  retirement. Its former eight-entry limit had no practical byte bound. It is
  now capped at 128 MiB, still fitting this duo's two full results.
- Prediction and unlock-reuse quotas remain 16 MiB each. Both are empty after
  retirement. All saved-input shared snapshots and rebuildable HTTP encodings
  are released before idle collection.
- Raw definition/task-map HTTP representations total 14.4 MiB after sleep. One
  shared definition input remains available for a future calculator. Parsed
  definitions/world indexes, identity catalogues and static module datasets
  remain in the main heap. The final main imports alone use 169 MiB heap before
  store/world construction; the complete post-collection live heap is 462 MiB.
  These are aggregate measurements, not individual object dominator sizes.
- Current saved results use 8.6 MiB compact and 9.9 MiB compressed full bytes.
  They replace rebuilding the unchanged lists after sleep, within the existing
  32 MiB compact / 16 MiB compressed-full limits. Full JSON is about 56 MiB per
  player and is not retained as another parsed graph for these reads.
- The frozen source has 76 History entries / 141,086 bytes of History JSON.
  Retained backup files are on disk, not hydrated by this workflow. Gameplay and
  compiled task-input fingerprints retain small hashes rather than accumulating
  saved results.
- Automatic-travel baseline caches could retain a main-thread evaluator and
  complete result graphs. Idle cleanup now releases those caches too, but
  `travel.automatic` is off in this save, so that fix contributes none of this
  measured reduction.

## Implementation and trade-offs

On Windows each native lane uses a `ProcessWorker` host containing one unchanged
`worker.mjs` thread. Advanced IPC preserves maps, sets and buffers. An out-of-band
transport rebuilds shared buffers and aliases across process boundaries without
interpreting saved user keys. The host updates its local cancellation word while
the calculator is synchronous. Idle retirement and recovery await actual process
exit; disconnect cleanup and force-kill deadlines prevent abandoned hosts.
`RS3_TASK_WORKER_MODE=thread` selects the previous mode for diagnostics;
`process` opts into isolation on other platforms. Non-Windows defaults remain
threads and were not measured here.

`app/idle-memory.mjs` releases remaining rebuildable caches and requests one
async major collection only after every lane has finished retiring and another
quiet second has passed. Wake/shutdown cancel pending collection. `npm start`
and `Start-Picker.ps1` enable `--expose-gc`; direct launches without the flag
still use process retirement and cache release, but skip explicit collection.
No maximum-old-space limit or other V8 tuning is imposed.

Sleeping writer reads use the same current saved-result bytes as viewers.
Gameplay changes invalidate them through the existing fingerprint/revision path.
Display-only changes keep compact results current; full writer reads rebuild if
the compressed body's revision is old. Viewers retain their existing header
revision handling and never submit work or receive write controls.

The first cached compact list is 84 times faster in this pair. Both full lists
still have 20,640 / 20,592 tasks and take 1.11 s after idle, without waking any
calculator. Startup/store-ready time is 9.69 s before and 12.45 s after; first
prepared full-list batches are 1.77 / 2.25 s, and first Preview is 4.77 / 5.27 s.
The sampled peak rises 3.5% (147 MiB), and warm RSS rises 490 MiB. Process startup
and IPC copies cost memory/time while calculators are awake. Changed inputs and
uncached Preview still rebuild the calculator; no compiled disk cache was added.
Startup warm-up, idle intervals and foreground scheduling remain unchanged.

## Verification and cleanup

Focused tests cover transport aliases/containers, synchronous cancellation,
serialized snapshot resend, graceful and forced exit, parent-disappearance
cleanup, all-lane retirement, wake/shutdown cancellation, compressed cached reads,
gameplay/display revision changes, startup warm-up and viewer permissions. The
final quick suite passes 956 tests. The one locked final `npm test` passes
**3,568 tests, with one existing skip and zero failures**, across 349 files,
in 287.54 seconds. No full suite was run earlier or repeated.

Desktop 1440×900 and phone 390×844 screenshots are
`.local/screens/idlemem-desktop-1440.png` and `idlemem-phone-390.png`. Both were
captured in one locked disposable browser session on the cache/GC candidate;
the later process-isolation change has no UI changes. Screenshots show the copied
save and do not establish internet or deployed-device readiness.

The live picker, main checkout, training/data catalogues, changelog and roadmap
are unchanged. Owned measurement servers, calculator hosts and browser processes
are stopped. The 119-file private frozen save and every scratch store/profile
are removed; numeric reports,
source materialization and screenshots remain ignored in this worktree.
