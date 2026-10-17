# Members performance and map growth

This investigation adds a repeatable measurement harness. It does not change
picker behavior. The baseline is core commit `555b85b` on the release branch,
using Node 24 on Windows. The selected companion is supplied at runtime.
Personal saves, raw profiles, screenshots and detailed measurements belong in
ignored scratch storage. This report contains no player, map or service bindings.

## Findings

The repeated work is the main problem. A save can run a conservative task
baseline inside automatic travel on the HTTP process, then run ordinary task
evaluation independently for each member. Offering two choices invalidates
those task results even though ownership has not changed. Membership exposes
more source, recipe and obligation work; the number of owned chunks alone is
not a reliable predictor of evaluation time.

Two sequential interaction trials used the same copied members save with one
owned chunk per member at startup. Task tick, personal rule and two-choice roll
were measured at that size; unlock necessarily grew one map. Immediate unlock
was measured without waiting for optional prediction preparation. Times below
are wall time, including the command response and both Group list reads.
Different random roll choices explain some difference between trials. These
are observations, not percentiles or isolated CPU benchmarks.

| Interaction | Observed wall time | What matters |
| --- | ---: | --- |
| Server ready | 21.6–22.5 s | Imports, dataset/store initialization and initial worker readiness; optional preparation can continue |
| Initial map/state inputs | About 28–29 s from launch | Four initial reference/state reads complete together after pool work |
| Both initial Group lists | 40.4–42.6 s from launch | Cold peer request takes 12.8–13.3 s, though its evaluation is only 2.7 s |
| Group task tick and refresh | 6.65–6.79 s | Save response 3.71–3.74 s; both workers miss their result cache |
| Personal task rule and refresh | 5.96–7.01 s | Save response 3.51–3.72 s; both members reevaluate |
| Two choices and refresh | 6.63–6.87 s | Save response 3.78–3.83 s; unchanged ownership still causes both evaluations |
| Immediate unlock and refresh | 5.00–6.63 s | Changed access; exact prediction reuse is already supported but was not ready here |
| Area check, 50 cells | 17.05 s | Fresh one-chunk-per-member copy; 5.45 s worker calculation, plus cold admission/preparation |
| Rules review task preview | 7.45 s | Same fresh copy; 4.68 s worker calculation and 2.40 s main-process pool work |
| Cached Group inspection reads | 0.14–0.17 s | Saved inspection projections; no new engine evaluation |

Startup figures are milestones for usable data, not browser first-paint or
fully decoded map artwork. Browser search, Doable now, name sorting and phone
Tasks navigation were checked on the scratch server. Browser-control intervals
include automation overhead and do not establish paint latency. Raw browser
profiling permission was not granted; CPU profiles cover Node's HTTP process,
worker hosts and task isolates. Server RSS excludes the browser renderer.
Area check, preview and inspection were rerun on a separate fresh save copy
after the command trials, so their baseline still has one chunk per member.

Ranked costs:

1. **Synchronous automatic-travel/pool work.** Command acknowledgements spend
   several seconds before task reads start. In the primary tick's main-process
   profile, `evaluateRollPool` accounts for 3.36 s inclusive sampled time,
   `deriveAutomaticTransport` 3.23 s, and its `baselineFor` 2.73 s. These
   nested totals must not be added. Pool evaluation is about 85% of the main
   process's non-idle samples during that tick. See
   [pool calculation](../../app/storage/store.mjs#L408) and
   [conservative baseline](../../app/core/automatic-transport.mjs#L37).
2. **Repeated task closure and own-map obligation proofs.** On the tick,
   worker engine stages take about 1.4–2.4 s per member and dominate ordinary
   evaluation. A foreground task-isolate profile has 11.48 s inclusive in
   `evaluatePass`, including 6.41 s in `computeObligation`; `check`, item-source
   predicates, materialization and garbage collection recur elsewhere.
   [Obligation recursion](../../app/tasks/engine.mjs#L774) memoizes positive
   root proofs within a closure, rather than retaining an exact result across
   gameplay changes.
3. **Cold worker preparation and duplicated resident graphs.** Cold peer
   admission and the first advisory lane add roughly ten seconds beyond their
   actual evaluations. Each isolate resolves its dataset, builds indexes and
   prepares compiled variants. Startup diagnostics attribute 3.39 s to
   catalogues, 9.92 s to worker/references, 2.55 s to storage and 1.01 s to
   authentication; optional variant preparation spans another 5.97 s while
   early requests can be active. These spans are not a first-paint breakdown.
   The corrected interaction trial reaches about
   1,585 MiB main RSS and 3,424 MiB combined worker RSS within an action window.
   Individual worker peaks are smaller; do not mistake one worker's peak for
   the total calculator footprint.
4. **Large-map allocation pressure.** The adjacency-only stress run reaches
   a 200-owned-chunk evaluation and crosses the 1,800 MiB worker ceiling before
   returning. This is a measured resource boundary, not a completed 200-chunk
   timing. Larger checkpoints were left unmeasured to protect the shared PC.
5. **Full hypothetical scenarios and background advice.** Area check already
   reuses current baseline IDs but evaluates two scenarios. Rules review uses
   a sandbox baseline and a changed-rule hypothetical. After browser startup,
   enabled death markers also request a separate candidate-estimate batch;
   one task-isolate profile spends 17.05 s inclusive in `deathEstimates`.
   This activity is conditional on the saved preference, not caused by typing
   each search character.

## Five proposed fixes

These changes are proposals only. Gains overlap, especially the first three;
none of the estimates below is a measured after-fix result.

| Priority | Proposal | Expected gain | Risk | Size |
| --- | --- | --- | --- | --- |
| 1 | Give automatic travel a capability-specific key; reuse its conservative baseline across completion/roll bookkeeping, and move unavoidable misses off the HTTP event loop | Target most of the 3.5–3.8 s synchronous save delay. Offloading alone protects HTTP responsiveness but does not reduce total CPU | Medium/high: supplies must never prove their own transport route; preserve the transport-disabled proof | Medium/large |
| 2 | Split cached capability eligibility from challenge-completion overlays | Avoid roughly 1.5–2.4 s of core work per member on an ordinary tick; refresh both members' completion, collection, equipment and presentation outputs | Medium: first status keys add ownership queries; aliases, explicit false, completion scopes and claim cleanup must stay correct | Medium |
| 3 | Rebind task results across selection/pending-offer/blacklist-only revisions using a task-specific fingerprint, while recalculating pool eligibility | Remove the measured 2.8–3.0 s Group refresh after offering two choices; combine with #1 for a much larger roll improvement | Low/medium: preserve revision checks, stream invalidation and pool exclusions | Small/medium |
| 4 | Cache obligation/source queries at a valid closure boundary, then use dependency-indexed dirty work for adjacent unlocks and member changes | `computeObligation` is about 56% of sampled `evaluatePass` time in one profile; a 20–40% core CPU reduction is a reasonable experiment target, not a forecast | High: negative proofs and cycle guards are path-dependent; unlocks can change distant recipes, skill training and partner supply | Large |
| 5 | Release obsolete full snapshots promptly, budget full graphs as well as serialized bytes, and reduce optional worker residency | Aim to recover hundreds of MiB per active lane and reduce allocation/GC pressure; validate against the 200-chunk cap | Medium: retain the current baseline needed by predictions and avoid trading memory for repeated cold starts | Medium/large |

For #2, ignore only `challengeCompleted` in the capability key. Backlog,
personal in-game completion, source declarations, rules, observations and
access still affect eligibility. Regenerate derived rows from immutable core
artifacts; the existing full pipeline mutates/extends task arrays.

For #3, a narrow reuse fingerprint already exists for unlock predictions.
Consolidate and test the cache boundary rather than introducing a second
unrelated definition of task inputs. Worker reuse already exists too: workers
are persistent and their compiled variants are cached. Simply adding another
worker per member would increase the observed memory problem.

For #4, reevaluating only tasks located in the newly unlocked chunk is unsafe.
New supplies can unlock remote processing, equipment, quests and partner
training. A personal rule change also cannot automatically invalidate just one
member without tracking those shared dependencies.

After these changes, cold-start work deserves a separate experiment: prepare
the selected variant without retaining an unused compiled baseline, and share
verified immutable dataset/index materialization across lanes where safe.
The current foreground/peer isolation protects responsiveness and should not
be removed without an equivalent scheduling guarantee.

## Reproduce the walk

Copy the save's state document and its `static` sidecars into an ignored
`perfwalk` scratch directory. A scratch server also needs the `history`
directory. Copy these three entries explicitly; never copy a whole installed
game directory or its credentials and ownership locks. Remove the copies after
the run. The walk reads the copy and changes only an in-memory hypothetical.

Set the ordinary dataset/profile/pack environment before starting Node, or set
`RS3_PERF_COMPANION_ROOT` to an immutable companion release directory. The
helper reads its receipt and writes a scratch pack selection. Set
`RS3_PERF_STATE` to the copied state document. No private data is embedded in
the harness.

```powershell
# Set these to existing local paths, without committing their values.
$env:RS3_PERF_COMPANION_ROOT = $companionRelease
$env:RS3_PERF_STATE = $scratchState
& $heavyWrapper node scripts/perf/map-growth.mjs --output-dir var/perfwalk/quick
& $heavyWrapper node scripts/perf/map-growth.mjs --full --output-dir var/perfwalk/full
# Optional adjacency-only stress scenario; does not assert a legal walking route.
& $heavyWrapper node scripts/perf/map-growth.mjs --full --frontier grid --output-dir var/perfwalk/grid
```

Default checkpoints are 1, 10, 50 and 200 owned chunks. `--full` also measures
600 and the end of the reachable walking component. The starting chunk is the
first saved chunk of the first member; the partner's map and both players'
personal facts are preserved. `--seed 1729` is the default. Candidate ordering
is stable, and each added chunk must have an eligible verified walking edge.
Growth disables transport and selected candidates; checkpoint pool timings use
the original saved rules. The script records the selected dataset and input
digests privately so comparisons can check that inputs match.

`--frontier grid` instead chooses from the indexed map's geometric neighbors.
It still grows one adjacent cell at a time, but may include impassable land or
water. This mode tests larger graphs after the legal walking frontier ends;
its results must be labeled as hypothetical stress measurements.

The worker remains alive across checkpoints. Each checkpoint measures compact
play evaluation, real roll-pool evaluation, total and presented task counts,
response size and memory. Three fresh revisions at the final map size repeat
the same gameplay input to expose snapshot churn (`--repeat` changes the count).
The JSON records the core commit, dirty application code, profiling mode and
input/dataset digests. Output is `walk.json` and
`walk.md`; treat both as private until reviewed.

Use `--max-ms` to change the default 15-minute budget or
`--max-worker-mib` to change the default 1800 MiB worker limit. The walk stops
when the reachable component ends or a budget is exceeded. It never jumps to
an island merely to reach a checkpoint. Memory is sampled every 250 ms;
worker RSS includes its process host and task isolate. Main-process maxRSS is
a cumulative high-water mark. RSS measures committed/resident pages rather
than live retained JavaScript objects, so these samples alone cannot prove a
leak.

For V8 profiles, create the output directory first and add Node's
`--cpu-prof --cpu-prof-dir=<scratch-profile-directory>` before the script path.
The owned process worker inherits profiling flags. Keep profiles private:
their source paths can identify the local installation. Compare the same
seed, copied save, companion digest, Node version and worker mode, under the
same heavy lock with similar background load. Checkpoint evaluations occur
only at the listed sizes; the script does not evaluate every intermediate
unlock.

## Existing behavior and reuse boundaries

| Action | Current work | Reuse boundary |
| --- | --- | --- |
| Startup | Dataset validation/materialization, server world, task worker compile, rule variant preparation, initial state/pools and member lists; later autonomous warmup | Static catalogues and compiled variants per process; first usable map and complete task lists are separate milestones |
| Group task tick | Revision-checked `set-task-status` with `challengeCompleted`, then selected and partner list requests | Shared challenge completion changes obligations; it cannot simply be declared display-only |
| Task rule | Effective rules, source/processing closure, equipment and presentation; both lists refresh | Compiled variants already exist; member evaluation can be skipped only with a proven dependency boundary |
| Two-choice roll | Pool/command/history work and fresh list requests despite unchanged ownership | Task-specific hashing already excludes pending offers and selection; broad storage hashing still includes them |
| Unlock | Changed reachability, sources, processing closure and both member lists | Exact hypothetical prediction promotion, including partner bytes, already exists |
| Area check | Current ordinary task IDs plus two hypothetical scenario evaluations, training comparison and task difference | Current list baseline is already reused; scenarios currently clone the complete state |
| Rules review preview | Sandbox baseline, changed-rule hypothetical, task difference and pool | Browser cache 64; worker hypothetical cache 2; exact input and rule identity required |
| Active Tasks filters/search | Local selection and DOM work; first expanded Group search can request inspection projections for both members | Cached inspection bytes and existing selection cache; 100 ms search debounce and 70-row category batches already exist |

Source anchors: [worker stages](../../app/tasks/worker.mjs),
[worker lanes and limits](../../app/tasks/scheduler.mjs),
[automatic transport](../../app/core/automatic-transport.mjs),
[storage fingerprint](../../app/storage/gameplay-fingerprint.mjs),
[task reuse fingerprint](../../app/tasks/unlock-reuse.mjs),
[Area check](../../app/tasks/area-check.mjs),
[Group rendering](../../app/web/screen-tasks.mjs).

## Retention and recovery

| Checkpoint | Scenario | Evaluation s | Pool s | Worker peak MiB |
| ---: | --- | ---: | ---: | ---: |
| 1 | Verified walking | 3.510 | 4.690 | 1,020 |
| 10 | Verified walking | 2.666 | 2.270 | 864 |
| 50 | Grid-neighbor stress | 2.669 | 2.454 | 1,055 |
| 200 | Grid-neighbor stress, interrupted | Unfinished after 15.802 | Not measured | 1,811 |
| 600 / whole map | Not reached under the resource cap | — | — | — |

The legal walking frontier ended before the 50-cell checkpoint; the runtime
artifacts retain its exact stopping size and private task counts. In a separate
same-map run, twelve fresh worker revisions took RSS through a 1,447 MiB sampled
peak and back down to 1,192 MiB late in the run; the final sample was 1,363 MiB.
This shows cache/allocator churn rather than strictly monotone growth. It does
not establish that all long-session leaks are absent. The repeat deliberately
forces reevaluation and is not the server's display-only revision reuse path.

The reviewed caches are bounded: ordinary/state snapshots four each,
hypothetical snapshots two, death estimates 256, automatic-transport baselines
two signatures, and scheduler caches bounded by both entry count and bytes.
The engine's processing replay cache is scoped to one evaluation. Several
independent worker lanes can nevertheless retain separate compiled catalogues
and large result graphs. Large retained memory is plausible without an
unbounded map or a leak.

The foreground scheduler defaults to a 30-second calculation deadline, three
automatic restarts and a 120-second no-progress health threshold. Production
startup has a separate allowance. The watchdog can replace an unhealthy task
worker while HTTP and durable saves stay running. A recovery line alone does
not distinguish CPU contention, exhausted retries, allocator pressure or a
logic failure. Do not infer an out-of-memory crash without supporting evidence.

The inspected watchdog log records replacement at 01:10, completed 27 seconds
later, and another replacement at 01:20, completed 29 seconds later. Both lines
explicitly say the picker and saves stayed running. The inspected server error
log was empty. Cold admission of roughly ten seconds plus a several-second
evaluation leaves limited headroom under a 30-second request deadline when the
machine is contended. Repeated deadline failures can exhaust automatic retries
and require the recorded watchdog replacement. That is a plausible explanation;
the logs lack the original failure kind and heap measurements needed to prove
it. The live service was not queried to reconstruct those events.

## Verification

The input tests cover scratch-only loading, checksum verification, sidecar
path rejection and repeatable random choices. The public quick suite passed
1,213 tests with one skip and no failures (132 files); the companion quick check
passed 1,551 with one skip and no failures (162 files). The public-boundary scan
passed on the final working tree. This change
does not modify engine, server, storage, worker or dataset behavior and does
not require a full suite.
