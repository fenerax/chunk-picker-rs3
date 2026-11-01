# R2: travel and reward unlocks wait until useful

START: `e431da314b682946c27f601ec78f17eab8a790eb`
Branch: `rule/r2-travel-waits`
Survey date: 2026-11-01; Node v24.21.0.

The initial survey is retained below. Implementation follows the orchestrator's
2026-11-01 decisions and supplied Wiki excerpts/revision ids. This sandbox still
cannot fetch the Wiki; the revision evidence was supplied in the task, not
independently fetched here. No private data was copied into this checkout.

## Reproduce the public survey

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version # must be 24.20 or newer
node scripts/perf/r2-travel-survey.mjs
```

Use the tracked legacy dataset, without private pack or game-default overrides.
The script rejects private overrides and packed providers. It reads the tracked
original definitions and uses the current definition preparation pipeline and
reviewed overlays. There are 20,375 raw challenge rows and 20,436 prepared rows.
Counts below are category/label rows; repeated activities in different skill
categories and their collection objectives count separately.

The survey identifies candidates, not a production label-matching policy.
It examines labels, `Category`, `Chunks`, `Objects`, `NPCs`, `Shops`, `Items`,
`Output`, `Output Object`, `Tasks`, and the transport catalogue. There is no
single travel-unlock tag or task-to-route id shared across these sources.
General quest completion and clues mentioning transport are outside this
inventory; the travel-specific tasks they support are inventoried separately.

## Travel candidates

| Kind | Rows | Rows with explicit `Chunks` | Identification |
| --- | ---: | ---: | --- |
| Permanent travel unlocks | 14 | 10 | Extra, Permanent Unlockables, travel-specific labels; cosmetic excluded |
| House portal location unlocks | 7 | 7 | Construction, Unlock house portal |
| Orthen device activations | 7 | 7 | Activate device, across four skill categories |
| Balloon flights | 5 | 5 | Firemaking, Use Balloon transport system |
| Spirit tree planting/building | 3 | 0 | Grow/Construct spirit tree, Farming and Construction |
| House fairy ring | 1 | 0 | Construction build row |
| Lodestone activations/build | 30 | 30 | 29 individual Diary rows and one Construction row |
| Other travel furniture builds | 12 | 0 | Construction portals, nexus variants, teleport stone |
| Glider area helper | 1 | 0 | Nonskill helper with UnlocksArea |
| **Total candidates** | **80** | **59** | |

The 14 permanent unlocks comprise four balloon wrappers, four device unlocks,
one Max Guild attunement unlock, and five other portal/tablet unlocks. The
lodestone total excludes the aggregate achievement. The seven skill activation
rows represent four devices, separate from their four Extra objectives.

Related rows counted separately: 39 teleport spell casts, four canoe builds,
three portal-network research rows, one aggregate lodestone achievement, and
one cosmetic teleport unlock. These are not silently included as permanent
travel unlocks. Spell casts and canoe crafting are use/build actions; research,
quest, and aggregate dependencies need review before extending R2 to them.
There is no separate labelled fairy-ring-network unlock objective in this
candidate set. The glider helper is an area helper, not proof of a standalone
route-attunement task.

All 59 rows with `Chunks` have at least one location resolvable through the
tracked chunk/section data. A section id must be resolved through `sections`;
treating it as a missing top-level chunk would incorrectly mark 31 rows unknown.
Location presence does not prove that an existing requirement has the intended
origin/destination semantics or that adding another gate changes a result.

The other **21** rows have no explicit `Chunks`. Sixteen are furniture/tree
builds with object requirements rather than explicit endpoint lists. The other
five are Max Guild attunement, ancient teleport tablet crafting, Runespan portal
redirection, the all-teleports nexus objective, and the glider area helper.
These are examples from public tracked definitions. Do not infer endpoints from
a shop location or prose alone. The nexus objective has an indirect furniture
object requirement; the glider helper names an area it unlocks. Neither is an
explicit destination/origin list. An implementation must resolve verified map
or transport links first and leave genuinely unresolved rows unchanged.

The public transport catalogue contains 182 stations and 310 routes, including
30 balloon, eight glider, six canoe, 27 lodestone, 26 teleport and two portal
routes. Its stations provide chunk coordinates for balloon endpoints, including
the origin named in the brief. Its route requirements describe already-unlocked
travel; they do not directly identify challenge rows. Existing catalogue Wiki
links are provenance to revisit, not newly fetched factual verification.

## Reward candidates

| Kind | Rows/entries | Identification |
| --- | ---: | --- |
| Furniture plan collection objectives | 48 | Extra, Furniture Plans prefix, exact plan in Items |
| Construction plan unlock objective | 1 | Construction, Unlock Furniture plans |
| Furniture plan output helpers | 4 | Non-Construction rows with Furniture plans in Output |
| Furniture plan shop entries | 18 in 8 shops | shopItems item names; all 18 have collection objectives |
| Cannon upgrade objectives | 4 | Three obtain-item objectives and one all-three-upgrades unlock |
| Base cannon setup task | 1 | Ranged setup row requiring all four base parts |
| Base cannon part shop entries | 4 | Exact setup-part item names in shopItems |

There are **53 furniture objective/source rows** (48 + 1 + 4), plus 18 shop
entries that overlap that inventory. All 48 collection plans match at least one
Construction row by an exact required item. The four helper rows produce plans;
they are not four additional unique furniture rewards. Ordinary furniture builds,
hand cannons, ammunition, a furniture depacker, and generic building materials
are not reward unlocks in these counts.

Existing build rows provide Construction `Level`, `Skills`, `Objects` and
sometimes prerequisites. Requiring the complete matching build task as a plan
unlock prerequisite would create a cycle: that build already requires the plan.
Plan learning stays separate and unchanged. The 48 matching furniture builds
retain their existing plan-item, material, Construction level and prerequisite
requirements. Cannon setup already has an item-requirement path; its obsolete
four-part data is recorded below rather than repaired in this rule change.

## Implemented behavior and revision evidence

`Early Travel Unlocks` defaults to false, including existing saves with no
explicit value. Its player-facing text is: "Travel and reward unlocks can be
chunk tasks before you can use them". It is an independent personal rule; disabling Permanent
Unlockables does not disable this option for furniture or cannon conversions. Turning it on removes the new waiting gates. Recipe, shop, material, skill,
membership and usable-workbench requirements still apply in both modes.

| Scope | Behavior with the rule off | Wiki revisions supplied by the orchestrator |
| --- | --- | --- |
| Four balloon unlock wrappers | Require reachable Entrana, not the landing chunk. Inline the corresponding flight's existing supplies, NPC, skill and prerequisites instead of depending on its destination-gated use row. This destination correction applies in both modes; Early Travel Unlocks removes the new origin-chunk gate. The five Firemaking use rows stay unchanged. | [Balloon transport system 36927642](https://runescape.wiki/w/Balloon_transport_system?oldid=36927642) |
| Max Guild garden portal attunement | Require the mapped origin or destination to be reachable. Existing shop checks remain. | [Skill portal 37165985](https://runescape.wiki/w/Skill_portal?oldid=37165985), [locations 36984771](https://runescape.wiki/w/Template:Skill_portal_locations?oldid=36984771), [Dinosaur Farm 37218892](https://runescape.wiki/w/Anachronia_Dinosaur_Farm?oldid=37218892) |
| All-teleports nexus objective | Require every mapped destination clause. This is one existing aggregate task, not 43 separate tasks; it becomes due only when all known clauses are reachable. No new objectives or identities are introduced. | [Portal nexus 37204416](https://runescape.wiki/w/Portal_nexus?oldid=37204416), [teleports template 37125092](https://runescape.wiki/w/Template:Portal_Nexus_Teleports?oldid=37125092) |
| Three cannon objectives | The combined Golden/Royale/Restocking unlock and gold/royale item objectives wait for an available base cannon, the existing setup task, or admitted non-shop evidence of another cannon variant. Legacy conversion shop stock cannot prove its own prerequisite. The upgrade-kit drop objective stays unchanged. No separate kit-use row exists to gate. | [Dwarf multicannon 37197227](https://runescape.wiki/w/Dwarf_multicannon?oldid=37197227), [gold 37014464](https://runescape.wiki/w/Gold_dwarf_multicannon?oldid=37014464), [royale 37014790](https://runescape.wiki/w/Royale_dwarf_multicannon?oldid=37014790), [shop stock 37032396](https://runescape.wiki/w/Template:Artisans%27_Workshop_Reward_Shop_stock?oldid=37032396), [kit 36496285](https://runescape.wiki/w/Dwarf_multicannon_upgrade_kit?oldid=36496285) |
| 48 furniture build recipes | Keep all recipe checks and allow a usable house workbench: wooden through level 20, steel framed through 60, reinforced steel framed at any recipe level. The ordinary Rimmington Furniture workbench supports every recipe. Blocked recipes get a plain waiting reason. All 53 plan-learning/source objectives stay unchanged. | [Furniture plans 37180541](https://runescape.wiki/w/Furniture_plans?oldid=37180541), [Furniture 37187279](https://runescape.wiki/w/Furniture?oldid=37187279), [workbench 37199289](https://runescape.wiki/w/Furniture_workbench?oldid=37199289) |

Construction was reworked on 13 July 2026. Rooms and hotspots are no longer
recipe requirements: [Construction 37207458](https://runescape.wiki/w/Construction?oldid=37207458),
[Player-owned house 37199765](https://runescape.wiki/w/Player-owned_house?oldid=37199765),
and [historical Hotspot 37173647](https://runescape.wiki/w/Hotspot?oldid=37173647).
The plan source says "The furniture can be unlocked at any time, but can only
be constructed once the player reaches the required Construction level."
The engine's existing planning model treats obtainable prerequisites as
capabilities; this change does not add an inventory or learned-plan ledger.

The waiting reasons are "Waiting until Entrana is reachable", "Waiting until a
destination or the portal is unlocked", "Waiting until a destination is
unlocked", "Waiting until a cannon is available", and "Waiting until you can
build it". Existing detailed recipe blockers remain available underneath.

### Map checks

The supplied surface coordinates reproduce the stated region ids with
`((x >> 6) << 8) | (y >> 6)`. These regions exist in the tracked map:
Entrana (2808,3355) -> 11060; Max Guild garden (2276,3319) -> 9011;
Dinosaur Farm teleport landing (3665,4294) -> 14659. Their map nicknames agree
with the intended locations. The farm's infobox-centre alternative 14403 is
absent and is not used. The transport catalogue's Entrana balloon station also
uses 11060. No surface formula was applied to an instanced-map coordinate.

The nexus template identifies 37 base spell destinations plus five alternate
achievement destinations. Of the base spells, 35 have map-resolvable `Chunks`
in the current definitions. Those existing spell locations supply the gates;
no tile coordinates were invented. Moonclan and Mazcab lack a location list.
The five alternate destinations have no separate mapped spell row, and the
43rd destination was not verified by the supplied parser. These eight unresolved
destinations add no gate. Their existing aggregate quest/item requirements stay.

### Deliberately unchanged and unresolved

- Plan learning and buying stay separate from construction. The existing
  Construction level on the Ritual marker unlock is retained; its purchase
  itself needs 75 Construction ([stock 37224591](https://runescape.wiki/w/Template:Dungeoneering_rewards_stock?oldid=37224591)).
- Stone planter stays at the dataset's level **64**. The plan-list revision
  [37222486](https://runescape.wiki/w/Template:Furniture_plans_list?oldid=37222486)
  says 32, while the [recipe 37180445](https://runescape.wiki/w/Stone_planter?oldid=37180445)
  says 64. This conflict remains unresolved.
- The base cannon setup still names four parts. [Dwarf multicannon 37197227](https://runescape.wiki/w/Dwarf_multicannon?oldid=37197227)
  says they were merged into a single item in 2021 and are no longer obtainable.
  The dataset still supplies the four parts through a shop. This is a separate
  data correction; no part/shop/quest data was rewritten here.
- Whether Artisans' Workshop refuses early purchases, or consuming the kit
  requires a cannon/quest, remains unverified. The new usefulness rule is the
  players' decision; it is not presented as a new server-side purchase check.
- Ancient tablets are a crafting unlock and stay unchanged ([Magic tablet
  37198114](https://runescape.wiki/w/Magic_tablet?oldid=37198114)).
  Tablet crafting Magic levels and the Ghorrock Wilderness level remain unverified.
- Runespan redirection stays unchanged and already requires its shop and level.
  Its `portal redirection` Wiki link wrongly resolves to War's Retreat. The
  correct reference is [Runespan portal 36774268](https://runescape.wiki/w/Runespan_portal?oldid=36774268).
  The Runespan interior mapping remains unverified; neither link nor mapping was repaired.
- Orthen and Stormguard activation remains in place, with existing requirements.
  Moksha's separate-map coordinates and which four Stormguard platforms are
  inactive remain unverified ([Orthen device 37179237](https://runescape.wiki/w/Orthen_teleportation_device?oldid=37179237),
  [Stormguard portal 36854655](https://runescape.wiki/w/Stormguard_portal?oldid=36854655)).
- Spirit trees, fairy rings, gliders, lodestones and house portals stay unchanged.
  Unverified details remain: the generic spirit-tree patch and Etceteria boat
  access; Anachronia/City of Um coordinate spaces; Dylandra glider access; a
  post-rework house-portal unlock flag and non-wood house-portal furniture levels.
  The Grand Tree balloon landing's extra access restrictions also remain unverified.
- Unverified reward details stay unchanged: Guthix altar's exact automatic
  dependencies, which rugs count for the decorative aggregate, house-workbench
  build levels, plan drop rates, and the base quest's own requirements.

## Files changed

| File | Change |
| --- | --- |
| `app/data/settings.mjs` | Independent personal rule, default, plain text, explanation and revision links. Metadata stays in an existing browser-served module. |
| `app/data/travel-reward-gates.mjs` | Reviewed selectors, first-flight requirements, workbench tiers, mapped nexus clauses and revision index. Engine-only helper. |
| `app/tasks/engine.mjs` | Personal rule variants, eligibility gates, safe cannon evidence and waiting reasons inside the existing closure. |
| `app/tasks/rule-defaults.mjs` | Authored default false for unset saves. |
| `app/web/rules-model.mjs` | Include the new rule's explanation. |
| `tests/travel-reward-gates.test.mjs` | Synthetic gates, rule on/off, persistence, per-member isolation, closure, cannon self-dependency protection and workbench boundaries. |
| `tests/settings.test.mjs` | Keep retained-source counts pinned while checking the new authored default. |
| `tests/rule-explanations.test.mjs` | Count and validate both authored rule explanations. |
| `scripts/test-selection.mjs` | Classify the new test in quick. |
| `scripts/perf/r2-travel-survey.mjs` | Reproducible public-only survey. |
| `scripts/perf/r2-travel-check.mjs` | Explicit START comparisons, safe private sampling, task signatures, option-on controls and process-tree memory sampling. |
| `docs/qa/r2-travel-waits.md` | Survey, evidence, limits and measured validation. |

## Validation and comparisons

Final validation on Node v24.21.0:

- Touched and directly affected test files: **54 passed, 0 failed** across
  travel-reward-gates, settings, rule-explanations, automatic-rule-defaults,
  slayer-unlock-gates and browser-module-graph.
- `npm run test:quick`: **2,997 passed, 0 failed, 68 skipped**; 3,065 total,
  457.046 seconds. Existing skip conditions were unchanged.
- The previously failing restore case passes in isolation: **1 passed, 0 failed**.
  Its release fixture uses `git ls-files`, so new modules must be staged before
  running that test. No operator code or restore assertion was changed.
- Both measurement scripts pass syntax checking; the public survey reproduces
  80 travel candidates, 53 furniture objective/source rows and four cannon candidates.
- `git diff --cached --check` passes. Full `npm test` was not run.

The initial quick attempt found the new browser dependency, authored-rule count
expectations, and the unstaged module missing from the release fixture. The
browser metadata moved into the existing settings module, the expectations now
include the new authored rule, and all new files were staged. No tests were
weakened to pass.

### Public comparison against START

Three paired trials use three generated states and five member evaluations per
trial. Every trial gives the same differences. Rows are compared including their
requirements, blockers, explanations and status; this is a bounded task comparison,
not the full calculator or roll-forecast corpus.

"Newly waiting" means available at START and blocked by the new waiting policy
afterwards. "New waiting reason" includes tasks that were already blocked by
another requirement. Metadata-only corrections count as changed rows too.

| State | Added | Removed | Changed | Status changes | Newly waiting | New waiting reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 57 | 0 | 0 | 57 |
| 1 | 0 | 0 | 114 | 0 | 0 | 114 |
| 2 | 0 | 0 | 113 | 0 | 0 | 113 |

Total changed rows per trial: **284**.
Attribution: attunement 4, balloon 20, cannon 15, furniture 240, nexus 5. There are no differences outside those groups.
The option-on control changes **20** rows, all balloon requirements;
there are no status changes. The first-flight destination correction applies in
both modes, so the option-on control is intentionally not a golden START output.

### Private sample (counts only)

The copied current save plus the first seven validator-accepted historical
backups give **8 states and 16 member evaluations**. A separate complete archive
validation found **9 accepted and 405 rejected out of 414**; the sample therefore
does not represent the full archive. No validator was bypassed or weakened.
State 7 is the current save; states 0–6 are the selected historical documents.
Only temporary copies under `/tmp` were opened. The lab checkout stayed unchanged.

One paired before/after batch gives:

| State | Added | Removed | Changed | Status changes | Newly waiting | New waiting reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 12 | 0 | 0 | 4 |
| 1 | 0 | 0 | 8 | 0 | 0 | 0 |
| 2 | 0 | 0 | 8 | 0 | 0 | 0 |
| 3 | 0 | 0 | 8 | 0 | 0 | 0 |
| 4 | 0 | 0 | 8 | 0 | 0 | 0 |
| 5 | 0 | 0 | 8 | 0 | 0 | 0 |
| 6 | 0 | 0 | 8 | 0 | 0 | 0 |
| 7 | 0 | 0 | 110 | 0 | 0 | 110 |

Total changed rows: **170**.
Attribution: attunement 4, balloon 64, cannon 2, furniture 98, nexus 2. No other task groups differ.
The refreshed option-on control covers all **16 evaluations** and changes
**64** rows, all balloon requirements, with
**0 status changes** and no new waiting reasons.
No task becomes newly waiting in either corpus; these sampled tasks were already
blocked. The synthetic tests exercise the actual availability transitions,
including Entrana-only unlocks, unknown destinations, cannon supply and tier limits.

### Durations and peak memory

Brackets show minimum and maximum. Public batch figures are medians across three
trials, each containing five member evaluations. Private evaluation figures are
medians across 16 requests in one paired batch, not repeated-trial medians.

| Measurement | START | Candidate |
| --- | ---: | ---: |
| Public batch seconds, median [min, max] | 45.188 [32.283, 46.442] | 44.862 [34.660, 48.557] |
| Public peak process-tree MiB, median [min, max] | 2230.883 [2188.547, 2295.289] | 2212.348 [2193.246, 2239.375] |
| Private evaluation seconds, median [min, max] | 12.390 [2.640, 18.515] | 14.770 [3.490, 25.735] |
| Private whole-batch seconds, one trial | 269.312 | 310.883 |
| Private peak process-tree MiB, one trial | 4593.863 | 5307.578 |

RSS is sampled every 50 ms and sums the comparison parent and its calculator
processes. It includes pack preparation and retained input states, and can miss
short peaks. Each private calculator ran serially. Other test/public workloads
were active, and the private pair was not repeated, so these timings and memory
figures do not establish a causal performance regression or improvement. The
higher observed private duration and peak memory remain a measurement limitation.

Reproduce after creating an untouched worktree at START:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/r2-travel-check.mjs --baseline /tmp/r2-start --candidate . --out /tmp/r2-public.json --runs 3
```

For the private sample, configure the pack/default/process environment described
by the lab README and add `--data-dir /tmp/copied-game --runs 1`. The script
requires a `/tmp` copy, hashes its selected input documents, validates each
snapshot and emits only counts, hashes and measurements.

Remaining limits are the eight unmapped nexus destinations, the Stone planter
conflict, obsolete cannon data, the unverified facts listed above, and the
restricted historical sample. They are deliberately unchanged as directed.

Recommendation: **MERGE-CANDIDATE**.
