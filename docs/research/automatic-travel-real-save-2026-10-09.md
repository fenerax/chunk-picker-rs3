# Automatic travel comparison of the duo's copied save

Date: October 9, 2026. This report compares the same hydrated private save for Player 1 (`exampleGIMab`, QXA) and Player 2 (`twosamplegim`, QXB). The copy has revision 73, with Player 1 owning 151 chunks and selecting 4, and Player 2 owning 113 and selecting 20. These are the copied picker records, rather than a newly fetched original-picker map or an observation of gameplay.

The same copied save produced the following baseline → automatic-and-transport comparison: Player 1: rolls 8 → 8, Active 6 → 6, possible 1586 → 1586; Player 2: rolls 21 → 21, Active 6 → 6, possible 1573 → 1573. Automatic travel identifies 16 usable routes per player, including 7 strict access routes and 9 roll-only Home Teleports. Global roll eligibility and strict resource access are reported separately. Automatic availability alone and the combined access scenario are both measured below.

The three scenarios preserve every other saved setting and completion, including disabled consumable teleports:

| Scenario | `travel.automatic` | `access.transport` |
| --- | --- | --- |
| Baseline | false | false |
| Automatic availability | true | false |
| Automatic availability and transport access | true | true |

The distinction matters. A usable teleport can add a locked destination to a future personal roll; it grants no resources or obligations in that destination. Transport access can connect already unlocked territory, with the existing requirement that partner convenience access has a legitimate return route. Tasks remain obligations of the player's own chunks. These semantics follow [PRODUCT.md](../../PRODUCT.md#confirmed-duo-semantics).

## Saved evidence and fresh public observations

Neither copied member record contains RuneMetrics skill observations, RuneMetrics quest observations, or explicit transport facts. Automatic skill levels therefore come from reachable training ceilings and are marked estimated. Renewable item and fare evidence means the unchanged baseline capability graph can supply them; it does not establish current inventory, bank contents or coin balances. Reachable lodestones use the automatic activation policy; this is an inferred capability, rather than proof of their current in-game activation.

Four bounded public RuneMetrics GETs succeeded at approximately October 10, 2026, 01:13:58 UTC, which was October 9 local time. Responses are retained in the worktree's ignored `.local/automatic-travel-runemetrics/` directory. They were read separately and were never applied to the copied save, the comparison state or the live game records.

| Observation | Player 1 | Player 2 |
| --- | ---: | ---: |
| Magic | 55 | 54 |
| Woodcutting | 77 | 47 |
| Strength | 63 | 66 |
| Agility | 5 | 5 |
| Firemaking | 65 | 60 |
| Construction | 4 | 5 |
| Completed quest entries, including miniquests | 17 | 37 |
| Quest points, summed from completed entries | 20 | 56 |

These observations come directly from the public Jagex [Player 1 profile](https://apps.runescape.com/runemetrics/profile/profile?user=exampleGIMab&activities=0), [Player 2 profile](https://apps.runescape.com/runemetrics/profile/profile?user=twosamplegim&activities=0), [Player 1 quests](https://apps.runescape.com/runemetrics/quests?user=exampleGIMab) and [Player 2 quests](https://apps.runescape.com/runemetrics/quests?user=twosamplegim). The APIs are dated observations and can lag gameplay.

Of the route catalogue's quest requirements, both public records confirm **Necromancy!** and **Visions of Havenhythe**. Player 2 also has **The Blood Pact**; Player 1 does not. Neither public record marks **Dragon Slayer** completed. Potentially completable quests and the partner's task checks do not establish personal quest completion.

The copied-save results below describe potential saved capabilities. Current public levels can differ from those estimates. No prospective sync or current-level scenario is mixed into the three main comparisons.

Automatic spell checks currently require literal rune supplies; equipped elemental-staff substitutions are not modelled. Manual confirmation can establish personal roll usability, while resource access still requires the recorded supply costs. A staff does not replace the law rune. This [catalogue limitation](automatic-teleports-evidence.2026-10-09.v1.md) does not affect the three measured scenarios because consumable teleports remain disabled.

Canoe availability includes preparation to dismiss an optional familiar before travel. This expresses a planning capability and does not assert which familiar is currently summoned. A saved explicit false confirmation remains a gate. Other unknown achievement, boss, construction and quest conditions still require their supported personal evidence.

The [route catalogue](../../app/data/transport-routes.2026-10-09.v2.json) records Woodcutting 12, 27 and 42 for the six ordinary station pairs. Both separate public observations exceed these gates. Its four **Waka-to-Wilderness routes require 57**, above Player 2's observed 47. Those routes are pending because the exact Wilderness arrival coordinate is unresolved; they remain unavailable for both players even if a copied-save training ceiling exceeds 57. They also record a one-way arrival, so they cannot establish a return canoe journey.

## Reproduction and count definitions

Run from this worktree with Node.js 22 or later:

```powershell
node scripts/research/compare-automatic-travel.mjs --data-dir .local/teleports-save --output .local/automatic-travel-report.json
```

[The reusable script](../../scripts/research/compare-automatic-travel.mjs) reads an explicitly named copy under this worktree's `.local/`, outside `.local/duo`. It refuses symbolic links/junctions, sensitive invitation/token/feedback files, and output paths outside the local worktree directory. Static fields are decompressed and checked against their recorded SHA-256 hashes. The complete copied-file inventory is hashed before and after calculation, without emitting its contents. Core source files, the imported route catalogue and the tracked app diff are also checked for changes. A changing input or implementation rejects the report.

One production task worker calculates the three scenarios sequentially for both players. The report's roll and route evaluator uses those same baseline task results as its automatic capability source. No server, storage writer, network request, sync command or gameplay command runs in the comparison script.

**Possible tasks** are production `availableCount`: available own obligations before the Active display filtering. They can include already completed, hidden or backlogged tasks. **Active tasks** are unfinished, visible, presented own obligations, excluding completed and backlogged goals. Counts do not add custom tasks and do not apply search, show-all or show-blocked display filters.

**Own access** is `obligationAccess`, the player's owned task territory. **Shared access** is `access`, including the partner's reachable convenience territory. Chunk bases, retained sections, cache components and named areas are counted separately. A component ID is not interchangeable with a retained section ID.

The JSON report retains full named reachable scopes and eligible roll pools for every scenario, every usable route, unresolved endpoint reasons, exact named roll additions/removals, and every changed Active/possible task ID and label. The tables below summarize those results; the delta lists preserve their exact identities.

## Calculated results

The successful report was generated at 2026-10-10T02:54:08.187Z. The main comparison contains only the original copied save. Its [JSON result](../../.local/automatic-travel-report.json) is retained locally.

| Scenario | Player | Active | Possible | Roll pool | Displayed usable routes | Strict access routes | Roll-only teleports |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | Player 1 | 6 | 1586 | 8 | 0 | 0 | 0 |
| baseline | Player 2 | 6 | 1573 | 21 | 0 | 0 | 0 |
| automatic | Player 1 | 6 | 1586 | 8 | 16 | 7 | 9 |
| automatic | Player 2 | 6 | 1573 | 21 | 16 | 7 | 9 |
| automatic-transport | Player 1 | 6 | 1586 | 8 | 16 | 7 | 9 |
| automatic-transport | Player 2 | 6 | 1573 | 21 | 16 | 7 | 9 |

| Scenario | Player | Own chunks | Own sections | Own components | Own areas | Shared chunks | Shared sections | Shared components | Shared areas |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | Player 1 | 151 | 596 | 405 | 77 | 157 | 613 | 418 | 82 |
| baseline | Player 2 | 113 | 461 | 307 | 76 | 158 | 602 | 410 | 82 |
| automatic | Player 1 | 151 | 596 | 405 | 77 | 157 | 613 | 418 | 82 |
| automatic | Player 2 | 113 | 461 | 307 | 76 | 158 | 602 | 410 | 82 |
| automatic-transport | Player 1 | 151 | 596 | 405 | 77 | 157 | 613 | 418 | 82 |
| automatic-transport | Player 2 | 113 | 461 | 307 | 76 | 158 | 602 | 410 | 82 |

Displayed global availability uses the separate rollAvailable result and pinned surface chunk evidence. Strict access availability still requires exact component geometry. A roll-only teleport can add a personal future roll but cannot connect resources or partner territory. Local transport needs a reachable departure and an affordable outward-and-return journey before it can connect either an isolated owned component or partner territory.

Strict access availability is a geometry/requirements result. It expands reachability only when access.transport is enabled. Local route rows also retain currentlyReachableDeparture and ownReachableDeparture; the named lists distinguish personal route availability from an unreachable departure.

Both automatic scenarios display **16 usable routes per player**: six bidirectional ordinary canoe pairs and ten Home Teleports. Seven have strict access geometry; nine globals have roll-only destination evidence. All six local departures are reachable in both own and shared scopes for each player. All nine roll-only destination chunks are already owned by both players, which explains why the broader teleport list adds no new roll candidate in this particular save.

Player 1 already had **11575 — Burthorpe** as a walking candidate from **11574 — North Taverley**. Its Home Teleport is usable, and its exact component is already reachable in the shared scope. Player 2 already owns Burthorpe. The canoe endpoints are already connected in these evaluated maps, so the six canoe routes add no task territory.

The built-in roll evaluator skips redundant automatic inclusion work for destinations already fully eligible or unconditionally excluded. Player 1's Burthorpe retains its three walking reasons in both automatic scenarios; redundant Home Teleport and access.transport inclusion reasons are omitted. The full route API still lists its usable Home Teleport. This optimization can omit redundant automatic provenance while preserving the eligible destination identities.

Exact endpoint geometry remains a separate access limit for most lodestones and boats, even where pinned surface evidence supports a future teleport roll. City of Um reports an unknown station chunk. Wendlewick lacks saved personal quest evidence, even though both separate fresh public responses confirm Visions of Havenhythe. F2P Port Sarim/Musa Point and Taverley/Daemonheim boats are blocked by missing exact tile evidence. These results do not prove every legitimate gameplay route was represented.

Some retained chunk names differ from the travel names: Taverley lands in **11317 — Catherby Beach**, Falador in **11829 — Invention Guild**, Varrock in **12852 — Gower Farm**, and the Edgeville lodestone in **12086 — Edgeville Monastery**. The report uses the catalogue's independently verified destination chunk IDs and the picker's retained names; it does not move destinations to a chunk merely because its name matches the travel label.

### Exact saved roll pools and Active labels

**Player 1**

- Baseline eligible roll pool: 11575 — Burthorpe; 12336 — South of Wizard Tower; 13118 — North-West Wilderness Volcano Edge; 13374 — North Wilderness Volcano Edge; 13617 — Abbey of St. Elspeth Citharede; 13882 — East Daemonheim Castle; 9769 — Ashdale cliff; 9770 — Ashdale cave entrance.

| Active task | Category | ID |
| --- | --- | --- |
| Gertrude's Cat Complete the quest | Quest | rs3:task:00239c |
| Missing, Presumed Death Complete the quest | Quest | rs3:task:002649 |
| Purple Cat (miniquest) Complete the miniquest | Quest | rs3:task:0027d4 |
| Archaeology Mystery: Prison Break Complete the mystery | Quest | rs3:task:002baa |
| Lumbridge Achievements Complete the Hard Achievements | Diary | rs3:task:002de8 |
| Obtain an Explorer's ring 4 | BiS | rs3:goal:equipment:000502 |

**Player 2**

- Baseline eligible roll pool: 11834 — Forgotten Cemetery; 12080 — Mudskipper Corner; 12088 — Dark Warriors' Fortress; 12090 — Forinthry Dungeon; 12345 — South-West Wilderness Crater; 12599 — Center Wildy Ditch; 12602 — North-East Wilderness Crater; 12854 — Varrock Palace; 12857 — Graveyard of Shadows; 13113 — Black Salamander Hunting Area; 13366 — Silvarea Pass; 13370 — Charming Moths; 13617 — Abbey of St. Elspeth Citharede; 13882 — East Daemonheim Castle; 13883 — Daemonheim North Coast; 16689 — South-West Havenhythe Shore; 16944 — Here Be Crabs; 17201 — Anya's Tent; 17206 — Saradominist Watchtower Ruins; 17457 — Deserted Mine; 17462 — Loot Under the Waterfall.

| Active task | Category | ID |
| --- | --- | --- |
| Dragon Slayer Complete the quest | Quest | rs3:task:0021f8 |
| Gertrude's Cat Complete the quest | Quest | rs3:task:00239c |
| Purple Cat (miniquest) Complete the miniquest | Quest | rs3:task:0027d4 |
| Archaeology Mystery: Prison Break Complete the mystery | Quest | rs3:task:002baa |
| Lumbridge Achievements Complete the Hard Achievements | Diary | rs3:task:002de8 |
| Obtain an Explorer's ring 4 | BiS | rs3:goal:equipment:000502 |

## Estimated levels and current public levels

| Player | Skill | Copied-save automatic estimate | Fresh public level |
| --- | --- | --- | --- |
| Player 1 | Agility | 5 | 5 |
| Player 1 | Construction | 3 | 4 |
| Player 1 | Firemaking | 110 | 65 |
| Player 1 | Magic | 99 | 55 |
| Player 1 | Strength | 120 | 63 |
| Player 1 | Woodcutting | 110 | 77 |
| Player 2 | Agility | 5 | 5 |
| Player 2 | Construction | 3 | 5 |
| Player 2 | Firemaking | 110 | 60 |
| Player 2 | Magic | 99 | 54 |
| Player 2 | Strength | 120 | 66 |
| Player 2 | Woodcutting | 110 | 47 |

**Player 1:** No catalogue-available route has a known skill gate above the separate public observation.

**Player 2:** No catalogue-available route has a known skill gate above the separate public observation.

Consumable travel remains disabled in all three scenarios, so higher estimated Magic does not authorize rune-consuming standard spell teleports. The current-level discrepancies above are evidence limits, not additional main-scenario results.

## Exact changes

### baseline → automatic

**Player 1** — Active 6 → 6 (+0); possible 1586 → 1586 (+0); roll pool 8 → 8.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

**Player 2** — Active 6 → 6 (+0); possible 1573 → 1573 (+0); roll pool 21 → 21.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

### automatic → automatic-transport

**Player 1** — Active 6 → 6 (+0); possible 1586 → 1586 (+0); roll pool 8 → 8.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

**Player 2** — Active 6 → 6 (+0); possible 1573 → 1573 (+0); roll pool 21 → 21.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

### baseline → automatic-transport

**Player 1** — Active 6 → 6 (+0); possible 1586 → 1586 (+0); roll pool 8 → 8.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

**Player 2** — Active 6 → 6 (+0); possible 1573 → 1573 (+0); roll pool 21 → 21.

- Rolls added: none.
- Rolls removed: none.
- Active tasks added: none.
- Active tasks removed: none.
- Possible tasks added: none.
- Possible tasks removed: none.

Own/shared reachable chunks, sections, components and areas: no changes.

## Named available teleport and transport lists

Each table gives the exact displayed-usable route and known destination chunk. Roll-only global routes have pinned chunk evidence and unresolved strict access geometry. “Reachable departure” includes global routes; local routes additionally need the displayed departure. Estimated gates remain labelled. The JSON retains access blockers, roll evidence and full named reachable scopes.

### baseline

**Player 1**

Saved manual usable teleports: none.

Available catalogue routes: none.

**Player 2**

Saved manual usable teleports: none.

Available catalogue routes: none.

### automatic

**Player 1**

Saved manual usable teleports: none.

| Group | Route | Destination chunk | Resolved departure → destination | Gate evidence / use |
| --- | --- | --- | --- | --- |
| transport | Barbarian Village canoe station ↔ Edgeville canoe station (canoe-barbarian-village--canoe-edgeville) | 12342 — Edgeville | 12341-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Barbarian Village canoe station (canoe-champions-guild--canoe-barbarian-village) | 12341 — Barbarian Village | 12852-1000002 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Edgeville canoe station (canoe-champions-guild--canoe-edgeville) | 12342 — Edgeville | 12852-1000002 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Barbarian Village canoe station (canoe-lumbridge--canoe-barbarian-village) | 12341 — Barbarian Village | 12850-1000001 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Champions' Guild canoe station (canoe-lumbridge--canoe-champions-guild) | 12852 — Gower Farm | 12850-1000001 → 12852-1000002 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Edgeville canoe station (canoe-lumbridge--canoe-edgeville) | 12342 — Edgeville | 12850-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| lodestones | Home Teleport to Al Kharid (home-teleport--lodestone-al-kharid) | 13105 — Al Kharid | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Burthorpe (home-teleport--lodestone-burthorpe) | 11575 — Burthorpe | global → 11575-1000001 | No estimated level gate; strict access geometry; reachable departure |
| lodestones | Home Teleport to Draynor (home-teleport--lodestone-draynor) | 12339 — Draynor Crossroads | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Edgeville (home-teleport--lodestone-edgeville) | 12086 — Edgeville Monastery | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Falador (home-teleport--lodestone-falador) | 11829 — Invention Guild | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Lumbridge (home-teleport--lodestone-lumbridge) | 12850 — Lumbridge | global → unresolved | No estimated level gate; roll eligibility only; access blocked |
| lodestones | Home Teleport to Port Sarim (home-teleport--lodestone-port-sarim) | 12082 — Port Sarim | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Taverley (home-teleport--lodestone-taverley) | 11317 — Catherby Beach | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Varrock (home-teleport--lodestone-varrock) | 12852 — Gower Farm | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Wilderness Crater (home-teleport--lodestone-wilderness-crater) | 12600 — Wilderness Drakolith Mine | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |

**Player 2**

Saved manual usable teleports: none.

| Group | Route | Destination chunk | Resolved departure → destination | Gate evidence / use |
| --- | --- | --- | --- | --- |
| transport | Barbarian Village canoe station ↔ Edgeville canoe station (canoe-barbarian-village--canoe-edgeville) | 12342 — Edgeville | 12341-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Barbarian Village canoe station (canoe-champions-guild--canoe-barbarian-village) | 12341 — Barbarian Village | 12852-1000002 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Edgeville canoe station (canoe-champions-guild--canoe-edgeville) | 12342 — Edgeville | 12852-1000002 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Barbarian Village canoe station (canoe-lumbridge--canoe-barbarian-village) | 12341 — Barbarian Village | 12850-1000001 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Champions' Guild canoe station (canoe-lumbridge--canoe-champions-guild) | 12852 — Gower Farm | 12850-1000001 → 12852-1000002 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Edgeville canoe station (canoe-lumbridge--canoe-edgeville) | 12342 — Edgeville | 12850-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| lodestones | Home Teleport to Al Kharid (home-teleport--lodestone-al-kharid) | 13105 — Al Kharid | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Burthorpe (home-teleport--lodestone-burthorpe) | 11575 — Burthorpe | global → 11575-1000001 | No estimated level gate; strict access geometry; reachable departure |
| lodestones | Home Teleport to Draynor (home-teleport--lodestone-draynor) | 12339 — Draynor Crossroads | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Edgeville (home-teleport--lodestone-edgeville) | 12086 — Edgeville Monastery | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Falador (home-teleport--lodestone-falador) | 11829 — Invention Guild | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Lumbridge (home-teleport--lodestone-lumbridge) | 12850 — Lumbridge | global → unresolved | No estimated level gate; roll eligibility only; access blocked |
| lodestones | Home Teleport to Port Sarim (home-teleport--lodestone-port-sarim) | 12082 — Port Sarim | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Taverley (home-teleport--lodestone-taverley) | 11317 — Catherby Beach | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Varrock (home-teleport--lodestone-varrock) | 12852 — Gower Farm | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Wilderness Crater (home-teleport--lodestone-wilderness-crater) | 12600 — Wilderness Drakolith Mine | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |

### automatic-transport

**Player 1**

Saved manual usable teleports: none.

| Group | Route | Destination chunk | Resolved departure → destination | Gate evidence / use |
| --- | --- | --- | --- | --- |
| transport | Barbarian Village canoe station ↔ Edgeville canoe station (canoe-barbarian-village--canoe-edgeville) | 12342 — Edgeville | 12341-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Barbarian Village canoe station (canoe-champions-guild--canoe-barbarian-village) | 12341 — Barbarian Village | 12852-1000002 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Edgeville canoe station (canoe-champions-guild--canoe-edgeville) | 12342 — Edgeville | 12852-1000002 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Barbarian Village canoe station (canoe-lumbridge--canoe-barbarian-village) | 12341 — Barbarian Village | 12850-1000001 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Champions' Guild canoe station (canoe-lumbridge--canoe-champions-guild) | 12852 — Gower Farm | 12850-1000001 → 12852-1000002 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Edgeville canoe station (canoe-lumbridge--canoe-edgeville) | 12342 — Edgeville | 12850-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| lodestones | Home Teleport to Al Kharid (home-teleport--lodestone-al-kharid) | 13105 — Al Kharid | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Burthorpe (home-teleport--lodestone-burthorpe) | 11575 — Burthorpe | global → 11575-1000001 | No estimated level gate; strict access geometry; reachable departure |
| lodestones | Home Teleport to Draynor (home-teleport--lodestone-draynor) | 12339 — Draynor Crossroads | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Edgeville (home-teleport--lodestone-edgeville) | 12086 — Edgeville Monastery | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Falador (home-teleport--lodestone-falador) | 11829 — Invention Guild | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Lumbridge (home-teleport--lodestone-lumbridge) | 12850 — Lumbridge | global → unresolved | No estimated level gate; roll eligibility only; access blocked |
| lodestones | Home Teleport to Port Sarim (home-teleport--lodestone-port-sarim) | 12082 — Port Sarim | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Taverley (home-teleport--lodestone-taverley) | 11317 — Catherby Beach | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Varrock (home-teleport--lodestone-varrock) | 12852 — Gower Farm | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Wilderness Crater (home-teleport--lodestone-wilderness-crater) | 12600 — Wilderness Drakolith Mine | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |

**Player 2**

Saved manual usable teleports: none.

| Group | Route | Destination chunk | Resolved departure → destination | Gate evidence / use |
| --- | --- | --- | --- | --- |
| transport | Barbarian Village canoe station ↔ Edgeville canoe station (canoe-barbarian-village--canoe-edgeville) | 12342 — Edgeville | 12341-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Barbarian Village canoe station (canoe-champions-guild--canoe-barbarian-village) | 12341 — Barbarian Village | 12852-1000002 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Champions' Guild canoe station ↔ Edgeville canoe station (canoe-champions-guild--canoe-edgeville) | 12342 — Edgeville | 12852-1000002 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Barbarian Village canoe station (canoe-lumbridge--canoe-barbarian-village) | 12341 — Barbarian Village | 12850-1000001 → 12341-1000001 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Champions' Guild canoe station (canoe-lumbridge--canoe-champions-guild) | 12852 — Gower Farm | 12850-1000001 → 12852-1000002 | Estimated level; strict access geometry; reachable departure |
| transport | Lumbridge canoe station ↔ Edgeville canoe station (canoe-lumbridge--canoe-edgeville) | 12342 — Edgeville | 12850-1000001 → 12342-1000001 | Estimated level; strict access geometry; reachable departure |
| lodestones | Home Teleport to Al Kharid (home-teleport--lodestone-al-kharid) | 13105 — Al Kharid | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Burthorpe (home-teleport--lodestone-burthorpe) | 11575 — Burthorpe | global → 11575-1000001 | No estimated level gate; strict access geometry; reachable departure |
| lodestones | Home Teleport to Draynor (home-teleport--lodestone-draynor) | 12339 — Draynor Crossroads | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Edgeville (home-teleport--lodestone-edgeville) | 12086 — Edgeville Monastery | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Falador (home-teleport--lodestone-falador) | 11829 — Invention Guild | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Lumbridge (home-teleport--lodestone-lumbridge) | 12850 — Lumbridge | global → unresolved | No estimated level gate; roll eligibility only; access blocked |
| lodestones | Home Teleport to Port Sarim (home-teleport--lodestone-port-sarim) | 12082 — Port Sarim | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Taverley (home-teleport--lodestone-taverley) | 11317 — Catherby Beach | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Varrock (home-teleport--lodestone-varrock) | 12852 — Gower Farm | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |
| lodestones | Home Teleport to Wilderness Crater (home-teleport--lodestone-wilderness-crater) | 12600 — Wilderness Drakolith Mine | global → unresolved | No estimated level gate; Planned activation; roll eligibility only; access blocked |

## Unknown endpoints and pending routes

204 distinct catalogue rows have an unresolved strict access endpoint or pending route in the final scenario. These rows cannot establish resource access. A separately validated roll-only global may still be eligible for a future personal roll. Pending routes and unknown destinations remain unavailable. No interior mapping, map/plane or contrary non-entry evidence was bypassed for access.

The following 49 rows are not excluded by the catalogue's membership flag and are relevant to this F2P comparison. The remaining 155 members-only rows and their exact endpoint reasons are retained in the JSON.

| Route | Resolved access endpoint(s) | Roll availability | Access blockers |
| --- | --- | --- | --- |
| Home Teleport to Al Kharid (home-teleport--lodestone-al-kharid) | global → unresolved | roll-only: 13105 — Al Kharid | station coordinate needs exact decoded tile evidence lodestone-al-kharid-activated: confirmations requirement is unknown or not met. |
| Home Teleport to City of Um (home-teleport--lodestone-city-of-um) | global → unresolved | not available | unknown station chunk Needs quest Necromancy!; personal completion unknown. lodestone-city-of-um-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Draynor (home-teleport--lodestone-draynor) | global → unresolved | roll-only: 12339 — Draynor Crossroads | station coordinate needs exact decoded tile evidence lodestone-draynor-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Edgeville (home-teleport--lodestone-edgeville) | global → unresolved | roll-only: 12086 — Edgeville Monastery | station coordinate needs exact decoded tile evidence lodestone-edgeville-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Falador (home-teleport--lodestone-falador) | global → unresolved | roll-only: 11829 — Invention Guild | station coordinate needs exact decoded tile evidence lodestone-falador-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Lumbridge (home-teleport--lodestone-lumbridge) | global → unresolved | roll-only: 12850 — Lumbridge | station coordinate needs exact decoded tile evidence |
| Home Teleport to Port Sarim (home-teleport--lodestone-port-sarim) | global → unresolved | roll-only: 12082 — Port Sarim | station coordinate needs exact decoded tile evidence lodestone-port-sarim-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Taverley (home-teleport--lodestone-taverley) | global → unresolved | roll-only: 11317 — Catherby Beach | station coordinate needs exact decoded tile evidence lodestone-taverley-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Varrock (home-teleport--lodestone-varrock) | global → unresolved | roll-only: 12852 — Gower Farm | station coordinate needs exact decoded tile evidence lodestone-varrock-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Wendlewick (home-teleport--lodestone-wendlewick) | global → unresolved | not available | station coordinate needs exact decoded tile evidence Needs quest Visions of Havenhythe; personal completion unknown. lodestone-wendlewick-activated: confirmations requirement is unknown or not met. |
| Home Teleport to Wilderness Crater (home-teleport--lodestone-wilderness-crater) | global → unresolved | roll-only: 12600 — Wilderness Drakolith Mine | station coordinate needs exact decoded tile evidence lodestone-wilderness-crater-activated: confirmations requirement is unknown or not met. |
| Asgarnian Ice Dungeon trapdoor (interior-asgarnian-ice) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Burthorpe mine entrance / Burthorpe Mine (interior-burthorpe-mine) | 11318-1000013 → unresolved | not available | station map does not match cache surface map |
| Taverley / Burthorpe Slayer Cave (interior-burthorpe-slayer) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Crandor / Elvarg's lair entrance (interior-crandor-dungeon) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map Needs quest Dragon Slayer; personal completion unknown. crandor-dungeon-post-dragon-slayer-access: conditions requirement is unknown or not met. crandor-dungeon-post-dragon-slayer-access: confirmations requirement is unknown or not met. |
| Draynor jail trapdoor / Draynor Sewers (interior-draynor-east) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Draynor west trapdoor / Draynor Sewers (interior-draynor-west) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Hill giant hut ladder / Edgeville Dungeon (interior-edgeville-brass-key) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map brass-key-hut-access: confirmations requirement is unknown or not met. |
| Edgeville ruins trapdoor / Edgeville Dungeon (interior-edgeville-ruins) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Falador mine stairs / Dwarven Mine (interior-falador-mine) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Ice Mountain mine ladder / Dwarven Mine (interior-ice-mountain-mine) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Karamja Volcano dungeon entrance (interior-karamja-volcano) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Lumbridge cemetery / upper Catacombs (interior-lumbridge-catacombs) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence non-surface station requires verified interior mapping blood-pact-upper-catacombs-entry: conditions requirement is unknown or not met. blood-pact-upper-catacombs-entry: confirmations requirement is unknown or not met. |
| Lumbridge Castle kitchen / cellar (interior-lumbridge-cellar) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Varrock manhole / Varrock Sewers (interior-varrock-sewers) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station map does not match cache surface map |
| Air altar teleport (item--air-altar-tablet) | global → unresolved | not available | station coordinate needs exact decoded tile evidence Consumable teleport — rule off. Air altar teleport not obtainable from currently reachable sources. item--air-altar-tablet: confirmations requirement is unknown or not met. |
| Mind altar teleport (item--mind-altar-tablet) | global → unresolved | not available | station coordinate needs exact decoded tile evidence Consumable teleport — rule off. Mind altar teleport not obtainable from currently reachable sources. item--mind-altar-tablet: confirmations requirement is unknown or not met. |
| Water altar teleport (item--water-altar-tablet) | global → unresolved | not available | station coordinate needs exact decoded tile evidence Consumable teleport — rule off. Water altar teleport not obtainable from currently reachable sources. item--water-altar-tablet: confirmations requirement is unknown or not met. |
| Wilderness North Volcano ascent (object anchors) (north-volcano-ascent) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence non-surface station requires verified interior mapping north-volcano-obstacle-chain-and-effective-planes-reviewed: confirmations requirement is unknown or not met. |
| Port Sarim ↔ Havenhythe (port-sarim--havenhythe) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station coordinate needs exact decoded tile evidence Needs quest Visions of Havenhythe; personal completion unknown. |
| Port Sarim ↔ Musa Point (port-sarim--musa-point) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station coordinate needs exact decoded tile evidence |
| Lumbridge / Iron Enclave (portal-iron-enclave) | unresolved → unresolved | not available | station coordinate needs exact decoded tile evidence station coordinate needs exact decoded tile evidence ironman-or-group-ironman-account: conditions requirement is unknown or not met. iron-enclave-account-access: confirmations requirement is unknown or not met. |
| Ring of kinship to Daemonheim (ring-kinship--daemonheim) | global → unresolved | not available | station coordinate needs exact decoded tile evidence Ring of kinship not obtainable from currently reachable sources. ring-kinship--daemonheim: confirmations requirement is unknown or not met. |
| Skull sceptre to Sepulchre of Death (skull-sceptre--death) | global → unresolved | not available | station map does not match cache surface map skull-sceptre-death-destination-unlocked: confirmations requirement is unknown or not met. |
| Skull sceptre to Catacomb of Famine (skull-sceptre--famine) | global → unresolved | not available | station map does not match cache surface map skull-sceptre-famine-destination-unlocked: confirmations requirement is unknown or not met. |
| Skull sceptre to Pit of Pestilence (skull-sceptre--pestilence) | global → unresolved | not available | station map does not match cache surface map skull-sceptre-pestilence-destination-unlocked: confirmations requirement is unknown or not met. |
| Skull sceptre to Vault of War (skull-sceptre--war) | global → unresolved | not available | station map does not match cache surface map skull-sceptre-war-destination-unlocked: confirmations requirement is unknown or not met. |
| Quest rooms / lower combat catacombs (stairs-lumbridge-catacombs-main) | unresolved → unresolved | not available | station map does not match cache surface map station map does not match cache surface map Needs quest The Blood Pact; personal completion unknown. |
| Catacombs north stairs (stairs-lumbridge-catacombs-north) | unresolved → unresolved | not available | non-surface station requires verified interior mapping station map does not match cache surface map blood-pact-west-staircases-open: conditions requirement is unknown or not met. blood-pact-west-staircases-open: confirmations requirement is unknown or not met. |
| Catacombs south stairs (stairs-lumbridge-catacombs-south) | unresolved → unresolved | not available | non-surface station requires verified interior mapping station map does not match cache surface map blood-pact-west-staircases-open: conditions requirement is unknown or not met. blood-pact-west-staircases-open: confirmations requirement is unknown or not met. |
| Taverley ↔ Daemonheim coast (taverley--daemonheim) | unresolved → 13881-1000001 | not available | station coordinate needs exact decoded tile evidence |
| Lumbridge canoe station → Wilderness pond (canoe-lumbridge--canoe-wilderness-pond) | unresolved → unresolved | not available | Exact RS3 Wilderness canoe arrival/station coordinate has not been verified; not admitted as a drawable route. |
| Champions' Guild canoe station → Wilderness pond (canoe-champions-guild--canoe-wilderness-pond) | unresolved → unresolved | not available | Exact RS3 Wilderness canoe arrival/station coordinate has not been verified; not admitted as a drawable route. |
| Barbarian Village canoe station → Wilderness pond (canoe-barbarian-village--canoe-wilderness-pond) | unresolved → unresolved | not available | Exact RS3 Wilderness canoe arrival/station coordinate has not been verified; not admitted as a drawable route. |
| Edgeville canoe station → Wilderness pond (canoe-edgeville--canoe-wilderness-pond) | unresolved → unresolved | not available | Exact RS3 Wilderness canoe arrival/station coordinate has not been verified; not admitted as a drawable route. |
| Home Teleport to Ashdale (home-teleport--lodestone-ashdale) | global → unresolved | not available | Exact raw destination is available, but a matching current cache map projection is absent. Do not assign a guessed map ID or display plane. |
| Wilderness pond canoe destination (unresolved:canoe-wilderness-pond) | unresolved → unresolved | not available | No exact current Wiki object map or copied-cache canoe destination marker was found. A regional map centre or nearby monster marker is not evidence of the station. |
| Ashdale lodestone (unresolved:lodestone-ashdale) | unresolved → unresolved | not available | Exact current destination map/plane coordinate is unresolved. |
| Prifddinas lodestone (unresolved:lodestone-prifddinas) | unresolved → unresolved | not available | Exact current destination map/plane coordinate is unresolved. |

## Input integrity and verification

- All 82 copied files remained unchanged; file-inventory SHA-256: `aa3e73535a72689ecdc0b06a0f1bb117f879005d4f722623c73f2e0f098d7a19`.
- Copied state envelope SHA-256: `b7d0313182e16dd81897f62f0b29d5b22b0e8f49953e5409ed4a6954b032053e`; hydrated revision: 73.
- Retained definition SHA-256: `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`.
- Base commit: `c9d765bea34ee2b2c8e90c0f1692e6d8a16fd51d`; tracked app-diff SHA-256: `7062fd492f949062b5b7b11713d9d68e4db63e3add5c7fa293e54f0aecfa0b56`.
- Imported route catalogue: `app/data/transport-routes.2026-10-09.v2.json`, SHA-256 `51a5fec43443fdc0ec7532419aca40326a25f1d3abf689af999459fec0e1ed32`.
- Syntax and command help were checked. An output path outside this worktree's `.local` was rejected before evaluation. Production possible-task counts matched the enumerated available obligations for all six calculations. Concurrent draft runs rejected their output after core source changed; these results come from the subsequent frozen-source run.

This comparison verifies a read-only calculation over the copied records. It does not verify personal in-game item possession, lodestone activation, travel use, account sync or a deployed browser session.

## Browser review artifacts

The separate [screenshot script](../../scripts/research/capture-teleports.mjs) opens the copied save in a disposable localhost browser. The [review record](../../.local/teleports-screenshots/review.json) retains the same revision-73 state fingerprint and a 16-of-256 usable preview while automatic availability is off. It records Lodestones, Spells, Items and Transport groups, with no horizontal overflow in the four desktop/390px light/gray viewport checks. These are browser presentation checks and emulated phone widths, rather than observed gameplay or phone performance measurements.

- Desktop: [light](../../.local/teleports-screenshots/teleports-desktop-light.png), [gray](../../.local/teleports-screenshots/teleports-desktop-gray.png).
- 390px: [light](../../.local/teleports-screenshots/teleports-390-light.png), [gray](../../.local/teleports-screenshots/teleports-390-gray.png).
- Additional [Spells desktop gray capture](../../.local/teleports-screenshots/teleports-spells-desktop-gray.png).

## Changed-file manifest

This manifest records modified tracked files and new files reported by git status at the successful comparison. Ignored local snapshots, private copies, screenshots and performance artifacts are excluded. M means modified; ?? means a new file awaiting staging; A means an added staged file.

| Git status | Versioned file |
| --- | --- |
| M | [README.md](../../README.md) |
| M | [app/core/rules.mjs](../../app/core/rules.mjs) |
| M | [app/core/state.mjs](../../app/core/state.mjs) |
| M | [app/core/territory.mjs](../../app/core/territory.mjs) |
| M | [app/core/transport-access.mjs](../../app/core/transport-access.mjs) |
| M | [app/data/transport-routes.mjs](../../app/data/transport-routes.mjs) |
| M | [app/data/world.mjs](../../app/data/world.mjs) |
| M | [app/server.mjs](../../app/server.mjs) |
| M | [app/tasks/access.mjs](../../app/tasks/access.mjs) |
| M | [app/tasks/engine.mjs](../../app/tasks/engine.mjs) |
| M | [app/tasks/worker.mjs](../../app/tasks/worker.mjs) |
| M | [app/web/history-text.mjs](../../app/web/history-text.mjs) |
| M | [app/web/main.mjs](../../app/web/main.mjs) |
| M | [docs/performance.md](../../docs/performance.md) |
| M | [scripts/perf/page-load.mjs](../../scripts/perf/page-load.mjs) |
| M | [tests/prediction-server.test.mjs](../../tests/prediction-server.test.mjs) |
| M | [tests/server.test.mjs](../../tests/server.test.mjs) |
| M | [tests/transport-audit.test.mjs](../../tests/transport-audit.test.mjs) |
| M | [tests/web-browser.test.mjs](../../tests/web-browser.test.mjs) |
| ?? | [app/core/automatic-transport.mjs](../../app/core/automatic-transport.mjs) |
| ?? | [app/data/transport-components.automatic-teleports.2026-10-09.v1.json](../../app/data/transport-components.automatic-teleports.2026-10-09.v1.json) |
| ?? | [app/data/transport-roll-destinations.automatic-teleports.2026-10-09.v1.json](../../app/data/transport-roll-destinations.automatic-teleports.2026-10-09.v1.json) |
| ?? | [app/data/transport-routes.2026-10-09.v2.json](../../app/data/transport-routes.2026-10-09.v2.json) |
| ?? | [app/data/transport-routes.automatic-teleports.2026-10-09.v1.json](../../app/data/transport-routes.automatic-teleports.2026-10-09.v1.json) |
| ?? | [app/web/teleports.css](../../app/web/teleports.css) |
| ?? | [app/web/teleports.mjs](../../app/web/teleports.mjs) |
| ?? | [docs/research/automatic-teleports-evidence.2026-10-09.v1.json](../../docs/research/automatic-teleports-evidence.2026-10-09.v1.json) |
| ?? | [docs/research/automatic-teleports-evidence.2026-10-09.v1.md](../../docs/research/automatic-teleports-evidence.2026-10-09.v1.md) |
| ?? | [docs/research/automatic-travel-real-save-2026-10-09.md](../../docs/research/automatic-travel-real-save-2026-10-09.md) |
| ?? | [scripts/build-automatic-teleport-catalogue.mjs](../../scripts/build-automatic-teleport-catalogue.mjs) |
| ?? | [scripts/research/capture-teleports.mjs](../../scripts/research/capture-teleports.mjs) |
| ?? | [scripts/research/compare-automatic-travel.mjs](../../scripts/research/compare-automatic-travel.mjs) |
| ?? | [tests/automatic-teleport-catalogue.test.mjs](../../tests/automatic-teleport-catalogue.test.mjs) |
| ?? | [tests/automatic-transport.test.mjs](../../tests/automatic-transport.test.mjs) |
| ?? | [tests/automatic-travel-integration.test.mjs](../../tests/automatic-travel-integration.test.mjs) |
| ?? | [tests/teleports-web.test.mjs](../../tests/teleports-web.test.mjs) |

## Final branch verification

The final `npm test` run completed on October 10, 2026 at approximately 03:07 UTC: **2,097 tests, 2,096 passed, one skipped, zero failures**, in 333.8 seconds. Prediction goldens were unchanged. The final three-run normal-prewarming performance comparison passed the selected median regression gate; its complete measurements and remaining absolute Unlock latency limit are in [docs/performance.md](../performance.md#automatic-travel-verification-october-9-2026).

After verification, both private copied-save directories (`.local/teleports-save` and `.local/teleports-auto-save`) and the obsolete disposable visual profile were deleted. Cleanup verified each resolved target remained inside this worktree's `.local` directory. The ignored derived comparison, public evidence snapshots, performance reports and review screenshots remain available locally. No private save or ignored artifact is included in the branch commit.
