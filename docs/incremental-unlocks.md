# Incremental unlock calculation

Design for [#296](https://github.com/fenerax/chunk-picker-rs3/issues/296).

An unlock changes personal territory. It can expose entrances, walking
connectors, teleports, lodestones, partner round trips and sources. Sources
feed items, recipes, processing selection, primary training, potential levels,
points and task prerequisites; task outputs can feed access again. Ownership
also changes obligation provenance independently of capability. An independent
source can exclude a no-XP recipe; a better processing method can exclude an
older one. Therefore neither the old valid-task set nor its processing winners
are safe seeds for a new fixed point.

## Calculation boundary

The predicate-reuse slice is experimental: select it with
`RS3_INCREMENTAL_UNLOCKS=1` or the engine constructor's `incrementalUnlocks:
true`. The ordinary full calculation remains the default until end-to-end
measurements establish a useful improvement. `incrementalUnlocks: false`
provides the cold reference independently of the environment.

Retain dependency information from a completed calculation, under the existing
eligibility byte budget. An unlock may reuse a task check only when all inputs
read by that check still agree. Sources invalidate their item consumers, item
consumers invalidate recipes and processing choices, and those publications
invalidate dependent tasks, skills and access gates. Absence is an input too:
an absent source or prerequisite must invalidate just as a present one does.
Changes to partner territory must be checked for every affected member.

The first implementation preserves the staged fixed point, admission ordering
and fresh final projection. It incrementally reuses task predicates within that
calculation, rather than seeding it with possibly circular previous admissions.
Access, partner connections, processing choices, sources and training are
recomputed by the existing collectors. Dependency checks observe both gains and
losses, so processing retractions follow the same full-discovery fallback as
the reference. Public gameplay counters, row order and explanations remain part
of equivalence, even when a cached predicate avoids actual work.

The implementation records Set membership (including false), Map lookups,
scalar properties, ordered collection reads and item-admission predicates.
Object observations use SHA-256 of V8 serialization, preserving undefined,
collection order and numeric distinctions. Item predicates compare the actual
consumer's source policy rather than invalidating on unrelated source-location
changes. Explanations depend on the disconnected-route text only when they use
it. Mutable source publications invalidate their fingerprints. Pass-local
fingerprint caches reset before each access/production round.

At most four predicate variants per task/check mode survive each calculation.
Two serialized bases per compiled engine share the existing eligibility ledger,
including complete backing bytes and key/entry overhead. They compete with
existing proofs under the same caps and eviction callbacks. Deserialization
creates private scratch. Cached explanations are copied before presentation
can append blockers.

Reuse requires a resident, budgeted base and an ownership-only transition with
unchanged rules, progress, controls, overrides, catalogue and evaluation options.
Missing or evicted bases, omitted/nonarray ownership, removals/reordering of
existing ownership, changed nonownership facts, How proof capture and an explicit reference override use
full calculation. New retained data is private calculator state, never a save,
snapshot-wire field or transferred eligibility proof. Eviction releases the
base and its dependent cache together. No cap increases are permitted.

Record the selected path and reason as nonenumerable calculation diagnostics,
separate from gameplay counters. This keeps existing transported result bytes
and the unchanged Q2 comparison contract intact.

## Equivalence and performance

The cold reference disables incremental reuse. Differential tests compare the
complete results, including processing data and gameplay counters, after each
unlock on full game data. Cover both members, disconnected/connected partner
territory, processing competition and negative duplicate-output prerequisites.
Also cover eviction, rule/progress changes and arbitrary operation order.
Synthetic fixtures isolate negative and cyclic dependencies. No wall-clock
assertions belong in these tests.

Keep `scripts/experiments/q2-diff-engine` byte-identical and run its existing
before/after gate without new exclusions. Any difference is an implementation
bug. Preserve snapshot and save bytes and run the cache-cap regressions.

Use the #293 20-roll method and 14+6 process boundary documented in
[the measurement report](perf/unprepared-unlock-2026-11.md), on the same full
data, chunks and synthetic fixtures. Compare normalized task hashes outside the
timed interval. Record median, nearest-rank p95 and maximum, path diagnostics
and machine admission conditions. Retry a busy or memory-starved cohort;
do not claim the three-second target from noisy or engine-only measurements.

PR #295 is useful independent snapshot work. Any reused changes must be folded
into this branch and verified here; this implementation cannot require its
merge. The PR remains a draft with `Refs #296` until the complete result and
latency evidence establish the acceptance target.

## Verified prototype boundary

The opt-in implementation at `334ed2c` passes 102 focused cases and 78
complete-result comparisons on the full game provider. The latter cover 20
personal unlocks and eight each for disconnected partner and alternating
ownership, evaluating both members after every step. A synthetic no-XP recipe
within that full catalogue is eligible initially and becomes excluded when
the first unlock supplies its output independently. Processing counters are
compared explicitly as well as the complete enumerable result.

The omitted-ownership fallback at `26212cb` passes 25 focused cases, including
both members as the missing owner. The resident-planning GC fixture repair at
`02873525` passes both cases without changing its retention/collection assertions.

The unchanged Q2 supervisor compared `841de02b` with `26212cb`: 1,548 pairs,
1,247 successful results, 301 matching error pairs, zero differences and verified
inputs. It completed in 143.70 seconds with 1,285 MiB sampled peak process-group
RSS on Linux under WSL, Node 24.20.0, within the existing memory bounds. The
candidate-only activation patch changes the constructor default to `true` so
this comparison exercises the opt-in implementation. Its SHA-256 is
`daf11d6a6949731ce16f0e1923fa89aaf5b9dbdee9e4d8cfec3eb46fe33372bf`.
The patch is an isolated supervisor input; it changes neither published source
nor the comparator, exclusions, harvest floors or input contract.

This proves the tested results, not the latency target or complete dependency
propagation through access and processing. Predicate validation still visits
the existing task-check frontier. Further work must reduce the collectors and
publication/projection work before this can replace the default calculation.
