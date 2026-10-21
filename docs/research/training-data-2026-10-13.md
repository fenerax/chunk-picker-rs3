# F2P training data — 13 October 2026

The F2P catalogue grows from 121 to 262 methods. The 141 additions are 22 monsters across Attack, Strength, Defence, Ranged, Magic and Constitution (132 records), five Cooking recipes and four ordinary Runecrafting routes. Hill giant entry recommendations change from 1 to 20 for six existing records. All existing XP/action, hourly rates and economics remain unchanged; every new record leaves them unknown.

The parent integrated the data and tests. Separate research workers checked combat, noncombat and baseline coverage; the combat worker also reviewed the final merge. This is static source research and synthetic application evaluation, not observed gameplay or measured duo training.

## Catalogue and placement

- `app/data/training/methods.f2p.json` is the schema-2 F2P catalogue used by the authenticated catalogue endpoint and task-time estimator. Each method has a stable ID, skill, label, task matches, entry/max levels, membership flag, requirements, nullable XP, consumed inputs, outputs, source IDs, assumptions and nullable economics. New `matches` stay empty, so these additions do not bind or rewrite retained task IDs.
- `app/data/training/catalogue.mjs` wraps that file with the separate members Divination supplement. `app/tasks/training-planner.mjs` and `app/tasks/area-check.mjs` consume this combined catalogue. Area check merges admitted Helper methods with native primary task methods, deduplicates matched tasks and retains personal blockers. `app/tasks/area-check.mjs` was not edited.
- Requirements are ANDed; `anyOf` supplies alternatives. `monster` checks the admitted `access.monsters` set, `npc` checks `access.npcs`, `object` checks `access.objects`, and `area` checks `access.areas`. `chunk` checks an exact admitted base, section (`12850-1`) or named area. A monster name in the NPC list does not prove a combat source. Unknown aliases and missing sources fail closed. Inputs also require obtainable item sources, which does not mean stocked inventory.
- `buildTrainingAvailability` inherits the engine's access, membership, source backlog and personal quest/tutorial gates. `createTrainingSourceIndex` scans retained chunk/section `Monster`, `NPC` and `Object` records and named interior areas to explain locations. Its hints never grant access. New monster methods use exact retained names; they do not add spawns, unlock chunks or bypass section/quest/Dungeoneering gates.
- Method facts are hand-curated from pinned RuneScape Wiki pages. Entry recommendations are authored. NPC IDs/combat stats corroborate names and variants using the existing local extracted export; chunk placement comes from retained definitions and normal cache-backed source admission, not a Wiki place name converted into coordinates.

The versioned evidence file is `app/data/training/f2p-expansion.2026-10-13.v1.json`. It contains source revisions, canonical page links, F2P location facts, exact retained placements, corroborating NPC IDs and hashes. `scripts/research/build-training-data.mjs` merges it reproducibly and rejects conflicting rows. Repository hashes use canonical LF; external snapshots and the NPC export use exact bytes. The two existing skill-guide artifacts were rebuilt to refresh their training hashes and candidate coverage without changing generated tasks. `tests/helpers/repository-provenance.mjs` checks current identities.

## Entry rule

Combat entries are conservative planning tiers based on the strongest explicitly F2P variant represented by an exact selector. They are recommendations rather than in-game requirements or claims of optimal efficiency. Assume suitable F2P weapons, armour, food, ammunition/runes and supporting combat skills. Constitution uses the same tier for comparison but gains XP alongside combat. Max levels remain the existing skill caps: an entry level never limits the XP a monster can award.

| Reviewed monster combat level | Suggested skill entry |
| --- | ---: |
| 1–9 | 1 |
| 10–24 | 10 |
| 25–39 | 20 |
| 40–59 | 30 |
| 60–79 | 40 |
| 80–99 | 50 |
| 100+ | 60 |

Generic Spider and Giant spider cover several F2P variants, so their entries 10 and 20 deliberately overstate the requirement for easier local variants. The source data does not identify a variant at each spawn. Exact Goblin (Lumbridge) gives a level-1 local option. No new per-kill XP is inferred from hitpoints, combat level or stale guide tables.

Cooking and Runecrafting use sourced recipe unlock levels. Cooking output quantity is unknown because attempts can burn. Rune quantity remains unknown because multiplicity/Savvy effects vary. The new routes have no invented burn curve, hourly rate, teleport cycle or price.

## Coverage before and after

The scenario unlocks the 161 chunks from the retained `walkableChunksF2P` list present in the built world (162 entries before filtering) for one synthetic account, using default F2P rules and no personal completion/progress facts. Normal connected interior admission still applies. It does not grant every underground room or personally gated activity. No real save was read or changed.

**Raw** counts all F2P catalogue candidates. **Placeable** follows Area check's spatial/source blockers, including obtainable inputs and unsupported selectors. **Available** also requires personal prerequisites. The table reports raw count, placeable count, placeable entry levels and largest placeable stretch. A stretch is the difference between adjacent distinct entry levels, or the last entry and the existing F2P cap. It is spacing, not missing XP access, a time estimate or a skill ceiling. Bootstrap before the first entry is separate; no methods is “—”. Invention is explicitly unavailable.

| Skill / F2P cap | Raw before→after | Placeable before→after | Entry levels before | Entry levels after | Largest stretch before | Largest stretch after |
| --- | ---: | ---: | --- | --- | --- | --- |
| Attack / 120 | 3→25 | 3→23 | 1 | 1, 10, 20, 30, 40, 50, 60 | 1→120 (119) | 60→120 (60) |
| Strength / 120 | 3→25 | 3→23 | 1 | 1, 10, 20, 30, 40, 50, 60 | 1→120 (119) | 60→120 (60) |
| Defence / 99 | 3→25 | 3→23 | 1 | 1, 10, 20, 30, 40, 50, 60 | 1→99 (98) | 60→99 (39) |
| Constitution / 99 | 3→25 | 3→23 | 1 | 1, 10, 20, 30, 40, 50, 60 | 1→99 (98) | 60→99 (39) |
| Ranged / 120 | 3→25 | 3→23 | 1 | 1, 10, 20, 30, 40, 50, 60 | 1→120 (119) | 60→120 (60) |
| Prayer / 99 | 4→4 | 4→4 | 1 | 1 | 1→99 (98) | 1→99 (98) |
| Magic / 99 | 6→28 | 6→26 | 1, 7, 21, 55 | 1, 7, 10, 20, 21, 30, 40, 50, 55, 60 | 55→99 (44) | 60→99 (39) |
| Runecrafting / 110 | 5→9 | 3→7 | 1, 5 | 1, 5, 9, 14, 20 | 5→110 (105) | 20→110 (90) |
| Crafting / 110 | 7→7 | 7→7 | 1, 20, 22, 27, 29, 34, 43 | 1, 20, 22, 27, 29, 34, 43 | 43→110 (67) | 43→110 (67) |
| Mining / 110 | 10→10 | 10→10 | 1, 10, 20, 30, 40, 50 | 1, 10, 20, 30, 40, 50 | 50→110 (60) | 50→110 (60) |
| Smithing / 110 | 10→10 | 10→10 | 1, 10, 20, 30, 40, 50 | 1, 10, 20, 30, 40, 50 | 50→110 (60) | 50→110 (60) |
| Fishing / 99 | 12→12 | 12→12 | 1, 5, 20, 25, 30, 35, 40, 50 | 1, 5, 20, 25, 30, 35, 40, 50 | 50→99 (49) | 50→99 (49) |
| Cooking / 99 | 3→8 | 3→8 | 1, 15, 40 | 1, 5, 15, 20, 25, 30, 40, 45 | 40→99 (59) | 45→99 (54) |
| Firemaking / 110 | 10→10 | 10→10 | 1, 15, 30, 35, 45, 47, 60 | 1, 15, 30, 35, 45, 47, 60 | 60→110 (50) | 60→110 (50) |
| Woodcutting / 110 | 7→7 | 7→7 | 1, 10, 20, 30, 40, 50, 70 | 1, 10, 20, 30, 40, 50, 70 | 70→110 (40) | 70→110 (40) |
| Fletching / 110 | 12→12 | 12→12 | 1, 3, 5, 10, 13, 15, 20, 23, 25 | 1, 3, 5, 10, 13, 15, 20, 23, 25 | 25→110 (85) | 25→110 (85) |
| Dungeoneering / 120 | 1→1 | 1→1 | 1 | 1 | 1→120 (119) | 1→120 (119) |
| Agility / 5 | 1→1 | 1→1 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Herblore / 5 | 2→2 | 2→2 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Thieving / 5 | 1→1 | 1→1 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Farming / 5 | 1→1 | 1→1 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Hunter / 5 | 1→1 | 1→1 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Slayer / 5 | 1→1 | 0→0 | — | — | — | — |
| Divination / 5 | 1→1 | 1→1 | 1 | 1 | 1→5 (4) | 1→5 (4) |
| Construction / 20 | 3→3 | 3→3 | 1, 3, 6 | 1, 3, 6 | 6→20 (14) | 6→20 (14) |
| Archaeology / 20 | 2→2 | 2→2 | 5 | 5 | 5→20 (15) | 5→20 (15) |
| Summoning / 5 | 2→2 | 2→2 | 1, 4 | 1, 4 | 1→4 (3) | 1→4 (3) |
| Invention / 1 | 0→0 | 0→0 | — | — | — | — |
| Necromancy / 20 | 4→4 | 4→4 | 1, 5 | 1, 5 | 5→20 (15) | 5→20 (15) |

| Scope | Before | After |
| --- | ---: | ---: |
| Raw catalogue | 121 | 262 |
| Placeable catalogue | 118 | 247 |
| Available catalogue | 109 | 238 |
| Native tasks + Helper candidates | 649 | 778 |
| Available native tasks + Helper | 611 | 740 |

The full versioned coverage snapshot (`training-coverage.2026-10-13.v1.json`) retains raw/placeable/available and merged counts, each entry list and stretch for every skill. It also retains all local method IDs, labels, levels and statuses. Before raw Runecrafting includes entry 20, but its unverified teleport route cannot close the placeable 5→110 tail; the ordinary body route now closes that part. Slayer remains assignment-gated. Construction, Archaeology and Necromancy retain personal tutorial/quest blockers. Archaeology starts at 5, leaving a separate four-level bootstrap in this catalogue.

## Combat evidence and chunk mapping

Facts are credited to **RuneScape Wiki contributors, CC BY-NC-SA 3.0**, subject to its licensing exceptions. Every page below has a canonical link and a numerical revision link; the evidence JSON retains exact F2P location requirements, all retained chunk/section placements and NPC IDs. Placements can include members areas: only admitted F2P sources make the method usable.

| Monster selector | F2P combat levels | Entry | F2P location evidence | Retained placement examples | Sources |
| --- | --- | ---: | --- | --- | --- |
| Troll brute (retained) | 7 | 1 | Burthorpe Troll Cave | Abandoned Burthorpe mine | [page](https://runescape.wiki/w/Troll_brute), [rev 37143575](https://runescape.wiki/w/Troll_brute?oldid=37143575) |
| Cow (retained) | 2 | 1 | Astram Farm; Crafting Guild; Falador farm; Lumbridge; Marigold Farm; Mill Lane Mill | 10288-1, 11571-1, 11827, 12083-1, 12595 | [page](https://runescape.wiki/w/Cow), [rev 37142844](https://runescape.wiki/w/Cow?oldid=37142844) |
| Chicken | 1 | 1 | Champions' Guild; Falador farm; Farm east of the River Lum in Lumbridge; Fred's farm in Lumbridge; Marigold Farm; Road between Lumbridge and Varrock; Taverley; Tutorial Island; Sunken Tutorial Island; White Knights' Castle | 8753-3, 10039, 10044-1, 10300, 10549 | [page](https://runescape.wiki/w/Chicken), [rev 37142047](https://runescape.wiki/w/Chicken?oldid=37142047) |
| Giant rat | 4, 7, 9 | 1 | Bandit Camp (level 17 - 24 Wilderness); Edgeville Dungeon; Lumbridge Swamp; North of Varrock (level 1 - 5 Wilderness); South of Varrock; South-west of Port Sarim; Stronghold of Security; Varrock Sewers | 10033-1, 11825-1, 12089, 12593, 12594 | [page](https://runescape.wiki/w/Giant_rat), [rev 37153107](https://runescape.wiki/w/Giant_rat?oldid=37153107) |
| Goblin (Lumbridge) | 2 | 1 | Draynor Village; Lumbridge forest; Lumbridge | 12594, 12850-1, 12851-1, 12851-2 | [page](https://runescape.wiki/w/Goblin_(Lumbridge)), [rev 37143270](https://runescape.wiki/w/Goblin_(Lumbridge)?oldid=37143270) |
| Spider | 1, 15 | 10 | Al Kharid; Draynor Manor Dungeon; Lumbridge Swamp; Lumbridge forest; Lumbridge Castle Cellar; North of Red Dragon Isle; Ruins (west) (level 23 Wilderness); Stronghold of Security; Varrock Sewers | 10033-1, 10544, 10795-1, 11051-1, 11833-1 | [page](https://runescape.wiki/w/Spider), [rev 37145366](https://runescape.wiki/w/Spider?oldid=37145366) |
| Giant spider | 2, 4, 29, 33 | 20 | Stronghold of Security - Floor 3; West Wilderness ruins (level 21 - 24 Wilderness); Draynor Manor; Edgeville Dungeon; Lumbridge Swamp; Lumbridge; Lumbridge forest; Varrock Sewers | 9772, 9773, 10030, 11833-1, 12340-1 | [page](https://runescape.wiki/w/Giant_spider), [rev 37136145](https://runescape.wiki/w/Giant_spider?oldid=37136145) |
| Al Kharid warrior | 18 | 10 | Al Kharid palace | 13105 | [page](https://runescape.wiki/w/Al_Kharid_warrior), [rev 37156862](https://runescape.wiki/w/Al_Kharid_warrior?oldid=37156862) |
| Scorpion | 14, 26 | 20 | Al Kharid mine; Dwarven mines; Karamja Volcano; Stronghold of Security (3rd level); Varrock Sewers; Wilderness (Scorpion Pit); Wilderness (south of Chaos altar) | 10291, 11050-3, 11051-1, 11054, 11313 | [page](https://runescape.wiki/w/Scorpion), [rev 37143891](https://runescape.wiki/w/Scorpion?oldid=37143891) |
| Minotaur | 12, 15 | 10 | Stronghold of Security | Stronghold of Security | [page](https://runescape.wiki/w/Minotaur), [rev 37143683](https://runescape.wiki/w/Minotaur?oldid=37143683) |
| Flesh Crawler | 26 | 20 | Stronghold of Security | Stronghold of Security | [page](https://runescape.wiki/w/Flesh_Crawler), [rev 37153668](https://runescape.wiki/w/Flesh_Crawler?oldid=37153668) |
| Zombie | 12, 22, 29 | 20 | Draynor Sewers; Edgeville Dungeon; Varrock Sewers | 9879, 10133, 10137, 10318, 10388 | [page](https://runescape.wiki/w/Zombie), [rev 37125135](https://runescape.wiki/w/Zombie?oldid=37125135) |
| Skeleton | 15, 16, 32, 46, 51, 58 | 30 | Crandor; Crandor and Karamja Dungeon; Draynor Sewers; Edgeville Dungeon; Stronghold of Security (4th level); Varrock Sewers; Wilderness (north of Edgeville); Wilderness (Boneyard); Wilderness (level 9) south-west mine; Wilderness (The Forgotten Cemetery); Wilderness Crater | 8543, 9297, 9622, 10137, 10387 | [page](https://runescape.wiki/w/Skeleton), [rev 37188293](https://runescape.wiki/w/Skeleton?oldid=37188293) |
| Cockroach worker | 30 | 20 | Stronghold of Player Safety lower level; Stronghold of Player Safety middle level; Stronghold of Player Safety upper level | Stronghold of Player Safety | [page](https://runescape.wiki/w/Cockroach_worker), [rev 37142088](https://runescape.wiki/w/Cockroach_worker?oldid=37142088) |
| Hill giant (retained) | 26 | 20 | Edgeville Dungeon; Edgeville Dungeon resource dungeon; South-east of the Boneyard; Hollow Hill | 9525-2, 9778-1, 10033-1, 13113, 17205-1 | [page](https://runescape.wiki/w/Hill_giant), [rev 37203057](https://runescape.wiki/w/Hill_giant?oldid=37203057) |
| Moss giant | 40 | 30 | Crandor; Varrock Sewers | 8763, 10037-1, 10802-2, 11314-1, Chaos Tunnels | [page](https://runescape.wiki/w/Moss_giant), [rev 37143822](https://runescape.wiki/w/Moss_giant?oldid=37143822) |
| Ice warrior | 40 | 30 | Asgarnian Ice Dungeon | 11318-2, 11836, Chaos Tunnels, Asgarnian Ice Dungeon, Ice Queen's lair | [page](https://runescape.wiki/w/Ice_warrior), [rev 37143337](https://runescape.wiki/w/Ice_warrior?oldid=37143337) |
| Ice giant | 47 | 30 | Asgarnian Ice Dungeon | 11062-3, 11318-3, 11836, Chaos Tunnels, Asgarnian Ice Dungeon | [page](https://runescape.wiki/w/Ice_giant), [rev 37164944](https://runescape.wiki/w/Ice_giant?oldid=37164944) |
| Catablepon | 43 | 30 | Stronghold of Security (3rd level) | Stronghold of Security | [page](https://runescape.wiki/w/Catablepon), [rev 37142100](https://runescape.wiki/w/Catablepon?oldid=37142100) |
| Ankou | 54 | 30 | Stronghold of Security (fourth level); Wilderness Crater (level 28 Wilderness) | 12602, Stronghold of Security | [page](https://runescape.wiki/w/Ankou), [rev 37131602](https://runescape.wiki/w/Ankou?oldid=37131602) |
| Cockroach soldier | 70 | 40 | Stronghold of Player Safety secure sector; Stronghold of Player Safety middle level; Stronghold of Player Safety lower level; Stronghold of Player Safety upper level | Stronghold of Player Safety | [page](https://runescape.wiki/w/Cockroach_soldier), [rev 37142083](https://runescape.wiki/w/Cockroach_soldier?oldid=37142083) |
| Lesser demon | 70 | 40 | Karamja Volcano resource dungeon; Crandor; Crandor and Karamja Dungeon; Forinthry Dungeon; Wilderness Crater; South-east of the Demonic Ruins | 11315, 12345, Taverley Dungeon, Karamja Volcano Dungeon, Karamja Volcano resource dungeon | [page](https://runescape.wiki/w/Lesser_demon), [rev 37159794](https://runescape.wiki/w/Lesser_demon?oldid=37159794) |
| Greater demon | 82 | 50 | Forinthry Dungeon (level 22 Wilderness); Wilderness Crater (level 24 Wilderness); Demonic Ruins (level 47 Wilderness) | 12601, 13116, Entrana Dungeon, Kuradal's Dungeon, Brimhaven Dungeon | [page](https://runescape.wiki/w/Greater_demon), [rev 37199607](https://runescape.wiki/w/Greater_demon?oldid=37199607) |
| Deadly red spider | 95 | 50 | Crandor and Karamja Dungeon; Varrock Sewers; Abandoned Farm (level 35-38 Wilderness) | 9267-1, 12858, Chaos Tunnels, Edgeville Dungeon, Karamja Volcano Dungeon | [page](https://runescape.wiki/w/Deadly_red_spider), [rev 37142373](https://runescape.wiki/w/Deadly_red_spider?oldid=37142373) |
| Hellhound | 92, 105 | 60 | Wilderness Crater (level 23 Wilderness); Northwest of the Flesh-hatcher Mhekarnahz resource dungeon (level 34 Wilderness); Northeast of the Eastern Ruins (level 31 Wilderness); East of the Deserted Keep (level 51 Wilderness); Lava Maze (level 43 Wilderness); Forinthry Dungeon (level 31 Wilderness) | 12091-2, 12092-3, 12092-4, 12093, 12345 | [page](https://runescape.wiki/w/Hellhound), [rev 37196163](https://runescape.wiki/w/Hellhound?oldid=37196163) |

Al Kharid warrior is combat 18 at 13105; Scorpion is in Al Kharid mine 13107-1 rather than 13105. Hill giant is currently combat 26 in both the pinned Wiki and matching NPC export, so its existing entry moves to 20. Hellhound includes combat 92/105 variants; its F2P sources are in the Wilderness and its generic entry is 60. Ordinary and resource-dungeon alternatives retain their independent access gates.

## Other additions

| Method | Entry | Requirements / supplies | Sources |
| --- | ---: | --- | --- |
| Cook herring on a range | 5 | Cooking range[+]; Raw herring | [page](https://runescape.wiki/w/Herring), [rev 36692172](https://runescape.wiki/w/Herring?oldid=36692172) |
| Cook pike on a range | 20 | Cooking range[+]; Raw pike | [page](https://runescape.wiki/w/Pike), [rev 36953424](https://runescape.wiki/w/Pike?oldid=36953424) |
| Cook salmon on a range | 25 | Cooking range[+]; Raw salmon | [page](https://runescape.wiki/w/Salmon), [rev 36953393](https://runescape.wiki/w/Salmon?oldid=36953393) |
| Cook tuna on a range | 30 | Cooking range[+]; Raw tuna | [page](https://runescape.wiki/w/Tuna), [rev 37074041](https://runescape.wiki/w/Tuna?oldid=37074041) |
| Cook swordfish on a range | 45 | Cooking range[+]; Raw swordfish | [page](https://runescape.wiki/w/Swordfish), [rev 37190613](https://runescape.wiki/w/Swordfish?oldid=37190613) |
| Craft mind runes | 1 | Mind Rune Temple; Mind talisman or Mind tiara; Rune essence | [page](https://runescape.wiki/w/Mind_rune), [rev 37194611](https://runescape.wiki/w/Mind_rune?oldid=37194611); [page](https://runescape.wiki/w/Mind_altar), [rev 37128550](https://runescape.wiki/w/Mind_altar?oldid=37128550) |
| Craft earth runes | 9 | Earth Rune Temple; EarthTalisman[+]; Rune essence | [page](https://runescape.wiki/w/Earth_rune), [rev 37194617](https://runescape.wiki/w/Earth_rune?oldid=37194617); [page](https://runescape.wiki/w/Earth_altar), [rev 37128552](https://runescape.wiki/w/Earth_altar?oldid=37128552) |
| Craft fire runes | 14 | Fire Rune Temple; FireTalisman[+]; Rune essence | [page](https://runescape.wiki/w/Fire_rune), [rev 37194620](https://runescape.wiki/w/Fire_rune?oldid=37194620); [page](https://runescape.wiki/w/Fire_altar), [rev 37128553](https://runescape.wiki/w/Fire_altar?oldid=37128553) |
| Craft body runes | 20 | Body Rune Temple; Body talisman or Body tiara; Rune essence | [page](https://runescape.wiki/w/Body_rune), [rev 37194622](https://runescape.wiki/w/Body_rune?oldid=37194622); [page](https://runescape.wiki/w/Body_altar), [rev 37128555](https://runescape.wiki/w/Body_altar?oldid=37128555) |

Mind runes currently unlock at level 1, rather than the historical level 2. New Mind/Body methods use explicit talisman-or-tiara alternatives because the retained aliases are absent. Earth/Fire use existing aliases. Named temples connect to Mind 11830, Earth 13110, Fire 13106 and Body 12085; a surface unlock alone does not grant the temple. Ruby/diamond cutting and ordinary water runes already existed.

## Local method lists

These are full Area check candidate lists, including admitted connected interiors, using identical synthetic states before and after. Al Kharid needs no section override. Lumbridge explicitly confirms town `12850-1` and cow pen `12850-2`; the town-only alternative is recorded separately. An unseeded isolated Lumbridge base admits neither section and gives zero methods before and after. The confirmed-town scenario is 50→68 methods; both confirmed sections are 58→76. Al Kharid is 10→22.

Al Kharid alone had no Cow source in this audit. A Cow shown in a personal combined-area result comes from other admitted territory. The catalogue previously knew only Troll brute, Cow and Hill giant. This report does not infer Player 1 or Player 2's saved section/access state.

### Al Kharid 13105 — before

| Skill | Entry | Method | ID | Status |
| --- | ---: | --- | --- | --- |
| Prayer | 1 | Bury bones | `prayer.bury-bones` | available |
| Magic | 11 | Cast Weaken | `rs3:task:001542` | blocked |
| Mining | 10 | Mine a size 1 crashed star | `rs3:task:0014b5` | blocked |
| Mining | 20 | Mine a size 2 crashed star | `rs3:task:0014be` | blocked |
| Mining | 30 | Mine a size 3 crashed star | `rs3:task:0014c7` | blocked |
| Mining | 40 | Mine a size 4 crashed star | `rs3:task:0014d1` | blocked |
| Mining | 50 | Mine a size 5 crashed star | `rs3:task:0014da` | blocked |
| Herblore | 1 | Clean grimy guam | `herblore.clean-guam` | available |
| Thieving | 1 | Pickpocket a citizen | `rs3:task:001d6c` | available |
| Thieving | 1 | Pickpocket men | `thieving.man` | available |

### Al Kharid 13105 — after

| Skill | Entry | Method | ID | Status |
| --- | ---: | --- | --- | --- |
| Attack | 10 | Fight al kharid warrior (Attack) | `attack.al-kharid-warrior` | available |
| Attack | 10 | Fight spider (Attack) | `attack.spider` | available |
| Strength | 10 | Fight al kharid warrior (Strength) | `strength.al-kharid-warrior` | available |
| Strength | 10 | Fight spider (Strength) | `strength.spider` | available |
| Defence | 10 | Fight al kharid warrior (Defence) | `defence.al-kharid-warrior` | available |
| Defence | 10 | Fight spider (Defence) | `defence.spider` | available |
| Constitution | 10 | Fight al kharid warrior (Constitution) | `constitution.al-kharid-warrior` | available |
| Constitution | 10 | Fight spider (Constitution) | `constitution.spider` | available |
| Ranged | 10 | Fight al kharid warrior (Ranged) | `ranged.al-kharid-warrior` | available |
| Ranged | 10 | Fight spider (Ranged) | `ranged.spider` | available |
| Prayer | 1 | Bury bones | `prayer.bury-bones` | available |
| Magic | 10 | Fight al kharid warrior (Magic) | `magic.al-kharid-warrior` | available |
| Magic | 10 | Fight spider (Magic) | `magic.spider` | available |
| Magic | 11 | Cast Weaken | `rs3:task:001542` | blocked |
| Mining | 10 | Mine a size 1 crashed star | `rs3:task:0014b5` | blocked |
| Mining | 20 | Mine a size 2 crashed star | `rs3:task:0014be` | blocked |
| Mining | 30 | Mine a size 3 crashed star | `rs3:task:0014c7` | blocked |
| Mining | 40 | Mine a size 4 crashed star | `rs3:task:0014d1` | blocked |
| Mining | 50 | Mine a size 5 crashed star | `rs3:task:0014da` | blocked |
| Herblore | 1 | Clean grimy guam | `herblore.clean-guam` | available |
| Thieving | 1 | Pickpocket a citizen | `rs3:task:001d6c` | available |
| Thieving | 1 | Pickpocket men | `thieving.man` | available |

### Lumbridge 12850, both sections — before

| Skill | Entry | Method | ID | Status |
| --- | ---: | --- | --- | --- |
| Attack | 1 | Fight cow (Attack) | `attack.cow` | available |
| Strength | 1 | Fight cow (Strength) | `strength.cow` | available |
| Defence | 1 | Fight cow (Defence) | `defence.cow` | available |
| Constitution | 1 | Fight cow (Constitution) | `constitution.cow` | available |
| Ranged | 1 | Fight cow (Ranged) | `ranged.cow` | available |
| Prayer | 1 | Add impious ashes to wooden incense sticks | `prayer.impious-sticks` | available |
| Prayer | 1 | Bury bones | `prayer.bury-bones` | available |
| Prayer | 1 | Craft impious incense sticks | `rs3:task:00176c` | available |
| Prayer | 1 | Craft impious oak incense sticks | `rs3:task:001771` | available |
| Prayer | 1 | Craft impious willow incense sticks | `rs3:task:001772` | available |
| Magic | 1 | Cast Confuse | `rs3:task:001522` | available |
| Magic | 1 | Fight cow (Magic) | `magic.cow` | available |
| Fishing | 1 | Catch a raw crayfish | `rs3:task:000fb8` | available |
| Cooking | 1 | Cook a crayfish | `rs3:task:00068a` | available |
| Cooking | 1 | Cook cooked meat | `rs3:task:00067f` | available |
| Firemaking | 1 | Add normal logs to a bonfire | `rs3:task:000ed3` | available |
| Firemaking | 1 | Craft impious incense sticks | `rs3:task:000ed7` | available |
| Firemaking | 1 | Craft wooden incense sticks | `rs3:task:000ed6` | available |
| Firemaking | 1 | Light a fire using normal logs | `rs3:task:000ed2` | available |
| Firemaking | 15 | Add oak logs to a bonfire | `rs3:task:000eef` | available |
| Firemaking | 15 | Light a fire using oak logs | `rs3:task:000eee` | available |
| Firemaking | 20 | Craft impious oak incense sticks | `rs3:task:000ef9` | available |
| Firemaking | 20 | Craft oak incense sticks | `rs3:task:000ef8` | available |
| Firemaking | 21 | Light a normal bow fire | `rs3:task:000efc` | blocked |
| Firemaking | 30 | Add willow logs to a bonfire | `rs3:task:000f03` | available |
| Firemaking | 30 | Craft impious willow incense sticks | `rs3:task:000f06` | available |
| Firemaking | 30 | Craft willow incense sticks | `rs3:task:000f05` | available |
| Firemaking | 30 | Light a fire using willow logs | `rs3:task:000f02` | available |
| Firemaking | 35 | Light an oak bow fire | `rs3:task:000f11` | blocked |
| Firemaking | 50 | Light a willow bow fire | `rs3:task:000f3e` | blocked |
| Firemaking | 60 | Add yew logs to a bonfire | `rs3:task:000f54` | available |
| Firemaking | 60 | Light a fire using yew logs | `rs3:task:000f53` | available |
| Firemaking | 80 | Light a yew bow fire | `rs3:task:000f8c` | blocked |
| Woodcutting | 1 | Cut logs | `rs3:task:001e54` | available |
| Woodcutting | 10 | Cut oak logs | `rs3:task:001e66` | available |
| Woodcutting | 20 | Cut willow logs | `rs3:task:001e6f` | available |
| Woodcutting | 70 | Cut yew logs | `rs3:task:001e91` | available |
| Fletching | 1 | Fletch a shortbow (unstrung) | `rs3:task:001027` | available |
| Fletching | 1 | Fletch a wood box | `rs3:task:00102b` | available |
| Fletching | 1 | Fletch shafts using normal logs | `rs3:task:001024` | available |
| Fletching | 3 | Fletch a wooden stock | `rs3:task:00102c` | available |
| Fletching | 5 | Fletch a longbow (unstrung) | `rs3:task:001030` | available |
| Fletching | 10 | Fletch an oak shortbow (unstrung) | `rs3:task:001039` | available |
| Fletching | 10 | Fletch an oak wood box | `rs3:task:00103b` | available |
| Fletching | 10 | Fletch shafts using oak logs | `rs3:task:001038` | available |
| Fletching | 13 | Fletch an oak stock | `rs3:task:00104d` | available |
| Fletching | 15 | Fletch an oak longbow (unstrung) | `rs3:task:001051` | available |
| Fletching | 20 | Fletch a willow shortbow (unstrung) | `rs3:task:001058` | available |
| Fletching | 20 | Fletch a willow wood box | `rs3:task:00105a` | available |
| Fletching | 20 | Fletch shafts using willow logs | `rs3:task:001057` | available |
| Herblore | 1 | Clean grimy guam | `herblore.clean-guam` | available |
| Herblore | 1 | Grind ground ashes | `rs3:task:001171` | available |
| Thieving | 1 | Pickpocket a citizen | `rs3:task:001d6c` | available |
| Thieving | 1 | Pickpocket men | `thieving.man` | available |
| Thieving | 2 | Steal from a vegetable stall | `rs3:task:001d75` | available |
| Thieving | 5 | Steal from a crafting stall | `rs3:task:001d78` | available |
| Slayer | 1 | Receive a slayer assignment from Jacquelyn | `rs3:task:001a3a` | available |
| Necromancy | 1 | Fight cow (Necromancy) | `necromancy.cow` | blocked |

### Lumbridge 12850, both sections — after

| Skill | Entry | Method | ID | Status |
| --- | ---: | --- | --- | --- |
| Attack | 1 | Fight cow (Attack) | `attack.cow` | available |
| Attack | 1 | Fight goblin (lumbridge) (Attack) | `attack.goblin-lumbridge` | available |
| Attack | 10 | Fight spider (Attack) | `attack.spider` | available |
| Attack | 20 | Fight giant spider (Attack) | `attack.giant-spider` | available |
| Strength | 1 | Fight cow (Strength) | `strength.cow` | available |
| Strength | 1 | Fight goblin (lumbridge) (Strength) | `strength.goblin-lumbridge` | available |
| Strength | 10 | Fight spider (Strength) | `strength.spider` | available |
| Strength | 20 | Fight giant spider (Strength) | `strength.giant-spider` | available |
| Defence | 1 | Fight cow (Defence) | `defence.cow` | available |
| Defence | 1 | Fight goblin (lumbridge) (Defence) | `defence.goblin-lumbridge` | available |
| Defence | 10 | Fight spider (Defence) | `defence.spider` | available |
| Defence | 20 | Fight giant spider (Defence) | `defence.giant-spider` | available |
| Constitution | 1 | Fight cow (Constitution) | `constitution.cow` | available |
| Constitution | 1 | Fight goblin (lumbridge) (Constitution) | `constitution.goblin-lumbridge` | available |
| Constitution | 10 | Fight spider (Constitution) | `constitution.spider` | available |
| Constitution | 20 | Fight giant spider (Constitution) | `constitution.giant-spider` | available |
| Ranged | 1 | Fight cow (Ranged) | `ranged.cow` | available |
| Ranged | 1 | Fight goblin (lumbridge) (Ranged) | `ranged.goblin-lumbridge` | available |
| Ranged | 10 | Fight spider (Ranged) | `ranged.spider` | available |
| Ranged | 20 | Fight giant spider (Ranged) | `ranged.giant-spider` | available |
| Prayer | 1 | Add impious ashes to wooden incense sticks | `prayer.impious-sticks` | available |
| Prayer | 1 | Bury bones | `prayer.bury-bones` | available |
| Prayer | 1 | Craft impious incense sticks | `rs3:task:00176c` | available |
| Prayer | 1 | Craft impious oak incense sticks | `rs3:task:001771` | available |
| Prayer | 1 | Craft impious willow incense sticks | `rs3:task:001772` | available |
| Magic | 1 | Cast Confuse | `rs3:task:001522` | available |
| Magic | 1 | Fight cow (Magic) | `magic.cow` | available |
| Magic | 1 | Fight goblin (lumbridge) (Magic) | `magic.goblin-lumbridge` | available |
| Magic | 10 | Fight spider (Magic) | `magic.spider` | available |
| Magic | 20 | Fight giant spider (Magic) | `magic.giant-spider` | available |
| Fishing | 1 | Catch a raw crayfish | `rs3:task:000fb8` | available |
| Cooking | 1 | Cook a crayfish | `rs3:task:00068a` | available |
| Cooking | 1 | Cook cooked meat | `rs3:task:00067f` | available |
| Firemaking | 1 | Add normal logs to a bonfire | `rs3:task:000ed3` | available |
| Firemaking | 1 | Craft impious incense sticks | `rs3:task:000ed7` | available |
| Firemaking | 1 | Craft wooden incense sticks | `rs3:task:000ed6` | available |
| Firemaking | 1 | Light a fire using normal logs | `rs3:task:000ed2` | available |
| Firemaking | 15 | Add oak logs to a bonfire | `rs3:task:000eef` | available |
| Firemaking | 15 | Light a fire using oak logs | `rs3:task:000eee` | available |
| Firemaking | 20 | Craft impious oak incense sticks | `rs3:task:000ef9` | available |
| Firemaking | 20 | Craft oak incense sticks | `rs3:task:000ef8` | available |
| Firemaking | 21 | Light a normal bow fire | `rs3:task:000efc` | blocked |
| Firemaking | 30 | Add willow logs to a bonfire | `rs3:task:000f03` | available |
| Firemaking | 30 | Craft impious willow incense sticks | `rs3:task:000f06` | available |
| Firemaking | 30 | Craft willow incense sticks | `rs3:task:000f05` | available |
| Firemaking | 30 | Light a fire using willow logs | `rs3:task:000f02` | available |
| Firemaking | 35 | Light an oak bow fire | `rs3:task:000f11` | blocked |
| Firemaking | 50 | Light a willow bow fire | `rs3:task:000f3e` | blocked |
| Firemaking | 60 | Add yew logs to a bonfire | `rs3:task:000f54` | available |
| Firemaking | 60 | Light a fire using yew logs | `rs3:task:000f53` | available |
| Firemaking | 80 | Light a yew bow fire | `rs3:task:000f8c` | blocked |
| Woodcutting | 1 | Cut logs | `rs3:task:001e54` | available |
| Woodcutting | 10 | Cut oak logs | `rs3:task:001e66` | available |
| Woodcutting | 20 | Cut willow logs | `rs3:task:001e6f` | available |
| Woodcutting | 70 | Cut yew logs | `rs3:task:001e91` | available |
| Fletching | 1 | Fletch a shortbow (unstrung) | `rs3:task:001027` | available |
| Fletching | 1 | Fletch a wood box | `rs3:task:00102b` | available |
| Fletching | 1 | Fletch shafts using normal logs | `rs3:task:001024` | available |
| Fletching | 3 | Fletch a wooden stock | `rs3:task:00102c` | available |
| Fletching | 5 | Fletch a longbow (unstrung) | `rs3:task:001030` | available |
| Fletching | 10 | Fletch an oak shortbow (unstrung) | `rs3:task:001039` | available |
| Fletching | 10 | Fletch an oak wood box | `rs3:task:00103b` | available |
| Fletching | 10 | Fletch shafts using oak logs | `rs3:task:001038` | available |
| Fletching | 13 | Fletch an oak stock | `rs3:task:00104d` | available |
| Fletching | 15 | Fletch an oak longbow (unstrung) | `rs3:task:001051` | available |
| Fletching | 20 | Fletch a willow shortbow (unstrung) | `rs3:task:001058` | available |
| Fletching | 20 | Fletch a willow wood box | `rs3:task:00105a` | available |
| Fletching | 20 | Fletch shafts using willow logs | `rs3:task:001057` | available |
| Herblore | 1 | Clean grimy guam | `herblore.clean-guam` | available |
| Herblore | 1 | Grind ground ashes | `rs3:task:001171` | available |
| Thieving | 1 | Pickpocket a citizen | `rs3:task:001d6c` | available |
| Thieving | 1 | Pickpocket men | `thieving.man` | available |
| Thieving | 2 | Steal from a vegetable stall | `rs3:task:001d75` | available |
| Thieving | 5 | Steal from a crafting stall | `rs3:task:001d78` | available |
| Slayer | 1 | Receive a slayer assignment from Jacquelyn | `rs3:task:001a3a` | available |
| Necromancy | 1 | Fight cow (Necromancy) | `necromancy.cow` | blocked |

## Limits and remaining gaps

- Generic variants remain conservative. Style weakness, hit chance, food sustain, aggression and actual training efficiency are not modelled. Higher entry is not evidence of higher XP/hour. Wilderness risk and members/resource-dungeon branches remain source-specific.
- Generic Zombie and Skeleton are researched F2P candidates but are not admitted by the all-surface synthetic scenario, leaving 12 added records unavailable there. Their underground placement/variant mapping needs a separate access review; the catalogue does not grant those sources. Generic Goblin, Barbarian and Dark wizard were withheld because exact retained variant placement needs further work.
- Long upper tails remain: combat 60→120 or 60→99; Dungeoneering 1→120; Fletching 25→110; Crafting 43→110; Runecrafting 20→110; Prayer 1→99. Some are F2P content ceilings and some are curated catalogue gaps. Native primary tasks offer broader noncombat coverage (see merged snapshot). No tiers were fabricated merely to shorten these tails.
- The local NPC export corroborates identity/combat stats but does not independently prove membership, active spawn placement or XP. Wiki snapshots are ignored local research evidence with recorded exact-byte hashes; the committed condensed facts and numeric revision links remain reviewable without those snapshots. No game cache was modified.
- No UI, save, server, History/Undo flow, price snapshot, members Divination supplement, changelog or roadmap data was changed. No interactive browser or picker server was started; test servers used disposable fixtures. Screenshots are omitted for this catalogue-only task.

## Verification and reproduction

- Focused catalogue, data, planner and repository provenance tests: 38 passed with `node --test --test-timeout=120000 tests/training-data.test.mjs tests/training-catalogue.test.mjs tests/repository-provenance.test.mjs tests/training-planner.test.mjs`.
- New focused test file is classified quick in `scripts/test-selection.mjs`. It checks tier boundaries, six-skill coverage, unknown XP, retained rates, actual Area check consumption with synthetic placements, fail-closed gates, cooking yield and repeatable/conflict-safe merging.
- Rebuilt skill-guide data, runtime and milestone checks: 17 passed. Only compact candidate coverage changed; all four generated tasks and 20 reviewed training breakpoints stayed unchanged.
- Quick suite: 1,223 passed across 123 files; no failures.
- Full suite, run once through `powershell -NoProfile -File .local/with-heavy.ps1 npm test`: 3,898 tests, 3,897 passed, 1 skipped, 0 failed. The run exited successfully and released its lock. Log: `.local/training-data-audit/full-test.log`.

```powershell
node scripts/research/build-training-data.mjs
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/research/training-data-coverage.mjs current.json
```

The merge is idempotent. The audit writes only `.local/training-data-audit`; it reads cache-backed data under the existing heavy wrapper. To reproduce the before catalogue, use the recorded baseline revision in a disposable checkout and copy the current audit runner into it. Current catalogue, evidence and audit identities are bound in the versioned coverage snapshot.
