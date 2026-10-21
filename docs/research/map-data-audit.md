# RS3 Chunk Picker map-data audit

Checked 7 October 2026. Read-only repository research for Player 1. No repository files, Git state, saved maps or servers were changed. Only this requested report was written outside the repository.

## Principal findings

- **15905 Whale's Maw Dock, 9772 South-west Feldip, 12844 Exiled Kalphite Hive surface, and 8244 West coast Prifddinas** are missing from the general walkable list. They should remain members-only. The retained data currently excludes them from both lists, rather than marking them F2P.
- **13118, 13374, 13628, 13629 and 13630** on the Wilderness volcano rim/coast have strong evidence for F2P classification. **13628** also lacks general walkability. **9769 Ashdale cliff** is another probable F2P omission, with less precise boundary evidence.
- **12080 Mudskipper Corner already is walkable and F2P.** Its tiny land area must not disqualify it. An exact collision-tile count was not established.
- **11569 Musa Point, 11825 Port Sarim Church and 11314 South Crandor** contain disconnected pieces of different landmasses. Their section separation is essential. Rolling a region ID can be legitimate without reaching the island named by its nickname.
- **11059 Fishing Platform** includes a western Crandor fragment as section 2, disconnected from the platform. The Wiki identifies western Crandor tiles as members-only. Keep F2P=false. A missing reciprocal entry prevents rolling North Crandor back from that fragment.
- Whole-chunk F2P flags cannot enforce mixed membership inside Havenhythe, Catherby, Paterdomus and other split chunks. Section membership and conditional routes need their own policy.

## Evidence, scope and snapshot

**Verified data facts** come from parsed retained JSON and authored modules. **Verified game facts** come from current RS3 Wiki pages and Jagex news. **Inference** means matching those facts to a 64×64 region or retained section. Artwork, NPC counts, clue locations and recorded edges support an inference; they are not independent collision measurements. No logged-in character movement or collision dump was available. OSRS, Classic and Fandom results were excluded from conclusions.

Confidence is **high** for directly supported status/code observations; **medium-high** for consistent geography, contents and topology without collision observation; **medium/low** where a boundary or identity remains unresolved. Regional membership can be high confidence while the exact chunk assignment remains medium confidence.

The audit applies Player 1's rules: one reachable tile is enough; adjacency alone supplies no walking route; ownership does not connect disconnected sections; walking cannot cross unclaimed chunks. In F2P, the qualifying tile must itself be free. A region containing a free section can qualify while its members sections remain blocked.

The retained JSON SHA-256 was `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`. The following inspected files were rehashed and matched the earlier reads. Another agent owns the changing working tree; later edits are outside this snapshot.

| File | Inspected SHA-256 |
|---|---|
| app/data/world.mjs | 4596ee51b9b3e4a247ac6205af8cf8bc940e3800b7964c794fdb909f3c8ccbb9 |
| app/core/rules.mjs | edc038d8a5499d6af10b5335ca603d4ae3f38978e3f27a1cd8ec2432bb253292 |
| app/tasks/access.mjs | 790429e9ec2d368e314843c10a24d71e7dd3b6f407b791f9d7a18da1c300635d |
| app/data/access-policy.mjs | 02ef786b5fd4ee51e142497e4442813b890066bd2e1cbb9b303418ad766ec42d |
| docs/access-logic.md | 190d17053e0462c21389af23978766356b738e35ab5b22cc7cb21f865f15f459 |

### Exact data origin

All three inputs come from top-level properties of **rs3-chunkpicker-chunkinfo-export.json**:

| Input | Retained location | Consumer |
|---|---|---|
| Chunk/area records | `chunks`, starting line 179166 | buildWorld indexes numeric chunks and named interiors separately |
| Boundary entry dependencies | `sections`, starting line 347180 | buildWorld creates sectionTopology; rules.mjs checks destination entry dependencies |
| General terrain list | `walkableChunks`, line 353436 | world.walkable |
| F2P terrain list | `walkableChunksF2P`, line 353437 | world.f2p |
| Boundary requirement map | `sectionsLimits`, line 352766 | Empty in this export; supplies no verified walking gates |
| Interior connections | `chunks[id].Connect` and `chunks[id].Sections[n].Connect` | app/tasks/access.mjs resolves named areas and personal task gates |

The authored server reads this JSON in `app/server.mjs:175` and builds its world from it. Original reference/original-picker/index.js also fetches that filename. **reference/original-picker/tasksMap.json does not provide map membership or topology.** app/data/access-policy.mjs adds targeted source restrictions for Edgeville; it does not correct the surface lists audited here.

README/PRODUCT identify the retained upstream as version 6.9.68, commit `98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0`. Public provenance: [Source Chunk repository](https://github.com/source-chunk/chunk-picker-rs3), [JSON at the recorded commit](https://github.com/source-chunk/chunk-picker-rs3/blob/98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0/rs3-chunkpicker-chunkinfo-export.json). These links establish provenance, not independent collision correctness; current-value claims were checked against the local hashed export.

There are 2,556 records: 2,137 numeric and 419 named. The crop has 659 defined numeric records. Raw W has 574 entries, 573 unique; raw F has 162 unique. After normalization and missing-record filtering, buildWorld has **567 walkable / 160 F2P** IDs, including F-only 17456 as walkable. Of 573 raw topology bases, 568 survive base validation.

For region r, tile bounds are `X=64*floor(r/256)..+63`, `Y=64*(r mod 256)..+63`. Crop coordinates follow world.mjs: `r=7495+256*x-y`, x=0..46, y=0..49. North increases game Y and decreases crop y. Coordinates locate terrain; they do not establish walkability.

Notation: **W/F** means general walkable/F2P booleans. **F** means W=true,F=true; **M** means W=true,F=false; **U** means defined but W=false. M is a dataset classification, not proof every tile is members-only. Undefined neighbours were not counted as members or verified water.

## 1. Requested membership outliers

| Place / chunk IDs | Current W/F | Proposed value or policy | Evidence and confidence |
|---|---|---|---|
| “Wales Maw”: almost certainly **Whale's Maw**, **15905 Dock** | false/false | **true/false** | Members island with ordinary arrival/travel. Arrival NPCs, six fishing spots and reciprocal `0→16161,15649` support W. High members status; medium-high exact terrain inference. [Whale's Maw](https://runescape.wiki/w/Whale%27s_Maw) |
| **15649 Tortle Hunter Area; 16161 East Whale's Maw** | true/false | Keep | Correct usable members regions of the same island. High membership confidence. [Whale's Maw](https://runescape.wiki/w/Whale%27s_Maw) |
| **Waiko 14878,15133,15134,15135,15389,15390,15391** | All true/false | Keep | Docks, marketplace, village, Khan's House and bench already have the correct member flag. High. [Waiko](https://runescape.wiki/w/Waiko) |
| **17460 Bridge to Amberfell**, east Havenhythe border | true/true | Keep base flags; restrict eastern **section 1** | Western 2/3 connect to free 17204/17459-1; eastern 1 connects to 17716 and 17461-5/6. Members bridge repair is verified; exact section mapping medium-high inference. [Bridge](https://runescape.wiki/w/Bridge_(Amberfell)), [Jagex release](https://secure.runescape.com/m=news/uncover-the-secrets-of-amberfell) |
| **17461 Waterfall Pathway**, east Havenhythe border | true/true | Keep base flags; restrict eastern **4/5/6** | Western 1/2/3 connect to 17205-1/17462; 4/5/6 link Amberfell/Moonrise. The western free fragment justifies base F. Medium-high section inference. [Havenhythe](https://runescape.wiki/w/Havenhythe), [Amberfell](https://runescape.wiki/w/Amberfell) |
| **17715 Lone Pier; 17716 Amberfell; 17717 Moonrise Cliff; 17718 “Moorise Temple”** | All true/false | Keep | Members expansion/quest landscape. High region status, medium-high chunk assignment. [Amberfell](https://runescape.wiki/w/Amberfell), [Jagex Moonrise release](https://secure.runescape.com/m=news/uncovering-the-moonrise-dig-site) |
| **12844 Exiled Kalphite Hive surface** | false/false | **true/false** | Trees, animals, caravan/quest NPCs and reciprocal `0→12845-1,12588-1`. High members status; medium-high W inference. [Exiled Hive](https://runescape.wiki/w/Exiled_Kalphite_Hive) |
| **11901 / named Exiled Kalphite Hive interior** | false/false in surface lists | Keep outside overland lists; retain interior membership gate | Members underground hive; its numeric allocation is not a surface roll destination. High. [Exiled Hive](https://runescape.wiki/w/Exiled_Kalphite_Hive) |
| Bottom-right Sophanem outside wall: likely **13098 Sophanem Temple**, possibly **13354** east; nearby **13097 South of Sophanem** | All true/false | Keep members; intended pointer unresolved | City/southern desert are members. The phrase does not distinguish temple coast from the adjacent region. High regional status; medium identity. [Sophanem](https://runescape.wiki/w/Sophanem), [Kharidian Desert](https://runescape.wiki/w/Kharidian_Desert) |
| Coast below that area, **13353** | Raw true/false; effective absent | Verify/restore missing terrain record; retain F=false | Raw W and reciprocal 13354-1 connection exist, but `chunks[13353]` is missing. High structural defect; exact tiles unresolved. [Sophanem context](https://runescape.wiki/w/Sophanem) |
| **9772 South-west Feldip** | false/false | **true/false** | Extensive surface contents; `0→9773,10028,9771,9516`. 9771 is undefined. Medium-high W inference; high regional membership. [Feldip Hills](https://runescape.wiki/w/Feldip_Hills) |
| **8495 South-west Tirannwn coast** | false/false; no topology | F=false; **defer W/topology correction** | Three trees and visible coastline do not prove a usable boundary tile. High member status; low/unresolved walking. [Tirannwn](https://runescape.wiki/w/Tirannwn), [Port Tyras](https://runescape.wiki/w/Port_Tyras) |
| **8244 West coast Prifddinas** | false/false | **true/false** | Copernicus Glyph is recorded here; Wiki locates him in West Prifddinas. `0→8500` is reciprocal. Medium-high W inference; high membership. [Copernicus](https://runescape.wiki/w/Copernicus_Glyph), [Prifddinas](https://runescape.wiki/w/Prifddinas) |

The membership overlay in app/web/map.mjs:487 returns null when W=false. It only tints W=true,F=false chunks as members. Thus 15905/12844/9772/8244/8495 are **unclassified/unwalkable**, not F2P=true, in this snapshot. Untinted appearance can resemble free land. Correct W for the supported four; use an explicit unclassified visual state for unresolved coasts.

Havenhythe's bridge requires members quest repair. Topology separates its east/west components, but there is no corresponding section membership policy and sectionsLimits is empty. An eastern seed/override can bypass that distinction. Farther-east Part II geography is absent from the retained named surface records, which stop at 17718. Jagex confirms additional areas beyond Amberfell now exist; add verified geography rather than extrapolating old artwork. [Jagex Part II](https://secure.runescape.com/m=news/havenhythe-part-ii-out-now)

## 2. Systematic membership scan

All defined surface regions were compared to four orthogonal neighbours. Only W=true neighbours counted toward opposite membership. There are **zero four-of-four islands**, and exactly **seven chunks with three opposite-class neighbours**:

| Chunk | Current W/F | Opposite neighbours | Proposed verdict | Evidence/confidence |
|---|---|---|---|---|
| **11316 Entrana** | true/false | F 11315,11317,11572 | Keep | Members island; sea adjacency supplies no mainland route. High. [Entrana](https://runescape.wiki/w/Entrana) |
| **11320 Death Plateau** | true/true | M 11064,11321,11576 | Keep F; gate member sections | Southern sections 3/4 connect free 11319. Wiki distinguishes plateau access from free quest/map marking. Medium-high base retention; high named-area restriction. [Location](https://runescape.wiki/w/Death_Plateau_(location)), [F2P quest](https://runescape.wiki/w/Death_Plateau) |
| **11576 Troll Arena** | true/false | F 11320,11575,11832 | **Whole-chunk F unresolved; retain pending tile check** | Arena is members; section 3 connects 11832-2, a possible free Wilderness fragment. A free tile there would require F=true despite arena membership. Medium. [Troll arena](https://runescape.wiki/w/Troll_arena), [Wilderness](https://runescape.wiki/w/Wilderness) |
| **12848 Kalphite Hive** | true/false | F 12592,12849,13104 | Keep provisionally; check desert boundary | `0→13104-1,12847,12592`. Free base IDs can contain members desert land; exact free tile unproved. Medium. [Kalphite Hive](https://runescape.wiki/w/Kalphite_Hive), [Shantay Pass](https://runescape.wiki/w/Shantay_Pass) |
| **13621 Mort Myre Swamp** | true/false | F 13365,13620,13622 | Keep provisionally | Entries 13877-1/13620-1 are not free west-bank sections. High named-area membership; medium complete-region verdict. [Mort Myre](https://runescape.wiki/w/Mort_Myre_Swamp) |
| **13622 Paterdomus** | true/true | M 13621,13623,13878 | Keep F; gate east section 2 | Free west 1 enters from 13366-1; east 2 connects Slayer Tower/Canifis. High. [Paterdomus](https://runescape.wiki/w/Paterdomus), [2017 free border changes](https://runescape.wiki/w/Update:Patch_Notes_(9_October_2017)) |
| **13623 Slayer Tower** | true/false | F 13367,13622,13624 | Keep provisionally | Entries 13879 and 13622-2 are members-side. High tower membership; medium whole region. [Slayer Tower](https://runescape.wiki/w/Slayer_Tower) |

All three M regions with exactly two F neighbours:

| Chunk | Current → proposed W/F | Evidence/confidence |
|---|---|---|
| **9769 Ashdale cliff**, F neighbours 9770/10025 | true/false → **true/true** | Probable omission. Ashdale is free; this gangplank region has a reciprocal connection to 9770. Medium-high exact-boundary inference. [Ashdale](https://runescape.wiki/w/Ashdale) |
| **11568 Karambwam Shore**, F neighbours 11569/11824 | true/false → keep provisionally | Sections connect only to members 11567/11312. North/east free-base adjacency is not a free tile proof. Medium. [Karamja](https://runescape.wiki/w/Karamja), [Musa Point](https://runescape.wiki/w/Musa_Point) |
| **13616 Desert Hunter Area**, F neighbours 13360/13617 | true/false → unresolved/retain | Entries use 13360-1/13617-2; check exact free border before flipping. Medium. [Kharidian Desert](https://runescape.wiki/w/Kharidian_Desert) |

All ten F chunks with exactly two M neighbours were also checked: **11313,11315,11317,11824,12592,13104,13360,13373,13617,13620**. No whole-chunk removal follows from this pattern.

| Further boundary finding | Current → proposed | Evidence/confidence |
|---|---|---|
| **11317 Catherby Beach** | true/true → keep | Town is members, but retained sections 2/4/5 connect free 11573; sections 1/3 contain members coastal facilities. Medium-high free-fragment inference. [Catherby](https://runescape.wiki/w/Catherby) |
| **13620 Nature Grotto** | true/true → keep | Grotto itself is members, but section 4 connects free west-bank 13364. Gate east/grotto sections separately. Medium-high. [Nature Grotto](https://runescape.wiki/w/Nature_Grotto), [River Salve border change](https://runescape.wiki/w/Update:Patch_Notes_(9_October_2017)) |
| **12592 Temple of Amascut; 13104 Shantay Pass; 13360 Dominion Tower; 13617 Abbey of St. Elspeth Citharede** | All true/true → retain; verify member subareas | Labels do not settle each section. No established reason to remove their free fragments. Medium. [Kharidian Desert](https://runescape.wiki/w/Kharidian_Desert), [Shantay Pass](https://runescape.wiki/w/Shantay_Pass) |
| **11313 Karamja volcano; 11315 North Crandor; 11824 Mudskipper; 13373 Wilderness Volcano** | All true/true → keep | Free locations with member neighbours/fragments. High location status; walking distinctions below. [Musa Point](https://runescape.wiki/w/Musa_Point), [Crandor](https://runescape.wiki/w/Crandor), [Mudskipper](https://runescape.wiki/w/Mudskipper_Point), [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano) |

### Connected Wilderness omissions

A geographic sweep found five non-F volcano rim/coast chunks. Current Wiki marks the north volcano free and documents opening deep Wilderness to free players in October 2017. Exact regions are inferred from retained geography/topology; collision boundaries were not observed. [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano), [2017 patch notes](https://runescape.wiki/w/Update:Patch_Notes_(9_October_2017)), [free ledges](https://runescape.wiki/w/Ledge_(Wilderness_North_Volcano))

| Chunk; southwest tile | Current W/F | Proposed W/F | Connection observation; confidence |
|---|---|---|---|
| **13118 NW Volcano Edge**; (3264,3968) | true/false | **true/true** | 1/2 enter from 13117/13374. Medium-high exact region, high regional F |
| **13374 North Volcano Edge**; (3328,3968) | true/false | **true/true** | 1 links 13630/13373-3/13118-1; 2 has invalid 13318-2. Medium-high |
| **13628 SE Coast**; (3392,3840) | false/false | **true/true** | 0→13629,13372-2. Medium-high |
| **13629 East Coast**; (3392,3904) | true/false | **true/true** | 0→13630,13373-3; missing return to 13628. Medium-high |
| **13630 NE Coast**; (3392,3968) | true/false | **true/true** | 0→13629,13374-1. Medium-high |

The older map predates the 2022 volcano redraw. Validate current ledge/coast crossings before treating every old edge as unconditional. F2P land does not make every nearby monster, dungeon or shortcut free.

## 3. Walkability edge cases

### Mudskipper Point

| Chunk; bounds | Current W/F | Proposed | Evidence/confidence |
|---|---|---|---|
| **11824 Mudskipper Point**; X2944–3007,Y3072–3135 | true/true | Keep; 0→11825-1,12080 | Wiki describes walking south from Port Sarim. High location/data confidence. [Mudskipper](https://runescape.wiki/w/Mudskipper_Point) |
| **12080 Mudskipper Corner**; X3008–3071,Y3072–3135 | true/true | Keep; 0→11824,12081-1 | Tiny northwest coastal sliver in retained artwork; reciprocal topology. Medium-high usable-land inference. Exact suggested 1–3 collision tiles **not independently counted**. [Location evidence](https://runescape.wiki/w/Mudskipper_Point) |

There is no minimum-area/tile-count filter in world.mjs or rules.mjs. A pure in-memory probe with only 11824 owned offers 12080 in default accessible/F2P mode. Removing it because most of its area is water would violate Player 1's rule.

### Musa Point, Karamja and the mainland

Verified game fact: free-player access to Musa Point uses the Port Sarim ship, not a land bridge. [Musa Point getting there](https://runescape.wiki/w/Musa_Point#Getting_there)

| Chunk/section | Current data | Proposed | Evidence/confidence |
|---|---|---|---|
| **11569 Musa Point** | W/F true/true; 1→11825-2,11313; 2→11570,11825-1 | Keep flags/separation | 1 is island land; 2 is a detached mainland sliver. Medium-high map/topology inference; high data. [Musa Point](https://runescape.wiki/w/Musa_Point) |
| **11825 Port Sarim Church** | W/F true/true; 1→11826,12081-1,11824,11569-2; 2→11569-1 | Keep; no 1↔2 walking edge | 1 is mainland; 2 is Karamja pier. Existing cross-region edges join separate pieces of the same coast. Medium-high. [Musa Point](https://runescape.wiki/w/Musa_Point) |
| **11826 Rimmington; 11570 Chemist's House** | Both true/true; 11826↔11570; 11570↔11569-2 | Keep | Mainland entry into base 11569 does not enter Karamja. High topology, medium-high geography. [Rimmington](https://runescape.wiki/w/Rimmington) |
| **12082 Port Sarim** | true/true; split; not orthogonally adjacent to 11569 | Keep; sailing is a separate route | Port ownership does not prove island walking access. High. [Musa Point access](https://runescape.wiki/w/Musa_Point#Getting_there) |
| **11313 Karamja volcano** | true/true; 0→11314-3,11569-1,11057 | Keep | Accessible through island 11569-1, not mainland 11569-2. High data fact. [Volcano](https://runescape.wiki/w/Musa_Point#Karamja_Volcano) |

Pure probes: mainland **11825-1 can offer base 11569**, correctly for section 2. Owning both bases reaches only 11569-2; **11313 is not offered**. Seeding 11569-1 offers 11313. Rimmington alone offers 11570, not 11569 directly. No boat authorization is inferred from these walking edges.

### Crandor and Fishing Platform

Verified access involves partial Dragon Slayer, initially the Lady Lumbridge voyage, and the secret passage associated with Elvarg's lair. Passage unlock and ship availability are conditional. This is not unrestricted surface walking. [Crandor](https://runescape.wiki/w/Crandor), [Lady Lumbridge](https://runescape.wiki/w/Lady_Lumbridge), [Elvarg's lair](https://runescape.wiki/w/Elvarg%27s_lair)

| Chunk/section | Current W/F and topology | Proposed | Evidence/confidence |
|---|---|---|---|
| **11314 South Crandor** | true/true; 1→11315; 2→11315; **3→11313** | Keep; no automatic 3↔1/2 | 1/2 are island; 3 is Karamja's north-volcano sliver. Medium-high geographic assignment; high data. [Crandor](https://runescape.wiki/w/Crandor) |
| **11315 North Crandor** | true/true; 0→11314-1,11314-2 | Keep flags; review adding **11059-2** | Reachable from island components, not 11314-3. Missing return dependency verified; boundary medium-high inference. [Crandor](https://runescape.wiki/w/Crandor) |
| **11059 Fishing Platform** | true/false; 1→[]; **2→11315** | Keep; platform/island fragment separate | X2752–2815,Y3264–3327. Retained map places island land west of X2816. Wiki verifies western Crandor member-only tiles. High regional evidence; medium-high exact assignment. [Western tiles](https://runescape.wiki/w/Crandor#Trivia), [Fishing Platform](https://runescape.wiki/w/Fishing_Platform) |

**Does Crandor lie in region 11059?** Retained section 2 explicitly models a fragment and the retained map places land there: strong evidence that yes. Independent current collision coordinates/count were not retrieved. This does not connect the platform itself to Crandor on foot.

Wiki entrance coordinates (2834,3258) and (2856,3167) calculate to IDs 11314/11313. Coordinates are sourced facts; the region conversion is arithmetic inference. [Elvarg's lair](https://runescape.wiki/w/Elvarg%27s_lair)

Pure probes confirmed:

- **11313** offers **11314** through section 3; it does not reach island sections 1/2 or offer 11315.
- **11315** offers **11059** in members mode through destination section 2. F2P correctly excludes 11059.
- **11059-2**, explicitly reached, cannot offer **11315**, which lacks the reciprocal dependency. Proposed connection addition: `sections[11315][0]` includes `11059-2`, after current boundary confirmation.

Rolling currently does not consult task-validated interior traversal for surface section reachability. A personally usable dungeon route may need a gated entry contribution. Do not add an unconditional volcano↔Crandor-island edge. Transit must remain inside authorized unlocked terrain; PRODUCT leaves broader underground exceptions unconfirmed.

### Other adjacency without a walking connection

| Pair; current value | Proposed | Evidence/confidence |
|---|---|---|
| **11314↔11570 Chemist's House; 11315↔11571 Crafting Guild**; both W/F=true, no edges | Keep disconnected | Sea between the relevant land. High regional geography, medium-high boundary. [Crandor](https://runescape.wiki/w/Crandor), [Rimmington](https://runescape.wiki/w/Rimmington) |
| **12080↔12336 South Wizard Tower**; both W/F=true, no edge | Keep disconnected | Sea between coast/tower island. Medium-high. [Mudskipper](https://runescape.wiki/w/Mudskipper_Point), [Wizards' Tower](https://runescape.wiki/w/Wizards%27_Tower) |
| **11316 Entrana↔11315 North Crandor**; W=true, F=false/true, no edge | Keep disconnected | Separate islands. High. [Entrana](https://runescape.wiki/w/Entrana), [Crandor](https://runescape.wiki/w/Crandor) |
| **11574 North Taverley↔11830 Goblin Village**; both W/F=true, no edge | Preserve pending direct cliff/passage check | A route around the cliff can require other chunks. Medium, collision unobserved. [Taverley](https://runescape.wiki/w/Taverley), [Goblin Village](https://runescape.wiki/w/Goblin_Village) |
| **12604 Central North Wilderness↔12605 Deserted Keep; 13116 Annakarl↔13117 Rogues' Castle**; W/F=true, no edges | Preserve pending exact fence/maze check | F2P classification does not remove barriers. Medium/unresolved boundary. [Deserted Keep](https://runescape.wiki/w/Deserted_Keep), [Rogues' Castle](https://runescape.wiki/w/Rogues%27_Castle) |

The latter pairs are movement-review candidates, not independently verified claims that every absent edge remains correct today.

## 4. All named surface records marked unwalkable

Of 92 defined crop records with effective W=false, 81 use interior/remote-style `Name`, have no surface topology, and were not promoted into land. The eleven overland-style `Nickname` records are exhaustive here:

| ID; name; southwest tile | Current W/F | Proposed W/F | Evidence/confidence |
|---|---|---|---|
| **8244 West coast Prifddinas**; (2048,3328) | false/false | true/false | Reciprocal 8500, Copernicus. Medium-high. [Copernicus](https://runescape.wiki/w/Copernicus_Glyph) |
| **8495 SW Tirannwn coast**; (2112,3008) | false/false | Defer W; F=false | No topology/scenery only. Low W confidence. [Port Tyras](https://runescape.wiki/w/Port_Tyras) |
| **9772 SW Feldip**; (2432,2816) | false/false | true/false | Surface contents and boundaries. Medium-high. [Feldip Hills](https://runescape.wiki/w/Feldip_Hills) |
| **10301 Penguin Island**; (2560,3904) | false/false | **Keep false/false** | 26 penguins and Macaroni. Wiki distinguishes fairy-ring island from islands only viewed/attacked from shore; Macaroni is on an unapproachable island. Medium-high matching inference. [Here Be Penguins](https://runescape.wiki/w/Here_Be_Penguins) |
| **10540 Oo'glog Ship**; (2624,2816) | false/false | Defer W/topology; F=false | Two gangplanks, no entry dependency. Verify deck tiles. Low W confidence, high regional membership. [Oo'glog](https://runescape.wiki/w/Oo%27glog) |
| **12844 Exiled Hive surface**; (3200,2816) | false/false | true/false | Entrance contents/reciprocal routes. Medium-high. [Exiled Hive](https://runescape.wiki/w/Exiled_Kalphite_Hive) |
| **13628 Volcano SE Coast**; (3392,3840) | false/false | true/true | Connected free-region coast. Medium-high. [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano) |
| **14902 The Adventerous**; (3712,3456) | false/false | true/false | Reciprocal 0→14646-1; documented boardable Bill Teach ship. Exact deck assignment inferred. Medium-high. [The Adventurous](https://runescape.wiki/w/The_Adventurous), [Cabin Fever](https://runescape.wiki/w/Cabin_Fever) |
| **15406 Mos Le'Harmless Beach Corner**; (3840,2944) | false/false | true/false, verify small boundary | Reciprocal 0→15407; clue/coast. Medium, no tile count. [Neighbouring east coast](https://runescape.wiki/w/Hooded_pirate) |
| **15407 Hooded Pirate coast**; (3840,3008) | false/false | true/false | 0→15406,15151-1; reachable pirate past Trouble Brewing. Medium-high region assignment. [Hooded pirate](https://runescape.wiki/w/Hooded_pirate) |
| **15905 Whale's Maw Dock**; (3968,2112) | false/false | true/false | Arrival/fishing terrain, reciprocal boundaries. Medium-high. [Whale's Maw](https://runescape.wiki/w/Whale%27s_Maw) |

15406/15407 are the strongest additional small-coast candidates. No finding proves a precise one-to-three tile count for a currently unwalkable chunk. The known tiny-area example 12080 is already correct. Visible ocean/land alone cannot settle a region's eligibility.

## 5. Structural map coverage defects

These raw list entries lack `chunks[id]`; buildWorld drops them and their boundary references. Adding a list entry alone cannot repair them. Current values are verified from the [retained JSON](https://github.com/source-chunk/chunk-picker-rs3/blob/98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0/rs3-chunkpicker-chunkinfo-export.json); this is structural evidence, not independent game-tile evidence.

| ID; southwest tile | Raw W/F → effective | Proposed / confidence |
|---|---|---|
| **9515**; (2368,2752) | true/false → absent | Verify/restore terrain record; 0→9516,9771 with return edges. High defect, medium terrain inference |
| **9771**; (2432,2752) | true/false → absent | Same; 0→9772,9515. High defect, medium terrain inference |
| **9722**; (2368,16000), outside crop | true/false → absent | Likely typo for **9772**. Review provenance; do not create a far-south region. Medium-high typo inference |
| **12334**; (3072,2944) | true/false → absent | Unresolved; no retained boundary evidence. High observation, low repair confidence |
| **13353**; (3328,2624) | true/false → absent | Verify/restore coast record; 0↔13354-1. High defect, medium terrain inference |
| **13883**; (3456,3776) | true/true → absent | Strong free-terrain restoration candidate; 0→13882-2,13627 with return edges. High defect, medium-high terrain inference |
| **15149**; (3776,2880) | true/false → absent | Unresolved; no boundary evidence. High observation, low repair confidence |
| **6769**; (1664,7232), outside crop | false/true → absent | Leave unresolved; no surface/connection evidence. High observation, low repair confidence |

**17456 Harpoon Shore** is raw W=false,F=true; buildWorld accepts effective W=true and emits `f2p-only-walkable`. Proposed raw W=true,F=true, preserving effective behaviour. Its sections connect 17457-1/17200-3. High data confidence; [Havenhythe context](https://runescape.wiki/w/Havenhythe).

W duplicates 15649, and entries 8752/10040/13367/14641 contain whitespace. buildWorld deduplicates/trims them; raw cleanup need not change eligibility.

### Boundary defects and nonlocal edges

| Current | Proposed | Evidence/confidence |
|---|---|---|
| **11059-2→11315**, 11315-0 lacks return | Add **11059-2** after boundary check | Verified asymmetry; western island fragment. Medium-high. [Crandor western tiles](https://runescape.wiki/w/Crandor#Trivia) |
| **13628-0→13629**, 13629-0 lacks return | Add **13628** after coast check | Verified asymmetry, connected coast. Medium-high. [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano) |
| **13374-2→13318-2** undefined; 13118-2→13374-2 exists | Replace likely typo with **13118-2**, verify boundary | Invalidity verified; intended reverse high-confidence inference. [North Volcano](https://runescape.wiki/w/Wilderness_North_Volcano) |

The scan found 98 section-edge asymmetries across the crop. They are not all bugs; one-way routes and dependency conventions are possible. Do not generate every reverse edge blindly.

Thirteen edges join different bases that are not orthogonal neighbours:

`8752-2→9009-1; 9532-3→9275; 10029-0→10286; 10030-0→10287-2; 10287-2→10030; 10545-0→10290; 12082-1→11825-2; 12082-1→16179-2; 12329-4→13097-2; 12857-0→12602; 13097-2→12329-4; 14386-3→14131; 16179-2→12082-1.`

This is a **data inventory**, not thirteen verified gameplay errors. Some appear to be transport, others diagonal/typographical routes. 12082↔16179 is the Port Sarim/Havenhythe relationship, not continuous overland walking. Travel should carry type/conditions. [Havenhythe](https://runescape.wiki/w/Havenhythe)

The candidate loop finds a geometric neighbouring destination, then accepts any reachable incoming dependency there; it does not require that dependency's source to be the particular orthogonal neighbour. Section reachability can also traverse nonlocal dependencies between owned bases. Inaccurate/transport edges can therefore affect access without a valid walking boundary. This model risk is verified by code inspection; a false roll was not reproduced for every edge.

## 6. Data fixes versus code fixes

### Current execution

1. **world.mjs** normalizes lists, drops missing records/invalid edges, accepts valid F-only IDs as walkable and builds four orthogonal neighbours. It does not simulate collision tiles.
2. **Accessible rolling** uses incoming destination dependencies from reachable owned terrain and bypasses the W filter. One small section can qualify a whole region without opening its other sections. Locked intermediate bases cannot participate in findReachableSections.
3. **Frontier** uses raw adjacency plus W; it does not satisfy walking-only rules at sea/cliff/fence boundaries. W corrections primarily change frontier and display; F changes affect generated candidates in both modes.
4. **F2P exclusion checks the base**, not the qualifying destination/source section. Pure probe: owned 17716 can offer 17460 in F2P mode via its east section 1. The free classification belongs to different west sections. This demonstrates a missing gate, not a claim a free account can physically stand in Amberfell.
5. **Explicit selected candidates** bypass generated W/F filters by current design. Confirmed teleports add a destination without unlocking it. Their reasons must remain distinguishable from walking access.
6. **tasks/access.mjs** uses shared unlocked bases, personal section/area overrides, Connect declarations and validated connector tasks. Owning a split base does not seed every section. Named interiors remain a coarse graph. Existing access-policy.mjs restrictions address specified sources, not mixed overland membership or all interior routes.

Pure calculateAccess probe with 11825/11569 owned and only mainland 11825-1 entered returned only 11825-1/11569-2. With 11313/11314 owned, only 11314-3 was reached. These establish that the inspected separation is already implemented; preserve it.

| Finding | Correct repair location |
|---|---|
| W omissions 8244/9772/12844/15905; probable 14902/15406/15407; 13628 | **Walkable data**, ideally dated authored corrections if the retained JSON stays archival. Existing routes still need physical confidence |
| F omissions 13118/13374/13628/13629/13630; probable 9769 | **F2P data** with scope/date/evidence, not a global region-name heuristic |
| 17456 inconsistency, whitespace/duplicate, likely 9722 typo | **Data hygiene**, preserving intended effective behaviour |
| Missing definitions, especially 13883 and reciprocal coast entries | **Chunk records and verified topology**, not list-only changes; do not invent resources |
| Missing return edges and 13374 typo | **Section connection data**, after boundary confirmation |
| Mixed Havenhythe/Catherby/Paterdomus/Nature Grotto membership | **Section membership data plus code enforcement** in rolls/source access. Require at least one reachable free destination component in F2P |
| Boats, bridges, shortcuts, dungeon requirements | **Typed conditional route data and shared code consumers**. Walking candidates cross an actual adjacent boundary; other routes use their authorized policy |
| Personally usable Crandor dungeon route | **Conditional code/data entry contribution** after progression and locked-transit checks. No unconditional surface edge or inferred underground exception |
| Unclassified terrain appears free | **Map presentation**: distinguish unknown/unverified terrain from F2P; known W fixes restore members tint |
| Tiny reachable section | Preserve **code semantics**; no area threshold. Correct terrain/edge data where supported |

For walking candidates, verify the qualifying route against the actual orthogonal source boundary and its reachable component. Handle legitimate nonlocal travel through explicit transport/teleport/interior rules with requirements. Display which section qualifies a roll so a “Musa Point” candidate does not imply Karamja access.

## 7. Validation and limits

Validation used JSON parsing, complete crop/list/section scans, independent research lanes, retained map inspection in memory and pure in-memory calls to buildWorld, reachableSections, evaluateRollPool and calculateAccess. No repository tests/files were written, no persistent service/test process was started, and no Git write command ran.

The probes confirmed tiny Mudskipper eligibility; mainland/island Musa separation; volcano-only South Crandor sliver access; asymmetric west-Crandor rolls; default members eligibility for W-list omissions through topology; missing F entries blocking generated rolls; and lack of section membership enforcement for mixed free bases.

Remaining limits are explicit: precise Sophanem pointer; current collision tiles/crossings for 8495/10540 and small coastal pieces; Troll Arena's possible free fragment; exact desert boundary tiles; modern volcano collision changes; missing farther-east Havenhythe coverage; and authorized conditional underground transit. This is not a map-wide collision correctness certification. Medium-confidence proposals need current map or in-game boundary verification before implementation.
