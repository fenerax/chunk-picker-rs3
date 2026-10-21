# Public core and private packs, 13 October 2026

Player 1 and Player 2 should keep using the picker they have now, with the same pictures, tasks, rules, invite links and saves. First move its artwork into a local pack and serve those same files through the existing server. Build and test the public version separately, using the same application code.

The public version should start without any private pack. It should include a small independently authored dataset, a plain coordinate map and deliberately crude placeholder icons. It must contain no Jagex artwork or Source Chunk material. It does not need the old catalogue's full coverage before it becomes a useful free tool.

Later, Player 1 can run that public code with her private art and legacy data packs. Keeping the legacy data pack is the recommended long-term choice for the existing duo save: it preserves today's identities and behaviour without migrating that save. Using the independent catalogue for their current game would be a separate future decision. Player 2 continues opening her hosted picker through his invite link; he installs nothing.

Use a staged repository move. While dependencies are being separated, the private repository remains the source of truth and an allowlisted export produces a clean public candidate. Once that candidate passes both public and private checks, the public repository becomes the source of truth for shared code. The private repository then holds research, pack-building inputs and private checks; packs and saves remain local. Never publish the existing Git history.

This is a design report only. None of the pack formats, loaders, exporters, placeholder assets or tests proposed below have been implemented by this job.

## Evidence and boundaries

Read together with the [readiness audit](open-source-readiness-2026-10-13.md), [upstream dependency inventory](upstream-dependency-inventory-2026-10-13.md), [art policy research](jagex-art-policy-2026-10-13.md) and [local map asset documentation](../map-assets.md). This report applies those findings to packaging; it makes no new legal clearance claim and requires no web retrieval.

Local inspection covers `codex/packplan` at `6197433`, Node 24.20.0. It includes server startup/static routes, icon resolution, map and interior loaders, rule/identity imports, tracked asset paths and read-only catalogue counts. No other worktree, actual save, installed private pack, game cache or live service was opened. Counts below describe possible UI lookups, not observations of the duo's current screen.

The dependency inventory's step 2 is essential. `app/server.mjs:399` loads the original export/seed, and `:458` unconditionally reads legacy task history. `app/tasks/identity.mjs:1` statically imports the old identity registry. `app/web/rules-model.mjs:1` imports captured rule wording. `app/data/world.mjs:11` activates cache walking through old names and a record-count heuristic. Injecting `definitions`, `taskMap` and `world` into `createServer` is useful, but does not yet remove these dependencies.

The public code, independently drawn placeholders and datasets need separate licence scopes. Recommend MIT for authored code and placeholder drawings, with provenance for each drawing. Keep permitted Wiki adaptations separately labelled with source revisions, attribution and their applicable terms. "Independent" here means independent of Source Chunk; cache output and Wiki compilations still need their own publication review. The art-policy report leaves acquisition and hosted use unresolved. A local pack is packaging, not permission.

## 1. Pack format and discovery

### A folder with one declared kind

Use ordinary folders containing JSON manifests and files. No dependency, archive installer, executable plugin, dynamic import or new package manager is needed. A representative operator-owned layout is:

```text
<private-folder>/picker-packs/
  selection.json
  duo-art/1.0.0/pack.json
  duo-art/1.0.0/resources/...
  duo-art/1.0.0/task-item-artwork.2026-10-09.v1/...
  duo-art/1.0.0/map-assets/...
  duo-art/1.0.0/terrain-assets/...
  duo-art/1.0.0/icon-assets/...
  duo-data/1.0.0/pack.json
  duo-data/1.0.0/catalogues/...
  duo-rules-text/1.0.0/pack.json
  duo-rules-text/1.0.0/rules-ui.json
```

Keep this folder outside the checkout for daily use. Also support ignored `.local/packs` in the current checkout for fixtures and operator convenience. Saves, access credentials, invite tokens and backups belong in their existing storage directory, never inside a pack. Do not write generated packs into `resources/` or `app/data/`.

| Kind | Contents | What it can change |
| --- | --- | --- |
| `art` | Item/skill/category/slot icons, terrain and overview images, legacy world/background images, clue pictures, interior tiles; artwork indexes and image-layout descriptors | Pictures and display-layer coverage. It cannot grant access, add tasks, change requirements or reinterpret saves. |
| `data` | Complete selected dataset: world, tasks, equipment, sources, gates, IDs/aliases, old seed/history when applicable, corrections, rule keys/types/defaults and profile configuration | Gameplay catalogue and semantics supplied to authored core algorithms. Select one complete dataset, never overlay the old task catalogue onto the independent one. |
| `rules-text` | Labels, explanations, ordering, sections, tooltips and preset presentation | Text/presentation only. Bind it to an exact rule contract; executable hooks, new rule keys and changed rule defaults do not belong here. |

Split the rules-text kind because captured wording is a separate publication blocker. The private profile should require its matching rules-text pack to preserve the present Settings interface. The public dataset includes fresh explanations. A rules-text pack may refer to presets defined by the data contract; it must not change their saved values or effective defaults. Bundling the three folders in one local installation is fine, while retaining separate manifests and boundaries.

Map pins, coordinates, entrances, interior-to-area joins, masks and connections are data even when stored beside images today. During the art-only milestone, keep their existing inputs unchanged. Ultimately put gameplay/display metadata in the selected dataset or a separately reviewed display-data component of it. Art manifests contain only the descriptors needed to address and draw files, bound to that dataset's coordinate system. Do not let an "art-only" public export accidentally carry copied labels, aliases or topology.

### Manifest contract

The following is a proposed shape, not a file to install. Angle-bracket values are explanatory placeholders.

```json
{
  "schemaVersion": 1,
  "id": "duo-art",
  "kind": "art",
  "version": "1.0.0",
  "requires": {
    "corePackApi": 1,
    "datasetId": "duo-legacy",
    "datasetContractVersion": 1,
    "coordinateSystem": "surface-grid-v1"
  },
  "roots": {
    "legacyResources": "resources",
    "taskArtwork": "task-item-artwork.2026-10-09.v1",
    "mapAssets": "map-assets",
    "terrainAssets": "terrain-assets",
    "iconAssets": "icon-assets"
  },
  "catalogues": {
    "artBindings": "indexes/art-bindings.json"
  },
  "files": [
    {
      "path": "indexes/art-bindings.json",
      "bytes": 123,
      "sha256": "<64 lowercase hex characters>"
    }
  ],
  "provenance": "provenance.json",
  "distribution": "private-local"
}
```

Require `schemaVersion`, stable `id`, `kind`, immutable pack `version`, core API compatibility, declared capabilities/roots/catalogues, byte sizes and SHA-256 for every payload file, including indexes and provenance. Data manifests also declare `datasetId`, contract version, identity namespace, supported features and the exact rule/overlay versions. Rules-text manifests declare the matching rule-contract hash. Art declares coordinate compatibility and bindings for the selected dataset; shared generic skill symbols can have a dataset-independent scope.

Use semantic pack versions: patch for corrected pictures/copy within the same contract, minor for compatible additions, major for changed schemas or contracts. Any payload change gets a new version and digest. Declare `corePackApi` separately so a new app release can still read an old pack. Data changes that alter obligations or save meaning require explicit review regardless of the version label; never automatically upgrade the live dataset because a newer pack is installed.

`selection.json` explicitly selects one dataset and at most one pack for each art component or rules-text contract. Pin each selected `pack.json` by SHA-256 there. Reject ambiguous duplicate bindings instead of choosing a folder by enumeration order or modification date. Components may share one art pack, but their order and ownership must be explicit. A manifest excludes itself from its file list; the selection receipt supplies its hash. Hashes establish integrity against the selected receipt, not authorship, permission or protection if somebody replaces both files.

Use byte hashes for new pack files. Preserve the current legacy data loader's canonical text-hash receipts and normalization checks as additional compatibility evidence; do not rewrite copied JSON or line endings during the first move. Date/version URLs alone do not guarantee immutable content. Use a manifest digest or content digest in new URLs, keeping existing URLs as compatibility aliases where required. Include dataset and pack digests in calculation/response cache keys. An art change must not invalidate task identities or trigger a gameplay migration.

Install into a new version directory, validate, write its manifest last, then atomically select it and restart the server. No automatic network download, directory watching, hot replacement or browser-supplied filesystem path. Retain the prior selection for rollback. Pack updates are deliberate operator actions, not save commands; gameplay changes still use the revision-checked command system.

### Discovery and reuse of existing roots

Propose `RS3_PACKS_DIR` for the discovery root and an optional `RS3_PACK_SELECTION` for a selection-file path. Default to `.local/packs/selection.json` beneath the checkout, matching the current server's checkout-local asset defaults. Discover only explicitly selected manifests. Environment variables contain local paths, never URLs. Show installed kind/version/health in Settings → Advanced without exposing absolute paths to invitees.

Preserve the existing `RS3_MAP_ASSETS_DIR`, `RS3_TERRAIN_ASSETS_DIR` and `RS3_ICON_ASSETS_DIR` conventions. `app/server.mjs:323–325` currently defaults terrain and icon roots to the map root; interiors use the map root too. Use these mechanisms beneath the pack adapter rather than introducing a second terrain/icon renderer.

Resolve each component as explicit existing root override, then selected art-pack root, then its current local default. Preserve the terrain/icon-to-map default when a separate component root is absent. Treat legacy overrides as local art providers and validate them against their existing manifests. Record the resolved component choices in the operator receipt so an environment override cannot silently defeat a pack test. Keep existing nested icon, terrain and interior manifests/hash contracts; the outer pack manifest pins them. The committed expected icon/interior/terrain descriptors must eventually be supplied by the selected profile too, instead of retaining private descriptors inside public modules.

Add only the missing bindings for legacy `resources`, world/background and the two task-artwork PNGs. `resourcesRoot` is already injectable into `createServer`; extend that seam to resolve artwork outside the tree. At first preserve exact route names and bytes. Later the same resolver can return public placeholders. Do not retain a repo-art fallback that would make missing-pack testing appear successful.

Serve only manifest-listed files through existing authenticated, same-origin routes. Canonicalize paths, enforce containment after resolving Windows junctions/symlinks, reject absolute/UNC paths, `..`, drive prefixes and cross-root redirects. Recheck containment when opening a file; refuse pack links/reparse points rather than allowing them to become arbitrary file serving. Validate sizes, image dimensions/types and resource limits. Verify large tile files lazily against pinned hashes; verify small manifests before activation. Invalid artwork falls back safely. A corrupt or mismatched selected data pack must refuse gameplay writes, rather than selecting another dataset.

Manifests are declarative JSON. Do not execute HTML, scripts, CSS or pack-provided SVG code. Initially retain the exact reviewed legacy SVGs in the private art pack, served as images with the existing CSP and appropriate MIME types; accept only an audited inert SVG subset for new packs. JSON text is rendered as text. Packs cannot add write controls, bypass command validation or alter viewer permissions.

### Missing-pack behaviour

| Situation | Visible result |
| --- | --- |
| New public installation, no packs | Independent dataset, fresh rule wording, placeholder icons and plain grid. Tasks/calculators appear only for its declared coverage. |
| Private data installed, artwork absent or damaged | Same tasks, IDs, settings, progress and access; placeholder pictures/grid, with short "Using placeholder pictures" status. No repeated broken-image requests. |
| Some private pictures missing | Fall back per file: exact item picture → explicit generic item symbol plus name; category/skill picture → placeholder; optimized terrain → pack PNG → grid. Never reach back into excluded original art. |
| No data pack selected, existing independent save | Use its matching bundled independent dataset version. Opening a save does not upgrade its catalogue automatically. |
| Existing duo save, expected legacy data/rules pack missing or mismatched | "This save needs its data pack." Refuse calculations or writes that could reinterpret it; preserve files untouched. Offer a separate fresh independent game, never substitute that game into the duo storage directory. |
| Optional rules-text absent in a public game | Bundled fresh descriptions for the same rule contract. An explicitly required private rules-text pack cannot silently change today's presentation. |

Missing art never changes access policy. A gray map cell does not imply land, water, walkability or an unavailable activity. Independently sourced text and coordinates remain available when their dataset supports them. Unknown geography stays unknown.

## 2. Every artwork surface and its public fallback

Keep the present layout, icon boxes and visual language. Placeholder pictures should be crude, independently drawn suggestions of RS activity types: a stick sword, blocky fish, simple pick, log, book or bag. They should look obviously temporary. Do not trace, recolour, reduce or feed game images into a replacement process. Crudeness alone does not establish independence; retain authorship records. If permission never arrives, these placeholders remain the supported public art.

| Current location/use | Public build without art pack | Private installation |
| --- | --- | --- |
| `resources/equipment_icons/`, optional item PNG bundles, task lists/search/completed rows, Activity Info, profile gear, BiS, equipment tables and chunk ground-spawn rows | Exact item name remains primary. Use one generic bag/item symbol where an image slot is useful; no guessed item identity. Skill/category symbol can describe the row's activity, explicitly separate from the inventory identity. | Resolve the same exact item/alias and artwork as today, including variants. No fuzzy name or tier matching. |
| The two `app/web/task-item-artwork.2026-10-09.v1/` copies | Generic item symbol and exact name. Public resolver contains neither those bytes nor their upstream fallback bindings. | Move both images and their bindings into the art pack; keep old route aliases and hash parity. These are two exceptions, not a reason to copy all equipment icons. |
| `resources/SVG/rs3/`, `resources/SVG/osrs/`, optional skill PNGs | 29 rough skill drawings plus five other task-type drawings, shared by category headings and applicable task rows. Profile, skill guide and Area check use the same skill symbols or text. | Keep the current RS3 SVG/PNG resolution order and bytes. No current authored UI reference to OSRS SVGs was found; do not invent a new use. |
| Root `resources` PNGs: BiS slot icons and other skill/combat/slot art | Slot name in the existing slot area; optional crude slot silhouettes later. Combat/skill roles reuse the category set. Drop unused root images. | Preserve all reachable legacy asset routes during parity checks, including slot aliases. |
| `resources/chunk_images/`, `resources/section_overlays/` | Coordinate grid and authored selection/ownership/section outlines from the selected dataset. No photographic/map-texture substitute required. | These inherited folders have no direct current authored UI reference found. Inventory reachable routes and private tooling before omitting unused files; active world terrain and access masks remain identical. |
| `reference/original-picker/runescape_world_map.png`, `Background-chunk.PNG`, `/assets/world.png`, `/assets/background.png` | Canvas/plain grid in the same world coordinates; neutral authored background. No old-map underlay when tiles are missing or transparent. | Preserve exact world/background fallback bytes, including old/partial terrain manifests. The background route remains served today although no authored UI caller was found. |
| Local community/cache surface tiles, optimized WebP overview/native pages, ocean underlay | Grid at every zoom; maintain pan, zoom, chunk hit-testing, labels and ownership. An independently authored schematic can follow, but is optional. | Existing optimized → PNG/cache → approved legacy fallback precedence, coordinate transforms, transparency and gap handling remain unchanged. |
| Local map category PNGs and cache sprites, legend/search/map pins | Seven broad group symbols or the existing authored marker, with each independently supplied category name/count/search result retained. Multiple category names can share a picture. No pins are invented from missing art. | Preserve category and placement sprite bindings, pin IDs, hidden-pin preferences and current legend behaviour. |
| `resources/clue_maps/` (24 files) | Independently supplied clue text, coordinates and a location marker; optional authored coordinate diagrams. Current clue activity layers use authored highlights; no direct current consumer of the 24 picture files was found. | Pack any actually needed images. Do not infer that every inherited file appears in a current view. Old clue location memberships belong to private data. |
| Local rendered interior tiles and v1/v2 interior descriptors | Plain floor/bounds grid or "No picture for this place", with independently supplied entrance/floor text. Do not invent a dungeon layout from a surface tile. | Preserve current mapped areas, floor choices, crop/scale and unavailable-map messaging. Area joins belong to data; tile layout/hash indexes belong to art. |
| `resources/cursors/`, `resources/favicons/`, four other retained reference PNGs | Standard platform cursors and the authored grid favicon in `app/web/favicon.svg`; exclude legacy avatars/reference graphics. | No direct authored UI uses of these inherited cursor/favicon/reference files were found. Removing unused copies must not change current cursor or identity. |
| `resources/fontawesome/`, sticker symbols and authored CSS/canvas controls | Retain the separately licensed component with required notices, or replace through a later independent decision. Keep authored marker/control drawings. | Same glyphs and sticker IDs. Moving Jagex art must not remove this unrelated licensed font. |

The server's generic top-level `/assets/<name>.<image-extension>` route at `app/server.mjs:1900` is broader than current UI use. Replace its filesystem enumeration surface with explicit pack bindings; do not assume that "no UI caller" means no served asset. Nested inherited equipment, chunk, overlay and clue folders are not broadly served by that top-level pattern.

### How many placeholder drawings are needed?

Count roles and semantic targets, not stored files. Inspection of `app/tasks/task-icons.mjs`, `app/web/info-panels.mjs:343`, `app/data/map-pin-categories.mjs` and current call sites gives:

| Distinct UI use | Current semantic targets | Placeholder drawing budget |
| --- | ---: | ---: |
| Skill/category pictures in headings, tasks, search, completed lists and Activity Info; skill pictures in profile/guides/Area check | Resolver supports 29 skills and five other distinct pictures: quest, achievements, minigame, clue, music. Combat reuses Attack. The raw retained catalogue has 34 category labels resolving to 32 distinct SVG URLs. | 34 shared drawings for the complete supported resolver, reused across these surfaces. |
| BiS slot identity | 17 slot keys, 17 distinct file targets including the Clean fallback; torso/body share a picture | 0 required if slot names remain visible; up to 17 optional drawings. |
| Map-pin legend/search and placement symbols | 107 named types plus Other, seven legend groups; 202 distinct reviewed sprite IDs feed the category model | 7 broad drawings, or reuse the authored marker. Sprite variants do not require individual public drawings. |
| Exact item identity across tasks, search, Activity Info, equipment, BiS/profile and ground spawns | Dynamic, catalogue-driven lookups; two bundled special-case PNGs | 1 generic drawing plus exact names. Optional small item-family set later. |
| World, floors and clue pictures | Layers/tiles/diagrams, not inventory icon identities | Grid, text and existing canvas primitives; no per-tile replacement images. |
| Favicon, controls, stickers | Existing authored grid/control drawings and separately licensed font glyphs | No new Jagex replacement drawings required. |

Thus **about 42 new drawings** (34 + 7 + 1) cover most uses with text. A version retaining every distinct slot picture would need at most **59** before reuse. A few extra item-family symbols could fit a roughly 50–60 drawing budget while keeping slots as text. Start with 42; a handful of generic symbols and text could support an earlier functional public prototype. These are proposed budgets, not measured acceptance of a new UI.

For scale, a read-only count ran `taskItemNames` on each of the 20,375 raw retained task labels, joined normalized names to the four committed icon manifests through `createIconCatalogue`, and deduplicated resolved image URLs. It also queried equipment keys and ground-spawn keys using the UI's plain-name treatment:

| Input to existing item lookup | Distinct candidate names | Names resolved by current manifests | Distinct resolved image URLs |
| --- | ---: | ---: | ---: |
| Raw task rows | 8,842 | 3,795 | 3,678 |
| Equipment records | 3,550 | 2,723 | 2,410 |
| Ground-spawn records, recursively across chunk contents | 314 | 225 | 217 |
| Union of those inputs | 11,252 | — | 5,238 |

These sets overlap. Wiki markers can name activities rather than inventory items, and runtime corrections/generated goals/manual goals may add or change candidates. The manifests describe optional art; their presence does not prove any PNG is installed. This is a reproducible potential-use count, not a claim of 5,238 pictures currently displayed, nor a complete runtime coverage count. It explains why recreating 4,134 inherited equipment PNGs is the wrong placeholder scope. Reuse one visual vocabulary across the actual UI roles and let names carry exact item identity.

## 3. The data seam

### One dataset selected before the app loads it

Introduce an authored dataset-provider boundary at startup. Resolve the selected provider before compiling worlds, starting workers, creating rules, opening/migrating a store or exposing browser catalogues. Its contract supplies definitions/world inputs, task and entity IDs/aliases, optional legacy history, rule definitions/defaults/presentation, capabilities, source catalogues and provenance. It supplies no executable module from a pack.

The initial private provider should wrap the current files and pipeline without rebuilding them. Copy its complete frozen inputs into the data pack, preserve byte/content receipts, and select the same overlays in the same order. The public provider has its own IDs and starts with a small, independently authored world and tasks. Use explicit capabilities such as supported sources/interiors/collision coverage; replace nickname/count-based detection with those declarations.

Remove hidden provider choices from static imports and default arguments. The seam must reach the server, world builder, task/collection/equipment engines, identity lookup, migrations, storage preparation, worker bootstrap and browser-served modules. In particular, move the old generated registry, verified legacy aliases, historical seed, captured rules and dataset-specific settings/wording behind it. Preserve reusable authored parsers and algorithms, but review the inventory's closely modelled task/ranking policies against the project's own specification. A loader wrapper around the root JSON is insufficient.

Workers must receive the exact selected dataset/contract and digest, including lazy or restarted workers. Browser catalogues/API payloads must come from that same selection. No unconditional import of a private JSON file, no engine default that quietly reapplies a retained overlay, and no static route to unselected private metadata. Scope caches and original-service imports to the dataset; art is a separate provider. Generic account/sync configuration can remain local, preserving today's private integrations without hard-coded personal defaults in public source.

| Dependency group from the inventory | Private provider | Independent provider |
| --- | --- | --- |
| Root export: chunks/sections, tasks, sources, equipment, quests/clues/Slayer | Exact frozen export and current runtime corrections | Own minimal world/catalogue first; independently rebuilt batches with explicit gaps. |
| Old task-map seed/history, identity registry, completion/source aliases | Exact existing IDs and mappings, including generated goals and compatibility evidence | Own stable namespace/registry; legacy history optional and absent. Never import old labels to mint new IDs. |
| Component/resource/NPC/shop/Archaeology/membership/equipment overlays | Exact currently selected versions and settings | Independently regenerated facts/joins; empty supported catalogues for unavailable features, rather than retained fallback. |
| Connections, transport, banks, pins, interiors and area joins | Exact current bindings, gates and precedence | Own coordinates/IDs and reviewed gates; unknown entrances omitted conservatively. No copied selector dictionary hidden in a geometry file. |
| Rules/settings/presets and generated task policy | Same keys, values, cutoffs, defaults and presentation | Fresh independently specified rules/templates; no automatic import of 143 captured rule rows or 26 descriptions. |
| Importer and fixture bindings | Local explicit user configuration, private synthetic/authorized parity inputs | Generic inputs and synthetic fixtures; no duo account/map defaults or captured progress. |

### A usable independent baseline

Implement the inventory's step 2 before widening data coverage. The minimum public installation must start with no old export, seed, history, rule capture or private metadata physically present. Give it a small independently authored grid/world, valid roll candidates and clear rules, manual ownership/notes/markers, a few own tasks/manual goals, progress, History/Undo, backups and invite/viewer sharing. Verify a complete interaction, not just the health endpoint. Synthetic fixtures prove isolation; the shipped initial dataset needs its own useful documented scope and provenance.

Add F2P content in reviewed batches: sources/recipes, equipment, quests/achievements, drops/stock, gates and transport. Rates and independently evidenced mechanics can be reused within their licence scope after rebinding. Current cache/Wiki overlays are evidence pools, not automatically publishable replacements. Exclude unknown locations and disabled recommendations with short ordinary wording; put source/coverage details in Advanced. Art can use a plain grid throughout. Initial public coverage is smaller; the private provider keeps all current features.

### No migration for the live save

The legacy data pack is the compatibility baseline, not an import into the independent dataset. Preserve task/entity/goal IDs, aliases, section IDs, rule keys, saved source bindings, completion attribution, custom tasks, backlog, selections, notes, history event payloads and inverse commands exactly. Do not remint IDs, replay an initial import, retick tasks or create pack-install events in gameplay History. Existing normal startup preparation must stay a no-op for an already current save.

Select the legacy profile explicitly for the duo storage directory. Use a local operator receipt outside gameplay files to bind that existing directory to its expected dataset/contract/digest. Creating this receipt must not edit the save. New independent games can record dataset identity in their initial state through the existing creation/command path; do not impose a new mandatory save field on the live game just to install packs. Until binding is explicit, never auto-detect a legacy save solely by familiar player names or labels.

Default a fresh public launcher to a separate fresh-game directory; never point a no-pack run at `.local/duo` and let normal migration/reconciliation proceed. A selected legacy profile with a missing/incompatible pack fails before store preparation or writes. A wrong catalogue is not an acceptable fallback for that save. Restart with the original pinned pack to recover. Do not offer runtime dataset switching for an open game in the first version.

Parity means more than matching the visible task count. On an authorized disposable save copy, compare pre/post save bytes and semantic state after a read-only startup; compare task IDs/statuses/order, aliases, sources, access/roll pools, BiS, transport/training results, rules and command results. Control clock/random inputs and exclude only documented transient timing fields. Exercise a normal change, History, Undo, backup/restore and invite permissions on the copy. Opening today's save must create no new migration or revision. Art bytes/routes and screenshots have a separate parity gate.

## 4. One codebase and the repository move

| Choice | Benefit | Limitation |
| --- | --- | --- |
| (a) Private source of truth, generated public export | Allows staged cleanup without losing private features; private checks can validate each seam | Every release depends on a trustworthy export gate. Unreviewed code/data/docs may leak, and public fixes can drift if edits bypass the source. |
| (b) Public source of truth, private packs/saves | Shared fixes land once; public CI proves the ordinary no-pack experience | Premature until startup, identities, rules, tests and all dataset defaults are independent. Packs cannot repair code that still imports excluded files. |
| Staged (a) → (b), recommended | Keeps the private picker usable while proving the public tree, then removes routine export/mirroring work | Requires a definite cutover gate and ownership of shared changes during the transition. |

During (a), edit shared code in the private source tree only. Export from a pinned commit into a new staging directory using an explicit reviewed file allowlist plus deterministic, named sanitization steps. Deny unspecified paths and newly added files by default, including everything under `reference/`, `archive/`, `.local`, private research, captured fixtures and unreviewed `app/data`. Avoid whole-folder wildcards for mixed-source directories. Include only reviewed authored modules, public dataset/placeholders, synthetic tests, portable tooling and generic docs/licence notices.

Generalize defaults/configuration in the source code through the seam; use explicit fresh public docs and fixture sources. Do not rely on a growing collection of search-and-replace exceptions to scrub gameplay modules. Maintain a record of each included path and its source digest, generated public commit's private source commit, export rules version, public dataset version and scan/test results. Keep the private mapping receipt out of public artifacts if it identifies private context.

Create the first public repository with fresh history and a chosen public author identity. Stage only the verified public tree; do not copy `.git`, tags, private remote configuration, notes, ignored files or the old commit graph. Subsequent exports are reviewed ordinary commits to that public history, not fresh repository replacements or repeated history rewrites. Source ZIPs, release bundles, CI artifacts and screenshots pass the same checks as Git.

During (a), public issues/PRs are reviewed against the shared source. Apply approved shared patches to the private source branch, run public and private checks, then regenerate the public commit. Do not reverse-import a whole public tree over the private checkout. A public fix is complete only when the source patch and deterministic export agree; record the upstream PR/public commit association. Private fixes to shared behaviour follow that same export path. Pack/data/save changes stay private. A clean re-export must produce no unexplained diff.

Cut over to (b) after a clean public clone runs independently and that exact shared code passes private-pack parity. Shared improvements from Player 1's private deployment then become ordinary public-code patches with synthetic tests; private maintenance pulls the pinned public commits. Public fixes flow through public review/CI and private integration checks before she selects a deployment version. Keep any upstream-specific extractors/parity tools in the private research/tool repository, calling public interfaces rather than maintaining a second copy of the application. Freeze shared-code editing in the old private tree. A private emergency fix must be brought into the public source before the next routine deployment.

Use paired checks for the same shared revision: public CI with no private files, and local private integration with pinned packs. Compare resolved API/dataset contracts and export output in automation. Do not let "public" versus "private" branches carry alternate implementations of storage, auth, worker or task engines. Different providers/capabilities are expected; duplicated core code is drift. Keep old private history for audit and rollback, but never publish it.

## 5. Ordered, independently shippable milestones

Every milestone ships only after its private parity checks pass. Keep the existing operator selection and live server version until then. Failure leaves the previous deployed version and selected inputs usable. The checks below are future implementation requirements, not checks performed for this report.

| Order and deliverable | What Player 1 and Player 2 keep seeing | Verification before shipping |
| --- | --- | --- |
| **1. Art seam only**: copy current reachable art into a versioned local folder, bind the existing asset roots/routes to it, supply placeholders/grid when absent | Exact current art, map fallbacks, slots, icons and interiors with the pack installed; data/identity/rules/save pipeline unchanged | Verify file/manifest hashes and installed route bytes including both special PNGs, SVGs, world/background, partial/transparent terrain and unavailable interiors. Test missing/corrupt/partial art using fixtures, with repo-art fallback prohibited. Compare installed-pack desktop 1440 px and phone 390 px views, task text and map coordinates. Assert art absence changes no calculated access or save revision. |
| **2. Dataset, identity and rules seams with the existing provider selected**: encapsulate startup/default imports and worker/browser catalogues, package frozen legacy inputs and rule text | Same complete catalogue, exact IDs, rule wording/defaults, integrations and existing save | Private provider output/hash comparison, deterministic task/access/equipment/transport parity and command/Undo regressions. Verify no new migration/revision or save rewrite on current-save startup. Test missing/mismatched expected pack fails before storage preparation. |
| **3. No-pack independent game**: implement inventory step 2, small own dataset and fresh explanations, plain grid/placeholders in a separate fresh storage directory | Private profile remains selected and unchanged; public baseline runs separately | Remove private input paths physically from a disposable candidate, deny reads/imports to excluded paths, start server/worker, create a game, select/own a cell, complete an own/manual task, reload, Undo and share. Test viewer has no write controls and cannot write. Confirm all served modules/lazy routes are present and no original-service calls occur. |
| **4. Useful independent F2P batches**: rebuild source/identity/location joins and reviewed tasks, add provenance/licence scopes | All private data coverage and behaviour remain pinned; new public content is isolated | Independent dataset integrity, stable-ID, gate/source and coverage tests; generators read only approved independent inputs. Unknown entrances/resources remain unknown. Local dual-profile regression and public synthetic tests pass. Do not require 20,375-task public parity to ship a limited release. |
| **5. Public candidate export**: reviewed file allowlist, generic defaults/docs/fixtures, notices, scanner and fresh history | Current picker continues from its pinned private code/packs; nothing is published automatically | Clean export/re-export equality, leak-gate negative tests, binary/provenance review, quick suite and applicable full checks in the exported tree. Audit fresh staged files, commit metadata, remotes, artifacts and licences. Publication is a separate explicit action. |
| **6. Shadow deployment of the public core plus private packs**: use the exact public candidate code against authorized disposable storage | Existing hosted picker/invite links continue unchanged until acceptance | On a disposable save copy, compare read-only save hashes, task/result/command/History/Undo/backup parity and installed art. Test admin/member/viewer/revoked links, authenticated GET/HEAD/304 art and overlay access. One locked desktop/phone browser session validates representative workflows and layouts. Then preserve the actual storage/origin/credential configuration at deployment; do not regenerate invitations. Roll back code/selection if parity fails. |
| **7. Public repository becomes the shared-code source**: stop application mirroring and maintain local packs/private checks against it | Same deployment configuration, pack versions, art, data, saves and Player 2's access | Rebuild from a clean public clone with exact pinned packs; run paired public/private checks for that revision. Verify changes flow in both directions as patches to one source, private data cannot enter public artifacts, and the old application tree is no longer edited. |

Ship pack construction by copying and verifying inputs before changing selections or retiring tracked copies. Cleanup of excluded files in the private source tree can follow verified routes/providers; it must never be a prerequisite for keeping the live picker working. Retain previous immutable packs and backups. Keep the legacy data pack indefinitely if changing the duo catalogue would lose parity. A later opt-in move of their game to independent data would require its own migration design and command/Undo guarantees; this plan deliberately does not include one.

Future implementation tests should use cheap synthetic model/controller cases in quick and classify every new file in `scripts/test-selection.mjs`. Asset/server/private integration belongs in the appropriate full-only lane. Use targeted runs with `--test-timeout=120000`; heavy/full and browser runs use the shared locks. No browser or full-suite run is warranted by this documentation change.

## 6. Player 2's hosted access

Player 1's Node server reads local packs and serves approved image bytes to authenticated invitees at the same origin as the picker. The pack folder stays on her PC, but hosted images necessarily travel to Player 2's browser and may be cached there. "Private pack" means excluded from public Git/releases and controlled by the host; it cannot mean that guests never receive copies of displayed pictures.

Player 2 needs no installation, filesystem access, environment variables or pack download. Preserve his existing invite/session role, hosted origin, credential store and saved member identity through deployment. Artwork routes stay behind authentication; viewer links can read pictures but never gain commands/write controls. Keep private cache policy and avoid shared/CDN caching. Overlays should receive only the existing narrowly authorized payload/assets; do not expose a pack directory or unrestricted download endpoint through an overlay token.

An alternative where Player 2 runs his own server would require his own pack installation, compatible pinned versions and separately authorized acquisition/use. It would also introduce separate saves or a new synchronization problem. It offers no benefit to his current invited-browser workflow and is outside this plan. He cannot add server-side pack contents merely by uploading them from a browser.

The art-policy report treats hosted serving and distribution as separate permission questions from public source licensing. Preserve the current authorized private operation during engineering; do not describe hosting as cleared by this design. Any request to Jagex should expressly include invited hosted viewing, browser caching and the acquisition method, as well as any proposed pack redistribution. Do not send such a request as part of this docs-only job.

## 7. Public-export leak gate and other risks

### Prevent private data from reaching the public tree

The highest release risk is a public export that still contains private identities, gameplay, Source Chunk material or Jagex assets in a module, fixture, generated index, provenance field, screenshot or history. Removing `reference/` and images is insufficient. The readiness audit found repeated private strings and captures; the dependency inventory found copied labels/joins throughout runtime data and tests.

Use several independent checks:

1. Export only explicitly approved paths from a pinned source commit into a new directory. Reject unknown files, symlinks/reparse points, nested repositories and unexpected binaries. Do not traverse ignored folders or copy whole `app/data`, docs or tests trees. Each new allowed path needs provenance review.
2. Scan all candidate text, filenames, URLs, source maps, generated JSON and commit metadata for personal defaults, account/map/service bindings, machine paths, network identifiers, token formats and copied-source signatures. Inspect all binaries: approve authored images by digest/provenance and deny known private asset digests. Compressed archives are unpacked into bounded temporary storage and scanned or excluded. Screenshots need visual review; regex cannot establish their privacy.
3. Maintain a private HMAC-based fingerprint corpus for known private strings and distinctive copied passages, including normalized variants and lengths. Keep its key and digest/length list in ignored local release-check configuration, never public source. The scanner normalizes Unicode/case/path variants, tests candidate windows of the recorded lengths and compares HMAC-SHA-256 values. File/blob SHA-256 denylisting separately catches unchanged private data/art; substring fingerprints catch excerpts in otherwise authored files. Broad pattern checks catch new values not yet fingerprinted.
4. Add a release test that fails when a known private value reaches a staged candidate, **without storing that value in plain text in the test**. A local helper reads the authorized private source into memory, confirms its fingerprint, injects it into an in-memory candidate file/path/metadata entry, and asserts the same scanner rejects it. Test case/path variants and copied fragments too. Do not persist those values as new plaintext fixtures, logs or snapshots. Public CI tests the scanner and disk-export pipeline with invented sentinel values and runtime-generated digest fixtures; the real private-string test runs locally against the release scanner. Report finding categories and relative locations, never the matched value. A release without the private key/corpus/negative-test result is blocked, not reported clean.
5. Scan and test the actual staged/exported tree and artifact set, then create fresh public history. Review public author metadata, tags/remotes and staged licence/provenance boundaries. Record a private release receipt linking the exact artifact hashes to passed gates; publish only those artifacts. Never attach private save parity outputs, screenshots or pack manifests as CI artifacts.

Prefer HMAC to publishing unsalted hashes of short names, which are easy to guess. Known-value tests are regression checks, not proof that all private content is absent. The allowlist and independent provenance review remain necessary. A copied string and an ordinary independently evidenced place/item name can coincide; distinguish blocked private bindings/copied expression from permitted factual labels in a reviewed policy. Any exception is narrow, recorded and reviewed, not a global suppression.

### Remaining risks and decisions

| Risk | Mitigation / unresolved boundary |
| --- | --- |
| Existing save changes identity or effective rules when providers change | Frozen complete private dataset/contract, exact IDs and overlay order, pre-open binding, deterministic parity, no pack-install migration and no independent fallback into live storage. |
| Independent data quietly includes old selector/label joins | Review builder inputs and before-values, isolate generators from old files, inspect compiled dependency graphs and served payloads. Rebuild joins; do not relabel the current overlay "independent". |
| Placeholders hide missing information or become confusing | Exact item/slot/category names stay visible; preserve icon dimensions; accessible text/labels, short coverage wording and grid/unknown semantics. Verify desktop/phone views before implementation ships. |
| An art pack supplies mismatched geometry or changes access | Dataset/coordinate binding and hash-pinned indexes. Art cannot provide gameplay gates. Test transparent gaps, crops, floor transforms and map hit-testing separately. |
| Arbitrary-file access, active media or oversized pack | Explicit contained files, reparse-point refusal, type/dimension/size limits, inert reviewed SVG, no code/CSS/HTML and existing CSP/auth. No browser-controlled roots. |
| Hosting or crude imitation is mistaken for permission | Keep art-policy findings and separate licence scopes; document independent authorship. Written grants must cover acquisition, hosting and any redistribution before new release promises. |
| Public and private code drift or local fixes disappear | One shared source per stage, deterministic export receipts, patch return path, paired no-pack/private checks and a definite source-of-truth cutover. |
| Pack loss, failed update or rollback mismatch | Back up local immutable packs beside save backups under separate retention; pin selection receipts and prior core versions. Verify installation before changing the selected version. Do not ship packs inside ordinary public backup samples. |
| Startup becomes slow or memory-heavy | Keep manifests small, lazy-load large optional catalogues/tiles, reuse existing bounded caches and worker lifecycle. No bulk artwork decode/hash pass on every page view. |
| Rights/provenance of independent cache/Wiki inputs remain unsettled | Begin with own small content, publish reviewed batches only, keep source revisions/licence scopes and unresolved datasets private. Full members coverage and complete legal clearance are not prerequisites for the art seam. |

No art is created, data rewritten, code changed, real save copied, server/browser started or repository published by this report. Implementing the first art seam is the next bounded engineering job.

## Verification of this report

Read the four requested reports/docs and the canonical vault guidance; traced the local consumers and counted candidate icon uses with read-only Node scripts. No new test file is appropriate for a design-only document. `npm run test:quick` passed **1,221 tests in 122 files**, with zero failures, cancellations or skips, on Node **24.20.0**. `git diff --check` passed. Full suite and desktop 1440 px/phone 390 px screenshots are deliberately omitted for docs-only work. No server/browser or background helper was started. The only intended tracked change is this report.
