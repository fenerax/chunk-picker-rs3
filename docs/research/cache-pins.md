# Offline cache surface pins

This exporter is an operator research tool for the copied local cache. It does not change the running picker, its selected private assets, either player's chunk access, or browser preferences. Cache files stay outside the repository. The external decoder is pinned to [rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15); no dependency installation, npm script, full renderer, game client, or live downloader is required.

## Surface identity and transforms

`scripts/cache/surface.mjs` decodes index 23/archive 0/subfile 28 for the identity **RuneScape Surface**, internal name `main`, and archive 1/subfile 28 for exact pastes. It does not infer surface membership from coordinate bounds or downloaded terrain coverage. The zone rectangles are retained as provenance, rather than used to fill holes in the paste list.

The copied map-28 layout contains 1,231 square records, no 8×8 chunk records, and declared dimensions 47×50. Two square records have `n_planes=0`; they are recorded as disabled, not assigned a guessed source plane. The remaining 1,229 records produce **78,656 destination 8×8 blocks** on plane 0. Their **74,944 distinct source blocks** differ because some source areas are deliberately pasted more than once. There are no overlapping destination blocks in this copy. An overlapping future layout stops with an error rather than silently choosing record order.

Each destination block retains source tile origin and plane, destination tile origin and plane, exact translation, paste kind/index, and the original paste fields. The modern index-5 archive address is `regionY*128+regionX`. The picker's chunk identifier remains `regionX*256+regionY`; these encodings must not be interchanged.

Observed transform examples:

| Destination surface tile | Source tile | Evidence |
| --- | --- | --- |
| 3215 / 3257 / plane 0 | 3215 / 3257 / plane 0 | Lumbridge identity paste |
| 4100 / 1500 / plane 0 | 2116 / 11164 / plane 0 | Exact surface paste translation +1984 / −9664 |

`loadSurfaceLayout(cache)` returns `blocks`, a Map keyed as `plane:blockX:blockY`, where block coordinates are tile origins divided by eight. `sourceBlocks` maps each source block to all of its destination copies. `surfaceToSource()` returns one mapping or null; `sourceToSurface()` returns all applicable destination copies. Missing blocks have no fallback mapping.

## Pin extraction and conditional records

`exportPins(cache, options)` joins explicit index-42/map-28 placements, index-2/archive-36 map-element definitions, index-5/subfile-0 object placements, and index-16 object definitions. `extractSurfacePins({cache, layout, locDefinitions, squares, crop, progress})` accepts definitions and decoded source squares already read by the collision exporter. It also works by reading the copies directly when those optional inputs are omitted.

The output includes text-only explicit labels with `spriteId:null`. Object and explicit records retain separate stable identities; the exporter does not suppress one source merely because another has the same position and sprite. IDs hash source placement identity and its display copy. Repeated identical placements carry an ordinal assigned within their source region. An ID identifies the placement, not a specific current-player quest or teleport state.

Map elements retain their numeric category, text, sprite/background/hover IDs and full decoded definition. Text is stripped of client markup and has `labelOrigin:"cache-map-element-text"`; absent element text remains empty rather than receiving an invented location name. Object names are available separately as `objectName`.

Object morph defaults reproduce the pinned renderer's selection: the first option for `morphs_1`, and `unk2` for `morphs_2`, including their newer varbit-width forms. Defaults resolve recursively, with inherited parent fields preserved. A definition cycle or missing referenced definition stops extraction. Every encoded conditional object branch is retained with its varbit/varp selector path. Branches without a default map element remain in the exclusion evidence, including their object placements, rather than being described as active pins.

Map-element legacy switches select their encoded `default_ref`, and retain the `legacy_ref` definition. Visibility toggles and uninterpreted element settings remain in `conditions`. Explicit placement condition flags remain in the source and `placementConditional`. No current-player variable values are read. These records are possible default/conditional placements, **not a count of icons simultaneously visible to either player**.

Objects use the pinned renderer's decoded bridge rule: a bridge flag on plane 1 lowers the effective icon plane by one. NXT flags are read from the `(localX+1)*66+localY+1` interior; older tile settings use `plane*4096+localX*64+localY`. NXT flags take precedence where present. Raw source plane, effective plane, bridge flags, and own-tile flags remain in `planeProjection`. Forced-draw visual flags are preserved; they do not by themselves move an upper-floor object icon to plane 0. The precise plane rule is a renderer reproduction, not an observed game-client comparison.

The **7 October 2026 v4 final advisory export**, including bridge projection, produced **2,994 records**: **1,261 explicit and 1,733 object placements**, including **311 text-only labels**, **148 distinct primary sprites**, and 1,832 retained alternate-element records. It read 1,153 source regions and 31,643 distinct placed object IDs; no required location archive or explicit placement archive was missing. There are 270 exclusion evidence records. These measured figures come from `outputs/cache-audit-2026-10-07-v4/pins.cache-v1.json` in the external scratch directory and supersede the initial extraction probe.

The final v4 export passed all offline landmark and route checks. Its collision, membership and pin outputs reproduce v3 exactly; correcting the validator’s omitted claimed region did not alter data. See [cache-walkability.md](cache-walkability.md) for the checks and limitations.

## Sprite export

`exportPinSprites(cache, pinResult)` reads only referenced index-8 sprite files, including backgrounds, hovers and retained alternates. It returns PNG buffers to its caller; it does not choose or write an asset destination. `decodeSpriteFrames()` handles the paletted format's transpose and alpha flags, plus the RGB format and independent alpha payload. `rgbaPng()` writes ordinary RGBA PNGs using built-in zlib and CRC32.

The v4 export decoded all **291 requested sprite IDs**, one frame each, with **zero missing sprite files**. Its 291 PNG payloads total **175,313 bytes**, as recorded in `sprites-manifest.v1.json`. The set includes primary, background, hover and alternate sprites. The current Lumbridge bank icon is sprite **22458**, 23×23 pixels, with zero trim offset. Its map-element chain is 560 → 2342. The 2021 snapshot used sprite 18952 at the same coordinate; default icon artwork changes must not be mistaken for a moved facility.

Frame PNGs have cropped dimensions. Each frame keeps `x`, `y`, `fullwidth` and `fullheight`, so a future renderer can reconstruct the original canvas/anchor. Empty frames have a null PNG and explicit zero dimensions. The exporter does not translate numeric categories into human legend names, replace existing category mappings, or claim redistribution rights for cache artwork.

## Reconstructed 2021 comparison

The running app's baseline endpoint returned HTTP 401, and the main checkout/private assets were not read. The comparison baseline was reconstructed from the three public source files at [mejrs/data_rs3 b8424a43](https://github.com/mejrs/data_rs3/tree/b8424a43d8370adc71de53f7d6438ad0f77d0944), using the existing worktree's `normalizePins()` and the 151 source indices documented in [the exclusion audit](map-pin-exclusions.md).

Synthetic complete terrain coverage initially yielded 2,205 normalized placements. Removing those 151 documented surface-unverified indices reproduced **2,054 displayed placements and 2,803 excluded source rows**. This reproduces the recorded membership/count; it is not byte-for-byte verification of the unread live baseline, and its terrain-status metadata is synthetic. The scratch `pins-2021-baseline.json` SHA-256 is:

```text
dcdfe0bace8a5a008b18fa1957401ef995b7fdef9ce3cfa4b2e5df24cd7e6407
```

To reproduce the placement set, download `original_sprite_locations.json`, `map_labels.json` and `map_label_locations.json` from that pinned commit into scratch with `-2021.json` filename suffixes. Then run `node scripts/cache/reconstruct-baseline.mjs C:/Users/User/Projects/rs3-cache-work C:/Users/User/Projects/rs3-cache-work/NEW-baseline.json`. The helper records input hashes, parses the existing exclusion audit, refuses an existing output and checks the documented counts. Its 2,054 pin records were compared field for field with the audit baseline and match exactly; reconstruction metadata and exclusion-evidence metadata differ explicitly.

`comparePins(current, baseline)` / `comparePinSnapshots()` first matches numeric category at the same display coordinate, map and plane. This separates changed icon artwork from changed facility coordinates. For the old normalized format, the numeric category is read from preserved `conditions.icon.unk_19` or `conditions.properties.unk_19`, rather than its authored string `categoryId`. `spriteStyleChangeCount` and `spriteChangesAtSameCoordinateAndNumericCategory` record changed sprite-ID sets at matched positions; `exactSpriteComparison` separately retains the original coordinate/current-sprite comparison.

Unmatched category positions can become **unverified move candidates** through either a specific label/object identity unique across both entire map/plane snapshots, or a mutually unique nearest same-numeric-category position within 64 tiles. Category fallback labels such as “Bank” cannot supply strong identity. Equal nearest distances and conflicting identity matches remain unmatched. Every candidate retains old/new coordinates, displacement and distance, matching evidence, `verified:false`, and explicit uncertainty reasons. Nearest facilities can be unrelated; these candidate pairs do not establish actual moves. The verified move count is always zero.

Top-level `added` and `removed` list unmatched category-position groups after candidate pairing, while `movedCandidates` (also `moved`) lists those heuristic pairs. Inclusive `semanticAdded` and `semanticRemoved` preserve every observed category/coordinate difference before pairing. These are grouped placement counts, not source-row counts or proven game additions/removals. The source dates, paste transforms, surface evidence and default icon style differ. No comparison applies old hidden-pin preferences to new IDs. Current primary sprite/default selection and retained alternate definitions need review before any runtime migration.

The v4 `pins-comparison.v1.json` records:

| Comparison outcome | Category-position groups |
| --- | ---: |
| Current / reconstructed baseline groups | 2,629 / 1,796 |
| Same-position semantic matches | 1,251 |
| Matches with a known numeric category | 1,238 |
| Changed sprite-ID sets at matched numeric-category positions | 1,228 |
| Inclusive added / removed positions before candidate pairing | 1,378 / 545 |
| Unpaired added / removed positions after candidate pairing | 1,209 / 376 |
| Unverified move candidates | 169 |
| Verified moves | 0 |

All 169 candidates in this run use the mutually unique nearest-category method; none qualified through a unique label/object identity. Exact coordinate/current-sprite matching finds only 67 matched positions, illustrating why the 1,228 style changes need a separate comparison. Raw source record totals remain 2,994 current and 2,054 baseline; grouping consolidates same-category conditional/default records and must not be interpreted as deleting their provenance.

## Water-rendering review

The v4 `pins-water-audit.v1.json` evaluates **sprite-bearing** placements against decoded collision data. It retains records where water rendering is present or clipping coverage is unknown. A water-rendering flag is not an ocean classification, and a blocked anchor is not proof that a facility was placed incorrectly. Fishing symbols, boats, crossings and map-label anchors can intentionally be drawn over water.

| Collision evidence at a sprite anchor | Current records | Reconstructed 2021 records |
| --- | ---: | ---: |
| Water rendering present, clipping known | 119 | 187 |
| Water rendering present, known walkable | 4 | 13 |
| Water rendering present, known blocked | 115 | 174 |
| Of those blocked: terrain/water blocking bits present | 113 | 173 |
| Of those blocked: object-only blockage, no terrain/water blocking bits | 2 | 1 |
| Unknown clipping/layout among audit candidates | 0 | 0 |

The two current object-only blocked records share 2512/3508: explicit sprites 20902 and 33478, categories 949 and 1159. Their mask is 16 (`OBJECT`); treating their water-rendering presence as blocked ocean would conflate an object's clipping with water terrain. In contrast, mask 6 combines terrain and water blocking evidence. Unknown coverage would remain unknown rather than being assigned ocean status; no unknown candidate occurred in this run.

Most retained current water records are expected review types: 73 have numeric category 1176 (the fishing category), 18 have category 1206 and 11 have category 1217. Current numeric labels remain numeric; a future reviewed legend mapping must establish their names. The reconstructed baseline names 114 fishing spots, 24 transportation markers and 18 shortcuts among its water-rendering records. These observations support reviewing particular anomalies, rather than removing every water marker.

Notable baseline candidates include a **Bank at 3547/4262**, eight **Clan Citadel pedestal** markers spanning X 3967–4223 / Y 4132–4516, and **Clan portals at 4022/4106 and 4150/4490**. All have known blocked water anchors with mask 6. No bank/citadel/portal category occurs among the current export's water audit records. This is evidence of a suspicious old cluster against the current surface layout, not a verified location correction or a guessed instance-to-surface remap.

Examples also demonstrate why water presence alone is insufficient: the baseline bank at **3098/3010** is known walkable with mask 0, and current crossing markers at **2874/3130 and 2874/3138** are likewise water-rendered but known walkable. Current quest-state sprites at **3683/2948** (22471 and 22472) are known blocked with mask 6, while the pair at **3712/3496** has mask 22, combining terrain/water and object clipping. Their conditional states remain exported without asserting that both are active. The final route checks passed; collision-derived evidence retains the closed-door and server-state limits in the main report.

## Verification

Run `node --test tests/cache-pins.test.mjs`. Fifteen focused tests cover exact square/chunk translation, repeated source copies, disabled pastes, overlap rejection, packed coordinates, recursive defaults and condition selectors, cycle errors, comparator identity, paletted/RGB sprite pixels and PNG scanlines. Comparator regressions additionally cover sprite-only changes, the inclusive 64-tile threshold, tied distances, mutual rather than greedy nearest matching, excluded category-name identity, and label uniqueness across the entire snapshot. The v4 sprite, extraction, comparison and water-review counts above come from the actual copied SQLite cache outputs, not just synthetic fixtures. Cache freshness/build identification and subsequent integrated route/manifest verification are reported by the parent export command.

## New versioned asset bundle

The final validated export was written as new files beside the existing assets: [pins.cache-2026-10-08-05932552f7af-v1.json](C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/pins.cache-2026-10-08-05932552f7af-v1.json), [manifest.cache-2026-10-08-05932552f7af-v1.json](C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/manifest.cache-2026-10-08-05932552f7af-v1.json), and 291 PNGs in `sprites.cache-2026-10-08-05932552f7af-v1/`. The date suffix uses UTC; the local audit date is 7 October. The manifest retains every sprite frame’s dimensions, offsets, source hash and relative PNG path. Output and sprite hashes were verified before publication; existing filenames were refused. No selected asset file, hidden-pin preference or live picker configuration changed.
