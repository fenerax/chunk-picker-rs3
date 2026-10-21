# Mapfix3: terrain alignment and surface eligibility

Dedicated worktree `codex/mapfix3`, based on main `7b7d61f`. The original game cache, shared existing assets, main tracked files and live picker on port 8788 were not changed. New generated versions and browser evidence are local to this worktree.

## Root causes and fixes

1. **Anachronia:** the modern terrain already used the exact map-28 paste (source square 88,38 → display 64,68 for region 16452). Missing tiles exposed the obsolete baked image beneath it, retaining a second coastline at display X66/Y64–70 and northern patches 15943/16199/16455. A complete, validated modern layout now uses shared ocean under all terrain. It cannot expose the old shifted map through missing tiles, transparent pixels, overview mips or native pages. Community artwork remains preferred at its display address.

2. **Two ocean tones:** old image water and modern water had different colours. Regions 14630 and 18726 are water-marked terrain, not solid gray floors. The renderer now clears definition-backed shared-water pixels and genuine unset/void cells to transparent PNG pixels; valid floors, shoreline raster edges and walls remain. Pure-ocean tiles and region 16184 (unset floor flags) remain rendered transparent sources. Complete layouts use `#60769a` ocean at every rendering density. The base also works if the old image fails to load; only community sources use the opaque-black placeholder heuristic.

3. **Isolated components:** floor counts alone previously set world.walkable. The adapter now requires a witnessed cardinal component boundary to another region or a typed boat, transport, teleport, lodestone or quest entry. Twenty-two documented island routes preserve genuine destinations. Personal route requirements still apply, and typed entries do not manufacture walking edges. Hard exclusions apply to selected/custom candidates, teleport declarations, manual neighbor generation, random starts and invalid restored pending choices. Owned regions, true section overrides and externally supplied sections cannot seed walking through excluded retained topology. Saved arrays are not rewritten.

4. **Havenhythe:** four phantom-floor regions and one detached water pair are corrected with versioned evidence, preserving the original export. The six-tile 19254 boundary and mixed membership gates remain. Genuine blocked terrain receives display records rather than invented walking access. Eight generic names are replaced by exact cache labels; five display records are added.

## Havenhythe and named probes

The screenshot descriptions were not supplied with exact coordinates. The IDs below are the matched cache evidence in the requested areas; blocked gaps remain blocked where the cache gives no entry.

| Region | Original walkable tiles / components | Free / members / unknown tiles | Before → after | Evidence |
| --- | ---: | ---: | --- | --- |
| 14630 | 1 / 1 | 0 / 1 / 0 | Members → Not walkable | 4096 water-flagged cells; one collision fragment has no entry. Transparent water. |
| 16184 | 4032 / 1 | 0 / 4032 / 0 | Members → Not walkable | 4032 flag-only unset tiles plus 64 blocked water tiles. Suppress phantom geometry and black fallback. |
| 16433 | 4096 / 1 | 0 / 4096 / 0 | Members → Not walkable | 4096 rendered-water tiles; its only edge joins water-only component 16689:1. Suppress that detached pair. |
| 16443 | 0 / 0 | 0 / 0 / 0 | Not walkable → Not walkable | No exact surface paste. Shared ocean; no invented land classification. |
| 16452 | 1518 / 11 | 0 / 1518 / 0 | Members → Members | Correct modern paste; remove the obsolete east/north image underlay, retain status. |
| 16689 | 1410 / 13 | 1410 / 0 / 0 | F2P → F2P | Remove only one water tile; 1409 free mainland tiles across 12 other components remain. |
| 17460 | 1500 / 6 | 425 / 1075 / 0 | F2P → F2P | Mask 6f0f070000000000; retain 425 free / 1075 members tiles and authored section gates. |
| 17461 | 1634 / 18 | 410 / 1224 / 0 | F2P → F2P | Mask ffffff0000000000; retain 410 free / 1224 members tiles. Component 7 has 8 free / 132 members tiles; keep the members gate. |
| 18232 | 7 / 2 | 0 / 7 / 0 | Members → Not walkable | Seven isolated tiles; no edge or typed entry. |
| 18488 | 0 / 0 | 0 / 0 / 0 | Not walkable → Not walkable | 4096 genuinely blocked floor tiles; overlays 561/112. Display-only; mask does not create walking. |
| 18726 | 1 / 1 | 0 / 1 / 0 | Members → Not walkable | 4096 water-flagged cells; isolated one-tile component. Transparent water, no member hatching. |
| 18743 | 89 / 2 | 0 / 89 / 0 | Members → Not walkable | 89 isolated tiles; no edge or typed entry. |
| 18744 | 1 / 1 | 0 / 1 / 0 | Members → Not walkable | One isolated tile; no edge or typed entry. |
| 18999 | 0 / 0 | 0 / 0 / 0 | Not walkable → Not walkable | 4096 genuinely blocked floor tiles; overlay 599. Display-only; mask does not create walking. |
| 19000 | 1 / 1 | 0 / 1 / 0 | Members → Not walkable | One isolated tile; no edge or typed entry. |
| 19248 | 854 / 1 | 0 / 854 / 0 | Members → Not walkable | 854 flag-only tiles and 3242 void; false north portal chain removed. |
| 19249 | 854 / 1 | 0 / 854 / 0 | Members → Not walkable | 854 flag-only tiles and 3242 void; false north portal chain removed. |
| 19250 | 854 / 1 | 0 / 854 / 0 | Members → Not walkable | 854 flag-only tiles and 3242 void; false north portal chain removed. |
| 19254 | 116 / 2 | 0 / 116 / 0 | Members → Members | Keep component 1: six tiles and six portals to 18998:11 at (4799,3470) → (4800,3470). The separate 110-tile component does not establish entry. |

The blocked top-right gaps are 18999 and 18488. Their raw mask is `0000000000000000`, but both have **zero walkable tiles and zero components**. Adding display records repairs classification coverage; it does not justify member hatching. The east-edge tooth in 19254 has a real six-tile walking connection and remains members land. Masks classify walking geometry; they cannot turn blocked or unset terrain into accessible land.

The following additional fragments explain the stray upper-left, southeast and east-coast hatching. Every row has raw mask `0000000000000000` and no witnessed edge or typed entry. All change from Members to Not walkable; the member mask alone no longer admits them.

| Region | Prior walkable tiles | Components | Free / members / unknown tiles |
| --- | ---: | ---: | ---: |
| 16183 | 45 | 2 | 0 / 45 / 0 |
| 16439 | 14 | 8 | 0 / 14 / 0 |
| 17719 | 4096 | 1 | 0 / 4096 / 0 |
| 18232 | 7 | 2 | 0 / 7 / 0 |
| 18480 | 84 | 1 | 0 / 84 / 0 |
| 18736 | 134 | 2 | 0 / 134 / 0 |
| 18743 | 89 | 2 | 0 / 89 / 0 |
| 18744 | 1 | 1 | 0 / 1 / 0 |
| 18993 | 132 | 3 | 0 / 132 / 0 |
| 19000 | 1 | 1 | 0 / 1 / 0 |
| 19251 | 2 | 1 | 0 / 2 / 0 |
| 19252 | 361 | 3 | 0 / 361 / 0 |
| 19253 | 417 | 4 | 0 / 417 / 0 |
| 19255 | 2 | 2 | 0 / 2 / 0 |

## Complete changed-region list

Surface records: **1111 → 1116**. Walkable: **1030 → 646**. F2P: **171 → 170**. Components: **6750 → 6744**. **384 regions change walking/membership status**. The only F2P removal is **14137**, an isolated one-tile fragment. No region becomes members-only merely from an unknown mask.

### unknown-surface-coverage-without-entry (12)

No surface paste or usable plane-0 component; retained resource compatibility does not certify entry.

7727, 8244, 15943, 16199, 16455, 16960, 16961, 16962, 16963, 16964, 16965, 16966

### empty-plane-0-without-entry (6)

Decoded plane-0 terrain has no component or known typed entry.

9279, 14660, 15428, 15430, 16454, 16710

### isolated-components-without-entry (361)

No component has a witnessed inter-region walking edge or known typed entry.

10301, 7463, 7464, 7465, 7466, 7467, 7468, 7469, 7470, 7471, 7475, 7476, 7477, 7478, 7479, 7480, 7481, 7482, 7483, 7484, 7485, 7486, 7487, 7719, 7720, 7721, 7722, 7723, 7724, 7725, 7726, 7731, 7732, 7733, 7734, 7735, 7736, 7737, 7738, 7739, 7740, 7741, 7742, 7743, 7975, 7976, 7977, 7978, 7979, 7980, 7981, 7982, 7983, 7987, 7988, 7989, 7990, 7991, 7992, 7993, 7994, 7996, 7997, 7998, 7999, 8237, 8492, 10792, 11838, 14127, 14137, 14358, 14359, 14360, 14361, 14362, 14363, 14364, 14365, 14366, 14367, 14368, 14369, 14370, 14371, 14372, 14373, 14374, 14614, 14615, 14616, 14618, 14619, 14620, 14621, 14622, 14623, 14624, 14625, 14626, 14627, 14628, 14629, 14630, 14870, 14871, 14872, 14874, 14875, 14876, 14877, 14879, 14880, 14881, 14882, 14885, 14886, 15126, 15127, 15128, 15129, 15130, 15131, 15132, 15136, 15137, 15138, 15141, 15142, 15382, 15383, 15384, 15385, 15386, 15387, 15388, 15392, 15393, 15394, 15395, 15396, 15397, 15398, 15404, 15408, 15409, 15410, 15411, 15412, 15413, 15414, 15415, 15416, 15417, 15638, 15639, 15640, 15641, 15642, 15643, 15644, 15648, 15650, 15651, 15652, 15653, 15654, 15894, 15895, 15896, 15897, 15898, 15899, 15900, 15901, 15903, 15904, 15906, 15907, 15908, 15909, 15910, 16150, 16151, 16152, 16156, 16157, 16158, 16159, 16160, 16162, 16163, 16164, 16165, 16166, 16183, 16406, 16407, 16408, 16412, 16413, 16414, 16415, 16416, 16417, 16418, 16419, 16420, 16421, 16422, 16439, 16662, 16663, 16664, 16665, 16669, 16670, 16671, 16672, 16673, 16674, 16675, 16676, 16677, 16678, 16918, 16921, 16922, 16925, 16926, 16927, 16928, 16929, 16930, 16931, 16932, 16933, 16934, 17177, 17178, 17179, 17180, 17181, 17182, 17183, 17184, 17185, 17186, 17187, 17188, 17189, 17190, 17430, 17432, 17433, 17434, 17435, 17436, 17437, 17438, 17439, 17440, 17441, 17442, 17443, 17444, 17445, 17446, 17686, 17687, 17688, 17689, 17690, 17691, 17692, 17695, 17696, 17697, 17698, 17699, 17700, 17701, 17702, 17719, 17942, 17943, 17944, 17945, 17946, 17947, 17948, 17951, 17952, 17953, 17954, 17955, 17956, 17957, 17958, 18198, 18199, 18200, 18201, 18202, 18203, 18204, 18207, 18208, 18209, 18210, 18211, 18212, 18213, 18214, 18232, 18454, 18455, 18456, 18457, 18458, 18459, 18460, 18461, 18462, 18463, 18464, 18465, 18466, 18467, 18468, 18469, 18470, 18480, 18710, 18711, 18712, 18713, 18714, 18715, 18716, 18717, 18718, 18719, 18720, 18721, 18722, 18723, 18724, 18725, 18726, 18736, 18743, 18744, 18993, 18994, 18995, 19000, 19251, 19252, 19253, 19255

### phantom-floor-without-surface (4)

Floor flags have zero floor definitions; the apparent component is unset terrain.

16184, 19248, 19249, 19250

### isolated-rendered-water-without-entry (1)

Detached water-only pair, with no mainland edge or typed entry.

16433

| Region | Name | Previous | Current | Reason |
| --- | --- | --- | --- | --- |
| 7727 | Lost Grove Entrance | Members | Not walkable | unknown-surface-coverage-without-entry |
| 8244 | West coast Prifddinas | Members | Not walkable | unknown-surface-coverage-without-entry |
| 9279 | Ungael Castle | Members | Not walkable | empty-plane-0-without-entry |
| 10301 | Penguin Island | Members | Not walkable | isolated-components-without-entry |
| 14660 | Dinosaur Farm North | Members | Not walkable | empty-plane-0-without-entry |
| 15428 | Crypt of Varanus | Members | Not walkable | empty-plane-0-without-entry |
| 15430 | Cannibal Jadinko Hunting Spot | Members | Not walkable | empty-plane-0-without-entry |
| 15943 | Anachronia Northern Totem | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16199 | OBservation Outpost Pass | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16454 | Observation Outpost | Members | Not walkable | empty-plane-0-without-entry |
| 16455 | A Single Tile North of the Observation Outpost | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16710 | Anachronia North-East Coast | Members | Not walkable | empty-plane-0-without-entry |
| 16960 | Asuran Arsenal Entrance | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16961 | South Anachronia Isle | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16962 | Shadow Jadinko Hunting Spot | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16963 | Kindra Counsil Meeting Pool | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16964 | East Common Jadinko Hunting Spot | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16965 | Anachronia North-East Isles | Members | Not walkable | unknown-surface-coverage-without-entry |
| 16966 | Anachronia North-East Corner | Members | Not walkable | unknown-surface-coverage-without-entry |
| 7463 | Surface region 7463 | Members | Not walkable | isolated-components-without-entry |
| 7464 | Surface region 7464 | Members | Not walkable | isolated-components-without-entry |
| 7465 | Surface region 7465 | Members | Not walkable | isolated-components-without-entry |
| 7466 | Surface region 7466 | Members | Not walkable | isolated-components-without-entry |
| 7467 | Surface region 7467 | Members | Not walkable | isolated-components-without-entry |
| 7468 | Surface region 7468 | Members | Not walkable | isolated-components-without-entry |
| 7469 | Surface region 7469 | Members | Not walkable | isolated-components-without-entry |
| 7470 | Surface region 7470 | Members | Not walkable | isolated-components-without-entry |
| 7471 | Surface region 7471 | Members | Not walkable | isolated-components-without-entry |
| 7475 | Surface region 7475 | Members | Not walkable | isolated-components-without-entry |
| 7476 | Surface region 7476 | Members | Not walkable | isolated-components-without-entry |
| 7477 | Surface region 7477 | Members | Not walkable | isolated-components-without-entry |
| 7478 | Surface region 7478 | Members | Not walkable | isolated-components-without-entry |
| 7479 | Surface region 7479 | Members | Not walkable | isolated-components-without-entry |
| 7480 | Surface region 7480 | Members | Not walkable | isolated-components-without-entry |
| 7481 | Surface region 7481 | Members | Not walkable | isolated-components-without-entry |
| 7482 | Surface region 7482 | Members | Not walkable | isolated-components-without-entry |
| 7483 | Surface region 7483 | Members | Not walkable | isolated-components-without-entry |
| 7484 | Surface region 7484 | Members | Not walkable | isolated-components-without-entry |
| 7485 | Surface region 7485 | Members | Not walkable | isolated-components-without-entry |
| 7486 | Surface region 7486 | Members | Not walkable | isolated-components-without-entry |
| 7487 | Surface region 7487 | Members | Not walkable | isolated-components-without-entry |
| 7719 | Surface region 7719 | Members | Not walkable | isolated-components-without-entry |
| 7720 | Surface region 7720 | Members | Not walkable | isolated-components-without-entry |
| 7721 | Surface region 7721 | Members | Not walkable | isolated-components-without-entry |
| 7722 | Surface region 7722 | Members | Not walkable | isolated-components-without-entry |
| 7723 | Surface region 7723 | Members | Not walkable | isolated-components-without-entry |
| 7724 | Surface region 7724 | Members | Not walkable | isolated-components-without-entry |
| 7725 | Surface region 7725 | Members | Not walkable | isolated-components-without-entry |
| 7726 | Surface region 7726 | Members | Not walkable | isolated-components-without-entry |
| 7731 | Surface region 7731 | Members | Not walkable | isolated-components-without-entry |
| 7732 | Surface region 7732 | Members | Not walkable | isolated-components-without-entry |
| 7733 | Surface region 7733 | Members | Not walkable | isolated-components-without-entry |
| 7734 | Surface region 7734 | Members | Not walkable | isolated-components-without-entry |
| 7735 | Surface region 7735 | Members | Not walkable | isolated-components-without-entry |
| 7736 | Surface region 7736 | Members | Not walkable | isolated-components-without-entry |
| 7737 | Surface region 7737 | Members | Not walkable | isolated-components-without-entry |
| 7738 | Surface region 7738 | Members | Not walkable | isolated-components-without-entry |
| 7739 | Surface region 7739 | Members | Not walkable | isolated-components-without-entry |
| 7740 | Surface region 7740 | Members | Not walkable | isolated-components-without-entry |
| 7741 | Surface region 7741 | Members | Not walkable | isolated-components-without-entry |
| 7742 | Surface region 7742 | Members | Not walkable | isolated-components-without-entry |
| 7743 | Surface region 7743 | Members | Not walkable | isolated-components-without-entry |
| 7975 | Surface region 7975 | Members | Not walkable | isolated-components-without-entry |
| 7976 | Surface region 7976 | Members | Not walkable | isolated-components-without-entry |
| 7977 | Surface region 7977 | Members | Not walkable | isolated-components-without-entry |
| 7978 | Surface region 7978 | Members | Not walkable | isolated-components-without-entry |
| 7979 | Surface region 7979 | Members | Not walkable | isolated-components-without-entry |
| 7980 | Surface region 7980 | Members | Not walkable | isolated-components-without-entry |
| 7981 | Surface region 7981 | Members | Not walkable | isolated-components-without-entry |
| 7982 | Surface region 7982 | Members | Not walkable | isolated-components-without-entry |
| 7983 | Surface region 7983 | Members | Not walkable | isolated-components-without-entry |
| 7987 | Surface region 7987 | Members | Not walkable | isolated-components-without-entry |
| 7988 | Surface region 7988 | Members | Not walkable | isolated-components-without-entry |
| 7989 | Surface region 7989 | Members | Not walkable | isolated-components-without-entry |
| 7990 | Surface region 7990 | Members | Not walkable | isolated-components-without-entry |
| 7991 | Surface region 7991 | Members | Not walkable | isolated-components-without-entry |
| 7992 | Surface region 7992 | Members | Not walkable | isolated-components-without-entry |
| 7993 | Surface region 7993 | Members | Not walkable | isolated-components-without-entry |
| 7994 | Surface region 7994 | Members | Not walkable | isolated-components-without-entry |
| 7996 | Surface region 7996 | Members | Not walkable | isolated-components-without-entry |
| 7997 | Surface region 7997 | Members | Not walkable | isolated-components-without-entry |
| 7998 | Surface region 7998 | Members | Not walkable | isolated-components-without-entry |
| 7999 | Surface region 7999 | Members | Not walkable | isolated-components-without-entry |
| 8237 | Surface region 8237 | Members | Not walkable | isolated-components-without-entry |
| 8492 | Surface region 8492 | Members | Not walkable | isolated-components-without-entry |
| 10792 | Surface region 10792 | Members | Not walkable | isolated-components-without-entry |
| 11838 | Surface region 11838 | Members | Not walkable | isolated-components-without-entry |
| 14127 | Surface region 14127 | Members | Not walkable | isolated-components-without-entry |
| 14137 | Surface region 14137 | F2P | Not walkable | isolated-components-without-entry |
| 14358 | Surface region 14358 | Members | Not walkable | isolated-components-without-entry |
| 14359 | Surface region 14359 | Members | Not walkable | isolated-components-without-entry |
| 14360 | Surface region 14360 | Members | Not walkable | isolated-components-without-entry |
| 14361 | Surface region 14361 | Members | Not walkable | isolated-components-without-entry |
| 14362 | Surface region 14362 | Members | Not walkable | isolated-components-without-entry |
| 14363 | Surface region 14363 | Members | Not walkable | isolated-components-without-entry |
| 14364 | Surface region 14364 | Members | Not walkable | isolated-components-without-entry |
| 14365 | Surface region 14365 | Members | Not walkable | isolated-components-without-entry |
| 14366 | Surface region 14366 | Members | Not walkable | isolated-components-without-entry |
| 14367 | Surface region 14367 | Members | Not walkable | isolated-components-without-entry |
| 14368 | Surface region 14368 | Members | Not walkable | isolated-components-without-entry |
| 14369 | Surface region 14369 | Members | Not walkable | isolated-components-without-entry |
| 14370 | Surface region 14370 | Members | Not walkable | isolated-components-without-entry |
| 14371 | Surface region 14371 | Members | Not walkable | isolated-components-without-entry |
| 14372 | Surface region 14372 | Members | Not walkable | isolated-components-without-entry |
| 14373 | Surface region 14373 | Members | Not walkable | isolated-components-without-entry |
| 14374 | Surface region 14374 | Members | Not walkable | isolated-components-without-entry |
| 14614 | Surface region 14614 | Members | Not walkable | isolated-components-without-entry |
| 14615 | Surface region 14615 | Members | Not walkable | isolated-components-without-entry |
| 14616 | Surface region 14616 | Members | Not walkable | isolated-components-without-entry |
| 14618 | Surface region 14618 | Members | Not walkable | isolated-components-without-entry |
| 14619 | Surface region 14619 | Members | Not walkable | isolated-components-without-entry |
| 14620 | Surface region 14620 | Members | Not walkable | isolated-components-without-entry |
| 14621 | Surface region 14621 | Members | Not walkable | isolated-components-without-entry |
| 14622 | Surface region 14622 | Members | Not walkable | isolated-components-without-entry |
| 14623 | Surface region 14623 | Members | Not walkable | isolated-components-without-entry |
| 14624 | Surface region 14624 | Members | Not walkable | isolated-components-without-entry |
| 14625 | Surface region 14625 | Members | Not walkable | isolated-components-without-entry |
| 14626 | Surface region 14626 | Members | Not walkable | isolated-components-without-entry |
| 14627 | Surface region 14627 | Members | Not walkable | isolated-components-without-entry |
| 14628 | Surface region 14628 | Members | Not walkable | isolated-components-without-entry |
| 14629 | Surface region 14629 | Members | Not walkable | isolated-components-without-entry |
| 14630 | Surface region 14630 | Members | Not walkable | isolated-components-without-entry |
| 14870 | Surface region 14870 | Members | Not walkable | isolated-components-without-entry |
| 14871 | Surface region 14871 | Members | Not walkable | isolated-components-without-entry |
| 14872 | Surface region 14872 | Members | Not walkable | isolated-components-without-entry |
| 14874 | Surface region 14874 | Members | Not walkable | isolated-components-without-entry |
| 14875 | Surface region 14875 | Members | Not walkable | isolated-components-without-entry |
| 14876 | Surface region 14876 | Members | Not walkable | isolated-components-without-entry |
| 14877 | Surface region 14877 | Members | Not walkable | isolated-components-without-entry |
| 14879 | Surface region 14879 | Members | Not walkable | isolated-components-without-entry |
| 14880 | Surface region 14880 | Members | Not walkable | isolated-components-without-entry |
| 14881 | Surface region 14881 | Members | Not walkable | isolated-components-without-entry |
| 14882 | Surface region 14882 | Members | Not walkable | isolated-components-without-entry |
| 14885 | Surface region 14885 | Members | Not walkable | isolated-components-without-entry |
| 14886 | Surface region 14886 | Members | Not walkable | isolated-components-without-entry |
| 15126 | Surface region 15126 | Members | Not walkable | isolated-components-without-entry |
| 15127 | Surface region 15127 | Members | Not walkable | isolated-components-without-entry |
| 15128 | Surface region 15128 | Members | Not walkable | isolated-components-without-entry |
| 15129 | Surface region 15129 | Members | Not walkable | isolated-components-without-entry |
| 15130 | Surface region 15130 | Members | Not walkable | isolated-components-without-entry |
| 15131 | Surface region 15131 | Members | Not walkable | isolated-components-without-entry |
| 15132 | Surface region 15132 | Members | Not walkable | isolated-components-without-entry |
| 15136 | Surface region 15136 | Members | Not walkable | isolated-components-without-entry |
| 15137 | Surface region 15137 | Members | Not walkable | isolated-components-without-entry |
| 15138 | Surface region 15138 | Members | Not walkable | isolated-components-without-entry |
| 15141 | Surface region 15141 | Members | Not walkable | isolated-components-without-entry |
| 15142 | Surface region 15142 | Members | Not walkable | isolated-components-without-entry |
| 15382 | Surface region 15382 | Members | Not walkable | isolated-components-without-entry |
| 15383 | Surface region 15383 | Members | Not walkable | isolated-components-without-entry |
| 15384 | Surface region 15384 | Members | Not walkable | isolated-components-without-entry |
| 15385 | Surface region 15385 | Members | Not walkable | isolated-components-without-entry |
| 15386 | Surface region 15386 | Members | Not walkable | isolated-components-without-entry |
| 15387 | Surface region 15387 | Members | Not walkable | isolated-components-without-entry |
| 15388 | Surface region 15388 | Members | Not walkable | isolated-components-without-entry |
| 15392 | Surface region 15392 | Members | Not walkable | isolated-components-without-entry |
| 15393 | Surface region 15393 | Members | Not walkable | isolated-components-without-entry |
| 15394 | Surface region 15394 | Members | Not walkable | isolated-components-without-entry |
| 15395 | Surface region 15395 | Members | Not walkable | isolated-components-without-entry |
| 15396 | Surface region 15396 | Members | Not walkable | isolated-components-without-entry |
| 15397 | Surface region 15397 | Members | Not walkable | isolated-components-without-entry |
| 15398 | Surface region 15398 | Members | Not walkable | isolated-components-without-entry |
| 15404 | Surface region 15404 | Members | Not walkable | isolated-components-without-entry |
| 15408 | Surface region 15408 | Members | Not walkable | isolated-components-without-entry |
| 15409 | Surface region 15409 | Members | Not walkable | isolated-components-without-entry |
| 15410 | Surface region 15410 | Members | Not walkable | isolated-components-without-entry |
| 15411 | Surface region 15411 | Members | Not walkable | isolated-components-without-entry |
| 15412 | Surface region 15412 | Members | Not walkable | isolated-components-without-entry |
| 15413 | Surface region 15413 | Members | Not walkable | isolated-components-without-entry |
| 15414 | Surface region 15414 | Members | Not walkable | isolated-components-without-entry |
| 15415 | Surface region 15415 | Members | Not walkable | isolated-components-without-entry |
| 15416 | Surface region 15416 | Members | Not walkable | isolated-components-without-entry |
| 15417 | Surface region 15417 | Members | Not walkable | isolated-components-without-entry |
| 15638 | Surface region 15638 | Members | Not walkable | isolated-components-without-entry |
| 15639 | Surface region 15639 | Members | Not walkable | isolated-components-without-entry |
| 15640 | Surface region 15640 | Members | Not walkable | isolated-components-without-entry |
| 15641 | Surface region 15641 | Members | Not walkable | isolated-components-without-entry |
| 15642 | Surface region 15642 | Members | Not walkable | isolated-components-without-entry |
| 15643 | Surface region 15643 | Members | Not walkable | isolated-components-without-entry |
| 15644 | Surface region 15644 | Members | Not walkable | isolated-components-without-entry |
| 15648 | Surface region 15648 | Members | Not walkable | isolated-components-without-entry |
| 15650 | Surface region 15650 | Members | Not walkable | isolated-components-without-entry |
| 15651 | Surface region 15651 | Members | Not walkable | isolated-components-without-entry |
| 15652 | Surface region 15652 | Members | Not walkable | isolated-components-without-entry |
| 15653 | Surface region 15653 | Members | Not walkable | isolated-components-without-entry |
| 15654 | Surface region 15654 | Members | Not walkable | isolated-components-without-entry |
| 15894 | Surface region 15894 | Members | Not walkable | isolated-components-without-entry |
| 15895 | Surface region 15895 | Members | Not walkable | isolated-components-without-entry |
| 15896 | Surface region 15896 | Members | Not walkable | isolated-components-without-entry |
| 15897 | Surface region 15897 | Members | Not walkable | isolated-components-without-entry |
| 15898 | Surface region 15898 | Members | Not walkable | isolated-components-without-entry |
| 15899 | Surface region 15899 | Members | Not walkable | isolated-components-without-entry |
| 15900 | Surface region 15900 | Members | Not walkable | isolated-components-without-entry |
| 15901 | Surface region 15901 | Members | Not walkable | isolated-components-without-entry |
| 15903 | Surface region 15903 | Members | Not walkable | isolated-components-without-entry |
| 15904 | Surface region 15904 | Members | Not walkable | isolated-components-without-entry |
| 15906 | Surface region 15906 | Members | Not walkable | isolated-components-without-entry |
| 15907 | Surface region 15907 | Members | Not walkable | isolated-components-without-entry |
| 15908 | Surface region 15908 | Members | Not walkable | isolated-components-without-entry |
| 15909 | Surface region 15909 | Members | Not walkable | isolated-components-without-entry |
| 15910 | Surface region 15910 | Members | Not walkable | isolated-components-without-entry |
| 16150 | Surface region 16150 | Members | Not walkable | isolated-components-without-entry |
| 16151 | Surface region 16151 | Members | Not walkable | isolated-components-without-entry |
| 16152 | Surface region 16152 | Members | Not walkable | isolated-components-without-entry |
| 16156 | Surface region 16156 | Members | Not walkable | isolated-components-without-entry |
| 16157 | Surface region 16157 | Members | Not walkable | isolated-components-without-entry |
| 16158 | Surface region 16158 | Members | Not walkable | isolated-components-without-entry |
| 16159 | Surface region 16159 | Members | Not walkable | isolated-components-without-entry |
| 16160 | Surface region 16160 | Members | Not walkable | isolated-components-without-entry |
| 16162 | Surface region 16162 | Members | Not walkable | isolated-components-without-entry |
| 16163 | Surface region 16163 | Members | Not walkable | isolated-components-without-entry |
| 16164 | Surface region 16164 | Members | Not walkable | isolated-components-without-entry |
| 16165 | Surface region 16165 | Members | Not walkable | isolated-components-without-entry |
| 16166 | Surface region 16166 | Members | Not walkable | isolated-components-without-entry |
| 16183 | Surface region 16183 | Members | Not walkable | isolated-components-without-entry |
| 16184 | Surface region 16184 | Members | Not walkable | phantom-floor-without-surface |
| 16406 | Surface region 16406 | Members | Not walkable | isolated-components-without-entry |
| 16407 | Surface region 16407 | Members | Not walkable | isolated-components-without-entry |
| 16408 | Surface region 16408 | Members | Not walkable | isolated-components-without-entry |
| 16412 | Surface region 16412 | Members | Not walkable | isolated-components-without-entry |
| 16413 | Surface region 16413 | Members | Not walkable | isolated-components-without-entry |
| 16414 | Surface region 16414 | Members | Not walkable | isolated-components-without-entry |
| 16415 | Surface region 16415 | Members | Not walkable | isolated-components-without-entry |
| 16416 | Surface region 16416 | Members | Not walkable | isolated-components-without-entry |
| 16417 | Surface region 16417 | Members | Not walkable | isolated-components-without-entry |
| 16418 | Surface region 16418 | Members | Not walkable | isolated-components-without-entry |
| 16419 | Surface region 16419 | Members | Not walkable | isolated-components-without-entry |
| 16420 | Surface region 16420 | Members | Not walkable | isolated-components-without-entry |
| 16421 | Surface region 16421 | Members | Not walkable | isolated-components-without-entry |
| 16422 | Surface region 16422 | Members | Not walkable | isolated-components-without-entry |
| 16433 | Surface region 16433 | Members | Not walkable | isolated-rendered-water-without-entry |
| 16439 | Surface region 16439 | Members | Not walkable | isolated-components-without-entry |
| 16662 | Surface region 16662 | Members | Not walkable | isolated-components-without-entry |
| 16663 | Surface region 16663 | Members | Not walkable | isolated-components-without-entry |
| 16664 | Surface region 16664 | Members | Not walkable | isolated-components-without-entry |
| 16665 | Surface region 16665 | Members | Not walkable | isolated-components-without-entry |
| 16669 | Surface region 16669 | Members | Not walkable | isolated-components-without-entry |
| 16670 | The Arc | Members | Not walkable | isolated-components-without-entry |
| 16671 | Surface region 16671 | Members | Not walkable | isolated-components-without-entry |
| 16672 | Surface region 16672 | Members | Not walkable | isolated-components-without-entry |
| 16673 | Surface region 16673 | Members | Not walkable | isolated-components-without-entry |
| 16674 | Surface region 16674 | Members | Not walkable | isolated-components-without-entry |
| 16675 | Surface region 16675 | Members | Not walkable | isolated-components-without-entry |
| 16676 | Surface region 16676 | Members | Not walkable | isolated-components-without-entry |
| 16677 | Surface region 16677 | Members | Not walkable | isolated-components-without-entry |
| 16678 | Surface region 16678 | Members | Not walkable | isolated-components-without-entry |
| 16918 | Surface region 16918 | Members | Not walkable | isolated-components-without-entry |
| 16921 | Surface region 16921 | Members | Not walkable | isolated-components-without-entry |
| 16922 | Surface region 16922 | Members | Not walkable | isolated-components-without-entry |
| 16925 | Surface region 16925 | Members | Not walkable | isolated-components-without-entry |
| 16926 | Surface region 16926 | Members | Not walkable | isolated-components-without-entry |
| 16927 | Surface region 16927 | Members | Not walkable | isolated-components-without-entry |
| 16928 | Surface region 16928 | Members | Not walkable | isolated-components-without-entry |
| 16929 | Surface region 16929 | Members | Not walkable | isolated-components-without-entry |
| 16930 | Surface region 16930 | Members | Not walkable | isolated-components-without-entry |
| 16931 | Surface region 16931 | Members | Not walkable | isolated-components-without-entry |
| 16932 | Surface region 16932 | Members | Not walkable | isolated-components-without-entry |
| 16933 | Surface region 16933 | Members | Not walkable | isolated-components-without-entry |
| 16934 | Surface region 16934 | Members | Not walkable | isolated-components-without-entry |
| 17177 | Surface region 17177 | Members | Not walkable | isolated-components-without-entry |
| 17178 | Surface region 17178 | Members | Not walkable | isolated-components-without-entry |
| 17179 | Surface region 17179 | Members | Not walkable | isolated-components-without-entry |
| 17180 | Surface region 17180 | Members | Not walkable | isolated-components-without-entry |
| 17181 | Surface region 17181 | Members | Not walkable | isolated-components-without-entry |
| 17182 | Surface region 17182 | Members | Not walkable | isolated-components-without-entry |
| 17183 | Surface region 17183 | Members | Not walkable | isolated-components-without-entry |
| 17184 | Surface region 17184 | Members | Not walkable | isolated-components-without-entry |
| 17185 | Surface region 17185 | Members | Not walkable | isolated-components-without-entry |
| 17186 | Surface region 17186 | Members | Not walkable | isolated-components-without-entry |
| 17187 | Surface region 17187 | Members | Not walkable | isolated-components-without-entry |
| 17188 | Surface region 17188 | Members | Not walkable | isolated-components-without-entry |
| 17189 | Surface region 17189 | Members | Not walkable | isolated-components-without-entry |
| 17190 | Surface region 17190 | Members | Not walkable | isolated-components-without-entry |
| 17430 | Surface region 17430 | Members | Not walkable | isolated-components-without-entry |
| 17432 | Surface region 17432 | Members | Not walkable | isolated-components-without-entry |
| 17433 | Surface region 17433 | Members | Not walkable | isolated-components-without-entry |
| 17434 | Surface region 17434 | Members | Not walkable | isolated-components-without-entry |
| 17435 | Surface region 17435 | Members | Not walkable | isolated-components-without-entry |
| 17436 | Surface region 17436 | Members | Not walkable | isolated-components-without-entry |
| 17437 | Surface region 17437 | Members | Not walkable | isolated-components-without-entry |
| 17438 | Surface region 17438 | Members | Not walkable | isolated-components-without-entry |
| 17439 | Surface region 17439 | Members | Not walkable | isolated-components-without-entry |
| 17440 | Surface region 17440 | Members | Not walkable | isolated-components-without-entry |
| 17441 | Surface region 17441 | Members | Not walkable | isolated-components-without-entry |
| 17442 | Surface region 17442 | Members | Not walkable | isolated-components-without-entry |
| 17443 | Surface region 17443 | Members | Not walkable | isolated-components-without-entry |
| 17444 | Surface region 17444 | Members | Not walkable | isolated-components-without-entry |
| 17445 | Surface region 17445 | Members | Not walkable | isolated-components-without-entry |
| 17446 | Surface region 17446 | Members | Not walkable | isolated-components-without-entry |
| 17686 | Surface region 17686 | Members | Not walkable | isolated-components-without-entry |
| 17687 | Surface region 17687 | Members | Not walkable | isolated-components-without-entry |
| 17688 | Surface region 17688 | Members | Not walkable | isolated-components-without-entry |
| 17689 | Surface region 17689 | Members | Not walkable | isolated-components-without-entry |
| 17690 | Surface region 17690 | Members | Not walkable | isolated-components-without-entry |
| 17691 | Surface region 17691 | Members | Not walkable | isolated-components-without-entry |
| 17692 | Surface region 17692 | Members | Not walkable | isolated-components-without-entry |
| 17695 | Surface region 17695 | Members | Not walkable | isolated-components-without-entry |
| 17696 | Surface region 17696 | Members | Not walkable | isolated-components-without-entry |
| 17697 | Surface region 17697 | Members | Not walkable | isolated-components-without-entry |
| 17698 | Surface region 17698 | Members | Not walkable | isolated-components-without-entry |
| 17699 | Surface region 17699 | Members | Not walkable | isolated-components-without-entry |
| 17700 | Surface region 17700 | Members | Not walkable | isolated-components-without-entry |
| 17701 | Surface region 17701 | Members | Not walkable | isolated-components-without-entry |
| 17702 | Surface region 17702 | Members | Not walkable | isolated-components-without-entry |
| 17719 | Surface region 17719 | Members | Not walkable | isolated-components-without-entry |
| 17942 | Surface region 17942 | Members | Not walkable | isolated-components-without-entry |
| 17943 | Surface region 17943 | Members | Not walkable | isolated-components-without-entry |
| 17944 | Surface region 17944 | Members | Not walkable | isolated-components-without-entry |
| 17945 | Surface region 17945 | Members | Not walkable | isolated-components-without-entry |
| 17946 | Surface region 17946 | Members | Not walkable | isolated-components-without-entry |
| 17947 | Surface region 17947 | Members | Not walkable | isolated-components-without-entry |
| 17948 | Surface region 17948 | Members | Not walkable | isolated-components-without-entry |
| 17951 | Surface region 17951 | Members | Not walkable | isolated-components-without-entry |
| 17952 | Surface region 17952 | Members | Not walkable | isolated-components-without-entry |
| 17953 | Surface region 17953 | Members | Not walkable | isolated-components-without-entry |
| 17954 | Surface region 17954 | Members | Not walkable | isolated-components-without-entry |
| 17955 | Surface region 17955 | Members | Not walkable | isolated-components-without-entry |
| 17956 | Surface region 17956 | Members | Not walkable | isolated-components-without-entry |
| 17957 | Surface region 17957 | Members | Not walkable | isolated-components-without-entry |
| 17958 | Surface region 17958 | Members | Not walkable | isolated-components-without-entry |
| 18198 | Surface region 18198 | Members | Not walkable | isolated-components-without-entry |
| 18199 | Surface region 18199 | Members | Not walkable | isolated-components-without-entry |
| 18200 | Surface region 18200 | Members | Not walkable | isolated-components-without-entry |
| 18201 | Surface region 18201 | Members | Not walkable | isolated-components-without-entry |
| 18202 | Surface region 18202 | Members | Not walkable | isolated-components-without-entry |
| 18203 | Surface region 18203 | Members | Not walkable | isolated-components-without-entry |
| 18204 | Surface region 18204 | Members | Not walkable | isolated-components-without-entry |
| 18207 | Surface region 18207 | Members | Not walkable | isolated-components-without-entry |
| 18208 | Surface region 18208 | Members | Not walkable | isolated-components-without-entry |
| 18209 | Surface region 18209 | Members | Not walkable | isolated-components-without-entry |
| 18210 | Surface region 18210 | Members | Not walkable | isolated-components-without-entry |
| 18211 | Surface region 18211 | Members | Not walkable | isolated-components-without-entry |
| 18212 | Surface region 18212 | Members | Not walkable | isolated-components-without-entry |
| 18213 | Surface region 18213 | Members | Not walkable | isolated-components-without-entry |
| 18214 | Surface region 18214 | Members | Not walkable | isolated-components-without-entry |
| 18232 | Surface region 18232 | Members | Not walkable | isolated-components-without-entry |
| 18454 | Surface region 18454 | Members | Not walkable | isolated-components-without-entry |
| 18455 | Surface region 18455 | Members | Not walkable | isolated-components-without-entry |
| 18456 | Surface region 18456 | Members | Not walkable | isolated-components-without-entry |
| 18457 | Surface region 18457 | Members | Not walkable | isolated-components-without-entry |
| 18458 | Surface region 18458 | Members | Not walkable | isolated-components-without-entry |
| 18459 | Surface region 18459 | Members | Not walkable | isolated-components-without-entry |
| 18460 | Surface region 18460 | Members | Not walkable | isolated-components-without-entry |
| 18461 | Surface region 18461 | Members | Not walkable | isolated-components-without-entry |
| 18462 | Surface region 18462 | Members | Not walkable | isolated-components-without-entry |
| 18463 | Surface region 18463 | Members | Not walkable | isolated-components-without-entry |
| 18464 | Surface region 18464 | Members | Not walkable | isolated-components-without-entry |
| 18465 | Surface region 18465 | Members | Not walkable | isolated-components-without-entry |
| 18466 | Surface region 18466 | Members | Not walkable | isolated-components-without-entry |
| 18467 | Surface region 18467 | Members | Not walkable | isolated-components-without-entry |
| 18468 | Surface region 18468 | Members | Not walkable | isolated-components-without-entry |
| 18469 | Surface region 18469 | Members | Not walkable | isolated-components-without-entry |
| 18470 | Surface region 18470 | Members | Not walkable | isolated-components-without-entry |
| 18480 | Surface region 18480 | Members | Not walkable | isolated-components-without-entry |
| 18710 | Surface region 18710 | Members | Not walkable | isolated-components-without-entry |
| 18711 | Surface region 18711 | Members | Not walkable | isolated-components-without-entry |
| 18712 | Surface region 18712 | Members | Not walkable | isolated-components-without-entry |
| 18713 | Surface region 18713 | Members | Not walkable | isolated-components-without-entry |
| 18714 | Surface region 18714 | Members | Not walkable | isolated-components-without-entry |
| 18715 | Surface region 18715 | Members | Not walkable | isolated-components-without-entry |
| 18716 | Surface region 18716 | Members | Not walkable | isolated-components-without-entry |
| 18717 | Surface region 18717 | Members | Not walkable | isolated-components-without-entry |
| 18718 | Surface region 18718 | Members | Not walkable | isolated-components-without-entry |
| 18719 | Surface region 18719 | Members | Not walkable | isolated-components-without-entry |
| 18720 | Surface region 18720 | Members | Not walkable | isolated-components-without-entry |
| 18721 | Surface region 18721 | Members | Not walkable | isolated-components-without-entry |
| 18722 | Surface region 18722 | Members | Not walkable | isolated-components-without-entry |
| 18723 | Surface region 18723 | Members | Not walkable | isolated-components-without-entry |
| 18724 | Surface region 18724 | Members | Not walkable | isolated-components-without-entry |
| 18725 | Surface region 18725 | Members | Not walkable | isolated-components-without-entry |
| 18726 | Surface region 18726 | Members | Not walkable | isolated-components-without-entry |
| 18736 | Surface region 18736 | Members | Not walkable | isolated-components-without-entry |
| 18743 | Surface region 18743 | Members | Not walkable | isolated-components-without-entry |
| 18744 | Surface region 18744 | Members | Not walkable | isolated-components-without-entry |
| 18993 | Surface region 18993 | Members | Not walkable | isolated-components-without-entry |
| 18994 | Surface region 18994 | Members | Not walkable | isolated-components-without-entry |
| 18995 | Surface region 18995 | Members | Not walkable | isolated-components-without-entry |
| 19000 | Surface region 19000 | Members | Not walkable | isolated-components-without-entry |
| 19248 | Surface region 19248 | Members | Not walkable | phantom-floor-without-surface |
| 19249 | Surface region 19249 | Members | Not walkable | phantom-floor-without-surface |
| 19250 | Surface region 19250 | Members | Not walkable | phantom-floor-without-surface |
| 19251 | Surface region 19251 | Members | Not walkable | isolated-components-without-entry |
| 19252 | Surface region 19252 | Members | Not walkable | isolated-components-without-entry |
| 19253 | Surface region 19253 | Members | Not walkable | isolated-components-without-entry |
| 19255 | Surface region 19255 | Members | Not walkable | isolated-components-without-entry |

## Exact labels and display records

| Region | Cache text | Exact display tile |
| --- | --- | --- |
| 8750 | Soul Wars | 2207,2955 |
| 10557 | Here Be Penguins | 2624,3963 |
| 10538 | Shattered Worlds | 2676,2693 |
| 14403 | Anachronia Dinosaur Farm | 3643,4290 |
| 16670 | The Arc | 4199,1945 |
| 17714 | Moonsylvar Wood | 4438,3247 |
| 18229 | Exalted Quarry | 4557,3419 |
| 18228 | Berylbrook | 4563,3348 |
| 18230 | Heathervein | 4570,3470 |
| 18226 | Linbog Village | 4599,3255 |
| 18482 | Fenmoor | 4625,3221 |
| 18486 | Divine Fall | 4647,3460 |
| 18737 | Globin Village | 4679,3178 |
| 18997 | Shuruk-Ba | 4747,3396 |

Line breaks in the raw Exalted Quarry, Divine Fall, Shattered Worlds, Here Be Penguins and Anachronia Dinosaur Farm labels are spaces. Coordinates establish the containing region, not the whole named area. Existing resources are not copied or invented.

## Saved-state audit

The supplied read boundary excludes the private current `.local/duo/state.json`; the requested narrow read has not been approved. No saved state was changed. Synthetic tests verify unlocked, selected and pending arrays stay intact, but either player’s current protected IDs remain **unaudited**. If a saved ID is in the 384-region list, its map classification and roll/access eligibility change when this branch is used. A pending offer from that list will be retained but cannot be accepted. Current unlocked IDs are preserved, while excluded geometry cannot seed walking or partner routes.

## Browser evidence

Headless Chrome uses an ephemeral localhost server and synthetic state, the real ChunkMap class, real community assets, the exact copied cache layout and generated terrain. Before uses the original branch source and focused original-renderer PNGs; it reproduces the old underlay and floor behavior without contacting the live picker. Pins are disabled to isolate map terrain/status.

| View | Before | After |
| --- | --- | --- |
| anachronia | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-anachronia.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-anachronia.png) |
| ocean | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-ocean.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-ocean.png) |
| ocean-native | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-ocean-native.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-ocean-native.png) |
| islands | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-islands.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-islands.png) |
| havenhythe | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-havenhythe.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-havenhythe.png) |
| haven-southeast | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-haven-southeast.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-haven-southeast.png) |
| overview | [before](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-overview.png) | [after](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-overview.png) |

All seven before/after pairs were visually checked. The obsolete Anachronia east/north coast disappears; ocean region 14630 matches surrounding ocean; southeast no-entry hatching disappears; Havenhythe retains only evidenced walking regions. The overview checks the whole crop, including western and linked northern edges. Both browser runs have zero page errors. After has zero failed tiles; before has the expected rejected black placeholder at 63,56. Pixel probes at zooms 0.1, 0.35, 0.8 and 2 match exactly after: fogged water and uncovered ocean are RGBA (73,77,82,255). Before, uncovered ocean was (86,87,89,255).

## Generated version and validation

The final renderer version is `.local/map-assets/terrain.cache-mapfix3-transparent-v5/`. Its independent verification covers all **1211 PNGs**, including **518 fully transparent PNGs**, with zero errors: hashes/byte sizes, 256×256 RGBA dimensions, exact map-28 layout addresses, colourless transparent pixels and coverage counts. PNGs total 20,125,532 bytes. The mask removes 48,528,123 shared-water pixels and 282,870 void pixels while retaining 30,553,103 artwork pixels. All comparable original-renderer probes retain artwork byte-for-byte.

The version manifest SHA-256 is `18f1c1430737d94b7d790ee8cda6658e68825549f50f47588d7bebf84208ba90`. The new selected asset root is `.local/mapfix3/map-assets-v5/`, with copies of community terrain, current pins/icons/sprites and the v5 cache renders. Existing manifests and assets were not replaced. To select these files for a separately managed server, set `RS3_MAP_ASSETS_DIR` to `C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/map-assets-v5`. No server or live configuration was changed.

`npm test -- --test-concurrency=4` passed **941 tests**, zero failures/skips. Reduced concurrency retains the complete suite and avoids contention in the Windows process-helper timing checks. New regressions cover terrain source alignment at overview/native densities, transparent water/void and preserved floors, island qualification, blocked-origin traversal, restored pending offers, audited data corrections and browser data imports.

## Source evidence

- [Versioned surface corrections](../../app/data/cache-surface-corrections.2026-10-08.v1.json): copied archive hashes, floor-field histograms, exact portal witnesses, masks, label coordinates and layout transforms.
- [Typed entry policy](../../app/data/cache-entry-policy.mjs): pinned Wiki revisions and retained typed route/lodestone data. Penguin region 10301 is the inaccessible eastern island; the AJS route lands at 10044.
- [Complete machine-readable change report](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/walkability-changes.json).
- [Raw Havenhythe audit](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/haven-audit.json).
- [Renderer probe preservation](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/terrain-probe-verification-final-v5.json).
- [Full PNG verification](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/terrain.cache-mapfix3-transparent-v5-verification.json).
- [Before browser report](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/before-visual-report.json) and [after browser report](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/after-visual-report.json).
- [Full test log](C:/Users/User/Projects/chunk-picker-rs3-wt/mapfix3/.local/mapfix3/full-tests-verified.log).
