# Ardougne Hard constituent repair

START: `a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9`.

The selected prepared aggregate declared 16 same-tier duties and the Medium
aggregate, omitting Artillery Strike. The static reference correction now adds
that exact Diary prerequisite. Individual duty records, all previous prerequisites, identities and
aggregate/reward semantics are retained. No engine or storage code
changes.

## Source evidence

The task owner verified and supplied these Wiki revisions; this sandbox did
not retrieve fresh Wiki content:

- [Ardougne Achievements, revision 36199598](https://runescape.wiki/w/Special:PermanentLink/36199598):
  Hard lists 17 achievements, with Artillery Strike as task 17. No Hard task is
  optional or exempt and there is no tier footnote. Conditional Ironman
  requirements do not remove a constituent. Cloak rewards require previous tiers.
- [Artillery Strike, revision 37053862](https://runescape.wiki/w/Special:PermanentLink/37053862):
  achievement ID 502, subcategory Hard Ardougne achievements, Catapult
  Construction prerequisite, members-only.

Both citations are recorded in the reference correction's provenance. A full
before-value hash guards the aggregate's Tasks field. The original export is
unchanged and reapplication is idempotent.

## Validation and comparison method

The reference-integrity tests use the selected prepared aggregate with isolated
access gates to verify all 17 duties and the previous tier independently. They
cover blocked versus attainable duties, personal completion, partner completion,
challenge checks, both Any and Complete settings, and potential reward supply
without recording completion or ownership. The new membership regression fails
on untouched START (16 versus 17) and passes with the correction.

The public `compareOriginalData` API in `scripts/compare-original-data.mjs`
reports one changed task and no other entity or section changes.
`scripts/perf/diary-tier-comparison.mjs` uses the same three generated public
states as `quest-requirements-check.mjs` (five member evaluations). It compares
full task rows and full roll-pool hashes across explicit START and candidate
checkouts in fresh child processes.

Private mode copies the supplied save into temporary storage before opening it.
It evaluates the current state and seven evenly spaced older retained revisions,
for eight states and sixteen member evaluations. The same saved-state hashes and
dataset digest must match on both sides. Both stores use the same fixed
clock, following the existing duo compatibility harness, so startup observation
timestamps do not create input differences. The initial trial with an unfixed
store clock was discarded and is excluded from measurements. Only counts, hashes, sizes and timings
leave temporary storage; no private declarations or gameplay enter this repo.
The source state hash is verified unchanged. Each side uses one process worker
at a time. Three paired runs must have identical difference counts.

Wall times include loading, preparation, compilation, task evaluation, pool
evaluation and hashing. Peak RSS sums each child process tree sampled every
50 ms; brief peaks can be missed. These bounded measurements do not establish
production latency or capacity. The quick suite ran concurrently with the
public trials; retained private trials ran after the quick suite. These timings
are diagnostic, not a performance regression verdict. The full `tools/calc-check` is unavailable on
main; this comparison does not cover its full protocol corpus.

## Public results

Three paired runs agree. Per five-evaluation corpus: tasks added 0, removed 0,
changed 5; pool differences 0. Prepared task declarations added 0, removed 0,
changed 1. Full row comparisons include the corrected prerequisite metadata;
these counts are not five newly available tasks.

| Measure | START | Candidate |
| --- | ---: | ---: |
| Wall median (min–max) | 21.290 (20.792–21.297) s | 22.014 (20.991–22.425) s |
| Evaluation median (min–max) | 2.495 (2.290–2.913) s | 2.527 (2.322–2.979) s |
| Sampled process-tree RSS median (min–max) | 2.442 (2.244–2.531) GiB | 2.485 (2.254–2.497) GiB |

## Test gate

On Node v24.21.0:

- `node --test --test-concurrency=1 tests/reference-integrity.test.mjs tests/definition-overlays.test.mjs tests/achievement-rules.test.mjs tests/achievement-rules.private.test.mjs tests/achievement-metadata-evidence.test.mjs`:
  54 passed, 0 failed, 0 skipped, 7.102 seconds. Selected dataset: duo-legacy,
  using the released packs without opening a real save.
- `npm run test:quick`: 3,011 passed, 0 failed, 68 skipped, 271.815 seconds.
- New membership regression on untouched START: 0 passed, 1 failed as expected
  (16 declared same-tier duties instead of 17). Its temporary copy was removed.

No new test files were added; reference-integrity remains classified full-only.
The full `npm test` was not run, per the brief.

## Private eight-state results

Three paired runs agree. Per sixteen-evaluation corpus: tasks added 0,
removed 0, changed 16; pool differences 0. All eight input-state hashes and
the selected dataset digest match across each pair. The original and copied
source-state hashes remain unchanged (source changes 0). Full task-row changes
include declaration metadata and do not imply sixteen newly available tasks.

| Measure | START | Candidate |
| --- | ---: | ---: |
| Wall median (min–max) | 186.176 (182.663–186.192) s | 184.122 (180.742–185.767) s |
| Evaluation median (min–max) | 5.799 (1.734–10.271) s | 5.772 (1.773–10.086) s |
| Sampled process-tree RSS median (min–max) | 5.194 (4.969–5.270) GiB | 4.923 (4.851–5.091) GiB |

Reproduce public measurements with:

```sh
node scripts/perf/diary-tier-comparison.mjs --baseline /tmp/start --candidate . --out /tmp/public-counts.json --runs 3
```

For the private sample, set the documented dataset, packs and game-defaults
environment and add `--data-dir /tmp/copied-game` with its sibling dataset
binding; choose a different output path. The harness enforces process mode and
requires Node 24.20 or newer. Calculations run serially.
