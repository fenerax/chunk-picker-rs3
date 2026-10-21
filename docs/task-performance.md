# Task and chunk interaction performance

Measured on this Windows desktop with Node 24.19 and headless Chrome, using
`scripts/benchmark-task-performance.mjs`. Every run copies the same real-sized
save and its static sidecars into an automatically removed temporary directory,
serves a disposable source copy on a loopback ephemeral port, and logs timings
only. A distinct selected candidate is assigned in the disposable copy when
needed. The live saves and ports 8788/8790 are never accessed by the servers.

The baseline is commit `5dbd24c`; the comparison uses this branch. Measurements
include other work running on the desktop and describe these observations,
not guaranteed latency on other machines. Cold means a first prediction for
that chunk; the first request also includes baseline evaluation. Warm means
the immediately repeated request. The background-cache measurement waits for
the idle prewarm queue, then makes its first HTTP requests.

## Historical measurements

All numbers below are milliseconds unless stated otherwise. The desktop was at
100% CPU during the final paired runs. An earlier, lower-load baseline measured
first predictions at 6,663 / 3,315 / 3,545 ms for the pool, candidate and arbitrary
chunks respectively. The paired observations below should not be interpreted
as an isolated estimate of each code change's speedup.

| Prediction | Baseline first / repeat server time | After first / repeat server time | After first / repeat HTTP time |
| --- | ---: | ---: | ---: |
| Roll-pool chunk | 15,960 / 1.72 | 1.11 / 0.31 | 16 / 71 |
| Selected candidate | 5,777 / 0.23 | 1.72 / 0.33 | 51 / 61 |
| Arbitrary chunk | 8,606 / 0.12 | 3,757 / 0.69 | 3,803 / 27 |

The after run completed 37 background predictions before these requests. Both
first likely-chunk requests were cache hits, meeting the 150 ms server target.
The arbitrary first request was cold. Its 3.76 seconds misses the approximately
1.5 second cold target. In a separate run with prewarming disabled, cold requests
were 16.00 / 3.43 / 3.17 seconds: the first request includes worker initialization
and baseline preparation. Clicking before idle warming finishes can still incur
that startup cost. Immediately repeated requests were 0.30–0.46 ms.

| Loaded-result Possible Tasks | Baseline | After |
| --- | ---: | ---: |
| First open, click to rendered | 16 | 31 |
| Reopen, click to rendered | 78 | 20 |

Both runs already had a loaded-result fast path. The change removes repeat
indexing when result wrappers change and primes one index on result acceptance.
The measured section opens meet the 100 ms target.

| Shift-click measurement | Unlock baseline → after | Lock baseline → after |
| --- | ---: | ---: |
| Click to map update | 781 → 41 | 257 → 27 |
| Server command | 662 → 535 | 136 → 103 |
| Durable save, within server command | 335 → 238 | 61 → 45 |
| Browser observes command response | 786 → 4,751 | 260 → 222 |
| Worker task recomputation | 9,150 → 8,243 | 7,999 → 5,335 |
| Click to updated task list | 21,780 → 22,132 | 19,552 → 14,890 |

The save measurement includes history backup, compact serialization and atomic
write. It is part of command time, not an additional cost. Commands do not await
task recomputation; the optimistic map update precedes even the save. Transfer,
parsing, indexing and rendering under load still contribute substantial latency:
unlock's response observation and task-list measurements did not improve in this
pair. Response observation includes browser scheduling after response headers;
the task-list measurement waits for the authoritative result to render.
The earlier baseline task-list measurements were 8.20 / 9.24 seconds, illustrating
the load variability. All browser runs reported zero page errors. An intermediate
implementation eagerly prepared prediction baselines during task requests; that
regression was removed and has a retained-state regression test.

## Changes and limits at the measured checkpoint

- A separate prediction worker interleaves players within each tier: pending roll
  choices first, then selected candidates, then roll-pool chunks after startup and
  every revision. A 250 ms debounce keeps snapshot copying and pool calculation
  out of the durable save callback.
  Interactive predictions precede queued idle work; foreground task calculations
  keep their own worker. An active synchronous candidate finishes before the
  next job can begin. New revisions discard its obsolete response and stop the
  remaining work.
- Prediction keys contain revision, player, chunk, gameplay fingerprint, and
  effective group/personal/legacy rules. Work coalesces by key. The idle queue
  is capped at 256 entries, interactive queue at eight, and prediction LRU at
  256 entries/32 MiB. Oversized results are returned without caching. Pools
  beyond the queue/memory limits can require a cold prediction.
- The worker reuses one validated, frozen baseline and access compilation.
  Rate parsing, cutoff decisions, source duplicate lookup, and repeated task
  requirements are cached. Every hypothetical unlock still evaluates the full
  fixed point, preserving task dependencies, provenance, diagnostics and order.
  Baseline preparation is lazy, so ordinary task requests do not prepare full
  prediction snapshots. First preparation remains a startup cost; idle warming
  must finish before a likely chunk is an instant cache hit.
- Possible Tasks uses the current loaded result without another request and
  indexes locations once per task-array/definitions/world identity. Acceptance
  primes that index; display preference saves reuse it.
- Shift-click immediately projects pending chunk edits onto the map and counts.
  Authoritative state, revisions, undo and task calculations use acknowledged
  saves. Each rejected/conflicted preview is removed with a visible message;
  later queued previews survive. Durable backup and atomic write behavior from
  savefix is retained, with task recalculation in the worker afterwards.
- Engine Details shows request and evaluation stage timings. Prediction dialogs
  reject responses overtaken by a save, player switch or dialog change.

## Web changes

No changes to `style.css`, `index.html`, or `map.mjs`.

- `app/web/main.mjs`: `command`, `removeChunkPreview`, `toggleChunk`,
  `renderMapState`/`renderState`, and `start` handle optimistic shift-clicks;
  `acceptTaskResult` primes the location index; `predict` rejects stale answers;
  `engineDetails` adds the timing paragraph. `ensureResult` retains its existing
  current-result fast path, now explicitly covered by tests.
- `app/web/chunk-planning.mjs`: `createChunkPlanning`/`indexFor` caches by stable
  task-array identity and exposes `prime`; `derivedSection` uses the same index.
- `app/web/command-state.mjs`: immutable `projectChunkState` previews queued edits
  without touching saved state or compact-response merging.

## Verification

Six whole-output fixture fingerprints were captured from `5dbd24c`, excluding
only elapsed time. The optimized engine and prepared predictions match them.
Direct old/new worker comparison also matched the full baseline and two chunk
predictions on the isolated real save, including ordering and diagnostics.
Tests cover rule/member/revision cache keys, invalidation, byte and queue limits,
LRU eviction, cancellation, followers, watchdog recovery, shared snapshots,
automatic server warming, location-index reuse, optimistic revert/conflict and
rapid queued toggles, remote revisions, member changes, and stale prediction UI.

Final full `npm test`: 1,208 passed, zero failed/skipped/cancelled, in 124.99 seconds.
`git diff --check` and benchmark-script syntax validation also passed.

Run the reusable benchmark with explicit inputs:

```powershell
node scripts/benchmark-task-performance.mjs --revision 5dbd24c --no-prewarm --save-dir <save-directory> --playwright <playwright/index.mjs> --output <timings.json>
node scripts/benchmark-task-performance.mjs --no-prewarm --save-dir <same-save-directory> --playwright <playwright/index.mjs> --output <timings.json>
node scripts/benchmark-task-performance.mjs --wait-prewarm --save-dir <same-save-directory> --playwright <playwright/index.mjs> --output <timings.json>
```

`--revision` extracts the requested committed app into the disposable directory;
omitting it measures working-tree source. Chrome is launched with an independent
headless profile. Benchmark instrumentation never enters production source.

## Worker lifecycle and exact unlock reuse — October 10, 2026

The measurements and test counts above remain the earlier checkpoint's evidence.
The following describes the current implementation and measurement method; it
does not assign new timings or establish that the latency targets have passed.

Foreground, lazy group-peer, death-estimate and prediction workers now sleep
after their configured interval without interactive use. `RS3_WORKER_IDLE_MS`
defaults to 600000 ms. Requests, cache hits and interactive completion refresh
the lane's idle clock; background warming does not. Unrequested warming and
rebuildable worker/server/store calculation caches are released on sleep. Active
request waiters keep their worker alive. A later request enters the bounded queue
and waits for the old worker's termination before one replacement compiles,
without spending the crash-restart budget. Durable state, history, backups and
stable task identities remain available, and saves never await calculation.

Predictions publish compact personal, group-peer and group-sidebar projections
for both players in the same fully settled hypothetical post-unlock state. The
unlocking player's result is published first; its partner finishes before the
next candidate starts. Exact signatures cover the full saved
task input except revision, history, provenance and the selected/pendingRoll/
blacklisted roll bookkeeping. Personal progress, both maps, rules, overrides,
saved task facts, catalogues, identity resolution and legacy gameplay remain.
After a durable unlock, matching completed bytes can supply the authoritative
compact task response. The default 32 MiB prediction quota now allocates 16 MiB
to prediction responses and 16 MiB to gzip-compressed reusable projections.
Compression runs in the existing prediction worker. It leaves each retained
JSON prefix at a flushed gzip block boundary. The server completes one gzip
member with a small current-revision suffix and CRC/length trailer without
inflating or recompressing the task list. Concatenating complete gzip members is
not safe for Chrome's HTTP decoder. Other accepted encodings retain the ordinary path.
Projection getters inflate only the requested bytes, and compressed reuse does
not create another raw foreground-cache copy. Diagnostics report compressed and
raw byte totals; pairs share an origin and are admitted or evicted together.

An actual saved revision retires cold advisory workers and obsolete active
side-detail, chunk-planning and death calculations. Retirement preserves reusable
projections, ignores late worker messages, and waits for termination before a
later request starts a replacement. Ready predictions retain their exact saved
result race. New advisory work remains gated by the required saved task lists.
Ordinary selected task calculation remains synchronous and is not preempted.

Explicit Preview and quiet preparation from an open locked chunk or a fresh
pending roll refresh retained choices, replacing older explicit choices
within that quota while bulk warming preserves earlier likely choices. Queued
warming pauses during Preview and its one-second completion quiet window, so
the next bulk candidate cannot start between Preview and an immediate Unlock.
If a cached Preview delta outlives its prepared pair, Preview prepares the missing
task bytes again; a delta alone cannot mark the full Group result prepared.
Preview waits for the pair; its preparation time remains outside the timed
Unlock. Silent intent requests wait for the current selected/Group paint and
abort when their panel, player or revision changes. Preview does not release the
gate waiting for the current saved task list. Bulk order still interleaves each
player's pending choices, selected chunks and then roll pools. Completing each
pair before moving on gives each finished candidate a complete Group result,
rather than leaving many candidates with only one prepared player.

If a candidate is already running when the save commits, obsolete Preview
waiters still reject. Either member's `followSavedPrediction` consumer can race
its complete result against ordinary saved calculation. The owner's published
bytes can win while its partner still finishes; the peer retains its separate
fallback lane. Only an exact current signature from the immediately
preceding revision can win. Mismatch, failure or a later save cannot authorize
old task bytes. The losing race waiter detaches without cancelling other
coalesced requests. Losing the last saved follower cancels an unconfirmed
producer at its next cooperative boundary. Once the owner's exact saved
signature is confirmed, its partner can finish and enter the cache even with no
remaining followers. A later save still cancels that producer. A selected member
never waits behind queued partner work.
Every fallback still computes a full fixed point. This adds no incremental
partial output or speculative save.

Group view displays current selected-member rows before its peer finishes,
retains an updating status, and guards row actions until the complete duo is ready.

Chunk planning and browser full-detail hydration share the existing prediction
lane, so they cannot queue ahead of saved foreground/peer tasks. A revision or
disconnect cancels queued obsolete work; prediction cancellation is checked
after the current baseline and between the owner and partner. Already running
synchronous fixed-point passes finish at their next cooperative boundary. Panel
intent starts before tab requests, but an already active side request can delay
its preparation until that pass finishes. Death, new planning/detail requests
and bulk warming wait for all required current players, including after the
15-second startup grace. Side requests reject after a bounded 30-second wait if
the list cannot settle. Leaving Group view with cached personal rows makes one
coalesced personal refresh so an abandoned peer cannot hold that gate. Saves
schedule task loading on the next turn, removing the former 100 ms refresh wait.
During an on-wire gameplay command, its matching saved-revision SSE starts
selected and Group-peer reads in parallel while the acknowledgement arrives.
One bounded provisional pair holds the parsed promises; the normal loaders
claim them only after the matching acknowledgement is adopted, avoiding
duplicate task reads and another state fetch. No future state, task rows or
client advisory readiness publish early. Changed players/views, failed writes
and newer revision notices discard the pair, including already fulfilled reads.
Exact signature lookup precedes serialized-state allocation on prepared hits;
immutable catalogue/legacy digests are warmed before server readiness. Fresh
compact responses prefer accepted gzip to avoid the slower Brotli critical path.

Ordinary selected-player evaluation remains synchronous through projection and
response serialization. Cancelling its waiters does not preempt an active pass,
so a later uncached save can still wait behind that selected-player calculation.
Queued obsolete work is removed immediately, and prepared exact hits bypass the
lane. Side-work isolation does not establish active-selected preemption.

Use the dependency-free Node 24 `npm run perf` harness for paired browser checks
with one frozen save copied inside the worktree's ignored `.local/` directory,
the same read-only map/game assets and one owned server/browser suite at a time.
Keep personal and complete-duo modes separate, and compare identical settlement
policies. Ordinary cold visits include new server/browser processes; reloads
retain HTTP/result caches. `--idle-sample-ms` adds separate normal/idle RSS and
lane-residency snapshots plus a task-settled wake reload, outside scenario medians.
A fixed wait with active background queues is not evidence of quiescent idle.
Short `RS3_WORKER_IDLE_MS` experiments must be labelled separately from the
production default. `--screenshots responsive` records desktop and 390-pixel
views after measurement. Source manifests and frozen-state SHA256 hashes pin the
measured inputs. See [the harness instructions](../scripts/perf/README.md) and
[browser performance results](performance.md) for retained reports and budgets.

The [October 12 scheduler comparison](performance.md#saved-unlock-preparation--october-12-2026)
pins `395ceb0` → `103f53f`, three repetitions for each player / Group mode /
Preview, immediate and three-second panel-dwell workflow. Prepared Unlock
median/p90 is 0.31–0.49 / 0.31–0.59 seconds; immediate and dwell samples have no
prepared hits and still exceed one second. All twelve median comparisons stay
within the 10% regression band. The 60-second warm sample retains five complete
pairs in 7,210,329 compressed bytes plus 49,788 Preview bytes, below the unchanged
32 MiB total allowance; it does not establish full-pool or quiescent idle memory.
Both members' prepared Personal/Group/sidebar results match complete fresh
calculations, including the 195 changed Player 2 rows after Player 1 unlocks 13617.
The full-suite pass is at `feb2f77`; later changes have 349 focused passing checks,
with no third full run under the task's two-run cap. Active ordinary selected
calculation remains the preemption limit described above.

## Exact calculation checks and final Unlock comparison — October 12, 2026

`scripts/perf/unlock-equivalence.mjs` writes and compares a private oracle under
`.local/perf`: SHA-256 of the canonical full result and the play, duo and
sidebar projections for both players' baselines, 24 single-chunk unlocks per
player (roll pools, selected chunks, neighbours, far and transport chunks,
13617), every partner result, and three length-3 chains per player — 138 cases.
Only `elapsedMs` and `timingMs` are normalised. The reference was generated
from the unchanged calculation; the merged `codex/speed` tree (scheduler work plus the
presentation/equipment/play-projection streamlining) compares 138/138 equal.
`scripts/perf/unlock-paired.mjs` runs fresh-worker ABBA pairs of two app
directories on the same parent world; against `dc98418` (16 cases × 3) the
median new/old calculation ratio is 0.964 (Player 1 selected), 0.974 (Player 2
selected), 1.006 and 0.994 (partners). `tests/calculation-equivalence.test.mjs`,
`projection-reuse` and `equipment-reuse` compare the reuse and no-reuse paths on
fixture worlds.

The engine run also built access/read reuse and a cheaper fixed point
(exact on the oracle), but its fresh-worker paired A/B left Player 2's partner
calculation 4.5–6.7% slower, so it was not merged. A replay of the saved
baseline's work for the hypothetical unlock was bounded at about 1.2–1.3× on
the task engine (most memo entries read something the unlock changes); a deeper
incremental design is estimated at several days. A fresh calculation still
costs about 2.2–2.5 s per player on this desktop.

Browser harness, same host, `395ceb0` → `b9041e0`, three runs per cell,
Unlock click → complete task list (both players with Group on), median / p90 s:

| Player | Group | Prepared (after Preview) | Unprepared (7463) |
| --- | --- | --- | --- |
| Player 1 | Off | 0.68 / 0.81 → 0.30 / 0.37 | 3.68 / 3.98 → 2.48 / 2.70 |
| Player 1 | On | 3.59 / 3.63 → 0.32 / 0.32 | 4.65 / 5.15 → 3.33 / 3.38 |
| Player 2 | Off | 0.71 / 0.74 → 0.42 / 0.44 | 3.24 / 3.41 → 2.32 / 2.38 |
| Player 2 | On | 3.29 / 3.50 → 0.29 / 0.31 | 4.52 / 4.62 → 3.64 / 3.68 |

After every worker slept (`RS3_WORKER_IDLE_MS=15000` experiment, Group on), a
reload settles in 9.83–10.06 s before and 9.91–10.39 s after: waking still
recompiles the workers. Ready RSS is unchanged (about 1,437 MiB); after-unlock
RSS is lower (Group on unprepared 3,868–4,081 → 2,890–3,131 MiB); idle RSS with all workers asleep
is 783–984 MiB before and after. Final-cell runs preceded the baseline runs by
about 20 minutes on Player 1's everyday desktop.

## Redesign merge continuity — October 12, 2026

Claim and display saves advance the HTTP revision while retaining the task
revision used by prediction keys. Prepared signatures exclude task claims,
progress snapshots and display preferences. The server uses `supersedeDisplay`
for unchanged task inputs and preserves the already scheduled prediction
quiet window. Completed and pending list requests settle at an equivalent
display revision; gameplay changes still invalidate obsolete results.

The browser keeps automatic preparation and explicit Preview across trusted
adjacent unchanged saves and guarded claim-only conflict responses. Unknown
revision gaps, gameplay edits and actor/member/panel changes still invalidate
the request. Preparation remains gated on foreground list settlement.

The final merge's 138-case exact check, test counts and eight-cell timing
comparison are recorded in [performance.md](performance.md#speed-merge-verification--october-12-2026).
