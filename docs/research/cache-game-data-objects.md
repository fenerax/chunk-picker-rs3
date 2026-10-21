# Copied-cache object and transition inventory

This is a private advisory extraction from the copied cache, using rsmv [a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15) opcode interpreter and schemas. Build 950 is an inferred decoding schema, not an independently verified game client build. The importer reads copied JS5 indexes 16 (location definitions), 23 (worldmap identities and layouts), 5 (location placements and bridge terrain), 2/11 (typed params) and referenced index 22 structs. It does not open the original SQLite cache, invoke the game client, modify the picker, or apply a data migration.

`scripts/cache/game-data-objects.mjs` exports the complete decoded definition table, all decoded worldmap identities and raw paste layouts, source placements, exact translated display placements, candidate transitions, exhaustive surface-chunk name comparison, and a join against the earlier 1,415 door diagnostics. Large arrays stream to gzip JSON during archive scanning, with 256 KB text buffering and region progress flushes. Only compact comparison indexes and scoped review rows remain in memory. A streamed record reader avoids V8's single-string limit. Every file refuses overwrite.

```powershell
node --max-old-space-size=8192 scripts/cache/game-data-objects.mjs `
  --workspace C:/Users/User/Projects/rs3-cache-work `
  --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/NEW-objects-version

# Reuse raw definition/layout checkpoints; source archives are scanned again:
node --max-old-space-size=8192 scripts/cache/game-data-objects.mjs `
  --workspace C:/Users/User/Projects/rs3-cache-work `
  --input C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/objects-2026-10-08-v1 `
  --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/NEW-reprocessed-version

node --test tests/cache-game-data-objects.test.mjs
```

## Measured result

The completed snapshot is `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/objects-2026-10-08-v3`. The [compact review](cache-game-data-objects.2026-10-08.v1.json) copies the final manifest summary exactly, records output/source/decoder hashes, and binds `objects.manifest.v1.json` by SHA-256 `641043bf628f3d0ef1d9434d9acbe76688a7628015d17e866530ffd435bad99e`.

| Inventory | Count |
| --- | ---: |
| Location definitions / definition errors | 141,240 / 0 |
| Worldmap identities / plane layouts | 771 / 789 |
| Layout source regions / scanned regions, including diagnostic halo | 3,492 / 3,496 |
| Decoded source regions / region errors | 3,496 / 0 |
| Source placements / mapped display placements | 5,899,459 / 4,737,814 |
| Map 28 crop raw plane 0 / effective plane 0 placements | 625,367 / 629,291 |
| Mapped placements retaining conditional alternatives | 15,881 |
| Tree / mining-resource candidates | 11,852 / 2,652 |
| Facility / transition candidates | 6,058 / 22,659 |
| Picker crop addresses / decoded coverage / unknown coverage | 2,350 / 1,211 / 1,139 |

Category and type counts describe possible decoded placement definitions across maps and planes; they do not measure simultaneously active or accessible resources. Types overlap when conditional branches offer different possibilities. The compact summary decomposes 15 tree types (including generic unknown), 36 mining types (including generic unknown), and 17 facility categories. Examples include 17 acadia, 1,519 oak, 64 iron, 37 clay, 6 rune essence, 305 furnace, 820 bank, 308 altar, 641 anvil, 912 farming-patch, 212 spinning-wheel, 323 loom, 12 hunter-spot and 718 obelisk candidates. All 9,637 generic tree and 1,280 generic mining-resource entries keep unknown types. A raw or alternative definition has a cache member flag on 1,873,528 mapped placements; this is not a count of geographically member-only placements.

Map 719 Burthorpe Underground has a square paste from source region (35,70) to display region (1,1), a translation of (-2176,-4416) tiles. The sampled iron rocks at displayed (94,84), (100,82) and (106,84) match their explicit Wiki coordinates. Map 31 Misthalin Underground retains planes 0 through 3 where encoded. These separate worldmaps are not joined into a surface travel graph by assumed entrances.

Typed-param review decoded 9,498 param definitions without errors and found 63 object definitions with hints: 56 direct coordgrid values and 13 struct references. Referenced structs contained no typed coordinate hints. None of the definitions classified as transitions carried these hints. There are zero certified encoded transition destinations; hints on other objects remain explicitly unproven.

## Interpretation

Map 28 is the cache's `RuneScape Surface` identity. The mapper evaluates every encoded destination plane and each other worldmap with available square or 8×8 chunk pastes. A source placement can occur in several display copies. Display coordinates retain original source X/Y/plane, raw placement type/rotation, exact translation, paste kind/index, and the original layout record in the layouts dataset. No coordinate-bound heuristic replaces missing pastes. Conflicting paste mappings are errors retained in coverage, not silently ordered. The diagnostic halo supplement retains additional source anchors without inventing display pastes.

Java and padded NXT terrain supply the decoded bridge rule. Raw source plane and effective source plane are separate fields; the surface comparison uses effective displayed plane 0. Other planes remain in the full placement inventory. This is a renderer/collision convention reproduced offline, not a game-client movement test. Custom model offsets remain in `rawUse.extra`; their tile anchor remains the encoded source anchor.

Every raw morph selector, branch ID, absent-state sentinel and nested selector path is preserved. No branch is asserted active. Definition cycles or missing branches remain problems. Trees, mining resources, facilities and transitions are categories based on names/actions across raw and conditional definitions. The structured `classification` includes named tree/ore types and facility categories for banks, altars, furnaces, anvils, forges, cooking ranges/fires, spinning wheels, looms, farming patches, hunter spots, obelisks, water sources, workbenches, pottery, sawmills and tanning. Generic Tree/Rock names retain unknown types. Facility categories retain a candidate status, particularly generic patches or hunter-related names. They do not establish skill levels, products, XP, server spawns, harvestability or a player's state. The two cache member flags and member action strings remain separate client fields; absent flags do not prove geographical F2P access.

The reviewed location schema contains no interpreted transition destination or complete requirement field. Config-2/11 param definitions additionally identify typed coordgrid (type 22) values and struct references (type 73) in `raw.extra`. The importer inventories these throughout the object table, decodes referenced structs and retains their coordinates/params, and attaches hints from raw and alternative definitions to transition candidates. A typed coordinate is explicitly marked as a hint, not a proven destination. Transition destinations and requirements therefore remain null. Raw quest IDs are references/hints, not requirements that a player must complete. A staircase's `Climb-up` action does not establish the landing tile, and an `Open` action does not establish ungated passability. Wiki validations remain separate evidence; they are not automatically applied to route records.

## Retained comparison and replacement limits

The comparator indexes every mapped effective-plane-0 placement inside the picker crop by displayed chunk and normalized name. Normalization strips client HTML markup, retained wiki wrappers and asterisks, collapses whitespace and lowercases text; the original names remain in definitions/reference records. It compares this with every retained `Object` entry, aggregating section counts while retaining section addresses. Equal normalized names present in both snapshots establish a review correspondence. Cache-only and retained-only entries are candidates; they are never marked verified additions/deletions. Missing current layout/decoded coverage remains unknown. Conditional names count as possibilities and must not be added as simultaneous objects. Per-chunk inventory includes all 2,350 crop addresses, including empty decoded chunks and missing layout addresses.

The retained data has no comparable object numeric IDs or placement tile positions, so the report makes no rename pairings. `Shop` entries remain non-comparable because scenery does not establish proprietors or stock; `Spawn` entries remain non-comparable because the location payload does not establish server ground-item spawns. Cache object names can replace location inventory only after reference aliases, conditional state, section geometry and source-specific requirements are reconciled. The cache cannot replace shop stock, item spawns, recipes, drops, quest logic or bespoke task conditions from these fields.

The comparison contains 2,402 same-name review correspondences, 11,192 cache-only candidates, 964 retained-only candidates and 6,468 retained groups with unknown coverage. Its 3,981 addresses include all 2,350 crop addresses plus retained addresses outside the crop and interior/nonnumeric keys; unknown groups therefore do not all represent missing crop coverage. It separately preserves 576 Shop and 599 Spawn rows as non-comparable. The 2,402 correspondences represent 71.4% of the 3,366 covered retained normalized name/chunk groups, or 24.4% of all 9,834 retained groups. These are inventory-review estimates; zero automatic replacements are certified. Dynamic retained content such as Crashed star is not declared deleted when absent from this location snapshot.

All 1,415 earlier blocked-door diagnostics uniquely match a source placement after raw-plane filtering. The proposed review cohorts are 1,282 Open/Close action candidates requiring branch-clipping and independent server/access evidence, 9 conditional-state candidates requiring selector-state review, and 124 destination/server-rule candidates. No row grants passage: `apply:false`, null passability/destination/requirements, and zero certified openable doors. The next useful evidence is independent open/closed clipping and player-access proof for each proposed door, not an action-string shortcut.

## Independent RS3 Wiki validation

Built-in web search was blocked from opening the RS3 Wiki and returned some OSRS results. No OSRS result was used. Direct RS3 MediaWiki API requests succeeded; raw responses stay in scratch, with SHA-256 recorded in the local validation dataset. Revisions, URLs and selected fields are retained. The limited template parser checks infobox IDs/names/actions/member wording and up to six parseable explicit coordinate entries per page; nested templates can reduce the sample. Examine is commonly an implicit menu option absent from the cache action strings.

| RS3 Wiki page | Revision | Fields useful for review |
| --- | ---: | --- |
| [Acadia tree](https://runescape.wiki/w/Special:Redirect/revision/37166118) | 37166118 | IDs 109001/109003/109005/109007; Cut down; version/location membership differs; explicit surface placements. |
| [Iron rock](https://runescape.wiki/w/Special:Redirect/revision/37195299) | 37195299 | IDs 113038–113040, 113098–113100, 113158–113160; Mine/Prospect; map 719 underground coordinates. |
| [Furnace](https://runescape.wiki/w/Special:Redirect/revision/37196083) | 37196083 | Variant IDs, Smelt/metal-bank menu options, differing member variants. |
| [Lumbridge Castle trapdoor](https://runescape.wiki/w/Special:Redirect/revision/36789230) | 36789230 | ID 36687 at 3209/3216; Climb-down; leads to the cellar; onward Dorgesh-Kaan route has quest conditions. |
| [Champions' Guild](https://runescape.wiki/w/Special:Redirect/revision/37146518) | 37146518 | Surface guild entry requires 33 quest points; basement member restriction. |
| [Champions' Guild doors](https://runescape.wiki/w/Special:Redirect/revision/37065708) | 37065708 | Front 1805 at 3191/3363; side 134267/134268 at 3195/3357; both require 33 QP. June 2026 side-door hotfix explains why old generic-door identity is unsafe. |

The Champions' Guild is a concrete counterexample to treating `Open` as an unrestricted route. The Wiki's descriptive cellar destination is useful external evidence, but it does not encode a landing tile or prove every onward underground connection.

The bounded coordinate sample matches 19 of 20 entries: Acadia tree 5/5, Iron rock 6/6, Furnace 5/6, Lumbridge trapdoor 1/1 and Champions' Guild doors 2/2. Furnace ID 88261 at surface map 28, plane 0, (2514,2692) is unmatched and remains unresolved; this is not a verified removal. The guild page contributes requirement context and no coordinate checks.

## Verification and provenance

All 10 focused tests pass. They cover nested/absent/cyclic morph paths, category limitations, retained section aggregation and missing coverage, distant source/display diagnostic joins, raw-plane filtering, bridge projection, streamed Unicode/nested/escaped records, overwrite refusal, buffered flushes and destination failures without hanging. The adjacent `objects.manifest.v1.json` records five copied cache file hashes, 4,058 decompressed archive hashes, decoder/schema hashes, the retained reference hash, diagnostic hash and 10 generated file hashes. Reprocessed snapshots additionally retain hashes of their raw input files. A copied local cache is not guaranteed to be the latest live game snapshot.

The first attempt (`objects-2026-10-08-v1`) saved valid raw definition/layout checkpoints, then hit V8's single-string limit while serializing source placements. A partial `v2` streaming attempt was stopped after inspection of only its verified offline importer process; both partial directories remain preserved. The complete `v3` uses buffered streaming, reuses only raw definitions/layouts, and scans source location/terrain archives afresh. An independent audit redecoded and compared every reused definition (141,240), worldmap identity (771) and paste record (771) against the pinned copied cache. It passed, and the audit's index 16/23 source hashes equal the final manifest's hashes. The compact review retains the audit script, validation and manifest paths with SHA-256 values and exact outcome/counts. No terrain scan was reused from a failed attempt.
