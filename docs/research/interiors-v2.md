# Interior display catalogue v2

The active [interior catalogue](../../app/data/cache-interiors.2026-10-08.v2.json) maps **1,403 of 1,979 retained off-surface records**, adding **510 mappings** to v1 and retaining **576 explicit unknowns**. Its **422 maps, 447 independent map planes and 2,242 PNG tiles** include every previously mapped record. [Connections v3](../../archive/data/map-connections.2026-10-08.v3.json) retains all **5,621 connection IDs** and their access-related declarations.

This is display evidence. It changes no ownership, walking topology, membership, quest gates, task eligibility or personal teleport availability. The API and catalogue schema remain compatible; the active wrappers select additive data versions. The [v1 report](interior-maps.2026-10-08.v1.md) remains a historical record.

| Coverage | v1 | v2 |
| --- | ---: | ---: |
| Mapped / unknown records | 893 / 1,086 | 1,403 / 576 |
| Mapped named aliases, out of 419 | 164 | 308 |
| Maps / map planes / tiles | 246 / 263 / 1,361 | 422 / 447 / 2,242 |

## Reviewed identities

| Retained area | Display map / plane | Evidence and limits |
| --- | --- | --- |
| Puro-Puro, `10307` | 168 / 0 | The encoded Wheat maze layout, retained source region and magic-wheat scenery identify the static maze. Its central square and exact surrounding 8×8 paste halo are rendered; this is actual static wheat layout coverage. |
| War's Retreat, `13214` | 10003 / 0 | Reviewed source squares 50–51,158 provide the island artwork. Wiki map 10003 and named portal/scenery corroborate the identity. This is a display template with `cacheMapId:null`; no JS5-23 identity is invented. |
| Death's Office, `1546` | 10004 / 0 | Reviewed source square 6,10 and area-specific scenery establish the static office template. `cacheMapId:null` identifies an application display template. Scenery on higher planes does not create floor layers. Closure's neighbouring study remains separate. |
| City of Um, `23` | 742 / 0–2 | Encoded Underworld pastes translate source planes 1–3 to display planes 0–2. The absent source plane 4 is excluded. The whole map also contains disconnected coverage and is not an enclosure for the city. |
| Mysterious Old Man's cellar, `5706` | 653 / 0 | Source square 22,74, exact Pinball-post scenery and the Evil Bob Tribute paste establish the correspondence. The different retained and cache names remain visible in evidence. |
| City of Um troll cave, `25` | 10005 / 0 | Matching cave-opening object IDs, source square 18,31 and independent Wiki/cache review establish a static template. `cacheMapId:null`. Wiki click coordinates and planes differ from cache object origins; no landing alignment is inferred. |
| Daemonheim - Depths excavation site, `34` | 10006 / 1 | Typed Archaeology sub-area/hotspot references, source square 34,144 and nine exact scenery placements establish a separate static template with `cacheMapId:null`. Coordinates come from copied-cache placements of the referenced hotspot parents. No exact entrance route is established. |

Other mapped priorities include Kharid-et Barracks 720, Star Lodge 724, Fort Forinthry Prison 751, Falador and Varrock pig pits 60/59, Falador Farm storm cellar 56, Dreamer's Cave 69, Al Kharid resource dungeon 383, Taverley Well Cave 173, Vinesweeper 143, Chamber of Shrines 92 and Varrock Museum Basement 119. These identities were checked against the final catalogue, rather than inferred from proposal counts.

## Research scope and unresolved records

The retained public fixture was captured on **2026-10-08 at 02:23 UTC**. Its union supplies **153 unlocked surface records**, **26 selected records**, **7 selected candidates after excluding unlocked records**, and **41 orthogonal neighbours**. The offline priority helper applies undirected breadth-first search to retained `Connect`, section dependencies and map connections, collapsing sections to their parent records. This measures research relevance. It does not calculate gameplay reachability or roll eligibility, and it makes no claim about the current private duo save.

The original 1,086 unknowns were researched in this order. Each record retains its rank and a declaration-path witness; all disconnected records were also examined.

| Research priority | Originally unknown | Newly mapped | Still unknown |
| --- | ---: | ---: | ---: |
| Public-fixture unlocked chunks | 392 | 233 | 159 |
| Selected candidates | 15 | 11 | 4 |
| Orthogonal neighbours | 102 | 60 | 42 |
| Remaining disconnected declarations | 577 | 206 | 371 |

The complete layout sweep inspected **771 zone/paste records**, yielding **481,288 exact 8×8 blocks** across 746 active maps and 786 active map planes. Dormant zero-block layouts and invalid source planes were skipped; overlapping layouts would be rejected rather than resolved by paste order. A separate copied-cache location sweep examined **5,241 archives with zero errors**. Among the original 831 unknown numeric records, coordinate research produced 344 proposals, retained 100 ambiguities, rejected packed-coordinate inference for 45 small synthetic IDs and found no explicit witness for 342 records. These research counts precede the independent named/template review and final rendering.

Only explicit source blocks, projected labels, typed coordinates and reviewed scenery/identity evidence support mappings. A zone centre in empty space or an overlap with broad map bounds is insufficient. Equal-name aliases inherit a mapping only when reviewed numeric identities agree. An area's semantic `bounds` stays null; its layer bounds describe exact rendered coverage or a reviewed static source template. Partial source-region coverage does not turn a shared map into an area enclosure.

Unknown examples remain material: Rex Matriarchs devices and door positions do not establish one complete entry/arrival transform; a Wilderness/Fort Forinthry Old Crypt correspondence does not identify the retained Senntisten Old Crypt; generic Dungeons of Daemonheim and Homestead records lack a verified single static template. **Borehole `12127` remains unknown** because its coordinate proposal produced no non-empty rendered floor layer. The same rejection applies to `8009` and `10312`. Repeated tutorial or quest templates remain unresolved when the evidence cannot select one identity.

## Entrances and connection display

Exact cache object origins are scenery anchors. Reviewed counterparts may identify a route, but do not prove the player's landing tile. War's Retreat has separately documented teleport/Insignia arrival evidence at **3294,10127, plane 0**, labelled `exact-arrival`; its provenance explicitly says that live player arrival was unobserved. Source planes, display planes and their translations are retained independently. Approximate region/label anchors and unresolved declarations keep their weaker precision.

Connections v3 attaches `offSurface` and `interiorMap` metadata to relevant endpoints. Off-surface endpoints have no invented surface coordinates, and affected edges have `drawable:false`; this prevents lines through surface-map void. IDs, route requirements and access declarations remain preserved. Source-region display anchors and `/api/interior-maps?area=…` references support navigation without inserting access edges.

All seven Draynor Crossroads destinations—Puro-Puro, War's Retreat, Death's Office/Domain, City of Um, the Old Man's cellar, the Skullery and Draynor Sewers—have mapped references and no surface line. The catalogue retains 1,664 connections involving off-surface endpoints. Of these, 832 endpoints remain coordinate-unresolved; mapped artwork alone cannot establish a route station. All **1,946 exact cache walking connections remain byte-for-byte unchanged**, including ten rows whose surface coordinates collide with the retained Clan Citadel numeric alias. Typed plane-0 cardinal-boundary evidence identifies those rows as surface walking.

## API and browser hooks

Authenticated `GET /api/interior-maps?area=10307` continues to return the area's maps, layers, entrances and installed tile URLs. The response adds `version:2026-10-08.v2`; complete-catalogue queries still use `GET /api/interior-maps`. Known unresolved records return `status:unknown`; missing IDs return 404. Missing or mismatched asset manifests preserve evidence with null tile URLs. Installed tiles use `/assets/map/interiors.cache-2026-10-08-v2-reviewed/<mapId>/2/<plane>_<x>_<y>.png` with the existing authenticated, hash-checked asset serving.

`app/core/interior-maps.mjs` keeps its indexed area/map/tile/entrance and pixel-address functions. It now permits map 28 only with explicit selected off-surface coverage metadata, and validates area-layer crops against rendered bounds. Connections expose `offSurface:true` and `interiorMap:{areaId,status,mapIds,layers,api}`; off-surface `worldX`, `worldY` and `displayChunkId` are null. Unresolved coordinates are also null with a reason.

The existing `interiorCandidates` helper in `app/web/interior-view.mjs` now recognizes retained `Name` identities even when their numbers overlap the surface grid, so Draynor's Inside tab can discover Puro-Puro. It also accepts explicit off-surface endpoint references. Ordinary surface `Nickname` records remain excluded. `showChunk` was not edited.

## Assets, provenance and verification

The selected directory is this worktree's `.local/map-assets/interiors.cache-2026-10-08-v2-reviewed`. Its manifest SHA-256 is `c14358e36c1e8e5499011f03afcebd633ab3b21249ee86f4592ed03385f7d793`. Publication is local to the `interiors2` worktree; the main checkout's assets and asset selection were not replaced. Historical versions remain intact. The public art pack redacts the five build-machine paths in that manifest's `inputs` and `sources`, so the catalogue now pins the public copy, SHA-256 `157710dc1ae3d1958611cb76b72230b2bd726552d7bf0eb748b06cedabb72e99`; tiles and their hashes are unchanged.

The renderer and opcode interpreter are pinned to rsmv commit `a92b8920b9b9842adde78822646ecad1a6f4fc15`, using inferred compatible schema build 950 and `@resvg/resvg-js` 2.6.2. `CacheCopy` opens copied databases read-only with SQLite query-only enabled. Renderer/helper repository hashes use [Git LF hashing](../../scripts/lib/provenance-hash.mjs); copied evidence, databases, PNGs and manifests use exact bytes. Flat floors/basic walls omit sprites, labels and scenery models. Shared water and void are transparent, with the existing renderer's floor/water limits preserved.

The independent [PNG verifier](../../scripts/cache/interiors-v2-verification.py) checked **2,242 tiles**, **28,801,056 PNG bytes**, **592 fully transparent tiles** and **92,901,058 transparent pixels**, with **zero errors**. It checks hashes, dimensions, RGBA encoding, transparent-pixel colour, definition-backed coverage and Puro-Puro's exact wheat footprints. Empty tiles remain explicit coverage records. The contact sheet under `.local/interiors-v2-research/samples.reviewed.png` supports visual inspection; this is not an observed in-game visit.

The immutable render manifest records generation-time inputs and source hashes. [Evidence finalization](../../scripts/cache/interiors-v2-finalize.mjs) subsequently repaired the contradictory Wiki arrival description and rebuilt connection metadata with the typed surface-walking exception. It restored the ten colliding walking rows, restricts interior declarations to explicit interior identities, and refreshes the catalogue hash in connections. The catalogue records this step and its source hashes separately in `evidenceFinalization`. Route/access fields and immutable PNG/manifest bytes are unchanged. Generation and metadata finalization therefore have separate provenance.

The final full **`npm test -- --test-concurrency=1`** passed in **241.71 seconds**: **1,449 passed, zero failed/cancelled, one skipped** (1,450 discovered). The skip is the existing optional skill-icon bundle check. All **25 added regression tests** passed; the final focused run including seven transport tests passed **32/32**. TEMP/TMP pointed to task-owned worktree scratch. The full log is `.local/interiors-v2-final-npm-test.log`.

The first full run during rendering had a performance-limit failure, a terminated map-info response and an exact-walking-row comparison failure. The walking comparison exposed the numeric alias collision and led to the typed surface-witness fix. With rendering stopped and metadata frozen, the complete rerun passed. No performance limits, unrelated expectations or test intent were relaxed; the deliberate transport-v2/interior-v3 assertion split is described below.

## Reproduction

Keep the reviewed evidence bundle `.local/game-data/interiors-2026-10-08-v2-reviewed` and the historical asset versions available. Use new report, asset, catalogue and connection paths; rendering refuses existing outputs. These commands create review artifacts without replacing the active wrappers:

```powershell
node scripts/cache/interiors-v2-priority.mjs --output .local/interiors-v2-research/priority.NEW.json
node --max-old-space-size=1536 scripts/cache/interiors-v2-layout-proposals.mjs --output .local/interiors-v2-research/all-layout-coordinate-proposals.NEW.json
node --max-old-space-size=1536 scripts/render-cache-interiors-v2.mjs --base-catalogue .local/game-data/interiors-2026-10-08-v2-reviewed/base-catalogue.json --base-assets .local/map-assets --proposals .local/game-data/interiors-2026-10-08-v2-reviewed/all-layout-coordinate-proposals.json --review .local/game-data/interiors-2026-10-08-v2-reviewed/resolutions.json --priority .local/game-data/interiors-2026-10-08-v2-reviewed/priority.json --output .local/map-assets/interiors.cache-NEW-VERSION --catalogue .local/interiors-v2-research/cache-interiors.NEW.json --connections .local/interiors-v2-research/map-connections.NEW.json
python scripts/cache/interiors-v2-verification.py --assets .local/map-assets --catalogue .local/interiors-v2-research/cache-interiors.NEW.json --output .local/interiors-v2-research/verification.NEW.json --samples .local/interiors-v2-research/samples.NEW.png
node --test tests/interiors-v2-catalogue.test.mjs tests/interiors-v2-connections.test.mjs
```

The focused tests exercise the selected committed catalogue. A newly rendered candidate needs its own catalogue selection before that command can validate it. The finalizer names the active v2 catalogue/connection files explicitly and is a separate evidence-maintenance step, not part of immutable raster reproduction.

## Files changed

- Runtime: versioned interior v2 and connection v3 JSON, their active wrappers, `app/core/interior-maps.mjs`, `app/server.mjs` and the existing `app/web/interior-view.mjs` helper.
- Research/rendering: `scripts/render-cache-interiors-v2.mjs`, `scripts/cache/interiors-v2-*` helpers and `scripts/preview-interior-maps.mjs`'s default catalogue selection.
- Verification: four `tests/interiors-v2-*.test.mjs` files. The existing transport test still compares every walking row with its baseline and now checks the transport merge against its explicit v2 output, before the deliberate v3 interior display pass.
- Documentation: this report and a current-version link in `archaeology-and-interiors.md`. Existing LF rules apply to all new text.

Generated PNGs and frozen local evidence are ignored worktree artifacts. The selected asset version must accompany the commit when it is installed elsewhere. No private save, main-checkout tracked file, original game cache or live picker was used or changed; no push, rebase or merge was performed.
