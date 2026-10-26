# Possible Tasks: hand off the evaluated baseline

START: `33932ab3453dec9d6268504b83be80fd76438b13`.

The foreground and explicit Group peer evaluations now export a compact,
compressed planning baseline beside their ordinary task response. An explicitly
opened planning view sends those bytes to a lazy, independent worker. That
worker decodes the baseline, builds the existing location index, and projects the
requested chunk. It never compiles a calculator or evaluates tasks. The saved-list
lane receives no planning request, index work, or callback that waits for planning.

The handoff contains the already evaluated task display/status fields, the exact
record/source fields read by `buildChunkPlanningIndex`, its declaration fields,
and the evaluated access result. It does not narrow task evaluation or infer
statuses from a chunk. Hidden display fields, clue tiers, descriptions, skill
requirements, source selectors, source gates, area aliases, row order and access
are retained. The old advisory-calculator path remains the fallback when no
matching bounded baseline exists.

## Measured result

All 28 observations completed without failures: seven alternating pairs per
Group view, 224 browser click observations, 224 paired full HTTP response hashes
and 224 repeated-response hashes. All hashes matched; the 32 independent public
area comparisons also matched START. Every uncached candidate browser request
used the planning lane with zero engine evaluation. Volatile cache telemetry is
excluded from response comparisons.

First unlocked click, seconds, median [minimum, maximum]:

| Group | Member | START | Handoff |
|---|---|---:|---:|
| off | explorer-1 | 22.77 [20.82, 27.15] | 1.97 [1.71, 2.14] |
| off | explorer-2 | 9.48 [8.97, 13.31] | 1.68 [1.44, 3.06] |
| on | explorer-1 | 21.37 [19.09, 23.49] | 2.01 [1.74, 2.52] |
| on | explorer-2 | 9.54 [7.63, 10.19] | 1.64 [1.42, 1.79] |

Second unlocked clicks have medians of 38–40 ms after the change (38–47 ms
before). First locked clicks, after that member's index is built, have medians
of 115–179 ms after (60–81 ms before); repeats remain 39–42 ms after. Transferring
the baseline for an uncached chunk adds roughly 90–110 ms of request/IPC work.

The selected member's first request now queues for 119–129 ms median rather than
9.4–10.3 s. Worker work falls from 10.9–11.8 s to 1.74–1.75 s: index construction
is 0.62–0.71 s and decoding accounts for most of the remaining second. Engine
evaluation falls from 8.0–8.8 s to zero. Rendering remains 0.8 ms median with
three DOM mutation batches before and after. JSON serialization stays below
0.3 ms median. The displayed response is identical; only telemetry changes its
wire body by about 160 bytes.

Server-tree sampled peak RSS, GiB, median [minimum, maximum]:

| Group | START | Handoff |
|---|---:|---:|
| off | 6.94 [6.82, 7.16] | 6.31 [6.14, 6.58] |
| on | 8.54 [8.44, 8.79] | 8.02 [7.86, 8.34] |

The maximum across both views falls from 8.787 GiB to 8.340 GiB. The helper's
sampled peak is 664.37 MiB; per-view medians are 634.90 and 638.99 MiB. Both
compressed baselines retain 28.11 MiB total under the 32 MiB bound. Main-process
peak RSS rises: medians are about 2,662–2,682 MiB after versus 2,086–2,094 MiB
before. The total process-tree peak is lower despite that transfer/allocator cost.

Baseline encoding costs 1.96 s median per evaluated baseline with Group off and
2.12 s with Group on. Across observations the mean-per-baseline spreads are
1.68–2.34 s and 1.91–2.88 s respectively. This work is part of normal foreground
result transport, before its response completes, and must be included when
assessing total foreground latency.

Keeping one decoded member index trades memory for switching cost: later HTTP
probes interleaving uncached locations across members re-decode/re-index, costing
1.72–2.36 s median after versus 5–6 ms when START retains both member indexes.
Cached browser and HTTP results avoid that work. No always-resident calculator
is added, and save calculations never join the planning queue.

The complete first/second unlocked/locked tables, phase breakdown, paired
difference spreads, wire sizes and memory/encoding results are in
[planning-handoff-summary.md](planning-handoff-summary.md). Individual numeric
observations and full-response hashes are in
[planning-handoff-results.json](planning-handoff-results.json).

## Why candidate 1

The initial observer established that cold calculator startup and repeated engine
evaluation dominate. A compact handoff removes both. The lightweight worker uses
the existing scheduler lane implementation for queue admission, cancellation,
watchdogs, stale revision rejection, retirement, idle shutdown and close. It uses
a separate process when `RS3_TASK_WORKER_MODE=process`, exactly like calculators.
It is created only by a planning request and sleeps after the ordinary idle
interval; no calculator is made permanently resident.

Candidate 2 would still compile a second engine and repeat the baseline. The
START observations already show background full-list/Preview warm-up competing
for the two CPUs. Moving another whole evaluation earlier would spend CPU/RSS
and rely on an idle window. Candidate 1 does not need that scheduling assumption.

Candidate 3 would require a new proof for off-chunk fixed-point prerequisites,
source gates, equipment and collection obligations. This change carries their
existing evaluated statuses unchanged, so that extra semantic risk is unnecessary.

## Bounds and lifecycle

The scheduler retains at most two compressed baselines and 32 MiB total. A
baseline larger than 32 MiB compressed or 128 MiB serialized is not admitted.
Decompression enforces the same 128 MiB output bound. The helper retains one
member/input graph and index, dropping the previous entry before decoding its
replacement; HTTP response caches retain their existing byte/count quotas.
The foreground worker memoizes compressed bytes with its existing two evaluated
graphs. These transport bytes do not enter ordinary play/full response caches.

Baselines use the conservative task-input/rule/member fingerprint. Display-only
revisions can reuse them; changed task inputs cannot. Missing or oversized
baselines fall back to the existing independent advisory lane. Foreground idle
shutdown clears the handoff cache. The helper participates in server residency,
recovery, retirement and idle reclamation checks. Worker retirement finishes
before the generic lane allocates a replacement.

`tests/scheduler.test.mjs` is unchanged. Its protections all pass. Additional
handoff tests hold planning blocked while a new saved-list calculation dispatches,
cancel stale/disconnected planning, verify bounded admission, and exercise sleep,
wake and cache release without consuming restart budget. Production process-worker
HTTP tests compare both members, Group projection on/off, unlocked/locked chunks,
`Puro-Puro`, `Dorgesh-Kaan`, numeric aliases, hidden rows and source gates. A
separate script also compares those HTTP responses directly with START.

## Measurement method

The original measurement tooling and results remain in this change. The new
batch uses the same scale-400, seed-1 public synthetic companion: 468,754,156
input bytes, 110,398 definition tasks, 113,198 installed tasks, 18,602 chunks,
two members with 200 unlocked chunks each (300 unique). Production `startServer`,
process workers, 3 GiB V8 old-space, native Chromium, two-CPU affinity (0,1),
Node 24.20.0. The required suites run on separate cores (2,3,4).

Each pair starts fresh servers and browsers from START and the candidate, with
before/after order alternating by pair. Seven pairs run for each Group view.
Each member first loads its ordinary foreground task list. The observer measures
Tasks-tab click to `.task-filter-bar` plus two mutation-free animation frames,
then repeats the chunk and visits a locked chunk twice. Member 2 is selected
through the normal UI. The first locked chunk shares the index built by the
first unlocked chunk; it is a new chunk request, not a cold helper baseline.
Production background warm-up stays enabled.

HTTP checks cover both members and four surface chunks, twice per chunk in every
observation. Only volatile `cache` timing/hit metadata is excluded from response
hashes. The public interior fixture supplies the area coverage missing from the
large synthetic companion. Server-tree and helper-host RSS are sampled every
50 ms, excluding Chrome; brief unsampled peaks remain possible. RSS includes the
host process, worker isolate, relay buffers and allocator pages.

## Risks

Encoding the compact handoff adds work to normal foreground/peer task responses;
its measured duration is reported with the latency and memory results. The
helper is independent of saves, but it still uses CPU and memory while building
the index. Bounds deliberately retain the old slow fallback for oversized or
evicted baselines and after foreground idle shutdown. The synthetic save has no
real player progress; the separate area fixture establishes those association
cases, but a scrubbed real-save runner check remains useful before release.

## Changed files and validation

- `app/tasks/worker.mjs`: export and memoize the compact evaluated baseline.
- `app/tasks/planning-baseline.mjs`: bounded transport, exact declaration/index
  inputs and ordinary chunk projection.
- `app/tasks/planning-worker.mjs`: one independent decoded baseline/index.
- `app/tasks/scheduler.mjs`: two-entry/32 MiB handoff cache and an isolated lazy
  lane using the existing cancellation, retirement and idle machinery.
- `app/tasks/process-worker.mjs`, `app/tasks/process-worker-host.mjs`: choose the
  lightweight entry while retaining the process adapter's shutdown contract.
- `app/play-task.mjs`, `app/play-view.mjs`: move the unchanged pure task
  projection out of the dataset identity module's import chain.
- `app/server.mjs`: include planning in both idle-residency checks.
- `tests/planning-baseline.test.mjs`, `tests/planning-handoff.test.mjs`,
  `tests/helpers/planning-areas.mjs`: projection, HTTP parity, save isolation,
  cancellation, cache bounds and idle lifecycle regressions.
- `scripts/test-selection.mjs`: classify both new test files.
- `scripts/perf/possible-tasks.mjs`, `scripts/perf/possible-tasks-summary.mjs`:
  both-member browser cases, per-helper RSS, encoding cost and handoff checks.
- `scripts/perf/planning-area-parity.mjs`: full HTTP comparison against START.
- `scripts/perf/README.md` and these reports: commands, evidence and limits.

Node 24.20.0 validation after the app changes:

| Command | Files | Tests | Pass | Fail | Skipped | Duration |
|---|---:|---:|---:|---:|---:|---:|
| `npm run test:quick` | 271 | 2,376 | 2,311 | 0 | 65 | 86.86 s |
| `npm test` | 613 | 5,479 | 5,342 | 0 | 137 | 415.03 s |

The focused handoff, existing scheduler and existing idle-worker run passed
59/59. Existing full worker timing/planning tests also passed. The direct START
public-area comparison passed 32 full HTTP response comparisons; its digests are
in `planning-area-parity-results.json`. Full suites used Node 24.20.0, unlike the
older investigation's Node 24.19.0 timing batch. This batch uses 24.20.0 for both
START and candidate measurements.
