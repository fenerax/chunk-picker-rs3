# Automatic F2P teleport catalogue evidence

Reviewed 2026-10-09 through bounded public RS3 RuneScape Wiki API batches. The ignored snapshot is `.local/game-data/automatic-teleports-2026-10-09/wiki.json` in this worktree. The [revision manifest](automatic-teleports-evidence.2026-10-09.v1.json) records revision IDs, timestamps, exact wikitext SHA-256 values, snapshot SHA-256, all 43 existing global teleport/lodestone audits, and unresolved landing evidence. No private save, live service, Tailscale configuration or in-game journey was used. The main repository's retained game-data component mask was read only.

`transport-routes.2026-10-09.v2.json` extends the existing catalogue with ten destinations and adds automatic metadata to existing spells, lodestones and the explorer's ring. Existing requirements, manual confirmations, stations, provenance and unknowns are preserved. The totals are **247 routes, 177 stations, 60 F2P routes and 187 members routes**. Map connection and pin artifacts remain separate historical display products; the active route catalogue supplies these new automatic destination records.

## Standard spells and current destinations

The existing standard spells were already catalogued. Their new `automatic` metadata names the standard spellbook and rune costs so personal levels and reachable supplies can establish availability without deleting historical manual requirements.

| Spell | Magic | Personal quest requirement | Runes | Destination chunk | Exact component witness |
| --- | ---: | --- | --- | --- | --- |
| [Varrock Teleport, revision 37182128](https://runescape.wiki/w/Varrock_Teleport?oldid=37182128) | 25 | None | 3 air, 1 fire, 1 law | 12853 | Exact component 12853-1000001 at typed landing (3212,3434) |
| [Lumbridge Teleport, revision 36979025](https://runescape.wiki/w/Lumbridge_Teleport?oldid=36979025) | 31 | None | 3 air, 1 earth, 1 law | 12850 | Exact component 12850-1000001 at typed landing (3219,3248) |
| [Falador Teleport, revision 37090986](https://runescape.wiki/w/Falador_Teleport?oldid=37090986) | 37 | None | 3 air, 1 water, 1 law | 11828 | Exact component 11828-1000001 at typed landing (2965,3378) |
| [Wendlewick Teleport, revision 37200254](https://runescape.wiki/w/Wendlewick_Teleport?oldid=37200254) | 28 | Visions of Havenhythe | 3 air, 1 water, 1 law | 16692 | New exact Wiki map tile (4186,3346) |

The Marigold Farm alternative at (4266,3280), chunk **16947**, has the same rune/Magic requirements and an independent witness, but additionally requires [Wiz Kid, revision 37153098](https://runescape.wiki/w/Wiz_Kid?oldid=37153098). That quest is members-only, so the alternate route is explicitly members-only. Access to the base F2P spell never proves access to its later quest reward. Automatic spell checks currently use literal rune supplies. Equipped elemental-staff alternatives are not modelled; the retained personal confirmation and override can establish roll usability, while access still requires verified supplies for its recorded costs. A staff never replaces the law rune.

The three older standard-spell landings above have existing `exact-decoded-mask-tile` component witnesses as well as independent roll-chunk certificates. Their lodestone/Home Teleport counterparts use different coordinates and retain blocked exact landing evidence. The standard spells' witnesses do not certify those lodestone landings.

## F2P items

Held tablets are consumed per use. Level 50 Runecrafting is an acquisition requirement at the Runecrafting Guild shop, not a requirement for breaking an already held altar tablet. These tablets land outside the altar, so casting does not require the corresponding talisman or tiara.

| Item | Wiki destination | Chunk | Geometry result |
| --- | --- | --- | --- |
| [Air altar teleport, revision 36904190](https://runescape.wiki/w/Air_altar_teleport?oldid=36904190) | (3125,3406) | 12341 | Exact source-plane mismatch; no access component; roll chunk certified |
| [Mind altar teleport, revision 36904624](https://runescape.wiki/w/Mind_altar_teleport?oldid=36904624) | (2980,3513) | 11830 | Exact source-plane mismatch; no access component; roll chunk certified |
| [Water altar teleport, revision 37004133](https://runescape.wiki/w/Water_altar_teleport?oldid=37004133) | (3181,3158) | 12593 | Exact source-plane mismatch; no access component; roll chunk certified |
| [Earth altar teleport, revision 36904572](https://runescape.wiki/w/Earth_altar_teleport?oldid=36904572) | (3303,3477) | 13110 | Exact component witness |
| [Fire altar teleport, revision 36904576](https://runescape.wiki/w/Fire_altar_teleport?oldid=36904576) | (3309,3251) | 13106 | Exact component witness |
| [Body altar teleport, revision 36904485](https://runescape.wiki/w/Body_altar_teleport?oldid=36904485) | (3051,3441) | 12085 | Exact component witness |
| [Archaeology journal, revision 37187923](https://runescape.wiki/w/Archaeology_journal?oldid=37187923) | (3336,3378) | 13364 | Exact component witness; unlimited uses |
| [Clan vexillum, revision 37174580](https://runescape.wiki/w/Clan_vexillum?oldid=37174580) | (3181,3472) | 12598 | Exact component witness; unlimited uses |

The clan vexillum moved from Falador's Clan Camp to the Varrock Grand Exchange in January 2026. Its item is destroyed on leaving the clan; a personally available vexillum already proves clan membership. It cannot teleport during combat stance. Safe route planning still needs an origin from which the journey can be made.

Existing [explorer's ring 3, revision 37013938](https://runescape.wiki/w/Explorer's_ring_3?oldid=37013938), [ring 4, revision 37084766](https://runescape.wiki/w/Explorer's_ring_4?oldid=37084766), [ring of kinship, revision 37155981](https://runescape.wiki/w/Ring_of_kinship?oldid=37155981) and [skull sceptre, revision 36951245](https://runescape.wiki/w/Skull_sceptre?oldid=36951245) retain F2P classification and their recorded destinations. Automatic explorer metadata accepts either personally available ring 3 or 4. Skull floor reward unlocks remain personal confirmations. The kinship destination remains unresolved because its exact mask tile's source plane disagrees with the display plane; the sceptre's four interior destinations still lack certified runtime mappings.

## Home Teleport and landing limits

[Home Teleport, revision 37178861](https://runescape.wiki/w/Home_Teleport?oldid=37178861) requires no Magic level or runes and can access activated destinations from all spellbooks. Quick-teleport charges are optional and do not become ordinary-cast requirements. It can be interrupted by attacks; PvP opt-in prevents use above level 20 Wilderness.

The current [Lodestone Network, revision 37199016](https://runescape.wiki/w/Lodestone_Network?oldid=37199016) explicitly makes **Lumbridge available by default**. That newer network statement supersedes the older specific Lumbridge stone/spell prose about touching it. Other ordinary lodestones require activation. [Wendlewick, revision 37193342](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) is built during Visions of Havenhythe; completing that personal quest proves this build. [Lunar Isle, revision 36689036](https://runescape.wiki/w/Lunar_Isle_lodestone?oldid=36689036) activates automatically upon Lunar Diplomacy completion. Anachronia's town-hall/resources and Fort Forinthry's separate optional blueprint construction remain explicit build requirements; standing in those chunks never proves construction.

All 27 existing resolved lodestone flags match the first specific page's current membership field: 12 F2P and 15 members. The general network page still omits Wendlewick from one F2P list; its specific page and Home Teleport's current list independently identify it as F2P. Anachronia, Karamja and Fort Forinthry remain members-only. Ashdale and Prifddinas remain historical pending map projections.

Nine additional specific F2P `Lodestone (spell)` pages independently confirmed the existing typed landing coordinates. None supplied a different adjacent landing tile. Their exact mask coordinates remain blocked for **Al Kharid, Draynor, Edgeville, Falador, Lumbridge, Port Sarim, Taverley, Varrock and Wendlewick**. Wilderness Crater is likewise blocked in the retained exact evidence. City of Um requires an independent interior map selector. **Burthorpe is the sole F2P lodestone with an existing exact component witness.** Game availability and landing geometry are separate: a default or derivable activation cannot manufacture a component witness. The JSON manifest lists each station and reason. No nearest tile, bounding box, perimeter or object-side guess was used.

## Surface destination chunks for rolling

An explicit surface teleport coordinate also supplies independent evidence for its **destination chunk**, even when the cache cannot certify a walkable landing component at that tile. The separate `transport-roll-destinations.automatic-teleports.2026-10-09.v1.json` records **48 global surface destinations, including 26 F2P destinations**. Each entry supplies the unchanged station coordinates, surface map 28 and plane 0, the 64-tile region calculation, pinned Wiki revision, source coordinate hash and source content/file hash. Typed cache entries were checked against their exact struct/param and map projection in the retained read-only travel export. Wiki entries were checked against explicit `Teleport map` coordinates. An object/NPC marker by itself is insufficient.

The active route's `rollDestination` stores this evidence independently from its station's `componentWitness`. For example, Lumbridge Home Teleport has default activation and a verified destination chunk **12850**, while its blocked exact mask tile still supplies no access component. Air, mind and water altar tablets likewise have verified destination chunks despite incompatible mask source planes. Their personal requirements, F2P status, consumable house rule and contrary location evidence must still be checked before rolling. Destination evidence never creates a walkable tile, marks a chunk unlocked, grants its resources, enters a component, connects a partner's map or proves a return journey.

City of Um and the four skull-sceptre floors remain excluded from this surface certificate because their coordinates belong to other maps. War's Retreat and the Runecrafting Guild tablet retain their separate unresolved interior records. No interior was projected onto a surface chunk.

## Reviewed exclusions

Ordinary [Varrock](https://runescape.wiki/w/Varrock_teleport_(item)?oldid=37022376), [Lumbridge](https://runescape.wiki/w/Lumbridge_teleport_(item)?oldid=37016431), [Falador](https://runescape.wiki/w/Falador_teleport_(item)?oldid=37014017) and [Wendlewick](https://runescape.wiki/w/Wendlewick_teleport_(item)?oldid=37200255) tablets are members-only. Their F2P spell versions do not change item membership. Ring of duelling, games necklace, amulet of glory, wicked hood and goblin village sphere also remain members-only. Ring of Luck is F2P but has no teleport option. All their revisions are pinned in the manifest and supplement exclusions.

[House Teleport, revision 37174251](https://runescape.wiki/w/House_Teleport?oldid=37174251) has a members Magic-40 rune version and a free all-spellbook version requiring Construction 50 plus There's No Place Like Home.... The latter infobox says members=No, while the same page still says free players cannot use House Teleport. [Current F2P limits, revision 37175453](https://runescape.wiki/w/Free-to-play?oldid=37175453) cap Construction at 20 since July 2026. Neither conflicting prose nor a former member's high level was used to claim an obtainable F2P route for this duo.

[War's Retreat Teleport, revision 37177732](https://runescape.wiki/w/War's_Retreat_Teleport?oldid=37177732) is F2P, free, and unlocked at War's Wares after ten boss kills. [The retreat, revision 37178109](https://runescape.wiki/w/War's_Retreat?oldid=37178109) admits combat level 60 **or** total level 1,000. Its exact landing (3294,10127) is map 10003 without a certified runtime interior selector, so it is recorded among pending automatic exclusions. The F2P [Runecrafting guild tablet, revision 36904655](https://runescape.wiki/w/Runecrafting_guild_teleport?oldid=36904655) similarly has an exact map-109 landing (1696,5465), but no runtime selector. Neither was assigned a false surface chunk. Seasonal interface buttons and quest-stage/event transport remain outside this bounded persistent catalogue.

## Reproduction and checks

`node scripts/build-automatic-teleport-catalogue.mjs` regenerates only the new combined v2 catalogue from five committed inputs. Historical data and generators are unchanged. New JSON output uses LF; repository input hashes use the existing canonical-LF helper. The new component artifact has seven exact witnesses and three source-plane failures, sampled at the specified Wiki tile from the existing read-only mask.

`node --test tests/automatic-teleport-catalogue.test.mjs` passes **9/9** checks covering deterministic hashes, unchanged manual requirements, spell thresholds/costs/quests, item consumption and acquisition separation, current membership, special activation semantics, exact component offsets/labels, unresolved geometry, independent roll chunks and rejection of wrong chunks/maps/planes/coordinate hashes or unreviewed evidence roles. Parent integration owns engine/UI behavior, copied real-save verification and the full suite; these catalogue checks are evidence tests, not observed gameplay.
