# Surface place label export

The runtime [place-label dataset](../../app/data/place-labels.2026-10-13.v1.json) exports **312 text anchors in 262 surface chunks** from the existing read-only `places-2026-10-08-v3` extraction. It includes **28 region**, **58 town**, and **226 place** labels. These levels follow the cache font-size hierarchy, so `town` includes some mountains, swamps and other features. The extraction's [place-name review](cache-game-data-places.md) establishes the decoder and exact map-paste method.

The source is `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3/places.v1.json`, SHA-256 `dc88b9e37f0d638f9b63976bb358b76e7967e64e390d8310a12299abe8ce5312`. The exporter verifies its byte length and hash against the extraction manifest before writing. Runtime provenance retains both input-file hashes, the decoder commit and schema hashes, the relevant cache-file hashes, and the decompressed archive hashes for map elements, zones, pastes and surface placements. No fresh web fetch or cache decoding was needed.

## Text and position

Each label has `id`, `name`, `x`, `y`, `level`, `priority`, `mapId`, `plane`, `chunkId`, `elementId`, `fontSize`, `source`, `transform`, `conditional` and `conditions`. IDs retain the cache map, placement index and element identity. All names come from the resolved raw text definition, preserving `<br>` as a word boundary: `Draynor<br>Village` becomes `Draynor Village`, whereas the earlier advisory extraction concatenated those words.

`x` and `y` are **display tile coordinates** on map 28, plane 0. `source` retains original game tiles, and `transform` retains the exact paste translation. Amberfell's original anchor `(3729,1569)` translates by `(704,1792)` to display `(4433,3361)`. Anachronia and the Arc similarly retain their own translations. The picker crop is X `[1856,4864)`, Y `[1408,4608)`. Its continuous map grid is `(x-1856)/64, (4608-y)/64`, with north up.

| Name | Display X | Display Y | Cache level |
| --- | ---: | ---: | --- |
| Havenhythe | 4337 | 3311 | region |
| Wendlewick | 4185 | 3348 | town |
| Amberfell | 4433 | 3361 | town |
| Berylbrook | 4563 | 3348 | town |
| Heathervein | 4570 | 3470 | town |
| Shuruk-Ba | 4747 | 3396 | town |
| Fenmoor | 4625 | 3221 | town |
| Linbog Village | 4599 | 3255 | place |
| Globin Village | 4679 | 3178 | place |

These coordinates are cache label anchors. They can differ from bank positions or a settlement's named chunk in [members-start research](members-start.md), because a text label need not sit on its bank or town centre.

All nonempty surface text placements are exported, including eight labels with encoded conditions and repeated or alternative names such as Barbarian Village / Gunnarsgrunn. The renderer can resolve collisions by priority without asserting a player's varbit state. No labels are extrapolated from facilities, chunk nicknames or activity tasks. Labels establish neither geographic boundaries nor access, ownership, quest completion, gameplay travel or teleport destinations.

## Reproduction and validation

```powershell
node scripts/export-place-labels.mjs --input C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/places-2026-10-08-v3 --output NEW-PLACE-LABELS.json
node --test --test-timeout=120000 tests/place-label-data.test.mjs
```

The exporter refuses an existing output file and any output inside the source extraction directory. For this version, export metadata uses the fixed version date `2026-10-13`, while source freshness remains the October 8 extraction timestamp. Repeating the export from the same source produces identical JSON bytes. The focused tests check known anchors, text recovery, provenance, projection consistency, alternate labels, filtering, hash mismatch rejection, and source/output write boundaries. They use only committed runtime data and isolated synthetic input files; they do not require the external cache.
