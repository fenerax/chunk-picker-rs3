# Place names on the map

**Map display → Place names** shows names on the existing map. It defaults on,
with softer semibold text and a small contrasting halo. Dark and gray maps use
pale text; light maps use dark text. High visibility strengthens the halo.
The switch stays in
this browser, including on view-only links and in Sandbox; it makes no save,
History or Undo changes. Reset sizes leaves its visibility choice alone.

Zoomed-out views show large region names. From zoom 0.16, town names appear;
from 0.65, smaller places appear and broad region names disappear. The levels
follow the game's text sizes, so some mountains and swamps share the town
level. Names try nearby vertical, horizontal and diagonal positions, with regions
winning over towns and small places. Crowded names can shrink to at least 12px
or disappear. Unlocked interiors are a last resort when no nearby free position
fits; their markers and outer border remain protected. A name never covers
another name, a roll number, chunk ID, task-count badge or its leader, sticker,
starting flag, owner tab, death marker, chunk colour accent or floating panel.
Partly clipped names are hidden at the viewport
edge. These are display labels, not geographic boundaries or travel evidence.

## Source and export

The versioned runtime file is `app/data/place-labels.2026-10-13.v1.json`.
It contains all 312 cropped surface labels in the existing October 8 copied-cache
export: 28 regions, 58 towns and 226 smaller places. Havenhythe, Amberfell,
Wendlewick, Heathervein, Berylbrook, Fenmoor, Shuruk-Ba, Linbog Village and Globin
Village are included. [Source details](research/place-labels.2026-10-13.v1.md)
record input hashes, the decoder and map-paste projections. No original cache
or extraction was changed, and no web fallback was needed.

The export script checks its input against the existing extraction manifest
and writes a new output exclusively. It refuses writes into its source
directory. Eight conditional labels and alternate names retain their source
metadata; the display does not infer personal quest or varbit state. Collision
priority chooses one name at a shared anchor or overlapping alternatives. Named interiors and other
map planes are outside this surface layer.

## Rendering

`app/web/map-place-labels.mjs` owns data loading, selection, collision placement
and raster text. The small hooks in `map.mjs` draw into its existing annotation
canvas after task counts. It also supports the map's three-canvas fallback.
It shares the badge renderer's rectangle index and annotation-obstacle helper.
The current screen badge placements reserve their viewport-adjusted positions.
The dedicated layer takes over existing text-only map pins, avoiding duplicate
names; icon sprites and search-location rings keep their existing behavior.

One raster atlas holds all names at base 12, 14 or 17 CSS-pixel text sizes;
smaller placements reuse those sprites.
Nearby zoom steps reuse projected rectangles at the lower edge of a 1.25× zoom
tier, moving their centres while keeping text size fixed. An eight-entry cache
bounds layouts; collision fitting runs only near the viewport at the current
zoom. Annotation geometry is checked during fitting, and current viewport-adjusted
badge positions, leaders and fixed panels are checked before painting.
Adjustments are bounded at 80px for regions, 48px for towns and 24px for small
places, and visible names at 32. Fitting
uses the viewport plus 192px padding, refreshed after a 128px pan. Active zoom
frames use 48px padding; the first steady frame restores the wider pan margin.
Zoom skips distant names and ordinary pans reuse the artwork and fitted layout.
Only nearby border and colour geometry enters the label index; the shared count
index is reused without mutation. Panel observers refresh geometry on visibility,
resize, details or scroll changes, ignore unchanged geometry and reserve only
visible paint from this map. Pixel density, model, theme and display changes
refresh the relevant cache; closing the map releases the atlas and observers.

The pure tests cover zoom selection, source projection, label/annotation
collisions, zoom-tier and pan reuse, viewport-adjusted badges, removed counts,
failed optional loads and disposal. Display tests cover storage failures,
default visibility, reload restoration, reset and viewer/Sandbox behavior.
`scripts/profile-map-page.mjs` accepts `placeNameModes` for matched off/on runs
and reports label-layer p95 separately from whole-render p95.

## Initial implementation verification — October 13, 2026

The archived baseline (`138095d`) and final profiling runs used the shared
heavy-work lock, Chrome at 1280×800/DPR 1, 180 revealed chunks with task badges,
1,160 real terrain files and 2,054 pins. The baseline measured 240 pan frames
after 120 warmup frames. The final run measured 480 after 240, with two off/on
pairs at each zoom. Both measured 240 continuous-zoom frames per mode.

| Zoom | Archived baseline p95 | Final names off p95 | Final names on p95 | On − off |
| --- | ---: | ---: | ---: | ---: |
| 0.055 | 2.70 ms | 1.95 ms | 1.90 ms | −0.05 ms |
| 0.10 | 2.40 ms | 1.75 ms | 2.05 ms | +0.30 ms |
| 0.35 | 2.00 ms | 1.50 ms | 1.40 ms | −0.10 ms |
| 0.65 | 1.70 ms | 1.20 ms | 1.15 ms | −0.05 ms |
| 1 | 2.50 ms | 1.10 ms | 1.30 ms | +0.20 ms |
| 4 | 2.50 ms | 0.95 ms | 0.80 ms | −0.15 ms |
| Continuous zoom | 5.00 ms | 3.10 ms | 3.40 ms | +0.30 ms |

Final columns are the mean of each pair's p95 values, not a pooled percentile.
Machine load varied between sessions, so the same-session off/on comparison
is the useful overhead measurement. The label layer itself measured 0.1–0.2 ms
p95 for pans and 0.4–0.5 ms for continuous zoom, meeting the approximately
0.5 ms budget in this fixture. No terrain fetch failed and no measured frame
exceeded 50 ms. Raw evidence is in `.local/screens/placenames-baseline.json`
and `placenames-after.json`; earlier optimization samples remain alongside them.

All final screenshots were captured in one locked copied-save browser session
at 1440×900 and 390×844, covering overview, medium, close, Havenhythe/Amberfell
and snow, plus the viewer display panel. Every view had names, no text-only pin
duplicates, no label/annotation/badge overlaps and no horizontal page overflow.
The viewer toggle restored after reload. There were no page errors or display
write requests; save bytes, revision 109 and 76 History entries stayed unchanged.
The copy was deleted and both browser/server sessions were closed. Screenshots
use `.local/screens/placenames-{1440,390}-{out,medium,in,havenhythe,snow}.png`
and the corresponding `display-viewer.png` files; details are in
`.local/screens/placenames-review.json`.

The one full-suite run passed 3,319 of 3,320 tests, with one optional generated
skill-icon asset check skipped. Later UI-only optimizations passed the focused
renderer/collision checks and all 798 quick tests. The full suite was not repeated.

## Placement polish verification — October 13, 2026

[The collision audit](map-place-labels-placement-review.md) lists the original
affected names at each viewport and zoom, the final placements and raw timing
results. [The screenshot gallery](../.local/screens/labels-gallery.md) links all
38 before/after images: 1440×900 and emulated 390×844, dark/light, minimum,
default and close zooms, plus Havenhythe and gray/dark/light high visibility.
All final images came from one locked server/browser session on a copy of
revision 110 with 163 group-unlocked chunks and coherent real duo task counts.
The actual map theme was checked alongside the page theme.

All 19 final views had zero name/name or hard-obstacle collisions, failed tiles
or horizontal overflow. Some names remain inside owned areas after nearby free
candidates fail; the audit records them. There were no page errors or save
commands, and save bytes stayed unchanged. The save copy and browser profile
were deleted, and the server/browser were stopped.

The denser timing fixture uses IDs, task badges, group annotations and real
chunk-colour arrays. Pan label p95 was 0.3–0.9 ms. Continuous zoom reached
7.0 ms label p95; this exceeds the initial implementation's approximate 0.5 ms
target in this heavier fixture. Whole-render results varied even with names
off, so they do not establish a zoom speed improvement. Ordinary pans retain
their cached layouts and artwork.

All 85 focused renderer/placement tests and 1,169 quick tests passed. No new
test file was added; the existing label tests remain classified as quick.
The full suite was skipped for this UI-only change. `map.mjs`, shared CSS,
save code and data were unchanged. The parallel Clue/Slayer work is not part
of this branch's verification.
