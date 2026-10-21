# Map display

Open **More → Map display**, or **Map display…** in Settings. Settings closes so
you can see your changes on the map. The small panel has no backdrop: drag the
map or scroll to zoom beside it. On screens up to 720px wide, the panel becomes
a bottom sheet limited to 40% of the screen height. Its controls scroll within
the sheet. **Done** or **Esc** closes it.

The four size sliders run from **60% to 200%**, with **100%** as the default:

- **Roll numbers size** changes the large numbers on chunks in the roll pool.
- **Chunk IDs size** changes the small numbers near the bottom-right corner.
  **Show chunk IDs** turns those numbers on or off.
- **Sticker and flag size** changes your sticker clusters and starting flags.
- **Task counts size** changes active-task badges. **Show task counts** defaults
  on and stays in this browser. [Task counts](map-task-counts.md) explains counting
  and crowded map labels.

**Place names** defaults on and shows region, town or smaller names as you zoom
in. Crowded names are hidden to keep map annotations clear. Its browser-only
switch also works on view-only links and in Sandbox. [Place names](map-place-labels.md)
records the surface-cache source and zoom rules.

**Clue steps** and **Locked Slayer task** default off. Their browser-only controls
also appear in the map legend and work on view-only links and in Sandbox.
Clues can show one tier or all tiers; F2P explains that no steps are recorded.
Slayer follows the selected player's saved target. The inset outlines leave
chunk colours, roll numbers and stickers visible. [Layer data and limits](map-clue-slayer-layers.md)
explains the recorded geography and unchecked requirements.

**Reset sizes** restores all four sliders to 100%. Size choices are kept in
this browser for both players and view-only links. They do not change the save
or add History entries. The controls still work if browser storage is blocked.

Chunk IDs, high visibility, unlocked border colour and the starting-marker
chooser have moved from Settings to this panel. For players, these retain their
existing saved commands, History and Undo. A view-only link shows the four
sizes, task counts switch and its existing browser-only Chunk IDs switch; saved choices are hidden.
Saved choices are unavailable while trying changes in Sandbox.

The map keeps its normal zoom rules: IDs appear when cells reach 35px, and
stickers appear from 18px. Larger text shrinks when necessary to fit inside its
chunk. IDs stay left of starting flags, including when both players began in
the same chunk. Sticker clusters retain their four-icon limit, owner bars and
**+N** count; larger icons may leave room for fewer stickers. Hover still lists
all stickers. See [Stickers](stickers.md) for saved sticker editing.

## Implementation

`app/web/map-display.mjs` stores only `rollNumberScale`, `chunkIdScale`,
`stickerScale`, `taskCountScale`, `showTaskCounts` and `showPlaceNames` under `picker.map-display` in guarded localStorage calls. Slider
events coalesce to one animation frame, then call `ChunkMap.setDisplayPreferences()`.
That method updates existing display preferences and marks only the state or
marker canvas as needed; it never rebuilds the model, requests data or starts
task work. When a map is read, artwork for its saved stickers is cached, including
stickers behind the **+N** chip. Revealing one with a size change therefore needs
no new image request. Saved controls use the existing commands. Viewer IDs continue to
use `picker.viewer-preferences`.

`layoutStickerCluster(members, chunkId, size, scale = 1)` accepts the optional
sticker/flag scale. The drawing methods multiply the existing zoom-dependent
font sizes, then fit labels and flags to their available chunk space.

## Copied-save check — October 12, 2026

Desktop Chrome at 1440 × 900 and a 390 × 844 viewport passed the Settings handoff,
Done/Esc, pan and zoom with the panel open, reload persistence and view-only
controls. All three themes were inspected at 60% and 200%. The narrow sheet
measured 337.6px tall (40% of the viewport), with saved controls available by
scrolling within it. This is desktop Chrome at phone dimensions, not a physical
phone check.

The copied save has Player 1's starting flag in Edgeville (12342), Player 2's in 12338,
and no saved stickers. A browser-only fixture put six stickers per player and
both flags in Edgeville to inspect clusters, the **+8** chip and the ID beside
both flags at all themes and size limits. Those fixture markers were never saved.
The screenshots remain ignored under `.local/display-screenshots/`; representative
captures are `1440-gray-largest-dual-flags-sticker-fixture.png` and
`390-light-largest-dual-flags-sticker-fixture.png`.

Forty rapid changes to each slider coalesced into one state redraw and one marker
redraw, with zero terrain redraws and zero API requests. Both players' ownership,
selected chunks, pending rolls, rank order, save revision and History stayed
unchanged during the size edits:

| Player | Unlocked before → after | Selected before → after | Active tasks before → after |
| --- | ---: | ---: | ---: |
| Player 1 | 158 → 158 | 2 → 2 | 25 → 25 |
| Player 2 | 114 → 114 | 19 → 19 | 26 → 26 |

The combined list stayed at 28 tasks, with 23 shared. The view-only panel exposed
only sizes and browser-only IDs and sent no writes. The isolated server and
browser were stopped and private save copies removed after checks. See
[Performance](performance.md#map-display--october-12-2026) for the matched reload
measurements and source fingerprints.

Final `npm test`: 2,480 tests, 2,479 passed, zero failures and one existing
generated-PNG check skipped. This includes local-storage failures, frame batching,
saved-control races, Sandbox, viewer controls, font/flag bounds, sticker overflow,
and revealing cached skill artwork without a request. Prediction goldens are unchanged.
