# RS3 processing parity follow-up — 2026-10-08

`4a8020a` was withheld from deployment after its uncached performance regression was measured. The subsequent optimization is documented in the [processing performance follow-up](switchover-processing-performance-2026-10-09.md).

The processing-source repair is implemented on `codex/parityfix`, on top of `bcfd9a3`. **String a diamond amulet** and **Cast Lvl-4 Enchant on a diamond amulet** are now blocked and inactive on both maps. The app's active list falls **22 → 20** on each map, with no other active additions or removals. Every remaining active difference is classified below; none is an unexplained processing bug in these captures.

Player 1 confirmed that **coupled loadout BiS scoring stays, including Rune arrow pairing**, and **tasks keep their canonical skill headings and appear once**. These are deliberate differences. The five progress-mapping questions remain separate and unresolved. This comparison does not certify the separate real-device operational switch checks.

## Evidence and counts

Fresh original captures: **2026-10-09T02:05:57.629Z** and **2026-10-09T02:16:41.974Z**, October 8 local time. Both clients reported v6.9.68, and the deployed index/worker hashes matched the retained audited source. The later capture supplied the final comparison. Original active/possible counts remained unchanged between captures.

Both evaluations used the same newly copied authored state: revision **33**, SHA-256 `e4b739b847c73743390a471693f5830563b11009ba13fe8e7ac481c2c4d256ad`. The before run used `bcfd9a3` engine, presentation and worker sources extracted into ignored worktree research files, with their unchanged dependencies. No checkout or branch replacement was needed. The after run used the normal current scheduler with the copied save and read-only main geometry/assets.

**A** is original-only identity; **B** is app-only; **C** is a matched task with differing availability or base/effective level. C overlaps A/B and applies to the full model, not the active list. Original aliases may coalesce, so original count minus common need not equal A. Full eligible counts include searchable intermediate recipes whose output publication may be excluded.

| Map / set | Original | App | Exact common | A | B | C | Unresolved original |
|---|---:|---:|---:|---:|---:|---:|---:|
| QXA before active | 18 | 22 | 1 | 17 | 21 | — | 0 |
| QXA after active | 18 | 20 | 1 | 17 | 19 | — | 0 |
| QXA before full model / eligible | 1536 | 1545 | 1306 | 229 | 239 | 205 | 24 |
| QXA after full model / eligible | 1536 | 1543 | 1306 | 229 | 237 | 205 | 24 |
| QXB before active | 8 | 22 | 3 | 5 | 19 | — | 2 |
| QXB after active | 8 | 20 | 3 | 5 | 17 | — | 2 |
| QXB before full model / eligible | 1519 | 1585 | 1291 | 227 | 294 | 176 | 50 |
| QXB after full model / eligible | 1519 | 1580 | 1291 | 227 | 289 | 176 | 50 |

QXA still has **151 unlocked / 4 selected** chunks; QXB has **113 / 20**. Selected order matches. The two unresolved QXB active records are the original Magic/Runecrafting diary mirrors listed below, covered by Player 1's canonical-heading decision. The wider catalogue C/unresolved findings remain in the [audit register](switchover-parity-2026-10-08.md) and [previous repair report](switchover-parity-fixes-2026-10-08.md); this change neither resolves those identities nor claims full upstream equivalence.

## Generic source selection and named effects

The authored selector groups by skill and **each usable consumable input**, excluding ordinary and Magic tools. Highest Level OFF takes the union of the lowest effective-level winners, with Primary/Secondary and Priority ties, then promotes eligible recipes below the independently established skill frontier. Highest Level ON admits the ordinary grouped candidates. Frontier promotion uses the original stage's exact selected task keys; initial availability still resolves declared task aliases. This distinction preserves alias-valid input winners while avoiding promotions the original rejects.

The engine replays closure from admitted sources. An available producer outside the frontier remains searchable with `sourceEligible=false`, but cannot establish downstream item availability, primary training, equipment, boosts, XP or task-gated access. Multi Step outputs carry conditional provenance and cannot become ordinary boosts, ammunition/bone training or equipment evidence. Redundant NoXp outputs are removed before they can raise the frontier. Starred Nonskill source names remain independent resource roots; unstarred transformed sources expand through their consumable inputs. No task name or task ID is suppressed.

| Map | Named result |
|---|---|
| Both | **Craft a diamond amulet (unstrung)** remains a searchable available recipe at Crafting 70, but its output is excluded from source proof under the saved selectors. **String a diamond amulet** (`0009a4`) and **Cast Lvl-4 Enchant on a diamond amulet** (`0015ae`) consequently lose their required amulet inputs and leave the active list. |
| Both | **Diamond ring** and **diamond necklace** retain admitted sources. The independent Crafting frontier preserves the necklace below level 57 while excluding the level-70 amulet chain. |
| Both | **Spin a ball of black wool → Weave a strip of black cloth → Craft black wizard equipment** remain eligible through the original starred sheep-gathering source. **Unlock no-burn lobster cooking** remains the optional active milestone and does not raise a processing frontier. **Fire Blast** remains searchable, but does not become a replacement active goal. |
| QXB | The eligible catalogue also loses **Fletch a mithril grapple**, **Tip ruby bolts** and **Tip diamond bolts** because their unselected upstream producers no longer supply Mithril grapple (unf), Ruby bolt tips or Diamond bolt tips. These were already inactive and are absent from the original possible list. QXA retains all three with its admitted supplies. |

The retained original source experiments verified the input-winner union, independent frontier, tools, ordinary versus virtual multistep supplies, raw personal levels and literal promotion prerequisites. Source references: `reference/original-picker/worker.js:4815–5070` for grouping/ranking; `:2193–2328` for frontier promotion; `:4848,4899–4936` for starred versus expanded Nonskill roots; `:4457` for virtual producer-level restrictions. The older raw pruning at `:1238` applies to previous groups before rebuilding; it is not imposed as an extra raw-level ceiling on the fresh OFF groups.

Regression counter-examples preserve an independently supplied unstrung diamond amulet's **String → Enchant** chain, an uncontested producer, Highest Level ON, and a higher Ore recipe selected independently by its Gem input. The actual black-wool chain supplies another positive example.

## Every remaining active difference

| Map | Shared challenge satisfaction | F2P/data corrections | Optional milestone | Scoring ties | Canonical headings | Bugs / unexplained |
|---|---:|---:|---:|---:|---:|---:|
| QXA | 16 | 17 | 1 | 1 | 1 | 0 |
| QXB | 3 | 14 | 1 | 2 | 2 | 0 |

No remaining active difference is attributed solely to partner-only supplies or backlog. Those distinctions continue to affect the full catalogue. Scoring tie picks and the accepted coupled loadout policy are deliberate; actual personal ownership remains separate from obtainability.

### QXA remaining active differences

| Side | Named task / heading | Classification | Explanation |
|---|---|---|---|
| Original only | Constitution: Create a portent of restoration I | Deliberate canonical heading (confirmed) | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | Divination: Create a attuned portent of restoration I | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Herblore: Clean a grimy tarromin | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Slayer: Slay a crawling hand in Burthorpe | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | BiS: Obtain an amulet of accuracy | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Beneath Cursed Tides Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Duck Quest Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Goblin Diplomacy Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Imp Catcher Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Myths of the White Lands Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Rune Mysteries Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Stolen Hearts Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Quest: Swept Away Complete the quest | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Desert Achievements Kookookachat | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements The Rules of Engagement | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Tower Power | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Beware of Pigzilla | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| App only | Archaeology: Use a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Combat: Get access to War's retreat | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Cooking: Unlock no-burn lobster cooking (standard fire/range) | Deliberate optional goal catalogue | Enabled Skill Guide tasks add the reviewed no-burn Cooking milestone. This does not create a new mandatory house rule. |
| App only | Necromancy: Unlock and cast the Command Skeleton Warrior ability | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Gertrude's Cat Complete the quest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Purple Cat (miniquest) Complete the miniquest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Breaking the Seal Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Prison Break Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements eLeMeNtAl kIlL cHaOs III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Layering Up | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Mole Removal III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Naturist | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Three Heads Are Deader Than One II | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Broken Bones III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Extra: Obtain a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain a Team-1 cape | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain Deathwarden boots (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden gloves (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain a Skull lantern (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |

### QXB remaining active differences

| Side | Named task / heading | Classification | Explanation |
|---|---|---|---|
| Original only | Magic: Lumbridge Achievements Blast and Hellfire | Deliberate canonical heading (confirmed) | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | Runecrafting: Lumbridge Achievements Not Waving But Drowning | Deliberate canonical heading (confirmed) | The canonical task and requirements remain available. Original skill mirrors are not synthesized; the canonical diary counterpart can be collapsed into its tier. |
| Original only | BiS: Obtain a monk's robe (bottom) | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | BiS: Obtain a monk's robe (top) | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| Original only | Diary: Lumbridge Achievements Complete the Medium Achievements | Deliberate shared challenge satisfaction | The saved self/duo challenge check suppresses this duty. It does not grant personal quest completion, inventory or a usable teleport. |
| App only | Archaeology: Use a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Combat: Get access to War's retreat | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Cooking: Unlock no-burn lobster cooking (standard fire/range) | Deliberate optional goal catalogue | Enabled Skill Guide tasks add the reviewed no-burn Cooking milestone. This does not create a new mandatory house rule. |
| App only | Necromancy: Unlock and cast the Command Skeleton Warrior ability | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Gertrude's Cat Complete the quest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Purple Cat (miniquest) Complete the miniquest | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Breaking the Seal Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Quest: Archaeology Mystery: Prison Break Complete the mystery | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Mole Removal III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Three Heads Are Deader Than One II | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Diary: Combat Mastery achievements Broken Bones III | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | Extra: Obtain a steel mattock | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden boots (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain Deathwarden gloves (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |
| App only | BiS: Obtain an Explorer's ring 1 | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain a Rune battleaxe | Deliberate scoring tie | Team-1/Team-16 cape, explorer ring 1/4 or rune battleaxe/mace are equivalent retained score ties; independent ownership remains separate. |
| App only | BiS: Obtain a Skull lantern (tier 10) | Deliberate F2P/data correction | The baseline exhaustive register traces the reviewed item/activity membership or corrected Combat/Necromancy/Archaeology trial gate. |

## Five unchanged progress questions for Player 1

1. **Player 2 — Farming, Perils of Ice Mountain step 1:** did the check mean he met the Farming requirement, or finished the whole step's chunk challenge?
2. **Player 2 — Hunter, Perils of Ice Mountain step 1:** did this separate check mean he met the Hunter requirement, or finished the whole step?
3. **Player 2 — Construction, Perils of Ice Mountain step 1:** is Construction still waiting, or is the empty-reason backlog obsolete? Farming and Hunter are checked, so choosing either completed or backlogged would discard conflicting evidence.
4. **Player 2 — Smithing, Beneath Cursed Tides step 1:** did the check mean he met 30 Smithing, or finished the canonical chunk task?
5. **Player 2 — Strength, Beneath Cursed Tides step 1:** did this check mean he met 30 Strength, or finished the canonical chunk task?

These remain quarantined. Choosing canonical headings does not decide what these old checks meant or overwrite the conflicting backlog.

## Boundaries, files and validation

Only the authorized worktree was written. Its copied `.local/duo` had `store.lock` and `invites.json` removed and was deleted after checks. Main game data and map assets were read-only. Tests redirected TEMP/TMP into the worktree; throwaway test servers used localhost ephemeral ports. The original ran headlessly in view-only mode: no credentials, clicks or save controls, non-GET Firebase/long-poll requests blocked, socket reads whitelisted. Each map recorded 38 read subscriptions, 37 unlistens, one blocked statistics frame, no HTTP mutations and no worker errors. The Windows harness cleanup targets only its own spawned Chrome PID/tree and verifies process disappearance. Main tracked files, live duo/picker and Tailscale were untouched. No push, rebase or merge.

Executable files: `app/tasks/processing.mjs`, `app/tasks/engine.mjs`, `app/tasks/presentation.mjs`; rule metadata in `app/data/settings.mjs`; isolated browser cleanup in `scripts/perf/cdp.mjs`. The Chunk Rules web page was not edited.

Tests: **19 new regressions** in `tests/processing-parity.test.mjs`. Existing secondary-rate fixtures now explicitly enable cross-skill processing; the Dreadfowl presentation fixture includes the secondary supplies its declared available row assumes. Updated fixtures are in `tests/engine.test.mjs`, `tests/presentation.test.mjs`, `tests/rules-fixes.test.mjs`, `tests/parity-diary-equipment.test.mjs`.

All six prediction goldens were updated for a deliberate source-proof correction: **Product** was previously reported as an own supply origin even when its quest-gated output was unavailable. Each new baseline removes that phantom origin; the two backlogged scenarios also make fewer checks. Complete before/after object diffs verified no other gameplay changes in those fixtures. The same hashes also include accurate processing-field/limitation metadata. This is recorded in `tests/prediction-output.test.mjs`.

Documentation: `PRODUCT.md`, `docs/task-engine-coverage.md`, the two historical reports and this report. The earlier reports now point here and identify their open decisions as historical.

**Final full `npm test`: 1818 tests, 1817 passed, 1 skipped, 0 failed.** All six skill-icon checks passed separately against the authorized main assets read-only, including the optional generated-PNG bytes/hash/dimension/alpha check skipped in the default suite. The independent processing review passed 54 affected tests; the adjusted rate/Dreadfowl fixtures passed 42 tests. `git diff --check` passed.

Staged replay adds uncached work: final harness engine timings were about **11.4s QXA / 11.3s QXB**, compared with **2.6s / 2.3s** for the same-copy before run. Independent quieter direct checks took **9.9s / 8.8s**, converging in five/six source passes with no cycle/limit diagnostics. A further normal scheduler check with the foreground **30-second deadline** passed both maps: complete cold evaluations took **11.8s / 13.3s**; cached calls took **0.42s / 0.41s** and retained 20 active tasks each. These are indicative host timings, not a device benchmark. Bespoke required-highest links and unusual generated source expansion remain diagnosed limits.
