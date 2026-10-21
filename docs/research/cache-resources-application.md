# Applying cache resources to chunk contents

Static resource and facility contents now have a committed, ID-based catalogue and a reviewed selector mapping. `app/data/world.mjs` applies these after the existing walking topology. The retained reference JSON stays intact. NPCs, monsters, shops, ground spawns, quest steps and connections keep their existing source.

## Selection and access

The catalogue uses map 28 placements within the picker crop whose bridge-effective displayed plane is zero. Every row retains its object definition ID, exact display coordinates, raw/effective planes, rotation, original source coordinates/archive, stable placement ID and class. The compact schema documents its tuple columns. The original source ordinal is recovered by reproducing the pinned exporter's source-ID hash; tests reconstruct every admitted source ID from its tuple.

Definition names and relevant actions establish classes. Named tree and ore types have reviewed aliases, with evidence IDs. Qualified names retain separate classes: Eternal/Cursed magic trees cannot satisfy ordinary Magic tree selectors, Golden bamboo stays separate from Bamboo, and Perfect gold, concentrated deposits and Soft/Porcelain clay cannot satisfy ordinary ore selectors. Generic Tree and Rocks are untyped and do not supply new task yields. A generic-looking furnace with only Search or Look is excluded. Banks, deposits, specialized altars, workbenches and other facilities retain separate semantic classes. Explicit retained selector aliases preserve unmatched children for review rather than silently granting them. Catalogue display labels enter task collection only through complete reviewed mappings.

Conditional resources are accepted only when every encoded leaf is present and has the same class and rectangular footprint. Absent branches, changed resources, missing definitions and cycles remain review items. The decoder's default branch is not treated as proof of player state. Upper planes and underground maps remain retained: existing named connections do not establish an exact cache map/plane/landing correspondence.

The full walking tile masks identify components through an exact walkable anchor or the cardinal perimeter of the decoded, rotated footprint within its placement chunk. Every witnessed component is recorded; a resource bordering two components is indexed on each with the same placement ID. Raw source-plane checks prevent a ground object from attaching to an overlying bridge. Mapfix3's excluded regions and components are removed before attachment. This is spatial evidence, not proof of server interaction. Component attachment adds no travel edges.

A witnessed placement of the same reviewed class in the same chunk confirms an authored resource declaration, even when a conservative closed-door component or unsettled section correspondence separates it from the retained location. The merged resource is collectable when **its original chunk/section is accessible, with its gates, OR its witnessed component is reached**. Each retained section is an alternative route with its own source gates. Reviewed synonyms share source backlogs and gate checks. Explicitly blocked original selectors and F2P members-only restrictions still apply; blocking a walking component does not erase an independently accessible retained declaration. The retained route supplies only the confirmed resource: it never enters the indoor component or exposes unrelated cache-only contents.

Chunk info shows one merged entry per named resource with the game-data quantity, combining semantic classes identifying the same placement and deduplicating placement IDs shared by several components. The four retained Musa Point teaks and four cache teaks therefore appear as four, not eight. Provenance preserves the witnessed components and original source locations. Cache-only resources in unreached components remain unavailable and visible. In chunks admitted by the current member's access calculation, they show the subtle label **Behind a door or inaccessible**; locked or unconnected chunks and stale calculations receive no inferred access label. The label updates when the current member's task/access result refreshes. Unconfirmed declarations remain in their authored locations, visibly marked **Retained only**. Chunks without decoded coverage keep their retained contents unchanged. Cache-backed rows show a small **Game data** label. Absence from this cache is not a verified deletion.

Foundation commit `5d58d24` from `codex/rebuild-foundation` was merged in `296050b`. Conflicts in `.gitattributes`, `app/tasks/access.mjs` and `app/tasks/engine.mjs` preserve both the resource options and the foundation metadata/lodestone options. Supplying `lodestones` reapplies resources after rebuilding topology with the same `cacheResources`, `resourceCatalogue` and `resourceSelectors` options. The nested retained index receives `cacheResources: false, lodestones`. Metadata corrections remain enabled by default.

## Provenance and reproduction

The source is the verified `objects-2026-10-08-v3` export under `.local/game-data`. The runtime catalogue records the manifest/input SHA-256 values, relevant decompressed archive hashes and source database hashes, decoder commit **a92b8920b9b9842adde78822646ecad1a6f4fc15**, schema/interpreter hashes, retained-reference hash, walking/selector-evidence hashes and generator hashes. Build **950** is inferred schema compatibility, not a verified live-game build or freshness claim.

```powershell
node scripts/build-resource-catalogue.mjs
node --test tests/cache-resources-catalogue.test.mjs tests/cache-resource-selectors-expanded.test.mjs tests/cache-resources-application.test.mjs tests/cache-resources-expanded-application.test.mjs tests/cache-resources-retained-access.test.mjs tests/cache-resources-server.test.mjs tests/chunk-resource-ui.test.mjs tests/preview-resource-contents.test.mjs tests/preview-source-loss.test.mjs
npm test -- --test-concurrency=1
```

The generator reads only the authorized versioned game-data exports and this worktree. Its default masks are the supplied `walkability-masks.cache-audit-2026-10-07-v4` copy. The walking mask SHA-256 is `d553ed49ce12254d197e82abe673279f3bb1ede5eb34098cf0376e68bd67fdf6`; manifest, membership and mapfix3 correction identities are also recorded and verified. `--masks` can select a matching versioned copy under `.local/game-data`. The generator writes the two committed catalogue/mapping files in this worktree. Runtime loading uses only committed files. Source data and saves are never modified.

## Preview and rollback

Copy `state.json` and its sibling `static/` folder to a review directory, then run:

```powershell
node scripts/preview-resource-contents.mjs --state C:/path/to/review/state.json
# Machine-readable output:
node scripts/preview-resource-contents.mjs --state C:/path/to/review/state.json --json
```

The preview prints each member's unlocked, selected and pending chunk changes: additions, removals, reclassifications and location/quantity changes. Reviewed single-class aliases share canonical identities, so `Oak` becoming `Oak tree` is a reclassification rather than a deletion. Original labels remain in the report. Task comparison reports availability gains/losses and changed source chunks/locations using canonical identities. It includes task-engine, collection and equipment rows. Presentation hiding and saved derived-row fallback are outside this comparison. Selected/pending contents do not grant task access before unlocking.

Each member also gets an explicit **Owned source chunk losses** report: a canonical task loses an originally usable source in one of that member's unlocked chunks, with no replacement source of any kind/name in the same chunk. Partner-owned, selected and pending chunks are excluded from this regression count. The JSON contains `regressions.sourceChunkLosses`, `regressions.availabilityChanges`, and counts for lost-source tasks, lost task/chunk pairs, availability gains and availability losses. Availability changes are listed independently even when source chunks do not change. Both comparison engines receive the same metadata corrections and lodestone options; programmatic fixtures can set `metadataCorrections: false`.

The reader requires an explicit copy, checks compressed sidecar references against their decompressed-content SHA-256, rejects live `.local/duo` paths and linked sidecar folders, and verifies input bytes remain unchanged after evaluation. It never opens the store or its lock/history machinery. Verification uses synthetic copied saves and fixtures; the private duo save has not been inspected.

Set **`RS3_RESOURCE_CONTENTS=retained`** before starting the server to restore retained-only contents, then restart. The worker and browser receive the same mode. Walking topology, saved gameplay and static source data are unaffected. Unset the variable (or use `game-data`) and restart to enable the catalogue again.

```powershell
$env:RS3_RESOURCE_CONTENTS = 'retained'
npm start
```

## Counts and remaining review

The supplied full walking masks extend the earlier sparse-witness application at `f8b9fb5`. The table compares that commit with the full-mask attachment at `660c035`; the catalogue and selector bytes are unchanged by the retained-access fix. No bounding-box, nearest-tile or sole-component guess supplies an attachment.

| Measure | Sparse witnesses (`f8b9fb5`) | Full masks (`660c035`) |
| --- | ---: | ---: |
| Crop chunks / decoded coverage / unchanged unknown coverage | 2,350 / 1,211 / 1,139 | 2,350 / 1,211 / 1,139 |
| Admitted static placements / placement-class rows | 9,691 / 9,692 | 9,846 / 9,847 |
| Definition IDs / semantic classes | 2,753 / 114 | 2,851 / 125 |
| Exact witnessed placements / unwitnessed review placements | 1,251 / 8,440 | 9,213 / 633 |
| Witnessed typed placements / witnessed untyped placements | 460 / 791 | 3,225 / 5,988 |
| Chunks with catalogue contents / chunks with typed contents | 78 / 67 | 363 / 306 |
| New component declarations / superseded authored declarations | 125 / 90 | 1,066 / 373 |
| Covered authored Object declarations still retained only | 3,522 | 3,239 |
| Reviewed selectors / unmapped selectors | 205 / 2,098 | 226 / 2,077 |
| Complete mappings / mappings with unmatched alias children | 196 / 9 | 217 / 9 |
| Excluded conditional placements / multiple-perimeter-component reviews | 586 / 138 | 610 / 1,034 |

The current application merges same-class retained declarations across their original locations:

| Measure | Before access fix (`660c035`) | After access fix |
| --- | ---: | ---: |
| Attached placements / affected catalogue chunks | 9,213 / 363 | 9,213 / 363 |
| Superseded authored Object declarations | 373 | 798 |
| Covered authored Object declarations still retained only | 3,239 | 2,814 |
| Merged retained/game-data chunk-class groups | — | 763 |
| Cache-only chunk-class groups | — | 420 |
| Full-world canonical groups added / removed | 395 / 0 | 406 / 0 |
| Full-world canonical groups reclassified / location-or-quantity changed | 878 / 787 | 867 / 776 |

The runtime `addedDeclarations` count is now **420 unique chunk/class groups**, rather than the previous **1,066 component declarations**. These measures are not interchangeable: several components can witness one placement, and one chunk can contain several retained sections declaring the same class. There are 1,183 chunk/class groups in total. The full-world canonical comparison covers the union of retained and generated chunk records; its added/removed/reclassified/changed categories overlap. It reports changes in 375 chunks and describes contents, not personal task gains.

Selector coverage is **226 of 2,303 inspected names (9.8%)**, up from 8.9%. The denominator includes every retained Object/task/item-source selector, including books, doors, dynamic sources, archaeology hotspots and other content outside the admitted classes. There are 21 new selector mappings and 15 corrected existing class lists, with no removed mappings. The mapping contains 131 exact name/action rows, 55 exact rows supplemented with reviewed tree/ore aliases, eight alias-only named-type rows, and 32 explicit retained alias expansions. Added evidence covers Fir, Blurite, Platinum, Havensilver, named Dungeoneering materials, cooking facilities, fishing holes and rabbit/jackalope burrows where their definitions qualify; some have no admitted surface placements.

The 2,077 unmapped names comprise 2,026 without an action-supported class, 26 generic tree/ore names, eight reviewed identity ambiguities, two ambiguous class matches and 15 empty aliases. The eight identity ambiguities are Chest, Counter, Treasure chest, Rowboat, Boulder, Pit, Young tree and Old fishing rod. Their opposing cache definition IDs are recorded in the mapping file. A Bank action confirms a Counter placement as a bank facility, but the generic retained Counter selector can also mean thieving scenery. Such catalogue rows remain visible without granting that selector's tasks. Generic Tree/Rocks remain unmapped without product/type evidence. The nine partial aliases retain unmatched children and are not emitted as whole catalogue sources.

The current full-world canonical comparison reports **406 added resource/facility groups, zero removed groups, 867 reclassified groups, and 776 groups with changed locations or quantities**, including visible untyped review groups. Confirmed declarations use cache quantities while retaining their original access routes. Missing cache names are not declared deleted.

Notable exact examples (component labels below use the cache namespace; runtime suffixes are `1000000 + label`):

- **Musa Point, 11569:** four teak placements, definition 9036, in component 1 at `(2895,3150)`, `(2895,3153)`, `(2897,3152)` and `(2898,3154)`.
- **North Al Kharid, 13106:** three acadias in component 2: 109003 at `(3304,3246)`, 109001 at `(3309,3247)` and 109005 at `(3310,3243)`.
- **Lumbridge, 12850:** the surface bank chest at `(3215,3257)`, furnace at `(3226,3256)`, anvil at `(3229,3254)` and forge at `(3229,3257)` attach to component 1. The retained bank-booth declaration is not confirmed by this surface catalogue and remains retained only.
- **South Draynor, 12338:** six Bank-action counters along `(3091,3240–3245)` border components 1 and 8. They display as `Bank facility (Counter)`; generic Counter task references remain unmapped.
- **Varrock, 12853:** six east-bank booths at `(3251–3256,3419)` border components 1 and 28. Three anvil placements remain distinct: `(3228,3436)` in component 1, `(3246,3404)` bordering 1/24/25, and `(3248,3404)` in 25. Component routes remain exact; confirmed retained declarations also preserve their original gated routes.
- **West Falador, 11828:** five bank booths border components 1 and 3; the furnace at `(2976,3368)` belongs to component 1. **East Falador, 12084:** six bank booths border 1 and 5, with eight ordinary anvils and two furnaces attached to component 1; burial facilities retain separate classes.

Musa Point teak and North Al Kharid acadia now merge with their authored section-1 declarations despite unsettled section correspondence: one game-data entry of four and three respectively, with both the original gated section route and exact component routes. These are cache/geometry observations, not confirmations of personal access.

Only **two static scenery fishing placements** are admitted and now attached: definition 132883 at `(3087,3224)` in South Draynor component 1, and 14939 at `(2321,3702)` in Mountain Camp component 2. They supply no inferred fish species or tool-specific fishing aliases. Ordinary NPC/server fishing spots remain retained. Eighteen rabbit burrows, six jackalope burrows and five Rockodile trap spots have exact witnesses and unambiguous definition names/actions. Generic Boulder/Young tree trap names remain identity reviews.

Remaining reviews include the 633 placements without an exact permitted witness, of which 30 have footprint-perimeter tiles beyond their placement chunk; the 610 conditional placements; unknown tree/ore types; unresolved authored sections; and upper-plane/underground entrance correspondence. All 1,034 multiple-component cases preserve every exact witness without creating travel edges. No farming patch survives the present-leaf class/footprint rule in this surface dataset: crop and patch morphs remain review evidence. Renderer defaults do not establish player state. Fifty-one global divine/portable/temporary/player resource templates remain excluded. No admitted placement attaches to a mapfix3 excluded region or component.

Two complete regenerations produced byte-identical catalogue and selector files. The catalogue is 4,846,325 bytes, SHA-256 `1e6a45cfe64af2cdfa20247e6bc28bedb5db77499b705b2d4266f4f12e76bbf0`; the selector file is 497,115 bytes, SHA-256 `632d7f7796d423ab0acaca0e0d329108ce2fec60ad2f8709f573785ca1fd16ef`.

Verification recomputes all 9,847 placement-class rows and 48,313 witness tiles against the full masks, and covers provenance/determinism, qualified material identities, mapping ambiguity, component access, source gates/backlogs, coverage fallback, rollback, chunk-info rendering and copied-save previews. Actual-catalogue integration tests verify witnessed free components under explicit synthetic entry overrides; they do not claim an observed personal walking route. Additional regressions cover original-section alternative gates, explicit source blocking, source backlogs, F2P members-only restrictions, cache-only indoor resources and resource/lodestone option propagation.

Synthetic closed-door fixtures mirror the reported shapes for **16692 Wendlewick**, **13117 Rogues' Castle**, **12849 East Lumbridge Swamp**, **16690 Dalia's Tree Nursery**, **12093 Pirates' Hideout**, **16436 Wendle's Wicks**, **11827** and **13880**. They use invented resource/task declarations and public component IDs, never private save contents. In particular they enter outdoor components 16692-1000002, 13117-1000001 and 12849-1000001/1000002 while leaving the fixture's indoor resource components unreached.

Evaluating the same ten synthetic tasks against pre-fix merge commit `296050b` and the corrected runtime gives:

| Fixture measure | Before access fix | After access fix |
| --- | ---: | ---: |
| Tasks losing an owned source chunk | 10 | 0 |
| Lost task/chunk pairs with no same-chunk replacement | 10 | 0 |
| Retained-only → game-data available task rows | 10 → 10 | 10 → 10 |
| Availability gains / losses | 0 / 0 | 0 / 0 |

The cache-only version of the fixture remains **0 → 0 available tasks** while its indoor resources remain visible in contents. The preview tests also cover source replacements with different kinds/names, ownership filtering, disappearance, independent availability changes and deduplicated quantities. The copied-state CLI test runs against the current default catalogue with a synthetic `state.json` and static sidecar, preserving input bytes and file inventory. Selected and pending chunks grant no task access. Claude must rerun the private-copy preview to obtain personal counts; no private state was read for this fix.

Test servers use ephemeral ports and synthetic temporary data; scratch TEMP/TMP stays in this worktree. No private save or picker on port 8788 was used. Existing task expectations remain unchanged. Resource-application expectations deliberately change from component-only sources and duplicate section/component displays to the merged quantity and retained-or-component rule described above.

The full **`npm test -- --test-concurrency=1` passed 1,114/1,114 tests** in 63.80 seconds, with zero failures or skips. This includes the merged foundation suite and 18 new access, preview and UI regression tests. The complete log is `.local/resource-tests/npm-test-resource-access-compatibility.log` in this worktree.

## Files changed

| Area | Files |
| --- | --- |
| Catalogue and selector evidence | `app/data/cache-resources.2026-10-08.v1.json`, `app/data/cache-resource-selectors.2026-10-08.v1.json` |
| Runtime application | `app/data/cache-resources.mjs`, `app/data/world.mjs`, `app/tasks/access.mjs`, `app/tasks/engine.mjs` |
| Serving and chunk info | `app/server.mjs`, `app/web/main.mjs`, `app/web/style.css` |
| Generation and preview | `scripts/build-resource-catalogue.mjs`, `scripts/cache/resource-catalogue.mjs`, `scripts/preview-resource-contents.mjs` |
| Tests | `tests/cache-resources-catalogue.test.mjs`, `tests/cache-resource-selectors-expanded.test.mjs`, `tests/cache-resources-application.test.mjs`, `tests/cache-resources-expanded-application.test.mjs`, `tests/cache-resources-retained-access.test.mjs`, `tests/cache-resources-server.test.mjs`, `tests/chunk-resource-ui.test.mjs`, `tests/preview-resource-contents.test.mjs`, `tests/preview-source-loss.test.mjs` |
| Documentation and stable bytes | This report and `.gitattributes` |
