# Game requirements and duplicate JSON keys

The 2026-10-31 correction overlay repairs factual requirements from audit findings F5, F7, F8, F9, F11, F12, F14 and F15. It also repairs 33 distinct destructive duplicate-key paths. The raw export is unchanged.

`app/data/requirements-corrections.2026-10-31.v1.mjs` is a core-owned data document passed to the existing `applyDefinitionOverlays` mechanism after the selected legacy overlays. Loading it from core allows already-issued immutable legacy packs to receive the repairs. Selection requires the existing reviewed legacy overlay; independent datasets and injected fixtures do not inherit it. Every patch has an exact before-value guard. Applying the overlay again changes nothing, and drift fails explicitly.

The document contains source URLs, retrieval dates and SHA-256 hashes of the retrieved Wiki source. It changes 54 existing task records and inserts 36 helpers or restored records. Existing task labels and permanent IDs are retained; inserted records have explicit, stable IDs. No save migration is needed.

## Requirement repairs

| Audit | Correction | Source |
| --- | --- | --- |
| F5 | Dungeoneering outfit blueprint: 80 Dungeoneering and 20 Invention. Demon, Dragon and Undead Slayer blueprints: 88 Invention. Purchase levels cannot be substituted by boosted levels. The retained shop has no stock items for these blueprint unlocks, so there is no separate stock-item route to gate. | [Current shop stock](https://runescape.wiki/w/Template:Dungeoneering_rewards_stock) |
| F7 | Collector upgrades require their respective seedicide or herbicide. The combined barn objective requires 49 Farming and a 60 Construction building route: 225 rune nails plus 20 mahogany planks, or a large animal pen kit. The helpers require the Manor Farm market. | [Farmers' Market](https://runescape.wiki/w/Farmers%27_Market), [storm barn](https://runescape.wiki/w/Storm_barn) |
| F7 | Anachronia's barn access is an extension of the existing Manor Farm barn. The Anachronia shop explicitly requires the Manor Farm barn to be built before selling its separate access deed. Opening that shop cannot substitute for building the original barn. | [Anachronia market stock](https://runescape.wiki/w/Farmers%27_Market_(Anachronia_Dinosaur_Farm)) |
| F8 | The shared favour helper requires 50 Farming, Polletix and at least one eligible herb-patch growing/harvesting route. Its alias includes the 24 existing herb-patch methods. A seed source or Sorceress's Garden herb supply alone is insufficient. Existing shop gates already depend on this helper. | [Crux Eqal favour](https://runescape.wiki/w/Crux_Eqal_favour) |
| F9 | The additional Reaper-task purchase was removed on 23 March 2026. Its record and ID remain, with retirement text, an explicit blocker and `NeverShow`; historical completion is preserved. | [Death's Store](https://runescape.wiki/w/Death%27s_Store#Update_history) |
| F11 | All 21 talent records, including the three Spirit Pacts, require at least one talent from the previous tier. Specific commands, scythe upgrades and Spirit Pact upgrades require their own predecessor. Rune Mythos is required from tier 3 onwards. Existing Tomes of the Warlock and Senntisten requirements remain. The previous-tier alternatives include Spirit Pacts without requiring every talent in a tier. Helpers carry the game requirements independently of the optional Extra display groups. | [Talents](https://runescape.wiki/w/Talents), [talent table](https://runescape.wiki/w/Template:Talents) |
| F12 | Runespan portal redirection requires 66 Runecrafting to purchase. | [Wizard Rinsit's stock](https://runescape.wiki/w/Wizard_Rinsit%27s_Runecrafting_Shop/Stock) |
| F14 | Insignia stock requires personal evidence of the corresponding role at level 5 and five Penance King kills. The King observation records normal-mode completion, hard-mode access and the five-player requirement. Role levelling costs 1,400 points; the insignia costs another 500 and five King kills. Existing personal-completion and manual-check fields provide these gates. The master trident stock requires a predecessor penance trident; its 220 points in each role remain explanatory currency costs. Basic shop access cannot publish these advanced rewards. | [Rewards](https://runescape.wiki/w/Rewards_(Barbarian_Assault)), [hard-mode entry](https://runescape.wiki/w/Barbarian_Assault), [master trident](https://runescape.wiki/w/Penance_master_trident) |
| F15 | Sanctity, Sorrow and Ruination require Selene in Um, Necromancy! and their unboosted Necromancy learning levels. Sanctity additionally depends on the Knight Waves prayer unlock. Parallel skill actions carry the same learning requirements without depending on the optional Extra prayer group. Activation levels are unchanged. | [Selene](https://runescape.wiki/w/Selene), [Sanctity](https://runescape.wiki/w/Sanctity), [Sorrow](https://runescape.wiki/w/Sorrow), [Ruination](https://runescape.wiki/w/Ruination) |

These records use the existing capability model. Reachable material or currency sources do not establish held quantities, an unspent balance or a completed purchase. No new balance tracker was introduced.

## Duplicate detection and repairs

`scripts/lib/json-duplicates.mjs` scans the source text and reports each repeated key's full path, both line numbers and competing values. The focused tests compare all 111 occurrences at 97 paths against `app/data/requirements-duplicate-baseline.2026-10-31.v1.json`. Every competing value is hashed individually. A new collision or a changed existing collision fails; a count-only replacement cannot pass. The baseline acknowledges the unchanged archival bytes, including repaired and identical repeats.

The overlay restores these losses:

- Both necessary Daemonheim locations on Dig Site access, both Three's Company starts, Tales of Old and Healing Factor.
- The Aminishi moai visit in Head of the Family step 2, under the existing ID.
- The rumberry and moai actions in Tuai Leit's Own step 3, alongside the surviving positive-energy action. Step 4's inaccurate fight description is corrected; the Wiki lists no combat for this miniquest. Existing stage IDs and sequence remain.
- Separate Museum - Guthixian II/Velucia and Guthixian II/Artiefax helpers. The existing Museum ID remains; the restored Artiefax record receives a new ID. The guardian's tear belongs to first-time Guthixian I completion, where its output is now declared. All 78 distinct `AnyCollection[+]` children consequently resolve. The collection-count policy is unchanged.
- Both City Quest item and Menaphos journal requirements on hauyne/idocrase. NPC names are outside this job.
- Both warped-floor and Daemonheim-achievement prerequisites on the of Daemonheim title.
- Micah's Chill Out, Bro! prerequisite and the Shrine of the Spirit Wolves currency helper, alongside membership.
- The Wiki's 5/524 chargebow/staff-of-air rate for Corpse mage, Dragith Nurn and Skoblin.
- Both hard-mode Giant mole coin outcomes; both ordinary and bulk gem/rare-table outcomes; all overwritten elite-dungeon coin and salvage quantities; and both lucky-charm onyx-dust outcomes. These use the existing quantity-map syntax. Dragonkin's 500–1,500 and Shadow Reef's 20,000–70,000 coin ranges are corrected against their templates. The Wiki's current lucky-charm quantities/rates replace stale values where necessary.

The Wiki distinguishes the ordinary, rare and super-rare tables. Both singleton and bulk gem quantities are valid; retaining only the common singleton would lose a valid outcome again. Conditional table composition and unrelated legacy drop rates were not rebuilt.

## Collision inventory left for review

The following 35 divergent paths retain their parsed archival value. Some already retain the correct value; others need an identity, interpretation or source-data decision. Their exact competing values remain pinned in the duplicate baseline. Line numbers refer to the unchanged export at 3b15772.

| Path or records | Original lines | Remaining question or disposition |
| --- | --- | --- |
| Construction: teak kitchen cabinet | 11993, 12335 | Which furniture variant did the level-38 record mean? Preserve the surviving ID until variants and aliases are reviewed. |
| Construction: mahogany kitchen cabinet | 13254, 13679 | Which variant did the level-60 record mean? Same identity issue. |
| Construction: dark stone slabs floor style | 12861, 14488 | Love Story/level-50 versus Temple tile/level-75 records appear to describe different floor styles. Decide which record should keep the saved identity before splitting them. |
| Cooking: uncooked egg | 16309, 16594 | Partial/plural output versus Token/singular output. Determine whether these are separate recipes or duplicate representations. |
| Crafting alternate wizard book | 19517, 19518 | Crafting and Runecrafting prerequisite under one key: AND versus alternative routes. |
| Crafting alternate wizard wand | 19528, 19529 | Same AND/OR question. |
| Crafting alternate imphide book | 20493, 20494 | Same AND/OR question. |
| Crafting alternate imp horn wand | 20620, 20621 | Same AND/OR question. |
| Crafting alternate spider silk orb | 21110, 21111 | Same AND/OR question. |
| Crafting alternate spider silk wand | 21233, 21234 | Same AND/OR question. |
| Crafting alternate batwing book | 21762, 21763 | Same AND/OR question. |
| Crafting alternate batwing wand | 21811, 21812 | Same AND/OR question. |
| Crafting alternate mystic orb | 22786, 22787 | Same AND/OR question. |
| Crafting alternate mystic wand | 22845, 22846 | Same AND/OR question. |
| Thieving: elf triple loot | 71369, 71596 | The two records have different triple/quadruple thresholds; name repair and identity reassignment belong to the other data job. |
| Extra: Shrine shaman's moccasins | 150713, 150718 | The surviving record requires Fang of Mohegan. The apparent overwritten-name repair belongs to the other data job. |
| Extra: crystal fishing rod | 160091, 160099 | Identical action except BiS priority 2 versus 3. This is a ranking choice. |
| Nonskill: South of Fenkenstrain's Castle | 172941, 177777 | Scan/Compass and chunk differences; determine distinct clue identities before restoring. |
| Nonskill: South-west of fairy ring ALQ | 172965, 177831 | Scan versus Compass identity. |
| Nonskill: North-west of Red Dragon Isle | 178089, 178107 | Two different chunk locations under the same label. |
| Chunk 9275: Arctic Pine count | 186071, 186075 | Counts 9/16: revised count versus separate source groups is unknown. |
| Chunk 12347 section 1: Abyssal beast count | 200907, 200908 | Counts 10/1: revised count versus separate source groups is unknown. |
| Thieves' Guild: Drawers count | 221898, 221904 | Counts 1/5: revised count versus separate source groups is unknown. |
| Demon Boss: Infernal ashes | 253405, 253435 | Distinct quantities but the underlying generic boss/variant and conditional outcomes need verification. |
| Demon horn (God Emissaries) item gate | 295577, 297623 | Retain step 6. The Wiki says fifth combat assignment; authored step 5 is the preceding kalphite assignment and step 6 actually collects the horn. Assignment number is not task-step number. |
| Zanaris Market spirit stall: Luminite stone spirit | 342347, 342365 | Common versus Uncommon; the page's dynamic drop view did not provide a settled rate in retrieved source. |
| Washed ashore loot: Chimes | 345524, 345527 | Distinct quantities may be separate outcomes, but the source/variant and conditions were not verified. |
| Death guard tier 30: ability_damage | 370054, 370061 | Retain nonzero 288 over zero. Ability damage must be distinguished from the Wiki's post-2026 weapon-damage number. |
| Death guard tier 40: ability_damage | 370074, 370081 | Retain nonzero 384 over zero; same distinction. |
| Death guard tier 50: ability_damage | 370094, 370101 | Retain nonzero 480 over zero; same distinction. |
| Death guard tier 60: ability_damage | 370114, 370121 | Retain nonzero 576 over zero; same distinction. |
| Death guard tier 70: ability_damage | 370134, 370141 | Retain nonzero 672 over zero; same distinction. |
| Death guard tier 80: ability_damage | 370156, 370163 | Retain nonzero 768 over zero; same distinction. |
| Death guard tier 90: ability_damage | 370178, 370185 | Retain nonzero 864 over zero; same distinction. |
| Masterwork bow: ability_damage | 386242, 386249 | 1,440/2,235 requires a reviewed derivation for this field; do not substitute the Wiki's weapon-damage value. |

## Gameplay choices left open

| Finding | Options requiring a decision |
| --- | --- |
| F5 | Buy blueprints as soon as purchase requirements are met, or defer until outfit/codex production is useful. |
| F7 | Keep the combined full-barn obligation at shop access, split deed/build/capacity stages, or defer capacity stages. Pen/farmhand upgrades can remain due at shop access or wait for their pens/animals. |
| F8 | Require all shop upgrades immediately, or defer incense/patch-specific upgrades until their beneficiary activity is usable. Plant Power can remain combined or become staged. |
| F9 | Learn ring/book knowledge when purchasable, or wait for a usable ring/book production route. |
| F11 | Represent soul/talent-point progress through personal counters, recorded manual checks, or another explicit capability. Decide separately when communion/combat grinding becomes obligatory. The overlay states the real soul totals and talent-point requirements in descriptions, but does not choose a tracker or infer those balances from level. |
| F12 | Buy BGH/Max Guild perks for future use, or defer until their activity/portal is usable. |
| F14 | Entering Barbarian Assault may commit the challenge to every advanced reward, or hard-mode rewards may stay optional until explicitly selected. Game role/King/predecessor conditions apply in either case. |
| F15 | Learn obtainable prayers immediately, or require their activation levels before they become due. |

The collision inventory adds choices about recipe AND/OR semantics, task identity when splitting overwritten records, and crystal-fishing-rod priority. No new task should inherit an old checkmark solely because its label resembles a lost record. The restored Museum record retains its historical ID; saved completion alone cannot reveal which collector an old checkmark represented.

## Verification

Run the focused tests serially with the selected legacy data pack available:

```powershell
node --max-old-space-size=3072 --test --test-concurrency=1 tests/json-duplicates.test.mjs tests/requirements-corrections.test.mjs tests/definition-overlays.test.mjs tests/definition-pipeline.test.mjs
```

The 29 tests cover duplicate detection, exact exception fingerprints, atomic drift guards, stable identities, server/worker/direct preparation, requirement boundaries, alternate barn materials, herb harvesting, personal advanced-reward conditions, prayer learning, optional display-group independence, collection cardinality and production drop-table expansion. No server is needed. The private-save before/after report and Wiki wording notes remain in the worktree's ignored `.local/` directory.
