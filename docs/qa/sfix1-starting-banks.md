# SFIX1 starting-bank seeds and Kharid-et membership

START: `e431da314b682946c27f601ec78f17eab8a790eb`.
Branch: `fix/sfix1-dead-starts`. Node: 24.21.0. Existing staged fixes retained.

## Final behavior and evidence

All coordinates and named evidence below are public repository evidence or Wiki
facts explicitly supplied by the orchestrator on 2026-11-01. Wiki revisions were
not fetched independently here; tile labels, movement and edges were checked
against the tracked masks and released runtime.

| Start | START eligible pool | Final eligible pool | Certificate / policy evidence |
| --- | ---: | ---: | --- |
| 12084 | 0 | 2 | `cache-selector-evidence.2026-10-07.v1.json`, record `12084-1`: unconditional bank chest 85341 at (3061,3339), complete walkable perimeter (3060,3339), (3060,3340), both component 1. High confidence. |
| 12854 | 0 | 3 | Same evidence file, record `12854-0`: chest 115427 at (3254,3498), perimeter (3254,3499), (3253,3498), both component 5. High confidence. |
| 11318 | 0 | 1 | Portal record `11318-6`, three independent Wiki pins and exact walking checks certify component 9. Medium confidence; no numeric post-quest return tile. Details below. |
| 13626 | 0 | 2 | Fremennik banker NPC 9710, Wiki revision 37142600, map 28 plane 0, at (3448,3720). Tile blocked; complete walkable cardinal perimeter is (3448,3719), (3449,3720), both label 7. North/west blocked; no label-6 witness. High confidence. |
| 13361 | 0 | 3 | Existing selector `13361-1` already maps to component 1. Authored `sectionF2p=true` settles its mixed geographic mask, citing Bank chest revision 37215299 and the single-tile analysis below. Four neighbors when `content.f2p=false`. Medium-high confidence. |

The first four use start-only certificates in `app/core/cache-surface.mjs`.
`startingSectionLocations` retains the existing section-1 seed and adds the
certified component only for the exact audited walking-source hash and an
existing runtime component. Whole ambiguous selectors remain unresolved;
resource projection and general teleport/landing correspondence are unchanged.
`app/core/state.mjs` uses that resolver when creating a start. Existing dead
saved starts are not silently migrated.

## White Wolf Mountain: accepted medium-confidence inference

The portal footprint is 3x3 at (2854,3461). Its south perimeter tiles
(2854,3460), (2855,3460), (2856,3460) are label 9. The other walkable perimeter
tile, (2856,3464), is label 10.

Component 10 is exactly one tile, with movement byte 0. No neighboring tile has
an incoming movement bit to it; it has neither incoming nor outgoing runtime
component edges, and the raw boundary-edge catalogue has no edge involving it.
It cannot be reached by walking from the accepted component. No component-10
transport station was found in the tracked catalogues.

All three supplied pins are label 9 and walk, using reciprocal decoded movement
bits, to all three southern perimeter witnesses:

- Violet is Blue, revision 37204107: (2855,3458).
- Violet, revision 37140601: (2855,3459).
- Violet is Blue Too, revision 37153083: (2854,3457).

Component 9 has 24 tiles and boundary edge `11317:15 <-> 11318:9`.
The certificate records the supplied Wiki URLs, confidence, isolation evidence
and limitation. The orchestrator explicitly accepts this inference; the Wiki
provides no numeric return tile after the quest. This does not certify the
whole retained selector or the competing isolated fragment.

## Kharid-et: the single members-marked tile

The mixed component has raw counts **2209 free / 1 members / 0 unknown**.
Decoding the geographic membership bytes and every component-1 tile identifies
the sole outlier as **(3351,3159)**, with movement byte **38**. It is the northeast
corner of the coarse members-marked block **x3344..3351 / y3152..3159**.

This is an exterior walking fringe, not a joined members enclosure: its north
(3351,3160), east (3352,3159) and northeast (3352,3160) exits all enter free-marked
component-1 tiles. South (3351,3158) and west (3350,3159) are blocked. Nearby
(3350,3156) is the separate component 2, with intervening blocked terrain.
The membership mask has 8x8 geographic resolution, not server-exact tile gates.
The bank chest 115427 at (3356,3198,0) is explicitly `mem=No` in the supplied
Bank chest revision 37215299. Together these support a geographic section
correction; no meaningful members area is joined to component 1 by this tile.

`app/data/map-corrections.mjs` adds a dated authored row through the existing
`sectionF2p` mechanism. The certified legacy correspondence maps section 1 only
to component `13361-1000001`, whose membership becomes `wiki-section` / free.
Raw cache counts stay intact. `world.componentMembership`, F2P walking, map
reachability and candidate filtering agree for every player. Component 2 gets
no override and still fails F2P eligibility; explicit section/component blocks
still apply. Intrinsic resource and task membership gates are not waived.
The row remains effective with the existing released provider as well as tracked
inputs; a provider's own authored section policy takes precedence if present.

## Comparison scope and counts

The documented `tools/calc-check/` checker is absent at START and here. The
`scripts/perf/starting-bank-pools.mjs` comparison runs against explicit checkout paths, never stale
`origin/main`. Each corpus repeats three times and compares entire canonical
pool results, including array order and reasons.

- **69-state bank corpus:** setup, task completion and ordinary manual unlock
  for all 23 reviewed banks. **13/69 results differ from START**. Eight are
  setup/completion at the four certified starts. A seed-only candidate isolates
  the membership policy's **5/69** differences: setup/completion at 13361 and
  setup/completion/manual unlock at 13105. The prior staged version differs
  from the final candidate in **9/69** results. No other results change.
- **Initial pools:** all five formerly empty starts now work; 13105 changes
  **3 -> 4** because Kharid-et becomes an eligible destination. The other 17
  starts are unchanged, including Mage Arena **3 -> 3**.
- **182-state membership-frontier corpus:** every component confirmation in
  13361 and its four geometric neighbors, in F2P and members modes, without a
  starting preference. Normal unsplit seeds remain active. **31/182** results
  change, all F2P (**31/91**); members-mode differences are **0/91**. These
  states exercise maps approaching the region as well as owning it. This is
  a focused sample, not an exhaustive claim about all possible game states.

Bank-corpus digests:

- START: `df05687926b204a831d8bccedab719d9967a9a418f26addcf9276b89a6b13e96`
- Final: `e09ac4a1f44d8c0c732e6461ac44a89ac36b8ba60779526c78dd44a72f09a53e`

## Private sample and measurements

The source was explicitly copied into `/tmp` before invoking the harness; each
trial opened a further disposable copy with the matching defaults and process
worker mode. The protected checkout was never opened as a writable store.

**8 states / 16 member pools / 3 repetitions: 4 pool differences from START.**
A separate seed-only run has **0/16** differences from START; final versus
seed-only has **4/16**, attributing all differences to the global authored
membership policy. Source and dataset hashes match across all three trials.
No saved start is reseeded by this change. No private contents, member names,
task text or chunk names are retained in this report.

Private result digests:

- START and seed-only: `70cfa6930c82a86cd9bb93bd7f1337ef708c55721e88ae83ddc25e278150df45`
- Final: `fa58b69493b49193c800058c91ae8a9fef0738cae4043d4197bdc774429c651e`

These are three-run pool-batch durations; spread is minimum–maximum. Main peak
RSS includes retained state graphs and excludes calculator child processes, so
it is not a calculator-only or process-tree footprint. No performance win is
claimed. Trials ran serially, before the quick suite.

| Corpus | START median (spread) | Final median (spread) | START / final main peak RSS |
| --- | --- | --- | --- |
| Released synthetic, 69 pools | 391.6 ms (388.0–392.2) | 331.0 ms (324.8–333.4) | 437,080,064 / 446,242,816 bytes |
| Membership frontier, 182 pools | 925.7 ms (918.2–952.1) | 1015.4 ms (1009.4–1045.3) | 514,605,056 / 509,153,280 bytes |
| Private sample, 16 pools | 8.28 s (7.76–10.49) | 8.45 s (8.07–14.46) | 3,450,109,952 / 3,457,921,024 bytes |


## Tests

The bank guard passes **23/23** under default rules on both tracked inputs and
the released provider. Its six additional evidence/guard tests also pass:
**29 passed / 0 failed** per provider. They cover complete cardinal witnesses,
all three Wiki-pin walking paths, fragment-10 isolation, stale/absent geometry,
whole-selector ambiguity, the membership outlier and real command/Undo behavior.
Without installed packs, the guard uses the tracked legacy provider.

Each touched or related file ran alone:

| File | Passed | Failed |
| --- | ---: | ---: |
| `setup-start-pool.test.mjs` | 29 | 0 |
| `cache-topology-application.test.mjs` | 12 | 0 |
| `map-corrections.test.mjs` | 74 | 0 |
| `setup-guide.test.mjs` | 11 | 0 |
| `state.test.mjs` | 59 | 0 |
| `browser-module-graph.test.mjs` | 1 | 0 |
| `test-selection.test.mjs` | 1 | 0 |
| `cache-selector-mapping.test.mjs` | 7 | 0 |
| `cache-task-access.test.mjs` | 18 | 0 |

The single `npm run test:quick` run for this continuation passed **2,981 tests /
0 failed / 68 existing skips**, across 320 files in **314.106 seconds**.

No full suite ran. The existing classification keeps the bank guard full-only;
no new test files were added in this continuation. All changes are staged for
review; no deployment or migration is included.

## Recommendation and limits

**MERGE-CANDIDATE.** All five starts have non-empty initial pools, the authored
membership change is consistent across normal maps, and every measured private
difference is attributed by the seed-only comparison. White Wolf Mountain's
medium-confidence inference remains explicitly documented, including the absent
numeric return tile. Existing saved starts are not automatically reseeded;
the membership policy itself applies immediately to all relevant F2P maps.
The full calculator checker is unavailable; focused comparisons cover the
requested states and local frontier, with full CI still pending.
