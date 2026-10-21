# Gathering-rate calculator: feasibility research

Original research spike by Codex, 12 October 2026 (roadmap C13). The feasibility
spike made no code changes; Steps 1–3 below record Mining, Woodcutting and Fishing.
Earlier local file links point at the redesign worktree.


The repo already supplies much of the geography. The main limitations are incomplete fishing-spawn data, unverified facility eligibility, practical interaction delays, and inconsistencies in some published formulas. No files were edited. Sources were checked on **12 October 2026**; wiki links below pin revisions where available.

I distinguish **official** mechanics confirmed by Jagex, **wiki-documented** formulas and calculator implementations, **community estimates**, and **unknown or unresolved** details. A published wiki calculator is useful evidence, but does not prove an exact match to current server code.

**The gathering mechanics are sufficiently documented to build the calculation layer.**

First, the live Mining and Smithing rework launched on **7 January 2019**. Jagex confirms that ordinary mining rocks no longer deplete, every swing awards XP, and filling a progress bar awards ore. [Jagex’s launch post](https://secure.runescape.com/m=news/mining-and-smithing-rework).

| Skill | Published calculation | Attempts and resource behaviour | Confidence |
|---|---|---|---|
| Mining | Damage depends on Mining, Strength, pickaxe damage and penetration, rock hardness, critical hits, and stamina. | A swing every four ticks. Core rocks do not deplete; additional nodes enable rockertunities. | Official broad mechanics; detailed wiki model is strong enough for estimates. |
| Woodcutting | A level-dependent success roll using tree parameters and hatchet power. | An attempt every four ticks; successful cuts can fell the tree. Respawn and switching cause downtime. | Detailed wiki model available; current rounding and normal-tree depletion need validation. |
| Fishing | Level-dependent success rolls, with sequential rolls for mixed catches. | Usually four ticks; tuna/swordfish harpooning uses five. Spots relocate. | Detailed wiki model available; relocation downtime is poorly established. |

These intervals come from the current [Mining](https://runescape.wiki/w/Mining?oldid=37194674), [Woodcutting](https://runescape.wiki/w/Woodcutting?oldid=37196294), and [Fishing](https://runescape.wiki/w/Fishing?oldid=37195568) revisions.

For **Mining**, the published base damage equation is:

*Mining level + floor(Strength level ÷ 10) + pickaxe damage roll + critical bonus − any hardness not covered by penetration.*

Visible and invisible Mining/Strength boosts apply. Stamina unlocks at level 15: full stamina gives 100% damage, partial stamina 90%, and empty stamina 20%. Clicking refills it; its capacity increases with Mining milestones and Agility. Critical chance, critical damage, double-ore chance, and rockertunity multipliers also improve at defined levels. These are tabulated in the [Mining article](https://runescape.wiki/w/Mining?oldid=37194674).

The main F2P progression is:

| Level | Base pickaxe damage / penetration | Corresponding core rock durability / hardness |
|---:|---|---|
| 1 | Bronze: 3–7 / 0 | Copper and tin: 40 / 0 |
| 10 | Iron: 5–15 / 5 | Iron: 120 / 5 |
| 20 | Steel: 10–30 / 15 | Coal: 140 / 15 |
| 30 | Mithril: 15–45 / 30 | Mithril: 240 / 30 |
| 40 | Adamant: 20–60 / 50 | Adamantite and luminite: 380 / 50 |
| 50 | Rune: 25–75 / 75 | Runite: 600 / 75 |

Upgraded picks matter: **rune +3**, for example, gives 28–78 damage with the same penetration. Rune +3 is F2P; orikalkum and later tiers are members. [Pickaxes, revision 36994546](https://runescape.wiki/w/Pickaxes?oldid=36994546), [core-rock table, revision 37182499](https://runescape.wiki/w/Template:Mining/Core_rocks?oldid=37182499).

Mining XP is based on damage, with a rock-specific multiplier and a global factor of 0.4. Ore production separately involves durability, damage caps/carry-over, double ore, and spirits. Therefore, **XP/hour cannot simply be divided by a fixed XP/ore**. The wiki already has a [Mining rate calculator](https://runescape.wiki/w/Calculator:Mining/Rate?oldid=37179406) and an inspectable [implementation](https://runescape.wiki/w/Module:Mining_Rate_Calculator_Module?oldid=37179407), useful as a reference and comparison target.

Rockertunities appear on another nearby same-type rock after a documented 24–36-second cooldown. Their benefit depends on movement and attention. The offline model should distinguish active clicking, occasional clicking, and unattended mining, and simulate rockertunity travel separately rather than adding a universal percentage bonus.

For **Woodcutting**, the current F2P parameters are:

| Tree | Required level | XP/log | Published base chop chance | Respawn |
|---|---:|---:|---:|---|
| Normal | 1 | 25 | 64 | 35.4–58.8 seconds; prose rounds to 36–60 |
| Oak | 10 | 37.5 | 32 | 13.2 seconds |
| Willow | 20 | 67.5 | 16 | 13.2 seconds |
| Teak | 30 | 85 | 15 | 13.2 seconds |
| Maple | 40 | 100 | 12.5 | 13.2 seconds |
| Acadia | 50 | 80 | 16 | 13.2 seconds |
| Yew | 70 | 187.5 | 6 | 15 seconds |

The chance parameters come from [TreeData, revision 36706827](https://runescape.wiki/w/Module:SkillUtils/TreeData?oldid=36706827). Timer checks used [normal trees](https://runescape.wiki/w/Tree?oldid=37201228), [oak](https://runescape.wiki/w/Oak?oldid=37197269), [willow](https://runescape.wiki/w/Willow?oldid=37197270), [teak](https://runescape.wiki/w/Teak?oldid=37188679), [maple](https://runescape.wiki/w/Maple_Tree?oldid=37135152), [acadia](https://runescape.wiki/w/Acadia_tree?oldid=37166118), and [yew](https://runescape.wiki/w/Yew?oldid=37195444).

Hatchet power is currently bronze 100, iron 200, steel 300, black 350, mithril 420, adamant 525, and rune 630. Their Woodcutting requirements are respectively 1, 10, 20, 25, 30, 40, and 50. Rune remains the strongest F2P hatchet. [HatchetData](https://runescape.wiki/w/Module:SkillUtils/HatchetData?oldid=37170712), [Rune hatchet](https://runescape.wiki/w/Rune_hatchet?oldid=37020035).

A recent change matters: Jagex folded Lumberjack aura benefits into hatchets on **13 April 2026**. The current powers already incorporate the mithril–rune adjustment; adding another 5% would double-count it. [Official aura overhaul](https://secure.runescape.com/m=news/patch-notes-aura-overhaul).

The published model calculates a low endpoint from base chop chance and hatchet power, then a high endpoint at **3.125 times low**, and interpolates by effective Woodcutting level. The calculator scales endpoints before rounding. Its [implementation](https://runescape.wiki/w/Module:SkillUtils?oldid=36640342) and the newer [generic success article](https://runescape.wiki/w/Skilling_success_chance?oldid=37009675) disagree slightly about rounding and the denominator. The denominator difference alone is about **0.4% relative**, much smaller than ordinary switching and banking losses, but the build should record which convention it uses.

The published tree data gives a **32/256 felling roll per successful cut** for oak through yew, averaging eight logs before felling. It gives 96/256 for normal trees. Step 2 re-checked the dates: normal trees gained multiple logs on **20 January 2025**, and TreeData revision 36706827 is dated **26 April 2025**. Its normal-tree value postdates the change but remains provisional without a current server measurement.

As an illustration, the published calculator model gives approximately **891 acadia logs/hour and 71,300 Woodcutting XP/hour** at level 75 with a rune hatchet, before depletion, movement, handling, or banking. This is an uninterrupted ceiling, not a measured spot rate.

For **Fishing**, F2P tools primarily select the method: net, crayfish cage, baited rod, fly rod with feathers, lobster pot, or harpoon. There is no comparable verified F2P metal-tool progression.

The wiki calculator supplies these low/high success endpoints:

| Catch order | Low/high endpoints | Attempt interval |
|---|---|---|
| Crayfish | 200/256 | Four ticks |
| Anchovy, then shrimp | 24/128; 48/256 | Four ticks |
| Herring, then sardine | 24/128; 32/192 | Four ticks |
| Salmon, then trout | 16/96; 32/192 | Four ticks |
| Pike | 16/96 | Four ticks |
| Lobster | 6/95 | Four ticks |
| Swordfish, then tuna | 4/48; 8/64 | Five ticks |

These are endpoints for level interpolation, not probabilities at the unlock level. The [Fishing calculator data](https://runescape.wiki/w/Module:Fishing_chance_calculator/data?oldid=37011174) and [implementation](https://runescape.wiki/w/Module:Fishing_chance_calculator?oldid=37011173) expose the calculation.

Mixed catches require conditional rolls. For example, trout is rolled only after an eligible salmon roll fails. Treating each fish as an independent catch opportunity would overestimate both resources and XP. The skill-specific calculator still uses division by 256, sharing the small discrepancy with the generic success article.

The largest Fishing unknown is **spot relocation**. I did not establish a reliable current relocation-time distribution in this bounded research. Historical community averages should not become exact timers. We can calculate uninterrupted catch rates now, but realistic location rates need observed movement and re-click downtime.

For **processing on the spot**, the action layer is comparatively straightforward:

| Action | Ordinary published interval | What must also be modelled |
|---|---|---|
| Cut shafts or an unstrung bow | Three ticks | Recipe eligibility, batch size, XP, and resulting inventory slots |
| Light a line fire | Four ticks | Initial ignition, usable tiles, movement and fire placement |
| Feed a bonfire | Six ticks | Fire creation/expiry, occasional interruption, XP modifiers |
| Cook ordinary fish | Four ticks | Burn probability, fire/range type, restart delay, retained fish |

These are wiki-documented baseline intervals; some deliberate interface restarts can shorten them. [Ticks per action, revision 37145287](https://runescape.wiki/w/Game_tick/Ticks_per_action?oldid=37145287).

Fletching into stackable shafts frees backpack space; making unstrung bows does not. Cooking also leaves a cooked or burnt item occupying a slot, so it still requires dropping, banking, or noting afterward. Cooking success uses food-specific low/high endpoints, effective level, and range modifiers; failed cooks give no XP. [Cooking, revision 37179285](https://runescape.wiki/w/Cooking?oldid=37179285).

Bonfire XP varies with log type and relevant modifiers; two people feeding the same fire give a small group bonus. Fire lifetime also matters. [Bonfire, revision 37199967](https://runescape.wiki/w/Bonfire?oldid=37199967). Mining “process” profiles would require a nearby furnace or other actual facility rather than assuming ore can be processed beside every rock.

**Movement is usable for estimates, but the exact energy model needs measurement.**

Walking covers **one tile per 0.6-second tick** and running **two**. Diagonal movement must count as a tile step: a pathfinder using only cardinal movement can substantially overestimate journey time. [Energy](https://runescape.wiki/w/Energy?oldid=36948212), [ticks per action](https://runescape.wiki/w/Game_tick/Ticks_per_action?oldid=37145287).

The current [Weight article](https://runescape.wiki/w/Weight?oldid=37158898) documents an empirical weight relationship: approximately 0.7 percentage points of energy per running tick at minimum weight, increasing by 0.00729166 per kilogram, truncated to hundredths, and capped at 1.4. This is a community approximation, and it does not supply a complete Agility-dependent formula.

The [Energy article](https://runescape.wiki/w/Energy?oldid=36948212) is internally inconsistent about regeneration: it states 0.8%/second for low-level F2P recovery, but also lists 75 seconds for full recovery at Agility 1. Those imply different rates. It confirms recovery while walking or standing and says weight does not affect recovery. I would measure the duo’s actual recovery rather than silently select one figure.

Jagex confirms that Agility affects running distance and recovery, and that resting and musicians accelerate recovery. [Official run-energy upgrade](https://secure.runescape.com/m=news/run-energy-upgrade). F2P training stops at Agility 5, although previously earned higher Agility remains relevant on free worlds. [Agility](https://runescape.wiki/w/Agility?oldid=37175753).

**Surge is relevant to F2P:** Agility 5, up to ten tiles, with a normal 20.4-second cooldown. Double Surge is unavailable. Bladed Dive is members-only. Ordinary Dive can work on free worlds after its members quest unlock, so it should not be assumed for this duo. [Surge](https://runescape.wiki/w/Surge?oldid=37177973), [Dive](https://runescape.wiki/w/Dive), [Bladed Dive](https://runescape.wiki/w/Bladed_Dive).

For the first banking model, calculate walking and running scenarios and carry energy through the **whole repeating cycle**. Gathering time often restores energy before the next trip; assuming every trip starts full is only justified when the intervening recovery permits it. Surge and allowed lodestones can become separately verified route variants.

**F2P storage can materially change the result.**

Ore-box capacity is **per ore type**, and higher tiers include lower-tier materials:

| F2P ore box | Newly supported materials | Capacity |
|---|---|---|
| Bronze | Copper, tin | 100 each; 120 at Mining 7 |
| Iron | Iron | 100; 120 at 18 |
| Steel | Coal, silver | Coal 120 at 29; silver stays 100 |
| Mithril | Mithril | 100; 120 at 37 |
| Adamant | Adamantite, luminite, gold | Adamantite/luminite 120 at 41; gold stays 100 |
| Rune | Runite | 100; 120 at 55 |

Family Crest is no longer required to store silver or gold. Achievement bonuses can increase capacity, but require members progression and should not be granted to fresh F2P characters. Ore boxes share contents; duplicates do not multiply capacity. Stored contents add no carried weight. Ores can be emptied into banks, deposit boxes, or the metal bank, but cannot be withdrawn directly into the backpack. [Ore boxes](https://runescape.wiki/w/Ore_boxes?oldid=36853238), [Rune ore box](https://runescape.wiki/w/Rune_ore_box?oldid=36992388).

Wood-box capacity also applies separately to each supported log type:

| F2P box | Fletching level to make | Newly supported logs | Base capacity/type |
|---|---:|---|---:|
| Basic | 1 | Normal; also compatible with achey | 70 |
| Oak | 10 | Oak | 80 |
| Willow | 20 | Willow | 90 |
| Teak | 30 | Teak | 100 |
| Maple | 40 | Maple | 110 |
| Acadia | 50 | Acadia; also arctic pine/eucalyptus compatibility | 120 |

Each includes earlier tiers. Add ten capacity at Woodcutting **5, 15, 25 … 105**, up to eleven increases. Thus an acadia box holds **200 of each supported log at level 75**, or 230 at 105, without members achievements. Compatibility with a material does not establish F2P access to its trees. [Wood boxes](https://runescape.wiki/w/Wood_boxes?oldid=37004796).

**An acadia box cannot store yew logs.** Yew logs are F2P, but the yew box is members. Boxes share contents and stored logs add no weight. Grove-based spirit/nest storage requires members progression. The specific acadia page permits emptying at a bank, deposit box, or log pile. [Acadia wood box](https://runescape.wiki/w/Acadia_wood_box?oldid=37044915). Jagex confirmed F2P teak/maple/acadia trees and boxes in its [December 2024 announcement](https://secure.runescape.com/m=news/110-woodcutting--fletching--firemaking---new-skilling-update).

Other relevant options are:

- **Normal gem bag:** F2P, Crafting 25, Dungeoneering 25, 2,000 tokens; 100 total uncut sapphires, emeralds, rubies, and diamonds. The upgraded bag is members. [Gem bag](https://runescape.wiki/w/Gem_bag).
- **Fish:** tackle boxes are members. F2P Stiles instead notes raw or cooked tuna, lobster, and swordfish for free at **2851,3143**. This is a useful alternative destination to banking. [Tackle box](https://runescape.wiki/w/Tackle_box), [Stiles, revision 37189046](https://runescape.wiki/w/Stiles?oldid=37189046).
- **Metal bank:** an ore-deposit destination at suitable smithing facilities, potentially closer than a conventional bank. [Jagex’s rework post](https://secure.runescape.com/m=news/mining-and-smithing-rework).
- **Urns:** XP modifiers occupying inventory space, rather than material containers.

**The repo gives us individual static nodes, but its committed topology is insufficient for travel distances.**

| Data | What it already establishes | What remains missing |
|---|---|---|
| `cache-resources…json` | Individual placement IDs, object IDs, names/classes, world coordinates, planes, rotation, footprints, morph alternatives, and perimeter access witnesses | Harvest parameters, active server state, and complete classification/eligibility |
| `cache-walkability…json` | Components, bounds, tile counts, inter-component edges and witnesses | Per-tile blockers, wall masks and all portal endpoints |
| `cache-npcs…` | NPC definitions and name matching | Spawn coordinates and moving fishing-spot locations |
| Training methods | Reviewed requirements, recipes and contextual rates | Level/tool curves, actual travel costs and several output rates |
| POH storage | Furniture/storage objectives and requirements | A general gathering-bank substitute |

The [resource catalogue](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/app/data/cache-resources.2026-10-08.v1.json>) contains **9,846 placements**. For example, it identifies willow object 38616 at 2546,3385, oak object 38731 at 2524,2967, and copper rock 113027 at 2965,3234. This supports genuine node-level clustering and switching distances. Generic unknown trees/rocks and conditional alternatives must remain uncertain.

Banks are not wholly missing: the catalogue contains **92 booths, 29 chests, 23 deposit boxes, 17 counters, and one bank table**. These are physical candidates across the catalogue, not a validated list of usable F2P services. Membership, quests, interaction tiles, and actual service availability still need review.

Crucially, the full tile data **does exist locally** in [walkability.v1.json.gz](<C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/walkability.v1.json.gz>). Its hash matches the recorded manifest. It contains per-tile blocker reasons, cardinal and diagonal wall masks, planes, component labels, exact portals, doors, and uncertainties. The committed compact export omits these. [Walkability research, line 85](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/research/cache-walkability.md:85>), [serializer](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/scripts/cache/collision.mjs:421>).

That makes offline tile pathing practical after a scoped, portable export. It remains a conservative **closed-door, surface-cache model**, with 1,415 unverified doors/gates and 7,034 conditional morph placements. It cannot independently establish quest-controlled passages, stairs, transport, or current player state.

The [NPC catalogue](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/app/data/cache-npcs.2026-10-08.v1.json>) explicitly has **zero verified spawn locations**. The resource catalogue has only two static fishing placements. Ordinary fishing spots therefore need separately authored or verified location records, including possible relocation tiles.

The reviewed cache fields provide geometry and identity. They do **not currently provide interpreted gathering-success formulas, durability tables, or complete requirements**. Those mechanics should come from a separately sourced rules catalogue. POH data should likewise retain its documented scope: catalogued deposit-storage furniture is members content, not an automatic F2P banking option.

**I would build this in phases, beginning without pathing.**

1. **Add a level/tool-aware Mining lookup first.** Cover the existing copper-through-runite methods, actual pickaxe variants, Strength, stamina/attention profiles, and optional double-ore effects. Produce XP/hour and ore/hour separately. Initially omit rockertunities and banking, clearly labelling uninterrupted rates.
2. **Add Woodcutting and a small curated spot catalogue.** Use current hatchet powers, tree probabilities, node coordinates, felling and respawn. Start with reviewed oak/willow/acadia locations. Keep normal-tree depletion provisional.
3. **Add storage and verified destination routes.** Export relevant tile masks; curate F2P banks, deposit boxes and metal-bank facilities. Route between valid interaction tiles. Verify diagonal collision rules, doors, return trips and whole-route chunk eligibility.
4. **Add complete drop/process/bank cycles.** Include inventory slots, box filling/emptying, processing, retained outputs, dropping and interface delays. Cooking produces cooked-fish and burnt-fish quantities; mixed Fishing produces each species separately.
5. **Add Fishing locations and calibration.** Curate a few useful F2P spots, including Stiles routes, and observe relocation downtime. Compare predicted and observed hour-long sessions before expanding coverage.

For a banking cycle, the basic accounting is:

*Cycle time = gathering time + switching/waiting + handling/processing + outward/return travel + destination interaction.*

*Retained resources/hour = retained resources per cycle × 3,600 ÷ cycle time.*

Processing requires an **XP total for each skill**. Chopping and burning cannot simultaneously earn their separate standalone hourly rates. Both gathering and bank-return weights must be modelled; box contents are weightless. Two people cutting the same grove also share depletion, whereas core mining rocks do not deplete.

Offline generation is a good fit, but arbitrary unlocked-chunk combinations would create an enormous table. I would precompute several candidate routes with their required chunks and conditions. Runtime can select an eligible precomputed entry without calculating paths or simulating gathering. Alternatively, rebuild privately when the duo’s unlocked geography changes.

Each generated entry should retain formula/source revisions, cache hashes, profile assumptions, route requirements, tool/container requirements, and separate gathered/retained quantities. Refresh when Jagex changes mechanics, source parameters change, the cache changes, or a relevant unlock changes.

**The practical feasibility verdict is:**

| Skill | Verdict | Expected practical accuracy |
|---|---|---|
| Mining | **Good estimate**, especially without rockertunities | Initially allow roughly ±10–20% at a verified spot with a defined attention profile |
| Woodcutting | **Rough estimate initially; good estimate after spot calibration** | Initially allow roughly ±15–30%; sparse groves and shared depletion can widen this |
| Fishing | **Rough estimate** | Initially allow roughly ±20–40%; automatic spot-specific estimates are not feasible from the current NPC export alone |
| Fletching | **Good estimate** for supported fixed recipes | Mainly handling, batching and inventory behaviour |
| Firemaking | **Good estimate** for a defined bonfire cycle | Ignition, interruptions, expiry and XP modifiers remain relevant |
| Cooking | **Good above verified no-burn thresholds; rough below them** | Requires food/range-specific success data and retained-output handling |

Those percentage ranges are **engineering expectations to test**, not measured confidence intervals. The main errors will probably come from attention and downtime, rather than the small success-formula denominator discrepancy.

This would directly improve the Helper’s current flat rates. Normal and oak currently retain low-level guide rates above their original context, while Mining lacks a defensible ore/hour conversion and banked Fishing lacks throughput. [Current methods](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/app/data/training/methods.f2p.json:32>), [training research](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/research/training-helper.md:58>).

The new tables could explain **how much material a player retains, how much XP she earns, and how long a particular accessible route takes**. The Helper should preserve its current treatment of unknown rates until an entry has sufficient evidence. [Helper’s existing limits](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/helper.md:25>).

The principal sources for implementing and refreshing the model are:

- **Official changes:** Jagex’s [2019 mining rework](https://secure.runescape.com/m=news/mining-and-smithing-rework), [December 2024 Woodcutting update](https://secure.runescape.com/m=news/110-woodcutting--fletching--firemaking---new-skilling-update), and [April 2026 aura overhaul](https://secure.runescape.com/m=news/patch-notes-aura-overhaul).
- **Mining:** [Mining rev. 37194674](https://runescape.wiki/w/Mining?oldid=37194674), [Pickaxes rev. 36994546](https://runescape.wiki/w/Pickaxes?oldid=36994546), and [rate-calculator module rev. 37179407](https://runescape.wiki/w/Module:Mining_Rate_Calculator_Module?oldid=37179407).
- **Woodcutting:** [TreeData rev. 36706827](https://runescape.wiki/w/Module:SkillUtils/TreeData?oldid=36706827), [HatchetData rev. 37170712](https://runescape.wiki/w/Module:SkillUtils/HatchetData?oldid=37170712), and [SkillUtils rev. 36640342](https://runescape.wiki/w/Module:SkillUtils?oldid=36640342).
- **Fishing and success rolls:** [Fishing data rev. 37011174](https://runescape.wiki/w/Module:Fishing_chance_calculator/data?oldid=37011174), [Fishing calculator rev. 37011173](https://runescape.wiki/w/Module:Fishing_chance_calculator?oldid=37011173), and [generic success mechanics rev. 37009675](https://runescape.wiki/w/Skilling_success_chance?oldid=37009675).
- **Movement:** [Energy rev. 36948212](https://runescape.wiki/w/Energy?oldid=36948212), [Weight rev. 37158898](https://runescape.wiki/w/Weight?oldid=37158898), and [Surge rev. 37177973](https://runescape.wiki/w/Surge?oldid=37177973).
- **Storage and processing:** [Ore boxes rev. 36853238](https://runescape.wiki/w/Ore_boxes?oldid=36853238), [Wood boxes rev. 37004796](https://runescape.wiki/w/Wood_boxes?oldid=37004796), [Cooking rev. 37179285](https://runescape.wiki/w/Cooking?oldid=37179285), and [action timings rev. 37145287](https://runescape.wiki/w/Game_tick/Ticks_per_action?oldid=37145287).
- **Repo evidence:** the resource/NPC catalogues, [walkability research](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/research/cache-walkability.md>), [training research](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/research/training-helper.md>), and [Helper documentation](<C:/Users/User/Projects/chunk-picker-rs3-wt/redesign/docs/helper.md>).

## Step 1: Mining

Implemented on `codex/mining`, 12 October 2026. The Helper now shows separate
XP/hour and ore/hour estimates for copper, tin, iron, coal, silver, mithril,
adamantite, luminite, gold and runite. All supported rocks and tools are F2P.
Silver and gold have no natural critical-chance or double-ore milestones in the
pinned data. Upgraded iron/steel +1, mithril/adamant +1/+2 and rune +1/+2/+3 are
included. Orikalkum and later tools, members rocks and achievement bonuses are
excluded.

`app/training/mining-rules.mjs` holds the sourced parameters and revisions.
`node scripts/training/mining-generate.mjs` builds
`app/data/training/mining-rates.v1.json`; add `--check` to verify that the committed
table matches the rules. Generation requires no dependencies or network access.
The table stores expected damage and capped progress for each rock, pickaxe,
Mining level and Strength band. Runtime uses a constant-time lookup. The file
is **122,838 bytes gzip** (3,077,840 bytes uncompressed).

The requested Mining 1–99 range is covered. The table also preserves the
catalogue's existing F2P Mining limit of 110 and saved Strength levels through
120, with 13 bands `floor(Strength / 10)`. This adds no members rocks or tools.
The Helper uses current-account saved levels and exact starting XP. Unknown
Strength is explicitly assumed to be level 1. The default pickaxe is the best
F2P tool allowed by Mining level, labelled **Assumed**. It improves during a plan;
a selected tool stays fixed. Ownership and acquisition are not inferred.
Personal pickaxe and attention settings use the existing revision-checked
preference command, History, backup and Undo. View-only links have no preference
controls; their existing restriction on requesting new training plans remains.

The calculation includes:

- One swing every four 0.6-second ticks: 1,500 swings/hour.
- An inclusive uniform integer pickaxe damage roll, Mining level, the Strength
  band, hardness not covered by penetration, and independent critical hits.
  Hardness is deducted once. Damage has a minimum of one before stamina.
- Global critical chance at 59/85, critical-damage milestones including 105,
  each rock's critical-chance milestones and natural extra ore.
- Damage-based XP using the rock multiplier and global factor 0.4. XP uses the
  uncapped roll. Each swing's ore progress is capped at one rock durability;
  excess progress over the *remaining* bar carries into the next ore.
  Long-run ore production uses expected capped progress divided by durability,
  then applies natural double ore. Double ore does not add XP.
- Stamina unlock, capacity milestones, drain and an explicit Agility 1 capacity
  assumption. These are recorded as evidence; attention profiles use fixed
  stamina states instead of simulating click schedules.

**Active** keeps stamina full (100% damage). **Occasional** assumes maintained
partial stamina (90%), a planning proxy rather than a measured click interval.
**AFK** assumes drained stamina (20%) and excludes the initial full bar. Below
Mining 15, all profiles use full damage. These rates are **at the rock, no
banking**. They exclude rockertunities, movement, banking, handling, ore-box
actions, stone spirits, geode rewards, urns, outfits, perks and other boosts.
Inventory limits and logout interruptions are not simulated. An uninterrupted
hour is a rate unit, not a promise that an unattended character mines for an hour.

Time to a target sums each level's remaining XP divided by that level's rate.
Adjacent levels using the same rock/tool/profile share a displayed step, with
start/end rate ranges and an expected ore total. Other skills retain their
existing calculation. Advanced shows damage per swing, swings per gathered ore,
stamina factor and source revisions.

### Pinned evidence

The implementation re-checked these revisions, retaining clean source excerpts
under `tests/fixtures/mining/` and an independent formula port in
`scripts/training/mining-wiki-reference.mjs`:

| Source | Revision / date | Used for |
|---|---|---|
| [Mining](https://runescape.wiki/w/Mining?oldid=37194674) | 37194674 | Damage, XP, carry-over, per-swing cap, critical and stamina milestones |
| [Pickaxes](https://runescape.wiki/w/Pickaxes?oldid=36994546) | 36994546 | F2P tool eligibility, upgrades, damage and penetration |
| [Core rocks](https://runescape.wiki/w/Template:Mining/Core_rocks?oldid=37182499) | 37182499 | Core rock parameters |
| [Mining calculator module](https://runescape.wiki/w/Module:Mining_Rate_Calculator_Module?oldid=37179407) | 37179407 | Independent comparison formula |
| [MS Data](https://runescape.wiki/w/Module:MS_Data?oldid=37089129) | 37089129 | Calculator rock parameters, silver/gold and milestone tables |
| [Jagex's Mining and Smithing rework](https://secure.runescape.com/m=news/mining-and-smithing-rework) | 7 January 2019 | Non-depleting rocks, swing XP and progress-bar ore |

### Validation result and calculator differences

The independent port preserves the pinned module's formulas and data; it does
not import the generator's rules. **1,526 comparisons** cover ten rocks, fifteen
pickaxes, several levels, Strength 1/30/99 and all three stamina profiles where
the source conventions agree. Maximum difference: **147 XP/hour** and **zero
ore/hour**. Assertions allow `150 × stamina factor + 0.03 XP/hour` and
`0.003 ore/hour`. The XP tolerance reflects the wiki flooring mean XP to a tenth
per swing; the smaller allowance covers table rounding. It is an absolute
rounding tolerance, not a percentage claim about real-world accuracy.

Known formula differences have separate exact tests:

- The pinned module omits global critical chance at 59/85 and critical damage at
  105. Thirty comparisons at these milestones assert the article's values and
  the expected difference from the module; the largest selected-grid difference
  is 5,346 XP/hour and 30.1875 ore/hour.
- The module caps mean damage; this table caps each random swing's progress.
  At Mining 20, Strength 1, iron pickaxe, Active, copper gives 13,860 XP/hour and
  **1,320 ore/hour** here, versus **1,443.75 ore/hour** in the module.
- The module deducts hardness again from its critical bonus. The article applies
  it once: Mining/Strength 30 with a bronze pickaxe on mithril has expected
  damage 11.5 here, versus 8.5 in the module. Minimum-one damage is also applied
  separately to each roll.
- Below level 15 the module applies its selected stamina factor even though
  stamina has not unlocked. This table keeps all three profiles equal there.

These differences are documented source choices, not calibrated corrections.
No hour-long in-game observation was performed. The ten model tests also cover
deterministic regeneration, file size, carry-over/capping, natural double ore,
stamina milestones, invalid inputs and the existing F2P level limits.

For example, with Strength 30 and a mithril pickaxe, Mining 30 iron gives
**27,846 XP/hour and 895.781 ore/hour Active**, or **5,569.2 XP/hour and 179.156
ore/hour AFK**. At Mining/Strength 60, rune +3 on runite gives **61,674 XP/hour
and 355.031 ore/hour Active**. Banking and other interruptions reduce the ore
kept and XP earned per real hour. Woodcutting and Fishing are implemented in
Steps 2 and 3; banking routes remain next under C13.

### Browser and regression checks

**326 targeted tests passed**, with no failures or skips. Generator `--check`
and the independent source/formula review passed. The full `npm test` suite was
not run for this step.

An isolated copy of the duo save was checked under the shared heavy-work lock,
using one server on port 8794 and one disposable browser. Saved Mining 60 → 65
produced a complete plan of about 2.6 hours and 938.1 expected runite ore.
Inline preference saving, its exact History event and Undo, Settings, Advanced
mechanics/source revisions and hidden viewer controls passed. Desktop and 390px
phone views had no page-width overflow or application exceptions. The existing
viewer policy still prevents new plan calculations.

The original save's SHA-256 stayed unchanged. The copied save and browser
profile were deleted; the owned server and browser were stopped. Local captures
are `.local/screenshots/mining-helper-{desktop,390px}.png` and
`.local/screenshots/mining-settings-{desktop,390px}.png`; the report is
`.local/mining-browser-report.json`, and test output is `.local/mining-tests.log`.

## Step 2: Woodcutting

Implemented on `codex/woodcutting`, starting at `db137b7`. The Helper estimates
both XP/hour and logs/hour for all seven ordinary F2P tree types: normal, oak,
willow, teak, maple, acadia and yew. The saved player's Woodcutting level and
personal hatchet choice select an offline rate. The automatic choice follows
bronze, iron, steel, black, mithril, adamant and rune unlocks as the plan levels
up. A specific hatchet stays selected; choosing one above the starting level
explains its requirement and asks for a usable tool.

`app/training/woodcutting-rules.mjs` holds the sourced parameters and formula
convention. `node scripts/training/woodcutting-generate.mjs` builds
`app/data/training/woodcutting-rates.v1.json`; `--check` verifies byte-for-byte
regeneration. The shipped table is **36,047 bytes**, **11,314 bytes gzip**, with
one packed integer per eligible tree/hatchet/level combination through the
existing F2P cap of 110. Runtime lookup does no simulation or web fetch.

### Sources and success convention

All numerical source pages were fetched again on October 12. Genuine snapshots
and revision metadata are retained in `tests/fixtures/woodcutting/`; every source
also has its page and revision in the rules and table. The principal revisions
are [TreeData 36706827](https://runescape.wiki/w/Module:SkillUtils/TreeData?oldid=36706827),
[HatchetData 37170712](https://runescape.wiki/w/Module:SkillUtils/HatchetData?oldid=37170712),
[SkillUtils 36640342](https://runescape.wiki/w/Module:SkillUtils?oldid=36640342),
and [Woodcutting calculator 37183488](https://runescape.wiki/w/Module:Woodcutting_chance_calculator?oldid=37183488).
The tree-page revisions listed in the feasibility table above supply respawn
timers. [Woodcutting 37196294](https://runescape.wiki/w/Woodcutting?oldid=37196294)
supplies the four-tick interval and ordinary F2P scope. The current hatchet
powers already include Jagex's
[April 13 aura overhaul](https://secure.runescape.com/m=news/patch-notes-aura-overhaul);
the calculation applies no additional Lumberjack multiplier.

This step chooses the **SkillUtils/Woodcutting calculator convention**. With
base chance `B`, hatchet power `P` and Woodcutting level `L`:

```text
low  = B*10000 + floor(floor(B*10000/2)*(P-100)/100)
high = floor(low*3.125)
chance = clamp((floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1)
               / 2560000, 0, 1)
```

The hatchet's excess power has half weight. Rune therefore scales the base low
endpoint by **3.65**, rather than 6.3. Interpolation continues above level 99
through the catalogue's level 110 cap, with success capped at 100%.

The [generic success article 37009675](https://runescape.wiki/w/Skilling_success_chance?oldid=37009675)
instead gives `low + floor((high-low)*(L-1)/98)` over **2,550,001**, using these
already-scaled Woodcutting endpoints. Across the same 3,503 eligible cases,
that convention increases uninterrupted rates by at most **0.3921175%**.
Its separate absolute maxima are **5.848728 logs/hour** and **361.047390 XP/hour**.
The rules record this choice and measured difference. Neither convention is
claimed to be verified current server code.

### Felling, respawn and exclusions

The plain-language assumption is **at the tree, no banking**. The default waits
for one tree's full respawn after felling, then clicks again immediately:

```text
expected seconds/log = 2.4/chance + fellingChance*respawnSeconds
logs/hour = 3600/expected seconds/log
XP/hour = logs/hour * base XP/log
```

Oak through yew use the documented 32/256 felling roll. Normal trees retain the
**provisional 96/256 roll**, with a 47.1-second midpoint of their documented
35.4–58.8-second random respawn. The midpoint is an assumed mean; the source
does not establish the distribution. The re-checked dates correct the spike's
earlier claim: normal trees gained multiple logs on January 20, 2025, and the
April 26, 2025 TreeData revision postdates that change.

No banking, wood-box handling, dropped-log handling, movement between trees,
other woodcutters, bird nests, spirits, urns, outfits, perks, boosts or extra
XP/log bonuses are modelled. There is no attention control: this version
assumes immediate restart and has no sourced Active/Occasional/AFK reaction
schedule. Waiting for one tree is conservative relative to immediately
switching to another available tree; real click and banking delays add time.

The F2P wiki also lists **six Daemonheim trees**: tangle gum, seeping elm, blood
spindle, utuku, spinebeam and bovistrangler. Their explicit coverage records in
`WOODCUTTING_UNMODELLED_TREES` retain levels and XP but mark rates **unknown**.
These finite, non-respawning nodes use separate dungeon hatchets; the inspected
sources provide no success endpoints or repeatable dungeon gathering cadence.
They cannot use the overworld curve. Their individual pages, Dungeoneering
Woodcutting and Novite hatchet are pinned in the rules and fixtures. Achey,
hollow and bloodwood trees are members-only and excluded. Hourly estimates for
the dungeon trees remain an unresolved part of full F2P gathering coverage.

### Validation and integration

An independent no-bonus port in `scripts/training/woodcutting-wiki-reference.mjs`
parses tree and hatchet parameters from the retained Lua snapshots. It does not
import the production rules, lookup or generator. All **3,503** eligible
tree/hatchet/integer-level combinations from 1–110 match the pinned calculator's
uninterrupted logs/hour and XP/hour exactly: **worst delta 0**, with an asserted
absolute floating-point tolerance of **1e-10**. Separate checks validate the
added renewal downtime, the alternate convention, F2P unlocks, invalid inputs,
provisional normal depletion, deterministic generation and file size.

| Example | Default logs/hour | Default XP/hour | Before depletion: logs/hour / XP/hour |
| --- | ---: | ---: | ---: |
| Willow, level 30, mithril | 336 | 22,673 | 397 / 26,799 |
| Acadia, level 75, rune | 633 | 50,622 | 891 / 71,301 |
| Yew, level 75, rune | 285 | 53,375 | 334 / 62,667 |

The acadia example reproduces the research's approximately 891 logs/hour and
71,300 XP/hour before depletion. Its 1.65 seconds of expected respawn downtime
per log lowers the default rate. This addition is the deliberate difference
from the wiki calculator, which reports uninterrupted cutting rates.

Helper sums each level's exact XP gap over that level's rate, preserves current
exact XP, and accumulates expected logs. Whole-number rate displays, a quiet
hatchet assumption, Advanced mechanics/source details and read-only viewer
controls follow Mining's layout. Hatchet settings use the normal revision-checked
command, personal ownership, History and Undo. Existing skills without curves
keep their behavior. The death estimator's earlier self-supplied log routes
retain their guide profiles and handling allowance separately in
`death-woodcutting-guide.v1.json`; banking and personal tool assumptions for
those routes remain future work. The repository's own skill-guide builder
regenerated provenance hashes; training candidate counts stayed unchanged.

### Browser and regression checks

Full `npm test -- --test-concurrency=1`, under `.local/with-heavy.ps1`, passed:
**2,819 tests, 2,818 passed, zero failures/cancellations and one existing
generated-PNG skip**, in 544.16 seconds. The initial concurrent run was stopped
when free memory fell below 2 GB. Its map-reference failure passed both an
isolated check and the completed serial suite; that test was not changed.
Targeted checks also passed for both gathering models, planning/API behavior,
settings, History/Undo, provenance and the preserved death supply routes.

A private copy of the duo save was checked under the same lock with one server
on **8796** and one disposable Chrome profile. Its current saved Woodcutting was
**77**, and a **77 → 82** plan displayed **54,130–55,630 XP/hour** and
**289–297 yew logs/hour**, with the automatic rune assumption. Planning made no
revision change. Inline personal preference saving, its exact History event,
revision-checked API Undo, Advanced mechanics/source revisions and absent viewer
controls passed. No browser exceptions or failed requests were recorded.

Desktop 1440px and phone 390px captures have no page-width overflow. All hatchet
option labels fit; the phone Settings select occupies its own full-width grid
row beneath the description. Captures are
`.local/screenshots/woodcutting-helper-{desktop,390px}.png` and
`.local/screenshots/woodcutting-settings-{desktop,390px}.png`. The report is
`.local/woodcutting-browser-report.json`, and the full suite log is
`.local/woodcutting-full-tests-serial.log`.

The original save's SHA-256 stayed unchanged. The copied save and disposable
profile were deleted, and the owned browser/server were stopped. These checks
validate the local implementation and its pinned wiki comparison; no hour-long
in-game measurement was performed.

## Step 3: Fishing

Implemented on `codex/fishing`, starting at `claude/redesign` commit `4ac7153`.
The Helper replaces Fishing's flat guide rates with level-aware XP/hour and
fish/hour for eight ordinary F2P methods. Existing catalogue IDs remain usable,
including dropped and kept crayfish/trout variants. Added methods cover small
nets, sea bait, pike, tuna before swordfish unlocks, and Ashdale/Davendale minnows.
No tool-tier or attention setting is added: F2P tools select the fishing method.

`app/training/fishing-rules.mjs` holds sourced parameters, method order,
exclusions and coverage limits. `node scripts/training/fishing-generate.mjs`
builds `app/data/training/fishing-rates.v1.json`; `--check` verifies deterministic
regeneration. The table contains packed integer raw rolls for eligible levels
1–99, using the existing Fishing cap. It is **13,501 bytes**, **4,098 bytes gzip**.
Runtime performs a lookup and combines conditional rolls, without web requests
or simulation.

### Pinned evidence and formula

The source pages were fetched again on October 12 through the Wiki's revision
API. Genuine source snapshots, SHA-256 hashes and revision metadata are retained
under `tests/fixtures/fishing/`. Principal sources:

| Source | Revision | Used for |
| --- | ---: | --- |
| [Fishing calculator data](https://runescape.wiki/w/Module:Fishing_chance_calculator/data?oldid=37011174) | 37011174 | Catch endpoints, unlocks, base XP and species order |
| [Fishing calculator implementation](https://runescape.wiki/w/Module:Fishing_chance_calculator?oldid=37011173) | 37011173 | Interpolation, conditional rolls, four/five-tick attempts |
| [Fishing](https://runescape.wiki/w/Fishing?oldid=37195568) | 37195568 | F2P scope, tools and attempt intervals |
| [F2P Fishing training](https://runescape.wiki/w/Free-to-play_Fishing_training?oldid=37189069) | 37189069 | Practical guide context and excluded bonuses |
| [Raw minnow](https://runescape.wiki/w/Raw_minnow?oldid=36688690) | 36688690 | F2P Ashdale/Davendale locations, rod, no bait, 12 XP/catch |

The chosen convention follows the Fishing module, which floors the combined
interpolation once and divides by 256, without an extra +1 success outcome:

```text
rawRoll = floor(((99-level)*low + (level-1)*high)/98)
rawChance = clamp(rawRoll/256, 0, 1)
catchChance = (1-sum(previous eligible species catch chances))*rawChance
species fish/hour = 3600/(attemptTicks*0.6)*catchChance
total XP/hour = sum(species fish/hour * species XP/fish)
```

Locked species are skipped, leaving the full attempt available to the lower
species. At the unlock, the higher species is rolled first. The parameters are:

| Method, in roll order | Required levels | XP/catch | Low/high | Ticks |
| --- | --- | --- | --- | ---: |
| Minnow | 1 | 12 | 200/256 | 4 |
| Crayfish | 1 | 10 | 200/256 | 4 |
| Anchovies, shrimp | 15, 1 | 40, 10 | 24/128, 48/256 | 4 |
| Herring, sardine | 10, 5 | 30, 20 | 24/128, 32/192 | 4 |
| Salmon, trout | 30, 20 | 70, 50 | 16/96, 32/192 | 4 |
| Pike | 25 | 60 | 16/96 | 4 |
| Lobster | 40 | 90 | 6/95 | 4 |
| Swordfish, tuna | 50, 35 | 100, 80 | 4/48, 8/64 | 5 |

The [generic success article](https://runescape.wiki/w/Skilling_success_chance?oldid=37009675)
instead uses `10000*(low+floor((high-low)*(level-1)/98))/2550001` for these
unscaled Fishing endpoints. Across the same grid, that alternative increases
XP by at most **0.392117493%**. Separate absolute maxima are **5.858786765
fish/hour** and **209.213456142 XP/hour**. Tests record this convention difference;
neither formula is claimed to reproduce verified current server code.

### Validation and Helper behavior

An independent port in `scripts/training/fishing-wiki-reference.mjs` parses
parameters and roll order from the retained Lua source. It does not import the
production rules, generator or runtime. All **672 eligible method/level cases**
and **967 species comparisons** match the pinned calculator exactly, with
**zero maximum XP/hour or fish/hour difference** and an asserted absolute
floating-point tolerance of **1e-10**. Additional tests cover unlocks, conditional
rolls, cadence, invalid inputs, corrupt packed values, deterministic regeneration,
source hashes, size and unknown special methods.

At Fishing 99, fly fishing gives **74,531 XP/hour**, **1,266 fish/hour**:
**563 salmon/hour and 703 trout/hour** after rounding each displayed value.
The guide's practical upper estimate is 67,000 XP/hour. This difference reflects
the uninterrupted calculator baseline versus the guide's practical profile;
it is not a calibrated correction for an observed spot. Independently rounded
species and total rates can differ by one fish.

Helper time adds each level's exact remaining XP divided by that level's rate.
Expected bait/feather use and each species' catches accumulate over those same
intervals. Adjacent levels share a displayed step when the method and eligible
species remain the same, with whole-number start/end rate ranges. An unlock
creates a separate step when the eligible species change. Unknown economics
stay unknown, and dropped catches do not become retained stock. Sources for
tools and bait prove obtainability, not ownership. Skills without curves retain
their existing behavior. Planning does not save account progress or check tasks;
viewer links retain their existing read-only policy.

### Assumptions and remaining coverage

The default wording is **At the spot, no banking, not counting spot moves.**
It appears once in each plan step, without repeating on every usable-method row.
Dropping, storing catches, full inventories, travel, urns, outfits, boosts and
other bonuses are excluded. Advanced adds attempt timing, each raw roll and
conditional catch chance, roll order and source revisions. No spot-relocation
distribution or reaction delay was established, so none is invented.

Minnows use Ashdale or Davendale spots; native location access still gates them.
The imported minnow task mentions bait,
whereas the pinned Wiki page explicitly says a rod without bait. The catalogue
follows that sourced requirement and records the mismatch without changing the
native task.

The Wiki also documents six F2P Daemonheim species: heim crab, red-eye, dusk eel,
giant flatfish, short-finned eel and web snipper. Their finite spots allow at most
14 catch chances, with no verified repeatable gathering cadence or success
endpoints. Puzzle vile fish award Fishing XP on only the first three catches,
with variable requirements/XP. The monthly Giant Oyster activity has its own
level-dependent XP and availability. Eight coverage records retain these cases
as **unknown hourly rates**, with individual pinned pages and fixtures; they do
not borrow an ordinary overworld curve. Rainbow fish are members-only. Special
activity rates, real spot moves, banking and noting routes remain future work.

The repository skill-guide builder regenerated provenance hashes and candidate
counts from the changed catalogue; no hashes were patched by hand.

### Browser and regression checks

An isolated copy of the duo save was checked under `.local/with-heavy.ps1`,
with one server on port **8881** and a disposable browser. Player 1's saved
Fishing **56 → 61** plan preserved her exact starting XP: **102,078 XP needed**,
about **1.9 hours**, **700 salmon**, **1,062 trout**, and **1,762 feathers**.
The step displayed **51,750–54,375 XP/hour** and **894–938 fish/hour**. These
are the stated at-spot estimates, excluding handling and spot moves.

The visible spot assumption appeared once per step and did not repeat in
usable-method rows. Advanced showed raw and conditional catch chances and
source revisions. Viewer estimate controls were hidden and new training-plan
requests returned 403. No browser exceptions occurred. Desktop **1440px** and
phone **390px** views, in normal and Advanced mode, had no page-width overflow.
Captures are `.local/screens/fishing-desktop-1440.png`,
`.local/screens/fishing-phone-390.png`, and the corresponding
`fishing-advanced-{desktop-1440,phone-390}.png` files. The compact report is
`.local/fishing-browser-report.json`.

Planning left the copied gameplay state unchanged. The original save's SHA-256
stayed unchanged, the copied save was deleted, and the owned browser and server
were stopped. No in-game rate or performance measurement was performed.

Final `npm test -- --test-concurrency=1`, under the same shared lock, passed:
**2,836 tests, 2,835 passed, zero failures/cancellations, one existing
generated-PNG skip**, in **405.95 seconds**. Output is retained in
`.local/fishing-full-tests.log`. Focused tests also cover the Fishing source grid,
level integration, species unlocks, expected bait use, drop/keep behavior,
whole-number displays, source revisions and the unchanged planning APIs.

## Step 4: Banking

Implemented on `codex/banking`, 13 October 2026. Helper compares Drop and Bank
per physical spot and uses the saved **Finish each backpack** choice for target
times. The underlying level/tool curves remain unchanged. Bank multiplies both
XP and resources by the gathering fraction of the full repeating walking cycle;
Mining XP is never inferred from a fixed XP/ore. Box ownership defaults to None
and is saved through the existing revision-checked preference command, History,
backup and Undo. Viewer links receive no settings controls.

`app/training/banking-routes.mjs` uses a multi-source breadth-first tile search
to the nearest reviewed usable surface bank/deposit, or Stiles for compatible
fish. Every path tile and both diagonal corner tiles must belong to admitted
components in unlocked chunks. F2P also applies the existing component policy
and copied-cache 8×8 membership mask. Paths are reciprocal and return over the
same route. Missing coverage or unreviewed services yields **Banking time
unknown**; no witnessed route with reviewed coverage yields **No bank reachable
in your chunks**. Source-specific exclusions/backlogs remain in force.

`app/data/training/banking-masks.v1.json` is a portable 988 KB export of 1,211
decoded regions from the pinned `cache-audit-2026-10-07-v4` masks. It stores
component labels and conservative eight-direction movement, with exact cardinal
wall clipping and no diagonal corner cutting. Regions inflate only for the
admitted territory; the provider keeps at most two territory fields. Regenerate
with `node scripts/training/banking-export.mjs <read-only masks directory>`;
the input directory needs `walkability.v1.json.gz` and `membership.v1.json`.
Source hashes and movement encoding remain in the export provenance.

`banking-destinations.mjs` matches physical cache service identities to the
existing bank review, adding the verified Taverley service and Port Sarim
deposit. May's Caravan and the Cooks' Guild bank are not F2P destinations.
Stiles is at (2851,3143), supports only tuna/lobster/swordfish and reserves one
noted backpack stack per eligible species on repeating trips. A real static
Musa Point fixture routes to him in 76–77 steps each way, all within its four
admitted chunks; locking his chunk removes the route.

`banking-fishing-spots.v1.json` contains 28 F2P map-marker positions from pinned
Wiki NPC pages for net/bait, lure/bait, crayfish and cage/harpoon methods.
Adjacent shore/dock tiles start the route. These establish possible positions,
not active NPC observations or a complete relocation distribution. Minnows have
no reviewed physical positions. Untyped normal-tree placements likewise remain
unknown instead of receiving a guessed centre or invented route.

`app/training/banking-rates.mjs` accounts for 28 backpack slots, one carried box,
per-resource box capacities/milestones, one bait/feather stack and shared mixed
catch occupancy. Duplicate boxes never increase storage. Acadia boxes do not
hold yew logs. Stored contents add no weight. Box fill/empty interactions assume
1.2 seconds each; destination interaction assumes three seconds. These are
explicit planning assumptions, not measured timings. Drop assumes zero handling
and remains an upper bound. Other carried items, urns and equipped weight are
not recorded by the current controls; tools are assumed equipped/on the belt.

Advanced includes a separate low-weight running scenario using 0.7% energy per
run tick and uncertain 0.8% recovery/second. Energy carries through gathering,
handling, outbound travel, return travel and subsequent trips. A leg runs until
energy is exhausted, walks the remainder, and retries running on the next leg.
The sustainable cycle is used after initial transients; energy is never reset
to full per trip. Walking always supplies the selected plan's time estimate.

Closed doors and conditional cache morphs may hide actual gameplay routes.
Unreviewed NPC services, upstairs/interior banks, metal-bank destinations,
lodestones, Surge and processing cycles remain outside this verified surface
variant. One-tree depletion and Fishing relocation limitations from Steps 2–3
continue to apply. No in-game movement or hour-long rate calibration was done.

### Verification

The five focused banking files pass **46 tests**. They cover shortest paths,
locked intermediate chunks, F2P services/tiles, blocked corners, reciprocal
movement across all exported masks, source restrictions, no-bank versus unknown
coverage, per-type box capacity, mixed catches, recurring Stiles stacks and
sustainable run energy. Planner/controller/server checks also pass; the final
quick suite passes **996 tests**.

One locked browser session checked the authored build on port 9201 using an
isolated copy of the duo save, excluding the original lock/access token. Mining
60 → 65 selected a walking adamantite route at roughly 3.2 hours, with separate
Drop and Bank rates; a temporary Fishing 50 scenario exposed the three Musa
Point Stiles positions. Saving Bank through the actual control produced History
and Undo restored the copied preference. No browser exceptions or horizontal
overflow occurred. Captures are `.local/screens/banking-desktop-1440.png` and
`.local/screens/banking-phone-390.png`; the compact report is
`.local/screens/banking-acceptance.json`. The copy was deleted and both owned
processes stopped. The original save and its live server were never used for
these calculations.

The single final full `npm test` run, under the shared heavy-work lock, passed
**3,632 tests: 3,631 passed, zero failures/cancellations and one existing skip**
in **294.65 seconds**. Output is `.local/banking-full-tests.log`.

## Step 5: Processing, upstairs banks and personal travel

Implemented on `codex/gathercalc2`, 15 October 2026. This extends Step 4;
the exclusions in that historical section describe its earlier surface-only
version. The calculator retains the existing panel, personal revision-checked
preferences, History, backup and Undo. Viewers receive no write controls.
No private dataset input or data-pack value was edited.

### Processing before dropping

`app/training/gathering-processing.mjs` divides a repeating backpack cycle into
gathering, processing, dropping and menus. The gathering fraction scales both
the original skill XP and resource rate. Cooking/Fletching XP is shown separately
and never counts toward the gathering-skill target. The comparison states its
starting level; it is not an average over a merged multi-level plan.
The secondary skill stays at its saved personal level throughout the plan;
extra XP does not simulate Cooking/Fletching level-ups or new recipes.

Cook and drop covers twelve ordinary F2P fish, using four ticks per cook and
the fish's base successful-cook XP. A saved personal Cooking level and a
confirmed sustained fire/range at the spot are required. Missing facility or
level data leaves the selected processing rate unknown. Below the published
conservative no-burn level, missing success probabilities produce a Cooking XP
range. Advanced permits a labelled success scenario; it does not infer a burn
formula. Fire creation, fuel, expiry, facility travel, special ranges and bonfire
XP bonuses are excluded. Burnt food now stacks; charging one drop per input is
a conservative handling assumption.

Fletch and drop uses three ticks per log and the highest-XP eligible reviewed
recipe, including shafts, unstrung bows and teak stocks. Current F2P coverage
includes normal, oak, willow, teak, maple and acadia logs. The July 2026 tiers
make yew recipes members-only despite yew logs being F2P. Shafts occupy one
output stack per batch; every output is dropped. Ineligible species in a mixed
batch are explicitly dropped raw. Default drop time is 0.6 seconds per item or
output stack, plus 1.2 seconds per processing menu/species. These are planning
assumptions; plain Drop retains its earlier zero-handling upper bound.

Pinned sources, checked through Wiki revision content on 15 October, are
recorded with revision timestamps and source SHA-256 in `PROCESSING_SOURCES`:

| Page | Revision | Use |
|---|---:|---|
| [Cooking](https://runescape.wiki/w/Cooking?oldid=37179285) | 37179285 | Fish levels, base XP and conservative no-burn levels |
| [Fletching](https://runescape.wiki/w/Fletching?oldid=37194649) | 37194649 | Current recipe tiers, XP and membership |
| [Shaft](https://runescape.wiki/w/Shaft?oldid=37171926) | 37171926 | Shaft quantity, XP and eligibility |
| [Teak stock](https://runescape.wiki/w/Teak_stock?oldid=37120515) | 37120515 | Level 33, 21 XP |
| [Ticks per action](https://runescape.wiki/w/Game_tick/Ticks_per_action?oldid=37145287) | 37145287 | Ordinary cooking and fletching intervals |
| [Burnt food](https://runescape.wiki/w/Burnt_food?oldid=37054897) | 37054897 | Stackable burnt outputs |

### Upstairs walking and stairs

Ground-floor routes already walk to a bank's physical interaction perimeter,
including any admitted building interior. The weighted search now adds known
interior overhead before selecting a bank. `banking-interiors.mjs` adds the
Lumbridge Castle second-floor booth at (3208,3221,plane 2), via either recorded
2×2 staircase at (3204,3207) or (3204,3229). Coordinates, placement IDs and hashes
come from the existing `objects-2026-10-08-v3` exports. The surface approach must
pass the same admitted-tile and F2P checks as every other bank route.

The interior catalogue has no verified upstairs player landing or collision
route here. Upper walking therefore uses the diagonal-distance lower bound
from the upstairs staircase footprint to the booth origin: 13 south or 8 north
tiles. Each of two floor changes assumes 1.2 seconds. This adds 10.2 or 7.2
seconds each way and is labelled estimated in the normal view. Advanced states
the missing geometry and timing evidence. These estimates create no access
edges. Other unlocated upstairs/interior banks remain unknown; the members
cellar chest is excluded.

Service eligibility is pinned to [Lumbridge Castle, revision 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520)
and [Bank booth, revision 37076387](https://runescape.wiki/w/Bank_booth?oldid=37076387).
Stair timing is an assumption, not a Wiki fact or an in-game measurement.

### Lodestones and Surge

The route provider compares walking with a confirmed lodestone cast, the walk
from its landing to a usable bank, and the complete walk back to the gathering
spot. A different bank may win. Only a faster cycle is selected. The cast uses
ordinary Home Teleport's 17 ticks (10.2 seconds), without quick-teleport charges
or cosmetic overrides. Activation comes from that player's existing transport
confirmations, personal usable overrides or matching available saved teleport;
saved teleports must match the lodestone identity/name and destination chunk.
The partner's unlocks and a reachable map icon do not prove activation.
Members destinations stay excluded on F2P worlds. Explicitly forbidden teleport
origins are excluded; otherwise the estimate assumes a safe uninterrupted cast.

Exact typed landing coordinates come from the existing transport catalogue.
They must also be admitted in the portable walking mask. Several real landings
are blocked or unresolved in this static snapshot, so those variants remain
unknown and walking remains available. No neighbouring landing is invented.

The optional personal Surge choice declares its unlock; a saved Agility level
below 5 vetoes it. Savings apply only to straight, checked surface stretches of
at least ten tiles. The model uses the ordinary 20.4-second cooldown across both
legs, assumes one tick per cast conservatively, and starts each new trip at the
worst remaining cooldown before gathering recovery. No Double Surge, Mobile,
upstairs shortcut or global optimal ability-route claim is made. Missing path
geometry gives ordinary walking. Advanced's existing running scenario remains
separate from the selected walking/teleport/Surge estimate.

`BANKING_TRAVEL_SOURCES` records [Home Teleport, revision 37178861](https://runescape.wiki/w/Home_Teleport?oldid=37178861)
and [Surge, revision 37177973](https://runescape.wiki/w/Surge?oldid=37177973),
including revision timestamps and content SHA-256. Both were checked on
15 October. All new handling/travel rates remain estimates; no in-game
calibration or hour-long gathering measurement was performed.

### Verification for this branch

Focused checks cover recipe XP/timing, F2P and personal level gates, burn bounds,
missing facilities, weighted upstairs entrances, exact admitted lodestone
landings, full return walks, Surge geometry/cooldown, and personal
History/backup/Undo. The final private quick run passed 1,512 tests with one
existing skip. The broader focused integration run passed 122 tests; the final
travel-display check passed 17 tests.

Gallery checks passed 95/95 previews both plain and `FRAMED=1`. The light-locked
browser acceptance used one disposable copy on port 8916 and saved Fletch and
drop through the real control. Player 1's copied observations were Woodcutting 77,
Fletching 69 and Agility 5; no new RuneMetrics request was made. The normal
comparison showed reduced Woodcutting XP/resources and separate Fletching XP.
Captures at 1440 and 390 pixels have no horizontal calculator overflow or browser
exceptions. Files are `.local/screens/gathering-desktop-1440.png`,
`gathering-phone-390.png`, and the corresponding `gathering-options-*` captures;
the receipt is `.local/screens/gathering-acceptance.json`. Owned browsers and
servers stopped and the save copies were deleted. Earlier capture-script
readiness retries produced no screenshots or application exceptions.

`scripts/dataset-parity.mjs` passed under the heavy lock on a fresh disposable
save copy. Default and newly built packed profiles matched all compared hashes;
selection metadata checks passed, read-only requests preserved gameplay, and
Undo restored both copies. The parity script deleted its copies and disposable
pack. No installed pack or private dataset input was modified.

The single final `npm test` run under the heavy lock passed **4,255 tests with
two existing skips**, zero failures/cancellations, across 424 files in
805.09 seconds. Heavy work finished at **13:39 local time**, before the
18:00 cutoff. The full log is `.local/gathercalc2-logs/full.log`; parity, quick,
focused and gallery logs are retained alongside it. No separate performance
benchmark or in-game calibration was run.
