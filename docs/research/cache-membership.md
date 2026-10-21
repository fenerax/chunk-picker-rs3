# RS3 cache membership and picker baseline

Checked 7 October 2026 in the isolated `codex/cache` worktree. This is a read-only code/data audit plus this report; it does not change gameplay, the retained export, the client cache, or a running picker. Decoded-cache observations belong in the companion mining report; this report establishes what those observations may mean.

## Recommendation

Extract the terrain file's **eight-byte geographic membership mask**, separately from terrain collision and object definitions. After calibration, it can describe F2P classification at **8×8-tile subarea resolution**. Join it to the actually traversable component and qualifying boundary tile before proposing a picker correction. A free bit covering ocean or an inaccessible fragment does not establish a free walkable destination.

Keep the raw mask, cache/build identity, byte offset, decoding convention and calibration evidence. Do not promote a region from its nickname, visible land, object count, or an object's `is_members`/`isMembers` flag. A geographically free place can contain members-only interactions. Quest, skill, transport and personal progression gates remain separate facts.

## Geographic mask evidence

The pinned [rsmv terrain schema](https://github.com/skillbert/rsmv/blob/a92b8920b9b9842adde78822646ecad1a6f4fc15/src/opcodes/mapsquare_tiles.jsonc#L16) decodes `nonmembarea` as eight raw bytes for builds ≥765, after 16,384 terrain entries. Its comment specifies one bit per 8×8 subarea, starting southwest, proceeding north, then east. The mask has no plane field. The same schema changes terrain heights and adds a `jagx` header at build 936; reading the correct offset requires the cache's build-dependent parser.

An independent implementation, [rs3cache mapsquares](https://github.com/mejrs/rs3cache/blob/d96a12b06b775a1a9461f357a45b5349d5c59073/src/definitions/mapsquares.rs#L174), reads a `u64` immediately after `Tile::dump` and stores it as `MapSquare.members`. That confirms a distinct geographic mask. Its variable name differs from rsmv's, so the name alone cannot establish bit polarity. Neither inspected implementation contains an individual-bit lookup demonstrating which bit of each byte is the southernmost subarea. An integer's byte order and geographic bit order are different questions.

Code inspection alone did not establish polarity or within-byte bit order. A subsequent read-only decode of the isolated cache copy and current Wiki API coordinates supports **1=free; byte index=floor(localX/8); bit index=floor(localY/8), with the least significant bit south**. The [helper](../../scripts/cache/membership.mjs) implements this convention and preserves missing masks as unknown. This remains a client-cache geographic classification; it does not certify current server-exact gates.

### Independent copied-cache calibration

The pinned external opcode interpreter decoded map index 5, archive `128*regionY+regionX`, subfile 3, using schema build 950. These reads used the isolated `rs3-cache-work/cache-copy`, never the live client cache. Wiki coordinates and membership were fetched directly through `api.php?action=parse&prop=wikitext|revid`; saved response snapshots are in the audit's own scratch folder. They are independent of picker nicknames and flags.

| Calibration | Fresh Wiki evidence | Decoded observation / implication |
|---|---|---|
| Lumbridge | [Revision 37148560](https://runescape.wiki/w/Lumbridge?oldid=37148560): members=No; map (3200,3215) | Source square (50,50), mask `ffffffffffffffff`. The known free point is set. |
| Canifis | [Revision 37124299](https://runescape.wiki/w/Canifis?oldid=37124299): members=Yes; map (3496,3488) | (54,54), mask `0000000000000000`. The known members point is clear, supporting 1=free. |
| Shantay Pass free side | [Revision 37130849](https://runescape.wiki/w/Shantay_Pass?oldid=37130849): members=No; map (3305,3123) | (51,48), mask `008080e0e0e0e000`; local (41,51) → byte 5, bit 6 → free. Reversing bits within a byte would wrongly classify this known free point. |
| Shantay southern desert | [Gate revision 36272153](https://runescape.wiki/w/Shantay_Pass_(gate)?oldid=36272153): gate at Y3116 and southern desert members-only; [rug merchant revision 37130854](https://runescape.wiki/w/Rug_merchant?oldid=37130854): southern map point (3311,3109) | Local (47,37) → byte 5, bit 4 → members. Swapping X and Y would test byte 4, bit 5 and incorrectly mark this southern point free. This disambiguates the axes. |
| Paterdomus cross-check | [Revision 37109872](https://runescape.wiki/w/Paterdomus?oldid=37109872): members=No; map (3411,3492) | (53,54), mask `3f7f7f3e1c000000`; local (19,36) → byte 2, bit 4 → free. Clear eastern columns match the documented Morytania border context; precise crossing remains conditional. |

The competing MSB-first and transposed interpretations fail the Shantay calibration. Full-square translations preserve local X/Y positions; imports must apply the source-to-display layout before assigning a picker ID.

**Granularity matters:** at Shantay, byte 5's free bands begin at Y3112, while the documented gate is at Y3116. [Irena revision 37129113](https://runescape.wiki/w/Irena?oldid=37129113) places her at (3303,3113), inside that free-marked 8×8 band and south of the gate. An NPC's membership requirement does not classify her tile, but the difference between the subarea grid and gate coordinates demonstrates why the mask cannot be treated as an exact pass-through rule.

The pinned [object/location schema](https://github.com/skillbert/rsmv/blob/a92b8920b9b9842adde78822646ecad1a6f4fc15/src/opcodes/locs.jsonc#L83) exposes boolean flags `is_members` (0x58) and `isMembers` (0x5B), plus string actions `members_action_1` through `members_action_5` (0x96–0x9A). Its movement-related fields and varbit/varp morphs are separate. These are properties of a location definition and its interactions. A shared definition can have many placements; doors and other morphs also depend on personal state.

The pinned [NPC schema](https://github.com/skillbert/rsmv/blob/a92b8920b9b9842adde78822646ecad1a6f4fc15/src/opcodes/npcs.jsonc#L75) exposes string actions `members_actions_0` through `members_actions_4` at 0x96–0x9A. These may identify members interaction choices on the NPC definition. Neither location membership flags nor location/NPC members action strings classify a map, tile or geographic section. Only the separately calibrated terrain `nonmembarea` mask supplies the 8×8 geographic evidence discussed here, subject to its access and granularity limits.

## Picker semantics at the inspected snapshot

The [reference adapter](../../app/data/world.mjs) receives the retained `rs3-chunkpicker-chunkinfo-export.json`. [The server](../../app/server.mjs) parses that file, builds the world, and passes the declarative definitions to the authored task engine. Upstream executable JavaScript is not imported. The raw export's SHA-256 is `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`; its [upstream provenance](https://github.com/source-chunk/chunk-picker-rs3/blob/98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0/rs3-chunkpicker-chunkinfo-export.json) is version 6.9.68.

`buildWorld` applies [authored map corrections](../../app/data/map-corrections.mjs) first, without mutating the export. It indexes numeric chunk records separately from named interiors, trims and deduplicates list IDs, and drops list references without numeric definitions. `world.walkable` is the normalized `walkableChunks` set, with valid F2P-only entries also admitted. `world.f2p` is the normalized `walkableChunksF2P` set. Neither is a cache collision measurement. At this snapshot the effective sets have **576 walkable IDs, 167 F2P IDs and 569 topology bases**; the earlier map-data audit predates the overlay and reports different counts.

`world.surface` is the defined numeric records inside the 47×50 picker crop. `world.neighbors` contains only defined orthogonal grid neighbors, regardless of walkability. Picker ID `r` has southwest tile `(64*floor(r/256), 64*(r mod 256))`, with a 64×64 tile extent. Modern RS3 map archive IDs use another packing: the inspected [rs3cache decoder](https://github.com/mejrs/rs3cache/blob/d96a12b06b775a1a9461f357a45b5349d5c59073/src/definitions/mapsquares.rs#L174) unpacks X from the low seven bits and Y from the remaining high bits. Convert through coordinates; never submit a picker ID directly as an RS3 archive ID.

`sectionTopology[base][section]` lists **entry dependencies**: an accessible listed source admits the destination section. It is not a polygon or raster. A suffixed source requires that specific component; a bare source can mean an unsplit section-0 base, or an abbreviated split source. Unlocking a split base does not seed all its components. Section 0 is whole-base adjacency and is not returned as a reached nonzero section.

The current [roll rules](../../app/core/rules.mjs) require a dependency from the particular orthogonal neighbor and a [walking boundary](../../app/core/map-boundaries.mjs); explicitly typed transport/unresolved edges cannot act as walking. Accessible mode uses topology instead of the `walkable` generation filter. Frontier mode uses geometry and the walkable filter. Generated F2P candidates require base F2P=true and, for explicitly mixed bases, a qualifying destination section explicitly marked free. Selected candidates bypass those generation filters; teleport eligibility does not prove a free landing component in a mixed base.

`sectionMembership` is an authored policy map, not inferred from cache bits. Where that map exists, an unlisted section is not considered free by `sectionIsFree`; otherwise the base F2P flag is the fallback. `chunks[id].Sections` stores section contents, while `Connect` records and connector tasks provide a separate task/interior access graph. [Task access](../../app/tasks/access.mjs) has personal gates and source restrictions, but its inspected traversal does not directly consult `sectionMembership`; the corrected roll filter alone is not proof that all member-section sources are excluded from tasks.

## Named baseline regions

Every row below was parsed from the local raw export and the current `buildWorld` result. `W/F` are picker policy booleans. Coordinates are southwest tiles; add 63 to each coordinate for inclusive bounds. Geographic component labels follow the earlier [map-data audit](map-data-audit.md) and remain inferences rather than observed movement.

| ID / retained nickname | Southwest tile | Raw → effective W/F | Exact effective entry dependencies and policy |
|---|---|---|---|
| **12592 Temple of Amascut** | (3136,3072) | true/true → true/true | `0 ← 12848`. No section records or authored mixed-membership policy. The nickname does not prove this entire region free or members. This is a priority mask/collision calibration case. |
| **12080 Mudskipper Corner** | (3008,3072) | true/true → true/true | `0 ← 11824,12081-1`. Keep the tiny usable coast eligible if a qualifying free tile exists; no minimum-area rule applies. The earlier audit did not count exact collision tiles. |
| **11569 Musa Point** | (2880,3136) | true/true → true/true | `1 ← 11825-2,11313`; `2 ← 11570,11825-1`. Section 1 is the inferred island component; 2 the mainland sliver. Owning section 2 does not give entry into 1. |
| **11314 South Crandor** | (2816,3200) | true/true → true/true | `1 ← 11315`; `2 ← 11315`; `3 ← 11313`. Sections 1/2 are inferred Crandor components; 3 a Karamja fragment. No internal 3→1/2 walking link is declared. |
| **11315 North Crandor** | (2816,3264) | true/true → true/true | Effective `0 ← 11314-1,11314-2,11059-2`. The overlay adds `11059-2` to the raw two dependencies. It supplies no Fishing Platform section-1 route. |
| **11059 Fishing Platform** | (2752,3264) | true/false → true/false | `1 ← []`; `2 ← 11315`. Platform and inferred western Crandor fragment are distinct. F2P=false currently applies to the whole base; current free-mask overlap with reachable land needs checking. |
| **11825 Port Sarim Church** | (2944,3136) | true/true → true/true | `1 ← 11826,12081-1,11824,11569-2`; `2 ← 11569-1`. Mainland and Karamja pier do not connect internally. This is not the main Port Sarim region 12082. |
| **17460 Bridge to Amberfell** | (4352,3328) | true/true → true/true | `1 ← 17461-5,17461-6,17716`; `2 ← 17204,17459-1`; `3 ← 17204`. Authored free policy: 1=false, 2/3=true. |
| **17461 Waterfall Pathway** | (4352,3392) | true/true → true/true | `1 ← 17205-1,17462`; `2/3 ← 17205-1`; `4 ← 17717-1,17717-2`; `5 ← 17717-1,17460-1`; `6 ← 17460-1`. Authored free policy: 1/2/3=true, 4/5/6=false. |

The baseline is suitable for comparing decoded cache data; it is not an instruction to change these values.

Additional directly decoded **source-square** masks: region 12592/(49,48) is `0000000000000000`; 11314/(44,50) is `ffffffffffffffff`; 11315/(44,51) is `3f3f7f7f7f7f7f7f`; 11059/(43,51) is `0000000000000000`; 11568/(45,48), immediately south of Musa Point's baseline, is `0000000000808080`; 12080/(47,48) is `f8f8f8f8f8f8f8f8`. These are raw geographic-mask observations before joining collision and map pastes. In particular, North Crandor includes clear northern mask bands and Fishing Platform's source square is entirely clear; aggregate walkable-component membership belongs in the generated mining output.

Region 12592's all-clear mask is a direct conflict candidate for its current F2P policy. The freshly fetched [Temple of Amascut revision 37133221](https://runescape.wiki/w/Temple_of_Amascut?oldid=37133221) says members=Yes but locates the temple at (3206,3082), which calculates to **12848**, not the picker nickname's 12592. Thus the named temple corroborates members desert context but cannot independently label every tile in 12592. Verify the surface transform and collision component before proposing the exact policy correction.

## Regional evidence and limits

[Jagex's Amberfell release](https://secure.runescape.com/m=news/uncover-the-secrets-of-amberfell) describes the damaged bridge east of Wendlewick and explicitly identifies Secrets of Amberfell as a members quest. This supports a conditional members route; it does not itself assign picker section numbers or prove the precise membership boundary.

The previous audit used [Musa Point](https://runescape.wiki/w/Musa_Point), [Crandor](https://runescape.wiki/w/Crandor#Trivia), [Fishing Platform](https://runescape.wiki/w/Fishing_Platform), [Mudskipper Point](https://runescape.wiki/w/Mudskipper_Point), [Havenhythe](https://runescape.wiki/w/Havenhythe) and [Amberfell bridge](https://runescape.wiki/w/Bridge_(Amberfell)) for regional context. Browser-style Wiki refreshes were blocked; the direct Wiki API succeeded later. Fresh [Crandor revision 37148489](https://runescape.wiki/w/Crandor?oldid=37148489) explicitly confirms that some western island tiles are inaccessible in F2P; [Musa Point revision 37189045](https://runescape.wiki/w/Musa_Point?oldid=37189045) confirms the free ship route and conditional Crandor dungeon access; [Mudskipper revision 37127296](https://runescape.wiki/w/Mudskipper_Point?oldid=37127296) marks the location free at map point (2994,3116). Exact current tile/section correspondence remains unverified by character movement.

Cache geography can improve membership and terrain evidence, but the mask's 8×8 units are **not the picker's hand-authored sections**. A section may overlap several subareas, including free/member bits, water and blocked terrain. Establish collision components and compare actual qualifying tiles. Preserve unknown status for missing or uncalibrated masks; do not treat parse failure as members-only, or absent mask data as free.

Before applying an import, verify the mask convention at representative mixed boundaries, distinguish source and displayed world-map coordinates, join the same cache snapshot's terrain and objects, preserve one-tile components, and retain conditional routes as separate records. No cache mask can by itself establish Player 1's unlocked ownership, personal quest completion, return route or house-rule permission.

## Generated analysis contract and checks

`analyzeMembership(analysis, squares, comparison, {world})` counts free/member/unknown bits only at the closed collision graph's labeled walkable tiles. It emits region and component classifications, source provenance and raw mask hex; compares the existence of a free walkable tile with effective base F2P policy; and reports every authored section membership policy against provisional neighbor-signature component matches. Ambiguous, incomplete or mixed section matches remain review evidence. A homogeneous section-policy conflict also requires every matched component's collision region to have fully decoded coverage; partial coverage stays unresolved even when every observed tile has the same mask value. The helper does not equate cache component numbers with legacy section IDs, and does not change any picker policy.

Focused [membership tests](../../tests/cache-membership.test.mjs) verify independent calibration points, axis/bit orientation, 8×8 boundaries, unknown/malformed input, collision-only counting, exhaustive discrepancy lists and ambiguous section handling. The test masks are observed snapshot values; they are fixtures, not live-game movement tests.

## Final v4 output observations

The generated `C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/membership.v1.json` was inspected after it appeared; its inspected SHA-256 is `972366f985be500c96c432246e18b79d6d9b56568ea74c7889c2189ab8d65173`. These values join calibrated source masks, map-28 full-square translations and the importer's conservative closed collision scenario. They are advisory observations, not gameplay changes or character movement validation.

| Displayed picker region | Actual cache source square | Mask | Walkable mask classification |
|---|---|---|---|
| **12592 Temple of Amascut** | (49,48), plane 0 | `0000000000000000` | One component, **39 members-marked tiles, zero free**. Fully decoded coverage. Conflicts with the effective base F2P=true policy; the retained nickname is also inconsistent with the Wiki temple coordinate's region 12848. |
| **12848 Kalphite Hive** | (50,48), plane 0 | `0000000000000000` | One component, **2,917 members-marked tiles, zero free**. Agrees with effective F2P=false. The Wiki temple coordinate lies in this region. |
| **17460 Bridge to Amberfell** | **(57,24)**, plane 0 → displayed (68,52) | `6f0f070000000000` | Six components, **425 free / 1,075 members tiles**. Base F2P=true remains supported by actual free walkable terrain. |
| **17461 Waterfall Pathway** | **(57,25)**, plane 0 → displayed (68,53) | `ffffff0000000000` | Eighteen components, **410 free / 1,224 members tiles**. Base F2P=true remains supported; one 140-tile component itself crosses mask classes (**8 free / 132 members**). |

This verifies why looking for Havenhythe at raw archives (68,52)/(68,53) would miss its source data: the map layout translates those source squares into the picker's displayed coordinates.

Provisional neighbor-signature matches support 17460's authored section-1 members policy and section-2 free policy; section 3 has three candidate components, all free, so its precise correspondence remains ambiguous. For 17461, the single best candidates support section 1 free and section 5 members. Sections 2/3 have several all-free candidates; section 4 has several members candidates. Section 6 is ambiguous between a members component and the mixed component noted above. Do not use the mixed candidate's eight free tiles to remove section 6's members gate without establishing its actual legacy section geometry and route.

Across the generated crop the file records **391,366 free-marked and 913,784 members-marked conservative walkable tiles**. Its discrepancy lists contain one F2P base without a free walkable tile, four bases with free walkable tiles outside the F2P set, one provisional section-policy conflict and sixteen unresolved authored section policies. These counts are review inventory; they do not independently justify wholesale picker corrections.
