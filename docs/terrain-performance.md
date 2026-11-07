# First-visit terrain delivery

The terrain bundle is generated offline. Runtime remains native Node/browser
JavaScript without packages. Original map/game assets and gameplay are read-only
inputs; browser measurements use disposable localhost servers and copied saves.

## Selected assets

`terrain.optimized-2026-10-08-38129fc98c5adcd7` contains 2,350 native 256-pixel
tiles (10,794,462 bytes) and 156 overview pages (2,109,044 bytes). Each overview
page covers four by four regions: 256 image pixels for 512 logical map pixels,
with a 64-pixel preview per region. This matches the previous renderer's preview
resolution; the smaller composed levels remain at logical densities 1/16,
1/8, 1/4 and 1/2. Native detail starts above zoom 0.75 as before.

Pillow 12.3.0 / libwebp 1.6.0 encode both tiers as lossless WebP, `method=4`,
`quality=80`, `exact=True`. For lossless encoding, quality controls compression
effort; it does not discard image information. Every native export is decoded
and checked for exact RGBA equality, including transparent pixels. Overview
regions use Pillow BILINEAR before lossless encoding, and edge-page padding stays
transparent. All 2,506 encoded files passed a separate size/SHA-256 audit.

The exporter preserves existing source precedence: accepted community terrain,
then certified cache terrain; near-empty community placeholders are rejected.
This export selected 1,159 community images, 54 cache images and 1,137 transparent
ocean gaps. One community placeholder was rejected. The complete cache layout's
shared ocean remains the underlay; no old-world coastline is reintroduced.

The full manifest records the source manifest hash, every input hash, source
selection, encoder/library versions, exporter hash, grid and resampling settings.
Its SHA-256 is pinned by `app/data/terrain-assets.mjs`. A source-manifest mismatch
disables the old export instead of overriding newer PNG artwork when the server
first loads its cached catalogue. Asset updates therefore require a server
restart; this is not continuous source-file monitoring.

The selected manifest is 829,600 bytes with SHA-256
`84e32362fd581ec824438ec380a231b933e28bb3cbf4edd8ee8f7de1589d04a6`;
its source manifest SHA-256 is
`3a249263331600413485f50c84d4e41385c666bd320a9e80029aeebc83a6c5fe`.
The authenticated selection response strips build-only provenance and is
compressed; the full installed manifest remains the audit record.

## Loading and fallback

Visible demand starts nearest the viewport centre and shares a six-request cap
across overview and native images. Requests and queued work made unnecessary
by pan/zoom are cancelled. Decode
callbacks check request identity before publishing. Native pages remain bounded;
other visible regions use overview pages. Explicit open chunk panels retain
their independent native-image demand. Completed terrain publishes atomically.

Initial terrain readiness includes a compact whole-map colour underlay at
**1/16 logical density**, the smallest existing mip level. For the production
grid this is **376 × 400**, **68,166 WebP body bytes** and **601,600 decoded RGBA
bytes** added at startup. It preserves recognisable land/coastlines for a blurry
placeholder; visible overview/native responses provide detail. The renderer
loads and decodes it at foreground priority before the first terrain paint or
detail requests, then seeds the existing colour/gray mip chain. An immediate
pan or zoom therefore shows terrain even when every idle callback and every
destination response is still held. World/asset replacement repeats readiness
and cancels the old instance's requests.

The optional compact companion is pinned to the verified overview manifest and
served through the existing authenticated, integrity-checked terrain route.
An installation without it composes the same small startup canvas from the
bounded existing overview pages before becoming ready. A failed compact fetch
or decode takes that path too. Those temporary decoded pages are discarded;
detail retains its existing viewport/idle demand. No whole-map native load or
full-resolution world atlas is added.

Once visible loading/composition settles, idle work warms the regular overview
previews and nearby native detail. Native page canvases contain fine tiles only;
unloaded regions remain transparent over the current mip. A cached page can no
longer cover a newer overview with the ocean it contained when first composed.
Completed overview/native tiles replace the coarse coastline with certified
ocean under their alpha pixels, so the blurry placeholder cannot leak through
finished transparent-water artwork.

Background work uses `requestIdleCallback` (a yielding task where unavailable),
low image fetch priority, and **one request at a time**, within the shared six.
It starts only after foreground requests and composition settle. View changes
cancel obsolete work before pumping visible demand; a matching request is
promoted without restarting its download. Chunk-panel requests also preempt or
promote speculation. Cancellation/disposal retains the existing identity guard
against late fetch/decode callbacks. Failed speculative requests do not poison
foreground retry or download unpriced PNG fallback sources.

Budgets per terrain instance, including reservations for cancelled requests:

- Readiness underlay: **512 KiB** maximum advertised body bytes and one image at
  the smallest mip dimensions. It adds 601,600 retained decoded bytes on the
  production grid; the page fallback retains that amount as canvas backing
  instead. The six-request pool also bounds that fallback's transient decodes.
- Whole-map overview: **4 MiB** maximum advertised body bytes. The installed
  2,109,044-byte page bundle fits. Unpriced/oversized bundles disable speculation;
  their visible-demand loading still works. Already available previews are reused.
- Native prefetch: **1 MiB**, at most **64 spare decoded images**, inside the
  existing **256-image** cache. It warms the one-region ring near native views;
  at the top overview tier it also warms nearby visible native detail. Lower
  overview tiers and their adjacent levels share the overview source and need
  no additional downloads. Fine prefetch never traverses the entire map.
- Native page limits remain **16**, or **8 active pages** above DPR 1. Existing
  composition frame limits and mip draw counts are unchanged. Background warming
  retains the same bounded per-region previews a full zoom-out already retained,
  rather than adding a second image cache. Budgets reset on terrain replacement.

### Controlled cold-delivery comparison (2026-11-07)

Real installed WebP/PNG terrain was served only from an isolated local fixture,
without a real save. Both versions used fresh Chrome contexts with HTTP cache
disabled and all origin storage cleared. CDP held every image response and each
decode acknowledgement; idle callbacks, animation frames and the clock were
advanced explicitly. Baseline was core `0aedba5`. A 512 × 256 synthetic view
started at zoom 0.5, idled, then panned to new native terrain at model time 30 s
and idled until 60 s. Each release consumed a modelled 100 ms plus body bytes at
2,000,000 bytes/s; these are deterministic delivery measurements, not wall-clock
internet benchmarks. Terrain body bytes exclude headers and unrelated UI data.

| First controlled minute | Before | After |
| --- | ---: | ---: |
| Downloaded terrain body bytes | 291,038 | 3,377,318 |
| Startup compact underlay body bytes | 0 | 68,166 |
| Added startup decoded underlay bytes | 0 | 601,600 |
| Reserved background overview bytes | 0 | 1,970,180 |
| Reserved background native bytes | 0 | 1,047,934 |
| Peak retained decoded image RGBA bytes | 2,097,152 | 14,757,376 |
| Peak terrain canvas backing bytes | 120,753,152 | 147,311,616 |
| Retained native images at 60 s / cap | 8 / 256 | 54 / 256 |
| Retained native pages at 60 s / cap | 2 / 16 | 2 / 16 |
| Initial visible detail completion, model ms / requests | 268.382 / 2 | 402.465 / 3 |
| Native pan completion, model ms / requests | 877.137 / 8 | 877.137 / 8 |

The corrected comparison remeasures both sides with canvas allocations sampled
before transient staging is released; the previous table missed those peaks.
Image memory counts unique retained image objects at four bytes per pixel,
including decoded in-flight images; canvas memory counts mips, previews and
retained/staged terrain pages. Browser HTTP/decoder/GPU caches are not measured.
The compact whole-map first paint is ready after 134.083 model ms. Its one
foreground request adds 134.083 model ms to initial detail completion; subsequent
native-demand completion is unchanged. These are explicit startup costs of
guaranteeing terrain coverage before interaction, rather than idle warm-up.
The native image ceiling remains 64 MiB plus the existing bounded in-flight
pool and the 601,600-byte startup image. Whole-map preview warming and transient
page replacement account for the canvas peak increase; the grid's
per-region preview ceiling is unchanged. A real-PNG held-response regression
verifies compact-underlay pixels on the first cold pan/zoom frame without
running idle work or releasing destination responses. It also caches one native
tile, warms that page's overview from a different view, then returns with new
native responses held: existing detail stays sharp and unloaded regions show
the newer overview. Further regressions cover foreground preemption/promotion,
idle exhaustion, byte/cache caps and page-load listener removal on abort
(including prior abort) or browser exit.

A complete modern layout does not fetch the unused 8.08 MB legacy world PNG.
Older/partial manifests and absent local assets still load that fallback. Missing
optimized installation, source mismatch or a failed optimized manifest uses the
existing PNG selection. Optional-manifest loading has a three-second abort bound.
Failed overview/native WebP decode advances to existing PNG sources. PNGs remain
installation/recovery fallback and are not eagerly downloaded with WebP.

Current Chrome, Edge, Firefox, Safari and Opera support WebP; retaining a
parallel browser-detection branch would add requests to these private clients.
The existing decode-failure fallback also covers older clients. See
[MDN's image format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types#webp_image).

The existing authenticated asset route verifies advertised sizes and SHA-256
before serving new terrain, including HEAD/304. Digest paths use
`private, max-age=31536000, immutable`; the selection endpoint revalidates.
Authentication/revocation runs before both cached and fresh responses. Only
manifest-listed paths inside the selected root can be served. Hidden legend
images load lazily when the panel opens.

## Installation and reproduction

The new bundle is under this worktree's `.local/map-assets/`. Install **only**
`terrain.optimized-2026-10-08-38129fc98c5adcd7/` beside the existing main checkout
map assets when deploying the matching code. Existing PNGs, manifests, sprites,
icons and interiors stay in place. The incomplete method-6 experiment
`terrain.optimized-2026-10-08-7379e09c1f3eeb49/` has no manifest and is not selected.

A worktree can instead select the original read-only root through
`RS3_MAP_ASSETS_DIR` and its own optimized root through `RS3_TERRAIN_ASSETS_DIR`.
The latter defaults to the original asset root. Neither selection starts or
changes the deployed service.

```powershell
python scripts/build-terrain-assets.py --source C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --output .local/map-assets
python tests/terrain-assets-exporter.test.py
npm test
```

The exporter refuses an existing content-addressed directory and never changes
source files. An already installed bundle therefore needs no rebuild. Use a
separate empty output root for exact reproduction, then compare its descriptor.

To derive the optional compact companion from an existing verified export:

```sh
python scripts/build-terrain-underlay.py --source .local/map-assets --manifest terrain.optimized-2026-10-08-38129fc98c5adcd7/manifest.json --output .local/terrain-underlay
```

This checks every overview's size/hash, downsamples it with Pillow BILINEAR,
composites over the current ocean and verifies lossless decoded pixels. The
returned descriptor must match `TERRAIN_COARSE_BUNDLE` in
`app/data/terrain-assets.mjs`. Install only the generated `coarse-*.webp` beside
that export's existing overview directory; its immutable manifest stays intact.
Restart the server to refresh catalogue selection. Without the companion, the
same startup underlay uses the 2,109,044-byte overview page bundle instead of
68,166 bytes; normal browser caching reuses those pages for later detail.

## Options assessed

- Lossy WebP 90/95/100 preserved alpha but showed ringing around thin walls and
  edges. Lossless keeps native text and linework exact. At the cache-edge sample,
  lossy 100 was larger than maximum-effort lossless.
- Maximum-effort lossless (`method=6`, quality 100) saved only 2,590 bytes on the
  Lumbridge sample versus the selected setting, while encoding took 4.096 seconds
  versus 0.219 seconds. The selected lossless sample is 35,262 bytes versus
  50,793 bytes for PNG.
- Native WebP alone would send 9,721,032 body bytes for the exact 781 default-view
  regions, versus 13,914,055 PNG body bytes (14,407,742 wire bytes including the
  one fallback request). Format conversion alone exceeds the 4 MB target by a
  factor of 2.43 even before headers. The offline overview reduces both bytes
  and requests.
- A finer overview would increase transfer without improving the existing
  64-pixel composed preview. Native detail supplies zoomed-in quality.
- Sprite atlases were not added: pins/sprites and icons were about 443 KB
  combined in the cold baseline. Lazy hidden-legend loading addresses eager
  requests without introducing atlas coordinates or another asset bundle.

## Browser evidence

Paired timings and asset-class totals are recorded below. The harness retains
raw waterfalls and artifacts under ignored `.local/perf/`.
Headless localhost plus CDP throttling measures the rendering and delivery path;
it does not establish Player 2's actual device or Funnel internet timing.

The paired baseline serves application `e9183dc`; the optimized application is
`6e4e25f`, with screenshot-harness correction `7565293`. Both read the same frozen
save, SHA-256 `6709638ba999486f536659ff7a8b22ba5f37f9b7de7632aa01cc15713d344259`.
Node 24.20.0, Chrome 154.0.8037.97, 1440 by 900 device-DPR-1 viewport,
prediction prewarm on and separate fresh server/browser profiles were used.
Each variant has three independent cold/reload/cold-30-Mbps suites. Throttling
is 30 Mbps with 40 ms latency. CPU-heavy export and tests did not run alongside
the browser measurements. Cold clears browser/server caches, not OS file caches.

Three-suite medians, with decimal MB and wire bytes including HTTP headers:

| Scenario | Visible terrain before | After | After range | Terrain MB before → after | Whole visit MB before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 8.87 s | 2.65 s | 2.42–2.72 s | 14.408 → 1.945 | 25.348 → 4.702 |
| Reload | 7.15 s | 1.86 s | 1.54–1.98 s | 0.484 → 0 | 0.941 → 0.450 |
| Cold, 30 Mbps / 40 ms | 22.73 s | 4.11 s | 4.01–4.31 s | 14.408 → 1.945 | 25.348 → 4.702 |

Every optimized throttled run meets both targets: under six seconds and under
four MB of terrain. Before ranges were 8.39–12.49 seconds cold, 4.46–10.73 seconds
reload and 20.80–24.14 seconds throttled. No measured visit had a failed visible
tile or failed request. Overall request medians fall from 951 to 128 for
cold/reload and to 129 for throttled cold; the extra cached favicon request does
not change transferred terrain.

Asset-class wire-byte medians (cold and throttled cold have the same map bytes):

| Asset class | Cold before | Cold after | Reload before | Reload after | Cold requests before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Terrain tiles | 14,407,742 | 1,945,165 | 484,058 | 0 | 782 → 67 |
| Legacy world PNG | 8,075,796 | 0 | 619 | 0 | 1 → 0 |
| Map sprites/pins | 409,042 | 269,043 | 0 | 0 | 97 → 1 |
| Icons | 33,972 | 15,128 | 13,522 | 6,094 | 21 → 9 |
| Interiors | 0 | 0 | 0 | 0 | 0 → 0 |
| Other app/API/metadata | 2,421,611 | 2,472,446 | 443,227 | 443,894 | 50 → 51 |

Throttled other-class wire bytes are 2,421,603 → 2,472,442, with requests
50 → 52. Terrain body bytes are 13,914,055 → 1,902,730; reload consumes the
1,902,730 optimized body bytes from cache with no terrain transfer. The baseline
uses 304 revalidation headers; new immutable digest paths avoid those requests
on the wire. Selection-manifest metadata belongs to the other class, not terrain.

Final successful request completion by asset class, median seconds from
navigation (decoded/composed visible-terrain completion is the table above):

| Asset class | Cold before → after | Reload before → after | Throttled before → after |
| --- | ---: | ---: | ---: |
| Terrain tiles | 8.295 → 2.078 | 6.557 → 1.282 | 22.133 → 3.536 |
| Legacy world PNG | 2.097 → — | 0.478 → — | 6.777 → — |
| Map sprites/pins | 2.924 → 1.649 | 2.191 → 0.547 | 4.802 → 2.023 |
| Icons | 7.702 → 5.078 | 2.214 → 0.991 | 7.567 → 5.735 |
| Interiors | — | — | — |
| Other app/API/metadata | 62.213 → 47.109 | 1.393 → 1.166 | 62.054 → 45.384 |

Network-idle medians remain much later than terrain: 63.03 → 47.86 seconds cold,
7.30 → 2.05 seconds reload and 62.84 → 46.16 seconds throttled. Advisory/API work
accounts for the late other-class completion; this terrain change does not
resolve that work. Tasks-shown medians were 7.69 → 5.09 seconds cold,
1.13 → 1.00 seconds reload and 7.46 → 5.62 seconds throttled; one optimized
throttled task result took 6.71 seconds while its terrain still met the target.

Full measurements: `.local/perf/tiles-baseline-3.{json,md}` and
`.local/perf/tiles-optimized-3.{json,md}`. JSON retains all individual suite
waterfalls, source report filenames, revision/file hashes and diagnostic
artifacts, with `milestoneRanges`, `assetClassRanges` and `networkTotalRanges`
beside each median. Markdown includes timings, bytes and min/max ranges.
`.local/perf/tiles-paired-summary.json` provides a compact exact-byte comparison.

The exact default zoom is 0.2197265625. Its bounds intersect 781 source regions.
The baseline requests 782 PNGs: all intersect the viewport, and the additional
request is the same region's rejected community placeholder followed by its
cache fallback. The large count therefore comes from rendering the wide view,
not eager off-screen terrain. The optimized view requests 67 overview pages,
zero native tiles and zero pages outside the viewport. It retains 781 committed
visible regions. Overview pages can include adjacent regions within their
four-by-four packing, but no separate off-screen page is fetched.

After the measured suite, a rapid pan/zoom check produced nine actual Chrome
`Network.loadingFailed` events with `canceled: true` out of nine native requests
in both post-suite checks, each throttled to 30 Mbps/40 ms. Three were still
pending before returning after 20 ms. These diagnostic requests are excluded
from the measured totals.

## Visual comparison

Matched original-size screenshots cover the default view, maximum zoom 4,
intermediate zoom 0.65 and device DPR 2 (existing map-DPR cap 1.5). Their bounds,
zoom and DPR match exactly. Independent inspection found no material degradation
in chunk borders, numbers, baked text, pins, reveal alignment or transparency
edges. Overview resampling changes fine detail slightly; it is not
pixel-identical to the prior canvas downsampling.

At maximum zoom, a 185,000-pixel native-colour crop is pixel-identical. Across
the full map crop, 896,050 of 896,760 pixels are identical; the remaining 710
differ by only one channel unit. Mean absolute channel differences on the
0–255 scale are 0.0905 at default zoom, 0.3638 at zoom 0.65 and 0.1211 at device
DPR 2. All 1,214 source PNGs were also checked for colour-profile metadata;
none had ICC, gamma, cHRM or sRGB chunks.

Local artifacts:

- `.local/perf/tiles-visual-contact-sheet.png`: paired rendered map views.
- `.local/perf/tiles-visual-comparison.json`: exact framing and pixel comparison.
- `.local/perf/tiles-baseline-repeat-2-screenshots-2026-10-08T21-58-01-856Z/`:
  full-size baseline normal/throttled screenshots.
- `.local/perf/tiles-optimized-smoke-screenshots-2026-10-08T22-05-49-230Z/`:
  matching optimized screenshots.
- `.local/terrain-sample-2026-10-08-v3/contact-sheet.png` and `sizes.json`:
  native PNG, lossless and lossy encoding comparisons.
- `.local/perf/tiles-native-only-assessment.json`: complete default-view
  native-only size assessment.

## Validation and changed files

Full `npm test`: 1,672 tests, 1,671 passed, one skipped, zero failures.
The separate Python exporter suite passed all three tests. New coverage includes
five route/manifest tests and thirteen loader tests: authentication/revocation
before GET/HEAD/304, hash mismatch, absent/malformed/source-mismatched bundles,
immutable/private cache headers, path containment, PNG fallback, centre-first
order, shared concurrency, viewport bounds, stale cancellation, late callbacks
and optional-manifest timeout. Exporter tests check exact native RGBA/alpha,
transparent overview padding, source verification, source precedence and refusal
to overwrite a versioned directory. The runtime still has no dependencies.

Application changes are `app/data/terrain-assets.mjs`, `app/server.mjs` and
`app/web/{main,map,map-pins,map-terrain}.mjs`. Offline generation is in
`scripts/build-terrain-assets.py`; harness changes are in `scripts/perf/`
(`README.md`, `network-collector.mjs`, `page-load.mjs`, `probe.mjs`). Six test files
changed, including the three new terrain suites. Documentation changes are
`docs/map-assets.md`, `docs/performance.md` and this report. No CSS changed;
`.gitattributes` and its LF rules are unchanged.

The copied save, baseline archive and disposable browser/server profiles were
deleted after measurements, with zero owned server/browser processes and zero
scratch stores remaining. The frozen save hash was unchanged before deletion;
`.local/perf/tiles-cleanup.json` records the checked targets and process audit.
Local measurement/quality artifacts and new versioned exports remain. The main
checkout, live picker and Tailscale are untouched. Assets are not installed into
the deployed checkout by this work.
