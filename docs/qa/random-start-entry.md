# Missing-policy random starts

START `e431da314b682946c27f601ec78f17eab8a790eb`.
Branch: `fix/z17-dead-random-starts` (main lane).

## Contract and scope

A decoded retained section-0 selector absent from the correspondence policy must
not become a random starting map without a reviewed entry certificate. The
cache-enabled builder adds terrain-only bases before indexing retained sections;
the no-cache policy generator omits their undefined chunk records. This leaves
three exposed members starts outside the reviewed bank subset.

The command now admits two of those starts with an explicit canonical component
override and excludes the conflicting third. The same check applies when accepting
saved random-start offers through selection, pick-for-me or unlock-both. Invalid
offers fail before random draws or state/history changes; they can still be
cancelled. Certificates respect the component membership mask and saved false
blocks. Offering a choice grants no entry.

This is a start-only change in `app/core/state.mjs`. It does not change walking
edges, selector/resource correspondence, ownership seeding, ordinary roll
eligibility, ordinary pending offers, curated bank pools, or intentional empty
pools produced by game rules. Existing explicit unresolved policy rows retain
their prior conservative semantics. It is not a claim that every broader start
has a nonempty pool: only the absent-policy footprint gap is repaired here.

## Reviewed public evidence

The certificates were checked against the committed retained topology, applied
component portals and independently accepted neighboring selector mappings. They
are authored entries, not an inference from component count, size or scan order.
The regression guard repeats these evidence checks.

| Retained selector | Start component | Exact neighboring-base signature | Independent reciprocal endpoint |
| --- | --- | --- | --- |
| `9515-0` | `9515-1000001` | `9516`, `9771` | `9516-0` maps to `9516-1000001` |
| `9771-0` | `9771-1000001` | `9515`, `9772` | `9772-0` maps to `9772-1000001` |

The raw portal counts are 55 for `9515:1` to `9516:1`, 16 for `9515:1` to
`9771:1`, and 63 for `9771:1` to `9772:1`. Each anchor also has a reciprocal
retained dependency. See `docs/research/cache-walkability.md`, the committed
walkability export and component policy. No external facts or Wiki access were
needed.

`13353-0` has retained dependency `13354-1`, whose accepted component is
`13354-1000003`. Its exported portal reaches `13354-1000001` instead. No entry is
certified for it. It remains available to existing ordinary ownership/manual
rules; it is excluded specifically from random-start admission and acceptance.
No resource declaration or general selector mapping is added for any of the three.

If a later dataset supplies an explicit section-0 policy row, its normal policy
takes precedence and these missing-row certificates no longer apply.

## Reproduction and validation

Every shell must select the required Node before running commands:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version # v24.21.0; stop below 24.20
git worktree add --detach /tmp/chunk-picker-z17-start e431da314b682946c27f601ec78f17eab8a790eb
node --test tests/cache-island-policy.test.mjs tests/cache-topology-application.test.mjs tests/members-start-command.test.mjs tests/setup-guide.test.mjs tests/state.test.mjs tests/partner.test.mjs tests/original-sync-state.test.mjs tests/test-selection.test.mjs
npm run test:quick
node scripts/perf/random-start-entry.mjs --baseline /tmp/chunk-picker-z17-start --comparison /workspace/chunk-picker-rs3
```

At START, the three draws `0.9481424148606811`, `0.9775541795665634` and
`0.39241486068111453` select `9515`, `9771` and `13353`, respectively, through the
actual 646-outcome members pool. Direct and two-choice starts all have zero
walking components and zero initial ordinary roll candidates.

The new tests extend `tests/cache-island-policy.test.mjs`, already classified
full-only by the cache integration pattern in `scripts/test-selection.mjs`.
They enumerate the production members and F2P RNG outcomes, exercise direct and
choice paths, and check evidence, undo, saved offers, membership and override
restrictions. No new test file requires classification.

Focused validation: 135 passed, 0 failed, 0 skipped. The initial test development
run was 19 passed / 1 failed because a manually edited saved offer had an invalid
undo record; the fixture now generates a complete offer through the real command.

Quick validation: 2,981 passed, 0 failed, 68 skipped, 0 cancelled across
320 files / 3,049 tests, in 315,615.97 ms. `npm test` was not run. No failing
socket test or parent-death test needed a baseline retry.

## Complete public-corpus comparison

Five serial alternating fresh-process START/fix pairs produced stable per-outcome
hashes within each revision. Each observation enumerates actual RNG intervals,
then snapshots every members start's seeded overrides, reached sections and full
roll-pool evaluation. Target direct and two-choice results must agree, and the
ordinary next roll is attempted. All 23 setup-bank results are also snapshotted.
There is no substituted production pool. This does not run the task calculator.

| Population or result | START | Fix |
| --- | ---: | ---: |
| Members random outcomes enumerated | 646 | 645 |
| Members outcomes outside the 23-bank subset | 623 | 622 |
| F2P random outcomes enumerated | 170 | 170 |
| Reviewed bank outcomes compared | 23 | 23 |
| Target starts admitted | 3 | 2 |
| Target starts with no entry / no initial pool | 3 | 0 |
| Each repaired start's entered components | 0 | 1 |
| Each repaired start's ordinary roll candidates | 0 | 2 |
| Bank starts with empty pools (pre-existing) | 5 | 5 |

Exactly one outcome is removed (`13353`), two common outcome snapshots change
(`9515`, `9771`), and the other **643 common members snapshots are identical**.
There are zero added outcomes. The full F2P candidate hash and all 23 bank
snapshot hashes are unchanged. Other explicit unresolved correspondence and
rule-controlled empty pools are outside this missing-policy change.

| Corpus / result SHA-256 | START | Fix |
| --- | --- | --- |
| Members candidate set | `1dc45e2eb6f364c018c830f41f45f24bb4b7061526cb008cda598ad2c9ad0176` | `0fba2f7afb964619ca1f0a32eaefb57b2f62c75a2dcdb6fbe9baf0ea206d00ea` |
| F2P candidate set | `ade3508f62ddf689a9bc6daaef30fe3c0666616fa4f23d870facdd7cf3533a4e` | same |
| All 23 bank snapshots | `f103fd5195946261fe7bc99c25c0373c6eb4711cae665a50ee83a1b86cc5b041` | same |

## Measurements

Node v24.21.0, Linux, 5 visible CPUs, 18,882,662,400 host-reported RAM bytes.
Five serial fresh-process pairs alternate START/fix order with no other heavy
work running. The OS file cache is warm and uncontrolled. Peak RSS is recorded
once per child PID and includes loading and the complete corpus. The case batch
has one fewer admitted outcome after the fix; these are descriptive measurements,
not a speed improvement claim.

Median [minimum–maximum], five observations per column:

| Measurement | START | Fix |
| --- | ---: | ---: |
| Public-world load, ms | 1,375.53 [1,156.08–1,448.89] | 1,206.61 [1,101.76–1,369.38] |
| Complete case batch, ms | 4,308.76 [4,133.11–4,760.03] | 4,226.07 [4,156.95–4,647.73] |
| Child wall time, ms | 5,848.25 [5,564.46–6,134.08] | 5,659.92 [5,339.36–5,964.79] |
| Process peak RSS, KiB | 509,828 [505,504–514,316] | 510,940 [508,140–515,948] |

## Gate limitation

The supplied START predates SFIX1. Commit
`53a9885a2d01578aa76efac071568ef95cfcef2f`, its start-only certificates, and
`tests/setup-start-pool.test.mjs` are absent locally. No network fetch was made.
Only 18/23 bank pools are nonempty both before and after this fix. The full
23/23 nonempty-bank and SFIX1 evidence gate cannot be certified on this checkout.
Existing bank behavior is compared against START, not cached
`origin/main`; the missing SFIX1 changes are not recreated in this focused fix.

Calculator implementation and result functions are unchanged. The full checker
is unavailable on main; the private eight-state sample was not run (0 states).
No private packs or saves were opened. This is not a calculator-equivalence claim.

The remaining handoff is to apply this fix on the SFIX1-containing main revision,
reconcile the start-only helper if necessary, and rerun its 29-test bank/evidence
guard plus the focused/quick checks. No guessed third correspondence should be
introduced to satisfy that gate. Recommendation: **NEEDS-WORK** until that gate
can be run on the intended base.

Players can continue rolling after either repaired start, and the unresolved
start is no longer offered.
