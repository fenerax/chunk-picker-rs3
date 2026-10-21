# Applied copied-cache surface pins

The worktree selects `pins.cache-2026-10-08-05932552f7af-v1.json` and its matching manifest before the 2021 pins. These are immutable copies of the private published bundle described in [cache-pins.md](cache-pins.md). The UTC export date is 8 October 2026; copied cache index timestamps span 24 September–2 October. The export date does not establish a newer game snapshot.

`loadMapAssets()` retains the terrain manifest and adapts the research bundle in memory. It preserves placement IDs, source coordinates/planes, exact surface translations, object identities, decoded element definitions, exclusions and conditional records. The existing game-to-canvas transform places Lumbridge bank at 3215/3257 in chunk 12850, logical pixel 2719/2701. Its current sprite is 22458, rather than the 2021 sprite 18952.

Only HTTP 404 for the selected cache pin file permits the existing 2021 pin path. A denied request, server error, malformed current dataset, missing current manifest or missing primary sprite frame stops optional asset loading; none silently substitutes old coordinates. Neither loading nor filtering writes group state or browser preferences. Cache placement IDs remain distinct from old IDs; no old hidden pin is heuristically matched to a new placement.

## Categories and artwork

Numeric categories are joined to the 2021 source's `unk_19` values only when their reviewed sprite category is unambiguous. Exact reviewed sprite identity wins over numeric fallback, including quest state and activated lodestones. Explicit disambiguations cover category 949's dungeon default and 2613's lodestone default. Current cache element definitions and object names additionally support the updated archaeologist's workbench and deposit-box aliases. Hunter training and D&D retain the already reviewed sprite identities. These joins are bounded to this bundle; an unfamiliar category or sprite stays in Other / unmapped.

All 2,994 exported placements remain: 2,683 symbols and 311 text-only map labels. There are 95 nonempty named categories. Other holds 293 symbols across 39 primary sprite IDs, plus the 311 labels. Unmapped symbols still render their exact cache sprite rather than borrowing another category's artwork. Text records render their supplied map text and remain searchable. At dense intermediate zoom, symbols take priority over ordinary text labels; focus and search retain their existing precedence.

| Existing legend group | Placements |
| --- | ---: |
| General | 275 |
| Transport | 333 |
| Skilling | 901 |
| Combat / Slayer | 217 |
| Quests / achievements | 612 |
| Minigames | 52 |
| Other / unmapped | 604 |

The copied sprite manifest contains 291 frame PNGs, including primary, background, hover and alternate artwork. The renderer uses each placement's primary frame and its full canvas dimensions/trim offsets. Retained hover, background and alternate metadata do not select player-specific icon states; no current varbit/varp values are available. Labels use a browser font rather than reconstructed game fonts.

## Water evidence and exclusions

**Zero additional current water pins were excluded.** The offline `pins-water-audit.v1.json` identifies 119 sprite-bearing records with decoded water-rendering presence; all have known clipping coverage and exact surface-paste provenance. The audit contains 73 fishing markers, 18 transportation markers, 11 shortcuts and 17 other records. Water presence or a blocked symbol anchor alone does not establish a misplaced facility.

Four water anchors are walkable. Of 115 blocked anchors, 113 include terrain/water clipping; two at 2512/3508 are blocked only by `OBJECT` mask 16. Those two represent separate dungeon/mining symbols, so treating them as blocked ocean would discard the object's evidence. Conditional quest symbols at 3683/2948 and 3712/3496 remain possible state records; the export does not assert that both states are active. Hunter and tree anchors merit future client comparison, but the local evidence does not prove that they are non-surface icons.

The suspicious old blocked-water bank at 3547/4262 and the old Clan Citadel pedestal/portal cluster identified in [the cache audit](cache-pins.md#water-rendering-review) do not occur among the current water records. Switching to exact current surface pastes removes reliance on those old coordinates without inventing destination remaps or blanket water exclusions. No further deletion is supported by the supplied evidence.

## Verification

The 25 focused application/filter/renderer tests pass, covering current bundle selection, missing-file-only fallback, preserved surface coordinates and source metadata, unmapped artwork, quest/lodestone category precedence, sprite trim anchoring, text labels, local-path rejection and existing filter/cache behavior. The 29 existing cache extraction/import tests also pass. Import tests write only isolated `.local/map-assets-import-tests/run-*` directories in this worktree.

The copied cache pin JSON and all 291 sprite PNGs independently match the published byte counts and SHA-256 hashes (292 files). The current pin JSON hash is `d2df6baec5107f17385059891d52332850581c3bdc5edd9d6d9d57a3cfaa98a4`. These checks use the actual supplied bundle, while automated behavioral tests use small synthetic fixtures. The parent owns full-suite, server and browser integration verification. No original game cache, main-checkout asset or live picker state was modified.
