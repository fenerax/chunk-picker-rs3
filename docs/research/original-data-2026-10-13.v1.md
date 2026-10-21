# Original picker data check — 2026-10-13

The current public original is byte-for-byte identical to our frozen September 28 copy. There are no upstream data changes to adopt.

Fetched read-only: One unauthenticated GET per known public data file; no retries, redirects, browser, logins or service writes.

- [rs3-chunkpicker-chunkinfo-export.json](https://source-chunk.github.io/chunk-picker-rs3/rs3-chunkpicker-chunkinfo-export.json): 10,176,005 bytes; fetched 2026-10-13T07:29:00.734Z; Last-Modified Mon, 28 Sep 2026 16:41:08 GMT; exact SHA-256 `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`.
- [tasksMap.json](https://source-chunk.github.io/chunk-picker-rs3/tasksMap.json): 6,252,216 bytes; fetched 2026-10-13T07:29:02.335Z; Last-Modified Mon, 28 Sep 2026 16:41:08 GMT; exact SHA-256 `721c8a9671566b8bef3b4985bc13a1248c54400b9304cd9ecc88b3184cdd780c`.

The retained upstream frontend fetches these two relative JSON URLs (`reference/original-picker/index.js:13034–13042`). The public repository is [source-chunk/chunk-picker-rs3](https://github.com/source-chunk/chunk-picker-rs3); retained source commit is `98a3bdc`. The original copy was the repository export plus its task-map seed, rather than a scheduled data feed. Our authored import pipeline is `scripts/updateTasksMap.js` and the runtime world/task adapters. No upstream executable code is adopted.

## Changes against the frozen copy

| Data | Frozen | Current | New | Removed | Changed |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tasks | 20375 | 20375 | 0 | 0 | 0 |
| Chunks and named areas | 2556 | 2556 | 0 | 0 | 0 |
| Items | 8299 | 8299 | 0 | 0 | 0 |
| Monsters | 1438 | 1438 | 0 | 0 | 0 |
| Shops | 471 | 471 | 0 | 0 | 0 |
| Quests | 431 | 431 | 0 | 0 | 0 |
| Skill outputs and methods | 1079 | 1079 | 0 | 0 | 0 |
| Legacy task labels | 92638 | 92638 | 0 | 0 | 0 |

Tasks are keyed by exact category and label. Chunks include named interiors. Item counts include equipment, spawns and named stock/drop/skill/table outputs (including upstream aliases); monster and shop counts include chunk declarations. Skill data counts method/output records. Views overlap: one drop change can affect both an item and a monster. Other tables and skill-related aliases/settings are checked below, so no top-level section is omitted.

All remaining sections are unchanged, including topology, walkable/F2P lists, aliases, diaries, clues and skill settings.

## Adoption and local data

Status: unchanged. Zero changes apply today. Kept the existing bytes and recorded a dated check instead of duplicating identical data.

Adopted entity-view rows: 0. Skipped entity-view rows: 0. Conflicts: 0.

| Local check | Targets | Result |
| --- | ---: | --- |
| Authored explicit task/entity identities | 0 | preserved |
| Retained task corrections | 5 | preserved |
| Metadata corrections | 728 | preserved |
| Skill guide combat corrections | 10 | preserved |
| Equipment corrections, weights and identities | 3305 | preserved |
| Archaeology corrections (including optional mode) | 1 | preserved |
| Reviewed shop stock (including optional mode) | 6 | preserved |
| Generated skill guide tasks and opt-in defaults | 4 | preserved |
| Map corrections and section policies | 66 | preserved |
| Local icons, guides, membership, training and cache files kept intact | 102 | preserved |

Historical root data, the archival seed, all retained item icon manifests/artwork, skill guides, reviewed corrections, membership evidence and cache/training additions are preserved. The JSON receipt pins the protected local data files. Optional correction/content switches keep their existing defaults. An unresolved conflict stops the whole adoption batch, because independently merging related requirements and sources can change task eligibility.


Runtime catalogue sizes are unchanged; warmstart needs no catalogue-size adjustment.

This check establishes public-file freshness on this date, not the completeness of the original author’s game catalogue. No Wiki/news fetch, player save, login, browser, live-service write or screenshot was needed.

See [the repeatable workflow](../original-data-updates.md).
