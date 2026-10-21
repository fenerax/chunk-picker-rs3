# Choosing a members starting bank

Research snapshot: **12 October 2026**. For Player 1 and Player 2's separate maps, after finishing F2P and keeping personal levels, quests and completed tasks. This report changes no maps or game progress.

## What the evidence supports

Havenhythe has **five full-bank locations**, plus **two deposit-only facilities**. For a start without a members quest, **Wendlewick (16692)** works after the F2P quest *Visions of Havenhythe*. **Dalia's Tree Nursery (16690)** also works once the F2P achievement *Trader Woes* is complete and membership is active. The other three full banks require members quest progress. The idea of "about two" fits the banks available after F2P preparation, rather than the whole island's bank count. [Local: L1, L2 below; Wiki: Wendlewick bank](https://runescape.wiki/w/Wendlewick_bank?oldid=37114602), [nursery chest](https://runescape.wiki/w/Bank_chest_(Wendlewick)?oldid=37135424), [Trader Woes](https://runescape.wiki/w/Trader_Woes?oldid=37197977), [Heathervein](https://runescape.wiki/w/Heathervein?oldid=37201982), [Linbog Village](https://runescape.wiki/w/Linbog_Village?oldid=37203094), [Amberfell](https://runescape.wiki/w/Amberfell?oldid=37201972).

Player 2's Hunter idea is real: **Havenhythe has Big Game Hunter**, starting at **96 Hunter and 77 Slayer**, with higher hunts reaching **110 Hunter and 91 Slayer**. It offers a later equipment route, but cannot supply its own entry levels. The Shuruk-Ba concern is also reasonable: the repeatable **Ghrazi Blood Knights** encounter is endgame content. "Impossible with Havenhythe gear" has not been established; a likely practical soft lock is the stronger supported conclusion. [Wiki: Havenhythe Big Game Hunter](https://runescape.wiki/w/Havenhythe_Big_Game_Hunter?oldid=37187707), [Ghrazi Blood Knights](https://runescape.wiki/w/The_Ghrazi_Blood_Knights?oldid=37204958), [strategy](https://runescape.wiki/w/The_Ghrazi_Blood_Knights/Strategies?oldid=37204940).

The earlier concern is getting beyond western Havenhythe at all. **Construction 20→30 and Slayer 5→28 have no verified renewable island-only route in this review**, yet Secrets of Amberfell needs those levels. Later Divination and Archaeology methods also start above their F2P caps. Treat B as a constrained start whose progression rules need settling before the roll, rather than assuming Big Game Hunter will eventually fix every gap. This is an assessment from the sourced skill inventory below, not proof that no undiscovered method exists.

## What counts as a candidate

The main A list uses a conservative interpretation of **new members bank**: a service that becomes available with membership, reachable by ordinary walking from F2P territory, with no members quest, members-only skill gate, unconfirmed build or reward unlock, or members-only transport required. F2P banks remain a separate extension of A if "anywhere" is meant literally. Banks with an F2P-trainable level gate remain conditional until **each player's finishing levels** are known. These are planning assumptions, not additional game rules.

Membership itself is assumed. Ordinary coins and F2P-obtainable supplies can be prepared before the reset; a fare, rune payment or achievement is still listed where it matters. A members-only boat or portal is separated from the strict pool even when its only game requirement is membership. Completing a quest later does not make its bank a day-one candidate.

For B, the safe pool has Wendlewick, and a separate conditional entry for Dalia. All five Havenhythe banks are also recorded with their gates so the pool can expand deliberately after those gates are satisfied. A deposit box, material cart, ore store or reward chest does not replace a bank that lets you withdraw ordinary items. [Wiki: bank types](https://runescape.wiki/w/Bank?oldid=37193754#Types).

The skill table assumes **the needed Havenhythe chunks and connected interiors have eventually been unlocked**. It is an optimistic whole-island inventory, not the contents of either single starting chunk. "Havenhythe supplies alone" means no newly imported equipment, ingredients, quest unlocks or training locations. Retained F2P gear, bank stock and partner supply-sharing can change the practical difficulty; their exact allowance and contents were not supplied.

## Local evidence and its limits

Every table cites a local source key and/or a linked RuneScape Wiki page. **Local** means a statement about our retained data; **Wiki** means a game fact; **assessment** means our inference from those facts. Missing local records are not proof that content does not exist.

| Key | Local file | What it establishes |
| --- | --- | --- |
| L1 | [rs3-chunkpicker-chunkinfo-export.json](../../rs3-chunkpicker-chunkinfo-export.json) | Original chunk IDs, nicknames, objects, NPCs, monsters, shops, quest and skill declarations. Eastern named coverage stops at 17718. |
| L2 | [app/data/cache-resources.2026-10-08.v1.json](../../app/data/cache-resources.2026-10-08.v1.json) | Exact displayed surface object placements and resource classes, including bank booths/chests. Spatial evidence does not prove server interaction or access. |
| L3 | [app/data/cache-surface-corrections.2026-10-08.v1.json](../../app/data/cache-surface-corrections.2026-10-08.v1.json), [docs/research/mapfix3.md](mapfix3.md) | New eastern labels, phantom/water exclusions and boundary corrections. |
| L4 | [app/data/cache-walkability.2026-10-07.v1.json](../../app/data/cache-walkability.2026-10-07.v1.json), [app/data/cache-component-policy.2026-10-07.v1.json](../../app/data/cache-component-policy.2026-10-07.v1.json) | Static cardinal boundaries, disconnected components and tile membership; no personal quest state. |
| L5 | [app/data/cache-interiors.2026-10-08.v2.json](../../app/data/cache-interiors.2026-10-08.v2.json) | Interior display identities and retained surface connections. It explicitly grants no gameplay access. |
| L6 | [app/data/cache-archaeology.2026-10-08.v1.json](../../app/data/cache-archaeology.2026-10-08.v1.json), [app/data/cache-shops.2026-10-08.v1.json](../../app/data/cache-shops.2026-10-08.v1.json), [app/data/cache-npcs.2026-10-08.v1.json](../../app/data/cache-npcs.2026-10-08.v1.json) | Supplemental archaeology, limited reviewed shop stock and NPC identity evidence. Not a complete modern island catalogue. |
| L7 | [app/core/experience.mjs](../../app/core/experience.mjs) | Standard XP curve used for the calculated grind totals below. |

Wiki pages were retrieved through bounded direct MediaWiki API batches when ordinary page fetches failed. Only `runescape.wiki` was used for outside evidence. The machine-readable bank file pins checked Wiki revisions. The old search index and OSRS pages were not used for game conclusions.

## Havenhythe chunks in our map

The current spelling is **Fenmoor**, rather than Fenmore. Shuruk-Ba is the city; its label and the **Crimson Gate** are in **18997**. The gate's Wiki point (4780, 3402) independently gives that display ID. This does not make the boss instance itself a surface chunk. [Local: L3; Wiki: Fenmoor](https://runescape.wiki/w/Fenmoor?oldid=37201516), [Shuruk-Ba](https://runescape.wiki/w/Shuruk-Ba?oldid=37203737), [Crimson Gate](https://runescape.wiki/w/Crimson_Gate?oldid=37203635).

Here are all **47 named, evidenced surface squares** in the bounded Havenhythe inventory. A nickname or label locates a place within a square; it does not establish the whole village's boundary. Names marked "export" preserve our source's spelling. **All rows are local data claims from L1 unless L3 is shown.**

| Chunk | Name in our data | Source |
| --- | --- | --- |
| 16179 | Wendlewick Fish Farm | L1 |
| 16180 | North of Wendlewick Dock | L1 |
| 16434 | Western Shore Overlook | L1 |
| 16435 | Wendlewick Fishing Shop | L1 |
| 16436 | Wendle's Wicks | L1 |
| 16437 | Hermit Cave Entrance | L1 |
| 16438 | Precarious Outhouse | L1 |
| 16689 | South-West Havenhythe Shore | L1 |
| 16690 | Dalia's Tree Nursery | L1 |
| 16691 | Burnt Lobster Tavern | L1 |
| 16692 | Wendlewick | L1 |
| 16693 | Abandoned Cart | L1 |
| 16694 | Highweald Mine | L1 |
| 16944 | Here Be Crabs | L1 |
| 16945 | Jackalope Burrows | L1 |
| 16946 | Shrine of Innana (export; Inanna in Wiki) | L1 |
| 16947 | Marigold Farm | L1 |
| 16948 | Reuben's Home | L1 |
| 16949 | Raz's Hut | L1 |
| 16950 | Highweald Forest Waterfall | L1 |
| 17200 | Felix's Gravestone | L1 |
| 17201 | Anya's Tent | L1 |
| 17202 | Eastfold Farm | L1 |
| 17203 | Sanguine Crawlers | L1 |
| 17204 | Ruins East of Wendlewick | L1 |
| 17205 | Hill Giant Camp | L1 |
| 17206 | Saradominist Watchtower Ruins | L1 |
| 17456 | Harpoon Shore | L1 |
| 17457 | Deserted Mine | L1 |
| 17458 | Next Update Overlook (dated name) | L1 |
| 17459 | Wolf's Crossing | L1 |
| 17460 | Bridge to Amberfell | L1 |
| 17461 | Waterfall Pathway | L1 |
| 17462 | Loot Under the Waterfall | L1 |
| 17714 | Moonsylvar Wood | L3 |
| 17715 | Lone Pier | L1 |
| 17716 | Amberfell | L1 |
| 17717 | Moonrise Cliff | L1 |
| 17718 | Moorise Temple (export; Moonrise Temple) | L1 |
| 18226 | Linbog Village | L3 |
| 18228 | Berylbrook | L3 |
| 18229 | Exalted Quarry | L3 |
| 18230 | Heathervein | L3 |
| 18482 | Fenmoor | L3 |
| 18486 | Divine Fall | L3 |
| 18737 | Globin Village | L3 |
| 18997 | Shuruk-Ba | L3 |

The same local boundary audit finds these **31 unnamed squares or edge fragments**, for **78 squares with boundary evidence** in display X63–75 / Y48–58:

`16440, 16695, 16696, 16951, 17207, 17712, 17713, 17968, 17969, 17970, 17971, 17972, 17973, 17974, 17975, 18225, 18227, 18231, 18481, 18483, 18484, 18485, 18487, 18738, 18739, 18740, 18741, 18742, 18996, 18998, 19254`.

**These 78 are a local footprint to inspect, not a certified count of playable Havenhythe chunks.** Some are tiny coast fragments; some components within one chunk do not connect. The geographic ownership of unnamed boundary squares is unsure. **16440** is a one-tile fragment; **19254** has a six-tile connected component and a separate unconnected 110-tile fragment. [Local: L3, L4; no live movement check.]

| Boundary or excluded square | Why it matters | Source |
| --- | --- | --- |
| 17460, 17461 | Mixed F2P west / members east. The base F2P label does not open the members side or repair the bridge. | L3, L4; [Amberfell bridge](https://runescape.wiki/w/Bridge_(Amberfell)?oldid=37117376) |
| 16184, 19248, 19249, 19250 | Phantom floor flags; excluded from the land list. | L3 |
| 16433 | Detached rendered water; excluded. Most of 16689 remains real mainland. | L3 |
| 16183, 16439, 17719, 18232, 18480, 18736, 18743, 18744, 18993, 18994, 18995, 19000, 19251, 19252, 19253, 19255 | Isolated fragments with no accepted boundary or typed entry; excluded, not extra starter chunks. | L3, L4 |
| 18488, 18999 | Blocked display squares with zero walkable components; excluded. | L3 |

Connected interiors have their own picker IDs: **54 Hermit Cave** (retained entrance 16437), **55 Highweald Ruins** (16694), **56 Blighted Cave** (17203), **57 Hollow Hill** (17206), and **60 Moonrise Temple** (17718). These are local connections, not independently verified arrival tiles. Cache display-map numbers 765/764/766/767/768 are a different namespace. [Local: L1, L5.]

## Every Havenhythe bank and equivalent

All chunk assignments below come from exact bank-object positions in **L2**, cross-checked with **L1/L3**. "Now" assumes *Visions of Havenhythe* complete and membership active. Two Heathervein booths count as one bank location.

| Chunk | Place / service | Usable for the reset? | Requirements and evidence |
| --- | --- | --- | --- |
| **16692** | Wendlewick bank, Banker Nathan | **Yes** | F2P quest arrival; ordinary bank has no Trader Woes gate. [Wendlewick bank](https://runescape.wiki/w/Wendlewick_bank?oldid=37114602). |
| **16690** | Dalia's Tree Nursery bank chest | **Conditional F2P preparation** | Membership + **Trader Woes** completed. The achievement is F2P and uses exactly 30 **iron** nails; its travel visits other chunks. [Chest](https://runescape.wiki/w/Bank_chest_(Wendlewick)?oldid=37135424), [achievement](https://runescape.wiki/w/Trader_Woes?oldid=37197977). |
| **17716** | Amberfell bank | **Members quest first** | Repair the bridge during **Secrets of Amberfell**. Full quest completion is not required just to enter the village. Bridge uses 2 ropes, 10 same-kind logs and 20 same-kind nails. [Amberfell](https://runescape.wiki/w/Amberfell?oldid=37201972), [quest quick guide](https://runescape.wiki/w/Secrets_of_Amberfell/Quick_guide?oldid=37200672). |
| **18230** | Heathervein bank, Pallad | **Members quest first** | Partial **Heralds of Crimson** opens the area; no extra banker gate found. [Heathervein](https://runescape.wiki/w/Heathervein?oldid=37201982), [Pallad](https://runescape.wiki/w/Pallad?oldid=37201892). |
| **18482** | Linbog Village / Fenmoor bank chest | **Members quest first** | Partial **Heralds of Crimson**. The chest at (4612, 3258) lies in **18482**, although the village label is 18226. Cache object 141009 has Use/Collect/Load Last Preset actions. The precise Linbog/Fenmoor name association is **medium confidence**, not a visited bank. [Linbog Village](https://runescape.wiki/w/Linbog_Village?oldid=37203094), [Fenmoor](https://runescape.wiki/w/Fenmoor?oldid=37201516). |
| **16435** | Wendlewick Fishing Shop deposit box | **Deposit only; excluded** | Membership + Trader Woes; cannot withdraw or load equipment. [Deposit box](https://runescape.wiki/w/Deposit_box_(Wendlewick)?oldid=37074157). |
| **18229** | Exalted Quarry deposit box | **Deposit only; excluded** | Heralds quarry permission/progress. The area page and walkthrough differ on whether full completion is needed for all quarry activities; access before that is **unsure**. [Heralds](https://runescape.wiki/w/Heralds_of_Crimson?oldid=37204059). |

Other equivalents are limited storage: the **Exalted Quarry essence processor (18229)** sends processed exalted essence to the bank; local furnaces/forges use the **metal bank**; Archaeology material storage accepts excavation materials. None supplies general withdrawal and presets. They are not extra B entries. [Local: L2, L6; Wiki: Heralds quarry processing](https://runescape.wiki/w/Heralds_of_Crimson?oldid=37204059), [metal bank](https://runescape.wiki/w/Metal_bank?oldid=37080537), [material storage](https://runescape.wiki/w/Material_storage_container?oldid=37165834).

Wendlewick banking is temporarily disabled during parts of the Heralds defence encounters. That is a quest-stage restriction, not a permanent bank requirement. [Wiki: Heralds of Crimson](https://runescape.wiki/w/Heralds_of_Crimson?oldid=37204059).

## Option A: banks elsewhere

These **19 fixed entries** qualify under the stated A policy. This is the full qualifying list from the local bank inventory and bounded Wiki review. No live walking or banking test was performed. Connected interior banks use their documented surface entry chunk; their interior source-region IDs are not extra surface starts.

| Chunk | Place / bank | Access or remaining condition | Evidence |
| --- | --- | --- | --- |
| 9015 | Memorial to Guthix: Bank chest | Walk to the surface chest. No Divination level or quest gate; Hall of Memories requirements apply to different content. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Memorial_to_Guthix?oldid=37199767) |
| 9516 | Warforge surface camp: Bank chest | Walk to the surface camp. The 76 Archaeology requirement gates underground excavation, not this bank chest. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Warforge_Dig_Site?oldid=37125118) |
| 9776 | Castle Wars lobby: Bank chest | Walk into the lobby. No quest, skill requirement or game participation needed for the chest. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Castle_Wars?oldid=37159186) |
| 9781 | Tree Gnome Stronghold south-west bank: Gnome bank booths and bankers | Walk into the Stronghold and upstairs to the bank. No quest or Agility gate. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Tree_Gnome_Stronghold_bank?oldid=37133091), [Wiki 3](https://runescape.wiki/w/Tree_Gnome_Stronghold?oldid=37169573) |
| 9782 | Grand Tree: Grand Tree banks | Walk to the Grand Tree and climb to its banks. The Grand Tree quest is not required. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Grand_Tree_bank?oldid=37133103), [Wiki 3](https://runescape.wiki/w/Tree_Gnome_Stronghold?oldid=37169573) |
| 10039 | Barbarian Outpost: Barbarian Assault exterior bank chest | Walk to the exterior chest. Bar Crawl requirements apply to the agility course, not the bank. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Barbarian_Outpost?oldid=37130576) |
| 10288 | Yanille east: Yanille bank | Ordinary walking access. No quest, Agility or guild requirement for Yanille bank. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Yanille?oldid=37122659) |
| 10292 | North East Ardougne / Chaos Druid Tower chunk: Ardougne north bank | Ordinary walking access. The bank is outside the Chaos Druid Tower; its requirements do not apply. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/East_Ardougne?oldid=37203338) |
| 10547 | East Ardougne market: Ardougne south bank | Ordinary walking access. No quest requirement for Ardougne south bank. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/East_Ardougne?oldid=37203338) |
| 10549 | Temple of Ikov surface / Ranging Guild chunk: Stormguard Citadel surface camp bank chest | Walk to Stormguard surface camp. The chest at (2674, 3405) is outside the Ranging Guild and the dig-site interior; neither 40 Ranged nor 70 Archaeology is needed. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Stormguard_Citadel_Dig_Site?oldid=37164111) |
| 10806 | Seers' Village: Seers' Village bank | Walk across White Wolf Mountain and through Catherby. No quest requirement. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Seers%27_Village?oldid=37175737) |
| 11061 | Catherby: Catherby bank | Walk across White Wolf Mountain. Aggressive wolves are a hazard, not a level or quest gate. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672), [Wiki 2](https://runescape.wiki/w/Catherby?oldid=37146502) |
| 11313 | Karamja Volcano surface entrance: TzHaar City full bankers | Surface parent of the connected TzHaar City cavern. No members quest or skill gate for ordinary bankers. Internal source-region IDs are not separate surface starts. Reach Karamja using the retained F2P ship route if needed. | Local L1/L2; [Wiki](https://runescape.wiki/w/TzHaar_City?oldid=37179924) |
| 11573 | South Taverley / Pick and Lute: Rogues’ Den bank (Emerald Benedict) | Surface parent of Rogues' Den, through the pub trapdoor. No Thieving, Agility or Herblore gate for Emerald Benedict; minigame requirements are separate. | Local L1/L2; [Wiki](https://runescape.wiki/w/Rogues%27_Den?oldid=37130793) |
| 12596 | Champions' Guild: Champions' Arena bank chest | Surface parent of Champions' Arena bank. Its 33 quest-point entry requirement is met by all F2P quests. No champion scroll or fight is required merely to use the chest. | Local L1/L2; [Wiki](https://runescape.wiki/w/Champions%27_Guild?oldid=37146518) |
| 13104 | Shantay Pass: Shantay chest | Membership enables full bank opening. No quest, skill or item gate. The F2P healing/collection/preset functions do not make it a full F2P bank. | Local L1/L2; [Wiki](https://runescape.wiki/w/Shantay_chest?oldid=37161113) |
| 13111 | Fort Forinthry: Unbuilt Workshop bank chest | Membership required; the workshop need not be built. Other Fort bank services have separate quest/build gates. | Local L1/L2; [Wiki](https://runescape.wiki/w/Bank_chest_(Fort_Forinthry)?oldid=37175502) |
| 13365 | Varrock Dig Site / Senntisten entrance: Senntisten archaeological camp bank chest | Surface parent of Senntisten, entered through the Ancient door at (3332, 3452). No quest or 60 Archaeology gate for reaching the bank. This chunk also has a F2P campus bank. | Local L1/L2; [Wiki](https://runescape.wiki/w/Elder_God_Wars_Dungeon?oldid=37166261) |
| 13613 | Nardah: Nardah bank | Walk through Shantay Pass and across the River Elid. No quest or members transport required. Water and food are sensible desert preparation, not formal bank requirements. | Local L1/L2; [Wiki](https://runescape.wiki/w/Nardah?oldid=36803187) |

### F2P-achievable gates, payments and preparation

These **five** choices have no established members quest gate, but their remaining requirement must be confirmed before adding them to either player's pool. Canifis and Everlight can use the ghoul route without Priest in Peril. The Everlight walking route is an inference from Wiki directions, not a visited route.

| Chunk | Place / bank | Access or remaining condition | Evidence |
| --- | --- | --- | --- |
| 10293 | Fishing Guild: Fishing Guild bank | 68 Fishing, achievable in F2P. Completing F2P quests does not prove this level; check each player before adding. | Local L1/L2; [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| 9778 | Ourania surface entrance: Eniola bank | Surface parent of Eniola in Ourania Cave. Each bank opening costs 20 held runes of one type. F2P runes can pay; confirm supplies and that this payment is allowed. No members quest or skill gate identified. | Local L1/L2; [Wiki](https://runescape.wiki/w/Eniola?oldid=37145029) |
| 16690 | Dalia's Tree Nursery: Members bank chest | Membership and Trader Woes completed. This F2P achievement requires Visions of Havenhythe and exactly 30 iron nails; it can be prepared before the reset. Confirm its completion separately from F2P quests. | Local L1/L2; [Wiki](https://runescape.wiki/w/Dalia%27s_Tree_Nursery?oldid=37195435), [Wiki 2](https://runescape.wiki/w/Trader_Woes?oldid=37197977) |
| 13878 | Canifis: Canifis bank | Defeat the level-33 Paterdomus ghoul once and cross the holy barrier. Priest in Peril is an alternative, not mandatory. No members skill gate identified; confirm this one-time combat unlock or explicitly allow preparing it. | Local L1/L2; [Wiki](https://runescape.wiki/w/Canifis?oldid=37124299), [Wiki 2](https://runescape.wiki/w/Canifis_bank?oldid=37133011), [Wiki 3](https://runescape.wiki/w/Ghoul_(Paterdomus)?oldid=36954949) |
| 14642 | Everlight surface camp: Archaeology bank chest | Defeat the Paterdomus ghoul for Morytania access. Walking via Canifis, Haunted Woods and the eastern coast is supported by Wiki directions; no Nature Spirit gate is needed on that route. The 42 Archaeology level gates excavation/fast travel, with no separate bank gate stated. Confirm the walking route and bank interaction before automatic selection; neither was visited. | Local L1/L2; [Wiki](https://runescape.wiki/w/Everlight_Dig_Site?oldid=37145898), [Wiki 2](https://runescape.wiki/w/Ghoul_(Paterdomus)?oldid=36954949), [Wiki 3](https://runescape.wiki/w/Haunted_Woods?oldid=37133150) |

### Banks reached by members transport

Excluded from strict A. Reconsider them if the duo allows a members boat or portal for initial placement, after satisfying any bank build, level or fee requirement.

| Chunk | Place / bank | Access or remaining condition | Evidence |
| --- | --- | --- | --- |
| 10537 | Void Knights' Outpost: Normal bank and Shattered Worlds exterior bank | No quest or skill gate, but arrival uses the members-only Squire boat from Port Sarim. Excluded from strict A. The normal bank and Shattered Worlds exterior chest share this chunk. | Local L1/L2; [Wiki](https://runescape.wiki/w/Void_Knights%27_Outpost?oldid=37127341) |
| 8748 | Soul Wars lobby: Bank chest | No quest or skill gate, but arrival uses the members-only Soul Wars portal. Excluded from strict A. The current Edgeville entrance supersedes the old retained connection. | Local L1/L2; [Wiki](https://runescape.wiki/w/Soul_Wars?oldid=37159212) |
| 15939 | Anachronia base camp: Bank chest upgrade | Members ship journey, then tutorial, tier-1 Town Hall and bank upgrade costing 500 wood and 500 stone. The tutorial gives 250 of each; more resources are needed. Excluded for transport and an unmet bank build. | Local L1/L2; [Wiki](https://runescape.wiki/w/Bank_chest_(Anachronia_base_camp)?oldid=36984238) |
| 12332 | World window surface entrance north-west of Menaphos: Mazcab entrance chest and Kanatah/Otot Goebie suppliers | Surface parent of the World window at (3086, 2869), leading to Mazcab. Ordinary entrance and settlement banks have no quest gate, but require members portal travel. Raid suppliers are not included. This is one surface-parent choice, not separate rolls for underground source regions. | Local L1/L2; [Wiki](https://runescape.wiki/w/World_window?oldid=37176270) |
| 10293 | Fishing Guild entrance to Deep Sea Fishing: Bank boat and rowboat | 68 Fishing and members travel with Goomah to the separate hub. The Fishing Guild bank itself is already a level-conditional entry; boat/rowboat services do not add a separate surface chunk. | Local L1/L2; [Wiki](https://runescape.wiki/w/Deep_Sea_Fishing?oldid=37165157) |
| 14646 | Port Phasmatys: Ghost bank | Charter arrival allows quick-banking without Ghosts Ahoy or a ghostspeak amulet, but is members transport. Walking instead requires Morytania access and the pre-Ghosts Ahoy ecto-token/amulet gate. Excluded from strict A. | Local L1/L2; [Wiki](https://runescape.wiki/w/Port_Phasmatys?oldid=37125095) |

### Wandering Wilderness bankers

These **eight** Wiki markers identify bank-capable NPCs, but do not certify their whole patrol or permanent presence in a single locked chunk. Keep them conditional until a visit establishes an acceptable starting location. Marker coordinates use the same 64-tile region convention as [app/data/surface-grid.mjs](../../app/data/surface-grid.mjs); source labels come from L1.

| Chunk | Place / bank | Access or remaining condition | Evidence |
| --- | --- | --- | --- |
| 11834 | Forgotten Cemetery: Ian (cape merchant) | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Ian_(cape_merchant)?oldid=37134539) |
| 12856 | Chaos Temple: Simon | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Simon?oldid=37129637) |
| 12089 | Bandit Camp: Neil | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Neil?oldid=37129635) |
| 13372 | Dragonkin Laboratory Entrance: Edward | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Edward?oldid=37134537) |
| 11836 | Western Obelisk: Darren | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Darren?oldid=37134535) |
| 12860 | North-East Red Dragon Isle: William | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/William?oldid=37129630) |
| 12088 | Dark Warriors' Fortress: Sam (cape merchant) | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Sam_(cape_merchant)?oldid=37130023) |
| 12347 | South-East Lava Maze: Edmond (cape merchant) | Membership for banking; no quest or skill gate identified. NPC wanders: Wiki marker establishes this containing chunk, not the entire patrol or permanent presence. Keep conditional until a start-chunk visit confirms banking inside its boundary. | Local L1/L2; [Wiki](https://runescape.wiki/w/Edmond_(cape_merchant)?oldid=37129636) |

Larry cannot bank: his broken option was removed in 2017. [Wiki: Larry](https://runescape.wiki/w/Larry_(cape_merchant)?oldid=37129202).

### If A also includes F2P bank chunks

These **23 service entries** extend A to familiar F2P territory. Some share a chunk with the members list: deduplicate IDs when rolling. Local assignments: **L1/L2**. The Wiki list establishes ordinary bank identities; specific pages establish the connected-entry mappings and F2P quest gates recorded in the JSON. [Wiki bank locations](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672).

| Chunk | Place / bank | Requirement or entry convention |
| --- | --- | --- |
| 11575 | Burthorpe: Normal bank and training-camp chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 11573 | Taverley: Taverley bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 11826 | Rimmington: Surface bank chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 11828 | West Falador: West bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12084 | East Falador: East bank and Artisans’ Workshop chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12338 | Draynor: Draynor bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12342 | Edgeville: Edgeville bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12597 | Varrock west / Cooks' Guild chunk: Varrock west bank (not Cooks' Guild bank) | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12598 | Grand Exchange: Bankers | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12850 | Lumbridge: Castle upper bank and market chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12853 | Varrock east: East bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 12854 | North Varrock / Infernal Source exterior: Surface archaeology bank chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13105 | Al Kharid: Normal bank | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13361 | Kharid-et exterior: Surface archaeology chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13363 | Het's Oasis: Bank chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13364 | Exam Centre: Bank chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13365 | Archaeology Campus: Bank chest | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 13626 | Daemonheim west castle: Fremennik banker | Ordinary F2P-accessible bank service; included only if A extends to F2P bank chunks. No members quest or skill gate identified. |
| 16692 | Wendlewick: Banker Nathan / booth | Visions of Havenhythe completed under the all-F2P-quests baseline. Ordinary bank, no Trader Woes gate. |
| 11829 | Gamers' Grotto surface entry: Clan Wars and Cabbage Facepunch lobby chests / Fist of Guthix bank | Surface parent of Gamers' Grotto cave at (2992, 3409); connected lobby banks have no quest or level gate. No minigame participation is assumed. |
| 12339 | Draynor crossroads surface entry: Death’s Office bank and City of Um banks | F2P Death's Office bank; City of Um banks additionally require Necromancy!, met by the all-F2P-quests baseline. These connected interiors share this surface parent. |
| 12349 | Mage Arena surface lever: Gundai / Mage Arena cave bank | Surface lever parent of Gundai's Mage Arena cave bank. Banking does not require participation in Mage Arena. |
| 11318 | Land of Snow surface entry: Yeti Town bank after Violet is Blue | Violet is Blue completed under the all-F2P-quests baseline. Surface parent of Land of Snow / Yeti Town, entered through the portal at (2853, 3461). |

Three further F2P service choices still need levels or a retained item:

| Chunk | Place / bank | Access or remaining condition | Evidence |
| --- | --- | --- | --- |
| 11319 | Warriors' Guild: Bank | Base Attack + Strength at least 130, or base Attack 99, or base Strength 99. All are F2P-achievable; confirm each player's finishing levels. Temporary boosts do not grant entry. | Local L1/L2; [Wiki](https://runescape.wiki/w/Warriors%27_Guild?oldid=37169629) |
| 12339 | War's Retreat via Draynor: Two bank chests | 60 combat or 1,000 total level. F2P-achievable, but confirm actual finishing levels. Surface entry parent 12339, not interior source-region ID 13214. | Local L1/L2; [Wiki](https://runescape.wiki/w/War%27s_Retreat?oldid=37178109) |
| 12087 | Black Knights' Fortress: Upper floor bank chest after The Death of Chivalry | The Death of Chivalry is covered by the all-F2P-quests baseline. Entry still needs permitted armour, such as the quest's captain armour; confirm possession and wear. Upper-floor chest at (3027, 3577) maps to surface chunk 12087. | Local L1/L2; [Wiki](https://runescape.wiki/w/Black_Knights%27_Fortress?oldid=37168293) |

### Borderline banks excluded

Object names and old templates do not establish usable access. These groups explain the other tempting choices and services outside the safe pool. All local bank/connection declarations come from **L1/L2**; linked Wiki pages supply the game gates.

| Bank / chunk or system | Why excluded | Evidence |
| --- | --- | --- |
| Cooks' Guild bank (12597) | Hard Varrock achievements. The 99 Cooking alternative is an OSRS rule, not an RS3 bank unlock. | [Wiki](https://runescape.wiki/w/Cooks%27_Guild_bank?oldid=37108418), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Crafting Guild (11571) | Full chest requires hard Falador achievements. Level 40 Crafting and a brown apron allow the deposit service, not the full bank. | [Wiki](https://runescape.wiki/w/Crafting_Guild?oldid=37145395), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| May's Quest Caravan (12852) | Allocate 125 quest points to the Hub track. All F2P quests do not establish that unlock. | [Wiki](https://runescape.wiki/w/May%27s_Quest_Caravan?oldid=37188013), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Player-owned farm (10548) / Dinosaur Farm (14915) | A 300-bean upgrade is needed for a full bank. Deposit boxes and an unconfirmed upgrade do not qualify. | [Wiki](https://runescape.wiki/w/Bank_chest_(player-owned_farm)?oldid=36994564), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Anachronia outlying bank-like objects (for example 15427) | Static conditional objects do not prove a built bank. The base-camp build is listed separately. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Invention Guild (11829) | Requires the Invention unlock, including 80 Divination, beyond the F2P cap, and its tutorial. | [Wiki](https://runescape.wiki/w/Invention_Guild?oldid=37124934), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Dominion Tower (13360) | The current area page requires 20 specified quest completions for lobby banking; F2P quests alone do not meet that list. Arena banks also depend on an activity. | [Wiki](https://runescape.wiki/w/Dominion_Tower?oldid=37199913), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| War's Retreat | Keep conditional until the 60-combat or 1,000-total-level entry gate is confirmed. Use the Draynor surface parent. | [Wiki](https://runescape.wiki/w/War%27s_Retreat?oldid=37178109), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Heist / Deathmatch / Sinkholes / Shattered Worlds checkpoints | Activity instances are not independent surface starting chunks. Shattered Worlds exterior banking is recorded under the members-boat alternative. | [Wiki](https://runescape.wiki/w/Deathmatch?oldid=37130068), [Wiki 2](https://runescape.wiki/w/Shattered_Worlds?oldid=37127348), [Wiki 3](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Keldagrim / Blast Furnace / Barendir | Starting The Giant Dwarf is required for the boat entry to Keldagrim. The Black Guard quartermaster is a quest-only bank during Birthright of the Dwarves. | [Wiki](https://runescape.wiki/w/The_Giant_Dwarf?oldid=37182642), [Wiki 2](https://runescape.wiki/w/Keldagrim?oldid=37185357), [Wiki 3](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Burgh de Rott / Odovacar | Burgh needs In Aid of the Myreque; Odovacar needs Haunted Mine and 100 coins. Canifis and Everlight are instead conditional through the ghoul route. | [Wiki](https://runescape.wiki/w/Canifis?oldid=37124299), [Wiki 2](https://runescape.wiki/w/Everlight_Dig_Site?oldid=37145898), [Wiki 3](https://runescape.wiki/w/Cornelius?oldid=37139267), [Wiki 4](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Etceteria (10300) | Members boat access requires The Fremennik Trials. Throne of Miscellania is not itself a bank-use requirement. | [Wiki](https://runescape.wiki/w/Etceteria?oldid=37122987), [Wiki 2](https://runescape.wiki/w/Miscellania?oldid=37123140), [Wiki 3](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Neitiznot (9275) / Jatizso (9531) | Members Fremennik quest and boat access; starting The Fremennik Isles is enough for the stated Jatizso stage, but is still a members quest. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Oo'glog (10028) | As a First Resort bank unlock. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Shilo Village (11310) | Shilo Village quest access. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Piscatoris / Arnold Lydspor | Swan Song. Nearby deposit services are not substitutes for the bank. | [Wiki](https://runescape.wiki/w/Arnold_Lydspor?oldid=37122549), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Lletya (9265) / Prifddinas / Lunar Isle (8253) | Members elf/lunar quest gates. Related district, Grand Exchange, waterfall and guild banks inherit them. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Zanaris / Dorgesh-Kaan | Lost City / Death to the Dorgeshuun respectively. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Legends' Guild (10804) | Legends' Quest. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Mos Le'Harmless (14638) | Cabin Fever. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Sophanem (13099) | Contact! bank repair/unlock, plus the relevant desert access. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Arc: Waiko (15134), Tuai Leit (15139), Cyclosis | Impressing the Locals members miniquest and sea travel. Cyclosis also depends on Ports access. | [Wiki](https://runescape.wiki/w/Kotahi?oldid=37139516), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Ancient Prison / Ashuelot Reis | God Wars/Frozen Key access and Zarosian kill count or ceremonial outfit are not established by the F2P baseline. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Darkmeyer / River Noumenon / Dream of Iaia / Ungael / Zolarea | Members quests: The Branches of Darkmeyer / Nomad's Elegy / Extinction / Requiem for a Dragon / partial Stellar Born. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Other Fort banks / Copperpot | Constructed Town Hall, Chapel, Kitchen or Workroom and their quests. The unbuilt workshop chest is the qualifying exception. | [Wiki](https://runescape.wiki/w/Bank_chest_(Fort_Forinthry)?oldid=37175502), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Druidess | The bank-capable version is a World Wakes quest NPC. Ordinary Taverley druids are not bankers. | [Wiki](https://runescape.wiki/w/Druidess?oldid=37145268), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Larry, cape merchant | No Bank action; the broken option was removed in 2017. | [Wiki](https://runescape.wiki/w/Larry_(cape_merchant)?oldid=37129202), [Wiki 2](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Deposit-only services | Port Sarim, Port Khazard (10545), guild deposit boxes, Herblore Habitat, Peer the Seer, resource dungeons, Living Rock pulley, Arc boxes, Wizard Myrtle, Mimsy and portable/bait boxes cannot withdraw ordinary items. | [Wiki](https://runescape.wiki/w/Port_Khazard?oldid=37122867), [Wiki 2](https://runescape.wiki/w/Crafting_Guild?oldid=37145395), [Wiki 3](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Limited storage/noting | Beefy Bill, Stiles, metal banks, tool leprechauns, Croesus reward chest and log piles do not offer general bank withdrawal. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Clan Citadel / Head Guard / gear crates / Ports bank boxes | Clan, tier or Ports prerequisites and separate interiors; no confirmed account-independent surface starter. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Temporary, historical and tutorial banks | Seasonal availability, removed objects, instances and an inaccessible completed tutorial do not establish permanent starting banks. | [Wiki](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Havenhythe banks beyond Wendlewick | Dalia is conditional on F2P Trader Woes; Amberfell, Heathervein and Linbog/Fenmoor require members quest progress. | [Wiki](https://runescape.wiki/w/Dalia%27s_Tree_Nursery?oldid=37195435), [Wiki 2](https://runescape.wiki/w/Trader_Woes?oldid=37197977), [Wiki 3](https://runescape.wiki/w/List_of_bank_locations?oldid=37201672) |
| Mr Pinsworth / Thieves' Guild | Buyers and Cellars and all three capers for the completed guild bank. | [Wiki](https://runescape.wiki/w/Mr_Pinsworth?oldid=37148736) |
| Magnus Gram | Jatizso bank in 9531 requires starting The Fremennik Isles. | [Wiki](https://runescape.wiki/w/Magnus_Gram?oldid=37147972) |
| Cornelius | Repaired Burgh de Rott bank during In Aid of the Myreque. | [Wiki](https://runescape.wiki/w/Rogue_(Crucible)?oldid=37126404) |
| Jade | Warriors' Guild entry levels; recorded as conditional above, rather than a separate roll. | [Wiki](https://runescape.wiki/w/Jade_(NPC)?oldid=37148702) |
| Rogue, Crucible banker | Historical/deleted NPC; do not confuse its old banker entry with current rogue monsters. | [Wiki](https://runescape.wiki/w/Cornelius?oldid=37139267) |

## Training with Havenhythe supplies

The table covers **all 29 skills**. "Highest" means highest **verified method in this review**, not an exhaustive maximum or a cap on the skill. Repeating a lower method still earns XP. A conditional late method does not prove a route from the starting level to it. All chunk/target declarations are local data claims; linked pages establish game levels, products or requirements.

The current F2P baseline allows **Construction, Archaeology and Necromancy up to 20**, most other members skills up to **5**, and no Invention unlock. The fully free skills can be trained much higher, including the newer 110 caps; do not assume either player has maxed them. The generic Members page has older Construction-cap wording, so this uses the more specific current F2P page. [Wiki: Free-to-play](https://runescape.wiki/w/Free-to-play?oldid=37175453).

| Skill | Lowest verified local method | Highest verified method, requirements and supply limits | Evidence |
| --- | --- | --- | --- |
| Attack | Chickens, cows, juvenile boulder crabs; retained weapon or local havensilver | High monsters and bosses give ordinary combat XP. Practical progression depends on weapons and food; boss presence alone does not prove a viable build. | L1 16947/16435/17205; L2 16692/17973; [Havensilver weapons](https://runescape.wiki/w/Havensilver_weapons?oldid=37201352), [Bane equipment](https://runescape.wiki/w/Bane_equipment?oldid=37173287) |
| Strength | Same low monsters with melee XP settings | Same high combat; local bane equipment is a stronger general melee route after 80 Smithing/Mining. | L1 16947/17205; L2 17973; [Bane equipment](https://runescape.wiki/w/Bane_equipment?oldid=37173287) |
| Defence | Same low combat with appropriate XP settings | Same high combat. Armour and weapon supply remain separate from earning XP. | L1 monster records; L2 17973; [Havenhythe](https://runescape.wiki/w/Havenhythe?oldid=37203736) |
| Constitution | Passive XP from ordinary combat | High combat and bosses; no separate training-location gate established. | L1 monster records; [Havenhythe](https://runescape.wiki/w/Havenhythe?oldid=37203736) |
| Ranged | Shortbow spawns, basic bows/arrows, low combat; feathers from chickens/birdhouses | Ordinary high combat; elder logs from 72 WC chimera trees and local banite enable stronger bows/crossbows. Exact weapon recipes and boss drops must be checked before calling a specific weapon BiS. | L1 16692/17716/16947/16946; L2 17973; [Chimera tree](https://runescape.wiki/w/Chimera_tree?oldid=37201440), [Bane equipment](https://runescape.wiki/w/Bane_equipment?oldid=37173287) |
| Magic | Retained F2P staff/spells with local rune drops | Repeatable combat XP; renewable high-tier staff upgrade not established here. Crawler/bogolin rune drops help supplies, but spell level alone does not improve staff accuracy. | L1 monsters; [Sanguine crawler](https://runescape.wiki/w/Sanguine_crawler?oldid=37196203), [Sanguine bogolin](https://runescape.wiki/w/Sanguine_bogolin?oldid=37201274) |
| Necromancy | Combat using retained F2P necromancy equipment, if kept | Repeatable combat XP is possible. No local Kili upgrade, Well of Souls or ritual progression established; a T90 necromancy preset would import outside dependencies. | L1 local combat targets, no ritual-site declaration; [Havenhythe](https://runescape.wiki/w/Havenhythe?oldid=37203736); [Ghrazi gear dependencies](https://runescape.wiki/w/The_Ghrazi_Blood_Knights/Strategies?oldid=37204940) |
| Prayer | Bury ordinary bones | Ivar's guaranteed colossal bone gives 400 XP. It cannot be offered to altars, bonfires or Ectofuntus. Inanna's altar restores points; no training multiplier verified. | L1 17205; [Colossal bone](https://runescape.wiki/w/Colossal_bone?oldid=37104184), [Altar of Inanna](https://runescape.wiki/w/Altar_of_Inanna?oldid=37117233) |
| Agility | No repeatable low-level XP bridge verified | Colossi mural deliveries grant scaled Agility XP after 77 Divination and east access. Barehand spirit moths require 85 Hunter/80 Agility. The lower Highweald log requires 1 but gives 0 XP. | L1 16949/16950; [Log balance](https://runescape.wiki/w/Log_balance_(Highweald_Forest_waterfall)?oldid=37136165), [Colossi Divination](https://runescape.wiki/w/Colossi_Divination?oldid=37201873), [Spirit moths](https://runescape.wiki/w/Spirit_moths?oldid=37170278) |
| Herblore | Clean guam at 1 from local drops/farming; Hearts gives 250 finite XP | 55 super antisanguine has an explicit local kwuarm + exalted essence route. Higher herb-cleaning methods are possible; fellstalk seeds drop from 104 Slayer strigoi and need 91 Farming. Highest complete potion chain remains unknown. | L1 16947 and Hearts; [Grimy guam](https://runescape.wiki/w/Grimy_guam?oldid=37180362), [Antisanguine](https://runescape.wiki/w/Antisanguine?oldid=37195780), [Super antisanguine](https://runescape.wiki/w/Super_antisanguine?oldid=37195781), [Ravenous strigoi](https://runescape.wiki/w/Ravenous_strigoi?oldid=37203142) |
| Thieving | Eligible Wendlewick villagers 1, bakery stall 5 | Rangers 40 are the highest verified target here; Master Farmers 38 provide seeds. Higher eastern targets not established. Match the local fish-stall identifier before importing another stall's 42 requirement. | L1 16691/16692/16947; [Villager](https://runescape.wiki/w/Villager_(Wendlewick)?oldid=37203063), [Bakery Stall](https://runescape.wiki/w/Bakery_Stall?oldid=37118278), [Ranger](https://runescape.wiki/w/Ranger?oldid=37203070), [Master Farmer Lilah](https://runescape.wiki/w/Master_Farmer_Lilah?oldid=37156875) |
| Crafting | Spin wool 1; flax 10 and local pottery facilities | 100 apex armour tailoring/adornment: BGH supplies hides, Reuben tans them locally. 91 exalted-slab processing is also local. Chima bowstring is 58 Crafting, despite the overview calling it Fletching. 110 masterwork has outside-material gaps. | L1 17202/16946/16692/16948; [Apex leather](https://runescape.wiki/w/Apex_leather?oldid=37171838), [Tailoring](https://runescape.wiki/w/Tailoring?oldid=36997711), [Exalted essence](https://runescape.wiki/w/Exalted_essence?oldid=37200341), [Chima bowstring](https://runescape.wiki/w/Chima_bowstring?oldid=37200458) |
| Mining | Copper, tin, clay 1; limestone 10 | 105 large essence deposits; 85 regular deposits; 65 essence veins. Banite and mithril also occur in the eastern cache. Lower ore can bridge missing tiers, but higher pickaxe materials still matter. | L1 16694/16950/17457; L2 17973/17974; L3 18229; [Essence vein](https://runescape.wiki/w/Essence_vein?oldid=37197616), [Essence deposit](https://runescape.wiki/w/Essence_deposit?oldid=37197618), [Large essence deposit](https://runescape.wiki/w/Large_essence_deposit?oldid=37198879) |
| Smithing | Bronze 1 with local copper/tin; havensilver 1 after Hearts | 80 bane equipment, including +4.60 havensilver +2 is a separate Sanguine-bonus route. Steel 20/mithril 30 can bridge 80. Bane bars need only 2 banite; several other tiers need unverified companion ores. | L1 16692; L2 17973; [Bane bar](https://runescape.wiki/w/Bane_bar?oldid=37173249), [Bane equipment](https://runescape.wiki/w/Bane_equipment?oldid=37173287), [Havensilver weapons](https://runescape.wiki/w/Havensilver_weapons?oldid=37201352) |
| Fishing | Crayfish/shrimp 1 with locally sold tools | 82 wild giant crayfish, 270 XP, with lobster pot. 84 farm giant crayfish is conditional on 80 Construction, planks/nails/cloth. Wild spots bypass that gate. Eastern hogfish 69/claret crab 56 add options. | L1 16691/16435/16944/16949/17457; [Raw giant crayfish](https://runescape.wiki/w/Raw_giant_crayfish?oldid=37053917), [Wendlewick fish farm](https://runescape.wiki/w/Wendlewick_fish_farm?oldid=37202124), [Raw hogfish](https://runescape.wiki/w/Raw_hogfish?oldid=37202103), [Raw claret crab](https://runescape.wiki/w/Raw_claret_crab?oldid=37195566) |
| Cooking | Local meat/shrimp/crayfish 1 on ranges or fires | 86 giant crayfish, 212 XP; 75 Bog'n'Hog stew is another renewable food chain. Giant crayfish keep burning without cooking gauntlets or cape perk. Higher purchased pies/BGH meat not exhaustively audited. | L1 16947/16946; [Giant crayfish](https://runescape.wiki/w/Giant_crayfish?oldid=37170939), [Bog 'n' Hog stew](https://runescape.wiki/w/Bog_%27n%27_Hog_stew?oldid=37202772) |
| Firemaking | Normal logs 1 | 103 petrified logs in swamp brazier, supplied at 105 WC. Earlier petrified roots 67 FM/65 WC and bark 85 FM/WC bridge the route. Elder logs 90 FM can come from chimera. | L1 trees and Tom's Trove; [Petrified logs](https://runescape.wiki/w/Petrified_logs?oldid=37201324), [Petrified roots](https://runescape.wiki/w/Petrified_roots?oldid=37201328), [Petrified bark](https://runescape.wiki/w/Petrified_bark?oldid=37201327), [Fenmoor Totems](https://runescape.wiki/w/Fenmoor_Totems?oldid=37203293) |
| Fletching | Arrow shafts/basic bows 1; knife, logs and feathers local | 105 elemental Fenmoor totem with 105 WC petrified logs. 65 toad and 85 mollusc totems bridge it. Havensilver bolts +2 require 65 Fletching and local spines. | L1 16947/16692 and L2 trees; [Fenmoor Totems](https://runescape.wiki/w/Fenmoor_Totems?oldid=37203293), [Havensilver weapons](https://runescape.wiki/w/Havensilver_weapons?oldid=37201352) |
| Woodcutting | Normal trees 1 | 105 petrified wood; 103 Fenn ivy; 72 chimera yields regular through elder logs. 35 creeping ivy gives XP without logs. Eternal plots require Heedi's outside saplings. | L1 trees; L2 18225/18226; L3 18482; [Petrified logs](https://runescape.wiki/w/Petrified_logs?oldid=37201324), [Fenn ivy](https://runescape.wiki/w/Fenn_ivy?oldid=37200913), [Chimera tree](https://runescape.wiki/w/Chimera_tree?oldid=37201440), [Heedi's sapling](https://runescape.wiki/w/Heedi%27s_eternal_magic_sapling?oldid=37126306) |
| Runecrafting | No repeatable island XP method verified | No functional rune altar/Runespan verified inside the boundary. Exalted essence production gives Mining/Crafting XP, not Runecrafting XP. Moonrise has an 88 Archaeology blood-altar excavation hotspot; that is not evidence of a working runecrafting altar. | L1/L2/L3 geography; [Exalted essence](https://runescape.wiki/w/Exalted_essence?oldid=37200341), [Blood altar hotspot](https://runescape.wiki/w/Blood_altar_(excavation_hotspot)?oldid=37118798) |
| Farming | Rake/compost 1; potato 1 after obtaining seeds | 91 fellstalk explicitly sourced through strigoi seeds. 100 starbloom seed is locally pickpocketable, but also consumes a battlestaff; that renewable supply is unverified. Nursery trees/fruit need The Lute of Love. Highest fully supplied crop tier remains open. | L1 16947/16690; [Master Farmer Lilah](https://runescape.wiki/w/Master_Farmer_Lilah?oldid=37156875), [Fellstalk seed](https://runescape.wiki/w/Fellstalk_seed?oldid=37014062), [Starbloom seed](https://runescape.wiki/w/Starbloom_flower_seed?oldid=37196892), [Dalia's Tree Nursery](https://runescape.wiki/w/Dalia%27s_Tree_Nursery?oldid=37195435) |
| Hunter | 5 Hunter regular birdhouses, with 10 Fletching/5 Crafting, seeds and reusable clockwork sold by The Birds and the Bees. No local 1→5 Hunter bridge verified. | 110 giant dashing kebbit +91 Slayer. Entry is 96 giant chinchompa +77 Slayer. Shark bait is locally fishable. Elder birdhouses 91 use 90 Crafting and chimera elder logs; eternal birdhouses 101 need outside saplings/log supply. | L1 16945/16946/17205 and shopItems; [Birdhouses](https://runescape.wiki/w/Birdhouses?oldid=37175446), [Havenhythe BGH](https://runescape.wiki/w/Havenhythe_Big_Game_Hunter?oldid=37187707), [Creature table](https://runescape.wiki/w/Template:Havenhythe_Big_Game_Hunter_creatures?oldid=37187706) |
| Construction | Hermit Permits at 5 gives 500 finite XP; retained F2P 20 permits canoe repairs if planks supplied | 80 Linbog canoe/giant fish pool are finite repairs. No repeatable local bench/sawmill/house entrance verified. Logs do not equal planks. 20→30 required for Amberfell is unresolved. | L1 quests/canoes; [Construction](https://runescape.wiki/w/Construction?oldid=37188490), [Furniture workbench](https://runescape.wiki/w/Furniture_workbench?oldid=37199289), [Canoe station](https://runescape.wiki/w/Canoe_station_(Havenhythe)?oldid=37201116), [Fish farm](https://runescape.wiki/w/Wendlewick_fish_farm?oldid=37202124) |
| Slayer | No repeatable route from F2P 5 verified. An inherited matching task provides finite XP | BGH starts 77 Slayer/96 Hunter and grants 500–2500 Slayer XP per hunt. Strigoi require 104 to damage; ordinary kills give Slayer XP only on assignment. No island master verified. | L1 17203; [Slayer](https://runescape.wiki/w/Slayer?oldid=37197819), [Havenhythe BGH](https://runescape.wiki/w/Havenhythe_Big_Game_Hunter?oldid=37187707), [Creature table](https://runescape.wiki/w/Template:Havenhythe_Big_Game_Hunter_creatures?oldid=37187706), [Ravenous strigoi](https://runescape.wiki/w/Ravenous_strigoi?oldid=37203142) |
| Summoning | 1 spirit wolf: gold charm, wolf bones, 7 shards, pouch; local shop | 99 steel titan: crimson charm, 178 shards, steel ingot. Steel ingot needs 20 Smithing/5 steel bars. 88 unicorn stallion also local. Moths 18/32/49/64 Hunter supply charm colours; shard money is the large ongoing cost. | L1 16946/16945/16947; [Spirit wolf pouch](https://runescape.wiki/w/Spirit_wolf_pouch?oldid=37021209), [Steel titan pouch](https://runescape.wiki/w/Steel_titan_pouch?oldid=37021417), [Steel ingot](https://runescape.wiki/w/Steel_ingot?oldid=37166153), [Spirit moths](https://runescape.wiki/w/Spirit_moths?oldid=37170278) |
| Divination | No local bridge to 77 verified | 77 Colossi Divination with partial Heralds scales upward and gives remnant energy. Delivery routes and aggressive strigoi affect safety/time. | Harvest 18485, adjacent Divine Fall marker 18486; [13 October cache review](divination-training-2026-10-13.md); [Colossi Divination](https://runescape.wiki/w/Colossi_Divination?oldid=37201873) |
| Dungeoneering | No repeatable Havenhythe-only method verified | L1 interior 36 is named Sinkhole but contains no activity definition; insufficient proof of a usable training activity. No Daemonheim or Elite Dungeon inside the boundary verified. | L1 36; [Dungeoneering](https://runescape.wiki/w/Dungeoneering?oldid=37168496) |
| Archaeology | 52 ivory/banded limestone or Moonrise hotspots; no F2P 20→52 bridge verified | 88 blood altar excavation/restoration, after Secrets and tutorial. Material supply must be checked per artefact; collection/relic activation often involves outside NPCs. | L1 17205/17206/17717; L6 site 18292; [Moonrise](https://runescape.wiki/w/Moonrise_Dig_Site?oldid=37201265), [Ivory](https://runescape.wiki/w/Ivory?oldid=37138379), [Blood altar hotspot](https://runescape.wiki/w/Blood_altar_(excavation_hotspot)?oldid=37118798) |
| Invention | F2P cannot unlock it: 80 Crafting/Divination/Smithing plus outside tutorial | Training is conditional on imported P2P unlocks/augmentation. No local unlock route verified. | L2 has no Havenhythe inventor's workbench placement; [Invention](https://runescape.wiki/w/Invention?oldid=37167106) |


### The gaps that can stop an island start

**Amberfell comes after members skill work.** Secrets requires **30 Construction, 35 Herblore, 32 Hunter and 28 Slayer**. Construction 20→30 and Slayer 5→28 have no verified renewable Havenhythe-only bridge in this review. Ordinary off-task monster kills do not supply Slayer XP. Finite quest rewards or a carried assignment can help, but do not establish a repeatable route. [Local: L1 quest declarations; Wiki: Secrets](https://runescape.wiki/w/Secrets_of_Amberfell?oldid=37198041), [Slayer](https://runescape.wiki/w/Slayer?oldid=37197819).

**Eastern access adds more requirements.** Heralds requires 51 Crafting, 55 Herblore, 65 Mining and 60 Smithing. Colossi training then begins at **77 Divination**, while the lowest verified local Archaeology methods begin at **52**. Those do not bridge the F2P caps. Canoe/shortcut repair levels are route-specific, and their presence does not turn logs into planks or provide a repeatable Construction bench. [Wiki: Heralds](https://runescape.wiki/w/Heralds_of_Crimson?oldid=37204059), [Colossi](https://runescape.wiki/w/Colossi_Divination?oldid=37201873), [Moonrise](https://runescape.wiki/w/Moonrise_Dig_Site?oldid=37201265), [canoes](https://runescape.wiki/w/Canoe_station_(Havenhythe)?oldid=37201116); local L1/L2/L6.

### Player 2's Big Game Hunter claim

**Correct method, different entry level.** Havenhythe Big Game Hunter starts with giant chinchompas at **96 Hunter / 77 Slayer**. The top giant dashing kebbit hunt is **110 Hunter / 91 Slayer**. Successful hunts provide repeatable Slayer XP without ordinary assignments, apex hides, meat and bones. Wild sharks at 76 Fishing can supply starter bait. It can support later progression, including Reuben's local tanning for apex armour, but it cannot supply the first 77 Slayer levels or bypass Amberfell's earlier 28 Slayer requirement. [Wiki: Havenhythe Big Game Hunter](https://runescape.wiki/w/Havenhythe_Big_Game_Hunter?oldid=37187707), [creature requirements](https://runescape.wiki/w/Template:Havenhythe_Big_Game_Hunter_creatures?oldid=37187706), [apex leather](https://runescape.wiki/w/Apex_leather?oldid=37171838); local L1/L2.

The following are **calculated XP gaps**, using L7, from the start of the stated level. They are not measured training times. Actual retained XP reduces them.

| Gap | XP to earn | Why it matters |
| --- | ---: | --- |
| Construction 20→30 | 8,893 | Small XP amount, but a renewable local method/supply route is unverified. |
| Slayer 5→28 | 10,436 | Amberfell prerequisite; the missing assignment route matters more than XP size. |
| Slayer 5→77 | 1,475,193 | First Havenhythe BGH hunt. |
| Divination 5→77 | 1,475,193 | First Colossi training. |
| Archaeology 20→52 | 119,190 | First verified local material/hotspot training. |
| Hunter 5→96 | 9,684,189 | BGH entry; birdhouses are the earlier verified route. |
| Hunter 96→110 | 29,053,084 | Reaching the highest hunt, after entry. |

**Prayer can be very long without an outside multiplier.** Ivar's colossal bone gives 400 XP and cannot be offered to altars or the usual multiplied bone methods. Inanna restores prayer points. For scale, 1→99 Prayer would need **32,587** such bones if they were the only XP source; that is a calculation from L7, not a recommendation or an estimate for either player's retained level. [Wiki: colossal bone](https://runescape.wiki/w/Colossal_bone?oldid=37104184), [Inanna altar](https://runescape.wiki/w/Altar_of_Inanna?oldid=37117233).

**There are workable high-level supply chains.** Wild giant crayfish at 82 Fishing bypass the farm's 80 Construction giant-pool build. Chimera trees at 72 Woodcutting supply elder logs; petrified wood and Fenmoor totems extend Woodcutting/Fletching/Firemaking. Local moth charms, shard/pouch stock and steel ingots can support steel titan pouches, with shard money a continuing cost. [Wiki: giant crayfish](https://runescape.wiki/w/Raw_giant_crayfish?oldid=37053917), [chimera](https://runescape.wiki/w/Chimera_tree?oldid=37201440), [totems](https://runescape.wiki/w/Fenmoor_Totems?oldid=37203293), [steel titan pouch](https://runescape.wiki/w/Steel_titan_pouch?oldid=37021417); local L1/L2.

**High levels do not certify high gear or overloads.** Local banite supports bane +4 melee equipment at 80 Mining/Smithing. Apex hides and Reuben's tanning support later T85 tank armour. Masterwork recipes need outside materials, and eternal trees need Heedi saplings. Overload's complete six-extreme-potion chain, including extreme necromancy, plus torstol is not fully verified as renewable on the island. A high Herblore level alone does not solve that supply chain. [Wiki: bane](https://runescape.wiki/w/Bane_equipment?oldid=37173287), [apex](https://runescape.wiki/w/Apex_leather?oldid=37171838), [masterwork ranged](https://runescape.wiki/w/Masterwork_ranged_equipment?oldid=37199874), [masterwork magic](https://runescape.wiki/w/Masterwork_magic_equipment?oldid=37165818), [sapling](https://runescape.wiki/w/Heedi%27s_eternal_magic_sapling?oldid=37126306), [overload](https://runescape.wiki/w/Overload?oldid=37136479); local L2.

The biggest unresolved start routes are **Construction 20→30, Slayer 5→28→77, Divination 5→77 and Archaeology 20→52**. Agility, Runecrafting and Dungeoneering also lack a verified low-level repeatable local route. Remote Slayer assignments, lamps, global rewards or imported supplies could change these conclusions; this report does not assume those exceptions.


## Bosses and possible soft locks

"Hard gate" means a stated quest, level, item or access requirement. "Likely soft lock" is an assessment of whether the duo can reasonably complete the content with island supplies. A recommended equipment tier is not proof of an immunity threshold.

| Content | Verified gate and difficulty | Island-only assessment | Evidence |
| --- | --- | --- | --- |
| **Ivar, King of Bones** | Visions completion. 40,000 life points; guide recommends T50 gear, combat/Defence 50 and Prayer 37. | No equipment soft lock established. Learning mechanics and supplying food still matter. | [Boss](https://runescape.wiki/w/Ivar,_King_of_Bones?oldid=37203052), [strategy](https://runescape.wiki/w/Ivar,_King_of_Bones/Strategies?oldid=37046554); local Hollow Hill record L1/L5. |
| **Silverquill, the Dreadhog** | Members + Hearts of Sanguine completed; 80,000 life points. Guide recommends T50 gear and Prayer 37. | No immunity requiring high outside gear established. Havensilver helps; reflection phases and tumour priorities punish careless fighting. | [Boss](https://runescape.wiki/w/Silverquill,_the_Dreadhog?oldid=37203949), [strategy](https://runescape.wiki/w/Silverquill,_the_Dreadhog/Strategies?oldid=37198106). |
| **Heralds story fight** | Prerequisite quests; 51 Crafting, 55 Herblore, 65 Mining, 60 Smithing. Combat 110 is recommended. | Quest/supply gates may block it first. The story encounter has NPC shields against charged attacks; it is not the repeatable endgame fight. | [Heralds of Crimson](https://runescape.wiki/w/Heralds_of_Crimson?oldid=37204059), [quick guide](https://runescape.wiki/w/Heralds_of_Crimson/Quick_guide?oldid=37204093). |
| **Ghrazi Blood Knights**, entered from **18997** | **Heralds completion**, Crimson Gate access, two players on this snapshot. Normal shared life points are 1.75 million plus the heart phase. Strategy recommends 99 combat skills, T95 weapon/armour, 95 Prayer, overloads and perks. | **Likely major practical soft lock** with strict island-only supplies. Outside prayer/ability unlocks, restoration, augment/perk and potion chains are at least as concerning as the equipment tier. No island-only kill test establishes impossibility. | [Ghrazi](https://runescape.wiki/w/The_Ghrazi_Blood_Knights?oldid=37204958), [strategy](https://runescape.wiki/w/The_Ghrazi_Blood_Knights/Strategies?oldid=37204940), [gate](https://runescape.wiki/w/Crimson_Gate?oldid=37203635); chunk L3. |

The repeatable Ghrazi encounter was released **12 October 2026**, the report date. The Wiki describes it as duo-only, with solo planned for 9 November. This is a release-day snapshot and the strategy page is incomplete; refresh before deciding a boss obligation. [Wiki: Ghrazi Blood Knights](https://runescape.wiki/w/The_Ghrazi_Blood_Knights?oldid=37204958).

Player 2's "Shurik Ba" is **Shuruk-Ba**, and the boss is **the Ghrazi Blood Knights**. The exact Crimson Gate coordinate confirms 18997. Killing the story version does not show that the repeatable fight is viable. The normal fight requires aggression swaps, keeping the knights separated, protection-prayer changes, heart/tumour coordination and avoiding lethal floor attacks. Karmina's accumulating bleed is not cleared by Freedom. [Wiki: gate](https://runescape.wiki/w/Crimson_Gate?oldid=37203635), [strategy](https://runescape.wiki/w/The_Ghrazi_Blood_Knights/Strategies?oldid=37204940).

Havensilver +2 is **T60**, with a **50% bonus against Sanguine**. The September update changed non-havensilver weapons to normal damage, so lack of havensilver is not a proven immunity lock. Renewable local Smithing and later Hunter rewards also prevent us from declaring T60 an absolute island gear ceiling. The boss's T95 crossbows and other drops cannot supply the first kill. [Wiki: havensilver weapons](https://runescape.wiki/w/Havensilver_weapons?oldid=37201352), [Ghrazi drops](https://runescape.wiki/w/The_Ghrazi_Blood_Knights?oldid=37204958); assessment based on the training inventory above.

Local antisanguine offers 20% protection for six minutes, at 15 Herblore after Hearts; super antisanguine offers 40% for six minutes at 55 Herblore with Heralds progress, an unfinished kwuarm potion and exalted essence. These reduce the supply problem without guaranteeing a kill. [Wiki: antisanguine](https://runescape.wiki/w/Antisanguine?oldid=37195780), [super antisanguine](https://runescape.wiki/w/Super_antisanguine?oldid=37195781).

Entrance mapping has two separate uncertainties. Ivar's **Bonepile** surface point is in **17205**, while our retained Hollow Hill connection is 17206. Silverquill's exact **Cave ventricle** is inside Blighted Cave, picker interior **56**; the boss page's surface overview point does not verify that surface entrance. Use the actual unlocked route rather than copying a boss marker into a surface bank roll. [Local: L1, L5; Wiki: Bonepile](https://runescape.wiki/w/Bone_pile_(Hollow_Hill)?oldid=37025700), [Cave ventricle](https://runescape.wiki/w/Cave_ventricle?oldid=37194179).

## Machine-readable handoff and remaining unknowns

The companion [members-start-banks.2026-10-12.v1.json](members-start-banks.2026-10-12.v1.json) separates safe pools, conditional choices, the optional F2P extension and excluded services. Each candidate has `chunkId`, `place`, `bank`, `requirementsNote` and `source`. Chunk IDs are strings, matching our map's identifiers. These are research lists; no random-bank feature or progress reset was added.

Roll **unique chunk IDs**, not booths or tellers, unless both players deliberately choose a bank-weighted rule. Keep eligibility personal: Player 2's quest, achievement or level does not establish Player 1's access, or vice versa. Interior banks use a documented surface entry chunk and say so; uncertain interior routes remain outside the safe pool.

The remaining limits are concrete: no live character visits, no proof of the whole geographic boundary of unnamed fragments, incomplete eastern retained resources, unknown finishing levels and supplies, and no demonstration of an island-only Ghrazi kill. Missing training routes are labelled as missing evidence rather than impossible. Recheck quest stages, roaming NPC positions and release-day boss mechanics before using conditional entries in an automatic roller.
