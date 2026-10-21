# Eligibility reuse and overlapping unlock refresh

Task evaluation now keeps the eligibility proof separately from challenge
completion and display selection. `app/tasks/eligibility-cache.mjs` owns two
content-addressed serialized results per compiled engine variant. Each returned result is
independent of the retained graph, including processing facts and the engine's
non-enumerable counters. No complete save snapshot or HTTP credentials are retained there.

Cold misses serialize the retained proof with Node's V8 serializer and return
the newly computed graph directly. Hits deserialize private graphs before
applying completion. This avoids allocating a second full graph on each miss
and retains compact bytes between evaluations. Processing facts, row flags and
non-enumerable metric descriptors are stored explicitly and restored on hits.

The engine projects saved aliases and legacy facts before looking up the key.
The conservative key in `app/core/travel-inputs.mjs` covers access, both members'
capability facts, rules, identity resolution and completed quest labels. Query
options also participate. Unknown global rules invalidate conservatively.
Definitions and dataset options remain scoped to the compiled engine variant.
Automatic travel already retains its own exact baseline signatures. Its calls
use `reuseEligibility: false` to avoid retaining and copying those large proofs
again in the eligibility cache. The capability calculation itself is unchanged.

## Completion and backlog boundaries

| Change | Eligibility work |
| --- | --- |
| Challenge checkmark or uncheck, including quest steps, producers and training tasks | Reuse eligibility; recompute challenge satisfaction for the current completion scope and both Group members |
| Actual personal completion or removal of any task | Full member proof; no attempt to classify an ordinary-looking completion as harmless |
| Quest completion, step or account-bound quest observation | Full proof: personal prerequisites, quest points, rewards, transport and access can change |
| Item-producing or equipment-obtain task completion | Full proof: supplies, recipes, equipment and remote consumers can change |
| Skill or capability task completion | Full proof: passive levels, training, processing and area/source gates can change |
| Equipment recorded by hand | Full proof: the existing engine supplies that item even without a reachable source |
| Backlog flag, including explicit false | Full proof: it can remove or restore a production/training method; false also overrides imported/aliased true |
| Favorite, note or backlog reason | Reuse eligibility; presentation reads the current save |

Every projected `completedTasks` entry and every explicit `backlogged` value
is keyed, for both members. This detects all these cases conservatively rather
than relying on a partial dependency index. Personal equipment records were
missing from the earlier travel key; they are now included in both keys.

Completion scope (`any`, `all`, `personal`) and challenge flags are overlaid on
fresh task rows. The worker then runs its existing collection, equipment,
presentation and activity projections against the current save. The complete
saved-response fingerprint remains conservative, so an HTTP response carrying
old completion/presentation bytes cannot be promoted merely because eligibility
was reused. Revision checks, claims, History and Undo keep their existing paths.

## Member dependency boundary

With sharing enabled, both members' ownership and capability facts remain in
each eligibility key. An unlock can supply remote items, training or connected
partner access, so both proofs still invalidate. When sharing, automatic travel
and typed transport are all disabled, the partner's changing capability and
ownership fields can be excluded. Roster order and identity remain keyed, and
both completion overlays still read the current Group state. Other combinations
fall back conservatively.

## Unlock overlap

After the durable write, storage publishes whether ownership changed and yields
once before calculating its command-response pools. The server starts only the
previously requested play lists, using the committed calculation snapshot and
existing foreground/Group lanes. It does not wake a sleeping foreground worker.
Those evaluations overlap the HTTP process's independent travel/pool rebuild.
The subsequent list requests coalesce through the existing scheduler keys;
exact prepared-unlock promotion remains available. A failed early calculation
cannot fail the committed save, and ordinary reads keep their normal retry path.

This does not add a worker or incremental per-chunk evaluation. A future change
could index newly admitted sources and invalidate their transitive consumers,
including partner training, recipes, access and negative proofs. That needs a
separate dependency model and cold-equivalence evidence; location-only task
invalidation would be unsafe.

## Equivalence evidence

`tests/eligibility-reuse.test.mjs` compares complete engine results against fresh
engines for both members and all three completion scopes, after ticks, unticks,
personal completions, notes, backlog changes and either member's unlock.
Processing facts and non-enumerable task facts are checked separately. Positive
assertions show personal completion opening a quest prerequisite, supplying an
otherwise unreachable item and raising a passive capability; challenge ticks do
none of these. Identity edits, in-place changes, query changes, independent
partner ownership and caller mutation are covered too.

A native worker sequence compares complete play, Group and Group-sidebar JSON
against freshly created workers after each edit. The server test in
`tests/task-claim-server.test.mjs` verifies that both committed unlock evaluations
start before acknowledgement and following Group reads dispatch no duplicates.

## Measurement method

`scripts/perf/interactions.mjs` uses an explicitly designated disposable save,
the pinned companion selection and seed 1729 under the shared heavy lock. It
starts with one owned chunk per member, preserves personal facts and rules,
measures an active task tick, untick, two-choice roll and immediate unlock, and reads both
Group lists in parallel after each command. Prediction warming is disabled.
The disposable server creates fresh credentials; no installed credentials or
ownership lock are copied. CPU profiling covers the unlock on the HTTP process.
Commit-notification time measures the durable-save phase; command acknowledgement
also includes travel/pools and response construction. Worker stage timings come
from the ordinary task responses. Nested CPU-profile spans must not be added.

The walking comparison uses `scripts/perf/map-growth.mjs --full --repeat 1
--max-worker-mib 1500` on the same input and companion. Private raw profiles,
response hashes and screenshots stay outside tracked source. Disposable saves
and their sidecars are removed after verification.

## Cold evaluation recheck

The follow-up used Windows, v24.20.0, the same disposable save/static copy and pinned companion, seed 1729, and the production process-worker walking method. Each table contains three alternating before/after trials at 1, 10 and the exhausted 40-chunk component. Every checkpoint is an eligibility miss; later checkpoints use the same worker, as in perfwalk. The repeated final revision is a warm measurement and is excluded from these cold tables.

Both the shared heavy and light lanes were reserved during each batch, excluding other gated tests and browser sessions. Five-second process CPU samples before every trial found no other test/perf process. Background applications included Claude, Chrome, Wave Link, audio and Directory Opus. The desktop remained active throughout the measurements.

Pre-trial aggregate CPU use was 14.5–20.4% on 12 logical CPUs, with 8.8–9.2 GiB free RAM. The wrappers' BelowNormal priority and picker-use admission guard remained enabled. An earlier pair overlapped a separate phone-browser server and was discarded. No release gate overlapped the accepted trials.

Sources were exported directly from 789f972 and 59e7162. The final batch replaces only the eligibility-cache module in the latter export with this branch's serialized implementation. Explicit archive/module pins are retained with the private scratch reports; the embedded Git metadata in an export resolves the enclosing checkout and is not the source pin.

### Original tips: 789f972 versus 59e7162

| Chunks | Before median s (min–max) | After median s (min–max) |
| ---: | ---: | ---: |
| 1 | 3.399 (3.308–3.417) | 3.668 (3.590–3.700) |
| 10 | 2.587 (2.545–2.665) | 2.907 (2.815–2.942) |
| 40 | 1.793 (1.659–1.835) | 2.050 (2.013–2.091) |

The original cold regression is real but smaller than the loaded single pair suggested. It is about 0.27–0.32 s in these medians, rather than the earlier 0.7–2.9 s differences.

A separate instrumented run measured 415/231/372 ms cloning the retained result at 1/10/40 chunks, versus 3.9/3.5/2.3 ms building the key. The computation and processing proof passes were unchanged. This identified the extra full-graph clone as the avoidable cost, rather than fingerprinting or another capability pass.

### Final serialized cache: 789f972 versus this branch

| Chunks | Before median s (min–max) | After median s (min–max) |
| ---: | ---: | ---: |
| 1 | 3.658 (3.282–4.140) | 3.768 (3.483–4.165) |
| 10 | 2.652 (2.475–2.771) | 2.867 (2.621–2.910) |
| 40 | 1.652 (1.591–1.865) | 1.842 (1.837–2.106) |

Cold misses now serialize the retained proof instead of allocating a second full object graph. The instrumented retention times fell to 166/141/120 ms at 1/10/40 chunks. Cache hits decode private graphs, retaining caller-mutation protection and non-enumerable facts. Both caches remain bounded to two proofs per compiled variant.

The final medians remain about 0.11/0.22/0.19 s above their paired baselines (3%/8%/11%). The min–max ranges overlap at each size, so these trials do not establish exact residual percentages. Retention still has a measured cold cost; the change reduces that cost. No incremental per-chunk evaluation was introduced.

Input/dataset pins and task, presented, available and roll-eligible counts match in all twelve walks. Every walk exhausted the same 40-chunk component. Peak worker RSS, including warm repetitions, was 1271.6 MiB, below the 1,500 MiB ceiling. Larger/grid stress cases were not run.

## Final interaction measurements

One matched before/final pair ran sequentially under both reserved lanes, with fresh disposable servers and credentials. It measures the active tick, untick, roll and immediate unlock plus both Group list reads. Prediction warming is disabled. These are single observations.

| Action | Before wall s | Final wall s | Before acknowledgement s | Final acknowledgement s |
| --- | ---: | ---: | ---: | ---: |
| tick | 3.297 | 1.886 | 0.293 | 0.453 |
| untick | 3.050 | 1.452 | 0.272 | 0.413 |
| roll | 0.612 | 0.613 | 0.553 | 0.542 |
| unlock | 6.402 | 6.031 | 3.057 | 6.022 |

Both members' complete normalized response hashes match at startup and after every action. Only revision/cache/timing metadata is removed. The active tick changes the response, and the save, dataset and Node pins match the walking inputs.

### Unlock breakdown

Travel is nested in roll-pool work. The member evaluations overlap one another and, after the change, overlap acknowledgement. These inclusive spans must not be added.

| Component | Before s | Final s |
| --- | ---: | ---: |
| Durable-save phase | 0.110 | 0.166 |
| Automatic travel rebuild, sampled HTTP span | 2.652 | 5.155 |
| Roll pool including travel, sampled HTTP span | 2.748 | 5.361 |
| Member 1 engine | 2.623 | 4.671 |
| Member 2 engine | 1.501 | 2.881 |
| Member 1 complete evaluation | 3.242 | 5.403 |
| Member 2 complete evaluation | 2.007 | 3.691 |
| Group refresh after acknowledgement | 3.345 | 0.009 |

Shared unlocks still need both members' eligibility and a genuine travel rebuild. Starting the requested Group lanes after durable commit overlaps that work and coalesces the following reads. Incremental evaluation of newly admitted sources and their transitive consumers remains a proposal requiring its own dependency model and cold-equivalence proof.

## Final verification

- quick: 1267 tests, 1266 passed, 1 skipped, zero failures.
- companion-quick: 1553 tests, 1552 passed, 1 skipped, zero failures.
- focused: 132 tests, 132 passed, 0 skipped, zero failures.
- full: 2484 tests, 2483 passed, 1 skipped, zero failures.

The full suite was rerun once at the end under the heavy lock, after both the obsolete inspection assertion repair and the serialized-cache change. The focused cold-equivalence test also checks every non-enumerable processing metric descriptor, processing facts, caller mutation and both Group projections. The public-boundary scanner is run on the final tracked source before committing.

The first direct focused command failed during module loading because it inherited the ambient dataset selection. The corrected command explicitly selects `open-f2p` and clears pack/profile overrides before loading tests. Both quick suites had already selected their datasets correctly; the full suite started only after the corrected focused run passed.

Canonical private source was not edited. Follow-ups there:

- `checks/private-source/tests/duo-server.test.mjs:321`: replace the empty-cache-after-unlock assertion with fresh revision-2 inspection reuse, matching the public repair.
- `checks/private-source/tests/automatic-transport.test.mjs:33`: assert the transport evaluator receives `{ reuseEligibility: false }`.
- `checks/private-source/tests/automatic-transport.test.mjs:205`: extend the capability-cache boundary coverage for challenge-only ticks, retained equipment, aliases and explicit backlog values, using the public synthetic checks as the reference.

The installed save, live servers, private changelog/roadmap and other worktrees were unchanged. Disposable copied saves and scratch server credentials are deleted after the measurements. Screenshots from the existing implementation remain valid because this follow-up changes no UI.
