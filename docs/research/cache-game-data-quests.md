# Offline RS3 quests and achievements

The copied cache provides quest metadata and structured achievement definitions. This extraction produced **534 quest configs and 5,098 achievements with zero decoding errors**. The full datasets remain local; the [committed summary](cache-game-data-quests.2026-10-08.v1.json) contains counts, provenance, named samples, Wiki revision checks and quest metadata disagreements. Application data and behavior were not changed.

The run used the existing copied databases under `C:/Users/User/Projects/rs3-cache-work/cache-copy`, read-only SQLite, and the untouched [rsmv decoder commit a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). Schema build 950 is inferred, as in the earlier [walkability](cache-walkability.md), [membership](cache-membership.md) and [pins](cache-pins.md) reports. It is not an independently confirmed live client build.

## Source and field interpretation

| Data | Address | Extracted fields |
| --- | --- | --- |
| Quests | major 2, minor 35, ID = subfile | name, quest-list name, members opcode, quest points, difficulty, explicit skill/quest/QP requirements, progress varps/varbits, start coordinates, extra params |
| Achievements | major 57, groups of 128 | name, text and Ironman/GIM variants, RuneScore, categories, F2P flag, removed/hidden fields, skill arrays, previous/child achievement references, associated quest references, encoded varbit tests |
| Enums | major 17, groups of 256 | typed keys and values, including difficulty enum 2251 and length enum 13354 |
| Structs | major 22, groups of 32 | every extra param retained, with numeric/string values |
| Param definitions | major 2, minor 11 | encoded type and default value, without invented semantic names |
| Supporting quest UI | major 12, minor 4011 | byte evidence for the length interpretation |

The raw definitions accompany the normalized records. Unknown achievement type, Ironman and selector fields remain intact. `quest_ids` is reported as an **associated quest reference**, separately from `quest_req_for_miniquests`. Previous and child achievements stay separate. Varbit thresholds are **state conditions**; the extractor does not turn them into proven server requirements. A typed enum/struct reference alone is not a requirement. The support dataset retains all **16,755 enums, 53,501 structs and 9,498 param definitions** for further investigation.

Quest difficulty has an explicit named schema field. Enum 2251 maps its values to Novice, Intermediate, Experienced, Master, Grandmaster and Special; the named Wiki checks agree. Length remains an **inferred mapping**: quest extra param 7855, enum 13354. UI script 4011 contains `Length:` and adjacent constants 13354 and 7855, at byte offsets 5552 and 5565. The three quest Wiki samples below agree with that mapping. The script's obfuscated instructions were neither executed nor fully decompiled. The param's default is 4, but missing quest params remain null in the normalized export.

The constants identify major 67 as an internal-name database, but no `js5-67.jcache` exists in this snapshot. There was therefore no cache source for semantic extra-param names. The extraction does not guess that an integer is a level, item requirement or quest requirement from its magnitude.

## Coverage

| Measure | Count |
| --- | ---: |
| Quest configs | 534 |
| Nonempty quest-list entries | 365 |
| Quest-list entries without a discontinued flag | 356 |
| Quest configs with explicit skill requirements | 226 |
| Quest configs with explicit required quests | 234 |
| Quest configs with length param 7855 | 364 |
| Achievement definitions | 5,098 |
| Removed achievement definitions | 94 |
| Achievements with encoded skill arrays | 1,486 |
| Achievements with encoded state conditions | 4,208 |
| Schema errors | 0 |

These are config counts, including aliases, subquests, discontinued seasonal entries and removed achievements. They are not a claim about the number of quests or achievements playable in the current live game. Empty quest-list aliases remain available in the raw export but do not participate in quest metadata matching. All declared archives were present in the copied majors used here. The manifest records each whole-database hash and every read decompressed archive hash, decoder/schema hashes, inferred build and retained-reference hash.

## Complete retained-data comparison

The comparison reads the retained JSON used by `app/data/world.mjs` and the task modules. The current world adapter applies geographic corrections; it does not rewrite these quest and Diary challenge records. The comparison covers every retained Quest/Diary row, including rows suppressed by presentation. Cache display tags, Unicode apostrophes, case and whitespace are normalized for matching. No fuzzy matches or manually selected duplicate names are used.

| Retained surface | Result |
| --- | --- |
| 431 quest-index keys | 337 unique quest-list names, 58 achievement-only names, 1 ambiguous achievement-only name, 35 unmatched keys |
| 3,515 Quest task rows | 3,011 unique quest-list name matches; 504 unmatched |
| 428 rows with the QuestPoints completion marker | 338 have a unique quest-list match |
| Quest points on those 338 rows | 337 match; 1 differs |
| Membership on those 338 rows | 335 match; 3 differ |
| 2,650 Diary task rows | 2,446 unique achievement names; 188 unmatched; 16 ambiguous |
| RuneScore on unique matches with a retained score | 2,181 match; 162 differ |
| Descriptions on unique matches | 1,706 match; 740 differ after display-tag/whitespace normalization |

The quest index includes three literal separator keys (`break`, `break2`, `break3`), which are included in the exhaustive count. Many unmatched quest entries are miniquests, sagas, wishes or lore activities. Quest steps and whole completions are separate rows, so row counts must not be read as unique quests.

The membership disagreements are Beneath Scabaras' Sands and Princess and the Pauper (retained completion rows omit `Not F2P`; cache entries set members), and Benedict's World Tour (retained sets `Not F2P`; cache entry does not). The Kili's Knowledge completion row declares BaseQuest `Kindred Spirits` and 0 QP; the matched Kindred Spirits cache quest has 1 QP. This exposes a retained BaseQuest association for review, rather than a demonstrated error in the miniquest's reward. These are review findings, with no corrections applied. Description and score differences likewise need review; a matching name does not prove that the retained task represents the same variant, selector or completion tier.

The cache can supply metadata candidates for **338 whole-quest rows** and **2,446 achievement rows**. The count of demonstrated complete task replacements is **zero** for both domains. Quest paths and steps, exact accessible chunks, item gates, NPC/object interactions, server conditions, rewards and task dependency rules still require authored records or separate evidence. Direct skill and required-quest arrays are useful inputs but do not prove that every completion condition is represented.

## Wiki samples

The direct public Wiki API response was fetched on 2026-10-08 UTC and retained in scratch. The extractor parses the fields from these exact revisions; the committed summary records the evidence lines and field results. All **24 selected field checks across five pages passed**. These are sample checks, not a validation of every decoded record.

| Revision | Checked fields |
| --- | --- |
| [Cook's Assistant, 37199440](https://runescape.wiki/w/Special:PermanentLink/37199440) | ID 257, F2P, Novice, Short, 1 QP |
| [Gunnar's Ground, 37177980](https://runescape.wiki/w/Special:PermanentLink/37177980) | ID 341, F2P, Novice, Short to Medium, 5 QP, 5 Crafting |
| [Dragon Slayer, 37182736](https://runescape.wiki/w/Special:PermanentLink/37182736) | ID 66, F2P, Experienced, Long, 2 QP, 33-QP requirement |
| [Yoink!, 36635092](https://runescape.wiki/w/Special:PermanentLink/36635092) | ID 448, members, 5 RuneScore, 5 Thieving |
| [Lumbridge Strikes Back, 37179728](https://runescape.wiki/w/Special:PermanentLink/37179728) | ID 1248, members, 25 RuneScore |

## Reproduction and outputs

Run from this worktree, with a **new** output directory. The CLI refuses existing output filenames. It opens copied cache files only, checks the pinned decoder commit and rejects local decoder modifications.

```powershell
node scripts/cache/game-data-quests.mjs `
  --workspace C:/Users/User/Projects/rs3-cache-work `
  --output C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/NEW-VERSION `
  --wiki-snapshot C:/Users/User/Projects/rs3-cache-work/wiki-quest-validation-2026-10-08.json
node --test tests/cache-game-data-quests.test.mjs
```

`--wiki-snapshot` is optional for a cache-only rerun. The module exports `extractQuestsAchievements({workspace,output,build,wikiSnapshot})` for a combined importer.

The final domain run is `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/quests-achievements-2026-10-08-v2/`. Files:

- `quests.v1.json`: normalized and raw quest definitions.
- `achievements.v1.json`: normalized and raw achievement definitions.
- `quests-achievements.support.v1.json`: all typed enums, structs and params.
- `quests-achievements.comparison.v1.json`: every retained row and match/disagreement.
- `quests-achievements.summary.v1.json`: small counts, samples and Wiki checks.
- `quests-achievements.manifest.v1.json`: provenance and hashes; SHA-256 `d20f78210c0c15ac870d18bc55848ae61537c33baed899ff07411fef14bf8cf0`.

The isolated tests passed for alias exclusion, missing-param preservation, unresolved references, selector preservation, duplicate-name ambiguity and metadata disagreements. A separate verification of the serialized final files checked output hashes and recomputed record counts. No client was launched, cache original opened, live app contacted or runtime dataset changed.
