# Private local map assets

The optional [first-visit terrain bundle](terrain-performance.md) supplies
lossless WebP native tiles and prebuilt overview pages. Install its new versioned
directory beside existing assets; it has a separate hash-pinned manifest and
leaves this import untouched. Missing or failed optimized assets retain the PNG
fallback. The verified complete layout also avoids fetching the obsolete world
PNG. `RS3_TERRAIN_ASSETS_DIR` can select a separate optimized root and defaults
to `RS3_MAP_ASSETS_DIR`.

The manual importer downloads an icon-free terrain crop and separate map pins for Player 1 and Player 2's private picker. Normal app startup does not download or refresh them. Terrain and pins are different sources with different dates: the pin snapshot is **18 December 2021**, and must not be presented as a complete current game map.

## Map icons usage

After a local import is available, open **Map icons** from the map toolbar. The legend has seven collapsible groups: General, Transport, Skilling, Combat and Slayer, Quests and achievements, Minigames, and Other / unmapped. Each group has its total pin count, enabled-type count, and an all/none/some checkbox. General and Transport start expanded; browser preferences remember later changes. Individual categories retain their icon, name, count and checkbox. **Show all** and **Hide all** change category visibility. **Reset** enables every category, restores individually hidden pins, clears the search and returns to the default expanded groups.

Search by location or category name, sprite ID, chunk ID or coordinates. Matches in enabled categories are highlighted on the map; other enabled pins are dimmed. Select a result to centre and highlight that pin, then use **Hide this pin** to suppress that individual placement or **Show only this type** to narrow the categories. **Hidden pins** lists suppressed placements and provides **Show** to restore them; its list also follows the current search. Selecting a search result on a narrow map closes the panel so the centred location is visible.

Category visibility, hidden pin IDs, search and expanded groups are private browser view preferences, saved in `localStorage` under `duo-map-pins-v1`. They survive reloads when browser storage is available and do not change shared gameplay, chunk access or either player's teleport eligibility. Ordinary pins appear at zoom 0.5 and above. Dense views below 1.5 show at most 256 spatial representatives, with focused/search matches taking priority; full detail returns at 1.5. Search and focused pins can appear in an overview. Selecting a search result zooms to at least 0.65.

Terrain prefers community PNGs, then selected icon-free cache renders. A complete cache layout with `layoutComplete:true`, `transparentWater:true` and a valid shared ocean colour uses that ocean beneath every source and gap. This prevents obsolete coastlines in the original image from showing through missing or transparent tiles. Partial and older manifests retain the conservative classified-ocean/original-image fallback described in [the earlier terrain report](research/cache-terrain-application.md). Near-empty opaque-black community placeholders advance to cache; certified cache artwork retains legitimate black floors. Missing icon images and Other / unmapped pins use the authored marker fallback. **About / Map sources** provides the snapshot date, coverage limitations, contributor credits, source links and local provenance manifest. The [mapfix3 report](research/mapfix3.md) records the current transparency contract, new asset selection and visual checks; the [surface exclusion audit](research/map-pin-exclusions.md) records pin limitations.

## Operator command

From the authored application checkout, with Node.js 22 or later:

```powershell
# Probe 12 terrain slots, write their coverage/hashes, and print a size estimate.
node scripts/import-map-assets.mjs --output C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets

# Import or resume the same version and crop.
node scripts/import-map-assets.mjs --output C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --download
```

Both commands are explicit manual operations. Estimate mode fetches only its small sample. The full import aborts if the estimate exceeds **400 MB (400,000,000 bytes)**, and also enforces that cap on transferred payloads. The estimate uses twice the measured mean across urban/rural/corner samples, multiplied by all 2,350 slots, plus 5 MiB for pins and icons. It is a budget estimate rather than a promise of actual storage size.

Terrain requests start at most four times per second. Wiki API and icon requests start at most once per second and identify this private importer in the User-Agent. HTTP 429 and server errors receive bounded exponential retries; `Retry-After` seconds and dates are honoured. Other failures stop the command and preserve successful work for a later manual resume.

`manifest.json` checkpoints coverage while downloading. Resume verifies recorded file sizes and SHA-256 hashes, reuses complete downloaded files, and recovers complete PNGs written just before an interrupted manifest checkpoint. A 404 records `missing`; HTTP 204 or a successful zero-byte payload records `empty`. Both coverage records are cached on resume. These statuses describe the source response, and do not prove that a geographical area contains no content. Transparent PNGs remain downloaded tiles. Unexpected non-PNG data and dimensions fail the import.

The output directory is private local storage, excluded by the repository's `/.local/` rule. No downloaded assets belong in a commit. A manifest with `complete:false` means the import is unfinished. To select a new pinned version later, use a separate output directory; the importer refuses to overwrite an existing manifest from a different version.

The server defaults to `.local/map-assets` beneath its own storage directory. A worktree or another checkout can serve the approved shared directory explicitly:

```powershell
$env:RS3_MAP_ASSETS_DIR = 'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets'
node app/server.mjs
```

This only selects local files for the server; the browser does not fetch community/Wiki assets during normal map use. The renderer starts at most six asynchronous image decodes/loads concurrently and keeps at most 256 native terrain images. Overview colour/gray levels at logical densities 1/16, 1/8, 1/4 and 1/2 use the same underlay as native pages: shared ocean for complete transparent-water layouts, original-image fallback for older layouts. Through zoom 0.75, terrain uses one image draw per layer, including high-DPI views. Above 0.75, up to sixteen cached four-by-four native pages add detail; views with backing density above 1 prioritize eight nearby pages. New pages compose one per queued animation frame, with the overview visible meanwhile. Map canvas backing density is capped at 1.5. A cached world-space reveal path exposes full-colour terrain in one clipped viewport pass. Pins use a 160 CSS-pixel padded canvas, translated during safe pans and refreshed for zoom/filter/focus/image/ownership/size changes. Hover stays on its own canvas. See [measured rendering results](map-performance.md).

## Source versions and provenance

| Asset | Pinned source | Scope |
| --- | --- | --- |
| Terrain | [mejrs/layers_rs3 commit f1e12f44](https://github.com/mejrs/layers_rs3/tree/f1e12f444ddb0f7e594d9e213dd2758cb377cc46), committed 3 July 2026 | `map_squares/28/2/0_x_y.png`; surface map 28, plane 0, zoom 2 only |
| Pin positions and label joins | [mejrs/data_rs3 commit b8424a43](https://github.com/mejrs/data_rs3/tree/b8424a43d8370adc71de53f7d6438ad0f77d0944), 18 December 2021 | `original_sprite_locations.json`, `map_labels.json`, `map_label_locations.json` |
| Named icon images and sprite mappings | [RuneScape Wiki Icon legend](https://runescape.wiki/w/Icon) and each linked File description | Curated mappings resolved through MediaWiki `imageinfo` and file revision content; retrieved manually at import time |

The terrain repository commit date does not establish the rendering/cache date of every tile. Icon files can be newer than the pin positions. The manifest records source URLs, commit/date information, retrieval dates, bytes and SHA-256 hashes for terrain, raw source JSON, the normalized pin file and individual PNG icons. `raw/wiki-icons.json` retains the exact API batches, file description links, metadata and licensing wikitext.

The real private import completed on 7 October 2026 at `C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets`:

| Measured output | Count or bytes |
| --- | --- |
| Terrain slots | 2,350 |
| Downloaded terrain PNGs | 1,160; 15,051,991 bytes |
| Missing / empty source slots | 1,190 missing (404); 0 empty |
| Raw source placements / normalized pins after offline surface repair | 4,857 / 2,054 |
| Named categories / Other | 107 / 1 |
| Named category PNGs | 107; 98,265 bytes |
| Other pins / distinct unmapped sprites | 384 / 32 |
| Same coordinate/current-sprite duplicates consolidated, variants retained | 37 |
| Previously displayed placements excluded without surface evidence | 151 |
| Manifest-tracked asset files after repair | 1,272; 26,055,701 bytes (26.06 MB) |
| Total stored files, including manifest, after repair | 1,273; 27,109,059 bytes (27.11 MB) |

The manifest excludes itself from `assetFiles`/`assetBytes` to avoid a recursive self-hash/size dependency. All 1,272 recorded assets were independently checked against their recorded SHA-256 hashes and byte sizes; all 1,267 PNGs passed signature, IHDR dimensions and IEND checks. The final manual resume reused every terrain/icon file and transferred only 73,227 bytes of fresh Wiki API metadata. Resume still performs manual API lookups to verify current file URLs and dimensions; it does not imply a network-free operation. Original icon retrieval dates are retained when images are reused.

Categories are authored in `app/data/map-pin-categories.mjs`. Each named category maps a sprite ID documented on its linked Wiki file. Neither source placement `type` nor an untranslated numeric source category is used to guess a human meaning. There are 107 reviewed named types and an **Other / unmapped** bucket. The 2021 loyalty-shop type stays explicitly dated; current game removals do not silently delete old source rows. Every named category receives a real Wiki PNG; Other uses the renderer's authored fallback marker. Activated-lodestone and in-progress-quest names describe the source icon style, not either player's actual activation or quest progress.

## Crop and coordinate interpretation

The crop is derived from `SURFACE_GRID` in `app/data/world.mjs`, rather than duplicating a second grid definition:

```text
Game X: [1856, 4864)
Game Y: [1408, 4608)
Logical world: 6016 × 6400 pixels
Logical density: 2 pixels per game tile
Zoom-2 terrain: 4 image pixels per game tile, drawn at half image size
Terrain indices: X 29–75, Y 22–71 (2,350 slots)
```

Integer pin coordinates identify game tiles. The shared `gameToWorld()` conversion adds 0.5 to both axes to place a marker at the tile centre, and inverts Y around the correct **4608** northern boundary. `centred:true` supports coordinates that are already centred. Chunk IDs retain the picker's legacy `regionX*256+regionY` encoding, which is not a modern cache archive ID.

The landmark fixtures were read from the downloaded pinned JSON:

| Landmark | Game X/Y | Picker chunk | Logical world X/Y |
| --- | --- | --- | --- |
| Lumbridge ground-floor bank | 3215 / 3257 | 12850 | 2719 / 2701 |
| Varrock east bank | 3254 / 3420 | 12853 | 2797 / 2375 |
| Altar north of Falador | 2978 / 3407 | 11829 | 2245 / 2401 |
| Falador Castle altar, plane 2 | 2982 / 3346 | 11828 | 2253 / 2523; excluded from plane-0 pins |

The research report's example at 3190/3225 is absent from the required pinned snapshot. Tests use the real pinned records above instead. Coordinate tests establish conversion and crop membership; browser checks establish visual artwork alignment separately.

## Normalized data and limits

`pins.normalized.json` has `schemaVersion:1`, `normalizationVersion:2`, `snapshotDate`, a `pins` array, normalization counts, and the full exclusion audit. Each pin retains source identity/index, original coordinates and plane, display coordinates, map/plane, sprite/background sprite, reviewed category, label origin, chunk ID, logical coordinates and original icon/property/legacy conditions. Stable IDs identify rows within this pinned source snapshot; identical coordinate/current-sprite duplicates become one marker with all alternate IDs, source records and conditions retained in `variants`.

Explicit maplink records use their supplied destination only when its map ID is 28 and its plane is 0. Untagged placements additionally require downloaded surface terrain coverage; missing/empty/pending/unrecorded coverage is excluded as **surface-unverified**. This can omit real facilities in coverage gaps, and downloaded coverage does not decode map identity or prove land/water at an individual coordinate. The retained raw files lack map-paste transforms, so unresolved interiors are excluded conservatively rather than relocated by guessed offsets. The feed remains dated and conditional; it does not infer access, task obligations or teleport eligibility. [All exclusions and source evidence](research/map-pin-exclusions.md) are recorded separately.

Existing local pins can be repaired offline without downloading or changing raw assets, terrain or icons:

```powershell
node scripts/import-map-assets.mjs --output C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --rebuild-pins
```

This verifies cached raw/terrain hashes first and updates only `pins.normalized.json` and `manifest.json`. The real repair transferred zero bytes and retained the IDs of all 2,054 displayed markers. Its 2,803 excluded raw rows comprise 1,916 outside-crop, 584 other-plane, 114 explicit other-map, 151 surface-unverified, one missing-sprite, and 37 duplicate rows.

Labels prefer source tooltips, then their `labelId` definition. Exact coordinate-only label joins are marked `coordinate-label-provisional`; conflicting candidates are retained without choosing one as the displayed label. Labels are converted to plain text and are rendered as text. Unmapped sprites remain visible through Other and retain their numeric sprite IDs for review.

Run the importer tests with:

```powershell
node --test tests/map-assets-import.test.mjs
```

They check crop boundaries, half-tile anchors, actual landmark coordinates, upstairs exclusion, maplink transforms, duplicate/condition preservation, labels, rate spacing, `Retry-After`, PNG validation, cached missing/empty slots, interruption recovery and the 400 MB estimate stop.

## Initial import validation record — 7 October 2026

The full `npm test` run passed all **431 tests**. Coordinate fixtures cover Lumbridge bank at 3215/3257 in chunk 12850, Varrock east bank at 3254/3420 in chunk 12853 and the altar north of Falador at 2978/3407 in chunk 11829; the Falador Castle altar on plane 2 is excluded. All **1,272** manifest-tracked local assets were independently verified against their recorded byte sizes and SHA-256 hashes.

Browser checks used an isolated synthetic server on port 52513 with the real imported terrain and pins. The final desktop screenshot showed all **108 categories**, and a centred Varrock east bank pin was visually aligned with the terrain artwork. **Hide all** persisted after a reload. These checks establish asset and interface behavior, not personal gameplay validation.

In Chrome's 390 × 844 phone viewport, the measured document `scrollWidth` was **375 px** and the panel width was **355.8 px**, fitting the document width. Selecting a mobile search result closed the panel. A final phone screenshot was unavailable because the Chrome helper repeatedly timed out and its kernel reset after the documented recovery procedure; complete phone visual approval remains outstanding.

The subsequent [map performance and surface-pin repair](map-performance.md) records the current test counts, measured rendering costs, completed desktop/phone screenshots and seven-group legend verification. Its browser checks supersede the initial phone screenshot limitation above.

## Future refresh

A refresh is a deliberate operator action: verify and pin the new source commit, update the importer constant, estimate the same crop, then import into a separate private output directory. Compare counts, source changes and the same landmark alignments before selecting that directory for the server. Ordinary browser reloads do not select moving upstream versions or initiate a refresh.

A current cache-derived pin export remains separate future work. It must join explicit index-42 placements with index-16 object definitions and index-5 map locations; apply index-23 map pastes and plane transforms; preserve conditional/morph information; and extract index-8 sprites. Index-2/archive-36 map labels supply definitions and text. Compare the resulting landmarks and moved/removed/added pin IDs against this dated snapshot, with an explicit reconciliation rule for stable IDs rather than silently reusing hidden-pin preferences for unrelated markers.

## Rights and attribution

Player 1 authorized the community assets for this private duo deployment. That operational authorization is not a claim of redistribution rights. The community terrain and data repositories do not declare asset licences, and terrain/icon artwork belongs to Jagex. Wiki file licensing descriptions are retained per image; the importer does not classify those images as Creative Commons artwork. Adapted Wiki text/category descriptions remain credited to Wiki contributors under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).

The application should credit Jagex, the RuneScape Wiki/Weird Gloop contributors and Mejrs's community mapping work. Keep the [Jagex Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy), each source/File link and the manifest available through map source details. Private hosting does not establish permission to publish a mirror of these assets.
