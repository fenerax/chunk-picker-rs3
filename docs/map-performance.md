# Map rendering and surface-pin repair — 7 October 2026

Zoomed-out terrain previously submitted thousands of filtered tile draws per frame. The reveal pass repeated those operations per chunk, and intermediate zooms drew dense pin sprites on every pan. The map now uses composed terrain mip levels, bounded native pages, one cached reveal clip, and a padded/throttled pin bitmap. Hover remains independent.

## Measured comparison

Targeted frame timings used real Chrome 154.0.8037.97, a 1280 × 800 viewport, DPR 1, the approved 1,160 local terrain PNGs and pinned raw data. A single `ChunkMap` used a deterministic synthetic member with 180 revealed chunks near Varrock/Lumbridge. The fixture suppresses the unrelated application UI/worker and warms assets before sampling. Each zoom has 120 measured pan frames after 20 warm-up frames. The baseline loads map modules from `d854198` and reconstructs its 2,242-pin output from the unchanged raw files; the final renderer uses the repaired 2,054 markers.

| Zoom | FPS before → after | Frame median ms before → after | Frame p95 ms before → after | Renderer median ms before → after | Viewport image draws before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.10 | 3.5 → 118.0 | 266.7 → 8.3 | 375.0 → 8.5 | 51.4 → 2.1 | 2,436 → 2 |
| 0.35 | 7.2 → 118.0 | 141.6 → 8.3 | 175.1 → 8.5 | 23.4 → 2.0 | 2,172 → 2 |
| 4.00 | 109.1 → 120.0 | 8.4 → 8.3 | 16.7 → 8.5 | 0.7 → 1.9 | 83 → 5 |

The final sweep also measured zooms 0.055, 0.5, 0.55, 0.75, 1 and 2. Panning stayed between **110.8 and 120.0 fps**, with no frame over 50 ms across all nine zooms (1,080 measured frames). The worst frame was **34.5 ms**. A continuous wheel-like sweep from 0.055 to 4 and back averaged **112.5 fps**, with p95 **8.6 ms**, maximum **33.4 ms**, and zero frames over 50 ms across 120 measured frames. Its maximum viewport image count was 27. These are local synthetic renderer measurements, not personal gameplay or a guarantee for every device/browser workload.

An initial wider run exposed a second bottleneck around 0.5–1.0 after overviews were fixed: up to 1,530 viewport image draws and 19–41 fps. Native pages and pin caching address that measured intermediate-zoom cost. Earlier runs alongside application/background work had occasional long frames; the final comparison uses the same isolated fixture before and after.

Extending the overview boundary to 0.75 reduced zoom-0.55 image draws from 35 to three. A subsequent continuous zoom caught a 62.9 ms JavaScript hitch from composing newly visible native pages during drawing. Page composition now queues one page per animation frame; colour and gray overviews remain visible while detail arrives. The final continuous sweep above includes that fix.

Additional device-DPR-2 runs exposed raster cost at intermediate zooms (37.8 fps at 0.55 despite a low JavaScript render median). Map canvases now cap backing density at 1.5; CSS hit coordinates and DOM controls retain their browser behavior. Just above the 0.75 overview boundary, a repeat measured 43.8 fps with 33 viewport image draws and no frames over 50 ms. High-density views now prioritize eight nearby native pages, bounding their viewport image count at 19; the overview covers outer regions. This trades some intermediate/outer detail and high-density canvas sharpness for a bounded pixel budget.

High-density validation remains limited: observed machine CPU use during these extra runs repeatedly reached 99–100%, mostly outside this task. The final stress check at zooms 0.35, 0.55, 0.75, 0.751, 0.8, 1, 2 and 4 measured **37.9–64.0 fps**, with 46 frames over 50 ms across 960 pan frames. Continuous zoom averaged **52.7 fps**, with p95 **33.3 ms**, maximum **99.8 ms**, and two frames over 50 ms. Even the two-blit overview at 0.35 stalled in that run. These results do not establish an idle high-density comparison or a verified 50-fps pass at every high-density zoom. They remain recorded alongside the successful DPR-1 comparison rather than being discarded.

The reusable browser function is `scripts/profile-map-page.mjs`: call `page.evaluate(profileMapPage, { frames: 120, zooms: [...], zoomFrames: 120 })` from an authenticated, isolated local Playwright page. It reports render duration separately from animation-frame intervals, plus image counts. The private profiling server used port 52631, `RS3_MAP_ASSETS_DIR`, and `.local/mapperf-profile-store`; it never used or restarted port 8788. The temporary server was stopped after verification, and port 8788 was still listening. Measurements and screenshots remain ignored under `.local/`.

## Rendering changes and bounds

- Overview colour and pre-grayed levels at 1/16, 1/8, 1/4 and 1/2 logical density include the original map underlay. The largest original-image overview is drawn once; smaller levels derive from it. Through CSS zoom 0.75, each terrain pass draws one image, including high-DPI views. This prioritizes smooth intermediate zoom over native sharpness there; native detail returns above 0.75.
- Native detail uses at most 256 decoded images and sixteen cached 4 × 4-chunk pages. Both colour and gray pages preserve original-image detail through missing/transparent tiles. A viewport terrain pass is bounded by one overview plus sixteen pages, or eight nearest pages when backing density exceeds 1. New pages compose one per queued animation frame, outside viewport drawing; obsolete pending work is discarded when the view changes.
- Model changes rebuild a world-space reveal `Path2D` and ownership lookup. The state pass clips a single viewport terrain draw to that path. Canvas restoration keeps selection, ownership, membership and death annotations outside the reveal clip.
- Pins use a 160 CSS-pixel padded bitmap. Panning within its safe region blits it once and moves hit targets. Dense views below zoom 1.5 use at most 256 spatial representatives, with search/focus priority; ordinary pins are suppressed below 0.5. Modest continuous zoom reprojects the bitmap for up to 50 ms, then refreshes to restore fixed icon sizes. Filter/focus/ownership/icon/DPR/size changes refresh immediately.
- Terrain, pin and original-image decoding is asynchronous. Native cache selection protects current-view images from eviction. Disposal releases native page/mip/pin canvas backing stores and pending page frames/pin timers.
- Pointer motion within/between chunks repaints only hover; no terrain/state/pin redraw is introduced. Empty personal annotation passes are skipped.
- All four viewport canvases cap backing density at 1.5. Device density is tracked separately so moving between monitors or changing browser zoom resizes only when the capped backing dimensions change.

## Terrain and pin evidence

The real asset scan found 70 tiles with fully transparent pixels and 90 with partial alpha. Previously, any loaded tile bypassed the original-image fallback, exposing the dark canvas through its alpha. The renderer now keeps an underlay in overview and native modes. Real-canvas checks at zooms 0.25 and 1 confirmed exact opaque green fixture pixels through both a missing tile and an alpha hole, while retaining the red terrain portion.

Tile **63,56** is a near-empty black source placeholder: 97.656% RGB-black, including 67.576% opaque-black. The runtime checks native 256 × 256 pixels and rejects it. Downsampled pixels alone hid its narrow coloured edge and were insufficient for this check. Ordinary black roofs/walls are retained. Downloaded tiles immediately east of Varrock (x51–54/y53–54) contain real terrain rather than broad blank squares.

Offline processing removed **151 surface-unverified placements** and consolidated **37 identical coordinate/current-sprite variants**, leaving **2,054 displayed markers**. The full raw audit excludes 2,803 rows: 1,916 outside crop, 584 other-plane, 114 explicit other-map, 151 surface-unverified, one missing-sprite and 37 duplicates. All alternate duplicate provenance/conditions remain recorded. The [surface exclusion audit](research/map-pin-exclusions.md) lists all 188 changed placements and explains the missing map-paste evidence. Downloaded coverage is conservative supporting evidence; it cannot prove exact map identity, land/water or current facility presence. No guessed instance offsets are applied.

The repair verified cached raw/terrain hashes and rewrote only approved `pins.normalized.json` and `manifest.json`, with zero network transfer. All **1,271 raw/terrain/icon files** retain their baseline hashes, sizes and retrieval metadata. Browser checks confirmed that the Kalphite chamber example at 2958/1661 and Prifddinas instance lodestones at 4576/2665 are absent. Retained Varrock bank, Lumbridge bank and Falador north altar coordinates were viewed on city/church terrain; this verifies artwork placement, not a new independent 2026 facility catalogue.

## Legend and verification

Seven explicit groups cover the 108 reviewed categories without overlap. Each has a pin count, enabled-type count and native all/none/some checkbox. General and Transport default open. Expansion, category filters, hidden IDs and search persist per browser. Search, Show all/Hide all, individual hide/restore and Show only this type are retained. New styling is isolated in `map-pin-groups.css`; the shared stylesheet/top bar/panels were not restyled.

Chrome's 390 × 844 viewport had document width **390 px** and panel width **370.8 px**, with no horizontal overflow. Group mixed state and collapsed Transport survived reload. Selecting a phone search result closed the panel. Real browser checks produced no page errors.

The final full **`npm test` passed 703 tests**, with zero failures, skips or cancellations, in 94.7 seconds. It includes **62 map-focused tests** covering level selection/DPR, missing/transparent fallback, near-black placeholders, native memory and pan eviction, bounded overview draw cost, reveal transforms/restoration/invalidation, hover isolation, grouped tri-state persistence, pin caching/hit positions/refresh/disposal, explicit non-surface rejection, zoom batching, queued page composition/cancellation and high-density page budgets. Final desktop/phone browser checks passed after the queue and page-budget changes, with no page errors.

## Files changed

- Canvas pipeline: `app/web/map.mjs`, `app/web/map-terrain.mjs`, `app/web/map-pin-renderer.mjs`.
- Legend: `app/web/map-pins.mjs`, `app/web/map-pin-groups.css`, `app/data/map-pin-categories.mjs`.
- Processing and stylesheet route: `app/data/map-pins.mjs`, `scripts/import-map-assets.mjs`, `app/server.mjs`.
- Tests: `tests/map.test.mjs`, `tests/map-terrain.test.mjs`, `tests/map-rendering-cost.test.mjs`, `tests/map-pin-renderer-cache.test.mjs`, `tests/map-pin-filters.test.mjs`, `tests/map-assets-import.test.mjs`.
- Evidence: `scripts/profile-map-page.mjs`, `docs/map-assets.md`, `docs/research/map-pin-exclusions.md`, `docs/map-performance.md`.
