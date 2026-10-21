# Death chunks: RS3 training and drop-time research

Research date: 7 October 2026. For Player 1 and Player 2's private Group Ironman picker.

## Recommendation

Use **XP per action plus a supply-and-action time model** as the primary skilling estimate. Retain quoted XP/hour as a contextual rate profile, a cross-check, or a clearly labelled manual override. For drops, use the existing effective drop probability with configurable effective seconds per kill. Mark a candidate when its largest newly imposed obligation is estimated to exceed the configured threshold, default **1,000 hours**. Show a separate combined workload estimate where overlap can be resolved.

The largest implementation risk is scope: **ownership creates obligations; round-trip access creates usable methods and supplies**. Predicting newly available task IDs alone cannot enforce this distinction. The largest data risk is outdated or partially updated rates. The largest modelling risk is treating obtainable supplies as already owned in unlimited quantities.

This report separates **verified facts** from **design recommendations and illustrative assumptions**. It does not claim to have measured either player's current XP, inventories, kill rates, or training rates.

## 1. Repository findings and integration points

### Verified from the inspected working tree

The repository was inspected read-only while another agent was editing it. These are observations of the files read during this research, not a frozen revision or a readiness audit.

- [PRODUCT.md](../../PRODUCT.md) says personal chunks create personal obligations; connected partner chunks can supply training, gathering and shops. Connectivity requires a legitimate way there and back. Actual skills, quest completion and teleport availability remain personal; supplies and challenge satisfaction can be shared.
- [engine.mjs](../../app/tasks/engine.mjs) retains stable category/raw-label task identities, normalized `Level`, `Skills`, `SkillsNeeded`, `Requirements`, item/source gates, primary-method flags and source evidence. Its training levels are **potential reachable ceilings**, often raised to the skill cap once a primary method is reachable. They are not measured account XP.
- [activity.mjs](../../app/tasks/activity.mjs) deliberately indexes all skill rows, including methods suppressed by presentation. It exposes available primary and non-primary methods and warns that reachable levels are planning ceilings.
- [planning.mjs](../../app/core/planning.mjs) has a pure `predictChunk(state, memberId, chunkId, ...)` operation. It evaluates before and after a hypothetical personal unlock and returns `{state, result, delta}` without saving. Its current `tasksAdded`/removed comparison uses available, nonhidden rows; status changes and training changes are reported separately.
- [chunk-planning.mjs](../../app/web/chunk-planning.mjs) associates tasks with declared locations and current source evidence. Its Possible Tasks index explicitly does not prove that unlocking a location creates or enables those duties. Use it for explanations, not as the obligation detector.
- [worker.mjs](../../app/tasks/worker.mjs) includes base and generated collection tasks in prediction. In the inspected path, equipment evaluation and final presentation run only during ordinary evaluation, and the prediction response retains the delta rather than the full hypothetical result.
- [collection.mjs](../../app/tasks/collection.mjs) has collection completion families and alternative sources. Every Drop presentation can choose an alphabetical source; this is not a fastest-time ranking. Drop labels can be rounded. Estimate from numeric source probability and its provenance, not the displayed reciprocal.
- The retained JSON is about **10.18 MB**. It contains the useful labels, requirements, flags and item outputs, but it does not contain a complete per-method time catalogue. A naive F2P flag/level filter is not an authoritative membership or reachability filter.
- The engine contains standard XP-to-level logic. Reuse the project's XP thresholds for level targets, and verify the special Invention curve before any later members expansion. Do not use prospective quest-XP totals as XP already earned.

### Design consequences

Expose an obligation-oriented result alongside the existing accessibility result. An obligation needs a family identity, target, owner, qualifying own-location/source evidence, prerequisites and satisfaction policy. Retain the shared access result to price training and supplies.

Do **not** implement this by turning off shared access for the whole prediction: that would remove legitimate partner methods and prerequisites. Also do not equate every `Primary` row with a level obligation; some rows represent repeatable methods, equipment use, one-off actions or source unlocks.

## 2. XP and training sources

### Verified source inventory

| Source | Coverage and F2P usefulness | Format | Stability and use |
|---|---|---|---|
| [Wiki skill-training directory](https://runescape.wiki/w/Skill_training_guides) | Routes for all 17 full F2P skills; P2P guides and many Ironman guides | Prose, tables and method lists | Best discovery index. Guide presence does not mean every method has a usable rate. |
| [Current Skills](https://runescape.wiki/w/Skills) and [Free-to-play](https://runescape.wiki/w/Free-to-play) | Membership classification and trial caps | Tables/prose | Verify caps and method membership independently; a full F2P skill can contain members activities. |
| Item/activity creation tables, e.g. [oak longbow cutting](https://runescape.wiki/w/Oak_longbow_(unstrung)) and [stringing](https://runescape.wiki/w/Oak_longbow) | Specific actions, materials, XP, requirements and membership | Template-generated structured tables; underlying wikitext | Strongest reviewed XP/action source. Tables still need update-history and consistency checks. |
| [Module:Skill calc](https://runescape.wiki/w/Module:Skill_calc) and its [Fletching data](https://runescape.wiki/w/Module:Skill_calc/Fletching/data) | Broad skill calculator data; F2P/member flags and selected timings | Lua, including name, level, XP, ticks, multiplier and materials | Excellent candidate input. Not a universal XP/hour dataset; entries can be stale or partly updated. |
| [Calculator directory](https://runescape.wiki/w/Calculators) | Ordinary XP/action calculators plus woodcutting chance, Dungeoneering floors and Archaeology hotspot models | Calculator pages, Lua/templates and sometimes JavaScript | Useful when throughput depends on level/tool/success or sessions. No single uniform schema across calculators. |
| [F2P](https://runescape.wiki/w/Free-to-play_Fletching_training) and [P2P Fletching guides](https://runescape.wiki/w/Pay-to-play_Fletching_training) and other skill guides below | Useful benchmark XP/hour, counts and method assumptions | Primarily prose and tables | Rates may assume bought ingredients, discarded output or members boosts. Some numerical subsections are outdated. |
| [Ironman guide](https://runescape.wiki/w/Ironman_Mode/Guide), including [Fletching](https://runescape.wiki/w/Ironman_Mode/Guide/Fletching) | Resource acquisition and self-supply context | Prose and linked methods | Helps identify supply chains; many recommendations are members-based. Fletching carries an update warning after July 2026 changes. |
| [Jagex July 2026 patch notes](https://secure.runescape.com/m=news/patch-notes-mid-game-rebalance) | Primary evidence for re-tiering and changed training systems | Patch tables/prose | Use to reconcile updates. The patch notes explicitly re-tier oak shortbow to 10 and longbow to 15. They are not a complete operational-rate catalogue. |
| [RuneHQ](https://www.runehq.com/skill/fletching), [Sal's Realm](https://runescape.salmoneus.net/skill-calculators/fletching.html), [Orbscape](https://orbscape.com/calc/fletching.php) | Additional community tables/calculators | HTML tables or interactive calculators | RuneHQ and Sal's still expose older oak values/requirements; Orbscape's action rows were not extractable here. No verified redistribution licence for these sources; link as comparison evidence, not default imports. |
| Personal measured sessions | Exactly the duo's gear, route and interaction pattern | Small local measurements | Recommended for effective throughput; no such sessions were measured in this task. |

The Wiki's standard skill calculator describes a basic XP/action model and per-skill data modules. Fletching data was inspected directly as approximately **147 KB of raw Lua**; the other modules' existence/routes were checked through the calculator directory/framework, not exhaustively audited. A batch's XP, products and timing need explicit units. [Module documentation](https://runescape.wiki/w/Module:Skill_calc/doc), [raw Fletching data](https://runescape.wiki/w/Module:Skill_calc/Fletching/data?action=raw).

### Coverage per full F2P skill

Verified guide routes are from the [training directory](https://runescape.wiki/w/Skill_training_guides) and its navigation; “F2P/P2P/Ironman” describes guide coverage, not an audit of all methods. The final column is a design assessment. The six combat skills are shown separately because their XP allocation differs.

| Skill | Guide coverage | Structured candidate data / model needed |
|---|---|---|
| Attack | F2P/P2P/Ironman melee | Monster XP and kill throughput; selected XP allocation |
| Strength | F2P/P2P/Ironman melee | Same kill/allocation model |
| Defence | Defence and melee guide routes | Combat allocation, not generic Defence actions |
| Constitution | F2P/P2P Constitution routes | Co-awarded combat XP and kill throughput |
| Ranged | F2P/P2P/Ironman | Combat XP, ammunition and kill throughput |
| Magic | F2P/P2P/Ironman | Spell-action data plus separate combat model |
| Prayer | F2P/P2P/Ironman | Prayer data; bones/ashes acquisition and action type |
| Cooking | F2P/P2P/Ironman | Cooking data; burn chance, inputs and facilities |
| Crafting | F2P/P2P/Ironman | Crafting data; multiple recipe stages and supply |
| Dungeoneering | F2P/P2P | Floor/prestige/party/session model; no separate Ironman guide in inspected directory |
| Firemaking | F2P/P2P/Ironman | Firemaking data; bonfire context and log supply |
| Fishing | F2P/P2P/Ironman | Fishing data; success mix, bait and banking |
| Fletching | F2P/P2P/Ironman | Fletching data; verified recent conflicts |
| Mining | F2P/P2P/Ironman | Mining data; tool, stamina/activity and progress |
| Runecrafting | F2P/P2P/Ironman | Rune data; essence routes or Runespan nodes |
| Smithing | F2P/P2P/Ironman | Smithing data; heat, progress and projects |
| Woodcutting | F2P/P2P/Ironman | Log data; level/hatchet success and banking |

Current F2P permits the 17 full skills above. **Archaeology, Construction and Necromancy have trials through level 20**. Agility, Herblore, Thieving, Slayer, Farming, Hunter, Summoning and Divination have trials through 5; Invention is unavailable. Member guides/calculators exist for these skills, but that does not verify each trial method's location, equipment or F2P eligibility. Necromancy was not listed as an ordinary generic Skill calc data module in the inspected directory. [Skills](https://runescape.wiki/w/Skills), [Construction](https://runescape.wiki/w/Construction).

### Examples that expose the modelling assumptions

These are **guide claims**, not measured results from Player 1 or Player 2:

| Source inspected | Reported data | Implication for chunk-lock estimates |
|---|---|---|
| [F2P Woodcutting](https://runescape.wiki/w/Free-to-play_Woodcutting_training) | Oak summary 13–20k XP/hour; prose about 18k | Level/tool assumptions matter; translate XP to useful logs only with correct per-log XP and banking policy. |
| [F2P Fishing](https://runescape.wiki/w/Free-to-play_Fishing_training) | Crayfish about 11.5k XP/hour; fly fishing roughly 17–67k over levels 20–99 | Rates assume dropping fish. They do not directly price banked fish for Cooking. |
| [F2P Mining](https://runescape.wiki/w/Free-to-play_Mining_training) | Coal at levels 20–30 about 25k XP/hour with moderate activity | Activity/stamina and tool profiles must accompany the number. |
| [F2P Smithing](https://runescape.wiki/w/Free-to-play_Smithing_training) | Smelting about 1,200–1,400 bars/hour with depositing/restarting | This includes an interface cycle; add ore acquisition but do not double-count included handling. |
| [F2P Runecrafting](https://runescape.wiki/w/Free-to-play_Runecrafting_training) | Runespan roughly 36–53.5k XP/hour over levels 33–99 | Must verify Runespan access and node/level assumptions; not an ordinary essence-at-altar rate. |
| [F2P Dungeoneering](https://runescape.wiki/w/Free-to-play_Dungeoneering_training) | Solo small/medium floors up to 180k XP/hour; reported floor times about 2–3 / 5–8 minutes | “Up to” is a contextual upper rate; prestige, floors and party configuration matter. |
| [F2P Crafting](https://runescape.wiki/w/Free-to-play_Crafting_training) | Reported test at 46 Mining around 26k Crafting + 24k Mining XP/hour, with selected gems banked | Preserve the XP vector and which outputs are discarded. |
| [F2P Firemaking](https://runescape.wiki/w/Free-to-play_Firemaking_training) | Combined willow cutting/burning around 40k Firemaking + 30k Woodcutting XP/hour at 75 WC | A useful full-cycle benchmark if that tree, gear and burn method are reachable. |
| [F2P Cooking](https://runescape.wiki/w/Free-to-play_Cooking_training) | Cream cheese around 50k XP/hour at Falador farm | Location, ingredient supply and processing steps are part of the method. |

### Verified oak example and source disagreement

Current oak-longbow recipes give **14.7 Fletching XP for cutting one oak log**, requiring level 15, taking 3 ticks; normal-bowstring stringing gives another **14.7 XP in 2 ticks**. Both ordinary recipes are F2P. A game tick is 0.6 seconds. [Unstrung recipe, revision 37151139](https://runescape.wiki/w/Oak_longbow_(unstrung)?oldid=37151139), [finished recipe](https://runescape.wiki/w/Oak_longbow), [game tick](https://runescape.wiki/w/Game_tick).

The Fletching Lua module agrees on the cutting value but still has **25 XP for stringing** and 39.7 for the combined entry. P2P guide prose still has an older oak-shortbow value. The individual longbow recipe/update history agrees with the current 14.7 value, so that should override the unreconciled calculator entry. This is direct evidence that revision dates alone do not establish numerical correctness. [Module, revision 37190991](https://runescape.wiki/w/Module:Skill_calc/Fletching/data?oldid=37190991), [P2P guide, revision 37197214](https://runescape.wiki/w/Pay-to-play_Fletching_training?oldid=37197214), [rebalance overview](https://runescape.wiki/w/2026_mid-game_rebalance).

For an **illustrative cutting-only route** from the start of level 15 to 99:

- XP remaining = 13,034,431 − 2,411 = **13,032,020**.
- At 14.7 XP/action, **886,532 logs/actions** are needed.
- Three ticks/action gives a zero-overhead ceiling of **29,400 XP/hour**, or about **443 processing hours**.
- If, purely as an example, acquiring and banking logs averages **300 logs/hour**, gathering adds about **2,955 hours**, bringing this route to about **3,398 person-hours**.

The XP thresholds are from the [standard XP table](https://runescape.wiki/w/Experience/Table). The processing ceiling is arithmetic from the recipe; **300 logs/hour is an invented sensitivity example, not a researched oak rate**. Actual banking and the best reachable oak-based alternative can change the result.

Thus “99 Fletching using only oak” is demonstrably a long grind, but it does not automatically exceed a 1,000-hour threshold under a supplies-already-owned scenario. The supply model determines the result. Do not assert that this example is the fastest legal oak method without pricing all reachable alternatives.

### Licensing and durability

Current RS Wiki text generally uses **CC BY-NC-SA 3.0**, subject to the canonical policy's exceptions; older pre-fork revisions differ. Retain attribution, source revisions and licence metadata for curated extraction, mark modifications, and keep imported material distinct from authored code. Do not assume Wiki data is CC0 or Lua modules have a blanket MIT exemption. Media need individual checks. [Wiki copyrights](https://runescape.wiki/w/RuneScape:Copyrights), [canonical licensing policy](https://meta.weirdgloop.org/w/Licensing?oldid=1299), [licence terms](https://creativecommons.org/licenses/by-nc-sa/3.0/).

The policy applies to reused material, not a verified licence conclusion about the entire picker. Private use does not establish future redistribution rights for the retained upstream code/data/artwork. Those rights already remain unresolved in the project README. Jagex patch notes and the other community sites were used as evidence; no permissive bulk-data licence was verified for them.

Prefer stable canonical pages plus pinned revisions for collected facts, with manual checks after skill rebalances. Store numerical recipe facts and concise assumptions rather than reproducing guide prose.


## 3. Preferred model and local schema

### Design recommendation

Per-action data fits restricted resources better than a global skill rate. A quoted Fletching rate can silently assume bought supplies, a higher-tier bow, a portable station, bonus XP, members equipment or a bank next to the action. The picker already knows which specific recipe, item and location is possible. Price that recipe under the actual access and supply assumptions.

Use two connected catalogues:

1. **Method definitions:** exact XP per batch/action, inputs, outputs, prerequisites, repeatability, F2P eligibility and item/task matches.
2. **Rate profiles:** processing time or throughput under stated level/tool/location assumptions, gathering success curves, banking/travel overhead, and measured/assumed uncertainty. A source can have several profiles.

Store XP as a vector so an action can award several skills. Make the unit explicit: an action may produce 15 arrows, consume one log, complete one smithing project, kill one monster, or finish one dungeon floor. Never multiply batch XP by output quantity a second time.

An illustrative schema, using the verified oak-cutting recipe, is:

```json
{
  "schemaVersion": 1,
  "id": "fletching.oak-longbow.cut",
  "matches": [
    {
      "category": "Fletching",
      "rawLabel": "Fletch an ~|oak longbow (unstrung)|~"
    }
  ],
  "requirements": { "skills": { "Fletching": 15 } },
  "inputs": [{ "item": "Oak logs", "quantity": 1 }],
  "outputs": [{ "item": "Oak longbow (unstrung)", "quantity": 1 }],
  "xpPerBatch": { "Fletching": 14.7 },
  "batchUnit": "one-log",
  "processing": { "ticksPerBatch": 3 },
  "supplyMode": "acquire-inputs",
  "f2p": true,
  "repeatable": true,
  "sourceIds": ["rswiki-oak-longbow-unstrung-37151139"]
}
```

Keep a source registry with page title, canonical URL, revision/permanent link, retrieved date, licence, fields extracted, source type, assumptions and any conflicting evidence. Keep rate confidence separate from recipe confidence: a verified XP value can still have an assumed throughput.

Match exact category and raw label first, then validated output/input signatures and explicit aliases. Preserve RS3 item versions and names, including shieldbow-to-longbow changes. Resolve `[+]` aliases through the existing definitions. Preserve what starred inputs mean for primary-source eligibility. The engine's alias `count` can mean **distinct alternatives**, not the number of ingredients consumed; recipe quantities must come from the recipe catalogue.

Use effective `primaryMethod` and the house rules to determine indefinitely repeatable training. `Primary` is not a speed rating. Non-primary methods can contribute finite XP if their stock/reward is known; a lamp or token source must not become infinite training merely because its XP is large.

### Full-cycle time

For a simple method, compute:

```text
effective seconds per batch =
    processing seconds
  + acquisition seconds for consumed inputs
  + amortized banking/travel/interface time
  + expected failure/recovery time

effective XP/hour = XP per batch × 3,600 / effective seconds per batch
```

A measured full-cycle rate can replace this decomposition, but record which costs it already includes. Avoid adding banking or gathering twice.

Input acquisition must respect legitimate connected locations, F2P restrictions, player prerequisites, required source types, shop stock/restock, coins, equipment and carrying capacity. Availability proves a possible source, not inventory, possession or unlimited supply. Finite group-bank stock can make an initial segment fast; after it runs out, use acquisition cost. Without stock data, explicitly assume either zero stock or user-declared supplied inputs.

For gathering skills, processing ticks alone are insufficient. Logs/hour, fish/hour and ore/progress throughput vary with level, equipment and success mechanics. For Cooking, distinguish XP on success, burn chance, batch time and whether burned inputs must be replaced. For Smithing, model progress/projects and heat/tool assumptions rather than assuming every bar is a fixed-duration item.

### Unknown methods

Return structured reasons such as `unmapped-method`, `missing-throughput`, `unknown-input-supply`, `unknown-drop-probability`, `unpriced-prerequisite` and `unverified-connectivity`. Do not convert missing data to zero hours, infinity, or an ordinary safe result.

Permit personal manual rates, with units, XP boosts, supply coverage and date. If a known feasible method exists but an unmeasured reachable method might be faster, the known method gives an estimate for that route, not proof that the best possible route exceeds 1,000 hours. Show the unresolved alternative. Global skill-rate defaults should be visibly assumed fallbacks.

## 4. Kill-time sources and drop estimates

### Verified available sources

Wiki money-making and combat guides provide some usable kills/hour estimates. They describe particular setups; they are not intrinsic monster speeds. The examples below were retrieved on 7 October 2026.

| F2P example | Guide kills/hour | Derived effective seconds/kill | Stated method context |
|---|---:|---:|---|
| [Cows, revision 36948868](https://runescape.wiki/w/Money_making_guide/Killing_cows?oldid=36948868) | 540 | 6.67 | Taverley level-1 cows, area loot and Burthorpe banking; competition matters |
| [Chickens, revision 36806654](https://runescape.wiki/w/Money_making_guide/Killing_chickens?oldid=36806654) | 900 | 4 | Lumbridge farm, nearby bank, active AoE/area loot and limited spawns |
| [King Black Dragon, revision 37111827](https://runescape.wiki/w/Money_making_guide/Killing_the_King_Black_Dragon?oldid=37111827) | 60 | 60 | Recommended combat 100, gravite/rune +3, private-instance spawn and War's Retreat loop |
| [Giant Mole F2P hard mode, revision 37066866](https://runescape.wiki/w/Money_making_guide/Killing_the_Giant_Mole_(Free-to-play,_Hard_Mode)?oldid=37066866) | 15 | 240 | Recommended 70 Magic/Defence, gravite gear and 43 Prayer; chamber travel and supplies |

The seconds are calculated as `3,600 / killsPerHour`. These routes must be checked against the duo's actual chunks, prerequisites and gear; a published F2P route can still be illegal under chunk-lock.

Other sources have narrower uses:

- [F2P melee training](https://runescape.wiki/w/Free-to-play_melee_training?oldid=37024931) contains scattered kill rates, but warns that substantial updating is needed after the 2023 combat-XP changes. It is not a reliable uniform rate seed.
- [PvME boss revenue](https://pvme.io/pvme-guides/miscellaneous-information/boss-revenue/) has boss KPH and team-size assumptions based on meta farming, with personal KPH substitution. Useful comparison data, usually unsuitable as an automatic F2P duo rate. Its guide repository uses [CC BY-NC-SA 4.0](https://github.com/pvme/pvme-guides/blob/master/LICENSE), a different version from the Wiki.
- [Wiki drop-rate calculator](https://runescape.wiki/w/Calculator:Combat/Drop_Rate?oldid=37016775) models acquisition probability from kills and drop chance, not elapsed time.
- [Drop Log Project](https://runescape.wiki/w/RuneScape:Drop_Log_Project) concerns drop probabilities. Its historical RuneMetrics submission instructions do not establish a current kill-throughput API. [Jagex's current support page](https://support.runescape.com/hc/en-gb/articles/207719205-RuneMetrics) says the RuneMetrics website is retired.
- Wiki money-making pages contain structured ingredients, outputs and requirements, but the cow KPH is in prose. Inspection of Mmgtable did not establish a universal per-monster KPH field. No comprehensive current dataset of monster speeds was verified.



### Design recommendation for settings

Use a configurable **effective seconds per kill** default with per-player, per-monster overrides, optionally per location/variant. An initial UI value of **60 seconds** is a usable placeholder, **not an evidence-based universal RS3 average**. Let Player 1 and Player 2 replace it with observations. Keep a Wiki rate profile as a reference or selectable preset, with its requirements.

Define effective kill time as total grind session time divided by completed kills. Include respawn/spawn density, movement, looting, banking, resupply and boss entry/reset where relevant. A boss stopwatch time usually excludes some of these costs. Distinguish player-assisted kill sessions and task-specific drop eligibility.

Validate rate overrides as finite positive values. Preserve monster variants: different level/location/drop-table monsters must not silently share one value. A 10-minute sample can establish a useful personal range; use longer samples for sparse spawns or banking cycles.

For one required item from a stationary independent drop with probability `p` per kill:

```text
expected kills = 1 / p
expected hours = effective seconds per kill / (3,600 × p)
```

This is a mathematical expectation, not a deadline. For small `p`, about 63% of players have obtained the drop by the expected kill count. An optional 95% acquisition point is:

```text
kills95 = ceil(log(0.05) / log(1 - p))
hours95 = kills95 × effective seconds per kill / 3,600
```

Handle `p = 1` as one kill and use numerically stable logarithms for tiny probabilities. A hypothetical 1/100,000 drop at 60 seconds per kill averages **1,667 hours**, with about **4,993 hours** at the 95% acquisition point. These are illustrative inputs, not an assertion about a particular monster.

Use the effective numeric probability from admitted sources, including compound table rolls. Respect source conditions, exact item variants and task source restrictions. An unknown parent probability must not be replaced with a known conditional child-table rate. Do not infer a rate from a rounded label or source quantity.

For `q` successes with one required item per successful drop, the expected kills are `q/p`. If every successful event gives exactly `s` items, use `ceil(q/s)/p`. Variable quantities need a quantity model; `q / expected items per kill` is an approximation and can be poor for small targets. Pity systems, changing luck, thresholds, killcount-dependent probabilities and rare pets need a specific model or an unsupported result.

Filter permitted sources before selecting the smallest expected time. The engine's source restrictions such as `NonShop`, `AllowedSources`, `Source` and crafted-equipment rules still apply. For an obtain-item duty, a legitimate shop or crafting route may beat a drop; for a monster-specific collection duty it may not satisfy the requirement. Personal checks and challenge completion do not prove an item remains in inventory.

## 5. Concrete candidate-estimation algorithm

Everything in this section is a proposed design.

### A. Identify the obligations the unlock would impose

1. Capture a coherent state snapshot and data/rate-catalogue versions. Evaluate the current state once. Use `predictChunk` for the hypothetical personal unlock; ensure before and after use the same complete task, collection and equipment pipeline.
2. Build `O_before` and `O_after`, qualifying obligations from the selected player's own chunks and their admitted sections/interiors. Shared connected sources remain available for fulfilling those duties. A mere map annotation is not qualifying evidence.
3. Normalize obligation families and targets, such as one skill goal, obtaining one exact item, a required monster collection, a quantity target, or a quest/achievement prerequisite chain. Detect new families, higher targets, ownership changes and replacements, not just new IDs. A chunk Player 2 already owns can add Player 1's duties without adding any shared method.
4. Apply challenge satisfaction and backlog/waiver rules explicitly. Presentation filters such as Show Skill Tasks must not silently waive a real duty. A saved backlog can defer a duty under the existing rules; it needs a visible policy rather than disappearing from the calculation.
5. Retain blocked own duties and their causes. If a rule really defers them until their requirements become reachable, label them deferred. Otherwise estimate the prerequisite work or mark unresolved. Report changed existing obligations separately from newly imposed ones.
6. Construct post-unlock method and source access, enforcing personal round-trip connectivity and section/membership gates. The inspected access code unions owners' unlocked chunks; do not assume that this alone proves the newer round-trip product rule. Tie the feature to the connectivity implementation being developed and recheck at implementation time.

The existing delta is an input and explanation aid, not the full answer. Extend the worker to calculate and return an obligation delta and estimates while it still has the full hypothetical result. Do not send an entire world result to the browser for every map marker.

### B. Determine personal XP and targets

Use actual personal skill XP with a provenance/date. If only a **verified current level** `L` is known, XP lies between `XP(L)` and `XP(L+1)-1`; show a duration range, using `XP(L)` as the conservative starting assumption. Handle maximum levels separately. If neither is known, offer an explicit level-1 scenario or return missing progress.

The inspected state has passive/max training controls and explicit completion evidence, not a general measured-XP ledger. Add a distinct personal XP/level input rather than treating those planning controls as RuneMetrics facts. Never grant prospective quest rewards, or another player's XP, to the selected player.

Extract each duty's required skill targets from normalized category/Level, Skills, SkillsNeeded, Requirements and prerequisite records. Apply legitimate boosts only when they can satisfy the specific action. A task requiring an actual level or skillcape may forbid boosts. Combat level is derived from several skills and needs a dedicated target plan; it is not ordinary XP in a Combat skill.

For several duties requiring the same skill, keep their explanation links but coalesce the training target to the highest required level when estimating a combined workload. Do not add level-70 and level-99 training from scratch.

### C. Estimate skilling along an executable route

For each obligation, start from the personal facts and explicitly known supplies. Consider all post-unlock reachable method rows, including presentation-suppressed methods. Recheck each method's actual prerequisites at the simulated current progress; the engine's potential availability does not prove that a high-level recipe, crafted tool, quest reward or area can be used immediately.

Divide progression at method unlocks, meaningful level/tool/success-rate changes and supply exhaustion. Within a segment choose the lowest full-cycle time among methods that are currently executable and priced:

```text
XP needed = max(0, XP(next breakpoint or target) - current XP)
actions needed = ceil(XP needed / XP per batch)
segment hours = actions needed × effective seconds per batch / 3,600
```

Carry actual XP overshoot, outputs, supplies consumed and XP awarded to other skills into the next segment. Charge necessary setup, tool acquisition and prerequisite work once. Detect circular dependencies, exhausted finite methods and paths with no usable bootstrap method. A level-90 method cannot train a level-15 character merely because the engine says level 110 is theoretically reachable.

A fastest-method-at-each-breakpoint solver is a practical first version. It is **not guaranteed globally optimal** when cross-skill preparation, setup costs, stock or XP gained while gathering changes the route. Show the chosen feasible route, and label cross-skill dependencies the first version cannot resolve. Expand to a combined route planner only as needed; unknown prerequisites must remain visible.

### D. Estimate drops and aggregate work

For each drop obligation, use the formulas in section 4 and the fastest permitted executable source, with the selected kill-rate profile. Charge combat/tool/prerequisite training if the source cannot yet be used and that work is priced. Fixed Kill X duties use remaining required kills rather than `1/p`; missing kill-progress records need an explicit zero-progress assumption.

Recommend the **largest standalone new obligation** as the default threshold metric, because the requested definition is an obligation exceeding the limit. A standalone obligation can itself require several skills and prerequisites, whose non-overlapping work belongs in that task estimate. Do not take only its slowest prerequisite skill.

For a higher target replacing an existing duty, show both:

- remaining hours from current personal progress to the new target;
- incremental workload compared with the old target under the **same post-unlock methods**.

Use the first for the default death marker; expose an optional incremental-only policy if the duo later wants it. Subtracting whole before/after totals can hide a new hard duty when the new chunk also makes an old grind faster. An existing 2,000-hour duty is not newly created when a chunk merely improves its method.

A secondary combined estimate should coalesce skill targets, prerequisite setup and exact item demands, then credit shared work once. Gathering can train Woodcutting while supplying Fletching/Firemaking; fighting for a drop can train combat and provide Prayer supplies. Materials consumed by one duty cannot simultaneously satisfy another inventory demand.

For several drops from the same monster, individual expectations neither sum nor take a simple maximum to give the exact expected time to complete the collection. A future joint model can use the declared drop event structure or simulation. In v1 show the slowest individual drop and a **separate-runs workload scenario**. Identify unresolved overlap; do not present that scenario as a precise collection expectation.

### E. Classify and explain uncertainty

Compare unrounded hours using **strictly greater than** the threshold. Exactly 1,000 hours does not cross a rule stated as “more than 1,000.”

Return at least `estimated-exceeds`, `estimated-below` and `undetermined`, with evidence quality and assumptions. A proposed low/central/high planning range is not a statistical confidence interval. A random-drop 95% acquisition point is a different quantity and should have its own label.

When an unresolved method could change a threshold crossing, make the overall result undetermined or show an assumed skull with the unresolved alternative prominently. A known feasible slow route is generally an upper estimate of the fastest possible route. Missing duties prevent an unqualified “safe chunk” claim. If every eligible route has a defensible optimistic lower estimate above the threshold, the exceedance conclusion is stronger.

## 6. UI proposal

Use a skull marker on the candidate for the selected player, with an accessible text label and an uncertainty variant. Suggested summary:

> Estimated death chunk · largest new duty about 1,700 h · limit 1,000 h

Use an outlined skull/question mark for incomplete or threshold-sensitive estimates. Show “No priced duty exceeds the limit; 3 duties unpriced” instead of “safe.” Avoid exact-looking decimal totals.

The detail view should show:

| Field | Purpose |
|---|---|
| Player and hypothetical unlock | Identifies whose ownership and progress were used |
| New/raised duty and own qualifying location | Explains why it belongs to this player |
| Target, starting XP/level, completion policy | Separates account facts from challenge checks |
| Chosen training route or drop source | Makes the estimate inspectable |
| XP/action, actions/hour or seconds/kill, expected actions/kills | Makes rate assumptions editable |
| Processing, gathering, banking and prerequisites | Exposes the cost of constrained supplies |
| Source links, revisions, retrieved/measured date | Makes discrepancies reviewable |
| Expected hours; planning range; optional drop acquisition percentile | Distinguishes different uncertainties |
| Alternatives, missing data and blockers | Prevents false certainty |
| Largest-duty metric and optional combined workload | Explains the threshold decision |

Recalculate with post-unlock methods. A new resource can make a candidate's duty much faster. Show the best known route and the unresolved alternatives, not simply the method with the highest required level.

Calculate markers on demand or in the task worker, reuse a baseline per state snapshot, cache by player/state revision/candidate/rate-version and settings, and invalidate on XP, access, source, completion or override changes. Avoid evaluating all candidates on each map redraw.

Preserve the product's shared-completion semantics. The default display can estimate the selected owner's solo route, with a separate “duo completion route” when the partner can satisfy that particular duty or supply its inputs. Do not assume Player 2's skills or quest completion become Player 1's. If two people work concurrently, distinguish total person-hours from elapsed hours; the threshold unit should default to active person-hours and be stated in settings.

The skull is advisory in v1. Automatic candidate exclusion or blacklisting is a separate explicit rule decision.

## 7. Local data and first-version plan

These are proposed future repository changes. No implementation or dataset was written to the repository during this task.

### Files and size

Keep the new curated data separate from the retained upstream export:

| Proposed path | Content |
|---|---|
| `app/data/training/methods.f2p.json` | Normalized action recipes and exact task/item mappings |
| `app/data/training/rates.f2p.json` | Conditional throughput, gathering, floor/session and overhead profiles |
| `app/data/training/sources.json` | URLs, revisions, licences, dates, assumptions and conflicts |
| `app/data/combat/kill-rate-profiles.json` | Small sourced monster/variant/location presets |
| `app/tasks/time-estimates.mjs` | Pure estimation and uncertainty functions |
| `docs/death-chunks.md` | Scope, aggregation policy, rate conventions and validation decisions |

These are suggested names, not existing-file assertions. Player XP, measured rates, supply assumptions and monster overrides belong in the existing private state/store and backup schema, not checked-in personal data.

Start with roughly **100–250 method/rate profiles** plus validated aliases, rather than copying thousands of presentation rows. Allow families such as “cut this log”, “burn this log”, “process this fish”, “smelt/forge this project” and “fight this monster” to generate several exact matches while retaining explicit exceptions. Estimated compact JSON size is **0.2–1 MB**, including sources and mappings; this is a planning allowance, not a measured completed dataset. Even several thousand numeric rows would fit in a few MB.

Fetch selected pages/modules in small batches during offline data maintenance. Retain small provenance and curated values in Git; keep large raw dumps, caches and generated research outside the repo. The app should run from local data without live Wiki calls during a roll.

Do not execute remotely fetched Lua as application code. The modules are structured Lua, often functions branching by training category, not universally plain JSON. Use a restricted extractor or curate values, validate them against recipes/patch notes, and review diffs before refreshing. Bucket is a possible future structured access path; its RS3 schemas and coverage must be checked rather than assuming the OSRS example schema applies.

### Scope and collection order

1. **Drop foundation:** numeric probabilities and quantity semantics already retained; default/per-monster personal kill rates; fixed kill duties; unknown-rate diagnostics; owner-aware obligation prediction and equipment/collection coverage.
2. **Core F2P artisan recipes:** Fletching, Firemaking, Cooking, Crafting, Smithing and ordinary Runecrafting. Collect base XP, batch quantities/times, consumed ingredients, outputs, required facilities, burn/success modifiers and current names. Price gathering and source availability alongside processing.
3. **F2P gathering, Prayer and combat:** level/tool-sensitive Woodcutting, Mining and Fishing rates; bones/ashes XP with kill/gather supply costs; per-monster combat XP allocation and kill rates; spell-training variants where repeatable. Co-awarded combat/Constitution XP needs explicit allocation.
4. **Dungeoneering and capped trials:** use sourced floor/session profiles for Dungeoneering and transparent manual rates where an exact model is disproportionate. Add only genuinely reachable F2P trial methods for Archaeology/Construction/Necromancy through 20 and the other permitted trials through 5. Invention is unavailable in F2P.
5. **Coverage audit:** enumerate engine-confirmed F2P reachable methods for both players, join to the catalogue and list unmapped methods/inputs. Mark a skill covered only when its actually reachable alternatives are priced or explicitly unresolved. General F2P coverage does not guarantee chunk-lock coverage.

Exclude automatic membership progression, idealised members boosts, full pet/pity/coupon-collector models, a general cross-skill optimal solver and automatic blacklist enforcement from v1. Keep manual profiles and unresolved results usable for those gaps.

### Effort estimate

Assuming one experienced developer and the current ownership/connectivity work provides a stable interface:

| Work | Estimated focused person-hours |
|---|---:|
| Obligation normalization, prediction parity, drops and overrides | 12–20 |
| Curate/map/reconcile first F2P action and supply profiles | 20–35 |
| Segment/supply estimator, XP inputs and uncertainty handling | 16–24 |
| UI, state/backup integration and meaningful verification | 12–20 |
| **First F2P-plus-drops version** | **60–99** |

This is roughly **8–13 focused working days**, not elapsed calendar time or a benchmark. A drops-plus-oak/normal-log demonstrator could be reviewable in **12–20 hours** if the ownership seam is ready. Full coverage of exotic reachable methods and current rebalances can extend the data work substantially.

Verify meaningful cases: own versus partner duties, round-trip access, suppressed but usable methods, post-unlock better resources, low-level bootstrapping, compound/unknown drop rates, source restrictions, finite stock/restock, target replacement, same-skill target coalescing, shared gathering/combat XP, shared challenge completion versus personal prerequisites, missing XP/method data, strict threshold equality and state-revision invalidation. Compare a few manually measured duo sessions with estimates. These are proposed implementation checks; no tests or servers were run for this report.

## 8. Retrieval and provenance notes

Direct small Wiki requests succeeded with a descriptive User-Agent. The [Wiki API policy](https://runescape.wiki/w/Help:APIs?oldid=37037574) supports external tools and asks for an identifiable agent; generic clients can be blocked. Use small cached batches and backoff, rather than treating any examples as a promised request allowance.

A suitable read-only revision query is:

```text
https://runescape.wiki/api.php?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&titles=Module%3ASkill_calc%2FFletching%2Fdata
```

For a fixed snapshot, request `revids=<revision>` instead of titles. [MediaWiki revision API](https://www.mediawiki.org/wiki/API:Revisions).

Selected current revisions independently checked through the Wiki API:

| Page | Revision | Edit timestamp UTC |
|---|---:|---|
| Oak longbow (unstrung) | 37151139 | 2026-08-10 01:16:23 |
| Module:Skill calc/Fletching/data | 37190991 | 2026-09-29 03:34:09 |
| Free-to-play Fletching training | 37189086 | 2026-09-28 08:53:13 |
| Pay-to-play Fletching training | 37197214 | 2026-10-03 23:41:09 |
| Help:Editing/Bucket | 37148998 | 2026-08-08 17:19:24 |

The Wiki has replaced Semantic MediaWiki with **Bucket**. Its documentation uses `action=bucket` and a query returning structured fields, including JSON strings that may require a second decode. Some example code still says `action=ask`, and example schemas can be OSRS-specific. Do not build a new importer around obsolete SMW advice or assume examples are uniform across the two games. [Bucket documentation](https://runescape.wiki/w/Help:Editing/Bucket?oldid=37148998), [retired SMW guide](https://runescape.wiki/w/User:Gaz_Lloyd/smw_api).

Pinned rendered pages can still use changing transcluded templates or data modules. For reproducibility retain the extracted numerical record and revisions of contributing dependencies, rather than only a permanent link to the guide page.

Public sources were accessible through Tavily search/extraction and small direct raw/API reads. Rendered interactive calculator coverage was not exhaustively checked; Orbscape action data remained unverified. Search results can mix RS3, OSRS and Classic, so exact host/version checks are necessary. No game sessions or exhaustive all-method collection was performed.


This task used local file reads, small in-memory public-web fetches and live search. The only requested artifact is this report in the external scratchpad. No repository files were edited, created, moved or deleted; no Git write commands, servers or large repository downloads were used.
