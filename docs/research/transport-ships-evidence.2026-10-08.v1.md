# Members ship transport evidence — 2026-10-08

Reviewed 117 route records and 35 station anchors. This file covers the 11-port charter network (104 directed fare-bearing routes) and 13 additional route records (11 bidirectional services plus separately priced Jarvald directions). All are members services. Exact arrival tiles remain unverified.

Integration requires personal `charter-inventory-clear` confirmation on all 104 charter records. The reviewed bedsheet equipment restriction remains a real gate; the existing state has no equipment inventory capable of proving it automatically. Optional sailing dialogue/cutscene preferences remain advisory notes.

## Source retrieval and scope

Public RS3 Wiki WEB SEARCH was performed first (Charter ship, Boat network, named operators and Anachronia). Search frequently returned OSRS pages or robots errors. Public `runescape.wiki/api.php` revision retrieval then supplied authoritative RS3 wikitext and exact oldids. OSRS sources were excluded. No game cache, running app, main tracked files, services, duo state or other local outputs were accessed or modified. Read-only copied `map-pin-details.inputs` supplied stable marker IDs. Read-only `.local/game-data/places-2026-10-08-v3` outputs were inspected for coordinate schema; no route logic was inferred from uninterpreted cache fields.

## Charter fare orientation and coverage

The table’s rows are destination ports, its columns departure ports. The worked example Khazard → Shipyard → Oo'glog costs 1,620 = 720 + 900, proving this orientation. Applying row-as-departure would invert several fares. All 104 non-NA off-diagonal cells are retained as separate directed edges. The six unavailable pairs are Musa Point ↔ Port Sarim, Port Phasmatys ↔ Mos Le Harmless, and Port Phasmatys ↔ Shipyard. Other ordinary boats cover some of these journeys; no charter edge is invented.

Listed Mos Le Harmless fares already contain the compulsory Cabin Fever half-price discount. Additional ring of charos (a) halves that listed amount once. Other listed fares are undiscounted: Cabin Fever and ring each halve them, combined to one quarter. Fractional-coin rounding is not established. Directional asymmetry is preserved, not normalised.

Fares below reproduce numeric facts from the reviewed revision. Rows are **departure** here; columns destination. Dash means no charter service.

| From / to | Brimhaven | Catherby | Musa Point (Karamja) | Menaphos | Mos Le Harmless | Port Khazard | Port Phasmatys | Port Sarim | Shipyard | Port Tyras | Oo'glog |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Brimhaven | — | 480 | 200 | 3000 | 725 | 1600 | 2900 | 1600 | 400 | 3200 | 3800 |
| Catherby | 480 | — | 480 | 3000 | 625 | 1600 | 3500 | 1000 | 1600 | 3200 | 3400 |
| Musa Point (Karamja) | 200 | 480 | — | 3000 | 1025 | 1600 | 2900 | — | 200 | 3200 | 2000 |
| Menaphos | 3000 | 3000 | 3000 | — | 1500 | 3000 | 3000 | 3000 | 3000 | 3200 | 3000 |
| Mos Le Harmless | 975 | 1750 | 225 | 1500 | — | 1025 | — | 325 | 225 | 1600 | 550 |
| Port Khazard | 400 | 1600 | 400 | 3000 | 1025 | — | 4100 | 1280 | 720 | 3200 | 5000 |
| Port Phasmatys | 2900 | 3500 | 2900 | 3000 | — | 4100 | — | 1300 | — | 3200 | 2800 |
| Port Sarim | 1600 | 1000 | — | 3000 | 325 | 1280 | 1300 | — | 400 | 3200 | 1400 |
| Shipyard | 400 | 1600 | 200 | 3000 | 275 | 1600 | — | 400 | — | 3200 | 900 |
| Port Tyras | 3200 | 3200 | 3200 | 3200 | 1600 | 3200 | 3200 | 3200 | 3200 | — | 3200 |
| Oo'glog | 3800 | 3400 | 2000 | 3000 | 500 | 5000 | 2800 | 1400 | 900 | 3200 | — |

## Coordinates and marker joins

Station coordinates are interaction anchors, not verified arrival tiles. The standard chunk calculation is `(x // 64) * 256 + (y // 64)` on map 28. NPC map plane 1 is preserved for Bill Teach’s ship NPCs. Charter and ordinary boat docks in the same town remain separate stations.

A marker join requires a named dock/operator in the primary article and a single copied ship marker (sprite 22463, element 612) within Chebyshev distance 3 of that exact operator coordinate, on the same map and plane. All candidates are recorded; ambiguity yields no association. This is a bounded join corroborated by named dock/service identity, never an unrestricted nearest-marker inference. The stable pin pointer, cache object ID, Wiki oldid and original operator coordinate are retained in each joined station.

| Station | Marker | Copied x,y | Wiki operator x,y | Source |
| --- | --- | --- | --- | --- |
| ship-charter-brimhaven | `cache-c4dafe54c05e4e35395b478a` | 2760,3238 | 2759,3239 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-catherby | `cache-535dbe6f39febf097b45efda` | 2793,3406 | 2793,3407 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-mos-le-harmless | `cache-e97e88f6298cbd35425c73c6` | 3670,2931 | 3671,2930 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-port-khazard | `cache-d35ee35ca1a875187e7dc22b` | 2674,3143 | 2673,3144 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-port-phasmatys | `cache-355e03e7af239c0747f1f9e7` | 3703,3503 | 3701,3503 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-shipyard | `cache-aa55490240760aadcd1a7262` | 3001,3030 | 3001,3033 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-port-tyras | `cache-26cdd91b219f47ee0d3dc36f` | 2142,3123 | 2144,3122 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-charter-ooglog | `cache-a357380d5eb19b529290bd33` | 2624,2857 | 2621,2857 | [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) |
| ship-rellekka-jarvald | `cache-05d33fc00e1224b11864a52c` | 2622,3683 | 2621,3683 | [Jarvald](https://runescape.wiki/w/Jarvald?oldid=37123062) |
| ship-rellekka-sailor | `cache-c0e07129a2d30569659a4107` | 2628,3692 | 2629,3693 | [Sailor](https://runescape.wiki/w/Sailor?oldid=37123103) |
| ship-miscellania-sailor | `cache-06e4c266e8b937a9948d23aa` | 2580,3846 | 2581,3847 | [Sailor](https://runescape.wiki/w/Sailor?oldid=37123103) |
| ship-jatizso-mord | `cache-19f0ace9e628dff47abefc44` | 2421,3780 | 2421,3781 | [Mord Gunnars](https://runescape.wiki/w/Mord_Gunnars?oldid=37123105) |
| ship-neitiznot-maria | `cache-4d99d60a91a9aef8315c79cb` | 2311,3779 | 2311,3781 | [Maria Gunnars](https://runescape.wiki/w/Maria_Gunnars?oldid=37123104) |
| ship-port-sarim-entrana-monk | `cache-7043fbe6d546f2345c570fd0` | 3048,3234 | 3046,3234 | [Monk of Entrana](https://runescape.wiki/w/Monk_of_Entrana?oldid=37127314) |
| ship-entrana-monk | `cache-a591f826dbaf1cd529cbae27` | 2834,3334 | 2835,3336 | [Monk of Entrana](https://runescape.wiki/w/Monk_of_Entrana?oldid=37127314) |
| ship-ardougne-barnaby | `cache-208fddb546038d09f37b4ba9` | 2682,3273 | 2683,3275 | [Captain Barnaby](https://runescape.wiki/w/Captain_Barnaby?oldid=37122763) |

16 stations have bounded copied marker joins; 19 retain primary Wiki NPC/object/ship map coordinates with no pin association. The latter include Musa Point and Menaphos charter docks. Their operator locations do not match a unique nearby copied marker. No claim is made that the entire 104-pin transport category is resolved.

## Requirements and material qualifications

- Shipyard: complete The Grand Tree and reach G.L.O. Caranock dialogue in Monkey Madness. The specialised Shipyard page supplies the exact partial-quest milestone.
- Port Tyras: its specialised page permits arrival after partial Regicide but departure only after completion. This refines the general Charter ship page’s simple Regicide summary.
- Port Phasmatys: Morytania access may be gained via Priest in Peril **or** defeating the ghoul below Paterdomus; do not force quest completion.
- Waterbirth: 1,000 coins outbound before Fremennik Trials; free after completion. Transcript explicitly includes bringing the traveller back in the paid service; return has no additional charge.
- Jatizso: start Fremennik Isles after Fremennik Trials. Neitiznot: progress until King Gjuki orders the trip, rather than requiring completed Fremennik Isles. Full quest skill requirements are not projected onto initial ferry access.
- Pirates Cove: Lunar Diplomacy first journey requires meeting its start requirements and obtaining seal. Lunar Isle: clear Lady Zay’s curses; seal is required for NPC interactions before Lunar Diplomacy completion, not after.
- V's island: travel occurs during Hero's Welcome. Skills 60 Divination, 67 Mining, 62 Slayer, 67 Smithing are recorded; 2015 update reduced old Tai Bwo Wannai Trio / master Barbarian Skilling gate to Ancient Cavern access via Barbarian Training. Older transcript requirement wording is not treated as current.
- Entrana: barred combat gear prevents boarding; monks expose offending items and offer bank interface. Summoning familiars/pouches/scrolls are allowed since 2020. Detailed item inventory is delegated to current Entrana page instead of a permanently frozen approximation.
- Void Outpost: free members boat. A Pest Control game participation requirement is not imposed on island entry.
- Ardougne–Brimhaven: 30 / 15 / free fares with Karamja achievement and ring conditions. Customs can confiscate Karamjan rum on return, including when charmed.
- Anachronia: first Stormbreaker trip starts base-camp tutorial and plays cutscene; object 83794 coordinates retained.

## Remaining coverage gaps

Daemonheim Al Kharid and Taverley boats, Musa Point ordinary ferry, and other F2P routes are owned by the separate F2P lane. Rimmington–Barnaby appears in OSRS sources but not the reviewed RS3 Captain Barnaby/Rimmington revisions, so no RS3 edge is authored. Iceberg, Piscatoris, Dragontooth, Tai Bwo Wannai–Feldip, Burgh de Rott–Meiyerditch, Hollows–Mort'ton and Arc networks remain outside this batch. The generic Boat network overview is incomplete (notably omits Waterbirth) and is not sufficient by itself to author every service. No shortcut/canoe/interior work overlaps this batch.

Some service articles establish the journey but do not explicitly quote a fare: their `fare` is null and the unresolved fare is recorded in `unknowns`; each is blocked by a required `fare-available:<routeid>` confirmation so the engine cannot silently treat unknown cost as free. Charter prices and Jarvald/Barnaby fees are explicit. Return permission, tutorial state and exact arrival tiles have not been observed in game.

## Verification

Validated JSON parsing, unique station/route IDs, endpoint existence, no self-links, membership flags, allowed route kinds, recomputed chunk IDs, 104 charter cells, six absent off-diagonal pairs, and worked-example fare orientation. Every Wiki provenance URL contains its retrieved oldid. No test/app/server mutation performed.

## Primary revision registry

- [Charter ship](https://runescape.wiki/w/Charter_ship?oldid=36664213) — revision 36664213.
- [Trader Crewmember](https://runescape.wiki/w/Trader_Crewmember?oldid=37144146) — revision 37144146.
- [Trader Stan](https://runescape.wiki/w/Trader_Stan?oldid=37127305) — revision 37127305.
- [Jarvald](https://runescape.wiki/w/Jarvald?oldid=37123062) — revision 37123062.
- [Transcript:Jarvald](https://runescape.wiki/w/Transcript%3AJarvald?oldid=36334521) — revision 36334521.
- [Sailor](https://runescape.wiki/w/Sailor?oldid=37123103) — revision 37123103.
- [Transcript:Sailor](https://runescape.wiki/w/Transcript%3ASailor?oldid=35078630) — revision 35078630.
- [Miscellania](https://runescape.wiki/w/Miscellania?oldid=37123140) — revision 37123140.
- [Maria Gunnars](https://runescape.wiki/w/Maria_Gunnars?oldid=37123104) — revision 37123104.
- [Mord Gunnars](https://runescape.wiki/w/Mord_Gunnars?oldid=37123105) — revision 37123105.
- [Transcript:Mord Gunnars](https://runescape.wiki/w/Transcript%3AMord_Gunnars?oldid=33019059) — revision 33019059.
- [Lokar Searunner](https://runescape.wiki/w/Lokar_Searunner?oldid=37123106) — revision 37123106.
- [Transcript:Lokar Searunner](https://runescape.wiki/w/Transcript%3ALokar_Searunner?oldid=37078326) — revision 37078326.
- [Captain Bentley](https://runescape.wiki/w/Captain_Bentley?oldid=37123642) — revision 37123642.
- [Lady Zay](https://runescape.wiki/w/Lady_Zay?oldid=37147597) — revision 37147597.
- [Lunar Diplomacy](https://runescape.wiki/w/Lunar_Diplomacy?oldid=37161812) — revision 37161812.
- [Seal of passage](https://runescape.wiki/w/Seal_of_passage?oldid=37020403) — revision 37020403.
- [Freya Lune](https://runescape.wiki/w/Freya_Lune?oldid=37123136) — revision 37123136.
- [Alfrick the Planner](https://runescape.wiki/w/Alfrick_the_Planner?oldid=37123137) — revision 37123137.
- [Hero's Welcome](https://runescape.wiki/w/Hero%27s_Welcome?oldid=37162099) — revision 37162099.
- [Monk of Entrana](https://runescape.wiki/w/Monk_of_Entrana?oldid=37127314) — revision 37127314.
- [Entrana](https://runescape.wiki/w/Entrana?oldid=37161918) — revision 37161918.
- [Void Knights' Outpost](https://runescape.wiki/w/Void_Knights%27_Outpost?oldid=37127341) — revision 37127341.
- [Squire (Void Knights)](https://runescape.wiki/w/Squire_%28Void_Knights%29?oldid=37127339) — revision 37127339.
- [Captain Barnaby](https://runescape.wiki/w/Captain_Barnaby?oldid=37122763) — revision 37122763.
- [Customs officer](https://runescape.wiki/w/Customs_officer?oldid=37198107) — revision 37198107.
- [Bill Teach](https://runescape.wiki/w/Bill_Teach?oldid=37127415) — revision 37127415.
- [Mos Le'Harmless](https://runescape.wiki/w/Mos_Le%27Harmless?oldid=37125022) — revision 37125022.
- [The Stormbreaker](https://runescape.wiki/w/The_Stormbreaker?oldid=36984295) — revision 36984295.
- [Port Tyras](https://runescape.wiki/w/Port_Tyras?oldid=36968530) — revision 36968530.
- [Shipyard](https://runescape.wiki/w/Shipyard?oldid=37165124) — revision 37165124.
- [The Jack of Spades](https://runescape.wiki/w/The_Jack_of_Spades?oldid=37153043) — revision 37153043.
- [Rimmington](https://runescape.wiki/w/Rimmington?oldid=37191938) — revision 37191938.
- [Boat network](https://runescape.wiki/w/Boat_network?oldid=36328783) — revision 36328783.

## Conservative eligibility gates

Unknown service fares require route-specific `fare-available:<routeid>` confirmations (6 records). Partial quest milestones require `quest-stage:<routeid>` confirmations (32 records), since a generic started state cannot establish the travel stage. Morytania alternative access is gated by `morytania-access-confirmed`; Entrana forbidden equipment by `entrana-equipment-clear`. Known discount-bearing fares retain the listed conservative base amount; optional discounts are evidence, not assumed player facts.

## Integration normalisation

All station IDs use the `ship-` prefix to preserve their independent dock/operator anchors when other datasets use the same town name. Completed quest requirements are string names. Partial quest metadata is retained in route `notes` with explicit `quest-stage:<routeid>` confirmations. Prose conditions, inventory warnings, fare explanations, and optional sailing confirmation preferences are notes; they are not interpreted as player fact keys. Only the stable fare/stage/Morytania/Entrana access confirmation keys remain. A live inventory check may enforce charter bedsheet mechanics separately.
