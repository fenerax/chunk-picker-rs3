# H8: Missing task pictures

Worktree: `taskicons`, branch `codex/taskicons`. The copied save was read on October 12, 2026. The measurement uses the production worker, definitions/corrections, task presentation and both players' saved rules. It makes no server, store, network or save writes and checks every copied input file's SHA-256 before and after. The original save and game cache were never modified.

## Measurement

`scripts/review-task-icons.mjs --save .local/taskicons-save --baseline` prints the complete missing-row list, grouped reasons, candidate names, pinned manifest rejection reasons and conservative alias suggestions. `--current` selects the remaining rows instead. Both modes report before/after counts; the baseline uses only the immutable October 8/9 manifests and the original item-or-skill resolution.

| Player | Visible possible rows | Missing before | Missing after | All available own obligations | Missing before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Player 1 | 1,392 | 368 | 5 | 1,650 | 626 → 5 |
| Player 2 | 1,366 | 368 | 5 | 1,626 | 628 → 5 |

Visible possible rows exclude engine-hidden and backlogged rows, with completion/search/category filters unapplied. The broader production `availableCount` includes hidden/completed/backlogged obligations. These current copied-save totals differ from the roadmap's earlier 348/1,328 snapshot. Neither player has an icon regression.

Initial visible missing rows by category:

| Category | Player 1 | Player 2 |
| --- | ---: | ---: |
| Quest | 45 | 49 |
| Diary | 128 | 125 |
| Nonskill | 181 | 179 |
| Combat | 1 | 2 |
| Extra | 2 | 2 |
| BiS item | 11 | 11 |
| Total | 368 | 368 |

The script's initial reason groups are 173/174 category rows (Quest/Diary), 176/174 rows with no item candidate, and 19/20 unresolved candidate names, for Player 1/Player 2 respectively. There are zero suggested spelling aliases in either player's missing rows. Candidate names include non-item Wiki markers such as NPCs, places, abilities and Slayer points; their presence is not an item identity. All 357 non-inventory missing rows per player receive category or skill artwork. The 11 actual missing inventory goals per player are one missing infobox (First tower hat), four ambiguous variant images (Ghost hunter), and six names with no exact infobox-name variant (Monk's/Priest/Zamorak robes).

The complete per-row JSON is retained locally in `.local/taskicons-before.json`; it contains no invitation/access tokens. The source revision and checksums identify the measured copy. Delete the temporary save copies after acceptance.

## Matching and shared rendering

`app/tasks/task-icons.mjs` exposes `taskIcon(task, { itemIcon, skillIcon })` and `taskCategoryIcon(category, skillIcon)`. Resolution prefers an exact catalogue item, then the task's skill, then the task category. Explicit inventory goals stay blank when unresolved. No plural, dose, charge, unfinished, set or tier suffix is stripped at runtime. Normalization still handles case, NFKC and whitespace; the new inventory supplement contains four explicit typographic-apostrophe aliases for the two Monk's robe names.

Tasks and duo rows use the existing painter, so their controls and layout remain intact. A late manifest replaces a temporary fallback in the existing image. Search, Activity Info, task hover cards and Chunk Info use the same resolver. Search data loads independently of the optional icon request. Task images remain 22×22; category headings remain 18×18 and hover pictures remain 32×32. Existing local SVGs supply category/skill fallbacks, including Quest, Achievement/Diary, Activity/Nonskill/Extra, Clue, Combat and all 29 skills. Strict CSP is unchanged.

## Offline inventory supplement

The compact manifest version is now `/assets/map/icons.2026-10-12.v1.json`. The new `app/data/item-icons.2026-10-12.v1.json` and `icons-items.2026-10-12.v1/` supplement contain six exact retained inventory PNGs, **2,878 bytes** total:

- First tower hat
- Monk's robe (bottom) and (top)
- Priest gown (bottom) and (top)
- Zamorak robe (top)

`scripts/export-retained-item-icons.mjs` reads the already tracked `resources/equipment_icons` artwork. The retained upstream renderer binds the exact equipment key by replacing spaces with underscores. Each new record preserves that source path, exact equipment name, reference-record hash, PNG hash, byte count, dimensions and binding provenance. It supplies artwork only, without inventing a cache ID or Wiki revision. The exporter refuses existing output folders or manifests.

For a fresh reproduction, download `index.js` from the upstream repository at commit `98a3bdc` (the copy is no longer kept here; the exporter checks its pinned hash), and choose new output paths rather than the finalized tracked manifest:

```powershell
node scripts/export-retained-item-icons.mjs --binding C:/path/to/upstream-index.js --output .local/reproduced-icons-items.2026-10-12.v1 --manifest .local/reproduced-item-icons.2026-10-12.v1.json
```

Compare the reproduced manifest with the tracked one. Install its folder under the icon asset root as `icons-items.2026-10-12.v1`; the existing loader advertises only a matching installed manifest. Acceptance used `.local/icon-assets` with read-only copies of the old bundles and the new supplement through `RS3_ICON_ASSETS_DIR`/`iconAssetsDir`. PNGs remain ignored local assets, following the existing deployment convention. Install the new folder before using the new catalogue on another checkout. No old versioned files were rewritten or deleted.

## Deliberately unresolved

Both players retain the same five blank inventory goals:

- Ghost hunter backpack, body, goggles and legs: the pinned review has three cache variants with differing inventory images, without a binding from the bare task name to a specific artwork variant. The retained filenames alone do not settle that ambiguity.
- Zamorak robe (bottom): no exact retained PNG. Its recorded Wiki ID is 1033; the mapped Zamorak robe legs has cache ID 10468. They must not share an alias. The similarly named tops are also distinct identities, so only the exact parenthesized top PNG was imported.

Zamorak robe (bottom) needs a separately reviewed inventory image/download. Ghost hunter needs variant evidence first; a download may then be necessary if its selected image is not locally retained. No web downloads occurred. The recorded item exporter used Wiki inventory PNGs because the copied-cache headless renderer lacks the inventory camera; adding a new cache item renderer is outside this small repair.

Map badges, duo Backlog/Completed behavior, `screen-backlog.mjs`, old data archival, roadmap and changelog files are untouched.

Integration note: the offline exporter and its provenance test still read the retained reference paths (`index.js`, the definitions JSON and `resources/equipment_icons`). If the separate tidy job relocates those sources, adjust these reader paths during integration. This job does not move or rename them.

## Verification

Focused tests cover local fallback selection, exact and typographic-alias lookup, client/server version agreement, unknown-variant rejection, late picture replacement, diagnostic isolation/rejection reasons and retained PNG provenance. The quick suite passed 695 tests. The final full suite on October 13 passed **3,201 tests**, with zero failures, cancellations or skips, under the shared lock. `SKILL_ICON_ASSET_ROOT` supplied the complete local skill PNG fixture, enabling the optional byte/hash/dimension/alpha check. The first full run exposed the simulated browser's missing helper exports; after updating that fixture's standard DOM methods and label queries, all 234 affected tests passed and the final full run passed. Logs are `.local/taskicons-full-final.log` and `.local/taskicons-browser-fixture.log`.

Browser acceptance passed using only this worktree, a disposable save, picker port 8991, Chrome debugging port 8992 and the shared heavy-work lock. Samples had pictures on 70/70 personal Diary rows, 66/66 rendered duo rows, 120/120 Search rows and 3/3 expanded quest rows in Activity Info. The duo sample was captured during asynchronous partner loading; the separate worker audit supplies complete counts for both players. All six new PNG routes returned HTTP 200 with their recorded byte counts. There were zero broken icon images and no horizontal overflow at 1440 or 390 CSS pixels. Both processes closed and the disposable browser save/profile were removed before the full suite started under the same lease.

Screenshots: `.local/screens/taskicons-desktop-1440.png`, `taskicons-phone-390.png`, `taskicons-duo-1440.png`, `taskicons-search-1440.png` and `taskicons-activity-1440.png`. `.local/taskicons-browser-report.json` retains the browser results. These are desktop Chrome captures at desktop and phone viewport sizes, not physical-phone acceptance. All temporary save copies and the browser profile were deleted; picker/browser processes closed. Only the read-only row audit and verification artifacts remain.
