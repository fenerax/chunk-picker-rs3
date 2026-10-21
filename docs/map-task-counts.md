# Task counts on the map

Unlocked chunks with active tasks show a small count badge. **Map display →
Show task counts** turns the layer on or off; it defaults on. **Task counts
size** uses the same 60–200% browser-only range as the other label sizes.
**Reset sizes** resets the size without changing visibility. These controls
are available to view-only links and make no save or History changes.

Counts use the default Active Tasks view: presented available obligations,
excluding completed, hidden and backlogged tasks. Sidebar search, owner chips,
skill filters and Show blocked do not change them. Group view counts each shared
task once per chunk, using location evidence from its active attributed owners.
Sections contribute to their base chunk once. A task can count on several chunks
when it uses something in each. Tasks without a surface location, including
some global tasks and named interiors, have no map badge; they remain in Active Tasks.

The layer hides while results are stale, while the combined Group results are
incomplete, and in Sandbox. It returns after coherent saved task results arrive.

Text stays at least 11 CSS pixels even at minimum zoom. Badges prefer a clear
corner; crowded or tiny chunks use a leader to their chunk. Placement reserves
roll numbers, IDs, sticker clusters, starting flags, ownership tabs and death
markers. Layout and badge artwork are cached across pans, with an edge adjustment
for badges whose chunks are on screen. Ordinary pans copy occupied regions from
one cached bitmap. Small zoom steps reuse placement after checking current
marker positions. During zoom, visible glyphs draw directly from a second atlas;
the first steady redraw refreshes the grouped bitmap. The glyph atlas reuses
count artwork at the current font and pixel density, capped at 512 × 512 CSS
pixels. Size, viewport, pixel density and task updates refresh the relevant
caches. A bounded placement search prevents unusually crowded fixtures from
blocking rendering. Both canvases are released when the map closes.
Annotation source cells are cached with the scene; zoom skips unmarked cells,
while visible chunk IDs still reserve the full grid.

Location evidence is projected in the calculation worker once per result,
using the existing chunk planning index over presented task rows. Compact task
responses carry only task IDs and associated surface IDs. The browser merges
the default task rows and counts once per coherent state/result update; canvas
painting receives a cached Map and never selects or indexes tasks.

`scripts/profile-map-page.mjs` accepts `taskCounts: true` for a matched badge
paint comparison. The fixture assigns counts to 180 unlocked chunks, a denser
overlay than the copied duo save. Browser evidence and timings stay local under
`.local/screens/mapcounts-review.json`.

## Verification — 2026-10-13

Verified implementation `fa83672` on Windows with Node 24.20.0 and headless
Chrome, using the shared heavy-work lock. The copied duo save stayed at revision
109 with 76 History entries. Personal counts matched default Active Tasks for
Player 1 (16 rows, 2 chunks) and Player 2 (17 rows, 4 chunks); Group matched for either
selected player (19 rows, 5 chunks). Browser-local display changes left the save
unchanged. A viewer link exposed four local size sliders and no saved controls,
and its count visibility persisted after reload. No browser exceptions occurred.

Desktop 1440 × 900 and phone 390 × 844 captures are in `.local/screens/`, along
with largest-marker captures. The phone sweep covered six zooms from 0.055 to 4
and all three size settings (60%, 100%, 200%); every on-screen count was shown.
Largest IDs, roll numbers, overflowing stickers and two starting flags were
checked together. These are browser viewport checks, not physical-device tests.

Paint comparisons used the same synthetic 180-unlocked-chunk canvas, first with
180 badges and then with the copied save's five count locations. This is a
controlled fixture, not a timing measurement of the complete real save. Each
zoom alternated off/on/off/on, with 240 sampled pan frames after 120 warmup
frames. The table gives the average of the two run medians, in milliseconds.

| Zoom | 180 badges off → on | Saved counts off → on |
| --- | --- | --- |
| 0.055 | 2.80 → 2.75 | 2.35 → 2.25 |
| 0.1 | 2.60 → 2.70 | 2.30 → 2.25 |
| 0.35 | 3.75 → 3.65 | 3.00 → 3.35 |
| 0.65 | 3.65 → 3.80 | 3.05 → 2.70 |
| 1 | 2.85 → 3.75 | 3.25 → 2.80 |
| 4 | 2.75 → 2.65 | 2.75 → 2.70 |

The first dense zoom-1 result exceeded a local 0.75 ms diagnostic budget by
0.15 ms. A focused repeat kept the implementation unchanged and used three
off/on pairs, each with 480 sampled frames after 240 warmup frames. Its median
paint average was 3.07 → 3.23 ms (+0.17 ms), at 119.83 → 119.66 FPS. Each on block
built one layout and bitmap, then reused them throughout the pan.

Continuous zoom used 120 sampled frames per off/on block. Average paint p95 was
7.10 → 7.45 ms for 180 badges and 6.45 → 6.15 ms for saved counts. Overall pan FPS
was 88.67 → 86.91 in the first dense matrix and 119.87 → 119.99 with saved counts;
desktop frame pacing varied during the first matrix. No sampled frame exceeded
50 ms, and no badge was unplaced in either fixture or the focused repeat.
The complete original measurements remain in
`.local/screens/mapcounts-review-first-full.json`; the final browser checks and
focused repeat are in `.local/screens/mapcounts-review.json`.

The final full `npm test` run under the shared lock completed with 2,841 tests:
2,840 passed, 0 failed and 1 skipped. The skipped optional generated skill-icon
PNG check requires `SKILL_ICON_ASSET_ROOT`, which was not configured. The focused
renderer, obstacle and Map display checks also passed (55/55). Scratch save and
Chrome directories were removed, ports 8811/8812 were closed, and the existing
picker on port 8788 remained running.
