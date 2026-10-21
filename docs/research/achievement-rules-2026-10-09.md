# Achievement rule semantics, October 9, 2026

This report records original behavior, implemented controls and remaining compatibility differences. Source references are to the retained original `reference/original-picker/index.js` and `reference/original-picker/worker.js`. Source review and public source GETs do not establish unchanged live map progress.

## Original rule behavior

| Control | Original behavior | Source |
| --- | --- | --- |
| `Achievement` | Shows the active Diary section, including all achievement families. Also shows RuneScore and, when Combat Mastery is enabled, CombatScore. It does not gate task eligibility or score-based eligibility. | `reference/original-picker/index.js:6790-6792,9598-9599`; `reference/original-picker/worker.js:3703-3709,4075-4080` |
| `Show Diary Tasks` | Gates the 695 area-achievement records tagged with this category. Other achievement families use their own category gates. | `reference/original-picker/worker.js:4132-4137`; retained `challenges.Diary[].Category` |
| `Show Diary Tasks Complete` | Keeps only active Diary records with a `ManualShow` property. Property presence, including `ManualShow:false`, is the test. | `reference/original-picker/index.js:6792` |
| `Show Diary Tasks Any` | Relaxes specified Diary dependencies so individual area achievements can qualify without a completable prerequisite tier. It does not waive other requirements or directly disable parent/child grouping. | `reference/original-picker/worker.js:1482,1521,1549,1704,1727,1783` |

Active Diary rows also require a truthy validity value and must be neither completed nor backlogged. Backlog/completion lookups support the historical `#` to `/` alias (`reference/original-picker/index.js:6792`). The future-chunk preview uses a separate display check: new, truthy, unfinished Diary rows require Show Diary Tasks or Combat Mastery, together with the Complete filter (`reference/original-picker/index.js:7280,7453-7454`). This preview is distinct from the possible-catalogue counts below.

Category gates are conjunctive unless explicitly exempted by `maybePrimary` (`reference/original-picker/worker.js:4132-4137`). Combat Mastery uses `Combat Mastery achievements`; MQC uses `MQC achievements`; Completionist uses `Comp achievements`; trimmed records require both `Comp achievements` and `Trim achievements`. Miscellaneous records use `Misc achievements`; miscellaneous combat records require both `Misc Combat achievements` and `Combat Mastery achievements`. Additional tags such as Timegated, Speed Killer and Combat Master+ remain independent gates.

The worker calculates scores across eligible Diary keys, including display-pruned false values, excluding backlogged rows. `CombatScoreNeeded` consumes that total independently of `Achievement` (`reference/original-picker/worker.js:3703-3709,4075-4080`). Hiding the active section must therefore preserve prerequisite evidence and possible score.

## Any dependency exceptions and grouping

For a direct dependency, the missing/backlogged dependency rejection is waived when all these conditions hold (`reference/original-picker/worker.js:1548-1549,1782-1783`):

- The parent category is Diary.
- The declared dependency category is Diary, or the dependency key contains `--`.
- The dependency record exists after removing the `--` suffix.
- The parent has falsy `ManualShow`.
- Either Any is enabled and the parent's `BaseQuest` is outside the six non-area families, or the dependency's `BaseQuest` is `Combat Mastery achievements`.

The six non-area families are Combat Mastery, Combat, Completionist, Skills, Exploration and Activities achievements (`reference/original-picker/worker.js:215`). The Combat Mastery dependency exception applies independently of Any.

For `tasksPlus` alternatives, the exception instead requires a dependency with a `Reward` property and a parent without a `Reward` property. A qualifying alternative satisfies the ordinary alias, or increments the count for `[+]xN`. Counted aliases require the Diary dependency category; ordinary aliases also accept a `--` key. An unresolved alias still fails before these exceptions (`reference/original-picker/worker.js:1674-1709,1723-1731`; equivalent earlier branches at `1482,1521`). Reward property presence and parent ManualShow truthiness must not be conflated.

There is a source inconsistency in later processing revalidation: `reference/original-picker/worker.js:2001,2021,2043` uses `nonDiaryAchievements.includes(...)`, reversing the earlier `!includes(...)` test. These branches run inside processing revalidation over `tempItemSkill` (`reference/original-picker/worker.js:1976-1981`), rather than the main Diary validation pass. The authored helper follows the main Diary validator's `!includes(...)` predicate. The retained profile sets Diary processing to false (`reference/original-picker/index.js:1361`; `reference/original-picker/worker.js:4815-4821`), so the inverted predicates establish no current Diary behavior difference.

A fully valid parent replaces eligible dependency children with the same `BaseQuest`, except children with truthy `ManualShow`. The parent must not be backlogged. The original writes each child's validity value to false rather than deleting the record; alias expansion and recursive marking preserve dependency evidence (`reference/original-picker/worker.js:532-571,1608,1839-1865`). This preserves skill requirements and scores. It can also apply to Combat Mastery parents with declared child dependencies; a blanket exemption for that family would diverge.

## Activity Info group filtering: pending scope permission

The original `hideAchievements` preference filters families by rule membership, independently of active selection, completion or availability (`reference/original-picker/index.js:1111,9603-9615`):

| Family | Required-group condition |
| --- | --- |
| Area achievements | Always included |
| Combat Mastery achievements | `Combat Mastery achievements` |
| Completionist achievements | `Comp achievements` OR `MQC achievements` |
| Skills, Exploration, Activities achievements | `Misc achievements` |
| Combat achievements | `Misc Combat achievements` |

With `hideAchievements=false`, all families are included. Trim alone does not satisfy the Completionist family condition. There is no `RequiredGroup` field in the original; the authored model now exposes `group.required`.

The authored selector previously inferred groups from selected active task IDs (`app/web/info-panels.mjs:591-600`). That loses completed or currently blocked required groups, and hides groups when `Achievement` is off. Implementing the original required-group filter is pending scope permission; this report does not authorize that UI change.

## Intended compatibility differences and ownership

- Preserve reviewed F2P restrictions and corrections, including Archaeology/Necromancy trial levels through 20 and calculated Combat. Original eligibility alone does not override verified membership metadata. See [the parity checklist](../parity.md#deliberate-compatibility-corrections).
- Keep one canonical task per objective. Original skill-heading mirrors can show the same achievement under Diary and a skill; suppressing a duplicate presentation must preserve its skill requirement and evidence. See [the switchover review](switchover-parity-2026-10-08.md), class A rows 26-28.
- Preserve the group's explicit completion policy. Shared challenge satisfaction can suppress another grind without granting either member personal achievement, quest, skill, inventory or reward facts. See [gameplay migration](../migration.md) and the switchover review, class A rows 21-25.

Research reads archived public captures and source files. It does not modify Player 1's or Player 2's saves, completed/backlogged tasks, rule choices, map ownership, deployed picker or original service. Detached evaluations must retain those boundaries.

## Source-compatible archived evidence

Public GETs of `https://source-chunk.github.io/chunk-picker-rs3/index.js` and `https://source-chunk.github.io/chunk-picker-rs3/worker.js` on October 9 matched the retained LF-normalized source hashes:

| File | SHA-256 |
| --- | --- |
| `reference/original-picker/index.js` | `8e4d21bbfad09de8fffe263f131e3f5bdb63fca65da27c27f9e3d670623af894` |
| `reference/original-picker/worker.js` | `76a962701fd22c65d5c78e110dd7eb8733fc365e316e46e431d3d41700343404` |

The archive copy `.local/archive-evidence/processing-final-original.json` in the private checkout (moved from the retired pre-rebuild archive on 2026-10-14) was captured at `2026-10-09T02:16:41.974Z`. Both map records are view-only, version `6.9.68`, and store both hashes above. It can be reused unchanged as dated source-compatible evidence.

The earlier `parity/research/original-capture.json`, captured at `2026-10-09T00:36:40.711Z`, stores only the matching index hash. Both maps record no audit errors, read socket actions `q=38,n=37` and one blocked `s` action. Prefer the later archive when both source hashes are required. Neither archive proves that today's live rules or progress match the captured maps.

## Copied-save results and detached rule scenarios

Evidence is `.local/research/achievement-before-summary.json`, `achievement-after-summary.json` and `achievement-effects.json`. The compact summaries retain counts and every Diary difference identity/status; their before/after Diary projections agree exactly. Before/after reuse the unchanged October 9 `02:16:41.974Z` original archive above. The authorized copied save is revision 50; the earlier baseline save was revision 33. Counts compare category-qualified source identities, including false original validity values in the possible catalogue. They do not claim identical raw lists across progress or house-rule policies.

| Saved member flags | Before active / possible | After active / possible | Archive Diary active / possible | Local Diary active / possible |
| --- | --- | --- | --- | --- |
| Player 1 / QXA | 12 / 1,586 | 12 / 1,586 | 4 / 82 | 2 / 116 |
| Player 2 / QXB | 12 / 1,573 | 12 / 1,573 | 2 / 114 | 1 / 113 |

The repair adds or removes no current task under saved flags. Both members have Achievement and Show Diary Tasks on, Complete and Any off. Rule changes below were evaluated on detached copies and never persisted.

| Detached scenario | Player 1 active / possible | Player 2 active / possible | Player 1 / Player 2 Diary possible |
| --- | --- | --- | --- |
| Saved flags | 12 / 1,586 | 12 / 1,573 | 116 / 113 |
| Achievement off | 10 / 1,586 | 11 / 1,573 | 116 / 113 |
| Show Diary Tasks off | 8 / 1,466 | 9 / 1,456 | 0 / 0 |
| Show Diary Tasks Any on | 37 / 1,611 | 36 / 1,597 | 141 / 137 |

Achievement off hides Player 1's Lumbridge Hard completion and Varrock Relocation, Relocation, Relocation; it hides Player 2's Lumbridge Hard completion. Show Diary Tasks off also removes the active obtain goals for Explorer's rings 1 and 4, because their area-achievement rewards lose eligibility.

Any adds 21 common Diary duties, four Player 1-only duties and three Player 2-only duties. No current duty is removed. These are the complete added names, grouped by family:

- Both, Falador: Ice the Icy; Do They Come in Other Colours?; Kitty Litter; Mass Production; The Stonemasons.
- Both, Karamja: I'm a Lumberjack and I'm Okay.
- Both, Underworld: Command & Calcium.
- Both, Varrock: Double-strength Weaksauce; Champion!; Can't Make an Omelette; Unlocking Your Emotions; You Wouldn't Like Me When I'm Angry; Promised the Earth; Like a Varrocket; Faster, Pussycat! Kill! Kill!; Put Your Smithing Hat; Intersceptre; Waka-Waka-aka; A Ton of Earth.
- Both, Wilderness: Notatrivialtask; A Pizza the Loot.
- Player 1 only: Varrock Make a House a Home; Wilderness Wet and Wildy; Wilderness pUrE a ChAoS oF cOrPsE!; Wilderness I'm the King of the Wild!
- Player 2 only: Karamja Back Cran-door; Karamja Dungeons and Dragons; Varrock The Body Shop.

## All saved-flag Diary differences

Player 1 has nine archive-only possible rows and 43 local-only possible rows. Player 2 has three archive-only possible rows and two local-only possible rows. Every named difference below existed before this repair.

| Direction / member | Named rows | Evidence and classification |
| --- | --- | --- |
| Archive-only possible, Player 1 | Karamja Easy Beachcomber; New Varrock Easy Hand Exchange, Hide and Seek, Ready, Deady, Cook, Trade Parade; Varrock Easy Plank You Very Much, Jackanory; Wilderness Easy Taking the Subway | Eight rows have explicit local membership blockers. New Varrock rows are also outside her own obligation map. These follow reviewed F2P restrictions. |
| Archive-only possible, Player 1 | Wilderness Easy Complete the Easy Achievements | Local dependency blocker is Taking the Subway, the members-only child above. Retaining that child as shared challenge-satisfied does not waive its gameplay requirement. |
| Archive-only possible, Player 2 | Karamja Easy Beachcomber; Varrock Easy Plank You Very Much; Wilderness Easy Taking the Subway | Each local row has membership and current-member backlog blockers. Taking the Subway is also challenge-satisfied. No lost free unfinished duty is demonstrated. |
| Local-only possible, both | Underworld Easy Damage Without Consequences | Original `nonValids=["F2P"]`; declared requirement is Necromancy 13, while local primary training reaches the corrected trial cap 20. This is an intended F2P correction. Both local rows are challenge-satisfied and inactive; Player 2 has a saved challenge check and the archive already lists his completed challenge. This does not assert personal in-game achievement completion. |
| Local-only possible, Player 2 | Varrock Easy Stick the Knife In | Original rejects Varrock Sewers, then VarrockSewerAccess[+]. Its manhole route rejects missing chunk 12854; its Edgeville route rejects the Agility 51 pipe. The local Edgeville route remains blocked at the F2P Agility cap 5. Player 1 owns 12854; her manhole route appears in Player 2's other-accessible catalogue with obligation=false. Current capability-area propagation admits Varrock Sewers and the Diary row with own obligation=true. This is the existing partner area-access policy, unchanged here. It proves the model's source chain, not a personal Player 2 entrance or exact original gameplay parity. The row is challenge-satisfied and inactive. |
| Local-only active, Player 1 | Varrock Easy Relocation, Relocation, Relocation | The archive has this row eligible but backlogged. Revision 50 explicitly sets backlogged=false; her own 12854 source remains reachable. This is saved progress drift. |
| Archive-only active, Player 1 | Desert Easy Kookookachat; Lumbridge Beginner The Rules of Engagement, Tower Power, Beware of Pigzilla | All four canonical local rows are available, own obligations and explicitly challenge-satisfied, so current presentation suppresses them under the group completion policy. |
| Archive-only active, Player 2 | Lumbridge Medium Complete the Medium Achievements | The canonical local row is available, own obligation and explicitly challenge-satisfied. Shared policy suppresses another completion duty. |

The remaining 42 Player 1-only possible rows form one Lumbridge dependency chain. Here are all names, including parents:

- Beginner (1): Complete the Beginner Achievements.
- Easy (20): And It Was THIS Big!; Draaaaaiiiiins...; Belter of a Smelter; Come In Here and Say That; Slippery When Wet; Klept-Old-Man-ia; Eye on the Prize; I Can't Hear Dead People; Nowt Tool Look At; You Doity Rat; It Was Dead Already!; Camping Trip; Ratatouille; What Is This Place?; Money Down the Drayn; Artisan Crafting; Bless Is More; Morgan the Merrier; Iron On; Complete the Easy Achievements.
- Medium (13): Everybody Loves Coal!; A Meal Fit For a Duke; Lovely With a Squeeze of Lemon; Weeping Willow; Always Be Prepared; Steel Justice; Ease of Access; Willow the Wisp of Smoke; Where's The Beef; Hi Ho, Silver; One Day, You Shall Be a Fork; Made to Order; Complete the Medium Achievements.
- Hard (8): A Body in the Sewers; Building Up Strength; Have Your Cake and Eat It; Blast and Hellfire; Gods, Give Me Strength; Not Waving But Drowning; Are Yew As Fired Up As I Am?; Complete the Hard Achievements.

The archive's Beginner parent rejection lists Wait, That's Not a Sheep; Herald the Dawn; The Fruit of the Sea; Clay More; Just Add Water; Very Potter; Hotpot. Its failed parent propagates through Easy, Medium and Hard. Wait, That's Not a Sheep is backlogged in the archive but explicitly cleared in revision 50. All seven children now have available local location/item/object evidence; the six other names are recorded completed in the archive and eligible in its final possible catalogue. These diagnostics and final catalogue do not establish the exact old evaluation ordering. Current before/after eligibility agrees with Any off; this qualification must remain when describing the historical chain.

Current grouping hides eligible same-family children behind their parents. Beginner, Easy and Medium parents are challenge-satisfied; Player 1's Hard parent remains her active duty. Player 2's Hard parent is common to original and local active lists. Original Player 2 also mirrors Blast and Hellfire under Magic and Not Waving But Drowning under Runecrafting; both canonical Diary objectives and their skill requirements remain present. Keeping one canonical duty is the established skill-heading decision.

Within the inspected Diary identities, the repair introduces no new eligibility difference, and every archive-only active duty has a documented current suppression reason. Historical Lumbridge ordering and Player 2's partner-area access remain qualified; these are not claims of full parity.

## Implementation and verification

- Main implementation commit: `a780dcb`, on `codex/achievement` from `2930ca8`, with a subsequent validation-order guard for malformed Any values. No push, rebase or merge.
- `app/tasks/achievements.mjs` implements metadata-based dependency exceptions and required-family classification. `engine.mjs` applies the area category gate, independent Achievement display, and the same relaxed dependencies to eligibility and own obligations. `presentation.mjs` selects active Diary rows using Achievement while preserving tier grouping. `activity.mjs` exposes required-family metadata and recognizes tier-marker property presence. `app/data/settings.mjs` updates descriptions and marks Achievement, Show Diary Tasks and Any as implemented-scope; their limitation badges disappear through the existing rules panel.
- Tests changed: `tests/achievement-rules.test.mjs`, `tests/presentation.test.mjs`, `tests/settings.test.mjs`. Focused command `node --test tests/achievement-rules.test.mjs tests/presentation.test.mjs tests/settings.test.mjs` passed **61/61**. The new suite has **25 tests**, including all 16 flag combinations, direct/alias Any exceptions, distinct alias counts, Combat Mastery independence, F2P item/activity/level gates, tier grouping, required-family metadata and malformed Any values. Tests caught and now cover waived-tier ownership and validation-order bugs. The malformed-value test failed before the guard and passed afterwards; malformed saved values are reported but never interpreted as enabled.
- Final `npm test` passed **1,993**, failed **0**, skipped **1**, out of **1,994** tests in **371.04s**, including the validation guard and final explanatory text. The skip is the optional generated PNG manifest/alpha check, unrelated to achievements. TEMP/TMP were redirected inside this worktree. All six prediction goldens were unchanged and passed.
- **Performance:** Three repetitions per batch on the same copied save: cold tasks **7,097 → 5,826 ms**; reload **1,297 → 881 ms**; switch to Player 2 **5,535 → 3,030 ms**; switch to Player 1 **301 → 293 ms**; Unlock to refreshed tasks **3,271 → 2,995 ms**. No measured task milestone regressed. After Unlock repetitions were **2,995 / 2,773 / 3,621 ms**, so only the median meets the 3-second target. [Performance notes](../performance.md) retain report paths and the background-advisory distinction. This is headless localhost evidence, not a phone/Funnel latency claim.
- **Screenshots:** `.local/research/screenshots/` contains desktop **1440×900 light** and phone **390×844 gray** captures for Achievement rules/details, Diary rules/details and unfiltered Player 2 tasks. Both normal task captures show **12 active / 1,573 possible**, with **Diary (1): Lumbridge Achievements Complete the Hard Achievements**. Achievement, Diary, Complete and Any have no limitation badges. Expanded notes use player language. Root inspected the desktop Achievement details, phone Diary rules and both normal task views. Document widths match the viewport; dialogs have no horizontal overflow. Supplementary `*-player2-lumbridge-tasks.png` images use an exact Hard filter, so their count of one is not the normal Active Tasks total. Task search intentionally exposes catalogue rows, including grouped children. These screenshots are visual checks taken while the full suite runs, not latency measurements. The source save hash was preserved and review processes/profile/scratch save were cleaned.
- Activity Info's required-family model is implemented and tested; its UI still filters by selected active IDs. The small `app/web/info-panels.mjs` change is outside the stated achievement ownership. Scope approval was requested; a reviewable patch is prepared at `.local/research/required-groups.patch`, passes `git apply --check`, and remains unapplied pending that answer.
- Original RuneScore/CombatScore summaries are not exposed in the current Activity Info UI. This repair restores task display and preserves CombatScore prerequisite eligibility; it does not add that separate score surface.
- Original future-chunk preview visibility is distinct from active Diary display, as described above. Authored `app/core/planning.mjs` still filters predicted additions by the engine's `hidden` flag, so Achievement off also hides those Diary additions. This separate preview-display difference remains outside the stated achievement file ownership and does not affect the saved-flag counts above.

## Files and cleanup

Tracked files changed:

- `app/tasks/achievements.mjs` (new)
- `app/tasks/engine.mjs`
- `app/tasks/presentation.mjs`
- `app/tasks/activity.mjs`
- `app/data/settings.mjs`
- `tests/achievement-rules.test.mjs` (new)
- `tests/presentation.test.mjs`
- `tests/settings.test.mjs`
- `docs/research/achievement-rules-2026-10-09.md` (new)
- `docs/performance.md`

The copied `.local/duo`, review save/profile, archived baseline fixture/archive and test temporary directory were deleted after their processes stopped. The two full private model reports were deleted after compact summaries were verified; scalar performance reports, compact task effects/differences and screenshots remain ignored. `.local/research/achievement-cleanup.json` records the private copy and review artifacts absent. No private save or screenshot is committed. `.gitattributes` is unchanged and tracked files retain LF. The main checkout, its live save, original picker and Tailscale were not modified; test servers used ephemeral localhost ports outside 8788/8789/8790.
