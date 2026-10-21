# Offline production definition extraction

The copied cache supplies **6,848 named item production candidates**, with an ingredient payload for **6,835**. These are useful evidence for product IDs, requirements and ingredient references. They are not a complete executable recipe catalogue. The exporter preserves grouped requirements, raw parameters and missing semantics instead of turning every numeric field into a playable action.

`scripts/cache/game-data-recipes.mjs` runs against the copied SQLite JS5 files and the untouched [rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15) interpreter. No app module imports its output. The original cache, running picker, client and selected assets are outside this workflow.

## Reproduce and inspect

```powershell
node scripts/cache/game-data-recipes.mjs --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/NEW-recipes-directory
node --test tests/cache-game-data-recipes.test.mjs
```

The command refuses existing output filenames. It uses `C:/Users/User/Projects/rs3-cache-work/cache-copy` and `rsmv` by default; `--workspace` selects another workspace containing those directories, and `--build` selects the schema build. The default **950 is an inferred decoder schema**, not independently verified client build identity. Whole copied-file hashes, decompressed archive hashes, index versions/timestamps, source schema hashes, transformed-interpreter hash and decoder commit are recorded in `recipes-manifest.v1.json`.

The final observed extraction is in `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/recipes-2026-10-08-v4/`. Its four files are:

- `recipes.cache-2026-10-08.v1.json`: candidates, requirement structs, raw XP and research fragments.
- `recipes-retained-comparison.2026-10-08.v1.json`: exact output/skill joins and input-name comparisons with retained challenge records.
- `recipes-clientscript-headers.2026-10-08.v1.json`: script headers and switch tables, without opcode interpretation.
- `recipes-manifest.v1.json`: provenance and hashes.

[cache-game-data-recipes.2026-10-08.v1.json](cache-game-data-recipes.2026-10-08.v1.json) contains the small inspected summary and nine sample records. Earlier v1–v3 directories are intermediate snapshots; v1 predates the shared helper's strict footer fix and its clientscript-header failures are superseded.

## What was decoded

All **63,798 items**, **53,501 structs**, **16,755 enums** and **9,498 params** decoded without errors. Items use major19 with 256 subfiles per group; structs use major22 with **32**; enums use major17 with 256; params use major2/archive11. IDs and source addresses retain these different packing rules.

The exporter decoded **104,223 interface components**, with four explicit failures: major3/archive105/subfile225; archive707/subfile15; archive1438/subfiles18 and19. A bounded text search found87 components mentioning ingredient, make-X, production or experience. This establishes available UI text and bindings, not server recipe execution. The pinned interface schema's documented build range is older than950, so those failed components remain unavailable.

All **21,115 clientscript headers** decoded without errors after strict footer validation. Full clientscript decoding is unavailable because the pinned reader requires a calibrated opcode map (`clientScriptDeob not set in args`). No calibration loader or external reference downloader ran. The absence of interpreted scripts is a decoder limitation, not evidence that production scripts do not exist. Internal-name major67 was absent from the original file inventory, so original parameter names could not be recovered.

The candidate inventory has **1,320 records with grouped requirements**, zero missing referenced structs, **118 records with repeated parameter IDs**, and13 with no ingredient payload. The raw parameter order is retained; normalized fields use the last encoded occurrence. Another **338 item fragments contain ingredient references without primary skill param2640**. All **477 ingredient-bearing structs** are preserved as research fragments, including structs without a known product association. Neither fragment class is counted as a resolved recipe.

## Parameter evidence and limits

| Parameters | Observed role | Confidence and remaining limit |
| --- | --- | --- |
| 2640–2644 / 2645–2649 | Requirement IDs and levels | Numeric IDs are joined through cache enum108, corroborated by familiar recipes. Non-skill/custom IDs remain unmapped. |
| 2650–2652 | Tools | Param definitions explicitly have type33, the pinned constants' object/item type. Tool-belt and consumption behavior remains unknown. |
| 2653 | Output quantity | Explicit value or param default1, retained with its origin. One item definition can miss other methods producing that same item. |
| 2655–2664 / 2665–2674 | Input items and encoded amounts | IDs have explicit object/item type33. Batch scaling and consumption units remain unverified. |
| 2675–2684 | Requirement struct references | Explicit struct type73; every referenced definition is retained. Grouped alternatives are kept separate from direct input slots. |
| 2686–2695 | Per-input flags | Raw values/defaults retained. Their arithmetic is not reconstructed without interpreted scripts. |
| 2696 / 2697 | XP skill and value | Raw integer retained. Only the nine individually checked records below receive normalized XP and an explicit unit. |

Enum 108 contains the production UI skill names: 11 Crafting, 14 Smithing, 16 Cooking, 19 Fletching, and the remaining skill families. It differs from the usual player-stat ordering in enum 680. Those numbering systems must not be interchanged. **2,725 candidates contain at least one unmapped requirement ID** (61, 62, 63, 64 or 67). Secondary requirement ID 62 on bronze dagger is one example; its accompanying 187 is retained without calling it a skill level or smithing progress requirement.

Bronze bar uses separate copper and tin requirement structs. Each contains inventory ore plus **Metal bank object** and **Ore box object** references and selectors. These storage proxies are not additional physical ingredients. Shortbow similarly has a bowstring requirement group containing ordinary, fungal and chima bowstrings. Treating every entry in either group as simultaneously consumed would create false requirements. The extractor retains the groups and their selectors, while their general execution logic remains unverified.

## Current Wiki spot checks

The normal web fetch was restricted; direct public Wiki API revision queries succeeded. The retained raw API responses are under `C:/Users/User/Projects/rs3-cache-work/recipes-wiki-validation.2026-10-08.v1.json` and `.v2.json`. The links below pin the exact revision checked; these are bounded recipe checks, not a Wiki-generated catalogue.

| Product | Cache skill/level | Encoded XP → checked value | Revision checked |
| --- | --- | --- | --- |
| Leather gloves (1059) | Crafting 1 | 138 → 13.8 displayed XP per pair | [37132088, 2026-07-30](https://runescape.wiki/w/Leather_gloves?oldid=37132088) |
| Shrimps (315) | Cooking 1 | 300 → 30 XP per successful cook | [36950896, 2026-03-02](https://runescape.wiki/w/Shrimps?oldid=36950896) |
| Bronze bar (2349) | Smithing 1 | 10 → 1 XP per normally smelted bar | [37012046, 2026-04-15](https://runescape.wiki/w/Bronze_bar?oldid=37012046) |
| Bronze dagger (1205) | Smithing 1 | 300 → 30 XP per completed item; 2 bronze bars | [37131007, 2026-07-30](https://runescape.wiki/w/Bronze_dagger?oldid=37131007) |
| Shortbow (unstrung) (50) | Fletching 1 | 50 → 5 XP per bow | [37136718, 2026-08-03](https://runescape.wiki/w/Shortbow_(unstrung)?oldid=37136718) |
| Oak shortbow (unstrung) (54) | Fletching 10 | 100 → 10 XP per bow | [37151141, 2026-08-10](https://runescape.wiki/w/Oak_shortbow_(unstrung)?oldid=37151141) |
| Shortbow (841) | Fletching 1 | 50 → 5 XP per stringing | [37198403, 2026-10-05](https://runescape.wiki/w/Shortbow?oldid=37198403) |
| Shaft (52) | Fletching 1 | 50 → 5 XP per normal log producing 15 shafts | [37171926, 2026-09-06](https://runescape.wiki/w/Shaft?oldid=37171926) |
| Headless shaft (53) | Fletching 1 | 10 → 1 XP per shaft; 15 XP for 15 | [37171921, 2026-09-06](https://runescape.wiki/w/Headless_shaft?oldid=37171921) |

Leather gloves demonstrate displayed rounding: the Wiki prose gives13.75, while its recipe infobox and cache give13.8. The exported number is therefore explicitly displayed rounded XP. Shaft and headless shaft both have output quantity15 but different XP units; multiplying every XP integer by output quantity would overcount shaft XP. Bronze dagger's30 XP is for the completed item, not every smithing strike. None of these facts supplies XP/hour.

## Coverage by skill

Counts include any mapped requirement skill, including secondary requirements, so columns are not disjoint. “Unmarked product” means only that the item lacks the members opcode. It does **not** mean the recipe is usable in F2P; members ingredients, facilities, progression, trials and method-specific restrictions still need evidence.

| Skill | Candidates | Unmarked product | Ingredient payload | Raw XP present | Normalized XP checked |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crafting | 1247 | 391 | 1241 | 1174 | 1 |
| Smithing | 1503 | 838 | 1503 | 1489 | 2 |
| Fletching | 449 | 186 | 449 | 444 | 5 |
| Cooking | 424 | 104 | 422 | 365 | 1 |
| Runecrafting | 220 | 75 | 220 | 185 | 0 |
| Magic | 180 | 13 | 180 | 174 | 0 |
| Firemaking | 52 | 14 | 52 | 51 | 0 |
| Woodcutting | 5 | 1 | 4 | 4 | 0 |
| Prayer | 9 | 0 | 9 | 9 | 0 |
| Herblore | 462 | 74 | 460 | 438 | 0 |
| Construction | 737 | 180 | 737 | 99 | 0 |
| Farming | 376 | 320 | 375 | 373 | 0 |
| Summoning | 397 | 5 | 397 | 304 | 0 |
| Divination | 263 | 62 | 263 | 263 | 0 |
| Invention | 245 | 33 | 244 | 244 | 0 |
| Archaeology | 265 | 25 | 265 | 265 | 0 |
| Necromancy | 66 | 19 | 65 | 66 | 0 |
| Hunter | 32 | 1 | 32 | 3 | 0 |
| Slayer | 18 | 0 | 18 | 0 | 0 |
| Constitution | 23 | 2 | 23 | 23 | 0 |
| Agility | 1 | 0 | 1 | 1 | 0 |
| Thieving | 1 | 1 | 1 | 1 | 0 |
| Mining | 1 | 1 | 1 | 1 | 0 |
| Fishing | 1 | 1 | 1 | 1 | 0 |
| Dungeoneering | 1 | 1 | 1 | 1 | 0 |

Attack, Strength, Ranged and Defence have zero production candidates in this extraction. Small gathering-skill counts do not constitute gathering coverage: raw oak logs, for example, expose a Divination transmutation recipe, not tree-cutting XP. The familiar normal/oak/willow tree actions in the existing death-chunk catalogue remain independent. F2P low-level Archaeology, Construction and Necromancy likewise need activity-specific eligibility; neither item membership nor these totals proves it.

## Retained challenges and death-chunk fields

The retained `rs3-chunkpicker-chunkinfo-export.json` has4,424 challenge records with both output and item inputs. Exact case-insensitive output name plus skill joins find2,417;2,007 have no such join. Among matches,2,259 have agreeing levels across all candidates,153 disagree and5 have mixed candidate levels. **119 joins are ambiguous across several cache item definitions**. These are review candidates, not153 verified corrections: fish oil can have several fish-specific recipes but the item definition exposes one level; aggregate outputs such as “Soft leather armour” are not guessed into individual products.

| Skill | Retained output/input challenges | Cache output/skill match | All levels agree | All disagree | Mixed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crafting | 673 | 473 | 464 | 7 | 2 |
| Fletching | 305 | 282 | 267 | 13 | 2 |
| Smithing | 200 | 149 | 144 | 5 | 0 |
| Cooking | 371 | 258 | 254 | 3 | 1 |
| Runecrafting | 113 | 73 | 62 | 11 | 0 |
| Magic | 141 | 78 | 70 | 8 | 0 |
| Firemaking | 157 | 46 | 46 | 0 | 0 |
| Woodcutting | 10 | 2 | 2 | 0 | 0 |

Per-candidate input checks expand the retained `codeItems.itemsPlus` aliases and record overlapping names across direct inputs, requirement groups and tools. **1,991 matched challenges have a candidate overlapping every retained input token; 426 matched challenges have input-name gaps.** For Crafting the split is 439/34, Fletching 247/35, Smithing 111/38, Cooking 232/26, Runecrafting 64/9, Magic 61/17, Firemaking 46/0 and Woodcutting 2/0. These checks preserve every retained token and do not compare consumption amounts. For headless shafts, `ArrowShafts[+]*` includes Shaft and Grenwall spikes, while `Feather[+]*` overlaps several feather names in struct 14981. That overlap does not prove all retained alternatives or mark player supplies as present. The full comparison retains missing input names, authored objects/facilities and level evidence.

For `app/tasks/engine.mjs`, this evidence can inform product identity, explicit requirements, item/tool IDs and candidate `Level`/`Output`/`Items` mappings after authored alias and facility review. It cannot replace `Objects`, `Tasks`, `Chunks`, progression gates, output-family rules or source availability. `skillItems` is retained source/drop-table metadata, not a universal recipe input table. `app/data/world.mjs` owns territory; recipes have no tile locations. `app/tasks/rates.mjs` owns numeric drop probability; no drop rate follows from a recipe.

For `app/tasks/time-estimates.mjs`, **nine bounded XP values are checkable; zero duration, XP/hour or gathering-rate records are supplied**. The remaining 5,861 raw-XP candidates have unverified action/batch units, and 978 candidates have no explicit XP param. Cache quantities, even when correct, do not price ingredient gathering, banking, successful cooking probability, smithing strikes, batch handling or partner access. The current curated normal/oak/willow methods and their throughput assumptions remain necessary. No death-chunk estimate changes here.

Eight focused tests check grouped versus direct ingredients, batch XP differences, calibration mismatch handling, missing structs, param type errors, aggregate and ambiguous joins, duplicate extras, and alias-name evidence. The large output counts and nine sampled records above were observed in the copied cache, separately from those synthetic regression fixtures.
