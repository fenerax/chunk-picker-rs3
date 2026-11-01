# R3 unknown-rate drops

START: `e431da314b682946c27f601ec78f17eab8a790eb`.
Branch: `rule/r3-rare-drops`. Node: `v24.21.0`.

## 1. Existing inputs and behaviour

The selected source input has SHA-256
`9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`
and is 10,176,005 bytes. Counts below describe that input before runtime
corrections, access gates and presentation selection.

A stored row is one quantity/rate entry. Words are stored in the rate slot,
not in a separate rarity field: `drops[source][item][quantity]` and
`skillItems[category][table][item][quantity]`. Shared tables may instead use
`rate@quantity` strings. Blank, malformed and other opaque labels also occur.
The inventory distinguishes recognised rarity words from all unknown values;
it does not interpret other labels as rarity categories.

| Stored rows | All rows | Unknown rate | Common/Uncommon/Rare/Very rare | Rare/Very rare |
| --- | ---: | ---: | ---: | ---: |
| Monster drops | 18,402 | 813 | 667 | 192 |
| Shared tables | 587 | 0 | 0 | 0 |
| Skill tables | 12,830 | 2,693 | 2,490 | 665 |
| **Total** | **31,819** | **3,506** | **3,157** | **857** |

The object-yield input contributes no string or quantity/rate rows to this
inventory. Plain boolean and numeric object yields are outside its scope.

Expanding monster and skill table references gives these potential exposures:

| Count | Any unknown component | Rarity word component | Rare/Very rare component |
| --- | ---: | ---: | ---: |
| Expanded leaf paths (70,973 total) | 3,660 | 3,164 | 864 |
| Distinct leaf items | 1,455 | 1,222 | 358 |
| Authored tasks with a matching direct item input | 4,163 | 3,681 | 872 |
| Generated collection task IDs (118,537 total) | 3,787 | 3,117 | 746 |

These are potential task dependencies, not counts of tasks relying exclusively
on unknown rates in a particular state. Direct-input counts resolve item aliases
and count each authored task once; they omit transitive recipe/task dependencies,
equipment goals and state-specific corrections. Collection counts deduplicate
IDs and count an ID if any retained alias carries the rate category. They do not
assume the corresponding collection rule is enabled. Alternative numeric,
shop or spawn sources can remove a task's actual reliance on an unknown rate.

Behaviour at START:

- `app/tasks/rates.mjs`: `parseDropRate` returns `null` for rarity words,
  blank/missing values and malformed rates. `composeDropRates` preserves that
  unknown value through nested paths. `rateEvidence` retains `unknownRate: true`
  and the raw text.
- `app/tasks/access.mjs`: monster drops and referenced tables become item
  sources with `probability: null`. `app/tasks/engine.mjs` does the same for
  skill output tables; `app/tasks/collection.mjs` expands collection sources.
- `Rare Drop` defaults on: no rare-drop cutoff is applied. When it is off,
  `Rare Drop Amount` (including its legacy aliases) controls known numeric
  rates. Equality depends on `Rare Drop Inclusive`.
- `passesRateCutoff(null, rules)` explicitly returns true for rare-drop
  admission. Unknown rates therefore pass **every** rare cutoff, including
  restrictive cutoffs. This is deliberate current behaviour, with regression
  coverage in `tests/rules-fixes.test.mjs`, rather than coercion by accident.
- The same unknown rates explicitly fail the primary-source cutoff. They can
  supply an item without counting as primary training supply.
- Existing shared source text is `Rate unknown (...)`. There is no estimate,
  move-on kill count or unknown-rate multiplier setting.

Reproduce counts with Node 24.20 or newer:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/unknown-drop-inventory.mjs
```

The script uses the selected dataset and prints only counts, a byte size and an
input hash. It reads no save, creates no calculator and writes no gameplay data.

Released-input verification: 10,176,005 bytes; SHA-256
`9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`;
0 count differences across the inventory above.

## 2. Wiki evidence and authored estimates

The environment could not fetch the wiki directly (HTTP proxy 403). The
orchestrator supplied verified facts and revisions on 2026-11-01:

- [Drop-rate style guide, revision 36460463](https://runescape.wiki/w/RuneScape:Style_guide/Drop_tables?oldid=36460463):
  there is no official numeric threshold for rarity words; 100% is Always.
- [Module:DropsLine, revision 37212317](https://runescape.wiki/w/Module:DropsLine?oldid=37212317):
  the arbitrary display colour bands have inclusive lower bounds: Common at
  least 1/16; Uncommon from 1/64 to below 1/16; Rare from 1/256 to below 1/64;
  Very rare below 1/256.
- [Template:DropsLine, revision 36897552](https://runescape.wiki/w/Template:DropsLine?oldid=36897552):
  the words are described in prose; Varies, Random and Once are special cases.

`app/data/unknown-drop-estimates.v1.mjs` keeps these facts and the following
**authored estimates** in separate fields. These denominators are decisions,
not official wiki thresholds. Very rare is an adjustable choice in an open-ended
band.

| Word | Authored estimate | Default move-on figure | Warning |
| --- | ---: | ---: | --- |
| Common | 1/8 | 24 | None |
| Uncommon | 1/32 | 96 | None |
| Rare | 1/128 | 384 | Only without another route |
| Very rare | 1/1000 | 3,000 | Only without another route |

Common and Uncommon estimates contribute only to composed move-on arithmetic;
they never trigger a warning themselves. Varies, Random, Once and other
unestimated labels keep their previous behaviour and get no estimate or warning.

The orchestrator explicitly changed the original threshold brief: **all unknown
rates remain included exactly as at START**. Estimates affect guidance only;
they never replace a probability used by eligibility or primary-source checks.

## 3. Player guidance

The personal number rule **Kills before moving on from an unknown-rate drop**
defaults to 3 and accepts positive safe integers. It sits beside the existing
rare-drop amount/inclusive controls and stays editable with Rare Drop off.
Clearing a personal override uses the existing shared/imported/default ordering.
Invalid imported values are preserved and use 3 for evaluation.

Tasks whose reachable acquisition routes all require an estimated Rare/Very rare
drop get this text in their existing task-detail explanation:

> Drop rate unknown (the wiki says rare). Move on after about 384 kills.

The same logic covers ordinary tasks, collection goals and equipment goals.
Numeric-rate drops, shops, spawns, personal obtain records and other recipes
without a rare unknown dependency suppress the warning. Alternative item aliases
and counted choices are respected. Nested table rates compose for the hint;
downstream recipes retain their input dependency. Cached results retain source
restrictions. A completed prerequisite does not create a new acquisition grind;
producing additional recipe supplies still needs its inputs.

For several required ingredients, the figure describes the largest individual
drop requirement, not total kills to complete the task. Among alternative
routes, it uses the smallest figure. Conditional requirement alternatives lack
a selected proof in this result, so the warning is conservatively withheld.
Only scalar advisory costs are cached; solver graphs are released after calculation.
Cycles cannot create an independent free route. An unestimated component in a
composed rate gets no invented figure.

No task is completed, skipped or removed by the hint. Three times the estimate
is guidance, not a probability guarantee; for a simple independent 1/128 drop,
(127/128)^384 is about 4.9% still without a drop, rather than 1%.

## 4. Validation and comparisons

- Targeted tests: 11 files, **162 passed, 0 failed**, 0 skipped. This includes
  every touched/added test and the engine, access, collection, equipment,
  automatic-defaults, rule-panel and browser-module regression files.
- Final `npm run test:quick`: **3,009 passed, 0 failed**, 68 existing skips
  (3,077 total), 433.092 s. No new skip or weakened assertion was introduced.
- Isolated `tests/linux-multi-picker.test.mjs` rerun: **54 passed, 0 failed**,
  0 skipped, 407.577 s. Its release fixture uses `git ls-files`; staging the new
  modules makes them available to the real decoder probe.
- Initial quick run: 3,005 passed, 3 failed, 68 skips. Browser import delivery,
  authored-rule explanation coverage and the unstaged-release fixture were
  corrected; the final quick run above is green.
- Syntax and staged-diff whitespace checks pass. Full `npm test` was not run.

The reusable checker is `scripts/perf/r3-rare-drops.mjs`. It runs full process-worker
evaluations against explicit START and candidate checkouts. It compares every
task ID and complete task row after removing only the two new warning fields and
the exact appended warning sentence. Roll pools are compared separately. Only
counts, hashes, durations and memory measurements leave child runs.

The public corpus is five evaluations over three deterministic tracked-input
games (one solo and two duo games), with collection rules enabled. The private
sample is eight evaluations: both members under each of four configurations
(original rules, strict rare cutoff, collection rules, move-on multiplier 4).
Copies and results live under `/tmp`; the private checkout is never modified.

Reproduce the public comparison:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/r3-rare-drops.mjs --baseline /tmp/r3-start --candidate . --out /tmp/r3-public.json
```

For the private sample, first copy the save and its dataset sidecar outside both
checkouts, set the documented dataset, packs, defaults and process-worker
environment, then add `--data-dir /tmp/copied-save --runs 1` and a separate output
path. No save is opened in place. This is a bounded rule-change comparison, not
the full calculator-protocol corpus.

Public comparison (three paired trials): warnings gained per evaluation are
**0, 17, 3, 0, 0** (20 total). Every evaluation has **0 added tasks, 0 removed
tasks, 0 other task-row changes, 0 lost warnings and 0 pool differences**.
The changes are caused only by the new Rare/Very rare guidance rule.

| Public measurement | START median [min–max] | Candidate median [min–max] |
| --- | ---: | ---: |
| Whole run, seconds | 37.027 [36.623–41.622] | 37.212 [36.959–43.167] |
| Sampled child-tree peak RSS, MiB | 2,272.5 [2,237.0–2,319.3] | 2,300.8 [2,292.6–2,337.4] |

Private comparison (one paired eight-evaluation sample): **26 warning gains**,
with **0 added tasks, 0 removed tasks, 0 other task-row changes, 0 lost warnings
and 0 pool differences**. Counts by evaluation:

| Evaluation | Warning gains | Added | Removed | Other changes | Pool differences |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 0 | 0 | 0 |
| 2 | 5 | 0 | 0 | 0 | 0 |
| 3 | 0 | 0 | 0 | 0 | 0 |
| 4 | 6 | 0 | 0 | 0 | 0 |
| 5 | 0 | 0 | 0 | 0 | 0 |
| 6 | 10 | 0 | 0 | 0 | 0 |
| 7 | 0 | 0 | 0 | 0 | 0 |
| 8 | 5 | 0 | 0 | 0 | 0 |

Copied-state SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
Private-checkout working-tree changes: 0. The copied source hash is unchanged.

| Private measurement | START | Candidate |
| --- | ---: | ---: |
| Request seconds, median [min–max], 8 requests | 13.236 [8.570–19.448] | 9.667 [8.796–12.223] |
| Whole run, seconds, 1 trial | 220.855 | 166.180 |
| Sampled child-tree peak RSS, MiB, 1 trial | 4,687.7 | 4,636.5 |

The quick suite ran concurrently, so timings
are diagnostic and do not establish a performance improvement. Public timings
use three paired trials. Private task counts use one paired eight-evaluation
sample; latency medians/spread describe those eight requests, not repeated
identical trials. Peak RSS samples include the whole measurement child tree
(including its calculator), not just the calculator heap.

## Files changed

- `app/data/unknown-drop-estimates.v1.mjs`: cited wiki facts and separate authored estimates.
- `app/data/settings.mjs`: rule, validation, explanation and supported-behaviour metadata.
- `app/tasks/rule-defaults.mjs`: authored automatic value of 3.
- `app/tasks/unknown-drop-warnings.mjs`: advisory dependency calculation and warning text.
- `app/tasks/engine.mjs`: ordinary-task annotation after eligibility is computed.
- `app/tasks/collection.mjs`: collection-goal annotation after goal generation.
- `app/tasks/equipment.mjs`: equipment-goal annotation after ranking.
- `app/web/rules-model.mjs`: adjacent control placement and help text.
- `tests/unknown-drop-warnings.test.mjs`: synthetic sources, alternatives, recipes, cycles, cache hits, completed prerequisites and settings.
- `tests/settings.test.mjs`: retain original transcription checks and verify the additional authored default.
- `tests/rule-explanations.test.mjs`: verify coverage of both authored additions.
- `scripts/test-selection.mjs`: classify the new test in the quick suite.
- `scripts/perf/unknown-drop-inventory.mjs`: source-input exposure counts.
- `scripts/perf/r3-rare-drops.mjs`: public/private paired comparison and measurement.
- `docs/qa/r3-rare-drops.md`: discovery, evidence, implementation and verification record.

## Risks and recommendation

The checks are bounded samples, not exhaustive calculator parity. Timings had
variable concurrent test load; the lower private request time is not evidence of
a speed improvement. Peak RSS is sampled every 50 ms from Linux `/proc` and can
miss shorter peaks; it includes measurement-state retention and relay processes.
Conditional requirement alternatives without a selected proof conservatively get
no warning. Move-on figures are authored advice, not measured wiki probabilities
or guarantees of completion.

All requested task/pool difference checks are zero apart from the warning gains.
Recommendation: **MERGE-CANDIDATE**.
