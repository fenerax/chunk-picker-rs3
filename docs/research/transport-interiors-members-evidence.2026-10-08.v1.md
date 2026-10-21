# Interior and members transport evidence

Reviewed 2026-10-08. This segment contains 61 exact station anchors and 61 reviewed transport edges. 18 edges are F2P. 43 are members.

## Source method

Tavily web searches discovered RuneScape Wiki pages. Direct RuneScape Wiki API queries returned page revision IDs and main-slot wikitext; every gameplay citation below and in JSON uses a permanent oldid URL. Search results for Old School RuneScape were discarded. No OSRS mechanics are used. Cache files were read only from the existing main repository exports. Scenery positions are interaction anchors; they are not claimed observed teleport landing tiles. No area or chunk centre was converted into a station.

| Kind | Routes |
| --- | ---: |
| balloon | 30 |
| boat | 1 |
| cart | 1 |
| cave | 6 |
| glider | 8 |
| ladder | 8 |
| portal | 1 |
| shortcut | 2 |
| stairs | 4 |

## Interior pairing and coordinates

| Pair | Surface object coordinate | Interior object coordinate / map | Retained location |
| --- | --- | --- | --- |
| Draynor west trapdoor | 6434 at 3084,3272 | 32015 at 3084,9672 / 542 | 12439 |
| Draynor jail trapdoor | 6434 at 3118,3244 | 26518 at 3118,9643 / 542 | 12438 |
| Varrock manhole | 881 at 3237,3458 | 128335 at 3237,9866 / 592 | 12954 |
| Edgeville ruins trapdoor | 26933 at 3097,3468 | 29355 at 3097,9868 / 592 | 12442 |
| Hill giant hut ladder | 12389 at 3116,3452 | 78993 at 3116,9852 / 592 | 12441 |
| Falador mine stairs | 30944 at 3059,3376 | 30943 at 3059,9776 / 590 | 12184 |
| Ice Mountain mine ladder | 30942 at 3019,3450 | 6226 at 3019,9850 / 590 | 12185 |
| Burthorpe mine entrance | 66876 at 2874,3502 | 67002 at 117,100 / 719 | 9030 |

The Wiki entrance descriptions and dungeon exit maps corroborate each independently decoded cache endpoint. Draynor east surface Wiki area pin is at 3118,3245; the exact trapdoor cache object is 3118,3244, so this segment uses the object. Falador Wiki location-area square is 3060,3378; this segment instead uses stairs30944 at 3059,3376. Ice Mountain ladder30942 at 3019,3450 pairs with ladder6226 at 3019,9850. The hut ladder route requires a brass key. No Wilderness gate access is inferred from the F2P Edgeville entrances.

Burthorpe uses map-local 117,100 on map719, while coordinateEvidence.sourceCoordinate preserves 2293,4516 and retained chunk/location9030. The cache map719 source bounds and translation are recorded. This avoids projecting the underground mine onto the surface. All other included dungeon placements use identity source-to-map transforms. Retained location IDs are justified by matching the source-coordinate region ID and retained /chunks/{id}/Name; they describe that source chunk, not an assertion that every dungeon room is mutually reachable.

## Networks and requirements

Gnome gliders retain the nine explicit Wiki arrival/station coordinates. Seven bidirectional Grand Tree hub spokes and one directed Grand Tree-to-Digsite crash route are included; direct all-to-all service is not inferred from the overview. This preserves network connectivity without multiplying uncertain direct routes. The Grand Tree is on plane3. The Grand Tree quest is mandatory. Feldip Hills additionally needs the Sanfew stage of One Small Favour; Tree Gnome Village requires The Prisoner of Glouphrie; Prifddinas access and rescued Azalea at Tuai Leit stay explicit personal confirmations.

Balloons use six explicit station coordinates. Thirty directed subsequent-flight edges preserve destination-specific charge fares (1,1,2,3,4,5) and Firemaking levels (20,20,30,40,50,60). Enlightened Journey and both station unlocks are personal requirements. Initial unlock navigation and its larger charge cost are excluded. Entrana-bound flights require permitted inventory/equipment.

The Shilo cart requires Shilo Village and ten coins; the endpoint anchors are Hajedy and Vigroy NPC maps, with NPC IDs. Monk NPC membership No does not make the Entrana boat F2P: Entrana location revision explicitly says members Yes, which governs the route. Charter routes are owned by the separate ships research segment and have been removed here to avoid duplicate coverage.

The Dwarven Mine crevice pairs both exact object5906 placements, level42 Agility. Taverley stepping stones pair the two endpoint object96784 placements, level52 Agility; cache original plane1 is bridge-adjusted to effective surface plane0 and the original source plane is preserved. Iron Enclave portal uses exact Wiki object131451/131450 map28 coordinates and requires the correct Ironman/Group Ironman account mode.

## Bounded exclusions and limitations

- Lumbridge Catacombs are now included with explicit upperplane1 and questlowerplane0 distinctions, both west staircases, and the completed-quest descent to main combat catacombs. Unvisited quest stage and upper-plane access remain personal confirmations.
- Draynor Manor basement, H.A.M., Taverley Dungeon and resource dungeons remain excluded until exact counterpart/access pairing is reviewed.
- Edgeville/Varrock crevice127852 has exact3151,9905,map592 and level51 evidence, but only one physical object anchor was verified; a second transport endpoint is not fabricated. Removed pipe/monkey-bars pages are not used as current routes.
- Keldagrim minecart system exists and is free after visiting Keldagrim, but Wiki Train cart maps contain inconsistent Dwarven Tunnel/Dwarven Mines labels and map-local Keldagrim coordinates; these are excluded pending cache-source resolution. The Shilo cart is the reviewed representative.
- Charter fares with asymmetric matrix entries and Mos Le Harmless discount footnotes are excluded. Port Phasmatys access alternatives, Shipyard quest-stage details and other ferry systems remain unresolved in this segment.
- Cache component IDs cannot safely be inferred from component bounding rectangles. None are guessed here. Parent integration must locate the exact interaction/access tile and fail closed when disconnected.
- Teleport spell/item origins and player-specific availability are not invented. No one-way edge establishes a round trip alone. No transport unlock grants chunk ownership.

## Revision bibliography

- [Balloon transport system](https://runescape.wiki/w/Balloon_transport_system?oldid=36927642)
- [Burthorpe mine](https://runescape.wiki/w/Burthorpe_mine?oldid=37180751)
- [Charter ship](https://runescape.wiki/w/Charter_ship?oldid=36664213)
- [Crevice (Dwarven Mine)](https://runescape.wiki/w/Crevice_(Dwarven_Mine)?oldid=35928255)
- [Draynor Sewers](https://runescape.wiki/w/Draynor_Sewers?oldid=37110185)
- [Dwarven mines](https://runescape.wiki/w/Dwarven_mines?oldid=37180943)
- [Edgeville Dungeon](https://runescape.wiki/w/Edgeville_Dungeon?oldid=37124838)
- [Entrana](https://runescape.wiki/w/Entrana?oldid=37161918)
- [Gnome glider](https://runescape.wiki/w/Gnome_glider?oldid=36987519)
- [Hajedy](https://runescape.wiki/w/Hajedy?oldid=37139602)
- [Iron Enclave](https://runescape.wiki/w/Iron_Enclave?oldid=37163617)
- [Iron Enclave portal](https://runescape.wiki/w/Iron_Enclave_portal?oldid=36872074)
- [Manhole](https://runescape.wiki/w/Manhole?oldid=37142168)
- [Map:Burthorpe mine](https://runescape.wiki/w/Map:Burthorpe_mine?oldid=35975718)
- [Map:Draynor Sewers](https://runescape.wiki/w/Map:Draynor_Sewers?oldid=35975808)
- [Map:Dwarven Mine](https://runescape.wiki/w/Map:Dwarven_Mine?oldid=35975810)
- [Map:Edgeville Dungeon](https://runescape.wiki/w/Map:Edgeville_Dungeon?oldid=37024662)
- [Map:Varrock Sewers](https://runescape.wiki/w/Map:Varrock_Sewers?oldid=37162590)
- [Monk of Entrana](https://runescape.wiki/w/Monk_of_Entrana?oldid=37127314)
- [Shilo Village cart system](https://runescape.wiki/w/Shilo_Village_cart_system?oldid=36804794)
- [Stepping stone (Taverley)](https://runescape.wiki/w/Stepping_stone_(Taverley)?oldid=36886073)
- [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146)
- [Varrock Sewers](https://runescape.wiki/w/Varrock_Sewers?oldid=37149521)
- [Vigroy](https://runescape.wiki/w/Vigroy?oldid=37139620)

## Read-only cache provenance

- `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/objects-2026-10-08-v3/objects.transitions.v1.json.gz` SHA-256 `e7bbf79507c32ec2bb1859438dce724bb1cc84f26b218c2b8adf997c02fba867`.
- `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json` SHA-256 `dc88b9e37f0d638f9b63976bb358b76e7967e64e390d8310a12299abe8ce5312`.
- `C:/Users/User/Projects/chunk-picker-rs3-wt/transport/rs3-chunkpicker-chunkinfo-export.json` SHA-256 `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`.

Validation: unique station and route IDs, all endpoint references resolve, all gameplay provenance URLs end with numeric oldid, every selected cache placement is unique, all interior source coordinates match the claimed cache map source bounds, and retained interior location IDs correspond to existing retained chunk names. These are authored-data checks; gameplay has not been observed.

## Additional priority interior review

Six further routes use exact cache anchors: Lumbridge Swamp surface91021 at3163,3166 to rope78630 at3169,9572,map608 (members; installed rope and usable light), Burthorpe Slayer cave67043 at2915,3465 to exit67044 local236,51,map719/source2220,4531 (F2P; living-water spring is inside), Karamja rocks492 at2856,3168 to rope1764 at2856,9569,map554, Crandor hole25154 at2833,3255 to rope25213 at2833,9657,map554 (conservative completed Dragon Slayer), Asgarnian trapdoor9472 at3008,3150 to ladder32015 at3008,9550,map25, and Lumbridge kitchen36687 at3209,3216 to current cellar ladder29355 at3209,9616,map31.

Cellar map variants291/316/317 are explicitly named tutorial maps in cache internal_name and are excluded. The current cellar source chunk12950 is retained as Dorgesh-Kaan mine, but semantic locationId13207 is the retained Lumbridge Cellar and is justified by the two Wiki destination descriptions. Entry never grants Lost Tribe tunnel access. Karamja and Crandor enter distinct retained interior chunks11413/11414; hidden-wall connectivity is not implied.

- [Dark hole under tree](https://runescape.wiki/w/Dark_hole_under_tree?oldid=36906820)
- [Lumbridge Swamp Caves](https://runescape.wiki/w/Lumbridge_Swamp_Caves?oldid=37169606)
- [Map:Lumbridge Swamp Caves](https://runescape.wiki/w/Map:Lumbridge_Swamp_Caves?oldid=37026506)
- [Cave entrance (Burthorpe Slayer Cave)](https://runescape.wiki/w/Cave_entrance_(Burthorpe_Slayer_Cave)?oldid=36472830)
- [Burthorpe Slayer Cave](https://runescape.wiki/w/Burthorpe_Slayer_Cave?oldid=37131280)
- [Map:Burthorpe Slayer Cave](https://runescape.wiki/w/Map:Burthorpe_Slayer_Cave?oldid=35975722)
- [Elvarg's lair](https://runescape.wiki/w/Elvarg's_lair?oldid=37122213)
- [Map:Elvarg's lair](https://runescape.wiki/w/Map:Elvarg's_lair?oldid=36172871)
- [Asgarnian Ice Dungeon](https://runescape.wiki/w/Asgarnian_Ice_Dungeon?oldid=37127295)
- [Trapdoor (Lumbridge Castle)](https://runescape.wiki/w/Trapdoor_(Lumbridge_Castle)?oldid=36789230)
- [Lumbridge Castle](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520)

## Lumbridge Catacombs layer resolution

Four reviewed edges now cover cemetery entry, two parallel west staircases, and the lower main-combat-catacombs descent. The exact surface object48797 is at3247,3198. The return object48798 is at3877,5525,plane1, recovered directly from source placement object-da3fa93f5e8e603f85caaf3e. Wiki Map:The Blood Pact upper layer explicitly declares plane1 and shows the cemetery exit at3877.5,5524.5; that map corroborates rather than substitutes the exact decoded object anchor. The original transition projection omitted plane1 objects because map164 source bounds only encode plane0, so this segment keeps map164/plane1 and records that limitation. It does not force this interior onto surfaceplane0.

Each west staircase pairs object48678 (Climb down) on plane1 and object48677 (Climb up) on plane0 at3858,5533 and3858,5543. The source placement IDs and exact coordinates are recorded. First quest passage depends on the personal blood-pact-west-staircases-open confirmation, without falsely requiring completed The Blood Pact for the quest rooms. Descending via48688 at3865,5524,map164 to48683 at3972,5566,map165 requires completed The Blood Pact. The distinct retained lower main-catacomb area is15958.

- [Lumbridge Catacombs](https://runescape.wiki/w/Lumbridge_Catacombs?oldid=37109974)
- [Blood Pact quest maps](https://runescape.wiki/w/Map:The_Blood_Pact?oldid=35977504)
- [The Blood Pact](https://runescape.wiki/w/The_Blood_Pact?oldid=37153014)
- Source placements SHA-256 `5c008448e8dfb6b4916a958c206ef5c136ddfb47ba1aa4068e18241378b2d069`.
