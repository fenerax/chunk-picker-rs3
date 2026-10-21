# Map pin details and drawable connections

This work adds reference information for the copied-cache pins and retained location connections. It changes neither walking topology nor ownership, tasks, personal teleports or saves. The built-in image and December 2021 fallback pins have different identities; they do not receive details through a guessed coordinate match.

## Data and evidence

`archive/data/map-pin-details.2026-10-08.v1.json` contains one detail for every stable ID in `pins.cache-2026-10-08-05932552f7af-v1.json`. Each record has `categoryId`, `categoryLabel`, `title`, `description`, nullable `members`, `specificity`, `resources`, `destinations`, `provenance` and `unknowns`. `basic` means the category or generic scenery function is known. `specific` means additional identity, resource, fish or destination evidence exists; it does not mean every field is resolved. Every record has provenance, including basic records. The tooltip includes the title so named quests and facilities remain visible even when their description gives only instructions.

The generator reads committed, bounded input snapshots with source SHA-256 identities. Map elements and object definitions supply names. Trees and ores come from the committed cache resource catalogue in the same chunk within 32 tiles; `nearby-area` describes those placements rather than asserting that one icon is every resource node. Distinct conditional definitions and specialist resources remain distinct. A known icon does not make its nearby resources accessible.

Fishing uses RuneScape Wiki spot-type pages with revision IDs, typed location coordinates and the cache marker's encoded subtype. Matches are restricted to the reviewed local site within 12 tiles. Fish, methods, tools, bait and special catch conditions are retained separately. Wiki NPC IDs identify the documented spot type; no NPC placement was recovered from these retained cache exports. The description makes this distinction explicit. Unmatched spots retain unknown fish rather than a regional guess.

Lodestone destinations use typed cache travel structs and exact map projections. Candidate ability membership flags are accepted only when matching records agree. Activation and permission to use a lodestone remain personal facts. Other travel structs are retained as destination candidates rather than routes with invented origins.

Quest names use the marker's encoded parameter 4147 joined to quest-list sequence parameter 1345. This interpretation is independently corroborated by 407 exact decoded quest-start coordinate matches; quest-progress markers can be elsewhere. Sequence IDs, quest definition IDs, start-coordinate agreement and membership evidence are preserved. Named shops use reviewed Wiki shop polygons or NPC coordinates; ambiguous or absent marker matches stay unnamed.

## Connection endpoints

`archive/data/map-connections.2026-10-08.v1.json` preserves every retained `Connect` entry and section dependency, deduplicating reciprocal declarations while keeping every original JSON pointer. Section arrays represent incoming entry dependencies: their source points to the destination section. Stored dependency direction does not prove that gameplay travel is one-way. Unclassified links use `retained-connection`; known reviewed route kinds retain their evidence. Approximate region centres and map-label anchors are explicitly distinguished from exact entrance or boundary tiles.

Cache cardinal walking edges provide witnessed adjacent tiles on each side of a boundary, with component IDs in the cache section namespace. Invalid regions and excluded nonwalking components are filtered. These are conservative cache observations; the reference layer does not grant access or replace the existing access calculation.

Iron Enclave has a supplemental, verified two-way portal edge: Lumbridge `(3223, 3232)` to Iron Enclave `(2260, 2674)`, both displayed on map 28, plane 0. These are portal scenery anchors, not observed teleport landing tiles. The enclave is free to play, with an Ironman or Group Ironman account requirement. Sources: [Iron Enclave portal, revision 36872074](https://runescape.wiki/w/Iron_Enclave_portal?oldid=36872074) and [Iron Enclave, revision 37163617](https://runescape.wiki/w/Iron_Enclave?oldid=37163617).

The Port Sarim–Musa Point ferry is another verified, two-way boat edge. Its endpoints `(3029, 3219)` and `(2958, 3143)` are the actual cache dock markers, explicitly `map-marker-anchor` precision, with unknown exact landing tiles. The route is free to play with a base fare of 30 coins. The two pin details and [Captain Tobias](https://runescape.wiki/w/Captain_Tobias?oldid=37183451) / [Customs officer](https://runescape.wiki/w/Customs_officer?oldid=37198107) evidence supply the route; personal restrictions and discounts are separate.

Other-map and unresolved endpoints remain in the catalogue with their precision and coordinate evidence. The surface renderer skips them. It does not move interiors onto a guessed surface location. Entry policies lacking a structured origin and 180 coordinate-bearing travel structs remain separate supporting evidence and destination candidates.

## API and hooks

`GET /api/map-info` uses the existing private invitation/cookie or bearer authentication. It returns `{ schemaVersion: 1, pinDetails, connections }`. The server loads this reference catalogue on first request, caches its JSON and gzip bytes, and supports private ETag revalidation. It is separate from `/api/state` and `/api/definitions` and does not delay gameplay startup. No mutation endpoint is added.

The Node data helpers are `mapPinDetailForId(id)`, `applyMapPinDetails(pins)`, `getMapConnectionsForChunk(id)` and `mapConnectionsPayload({ chunkId })`.

The browser module is `app/web/map-info.mjs` (served as `/map-info.mjs`):

```js
const information = await loadMapInformation();
map.setMapInformation(information);

const hit = map.pinHitAt({ x, y }); // CSS pixels relative to the map stage
// hit: { pin, detail }, or null; detail is null for unmatched identities

map.setConnectionChunk('9001');
const edges = map.connectionsForChunk('9001');
map.drawConnectionLines(context, '9001', { color: '#ffd36b', lineWidth: 2 });
```

`ChunkMap.pinAt(point)` and `pinDetailAt(point)` return the pin or detail directly. `MapPinRenderer` exposes `setDetails(catalogue)`, `detailFor(pinOrId)`, `detailAt(point)` and `hitAt(point)`. Hit testing uses only the current rendered representatives, respects filtering, and follows cached pan/zoom projections. Filtering clears stale hit targets immediately. A detail arriving beneath a stationary cursor refreshes the tooltip without repainting terrain or ownership.

For another renderer, use `mapConnectionsForChunk(catalogue, id)` and `drawMapConnections(context, catalogue, { chunkId, offset, zoom, style })`. The drawing helper returns screen segments `{ edge, from, to }`, allowing Claude to add labels, hover and selection. Style accepts `color`, `lineWidth`, `alpha`, `dash`, `arrows` and `arrowSize`. Retained dependencies and unknown direction draw plain lines. An arrow requires both `directionVerified: true` and `bidirectional: false`; the current catalogue does not claim verified one-way travel from a missing reverse dependency. Canvas style is restored after drawing. Both retained IDs and projected `displayChunkId` values participate in lookup.

The existing startup fetches the optional catalogue after creating the map. The existing tooltip displays the description. Selecting a chunk or area selects its connection lines; closing chunk information or disabling it clears the selection. No panel markup or CSS is added.

## Reproduction and verification

```powershell
node scripts/build-map-pin-details.mjs
node scripts/build-map-connections.mjs
node --test tests/map-pin-details.test.mjs tests/map-connections.test.mjs tests/map-info-hooks.test.mjs tests/map-info-server.test.mjs tests/map.test.mjs tests/map-pin-renderer-cache.test.mjs
npm test -- --test-concurrency=1
```

Pin detail regeneration normally uses the committed bounded snapshots and makes no network request. Explicit capture flags read versioned retained exports or retrieve the Wiki sources. Connection regeneration reads the retained reference and the versioned `places-2026-10-08-v3` export. These scripts write only their outputs in this worktree; they do not open the game cache or a save. The copied cache's schema build 950 is inferred decoder compatibility, not a verified live-client build or evidence of completeness.

Tests cover shape, stable identity, source hashes, coverage totals, retained-declaration completeness, unknown endpoints, direction, exact portal coordinates, walking witnesses, hit testing, local-site association, projected-ID lookup, canvas state restoration and authenticated payload separation. Server tests use port 0 and isolated saves. The full run redirects temporary files and npm's cache into this worktree. Neither running picker is used.

Final verification on 2026-10-08: **1,199 tests passed, zero failed or skipped**, with `npm test -- --test-concurrency=1` (106.7 seconds). All test files ran. The change adds 29 tests: 12 pin-detail, nine connection, six browser-hook, one authenticated-endpoint and one stationary-cursor map test. Parallel full runs encountered Windows socket/resource and timing failures; the complete serial run passed the same checks with the final source and data. `git diff --check` passed.

Changed files:

- Checkout configuration: `.gitattributes` keeps the generated map JSON files at LF so recorded source hashes survive Windows checkouts.
- Data: `archive/data/map-pin-details.2026-10-08.v1.json`, `app/data/map-pin-details.inputs.2026-10-08.v1.json`, `app/data/map-pin-details.wiki.2026-10-08.v1.json`, `app/data/map-pin-details.mjs`, `archive/data/map-connections.2026-10-08.v1.json`, `app/data/map-connections.mjs`.
- Generators: `scripts/build-map-pin-details.mjs`, `scripts/build-map-connections.mjs`.
- API: `app/server.mjs`.
- Client: `app/web/map-info.mjs`, `app/web/map.mjs`, `app/web/map-pin-renderer.mjs`, `app/web/main.mjs`.
- Tests: `tests/map-pin-details.test.mjs`, `tests/map-connections.test.mjs`, `tests/map-info-hooks.test.mjs`, `tests/map-info-server.test.mjs`, `tests/map.test.mjs`.
- Documentation: `docs/research/map-pin-details.md`.

## Coverage

**2,994 pins:** 1,282 specific, 1,712 basic, all 2,994 with provenance. Membership is known for 722 pins (566 members, 156 free) and remains unknown for 2,272. Destinations are resolved for 69 markers: 67 lodestone variants and two ferry endpoints.

**5,451 connections:** 3,968 drawable on map 28, 1,483 unresolved or on another map. These preserve all 4,216 retained declarations, add 1,946 cache walking boundaries and two verified supplemental routes. There are 204 separate destination candidates from 180 travel structs. Six edges are labelled boat; other untyped reference links do not receive a guessed transport kind.

Representative details:

- Draynor Village seashore marker `(3085, 3228)`: shrimp and anchovies with a small net; sardine and herring with a fishing rod and bait.
- Draynor Elder tree marker `(3095, 3213)`: Elder, oak and willow trees within 32 tiles in chunk 12338. Nearby availability is distinct from identifying the icon as every individual tree.
- Varrock south-east mine marker `(3286, 3365)`: adamantite, copper, mithril and tin rocks within 32 tiles in chunk 13108.
- Port Sarim ferry marker `(3029, 3219)`: Musa Point, with the destination dock marker at `(2958, 3143)`; 30-coin base fare, free to play.
- Lumbridge lodestone: typed cache landing `(3233, 3222)`, free to play; activation remains required.
- Cook's Assistant start marker `(3209, 3215)`: quest definition 257 / sequence 1, exact start-coordinate match, free to play.
- Named shops: Lumbridge General Store, Lumbridge Fishing Supplies, Aubury's Rune Shop and Betty's Magic Emporium.
- Iron Enclave: the verified Lumbridge portal connection described above.

The table includes categories with no pins in this bundle. A basic record still tells the user the icon category; its missing shop name, destination, resources or requirements remain explicit unknowns. Zero specific coverage is not evidence that the facility or route no longer exists.

| Category | Total | Specific | Basic | With provenance |
| --- | ---: | ---: | ---: | ---: |
| Daily challenges (`daily-challenge`) | 0 | 0 | 0 | 0 |
| Distractions / Diversions (`distractions`) | 28 | 0 | 28 | 28 |
| Dungeon (`dungeon`) | 54 | 0 | 54 | 54 |
| Dungeon entrance (`dungeon-entrance`) | 123 | 1 | 122 | 123 |
| Dungeon exit (`dungeon-exit`) | 0 | 0 | 0 | 0 |
| God Emissary (`god-emissary`) | 7 | 0 | 7 | 7 |
| Minigame (`minigame`) | 23 | 0 | 23 | 23 |
| Player-owned house portal (`house-portal`) | 6 | 0 | 6 | 6 |
| Quest (in-progress icon) (`quest-in-progress`) | 289 | 289 | 0 | 289 |
| Quest start (`quest`) | 288 | 288 | 0 | 288 |
| Seasonal activity (`seasonal-activity`) | 0 | 0 | 0 | 0 |
| Taskmaster (`taskmaster`) | 35 | 0 | 35 | 35 |
| Agility training (`agility-training`) | 10 | 0 | 10 | 10 |
| Altar (`altar`) | 29 | 3 | 26 | 29 |
| Anvil (`anvil`) | 30 | 2 | 28 | 30 |
| Apothecary (`apothecary`) | 2 | 0 | 2 | 2 |
| Archaeologist's workbench (`archaeologists-workbench`) | 9 | 0 | 9 | 9 |
| Bonfire (`bonfire`) | 3 | 0 | 3 | 3 |
| Brewery (`brewery`) | 2 | 0 | 2 | 2 |
| Clan Citadel pedestal (`citadel-pedestal`) | 0 | 0 | 0 | 0 |
| Clan portal (`clan-portal`) | 1 | 0 | 1 | 1 |
| Combat training (`combat-training`) | 1 | 0 | 1 | 1 |
| Cooking range (`range`) | 97 | 2 | 95 | 97 |
| Corrupt altar (`corrupt-altar`) | 0 | 0 | 0 | 0 |
| Dairy churn (`dairy-churn`) | 11 | 0 | 11 | 11 |
| Estate agent (`estate-agent`) | 4 | 0 | 4 | 4 |
| Farming patch (`farming-patch`) | 82 | 9 | 73 | 82 |
| Fired Up beacon (`beacon`) | 14 | 0 | 14 | 14 |
| Furnace (`furnace`) | 24 | 0 | 24 | 24 |
| Guide (`guide`) | 9 | 1 | 8 | 9 |
| Hairdresser (`hairdresser`) | 1 | 0 | 1 | 1 |
| Hunter training (`hunter-training`) | 37 | 0 | 37 | 37 |
| Inventor's workbench (`inventors-workbench`) | 5 | 0 | 5 | 5 |
| Loom (`loom`) | 3 | 0 | 3 | 3 |
| Makeover Mage (`makeover-mage`) | 1 | 0 | 1 | 1 |
| Mini obelisk (`small-obelisk`) | 43 | 0 | 43 | 43 |
| Photo booth (`photo-booth`) | 1 | 0 | 1 | 1 |
| Potter's wheel (`potters-wheel`) | 11 | 0 | 11 | 11 |
| Prayer — Nexus (`nexus`) | 0 | 0 | 0 | 0 |
| Resting spot (`resting-spot`) | 41 | 0 | 41 | 41 |
| Sawmill (`sawmill`) | 2 | 0 | 2 | 2 |
| Slayer contracts (`slayer-contracts`) | 2 | 0 | 2 | 2 |
| Slayer master (`slayer-master`) | 8 | 0 | 8 | 8 |
| Spinning wheel (`spinning-wheel`) | 15 | 0 | 15 | 15 |
| Summoning obelisk (`summoning-obelisk`) | 8 | 0 | 8 | 8 |
| Tannery (`tannery`) | 8 | 0 | 8 | 8 |
| Vambrace exchange (`vambrace-exchange`) | 0 | 0 | 0 | 0 |
| Watermill (`watermill`) | 1 | 0 | 1 | 1 |
| Windmill (`windmill`) | 5 | 0 | 5 | 5 |
| Woodcutting stump (`woodcutting-stump`) | 4 | 0 | 4 | 4 |
| Fairy ring (`fairy-ring`) | 38 | 0 | 38 | 38 |
| Lodestone (`lodestone`) | 52 | 44 | 8 | 52 |
| Lodestone (activated icon) (`lodestone-activated`) | 28 | 23 | 5 | 28 |
| Shortcut (`shortcut`) | 111 | 40 | 71 | 111 |
| Transportation (`transportation`) | 104 | 9 | 95 | 104 |
| Other / unmapped (`other`) | 604 | 371 | 233 | 604 |
| Bank (`bank`) | 69 | 0 | 69 | 69 |
| Bank Deposit (`bank-deposit`) | 39 | 8 | 31 | 39 |
| Grand Exchange (`grand-exchange`) | 6 | 0 | 6 | 6 |
| Holiday event (`holiday-event`) | 0 | 0 | 0 | 0 |
| Excavation site (`excavation-site`) | 0 | 0 | 0 | 0 |
| Fishing spot (`fishing-spot`) | 81 | 72 | 9 | 81 |
| Mining site (`mining-site`) | 98 | 68 | 30 | 98 |
| Rare tree (`rare-tree`) | 44 | 42 | 2 | 44 |
| Runecrafting altar (`runecrafting-altar`) | 11 | 0 | 11 | 11 |
| Sandpit (`sandpit`) | 4 | 1 | 3 | 4 |
| Water source (`water-source`) | 138 | 2 | 136 | 138 |
| Wisp colony (`wisp-colony`) | 18 | 3 | 15 | 18 |
| Amulet shop (`amulet-shop`) | 1 | 0 | 1 | 1 |
| Archery shop (`archery-shop`) | 6 | 0 | 6 | 6 |
| Axe shop (`axe-shop`) | 2 | 0 | 2 | 2 |
| Candle shop (`candle-shop`) | 1 | 0 | 1 | 1 |
| Chainmail shop (`chainmail-shop`) | 1 | 0 | 1 | 1 |
| Clothes shop (`clothes-shop`) | 7 | 0 | 7 | 7 |
| Cookery shop (`cookery-shop`) | 2 | 0 | 2 | 2 |
| Crafting shop (`crafting-shop`) | 6 | 0 | 6 | 6 |
| Farming shop (`farming-shop`) | 4 | 0 | 4 | 4 |
| Fishing shop (`fishing-shop`) | 15 | 1 | 14 | 15 |
| Food shop (`food-shop`) | 15 | 0 | 15 | 15 |
| Fur trader (`fur-trader`) | 4 | 0 | 4 | 4 |
| Gem shop (`gem-shop`) | 4 | 0 | 4 | 4 |
| General store (`general-store`) | 35 | 1 | 34 | 35 |
| Gravestone exchange (`gravestone-shop`) | 1 | 0 | 1 | 1 |
| Helmet shop (`helmet-shop`) | 2 | 0 | 2 | 2 |
| Herbalist (`herbalist`) | 4 | 0 | 4 | 4 |
| Hunter shop (`hunter-shop`) | 0 | 0 | 0 | 0 |
| Jewellery shop (`jewellery-shop`) | 1 | 0 | 1 | 1 |
| Kebab seller (`kebab-seller`) | 2 | 0 | 2 | 2 |
| Lamp trader (`lamp-trader`) | 1 | 0 | 1 | 1 |
| Loyalty rewards shop (2021) (`loyalty-shop`) | 0 | 0 | 0 | 0 |
| Mace shop (`mace-shop`) | 1 | 0 | 1 | 1 |
| Magic shop (`magic-shop`) | 5 | 2 | 3 | 5 |
| Mining shop (`mining-shop`) | 2 | 0 | 2 | 2 |
| Pet shop (`pet-shop`) | 2 | 0 | 2 | 2 |
| Platebody shop (`platebody-shop`) | 3 | 0 | 3 | 3 |
| Platelegs shop (`platelegs-shop`) | 2 | 0 | 2 | 2 |
| Plateskirt shop (`plateskirt-shop`) | 1 | 0 | 1 | 1 |
| Pub / Bar (`pub`) | 24 | 0 | 24 | 24 |
| Scimitar shop (`scimitar-shop`) | 2 | 0 | 2 | 2 |
| Shield shop (`shield-shop`) | 1 | 0 | 1 | 1 |
| Silk trader (`silk-trader`) | 4 | 0 | 4 | 4 |
| Silver shop (`silver-shop`) | 1 | 0 | 1 | 1 |
| Spice shop (`spice-shop`) | 2 | 0 | 2 | 2 |
| Staff shop (`staff-shop`) | 0 | 0 | 0 | 0 |
| Summoning shop (`summoning-shop`) | 2 | 0 | 2 | 2 |
| Sword shop (`sword-shop`) | 3 | 0 | 3 | 3 |
| Tools for games (`tools-for-games`) | 1 | 0 | 1 | 1 |
| Vegetable store (`vegetable-store`) | 2 | 0 | 2 | 2 |
