# RS3 world-map pins: sources and implementation plan

Research checked on 7 October 2026 for Player 1 and Player 2's private Group Ironman picker.

**Recommendation:** use the community mapping project's separate RS3 terrain tiles as the background, and render coordinate-based pins independently. A verified icon-free terrain source exists at better resolution than the current image. The easiest downloadable pin snapshot is usable for a prototype but dates to **December 2021**; a current, complete pin export requires more work. Asset permissions also need clarification: private use is not a blanket licence.

This report is research only. Repository reads were limited to README.md, PRODUCT.md, the map/grid code, relevant UI/server references, the PNG header, and a few reference chunk labels. The working tree was treated as a changing snapshot. No repository files were written, no git commands or servers were run, and no bulk map/cache download was performed. The requested report is the only authored file.

“Verified” below means observed in a live response, primary source code, or the local files. Coordinate derivations, storage budgets, effort estimates and recommendations are identified as inference or proposed design.

## 1. Terrain without icons

### Best verified source: Mejrs / the Wiki mapping project

**Verified:** the current [RS3 viewer configuration](https://github.com/mejrs/mejrs.github.io/blob/master/js/main/main_rs3.js) loads two independent raster layers: `map_squares` for terrain and `icon_squares` for POI symbols. Corresponding sample tiles were inspected; the terrain sample contains roads, buildings and vegetation, while the icon sample contains separate symbols. The [project README](https://github.com/mejrs/mejrs.github.io/blob/master/README.md) connects this viewer to the Wiki mapping project.

Use this terrain template, replacing placeholders:

```text
https://raw.githubusercontent.com/mejrs/layers_rs3/refs/heads/master/map_squares/{mapId}/{zoom}/{plane}_{x}_{y}.png
```

| Property | Verified value or implication |
| --- | --- |
| Surface map | `mapId=28` |
| Image tiles | 256 × 256 PNG |
| Viewer floors | Planes 0–3; surface defaults to 0 |
| Native zoom | Maximum 3; higher display zoom enlarges existing pixels |
| Resolution | At zoom z: 2^z pixels per game tile; zoom 1 = 2 px, zoom 2 = 4 px, zoom 3 = 8 px |
| Chunk resolution | At zoom 3, one 64 × 64 game-tile chunk occupies 512 × 512 pixels |
| Coordinates | Flat game coordinates, positive Y northward, using Leaflet `CRS.Simple` |
| File indices | `tx=floor(X*2^z/256)`, `ty=floor(Y*2^z/256)`; filename Y is positive game-grid Y |
| Ground rendering | Handles bridge/forced-draw flags; not simply an untouched raw cache floor |

The Y inversion belongs to Leaflet's tile coordinates: its implementation uses `-(1+coords.y)`. Copy the [tile-axis implementation](https://github.com/mejrs/mejrs.github.io/blob/master/js/layers.js), rather than assuming conventional web-map XYZ or TMS indices. Ground rules are visible in the [terrain renderer](https://github.com/mejrs/rs3cache/blob/master/src/renderers/map/base.rs). There is no verified public plane −1 tile option; renderer `map_id=-1` means something different.

Two reproducible samples:

- [Zoom-1 terrain tile near Lumbridge](https://raw.githubusercontent.com/mejrs/layers_rs3/master/map_squares/28/1/0_25_25.png): 256 × 256, 84,862 bytes.
- [Zoom-3 terrain tile](https://raw.githubusercontent.com/mejrs/layers_rs3/master/map_squares/28/3/0_100_100.png): 256 × 256, 18,748 bytes.

**Freshness limit:** the [terrain repository](https://github.com/mejrs/layers_rs3) has a July 2026 update, but repository activity does not establish every tile's cache date. The zoom-3 sample's latest path commit is [23 March 2026](https://github.com/mejrs/layers_rs3/commit/f9617d9b80864f3d3da5041b068581f3e397513f). There is no verified update schedule or completeness guarantee.

### Other candidates

| Source | Evaluation |
| --- | --- |
| [maps.runescape.wiki](https://maps.runescape.wiki/) and [Wiki mapping documentation](https://runescape.wiki/w/RuneScape:Map) | The documentation explicitly describes icon-free initial renders, 256-pixel tiles and native zoom 3. However, its published RS3 path uses `versions/{cacheVersion}/map_icon_squares/{mapID}/{z}_{p}_{x}_{-y}.png`. Do not assume that combined production layer is icon-free. A current production icon-free endpoint/version was not independently established. The community's separate `map_squares` layer is the stronger verified option. |
| [RuneApps map viewer](https://runeapps.org/apps/map/) / [rsmv renderer](https://github.com/skillbert/rsmv/blob/master/src/map/readme.md) | Higher-detail top-down terrain is available as `topdown-{floor}`: 512 × 512 WebP, native zoom 5, equivalent to 32 pixels/game tile. This has a different visual style from the classic map. The viewer separates teleport overlays, but full absence of POI symbols in every top-down tile was not audited. Classic `map` output can include baked icons depending on configuration. Good secondary candidate, with more alignment and rights work. |
| Jagex public website | No current public RS3 icon-free terrain download or tile service was verified. Tested RS3 `/worldmap` and `/world-map` URLs returned 404. Official OSRS map results are for a different game and must not be substituted. The RS3 cache is a source for renderers, not a verified ready-to-use public map API. |

A working [RuneApps top-down sample](https://runeapps.org/node/map/getnamed?mapid=4&version=1780063184&file=topdown-0/5/200-599.webp) redirected to its image store and returned 512 × 512 RGB WebP, 47,980 bytes. The [version manifest](https://runeapps.org/node/map/getnamed?mapid=4&version=0&file=versions.json) identifies a 29 May 2026 cache, rendered 1 June 2026, build 948, source `openrs2:2559`. That is a snapshot, not a current-game guarantee.

RuneApps applies a 16-game-tile image offset and CRS transformation `(1,.5,-1,12799.5)`; use its [live viewer code](https://runeapps.org/apps/map/index.bundle.js) for alignment. Its tile addresses are not interchangeable with Mejrs' addresses.

### Aligning to this picker's grid

**Verified locally:** `app/data/world.mjs` defines 47 columns, 50 rows, stride 256, start ID 7495. `app/web/map.mjs` uses 128-pixel cells and a 6016 × 6400 logical world. The current PNG has exactly those dimensions. The server serves it as `/assets/world.png`.

**Derived alignment, supported by reference labels:** interpreting the picker's IDs using the legacy `regionX*256+regionY` convention gives:

```text
7495 = 29*256 + 71
region columns: 29..75
region rows:    71..22, north to south

game-coordinate boundary:
X in [1856, 4864)
Y in [1408, 4608)

logical canvas density: 128/64 = 2 pixels/game tile
```

For an untransformed surface point `(X,Y)`:

```js
const rx = Math.floor(X / 64);
const ry = Math.floor(Y / 64);
const column = rx - 29;
const row = 71 - ry;
const chunkId = String(rx * 256 + ry);

const worldPxX = 2 * (X - 1856);
const worldPxY = 2 * (4608 - Y);
const screenX = offset.x + worldPxX * zoom;
const screenY = offset.y + worldPxY * zoom;
```

If integer coordinates identify tile indices, use `X+0.5,Y+0.5` to place a pin at the tile centre. If an imported point is already centred, do not add this offset again. Sprite anchoring needs a separate adjustment.

The reference labels corroborate the interpretation: region 12850 is “Lumbridge”, 12598 is “Grand Exchange”, and 11828 is “West Falador”. **Still validate artwork alignment** at Lumbridge Castle, the Grand Exchange and Falador, plus chunk boundaries near both crop edges. This was not a browser calibration test.

A crucial distinction: these are the picker's region-style identifiers, **not modern RS3 cache archive IDs**. Modern cache packing differs; see [mapsquare definitions](https://github.com/mejrs/rs3cache/blob/master/src/definitions/mapsquares.rs) and [RS3 archive packing](https://github.com/mejrs/rs3cache/blob/master/src/definitions/mapsquares/rs3.rs). Do not feed picker IDs directly into a cache archive extractor.

The community [surface metadata](https://raw.githubusercontent.com/mejrs/data_rs3/master/basemaps.json) instead declares bounds `[[1856,1344],[4736,4544]]`. Preserve the picker's extent and place tiles by coordinates. Stretching that metadata rectangle to 6016 × 6400 would misalign chunks.

At zoom 1 the picker crop intersects 24 × 25 = **600 theoretical tile slots**, with X indices 14–37 and Y indices 11–35. Zooms 2 and 3 require 2,350 and 9,400 slots respectively. These are geometric counts, not available-file counts: sparse/empty tiles are omitted. North/east crop-edge probes returned 404. A downloader must record missing coverage and distinguish expected empty space from a failed request.

## 2. Pin positions, types, labels and images

### Ready-to-fetch coordinate snapshot

The strongest verified small download is [original_sprite_locations.json](https://raw.githubusercontent.com/mejrs/data_rs3/master/original_sprite_locations.json), a flat list of 4,857 placements, approximately 2.10 MB. It includes `x`, `y`, `plane`, a placement `type`, icon sprite/background IDs, numeric categories, legacy variants and some visibility conditions.

A real record has `x=3190,y=3225,plane=0`, current sprite 18952, background sprite 18951 and category field `unk_19=1156`. The Wiki's [Bank icon file](https://runescape.wiki/w/File:Bank_map_icon.png) identifies sprite 18952, providing a verified “Bank” type match. This does not establish a location-specific bank name or eligibility.

Additional files:

| File | Purpose and limits |
| --- | --- |
| [icon_grid.json](https://raw.githubusercontent.com/mejrs/data_rs3/master/icon_grid.json) | Grouped equivalent, approximately 2.98 MB, 4,860 placements. Useful as a cross-check; do not merge blindly with the flat list. |
| [map_label_locations.json](https://raw.githubusercontent.com/mejrs/data_rs3/master/map_label_locations.json) | 2,297 explicit label placements globally, approximately 0.24 MB. This alone misses object-derived icons. |
| [map_labels.json](https://raw.githubusercontent.com/mejrs/data_rs3/master/map_labels.json) | 4,842 label definitions, approximately 1.17 MB; join using `labelId`. Only some definitions contain text. |

For plane 0 within the inferred picker rectangle, the flat snapshot contains **2,246 rows**: 1,530 object placements, 604 explicit icons and 112 map links. There are **2,215 distinct coordinate/current-sprite combinations**, **128 distinct current sprites**, and **120 numeric category IDs**. Only **132 rows have tooltips**. The explicit-label join yields 284 text-bearing placements in the rectangle.

**These are not simultaneously visible surface-pin counts.** Conditions, morphs and numerically overlapping instances require surface transforms and deduplication. Preserve source identity; grouped and flat rows differ.

**Verified freshness:** the pin files and label definitions last changed in the [18 December 2021 initial commit](https://github.com/mejrs/data_rs3/commit/b8424a43d8370adc71de53f7d6438ad0f77d0944). Later repository pushes do not refresh these files. Expect missing newer content, moved facilities and obsolete seasonal locations.

The current [viewer entrypoint](https://mejrs.github.io/js/main/main_rs3.js) uses raster icons with `loadMarkers:false`. Its newer icon imagery does not make this old coordinate feed current.

### Wiki GeoJSON and maplinks

**Verified:** [Wiki map creation documentation](https://runescape.wiki/w/RuneScape:Map/Creating_maps) supports GeoJSON features with game coordinates, map ID, plane and marker/icon properties. These are useful for article-specific NPCs, scenery, teleport destinations and curated locations. In this custom mapping system, coordinates are game X/Y, not longitude/latitude; plane is not geographic elevation.

**Limit:** documentation examples such as `MainMapIconLoc.json` describe a format, not a verified current RS3 all-icons endpoint. Some older examples mix OSRS surface ID 0 with RS3 surface ID 28. No comprehensive, current RS3 legend-pin GeoJSON feed or maintained global Wiki dump was established. Use selected Wiki maps to fill known gaps and supply labels, rather than crawling every article and claiming completeness.

### Current cache-derived export

For an accurate newer dataset, the verified [rsmv extract modes](https://github.com/skillbert/rsmv/blob/master/src/parser/jsondecoders.ts) expose the necessary components:

| Component | What must be joined |
| --- | --- |
| `maplabels` | Config index 2/archive 36: element definitions, sprites, text, categories, legacy/visibility settings |
| `maplabellocations` | Index 42: explicit placements, packed coordinates, label IDs, conditions |
| `maplocations` + `locs` | Index 5 object placements + index 16 object definitions; object opcode 0x6B supplies a map element |
| `mappastes` | Index 23/archive 1: source-to-display map transforms, including planes and chunk placement |
| `sprites` | Index 8: icon image archives, exportable as PNG |

Sources: [file-type definitions](https://github.com/skillbert/rsmv/blob/master/src/parser/filetypes.ts), [map-element schema](https://github.com/skillbert/rsmv/blob/master/src/opcodes/maplabels.jsonc), [explicit-location schema](https://github.com/skillbert/rsmv/blob/master/src/opcodes/maplabellocations.jsonc), and [object schema](https://github.com/skillbert/rsmv/blob/master/src/opcodes/locs.jsonc).

**Proposed pipeline:** decode explicit placements and object-derived elements; resolve morphs/variants; apply surface-map transforms; retain both source game coordinates and display coordinates; restrict to surface 28 and the picker crop; join labels/categories; export stable pin records. Use display coordinates for map placement and retain source coordinates for provenance. A display coordinate or chunk association is not evidence of route access.

The existing rsmv `maplabels` rendering mode is an incomplete shortcut: its [SVG renderer](https://github.com/skillbert/rsmv/blob/master/src/map/svgrender.ts) emits object-derived icons and selects default morphs, without merging all explicit index-42 placements.

The [CLI README](https://github.com/skillbert/rsmv/blob/master/readme.md) documents extraction patterns, including installed-cache and live sources. No build, range selection or extraction was run for this research, and no ready current all-pin HTTP API was verified. The [MIT-licensed rs3cache project](https://github.com/mejrs/rs3cache) is another implementation reference, but its explicit-location support is incomplete; it is not a ready complete-pin exporter.

### Icon pictures and legend names

The Wiki's [Icon page](https://runescape.wiki/w/Icon) provides the human taxonomy and named image files. Use MediaWiki `action=query&prop=imageinfo&iiprop=url|size|extmetadata` with selected File titles to resolve actual image URLs; preserve their description-page links.

Verified examples:

- Bank: sprite 18952, image 21 × 25 pixels, 735 bytes; image version dated 21 February 2025.
- Altar: sprite 22405, image 21 × 30 pixels, 1,544 bytes; image version dated 2 October 2020. [Altar file](https://runescape.wiki/w/File:Altar_map_icon.png)

For a prototype, curated Wiki category images are simpler than extracting all sprites. For exact cache fidelity, export sprite IDs and any background sprites, preserving their anchors. No ready current per-sprite PNG service was verified.

The old snapshot's numeric category IDs do not include a complete human-readable translation table. Create an explicit, reviewed sprite/category mapping to the Wiki legend. Give unmapped IDs an “Other / unmapped” entry; do not guess from the placement `type`, which means object/icon/maplink rather than bank/shop/resource.

## 3. Licensing and server use

### Wiki text and curated data

**Verified:** the Wiki's live site-info API reports **CC BY-NC-SA 3.0**. [Weird Gloop's licensing policy](https://meta.weirdgloop.org/w/Licensing) distinguishes current text from older revisions and says media must be checked individually. Attribution through links to the reused pages is accepted.

For applicable Wiki text/curated data, private noncommercial copying and adaptation fit the licence's permitted uses. Credit the pages/authors, link the licence and identify modifications. Keep any adapted licensed dataset under the applicable ShareAlike terms when shared with Player 2; this does not itself require publishing the whole application. The licence does not transfer Jagex's underlying artwork rights. See the [CC BY-NC-SA 3.0 deed](https://creativecommons.org/licenses/by-nc-sa/3.0/).

Wiki icon description templates mark these images as Jagex-copyrighted game media used with permission. Their availability does **not** make them CC-licensed artwork. Record each file's provenance and rights separately.

### Jagex

The [current Fan Content Policy](https://legal.jagex.com/docs/policies/fan-content-policy) includes noncommercial personal derivative use, retains Jagex ownership, excludes source code, restricts reverse engineering, and requires a prescribed visible credit/non-endorsement notice in clause 8.1.

There is a material ambiguity for this picker: clause 6.1.3 is headed as a restriction on software/applications, while its operative examples discuss game content, add-ons and private servers. **The policy does not provide a clear blanket permission for a companion web app using extracted assets.** Private two-person hosting satisfies the noncommercial circumstance but is not an express exception to that clause. Treat permitted asset use as unresolved rather than asserting either automatic permission or a definitive prohibition.

Avoid direct client reverse engineering, game integration, Jagex logos, official-looking branding, commercialisation and public asset redistribution under an assumed fan-policy exemption. If relying on this policy, use its exact required notice from clause 8.1 and retain the policy link. Clarification from the rights holder would resolve the application question.

### Community downloads and tile services

| Source | Verified licensing position | Practical consequence |
| --- | --- | --- |
| [mejrs/data_rs3](https://github.com/mejrs/data_rs3) | GitHub reports no licence; no root licence declaration was found. | Public downloadability is not a demonstrated reuse licence. Do not describe this JSON as CC merely because it is related to the Wiki. Seek the maintainer's reuse terms. |
| [mejrs/layers_rs3](https://github.com/mejrs/layers_rs3) | No declared repository licence; terrain artwork also derives from Jagex. | Clarify both the project's terms and asset permission. Local caching reduces service dependence, not copyright uncertainty. |
| [RuneApps / rsmv](https://github.com/skillbert/rsmv) | No declared rsmv licence was detected; public imagery permissions were not established. | Do not vendor its source or redistribute its images under an assumed open-source licence. Evaluate permission separately from technical suitability. |
| [rs3cache](https://github.com/mejrs/rs3cache/blob/master/LICENSE) | MIT code licence. | Preserve its copyright/licence notice if using that code. MIT does not license the game cache or generated Jagex artwork. |
| [Wiki tile service](https://maps.runescape.wiki/) | Credits maps to Weird Gloop and assets to Jagex; no separate tile-service quota, bulk-download licence or SLA was found. | Do not treat absence of published terms as unrestricted hotlinking or permission to mirror everything. |

**Recommended operating practice, not a verified tile-server rule:** obtain only the chosen crop, plane and resolutions once, identify the downloader, throttle requests, honour 429/Retry-After, cache successes and documented empty tiles, and refresh manually after a chosen game update. Serve copies from the home server after rights are established. This avoids two browsers repeatedly hotlinking tiles and prevents routine map use from depending on a third-party service.

The Wiki's [API guidance](https://runescape.wiki/w/User:Gaz_Lloyd/smw_api) recommends a descriptive User-Agent and approximately one request per second. That is Wiki API guidance, not a demonstrated quota for GitHub tiles or RuneApps.

Keep a local provenance manifest with source URLs, commit/cache versions, retrieval date, hashes, rights notices, and modifications. Add visible About/Map sources credits for Weird Gloop/community contributors and Jagex, using any required wording. Private Tailscale access avoids publication but does not erase attribution or permission conditions.

## 4. Proposed implementation in this codebase

### A. Import once; keep runtime local

Start with a snapshot importer outside normal app startup. Pin the source commit, rather than requesting moving `master` URLs on each page load.

Suggested future destinations, **not created by this research**:

```text
.local/map-assets/rs3/<source-version>/
  manifest.json
  terrain/28/1/<plane>_<x>_<y>.png
  terrain/28/2/...                    # optional higher detail
  icons/<sprite-or-type>.png
  raw/original_sprite_locations.json
  raw/map_labels.json
  raw/map_label_locations.json
  pins.normalized.json

app/data/map-pins.mjs                 # schema/import adapter
app/web/map-pins.mjs                  # drawing and hit testing
```

Use the private local-assets boundary, verify its ignore rule during implementation, and add narrowly scoped static routes in `app/server.mjs`. Keep reference imports distinct from authored logic, as README/PRODUCT require. A small reviewed legend mapping can be authored separately. Do not modify the retained upstream reference files to perform this feature.

**Size estimates, not measurements of a full download:**

- Flat pins plus optional definitions/placements: approximately **3.50 MB raw**; normalised crop data likely **0.3–1 MB**, depending on provenance and conditions.
- Curated icon images: budget **under a few MB**, then measure.
- Zoom-1 terrain crop: at most 600 geometric slots. The single urban sample extrapolates to about **51 MB** if every slot were that size; empty coverage and content variation make this unreliable. Provision tens of MB and measure the actual crop before adding resolution.
- Full zoom-3 crop: 9,400 slots. A single sample extrapolates to about **176 MB**; again, not a reliable total. Prefer selected higher-detail tiles or postpone this tier.
- A 6016 × 6400 RGBA bitmap decodes to approximately **147 MiB**. A full 8-px/game-tile crop would be 24064 × 25600, approximately **2.30 GiB decoded**. Avoid loading that native-resolution world as one browser image.

Use local tiles with a bounded image cache. Zoom 1 matches today's density; zoom 2/3 can be loaded only when the viewport needs them. Preserve a coverage manifest so expected gaps are distinguishable from corrupted or missing downloads.

A normalised record should retain a stable ID, map ID, source/display X/Y, plane, sprite/background IDs, reviewed kind/category, optional label, source URL/version, conditions and uncertainty. Render imported labels as plain text, not unsanitised tooltip wikitext.

### B. Filter UI

Add a **Map pins** control beside the existing map controls. Use the Wiki's verified legend categories, with searchable per-type checkboxes:

| Legend group | Examples |
| --- | --- |
| Quick Links | Bank, Bank Deposit, Grand Exchange, holiday event |
| Navigation | Lodestone, shortcut, transportation |
| Activities | Quest start, dungeon, taskmaster, house portal; subgroups for minigames, D&Ds and skill tutors |
| Shops / Trading | Weapons, Armour, General goods, Skills / Crafting |
| Facilities | Altar, anvil, furnace, cooking range, workbenches, spinning wheel |
| Resources | Fishing spot, mining site, rare trees, Runecrafting altar, water source, excavation site |
| Other / unmapped | Unclassified source categories; show source ID for review |

Category names follow the [Icon legend](https://runescape.wiki/w/Icon); this is a proposed picker UI, not a claim of complete current in-game parity.

Provide Show all / Hide all / Reset, a tri-state parent checkbox, counts, and a text search across pin labels and types. Selecting a result centres and highlights it. Pin details should offer **Hide this pin** and **Show only this type**, with a searchable hidden-pin list to restore individual instances.

Useful scope choices are All surface pins / Own chunks / Reachable shared chunks. Compute the last option from verified access state, not partner ownership alone. A marker's presence must not unlock a chunk, grant a teleport or create a task. Do not label pins “usable” solely from a category or F2P chunk tint.

Persist filters and hidden pin IDs in browser view preferences, following the existing localStorage membership-overlay pattern. Stable IDs should survive source refreshes where possible; report removed/moved records rather than hiding unrelated new pins. Shared pin preferences would need an explicit product decision.

### C. Canvas rendering

**Verified existing behaviour:** three viewport-sized canvases draw base terrain, model state and hover feedback. `drawState()` redraws full-colour terrain inside revealed chunks, so replacing only `drawBase()` would leave the old baked icons visible in those chunks.

Recommended changes:

1. Make `drawTerrain()` draw the icon-free local terrain tiles. Both base and state reveal passes must use this same source.
2. Add a viewport-sized pin canvas between state and hover. Give it a dirty flag independent of state; category changes should repaint pins without rerendering terrain or recomputing tasks.
3. Index pins by map/plane and 64-tile cell. Use `visibleBounds()` to fetch visible buckets, with an icon-size margin at viewport edges.
4. Apply the common game-to-world transform, then draw fixed CSS-size sprites. Device-pixel ratio affects canvas backing resolution, not pin hit-target coordinates.
5. Use restrained locked-land opacity, readable unlocked pins, and an explicit zoom threshold or overlap grouping. Keep chunk borders, ownership markers and roll choices readable.
6. Add screen-space hit testing and a selected-pin halo to pointer feedback. Preserve normal drag, wheel and chunk-click behaviour; a pin click opens pin details. Provide an equivalent keyboard-accessible DOM search/results list.

A smaller first patch can draw pins at the end of the state pass, but it would redraw revealed terrain on filter changes. The fourth canvas better matches the existing performance goals.

Do **not** load the `icon_squares` raster alongside normalised vector-like pins: it would duplicate icons and prevent individual hiding. That raster is useful only for an explicit “all original icons” mode or visual comparison.

### D. Verification and effort

Before claiming this works, check:

- Landmark and chunk-boundary alignment, including off-by-one Y and half-tile anchoring.
- Banks/altars/shops/quest starts and several transport/resource types at known locations.
- Surface transforms, upstairs banks, bridge render rules, duplicate conditional entries and instanced areas.
- Category and individual hide/show, hidden-pin recovery, search, zoom/pan, both ownership views, and reload persistence.
- Terrain gaps and offline operation; network inspection should show only home-server asset requests during normal use.
- No change to roll pools, chunk ownership, task obligations or personal teleport eligibility.
- A named cache/source version and an explicit missing-category/coverage list.

**Engineering estimate (inference):** a useful prototype with old pins, reviewed basic types, icon-free terrain and local filters is roughly **1–3 developer days**. A polished importer, coverage checks, accessible search/hit testing and representative duo verification adds roughly **1–3 days**. A current complete cache export with explicit/object joins, morphs, map transforms and category decoding is a separate **multi-day effort**, plausibly **3–7+ days**. These estimates assume source permissions and tool setup are settled.

The main risks are stale pin data, incorrect instance/plane transforms, incomplete category naming, missing terrain coverage and unclear asset permissions. Basic canvas filtering is the smaller part of the work.

## 5. Fallbacks and decision

1. **Terrain available, current coordinate export unavailable:** ship the old snapshot as clearly dated optional pins, with curated corrections and a missing-content note. True hiding works for these independently drawn pins; completeness remains limited.
2. **Only separate terrain and icon rasters available:** replace the baked map and offer a global “show icons” switch. Category/individual filters require coordinates; one transparent all-icons image cannot provide them by itself.
3. **Keep today's baked image:** use coordinates for search, halos, selected-pin labels and “pins in this chunk” lists. Filters affect only the overlay/search results. They cannot remove the original symbols, and the UI must say so. Do not paint rectangles over icons, because that destroys underlying map detail.
4. **Asset permissions cannot be established:** retain a coordinates/search prototype using authored symbols and the existing artwork's independently assessed provenance. It does not solve the rights question of the existing background.

Once source permissions are clarified, the most practical next implementation is a limited local terrain import plus a dated coordinate-pin prototype, followed by landmark calibration and a current-data export. The evidence supports the rendering design now; it does not yet support promising complete, current in-game legend parity or unrestricted reuse of the downloaded assets.
