# Eligibility reuse and overlapping unlock refresh

Task evaluation now keeps the eligibility proof separately from challenge
completion and display selection. `app/tasks/eligibility-cache.mjs` owns two
content-addressed results per compiled engine variant. Each returned result is
independent of the retained graph, including processing facts and the engine's
non-enumerable counters. No save state or HTTP credentials are retained there.

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

## Matched measurements

Windows, v24.20.0, baseline core 789f972 and this branch, copied save and pinned companion, seed 1729. The old/new interaction runs and old/new walking runs executed back to back under one heavy-lock ownership. Each process started with at least 6 GiB free physical memory. These are single trials, not percentiles. Earlier samples taken across separate lock windows were excluded from this comparison.

| Action | Before wall s | After wall s | Before acknowledgement s | After acknowledgement s |
| --- | ---: | ---: | ---: | ---: |
| tick | 5.346 | 1.708 | 0.442 | 0.304 |
| untick | 4.357 | 1.457 | 0.455 | 0.267 |
| roll | 0.574 | 0.384 | 0.521 | 0.316 |
| unlock | 7.520 | 4.331 | 3.646 | 4.321 |

Both members' normalized response hashes match at startup, tick, untick, roll and unlock. Input bytes, dataset digest and Node version match. Only revision/cache/timing metadata was removed. The selected active tick changes the task projections, rather than merely writing an already-satisfied catalogue row.

### Unlock breakdown

Profile numbers below are inclusive sampled spans on the HTTP process. Travel is nested inside pool work. Worker spans overlap one another and, after the change, overlap the command acknowledgement; these rows must not be added.

| Component | Before s | After s | Measurement |
| --- | ---: | ---: | --- |
| Durable-save phase | 0.084 | 0.120 | Command start to commit notification; includes notification overhead |
| Automatic travel rebuild | 3.237 | 3.614 | Inclusive profile span |
| Roll pool including travel | 3.331 | 3.738 | Inclusive profile span |
| Member 1 engine | 3.078 | 3.017 | Worker stage wall time |
| Member 2 engine | 1.586 | 1.831 | Worker stage wall time |
| Member 1 complete evaluation | 3.737 | 3.483 | Engine plus projections/serialization |
| Member 2 complete evaluation | 2.311 | 2.597 | Engine plus projections/serialization |
| Group refresh after acknowledgement | 3.874 | 0.010 | Both parallel HTTP reads |

The shared-map unlock still rebuilds genuine travel/capability facts and both members' eligibility. Safe reuse removes the redundant capability-proof copy and coalesces the following Group reads with evaluations started after commit. Durability, pool admission and revision checks remain on their existing paths.

### Walking comparison

| Owned chunks | Before evaluation s | After evaluation s | Before pool s | After pool s |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3.593 | 4.378 | 4.295 | 5.876 |
| 10 | 2.650 | 5.557 | 1.933 | 2.361 |
| 40 | 1.625 | 2.323 | 1.082 | 1.311 |

Task, presented-task, available-task and eligible-roll counts match at every checkpoint. Both legal walks exhausted the same 40-chunk component; larger/grid stress cases were not measured. Worker peaks, including the repeated final-map revision, were 1166.8 MiB before and 1264.8 MiB after, below the 1,500 MiB ceiling. Cold samples do not establish a calculation-complexity improvement; the change primarily skips unchanged work.

The repeated same-map revision took 1.509 s before and 0.871 s after.

## Verification

Public quick: 1266 passed, 1 skipped, no failures. Companion quick: 1552 passed, 1 skipped, no failures. Focused engine, transport, prediction, unlock and Group checks: 137 passed, no failures.

The single full suite ran 2484 tests: 2482 passed, 1 skipped and one obsolete assertion failed. That assertion required an empty task cache immediately after unlock; proactive refresh can already have stored the new revision. It now requires fresh revision-2 inspection bytes, and all 137 affected checks pass after repair. The full suite was not repeated, following the one-full-run rule.

The public-boundary scanner runs after this report is generated. No canonical private source, private changelog/roadmap, installed save or live server was changed. Disposable save copies and scratch server stores are removed after the final checks.
