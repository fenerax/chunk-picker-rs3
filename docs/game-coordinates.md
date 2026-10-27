# Game and picker coordinates

The game reports map squares `(x, z)`, with decimal game ID `x * 256 + z`.
The selected world's picker IDs describe the map drawing. Four drawing blocks
need a translation. Game ID = picker ID + the shift below. Boxes are inclusive
**two-dimensional rectangles**, not numeric ID intervals.

| Area | Picker SW–NE | Game SW–NE | ID shift | Square shift `(x, z)` |
| --- | --- | --- | ---: | --- |
| Arc Islands | 14870–18212 | 7085–10427 | −7785 | (−31, +151) |
| Anachronia | 14655–16967 | 20512–22824 | +5857 | (+23, −31) |
| Havenhythe | 16176–17720 | 13332–14876 | −2844 | (−11, −28) |
| Lost Grove | 7471–7986 | 5206–5721 | −2265 | (−9, +39) |

## Evidence and limits

Checked against the existing archival export and `buildWorld` on 2026-10-27.
The proposed shifts came from third-party plugin notes supplied with the task;
they have **not been observed in game**. No export records or cache payloads
were added to implement them.

- The boxes contain 35 Arc, 67 Anachronia, 38 Havenhythe and 10 Lost Grove
  picker records after excluding nine unrelated Empyrean/Clan Citadel records
  in the Anachronia rectangle. The exclusions are explicit in the module.
- Anchors are 14878 (Waiko Western Docks), 15426 (Anachronia South-West Mine),
  16436 (Wendle's Wicks), and 7729 (Central Lost Grove). All lie in their boxes.
  The export does not establish that 15426 or 16436 contains a lodestone.
- The game boxes contain 32 Arc and 55 Anachronia legacy records, all at exact
  shifted picker positions and all unwalkable. Respectively 31 and 39 share
  at least one content key with their shifted picker counterpart, including
  the supplied Arc and Anachronia anchors. This corroborates the shifts without
  assuming duplicate records are identical.
- The Havenhythe and Lost Grove game boxes contain no archival picker records.
  Their membership and shift arithmetic check out; the export alone cannot
  independently establish their physical game positions.
- Havenhythe's game box intersects the normal surface crop at z 22–28. Exact
  shifted membership avoids claiming the rectangle's gaps. Cache enrichment
  adds 14 terrain-only records at shifted Havenhythe positions; these have no
  separate authored picker identity and resolve to the displaced records.

`tests/game-coords.private.test.mjs` checks the actual world, counts, exclusions,
duplicate-content evidence, round trips and cache-enriched world. Public unit
and controller tests use small synthetic fixtures.

## Membership and ambiguity

`app/core/game-coords.mjs` builds maps once from the selected world's existing
numeric, non-terrain-only records inside the explicit boxes, minus exclusions.
Only exact translated IDs enter the inverse map. Missing cells, records outside
the rectangles, and unrelated datasets retain identity.

A shifted record takes precedence over an unwalkable legacy alias outside the
surface crop, or a generated terrain-only record. If its destination is an
independent walkable or surface picker record, or two transforms claim the same
destination, translation is refused in both directions. The destination keeps
its identity; the displaced source remains unmapped, and the pair is exposed in
`coordinates.ambiguous`. Synthetic tests exercise these conflicts. The current
archival and cache-enriched worlds have no such ambiguous pairs. Legacy alias
IDs in existing saves are not migrated; incoming positions use canonical picker
records.

## Plugin protocol

The server keeps stored current chunks, task locations, ownership sets, eligible
pool IDs and selected/pending choices in **picker space**. The browser's position
list therefore also uses picker IDs. No save migration or plugin change is needed.

All chunk IDs sent on `/api/plugin/v1/*` use **game space**:

- Current status, task-response and partner IDs echo the actual reported game
  position. Names and states come from the corresponding picker record.
- `nearby[].chunkId` stays at its original game square; only its state and `by`
  ownership lookup use the translated picker ID. The row shape is unchanged.
- Pending-roll IDs translate on output, preserving any section suffix.
- Unlocked/available sets and eligible lists are not sent to Lua: they supply
  the current and nearby states. Their counts do not need translation. Task
  location IDs remain on the server, and `here` filters with the picker ID.

Read-only inspection of the current Lua plugin confirmed that `net.lua` indexes
nearby rows by `chunkId`; `shading.lua` divides those IDs by 256 and multiplies
coordinates by 64 for world geometry. `panel.lua` and `main.lua` compare status
IDs with the raw player game ID. Partner and pending-roll IDs are displayed as
text by `panel.lua` and `warning.lua`. Keeping game IDs throughout the wire
preserves all these consumers unchanged.

## Beta-world check still needed

Report a real position and check the picker marker, chunk name, current state,
nearby borders/partner colours, and Tasks here in each area. Candidate game IDs
are **21283** (Anachronia; maps to picker 15426), **13592** (Wendlewick area;
16436), **7349** (Waiko Marketplace; 15134), and **5464** (Central Lost Grove;
7729). These are calculations from the proposed shifts, not observed positions.
Waiko Western Docks 14878 would instead be game 7093. Confirm the actual
lodestone locations rather than treating the candidate labels as verification.
Also visit a Havenhythe edge/gap and ordinary Lumbridge 12850 / Nardah 13613.
