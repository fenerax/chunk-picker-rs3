# Surface pin exclusions

Audited 7 October 2026 against the approved private asset cache, without modifying its raw files. The source is [mejrs/data_rs3 at b8424a43d8370adc71de53f7d6438ad0f77d0944](https://github.com/mejrs/data_rs3/tree/b8424a43d8370adc71de53f7d6438ad0f77d0944); positions date from 18 December 2021. Surface terrain evidence comes from [layers_rs3 at f1e12f444ddb0f7e594d9e213dd2758cb377cc46](https://github.com/mejrs/layers_rs3/tree/f1e12f444ddb0f7e594d9e213dd2758cb377cc46).

## Evidence and policy

The 4,857 original rows comprise 3,769 objects, 865 icons and 223 maplinks. No original row has a top-level map ID. The 223 maplinks supply an explicit destination map/plane/coordinate; 109 destinations name surface map 28. The approved raw cache contains only original_sprite_locations.json, map_labels.json, map_label_locations.json and Wiki icon metadata. It contains no map-paste definitions or global source-to-display transforms.

Normalization accepts explicit map-28/plane-0 destinations in the picker crop, including surface maplinks whose destination tile has missing terrain. Untagged placements require downloaded map-28/plane-0 terrain coverage for their 64-tile square. Missing, empty, pending or unrecorded terrain is insufficient evidence, and such crop candidates are excluded as **surface-unverified**. A missing tile does not establish that a location is ocean, prove a dungeon/map identity or prove absence of content. This conservative policy can omit real surface content where terrain coverage is missing. Downloaded terrain establishes supporting coverage, not an exact location's land/water status or decoded source map membership.

Explicit non-surface map IDs and destination planes are rejected before coordinate/crop checks. Maplinks use destination coordinates/floor/map even when the source is another map or plane; incomplete maplinks never infer a destination map from terrain. No global instance is relocated by guessing a coordinate offset. In particular, the Prifddinas instance lodestones at 4576/2665 are excluded, not moved to the surface.

Some raw properties carry numeric unk_249[4147] values (935 rows); examples include 24 for the Prifddinas lodestones, 51 for Haunted Mine Level 5 and 500 for the Zanaris fairy ring. These fields are retained unchanged as evidence. Their semantic meaning is not decoded by this importer, and they are not promoted into source map IDs. Label definitions and nearby label placements corroborate specific suspicious clusters without supplying their transformation.

Markers sharing destination map, plane, coordinates and current sprite are consolidated. The first source row supplies the visible marker and stable ID; every alternate row's ID, source, label, background and conditions remain in its variants array and the exclusions list. Different current sprites at a coordinate remain separate, including activated/unactivated lodestones and quest states. The importer does not resolve player conditions or assume all retained states are simultaneously visible. Ordinals are assigned before filtering so coverage changes do not renumber source identities.

## Measured result

| Outcome | Rows |
| --- | ---: |
| Raw placements | 4,857 |
| Previous crop/plane-0 eligible pins | 2,242 |
| Retained displayed markers | 2,054 |
| Newly removed surface-unverified pins | 151 |
| Newly consolidated duplicate markers | 37 |
| All excluded rows | 2,803 |
| Outside crop | 1,916 |
| Non-surface plane | 584 |
| Explicit non-surface map | 114 |
| Missing current sprite | 1 |

Reasons are mutually exclusive and applied in this order: non-surface map, non-surface plane, outside crop, missing sprite, surface-unverified, duplicate-current-sprite. Changing the reason order can change per-reason totals for rows violating several conditions; it does not change eligible output. Of 109 raw surface-map destinations, 103 markers remain after crop/duplicate filtering.

## Reproduction and retained provenance

The processed JSON retains schemaVersion 1 and adds normalizationVersion 2, normalization counts, and a complete exclusions array for all 2,803 excluded raw rows. Each exclusion has a stable source ID/index, original coordinates/plane, raw maplink, display coordinates/map/plane, sprite, label, conditions, reason and any coverage/duplicate evidence. The normalized pin source mapId remains null for untagged rows, even when the displayed map is 28. Raw files remain the canonical complete source records.

Run the following explicit offline repair from the authored checkout:

```powershell
node scripts/import-map-assets.mjs --output C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets --rebuild-pins
```

This mode verifies pinned manifest versions, hashes/sizes of all three coordinate raw files, and every downloaded terrain tile before writing. It performs no network requests and modifies only pins.normalized.json and manifest.json; it preserves raw files, terrain, icons and manifest completion state. It recalculates processed-file hashes, pin/exclusion counts and manifest asset totals. It refuses --download together with --rebuild-pins. Normal full imports apply the same policy after terrain coverage is downloaded. Existing normalized files require this rebuild; a browser reload alone does not reprocess old source rows.

Coordinate source hashes:

| Raw asset | SHA-256 |
| --- | --- |
| original_sprite_locations.json | 896a27ac2e40120752e533677c1ea597e717281d89014eaa7925ea21dac1efe5 |
| map_labels.json | 21a6e5f737c9238f17804f4e63f342894aa78df7619219c9950a89045e475234 |
| map_label_locations.json | 0401ac07c47f1d71b42ed1cc079e3613fde78c3ebabee0f8bdb347b88c80efaf |

## Coordinate samples and limits

The approved raw records retain Lumbridge bank 3215/3257, Varrock east bank 3254/3420 and the altar north of Falador 2978/3407. Their coverage-backed output retains picker chunks 12850, 12853 and 11829 and logical positions 2719/2701, 2797/2375 and 2245/2401. Falador Castle altar at 2982/3346 on plane 2 remains excluded. These checks establish source/conversion consistency; they do not constitute browser or terrain visual alignment checks.

The Kalphite cluster has label placements for Kalphite soldiers (2994/1660), guardians (2994/1630), graveyard (2952/1641), Queen's Chamber (2966/1707) and King's Chamber (2974/1765), plus a maplink from 2949/1659 to surface 3238/2856. It supports treating objects 2958/1661 and 2964/1658 as unresolved non-surface candidates while retaining the explicit entrance destination. Haunted Mine tooltips identify source 2724/4434 and neighbouring rows as mine-level resources. Prifddinas label ID 198 is located at 4576/2656, beside its two excluded conditional lodestones at 4576/2665. The repeated citadel pedestal/portal placements remain raw evidence; no citadel-to-surface transform is invented.

## Detailed changes to the previously displayed set

The following list contains every one of the 188 previously eligible rows removed or consolidated. The processed JSON additionally lists all rows already rejected by crop, plane, map or sprite. Index is zero-based in the pinned original source.

| Source index | Display X/Y | Current sprite | Source label/category | Reason | Retained source index |
| ---: | --- | ---: | --- | --- | ---: |
| 806 | 1935/4362 | 22423 | Mini obelisk | surface-unverified | — |
| 820 | 2032/4369 | 22416 | Cooking range | surface-unverified | — |
| 987 | 2207/4368 | 22360 | General store | surface-unverified | — |
| 1035 | 2254/4428 | 20764 | Transportation | surface-unverified | — |
| 1036 | 2289/4518 | 22347 | Other / unmapped | surface-unverified | — |
| 1037 | 2277/4515 | 22432 | Burthorpe Mine | surface-unverified | — |
| 1197 | 2399/4379 | 20767 | Dungeon | surface-unverified | — |
| 1198 | 2400/4403 | 20763 | Shortcut | surface-unverified | — |
| 1199 | 2408/4395 | 20763 | Shortcut | surface-unverified | — |
| 1200 | 2415/4402 | 20763 | Shortcut | surface-unverified | — |
| 1201 | 2408/4377 | 22436 | Runecrafting altar | surface-unverified | — |
| 1202 | 2377/4447 | 22360 | General store | surface-unverified | — |
| 1203 | 2383/4459 | 18952 | Bank | surface-unverified | — |
| 1204 | 2399/4474 | 22411 | Furnace | surface-unverified | — |
| 1205 | 2413/4464 | 22431 | Rare tree | surface-unverified | — |
| 1206 | 2411/4427 | 22433 | Water source | surface-unverified | — |
| 1207 | 2383/4439 | 22416 | Cooking range | surface-unverified | — |
| 1208 | 2403/4457 | 22417 | Windmill | surface-unverified | — |
| 1209 | 2406/4459 | 22409 | Dairy churn | surface-unverified | — |
| 1210 | 2405/4443 | 22423 | Mini obelisk | surface-unverified | — |
| 1284 | 2461/4290 | 22360 | General store | surface-unverified | — |
| 1285 | 2448/4325 | 18952 | Bank | surface-unverified | — |
| 1286 | 2449/4311 | 22433 | Water source | surface-unverified | — |
| 1287 | 2462/4309 | 22433 | Water source | surface-unverified | — |
| 1288 | 2462/4313 | 22433 | Water source | surface-unverified | — |
| 1289 | 2474/4312 | 22433 | Water source | surface-unverified | — |
| 1290 | 2485/4452 | 22365 | Sword shop | surface-unverified | — |
| 1291 | 2476/4468 | 22378 | Gem shop | surface-unverified | — |
| 1292 | 2466/4427 | 22431 | Rare tree | surface-unverified | — |
| 1293 | 2492/4426 | 22431 | Rare tree | surface-unverified | — |
| 1294 | 2444/4432 | 22357 | Slayer master | surface-unverified | — |
| 1295 | 2452/4471 | 20764 | Transportation | surface-unverified | — |
| 1296 | 2484/4471 | 20764 | Transportation | surface-unverified | — |
| 1297 | 2439/4442 | 22438 | Sandpit | surface-unverified | — |
| 1298 | 2435/4450 | 511 | Other / unmapped | surface-unverified | — |
| 1299 | 2468/4421 | 14182 | Other / unmapped | surface-unverified | — |
| 1300 | 2479/4447 | 14182 | Other / unmapped | surface-unverified | — |
| 1301 | 2446/4604 | 20767 | Dungeon | surface-unverified | — |
| 1791 | 2712/4315 | 22416 | Cooking range | surface-unverified | — |
| 1792 | 2730/4307 | 22423 | Mini obelisk | surface-unverified | — |
| 1793 | 2724/4434 | 22432 | Haunted Mine - Level 5 | surface-unverified | — |
| 1794 | 2748/4437 | 22432 | Haunted Mine - Level 5 | surface-unverified | — |
| 1795 | 2716/4491 | 22432 | Haunted Mine - Level 3 | surface-unverified | — |
| 1908 | 2765/4439 | 22432 | Haunted Mine - Level 6 | surface-unverified | — |
| 1909 | 2784/4436 | 22432 | Haunted Mine - Level 6 | surface-unverified | — |
| 1910 | 2791/4436 | 22432 | Haunted Mine - Level 6 | surface-unverified | — |
| 1911 | 2804/4445 | 22432 | Haunted Mine - Level 6 | surface-unverified | — |
| 1912 | 2775/4419 | 22432 | Haunted Mine - Level 6 | surface-unverified | — |
| 1913 | 2806/4580 | 22432 | Haunted Mine - Level 2 | surface-unverified | — |
| 1914 | 2785/4599 | 22432 | Haunted Mine - Level 2 | surface-unverified | — |
| 1915 | 2776/4595 | 22432 | Haunted Mine - Level 2 | surface-unverified | — |
| 1916 | 2769/4592 | 22432 | Haunted Mine - Level 2 | surface-unverified | — |
| 2029 | 2863/4260 | 22408 | Anvil | surface-unverified | — |
| 2030 | 2860/4264 | 22435 | Farming patch | surface-unverified | — |
| 2163 | 2922/4290 | 22411 | Furnace | surface-unverified | — |
| 2164 | 2921/4337 | 20767 | Dungeon | surface-unverified | — |
| 2218 | 2958/1661 | 22423 | Mini obelisk | surface-unverified | — |
| 2219 | 2964/1658 | 20763 | Shortcut | surface-unverified | — |
| 2296 | 2987/4374 | 22405 | Altar | surface-unverified | — |
| 2381 | 3024/4491 | 22432 | Mining site | surface-unverified | — |
| 2382 | 3042/4510 | 22430 | Fishing spot | surface-unverified | — |
| 2494 | 3184/1625 | 21090 | Other / unmapped | surface-unverified | — |
| 2596 | 3194/4571 | 18952 | Bank | surface-unverified | — |
| 2818 | 3295/4186 | 22405 | Altar | surface-unverified | — |
| 2819 | 3296/4339 | 22433 | Water source | surface-unverified | — |
| 2820 | 3297/4380 | 22433 | Water source | surface-unverified | — |
| 2821 | 3298/4353 | 22423 | Mini obelisk | surface-unverified | — |
| 2954 | 3416/4369 | 20767 | Dungeon | surface-unverified | — |
| 2955 | 3423/4375 | 20767 | Dungeon | surface-unverified | — |
| 3218 | 3968/4561 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3245 | 4096/4561 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3286 | 4248/3945 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3287 | 4278/4106 | 22440 | Clan portal | surface-unverified | — |
| 3288 | 4224/4178 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3289 | 4278/4234 | 22440 | Clan portal | surface-unverified | — |
| 3290 | 4224/4306 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3291 | 4278/4362 | 22440 | Clan portal | surface-unverified | — |
| 3292 | 4224/4434 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3293 | 4278/4490 | 22440 | Clan portal | surface-unverified | — |
| 3294 | 4224/4561 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3321 | 4351/4132 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3322 | 4351/4260 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3323 | 4351/4388 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3324 | 4351/4516 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3349 | 4406/4106 | 22440 | Clan portal | surface-unverified | — |
| 3350 | 4352/4178 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3351 | 4406/4234 | 22440 | Clan portal | surface-unverified | — |
| 3352 | 4352/4306 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3353 | 4406/4362 | 22440 | Clan portal | surface-unverified | — |
| 3354 | 4352/4434 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3355 | 4406/4490 | 22440 | Clan portal | surface-unverified | — |
| 3356 | 4352/4561 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3374 | 4470/4136 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3375 | 4448/4194 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3376 | 4470/4264 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3377 | 4448/4322 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3378 | 4470/4392 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3379 | 4448/4450 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3380 | 4470/4520 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3381 | 4448/4577 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3388 | 4534/4136 | 22440 | Clan portal | surface-unverified | — |
| 3389 | 4534/4264 | 22440 | Clan portal | surface-unverified | — |
| 3390 | 4534/4392 | 22440 | Clan portal | surface-unverified | — |
| 3391 | 4534/4520 | 22440 | Clan portal | surface-unverified | — |
| 3420 | 4598/4136 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3421 | 4576/4194 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3422 | 4598/4264 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3423 | 4576/4322 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3424 | 4598/4392 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3425 | 4576/4450 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3426 | 4598/4520 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3427 | 4576/4577 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3439 | 4662/4136 | 22440 | Clan portal | surface-unverified | — |
| 3440 | 4662/4264 | 22440 | Clan portal | surface-unverified | — |
| 3441 | 4662/4392 | 22440 | Clan portal | surface-unverified | — |
| 3442 | 4662/4520 | 22440 | Clan portal | surface-unverified | — |
| 3464 | 4726/4136 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3465 | 4704/4194 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3466 | 4726/4264 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3467 | 4704/4322 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3468 | 4726/4392 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3469 | 4704/4450 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3470 | 4726/4520 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3471 | 4704/4577 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3488 | 4790/4136 | 22440 | Clan portal | surface-unverified | — |
| 3489 | 4790/4264 | 22440 | Clan portal | surface-unverified | — |
| 3490 | 4790/4392 | 22440 | Clan portal | surface-unverified | — |
| 3491 | 4790/4520 | 22440 | Clan portal | surface-unverified | — |
| 3503 | 4854/4136 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3504 | 4832/4194 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3505 | 4854/4264 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3506 | 4832/4322 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3507 | 4854/4392 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3508 | 4832/4450 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3509 | 4854/4520 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3510 | 4832/4577 | 22442 | Clan Citadel pedestal | surface-unverified | — |
| 3769 | 2412/4434 | 132 | Fairy ring | surface-unverified | — |
| 3770 | 2455/4396 | 132 | Fairy ring | surface-unverified | — |
| 3775 | 3077/4235 | 1295 | Other / unmapped | surface-unverified | — |
| 3804 | 3277/4371 | 21017 | Other / unmapped | surface-unverified | — |
| 3805 | 3319/4370 | 21017 | Other / unmapped | surface-unverified | — |
| 3806 | 3275/4335 | 21017 | Other / unmapped | surface-unverified | — |
| 3807 | 3315/4335 | 21017 | Other / unmapped | surface-unverified | — |
| 3859 | 3488/3483 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 3858 |
| 3972 | 2290/3146 | 21017 | Other / unmapped | duplicate-current-sprite | 3950 |
| 3973 | 2290/3146 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 3951 |
| 3974 | 2206/3160 | 21017 | Other / unmapped | duplicate-current-sprite | 3952 |
| 3975 | 2206/3160 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 3953 |
| 4022 | 2918/3561 | 21017 | Other / unmapped | duplicate-current-sprite | 3860 |
| 4023 | 2918/3561 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 3861 |
| 4052 | 2543/3167 | 21017 | Other / unmapped | duplicate-current-sprite | 4018 |
| 4053 | 2543/3167 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4019 |
| 4188 | 2352/3172 | 21017 | Other / unmapped | duplicate-current-sprite | 4118 |
| 4189 | 2352/3172 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4119 |
| 4251 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4252 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4253 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4254 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4255 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4256 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4257 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4258 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4259 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4260 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4261 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4262 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4263 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4264 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4265 | 2959/3439 | 21017 | Other / unmapped | duplicate-current-sprite | 4172 |
| 4266 | 2959/3439 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4173 |
| 4405 | 4576/2665 | 25254 | Lodestone (activated icon) | surface-unverified | — |
| 4406 | 4576/2665 | 25253 | Lodestone | surface-unverified | — |
| 4460 | 3041/4532 | 132 | Fairy ring | surface-unverified | — |
| 4568 | 2784/4267 | 21017 | Other / unmapped | surface-unverified | — |
| 4569 | 2784/4267 | 21084 | Quest (in-progress icon) | surface-unverified | — |
| 4573 | 2468/4189 | 132 | Fairy ring | surface-unverified | — |
| 4576 | 2579/4450 | 21017 | Other / unmapped | surface-unverified | — |
| 4577 | 2579/4450 | 21084 | Quest (in-progress icon) | surface-unverified | — |
| 4590 | 1888/3178 | 21017 | Other / unmapped | duplicate-current-sprite | 4120 |
| 4591 | 1888/3178 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4121 |
| 4592 | 1890/3176 | 21017 | Other / unmapped | duplicate-current-sprite | 4206 |
| 4593 | 1890/3176 | 21084 | Quest (in-progress icon) | duplicate-current-sprite | 4207 |
| 4703 | 3081/3421 | 20903 | Dungeon exit | duplicate-current-sprite | 4702 |
| 4704 | 3081/3421 | 20903 | Dungeon exit | duplicate-current-sprite | 4702 |
| 4705 | 3081/3421 | 20903 | Dungeon exit | duplicate-current-sprite | 4702 |
| 4842 | 3039/3763 | 20903 | Dungeon exit | duplicate-current-sprite | 4656 |
| 4843 | 3073/3649 | 20903 | Dungeon exit | duplicate-current-sprite | 4657 |
| 4852 | 3291/2709 | 20903 | Dungeon exit | duplicate-current-sprite | 4848 |

## Verification

All 14 importer regression tests passed on 7 October 2026. An offline reproduction inside this worktree copied the approved source/terrain cache and confirmed that all 1,164 copied cached files were byte-identical after rebuilding. All 2,054 retained IDs matched IDs in the original normalized file. The importer regression suite covers default conservative filtering, missing/empty/pending coverage, explicit surface/non-surface map IDs, floors, partial maplinks, transformed source maps/planes, duplicate conditional provenance, landmark conversions, hashes, and offline-only writes. Run `node --test tests/map-assets-import.test.mjs`. Browser alignment, full current map completeness and conditional state resolution remain separate checks.
