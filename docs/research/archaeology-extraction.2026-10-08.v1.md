# Archaeology copied-cache extraction — 2026-10-08

The reference catalogue contains nine dig-site records, 149 excavatable-resource DB rows, 250 artefact DB records, 238 restoration candidates, 78 collections and 52 mysteries. The runtime is separately **off by default**. Its current 87 admitted surface placements are material caches; it does not infer active excavation hotspots from conditional scenery.

## Sources and reproduction

The extractor uses plain copied SQLite JS5 files in `C:/Users/User/Projects/rs3-cache-work/cache-copy` and untouched [rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). Build 950 is an inferred compatible decoder schema, not an independently verified live-game client build. No original client/cache files, private saves, live picker ports or network decoding loaders were used.

Prior object exports and mask bundles were copied without modification into `C:/Users/User/Projects/rs3-cache-work/archmaps-archaeology/objects-copy` and `masks-copy`. Their input hashes are checked against the prior export manifest and mandatory pinned mask manifest before any attachment. Raw research output, complete DB table schemas/rows and decompressed archive hashes are in `archmaps-archaeology/extraction-v6/`. The [machine-readable report](archaeology-extraction.2026-10-08.v1.json) records input identities, counts, gaps and bounded Wiki evidence.

```powershell
node scripts/cache/archaeology-wiki-samples.mjs C:/Users/User/Projects/rs3-cache-work/archmaps-archaeology/NEW-wiki-samples.json
node scripts/build-archaeology-catalogue.mjs --output C:/Users/User/Projects/rs3-cache-work/archmaps-archaeology/NEW-extraction --wiki C:/Users/User/Projects/rs3-cache-work/archmaps-archaeology/NEW-wiki-samples.json
node --test tests/cache-archaeology-catalogue.test.mjs tests/cache-archaeology-application.test.mjs tests/preview-archaeology.test.mjs
node scripts/preview-archaeology.mjs --state C:/path/to/copied/state.json --json
```

Research output filenames refuse overwrite. Runtime text hashes use `scripts/lib/provenance-hash.mjs` and LF normalization. Manifests use the inherited object-export timestamp, explicitly labelled as source provenance rather than extraction wall-clock time; relative output filenames allow deterministic regenerations into different new directories.

Two final regenerations (v6/v7) produced byte-identical runtime catalogues: SHA-256 `2b703f6f029d22715d05dd9911d824c6c09dfe58ff7c3303429c2cd162799ad6`. All 15 focused catalogue/application/preview tests passed; copied-state CLI fixtures were synthetic and no personal save was previewed.

## Complete decode inventory

| Table | Decoded | Packing |
| --- | ---: | --- |
| Items | 63,798 | Major 19, 256 subfiles/group |
| Structs | 53,501 | Major 22, 32 subfiles/group |
| Enums | 16,755 | Major 17, 256 subfiles/group |
| Params | 9,498 | Major 2/archive 11 |
| DB rows | 20,297 | Major 2/archive 41 |
| DB tables | 391 | Major 2/archive 40 |
| Achievements | 5,098 | Major 57, 128 subfiles/group |

All seven tables decoded with zero errors. Object definition/placement coverage comes from the pinned prior object export, rather than a second live cache read.

Param **6659 is DBROW type 74**, not a struct reference. Excavatable scenery joins through that param to table 88. Table 88 column 15 holds item/encoded-weight tuples; column 17 holds artefact DBROW/encoded-weight tuples. Artefact table 89 columns 5/6 supply damaged/restored item identities. These typed links establish candidate yields, without interpreting encoded weights as a server drop rate, success chance or gathering duration.

Table 86 supplies nine main sites and 83 additional area rows, with level, manager NPC, requirement-struct and child-area/resource references. Table 82 supplies 14 collectors and their NPC IDs/locations. Its column 7 points to a table 83 collection log, whose column 7 points to table 84 collection rows; table 84 column 13 lists the collection's restored item IDs. Table 92 supplies 52 mysteries and typed site/lore links. Supporting research, researcher, lore and qualification rows are preserved as raw evidence.

The nine sites are Kharid-et 5, Infernal Source 20, Everlight 42, Senntisten 60, Stormguard Citadel 70, Daemonheim 73, Warforge 76, Orthen 90 and Moonrise 52. The [current Moonrise page](https://runescape.wiki/w/Moonrise_Dig_Site?oldid=37130897) supports the ninth site and its level/membership; the [Archaeology overview](https://runescape.wiki/w/Archaeology?oldid=37159329) still says eight in its prose. The catalogue preserves that source discrepancy.

## Field confidence and missing semantics

| Field family | Result | Boundary |
| --- | --- | --- |
| Resources | 104 hotspot rows; 45 material-cache rows; 47 distinct yielded material items | Includes tutorial, event, quest and one nameless DB row; not 149 ordinary repeatable activities. |
| Artefacts | 250 DB records; 248 distinct numeric damaged IDs and 249 restored IDs | Two records omit a damaged reference; 11 records use the same item in both columns. Null and missing references stay explicit. |
| Production/restoration | 265 Archaeology production definitions; 237 linked artefact restorations plus Balarak's sash brush = 238 restoration candidates | Remaining 27 are other Archaeology production candidates, including soil/storage proxies and equipment assembly. Grouped alternatives, quantities/flags and raw XP remain preserved. |
| Collections | 78 typed collections; maximum restoration level available for all 78 | Collector activity membership and collection flag semantics remain unknown. A maximum above 20 excludes full completion under the independently verified F2P skill cap; this is labelled inference, not a decoded membership flag. |
| Mysteries | 52 exact-name achievement joins; one direct cache Archaeology skill requirement | Leap of Faith supplies cache level 70. Breaking the Seal has no direct cache level here; its current Wiki requirement is separately recorded as 12. Other missing level/execution requirements remain unknown alongside retained Quest/Diary task evidence. |
| Membership | 11 resources independently checked as F2P and within cap 20 | Item membership, scenery flags and table 88's boolean candidate cannot certify activity access. Centurion remains defaults to boolean 1 despite its F2P tutorial; Tunnels barricade has boolean 0 despite level 83. |

Restoration requirements use production enum 108, where Archaeology is 28; achievements use player-stat skill 27. Those numbering systems are kept separate. Additional requirement ID 64 remains an unmapped/custom requirement; no certificate semantics are invented. Raw restoration XP is retained with explicit unverified units. This extraction adds no XP/hour or duration estimates.

For example, Venator object 117101 points to resource row 3254, level 5. Its material tuples are Third Age iron item 49460/weight 5000 and Zarosian insignia item 49514/weight 5000; its artefact rows point to damaged dagger 49921 and crossbow 49923. Restored dagger 49922's production definition requires damaged dagger ×1, Third Age iron ×16 and Zarosian insignia ×12. [Venator remains](https://runescape.wiki/w/Venator_remains?oldid=37118728) and [Venator dagger](https://runescape.wiki/w/Venator_dagger?oldid=36977123) corroborate this bounded identity/requirement sample.

F2P scope is the skill up to level 20, reviewed named activities and independent geographic/source gates. [Infernal Source](https://runescape.wiki/w/Infernal_Source_Dig_Site?oldid=37124842) is members-only despite its level 20 entry. [Zarosian I](https://runescape.wiki/w/Zarosian_I?oldid=36851412) needs restorations up to level 25; individual low-level donations do not establish full collection completion/reset eligibility.

## Placement application and retained comparison

The exporter scanned 4,737,814 mapped object placements. There are 716 placements of Archaeology candidate definitions across all maps/planes. Of these, 87 unconditional/equivalent-leaf placements attach to exact existing surface mask witnesses across 25 chunks. Four preserve multiple footprint component witnesses explicitly. The review ledger contains 561 outside-surface-scope records, 68 conditional/untyped records and those four multiple-witness records; multiple-witness review is not an additional exclusion count.

There are **zero excavation-hotspot grants** in the admitted runtime cohort. All 87 are material caches. Fourteen belong to independently Wiki-checked F2P classes: eight samite silk, three Third Age iron and three white oak placements. Geographic F2P component membership and retained source gates still apply. Underground, upper-plane, unsupported map and state-dependent resources remain research evidence.

Of the picker's 555 Archaeology tasks, 408 have exact object/output-name joins. Five tool-method levels are explicitly classified as supporting-facility comparisons, preventing false level corrections. The sole remaining level review is **triskelion material cache: retained 58, cache 52**. The [current Wiki revision](https://runescape.wiki/w/Material_cache_(triskelion)?oldid=37118968) explicitly has Archaeology level 52, corroborating the proposed metadata correction. This extractor does not rewrite existing tasks.

All 52 mystery names join retained Quest/Diary records. Exact collection name plus complete restored-item sets match 75 of 78 collections; Desperate for Artefacts, Guthixian I and Museum - Guthixian I remain review gaps. The full comparison preserves authored NPC selectors, gates, steps and restrictions rather than treating name/item overlap as executable replacement.

There are 245 retained Archaeology object-content rows. Twelve admitted placements lack a matching same-base retained declaration: white oak ×1 in 11830; orthenglass ×4 in 15685; felt ×4 in 14912; orgone ×3 across 15169/14913. Differences in section correspondence and unsupported interiors remain review evidence; missing cache placements do not prove retained declarations should be deleted.

`applyCacheArchaeology` composes after ordinary cache resources and publishes a separate `world.cacheArchaeology` model. It preserves original-section alternative routes, source gates, source backlogs, explicit blocking and existing resource provenance. Cache-only resources require their exact component; item/recipe/collection rows never create source grants or walking edges. `RS3_ARCHAEOLOGY_CONTENTS=game-data` enables this layer; absence of the variable leaves it off.

The copied-state preview holds current resource and metadata settings and the same walking topology on both sides. It reports contents, availability and owned source-chunk regressions. Selected and pending chunks supply contents only. Synthetic tests cover the reported behaviours, including default-off rollback, F2P unknown/member rejection and read-only CLI input inventory; they do not claim personal-save outcomes or observed in-game walking.
