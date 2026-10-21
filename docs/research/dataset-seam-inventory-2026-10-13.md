# Dataset seam inventory, 13 October 2026

This inventory is the prerequisite for milestone 2 of `public-private-split-plan-2026-10-13.md`. It records source inspection in the `dataseam` worktree before implementation. No engines, tests, server, browser or live save were opened. Only this document was written. The plan's sections 1, 3, milestone 2 in section 5, and section 7, plus `docs/art-packs.md`, supply the boundary.

The existing provider must preserve the complete current dataset, overlay order, identities, rule contract and presentation. Selection must precede worker construction, world/rule compilation, storage preparation and browser catalogue exposure. A root JSON wrapper alone leaves the dependencies below active. No independent dataset or public export is implemented by this inventory.

There are no separate `app/identity`, `app/equipment`, `app/collection`, `app/collections` or `app/rules` directories. Their consumers are in `app/tasks`, `app/data` and `app/core`.

## Startup, workers and storage

| File:line | Source material | Consumer relation and required boundary |
| --- | --- | --- |
| `app/server.mjs:323` | Default `.local/duo` storage directory | Provider/binding failure must occur before this existing store is opened. No-pack public startup must use a separate directory in a later milestone. |
| `app/server.mjs:324` | Injected world, definitions, task map, registry and preparation hooks | Existing injection does not select the transitive overlays and identities. |
| `app/server.mjs:325` | Tracked resources and web roots | First art milestone intentionally retains private fallback defaults. |
| `app/server.mjs:326` | Dated task artwork directory | Art provider binding. |
| `app/server.mjs:327` | Original-picker world image directory | Art fallback, distinct from gameplay data. |
| `app/server.mjs:334` | `TERRAIN_BUNDLE` | Expected private art descriptor is still a default argument. |
| `app/server.mjs:337` | `.local/game-data` | Chunk-section bundle input directory. |
| `app/server.mjs:367,372` | Terrain manifest and source map manifest | Lazy art integrity and layout binding. |
| `app/server.mjs:390,391,398,399` | `ICON_BUNDLES`, committed icon descriptor JSON and installed icon manifests | Expected descriptors are read from the checkout unless injected; pin under selected profile. |
| `app/server.mjs:411` | `loadOriginalData` | Always invokes the legacy selection loader, even when definitions/map are injected. |
| `app/server.mjs:414` | Equipment and cache-shop corrections | Applied before world and worker construction. |
| `app/server.mjs:417` | World builder defaults | Default build can select walking/resource/Archaeology catalogues implicitly. |
| `app/server.mjs:421,423` | Injected section catalogue or `loadChunkSectionIndex(gameDataDir, ROOT, world)` | Bundle loader validates against three hardcoded repository dataset inputs. |
| `app/server.mjs:424` | Default rule registry | Materializes static rule/default contract. |
| `app/server.mjs:427,428` | Definition bytes, world, registry and worker options | Worker must receive selected provider receipt and all catalogues, including restart/lazy construction. |
| `app/server.mjs:435` | Pin details and map connections | Lazy authenticated map-info catalogue selects static private modules. |
| `app/server.mjs:442` | NPC and shop metadata | Lazy metadata catalogue selects static private modules. |
| `app/server.mjs:446,448` | Archaeology v1 JSON, environment enablement and correction bundle | Lazy payload selection must use same dataset as gameplay. |
| `app/server.mjs:451,456` | Interior v2 descriptor and art manifest bytes | Area joins are data; tiles/layout/hash descriptors remain art-bound. |
| `app/server.mjs:469` | `app/data/legacy-task-history.json` | Unconditional task history read precedes migration preparation. |
| `app/server.mjs:479,488,494,508` | Currentness check, migration hook, task map/history/catalogues, store creation | Binding must fail before hooks or `openStore`; preserve current-save no-op behavior. |
| `app/server.mjs:515` | Optional initial-import file | Local operator import input; selection must control dataset compatibility before applying it. |
| `app/tasks/worker.mjs:27` | Retained task and equipment overlays | Applied independently and unconditionally before engine creation. |
| `app/tasks/worker.mjs:39,40` | Only skill-guide catalogue passed as engine option | All other static engine defaults remain active. |
| `app/tasks/worker.mjs:47,54,55` | Skill-guide identities, collection defaults, rule defaults | Worker generates disabled guide identities and creates a default collection engine independently. |
| `app/tasks/migration.mjs:3,494,515,603,639` | Identity module plus explicit task map/history/catalogues | Parameters are explicit, but global static identity aliases remain transitive dependencies. |
| `app/storage/store.mjs:255,372,461,680,704,707,711` | Saved identities/legacy/provenance and preparation hooks | Store has no direct retained catalogue import; hooks can refresh catalogue, revise state, back up and persist. Binding must precede store preparation. |
| `app/cli.mjs:6,7,8,12,31,34,62` | World, original loader, default registry, definition/task bytes and source receipts | CLI uses the same implicit legacy loader/world/rule defaults. Generic algorithms must accept provider-selected inputs. |

## Data modules and engine consumers

All static import statements, defaults and file reads are reproduced with file:line in the appendix. The following groups explain their meaning.

| Material/provider ownership | Module locations | Consumers |
| --- | --- | --- |
| Frozen export and task seed | `app/data/original-data.mjs:4,12,18`; selection `original-data.2026-10-13.v1.json` points to root export and `reference/original-picker/tasksMap.json` | Server and CLI. Loader defaults to repository root and normalizes repository text for legacy hashes. |
| World, topology and map corrections | `world.mjs:5–8,11–15,20`; `cache-topology.mjs:1–5,10,17,20`; `map-corrections.mjs:16,26,35` | Access index, core roll/access rules and browser world module. |
| Resources and selectors | `cache-resources.mjs:1–5,13,22` imports resource v1, selectors v1 and Divination cache v1 | World/access; defaults merge catalogues at module evaluation and use environment enablement. |
| Archaeology | `cache-archaeology.mjs:1,6,10`; `archaeology-task-corrections.mjs:1,7` | World/access/task engine and server metadata. |
| Shops and NPCs | `cache-shops.mjs:1,5,15`; `cache-npcs.mjs:1,2,5` | Task/collection generation and server metadata. Shop enablement defaults to environment flag. |
| Interiors, pins and connections | `cache-interiors.mjs:1,3`; `map-pin-details.mjs:3,4`; `map-connections.mjs:1,10`; `map-pins.mjs:5,6` | Lazy server routes, browser map modules and art layouts. Pin details perform synchronous read at import. |
| Transport and entry policy | `transport-routes.mjs:1,10–12`; `cache-entry-policy.mjs:10,41–44`; `lodestones.mjs:5,19` | Core rules/state/territory/transport, server route lookup and world topology. |
| Membership and joins | `item-membership.mjs:1,4,16–18,41–43`; aliases/review/flags modules at line 1; `source-membership.mjs:1–6,11` | Task access/engine/membership/presentation and equipment. Source rows, method requirements, incidental outputs and item/monster reviews construct static lookup indexes. |
| Equipment facts | `equipment-corrections.mjs:2,3,5–7,41`; `equipment-permanence.mjs:1,3,4` | Server, worker, engine, equipment and presentation. Custom-options detection controls correction fallback. |
| Retained corrections | `metadata-corrections.mjs:1,34`; `retained-task-corrections.mjs:2–4,9,17`; `retained-unsupported-corrections.mjs:2,13`; `skillguide-combat-corrections.mjs:2,3` | Task engine, worker and server. Combined retained task/entry/wording list defaults silently apply unless selected explicitly. |
| Skill guides and house storage | `skill-guides.mjs:1,4,12,52`; `poh-storage.mjs:1,9`; `tasks/house-storage.mjs:13,22,30` | Engine generated tasks, worker identities, planner breakpoints. House identities are created at module evaluation. |
| Divination | `divination-training.mjs:1,14–26`; `training/catalogue.mjs:1,2,13,33` | Engine, area check and training catalogue; exact retained task/selector checks decide whether to add records. |
| Training, rates and banks | `training/banking-destinations.mjs:1,6–10`; `tasks/training-planner.mjs:1,5,7,9,103,118,252`; `tasks/fishing-plan.mjs:1,2,6,24`; `tasks/time-estimates.mjs:1,2,11,121,244`; `tasks/area-check.mjs:1,5,12,172` | Training estimates/planner, gathering helpers, area check and members-start/storage policy. Static rate JSON and authored tool/species registries participate. |
| Identities and aliases | `tasks/identity.mjs:1,31,42,68,77,81`; `data/identity-registry.mjs:4` onward | All task/entity/goal/source lookup, generated goals, migration, save commands and browser completion/profile/finish-line views. Static verified progress aliases are separate from generated registry. |

Engine imports are concentrated at `app/tasks/engine.mjs:7,14–24,29`. Defaults at lines 111 and 162 select retained, unsupported, Divination, metadata, equipment, shop and skill-guide behavior. `access.mjs:2–9,70–74,555,724`, `collection.mjs:4,5,105`, `equipment.mjs:4,5`, `presentation.mjs:5–7`, `membership.mjs:1,2` and `rates.mjs:1` extend that dependency graph. Dataset receipt/digest must scope derived indexes, compiled engines and caches.

## Rules, authored datasets and presentation

| File:line | Dataset facts carried in JavaScript |
| --- | --- |
| `app/data/settings.mjs:5,40,69,114,253,390,585,813,826,864` | Captured settings, wording, ordering, defaults, rule descriptions, presets, subdefaults, generation and conflicts. Moving the captured JSON alone leaves these private materials. |
| `app/data/settings.mjs:896,921,929,978,1433,1528–1600` | Derived setting/rule contract, effective cutoffs, retained references and category counts; authored behavior descriptions depend on retained coverage. |
| `app/data/identity-registry.mjs:4` onward | Exact categories/labels, old aliases, entity names, goals and source objective joins. Authored token minting does not make copied labels independent. |
| `app/tasks/identity.mjs:42` | Verified progress aliases joining exact retained categories/labels to permanent IDs. |
| `app/data/access-policy.mjs:7`; `cache-entry-policy.mjs:10,41–44`; `lodestones.mjs:5,19`; `map-corrections.mjs:16,26,35` | Named source exceptions, gates, coordinates, before-values, hashes and retained bindings. |
| `app/data/map-pin-categories.mjs:3,116,156,261,361`; `map-pins.mjs:124` | Category/sprite/legend dictionaries and pinned upstream provenance. |
| `app/data/training/banking-destinations.mjs:6,7` | Hardcoded free/member bank chunk sets. |
| `app/tasks/engine.mjs:43–46,71–75`; `processing.mjs:6`; `achievements.mjs:3` | F2P/trial/skill caps, skill groupings, processing and achievement-family rules. Review closely modelled policies against authored specification. |
| `app/core/rules.mjs:45,169` | Built-in keys/types/defaults, presentation and default registry; route and skill-guide imports feed the contract. |
| `app/core/transport-access.mjs:139,309`; `territory.mjs:1`; `state.mjs:12,13,15`; `preferences.mjs:1,9` | Default route catalogue/lodestones, state validators and global preference contract. |
| `app/core/f2p-skill-caps.mjs:2`; `combat-level.mjs:4`; `player-controls.mjs:3`; `progress-timeline.mjs:28` | Caps, combat formula inputs and skill sets shared across server/browser algorithms. |
| `app/core/game-progress.mjs:3` | Personal integration defaults. Move to explicit private configuration; this inventory does not reproduce account values. |
| `app/web/finish-line-model.mjs:14,19,44` | F2P skill targets, reasons and gear facts. |
| `app/web/chunk-planning.mjs:7`; `art-status.mjs:3–5`; `app/core/map-markers.mjs:4` | Skill/category UI taxonomies; generic taxonomy may remain after provenance/contract review. |
| `app/web/task-artwork.mjs:6`; `app/data/icons.mjs:7–10`; `terrain-assets.mjs:9`; `interior-assets.mjs:5` | Private bindings and expected art descriptors. Art selection cannot grant gameplay access. |

`app/data/world.mjs:11–13` detects cache walking using more than 2,000 chunks and two exact chunk nicknames. `app/data/divination-training.mjs:26` detects reviewed coverage from an exact wisp/colossus selector. Replace these with declared capabilities while keeping the legacy profile's current values. Environment enablement in resources, Archaeology and shops belongs to the explicit selected profile/options.

## Browser imports and static exposure

`app/web/rules-model.mjs:1,8,42,132,151` imports captured UI JSON, derives actual defaults, constructs a catalogue at module evaluation, and uses it as default for changes/presets. `history-text.mjs:3`, `kept-rules.mjs:1`, `rules-panel.mjs:1`, `original-sync.mjs:1`, `sandbox-rules.mjs:1`, `screen-settings.mjs:1` and `settings-panel.mjs:1` also import retained settings. Rules text must bind to the exact selected semantic contract without changing saved preset values.

Browser map imports include `map-pins.mjs:1,2,80–111`, `map-pin-renderer.mjs:2`, `map-info.mjs:1`, `map-place-labels.mjs:5,216`, `icons.mjs:2,16`, `map.mjs:1,5`, `map-terrain.mjs:1`, `map-capture.mjs:1` and `screen-chunks.mjs:6`. `map-activity-layer-model.mjs:1` imports membership policy. `gallery-fixtures.mjs:1` imports gallery JSON and needs private fixture exclusion/replacement.

| Server file:line | Direct served material |
| --- | --- |
| `app/server.mjs:1821,1822` | Mining rates/rules modules and mining-rate JSON. |
| `app/server.mjs:1823,1824` | Woodcutting rates/rules modules and woodcutting-rate JSON. |
| `app/server.mjs:1832` | Access policy module. |
| `app/server.mjs:1835` | Dated place-label JSON. |
| `app/server.mjs:1854` | Surface grid and world-connection modules. |
| `app/server.mjs:1855` | Archaeology module/v1 JSON and interior module/v1/v2 JSON, including unselected historical versions. |
| `app/server.mjs:1856` | Captured original-rule UI JSON. |
| `app/server.mjs:1865` | Core modules with transitive dataset imports, including state, rules, territory, transport, preferences and personal integration defaults. |
| `app/server.mjs:1866` | Migration, rates and identity modules. |
| `app/server.mjs:1868` | Skill-guide rule module. |
| `app/server.mjs:1869` | World/resource/selectors/topology/entry-policy modules and JSON; all three route versions; surface corrections/walkability/component policy; settings/lodestones/map corrections/pin dictionaries/identity registry. |
| `app/server.mjs:1870` onward | Map asset manifest and pin payload fallback through art provider; pin placement semantics remain dataset metadata. |
| `app/server.mjs:1188,1190,1232` | Changelog, roadmap and training API catalogue. Changelog/roadmap also require export privacy review. |

The direct route allowlists expose private metadata even if gameplay functions receive an injected independent catalogue. Selection must govern served catalogues and modules; authentication alone does not establish dataset isolation.

## Implementation and verification implications

The provider contract needs definitions/seed/history, complete identities and verified aliases, world/topology/source/membership/equipment/training catalogues, explicit capabilities/options, rules/settings/defaults/preset values, separate bound presentation, and provenance/digests. Workers and lazy metadata loaders must consume the same receipt. Default arguments must not reapply retained datasets after explicit selection. Module-level maps, transformed catalogues, house identities and rule registries need selected construction.

Preserve byte and canonical text receipts as currently applicable. Package selected versions without rewriting inputs or selecting historical files merely because they are present. No pack installation creates a gameplay event, remints an ID, revises a current save or silently chooses another dataset. Missing/mismatched legacy data must fail before `openStore` or preparation hooks.

This is a source inventory, not parity evidence. Future authorized synthetic/private checks must compare task/access/equipment/transport/rule outputs and command/Undo behavior; live-save authorization remains separate. The public export gate must inspect browser payloads, generated fixtures, module strings and every allowed path, rather than excluding only root JSON and artwork.

## Mechanical source appendix

The following matches enumerate imports, dataset defaults, static JSON paths, reads and capability heuristics in authored runtime modules. Matches include generic reads and parsers so a reviewer can distinguish operator/storage inputs from static catalogue material. This appendix was generated with `rg` against `.mjs` source only; no imported code was evaluated. JSON content was not dumped and live storage was not read.

```text
app/cli.mjs:1:import { readFile } from 'node:fs/promises';
app/cli.mjs:2:import { createHash } from 'node:crypto';
app/cli.mjs:3:import { sha256RepositoryText } from '../scripts/lib/provenance-hash.mjs';
app/cli.mjs:4:import { performance } from 'node:perf_hooks';
app/cli.mjs:5:import { fileURLToPath } from 'node:url';
app/cli.mjs:6:import { buildWorld, findTaskIdCollisions } from './data/world.mjs';
app/cli.mjs:7:import { loadOriginalData } from './data/original-data.mjs';
app/cli.mjs:8:import { createRuleRegistry, evaluateRollPool, taskCompletion } from './core/rules.mjs';
app/cli.mjs:9:import { createGroupState, importLegacyMaps, exportBackup, importBackup } from './core/state.mjs';
app/cli.mjs:43:    const snapshotBytes = await readFile(options.snapshot);
app/server.mjs:1:import http from 'node:http';
app/server.mjs:2:import { serveGallery } from './gallery-route.mjs';
app/server.mjs:3:import { readFile, realpath, stat } from 'node:fs/promises';
app/server.mjs:4:import { readdirSync, readFileSync } from 'node:fs';
app/server.mjs:5:import path from 'node:path';
app/server.mjs:6:import { fileURLToPath } from 'node:url';
app/server.mjs:7:import { createHash, randomUUID } from 'node:crypto';
app/server.mjs:8:import { createGzip, createGunzip } from 'node:zlib';
app/server.mjs:9:import { Readable } from 'node:stream';
app/server.mjs:10:import { pipeline } from 'node:stream/promises';
app/server.mjs:11:import { isImportRoute, readBackupRequest, sendGzipBackup, backupPreviewState } from './backup-transfer.mjs';
app/server.mjs:12:import { createTaskScheduler } from './tasks/scheduler.mjs';
app/server.mjs:13:import { createPoolRanking } from './tasks/pool-ranking.mjs';
app/server.mjs:14:import { openStore, prepareStoreProcessIdentity } from './storage/store.mjs';
app/server.mjs:15:import { openInviteStore } from './storage/invites.mjs';
app/server.mjs:16:import { openFeedbackStore } from './storage/feedback.mjs';
app/server.mjs:17:import { openUsageRoute } from './usage-route.mjs';
app/server.mjs:18:import { openOverlays } from './overlays.mjs';
app/server.mjs:19:import { readBackupStatus } from './storage/backup-status.mjs';
app/server.mjs:20:import { transportRouteById } from './data/transport-routes.mjs';
app/server.mjs:21:import { normalizePublicOrigin, requestContext, checkRequestOrigin, createRateLimits } from './security/request.mjs';
app/server.mjs:22:import { buildWorld } from './data/world.mjs';
app/server.mjs:23:import { loadOriginalData } from './data/original-data.mjs';
app/server.mjs:24:import { evaluateTransportRoutes } from './core/transport-access.mjs';
app/server.mjs:25:import { cacheResourceContentsEnabled } from './data/cache-resources.mjs';
app/server.mjs:26:import { cacheArchaeologyContentsEnabled } from './data/cache-archaeology.mjs';
app/server.mjs:27:import { archaeologyTaskCorrections } from './data/archaeology-task-corrections.mjs';
app/server.mjs:28:import { importBackup, importLegacyMaps, previewRestore, BACKUP_FORMAT, SCHEMA_VERSION } from './core/state.mjs';
app/server.mjs:29:import { groupGoalCommandTypes } from './core/group-goals.mjs';
app/server.mjs:30:import { builtInRules, createRuleRegistry, evaluateRollPool, partnerConnections } from './core/rules.mjs';
app/server.mjs:31:import { previewRuleProfile } from './core/planning.mjs';
app/server.mjs:32:import { hasGameplayMigration, hasCurrentProgressAliasMigration, hasCurrentJournalMigration, migrateOwnedGameplay, resolveSavedTaskId } from './tasks/migration.mjs';
app/server.mjs:33:import { buildIdentityIndex, isPermanentId } from './tasks/identity.mjs';
app/server.mjs:34:import { createRuneMetricsClient, createQuestMapping, previewRuneMetrics } from './integrations/runemetrics.mjs';
app/server.mjs:35:import { createOriginalSyncClient, previewOriginalSync, originalSyncCommand } from './integrations/original-sync.mjs';
app/server.mjs:36:import { applyEquipmentCorrections } from './data/equipment-corrections.mjs';
app/server.mjs:37:import { applyCacheShops } from './data/cache-shops.mjs';
app/server.mjs:38:import trainingCatalogue from './data/training/methods.f2p.json' with { type: 'json' };
app/server.mjs:39:import membersStartBanks from './data/members-start-banks.2026-10-12.v1.json' with { type: 'json' };
app/server.mjs:40:import { planTraining, trainingPreferences } from './tasks/training-planner.mjs';
app/server.mjs:41:import { createBankingRoutes } from './training/banking-routes.mjs';
app/server.mjs:42:import { createGatheringRouteLookup } from './tasks/banking-plan.mjs';
app/server.mjs:43:import { MINING_PICKAXES, MINING_PROFILES } from './training/mining-rates.mjs';
app/server.mjs:44:import { WOODCUTTING_HATCHETS } from './training/woodcutting-rates.mjs';
app/server.mjs:45:import { buildTrainingAvailability, createTrainingSourceIndex, trainingProgress } from './tasks/training-availability.mjs';
app/server.mjs:46:import { houseStorageCatalogue } from './data/poh-storage.mjs';
app/server.mjs:47:import { skillGuideCatalogue } from './data/skill-guides.mjs';
app/server.mjs:48:import { createIconCatalogue, ICON_MANIFEST_PATH, ICON_BUNDLES } from './data/icons.mjs';
app/server.mjs:49:import { createInteriorAssetCatalogue } from './data/interior-assets.mjs';
app/server.mjs:50:import { createTerrainAssetCatalogue, validateTerrainDescriptor, TERRAIN_BUNDLE, TERRAIN_MANIFEST_PATH } from './data/terrain-assets.mjs';
app/server.mjs:51:import { buildInteriorMapIndex, getInteriorArea } from './core/interior-maps.mjs';
app/server.mjs:52:import { loadChunkSectionIndex, buildChunkSectionIndex, chunkSectionsPayload } from './core/chunk-sections.mjs';
app/server.mjs:53:import { projectDisplayWorld } from './display-world.mjs';
app/server.mjs:54:import { projectMapLayerData } from './map-layer-data.mjs';
app/server.mjs:55:import { projectPlayState, projectPlayResult, PLAY_VIEW } from './play-view.mjs';
app/server.mjs:56:import { projectDuoPlayResult, projectDuoInspectionJSON, DUO_INSPECTION_VIEW } from './duo-play-view.mjs';
app/server.mjs:57:import { selectDuoTasks } from './web/duo-tasks.mjs';
app/server.mjs:58:import { createRepresentation, sendRepresentation, createResponseCache, negotiateEncoding, PRIVATE_NO_STORE, PRIVATE_REVALIDATE } from './http-response.mjs';
app/server.mjs:59:import { crc32, deflateRawSync } from 'node:zlib';
app/server.mjs:60:import { normalizeSandboxRequest, sandboxTaskCatalogue, applySandboxChanges } from './sandbox.mjs';
app/server.mjs:61:import { normalizeAreaCheckRequest } from './tasks/area-check.mjs';
app/server.mjs:62:import { helperDrops } from './helper-drops.mjs';
app/server.mjs:63:import { backlogSearchTasks } from './tasks/backlog-search.mjs';
app/server.mjs:64:import { createProgressQuestPoints } from './helper-progress.mjs';
app/server.mjs:65:import { startEarlyServer } from './startup.mjs';
app/server.mjs:66:import { createStartupWarmup } from './tasks/startup-warmup.mjs';
app/server.mjs:67:import { createIdleMemoryReclaimer } from './idle-memory.mjs';
app/server.mjs:68:import { releaseAutomaticTransportCaches } from './core/automatic-transport.mjs';
app/server.mjs:69:import { buildXpChoiceCatalogue, buildXpChoiceView } from './core/xp-choices.mjs';
app/server.mjs:70:import { createArtProvider } from './art-provider.mjs';
app/server.mjs:71:import { artBinding } from './art-bindings.mjs';
app/server.mjs:80:    for (const name of names) { hash.update(name); hash.update(readFileSync(path.join(base, name))); }
app/server.mjs:87:  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
app/server.mjs:361:  const terrainCatalogue = () => terrainCataloguePending ??= (async () => {
app/server.mjs:367:      const bytes = await readFile(file);
app/server.mjs:372:      const sourceManifest = await readFile(await art.required('mapAssets', 'manifest.json'));
app/server.mjs:391:        JSON.parse(await readFile(path.join(ROOT, 'app', 'data', bundle.manifest), 'utf8'))));
app/server.mjs:398:          const file = await art.required('iconAssets', `${bundle.assetDirectory}/manifest.json`);
app/server.mjs:399:          const local = JSON.parse(await readFile(file, 'utf8'));
app/server.mjs:403:      const catalogue = createIconCatalogue(installed);
app/server.mjs:446:  const loadArchaeology = () => archaeologyCache ??= import('./data/cache-archaeology.2026-10-08.v1.json', { with: { type: 'json' } })
app/server.mjs:451:    const catalogue = interiorCatalogue ?? (await import('./data/cache-interiors.2026-10-08.v2.json', { with: { type: 'json' } })).default;
app/server.mjs:456:      const bytes = await readFile(file);
app/server.mjs:469:      readFile(path.join(ROOT, 'app', 'data', 'legacy-task-history.json'), 'utf8').then(bytes => JSON.parse(bytes)),
app/server.mjs:478:  const sandboxCatalogue = taskWorker ? [...taskWorker.catalogue, ...taskWorker.dynamicCatalogue] : [];
app/server.mjs:501:    context.catalogue = taskWorker.catalogue;
app/server.mjs:505:  const xpChoiceCatalogue = buildXpChoiceCatalogue(parsedDefinitions, [...(taskWorker?.catalogue ?? []), ...(taskWorker?.dynamicCatalogue ?? [])]);
app/server.mjs:515:      const document = typeof initialImport === 'string' ? JSON.parse(await readFile(initialImport, 'utf8')) : initialImport;
app/server.mjs:1188:          if (route === '/api/changelog') { await json(request, response, 200, JSON.parse(await readFile(path.join(ROOT, 'app', 'data', 'changelog.json'), 'utf8'))); return; }
app/server.mjs:1190:          if (route === '/api/roadmap') { await json(request, response, 200, JSON.parse(await readFile(path.join(ROOT, 'app', 'data', 'roadmap.json'), 'utf8'))); return; }
app/server.mjs:1447:                response.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': PRIVATE_NO_STORE,
app/server.mjs:1471:            else await json(request, response, 200, backup, { 'Content-Disposition': 'attachment; filename="rs3-duo-backup.json"' });
app/server.mjs:1795:        const catalogue = await terrainCatalogue();
app/server.mjs:1801:        const catalogue = await iconCatalogue();
app/server.mjs:1822:      else if (route === '/data/training/mining-rates.v1.json') file = await containedFile(path.join(ROOT, 'app', 'data', 'training'), 'mining-rates.v1.json');
app/server.mjs:1824:      else if (route === '/data/training/woodcutting-rates.v1.json') file = await containedFile(path.join(ROOT, 'app', 'data', 'training'), 'woodcutting-rates.v1.json');
app/server.mjs:1835:      else if (route === '/data/place-labels.2026-10-13.v1.json') file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
app/server.mjs:1855:      else if (['/data/cache-archaeology.mjs', '/data/cache-archaeology.2026-10-08.v1.json', '/data/cache-interiors.mjs', '/data/cache-interiors.2026-10-08.v1.json', '/data/cache-interiors.2026-10-08.v2.json'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
app/server.mjs:1856:      else if (route === '/data/original-rules-ui.2026-10-08.v1.json') file = await containedFile(path.join(ROOT, 'app', 'data'), 'original-rules-ui.2026-10-08.v1.json');
app/server.mjs:1869:      else if (['/data/world.mjs', '/data/cache-resources.mjs', '/data/cache-resources.2026-10-08.v1.json', '/data/cache-resource-selectors.2026-10-08.v1.json', '/data/cache-topology.mjs', '/data/cache-entry-policy.mjs', '/data/transport-routes.mjs', '/data/transport-routes.2026-10-08.v1.json', '/data/transport-routes.2026-10-09.v1.json', '/data/transport-routes.2026-10-09.v2.json', '/data/cache-surface-corrections.2026-10-08.v1.json', '/data/cache-walkability.2026-10-07.v1.json', '/data/cache-component-policy.2026-10-07.v1.json', '/data/settings.mjs', '/data/lodestones.mjs', '/data/map-corrections.mjs', '/data/map-pins.mjs', '/data/map-pin-categories.mjs', '/data/identity-registry.mjs'].includes(route)) file = await containedFile(path.join(ROOT, 'app', 'data'), route.slice('/data/'.length));
app/server.mjs:1870:      else if (route === '/assets/map/manifest.json') {
app/server.mjs:1872:          file = await art.required('mapAssets', 'manifest.json');
app/server.mjs:1873:          const manifest = JSON.parse(await readFile(file, 'utf8'));
app/server.mjs:1876:          if (manifest.pins?.path === 'pins.normalized.json' || manifest.pins?.path === '/assets/map/pins.normalized.json') {
app/server.mjs:1877:            try { await art.required('mapAssets', 'pins.cache-2026-10-08-05932552f7af-v1.json'); }
app/server.mjs:1880:              await art.required('mapAssets', 'pins.normalized.json');
app/server.mjs:1889:      else if (route === '/assets/map/pins.normalized.json'
app/server.mjs:1890:        || ['/assets/map/pins.cache-2026-10-08-05932552f7af-v1.json', '/assets/map/manifest.cache-2026-10-08-05932552f7af-v1.json'].includes(route)
app/server.mjs:1896:        const catalogue = await iconCatalogue();
app/server.mjs:1912:        const catalogue = await terrainCatalogue();
app/server.mjs:1932:        const bytes = await readFile(file);
app/server.mjs:1940:          compress: ['.html', '.css', '.mjs', '.json', '.svg'].includes(extension) }));
app/storage\backup-status.mjs:1:import { open } from 'node:fs/promises';
app/storage\backup-status.mjs:2:import path from 'node:path';
app/storage\backup-status.mjs:62:  const raw = await boundedRead(path.join(localDir, 'backup-status.json'), 16384);
app/storage\feedback.mjs:1:import { open, readFile, rename, rm } from 'node:fs/promises';
app/storage\feedback.mjs:2:import { randomBytes, randomUUID } from 'node:crypto';
app/storage\feedback.mjs:3:import { setTimeout as delay } from 'node:timers/promises';
app/storage\feedback.mjs:4:import path from 'node:path';
app/storage\feedback.mjs:64:  const file = path.join(dataDir, 'feedback.json');
app/storage\feedback.mjs:66:  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
app/storage\gameplay-fingerprint.mjs:1:import { createHash } from 'node:crypto';
app/storage\history-reader.mjs:1:import { createReadStream } from 'node:fs';
app/storage\history-reader.mjs:2:import { createGunzip } from 'node:zlib';
app/web\activity-view.mjs:1:import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';
app/storage\invites.mjs:1:import { open, readFile, rename, rm } from 'node:fs/promises';
app/storage\invites.mjs:2:import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
app/storage\invites.mjs:3:import { setTimeout as delay } from 'node:timers/promises';
app/storage\invites.mjs:4:import path from 'node:path';
app/storage\invites.mjs:67:  const file = path.join(dataDir, 'invites.json');
app/storage\invites.mjs:69:  try { current = validate(JSON.parse(await readFile(file, 'utf8'))); }
app/storage\usage.mjs:1:import { open, readFile, rename, rm } from 'node:fs/promises';
app/storage\usage.mjs:2:import { randomBytes } from 'node:crypto';
app/storage\usage.mjs:3:import { setTimeout as delay } from 'node:timers/promises';
app/storage\usage.mjs:4:import path from 'node:path';
app/storage\usage.mjs:5:import { usageEvents } from '../web/usage-catalogue.mjs';
app/storage\usage.mjs:65:  const file = path.join(dataDir, 'usage.json'), known = new Set([...actors, 'viewer', 'unlinked']);
app/storage\usage.mjs:72:    current = JSON.parse(await readFile(file, 'utf8'));
app/storage\store.mjs:1:import { link, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, utimes } from 'node:fs/promises';
app/storage\store.mjs:2:import path from 'node:path';
app/storage\store.mjs:3:import { hostname } from 'node:os';
app/storage\store.mjs:4:import { createServer as createNetServer } from 'node:net';
app/storage\store.mjs:5:import { execFile } from 'node:child_process';
app/storage\store.mjs:6:import { setTimeout as delay } from 'node:timers/promises';
app/storage\store.mjs:7:import { createHash, randomBytes } from 'node:crypto';
app/storage\store.mjs:8:import { gzip, gunzip, constants } from 'node:zlib';
app/storage\store.mjs:9:import { promisify, isDeepStrictEqual } from 'node:util';
app/storage\store.mjs:10:import { applyValidatedCommand, BACKUP_FORMAT, SCHEMA_VERSION, createGroupState, importBackup, validateState, validateOwnedState, validateHistoryActor, getUndoEligibility, hasRetainedSparseUndo, cancelTaskClaimUndo } from '../core/state.mjs';
app/storage\store.mjs:11:import { resolveSavedTaskId } from '../tasks/migration.mjs';
app/storage\store.mjs:12:import { evaluateRollPool, partnerConnections } from '../core/rules.mjs';
app/storage\store.mjs:13:import { captureProgressSnapshot, buildProgressModel } from '../core/progress-timeline.mjs';
app/storage\store.mjs:14:import { createGameplayFingerprint } from './gameplay-fingerprint.mjs';
app/storage\store.mjs:15:import { createTaskReuseFingerprint } from '../tasks/unlock-reuse.mjs';
app/storage\store.mjs:16:import { projectPlayState, PLAY_VIEW } from '../play-view.mjs';
app/storage\store.mjs:17:import { readHistoryEvents } from './history-reader.mjs';
app/storage\store.mjs:18:import { computeRollStats, selectRollStatsEvent } from '../core/roll-stats.mjs';
app/storage\store.mjs:19:import { describeHistoryEvent, historyChangeType, historyChangeTypes } from '../web/history-text.mjs';
app/storage\store.mjs:34:const BACKUP_ID = /^(\d{16})-[a-f0-9]{16}\.json(?:\.gz)?$/;
app/storage\store.mjs:35:const HISTORY_ID = /^history-\d{16}-\d{16}-[a-f0-9]{16}\.json\.gz$/;
app/storage\store.mjs:36:const ARCHIVE_ID = /^archive-[a-f0-9]{16}\.json\.gz$/;
app/storage\store.mjs:37:const STATIC_ID = /^static-([a-f0-9]{64})\.json\.gz$/;
app/storage\store.mjs:91:    if (await readFile(file, 'utf8') !== contents) return false;
app/storage\store.mjs:141:      const marker = await readFile(recoveryFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
app/storage\store.mjs:148:          try { locked = JSON.parse(await readFile(file, 'utf8')); } catch { /* Uncertain ownership requires manual recovery. */ }
app/storage\store.mjs:167:        try { previous = await readFile(file, 'utf8'); } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
app/storage\store.mjs:221:  const stateFile = path.join(directory, 'state.json');
app/storage\store.mjs:287:      compressed = await readFile(file);
app/storage\store.mjs:333:    const reference = { id: `static-${sha256}.json.gz`, sha256 };
app/storage\store.mjs:439:    const name = `${String(state.revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`;
app/storage\store.mjs:448:    if (label) await atomicWrite(`${file}.meta.json`, JSON.stringify({ label }));
app/storage\store.mjs:491:        const bytes = await gunzipAsync(await readFile(path.join(historyDir, reference.id)));
app/storage\store.mjs:544:      const id = `history-${String(updates[0].revision).padStart(16, '0')}-${String(updates.at(-1).revision).padStart(16, '0')}-${randomBytes(8).toString('hex')}.json.gz`;
app/storage\store.mjs:561:      const label = metadata.has(`${entry.name}.meta.json`) ? (await readDocument(path.join(backupsDir, `${entry.name}.meta.json`), false)).label : undefined;
app/storage\store.mjs:566:    const bytes = await readFile(file);
app/storage\store.mjs:608:        const packId = `archive-${randomBytes(8).toString('hex')}.json.gz`;
app/storage\store.mjs:673:    try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch (error) {
app/storage\store.mjs:680:    try { current = await importStoredBackup(await readFile(stateFile, 'utf8'), true); existing = true; } catch (error) {
app/storage\store.mjs:1009:        const bytes = await readFile(file);
app/web\area-check.mjs:1:import { createAreaSelection, AREA_CHECK_CAP } from './area-check-selection.mjs';
app/web\area-check.mjs:2:import { loadIcons, skillIcon } from './icons.mjs';
app/training\fishing-rates.mjs:2:import { FISHING_METHODS, FISHING_BOUNDS } from './fishing-rules.mjs';
app/web\backup-status.mjs:1:import { describeHistoryEvent } from './history-text.mjs';
app/training\banking-routes.mjs:1:import { inflateRawSync } from 'node:zlib';
app/training\banking-routes.mjs:2:import masks from '../data/training/banking-masks.v1.json' with { type: 'json' };
app/training\banking-routes.mjs:3:import fishing from '../data/training/banking-fishing-spots.v1.json' with { type: 'json' };
app/training\banking-routes.mjs:4:import { reviewedBankingService, bankingServiceEvidence } from '../data/training/banking-destinations.mjs';
app/web\art-status.mjs:30:      if (response.ok) return setArtStatus(await response.json());
app/training\mining-rates.mjs:2:import { MINING_ROCKS, MINING_PICKAXES, MINING_PROFILES, MINING_STAMINA_MILESTONES, MINING_BOUNDS } from './mining-rules.mjs';
app/training\woodcutting-rates.mjs:2:import { WOODCUTTING_TREES, WOODCUTTING_HATCHETS, WOODCUTTING_BOUNDS } from './woodcutting-rules.mjs';
app/core\cache-surface.mjs:63:  for (const [id, enabled] of Object.entries(overrides)) if (enabled === true) for (const component of componentLocations(world, id, { landing: true })) add(component);
app/web\backup-transfer.mjs:17:  if (!file) throw new Error('Choose a .json or .json.gz backup.');
app/web\backup-transfer.mjs:24:      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open gzip backups. Unzip the file and choose the .json backup.');
app/web\backup-transfer.mjs:58:  if (!response.ok) { const value = await response.json(); throw new Error(value.message || 'The backup could not be downloaded.'); }
app/web\banking-settings.mjs:1:import { bankingSettingDefinitions } from '../core/banking-settings.mjs';
app/core\chunk-sections.mjs:1:import { readFile } from 'node:fs/promises';
app/core\chunk-sections.mjs:2:import path from 'node:path';
app/core\chunk-sections.mjs:3:import { gunzipSync } from 'node:zlib';
app/core\chunk-sections.mjs:4:import { sha256, sha256RepositoryText } from '../../scripts/lib/provenance-hash.mjs';
app/core\chunk-sections.mjs:8:export const SECTION_INPUTS = ['app/data/cache-walkability.2026-10-07.v1.json',
app/core\chunk-sections.mjs:9:  'app/data/cache-component-policy.2026-10-07.v1.json', 'app/data/cache-surface-corrections.2026-10-08.v1.json'];
app/core\chunk-sections.mjs:89:    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
app/core\chunk-sections.mjs:90:    const bytes = await readFile(path.join(directory, 'sections.v1.json.gz'));
app/core\chunk-sections.mjs:92:    const catalogue = JSON.parse(gunzipSync(bytes));
app/core\chunk-sections.mjs:95:    for (const file of SECTION_INPUTS) if (provenance?.repositoryHashes?.[file] !== sha256RepositoryText(await readFile(path.join(repositoryRoot, file)))) throw new Error('Runtime input differs from bundle.');
app/core\automatic-transport.mjs:1:import { sameRuneScapeName } from './game-progress.mjs';
app/core\chunk-colours.mjs:1:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/web\bis-comparison-view.mjs:1:import { renderBiSComparison } from './bis-compare.mjs';
app/web\browser-task-icons.mjs:1:import { taskIcon as modelIcon, taskCategoryIcon as modelCategoryIcon, taskItemNames } from '../tasks/task-icons.mjs';
app/web\browser-task-icons.mjs:2:import { categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture } from './art-status.mjs';
app/core\finish-line.mjs:1:import { playerControlSkills } from './player-controls.mjs';
app/core\finish-line.mjs:2:import { helperTrialCaps } from './f2p-skill-caps.mjs';
app/web\chunk-colour-picker.mjs:1:import { CHUNK_COLOURS, LEGACY_CHUNK_COLOURS, MAX_CHUNK_COLOUR_NAME_LENGTH, resolveMemberChunkColours, resolveMemberChunkColourNames } from '../core/chunk-colours.mjs';
app/core\map-markers.mjs:73:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/core\player-controls.mjs:43:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/web\chunk-planning.mjs:1:import { baseLocationId, buildChunkPlanningIndex, buildChunkPlanningIndexIncremental } from '../tasks/chunk-planning-index.mjs';
app/web\chunk-planning.mjs:2:import { taskIcon } from './browser-task-icons.mjs';
app/core\group-goals.mjs:1:import { lookupPermanentId } from '../tasks/identity.mjs';
app/core\group-goals.mjs:2:import { groupGoalCommandKeys } from './group-goal-types.mjs';
app/core\planning.mjs:1:import { applyCommand, validateState } from './state.mjs';
app/core\planning.mjs:2:import { createRuleRegistry } from './rules.mjs';
app/core\game-progress.mjs:1:import { playerControlSkills } from './player-controls.mjs';
app/web\chunk-quest-filters.mjs:1:import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';
app/core\mining-settings.mjs:1:import { MINING_PICKAXES, MINING_PROFILES } from '../training/mining-rates.mjs';
app/web\completed-model.mjs:1:import { createTaskFactsIndex } from '../core/progress-index.mjs';
app/web\completed-model.mjs:2:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\completed-model.mjs:20:  const catalogue = [...scopedGenerated, ...generated, ...(state.tasks ?? [])];
app/core\preferences.mjs:1:import { settingDefinitions, authoredSettingDefinitions } from '../data/settings.mjs';
app/core\preferences.mjs:2:import { deathSettingDefinitions, validateDeathSetting } from './death-settings.mjs';
app/core\preferences.mjs:3:import { miningSettingDefinitions } from './mining-settings.mjs';
app/core\preferences.mjs:4:import { woodcuttingSettingDefinitions } from './woodcutting-settings.mjs';
app/core\preferences.mjs:5:import { bankingSettingDefinitions } from './banking-settings.mjs';
app/core\progress-index.mjs:1:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\completed-range-preference.mjs:1:import { normalizeCompletedRange } from './completed-range.mjs';
app/core\progress-timeline.mjs:1:import { combatLevelFromSkills } from './combat-level.mjs';
app/core\progress-timeline.mjs:2:import { playerControlSkills } from './player-controls.mjs';
app/core\progress-timeline.mjs:3:import { sameRuneScapeName, validateRuneMetricsTimestamp } from './game-progress.mjs';
app/core\progress-timeline.mjs:4:import { resolveSavedTaskId } from '../tasks/migration.mjs';
app/core\progress-timeline.mjs:5:import { finishLineCommandTypes } from './finish-line.mjs';
app/core\progress-timeline.mjs:6:import { PROGRESS_METRICS, MAX_PROGRESS_DAYS, validateProgressSnapshots } from './progress-snapshots.mjs';
app/core\progress.mjs:1:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/migration.mjs';
app/core\progress.mjs:2:import { createTaskFactsIndex as createIndex } from './progress-index.mjs';
app/core\rules.mjs:1:import { createRuleRegistryFromDefinitions } from './rule-registry.mjs';
app/core\rules.mjs:2:import { hasGameplayMigration, projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/migration.mjs';
app/core\rules.mjs:3:import { evaluatePartnerConnections } from './territory.mjs';
app/core\rules.mjs:4:import { freeDestinationBlocker, frontierDestinationSections, isWalkingSectionEdge } from './map-boundaries.mjs';
app/core\rules.mjs:5:import { surfaceReachability, projectLegacySections, componentBlocked } from './cache-surface.mjs';
app/core\rules.mjs:6:import { TRANSPORT_ACCESS_RULE } from '../data/cache-entry-policy.mjs';
app/core\rules.mjs:7:import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE, SKILL_GUIDE_CORRECTIONS_RULE } from '../data/skill-guide-rules.mjs';
app/core\rules.mjs:8:import { expandTransportReachability, evaluateTransportRoutes, transportEdges, transportReachabilityPaths, transportBudget, affordableTransportCost, addTransportCosts, physicalTransportRoutes } from './transport-access.mjs';
app/core\rules.mjs:9:import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';
app/core\rules.mjs:10:import { CACHE_SECTION_OFFSET } from '../data/surface-grid.mjs';
app/core\rules.mjs:348:    const catalogue = world.transportRoutes ?? TRANSPORT_ROUTES;
app/core\task-alternatives.mjs:1:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/web\completed-view.mjs:1:import { createCompletedModel, filterCompletedRows, groupCompletedRows } from './completed-model.mjs';
app/web\completed-view.mjs:2:import { completedRangeOptions, selectCompletedRange } from './completed-range.mjs';
app/web\completed-view.mjs:3:import { createCompletedRangePreference } from './completed-range-preference.mjs';
app/web\completed-view.mjs:4:import { completedReviewList, createCompletedReviewCopy } from './copy-lists.mjs';
app/core\state.mjs:1:import { validateSavedXpChoices, validateXpChoices } from './xp-choices.mjs';
app/core\state.mjs:2:import { createTaskFactsIndex } from './progress-index.mjs';
app/core\state.mjs:3:import { createRuleRegistry, evaluateRollPool, sampleRoll } from './rules.mjs';
app/core\state.mjs:4:import { validateProgressSnapshots } from './progress-snapshots.mjs';
app/core\state.mjs:5:import { preferenceDefinitions, validatePreference } from './preferences.mjs';
app/core\state.mjs:6:import { validateControlSkill, validateControlLevel, validateSlayerLock } from './player-controls.mjs';
app/core\state.mjs:7:import { defaultRuneScapeNames, validateRuneScapeName, sameRuneScapeName, validateRuneMetricsTimestamp,
app/core\state.mjs:9:import { applyChunkColourCommand, validateChunkColour, validateChunkColourName } from './chunk-colours.mjs';
app/core\state.mjs:10:import { validateSticker, validateStickerId, validateSavedStickers, normalizeStickerList, resolveMemberStickers, MAX_STICKERS_PER_CHUNK } from './map-markers.mjs';
app/core\state.mjs:11:import { validateTransportFacts } from './transport-access.mjs';
app/core\state.mjs:12:import { transportRouteById } from '../data/transport-routes.mjs';
app/core\state.mjs:13:import { taskRuleValueError, taskRuleDiagnostics } from '../data/settings.mjs';
app/core\state.mjs:14:import { decodeLegacyText, resolveSavedTaskId, migrateTaskIdentities } from '../tasks/migration.mjs';
app/core\state.mjs:15:import { isPermanentId, legacyTaskId, lookupPermanentId } from '../tasks/identity.mjs';
app/core\state.mjs:16:import { normalizeMembersStartOptions, membersStartPools, rollMembersStarts } from './members-start.mjs';
app/core\state.mjs:17:import { validateFinishLine, validateFinishLineItemId, validateFinishLineOverride, validateFinishLineText,
app/core\state.mjs:19:import { groupGoalCommandKeys, groupGoalCommandTypes, applyGroupGoalCommand, validateGroupGoals,
app/core\state.mjs:1731:      if (payload.enabled === null) delete member.primaryOverrides[payload.skill];
app/tasks\area-check.mjs:1:import trainingCatalogue from '../data/training/catalogue.mjs';
app/tasks\area-check.mjs:2:import { skillCaps, f2pCap } from './engine.mjs';
app/tasks\area-check.mjs:3:import { buildTrainingAvailability } from './training-availability.mjs';
app/tasks\area-check.mjs:4:import { trainingMethodBlockers } from './training-planner.mjs';
app/tasks\area-check.mjs:5:import { divinationEvidence } from '../data/divination-training.mjs';
app/tasks\area-check.mjs:6:import { selectPresentedTasks } from './presentation.mjs';
app/tasks\area-check.mjs:172:export function analyzeAreaCheck(state, memberId, draft, { engine, definitions = {}, world, catalogue = trainingCatalogue } = {}) {
app/tasks\achievements.mjs:7:const enabled = (rules, name) => rules[name] !== undefined && ![false, 'false', 0].includes(rules[name]);
app/core\territory.mjs:1:import { surfaceLodestones } from '../data/lodestones.mjs';
app/core\territory.mjs:2:import { surfaceReachability, componentLocations, projectLegacySections, componentBlocked } from './cache-surface.mjs';
app/core\territory.mjs:3:import { isWalkingSectionEdge } from './map-boundaries.mjs';
app/core\territory.mjs:4:import { transportAccessEnabled, evaluateTransportRoutes, transportEdges, expandTransportReachability, transportBudget,
app/core\territory.mjs:6:import { automaticTransportEnabled } from './automatic-transport.mjs';
app/core\territory.mjs:15:  const catalogue = transportRoutes ?? world.transportRoutes;
app/tasks\activity.mjs:1:import { plainLabel, taskId } from './engine.mjs';
app/tasks\activity.mjs:2:import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
app/tasks\activity.mjs:3:import { passesRateCutoff } from './rates.mjs';
app/tasks\activity.mjs:4:import { achievementFamilyRequired } from './achievements.mjs';
app/tasks\activity.mjs:5:import { buildQuestReadiness, isWholeQuestTask, questGroupName } from './activity-readiness.mjs';
app/tasks\activity.mjs:114:      for (const location of list(data.Chunks)) if (!(definitions.codeItems?.chunksPlus?.[location] ?? [location]).some(value => locations.has(value))) blockers.push({ kind: 'chunks', detail: `Required location: ${definitions.chunks?.[location]?.Nickname ?? definitions.chunks?.[location]?.Name ?? location}.` });
app/tasks\access.mjs:1:import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
app/tasks\access.mjs:2:import { membershipSourceBlocker } from '../data/access-policy.mjs';
app/tasks\access.mjs:3:import { sourceMembershipBlocker as evaluateSourceMembership } from '../data/source-membership.mjs';
app/tasks\access.mjs:4:import { itemMembershipBlocker as evaluateItemMembership } from './membership.mjs';
app/tasks\access.mjs:5:import { parseDropRate, composeDropRates, passesRateCutoff, rateEvidence } from './rates.mjs';
app/tasks\access.mjs:6:import { buildWorld } from '../data/world.mjs';
app/tasks\access.mjs:7:import { applyCacheTopology } from '../data/cache-topology.mjs';
app/tasks\access.mjs:8:import { applyCacheResources } from '../data/cache-resources.mjs';
app/tasks\access.mjs:9:import { applyCacheArchaeology } from '../data/cache-archaeology.mjs';
app/tasks\access.mjs:10:import { componentLocations, createSurfaceEligibility, isCacheWorld, projectLegacySections, surfaceReachability } from '../core/cache-surface.mjs';
app/tasks\access.mjs:11:import { expandTransportReachability, evaluateTransportRoutes, transportAccessEnabled } from '../core/transport-access.mjs';
app/tasks\access.mjs:12:import { automaticTransportEnabled } from '../core/automatic-transport.mjs';
app/tasks\access.mjs:331:  for (const [id, enabled] of entries(overrides.areas)) if (enabled === false) result.blockedAreas.add(resolve(id));
app/tasks\access.mjs:405:  for (const [id, enabled] of entries(overrides.sections)) if (enabled === true) {
app/tasks\access.mjs:415:  for (const [id, enabled] of entries(overrides.areas)) if (enabled === true && nodes.has(id)) add(id);
app/tasks\access.mjs:646:        if (kind === 'Object' && resourceCatalogues.some(catalogue => catalogue.superseded.get(resolve(location))?.has(name)
app/web\copy-lists.mjs:1:import { createCopyListControl } from './copy-list-control.mjs';
app/tasks\activity-readiness.mjs:1:import { buildTrainingAvailability } from './training-availability.mjs';
app/tasks\activity-readiness.mjs:2:import { trainingMethodBlockers } from './training-planner.mjs';
app/tasks\activity-readiness.mjs:3:import { combatLevelFromSkills } from '../core/combat-level.mjs';
app/tasks\activity-readiness.mjs:4:import { skillCaps } from './engine.mjs';
app/core\woodcutting-settings.mjs:1:import { WOODCUTTING_HATCHETS } from '../training/woodcutting-rates.mjs';
app/core\xp-choices.mjs:1:import { playerControlSkills } from './player-controls.mjs';
app/core\xp-choices.mjs:2:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/core\xp-choices.mjs:60:  const catalogue = new Map(), rows = taskCatalogue instanceof Map ? [...taskCatalogue.values()] : taskCatalogue;
app/tasks\banking-plan.mjs:1:import { calculateBankingRates } from '../training/banking-rates.mjs';
app/tasks\backlog-search.mjs:1:import { resolveIdentity, lookupPermanentId } from './identity.mjs';
app/tasks\backlog-search.mjs:2:import { createTrainingSourceIndex } from './training-availability.mjs';
app/tasks\backlog-search.mjs:17:export function backlogSearchTasks({ definitions = {}, catalogue = [], dynamicCatalogue = [], registry, taskIds = [], sourceLocations }) {
app/tasks\engine.mjs:1:import { importedXpAllocations, xpChoiceAllocation } from '../core/xp-choices.mjs';
app/tasks\engine.mjs:2:import { buildAccessIndex, calculateAccess, collectBaseItemSources, baseItemSourceView, walkingConnections, copyAccess } from './access.mjs';
app/tasks\engine.mjs:3:import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts } from './migration.mjs';
app/tasks\engine.mjs:4:import { playerControlSkills, resolvePlayerControls } from '../core/player-controls.mjs';
app/tasks\engine.mjs:5:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/tasks\engine.mjs:6:import { configureAutomaticTransport, registerAutomaticTransportEngineFactory } from '../core/automatic-transport.mjs';
app/tasks\engine.mjs:7:import { taskRuleCutoffDefaults, taskRuleDiagnostics } from '../data/settings.mjs';
app/tasks\engine.mjs:8:import { parseDropRate, composeDropRates, passesRateCutoff as evaluateRateCutoff, rateEvidence } from './rates.mjs';
app/tasks\engine.mjs:9:import { evaluatePartnerConnections } from '../core/territory.mjs';
app/tasks\engine.mjs:10:import { effectiveSectionOverrides } from '../core/rules.mjs';
app/tasks\engine.mjs:11:import { createSurfaceEligibility } from '../core/cache-surface.mjs';
app/tasks\engine.mjs:12:import { permanentTaskId, legacyTaskId } from './identity.mjs';
app/tasks\engine.mjs:13:import { relaxesAchievementDependency } from './achievements.mjs';
app/tasks\engine.mjs:14:import { applyMetadataCorrections } from '../data/metadata-corrections.mjs';
app/tasks\engine.mjs:15:import { applyRetainedTaskCorrections } from '../data/retained-task-corrections.mjs';
app/tasks\engine.mjs:16:import { applyRetainedUnsupportedCorrections } from '../data/retained-unsupported-corrections.mjs';
app/tasks\engine.mjs:17:import { applyCacheShops } from '../data/cache-shops.mjs';
app/tasks\engine.mjs:18:import { applyEquipmentCorrections } from '../data/equipment-corrections.mjs';
app/tasks\engine.mjs:19:import { applyArchaeologyTaskCorrections } from '../data/archaeology-task-corrections.mjs';
app/tasks\engine.mjs:20:import { buildHouseStorageCatalogue, evaluateHouseStorage } from './house-storage.mjs';
app/tasks\engine.mjs:21:import { SKILL_GUIDE_TASKS_RULE, SKILL_GUIDE_MILESTONES_RULE, SKILL_GUIDE_CORRECTIONS_RULE, applySkillGuideTasks, skillGuideCatalogue } from '../data/skill-guides.mjs';
app/tasks\engine.mjs:22:import { applySkillguideCombatCorrections } from '../data/skillguide-combat-corrections.mjs';
app/tasks\engine.mjs:23:import { sourceMembershipBlocker as evaluateSourceMembership, sourceMembershipRequiredItems } from '../data/source-membership.mjs';
app/tasks\engine.mjs:24:import { membershipSourceBlocker, membershipSourcePolicies } from '../data/access-policy.mjs';
app/tasks\engine.mjs:25:import { itemMembershipBlocker as evaluateItemMembership, taskItemMembershipBlockers } from './membership.mjs';
app/tasks\engine.mjs:26:import { isProcessingSourceTask, processingSkills, selectProcessingSources } from './processing.mjs';
app/tasks\engine.mjs:27:import { combatLevelFromSkills } from '../core/combat-level.mjs';
app/tasks\engine.mjs:28:import { recordedEquipment } from './recorded-equipment.mjs';
app/tasks\engine.mjs:29:import { applyDivinationTraining } from '../data/divination-training.mjs';
app/tasks\engine.mjs:30:import { personalQuestProgressBlocker } from './personal-quest-progress.mjs';
app/tasks\engine.mjs:45:export const skillCaps = Object.freeze({ Attack: 120, Strength: 120, Defence: 99, Constitution: 99, Ranged: 120, Prayer: 99, Magic: 99, Runecrafting: 110, Crafting: 110, Mining: 110, Smithing: 110, Fishing: 99, Cooking: 99, Firemaking: 110, Woodcutting: 110, Fletching: 110, Dungeoneering: 120, Agility: 99, Herblore: 120, Thieving: 120, Farming: 120, Hunter: 110, Slayer: 120, Divination: 99, Construction: 120, Archaeology: 120, Summoning: 99, Invention: 120, Necromancy: 120, Combat: 152 });
app/tasks\engine.mjs:111:  const { skillGuideTasks, skillGuideMilestones, skillGuideCorrections, retainedTaskCorrections = true, retainedUnsupportedCorrections = true, divinationTraining = true, skillGuideCatalogue: catalogue = skillGuideCatalogue,
app/tasks\engine.mjs:175:  const environment = `${process.env.RS3_RESOURCE_CONTENTS ?? ''}\u0000${process.env.RS3_ARCHAEOLOGY_CONTENTS ?? ''}`;
app/tasks\engine.mjs:230:  const catalogue = Object.freeze([...compiled.map(({ id, label, category, rawLabel, level }) => Object.freeze({ id, label, category, rawLabel, level, kind: 'task', aliases: Object.freeze([legacyTaskId(category, rawLabel)]) })), ...buildHouseStorageCatalogue()]);
app/tasks\collection.mjs:1:import { decodeLegacyText, hasGameplayMigration, stableTaskId, projectMemberTaskFacts, resolveSavedTaskId } from './migration.mjs';
app/tasks\collection.mjs:2:import { parseDropRate, composeDropRates, passesRateCutoff, rateEvidence } from './rates.mjs';
app/tasks\collection.mjs:3:import { resolveTaskAlternatives } from '../core/task-alternatives.mjs';
app/tasks\collection.mjs:4:import { entityId, generatedGoalId, legacyTaskId, permanentTaskId } from './identity.mjs';
app/tasks\collection.mjs:5:import { applyCacheShops } from '../data/cache-shops.mjs';
app/tasks\collection.mjs:9:const enabled = (rules, key, fallback = false) => rules[key] === undefined ? fallback : ![false, 'false', 0].includes(rules[key]);
app/tasks\collection.mjs:107:  const tables = definitions.codeItems?.dropTables ?? {}, channels = [], catalogue = new Map(), families = new Map();
app/tasks\collection.mjs:119:  const addCatalogue = (rawLabel, objectiveKind, sourceId, itemId) => {
app/tasks\fishing-plan.mjs:1:import { FISHING_METHODS, lookupFishingRate } from '../training/fishing-rates.mjs';
app/tasks\fishing-plan.mjs:2:import catalogue from '../data/training/fishing-rates.v1.json' with { type: 'json' };
app/tasks\equipment.mjs:1:import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts } from './migration.mjs';
app/tasks\equipment.mjs:2:import { equipmentTaskIdentity, selectEquipmentRecommendations, buildEquipmentCatalogue, equipmentMembersOnly, membersEquipmentRequirement } from './presentation.mjs';
app/tasks\equipment.mjs:3:import { primaryEquipmentSource } from './rates.mjs';
app/tasks\equipment.mjs:4:import { permanentTaskId } from './identity.mjs';
app/tasks\equipment.mjs:5:import { isNonPermanentEquipment } from '../data/equipment-permanence.mjs';
app/tasks\equipment.mjs:6:import { taskItemMembershipBlockers } from './membership.mjs';
app/tasks\equipment.mjs:7:import { recordedEquipment as personalEquipmentRecords } from './recorded-equipment.mjs';
app/tasks\equipment.mjs:11:const enabled = (rules, name, fallback = true) => rules[name] === undefined ? fallback : ![false, 'false', 0].includes(rules[name]);
app/tasks\equipment.mjs:64:  const catalogue = buildEquipmentCatalogue(definitions);
app/tasks\equipment.mjs:173:  const identityCatalogue = buildEquipmentCatalogue(definitions);
app/tasks\fact-projection.mjs:32:export function projectMemberTaskFacts(state, member, catalogue = [], {
app/tasks\identity.mjs:1:import { identityRegistryVersion, authoredTasks, authoredEntities, authoredGoals, authoredSources } from '../data/identity-registry.mjs';
app/tasks\identity.mjs:31:for (const [id, category, rawLabel, oldLabels = []] of authoredTasks) {
app/tasks\identity.mjs:41:export const verifiedProgressAliases = Object.freeze([
app/tasks\identity.mjs:52:for (const [id, category, rawLabel] of verifiedProgressAliases) {
app/tasks\identity.mjs:177:export function buildIdentityIndex(catalogue = [], { savedRegistry, taskMap = {}, history, mappingIds } = {}) {
app/core\transport-access.mjs:1:import { TRANSPORT_ROUTES } from '../data/transport-routes.mjs';
app/core\transport-access.mjs:2:import { TRANSPORT_ACCESS_RULE, TRANSPORT_MASK_SHA256, TRANSPORT_RUNTIME_SHA256 } from '../data/cache-entry-policy.mjs';
app/core\transport-access.mjs:3:import { componentLocations, componentBlocked, surfaceReachability } from './cache-surface.mjs';
app/core\transport-access.mjs:4:import { isWalkingSectionEdge, sectionIsFree } from './map-boundaries.mjs';
app/core\transport-access.mjs:5:import { sameRuneScapeName } from './game-progress.mjs';
app/core\transport-access.mjs:6:import { surfaceLodestones } from '../data/lodestones.mjs';
app/core\transport-access.mjs:7:import { automaticTransportEnabled, deriveAutomaticTransport, automaticRouteFacts, automaticRouteGroup,
app/core\transport-access.mjs:145:  if (prior?.catalogue === transportRoutes && prior.facts === transportFactsByMember) return prior.rows;
app/core\transport-access.mjs:309:export function reviewedLodestoneUsable(catalogue = TRANSPORT_ROUTES, rows, stone, destination, lower = false) {
app/core\transport-access.mjs:409:  const catalogue = transportRoutes ?? TRANSPORT_ROUTES;
app/tasks\house-storage.mjs:1:import { houseStorageCatalogue, houseStorageRule } from '../data/poh-storage.mjs';
app/tasks\house-storage.mjs:2:import { legacyTaskId } from './identity.mjs';
app/tasks\house-storage.mjs:13:export function buildHouseStorageCatalogue(catalogue = houseStorageCatalogue) {
app/tasks\house-storage.mjs:30:  member, completed, challengeSatisfied }, catalogue = houseStorageCatalogue) {
app/tasks\house-storage.mjs:48:  const goals = catalogue === houseStorageCatalogue ? identities : buildHouseStorageCatalogue(catalogue);
app/tasks\map-task-locations.mjs:1:import { buildChunkPlanningIndex, baseLocationId } from './chunk-planning-index.mjs';
app/tasks\membership.mjs:1:import { pickerEntityMembership } from '../data/item-membership.mjs';
app/tasks\membership.mjs:2:import { sourceMembershipIncidentalOutput } from '../data/source-membership.mjs';
app/data\cache-npcs.mjs:1:import catalogue from './cache-npcs.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-npcs.mjs:2:import review from './npc-metadata-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-npcs.mjs:5:export function npcMetadataPayload({ data = catalogue, corrections = review.corrections } = {}) {
app/data\cache-archaeology.mjs:1:import catalogue from './cache-archaeology.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-archaeology.mjs:2:import { applyCacheResources } from './cache-resources.mjs';
app/data\cache-archaeology.mjs:6:  return typeof process !== 'undefined' && process.env?.RS3_ARCHAEOLOGY_CONTENTS === 'game-data';
app/data\cache-archaeology.mjs:10:  enabled = cacheArchaeologyContentsEnabled(), archaeologyCatalogue = catalogue,
app/tasks\migration.mjs:1:import { decodeLegacyText, hasGameplayMigration } from './gameplay-compat.mjs';
app/tasks\migration.mjs:2:import { projectMemberTaskFacts as projectFacts } from './fact-projection.mjs';
app/tasks\migration.mjs:3:import { buildIdentityIndex, legacyTaskId, permanentTaskId, isPermanentId, resolveIdentity, resolveTaskAlias, lookupPermanentId, isVerifiedProgressAlias } from './identity.mjs';
app/tasks\migration.mjs:84:  if (catalogue === undefined) return [];
app/tasks\migration.mjs:602:  const ordinaryCatalogue = catalogueArray(catalogue);
app/tasks\migration.mjs:630:export function projectMemberTaskFacts(state, member, catalogue = []) {
app/tasks\migration.mjs:639:export function migrateTaskIdentities(state, { catalogue = [], taskMap, history } = {}) {
app/tasks\migration.mjs:716:function migrateOwnedTaskIdentities(next, { catalogue = [], taskMap, history, projectCatalogueTask } = {}) {
app/data\archaeology-task-corrections.mjs:1:import bundle from './archaeology-task-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\archaeology-task-corrections.mjs:2:import { cacheArchaeologyContentsEnabled } from './cache-archaeology.mjs';
app/data\archaeology-task-corrections.mjs:7:export function applyArchaeologyTaskCorrections(definitions, { enabled = cacheArchaeologyContentsEnabled() } = {}) {
app/data\cache-topology.mjs:1:import cache from './cache-walkability.2026-10-07.v1.json' with { type: 'json' };
app/data\cache-topology.mjs:2:import policy from './cache-component-policy.2026-10-07.v1.json' with { type: 'json' };
app/data\cache-topology.mjs:3:import { cacheEntryPolicies, cacheEntryKinds, cacheNonEntryPolicies } from './cache-entry-policy.mjs';
app/data\cache-topology.mjs:4:import { surfaceLodestones } from './lodestones.mjs';
app/data\cache-topology.mjs:5:import surfaceCorrections from './cache-surface-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-topology.mjs:7:import { CACHE_SECTION_OFFSET } from './surface-grid.mjs';
app/data\cache-resources.mjs:1:import baseCatalogue from './cache-resources.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-resources.mjs:2:import baseSelectors from './cache-resource-selectors.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-resources.mjs:3:import divination from './cache-divination.2026-10-13.v1.json' with { type: 'json' };
app/data\cache-resources.mjs:5:const catalogue = { ...baseCatalogue, classes: [...baseCatalogue.classes, ...divination.classes],
app/data\cache-resources.mjs:13:  return typeof process === 'undefined' || process.env?.RS3_RESOURCE_CONTENTS !== 'retained';
app/data\cache-resources.mjs:22:  enabled = cacheResourceContentsEnabled(), resourceCatalogue = catalogue, resourceSelectors = selectors,
app/data\cache-resources.mjs:85:    const record = definitions.chunks[base] ?? (world.chunks.has(base) ? { Nickname: world.chunks.get(base).name } : null);
app/tasks\presentation.mjs:1:import { skillCaps, taskId } from './engine.mjs';
app/tasks\presentation.mjs:2:import { decodeLegacyText, hasGameplayMigration, projectMemberTaskFacts, resolveSavedTaskId } from './migration.mjs';
app/tasks\presentation.mjs:3:import { resolveTaskAlternatives } from '../core/task-alternatives.mjs';
app/tasks\presentation.mjs:4:import { primaryEquipmentSource } from './rates.mjs';
app/tasks\presentation.mjs:5:import { entityId, generatedGoalId, legacyTaskId } from './identity.mjs';
app/tasks\presentation.mjs:6:import { isNonPermanentEquipment } from '../data/equipment-permanence.mjs';
app/tasks\presentation.mjs:7:import { itemMembership } from '../data/item-membership.mjs';
app/tasks\presentation.mjs:8:import { selectProcessingSources } from './processing.mjs';
app/tasks\presentation.mjs:12:const enabled = (rules, name, fallback = true) => rules[name] === undefined ? fallback : ![false, 'false', 0].includes(rules[name]);
app/tasks\presentation.mjs:67:const emptyCatalogue = Object.freeze([]);
app/tasks\presentation.mjs:79:  const catalogue = Object.freeze(entries.map(([name, data]) => Object.freeze(equipmentTaskIdentity(name, data))));
app/tasks\presentation.mjs:350:  const catalogue = [...tasksByItem.values()];
app/tasks\process-worker-host.mjs:1:import { Worker, MessageChannel } from 'node:worker_threads';
app/tasks\process-worker-host.mjs:2:import { encodeProcessMessage, decodeProcessMessage } from './process-worker-transport.mjs';
app/data\cache-shops.mjs:1:import catalogue from './cache-shops.2026-10-08.v1.json' with { type: 'json' };
app/data\cache-shops.mjs:5:  return typeof process !== 'undefined' && process.env.RS3_CACHE_SHOP_CONTENTS === '1';
app/data\cache-shops.mjs:15:export function applyCacheShops(definitions, { enabled = cacheShopContentsEnabled(), shops = catalogue.shops, strict = false } = {}) {
app/data\cache-shops.mjs:44:  return { ...catalogue, contentsEnabled: cacheShopContentsEnabled(), switch: 'RS3_CACHE_SHOP_CONTENTS=1' };
app/data\cache-interiors.mjs:1:import catalogue from './cache-interiors.2026-10-08.v2.json' with { type: 'json' };
app/data\equipment-corrections.mjs:1:import { createHash } from 'node:crypto';
app/data\equipment-corrections.mjs:2:import evidence from './equipment-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\equipment-corrections.mjs:3:import weightEvidence from './equipment-weights.2026-10-08.v1.json' with { type: 'json' };
app/data\equipment-corrections.mjs:41:  const corrections = options.corrections ?? (custom ? [] : equipmentCorrections);
app/web\copy-list-control.mjs:1:import { formatCopyList } from './copy-list-model.mjs';
app/data\equipment-permanence.mjs:1:import dataset from './equipment-permanence.2026-10-08.v1.json' with { type: 'json' };
app/data\divination-training.mjs:1:import evidence from './divination.2026-10-13.v1.json' with { type: 'json' };
app/data\divination-training.mjs:26:  const reviewedCatalogue = definitions.challenges?.Divination?.[divinationTierLabel(evidence.tiers[0])]?.NPCs?.includes('Pale wisp')
app/web\duo-tasks.mjs:1:import { createTaskFactsIndex } from '../core/progress-index.mjs';
app/web\duo-tasks.mjs:2:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\duo-tasks.mjs:3:import { isCustomTask, customTaskForMember, customTaskDoable } from './custom-tasks-model.mjs';
app/web\duo-tasks.mjs:4:import { normalizeDuoPersonalFilter } from './duo-task-preferences.mjs';
app/web\duo-tasks.mjs:67:  const catalogue = [...trustedRows];
app/web\duo-task-lists.mjs:1:import { createTaskFactsIndex } from '../core/progress-index.mjs';
app/web\duo-task-lists.mjs:2:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\duo-task-lists.mjs:3:import { personalCustomTaskRows, isCustomTask } from './custom-tasks-model.mjs';
app/web\duo-task-lists.mjs:26:  const catalogue = sources.flatMap(source => [...(source.result.tasks ?? []), ...source.tasks]), completed = new Map(), backlog = new Map();
app/web\duo-backlog-view.mjs:1:import { backlogSearchText } from './screen-backlog.mjs';
app/web\duo-backlog-view.mjs:2:import { matchesDuoOwner, scopeDuoRow } from './duo-task-lists.mjs';
app/web\death-settings.mjs:1:import { deathSettingDefinitions, resolveDeathSettings, validateDeathSetting } from '../core/death-settings.mjs';
app/web\duo-task-view.mjs:1:import { duoCommandTarget } from './duo-tasks.mjs';
app/web\duo-task-view.mjs:2:import { appendTaskClaim } from './task-claims.mjs';
app/web\duo-task-view.mjs:3:import { isCustomTask, customTaskAssignedTo } from './custom-tasks-model.mjs';
app/web\duo-task-view.mjs:4:import { readDuoPersonalFilter, writeDuoPersonalFilter, normalizeDuoPersonalFilter } from './duo-task-preferences.mjs';
app/web\duo-task-view.mjs:11:  let ownerFilter = 'all', enabled = false;
app/web\duo-task-view.mjs:104:    setEnabled(on) { enabled = on; controlsNode.hidden = !enabled; refresh(); },
app/web\finish-line-view.mjs:1:import { buildFinishLineModel } from './finish-line-model.mjs';
app/web\finish-line-view.mjs:2:import { createFinishLineCopy } from './finish-line-copy.mjs';
app/web\finish-line-view.mjs:3:import { loadBiSMemberResult } from './bis-results.mjs';
app/web\duo-coordination.mjs:1:import { describeHistoryEvent } from './history-text.mjs';
app/web\death-chunks.mjs:1:import { resolveDeathSettings } from '../core/death-settings.mjs';
app/tasks\processing.mjs:4:const enabled = (rules, name, fallback = false) => rules[name] === undefined ? fallback : ![false, 'false', 0].includes(rules[name]);
app/tasks\recorded-equipment.mjs:1:import { equipmentTaskIdentity } from './presentation.mjs';
app/web\finish-line-model.mjs:1:import { buildProfileModel } from './profile-model.mjs';
app/web\finish-line-model.mjs:2:import { helperSkills, helperTrialCaps } from './helper-model.mjs';
app/web\finish-line-model.mjs:3:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/web\finish-line-model.mjs:4:import { entityId, generatedGoalId, legacyTaskId, permanentTaskId } from '../tasks/identity.mjs';
app/web\finish-line-model.mjs:5:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\finish-line-model.mjs:106:  const catalogue = new Map();
app/web\finish-line-model.mjs:138:    const enabled = override?.enabled !== false;
app/tasks\process-worker.mjs:1:import { fork } from 'node:child_process';
app/tasks\process-worker.mjs:2:import { EventEmitter } from 'node:events';
app/tasks\process-worker.mjs:3:import { fileURLToPath } from 'node:url';
app/tasks\process-worker.mjs:4:import { encodeProcessMessage, decodeProcessMessage } from './process-worker-transport.mjs';
app/tasks\rates.mjs:1:import { taskRuleCutoff, taskRuleCutoffDefaults } from '../data/settings.mjs';
app/web\gallery-preview.mjs:1:import { installGallerySafety } from './gallery-safety.mjs';
app/web\gallery-preview.mjs:2:import { galleryEntries } from './gallery-catalogue.mjs';
app/web\gallery-preview.mjs:126:    createRulesPanel({ ...c.panelContext, registry: () => c.registry, download: safety.download, readJSON: async () => ({ format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: {}, taskRules: {} }), jsonPreview: c.jsonPreview, historyDialog: c.historyDialog,
app/tasks\scheduler.mjs:1:import { Worker } from 'node:worker_threads';
app/tasks\scheduler.mjs:2:import { ProcessWorker } from './process-worker.mjs';
app/tasks\scheduler.mjs:3:import { createHash } from 'node:crypto';
app/tasks\scheduler.mjs:4:import { createUnlockResultCache, taskReuseInputKey } from './unlock-reuse.mjs';
app/tasks\scheduler.mjs:923:    scheduler.catalogue = ready.catalogue; scheduler.dynamicCatalogue = ready.dynamicCatalogue ?? [];
app/tasks\time-estimates.mjs:1:import helperTrainingCatalogue from '../data/training/methods.f2p.json' with { type: 'json' };
app/tasks\time-estimates.mjs:2:import deathWoodcuttingGuide from '../data/training/death-woodcutting-guide.v1.json' with { type: 'json' };
app/tasks\time-estimates.mjs:3:import { resolveDeathSettings } from '../core/death-settings.mjs';
app/tasks\time-estimates.mjs:4:import { skillCaps } from './engine.mjs';
app/tasks\time-estimates.mjs:5:import { collectionRules } from './collection.mjs';
app/tasks\time-estimates.mjs:6:import { xpForLevel, levelForXp } from '../core/experience.mjs';
app/tasks\time-estimates.mjs:11:export const trainingCatalogue = { ...helperTrainingCatalogue, methods: helperTrainingCatalogue.methods.map(method => {
app/tasks\time-estimates.mjs:121:export function estimateSkill(skill, targetLevel, result, { catalogue = trainingCatalogue, progress = {} } = {}) {
app/tasks\time-estimates.mjs:244:export function estimateChunk(state, memberId, chunkId, { prediction, baseline, catalogue = trainingCatalogue, progress = {} } = {}) {
app/web\helper-goals.mjs:1:import { skillGoals, helperTrialCaps } from './helper-model.mjs';
app/web\helper-goals.mjs:2:import { levelChart, dataTable } from './helper-charts.mjs';
app/web\gallery.mjs:1:import { galleryEntries } from './gallery-catalogue.mjs';
app/web\gallery.mjs:2:import { applyTheme, themePalettes } from './map-tools.mjs';
app/web\helper-model.mjs:1:import { xpForLevel, levelForXp } from '../core/experience.mjs';
app/web\helper-model.mjs:2:import { combatLevelFromSkills } from '../core/combat-level.mjs';
app/web\helper-model.mjs:3:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/web\helper-model.mjs:4:import { isCustomTask, customTaskAssignedTo } from './custom-tasks-model.mjs';
app/web\helper-model.mjs:13:import { helperTrialCaps } from '../core/f2p-skill-caps.mjs';
app/web\gallery-fixtures.mjs:1:import fixtureData from './gallery-fixture-data.json' with { type: 'json' };
app/web\gallery-fixtures.mjs:2:import { hydrateDisplayWorld } from '../display-world.mjs';
app/web\gallery-fixtures.mjs:3:import { createRuleRegistryFromDefinitions } from '../core/rule-registry.mjs';
app/web\helper-drops.mjs:1:import { dropChance } from './helper-model.mjs';
app/web\helper-drops.mjs:2:import { chanceChart, dataTable } from './helper-charts.mjs';
app/web\helper-progress.mjs:1:import { dataTable, progressChart } from './helper-charts.mjs';
app/web\helper-progress.mjs:2:import { progressMetrics, progressDate, progressSeries, progressRecap } from './helper-progress-model.mjs';
app/tasks\training-availability.mjs:1:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/tasks\training-availability.mjs:2:import { decodeLegacyText } from './migration.mjs';
app/tasks\training-availability.mjs:18:    const base = id.split('-')[0], label = chunk.Nickname ?? chunk.Name ?? id;
app/tasks\unlock-reuse.mjs:1:import { createHash } from 'node:crypto';
app/tasks\unlock-reuse.mjs:2:import { constants as zlibConstants, crc32, gzipSync, gunzipSync } from 'node:zlib';
app/web\helper-training.mjs:1:import { createMiningSettings, miningPickaxeLabel } from './mining-settings.mjs';
app/web\helper-training.mjs:2:import { createWoodcuttingSettings } from './woodcutting-settings.mjs';
app/web\helper-training.mjs:3:import { createBankingSettings } from './banking-settings.mjs';
app/web\helper-training.mjs:4:import { renderBankingComparison } from './banking-display.mjs';
app/web\helper-training.mjs:5:import { fishingRateText, fishingSpotAssumption, fishingExclusions, fishingSupplyLabel, fishingChanceNotes } from './fishing-display.mjs';
app/web\helper-training.mjs:126:  let disposed = false, generation = 0, catalogue = null, controller = null, miningSaving = false, woodcuttingSaving = false, bankingSaving = false;
app/web\helper-training.mjs:390:      catalogue = data;
app/data\icons.mjs:2:export const ICON_MANIFEST_PATH = `/assets/map/icons.${ICON_VERSION}.json`;
app/data\icons.mjs:7:  { kind: 'skills', version: '2026-10-08.v1', manifest: 'skill-icons.2026-10-08.v1.json' },
app/data\icons.mjs:8:  { kind: 'items', version: '2026-10-08.v1', manifest: 'item-icons.2026-10-08.v1.json' },
app/data\icons.mjs:9:  { kind: 'items', version: '2026-10-09.v1', manifest: 'item-icons.2026-10-09.v1.json' },
app/data\icons.mjs:10:  { kind: 'items', version: '2026-10-12.v1', manifest: 'item-icons.2026-10-12.v1.json' },
app/data\icons.mjs:34:    provenance.set(`${prefix}manifest.json`, bundle);
app/tasks\worker.mjs:1:import { parentPort, workerData } from 'node:worker_threads';
app/tasks\worker.mjs:2:import { createTaskEngine, taskId, plainLabel } from './engine.mjs';
app/tasks\worker.mjs:3:import { legacyTaskId } from './identity.mjs';
app/tasks\worker.mjs:4:import { applySkillGuideTasks } from '../data/skill-guides.mjs';
app/tasks\worker.mjs:5:import { prepareChunkPrediction } from '../core/planning.mjs';
app/tasks\worker.mjs:6:import { createRuleRegistry } from '../core/rules.mjs';
app/tasks\worker.mjs:7:import { configureAutomaticTransport } from '../core/automatic-transport.mjs';
app/tasks\worker.mjs:8:import { SANDBOX_FORMAT, normalizeSandboxRequest, sandboxTaskCatalogue, applySandboxChanges, sandboxDelta, compactSandboxPrediction } from '../sandbox.mjs';
app/tasks\worker.mjs:9:import { selectPresentedTasks, buildEquipmentCatalogue } from './presentation.mjs';
app/tasks\worker.mjs:10:import { evaluateEquipment, buildCurrentBiS } from './equipment.mjs';
app/tasks\worker.mjs:11:import { buildActivityInfo } from './activity.mjs';
app/tasks\worker.mjs:12:import { createCollectionEngine, selectCollectionGoals } from './collection.mjs';
app/tasks\worker.mjs:13:import { estimateChunk } from './time-estimates.mjs';
app/tasks\worker.mjs:14:import { decodeLegacyText, hasGameplayMigration } from './migration.mjs';
app/tasks\worker.mjs:15:import { applyEquipmentCorrections } from '../data/equipment-corrections.mjs';
app/tasks\worker.mjs:16:import { applyRetainedTaskCorrections } from '../data/retained-task-corrections.mjs';
app/tasks\worker.mjs:17:import { projectPlayResult, projectPlayTask } from '../play-view.mjs';
app/tasks\worker.mjs:18:import { projectDuoSidebarResult } from '../duo-play-view.mjs';
app/tasks\worker.mjs:19:import { buildChunkPlanningIndex } from './chunk-planning-index.mjs';
app/tasks\worker.mjs:20:import { projectMapTaskLocations } from './map-task-locations.mjs';
app/tasks\worker.mjs:21:import { createTaskReuseFingerprint } from './unlock-reuse.mjs';
app/tasks\worker.mjs:22:import { analyzeAreaCheck } from './area-check.mjs';
app/tasks\worker.mjs:23:import { constants as zlibConstants, crc32, gzipSync } from 'node:zlib';
app/tasks\worker.mjs:48:const generatedTaskCatalogue = Object.entries(guideDefinitions.challenges).flatMap(([category, entries]) =>
app/tasks\worker.mjs:56:const equipmentCatalogue = buildEquipmentCatalogue(definitions), equipmentNames = Object.keys(definitions.equipment ?? {});
app/tasks\worker.mjs:58:const houseStorageCatalogue = engine.catalogue.filter(row => row.kind === 'house-storage').map(({ slotId, ...identity }) => identity);
app/tasks\worker.mjs:60:const sandboxCatalogue = [...engine.catalogue, ...equipmentCatalogue, ...collectionEngine.catalogue, ...houseStorageCatalogue, ...generatedTaskCatalogue];
app/web\helper-utilities.mjs:1:import { helperSkills, helperTrialCaps, personalSkillProgress, xpLookup, combatProjection } from './helper-model.mjs';
app/web\helper-utilities.mjs:2:import { dataTable } from './helper-charts.mjs';
app/web\helper-utilities.mjs:3:import { xpForLevel } from '../core/experience.mjs';
app/tasks\training-planner.mjs:1:import trainingCatalogue from '../data/training/catalogue.mjs';
app/tasks\training-planner.mjs:2:import { personalQuestProgressBlocker } from './personal-quest-progress.mjs';
app/tasks\training-planner.mjs:3:import { xpForLevel, levelForXp } from '../core/experience.mjs';
app/tasks\training-planner.mjs:4:import { skillCaps, f2pCap } from './engine.mjs';
app/tasks\training-planner.mjs:5:import { skillGuideBreakpoints } from '../data/skill-guides.mjs';
app/tasks\training-planner.mjs:6:import { MINING_PICKAXES, MINING_PROFILES, lookupMiningRate } from '../training/mining-rates.mjs';
app/tasks\training-planner.mjs:7:import miningRateCatalogue from '../data/training/mining-rates.v1.json' with { type: 'json' };
app/tasks\training-planner.mjs:8:import { WOODCUTTING_HATCHETS, lookupWoodcuttingRate } from '../training/woodcutting-rates.mjs';
app/tasks\training-planner.mjs:9:import woodcuttingRateCatalogue from '../data/training/woodcutting-rates.v1.json' with { type: 'json' };
app/tasks\training-planner.mjs:10:import { fishingMetrics, fishingSegment, fishingOutputQuantity, canMergeFishing, mergeFishingSegment } from './fishing-plan.mjs';
app/tasks\training-planner.mjs:11:import { withGatheringBanking } from './banking-plan.mjs';
app/tasks\training-planner.mjs:12:import { bankingSettingDefinitions } from '../core/banking-settings.mjs';
app/tasks\training-planner.mjs:252:  const catalogue = availability.catalogue ?? trainingCatalogue;
app/data\interior-assets.mjs:8:    || manifestPath !== `${directory}/manifest.json` || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? '')) {
app/web\history-text.mjs:3:import { settingDefinitions, authoredSettingDefinitions, taskRuleDefinitions } from '../data/settings.mjs';
app/web\history-text.mjs:4:import { deathSettingDefinitions } from '../core/death-settings.mjs';
app/web\history-text.mjs:5:import { miningSettingDefinitions } from '../core/mining-settings.mjs';
app/web\history-text.mjs:6:import { woodcuttingSettingDefinitions } from '../core/woodcutting-settings.mjs';
app/web\history-text.mjs:7:import { bankingSettingDefinitions } from '../core/banking-settings.mjs';
app/web\history-text.mjs:8:import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';
app/web\history-text.mjs:114:    case 'set-primary-override': return `${c.enabled === null || c.enabled === undefined ? 'Reset' : c.enabled ? 'Allowed' : 'Disallowed'} primary training${c.skill ? ` for ${c.skill}` : ''}${forWho}`;
app/data\item-membership-aliases.mjs:1:import catalogue from './item-membership-aliases.2026-10-08.v1.json' with { type: 'json' };
app/data\item-membership-aliases.mjs:2:import { normalizeItemMembershipName } from './item-membership-index.mjs';
app/data\item-membership-aliases.mjs:4:export const itemMembershipAliasCatalogue = catalogue;
app/data\item-membership-flags.mjs:1:import catalogue from './item-membership-flags.2026-10-08.v1.json' with { type: 'json' };
app/web\icons.mjs:1:import { categoryPlaceholder, getArtStatus, placeholderPicture, resolvePicture, pictureAvailable } from './art-status.mjs';
app/web\icons.mjs:2:const manifestPath = '/assets/map/icons.2026-10-12.v1.json';
app/web\icons.mjs:16:        const manifest = await response.json();
app/data\item-membership-index.mjs:1:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/web\info-panels.mjs:1:import { sourceRateText } from '../tasks/rates.mjs';
app/web\info-panels.mjs:2:import { createRuneMetricsControls } from './runemetrics.mjs';
app/web\info-panels.mjs:3:import { taskItemIcon } from './task-artwork.mjs';
app/web\info-panels.mjs:4:import { taskIcon } from './browser-task-icons.mjs';
app/web\info-panels.mjs:5:import { resolvePicture } from './art-status.mjs';
app/web\info-panels.mjs:6:import { filteredActivityTab } from './activity-view.mjs';
app/web\info-panels.mjs:7:import { readBiSPreferences, writeBiSPreferences } from './bis-preferences.mjs';
app/web\info-panels.mjs:8:import { createEquipmentRecorder, createHandRecordActions } from './bis-recorded.mjs';
app/web\info-panels.mjs:9:import { createBiSComparisonView } from './bis-comparison-view.mjs';
app/web\info-panels.mjs:177:    const node = el('div', undefined, 'form-stack'), controls = result.playerControls, lock = controls.slayerLock, enabled = el('input');
app/data\item-membership-review.mjs:1:import catalogue from './item-membership-review.2026-10-12.v1.json' with { type: 'json' };
app/data\item-membership-review.mjs:2:import { normalizeItemMembershipName } from './item-membership-index.mjs';
app/data\item-membership-review.mjs:4:export const itemMembershipReviewCatalogue = catalogue;
app/data\item-membership-review.mjs:7:export function itemMembershipReview(name, { catalogue = itemMembershipReviewCatalogue, physical = false } = {}) {
app/data\item-membership.mjs:1:import catalogue from './item-membership.2026-10-08.v1.json' with { type: 'json' };
app/data\item-membership.mjs:2:import { createItemMembershipLookup } from './item-membership-index.mjs';
app/data\item-membership.mjs:3:import { itemMembershipAlias,itemMembershipAliasCatalogue } from './item-membership-aliases.mjs';
app/data\item-membership.mjs:4:import entities from './picker-entities.2026-10-08.v1.json' with { type: 'json' };
app/data\item-membership.mjs:5:import { normalizeItemMembershipName } from './item-membership-index.mjs';
app/data\item-membership.mjs:6:import { itemMembershipReview,itemMembershipReviewCatalogue } from './item-membership-review.mjs';
app/data\item-membership.mjs:11:export const itemMembershipCatalogue = catalogue;
app/data\item-membership.mjs:12:export const pickerEntityMembershipCatalogue = entities;
app/data\item-membership.mjs:16:export function itemMembership(name, { catalogue = itemMembershipCatalogue,
app/data\item-membership.mjs:17:  aliases = catalogue === itemMembershipCatalogue ? itemMembershipAliasCatalogue : null,
app/data\item-membership.mjs:18:  reviews = catalogue === itemMembershipCatalogue ? itemMembershipReviewCatalogue : null } = {}) {
app/web\invites.mjs:1:import { createPrivateLink } from './stream-safe.mjs';
app/web\kept-rules.mjs:1:import { taskRuleBehavior } from '../data/settings.mjs';
app/web\interior-view.mjs:3:import { resolvePicture, recordPictureFailure } from './art-status.mjs';
app/web\interior-view.mjs:11:  // the surface grid. Nickname identifies ordinary surface records.
app/web\main.mjs:1:import { createScreenContext } from './screen-context.mjs';
app/web\main.mjs:2:import { createScreenUi } from './screen-ui.mjs';
app/web\main.mjs:3:import { createScreenSettings } from './screen-settings.mjs';
app/web\main.mjs:4:import { createScreenCommands } from './screen-commands.mjs';
app/web\main.mjs:5:import { createScreenRoll } from './screen-roll.mjs';
app/web\main.mjs:6:import { createScreenMap } from './screen-map.mjs';
app/web\main.mjs:7:import { createScreenLoading } from './screen-loading.mjs';
app/web\main.mjs:8:import { createScreenTasks } from './screen-tasks.mjs';
app/web\main.mjs:9:import { createGroupGoals } from './group-goals.mjs';
app/web\main.mjs:10:import { createScreenTaskDialogs } from './screen-task-dialogs.mjs';
app/web\main.mjs:11:import { createScreenChunks } from './screen-chunks.mjs';
app/web\main.mjs:12:import { createScreenDialogs } from './screen-dialogs.mjs';
app/web\main.mjs:13:import { createScreenHistory } from './screen-history.mjs';
app/web\main.mjs:14:import { createScreenRollStats } from './screen-roll-stats.mjs';
app/web\main.mjs:15:import { createScreenCustomTasks } from './screen-custom-tasks.mjs';
app/web\main.mjs:16:import { createScreenLive } from './screen-live.mjs';
app/web\main.mjs:17:import { createScreenControls } from './screen-controls.mjs';
app/web\main.mjs:18:import { createScreenStartup } from './screen-startup.mjs';
app/web\main.mjs:19:import { createScreenPanels } from './screen-panels.mjs';
app/web\main.mjs:20:import { createScreenPoolRanking } from './pool-ranking.mjs';
app/web\main.mjs:21:import { createScreenCapture } from './screen-capture.mjs';
app/web\main.mjs:22:import { createScreenJournal } from './screen-journal.mjs';
app/web\main.mjs:23:import { createProfileView } from './profile-view.mjs';
app/web\main.mjs:24:import { createFinishLineView } from './finish-line-view.mjs';
app/web\main.mjs:25:import { createPartnerSupplyView } from './partner-supply-view.mjs';
app/web\main.mjs:26:import { createScreenAreaCheck } from './area-check.mjs';
app/web\main.mjs:27:import { createScreenPhoneLayout } from './screen-phone-layout.mjs';
app/web\main.mjs:28:import { createXpChoices } from './lamp-choices.mjs';
app/web\main.mjs:29:import { createScreenUsage } from './screen-usage.mjs';
app/data\map-connections.mjs:1:import catalogue from './map-connections.2026-10-09.v1.json' with { type: 'json' };
app/web\map-activity-layer-model.mjs:1:import { membershipSourceBlocker } from '../data/access-policy.mjs';
app/web\map-activity-layer-model.mjs:2:import { decodeLegacyText } from '../tasks/gameplay-compat.mjs';
app/data\map-corrections.mjs:4:const retained = 'https://github.com/source-chunk/chunk-picker-rs3/blob/98a3bdc5e0992616ca52c8d2429e7ef2f4fdd8f0/rs3-chunkpicker-chunkinfo-export.json';
app/data\map-corrections.mjs:52:  correction('13883', 'record', null, { Nickname: 'Daemonheim North Coast' }, wiki('Daemonheim'),
app/web\custom-tasks-model.mjs:1:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/web\map-activity-layers.mjs:1:import { buildMapActivityLayers } from './map-activity-layer-model.mjs';
app/web\map-activity-layers.mjs:20:  const enabled = () => preferences.clueTier !== 'off' || preferences.showSlayer;
app/web\map-capture.mjs:1:import { SURFACE_GRID } from '../data/surface-grid.mjs';
app/web\map-capture.mjs:2:import { MapTerrain } from './map-terrain.mjs';
app/web\map-capture.mjs:3:import { MapPinRenderer } from './map-pin-renderer.mjs';
app/web\map-capture.mjs:4:import { loadStickerFont } from './map-tools.mjs';
app/data\map-pin-details.mjs:1:import { readFileSync } from 'node:fs';
app/data\map-pin-details.mjs:3:export const MAP_PIN_DETAILS_PATH = 'map-pin-details.2026-10-08.v2.json';
app/data\map-pin-details.mjs:4:export const MAP_PIN_DETAILS = JSON.parse(readFileSync(new URL(`./${MAP_PIN_DETAILS_PATH}`, import.meta.url), 'utf8'));
app/web\map-chunk-colours.mjs:1:import { CHUNK_COLOURS, LEGACY_CHUNK_COLOURS } from '../core/chunk-colours.mjs';
app/web\map-chunk-colours.mjs:2:import { readableColor, themePalettes } from './map-tools.mjs';
app/data\map-pins.mjs:1:import { SURFACE_GRID } from './surface-grid.mjs';
app/data\map-pins.mjs:2:import { categoryForSprite, categoryForCachePin, MAP_PIN_CATEGORIES } from './map-pin-categories.mjs';
app/data\map-pins.mjs:5:export const CACHE_PIN_PATH = `pins.${CACHE_PIN_BUNDLE}.json`;
app/data\map-pins.mjs:6:export const CACHE_PIN_MANIFEST_PATH = `manifest.${CACHE_PIN_BUNDLE}.json`;
app/data\map-pins.mjs:124:    const source = { url: `https://raw.githubusercontent.com/mejrs/data_rs3/${PIN_COMMIT}/original_sprite_locations.json`, commit: PIN_COMMIT,
app/data\identity-registry.mjs:4:export const authoredTasks = [
app/data\metadata-corrections.mjs:1:import evidence from './metadata-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\metadata-corrections.mjs:34:export function applyMetadataCorrections(definitions, { corrections = metadataCorrections, strict = false } = {}) {
app/data\original-data.mjs:1:import { readFile } from 'node:fs/promises';
app/data\original-data.mjs:2:import path from 'node:path';
app/data\original-data.mjs:3:import { fileURLToPath } from 'node:url';
app/data\original-data.mjs:4:import selection from './original-data.2026-10-13.v1.json' with { type: 'json' };
app/data\original-data.mjs:5:import { sha256RepositoryText } from '../../scripts/lib/provenance-hash.mjs';
app/data\original-data.mjs:18:    const bytes = await readFile(target);
app/data\poh-storage.mjs:1:import evidence from './poh-storage.2026-10-08.v1.json' with { type: 'json' };
app/data\poh-storage.mjs:9:export const houseStorageCatalogue = freeze(evidence);
app/web\map-info.mjs:1:import { gameToWorld } from '../data/map-pins.mjs';
app/web\map-info.mjs:61:    const data = await response.json();
app/data\retained-task-corrections.mjs:1:import { createHash } from 'node:crypto';
app/data\retained-task-corrections.mjs:2:import evidence from './retained-task-corrections.2026-10-09.v1.json' with { type: 'json' };
app/data\retained-task-corrections.mjs:3:import entryEvidence from './retained-entry-corrections.2026-10-12.v2.json' with { type: 'json' };
app/data\retained-task-corrections.mjs:4:import wordingEvidence from './retained-wording-corrections.2026-10-12.v1.json' with { type: 'json' };
app/data\retained-task-corrections.mjs:17:export function applyRetainedTaskCorrections(definitions, { corrections = reviewedCorrections, strict = false } = {}) {
app/web\map-pins.mjs:1:import { MAP_PIN_LEGEND_GROUPS } from '../data/map-pin-categories.mjs';
app/web\map-pins.mjs:2:import { CACHE_PIN_PATH, CACHE_PIN_MANIFEST_PATH, normalizeCachePins } from '../data/map-pins.mjs';
app/web\map-pins.mjs:3:import { createTravelLinesControl } from './map-info.mjs';
app/web\map-pins.mjs:4:import { placeholderPicture, resolvePicture } from './art-status.mjs';
app/web\map-pins.mjs:80:      Promise.resolve().then(() => fetcher('/assets/map/terrain.optimized-manifest.json', { signal: controller.signal }))
app/web\map-pins.mjs:81:        .then(response => response.ok ? response.json() : null).catch(() => null),
app/web\map-pins.mjs:84:    const response = await fetcher('/assets/map/manifest.json');
app/web\map-pins.mjs:86:    const manifest = await response.json();
app/web\map-pins.mjs:101:      const dataset = await cacheResponse.json();
app/web\map-pins.mjs:103:      return normalizeCachePins(dataset, await provenanceResponse.json(), manifest);
app/web\map-pins.mjs:111:    const dataset = await pinResponse.json();
app/data\retained-unsupported-corrections.mjs:1:import { createHash } from 'node:crypto';
app/data\retained-unsupported-corrections.mjs:2:import evidence from './retained-unsupported-corrections.2026-10-13.v1.json' with { type: 'json' };
app/data\retained-unsupported-corrections.mjs:13:export function applyRetainedUnsupportedCorrections(definitions, { corrections = evidence.corrections, strict = false } = {}) {
app/web\map-place-labels.mjs:1:import { RectangleIndex } from './map-task-count-renderer.mjs';
app/web\map-place-labels.mjs:2:import { taskCountAnnotationCells, taskCountObstacles } from './map-task-count-obstacles.mjs';
app/web\map-place-labels.mjs:3:import { themePalettes } from './map-tools.mjs';
app/web\map-place-labels.mjs:5:export const PLACE_LABEL_DATA = '/data/place-labels.2026-10-13.v1.json';
app/web\map-place-labels.mjs:216:      return response.json();
app/data\skill-guides.mjs:1:import evidence from './skill-guides.2026-10-08.v1.json' with { type: 'json' };
app/data\skill-guides.mjs:4:export const skillGuideCatalogue = evidence;
app/data\skill-guides.mjs:12:export function applySkillGuideTasks(definitions, { catalogue = skillGuideCatalogue, includeInformationalMilestones = true } = {}) {
app/data\skill-guides.mjs:52:export function skillGuideBreakpoints(skill, { catalogue = skillGuideCatalogue, members = false } = {}) {
app/data\skillguide-combat-corrections.mjs:1:import { createHash } from 'node:crypto';
app/data\skillguide-combat-corrections.mjs:2:import evidence from './skillguide-combat-corrections.2026-10-08.v1.json' with { type: 'json' };
app/data\skillguide-combat-corrections.mjs:9:export function applySkillguideCombatCorrections(definitions, { corrections = skillguideCombatCorrections, strict = false } = {}) {
app/web\map-task-counts.mjs:1:import { selectDuoTasks } from './duo-tasks.mjs';
app/web\map-terrain.mjs:1:import { SURFACE_GRID, surfaceCoordinates } from '../data/surface-grid.mjs';
app/data\source-membership.mjs:1:import catalogue from './source-membership.2026-10-08.v1.json' with { type: 'json' };
app/data\source-membership.mjs:2:import rowCatalogue from './source-row-membership.2026-10-08.v1.json' with { type: 'json' };
app/data\source-membership.mjs:3:import methodRequirements from './source-method-requirements.2026-10-08.v1.json' with { type: 'json' };
app/data\source-membership.mjs:4:import incidentalOutputs from './source-incidental-outputs.2026-10-08.v1.json' with { type: 'json' };
app/data\source-membership.mjs:5:import monsterReview from './monster-membership-review.2026-10-12.v1.json' with { type: 'json' };
app/data\source-membership.mjs:6:import itemReview from './item-membership-review.2026-10-12.v1.json' with { type: 'json' };
app/data\source-membership.mjs:8:export const sourceMembershipCatalogue = catalogue;
app/data\source-membership.mjs:9:export const monsterMembershipReviewCatalogue = monsterReview;
app/web\map-tools.mjs:1:import { stickerDefinitions, resolveMemberStickers, resolveStartingChunk, MAX_STICKERS_PER_CHUNK } from '../core/map-markers.mjs';
app/data\terrain-assets.mjs:1:import { SURFACE_GRID } from './surface-grid.mjs';
app/data\terrain-assets.mjs:3:export const TERRAIN_MANIFEST_PATH = '/assets/map/terrain.optimized-manifest.json';
app/data\terrain-assets.mjs:9:  manifestPath: 'terrain.optimized-2026-10-08-38129fc98c5adcd7/manifest.json',
app/data\terrain-assets.mjs:23:    || descriptor.manifestPath !== `${descriptor.directory}/manifest.json` || !hash(descriptor.manifestSha256)) {
app/web\map.mjs:1:import { SURFACE_GRID, surfaceCoordinates } from '../data/surface-grid.mjs';
app/web\map.mjs:2:import { resolveMemberStickers, resolveStartingChunk } from '../core/map-markers.mjs';
app/web\map.mjs:3:import { resolveMemberChunkColours, resolveMemberChunkColourNames } from '../core/chunk-colours.mjs';
app/web\map.mjs:4:import { chunkColourStyles, chunkColourPaint, createChunkColourLayer, drawChunkColourLayer, createChunkColourOverview, drawChunkColourOverview, releaseChunkColourOverview, drawChunkColours } from './map-chunk-colours.mjs';
app/web\map.mjs:5:import { worldPartnerConnections } from '../data/world-connections.mjs';
app/web\map.mjs:6:import { stickerAsset, stickerGlyph, stickerFont, stickerLabel, loadStickerFont, themePalettes } from './map-tools.mjs';
app/web\map.mjs:7:import { MapTerrain } from './map-terrain.mjs';
app/web\map.mjs:8:import { resolvePicture, recordPictureFailure, getArtStatus } from './art-status.mjs';
app/web\map.mjs:9:import { MapPinRenderer } from './map-pin-renderer.mjs';
app/web\map.mjs:10:import { drawMapConnections, mapConnectionsForChunk, readTravelLines, writeTravelLines } from './map-info.mjs';
app/web\map.mjs:11:import { sectionBoundarySegments } from './chunk-sections.mjs';
app/web\map.mjs:12:import { MapSearchLayer } from './map-search-layer.mjs';
app/web\map.mjs:13:import { MapTaskCountRenderer } from './map-task-count-renderer.mjs';
app/web\map.mjs:14:import { taskCountAnnotationCells, taskCountObstacles } from './map-task-count-obstacles.mjs';
app/web\map.mjs:15:import { MapPlaceLabels } from './map-place-labels.mjs';
app/web\map.mjs:16:import { MapActivityLayerRenderer } from './map-activity-layer-renderer.mjs';
app/web\map.mjs:17:import { createChunkLongPress, PHONE_MEDIA_QUERY } from './chunk-long-press.mjs';
app/web\members-start.mjs:1:import { normalizeMembersStartOptions, membersStartPools } from '../core/members-start.mjs';
app/web\mining-settings.mjs:1:import { MINING_PICKAXES, MINING_PROFILES } from '../training/mining-rates.mjs';
app/web\mining-settings.mjs:2:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/data\transport-routes.mjs:1:import catalogue from './transport-routes.2026-10-09.v2.json' with { type: 'json' };
app/data\training\banking-destinations.mjs:1:import review from '../members-start-banks.2026-10-12.v1.json' with { type: 'json' };
app/data\training\banking-destinations.mjs:10:  review: 'app/data/members-start-banks.2026-10-12.v1.json',
app/data\world.mjs:1:import { SURFACE_GRID, surfaceCoordinates } from './surface-grid.mjs';
app/data\world.mjs:3:import { registerWorldConnectionResolver } from './world-connections.mjs';
app/data\world.mjs:4:import { partnerConnections } from '../core/rules.mjs';
app/data\world.mjs:5:import { applyMapCorrections } from './map-corrections.mjs';
app/data\world.mjs:6:import { applyCacheTopology, cacheSurfaceRegions, cacheRegionNames } from './cache-topology.mjs';
app/data\world.mjs:7:import { applyCacheResources, cacheResourceContentsEnabled } from './cache-resources.mjs';
app/data\world.mjs:8:import { applyCacheArchaeology, cacheArchaeologyContentsEnabled } from './cache-archaeology.mjs';
app/data\world.mjs:11:export function buildWorld(definitions, { cacheWalking = Object.keys(definitions?.chunks ?? {}).length > 2000
app/data\world.mjs:12:  && definitions?.chunks?.['11825']?.Nickname === 'Port Sarim Church'
app/data\world.mjs:13:  && definitions?.chunks?.['11569']?.Nickname === 'Musa Point',
app/data\world.mjs:34:    const label = record.Nickname ?? record.Name;
app/web\original-sync.mjs:1:import { taskRuleDefinitions } from '../data/settings.mjs';
app/web\original-sync.mjs:2:import { rulesCatalogue } from './rules-model.mjs';
app/data\training\catalogue.mjs:1:import f2p from './methods.f2p.json' with { type: 'json' };
app/data\training\catalogue.mjs:2:import { divinationEvidence as evidence, divinationTierLabel, divinationTierSelectors } from '../divination-training.mjs';
app/data\training\catalogue.mjs:33:export const trainingCatalogue = { ...f2p, version: `${f2p.version}+${evidence.version}`,
app/web\partner-supply-model.mjs:1:import { createTaskFactsIndex } from '../core/progress-index.mjs';
app/web\partner-supply-model.mjs:2:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\partner-supply-model.mjs:23:  const catalogue = state.members.flatMap(member => current.get(member.id)?.tasks ?? []);
app/web\partner-supply-view.mjs:1:import { buildPartnerSupplyModel, formatPartnerSupplySummary } from './partner-supply-model.mjs';
app/web\map-pin-renderer.mjs:1:import { pinMatchesSearch, normalizePinSearch } from './map-pins.mjs';
app/web\map-pin-renderer.mjs:2:import { CACHE_PIN_SPRITE_DIRECTORY } from '../data/map-pins.mjs';
app/web\map-pin-renderer.mjs:3:import { indexPinDetails } from './map-info.mjs';
app/web\map-pin-renderer.mjs:4:import { resolvePicture, recordPictureFailure } from './art-status.mjs';
app/web\map-pin-renderer.mjs:53:    this.enabled = new Set(this.filters.categoryIds);
app/web\profile-model.mjs:1:import { playerControlSkills } from '../core/player-controls.mjs';
app/web\profile-model.mjs:2:import { combatLevelFromSkills } from '../core/combat-level.mjs';
app/web\profile-model.mjs:3:import { sameRuneScapeName } from '../core/game-progress.mjs';
app/web\profile-model.mjs:4:import { permanentTaskId } from '../tasks/identity.mjs';
app/web\profile-model.mjs:5:import { projectMemberTaskFacts, resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\profile-model.mjs:6:import { helperTrialCaps } from './helper-model.mjs';
app/web\profile-model.mjs:7:import { buildBiSComparison } from './bis-compare.mjs';
app/web\profile-model.mjs:12:const enabled = value => ![false, 'false', 0].includes(value);
app/web\profile-model.mjs:74:  const catalogue = new Map();
app/web\profile-view.mjs:1:import { buildProfileModel } from './profile-model.mjs';
app/web\profile-view.mjs:2:import { createProfileCopy } from './profile-copy.mjs';
app/web\profile-view.mjs:3:import { loadBiSMemberResult } from './bis-results.mjs';
app/web\profile-view.mjs:4:import { createInfoPanels } from './info-panels.mjs';
app/web\profile-view.mjs:5:import { loadIcons, skillIcon, itemIcon } from './icons.mjs';
app/web\profile-view.mjs:6:import { taskItemIcon } from './task-artwork.mjs';
app/web\rules-model.mjs:1:import capturedCatalogue from '../data/original-rules-ui.2026-10-08.v1.json' with { type: 'json' };
app/web\rules-model.mjs:2:import { taskRuleDefinitions, taskRuleCutoffDefaults } from '../data/settings.mjs';
app/web\rules-model.mjs:3:import { hasGameplayMigration } from '../tasks/gameplay-compat.mjs';
app/web\rules-model.mjs:4:import { isKeptTaskRule } from './kept-rules.mjs';
app/web\rules-model.mjs:42:export const rulesCatalogue = loadRulesCatalogue(capturedCatalogue);
app/web\rules-model.mjs:132:export function planTaskRuleChange(state, memberIds, definition, value, catalogue = rulesCatalogue) {
app/web\rules-model.mjs:151:export function reviewPreset(state, memberIds, preset, catalogue = rulesCatalogue) {
app/web\quest-map.mjs:1:import { questMapLocations } from './quest-map-model.mjs';
app/web\overlay-client.mjs:111:        const data = await response.json();
app/web\rules-panel.mjs:1:import { taskRuleBehavior } from '../data/settings.mjs';
app/web\rules-panel.mjs:2:import { rulesCatalogue, buildRulesSections, taskRuleValue, ruleEnabled, filterRulesSections, planTaskRuleChange, reviewPreset, profileCommands } from './rules-model.mjs';
app/web\rules-panel.mjs:3:import { visibleRulesSections } from './kept-rules.mjs';
app/web\rules-panel.mjs:189:      ctx.download({ format: 'rs3-chunk-rule-profile', schemaVersion: 1, rules: ctx.state().rules, taskRules: ctx.state().members.find(member => member.id === id).taskRules ?? {} }, 'rs3-rule-profile.json');
app/web\rules-panel.mjs:191:    const file = input('file'); file.accept = '.json,application/json';
app/web\rules-panel.mjs:200:        const previewGeneration = ctx.openDialog('Apply rule profile', ...(advanced(ctx) ? [ctx.jsonPreview(response)] : [el('p', `Apply this profile to ${ctx.state().members.find(member => member.id === id).name}? It will replace their saved rules. Undo is available in History.`)]), button('Apply profile', async () => {
app/web\sandbox-rules.mjs:1:import { taskRuleDefinitions, taskRuleCutoffDefaults, taskRuleValueError } from '../data/settings.mjs';
app/web\sandbox-rules.mjs:2:import { taskRuleValue } from './rules-model.mjs';
app/web\screen-capture.mjs:1:import { MAX_MAP_IMAGE_SIDE, renderMapImage } from './map-capture.mjs';
app/web\screen-chunk-notes.mjs:1:import { createNoteEditor } from './info-panels.mjs';
app/web\screen-chunks.mjs:1:import { interiorCandidates, interiorPanel } from './interior-view.mjs';
app/web\screen-chunks.mjs:2:import { bindStickerFlyout } from './sticker-picker.mjs';
app/web\screen-chunks.mjs:3:import { createScreenChunkNotes } from './screen-chunk-notes.mjs';
app/web\screen-chunks.mjs:4:import { createScreenChunkColours } from './chunk-colour-picker.mjs';
app/web\screen-chunks.mjs:5:import { createChunkSections } from './chunk-sections.mjs';
app/web\screen-chunks.mjs:6:import { CACHE_SECTION_OFFSET } from './data/surface-grid.mjs';
app/web\screen-chunks.mjs:7:import { itemIcon } from './icons.mjs';
app/web\screen-chunks.mjs:8:import { createChunkQuestList } from './chunk-quest-filters.mjs';
app/web\screen-chunks.mjs:91:      ?? (indexed?.terrainOnly ? { Nickname: indexed.name } : undefined); if (!record || !indexed) { c.syncPredictionIntents(); return; }
app/web\screen-chunks.mjs:265:      if (value.delta.itemsAdded?.length || value.delta.areasAdded?.length) { const additions = c.el('div'); if (value.delta.itemsAdded?.length) additions.append(c.el('h4', 'Items'), c.list(value.delta.itemsAdded.map(item => c.plain(typeof item === 'string' ? item : item.name ?? item.label)))); if (value.delta.areasAdded?.length) additions.append(c.el('h4', 'Areas'), c.list(value.delta.areasAdded.map(area => c.plain(c.world.areas.get(typeof area === 'string' ? area : area.id)?.name ?? (typeof area === 'string' ? area : area.name ?? area.label))))); if (c.advanced()) additions.append(c.jsonPreview({ items: value.delta.itemsAdded, areas: value.delta.areasAdded })); outcome.append(c.details('New items and areas', additions)); }
app/web\screen-chunks.mjs:292:      if (['Name', 'Nickname', 'ObjectProvenance'].includes(key)) continue;
app/web\screen-commands.mjs:1:import { mergeCommandState, projectChunkState } from './command-state.mjs';
app/web\screen-commands.mjs:2:import { reviewedNoteRevision } from './info-panels.mjs';
app/web\screen-commands.mjs:3:import { groupGoalCommandTypes } from '../core/group-goal-types.mjs';
app/web\screen-commands.mjs:18:    const value = await response.json();
app/web\screen-controls.mjs:1:import { applyTheme } from './map-tools.mjs';
app/web\screen-custom-tasks.mjs:1:import { playerControlSkills, validateControlLevel } from '../core/player-controls.mjs';
app/web\screen-custom-tasks.mjs:2:import { isCustomTask } from './custom-tasks-model.mjs';
app/web\screen-dialogs.mjs:1:import { openSandboxRules } from './sandbox-rules.mjs';
app/web\screen-dialogs.mjs:2:import { openTeleportsDialog } from './teleports.mjs';
app/web\screen-dialogs.mjs:3:import { backupSaveLabel } from './backup-status.mjs';
app/web\screen-dialogs.mjs:4:import { createSearchDialog } from './screen-search.mjs';
app/web\screen-dialogs.mjs:5:import { createBackupUpload, downloadFullBackup } from './backup-transfer.mjs';
app/web\screen-dialogs.mjs:101:    const content = c.el('div', undefined, 'form-stack'); content.append(c.el('p', 'Full backups include both maps, progress, rules, notes, teleport confirmations, original imported records and history. Every replacement retains the previous state on the server.', 'section-intro'), c.button('Download full backup', async () => downloadFullBackup(`rs3-duo-${new Date().toISOString().slice(0, 10)}.json.gz`)));
app/web\screen-dialogs.mjs:103:    const file = c.input('file'); file.accept = '.json,.json.gz,application/json,application/gzip'; const preview = c.el('div');
app/web\screen-dialogs.mjs:147:    content.append(c.field('Choose a full backup or an exported copy of both maps', file), c.el('p', 'Choose .json or .json.gz. Backups download compressed. Limit: 256 MiB after decompression.', 'status-detail'), previewButton, preview, retained, ...(c.advanced() ? [c.button('View migration report', async () => { const generation = c.beginDialogRequest(), value = await c.api('/api/migration'); if (c.dialogCurrent(generation)) c.openDialog('Migration report', c.lazyJSON('Imported names and unmatched records', value)); })] : [])); c.openDialog('Backup & Import', content);
app/web\screen-dialogs.mjs:163:      if (c.advanced()) content.append(link('Local map source data', '/assets/map/manifest.json'));
app/web\screen-history.mjs:1:import { describeHistoryEvent, historyChangeTypes, historyChangeType } from './history-text.mjs';
app/web\screen-history.mjs:57:          loaded = true; body.replaceChildren(c.jsonPreview(value.event));
app/web\screen-journal.mjs:1:import { createNoteEditor } from './info-panels.mjs';
app/web\screen-loading.mjs:97:        const response = await fetch(path, { signal: controller.signal }), value = await response.json();
app/web\screen-map.mjs:1:import { projectChunkState } from './command-state.mjs';
app/web\screen-map.mjs:2:import { chunkColourLegend } from './chunk-colour-picker.mjs';
app/web\screen-map.mjs:3:import { createTravelLinesKey } from './map-info.mjs';
app/web\screen-map.mjs:4:import { createMapTaskCounts } from './map-task-counts.mjs';
app/web\screen-map.mjs:5:import { createMapActivityLayers } from './map-activity-layers.mjs';
app/web\screen-phone-layout.mjs:1:import { createPhoneLayout, PHONE_QUERY } from './phone-layout.mjs';
app/web\screen-panels.mjs:1:import { skillIcon, itemIcon } from './icons.mjs';
app/web\screen-panels.mjs:2:import { createSettingsPanel } from './settings-panel.mjs';
app/web\screen-panels.mjs:3:import { createMembersStart } from './members-start.mjs';
app/web\screen-panels.mjs:4:import { createInfoPanels } from './info-panels.mjs';
app/web\screen-panels.mjs:5:import { createMapTools } from './map-tools.mjs';
app/web\screen-panels.mjs:6:import { createChunkPlanning } from './chunk-planning.mjs';
app/web\screen-panels.mjs:7:import { createRulesPanel } from './rules-panel.mjs';
app/web\screen-panels.mjs:8:import { createCompletedView } from './completed-view.mjs';
app/web\screen-panels.mjs:9:import { createStickerPicker } from './sticker-picker.mjs';
app/web\screen-panels.mjs:10:import { createOriginalSync } from './original-sync.mjs';
app/web\screen-panels.mjs:11:import { createDeathChunks } from './death-chunks.mjs';
app/web\screen-panels.mjs:12:import { createSandbox } from './sandbox.mjs';
app/web\screen-panels.mjs:13:import { createHelperView } from './helper.mjs';
app/web\screen-panels.mjs:14:import { createMapDisplay } from './map-display.mjs';
app/web\screen-panels.mjs:15:import { loadBiSMemberResult } from './bis-results.mjs';
app/web\screen-panels.mjs:44:  c.rulesPanel = createRulesPanel({ ...c.panelContext, registry: () => c.registry, download: c.download, readJSON: c.readJSON, jsonPreview: c.jsonPreview, historyDialog: c.historyDialog });
app/web\screen-settings.mjs:1:import { originalSettings } from './data/settings.mjs';
app/web\screen-settings.mjs:2:import { applyTheme } from './map-tools.mjs';
app/web\screen-settings.mjs:3:import { createStreamSafe } from './stream-safe.mjs';
app/web\screen-search.mjs:1:import { chunkNotesForSearch, matchingSearchChunks, searchNoteExcerpt, sortSearchSources, searchLocations, searchPage } from './screen-search-data.mjs';
app/web\screen-search.mjs:2:import { createActivityFilterControls, selectActivityRows } from './activity-filters.mjs';
app/web\screen-search.mjs:3:import { taskIcon } from './browser-task-icons.mjs';
app/web\screen-search.mjs:4:import { loadIcons, itemIcon, skillIcon } from './icons.mjs';
app/web\screen-search.mjs:5:import { createTaskIconPainter } from './task-icon-painter.mjs';
app/web\screen-startup.mjs:1:import { createFeedback } from './feedback.mjs';
app/web\screen-startup.mjs:2:import { createBackupStatus } from './backup-status.mjs';
app/web\screen-startup.mjs:3:import { createUpdates } from './updates.mjs';
app/web\screen-startup.mjs:4:import { createRuneMetricsControls } from './runemetrics.mjs';
app/web\screen-startup.mjs:5:import { createInvites } from './invites.mjs';
app/web\screen-startup.mjs:6:import { createOverlayPanel } from './overlay-panel.mjs';
app/web\screen-startup.mjs:7:import { loadTerrainManifest, loadMapPins, createMapPinsPanel } from './map-pins.mjs';
app/web\screen-startup.mjs:8:import { hydrateDisplayWorld } from './display-world.mjs';
app/web\screen-startup.mjs:9:import { createRuleRegistryFromDefinitions } from './core/rule-registry.mjs';
app/web\screen-startup.mjs:10:import { ChunkMap } from './map.mjs';
app/web\screen-startup.mjs:11:import { loadIcons } from './icons.mjs';
app/web\screen-startup.mjs:12:import { loadMapInformation } from './map-info.mjs';
app/web\screen-startup.mjs:13:import { createDuoCoordination } from './duo-coordination.mjs';
app/web\screen-startup.mjs:14:import { loadArtStatus, installPictureFallbacks, observeArtStatus } from './art-status.mjs';
app/web\screen-task-dialogs.mjs:1:import { createNoteEditor } from './info-panels.mjs';
app/web\screen-task-dialogs.mjs:2:import { renderTaskEquipment } from './task-equipment.mjs';
app/web\screen-task-dialogs.mjs:3:import { itemIcon } from './icons.mjs';
app/web\screen-task-dialogs.mjs:4:import { createTaskMethods } from './task-methods.mjs';
app/web\screen-task-dialogs.mjs:5:import { resolveTaskAlternatives } from './core/task-alternatives.mjs';
app/web\screen-task-dialogs.mjs:6:import { createQuestMap } from './quest-map.mjs';
app/web\screen-tasks.mjs:1:import { createTaskFactsIndex, goalProgress } from './core/progress-index.mjs';
app/web\screen-tasks.mjs:2:import { createTaskIconPainter } from './task-icon-painter.mjs';
app/web\screen-tasks.mjs:3:import { taskIcon, taskCategoryIcon } from './browser-task-icons.mjs';
app/web\screen-tasks.mjs:4:import { itemIcon, skillIcon } from './icons.mjs';
app/web\screen-tasks.mjs:5:import { createTaskHover } from './task-hover.mjs';
app/web\screen-tasks.mjs:6:import { appendTaskPin, createTaskFilters } from './task-filters.mjs';
app/web\screen-tasks.mjs:7:import { isTaskPinned, createTaskPinChecker } from './task-filters-model.mjs';
app/web\screen-tasks.mjs:8:import { createDuoResultCache, selectDuoTasks } from './duo-tasks.mjs';
app/web\screen-tasks.mjs:9:import { createDuoTaskView } from './duo-task-view.mjs';
app/web\screen-tasks.mjs:10:import { appendTaskClaim, createTaskClaimClock } from './task-claims.mjs';
app/web\screen-tasks.mjs:11:import { isCustomTask, customTaskAssignedTo, personalCustomTaskRows } from './custom-tasks-model.mjs';
app/web\screen-tasks.mjs:12:import { createCopyLists } from './copy-lists.mjs';
app/web\screen-tasks.mjs:13:import { createBacklogView } from './screen-backlog.mjs';
app/web\screen-tasks.mjs:14:import { selectDuoTaskLists } from './duo-task-lists.mjs';
app/web\screen-tasks.mjs:15:import { createDuoBacklogView } from './duo-backlog-view.mjs';
app/web\screen-ui.mjs:22:  function lazyJSON(title, value) { const node = c.details(title); let loaded = false; node.addEventListener('toggle', () => { if (node.open && !loaded) { loaded = true; node.append(c.jsonPreview(value)); } }); return node; }
app/web\screen-ui.mjs:58:  c.jsonPreview = value => c.el('pre', JSON.stringify(value, null, 2), 'data-preview');
app/web\screen-usage.mjs:1:import { createUsageCounter, dialogUsageId, handleUsageControl } from './usage-client.mjs';
app/web\screen-usage.mjs:2:import { usageSummary } from './usage-model.mjs';
app/web\screen-usage.mjs:40:    const exportButton = c.button('Export JSON', () => c.download(payload, 'picker-usage.json'));
app/web\settings-panel.mjs:1:import { settingDefinitions } from './data/settings.mjs';
app/web\settings-panel.mjs:2:import { createDeathSettings } from './death-settings.mjs';
app/web\settings-panel.mjs:3:import { createMiningSettings } from './mining-settings.mjs';
app/web\settings-panel.mjs:4:import { createWoodcuttingSettings } from './woodcutting-settings.mjs';
app/web\settings-panel.mjs:5:import { createBankingSettings } from './banking-settings.mjs';
app/web\settings-panel.mjs:6:import { artStatusText } from './art-status.mjs';
app/web\sticker-picker.mjs:2:import { stickerDefinitions, resolveMemberStickers, MAX_STICKERS_PER_CHUNK } from '../core/map-markers.mjs';
app/web\sticker-picker.mjs:3:import { stickerAsset, stickerGlyph, stickerFont, stickerLabel, loadStickerFont } from './map-tools.mjs';
app/web\task-artwork.mjs:1:import { itemIcon } from './icons.mjs';
app/web\task-artwork.mjs:2:import { getArtStatus, placeholderPicture, resolvePicture } from './art-status.mjs';
app/web\task-claims.mjs:1:import { resolveSavedTaskId } from '../tasks/fact-projection.mjs';
app/web\task-equipment.mjs:1:import { itemIcon } from './icons.mjs';
app/web\task-equipment.mjs:2:import { taskItemIcon } from './task-artwork.mjs';
app/web\task-filters-model.mjs:1:import { resolvePersistedIdentity } from '../tasks/fact-projection.mjs';
app/web\task-filters-model.mjs:2:import { customTaskDoable } from './custom-tasks-model.mjs';
app/web\task-filters.mjs:1:import { readTaskFilters, writeTaskFilters, selectTaskFilters } from './task-filters-model.mjs';
app/web\task-hover.mjs:1:import { itemIcon, skillIcon } from './icons.mjs';
app/web\task-hover.mjs:2:import { taskItemIcon } from './task-artwork.mjs';
app/web\task-hover.mjs:3:import { taskIcon } from './browser-task-icons.mjs';
app/web\task-hover.mjs:4:import { renderTaskEquipment } from './task-equipment.mjs';
app/web\teleports.mjs:162:    catalogue = el('div', undefined, 'teleports-catalogue');
app/web\usage-catalogue.mjs:1:// Fixed UI families from docs/research/ui-map-2026-10-13.json. Never derive ids from player data.
app/web\usage-client.mjs:1:import { usageById } from './usage-catalogue.mjs';
app/web\usage-client.mjs:9:  let enabled = true, timer, sending = false, epoch = 0;
app/web\usage-client.mjs:11:  try { enabled = storage?.getItem(USAGE_STORAGE_KEY) !== 'false'; } catch {}
app/web\usage-client.mjs:24:    enabled = value === true; epoch++;
app/web\usage-client.mjs:29:    try { const next = storage?.getItem(USAGE_STORAGE_KEY) !== 'false'; if (next !== enabled) { enabled = next; epoch++; if (!enabled) pending.clear(); } } catch {}
app/web\usage-model.mjs:1:import { usageEvents } from './usage-catalogue.mjs';
app/web\woodcutting-settings.mjs:1:import { WOODCUTTING_HATCHETS } from '../training/woodcutting-rates.mjs';
app/web\woodcutting-settings.mjs:2:import { sameRuneScapeName } from '../core/game-progress.mjs';
```
