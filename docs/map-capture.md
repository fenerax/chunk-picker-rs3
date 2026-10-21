# Map screenshots and PNG downloads

**More → Screenshot mode**, or **Shift+S** while outside a text field or dialog,
shows only the map. The current labels, stickers, starting flags, ownership,
membership overlay and map icons remain visible. Pan and zoom still work; chunk
clicks and context menus are paused. **Esc** or a double-tap on the map leaves.
The small exit hint fades after a few seconds. This view is local to the tab;
refreshing returns to the normal picker. It sends no commands and works for
view-only invitations.

If Helper is open, Screenshot mode temporarily reveals the map and restores
Helper when you leave. Whole-map download also works from Helper; return to the
map to download its visible area.

**More → Download map image…** offers **Whole map PNG** and **Visible area PNG**.
Both use the current player, Group view, theme and map display options. The
visible-area image includes the map under any panels, without those panels.
Images are limited to **4,096 pixels on the longest side**. The current whole
surface produces a **3,850 × 4,096** PNG. The download has progress, cancellation
and an error that allows retrying. Unavailable terrain uses the same fallback
artwork as the map and is reported after the download.

## Implementation

`screen-capture.mjs` owns browser controls, the shortcut and the root
`screenshot-mode` class; `map-capture.css` hides chrome through its ancestors,
including panels added by other features. It does not change saved preferences.

`map-capture.mjs` snapshots display geometry, model preferences and map caches,
then calls the existing map painters through an independent facade. Terrain
loads in small panels with three concurrent requests and a 64-tile native cache.
It retains only panel previews, creates no world-sized terrain mipmaps, and
renders pins once across the final output with the existing filtering and
aggregation. One output canvas uses at most 64 MiB of RGBA pixels; two reusable
512 × 512 panels and tile-sized canvases bound additional raster work. Encoding
and browser image decoding have their own temporary memory costs.

The only hook in `map.mjs` retains the current asset manifest. The shared drawing
methods supply roll numbers, chunk IDs, stickers, flags, ownership, membership,
Sandbox marks, death markers and persistent map highlights; pointer hover is
omitted. Future overlays added to those painters follow the same export path.

Downloads use an anchor with a short-lived blob URL. No blob image preview,
inline script or inline style is added, and the existing CSP stays unchanged.
Closing the download dialog cancels its renderer; canvases and private terrain
and pin caches are released on completion, failure or cancellation.

## Verification

Focused tests cover geometry, panel bounds, private caches, cancellation,
snapshot consistency, shortcuts, touch exit, viewer controls and dialog retries.
All 27 focused capture tests passed. The full suite ran once through the shared
heavy-work lock: 2,886 tests, 2,884 passed, one failed and one skipped. Its only
failure is the pre-existing roadmap validator: C5 is `done` without a `done`
date in the base commit. Roadmap data and its validation test were not changed.

Headless Chrome checks at 1,440 px and a 390 px touch-emulated viewport exercised
the strict CSP, both PNG sizes, Helper restoration, exit controls and view-only
downloads. Capture sent no save commands; the isolated copied save and its
History remained unchanged. The whole-map PNG was visually checked for tile
seams and aligned flags, stickers, IDs and roll numbers.

The viewer run logged one startup HTTP 409 response, without a JavaScript
exception or a failed capture action. It appears consistent with the existing
task-cache wait response; the browser log did not identify its URL. Physical
phone testing and integration with the parallel search and task-count branches
remain outside this branch's verification.
