# Divination training coverage

Reviewed **13 October 2026**. This review used the retained picker definitions,
read-only local game-data exports and bounded RuneScape Wiki API reads. It used
synthetic states and made no changes to a gameplay save or the original cache.

## What existed and what was missing

| Source before this change | Existing coverage | Missing coverage |
| --- | --- | --- |
| Retained `challenges.Divination` | 182 tasks, 145 primary flags, including 13 ordinary/Elder wisp harvesting tasks at 13 entry levels | No Colossi task; no stationary/enriched aliases on harvesting tasks; Elder task lacks Fate of the Gods gate |
| Helper F2P catalogue | 1 Divination method, pale harvesting at 1–5; trial cap 5 | No members continuation, higher colonies or Colossi |
| Cache-derived skill guide | 206 Divination entries: 8 free flags, 198 members; all 13 wisp tiers and Colossi at 77 | Metadata did not provide an executable Colossi selector |
| `cache-npcs` | Wisp/spring identities and Harvest actions | Zero verified NPC spawn positions; membership is unknown in these NPC definitions |
| `cache-resources` | General scenery/resources and energy rifts | No harvestable Colossus remnants selector |

These counts come from the [retained definitions](../../rs3-chunkpicker-chunkinfo-export.json),
[F2P methods](../../app/data/training/methods.f2p.json),
[skill guide](../../app/data/skill-guides.2026-10-08.v1.json) and
[NPC metadata](../../app/data/cache-npcs.2026-10-08.v1.json).
Primary flags include recipes, urns and other activities; 145 flags do not
establish 145 renewable, supplied training routes.

The retained wisp inventory has **29 declarations at 16 addresses**, totalling
**119 authored NPC counts**. Twelve standard tiers use 13 numeric addresses,
because Lustrous appears twice. Elder uses two numeric addresses and one named
interior. This is **15 numeric chunks plus one named area**. Colossi adds one
verified surface chunk, **18485**, giving **16 numeric chunks plus one named
area** with reviewed gathering coverage. These are geographic method candidates;
membership, section access, levels and personal quest progress still apply.
Authored NPC counts are not observations of simultaneous live spawns.

## Levels, locations and enrichment

The table combines retained addresses with the Wiki's reviewed colony locations.
Bands indicate the next tier's entry boundary; an earlier colony remains usable
above its band. The 13 tiers have **12 enriched variants**. Pale has none.
Normal wisps become springs, and enriched wisps become enriched springs, at the
same entry level. Rift empowerment triggers enrichment; no fixed spawn interval
or hourly rate is assumed. [Divination rift locations](https://runescape.wiki/w/Template:Divination_rift_locations?oldid=37161450),
[Wisps](https://runescape.wiki/w/Wisps?oldid=37152449),
[Pale wisp](https://runescape.wiki/w/Pale_wisp?oldid=37176223).

| Tier | Entry / next-tier band | Reviewed colony | Retained address | Enriched evidence |
| --- | --- | --- | --- | --- |
| Pale | 1 / 1–9 | South of Draynor jail | 12338-1 | None |
| Flickering | 10 / 10–19 | North of Falador | 11829-1 | [Enriched](https://runescape.wiki/w/Enriched_flickering_wisp?oldid=37176224) |
| Bright | 20 / 20–29 | Between Varrock and Dig Site | 13109-1 | [Enriched](https://runescape.wiki/w/Enriched_bright_wisp?oldid=37176225) |
| Glowing | 30 / 30–39 | Southeast of Seers' Village | 10805 | [Enriched](https://runescape.wiki/w/Enriched_glowing_wisp?oldid=37176226) |
| Sparkling | 40 / 40–49 | Southeast of Rellekka | 11064-1 | [Enriched](https://runescape.wiki/w/Enriched_sparkling_wisp?oldid=37176227) |
| Gleaming | 50 / 50–59 | Northeast of Shilo Village | 11567-1 | [Enriched](https://runescape.wiki/w/Enriched_gleaming_wisp?oldid=37176228) |
| Vibrant | 60 / 60–69 | West of Oo'glog | 9516 | [Enriched](https://runescape.wiki/w/Enriched_vibrant_wisp?oldid=37176229) |
| Lustrous | 70 / 70–74 | East of Slayer Tower | 13879, 15736 | [Enriched](https://runescape.wiki/w/Enriched_lustrous_wisp?oldid=37176230) |
| Elder | 75 / 75–79 | Freneskae Elder Halls, Fate of the Gods completed | 16994, 16999, Freneskae#The Elder Halls | [Enriched](https://runescape.wiki/w/Enriched_elder_wisp?oldid=37176231) |
| Brilliant | 80 / 80–84 | East of Mage Training Arena | 13619-1 | [Enriched](https://runescape.wiki/w/Enriched_brilliant_wisp?oldid=37176232) |
| Radiant | 85 / 85–89 | Dragontooth Island | 15159 | [Enriched](https://runescape.wiki/w/Enriched_radiant_wisp?oldid=37176233) |
| Luminous | 90 / 90–94 | Southern Sophanem | 13097-1 | [Enriched](https://runescape.wiki/w/Enriched_luminous_wisp?oldid=37176234) |
| Incandescent | 95 / 95–99 | South of Poison Waste | 9007 | [Enriched](https://runescape.wiki/w/Enriched_incandescent_wisp?oldid=37176235) |

The numeric Elder addresses preserve the original named-area declarations; this
review does not certify them as ordinary mainland colonies. The explicit Fate
gate prevents those records from bypassing the quest. The retained inventory
lacks enriched Bright at 13109-1. Cache NPC **18154** verifies the identity and
Harvest action, and the Wiki verifies its colony, but neither supplies a precise
cache spawn. The new alias accepts an admitted enriched source without adding
an invented NPC count or position. [Elder wisp](https://runescape.wiki/w/Elder_wisp?oldid=37198568),
[Enriched bright wisp](https://runescape.wiki/w/Enriched_bright_wisp?oldid=37176225).

F2P Divination remains capped at **5**. Pale gathering is the trial route;
higher colonies, enriched higher tiers and Colossi require membership. A free
geographic chunk such as northern Falador does not make its level-10 colony a
free method. [Divination](https://runescape.wiki/w/Divination?oldid=37191076),
[Free-to-play](https://runescape.wiki/w/Free-to-play?oldid=37175453).

## Colossi and the boundary correction

Colossi requires **77 Divination, membership and partial Heralds of Crimson**.
Aurriel supplies the initial memory stone at Divine Fall; players charge it at
Colossus remnants and deliver it to murals. The reviewed pages do not identify
the precise quest stage that enables the activity. Merely accepting Heralds is
therefore insufficient evidence. [Colossi Divination](https://runescape.wiki/w/Colossi_Divination?oldid=37201873),
[Aurriel](https://runescape.wiki/w/Aurriel?oldid=37193382),
[Memory stone](https://runescape.wiki/w/Memory_stone?oldid=37200680),
[Divine Fall](https://runescape.wiki/w/Divine_Fall?oldid=37202105).

The cache has exactly **one** displayed placement of object **140893**,
**Colossus remnants**, in the 4,737,814-row object export. It has Harvest, a 5×5
footprint, rotation 1 and type 11. The displayed anchor is **(4638,3448)** on map
28, plane 0: `floor(4638/64) * 256 + floor(3448/64) = 18485`.
The Wiki gives the same point and object ID. The **18486** Divine Fall label at
(4647,3460) names the place in the adjacent square; it is not the harvest point.
Both squares belong to the 78-square members-start footprint.
[Colossus remnants](https://runescape.wiki/w/Colossus_remnants?oldid=37192074),
[local boundary audit](mapfix3.md), [members-start inventory](members-start.md).

The local source archive is `5/3261`, subfile 0, source (3934,1656), translated
by paste 435 (+704,+1792). Nine footprint-perimeter witnesses attach the resource
to **18485:6**, runtime ID **18485-1000006**. The committed
[cache supplement](../../app/data/cache-divination.2026-10-13.v1.json) retains
the exact placement, witnesses and SHA-256 hashes for the read-only definitions,
placements and component masks. The original exports are under
`C:/Users/User/Projects/chunk-picker-rs3/.local/game-data`; no cache file was
rewritten. Guide struct **37891**, source **22/1184/3**, independently records
level 77, members and Memory stone **63916**. Object **140913**, Exalted colossus
in 18229, is a separate Mining resource and supplies no Divination selector.

## Application and remaining limits

Engine methods are declarative `challenges[skill][label]` records: `Level`,
`Primary`, location selectors (`NPCs`, `Objects`, `Chunks`), optional outputs and
prerequisites. `app/tasks/access.mjs` collects admitted sources, and
`app/tasks/engine.mjs` repeatedly evaluates methods, supplies and reachable
levels. `Not F2P` and the skill cap apply independently. Observed personal levels
and manual training controls enter through `app/core`; a primary flag models
training to the allowed cap rather than observed XP. Helper records instead use
`level`, `maxLevel`, `members` and typed `requirements` checked by
`app/tasks/training-planner.mjs`. The new personal quest-progress requirement
fails closed when completion evidence is absent.

[divination-training.mjs](../../app/data/divination-training.mjs) overlays the
13 existing harvest records without changing their IDs, adds source aliases and
membership/Fate gates, and adds one stable Colossi task. The raw original
definitions stay immutable. The resource supplement uses the existing cache
projection and exact component rules; it creates no walking edge.

[The composed catalogue](../../app/data/training/catalogue.mjs) adds **14 members
method records**: 13 tiers, including pale continuation to 99, and Colossi. With
the existing F2P pale method, it contains **15 Divination records** covering
**14 distinct entry levels**. The current F2P file has 121 total methods; the
composed planner catalogue has 135. Enriched and spring sources are alternatives
within a tier, not duplicate methods. New rates, action XP, quantities and
economics remain unknown. The authenticated `/api/training-catalogue` listing
and death estimator retain the F2P file; training-plan responses and Area check
use the supplement.

Personal partial quest stages are not stored. A personally completed whole quest
can satisfy a progress gate when its completion task exists, as with Fate of the
Gods. **Heralds has no retained Quest completion task today**, so full Heralds
completion cannot currently be imported through the ordinary quest sync. Record
personal completion of the Colossi method once the player has actually used it
to establish that unlock. A partner's completion or a challenge-only tick is
insufficient. No new quest-stage storage or quest walkthrough was added.

For the unchanged synthetic 78-square footprint, Area check now shows **5 → 77**
using the labelled F2P reference, with **Train Colossi Divination** at 77. The
method remains conditional. Its cache-verified presence in a claimed square is
shown even before the eastern route opens; the original missing-object/access
and quest blockers remain visible. This advisory inventory grants neither the
component nor training to the engine. Selecting only the 18486 place marker
does not admit it. Actual grinding and mural deliveries require admitted routes
to their resources and destinations.

The focused tests cover all tiers, enrichment, immutable/custom overlays, the
F2P cap, current-account personal gates, actual component access, the 78-square
Area result, and the neighbouring marker exclusion. Ordinary Draynor F2P
training matches the overlay-disabled engine. Broader members activities,
including Hall of Memories and Arc methods, remain on retained task coverage;
they were not assigned new rate or location evidence in this review.

Verification on 13 October: **964 quick tests passed**. The single locked full
run executed **3,566 tests: 3,558 passed, 7 failed, 1 skipped**. The seven failures
were stale expectations: six prediction hashes gained only
`coverage.supportedFields: PersonalQuestProgress`, and the full catalogue gained
one Colossi task. Removing just that metadata entry reproduces all six prior
complete JSON hashes; `.local/prediction-divination-audit.json` records the
comparison. After updating the expected hashes/count, **all 52 affected tests
passed**, including the 17 new Divination tests. The full suite was not repeated.

The locked desktop 1440×900 and phone 390×844 screenshots render the production
Area table from real read-only API responses with a disposable synthetic state.
They show the conditional 5 → 77 row; they do not exercise rectangle selection
or demonstrate a live character's access. The scratch save, Chrome profile,
server and browser were removed or stopped after capture.
