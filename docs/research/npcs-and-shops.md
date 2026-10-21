# NPC definitions and shop stock

This extract decodes **32,905 NPC definitions** and **957 inventory definitions**, including **544 inventories with 6,329 encoded stock rows**. It confirms substantial static NPC and stock metadata. NPC spawn positions are server-side and are not in this cache; no positions, chunk counts, drop tables or spawn changes are inferred.

The statement in the earlier cache-game-data research that ordinary shop stock was unavailable was too broad. Inventory opcode `shopdata` supplies item IDs and unsigned-short default stock quantities. The unresolved part is identifying and interpreting every inventory as a current named shop. Six complete inventories or inventory combinations have independent dated Wiki witnesses and are available through an opt-in contents overlay. The six item-name sets already match the picker, so the overlay currently changes no obtainable items or tasks.

## Scope and provenance

All implementation changes are in `codex/npcshops`, based on `claude/redesign` at `1c64928`. Scratch work reused `C:/Users/User/Projects/rs3-cache-work/cache-copy` and the pristine [rsmv decoder at a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). Schema build **950 is inferred compatibility**, not an independently verified game build or a guarantee of live freshness. No original game-cache database was opened, no game client or running picker was used, and no additional original JS5 copies were needed.

Authoritative new, immutable output directories:

- NPCs: `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/npcs-2026-10-08-v3`. Manifest SHA-256 `3292754c2b79d3fe1ada582a080949a52864f3f698c2da626c2e26f422d674b1`.
- Shops: `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/shops-2026-10-08-v1`. Manifest SHA-256 `e32f3be215d8176a711b9bca21b0f312515b4135dcf5ea6ca70c144ac0547a08`.

Earlier NPC v1/v2 directories are intermediate outputs and are not selected by the runtime. The manifests bind copied database hashes and timestamps, every read decompressed archive hash and subfile list, decoder/schema/interpreter hashes, per-definition hashes, implementation hashes and output hashes. Repository text hashes use `scripts/lib/provenance-hash.mjs` with CRLF pairs normalized to LF; copied databases and external local artifacts use exact bytes. Existing `.gitattributes` rules cover every new `.mjs`, `.json` and `.md` file with `text eol=lf`.

The retained source is `rs3-chunkpicker-chunkinfo-export.json`, canonical LF SHA-256 `9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553`. Compact, committed reviews are [NPC comparison](cache-game-data-npcs.2026-10-08.v1.json), [NPC Wiki validation](npc-wiki-validation.2026-10-08.v1.json), [shop investigation](cache-game-data-shops.2026-10-08.v1.json) and [application/fixture review](npcs-and-shops.2026-10-08.v1.json).

## NPC fields and comparison

NPC major **18**, groups of **128**, contains **32,905 declared and decoded definitions across 258 archives**, with zero errors and complete subfile accounting. The export retains names, combat levels, separately indexed ordinary and member-only right-click options, explicit sizes, raw definitions and extra params, conditional morph branches, varp/varbit selectors, defaults and all possible target IDs. It contains 28,400 usable named records, 21,040 explicit sizes, 20,280 records with ordinary options, 110 with member-only options, 12,326 with extra params and 3,927 morph records. Morphs remain conditional alternatives; the export never selects a current branch from unknown player state.

The pinned schema has **no overall NPC membership field**. Every exported `members` value is `null`. A Banker can have a member-only option without being a members-only NPC. Therefore NPC membership mismatches cannot be established against the cache, and **zero membership corrections** are applied. The existing picker access policies remain the source of its behavioral membership gates.

Five numeric extra-param mappings are explicitly marked as inferred and independently sample-calibrated:

| Param | Interpretation | Decoded records |
| --- | --- | ---: |
| 641 / 10 | Maximum melee hit | 7,296 |
| 965 / 10 | Maximum magic hit | 5,095 |
| 29 | Melee accuracy | 7,397 |
| 3 | Magic accuracy | 5,019 |
| 2865 | Armour | 8,542 |

These are client combat values, not a kill-time or damage model. In particular, param 641 is **not life points**: Cow's value 200 agrees with maximum hit 20, whereas its Wiki life points are 1,000. No tested param consistently represents sampled life points. `lifePoints` stays `null`; attack speed, complete offensive levels, XP, server behavior and uncalibrated params remain unknown. Raw params survive for later work.

The comparison covers 4,578 distinct retained names from chunk NPC/Monster entries and nested sections, drop sources, Slayer entries, aliases and boss declarations. **2,020 names have one exact definition candidate, 2,054 have multiple and 504 have none**. Those groups overlap the cohorts below; the rows are not additive.

| Picker cohort | Distinct names | Exact-name joins | Unmatched |
| --- | ---: | ---: | ---: |
| Chunk NPC entries | 3,287 | 3,119 | 168 |
| Chunk Monster entries | 1,199 | 945 | 254 |
| Drop sources | 1,038 | 756 | 282 |
| Slayer monster entries | 149 | 136 | 13 |
| Boss declarations | 50 | 45 | 5 |

Every match retains all definition candidates and combat levels. The report flags **466** case, qualifier/base-name or near-spelling candidate groups; these are review suggestions, not certified renames. For example, retained `Bob (smith)` has candidates named `Bob`, and an independent Wiki ID 519 distinguishes the smith from other Bobs. No retained labels or identity keys are renamed. An unmatched name does not prove removal, because retained qualifiers and Wiki anchors often differ from literal client names.

The picker has no standalone combat-level/membership table for these NPCs. The new versioned metadata corrections fill seven previously empty combat-level facts: **Air wizard 16, Earth wizard 22, Water wizard 19, Fire wizard 25, Black bear 23, Calf 1 and Catablepon 43**. Each passes both an all-exact-cache-candidates level guard and an explicit Wiki-ID comparison. Runtime rechecks the complete candidate-ID set before exposing a correction. These facts are display metadata; they do not alter access, tasks, drop sources or chunk placement.

Wiki validation uses 17 named samples, 56 ID-bound combat-level matches, six unavailable Wiki levels and zero disagreements. Ten generic labels receive no correction. Cow, Chicken, Hill giant, Lesser demon and Giant spider illustrate why: their standard Wiki variants agree, but the cache also contains other same-name levels. [Cow revision 37142844](https://runescape.wiki/w/Special:PermanentLink/37142844), [Hill giant revision 37142826](https://runescape.wiki/w/Special:PermanentLink/37142826) and [Giant spider revision 37136145](https://runescape.wiki/w/Special:PermanentLink/37136145) document the sampled variants. All 17 sampled memberships remain unknown from cache evidence. The validation JSON records exact revisions, IDs, raw fields and calibration receipts.

## Shop stock and its limits

Config major **2**, group **5**, contains 957 inventory definitions with zero errors. Of these, 544 contain `shopdata`, totaling 6,329 item/quantity rows: **5,545 positive and 784 zero-stock rows**. All item IDs resolve in the copied 63,798 item definitions. The exporter preserves zero rows; a default-zero row does not establish an obtainable item source. The other 413 definitions have capacity metadata only. This is not a claim that all 544 inventories are current ordinary shops: unused definitions, reward stores, separate free/paid inventories and special inventories can share this format.

Inventory definitions do not encode a shop name, currency, overall members flag or keeper NPC ID. Those fields are `null`/empty in the cache-derived inventory records. Twenty inventory-typed enums, eight inventory-typed params and 28 structs with such references were found. No NPC contains an inventory-typed param linking its keeper to a shop. The scan decoded 16,755 enums, 53,501 structs and 32,905 NPCs, all without errors.

The interface scan decoded **104,223 components**, with four explicit schema errors retained in the report, 102 shop-related text-hit components and one typed stock-inventory trigger. Interface 197 component 11 refers to inventory 347, while component 13 contains “Magic Training Area shop”. This is a useful same-interface candidate association, not a verified executed server/shop link; it is excluded from runtime replacement. The export also retains 120 reward UI fragments.

All **21,115 clientscript headers** decoded with zero errors, and 54 scripts contain shop-related byte-span strings. Full script interpretation is unavailable because the pinned decoder lacks the local deobfuscation map (`clientScriptDeob not set in args`). Text spans, interface arguments and inventory-like integers alone do not establish live shop identity, currency, restock rules, prices, account limits or keeper links.

The retained picker contains **404 `shopItems` tables and 576 chunk Shop declarations**. Name-set comparison finds 226 tables with exact inventory-set candidates: 187 unique and 39 ambiguous. Another 47 have no overlapping item names. Those are candidate joins only, so whole-catalogue additions/removals and shop renames are not certified. The full comparison preserves every candidate and mismatch for review.

Six named shops pass complete, dated Wiki **item-name/quantity multiset** comparisons. Free and paid rows are retained separately even when their item names repeat. Their **184 rows represent 182 per-shop distinct item names**, and every row has positive stock.

| Reviewed shop | Inventory IDs | Rows | Wiki witness |
| --- | --- | ---: | --- |
| Lowe's Archery Emporium | 7, 556 | 52 | [37168047](https://runescape.wiki/w/Special:PermanentLink/37168047) |
| Aubury's Rune Shop | 5, 557 | 10 | [37108360](https://runescape.wiki/w/Special:PermanentLink/37108360) |
| Betty's Magic Emporium | 25 | 47 | [37120859](https://runescape.wiki/w/Special:PermanentLink/37120859) |
| Valaine's Shop of Champions | 18 | 19 | [37123142](https://runescape.wiki/w/Special:PermanentLink/37123142) |
| Beefy Bill's Supplies | 536 | 16 | [37117521](https://runescape.wiki/w/Special:PermanentLink/37117521) |
| Zaff's Superior Spellcasting | 9 | 40 | [37108358](https://runescape.wiki/w/Special:PermanentLink/37108358) |

The association of these names with inventory IDs uses a unique complete external stock witness, not a cache-encoded name link. All six availability sets already equal their retained `shopItems` tables: **zero certified additions, removals or renames**. Stock quantities supply new metadata. Wiki overall membership and owner names are recorded separately; no currency is inferred where the witness lacks an explicit field. An item's cache `membersMarked` flag is separate again. Beefy Bill's Jug of water pack is explicitly marked members-only by both its item definition and Wiki stock row; this research records that fact without adding an NPC/shop access policy.

Bob's Brilliant Axes is excluded from the reviewed overlay. Its complete candidate set spans inventories 1 and 554, but two mithril throwing-axe rows encode stock **8** versus Wiki **4**. [Bob's shop revision 37176178](https://runescape.wiki/w/Special:PermanentLink/37176178) supplies the conflicting values. The conflict is retained rather than resolved by choosing whichever source is convenient. The old requested Zaff title had no current page; the retained picker already uses the witnessed current name, so no picker rename is needed.

## Runtime hooks and preview

No `app/web` file changes. Claude can use the new authenticated, gzip/ETag-cached **`GET /api/npcs-and-shops`** endpoint. It loads the compact NPC index lazily and separately from gameplay payloads, and returns:

- `npcs.records[exactAuthoredLabel]`: all candidate IDs, combat levels, calibrated stats, size, morph targets, unknown `members`, safe consensus and optional `reviewedMetadata.combatLevel` with cache/Wiki receipts. `spawnPositions` is explicitly `null`.
- `shops.shops[]`: reviewed named stock rows with inventory IDs, item IDs, quantities, item flags and separate Wiki metadata; `contentsEnabled` reports the operator switch.

Server-side helpers are `npcMetadataPayload()` and `lookupNpcMetadata(label)` in `app/data/cache-npcs.mjs`, and `shopMetadataPayload()`/`applyCacheShops()` in `app/data/cache-shops.mjs`. The seven NPC metadata additions fill an empty display namespace and change no behavior.

**`RS3_CACHE_SHOP_CONTENTS=1` defaults OFF.** Set it before starting/restarting an isolated picker to derive the six reviewed shop item tables from positive cache stock rows. The overlay is applied when server definitions load and when ordinary/collection task engines are created. Engines also accept `cacheShops: false/true` and an injected `shopCatalogue` for controlled previews. Exact retained old-value guards preserve customized tables; already-applied values are idempotent. Unmapped, incomplete or conflicting inventories never replace a shop, and the overlay leaves chunk Shop declarations, labels, identity keys and prices alone. Review metadata does not introduce new membership/access gates.

```powershell
node scripts/preview-npcs-and-shops.mjs --state C:/path/to/private-save-copy/state.json
# Optional machine-readable output:
node scripts/preview-npcs-and-shops.mjs --state C:/path/to/private-save-copy/state.json --json
```

The preview requires an explicit copied state path, refuses `.local/duo`, verifies static sidecar hashes and verifies that the input files remain unchanged. It opens no store/server and writes no state. Both sides use the same personal facts and existing metadata/equipment corrections. It reports changed ordinary and collection tasks, visible and hidden equipment duties, saved derived fallbacks, equipment recommendations, shared/own item availability and per-item source differences even when another source still provides the item. Claude should run it on her private save copy; this task used synthetic fixtures only.

The retained-data CLI fixture checked **20,437 Player 1 tasks and 20,375 Player 2 tasks**, with zero task, item-source or equipment changes. The synthetic Wares replacement fixture exercises additions/removals: Player 1 and Player 2 both gain Replacement sword and lose Partner sword through shared availability; only Player 2 gains/loses those own-map sources. Additional regressions cover lost shop sources when drops still supply the item, and lost hidden BiS duties when their display flag is disabled. The committed application review records exact final fixture counts and hashes.

## Reproduction and verification

```powershell
node scripts/cache/game-data-npcs.mjs --workspace C:/Users/User/Projects/rs3-cache-work --output NEW-NPC-directory --calibration C:/Users/User/Projects/rs3-cache-work/npcshops-combat-calibration-2026-10-08.v1.json
node scripts/cache/game-data-shops.mjs --workspace C:/Users/User/Projects/rs3-cache-work --output NEW-SHOP-directory --wiki C:/Users/User/Projects/rs3-cache-work/npcshops-shop-wiki-2026-10-08.v1.json
node --test tests/cache-game-data-npcs.test.mjs tests/cache-game-data-shops.test.mjs tests/npc-metadata-evidence.test.mjs tests/npcs-and-shops-application.test.mjs
npm test -- --test-concurrency=1
```

Output directories/files must be new. Calibration and Wiki snapshots are retained with exact hashes. Independent verification recomputed all 32,905 NPC raw-definition hashes/source links, all five NPC and five shop output hashes/sizes, seven copied shop-source database hashes and recorded current repository text hashes. Scratch receipts are `npcshops-npcs-verification-2026-10-08.v1.json` and `shops-verification-2026-10-08.v1.json` under `rs3-cache-work`.

Final focused extraction/evidence/application checks: **33 passing tests**. The complete `npm test -- --test-concurrency=1` suite passed **1,358 tests, with one skipped and zero failures (1,359 total)**. It used isolated scratch TEMP/TMP and serial test-file execution to avoid timing interference with parallel extraction work. The final log is `C:/Users/User/Projects/rs3-cache-work/npcshops-npm-test-2026-10-08-v2.log`; the application review binds its exact hash. No live UI or private-state behavior was exercised.

Files added are the three runtime data JSON files and two data modules; NPC extraction/report, shop extraction and NPC evidence scripts; the preview script; four focused test files; three extraction/evidence JSON reviews, the application JSON review and this document. Existing changes are nine small server-hook lines and four lines each in the ordinary and collection engines. No frontend, retained reference, task identity registry, main checkout tracked file or save was changed. The finished work is committed on `codex/npcshops`; it is not pushed, rebased or merged.
