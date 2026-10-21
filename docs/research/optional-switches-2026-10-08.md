# Optional switches for Player 1 and Player 2

Compared on 2026-10-08, starting from deployed `e9183dc`, with Node 24.20.0. This is a calculation audit of a frozen copy of the duo save, not an observation of either account in the game. No live picker, Tailscale setting or main-checkout file was changed.

The copied save is revision **29**, SHA-256 `6709638ba999486f536659ff7a8b22ba5f37f9b7de7632aa01cc15713d344259`. Player 1 owns 140 chunks and has 11 selected; Player 2 owns 113 and has 20 selected. F2P and normal cache resources are ON. The four audited switches and consumable teleports are OFF. This newer snapshot supersedes map counts in older fixture reports.

## Comparison on deployed code

Every individual switch and the all-four combination preserve these counts:

| Player | Case | Active | Presented | Possible | Roll pool / selectable | Reachable areas |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Player 1 | All OFF | 27 | 27 | 1,497 | 16 | 83 |
| Player 1 | Archaeology only ON | 27 | 27 | 1,497 | 16 | 83 |
| Player 1 | Shops only ON | 27 | 27 | 1,497 | 16 | 83 |
| Player 1 | Transport only ON | 27 | 27 | 1,497 | 16 | 83 |
| Player 1 | House storage only ON | 27 | 27 | 1,497 | 16 | 83 |
| Player 1 | All four ON | 27 | 27 | 1,497 | 16 | 83 |
| Player 2 | All OFF | 55 | 55 | 1,626 | 21 | 82 |
| Player 2 | Archaeology only ON | 55 | 55 | 1,626 | 21 | 82 |
| Player 2 | Shops only ON | 55 | 55 | 1,626 | 21 | 82 |
| Player 2 | Transport only ON | 55 | 55 | 1,626 | 21 | 82 |
| Player 2 | House storage only ON | 55 | 55 | 1,626 | 21 | 82 |
| Player 2 | All four ON | 55 | 55 | 1,626 | 21 | 82 |

**Tasks added/removed: zero for both players in every case**, for active, presented and possible task sets. There are no new or lost selectable chunks, own roll components, own task sections/components/areas, shared task sections/components/areas, or connected partner chunks. Accordingly there are no changed reachable chunk/area names to list. Transport does change partner-region grouping and connection explanations, as described below. Current BiS, obtainable/recorded gear, equipment recommendations/loadouts, obtainable item names and item-source arrays remain identical. Task-source references change for Archaeology as listed below; they do not change item availability.

### Archaeology task changes, grouped by skill

There are six changed task records for Player 1 and five for Player 2, all in **Archaeology**. None is added to or removed from any task set. The all-four case has exactly the same changes.

| Task label | Player 1 | Player 2 | OFF → ON |
| --- | --- | --- | --- |
| Excavate Third Age iron | Changed | Changed | Existing Varrock Dig Site source gains its exact cache component; still available at level 5. |
| Excavate a samite silk material cache at Kharid-et | Changed | Changed | Existing source keeps its retained gates and gains the exact Het's Oasis component; still available at level 12. |
| Excavate a samite silk material cache | Changed | Changed | Same source improvement; still available at level 12. |
| Excavate a white oak material cache | Changed | Changed | Adds exact sources at Edgeville Monastery and Goblin Village; already available at level 17. |
| Excavate a triskelion material cache | Changed | Changed | Guarded level correction 58 → 52; remains blocked above the F2P cap of 20. |
| Excavate a fossilised bone material cache | Source ordering only | Unchanged | Player 1's existing Silvarea Pass/Hill Giant Camp locations are returned in a different order; still blocked at level 81. |

Shops, transport and house storage have **no changed task records** for either member. No top-30 truncation is needed. The script's JSON retains exact task IDs, source references, blockers and all set additions/removals.

### Chunk details and named examples

Archaeology changes contents/provenance in 31 world chunks, including 12 owned, accessible or selected chunks relevant to each player's view. Only 25 world chunks receive admitted placements; the other differences include retained hotspot provenance. Both players see these representative changes:

| Chunk | OFF | Archaeology ON | Meaning |
| --- | --- | --- | --- |
| Goblin Village `11830` | No white oak cache declaration | Material cache (White oak) ×1 | A genuinely additional declaration; the white oak task was already available elsewhere. |
| Edgeville Monastery `12086` | Material cache (white oak) ×2 | Material cache (White oak) ×2 with exact placement evidence | Replaces the old spelling/declaration; the resource and count remain. |
| Kharid-et Digsite `13361` | Samite silk ×2 and ×4 in retained sections | Material cache (Samite silk) ×6 with exact placements | Replaces section display declarations; task source gates remain. |
| Het's Oasis `13362` | Samite silk ×2 in a retained section | Material cache (Samite silk) ×2 with exact placements | Same resource/count, improved evidence. |
| Varrock Dig Site `13365` | Third Age iron ×3 in a retained section | Material cache (Third Age iron) ×3 with exact placements | Same resource/count, improved evidence. |

Other relevant changed details are at Silvarea Pass, Daemonheim Fremennik Camp, West/East Daemonheim Castle, Hill Giant Camp, Saradominist Watchtower Ruins and Waterfall Pathway. These include selected chunks and partner convenience territory, not necessarily personal obligations. The report's `scopes` distinguishes them.

The old lowercase material-cache declarations disappear where the correctly named placement-backed declaration replaces them; some move from retained display sections to the base-chunk contents projection. **No material type or retained excavation hotspot disappears from these relevant chunks.** Venator remains, Fort debris, Legionary remains and Centurion remains retain their counts, with changed provenance only. Archaeology does not add a new dig site or usable excavation hotspot.

Shop contents add/remove **zero rows** with the switch. Existing examples remain Iron arrow/Steel arrow at Lowe's Archery Emporium, Fire rune/Water rune at Aubury's Rune Shop and Betty's Magic Emporium, Staff/Magic staff at Zaff's Superior Spellcasting, and ordinary Jug of water at Beefy Bill's Supplies. Their reviewed stock quantities were already separately accessible as metadata with the switch OFF. The F2P pack correction below removes an invalid source, not the static stock reference row.

Transport and house storage change **zero chunk-content rows**. Lumbridge, Champions' Guild, Barbarian Village and Edgeville canoe stations retain their details. Storage catalogue examples such as Mask of Dragith Nurn, Fire cape, Amulet of magic (t), Silverlight and anti-dragon shield do not become F2P tasks or new chunk contents.

### Correctness findings

The pre-existing **Jug of water pack** leak is present with every switch combination on deployed code. Beefy Bill's shop is free, but this stock item is members-only: its committed cache row has `membersMarked:true` and its pinned Wiki stock witness has `wikiMembers:true`, item ID 43282, inventory 536, [revision 37117521](https://runescape.wiki/w/Special:PermanentLink/37117521). A focused fixture reproduces both the available **Open a jug of water pack** task and an **All Shops: Beefy Bill's Supplies: Jug of water pack** goal in F2P. Cache shops OFF/ON makes no difference to the defect.

This branch fixes source admission in [access policy](../../app/data/access-policy.mjs) and [item sources](../../app/tasks/access.mjs). It blocks only the witnessed Beefy Bill purchase in F2P, including alternate task-unlock declarations of that purchase. Ordinary Jug of water and all other stock remain; members mode and independently valid alternate sources remain. [Six regressions](../../tests/cache-shop-f2p-membership.test.mjs) cover both contents-switch states, F2P/P2P, collection goals, ordinary tasks and non-mutation. Saved checkmarks/IDs are retained. This fix still needs a later deployment; the live picker was not changed.

No available task carrying the engine's explicit members-only flag appears in either member's ON comparisons. High-level cache details can still be displayed inside a free chunk: for example fossilised bone/ivory at Hill Giant Camp and triskelion/cashmere at Saradominist Watchtower Ruins. They do not become available F2P goals. This flag check is not a blanket certification of all retained data; confirmed retained source routes preserve their older independent gates.

Transport grants **zero usable reviewed routes** for either member with this saved evidence. Both have 236 route/obstacle records with unknown requirements and 179 with unmet requirements; these groups overlap and include pending/unmapped/member records. Canoes, including Lumbridge–Champions' Guild, Champions' Guild–Barbarian Village and Barbarian Village–Edgeville, lack a saved personal Woodcutting observation/declaration and `canoe-familiar-state-supported` confirmation. The longer Champions' Guild–Edgeville and Lumbridge–Barbarian Village routes similarly require a recorded 27 Woodcutting. **Unknown does not mean either account has a low level.** Historical vault levels and potential training cannot replace current personal transport evidence.

There is a surprising explanation change even without a usable transport route. Transport ON reconstructs walking reach through the claimed territory when catalogue records exist, including unavailable records; this augments the component inventory used to group partner regions in [territory evaluation](../../app/core/territory.mjs). Player 1's partner-region count changes **8 → 21**, Player 2's **8 → 18**, and connection witnesses change for seven/five chunks respectively. For example, Player 2's **Dareeyak Ruins `11833`** stays connected for Player 1, but its out/back witness changes from `own 11833-1000004` to `own 11833-1000006`. Player 1's **South Crandor `11314`** stays connected for Player 2, with witness `own 11314-1000006` → `own 11314-1000005`. All 113 partner-chunk flags for Player 1 and all 140 for Player 2 remain identical, with unchanged usable sections/components and reachable sets. These regional counts are grouping/explanation changes, not newly opened areas; no unavailable transport edge is admitted. The all-four case behaves the same.

Quest/fare-dependent ships and lodestones are not silently admitted. No locked chunk becomes an origin and no one-way trip grants partner convenience. The saved consumable-teleport rule remains OFF. House storage has zero F2P goals; no members-only furniture goal leaks through an otherwise free item.

## Controls and rollback

| Switch | Exact control | Default | Scope | Restart? |
| --- | --- | --- | --- | --- |
| Archaeology cache contents | `RS3_ARCHAEOLOGY_CONTENTS=game-data` | OFF when absent or any other value | Server definitions/world and both players | Yes |
| Reviewed cache shop stock | `RS3_CACHE_SHOP_CONTENTS=1` | OFF when absent or any other value | Server definitions and both players | Yes |
| Admit verified transport routes | Shared rule `access.transport` | `false` | Both players, with personal requirements | No |
| House storage tasks | Task rule `House storage tasks` | `false` | Set independently for each player | No |

Archaeology also depends on the normal cache-walking world for placement attachment. Its guarded triskelion level correction is enabled by the same environment variable. Existing task/display rules still apply: enabling the catalogue does not force hidden Archaeology tasks into the active list or waive the F2P cap of 20. The older `Archaeology Relics` setting does not enable this catalogue. Interior-map display is separate and grants no access.

Shop stock has no extra saved enable rule. Ordinary shop/task/source settings still determine whether purchases generate goals. The overlay uses only six complete reviewed inventories, positive default stock and exact old-value guards. It does not identify all cache inventories as shops. The metadata endpoint is available even with the contents switch OFF.

Transport uses no environment opt-in. Spell routes additionally depend on the existing `roll.consumableTeleports` rule; this comparison preserves that setting. Missing personal level, quest, fare, item, activation or clearance facts stay unknown. The catalogue does not turn potential training or another player's challenge check into personal transport permission.

House storage has no environment switch. `Costume Room` and `Fill Costume Room` do not enable it. In F2P it produces no storage goals, including for free items. The wooden bookcase retrieves unlocked books automatically and has no fill objective.

### Change a rule safely

Use **Chunk Rules → Admit verified transport routes** for transport, or the chosen player's **House storage tasks** control. These existing controls submit the revision-checked commands below. Keep F2P enabled. Change house storage once on Player 1's map and once on Player 2's map if enabling both.

For an authenticated API client, read the current shared revision, then submit to `POST /api/command`:

```json
{"expectedRevision":123,"command":{"type":"set-rule","ruleId":"access.transport","value":true}}
```

```json
{"expectedRevision":124,"command":{"type":"set-task-rule","memberId":"player1","ruleId":"House storage tasks","value":true}}
```

Use member ID `player2` for Player 2. Obtain a fresh revision for each command; the illustrative revisions above are not the save's current revision. A stale request returns 409 and remains unapplied. Set `value:false` to disable. `reset-task-rule` removes the personal override and returns to inheritance, which may differ from explicitly disabling it.

The existing **Undo** control submits `{"expectedRevision":CURRENT,"command":{"type":"undo"}}`. It reverses the latest reversible action and increases the revision. Check History before using it if another action followed the switch change. Undo is not a command to target an arbitrary older switch action. Rule changes invalidate calculations without a server restart.

### Change a startup switch safely

For a later deployment, stop the managed picker, set the variable in the same PowerShell session that starts it, and then start a new process using the existing `Start-Picker.ps1` helper. For example, set `$env:RS3_ARCHAEOLOGY_CONTENTS = 'game-data'` or `$env:RS3_CACHE_SHOP_CONTENTS = '1'` before Start. To disable, remove that variable with `Remove-Item Env:RS3_ARCHAEOLOGY_CONTENTS -ErrorAction SilentlyContinue` or `Remove-Item Env:RS3_CACHE_SHOP_CONTENTS -ErrorAction SilentlyContinue`, then restart. Reload the browser after the new server is ready.

Calling Start while the old process is running reuses it, so a changed shell variable alone does not toggle either switch. These variables are not saved in gameplay, backups or profiles. Start reads a separately saved public-origin setting, but does not persist these two switches. A future watchdog launch inherits its own environment. Keep the chosen variable in the actual launch configuration if the decision should survive such restarts. No helper or live-server operation was performed for this audit.

## Method and reproduction

The complete `.local/duo` directory was copied into this worktree's `.local/switches-save`; `store.lock`, `invites.json` and the copied `access-token` were removed. Static sidecars were hydrated and checked by SHA-256. The copied state and dependencies stayed unchanged through comparison. The copy was deleted after comparison and was never committed.

Run the reusable script on another separately named complete save copy:

```powershell
node scripts/research/compare-switches.mjs --data-dir .local/switches-save --runs 3 --output .local/switches-report.json
```

The script starts no server, opens no credential and makes no network request. It rejects live `.local/duo` paths, copied locks/invitations, escaping dependencies and outputs outside its worktree. It compares all four OFF, each alone ON, and all four ON. It preserves other saved settings, ownership, selected candidates, progress, supplies and travel declarations. Each variant runs in a fresh process so environment-based definitions cannot be reused from the other variant.

The production task worker calculates ordinary tasks, collections, hidden equipment duties, presentation, Current BiS and Activity Info. A separate compact calculation measures the foreground task view. **Possible** is the production available own-obligation count, including hidden rows. **Presented** is the production presentation selection. **Active** means unfinished, visible, presented own obligations, excluding completed and backlogged goals. It uses the same completion index as the browser; custom-task fallback and optional search/show-all/show-blocked/hide-completed display choices are outside this count. The report retains additions/removals for all three sets.

Roll pool and selectable chunks mean the authoritative eligible set under the saved candidate policy. Manually selected chunks remain an explicit source, so this is not every surface chunk that a person could manually add. Own roll components, own task access and shared convenience access are compared separately. Chunk-content differences include owned, accessible, selected and pending locations; contents in a selected locked chunk do not grant usable resources.

Timing samples force worker snapshot-cache misses. Worker compilation, calculation, worker-thread request round trip and payload bytes are separate measurements. Full calculations include the separate BiS/activity panels; their result-object serialization is outside that calculation timer. Compact calculations match the foreground task protocol, including shared JSON serialization. Payload sizes are UTF-8 JSON and Brotli body bytes at production quality 4, excluding HTTP headers/envelopes. These direct measurements cover the calculation contribution to loading/unlocking. They do not measure terrain, browser rendering, durable save time, public networking or Player 2's device. The parallel map-tile job and other host activity can affect elapsed times.

## Evidence and implementation limits

The switches and rules were checked against [architecture](../architecture.md), [operator guide](../operator-guide.md), [Archaeology and interiors](archaeology-and-interiors.md), [Archaeology extraction](archaeology-extraction.2026-10-08.v1.md), [NPCs and shops](npcs-and-shops.md), [transport routes](transport-routes.md) and [house storage](poh-storage-tasks.md). The underlying transport segments retain the [F2P](transport-f2p-evidence.2026-10-08.v1.md), [ships](transport-ships-evidence.2026-10-08.v1.md) and [interiors/members](transport-interiors-members-evidence.2026-10-08.v1.md) receipts. These are dated, pinned catalogue facts; this audit did not recheck server mechanics in the live game.

Archaeology admits 87 surface material-cache placements across 25 chunks, of which 14 are in reviewed F2P classes. It grants zero new excavation hotspots: conditional scenery does not establish an active excavation state. Exact walking-component witnesses are required for cache-only resources. Infernal Source, high-level caches and unknown membership stay restricted. The triskelion task keeps its ID while its guarded level changes 58 → 52, still above the F2P cap.

All six reviewed shop item-name sets already match the retained tables. Cache stock quantities are reference metadata, not current remaining inventory, price, restock speed or account purchase limits. No members-only shop is newly located or admitted by this switch. Positive stock does not itself waive item membership.

Transport records 227 routes at 156 anchors, but only 35 anchors have exact surface-component witnesses. Unsupported interiors, blocked anchor tiles, unverified landing geometry and pending routes cannot grant access. Personal quests and affordable round trips are required where declared. Port Sarim–Musa Point costs 30 coins each way; Havenhythe requires personal Visions of Havenhythe completion and the fare; City of Um/Wendlewick lodestones also retain quest/activation requirements. A staff user can receive a conservative false negative because the evaluator still requires explicit elemental-rune counts; staff substitutions are not implemented. This does not create false access.

House storage follows the July 2026 RS3 furniture rework. Future members-only examples are armour-case storage for Mask of Dragith Nurn, cape-store storage for Fire cape, treasure-chest storage for Amulet of magic (t), and displays for Silverlight and an anti-dragon shield. These are not newly available F2P goals. Current furniture/material/buildability gates apply; installed furniture, actual inventory quantities, repaired/event-entitled golden Barrows sets and a global capacity allocation remain outside the planner.

## Corrected results and performance

After the source fix, the same frozen save was compared again for every case, with **three uncached samples per member per view**: 36 measured full/compact pairs. The final pair agrees in all 12 member/case checks after excluding elapsed time. Input and code hashes remained unchanged. The earlier deployed-code comparison used one sample per case and Brotli quality 11; its timing/compressed-size observations are not used in the tables below.

| Player | Fix effect, in every switch case | Active / presented | Possible | Roll pool / selectable | Areas / BiS |
| --- | --- | ---: | ---: | ---: | --- |
| Player 1 | Invalid pack-opening possibility removed | 27 / 27, unchanged | 1,497 → **1,496** | 16, unchanged | 83 areas; gear unchanged |
| Player 2 | Invalid pack-opening possibility removed | 55 / 55, unchanged | 1,626 → **1,625** | 21, unchanged | 82 areas; gear unchanged |

On corrected code, **OFF → each ON and OFF → all ON still add/remove zero active, presented or possible goals**. The fix is independent of the optional shop switch. Archaeology still has the same six/five task-record changes and 12 relevant chunk-detail changes. All other switches still have no task-record or content changes. All own/shared access sets, connected partner chunks, item availability/source arrays and equipment projections are identical between switches. Transport's region grouping and connection explanations change in both the deployed and corrected comparisons.

### Calculation time

Milliseconds. Foreground cells give **median (minimum–maximum)**; full cells give median. Compilation is a single fresh-worker measurement, not complete server readiness. Full/compact results are calculated separately; the two columns should not be added together.

| Case | Player 1 foreground | Player 2 foreground | Player 1 full | Player 2 full | Worker compilation |
| --- | ---: | ---: | ---: | ---: | ---: |
| All OFF | 2,913 (2,579–3,014) | 2,726 (2,689–2,914) | 3,116 | 3,120 | 4,268 |
| Archaeology ON | 2,760 (2,584–4,387) | 2,318 (2,107–2,429) | 3,380 | 2,902 | 8,290 |
| Shops ON | 2,519 (2,315–3,518) | 2,403 (2,073–2,862) | 2,968 | 2,932 | 3,364 |
| Transport ON | 3,978 (2,679–4,025) | 3,171 (3,069–3,609) | 3,507 | 3,219 | 4,266 |
| House storage ON | 1,696 (1,663–1,879) | 1,712 (1,574–2,180) | 1,889 | 1,781 | 3,007 |
| All four ON | 3,815 (3,516–5,041) | 4,618 (4,464–5,397) | 3,843 | 4,217 | 5,048 |

**Flag transport and all-four for possible load/unlock delay.** Transport's foreground medians increase by about 1.07 seconds for Player 1 and 0.45 seconds for Player 2. All-four medians increase by about 0.90 and 1.89 seconds. These are noticeable calculation contributions when a snapshot misses the cache, despite no new usable routes or goals. They are observations on a busy desktop, not controlled causal estimates or guaranteed browser delays.

Archaeology's fresh-worker compilation is about four seconds longer in this run, and Player 1's first foreground sample is 4.39 seconds rather than 3.01. Its repeated foreground medians do **not** show a sustained slowdown; the earlier single-sample impression did not hold. Treat startup/first-use cost as a concern to confirm on a quiet machine, not a proven ongoing unlock penalty. House storage is a F2P no-op, so its lower times illustrate host/JIT variation rather than a speed benefit from enabling it. Shops introduce no calculation work beyond an already-equal stock overlay.

### Payload size

KiB = 1,024 bytes; MiB = 1,048,576 bytes. Values use the last uncached sample. Tiny byte differences in otherwise identical results come from timing numbers; they are not new content.

| Case | Player | Foreground JSON KiB | Foreground Brotli KiB, quality 4 | Full result MiB |
| --- | --- | ---: | ---: | ---: |
| All OFF | Player 1 | 4,383.9 | 377.1 | 49.94 |
| All OFF | Player 2 | 4,366.3 | 377.3 | 50.25 |
| Archaeology ON | Player 1 | 4,384.5 | 377.2 | 49.94 |
| Archaeology ON | Player 2 | 4,366.8 | 377.3 | 50.25 |
| Shops ON | Player 1 | 4,383.9 | 377.1 | 49.94 |
| Shops ON | Player 2 | 4,366.3 | 377.2 | 50.25 |
| Transport ON | Player 1 | 4,511.4 | 382.4 | 50.31 |
| Transport ON | Player 2 | 4,493.3 | 382.8 | 50.62 |
| House storage ON | Player 1 | 4,383.9 | 377.1 | 49.94 |
| House storage ON | Player 2 | 4,366.3 | 377.3 | 50.25 |
| All four ON | Player 1 | 4,511.9 | 382.6 | 50.31 |
| All four ON | Player 2 | 4,493.8 | 382.6 | 50.62 |

Archaeology adds roughly 539 decoded bytes per member. Transport adds about 127 KiB decoded and 5.3–5.5 KiB compressed, mainly access diagnostics for routes whose requirements are unknown/unmet; it does not add task identities or reachable areas here. House/shops leave the foreground payload effectively unchanged. The full result is already about 50 MiB with all switches OFF; that is an existing full-detail cost, separate from the smaller foreground protocol. No optional switch substantially expands that full payload.

The ignored local reports are `.local/switches-deployed.json` and `.local/switches-fixed.json`. They contain comparison facts and code/input fingerprints, not credentials or a raw save. Final runner SHA-256: `c37dd46303d278e8fa7509a441a51bf0ec9c89c145d3a5214f8485cebc452e63`; fixed source-policy/access SHA-256: `a97164f922597d42b04eecedf0c28e47aa9bfdac575ed5b44a5430f12bf644ec` / `d33a560f737021dc737b038e1e5f23d2431a13f62879b9991118d12d3d074a9a`. The report also records Git base, app-diff hash, definitions hash and worker/engine hashes.

## Recommendations

**Archaeology: leave off for now.** You and Player 2 already have the same free Archaeology goals with it on or off. It improves the details for white oak, samite silk and Third Age iron, adds the Goblin Village white oak declaration, and corrects a triskelion level that neither of you can reach in F2P. Those are useful reference improvements, but they add no current task or travel choice. Startup was slower in this run, although repeated calculations were not consistently slower. Revisit it when more accurate cache details matter enough to you or when you move beyond F2P.

**Cache shop stock: leave off.** Neither of you gains a purchase, task, item or equipment upgrade because the six reviewed shops already contain the same item lists. You can still inspect the stock evidence while it is off. The members-only Jug of water pack mistake has been fixed on this branch and will be corrected whenever this fix is deployed, regardless of this switch. There is no current play benefit from turning the stock replacement on.

**Transport access: leave off until personal facts are recorded and reviewed.** Neither of you gets a new roll choice or reachable place from this save because the needed travel facts are missing. That does not mean you cannot use canoes or already-unlocked lodestones in the game; the picker has not been told enough to prove those trips for each of you. Turning it on now adds calculation work and more route explanations without changing play. Revisit after recording each person's real levels, activations, fares and necessary confirmations, then compare the affected routes before enabling it.

**House storage tasks: leave off while you stay F2P.** Neither player gets a storage goal. A free Mask of Dragith Nurn, Silverlight or anti-dragon shield does not make the house furniture that stores or displays it free. Your wooden bookcase already retrieves books without a fill task. This switch will become worth reconsidering after membership, with the current Rimmington furniture and materials available; there is no F2P benefit today.

**All four together: leave off.** The combined case brings only the same Archaeology detail changes, no additional goals/access/equipment, and the highest observed foreground times for Player 2. The source correction should be deployed independently when this branch's changes are reviewed; no switch needs to be enabled to receive it.

## Verification

Full `npm test`: **1,659 tests, 1,658 passed, 1 skipped, 0 failed**. The six new F2P shop regressions pass; the focused related run passed 47 tests. The comparison runner also passed syntax/help and input/output-boundary checks. Test temporary directories stayed inside this worktree, and server fixtures used ephemeral localhost ports. No live-picker operation was performed.

The copied save has been deleted. Only the comparison script, this report, the two source files needed for the membership fix and its regression test are committed. Derived JSON reports and test output remain ignored local artifacts.
