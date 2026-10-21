# Cache skill guides, spells, prayers and combat abilities

This extraction covers **all 29 skills, 6,281 skill-guide entries and 248 tabs** in the copied cache. A separate combat export retains **545 action definitions: 238 client spell records, 57 prayers, 45 curses and 205 ability or internal action records**. The portable catalogue exposes the rendered guide fields and combat metadata to Claude's UI. Four reviewed F2P unlock milestones and eleven field corrections are implemented behind two independent switches, both **OFF by default**.

Work was confined to `codex/skillguide`, based on `1c64928`, and the shared scratch workspace. New full exports were published with exclusive-create writes under the main checkout's `.local/game-data`; existing exports were preserved. The game cache originals, game client, private duo save, main tracked files and running pickers were outside this work.

## Provenance and extraction

Source: `C:/Users/User/Projects/rs3-cache-work/cache-copy`. Decoder: [rsmv commit a92b8920b9b9842adde78822646ecad1a6f4fc15](https://github.com/skillbert/rsmv/tree/a92b8920b9b9842adde78822646ecad1a6f4fc15). **Schema 950 is inferred compatibility**, not a verified client build or a guarantee that this snapshot represents today's live game.

Full artifacts:

- `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/skill-guides-2026-10-08-v1`: rendered entries, used raw definitions, evaluation traces, source links, helper bytecode, summary and manifest.
- `C:/Users/User/Projects/chunk-picker-rs3/.local/game-data/skillguide-combat-2026-10-08-v2`: action definitions, raw parameters, decoded helper evidence, retained-task comparison and manifest. The earlier v1 remains intact.

Each manifest records copied database hashes/timestamps, decompressed archive hashes/versions/subfile IDs, decoder and schema hashes, interpreter hash, output hashes and LF-normalized repository implementation hashes. Repository hashes use `scripts/lib/provenance-hash.mjs`; existing `.gitattributes` rules cover every new `.mjs`, `.json` and `.md` file. External cache/output bytes retain raw SHA-256 identity.

The guide is a typed graph: enum **108** names skills; **5420** points to entry-list enums; **5421** points to tab-name enums; lists point to structs. Enum 108's **Quest point pseudo-skill 31** has no guide pointer and is recorded as excluded. Interface **1218** contains all 29 skill selectors.

| Source | Meaning |
| --- | --- |
| Major 17, groups of 256 | Skill, entry and tab enums |
| Major 22, groups of 32 | Guide/action structs |
| Major 19, groups of 256 | Linked display items and production/equipment parameters |
| Major 2, group 11 | Parameter types and defaults |
| Major 2, groups 40/41 | DB table/row fields used by modern guide entries |
| Major 3, interface 1218 | Guide UI selection/routing |
| Major 12, individual script groups | Pure display helpers and bounded renderer evidence |
| Major 18, groups of 128 | Typed NPC targets in ritual DB tuples |

Direct guide params include **2210 name, 2211 description, 2212 level, 2213 item, 2215 skill, 2216 level-up/requirement text, 2217 membership and 2220 tab**. Param 2214 is a graphic, not an NPC. Modern entries also use typed DB-row 6569 and action-struct 8877 links. Every entry preserves its source and typed linked IDs. The export resolves twelve distinct typed NPC definitions; it establishes no direct object selector from guide icons.

Reading params alone is insufficient. **37 pure helper bodies** were completely decoded with footer/body/count checks. Name, description, level, category, membership and display-item helpers reproduce item/action/DB fallbacks. A guarded prefix of renderer 16268 supplies production level/membership overrides. An explicit zero membership param does not automatically mean F2P: the UI can inherit item or action membership.

All names, tabs and membership values resolve. Three levels preserve the actual **zero sentinel** for **Life points, Crossbow and Phoenix crossbow**. The **Font of Life** relic description depends on player varbit **6955008**, so its rendered account-specific description remains unknown. Four unrelated interface components fail the pinned schema; interface 1218 and the targeted helper closure decode cleanly. [Extraction evidence](skill-guides-extraction.2026-10-08.v1.json) records these bounds. Independent scratch and published extractions produced identical logical data.

## Picker and training comparison

The [complete comparison](skill-guides-comparison.2026-10-08.v1.json) lists every guide entry, exact-name/output/link candidates, unmatched entries, ambiguity, level disagreements and training candidates. It finds **3,198 candidate matches, 3,083 entries without an exact candidate, 526 ambiguous entries and 341 entries with a candidate-level disagreement**. Those disagreements are review leads: an icon/product can appear in multiple activities at different levels. A name join does not prove equivalent task semantics.

There are **1,344 guide entries marked free within the picker's F2P caps**, of which **764 have no exact task candidate**. These include umbrella equipment unlocks, burn thresholds, Daemonheim products, benefits and UI-specific labels. The count is not a claim that the picker lacks 764 actionable tasks. Trial caps and location gates remain separate; a guide's free marker grants no access.

| Skill | Guide entries | Free within cap | Free without exact candidate | Authored tasks | Training methods |
| --- | ---: | ---: | ---: | ---: | ---: |
| Agility | 221 | 3 | 2 | 223 | 1 |
| Attack | 131 | 42 | 34 | 173 | 3 |
| Constitution | 53 | 8 | 5 | 54 | 3 |
| Construction | 160 | 3 | 3 | 643 | 3 |
| Cooking | 343 | 66 | 29 | 389 | 3 |
| Crafting | 609 | 236 | 113 | 709 | 7 |
| Defence | 302 | 89 | 63 | 297 | 3 |
| Dungeoneering | 198 | 88 | 73 | 103 | 1 |
| Farming | 211 | 5 | 0 | 451 | 1 |
| Firemaking | 145 | 34 | 12 | 229 | 10 |
| Fishing | 122 | 26 | 13 | 109 | 7 |
| Fletching | 267 | 101 | 42 | 322 | 12 |
| Herblore | 309 | 5 | 0 | 373 | 2 |
| Hunter | 248 | 5 | 4 | 281 | 1 |
| Magic | 417 | 111 | 61 | 476 | 6 |
| Mining | 246 | 120 | 80 | 137 | 8 |
| Prayer | 124 | 39 | 31 | 146 | 4 |
| Ranged | 264 | 106 | 49 | 366 | 3 |
| Runecrafting | 209 | 65 | 13 | 191 | 5 |
| Slayer | 187 | 6 | 3 | 293 | 1 |
| Smithing | 188 | 72 | 60 | 226 | 10 |
| Strength | 52 | 8 | 7 | 52 | 3 |
| Thieving | 190 | 6 | 5 | 232 | 1 |
| Woodcutting | 135 | 53 | 36 | 103 | 7 |
| Summoning | 208 | 9 | 1 | 262 | 2 |
| Divination | 206 | 8 | 5 | 182 | 1 |
| Invention | 164 | 0 | 0 | 164 | 0 |
| Archaeology | 212 | 13 | 3 | 555 | 2 |
| Necromancy | 160 | 17 | 17 | 111 | 4 |

**92 entries** have training-method candidates. Only **20 reviewed activity/method level agreements** become planner breakpoint metadata: seven Woodcutting, eight Mining, three Cooking and two Runecrafting joins. Method eligibility, recipes, XP units, rates, economics and planner segments remain unchanged. Multiple rows can share a level; they retain separate method/entry identities.

### Generated F2P unlocks

`tasks.cache-skill-guide` adds four **no-burn Cooking milestones**:

| Milestone | Level | Cache struct | Wiki |
| --- | ---: | ---: | --- |
| Shrimps | 34 | 33701 | [36950896](https://runescape.wiki/w/Special:PermanentLink/36950896) |
| Crayfish | 34 | 33702 | [36950894](https://runescape.wiki/w/Special:PermanentLink/36950894) |
| Trout | 49 | 33713 | [36953398](https://runescape.wiki/w/Special:PermanentLink/36953398) |
| Lobster | 74 | 33730 | [36953382](https://runescape.wiki/w/Special:PermanentLink/36953382) |

Each uses the exact raw-ingredient and cooking-object selectors of the existing ordinary recipe. The milestone is secondary, unboosted and produces no item; it cannot become a new item source or training method. These are standard fire/range thresholds; cooking gauntlets and special equipment have separate thresholds. Generated tasks have permanent IDs and register through the existing dynamic catalogue. Disabled milestones stop contributing capabilities and active obligations; saved completion remains retained, with saved rows hidden. Existing labels or renamed rows with the same permanent ID are preserved.

The correction switch separately restores ordinary **Cook a trout** to F2P. Its exact authored row has only raw trout and ordinary cooking-object gates at level 15; guide and Wiki both mark it free. The old value must match before the field changes.

## Spells, prayers, curses and abilities

The combat extractor distinguishes the tooltip branches using helper **3108** and params **2806/2880/2947**. Action name **2794**, level **2807**, tooltip **2795**, category/book **2871** and unlock text **4650** stay separate from skill-guide display fields. Helpers **2553/734** establish the guarded client membership flag **2809 >= 1**. Helper **18436** maps twenty rune item IDs to quantity params; runtime helpers **18435/18411** establish that actual cost evaluation also needs player state.

The export includes **532 known membership values**, **200 rune payloads containing 511 cost rows**, **61 quest unlock texts**, **one typed item reference and zero directly typed quest requirements**. Encoded quest prose remains text; it is not converted to a complete quest gate. Thirteen membership values are unknown. Base rune quantities do not establish substitutions, staff effects, free casts, scaling or consumed quantities. General non-rune item costs, complete equipment/unlock requirements, damage formulas and active server availability remain unverified.

The cache retains removed and internal entries. **Slice was removed in March 2026 but remains encoded**. Cache presence alone therefore creates no usable spell or ability task. Confuse demonstrates a separate stale field: guide display level 3 differs from action/Wiki level 1; the existing picker level 1 is correct.

The combat comparison covers **445 authored tasks**: **327 levels agree, 11 disagree, 12 are ambiguous, six lack an explicit action level and 89 are unmatched**. All 29 discrepant/ambiguous/missing-level rows are reviewed in [the versioned combat review](skillguide-combat-review.2026-10-08.v1.json).

Membership flag comparison finds **131 agreements, 210 discrepancies, 89 unknowns and 15 ambiguous joins**. Of the discrepancies, 183 compare absent/nonmember authored flags with a marked-members action and 27 compare authored members flags with an action marked free. An absent flag does not prove free eligibility; authored item, codex, quest and equipment gates remain in force. Every discrepancy has a retained decision; no combat membership field is automatically changed.

Plain rune-name sets agree in **44** comparisons, with **zero plain-name differences**. **218 substitution/marker cases remain unresolved**. Quantity and consumption equivalence is not asserted, and equipment-related assumptions remain authored.

### Reviewed corrections

`tasks.cache-combat-corrections` applies **ten combat Level changes plus the trout membership correction**. Despite the historical key name, its label is **Reviewed skill-guide and combat corrections**. Both switches are ordinary persisted group rules and default OFF.

- Constitution **10 → 1**: Sacrifice, Transfigure, Ingenuity of the Humans, Limitless, Slayer's Insight, Kuradal's Favour, Dragon Slayer (ability), Undead Slayer (ability).
- Magic **75 → 6**: Greater Sonic Wave.
- Necromancy **90 → 76**: Living Death.
- Cooking **members → free**: ordinary Cook a trout.

Each combat correction has an exact label, old value, whole-record fingerprint, cache struct/param and Wiki revision. Custom/drifted records remain untouched; corrections are immutable and idempotent. Task IDs, outputs, item/codex/equipment requirements and quest dependencies survive. Demon Slayer is withheld because its Wiki infobox and prose disagree on level 1 versus 10.

## Wiki validation

Web search discovered RuneScape Wiki samples; current public API revisions supplied the bounded fields. [Guide validation](skill-guides-wiki.2026-10-08.v1.json) records **nine pages and 22 matching checks**, with no differences or unavailable fields. Samples cover [Yew 70](https://runescape.wiki/w/Special:PermanentLink/37195444), [Willow 20](https://runescape.wiki/w/Special:PermanentLink/37197270), [Acadia 50](https://runescape.wiki/w/Special:PermanentLink/37166118), Air runes, four cooked foods/no-burn levels and Bronze arrows.

Six spell revisions corroborate encoded base rune quantities, books and membership: [Air Strike](https://runescape.wiki/w/Special:PermanentLink/37043960), [Confuse](https://runescape.wiki/w/Special:PermanentLink/37102595), [High Level Alchemy](https://runescape.wiki/w/Special:PermanentLink/37143695), [Fire Bolt](https://runescape.wiki/w/Special:PermanentLink/37043971), [Bake Pie](https://runescape.wiki/w/Special:PermanentLink/37024785), [Animate Dead](https://runescape.wiki/w/Special:PermanentLink/37025549). Correction revisions and contradictory/unmatched candidates remain individually linked in the combat review.

## API and hooks for Claude

No `app/web` file changed. The small runtime hooks are:

- Authenticated **GET `/api/skill-guide-catalogue`** returns the versioned portable catalogue: all skill entries/tabs/coverage, `combat.actions`, reviewed generated tasks, membership corrections, training breakpoints and provenance.
- `app/data/skill-guides.mjs` exports `skillGuideCatalogue`, `applySkillGuideTasks` and `skillGuideBreakpoints`; `skill-guide-rules.mjs` contains dependency-free browser rule IDs.
- `createTaskEngine` selects lazy variants from saved switches, with explicit `skillGuideTasks`/`skillGuideCorrections` options for isolated previews. Disabled additions never enter capability closure.
- The task worker advertises generated identities through `dynamicCatalogue`, allowing the existing completion command to register them without eagerly compiling an enabled engine.
- `planTraining` adds `skillGuideBreakpoints` as advisory metadata, also returned by the existing training-plan endpoint. No method, rate or access rule is inferred from that property.
- The server exposes only the small rule-ID module needed by the browser's existing rules dependency graph; the full catalogue is fetched through the authenticated endpoint.

## Read-only preview and reproduction

Claude can run the preview on a **private save copy**. Copy its sibling `static/` directory too when sidecars are used.

```powershell
node scripts/preview-skill-guides.mjs --state C:/private-copy/state.json
node scripts/preview-skill-guides.mjs --state C:/private-copy/state.json --json
```

The preview hydrates raw state, portable backups and compact sidecar envelopes using the existing hash/containment checks. It opens no store and writes no save, lock or backup. Four comparisons report **each member**, including zero changes: baseline→generated tasks, baseline→corrections, baseline→both, generated tasks→both. Results include metadata, presence, availability, blockers, hidden state, obligations and downstream capability changes. Existing application metadata/equipment corrections remain part of the baseline.

`--definitions`, `--catalogue` and `--corrections` permit isolated fixtures. Default data loads are relative to the script, so Claude can invoke it from another directory. The preview never contacts the live picker.

Reproduce into a **new** full-export directory; existing exports refuse overwrite:

```powershell
node scripts/cache/game-data-skill-guides.mjs --output C:/Users/User/Projects/rs3-cache-work/NEW-guide-version
node scripts/cache/game-data-combat.mjs --output C:/Users/User/Projects/rs3-cache-work/NEW-combat-version
node scripts/research/validate-skill-guides.mjs --guide <guide-json> --wiki <Wiki-API-snapshot-json>
node scripts/research/build-skill-guides.mjs --guide <guide-json> --manifest <guide-manifest> --wiki docs/research/skill-guides-wiki.2026-10-08.v1.json --combat <combat-json>
node scripts/research/skillguide-combat-corrections.mjs --export <combat-directory> --wiki C:/Users/User/Projects/rs3-cache-work --replace true
```

The combat correction generator's `--replace true` updates only the named worktree review/runtime evidence. Wiki snapshots are dated scratch evidence; refresh their API revisions intentionally when reviewing a new cache snapshot.

## Verification and changed files

Full `npm test`: **1,358 tests, 1,357 passed, zero failed, one skipped**, in 107.4 seconds. The pre-existing PNG byte/hash/dimension/alpha check was skipped because `SKILL_ICON_ASSET_ROOT` was unset. **All 32 new tests passed**, including the copied-cache artifact check. The full log is retained at `.local/skillguide-tests/npm-test.log`. Test temporary files stayed inside the worktree; isolated test servers used port zero. No real save was read or previewed.

The CLI preview used the complete authored definitions and two synthetic members with one unlocked section each (`12341` and `12850`), shared access disabled and no personal progress. Each member produced the same counts:

| Comparison | Checked tasks | Changed tasks | Changed availability details | Downstream capability changes |
| --- | ---: | ---: | ---: | ---: |
| Baseline → generated tasks | 20,379 | 4 | 4 | 0 |
| Baseline → corrections | 20,375 | 11 | 5 | 0 |
| Baseline → both | 20,379 | 15 | 9 | 0 |
| Generated tasks → both | 20,379 | 11 | 5 | 0 |

All four added milestones were blocked by existing ingredient, object and level gates. Corrections changed metadata and blocker explanations without making an existing task available in this fixture. The preview listed all twenty advisory training breakpoints. Purpose-built tests separately cover an accessible generated task, opt-in capability closure, per-member correction effects, toggle reversal, saved completion, compact-sidecar hydration and unchanged training segments.

Runtime changes: `app/core/rules.mjs`, `app/server.mjs`, `app/tasks/engine.mjs`, `worker.mjs`, `training-planner.mjs`, and five new data/rule/correction modules or JSON files under `app/data/`.

Extraction/research/preview changes: two new cache extractors, `scripts/preview-skill-guides.mjs`, three research builders/validators, this report and four versioned research JSON files. Tests add five skill-guide/combat suites and extend the shared repository provenance inventory.
