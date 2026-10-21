# Transport evidence: F2P and lodestones

Reviewed 2026-10-08. This isolated segment contains **60 exact station/obstacle anchors, 49 admitted route records, and 6 pending route records**. Of the admitted routes, 33 are F2P and 16 are members-only (15 lodestones and the Lumbridge–Al Kharid grapple). “Admitted” means coordinate evidence is present; it does not imply the player's requirements or manual confirmations have been satisfied. No in-game journey was tested.

The researched systems are River Lum canoes, ordinary F2P ships, Wilderness levers, all 29 permanent lodestone destinations, the three basic F2P teleport spells, ring of kinship, skull sceptre destinations, cabbage-port, and the F2P shortcut obstacle exceptions. It is not an exhaustive catalogue of every F2P quest/event teleport or dungeon transition.

## Source and coordinate method

Tavily search was used first for discovery. Its results sometimes included oldschool.runescape.wiki despite the requested domain; those results were rejected. Claims and permanent revision URLs were taken from the RS3 Wiki public API using action=query, prop=revisions, rvprop=ids|content, rvslots=main, with titles on runescape.wiki. PowerShell Invoke-RestMethod succeeded; Python urllib requests returned 403. Browser automation was not needed.

The read-only copied cache exports are under C:/Users/User/Projects/chunk-picker-rs3/.local/game-data and .local/map-assets. No cache, main repository, app/web, duo service or other worktree file was written. The only authored files are this note and app/data/transport-routes.f2p.2026-10-08.v1.json. Map-pin identities were read from the immutable app/data/map-pin-details.inputs.2026-10-08.v1.json; no nearest-pin assignment was used.

Coordinate evidence is an exact Wiki scenery/NPC/teleport map or a typed cache destination/placement. Boarding NPC and shortcut object coordinates are **anchors**, not claims about the player's landing tile. Region centres and convenient nearby unrelated markers are excluded. chunkId is derived from the coordinate's 64-tile region; no legacy selector/locationId or walkability component has been guessed. Source planes are retained where the cache projects them to a displayed/effective plane.

## River Lum canoes

The [current RS3 canoe page](https://runescape.wiki/w/Canoe?oldid=37174554) and [canoe station maps](https://runescape.wiki/w/Canoe_station?oldid=37176646) establish four departure stations. Borrowing an instructor's hatchet is supported, so owning a carried hatchet is not a mandatory item gate. The six unordered ordinary station pairs cover all twelve travel directions.

| Ordinary station pair | Stops | Minimum canoe | Woodcutting |
| --- | ---: | --- | ---: |
| Lumbridge ↔ Champions' Guild | 1 | Log | 12 |
| Lumbridge ↔ Barbarian Village | 2 | Dugout | 27 |
| Lumbridge ↔ Edgeville | 3 | Stable dugout | 42 |
| Champions' Guild ↔ Barbarian Village | 1 | Log | 12 |
| Champions' Guild ↔ Edgeville | 2 | Dugout | 27 |
| Barbarian Village ↔ Edgeville | 1 | Log | 12 |

Each route includes every stronger qualifying variant. Waka requires 57 Woodcutting. The Wilderness pond is Waka-only and arrival-only, without a canoe tree for the return trip; [Wet and Wildy](https://runescape.wiki/w/Wet_and_Wildy?oldid=36635891) independently confirms F2P access and the level. Four corresponding routes are retained in river-lum-canoes.pendingRoutes. Their destination has **no verified exact coordinate**, so none is drawable or usable as an admitted graph edge. Current copied object placements corroborated all four departure objects (12163–12166), but supplied no pond station. Neither a pond centre nor the nearby moss-giant map marker was substituted.

The current canoe prose prohibits a familiar, while its 2009 update history records removal of follower restrictions. The catalogue records this conflict and requires a canoe familiar-state confirmation; it does not silently settle it.

## Current ships and Wilderness travel

[Captain Tobias](https://runescape.wiki/w/Captain_Tobias?oldid=37183451) and the [Musa Point customs officer](https://runescape.wiki/w/Customs_officer?oldid=37198107) provide the Port Sarim–Musa Point route, baseline fare 30 coins each way. Discount variants are retained without replacing the baseline; return customs can confiscate Karamjan rum.

[Captain Lorris](https://runescape.wiki/w/Captain_Lorris?oldid=37179590) now serves Havenhythe. His [current transcript](https://runescape.wiki/w/Transcript%3ACaptain_Lorris?oldid=37199372) confirms a 30-coin fare in both directions after Visions of Havenhythe. The admitted route uses completed quest gating. During-quest free travel is a separate progression-dependent possibility, outside this route.

[Taverley Bryll](https://runescape.wiki/w/Bryll_Thoksdottir?oldid=37182272) and the [Daemonheim shipmaster](https://runescape.wiki/w/Fremennik_shipmaster?oldid=37138015) are F2P. Their [Taverley](https://runescape.wiki/w/Transcript%3ABryll_Thoksdottir?oldid=37039154) and [return](https://runescape.wiki/w/Transcript%3AFremennik_shipmaster?oldid=36874984) dialogue support travel without fare or level checks.

The [Wilderness lever](https://runescape.wiki/w/Lever?oldid=37110243) is a portal route with mechanism=lever. It returns from Deserted Keep to Edgeville on **F2P worlds**; members worlds instead return to Ardougne. PvP opt-in warning and the keep's web are recorded.

### Obsolete or restricted alternatives

- [Seaman Thresnor](https://runescape.wiki/w/Seaman_Thresnor?oldid=37126453) was removed on 23 March 2026. Seaman Lorris became Captain Lorris and no longer serves Karamja. Only Tobias is used for the current Musa Point departure.
- The [Al Kharid jetty](https://runescape.wiki/w/Al_Kharid_jetty?oldid=37133179) lost its departure shipmaster/boat on 17 November 2025 and now functions as the ordinary bridge between Lumbridge Swamp and Al Kharid. The broad Al Kharid travel page still describes the boat, so the specific updated jetty/removal evidence takes precedence. The Daemonheim transcript still offers an Al Kharid return, but its current arrival endpoint has not been verified and no reverse departure is inferred.
- The [Lumbridge–Al Kharid strong-tree grapple](https://runescape.wiki/w/Strong_tree_(Lumbridge%2FAl_Kharid)?oldid=36919990) is members-only, despite being visible in F2P. It is catalogued with members=true/f2p=false and 8 Agility, 37 Ranged, 19 Strength plus equipment alternatives. Ordinary bridges remain walking links, without an invented fare/gate transport.
- [Wilderness obelisks](https://runescape.wiki/w/Obelisk_(Wilderness)?oldid=37172769) are members-only. [Fort Forinthry lodestone](https://runescape.wiki/w/Fort_Forinthry_lodestone?oldid=37177936) is also members-only despite F2P geography.
- [Havenhythe canoe stations](https://runescape.wiki/w/Canoe_station_(Havenhythe)?oldid=37195282) and its [Wendlewick river log](https://runescape.wiki/w/Log_balance_(Wendlewick_river)?oldid=37195145)/[southern stepping stones](https://runescape.wiki/w/Stepping_stones_(South_Wendlewick)?oldid=37073588) are members-only; none is an F2P shortcut route.

## Lodestones

All 29 permanent destinations have a specific-page membership review. There are 13 F2P and 16 members destinations including pending coordinates. 27 are admitted using exact typed cache destinations from travel.v1.json. The general [Lodestone Network](https://runescape.wiki/w/Lodestone_Network?oldid=37199016) list omits Wendlewick; the [specific current page](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) and cache confirm it is F2P and built during Visions of Havenhythe. The City of Um source retains conflicting candidate membership structs; the [specific F2P page](https://runescape.wiki/w/City_of_Um_lodestone?oldid=36921071) supports the F2P struct and Necromancy! gate.

Home Teleport has no rune/skill requirement. Each global route has from=null, its destination station as to, and an activation/build confirmation. [Current Home Teleport](https://runescape.wiki/w/Home_Teleport?oldid=37178861) says casting can occur in combat but an attack can interrupt it; no absolute “out of combat” gate was added. Origin teleport restrictions use the stable teleport-origin-permitted condition; prose mechanics are notes. Build/quest gates are included for known special destinations.

Ashdale's typed coordinate (2474,2709, raw plane 2) and Prifddinas's (2208,3361, raw plane 1) have no matching map projection in the copied cache. Both remain unresolvedDestinations with pendingRoutes. Their raw coordinates are retained, without assigning guessed map IDs/display planes. The [Ashdale page](https://runescape.wiki/w/Ashdale_lodestone?oldid=36689040) verifies F2P, and the [Prifddinas page](https://runescape.wiki/w/Prifddinas_lodestone?oldid=37129085) verifies members and Plague's End.

## F2P personal teleport destinations

The normal-spell routes use exact typed destinations from travelStructs 14753/14756/14759 and verified [Varrock](https://runescape.wiki/w/Varrock_Teleport?oldid=37182128), [Lumbridge](https://runescape.wiki/w/Lumbridge_Teleport?oldid=36979025) and [Falador](https://runescape.wiki/w/Falador_Teleport?oldid=37090986) spell requirements. Runes are consumable=true; valid elemental rune substitutions are retained as item alternatives and a rune/equipment confirmation. Varrock and Falador Wiki marker coordinates differ by one tile from the typed cache point; the catalogue preserves the typed point and flags the discrepancy.

[Ring of kinship](https://runescape.wiki/w/Ring_of_kinship?oldid=37155981) supplies a free unlimited F2P Daemonheim destination when the ring is carried/equipped. [Skull sceptre](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) supplies outside and four exact underground map destinations; each floor has its required reward-unlock confirmation. [Explorer's ring 3](https://runescape.wiki/w/Explorer's_ring_3?oldid=37013938) and [4](https://runescape.wiki/w/Explorer's_ring_4?oldid=37084766) supply the same cabbage-port endpoint; ownership is an alternative confirmation, not a demand to carry both rings.

## Shortcut obstacles and North Volcano

The exact F2P obstacle set retained here is the [Falador crumbling wall](https://runescape.wiki/w/Crumbling_wall_(Falador)?oldid=36205746) (5 Agility), [Fred's farm stile](https://runescape.wiki/w/Stile_(Fred's_farm)?oldid=36476077) and [two Falador farm stiles](https://runescape.wiki/w/Stile_(Falador_farm)?oldid=36476079) (1 Agility), plus [North Volcano stepping stone](https://runescape.wiki/w/Stepping_stone_(Wilderness_North_Volcano)?oldid=36416075) and [ledges](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano)?oldid=35935716). These exceptions are more current/specific than the broad [Shortcuts](https://runescape.wiki/w/Shortcuts?oldid=37200447) prose that says almost all obstacles are members-only.

The [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano?oldid=37133086) ascent is represented between exact stepping-stone/top-ledge **object anchors**, with intermediate obstacle IDs. A manual chain/effective-plane confirmation is required. Cache raw planes for north/east-up/east-down/top are 1/1/3/2, effective planes 0/0/2/2. Wiki map labels are 0/0/2/2, and its east-down map repeats objectId124616 while the infobox identifies124617. The explicit cache IDs/source/effective planes are preserved. No numerical Agility level is published on these specific pages; this is recorded as untested, not asserted as proof of level 1/no gate. Exact traversal order and landing tiles remain unresolved.

The Falador wall/stiles have exact scenery anchors but no verified opposite-side selector/landing coordinates, so they are network obstacles without invented graph edges. Fred's Wiki objectId45205 was not located at the Wiki coordinate in the copied current cache; its current scenery identity is an explicit review gap.

## Admitted station coordinates

Map coordinates below are exact anchors/destinations of the stated evidence kind; they are not all player landing tiles.

| Station ID | x,y | Plane | Map | Evidence |
| --- | --- | ---: | ---: | --- |
| canoe-lumbridge | 3233,3250 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Canoe_station?oldid=37176646) |
| canoe-champions-guild | 3200,3341 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Canoe_station?oldid=37176646) |
| canoe-barbarian-village | 3110,3409 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Canoe_station?oldid=37176646) |
| canoe-edgeville | 3130,3508 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Canoe_station?oldid=37176646) |
| ship-port-sarim-karamja | 3028,3216 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Captain_Tobias?oldid=37183451) |
| ship-musa-point | 2953,3147 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Customs_officer?oldid=37198107) |
| ship-port-sarim-havenhythe | 3028,3221 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Captain_Lorris?oldid=37179590) |
| ship-havenhythe-port | 4091,3322 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Captain_Lorris?oldid=37179590) |
| ship-taverley-daemonheim | 2858,3406 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Bryll_Thoksdottir?oldid=37182272) |
| ship-daemonheim-coast | 3513,3694 | 0 | 28 | [wiki-npc-map](https://runescape.wiki/w/Fremennik_shipmaster?oldid=37138015) |
| lever-edgeville | 3090,3474 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Lever?oldid=37110243) |
| lever-deserted-keep | 3153,3923 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Lever?oldid=37110243) |
| lodestone-al-kharid | 3297,3185 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Al_Kharid_lodestone?oldid=36976053) |
| lodestone-anachronia | 3895,4259 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Anachronia_lodestone?oldid=37122513) |
| lodestone-ardougne | 2634,3349 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Ardougne_lodestone?oldid=37122759) |
| lodestone-bandit-camp | 3214,2955 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Bandit_Camp_lodestone?oldid=37121091) |
| lodestone-burthorpe | 2899,3545 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Burthorpe_lodestone?oldid=36689035) |
| lodestone-canifis | 3517,3516 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Canifis_lodestone?oldid=37124529) |
| lodestone-catherby | 2811,3450 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Catherby_lodestone?oldid=36689042) |
| lodestone-city-of-um | 1083,1768 | 0 | 742 | [cache-typed-coordinate](https://runescape.wiki/w/City_of_Um_lodestone?oldid=36921071) |
| lodestone-draynor | 3105,3299 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Draynor_lodestone?oldid=36689044) |
| lodestone-edgeville | 3067,3506 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Edgeville_lodestone?oldid=37110451) |
| lodestone-falador | 2967,3404 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Falador_lodestone?oldid=37127183) |
| lodestone-fort-forinthry | 3298,3526 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Fort_Forinthry_lodestone?oldid=37177936) |
| lodestone-karamja | 2761,3148 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Karamja_lodestone?oldid=37131535) |
| lodestone-lumbridge | 3233,3222 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Lumbridge_lodestone?oldid=37110013) |
| lodestone-lunar-isle | 2088,3912 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Lunar_Isle_lodestone?oldid=36689036) |
| lodestone-menaphos | 3216,2717 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Menaphos_lodestone?oldid=36689053) |
| lodestone-ooglog | 2532,2872 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Oo'glog_lodestone?oldid=36689054) |
| lodestone-port-sarim | 3011,3216 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Port_Sarim_lodestone?oldid=37127290) |
| lodestone-seers-village | 2689,3483 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Seers'_Village_lodestone?oldid=37122714) |
| lodestone-taverley | 2878,3443 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Taverley_lodestone?oldid=36689058) |
| lodestone-tirannwn | 2254,3150 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Tirannwn_lodestone?oldid=36689059) |
| lodestone-varrock | 3214,3377 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Varrock_lodestone?oldid=37108403) |
| lodestone-wendlewick | 4165,3312 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) |
| lodestone-wilderness-crater | 3143,3636 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Wilderness_Crater_lodestone?oldid=36733918) |
| lodestone-yanille | 2529,3095 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Yanille_lodestone?oldid=37122635) |
| lodestone-fremennik-province | 2712,3678 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Fremennik_Province_lodestone?oldid=37122993) |
| lodestone-eagles-peak | 2366,3480 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Eagles'_Peak_lodestone?oldid=37122551) |
| teleport-varrock | 3212,3434 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Varrock_Teleport?oldid=37182128) |
| teleport-lumbridge | 3219,3248 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Lumbridge_Teleport?oldid=36979025) |
| teleport-falador | 2965,3378 | 0 | 28 | [cache-typed-coordinate](https://runescape.wiki/w/Falador_Teleport?oldid=37090986) |
| teleport-daemonheim-kinship | 3442,3694 | 0 | 28 | [wiki-teleport-map](https://runescape.wiki/w/Ring_of_kinship?oldid=37155981) |
| teleport-skull-outside | 3081,3421 | 0 | 28 | [wiki-teleport-map](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) |
| teleport-skull-war | 1862,5242 | 0 | 169 | [wiki-teleport-map](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) |
| teleport-skull-famine | 2044,5245 | 0 | 170 | [wiki-teleport-map](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) |
| teleport-skull-pestilence | 2125,5253 | 0 | 171 | [wiki-teleport-map](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) |
| teleport-skull-death | 2360,5213 | 0 | 172 | [wiki-teleport-map](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) |
| teleport-cabbage-port | 3053,3291 | 0 | 28 | [wiki-teleport-map](https://runescape.wiki/w/Explorer's_ring_3?oldid=37013938) |
| falador-crumbling-wall | 2935,3355 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Crumbling_wall_(Falador)?oldid=36205746) |
| falador-farm-stile-3043-3305 | 3043,3305 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Stile_(Falador_farm)?oldid=36476079) |
| falador-farm-stile-3063-3282 | 3063,3282 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Stile_(Falador_farm)?oldid=36476079) |
| north-volcano-north-ledge | 3370,3958 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano)?oldid=35935716) |
| north-volcano-east-up | 3386,3929 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano)?oldid=35935716) |
| north-volcano-east-down | 3386,3929 | 2 | 28 | [cache-object-placement](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano)?oldid=35935716) |
| north-volcano-top-ledge | 3364,3946 | 2 | 28 | [cache-object-placement](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano)?oldid=35935716) |
| north-volcano-stepping-stone | 3365,3971 | 0 | 28 | [cache-object-placement](https://runescape.wiki/w/Stepping_stone_(Wilderness_North_Volcano)?oldid=36416075) |
| fred-farm-stile | 3199,3286 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Stile_(Fred's_farm)?oldid=36476077) |
| lumbridge-strong-tree | 3246,3180 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Strong_tree_(Lumbridge%2FAl_Kharid)?oldid=36919990) |
| al-kharid-strong-tree | 3256,3180 | 0 | 28 | [wiki-object-map](https://runescape.wiki/w/Strong_tree_(Lumbridge%2FAl_Kharid)?oldid=36919990) |

## Verification and remaining boundary

The JSON was parsed and checked for unique station/route IDs, station references, exact evidence on every admitted station, required requirement fields, reciprocal F2P canoe coverage, six pending routes, and expected lodestone membership totals. Pin IDs were used only where the marker's object identity and exact coordinate match the obstacle.

Unresolved work is narrow and explicit: exact Wilderness canoe arrival; Ashdale/Prifddinas map projection; single-object shortcut opposite-side selectors; North Volcano chain/plane/landing verification; Fred's current scenery identity; familiar/follower conflict; and the current Daemonheim-to-Al Kharid arrival. Quest/event teleports and other dungeon/interior links were not comprehensively inventoried by this segment.
