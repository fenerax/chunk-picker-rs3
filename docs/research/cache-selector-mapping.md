# Retained selector spatial correspondence

The complete original cohort of **453 unresolved selectors** was checked against the audited copied-cache locations and exact closed-scenario tile components. **80 additional selectors** have defensible correspondence; **373 remain unresolved**. The runtime policy now maps **689 of 1062 selectors**, with **665** allowing automatic projection. There are **59** unresolved unsplit primaries. Physical walking evidence and resource correspondence remain separate.

The [complete evidence file](../../app/data/cache-selector-evidence.2026-10-07.v1.json) includes all 453 original selectors plus five previously mapped priority reviews. Each row retains the Object, NPC, Monster, Spawn and Connect declarations, exact sibling-exclusive object names, all matched copied placements, original source coordinates/archive references, rotated decoded rectangle, complete cardinal perimeter witnesses, and accepted or unresolved reason. Every accepted runtime mapping includes its witness coordinates and original unresolved boundary/signature provenance in [the generated policy](../../app/data/cache-component-policy.2026-10-07.v1.json). Existing 609 physical correspondences keep their original methods and components. New correspondence does not certify that every retained resource remains present or interactable.

## Evidence and acceptance rule

Sources are the audit's full <code>walkability.v1.json.gz</code> component masks and the read-only <code>rs3-cache-work/cache-copy</code> location, object-definition and layout databases. The generator verifies copied js5-5, js5-16 and js5-23 SHA-256 values against the audited manifest, and checks decoder interpreter/constants hashes. Those hashes and the full walkability hash are saved with the evidence. Original game files and private saves are not opened.

A retained Object name must match a decoded placement name exactly and occur in only this section among its siblings. No stripping qualifiers, approximate names or guessed quantities selects a placement. Unsplit -0 selectors use their top-level declarations. Only original plane-0 locations are used; conditional morph names cannot certify a correspondence. All matching placements in the declared region are retained, including disagreements. NPCs, monster spawns and ground-item spawns have no authoritative server placement catalogue in this copied export; their declarations are recorded but cannot manufacture coordinates.

A walkable placement tile identifies its exact component. Otherwise, the complete cardinal perimeter of the decoded, rotated rectangular footprint supplies possible spatial witnesses, restricted to this region and the placement's actual source floor; an object below a rendered bridge cannot identify the overlying bridge component. The perimeter does not prove an interaction or an open door. Every usable unconditional exclusive anchor must have the same unique common component. One ambiguous footprint stays unresolved; disjoint anchors stay unresolved; a second anchor can disambiguate a perimeter only when the common component actually touches both. There is no fragment-size ranking, nearest-tile search, majority vote, candidate ordering, inferred bridge opening or arbitrary radius. Anchors with no walkable witness are recorded, never moved.

This deliberately does not union disjoint resource fragments into an invented single walking section. A section whose exclusive declarations span several components needs reviewed resource geometry or separate source attribution. Existing walking mappings with conflicting object witnesses are retained for traversal but marked <code>resourceUnresolved</code>. Every one of the 1,062 retained selectors is also audited for unlocated declared contents: any NPC, Monster, Shop, Spawn or Connect lacking exact placement evidence, or any Object name not completely corroborated to its mapped component, marks resource correspondence unresolved. Raw numeric location keys and keys matching named/numeric retained location definitions are also unlocated entrance/area aliases, even when they occur outside Connect; for example 12342-3 declares 12610 directly. The generated policy records these under <code>LocationAlias</code>, lists exact unlocated declarations per row, and uses reason <code>unlocated-declared-contents-or-entrances</code>. There are **981 resource-uncertain selectors**. Unresolved selectors and shared component aliases receive the same resource flag. This also applies to boundary-signature mappings: a walking correspondence cannot locate all contents or entrances. Consumers must keep such retained resource access separate from component seeding.

## Priority and named source findings

Task Chunks/Sections declarations also require a task-location witness even if the retained section has no listed objects or NPCs. The audit expands only declared chunksPlus aliases (with cycle protection and unambiguous alias names); a bare numeric base reference marks every retained selector of that base as potentially used. Every affected row stores <code>declaredTaskLocations</code> with permanent task ID, category, raw label, field, original token and expanded location, and a <code>TaskLocation</code> unlocated declaration. No task location is inferred from a nearby mapped object. In particular, **12348-2** retains Filthy Rich's declared action location and **13107-4** retains the Lumbridge cow-pen compass clue location as resource-uncertain, despite empty section contents.

* **13361-1, Kharid-et:** existing component 1 is independently corroborated by the declared workbench at (3343,3197) and bank chest at (3356,3198). Their full footprint evidence is in the priority row.

* **13620-2, Nature grotto:** newly mapped to component 15. All three retained Stones match placements at (3439,3336), (3440,3335), and (3441,3336); every witness agrees. Resource correspondence remains unresolved: these Stones do not certify the Connect 9043 interior entrance. Filliman Tarlock occurs in both section 1 and section 2, so his name alone cannot disambiguate them. Washing bowl is a ground spawn without copied server coordinates.

* **13620-3, Polypore entrance:** still unresolved. Its sole declaration is Connect 18517 (Polypore Dungeon). The copied region has Cave entrance 63093 at (3410,3330), footprint 2×2, whose only in-region perimeter witnesses are component 4 at (3410,3329)/(3411,3329). Neither the retained declaration nor the static object definition uniquely certifies that this cave is the declared Polypore entrance, so the plausible component is not accepted.

* **13618-1, Abandoned Mine:** existing walking component 10 is retained, with resource uncertainty. Cart tunnel at (3430,3233) witnesses 10; (3429,3225) touches 10/11; (3440,3232) touches 13/14. Mine carts also witness 14. The retained Mithril/Coal veins are in the separate named Abandoned Mine interior, not surface coordinates certified by this export. These discrepancies do not prove the veins or tunnels inaccessible in game.

* **12092-5, Lava Maze:** existing component 8 is shared with section 4, so automatic resource projection remains false and resource correspondence unresolved. The only retained section-5 anchor is Mysterious ghost plus the named dungeon connection; neither has certified coordinates here. A copied Ladder at (3017,3849) touches component 2, but its generic name does not identify which retained dungeon connection it serves. Fishing spot (lava) is retained in other selectors/interiors; the copied static-location export does not certify its server fishing-spawn placement.

* **13108-2, Guidor:** existing component 2 remains a walking mapping with resource uncertainty. Retained Bookcase/Drawers anchors witness 2/5/6, and one drawer at (3321,3385) witnesses 11. Guidor and his wife have no certified copied server placements. The static section mapping cannot place either NPC on a specific component.

* **Philipe Carnillean:** his retained locations include conditional quest-point locations and upper floors/interiors. No NPC spawn coordinate is inferred from a same-region object. For example, 9273-1 has no sibling-exclusive coordinate anchor; Mountain Camp 11065-1 and Shilo 11310-1 have conflicting object witnesses. These remain unresolved. Already mapped selectors keep their provenance; a surface component does not remove their retained NPC/task requirements.

## Reproduction

Run from this checkout; the three commands write only authored evidence, policy and this report:

```powershell
node scripts/cache/audit-selector-mapping.mjs C:/Users/User/Projects/rs3-cache-work
node scripts/cache/build-runtime-topology.mjs C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/membership.v1.json
node scripts/cache/report-selector-mapping.mjs
node --test tests/cache-selector-mapping.test.mjs tests/cache-topology-application.test.mjs tests/cache-task-access.test.mjs
```

The audit cohort is identified by original unresolved provenance, so rerunning after acceptance still examines exactly the original 453. The tests cover exact versus perimeter witnesses, complete-perimeter ambiguity, agreement versus conflicting anchors, conditional and missing coverage, foreign component rejection, original provenance retention, every accepted evidence row and priority resource flags.

## All accepted additions

| Retained selector | Name | Cache component | Matched exclusive object names |
| --- | --- | --- | --- |
| 8753-3 | Tyras Camp | 8753:1 | Small furnace |
| 9001-0 | Iron Enclave | 9001:1 | Iron Enclave portal |
| 9010-1 | North Isafdar | 9010:20 | Fire remains |
| 9010-3 | North Isafdar | 9010:50 | Tripwire |
| 9276-0 | West ice trolls | 9276:1 | Arctic Pine, Cave, Pile of logs, Rope bridge, Woodcutting stump |
| 9516-0 | The Warforge | 9516:1 | Archaeologist's workbench, Bank chest, Eucalyptus tree, Material cache (Yu'biusk clay), Material cache (vulcanised rubber), Mysterious note |
| 9525-1 | Brimstail's cave | 9525:3 | Magic tree |
| 9532-3 | East ice trolls | 9532:3 | Drakolith rock |
| 9777-3 | Observatory | 9777:7 | Star chart |
| 9778-1 | Ouriana Altar | 9778:1 | Chaos altar, Dead tree, Grave of Scorpius, Luminite rock, Oak, Willow, Young tree |
| 10029-0 | Feldip Hunter Area | 10029:1 | Ascension dungeon, Burrow, Bush, Cave, Dead tree, Jungle Tree, Jungle plant, Material cache (animal furs) |
| 10036-2 | Combat Training Camp | 10036:1 | Anvil, Fence, Forge, Sacks |
| 10037-1 | Glarial's Tomb | 10037:2 | Fire, Fireplace, Glarial's tombstone, Oak, Tree |
| 10038-2 | Baxtorian Falls | 10038:2 | Barbarian anvil, Barbarian forge, Whirlpool, Yew |
| 10040-0 | Lighthouse | 10040:4 | Small obelisk |
| 10284-3 | East Oo'glog | 10284:1 | Eucalyptus tree |
| 10287-1 | Gu'Tanoth Island | 10287:1 | Crystal tree, Oak, Willow |
| 10287-2 | Gu'Tanoth Island | 10287:12 | Chest, Fire |
| 10295-0 | Isla Anglerine | 10295:1 | Barrel |
| 10537-0 | Void Knights' Outpost | 10537:1 | Anvil, Bank booth, Bookcase, Forge |
| 10558-0 | South Iceberg | 10558:1 | Boat, Stepping Stone |
| 10559-0 | North Iceberg | 10559:1 | Ice steps, Stepping Stone |
| 10794-1 | West Ape Atoll | 10794:2 | Mahogany, Pineapple Plant |
| 10794-3 | West Ape Atoll | 10794:6 | Fairy ring, Mango tree |
| 10806-2 | Seers' Village | 10806:34 | Fountain |
| 10809-1 | Fremennik Mine | 10809:3 | Dead tree, Iron rock, Oak, Tree |
| 11050-1 | East Ape Atoll | 11050:1 | Teak |
| 11051-2 | Marim | 11051:2 | Crates |
| 11059-1 | Fishing Platform | 11059:8 | Crate |
| 11060-1 | West Entrana | 11060:2 | Sink, Tree, Well |
| 11063-3 | Sinclair Lake | 11063:9 | Potato |
| 11064-1 | Rellekkan Slayer Cave Entrance | 11064:2 | Danger sign, Dead tree, Oak, Rock face, Tree |
| 11066-1 | Mountain Slope South | 11066:4 | Tunnel |
| 11067-2 | Mountain Slope North | 11067:7 | Trollweiss flowers |
| 11313-0 | Karamja volcano | 11313:1 | Convenient rock, Dead tree, Rocks, Small obelisk, Strong tree |
| 11314-1 | South Crandor | 11314:1 | Runite rock |
| 11314-2 | South Crandor | 11314:5 | Hole |
| 11317-5 | Catherby Beach | 11317:20 | Bank deposit box, Counter |
| 11318-4 | White Wolf Mountain | 11318:13 | Burthorpe mine |
| 11318-5 | White Wolf Mountain | 11318:11 | Boulder, Hole, Rocks, Snow pile |
| 11318-7 | White Wolf Mountain | 11318:5 | Crate, Drawers |
| 11567-2 | Karamjan Idol | 11567:2 | Dense jungle vines, Light jungle vines, Medium jungle vines |
| 11573-0 | South Taverley | 11573:1 | Barrel, Crystal chest, Drawers, Obelisk, Oven, Sink, Stepping stone, Steps, Tree, Water barrel, Wheat |
| 11576-1 | Troll Arena | 11576:3 | Cliffside, Rocks |
| 11577-2 | Trollheim | 11577:8 | Chest |
| 11578-1 | God Wars Dungeon | 11578:4 | Hole |
| 11578-3 | God Wars Dungeon | 11578:6 | Chest |
| 11579-0 | Lucien's Camp | 11579:2 | Crate |
| 11831-1 | West Wildy Ditch | 11831:1 | Oak, Tree |
| 12343-1 | Abyss Mage | 12343:2 | Death list, Oak, PvP hatch, Rift, Runite rock, Tree |
| 12596-2 | Champions' Guild | 12596:2 | Nettles |
| 12599-0 | Center Wildy Ditch | 12599:2 | Chest, Rift, Tree |
| 12843-1 | Menaphos Merchant District | 12843:5 | Bank booth, Bank deposit box, Fountain, Lamp stall, Obelisk, Silk stall |
| 12851-4 | Groats' Farm | 12851:4 | Cabbage, Onion |
| 13104-2 | Shantay Pass | 13104:10 | Shantay chest |
| 13108-3 | Varrock South-East Mine | 13108:11 | Dig sites map |
| 13109-2 | Varrock East Gate | 13109:7 | Well |
| 13111-0 | Fort Forinthry | 13111:2 | Fort Forinthry blueprints, Stonecutter, Woodworking bench |
| 13354-1 | West Camel Warrior Island | 13354:3 | Stepping Stone |
| 13362-4 | Het's Oasis | 13362:1 | Material cache (samite silk) |
| 13370-2 | Charming Moths | 13370:2 | Zephyrium rock |
| 13372-1 | Dragonkin Laboratory Entrance | 13372:6 | Dragonkin Laboratory |
| 13611-0 | Ullek Marsh | 13611:1 | Fallen pillar |
| 13620-2 | Nature Grotto | 13620:15 | Stone |
| 13875-1 | Mort'ton | 13875:5 | Broken Wall, Dead tree, Flamtaer shrine, Funeral Pyre, Shelf, Sink |
| 13881-0 | Daemonheim Docks | 13881:1 | Bathus rock, Fractite rock, Fremennik ship (Shadow reef) |
| 14893-0 | K'Chunk's Chunk | 14893:4 | Fairy ring |
| 14894-0 | Mos Le'Harmless Cave | 14894:1 | Small obelisk, Stepping stone |
| 14898-0 | Everlight Digsite Mass Grave | 14898:1 | Material cache (keramos), Materials cart |
| 14899-2 | Everlight Digsite Amphitheater | 14899:2 | Material cache (cobalt blue), Materials cart |
| 15148-0 | Harmony Island | 15148:1 | Cabbage, Water barrel, Wheat |
| 15150-0 | Trouble Brewing | 15150:1 | Blue flowers, Jungle Tree, Log Store, Portal, Red flowers, Scrapey Tree, Steam Pump, Stepping log, Workbench |
| 15159-0 | Dragontooth Island | 15159:1 | Chain |
| 15390-0 | Khan's House | 15390:1 | Khan's house, Material cache (soapstone), Waiko moai, Water barrel |
| 16436-3 | Wendle's Wicks | 16436:3 | Pottery wheel |
| 16690-2 | Dalia's Tree Nursery | 16690:13 | Range |
| 16945-2 | Jackalope Burrows | 16945:3 | Ladder |
| 17206-1 | Saradominist Watchtower Ruins | 17206:2 | Material cache (cashmere), Material cache (triskelion) |
| 18205-0 | South-East Gongdung | 18205:1 | Trunk |
| 18206-0 | North-East Gongdung | 18206:2 | Trunk |

## Unresolved reason totals

| Reason | Selectors |
| --- | --- |
| anchors-have-no-unconditional-walkable-witness | 3 |
| exclusive-anchors-disagree | 58 |
| footprint-touches-several-components | 5 |
| missing-plane-0-coverage | 19 |
| no-exclusive-coordinate-anchor | 288 |

## Complete unresolved remainder

Every unresolved selector is listed below. Empty/no-exclusive anchors include empty sections, names shared among siblings, unmatched exact names, named connections lacking an identified entrance, and declarations whose NPC/monster/item placements are outside this static export. The evidence JSON distinguishes these with the complete declaration and matched-name inventory. Conflicts retain all spatial witnesses for further review.

| Retained selector | Name | Reason | Matched exclusive names / coordinate anchors |
| --- | --- | --- | --- |
| 7474-0 | North-West Lost Grove | no-exclusive-coordinate-anchor | none |
| 7727-0 | Lost Grove Entrance | missing-plane-0-coverage | none |
| 7728-0 | South Lost Grove | no-exclusive-coordinate-anchor | none |
| 7984-0 | South-East Lost Grove | no-exclusive-coordinate-anchor | none |
| 7986-0 | North-East Lost Grove | no-exclusive-coordinate-anchor | none |
| 8244-0 | West coast Prifddinas | missing-plane-0-coverage | none |
| 8252-1 | South Moonclan | no-exclusive-coordinate-anchor | none |
| 8252-2 | South Moonclan | exclusive-anchors-disagree | Anvil, Barrel, Forge, Sink |
| 8252-3 | South Moonclan | no-exclusive-coordinate-anchor | none |
| 8496-1 | Port Tyras | exclusive-anchors-disagree | Crate, Crates |
| 8496-2 | Port Tyras | no-exclusive-coordinate-anchor | none |
| 8496-3 | Port Tyras | no-exclusive-coordinate-anchor | none |
| 8497-0 | West Tyras camp | exclusive-anchors-disagree | Tree |
| 8499-2 | South-west Prifddinas | no-exclusive-coordinate-anchor | none |
| 8501-2 | North-west Prifddinas | no-exclusive-coordinate-anchor | none |
| 8748-0 | Soul Wars Lobby | exclusive-anchors-disagree | Balance portal, Bank chest, Blue barrier, Edgeville portal, Red barrier |
| 8751-0 | Lost grove entrance | exclusive-anchors-disagree | Standstone, Tree |
| 8752-2 | West poison waste | no-exclusive-coordinate-anchor | none |
| 8752-4 | West poison waste | no-exclusive-coordinate-anchor | none |
| 8753-1 | Tyras Camp | exclusive-anchors-disagree | Sticks |
| 8754-1 | Iorwerth Camp | exclusive-anchors-disagree | Barrel, Leaves, Sticks |
| 8756-2 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 8756-3 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 8756-4 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 8756-5 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 8756-6 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 8756-7 | Central Prifddinas | no-exclusive-coordinate-anchor | none |
| 9008-2 | East Poison Waste | no-exclusive-coordinate-anchor | none |
| 9009-1 | Tirannwn lodestone | exclusive-anchors-disagree | Leaves, Light animica rock, Magic tree, Sticks, Tracks, Tripwire |
| 9010-2 | North Isafdar | no-exclusive-coordinate-anchor | none |
| 9011-2 | South-east Prifddinas | no-exclusive-coordinate-anchor | none |
| 9011-3 | South-east Prifddinas | no-exclusive-coordinate-anchor | none |
| 9011-4 | South-east Prifddinas | no-exclusive-coordinate-anchor | none |
| 9011-5 | South-east Prifddinas | no-exclusive-coordinate-anchor | none |
| 9012-1 | East Prifddinas | no-exclusive-coordinate-anchor | none |
| 9012-2 | East Prifddinas | no-exclusive-coordinate-anchor | none |
| 9264-0 | Poison Waste Slayer Dungeon entrance | no-exclusive-coordinate-anchor | none |
| 9265-1 | Lletya | exclusive-anchors-disagree | Bookcase, Counter, Crate, Flax, Small obelisk, Spinning wheel, Tree, Water barrel |
| 9265-2 | Lletya | no-exclusive-coordinate-anchor | none |
| 9266-1 | Underground Pass exit | no-exclusive-coordinate-anchor | none |
| 9267-2 | Arandar | no-exclusive-coordinate-anchor | none |
| 9273-1 | Piscatoris Fishing Colony | no-exclusive-coordinate-anchor | none |
| 9273-2 | Piscatoris Fishing Colony | no-exclusive-coordinate-anchor | none |
| 9278-0 | Ungael Landing | no-exclusive-coordinate-anchor | none |
| 9279-0 | Ungael Castle | no-exclusive-coordinate-anchor | none |
| 9520-0 | Castle wars | exclusive-anchors-disagree | Achey Tree, Ballista platform, Stepping stone, Steps, Tap, Tinderbox |
| 9525-2 | Brimstail's cave | no-exclusive-coordinate-anchor | none |
| 9526-3 | Gnomeball Field | no-exclusive-coordinate-anchor | none |
| 9527-1 | River Delta | no-exclusive-coordinate-anchor | none |
| 9527-4 | River Delta | no-exclusive-coordinate-anchor | none |
| 9528-0 | Falconry area | exclusive-anchors-disagree | Fire, Oak, Stile, Tree |
| 9531-2 | Jatizso | no-exclusive-coordinate-anchor | none |
| 9778-3 | Ouriana Altar | no-exclusive-coordinate-anchor | none |
| 9779-3 | Underground Pass Entrance | no-exclusive-coordinate-anchor | none |
| 9780-1 | Jorral's Outpost | exclusive-anchors-disagree | Oak, Rotten Apple Pile, Tree |
| 9780-2 | Jorral's Outpost | no-exclusive-coordinate-anchor | none |
| 9782-1 | Grand Tree | exclusive-anchors-disagree | Dead tree, Oak, Tree, Wheat |
| 9791-0 | North-West Mammoth Iceberg | no-exclusive-coordinate-anchor | none |
| 10031-0 | Gu'Tanoth | exclusive-anchors-disagree | Battlement, Chest, Counter, Fire, Gap, Oak, Obelisk, Tree |
| 10033-4 | Tree Gnome Village | no-exclusive-coordinate-anchor | none |
| 10037-2 | Glarial's Tomb | no-exclusive-coordinate-anchor | none |
| 10038-3 | Baxtorian Falls | no-exclusive-coordinate-anchor | none |
| 10042-1 | Waterbirth island | no-exclusive-coordinate-anchor | none |
| 10042-2 | Waterbirth island | no-exclusive-coordinate-anchor | none |
| 10044-2 | Miscellania | no-exclusive-coordinate-anchor | none |
| 10284-1 | East Oo'glog | exclusive-anchors-disagree | Achey tree, Crate, Fire, Rocks |
| 10288-4 | East Yanille | no-exclusive-coordinate-anchor | none |
| 10296-0 | Lighthouse Bridge | exclusive-anchors-disagree | Crystal tree, Dead tree, Flax, Maple Tree, Oak, Tree |
| 10297-2 | West Rellekka | no-exclusive-coordinate-anchor | none |
| 10536-0 | Pest Control | exclusive-anchors-disagree | Barricade, Log stockpile |
| 10543-2 | The Infamous One Tile Yanille Corner | no-exclusive-coordinate-anchor | none |
| 10545-0 | Port Khazard | exclusive-anchors-disagree | Anvil, Bank deposit box, Boxes, Cooking pot, Crate, Dead tree, Fire, Forge, Oak, Runite rock, Small obelisk, Tree |
| 10547-3 | Ardougne Market | no-exclusive-coordinate-anchor | none |
| 10548-0 | Manor Farm | exclusive-anchors-disagree | Beehive, Breeding paddock, Crate, Drawers, Hay bale, Manor Farm breeding log, Manure mound, Remote farm device, Stile, Tree, Water barrel |
| 10794-2 | West Ape Atoll | no-exclusive-coordinate-anchor | none |
| 10794-4 | West Ape Atoll | footprint-touches-several-components | Skull slope |
| 10794-5 | West Ape Atoll | no-exclusive-coordinate-anchor | none |
| 10795-2 | Marim Entrance | no-exclusive-coordinate-anchor | none |
| 10802-2 | Horseshoe Mine | no-exclusive-coordinate-anchor | none |
| 10802-3 | Horseshoe Mine | no-exclusive-coordinate-anchor | none |
| 10806-1 | Seers' Village | exclusive-anchors-disagree | Anvil, Bank booth, Bank deposit box, Bookcase, Church organ, Crate, Crystal tree, Dead tree, Drawers, Fireplace, Forge, Inventor's workbench, Maple Tree, Oak, Old bookshelf, Sink, Tree, Willow, Yew |
| 10807-1 | Sinclair Mansion | exclusive-anchors-disagree | Anna's barrel, Barrel of flour, Bob's barrel, Bookcase, Cabbage, Dairy churn, Dairy cow, Dead tree, Drawers, Fireplace, Maple Tree, Oak, Potato, Sacks, Sinclair family beehive, Sinclair family compost heap, Sinclair family crest, Sinclair family fountain, Sinclair mansion drain, Sink, Tree, Wheat, Willow |
| 10809-2 | Fremennik Mine | no-exclusive-coordinate-anchor | none |
| 10809-3 | Fremennik Mine | no-exclusive-coordinate-anchor | none |
| 10810-2 | Rellekka Peninsula | no-exclusive-coordinate-anchor | none |
| 10814-0 | Iceberg Island | no-exclusive-coordinate-anchor | none |
| 11050-2 | East Ape Atoll | exclusive-anchors-disagree | Hole, Rope, Stepping stone |
| 11050-3 | East Ape Atoll | no-exclusive-coordinate-anchor | none |
| 11050-4 | East Ape Atoll | no-exclusive-coordinate-anchor | none |
| 11053-2 | West Khazari Jungle | no-exclusive-coordinate-anchor | none |
| 11055-2 | South Tai Bwo Wannai | no-exclusive-coordinate-anchor | none |
| 11057-0 | Brimhaven | exclusive-anchors-disagree | Bookcase, Chest, Closed chest, Crate, Cupboard, Drawers, Drinks cabinet, Fireplace, Open chest, Piano, Pineapple Plant, Sandy's Desk, Sink, Well, Wheat |
| 11059-2 | Fishing Platform | no-exclusive-coordinate-anchor | none |
| 11063-1 | Sinclair Lake | no-exclusive-coordinate-anchor | none |
| 11065-1 | Mountain Camp | exclusive-anchors-disagree | Ancient Rock, Clump of rocks, Flat stone, Mud, Roots, Shining pool, Tall tree, Tree |
| 11066-2 | Mountain Slope South | no-exclusive-coordinate-anchor | none |
| 11309-2 | Central Khazari Jungle | no-exclusive-coordinate-anchor | none |
| 11310-1 | Shilo Village | exclusive-anchors-disagree | Bookcase, Broken cart, Furnace, Precious gem rock, Sand, Small obelisk, Travel cart |
| 11314-3 | South Crandor | no-exclusive-coordinate-anchor | none |
| 11316-0 | Entrana | exclusive-anchors-disagree | Bookcase, Candles, Drawers, Fountain, Furnace, Hay bales, Oak, Potato, Sand pit, Tree, Willow |
| 11317-3 | Catherby Beach | exclusive-anchors-disagree | Convenient rock, Grapple column, Rocks |
| 11317-4 | Catherby Beach | exclusive-anchors-disagree | Tree |
| 11318-1 | White Wolf Mountain | no-exclusive-coordinate-anchor | none |
| 11318-2 | White Wolf Mountain | no-exclusive-coordinate-anchor | none |
| 11318-6 | White Wolf Mountain | footprint-touches-several-components | Land of Snow portal |
| 11319-1 | Warrior's Guild | exclusive-anchors-disagree | Bank booth, Boxes, Burthorpe troll cave, Crate, Crates, Information Scroll |
| 11319-2 | Warrior's Guild | exclusive-anchors-disagree | Fire pit, Potato |
| 11319-3 | Warrior's Guild | no-exclusive-coordinate-anchor | none |
| 11319-4 | Warrior's Guild | no-exclusive-coordinate-anchor | none |
| 11319-5 | Warrior's Guild | no-exclusive-coordinate-anchor | none |
| 11320-1 | Death Plateau | exclusive-anchors-disagree | Boxes, Closed chest, Cooking pot, Danger sign, Open chest |
| 11320-2 | Death Plateau | no-exclusive-coordinate-anchor | none |
| 11320-3 | Death Plateau | no-exclusive-coordinate-anchor | none |
| 11320-4 | Death Plateau | no-exclusive-coordinate-anchor | none |
| 11325-1 | Ritual Site Coast | no-exclusive-coordinate-anchor | none |
| 11562-0 | Crash Island | exclusive-anchors-disagree | Jungle Tree, Pit |
| 11565-2 | East Khazari Jungle | no-exclusive-coordinate-anchor | none |
| 11565-3 | East Khazari Jungle | no-exclusive-coordinate-anchor | none |
| 11566-3 | Ah Za Rhoon | no-exclusive-coordinate-anchor | none |
| 11567-1 | Karamjan Idol | no-exclusive-coordinate-anchor | none |
| 11571-1 | Crafting Guild | exclusive-anchors-disagree | Bookcase, Drafting table, Drawers, Furnace, Inventor's workbench, Loom, Pattern table, Photo booth, Pottery oven, Sand pit, Sink, Spinning wheel, Tailor's display, Tailor's dummy, Tree, Willow |
| 11571-3 | Crafting Guild | no-exclusive-coordinate-anchor | none |
| 11576-2 | Troll Arena | no-exclusive-coordinate-anchor | none |
| 11577-1 | Trollheim | exclusive-anchors-disagree | Boulder, Rocks, Small obelisk |
| 11581-1 | Ghorrock | exclusive-anchors-disagree | Crate, Dead tree, Dead tree covered in snow, Pillar |
| 11581-2 | Ghorrock | no-exclusive-coordinate-anchor | none |
| 11581-3 | Ghorrock | no-exclusive-coordinate-anchor | none |
| 11581-4 | Ghorrock | no-exclusive-coordinate-anchor | none |
| 11821-1 | Herblore Habitat | exclusive-anchors-disagree | Bank deposit box, Burrow, Bush, Cauldron, Climbable vine, Hole, Jungle Tree, Jungle plant, Vine |
| 11821-2 | Herblore Habitat | no-exclusive-coordinate-anchor | none |
| 11830-1 | Goblin Village | exclusive-anchors-disagree | Bandos's remains, Chaos altar, Chest, Crate, Fire, Sacks, Wheat |
| 11830-2 | Goblin Village | no-exclusive-coordinate-anchor | none |
| 11830-3 | Goblin Village | no-exclusive-coordinate-anchor | none |
| 11831-2 | West Wildy Ditch | footprint-touches-several-components | Iron maiden |
| 11836-0 | Western Obelisk | no-exclusive-coordinate-anchor | none |
| 11837-0 | Frozen Waste Plateau | exclusive-anchors-disagree | Chest, Cliffside, Obstacle pipe, Ropeswing |
| 12078-0 | The Rock Island Prison | exclusive-anchors-disagree | Desk, Locker, Pier, Rubble |
| 12084-1 | East Falador | exclusive-anchors-disagree | Anvil, Bank booth, Bank chest, Bank deposit box, Bookcase, Burial Anvil, Chest, Crates, Drawers, Fountain, Lever, Noticeboard, Oak, Torch |
| 12087-1 | Black Knights' Fortress | no-exclusive-coordinate-anchor | none |
| 12087-3 | Black Knights' Fortress | exclusive-anchors-disagree | Iron maiden, Portcullis, Shelf, Tapestry |
| 12090-0 | Forinthry Dungeon | no-exclusive-coordinate-anchor | none |
| 12092-2 | West Lava Maze | no-exclusive-coordinate-anchor | none |
| 12329-1 | Menaphos West Port District | no-exclusive-coordinate-anchor | none |
| 12329-2 | Menaphos West Port District | no-exclusive-coordinate-anchor | none |
| 12329-3 | Menaphos West Port District | no-exclusive-coordinate-anchor | none |
| 12329-4 | Menaphos West Port District | no-exclusive-coordinate-anchor | none |
| 12331-2 | Menaphos Worker District Beach | no-exclusive-coordinate-anchor | none |
| 12338-2 | South Draynor | no-exclusive-coordinate-anchor | none |
| 12340-1 | Draynor Manor | exclusive-anchors-disagree | Bookcase, Cabbage, Candle sconce, Compost heap, Crate, Fountain, Gravestone, Lever |
| 12343-2 | Abyss Mage | no-exclusive-coordinate-anchor | none |
| 12347-2 | South-East Lava Maze | no-exclusive-coordinate-anchor | none |
| 12588-2 | Crimson Skillchompa Hunting Area | no-exclusive-coordinate-anchor | none |
| 12604-1 | Center North Wildy | no-exclusive-coordinate-anchor | none |
| 12840-2 | Menaphos South-East Dock | no-exclusive-coordinate-anchor | none |
| 12841-3 | Menaphos East Port District | no-exclusive-coordinate-anchor | none |
| 12842-0 | Menaphos Plaza | no-exclusive-coordinate-anchor | none |
| 12843-2 | Menaphos Merchant District | no-exclusive-coordinate-anchor | none |
| 12851-2 | Groats' Farm | exclusive-anchors-disagree | Bookcase, Closed chest, Open chest, Sink |
| 12851-3 | Groats' Farm | no-exclusive-coordinate-anchor | none |
| 12851-5 | Groats' Farm | no-exclusive-coordinate-anchor | none |
| 12851-6 | Groats' Farm | no-exclusive-coordinate-anchor | none |
| 12854-0 | Varrock Palace | exclusive-anchors-disagree | Altar, Bank chest, Bookcase, Choking ivy, Closed chest, Crate, Drawers, Dying tree, Fountain, Hole, Manhole, Noticeboard, Oak, Shelf, Tree, Varrock Census, Yew |
| 12855-0 | Varrock Ditch | exclusive-anchors-disagree | Chest, Death list, Oak, Tree |
| 12860-0 | North-East Red Dragon Isle | no-exclusive-coordinate-anchor | none |
| 13098-2 | Sophanem Temple | no-exclusive-coordinate-anchor | none |
| 13099-0 | Sophanem | exclusive-anchors-disagree | Centre piece, Crate, Hole, Potter's wheel, Sink, Spinning wheel |
| 13104-3 | Shantay Pass | no-exclusive-coordinate-anchor | none |
| 13107-3 | Al Kharid Mine | no-exclusive-coordinate-anchor | none |
| 13109-1 | Varrock East Gate | exclusive-anchors-disagree | Closed chest, Dead tree, Oak, Rift, Tea stall, Tree, Young tree |
| 13109-3 | Varrock East Gate | footprint-touches-several-components | Dig Site specimen rocks |
| 13354-2 | West Camel Warrior Island | no-exclusive-coordinate-anchor | none |
| 13355-2 | Sophanem Red Sandstone | no-exclusive-coordinate-anchor | none |
| 13356-2 | Jaleustrophos | no-exclusive-coordinate-anchor | none |
| 13362-2 | Het's Oasis | no-exclusive-coordinate-anchor | none |
| 13362-3 | Het's Oasis | no-exclusive-coordinate-anchor | none |
| 13366-3 | Silvarea Pass | no-exclusive-coordinate-anchor | none |
| 13367-1 | Woodcutter's Grove | no-exclusive-coordinate-anchor | none |
| 13367-2 | Woodcutter's Grove | no-exclusive-coordinate-anchor | none |
| 13367-3 | Woodcutter's Grove | no-exclusive-coordinate-anchor | none |
| 13368-1 | Daemonheim Entrance | no-exclusive-coordinate-anchor | none |
| 13369-3 | East Green Dragons | no-exclusive-coordinate-anchor | none |
| 13372-2 | Dragonkin Laboratory Entrance | no-exclusive-coordinate-anchor | none |
| 13612-2 | Ullek Plateau | no-exclusive-coordinate-anchor | none |
| 13617-1 | Abbey of St. Elspeth Citharede | exclusive-anchors-disagree | Altar, Bookcase, Cabbage, Crate, Drawers, Footlocker, Kharidian cactus (healthy), Sack, Sacks, Shelves, Sink, Statue of Saint Elspeth |
| 13619-3 | Path to Mort'ton | no-exclusive-coordinate-anchor | none |
| 13620-3 | Nature Grotto | no-exclusive-coordinate-anchor | none |
| 13621-0 | Mort Myre Swamp | exclusive-anchors-disagree | Budding branch, Swamp tree, The Stormbreaker |
| 13626-1 | West Daemonheim Castle | no-exclusive-coordinate-anchor | none |
| 13626-3 | West Daemonheim Castle | no-exclusive-coordinate-anchor | none |
| 13630-0 | Wilderness Volcano North-East Coast | no-exclusive-coordinate-anchor | none |
| 13875-4 | Mort'ton | no-exclusive-coordinate-anchor | none |
| 13877-2 | Myreque Hideout | no-exclusive-coordinate-anchor | none |
| 13878-2 | Canifis | no-exclusive-coordinate-anchor | none |
| 13879-0 | Old Crone's Hut | exclusive-anchors-disagree | Grave, Mausoleum, Memorial, Swamp tree |
| 13880-0 | Daemonheim Resource Area | exclusive-anchors-disagree | Bank deposit box, Magical barrier, Maple Tree, Promethium rock, Willow |
| 14130-3 | East Burgh de Rott | no-exclusive-coordinate-anchor | none |
| 14130-4 | East Burgh de Rott | no-exclusive-coordinate-anchor | none |
| 14133-3 | Morytania Graveyard | no-exclusive-coordinate-anchor | none |
| 14385-1 | Meiyerditch Beach | anchors-have-no-unconditional-walkable-witness | Boat, Rock |
| 14386-1 | South Meiyerditch | exclusive-anchors-disagree | Barricade, Broken stairs, Fireplace, Pots, Rocky surface, Shelf, Tunnel |
| 14386-4 | South Meiyerditch | no-exclusive-coordinate-anchor | none |
| 14387-1 | North Meiyerditch | no-exclusive-coordinate-anchor | none |
| 14387-2 | North Meiyerditch | no-exclusive-coordinate-anchor | none |
| 14387-4 | North Meiyerditch | no-exclusive-coordinate-anchor | none |
| 14388-2 | Darkmeyer | exclusive-anchors-disagree | Chest, Grate |
| 14389-1 | South Haunted Woods | exclusive-anchors-disagree | Grave, Hollow tree, Nettles, Swamp, Swamp tree |
| 14638-2 | Pirate Base | no-exclusive-coordinate-anchor | none |
| 14646-1 | Port Phasmatys | exclusive-anchors-disagree | Bank booth, Boxes, Closed chest, Cooking range, Furnace |
| 14646-3 | Port Phasmatys | no-exclusive-coordinate-anchor | none |
| 14659-0 | Dinosaur Farm South | no-exclusive-coordinate-anchor | none |
| 14660-0 | Dinosaur Farm North | no-exclusive-coordinate-anchor | none |
| 14878-0 | Waiko Western Docks | footprint-touches-several-components | Water barrel |
| 14884-0 | Tuai Leit Dock | no-exclusive-coordinate-anchor | none |
| 14897-0 | Everlight Digsite Acropolis | exclusive-anchors-disagree | Material cache (Star of Saradomin), Material cache (keramos), Materials cart |
| 14916-0 | Dinosaur Farm East | no-exclusive-coordinate-anchor | none |
| 15135-0 | Waiko Northern Docks | no-exclusive-coordinate-anchor | none |
| 15151-2 | Trouble Brewing Lobby | exclusive-anchors-disagree | Mahogany, Teak |
| 15169-1 | Anachronia West Excavation Site | no-exclusive-coordinate-anchor | none |
| 15171-0 | Anachronia Western Totem | no-exclusive-coordinate-anchor | none |
| 15172-1 | Anachronia Luminous Snagglers | no-exclusive-coordinate-anchor | none |
| 15172-2 | Anachronia Luminous Snagglers | no-exclusive-coordinate-anchor | none |
| 15172-3 | Anachronia Luminous Snagglers | no-exclusive-coordinate-anchor | none |
| 15172-4 | Anachronia Luminous Snagglers | no-exclusive-coordinate-anchor | none |
| 15389-2 | Waiko Village | no-exclusive-coordinate-anchor | none |
| 15391-0 | Cherry Blossom Bench | no-exclusive-coordinate-anchor | none |
| 15423-0 | Anachronia Western Peninsula Tip | no-exclusive-coordinate-anchor | none |
| 15425-1 | Anachronia Stormbreaker Landing | no-exclusive-coordinate-anchor | none |
| 15426-1 | Anachronia South-West Mine | no-exclusive-coordinate-anchor | none |
| 15426-2 | Anachronia South-West Mine | no-exclusive-coordinate-anchor | none |
| 15426-3 | Anachronia South-West Mine | no-exclusive-coordinate-anchor | none |
| 15427-1 | Arcane Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15427-3 | Arcane Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15427-4 | Arcane Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15428-1 | Crypt of Varanus | no-exclusive-coordinate-anchor | none |
| 15428-2 | Crypt of Varanus | no-exclusive-coordinate-anchor | none |
| 15429-1 | West Anachronia Volcano Pass | no-exclusive-coordinate-anchor | none |
| 15429-2 | West Anachronia Volcano Pass | no-exclusive-coordinate-anchor | none |
| 15430-0 | Cannibal Jadinko Hunting Spot | no-exclusive-coordinate-anchor | none |
| 15679-0 | Anachronia Western Peninsula Tig | no-exclusive-coordinate-anchor | none |
| 15680-0 | Anachronia Southern Bay Entrance | no-exclusive-coordinate-anchor | none |
| 15681-1 | Anachronia Agility Course Section B Start | no-exclusive-coordinate-anchor | none |
| 15681-2 | Anachronia Agility Course Section B Start | no-exclusive-coordinate-anchor | none |
| 15682-2 | Bagrada Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15682-3 | Bagrada Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15682-4 | Bagrada Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15683-1 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15683-2 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15683-3 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15683-4 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15683-5 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15683-6 | Anachronia Base Camp Entrance | no-exclusive-coordinate-anchor | none |
| 15684-0 | North Base Camp | no-exclusive-coordinate-anchor | none |
| 15686-1 | North Anachronia Pass | no-exclusive-coordinate-anchor | none |
| 15686-2 | North Anachronia Pass | no-exclusive-coordinate-anchor | none |
| 15936-0 | Anachronia Yellow Salamander hunting Area | no-exclusive-coordinate-anchor | none |
| 15937-1 | Scimitops Hunting Ground | no-exclusive-coordinate-anchor | none |
| 15938-2 | West Common Jadinko Hunting Spot | no-exclusive-coordinate-anchor | none |
| 15938-3 | West Common Jadinko Hunting Spot | no-exclusive-coordinate-anchor | none |
| 15938-4 | West Common Jadinko Hunting Spot | no-exclusive-coordinate-anchor | none |
| 15939-1 | Anachronia Base Camp | no-exclusive-coordinate-anchor | none |
| 15939-2 | Anachronia Base Camp | no-exclusive-coordinate-anchor | none |
| 15939-4 | Anachronia Base Camp | no-exclusive-coordinate-anchor | none |
| 15939-5 | Anachronia Base Camp | no-exclusive-coordinate-anchor | none |
| 15940-1 | Malletops Hunting Grounds | no-exclusive-coordinate-anchor | none |
| 15940-2 | Malletops Hunting Grounds | no-exclusive-coordinate-anchor | none |
| 15941-0 | Camouflaged Jadinko Hunting Spot | anchors-have-no-unconditional-walkable-witness | Flower |
| 15942-1 | Anachronia North Excavation Site | no-exclusive-coordinate-anchor | none |
| 15942-2 | Anachronia North Excavation Site | no-exclusive-coordinate-anchor | none |
| 15942-3 | Anachronia North Excavation Site | no-exclusive-coordinate-anchor | none |
| 15942-4 | Anachronia North Excavation Site | no-exclusive-coordinate-anchor | none |
| 15943-1 | Anachronia Northern Totem | missing-plane-0-coverage | none |
| 15943-2 | Anachronia Northern Totem | missing-plane-0-coverage | none |
| 16153-2 | Aminishi Dock | no-exclusive-coordinate-anchor | none |
| 16192-1 | Carrion Jadinko West Hunting Spot | no-exclusive-coordinate-anchor | none |
| 16193-1 | Moksha Ritual Site | no-exclusive-coordinate-anchor | none |
| 16193-2 | Moksha Ritual Site | no-exclusive-coordinate-anchor | none |
| 16193-3 | Moksha Ritual Site | no-exclusive-coordinate-anchor | none |
| 16193-4 | Moksha Ritual Site | no-exclusive-coordinate-anchor | none |
| 16194-1 | Spicati Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16194-2 | Spicati Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16194-3 | Spicati Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16194-4 | Spicati Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16194-5 | Spicati Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16196-2 | Anachronia Spirit Grove River | no-exclusive-coordinate-anchor | none |
| 16196-3 | Anachronia Spirit Grove River | no-exclusive-coordinate-anchor | none |
| 16197-1 | Pavosaurus Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16197-2 | Pavosaurus Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16197-3 | Pavosaurus Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16198-1 | Anachronia Brutish Dinosaurs | no-exclusive-coordinate-anchor | none |
| 16198-2 | Anachronia Brutish Dinosaurs | no-exclusive-coordinate-anchor | none |
| 16198-3 | Anachronia Brutish Dinosaurs | no-exclusive-coordinate-anchor | none |
| 16198-4 | Anachronia Brutish Dinosaurs | no-exclusive-coordinate-anchor | none |
| 16199-0 | OBservation Outpost Pass | missing-plane-0-coverage | none |
| 16435-2 | Wendlewick Fishing Shop | no-exclusive-coordinate-anchor | none |
| 16435-3 | Wendlewick Fishing Shop | anchors-have-no-unconditional-walkable-witness | Pottery table |
| 16436-2 | Wendle's Wicks | exclusive-anchors-disagree | Tailor's display, Tailor's dummy |
| 16448-1 | Anachronia Swamp Mine | no-exclusive-coordinate-anchor | none |
| 16448-2 | Anachronia Swamp Mine | no-exclusive-coordinate-anchor | none |
| 16449-1 | Anachronia Swamp | no-exclusive-coordinate-anchor | none |
| 16449-3 | Anachronia Swamp | no-exclusive-coordinate-anchor | none |
| 16450-1 | Asciatops Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16450-3 | Asciatops Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16450-4 | Asciatops Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16450-5 | Asciatops Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16452-1 | Oculi Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16452-2 | Oculi Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16452-3 | Oculi Apoterrasaur Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16453-1 | Herby Werby Entrance | no-exclusive-coordinate-anchor | none |
| 16453-2 | Herby Werby Entrance | no-exclusive-coordinate-anchor | none |
| 16453-3 | Herby Werby Entrance | no-exclusive-coordinate-anchor | none |
| 16454-1 | Observation Outpost | no-exclusive-coordinate-anchor | none |
| 16454-2 | Observation Outpost | no-exclusive-coordinate-anchor | none |
| 16454-3 | Observation Outpost | no-exclusive-coordinate-anchor | none |
| 16455-0 | A Single Tile North of the Observation Outpost | missing-plane-0-coverage | none |
| 16668-0 | North Island That Once Was a Turtle | no-exclusive-coordinate-anchor | none |
| 16689-3 | South-West Havenhythe Shore | no-exclusive-coordinate-anchor | none |
| 16691-2 | Burnt Lobster Tavern | no-exclusive-coordinate-anchor | none |
| 16691-3 | Burnt Lobster Tavern | no-exclusive-coordinate-anchor | none |
| 16693-2 | Abandoned Cart | no-exclusive-coordinate-anchor | none |
| 16704-1 | Xolo City Ruins | no-exclusive-coordinate-anchor | none |
| 16704-2 | Xolo City Ruins | no-exclusive-coordinate-anchor | none |
| 16705-1 | Anachronia South-Eastern Totem | no-exclusive-coordinate-anchor | none |
| 16705-2 | Anachronia South-Eastern Totem | no-exclusive-coordinate-anchor | none |
| 16706-1 | Anachronia Agility Course Section D Start | no-exclusive-coordinate-anchor | none |
| 16706-2 | Anachronia Agility Course Section D Start | no-exclusive-coordinate-anchor | none |
| 16706-3 | Anachronia Agility Course Section D Start | no-exclusive-coordinate-anchor | none |
| 16707-1 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-2 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-5 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-6 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-7 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-8 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16707-9 | Corbicula Rex Hunting Ground | no-exclusive-coordinate-anchor | none |
| 16708-1 | Anachronia East River | no-exclusive-coordinate-anchor | none |
| 16708-2 | Anachronia East River | no-exclusive-coordinate-anchor | none |
| 16708-3 | Anachronia East River | no-exclusive-coordinate-anchor | none |
| 16708-4 | Anachronia East River | no-exclusive-coordinate-anchor | none |
| 16709-2 | Anachronia Canyon Mine | no-exclusive-coordinate-anchor | none |
| 16710-0 | Anachronia North-East Coast | no-exclusive-coordinate-anchor | none |
| 16920-1 | Salty Crabletines | no-exclusive-coordinate-anchor | none |
| 16920-2 | Salty Crabletines | no-exclusive-coordinate-anchor | none |
| 16924-1 | Northern Island That Once Was a Big Turtle | no-exclusive-coordinate-anchor | none |
| 16924-2 | Northern Island That Once Was a Big Turtle | no-exclusive-coordinate-anchor | none |
| 16924-3 | Northern Island That Once Was a Big Turtle | no-exclusive-coordinate-anchor | none |
| 16949-3 | Raz's Hut | no-exclusive-coordinate-anchor | none |
| 16950-3 | Highweald Forest Waterfall | no-exclusive-coordinate-anchor | none |
| 16950-4 | Highweald Forest Waterfall | no-exclusive-coordinate-anchor | none |
| 16950-5 | Highweald Forest Waterfall | no-exclusive-coordinate-anchor | none |
| 16960-1 | Asuran Arsenal Entrance | missing-plane-0-coverage | none |
| 16960-2 | Asuran Arsenal Entrance | missing-plane-0-coverage | none |
| 16960-3 | Asuran Arsenal Entrance | missing-plane-0-coverage | none |
| 16961-1 | South Anachronia Isle | missing-plane-0-coverage | none |
| 16961-2 | South Anachronia Isle | missing-plane-0-coverage | none |
| 16962-1 | Shadow Jadinko Hunting Spot | missing-plane-0-coverage | none |
| 16962-2 | Shadow Jadinko Hunting Spot | missing-plane-0-coverage | none |
| 16963-1 | Kindra Counsil Meeting Pool | missing-plane-0-coverage | none |
| 16963-2 | Kindra Counsil Meeting Pool | missing-plane-0-coverage | none |
| 16964-1 |  | missing-plane-0-coverage | none |
| 16964-2 |  | missing-plane-0-coverage | none |
| 16965-0 | Anachronia North-East Isles | missing-plane-0-coverage | none |
| 16966-0 | Anachronia North-East Corner | missing-plane-0-coverage | none |
| 17175-2 | Cyclosis Southern Dock | no-exclusive-coordinate-anchor | none |
| 17175-3 | Cyclosis Southern Dock | no-exclusive-coordinate-anchor | none |
| 17176-2 | Ichi's Tower | no-exclusive-coordinate-anchor | none |
| 17176-3 | Ichi's Tower | no-exclusive-coordinate-anchor | none |
| 17200-3 | Felix's Gravestone | no-exclusive-coordinate-anchor | none |
| 17205-3 | Hill Giant Camp | no-exclusive-coordinate-anchor | none |
| 17206-2 | Saradominist Watchtower Ruins | no-exclusive-coordinate-anchor | none |
| 17206-3 | Saradominist Watchtower Ruins | no-exclusive-coordinate-anchor | none |
| 17459-2 | Wolf's Crossing | no-exclusive-coordinate-anchor | none |
| 17460-3 | Bridge to Amberfell | no-exclusive-coordinate-anchor | none |
| 17461-2 | Waterfall Pathway | no-exclusive-coordinate-anchor | none |
| 17461-3 | Waterfall Pathway | no-exclusive-coordinate-anchor | none |
