# Monster membership review — October 12, 2026

All 1,199 retained Monster labels have a recorded decision. This review re-read the 870 exact pinned revisions behind 895 existing policies and fetched current pages for all 304 formerly unresolved labels. The existing known policies remain separate from the focused runtime overlay.

| Formerly unresolved labels | Count |
| --- | ---: |
| Verified member | 214 |
| Verified free | 62 |
| Reviewed mixed family | 28 |
| Family identity unreviewed | 0 |
| Total | 304 |

A mixed family is an identified source with explicit variant evidence. It has no global Boolean restriction. A missing identity is a different limitation. Both keep their existing geographic, quest, source and drop-row gates. A free intrinsic flag never grants entry to a member room, completes a quest, supplies a member item or makes every drop free.

The parser reads every typed Monster entity independently, including entities inside a Multi infobox. It uses fields at the entity's own depth and records each variant's membership and numeric NPC IDs. It never takes a membership field from a nested recipe or from an unrelated Item infobox. Named NPC exceptions are explicit reviews of the retained entity; they do not create combat capabilities. Ragnar, the troll parents, Tarik, Veliaf Hurtz, the three poison frogs, Croesus, the Gate of Elidinis, Villager and Customs Officer are retained under Monster even though their precise Wiki entity uses an NPC infobox.

The known audit found 894 labels whose typed Monster infoboxes unanimously preserve the prior policy. Goblin is the exception: ordinary Varrock/Port Sarim entities are free, while North-West Kandarin and member-area entities are members-only. Its ordinary free policy is retained and the family disagreement is recorded. It does not justify a global member ban or establish free access to every goblin variant.

Normal Rasial and Hermod are intrinsically free in the pinned variants. Their articles explicitly document F2P combat after prior member quest completion, following the July 2025 update. The ordinary repeatable source selects Normal; Alpha vs Omega and The Spirit of War remain separate quest requirements. Skill, quest, item and location gates still run.

The overlay changes intrinsic membership admission only. It does not move a source, rewrite a quantity or drop, alter a save, or infer spawned NPCs from cache names. The decoded cache is used only to corroborate exact NPC IDs where an infobox omits its name; its missing membership fields do not supply any decision. All runtime restrictions remain inactive when F2P is off.

The remaining exact-spawn limits are explicit below. A reviewed mixed family still needs a precise entity or location policy to exclude a member variant inside an otherwise accessible area. Family review does not claim that every authored placement has been reconciled to a current spawn ID.

| Retained label | Exact identity limit | Reviewed membership scope |
| --- | --- | --- |
| Troll | Family or activity membership is reviewed. The retained label does not establish an exact spawned NPC ID, combat capability or individual variant. | The Troll disambiguation identifies free combat trolls alongside member NPC-only troll entities. Troll brute and Mountain troll are explicitly free; Barendir trolls are member NPCs with Examine only. The unnamed retained placement (3413) has no NPC ID. This cross-kind family is mixed, while the exact retained combat identity remains unresolved; no global member ban is justified. |
| Elf | Family or activity membership is reviewed. The retained label does not establish an exact spawned NPC ID, combat capability or individual variant. | The sole authored Elf placement is Arandar (9267-1). Both the attackable Elf warrior family and the unattackable Arandar Elf warrior NPC are explicitly members-only. This consensus decides the retained source membership without choosing an NPC ID or asserting attackability. |
| Guard | Family or activity membership is reviewed. The retained label does not establish an exact spawned NPC ID, combat capability or individual variant. | The main Guard article explicitly names six combat/pickpocket subfamilies, with free and member Monster infoboxes. The unnamed retained placements do not choose a city or NPC ID, so only mixed-family classification is justified. |
| Monsters in Daemonheim | Family or activity membership is reviewed. The retained label does not establish an exact spawned NPC ID, combat capability or individual variant. | This is a monster aggregate inside Dungeoneering, not a single NPC. Dungeoneering explicitly admits both F2P and members and has member content scopes. The monster list identifies the family; it does not select an individual spawn, NPC ID or floor. |

## Reproduction and provenance

Run the four gatherers and then the focused builder from the repository root:

```powershell
node scripts/gather-monster-membership.2026-10-12.v1.mjs
node scripts/gather-monster-membership-identities.2026-10-12.v1.mjs
node scripts/gather-known-monster-membership.2026-10-12.v1.mjs
node scripts/gather-monster-membership-family-revisions.2026-10-12.v1.mjs
node scripts/build-monster-membership.2026-10-12.v1.mjs
```

Requests use only the public RuneScape Wiki API, at most 40 titles or revisions per batch. Five searches return at most five titles each. Snapshots are local research evidence under .local/game-data/monster-membership-2026-10-12-v1. The generated dataset records retained input and generator hashes, exact snapshot hashes and the manifest hash. Repository text hashes normalize CRLF to LF; external snapshot hashes preserve original bytes. The focused builder produces both this review and app/data/monster-membership-review.2026-10-12.v1.json. Generated files must not be edited by hand.

## Exact identity and variant treatments

| Retained label | Identity or variant treatment | Pinned page |
| --- | --- | --- |
| Troll | The Troll disambiguation identifies free combat trolls alongside member NPC-only troll entities. Troll brute and Mountain troll are explicitly free; Barendir trolls are member NPCs with Examine only. The unnamed retained placement (3413) has no NPC ID. This cross-kind family is mixed, while the exact retained combat identity remains unresolved; no global member ban is justified. | [Troll (disambiguation), 36767334](https://runescape.wiki/w/Special:PermanentLink/36767334) |
| Warrior | Retained West Rellekka placement and the Rellekka resident cluster select Warrior (Rellekka), whose Monster name is Warrior; unrelated Lost City and Citadel warriors are not used. | [Warrior (Rellekka), 37143101](https://runescape.wiki/w/Special:PermanentLink/37143101) |
| Shadow | Both retained placements explicitly name Mourner Tunnels & Temple of Light, selecting Shadow (Temple of Light) rather than other shadow encounters. | [Shadow (Temple of Light), 37171400](https://runescape.wiki/w/Special:PermanentLink/37171400) |
| Lava monster | The retained TzHaar Caves label pairs two Lava monsters with two Fire monsters; the TokTz-Ket-Dill monster article documents that quest-cave entity rather than Elder Kiln or Lava Flow Mine variants. | [Lava monster (TokTz-Ket-Dill), 37161419](https://runescape.wiki/w/Special:PermanentLink/37161419) |
| Crawling hand#Burthorpe | The page explicitly identifies Burthorpe Slayer Cave and ID 1648 (Level 6 (1)) as the free variant; all other hand variants remain separate. | [Crawling hand, 37142212](https://runescape.wiki/w/Special:PermanentLink/37142212) |
| Elf | The sole authored Elf placement is Arandar (9267-1). Both the attackable Elf warrior family and the unattackable Arandar Elf warrior NPC are explicitly members-only. This consensus decides the retained source membership without choosing an NPC ID or asserting attackability. | [Elf, 37005158](https://runescape.wiki/w/Special:PermanentLink/37005158) |
| Soldier | The retained West Yanille section contains Colonel Radick and 16 Soldiers; Soldier (Yanille) documents that attackable Yanille troop. | [Soldier (Yanille), 37144004](https://runescape.wiki/w/Special:PermanentLink/37144004) |
| Penguin | The typed Penguin (monster) documents the attackable Here Be Penguins and Ardougne Zoo entities. Item, race, hunter and Hide and Seek homonyms are excluded. | [Penguin (monster), 37144625](https://runescape.wiki/w/Special:PermanentLink/37144625) |
| Thora | Thora (Miscellania Castle) is the typed attackable Monster entity; Thora (Miscellania Dungeon) and Thora the Barkeep are NPC homonyms and do not supply this policy. | [Thora (Miscellania Castle), 37143948](https://runescape.wiki/w/Special:PermanentLink/37143948) |
| Archer | All six retained Archers occur at authored Ardougne Castle (10291), matching the six castle archers on Archer (Ardougne); Burthorpe NPC archers are not used. | [Archer (Ardougne), 37131704](https://runescape.wiki/w/Special:PermanentLink/37131704) |
| Guard | The main Guard article explicitly names six combat/pickpocket subfamilies, with free and member Monster infoboxes. The unnamed retained placements do not choose a city or NPC ID, so only mixed-family classification is justified. | [Guard, 37197696](https://runescape.wiki/w/Special:PermanentLink/37197696) |
| Rock | The uniquely typed Rock (monster) names the attackable Death Plateau troll. The Rocks scenery redirect is excluded; the source remains intrinsically free. | [Rock (monster), 37144710](https://runescape.wiki/w/Special:PermanentLink/37144710) |
| Dwarf#Keldagrim | The exact Keldagrim drop family is documented as the Standard (2), ID 120 entity. Its own infobox member field is Yes. | [Dwarf, 37135840](https://runescape.wiki/w/Special:PermanentLink/37135840) |
| Twig | The named Troll Stronghold placement and the typed Twig (monster) identify the guard troll, excluding the human and item homonyms. | [Twig (monster), 37161612](https://runescape.wiki/w/Special:PermanentLink/37161612) |
| Jungle spider#Jade Vine Maze | The retained selector selects both Jade Vine variants (IDs 6377 and 6376), each explicitly members-only; the free Musa Point variant is excluded. | [Jungle spider, 37179970](https://runescape.wiki/w/Special:PermanentLink/37179970) |
| Cow#Burthorpe | The ordinary Burthorpe cattle select Standard variants with free fields and IDs 81/14997/14998/14999. The member Zanaris entity (3309) is excluded. | [Cow, 37142844](https://runescape.wiki/w/Special:PermanentLink/37142844) |
| Suspicious water | The pinned Spinolyp article explicitly describes transformation into level 15 Suspicious water; this is an entity-state alias, not a guess from a water scenery name. | [Spinolyp, 37143989](https://runescape.wiki/w/Special:PermanentLink/37143989) |
| Mummy | Retained Chaos Tunnels (12629) and Jaldraocht Pyramid (12945) match Mummy (Jaldraocht Pyramid), IDs 1960..1968. The pinned Little Helper Pyramid redirect identifies the remaining 13199 placement as Klenter's Pyramid, matching Mummy (Klenter's Pyramid), IDs 2015..2019. Both entities are member; this consensus covers every retained placement. | [Mummy, 36850104](https://runescape.wiki/w/Special:PermanentLink/36850104) |
| Bandit | The only retained placement is Tumeken's Remnant (13102-1). Bandit (Kharidian Desert Bandit Camp) explicitly documents the same bandits extending to Tumeken's Remnant, with IDs 1926/1931 and members Yes. | [Bandit (Kharidian Desert Bandit Camp), 37156901](https://runescape.wiki/w/Special:PermanentLink/37156901) |
| False User | Both authored placements explicitly name Zamorak's hideout. False User (One of a Kind) names the attackable apparitions found there; the generic lore term is excluded. | [False User (One of a Kind), 37166343](https://runescape.wiki/w/Special:PermanentLink/37166343) |
| The Untouchable | The only authored source is Dominion Tower (14950). The pinned Dominion Tower variant has members No and IDs 14485/14556; Dream Mentor remains a separate member variant. | [The Untouchable, 37143293](https://runescape.wiki/w/Special:PermanentLink/37143293) |
| Bull | Retained Marigold Farm (16947) selects the typed wild Bull (monster) in Havenhythe, which is free. The Player Owned Farm Bull NPC/item page is excluded. | [Bull (monster), 37155955](https://runescape.wiki/w/Special:PermanentLink/37155955) |
| Rasial, the First Necromancer | The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states normal F2P combat since July 2025 after prior member quest completion; Alpha vs Omega remains a member quest. | [Rasial, the First Necromancer, 37182383](https://runescape.wiki/w/Special:PermanentLink/37182383) |
| Hermod, the Spirit of War | The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states F2P combat since July 2025 after prior The Spirit of War completion; the quest variant remains member. | [Hermod, the Spirit of War, 37182384](https://runescape.wiki/w/Special:PermanentLink/37182384) |
| Monsters in Daemonheim | This is a monster aggregate inside Dungeoneering, not a single NPC. Dungeoneering explicitly admits both F2P and members and has member content scopes. The monster list identifies the family; it does not select an individual spawn, NPC ID or floor. | [Dungeoneering, 37168496](https://runescape.wiki/w/Special:PermanentLink/37168496) |

## Decisions for all 304 formerly unresolved labels

| Retained label | Decision | Pinned page | Identity treatment |
| --- | --- | --- | --- |
| Troll | Reviewed mixed family | [Troll (disambiguation), 36767334](https://runescape.wiki/w/Special:PermanentLink/36767334) | The Troll disambiguation identifies free combat trolls alongside member NPC-only troll entities. Troll brute and Mountain troll are explicitly free; Barendir trolls are member NPCs with Examine only. The unnamed retained placement (3413) has no NPC ID. This cross-kind family is mixed, while the exact retained combat identity remains unresolved; no global member ban is justified. |
| Rabbit | Reviewed mixed family | [Rabbit, 37198590](https://runescape.wiki/w/Special:PermanentLink/37198590) | canonical-monster-name-and-page-qualifier |
| Monk of Zamorak | Reviewed mixed family | [Monk of Zamorak, 37143811](https://runescape.wiki/w/Special:PermanentLink/37143811) | canonical-monster-name-and-page-qualifier |
| Dwarf | Reviewed mixed family | [Dwarf, 37135840](https://runescape.wiki/w/Special:PermanentLink/37135840) | canonical-monster-name-and-page-qualifier |
| Warrior | Member | [Warrior (Rellekka), 37143101](https://runescape.wiki/w/Special:PermanentLink/37143101) | Retained West Rellekka placement and the Rellekka resident cluster select Warrior (Rellekka), whose Monster name is Warrior; unrelated Lost City and Citadel warriors are not used. |
| Foal (black) | Member | [Foal (black), 37143158](https://runescape.wiki/w/Special:PermanentLink/37143158) | canonical-monster-name-and-page-qualifier |
| Moss giant | Reviewed mixed family | [Moss giant, 37143822](https://runescape.wiki/w/Special:PermanentLink/37143822) | canonical-monster-name-and-page-qualifier |
| Spider | Reviewed mixed family | [Spider, 37145366](https://runescape.wiki/w/Special:PermanentLink/37145366) | canonical-monster-name-and-page-qualifier |
| Chaos dwarf hand cannoneer | Member | [Chaos dwarf hand cannoneer, 37148505](https://runescape.wiki/w/Special:PermanentLink/37148505) | canonical-Wiki-and-cache-NPC-ID |
| Chaos dwarf (Chaos Dwarf Battlefield) | Member | [Chaos dwarf (Chaos Dwarf Battlefield), 37167008](https://runescape.wiki/w/Special:PermanentLink/37167008) | canonical-monster-name-and-page-qualifier |
| Shadow | Member | [Shadow (Temple of Light), 37171400](https://runescape.wiki/w/Special:PermanentLink/37171400) | Both retained placements explicitly name Mourner Tunnels & Temple of Light, selecting Shadow (Temple of Light) rather than other shadow encounters. |
| Wolf | Reviewed mixed family | [Wolf, 37143180](https://runescape.wiki/w/Special:PermanentLink/37143180) | canonical-monster-name-and-page-qualifier |
| Rat | Reviewed mixed family | [Rat, 37166351](https://runescape.wiki/w/Special:PermanentLink/37166351) | canonical-monster-name-and-page-qualifier |
| Knight of Ardougne (West Ardougne) | Member | [Knight of Ardougne (West Ardougne), 37136070](https://runescape.wiki/w/Special:PermanentLink/37136070) | canonical-monster-name-and-page-qualifier |
| Zombie (Stronghold of Security) | Free | [Zombie (Stronghold of Security), 37142917](https://runescape.wiki/w/Special:PermanentLink/37142917) | canonical-monster-name-and-page-qualifier |
| Cow | Reviewed mixed family | [Cow, 37142844](https://runescape.wiki/w/Special:PermanentLink/37142844) | canonical-monster-name-and-page-qualifier |
| Ram | Free | [Ram, 37144697](https://runescape.wiki/w/Special:PermanentLink/37144697) | canonical-monster-name-and-page-qualifier |
| Lava monster | Member | [Lava monster (TokTz-Ket-Dill), 37161419](https://runescape.wiki/w/Special:PermanentLink/37161419) | The retained TzHaar Caves label pairs two Lava monsters with two Fire monsters; the TokTz-Ket-Dill monster article documents that quest-cave entity rather than Elder Kiln or Lava Flow Mine variants. |
| Crystal skillchompa | Free | [Crystal skillchompa (Hunter), 37142233](https://runescape.wiki/w/Special:PermanentLink/37142233) | canonical-monster-name-and-page-qualifier |
| Grizzly bear | Reviewed mixed family | [Grizzly bear, 37145895](https://runescape.wiki/w/Special:PermanentLink/37145895) | canonical-monster-name-and-page-qualifier |
| Elf warrior#Elf Camp | Member | [Elf warrior, 37170391](https://runescape.wiki/w/Special:PermanentLink/37170391) | canonical-monster-name-and-page-qualifier |
| Pirate | Reviewed mixed family | [Pirate, 37139614](https://runescape.wiki/w/Special:PermanentLink/37139614) | canonical-monster-name-and-page-qualifier |
| Crawling hand#Burthorpe | Free | [Crawling hand, 37142212](https://runescape.wiki/w/Special:PermanentLink/37142212) | The page explicitly identifies Burthorpe Slayer Cave and ID 1648 (Level 6 (1)) as the free variant; all other hand variants remain separate. |
| Demon Boss | Member | [Demon boss, 37186383](https://runescape.wiki/w/Special:PermanentLink/37186383) | canonical-monster-name-and-page-qualifier |
| Elf warrior#Lletya | Member | [Elf warrior, 37170391](https://runescape.wiki/w/Special:PermanentLink/37170391) | canonical-monster-name-and-page-qualifier |
| Elf | Member | [Elf, 37005158](https://runescape.wiki/w/Special:PermanentLink/37005158) | The sole authored Elf placement is Arandar (9267-1). Both the attackable Elf warrior family and the unattackable Arandar Elf warrior NPC are explicitly members-only. This consensus decides the retained source membership without choosing an NPC ID or asserting attackability. |
| Chinchompa | Free | [Chinchompa (Hunter), 37157357](https://runescape.wiki/w/Special:PermanentLink/37157357) | canonical-monster-name-and-page-qualifier |
| Skeleton Mage (Piscatoris Fishing Colony) | Member | [Skeleton Mage (Piscatoris Fishing Colony), 37183787](https://runescape.wiki/w/Special:PermanentLink/37183787) | canonical-monster-name-and-page-qualifier |
| Hobgoblin#Armed | Free | [Hobgoblin, 37134604](https://runescape.wiki/w/Special:PermanentLink/37134604) | canonical-monster-name-and-page-qualifier |
| Goblin#Drop table 2 | Reviewed mixed family | [Goblin, 37143473](https://runescape.wiki/w/Special:PermanentLink/37143473) | canonical-monster-name-and-page-qualifier |
| Tortoise#With riders | Member | [Tortoise, 37133379](https://runescape.wiki/w/Special:PermanentLink/37133379) | exact-infobox-variant |
| Giant bat | Reviewed mixed family | [Giant bat, 37156298](https://runescape.wiki/w/Special:PermanentLink/37156298) | canonical-monster-name-and-page-qualifier |
| Zombie#Level 12 | Free | [Zombie, 37125135](https://runescape.wiki/w/Special:PermanentLink/37125135) | exact-infobox-variant |
| Zombie#Level 29 | Free | [Zombie, 37125135](https://runescape.wiki/w/Special:PermanentLink/37125135) | exact-infobox-variant |
| Man (West Ardougne, attackable) | Member | [Man (West Ardougne, attackable), 37144279](https://runescape.wiki/w/Special:PermanentLink/37144279) | canonical-monster-name-and-page-qualifier |
| Woman (West Ardougne) | Member | [Woman (West Ardougne), 37143200](https://runescape.wiki/w/Special:PermanentLink/37143200) | canonical-monster-name-and-page-qualifier |
| Hobgoblin#Unarmed | Free | [Hobgoblin, 37134604](https://runescape.wiki/w/Special:PermanentLink/37134604) | canonical-monster-name-and-page-qualifier |
| Cobalt skillchompa | Free | [Cobalt skillchompa (Hunter), 37142065](https://runescape.wiki/w/Special:PermanentLink/37142065) | canonical-monster-name-and-page-qualifier |
| Lumbridge guard | Free | [Lumbridge guard (attackable), 37143943](https://runescape.wiki/w/Special:PermanentLink/37143943) | canonical-monster-name-and-page-qualifier |
| Undead pekin | Member | [Undead pekin, 37139555](https://runescape.wiki/w/Special:PermanentLink/37139555) | canonical-Wiki-and-cache-NPC-ID |
| Soldier | Member | [Soldier (Yanille), 37144004](https://runescape.wiki/w/Special:PermanentLink/37144004) | The retained West Yanille section contains Colonel Radick and 16 Soldiers; Soldier (Yanille) documents that attackable Yanille troop. |
| Goblin#Drop table 1 | Reviewed mixed family | [Goblin, 37143473](https://runescape.wiki/w/Special:PermanentLink/37143473) | canonical-monster-name-and-page-qualifier |
| Guard (dwarf) | Free | [Guard (dwarf), 37139718](https://runescape.wiki/w/Special:PermanentLink/37139718) | canonical-monster-name-and-page-qualifier |
| Barbarian#Version 1 | Free | [Barbarian, 37135672](https://runescape.wiki/w/Special:PermanentLink/37135672) | canonical-monster-name-and-page-qualifier |
| Barbarian#Version 2 | Free | [Barbarian, 37135672](https://runescape.wiki/w/Special:PermanentLink/37135672) | canonical-monster-name-and-page-qualifier |
| Penguin | Member | [Penguin (monster), 37144625](https://runescape.wiki/w/Special:PermanentLink/37144625) | The typed Penguin (monster) documents the attackable Here Be Penguins and Ardougne Zoo entities. Item, race, hunter and Hide and Seek homonyms are excluded. |
| Ragnar | Member | [Ragnar, 37123914](https://runescape.wiki/w/Special:PermanentLink/37123914) | explicit-reviewed-retained-NPC-entity |
| Thora | Member | [Thora (Miscellania Castle), 37143948](https://runescape.wiki/w/Special:PermanentLink/37143948) | Thora (Miscellania Castle) is the typed attackable Monster entity; Thora (Miscellania Dungeon) and Thora the Barkeep are NPC homonyms and do not supply this policy. |
| Rooster | Reviewed mixed family | [Rooster, 37144461](https://runescape.wiki/w/Special:PermanentLink/37144461) | canonical-monster-name-and-page-qualifier |
| Soldier (Yanille) | Member | [Soldier (Yanille), 37144004](https://runescape.wiki/w/Special:PermanentLink/37144004) | canonical-monster-name-and-page-qualifier |
| Monk (Ardougne) | Member | [Monk (Ardougne), 37137973](https://runescape.wiki/w/Special:PermanentLink/37137973) | canonical-monster-name-and-page-qualifier |
| Man (East Ardougne) | Free | [Man (East Ardougne), 37156841](https://runescape.wiki/w/Special:PermanentLink/37156841) | canonical-monster-name-and-page-qualifier |
| Woman (East Ardougne) | Free | [Woman (East Ardougne), 37156843](https://runescape.wiki/w/Special:PermanentLink/37156843) | canonical-monster-name-and-page-qualifier |
| Archer | Member | [Archer (Ardougne), 37131704](https://runescape.wiki/w/Special:PermanentLink/37131704) | All six retained Archers occur at authored Ardougne Castle (10291), matching the six castle archers on Archer (Ardougne); Burthorpe NPC archers are not used. |
| Guard (Ardougne) | Member | [Guard (Ardougne), 37156881](https://runescape.wiki/w/Special:PermanentLink/37156881) | canonical-monster-name-and-page-qualifier |
| Guard (H.A.M.) | Member | [Guard (H.A.M.), 37166039](https://runescape.wiki/w/Special:PermanentLink/37166039) | canonical-monster-name-and-page-qualifier |
| Poison spider | Reviewed mixed family | [Poison spider, 37168908](https://runescape.wiki/w/Special:PermanentLink/37168908) | canonical-monster-name-and-page-qualifier |
| Thief | Reviewed mixed family | [Thief, 37144513](https://runescape.wiki/w/Special:PermanentLink/37144513) | canonical-monster-name-and-page-qualifier |
| Jungle spider | Reviewed mixed family | [Jungle spider, 37179970](https://runescape.wiki/w/Special:PermanentLink/37179970) | canonical-monster-name-and-page-qualifier |
| Necromancer (monster) | Member | [Necromancer (monster), 37137924](https://runescape.wiki/w/Special:PermanentLink/37137924) | canonical-monster-name-and-page-qualifier |
| Freygerd (Rellekka) | Member | [Freygerd (Rellekka), 37156897](https://runescape.wiki/w/Special:PermanentLink/37156897) | canonical-monster-name-and-page-qualifier |
| Lensa (Rellekka) | Member | [Lensa (Rellekka), 37156896](https://runescape.wiki/w/Special:PermanentLink/37156896) | canonical-monster-name-and-page-qualifier |
| Market Guard (Fremennik) | Member | [Market Guard (Fremennik), 37144549](https://runescape.wiki/w/Special:PermanentLink/37144549) | canonical-monster-name-and-page-qualifier |
| Warrior (Rellekka) | Member | [Warrior (Rellekka), 37143101](https://runescape.wiki/w/Special:PermanentLink/37143101) | canonical-monster-name-and-page-qualifier |
| Chick (monster) | Free | [Chick (monster), 37172229](https://runescape.wiki/w/Special:PermanentLink/37172229) | canonical-monster-name-and-page-qualifier |
| Giant skeleton | Member | [Giant skeleton, 17801923](https://runescape.wiki/w/Special:PermanentLink/17801923) | explicit-composed-encounter-or-retained-entity-consensus |
| Guard | Reviewed mixed family | [Guard, 37197696](https://runescape.wiki/w/Special:PermanentLink/37197696) | The main Guard article explicitly names six combat/pickpocket subfamilies, with free and member Monster infoboxes. The unnamed retained placements do not choose a city or NPC ID, so only mixed-family classification is justified. |
| Foal (white) | Member | [Foal (white), 37143160](https://runescape.wiki/w/Special:PermanentLink/37143160) | canonical-monster-name-and-page-qualifier |
| Azure skillchompa | Free | [Azure skillchompa (Hunter), 37142704](https://runescape.wiki/w/Special:PermanentLink/37142704) | canonical-monster-name-and-page-qualifier |
| Guard (cave goblin) | Member | [Guard (cave goblin), 37132043](https://runescape.wiki/w/Special:PermanentLink/37132043) | canonical-monster-name-and-page-qualifier |
| Hobgoblin#Unarmed, Karamja | Free | [Hobgoblin, 37134604](https://runescape.wiki/w/Special:PermanentLink/37134604) | canonical-monster-name-and-page-qualifier |
| Guard (Catherby) | Member | [Guard (Catherby), 37140954](https://runescape.wiki/w/Special:PermanentLink/37140954) | canonical-monster-name-and-page-qualifier |
| Mummy (Jaldraocht Pyramid) | Member | [Mummy (Jaldraocht Pyramid), 37176335](https://runescape.wiki/w/Special:PermanentLink/37176335) | canonical-monster-name-and-page-qualifier |
| The Kendal | Member | [The Kendal (monster), 37145899](https://runescape.wiki/w/Special:PermanentLink/37145899) | canonical-monster-name-and-page-qualifier |
| Skeleton#Armed | Free | [Skeleton, 37188293](https://runescape.wiki/w/Special:PermanentLink/37188293) | canonical-monster-name-and-page-qualifier |
| Monk (Entrana church) | Member | [Monk (Entrana church), 37143950](https://runescape.wiki/w/Special:PermanentLink/37143950) | canonical-monster-name-and-page-qualifier |
| Ice warrior | Reviewed mixed family | [Ice warrior, 37143337](https://runescape.wiki/w/Special:PermanentLink/37143337) | canonical-monster-name-and-page-qualifier |
| Rock | Free | [Rock (monster), 37144710](https://runescape.wiki/w/Special:PermanentLink/37144710) | The uniquely typed Rock (monster) names the attackable Death Plateau troll. The Rocks scenery redirect is excluded; the source remains intrinsically free. |
| Thrower Troll | Reviewed mixed family | [Thrower Troll, 37143942](https://runescape.wiki/w/Special:PermanentLink/37143942) | canonical-monster-name-and-page-qualifier |
| Troll father | Member | [Troll father, 37148364](https://runescape.wiki/w/Special:PermanentLink/37148364) | explicit-reviewed-retained-NPC-entity |
| Troll mother | Member | [Troll mother, 37148363](https://runescape.wiki/w/Special:PermanentLink/37148363) | explicit-reviewed-retained-NPC-entity |
| Hobgoblin (God Wars Dungeon) | Member | [Hobgoblin (God Wars Dungeon), 37143588](https://runescape.wiki/w/Special:PermanentLink/37143588) | canonical-monster-name-and-page-qualifier |
| Elvarg | Reviewed mixed family | [Elvarg, 37140810](https://runescape.wiki/w/Special:PermanentLink/37140810) | canonical-monster-name-and-page-qualifier |
| Dwarf#Keldagrim | Member | [Dwarf, 37135840](https://runescape.wiki/w/Special:PermanentLink/37135840) | The exact Keldagrim drop family is documented as the Standard (2), ID 120 entity. Its own infobox member field is Yes. |
| Twig | Member | [Twig (monster), 37161612](https://runescape.wiki/w/Special:PermanentLink/37161612) | The named Troll Stronghold placement and the typed Twig (monster) identify the guard troll, excluding the human and item homonyms. |
| Jungle spider#Jade Vine Maze | Member | [Jungle spider, 37179970](https://runescape.wiki/w/Special:PermanentLink/37179970) | The retained selector selects both Jade Vine variants (IDs 6377 and 6376), each explicitly members-only; the free Musa Point variant is excluded. |
| Dark wizard#Young | Free | [Dark wizard, 37176644](https://runescape.wiki/w/Special:PermanentLink/37176644) | canonical-monster-name-and-page-qualifier |
| Dark wizard#Bearded | Free | [Dark wizard, 37176644](https://runescape.wiki/w/Special:PermanentLink/37176644) | canonical-monster-name-and-page-qualifier |
| Cow#Burthorpe | Free | [Cow, 37142844](https://runescape.wiki/w/Special:PermanentLink/37142844) | The ordinary Burthorpe cattle select Standard variants with free fields and IDs 81/14997/14998/14999. The member Zanaris entity (3309) is excluded. |
| Rabbit (Burthorpe) | Free | [Rabbit (Burthorpe), 37154446](https://runescape.wiki/w/Special:PermanentLink/37154446) | canonical-monster-name-and-page-qualifier |
| Suspicious water | Member | [Spinolyp, 37143989](https://runescape.wiki/w/Special:PermanentLink/37143989) | The pinned Spinolyp article explicitly describes transformation into level 15 Suspicious water; this is an entity-state alias, not a guess from a water scenery name. |
| Shipyard worker | Member | [Shipyard worker, 37141950](https://runescape.wiki/w/Special:PermanentLink/37141950) | canonical-monster-name-and-page-qualifier |
| Guard (Falador) | Free | [Guard (Falador), 37156882](https://runescape.wiki/w/Special:PermanentLink/37156882) | canonical-monster-name-and-page-qualifier |
| Goblin (Goblin Village) | Free | [Goblin (Goblin Village), 37143271](https://runescape.wiki/w/Special:PermanentLink/37143271) | canonical-monster-name-and-page-qualifier |
| Blue dragon#Wilderness | Free | [Blue dragon, 37132802](https://runescape.wiki/w/Special:PermanentLink/37132802) | canonical-monster-name-and-page-qualifier |
| Green dragon#Wilderness | Free | [Green dragon, 37132803](https://runescape.wiki/w/Special:PermanentLink/37132803) | canonical-monster-name-and-page-qualifier |
| Demon Boss (Wilderness) | Member | [Demon boss, 37186383](https://runescape.wiki/w/Special:PermanentLink/37186383) | canonical-monster-name-and-page-qualifier |
| Ghost (Spirit of Summer) | Member | [Ghost (Spirit of Summer), 37123991](https://runescape.wiki/w/Special:PermanentLink/37123991) | canonical-monster-name-and-page-qualifier |
| Crab | Reviewed mixed family | [Crab, 37163314](https://runescape.wiki/w/Special:PermanentLink/37163314) | canonical-monster-name-and-page-qualifier |
| Customs Officer | Free | [Customs officer, 37198107](https://runescape.wiki/w/Special:PermanentLink/37198107) | explicit-reviewed-retained-NPC-entity |
| Black Guard (Dwarven Mine entrance) | Free | [Black Guard (Dwarven Mine entrance), 37143086](https://runescape.wiki/w/Special:PermanentLink/37143086) | canonical-monster-name-and-page-qualifier |
| Guard (Edgeville) | Free | [Guard (Edgeville), 37156880](https://runescape.wiki/w/Special:PermanentLink/37156880) | canonical-monster-name-and-page-qualifier |
| Monk (Edgeville Monastery) | Free | [Monk (Edgeville Monastery), 37138026](https://runescape.wiki/w/Special:PermanentLink/37138026) | canonical-monster-name-and-page-qualifier |
| Skeleton (Dark Warriors' Fortress) | Free | [Skeleton (Dark Warriors' Fortress), 37124004](https://runescape.wiki/w/Special:PermanentLink/37124004) | canonical-monster-name-and-page-qualifier |
| Abyssal savages | Member | [Abyssal savage, 37156759](https://runescape.wiki/w/Special:PermanentLink/37156759) | canonical-monster-name-and-page-qualifier |
| Hellhound#Wilderness | Free | [Hellhound, 37196163](https://runescape.wiki/w/Special:PermanentLink/37196163) | canonical-monster-name-and-page-qualifier |
| Hydrix dragon#Wilderness | Member | [Hydrix dragon, 37188676](https://runescape.wiki/w/Special:PermanentLink/37188676) | canonical-monster-name-and-page-qualifier |
| Chaos dwarf (Wilderness) | Member | [Chaos dwarf, 37200599](https://runescape.wiki/w/Special:PermanentLink/37200599) | canonical-monster-name-and-page-qualifier |
| Lesser demon (Wizards' Tower) | Free | [Lesser demon (Wizards' Tower), 37159781](https://runescape.wiki/w/Special:PermanentLink/37159781) | canonical-monster-name-and-page-qualifier |
| Skeleton (Draynor Manor) | Free | [Skeleton (Draynor Manor), 37143713](https://runescape.wiki/w/Special:PermanentLink/37143713) | canonical-monster-name-and-page-qualifier |
| Skeleton#Unarmed | Free | [Skeleton, 37188293](https://runescape.wiki/w/Special:PermanentLink/37188293) | canonical-monster-name-and-page-qualifier |
| Crimson skillchompa | Free | [Crimson skillchompa (Hunter), 37131678](https://runescape.wiki/w/Special:PermanentLink/37131678) | canonical-monster-name-and-page-qualifier |
| Bandit (Kharidian Desert Bandit Camp) | Member | [Bandit (Kharidian Desert Bandit Camp), 37156901](https://runescape.wiki/w/Special:PermanentLink/37156901) | canonical-monster-name-and-page-qualifier |
| Goblin (Lumbridge) | Free | [Goblin (Lumbridge), 37143270](https://runescape.wiki/w/Special:PermanentLink/37143270) | canonical-monster-name-and-page-qualifier |
| Guard (Varrock) | Free | [Guard (Varrock), 37156879](https://runescape.wiki/w/Special:PermanentLink/37156879) | canonical-monster-name-and-page-qualifier |
| Greater demon#Wilderness | Free | [Greater demon, 37199607](https://runescape.wiki/w/Special:PermanentLink/37199607) | canonical-monster-name-and-page-qualifier |
| Mummy | Member | [Mummy, 36850104](https://runescape.wiki/w/Special:PermanentLink/36850104) | Retained Chaos Tunnels (12629) and Jaldraocht Pyramid (12945) match Mummy (Jaldraocht Pyramid), IDs 1960..1968. The pinned Little Helper Pyramid redirect identifies the remaining 13199 placement as Klenter's Pyramid, matching Mummy (Klenter's Pyramid), IDs 2015..2019. Both entities are member; this consensus covers every retained placement. |
| Crocodile#Level 77 | Member | [Crocodile, 37133378](https://runescape.wiki/w/Special:PermanentLink/37133378) | exact-infobox-variant |
| Lumbridge guardsman (Lumbridge Market) | Free | [Lumbridge guardsman (Lumbridge Market), 37131484](https://runescape.wiki/w/Special:PermanentLink/37131484) | canonical-monster-name-and-page-qualifier |
| Jonny the beard | Reviewed mixed family | [Jonny the beard, 37143789](https://runescape.wiki/w/Special:PermanentLink/37143789) | canonical-monster-name-and-page-qualifier |
| Zombie#Level 22 | Free | [Zombie, 37125135](https://runescape.wiki/w/Special:PermanentLink/37125135) | exact-infobox-variant |
| Zamorak mage (monster) | Member | [Zamorak mage (monster), 37142955](https://runescape.wiki/w/Special:PermanentLink/37142955) | canonical-monster-name-and-page-qualifier |
| Automaton (Heart of Gielinor) | Member | [Automaton (Heart of Gielinor), 37141947](https://runescape.wiki/w/Special:PermanentLink/37141947) | canonical-monster-name-and-page-qualifier |
| Necromancer | Member | [Necromancer (monster), 37137924](https://runescape.wiki/w/Special:PermanentLink/37137924) | canonical-monster-name-and-page-qualifier |
| Cave goblin (monster) | Member | [Cave goblin (monster), 37142018](https://runescape.wiki/w/Special:PermanentLink/37142018) | canonical-monster-name-and-page-qualifier |
| Bandit | Member | [Bandit (Kharidian Desert Bandit Camp), 37156901](https://runescape.wiki/w/Special:PermanentLink/37156901) | The only retained placement is Tumeken's Remnant (13102-1). Bandit (Kharidian Desert Bandit Camp) explicitly documents the same bandits extending to Tumeken's Remnant, with IDs 1926/1931 and members Yes. |
| Guard (Desert Mining Camp) | Member | [Guard (Desert Mining Camp), 37167037](https://runescape.wiki/w/Special:PermanentLink/37167037) | canonical-monster-name-and-page-qualifier |
| Zemouregal & Vorkath (Story Mode) | Member | [Zemouregal & Vorkath, 37182386](https://runescape.wiki/w/Special:PermanentLink/37182386) | explicit-composed-encounter-or-retained-entity-consensus |
| Zemouregal & Vorkath | Member | [Zemouregal & Vorkath, 37182386](https://runescape.wiki/w/Special:PermanentLink/37182386) | explicit-composed-encounter-or-retained-entity-consensus |
| Zemouregal & Vorkath (Hard Mode) | Member | [Zemouregal & Vorkath, 37182386](https://runescape.wiki/w/Special:PermanentLink/37182386) | explicit-composed-encounter-or-retained-entity-consensus |
| Kal'gerion demon#Wilderness | Member | [Kal'gerion demon, 37188966](https://runescape.wiki/w/Special:PermanentLink/37188966) | canonical-monster-name-and-page-qualifier |
| Cave crawler (Pollnivneach Slayer Dungeon) | Member | [Cave crawler (Pollnivneach Slayer Dungeon), 37142015](https://runescape.wiki/w/Special:PermanentLink/37142015) | canonical-monster-name-and-page-qualifier |
| Guard (Desert Minding Camp) | Member | [Guard (Desert Mining Camp), 37167037](https://runescape.wiki/w/Special:PermanentLink/37167037) | canonical-monster-name-and-page-qualifier |
| Crocodile#Level 40 | Member | [Crocodile, 37133378](https://runescape.wiki/w/Special:PermanentLink/37133378) | exact-infobox-variant |
| Mummy (Ullek) | Member | [Mummy (Ullek), 37176275](https://runescape.wiki/w/Special:PermanentLink/37176275) | canonical-monster-name-and-page-qualifier |
| Bandit (Pollnivneach) | Member | [Bandit (Pollnivneach), 37156903](https://runescape.wiki/w/Special:PermanentLink/37156903) | canonical-monster-name-and-page-qualifier |
| Villager | Member | [Villager, 37156846](https://runescape.wiki/w/Special:PermanentLink/37156846) | explicit-reviewed-retained-NPC-entity |
| Waterfiend#Wilderness | Member | [Waterfiend, 37171626](https://runescape.wiki/w/Special:PermanentLink/37171626) | canonical-monster-name-and-page-qualifier |
| Skeleton (Ullek) | Member | [Skeleton (Ullek), 37163170](https://runescape.wiki/w/Special:PermanentLink/37163170) | canonical-monster-name-and-page-qualifier |
| Tarik | Member | [Tarik, 37121321](https://runescape.wiki/w/Special:PermanentLink/37121321) | explicit-reviewed-retained-NPC-entity |
| Crawling hand | Reviewed mixed family | [Crawling hand, 37142212](https://runescape.wiki/w/Special:PermanentLink/37142212) | canonical-monster-name-and-page-qualifier |
| False User | Member | [False User (One of a Kind), 37166343](https://runescape.wiki/w/Special:PermanentLink/37166343) | Both authored placements explicitly name Zamorak's hideout. False User (One of a Kind) names the attackable apparitions found there; the generic lore term is excluded. |
| Veliaf Hurtz | Member | [Veliaf Hurtz, 37139300](https://runescape.wiki/w/Special:PermanentLink/37139300) | explicit-reviewed-retained-NPC-entity |
| Asyn Shadow | Member | [Asyn Shade, 37166880](https://runescape.wiki/w/Special:PermanentLink/37166880) | canonical-monster-name-and-page-qualifier |
| Vyrewatch (Darkmeyer) | Member | [Vyrewatch (Darkmeyer), 37169764](https://runescape.wiki/w/Special:PermanentLink/37169764) | canonical-monster-name-and-page-qualifier |
| Snake (Mos Le'Harmless) | Member | [Snake (Mos Le'Harmless), 37144521](https://runescape.wiki/w/Special:PermanentLink/37144521) | canonical-monster-name-and-page-qualifier |
| Monkey (Mos Le'Harmless) | Member | [Monkey (Mos Le'Harmless), 37143951](https://runescape.wiki/w/Special:PermanentLink/37143951) | canonical-monster-name-and-page-qualifier |
| Seagull#Icyene graveyard | Free | [Seagull, 37144484](https://runescape.wiki/w/Special:PermanentLink/37144484) | exact-infobox-variant |
| Viridian skillchompa | Free | [Viridian skillchompa (Hunter), 37143220](https://runescape.wiki/w/Special:PermanentLink/37143220) | canonical-monster-name-and-page-qualifier |
| Vyrewatch guard | Member | [Vyrewatch guard, 37166852](https://runescape.wiki/w/Special:PermanentLink/37166852) | canonical-monster-name-and-page-qualifier |
| Tortured soul (Port Phasmatys) | Member | [Tortured soul (Port Phasmatys), 37144525](https://runescape.wiki/w/Special:PermanentLink/37144525) | canonical-monster-name-and-page-qualifier |
| The Untouchable | Free | [The Untouchable, 37143293](https://runescape.wiki/w/Special:PermanentLink/37143293) | The only authored source is Dominion Tower (14950). The pinned Dominion Tower variant has members No and IDs 14485/14556; Dream Mentor remains a separate member variant. |
| Zombie pirate (Harmony Island) | Member | [Zombie pirate (Harmony Island), 37142876](https://runescape.wiki/w/Special:PermanentLink/37142876) | canonical-monster-name-and-page-qualifier |
| Crassian scout | Reviewed mixed family | [Crassian scout, 37166218](https://runescape.wiki/w/Special:PermanentLink/37166218) | canonical-monster-name-and-page-qualifier |
| Crassian warrior | Reviewed mixed family | [Crassian warrior, 37166216](https://runescape.wiki/w/Special:PermanentLink/37166216) | canonical-monster-name-and-page-qualifier |
| Wolf (Havenhythe) | Free | [Wolf (Havenhythe), 37161483](https://runescape.wiki/w/Special:PermanentLink/37161483) | canonical-monster-name-and-page-qualifier |
| Ripper dinosaurs | Member | [Ripper dinosaur, 37166870](https://runescape.wiki/w/Special:PermanentLink/37166870) | canonical-monster-name-and-page-qualifier |
| Bull | Free | [Bull (monster), 37155955](https://runescape.wiki/w/Special:PermanentLink/37155955) | Retained Marigold Farm (16947) selects the typed wild Bull (monster) in Havenhythe, which is free. The Player Owned Farm Bull NPC/item page is excluded. |
| Golden poison frog | Member | [Golden poison frog, 37145247](https://runescape.wiki/w/Special:PermanentLink/37145247) | explicit-reviewed-retained-NPC-entity |
| Phantasmal poison frog | Member | [Phantasmal poison frog, 37145851](https://runescape.wiki/w/Special:PermanentLink/37145851) | explicit-reviewed-retained-NPC-entity |
| Sky-blue poison frog | Member | [Sky-blue poison frog, 37147244](https://runescape.wiki/w/Special:PermanentLink/37147244) | explicit-reviewed-retained-NPC-entity |
| Mummy (Sophanem) | Member | [Mummy (Klenter's Pyramid), 37143421](https://runescape.wiki/w/Special:PermanentLink/37143421) | canonical-monster-name-and-page-qualifier |
| Icefiend (God Wars Dungeon) | Member | [Icefiend (God Wars Dungeon), 37143706](https://runescape.wiki/w/Special:PermanentLink/37143706) | canonical-monster-name-and-page-qualifier |
| Werewolf (God Wars Dungeon) | Member | [Werewolf (God Wars Dungeon), 37143129](https://runescape.wiki/w/Special:PermanentLink/37143129) | canonical-monster-name-and-page-qualifier |
| Bloodveld (God Wars Dungeon) | Member | [Bloodveld (God Wars Dungeon), 37142968](https://runescape.wiki/w/Special:PermanentLink/37142968) | canonical-monster-name-and-page-qualifier |
| Pyrefiend (God Wars Dungeon) | Member | [Pyrefiend (God Wars Dungeon), 37143869](https://runescape.wiki/w/Special:PermanentLink/37143869) | canonical-monster-name-and-page-qualifier |
| Gorak (God Wars Dungeon) | Member | [Gorak (God Wars Dungeon), 37143285](https://runescape.wiki/w/Special:PermanentLink/37143285) | canonical-monster-name-and-page-qualifier |
| Kree'arra (Hard Mode) | Member | [Kree'arra, 37171421](https://runescape.wiki/w/Special:PermanentLink/37171421) | exact-infobox-variant |
| Ogre (God Wars Dungeon) | Member | [Ogre (God Wars Dungeon), 37143794](https://runescape.wiki/w/Special:PermanentLink/37143794) | canonical-monster-name-and-page-qualifier |
| Hellhound (God Wars Dungeon) | Member | [Hellhound (God Wars Dungeon), 37143511](https://runescape.wiki/w/Special:PermanentLink/37143511) | canonical-monster-name-and-page-qualifier |
| Imp (God Wars Dungeon) | Member | [Imp (God Wars Dungeon), 37143715](https://runescape.wiki/w/Special:PermanentLink/37143715) | canonical-monster-name-and-page-qualifier |
| General Graardor (Hard Mode) | Member | [General Graardor, 37171419](https://runescape.wiki/w/Special:PermanentLink/37171419) | exact-infobox-variant |
| Jogre (God Wars Dungeon) | Member | [Jogre (God Wars Dungeon), 37143787](https://runescape.wiki/w/Special:PermanentLink/37143787) | canonical-monster-name-and-page-qualifier |
| Cyclops (God Wars Dungeon) | Member | [Cyclops (God Wars Dungeon), 37142286](https://runescape.wiki/w/Special:PermanentLink/37142286) | canonical-monster-name-and-page-qualifier |
| Goblin (God Wars Dungeon) | Member | [Goblin (God Wars Dungeon), 37143273](https://runescape.wiki/w/Special:PermanentLink/37143273) | canonical-monster-name-and-page-qualifier |
| Commander Zilyana (Hard Mode) | Member | [Commander Zilyana, 37171420](https://runescape.wiki/w/Special:PermanentLink/37171420) | exact-infobox-variant |
| K'ril Tsutsaroth (Hard Mode) | Member | [K'ril Tsutsaroth, 37171422](https://runescape.wiki/w/Special:PermanentLink/37171422) | exact-infobox-variant |
| Nex | Member | [Nex, 37152399](https://runescape.wiki/w/Special:PermanentLink/37152399) | canonical-Wiki-and-cache-NPC-ID |
| Zombie (Entrana Dungeon) | Free | [Zombie (Entrana Dungeon), 37143039](https://runescape.wiki/w/Special:PermanentLink/37143039) | canonical-monster-name-and-page-qualifier |
| Skeleton (Tarn's Lair)#Mid Level | Member | [Skeleton (Tarn's Lair), 37166358](https://runescape.wiki/w/Special:PermanentLink/37166358) | canonical-monster-name-and-page-qualifier |
| Zombie (Lair of Tarn Razorlor)#Low Level | Member | [Zombie (Lair of Tarn Razorlor), 37133441](https://runescape.wiki/w/Special:PermanentLink/37133441) | canonical-monster-name-and-page-qualifier |
| Dagannoth#Ranged | Member | [Dagannoth, 37134992](https://runescape.wiki/w/Special:PermanentLink/37134992) | canonical-monster-name-and-page-qualifier |
| Zamorak mage | Member | [Zamorak mage (monster), 37142955](https://runescape.wiki/w/Special:PermanentLink/37142955) | canonical-monster-name-and-page-qualifier |
| Giant skeleton (Tarn's Lair) | Member | [Giant skeleton (Tarn's Lair), 37171381](https://runescape.wiki/w/Special:PermanentLink/37171381) | canonical-monster-name-and-page-qualifier |
| Skeleton (Tarn's Lair)#High Level | Member | [Skeleton (Tarn's Lair), 37166358](https://runescape.wiki/w/Special:PermanentLink/37166358) | canonical-monster-name-and-page-qualifier |
| Skeleton (Tarn's Lair)#Low Level | Member | [Skeleton (Tarn's Lair), 37166358](https://runescape.wiki/w/Special:PermanentLink/37166358) | canonical-monster-name-and-page-qualifier |
| Zombie (Lair of Tarn Razorlor)#High Level | Member | [Zombie (Lair of Tarn Razorlor), 37133441](https://runescape.wiki/w/Special:PermanentLink/37133441) | canonical-monster-name-and-page-qualifier |
| Zombie (Lair of Tarn Razorlor)#Mid Level | Member | [Zombie (Lair of Tarn Razorlor), 37133441](https://runescape.wiki/w/Special:PermanentLink/37133441) | canonical-monster-name-and-page-qualifier |
| Exiled kalphite marauder (Kalphite King) | Member | [Exiled kalphite marauder (Kalphite King), 37141195](https://runescape.wiki/w/Special:PermanentLink/37141195) | canonical-monster-name-and-page-qualifier |
| Vorago (Hard Mode) | Member | [Vorago, 37160761](https://runescape.wiki/w/Special:PermanentLink/37160761) | canonical-monster-name-and-page-qualifier |
| Giant mole (Hard Mode) | Free | [Giant mole, 37171623](https://runescape.wiki/w/Special:PermanentLink/37171623) | exact-infobox-variant |
| Skeleton (Lumbridge Catacombs) | Free | [Skeleton (Lumbridge Catacombs), 37143608](https://runescape.wiki/w/Special:PermanentLink/37143608) | canonical-monster-name-and-page-qualifier |
| Goblin (Stronghold of Security) | Free | [Goblin (Stronghold of Security), 37143277](https://runescape.wiki/w/Special:PermanentLink/37143277) | canonical-monster-name-and-page-qualifier |
| Rat#Stronghold of Security | Free | [Rat, 37166351](https://runescape.wiki/w/Special:PermanentLink/37166351) | exact-infobox-variant |
| Giant spider#Stronghold of Security | Free | [Giant spider, 37136145](https://runescape.wiki/w/Special:PermanentLink/37136145) | canonical-monster-name-and-page-qualifier |
| Mountain troll (well) | Free | [Mountain troll (well), 37166347](https://runescape.wiki/w/Special:PermanentLink/37166347) | canonical-monster-name-and-page-qualifier |
| Stag (Enchanted Valley) | Member | [Stag (Enchanted Valley), 37145380](https://runescape.wiki/w/Special:PermanentLink/37145380) | canonical-monster-name-and-page-qualifier |
| Mourner (Mourner Tunnels) | Member | [Mourner (Mourner Tunnels), 37127149](https://runescape.wiki/w/Special:PermanentLink/37127149) | canonical-monster-name-and-page-qualifier |
| Tz-kih | Member | [Tz-Kih, 37161606](https://runescape.wiki/w/Special:PermanentLink/37161606) | canonical-monster-name-and-page-qualifier |
| Geater reborn warrior | Member | [Greater reborn warrior, 37123701](https://runescape.wiki/w/Special:PermanentLink/37123701) | canonical-monster-name-and-page-qualifier |
| Dagannoth#Melee | Member | [Dagannoth, 37134992](https://runescape.wiki/w/Special:PermanentLink/37134992) | canonical-monster-name-and-page-qualifier |
| Skeleton (Barrows) | Member | [Skeleton (Barrows), 37144569](https://runescape.wiki/w/Special:PermanentLink/37144569) | canonical-monster-name-and-page-qualifier |
| Barrows: Rise of the Six | Member | [The Barrows: Rise of the Six, 37152307](https://runescape.wiki/w/Special:PermanentLink/37152307) | explicit-composed-encounter-or-retained-entity-consensus |
| Barrows | Member | [The Barrows Brothers, 37178083](https://runescape.wiki/w/Special:PermanentLink/37178083) | explicit-composed-encounter-or-retained-entity-consensus |
| Dagannoth (Lighthouse) | Member | [Dagannoth (Lighthouse), 37159844](https://runescape.wiki/w/Special:PermanentLink/37159844) | canonical-monster-name-and-page-qualifier |
| Black demon#Wilderness | Member | [Black demon, 37199474](https://runescape.wiki/w/Special:PermanentLink/37199474) | exact-infobox-variant |
| Kerapac, the bound (Hard Mode) | Member | [Kerapac, the bound, 37182367](https://runescape.wiki/w/Special:PermanentLink/37182367) | exact-infobox-variant |
| Arch-Glacor (Hard Mode) | Member | [Arch-Glacor, 37193665](https://runescape.wiki/w/Special:PermanentLink/37193665) | exact-infobox-variant |
| Croesus | Member | [Croesus, 37182518](https://runescape.wiki/w/Special:PermanentLink/37182518) | explicit-reviewed-retained-NPC-entity |
| Chaos demon | Member | [Chaos Demon, 37141366](https://runescape.wiki/w/Special:PermanentLink/37141366) | canonical-monster-name-and-page-qualifier |
| Chaos demon savage | Member | [Chaos Demon Savage, 37122449](https://runescape.wiki/w/Special:PermanentLink/37122449) | canonical-monster-name-and-page-qualifier |
| Dark wizard (The Zamorakian Undercity) | Member | [Dark wizard (The Zamorakian Undercity), 37124317](https://runescape.wiki/w/Special:PermanentLink/37124317) | canonical-monster-name-and-page-qualifier |
| Greater demon ash lord (The Zamorakian Undercity) | Member | [Greater demon ash lord (The Zamorakian Undercity), 37145415](https://runescape.wiki/w/Special:PermanentLink/37145415) | canonical-monster-name-and-page-qualifier |
| Greater demon berserker (The Zamorakian Undercity) | Member | [Greater demon berserker (The Zamorakian Undercity), 37124310](https://runescape.wiki/w/Special:PermanentLink/37124310) | canonical-monster-name-and-page-qualifier |
| Hellhound (The Zamorakian Undercity) | Member | [Hellhound (The Zamorakian Undercity), 37124305](https://runescape.wiki/w/Special:PermanentLink/37124305) | canonical-monster-name-and-page-qualifier |
| Pyrefiend (The Zamorakian Undercity) | Member | [Pyrefiend (The Zamorakian Undercity), 37124307](https://runescape.wiki/w/Special:PermanentLink/37124307) | canonical-monster-name-and-page-qualifier |
| Waterfiend (The Zamorakian Undercity) | Member | [Waterfiend (The Zamorakian Undercity), 37124308](https://runescape.wiki/w/Special:PermanentLink/37124308) | canonical-monster-name-and-page-qualifier |
| Mefis, the jailer | Member | [Mefis, the Jailer, 37136537](https://runescape.wiki/w/Special:PermanentLink/37136537) | canonical-monster-name-and-page-qualifier |
| Red deadly spider | Free | [Deadly red spider, 37142373](https://runescape.wiki/w/Special:PermanentLink/37142373) | canonical-monster-name-and-page-qualifier |
| Giant skeleton (Shadow Dungeon) | Member | [Giant skeleton (Shadow Dungeon), 37166361](https://runescape.wiki/w/Special:PermanentLink/37166361) | canonical-monster-name-and-page-qualifier |
| Zombie (Melzar's Maze) | Free | [Zombie (Melzar's Maze), 37139895](https://runescape.wiki/w/Special:PermanentLink/37139895) | canonical-monster-name-and-page-qualifier |
| Skeleton (Melzar's Maze) | Free | [Skeleton (Melzar's Maze), 37166353](https://runescape.wiki/w/Special:PermanentLink/37166353) | canonical-monster-name-and-page-qualifier |
| Ghost (Melzar's Maze) | Free | [Ghost (Melzar's Maze), 37166352](https://runescape.wiki/w/Special:PermanentLink/37166352) | canonical-monster-name-and-page-qualifier |
| Moss giant (Glarial's Tomb) | Member | [Moss giant (Glarial's Tomb), 37137911](https://runescape.wiki/w/Special:PermanentLink/37137911) | canonical-monster-name-and-page-qualifier |
| Goblin guard (Observatory) | Member | [Goblin guard (Observatory), 37143282](https://runescape.wiki/w/Special:PermanentLink/37143282) | canonical-monster-name-and-page-qualifier |
| Black dragon#Wilderness | Member | [Black dragon, 37160029](https://runescape.wiki/w/Special:PermanentLink/37160029) | canonical-monster-name-and-page-qualifier |
| Skeleton (Ape Atoll) | Member | [Skeleton (Ape Atoll), 37166988](https://runescape.wiki/w/Special:PermanentLink/37166988) | canonical-monster-name-and-page-qualifier |
| TokHaar-Hur (Fight Cauldron) | Member | [TokHaar-Hur (Fight Cauldron), 37135994](https://runescape.wiki/w/Special:PermanentLink/37135994) | canonical-monster-name-and-page-qualifier |
| TokHaar-Xil (Fight Cauldron) | Member | [TokHaar-Xil (Fight Cauldron), 37136053](https://runescape.wiki/w/Special:PermanentLink/37136053) | canonical-monster-name-and-page-qualifier |
| TokHaar-Tok-Xil (Fight Cauldron) | Member | [TokHaar-Tok-Xil (Fight Cauldron), 37136054](https://runescape.wiki/w/Special:PermanentLink/37136054) | canonical-monster-name-and-page-qualifier |
| TokHaar-Mej (Fight Cauldron) | Member | [TokHaar-Mej (Fight Cauldron), 37136055](https://runescape.wiki/w/Special:PermanentLink/37136055) | canonical-monster-name-and-page-qualifier |
| TokHaar-Yt-MejKot (Fight Cauldron) | Member | [TokHaar-Yt-MejKot (Fight Cauldron), 37136056](https://runescape.wiki/w/Special:PermanentLink/37136056) | canonical-monster-name-and-page-qualifier |
| TokHaar-Ket-Zek (Fight Cauldron) | Member | [TokHaar-Ket-Zek (Fight Cauldron), 37136052](https://runescape.wiki/w/Special:PermanentLink/37136052) | canonical-monster-name-and-page-qualifier |
| TokHaar-Ket (Fight Cauldron) | Member | [TokHaar-Ket (Fight Cauldron), 37136057](https://runescape.wiki/w/Special:PermanentLink/37136057) | canonical-monster-name-and-page-qualifier |
| TokHaar-Hok (Fight Cauldron) | Member | [TokHaar-Hok (Fight Cauldron), 37136060](https://runescape.wiki/w/Special:PermanentLink/37136060) | canonical-monster-name-and-page-qualifier |
| Zombie (Dimension of Disaster) | Member | [Zombie (New Varrock), 37187891](https://runescape.wiki/w/Special:PermanentLink/37187891) | canonical-monster-name-and-page-qualifier |
| Monsters in New Varrock | Member | [Dimension of Disaster, 37162626](https://runescape.wiki/w/Special:PermanentLink/37162626) | explicit-monster-aggregate-inside-member-quest |
| Abyssal demon (Heart of Gielinor) | Member | [Abyssal demon (Heart of Gielinor), 37135802](https://runescape.wiki/w/Special:PermanentLink/37135802) | canonical-monster-name-and-page-qualifier |
| Nechryael (Heart of Gielinor) | Member | [Nechryael (Heart of Gielinor), 37143828](https://runescape.wiki/w/Special:PermanentLink/37143828) | canonical-monster-name-and-page-qualifier |
| Ancient ranger (Heart of Gielinor) | Member | [Ancient ranger (Heart of Gielinor), 37135801](https://runescape.wiki/w/Special:PermanentLink/37135801) | canonical-monster-name-and-page-qualifier |
| Ancient warrior (Heart of Gielinor) | Member | [Ancient warrior (Heart of Gielinor), 37135798](https://runescape.wiki/w/Special:PermanentLink/37135798) | canonical-monster-name-and-page-qualifier |
| Hellhound (Heart of Gielinor) | Member | [Hellhound (Heart of Gielinor), 37143514](https://runescape.wiki/w/Special:PermanentLink/37143514) | canonical-monster-name-and-page-qualifier |
| Zamorakian sniper (Heart of Gielinor) | Member | [Zamorakian sniper (Heart of Gielinor), 37143011](https://runescape.wiki/w/Special:PermanentLink/37143011) | canonical-monster-name-and-page-qualifier |
| Chaos dwarf (Heart of Gielinor) | Member | [Chaos dwarf (Heart of Gielinor), 37137987](https://runescape.wiki/w/Special:PermanentLink/37137987) | canonical-monster-name-and-page-qualifier |
| Ancient mage (Heart of Gielinor) | Member | [Ancient mage (Heart of Gielinor), 37135799](https://runescape.wiki/w/Special:PermanentLink/37135799) | canonical-monster-name-and-page-qualifier |
| Bloodveld (Heart of Gielinor) | Member | [Bloodveld (Heart of Gielinor), 37142963](https://runescape.wiki/w/Special:PermanentLink/37142963) | canonical-monster-name-and-page-qualifier |
| Black Knight (Heart of Gielinor) | Member | [Black Knight (Heart of Gielinor), 37142980](https://runescape.wiki/w/Special:PermanentLink/37142980) | canonical-monster-name-and-page-qualifier |
| Wolf (Heart of Gielinor) | Member | [Wolf (Heart of Gielinor), 37143184](https://runescape.wiki/w/Special:PermanentLink/37143184) | canonical-monster-name-and-page-qualifier |
| Necromancer (Heart of Gielinor) | Member | [Necromancer (Heart of Gielinor), 37143843](https://runescape.wiki/w/Special:PermanentLink/37143843) | canonical-monster-name-and-page-qualifier |
| Skeleton (Heart of Gielinor) | Member | [Skeleton (Heart of Gielinor), 37144568](https://runescape.wiki/w/Special:PermanentLink/37144568) | canonical-monster-name-and-page-qualifier |
| Gregorovic (Hard Mode) | Member | [Gregorovic, 37185264](https://runescape.wiki/w/Special:PermanentLink/37185264) | exact-infobox-variant |
| Twin Furies | Member | [The Twin Furies, 37185265](https://runescape.wiki/w/Special:PermanentLink/37185265) | explicit-composed-encounter-or-retained-entity-consensus |
| Twin Furies (Hard Mode) | Member | [The Twin Furies, 37185265](https://runescape.wiki/w/Special:PermanentLink/37185265) | explicit-composed-encounter-or-retained-entity-consensus |
| Vindicta (Hard Mode) | Member | [Vindicta, 37185267](https://runescape.wiki/w/Special:PermanentLink/37185267) | exact-infobox-variant |
| Helwyr (Hard Mode) | Member | [Helwyr, 37185262](https://runescape.wiki/w/Special:PermanentLink/37185262) | exact-infobox-variant |
| Zombie (The Shadow Reef) | Member | [Zombie (The Shadow Reef), 37129563](https://runescape.wiki/w/Special:PermanentLink/37129563) | canonical-monster-name-and-page-qualifier |
| Armoured zombie (The Shadow Reef) | Member | [Armoured zombie (The Shadow Reef), 37129564](https://runescape.wiki/w/Special:PermanentLink/37129564) | canonical-monster-name-and-page-qualifier |
| Cloaked zealot (The Shadow Reef) | Member | [Cloaked zealot (The Shadow Reef), 37129455](https://runescape.wiki/w/Special:PermanentLink/37129455) | canonical-monster-name-and-page-qualifier |
| Crassian scout (The Shadow Reef) | Member | [Crassian scout (The Shadow Reef), 37129432](https://runescape.wiki/w/Special:PermanentLink/37129432) | canonical-monster-name-and-page-qualifier |
| Crassian warrior (The Shadow Reef) | Member | [Crassian warrior (The Shadow Reef), 37129434](https://runescape.wiki/w/Special:PermanentLink/37129434) | canonical-monster-name-and-page-qualifier |
| Death Lotus rogue (Elite Dungeons)#The Shadow Reef | Member | [Death Lotus rogue (Elite Dungeons), 37129460](https://runescape.wiki/w/Special:PermanentLink/37129460) | canonical-monster-name-and-page-qualifier |
| Kal'gerion demon (The Shadow Reef) | Member | [Kal'gerion demon (The Shadow Reef), 37132504](https://runescape.wiki/w/Special:PermanentLink/37132504) | canonical-monster-name-and-page-qualifier |
| Undead witch | Member | [Undead Witch, 37129575](https://runescape.wiki/w/Special:PermanentLink/37129575) | canonical-monster-name-and-page-qualifier |
| Hanto (The Shadow Reef) | Member | [Hanto (The Shadow Reef), 37129543](https://runescape.wiki/w/Special:PermanentLink/37129543) | canonical-monster-name-and-page-qualifier |
| Waterfiend (Temple of Aminishi) | Member | [Waterfiend (Temple of Aminishi), 37148534](https://runescape.wiki/w/Special:PermanentLink/37148534) | canonical-monster-name-and-page-qualifier |
| Anagami (Temple of Aminishi) | Member | [Anagami (Temple of Aminishi), 37135965](https://runescape.wiki/w/Special:PermanentLink/37135965) | canonical-monster-name-and-page-qualifier |
| Arhat (Temple of Aminishi) | Member | [Arhat (Temple of Aminishi), 37129463](https://runescape.wiki/w/Special:PermanentLink/37129463) | canonical-monster-name-and-page-qualifier |
| Death Lotus rogue (Elite Dungeons)#Temple of Aminishi | Member | [Death Lotus rogue (Elite Dungeons), 37129460](https://runescape.wiki/w/Special:PermanentLink/37129460) | canonical-monster-name-and-page-qualifier |
| Red dragon (Dragonkin Laboratory) | Member | [Red dragon (Dragonkin Laboratory), 37132647](https://runescape.wiki/w/Special:PermanentLink/37132647) | canonical-monster-name-and-page-qualifier |
| Black dragon (Dragonkin Laboratory) | Member | [Black dragon (Dragonkin Laboratory), 37132648](https://runescape.wiki/w/Special:PermanentLink/37132648) | canonical-monster-name-and-page-qualifier |
| Celestial dragon (Dragonkin Laboratory) | Member | [Celestial dragon (Dragonkin Laboratory), 37132649](https://runescape.wiki/w/Special:PermanentLink/37132649) | canonical-monster-name-and-page-qualifier |
| Dragonstone dragon (Dragonkin Laboratory) | Member | [Dragonstone dragon (Dragonkin Laboratory), 37132652](https://runescape.wiki/w/Special:PermanentLink/37132652) | canonical-monster-name-and-page-qualifier |
| Onyx dragon (Dragonkin Laboratory) | Member | [Onyx dragon (Dragonkin Laboratory), 37132655](https://runescape.wiki/w/Special:PermanentLink/37132655) | canonical-monster-name-and-page-qualifier |
| Hydrix dragon (Dragonkin Laboratory) | Member | [Hydrix dragon (Dragonkin Laboratory), 37132654](https://runescape.wiki/w/Special:PermanentLink/37132654) | canonical-monster-name-and-page-qualifier |
| Animated book (Dragonkin Laboratory) | Member | [Animated book (Dragonkin Laboratory), 37129430](https://runescape.wiki/w/Special:PermanentLink/37129430) | canonical-monster-name-and-page-qualifier |
| Lava strykewyrm (Dragonkin Laboratory) | Member | [Lava strykewyrm (Dragonkin Laboratory), 37129581](https://runescape.wiki/w/Special:PermanentLink/37129581) | canonical-monster-name-and-page-qualifier |
| Black Stone Dragon | Member | [Black stone dragon, 37152310](https://runescape.wiki/w/Special:PermanentLink/37152310) | canonical-monster-name-and-page-qualifier |
| Rasial, the First Necromancer | Free | [Rasial, the First Necromancer, 37182383](https://runescape.wiki/w/Special:PermanentLink/37182383) | The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states normal F2P combat since July 2025 after prior member quest completion; Alpha vs Omega remains a member quest. |
| Hermod, the Spirit of War | Free | [Hermod, the Spirit of War, 37182384](https://runescape.wiki/w/Special:PermanentLink/37182384) | The retained source has ordinary repeatable boss drops and selects Normal, members No. The article explicitly states F2P combat since July 2025 after prior The Spirit of War completion; the quest variant remains member. |
| Vermyx, Brood Mother (Hard Mode) | Member | [Vermyx, Brood Mother, 37170885](https://runescape.wiki/w/Special:PermanentLink/37170885) | exact-infobox-variant |
| Kezalam, the Wanderer (Hard Mode) | Member | [Kezalam, the Wanderer, 37170886](https://runescape.wiki/w/Special:PermanentLink/37170886) | exact-infobox-variant |
| Nakatra, Devourer Eternal (Hard Mode) | Member | [Nakatra, Devourer Eternal, 37176423](https://runescape.wiki/w/Special:PermanentLink/37176423) | exact-infobox-variant |
| Asyn shadow (Temple Trekking) | Member | [Asyn shadow (Temple Trekking), 37122937](https://runescape.wiki/w/Special:PermanentLink/37122937) | canonical-monster-name-and-page-qualifier |
| Riyl shadow (Temple Trekking) | Member | [Riyl shadow (Temple Trekking), 37122935](https://runescape.wiki/w/Special:PermanentLink/37122935) | canonical-monster-name-and-page-qualifier |
| Shade (Temple Trekking) | Member | [Shade (Temple Trekking), 37122949](https://runescape.wiki/w/Special:PermanentLink/37122949) | canonical-monster-name-and-page-qualifier |
| Zombie (Temple Trekking) | Member | [Zombie (Temple Trekking), 37126652](https://runescape.wiki/w/Special:PermanentLink/37126652) | canonical-monster-name-and-page-qualifier |
| Skeleton (Temple Trekking) | Member | [Skeleton (Temple Trekking), 37122942](https://runescape.wiki/w/Special:PermanentLink/37122942) | canonical-monster-name-and-page-qualifier |
| The Gate of Elidinis | Member | [The Gate of Elidinis, 37173775](https://runescape.wiki/w/Special:PermanentLink/37173775) | explicit-reviewed-retained-NPC-entity |
| TzKal-Zuk (Hard Mode) | Member | [TzKal-Zuk, 37156397](https://runescape.wiki/w/Special:PermanentLink/37156397) | exact-infobox-variant |
| TzekHaar-Kih (TzKal-Zuk) | Member | [TzekHaar-Kih (TzKal-Zuk), 37124791](https://runescape.wiki/w/Special:PermanentLink/37124791) | canonical-monster-name-and-page-qualifier |
| TzekHaar-Xil (TzKal-Zuk) | Member | [TzekHaar-Xil (TzKal-Zuk), 37124794](https://runescape.wiki/w/Special:PermanentLink/37124794) | canonical-monster-name-and-page-qualifier |
| TzekHaar-Mej (TzKal-Zuk) | Member | [TzekHaar-Mej (TzKal-Zuk), 37124795](https://runescape.wiki/w/Special:PermanentLink/37124795) | canonical-monster-name-and-page-qualifier |
| TzekHaar-Yt-MejKot | Member | [TzekHaar-Yt-Mejkot, 37132580](https://runescape.wiki/w/Special:PermanentLink/37132580) | canonical-monster-name-and-page-qualifier |
| TzekHaar-Hur (TzKal-Zuk) | Member | [TzekHaar-Hur (TzKal-Zuk), 37124793](https://runescape.wiki/w/Special:PermanentLink/37124793) | canonical-monster-name-and-page-qualifier |
| Armoured zombie (Uncharted Isles) | Member | [Armoured zombie (Uncharted Isles), 37126426](https://runescape.wiki/w/Special:PermanentLink/37126426) | canonical-monster-name-and-page-qualifier |
| Crassian scout (Uncharted Isles) | Member | [Crassian scout (Uncharted Isles), 37127388](https://runescape.wiki/w/Special:PermanentLink/37127388) | canonical-monster-name-and-page-qualifier |
| Crassion warrior (Uncharted Isles) | Member | [Crassian warrior (Uncharted Isles), 37127389](https://runescape.wiki/w/Special:PermanentLink/37127389) | canonical-monster-name-and-page-qualifier |
| Scorpion (Uncharted Isles) | Member | [Scorpion (Uncharted Isles), 37127387](https://runescape.wiki/w/Special:PermanentLink/37127387) | canonical-monster-name-and-page-qualifier |
| Skeleton (Uncharted Isles) | Member | [Skeleton (Uncharted Isles), 37126425](https://runescape.wiki/w/Special:PermanentLink/37126425) | canonical-monster-name-and-page-qualifier |
| Skulls mercenary (Uncharted Isles) | Member | [Skulls mercenary (Uncharted Isles), 37126449](https://runescape.wiki/w/Special:PermanentLink/37126449) | canonical-monster-name-and-page-qualifier |
| Tormented soul (Uncharted Isles) | Member | [Tormented soul (Uncharted Isles), 37126423](https://runescape.wiki/w/Special:PermanentLink/37126423) | canonical-monster-name-and-page-qualifier |
| Zombie (Uncharted Isles) | Member | [Zombie (Uncharted Isles), 37127381](https://runescape.wiki/w/Special:PermanentLink/37127381) | canonical-monster-name-and-page-qualifier |
| Monsters in Daemonheim | Reviewed mixed family | [Dungeoneering, 37168496](https://runescape.wiki/w/Special:PermanentLink/37168496) | This is a monster aggregate inside Dungeoneering, not a single NPC. Dungeoneering explicitly admits both F2P and members and has member content scopes. The monster list identifies the family; it does not select an individual spawn, NPC ID or floor. |
| Monsters in Shattered Wrolds | Member | [Shattered Worlds, 37127348](https://runescape.wiki/w/Special:PermanentLink/37127348) | exact-member-minigame-monster-aggregate |

## Mixed family variants

These rows identify free and member variants without assigning a blanket membership value to the retained family label. Unknown numeric IDs or missing fields stay explicit. The dataset preserves the complete structured evidence.

| Retained label | Entity page | Variant | Membership | NPC IDs |
| --- | --- | --- | --- | --- |
| Troll | Troll brute | Default | Free | 14980 |
| Troll | Mountain troll | 1 | Free | 1106 |
| Troll | Mountain troll | 2 | Free | 1107 |
| Troll | Mountain troll | 3 | Free | 1108 |
| Troll | Mountain troll | 4 | Free | 1109 |
| Troll | Mountain troll | 5 | Free | 1110 |
| Troll | Mountain troll | 6 | Free | 1111 |
| Troll | Mountain troll | 7 | Free | 1112 |
| Troll | Mountain troll | 8 | Free | 1138 |
| Troll | Troll (Barendir) | Default | Member | 13316, 13317, 13318, 13319, 13320, 13321, 13322, 13323 |
| Rabbit | Rabbit | Regular | Free | 1192, 1193, 1194 |
| Rabbit | Rabbit | Enchanted Valley | Member | 4447, 4448 |
| Rabbit | Rabbit | Miscellania | Member | 1404, 5829 |
| Rabbit | Rabbit | Bouncing | Free | 26841 |
| Rabbit | Rabbit | Rummaging | Free | 26842 |
| Rabbit | Rabbit | Hopping | Free | 26864 |
| Monk of Zamorak | Monk of Zamorak | Level 43 | Free | 188 |
| Monk of Zamorak | Monk of Zamorak | Level 46 | Free | 189 |
| Monk of Zamorak | Monk of Zamorak | Level 54 | Member | 190 |
| Dwarf | Dwarf | Standard (1) | Free | 118 |
| Dwarf | Dwarf | Standard (2) | Member | 120 |
| Dwarf | Dwarf | Mining Guild (1) | Free | 3219 |
| Dwarf | Dwarf | Mining Guild (2) | Free | 3220 |
| Dwarf | Dwarf | Mining Guild (3) | Free | 3221 |
| Dwarf | Dwarf | Dwarven mines (1) | Free | 3268 |
| Dwarf | Dwarf | Dwarven mines (2) | Free | 3269 |
| Dwarf | Dwarf | Dwarven mines (3) | Free | 3270 |
| Dwarf | Dwarf | Dwarven mines (4) | Free | 3271 |
| Dwarf | Dwarf | Dwarven mines (5) | Free | 3272 |
| Dwarf | Dwarf | Dwarven mines (6) | Free | 3273 |
| Dwarf | Dwarf | Dwarven mines (7) | Free | 3274 |
| Dwarf | Dwarf | Dwarven mines (8) | Free | 3275 |
| Moss giant | Moss giant | Variant 1 | Free | 112 |
| Moss giant | Moss giant | Variant 2 | Free | 1587 |
| Moss giant | Moss giant | Variant 3 | Free | 1588 |
| Moss giant | Moss giant | Variant 4 | Free | 4688 |
| Moss giant | Moss giant | Pirate's Cove | Member | 4706 |
| Spider | Spider | Common | Free | 61 |
| Spider | Spider | Underground Pass | Member | 1004 |
| Spider | Spider | Ape Atoll | Member | 1473 |
| Spider | Spider | Stronghold of Security | Free | 4401 |
| Wolf | Wolf | Level 8 (1) | Free | 4413 |
| Wolf | Wolf | Level 8 (2) | Free | 4414 |
| Wolf | Wolf | Level 11 (1) | Free | 95 |
| Wolf | Wolf | Level 11 (2) | Member | 6047 |
| Rat | Rat | Common | Free | 47 |
| Rat | Rat | Stronghold of Security | Free | 2682 |
| Rat | Rat | Rat Catchers | Member | 3007 |
| Cow | Cow | Standard (1) | Free | 81, 14997 |
| Cow | Cow | Standard (2) | Free | 14998 |
| Cow | Cow | Standard (3) | Free | 14999 |
| Cow | Cow | Zanaris | Member | 3309 |
| Grizzly bear | Grizzly bear | Standard | Free | 105 |
| Grizzly bear | Grizzly bear | Tirannwn | Member | 1195 |
| Pirate | Pirate | Level 26 (Brimhaven) | Member | 3189 |
| Pirate | Pirate | Level 29 (Brimhaven) | Member | 6346 |
| Pirate | Pirate | Level 32 (Asgarnian Ice Dungeon) | Free | 6354 |
| Pirate | Pirate | Cabin Fever | Member | 3187 |
| Pirate | Pirate | Level 32 (Port Sarim Jail) | Free | 2695 |
| Goblin#Drop table 2 | Goblin | 1 | Free | 3264 |
| Goblin#Drop table 2 | Goblin | 2 | Free | 3265 |
| Goblin#Drop table 2 | Goblin | 3 | Free | 3266 |
| Goblin#Drop table 2 | Goblin | 4 | Free | 3267 |
| Goblin#Drop table 2 | Goblin | Level 2 (1) | Free | 8638 |
| Goblin#Drop table 2 | Goblin | Level 2 (2) | Free | 11233 |
| Goblin#Drop table 2 | Goblin | Level 2 (3) | Free | 11235 |
| Goblin#Drop table 2 | Goblin | Level 2 (4) | Free | 11237 |
| Goblin#Drop table 2 | Goblin | Level 2 (5) | Free | 11239 |
| Goblin#Drop table 2 | Goblin | Level 2 (6) | Free | 11241 |
| Goblin#Drop table 2 | Goblin | Level 2 (7) | Free | 12354 |
| Goblin#Drop table 2 | Goblin | Level 2 (8) | Free | 12356 |
| Goblin#Drop table 2 | Goblin | Level 5 (9) | Free | 13247 |
| Goblin#Drop table 2 | Goblin | Level 5 (10) | Free | 13248 |
| Goblin#Drop table 2 | Goblin | Level 5 (11) | Free | 13249 |
| Goblin#Drop table 2 | Goblin | Level 5 (12) | Free | 13250 |
| Goblin#Drop table 2 | Goblin | Level 2 (1) | Member | 4261 |
| Goblin#Drop table 2 | Goblin | Level 2 (2) | Member | 4262 |
| Goblin#Drop table 2 | Goblin | Level 2 (3) | Member | 4263 |
| Goblin#Drop table 2 | Goblin | Level 2 (4) | Member | 4264 |
| Goblin#Drop table 2 | Goblin | Level 2 (5) | Member | 4265 |
| Goblin#Drop table 2 | Goblin | Level 2 (6) | Member | 4266 |
| Goblin#Drop table 2 | Goblin | Level 2 (7) | Member | 4267 |
| Goblin#Drop table 2 | Goblin | Level 2 (8) | Member | 4268 |
| Goblin#Drop table 2 | Goblin | Level 2 (9) | Member | 4269 |
| Goblin#Drop table 2 | Goblin | Level 2 (10) | Member | 4270 |
| Goblin#Drop table 2 | Goblin | Level 2 (11) | Member | 4271 |
| Goblin#Drop table 2 | Goblin | Level 5 (1) | Member | 4272 |
| Goblin#Drop table 2 | Goblin | Level 5 (2) | Member | 4273 |
| Goblin#Drop table 2 | Goblin | Level 5 (3) | Member | 4274 |
| Goblin#Drop table 2 | Goblin | Level 5 (4) | Member | 4275 |
| Goblin#Drop table 2 | Goblin | Level 5 (5) | Member | 4276 |
| Goblin#Drop table 2 | Goblin | 1 | Member | 8637 |
| Goblin#Drop table 2 | Goblin | 2 | Member | 4499 |
| Goblin#Drop table 2 | Goblin | 3 | Member | 13095 |
| Goblin#Drop table 2 | Goblin | 4 | Member | 13097 |
| Giant bat | Giant bat | Normal | Free | 78 |
| Giant bat | Giant bat | Brine Rat Cavern | Member | 3711 |
| Goblin#Drop table 1 | Goblin | 1 | Free | 3264 |
| Goblin#Drop table 1 | Goblin | 2 | Free | 3265 |
| Goblin#Drop table 1 | Goblin | 3 | Free | 3266 |
| Goblin#Drop table 1 | Goblin | 4 | Free | 3267 |
| Goblin#Drop table 1 | Goblin | Level 2 (1) | Free | 8638 |
| Goblin#Drop table 1 | Goblin | Level 2 (2) | Free | 11233 |
| Goblin#Drop table 1 | Goblin | Level 2 (3) | Free | 11235 |
| Goblin#Drop table 1 | Goblin | Level 2 (4) | Free | 11237 |
| Goblin#Drop table 1 | Goblin | Level 2 (5) | Free | 11239 |
| Goblin#Drop table 1 | Goblin | Level 2 (6) | Free | 11241 |
| Goblin#Drop table 1 | Goblin | Level 2 (7) | Free | 12354 |
| Goblin#Drop table 1 | Goblin | Level 2 (8) | Free | 12356 |
| Goblin#Drop table 1 | Goblin | Level 5 (9) | Free | 13247 |
| Goblin#Drop table 1 | Goblin | Level 5 (10) | Free | 13248 |
| Goblin#Drop table 1 | Goblin | Level 5 (11) | Free | 13249 |
| Goblin#Drop table 1 | Goblin | Level 5 (12) | Free | 13250 |
| Goblin#Drop table 1 | Goblin | Level 2 (1) | Member | 4261 |
| Goblin#Drop table 1 | Goblin | Level 2 (2) | Member | 4262 |
| Goblin#Drop table 1 | Goblin | Level 2 (3) | Member | 4263 |
| Goblin#Drop table 1 | Goblin | Level 2 (4) | Member | 4264 |
| Goblin#Drop table 1 | Goblin | Level 2 (5) | Member | 4265 |
| Goblin#Drop table 1 | Goblin | Level 2 (6) | Member | 4266 |
| Goblin#Drop table 1 | Goblin | Level 2 (7) | Member | 4267 |
| Goblin#Drop table 1 | Goblin | Level 2 (8) | Member | 4268 |
| Goblin#Drop table 1 | Goblin | Level 2 (9) | Member | 4269 |
| Goblin#Drop table 1 | Goblin | Level 2 (10) | Member | 4270 |
| Goblin#Drop table 1 | Goblin | Level 2 (11) | Member | 4271 |
| Goblin#Drop table 1 | Goblin | Level 5 (1) | Member | 4272 |
| Goblin#Drop table 1 | Goblin | Level 5 (2) | Member | 4273 |
| Goblin#Drop table 1 | Goblin | Level 5 (3) | Member | 4274 |
| Goblin#Drop table 1 | Goblin | Level 5 (4) | Member | 4275 |
| Goblin#Drop table 1 | Goblin | Level 5 (5) | Member | 4276 |
| Goblin#Drop table 1 | Goblin | 1 | Member | 8637 |
| Goblin#Drop table 1 | Goblin | 2 | Member | 4499 |
| Goblin#Drop table 1 | Goblin | 3 | Member | 13095 |
| Goblin#Drop table 1 | Goblin | 4 | Member | 13097 |
| Rooster | Rooster | Standard | Member | 1018, 1403 |
| Rooster | Rooster | Blooming Burrow and Marigold Farm | Free | 30869 |
| Poison spider | Poison spider | Common | Free | 134 |
| Poison spider | Poison spider | Observatory | Member | 1009 |
| Thief | Thief | Standard | Free | 8 |
| Thief | Thief | Monk's Friend | Member | 282 |
| Thief | Thief | Port Sarim | Free | 2674 |
| Thief | Thief | Port Sarim jail | Free | 23130 |
| Thief | Thief | Varrock (1) | Free | 5926 |
| Thief | Thief | Varrock (2) | Free | 5927 |
| Thief | Thief | Varrock (3) | Free | 5928 |
| Thief | Thief | Varrock (4) | Free | 5929 |
| Jungle spider | Jungle spider | Common | Member | 62 |
| Jungle spider | Jungle spider | Musa Point | Free | 16883 |
| Jungle spider | Jungle spider | Ape Atoll | Member | 1478 |
| Jungle spider | Jungle spider | Jade Vine (level 42) | Member | 6377 |
| Jungle spider | Jungle spider | Jade Vine (level 49) | Member | 6376 |
| Jungle spider | Jungle spider | Tai Bwo Wannai Cleanup | Member | 2491, 2492 |
| Guard | Guard (Ardougne) | Default | Member | 32 |
| Guard | Guard (Falador) | Sword (weak to fire) | Free | 9 |
| Guard | Guard (Falador) | Sword (weak to water) | Free | 3228 |
| Guard | Guard (Falador) | Crossbow | Free | 3229 |
| Guard | Guard (Falador) | Axe | Free | 3230 |
| Guard | Guard (Falador) | Bow (1) | Free | 3231 |
| Guard | Guard (Falador) | Bow (2) | Free | 3232 |
| Guard | Guard (Falador) | Bow (3) | Free | 3233 |
| Guard | Guard (Falador) | North of Falador | Free | 3241 |
| Guard | Guard (Edgeville) | 1 | Free | 296 |
| Guard | Guard (Edgeville) | 2 | Free | 297 |
| Guard | Guard (Edgeville) | 3 | Free | 298 |
| Guard | Guard (Edgeville) | 4 | Free | 299 |
| Guard | Guard (Edgeville) | 5 | Free | 3407 |
| Guard | Guard (Edgeville) | 6 | Free | 3408 |
| Guard | Guard (Varrock) | Male | Free | 5919 |
| Guard | Guard (Varrock) | Captain | Free | 5920 |
| Guard | Guard (Varrock) | Female | Free | 9234 |
| Guard | Port Sarim guard | 1 | Free | 2700, 2701, 2702, 2703 |
| Guard | Port Sarim guard | 2 | Free | 2699 |
| Guard | Ranger | Male | Free | 32573 |
| Guard | Ranger | Female | Free | 32574 |
| Ice warrior | Ice warrior | Normal | Free | 125, 3073 |
| Ice warrior | Ice warrior | Ice Queen's Lair | Member | 145 |
| Thrower Troll | Thrower Troll | Death Plateau | Free | 1101, 1102, 1103, 1104, 1105, 1130, 1131, 1132, 1133, 1134 |
| Thrower Troll | Thrower Troll | Trollheim | Member | 1101, 1102, 1103, 1104, 1105, 1130, 1131, 1132, 1133, 1134 |
| Elvarg | Elvarg | Dragon Slayer | Free | 742 |
| Elvarg | Elvarg | Dominion Tower | Member | 14548, 14554 |
| Elvarg | Elvarg | Rumble Mode | Member | 18923 |
| Crab | Crab | Mogre Camp (29) | Member | 3424 |
| Crab | Crab | Mogre Camp (30) | Member | 3421 |
| Crab | Crab | Havenhythe (1) | Member | 32608 |
| Crab | Crab | Havenhythe (2) | Member | 32609 |
| Crab | Crab | Havenhythe (3) | Member | 32610 |
| Crab | Crab | Havenhythe (4) | Free | 32616 |
| Crab | Crab | Havenhythe (5) | Free | 32617 |
| Crab | Crab | Havenhythe (6) | Free | 32618 |
| Jonny the beard | Jonny the beard | Normal | Free | 645 |
| Jonny the beard | Jonny the beard | New Varrock | Member | 20803 |
| Crawling hand | Crawling hand | Level 6 (1) | Free | 1648 |
| Crawling hand | Crawling hand | Level 6 (2) | Member | 1649 |
| Crawling hand | Crawling hand | Level 6 (3) | Member | 1650 |
| Crawling hand | Crawling hand | Level 6 (4) | Member | 1651 |
| Crawling hand | Crawling hand | Level 6 (5) | Member | 1652 |
| Crawling hand | Crawling hand | Level 10 (1) | Member | 1653 |
| Crawling hand | Crawling hand | Level 10 (2) | Member | 1654 |
| Crawling hand | Crawling hand | Level 10 (3) | Member | 1655 |
| Crawling hand | Crawling hand | Level 10 (4) | Member | 1656 |
| Crawling hand | Crawling hand | Level 10 (5) | Member | 1657 |
| Crassian scout | Crassian scout | A Shadow over Ashdale | Free | 19312 |
| Crassian scout | Crassian scout | Post-quest | Free | 19313 |
| Crassian scout | Crassian scout | Pieces of Hate | Member | 25536, 25537 |
| Crassian warrior | Crassian warrior | Quest (non-combat) | Free | 19321 |
| Crassian warrior | Crassian warrior | Post-quest | Free | 19322 |
| Crassian warrior | Crassian warrior | Pieces of Hate | Member | 25355 |
| Monsters in Daemonheim | Dungeoneering | Aggregate activity with F2P and member content scopes | Mixed; individual monsters not assigned a Boolean | No individual NPC identity supplied |

## Supporting entity and identity evidence

Composed encounters use the member fields of their named combatants. An identity page or redirect only identifies the retained entity; geography does not supply a monster member flag.

| Retained label | Pinned evidence | Evidence type |
| --- | --- | --- |
| Troll | [Troll brute, 37143575](https://runescape.wiki/w/Special:PermanentLink/37143575) | Monster |
| Troll | [Mountain troll, 37144449](https://runescape.wiki/w/Special:PermanentLink/37144449) | Monster |
| Troll | [Troll (Barendir), 37150558](https://runescape.wiki/w/Special:PermanentLink/37150558) | NPC |
| Elf | [Elf warrior, 37170391](https://runescape.wiki/w/Special:PermanentLink/37170391) | Monster |
| Elf | [Elf warrior (Arandar), 37129740](https://runescape.wiki/w/Special:PermanentLink/37129740) | NPC |
| Giant skeleton | [Giant skeleton (Shadow Dungeon), 37166361](https://runescape.wiki/w/Special:PermanentLink/37166361) | Monster |
| Giant skeleton | [Giant skeleton (Tarn's Lair), 37171381](https://runescape.wiki/w/Special:PermanentLink/37171381) | Monster |
| Guard | [Guard (Ardougne), 37156881](https://runescape.wiki/w/Special:PermanentLink/37156881) | Monster |
| Guard | [Guard (Falador), 37156882](https://runescape.wiki/w/Special:PermanentLink/37156882) | Monster |
| Guard | [Guard (Edgeville), 37156880](https://runescape.wiki/w/Special:PermanentLink/37156880) | Monster |
| Guard | [Guard (Varrock), 37156879](https://runescape.wiki/w/Special:PermanentLink/37156879) | Monster |
| Guard | [Port Sarim guard, 37156877](https://runescape.wiki/w/Special:PermanentLink/37156877) | Monster |
| Guard | [Ranger, 37203070](https://runescape.wiki/w/Special:PermanentLink/37203070) | Monster |
| Suspicious water | [Spinolyp, 37143989](https://runescape.wiki/w/Special:PermanentLink/37143989) | Monster |
| Mummy | [Mummy (Jaldraocht Pyramid), 37176335](https://runescape.wiki/w/Special:PermanentLink/37176335) | Monster |
| Mummy | [Mummy (Klenter's Pyramid), 37143421](https://runescape.wiki/w/Special:PermanentLink/37143421) | Monster |
| Mummy | [Klenter's Pyramid, 37122203](https://runescape.wiki/w/Special:PermanentLink/37122203) | Identity/encounter article |
| Zemouregal & Vorkath (Story Mode) | [Vorkath, 37182355](https://runescape.wiki/w/Special:PermanentLink/37182355) | Monster |
| Zemouregal & Vorkath | [Vorkath, 37182355](https://runescape.wiki/w/Special:PermanentLink/37182355) | Monster |
| Zemouregal & Vorkath (Hard Mode) | [Vorkath, 37182355](https://runescape.wiki/w/Special:PermanentLink/37182355) | Monster |
| Barrows: Rise of the Six | [Ahrim the Blighted, 37122077](https://runescape.wiki/w/Special:PermanentLink/37122077) | Monster |
| Barrows: Rise of the Six | [Dharok the Wretched, 37122079](https://runescape.wiki/w/Special:PermanentLink/37122079) | Monster |
| Barrows: Rise of the Six | [Guthan the Infested, 37122080](https://runescape.wiki/w/Special:PermanentLink/37122080) | Monster |
| Barrows: Rise of the Six | [Karil the Tainted, 37199043](https://runescape.wiki/w/Special:PermanentLink/37199043) | Monster |
| Barrows: Rise of the Six | [Torag the Corrupted, 37122084](https://runescape.wiki/w/Special:PermanentLink/37122084) | Monster |
| Barrows: Rise of the Six | [Verac the Defiled, 37122085](https://runescape.wiki/w/Special:PermanentLink/37122085) | Monster |
| Barrows | [Ahrim the Blighted, 37122077](https://runescape.wiki/w/Special:PermanentLink/37122077) | Monster |
| Barrows | [Dharok the Wretched, 37122079](https://runescape.wiki/w/Special:PermanentLink/37122079) | Monster |
| Barrows | [Guthan the Infested, 37122080](https://runescape.wiki/w/Special:PermanentLink/37122080) | Monster |
| Barrows | [Karil the Tainted, 37199043](https://runescape.wiki/w/Special:PermanentLink/37199043) | Monster |
| Barrows | [Torag the Corrupted, 37122084](https://runescape.wiki/w/Special:PermanentLink/37122084) | Monster |
| Barrows | [Verac the Defiled, 37122085](https://runescape.wiki/w/Special:PermanentLink/37122085) | Monster |
| Barrows | [Akrisae the Doomed, 37122078](https://runescape.wiki/w/Special:PermanentLink/37122078) | Monster |
| Barrows | [Linza the Disgraced, 37122083](https://runescape.wiki/w/Special:PermanentLink/37122083) | Monster |
| Twin Furies | [Nymora, the Vengeful, 37185260](https://runescape.wiki/w/Special:PermanentLink/37185260) | Monster |
| Twin Furies | [Avaryss, the Unceasing, 37185261](https://runescape.wiki/w/Special:PermanentLink/37185261) | Monster |
| Twin Furies (Hard Mode) | [Nymora, the Vengeful, 37185260](https://runescape.wiki/w/Special:PermanentLink/37185260) | Monster |
| Twin Furies (Hard Mode) | [Avaryss, the Unceasing, 37185261](https://runescape.wiki/w/Special:PermanentLink/37185261) | Monster |
| Monsters in Daemonheim | [Dungeoneering, 37168496](https://runescape.wiki/w/Special:PermanentLink/37168496) | Identity/encounter article |
| Monsters in Daemonheim | [Dungeoneering/Monsters, 37075376](https://runescape.wiki/w/Special:PermanentLink/37075376) | Identity/encounter article |

## Re-audited decisions for 895 existing known labels

Each row retains its original pinned decision after the new multi-entity parser checked that exact revision. The ordinary Goblin exception is stated in its row.

| Retained label | Decision | Pinned page | Audit result |
| --- | --- | --- | --- |
| Farmer | Free | [Farmer, 37169627](https://runescape.wiki/w/Special:PermanentLink/37169627) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll commando | Free | [Troll commando, 37143580](https://runescape.wiki/w/Special:PermanentLink/37143580) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll mage commando | Free | [Troll mage commando, 37143569](https://runescape.wiki/w/Special:PermanentLink/37143569) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll ranger commando | Free | [Troll ranger commando, 37143568](https://runescape.wiki/w/Special:PermanentLink/37143568) | All typed Monster infoboxes agree; retain pinned policy. |
| Blue dragon | Free | [Blue dragon, 37132802](https://runescape.wiki/w/Special:PermanentLink/37132802) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos druid | Member | [Chaos druid, 37154575](https://runescape.wiki/w/Special:PermanentLink/37154575) | All typed Monster infoboxes agree; retain pinned policy. |
| Araxxor | Member | [Araxxor, 37182351](https://runescape.wiki/w/Special:PermanentLink/37182351) | All typed Monster infoboxes agree; retain pinned policy. |
| Flying leech | Free | [Flying leech, 37166374](https://runescape.wiki/w/Special:PermanentLink/37166374) | All typed Monster infoboxes agree; retain pinned policy. |
| Grotworm | Member | [Grotworm, 37159849](https://runescape.wiki/w/Special:PermanentLink/37159849) | All typed Monster infoboxes agree; retain pinned policy. |
| Rorarius | Member | [Rorarius, 37159851](https://runescape.wiki/w/Special:PermanentLink/37159851) | All typed Monster infoboxes agree; retain pinned policy. |
| Gladius | Member | [Gladius, 37166360](https://runescape.wiki/w/Special:PermanentLink/37166360) | All typed Monster infoboxes agree; retain pinned policy. |
| Capsarius | Member | [Capsarius, 37166359](https://runescape.wiki/w/Special:PermanentLink/37166359) | All typed Monster infoboxes agree; retain pinned policy. |
| Scutarius | Member | [Scutarius, 37144482](https://runescape.wiki/w/Special:PermanentLink/37144482) | All typed Monster infoboxes agree; retain pinned policy. |
| Man | Free | [Man, 37156803](https://runescape.wiki/w/Special:PermanentLink/37156803) | All typed Monster infoboxes agree; retain pinned policy. |
| Black bear | Free | [Black bear, 37152329](https://runescape.wiki/w/Special:PermanentLink/37152329) | All typed Monster infoboxes agree; retain pinned policy. |
| Goblin | Free | [Goblin, 37143473](https://runescape.wiki/w/Special:PermanentLink/37143473) | Ordinary Varrock/Port Sarim goblins are explicitly free. North-West Kandarin and member-area variants are explicitly member entities. Preserve ordinary free admission; this is not a universal family entitlement. |
| Icefiend | Free | [Icefiend, 37189017](https://runescape.wiki/w/Special:PermanentLink/37189017) | All typed Monster infoboxes agree; retain pinned policy. |
| General malpractitioner | Member | [General malpractitioner, 37148864](https://runescape.wiki/w/Special:PermanentLink/37148864) | All typed Monster infoboxes agree; retain pinned policy. |
| 'Rum'-pumped crab | Member | ['Rum'-pumped crab, 37144022](https://runescape.wiki/w/Special:PermanentLink/37144022) | All typed Monster infoboxes agree; retain pinned policy. |
| Bird | Free | [Bird, 37141867](https://runescape.wiki/w/Special:PermanentLink/37141867) | All typed Monster infoboxes agree; retain pinned policy. |
| Pig | Member | [Pig, 37148521](https://runescape.wiki/w/Special:PermanentLink/37148521) | All typed Monster infoboxes agree; retain pinned policy. |
| Iron dragon | Member | [Iron dragon, 37159870](https://runescape.wiki/w/Special:PermanentLink/37159870) | All typed Monster infoboxes agree; retain pinned policy. |
| Steel dragon | Member | [Steel dragon, 37159883](https://runescape.wiki/w/Special:PermanentLink/37159883) | All typed Monster infoboxes agree; retain pinned policy. |
| Mithril dragon | Member | [Mithril dragon, 37159880](https://runescape.wiki/w/Special:PermanentLink/37159880) | All typed Monster infoboxes agree; retain pinned policy. |
| Hill giant | Free | [Hill giant, 37142826](https://runescape.wiki/w/Special:PermanentLink/37142826) | All typed Monster infoboxes agree; retain pinned policy. |
| Young grotworm | Free | [Young grotworm, 37143055](https://runescape.wiki/w/Special:PermanentLink/37143055) | All typed Monster infoboxes agree; retain pinned policy. |
| Mature grotworm | Member | [Mature grotworm, 37159879](https://runescape.wiki/w/Special:PermanentLink/37159879) | All typed Monster infoboxes agree; retain pinned policy. |
| Chicken | Free | [Chicken, 37142047](https://runescape.wiki/w/Special:PermanentLink/37142047) | All typed Monster infoboxes agree; retain pinned policy. |
| Black unicorn | Member | [Black unicorn, 37173756](https://runescape.wiki/w/Special:PermanentLink/37173756) | All typed Monster infoboxes agree; retain pinned policy. |
| Freidir | Member | [Freidir, 37156894](https://runescape.wiki/w/Special:PermanentLink/37156894) | All typed Monster infoboxes agree; retain pinned policy. |
| Borrokar | Member | [Borrokar, 37156892](https://runescape.wiki/w/Special:PermanentLink/37156892) | All typed Monster infoboxes agree; retain pinned policy. |
| Lanzig | Member | [Lanzig, 37156888](https://runescape.wiki/w/Special:PermanentLink/37156888) | All typed Monster infoboxes agree; retain pinned policy. |
| Lesser demon | Free | [Lesser demon, 37159794](https://runescape.wiki/w/Special:PermanentLink/37159794) | All typed Monster infoboxes agree; retain pinned policy. |
| Imp | Free | [Imp, 37152452](https://runescape.wiki/w/Special:PermanentLink/37152452) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal demon | Member | [Abyssal demon, 37166192](https://runescape.wiki/w/Special:PermanentLink/37166192) | All typed Monster infoboxes agree; retain pinned policy. |
| Dark beast | Member | [Dark beast, 37159877](https://runescape.wiki/w/Special:PermanentLink/37159877) | All typed Monster infoboxes agree; retain pinned policy. |
| Adamant dragon | Member | [Adamant dragon, 37176075](https://runescape.wiki/w/Special:PermanentLink/37176075) | All typed Monster infoboxes agree; retain pinned policy. |
| Black demon | Member | [Black demon, 37199474](https://runescape.wiki/w/Special:PermanentLink/37199474) | All typed Monster infoboxes agree; retain pinned policy. |
| Fire giant | Member | [Fire giant, 37142872](https://runescape.wiki/w/Special:PermanentLink/37142872) | All typed Monster infoboxes agree; retain pinned policy. |
| Kal'gerion demon | Member | [Kal'gerion demon, 37188966](https://runescape.wiki/w/Special:PermanentLink/37188966) | All typed Monster infoboxes agree; retain pinned policy. |
| Frost dragon | Member | [Frost dragon, 37187953](https://runescape.wiki/w/Special:PermanentLink/37187953) | All typed Monster infoboxes agree; retain pinned policy. |
| Hellhound | Free | [Hellhound, 37196163](https://runescape.wiki/w/Special:PermanentLink/37196163) | All typed Monster infoboxes agree; retain pinned policy. |
| Edimmu | Member | [Edimmu, 37166204](https://runescape.wiki/w/Special:PermanentLink/37166204) | All typed Monster infoboxes agree; retain pinned policy. |
| Arhat | Member | [Arhat, 37129534](https://runescape.wiki/w/Special:PermanentLink/37129534) | All typed Monster infoboxes agree; retain pinned policy. |
| Deadly red spider | Free | [Deadly red spider, 37142373](https://runescape.wiki/w/Special:PermanentLink/37142373) | All typed Monster infoboxes agree; retain pinned policy. |
| Corpse spider | Free | [Corpse spider, 37142137](https://runescape.wiki/w/Special:PermanentLink/37142137) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant spider | Free | [Giant spider, 37136145](https://runescape.wiki/w/Special:PermanentLink/37136145) | All typed Monster infoboxes agree; retain pinned policy. |
| Araxxi | Member | [Araxxi, 37195256](https://runescape.wiki/w/Special:PermanentLink/37195256) | All typed Monster infoboxes agree; retain pinned policy. |
| Mountain troll | Free | [Mountain troll, 37144449](https://runescape.wiki/w/Special:PermanentLink/37144449) | All typed Monster infoboxes agree; retain pinned policy. |
| Queen Black Dragon | Member | [Queen Black Dragon, 37182339](https://runescape.wiki/w/Special:PermanentLink/37182339) | All typed Monster infoboxes agree; retain pinned policy. |
| Chompy bird | Member | [Chompy bird, 37139640](https://runescape.wiki/w/Special:PermanentLink/37139640) | All typed Monster infoboxes agree; retain pinned policy. |
| Entranan firebird | Member | [Entranan firebird, 37138626](https://runescape.wiki/w/Special:PermanentLink/37138626) | All typed Monster infoboxes agree; retain pinned policy. |
| Pheasant | Member | [Pheasant, 37137970](https://runescape.wiki/w/Special:PermanentLink/37137970) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos dwogre | Member | [Chaos dwogre, 37167009](https://runescape.wiki/w/Special:PermanentLink/37167009) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Guard | Member | [Black Guard, 37139617](https://runescape.wiki/w/Special:PermanentLink/37139617) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Guard crossbowdwarf | Member | [Black Guard crossbowdwarf, 37167007](https://runescape.wiki/w/Special:PermanentLink/37167007) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Guard berserker | Member | [Black Guard Berserker, 37148511](https://runescape.wiki/w/Special:PermanentLink/37148511) | All typed Monster infoboxes agree; retain pinned policy. |
| Golem guard | Member | [Golem guard, 37122170](https://runescape.wiki/w/Special:PermanentLink/37122170) | All typed Monster infoboxes agree; retain pinned policy. |
| Black dragon | Member | [Black dragon, 37160029](https://runescape.wiki/w/Special:PermanentLink/37160029) | All typed Monster infoboxes agree; retain pinned policy. |
| Baby black dragon | Member | [Baby black dragon, 37160028](https://runescape.wiki/w/Special:PermanentLink/37160028) | All typed Monster infoboxes agree; retain pinned policy. |
| Small scarab | Member | [Small scarab, 37145349](https://runescape.wiki/w/Special:PermanentLink/37145349) | All typed Monster infoboxes agree; retain pinned policy. |
| Ivory Shredflesh (cursed) | Member | [Ivory Shredflesh (cursed), 37166978](https://runescape.wiki/w/Special:PermanentLink/37166978) | All typed Monster infoboxes agree; retain pinned policy. |
| Ivory Gromblod (cursed) | Member | [Ivory Gromblod (cursed), 37166977](https://runescape.wiki/w/Special:PermanentLink/37166977) | All typed Monster infoboxes agree; retain pinned policy. |
| Ivory Bre'egth (cursed) | Member | [Ivory Bre'egth (cursed), 37166976](https://runescape.wiki/w/Special:PermanentLink/37166976) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon | Free | [Greater demon, 37199607](https://runescape.wiki/w/Special:PermanentLink/37199607) | All typed Monster infoboxes agree; retain pinned policy. |
| Gargoyle | Member | [Gargoyle, 37166189](https://runescape.wiki/w/Special:PermanentLink/37166189) | All typed Monster infoboxes agree; retain pinned policy. |
| Airut | Member | [Airut, 37159900](https://runescape.wiki/w/Special:PermanentLink/37159900) | All typed Monster infoboxes agree; retain pinned policy. |
| Risen knight | Member | [Risen knight, 37144707](https://runescape.wiki/w/Special:PermanentLink/37144707) | All typed Monster infoboxes agree; retain pinned policy. |
| Angry barbarian spirit | Member | [Angry barbarian spirit, 37167017](https://runescape.wiki/w/Special:PermanentLink/37167017) | All typed Monster infoboxes agree; retain pinned policy. |
| Enraged barbarian spirit | Member | [Enraged barbarian spirit, 37167018](https://runescape.wiki/w/Special:PermanentLink/37167018) | All typed Monster infoboxes agree; retain pinned policy. |
| Berserk barbarian spirit | Member | [Berserk barbarian spirit, 37166875](https://runescape.wiki/w/Special:PermanentLink/37166875) | All typed Monster infoboxes agree; retain pinned policy. |
| Waterfiend | Member | [Waterfiend, 37171626](https://runescape.wiki/w/Special:PermanentLink/37171626) | All typed Monster infoboxes agree; retain pinned policy. |
| Brutal green dragon | Member | [Brutal green dragon, 37171627](https://runescape.wiki/w/Special:PermanentLink/37171627) | All typed Monster infoboxes agree; retain pinned policy. |
| Confused barbarian | Member | [Confused barbarian, 37167038](https://runescape.wiki/w/Special:PermanentLink/37167038) | All typed Monster infoboxes agree; retain pinned policy. |
| Lost barbarian | Member | [Lost barbarian, 37166885](https://runescape.wiki/w/Special:PermanentLink/37166885) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton brute | Member | [Skeleton brute, 37167013](https://runescape.wiki/w/Special:PermanentLink/37167013) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton warlord | Member | [Skeleton warlord, 37167122](https://runescape.wiki/w/Special:PermanentLink/37167122) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton thug | Member | [Skeleton thug, 37167027](https://runescape.wiki/w/Special:PermanentLink/37167027) | All typed Monster infoboxes agree; retain pinned policy. |
| Bardur | Member | [Bardur, 37142786](https://runescape.wiki/w/Special:PermanentLink/37142786) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagannoth fledgeling | Member | [Dagannoth fledgeling, 37142319](https://runescape.wiki/w/Special:PermanentLink/37142319) | All typed Monster infoboxes agree; retain pinned policy. |
| Wallasalki | Member | [Wallasalki, 37143076](https://runescape.wiki/w/Special:PermanentLink/37143076) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagannoth | Member | [Dagannoth, 37134992](https://runescape.wiki/w/Special:PermanentLink/37134992) | All typed Monster infoboxes agree; retain pinned policy. |
| Automaton Generator | Member | [Automaton Generator, 37159901](https://runescape.wiki/w/Special:PermanentLink/37159901) | All typed Monster infoboxes agree; retain pinned policy. |
| Automaton Tracer | Member | [Automaton Tracer, 37159903](https://runescape.wiki/w/Special:PermanentLink/37159903) | All typed Monster infoboxes agree; retain pinned policy. |
| Automaton Guardian | Member | [Automaton Guardian, 37159902](https://runescape.wiki/w/Special:PermanentLink/37159902) | All typed Monster infoboxes agree; retain pinned policy. |
| Pekin | Member | [Pekin, 37137969](https://runescape.wiki/w/Special:PermanentLink/37137969) | All typed Monster infoboxes agree; retain pinned policy. |
| Vinecrawler | Member | [Vinecrawler, 37143219](https://runescape.wiki/w/Special:PermanentLink/37143219) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant Rock Crab | Member | [Giant Rock Crab, 37143248](https://runescape.wiki/w/Special:PermanentLink/37143248) | All typed Monster infoboxes agree; retain pinned policy. |
| Minotaur | Free | [Minotaur, 37143683](https://runescape.wiki/w/Special:PermanentLink/37143683) | All typed Monster infoboxes agree; retain pinned policy. |
| Solak, Guardian of the Grove | Member | [Solak, Guardian of the Grove, 37166762](https://runescape.wiki/w/Special:PermanentLink/37166762) | All typed Monster infoboxes agree; retain pinned policy. |
| Bulbous crawler | Member | [Bulbous crawler, 37127077](https://runescape.wiki/w/Special:PermanentLink/37127077) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped tortoise | Member | [Warped tortoise, 37143097](https://runescape.wiki/w/Special:PermanentLink/37143097) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos Giant | Member | [Chaos Giant, 37130626](https://runescape.wiki/w/Special:PermanentLink/37130626) | All typed Monster infoboxes agree; retain pinned policy. |
| Moss golem | Member | [Moss golem, 37143812](https://runescape.wiki/w/Special:PermanentLink/37143812) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped terrorbird | Member | [Warped terrorbird, 37171425](https://runescape.wiki/w/Special:PermanentLink/37171425) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Khazard guard | Member | [Elite Khazard guard, 37167029](https://runescape.wiki/w/Special:PermanentLink/37167029) | All typed Monster infoboxes agree; retain pinned policy. |
| Wizard | Member | [Wizard, 37143178](https://runescape.wiki/w/Special:PermanentLink/37143178) | All typed Monster infoboxes agree; retain pinned policy. |
| Disciple of Iban | Member | [Disciple of Iban, 37151931](https://runescape.wiki/w/Special:PermanentLink/37151931) | All typed Monster infoboxes agree; retain pinned policy. |
| Flesh Crawler | Free | [Flesh Crawler, 37153668](https://runescape.wiki/w/Special:PermanentLink/37153668) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant rat | Free | [Giant rat, 37153107](https://runescape.wiki/w/Special:PermanentLink/37153107) | All typed Monster infoboxes agree; retain pinned policy. |
| Calf | Free | [Calf, 37141921](https://runescape.wiki/w/Special:PermanentLink/37141921) | All typed Monster infoboxes agree; retain pinned policy. |
| Suqah | Member | [Suqah, 37169273](https://runescape.wiki/w/Special:PermanentLink/37169273) | All typed Monster infoboxes agree; retain pinned policy. |
| Fire monster | Member | [Fire monster, 37161421](https://runescape.wiki/w/Special:PermanentLink/37161421) | All typed Monster infoboxes agree; retain pinned policy. |
| Sotapanna | Member | [Sotapanna, 37133555](https://runescape.wiki/w/Special:PermanentLink/37133555) | All typed Monster infoboxes agree; retain pinned policy. |
| Sakadagami | Member | [Sakadagami, 37133556](https://runescape.wiki/w/Special:PermanentLink/37133556) | All typed Monster infoboxes agree; retain pinned policy. |
| Anagami | Member | [Anagami, 37129533](https://runescape.wiki/w/Special:PermanentLink/37129533) | All typed Monster infoboxes agree; retain pinned policy. |
| Avatar of Creation | Member | [Avatar of Creation, 37139619](https://runescape.wiki/w/Special:PermanentLink/37139619) | All typed Monster infoboxes agree; retain pinned policy. |
| Pyrefiend | Member | [Pyrefiend, 37143868](https://runescape.wiki/w/Special:PermanentLink/37143868) | All typed Monster infoboxes agree; retain pinned policy. |
| Iorwerth scout | Member | [Iorwerth scout, 37166209](https://runescape.wiki/w/Special:PermanentLink/37166209) | All typed Monster infoboxes agree; retain pinned policy. |
| Iorwerth guard | Member | [Iorwerth guard, 37166210](https://runescape.wiki/w/Special:PermanentLink/37166210) | All typed Monster infoboxes agree; retain pinned policy. |
| Truthful shadow | Member | [Truthful shadow, 37179178](https://runescape.wiki/w/Special:PermanentLink/37179178) | All typed Monster infoboxes agree; retain pinned policy. |
| Blissful shadow | Member | [Blissful shadow, 37166205](https://runescape.wiki/w/Special:PermanentLink/37166205) | All typed Monster infoboxes agree; retain pinned policy. |
| Othainian | Member | [Othainian, 37143944](https://runescape.wiki/w/Special:PermanentLink/37143944) | All typed Monster infoboxes agree; retain pinned policy. |
| Doomion | Member | [Doomion, 37142477](https://runescape.wiki/w/Special:PermanentLink/37142477) | All typed Monster infoboxes agree; retain pinned policy. |
| Holthion | Member | [Holthion, 37143606](https://runescape.wiki/w/Special:PermanentLink/37143606) | All typed Monster infoboxes agree; retain pinned policy. |
| Soulless | Member | [Soulless, 37144002](https://runescape.wiki/w/Special:PermanentLink/37144002) | All typed Monster infoboxes agree; retain pinned policy. |
| Market Guard | Member | [Market Guard, 37143767](https://runescape.wiki/w/Special:PermanentLink/37143767) | All typed Monster infoboxes agree; retain pinned policy. |
| Shady stranger | Member | [Shady stranger, 37144779](https://runescape.wiki/w/Special:PermanentLink/37144779) | All typed Monster infoboxes agree; retain pinned policy. |
| Suspicious outsider | Member | [Suspicious outsider, 37145387](https://runescape.wiki/w/Special:PermanentLink/37145387) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie pirate | Member | [Zombie pirate, 37142878](https://runescape.wiki/w/Special:PermanentLink/37142878) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie swab | Member | [Zombie swab, 37142875](https://runescape.wiki/w/Special:PermanentLink/37142875) | All typed Monster infoboxes agree; retain pinned policy. |
| Fever spider | Member | [Fever spider, 37133456](https://runescape.wiki/w/Special:PermanentLink/37133456) | All typed Monster infoboxes agree; retain pinned policy. |
| Catablepon | Free | [Catablepon, 37142100](https://runescape.wiki/w/Special:PermanentLink/37142100) | All typed Monster infoboxes agree; retain pinned policy. |
| Scorpion | Free | [Scorpion, 37143891](https://runescape.wiki/w/Special:PermanentLink/37143891) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton | Free | [Skeleton, 37188293](https://runescape.wiki/w/Special:PermanentLink/37188293) | All typed Monster infoboxes agree; retain pinned policy. |
| Jelly | Member | [Jelly, 37143358](https://runescape.wiki/w/Special:PermanentLink/37143358) | All typed Monster infoboxes agree; retain pinned policy. |
| Grizzly bear cub | Member | [Grizzly bear cub, 37143325](https://runescape.wiki/w/Special:PermanentLink/37143325) | All typed Monster infoboxes agree; retain pinned policy. |
| Tyras guard | Member | [Tyras guard, 37161617](https://runescape.wiki/w/Special:PermanentLink/37161617) | All typed Monster infoboxes agree; retain pinned policy. |
| Manifest shadow | Member | [Manifest shadow, 37179177](https://runescape.wiki/w/Special:PermanentLink/37179177) | All typed Monster infoboxes agree; retain pinned policy. |
| Jake | Member | [Jake, 37143361](https://runescape.wiki/w/Special:PermanentLink/37143361) | All typed Monster infoboxes agree; retain pinned policy. |
| Wilson | Member | [Wilson, 37143159](https://runescape.wiki/w/Special:PermanentLink/37143159) | All typed Monster infoboxes agree; retain pinned policy. |
| Palmer | Member | [Palmer, 37167005](https://runescape.wiki/w/Special:PermanentLink/37167005) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll brute | Free | [Troll brute, 37143575](https://runescape.wiki/w/Special:PermanentLink/37143575) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll chucker | Free | [Troll chucker, 37143578](https://runescape.wiki/w/Special:PermanentLink/37143578) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll shaman | Free | [Troll shaman, 37143562](https://runescape.wiki/w/Special:PermanentLink/37143562) | All typed Monster infoboxes agree; retain pinned policy. |
| Gelatinous abomination | Free | [Gelatinous abomination, 37127204](https://runescape.wiki/w/Special:PermanentLink/37127204) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave bug#Level 6 | Member | [Cave bug, 37123987](https://runescape.wiki/w/Special:PermanentLink/37123987) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghost | Free | [Ghost, 37144086](https://runescape.wiki/w/Special:PermanentLink/37144086) | All typed Monster infoboxes agree; retain pinned policy. |
| Ankou | Free | [Ankou, 37131602](https://runescape.wiki/w/Special:PermanentLink/37131602) | All typed Monster infoboxes agree; retain pinned policy. |
| Avatar of Destruction | Member | [Avatar of Destruction, 37138442](https://runescape.wiki/w/Special:PermanentLink/37138442) | All typed Monster infoboxes agree; retain pinned policy. |
| Dire Wolf | Member | [Dire Wolf, 37142450](https://runescape.wiki/w/Special:PermanentLink/37142450) | All typed Monster infoboxes agree; retain pinned policy. |
| Cadarn ranger | Member | [Cadarn ranger, 37142003](https://runescape.wiki/w/Special:PermanentLink/37142003) | All typed Monster infoboxes agree; retain pinned policy. |
| Cadarn magus | Member | [Cadarn magus, 37166211](https://runescape.wiki/w/Special:PermanentLink/37166211) | All typed Monster infoboxes agree; retain pinned policy. |
| King Black Dragon | Free | [King Black Dragon, 37188001](https://runescape.wiki/w/Special:PermanentLink/37188001) | All typed Monster infoboxes agree; retain pinned policy. |
| Mouse | Member | [Mouse, 37145914](https://runescape.wiki/w/Special:PermanentLink/37145914) | All typed Monster infoboxes agree; retain pinned policy. |
| Luminescent icefiend | Free | [Luminescent icefiend, 37143757](https://runescape.wiki/w/Special:PermanentLink/37143757) | All typed Monster infoboxes agree; retain pinned policy. |
| Celestial dragon | Member | [Celestial dragon, 37166344](https://runescape.wiki/w/Special:PermanentLink/37166344) | All typed Monster infoboxes agree; retain pinned policy. |
| Seeker | Member | [Seeker, 37168663](https://runescape.wiki/w/Special:PermanentLink/37168663) | All typed Monster infoboxes agree; retain pinned policy. |
| Soulgazer | Member | [Soulgazer, 37168664](https://runescape.wiki/w/Special:PermanentLink/37168664) | All typed Monster infoboxes agree; retain pinned policy. |
| Yak | Member | [Yak, 37143046](https://runescape.wiki/w/Special:PermanentLink/37143046) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll runt#Variant 2 | Member | [Ice troll runt, 37123712](https://runescape.wiki/w/Special:PermanentLink/37123712) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll male#Variant 2 | Member | [Ice troll male, 37123830](https://runescape.wiki/w/Special:PermanentLink/37123830) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll female#Variant 2 | Member | [Ice troll female, 37123831](https://runescape.wiki/w/Special:PermanentLink/37123831) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll runt#Variant 3 | Member | [Ice troll runt, 37123712](https://runescape.wiki/w/Special:PermanentLink/37123712) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll male#Variant 3 | Member | [Ice troll male, 37123830](https://runescape.wiki/w/Special:PermanentLink/37123830) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll female#Variant 3 | Member | [Ice troll female, 37123831](https://runescape.wiki/w/Special:PermanentLink/37123831) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll grunt#Variant 2 | Member | [Ice troll grunt, 37123710](https://runescape.wiki/w/Special:PermanentLink/37123710) | All typed Monster infoboxes agree; retain pinned policy. |
| Baby tanglefoot | Member | [Baby tanglefoot, 37130909](https://runescape.wiki/w/Special:PermanentLink/37130909) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant Lobster | Member | [Giant lobster, 37121511](https://runescape.wiki/w/Special:PermanentLink/37121511) | All typed Monster infoboxes agree; retain pinned policy. |
| Shade | Free | [Shade, 37159625](https://runescape.wiki/w/Special:PermanentLink/37159625) | All typed Monster infoboxes agree; retain pinned policy. |
| Armoured cow thing | Member | [Armoured cow thing, 37135696](https://runescape.wiki/w/Special:PermanentLink/37135696) | All typed Monster infoboxes agree; retain pinned policy. |
| Blessed spider | Member | [Blessed spider, 37142667](https://runescape.wiki/w/Special:PermanentLink/37142667) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalrag | Member | [Kalrag, 37144131](https://runescape.wiki/w/Special:PermanentLink/37144131) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome | Member | [Gnome, 37156912](https://runescape.wiki/w/Special:PermanentLink/37156912) | All typed Monster infoboxes agree; retain pinned policy. |
| Duck | Free | [Duck, 37176434](https://runescape.wiki/w/Special:PermanentLink/37176434) | All typed Monster infoboxes agree; retain pinned policy. |
| Terrorbird | Member | [Terrorbird, 37138523](https://runescape.wiki/w/Special:PermanentLink/37138523) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome child | Member | [Gnome child, 37156910](https://runescape.wiki/w/Special:PermanentLink/37156910) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome guard | Member | [Gnome guard, 37144105](https://runescape.wiki/w/Special:PermanentLink/37144105) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome woman | Member | [Gnome woman, 37156911](https://runescape.wiki/w/Special:PermanentLink/37156911) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome troop#Tree Gnome Stronghold | Member | [Gnome troop, 37139890](https://runescape.wiki/w/Special:PermanentLink/37139890) | All typed Monster infoboxes agree; retain pinned policy. |
| Mounted terrorbird gnome#Level 46 | Member | [Mounted terrorbird gnome, 37144447](https://runescape.wiki/w/Special:PermanentLink/37144447) | All typed Monster infoboxes agree; retain pinned policy. |
| Tortoise | Member | [Tortoise, 37133379](https://runescape.wiki/w/Special:PermanentLink/37133379) | All typed Monster infoboxes agree; retain pinned policy. |
| Otherworldly being | Member | [Otherworldly being, 37188498](https://runescape.wiki/w/Special:PermanentLink/37188498) | All typed Monster infoboxes agree; retain pinned policy. |
| San Tojalon | Member | [San Tojalon, 37146629](https://runescape.wiki/w/Special:PermanentLink/37146629) | All typed Monster infoboxes agree; retain pinned policy. |
| Irvig Senay | Member | [Irvig Senay, 37144117](https://runescape.wiki/w/Special:PermanentLink/37144117) | All typed Monster infoboxes agree; retain pinned policy. |
| Ranalph Devere | Member | [Ranalph Devere, 37144119](https://runescape.wiki/w/Special:PermanentLink/37144119) | All typed Monster infoboxes agree; retain pinned policy. |
| Bulky warrior | Member | [Bulky warrior, 37142840](https://runescape.wiki/w/Special:PermanentLink/37142840) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted scorpion | Member | [Corrupted scorpion, 37141870](https://runescape.wiki/w/Special:PermanentLink/37141870) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted scarab | Member | [Corrupted scarab, 37141906](https://runescape.wiki/w/Special:PermanentLink/37141906) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted lizard | Member | [Corrupted lizard, 37141903](https://runescape.wiki/w/Special:PermanentLink/37141903) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted dust devil | Member | [Corrupted dust devil, 37141898](https://runescape.wiki/w/Special:PermanentLink/37141898) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted kalphite guardian | Member | [Corrupted kalphite guardian, 37132758](https://runescape.wiki/w/Special:PermanentLink/37132758) | All typed Monster infoboxes agree; retain pinned policy. |
| Salawa akh | Member | [Salawa akh, 37143882](https://runescape.wiki/w/Special:PermanentLink/37143882) | All typed Monster infoboxes agree; retain pinned policy. |
| Feline akh | Member | [Feline akh, 37149199](https://runescape.wiki/w/Special:PermanentLink/37149199) | All typed Monster infoboxes agree; retain pinned policy. |
| Blessed giant rat | Member | [Blessed giant rat, 37167004](https://runescape.wiki/w/Special:PermanentLink/37167004) | All typed Monster infoboxes agree; retain pinned policy. |
| Unicorn | Free | [Unicorn, 37143246](https://runescape.wiki/w/Special:PermanentLink/37143246) | All typed Monster infoboxes agree; retain pinned policy. |
| Sir Jerro | Member | [Sir Jerro, 37143740](https://runescape.wiki/w/Special:PermanentLink/37143740) | All typed Monster infoboxes agree; retain pinned policy. |
| Sir Carl | Member | [Sir Carl, 37143748](https://runescape.wiki/w/Special:PermanentLink/37143748) | All typed Monster infoboxes agree; retain pinned policy. |
| Sir Harry | Member | [Sir Harry, 37143743](https://runescape.wiki/w/Special:PermanentLink/37143743) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogre | Member | [Ogre, 37143803](https://runescape.wiki/w/Special:PermanentLink/37143803) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll runt | Member | [Ice troll runt, 37123712](https://runescape.wiki/w/Special:PermanentLink/37123712) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll male | Member | [Ice troll male, 37123830](https://runescape.wiki/w/Special:PermanentLink/37123830) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll female | Member | [Ice troll female, 37123831](https://runescape.wiki/w/Special:PermanentLink/37123831) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll grunt | Member | [Ice troll grunt, 37123710](https://runescape.wiki/w/Special:PermanentLink/37123710) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogress champion | Member | [Ogress champion, 37143796](https://runescape.wiki/w/Special:PermanentLink/37143796) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogress warrior | Member | [Ogress warrior, 37133547](https://runescape.wiki/w/Special:PermanentLink/37133547) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogress | Member | [Ogress, 37133545](https://runescape.wiki/w/Special:PermanentLink/37133545) | All typed Monster infoboxes agree; retain pinned policy. |
| Jungle strykewyrm | Member | [Jungle strykewyrm, 37143678](https://runescape.wiki/w/Special:PermanentLink/37143678) | All typed Monster infoboxes agree; retain pinned policy. |
| Zogre | Member | [Zogre, 37143033](https://runescape.wiki/w/Special:PermanentLink/37143033) | All typed Monster infoboxes agree; retain pinned policy. |
| Skogre | Member | [Skogre, 37143611](https://runescape.wiki/w/Special:PermanentLink/37143611) | All typed Monster infoboxes agree; retain pinned policy. |
| Grave scorpion | Member | [Grave scorpion, 37143303](https://runescape.wiki/w/Special:PermanentLink/37143303) | All typed Monster infoboxes agree; retain pinned policy. |
| Khazard trooper | Member | [Khazard trooper, 37143308](https://runescape.wiki/w/Special:PermanentLink/37143308) | All typed Monster infoboxes agree; retain pinned policy. |
| Khazard warlord | Member | [Khazard warlord, 37143310](https://runescape.wiki/w/Special:PermanentLink/37143310) | All typed Monster infoboxes agree; retain pinned policy. |
| Acheron mammoth | Member | [Acheron mammoth, 37132636](https://runescape.wiki/w/Special:PermanentLink/37132636) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Knight | Free | [Black Knight, 37179287](https://runescape.wiki/w/Special:PermanentLink/37179287) | All typed Monster infoboxes agree; retain pinned policy. |
| Imperial warrior akh | Member | [Imperial warrior akh, 37143736](https://runescape.wiki/w/Special:PermanentLink/37143736) | All typed Monster infoboxes agree; retain pinned policy. |
| Imperial mage akh | Member | [Imperial mage akh, 37143731](https://runescape.wiki/w/Special:PermanentLink/37143731) | All typed Monster infoboxes agree; retain pinned policy. |
| Imperial ranger akh | Member | [Imperial ranger akh, 37143734](https://runescape.wiki/w/Special:PermanentLink/37143734) | All typed Monster infoboxes agree; retain pinned policy. |
| Crocodile akh | Member | [Crocodile akh, 37196576](https://runescape.wiki/w/Special:PermanentLink/37196576) | All typed Monster infoboxes agree; retain pinned policy. |
| Gorilla akh | Member | [Gorilla akh, 37143406](https://runescape.wiki/w/Special:PermanentLink/37143406) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted kalphite marauder | Member | [Corrupted kalphite marauder, 37132760](https://runescape.wiki/w/Special:PermanentLink/37132760) | All typed Monster infoboxes agree; retain pinned policy. |
| Corrupted worker | Member | [Corrupted worker, 37141868](https://runescape.wiki/w/Special:PermanentLink/37141868) | All typed Monster infoboxes agree; retain pinned policy. |
| Scarab akh | Member | [Scarab akh, 37144737](https://runescape.wiki/w/Special:PermanentLink/37144737) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie | Free | [Zombie, 37125135](https://runescape.wiki/w/Special:PermanentLink/37125135) | All typed Monster infoboxes agree; retain pinned policy. |
| Nightmare | Member | [Nightmare, 37166121](https://runescape.wiki/w/Special:PermanentLink/37166121) | All typed Monster infoboxes agree; retain pinned policy. |
| Carnivorous chinchompa | Free | [Carnivorous chinchompa, 37157359](https://runescape.wiki/w/Special:PermanentLink/37157359) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogre chieftain | Member | [Ogre chieftain, 37171428](https://runescape.wiki/w/Special:PermanentLink/37171428) | All typed Monster infoboxes agree; retain pinned policy. |
| City guard | Member | [City guard, 37166886](https://runescape.wiki/w/Special:PermanentLink/37166886) | All typed Monster infoboxes agree; retain pinned policy. |
| Enclave guard | Member | [Enclave guard, 37130931](https://runescape.wiki/w/Special:PermanentLink/37130931) | All typed Monster infoboxes agree; retain pinned policy. |
| Tower guard | Member | [Tower guard, 37143605](https://runescape.wiki/w/Special:PermanentLink/37143605) | All typed Monster infoboxes agree; retain pinned policy. |
| Colonel Radick | Member | [Colonel Radick, 37142108](https://runescape.wiki/w/Special:PermanentLink/37142108) | All typed Monster infoboxes agree; retain pinned policy. |
| Watchman | Member | [Watchman, 37156907](https://runescape.wiki/w/Special:PermanentLink/37156907) | All typed Monster infoboxes agree; retain pinned policy. |
| Khazard commander | Member | [Khazard commander, 37131699](https://runescape.wiki/w/Special:PermanentLink/37131699) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnome troop#Battlefield of Khazard | Member | [Gnome troop, 37139890](https://runescape.wiki/w/Special:PermanentLink/37139890) | All typed Monster infoboxes agree; retain pinned policy. |
| Mounted terrorbird gnome#Level 53 | Member | [Mounted terrorbird gnome, 37144447](https://runescape.wiki/w/Special:PermanentLink/37144447) | All typed Monster infoboxes agree; retain pinned policy. |
| Knight of Ardougne | Member | [Knight of Ardougne, 37156902](https://runescape.wiki/w/Special:PermanentLink/37156902) | All typed Monster infoboxes agree; retain pinned policy. |
| Rock crab | Member | [Rock crab, 37144553](https://runescape.wiki/w/Special:PermanentLink/37144553) | All typed Monster infoboxes agree; retain pinned policy. |
| Einar | Member | [Einar, 37142635](https://runescape.wiki/w/Special:PermanentLink/37142635) | All typed Monster infoboxes agree; retain pinned policy. |
| Alrik | Member | [Alrik, 37131198](https://runescape.wiki/w/Special:PermanentLink/37131198) | All typed Monster infoboxes agree; retain pinned policy. |
| Thorhild | Member | [Thorhild, 37143633](https://runescape.wiki/w/Special:PermanentLink/37143633) | All typed Monster infoboxes agree; retain pinned policy. |
| Halla | Member | [Halla, 37148860](https://runescape.wiki/w/Special:PermanentLink/37148860) | All typed Monster infoboxes agree; retain pinned policy. |
| Rannveig | Member | [Rannveig, 37144699](https://runescape.wiki/w/Special:PermanentLink/37144699) | All typed Monster infoboxes agree; retain pinned policy. |
| Valgerd | Member | [Valgerd, 37143206](https://runescape.wiki/w/Special:PermanentLink/37143206) | All typed Monster infoboxes agree; retain pinned policy. |
| Skraeling | Member | [Skraeling, 37143613](https://runescape.wiki/w/Special:PermanentLink/37143613) | All typed Monster infoboxes agree; retain pinned policy. |
| Broddi | Member | [Broddi, 37142850](https://runescape.wiki/w/Special:PermanentLink/37142850) | All typed Monster infoboxes agree; retain pinned policy. |
| Ragnvald | Member | [Ragnvald, 37144696](https://runescape.wiki/w/Special:PermanentLink/37144696) | All typed Monster infoboxes agree; retain pinned policy. |
| Monkey | Free | [Monkey, 37167010](https://runescape.wiki/w/Special:PermanentLink/37167010) | All typed Monster infoboxes agree; retain pinned policy. |
| The Shaikahan | Member | [The Shaikahan, 37144469](https://runescape.wiki/w/Special:PermanentLink/37144469) | All typed Monster infoboxes agree; retain pinned policy. |
| TzHaar-Hur | Member | [TzHaar-Hur, 37159853](https://runescape.wiki/w/Special:PermanentLink/37159853) | All typed Monster infoboxes agree; retain pinned policy. |
| Gorad | Member | [Gorad, 37171630](https://runescape.wiki/w/Special:PermanentLink/37171630) | All typed Monster infoboxes agree; retain pinned policy. |
| Khazard Guard | Member | [Khazard Guard, 37139376](https://runescape.wiki/w/Special:PermanentLink/37139376) | All typed Monster infoboxes agree; retain pinned policy. |
| Warrior woman | Member | [Warrior woman, 37156859](https://runescape.wiki/w/Special:PermanentLink/37156859) | All typed Monster infoboxes agree; retain pinned policy. |
| Paladin | Member | [Paladin, 37164339](https://runescape.wiki/w/Special:PermanentLink/37164339) | All typed Monster infoboxes agree; retain pinned policy. |
| Pit Scorpion | Member | [Pit Scorpion, 37138843](https://runescape.wiki/w/Special:PermanentLink/37138843) | All typed Monster infoboxes agree; retain pinned policy. |
| Snake | Free | [Snake, 37144007](https://runescape.wiki/w/Special:PermanentLink/37144007) | All typed Monster infoboxes agree; retain pinned policy. |
| Fenris wolf | Member | [Fenris wolf, 37143126](https://runescape.wiki/w/Special:PermanentLink/37143126) | All typed Monster infoboxes agree; retain pinned policy. |
| Tormented demon | Member | [Tormented demon, 37178905](https://runescape.wiki/w/Special:PermanentLink/37178905) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos druid warrior | Member | [Chaos druid warrior, 37139627](https://runescape.wiki/w/Special:PermanentLink/37139627) | All typed Monster infoboxes agree; retain pinned policy. |
| Salarin the Twisted | Member | [Salarin the Twisted, 37144557](https://runescape.wiki/w/Special:PermanentLink/37144557) | All typed Monster infoboxes agree; retain pinned policy. |
| Dungeon rat | Member | [Dungeon rat, 37130924](https://runescape.wiki/w/Special:PermanentLink/37130924) | All typed Monster infoboxes agree; retain pinned policy. |
| Head Thief | Member | [Head Thief, 37130921](https://runescape.wiki/w/Special:PermanentLink/37130921) | All typed Monster infoboxes agree; retain pinned policy. |
| Alomone | Member | [Alomone, 37131205](https://runescape.wiki/w/Special:PermanentLink/37131205) | All typed Monster infoboxes agree; retain pinned policy. |
| Hazeel Cultist | Member | [Hazeel Cultist, 37143629](https://runescape.wiki/w/Special:PermanentLink/37143629) | All typed Monster infoboxes agree; retain pinned policy. |
| Shadow spider | Member | [Shadow spider, 37144444](https://runescape.wiki/w/Special:PermanentLink/37144444) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton Mage | Member | [Skeleton Mage, 37144800](https://runescape.wiki/w/Special:PermanentLink/37144800) | All typed Monster infoboxes agree; retain pinned policy. |
| Sea Snake Young | Member | [Sea Snake Young, 37167198](https://runescape.wiki/w/Special:PermanentLink/37167198) | All typed Monster infoboxes agree; retain pinned policy. |
| Sea Snake Hatchling | Member | [Sea Snake Hatchling, 37171429](https://runescape.wiki/w/Special:PermanentLink/37171429) | All typed Monster infoboxes agree; retain pinned policy. |
| Invrigar the Necromancer | Member | [Invrigar the Necromancer, 37137909](https://runescape.wiki/w/Special:PermanentLink/37137909) | All typed Monster infoboxes agree; retain pinned policy. |
| Hero | Member | [Hero, 37162438](https://runescape.wiki/w/Special:PermanentLink/37162438) | All typed Monster infoboxes agree; retain pinned policy. |
| Guard dog | Member | [Guard dog, 37143316](https://runescape.wiki/w/Special:PermanentLink/37143316) | All typed Monster infoboxes agree; retain pinned policy. |
| Fox | Member | [Fox, 37142960](https://runescape.wiki/w/Special:PermanentLink/37142960) | All typed Monster infoboxes agree; retain pinned policy. |
| Jennella | Member | [Jennella, 37156895](https://runescape.wiki/w/Special:PermanentLink/37156895) | All typed Monster infoboxes agree; retain pinned policy. |
| Killerwatt | Member | [Killerwatt, 37143332](https://runescape.wiki/w/Special:PermanentLink/37143332) | All typed Monster infoboxes agree; retain pinned policy. |
| Wild dog | Member | [Wild dog, 37143156](https://runescape.wiki/w/Special:PermanentLink/37143156) | All typed Monster infoboxes agree; retain pinned policy. |
| Guardian of Armadyl | Member | [Guardian of Armadyl, 37137923](https://runescape.wiki/w/Special:PermanentLink/37137923) | All typed Monster infoboxes agree; retain pinned policy. |
| Icelord | Member | [Icelord, 37143292](https://runescape.wiki/w/Special:PermanentLink/37143292) | All typed Monster infoboxes agree; retain pinned policy. |
| Monkey Archer | Member | [Monkey Archer, 37133601](https://runescape.wiki/w/Special:PermanentLink/37133601) | All typed Monster infoboxes agree; retain pinned policy. |
| Wandering warrior | Member | [Wandering warrior, 37170613](https://runescape.wiki/w/Special:PermanentLink/37170613) | All typed Monster infoboxes agree; retain pinned policy. |
| Poison Scorpion | Member | [Poison Scorpion, 37143914](https://runescape.wiki/w/Special:PermanentLink/37143914) | All typed Monster infoboxes agree; retain pinned policy. |
| Woman | Free | [Woman, 37156833](https://runescape.wiki/w/Special:PermanentLink/37156833) | All typed Monster infoboxes agree; retain pinned policy. |
| Highwayman | Free | [Highwayman, 37143594](https://runescape.wiki/w/Special:PermanentLink/37143594) | All typed Monster infoboxes agree; retain pinned policy. |
| Bunny | Member | [Bunny, 37142845](https://runescape.wiki/w/Special:PermanentLink/37142845) | All typed Monster infoboxes agree; retain pinned policy. |
| Bear cub | Free | [Bear cub, 37142816](https://runescape.wiki/w/Special:PermanentLink/37142816) | All typed Monster infoboxes agree; retain pinned policy. |
| Bat | Free | [Bat, 37138430](https://runescape.wiki/w/Special:PermanentLink/37138430) | All typed Monster infoboxes agree; retain pinned policy. |
| Shadow Hound | Member | [Shadow Hound, 37144767](https://runescape.wiki/w/Special:PermanentLink/37144767) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave crawler | Member | [Cave crawler, 37144937](https://runescape.wiki/w/Special:PermanentLink/37144937) | All typed Monster infoboxes agree; retain pinned policy. |
| Rock slug | Member | [Rock slug, 37161470](https://runescape.wiki/w/Special:PermanentLink/37161470) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant frog | Member | [Giant frog, 37139641](https://runescape.wiki/w/Special:PermanentLink/37139641) | All typed Monster infoboxes agree; retain pinned policy. |
| Big frog | Member | [Big frog, 37139045](https://runescape.wiki/w/Special:PermanentLink/37139045) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave slime | Member | [Cave slime, 37139622](https://runescape.wiki/w/Special:PermanentLink/37139622) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave bug | Member | [Cave bug, 37123987](https://runescape.wiki/w/Special:PermanentLink/37123987) | All typed Monster infoboxes agree; retain pinned policy. |
| Molanisk | Member | [Molanisk, 37144545](https://runescape.wiki/w/Special:PermanentLink/37144545) | All typed Monster infoboxes agree; retain pinned policy. |
| Monkey Zombie | Member | [Monkey Zombie, 37130848](https://runescape.wiki/w/Special:PermanentLink/37130848) | All typed Monster infoboxes agree; retain pinned policy. |
| Red dragon | Free | [Red dragon, 37132801](https://runescape.wiki/w/Special:PermanentLink/37132801) | All typed Monster infoboxes agree; retain pinned policy. |
| Baby red dragon | Member | [Baby red dragon, 37141678](https://runescape.wiki/w/Special:PermanentLink/37141678) | All typed Monster infoboxes agree; retain pinned policy. |
| Bronze dragon | Member | [Bronze dragon, 37132807](https://runescape.wiki/w/Special:PermanentLink/37132807) | All typed Monster infoboxes agree; retain pinned policy. |
| Shadow warrior | Member | [Shadow warrior, 37143907](https://runescape.wiki/w/Special:PermanentLink/37143907) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice spider | Member | [Ice spider, 37143387](https://runescape.wiki/w/Special:PermanentLink/37143387) | All typed Monster infoboxes agree; retain pinned policy. |
| Fire elemental | Member | [Fire elemental, 37143145](https://runescape.wiki/w/Special:PermanentLink/37143145) | All typed Monster infoboxes agree; retain pinned policy. |
| Earth elemental | Member | [Earth elemental, 37133383](https://runescape.wiki/w/Special:PermanentLink/37133383) | All typed Monster infoboxes agree; retain pinned policy. |
| Air elemental | Member | [Air elemental, 37188442](https://runescape.wiki/w/Special:PermanentLink/37188442) | All typed Monster infoboxes agree; retain pinned policy. |
| Water elemental | Member | [Water elemental, 37143111](https://runescape.wiki/w/Special:PermanentLink/37143111) | All typed Monster infoboxes agree; retain pinned policy. |
| Aquanite | Member | [Aquanite, 37159860](https://runescape.wiki/w/Special:PermanentLink/37159860) | All typed Monster infoboxes agree; retain pinned policy. |
| Kurask | Member | [Kurask, 37143313](https://runescape.wiki/w/Special:PermanentLink/37143313) | All typed Monster infoboxes agree; retain pinned policy. |
| Basilisk | Member | [Basilisk, 37168917](https://runescape.wiki/w/Special:PermanentLink/37168917) | All typed Monster infoboxes agree; retain pinned policy. |
| Turoth | Member | [Turoth, 37153486](https://runescape.wiki/w/Special:PermanentLink/37153486) | All typed Monster infoboxes agree; retain pinned policy. |
| Rock Crab | Member | [Rock crab, 37144553](https://runescape.wiki/w/Special:PermanentLink/37144553) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeleton fremennik | Member | [Skeleton fremennik, 37145322](https://runescape.wiki/w/Special:PermanentLink/37145322) | All typed Monster infoboxes agree; retain pinned policy. |
| Brine rat | Member | [Brine rat, 37133006](https://runescape.wiki/w/Special:PermanentLink/37133006) | All typed Monster infoboxes agree; retain pinned policy. |
| Padulah | Member | [Padulah, 37131975](https://runescape.wiki/w/Special:PermanentLink/37131975) | All typed Monster infoboxes agree; retain pinned policy. |
| Monkey Guard | Member | [Monkey Guard, 37137905](https://runescape.wiki/w/Special:PermanentLink/37137905) | All typed Monster infoboxes agree; retain pinned policy. |
| Oomlie bird | Member | [Oomlie bird, 37144616](https://runescape.wiki/w/Special:PermanentLink/37144616) | All typed Monster infoboxes agree; retain pinned policy. |
| Jungle Wolf | Member | [Jungle Wolf, 37134003](https://runescape.wiki/w/Special:PermanentLink/37134003) | All typed Monster infoboxes agree; retain pinned policy. |
| Jungle dweller | Member | [Jungle dweller, 37143817](https://runescape.wiki/w/Special:PermanentLink/37143817) | All typed Monster infoboxes agree; retain pinned policy. |
| Broodoo victim | Member | [Broodoo victim, 37170898](https://runescape.wiki/w/Special:PermanentLink/37170898) | All typed Monster infoboxes agree; retain pinned policy. |
| Large mosquito | Member | [Large mosquito, 37144156](https://runescape.wiki/w/Special:PermanentLink/37144156) | All typed Monster infoboxes agree; retain pinned policy. |
| Mosquito swarm | Member | [Mosquito swarm, 37144578](https://runescape.wiki/w/Special:PermanentLink/37144578) | All typed Monster infoboxes agree; retain pinned policy. |
| Bush snake | Member | [Bush snake, 37138418](https://runescape.wiki/w/Special:PermanentLink/37138418) | All typed Monster infoboxes agree; retain pinned policy. |
| Pirate Guard | Member | [Pirate Guard, 37139615](https://runescape.wiki/w/Special:PermanentLink/37139615) | All typed Monster infoboxes agree; retain pinned policy. |
| Renegade Knight | Member | [Renegade Knight, 37144550](https://runescape.wiki/w/Special:PermanentLink/37144550) | All typed Monster infoboxes agree; retain pinned policy. |
| Sir Mordred | Member | [Sir Mordred, 37143709](https://runescape.wiki/w/Special:PermanentLink/37143709) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice giant | Free | [Ice giant, 37164944](https://runescape.wiki/w/Special:PermanentLink/37164944) | All typed Monster infoboxes agree; retain pinned policy. |
| Camp dweller | Member | [Camp dweller, 37143100](https://runescape.wiki/w/Special:PermanentLink/37143100) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice wolf | Member | [Ice wolf, 37171625](https://runescape.wiki/w/Special:PermanentLink/37171625) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghostly warrior | Member | [Ghostly warrior, 37167126](https://runescape.wiki/w/Special:PermanentLink/37167126) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Knight Titan | Member | [Black Knight Titan, 37145556](https://runescape.wiki/w/Special:PermanentLink/37145556) | All typed Monster infoboxes agree; retain pinned policy. |
| Water wizard | Free | [Water wizard, 37143113](https://runescape.wiki/w/Special:PermanentLink/37143113) | All typed Monster infoboxes agree; retain pinned policy. |
| Earth wizard | Free | [Earth wizard, 37142624](https://runescape.wiki/w/Special:PermanentLink/37142624) | All typed Monster infoboxes agree; retain pinned policy. |
| Death wing | Member | [Death wing, 37142375](https://runescape.wiki/w/Special:PermanentLink/37142375) | All typed Monster infoboxes agree; retain pinned policy. |
| Ungadulu | Member | [Ungadulu, 37171383](https://runescape.wiki/w/Special:PermanentLink/37171383) | All typed Monster infoboxes agree; retain pinned policy. |
| Experiment No.2 | Member | [Experiment No.2, 37142702](https://runescape.wiki/w/Special:PermanentLink/37142702) | All typed Monster infoboxes agree; retain pinned policy. |
| Cockatrice | Member | [Cockatrice, 37144939](https://runescape.wiki/w/Special:PermanentLink/37144939) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice Troll | Member | [Ice troll, 37167264](https://runescape.wiki/w/Special:PermanentLink/37167264) | All typed Monster infoboxes agree; retain pinned policy. |
| Undead one | Member | [Undead one, 37143243](https://runescape.wiki/w/Special:PermanentLink/37143243) | All typed Monster infoboxes agree; retain pinned policy. |
| Harpie Bug Swarm | Member | [Harpie Bug Swarm, 37143403](https://runescape.wiki/w/Special:PermanentLink/37143403) | All typed Monster infoboxes agree; retain pinned policy. |
| King Scorpion | Free | [King Scorpion, 37153216](https://runescape.wiki/w/Special:PermanentLink/37153216) | All typed Monster infoboxes agree; retain pinned policy. |
| Adolescent White wolf | Free | [Adolescent White wolf, 37131145](https://runescape.wiki/w/Special:PermanentLink/37131145) | All typed Monster infoboxes agree; retain pinned policy. |
| White wolf | Member | [White wolf, 37143137](https://runescape.wiki/w/Special:PermanentLink/37143137) | All typed Monster infoboxes agree; retain pinned policy. |
| Big Wolf | Member | [Big Wolf, 37141985](https://runescape.wiki/w/Special:PermanentLink/37141985) | All typed Monster infoboxes agree; retain pinned policy. |
| Cyclops | Free | [Cyclops, 37142278](https://runescape.wiki/w/Special:PermanentLink/37142278) | All typed Monster infoboxes agree; retain pinned policy. |
| Cyclossus | Free | [Cyclossus, 37123704](https://runescape.wiki/w/Special:PermanentLink/37123704) | All typed Monster infoboxes agree; retain pinned policy. |
| Stick | Free | [Stick, 37174107](https://runescape.wiki/w/Special:PermanentLink/37174107) | All typed Monster infoboxes agree; retain pinned policy. |
| Pee Hat | Member | [Pee Hat, 37144493](https://runescape.wiki/w/Special:PermanentLink/37144493) | All typed Monster infoboxes agree; retain pinned policy. |
| Kraka | Member | [Kraka, 37143297](https://runescape.wiki/w/Special:PermanentLink/37143297) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll | Member | [Ice troll, 37167264](https://runescape.wiki/w/Special:PermanentLink/37167264) | All typed Monster infoboxes agree; retain pinned policy. |
| Armoured zombie | Member | [Armoured zombie, 37185832](https://runescape.wiki/w/Special:PermanentLink/37185832) | All typed Monster infoboxes agree; retain pinned policy. |
| Tormented wraith | Member | [Tormented wraith, 37185577](https://runescape.wiki/w/Special:PermanentLink/37185577) | All typed Monster infoboxes agree; retain pinned policy. |
| Ancient warrior | Member | [Ancient warrior, 37166890](https://runescape.wiki/w/Special:PermanentLink/37166890) | All typed Monster infoboxes agree; retain pinned policy. |
| Ancient ranger | Member | [Ancient ranger, 37166887](https://runescape.wiki/w/Special:PermanentLink/37166887) | All typed Monster infoboxes agree; retain pinned policy. |
| Blood reaver | Member | [Blood reaver, 37166888](https://runescape.wiki/w/Special:PermanentLink/37166888) | All typed Monster infoboxes agree; retain pinned policy. |
| Ancient mage | Member | [Ancient mage, 37166889](https://runescape.wiki/w/Special:PermanentLink/37166889) | All typed Monster infoboxes agree; retain pinned policy. |
| Werewolf | Member | [Werewolf, 37122455](https://runescape.wiki/w/Special:PermanentLink/37122455) | All typed Monster infoboxes agree; retain pinned policy. |
| Vampyre | Member | [Vampyre, 37192289](https://runescape.wiki/w/Special:PermanentLink/37192289) | All typed Monster infoboxes agree; retain pinned policy. |
| Bloodveld | Member | [Bloodveld, 37144874](https://runescape.wiki/w/Special:PermanentLink/37144874) | All typed Monster infoboxes agree; retain pinned policy. |
| Gorak | Member | [Gorak, 37139715](https://runescape.wiki/w/Special:PermanentLink/37139715) | All typed Monster infoboxes agree; retain pinned policy. |
| Spiritual ranger | Member | [Spiritual ranger, 37143718](https://runescape.wiki/w/Special:PermanentLink/37143718) | All typed Monster infoboxes agree; retain pinned policy. |
| Kree'arra | Member | [Kree'arra, 37171421](https://runescape.wiki/w/Special:PermanentLink/37171421) | All typed Monster infoboxes agree; retain pinned policy. |
| Wingman Skree | Member | [Wingman Skree, 37171408](https://runescape.wiki/w/Special:PermanentLink/37171408) | All typed Monster infoboxes agree; retain pinned policy. |
| Flockleader Geerin | Member | [Flockleader Geerin, 37171406](https://runescape.wiki/w/Special:PermanentLink/37171406) | All typed Monster infoboxes agree; retain pinned policy. |
| Flight Kilisa | Member | [Flight Kilisa, 37171407](https://runescape.wiki/w/Special:PermanentLink/37171407) | All typed Monster infoboxes agree; retain pinned policy. |
| Spiritual warrior | Member | [Spiritual warrior, 37143717](https://runescape.wiki/w/Special:PermanentLink/37143717) | All typed Monster infoboxes agree; retain pinned policy. |
| Spiritual mage | Member | [Spiritual mage, 37143719](https://runescape.wiki/w/Special:PermanentLink/37143719) | All typed Monster infoboxes agree; retain pinned policy. |
| Aviansie | Member | [Aviansie, 37159861](https://runescape.wiki/w/Special:PermanentLink/37159861) | All typed Monster infoboxes agree; retain pinned policy. |
| General Graardor | Member | [General Graardor, 37171419](https://runescape.wiki/w/Special:PermanentLink/37171419) | All typed Monster infoboxes agree; retain pinned policy. |
| Sergeant Strongstack | Member | [Sergeant Strongstack, 37171418](https://runescape.wiki/w/Special:PermanentLink/37171418) | All typed Monster infoboxes agree; retain pinned policy. |
| Sergeant Steelwill | Member | [Sergeant Steelwill, 37171416](https://runescape.wiki/w/Special:PermanentLink/37171416) | All typed Monster infoboxes agree; retain pinned policy. |
| Sergeant Grimspike | Member | [Sergeant Grimspike, 37171417](https://runescape.wiki/w/Special:PermanentLink/37171417) | All typed Monster infoboxes agree; retain pinned policy. |
| Jogre | Member | [Jogre, 37143397](https://runescape.wiki/w/Special:PermanentLink/37143397) | All typed Monster infoboxes agree; retain pinned policy. |
| Ork | Member | [Ork, 37135781](https://runescape.wiki/w/Special:PermanentLink/37135781) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice Queen | Member | [Ice Queen, 37137986](https://runescape.wiki/w/Special:PermanentLink/37137986) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll general | Member | [Troll general, 37143582](https://runescape.wiki/w/Special:PermanentLink/37143582) | All typed Monster infoboxes agree; retain pinned policy. |
| Berry | Member | [Berry, 37138428](https://runescape.wiki/w/Special:PermanentLink/37138428) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Guard Berserker | Member | [Black Guard Berserker, 37148511](https://runescape.wiki/w/Special:PermanentLink/37148511) | All typed Monster infoboxes agree; retain pinned policy. |
| Trade floor guard | Member | [Trade floor guard, 37197848](https://runescape.wiki/w/Special:PermanentLink/37197848) | All typed Monster infoboxes agree; retain pinned policy. |
| Frog | Member | [Frog, 37143800](https://runescape.wiki/w/Special:PermanentLink/37143800) | All typed Monster infoboxes agree; retain pinned policy. |
| Tenacious toucan | Member | [Tenacious toucan, 37184327](https://runescape.wiki/w/Special:PermanentLink/37184327) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant ant worker | Member | [Giant ant worker, 37144095](https://runescape.wiki/w/Special:PermanentLink/37144095) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant ant soldier | Member | [Giant ant soldier, 37144096](https://runescape.wiki/w/Special:PermanentLink/37144096) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant wasp | Member | [Giant wasp, 37133391](https://runescape.wiki/w/Special:PermanentLink/37133391) | All typed Monster infoboxes agree; retain pinned policy. |
| Pernicious parrot | Member | [Pernicious parrot, 37144629](https://runescape.wiki/w/Special:PermanentLink/37144629) | All typed Monster infoboxes agree; retain pinned policy. |
| Hollowtoof | Free | [Hollowtoof, 37122173](https://runescape.wiki/w/Special:PermanentLink/37122173) | All typed Monster infoboxes agree; retain pinned policy. |
| Goblin Raider#Forest | Free | [Goblin Raider, 37126451](https://runescape.wiki/w/Special:PermanentLink/37126451) | All typed Monster infoboxes agree; retain pinned policy. |
| Goblin Raider#Farm | Free | [Goblin Raider, 37126451](https://runescape.wiki/w/Special:PermanentLink/37126451) | All typed Monster infoboxes agree; retain pinned policy. |
| Troll spectator | Member | [Troll spectator, 37143314](https://runescape.wiki/w/Special:PermanentLink/37143314) | All typed Monster infoboxes agree; retain pinned policy. |
| Dad | Member | [Dad, 37142298](https://runescape.wiki/w/Special:PermanentLink/37142298) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Black Knight | Member | [Elite Black Knight, 37167031](https://runescape.wiki/w/Special:PermanentLink/37167031) | All typed Monster infoboxes agree; retain pinned policy. |
| Undead troll | Member | [Undead troll, 37167033](https://runescape.wiki/w/Special:PermanentLink/37167033) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagannoth Supreme | Member | [Dagannoth Supreme, 37174152](https://runescape.wiki/w/Special:PermanentLink/37174152) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagannoth Prime | Member | [Dagannoth Prime, 37156405](https://runescape.wiki/w/Special:PermanentLink/37156405) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagannoth Rex | Member | [Dagannoth Rex, 37156403](https://runescape.wiki/w/Special:PermanentLink/37156403) | All typed Monster infoboxes agree; retain pinned policy. |
| Spinolyp | Member | [Spinolyp, 37143989](https://runescape.wiki/w/Special:PermanentLink/37143989) | All typed Monster infoboxes agree; retain pinned policy. |
| Commander Zilyana | Member | [Commander Zilyana, 37171420](https://runescape.wiki/w/Special:PermanentLink/37171420) | All typed Monster infoboxes agree; retain pinned policy. |
| Starlight | Member | [Starlight, 37171412](https://runescape.wiki/w/Special:PermanentLink/37171412) | All typed Monster infoboxes agree; retain pinned policy. |
| Growler | Member | [Growler, 37171410](https://runescape.wiki/w/Special:PermanentLink/37171410) | All typed Monster infoboxes agree; retain pinned policy. |
| Bree | Member | [Bree, 37171409](https://runescape.wiki/w/Special:PermanentLink/37171409) | All typed Monster infoboxes agree; retain pinned policy. |
| Saradomin priest | Member | [Saradomin priest, 37143863](https://runescape.wiki/w/Special:PermanentLink/37143863) | All typed Monster infoboxes agree; retain pinned policy. |
| Knight of Saradomin | Member | [Knight of Saradomin, 37143778](https://runescape.wiki/w/Special:PermanentLink/37143778) | All typed Monster infoboxes agree; retain pinned policy. |
| K'ril Tsutsaroth | Member | [K'ril Tsutsaroth, 37171422](https://runescape.wiki/w/Special:PermanentLink/37171422) | All typed Monster infoboxes agree; retain pinned policy. |
| Tstanon Karlak | Member | [Tstanon Karlak, 37171414](https://runescape.wiki/w/Special:PermanentLink/37171414) | All typed Monster infoboxes agree; retain pinned policy. |
| Zakl'n Gritch | Member | [Zakl'n Gritch, 37171415](https://runescape.wiki/w/Special:PermanentLink/37171415) | All typed Monster infoboxes agree; retain pinned policy. |
| Balfrug Kreeyath | Member | [Balfrug Kreeyath, 37171413](https://runescape.wiki/w/Special:PermanentLink/37171413) | All typed Monster infoboxes agree; retain pinned policy. |
| Melzar the Mad | Free | [Melzar the Mad, 37166354](https://runescape.wiki/w/Special:PermanentLink/37166354) | All typed Monster infoboxes agree; retain pinned policy. |
| Jailer | Member | [Jailer, 37130812](https://runescape.wiki/w/Special:PermanentLink/37130812) | All typed Monster infoboxes agree; retain pinned policy. |
| Baby blue dragon | Member | [Baby blue dragon, 37138646](https://runescape.wiki/w/Special:PermanentLink/37138646) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos dwarf | Member | [Chaos dwarf, 37200599](https://runescape.wiki/w/Special:PermanentLink/37200599) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice demon | Member | [Ice demon, 37158043](https://runescape.wiki/w/Special:PermanentLink/37158043) | All typed Monster infoboxes agree; retain pinned policy. |
| Foreman | Member | [Foreman, 37143799](https://runescape.wiki/w/Special:PermanentLink/37143799) | All typed Monster infoboxes agree; retain pinned policy. |
| Mogre | Member | [Mogre, 37177671](https://runescape.wiki/w/Special:PermanentLink/37177671) | All typed Monster infoboxes agree; retain pinned policy. |
| Hengel | Free | [Hengel, 37156817](https://runescape.wiki/w/Special:PermanentLink/37156817) | All typed Monster infoboxes agree; retain pinned policy. |
| Anja | Free | [Anja, 37156814](https://runescape.wiki/w/Special:PermanentLink/37156814) | All typed Monster infoboxes agree; retain pinned policy. |
| Goblin Raider#Mine | Free | [Goblin Raider, 37126451](https://runescape.wiki/w/Special:PermanentLink/37126451) | All typed Monster infoboxes agree; retain pinned policy. |
| Fire wizard | Free | [Fire wizard, 37142880](https://runescape.wiki/w/Special:PermanentLink/37142880) | All typed Monster infoboxes agree; retain pinned policy. |
| Air wizard | Free | [Air wizard, 37130380](https://runescape.wiki/w/Special:PermanentLink/37130380) | All typed Monster infoboxes agree; retain pinned policy. |
| Stag | Free | [Stag, 37142109](https://runescape.wiki/w/Special:PermanentLink/37142109) | All typed Monster infoboxes agree; retain pinned policy. |
| Drunken man | Free | [Drunken man, 37156815](https://runescape.wiki/w/Special:PermanentLink/37156815) | All typed Monster infoboxes agree; retain pinned policy. |
| White Knight | Free | [White Knight, 37133389](https://runescape.wiki/w/Special:PermanentLink/37133389) | All typed Monster infoboxes agree; retain pinned policy. |
| Drake | Free | [Drake, 37142528](https://runescape.wiki/w/Special:PermanentLink/37142528) | All typed Monster infoboxes agree; retain pinned policy. |
| Cuffs | Free | [Cuffs, 37156818](https://runescape.wiki/w/Special:PermanentLink/37156818) | All typed Monster infoboxes agree; retain pinned policy. |
| Narf | Free | [Narf, 37156827](https://runescape.wiki/w/Special:PermanentLink/37156827) | All typed Monster infoboxes agree; retain pinned policy. |
| Rusty | Free | [Rusty, 37156822](https://runescape.wiki/w/Special:PermanentLink/37156822) | All typed Monster infoboxes agree; retain pinned policy. |
| Jeff | Free | [Jeff, 37156832](https://runescape.wiki/w/Special:PermanentLink/37156832) | All typed Monster infoboxes agree; retain pinned policy. |
| Lumpnose | Member | [Lumpnose, 37127116](https://runescape.wiki/w/Special:PermanentLink/37127116) | All typed Monster infoboxes agree; retain pinned policy. |
| Brokeface | Member | [Brokeface, 37127117](https://runescape.wiki/w/Special:PermanentLink/37127117) | All typed Monster infoboxes agree; retain pinned policy. |
| Stinkears | Member | [Stinkears, 37127118](https://runescape.wiki/w/Special:PermanentLink/37127118) | All typed Monster infoboxes agree; retain pinned policy. |
| Green dragon | Free | [Green dragon, 37132803](https://runescape.wiki/w/Special:PermanentLink/37132803) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice strykewyrm | Member | [Ice strykewyrm, 37188239](https://runescape.wiki/w/Special:PermanentLink/37188239) | All typed Monster infoboxes agree; retain pinned policy. |
| Wyvern | Member | [Wyvern, 37188439](https://runescape.wiki/w/Special:PermanentLink/37188439) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon ash lord | Member | [Greater demon ash lord, 37143312](https://runescape.wiki/w/Special:PermanentLink/37143312) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon berserker | Member | [Greater demon berserker, 37143317](https://runescape.wiki/w/Special:PermanentLink/37143317) | All typed Monster infoboxes agree; retain pinned policy. |
| Glacor | Member | [Glacor, 37166800](https://runescape.wiki/w/Special:PermanentLink/37166800) | All typed Monster infoboxes agree; retain pinned policy. |
| Corporeal Beast | Member | [Corporeal Beast, 37153250](https://runescape.wiki/w/Special:PermanentLink/37153250) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled kalphite worker | Member | [Exiled kalphite worker, 37159847](https://runescape.wiki/w/Special:PermanentLink/37159847) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled kalphite soldier | Member | [Exiled kalphite soldier, 37159846](https://runescape.wiki/w/Special:PermanentLink/37159846) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled kalphite paragon | Member | [Exiled kalphite paragon, 37159845](https://runescape.wiki/w/Special:PermanentLink/37159845) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled kalphite guardian | Member | [Exiled kalphite guardian, 37170653](https://runescape.wiki/w/Special:PermanentLink/37170653) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled kalphite marauder | Member | [Exiled kalphite marauder, 37159869](https://runescape.wiki/w/Special:PermanentLink/37159869) | All typed Monster infoboxes agree; retain pinned policy. |
| Dragonstone dragon | Member | [Dragonstone dragon, 37188675](https://runescape.wiki/w/Special:PermanentLink/37188675) | All typed Monster infoboxes agree; retain pinned policy. |
| Onyx dragon | Member | [Onyx dragon, 37188677](https://runescape.wiki/w/Special:PermanentLink/37188677) | All typed Monster infoboxes agree; retain pinned policy. |
| Mudskipper | Member | [Mudskipper, 37163316](https://runescape.wiki/w/Special:PermanentLink/37163316) | All typed Monster infoboxes agree; retain pinned policy. |
| Mugger | Free | [Mugger, 37144567](https://runescape.wiki/w/Special:PermanentLink/37144567) | All typed Monster infoboxes agree; retain pinned policy. |
| Magic axe | Member | [Magic axe, 37144546](https://runescape.wiki/w/Special:PermanentLink/37144546) | All typed Monster infoboxes agree; retain pinned policy. |
| Dwarf gang member | Member | [Dwarf gang member, 37142614](https://runescape.wiki/w/Special:PermanentLink/37142614) | All typed Monster infoboxes agree; retain pinned policy. |
| Wormbrain | Free | [Wormbrain, 37143201](https://runescape.wiki/w/Special:PermanentLink/37143201) | All typed Monster infoboxes agree; retain pinned policy. |
| Port Sarim guard | Free | [Port Sarim guard, 37156877](https://runescape.wiki/w/Special:PermanentLink/37156877) | All typed Monster infoboxes agree; retain pinned policy. |
| Seagull | Free | [Seagull, 37144484](https://runescape.wiki/w/Special:PermanentLink/37144484) | All typed Monster infoboxes agree; retain pinned policy. |
| Bandit Brawler | Free | [Bandit Brawler, 37123806](https://runescape.wiki/w/Special:PermanentLink/37123806) | All typed Monster infoboxes agree; retain pinned policy. |
| Guard Bandit | Free | [Guard Bandit, 37143479](https://runescape.wiki/w/Special:PermanentLink/37143479) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Heather | Free | [Black Heather, 37142979](https://runescape.wiki/w/Special:PermanentLink/37142979) | All typed Monster infoboxes agree; retain pinned policy. |
| Donny the Lad | Free | [Donny the Lad, 37142467](https://runescape.wiki/w/Special:PermanentLink/37142467) | All typed Monster infoboxes agree; retain pinned policy. |
| Speedy Keith | Free | [Speedy Keith, 37143720](https://runescape.wiki/w/Special:PermanentLink/37143720) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal beast | Member | [Abyssal beast, 37168630](https://runescape.wiki/w/Special:PermanentLink/37168630) | All typed Monster infoboxes agree; retain pinned policy. |
| Lava strykewyrm | Member | [Lava strykewyrm, 37188786](https://runescape.wiki/w/Special:PermanentLink/37188786) | All typed Monster infoboxes agree; retain pinned policy. |
| Hydrix dragon | Member | [Hydrix dragon, 37188676](https://runescape.wiki/w/Special:PermanentLink/37188676) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal leech | Member | [Abyssal leech, 37130374](https://runescape.wiki/w/Special:PermanentLink/37130374) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal guardian | Member | [Abyssal guardian, 37130373](https://runescape.wiki/w/Special:PermanentLink/37130373) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal walker | Member | [Abyssal walker, 37186418](https://runescape.wiki/w/Special:PermanentLink/37186418) | All typed Monster infoboxes agree; retain pinned policy. |
| Big Snake | Member | [Big Snake, 37144684](https://runescape.wiki/w/Special:PermanentLink/37144684) | All typed Monster infoboxes agree; retain pinned policy. |
| Mutated jadinko baby | Member | [Mutated jadinko baby, 37159871](https://runescape.wiki/w/Special:PermanentLink/37159871) | All typed Monster infoboxes agree; retain pinned policy. |
| Mutated jadinko guard | Member | [Mutated jadinko guard, 37159882](https://runescape.wiki/w/Special:PermanentLink/37159882) | All typed Monster infoboxes agree; retain pinned policy. |
| Mutated jadinko male | Member | [Mutated jadinko male, 37159911](https://runescape.wiki/w/Special:PermanentLink/37159911) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeletal Wyvern | Member | [Skeletal Wyvern, 37144465](https://runescape.wiki/w/Special:PermanentLink/37144465) | All typed Monster infoboxes agree; retain pinned policy. |
| Hobgoblin | Free | [Hobgoblin, 37134604](https://runescape.wiki/w/Special:PermanentLink/37134604) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Dark Warrior | Member | [Elite Dark Warrior, 37142644](https://runescape.wiki/w/Special:PermanentLink/37142644) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Dark Ranger | Member | [Elite Dark Ranger, 37142642](https://runescape.wiki/w/Special:PermanentLink/37142642) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Dark Mage | Member | [Elite Dark Mage, 37167034](https://runescape.wiki/w/Special:PermanentLink/37167034) | All typed Monster infoboxes agree; retain pinned policy. |
| Spellwisp | Free | [Spellwisp, 37143997](https://runescape.wiki/w/Special:PermanentLink/37143997) | All typed Monster infoboxes agree; retain pinned policy. |
| Jail guard | Free | [Jail guard, 37143363](https://runescape.wiki/w/Special:PermanentLink/37143363) | All typed Monster infoboxes agree; retain pinned policy. |
| Haakon the Champion | Free | [Haakon the Champion, 37143491](https://runescape.wiki/w/Special:PermanentLink/37143491) | All typed Monster infoboxes agree; retain pinned policy. |
| Outlaw | Free | [Outlaw, 37143933](https://runescape.wiki/w/Special:PermanentLink/37143933) | All typed Monster infoboxes agree; retain pinned policy. |
| Cockroach drone | Free | [Cockroach drone, 37142075](https://runescape.wiki/w/Special:PermanentLink/37142075) | All typed Monster infoboxes agree; retain pinned policy. |
| Ripper Demon | Member | [Ripper Demon, 37143968](https://runescape.wiki/w/Special:PermanentLink/37143968) | All typed Monster infoboxes agree; retain pinned policy. |
| Battle mage | Member | [Battle mage, 37136444](https://runescape.wiki/w/Special:PermanentLink/37136444) | All typed Monster infoboxes agree; retain pinned policy. |
| Nechryael | Member | [Nechryael, 37166190](https://runescape.wiki/w/Special:PermanentLink/37166190) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian sniper | Free | [Zamorakian sniper, 37143008](https://runescape.wiki/w/Special:PermanentLink/37143008) | All typed Monster infoboxes agree; retain pinned policy. |
| Earth warrior | Member | [Earth warrior, 37142621](https://runescape.wiki/w/Special:PermanentLink/37142621) | All typed Monster infoboxes agree; retain pinned policy. |
| Thug | Member | [Thug, 37123982](https://runescape.wiki/w/Special:PermanentLink/37123982) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant imp | Free | [Revenant imp, 37143482](https://runescape.wiki/w/Special:PermanentLink/37143482) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant goblin | Free | [Revenant goblin, 37143487](https://runescape.wiki/w/Special:PermanentLink/37143487) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant icefiend | Free | [Revenant icefiend, 37143483](https://runescape.wiki/w/Special:PermanentLink/37143483) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant pyrefiend | Free | [Revenant pyrefiend, 37143477](https://runescape.wiki/w/Special:PermanentLink/37143477) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant hobgoblin | Free | [Revenant hobgoblin, 37143484](https://runescape.wiki/w/Special:PermanentLink/37143484) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant vampyre | Free | [Revenant vampyre, 37143476](https://runescape.wiki/w/Special:PermanentLink/37143476) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant werewolf | Free | [Revenant werewolf, 37143474](https://runescape.wiki/w/Special:PermanentLink/37143474) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant cyclops | Free | [Revenant cyclops, 37143492](https://runescape.wiki/w/Special:PermanentLink/37143492) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant hellhound | Free | [Revenant hellhound, 37143485](https://runescape.wiki/w/Special:PermanentLink/37143485) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant demon | Free | [Revenant demon, 37143489](https://runescape.wiki/w/Special:PermanentLink/37143489) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant ork | Free | [Revenant ork, 37143478](https://runescape.wiki/w/Special:PermanentLink/37143478) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant dark beast | Free | [Revenant dark beast, 37143490](https://runescape.wiki/w/Special:PermanentLink/37143490) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant knight | Free | [Revenant knight, 37143481](https://runescape.wiki/w/Special:PermanentLink/37143481) | All typed Monster infoboxes agree; retain pinned policy. |
| Revenant dragon | Member | [Revenant dragon, 37143961](https://runescape.wiki/w/Special:PermanentLink/37143961) | All typed Monster infoboxes agree; retain pinned policy. |
| Amascut, the Devourer | Member | [Amascut, the Devourer, 37182388](https://runescape.wiki/w/Special:PermanentLink/37182388) | All typed Monster infoboxes agree; retain pinned policy. |
| Desert wolf | Member | [Desert wolf, 37142409](https://runescape.wiki/w/Special:PermanentLink/37142409) | All typed Monster infoboxes agree; retain pinned policy. |
| Ugthanki | Member | [Ugthanki, 37143234](https://runescape.wiki/w/Special:PermanentLink/37143234) | All typed Monster infoboxes agree; retain pinned policy. |
| Bedabin nomad fighter | Member | [Bedabin nomad fighter, 37143775](https://runescape.wiki/w/Special:PermanentLink/37143775) | All typed Monster infoboxes agree; retain pinned policy. |
| Swamp frog | Free | [Swamp frog, 37145390](https://runescape.wiki/w/Special:PermanentLink/37145390) | All typed Monster infoboxes agree; retain pinned policy. |
| Squiggles | Free | [Squiggles, 37124772](https://runescape.wiki/w/Special:PermanentLink/37124772) | All typed Monster infoboxes agree; retain pinned policy. |
| Duckling | Free | [Duckling, 37142566](https://runescape.wiki/w/Special:PermanentLink/37142566) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal lord | Member | [Abyssal lord, 37131125](https://runescape.wiki/w/Special:PermanentLink/37131125) | All typed Monster infoboxes agree; retain pinned policy. |
| Cockroach worker | Free | [Cockroach worker, 37142088](https://runescape.wiki/w/Special:PermanentLink/37142088) | All typed Monster infoboxes agree; retain pinned policy. |
| Cockroach soldier | Free | [Cockroach soldier, 37142083](https://runescape.wiki/w/Special:PermanentLink/37142083) | All typed Monster infoboxes agree; retain pinned policy. |
| Terror dog | Member | [Terror dog, 37133380](https://runescape.wiki/w/Special:PermanentLink/37133380) | All typed Monster infoboxes agree; retain pinned policy. |
| Possessed pickaxe | Member | [Possessed pickaxe, 37144632](https://runescape.wiki/w/Special:PermanentLink/37144632) | All typed Monster infoboxes agree; retain pinned policy. |
| Animated spade | Member | [Animated spade, 37131596](https://runescape.wiki/w/Special:PermanentLink/37131596) | All typed Monster infoboxes agree; retain pinned policy. |
| Dust devil | Member | [Dust devil, 37142523](https://runescape.wiki/w/Special:PermanentLink/37142523) | All typed Monster infoboxes agree; retain pinned policy. |
| Infernal Mage | Member | [Infernal Mage, 37143379](https://runescape.wiki/w/Special:PermanentLink/37143379) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant crypt rat | Member | [Giant crypt rat, 37143377](https://runescape.wiki/w/Special:PermanentLink/37143377) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorak warrior | Member | [Zamorak warrior, 37142957](https://runescape.wiki/w/Special:PermanentLink/37142957) | All typed Monster infoboxes agree; retain pinned policy. |
| Champion of Infernus | Member | [Champion of Infernus, 37142032](https://runescape.wiki/w/Special:PermanentLink/37142032) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Knight champion | Member | [Black Knight champion, 37142989](https://runescape.wiki/w/Special:PermanentLink/37142989) | All typed Monster infoboxes agree; retain pinned policy. |
| H.A.M. Guard | Member | [H.A.M. Guard, 37170910](https://runescape.wiki/w/Special:PermanentLink/37170910) | All typed Monster infoboxes agree; retain pinned policy. |
| Jackal | Member | [Jackal, 37143366](https://runescape.wiki/w/Special:PermanentLink/37143366) | All typed Monster infoboxes agree; retain pinned policy. |
| Vulture | Member | [Vulture, 37143230](https://runescape.wiki/w/Special:PermanentLink/37143230) | All typed Monster infoboxes agree; retain pinned policy. |
| Goat | Member | [Goat, 37143266](https://runescape.wiki/w/Special:PermanentLink/37143266) | All typed Monster infoboxes agree; retain pinned policy. |
| Abyssal savage | Member | [Abyssal savage, 37156759](https://runescape.wiki/w/Special:PermanentLink/37156759) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos Elemental | Free | [Chaos Elemental, 37171856](https://runescape.wiki/w/Special:PermanentLink/37171856) | All typed Monster infoboxes agree; retain pinned policy. |
| Dagon'hai Monk | Member | [Dagon'hai Monk, 37167138](https://runescape.wiki/w/Special:PermanentLink/37167138) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorak ranger | Member | [Zamorak ranger, 37142848](https://runescape.wiki/w/Special:PermanentLink/37142848) | All typed Monster infoboxes agree; retain pinned policy. |
| Seren archer | Member | [Seren archer, 37143826](https://runescape.wiki/w/Special:PermanentLink/37143826) | All typed Monster infoboxes agree; retain pinned policy. |
| Seren warrior | Member | [Seren warrior, 37143824](https://runescape.wiki/w/Special:PermanentLink/37143824) | All typed Monster infoboxes agree; retain pinned policy. |
| Seren mage | Member | [Seren mage, 37143825](https://runescape.wiki/w/Special:PermanentLink/37143825) | All typed Monster infoboxes agree; retain pinned policy. |
| Automaton champion | Member | [Automaton champion, 37135795](https://runescape.wiki/w/Special:PermanentLink/37135795) | All typed Monster infoboxes agree; retain pinned policy. |
| Wight ranger | Member | [Wight ranger, 37143152](https://runescape.wiki/w/Special:PermanentLink/37143152) | All typed Monster infoboxes agree; retain pinned policy. |
| Wight | Member | [Wight, 37143142](https://runescape.wiki/w/Special:PermanentLink/37143142) | All typed Monster infoboxes agree; retain pinned policy. |
| Locust | Member | [Locust, 37131493](https://runescape.wiki/w/Special:PermanentLink/37131493) | All typed Monster infoboxes agree; retain pinned policy. |
| Plague frog | Member | [Plague frog, 37143911](https://runescape.wiki/w/Special:PermanentLink/37143911) | All typed Monster infoboxes agree; retain pinned policy. |
| Billy Goat | Member | [Billy Goat, 37138427](https://runescape.wiki/w/Special:PermanentLink/37138427) | All typed Monster infoboxes agree; retain pinned policy. |
| Desert snake | Member | [Desert snake, 37157483](https://runescape.wiki/w/Special:PermanentLink/37157483) | All typed Monster infoboxes agree; retain pinned policy. |
| Mercenary Captain | Member | [Mercenary Captain, 37139672](https://runescape.wiki/w/Special:PermanentLink/37139672) | All typed Monster infoboxes agree; retain pinned policy. |
| Mercenary | Member | [Mercenary, 37139674](https://runescape.wiki/w/Special:PermanentLink/37139674) | All typed Monster infoboxes agree; retain pinned policy. |
| Shantay guard | Free | [Shantay guard, 37130858](https://runescape.wiki/w/Special:PermanentLink/37130858) | All typed Monster infoboxes agree; retain pinned policy. |
| Al Kharid warrior | Free | [Al Kharid warrior, 37156862](https://runescape.wiki/w/Special:PermanentLink/37156862) | All typed Monster infoboxes agree; retain pinned policy. |
| Fetid zombie | Member | [Fetid zombie, 37143135](https://runescape.wiki/w/Special:PermanentLink/37143135) | All typed Monster infoboxes agree; retain pinned policy. |
| Bound skeleton | Member | [Bound skeleton, 37121627](https://runescape.wiki/w/Special:PermanentLink/37121627) | All typed Monster infoboxes agree; retain pinned policy. |
| Rogue | Member | [Rogue, 37156857](https://runescape.wiki/w/Special:PermanentLink/37156857) | All typed Monster infoboxes agree; retain pinned policy. |
| Rogue Enforcer | Member | [Rogue Enforcer, 37156904](https://runescape.wiki/w/Special:PermanentLink/37156904) | All typed Monster infoboxes agree; retain pinned policy. |
| Rogue Captain | Member | [Rogue Captain, 37156943](https://runescape.wiki/w/Special:PermanentLink/37156943) | All typed Monster infoboxes agree; retain pinned policy. |
| Aberrant spectre | Member | [Aberrant spectre, 37174146](https://runescape.wiki/w/Special:PermanentLink/37174146) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave lizard | Member | [Cave lizard, 37138321](https://runescape.wiki/w/Special:PermanentLink/37138321) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorak crafter | Member | [Zamorak crafter, 37137951](https://runescape.wiki/w/Special:PermanentLink/37137951) | All typed Monster infoboxes agree; retain pinned policy. |
| Leech | Member | [Leech, 37143401](https://runescape.wiki/w/Special:PermanentLink/37143401) | All typed Monster infoboxes agree; retain pinned policy. |
| Bloodworm | Member | [Bloodworm, 37142461](https://runescape.wiki/w/Special:PermanentLink/37142461) | All typed Monster infoboxes agree; retain pinned policy. |
| Crypt spider | Member | [Crypt spider, 37142224](https://runescape.wiki/w/Special:PermanentLink/37142224) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant crypt spider | Member | [Giant crypt spider, 37143380](https://runescape.wiki/w/Special:PermanentLink/37143380) | All typed Monster infoboxes agree; retain pinned policy. |
| Spectral worshipper | Member | [Spectral worshipper, 37154004](https://runescape.wiki/w/Special:PermanentLink/37154004) | All typed Monster infoboxes agree; retain pinned policy. |
| Fallen champion | Member | [Fallen champion, 37143062](https://runescape.wiki/w/Special:PermanentLink/37143062) | All typed Monster infoboxes agree; retain pinned policy. |
| Scarab mage | Member | [Scarab mage, 37144739](https://runescape.wiki/w/Special:PermanentLink/37144739) | All typed Monster infoboxes agree; retain pinned policy. |
| Locust rider | Member | [Locust rider, 37131489](https://runescape.wiki/w/Special:PermanentLink/37131489) | All typed Monster infoboxes agree; retain pinned policy. |
| Rowdy slave | Member | [Rowdy slave, 37139676](https://runescape.wiki/w/Special:PermanentLink/37139676) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave goblin miner | Member | [Cave goblin miner, 37132028](https://runescape.wiki/w/Special:PermanentLink/37132028) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave goblin guard | Member | [Cave goblin guard, 37132027](https://runescape.wiki/w/Special:PermanentLink/37132027) | All typed Monster infoboxes agree; retain pinned policy. |
| Angry unicorn | Free | [Angry unicorn, 37131551](https://runescape.wiki/w/Special:PermanentLink/37131551) | All typed Monster infoboxes agree; retain pinned policy. |
| Angry giant rat | Free | [Angry giant rat, 37131545](https://runescape.wiki/w/Special:PermanentLink/37131545) | All typed Monster infoboxes agree; retain pinned policy. |
| Angry goblin | Free | [Angry goblin, 37131546](https://runescape.wiki/w/Special:PermanentLink/37131546) | All typed Monster infoboxes agree; retain pinned policy. |
| Angry bear | Free | [Angry bear, 37131544](https://runescape.wiki/w/Special:PermanentLink/37131544) | All typed Monster infoboxes agree; retain pinned policy. |
| Fear reaper | Free | [Fear reaper, 37143177](https://runescape.wiki/w/Special:PermanentLink/37143177) | All typed Monster infoboxes agree; retain pinned policy. |
| Confusion beast | Free | [Confusion beast, 37143783](https://runescape.wiki/w/Special:PermanentLink/37143783) | All typed Monster infoboxes agree; retain pinned policy. |
| Hopeless creature | Free | [Hopeless creature, 37143610](https://runescape.wiki/w/Special:PermanentLink/37143610) | All typed Monster infoboxes agree; retain pinned policy. |
| Camel Warrior | Member | [Camel Warrior, 37153677](https://runescape.wiki/w/Special:PermanentLink/37153677) | All typed Monster infoboxes agree; retain pinned policy. |
| Lizard | Member | [Lizard, 37143946](https://runescape.wiki/w/Special:PermanentLink/37143946) | All typed Monster infoboxes agree; retain pinned policy. |
| Brigand | Member | [Brigand, 37156887](https://runescape.wiki/w/Special:PermanentLink/37156887) | All typed Monster infoboxes agree; retain pinned policy. |
| Menaphite Thug | Member | [Menaphite Thug, 37156906](https://runescape.wiki/w/Special:PermanentLink/37156906) | All typed Monster infoboxes agree; retain pinned policy. |
| Desert strykewyrm | Member | [Desert strykewyrm, 37188685](https://runescape.wiki/w/Special:PermanentLink/37188685) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeletal horror | Member | [Skeletal horror, 37144791](https://runescape.wiki/w/Special:PermanentLink/37144791) | All typed Monster infoboxes agree; retain pinned policy. |
| Flesh-hatcher Mhekarnahz | Member | [Flesh-hatcher Mhekarnahz, 37193857](https://runescape.wiki/w/Special:PermanentLink/37193857) | All typed Monster infoboxes agree; retain pinned policy. |
| Scabaras ranger | Member | [Scabaras ranger, 37167200](https://runescape.wiki/w/Special:PermanentLink/37167200) | All typed Monster infoboxes agree; retain pinned policy. |
| Scabaras lancer | Member | [Scabaras lancer, 37167195](https://runescape.wiki/w/Special:PermanentLink/37167195) | All typed Monster infoboxes agree; retain pinned policy. |
| Scabaras mage | Member | [Scabaras mage, 37167194](https://runescape.wiki/w/Special:PermanentLink/37167194) | All typed Monster infoboxes agree; retain pinned policy. |
| Mighty banshee | Member | [Mighty banshee, 37144565](https://runescape.wiki/w/Special:PermanentLink/37144565) | All typed Monster infoboxes agree; retain pinned policy. |
| Scabaras locust | Member | [Scabaras locust, 37144733](https://runescape.wiki/w/Special:PermanentLink/37144733) | All typed Monster infoboxes agree; retain pinned policy. |
| Locust lancer | Member | [Locust lancer, 37131492](https://runescape.wiki/w/Special:PermanentLink/37131492) | All typed Monster infoboxes agree; retain pinned policy. |
| Locust ranger | Member | [Locust ranger, 37131491](https://runescape.wiki/w/Special:PermanentLink/37131491) | All typed Monster infoboxes agree; retain pinned policy. |
| Dried zombie | Member | [Dried zombie, 37153849](https://runescape.wiki/w/Special:PermanentLink/37153849) | All typed Monster infoboxes agree; retain pinned policy. |
| Poltenip | Member | [Poltenip, 37144544](https://runescape.wiki/w/Special:PermanentLink/37144544) | All typed Monster infoboxes agree; retain pinned policy. |
| Radat | Member | [Radat, 37143865](https://runescape.wiki/w/Special:PermanentLink/37143865) | All typed Monster infoboxes agree; retain pinned policy. |
| Desert lizard | Member | [Desert lizard, 37142402](https://runescape.wiki/w/Special:PermanentLink/37142402) | All typed Monster infoboxes agree; retain pinned policy. |
| Small lizard | Member | [Small lizard, 37143903](https://runescape.wiki/w/Special:PermanentLink/37143903) | All typed Monster infoboxes agree; retain pinned policy. |
| Myre Blamish Snail | Member | [Myre Blamish Snail, 37122962](https://runescape.wiki/w/Special:PermanentLink/37122962) | All typed Monster infoboxes agree; retain pinned policy. |
| Ochre Blamish Snail | Member | [Ochre Blamish Snail, 37122963](https://runescape.wiki/w/Special:PermanentLink/37122963) | All typed Monster infoboxes agree; retain pinned policy. |
| Bark Blamish Snail | Member | [Bark Blamish Snail, 37142790](https://runescape.wiki/w/Special:PermanentLink/37142790) | All typed Monster infoboxes agree; retain pinned policy. |
| Banshee | Member | [Banshee, 37142777](https://runescape.wiki/w/Special:PermanentLink/37142777) | All typed Monster infoboxes agree; retain pinned policy. |
| Yeti | Member | [Yeti, 37167020](https://runescape.wiki/w/Special:PermanentLink/37167020) | All typed Monster infoboxes agree; retain pinned policy. |
| Gnoeals | Member | [Gnoeals, 37167021](https://runescape.wiki/w/Special:PermanentLink/37167021) | All typed Monster infoboxes agree; retain pinned policy. |
| Scarab larva | Member | [Scarab larva, 37167192](https://runescape.wiki/w/Special:PermanentLink/37167192) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalphite Worker | Member | [Kalphite Worker, 37144128](https://runescape.wiki/w/Special:PermanentLink/37144128) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalphite Soldier | Member | [Kalphite Soldier, 37144127](https://runescape.wiki/w/Special:PermanentLink/37144127) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalphite Guardian | Member | [Kalphite Guardian, 37132812](https://runescape.wiki/w/Special:PermanentLink/37132812) | All typed Monster infoboxes agree; retain pinned policy. |
| Bandit looter | Member | [Bandit looter, 37142729](https://runescape.wiki/w/Special:PermanentLink/37142729) | All typed Monster infoboxes agree; retain pinned policy. |
| Feral vampyre | Member | [Feral vampyre, 37192290](https://runescape.wiki/w/Special:PermanentLink/37192290) | All typed Monster infoboxes agree; retain pinned policy. |
| Loar Shade | Member | [Loar Shade, 37143808](https://runescape.wiki/w/Special:PermanentLink/37143808) | All typed Monster infoboxes agree; retain pinned policy. |
| Afflicted | Member | [Afflicted, 37131147](https://runescape.wiki/w/Special:PermanentLink/37131147) | All typed Monster infoboxes agree; retain pinned policy. |
| Bruise Blamish Snail | Member | [Bruise Blamish Snail, 37122961](https://runescape.wiki/w/Special:PermanentLink/37122961) | All typed Monster infoboxes agree; retain pinned policy. |
| Blood Blamish Snail | Member | [Blood Blamish Snail, 37122964](https://runescape.wiki/w/Special:PermanentLink/37122964) | All typed Monster infoboxes agree; retain pinned policy. |
| Boris | Member | [Boris, 37139399](https://runescape.wiki/w/Special:PermanentLink/37139399) | All typed Monster infoboxes agree; retain pinned policy. |
| Imre | Member | [Imre, 37139403](https://runescape.wiki/w/Special:PermanentLink/37139403) | All typed Monster infoboxes agree; retain pinned policy. |
| Yuri | Member | [Yuri, 37139393](https://runescape.wiki/w/Special:PermanentLink/37139393) | All typed Monster infoboxes agree; retain pinned policy. |
| Joseph | Member | [Joseph, 37139406](https://runescape.wiki/w/Special:PermanentLink/37139406) | All typed Monster infoboxes agree; retain pinned policy. |
| Nikolai | Member | [Nikolai, 37139387](https://runescape.wiki/w/Special:PermanentLink/37139387) | All typed Monster infoboxes agree; retain pinned policy. |
| Eduard | Member | [Eduard, 37139401](https://runescape.wiki/w/Special:PermanentLink/37139401) | All typed Monster infoboxes agree; retain pinned policy. |
| Lev | Member | [Lev, 37139408](https://runescape.wiki/w/Special:PermanentLink/37139408) | All typed Monster infoboxes agree; retain pinned policy. |
| Georgy | Member | [Georgy, 37139381](https://runescape.wiki/w/Special:PermanentLink/37139381) | All typed Monster infoboxes agree; retain pinned policy. |
| Svetlana | Member | [Svetlana, 37139390](https://runescape.wiki/w/Special:PermanentLink/37139390) | All typed Monster infoboxes agree; retain pinned policy. |
| Irina | Member | [Irina, 37139404](https://runescape.wiki/w/Special:PermanentLink/37139404) | All typed Monster infoboxes agree; retain pinned policy. |
| Alexis | Member | [Alexis, 37140981](https://runescape.wiki/w/Special:PermanentLink/37140981) | All typed Monster infoboxes agree; retain pinned policy. |
| Milla | Member | [Milla, 37139412](https://runescape.wiki/w/Special:PermanentLink/37139412) | All typed Monster infoboxes agree; retain pinned policy. |
| Galina | Member | [Galina, 37139402](https://runescape.wiki/w/Special:PermanentLink/37139402) | All typed Monster infoboxes agree; retain pinned policy. |
| Sofiya | Member | [Sofiya, 37139388](https://runescape.wiki/w/Special:PermanentLink/37139388) | All typed Monster infoboxes agree; retain pinned policy. |
| Ksenia | Member | [Ksenia, 37139407](https://runescape.wiki/w/Special:PermanentLink/37139407) | All typed Monster infoboxes agree; retain pinned policy. |
| Yadviga | Member | [Yadviga, 37139392](https://runescape.wiki/w/Special:PermanentLink/37139392) | All typed Monster infoboxes agree; retain pinned policy. |
| Nikita | Member | [Nikita, 37139413](https://runescape.wiki/w/Special:PermanentLink/37139413) | All typed Monster infoboxes agree; retain pinned policy. |
| Vera | Member | [Vera, 37139391](https://runescape.wiki/w/Special:PermanentLink/37139391) | All typed Monster infoboxes agree; retain pinned policy. |
| Zoja | Member | [Zoja, 37139394](https://runescape.wiki/w/Special:PermanentLink/37139394) | All typed Monster infoboxes agree; retain pinned policy. |
| Liliya | Member | [Liliya, 37139410](https://runescape.wiki/w/Special:PermanentLink/37139410) | All typed Monster infoboxes agree; retain pinned policy. |
| Jeroen | Member | [Jeroen, 37139405](https://runescape.wiki/w/Special:PermanentLink/37139405) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghoul | Member | [Ghoul, 37144087](https://runescape.wiki/w/Special:PermanentLink/37144087) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalphite Queen | Member | [Kalphite Queen, 37197845](https://runescape.wiki/w/Special:PermanentLink/37197845) | All typed Monster infoboxes agree; retain pinned policy. |
| Phrin Shadow | Member | [Phrin Shade, 37166881](https://runescape.wiki/w/Special:PermanentLink/37166881) | All typed Monster infoboxes agree; retain pinned policy. |
| Riyl Shadow | Member | [Riyl Shade, 37166882](https://runescape.wiki/w/Special:PermanentLink/37166882) | All typed Monster infoboxes agree; retain pinned policy. |
| Fiyr Shadow | Member | [Fiyr Shade, 37166883](https://runescape.wiki/w/Special:PermanentLink/37166883) | All typed Monster infoboxes agree; retain pinned policy. |
| Experiment | Member | [Experiment, 37142700](https://runescape.wiki/w/Special:PermanentLink/37142700) | All typed Monster infoboxes agree; retain pinned policy. |
| Vyrewatch | Member | [Vyrewatch, 37159859](https://runescape.wiki/w/Special:PermanentLink/37159859) | All typed Monster infoboxes agree; retain pinned policy. |
| Vampyre Juvinate | Member | [Vampyre Juvinate, 37192296](https://runescape.wiki/w/Special:PermanentLink/37192296) | All typed Monster infoboxes agree; retain pinned policy. |
| Vampyre Juvenile | Member | [Vampyre Juvenile, 37192308](https://runescape.wiki/w/Special:PermanentLink/37192308) | All typed Monster infoboxes agree; retain pinned policy. |
| Crypt rat | Member | [Crypt rat, 37141919](https://runescape.wiki/w/Special:PermanentLink/37141919) | All typed Monster infoboxes agree; retain pinned policy. |
| Vyrelord | Member | [Vyrelord, 37166854](https://runescape.wiki/w/Special:PermanentLink/37166854) | All typed Monster infoboxes agree; retain pinned policy. |
| Vyrelady | Member | [Vyrelady, 37166855](https://runescape.wiki/w/Special:PermanentLink/37166855) | All typed Monster infoboxes agree; retain pinned policy. |
| Undead cow | Member | [Undead cow, 37143237](https://runescape.wiki/w/Special:PermanentLink/37143237) | All typed Monster infoboxes agree; retain pinned policy. |
| Undead chicken | Member | [Undead chicken, 37187916](https://runescape.wiki/w/Special:PermanentLink/37187916) | All typed Monster infoboxes agree; retain pinned policy. |
| Living rock protector | Member | [Living rock protector, 37143415](https://runescape.wiki/w/Special:PermanentLink/37143415) | All typed Monster infoboxes agree; retain pinned policy. |
| Living rock striker | Member | [Living rock striker, 37143414](https://runescape.wiki/w/Special:PermanentLink/37143414) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeletal hand | Member | [Skeletal hand, 37167133](https://runescape.wiki/w/Special:PermanentLink/37167133) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie hand | Member | [Zombie hand, 37179826](https://runescape.wiki/w/Special:PermanentLink/37179826) | All typed Monster infoboxes agree; retain pinned policy. |
| Mutated bloodveld | Member | [Mutated bloodveld, 37178668](https://runescape.wiki/w/Special:PermanentLink/37178668) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant mosquito | Member | [Giant mosquito, 37127426](https://runescape.wiki/w/Special:PermanentLink/37127426) | All typed Monster infoboxes agree; retain pinned policy. |
| Jungle horror | Member | [Jungle horror, 37183911](https://runescape.wiki/w/Special:PermanentLink/37183911) | All typed Monster infoboxes agree; retain pinned policy. |
| New Varrock guard | Member | [New Varrock guard, 37187906](https://runescape.wiki/w/Special:PermanentLink/37187906) | All typed Monster infoboxes agree; retain pinned policy. |
| New Varrock guard captain | Member | [New Varrock guard captain, 37187905](https://runescape.wiki/w/Special:PermanentLink/37187905) | All typed Monster infoboxes agree; retain pinned policy. |
| The Draugen | Member | [The Draugen, 37142540](https://runescape.wiki/w/Special:PermanentLink/37142540) | All typed Monster infoboxes agree; retain pinned policy. |
| Bouncer | Member | [Bouncer, 37144069](https://runescape.wiki/w/Special:PermanentLink/37144069) | All typed Monster infoboxes agree; retain pinned policy. |
| Karamel | Member | [Karamel, 36952845](https://runescape.wiki/w/Special:PermanentLink/36952845) | All typed Monster infoboxes agree; retain pinned policy. |
| Evil Chicken | Member | [Evil Chicken, 37160047](https://runescape.wiki/w/Special:PermanentLink/37160047) | All typed Monster infoboxes agree; retain pinned policy. |
| Jungle demon | Member | [Jungle demon, 37130884](https://runescape.wiki/w/Special:PermanentLink/37130884) | All typed Monster infoboxes agree; retain pinned policy. |
| The Inadequacy | Member | [The Inadequacy, 37144543](https://runescape.wiki/w/Special:PermanentLink/37144543) | All typed Monster infoboxes agree; retain pinned policy. |
| Barrelchest | Member | [Barrelchest, 37142804](https://runescape.wiki/w/Special:PermanentLink/37142804) | All typed Monster infoboxes agree; retain pinned policy. |
| Albino bat | Member | [Albino bat, 37131166](https://runescape.wiki/w/Special:PermanentLink/37131166) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave horror | Member | [Cave horror, 37123772](https://runescape.wiki/w/Special:PermanentLink/37123772) | All typed Monster infoboxes agree; retain pinned policy. |
| Sorebones | Member | [Sorebones, 37121737](https://runescape.wiki/w/Special:PermanentLink/37121737) | All typed Monster infoboxes agree; retain pinned policy. |
| Luminous snaggler | Member | [Luminous snaggler, 37143753](https://runescape.wiki/w/Special:PermanentLink/37143753) | All typed Monster infoboxes agree; retain pinned policy. |
| Telos, the Warden | Member | [Telos, the Warden, 37182354](https://runescape.wiki/w/Special:PermanentLink/37182354) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie cow | Free | [Zombie cow, 37187911](https://runescape.wiki/w/Special:PermanentLink/37187911) | All typed Monster infoboxes agree; retain pinned policy. |
| Unspeakable horror | Member | [Unspeakable horror, 37127433](https://runescape.wiki/w/Special:PermanentLink/37127433) | All typed Monster infoboxes agree; retain pinned policy. |
| Venomous dinosaur | Member | [Venomous dinosaur, 37143217](https://runescape.wiki/w/Special:PermanentLink/37143217) | All typed Monster infoboxes agree; retain pinned policy. |
| Feral Dinosaur | Member | [Feral Dinosaur, 37191302](https://runescape.wiki/w/Special:PermanentLink/37191302) | All typed Monster infoboxes agree; retain pinned policy. |
| Corpse archer | Free | [Corpse archer, 37142122](https://runescape.wiki/w/Special:PermanentLink/37142122) | All typed Monster infoboxes agree; retain pinned policy. |
| Skoblin | Free | [Skoblin, 37143609](https://runescape.wiki/w/Special:PermanentLink/37143609) | All typed Monster infoboxes agree; retain pinned policy. |
| Corpse mage | Free | [Corpse mage, 37142131](https://runescape.wiki/w/Special:PermanentLink/37142131) | All typed Monster infoboxes agree; retain pinned policy. |
| Dragith Nurn | Free | [Dragith Nurn, 37124300](https://runescape.wiki/w/Special:PermanentLink/37124300) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped cockroach | Free | [Warped cockroach, 37143083](https://runescape.wiki/w/Special:PermanentLink/37143083) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped fly | Free | [Warped fly, 37143087](https://runescape.wiki/w/Special:PermanentLink/37143087) | All typed Monster infoboxes agree; retain pinned policy. |
| Crawling corpse torso | Free | [Crawling corpse torso, 37142206](https://runescape.wiki/w/Special:PermanentLink/37142206) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped rat | Free | [Warped rat, 37143088](https://runescape.wiki/w/Special:PermanentLink/37143088) | All typed Monster infoboxes agree; retain pinned policy. |
| Warped bat | Free | [Warped bat, 37143082](https://runescape.wiki/w/Special:PermanentLink/37143082) | All typed Monster infoboxes agree; retain pinned policy. |
| Juvenile boulder crab | Free | [Juvenile boulder crab, 37182553](https://runescape.wiki/w/Special:PermanentLink/37182553) | All typed Monster infoboxes agree; retain pinned policy. |
| Brutish dinosaur | Member | [Brutish dinosaur, 37132708](https://runescape.wiki/w/Special:PermanentLink/37132708) | All typed Monster infoboxes agree; retain pinned policy. |
| Crystal Shapeshifter | Member | [Crystal Shapeshifter, 37166182](https://runescape.wiki/w/Special:PermanentLink/37166182) | All typed Monster infoboxes agree; retain pinned policy. |
| Devil's snare | Member | [Devil's snare, 37142425](https://runescape.wiki/w/Special:PermanentLink/37142425) | All typed Monster infoboxes agree; retain pinned policy. |
| Ripper dinosaur | Member | [Ripper dinosaur, 37166870](https://runescape.wiki/w/Special:PermanentLink/37166870) | All typed Monster infoboxes agree; retain pinned policy. |
| Lampenflora | Member | [Lampenflora, 37144152](https://runescape.wiki/w/Special:PermanentLink/37144152) | All typed Monster infoboxes agree; retain pinned policy. |
| Liverworts | Member | [Liverworts, 37143807](https://runescape.wiki/w/Special:PermanentLink/37143807) | All typed Monster infoboxes agree; retain pinned policy. |
| Ranger | Free | [Ranger, 37156883](https://runescape.wiki/w/Special:PermanentLink/37156883) | All typed Monster infoboxes agree; retain pinned policy. |
| Badger | Free | [Badger, 37179594](https://runescape.wiki/w/Special:PermanentLink/37179594) | All typed Monster infoboxes agree; retain pinned policy. |
| Hedgehog | Free | [Hedgehog, 37143306](https://runescape.wiki/w/Special:PermanentLink/37143306) | All typed Monster infoboxes agree; retain pinned policy. |
| Sanguine crawler | Member | [Sanguine crawler, 37196203](https://runescape.wiki/w/Special:PermanentLink/37196203) | All typed Monster infoboxes agree; retain pinned policy. |
| Ivar, King of Bones | Free | [Ivar, King of Bones, 37195168](https://runescape.wiki/w/Special:PermanentLink/37195168) | All typed Monster infoboxes agree; retain pinned policy. |
| Volatile chinchompa | Free | [Volatile chinchompa, 37165625](https://runescape.wiki/w/Special:PermanentLink/37165625) | All typed Monster infoboxes agree; retain pinned policy. |
| Ravenous ghoul | Member | [Ravenous ghoul, 37143894](https://runescape.wiki/w/Special:PermanentLink/37143894) | All typed Monster infoboxes agree; retain pinned policy. |
| TzHaar-Mej | Member | [TzHaar-Mej, 37159855](https://runescape.wiki/w/Special:PermanentLink/37159855) | All typed Monster infoboxes agree; retain pinned policy. |
| TzHaar-Xil | Member | [TzHaar-Xil, 37159856](https://runescape.wiki/w/Special:PermanentLink/37159856) | All typed Monster infoboxes agree; retain pinned policy. |
| TzHaar-Ket | Member | [TzHaar-Ket, 37159854](https://runescape.wiki/w/Special:PermanentLink/37159854) | All typed Monster infoboxes agree; retain pinned policy. |
| Grifolapine | Member | [Grifolapine, 37143374](https://runescape.wiki/w/Special:PermanentLink/37143374) | All typed Monster infoboxes agree; retain pinned policy. |
| Fungal mage | Member | [Fungal mage, 37143372](https://runescape.wiki/w/Special:PermanentLink/37143372) | All typed Monster infoboxes agree; retain pinned policy. |
| Fungal rodent | Member | [Fungal rodent, 37143371](https://runescape.wiki/w/Special:PermanentLink/37143371) | All typed Monster infoboxes agree; retain pinned policy. |
| Infested axe | Member | [Infested axe, 37143369](https://runescape.wiki/w/Special:PermanentLink/37143369) | All typed Monster infoboxes agree; retain pinned policy. |
| Ganodermic beast | Member | [Ganodermic beast, 37143378](https://runescape.wiki/w/Special:PermanentLink/37143378) | All typed Monster infoboxes agree; retain pinned policy. |
| Ganodermic runt | Member | [Ganodermic runt, 37143376](https://runescape.wiki/w/Special:PermanentLink/37143376) | All typed Monster infoboxes agree; retain pinned policy. |
| Grifolaroo | Member | [Grifolaroo, 37143373](https://runescape.wiki/w/Special:PermanentLink/37143373) | All typed Monster infoboxes agree; retain pinned policy. |
| Rune dragon | Member | [Rune dragon, 37171276](https://runescape.wiki/w/Special:PermanentLink/37171276) | All typed Monster infoboxes agree; retain pinned policy. |
| The Sanctum Guardian | Member | [The Sanctum Guardian, 37158902](https://runescape.wiki/w/Special:PermanentLink/37158902) | All typed Monster infoboxes agree; retain pinned policy. |
| Crocodile | Member | [Crocodile, 37133378](https://runescape.wiki/w/Special:PermanentLink/37133378) | All typed Monster infoboxes agree; retain pinned policy. |
| Mutated zygomite | Member | [Mutated zygomite, 37149567](https://runescape.wiki/w/Special:PermanentLink/37149567) | All typed Monster infoboxes agree; retain pinned policy. |
| Nex, Angel of Death | Member | [Nex, Angel of Death, 37156445](https://runescape.wiki/w/Special:PermanentLink/37156445) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant ant worker#Chaos Tunnels | Member | [Giant ant worker, 37144095](https://runescape.wiki/w/Special:PermanentLink/37144095) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant ant soldier#Chaos Tunnels | Member | [Giant ant soldier, 37144096](https://runescape.wiki/w/Special:PermanentLink/37144096) | All typed Monster infoboxes agree; retain pinned policy. |
| Cave bug#Level 11 | Member | [Cave bug, 37123987](https://runescape.wiki/w/Special:PermanentLink/37123987) | All typed Monster infoboxes agree; retain pinned policy. |
| Bork | Member | [Bork, 37188183](https://runescape.wiki/w/Special:PermanentLink/37188183) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Primus | Member | [Legio Primus, 37156429](https://runescape.wiki/w/Special:PermanentLink/37156429) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Secundus | Member | [Legio Secundus, 37156430](https://runescape.wiki/w/Special:PermanentLink/37156430) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Tertius | Member | [Legio Tertius, 37156433](https://runescape.wiki/w/Special:PermanentLink/37156433) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Quartus | Member | [Legio Quartus, 37156434](https://runescape.wiki/w/Special:PermanentLink/37156434) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Quintus | Member | [Legio Quintus, 37156435](https://runescape.wiki/w/Special:PermanentLink/37156435) | All typed Monster infoboxes agree; retain pinned policy. |
| Legio Sextus | Member | [Legio Sextus, 37156438](https://runescape.wiki/w/Special:PermanentLink/37156438) | All typed Monster infoboxes agree; retain pinned policy. |
| Exiled Kalphite Queen | Member | [Exiled Kalphite Queen, 37178530](https://runescape.wiki/w/Special:PermanentLink/37178530) | All typed Monster infoboxes agree; retain pinned policy. |
| Kalphite King | Member | [Kalphite King, 37156424](https://runescape.wiki/w/Special:PermanentLink/37156424) | All typed Monster infoboxes agree; retain pinned policy. |
| Vorago | Member | [Vorago, 37160761](https://runescape.wiki/w/Special:PermanentLink/37160761) | All typed Monster infoboxes agree; retain pinned policy. |
| The Magister | Member | [The Magister, 37156439](https://runescape.wiki/w/Special:PermanentLink/37156439) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant mole | Free | [Giant mole, 37171623](https://runescape.wiki/w/Special:PermanentLink/37171623) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Hur | Member | [TokHaar-Hur, 37159884](https://runescape.wiki/w/Special:PermanentLink/37159884) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Xil | Member | [TokHaar-Xil, 37159887](https://runescape.wiki/w/Special:PermanentLink/37159887) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Tok-Xil | Member | [TokHaar-Tok-Xil, 37159890](https://runescape.wiki/w/Special:PermanentLink/37159890) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Mej | Member | [TokHaar-Mej, 37159886](https://runescape.wiki/w/Special:PermanentLink/37159886) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Ket-Dill | Member | [TokHaar-Ket-Dill, 37143668](https://runescape.wiki/w/Special:PermanentLink/37143668) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Yt-MejKot | Member | [TokHaar-Yt-MejKot, 37159891](https://runescape.wiki/w/Special:PermanentLink/37159891) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Ket-Zek | Member | [TokHaar-Ket-Zek, 37159889](https://runescape.wiki/w/Special:PermanentLink/37159889) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Ket | Member | [TokHaar-Ket, 37159885](https://runescape.wiki/w/Special:PermanentLink/37159885) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Jad | Member | [TokHaar-Jad, 37132320](https://runescape.wiki/w/Special:PermanentLink/37132320) | All typed Monster infoboxes agree; retain pinned policy. |
| Har-Aken | Member | [Har-Aken, 37152420](https://runescape.wiki/w/Special:PermanentLink/37152420) | All typed Monster infoboxes agree; retain pinned policy. |
| Tz-Kek | Member | [Tz-Kek, 37161605](https://runescape.wiki/w/Special:PermanentLink/37161605) | All typed Monster infoboxes agree; retain pinned policy. |
| Tok-Xil | Member | [Tok-Xil, 37161417](https://runescape.wiki/w/Special:PermanentLink/37161417) | All typed Monster infoboxes agree; retain pinned policy. |
| Yt-MejKot | Member | [Yt-MejKot, 37161418](https://runescape.wiki/w/Special:PermanentLink/37161418) | All typed Monster infoboxes agree; retain pinned policy. |
| TzTok-Jad | Member | [TzTok-Jad, 37156394](https://runescape.wiki/w/Special:PermanentLink/37156394) | All typed Monster infoboxes agree; retain pinned policy. |
| Yt-HurKot | Member | [Yt-HurKot, 37143057](https://runescape.wiki/w/Special:PermanentLink/37143057) | All typed Monster infoboxes agree; retain pinned policy. |
| Phoenix | Member | [Phoenix, 37159291](https://runescape.wiki/w/Special:PermanentLink/37159291) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater reborn mage | Member | [Greater reborn mage, 37123365](https://runescape.wiki/w/Special:PermanentLink/37123365) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater reborn ranger | Member | [Greater reborn ranger, 37123703](https://runescape.wiki/w/Special:PermanentLink/37123703) | All typed Monster infoboxes agree; retain pinned policy. |
| Lesser reborn mage | Member | [Lesser reborn mage, 37123366](https://runescape.wiki/w/Special:PermanentLink/37123366) | All typed Monster infoboxes agree; retain pinned policy. |
| Lesser reborn warrior | Member | [Lesser reborn warrior, 37123700](https://runescape.wiki/w/Special:PermanentLink/37123700) | All typed Monster infoboxes agree; retain pinned policy. |
| Lesser reborn ranger | Member | [Lesser reborn ranger, 37123699](https://runescape.wiki/w/Special:PermanentLink/37123699) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos dwarf lava flow miner | Member | [Chaos dwarf lava flow miner, 37130555](https://runescape.wiki/w/Special:PermanentLink/37130555) | All typed Monster infoboxes agree; retain pinned policy. |
| Goblin statue | Member | [Goblin statue, 37163292](https://runescape.wiki/w/Special:PermanentLink/37163292) | All typed Monster infoboxes agree; retain pinned policy. |
| Ork statue | Member | [Ork statue, 37163296](https://runescape.wiki/w/Special:PermanentLink/37163296) | All typed Monster infoboxes agree; retain pinned policy. |
| Ogre statue | Member | [Ogre statue, 37163288](https://runescape.wiki/w/Special:PermanentLink/37163288) | All typed Monster infoboxes agree; retain pinned policy. |
| Ourg statue | Member | [Ourg statue, 37167022](https://runescape.wiki/w/Special:PermanentLink/37167022) | All typed Monster infoboxes agree; retain pinned policy. |
| Skeletal miner | Member | [Skeletal miner, 37144456](https://runescape.wiki/w/Special:PermanentLink/37144456) | All typed Monster infoboxes agree; retain pinned policy. |
| Nodon artificer | Member | [Nodon artificer, 37142451](https://runescape.wiki/w/Special:PermanentLink/37142451) | All typed Monster infoboxes agree; retain pinned policy. |
| Nodon guard | Member | [Nodon guard, 37142439](https://runescape.wiki/w/Special:PermanentLink/37142439) | All typed Monster infoboxes agree; retain pinned policy. |
| Nodon hunter | Member | [Nodon hunter, 37142434](https://runescape.wiki/w/Special:PermanentLink/37142434) | All typed Monster infoboxes agree; retain pinned policy. |
| Nodon engineer | Member | [Nodon engineer, 37124717](https://runescape.wiki/w/Special:PermanentLink/37124717) | All typed Monster infoboxes agree; retain pinned policy. |
| Nodon enforcer | Member | [Nodon enforcer, 37141014](https://runescape.wiki/w/Special:PermanentLink/37141014) | All typed Monster infoboxes agree; retain pinned policy. |
| Siege engine | Member | [Siege engine, 37124720](https://runescape.wiki/w/Special:PermanentLink/37124720) | All typed Monster infoboxes agree; retain pinned policy. |
| Kerapac, the bound | Member | [Kerapac, the bound, 37182367](https://runescape.wiki/w/Special:PermanentLink/37182367) | All typed Monster infoboxes agree; retain pinned policy. |
| Glacyte | Member | [Glacyte, 37139659](https://runescape.wiki/w/Special:PermanentLink/37139659) | All typed Monster infoboxes agree; retain pinned policy. |
| Arch-Glacor | Member | [Arch-Glacor, 37193665](https://runescape.wiki/w/Special:PermanentLink/37193665) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch | Member | [Chaos witch, 37122451](https://runescape.wiki/w/Special:PermanentLink/37122451) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch apprentice | Member | [Chaos witch apprentice, 37124244](https://runescape.wiki/w/Special:PermanentLink/37124244) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch channeler | Member | [Chaos witch channeler, 37141364](https://runescape.wiki/w/Special:PermanentLink/37141364) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch lifeweaver | Member | [Chaos witch lifeweaver, 37124245](https://runescape.wiki/w/Special:PermanentLink/37124245) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch magus | Member | [Chaos witch magus, 37124242](https://runescape.wiki/w/Special:PermanentLink/37124242) | All typed Monster infoboxes agree; retain pinned policy. |
| Chaos witch mender | Member | [Chaos witch mender, 37124243](https://runescape.wiki/w/Special:PermanentLink/37124243) | All typed Monster infoboxes agree; retain pinned policy. |
| Dark wizard elder | Member | [Dark wizard elder, 37124324](https://runescape.wiki/w/Special:PermanentLink/37124324) | All typed Monster infoboxes agree; retain pinned policy. |
| Dark wizard master | Member | [Dark wizard master, 37124330](https://runescape.wiki/w/Special:PermanentLink/37124330) | All typed Monster infoboxes agree; retain pinned policy. |
| Fred | Member | [Fred, 37124319](https://runescape.wiki/w/Special:PermanentLink/37124319) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon brute | Member | [Greater demon brute, 37143321](https://runescape.wiki/w/Special:PermanentLink/37143321) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon pyromancer | Member | [Greater demon pyromancer, 37124343](https://runescape.wiki/w/Special:PermanentLink/37124343) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon sage | Member | [Greater demon sage, 37129920](https://runescape.wiki/w/Special:PermanentLink/37129920) | All typed Monster infoboxes agree; retain pinned policy. |
| Greater demon savage | Member | [Greater demon savage, 37124341](https://runescape.wiki/w/Special:PermanentLink/37124341) | All typed Monster infoboxes agree; retain pinned policy. |
| Hellhound Alpha | Member | [Hellhound Alpha, 37124339](https://runescape.wiki/w/Special:PermanentLink/37124339) | All typed Monster infoboxes agree; retain pinned policy. |
| Hellhound Hunter | Member | [Hellhound Hunter, 37124340](https://runescape.wiki/w/Special:PermanentLink/37124340) | All typed Monster infoboxes agree; retain pinned policy. |
| Imp scavenger | Member | [Imp scavenger, 37124637](https://runescape.wiki/w/Special:PermanentLink/37124637) | All typed Monster infoboxes agree; retain pinned policy. |
| Lifeweaver | Member | [Lifeweaver, 37141368](https://runescape.wiki/w/Special:PermanentLink/37141368) | All typed Monster infoboxes agree; retain pinned policy. |
| Monk of Chaos | Member | [Monk of Chaos, 37124247](https://runescape.wiki/w/Special:PermanentLink/37124247) | All typed Monster infoboxes agree; retain pinned policy. |
| protector | Member | [Protector, 37141370](https://runescape.wiki/w/Special:PermanentLink/37141370) | All typed Monster infoboxes agree; retain pinned policy. |
| Seething Pyrefiend | Member | [Seething Pyrefiend, 37124741](https://runescape.wiki/w/Special:PermanentLink/37124741) | All typed Monster infoboxes agree; retain pinned policy. |
| Torrential Waterfiend | Member | [Torrential Waterfiend, 37124783](https://runescape.wiki/w/Special:PermanentLink/37124783) | All typed Monster infoboxes agree; retain pinned policy. |
| War priest of chaos | Member | [War priest of chaos, 37124249](https://runescape.wiki/w/Special:PermanentLink/37124249) | All typed Monster infoboxes agree; retain pinned policy. |
| War priestess of chaos | Member | [War priestess of chaos, 37124248](https://runescape.wiki/w/Special:PermanentLink/37124248) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian archer | Member | [Zamorakian archer, 37142958](https://runescape.wiki/w/Special:PermanentLink/37142958) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian cultist | Member | [Zamorakian cultist, 37124337](https://runescape.wiki/w/Special:PermanentLink/37124337) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian hound master | Member | [Zamorakian hound master, 37124336](https://runescape.wiki/w/Special:PermanentLink/37124336) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian hunter | Member | [Zamorakian hunter, 37124335](https://runescape.wiki/w/Special:PermanentLink/37124335) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorakian ritual keeper | Member | [Zamorakian ritual keeper, 37141034](https://runescape.wiki/w/Special:PermanentLink/37141034) | All typed Monster infoboxes agree; retain pinned policy. |
| Berserk Archaeologist | Member | [Berserk Archaeologist, 37140887](https://runescape.wiki/w/Special:PermanentLink/37140887) | All typed Monster infoboxes agree; retain pinned policy. |
| Cerberus Juvenile | Member | [Cerberus Juvenile, 37122447](https://runescape.wiki/w/Special:PermanentLink/37122447) | All typed Monster infoboxes agree; retain pinned policy. |
| Denizen of Infernus | Member | [Denizen of Infernus, 37124344](https://runescape.wiki/w/Special:PermanentLink/37124344) | All typed Monster infoboxes agree; retain pinned policy. |
| Desha, Guardian of the Hounds | Member | [Desha, Guardian of the Hounds, 37124353](https://runescape.wiki/w/Special:PermanentLink/37124353) | All typed Monster infoboxes agree; retain pinned policy. |
| Maelstrom, Raging Waterfiend | Member | [Maelstrom, Raging Waterfiend, 37124351](https://runescape.wiki/w/Special:PermanentLink/37124351) | All typed Monster infoboxes agree; retain pinned policy. |
| Mazera, the Dark | Member | [Mazera, the Dark, 37136465](https://runescape.wiki/w/Special:PermanentLink/37136465) | All typed Monster infoboxes agree; retain pinned policy. |
| Smoulders, the Revenger | Member | [Smoulders, the Revenger, 37124349](https://runescape.wiki/w/Special:PermanentLink/37124349) | All typed Monster infoboxes agree; retain pinned policy. |
| Eterna, Ritual Leader | Member | [Eterna, Ritual Leader, 37136445](https://runescape.wiki/w/Special:PermanentLink/37136445) | All typed Monster infoboxes agree; retain pinned policy. |
| Zamorak, Lord of Chaos | Member | [Zamorak, Lord of Chaos, 37188711](https://runescape.wiki/w/Special:PermanentLink/37188711) | All typed Monster infoboxes agree; retain pinned policy. |
| Zombie rat | Free | [Zombie rat, 37166348](https://runescape.wiki/w/Special:PermanentLink/37166348) | All typed Monster infoboxes agree; retain pinned policy. |
| Phrin Shade | Member | [Phrin Shade, 37166881](https://runescape.wiki/w/Special:PermanentLink/37166881) | All typed Monster infoboxes agree; retain pinned policy. |
| Riyl Shade | Member | [Riyl Shade, 37166882](https://runescape.wiki/w/Special:PermanentLink/37166882) | All typed Monster infoboxes agree; retain pinned policy. |
| Asyn Shade | Member | [Asyn Shade, 37166880](https://runescape.wiki/w/Special:PermanentLink/37166880) | All typed Monster infoboxes agree; retain pinned policy. |
| Fiyr Shade | Member | [Fiyr Shade, 37166883](https://runescape.wiki/w/Special:PermanentLink/37166883) | All typed Monster infoboxes agree; retain pinned policy. |
| Wall beast | Member | [Wall beast, 37143074](https://runescape.wiki/w/Special:PermanentLink/37143074) | All typed Monster infoboxes agree; retain pinned policy. |
| Blood nihil | Member | [Blood nihil, 37166224](https://runescape.wiki/w/Special:PermanentLink/37166224) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice nihil | Member | [Ice nihil, 37166220](https://runescape.wiki/w/Special:PermanentLink/37166220) | All typed Monster infoboxes agree; retain pinned policy. |
| Shadow nihil | Member | [Shadow nihil, 37166223](https://runescape.wiki/w/Special:PermanentLink/37166223) | All typed Monster infoboxes agree; retain pinned policy. |
| Smoke nihil | Member | [Smoke nihil, 37166222](https://runescape.wiki/w/Special:PermanentLink/37166222) | All typed Monster infoboxes agree; retain pinned policy. |
| Force muspah | Member | [Force muspah, 37159905](https://runescape.wiki/w/Special:PermanentLink/37159905) | All typed Monster infoboxes agree; retain pinned policy. |
| Bladed muspah | Member | [Bladed muspah, 37159904](https://runescape.wiki/w/Special:PermanentLink/37159904) | All typed Monster infoboxes agree; retain pinned policy. |
| Throwing muspah | Member | [Throwing muspah, 37159906](https://runescape.wiki/w/Special:PermanentLink/37159906) | All typed Monster infoboxes agree; retain pinned policy. |
| TokHaar-Ket Champion | Member | [TokHaar-Ket Champion, 37159888](https://runescape.wiki/w/Special:PermanentLink/37159888) | All typed Monster infoboxes agree; retain pinned policy. |
| Beastmaster's hound | Member | [Beastmaster's hound, 37121093](https://runescape.wiki/w/Special:PermanentLink/37121093) | All typed Monster infoboxes agree; retain pinned policy. |
| Beastmaster Durzag | Member | [Beastmaster Durzag, 37161988](https://runescape.wiki/w/Special:PermanentLink/37161988) | All typed Monster infoboxes agree; retain pinned policy. |
| Yakamaru | Member | [Yakamaru, 37152416](https://runescape.wiki/w/Special:PermanentLink/37152416) | All typed Monster infoboxes agree; retain pinned policy. |
| Gregorovic | Member | [Gregorovic, 37185264](https://runescape.wiki/w/Special:PermanentLink/37185264) | All typed Monster infoboxes agree; retain pinned policy. |
| Vindicta | Member | [Vindicta, 37185267](https://runescape.wiki/w/Special:PermanentLink/37185267) | All typed Monster infoboxes agree; retain pinned policy. |
| Helwyr | Member | [Helwyr, 37185262](https://runescape.wiki/w/Special:PermanentLink/37185262) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll runt#Variant 1 | Member | [Ice troll runt, 37123712](https://runescape.wiki/w/Special:PermanentLink/37123712) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll male#Variant 1 | Member | [Ice troll male, 37123830](https://runescape.wiki/w/Special:PermanentLink/37123830) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll female#Variant 1 | Member | [Ice troll female, 37123831](https://runescape.wiki/w/Special:PermanentLink/37123831) | All typed Monster infoboxes agree; retain pinned policy. |
| Ice troll grunt#Variant 1 | Member | [Ice troll grunt, 37123710](https://runescape.wiki/w/Special:PermanentLink/37123710) | All typed Monster infoboxes agree; retain pinned policy. |
| Abomination | Member | [Abomination, 37181408](https://runescape.wiki/w/Special:PermanentLink/37181408) | All typed Monster infoboxes agree; retain pinned policy. |
| Crassian scuttler | Member | [Crassian scuttler, 37129514](https://runescape.wiki/w/Special:PermanentLink/37129514) | All typed Monster infoboxes agree; retain pinned policy. |
| Enlightened Sotapanna | Member | [Enlightened Sotapanna, 37129573](https://runescape.wiki/w/Special:PermanentLink/37129573) | All typed Monster infoboxes agree; retain pinned policy. |
| Sea horror | Member | [Sea horror, 37129451](https://runescape.wiki/w/Special:PermanentLink/37129451) | All typed Monster infoboxes agree; retain pinned policy. |
| Ulthven necromancer | Member | [Ulthven necromancer, 37129456](https://runescape.wiki/w/Special:PermanentLink/37129456) | All typed Monster infoboxes agree; retain pinned policy. |
| Bossy McBossFace | Member | [Bossy McBossFace, 37129541](https://runescape.wiki/w/Special:PermanentLink/37129541) | All typed Monster infoboxes agree; retain pinned policy. |
| Cooper | Member | [Cooper, 37129525](https://runescape.wiki/w/Special:PermanentLink/37129525) | All typed Monster infoboxes agree; retain pinned policy. |
| Ulthven Keith | Member | [Ulthven Keith, 37129544](https://runescape.wiki/w/Special:PermanentLink/37129544) | All typed Monster infoboxes agree; retain pinned policy. |
| Lady Himiko | Member | [Lady Himiko, 37136482](https://runescape.wiki/w/Special:PermanentLink/37136482) | All typed Monster infoboxes agree; retain pinned policy. |
| Tombi, Khan of Thalassia | Member | [Tombi, Khan of Thalassia, 37129515](https://runescape.wiki/w/Special:PermanentLink/37129515) | All typed Monster infoboxes agree; retain pinned policy. |
| Masuta the Descended | Member | [Masuta the Descended, 37183761](https://runescape.wiki/w/Special:PermanentLink/37183761) | All typed Monster infoboxes agree; retain pinned policy. |
| Quetzathog | Member | [Quetzathog, 37129547](https://runescape.wiki/w/Special:PermanentLink/37129547) | All typed Monster infoboxes agree; retain pinned policy. |
| Yor'Ger the Deceiver | Member | [Yor'Ger the Deceiver, 37129548](https://runescape.wiki/w/Special:PermanentLink/37129548) | All typed Monster infoboxes agree; retain pinned policy. |
| Black Stone Scuttler | Member | [Black Stone Scuttler, 37129549](https://runescape.wiki/w/Special:PermanentLink/37129549) | All typed Monster infoboxes agree; retain pinned policy. |
| Oreb, the Magister | Member | [Oreb, the Magister, 37129550](https://runescape.wiki/w/Special:PermanentLink/37129550) | All typed Monster infoboxes agree; retain pinned policy. |
| Shrine Maiden Elei | Member | [Shrine Maiden Elei, 37136491](https://runescape.wiki/w/Special:PermanentLink/37136491) | All typed Monster infoboxes agree; retain pinned policy. |
| Eye of Cythan | Member | [Eye of Cythan, 37129552](https://runescape.wiki/w/Special:PermanentLink/37129552) | All typed Monster infoboxes agree; retain pinned policy. |
| Hand of Dagnath | Member | [Hand of Dagnath, 37129553](https://runescape.wiki/w/Special:PermanentLink/37129553) | All typed Monster infoboxes agree; retain pinned policy. |
| Maw of Kolthregar | Member | [Maw of Kolthregar, 37136485](https://runescape.wiki/w/Special:PermanentLink/37136485) | All typed Monster infoboxes agree; retain pinned policy. |
| Boggoth | Member | [Boggoth, 37129555](https://runescape.wiki/w/Special:PermanentLink/37129555) | All typed Monster infoboxes agree; retain pinned policy. |
| Crassian Leviathan | Member | [Crassian Leviathan, 37158903](https://runescape.wiki/w/Special:PermanentLink/37158903) | All typed Monster infoboxes agree; retain pinned policy. |
| Taraket the Necromancer | Member | [Taraket the Necromancer, 37160770](https://runescape.wiki/w/Special:PermanentLink/37160770) | All typed Monster infoboxes agree; retain pinned policy. |
| The Ambassador | Member | [The Ambassador, 37173523](https://runescape.wiki/w/Special:PermanentLink/37173523) | All typed Monster infoboxes agree; retain pinned policy. |
| Raksha, the Shadow Colossus | Member | [Raksha, the Shadow Colossus, 37200812](https://runescape.wiki/w/Special:PermanentLink/37200812) | All typed Monster infoboxes agree; retain pinned policy. |
| Orikalka | Member | [Orikalka, 37182358](https://runescape.wiki/w/Special:PermanentLink/37182358) | All typed Monster infoboxes agree; retain pinned policy. |
| Rathis | Member | [Rathis, 37182361](https://runescape.wiki/w/Special:PermanentLink/37182361) | All typed Monster infoboxes agree; retain pinned policy. |
| Pthentraken | Member | [Pthentraken, 37182359](https://runescape.wiki/w/Special:PermanentLink/37182359) | All typed Monster infoboxes agree; retain pinned policy. |
| Osseous | Member | [Osseous, 37182357](https://runescape.wiki/w/Special:PermanentLink/37182357) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Sotapanna | Member | [Elite Sotapanna, 37129468](https://runescape.wiki/w/Special:PermanentLink/37129468) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Sakadagami | Member | [Elite Sakadagami, 37129464](https://runescape.wiki/w/Special:PermanentLink/37129464) | All typed Monster infoboxes agree; retain pinned policy. |
| Cloaked zealot | Member | [Cloaked zealot, 37129462](https://runescape.wiki/w/Special:PermanentLink/37129462) | All typed Monster infoboxes agree; retain pinned policy. |
| Defence Pylon | Member | [Defence Pylon, 37129528](https://runescape.wiki/w/Special:PermanentLink/37129528) | All typed Monster infoboxes agree; retain pinned policy. |
| Eastern mercenary | Member | [Eastern mercenary, 37129461](https://runescape.wiki/w/Special:PermanentLink/37129461) | All typed Monster infoboxes agree; retain pinned policy. |
| Hanto sellsword | Member | [Hanto sellsword, 37129469](https://runescape.wiki/w/Special:PermanentLink/37129469) | All typed Monster infoboxes agree; retain pinned policy. |
| Renegade Menaphite soldier | Member | [Renegade Menaphite soldier, 37129449](https://runescape.wiki/w/Special:PermanentLink/37129449) | All typed Monster infoboxes agree; retain pinned policy. |
| Sea crocodile | Member | [Sea crocodile, 37129536](https://runescape.wiki/w/Special:PermanentLink/37129536) | All typed Monster infoboxes agree; retain pinned policy. |
| Ahoeitu the Chef | Member | [Ahoeitu the Chef, 37129518](https://runescape.wiki/w/Special:PermanentLink/37129518) | All typed Monster infoboxes agree; retain pinned policy. |
| Olivia the Chronicler | Member | [Olivia the Chronicler, 37129519](https://runescape.wiki/w/Special:PermanentLink/37129519) | All typed Monster infoboxes agree; retain pinned policy. |
| Xiang the Water-shaper | Member | [Xiang the Water-shaper, 37129520](https://runescape.wiki/w/Special:PermanentLink/37129520) | All typed Monster infoboxes agree; retain pinned policy. |
| Sarkhan the Serpentspeaker | Member | [Sarkhan the Serpentspeaker, 37129521](https://runescape.wiki/w/Special:PermanentLink/37129521) | All typed Monster infoboxes agree; retain pinned policy. |
| Oyu the Quietest | Member | [Oyu the Quietest, 37129522](https://runescape.wiki/w/Special:PermanentLink/37129522) | All typed Monster infoboxes agree; retain pinned policy. |
| Goku the Unrelenting | Member | [Goku the Unrelenting, 37129523](https://runescape.wiki/w/Special:PermanentLink/37129523) | All typed Monster infoboxes agree; retain pinned policy. |
| Yukimura of Hanto | Member | [Yukimura of Hanto, 37129471](https://runescape.wiki/w/Special:PermanentLink/37129471) | All typed Monster infoboxes agree; retain pinned policy. |
| Jade the Unruly | Member | [Jade the Unruly, 37129524](https://runescape.wiki/w/Special:PermanentLink/37129524) | All typed Monster infoboxes agree; retain pinned policy. |
| The Violet Lotus | Member | [The Violet Lotus, 37129527](https://runescape.wiki/w/Special:PermanentLink/37129527) | All typed Monster infoboxes agree; retain pinned policy. |
| Arhat paragon | Member | [Arhat paragon, 37122062](https://runescape.wiki/w/Special:PermanentLink/37122062) | All typed Monster infoboxes agree; retain pinned policy. |
| Horrific crassian | Member | [Horrific crassian, 37129435](https://runescape.wiki/w/Special:PermanentLink/37129435) | All typed Monster infoboxes agree; retain pinned policy. |
| Menaphite guard captain | Member | [Menaphite guard captain, 37129530](https://runescape.wiki/w/Special:PermanentLink/37129530) | All typed Monster infoboxes agree; retain pinned policy. |
| Ol' Sawtooth | Member | [Ol' Sawtooth, 37129531](https://runescape.wiki/w/Special:PermanentLink/37129531) | All typed Monster infoboxes agree; retain pinned policy. |
| Masuta the Ascended | Member | [Masuta the Ascended, 37158901](https://runescape.wiki/w/Special:PermanentLink/37158901) | All typed Monster infoboxes agree; retain pinned policy. |
| Seiryu the Azure Serpent | Member | [Seiryu the Azure Serpent, 37156458](https://runescape.wiki/w/Special:PermanentLink/37156458) | All typed Monster infoboxes agree; retain pinned policy. |
| Laboratory slime | Member | [Laboratory slime, 37129431](https://runescape.wiki/w/Special:PermanentLink/37129431) | All typed Monster infoboxes agree; retain pinned policy. |
| Lava spider | Member | [Lava spider, 37129437](https://runescape.wiki/w/Special:PermanentLink/37129437) | All typed Monster infoboxes agree; retain pinned policy. |
| Magma golem | Member | [Magma golem, 37129582](https://runescape.wiki/w/Special:PermanentLink/37129582) | All typed Monster infoboxes agree; retain pinned policy. |
| Deathbreath | Member | [Deathbreath, 37129583](https://runescape.wiki/w/Special:PermanentLink/37129583) | All typed Monster infoboxes agree; retain pinned policy. |
| Dragon wolf alpha | Member | [Dragon wolf alpha, 37129503](https://runescape.wiki/w/Special:PermanentLink/37129503) | All typed Monster infoboxes agree; retain pinned policy. |
| Elegorn the Celestial | Member | [Elegorn the Celestial, 37132656](https://runescape.wiki/w/Special:PermanentLink/37132656) | All typed Monster infoboxes agree; retain pinned policy. |
| Alanogard the Black | Member | [Alanogard the Black, 37132657](https://runescape.wiki/w/Special:PermanentLink/37132657) | All typed Monster infoboxes agree; retain pinned policy. |
| Sangri the Red | Member | [Sangri the Red, 37132658](https://runescape.wiki/w/Special:PermanentLink/37132658) | All typed Monster infoboxes agree; retain pinned policy. |
| Emberbound Soul | Member | [Emberbound Soul, 37129587](https://runescape.wiki/w/Special:PermanentLink/37129587) | All typed Monster infoboxes agree; retain pinned policy. |
| Engorged lava strykewyrm | Member | [Engorged lava strykewyrm, 37132528](https://runescape.wiki/w/Special:PermanentLink/37132528) | All typed Monster infoboxes agree; retain pinned policy. |
| Firebelly | Member | [Firebelly, 37129539](https://runescape.wiki/w/Special:PermanentLink/37129539) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant slime | Member | [Giant slime, 37129512](https://runescape.wiki/w/Special:PermanentLink/37129512) | All typed Monster infoboxes agree; retain pinned policy. |
| Shul the Molten | Member | [Shul the Molten, 37129590](https://runescape.wiki/w/Special:PermanentLink/37129590) | All typed Monster infoboxes agree; retain pinned policy. |
| Smoulders | Member | [Smoulders, 37129589](https://runescape.wiki/w/Special:PermanentLink/37129589) | All typed Monster infoboxes agree; retain pinned policy. |
| Spyndra | Member | [Spyndra, 37129505](https://runescape.wiki/w/Special:PermanentLink/37129505) | All typed Monster infoboxes agree; retain pinned policy. |
| Verak Little | Member | [Verak Little, 37129504](https://runescape.wiki/w/Special:PermanentLink/37129504) | All typed Monster infoboxes agree; retain pinned policy. |
| Astellarn | Member | [Astellarn, 37152305](https://runescape.wiki/w/Special:PermanentLink/37152305) | All typed Monster infoboxes agree; retain pinned policy. |
| Verak Lith | Member | [Verak Lith, 37160711](https://runescape.wiki/w/Special:PermanentLink/37160711) | All typed Monster infoboxes agree; retain pinned policy. |
| Risen ghost | Member | [Risen ghost, 37143970](https://runescape.wiki/w/Special:PermanentLink/37143970) | All typed Monster infoboxes agree; retain pinned policy. |
| Armoured phantom | Member | [Armoured phantom, 37133711](https://runescape.wiki/w/Special:PermanentLink/37133711) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghostly troll bruiser | Free | [Ghostly troll bruiser, 37123386](https://runescape.wiki/w/Special:PermanentLink/37123386) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghostly troll thrower | Free | [Ghostly troll thrower, 37123385](https://runescape.wiki/w/Special:PermanentLink/37123385) | All typed Monster infoboxes agree; retain pinned policy. |
| Vermyx, Brood Mother | Member | [Vermyx, Brood Mother, 37170885](https://runescape.wiki/w/Special:PermanentLink/37170885) | All typed Monster infoboxes agree; retain pinned policy. |
| Kezalam, the Wanderer | Member | [Kezalam, the Wanderer, 37170886](https://runescape.wiki/w/Special:PermanentLink/37170886) | All typed Monster infoboxes agree; retain pinned policy. |
| Nakatra, Devourer Eternal | Member | [Nakatra, Devourer Eternal, 37176423](https://runescape.wiki/w/Special:PermanentLink/37176423) | All typed Monster infoboxes agree; retain pinned policy. |
| Nail beast | Member | [Nail beast, 37122897](https://runescape.wiki/w/Special:PermanentLink/37122897) | All typed Monster infoboxes agree; retain pinned policy. |
| Undead Lumberjack | Member | [Undead Lumberjack, 37125136](https://runescape.wiki/w/Special:PermanentLink/37125136) | All typed Monster infoboxes agree; retain pinned policy. |
| Ghast | Member | [Ghast, 37122960](https://runescape.wiki/w/Special:PermanentLink/37122960) | All typed Monster infoboxes agree; retain pinned policy. |
| Swamp snake | Member | [Swamp snake, 37122914](https://runescape.wiki/w/Special:PermanentLink/37122914) | All typed Monster infoboxes agree; retain pinned policy. |
| Giant snail | Member | [Giant snail, 37122929](https://runescape.wiki/w/Special:PermanentLink/37122929) | All typed Monster infoboxes agree; retain pinned policy. |
| Profane Scabarite | Member | [Profane Scabarite, 37166666](https://runescape.wiki/w/Special:PermanentLink/37166666) | All typed Monster infoboxes agree; retain pinned policy. |
| Elite Profane Scabarite | Member | [Elite Profane Scabarite, 37168152](https://runescape.wiki/w/Special:PermanentLink/37168152) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Kih | Member | [TzekHaar-Kih, 37133402](https://runescape.wiki/w/Special:PermanentLink/37133402) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Xil | Member | [TzekHaar-Xil, 37133407](https://runescape.wiki/w/Special:PermanentLink/37133407) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Mej | Member | [TzekHaar-Mej, 37133404](https://runescape.wiki/w/Special:PermanentLink/37133404) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Hur | Member | [TzekHaar-Hur, 37133403](https://runescape.wiki/w/Special:PermanentLink/37133403) | All typed Monster infoboxes agree; retain pinned policy. |
| TzKal-Zuk | Member | [TzKal-Zuk, 37156397](https://runescape.wiki/w/Special:PermanentLink/37156397) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Tok-Xil | Member | [TzekHaar-Tok-Xil, 37124799](https://runescape.wiki/w/Special:PermanentLink/37124799) | All typed Monster infoboxes agree; retain pinned policy. |
| Volatile TzekHaar-Hur | Member | [Volatile TzekHaar-Hur, 37124801](https://runescape.wiki/w/Special:PermanentLink/37124801) | All typed Monster infoboxes agree; retain pinned policy. |
| Igneous TzekHaar-Hur | Member | [Igneous TzekHaar-Hur, 37141307](https://runescape.wiki/w/Special:PermanentLink/37141307) | All typed Monster infoboxes agree; retain pinned policy. |
| Igneous TzekHaar-Xil | Member | [Igneous TzekHaar-Xil, 37141308](https://runescape.wiki/w/Special:PermanentLink/37141308) | All typed Monster infoboxes agree; retain pinned policy. |
| Igneous TzekHaar-Mej | Member | [Igneous TzekHaar-Mej, 37141309](https://runescape.wiki/w/Special:PermanentLink/37141309) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Ket-Zek | Member | [TzekHaar-Ket-Zek, 37132317](https://runescape.wiki/w/Special:PermanentLink/37132317) | All typed Monster infoboxes agree; retain pinned policy. |
| Unbreakable TzekHaar-Ket | Member | [Unbreakable TzekHaar-Ket, 37141030](https://runescape.wiki/w/Special:PermanentLink/37141030) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Jad | Member | [TzekHaar-Jad, 37141029](https://runescape.wiki/w/Special:PermanentLink/37141029) | All typed Monster infoboxes agree; retain pinned policy. |
| TzekHaar-Aken | Member | [TzekHaar-Aken, 37165003](https://runescape.wiki/w/Special:PermanentLink/37165003) | All typed Monster infoboxes agree; retain pinned policy. |
| Death Lotus rogue | Member | [Death Lotus rogue, 37123715](https://runescape.wiki/w/Special:PermanentLink/37123715) | All typed Monster infoboxes agree; retain pinned policy. |
| Eastern soldier | Member | [Eastern soldier, 37123717](https://runescape.wiki/w/Special:PermanentLink/37123717) | All typed Monster infoboxes agree; retain pinned policy. |
| Flying jellyfish | Member | [Flying jellyfish, 37127386](https://runescape.wiki/w/Special:PermanentLink/37127386) | All typed Monster infoboxes agree; retain pinned policy. |
| Gu ronin | Member | [Gu ronin, 37123714](https://runescape.wiki/w/Special:PermanentLink/37123714) | All typed Monster infoboxes agree; retain pinned policy. |
| Seasinger priestess | Member | [Seasinger priestess, 37123713](https://runescape.wiki/w/Special:PermanentLink/37123713) | All typed Monster infoboxes agree; retain pinned policy. |
| Silverquill, the Dreadhog | Member | [Silverquill, the Dreadhog, 37199696](https://runescape.wiki/w/Special:PermanentLink/37199696) | All typed Monster infoboxes agree; retain pinned policy. |
