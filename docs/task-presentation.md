# Task presentation

`app/tasks/presentation.mjs` is authored code. It reads the new engine's evaluated rows and the retained declarative definitions; it does not run or copy the original frontend or worker. Reference behavior was inspected in upstream `reference/original-picker/worker.js` (`calcCurrentChallenges2`, input-method selection and ordinary equipment comparison) and `reference/original-picker/index.js` (`setupCurrentChallenges`), version 6.9.68.

## Active-task selector

```js
const presentation = selectPresentedTasks(result, state, memberId, definitions);
```

The return value contains:

- `tasks`: a subset of the exact engine row objects, in catalogue order.
- `alternatives`: JSON object mapping a selected task ID to equally demanding peer IDs.
- `suppressed`: JSON object mapping omitted task IDs to display reasons.
- `effectiveLevels`: task IDs mapped to required levels after supported boosts.
- `diagnostics`, `metrics` and `coverage`: selection counts and explicit limitations.

Use this subset for Active Chunk Tasks. Keep `result.tasks` for search, possible-task inspection, completion/backlog views and blocker explanations. Selection does not change eligibility, source production, personal completion, or saved state.

The active view excludes unavailable, engine-hidden, completed, backlogged and never-show rows. It shows one highest effective-level goal per skill; lower numeric `Priority` wins a tie, then a primary method wins an otherwise equal tie. Same-level alternatives remain inspectable. A satisfied skill goal suppresses active goals at an equal or lower effective level. This uses the evaluator's group challenge satisfaction and never converts another member's checkmark into personal game completion.

The upstream **Highest Level** setting controls competing processing methods sharing an available input before choosing the skill goal. With it off, the selector retains the lowest method for each resolved input, including aliases and excluding declared tools. With it on, every eligible method participates in selecting the one highest skill goal. Unrelated extras are never capped by category.

Whole-quest display uses the presence of `QuestPoints`, including zero-point miniquest completions. `ManualShow` does not exempt an intermediate quest step. Whole-achievement display uses `ManualShow` for completion tiers. `Show Skill Tasks`, `Show Quest Tasks`, `Show Diary Tasks`, partial products, herb cleaning, shortcuts and equipment visibility are separate display filters. Nonskill access/source prerequisites stay in the catalogue and are hidden from the active list unless explicitly requested.

Before gameplay conversion, task rules resolve legacy map rules, state rules and member rules in that order; typed task flags take precedence over legacy backlog/completion flags. Once `hasGameplayMigration(state, member)` confirms this owner and source map were converted, authored rules and status are authoritative. Missing or false authored values do not revive retained legacy settings, checkmarks, backlog flags or alternatives. This makes profile clearing and task unchecking durable while keeping the import payload intact as provenance. Preferred alternatives can be supplied as `member.taskAlternatives[skill][effectiveLevel] = taskId`; unmigrated legacy `altChallenges` is also read. A preference must identify an available peer at the same effective level.

Numeric boosts, percentage boosts and the construction crystal saw are ranked using available source evidence and per-task boost bans. Percentage ranking uses the target level and then recalculates at the reduced level, matching the reference's task-goal comparison. XP-based boost formulas are reported as unsupported ranking inputs.

## Ordinary equipment comparisons

```js
const potential = buildEquipmentCatalogue(definitions);
const gear = selectEquipmentRecommendations(result, rules, definitions);
```

`buildEquipmentCatalogue` creates potential category-qualified BiS IDs for every equipment definition, including weapons and ammunition. These plain catalogue records make saved IDs and future task commands resolvable; they assert no availability.

`equipmentTaskIdentity(name, rawEquipmentRecord)` is exported for other equipment evaluators. It preserves `formatted_name` or uses the lower-case item name and the upstream a/an/plural article in `Obtain … ~|item|~`. Stable IDs use the same category-qualified ID scheme as the task engine.

`selectEquipmentRecommendations` consumes only engine-confirmed equipment and the effective rules supplied by its caller. It performs no legacy-state merging; state-aware callers must apply the same conversion authority guard. For ordinary armour and accessories it compares style damage plus 0.15 times style accuracy, then armour, then life points. Prayer comparisons use prayer bonus. This deliberately allows tier-zero rings and amulets to outrank higher-tier items with weaker relevant bonuses. Equipment class restrictions and consumable-primary/display rules apply. Exact score ties remain alternatives.

`Non-permanent BiS` defaults on. When disabled, reviewed temporary or dust-degrading equipment is removed before scoring so permanent replacements can win. The active-task selector also suppresses generated BiS rows for excluded equipment. Repairable or rechargeable gear and ammunition remain included; the full potential catalogue and saved completion records retain their identities.

The equipment return contains `recommendations` with style, slot, score, the original equipment row and alternative item names; `tasks` with generated chosen BiS rows; `catalogue` with chosen rows and their tied alternatives; and ID-based `alternatives`, diagnostics and coverage. Generated rows can be appended to an engine result and passed through the active-task selector so the same completion/backlog rules apply. Equipment search should retain the full evaluated equipment array.

## Boundaries and verification

The selector does not claim exact parity for recursively expanded nonskill processing inputs, processing dependencies requiring a highest-task link, XP-based boosts, or displaying a cross-skill prerequisite again under another skill heading. Opaque processing recipes are retained and diagnosed rather than discarded. The original evaluator's processing/backlog substitution and source graph contain additional exceptions that require captured comparisons.

The ordinary equipment helper does not rank weapon/shield/ammunition loadouts, tank-only views, weight gear, or bespoke skilling/relic gear. Unsupported weapon-related items receive diagnostics. A separate equipment evaluator may combine these ordinary comparisons with a coupled loadout scorer. Neither tier sorting nor the potential catalogue is evidence that an item is BiS or reachable.

`node --test tests/presentation.test.mjs` covers highest goals, priority/primary ties, input-method pruning, aliases, quest and diary completion display, completion thresholds, backlog fallback, boosts/bans, alternatives, non-mutation, real engine source retention, ordinary gear scoring/identity, and conversion authority after unchecking tasks or clearing profile settings. These are synthetic unit and integration checks, not a claim of human validation or complete upstream parity.
