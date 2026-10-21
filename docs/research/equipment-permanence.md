# Equipment permanence

The **Non-permanent BiS** rule defaults to enabled. In Chunk Rules it appears beside Consumable Primary BiS under Show Best in Slot Tasks. Disabling it removes equipment that is lost through normal use, time, or a temporary activity context before ordinary, prayer, weapon-loadout and specialist comparisons. Repairable broken equipment and items restored by recharging a retained core remain eligible. Ordinary ammunition consumption remains under the existing ammunition/consumable rules.

The [versioned classification](../../app/data/equipment-permanence.2026-10-08.v1.json) covers all **3,550 retained equipment identities**, including legacy items which the source engine may never make obtainable today. This is classification coverage, not a claim of present item availability or a replacement for source/equipability gates.

| Classification | Rows |
| --- | ---: |
| Permanent under this rule | 3,384 |
| Dust / disintegration / exhausted combat equipment | 141 |
| Charge exhaustion removes the item | 1 |
| Temporary tutorial, event, instance or held item | 23 |
| Destruction through firing | 1 |
| Total | 3,550 |

The permanent count includes **240 ammunition exclusions**. These rows have `ammunitionExcluded: true`; their `permanent: true` means this particular rule does not filter them. It does not assert that a projectile physically survives firing. The 23 temporary rows comprise 16 non-ammunition Academy tutorial items, three event/house weapons, three smouldering incense plants, and one Dominion Tower staff. The Academy items are retired tutorial identities. Academy arrow, bolts and knife are ammunition exclusions.

## Sources and item identities

A fresh bounded Wiki API fetch on October 8 requested every equipment title, saving a new ignored snapshot at `.local/game-data/equipment-permanence-wiki.2026-10-08.v1.json`. All 3,550 requested names resolve to 3,521 canonical pages. Two pages, **Havensilver bolts + 1 / + 2**, have no revision; both are excluded ammunition. Supplemental API snapshots `equipment-permanence-exceptions-wiki.2026-10-08.v1.json` and `.v2.json` pin the compactor, tutorial and transcluded glove evidence. The bundle retains **3,530 distinct revision sources**, with titles, exact revision permalinks, timestamps and raw revision-content hashes.

The read-only `items-2026-10-08-v2` export supplies all 63,798 decoded items. Its manifest SHA-256 is `7faac7f68d9483e4e5e9c1fe4408787b3286568d474f5e71902214ad77dd45a9`. The manifest binds the copied-cache database/archive hashes and pinned decoder/schema. No game cache was opened or changed for this classification; the existing normalized export and manifest were read. [Item extraction](cache-game-data-items.md) explains the copied-cache boundaries and inferred schema build. [Equipment corrections](cache-equipment-corrections.md) owns the separate exact identity/stat review.

There are exact equippable cache candidates for **3,370 names**; the other **180 names** retain Wiki evidence. Item infobox IDs restrict candidate states when they intersect. Multiple current states remain a set rather than choosing the first same-name ID. Per-record `cacheIds` allow the runtime loader to reject a mismatched supplied `cacheIdentity.id`. An absent cache identity still allows a reviewed exact picker name; custom or unknown names remain eligible. Nothing changes picker names, task IDs, completion state or ownership.

`sources[revisionId]` stores shared Wiki provenance. Each record references its item revision and any required supporting revisions, plus current Wiki state bindings and declared degradation/repair fields. Cache evidence retains the visited item IDs, raw relevant parameters and transition outcomes. External snapshot/export hashes use raw bytes; repository implementation/reference hashes use [`sha256RepositoryText`](../../scripts/lib/provenance-hash.mjs), matching Git LF text bytes.

## Cache calibration and disagreements

Anonymous parameters remain **inferred, specimen-calibrated meanings**, not official server variable names:

| Parameter | Observed use and calibration |
| --- | --- |
| 3382 | Modern equipment state transition. Sirenic mask 29854 → used 29856 → `-1`, alongside pinned per-item disintegration; amulet of the forsaken 39061 → 39063 → broken 39064, retained and repairable. |
| 3383 | Repair cost or sentinel, not an item ID. A value `-1` alone never means the equipment disappears. Superior leviathan ring has 600,000; ordinary leviathan ring has 3,000,000 despite Wiki stating it vanishes. The per-item Wiki loss decision wins over interpreting a positive cost as proof of repair. |
| 3385 | Combat charge capacity, e.g. Sirenic mask and amulet of the forsaken 100,000. Capacity does not establish permanence. |
| 1081 / 1079 | Older broken-state link / repair-cost projection. Chaotic maul 18353 → broken 18354, with 2,000,000 repair cost, corroborates retained repairability. |
| 3109 | Context-dependent lifetime/capacity. Scrimshaws use activation time; Ports armour also uses this field. It never establishes dust by itself: superior Ports equipment remains repairable. |

The generator scans every exact candidate's transitions. A named broken/uncharged endpoint stops the use-through-equipment trace, even when that inert state contains a trailing `-1`. Following amulet of the forsaken's broken-state sentinel would incorrectly infer destruction. A missing continuation remains `unresolved-terminal-state`, rather than asserting that an incompletely decoded used state survives or vanishes. Disappearing non-ammunition cache endpoints outside the reviewed families require corroborating per-item Wiki loss evidence; regeneration throws on an unreviewed endpoint.

The remaining important disagreements and exceptions are explicit:

- **Corrupt dragon / PvP equipment:** current item examine/prose establishes destruction after wearing or combat. A generic cache degradation flag does not independently establish the timer or loss mechanism.
- **Dominion gloves:** all 12 Goliath/Swift/Spellcaster colour variants are dust. Their item pages transclude the loss prose, and ordinary modern transition parameters do not establish the endpoint. Pinned [Goliath](https://runescape.wiki/w/Template:Goliath_gloves?oldid=37031572), [Swift](https://runescape.wiki/w/Template:Swift_gloves?oldid=37031524) and [Spellcaster](https://runescape.wiki/w/Template:Spellcaster_gloves?oldid=37031523) templates establish 15,000 combat charges followed by dust. This is a Wiki-backed resolution of incomplete cache mechanics.
- **Ferocious ring:** the [ordinary ring](https://runescape.wiki/w/Ferocious_ring?oldid=37014069) disappears at zero charges and can be destroyed by its lifesaving effect. The [compacted ring](https://runescape.wiki/w/Ferocious_ring_(c)?oldid=36918067) stays permanent: the [compactor revision](https://runescape.wiki/w/Teleportation_compactor?oldid=36916492) explicitly retains compacted jewellery at zero, allowing recharge.
- **Tier 90 versus tier 92 / superior variants:** Sirenic/Tectonic 90, ordinary Ports armour, ordinary leviathan ring and reefwalker's cape disappear. Elite Sirenic/Tectonic 92, superior Ports armour, superior leviathan ring and superior reefwalker's cape remain repairable. Malevolent kiteshield is also repairable and is not grouped with Malevolent armour. There are no dyed Sirenic/Tectonic/Malevolent equipment identities in this retained catalogue; unknown future variants are not guessed from a family name.
- **Historical loss text:** contemporary hydrix jewellery breaks and can be repaired. Older update-history statements about dust do not change that decision. Crystal equipment reverting to a retained seed, refined anima reverting to retained unrefined armour, enhanced boots reverting to retained boots, and polypore staff retaining its stick are maintenance paths. They stay permanent.
- **Clay and achievement items:** spent sacred/volatile clay tools, ordinary sacred clay armour, Dominion medallions and Underworld Grimoires retain the item. Optional destruction, death/PvP loss, transforming or consuming an item in a recipe is outside this use/time rule.
- **Temporary equipment:** wooden sword disappears when leaving the player-owned house; War's javelin and vial of bile are taken back outside their event; smouldering plants become ashes when dropped or unequipped. **Air staff (Dominion Tower) is an inference**, based on its instance-supplied identity, `bankable = No` and `kept = never`; its pinned page does not state the leave-instance loss in a direct sentence. This is the sole explicitly inferred instance restriction.
- **Hand cannon:** the [pinned article](https://runescape.wiki/w/Hand_cannon?oldid=37120134) establishes that firing/ability use can explode and destroy it. `use-destruction` describes this separately from dust and charge exhaustion. Augmented variants are not inferred from that ordinary-item decision.

The ordinary permanent rows combine current article review, infobox degradation/repair metadata and observed cache transitions. Absence of a parameter alone is not proof of permanence. This is a dated catalogue audit with explicit exception review, not complete reverse engineering of server scripts or live-game observation. Ambiguous names are not promoted to a particular game's state identity. Future items, server changes and unknown custom records require new evidence.

## Reproduction and validation

The generator is offline after the pinned snapshots exist:

```powershell
node scripts/research/build-equipment-permanence.mjs
node scripts/research/build-equipment-permanence.mjs --output .local/game-data/equipment-permanence-reproduction-NEW.json
node --test tests/equipment-permanence.test.mjs tests/equipment-permanence-rule.test.mjs
```

`--reference`, `--wiki` and `--cache` accept alternate versioned inputs. The two versioned supplemental snapshots are required in the worktree's `.local/game-data`. Outputs cannot replace inputs. An existing ignored local output is refused rather than overwritten; the committed runtime artifact can be regenerated atomically. New research uses a new filename. The loader exports `equipmentPermanence`, `getEquipmentPermanence(name, data)` and `isNonPermanentEquipment(name, data)`.

**15/15 focused data/rule tests passed.** They cover full identity coverage, loss mechanisms, historical false positives, transcluded templates, compactor persistence, broken-state sentinels, charge/repair distinction, projectile exclusions, event-javelin precedence and cache identity guards. A fresh versioned local reproduction is byte-identical to the runtime artifact: **2,837,061 bytes**, SHA-256 `14235b62a6568e29a5d3543f9c53b4a2b6195800478053332a974cf6ada1754d`. Repository-wide tests and worker coverage are recorded by the integration verification below.

Final integration verification: **`npm test` passed with 1,551 passed, zero failed and one existing optional skip out of 1,552 tests**, in 428.407 seconds. All six existing prediction golden hashes passed unchanged. The 17 focused classification, rule, actual worker and repository-provenance checks also passed. History/Undo is exercised through the existing `set-task-rule` command used by Chunk Rules; the core `set-rule` command remains for core rules. TEMP/TMP were redirected into this worktree's `.local/test-tmp`; the full log is `.local/game-data/permanence-final-npm-test-2026-10-08-v1.log`. Staged Git LF bytes also match the recorded implementation/reference hashes.

## Copied-save verification

The verification used a copied revision-27 gameplay snapshot. **Default output equals explicit enabled output** for both members and matches the retained pre-change output hashes:

- Player 1: `62554d73241fecf0003ae439cb4a9da5977b36974e0f5ef6a81034bdbedb6f14`.
- Player 2: `d5b842d0e4f06886611d8616a3b37179ad020fa9a98eb65447c2c1ba589aeb27`.

Disabling the rule removes five active Player 1 Obtain tasks and changes the corresponding Current BiS recommendations:

| Removed Obtain task | Permanent replacement | Comparison |
| --- | --- | --- |
| Corrupt dragon chainbody | Ghost hunter body | Melee torso |
| Corrupt dragon platelegs | Ghost hunter legs | Melee legs |
| Corrupt dragon helm | Ghost hunter goggles | Melee head |
| Corrupt dragon spear | Rune 2h sword + 3 | Melee two-handed weapon |
| Corrupt dragon mace | Rune mace | Prayer main-hand weapon |

Player 2 has no active task removals. No new active Obtain tasks appear: all five permanent replacement challenges are already satisfied under the saved `any` completion rule. Ghost hunter gear was already recommended in other style comparisons. These are observations of the copied saved state, not claims about current personal possession.

The final comparison binds the delivered classification hash and both original equipment-output hashes. Default equals explicit enabled output, and Undo restores that output for both members. Copied state/static hashes remain unchanged. The ignored final report is `.local/game-data/permanence-save-results-2026-10-08-v2.json`; the copied save, including its credentials and sidecars, was deleted after verification. No server was opened on the copied save.

No original private save, main-checkout tracked file, cache copy, original game cache, or picker on ports 8788/8789 was changed. Runtime rule/catalogue/presentation integration is owned by the accompanying integration changes.

## Changed files

- `app/data/equipment-permanence.mjs` and `.2026-10-08.v1.json`: classification accessor and evidence bundle.
- `scripts/research/build-equipment-permanence.mjs`: offline classification/provenance generator.
- `tests/equipment-permanence.test.mjs`: focused evidence and identity tests.
- `tests/equipment-permanence-rule.test.mjs`: rule/settings/equipment/presentation/undo tests.
- `tests/equipment-permanence-worker.test.mjs`: worker result integration.
- `tests/helpers/repository-provenance.mjs` and `docs/provenance-hashes.md`: repository-wide text-hash inventory.
- `docs/research/equipment-permanence.md`: semantics, source review, reproduction and copied-save evidence.
- `app/data/settings.mjs`: the default-on task rule, description and BiS control position.
- `app/tasks/equipment.mjs` and `app/tasks/presentation.mjs`: filter candidates before ranking and suppress excluded Obtain rows.
- `tests/settings.test.mjs`: account for the additional authored rule while retaining the original metadata parity assertions.
- `docs/equipment.md` and `docs/task-presentation.md`: runtime policy and stable identity behavior.

The settings, evaluator and presentation changes are described in [Equipment goals](../equipment.md). The original equipment export remains unchanged.
