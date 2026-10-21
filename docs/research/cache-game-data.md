# RS3 cache game data

This is an offline, advisory export of Player 1's copied cache. The extractors and reports are versioned on `codex/cachemine`; the full datasets are new files under `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data`. Application behaviour, the retained reference, the main checkout's tracked files and the picker on port 8788 were not changed.

The cache can replace substantial static metadata and supply precise object coordinates. It cannot establish current player state, server spawns, drop tables, ordinary shop stock, action throughput, or complete quest and transport gates. Those facts still need the Wiki or other independent evidence. All replacement counts below refer to reviewable fields or candidates, not complete task replacements.

## Provenance and reproduction

The source is `C:/Users/User/Projects/rs3-cache-work/cache-copy`, reused with the pristine [pinned rsmv commit a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). Schema build **950** is inferred compatibility, not a verified client build or a guarantee of live-game freshness. Added JS5 databases were obtained only by plain file copy. No original database was opened, no game client was touched, and no decoder dependencies or downloaders were run.

Each category manifest records copied database SHA-256 hashes and index timestamps; decompressed archive hashes, versions and subfile IDs; decoder commit and interpreter/schema hashes; the retained reference hash; and output hashes. The helper tightens footer bounds and consumption checks for script-header decoding and records the transformed interpreter hash. Full obfuscated clientscript semantics remain unavailable because the local opcode map is absent. The pinned calibration path would fetch reference caches, so it was not used. Filename database major 67 is absent from this snapshot, leaving extra-param semantic names unavailable.

The retained reference is `rs3-chunkpicker-chunkinfo-export.json`, SHA-256 `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`. Comparisons follow its use by `app/data/world.mjs`, `app/tasks/access.mjs`, the task engine, equipment evaluator and death-chunk estimator. Named interiors and authored section suffixes have different meanings from displayed cache regions and collision component labels.

```powershell
node scripts/import-rs3-game-data.mjs --workspace C:/Users/User/Projects/rs3-cache-work --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/NEW-BUNDLE
# A bounded rerun can use --category items,quests,recipes,places or objects.
npm test
```

The combined importer requires a new directory and runs the category CLIs sequentially. It does not select any output for the app. Domain reports document optional recorded Wiki snapshots and exact final output directories. `scripts/cache/verify-game-data.mjs` recomputes artifact and copied-source hashes; the committed compact reviews keep the large-file pointers and manual samples. The aggregate report checks every compact review's manifest hash, directory, counts and decoder provenance before joining them. Scoped LF attributes keep these new report and script byte hashes stable after Windows checkout.

The full suite passed **942/942** with `npm test -- --test-concurrency=1`, using isolated scratch TEMP/TMP directories. All **32 focused extraction tests** passed after the final writer/classification changes, and new scripts passed syntax checks. Two earlier full runs each exceeded an existing timing budget: a preference save took 5,217 ms against 5,000 ms, and task evaluation took 16,628 ms against 10,000 ms. The evaluation check also passed independently. No application code or timing thresholds were changed. The full successful log is `C:/Users/User/Projects/rs3-cache-work/npm-test-game-data-2026-10-08-v3.log`.

Final verification recomputed hashes and sizes for **all 27 output files (502,457,541 bytes)** and hashes for **11 copied source databases** across all five exports. The [aggregate index](cache-game-data.2026-10-08.v1.json) binds each compact review to its exact verified manifest and records all final local directories. The verification record is `C:/Users/User/Projects/rs3-cache-work/verification-game-data-2026-10-08-v1.json`. Superseded or incomplete object runs remain separate local directories and are not referenced as final data.

## World objects and resources

[The object report](cache-game-data-objects.md) and [versioned review](cache-game-data-objects.2026-10-08.v1.json) cover map 28 plane 0 first, upper planes and encoded underground layouts. Exact square and 8×8 pastes preserve original source coordinates, displayed coordinates, raw plane, bridge-effective plane, rotation and placement identity. Definitions retain names, actions, separate membership flags, raw params and every conditional morph branch. No current branch is selected from unknown player variables.

The export decoded **141,240 definitions**, **5,899,459 source placements** and **4,737,814 displayed placements** across **771 maps and 789 plane layouts**, with zero errors in all 3,496 scanned source regions. The picker crop contains **629,291 effective-plane-0 placements**. Display copies and conditional names do not denote distinct simultaneously active game objects. Classification yields 11,852 tree, 2,652 mining-resource and 6,058 facility candidates across the mapped inventory.

The classification records named tree and ore types and facility candidates, including banks, altars, furnaces, anvils, ranges, spinning wheels, looms, farming patches, hunter spots, obelisks and workbenches. Generic names such as Tree or Rocks remain untyped. Name/action classification does not supply a resource's level, yield, depletion behaviour or server access requirements.

The complete per-chunk comparison aggregates retained top-level and section Object declarations, preserving coverage status and possible morph states. It lists cache-only and retained-only candidates; these are not proven game additions or removals. Retained shops and ground spawns are enumerated separately where static location placements cannot establish them. No defensible rename pairs exist because the retained declarations lack old object IDs and tile positions. The resource catalogue is the strongest candidate for replacing hand-entered static contents, after matching resource selectors to actual geometry.

Only **1,211 of 2,350 crop chunks** have decoded layout/source coverage. The comparison keeps 3,981 addresses, including retained addresses outside that crop. There are **2,402 same-name groups**, **11,192 cache-only candidates**, **964 retained-only candidates** in covered chunks and **6,468 retained groups with unknown coverage**. Matching names supply metadata candidates for 71.4% of covered retained groups, or 24.4% including uncovered groups. This is a field-matching estimate, not a validated replacement count. Six Wiki revisions yield **19 of 20 sampled coordinate matches**; Furnace ID 88261 at (2514,2692) remains an explicit unmatched sample. Definition variants and regional membership wording remain review evidence.

## Doors and other transitions

The same dataset inventories doors, gates, stairs, ladders, trapdoors, entrances, portals and other transition candidates. Positions and actions are available. Destination and requirement fields remain unknown where no interpreted cache field establishes them. Underground map layouts show where an interior's objects are displayed; they do not prove the entrance-to-interior server link. Coincident upstairs ladders likewise require a route witness.

The proposal joins the existing **1,415 conservatively blocked door/gate diagnostics** to source placements, retains conditional branches, and groups candidates for review. **No door is certified requirement-free solely from its name or Open action.** For example, the [Champions' Guild door, revision 37065708](https://runescape.wiki/w/Special:PermanentLink/37065708) has an Open action and a 33-QP gate. Its front and newer side-door definitions need separate evidence.

The full mapped inventory has **22,659 transition candidates**. All **1,415 blocked diagnostics match one source placement**: 1,282 have Open/Close actions requiring passability evidence, nine require conditional-state review and 124 require destination/server-rule review. The 63 definitions with typed coordinate or struct hints include zero transition definitions; no interpreted destination or requirement-free opening is certified.

Resolve these conservatively in a later task: establish each object's open-state clipping and complete independent requirements; supply reviewed `passableWhenOpen` evidence keyed by exact placement or definition; recompute the existing walking importer; inspect changed component portals and retained resource selectors. Represent plane/map transitions as explicit route records with destinations, return behaviour and gates. This task supplies the data and proposal and applies none of them.

## Items and equipment

[The item report](cache-game-data-items.md) records **63,798 definitions and 9,498 params**, with zero schema errors. Direct fields include ID, name, membership, slots, stackability, note/template links and value. Sparse stats and skill pairs are inferred and sample calibrated; unknown fields stay unknown. Derived ability damage, life points, tier, speed and complete server equipability are withheld where formulas or semantics are unverified.

Of **3,550 retained equipment rows**, **2,474 (69.7%)** have a unique exact equippable-name candidate, **896** are ambiguous and **180** are unmatched. **142 rows** have a consensus disagreement on comparable fields; **226** have at least one disagreeing candidate. The declared-item inventory has **9,169 names: 6,058 unique, 1,890 ambiguous and 1,221 unmatched**. Every candidate is retained rather than choosing a convenient variant.

All **3,550 equipment weights are missing** in the picker, and **zero** cache weights were established. Weight needs a separate source and variant handling. Eight fresh Wiki pages supplied 67 attempted checks: 58 matches, five variant-name differences, four unavailable fields and no numeric differences. Modern Rune platebody ID 45543 and legacy conversion stub 1127 demonstrate why joining by an old familiar ID or picking the first same-name row is unsafe. See [Rune platebody revision 37178499](https://runescape.wiki/w/Rune_platebody?oldid=37178499).

## Quests and achievements

[The quest report](cache-game-data-quests.md) records **534 quest configs**, including **365 nonempty quest-list entries**, and **5,098 achievements**, with zero schema errors. Explicit quest fields include name, membership, QP, difficulty and skill/quest/QP requirements. Length is an inferred param/enum mapping with supporting UI bytes and sample checks. Achievement text variants, scores, skill arrays, associated quest references, prerequisite references and varbit tests remain distinct fields.

There are metadata candidates for **338 of 428 whole-quest rows (79.0%)** and **2,446 of 2,650 Diary rows (92.3%)**. Quest QP agrees on 337/338 and membership on 335/338. The lone QP disagreement exposes Kili's Knowledge's retained BaseQuest association to Kindred Spirits, rather than proving its reward wrong. Achievement RuneScore differs on **162** uniquely matched scored rows; text differs on **740**. Some differences can reflect variants or stale text. Five fresh Wiki revisions supplied **24 matching field checks**, including [Gunnar's Ground](https://runescape.wiki/w/Special:PermanentLink/37177980) and [Dragon Slayer](https://runescape.wiki/w/Special:PermanentLink/37182736).

These definitions can replace matched metadata fields. Demonstrated complete quest or achievement task replacements are **zero**: authored steps, chunk access, item sources, rewards and unencoded server conditions remain necessary.

## Production and death-chunk estimates

[The recipe report](cache-game-data-recipes.md) records **6,848 named production candidates**, **6,835 ingredient payloads**, **1,320 grouped requirement records** and **5,870 raw XP fields**. Products, direct ingredients, alternative requirement groups, tools, primary skills and levels are preserved alongside raw params. **2,725 candidates** contain custom or unmapped requirement IDs; those are not presented as ordinary skill levels. Additional research fragments include 338 item payloads without a primary skill and 477 ingredient structs.

The retained comparison finds **2,417 output/skill joins among 4,424 tasks (54.6%)**. All known compared levels agree for 2,259, disagree for 153 and conflict across candidates for five; 119 joins are ambiguous. **1,991** overlap all retained input names, which does not prove quantities or consumption rules.

Only **nine XP values** are normalized with individually validated units. Shaft production and headless shafts show the problem: a displayed XP value may describe a log action, an output item or a batch. [Shaft revision 37171926](https://runescape.wiki/w/Shaft?oldid=37171926) and [headless shaft revision 37171921](https://runescape.wiki/w/Headless_shaft?oldid=37171921) support different units. The remaining raw fields remain available for calibration. The cache cannot replace XP/hour or gathering/processing time, failure rates, bank handling or supply acquisition estimates.

F2P skill families have substantial candidates: Smithing 1,503, Crafting 1,247, Fletching 449, Cooking 424, Runecrafting 220, Magic 180 and Firemaking 52. Product membership flags do not certify activity eligibility. The domain report includes every skill, trial skills and non-producing skill gaps. The initial death-chunk catalogue still needs validated per-action XP, duration and supply models before these recipes can produce hours.

Safe header decoding covers **21,115 clientscripts** with zero header errors. Interface decoding covers **104,223 components** with four explicit failures. Header inventories and production text hits preserve further research paths; they do not establish executable recipe semantics.

## Place names and travel

[The place report](cache-game-data-places.md) records **771 maps, 5,837 map elements and 2,742 explicit label placements**. Exact pastes accept 2,604 placements; surface plane 0 has **312 text labels in 262 regions**. Labels can help name regions but cannot replace section geometry or all retained nicknames.

Typed coordinate data includes **987 structs**, **180 with travel-related text**, and **147 enums**. **58 lodestone structs cover 29 distinct names**. All 28 retained surface lodestones have cache name matches; **25** project into the retained base region. **Anachronia projects to 15426 instead of retained 15683**, supported by the nearby [Wiki scenery anchor](https://runescape.wiki/w/Anachronia_lodestone?oldid=37122513). Ashdale and Prifddinas retain missing plane-0 projections. City of Um supplies an additional underground destination, with conflicting cache membership variants preserved.

Five selected lodestone membership checks agree with Wiki facts. City of Um's source coordinate and plane match exactly; the other four are adjacent landing/scenery anchors in the same region. These checks validate bounded metadata and projection observations, not personal teleport availability.

## Integration order

1. **Static resource and facility contents.** Build an ID-based cache catalogue and reviewed mapping to retained Object selectors. Preserve conditional states and exact component witnesses. This removes the largest reliance on hand-entered placement lists and improves source coverage without inventing server spawns.
2. **Quest and achievement metadata.** Join by verified identity and variant, then replace names, membership, points, descriptions and explicit requirement fields. Review the small quest disagreement set and score/text differences before removing authored fields.
3. **Item identity and comparable equipment fields.** Start with the 2,474 unique candidates; resolve variants and formula semantics before updating BiS inputs. Obtain weights separately from the Wiki, distinguishing worn and inventory variants. [The equipment integration report](cache-equipment-corrections.md) documents the implemented overlay, remaining disagreements and preview.
4. **Recipe inputs and levels, then bounded XP.** Use exact output/skill joins and keep alternative groups intact. Calibrate quantities and action/batch XP for the duo's F2P methods first. Fetch measured or documented throughput separately for death-chunk hours.
5. **Names and travel coordinates.** Use label anchors as naming suggestions, review Anachronia, and add City of Um only with its own activation/map policy. Preserve Ashdale/Prifddinas plane uncertainty and all personal gates.
6. **Transition connectivity.** Review the 1,415 blocked doors in evidence cohorts; integrate only certified openings and explicit server destinations. Keep this separate from resource metadata so a plausible door action never grants access by itself.

The compact reviews and full manifests are the review surface for that integration. No runtime import, access correction or application change is part of this commit.
