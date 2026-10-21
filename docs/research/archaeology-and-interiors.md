# Archaeology and interior maps

Current interior display data uses [catalogue v2 and connections v3](interiors-v2.md): 1,403 mapped records, 576 explicit unknowns, 422 maps and 2,242 tiles. The body below preserves the historical v1 extraction and verification results; see the v2 note for the active asset version, reviewed identities and current limits.

This branch adds copied-cache Archaeology reference data, an opt-in material-cache contents layer and a display-only interior map catalogue. Archaeology remains off unless `RS3_ARCHAEOLOGY_CONTENTS=game-data` is set before server startup. Interior maps add no access, ownership, membership or travel edges. All save previews and servers used synthetic fixtures; the private duo save and ports 8788/8790 were not used.

## Extracted data

| Item | Count | Delivered evidence |
| --- | ---: | --- |
| Archaeology dig sites / site and sub-area rows | 9 / 92 | Names, levels, manager NPC references, requirement structs and typed child links |
| Excavation hotspots / material-cache rows | 104 / 45 | Object IDs, typed yields, soil, levels, membership candidates and source records |
| Yielded material items | 47 | Item IDs and membership flags; encoded weights preserved without converting them to drop rates |
| Artefact DB records | 250 | 248 numeric damaged IDs and 249 restored IDs; two missing damaged references remain explicit |
| Restoration candidates | 238 | 237 artefact-linked production definitions plus damaged Balarak's sash brush; materials, quantities, grouped alternatives, requirements and raw XP |
| Other Archaeology production candidates | 27 | Preserved separately from restoration; total production candidates 265 |
| Collectors / collections | 14 / 78 | NPC IDs, locations, collection-log joins, complete restored-item lists and inferred minimum restoration levels |
| Mysteries | 52 | Site/lore links and retained Quest/Diary comparisons; missing requirements remain unknown |
| Candidate placements across all maps and planes | 716 | Exact object/source/display positions and transforms, including review-only conditional placements |
| Admitted surface material-cache placements / chunks | 87 / 25 | Every admitted placement has exact existing component witnesses; 14 belong to reviewed F2P classes |
| Interior cache maps / map-plane layers / PNG tiles | 246 / 263 / 1,361 | Versioned 256×256 RGBA tiles, exact layout transforms, hashes and coverage bounds |
| Picker off-surface and named-interior records | 1,979 | 893 have rendered mappings; 1,086 have explicit unknowns. Of 419 named records, 164 are mapped. |

These are decoded records and references, including tutorial, quest, event and duplicated variants. They are not counts of independent repeatable activities. [Archaeology extraction](archaeology-extraction.2026-10-08.v1.md) and [interior map research](interior-maps.2026-10-08.v1.md) provide complete field semantics, comparisons and pinned Wiki samples; their sibling versioned JSON reports preserve the machine-readable evidence.

## Comparison and application

Of 555 retained Archaeology task rows, 408 join exact cache object/output names. The other 147 remain unmatched, rather than being removed. Complete collection name/item-set comparisons match 75 of 78 collections; Desperate for Artefacts, Guthixian I and Museum - Guthixian I remain review gaps. All 52 mystery names join retained Quest/Diary records.

The one corroborated level correction is **triskelion material cache 58 → 52**, supported by DB row 18297/table 88/column 4 and [Wiki revision 37118968](https://runescape.wiki/w/Material_cache_(triskelion)?oldid=37118968). A separate versioned correction bundle applies it only with the Archaeology switch, the exact original level and the expected object selector. It preserves task IDs and leaves customized records alone. Five other apparent discrepancies are skillchompa method levels compared with the Centurion facility's level 1; those method requirements are preserved.

Twelve admitted material-cache placements have no matching same-base retained declaration: white oak ×1 in 11830, orthenglass ×4 in 15685, felt ×4 in 14912 and orgone ×3 across 15169/14913. Their exact component routes are added only in the opt-in mode. Confirmed retained sources keep their original section alternatives, gates, backlogs and blocking. Ordinary cache resources compose first, and their contents/provenance survive the Archaeology projection.

There are **zero excavation-hotspot source grants** in this runtime cohort. Active hotspot scenery states are not established by the copied cache. Those object IDs and positions remain reference/review evidence. The 633-row placement review ledger contains 561 outside-surface records, 68 conditional/untyped records and four multiple-component witness reviews; the last four still retain every exact witness and are not an additional exclusion count. This branch does not use renderer defaults to grant a quest or active morph.

F2P Archaeology has a verified cap of 20. Eleven named resources have independent F2P checks; the 14 admitted F2P placements are eight samite silk, three Third Age iron and three white oak caches. Cache scenery flags and the resource-table boolean can disagree with activity eligibility: Centurion remains has a members candidate despite its F2P tutorial, while Tunnels barricade has a false candidate at level 83. Both raw candidates and reviewed classifications are retained. Infernal Source remains members-only despite level 20; Zarosian I's full collection needs restorations up to 25.

Nine site records include Moonrise. Its [current Wiki page](https://runescape.wiki/w/Moonrise_Dig_Site?oldid=37130897) corroborates level 52 and membership; the skill overview's prose still says eight sites. Direct cache mystery levels are largely absent: only Leap of Faith has an explicit decoded Archaeology requirement here; Breaking the Seal's Wiki level 12 is recorded separately. Collector activity membership and collection flag semantics remain unknown. Raw requirement ID 64, server gathering success/rates, player varbits and live-instance state are not invented.

Interior identities include ordinary Lumbridge Cellar map 31 planes 0–3; Lumbridge Catacombs maps 164 planes 0/1 and 165 plane 0; Draynor Sewers map 542; Edgeville Dungeon/Varrock Sewers shared map 592; Ashdale Caves map 665; and Burthorpe Underground map 719. Resource-dungeon variants retain separate maps. Numeric aliases such as 9030 and 8774 remain interiors despite their numbers overlapping the surface grid. Wilderness North Volcano has no confirmed separate interior map.

Each map's half-open bounds describe rendered layout coverage. An area's semantic enclosure remains explicitly unknown; shared maps can contain unrelated areas. Exact reviewed transport station entrances and approximate/unresolved retained connections stay distinguishable. Catacombs map 164 plane 1 uses separately reviewed source-plane evidence rather than an encoded world-map paste and has `reviewed-direct-source-XY-coverage` bounds. Flat floors/basic walls omit scenery models, labels and icons. Shared water and void are transparent; real floors and special water retain the surface renderer's existing treatment.

## Provenance and local publication

The decoder is pinned rsmv commit `a92b8920b9b9842adde78822646ecad1a6f4fc15`; compatible schema build 950 is inferred, not a verified live-game build. Config joins use JS5 2 archives 40/41/11, items 19, structs 22, enums 17 and achievements 57. Object/map evidence derives from copied JS5 5/16/23 and the previously pinned exports/masks. All seven Archaeology config tables decode with zero errors. Renderer/helper repository hashes use `scripts/lib/provenance-hash.mjs` with Git LF bytes; copied inputs, PNGs and local manifests use exact bytes. `.gitattributes` covers the new text, including the Python verifier.

New durable publications in the main checkout's ignored local storage are:

- `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/archaeology-2026-10-08-archmaps-v1/`: the final raw extraction and manifest, plain-copied from scratch with both byte hashes verified. Extraction SHA-256 `b40896d0310e6aa4cc382576ec22b212eb6b832ec368e93437284d3bcbf95e84`; manifest `5aa764159cb8544a6e7549f142a82e4795f700713ba3d959e3391951cc533d78`.
- `C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/interiors.cache-2026-10-08-archmaps-v3/`: the selected interior assets. Manifest SHA-256 `18aa59bdec93255fe4ed83d9ed6e930e60f80cc67329495801d17abcb1a7b564`. Historical v1 and partial v2 directories remain unselected.

The runtime Archaeology catalogue is 1,542,830 bytes, LF SHA-256 `2b703f6f029d22715d05dd9911d824c6c09dfe58ff7c3303429c2cd162799ad6`; two final regenerations were byte-identical. Independent Pillow verification checked every interior PNG's hash, bytes, RGBA dimensions, transparent RGB and alpha counts: **zero errors**, 21,720,151 bytes, 274 fully transparent tiles. An eight-panel sample montage was visually inspected. No existing main-checkout tracked file, local manifest, game-cache file or private save was modified.

## API and UI handoff

- Authenticated `GET /api/archaeology-catalogue` returns reference data, `contentsEnabled` and the guarded `taskCorrections` bundle. `/api/rules` adds `cacheArchaeology`.
- Authenticated `GET /api/interior-maps` returns the complete display catalogue and `assets.available`. `GET /api/interior-maps?area=<exact picker ID>` returns `area`, including its map/plane rows and entrances. Known unresolved areas return explicit unknowns; an unknown ID returns 404.
- Installed tiles expose `/assets/map/interiors.cache-2026-10-08-archmaps-v3/<mapId>/2/<plane>_<x>_<y>.png`. The installed manifest must match its pinned hash. Only listed tile paths are served, with contained realpaths, byte/hash checks, authenticated HEAD/GET, immutable caching and ETags. Missing/mismatched assets retain mapping evidence and null image URLs.
- `app/core/interior-maps.mjs` provides indexed area/map/tile/entrance queries and exact north-up pixel conversion. `app/core/archaeology.mjs` provides reference filtering. Authenticated browser module/data routes are available.

The **only `app/web` edit** is one `buildWorld` options line in `main.mjs`, passing `cacheArchaeology: rules.cacheArchaeology`. Claude owns the chunk-panel UI. No panel, styling or access behavior was added there.

## Fixture previews and verification

```powershell
node scripts/preview-archaeology.mjs --state C:/path/to/copied/state.json --json
node scripts/preview-interior-maps.mjs --state C:/path/to/copied/state.json --json
```

Both readers require an explicit copied state, verify sidecar hashes/input bytes and reject the live `.local/duo` path. Archaeology compares OFF/ON with normal resource and metadata defaults on both sides, reporting level metadata changes, contents, task/collection/equipment availability and owned-source losses. Selected/pending chunks provide contents only. Interior preview evaluates existing task/area gates once and joins display metadata afterward; task/access changes are zero by construction and checked against unchanged input state.

The root synthetic fixture uses `fixture-a` and `fixture-b`, explicit unlocked/selected/pending chunks and synthetic section/area overrides. Archaeology availability remains **209 → 209** and **536 → 536**, with zero availability or owned-source losses; the guarded triskelion metadata change is reported for each member. The separate correction fixture gives a members-enabled synthetic account effective Archaeology 55: its triskelion task changes blocked → available only in opt-in mode, with an unchanged task ID.

Interior preview reports fixture A's two accessible areas mapped and fixture B's nine accessible areas four mapped/five unknown. Both have zero task/availability changes. Its available task-engine row counts are 187 and 516; those exclude the collection/equipment rows counted by the Archaeology preview. An ephemeral synthetic server also verified the installed v3 manifest and served actual Catacombs plane-1 tile `1_60_86.png` (2,971 bytes) through the authenticated API. These checks are not personal-save or in-game observations. Claude must run the copied-save previews for the duo's personal results.

The final full **`npm test -- --test-concurrency=1`** completed in 87.99 seconds: **1,353 passed, zero failed/cancelled, one skipped** (1,354 discovered). The skip is the pre-existing optional skill-icon PNG test because this worktree has no installed skill-icon bundle; it does not concern the independently verified interior PNGs. TEMP/TMP pointed to task-owned scratch. The log is `C:/Users/User/Projects/rs3-cache-work/archmaps-final-npm-test.log`. A preliminary default-concurrency run during extraction did not pass: one copied-resource CLI timed out and two worker cases failed. The final full run used frozen sources and serialized test files; no unrelated test expectations or timeouts were relaxed.

Twenty-eight added tests cover catalogue joins and provenance, morph conservatism, placement/source gates, membership, previews, guarded level changes, interior layout transforms and authenticated asset/API behavior. Independent reviews checked exact raw DB joins, resource composition and the final API/correction hooks. `git diff --check` is clean.

## Files changed

| Area | Files |
| --- | --- |
| Archaeology data and application | `app/data/cache-archaeology.mjs`, versioned catalogue JSON, `app/core/archaeology.mjs`, new versioned `archaeology-task-corrections` module/JSON; option plumbing in `world.mjs`, `tasks/access.mjs`, `tasks/engine.mjs` |
| Interior data and serving | `app/data/cache-interiors.mjs`, versioned catalogue JSON, `app/core/interior-maps.mjs`, `app/data/interior-assets.mjs`, `app/server.mjs` |
| Extraction and previews | `scripts/build-archaeology-catalogue.mjs`, `scripts/cache/archaeology-catalogue.mjs`, `scripts/cache/archaeology-wiki-samples.mjs`, `scripts/preview-archaeology.mjs`, `scripts/render-cache-interiors.mjs`, `scripts/preview-interior-maps.mjs`, `scripts/cache/interior-catalogue.mjs`, `interior-layout.mjs`, `interior-review.mjs`, `interior-verification.py` |
| Verification | `tests/cache-archaeology-catalogue.test.mjs`, `cache-archaeology-application.test.mjs`, `preview-archaeology.test.mjs`, `archaeology-task-corrections.test.mjs`, `interior-maps.test.mjs`, `archmaps-server.test.mjs` |
| Handoff and stable text | This report, versioned Archaeology/interior research Markdown and JSON, `.gitattributes`, the single `app/web/main.mjs` option line |

No generated PNGs or raw local exports are committed. No push, rebase or merge is part of this branch.
