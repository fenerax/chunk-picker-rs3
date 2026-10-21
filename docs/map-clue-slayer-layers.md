# Clue and locked Slayer map layers

Checked against retained local sources on 2026-10-13. The data audit used no browser or external fetch. Original source files remain unchanged.

## Existing clue evidence

The selected original definitions are the frozen root export. The dated selection records an unchanged public-data check; see `app/data/original-data.2026-10-13.v1.json:5` and the verified loader in `app/data/original-data.mjs:12`.

| Source | Existing data | Use and limit |
| --- | --- | --- |
| `rs3-chunkpicker-chunkinfo-export.json:168908`, `challenges.Nonskill` | 1,538 records with `ClueTier`: easy 100, medium 122, hard 122, elite 1,012, master 182 | Every record explicitly has `Not F2P: true`. There are no supported free-to-play clue steps in this source. |
| `rs3-chunkpicker-chunkinfo-export.json:239898`, `clues` | Tier-to-region sets: easy 54, medium 91, hard 102, elite 283, master 68 | Records both surface IDs and named interiors. These sets support tier location markers, not personal eligibility. |
| `rs3-chunkpicker-chunkinfo-export.json:300069`, `mapOverlays.Clues` | 1,302 markers with `x`, `y`, `type`, `text`, `color` | Original map presentation includes exact coordinates and clue text. The count differs from step records; markers are not a complete one-to-one step catalogue. |
| Each `chunks[id].Sections[section].Clue` | Tier counts in specific retained sections | Useful for location evidence. These counts do not establish items, skill levels or quest completion. |

Step requirements use `NPCs`, `Chunks`, `Tasks`, `Monsters`, `Skills`, `Items` and `Objects`, alongside `ClueType`, `ClueTier` and membership. An emote example requires chunk 10291, Studded body, Bronze platelegs, Mud pie and Defence 20. NPC-only steps require an entity-location lookup. Elite scan records can represent different positions in the same region. A marker must not claim that a player can complete the step, or an entire scroll, from its tier and region alone.

The original UI counts valid steps after worker evaluation (`reference/original-picker/index.js:4182`), displays tier probabilities (`:9489`), lists doable text (`:9977`), and separately lists unlocked and locked tier regions (`:9998`). The C10 layer uses the latter location semantics. Its membership messages are:

- F2P: “Clue steps are members-only. No free-to-play steps are recorded.”
- Members: “Recorded clue locations; items, quests and full-scroll completion are not checked.”

The original map menu has tier checkboxes and an unlocked-only filter (`reference/original-picker/index.js:11384` and `:11433`). Its coloured clue pins use exact retained coordinates, and selecting a pin opens step text or a map image (`:2268`–`:2354`). Its locked Slayer overlay fills target chunks red and draws a large Slayer icon (`:2064`–`:2082`). These were inspected as local, read-only reference code; the original website and Firebase service were not opened. C10 uses small inset outlines to keep the authored picker's existing annotations readable.

## Existing Slayer evidence

`codeItems.slayerTasks` maps 159 assignment categories to retained monster names (`rs3-chunkpicker-chunkinfo-export.json:238025`). `codeItems.reaperTasks` provides equivalent boss sets (`:239201`). Examples include Cows → Cow/Cow calf and Abyssal demons → several distinct demon variants. `slayerMasterTasks` records master-specific assignment weights, Slayer levels, combat levels and task prerequisites (`:418255`). It supports an assignment reference but is not needed to show an already saved assignment.

`codeItems.slayerTaskChunks` is empty (`:239368`). The original renderer consumes it (`reference/original-picker/index.js:2066`), but no producer is present in retained scripts. The layer therefore derives surface locations by matching assignment aliases against `chunks[id].Sections[section].Monster` declarations. It merges repeated section declarations into one per-chunk label. Hash variants may match their mapped base name; parenthetical variants remain exact. It never guesses a target from pluralization or a broad family name absent from the assignment mapping.

The saved personal schema is `null` or `{ level, monster?, boss? }`, with an integer level from 1 through 120 and optional nonempty text targets (`app/core/player-controls.mjs:12`). A typical declaration is `{ "level": 5, "monster": "Cows", "boss": "None" }`. `None`, `Manually Locked` and `Select a task` do not identify a target. Legacy fallback reads `state.legacy.maps[member.sourceMapId].chunkinfo.slayerLocked`; an explicit personal `slayerLock: null` clears the fallback (`:32`). Legacy target names use the existing `decodeLegacyText` decoder before matching assignment names. Original saved lock handling is retained at `reference/original-picker/index.js:8556`.

The layer follows the saved declaration for the selected player. It does not clear a lock when planning finds a reachable target; the engine already owns that planning behavior (`app/tasks/engine.mjs:388`). It supports a saved Reaper target using the same location rules. Unknown assignment text produces an explanation rather than an invented location.

## Membership and access limits

Free land is insufficient proof of a free monster. Existing membership evidence comes from `sourceMembershipRecord` (`app/data/source-membership.mjs:33`) with reviewed records overriding older rows. The `verified-infobox` and `verified-row` statuses distinguish verified admission from unresolved or mixed families. Existing global and location-specific gates remain in `app/data/access-policy.mjs:31`.

For F2P Slayer markers the model applies these geographic and explicit membership checks:

1. The base ID belongs to `world.f2p`.
2. Neither the chunk nor section explicitly declares `Not F2P`.
3. Existing source membership blockers allow that monster and placement.
4. Verified `members: true` evidence excludes the exact retained monster name.

Unknown or mixed membership records keep their recorded geography and add “Some monster membership is unverified.” A free family page does not prove that every numbered or named variant is free, and the marker does not claim free membership. For example, the retained Cow membership is a reviewed mixed family; its recorded surface placements remain visible with uncertainty. This follows gameplay's distinction between explicit membership restrictions and unresolved identity. The model does not evaluate quest gates, Slayer equipment, task unlocks, manually denied sections, combat readiness or the selected player's movement access. Its visible note states that access and combat requirements are unchecked.

Named interiors are omitted from both layers. A `Connect` relationship establishes topology but does not establish an exact surface target location. This implementation does not place cave monsters on inferred overland squares. Future interior markers need a reviewed entrance mapping and an explicit presentation of the entrance rather than the monster's position.

## Implemented model and data boundary

`app/map-layer-data.mjs` projects the definitions into `{ chunks, clues, codeItems: { slayerTasks, reaperTasks }, monsterMembership }`. Only numeric chunks are included. Each chunk retains only optional `Not F2P` and its section IDs; each section retains only `Monster` and optional `Not F2P`. Old records without sections retain their top-level `Monster`. Other chunk content and all named interiors are excluded. Membership values contain only `{ members, status }`; the full evidence catalogues stay on the server. The projection reads existing membership evidence and changes no original definitions or saved state.

`app/web/map-activity-layer-model.mjs` exports `buildMapActivityLayers({ definitions, world, state, memberId })`. It returns `clues` and `slayer` maps keyed by numeric base chunk IDs, plus `tiers`, `clueNote`, `slayerNote` and `slayerLabel`. Clue rows have `{ tier, label }`; Slayer rows have `{ label }`. The model prefers projected `definitions.monsterMembership` and also accepts `world.monsterMembership` for fixtures. Static source scans are cached by definitions and world object identity; changing personal locks and membership mode rebuilds only the output maps.

Focused tests cover the models, renderer, browser toggles and authenticated data route. Static geography and tier masks are resolved outside the drawing loop. A viewport bitmap has 160 CSS pixels of padding per edge and backing density capped at 1.5. Safe pans need one bitmap draw. Dense cache builds reuse at most three small outline templates instead of rasterizing thousands of paths. Sparse builds and the no-canvas fallback use one path per enabled layer with dark casing and coloured strokes. The outlines render after roll fills and before roll numbers, labels and stickers.

During zoom, a covered bitmap can be reprojected within a 0.7–1.4 scale ratio. Outlines refresh to their fixed CSS widths after 90 ms without another zoom change. Going outside the coverage or scale bounds rebuilds immediately. Model, tier, theme, viewport and density changes invalidate the cache. Turning both layers off or disposing the map releases its backing store and pending timer. With both layers off, drawing issues no activity canvas operations.

Choices stay under `picker.activity-layers` in browser storage, so changing them does not write the save, History or Undo. The first enabled layer lazily reads `/api/definitions?view=map-layers-v1`; later switches reuse that compact projection. Viewer links expose the same browser controls without saved controls. Legend rebuilds preserve focus on the changed layer control.

## Copied-save verification — October 13, 2026

The isolated check used a copy of the duo save, port 9251 and a temporary Chrome profile under the shared heavy-session lock. A revision-checked command set Cows as the copied player's lock. F2P showed nine surface chunks, an explicit membership uncertainty note, and no clue markers. A members preview in that copy showed 12 Cows chunks and 52 easy-clue chunks in the displayed surface. Blue chunk colour and a white star in chunk 12595 tested overlapping annotations. These fixture edits never reached the original save.

The screenshots cover each layer and both together at 1440 × 900 and 390 × 844 in dark and light themes. F2P, Map display and viewer controls have additional captures. The phone views use desktop Chrome at phone dimensions. Layer switches kept the save revision unchanged, persisted on reload, synchronized between the legend and Map display, and preserved keyboard focus in the desktop legend. The viewer exposed local layer choices and zero saved Map display controls. Captures and measurement JSON remain ignored under `.local/screens/`; its `README.md` indexes the final images.

The existing `profileMapPage` timing tool now accepts `activityLayerModes` and optional recorded `activityLayerEntries`. The same isolated session measured 60 pan frames after 15 warmup frames at zoom 0.1, 0.35, 1 and 4, then 120 continuous zoom frames. The fixture keeps chunk colours, group view, task counts, place names and map icons enabled. The recorded comparison includes all 334 supported clue-region chunks and the 12 Cows chunks; it uses all clue tiers, which is denser than the easy-tier screenshots. A second comparison deliberately marks every one of the 2,350 surface cells with both layers.

| Measurement | Layers off | Both layers on |
| --- | ---: | ---: |
| Recorded locations, continuous zoom: render p95 | 5.9 ms | 6.0 ms |
| Recorded locations, continuous zoom: frame p95 | 16.7 ms | 16.7 ms |
| Recorded locations, continuous zoom: fps | 108 | 101 |
| Recorded locations, continuous zoom: frames over 50 ms | 0 | 0 |
| Artificial all-cell stress, continuous zoom: render p95 | 7.1 ms | 8.8 ms |
| Artificial all-cell stress, continuous zoom: fps | 105 | 88 |
| Artificial all-cell stress, continuous zoom: frames over 50 ms | 0 | 1 |

All recorded-location pan modes stayed at 116–120 fps with no frames over 50 ms; both-layer modes were approximately 120 fps at every measured zoom. The artificial all-cell pan modes stayed at 114–120 fps with no frames over 50 ms. Recorded geography shows no material increase in measured rendering time. The deliberately dense continuous zoom still has overhead and one 58.4 ms frame, so these checks do not establish equal performance for an arbitrary future layer covering the whole map. Final measurements are in `.local/screens/layers-timing-final.json`; earlier tuning runs remain separate from these results.

The one locked full-suite attempt ran 3,824 tests: 3,816 passed, seven failed and one was skipped. All seven failures were screen fixtures missing the new controller registration. The shared screen harness now registers it, and search fixtures select their dialog's mode control rather than the first select anywhere on the page. A focused rerun of all three screen-harness consumers passed 248 tests. Layer, map and read-only route checks passed 58 tests; the final quick suite passed 1,151. The full suite was not repeated under the one-run limit.

The fixture server and browser were stopped, the save copy and profile deleted, and the original save's state fingerprint still matched the pre-copy value. Changelog and roadmap data were left unchanged for the merge coordinator.
