# Cache place names and travel

This advisory extraction contains 771 map definitions, 5,837 map elements, 2,742 explicit label placements and 2,604 placements accepted by exact map pastes. Map 28, plane 0 has **312 text labels anchored in 262 regions**. The full files are in `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3`; [the versioned review](cache-game-data-places.2026-10-08.v1.json) contains source hashes, archive hashes, output hashes, samples and validation.

## Available fields and interpretation

Map elements provide text, category, sprites, polygons and conditional varbit/varp selectors. Map-zone definitions provide names, centres and source/display bounds; map pastes provide exact square or 8×8 translations between source and display coordinates. Explicit placements are decoded from JS5 major 42. Legacy default branches and toggle conditions are retained. A label is an anchor, not a polygon enclosing the place or a replacement for an authored section name. Object-derived facility markers are covered by the object extraction and existing pin audit.

Struct params explicitly typed `coordgrid` yield **987 coordinate-bearing structs**. Of these, **180** contain travel, teleport or lodestone text. The data preserves these as candidates, with all raw params and exact map projections. A typed coordinate by itself does not establish a teleport destination. **147 enums** have coordinate keys or values; their typed rows are retained without asserting that every row is travel.

Ability-style structs carry a name at param 2794, description at 2795 and typed coordinate at 2941. Text and spot checks support interpreting lodestone coordinates as destinations. **58 structs cover 29 distinct lodestone names**, including City of Um. Param 2809 is retained as candidate membership metadata. City of Um has otherwise comparable records with values 0 and 1; neither is silently discarded. Rune cost, activation, personal unlocks, quest conditions, cooldowns and house-rule permission are separate facts.

## Manual samples and Wiki checks

| Cache record | Decoded coordinate | Fresh Wiki check | Result |
| --- | --- | --- | --- |
| Lumbridge label 82 | Map 28, (3227,3242), region 12850 | [Lumbridge, revision 37148560](https://runescape.wiki/w/Lumbridge?oldid=37148560) | Name and regional context agree. Label and town-centre coordinates describe different anchors. |
| Lumbridge lodestone struct 24278 | (3233,3222), plane 0, region 12850 | [Revision 37110013](https://runescape.wiki/w/Lumbridge_lodestone?oldid=37110013) | Free flag agrees; Wiki scenery anchor (3232,3221) is adjacent. |
| Varrock lodestone struct 24302 | (3214,3377), plane 0, region 12852 | [Revision 37108403](https://runescape.wiki/w/Varrock_lodestone?oldid=37108403) | Free flag agrees; scenery anchor (3213,3376) is adjacent. |
| Wendlewick lodestone struct 53005 | Source (3461,1520) → surface (4165,3312), region 16691 | [Revision 37193342](https://runescape.wiki/w/Wendlewick_lodestone?oldid=37193342) | Free flag agrees; scenery anchor (4164,3311) supports the translation. |
| City of Um lodestone struct 48292 | Source (1083,1768), plane 1; map 742 projects it to display plane 0 | [Revision 36921071](https://runescape.wiki/w/City_of_Um_lodestone?oldid=36921071) | Coordinate and source plane agree exactly. The Wiki marks it free; cache membership variants disagree. |
| Anachronia lodestone struct 24324 | Source (5431,2339) → surface (3895,4259), region 15426 | [Revision 37122513](https://runescape.wiki/w/Anachronia_lodestone?oldid=37122513) | Members flag agrees; scenery anchor (3894,4258) supports the displayed region. |
| Varrock Teleport struct 14753 | (3212,3434), plane 0, region 12853 | [Revision 37182128](https://runescape.wiki/w/Varrock_Teleport?oldid=37182128) | Wiki spell ID matches 14753; destination text names Varrock. Exact landing geometry remains a cache observation. |

Five lodestone membership checks agree for the selected records; one coordinate is exact and four are adjacent to Wiki scenery anchors. These are bounded metadata and location checks, not gameplay teleport tests. Full Wiki responses remain in scratch `place-wiki-2026-10-08.v1.json`; the committed review stores facts and revision links.

## Retained comparison and replacement estimate

All **28** rows in `app/data/lodestones.mjs` have matching cache names. **25** project into the retained base chunk. The comparison retains every variant and does not validate authored section suffixes.

* **Anachronia:** retained 15683 differs from cache/Wiki-supported surface 15426. Propose reviewing this destination in a separate integration task.
* **Ashdale and Prifddinas:** named coordinates exist, but their encoded planes do not project through the map-28 plane-0 paste table. Keep the missing surface projection explicit; do not force the plane to zero.
* **City of Um:** supplies an additional underground destination omitted by the retained surface-only table. Review its personal activation and source-map policy separately.

The cache can provide exact coordinate evidence for all 29 named destinations and corroborates 25/28 retained surface base locations. It can assist names in 262 surface regions, but automatic replacement of all nicknames or section labels would overstate anchor coverage. Regional labels can name a town spanning several chunks, and several labels can occur in one chunk. Generic coordinate structs and enums require a semantic mapping before becoming user-facing travel choices.

## Reproduction

```powershell
node scripts/cache/game-data-places.mjs --workspace C:/Users/User/Projects/rs3-cache-work --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-NEW-VERSION
node scripts/cache/report-game-data-places.mjs --input C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-NEW-VERSION --wiki C:/Users/User/Projects/rs3-cache-work/place-wiki-2026-10-08.v1.json --output C:/Users/User/Projects/rs3-cache-work/NEW-PLACE-REVIEW.json
```

The report command refuses to overwrite its output; `--output` selects a new review filename. Extraction verifies the pinned rsmv commit, decodes schema build 950, opens copied databases read-only and records all archive hashes. Schema 950 is inferred compatibility, not a verified live client build. No application files consume these outputs.
