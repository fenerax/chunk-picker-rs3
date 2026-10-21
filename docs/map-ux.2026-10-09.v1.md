# Map travel lines and sticker flyout — 2026-10-09

Implemented on `codex/mapux`, from deployed `10f75a6887ba3af80bdc56089e2ead25f9f44301`.
The verified application commit is `3b5fd1195f33a23881ab19fe169444a1591f476a`.

## Behaviour

- **Map icons → Travel lines** is a native checkbox, default on. It remembers this viewer's choice in `picker.travelLines` using guarded localStorage access. Blocked storage still permits toggling for the current session. Turning lines off retains the selected chunk and invalidates only the hover canvas.
- The key combines colour with a distinct dash pattern: blue long dashes for ships; green short dashes for canoes; orange long/short dashes for carpets; purple paired dots/long dashes for teleports and portals; gold ordinary dashes for other or unclassified links. Light themes use darker shades of the same hues. The key explains that lines describe reference links and transport types.
- Nearby bearings from the selected chunk curve apart in screen space. Route identity determines their ordering, while station coordinates remain exact. Reverse duplicates stay merged; different transport types between the same chunks remain distinct. Verified one-way arrows follow the curve's final tangent. Walking and unsuitable map/plane endpoints retain their existing exclusions.
- **Port Sarim (12082)** displays four surface ship links in the current catalogue. The Musa Point and nearby southwest ship routes use distinct curves; destination labels remain visible where space permits.
- **Sticker ▸** opens the existing quick picker on hover, click, ArrowRight, Enter or Space. It sits beside the menu, flips at the right edge, and clamps or overlaps the menu on narrow screens. Pointer crossing has a short grace period. Escape or ArrowLeft closes the flyout and returns focus to Sticker, including when hover left keyboard focus on another menu item. The next Escape retains the existing parent-menu dismissal. Resize, full-editor handoff, ownership, revision, failed saves and Undo remain covered.

Travel visibility is a browser preference. The connection catalogue, access rules, task calculations and asset provenance inputs are unchanged. Existing section matching remains precise: a station record without a section ID is displayed for its whole chunk rather than inferred to belong to every section.

## Verification

- Full `npm test`: **1,882 tests; 1,881 passed, one skipped, zero failures**, 280,480 ms. TEMP/TMP were scoped to this worktree's `.local/test-tmp`. The existing optional generated skill-icon PNG byte/hash/dimension/alpha check was skipped because `SKILL_ICON_ASSET_ROOT` was not configured.
- Map-focused run: **28/28**, including eight new travel regressions and the existing hover/rendering-cost tests.
- Sticker/picker/browser run: **79/79**, including eleven new flyout regressions, eight existing quick-picker tests and sixty browser-harness tests.
- Real-copy headless browser checks passed at **1440 × 900** and **390 × 844**: Port Sarim routes, toggle persistence after reload, a saved Star sticker, pointer crossing, Escape/ArrowLeft focus return, ArrowRight/Enter opening, popup bounds and document width. There were **zero browser exceptions**. Dark, light and gray captures are listed below. These checks cover an emulated phone viewport, not a physical phone or Player 2's device.
- All nine application/test files use LF in the index and working tree. `git diff --check` passed; `.gitattributes` and hashed data/asset inputs were not edited.

## Paired performance

Both versions used the same copied save, game data and map assets, with three independent repetitions of the existing `npm run perf` harness and identical `reload,unlock` scenarios. The harness also completes the necessary cold initialization before each measured interaction.

| Task milestone | Deployed main | Final UI | Change | +10% budget |
| --- | ---: | ---: | ---: | --- |
| Reload → tasks shown | 1,984.8 ms | 819.5 ms | −58.7% | Pass |
| Unlock → refreshed tasks | 5,970.1 ms | 2,633.1 ms | −55.9% | Pass |

Concurrent host work varied substantially: baseline reload samples were 1,984.8 / 3,463.5 / 1,010.4 ms and baseline unlock samples were 8,796.1 / 5,970.1 / 5,026.5 ms. The comparison establishes **no observed regression**; the apparent improvement cannot be attributed to these UI changes. Measurement was headless localhost at 1440 × 900, DPR 1; OS file caches were not flushed. Tests and review servers did not run during this worktree's measurements.

The frozen fixture SHA256 was `f902ba633b02d1a7bcee5746faa984d3c4b7ce77dc2aa595875e873ec39154de` in both versions. The server module SHA256 was unchanged: `4d76ea76c92021922525887423ff328c36d289c4c9b381c8f1f0f92ed41fedb2`.

Ignored scalar evidence:

- `.local/perf/mapux-before-2026-10-09T10-36-58-543Z.{json,md}`
- `.local/perf/mapux-after-2026-10-09T10-52-01-851Z.{json,md}`
- `.local/perf/mapux-comparison.json`
- `.local/mapux-full-test.log`
- `.local/mapux-review-2026-10-09/checks.json`
- `.local/mapux-cleanup.json`

## Screenshots for visual review

The captures are local gameplay evidence and are excluded from Git. Absolute paths refer to this worktree on Player 1's desktop.

| Surface | Desktop, dark | Phone, light |
| --- | --- | --- |
| Port Sarim travel lines | [Desktop lines](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/desktop-travel-lines.png) | [Phone lines](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/phone-travel-lines.png) |
| Travel toggle and key | [Desktop key](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/desktop-travel-key.png) | [Phone key](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/phone-travel-key.png) |
| Sticker flyout | [Desktop flyout](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/desktop-sticker-flyout.png) | [Phone flyout](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/phone-sticker-flyout.png) |

Additional [phone gray key](C:/Users/User/Projects/chunk-picker-rs3-wt/mapux/.local/mapux-review-2026-10-09/phone-gray-travel-key.png).

## Files changed

- `app/web/map-info.mjs`: preference helpers, native control/key, transport styles and curved connections.
- `app/web/map.mjs`: guarded preference initialization, visibility setter and scheme-aware drawing.
- `app/web/map-pins.mjs`: installs the travel control above icon filters.
- `app/web/map-pin-groups.css`: scoped control/key styling.
- `app/web/sticker-picker.mjs`: anchored positioning and flyout pointer/keyboard lifecycle.
- `app/web/main.mjs`: one import and the focused chunk-menu wiring.
- `tests/map-travel-lines.test.mjs`: new preference, DOM, geometry, transport, theme and Port Sarim checks.
- `tests/sticker-flyout.test.mjs`: new pointer, keyboard, viewport, lifecycle and save checks.
- `tests/map-pin-filters.test.mjs`: supplies native SVG/style APIs in the existing DOM fixture; original assertions remain.
- `docs/map-ux.2026-10-09.v1.md`: this handoff.

## Isolation and cleanup

All edits, temporary saves, browser profiles and servers stayed in the mapux worktree. Servers bound to `127.0.0.1` on ephemeral ports, with 8788/8789/8790 rejected. The main checkout's tracked files, original duo, live picker, game client and Tailscale were untouched. No push, rebase or merge was performed.

The baseline archive, scratch stores and browser profiles were removed after their owned processes exited. The copied duo, game data and map assets were removed after the final capture run. Cleanup evidence records all three copies absent and zero review/performance scratch directories; only ignored review images, scripts and scalar logs/reports remain.
