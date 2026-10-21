# Parity checklist

The [October 8 switchover repairs](research/switchover-parity-fixes-2026-10-08.md) record fresh two-map comparison counts, named regressions and remaining processing/scoring decisions.

Reference version 6.9.68 at `98a3bdc`, compared on October 7, 2026; feature and metadata claims refreshed from source on October 8. The authored application remains
a beta under active parity work. Player 1's review identified material omissions in the first pass;
the follow-up adds the named panels and a complete settings inventory, without claiming full replacement readiness.
“Implemented” means the feature exists in the authored app;
“partial” means a useful version exists but some upstream modes or specialist calculations remain.
Baseline browser evidence is tracked in [verification.md](verification.md); follow-up module, server and isolated browser acceptance is tracked in [followup-verification.md](followup-verification.md). The follow-up evidence supports the bounded behaviors below, rather than complete original-picker equivalence.

| Feature | Acceptance evidence | Current coverage |
| --- | --- | --- |
| Map, grid, zoom, pan, labels and ownership | Correct coordinate correspondence and representative desktop/mobile interaction | Implemented; desktop/mobile browser pass completed |
| Unlocked, selected, pending and blacklisted states | Preserve distinct states through import, roll, choice, backup and restore | Implemented |
| Normal rolling and candidate controls | Honor ownership, selected pool, manual changes, terrain/F2P switches and history | Implemented with explained candidate decisions |
| Roll 2, choose one, Pick for me, unlock both and cancel | Reject fewer than two candidates before mutation; frozen-offer random choice returns unchosen candidates and supports undo | Implemented |
| Unpick / forfeit | Remove personal ownership, return the chunk to selected and undo both changes | Matches the original |
| Random start and neighbor modes | Correct pool and transition for manual, accessible and removal policies | Implemented |
| Neighbor and section expansion | Four grid neighbors plus section topology, manual overrides and walkable filtering | Implemented in the access/rules engines |
| Named interiors and connections | Gate interiors by reachable entrances/tasks and fail closed on missing references | Implemented; malformed references are diagnosed |
| Chunk contents and information panel | Show objects, NPCs, monsters, shops, spawns, quests and clues | Raw contents plus derived Clues/Possible Tasks sections implemented; all defaults open corresponding accordions. Location associations preserve section/source gates; overall task reachability may use another source |
| Current BiS and personal obtain records | Compare obtainable coupled loadouts and distinguish personal obtain evidence from shared challenge checks | Obtainable/Recorded obtained views plus Tank, Weight, Skilling, Relics, Unlocks and Upgrades specialist tabs implemented. Tank and explicit Set/Priority comparisons, prerequisite evidence and score tiers are supported; verified ordinary-slot weights cover 3,019/3,550 retained rows, while missing weights, coupled weight ranking, set effects and current inventory remain limits |
| Activity Info | Skills, quests, achievements, activities, Slayer and clue details with source evidence | Six planning tabs plus personal primary/passive/maximum-level and Slayer-lock editors implemented with revision guards. Full discretionary XP allocation, original achievement filtering and complete-scroll inference remain outside parity |
| Original settings and rules catalogue | Inventory every original key and expose supported controls with honest scope | Complete retained-source inventory; all 26 scalar preferences have authored consumers, four nested neighbor flags map to 11 shared group rules. Nine themes, stickers, recent five rolls, high visibility and actual-result reveal are native adaptations; complete functional parity is not claimed |
| Automatic tasks and possible-task preview | Evaluate both members and hypothetical unlocks without saving | Implemented; 34 unsupported hard-reference records fail closed |
| Training, primary methods and boosting | Apply saved levels, reachable methods, trial caps, boosts and source rules | Partial: numeric/percentage boosts and Crystal saw are consumed, but XP formulas and eligibility/presentation boost adjustment differ; specialist processing modes remain partial |
| Quests and whole/partial completion | Keep personal game completion separate from shared challenge satisfaction | Implemented |
| Achievements, diaries, minigames and extras | Apply category/rule visibility without removing dependency evidence | Partial: declared records exist, but Show Diary Tasks controls all-Diary visibility while retaining dependency eligibility; original Achievement and Show Diary Tasks Any have no authored consumer. Bespoke generators remain partial |
| Items, drops, sources and collection logs | Resolve category-qualified tasks and alternate acquisition paths | Declared records and four collection generators implemented with exact source/item identities, nested source flags and explicit completion evidence. Missing/cyclic tables and unresolved hard aliases fail closed; special-source completeness is not established |
| Combat, prayer and equipment recommendations | Explain obtainable candidates, styles, coupled weapons and alternatives | Ordinary combat/prayer, tank and declared skilling comparisons implemented; verified ordinary-slot weight comparisons are available; target-specific DPS, set-effect simulation and coupled weight ranking remain outside scope. No original relic-energy optimizer is established |
| Current goals, completed, backlog, favorite, notes and alternatives | Preserve personal status and present a deterministic next-goal list | Personal skill/Every Drop active-goal selection and Automatic reset implemented with imported-choice fallback and revision guards; source choice does not manufacture completion |
| Search and filters | Search chunks, contents, tasks and sources; retain full available catalogue | Implemented |
| Notes, stickers, markers and screenshots | Round-trip imported records without executing text | Personal/imported stickers and starting annotations implemented with local assets and explicit removal overrides. Starting annotation does not run original map setup; screenshot export remains missing |
| History, undo, sandbox and task prediction | Reverse commands safely and preview hypothetical unlocks without saving | Implemented; restore creates an explicit undo boundary |
| Themes, mobile and accessibility | Usable responsive layout, keyboard/focus behavior and visual states | Nine native themes exercised in browser, with component-contrast checks and 390×844 inspectors without horizontal overflow. High-visibility layers remain native adaptations. Shift-click works; original mobile long-press unlock remains missing |
| Save/load, backups and restore preview | Versioned round-trip, malformed-file rejection, atomic persistence and conflict handling | Implemented in the private local server |
| Friends, sharing and view-only use | Two-user conflict recovery and explicit permission boundaries | Separate revocable per-member invitations and revision conflicts implemented; per-user authentication and view-only invitations remain outside scope |
| Group maps and ownership overlay | Preserve both owners; distinguish disconnected partner territory with route evidence | Implemented with directed round-trip checks |
| Personal/group completion and supplies | Never invent another player’s personal progress | Completion implemented; broad supply/XP planning remains partial |
| Teleport adjacency | Personal confirmation adds only that destination as a candidate and leaves it locked until rolled | Implemented |
| House-rule profiles and extensions | Add a rule without changing the evaluator; preview profile import | Implemented |
| Eligibility explanations | Show inclusion/exclusion reasons, dependency chains and source paths | Implemented; unsupported requirements are visible and fail closed |
| Account refresh and planner | Timestamped imports, manual overrides and progression estimates | On-demand RuneMetrics fetch/review/revision-checked apply/undo for personal levels, XP and completed quests; Activity Info Training plan UI/API compares reviewed F2P routes. Inventory, achievements, quest steps and unreviewed training methods remain outside scope |

## Deliberate compatibility corrections

| Reference behavior | Authored behavior |
| --- | --- |
| 35 duplicate legacy task IDs | Category-aware stable IDs; unresolved ambiguity remains in migration provenance |
| Overlapping F2P checks reject Archaeology/Necromancy trial levels through 20 | One explicit policy admits those skills through level 20 |
| Pseudo-skill Combat is absent from the reference free-skill list and can be rejected as `F2P` | Combat is calculated from combat skills and is not treated as a five-level members trial skill |
| Missing topology destinations can leak into later calculations | Missing references are diagnosed and hard access requirements fail closed |
| Unknown rates use NaN/coercion and some opaque labels become primary | One parser admits unknown rates through rarity, never as primary; raw unknown labels remain visible in evidence |
| Rare equality is excluded; primary equality varies by path | Rare Drop Inclusive defaults off; Secondary Primary Inclusive defaults on for the duo, with one comparison policy across consumers |
| Zero amount uses a tiny positive cutoff | Zero explicitly includes every known rate, including zero; unknown rates remain non-primary |
| Thieving collection expansion has inconsistent nested quantity slots | Recursive tables compose declared numeric parent/child quantities consistently and preserve opaque ranges/annotations |
| A saved Every Drop source can leave no active goal when unavailable | An eligible saved choice wins; otherwise an alphabetical reachable source is shown with a diagnostic |
| Geometric adjacency can admit an isolated terrain square | Automatic adjacency defaults to a connection from reachable unlocked terrain; explicit geometric frontier remains a house rule |
| Aggregate Edgeville Dungeon sources leak members-only monsters and drops into F2P goals | Dated RS3 source policies reject verified member sources before item/task generation; free alternatives remain available. This is a targeted correction, not a complete membership-boundary audit |
| Roll 2 can mutate with one candidate | Validation rejects the command before RNG or state mutation |
| Whole-object saves can overwrite another editor | Revision-aware queued commands report conflicts and require review/retry |
| Imported text is embedded in executable handlers | Imported strings remain data and the UI binds listeners directly |
| Stale worker responses can replace newer results | Authored requests and saves carry revisions; rejected/stale work is visible |

The retained offline worker comparison has seven authored-only presented rows. Each reaches an exact
original `nonValids=["F2P"]` frontier: Necromancy 13/20, Archaeology 12/20, or Combat 60. The authored
rows follow the corrected policy above. This classifies the difference against the retained worker;
it is not independent verification of RuneScape gameplay facts. See
[reference-output-comparison.md](reference-output-comparison.md).

October 7 rules follow-up: roll candidates and already-unlocked exclusions now use each player’s own map, including random-start counts and manual-neighbor marking; own obligation access and connected partner capability remain independent. Partner-owned candidates and pending offers remain valid, and accepting a choice records personal ownership. Predictions continue to simulate personal unlocks.

Nested skill-output paths now compose probabilities for rarity and primary classification, retain evidence and agree with collection traversal. Bare cutoff amounts consistently mean 1/X, including decimals; explicit fractions mean probabilities. Boss retains the original item-source contract: disabling classified boss drops does not prohibit combat training, Kill X Boss goals or boss collection logs. Synthetic evaluator and isolated DOM regressions verify these changes; live duo gameplay has not been exercised for this follow-up.

October 7 confirmed duo follow-up: own reachable sources define all obligation views, collections, BiS and task predictions. Connected partner sources support feasibility and training with explanations. One capability fixed point carries own provenance; saved personal progress is preserved. Directed walking, personal teleports and reached lodestones require independent outbound/return evidence. Synthetic pure, worker/API and isolated DOM regressions cover the split and map tabs; no live duo gameplay or deployment was performed. The lodestone activation assumption and retained projection limits are documented in [access-logic.md](access-logic.md).

The final `npm test` run for this follow-up passed 428 tests with zero failures, cancellations or skips on Node v24.19.0 (30.1 seconds). Server regressions use isolated temporary stores and ephemeral ports; the picker instance was not started.

Unpick now returns the forfeited chunk to selected. Pick for me uses existing sampling on the current pending offer, validates before RNG/mutation, clears the offer and follows the same loser-reselection/selection-clearing policy as choosing one. Imported single-choice offers complete atomically; generated Roll 2 still refuses fewer than two candidates. Both actions retain exact undo and random-start section seeding, without the original orphaned-potential defects.

October 8 source refresh: the [switchover review](research/switchover-parity-2026-10-08.md) distinguishes delivered features, captured task differences and rule-semantic limits. For its 35 enabled rule IDs, source-reviewed metadata is 12 implemented-scope, 15 category-gate, 5 partial and 3 retained-only; these are coverage labels, not passing original workflows. Energy/loadout optimization is an additional planning limit, with no equivalent original optimizer established.

## Evidence discipline and remaining limits

[Access and adjacency](access-logic.md) documents roll filters, personal teleport declarations, manual selection exceptions and the verified Edgeville source correction. A recorded F2P chunk or reachable named interior does not prove every subarea is free; the retained topology and missing membership metadata still require independent verification.

The reference runs only in an isolated offline VM. The authored app never loads the retained
frontend or writes to the original Firebase service. Evidence must identify whether it came from a
synthetic fixture, the dated public map capture, the offline worker, a browser session, or private
production use.

The baseline task compiler reported **34 unsupported records per evaluated member** for hard
requirements it cannot safely interpret. That count is a dated compiler result, not a count of every
remaining parity gap; those records fail closed and remain inspectable. The combat equipment view has
no target-specific DPS model. Combat set effects, the remaining unverified equipment weights, coupled weight layouts,
some generated sources, discretionary XP allocation and specialist processing modes remain outside
complete parity. Default Chunk Info uses raw and derived accordions; location associations do not prove
that a task is doable at that location, because overall reachability may use another source. Newly
added task popups cover selected active goals rather than all newly possible methods.

The final follow-up run passed **326 tests with zero failures**, including retained declaration
equivalence, collection worker/server registration and prediction, exact undo, personal controls and
derived chunk-information guards. Isolated browser checks exercised all scalar settings/themes,
marker/sticker changes without unlocking, manual level saves, specialist tabs, both derived defaults
and personal Every Drop source choices. These checks do not establish personal gameplay facts,
second-device readiness or a complete original-window visual match. See [settings-audit.md](settings-audit.md).

The first private import snapshot was captured October 7, 2026: QXA had 136 unlocked and 13 selected
records; QXB had 113 unlocked and 20 selected records. These are dated migration inputs, not live
account truth.
