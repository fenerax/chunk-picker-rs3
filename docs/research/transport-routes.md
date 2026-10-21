# Reviewed transport routes

Reviewed on 2026-10-08 against RuneScape Wiki revisions and existing copied-cache outputs. This is an evidence catalogue and an access preview for Player 1 and Player 2. No personal save or live picker was inspected, changed or restarted. No in-game journey was observed. `app/web` is unchanged.

The source segments preserve the research evidence separately: [F2P, canoes and lodestones](transport-f2p-evidence.2026-10-08.v1.md), [interiors and members networks](transport-interiors-members-evidence.2026-10-08.v1.md), and [ships and directional fares](transport-ships-evidence.2026-10-08.v1.md). RuneScape Wiki discovery used web search; facts and permalinks were verified through the RS3 Wiki API. OSRS results were excluded.

## Data and display

`app/data/transport-routes.2026-10-08.v1.json` contains stable stations, exact coordinates with coordinate evidence, directed or reversible routes, explicit `members` and `f2p` flags, requirements, revision permalinks, and remaining unknowns. The network records retain canoe variants, fare mechanics, and shortcut obstacles. Pending routes preserve verified mechanics when coordinate projection remains unresolved; they are excluded from drawn connections and access admission.

An exact station coordinate means a Wiki object/NPC map anchor, a copied-cache placement or marker, or a typed destination coordinate. It does not claim an exact player landing tile. Other maps keep their own coordinate systems, planes and source transforms. For example, Burthorpe Mine's exit is map 719 at `(117,100)`, from source `(2293,4516)`; it is never pasted onto the surface.

`scripts/build-transport-components.mjs` samples the exact station tile from the read-only plane-0 component mask and records the input SHA-256, byte offset and decoded label. Blocked object anchors stay unresolved. No adjacent tile, bounding box, component perimeter or closest component is substituted. The resulting `transport-components.2026-10-08.v1.json` is committed, so runtime evaluation needs no cache files.

For the four canoes, the display scenery tiles are blocked. `transport-access-anchors.2026-10-08.v1.json` supplies independently sourced exact named-instructor points: Barfy Bill `(3231,3252)`, Tarquin `(3203,3344)`, Sigurd `(3113,3413)` and Hari `(3133,3509)`. Each specific Wiki page explicitly places that instructor at the corresponding canoe station. The mask certifies those exact station-access components; no point was chosen by distance. Display anchors remain the canoe objects, and player landing tiles remain unobserved.

`scripts/build-transport-routes.mjs` combines the source segments and exact component evidence, then produces:

- `map-connections.2026-10-08.v2.json`: exact typed routes replace matching approximate display links. Every original retained declaration pointer survives once in provenance. `replacedConnections` identifies replacements. Cache walking edges are unchanged.
- `map-pin-details.2026-10-08.v2.json`: destinations come from those same station/route identities. Only explicitly reviewed stable pin IDs are joined, with same map/plane and a 16-tile maximum sanity check. Unreviewed transport pins keep unknown destinations.

Display kinds map ferries to `boat` and carts, gliders, balloons, stairs, ladders and caves to `transport`, matching Claude's `drawMapConnections` filter. `routeKind` preserves the precise mechanism. Directed fare records remain separate; the frontend owns the single drawn line per place pair. Global teleports have `from:null` and appear as destinations, without invented origin lines.

The previous v1 connection and pin-detail files remain intact and reproducible. Generation writes only the three new catalogue outputs; component generation writes its own new evidence file. Source segments and reviewed outputs are versioned separately.

## River Lum canoe network

The exact departure anchors are Lumbridge `(3233,3250)`, Champions' Guild `(3200,3341)`, Barbarian Village `(3110,3409)` and Edgeville `(3130,3508)`. All six ordinary pairs are F2P and reversible. See the [canoe mechanics revision](https://runescape.wiki/w/Canoe?oldid=37174554) and [station maps revision](https://runescape.wiki/w/Canoe_station?oldid=37176646).

| Canoe | Woodcutting | Destinations |
| --- | ---: | --- |
| Log | 12 | One station away |
| Dugout | 27 | Up to two stations away |
| Stable dugout | 42 | Any of the four ordinary stations |
| Waka | 57 | Any ordinary station, or the Wilderness pond |

Thus Lumbridge–Champions' Guild, Champions' Guild–Barbarian Village and Barbarian Village–Edgeville require 12; Lumbridge–Barbarian Village and Champions' Guild–Edgeville require 27; Lumbridge–Edgeville requires 42. Each route retains stronger qualifying canoe variants. An instructor can lend a hatchet; an owned hatchet is not mandatory. Conflicting familiar prose/history is retained behind a personal familiar-state confirmation.

Four Waka routes to the Wilderness pond are pending exact destination geometry. The Wiki confirms 57 Woodcutting, F2P availability and no canoe return. Neither a lake centre nor a moss-giant marker was used as its coordinate. These records preserve the fifth station's mechanics without drawing a false line or granting a return path.

## F2P boundaries and known gaps

The catalogue records the 30-coin Port Sarim–Musa Point ship, current post-quest Havenhythe service, Taverley–Daemonheim, F2P Wilderness lever behavior, basic spells and item destinations, sewers and dungeon entrances, and reviewed lodestones. It distinguishes service cost from discounts and quest-stage access. Unknown fares and partial-quest availability need stable personal confirmations.

The updated Al Kharid jetty is an ordinary bridge; the departure shipmaster was removed. The Lumbridge–Al Kharid grapple is members-only. Fort Forinthry lodestone and Wilderness obelisks are members-only. The specific current Wendlewick lodestone page establishes F2P availability despite the general network page's older list. Ashdale and Prifddinas have exact raw typed coordinates but unresolved current map projections, so their lodestone routes remain pending.

F2P shortcut records include Falador's level-5 crumbling wall, level-1 farm stiles, and the Wilderness North Volcano stepping stone and ledges. Exact obstacle anchors are retained independently from opposite-side geometry. Single-object shortcuts without verified side selectors have no invented entry edge. North Volcano raw/effective planes and sequence uncertainty remain explicit and require review before access admission.

Coverage is bounded by verified station evidence. Unreviewed quest/event teleports, ambiguous scenery identities and missing landing/side geometry remain gaps; the dataset is not an exhaustive world transportation census. The evidence reports list exclusions and conflicting sources.

## Access switch and personal facts

The single admission switch is `state.rules['access.transport']`, registered with default **false**. With it off, new routes affect display and pin information only. Existing walking, ownership, eligibility and task behavior remain unchanged. The switch adds typed entry evidence through `app/data/cache-entry-policy.mjs`; it never adds a walking edge.

Preview a **copied** state outside `.local/duo`:

```powershell
node scripts/preview-transport-access.mjs --state tests/fixtures/transport/catalogue-state.json
node scripts/preview-transport-access.mjs --state C:/path/to/copied-state.json --json
```

The preview compares OFF and ON with the same definitions, state, ownership and walking topology. It reports each member's roll additions/removals and reasons, reachable personal and capability components, partner connections, task availability/source changes, and unmet or unknown requirements. Task comparison covers the task engine, collection goals and equipment catalogue. It checks that inputs are unchanged and writes no save. Optional `--definitions`, `--routes` and `--facts` permit isolated fixtures; `.local/duo` paths are rejected.

Personal `member.transportFacts` defaults logically to `{}`. Optional maps are `levels`, `quests`, `items`, `currencies`, `conditions`, and `confirmations`. Level and count values are integers; quest/condition/confirmation values are booleans. Existing observed personal levels and completed quest evidence can contribute. Missing facts mean unknown. For example:

```json
{
  "levels": {"Woodcutting": 42},
  "currencies": {"coins": 60},
  "conditions": {"teleport-origin-permitted": true},
  "confirmations": {"canoe-familiar-state-supported": true}
}
```

The `set-transport-facts` command replaces only the chosen member's facts and participates in history/undo. `--facts` can inject a map keyed by member ID without saving it. No frontend controls were added; Claude can review the preview and expose the switch/facts after Player 1's decision.

All charter services require `charter-inventory-clear`, because the reviewed bedsheet equipment restriction cannot be checked from the existing inventory model. Entrana similarly requires equipment clearance. These personal confirmations complement fares and quest gates; advisory dialogue/cutscene preferences stay in notes.

Eligibility originates only from personally reachable unlocked components. A destination route can make a locked chunk a roll candidate; it never unlocks resources. Partner land contributes capability only when the focused member can reach it and return with her own requirements and budget. It does not generate partner chunk obligations or widen her walking frontier. F2P/membership, section blocks, exact endpoint mappings, personal levels/quests/items/fares and confirmations are checked independently. Fares and consumed items constrain paths but are never spent or deducted from the save.

## Regeneration and verification

```powershell
node scripts/build-transport-components.mjs
node scripts/build-transport-routes.mjs
npm test
```

Component regeneration requires the named read-only mask export. Catalogue and pin/connection generation uses committed files only. Run tests with `TEMP` and `TMP` set to the dedicated worktree's `.local/test-temp`; server tests use ephemeral ports and isolated stores. No service on 8788 or 8790 is used.

Tests cover data shape, pinned provenance and input hashes, F2P flags, canoe distances and pending Wilderness routes, exact tile evidence, retained-link replacement without lost provenance, unchanged walking edges and stable pins, default OFF, personal requirements, owned/partner boundaries, one-way routes, cumulative fares, task changes, undo, and read-only preview inputs.

Final full `npm test`: **1,322 tests, 1,321 passed, zero failed, one skipped**. The skipped check is the existing generated-PNG manifest check. Browser dependency verification also covers the server allowlist for the transport access module, loader and catalogue. `git diff --check` passes. The original v1 data and every `app/web` file are unchanged.

The change comprises 35 files: the versioned route segments/catalogue, exact access-anchor/component evidence, v2 map connections and pin details with their loaders; core rules/state/territory/access and task-policy integration; the server static allowlist; three generator/preview scripts; four research documents; and transport fixtures/tests plus updates to the existing map and server tests.

## Catalogue counts and preview fixtures

The reviewed exact-coordinate catalogue contains **227 routes at 156 station/obstacle anchors: 51 F2P and 176 members-only**. There are another six pending routes (five F2P, one members-only), three unresolved destinations, and nine F2P shortcut obstacles. Route counts count directed fare records separately; they are not counts of visible lines.

| Kind | F2P | Members | Total |
| --- | ---: | ---: | ---: |
| Boat/ship | 3 | 116 | 119 |
| Ferry | 0 | 2 | 2 |
| Canoe | 6 | 0 | 6 |
| Cart | 0 | 1 | 1 |
| Glider | 0 | 8 | 8 |
| Balloon | 0 | 30 | 30 |
| Portal/lever | 2 | 0 | 2 |
| Agility shortcut | 1 | 3 | 4 |
| Stairs | 4 | 0 | 4 |
| Ladder | 8 | 0 | 8 |
| Cave | 5 | 1 | 6 |
| Teleport destination | 10 | 0 | 10 |
| Lodestone | 12 | 15 | 27 |

The new connection file has **5,621 edges**, including **190 reviewed route edges** and **20 replaced old links**. All 1,946 cache walking edges and 4,216 retained provenance declarations survive. The destination table grows to 241 (204 unchanged cache candidates plus 37 reviewed globals). Transport pins improve from 9/104 specific to **25/104 specific**, with **18/104** having reviewed destinations; 79 remain basic. Exact surface-mask witnesses cover 35 stations. The remaining 121 need another verified selector/approach or interior mapping before access can be admitted.

`tests/fixtures/transport/catalogue-state.json` is synthetic: Player 1 owns Lumbridge and an initially unentered Edgeville component, Player 2 owns Barbarian Village, and Player 1 has declared Woodcutting 42 and canoe familiar clearance. With only the switch changed, Player 1's roll pool grows **4→9** (adds `12086`, `12341`, `12343`, `12598`, `12852`), her available task rows grow **165→408** (243 gains, zero losses), and the Edgeville canoe component becomes personally reachable. Her own canoe route also proves a return to the partner's Barbarian station without borrowing Player 2's requirements. Player 2 stays at zero roll entries and ten available task rows. These are generated fixture results, not a claim about either player's current map or skills.

The extra capability components have independent cache walking boundaries: Edgeville component 1 connects to Barbarian component 2; Barbarian component 1 connects to Edgeville component 6. These require the owned union for convenience access and do not become personal roll origins through partner territory.

A separate read-only preview of the public original-sync fixture, transformed within this worktree, changes neither player's pool, reachable components nor task availability because no new personal transport facts were supplied: Player 1 stays at 16 pool entries/1,666 available rows; Player 2 at 21/1,707. The preview prints missing requirements and unresolved endpoints rather than treating them as satisfied. No private `.local/duo` save was used.
