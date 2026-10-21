# Area check task targets — 13 October 2026

Rechecked the unchanged copied personal save at revision 110, F2P, for Player 1. Her saved **Non-permanent BiS** rule is false. Alone keeps personal progress and rules; with current retains normal connected-partner access and supplies. The original save and live port 8788 were untouched.

Area check now gets targets from `selectPresentedTasks`, the ordinary active task list selector, once for each hypothetical scope. This applies the same equipment permanence, membership, category switches, engine visibility, availability, processing, goal ranking, saved alternatives, backlog and completion handling. Location anchoring and skill requirement extraction remain Area check's separate responsibilities. Primary method entry levels alone are not targets. Search, Show blocked and Show all are inspection views and do not create grind duties.

Completed and shared-satisfied tasks **do not set targets**. A requirement already satisfied by the duo needs no further challenge grind. The selector also suppresses lower skill goals covered by a completed goal. Personal completion rules still keep a task active for the other player. Recorded levels remain capability evidence; these lists describe method coverage to unfinished duties, not a personal XP deficit.

The lists include every training stretch of at least 15 levels, not only the largest one printed below each bar. Methods at the same entry level share a row. No personal level or chunk ownership was changed.

| Selected area | Scope | Original cap fallback | Before rule filtering | Corrected |
| --- | --- | ---: | ---: | ---: |
| Al Kharid 13105 | Alone | 1 | 0 | 0 |
| Al Kharid 13105 | With current | 21 | 12 | 5 |
| Lumbridge 12850 | Alone | 6 | 4 | 0 |
| Lumbridge 12850 | With current | 16 | 12 | 5 |

## Equipment and target evidence

**Wield a corrupt dragon weapon** and **Wear a piece of corrupt dragon armour** are available engine rows, but the active list hides them because every qualifying sourced item is non-permanent. The reviewed permanence data classifies these corrupt dragon items as degrading to dust. They cannot supply Attack 60 or Defence 60 while the rule is disabled. Focused tests verify that both become targets when the rule is enabled.

Gravite is repairable and remains permanent under this rule. **Wield a gravite melee weapon** supplies the corrected combined Attack 55 target. Its retained record has `Items: ["GraviteMeleeWeapon[+]"]`, `Level: 55`, `Skills: { Dungeoneering: 35 }` and `Primary: false`; Attack comes from category and Level. Ranged and Magic keep their active gravite goals at 55. The separate Dungeoneering variant of the ranged wield task is suppressed by a higher skill goal, so the old duplicate label is gone.

**Wear a piece of rune armour** is the only selected local target in either alone scope, at Defence 50. Neither alone scope has a usable Defence method, so this is unknown training coverage and produces no gap. No completed rune wield goal becomes a target.

| Scope | Skill | Corrected target | Active task |
| --- | --- | ---: | --- |
| Both areas, alone | Defence | 50 | Wear a piece of rune armour |
| Both areas, with current | Attack | 55 | Wield a gravite melee weapon |
| Both areas, with current | Ranged | 55 | Wield a gravite ranged weapon |
| Both areas, with current | Magic | 55 | Wield a gravite magic weapon |
| Both areas, with current | Dungeoneering | 75 | Enter the Al Kharid resource dungeon |

Magic's usable level-55 method already covers its target, so it has no long gap. Dungeoneering now stops at 75 for **Enter the Al Kharid resource dungeon**, rather than the blocked level-90 diary task.

There are no **Can't start** warnings in either corrected area or scope. Lumbridge alone's former Magic 55 → 59 warning came from an unavailable achievement and is removed. More generally, training-blocked, quest-blocked and point-blocked duties do not create targets while absent from the active list. Conditional methods remain visible with their blockers but cannot close a training gap. The former Havenhythe reference warnings likewise no longer come from blocked duties; the separate members-start research remains a research comparison.

## Full gap lists

### Al Kharid 13105

**Alone, before rule filtering**

No gaps.

**Alone, corrected**

No gaps.

**With current, before rule filtering**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 60 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Wield a corrupt dragon weapon |
| Strength | 1 → 80 | Fight cow (Strength); Fight hill giant (Strength); Fight troll brute (Strength) | Open the door to the Het tomb |
| Defence | 1 → 60 | Fight cow (Defence); Fight hill giant (Defence); Fight troll brute (Defence) | Wear a piece of corrupt dragon armour |
| Ranged | 1 → 55 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Wield a gravite ranged weapon; Wield a gravite ranged weapon |
| Prayer | 1 → 50 | Add accursed ashes to maple incense sticks; Add impious ashes to wooden incense sticks; Bury big bones; Bury bones; Craft accursed maple incense sticks; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Talk to Azacorax; Talk to Azacorax |
| Runecrafting | 27 → 78 | Siphon air and fire runes from fire storms | Varrock Achievements A Ton of Earth |
| Smithing | 50 → 70 | Forge a rune ore box; Forge rune; Forge rune platebodies; Smelt a rune bar; Smelt rune bars | Repair the Beacon Network beacon near the Wilderness temple (smithing) |
| Fishing | 50 → 70 | Catch a raw swordfish; Harpoon tuna and swordfish | Catch a raw swordfish barehanded |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 90 | Unlock abandoned 2 floors | Daemonheim Achievements In the Darkness Bind Them |
| Necromancy | 5 → 20 | Perform a lesser communion ritual; Perform a lesser necroplasm ritual; Perform lesser necroplasm rituals in Um | (Necromancy) Unlock the Command Skeleton Warrior ability; Underworld Achievements Command & Calcium; Unlock and cast the Command Skeleton Warrior ability |

**With current, corrected**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 55 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Wield a gravite melee weapon |
| Ranged | 1 → 55 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Wield a gravite ranged weapon |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 75 | Unlock abandoned 2 floors | Enter the Al Kharid resource dungeon |

### Lumbridge 12850

**Alone, before rule filtering**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Prayer | 1 → 45 | Add impious ashes to wooden incense sticks; Bury bones; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Lumbridge Achievements Gods, Give Me Strength |
| Fishing | 1 → 25 | Catch a raw crayfish | Lumbridge Achievements And It Was THIS Big! |
| Firemaking | 30 → 60 | Add willow logs to a bonfire; Craft impious willow incense sticks; Craft willow incense sticks; Light a fire using willow logs | Lumbridge Achievements Are Yew As Fired Up As I Am? |
| Woodcutting | 20 → 57 | Cut willow logs | Cut a waka canoe |

**Alone, corrected**

No gaps.

**With current, before rule filtering**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 60 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Wield a corrupt dragon weapon |
| Strength | 1 → 80 | Fight cow (Strength); Fight hill giant (Strength); Fight troll brute (Strength) | Open the door to the Het tomb |
| Defence | 1 → 60 | Fight cow (Defence); Fight hill giant (Defence); Fight troll brute (Defence) | Wear a piece of corrupt dragon armour |
| Ranged | 1 → 55 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Wield a gravite ranged weapon; Wield a gravite ranged weapon |
| Prayer | 1 → 50 | Add accursed ashes to maple incense sticks; Add impious ashes to wooden incense sticks; Bury big bones; Bury bones; Craft accursed maple incense sticks; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Talk to Azacorax; Talk to Azacorax |
| Runecrafting | 27 → 78 | Siphon air and fire runes from fire storms | Varrock Achievements A Ton of Earth |
| Smithing | 50 → 70 | Forge a rune ore box; Forge rune; Forge rune platebodies; Smelt a rune bar; Smelt rune bars | Repair the Beacon Network beacon near the Wilderness temple (smithing) |
| Fishing | 50 → 70 | Catch a raw swordfish; Harpoon tuna and swordfish | Catch a raw swordfish barehanded |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 90 | Unlock abandoned 2 floors | Daemonheim Achievements In the Darkness Bind Them |
| Necromancy | 5 → 20 | Perform a lesser communion ritual; Perform a lesser necroplasm ritual; Perform lesser necroplasm rituals in Um | (Necromancy) Unlock the Command Skeleton Warrior ability; Underworld Achievements Command & Calcium; Unlock and cast the Command Skeleton Warrior ability |

**With current, corrected**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 55 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Wield a gravite melee weapon |
| Ranged | 1 → 55 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Wield a gravite ranged weapon |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 75 | Unlock abandoned 2 floors | Enter the Al Kharid resource dungeon |

## Audit of previous and corrected targets

Every previous highest requirement was checked against the same selector, including requirements that did not produce a long gap. The tables below include the corrected targets too. Repeated labels are separated by category when they are different tasks. The reason text comes from the active list selector. Its original blockers remain in the local audit JSON.

**With current, both areas**

| Target task | Category | Active? | Selector reason if excluded |
| --- | --- | --- | --- |
| Wield a corrupt dragon weapon | Attack | No | Every qualifying item is non-permanent (Non-permanent BiS rule). |
| Open the door to the Het tomb | Strength | No | Task is not available. |
| Wear a piece of corrupt dragon armour | Defence | No | Every qualifying item is non-permanent (Non-permanent BiS rule). |
| Create a attuned portent of restoration I | Divination | No | Challenge already satisfied. |
| Create a portent of restoration I | Divination | No | Challenge already satisfied. |
| Wield a gravite ranged weapon | Dungeoneering | No | A higher skill goal is available. |
| Wield a gravite ranged weapon | Ranged | Yes |  |
| Talk to Azacorax | Magic | No | Task is not available. |
| Talk to Azacorax | Prayer | No | Task is not available. |
| Lumbridge Achievements Blast and Hellfire | Diary | No | Included in the available achievement parent: Lumbridge Achievements Complete the Hard Achievements. |
| Varrock Achievements A Ton of Earth | Diary | No | Task is not available. |
| Craft a mystic wand | Crafting | No | Challenge already satisfied. A lower-level processing method or its source frontier excludes this recipe. |
| Craft a mystic wand | Runecrafting | No | A goal at this skill level or higher is already satisfied. |
| Falador Achievements The Stonemasons | Diary | No | Task is not available. |
| Repair the Beacon Network beacon near the Wilderness temple (smithing) | Smithing | No | A lower-level processing method or its source frontier excludes this recipe. |
| Catch a raw swordfish barehanded | Strength | No | Task is not available. |
| Wilderness Achievements A Pizza the Loot | Diary | No | Task is not available. |
| Light the Beacon Network beacon near the Edgeville Monastery | Prayer | No | Task is not available. |
| Cut a waka canoe | Woodcutting | No | Challenge already satisfied. |
| Varrock Achievements Waka-Waka-aka | Diary | No | Task is not available. |
| Wilderness Achievements Wet and Wildy | Diary | No | Task is not available. |
| Daemonheim Achievements In the Darkness Bind Them | Diary | No | Task is not available. |
| Cross the lower log balance (Highweald Forest waterfall) | Agility | No | A goal at this skill level or higher is already satisfied. |
| Perils of Ice Mountain 1 | Quest | No | Task is not available. Hidden by the engine display filters. Only whole quest completion tasks are shown. |
| Grow an onion | Farming | No | Challenge already satisfied. |
| Slay a crawling hand in Burthorpe | Slayer | No | Challenge already satisfied. |
| Obtain a steel mattock | Extra | No | Challenge already satisfied. |
| Use a steel mattock | Archaeology | No | Challenge already satisfied. |
| Obtain a bulldog | Summoning | No | This method has no reachable primary training route. |
| Obtain a dalmatian | Summoning | No | This method has no reachable primary training route. |
| Obtain a greyhound | Summoning | No | This method has no reachable primary training route. |
| Obtain a labrador | Summoning | No | This method has no reachable primary training route. |
| Obtain a rune guardian | Summoning | No | This method has no reachable primary training route. |
| Obtain a sheepdog | Summoning | No | This method has no reachable primary training route. |
| Obtain a terrier | Summoning | No | This method has no reachable primary training route. |
| (Necromancy) Unlock the Command Skeleton Warrior ability | Extra | No | Challenge already satisfied. |
| Underworld Achievements Command & Calcium | Diary | No | Task is not available. |
| Unlock and cast the Command Skeleton Warrior ability | Necromancy | No | Challenge already satisfied. |
| Wield a gravite melee weapon | Attack | Yes |  |
| Wield a gravite magic weapon | Magic | Yes |  |
| Enter the Al Kharid resource dungeon | Dungeoneering | Yes |  |

**Al Kharid, alone**

| Target task | Category | Active? | Selector reason if excluded |
| --- | --- | --- | --- |
| Wield a rune weapon | Attack | No | Challenge already satisfied. |
| Wear a piece of rune armour | Defence | Yes |  |
| Equip a bronze arrow | Ranged | No | A goal at this skill level or higher is already satisfied. |
| Equip a bronze bolt | Ranged | No | A goal at this skill level or higher is already satisfied. |
| Wield a Chargebow | Ranged | No | Challenge already satisfied. |
| Wield a splitbark orb | Magic | No | A goal at this skill level or higher is already satisfied. |
| Wield a splitbark wand | Magic | No | A goal at this skill level or higher is already satisfied. |
| Obtain a rune pickaxe | Extra | No | Challenge already satisfied. |
| Obtain a rune hatchet | Extra | No | Challenge already satisfied. |

**Lumbridge, alone**

| Target task | Category | Active? | Selector reason if excluded |
| --- | --- | --- | --- |
| Wield a rune weapon | Attack | No | Challenge already satisfied. |
| Wear a piece of rune armour | Defence | Yes |  |
| Wield an adamant throwing axe | Ranged | No | Challenge already satisfied. |
| Wield an off-hand adamant throwing axe | Ranged | No | A goal at this skill level or higher is already satisfied. |
| Lumbridge Achievements Gods, Give Me Strength | Diary | No | Task is not available. |
| Lumbridge Achievements Blast and Hellfire | Diary | No | Task is not available. |
| Obtain a rune pickaxe | Extra | No | Challenge already satisfied. |
| Lumbridge Achievements And It Was THIS Big! | Diary | No | Task is not available. |
| Lumbridge Achievements Are Yew As Fired Up As I Am? | Diary | No | Task is not available. |
| Cut a waka canoe | Woodcutting | No | Challenge already satisfied. |
| Equip spiked gauntlets | Slayer | No | A goal at this skill level or higher is already satisfied. |

## Original cap comparison

These historical lists reproduce the original **Before** measurements. Skill-cap rows were fallback endpoints, not tasks; no rule can make them eligible task targets. Intermediate **Cut yew logs**, **Unlock abandoned floors** and **Unlock abandoned 2 floors** are usable method endpoints. The corrected lists retain method endpoints only below an active target. The Lumbridge achievement endpoints and completed waka goal are checked in the audit above.

### Al Kharid 13105, original cap fallback

**Alone**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Prayer | 1 → 99 | Bury bones | Skill cap (old fallback) |

**With current**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 120 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Skill cap (old fallback) |
| Strength | 1 → 120 | Fight cow (Strength); Fight hill giant (Strength); Fight troll brute (Strength) | Skill cap (old fallback) |
| Defence | 1 → 99 | Fight cow (Defence); Fight hill giant (Defence); Fight troll brute (Defence) | Skill cap (old fallback) |
| Constitution | 1 → 99 | Fight cow (Constitution); Fight hill giant (Constitution); Fight troll brute (Constitution) | Skill cap (old fallback) |
| Ranged | 1 → 120 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Skill cap (old fallback) |
| Prayer | 1 → 99 | Add accursed ashes to maple incense sticks; Add impious ashes to wooden incense sticks; Bury big bones; Bury bones; Craft accursed maple incense sticks; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Skill cap (old fallback) |
| Magic | 55 → 99 | Cast high level alchemy; High alchemy rune platebodies | Skill cap (old fallback) |
| Runecrafting | 27 → 110 | Siphon air and fire runes from fire storms | Skill cap (old fallback) |
| Crafting | 50 → 110 | Craft a ruby amulet (unstrung); String a ruby amulet | Skill cap (old fallback) |
| Mining | 60 → 110 | Access the mining guild | Skill cap (old fallback) |
| Smithing | 50 → 110 | Forge a rune ore box; Forge rune; Forge rune platebodies; Smelt a rune bar; Smelt rune bars | Skill cap (old fallback) |
| Fishing | 50 → 99 | Catch a raw swordfish; Harpoon tuna and swordfish | Skill cap (old fallback) |
| Cooking | 55 → 99 | Make an anchovy pizza | Skill cap (old fallback) |
| Firemaking | 65 → 110 | Craft yew incense sticks | Skill cap (old fallback) |
| Woodcutting | 50 → 70 | Cut acadia logs | Cut yew logs |
| Woodcutting | 70 → 110 | Cut yew logs | Skill cap (old fallback) |
| Fletching | 65 → 110 | Fletch diamond bolt tips; Tip diamond bolts | Skill cap (old fallback) |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 120 | Unlock abandoned 2 floors | Skill cap (old fallback) |
| Necromancy | 5 → 20 | Perform a lesser communion ritual; Perform a lesser necroplasm ritual; Perform lesser necroplasm rituals in Um | Skill cap (old fallback) |

### Lumbridge 12850, original cap fallback

**Alone**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Prayer | 1 → 45 | Add impious ashes to wooden incense sticks; Bury bones; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Lumbridge Achievements Gods, Give Me Strength |
| Fishing | 1 → 25 | Catch a raw crayfish | Lumbridge Achievements And It Was THIS Big! |
| Cooking | 1 → 99 | Cook a crayfish | Skill cap (old fallback) |
| Firemaking | 30 → 60 | Add willow logs to a bonfire; Craft impious willow incense sticks; Craft willow incense sticks; Light a fire using willow logs | Lumbridge Achievements Are Yew As Fired Up As I Am? |
| Woodcutting | 20 → 57 | Cut willow logs | Cut a waka canoe |
| Fletching | 25 → 110 | Fletch a willow longbow (unstrung) | Skill cap (old fallback) |

**With current**

| Skill | Gap | Continue using | Ends at |
| --- | --- | --- | --- |
| Attack | 1 → 120 | Fight cow (Attack); Fight hill giant (Attack); Fight troll brute (Attack) | Skill cap (old fallback) |
| Strength | 1 → 120 | Fight cow (Strength); Fight hill giant (Strength); Fight troll brute (Strength) | Skill cap (old fallback) |
| Defence | 1 → 99 | Fight cow (Defence); Fight hill giant (Defence); Fight troll brute (Defence) | Skill cap (old fallback) |
| Constitution | 1 → 99 | Fight cow (Constitution); Fight hill giant (Constitution); Fight troll brute (Constitution) | Skill cap (old fallback) |
| Ranged | 1 → 120 | Fight cow (Ranged); Fight hill giant (Ranged); Fight troll brute (Ranged) | Skill cap (old fallback) |
| Prayer | 1 → 45 | Add accursed ashes to maple incense sticks; Add impious ashes to wooden incense sticks; Bury big bones; Bury bones; Craft accursed maple incense sticks; Craft impious incense sticks; Craft impious oak incense sticks; Craft impious willow incense sticks | Lumbridge Achievements Gods, Give Me Strength |
| Runecrafting | 27 → 110 | Siphon air and fire runes from fire storms | Skill cap (old fallback) |
| Crafting | 50 → 110 | Craft a ruby amulet (unstrung); String a ruby amulet | Skill cap (old fallback) |
| Mining | 60 → 110 | Access the mining guild | Skill cap (old fallback) |
| Smithing | 50 → 110 | Forge a rune ore box; Forge rune; Forge rune platebodies; Smelt a rune bar; Smelt rune bars | Skill cap (old fallback) |
| Cooking | 55 → 99 | Make an anchovy pizza | Skill cap (old fallback) |
| Fletching | 65 → 110 | Fletch diamond bolt tips; Tip diamond bolts | Skill cap (old fallback) |
| Dungeoneering | 1 → 23 | Buy Dungeoneering xp with Dungeoneering tokens; Complete F2P Daemonheim floors; Unlock frozen floors | Unlock abandoned floors |
| Dungeoneering | 23 → 59 | Unlock abandoned floors | Unlock abandoned 2 floors |
| Dungeoneering | 59 → 120 | Unlock abandoned 2 floors | Skill cap (old fallback) |
| Necromancy | 5 → 20 | Perform a lesser communion ritual; Perform a lesser necroplasm ritual; Perform lesser necroplasm rituals in Um | Skill cap (old fallback) |

## Verification

- Focused model fixtures cover non-permanent wield and wear tasks with the rule off and on, repairable replacements, personal rule overrides, blocked and hidden categories, backlog, personal/shared completion and selected alternatives. Existing worker/server tests cover view-only use and unchanged saves.
- The layout, feature CSS, persistence commands and equipment permanence dataset are unchanged. No dependencies were added. Changelog and roadmap entries remain proposals for the merge owner.
- Focused model checks: 28 passed. Controller, selection, server and worker checks: 24 passed. `npm run test:quick`: 1,227 passed, zero failures or skips. The new small-fixture test file is classified as quick in `scripts/test-selection.mjs`.
- One successful light-locked session captured [desktop dark, 1440 × 900](../../.local/screens/area-permanence-alkharid-desktop-dark-1440.png) and [phone light, 390 × 844](../../.local/screens/area-permanence-alkharid-phone-light-390.png) using Al Kharid 13105, Player 1, F2P and a view-only link on the copied-save server at port 8947. Both showed Attack 55 and five combined gaps. Gameplay remained unchanged. The phone capture is desktop Chrome emulation, not a physical-phone check.
- The screenshot browser and server stopped, and the copied save and temporary Chrome profile were removed. The audit JSON and test logs remain local-only. `git diff --check` passed.
- The single full-suite run used `.local/with-heavy.ps1`: 3,902 tests, 3,901 passed, zero failures, one skipped generated PNG asset check. The log is local-only at `.local/area-permanence-full.log`.
