# Chunk colours

Open **Colour** beside **Sticker** in chunk details or the map's chunk menu.
Choose Red, Yellow, Green or Blue, or **Clear colour**. **Name colours** gives
each colour a short label, up to 24 characters, such as Next, Maybe or Avoid.
The names and tints belong to the selected player's map. Like stickers, these
are personal planning notes: the original maps have separate annotations, and
the duo still rolls separately. Either signed-in writer can edit either map,
following the existing note and sticker permissions.

Group view shows both players' colours. Different colours share a chunk as
vertical slices; equal colours share one wash. The legend, chunk details and
hover description retain each player's own names. View-only links show the
annotations and legend without colour controls. Sandbox has no saved-colour
controls. Pick Chunk and map-click behaviour stay as they are.

Tints use a translucent wash and an inset accent. They sit above terrain and
lock fog, below grid lines, membership/roll highlights, unlocked borders,
labels, stickers and task counts. A tint does not reveal locked terrain.
The drawing model resolves colour data, theme contrast and world-space fill
paths once per model change. Overview tints use one bitmap blit, capped at
752 × 800 RGBA pixels (about 2.4 MB), and omit inset accents. Detailed cells
use at most eight palette fills and retain their inset accents. The viewport
clips both passes. Pan frames allocate no colour styles, paths or bitmaps;
empty maps allocate no tint bitmap, and replacement/disposal releases it.

## Saved commands

Both commands use the current `expectedRevision` at `POST /api/command`:

```js
{ expectedRevision: 12, command: {
  type: 'set-chunk-colour', memberId: 'player1', chunkId: '12853', colour: 'green'
} }
{ expectedRevision: 13, command: {
  type: 'rename-chunk-colour', memberId: 'player1', colour: 'green', name: 'Next'
} }
```

`colour: null` clears a chunk. `member.chunkColours[chunkId]` stores one of
the four IDs or an explicit null; `member.chunkColourNames[colourId]` stores a
personal name. Absent names use Red, Yellow, Green and Blue. Both operations
have sparse History/Undo records and survive backup/restore. They do not
change access, rolls or tasks, invalidate task claims, or discard cached task
results and prepared unlocks. A conflict requires **Reload colours** and a
fresh review before another attempt.

## Original-picker import

The retained original picker, version 6.9.68 at commit `98a3bdc`, stores
`chunks.painted[chunkId]` as an ordered array of capitalized colour names.
Its palette is Red, Orange, Yellow, Green, Blue, Pink, Purple and Black, with
up to four paints per chunk. See `reference/original-picker/index.js` at
lines 1486, 1874–1959 and 10277–10335 for the palette, drawing and save logic.

Legacy imports already preserve the whole `chunks` record under
`state.legacy.maps[member.sourceMapId]`. `resolveMemberChunkColours()` reads
those paints directly, including encoded legacy IDs. All eight original
colours remain visible, including multi-paint chunks, until a new tint or
explicit clear overrides that chunk. Undo restores the inherited paints.
The retained original records are never rewritten. Extra original colours
also appear in the legend when used; new annotations use the four controls.

The read-only check of the everyday save's retained QXA and QXB records
(revision 110, October 13, 2026) found no `painted` key in either map. The
October 7 captured public snapshot also has no paints. Tests cover synthetic
legacy paints because the checked personal records contain none.

## Verification

Focused tests cover validation, separate players, History/Undo, stale writes,
legacy paints/clears, backup/restart, actual viewer/player/admin invitations,
picker review guards, theme contrast, paint ordering and bounded drawing.
The final full suite ran once under the shared lock: 3,724 passed, one skipped,
zero failed (3,725 total). Targeted checks and the quick suite also passed.
`scripts/profile-map-page.mjs` accepts `chunkColours: true` and `groupView: true`
for a dense, two-player colour stress model; defaults remain unchanged. Its
synthetic world is self-contained because the browser no longer serves the
task-engine world module.

Copied-save desktop (1440 × 900) and phone (390 × 844) screenshots in both
dark and light themes, plus matched timing samples, are local artifacts under
`.local/screens/`. The browser uses port 9211 and the shared heavy-work lock.
The copy, server and isolated browser profile are removed after the run.

The October 13 locked comparison used Chrome, DPR 1, a 1280 × 800 renderer,
2,350 tinted cells with different colours for both players, 120 pan frames at
each of five zooms, and a 120-frame continuous zoom. Baseline and tinted
panning stayed approximately 120 fps at every zoom; continuous zoom matched
at 116.1 fps. Frame p95 stayed 8.4–8.5 ms while panning and 8.6 ms during zoom,
with no frames over 50 ms. Renderer p95 ranged from 2.4 to 4.7 ms with tints.
These synthetic desktop timings do not establish physical-phone or high-DPR
performance. The 390 px screenshots use viewport emulation.

The first dense comparison showed slower overviews with per-cell fills and
inset strokes. Cached palette paths reduced that overhead; the small overview
bitmap removed the remaining frame-rate regression. Both earlier reports
remain beside the final `colours-verification.json` for comparison.
