# Exact surface section geometry

The authenticated `GET /api/chunk-sections?chunk=<base>` endpoint supplies walking-tile geometry for the chunk panel and map highlighting. It reads the audited copied-cache surface masks, never the original game cache. This is presentation data: it changes no ownership, saved section selector, entry condition, roll rule, task obligation or resource access.

## Response and coordinates

The response has `schemaVersion: 1`, `displayOnly: true`, `accessEffect: "none"`, `chunkId`, `gridSize: 64`, `coordinateSystem: "local-x-east-y-north"`, `coverage`, `provenance` and `sections`.

Each row contains:

| Field | Meaning |
| --- | --- |
| `id` | Full retained selector or runtime cache component ID |
| `kind` | `retained-section` or `cache-component` |
| `retainedSectionIds` | Stable authored selector IDs associated with this row |
| `cacheComponentIds` | Certified runtime IDs, using suffix `1000000 + cache label` |
| `mask` | `{encoding: "base64-bitset-lsb0-y64+x", data: "…"}` or `null` |
| `labelPoint` | `{x, y}` at the centre of an actual included tile, or `null` |
| `walkableTileCount` | Number of set bits in the displayed union, or `null` |
| `description` | Exact in-mask cache text labels when available, otherwise a geometric position |
| `geometryStatus` | `exact` or `unknown` |
| `geometryReason` | Unknown reason string, otherwise `null` |

Local tile indices are integers 0–63. X increases east; Y increases north. The mask is exactly 512 bytes decoded from ordinary base64. Tile `(x,y)` is bit `y*64+x`, stored in byte `bit>>3` with value `1<<(bit&7)`. A browser can decode it with:

```js
const bytes = Uint8Array.from(atob(row.mask.data), character => character.charCodeAt(0));
const contains = (x, y) => Boolean(bytes[(y * 64 + x) >> 3] & (1 << ((y * 64 + x) & 7)));
```

The source's `x*64+z` Uint16 little-endian component grid is transposed into this documented bit order without changing a tile. `labelPoint` uses half-integer tile-centre coordinates (for example `{x:2.5,y:55.5}`); its containing tile is recovered with `Math.floor`. It is the included tile nearest the union's mean tile position, with ties ordered south to north, then west to east. It never falls in a hole or on another component. Map display must invert Y when converting to screen coordinates.

Every existing retained topology key appears, including section `0`. Certified `world.cacheWalking.legacyToComponents` mappings produce exact union masks. Shared mappings may produce identical masks for different retained selectors; those selectors stay separate. A retained `-0` selector has only its certified correspondence, never an implicit union of the entire base. Runtime components not used by any retained row appear as additional component rows, including single-tile fragments. `componentToLegacy` preserves their known aliases. Extra component rows are display data; they do not create new saved controls.

An unresolved retained correspondence has null mask, point and count even when candidate cache components exist. Neither fragment size nor closeness to a landmark chooses a mapping. Missing/empty coverage likewise supplies no approximate geometry. Invalid regions and nonwalking component IDs from `cache-surface-corrections.2026-10-08.v1.json` are excluded. A region with no retained selectors or active walking components can have an empty `sections` array.

Requests need the same invitation cookie or bearer token as other APIs. Missing, duplicated, malformed, unsafe-integer or suffixed chunk IDs return 400; an unknown base returns 404; other methods return 405. Responses use `Cache-Control: no-store`; the validated compact geometry index loads once per server process.

## Local bundle and reproduction

`scripts/build-chunk-sections.mjs` accepts an audited full mask gzip, optional copied-cache pins JSON, and optional output game-data directory. Its default output is the current checkout's ignored `.local/game-data/chunk-sections.cache-audit-2026-10-07-v4-v1/`, with `sections.v1.json.gz` and a manifest. It refuses an existing output bundle directory and writes new files exclusively. Choose a fresh output game-data root for a repeat run; do not overwrite an installed bundle.

For this desktop's read-only inputs:

```powershell
node scripts/build-chunk-sections.mjs `
  'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/walkability-masks.cache-audit-2026-10-07-v4/walkability.v1.json.gz' `
  'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/pins.cache-2026-10-08-05932552f7af-v1.json'
```

The source gzip SHA-256 must equal the audited surface-correction provenance (`d553ed49ce12254d197e82abe673279f3bb1ede5eb34098cf0376e68bd67fdf6`). The decompressed 327,121,011-byte JSON has SHA-256 `8acf903e117aee20077e8fb6e46307f51d6cfe630e98f4391b222c6c8449da3a`. The generated catalogue records these hashes, the exact pins file hash, and LF-normalized repository hashes for runtime walkability, component policy and surface corrections using `scripts/lib/provenance-hash.mjs`. The loader verifies compressed bundle bytes against the manifest, the pinned walking source, all three repository input hashes, canonical 512-byte masks, and runtime component tile counts.

`createServer({gameDataDir})` or `RS3_GAME_DATA_DIR` selects an existing game-data root. The default is this checkout's `.local/game-data`. This selection reads assets only. A missing or mismatched bundle keeps retained and component rows with unknown geometry and null mask/point/count; it does not prevent startup. Reasons distinguish `geometry-bundle-missing`, `geometry-bundle-invalid`, `cache-walking-unavailable`, `component-mask-unavailable` and `selector-correspondence-unresolved`. Regeneration requires the source gzip only offline; the running endpoint reads the 291,118-byte compact gzip, not the 327 MB source.

The October 8 generated bundle contains **6,744 active walking components**, **1,294,459 exact walking tiles**, and **190 components with exact in-mask text labels**. No minimum fragment threshold is applied. Descriptions mention a text marker only when its recorded tile is inside that mask, at map 28 plane 0, with no conditional placement or legacy alternate. Up to three distinct text labels are shown. The marker is evidence for a description, not proof of resource availability, membership or access. Raw cache text may have stale or awkward wording. Other descriptions use the union's geometric centre in thirds of the chunk; these are position descriptions, not inferred place names.

The generated bundle is ignored and remains in the sections worktree. A later operator can select its `.local/game-data` through `RS3_GAME_DATA_DIR`, or copy both bundle files into a new versioned directory in the integrated checkout. Do not overwrite an existing bundle. Across the current 2,594 numeric chunks, the endpoint supplies 7,132 rows: 6,756 exact and 376 unknown. These include 689 exact retained rows, 376 unknown retained rows and 6,067 additional components. Shared mappings explain why the exact row count exceeds the number of components.

## Access tab and display hooks

`app/web/chunk-sections.mjs` exports `createChunkSections`, `decodeSectionMask`, `sectionBoundarySegments`, `drawSectionOverlay` and `sectionColor`. The panel shows a north-up terrain crop, numbered section masks, matching row badges and descriptions. Existing retained controls appear immediately and keep Automatic / Accessible / Blocked semantics while geometry loads. A missing or failed endpoint leaves the controls usable and offers retry for a failed request. Additional cache components are marked display only. Unverified geometry receives no tint or outline. No reliable upstairs or underground descriptions are derived from this surface-only topology.

Eight initial colours follow the Okabe–Ito hue families plus a neutral gray; larger fragment lists use distinct light/dark variants. Every row and badge has a number, so colour is supplementary. Retained selectors keep their suffix (including 0), and extra components use C1, C2 and so on. Smaller masks take tint precedence over aggregate masks; row hover/focus gives the selected mask precedence. Shared label points receive separated badges with leaders to the certified tile centres.

The helper accepts `load`, `onOverride`, `onHighlight`, `drawTerrain` and `subscribeTerrain` callbacks and returns `{element, dispose}`. `onHighlight` supplies the row's section geometry, colour and display number, or null. The parent sends override changes through the existing revision-checked `set-section` command, preserving History and Undo. Disposing the panel removes event/terrain subscriptions, ignores late responses and clears highlights.

`ChunkMap.setSectionHighlight(chunkId, section)` draws a light tile-boundary outline on the existing hover canvas, without repainting terrain or changing access. Selecting/closing a chunk, changing tabs and changing map members clear it. `ChunkMap.drawChunkTerrain` and `subscribeChunkTerrain` connect the mini map to the existing `MapTerrain.drawChunk` / `subscribeChunk` hooks. The crop shares community/cache source preference, placeholder rejection and transparent-water underlay with the main map. Its bounded eight-image cache is separate from native viewport images, so an offscreen preview cannot evict a tile needed for viewport publication. Terrain replacement rebinds open panel subscriptions.

## Named audit examples

| Chunk | Observed output |
| --- | --- |
| Edgeville `12342` | Retained sections 1/2/3 map to cache labels 1/6/2 with 2,773 / 201 / 33 tiles. Five additional components contain 1 / 24 / 3 / 9 / 41 tiles. All eight walking components are visible. |
| Lumbridge `12850` | Retained section 1 has 2,761 tiles and contains the exact `Lumbridge` label; section 2 has 95 tiles. Forty additional fragments remain visible, for 42 components total. |
| Port Sarim Church `11825` | Retained section 1 maps to cache label 2 (1,212 tiles), section 2 to label 1 (179 tiles); eight extra components remain. The previously reviewed mainland/pier distinction is preserved; labels do not swap saved selectors. |
| Musa Point `11569` | Retained sections 1/2 map to labels 1/5 with 1,820 / 90 tiles; four extra fragments remain. Section 1 contains the exact `Musa Point` marker. |
| Berylbrook `18228` | Ten component rows; component 1 has 1,731 tiles and the exact `Berylbrook` marker. There is no invented retained selector. |
| Lost Grove Entrance `7727` | Missing coverage; retained section 0 remains unknown with null geometry. |
| Mort Myre Swamp `13621` | Retained section 0 is unresolved; all 17 current cache components are shown separately, including the 12-tile fragment. |
| Suppressed floor regions `16184`, `19248`, `19249`, `19250` | No phantom walking masks. Suppressed components `16433:1` and `16689:1` are also absent. |

These masks represent the static audited collision snapshot. Doors, script-dependent changes, upstairs/underground content, membership policies and uncertain resource correspondences keep the limits documented in [applied cache walkability](cache-walkability-application.md).

Focused verification: `node --test tests/chunk-sections.test.mjs` passes five tests covering asymmetric coordinate conversion, exact unions, shared aliases, tiny components, unknown geometry, suppression, manifest/source/runtime mismatch, authentication, request validation and unchanged isolated saved gameplay. Services use ephemeral ports and fresh fixture stores under this checkout's ignored `.local/chunk-section-tests/`; no live service or existing save is opened.

The three new section test files contain 24 tests: five endpoint/data tests, twelve UI-helper tests and seven terrain/map integration tests. They cover matching badges and controls, collision-separated labels, unknowns, focus/hover, retry, failed saves, disposal, colour variants, separate terrain-cache budgets and subscription replacement. The full `npm test` run on October 8 passed 1,448 of 1,449 tests with zero failures; the existing optional generated skill-icon PNG check was skipped because that private bundle is absent in this worktree.

The npm test command now places `--test-concurrency=2` before the test-file glob. The default runner oversubscribed this machine during parallel jobs, causing an existing map-reference connection reset and an existing preview CLI timeout; both passed independently and in the bounded full run. This changes runner concurrency only. Existing assertions, expectations and timeouts remain unchanged.

An isolated browser review on localhost port 58582 could not complete because Chrome navigation and subsequent tab recovery timed out. The fixture server was stopped. Automated canvas/DOM rendering checks passed, but no browser screenshot or visual acceptance is claimed.
