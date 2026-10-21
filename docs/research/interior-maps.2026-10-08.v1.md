# Copied-cache interior maps

The display catalogue maps **893 of 1,979 non-surface picker records** to **246 cache maps, 263 independently rendered map planes and 1,361 PNG tiles**. The remaining **1,086 records** have explicit unknowns. This includes numeric aliases whose packed numbers overlap the surface grid: `9030` is Burthorpe Mine and `8774` is Burthorpe Slayer Cave because their retained records use `Name`. Surface records use `Nickname`. Of 419 named area records, 164 have rendered mappings. Other off-surface locations are retained in the same census; the count is not a claim that all records are underground dungeons.

The selected assets are the new, immutable directory `C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/interiors.cache-2026-10-08-archmaps-v3`. The root asset manifest was not replaced. Historical v1 output and an interrupted v2 run remain unselected. The [machine-readable review](interior-maps.2026-10-08.v1.json) records exact inputs, generator hashes, all unknowns, sample identities and verification. The [application catalogue](../../app/data/cache-interiors.2026-10-08.v1.json) contains map layers, exact tile hashes and per-area entrance evidence. It has `displayOnly:true` and `accessEffect:"none"`.

## Named samples

| Picker area | Rendered maps / planes | Evidence and limits |
| --- | --- | --- |
| Lumbridge Cellar, numeric alias `13207` | Map 31, planes 0–3 | The reviewed cellar ladder station establishes ordinary Misthalin Underground, rather than a tutorial cellar instance. The [castle revision](https://runescape.wiki/w/Lumbridge_Castle?oldid=37149520) describes the kitchen trapdoor and quest-gated mine tunnel. Map 31 covers a much larger underground layout; no cellar enclosure or mine access is inferred. |
| Lumbridge Catacombs, `15446`, `15957`, `15958` | Map 164 planes 0/1; map 165 plane 0 | [Catacombs revision](https://runescape.wiki/w/Lumbridge_Catacombs?oldid=37109974) confirms the cemetery entrance. [The Blood Pact map](https://runescape.wiki/w/Map%3AThe_Blood_Pact?oldid=35977504) explicitly identifies Upper Level as plane 1. Map 164's encoded world-map pastes contain plane 0 only; plane 1 uses separately reviewed source stair/exit placements and the same XY coverage. Its bounds kind is `reviewed-direct-source-XY-coverage`. |
| Draynor Sewers, `12438`, `12439` | Map 542, plane 0 | [Revision 37110185](https://runescape.wiki/w/Draynor_Sewers?oldid=37110185) describes the west village and jail entrances. Both reviewed route anchors are retained. |
| Edgeville Dungeon and Varrock Sewers | Shared map 592, plane 0 | [Edgeville revision](https://runescape.wiki/w/Edgeville_Dungeon?oldid=37124838) and [Varrock Sewers revision](https://runescape.wiki/w/Varrock_Sewers?oldid=37149521) corroborate separate entrances and the shortcut connection. The shared layout does not merge their access gates. Resource dungeon variants remain separate maps 372, 374 and 380. |
| Ashdale Caves, `15465`, `15466` | Map 665, plane 0 | [Revision 37133024](https://runescape.wiki/w/Ashdale_Caves?oldid=37133024) confirms Smugglers Cove, hidden quest house stairs and the post-quest northwest entrance. Retained entrance declarations remain approximate/unresolved; an exact station pair was not invented. |
| Burthorpe Mine / Slayer Cave, `9030` / `8774` | Map 719, plane 0 | Reviewed transport stations provide current Burthorpe Underground identities and exact source/display translations. The old standalone map 162 has no active static paste layout. |
| Wilderness North Volcano | Surface map 28; no distinct interior verified | [Revision 37133086](https://runescape.wiki/w/Wilderness_North_Volcano?oldid=37133086) describes a stepping stone and ledges on the volcano. Raw/effective shortcut planes do not establish a cave map. |

## Coordinates, rendering and entrances

Coordinates are game tiles: x increases east and y increases north. Map/layer bounds are half-open `[minX,maxX) × [minY,maxY)` rectangles enclosing the exact pasted coverage. PNG rows run north to south. Each 256×256 PNG covers one 64×64 destination square at four pixels per game tile; filenames are `<plane>_<squareX>_<squareY>.png` under `<directory>/<mapId>/2/`.

Map bounds describe rendered layout coverage and may contain holes or unrelated areas. Each area's semantic `bounds` remains null because an authored enclosure was not verified; `layers[].bounds` supplies the exact map coverage. Numeric aliases preserve their original identity instead of claiming that their old coordinates define a current area boundary. Partial 8×8 pastes copy only their exact source cells, source planes and wall anchors into the destination. Unstated cells remain void. Each map plane is rasterised independently, so a lower layer does not bleed into a separate upper-layer image.

The renderer reuses reviewed floor/wall code from pinned rsmv commit `a92b8920b9b9842adde78822646ecad1a6f4fc15`, inferred decoder build 950 and `@resvg/resvg-js` 2.6.2. It opens only copied JS5 databases read-only/query-only, with no original-cache or client access. The existing places extraction was plain-copied into unique scratch before use. Renderer/helper source hashes use Git LF bytes through `scripts/lib/provenance-hash.mjs`; binary files and copied exports use exact bytes. The asset manifest stores source archives and every exact paste transform.

Icons, labels, scenery models and sprites are excluded. Definition-backed shared `#60769a` water and void become colourless transparent pixels. Special-colour water and legitimate black/gray floors remain visible. Flat floor colours, wall lines, missing Java underlay smoothing and absent cross-square wall overdraw share the existing surface renderer's limits.

The catalogue joins **23 reviewed entrance route identities** from the existing transport catalogue. Exact station anchors retain their coordinate evidence, route requirements and revision links. They do not establish exact player landing tiles. `declaredConnections` preserves retained display declarations separately as approximate or unresolved evidence. Neither kind inserts walking edges, changes access, grants ownership or bypasses quest/membership requirements.

## Verification and preview

Independent Pillow verification checked all **1,361 PNGs** for SHA-256, byte length, 256×256 RGBA dimensions, colourless transparent pixels and exact agreement between alpha counts and definition-backed coverage. It found zero errors, **274 fully transparent tiles**, **47,167,690 transparent pixels** and **21,720,151 PNG bytes**. The selected manifest SHA-256 is `18aa59bdec93255fe4ed83d9ed6e930e60f80cc67329495801d17abcb1a7b564`.

The [sample contact sheet](C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/samples.v3.png) was visually inspected: upper/lower catacombs have distinct floor plans, the Draynor bend and northern room are intact, Edgeville/Varrock share their connected layout, Ashdale retains its cove floor shapes, and Burthorpe retains separate cave layouts. No baked labels or icons appear. This is an agent inspection of generated cache artwork, not an observed in-game visit.

`node --test tests/interior-maps.test.mjs` passes seven tests: complete explicit area coverage and current LF provenance, named/numeric identities, independent planes and north-up coordinates, unsafe tile/path rejection, exact partial-paste/source-plane transforms, ambiguous-name unknowns and an actual task-engine preview.

`scripts/preview-interior-maps.mjs --state <copied-state.json> [--json]` uses `readStateCopy`, rejects `.local/duo` and evaluates the existing task engine before joining display mappings. It never changes definitions, access rules, task records or availability. With the synthetic transport fixture, Player 1 has one accessible named area (Lumbridge Cellar), mapped to map 31; Player 2 has none. Available task rows remain 165 and 10, respectively, with zero task/availability changes. These are fixture results, not current personal-state claims.

## Reproduction and application hooks

```powershell
node --max-old-space-size=768 scripts/render-cache-interiors.mjs --places C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/places.2026-10-08.v3.copy.json --output C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/interiors.cache-NEW-VERSION --catalogue C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/cache-interiors.NEW.json
node scripts/cache/interior-review.mjs C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/cache-interiors.NEW.json
python scripts/cache/interior-verification.py --assets C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --manifest C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/interiors.cache-NEW-VERSION/manifest.json --output C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/verification.NEW.json --samples C:/Users/User/Projects/rs3-cache-work/archmaps-interiors/samples.NEW.png
```

Rendering refuses an existing version directory and existing catalogue output. Review enrichment writes only the worker-owned new catalogue, with its own LF source hash and pinned Wiki sample hashes. It does not alter the immutable assets or their manifest.

`app/data/cache-interiors.mjs` exports `CACHE_INTERIORS`. `app/core/interior-maps.mjs` exports `buildInteriorMapIndex`, `getInteriorArea`, `getInteriorMap`, `getInteriorTile`, `getInteriorEntrances` and `interiorTileAddress`. `getInteriorArea(index, exactPickerId)` returns the retained area plus complete rendered map/layer rows. Asset selection must verify `assets.manifestSha256`, then allow only the catalogue's exact tile path/byte/hash entries through a contained-file check. These hooks are display metadata; no access evaluator imports them.
