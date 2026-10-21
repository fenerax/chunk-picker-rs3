# Copied cache terrain fallback

The [mapfix3 report](mapfix3.md) supersedes this initial render's ocean and old-image fallback behavior. Its new version emits transparent shared water and unset/void terrain, covers all 1,211 cache layout addresses, and selects a shared ocean base at every rendering density. The measurements below remain the historical `codex/cacheapply` record.

The terrain loader now tries community artwork, then an explicitly selected icon-free cache render, then a classified fallback. This order applies independently to each 64×64 game-tile region. Community slots marked missing/empty are skipped. A failed image request, failed decode, wrong PNG dimensions or near-empty opaque-black community placeholder advances to its cache source. Uncovered regions use flat community water only when the old image is entirely uniform water and the complete cache surface region list contains no placement there; otherwise they retain the original image. Successful community artwork remains preferred.

The change is isolated to the `codex/cacheapply` worktree. Generated assets are ignored under its `.local/map-assets/`. No original game-cache files, main-checkout terrain assets or running picker on port 8788 were changed by this terrain work.

## Renderer and inputs

`scripts/render-cache-terrain.mjs` executes reviewed portions of [rsmv at a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15): `src/map/svgrender.ts`, tile-property/shape helpers from `src/3d/mapsquare.ts`, colour conversion from `src/utils.ts`, and the existing opcode interpreter/schemas. The script checks the exact Git commit and records SHA-256 hashes of these sources. It does not execute the external CLI, downloader, Electron entry point or package scripts.

The script opens only copied `js5-2`, `5`, `16` and `23` databases with the existing read-only/query-only `CacheCopy` reader. The inferred schema build is 950. Exact map-28 surface pastes and source-plane offsets come from the audited layout loader described in [cache-walkability.md](cache-walkability.md). Archive coordinates use `regionY*128+regionX`; picker region IDs use `regionX*256+regionY`.

The renderer produces flat floor colours, shaped overlays, water and basic wall lines. The SVG call sets `drawicons=false`; locations passed to it contain only wall types 0, 2 and 9 without a `mapscene`. Sprite/model reads throw. SVG output is checked for map-label/map-scene definitions, text and sprite uses before rasterization. Thus map icons remain independent application overlays.

The rasterizer is `@resvg/resvg-js` **2.6.2**, installed in a fresh external scratch directory with `--ignore-scripts --no-audit --no-fund`. The existing dependency-free PNG encoder embeds underlay bitmaps and writes the final 256×256 PNGs. Floorless cache cells become transparent, preserving the original-image underlay through coverage holes. Every written PNG has a recorded byte length and SHA-256.

The script streams one surface paste at a time. Run with a **512 MB Node heap**; a first probe that retained all decoded squares was stopped before it produced a terrain version. The streamed five-region probe completed with five valid PNGs and zero errors. Lumbridge and east-side tile 72,52 were visually inspected: rivers, paths, floor colours and wall outlines were visible, with no POI icons.

## Reproduction

Use fresh directories for both runtime and terrain output. The command refuses an existing terrain version rather than replacing it.

```powershell
$runtime = 'C:/Users/User/Projects/rs3-cache-work/terrain-render-runtime-2026-10-08-v1'
# In a fresh runtime directory only:
npm install --prefix $runtime --ignore-scripts --no-audit --no-fund --save-exact @resvg/resvg-js@2.6.2

node --max-old-space-size=512 scripts/render-cache-terrain.mjs `
  --cache-copy C:/Users/User/Projects/rs3-cache-work/cache-copy `
  --tool C:/Users/User/Projects/rs3-cache-work/rsmv `
  --rasterizer "$runtime/node_modules/@resvg/resvg-js/index.js" `
  --output C:/Users/User/Projects/chunk-picker-rs3-wt/cacheapply/.local/map-assets/terrain.cache-NEW-VERSION
```

An optional `--regions 12850,17460,...` selects exact picker region IDs. It still uses the exact surface paste for each selected region. A completed version writes its provenance manifest beside the PNGs. Merge its `cacheTerrain` field into the worktree's selected `.local/map-assets/manifest.json` after checking the output. Preserve the existing community `terrain` field.

## Loader contract and validation

The selected manifest accepts `cacheTerrain` only for map 28, plane 0, zoom 2, `iconFree:true`, with a directory matching `terrain.cache-VERSION/28/2`. Each region must have status `rendered`, lie inside the picker crop, and use the exact relative filename `DIRECTORY/0_X_Y.png`. Absolute URLs, traversal paths, other map IDs, planes, zooms and unverified icon-bearing sources are rejected. The server serves these versioned PNG paths through its existing contained-file check.

`node --test tests/map-terrain.test.mjs` passes 31 tests, including source order, missing community slots, request failure, opaque-black placeholder fallback, cache-only manifests, unsafe source rejection, ocean fill classification and preservation of existing composed overview/native-page behavior.

## Completed version and verification

Selected worktree version: `.local/map-assets/terrain.cache-2026-10-08-v1/`. Its full [provenance manifest](../../.local/map-assets/terrain.cache-2026-10-08-v1/manifest.json) has SHA-256 `a11e99c9d369e801ca6a6c42e0f549cdf005f4eea9d27a037f8e1a34c4197fbf`. The selected worktree asset manifest preserves the community terrain field and adds this version's cache source and renderer credit.

| Measure | Result |
| --- | ---: |
| Present cache surface regions processed | 1,211 |
| PNGs rendered / empty regions / errors | 1,210 / 1 / 0 |
| Total rendered PNG bytes | 20,383,168 |
| Copied community PNGs | 1,160 |
| Cache regions without a community PNG | 53 |
| Cache/community address overlap | 1,157 |
| Combined PNG addresses | 1,213 |
| Usable addresses after the black-placeholder check | 1,212 |

Region **16184** (tile 63,56) has no rendered cache floor and is the only downloaded community PNG meeting the near-empty opaque-black threshold. Both sources therefore retain the original image there. Of the other uncovered slots, **1,127** have no surface cache placement and contain only the old image's uniform water colour; these now use flat community water. **Ten** contain some old-image artwork and preserve its fallback. There are **11 baked-image fallback slots** in total. These coverage counts describe artwork, not playable regions.

An independent Pillow pass verified every generated PNG's framing, 256×256 RGBA dimensions, byte length and SHA-256. It verified all 1,160 community copies against the original files and found the five separate landmark renders byte-identical to the full run. The generated [verification summary](../../.local/map-assets/terrain.cache-2026-10-08-v1/verification.json) records these checks and the black-placeholder scan. Constructing `MapTerrain` from the actual selected worktree manifest selects cache PNGs for Berylbrook, Heathervein and Fenmoor; successful community PNGs retain first priority.

## Ocean classification and browser evidence

`scripts/prepare-ocean-fallback.py` is an optional offline preparation step requiring Python/Pillow. It updates only the supplied local manifest and writes `ocean-fallback-report.json`; normal app startup performs no sampling, downloads or writes. Run it against a complete, error-free cache terrain version:

```powershell
python scripts/prepare-ocean-fallback.py --assets .local/map-assets --legacy reference/original-picker/runescape_world_map.png
```

The modal opaque pixel in community PNGs **49,48**, **49,47** and **50,48** is independently **RGB 96,118,154** (`#60769a`); their mode counts are 64,420, 23,180 and 13,283 out of 65,536 pixels. These are water-heavy images with shore artwork, so only their agreed modal colour is sampled. The original image's mode is RGB 136,144,157. Classification checks every pixel in each 128×128 legacy region: any differing pixel vetoes water fill. It also excludes every cache surface region, including the empty-floor record. The report records source hashes, sample modes, eligible coordinates, legacy-artwork coordinates and counts. The browser repeats the cache-region/legacy-artwork veto when selecting fills. PNG failures in protected regions keep the baked image.

The retained legacy-artwork regions are `62,71`, `63,71`, `64,71`, and `66,64` through `66,70`; the empty-cache fallback is `63,56`. This deliberately preserves even small old-image details rather than claiming that an unrendered cache region is ocean. Community transparency retains its existing underlay behavior.

| Baked-image fallback coordinate | Picker region ID | Preservation reason |
| --- | --- | --- |
| 62,71 | 15943 | Legacy artwork |
| 63,71 | 16199 | Legacy artwork |
| 64,71 | 16455 | Legacy artwork |
| 66,64 | 16960 | Legacy artwork |
| 66,65 | 16961 | Legacy artwork |
| 66,66 | 16962 | Legacy artwork |
| 66,67 | 16963 | Legacy artwork |
| 66,68 | 16964 | Legacy artwork |
| 66,69 | 16965 | Legacy artwork |
| 66,70 | 16966 | Legacy artwork |
| 63,56 | 16184 | Empty surface cache placement; rejected black community placeholder |

Headless Chromium used an isolated synthetic group and ephemeral server port **65370**, with fresh state under `.local/cacheapply/ocean-browser-state-*`. No live server on 8788 was changed. Before/after captures at zoom **0.1** (full crop) and **0.35** (east/south coast) are under `.local/cacheapply/ocean-{before,after}-{out,mid}.png`; matching JSON reports record zero page errors and the single expected failed placeholder `63,56`. All four screenshots were visually inspected: gray uncovered ocean blocks become contiguous blue water at both scales; coastlines, islands and the conservatively retained legacy patches remain visible. The check uses an all-revealed synthetic map with pins disabled to isolate terrain appearance. The temporary server was stopped after capture.

An additional headless comparison revealed only synthetic starting region **12850**, exercising the normal desaturated fog layer with the same viewport and zooms. Captures are `.local/cacheapply/ocean-fog-{before,after}-{out,mid}.png`. The before comparison removes the new ocean classification from the fetched manifest in memory; it uses the same map/terrain code and sources. All four fog images were visually inspected: the two gray ocean tones merge into one consistent fogged-water tone in the after images. Coastlines, islands and the coloured starting chunk remain visible. Both runs report zero page errors and the expected single failed placeholder; their fresh isolated server was stopped after capture.

`node --test tests/map-terrain.test.mjs` passes **31 tests**, including ocean-only composition, clipped/native water fills, grayscale derivation, cache/legacy-land vetoes, community priority and failure publication.

## Limits

This copied September/October 2026 cache snapshot is static and may lag the current game. The fallback is less detailed than the community artwork: it uses flat SVG floor colours and wall lines rather than textured terrain or scenery models. Java underlay smoothing, cross-square wall overdraw and NXT shore auto-linking are not reproduced. Object morphs use the pinned renderer's default selection; player-specific quest/varbit changes are unknown. Terrain colours and visible floor tiles do not establish walking access, membership or chunk eligibility.

The retained picker export contains no Heathervein, Berylbrook or Fenmoor region names. Their explicit labels in the copied cache pin export establish these addresses using the exact map-28 paste transforms:

| Cache label | Display tile | Region ID | PNG | Original source tile |
| --- | --- | --- | --- | --- |
| Berylbrook | 4563,3348 | 18228 | `0_71_52.png` | 3859,1556 |
| Heathervein | 4570,3470 | 18230 | `0_71_54.png` | 3866,1678 |
| Fenmoor | 4625,3221 | 18482 | `0_72_50.png` | 3921,1429 |

All three region PNGs in the full version were visually inspected: floor colours, rivers/water, paths and wall outlines are present; place labels and POI icons are absent. A separate five-landmark render also covered these three regions plus Amberfell 17716 and Moonrise Dig Site 17717 with zero errors. A label coordinate identifies the region containing that label; it does not establish the complete geographic boundary of the named place.
