# RuneScape Wiki chunk audit — 2026-10-17

The two passes cover **41 chunk/rule scenarios across 32 coordinate chunks**, using 66 fresh-player captures and **330 bounded Wiki checks**. Together they produce **180 matches, 21 confirmed differences, 91 rule or starting-position sensitivities, and 38 unresolved per-pass observations**. Repeated checks across passes are counted as separate observations, not independent root causes. The picker remains useful for finding activities, but these results do not support a complete playable checklist or a global accuracy percentage.

The largest repeated defects are incomplete source/entry gates, missing ordinary harvest outputs, and missing paid NPC supplies. Members settings reveal local supplies but do not guarantee many displayed goals: Nardah shows 2 tasks, its northern desert 0, and Canifis 0, under the saved presentation rules. Source closure is much larger than these display counts.

The original 25-chunk default-rule pass is preserved below. The [15-chunk saved-rules members follow-up with a targeted control](#members-follow-up) adds real rule settings to fresh players; it does not copy account progress. The [combined ranking](#combined-ranking) supersedes the first-pass ranking.

In the first pass, the picker represented many ordinary local supplies correctly. Its largest confirmed problems were members-only interiors contributing F2P sources, missing wild-crop harvesting, and missing NPC dialogue purchases. All 11 ordinary ground-spawn probes were present; this audit found no evidence for a blanket missing-spawn class.

Across 25 chunks, 214 bounded checks produced **102 matches, 12 confirmed differences, 76 rule or starting-position sensitivities, and 24 unresolved checks**. The 12 differences are eight missing checks, one false offer and three wrong-requirement checks. They are not 12 independent root causes: one missing onion source also blocks yellow dye, for example. These counts are not a global accuracy estimate.

## First-pass scope, defaults and comparison method

This is a report-only audit of public core `555b85b` with the requested companion release `rel1`. No application code or game data was changed. Full task, item, training, transport and bank-candidate captures, scratch saves, source selectors and retrieval responses remain in private working artifacts. Only authored comparisons and aggregate observations are published here; no private catalogue or game-cache records are reproduced.

Facts are adapted from RuneScape Wiki contributors, credited through revision-pinned links beside each finding. Adapted Wiki material in this report is under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), separately from the repository’s MIT code licence. No game images are reproduced.

The Wiki API was queried with a descriptive audit User-Agent, using `action=query` and revision content. Requests were batched, spaced at least 1.15 seconds apart, and cached privately. Every cited revision was checked against its retrieved page; no citation postdates the audit date. The initial independent checklist had 208 checks. Six targeted follow-ups added wild crops, instance admission and a cellar positive control, giving 214. This is a bounded audit, not a census of every drop, recipe or activity.

Each literal scratch save contains one fresh player, exactly one unlocked base chunk, empty saved rules, no completed tasks or quests, no inventory overrides and no recorded teleports. Defaults resolve to F2P content, transport admission off and automatic travel off. Shared-access defaults make no difference with one player. Default presentation hides blocked rows and some lower goals; “picker count” below counts displayed available tasks, not the full task catalogue.

A literal save has no starting-section seed. Most split chunks therefore correctly report that entry must be established and expose no local sources. Calling that missing data would be misleading. A second 25-run sensitivity confirms only the ordinary main starting section, where that section exists, through the revision-checked command system. It leaves rules, player count, base ownership, inventory, quests and levels unchanged. It does not unlock every component or neighbouring surface chunk. Both captures are retained and counted separately.

An explicit starting-section confirmation can bypass a retained membership gate. For Seers’ Village, West Ardougne and Canifis, the anchored outputs are consequently manual-start sensitivities, not evidence of normal F2P admission. Normal F2P starting selection would exclude members land. Conversely, a legitimate F2P surface start does not authorise entry into a connected members-only instance: the three scored instance failures below survive that distinction.

Chunk ownership does not establish a legal journey into quest-gated Havenhythe. The four Havenhythe starts are conditional local-placement experiments, not claims that a fresh account has completed the entry journey. Members-mode gameplay was not rerun in the first pass; the follow-up below supplies that separate scenario. Nardah-area exclusions under default F2P are expected policy; they do not show that its member activities are missing.

An inferred training ceiling is potential progression, not the player’s present level. Obtainable items form a source closure, not an owned backpack or a simulated wallet. The engine’s unrecorded-level fallback is 1 for every skill, including Constitution; a normal fresh character starts Constitution at 10 ([Constitution, rev. 37181229](https://runescape.wiki/w/Constitution?oldid=37181229)). Defaults were preserved; no affected task defect is inferred from this distinction alone. The comparison allows ordinary default [tool-belt tools, rev. 37070189](https://runescape.wiki/w/Tool_belt?oldid=37070189), not imported upgrades, food or cash.

Shops need positive base stock and locally attainable funding. Zero-stock entries do not provide Ironman supply through another player. Nearby resources need an attainable training route. Quest starts, capability to finish, and recorded personal completion are separate. One-time quest rewards must not become renewable sources or items already owned.

Travel was evaluated separately from source access. No sampled run gained an additional surface base through default transport, and no personal lodestone activation was injected. Local lodestone metadata is not permission to teleport out. Bank captures record physical/source candidates and reviewed upstairs evidence; they do not evaluate a complete usable-bank route or interaction. An empty candidate list cannot prove there is no bank. Full bank and deposit-only services are kept distinct.

## First-pass reproducible sample

Coordinate IDs are defined here as `floor(x / 64) * 256 + floor(y / 64)`. Each surface square is 64 × 64 tiles. Height, walls, water and connected interiors need separate access evidence; an area’s familiar name does not enlarge its coordinate bounds.

Seed: **20261017**. Use unsigned 32-bit state, `s = (1664525 * s + 1013904223) >>> 0`, then `u = s / 4294967296`. For each stratum in the order below, retain required anchors, shuffle the remaining input pool by descending Fisher–Yates with `floor(u * (i + 1))`, then fill its quota.

The candidate pools were chosen for coverage before comparison. Some strata include their entire pool; three anchors are fixed. Randomness chooses the other slots. This is a purposive stratified sample, not a random sample of the whole game.

| Stratum | Quota | Input pool in order | Required anchors |
|---|---:|---|---|
| f2p-town | 5 | 12850, 12853, 11828, 12338, 12342 | None |
| rural-resource | 3 | 12852, 12593, 12595, 11826, 13107, 13108 | 12852 |
| travel-coast | 3 | 11569, 12082, 13105, 11574, 11575, 13881 | 11569, 12082 |
| interior-entrance | 3 | 12340, 12337, 12341 | None |
| member-town | 4 | 11061, 10806, 10035, 10547, 13878, 10288 | None |
| havenhythe | 4 | 16179, 16180, 16435, 16436, 16689, 16692, 16694, 16950, 17204 | None |
| nardah | 3 | 13613, 13614, 13869 | None |

Chosen IDs in run order: **12850, 12853, 12342, 12338, 11828, 12852, 12595, 13107, 11569, 12082, 13105, 12340, 12337, 12341, 10806, 11061, 10035, 13878, 16694, 16435, 16950, 16436, 13613, 13869, 13614**.

## First-pass per-chunk results

**Picker = literal → main-section sensitivity displayed task count. Wiki = listed checks**, including exclusions and requirements, rather than a count of all possible activities. These are different units and must not be divided into an accuracy percentage. M = missing; O = offered but should not be; Q = wrong requirement; L = wrong location; R = rule/starting-position dependent. R is not a confirmed defect. Unresolved checks are U; matches are ✓.

| Chunk and Wiki area | Picker | Wiki | M | O | Q | L | R | ✓ | U |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [12850 — Lumbridge Castle and town](#12850) | 2 → 47 | 11 | 0 | 0 | 0 | 0 | 2 | 8 | 1 |
| [12853 — Varrock square and east bank](#12853) | 2 → 37 | 10 | 0 | 0 | 1 | 0 | 1 | 7 | 1 |
| [12342 — Edgeville](#12342) | 2 → 36 | 8 | 0 | 0 | 0 | 0 | 2 | 4 | 2 |
| [12338 — South Draynor](#12338) | 2 → 39 | 9 | 3 | 0 | 0 | 0 | 0 | 5 | 1 |
| [11828 — West Falador](#11828) | 45 → 45 | 9 | 0 | 0 | 1 | 0 | 0 | 7 | 1 |
| [12852 — Gower farm and Varrock lodestone](#12852) | 29 → 29 | 8 | 0 | 0 | 0 | 0 | 1 | 5 | 2 |
| [12595 — Mill Lane Mill and cattle field](#12595) | 32 → 32 | 9 | 1 | 0 | 0 | 0 | 0 | 6 | 2 |
| [13107 — Al Kharid mine](#13107) | 2 → 33 | 10 | 1 | 0 | 1 | 0 | 0 | 7 | 1 |
| [11569 — Musa Point](#11569) | 2 → 22 | 9 | 0 | 0 | 0 | 0 | 0 | 7 | 2 |
| [12082 — Port Sarim](#12082) | 2 → 39 | 9 | 0 | 0 | 0 | 0 | 0 | 7 | 2 |
| [13105 — Al Kharid](#13105) | 20 → 20 | 9 | 1 | 0 | 0 | 0 | 0 | 7 | 1 |
| [12340 — Draynor Manor](#12340) | 2 → 29 | 9 | 1 | 0 | 0 | 0 | 1 | 5 | 2 |
| [12337 — Wizards' Tower](#12337) | 2 → 34 | 9 | 0 | 0 | 0 | 0 | 3 | 5 | 1 |
| [12341 — Barbarian Village / Stronghold entrance](#12341) | 2 → 53 | 9 | 0 | 0 | 0 | 0 | 2 | 7 | 0 |
| [10806 — Seers' Village](#10806) | 2 → 25 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| [11061 — Western Catherby](#11061) | 3 → 3 | 8 | 0 | 1 | 0 | 0 | 7 | 0 | 0 |
| [10035 — Eastern West Ardougne](#10035) | 2 → 28 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| [13878 — Canifis](#13878) | 2 → 6 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 |
| [16694 — Highweald mine west and Ruins entrance](#16694) | 2 → 17 | 8 | 0 | 0 | 0 | 0 | 3 | 1 | 4 |
| [16435 — West Wendlewick Fishing Shop and beach](#16435) | 2 → 20 | 7 | 1 | 0 | 0 | 0 | 1 | 4 | 1 |
| [16950 — Highweald mine east](#16950) | 2 → 12 | 6 | 0 | 0 | 0 | 0 | 1 | 5 | 0 |
| [16436 — West Wendlewick: Wendle's Wicks](#16436) | 2 → 15 | 7 | 0 | 0 | 0 | 0 | 2 | 5 | 0 |
| [13613 — Nardah](#13613) | 2 → 2 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| [13869 — Desert east of Nardah](#13869) | 2 → 2 | 6 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| [13614 — Desert north of Nardah](#13614) | 2 → 2 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| **Total appearances/checks** | **169 → 627** | **214** | **8** | **1** | **3** | **0** | **76** | **102** | **24** |

Two location-independent rest/title goals account for the common literal count of two: [Questioning Your Energy, rev. 36634703](https://runescape.wiki/w/Questioning_Your_Energy?oldid=36634703) and [The Breaktaker, rev. 36634071](https://runescape.wiki/w/The_Breaktaker?oldid=36634071). Those rows are not evidence of local resources. Counts sum appearances across separate saves, not distinct tasks or world entities.

## First-pass mismatch patterns and proposed changes

1. **Connected members-only instances lack complete identity/gate coverage — Q, three chunks.** The Varrock surface start admits alternate-instance shops and contaminates 62 item-source entries; some items have valid surface alternatives, so this is not 62 uniquely unobtainable items. Falador and Al Kharid mine admit Vinesweeper and infer Agility/Farming 5. Vinesweeper’s admitted flag shop has no verified stock output here. The Wiki marks [New Varrock, rev. 37187626](https://runescape.wiki/w/New_Varrock?oldid=37187626) and [Vinesweeper, rev. 37146867](https://runescape.wiki/w/Vinesweeper?oldid=37146867) members-only; New Varrock also requires quest entry and a separate currency/inventory context. Resolve reviewed area/shop identities in the companion membership catalogue. Add explicit area prerequisites through a guarded, profile-selected overlay. The public consumers are `app/data/source-membership.mjs` and `app/tasks/access.mjs`; membership checking already exists, but unresolved identities do not block. The present retained-task correction schema cannot express every proposed gate. Exact quest-stage observations and member-instance economy isolation need a separate model review. Falador’s trial-interior admission is secondary evidence; no trial-derived item or training effect is claimed ([Recruitment Drive, rev. 37182740](https://runescape.wiki/w/Recruitment_Drive?oldid=37182740)).

2. **Wild crop scenery lacks a harvest-to-item mapping — M, three chunks/four checks.** Draynor onions and the potatoes at Mill Lane Mill and Al Kharid mine are reachable scenery but their edible items are absent. Yellow dye then fails downstream on the missing onion. Add reviewed ordinary pick actions for [wild onions, rev. 37147464](https://runescape.wiki/w/Onion_(scenery)?oldid=37147464) and [wild potatoes, rev. 37131971](https://runescape.wiki/w/Potato_(scenery)?oldid=37131971), following the existing non-skill harvest pattern. These need no Farming seed or level; do not award Farming XP or grant inventory automatically. The companion owns the action declarations; `app/tasks/engine.mjs` consumes their item outputs.

3. **NPC dialogue transactions are absent from the supply closure — M, two chunks.** [Ned, rev. 37127315](https://runescape.wiki/w/Ned?oldid=37127315) sells rope for 15 coins or exchanges four balls of wool; [Karim, rev. 37209164](https://runescape.wiki/w/Karim?oldid=37209164) sells kebabs for one coin. Both NPCs and local funding are present, but their products are absent. Add reviewed transaction recipes with exact NPC, payment and output requirements. Exact quantities, currency and alternative payments need a new transaction seam or an explicitly limited source-closure adapter. Do not turn them into free ground spawns or positive-stock shop rows. Keep reusable NPC transactions distinct from finite quest rewards.

4. **An owned chunk substitutes for an accessible achievement seller — O, one chunk.** Catherby offers [Handles for Forks, rev. 36994980](https://runescape.wiki/w/Handles_for_Forks?oldid=36994980) in F2P despite having no admitted local NPC, object or shop. Its [Candle Shop, rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292) is in members land. Resolve the achievement through an accessible seller, rather than ownership of the coordinate square. Preserve its valid F2P alternative at [Wendle’s Wicks, rev. 37108529](https://runescape.wiki/w/Wendle%27s_Wicks?oldid=37108529); do not mark the achievement globally members-only.

5. **A completable quest omits finite item rewards — M, one check.** Ernest the Chicken is available under the tested attached-interior permission, but its ten eggs and 300 feathers are absent from item closure. Add the Wiki-supported finite reward metadata ([quest, rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377)). Coins already have other sources and are not scored missing. The reward consumer is `app/tasks/engine.mjs`; a new finite-reward seam must preserve quantities, claim state and one-time provenance so feathers do not become renewable Fishing training or items presumed owned.

6. **A documented deposit variant lacks reviewed recognition — M, one conditional service check.** The F2P [Wendlewick Fishing Shop, rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) has an outside deposit box with “Deposit all fish”. A candidate in the admitted section receives no reviewed service recognition. Extend the companion’s reviewed banking evidence consumed by `app/data/training/banking-destinations.mjs`, with deposit-only semantics and the local-entry qualification. This does not establish a full bank or a failed walking/UI route.

The exact companion file paths, guarded selectors, current records and proposed replacements are recorded in the separate private correction plan. They are intentionally excluded from the public core report. All six changes remain proposals; no canonical private source, release pack or installed companion was edited.

## Item, training and service capture totals

The following aggregates record what the picker returned without publishing its private catalogue. Full private captures preserve every displayed task, trainable skill ceiling, obtainable item source, travel diagnostic and bank candidate. “Skills” counts primary-training signals, including the derived Combat summary where present; it is not a count of independently verified Wiki methods. “Bank candidates” counts physical placement candidates plus upstairs evidence candidates, not unique usable services. The evidence checklist below validates selected named offers.

| Chunk | Item appearances, literal → anchored | Primary training signals, literal → anchored | Bank candidates, anchored |
|---|---:|---:|---:|
| 12850 | 0 → 154 | 0 → 16 | 3 |
| 12853 | 0 → 311 | 0 → 14 | 6 |
| 12342 | 0 → 164 | 0 → 13 | 6 |
| 12338 | 0 → 153 | 0 → 15 | 7 |
| 11828 | 144 → 144 | 15 → 15 | 5 |
| 12852 | 104 → 104 | 12 → 12 | 1 |
| 12595 | 64 → 64 | 15 → 15 | 0 |
| 13107 | 0 → 54 | 0 → 14 | 0 |
| 11569 | 0 → 45 | 0 → 11 | 0 |
| 12082 | 0 → 143 | 0 → 16 | 1 |
| 13105 | 71 → 71 | 8 → 8 | 5 |
| 12340 | 0 → 55 | 0 → 9 | 0 |
| 12337 | 0 → 66 | 0 → 12 | 0 |
| 12341 | 0 → 197 | 0 → 14 | 0 |
| 10806 | 0 → 48 | 0 → 13 | 7 |
| 11061 | 0 → 0 | 0 → 0 | 5 |
| 10035 | 0 → 51 | 0 → 12 | 0 |
| 13878 | 0 → 11 | 0 → 0 | 6 |
| 16694 | 0 → 10 | 0 → 10 | 0 |
| 16435 | 0 → 50 | 0 → 10 | 1 |
| 16950 | 0 → 9 | 0 → 4 | 0 |
| 16436 | 0 → 34 | 0 → 8 | 0 |
| 13613 | 0 → 0 | 0 → 0 | 4 |
| 13869 | 0 → 0 | 0 → 0 | 0 |
| 13614 | 0 → 0 | 0 → 0 | 0 |

There are 383 literal and 1,938 anchored item appearances across saves. Each travel capture retained the default transport-off policy; no new surface chunk was granted. Candidate banks may be gated, duplicate placements, deposit-only, or untested. The totals do not certify service availability.

## Evidence and decisions by chunk

Every row pairs a bounded Wiki finding with the observed comparison. ✓ means supported at the scope stated, including correctly excluded outside content; U means unresolved, not a match or defect. R specifies a policy or starting-position condition. Surface coordinates do not prove routes between disconnected sections or across floors.

<a id="12850"></a>
### 12850 — Lumbridge Castle and town

Surface bounds: x 3200–3263; y 3200–3263. Picker displayed tasks: **2 literal / 47 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Castle full bank is upstairs at x 3207–3211, y 3215–3223, plane 2. | **U** — Bank candidates and upstairs add-on evidence exist; no usable-bank route/interaction was evaluated. | [Lumbridge Castle bank rev. 37110015](https://runescape.wiki/w/Lumbridge_Castle_bank?oldid=37110015) |
| Four respawning logs beside upstairs bank support repeatable Firemaking/Fletching with basic tools. | **✓** — Logs are in obtainable closure with a four-log spawn source. | [Lumbridge Castle bank rev. 37110015](https://runescape.wiki/w/Lumbridge_Castle_bank?oldid=37110015); [Logs rev. 37174563](https://runescape.wiki/w/Logs?oldid=37174563) |
| Bronze dagger spawn is on first floor. | **✓** — Bronze dagger is present with a local spawn source. | [Lumbridge Castle rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520) |
| Kitchen bowl, empty pot, knife and jug are renewable free spawns. | **✓** — Bowl, empty pot, knife and jug are all present with local spawn sources. | [Lumbridge Castle rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520) |
| Spinning wheel exists upstairs; local facility alone does not establish a wool/flax supply. | **✓** — Spinning wheel is reachable; no fibre supply inferred from the facility alone. | [Lumbridge Castle rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520) |
| Castle kitchen range requires Cook's Assistant completion. | **✓** — Castle cooking range is absent from usable source closure before Cook’s Assistant completion; Cooking instead has local fire sources. | [Lumbridge Castle rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520) |
| Cook's Assistant starts locally; mill, eggs and milk requirements extend beyond this chunk. | **✓** — Local first step is available; whole quest is blocked by supplies/locations outside the isolated chunk. | [Cook's Assistant rev. 37201167](https://runescape.wiki/w/Cook's_Assistant?oldid=37201167); [Mill Lane Mill rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893) |
| Xenia(3244,3198) and Catacombs entrance(3246,3198) are south in 12849, outside 12850; owning central Lumbridge does not include The Blood Pact. | **✓** — The Blood Pact start/entrance is not admitted from central Lumbridge. | [Xenia rev. 37166743](https://runescape.wiki/w/Xenia?oldid=37166743); [Lumbridge Catacombs rev. 37109974](https://runescape.wiki/w/Lumbridge_Catacombs?oldid=37109974) |
| The Restless Ghost starts at the church, but skull retrieval is outside this chunk. | **✓** — Local start is available; completion remains blocked. | [The Restless Ghost rev. 37163933](https://runescape.wiki/w/The_Restless_Ghost?oldid=37163933) |
| Lumbridge lodestone x 3232, y 3221 is local; activation is distinct from chunk ownership. | **R** — Local lodestone is identified; activation and travel admission are separate personal/default-policy facts. | [Lumbridge lodestone rev. 37110013](https://runescape.wiki/w/Lumbridge_lodestone?oldid=37110013) |
| Castle cellar cabbage is available before Recipe for Disaster or The Lost Tribe. Cellar access remains a linked-interior sensitivity, separate from its members-only bank chest. | **R** — Cellar cabbage is in closure; using the linked cellar depends on the interior rule. | [Lumbridge Castle rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520); [Cabbage rev. 37134778](https://runescape.wiki/w/Cabbage?oldid=37134778) |

<a id="12853"></a>
### 12853 — Varrock square and east bank

Surface bounds: x 3200–3263; y 3392–3455. Picker displayed tasks: **2 literal / 37 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| East bank at x 3254, y 3421 is local. | **U** — Reviewed east-bank candidates exist, but no route or transaction was evaluated. | [Varrock east bank rev. 37171930](https://runescape.wiki/w/Varrock_east_bank?oldid=37171930) |
| Aubury's stock provides runes conditional on coins; essence-mine teleport leaves the surface chunk. | **R** — Surface rune shop is present; essence-mine access is a linked-area sensitivity. | [Aubury's Rune Shop rev. 37108360](https://runescape.wiki/w/Aubury's_Rune_Shop?oldid=37108360); [Rune Essence mine rev. 37180851](https://runescape.wiki/w/Rune_Essence_mine?oldid=37180851) |
| Zaff's shop supplies staves conditional on coins. | **✓** — Zaff shop and staff item source are present. | [Zaff's Superior Spellcasting rev. 37108358](https://runescape.wiki/w/Zaff's_Superior_Spellcasting?oldid=37108358) |
| Thessalia's clothing shop is local. | **✓** — Thessalia shop and stock sources are present. | [Thessalia's Fine Clothes rev. 37108354](https://runescape.wiki/w/Thessalia's_Fine_Clothes?oldid=37108354) |
| Varrock Sword Shop at 3206,3398 sells melee weapons conditional on coins. | **✓** — Sword shop and bronze-sword source are present. | [Varrock Sword Shop rev. 37108347](https://runescape.wiki/w/Varrock_Sword_Shop?oldid=37108347) |
| Lowe's Archery Emporium at x 3233, y 3423 sells bows/ammunition conditional on coins. | **✓** — Lowe shop and shortbow source are present. | [Lowe's Archery Emporium rev. 37168047](https://runescape.wiki/w/Lowe's_Archery_Emporium?oldid=37168047) |
| Demon Slayer starts at 3250,3483 in 12854 north of this chunk; its current start is not Varrock square. | **✓** — The quest start north of this chunk is not offered as locally completable. | [Demon Slayer rev. 37152735](https://runescape.wiki/w/Demon_Slayer?oldid=37152735) |
| Shield of Arrav starts with Reldo at 3208,3494 in 12854, and both gang hideouts are outside 12853; owning square is not sufficient. | **✓** — No locally completable Shield of Arrav claim. | [Shield of Arrav rev. 37182737](https://runescape.wiki/w/Shield_of_Arrav?oldid=37182737) |
| Varrock lodestone x 3213, y 3376 is in 12852, outside 12853. | **✓** — No local Varrock lodestone is identified in 12853. | [Varrock lodestone rev. 37108403](https://runescape.wiki/w/Varrock_lodestone?oldid=37108403) |
| The alternate-reality Varrock requires members and starting Dimension of Disaster; entry is inventory-restricted, currency is Zemomarks, and banking is unavailable. F2P Varrock ownership does not establish its shops. | **Q** — F2P surface entry admits alternate Varrock shops despite members-only instance and quest entry. No area override, quest completion or membership change was supplied. | [New Varrock rev. 37187626](https://runescape.wiki/w/New_Varrock?oldid=37187626); [Dimension of Disaster rev. 37162626](https://runescape.wiki/w/Dimension_of_Disaster?oldid=37162626); [Dimension of Disaster: Coin of the Realm rev. 37162611](https://runescape.wiki/w/Dimension_of_Disaster%3A_Coin_of_the_Realm?oldid=37162611) |

<a id="12342"></a>
### 12342 — Edgeville

Surface bounds: x 3072–3135; y 3456–3519. Picker displayed tasks: **2 literal / 36 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Edgeville full bank is local. | **U** — Banker/physical service candidates exist; no route or transaction test. | [Edgeville bank rev. 37110216](https://runescape.wiki/w/Edgeville_bank?oldid=37110216) |
| Two yews grow in ruined building south of bank; high-level source alone does not bootstrap Woodcutting. | **✓** — Local yews and obtainable yew logs are present after inferred local training. | [Edgeville rev. 37146520](https://runescape.wiki/w/Edgeville?oldid=37146520) |
| Leather gloves respawn in ruined building south of bank. | **✓** — Leather gloves retain a local ground-spawn source. | [Edgeville rev. 37146520](https://runescape.wiki/w/Edgeville?oldid=37146520); [Leather gloves rev. 37132088](https://runescape.wiki/w/Leather_gloves?oldid=37132088) |
| Edgeville furnace requires members world and easy Varrock achievements. | **U** — Furnace selector exists through admitted locations, but no normal Smithing training is inferred; exact surface-service gate was not isolated. | [Furnace (Edgeville) rev. 37110455](https://runescape.wiki/w/Furnace_(Edgeville)?oldid=37110455) |
| Dungeon trapdoor is in ruins south of bank; dungeon access is a linked-interior rule decision. | **R** — The linked dungeon is admitted; its permission is separate from surface ownership. | [Edgeville Dungeon rev. 37124838](https://runescape.wiki/w/Edgeville_Dungeon?oldid=37124838) |
| Canoe endpoint exists east of town; use requires Woodcutting and a permitted unlocked destination. | **R** — Canoe source exists; default transport is off and no outside destination is granted. | [Edgeville rev. 37146520](https://runescape.wiki/w/Edgeville?oldid=37146520); [Canoe rev. 37174554](https://runescape.wiki/w/Canoe?oldid=37174554) |
| Edgeville lodestone x 3066, y 3505 is outside this chunk to west. | **✓** — No Edgeville lodestone is mapped to the selected coordinate chunk. | [Edgeville lodestone rev. 37110451](https://runescape.wiki/w/Edgeville_lodestone?oldid=37110451) |
| Jeffery is local but Gunnar's Ground begins in Barbarian Village outside chunk. | **✓** — Local Jeffery is present, but whole quest remains blocked by its outside start. | [Gunnar's Ground rev. 37177980](https://runescape.wiki/w/Gunnar's_Ground?oldid=37177980) |

<a id="12338"></a>
### 12338 — South Draynor

Surface bounds: x 3072–3135; y 3200–3263. Picker displayed tasks: **2 literal / 39 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Draynor full bank x 3093, y 3244 is local. | **U** — Banker/candidates are present; no bank route or interaction evaluated. | [Draynor bank rev. 37110113](https://runescape.wiki/w/Draynor_bank?oldid=37110113) |
| Small-net/bait spots x 3085, y 3230 and 3086,3227 allow level 1 shrimp with net, then higher fish. | **✓** — Shrimp and higher fish occur in closure with primary Fishing. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217) |
| Willows at x 3082–3088, y 3227–3238 require 20 Woodcutting; lower tree sources needed first. | **✓** — Willow source exists with lower local trees allowing inferred progression. | [Willow rev. 37197270](https://runescape.wiki/w/Willow?oldid=37197270) |
| Onions south of bank can be picked without Farming training. | **M** — Onion scenery is reachable, but Onion item is absent from obtainable closure; wild pick action is not modeled. | [Onion (scenery) rev. 37147464](https://runescape.wiki/w/Onion_(scenery)?oldid=37147464) |
| Aggie makes dyes for ingredients+coins, rather than selling all colours outright. | **M** — Aggie and local onion scenery are reachable, but yellow dye is blocked on the missing Onion item. This is a downstream effect of the harvest-source gap. | [Aggie rev. 37174702](https://runescape.wiki/w/Aggie?oldid=37174702) |
| Ned supplies rope for coins or wool; coins/wool are input requirements. | **M** — Ned is reachable, Coins and ball-of-wool supplies exist, but Rope is absent; dialogue sale/exchange is unmodeled. | [Ned rev. 37127315](https://runescape.wiki/w/Ned?oldid=37127315) |
| Draynor seed stall requires 27 Thieving. | **✓** — The high-level seed-stall action is not available at the default F2P skill cap. | [Seed Stall (Draynor Village) rev. 37110933](https://runescape.wiki/w/Seed_Stall_(Draynor_Village)?oldid=37110933) |
| Draynor lodestone x 3104, y 3298 is north in 12339, outside 12338. | **✓** — No local Draynor lodestone is identified. | [Draynor lodestone rev. 36689044](https://runescape.wiki/w/Draynor_lodestone?oldid=36689044) |
| Tomato spawn at 3088,3262, plane 1 is explicitly unreachable by any means; this is not a usable fresh Ironman source despite Aggie area description. | **✓** — Unreachable upstairs tomato does not enter obtainable closure. | [Tomato rev. 37203180](https://runescape.wiki/w/Tomato?oldid=37203180); [Aggie rev. 37174702](https://runescape.wiki/w/Aggie?oldid=37174702) |

<a id="11828"></a>
### 11828 — West Falador

Surface bounds: x 2944–3007; y 3328–3391. Picker displayed tasks: **45 literal / 45 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Falador west full bank x 2946, y 3367 is local. | **U** — Reviewed bank candidate exists; no transaction or route evaluated. | [Falador west bank rev. 37127274](https://runescape.wiki/w/Falador_west_bank?oldid=37127274) |
| General store at 2957,3386 supplies stocked containers/tools conditional on coins. | **✓** — General store is reachable with positive stock item sources. | [Falador General Store rev. 37122474](https://runescape.wiki/w/Falador_General_Store?oldid=37122474) |
| Flynn's Mace Market at 2950,3387 sells maces conditional on coins. | **✓** — Flynn shop is reachable. | [Flynn's Mace Market rev. 37120856](https://runescape.wiki/w/Flynn's_Mace_Market?oldid=37120856) |
| Cassie's Shield Shop at 2976,3383 sells shields conditional on coins. | **✓** — Cassie shop is reachable. | [Cassie's Shield Shop rev. 37121211](https://runescape.wiki/w/Cassie's_Shield_Shop?oldid=37121211) |
| Cooked chicken respawns upstairs in Cassie's Shield Shop. | **✓** — Cooked chicken has the independent ground-spawn source. | [Cassie's Shield Shop rev. 37121211](https://runescape.wiki/w/Cassie's_Shield_Shop?oldid=37121211) |
| Falador furnace is at 2976,3368; local ore supply remains separate requirement. | **✓** — Furnace facility is reachable; no local ore supply inferred solely from it. | [Furnace rev. 37196083](https://runescape.wiki/w/Furnace?oldid=37196083) |
| Falador lodestone at 2966,3403 is north in 11829 outside this chunk. | **✓** — Falador lodestone is outside and not identified locally. | [Falador lodestone rev. 37127183](https://runescape.wiki/w/Falador_lodestone?oldid=37127183) |
| Wyson is local at 2987,3386, selling woad leaves for coins; Falador Park spans more than one chunk. | **✓** — Wyson and the woad-leaf shop source are present. | [Wyson the gardener rev. 37127245](https://runescape.wiki/w/Wyson_the_gardener?oldid=37127245) |
| Vinesweeper is members-only; recruitment trials are part of members quest Recruitment Drive. A F2P treepatch/leprechaun or Falador ownership cannot independently supply their interiors. | **Q** — F2P Falador admits Vinesweeper; its stile and Farming methods infer Agility/Farming training. Trial area admission also lacks the verified members identity, but no trial training consequence is claimed. | [Vinesweeper rev. 37146867](https://runescape.wiki/w/Vinesweeper?oldid=37146867); [Recruitment Drive rev. 37182740](https://runescape.wiki/w/Recruitment_Drive?oldid=37182740) |

<a id="12852"></a>
### 12852 — Gower farm and Varrock lodestone

Surface bounds: x 3200–3263; y 3328–3391. Picker displayed tasks: **29 literal / 29 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| May's Caravan bank chest requires members and 125 allocated quest points; fresh F2P player cannot bank there. | **U** — Caravan is not a reviewed usable bank destination; candidate-only capture cannot test the complete banking API. | [May's Quest Caravan rev. 37188013](https://runescape.wiki/w/May's_Quest_Caravan?oldid=37188013); [Bank chest (May's Quest Caravan) rev. 36853936](https://runescape.wiki/w/Bank_chest_(May's_Quest_Caravan)?oldid=36853936) |
| Varrock lodestone x 3213, y 3376 is local, activation remains separate. | **R** — Varrock lodestone is local, but no personal activation is supplied. | [Varrock lodestone rev. 37108403](https://runescape.wiki/w/Varrock_lodestone?oldid=37108403) |
| Gower Quest requires 34 quest points despite no skill requirements. | **✓** — Fresh zero-QP save does not get Gower Quest completion. | [Gower Quest rev. 37172883](https://runescape.wiki/w/Gower_Quest?oldid=37172883) |
| Gower farm giant-rat pen nodes have x 3265–3276 beyond eastern boundary 3263; do not allocate its raw rat meat/bones to 12852 from the farm page alone. | **✓** — The eastern giant-rat pen is not admitted as local monster supply. | [Gower farm rev. 37109897](https://runescape.wiki/w/Gower_farm?oldid=37109897); [Giant rat rev. 37153107](https://runescape.wiki/w/Giant_rat?oldid=37153107) |
| Farmhouse has spinning wheel, but source of fibres remains separate. | **✓** — Spinning-wheel facility is reachable. | [Gower farm rev. 37109897](https://runescape.wiki/w/Gower_farm?oldid=37109897) |
| Farmhouse has sink and dairy churn; milk input remains separate. | **U** — Broad farm description and raw facility declaration were not tied to a usable local dairy service. | [Gower farm rev. 37109897](https://runescape.wiki/w/Gower_farm?oldid=37109897) |
| Willows at 3207,3352 and 3210,3354 are local and require 20 Woodcutting. | **✓** — Two local willow nodes are represented and willow logs are obtainable. | [Willow rev. 37197270](https://runescape.wiki/w/Willow?oldid=37197270) |
| Farm master farmer is a higher-Thieving seed source, not level 1 training. | **✓** — High-level pickpocketing is not available under fresh default F2P caps. | [Gower farm rev. 37109897](https://runescape.wiki/w/Gower_farm?oldid=37109897) |

<a id="12595"></a>
### 12595 — Mill Lane Mill and cattle field

Surface bounds: x 3136–3199; y 3264–3327. Picker displayed tasks: **32 literal / 32 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Three-level mill plus adjacent wheat permits flour production. | **✓** — Wheat and mill processing produce pot of flour. | [Mill Lane Mill rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893) |
| Free empty pot respawns at mill flour bin. | **✓** — Empty pot has the mill spawn source. | [Mill Lane Mill rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893) |
| Nearby farmer house provides water. | **U** — Local water purchase exists through Beefy Bill, but the Wiki’s nearby-house water-source coordinates were not pinned. | [Mill Lane Mill rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893) |
| Beefy Bill at 3180,3320 banks only flour/cowhide/raw beef, charging 10%rounded up; no withdrawals. | **U** — NPC is reachable; specialised deposit service was not evaluated through a usable-bank API. | [Beefy Bill rev. 37110100](https://runescape.wiki/w/Beefy_Bill?oldid=37110100) |
| Beefy Bill stocks redberries at 3 coins each. | **✓** — Redberries have Beefy Bill shop provenance. | [Beefy Bill's Supplies rev. 37117521](https://runescape.wiki/w/Beefy_Bill's_Supplies?oldid=37117521) |
| Beefy Bill stocks bronze swords/offhand swords/shields, shortbow and arrows; require coins. | **✓** — Stocked weapon and ammunition sources are present. | [Beefy Bill's Supplies rev. 37117521](https://runescape.wiki/w/Beefy_Bill's_Supplies?oldid=37117521) |
| Mapped cows at 3154,3325;3160,3318;3173,3323;3197,3320 provide hides, raw beef and bones. Combat/Prayer are local; Cooking also needs heat, whose exact local source is unverified in this checklist. | **✓** — Mapped cattle and raw-beef/cowhide drops are represented; Cooking heat remains qualified in the Wiki finding. | [Beefy Bill rev. 37110100](https://runescape.wiki/w/Beefy_Bill?oldid=37110100); [Cow rev. 37142844](https://runescape.wiki/w/Cow?oldid=37142844) |
| Millie provides extra-fine flour after Cook's Assistant is started in locked Lumbridge. | **✓** — Extra-fine flour is not granted before the outside quest start. | [Mill Lane Mill rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893); [Cook's Assistant rev. 37201167](https://runescape.wiki/w/Cook's_Assistant?oldid=37201167) |
| Wild potatoes at 3139,3286 and the surrounding field are inside 12595, F2P and can be picked for raw potatoes without Farming seeds or levels. | **M** — Potato scenery is reachable but Raw potato is absent; wild harvest needs no Farming seed/level. | [Potato (scenery) rev. 37131971](https://runescape.wiki/w/Potato_(scenery)?oldid=37131971) |

<a id="13107"></a>
### 13107 — Al Kharid mine

Surface bounds: x 3264–3327; y 3264–3327. Picker displayed tasks: **2 literal / 33 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Common gem rocks at 3295,3310;3304,3310;3303,3312 can be mined at 1 Mining. | **✓** — Common gems and level 1 mining bootstrap are represented. | [Common gem rock rev. 37180734](https://runescape.wiki/w/Common_gem_rock?oldid=37180734) |
| Uncommon gems require 20 Mining, with emeralds 27 and rubies 34. | **✓** — Uncommon gem requirements and products match the higher local Mining progression. | [Uncommon gem rock rev. 37195306](https://runescape.wiki/w/Uncommon_gem_rock?oldid=37195306) |
| Mine has six silver rocks; silver requires 20 Mining. | **✓** — Silver rocks and silver ore are present. | [Al Kharid mine rev. 37180731](https://runescape.wiki/w/Al_Kharid_mine?oldid=37180731); [Silver rock rev. 37195301](https://runescape.wiki/w/Silver_rock?oldid=37195301) |
| Mine has four gold rocks; gold requires 40 Mining. | **✓** — Gold rocks and gold ore are present. | [Al Kharid mine rev. 37180731](https://runescape.wiki/w/Al_Kharid_mine?oldid=37180731); [Gold rock rev. 37179006](https://runescape.wiki/w/Gold_rock?oldid=37179006) |
| Copper, tin, iron, coal, mithril, adamantite removed in 2019; should not be physical sources here. | **✓** — Removed copper/tin/iron/coal/mithril/adamantite rock selectors are not admitted as mine nodes. | [Al Kharid mine rev. 37180731](https://runescape.wiki/w/Al_Kharid_mine?oldid=37180731) |
| Resource dungeon requires 75 Dungeoneering, not available to fresh character. | **✓** — Level 75 Dungeoneering resource dungeon is not admitted for the fresh save. | [Al Kharid resource dungeon rev. 37180738](https://runescape.wiki/w/Al_Kharid_resource_dungeon?oldid=37180738) |
| Mine scorpions are nonaggressive, optional combat; not entrance requirement. | **✓** — Scorpions are represented without treating them as a mandatory entrance fight. | [Al Kharid mine rev. 37180731](https://runescape.wiki/w/Al_Kharid_mine?oldid=37180731) |
| Area banks/furnaces discussed on mine page are outside this chunk. | **U** — No local bank offer is established; banking route API not evaluated. | [Al Kharid mine rev. 37180731](https://runescape.wiki/w/Al_Kharid_mine?oldid=37180731) |
| Wild potatoes at 3264,3302;3264,3305;3264,3308;3265,3304;3265,3307 are inside 13107 and can be picked for raw potatoes without Farming seeds or levels. | **M** — Local Potato scenery is reachable but Raw potato item is absent. | [Potato (scenery) rev. 37131971](https://runescape.wiki/w/Potato_(scenery)?oldid=37131971) |
| Vinesweeper is members-only. Owning an F2P herb patch/leprechaun in this chunk does not grant its minigame sources. | **Q** — The members-only Vinesweeper instance is admitted from the F2P mine; its methods infer Agility/Farming 5. | [Vinesweeper rev. 37146867](https://runescape.wiki/w/Vinesweeper?oldid=37146867) |

<a id="11569"></a>
### 11569 — Musa Point

Surface bounds: x 2880–2943; y 3136–3199. Picker displayed tasks: **2 literal / 22 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Small-net/bait spots at the northeastern pier are inside this chunk; net fishing starts at level 1. Net shrimp can start with the default net. This Wiki revision has a bait-summary 10 versus sardine-table 5 conflict; bait minimum is not scored as a requirement defect. | **✓** — Both net/bait spots reachable. Raw shrimps and anchovies in item closure; shrimp task available but lower goal suppressed, while swordfish is presented. Baseline tools and local Fishing progression are respected; no bait-level conclusion scored. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217) |
| Cage/harpoon spots occupy the same local pier: harpoon requires 35 Fishing; cage requires 40. Not fresh-level actions; local net fishing provides a training route. | **✓** — Raw tuna, lobster and swordfish in item closure; swordfish task available/presented. Local shrimp gives level-1 Fishing bootstrap. | [Fishing spot (cage, harpoon) rev. 37196214](https://runescape.wiki/w/Fishing_spot_(cage%2C_harpoon)?oldid=37196214) |
| Four F2P teak trees behind Kofi are inside the chunk and require 30 Woodcutting. Level 30 is not fresh. The present Wiki baseline does not prove a level-1 woodcutting route in this exact chunk. | **U** — Teak is reachable but cut-teak task blocked by Woodcutting 30 with reachable 1; no Teak logs in closure. Wiki proves four trees and requirement, but does not settle a fresh local level-1 Woodcutting route. No missing-source claim. | [Teak rev. 37188679](https://runescape.wiki/w/Teak?oldid=37188679); [Musa Point rev. 37189045](https://runescape.wiki/w/Musa_Point?oldid=37189045) |
| Luthas pays 30 coins repeatedly for packing ten local bananas; the plantation has 33 trees with five bananas each. Local no-combat coin source with no prior quest requirement stated. | **✓** — Luthas and banana-tree object reachable; Banana and Coins obtainable, Fruitful Labour job achievement available/presented. Coins provenance currently uses alternate drops/pickpocketing, so no claim Coins absent or job task missing. | [Luthas rev. 37147273](https://runescape.wiki/w/Luthas?oldid=37147273); [Banana plantation rev. 37154388](https://runescape.wiki/w/Banana_plantation?oldid=37154388) |
| Kofi general store has free jug, knife, banana and rope spawns, plus stocked ordinary tools/containers. Free spawns precede purchases; Luthas supplies coins. | **✓** — Rope/Jug/Knife/Banana spawns and Kofi shop supplies are present. | [Karamja General Store rev. 37122538](https://runescape.wiki/w/Karamja_General_Store?oldid=37122538) |
| Zembo sells beer for 2 coins, rum for 30 and wine for 128 in the local bar. Luthas income makes purchases locally sourceable. | **✓** — Local bar reachable and Beer/Karamjan rum/Jug of wine shop sources present. | [Karamja Wines, Spirits, and Beers rev. 37119865](https://runescape.wiki/w/Karamja_Wines%2C_Spirits%2C_and_Beers?oldid=37119865) |
| Stiles is at 2851,3143, west of this chunk; his fish-note service is not available from only 11569. Unavailable under one-coordinate restriction. | **✓** — Stiles absent from reachable NPCs; no bank/note service candidate introduced. No evidence of a route into his outside coordinate. | [Stiles rev. 37189046](https://runescape.wiki/w/Stiles?oldid=37189046) |
| F2P ship to Port Sarim costs 30 coins, but the destination is locked; Pirate’s Treasure starts in Port Sarim and later uses Varrock and Falador. Local fare funding does not permit leaving the chunk; quest cannot start/finish locally. | **✓** — Only 11569 base reachable; Pirate’s Treasure local step blocked by outside start. No non-global travel route available and access.transport remains false. | [Musa Point rev. 37189045](https://runescape.wiki/w/Musa_Point?oldid=37189045); [Pirate's Treasure rev. 37152930](https://runescape.wiki/w/Pirate's_Treasure?oldid=37152930) |
| Air rune page pins the spawn north of Luthas at 2938,3158 but marks that spawn members=Yes. Musa area page mentions it without a membership qualification. F2P eligibility needs resolution; do not silently promote broad area text over the explicit spawn flag. | **U** — Air rune appears as local F2P spawn source. Item page flags spawn members=Yes whereas area page is unqualified. Evidence conflict is unresolved; do not score a membership correction without reconciliation. | [Air rune rev. 37194605](https://runescape.wiki/w/Air_rune?oldid=37194605); [Musa Point rev. 37189045](https://runescape.wiki/w/Musa_Point?oldid=37189045) |

<a id="12082"></a>
### 12082 — Port Sarim

Surface bounds: x 3008–3071; y 3200–3263. Picker displayed tasks: **2 literal / 39 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Betty stocks elemental/mind/body/chaos/death runes and positive-stock wizard, black wizard and imphide gear locally. Purchases need local coins; higher gear/spells need their own trained levels. | **✓** — Betty reachable; elemental/catalytic runes and positive-stock wizard/imphide equipment are in item closure. Local Coins exists; closure is obtainable supplies, not fresh worn equipment. | [Betty's Magic Emporium rev. 37120859](https://runescape.wiki/w/Betty's_Magic_Emporium?oldid=37120859) |
| Brian stocks main/offhand bronze through adamant battleaxes including black. Coin and equip-level gates remain. | **✓** — Brian reachable; bronze through adamant main/offhand and black battleaxes are in item closure. | [Brian's Battleaxe Bazaar rev. 37120697](https://runescape.wiki/w/Brian's_Battleaxe_Bazaar?oldid=37120697) |
| Gerrant sells tools, bait and feathers; only raw sardine has positive base stock among listed raw fish. Other raw-fish display entries have stock zero. Raw sardine is locally purchasable; zero-stock fish are not Ironman supply proof. | **✓** — Gerrant reachable; Raw sardine has shop source. No zero-stock Raw shrimp/trout/pike/salmon/tuna/lobster/swordfish supply is promoted from his display entries. Cooking those absent fish remains blocked. | [Gerrant's Fishy Business rev. 37123123](https://runescape.wiki/w/Gerrant's_Fishy_Business?oldid=37123123) |
| White apron respawns on Gerrant’s shop wall. Free local quest item. | **✓** — White apron is present as local spawn quantity 2. | [Gerrant's Fishy Business rev. 37123123](https://runescape.wiki/w/Gerrant's_Fishy_Business?oldid=37123123) |
| Wydin stocks flour, beef, chicken, cabbage, bread, chocolate, cheese, tomato, potato and garlic; bananas and redberries have base stock zero. Purchasable after earning local coins; infinite backroom crates require Pirate’s Treasure started. | **U** — Positive-stock food matches. Banana is present as generic local spawn, not zero-stock shop entry; redberries absent. Pirate’s Treasure start is available locally, so a legal apron/employment/backroom route can exist despite whole-quest block. Generic spawn metadata does not establish or refute crate-stage gating; do not count absent bananas or a wrong prerequisite. | [Wydin's Food Store rev. 37120779](https://runescape.wiki/w/Wydin's_Food_Store?oldid=37120779) |
| Pirate’s Treasure starts with Redbeard Frank inside the chunk but requires rum on Karamja, then Varrock and Falador. Start possible; whole quest impossible with only this coordinate. | **✓** — Pirate’s Treasure 1 is available/presented; step 3 blocked by step 2 outside. Whole completion is not offered. | [Redbeard Frank rev. 37127373](https://runescape.wiki/w/Redbeard_Frank?oldid=37127373); [Pirate's Treasure rev. 37152930](https://runescape.wiki/w/Pirate's_Treasure?oldid=37152930) |
| Entrana dock deposit box is local; it permits deposits rather than withdrawal. Area page also describes restricted-item Entrana dialogue opening a full bank interface. Physical deposit service is established. F2P access to the full-bank dialogue is not established by the general area page. | **U** — Reviewed physical candidate is correctly kind=deposit, reachable F2P Port Sarim box. Raw Bank alias is also reachable. Captures explicitly do not evaluate a usable-bank API; neither full withdrawal service nor Entrana-dialogue availability was tested. | [Bank deposit box rev. 37167169](https://runescape.wiki/w/Bank_deposit_box?oldid=37167169); [Port Sarim rev. 37173238](https://runescape.wiki/w/Port_Sarim?oldid=37173238) |
| Port Sarim lodestone lies at 3010,3215 and can be activated locally; existing activation is not assumed. Ship destinations outside the one chunk remain locked. Local activation action possible; no imported teleport activation. | **✓** — Port Sarim activation achievement presented, but fresh personal activation is not injected. No available non-global travel route extends access to another base. | [Lodestone Network rev. 37211066](https://runescape.wiki/w/Lodestone_Network?oldid=37211066); [Port Sarim rev. 37173238](https://runescape.wiki/w/Port_Sarim?oldid=37173238) |
| Oak placements 3035,3261;3070,3253;3040,3263;3056,3261 are within this chunk; many other “Port Sarim” oaks lie outside. 15 Woodcutting requirement; level-1 training route must be checked separately. | **✓** — Oak and Tree reachable; Oak logs from cutting in closure. Location is the admitted Port Sarim starting section and no outside surface base is granted. Exact per-tree count is not asserted by aggregate task source. | [Oak rev. 37197269](https://runescape.wiki/w/Oak?oldid=37197269) |

<a id="13105"></a>
### 13105 — Al Kharid

Surface bounds: x 3264–3327; y 3136–3199. Picker displayed tasks: **20 literal / 20 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Al Kharid bank at 3270,3168 is F2P and local. Normal bank access available; empty initial inventory/bank still assumed. | **U** — Bank booths/Banker and reviewed F2P Al Kharid bank placements present with an admitted interaction section and no unmet requirements. This is candidate evidence, not an evaluated usable-bank API or in-game bank interaction. | [Al Kharid bank rev. 37122485](https://runescape.wiki/w/Al_Kharid_bank?oldid=37122485) |
| Ellis at 3275,3195 tans hides; he can give needle/thread after starting Lumbridge/Draynor tasks. Facility exists but cowhide/snakeskin/dragonhide need independent local sourcing; not granted by nearby bank. | **✓** — Ellis is reachable; no cowhide, leather or dragonhide craft chain is granted by his presence alone. | [Ellis rev. 37141997](https://runescape.wiki/w/Ellis?oldid=37141997) |
| Zeke stocks bronze–adamant main/offhand scimitars and black variants, and his shop contains a furnace. Purchases need coins/equip levels; smelting still needs locally acquired ore. | **✓** — Zeke and Furnace reachable; current scimitar stock in closure. No Bronze bar invented from furnace alone; Copper ore has independent local Man/warrior drops, so do not call all ores inaccessible. | [Zeke's Superior Scimitars rev. 37121210](https://runescape.wiki/w/Zeke's_Superior_Scimitars?oldid=37121210) |
| Dommik stocks chisel, needle, thread and ring/necklace/amulet/holy/tiara moulds; bracelet/bolt/sickle mould stock is members. Tools and moulds do not supply hides, gems or bars. | **✓** — Dommik’s permitted F2P moulds, Needle and Thread in closure; members bracelet/bolt/sickle moulds absent. | [Dommik's Crafting Store rev. 37181367](https://runescape.wiki/w/Dommik's_Crafting_Store?oldid=37181367) |
| Karim locally sells unlimited kebabs for 1 coin through dialogue. Coin sourcing remains necessary; not an unlimited free spawn. | **M** — Karim is reachable and local Coins are obtainable, but Kebab is absent from the obtainable-item closure. This misses his documented renewable one-coin dialogue purchase; no alternate Kebab source exists in this capture. | [Karim rev. 37209164](https://runescape.wiki/w/Karim?oldid=37209164) |
| Al Kharid warriors inhabit the local palace and may aid each other in combat; pickpocketing requires 25 Thieving. Combat can be trained; do not prove impossibility from starting combat levels. Pickpocketing is not a fresh-level coin route. | **✓** — Al Kharid warrior reachable; combat-source closure is distinguished from fresh actual levels. Thieving reaches only F2P cap 5, so level 25 warrior pickpocketing is not a fresh source. | [Al Kharid warrior rev. 37156862](https://runescape.wiki/w/Al_Kharid_warrior?oldid=37156862); [Al Kharid rev. 37120737](https://runescape.wiki/w/Al_Kharid?oldid=37120737) |
| The Al Kharid-labelled net/bait fishing spots at 3256,3177 and 3255,3163 lie west of x 3264 and outside this chunk. Unavailable from only 13105. | **✓** — No net/bait fishing object reachable; Raw shrimps/anchovies/sardine absent and their cooking tasks blocked. Outside fishing placements correctly excluded. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217) |
| Al Kharid lodestone at 3296,3184 can be activated from this chunk; activation is not pre-owned. Local activation attainable. | **✓** — Al Kharid activation achievement available/presented and local lodestone record exists; no pre-existing personal activation assumed. | [Lodestone Network rev. 37211066](https://runescape.wiki/w/Lodestone_Network?oldid=37211066) |
| Stolen Hearts starts with Ozan in Draynor Village; Diamond in the Rough starts only following Stolen Hearts, even though Al Kharid contains later quest locations. Neither whole quest follows from a fresh one-chunk Al Kharid start. | **✓** — No Stolen Hearts whole completion or Diamond in the Rough start is offered from this fresh isolated chunk. Later local involvement is not mistaken for fresh quest completion. | [Al Kharid rev. 37120737](https://runescape.wiki/w/Al_Kharid?oldid=37120737) |

<a id="12340"></a>
### 12340 — Draynor Manor

Surface bounds: x 3072–3135; y 3328–3391. Picker displayed tasks: **2 literal / 29 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Ernest the Chicken starts at 3112,3329 with Veronica and completes entirely using manor floors, yard and lever basement. Fresh completion possible with baseline tools; no skill requirement and skeleton kill optional. Completion is conditional on the house rule granting the linked basement/ruins with their entrance chunk. | **R** — Full Ernest quest is available/presented and Draynor Manor basement is an accessed attached area. This agrees when connected manor floors/yard/basement are allowed. A strict surface-coordinate-only interpretation changes the task; retain explicit linked-interior sensitivity. | [Ernest the Chicken rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377) |
| Ernest gives 3000 coins,10 eggs and 300 feathers. Available after local quest completion, not starting inventory. | **M** — Ernest completion is available/presented but Egg and Feather are entirely absent from the obtainable-item closure. Completion record has 4 QP and no item rewards; Wiki awards 10 eggs+300 feathers. Coins has independent drop sources, so only missing rewarded eggs/feathers are scored. | [Ernest the Chicken rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377) |
| East ground-floor store room has spade, shears, bucket and bronze med helm spawns. Free local items. | **✓** — Bronze med helm/Bucket/Shears/Spade present as local spawns. Aggregate location does not certify floor, so no Count-basement historical relocation claim. | [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852) |
| Pressure gauge route uses local upstairs fish food, ground-floor poison and courtyard fountain. No imported fish food/poison needed. | **✓** — Local Fish food and Poison (item) sources plus Fountain reachable; Ernest stages and completion available without imported items. | [Ernest the Chicken rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377); [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852) |
| Rubber tube needs local compost key and spade; level 11 skeleton can be avoided. Oil can requires the lever puzzle and cannot be telegrabbed. Fresh route possible without combat kill. | **✓** — Rubber tube/Spade and compost/lever puzzle objects reachable; Ernest stages available without kill or Telekinetic Grab blockers. | [Ernest the Chicken rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377) |
| West grounds have special cabbage giving a temporary Defence boost, unusable as Black Knights’ Fortress’s sabotage cabbage. Locally obtainable food/boost; wrong cabbage for that quest. | **U** — Engine offers generic Cabbage via picking and independent Giant-spider drop. Wiki distinguishes manor special cabbage, but aggregate item name does not resolve variant identity. Ordinary Cabbage has alternate provenance, so do not claim it wholly unavailable or infer a Black Knights’ Fortress false offer. | [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852) |
| Count Draynor’s basement is linked locally, but Vampyre Slayer starts at Morgan 3097,3268 and needs Harlow’s quest stake and stake hammer in Varrock. Not startable/completable from only 12340; local Count presence is insufficient. | **✓** — Local Vampyre Slayer 3/completion are blocked by outside earlier quest stages. Count presence does not grant Harlow’s quest tools. | [Vampyre Slayer rev. 37189189](https://runescape.wiki/w/Vampyre_Slayer?oldid=37189189); [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852) |
| Upper-floor rift access requires Ernest and leads to members-only Killerwatt Plane. Ernest is attainable; F2P membership still blocks the plane. | **✓** — Killerwatt Plane is not accessed; explicit members-only-area diagnostic blocks it despite Ernest completion capability. | [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852); [Ernest the Chicken rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377) |
| Wiki describes many dead trees and some undead trees, but gives no exact ordinary-tree placement. Specific undead trees cannot be chopped before Animal Magnetism. The front door is one-way; northern east-room door exits. Fresh ordinary-log route remains unverified; undead-tree chopping is quest-gated. No need for locked lodestone to escape. | **U** — No normal log source is inferred from quest-gated Undead tree NPCs. Exact ordinary-tree placements and door interaction are not established by these captures, so no fresh-log or escape defect is scored. | [Draynor Manor rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852) |

<a id="12337"></a>
### 12337 — Wizards' Tower

Surface bounds: x 3072–3135; y 3136–3199. Picker displayed tasks: **2 literal / 34 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Tower ground/first/second floors and roof are linked by beam; most intervening staff floors are inaccessible. Accessible public floors share local x/y; do not infer access to staff-only rooms. | **✓** — Public-floor NPCs, portals and Deposit box reachable under tower section entry. No separate inaccessible staff-floor source proof is established; no claimed floor defect. | [Wizards' Tower rev. 37109853](https://runescape.wiki/w/Wizards'_Tower?oldid=37109853) |
| Rune Mysteries starts with Ariane and uses the tower plus attached old ruins. Library provides a tower mindspike(air) to lure the vortex. Self-contained F2P quest with standard spells and inventory space; no imported runes required. Completion is conditional on the house rule granting the linked basement/ruins with their entrance chunk. | **R** — All Rune Mysteries stages/completion available and tower mindspike variants in reward closure; Old Tower accessed. Correct under tested attached-ruins permission; surface-only interpretation is a linked-interior sensitivity. | [Rune Mysteries rev. 37162525](https://runescape.wiki/w/Rune_Mysteries?oldid=37162525) |
| Lower Runespan is level 1, middle 33; activity needs no imported items and entrance portals are on the local roof. Local Runecrafting progression if attached-area rules allow Runespan. | **R** — The Runespan accessed, Runecrafting primary ceiling 110 inferred from renewable Runespan methods. The default linked-area access is explicit; a house rule excluding pocket dimensions changes eligibility. | [Runespan rev. 37202088](https://runescape.wiki/w/Runespan?oldid=37202088) |
| Runespan runes and essence are internal activity items; on leaving runes convert to points. Cannot supply normal spell runes or ordinary essence to other tasks. | **✓** — No conventional rune/essence item source is labelled The Runespan. Conventional Rune essence comes from actual mining; Air rune comes from Spellwisp drops, preventing false Runespan output-material inference. | [Runespan rev. 37202088](https://runescape.wiki/w/Runespan?oldid=37202088) |
| Roof deposit box at 3110,3160 plane 3 is a deposit service, despite location infobox “banks=1”. Deposits available via floors; unrestricted withdrawals not established. | **U** — Deposit box is reachable with tower/Runecrafting Guild provenance. Candidate list has no reviewed physical surface box; this does not establish a missing service or full-bank grant. Roof interaction and usable withdrawal API were not tested. | [Bank deposit box rev. 37167169](https://runescape.wiki/w/Bank_deposit_box?oldid=37167169); [Wizards' Tower rev. 37109853](https://runescape.wiki/w/Wizards'_Tower?oldid=37109853) |
| Sedridor 3097,3147 plane 2 freely teleports to the rune essence mine. Rune Mysteries is no longer required to mine essence. Attached remote area permission is rule dependent; no prior quest gate should be invented. | **R** — Rune Essence mine and mining task/item source are accessed without a prior completed Rune Mysteries state. This agrees under tested connected/remote-area permission; strict one-coordinate rules can exclude that teleport-linked mine. | [Archmage Sedridor rev. 37161871](https://runescape.wiki/w/Archmage_Sedridor?oldid=37161871); [Rune Essence mine rev. 37180851](https://runescape.wiki/w/Rune_Essence_mine?oldid=37180851); [Rune Mysteries rev. 37162525](https://runescape.wiki/w/Rune_Mysteries?oldid=37162525) |
| Imp Catcher starts at Mizgog 3109,3148 plane 1 but now sends the player to four elemental-altar locations. It is not the old random-imp four-bead collection quest. Start possible; whole quest impossible in one tower chunk. | **✓** — Imp Catcher start available; laterstage 3 requires all four outside 2 a–2 d stages and completion remains blocked. No accuracy amulet is manufactured from local random imps. | [Imp Catcher rev. 37152851](https://runescape.wiki/w/Imp_Catcher?oldid=37152851); [Wizard Mizgog rev. 37147068](https://runescape.wiki/w/Wizard_Mizgog?oldid=37147068) |
| Rune Memories is members-only and follows Rune Mysteries in the attached tower ruins. Excluded in default F2P. | **✓** — All Rune Memories tasks have explicit membership blockers and are not presented under F2P. | [Rune Memories rev. 37153462](https://runescape.wiki/w/Rune_Memories?oldid=37153462); [Wizards' Tower rev. 37109853](https://runescape.wiki/w/Wizards'_Tower?oldid=37109853) |
| Oak 3119,3155 is local; another “outside Wizards’ Tower” oak 3061,3158 is in a different chunk. Local oak requires 15 Woodcutting, with lower training source separately needed. | **✓** — Oak/Tree reachable, local Oak logs closure exists from cutting; no outside 3061 surface base is granted. | [Oak rev. 37197269](https://runescape.wiki/w/Oak?oldid=37197269) |

<a id="12341"></a>
### 12341 — Barbarian Village / Stronghold entrance

Surface bounds: x 3072–3135; y 3392–3455. Picker displayed tasks: **2 literal / 53 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Four coal rocks at 3079,3420;3080,3419;3083,3422;3083,3419 occupy local central mine; old tin rocks were removed in 2019. 20 Mining required; local clay gives a low-level training source. | **✓** — Coal/clay sources reachable, primary Mining progression established; coal task available/presented. No old Tin rock declared; Tin ore in closure comes from drops, so not an obsolete-rock defect. | [Gunnarsgrunn mine rev. 37180784](https://runescape.wiki/w/Gunnarsgrunn_mine?oldid=37180784); [Coal rock rev. 37195300](https://runescape.wiki/w/Coal_rock?oldid=37195300) |
| South mine at 3082,3399 has three clay rocks; local well, potter’s wheel and pottery oven support soft clay and pottery. Fresh local Mining/Crafting progression. | **✓** — Clay, Soft clay and pottery products in closure. Lower clay/pot tasks are available but suppressed by higher urn goal, not absent. Local Crafting 110 capability supports attaining 5. | [Gunnarsgrunn south mine rev. 37180785](https://runescape.wiki/w/Gunnarsgrunn_south_mine?oldid=37180785) |
| Barbarian forge/anvil allows metal-bank access but cannot perform normal smelting/smithing. Ore storage available; regular bar/weapon Smithing needs another facility. | **✓** — Barbarian forge/anvil reachable but no ordinary bar smelting or equipment Smithing tasks available. Only urn completion tasks appear under Smithing. Silver bar drop exists but does not create normal forge access. | [Gunnarsgrunn mine rev. 37180784](https://runescape.wiki/w/Gunnarsgrunn_mine?oldid=37180784); [Barbarian Village rev. 37181129](https://runescape.wiki/w/Barbarian_Village?oldid=37181129) |
| Long Hall 3079,3440 has free cooked meat and beer spawns plus permanent cooking fires. Immediate food and local Cooking facility, independent of fishing skill/bait. | **✓** — Beer and Cooked meat have local spawn sources; Fire objects present and ordinary cooking is possible. No bank service is inferred. | [The Long Hall rev. 37110998](https://runescape.wiki/w/The_Long_Hall?oldid=37110998) |
| Peksa 3075,3429 sells positive-stock bronze–adamant medium/full helms including black; shop fire cooks food. Local coins and equip levels are separate. | **✓** — Peksa shop stock supplies positive-stock bronze–adamant and black helm variants. Local Coins have independent drop routes. | [Peksa's Helmet Shop rev. 37110999](https://runescape.wiki/w/Peksa's_Helmet_Shop?oldid=37110999) |
| River lure/bait spots 3108,3433 and 3104,3424 are local, with 20 Fishing fly-fishing and 25 Fishing bait requirements. Fresh level 1 cannot use these; sustainable local feathers/bait and low-level Fishing training are not proven by the spots alone. | **✓** — Local lure/bait spots are reachable but trout/pike/salmon are blocked by missing bait/feathers and Fishing 20/25/30 without level-1 Fishing training. Finished Trout in closure is not Raw trout and does not prove fishing access. | [Fishing spot (lure, bait) rev. 37196220](https://runescape.wiki/w/Fishing_spot_(lure%2C_bait)?oldid=37196220) |
| Gunnar’s Ground starts 3099,3422 requiring 5 Crafting, but needs Jeffery’s ring from Edgeville. Ordinary gold ring cannot substitute. Crafting 5 can be locally trained; quest still cannot complete in only 12341. | **✓** — Gunnar’s Ground start available/presented after local Crafting training; laterstage 3 and whole completion blocked by missing outside Jeffery stage 2. | [Gunnar's Ground rev. 37177980](https://runescape.wiki/w/Gunnar's_Ground?oldid=37177980) |
| Stronghold entrance 3082,3421 leads to four dungeon levels. Monsters are no longer aggressive, so all 10,000 coins, four emotes and fancy/fighting boots can be claimed by running. No combat kill is required; security-question/account UI conditions may need manual review. Attached dungeon policy matters. | **R** — Stronghold accessed and fancy boots/fighting boots/portal unlock tasks available/presented, no required combat kills. Valid when entrance-linked dungeon is allowed; strict surface-only rule changes access. Coins has alternate drop sources, so 10 k one-time provenance was not independently proven. | [Stronghold of Security rev. 37178687](https://runescape.wiki/w/Stronghold_of_Security?oldid=37178687) |
| Minotaurs/flesh crawlers/catablepon/ankou supply the four skull-sceptre pieces; minotaurs also drop iron arrows, food, rune essence and gold bars; shades drop shade robes. Combat progression/manual review is separate from proof of inability. Dungeon access is rule dependent. | **R** — Four sceptre pieces, assembled Skull sceptre and Shade robe drops present under accessed Stronghold area; assembly hidden only as Nonskill source prerequisite. Entry-linked dungeon permission is explicit. Wiki area’s gold-bar/rune-essence minotaur claim is absent from closure but current monster-specific evidence was not checked, so that subclaim remains unverified and is not scored as another M. | [Stronghold of Security rev. 37178687](https://runescape.wiki/w/Stronghold_of_Security?oldid=37178687) |

<a id="10806"></a>
### 10806 — Seers' Village

Surface bounds: x 2688–2751; y 3456–3519. Picker displayed tasks: **2 literal / 25 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Seers’ Village is members-only; F2P baseline does not establish actionable training here. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |
| Full Seers’ Village bank is in this coordinate chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seers' Village bank rev. 37122744](https://runescape.wiki/w/Seers'_Village_bank?oldid=37122744) |
| Elemental Workshop I starts at the bookcase inside this chunk; requires 20 Crafting, Mining, Smithing, thread and 4 coal. Level 44 earth elemental combat required. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Elemental Workshop I rev. 37182660](https://runescape.wiki/w/Elemental_Workshop_I?oldid=37182660) |
| Workshop entry needs the battered key cut from the book after starting Elemental Workshop I. A nearby entrance is not unconditional dungeon access. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Elemental Workshop I rev. 37182660](https://runescape.wiki/w/Elemental_Workshop_I?oldid=37182660) |
| Wiki bank page supports willow/maple trees outside bank; area-wide totals (11 yews/7 magic etc.) must not be copied into a single coordinate chunk. Tree tiles and tool progression remain unverified. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seers' Village bank rev. 37122744](https://runescape.wiki/w/Seers'_Village_bank?oldid=37122744); [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |
| Wiki update identifies an oak north of bank at (2729,3504), inside 10806. Level/tool requirements require separate source if this is scored. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |
| Seers’ Village lodestone must be activated before teleport use. Initial remote travel is not available merely because town has a lodestone. Exact lodestone chunk unverified here. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |

<a id="11061"></a>
### 11061 — Western Catherby

Surface bounds: x 2752–2815; y 3392–3455. Picker displayed tasks: **3 literal / 3 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Catherby is members-only. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Catherby rev. 37146502](https://runescape.wiki/w/Catherby?oldid=37146502) |
| Full Catherby bank plus deposit box lies inside 11061. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Catherby bank rev. 37133187](https://runescape.wiki/w/Catherby_bank?oldid=37133187) |
| Arhein’s Store is inside 11061 and stocks rope(18 gp), bucket(2 gp), knife(25 gp), seaweed and pineapple(2 gp, noted). Requires locally acquired coins; fresh empty account cannot assume purchasing power. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Arhein's Store rev. 37122529](https://runescape.wiki/w/Arhein's_Store?oldid=37122529) |
| Candle Shop is inside 11061. White candles cost 30 gp; free fork handle via Buy 4 White candle. | **O** — Handles for Forks is offered from ownership of this chunk despite no accessible seller in either F2P run. The valid F2P Wendle’s Wicks alternative is in locked chunk 16436. F2P achievement status does not grant local land access. | [Candle Shop rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292); [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529); [Handles for Forks rev. 36994980](https://runescape.wiki/w/Handles_for_Forks?oldid=36994980) |
| Catherby black candles require the bucket-of-wax exchange during Merlin’s Crystal before ordinary purchases; price 3 gp alone does not remove this gate. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Candle Shop rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292) |
| Vanessa’s Farming Shop is inside 11061 and supplies rake/seed dibber, secateurs, spade, watering can and compost; crops listed with zero stock are not fresh Ironman supplies. Seeds, locally acquired coins, and exact patch access still need validation. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Vanessa's Farming Shop rev. 37120770](https://runescape.wiki/w/Vanessa's_Farming_Shop?oldid=37120770) |
| Harry’s Fishing Shop and Hickton’s Archery Emporium are east of 11061, in 11317. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Harry's Fishing Shop rev. 37123118](https://runescape.wiki/w/Harry's_Fishing_Shop?oldid=37123118); [Hickton's Archery Emporium rev. 37127557](https://runescape.wiki/w/Hickton's_Archery_Emporium?oldid=37127557) |
| Catherby small-net/bait and cage/harpoon fishing spot coordinates are in 11317, not 11061. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217); [Fishing spot (cage, harpoon) rev. 37196214](https://runescape.wiki/w/Fishing_spot_(cage%2C_harpoon)?oldid=37196214) |

<a id="10035"></a>
### 10035 — Eastern West Ardougne

Surface bounds: x 2496–2559; y 3264–3327. Picker displayed tasks: **2 literal / 28 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| West Ardougne is members-only. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Normal first entry requires partial Plague City; main eastern gate becomes usable after Biohazard. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Plague City starts with Edmond(2565,3337), in 10292 outside 10035. West Ardougne page explicitly lists no quests to start there. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Plague City rev. 37152931](https://runescape.wiki/w/Plague_City?oldid=37152931); [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Chipped Ardougne teleport needs Plague City, Evil Dave’s Big Day Out and 51 Magic; it is not a fresh-account entry method. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Mourner Headquarters access needs Biohazard and further quests for deeper sections; range/sink inside are not unconditional fresh facilities. Exact Headquarters tiles not yet pinned. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Civilian’s cat exchange consumes a cat/overgrown cat for 100 death runes (200 with Ardougne cloak 1 reward). Fresh isolated Ironman cannot assume an imported cat or diary reward. Exact civilian tiles not yet pinned. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Two waterpumps(2527,3306),(2535,3306) are inside 10035 and can fill vessels, once city access and a container are available. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Waterpump (Ardougne) rev. 36444455](https://runescape.wiki/w/Waterpump_(Ardougne)?oldid=36444455) |
| Priest in chapel(2529,3285) is inside 10035; city page confirms chapel altar restores Prayer. Altar precise tile not separately pinned, chapel strongly resolved. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Priest (West Ardougne) rev. 37122819](https://runescape.wiki/w/Priest_(West_Ardougne)?oldid=37122819); [West Ardougne rev. 37130518](https://runescape.wiki/w/West_Ardougne?oldid=37130518) |
| Chadwell’s West Ardougne General Store(2466,3287) is in 9779 west of 10035; its food, rope, container and bow stock cannot supply this isolated chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [West Ardougne General Store rev. 37122558](https://runescape.wiki/w/West_Ardougne_General_Store?oldid=37122558) |

<a id="13878"></a>
### 13878 — Canifis

Surface bounds: x 3456–3519; y 3456–3519. Picker displayed tasks: **2 literal / 6 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Canifis is members-only. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299) |
| Priest in Peril completion is not the sole entrance route: defeating Paterdomus ghoul and passing holy barrier also works. Both involve another coordinate chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299) |
| Canifis full bank and deposit box lie inside 13878. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Canifis bank rev. 37133011](https://runescape.wiki/w/Canifis_bank?oldid=37133011) |
| Rufus inside 13878 sells raw beef, chicken, rat meat, bear meat; all listed raw fish have stock 0 and cannot supply fresh Ironman fish purchases. Requires local coins; cooking facility and funding not assumed. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Rufus's Meat Emporium rev. 37120795](https://runescape.wiki/w/Rufus's_Meat_Emporium?oldid=37120795) |
| Barker inside 13878 sells coloured gloves 650 gp and capes 20 gp; F2P tradeability of these items does not grant F2P land access. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Barker's Haberdashery rev. 37120720](https://runescape.wiki/w/Barker's_Haberdashery?oldid=37120720); [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299) |
| Hair of the Dog inside 13878 sells moonlight mead 5 gp; pickled brain 50 gp is quest-related and cannot be treated as arbitrary food. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179) |
| Attacked inhabitants transform from level 28 to 63 werewolves unless using wolfbane or Sunspear; fresh account has neither quest reward by default. Individual wandering NPC tile coverage unverified. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299); [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179) |
| Mort’ton trapdoor shortcut requires quest/minigame unlocks; reaching level 99 Zachory Bragg is not a fresh-account travel option. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299); [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179) |

<a id="16694"></a>
### 16694 — Highweald mine west and Ruins entrance

Surface bounds: x 4160–4223; y 3456–3519. Picker displayed tasks: **2 literal / 17 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Highweald mine is F2P but requires partial Visions of Havenhythe; quest starts in Port Sarim, outside this isolated chunk. Starting physically inside selected chunk is a separate house-rule sensitivity. | **R** — Literal has section-entry-required. Anchored main-section run is an explicitly placed-in-chunk sensitivity; it does not complete the Port Sarim quest or prove natural fresh-account arrival. | [Highweald mine rev. 37180796](https://runescape.wiki/w/Highweald_mine?oldid=37180796); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Two copper rocks inside 16694; Mining 1 and pickaxe required. Ordinary fresh bronze tool-belt pickaxe assumed; physical mine access still gated. | **U** — The Wiki places these rocks inside the square, but the tested forest starting section does not establish a route into the mine section. A missing-source or wrong-location defect is unproven. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Copper rock rev. 37195298](https://runescape.wiki/w/Copper_rock?oldid=37195298) |
| Four coal rocks inside 16694; Mining 20 required. Train Mining using copper after access; do not assume bank or smelting facility. | **U** — The Wiki places these rocks inside the square, but the tested forest starting section does not establish a route into the mine section. A missing-source or wrong-location defect is unproven. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Coal rock rev. 37195300](https://runescape.wiki/w/Coal_rock?oldid=37195300) |
| Two silver rocks inside 16694; Mining 20 required. | **U** — The Wiki places these rocks inside the square, but the tested forest starting section does not establish a route into the mine section. A missing-source or wrong-location defect is unproven. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Silver rock rev. 37195301](https://runescape.wiki/w/Silver_rock?oldid=37195301) |
| All mapped tin and iron rocks are east in 16950, not 16694; copper alone does not prove same-chunk bronze supply. | **✓** — Anchored admitted sources contain no Tin rock or Iron rock; adjacent 16950 run exposes exactly those mapped east-side ores. No observed cross-boundary ore attribution. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801) |
| Ruins entrance(4221,3485) inside 16694 is blocked by ancient boulder until partial Hearts of Sanguine. Surface mine access does not unlock Ruins ores. | **U** — The ruins are not admitted. The tested forest start does not exercise their entrance or quest gate; exact gate correctness remains unverified. | [Highweald Ruins mine rev. 37184319](https://runescape.wiki/w/Highweald_Ruins_mine?oldid=37184319) |
| Hollow tree(4191,3472) inside 16694 is members-only. Search produces spirit moths/rare Tellervo equipment; stump search can yield diary. | **R** — Hollow tree selector is present in anchored starting section, but member products/actions are not promoted as F2P resources. Physical selector presence alone does not establish a playable action. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077) |
| At local hollow tree, gold spirit moth capture starts 18 Hunter with butterfly/magic/Tellervo net. Barehanded requires 85 Hunter and 80 Agility; fresh tool belt does not assume butterfly net. | **R** — Gold spirit moth net task records 18 Hunter and butterfly-net requirement, and is blocked by membership. Barehand task records 85 Hunter/80 Agility and is blocked by F2P caps. Requirement numbers match Wiki; no fresh butterfly net presumed. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077); [Spirit moths rev. 37170278](https://runescape.wiki/w/Spirit_moths?oldid=37170278) |

<a id="16435"></a>
### 16435 — West Wendlewick Fishing Shop and beach

Surface bounds: x 4096–4159; y 3264–3327. Picker displayed tasks: **2 literal / 20 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Havenhythe/Wendlewick needs partial Visions of Havenhythe started outside selected chunk. Lodestone is unlocked only at quest completion. | **R** — Literal requires an entry anchor; anchored run explicitly begins in the local main section. This sensitivity does not prove fresh natural arrival without partial Visions. | [Havenhythe rev. 37209251](https://runescape.wiki/w/Havenhythe?oldid=37209251); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Fishing Shop(4142,3314) inside 16435 is F2P; stocks small net 40 gp, rod 5 gp, harpoon 45 gp, lobster pot 20 gp, bait 3 gp, feathers 6 gp. Local coins still needed; use fresh tool-belt fishing tools only if baseline explicitly includes them. | **✓** — Anchored run admits Fishing Shop and both Fisherman/Fisherwoman, and creates positive-stock equipment/bait/feather sources. Runtime also derives local Coins from juvenile boulder crabs. Actual wallet balances and purchases were not simulated. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Shop has an outside bank deposit box with Deposit all fish; this proves deposits only. Full bank Nathan(4177,3336) is in 16692, outside 16435. | **M** — The fishing-shop deposit candidate is in an admitted section, but reviewed deposit-service recognition is absent. This is a coverage gap in recognition, conditional on local entry; no full-bank, walking-route or UI failure is claimed. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534); [Banker Nathan rev. 37117341](https://runescape.wiki/w/Banker_Nathan?oldid=37117341) |
| Small-net/bait spots (4109,3291) and (4110,3291) are inside 16435, F2P after partial Visions. Shrimp starts at 1 Fishing and anchovies at 15, despite the spot page’s conflicting 5. Net fishing needs no bait; the spot page’s bait summary also conflicts with its sardine table. Page has inconsistent bait summary minimum 10 vs sardine table 5; do not use this source alone to flag sardine requirement mismatch. | **U** — Shrimp starts at 1. The spot page disagrees internally about bait requirements and lists anchovies at 5; the separate raw-anchovies page supports the picker’s 15. No picker requirement defect is established. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217); [Raw anchovies rev. 37168198](https://runescape.wiki/w/Raw_anchovies?oldid=37168198) |
| Cage/harpoon spots inside 16435: tuna 35 Fishing, lobster 40, swordfish 50. Harpoon or lobster pot required; fish catches provide local training after access. | **✓** — Cage/harpoon selector admitted; tuna 35, lobster 40 and swordfish 50 tasks available with matching tool requirements; highest swordfish method is presented. | [Fishing spot (cage, harpoon) rev. 37196214](https://runescape.wiki/w/Fishing_spot_(cage%2C_harpoon)?oldid=37196214) |
| Fishing shop lists all raw fish with zero stock; these cannot seed fresh Ironman supplies from another player’s sales. | **✓** — Observed raw fish sources are fishing tasks or juvenile-crab drops; zero-stock raw fish are not offered as Fishing Shop supply. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Wendlewick lodestone(4164,3311) is in 16691 outside 16435, and must be built during Visions. | **✓** — No local lodestone in 16435 snapshot; Wiki lodestone 4164,3311 belongs to 16691. No observed cross-boundary attribution. | [Wendlewick lodestone rev. 37193342](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) |

<a id="16950"></a>
### 16950 — Highweald mine east

Surface bounds: x 4224–4287; y 3456–3519. Picker displayed tasks: **2 literal / 12 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Surface mine is F2P after partial Visions of Havenhythe, whose start lies outside 16950. | **R** — Literal entry anchor is absent; anchored run begins inside main component. Starting-location sensitivity is distinct from completing Visions naturally. | [Highweald mine rev. 37180796](https://runescape.wiki/w/Highweald_mine?oldid=37180796); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Three tin rocks inside 16950; Mining 1 and pickaxe required. Ordinary fresh bronze tool-belt pickaxe assumed; entry remains gated. | **✓** — Tin rock admitted, Mine tin task available with level 1. Fresh ordinary tool-belt pickaxe assumption is qualified. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Tin rock rev. 37178976](https://runescape.wiki/w/Tin_rock?oldid=37178976) |
| Three iron rocks inside 16950; Mining 10 required, attainable from local tin once access is allowed. | **✓** — Iron rock admitted, Mine iron task available with level 10. Local tin provides the represented Mining route. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Iron rock rev. 37195299](https://runescape.wiki/w/Iron_rock?oldid=37195299) |
| Copper, coal and silver mapped nodes are across west boundary in 16694; bronze smelting cannot assume copper from same isolated chunk. | **✓** — No Copper rock, Coal rock, or Silver rock selectors or mining task output sources are admitted in 16950. These Wiki nodes lie west in 16694. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801) |
| Highweald Forest giant crayfish(4269,3432) is in 16949, south of 16950. The regional label does not place Fishing 82/giant crayfish here. | **✓** — No giant-crayfish method/spot admitted in 16950; Wiki spot 4269,3432 computes 16949. | [Giant crayfish (fishing spot) rev. 37196215](https://runescape.wiki/w/Giant_crayfish_(fishing_spot)?oldid=37196215) |
| Four mapped hollow trees are in 16694,16693,16949; none in 16950. | **✓** — No hollow-tree selector admitted in 16950; Wiki’s four mapped trees lie outside this chunk. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077) |

<a id="16436"></a>
### 16436 — West Wendlewick: Wendle's Wicks

Surface bounds: x 4096–4159; y 3328–3391. Picker displayed tasks: **2 literal / 15 anchored**.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Access to Wendlewick requires partial Visions; the quest start is in Port Sarim outside 16436. | **R** — Literal has section-entry-required; anchored run explicitly begins inside local main section. Quest journey from Port Sarim is not satisfied by this experiment. | [Wendlewick rev. 37194324](https://runescape.wiki/w/Wendlewick?oldid=37194324); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Wendle’s Wicks(4138,3334) inside 16436 is F2P and stocks 500 white candles at 30 gp. Local funding unverified. | **✓** — Wendle’s Wicks and Candle-maker Zeeva admitted; positive-stock White candle shop source represented. Local Coins are derived from juvenile crab drops; no actual purchase/wallet transaction observed. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Buy 4 White candle yields free untradeable fork handle and deducts no coins; supports Handles for Forks action without imported funds once shop accessible. | **✓** — Handles for Forks is presented available from local candle-seller alias. Wiki supports free fork-handle action here; absent explicit Fork handle item output alone is not a missing achievement claim. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Black candles cost 3 gp here without Merlin’s Crystal completion, but stock row is members-only; distinguish item membership from shop membership. | **R** — Black candle is absent from reachable items under F2P. Wiki stock row is members-only while Merlin’s Crystal completion is explicitly unnecessary here. Membership suppression is expected; P2P quest-gate sensitivity not exercised. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Full Wendlewick bank/Nathan (4177,3336) is in 16692, outside 16436. The Fishing Shop at (4142,3314), with its nearby deposit box, lies south in 16435; the shop’s map point is not an exact deposit-box coordinate. | **✓** — No bank source or physical service candidate in 16436. Shop deposit lies south 16435 and full bank east 16692. No observed attribution of either external service. | [Banker Nathan rev. 37117341](https://runescape.wiki/w/Banker_Nathan?oldid=37117341); [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Creeping ivy by pottery house(4164,3327–3329) and south of bank(4175/4177,3328) is east of 16436. Ivy is also members-only at 35 Woodcutting. | **✓** — No Creeping ivy selector admitted in 16436; Wiki mapped local ivy is across eastern boundary. | [Creeping ivy rev. 37201008](https://runescape.wiki/w/Creeping_ivy?oldid=37201008) |
| Lev’s Baked Delights(4169,3355) and Village Grocery(4196,3338) are in 16692; Tom’s Trove(4197,3323) in 16691, outside 16436. | **✓** — Only Wendle’s Wicks is admitted. Lev’s, Grocery and Tom’s are not incorrectly attributed to 16436. | [Lev's Baked Delights rev. 37108539](https://runescape.wiki/w/Lev's_Baked_Delights?oldid=37108539); [The Village Grocery rev. 37108537](https://runescape.wiki/w/The_Village_Grocery?oldid=37108537); [Tom's Trove rev. 37175714](https://runescape.wiki/w/Tom's_Trove?oldid=37175714) |

<a id="13613"></a>
### 13613 — Nardah

Surface bounds: x 3392–3455; y 2880–2943. Picker displayed tasks: **2 literal / 2 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Level 7 goats at(3395,2932),(3396,2934),(3409,2889),(3411,2885),(3415,2885) inside 13613 always drop bones and desert goat horn, supporting combat/Prayer and a horn source in member sensitivity. Source canonical title Goat; heat/funding/food considerations still apply. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Goat rev. 37143266](https://runescape.wiki/w/Goat?oldid=37143266) |
| Full Nardah bank(3427,2891) is inside 13613, with no quest requirement. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Fountain(3425,2915) inside 13613 is empty until Spirits of the Elid; fresh account cannot use it to fill vessels. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |
| Elidinis Statuette(3426,2930) inside 13613 restores Prayer and life points only after Spirits; initially plinth has only Examine. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Spirits of the Elid starts at mayor inside 13613 but requires 33 Magic/37 Mining/37 Ranged/37 Thieving, runes, rope, light source, thread and travel to River Elid cave outside town. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743); [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733) |
| Seddu inside 13613 sells armour and provides anvil/forge; shop inventory is not ore supply, and a forge does not prove a furnace. Locally earned coins and Mining/smelting inputs unverified. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| General Store(3416,2906) and Hunter Shop(3443,2902) inside 13613 supply containers/tools/traps for coins. No claim of local hunter targets or sufficient starting funds. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646) |
| Rok(3434,2908) inside 13613 sells choc ice 30 gp and chocolate bar 20 gp. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Rok's Chocs Box rev. 37181481](https://runescape.wiki/w/Rok's_Chocs_Box?oldid=37181481) |
| Zahur(3442,2886) inside 13613 cleans unnoted herbs for 200 gp and decants; she does not stock/sell herbs. No fresh imported herb/potion supplies assumed. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Zahur rev. 37141979](https://runescape.wiki/w/Zahur?oldid=37141979); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |
| Nardah magic carpet endpoint(3401,2918) inside 13613 exits locked chunk; current Magic carpet source says 1000 gp default. Nardah town page still says 200 gp, so use transport source and flag source conflict. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Magic carpet rev. 37035700](https://runescape.wiki/w/Magic_carpet?oldid=37035700); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |

<a id="13869"></a>
### 13869 — Desert east of Nardah

Surface bounds: x 3456–3519; y 2880–2943. Picker displayed tasks: **2 literal / 2 anchored**.

This square has only verified neighbouring-service exclusions in the checklist. It is not a completed census of positive local activities, and no claim of an empty chunk is made.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| This selected coordinate is adjacent desert in Nardah region; Nardah services are members-only. Exact land boundary requires world-map/in-game verification. Regional adjacency only; membership boundary not separately mapped. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187); [Kharidian Desert rev. 37130512](https://runescape.wiki/w/Kharidian_Desert?oldid=37130512) |
| Nardah bank(3427,2891) is in 13613, outside this selected chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Nardah fountain(3425,2915) is in 13613, outside this chunk, and requires Spirits of the Elid even with additional access. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187) |
| Elidinis Statuette(3426,2930) is in 13613 outside this chunk; no fresh local Prayer altar established. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Nardah General Store(3416,2906), Hunter Shop(3443,2902), Seddu(3407,2923) are all in 13613, outside selected chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646); [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| Mayor/Spirits start(3442,2912) is in 13613 outside selected chunk. No local quest start confirmed. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733); [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743) |

<a id="13614"></a>
### 13614 — Desert north of Nardah

Surface bounds: x 3392–3455; y 2944–3007. Picker displayed tasks: **2 literal / 2 anchored**.

Default F2P excludes the local members land. Each R row below uses that common policy qualification; member-mode capability was not independently tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| This selected coordinate is adjacent desert in Nardah region; Nardah services are members-only. Exact land boundary requires world-map/in-game verification. Regional adjacency only; membership boundary not separately mapped. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187); [Kharidian Desert rev. 37130512](https://runescape.wiki/w/Kharidian_Desert?oldid=37130512) |
| Nardah bank(3427,2891) is in 13613, outside this selected chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Nardah fountain(3425,2915) is in 13613, outside this chunk, and requires Spirits of the Elid even with additional access. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187) |
| Elidinis Statuette(3426,2930) is in 13613 outside this chunk; no fresh local Prayer altar established. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Nardah General Store(3416,2906), Hunter Shop(3443,2902), Seddu(3407,2923) are all in 13613, outside selected chunk. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646); [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| Mayor/Spirits start(3442,2912) is in 13613 outside selected chunk. No local quest start confirmed. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733); [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743) |
| Two mapped level 8 desert snakes(3403,2963),(3429,2976) are inside 13614; nonaggressive/nonpoisonous, always bones. Supports combat and bone-burying Prayer training in member sensitivity. Fresh combat feasibility not observed; no imported gear/food assumed. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Desert snake rev. 37157483](https://runescape.wiki/w/Desert_snake?oldid=37157483) |
| Exposed desert south of Shantay Pass causes dehydration damage without water; fresh account has no Crocodile Tears immunity. Exact safe tiles in 13614 are not mapped. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Desert heat rev. 37201752](https://runescape.wiki/w/Desert_heat?oldid=37201752) |
| A local cactus, even if found, needs a waterskin plus knife to yield one dose/10 Woodcutting XP. Waterskin acquisition inside 13614 is unverified; ordinary tool-belt knife alone is insufficient. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Waterskin rev. 36803585](https://runescape.wiki/w/Waterskin?oldid=36803585) |
| Mapped north-Nardah desert lizards (Slayer 22 plus ice cooler/shaker needed) are north/west of 13614; regional label cannot establish local Slayer/ore/waterskin drops. | **R** — Default F2P excludes this members-only land. The manually anchored sensitivity does not prove a legal F2P route or a usable members service. | [Desert lizard rev. 37142402](https://runescape.wiki/w/Desert_lizard?oldid=37142402) |

## First-pass verification and limits

All 50 captures completed. Checks confirmed one player, one unlocked base, empty saved rules, no recorded task completion and no saved task rows; release-profile and banking-evidence pins matched. The seed replay reproduced all 25 selections. The 214-check accounting reconciles exactly. Source validation checks the retrieved title/revision/content and audit-date cutoff; it does not establish that every Wiki assertion is correct. Conflicting fishing summaries and the Musa Point air-rune membership flag remain unresolved rather than forced into a defect category.

The 11 positive ground-spawn probes were Lumbridge logs, bronze dagger, bronze pickaxe, knife and mind rune; Draynor Manor spade, shears, bucket and bronze med helm; Mill Lane Mill’s empty pot; and Edgeville leather gloves. Each was present with spawn provenance, rather than merely an alternate shop/drop source. Wiki evidence: [Lumbridge Castle, rev. 37149520](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520), [castle bank, rev. 37110015](https://runescape.wiki/w/Lumbridge_Castle_bank?oldid=37110015), [Draynor Manor, rev. 37109852](https://runescape.wiki/w/Draynor_Manor?oldid=37109852), [Mill Lane Mill, rev. 37109893](https://runescape.wiki/w/Mill_Lane_Mill?oldid=37109893), and [Leather gloves, rev. 37132088](https://runescape.wiki/w/Leather_gloves?oldid=37132088). These positive controls do not establish complete spawn coverage.

This audit does not simulate account progression, combat survivability, every drop table, exact wallet balances, full collision routes, all floors, all member gameplay or usable-bank interactions. In particular, the Highweald forest start does not prove access to its mine section, and the Nardah-east checklist is incomplete. F2P member-land suppression is not a missing-content finding. The members follow-up below exercises valid members settings and starting placements. Bank routes, exact quest-stage evidence, combat survival and finite reward consumption remain outside its claims.


<a id="members-follow-up"></a>
## Members follow-up using saved rules

This pass uses the same pinned companion release and code as the first pass. Only the shared rules and the two players’ identical task-rule settings were extracted from a temporary save copy. The full copy was deleted. Each scratch save has one anonymous fresh player, one unlocked base chunk, no task completion, inventory, observed levels, personal quest history or recorded teleport activation. The shared rules are members content, automatic travel, transport admission, skill-guide tasks and combat corrections enabled. The older per-player F2P flag is superseded by the shared members setting.

The 154 copied task-rule settings are preserved privately. Relevant differences from defaults include boosting, secondary-primary methods and Smithing-by-smelting enabled; saved rare-drop cutoffs and disabled rare-table categories retained; whole-quest display enabled; and several optional categories disabled. A hidden optional goal is classified through its underlying source and requirement evidence rather than counted missing solely because it is absent from the display. This pass changes several settings together and is not a controlled membership-only experiment.

The ordinary main starting section is confirmed where the normal start procedure has one. This seeds a position within the single owned chunk; it does not grant every component, a completed entry quest or a route through locked neighbours. Havenhythe and other gated-region starts remain conditional placements. Travel captures distinguish potential outgoing routes from admitted source access and preserve personal quest, spellbook, fare and activation requirements. No bank interaction, exact backpack payment or combat survival was simulated.

Seed: **20261018**, with the same unsigned LCG 32 and descending Fisher–Yates algorithm as the first pass. Shuffle each pool excluding required anchors, retain anchors, then fill the quota from the shuffled order. Reject draws outside the audited registered surface world before capture; ID **13868** was rejected on this preflight and **13357** was the next draw. This rejection does not claim the real coastal square lacks content.

| Stratum | Quota | Input pool in order | Required anchors |
|---|---:|---|---|
| nardah | 4 | 13613, 13614, 13869, 13357, 13612, 13358, 13868 | 13613, 13614, 13869 |
| ourania | 2 | 9778, 9522, 9777, 10033, 10034 | 9778 |
| havenhythe | 4 | 16435, 16436, 16691, 16692, 16694, 16949 | None |
| members-hub | 5 | 10806, 11061, 10547, 10292, 13878, 10288, 10545, 11062 | None |

Chosen IDs in run order: **13613, 13614, 13869, 13357, 9778, 10033, 16949, 16435, 16694, 16692, 11061, 11062, 10547, 10806, 13878**.

The initial independent checklist contained 107 checks. Two targeted Nardah stock/gate checks and seven checks in a separately labelled **16436** shop-gate control bring this follow-up to **116 checks across 16 captures**. The control is not an RNG draw. Picker counts below are displayed available tasks; Wiki counts are bounded checks. They remain different units. M/O/Q/L/R retain the first-pass meanings; ✓ is a match and U is unresolved.

| Chunk and Wiki area | Picker | Wiki | M | O | Q | L | R | ✓ | U |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| [13613 — Nardah](#members-13613) | 2 | 13 | 2 | 0 | 1 | 0 | 1 | 8 | 1 |
| [13614 — Desert north of Nardah](#members-13614) | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 7 | 2 |
| [13869 — Desert east of Nardah](#members-13869) | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| [13357 — West Nardah and Genie Cave entrance](#members-13357) | 0 | 6 | 0 | 0 | 1 | 0 | 0 | 4 | 1 |
| [9778 — Ourania surface and connected cave](#members-9778) | 14 | 9 | 0 | 0 | 0 | 0 | 1 | 8 | 0 |
| [10033 — Tree Gnome Village](#members-10033) | 11 | 6 | 0 | 0 | 0 | 0 | 2 | 3 | 1 |
| [16949 — Raz's hut and Highweald Forest](#members-16949) | 9 | 6 | 0 | 0 | 0 | 0 | 1 | 5 | 0 |
| [16435 — West Wendlewick Fishing Shop and beach](#members-16435) | 5 | 7 | 1 | 0 | 0 | 0 | 1 | 5 | 0 |
| [16694 — Highweald mine west and Ruins entrance](#members-16694) | 6 | 8 | 0 | 0 | 0 | 0 | 1 | 3 | 4 |
| [16692 — Central Wendlewick](#members-16692) | 4 | 7 | 0 | 0 | 0 | 1 | 1 | 4 | 1 |
| [11061 — Western Catherby](#members-11061) | 8 | 7 | 0 | 0 | 0 | 0 | 1 | 6 | 0 |
| [11062 — Camelot Castle](#members-11062) | 3 | 5 | 0 | 0 | 0 | 0 | 1 | 4 | 0 |
| [10547 — East Ardougne market and south bank](#members-10547) | 15 | 8 | 0 | 0 | 1 | 0 | 1 | 6 | 0 |
| [10806 — Seers' Village](#members-10806) | 7 | 6 | 0 | 0 | 0 | 0 | 0 | 3 | 3 |
| [13878 — Canifis](#members-13878) | 0 | 7 | 0 | 0 | 1 | 0 | 2 | 3 | 1 |
| [16436 — West Wendlewick: Wendle's Wicks](#members-16436) | 4 | 7 | 0 | 0 | 1 | 0 | 2 | 4 | 0 |
| **Members total** | **88** | **116** | **3** | **0** | **5** | **1** | **15** | **78** | **14** |

### Members item, training and service captures

These are authored aggregate measurements, not a public source catalogue. A training signal is potential progression; item closure is not inventory. Physical bank candidates are not unique usable banks. Every complete private capture includes tasks, skills, items, travel and bank evidence.

| Chunk | Item appearances | Primary training signals | Physical/upstairs bank candidates | Extra admitted surface bases |
|---|---:|---:|---:|---:|
| 13613 | 36 | 6 | 4 | 0 |
| 13614 | 1 | 6 | 0 | 0 |
| 13869 | 0 | 0 | 0 | 0 |
| 13357 | 1 | 6 | 0 | 0 |
| 9778 | 116 | 12 | 0 | 0 |
| 10033 | 144 | 11 | 0 | 0 |
| 16949 | 66 | 10 | 0 | 0 |
| 16435 | 63 | 10 | 1 | 0 |
| 16694 | 13 | 10 | 0 | 0 |
| 16692 | 62 | 10 | 1 | 0 |
| 11061 | 164 | 12 | 5 | 0 |
| 11062 | 71 | 9 | 0 | 0 |
| 10547 | 152 | 11 | 4 | 0 |
| 10806 | 60 | 11 | 7 | 0 |
| 13878 | 74 | 0 | 6 | 0 |
| 16436 | 44 | 9 | 0 | 0 |

<a id="combined-ranking"></a>
## Combined ranking and proposed changes

1. **Entry and item gates lose source context — seven Q observations across both passes.** The first pass admitted members-only New Varrock/Vinesweeper sources into F2P starts. The members pass adds an obsolete Genie Cave rope condition on a later quest step, an overly strict Priest in Peril citizen gate, an ungated croc-ice product, and a global black-candle gate that wrongly suppresses Wendle’s Wicks. These are different records with a repeated failure: a location, item name or available task substitutes for the exact source and personal prerequisite. Use reviewed area identities and source-specific gates consumed by `app/tasks/access.mjs`; distinguish actually started/completed quests from potential completion. Preserve the ghoul/barrier alternative, the 2018 rope removal, and the during-or-after Crocodile Tears condition. Do not remove every gate or require full completion where partial progress suffices. Evidence: [New Varrock, rev. 37187626](https://runescape.wiki/w/New_Varrock?oldid=37187626), [Vinesweeper, rev. 37146867](https://runescape.wiki/w/Vinesweeper?oldid=37146867), [Crevice (Genie's Cave), rev. 36341662](https://runescape.wiki/w/Crevice_(Genie's_Cave)?oldid=36341662), [Genie's Cave, rev. 37121978](https://runescape.wiki/w/Genie's_Cave?oldid=37121978), [Canifis, rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299), [Boris, rev. 37139399](https://runescape.wiki/w/Boris?oldid=37139399), [Croc ice, rev. 36252300](https://runescape.wiki/w/Croc_ice?oldid=36252300), [Wendle's Wicks, rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529).

2. **Ordinary wild harvests lack item outputs — five M observations in four chunks.** The original onion/potato omissions and downstream dye failure extend to searchable Nardah banana trees. Add reviewed harvest/search actions with the admitted scenery requirement and the correct fruit/vegetable output, consumed by `app/tasks/engine.mjs`. Wild picking/searching must not need a Farming seed or award Farming XP. Existing ground-spawn controls, including the members butterfly net, succeed; this is a harvest mapping gap, not evidence that ground spawns are generally missing. Evidence: [Onion (scenery), rev. 37147464](https://runescape.wiki/w/Onion_(scenery)?oldid=37147464), [Potato (scenery), rev. 37131971](https://runescape.wiki/w/Potato_(scenery)?oldid=37131971), [Banana Tree, rev. 37132072](https://runescape.wiki/w/Banana_Tree?oldid=37132072), [Butterfly net, rev. 37132511](https://runescape.wiki/w/Butterfly_net?oldid=37132511).

3. **Paid NPC supplies fall outside the ordinary stock model — three M observations in three chunks.** Ned’s 15-coin/four-wool rope and Karim’s one-coin kebab are joined by Malik’s 1000-coin four-dose waterskin. Malik is declared locally but lacks stock; the other two transactions lack output declarations. Add reviewed paid source records or a transaction overlay with exact NPC, location, payment alternatives and product. Source closure must not imply an owned balance or a free item. The companion declarations feed `app/tasks/access.mjs`; exact payment quantities need a supported transaction seam. Evidence: [Ned, rev. 37127315](https://runescape.wiki/w/Ned?oldid=37127315), [Karim, rev. 37209164](https://runescape.wiki/w/Karim?oldid=37209164), [Malik the Carter, rev. 37120696](https://runescape.wiki/w/Malik_the_Carter?oldid=37120696).

4. **A shop is duplicated across a coordinate boundary — one L observation.** Central Wendlewick 16692 imports the Fishing Shop actually located in 16435. Remove only the duplicate central-town shop declaration through a guarded location overlay; preserve the correctly located shop and legitimate town baker/grocer. The location consumer is `app/tasks/access.mjs`. Other sampled boundary exclusions mostly held; this is one verified misplacement, not a claim that all town shops are misplaced. Evidence: [Fishing Shop (Wendlewick), rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534).

5. **A specific fish-deposit service is unrecognised — two M observations of the same variant.** The reachable Wendlewick beach deposit is still discarded by reviewed bank-service recognition in both settings. Add a narrow deposit-only service variant through the companion evidence consumed by `app/data/training/banking-destinations.mjs`. Preserve its fish-deposit capability; do not convert it to a full bank. Eniola is a positive counterexample: its conditional bank review already records the 20-held-rune fee and needs no fabricated fee correction. Evidence: [Fishing Shop (Wendlewick), rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534), [Eniola, rev. 37207373](https://runescape.wiki/w/Eniola?oldid=37207373).

6. **Achievement ownership can bypass seller access — one first-pass O observation.** Handles for Forks appeared in F2P Catherby without an admitted seller. Require an accessible seller rather than only ownership of a seller’s square. Keep the achievement’s F2P Wendle’s Wicks alternative. In the saved-rules members runs, its absent display is instead explained by Misc achievements=false. Evidence: [Handles for Forks, rev. 36994980](https://runescape.wiki/w/Handles_for_Forks?oldid=36994980), [Candle Shop, rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292), [Wendle's Wicks, rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529).

7. **Silk-stall theft uses the wrong level — one Q observation.** Change the guarded companion task’s Level from 15 to 20 using the existing retained-task correction seam consumed by `app/data/retained-task-corrections.mjs`. Both the specific scenery page and market page agree on 20. This run remains blocked at Thieving 1, so the defect is its latent requirement, not an immediately usable theft offer. Evidence: [Silk stall, rev. 37209241](https://runescape.wiki/w/Silk_stall?oldid=37209241), [Ardougne market, rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742).

8. **Finite quest rewards need quantity and claim state — one M observation.** Ernest’s eggs and feathers are missing from attainable-on-completion supply. Add finite reward metadata with quantities, personal completion/claim state and one-time provenance before exposing it through `app/tasks/engine.mjs`. Do not turn 300 feathers into a renewable training source or presume a claimed backpack reward. One quest is verified here; wider reward coverage remains unmeasured. Evidence: [Ernest the Chicken, rev. 37153377](https://runescape.wiki/w/Ernest_the_Chicken?oldid=37153377).

The private correction plan identifies exact pinned companion files, before records, selectors, consumers and proposed replacements. Every change is a proposal. No application code, source data, canonical private source, installed companion or live game state was changed.

## Members evidence by chunk

<a id="members-13613"></a>
### 13613 — Nardah (members)

Surface bounds: x 3392–3455; y 2880–2943. Displayed available tasks: **2**.

Members settings admit local shops, goats and the ordinary bank, but the saved presentation settings display only two equipment goals. Six primary training signals include the derived Combat summary. These are potential progression estimates, not present levels. The banana and waterskin omissions and the early croc-ice offer survive the display distinction.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Level 7 goats at(3395,2932),(3396,2934),(3409,2889),(3411,2885),(3415,2885) inside 13613 always drop bones and desert goat horn, supporting combat/Prayer and a horn source in member sensitivity. | **✓** — Goat and billy-goat sources provide bones and desert goat horns. Combat/Prayer signals are present; no safe level-1 fight or owned level is claimed. | [Goat rev. 37143266](https://runescape.wiki/w/Goat?oldid=37143266) |
| Full Nardah bank(3427,2891) is inside 13613, with no quest requirement. | **✓** — Four physical bank placements receive full-bank recognition in the admitted starting area, with no quest prerequisite. No bank interaction was performed. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Fountain(3425,2915) inside 13613 is empty until Spirits of the Elid; fresh account cannot use it to fill vessels. | **✓** — No usable fountain or water-filling source appears in the fresh closure. It does not grant the post-Spirits water source. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |
| Elidinis Statuette(3426,2930) inside 13613 restores Prayer and life points only after Spirits; initially plinth has only Examine. | **✓** — No usable Elidinis prayer/healing source is admitted for the uncompleted quest. The bank remains separate from the shrine. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Spirits of the Elid starts at mayor inside 13613 but requires 33 Magic/37 Mining/37 Ranged/37 Thieving, runes, rope, light source, thread and travel to River Elid cave outside town. | **✓** — The first Spirits step records Magic 33 and Mining/Ranged/Thieving 37 and is blocked by the fresh training situation. Completion also requires out-of-chunk stages; no completion or reward is granted. | [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743); [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733) |
| Seddu inside 13613 sells armour and provides anvil/forge; shop inventory is not ore supply, and a forge does not prove a furnace. | **✓** — Anvil and forge are admitted, but no furnace or Smithing training route is inferred from the armour shop. | [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| General Store(3416,2906) and Hunter Shop(3443,2902) inside 13613 supply containers/tools/traps for coins. | **✓** — Both shops contribute containers and hunting tools from positive stock. This records potential purchases, not starting money or owned traps, and does not invent a local level-1 Hunter target. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646) |
| Rok(3434,2908) inside 13613 sells choc ice 30 gp and chocolate bar 20 gp. | **✓** — Ordinary choc ice and chocolate bars have local shop sources. Coin balances and actual purchases were not simulated; quest-only croc ice is scored separately. | [Rok's Chocs Box rev. 37181481](https://runescape.wiki/w/Rok's_Chocs_Box?oldid=37181481) |
| Zahur(3442,2886) inside 13613 cleans unnoted herbs for 200 gp and decants; she does not stock/sell herbs. No fresh imported herb/potion supplies assumed. | **U** — Zahur is present and no herb stock is invented. Her cleaning/decanting interaction, payment and input quantities were not exercised; service completeness remains unverified. | [Zahur rev. 37141979](https://runescape.wiki/w/Zahur?oldid=37141979); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |
| Nardah magic carpet endpoint(3401,2918) inside 13613 exits locked chunk; current Magic carpet source says 1000 gp default. Nardah town page still says 200 gp, so use transport source and flag source conflict. | **R** — Automatic travel and transport admission are enabled, but no outgoing usable route or additional owned surface is granted. A fare-funded carpet trip to locked land remains a separate travel-policy and payment question; the capture does not validate carpet-route coverage. | [Magic carpet rev. 37035700](https://runescape.wiki/w/Magic_carpet?oldid=37035700); [Nardah rev. 36803187](https://runescape.wiki/w/Nardah?oldid=36803187) |
| Searchable banana trees at 3411,2925;3413,2918;3438,2904;3446,2889;3450,2932 are all inside 13613 and can yield bananas without a Farming seed/level. No Farming XP should be inferred. | **M** — All five searchable trees lie inside this square. The admitted tree source produces no Banana item; the unrelated Bones to Bananas spell is blocked. Add the ordinary search-to-fruit source without Farming XP. | [Banana Tree rev. 37132072](https://runescape.wiki/w/Banana_Tree?oldid=37132072) |
| Malik the Carter 3421,2914 is inside 13613 and sells four-dose waterskins for 1000 coins with infinite stock, before or after Spirits of the Elid. Purchases still require local funding. | **M** — Malik is admitted and a waterskin seller is declared, but its stock is missing and no waterskin enters the item closure. Add the documented four-dose purchase at 1000 coins as a conditional paid source; do not imply a starting balance. | [Malik the Carter rev. 37120696](https://runescape.wiki/w/Malik_the_Carter?oldid=37120696) |
| Croc ice can only be bought during or after Crocodile Tears. Its 1000 coin price and 50 stock do not allow an unstarted fresh account to buy it. It is distinct from ordinary choc ice. | **Q** — Croc ice is supplied by the local shop despite no started or completed Crocodile Tears. The Wiki permits purchases only during or after that quest. Preserve ordinary choc ice and gate this distinct product. | [Croc ice rev. 36252300](https://runescape.wiki/w/Croc_ice?oldid=36252300); [Rokuh rev. 37173815](https://runescape.wiki/w/Rokuh?oldid=37173815) |

<a id="members-13614"></a>
### 13614 — Desert north of Nardah (members)

Surface bounds: x 3392–3455; y 2944–3007. Displayed available tasks: **0**.

Only bone supply and potential melee/Prayer progression appear. No task rows are displayed under the saved settings. The run does not establish sustainable level-1 combat under desert heat.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Nardah bank(3427,2891) is in 13613, outside this selected chunk. | **✓** — No Nardah-town bank, fountain, shrine, shop or quest-start source is imported across the coordinate boundary. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Nardah fountain(3425,2915) is in 13613, outside this chunk, and requires Spirits of the Elid even with additional access. | **✓** — No Nardah-town bank, fountain, shrine, shop or quest-start source is imported across the coordinate boundary. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187) |
| Elidinis Statuette(3426,2930) is in 13613 outside this chunk; no fresh local Prayer altar established. | **✓** — No Nardah-town bank, fountain, shrine, shop or quest-start source is imported across the coordinate boundary. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Nardah General Store(3416,2906), Hunter Shop(3443,2902), Seddu(3407,2923) are all in 13613, outside selected chunk. | **✓** — No Nardah-town bank, fountain, shrine, shop or quest-start source is imported across the coordinate boundary. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646); [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| Mayor/Spirits start(3442,2912) is in 13613 outside selected chunk. No local quest start confirmed. | **✓** — No Nardah-town bank, fountain, shrine, shop or quest-start source is imported across the coordinate boundary. | [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733); [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743) |
| Two mapped level 8 desert snakes(3403,2963),(3429,2976) are inside 13614; nonaggressive/nonpoisonous, always bones. Supports combat and bone-burying Prayer training in member sensitivity. | **✓** — Desert snake and jackal sources are admitted, and bones have snake provenance. This verifies the local source/drop relationship, not indefinite safe combat. | [Desert snake rev. 37157483](https://runescape.wiki/w/Desert_snake?oldid=37157483) |
| Exposed desert south of Shantay Pass causes dehydration damage without water; fresh account has no Crocodile Tears immunity. Exact safe tiles in 13614 are not mapped. | **U** — The evaluator estimates source capability and does not demonstrate a sustainable heat-management route. Exact safe tiles, water consumption and combat survival were not tested. | [Desert heat rev. 37201752](https://runescape.wiki/w/Desert_heat?oldid=37201752) |
| A local cactus, even if found, needs a waterskin plus knife to yield one dose/10 Woodcutting XP. Waterskin acquisition inside 13614 is unverified; ordinary tool-belt knife alone is insufficient. | **U** — No cactus, waterskin or cactus-water action appears. The Wiki does not locate a harvestable cactus in this selected square, so absence cannot establish a missing source. | [Waterskin rev. 36803585](https://runescape.wiki/w/Waterskin?oldid=36803585) |
| Mapped north-Nardah desert lizards (Slayer 22 plus ice cooler/shaker needed) are north/west of 13614; regional label cannot establish local Slayer/ore/waterskin drops. | **✓** — No desert-lizard source or Slayer training is imported from the mapped locations north/west of this square. | [Desert lizard rev. 37142402](https://runescape.wiki/w/Desert_lizard?oldid=37142402) |

<a id="members-13869"></a>
### 13869 — Desert east of Nardah (members)

Surface bounds: x 3456–3519; y 2880–2943. Displayed available tasks: **0**.

The five checks are geographical exclusions only. No positive local activity has been independently verified; zero captured items/tasks must not be read as a complete empty-chunk finding.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Nardah bank(3427,2891) is in 13613, outside this selected chunk. | **✓** — No service or quest start from neighbouring Nardah is attributed to this isolated square. Positive local coverage remains incomplete. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Nardah fountain(3425,2915) is in 13613, outside this chunk, and requires Spirits of the Elid even with additional access. | **✓** — No service or quest start from neighbouring Nardah is attributed to this isolated square. Positive local coverage remains incomplete. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187) |
| Elidinis Statuette(3426,2930) is in 13613 outside this chunk; no fresh local Prayer altar established. | **✓** — No service or quest start from neighbouring Nardah is attributed to this isolated square. Positive local coverage remains incomplete. | [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |
| Nardah General Store(3416,2906), Hunter Shop(3443,2902), Seddu(3407,2923) are all in 13613, outside selected chunk. | **✓** — No service or quest start from neighbouring Nardah is attributed to this isolated square. Positive local coverage remains incomplete. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646); [Seddu's Adventurers' Store rev. 37120656](https://runescape.wiki/w/Seddu's_Adventurers'_Store?oldid=37120656) |
| Mayor/Spirits start(3442,2912) is in 13613 outside selected chunk. No local quest start confirmed. | **✓** — No service or quest start from neighbouring Nardah is attributed to this isolated square. Positive local coverage remains incomplete. | [Awusah the Mayor rev. 37140733](https://runescape.wiki/w/Awusah_the_Mayor?oldid=37140733); [Spirits of the Elid rev. 37182743](https://runescape.wiki/w/Spirits_of_the_Elid?oldid=37182743) |

<a id="members-13357"></a>
### 13357 — West Nardah and Genie Cave entrance (members)

Surface bounds: x 3328–3391; y 2880–2943. Displayed available tasks: **0**.

The linked cave is admitted and contributes desert-snake bones without a light supply. Its later quest step retains an obsolete rope requirement; that stage remains blocked for other reasons. Exact darkness and warning behaviour was not tested.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Genie Cave crevice 3373,2912 lies inside 13357 and needs a light source. A fresh tool belt tinderbox alone is not a lit light source. The rope requirement was removed in 2018 despite the stale examine text. | **Q** — The later Spirits quest step still demands rope, although the crevice rope requirement was removed in 2018. This is a latent requirement error; the quest remains blocked for other reasons. The cave is also admitted without the Wiki-stated light preparation, but entry-warning and darkness behaviour were not tested, so this audit does not infer a hard server entry block. | [Genie's Cave rev. 37121978](https://runescape.wiki/w/Genie's_Cave?oldid=37121978); [Crevice (Genie's Cave) rev. 36341662](https://runescape.wiki/w/Crevice_(Genie's_Cave)?oldid=36341662) |
| The cave contains level 8 desert snakes dropping bones; these are connected-interior sources, conditional on legal cave entry and combat. | **✓** — Desert snakes and their bones are represented in the connected cave. Their source identity is correct after legal lit entry; the separate entry defect is scored once above. | [Desert snake rev. 37157483](https://runescape.wiki/w/Desert_snake?oldid=37157483); [Genie's Cave rev. 37121978](https://runescape.wiki/w/Genie's_Cave?oldid=37121978) |
| Wiki maps jackals at 3376,2907 and 3378,2905–2908/2933–2935 in 13357; level 49 aggressive monsters are not demonstrated safe level 1 training. | **U** — Jackals are represented in the correct surface square, but safe fresh combat against aggressive level 49 packs and desert heat was not demonstrated. | [Jackal rev. 37143366](https://runescape.wiki/w/Jackal?oldid=37143366) |
| Nardah bank at 3427,2891 lies outside this chunk. | **✓** — No bank, shop or usable fountain from the neighbouring Nardah square is imported. | [Nardah bank rev. 37133170](https://runescape.wiki/w/Nardah_bank?oldid=37133170) |
| Nardah General Store 3416,2906 and Hunter Shop 3443,2902 are outside this chunk. | **✓** — No bank, shop or usable fountain from the neighbouring Nardah square is imported. | [Nardah General Store rev. 37120645](https://runescape.wiki/w/Nardah_General_Store?oldid=37120645); [Nardah Hunter Shop rev. 37120646](https://runescape.wiki/w/Nardah_Hunter_Shop?oldid=37120646) |
| Fountain 3425,2915 and Elidinis Statuette 3426,2930 are outside this chunk and require Spirits of the Elid. | **✓** — No bank, shop or usable fountain from the neighbouring Nardah square is imported. | [Fountain (Nardah) rev. 35969187](https://runescape.wiki/w/Fountain_(Nardah)?oldid=35969187); [Elidinis Statuette rev. 36518737](https://runescape.wiki/w/Elidinis_Statuette?oldid=36518737) |

<a id="members-9778"></a>
### 9778 — Ourania surface and connected cave (members)

Surface bounds: x 2432–2495; y 3200–3263. Displayed available tasks: **14**.

The altar and crafter essence drops are represented; luminite, salamander and 107 Thieving chest methods remain blocked from their unsupported starting skills or supplies. Eniola is present and the separate bank review already states the 20-held-rune fee. The capture does not demonstrate a paid banking trip.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Surface cave entrance 2453,3232 lies within 9778. Owning the surface is distinct from granting arbitrary underground squares. The connected cave has a safe long path and a dangerous short path. | **R** — The tested start admits the connected Ourania interior through the ordinary attached-area policy. Strict coordinate-only permission and a surface-only start would give different scope; no independent underground square was unlocked. | [Ourania Cave rev. 37130807](https://runescape.wiki/w/Ourania_Cave?oldid=37130807) |
| Eniola just inside Ourania Cave is a full banker, but each bank access costs 20 runes of one type already in the backpack. Fresh empty inventory cannot assume free banking. | **✓** — Eniola is admitted. The bank review explicitly classifies this as conditional and records 20 held runes of one type per opening. No unconditional free-bank recognition or paid interaction is claimed; zero physical bank-object candidates is not a missing-banker finding. | [Eniola rev. 37207373](https://runescape.wiki/w/Eniola?oldid=37207373) |
| Ourania altar consumes pure essence, requires no talisman or minimum Runecrafting level, and gives random runes. No pure essence in a fresh backpack is assumed. | **✓** — The level 1 altar method requires pure essence and is available through crafter-drop supply. No talisman or higher Runecrafting level is imposed. Availability means potential progression through combat, not an initial essence stack. | [Ourania Runecrafting Altar rev. 37207369](https://runescape.wiki/w/Ourania_Runecrafting_Altar?oldid=37207369) |
| Three cave chests on the long path require 107 Thieving and six successful actions; yield runes and noted pure essence. They cannot bootstrap an isolated level 1 thief without a training route. | **✓** — The chest method records 107 Thieving and is blocked at reachable Thieving 1. Its essence does not bootstrap low-level Thieving or the altar. | [Chest (Ourania Cave) rev. 37209342](https://runescape.wiki/w/Chest_(Ourania_Cave)?oldid=37209342) |
| Ourania Battlefield mine at 2473,3253 is inside 9778 and contains luminite rocks. Mining them requires 40 Mining; five luminite rocks alone do not establish a level 1 Mining route. | **✓** — Luminite is located locally and requires Mining 40. The method is blocked because no level-1 Mining progression is available here. | [Ourania Battlefield mine rev. 37180843](https://runescape.wiki/w/Ourania_Battlefield_mine?oldid=37180843); [Luminite rock rev. 37180794](https://runescape.wiki/w/Luminite_rock?oldid=37180794) |
| Ourania Hunter area 2463,3232 is inside 9778. Red salamanders require 59 Hunter, small fishing net and rope; no lower-level local Hunter route or imported rope is assumed. | **✓** — Red-salamander trapping records Hunter 59, a physical small net and rope, and remains blocked. A tool-belt fishing tool is not an inventory net consumable for traps. | [Ourania Hunter area rev. 37131691](https://runescape.wiki/w/Ourania_Hunter_area?oldid=37131691) |
| The long-path cave crack has no Agility-level requirement; danger on the short path is not a mandatory level requirement. | **✓** — The connected altar path has no extra Agility-level gate. No mandatory short-path combat level is invented for the safe longer path. | [Crack (Ourania Cave) rev. 36783591](https://runescape.wiki/w/Crack_(Ourania_Cave)?oldid=36783591); [Ourania Runecrafting Altar rev. 37207369](https://runescape.wiki/w/Ourania_Runecrafting_Altar?oldid=37207369) |
| Ourania Teleport requires 71 Magic and Lunar spellbook access. A fresh account has neither; enabled automatic travel must preserve these requirements. | **✓** — Ourania Teleport records Magic 71, runes and Lunar Diplomacy and is blocked. Automatic travel does not establish that quest or spellbook. | [Ourania Runecrafting Altar rev. 37207369](https://runescape.wiki/w/Ourania_Runecrafting_Altar?oldid=37207369) |
| Zamorak crafters in the cave can drop pure essence. Presence of this combat source is distinct from the 107 Thieving chest route; safe fresh combat has not been demonstrated. | **✓** — Pure essence has Zamorak-crafter drop provenance, independently of the inaccessible chest method. A successful fresh fight was not observed. | [Zamorak crafter rev. 37137951](https://runescape.wiki/w/Zamorak_crafter?oldid=37137951); [Ourania Cave rev. 37130807](https://runescape.wiki/w/Ourania_Cave?oldid=37130807) |

<a id="members-10033"></a>
### 10033 — Tree Gnome Village (members)

Surface bounds: x 2496–2559; y 3136–3199. Displayed available tasks: **11**.

The quest can be started locally but its first step is hidden by whole-quest display. No spirit-tree or glider travel becomes available. Main-section placement and guided maze movement remain separate.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| King Bolren 2542,3169 is inside 10033 and can start Tree Gnome Village. Completion needs battlefield actions outside the isolated chunk. | **R** — The King Bolren start step is available, while completion is blocked by external stages. The saved Show Quest Tasks Complete setting hides the available partial step; this is display policy, not a missing quest start. | [King Bolren rev. 37131784](https://runescape.wiki/w/King_Bolren?oldid=37131784); [Tree Gnome Village rev. 37182669](https://runescape.wiki/w/Tree_Gnome_Village?oldid=37182669) |
| Spirit-tree transport requires Tree Gnome Village completion. It is not unlocked by owning the village or by being able to start the quest. | **✓** — No spirit-tree journey is granted without quest completion evidence. Available quest-start dialogue is not treated as a completed travel unlock. | [Tree Gnome Village (location) rev. 37198480](https://runescape.wiki/w/Tree_Gnome_Village_(location)?oldid=37198480); [Spirit tree rev. 37200827](https://runescape.wiki/w/Spirit_tree?oldid=37200827) |
| Both mapped Elkoy positions,2514,3159 and 2504,3191, are inside 10033. Guided maze travel requires starting Tree Gnome Village; an available start is distinct from recorded personal progress. | **U** — Elkoy is admitted, but the Follow interaction and a personal started-quest observation were not exercised. Both mapped positions are in this square; no location defect is inferred from the two declarations. | [Elkoy rev. 37131789](https://runescape.wiki/w/Elkoy?oldid=37131789) |
| The village area page lists zero banks; no automatic full bank should be inferred from the spirit tree or the name of the settlement. | **✓** — No full-bank source or reviewed bank candidate is created from the spirit tree or village name. | [Tree Gnome Village (location) rev. 37198480](https://runescape.wiki/w/Tree_Gnome_Village_(location)?oldid=37198480) |
| The village is enclosed by a hedge maze with loose-railing access. An isolated base does not erase walls or grant every disconnected part. | **R** — Only the selected main component is seeded. The run does not unlock all other sections or establish every maze route; its initial position is a stated starting assumption. | [Tree Gnome Village (location) rev. 37198480](https://runescape.wiki/w/Tree_Gnome_Village_(location)?oldid=37198480) |
| The local glider route requires The Prisoner of Glouphrie. Fresh automatic travel cannot assume that quest. | **✓** — The glider does not become an available journey; its quest/network prerequisites are retained. | [Tree Gnome Village (location) rev. 37198480](https://runescape.wiki/w/Tree_Gnome_Village_(location)?oldid=37198480) |

<a id="members-16949"></a>
### 16949 — Raz's hut and Highweald Forest (members)

Surface bounds: x 4224–4287; y 3392–3455. Displayed available tasks: **9**.

The butterfly-net spawn is present. Higher Hunter and giant-crayfish methods are correctly blocked; a net alone does not bootstrap level 18 Hunter. Local tree supply can produce an oaken key, so stash loot is potential key-gated progression rather than free initial inventory.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Havenhythe requires partial Visions of Havenhythe; isolated placement here does not establish the journey from Port Sarim. | **R** — Starting here does not complete the Port Sarim journey or Visions. These are conditional local-placement results. | [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723); [Havenhythe rev. 37209251](https://runescape.wiki/w/Havenhythe?oldid=37209251) |
| Butterfly net spawn 4282,3434 is inside 16949, in Raz’s house; item membership applies, and partial Visions is required. | **✓** — Butterfly net is present with ground-spawn provenance in Raz’s house. This positive control contradicts a blanket missing-spawn theory. | [Butterfly net rev. 37132511](https://runescape.wiki/w/Butterfly_net?oldid=37132511); [Raz rev. 37203159](https://runescape.wiki/w/Raz?oldid=37203159) |
| Mapped hollow trees 4261,3412 and 4249,3449 lie inside 16949. Gold spirit moth netting requires 18 Hunter and a net; barehanding requires 85 Hunter and 80 Agility. No level 1 Hunter bootstrap is presumed. | **✓** — Netting requires Hunter 18; barehand methods require Hunter 85 and Agility 80. They remain blocked by missing progression, even with a locally obtainable net. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077); [Gold spirit moth rev. 37143788](https://runescape.wiki/w/Gold_spirit_moth?oldid=37143788) |
| Creeping ivy requires 35 Woodcutting and gives no logs. A local ivy selector does not create a log supply. | **✓** — The ivy method records Woodcutting 35 and does not produce logs. Logs in closure come from ordinary trees instead. | [Creeping ivy rev. 37201008](https://runescape.wiki/w/Creeping_ivy?oldid=37201008) |
| Raz’s stash requires an oaken key, obtained through eligible Havenhythe activities; it is not a free chest for a newly placed player. | **✓** — Stash looting explicitly requires an oaken key. Local tree activities can supply a key in potential progression; loot is not asserted to be already held. | [Raz rev. 37203159](https://runescape.wiki/w/Raz?oldid=37203159) |
| Giant crayfish spot 4269,3432 lies inside 16949;82 Fishing required. This is not ordinary level 1 crayfish. | **✓** — Giant-crayfish catching requires Fishing 82 and remains blocked at Fishing 1. It is not treated as ordinary beginner crayfish. | [Giant crayfish (fishing spot) rev. 37196215](https://runescape.wiki/w/Giant_crayfish_(fishing_spot)?oldid=37196215) |

<a id="members-16435"></a>
### 16435 — West Wendlewick Fishing Shop and beach (members)

Surface bounds: x 4096–4159; y 3264–3327. Displayed available tasks: **5**.

The fishing shop, basic net route and later fish levels are represented. Anchovies 15 is corroborated by the specific item page, resolving the earlier spot-page conflict for this follow-up. Deposit-only recognition remains missing.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Havenhythe/Wendlewick needs partial Visions of Havenhythe started outside selected chunk. Lodestone is unlocked only at quest completion. | **R** — This main-section placement does not complete Visions or establish the natural entry journey. | [Havenhythe rev. 37209251](https://runescape.wiki/w/Havenhythe?oldid=37209251); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Fishing Shop(4142,3314) inside 16435 is F2P; stocks small net 40 gp, rod 5 gp, harpoon 45 gp, lobster pot 20 gp, bait 3 gp, feathers 6 gp. | **✓** — The local shop supplies positive-stock equipment, bait and feathers. Coins have a local crab-drop source, but no wallet or actual purchase is simulated. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Shop has an outside bank deposit box with Deposit all fish; this proves deposits only. Full bank Nathan(4177,3336) is in 16692, outside 16435. | **M** — The reachable outside fish-deposit candidate still receives no reviewed service recognition. This repeats the first-pass recognition gap; it does not establish a failed bank UI route or a missing full bank. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534); [Banker Nathan rev. 37117341](https://runescape.wiki/w/Banker_Nathan?oldid=37117341) |
| Small-net/bait spots(4109,3291),(4110,3291) inside 16435 are F2P after partial Visions. Shrimps 1 Fishing, anchovies 5; net needs no bait. | **✓** — Shrimp 1 and anchovies 15 are available through local net fishing. Raw anchovies explicitly confirms 15, so the spot page’s inconsistent 5 is not scored as a picker error. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217); [Raw anchovies rev. 37168198](https://runescape.wiki/w/Raw_anchovies?oldid=37168198) |
| Cage/harpoon spots inside 16435: tuna 35 Fishing, lobster 40, swordfish 50. Harpoon or lobster pot required; fish catches provide local training after access. | **✓** — Tuna 35, lobster 40 and swordfish 50 are available through local progression with appropriate catching methods. | [Fishing spot (cage, harpoon) rev. 37196214](https://runescape.wiki/w/Fishing_spot_(cage%2C_harpoon)?oldid=37196214) |
| Fishing shop lists all raw fish with zero stock; these cannot seed fresh Ironman supplies from another player’s sales. | **✓** — No raw fish is supplied by zero-stock shop rows. Fish provenance is local catching or crab drops. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Wendlewick lodestone(4164,3311) is in 16691 outside 16435, and must be built during Visions. | **✓** — No Wendlewick lodestone is attributed to 16435; the mapped location is in 16691. | [Wendlewick lodestone rev. 37193342](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) |

<a id="members-16694"></a>
### 16694 — Highweald mine west and Ruins entrance (members)

Surface bounds: x 4160–4223; y 3456–3519. Displayed available tasks: **6**.

The main start is on the forest side, not the mine-side section. Missing ore offers are therefore unresolved traversal questions, not missing-rock findings. Members moth requirements remain blocked correctly.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Highweald mine is F2P but requires partial Visions of Havenhythe; quest starts in Port Sarim, outside this isolated chunk. | **R** — The conditional forest start does not complete Visions or grant every same-chunk component. | [Highweald mine rev. 37180796](https://runescape.wiki/w/Highweald_mine?oldid=37180796); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Two copper rocks inside 16694; Mining 1 and pickaxe required. | **U** — The Wiki nodes lie inside this coordinate square, but the selected forest start does not admit the mine-side section. No legitimate local traversal into that section was independently verified, so absence is not scored missing. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Copper rock rev. 37195298](https://runescape.wiki/w/Copper_rock?oldid=37195298) |
| Four coal rocks inside 16694; Mining 20 required. | **U** — The Wiki nodes lie inside this coordinate square, but the selected forest start does not admit the mine-side section. No legitimate local traversal into that section was independently verified, so absence is not scored missing. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Coal rock rev. 37195300](https://runescape.wiki/w/Coal_rock?oldid=37195300) |
| Two silver rocks inside 16694; Mining 20 required. | **U** — The Wiki nodes lie inside this coordinate square, but the selected forest start does not admit the mine-side section. No legitimate local traversal into that section was independently verified, so absence is not scored missing. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801); [Silver rock rev. 37195301](https://runescape.wiki/w/Silver_rock?oldid=37195301) |
| All mapped tin and iron rocks are east in 16950, not 16694; copper alone does not prove same-chunk bronze supply. | **✓** — No tin or iron source from the eastern mine square is imported into this forest start. | [Map:Highweald mine rev. 37057801](https://runescape.wiki/w/Map%3AHighweald_mine?oldid=37057801) |
| Ruins entrance(4221,3485) inside 16694 is blocked by ancient boulder until partial Hearts of Sanguine. Surface mine access does not unlock Ruins ores. | **U** — The quest-gated Ruins are not admitted, but the run never reaches the mine-side entrance. It does not independently exercise the Hearts of Sanguine gate. | [Highweald Ruins mine rev. 37184319](https://runescape.wiki/w/Highweald_Ruins_mine?oldid=37184319) |
| Hollow tree(4191,3472) inside 16694 is members-only. Search produces spirit moths/rare Tellervo equipment; stump search can yield diary. | **✓** — The local hollow tree is admitted with members search outputs. No F2P policy is being applied to these members results; random rewards are potential sources, not inventory. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077) |
| At local hollow tree, gold spirit moth capture starts 18 Hunter with butterfly/magic/Tellervo net. Barehanded requires 85 Hunter and 80 Agility; fresh tool belt does not assume butterfly net. | **✓** — Gold netting records Hunter 18 and the net requirement; barehanding records Hunter 85/Agility 80. All remain blocked by lack of a lower-level Hunter/Agility route. | [Hollow tree (Highweald Forest) rev. 37181077](https://runescape.wiki/w/Hollow_tree_(Highweald_Forest)?oldid=37181077); [Spirit moths rev. 37170278](https://runescape.wiki/w/Spirit_moths?oldid=37170278) |

<a id="members-16692"></a>
### 16692 — Central Wendlewick (members)

Surface bounds: x 4160–4223; y 3328–3391. Displayed available tasks: **4**.

Central town shops and facilities are admitted. The fishing shop is incorrectly duplicated into this square, importing equipment and bait from the beach shop west of the boundary. The bank’s completion-level Visions gate needs a separate during-quest service check.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Town requires partial Visions of Havenhythe; natural arrival differs from a start confirmed here. | **R** — Main-town placement is conditional on the region-entry policy and does not complete Visions. | [Wendlewick rev. 37194324](https://runescape.wiki/w/Wendlewick?oldid=37194324); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Banker Nathan 4177,3336 is inside 16692; full banking is distinct from the fishing deposit box in 16435. | **U** — Nathan and a full-bank candidate are present, but reviewed service metadata requires completed Visions. Wiki evidence here establishes the bank and partial region entry without proving exactly when banking first works during the quest. The potentially stricter service gate remains unverified. | [Banker Nathan rev. 37117341](https://runescape.wiki/w/Banker_Nathan?oldid=37117341) |
| Lev’s Baked Delights 4169,3355 stocks food for coins; locally attainable funding is still required. | **✓** — Lev’s shop is present and contributes its ordinary positive-stock food. This is a conditional purchase source, not free starting food. | [Lev's Baked Delights rev. 37108539](https://runescape.wiki/w/Lev's_Baked_Delights?oldid=37108539) |
| The Village Grocery 4196,3338 stocks produce and ingredients for coins; zero-stock products cannot seed Ironman supplies. | **✓** — The Village Grocery is present with local produce/ingredient sources; no positive raw-fish stock is invented. | [The Village Grocery rev. 37108537](https://runescape.wiki/w/The_Village_Grocery?oldid=37108537) |
| Mapped creeping ivy 4164,3327–3329 and 4175/4177,3328 lies inside 16692 and requires 35 Woodcutting. | **✓** — The local ivy method has Woodcutting 35 and no log output; ordinary tree training can supply progression. | [Creeping ivy rev. 37201008](https://runescape.wiki/w/Creeping_ivy?oldid=37201008) |
| Fishing Shop 4142,3314 is in 16435, outside 16692. A regional town label does not put its shop stock into this isolated chunk. | **L** — Fishing Shop is admitted at central town and supplies bait/feathers/equipment there. The Wiki locates that shop at 4142,3314 in 16435. Remove this duplicate location while preserving the correct beach-shop source. | [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Wendlewick lodestone 4164,3311 is in 16691, outside 16692, and is built during Visions. | **✓** — No lodestone from 16691 is granted as a local 16692 source or an activated teleport. | [Wendlewick lodestone rev. 37193342](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) |

<a id="members-11061"></a>
### 11061 — Western Catherby (members)

Surface bounds: x 2752–2815; y 3392–3455. Displayed available tasks: **8**.

The members bank, shops, tree/Thieving progression and candle stock are admitted. The Catherby black-candle gate correctly suppresses its product in this fresh scenario; its inappropriate global application is demonstrated separately at Wendle’s Wicks.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Full Catherby bank plus deposit box lies inside 11061. | **✓** — The full bank and distinct deposit box receive appropriate reviewed service kinds in the admitted area. No usable-route timing or interaction was measured. | [Catherby bank rev. 37133187](https://runescape.wiki/w/Catherby_bank?oldid=37133187) |
| Arhein’s Store is inside 11061 and stocks rope(18 gp), bucket(2 gp), knife(25 gp), seaweed and pineapple(2 gp, noted). | **✓** — Arhein’s positive stock includes the ordinary listed supplies. Local coins have monster provenance; no actual purchase balance is asserted. | [Arhein's Store rev. 37122529](https://runescape.wiki/w/Arhein's_Store?oldid=37122529) |
| Candle Shop is inside 11061. White candles cost 30 gp; free fork handle via Buy 4 White candle. | **R** — White-candle stock is represented. The free fork-handle achievement row is suppressed by Misc achievements=false, while the ordinary candle action remains a local capability. | [Candle Shop rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292) |
| Catherby black candles require the bucket-of-wax exchange during Merlin’s Crystal before ordinary purchases; price 3 gp alone does not remove this gate. | **✓** — Black candle is absent and the source diagnostic requires Merlin’s Crystal progress. This run correctly rejects a fresh Catherby purchase; the precise first wax exchange was not simulated. | [Candle Shop rev. 37177292](https://runescape.wiki/w/Candle_Shop?oldid=37177292) |
| Vanessa’s Farming Shop is inside 11061 and supplies rake/seed dibber, secateurs, spade, watering can and compost; crops listed with zero stock are not fresh Ironman supplies. | **✓** — Vanessa’s tools/compost are represented; zero-stock crop products do not seed a fresh supply. No Farming training is created solely from selling tools. | [Vanessa's Farming Shop rev. 37120770](https://runescape.wiki/w/Vanessa's_Farming_Shop?oldid=37120770) |
| Harry’s Fishing Shop and Hickton’s Archery Emporium are east of 11061, in 11317. | **✓** — Neither Harry’s nor Hickton’s shop is imported from 11317. | [Harry's Fishing Shop rev. 37123118](https://runescape.wiki/w/Harry's_Fishing_Shop?oldid=37123118); [Hickton's Archery Emporium rev. 37127557](https://runescape.wiki/w/Hickton's_Archery_Emporium?oldid=37127557) |
| Catherby small-net/bait and cage/harpoon fishing spot coordinates are in 11317, not 11061. | **✓** — No eastern sea-fishing spot or Fishing training signal is attributed to this western square. Cooking fish can have separate local shop/stall sources. | [Fishing spot (small fishing net, bait) rev. 37196217](https://runescape.wiki/w/Fishing_spot_(small_fishing_net%2C_bait)?oldid=37196217); [Fishing spot (cage, harpoon) rev. 37196214](https://runescape.wiki/w/Fishing_spot_(cage%2C_harpoon)?oldid=37196214) |

<a id="members-11062"></a>
### 11062 — Camelot Castle (members)

Surface bounds: x 2752–2815; y 3456–3519. Displayed available tasks: **3**.

Merlin’s Crystal can start but its partial step is hidden by whole-quest display. Holy Grail already uses the correct 30 Attack value. No fresh Knight Waves prayer unlock or neighbouring bank is granted.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Camelot at 2760,3500 lies inside 11062. Merlin’s Crystal starts at King Arthur; finishing requires travel outside this isolated chunk. | **R** — The Merlin’s Crystal first step is available but hidden by Show Quest Tasks Complete. Completion remains blocked by out-of-chunk stages. | [Camelot rev. 37122853](https://runescape.wiki/w/Camelot?oldid=37122853); [Merlin's Crystal rev. 37182716](https://runescape.wiki/w/Merlin's_Crystal?oldid=37182716) |
| Holy Grail also starts at King Arthur but requires 30 Attack and Excalibur; the Wiki records an increase from 20 to 30. Start location alone does not establish that skill or an imported quest-reward weapon. | **✓** — The evaluated Holy Grail start record already requires 30 Attack and is blocked by the predecessor quest. No outdated 20 Attack correction is needed. | [Holy Grail rev. 37182712](https://runescape.wiki/w/Holy_Grail?oldid=37182712) |
| Knight Waves training ground requires King’s Ransom completion. Fresh placement at Camelot must not grant its training or prayer unlocks. | **✓** — Knight Waves prayer unlocks remain blocked by King’s Ransom; they are not granted by owning Camelot. | [Knight Waves training ground rev. 37164602](https://runescape.wiki/w/Knight_Waves_training_ground?oldid=37164602); [Camelot rev. 37122853](https://runescape.wiki/w/Camelot?oldid=37122853) |
| Camelot Teleport requires 45 Magic, five air runes and a law rune. Fresh automatic transport must not assume these. | **✓** — No usable Camelot teleport or extra surface access appears. Fresh Magic/rune/spellbook prerequisites are not replaced by owning the castle. | [Camelot rev. 37122853](https://runescape.wiki/w/Camelot?oldid=37122853) |
| Seers’ Village bank 2725,3492 is in 10806 outside 11062. | **✓** — No Seers’ bank is attributed to the Camelot square. | [Seers' Village bank rev. 37122744](https://runescape.wiki/w/Seers'_Village_bank?oldid=37122744) |

<a id="members-10547"></a>
### 10547 — East Ardougne market and south bank (members)

Surface bounds: x 2624–2687; y 3264–3327. Displayed available tasks: **15**.

The ordinary bank and marketplace sources are admitted. Theft methods are not a level-1 Thieving bootstrap. Silk is a latent requirement mismatch: the record says 15 although both the specific stall page and area page say 20.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Ardougne south bank 2653,3284 lies inside 10547 and is a full bank. Upper floor has no special facilities; no quest gate is stated. | **✓** — Three booth candidates and a distinct deposit candidate receive correct ordinary service recognition in the admitted market area. | [Ardougne south bank rev. 37145941](https://runescape.wiki/w/Ardougne_south_bank?oldid=37145941) |
| Market bakery stalls require 5 Thieving to steal cakes/bread/slices; supplies are distinct from coin-funded shop purchases. | **✓** — Bakery theft records 5 Thieving and is blocked at reachable Thieving 1. Positive shop stock is a separate purchase source. | [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742); [Bakery Stall rev. 37209282](https://runescape.wiki/w/Bakery_Stall?oldid=37209282) |
| Silk stalls require 20 Thieving. Selling stolen silk back is time-gated; fresh starting cash is not automatic. | **Q** — The theft method records 15 Thieving, while the specific Silk stall and market pages specify 20. It is blocked at Thieving 1 in this run, so this is a wrong latent requirement rather than an immediate available 15-level offer. | [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742); [Silk stall rev. 37209241](https://runescape.wiki/w/Silk_stall?oldid=37209241) |
| Silver stall theft requires 50 Thieving; the shop has stock of unstrung symbols but no base stock of silver ore/bars. | **✓** — Theft requires 50 Thieving and is blocked. Silver ore/bars do not appear through the zero-stock shop channel. | [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742) |
| Gem stall theft requires 75 Thieving; the shop’s four cut gems have zero base stock, so cannot supply a fresh Ironman. | **✓** — Theft requires 75 Thieving and is blocked; zero-stock cut gems do not become shop supplies. | [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742) |
| Fur stall theft requires 35 Thieving; many shop fur types have zero stock and are not fresh Ironman purchases. | **✓** — Fur theft requires 35 Thieving and is blocked. Ordinary stock and zero-stock exotic furs remain distinct. | [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742) |
| Captain Barnaby at the Ardougne docks offers paid boat travel to other ports; enabled transport does not grant locked destinations or a prepaid fare. | **R** — Transport rules are on, but no outgoing usable journey or additional owned surface is admitted. Fare preparation, endpoint evidence and permission to enter locked destinations remain separate from local source ownership. | [Captain Barnaby rev. 37122763](https://runescape.wiki/w/Captain_Barnaby?oldid=37122763) |
| Ardougne Teleport requires 51 Magic and Plague City. Automatic travel must not infer personal completion from the city being owned. | **✓** — Ardougne Teleport is not usable for the fresh player; personal quest, Magic and rune requirements are not inferred from market ownership. | [Ourania Runecrafting Altar rev. 37207369](https://runescape.wiki/w/Ourania_Runecrafting_Altar?oldid=37207369); [Ardougne market rev. 37131742](https://runescape.wiki/w/Ardougne_market?oldid=37131742) |

<a id="members-10806"></a>
### 10806 — Seers' Village (members)

Surface bounds: x 2688–2751; y 3456–3519. Displayed available tasks: **7**.

The compatibility start admits town sources while providing no fully mapped walking area. Quest skill gates and the battered-key chain hold. Bank routing and exact lodestone activation remain unverified.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Full Seers’ Village bank is in this coordinate chunk. | **U** — Bankers and reviewed bank/deposit identities are present, but physical service witnesses are not reached by a mapped walking area in this compatibility start. A usable route was not established; this is not a missing-bank claim. | [Seers' Village bank rev. 37122744](https://runescape.wiki/w/Seers'_Village_bank?oldid=37122744) |
| Elemental Workshop I starts at the bookcase inside this chunk; requires 20 Crafting, Mining, Smithing, thread and 4 coal. Level 44 earth elemental combat required. | **✓** — Elemental Workshop I records Crafting/Mining/Smithing 20 and its first step is blocked. It does not grant a completed quest. | [Elemental Workshop I rev. 37182660](https://runescape.wiki/w/Elemental_Workshop_I?oldid=37182660) |
| Workshop entry needs the battered key cut from the book after starting Elemental Workshop I. A nearby entrance is not unconditional dungeon access. | **✓** — No workshop interior or battered key is admitted while the start step is blocked; the key/progress chain is retained. | [Elemental Workshop I rev. 37182660](https://runescape.wiki/w/Elemental_Workshop_I?oldid=37182660) |
| Wiki bank page supports willow/maple trees outside bank; area-wide totals (11 yews/7 magic etc.) must not be copied into a single coordinate chunk. | **U** — Willow/maple selectors and town Woodcutting progression are present, but the broad Wiki tree description is not an exact within-square census or route proof. | [Seers' Village bank rev. 37122744](https://runescape.wiki/w/Seers'_Village_bank?oldid=37122744); [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |
| Wiki update identifies an oak north of bank at (2729,3504), inside 10806. | **✓** — A local oak selector and normal-tree progression are represented, consistent with the pinned in-square oak coordinate. No exact tree count is inferred. | [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |
| Seers’ Village lodestone must be activated before teleport use. Initial remote travel is not available merely because town has a lodestone. | **U** — The local lodestone metadata is present, but the start has no mapped walking area and no activation observation. Its exact usable activation/landing route was not established. | [Seers' Village rev. 37175737](https://runescape.wiki/w/Seers'_Village?oldid=37175737) |

<a id="members-13878"></a>
### 13878 — Canifis (members)

Surface bounds: x 3456–3519; y 3456–3519. Displayed available tasks: **0**.

Shops and the conditional bank are recognised, but every attackable citizen is suppressed by a mandatory Priest in Peril source gate. The Wiki allows the ghoul/barrier entry alternative, which the bank review already acknowledges. This can erase all combat/Prayer progression from the fresh placed-in-town scenario.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Priest in Peril completion is not the sole entrance route: defeating Paterdomus ghoul and passing holy barrier also works. Both involve another coordinate chunk. | **R** — Placement inside the town does not prove natural arrival. The normal ghoul/barrier or quest journey crosses another square; this is an explicit starting-position sensitivity. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299) |
| Canifis full bank and deposit box lie inside 13878. | **R** — Bank NPC/booth sources are present, while the separate reviewed start-bank record correctly accepts ghoul/barrier entry as an alternative to Priest in Peril. Conditional entry is not an unconditional usable-bank route. | [Canifis bank rev. 37133011](https://runescape.wiki/w/Canifis_bank?oldid=37133011) |
| Rufus inside 13878 sells raw beef, chicken, rat meat, bear meat; all listed raw fish have stock 0 and cannot supply fresh Ironman fish purchases. | **✓** — Rufus supplies the listed raw meats; none of the zero-stock raw fish becomes a shop supply. Payment and cooking facilities are separate. | [Rufus's Meat Emporium rev. 37120795](https://runescape.wiki/w/Rufus's_Meat_Emporium?oldid=37120795) |
| Barker inside 13878 sells coloured gloves 650 gp and capes 20 gp; F2P tradeability of these items does not grant F2P land access. | **✓** — Barker’s positive-stock gloves and capes are represented under members settings. No F2P land claim is made. | [Barker's Haberdashery rev. 37120720](https://runescape.wiki/w/Barker's_Haberdashery?oldid=37120720); [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299) |
| Hair of the Dog inside 13878 sells moonlight mead 5 gp; pickled brain 50 gp is quest-related and cannot be treated as arbitrary food. | **U** — Moonlight mead is represented. Pickled brain also appears as a spawn, but its paid/Telegrab and quest-state acquisition conditions were not independently exercised, and it is not established as ordinary food. | [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179); [Pickled brain rev. 37134211](https://runescape.wiki/w/Pickled_brain?oldid=37134211) |
| Attacked inhabitants transform from level 28 to 63 werewolves unless using wolfbane or Sunspear; fresh account has neither quest reward by default. | **Q** — All attackable citizens are blocked by mandatory completed Priest in Peril; Boris is explicitly gated that way at an in-square location. Canifis admits the ghoul/barrier alternative, and Boris’s page describes ordinary attack/transformation without this extra completed-quest requirement. This is a Wiki-based requirement inference, not an in-game no-quest attack observation. Review the inherited region gate; combat survival and every wandering tile remain unverified. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299); [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179); [Boris rev. 37139399](https://runescape.wiki/w/Boris?oldid=37139399) |
| Mort’ton trapdoor shortcut requires quest/minigame unlocks; reaching level 99 Zachory Bragg is not a fresh-account travel option. | **✓** — No Mort’ton shortcut or deeper-area journey becomes available from the fresh town save. | [Canifis rev. 37124299](https://runescape.wiki/w/Canifis?oldid=37124299); [Hair of the Dog rev. 37121179](https://runescape.wiki/w/Hair_of_the_Dog?oldid=37121179) |

<a id="members-16436"></a>
### 16436 — West Wendlewick: Wendle's Wicks (members)

Surface bounds: x 4096–4159; y 3328–3391. Displayed available tasks: **4**.

This is a targeted control outside the seeded 15. White candles and local coins are available, but black candles are incorrectly removed by the Catherby quest gate despite the Wiki’s explicit exception for Wendle’s Wicks.

| Wiki check and fresh-player limit | Picker comparison | Revision-pinned evidence |
|---|---|---|
| Access to Wendlewick requires partial Visions; the quest start is in Port Sarim outside 16436. | **R** — Main-section placement does not complete the region-entry quest or grant the Port Sarim journey. | [Wendlewick rev. 37194324](https://runescape.wiki/w/Wendlewick?oldid=37194324); [Visions of Havenhythe rev. 37193723](https://runescape.wiki/w/Visions_of_Havenhythe?oldid=37193723) |
| Wendle’s Wicks(4138,3334) inside 16436 is F2P and stocks 500 white candles at 30 gp. | **✓** — White candle has positive-stock Wendle’s Wicks provenance. Local coins have crab-drop provenance; no actual wallet balance is asserted. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Buy 4 White candle yields free untradeable fork handle and deducts no coins; supports Handles for Forks action without imported funds once shop accessible. | **R** — Handles for Forks is hidden because Misc achievements=false. Its free local action remains a rule-dependent display case, not a missing seller. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Black candles cost 3 gp here without Merlin’s Crystal completion, but stock row is members-only; distinguish item membership from shop membership. | **Q** — Black candle is removed from Wendle’s Wicks by a global Merlin’s Crystal prerequisite. The Wiki explicitly says this shop does not require that quest. Keep Catherby’s gate source-specific and preserve the members-only item condition. | [Wendle's Wicks rev. 37108529](https://runescape.wiki/w/Wendle's_Wicks?oldid=37108529) |
| Full Wendlewick bank/Nathan(4177,3336) is in 16692, outside 16436; Fishing Shop deposit(4142,3314) is south in 16435. | **✓** — The neighbouring banks/deposit, eastern ivy and other town shops are not imported across the square boundary. | [Banker Nathan rev. 37117341](https://runescape.wiki/w/Banker_Nathan?oldid=37117341); [Fishing Shop (Wendlewick) rev. 37108534](https://runescape.wiki/w/Fishing_Shop_(Wendlewick)?oldid=37108534) |
| Creeping ivy by pottery house(4164,3327–3329) and south of bank(4175/4177,3328) is east of 16436. Ivy is also members-only at 35 Woodcutting. | **✓** — The neighbouring banks/deposit, eastern ivy and other town shops are not imported across the square boundary. | [Creeping ivy rev. 37201008](https://runescape.wiki/w/Creeping_ivy?oldid=37201008) |
| Lev’s Baked Delights(4169,3355) and Village Grocery(4196,3338) are in 16692; Tom’s Trove(4197,3323) in 16691, outside 16436. | **✓** — The neighbouring banks/deposit, eastern ivy and other town shops are not imported across the square boundary. | [Lev's Baked Delights rev. 37108539](https://runescape.wiki/w/Lev's_Baked_Delights?oldid=37108539); [The Village Grocery rev. 37108537](https://runescape.wiki/w/The_Village_Grocery?oldid=37108537); [Tom's Trove rev. 37175714](https://runescape.wiki/w/Tom's_Trove?oldid=37175714) |

## Combined verification and remaining limits

All 16 members captures completed under the shared heavy-work lock with a 1536 MiB V 8 heap ceiling. Fresh-state checks confirm one player, one unlocked base, exact copied shared/task rules and no copied gameplay progress. Together with the first pass, this gives 66 captures and 330 classified checks. The seed, pool ordering, preflight rejection and pinned Wiki citations are reproducible. Full save copies have been deleted; only anonymous rules and private audit evidence remain.

The 41 scenario totals combine 330 per-pass checks, including repeated observations. They are not a precision/recall estimate or a list of 330 independent activities. First-pass classifications are retained as historical observations; for example, the members pass corroborates anchovies 15 and resolves that earlier uncertainty. No additional surface base was admitted in any members capture. Some Lumbridge Home Teleport planning candidates are roll-only; they do not create a usable route or source access to locked land.

The largest unresolved areas are Highweald mine-side traversal, exact Seers’ surface/bank/lodestone routes, sustainable desert combat and water use, the timing of Nathan’s bank during Visions, and the acquisition conditions of Canifis’s pickled brain. Low displayed task counts are not a resource census: Nardah has 36 item appearances despite two displayed goals, and Canifis has 74 despite zero displayed goals. The Canifis citizen quest gate is a separately evidenced requirement defect, not a conclusion drawn from its zero display count. Combat signals and item closure remain potential progression rather than observed levels, inventory or affordability. Exact unlit-cave warning/darkness behaviour also remains unverified; the scored cave requirement error is the obsolete rope field.

Publication check: the report was moved from the blocked research directory to this neutral audit directory. The unchanged leak scanner passes on a full snapshot of the public working tree, including this report. The scanner and its exception list were not changed. This is documentation only; no application tests or UI screenshots apply.
