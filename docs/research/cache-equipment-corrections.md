# Cache equipment corrections and Wiki weights

Step 3 of [the integration order](cache-game-data.md#integration-order) is implemented as a reviewed equipment overlay. The retained export remains unchanged. The server serves corrected equipment definitions; the engine and worker use the same corrected requirements, membership and stats for equipment tasks and Current BiS.

Work and tests used `codex/equip`. The main checkout's tracked files, private save and picker on port 8788 were not used or changed. The copied `.local/game-data/items-2026-10-08-v2` export was read only. No frontend files changed.

## Identities and corrections

The [versioned review](cache-equipment-corrections.2026-10-08.v1.json) records every equipment identity decision and original consensus disagreement. The [runtime bundle](../../app/data/equipment-corrections.2026-10-08.v1.json) retains exact old values, cache IDs/fields/parameters and current Wiki revision permalinks for every applied field.

**2,473 of the 2,474 unique candidates** have verified current Wiki IDs and variants. Another 269 formerly ambiguous rows resolve to one current Wiki identity: **2,742 verified identities** overall. The remaining 808 decisions comprise 624 ambiguous current ID/state sets, 182 with no intersecting current Wiki ID and two without a revision. Array position and first same-name rows never select identity.

The sole unresolved unique candidate is **Dharok's platebody**: cache equippable ID 4720 differs from the Wiki's current new-state ID 35585, which this cache identifies as broken. No override applies. Modern Rune platebody resolves to **45543**, excluding conversion stub 1127.

There are **3,804 field changes across 2,741 rows**:

| Class | Fields | Named examples |
| --- | ---: | --- |
| Members flag | 2,741 | A jester stick: members; Rune platebody: F2P. Missing metadata gains 1,637 true and 1,104 false flags. |
| Explicit attack-speed ticks | 905 | Bronze dagger: 4 ticks; A jester stick: 6. Authored `speed` is preserved. |
| Skill requirements | 57 | Adamant defender: add Defence 40; Ancient robe legs: Prayer 20 → 40; Crystal hatchet: Woodcutting 71 → 70. |
| Displayed auto damage | 44 | Acadia longbow: 637 → 637.5; Bane 2h crossbow: add 956.3. |
| Armour | 7 | Apex hide body + 5: 552 → 565.3; Apex hide cowl + 5: 480 → 491.6. |
| Damage bonuses | 15 | Amulet of fury (t): 37.3 → 39.1 in four styles; Arcane blast necklace: Magic 28.7 → 31.6. |
| Accuracy | 4 | Bane crossbow: 1,693 → 1,694; Elder longbow (sighted): 1,924 → 2,178. |
| Prayer bonus | 7 | Boots of Tumeken's resplendence: 0 → 2; Mask: 0 → 3. |
| Life points | 10 | Atrocious rogue gloves: 250 → 300; Corrupt rogue gloves: 50 → 200. |
| Attack range | 12 | Chaotic lantern: 1 → 6; Eternal magic shortbow Mk. 5: 8 → 7. |
| Sparse calibrated tier | 2 | Falador shield 4: 60 → 50; Wizard robe top: 1 → 5. |
| Slot | 0 | Physical slots agree; authored shield/off-hand weapon distinctions survive. |

Requirements comprise Defence 9, Attack 7, Strength 9, Prayer 16, Magic 3, Ranged 2, Necromancy 2, Smithing 2, Thieving 6 and Woodcutting 1. Damage bonuses comprise melee 4, ranged 3, magic 2 and Necromancy 6.

Membership gates F2P equipability only when cache and the matched Wiki variant agree. Missing membership remains unknown; the existing Necromancy trial remains eligible. A level cap alone does not establish a particular tier's membership. Individual requirement leaves change without deleting other authored/source/task gates. Armour-spike Smithing requirements are added only with Bonuses equip-requirement corroboration, rather than borrowing a crafting level.

`cacheIdentity` is provenance: it does not replace picker identities, labels, formatting, task IDs, checks or personal progress. Exact names, reviewed record fingerprints and old-field preconditions protect custom data. Changes are atomic, immutable and idempotent, including after JSON serialization; existing custom weights survive.

## Sparse calibration

The [item report](cache-game-data-items.md) establishes decoder/manifest provenance and existing membership, physical slots, stats and skill-pair projections. Missing/conflicting parameters never become zero. Additional anonymous integer meanings were independently checked against exact Wiki IDs and unambiguous bonus states:

| Projection | Explicit checks | Matches | Differences |
| --- | ---: | ---: | ---: |
| Tier, param 4596 | 495 | 492 | 3 |
| Life points, param 1326 | 268 | 268 | 0 |
| Necromancy accuracy, param 8879 | 24 | 24 | 0 |
| Attack-speed ticks, param 14 | 1,256 | 1,253 | 3 |
| Attack range, param 13 | 473 | 469 | 4 |
| Off-hand displayed damage, single damage param / 20 | 282 | 229 exact; 53 rounding-only | All within 0.051 of Wiki display |

**Each applied field still requires exact agreement for its own item.** Off-hand damage additionally requires explicit Wiki off-hand weapon semantics, because physical slot 5 includes shields and defenders. It supplies neither derived ability damage nor arbitrary ammunition damage. Rounding cases such as raw 613 / 20 = 30.65 versus Wiki 30.6 remain unchanged.

Param 2645 is rejected as a general tier: 327/1,450 comparisons match, with 1,123 differences; Mystic wand's 57 matches a production level rather than tier 50. Sparse 4596 never supplies a missing-field fallback. Falador shields 1–3 disagree (cache 20/30/40, Wiki 30/40/50). Speed exceptions are Acadia longbow/shortbow and death guard tier 30. Range exceptions are Blisterwood polearm, Sunspear (melee), Vanquish (melee) and Sacred clay bow. Their cache/Wiki disagreements are retained.

The authored `speed` convention differs from ticks: Bronze dagger has speed 3 versus cache/Wiki 4. `attack_speed_ticks` preserves that distinction. The current evaluator uses authored speed only to identify weapon-like records, without simulating DPS. Formal parameter names, complete server equipability, charges/passive semantics and derived ability-damage formulas remain unavailable. Conflicting Wiki fields and state bindings are withheld.

## The 142 consensus rows

All **142 rows / 147 fields** are reviewed: **109 applied, 35 unresolved, three preserved because current Wiki and cache disagree**. There are 104 rows with every original differing field applied. `consensusReview` retains IDs, values, reasons and revision permalinks. These are all remaining original differences:

| Items | Field and reason |
| --- | --- |
| Armour spikes; Armour spikes (alloy) | Smithing: no unambiguous Bonuses equip-requirement corroboration. |
| Banner of Armadyl, Bandos, Saradomin, Seren, Sliske, V, Zamorak, Zaros and the Godless | Accuracy: retained names do not choose among four tier states. |
| Brawler's blood necklace; Occultist's blood necklace | Attack / Necromancy: ambiguous new/used states. |
| Dharok's greataxe; Torag's hammer | Strength: ambiguous new/used states. |
| Elite Robin Hood tights; Elite Dracolich hauberk; Trimmed masterwork melee platelegs | Ranged / ranged / melee bonuses: ambiguous current states. |
| Goliath gloves (black, red, white, yellow) | Armour: ambiguous with-weapon/unarmed bonuses. |
| Fighter hat; Hardened fighter hat | Strength unavailable in matched Wiki Bonuses. |
| Healer hat; Hardened healer hat | Magic unavailable in matched Wiki Bonuses. |
| Hardened penance skirt; Hardened ranger hat; Hardened runner boots; Hardened runner hat; Runner boots; Runner hat | Ranged unavailable in matched Wiki Bonuses. |
| Off-hand bane crossbow | Accuracy unavailable in matched Wiki Bonuses. |
| Primal warhammer + 3 | Auto damage unavailable in matched Wiki Bonuses. |
| Rat pole | Accuracy: ambiguous current states. |
| Corrupted slayer helmet (f) | Preserve Defence 85: cache 70, Wiki agrees with picker 85. |
| Oak longbow; Yew longbow | Preserve auto damage 127 / 892: cache 127.5 / 892.5, Wiki agrees with picker. |

Other retained disagreements include Holy Cithara membership, Quest Cape damage bonuses, sparse Falador tiers and the speed/range exceptions above. `fieldReview` preserves every unavailable/disagreeing fact; ordinary passing comparisons are aggregated. Runtime corrections retain every applied fact. Identity and weight coverage are separate from the original consensus set.

## Wiki weights

The [versioned weight cache](../../app/data/equipment-weights.2026-10-08.v1.json) fills **3,019 / 3,550 rows (85.0%)** and lists **531 unresolved rows**. All picker titles were fetched through the Wiki API in 89 bounded sequential requests on 2026-10-08: 3,521 canonical pages, 3,519 revisions. Records retain fetch dates, permalinks, exact source fields/suffixes, cache/Wiki IDs, variants and kilograms. Provenance binds the local snapshot; the equipment review retains each revision's content hash.

Coverage comprises 2,455 unique identities, 557 candidate sets whose every Wiki-identified variant has equal weight and seven explicit inventory/worn splits. Equal weight establishes a comparable value without selecting an ambiguous game identity. Unexplained extra cache candidates prevent import.

[Boots of lightness, revision 37132350](https://runescape.wiki/w/Boots_of_lightness?oldid=37132350): **worn ID 89 = −4.535 kg; inventory ID 88 = 0.34 kg**. Runtime `weight` uses the worn value, with separate `wornWeight` and `inventoryWeight`. Ordinary Item weight applies to both contexts unless a split is explicit. Numeric Bonuses weight supports an exact-variant fallback; this snapshot contains no Bonuses weight fields, including the 26 missing/nonnumeric Item-weight cases. Conflicts are rejected.

| Unresolved reason | Rows |
| --- | ---: |
| Wiki does not identify every cache candidate | 298 |
| No exact equippable cache identity | 177 |
| Missing/nonnumeric weight | 26 |
| Different candidate weights | 24 |
| No Item infobox | 4 |
| Missing Havensilver bolts + 1 / + 2 pages | 2 |

The existing **Show Best in Slot Weight Tasks** rule controls goals. Ordinary slots minimize worn weight. Coupled weapon-weight optimization and inventory simulation remain outside that evaluator.

## Preview and reproduction

Claude can run the read-only preview on a private copy with adjacent `static/`:

```powershell
node scripts/preview-equipment-corrections.mjs --state "C:/path/to/copied-save/state.json"
node scripts/preview-equipment-corrections.mjs --state "C:/path/to/copied-save/state.json" --json
```

The preview opens no store and writes no state. It reuses the metadata preview's checked compact-state/static loader. Both sides share the same state, metadata corrections, topology and travel options; only equipment differs. It reports member slots, complete hands/ammunition loadouts, tank/weight views, personally recorded obtainable gear, hidden duties and saved blocked equipment tasks. Challenge checks do not become ownership. Only synthetic saves were tested, including unchanged state/static/input hashes.

`--definitions`, `--corrections` and `--weights` support isolated fixtures and versioned artifacts. Explicit custom artifacts suppress other default overlays unless separately supplied. Identity-only provenance does not count as behavioral task changes.

Offline regeneration uses the retained read-only cache and `.local/equipment-wiki.2026-10-08.v1.json`:

```powershell
node scripts/research/build-equipment-corrections.mjs
node scripts/research/import-equipment-weights.mjs
npm test
```

A fresh fetch should use a new versioned output:

```powershell
node scripts/research/equipment-wiki.mjs --output .local/equipment-wiki-NEW-VERSION.json
node scripts/research/build-equipment-corrections.mjs --wiki .local/equipment-wiki-NEW-VERSION.json
node scripts/research/import-equipment-weights.mjs --snapshot .local/equipment-wiki-NEW-VERSION.json
```

The review binds the reference, compact item report, copied manifest/artifacts, decoder, Wiki snapshot/revisions and implementation hashes. Weight regeneration is byte-stable. Tests cover correction classes, atomic drift checks, stable identities, sparse fields, conflicting/ambiguous variants, weight import, worker Current BiS and copied-save preview hydration.

Final verification: **`npm test` passed 1,170/1,170 tests** in 155.789 seconds; the **56 focused tests** also passed separately. TEMP/TMP were redirected into this worktree's `.local/test-tmp-equip-2026-10-08`. The full log is `.local/npm-test-equip-2026-10-08-v2.log`. An earlier run imported a JSON artifact during regeneration and failed one CLI test; atomic artifact replacement and the final run resolved that race. No real save was tested.

## Changed files

The commit changes 22 files. No `app/web` files are included.

| Files | Purpose |
| --- | --- |
| `app/data/equipment-corrections.mjs`; `app/data/equipment-corrections.2026-10-08.v1.json`; `app/data/equipment-weights.2026-10-08.v1.json` | Guarded runtime overlay and versioned evidence/weights. |
| `app/tasks/engine.mjs`; `app/tasks/worker.mjs`; `app/server.mjs` | Consistent eligibility, tasks, Current BiS and served definitions. |
| `app/data/settings.mjs` | Weight rule description reflects reviewed coverage. |
| `scripts/research/equipment-wiki.mjs`; `scripts/research/import-equipment-weights.mjs`; `scripts/research/build-equipment-corrections.mjs` | API snapshot, variant parser, offline imports and atomic artifact replacement. |
| `scripts/preview-equipment-corrections.mjs` | Read-only member/task/BiS preview. |
| `tests/equipment-correction-builder.test.mjs`; `tests/equipment-corrections.test.mjs`; `tests/equipment-weights.test.mjs`; `tests/equipment-wiki.test.mjs`; `tests/preview-equipment-corrections.test.mjs` | 56 focused fixture and versioned-artifact tests. |
| `docs/research/cache-equipment-corrections.md`; `docs/research/cache-equipment-corrections.2026-10-08.v1.json`; `docs/research/cache-game-data.md`; `docs/research/cache-game-data-items.md`; `docs/equipment.md` | Full review, unresolved lists, reproduction and updated routing. |
| `.gitattributes` | Stable LF bytes for hashed equipment files. |
