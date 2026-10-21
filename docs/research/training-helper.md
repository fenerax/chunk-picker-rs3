# F2P training helper research

Catalogue review: 2026-10-08. This is a RuneScape 3 F2P catalogue for Player 1 and Player 2's chunk duo Group Ironmen. The catalogue uses Wiki web search and primary RuneScape Wiki item/F2P guide pages, with pinned revisions wherever extraction exposed them. It includes no P2P training guide or Old School RuneScape source.

## Catalogue scope and evidence

The catalogue contains **114 methods across 28 trainable skills**, plus an explicit **unavailable Invention** skill record. Its 29 skill records cover the complete RS3 skill list. There are 82 attributed sources, 59 methods with at least one hourly profile, and 28 methods whose hourly processing figures are explicitly authored models. The remaining 55 methods retain unknown hourly throughput. Those counts describe coverage, not 114 independently measured or fully supplied training routes. Two timed Runecrafting routes additionally require a teleport unlock that is not saved as a personal fact.

F2P members-skill trials stop at level 5, except Construction, Archaeology and Necromancy at 20. Invention cannot be unlocked in F2P. No additional lamp XP is assumed after a cap. These limits are sourced from [Skills](https://runescape.wiki/w/Skills?oldid=37157524).

The [13 October Divination supplement](divination-training-2026-10-13.md) adds
14 members method records to the planner and Area check: all 13 wisp tiers,
including pale continuation, plus Colossi at 77. Spring and enriched alternatives
share their tier's entry level. The F2P pale trial retains cap 5. The separate
authenticated catalogue listing and death estimator retain the F2P file. No new
Divination hourly rates are claimed.

| Skill | Availability / F2P cap | Methods | Methods with hourly profile |
| --- | --- | ---: | ---: |
| Attack | trainable / 120 | 3 | 0 |
| Strength | trainable / 120 | 3 | 0 |
| Defence | trainable / 99 | 3 | 0 |
| Constitution | trainable / 99 | 3 | 0 |
| Ranged | trainable / 120 | 3 | 0 |
| Prayer | trainable / 99 | 4 | 2 |
| Magic | trainable / 99 | 6 | 3 |
| Runecrafting | trainable / 110 | 5 | 2 |
| Crafting | trainable / 110 | 7 | 7 |
| Mining | trainable / 110 | 8 | 8 |
| Smithing | trainable / 110 | 10 | 6 |
| Fishing | trainable / 99 | 7 | 2 |
| Cooking | trainable / 99 | 3 | 3 |
| Firemaking | trainable / 110 | 10 | 3 |
| Woodcutting | trainable / 110 | 7 | 3 |
| Fletching | trainable / 110 | 12 | 12 |
| Dungeoneering | trainable / 120 | 1 | 0 |
| Agility | trial / 5 | 1 | 1 |
| Herblore | trial / 5 | 2 | 1 |
| Thieving | trial / 5 | 1 | 0 |
| Farming | trial / 5 | 1 | 0 |
| Hunter | trial / 5 | 1 | 0 |
| Slayer | trial / 5 | 1 | 0 |
| Divination | trial / 5 | 1 | 0 |
| Construction | trial / 20 | 3 | 3 |
| Archaeology | trial / 20 | 2 | 2 |
| Summoning | trial / 5 | 2 | 0 |
| Invention | unavailable / 1 | 0 | 0 |
| Necromancy | trial / 20 | 4 | 1 |

Multiple tiers include copper through runite mining; normal/oak/willow plus teak/maple/acadia/yew cutting; corresponding firemaking actions; fishing food versus power-fishing choices; gems versus flax/jewellery; platebodies; and capped introductory trial methods. Membership is a property of the actual source location as well as the recipe. A F2P method does not authorise an inaccessible region.

## Dated economics

The price snapshot file retains the exact API request, returned item IDs, guide prices, volumes and timestamps. It was fetched on **2026-10-08**, but its 94 returned prices are dated **2026-10-07T21:06:38Z**. Four requested untradeable/unavailable prices are null. There are **63 numeric net GP/action comparisons**, including zero material cost for bait-free crayfish power fishing. Coins use their intrinsic one-GP face value; alchemy payouts come from the item page, not a GE price. All other net economics remain null.

The provider is the [Weird Gloop RS3 GE guide-price API](https://api.weirdgloop.org/exchange/history/rs/latest). It returns Jagex guide prices, not executable buy/sell offers. Each method's net reference is fixed output value minus consumed input value, before GE tax. For this ironman duo it means opportunity cost; it does not assume purchasing supplies, selling the output, unlimited shop stocks, or that a reachable item is already owned.

Examples from that snapshot:

- Spin flax: 627 GP bowstring − 76 GP flax = **551 GP/action**.
- Sapphire necklace: 3,382 − 2,263 gold bar − 304 sapphire = **815 GP/action**.
- Oak line fire or bonfire: **−1,013 GP/log** in consumed material value.
- Spirit wolf/dreadfowl economics remain unknown because the required gold charm is untradeable.

Power-fishing profiles explicitly drop all catches and retain no fish output. Separate banked-fish variants have an output value but unknown hourly throughput. Mining rates do not imply an ore/hour yield: damage-based swings and variable output leave quantity and net GP/action unknown.

## Rates and limits

[F2P Mining training](https://runescape.wiki/w/Free-to-play_Mining_training?oldid=37176494) supplies contextual 5,000–60,000 XP/hour profiles. They assume an appropriate pickaxe, stamina and rockertunities; tool access is not proof of those rates. Ore XP/action is deliberately null. The original Woodcutting profiles and their separate assumed two-second handling penalty remain compatible with task-time estimates; the source guide is marked obsolete after Grove changes.

[F2P Fishing training](https://runescape.wiki/w/Free-to-play_Fishing_training?oldid=37189069) supplies dropped-catch profiles only. Its broad trout/salmon 17,000–67,000 range is not turned into an invented level curve. [Bowstring](https://runescape.wiki/w/Bowstring?oldid=37198222) gives the local Lumbridge bank-and-spin cycle. [F2P Crafting training](https://runescape.wiki/w/Free-to-play_Crafting_training?oldid=37052646) supplies maximum-context gem/jewellery profiles; the notes identify them as upper planning context.

Modelled fixed-recipe hourly figures use the sourced action interval and base XP multiplied by **80% uptime**. That factor is an explicit authored assumption for interface/banking/repair overhead, not an in-game measurement. These processing figures exclude gathering their inputs and travel outside the facility. Archaeology restoration rates, for example, do not cover excavating a damaged artefact or gathering its materials. Total self-supply time remains unknown wherever those steps lack data.

Cooking has no hourly profile below the ordinary-range no-burn threshold: crayfish 34, trout 49, lobster 74. Successful-cook XP does not become expected XP per attempt when burning is possible. Cooking economics remain null without a success/yield model.

[F2P Smithing training](https://runescape.wiki/w/Free-to-play_Smithing_training?oldid=37075358) supplies a 1,200–1,400-bars/hour smelting operating cycle including depositing/restarting. Six smelting tiers use the conservative 1,200 baseline and current per-bar recipes. That is slow training but covers early levels without inventing platebody heat/progress timing. The iron recipe now consumes two ores, as confirmed by [Iron bar](https://runescape.wiki/w/Iron_bar?oldid=37017984).

[F2P Prayer training](https://runescape.wiki/w/Free-to-play_Prayer_training?oldid=37157797) supplies 1,118 treated incense sticks/hour: 8,944 Prayer XP/hour for impious wooden sticks and 22,360 for accursed maple sticks. Their Firemaking requirements are 1 and 40; the extra Firemaking XP is excluded from the Prayer total. Stick/ash acquisition remains extra work. Bury/scatter attempt timing was not established, so those actions retain unknown hourly rates.

Noncombat Magic avoids stale combat hourly figures. [Amulet of magic](https://runescape.wiki/w/Amulet_of_magic?oldid=36963109) supplies the level-7 enchant recipe, 17.5 XP and two ticks. [Low Level Alchemy](https://runescape.wiki/w/Low_Level_Alchemy?oldid=37044060) supplies level 21, 31 XP and three ticks; [High Level Alchemy](https://runescape.wiki/w/High_Level_Alchemy?oldid=37143695) supplies level 55, 65 XP and five ticks. At the explicit 80% uptime assumption these model 42,000, 49,600 and 62,400 XP/hour. Material production is excluded. Alchemy on the chosen rune platebody yields current 1,667/2,500 coins and is a costly opportunity-cost example; a different supplied item changes its economics.

[Crafting air runes (F2P)](https://runescape.wiki/w/Money_making_guide/Crafting_air_runes_(free-to-play)?oldid=37016957) supplies 2,436 essence/hour with a charged skull sceptre and War's Retreat Teleport, giving a conservative 12,180 base XP/hour before ring/Savvy bonuses. The body-rune F2P guide supplies level-based 25,200–100,800 XP/hour at its 30-second inventory-cycle edge. Both routes have an explicit unsupported teleport-unlock requirement and stay gated until that personal unlock is proved. Access to War's Retreat alone does not prove its teleport is unlocked. Ordinary walking cycles and low-level Runespan effective rates remain unknown; level-99 node rates are not presented as level-1 rates.

The [melee guide](https://runescape.wiki/w/Free-to-play_melee_training?oldid=37024931), [Ranged guide](https://runescape.wiki/w/Free-to-play_Ranged_training?oldid=37183914), and Magic guide flag stale combat XP. Current monster pages provide per-kill XP; gear, food, ammunition/runes and kill throughput remain unknown. Dungeoneering's F2P guide flags the Remastered changes: prestige, party and floor XP are not assigned fabricated constants. Trial Slayer additionally needs an active cow assignment; access to Turael proves no such assignment.

## Data contract and checks

Schema version 2 keeps the original 21 method IDs, task `matches`, recipe XP, legacy `input`/`output`, tick intervals and rate profiles. New records use `matches: []` when no legacy task binding has been reviewed.

- `skills`: skill name, F2P cap, availability, source IDs and notes.
- `methods`: minimum/maximum level, members flag, nullable XP/action and XP/hour, source IDs, assumptions and an estimate-quality label.
- `requirements`: task-engine selector objects with `kind`/`name`, optional `anyOf`; tutorials, personal quests and assignments are explicit gates.
- `inputs`/`outputs`: quantities per declared action; null represents variable/unknown quantity. Tools belong to requirements instead of consumed inputs.
- `economics`: nullable GP/action, actual price date, source IDs and interpretation.
- `sources`: dated primary links, available revision IDs and attribution. A pinned page revision pins text facts; rendered GE templates can update independently, so the retained API snapshot owns price provenance.

Catalogue tests check all-skill/trial-cap coverage, source references, primary-source URLs, exact price arithmetic, null treatment, disposal versus throughput, no-burn rate gates, native facility selector names, tutorial/assignment requirements and legacy log-action compatibility. The existing task-time-estimate suite is also run.

## Planner and client contract

```js
planTraining(skill, fromLevel, toLevel, availability, preference = 'all')
```

The pure export is in `app/tasks/training-planner.mjs`, also re-exported by `app/tasks/time-estimates.mjs`. It performs no IO, fetch, save or account mutation. `fromLevel` may be null for unknown personal progress. `availability` contains the engine's admitted `access` and `items`, current-account observed `skills`, personally `completedQuests`/`completedTasks`, `members`, selector `aliases` and optional `sourceLocations`. `currentXp` preserves exact XP; absent XP uses the starting-level floor and labels that assumption. Tests can inject `availability.catalogue` without changing the shipped catalogue.

For a supported target with a known starting level, the result returns the three plans under `plans['best-xp']`, `plans.balanced` and `plans['money-making']`. Unknown levels and unsupported/capped targets return explicit issues and `plans: {}`. An explicit preference also selects `recommendation`. Each plan reports ordered level/rate segments, XP needed/earned, whole actions when known, time, material quantities, net GP/cost/profit, the actual price date, assumptions and source IDs. Already-satisfied targets have zero time and no actions. Real capped levels such as Cooking 99 can retain virtual XP without failing validation. Invention is deliberately excluded from the standard XP curve.

Best XP selects the fastest reviewed hourly rate regardless of cost. Balanced selects the fastest method at no more than **1 GP/XP consumed material value** by default; if none meets that threshold, it selects the cheapest priced method per XP. `availability.cheapCostPerXp` changes that threshold. Money-making selects the best net guide GP/hour; a nonprofitable bootstrap is explicitly labelled. Missing economics do not become zero: balanced/money-making can remain unavailable while a best-XP plan has known time and unknown cost. Missing effective rates do not become theoretical maximum rates from recipe intervals. `availableMethods` retains obtainable candidates even when their time is unknown.

The planner reevaluates choices when a method, rate profile or level-range boundary is crossed. It optimizes these local segments among curated methods, not a global multi-skill route or a simultaneous supply/gathering schedule. A method's prerequisite in its own skill becomes a future level breakpoint; unrelated skills require personal observations. Inputs must be obtainable, even for a price-backed recipe. `lockedMethods` reports the missing selectors, reviewed source chunks/sections/areas when known, and which preferences a locked method would improve at the starting level. Source locations are hints, never bypasses of access, membership, quest or section gates.

The standard XP curve lives in `app/core/experience.mjs`. The existing death/task-time estimator keeps its original self-supplied log route behavior; expanding a catalogue does not quietly assume market supplies or declare unbound tasks timed. New method `matches` remain empty until an exact task binding is reviewed.

```http
GET /api/training-plan?memberId=player1&skill=Firemaking&targetLevel=60
GET /api/training-plan?memberId=player2&skill=Firemaking&targetLevel=60&fromLevel=42&preference=balanced
GET /api/training-catalogue
GET /api/house-storage-catalogue
```

These routes require the existing invitation cookie or bearer authentication. `fromLevel` is optional and ephemeral; it overrides the observed start for that request and never saves a declaration. The plan response includes `memberId`, `stateRevision` and `progress` with source/fetch date. If no valid personal observation exists, it returns `status: 'unknown-level'` and asks for a manual level or RuneMetrics sync. Unknown members/skills, malformed levels and unknown preferences return 400. A target beyond the F2P skill cap returns explicit unavailable data. Plans use the task worker's existing evaluation to inherit chunk, section, source-backlog, membership and connected-partner filtering; the endpoint adds no task worker or planning routes.

Progress comes from `member.skillProgress[skill]` only when its RuneMetrics account matches the member's current `runescapeName`. Engine primary training ceilings, passive declarations, partner levels and shared challenge checks do not become observed personal XP. Quest steps do not count as whole quest completion, and old synced quest provenance from a renamed account is rejected. Tutorial requirements use personally completed task selectors. Active Slayer assignment tracking is absent, so that gate remains explicit unknown.

There are **no changes under `app/web`**. Claude can consume the authenticated catalogues, `result.houseStorage` from `/api/tasks`, the existing task-rule metadata, and this plan contract when building the UI. Verification uses isolated fixtures and ephemeral ports; no live picker, personal duo save, or game action was tested.

The full `npm test` run passed **1,205 tests** on 2026-10-08. A final unknown-economics comparison guard was then verified by all **15 planner tests**, including its new regression fixture. Test temp directories and npm cache were redirected into the helpers worktree. Catalogue/provenance checks, personal XP/manual-level endpoint fixtures and the existing task-time tests pass; these results are automated verification, not observed personal training.
