# RS3 duo switchover repairs — 2026-10-08

This is the repair snapshot at `bcfd9a3`, before the [processing follow-up](switchover-processing-parity-2026-10-08.md). Its tables retain the then-open diamond string/enchant bug and scoring/heading decisions. Player 1 has since confirmed coupled loadout BiS scoring and canonical skill headings as deliberate differences; the follow-up records the processing repair and current counts. The five progress questions and separate real-device operational acceptance remain open. The [audit baseline](switchover-parity-2026-10-08.md) retains the exhaustive pre-repair catalogue register.

## Verification scope and counts

Fresh final original captures: **2026-10-09T01:32:12.330Z** (October 8 local time), original v6.9.68. Copied authored state revision **33**, SHA-256 `e4b739b847c73743390a471693f5830563b11009ba13fe8e7ac481c2c4d256ad`, unchanged from the baseline. The original chunks, active/possible lists, saved checks, rules, boosts and BiS were compared again after repairs and remained stable. Original source hashes still match the retained audited source. No credentials, controls or saves were used; each map had 38 read subscriptions and 37 unlistens, one blocked statistics socket frame, no HTTP mutations and no worker errors. Original Firebase long-poll and non-GET requests remained blocked.

Only this worktree was written. The main save was copied to worktree `.local/duo`, with `store.lock` and `invites.json` removed; the copy was deleted after final checks. Main `.local/game-data` and `.local/map-assets` were read-only. The normal scheduler evaluated the hydrated copy with real geometry; map assets do not affect eligibility. Migration was detached, not persisted to the live picker. Raw captures and test logs remain ignored in `.local/research`. Tests redirected TEMP/TMP into the worktree; test servers used localhost ephemeral ports. No main tracked files, original picker saves, live picker or Tailscale were changed. No push, rebase or merge was performed.

**A** is original-only identity; **B** is app-only; **C** is an exact task with different availability or base/effective level. C overlaps A/B. Full model/eligible compares catalogues, not required active grinds. Aliases can coalesce two original records into one canonical identity, so original row count minus common need not equal A.

| Map / set | Original | App | Exact common | A | B | C | Unresolved original |
|---|---:|---:|---:|---:|---:|---:|---:|
| QXA before active | 18 | 24 | 1 | 17 | 23 | — | 1 |
| QXA before full model / eligible | 1536 | 1540 | 1299 | 237 | 241 | 211 | 25 |
| QXA after active | 18 | 22 | 1 | 17 | 21 | — | 0 |
| QXA after full model / eligible | 1536 | 1545 | 1306 | 229 | 239 | 205 | 24 |
| QXB before active | 8 | 52 | 3 | 5 | 49 | — | 2 |
| QXB before full model / eligible | 1519 | 1584 | 1284 | 235 | 300 | 182 | 51 |
| QXB after active | 8 | 22 | 3 | 5 | 19 | — | 2 |
| QXB after full model / eligible | 1519 | 1585 | 1291 | 227 | 294 | 176 | 50 |

Chunk ownership and selected order still match: QXA **151 unlocked / 4 selected**, QXB **113 / 20**. The seven source-eligibility C bugs per map are gone. C decreases by six, rather than seven, because the newly resolved Constitution portent exposes the existing canonical Divination 2 versus original Constitution 10 level comparison. That is the unchanged skill-heading decision, not a new level edit.

## What changed

| Repair | Maps | Named effect and preserved boundary |
|---|---|---|
| Prerequisite source versus output channel | QXA, QXB | **Slay a gelatinous abomination** becomes available using shop Spiked gauntlets. Output-bearing `Source=drop` remains output provenance; explicit `AllowedSources`, `NonShop` and Source-only input selectors retain their restrictions. |
| Crafted Prayer consumables | QXA, QXB | **Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks; Craft accursed maple incense sticks; Complete an impious urn; Complete an accursed urn** become available with own obligations. Crafted equipment and starred primary-training restrictions remain enforced; no active Prayer duty was added because the current checks/goal selector already satisfy or suppress these levels. |
| Same-BaseQuest diary pruning | QXB | **27 children** leave the active list, including **Belter of a Smelter**, **And It Was THIS Big!**, **Blast and Hellfire**, **Not Waving But Drowning**, and **Are Yew As Fired Up As I Am?**. Active Diary rows fall **31 → 4**. QXA stays **6 → 6**. Blocked/backlogged/outside-obligation parents do not hide children; tier markers stay visible. |
| Positive Prayer equipment | QXB | **Blue dragonhide shield, Mystic shield, Rune kiteshield, Rune square shield** no longer create Prayer obtain goals; the Blue dragonhide shield leaves the active list. Legitimate Ranged and tank goals still work. QXA has no corresponding current goal change. |
| POH hard gate | QXA, QXB | **Construct a clay fireplace** and **Construct a shabby blue rug** become blocked under `InsidePOH=false`; clay fireplace leaves both active lists. Level-one starter recipes remain available, and InsidePOH Primary separately controls training contribution. |
| Reviewed progress aliases | QXB; QXA imports/sync | Six lodestone checks and **Fletch a runite crossbow (u)** reproject from retained evidence. QXA's fresh **Create a portent of restoration I** resolves to its canonical task for import/sync, without inventing an absent saved check. Only quarantined reviewed aliases retry once; explicit false/cleared checks, conflicting decoders and the five decisions stay intact. |
| Summoning frontier | QXA, QXB | **Create a dreadfowl pouch** stays available but leaves the active list when secondary supplies provide no primary training route; **Obtain a bulldog** is also suppressed as a fallback. Explicit manual primary, sufficient declared passive or observed levels preserve goals. This is a category evidence gate, not a task-name ban or membership exclusion. |
| Docs and badges | Both / catalogue | Diary, Boosting and BIS Skilling are described as partial; Achievement, historical lowercase Cleaning herbs and Show Diary Tasks Any retain their actual limitations. Enabled-rule review is **12 implemented-scope / 15 category-gate / 5 partial / 3 retained-only**. The full 156-entry metadata catalogue is **47 / 76 / 10 / 23**. Weight coverage **3,019/3,550**, RuneMetrics, Training plan UI, Pick for me, unpick and invitation revocation are described accurately. |

Available hidden QXB diary rows retain Magic **59**, Runecrafting **57** and Firemaking **60** requirements. Entire training objects remain equal to the baseline on both maps. The skill mirrors and coupled ranged scoring were deliberately not changed.

Active rows removed, exhaustively:

- QXA: Construct a clay fireplace; Create a dreadfowl pouch.
- QXB: Construct a clay fireplace; Create a dreadfowl pouch; Lumbridge Achievements And It Was THIS Big!; Lumbridge Achievements Draaaaaiiiiins...; Lumbridge Achievements Belter of a Smelter; Lumbridge Achievements Come In Here and Say That; Lumbridge Achievements Slippery When Wet; Lumbridge Achievements Klept-Old-Man-ia; Lumbridge Achievements Eye on the Prize; Lumbridge Achievements I Can't Hear Dead People; Lumbridge Achievements Nowt Tool Look At; Lumbridge Achievements You Doity Rat; Lumbridge Achievements It Was Dead Already!; Lumbridge Achievements Camping Trip; Lumbridge Achievements Ratatouille; Lumbridge Achievements What Is This Place?; Lumbridge Achievements Money Down the Drayn; Lumbridge Achievements Artisan Crafting; Lumbridge Achievements Bless Is More; Lumbridge Achievements Morgan the Merrier; Lumbridge Achievements Iron On; Lumbridge Achievements Always Be Prepared; Lumbridge Achievements A Body in the Sewers; Lumbridge Achievements Building Up Strength; Lumbridge Achievements Have Your Cake and Eat It; Lumbridge Achievements Blast and Hellfire; Lumbridge Achievements Gods, Give Me Strength; Lumbridge Achievements Not Waving But Drowning; Lumbridge Achievements Are Yew As Fired Up As I Am?; Obtain a Blue dragonhide shield.

## Explained processing differences and F2P Summoning

Both maps still have **String a diamond amulet** (`rs3:task:0009a4`) and **Cast Lvl-4 Enchant on a diamond amulet** (`rs3:task:0015ae`) active. Fresh original diagnostics reject `Diamond amulet (unstrung)*` and `Diamond amulet*`, respectively. The original silently omits the level-70 unstrung producer. It retains lower diamond ring/necklace recipes.

The app's exact declared chain is **Craft a diamond amulet (unstrung)**, Crafting 70 (`0009a3`), using Diamond*/Gold bar*/CraftingFurnace[+]; then stringing at Crafting 70 using that unstrung amulet and Ball of wool*; then enchantment at Magic 57, effective 52, using Cosmic rune*/Earth rune[+]*/Diamond amulet*. Each amulet has exactly one own primary task source. Both maps have own Diamond and Gold bar processing sources; this is not a partner-only supply or membership error.

Original `reference/original-picker/worker.js:1238–1242` removes producers above the current processing frontier with Multi Step Processing OFF. Its Highest Level OFF selector (`:4968–4974,5030–5037,5063–5065`) retains the lowest usable recipe per input before source propagation. App fixed-point eligibility propagates a broader production graph; presentation pruning cannot undo those sources. The exact original intermediate candidate set was not captured, so which original stage first removed the unstrung producer remains unproven. These four map occurrences are classified **bugs / known systematic processing-source eligibility drift**. A safe general repair needs frontier, alternate-supply, cross-skill and ON/OFF evidence; no isolated name suppression or blanket deletion was introduced.

Dreadfowl itself is free trial content: pinned item **12043** is non-members, and the [RuneScape Wiki Summoning guide](https://runescape.wiki/w/Summ_guide) explicitly allows training to F2P level 5 with this pouch. The original admits it to the possible model but has no active Summoning goal. Original `reference/original-picker/index.js:7385` gates the entire skill-goal scan by primary-method evidence; `reference/original-picker/worker.js:5528` rejects Secondary starter methods. The repaired presentation uses the same evidence distinction while retaining explicit personal declarations and observed progress. The regression also blocks trial tasks above level 5.

## Every remaining active difference

QXA: **16 shared-satisfaction suppressions**, **17 F2P/data corrections**, **1 optional reviewed Skill Guide milestone**, **1 equivalent equipment tie**, **1 pending skill-heading decision**, **2 processing bugs**. QXB: **3 shared-satisfaction suppressions**, **14 F2P/data corrections**, **1 optional milestone**, **2 equivalent equipment ties**, **2 pending skill-heading decisions**, **2 processing bugs**. There are no unexplained active rows. No active difference is attributed solely to backlog or partner-only supply; those distinctions still affect the full catalogue. Equivalent tie choices are documented existing scoring behavior, not a resolution of the separate coupled ranged decision.

### QXA remaining active differences

| Side | Named task / heading | Classification | Explanation |
|---|---|---|---|
| Original only | Constitution: Create a portent of restoration I | Pending Player 1 decision: skill heading | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | Divination: Create a attuned portent of restoration I | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Herblore: Clean a grimy tarromin | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Slayer: Slay a crawling hand in Burthorpe | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | BiS: Obtain an amulet of accuracy | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Beneath Cursed Tides Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Duck Quest Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Goblin Diplomacy Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Imp Catcher Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Myths of the White Lands Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Rune Mysteries Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Stolen Hearts Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Swept Away Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Desert Achievements Kookookachat | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements The Rules of Engagement | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Tower Power | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Beware of Pigzilla | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| App only | Archaeology: Use a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Combat: Get access to War's retreat | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Cooking: Unlock no-burn lobster cooking (standard fire/range) | Deliberate optional goal catalogue | Enabled Skill Guide tasks add the reviewed no-burn Cooking milestone. This does not create a new mandatory house rule. |
| App only | Crafting: String a diamond amulet | Bug: processing-source closure | The original rejects the starred amulet input; the app propagates the complete declared crafting chain. See the processing explanation below. |
| App only | Magic: Cast Lvl-4 Enchant on a diamond amulet | Bug: processing-source closure | The original rejects the starred amulet input; the app propagates the complete declared crafting chain. See the processing explanation below. |
| App only | Necromancy: Unlock and cast the Command Skeleton Warrior ability | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Gertrude's Cat Complete the quest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Purple Cat (miniquest) Complete the miniquest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Breaking the Seal Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Prison Break Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements eLeMeNtAl kIlL cHaOs III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Layering Up | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Mole Removal III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Naturist | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Three Heads Are Deader Than One II | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Broken Bones III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Extra: Obtain a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain a Team-1 cape | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain Deathwarden boots (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden gloves (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain a Skull lantern (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |

### QXB remaining active differences

| Side | Named task / heading | Classification | Explanation |
|---|---|---|---|
| Original only | Magic: Lumbridge Achievements Blast and Hellfire | Pending Player 1 decision: skill heading | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | Runecrafting: Lumbridge Achievements Not Waving But Drowning | Pending Player 1 decision: skill heading | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | BiS: Obtain a monk's robe (bottom) | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | BiS: Obtain a monk's robe (top) | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Complete the Medium Achievements | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| App only | Archaeology: Use a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Combat: Get access to War's retreat | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Cooking: Unlock no-burn lobster cooking (standard fire/range) | Deliberate optional goal catalogue | Enabled Skill Guide tasks add the reviewed no-burn Cooking milestone. This does not create a new mandatory house rule. |
| App only | Crafting: String a diamond amulet | Bug: processing-source closure | The original rejects the starred amulet input; the app propagates the complete declared crafting chain. See the processing explanation below. |
| App only | Magic: Cast Lvl-4 Enchant on a diamond amulet | Bug: processing-source closure | The original rejects the starred amulet input; the app propagates the complete declared crafting chain. See the processing explanation below. |
| App only | Necromancy: Unlock and cast the Command Skeleton Warrior ability | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Gertrude's Cat Complete the quest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Purple Cat (miniquest) Complete the miniquest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Breaking the Seal Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Prison Break Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Mole Removal III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Three Heads Are Deader Than One II | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Broken Bones III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Extra: Obtain a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden boots (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden gloves (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain an Explorer's ring 1 | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain a Rune battleaxe | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain a Skull lantern (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |


The two original decision rows remain unchanged: **coupled ranged loadouts versus greedy slots, including independent Rune arrow obligation**, and **canonical skill ownership versus the original Constitution/other skill mirrors**. QXB's collapsed Hard-tier children retain their skills even though canonical Diary goals replace duplicated skill headings. The app's remaining active mirrors comparison is not solved merely by hiding the diary children.

## Progress repairs and five questions for Player 1

| Original record | Canonical challenge |
|---|---|
| Extra Lumbridge, t_12129 | Diary `rs3:task:003532` |
| Extra Varrock, t_12133 | Diary `rs3:task:003536` |
| Extra Falador, t_12135 | Diary `rs3:task:003538` |
| Extra Port Sarim, t_12136 | Diary `rs3:task:003539` |
| Extra Draynor Village, t_12137 | Diary `rs3:task:00353a` |
| Extra City of Um, t_12140 | Diary `rs3:task:00353d` |
| Fletching runite crossbow (u) | Fletching rune crossbow (unstrung), `rs3:task:001093` |
| Constitution portent of restoration I | Divination `rs3:task:000bfc` |

| Map | Completed matched/original before → after | Current checked before → after | Full-list checked after | Backlog after |
|---|---:|---:|---:|---:|
| QXA | 222/222 → 222/222 | 3/4 → 3/4 | 58/58 | 46/46 |
| QXB | 273/286 → 280/286 | 3/3 → 3/3 | 0/0 | 13/14 |

All seven retained fixes projected without losing raw records. QXA's new Constitution check appears in the fresh original capture, but not in revision 33's retained save; its alias now resolves correctly, and the copied save remains honest at **3/4 checked**. Applying original sync was not part of this task. QXB's six remaining exact completed mismatches are four undecided quest clones plus two category mirrors whose canonical challenges are already satisfied. Its unmatched backlog is the Construction question below.

These five records remain preserved and unresolved. None establishes personal quest completion:

1. **Player 2 — Farming, Perils of Ice Mountain step 1:** did the check mean he met the Farming requirement, or finished the whole step's chunk challenge?
2. **Player 2 — Hunter, Perils of Ice Mountain step 1:** did this separate check mean he met the Hunter requirement, or finished the whole step?
3. **Player 2 — Construction, Perils of Ice Mountain step 1:** is Construction still waiting, or is the empty-reason backlog obsolete? Farming and Hunter are checked, so automatically choosing completed/backlogged would discard conflicting evidence.
4. **Player 2 — Smithing, Beneath Cursed Tides step 1:** did the check mean he met 30 Smithing, or finished the canonical chunk task?
5. **Player 2 — Strength, Beneath Cursed Tides step 1:** did this check mean he met 30 Strength, or finished the canonical chunk task?

Possible targets are Quest `rs3:task:00275c` (Perils) and `rs3:task:001f4d` (Beneath). The original skill clones strip quest metadata, so their checks cannot decide the meaning by themselves.

## Files and tests

Changed executable seams: `app/tasks/engine.mjs`, `presentation.mjs`, `equipment.mjs`, `identity.mjs`, `migration.mjs`; startup readiness in `app/server.mjs`; detached parity readiness in `scripts/research/local-parity-model.mjs`. Rule metadata only in `app/data/settings.mjs`; the parallel Chunk Rules web page was not edited.

Named regressions: `tests/parity-source-regressions.test.mjs`, `tests/parity-diary-equipment.test.mjs`, `tests/parity-progress-aliases.test.mjs`; metadata expectations in `tests/settings.test.mjs`. Cases cover shop gauntlets, all six Prayer recipes, NonShop/AllowedSources/source selectors, crafted equipment/training, clay fireplace/rug, diary parents/tiers/skill evidence, all four zero-Prayer shields with Ranged/tank comparisons, Dreadfowl/bulldog and explicit overrides, legitimate diamond closure, eight aliases, five quarantined clones, conflicting decoders, portable restore, startup upgrade, reopening and cleared checks.

Documentation: `README.md`, `docs/parity.md`, `docs/settings-audit.md`, `docs/task-engine-coverage.md`, docs/migration.md, the baseline report and this repair report.

**Final full `npm test`: 1799 tests, 1798 passed, 1 skipped, 0 failed.** Prediction goldens are unchanged. The optional generated-PNG asset test skipped without its default local asset directory; all six skill-icon tests passed separately with the authorized main map assets read-only (including the skipped byte/hash/dimension/alpha check). The read-only harness guard suite also passed 26 tests. An independent review caught and verified the alias-ambiguity repair; no further actionable source, diary or equipment regression was found. Automated tests and copied-save comparisons do not certify Player 2's live device/link or operational switch acceptance.
