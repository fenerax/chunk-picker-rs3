# Calculator protocol

The calculator is everything that turns a saved game into tasks, predictions and
estimates. Today it is `app/tasks/worker.mjs`, hosted as a worker thread or an
owned child process (`app/tasks/process-worker.mjs`) and driven by
`app/tasks/scheduler.mjs`. This document fixes the boundary so two lanes can work
at once: the multiplayer lane changes the server side, the engine lane replaces
what sits behind it. See `docs/rebuild-lanes.md` for who owns what.

Version 1 describes today's messages in a language-neutral form. A calculator
written in any language is a separate program that speaks it. The current
JavaScript worker, wrapped in a small adapter, is the reference implementation
and the oracle for `docs/calculator-check.md`.

Source references were verified at core commit `a490498`.

## Transport

A calculator is a child process. The server writes frames to its stdin and
reads frames from its stdout. Each frame is:

1. a 4-byte little-endian unsigned header length `H`;
2. `H` bytes of UTF-8 JSON, the header;
3. a 4-byte little-endian unsigned body length `B`;
4. `B` bytes of body, possibly empty.

Large JSON (states, results) travels in the body as raw UTF-8 bytes, never
escaped inside the header. A header may describe a body made of several parts:
`parts: [{ "name": "play", "bytes": 1234 }, …]`, concatenated in that order.

stderr is for operator logs only. A calculator receives private gameplay; it
must never write state contents, member names or task text to stderr or to disk.
Counts, durations and error kinds are fine.

## Lifetime

1. The server starts the program with `--protocol 1`.
2. The server sends `init`. Its body is the init bundle (below).
3. The calculator compiles, then sends `ready`.
4. Requests and controls follow, one active request at a time per calculator
   (the scheduler queues; `progress` keeps the watchdog quiet).
5. The server ends a calculator by closing stdin, then killing it after a grace
   period. A calculator exits on stdin EOF.

The server may run several calculators. A calculator serves any picker that uses
its dataset digest; it never assumes one picker.

## Init bundle

Contract version 1 is implemented by `calculator/bundle/export.mjs`. It writes
UTF-8 JSON and named, byte-for-byte catalogue files into a **new** directory.
Nothing from a selected pack is executable. Export stdout contains only counts,
byte sizes, hashes and duration; errors contain no gameplay. Bundles containing
private inputs belong outside the public checkout.

```sh
RS3_DATASET=open-f2p node calculator/bundle/export.mjs --output /tmp/calculator-init
```

The API `exportBundle(directory, { dataset, init })` accepts the actual server
worker input, including custom definitions, extra rules and an optional guide
catalogue. The CLI's optional `--init file.json` accepts the same input encoded
with the codec below. Without it, `defaultInit(dataset)` reproduces the server's
native definition preparation and world boundary without opening storage.
`definitionBytes` is parsed into `definitions`; host paths in `datasetSelection`
are replaced by `{ datasetId, digest }`. Every other worker input is preserved.

`loadBundle(directory, { expectedDatasetDigest, expectedManifestSha256 })` verifies
all listed lengths and SHA-256 hashes, rejects unsafe paths, symlinks, duplicates,
missing inputs and unknown versions, and recomputes the original dataset digest.
Named catalogues must also match their original dataset file records. The full
source-file hash inventory is retained as provenance, not copied as executable
code. Pin the manifest hash when transferring bundles: the dataset digest does
not authenticate server-prepared definitions, overrides or legacy local defaults.
The source pack/profile/environment is resolved only at export time.
Identity is recomputed for duo-legacy, open-f2p and open-starter. For duo-legacy
selected through an installed profile, the profile-only `capabilities.features`
flags are excluded from the digest preimage and must equal the profile values.

`createBundleWorker(directory, { mode: 'process', datasetDigest, manifestSha256 })`
from `calculator/bundle/worker.mjs` returns the existing Worker-compatible endpoint.
`mode: 'thread'` is also supported. This is opt-in; the normal scheduler still uses
the reference path. A Node 24 preload installs the verified provider before the
worker import graph is linked, redirecting only the runtime's provider import.
The worker init and message handling are unchanged. Neither a source pack, a
local defaults file nor a dataset-selection environment variable is consulted
when loading a bundle. `RS3_STARTUP_TIMING_LOG` remains optional diagnostics only.

The JSON codec uses `{ "$datasetType": "Map", "entries": [[key, value], ...] }`,
`{ "$datasetType": "Set", "entries": [...] }`, and
`{ "$datasetType": "Undefined" }`. Order is preserved. Other values use ordinary
JSON. No functions or V8 serialization occur in init data. A calculator in
another language can consume every input below; computation still needs to be
ported. The reference's existing V8-encoded ready catalogue is an output/adapter
concern, unchanged by this init contract.

Sizes below are UTF-8 bytes: individual fields/values exclude their enclosing
keys and separators; named files include their original whitespace. Optional
worker inputs have scenario-dependent sizes. The two columns use a real-pack
export and the public open-f2p fixture. Local defaults for the real-pack proof
were reconstructed under scratch storage because the supplied defaults file
was absent; no source data was changed. `audit.json` records every module, key
and logical input size for the particular export.

| Worker input in `init.json` | Meaning | duo-legacy bytes | open-f2p bytes |
| --- | --- | --- | --- |
| `definitions` | Server-prepared definitions; includes prepared overlays. | 8854868 | 218255 |
| `datasetSelection` | Portable dataset identity; no source paths. | 102 | 100 |
| `datasetDigest` | Verified original dataset digest. | 66 | 66 |
| `datasetOptions` | Explicit preparation/engine overrides. | 25 | 25 |
| `preparedDatasetStages` | Preparation ledger; prevents applying stages twice. | 181 | 2 |
| `world` | Encoded `chunks`, `areas`, optional `surface` Maps/Sets. | 181015 | 3165 |
| `extraRules` | Additional rule metadata. | 2 | 2 |
| `skillGuideCatalogue` | Optional supplied guide catalogue; otherwise the named guide file. | absent | absent |
| `omitReadyCatalogue` | Optional ready-payload switch. | absent | absent |

| Provider input in `dataset.json` | Readers / purpose | duo-legacy bytes | open-f2p bytes |
| --- | --- | --- | --- |
| `datasetId` | Identity, task IDs and provider contract. | 12 | 10 |
| `datasetContractVersion` | World and provider contract. | 1 | 1 |
| `identityNamespace` | `tasks/identity.mjs`. | 5 | 14 |
| `coordinateSystem` | Dataset engine context. | 17 | 25 |
| `corePackApi` | Provider contract. | 1 | 1 |
| `id` | Provider compatibility identity. | 12 | 10 |
| `contractVersion` | Provider compatibility version. | 1 | 1 |
| `digest` | Worker, engine, collection, world, preparation and fingerprint checks. | 66 | 66 |
| `capabilities` | Engine/preparation/world, cache catalogues, identity and training. | 259 | 586 |
| `overlayOrder` | Original digest preimage. | 269 | 75 |
| `gameDefaults` | `core/state.mjs`, reached through planning. | 239 | 260 |
| `definitionOverlays` | `data/selected-definition-overlays.mjs`; follows retained-correction references. | 60 | absent |
| `ruleContractHash` | Original digest/provenance. | 66 | 66 |
| `packed` | Provider metadata. | 4 | 5 |
| `files` | Original dataset file records; digest preimage. | 15939 | 9586 |
| `status` | Frozen provider status. | 175 | 2090 |
| `valueFiles` | Named encoded-value sources below. | 108 | 15 |
| `jsonFiles` | Named catalogue allowlist below. | 1926 | 1811 |

All module-level JSON reads in the calculator closure use `datasetJSON` and are
listed below. Selected overlay references are followed as data, including their
retained-correction files. There are no separate direct JSON imports or
computational filesystem reads outside this provider boundary.

| Named catalogue copied into bundle | Reading module(s), relative to `app/` | duo-legacy bytes | open-f2p bytes |
| --- | --- | --- | --- |
| `app/data/archaeology-task-corrections.2026-10-08.v1.json` | `data/archaeology-task-corrections.mjs` | 781 | 169 |
| `app/data/cache-archaeology.2026-10-08.v1.json` | `data/cache-archaeology.mjs` | 1542830 | 195 |
| `app/data/cache-component-policy.2026-10-07.v1.json` | `data/cache-topology.mjs` | 3037532 | 181 |
| `app/data/cache-divination.2026-10-13.v1.json` | `data/cache-resources.mjs` | 2325 | 195 |
| `app/data/cache-resource-selectors.2026-10-08.v1.json` | `data/cache-resources.mjs` | 497115 | 181 |
| `app/data/cache-resources.2026-10-08.v1.json` | `data/cache-resources.mjs` | 4846325 | 195 |
| `app/data/cache-shops.2026-10-08.v1.json` | `data/cache-shops.mjs` | 34329 | 176 |
| `app/data/cache-surface-corrections.2026-10-08.v1.json` | `data/cache-topology.mjs` | 37468 | 244 |
| `app/data/cache-walkability.2026-10-07.v1.json` | `data/cache-topology.mjs` | 310565 | 176 |
| `app/data/divination.2026-10-13.v1.json` | `data/divination-training.mjs` | 3534 | 189 |
| `app/data/equipment-corrections.2026-10-08.v1.json` | `data/equipment-corrections.mjs` | 5848197 | 185 |
| `app/data/equipment-permanence.2026-10-08.v1.json` | `data/equipment-permanence.mjs` | 2837061 | 165 |
| `app/data/equipment-weights.2026-10-08.v1.json` | `data/equipment-corrections.mjs` | 4400804 | 165 |
| `app/data/item-membership-aliases.2026-10-08.v1.json` | `data/item-membership-aliases.mjs` | 267988 | 181 |
| `app/data/item-membership-review.2026-10-12.v1.json` | `data/item-membership-review.mjs`, `data/source-membership.mjs` | 67341 | 181 |
| `app/data/item-membership.2026-10-08.v1.json` | `data/item-membership.mjs` | 8240630 | 181 |
| `app/data/metadata-corrections.2026-10-08.v1.json` | `data/metadata-corrections.mjs` | 574436 | 169 |
| `app/data/monster-membership-review.2026-10-12.v1.json` | `data/source-membership.mjs` | 965418 | 165 |
| `app/data/picker-entities.2026-10-08.v1.json` | `data/item-membership.mjs` | 1488 | 192 |
| `app/data/poh-storage.2026-10-08.v1.json` | `data/poh-storage.mjs` | 95310 | 229 |
| `app/data/retained-entry-corrections.2026-10-12.v2.json` | `data/retained-task-corrections.mjs` | 23123 | 169 |
| `app/data/retained-task-corrections.2026-10-09.v1.json` | `data/retained-task-corrections.mjs` | 27204 | 169 |
| `app/data/retained-task-corrections.2026-10-17.v2.json` | `data/selected-definition-overlays.mjs` | 27729 | absent |
| `app/data/retained-unsupported-corrections.2026-10-13.v1.json` | `data/retained-unsupported-corrections.mjs` | 148321 | 169 |
| `app/data/retained-wording-corrections.2026-10-12.v1.json` | `data/retained-task-corrections.mjs` | 1792 | 169 |
| `app/data/reviewed-definition-overlays.2026-10-17.v1.json` | `data/selected-definition-overlays.mjs` | 128992 | absent |
| `app/data/skill-guides.2026-10-08.v1.json` | `data/skill-guides.mjs` | 5917604 | 185 |
| `app/data/skillguide-combat-corrections.2026-10-08.v1.json` | `data/skillguide-combat-corrections.mjs` | 427294 | 169 |
| `app/data/source-incidental-outputs.2026-10-08.v1.json` | `data/source-membership.mjs` | 4160 | 165 |
| `app/data/source-membership.2026-10-08.v1.json` | `data/source-membership.mjs` | 5946362 | 165 |
| `app/data/source-method-requirements.2026-10-08.v1.json` | `data/source-membership.mjs` | 2935 | 165 |
| `app/data/source-row-membership.2026-10-08.v1.json` | `data/source-membership.mjs` | 207385 | 165 |
| `app/data/training/death-woodcutting-guide.v1.json` | `tasks/time-estimates.mjs` | 4273 | 203 |
| `app/data/training/fishing-rates.v1.json` | `tasks/fishing-plan.mjs` | 13501 | 203 |
| `app/data/training/methods.f2p.json` | `data/training/catalogue.mjs`, `tasks/time-estimates.mjs` | 495968 | 262 |
| `app/data/training/mining-rates.v1.json` | `tasks/training-planner.mjs` | 3077840 | 203 |
| `app/data/training/woodcutting-rates.v1.json` | `tasks/training-planner.mjs` | 36047 | 203 |
| `app/data/transport-routes.2026-10-09.v2.json` | `data/transport-routes.mjs` | 596760 | 191 |

The following `datasetValue`, `datasetRuleDefinitions` and `datasetRuleRecords`
inputs come from the named value sources below. Contract/presentation pairs are
separate inputs; Set/Map/undefined tags are included in each logical size.
The module before `#` is the consuming module.

| Encoded value key (module#export) | duo-legacy bytes | open-f2p bytes |
| --- | --- | --- |
| `app/core/banking-settings.mjs#bankingSettingDefinitions:contract` | 330 | 2 |
| `app/core/banking-settings.mjs#bankingSettingDefinitions:presentation` | 401 | 2 |
| `app/core/death-settings.mjs#deathSettingDefinitions:contract` | 283 | 2 |
| `app/core/death-settings.mjs#deathSettingDefinitions:presentation` | 817 | 2 |
| `app/core/f2p-skill-caps.mjs#helperTrialCaps` | 153 | 2 |
| `app/core/game-progress.mjs#defaultRuneScapeNames` | 51 | 2 |
| `app/core/mining-settings.mjs#miningSettingDefinitions:contract` | 317 | 2 |
| `app/core/mining-settings.mjs#miningSettingDefinitions:presentation` | 293 | 2 |
| `app/core/player-controls.mjs#playerControlSkills` | 332 | 34 |
| `app/core/rules.mjs#ruleContract` | 1304 | 482 |
| `app/core/rules.mjs#rulePresentation` | 3847 | 1049 |
| `app/core/woodcutting-settings.mjs#woodcuttingSettingDefinitions:contract` | 138 | 2 |
| `app/core/woodcutting-settings.mjs#woodcuttingSettingDefinitions:presentation` | 159 | 2 |
| `app/data/access-policy.mjs#membershipSourcePolicies` | 1730 | 2 |
| `app/data/cache-entry-policy.mjs#TRANSPORT_ACCESS_RULE` | 18 | 18 |
| `app/data/cache-entry-policy.mjs#TRANSPORT_MASK_SHA256` | 66 | 4 |
| `app/data/cache-entry-policy.mjs#TRANSPORT_RUNTIME_SHA256` | 66 | 4 |
| `app/data/cache-entry-policy.mjs#cacheEntryKinds` | 90 | 35 |
| `app/data/cache-entry-policy.mjs#cacheEntryPolicies` | 5974 | 2 |
| `app/data/cache-entry-policy.mjs#cacheNonEntryPolicies` | 381 | 2 |
| `app/data/identity-registry.mjs#authoredEntities` | 1149408 | 2 |
| `app/data/identity-registry.mjs#authoredGoals` | 2 | 71 |
| `app/data/identity-registry.mjs#authoredSources` | 347156 | 2 |
| `app/data/identity-registry.mjs#authoredTasks` | 1476875 | 28877 |
| `app/data/identity-registry.mjs#identityRegistryVersion` | 1 | 1 |
| `app/data/lodestones.mjs#preCorrectionSurfaceLodestones` | 1993 | 2 |
| `app/data/lodestones.mjs#surfaceLodestones` | 1991 | 2 |
| `app/data/map-corrections.mjs#MAP_CORRECTIONS` | 19813 | 2 |
| `app/data/map-corrections.mjs#mixed` | 837 | 2 |
| `app/data/map-corrections.mjs#walkable` | 856 | 2 |
| `app/data/settings.mjs#authoredSettingDefinitions:contract` | 87 | 2 |
| `app/data/settings.mjs#authoredSettingDefinitions:presentation` | 124 | 2 |
| `app/data/settings.mjs#authoredTaskRules:contract` | 588 | 2 |
| `app/data/settings.mjs#authoredTaskRules:presentation` | 2587 | 2 |
| `app/data/settings.mjs#explicitRuleBehavior` | 6253 | 2 |
| `app/data/settings.mjs#missingGeneratedBehavior` | 273 | 2 |
| `app/data/settings.mjs#neighborSettingDefinitions:contract` | 154 | 2 |
| `app/data/settings.mjs#neighborSettingDefinitions:presentation` | 313 | 2 |
| `app/data/settings.mjs#originalRuleDefaults` | 3331 | 95 |
| `app/data/settings.mjs#originalRuleDescriptions` | 16169 | 2 |
| `app/data/settings.mjs#originalRulePresets` | 5045 | 111 |
| `app/data/settings.mjs#originalRuleReferences` | 6511 | 2 |
| `app/data/settings.mjs#originalRuleStructure` | 3008 | 97 |
| `app/data/settings.mjs#originalRuleSubDefaults` | 223 | 2 |
| `app/data/settings.mjs#originalSettingConflicts` | 72 | 2 |
| `app/data/settings.mjs#originalSettingDescriptions` | 3172 | 2 |
| `app/data/settings.mjs#originalSettingStructure` | 640 | 2 |
| `app/data/settings.mjs#originalSettings` | 658 | 276 |
| `app/data/settings.mjs#originalTaskGeneratingRules` | 978 | 2 |
| `app/data/settings.mjs#originalWorkerInputNames` | 772 | 2 |
| `app/data/settings.mjs#partialRuleBehavior` | 1381 | 2 |
| `app/data/settings.mjs#retainedRuleBehavior` | 193 | 2 |
| `app/data/settings.mjs#settingDefinitions:contract` | 3062 | 1114 |
| `app/data/settings.mjs#settingDefinitions:presentation` | 4562 | 1493 |
| `app/data/settings.mjs#settingLabels` | 1051 | 2 |
| `app/data/settings.mjs#taskRuleCategoryCounts` | 1934 | 2 |
| `app/data/settings.mjs#taskRuleCutoffDefaults` | 138 | 2 |
| `app/data/settings.mjs#taskRuleDefinitions:contract` | 20184 | 299 |
| `app/data/settings.mjs#taskRuleDefinitions:presentation` | 22584 | 802 |
| `app/data/skill-guide-rules.mjs#SKILL_GUIDE_CORRECTIONS_RULE` | 32 | 29 |
| `app/data/skill-guide-rules.mjs#SKILL_GUIDE_MILESTONES_RULE` | 30 | 28 |
| `app/data/skill-guide-rules.mjs#SKILL_GUIDE_TASKS_RULE` | 25 | 19 |
| `app/data/surface-grid.mjs#CACHE_SECTION_OFFSET` | 7 | 7 |
| `app/data/surface-grid.mjs#SURFACE_GRID` | 52 | 51 |
| `app/tasks/achievements.mjs#nonAreaFamilies` | 190 | 35 |
| `app/tasks/engine.mjs#F2P` | 235 | 195 |
| `app/tasks/engine.mjs#MAYBE_PRIMARY` | 115 | 35 |
| `app/tasks/engine.mjs#MONSTER_TRAINING` | 79 | 35 |
| `app/tasks/engine.mjs#PRESENTATION_RULES` | 183 | 35 |
| `app/tasks/engine.mjs#PROCESSING` | 204 | 35 |
| `app/tasks/engine.mjs#TWENTY` | 76 | 35 |
| `app/tasks/engine.mjs#UNSUPPORTED_RULES` | 58 | 35 |
| `app/tasks/engine.mjs#skillCaps` | 452 | 202 |
| `app/tasks/identity.mjs#verifiedProgressAliases` | 627 | 2 |
| `app/tasks/processing.mjs#processingSkills` | 213 | 35 |
| `app/training/fishing-rules.mjs#FISHING_BOUNDS` | 32 | 2 |
| `app/training/fishing-rules.mjs#FISHING_FORMULA` | 676 | 2 |
| `app/training/fishing-rules.mjs#FISHING_METHODS` | 2213 | 2 |
| `app/training/fishing-rules.mjs#FISHING_SOURCES` | 2813 | 2 |
| `app/training/fishing-rules.mjs#FISHING_SPECIES` | 1201 | 2 |
| `app/training/fishing-rules.mjs#FISHING_UNMODELLED_METHODS` | 2874 | 2 |
| `app/training/mining-rules.mjs#MINING_BOUNDS` | 84 | 2 |
| `app/training/mining-rules.mjs#MINING_CRITICAL_LEVELS` | 62 | 2 |
| `app/training/mining-rules.mjs#MINING_PICKAXES` | 1904 | 2 |
| `app/training/mining-rules.mjs#MINING_PROFILES` | 403 | 2 |
| `app/training/mining-rules.mjs#MINING_ROCKS` | 1356 | 2 |
| `app/training/mining-rules.mjs#MINING_SOURCES` | 833 | 2 |
| `app/training/mining-rules.mjs#MINING_STAMINA_MILESTONES` | 246 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_BOUNDS` | 41 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_FORMULA` | 691 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_HATCHETS` | 440 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_SOURCES` | 4050 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_TREES` | 1578 | 2 |
| `app/training/woodcutting-rules.mjs#WOODCUTTING_UNMODELLED_TREES` | 2094 | 2 |

| Bundle file / encoded value source | duo-legacy bytes | open-f2p bytes |
| --- | --- | --- |
| `app/data/legacy-dataset-values.2026-10-13.v1.json` | 5487241 | absent |
| `app/data/legacy-rules-text-values.2026-10-13.v1.json` | 90823 | absent |
| `audit.json` | 21683 | 21127 |
| `dataset.json` | 19438 | 14878 |
| `init.json` | 9036379 | 221735 |
| `values.json` | absent | 42272 |

The legacy value sources retain the original encoded transcriptions, verified
against their dataset file hashes. Open-f2p's `values.json` captures all resolved
values because its original digest includes the entire encoded value tree.
Unused legacy source/evidence files remain hash records only. `manifest.json`
lists every physical bundle file except itself with `file`, `sha256`, `bytes`,
plus the bundle contract version, dataset contract version and dataset digest.
Its own SHA-256 is returned by the exporter for external pinning.

`app/datasets.mjs`, `open-f2p.mjs`, `open-starter.mjs`, `dataset-profile.mjs`,
`game-defaults.mjs`, `legacy-game-defaults.mjs` and pack validation previously
resolved source paths and read files on calculator startup. Those reads are
replaced by the descriptor, encoded values and named catalogues. Their
`RS3_DATASET`, `RS3_PACKS_DIR`, `RS3_PACK_SELECTION`, `RS3_MAP_ASSETS_DIR`,
`RS3_GAME_DATA_DIR`, `RS3_RESOURCE_CONTENTS`, `RS3_ARCHAEOLOGY_CONTENTS`,
`RS3_CACHE_SHOP_CONTENTS`, `RS3_DATASET_PROFILE`, `RS3_DATASET_PROFILE_SHA256` and
`RS3_GAME_DEFAULTS_FILE` choices have no additional runtime input size: their
resolved effects are already counted above. The only remaining environment read
is `app/startup-timing.mjs`'s optional log path; it does not affect results.

The worker equivalence test freezes the diagnostic clock on both calculators,
so the public `metrics.elapsedMs` field is compared too. It removes only the
protocol's `timingMs`, `evaluationMs` and `cache` fields, preserves array order,
and checks both views, both members, both duo projections, future predictions
(including owner/partner reuse), planning and death estimates. Process-mode
bundle checks additionally forbid source JSON reads and use an invalid source
environment selection, proving there is no fallback to the original provider.

Measured with Node 24.19.0 in process mode. Five alternating startup trials
ran after the test suite, one calculator at a time. Export times use already
resolved/prepared inputs (`exportBundle(..., { dataset, init })`); the initial
CLI export including source resolution/preparation took 2,504 ms and 113 ms,
respectively. Values below are median (minimum–maximum), in milliseconds or
bytes as marked. These measure data loading/startup, not faster computation.

| Measurement | duo-legacy | open-f2p |
| --- | --- | --- |
| Export, ms | 1,032 (994–1,165) | 29 (26–45) |
| Reference startup, ms | 3,922 (3,621–4,565) | 157 (149–163) |
| Bundle startup, ms | 2,345 (2,263–2,850) | 154 (146–159) |
| Reference startup peak RSS, bytes | 1,056,116,736 (1,014,476,800–1,084,215,296) | 77,918,208 (77,488,128–78,008,320) |
| Bundle startup peak RSS, bytes | 923,291,648 (921,108,480–935,366,656) | 72,044,544 (71,536,640–72,835,072) |
| Physical bundle files | 44 | 41 |
| Total bundle bytes (including manifest) | 65,360,828 | 312,576 |

The copied-save proof and public-fixture proof each compared 14 request results
plus the ready catalogue, with zero differences. Their aggregate result hashes
(reference and bundle identical) are:

| Dataset | Canonical result bytes | SHA-256 |
| --- | --- | --- |
| duo-legacy | 103,419,922 | `71248df3586312b45aba128cebec8043fe3e1d4fefc33b6964ac900aab4cc221` |
| open-f2p | 3,640,387 | `8ae5379fd89c9bbdc4b880faca0d31829fc4f0fb6cd80b2b1cc3c3a1d7f1be18` |

Compressed reuse prefixes were also compared by their complete byte hashes.
The proof workload contains different request types and ran alongside tests;
its per-request medians/ranges are descriptive, not a throughput benchmark:

| Measurement | duo-legacy | open-f2p |
| --- | --- | --- |
| Reference request wall time, ms | 5,043.9 (3,052.0–8,778.3) | 15.2 (0.7–33.1) |
| Reference workload peak RSS, bytes | 3,200,765,952 | 138,371,072 |
| Bundle request wall time, ms | 5,334.2 (3,185.1–8,534.6) | 16.6 (2.0–39.3) |
| Bundle workload peak RSS, bytes | 3,144,126,464 | 137,580,544 |

## Messages from the server

Every request header has `v: 1`, an integer `id` unique within the calculator,
and `type`. Request headers also carry `pickerId` (`p_` + 32 hex, or
`legacy-shared`). It partitions caches and supersession only, and must never
change a result.

| `type` | Extra header fields | Today |
| --- | --- | --- |
| `evaluate` | `memberId`, `view` (`play-v1` or `full`), `projections` (subset of `duo`, `duo-sidebar`) | the task list (`worker.mjs:343`) |
| `predict` | `memberId`, `chunkId` | "what if I unlock this chunk": delta for the owner, then a full reusable result for owner and partner (`worker.mjs:356`–`380`) |
| `death-estimates` | `memberId`, `chunkIds` | per-candidate death estimates, cancellable between candidates (`worker.mjs:221`) |
| `chunk-planning` | `memberId`, `chunkId` | tasks and clue locations tied to one chunk (`worker.mjs:182`) |
| `sandbox` | `memberId`, `draft` | hypothetical unlocks/locks/completions (`worker.mjs:189`); today the draft rides in `chunkId` |
| `area-check` | `memberId`, `draft` | area audit for a hypothetical (`worker.mjs:333`); today the draft rides in `chunkId` |
| `prepare-rules` | none | precompile a rule set before it is saved (`worker.mjs:329`) |
| `roll-pool` | `memberId`, optional `draft` | **new.** Eligible chunks to roll. Today `evaluateRollPool` runs on the HTTP thread (`app/server.mjs:656`, `1602`, `1798`) and in game commands (`app/core/state.mjs:2014`); Phase 0 measured 6.3 s of blocked HTTP loop for the duo. |
| `cancel` | `id` of the request to abandon | `worker.mjs:299` |
| `supersede` | `pickerId`, `revision` | drop work for older revisions of that picker only (`worker.mjs:300`) |

### State

Every calculating request names the state it applies to:

- `revision`: the picker's state revision;
- `input`: the task-input fingerprint (a string). Display-only saves keep it, so
  a calculator may reuse work across revisions with the same input;
- `snapshotKey`: `JSON.stringify([revision, input])`;
- `state`: `"body"` when the body is the full state JSON, or `"ref"` when the
  calculator should reuse the state it last received under the same
  `pickerId` and `input`, rebound to `revision`.

A calculator keeps a bounded LRU of states keyed by `(pickerId, input)`
(`STATE_SNAPSHOT_LIMIT`). If a `ref` misses, it replies with error kind
`snapshot-missing` and the server resends the body. The state schema is the saved
game (`schemaVersion: 1`, `members`, `tasks`, `history`, rules); the calculator
must reject a body whose members do not match the header (`worker.mjs:272`–`296`).

## Messages from the calculator

| `type` | Header | Body |
| --- | --- | --- |
| `ready` | `v`, `datasetDigest`, `engine: { name, version }`, `supports` (request types it implements), `compileMs` | the catalogue (`worker.mjs:421`–`423`) unless omitted |
| `progress` | `id` | none. At most one a second during long work. |
| `prediction-prepared` | `id`, `memberId`, `taskInputKey`, `sourceRevision`, `priority`, `parts` | the owner's reusable result, sent before partner work starts (`worker.mjs:368`) |
| `result` | `id`, `parts`, `timingMs`, `evaluationMs`, optional `cancelled`, `cache` | see below |
| `error` | `id`, `error: { kind, message }` | none |

Result parts by request type:

| Request | Parts |
| --- | --- |
| `evaluate` | `play` always; `full` when `view: "full"`; `duo` / `duo-sidebar` when asked |
| `predict` | `delta` (`{ delta, coverage, metrics }`); plus `owner-reuse` and `partner-reuse`, each with `play`, `duo`, `duo-sidebar` and their own `memberId`, `taskInputKey`, `sourceRevision`, `priority` |
| `death-estimates` | `estimates` (`{ memberId, stateRevision, estimates, cancelled }`) |
| `chunk-planning` | `planning` (`chunk-planning-v1`) |
| `sandbox` | `sandbox` (`SANDBOX_FORMAT`) |
| `area-check` | `area-check` |
| `roll-pool` | `pool` (the `evaluateRollPool` result) |
| `prepare-rules` | `prepared` |

Parts are plain JSON. Today's worker also gzips the reusable parts
(`worker.mjs:261`). A calculator may add `encoding: "gzip-sync-prefix"` parts
with `crc32` and `rawLength`; the server must accept results without them.

Error kinds: `invalid` (today's `TypeError`; the server reports a bad request),
`snapshot-missing` (resend the body), `failed` (anything else; the server retries
or restarts the calculator). Messages must not quote state contents.

`timingMs` uses fixed stage names (`engineMs`, `collectionMs`, `equipmentMs`,
`presentationMs`, `currentBiSMs`, `activityMs`, `predictionMs`, `deathMs`,
`totalMs`, …). A calculator may add stages; it may not rename these.

## Rules both sides keep

- **Same input, same output.** A result depends only on the bundle, the state and
  the request fields above. Not on `pickerId`, request order, cache state,
  wall-clock time, randomness or thread count.
- **Supersession is per picker.** A higher revision in picker A never cancels
  work for picker B. Today `latestRevision` is one number per worker
  (`worker.mjs:150`); version 1 calculators key it by `pickerId`.
- **Cancellation is cooperative.** A calculator checks between units of work
  (candidates, prediction steps) and returns `cancelled: true` with whatever it
  completed. The scheduler's deadline and restart remain the hard limit.
- **Unknown types are refused**, not ignored: `error` with kind `invalid`. The
  server routes a type that is not in `supports` to the reference calculator.
  This lets a new engine take over one request type at a time.
- **Bounded memory.** A calculator declares nothing about its limits; the
  server enforces them (RSS cap, process count). A calculator must survive being
  killed at any point without leaving files behind.

## Changing this protocol

Changes go through a pull request that edits this file first, then the reference
adapter, then the server. Bump `v` for a change that an older calculator or
server would misread. Adding an optional header field or a new request type
(declared in `supports`) does not need a bump.
