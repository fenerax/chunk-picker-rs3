# Copied RS3 cache walkability audit

This is an advisory audit of Player 1's copied local cache for map 28, plane 0. No rolling, access, authored corrections, selected map assets or live picker state were changed. Static cache collision can demonstrate an unobstructed tile connection; it cannot prove a closed gate will open for a particular player. Proposed changes below require review before application.

## Sources and reproducibility

The importer uses Node **24.19.0** built-in `node:sqlite`, zlib, hashing and TypeScript stripping. Git **2.55.0.windows.5** pinned [rsmv a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15) outside every repository at `C:/Users/User/Projects/rs3-cache-work/rsmv`. Only its reviewed opcode interpreter, constants and data schemas execute. Its npm scripts, dependency installers, renderer, Electron entry point, downloaders and game-client facilities are not invoked. External code is not vendored. Schema build **950** is an inference supported by exact decoding; it is not an independently verified client build number.

Only `js5-2`, `5`, `16`, `23`, `42` and `8` are opened, from `C:/Users/User/Projects/rs3-cache-work/cache-copy`. `js5-18` was also copied for NPC-schema investigation but is not needed by this export. The approximately 2.36 GB sprite database accounts for most copied bytes; only referenced sprite archives are decoded. The original `C:/ProgramData/Jagex/RuneScape` files were copied with filesystem reads and never opened with SQLite. Copies use read-only SQLite handles and `query_only`; symlink/real-path checks reject the original cache directory. Local index timestamps span 2026-09-24 to 2026-10-02. This snapshot is not guaranteed to match the latest live game.

Commands, run with the worktree as the current directory:

```powershell
$scratch = 'C:/Users/User/Projects/rs3-cache-work'
New-Item -ItemType Directory -Force "$scratch/cache-copy"
foreach ($major in 2,5,16,23,42,8,18) {
  Copy-Item -LiteralPath "C:/ProgramData/Jagex/RuneScape/js5-$major.jcache" -Destination "$scratch/cache-copy/"
}
git clone https://github.com/skillbert/rsmv.git "$scratch/rsmv"
git -C "$scratch/rsmv" checkout --detach a92b8920b9b9842adde78822646ecad1a6f4fc15
node --max-old-space-size=8192 scripts/import-rs3-cache.mjs `
  --cache-copy "$scratch/cache-copy" --tool "$scratch/rsmv" `
  --output "$scratch/outputs/NEW-VERSION" `
  --baseline "$scratch/pins-2021-baseline.json"
```

Use a new output directory for each run. `--baseline` is optional; its contents and SHA-256 are recorded. The baseline reconstruction is documented in [cache-pins.md](cache-pins.md). Optional `--openable-evidence` accepts a JSON array of `[locIdOrPlacementKey, {passableWhenOpen:true,evidence,conditions}]` pairs. Names and an `Open` action alone do not certify a door. Optional `--publish-new` writes new versioned pins, PNGs and a manifest only after all landmark validation checks pass, verifies output hashes, refuses existing names and leaves the selected assets untouched. The publication helper can also publish a completed output without decoding again:

```powershell
node --input-type=module -e "import {publishCacheAssets} from './scripts/cache/publish.mjs'; console.log(publishCacheAssets({output:'C:/Users/User/Projects/rs3-cache-work/outputs/NEW-VERSION',publish:'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets'}));"
```

## Collision interpretation

The crop is inclusive tile X 1856–4863, Y 1408–4607: 2,350 potential region addresses. Map 28's exact paste list establishes 1,211 surface regions from 1,153 source squares; the other 1,139 crop addresses have no surface placement and are reported as missing, never presumed blocked. All present surface regions decoded. Region IDs use `regionX*256+regionY`; modern cache archive addresses use `regionY*128+regionX`.

Terrain, walls and blocking object footprints are combined before component labelling. NXT interiors use their 66×66 padded storage; bridge flags select the effective surface plane. Object rotations, reciprocal wall masks, rotated footprints and nested morph alternatives are retained. Conservative clipping unions conditional branches rather than assuming favourable player variables. Blank/no-floor tiles are excluded. Water-rendering presence is recorded separately: water flag 16 alone can occur on unblocked shallow/shore tiles; terrain blocking bit 2 supplies terrain clipping. Unknown definitions or morph cycles exclude a conservative maximum-size footprint instead of silently admitting tiles.

Object anchors are evaluated in original source coordinates, including 325 extra neighbouring squares. A four-region west/south halo covers maximum 255×255 footprints; reciprocal east/north walls are included. Clipping projects into every displayed copy, including distant pastes. Display adjacency does not create a walking connection across a discontinuous source-space seam. Each accepted edge contains exact cardinal tile portals, the participating components and a witness. The reachability helper requires an explicit claimed-region set and cannot travel through an unclaimed region.

Components are scan-order labels, **not** the picker's hand-authored section IDs. A component's neighbour signature supplies possible section correspondences only. The picker's section records have no tile geometry, so unmatched signatures and tiny isolated fragments cannot safely be bulk-converted into authored sections. Four-direction components are conservative about diagonal-only movement. Cache collision does not establish transportation, upper-floor access, ladders, quest scripts, server clipping or player-specific gate conditions.

The diagnostic preserves 1,415 unverified door/gate placements and 7,034 conditional morph placements. No door-opening evidence was supplied. Missing static connections are therefore review candidates, not proof of inaccessible gameplay. Newly decoded tiles alone also do not satisfy Player 1's rule: a component must have an actual on-foot edge from an unlocked adjacent component.

## Membership

The cache does contain a geographic free-to-play mask: one bit per 8×8 tile block, one byte per local X band, least-significant bit south. It was calibrated against Wiki-backed Lumbridge, Canifis and Shantay Pass coordinates; reversed/transposed interpretations fail those probes. Components retain counts of free, members and unknown walkable tiles. This establishes coarse geography rather than an exact gate or section boundary. Object/NPC members-only interaction fields cannot classify their surrounding tiles. See [cache-membership.md](cache-membership.md) for the calibration, exact source fields and mixed-section limitations.

## Proposed changes, not applied

The exact high-confidence proposals below use the existing `correction()` signature. Define `cacheEvidence` alongside the existing `retained` constant and add the calls to `MAP_CORRECTIONS` if these changes are approved in a later task. Existing access and rolling code stays untouched in this task.

```js
const cacheEvidence = 'docs/research/cache-walkability.md';

correction('12592', 'f2p', true, false, cacheEvidence,
  'All 39 decoded walkable tiles are in members-marked cache blocks.',
  { confidence: 'high' });

correction('8495', 'walkable', false, true, cacheEvidence,
  '367 surface tiles form a component with a real edge to 8751.',
  { confidence: 'high' });
correction('8495', 'connections', undefined, ['8751'], cacheEvidence,
  'Decoded reciprocal edge to Lost Grove entrances; no water or transport crossing.',
  { section: '0', confidence: 'high' });
correction('8751', 'connections', ['9007'], ['9007', '8495'], cacheEvidence,
  'Retain the existing eastern connection and add the witnessed western coast edge.',
  { section: '0', confidence: 'high' });
```

For **12592 (Temple of Amascut)**, retain walkability and its dependency on 12848. The walkable fragment is in the eastern edge of 12592; the temple's named Wiki coordinate belongs to 12848. The current `f2p:true` value, rather than the existing walkable flag, is the clear disagreement. For **8495**, the proposal is supported by an edge witness, not merely a floor count. Preserve all existing corrections unless separately reviewed against component geometry.

Medium-confidence review: audit each witnessed missing connection involving defined regions, identify the relevant legacy section, and check any gate/player condition. Investigate coarse-membership discrepancies using the Wiki before changing F2P flags or mixed-section membership. Retain the authored Musa Point, Port Sarim, Crandor and fishing-platform splits while reviewing the components below. Havenhythe's mixed components prevent an automatic section-membership replacement.

Low-confidence/deferred: do not enable disconnected Penguin Island solely from its floor tiles; do not promote the record labelled Clan Citadel until its pasted surface identity is reconciled. Do not remove a walkable region merely because this closed plane-0 snapshot has no component. Missing paste coverage, openable gates, higher floors and stale names need separate evidence. Do not relocate ocean pins by guessed offsets or treat heuristic pin pairs as verified moves.

## Final export and disagreements

The following generated review tables and machine files list the complete comparison with the **effective** `buildWorld()` data, including current `map-corrections.mjs`. Counts are static-cache observations under the assumptions above, not an instruction to modify runtime behaviour.

<!-- Generated final review tables -->

Final source run: [manifest](C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/manifest.v1.json), generated 2026-10-08T00:12:25.604Z. It records per-database and per-archive hashes, decoder source hashes, inferred schema build, exact layout, baseline hash and validated landmarks.

The 310,565-byte [advisory region/component/edge file](../../app/data/cache-walkability.2026-10-07.v1.json) is committed but is not imported by application code. Its SHA-256 is `2a6acb3b9a2a45eac73cfb543f1d63d2d733310b2e03d5b2bf2f40fa7b41130e`. Full tile masks, exact portals, doors and uncertainty records remain in [walkability.v1.json.gz](C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/walkability.v1.json.gz). Per-component membership is in [membership.v1.json](C:/Users/User/Projects/rs3-cache-work/outputs/cache-audit-2026-10-07-v4/membership.v1.json).

The committed [complete picker comparison](cache-comparison.2026-10-07.v1.json) contains every region flag and edge disagreement plus all 1,061 provisional section correspondences. The [membership comparison](cache-membership-comparison.2026-10-07.v1.json) contains every policy comparison and unresolved section.

### Validation evidence

| Probe | Result | Observed evidence |
| --- | --- | --- |
| Lumbridge castle courtyard (3222,3218) | PASS | walkable component 12850:1 |
| Lumbridge river interior (3244,3223) | PASS | blocked mask 6; water=true |
| Port Sarim surface approach (3032,3247) | PASS | walkable component 12082:1 |
| Draynor surface approach (3076,3247) | PASS | walkable component 12338:1 |
| Draynor-Port Sarim northern road west (3033,3275) | PASS | walkable component 12083:1 |
| Draynor-Port Sarim northern road east (3076,3275) | PASS | walkable component 12339:1 |
| Varrock masonry wall reciprocal clipping | PASS | (3201,3400) east wall 4; (3202,3400) west wall 1 |
| Port Sarim-Draynor surface route around the inlet | PASS | claimed 12082, 12338, 12083; target 12338:1 reached |
| Draynor-Port Sarim northern road through two claimed regions | PASS | claimed 12083, 12339; target 12339:1 reached |

The initial route check incorrectly allowed only 12082 and 12338. The two approaches need 12083 to walk around the inlet: `12082:1 → 12083:1 → 12082:19 → 12338:1`. It was corrected after inspecting the exact water flags and object footprints, rather than allowing a crossing through water. The independent northern crossing has 44 clear tiles at Y3275, X3033–3076, and a real portal at 3071→3072. X3032/Y3275 is blocked by object 69615 and is deliberately not used. No character movement or client modification was performed.

An independent pass over the serialized final output checked all **28,783 accepted tile portals** for cardinal adjacency, correct component labels, reciprocal wall clearance and contiguous original source coordinates/plane offsets. It also checked every region mask's length and component tile totals, all membership totals, every manifest output hash, the committed compact-file hash, and every one of the 291 newly published PNG hashes and PNG framing. All checks passed. The final v4 data files reproduce v3 exactly after normalizing scratch sprite paths; only validation/provenance metadata changed.

### Counts and interpretation

| Measure | Count |
| --- | --- |
| Effective picker surface records | 660 |
| Effective picker walkable / F2P | 576 / 167 |
| Decoded surface regions / missing crop placements | 1211 / 1139 |
| Closed-scenario walkable tiles | 1,305,150 |
| Components / component-pair walking edges | 6,750 / 1,949 |
| unwalkableWithTiles | 3 |
| walkableWithoutTiles | 6 |
| unknownWalkable | 12 |
| undefinedWithTiles | 451 |
| missingRegionConnections | 143 |
| extraRegionConnections | 42 |
| nonWalkingDependencies | 8 |
| sectionCandidates | 1,061 |
| membership: f2pWithoutFreeWalkableTiles | 1 |
| membership: freeWalkableTilesOutsideF2p | 4 |
| membership: unknownRegionMembership | 88 |
| membership: sectionPolicyConflicts | 1 |
| membership: unresolvedSectionPolicies | 16 |

A missing surface paste is unknown coverage. A decoded region with no component is a closed plane-0 observation. Positive tiles in undefined records may be isolated fragments or unblocked rendered-water tiles, and are not automatic additions to the playable set. The 143 missing region-pair records below include undefined regions; section-specific changes need geometry and conditions. The 42 extra records include unknown coverage and closed/conditional routes; they are not automatic deletions.

### Requested named examples

| Region / nickname | Walkable tiles | Components | Free / members tiles | Actual adjacent region IDs |
| --- | --- | --- | --- | --- |
| 12592 Temple of Amascut | 39 | 1 | 0 / 39 | 12848 |
| 12080 Mudskipper Corner | 2 | 1 | 2 / 0 | 11824, 12081 |
| 11569 Musa Point | 1915 | 6 | 1915 / 0 | 11313, 11570, 11825 |
| 11314 South Crandor | 670 | 7 | 670 / 0 | 11313, 11315 |
| 11315 North Crandor | 1148 | 4 | 1148 / 0 | 11059, 11314 |
| 11059 Fishing Platform | 482 | 13 | 0 / 482 | 11315 |
| 11825 Port Sarim Church | 1437 | 10 | 1437 / 0 | 11569, 11824, 11826, 12081 |
| 17460 Bridge to Amberfell | 1500 | 6 | 425 / 1075 | 17204, 17459, 17461, 17716 |
| 17461 Waterfall Pathway | 1634 | 18 | 410 / 1224 | 17205, 17460, 17462, 17717 |

Temple 12592 has one 39-tile eastern-edge component, bounds X3194–3199/Y3076–3087, and five real portals to 12848. Mudskipper 12080 has only two tiles, (3008,3134)/(3008,3135), but valid links to 11824 and 12081: it qualifies under the one-tile rule. Musa Point has separate 1,820-tile island and 90-tile mainland components; their Port Sarim destinations differ. Port Sarim Church 11825 has a 179-tile island pier and 1,212-tile mainland component. Scan-order labels reverse the legacy section numbering there and must not replace it.

North Crandor’s 1,143-tile main component touches southern Crandor and two western fragments in 11059 (17 and eight tiles). Neither fragment connects inside 11059 to its 262-tile main fishing-platform component. The existing `11315 ← 11059-2` correction is supported; it does not grant a platform walking route. Havenhythe 17460 has 425 free/1,075 members tiles; 17461 has 410 free/1,224 members tiles. Its 140-tile component spans eight free and 132 members mask tiles, so retain authored mixed-section gates pending geometric review.

| Component | Tiles | Inclusive X/Y bounds | Free / members | Touching components (portal count) |
| --- | --- | --- | --- | --- |
| 12592:1 | 39 | 3194..3199 / 3076..3087 | 0 / 39 | 12848:1 (5) |
| 12080:1 | 2 | 3008..3008 / 3134..3135 | 2 / 0 | 11824:1 (2), 12081:1 (1) |
| 11569:1 | 1820 | 2880..2943 / 3137..3193 | 1820 / 0 | 11313:1 (39), 11825:1 (14) |
| 11569:2 | 1 | 2899..2899 / 3141..3141 | 1 / 0 | none |
| 11569:3 | 1 | 2911..2911 / 3178..3178 | 1 / 0 | none |
| 11569:4 | 1 | 2923..2923 / 3142..3142 | 1 / 0 | none |
| 11569:5 | 90 | 2935..2943 / 3186..3199 | 90 / 0 | 11570:1 (8), 11825:2 (6) |
| 11569:6 | 2 | 2937..2937 / 3155..3156 | 2 / 0 | none |
| 11314:1 | 561 | 2817..2859 / 3232..3263 | 561 / 0 | 11315:1 (8) |
| 11314:2 | 5 | 2827..2830 / 3200..3201 | 5 / 0 | 11313:1 (4) |
| 11314:3 | 1 | 2828..2828 / 3240..3240 | 1 / 0 | none |
| 11314:4 | 1 | 2830..2830 / 3263..3263 | 1 / 0 | 11315:1 (1) |
| 11314:5 | 30 | 2831..2837 / 3258..3263 | 30 / 0 | 11315:1 (5) |
| 11314:6 | 71 | 2837..2855 / 3200..3206 | 71 / 0 | 11313:6 (1), 11313:1 (7) |
| 11314:7 | 1 | 2841..2841 / 3244..3244 | 1 / 0 | none |
| 11315:1 | 1143 | 2816..2864 / 3264..3310 | 1143 / 0 | 11059:12 (10), 11059:13 (6), 11314:1 (8), 11314:4 (1), 11314:5 (5) |
| 11315:2 | 1 | 2836..2836 / 3290..3290 | 1 / 0 | none |
| 11315:3 | 1 | 2848..2848 / 3266..3266 | 1 / 0 | none |
| 11315:4 | 3 | 2851..2851 / 3287..3289 | 3 / 0 | none |
| 11059:1 | 262 | 2757..2794 / 3273..3291 | 0 / 262 | none |
| 11059:2 | 21 | 2761..2775 / 3286..3292 | 0 / 21 | none |
| 11059:3 | 18 | 2763..2767 / 3274..3277 | 0 / 18 | none |
| 11059:4 | 12 | 2763..2767 / 3286..3290 | 0 / 12 | none |
| 11059:5 | 39 | 2764..2775 / 3280..3283 | 0 / 39 | none |
| 11059:6 | 1 | 2768..2768 / 3272..3272 | 0 / 1 | none |
| 11059:7 | 44 | 2778..2787 / 3280..3284 | 0 / 44 | none |
| 11059:8 | 3 | 2789..2790 / 3317..3318 | 0 / 3 | none |
| 11059:9 | 55 | 2789..2801 / 3318..3325 | 0 / 55 | none |
| 11059:10 | 1 | 2797..2797 / 3313..3313 | 0 / 1 | none |
| 11059:11 | 1 | 2797..2797 / 3317..3317 | 0 / 1 | none |
| 11059:12 | 17 | 2814..2815 / 3265..3274 | 0 / 17 | 11315:1 (10) |
| 11059:13 | 8 | 2814..2815 / 3286..3291 | 0 / 8 | 11315:1 (6) |
| 11825:1 | 179 | 2944..2967 / 3137..3163 | 179 / 0 | 11569:1 (14) |
| 11825:2 | 1212 | 2944..3007 / 3136..3199 | 1212 / 0 | 11569:5 (6), 11824:1 (7), 11826:1 (53), 12081:1 (47) |
| 11825:3 | 1 | 2961..2961 / 3147..3147 | 1 / 0 | none |
| 11825:4 | 1 | 2968..2968 / 3196..3196 | 1 / 0 | none |
| 11825:5 | 1 | 2978..2978 / 3179..3179 | 1 / 0 | none |
| 11825:6 | 22 | 2994..3000 / 3175..3180 | 22 / 0 | none |
| 11825:7 | 3 | 2995..2996 / 3187..3188 | 3 / 0 | none |
| 11825:8 | 1 | 2999..2999 / 3143..3143 | 1 / 0 | none |
| 11825:9 | 16 | 3006..3007 / 3144..3153 | 16 / 0 | 12081:1 (3) |
| 11825:10 | 1 | 3007..3007 / 3141..3141 | 1 / 0 | none |
| 17460:1 | 399 | 4352..4373 / 3328..3353 | 399 / 0 | 17204:1 (17), 17204:3 (1), 17459:3 (21) |
| 17460:2 | 10 | 4352..4354 / 3372..3376 | 10 / 0 | 17204:1 (4) |
| 17460:3 | 16 | 4352..4357 / 3380..3382 | 16 / 0 | 17204:1 (3) |
| 17460:4 | 1070 | 4363..4415 / 3339..3391 | 0 / 1070 | 17461:7 (2), 17461:9 (18), 17716:2 (22) |
| 17460:5 | 1 | 4380..4380 / 3355..3355 | 0 / 1 | none |
| 17460:6 | 4 | 4413..4414 / 3353..3355 | 0 / 4 | none |
| 17461:1 | 295 | 4352..4368 / 3397..3455 | 295 / 0 | 17205:3 (5), 17462:2 (3) |
| 17461:2 | 30 | 4352..4357 / 3408..3417 | 30 / 0 | 17205:3 (8) |
| 17461:3 | 10 | 4352..4355 / 3420..3424 | 10 / 0 | 17205:3 (3) |
| 17461:4 | 41 | 4352..4356 / 3428..3444 | 41 / 0 | 17205:4 (17) |
| 17461:5 | 9 | 4358..4359 / 3445..3449 | 9 / 0 | none |
| 17461:6 | 17 | 4369..4372 / 3431..3436 | 17 / 0 | none |
| 17461:7 | 140 | 4374..4388 / 3392..3421 | 8 / 132 | 17460:4 (2) |
| 17461:8 | 684 | 4382..4415 / 3404..3452 | 0 / 684 | 17717:1 (26), 17717:2 (6) |
| 17461:9 | 366 | 4387..4415 / 3392..3410 | 0 / 366 | 17460:4 (18), 17717:1 (10) |
| 17461:10 | 31 | 4391..4399 / 3451..3455 | 0 / 31 | none |
| 17461:11 | 2 | 4395..4395 / 3428..3429 | 0 / 2 | none |
| 17461:12 | 1 | 4396..4396 / 3427..3427 | 0 / 1 | none |
| 17461:13 | 2 | 4401..4401 / 3452..3453 | 0 / 2 | none |
| 17461:14 | 2 | 4403..4404 / 3425..3425 | 0 / 2 | none |
| 17461:15 | 1 | 4409..4409 / 3441..3441 | 0 / 1 | none |
| 17461:16 | 1 | 4414..4414 / 3447..3447 | 0 / 1 | none |
| 17461:17 | 1 | 4415..4415 / 3448..3448 | 0 / 1 | none |
| 17461:18 | 1 | 4415..4415 / 3450..3450 | 0 / 1 | none |

### Marked unwalkable, with walkable tiles

| Region | Nickname | Status | Tiles | Components |
| --- | --- | --- | --- | --- |
| 8495 | South-west Tirannwn coast | decoded | 367 | 1 |
| 10301 | Penguin Island | decoded | 232 | 2 |
| 16191 | Clan Citadel | decoded | 1362 | 7 |

### Marked walkable, no closed surface tiles

| Region | Nickname | Status | Tiles | Components |
| --- | --- | --- | --- | --- |
| 9279 | Ungael Castle | decoded | 0 | 0 |
| 14660 | Dinosaur Farm North | decoded | 0 | 0 |
| 15428 | Crypt of Varanus | decoded | 0 | 0 |
| 15430 | Cannibal Jadinko Hunting Spot | decoded | 0 | 0 |
| 16454 | Observation Outpost | decoded | 0 | 0 |
| 16710 | Anachronia North-East Coast | decoded | 0 | 0 |

### Marked walkable, surface placement missing

| Region | Nickname | Status | Tiles | Components |
| --- | --- | --- | --- | --- |
| 7727 | Lost Grove Entrance | missing | 0 | 0 |
| 8244 | West coast Prifddinas | missing | 0 | 0 |
| 15943 | Anachronia Northern Totem | missing | 0 | 0 |
| 16199 | OBservation Outpost Pass | missing | 0 | 0 |
| 16455 | A Single Tile North of the Observation Outpost | missing | 0 | 0 |
| 16960 | Asuran Arsenal Entrance | missing | 0 | 0 |
| 16961 | South Anachronia Isle | missing | 0 | 0 |
| 16962 | Shadow Jadinko Hunting Spot | missing | 0 | 0 |
| 16963 | Kindra Counsil Meeting Pool | missing | 0 | 0 |
| 16964 | East Common Jadinko Hunting Spot | missing | 0 | 0 |
| 16965 | Anachronia North-East Isles | missing | 0 | 0 |
| 16966 | Anachronia North-East Corner | missing | 0 | 0 |

### Witnessed connections absent from effective topology

| Region pair | Both picker-defined? | Component pairs | Portals | Witness X/Y → X/Y |
| --- | --- | --- | --- | --- |
| 8495 ↔ 8751 | yes | 8495:1 ↔ 8751:1 | 26 | 2175/3044 → 2176/3044 |
| 8498 ↔ 8754 | yes | 8498:13 ↔ 8754:1, 8498:8 ↔ 8754:2, 8498:14 ↔ 8754:3, 8498:9 ↔ 8754:4, 8498:4 ↔ 8754:4, 8498:10 ↔ 8754:4, 8498:12 ↔ 8754:4 | 26 | 2175/3200 → 2176/3200 |
| 8504 ↔ 8505 | false/false | 8504:1 ↔ 8505:1 | 6 | 2170/3647 → 2170/3648 |
| 8504 ↔ 8760 | false/true | 8504:1 ↔ 8760:1 | 8 | 2175/3640 → 2176/3640 |
| 8505 ↔ 8506 | false/false | 8505:1 ↔ 8506:1 | 27 | 2149/3711 → 2149/3712 |
| 8506 ↔ 8762 | false/false | 8506:1 ↔ 8762:1 | 23 | 2175/3712 → 2176/3712 |
| 8762 ↔ 9018 | false/false | 8762:2 ↔ 9018:1 | 9 | 2239/3719 → 2240/3719 |
| 9009 ↔ 9265 | yes | 9009:67 ↔ 9265:1, 9009:70 ↔ 9265:2, 9009:71 ↔ 9265:4, 9009:37 ↔ 9265:5 | 10 | 2303/3158 → 2304/3158 |
| 9023 ↔ 9024 | false/false | 9023:1 ↔ 9024:1 | 14 | 2264/4095 → 2264/4096 |
| 9024 ↔ 9280 | false/false | 9024:1 ↔ 9280:1 | 23 | 2303/4119 → 2304/4119 |
| 9265 ↔ 9266 | yes | 9265:6 ↔ 9266:8 | 1 | 2306/3199 → 2306/3200 |
| 9515 ↔ 9516 | false/true | 9515:1 ↔ 9516:1 | 55 | 2372/2815 → 2372/2816 |
| 9515 ↔ 9771 | false/false | 9515:1 ↔ 9771:1 | 16 | 2431/2800 → 2432/2800 |
| 9520 ↔ 9776 | yes | 9520:14 ↔ 9776:2 | 1 | 2431/3122 → 2432/3122 |
| 9534 ↔ 9535 | false/false | 9534:1 ↔ 9535:1 | 18 | 2380/4031 → 2380/4032 |
| 9769 ↔ 10025 | yes | 9769:1 ↔ 10025:1 | 64 | 2495/2624 → 2496/2624 |
| 9771 ↔ 9772 | false/true | 9771:1 ↔ 9772:1 | 63 | 2432/2815 → 2432/2816 |
| 10046 ↔ 10302 | true/false | 10046:1 ↔ 10302:1 | 64 | 2559/3968 → 2560/3968 |
| 10047 ↔ 10303 | true/false | 10047:2 ↔ 10303:1 | 64 | 2559/4032 → 2560/4032 |
| 10279 ↔ 10280 | false/false | 10279:1 ↔ 10280:2 | 1 | 2611/2559 → 2611/2560 |
| 10279 ↔ 10535 | false/false | 10279:1 ↔ 10535:1 | 1 | 2623/2553 → 2624/2553 |
| 10293 ↔ 10549 | yes | 10293:2 ↔ 10549:1 | 5 | 2623/3393 → 2624/3393 |
| 10302 ↔ 10303 | false/false | 10302:1 ↔ 10303:1 | 64 | 2560/4031 → 2560/4032 |
| 10302 ↔ 10558 | false/true | 10302:1 ↔ 10558:1, 10302:1 ↔ 10558:2 | 60 | 2623/3968 → 2624/3968 |
| 10535 ↔ 10791 | false/false | 10535:4 ↔ 10791:1 | 1 | 2687/2547 → 2688/2547 |
| 10558 ↔ 10814 | yes | 10558:1 ↔ 10814:1, 10558:1 ↔ 10814:2 | 58 | 2687/3968 → 2688/3968 |
| 10814 ↔ 10815 | true/false | 10814:2 ↔ 10815:1, 10814:1 ↔ 10815:1 | 60 | 2688/4031 → 2688/4032 |
| 11062 ↔ 11063 | yes | 11062:4 ↔ 11063:1 | 2 | 2752/3519 → 2752/3520 |
| 11316 ↔ 11317 | yes | 11316:1 ↔ 11317:11 | 5 | 2839/3391 → 2839/3392 |
| 11574 ↔ 11830 | yes | 11574:4 ↔ 11830:1, 11574:5 ↔ 11830:1, 11574:6 ↔ 11830:1, 11574:7 ↔ 11830:1, 11574:8 ↔ 11830:1, 11574:10 ↔ 11830:1, 11574:11 ↔ 11830:2, 11574:12 ↔ 11830:2 | 26 | 2943/3456 → 2944/3456 |
| 11575 ↔ 11576 | yes | 11575:4 ↔ 11576:1, 11575:35 ↔ 11576:13 | 4 | 2880/3583 → 2880/3584 |
| 12328 ↔ 12584 | false/true | 12328:1 ↔ 12584:1 | 3 | 3135/2585 → 3136/2585 |
| 12331 ↔ 12332 | yes | 12331:12 ↔ 12332:2 | 2 | 3133/2815 → 3133/2816 |
| 12333 ↔ 12334 | true/false | 12333:2 ↔ 12334:1 | 64 | 3072/2943 → 3072/2944 |
| 12334 ↔ 12335 | false/true | 12334:1 ↔ 12335:1 | 64 | 3072/3007 → 3072/3008 |
| 12840 ↔ 13096 | true/false | 12840:1 ↔ 13096:1 | 11 | 3263/2591 → 3264/2591 |
| 13096 ↔ 13097 | false/true | 13096:2 ↔ 13097:5 | 9 | 3286/2623 → 3286/2624 |
| 13353 ↔ 13354 | false/true | 13353:1 ↔ 13354:1 | 29 | 3331/2687 → 3331/2688 |
| 13366 ↔ 13367 | yes | 13366:10 ↔ 13367:8 | 12 | 3380/3519 → 3380/3520 |
| 13367 ↔ 13623 | yes | 13367:8 ↔ 13623:1 | 6 | 3391/3520 → 3392/3520 |
| 13621 ↔ 13622 | yes | 13621:2 ↔ 13622:13, 13621:2 ↔ 13622:17, 13621:15 ↔ 13622:20, 13621:16 ↔ 13622:20 | 24 | 3418/3455 → 3418/3456 |
| 14133 ↔ 14389 | yes | 14133:31 ↔ 14389:1, 14133:33 ↔ 14389:2, 14133:29 ↔ 14389:3, 14133:29 ↔ 14389:4, 14133:30 ↔ 14389:6, 14133:35 ↔ 14389:8 | 7 | 3583/3392 → 3584/3392 |
| 14402 ↔ 14403 | false/false | 14402:1 ↔ 14403:1 | 14 | 3630/4287 → 3630/4288 |
| 14403 ↔ 14659 | false/true | 14403:1 ↔ 14659:1 | 8 | 3647/4288 → 3648/4288 |
| 14617 ↔ 14873 | false/false | 14617:1 ↔ 14873:1 | 1 | 3711/1650 → 3712/1650 |
| 14642 ↔ 14898 | yes | 14642:3 ↔ 14898:1 | 9 | 3711/3216 → 3712/3216 |
| 14658 ↔ 14659 | false/true | 14658:1 ↔ 14659:1, 14658:2 ↔ 14659:1 | 6 | 3655/4287 → 3655/4288 |
| 14893 ↔ 14894 | yes | 14893:2 ↔ 14894:1 | 2 | 3739/2943 → 3739/2944 |
| 14899 ↔ 15155 | yes | 14899:2 ↔ 15155:1 | 2 | 3775/3295 → 3776/3295 |
| 14911 ↔ 14912 | false/false | 14911:1 ↔ 14912:2, 14911:1 ↔ 14912:1 | 12 | 3752/4095 → 3752/4096 |
| 14911 ↔ 15167 | false/false | 14911:1 ↔ 15167:1 | 14 | 3775/4081 → 3776/4081 |
| 14912 ↔ 14913 | false/false | 14912:1 ↔ 14913:2 | 3 | 3765/4159 → 3765/4160 |
| 14912 ↔ 15168 | false/true | 14912:4 ↔ 15168:2, 14912:1 ↔ 15168:3 | 9 | 3775/4140 → 3776/4140 |
| 14913 ↔ 15169 | false/true | 14913:2 ↔ 15169:1, 14913:2 ↔ 15169:2, 14913:1 ↔ 15169:1 | 19 | 3775/4173 → 3776/4173 |
| 14914 ↔ 14915 | false/true | 14914:1 ↔ 14915:2, 14914:1 ↔ 14915:1 | 22 | 3737/4287 → 3737/4288 |
| 14914 ↔ 15170 | false/true | 14914:1 ↔ 15170:1, 14914:1 ↔ 15170:2, 14914:1 ↔ 15170:3 | 17 | 3775/4226 → 3776/4226 |
| 14915 ↔ 15171 | yes | 14915:4 ↔ 15171:1, 14915:4 ↔ 15171:2, 14915:5 ↔ 15171:2, 14915:6 ↔ 15171:2, 14915:7 ↔ 15171:2 | 33 | 3775/4289 → 3776/4289 |
| 14916 ↔ 15172 | yes | 14916:2 ↔ 15172:1, 14916:1 ↔ 15172:2 | 22 | 3775/4381 → 3776/4381 |
| 15149 ↔ 15405 | false/false | 15149:1 ↔ 15405:1 | 6 | 3839/2938 → 3840/2938 |
| 15154 ↔ 15155 | yes | 15154:2 ↔ 15155:2 | 6 | 3803/3263 → 3803/3264 |
| 15166 ↔ 15167 | false/false | 15166:1 ↔ 15167:1 | 4 | 3815/4031 → 3815/4032 |
| 15166 ↔ 15422 | false/false | 15166:1 ↔ 15422:1 | 2 | 3839/4017 → 3840/4017 |
| 15167 ↔ 15168 | false/true | 15167:2 ↔ 15168:6 | 6 | 3801/4095 → 3801/4096 |
| 15170 ↔ 15171 | yes | 15170:3 ↔ 15171:1 | 5 | 3776/4287 → 3776/4288 |
| 15405 ↔ 15406 | false/true | 15405:1 ↔ 15406:1 | 5 | 3840/2943 → 3840/2944 |
| 15424 ↔ 15425 | yes | 15424:2 ↔ 15425:5, 15424:2 ↔ 15425:4 | 13 | 3862/4159 → 3862/4160 |
| 15424 ↔ 15680 | yes | 15424:2 ↔ 15680:1, 15424:4 ↔ 15680:2, 15424:2 ↔ 15680:3 | 11 | 3903/4096 → 3904/4096 |
| 15429 ↔ 15685 | yes | 15429:3 ↔ 15685:1, 15429:3 ↔ 15685:2, 15429:1 ↔ 15685:2, 15429:1 ↔ 15685:3, 15429:4 ↔ 15685:3 | 33 | 3903/4416 → 3904/4416 |
| 15645 ↔ 15646 | false/false | 15645:1 ↔ 15646:1 | 52 | 3904/1919 → 3904/1920 |
| 15646 ↔ 15647 | false/false | 15646:1 ↔ 15647:1 | 44 | 3904/1983 → 3904/1984 |
| 15646 ↔ 15902 | false/false | 15646:1 ↔ 15902:1 | 41 | 3967/1932 → 3968/1932 |
| 15678 ↔ 15679 | false/true | 15678:1 ↔ 15679:1 | 9 | 3948/4031 → 3948/4032 |
| 15679 ↔ 15680 | yes | 15679:1 ↔ 15680:1 | 19 | 3904/4095 → 3904/4096 |
| 15679 ↔ 15935 | yes | 15679:1 ↔ 15935:1, 15679:5 ↔ 15935:1 | 11 | 3967/4078 → 3968/4078 |
| 15684 ↔ 15685 | yes | 15684:1 ↔ 15685:2, 15684:1 ↔ 15685:5, 15684:1 ↔ 15685:8, 15684:1 ↔ 15685:10 | 32 | 3914/4415 → 3914/4416 |
| 15685 ↔ 15686 | yes | 15685:4 ↔ 15686:1, 15685:3 ↔ 15686:2 | 22 | 3932/4479 → 3932/4480 |
| 15685 ↔ 15941 | yes | 15685:2 ↔ 15941:2, 15685:2 ↔ 15941:3, 15685:3 ↔ 15941:4 | 34 | 3967/4424 → 3968/4424 |
| 15935 ↔ 16191 | yes | 15935:2 ↔ 16191:1 | 6 | 4031/4083 → 4032/4083 |
| 16190 ↔ 16191 | false/true | 16190:1 ↔ 16191:1, 16190:2 ↔ 16191:1 | 13 | 4057/4031 → 4057/4032 |
| 16190 ↔ 16446 | false/false | 16190:2 ↔ 16446:1 | 5 | 4095/4018 → 4096/4018 |
| 16191 ↔ 16192 | yes | 16191:2 ↔ 16192:1, 16191:1 ↔ 16192:2, 16191:1 ↔ 16192:4, 16191:5 ↔ 16192:6 | 33 | 4032/4095 → 4032/4096 |
| 16191 ↔ 16447 | yes | 16191:6 ↔ 16447:1, 16191:7 ↔ 16447:1, 16191:1 ↔ 16447:2 | 24 | 4095/4042 → 4096/4042 |
| 16433 ↔ 16689 | false/true | 16433:1 ↔ 16689:1 | 1 | 4159/3136 → 4160/3136 |
| 16440 ↔ 16696 | false/false | 16440:1 ↔ 16696:1 | 1 | 4159/3589 → 4160/3589 |
| 16446 ↔ 16447 | false/true | 16446:1 ↔ 16447:1 | 7 | 4143/4031 → 4143/4032 |
| 16694 ↔ 16695 | true/false | 16694:2 ↔ 16695:2 | 14 | 4167/3519 → 4167/3520 |
| 16705 ↔ 16706 | yes | 16705:2 ↔ 16706:1 | 30 | 4160/4223 → 4160/4224 |
| 16950 ↔ 16951 | true/false | 16950:4 ↔ 16951:1 | 1 | 4247/3519 → 4247/3520 |
| 16951 ↔ 17207 | false/false | 16951:3 ↔ 17207:1 | 5 | 4287/3539 → 4288/3539 |
| 17174 ↔ 17175 | false/true | 17174:2 ↔ 17175:1 | 4 | 4316/1471 → 4316/1472 |
| 17175 ↔ 17431 | true/false | 17175:1 ↔ 17431:1 | 5 | 4351/1486 → 4352/1486 |
| 17206 ↔ 17207 | true/false | 17206:4 ↔ 17207:1, 17206:6 ↔ 17207:1 | 11 | 4291/3519 → 4291/3520 |
| 17457 ↔ 17458 | yes | 17457:4 ↔ 17458:2, 17457:6 ↔ 17458:4 | 8 | 4357/3199 → 4357/3200 |
| 17462 ↔ 17718 | yes | 17462:11 ↔ 17718:1 | 2 | 4415/3464 → 4416/3464 |
| 17712 ↔ 17713 | false/false | 17712:6 ↔ 17713:2, 17712:12 ↔ 17713:4 | 12 | 4456/3135 → 4456/3136 |
| 17713 ↔ 17714 | false/false | 17713:2 ↔ 17714:1 | 17 | 4458/3199 → 4458/3200 |
| 17713 ↔ 17969 | false/false | 17713:4 ↔ 17969:1, 17713:3 ↔ 17969:1 | 34 | 4479/3140 → 4480/3140 |
| 17716 ↔ 17972 | true/false | 17716:20 ↔ 17972:1 | 9 | 4479/3339 → 4480/3339 |
| 17717 ↔ 17973 | true/false | 17717:6 ↔ 17973:1 | 15 | 4479/3408 → 4480/3408 |
| 17968 ↔ 17969 | false/false | 17968:2 ↔ 17969:2 | 1 | 4482/3135 → 4482/3136 |
| 17970 ↔ 18226 | false/false | 17970:2 ↔ 18226:1 | 11 | 4543/3209 → 4544/3209 |
| 17971 ↔ 17972 | false/false | 17971:1 ↔ 17972:1, 17971:2 ↔ 17972:1 | 6 | 4483/3327 → 4483/3328 |
| 17971 ↔ 18227 | false/false | 17971:6 ↔ 18227:1 | 13 | 4543/3304 → 4544/3304 |
| 17972 ↔ 17973 | false/false | 17972:2 ↔ 17973:4, 17972:6 ↔ 17973:1, 17972:7 ↔ 17973:1, 17972:9 ↔ 17973:1 | 36 | 4489/3391 → 4489/3392 |
| 17972 ↔ 18228 | false/false | 17972:1 ↔ 18228:1, 17972:9 ↔ 18228:2 | 34 | 4543/3329 → 4544/3329 |
| 17973 ↔ 17974 | false/false | 17973:3 ↔ 17974:4, 17973:5 ↔ 17974:10 | 22 | 4497/3455 → 4497/3456 |
| 17973 ↔ 18229 | false/false | 17973:1 ↔ 18229:1, 17973:12 ↔ 18229:1, 17973:14 ↔ 18229:2, 17973:13 ↔ 18229:2, 17973:12 ↔ 18229:3, 17973:5 ↔ 18229:1 | 43 | 4543/3392 → 4544/3392 |
| 17974 ↔ 17975 | false/false | 17974:6 ↔ 17975:2 | 2 | 4531/3519 → 4531/3520 |
| 17974 ↔ 18230 | false/false | 17974:12 ↔ 18230:1, 17974:10 ↔ 18230:1, 17974:10 ↔ 18230:2 | 19 | 4543/3456 → 4544/3456 |
| 17975 ↔ 18231 | false/false | 17975:2 ↔ 18231:1 | 9 | 4543/3532 → 4544/3532 |
| 18225 ↔ 18226 | false/false | 18225:1 ↔ 18226:1, 18225:1 ↔ 18226:3 | 26 | 4563/3199 → 4563/3200 |
| 18225 ↔ 18481 | false/false | 18225:1 ↔ 18481:1, 18225:2 ↔ 18481:2 | 18 | 4607/3177 → 4608/3177 |
| 18226 ↔ 18227 | false/false | 18226:1 ↔ 18227:11, 18226:1 ↔ 18227:14, 18226:1 ↔ 18227:15 | 17 | 4585/3263 → 4585/3264 |
| 18226 ↔ 18482 | false/false | 18226:4 ↔ 18482:1, 18226:3 ↔ 18482:1, 18226:1 ↔ 18482:2 | 15 | 4607/3205 → 4608/3205 |
| 18227 ↔ 18228 | false/false | 18227:2 ↔ 18228:1 | 14 | 4544/3327 → 4544/3328 |
| 18227 ↔ 18483 | false/false | 18227:15 ↔ 18483:2 | 3 | 4607/3265 → 4608/3265 |
| 18228 ↔ 18229 | false/false | 18228:2 ↔ 18229:1, 18228:1 ↔ 18229:1, 18228:9 ↔ 18229:7, 18228:9 ↔ 18229:10 | 55 | 4544/3391 → 4544/3392 |
| 18228 ↔ 18484 | false/false | 18228:10 ↔ 18484:1, 18228:9 ↔ 18484:3 | 36 | 4607/3330 → 4608/3330 |
| 18229 ↔ 18230 | false/false | 18229:4 ↔ 18230:1, 18229:1 ↔ 18230:1, 18229:1 ↔ 18230:15, 18229:1 ↔ 18230:19, 18229:1 ↔ 18230:27, 18229:9 ↔ 18230:27 | 45 | 4544/3455 → 4544/3456 |
| 18229 ↔ 18485 | false/false | 18229:10 ↔ 18485:1, 18229:1 ↔ 18485:1, 18229:1 ↔ 18485:2, 18229:8 ↔ 18485:2 | 21 | 4607/3392 → 4608/3392 |
| 18230 ↔ 18231 | false/false | 18230:14 ↔ 18231:12 | 6 | 4572/3519 → 4572/3520 |
| 18231 ↔ 18487 | false/false | 18231:14 ↔ 18487:1, 18231:16 ↔ 18487:2, 18231:13 ↔ 18487:3 | 40 | 4607/3520 → 4608/3520 |
| 18481 ↔ 18482 | false/false | 18481:2 ↔ 18482:1, 18481:1 ↔ 18482:2 | 3 | 4610/3199 → 4610/3200 |
| 18481 ↔ 18737 | false/false | 18481:1 ↔ 18737:1, 18481:1 ↔ 18737:2 | 19 | 4671/3166 → 4672/3166 |
| 18482 ↔ 18483 | false/false | 18482:3 ↔ 18483:1, 18482:2 ↔ 18483:7 | 18 | 4608/3263 → 4608/3264 |
| 18482 ↔ 18738 | false/false | 18482:2 ↔ 18738:1 | 40 | 4671/3213 → 4672/3213 |
| 18483 ↔ 18484 | false/false | 18483:3 ↔ 18484:1, 18483:4 ↔ 18484:1, 18483:7 ↔ 18484:1 | 27 | 4608/3327 → 4608/3328 |
| 18483 ↔ 18739 | false/false | 18483:9 ↔ 18739:1, 18483:7 ↔ 18739:1 | 19 | 4671/3267 → 4672/3267 |
| 18484 ↔ 18485 | false/false | 18484:3 ↔ 18485:1, 18484:3 ↔ 18485:2, 18484:1 ↔ 18485:7, 18484:1 ↔ 18485:6 | 37 | 4608/3391 → 4608/3392 |
| 18484 ↔ 18740 | false/false | 18484:1 ↔ 18740:1, 18484:1 ↔ 18740:2 | 24 | 4671/3343 → 4672/3343 |
| 18485 ↔ 18486 | false/false | 18485:6 ↔ 18486:5 | 24 | 4629/3455 → 4629/3456 |
| 18485 ↔ 18741 | false/false | 18485:6 ↔ 18741:1, 18485:6 ↔ 18741:2 | 8 | 4671/3392 → 4672/3392 |
| 18486 ↔ 18742 | false/false | 18486:12 ↔ 18742:3 | 1 | 4671/3471 → 4672/3471 |
| 18737 ↔ 18738 | false/false | 18737:2 ↔ 18738:2, 18737:2 ↔ 18738:1 | 6 | 4682/3199 → 4682/3200 |
| 18738 ↔ 18739 | false/false | 18738:1 ↔ 18739:1 | 21 | 4676/3263 → 4676/3264 |
| 18740 ↔ 18741 | false/false | 18740:2 ↔ 18741:1, 18740:2 ↔ 18741:2, 18740:2 ↔ 18741:4, 18740:2 ↔ 18741:5, 18740:4 ↔ 18741:7 | 15 | 4672/3391 → 4672/3392 |
| 18740 ↔ 18996 | false/false | 18740:4 ↔ 18996:1 | 8 | 4735/3382 → 4736/3382 |
| 18741 ↔ 18997 | false/false | 18741:5 ↔ 18997:1, 18741:5 ↔ 18997:2, 18741:5 ↔ 18997:3 | 5 | 4735/3408 → 4736/3408 |
| 18742 ↔ 18998 | false/false | 18742:14 ↔ 18998:1 | 5 | 4735/3482 → 4736/3482 |
| 18996 ↔ 18997 | false/false | 18996:1 ↔ 18997:4, 18996:1 ↔ 18997:2 | 3 | 4740/3391 → 4740/3392 |
| 18998 ↔ 19254 | false/false | 18998:11 ↔ 19254:1 | 6 | 4799/3470 → 4800/3470 |
| 19248 ↔ 19249 | false/false | 19248:1 ↔ 19249:1 | 11 | 4800/3135 → 4800/3136 |
| 19249 ↔ 19250 | false/false | 19249:1 ↔ 19250:1 | 11 | 4800/3199 → 4800/3200 |

### Recorded connections without a closed-cache edge

| Region pair | Coverage | Review classification | Exact recorded dependencies |
| --- | --- | --- | --- |
| 7727 ↔ 7728 | missing/decoded | unknown-coverage | 7727-0 ← 7728, 7728-0 ← 7727 |
| 8244 ↔ 8500 | missing/decoded | unknown-coverage | 8244-0 ← 8500, 8500-0 ← 8244 |
| 9010 ↔ 9011 | decoded/decoded | review-static-or-conditional | 9010-1 ← 9011-3, 9011-3 ← 9010-2 |
| 9012 ↔ 9268 | decoded/decoded | review-static-or-conditional | 9012-1 ← 9268-2 |
| 9275 ↔ 9276 | decoded/decoded | review-static-or-conditional | 9276-0 ← 9275 |
| 9278 ↔ 9279 | decoded/decoded | review-static-or-conditional | 9278-0 ← 9279, 9279-0 ← 9278 |
| 11057 ↔ 11313 | decoded/decoded | review-static-or-conditional | 11057-0 ← 11313, 11313-0 ← 11057 |
| 11836 ↔ 11837 | decoded/decoded | review-static-or-conditional | 11836-0 ← 11837, 11837-0 ← 11836 |
| 12073 ↔ 12329 | decoded/decoded | review-static-or-conditional | 12073-0 ← 12329-4, 12329-4 ← 12073 |
| 12860 ↔ 12861 | decoded/decoded | review-static-or-conditional | 12860-0 ← 12861, 12861-0 ← 12860 |
| 13611 ↔ 13612 | decoded/decoded | review-static-or-conditional | 13611-0 ← 13612-2, 13612-2 ← 13611 |
| 14646 ↔ 14902 | decoded/decoded | review-static-or-conditional | 14646-1 ← 14902, 14902-0 ← 14646-1 |
| 14659 ↔ 14660 | decoded/decoded | review-static-or-conditional | 14659-0 ← 14660, 14660-0 ← 14659 |
| 14660 ↔ 14916 | decoded/decoded | review-static-or-conditional | 14660-0 ← 14916, 14916-0 ← 14660 |
| 15171 ↔ 15172 | decoded/decoded | review-static-or-conditional | 15171-0 ← 15172-1, 15171-0 ← 15172-3, 15172-1 ← 15171, 15172-3 ← 15171 |
| 15171 ↔ 15427 | decoded/decoded | review-static-or-conditional | 15171-0 ← 15427-1, 15427-1 ← 15171, 15427-4 ← 15171 |
| 15172 ↔ 15428 | decoded/decoded | review-static-or-conditional | 15172-2 ← 15428-1, 15172-2 ← 15428-2, 15428-1 ← 15172-2, 15428-2 ← 15172-2 |
| 15427 ↔ 15428 | decoded/decoded | review-static-or-conditional | 15427-1 ← 15428-2, 15428-2 ← 15427-1 |
| 15429 ↔ 15430 | decoded/decoded | review-static-or-conditional | 15429-1 ← 15430, 15429-2 ← 15430, 15430-0 ← 15429-1, 15430-0 ← 15429-2 |
| 15430 ↔ 15686 | decoded/decoded | review-static-or-conditional | 15430-0 ← 15686-1, 15686-1 ← 15430 |
| 15942 ↔ 16198 | decoded/decoded | review-static-or-conditional | 15942-1 ← 16198-1, 15942-1 ← 16198-4, 15942-2 ← 16198-2, 16198-1 ← 15942-1, 16198-2 ← 15942-2, 16198-4 ← 15942-1 |
| 15942 ↔ 15943 | decoded/missing | unknown-coverage | 15942-2 ← 15943-2, 15942-3 ← 15943-1, 15943-1 ← 15942-3, 15943-2 ← 15942-2 |
| 15943 ↔ 16199 | missing/missing | unknown-coverage | 15943-1 ← 16199, 15943-2 ← 16199, 16199-0 ← 15943-1, 16199-0 ← 15943-2 |
| 16198 ↔ 16454 | decoded/decoded | review-static-or-conditional | 16198-1 ← 16454-3, 16198-2 ← 16454-2, 16198-3 ← 16454-1, 16454-1 ← 16198-3, 16454-2 ← 16198-2, 16454-3 ← 16198-1 |
| 16198 ↔ 16199 | decoded/missing | unknown-coverage | 16198-2 ← 16199, 16198-3 ← 16199, 16199-0 ← 16198-2, 16199-0 ← 16198-3 |
| 16453 ↔ 16454 | decoded/decoded | review-static-or-conditional | 16453-1 ← 16454-3, 16453-1 ← 16454-2, 16454-2 ← 16453-1, 16454-3 ← 16453-1 |
| 16454 ↔ 16455 | decoded/missing | unknown-coverage | 16454-1 ← 16455, 16455-0 ← 16454-1 |
| 16454 ↔ 16710 | decoded/decoded | review-static-or-conditional | 16454-2 ← 16710 |
| 16704 ↔ 16960 | decoded/missing | unknown-coverage | 16704-1 ← 16960-2, 16704-1 ← 16960-3, 16960-2 ← 16704-1, 16960-3 ← 16704-1 |
| 16705 ↔ 16961 | decoded/missing | unknown-coverage | 16705-1 ← 16961-1, 16961-1 ← 16705-1 |
| 16706 ↔ 16962 | decoded/missing | unknown-coverage | 16706-2 ← 16962-1, 16706-3 ← 16962-2, 16962-1 ← 16706-2, 16962-2 ← 16706-3 |
| 16707 ↔ 16963 | decoded/missing | unknown-coverage | 16707-1 ← 16963-2, 16707-6 ← 16963-1, 16707-8 ← 16963-1, 16963-1 ← 16707-8, 16963-1 ← 16707-6, 16963-2 ← 16707-1 |
| 16707 ↔ 16708 | decoded/decoded | review-static-or-conditional | 16707-2 ← 16708-1, 16707-9 ← 16708-2, 16708-1 ← 16707-2, 16708-2 ← 16707-9 |
| 16708 ↔ 16964 | decoded/missing | unknown-coverage | 16708-1 ← 16964-1, 16708-1 ← 16964-2, 16964-1 ← 16708-1, 16964-2 ← 16708-1 |
| 16709 ↔ 16710 | decoded/decoded | review-static-or-conditional | 16709-2 ← 16710, 16710-0 ← 16709-2 |
| 16709 ↔ 16965 | decoded/missing | unknown-coverage | 16709-2 ← 16965, 16965-0 ← 16709-2 |
| 16710 ↔ 16966 | decoded/missing | unknown-coverage | 16710-0 ← 16966 |
| 16960 ↔ 16961 | missing/missing | unknown-coverage | 16960-1 ← 16961-1, 16960-1 ← 16961-2, 16960-2 ← 16961-1, 16961-1 ← 16960-1, 16961-1 ← 16960-2, 16961-2 ← 16960-1 |
| 16961 ↔ 16962 | missing/missing | unknown-coverage | 16961-1 ← 16962-2, 16962-2 ← 16961-1 |
| 16962 ↔ 16963 | missing/missing | unknown-coverage | 16962-1 ← 16963-1, 16963-1 ← 16962-1 |
| 16963 ↔ 16964 | missing/missing | unknown-coverage | 16963-2 ← 16964-1, 16964-1 ← 16963-2 |
| 16965 ↔ 16966 | missing/missing | unknown-coverage | 16965-0 ← 16966, 16966-0 ← 16965 |

### Non-walking dependencies kept separate

| Destination section | Dependency | Existing classification |
| --- | --- | --- |
| 8752-2 | 9009-1 | unresolved |
| 10030-0 | 10287-2 | transport |
| 10287-2 | 10030 | transport |
| 12082-1 | 11825-2 | transport |
| 12082-1 | 16179-2 | transport |
| 12329-4 | 13097-2 | transport |
| 13097-2 | 12329-4 | transport |
| 16179-2 | 12082-1 | transport |

### Rejected pasted seams

| Displayed region pair | Rejected portals |
| --- | --- |
| 7471 ↔ 7472 | 32 |
| 7983 ↔ 7984 | 32 |
| 8754 ↔ 8755 | 50 |
| 9010 ↔ 9011 | 29 |
| 9013 ↔ 9014 | 19 |

Those 162 apparent portals are display neighbours whose source coordinates are discontinuous. They are excluded from the graph.

### Membership policy disagreements

| Region | Nickname | Current F2P | Free / members tiles | Classification |
| --- | --- | --- | --- | --- |
| 12592 | Temple of Amascut | true | 0 / 39 | members |
| 9001 | Iron Enclave | false | 954 / 0 | free |
| 11576 | Troll Arena | false | 87 / 858 | mixed |
| 13621 | Mort Myre Swamp | false | 12 / 1869 | mixed |
| 13873 | South Burgh de Rott | false | 220 / 786 | mixed |

The provisional Death Plateau 11320 section-1 conflict has only neighbour-signature correspondence. Do not change its members policy from an ambiguous component match alone.

| Section | Policy free? | Classification | Match | Free / members / unknown | Candidate components |
| --- | --- | --- | --- | --- | --- |
| 17460-3 | true | free | ambiguous | 425 / 0 / 0 | 17460:1, 17460:2, 17460:3 |
| 17461-2 | true | free | ambiguous | 376 / 0 / 0 | 17461:1, 17461:2, 17461:3, 17461:4 |
| 17461-3 | true | free | ambiguous | 376 / 0 / 0 | 17461:1, 17461:2, 17461:3, 17461:4 |
| 17461-4 | false | members | ambiguous | 0 / 1050 / 0 | 17461:8, 17461:9 |
| 17461-6 | false | mixed | ambiguous | 8 / 498 / 0 | 17461:7, 17461:9 |
| 13622-1 | true | mixed | ambiguous | 788 / 54 / 0 | 13622:1, 13622:2 |
| 13622-2 | false | mixed | single-neighbor-signature | 8 / 1446 / 0 | 13622:10 |
| 11320-1 | false | free | ambiguous | 1047 / 0 / 0 | 11320:2, 11320:9 |
| 11320-2 | false | mixed | ambiguous | 1105 / 126 / 0 | 11320:2, 11320:9, 11320:12, 11320:25 |
| 11320-3 | true | free | ambiguous | 1159 / 0 / 0 | 11320:2, 11320:5, 11320:9, 11320:17 |
| 11320-4 | true | free | ambiguous | 1159 / 0 / 0 | 11320:2, 11320:5, 11320:9, 11320:17 |
| 11317-1 | false | mixed | single-neighbor-signature | 12 / 685 / 0 | 11317:1 |
| 11317-3 | false | mixed | ambiguous | 553 / 807 / 0 | 11317:1, 11317:2, 11317:3, 11317:4, 11317:5, 11317:6, 11317:7, 11317:8, 11317:9, 11317:10, 11317:11, 11317:12, 11317:13, 11317:14, 11317:15, 11317:16, 11317:17, 11317:18, 11317:19, 11317:20, 11317:21, 11317:22, 11317:23 |
| 11317-4 | true | mixed | ambiguous | 529 / 10 / 0 | 11317:15, 11317:16, 11317:20, 11317:21, 11317:22, 11317:23 |
| 11317-5 | true | mixed | ambiguous | 529 / 10 / 0 | 11317:15, 11317:16, 11317:20, 11317:21, 11317:22, 11317:23 |
| 13620-2 | false | mixed | ambiguous | 31 / 1540 / 0 | 13620:1, 13620:2, 13620:3, 13620:4, 13620:20 |

All 88 defined records with unknown component membership: 7492, 7727, 7745, 7748, 7749, 7750, 7751, 8001, 8002, 8004, 8007, 8244, 8260, 8519, 8770, 8772, 8774, 8775, 9029, 9030, 9282, 9283, 9284, 9540, 9541, 9793, 9794, 9795, 9796, 9797, 10055, 10307, 10310, 10566, 10819, 10821, 10822, 11074, 11075, 11076, 11077, 11078, 11079, 11330, 11332, 11586, 11587, 11588, 11589, 11842, 11843, 11844, 12100, 12102, 12354, 12355, 12356, 12357, 12610, 12614, 12615, 12865, 12870, 13121, 13123, 13124, 13634, 13636, 14150, 14151, 14406, 15175, 15687, 15943, 16199, 16455, 16701, 16711, 16957, 16959, 16960, 16961, 16962, 16963, 16964, 16965, 16966, 16967. These have no classifiable walkable component, rather than observed member-only terrain.

### Positive surface tiles outside the picker records

All 451 IDs are listed as `region:tileCount`; component details are in the committed advisory file. This inventory includes unblocked rendered-water areas and disconnected fragments. It does not recommend enabling them.

`7463:982`, `7464:982`, `7465:982`, `7466:982`, `7467:982`, `7468:982`, `7469:982`, `7470:982`, `7471:982`, `7475:982`, `7476:982`, `7477:982`,
`7478:982`, `7479:982`, `7480:982`, `7481:982`, `7482:982`, `7483:982`, `7484:982`, `7485:982`, `7486:982`, `7487:982`, `7719:982`, `7720:982`,
`7721:982`, `7722:982`, `7723:982`, `7724:982`, `7725:982`, `7726:982`, `7731:982`, `7732:982`, `7733:982`, `7734:982`, `7735:982`, `7736:982`,
`7737:982`, `7738:982`, `7739:982`, `7740:982`, `7741:982`, `7742:982`, `7743:982`, `7975:982`, `7976:982`, `7977:982`, `7978:982`, `7979:982`,
`7980:982`, `7981:982`, `7982:982`, `7983:982`, `7987:982`, `7988:982`, `7989:982`, `7990:982`, `7991:982`, `7992:982`, `7993:982`, `7994:982`,
`7996:982`, `7997:982`, `7998:982`, `7999:982`, `8237:1`, `8492:1`, `8504:36`, `8505:1007`, `8506:321`, `8762:1143`, `9018:123`, `9023:907`,
`9024:905`, `9280:895`, `9515:919`, `9534:1007`, `9535:885`, `9771:594`, `10279:61`, `10280:96`, `10302:4096`, `10303:4096`, `10535:159`, `10791:79`,
`10792:95`, `10815:4096`, `11838:1`, `12328:16`, `12334:4096`, `13096:288`, `13353:840`, `14127:1`, `14137:1`, `14358:1`, `14359:1`, `14360:1`,
`14361:1`, `14362:1`, `14363:1`, `14364:1`, `14365:1`, `14366:1`, `14367:1`, `14368:1`, `14369:1`, `14370:1`, `14371:1`, `14372:1`,
`14373:1`, `14374:1`, `14402:985`, `14403:565`, `14614:1`, `14615:1`, `14616:1`, `14617:1`, `14618:1`, `14619:1`, `14620:1`, `14621:1`,
`14622:1`, `14623:1`, `14624:1`, `14625:1`, `14626:1`, `14627:1`, `14628:1`, `14629:1`, `14630:1`, `14658:374`, `14870:1`, `14871:1`,
`14872:1`, `14873:3782`, `14874:1`, `14875:1`, `14876:1`, `14877:684`, `14879:1`, `14880:1`, `14881:1`, `14882:1`, `14885:1`, `14886:1`,
`14911:140`, `14912:571`, `14913:533`, `14914:560`, `15126:1`, `15127:1`, `15128:1`, `15129:1`, `15130:1`, `15131:1`, `15132:1`, `15136:1`,
`15137:1`, `15138:1`, `15141:1`, `15142:1`, `15149:382`, `15166:99`, `15167:559`, `15382:1`, `15383:1`, `15384:1`, `15385:1`, `15386:1`,
`15387:1`, `15388:1`, `15392:1`, `15393:1`, `15394:1`, `15395:1`, `15396:1`, `15397:1`, `15398:1`, `15404:982`, `15405:20`, `15408:982`,
`15409:982`, `15410:982`, `15411:982`, `15412:982`, `15413:982`, `15414:982`, `15415:982`, `15416:982`, `15417:982`, `15422:5`, `15638:1`, `15639:1`,
`15640:1`, `15641:1`, `15642:1`, `15643:1`, `15644:1`, `15645:1883`, `15646:3927`, `15647:823`, `15648:1`, `15650:1`, `15651:1`, `15652:1`,
`15653:1`, `15654:1`, `15678:360`, `15894:1`, `15895:1`, `15896:1`, `15897:1`, `15898:1`, `15899:1`, `15900:1`, `15901:1`, `15902:584`,
`15903:1`, `15904:1`, `15906:8`, `15907:1`, `15908:1`, `15909:1`, `15910:1`, `16150:1`, `16151:1`, `16152:1`, `16156:1`, `16157:1`,
`16158:1`, `16159:1`, `16160:1`, `16162:1`, `16163:1`, `16164:1`, `16165:1`, `16166:1`, `16183:45`, `16184:4032`, `16190:198`, `16406:1`,
`16407:1`, `16408:1`, `16412:1`, `16413:1`, `16414:1`, `16415:1`, `16416:1`, `16417:1`, `16418:1`, `16419:1`, `16420:1`, `16421:1`,
`16422:1`, `16433:4096`, `16439:14`, `16440:1`, `16446:205`, `16662:1`, `16663:1`, `16664:1`, `16665:1`, `16669:1`, `16670:1`, `16671:1`,
`16672:1`, `16673:1`, `16674:1`, `16675:1`, `16676:1`, `16677:1`, `16678:1`, `16695:765`, `16696:587`, `16918:1`, `16921:1`, `16922:1`,
`16925:1`, `16926:1`, `16927:1`, `16928:1`, `16929:1`, `16930:1`, `16931:1`, `16932:1`, `16933:1`, `16934:1`, `16951:2398`, `17174:1827`,
`17177:1`, `17178:1`, `17179:1`, `17180:1`, `17181:1`, `17182:1`, `17183:1`, `17184:1`, `17185:1`, `17186:1`, `17187:1`, `17188:1`,
`17189:1`, `17190:1`, `17207:794`, `17430:1`, `17431:7`, `17432:1`, `17433:1`, `17434:1`, `17435:1`, `17436:1`, `17437:1`, `17438:1`,
`17439:1`, `17440:1`, `17441:1`, `17442:1`, `17443:1`, `17444:1`, `17445:1`, `17446:1`, `17686:1`, `17687:1`, `17688:1`, `17689:1`,
`17690:1`, `17691:1`, `17692:1`, `17695:1`, `17696:1`, `17697:1`, `17698:1`, `17699:1`, `17700:1`, `17701:1`, `17702:1`, `17712:131`,
`17713:997`, `17714:113`, `17719:4096`, `17942:1`, `17943:1`, `17944:1`, `17945:1`, `17946:1`, `17947:1`, `17948:1`, `17951:1`, `17952:1`,
`17953:1`, `17954:1`, `17955:1`, `17956:1`, `17957:1`, `17958:1`, `17968:30`, `17969:851`, `17970:99`, `17971:624`, `17972:1896`, `17973:2279`,
`17974:917`, `17975:352`, `18198:1`, `18199:1`, `18200:1`, `18201:1`, `18202:1`, `18203:1`, `18204:1`, `18207:1`, `18208:1`, `18209:1`,
`18210:1`, `18211:1`, `18212:1`, `18213:1`, `18214:1`, `18225:699`, `18226:1708`, `18227:460`, `18228:2201`, `18229:3033`, `18230:1353`, `18231:772`,
`18232:7`, `18454:1`, `18455:1`, `18456:1`, `18457:1`, `18458:1`, `18459:1`, `18460:1`, `18461:1`, `18462:1`, `18463:1`, `18464:1`,
`18465:1`, `18466:1`, `18467:1`, `18468:1`, `18469:1`, `18470:1`, `18480:84`, `18481:1539`, `18482:1795`, `18483:1498`, `18484:2065`, `18485:1425`,
`18486:194`, `18487:730`, `18710:1`, `18711:1`, `18712:1`, `18713:1`, `18714:1`, `18715:1`, `18716:1`, `18717:1`, `18718:1`, `18719:1`,
`18720:1`, `18721:1`, `18722:1`, `18723:1`, `18724:1`, `18725:1`, `18726:1`, `18736:134`, `18737:862`, `18738:1653`, `18739:224`, `18740:1411`,
`18741:627`, `18742:1374`, `18743:89`, `18744:1`, `18993:132`, `18994:62`, `18995:451`, `18996:1104`, `18997:533`, `18998:1001`, `19000:1`, `19248:854`,
`19249:854`, `19250:854`, `19251:2`, `19252:361`, `19253:417`, `19254:116`, `19255:2`

### Pins and checks

The cache export has 2,994 records: 1,261 explicit placements and 1,733 object-derived placements, including 311 text-only labels. The 2021 comparison has 1209 unpaired added category-position groups, 376 removed groups and 169 **unverified** move candidates; verified moves remain zero. 1228 matched positions change artwork. See [cache-pins.md](cache-pins.md) for sprite and water details.

`npm test` passed all **807 tests**, including 47 cache-specific tests. An earlier full run failed one existing Windows graceful-shutdown test after its PID-ownership guard detected a changed owner; it reported that no process was stopped. The complete rerun passed without modifying operational code. A separate scratch publication check verified that failed validation or mismatched hashes create no published directory, PNG paths are relative, and existing version names are refused without changing their contents. Baseline reconstruction reproduced all 2,054 pin records field for field.

New local assets: [versioned pins](C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/pins.cache-2026-10-08-05932552f7af-v1.json), [versioned manifest](C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets/manifest.cache-2026-10-08-05932552f7af-v1.json), and 291 new PNGs under `sprites.cache-2026-10-08-05932552f7af-v1/`. The UTC suffix is 8 October; the local audit date is 7 October. These are diagnostic candidates, with no renderer migration or selection change. The live listener on <tailscale-ip>:8788 remained running.
