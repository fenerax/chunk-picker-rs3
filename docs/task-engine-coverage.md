# Authored task eligibility engine

`app/tasks/engine.mjs` compiles all **20,375** records from the retained RS3 reference JSON. It does not import, execute, or require the upstream picker scripts. The retained scripts were inspected as behavior references. Compilation creates category-qualified, NFC-normalized task IDs and preserves exact raw labels, including literal trailing stars, for dependency lookup.

`createTaskEngine(definitions)` returns a catalogue and `evaluate(state, memberId)`. Evaluation returns every declared task, its eligibility status and explanation, source records, reachable locations, item acquisition paths, training ceilings, possible quest points and XP, equipment candidates, diagnostics and timing counters. Inputs are not changed. Task rows contain `hidden` and `hiddenReasons`; presentation should filter these separately from eligibility.

## Implemented constraints

| Constraint | Behavior |
| --- | --- |
| Geography | Uses the separate authored access engine for personal/shared ownership, subsection topology, interior entrances, task-gated connections and personal overrides. Selected roll candidates never grant access. Effective manual area blocks also prevent the area's unlock task from becoming available merely because an entrance is reachable. |
| Requirement lists | `Chunks`, `Items`, `Objects`, `NPCs`, `Monsters`, `Shops` and `Mix` lists require all listed components. A recognized `[+]` group supplies alternatives; `[+]xN` requires N distinct matching alternatives. |
| Task dependencies | Exact category-qualified references, alternative groups and counted task groups. Unsourced cycles do not create their own validity or items. Self-links annotating an alternative production route do not invent an external prerequisite. |
| Skill requirements | `Level`, `Skills`, `SkillsNeeded` and `Requirements` use reachable training ceilings and personal passive-level evidence. A reachable level-one primary method, or a primary method reachable from a saved passive level or fixed quest XP, unlocks further training. Smithing requires an anvil unless smelting training is allowed. |
| Combat training | Reachable monsters permit ordinary melee/Constitution training. Ranged additionally checks an available weapon/ammunition route. Prayer can use available bone/ash inputs. |
| Membership | Activity `Not F2P` flags remain separate from skill caps. Archaeology, Construction and Necromancy have F2P ceilings of 20; other members skills have ceilings of 5. Free skills retain their real caps. Combat is a progression aggregate, not a members trial skill. This repairs the reference's overlapping 5/20 checks, misspelled Necromancy case and erroneous five-level cap on Combat. |
| Primary sources | Starred item requirements retain secondary-source information. Spawn/rare-drop thresholds and optional primary rules affect training eligibility. `Normal Farming`, `Shortcut`, `InsidePOH Primary`, `Token` and `Cleaning Herbs Primary` can demote a method without removing its declared eligibility. |
| Workbench tasks | `InsidePOH=false` blocks tasks tagged `InsidePOH Primary` above level 1, including their outputs and dependency evidence. `InsidePOH Primary` independently controls primary Construction training contribution. |
| Outputs | A fixed point discovers concrete task outputs, skill-item loot tables, fixed rewards and output objects. Plain and applicable source-specific item gates apply to produced items, and delayed gates are revisited. |
| Processing sources | Selects the union of recipes per usable consumable input, then applies the skill frontier and exact promotion prerequisites before replaying outputs. Highest Level changes the input selection. Excluded producers remain searchable but cannot prove downstream supplies, training, boosts, equipment, XP or access. Multi Step outputs carry conditional source evidence; independent supplies remain usable. Own-item queries require admitted output proof. |
| Sources | Keeps alternate valid acquisition paths, including separate category-qualified task IDs and source locations when names match. `NonShop`, `AllowedSources` and declared source-kind requirements restrict paths. Backlogged source names and items are excluded; generated objects cannot restore a backlogged object. Uses the access engine's resolved personal source mask, so an explicit authored false override can unblock a migrated legacy backlog. |
| Saved personal evidence | Uses decoded `passiveSkill`, `maxSkill`, `slayerLocked`, explicit manual item/equipment declarations and true `manualPrimary` overrides. False `manualPrimary` values mean no forced override. |
| Quest XP | Fixed XP and explicit saved XP allocations count only after their source task becomes reachable. `None` allocations do not grant XP to a skill. The result describes possible progression, not actual quest completion. |
| Completion | Personal `completedTasks` are kept distinct from imported challenge checkmarks. Any/all/personal group satisfaction is reported without granting one member another character's personal skill level or quest completion. |
| Presentation rules | Skill and quest toggles hide rows without deleting source eligibility. Show Diary Tasks currently hides all Diary rows while preserving dependency eligibility; original Achievement display and Show Diary Tasks Any relaxation are unsupported. BIS Skilling similarly hides tagged Extra goals without the original category eligibility gate. Whole-quest presentation hides intermediate steps; completion still requires its declared prerequisites. |
| Extra task sets | Among reachable tasks in a declared `Set`, only the best numeric priority remains available for presentation; lower priorities explain which reachable task outclasses them. Internal source proofs remain available to dependent tasks. |
| Equipment | Returns obtainable, level-eligible candidates using declared tier, armour, damage, accuracy and prayer values. `Wield Crafted Items=false` excludes solely crafted processing sources while allowing a separate drop/shop/manual-equipment path. |

The adapter makes narrowly defined repairs to malformed reference metadata: known field misspellings, skill-name casing, integer strings, case-only aliases, numeric skill requirements misplaced under `Tasks`, and existing exact task requirements misplaced at the record root. It preserves their constraints. It does not guess missing aliases or redirect broken references to unrelated categories.

## Remaining boundaries

This is not a claim of complete parity with every upstream calculation. The [October 8 switchover review](research/switchover-parity-2026-10-08.md) separates source-reviewed behavior from captured output differences. RuneMetrics review/apply and the Training plan UI/API are delivered bounded consumers, not proof of every progression calculation. The following work remains:

- Bespoke required-highest task links, unusual generated source expansion and unverified interactions of the legacy `Multi Step Processing` setting. Generic input selection, frontier promotion and source publication are covered by the [processing follow-up](research/switchover-processing-parity-2026-10-08.md).
- Exact upstream BiS scoring and crafted-item override rules. The equipment pipeline compares ordinary coupled weapon/shield/ammunition loadouts, armour/life points and explicit Set/Priority metadata; set effects and coupled weight ranking remain outside scope. Verified ordinary-slot weights cover 3,019/3,550 retained rows.
- Dynamically appended tasks and special generated sources, including skill pets, bespoke minigame/collection sources, and Invention breakthrough progression.
- Every bespoke staff/ammunition substitution and discretionary XP-reward choice workflow. Fixed allocations and declared aliases are supported. Boosting consumes numeric/percentage sources and Crystal saw, but XP formulas are unsupported and eligibility/presentation use different percentage adjustments.
- Bakami's special `Categories` prerequisites, source-specific `OutputVar` handling, and broken/missing reference aliases or task references.

Unknown hard requirement metadata, missing aliases and unresolved direct task references produce `unsupported` rows with reasons. Recognized but unavailable sources produce blocked rows. Optional unsupported rule modes receive diagnostics. `coverage.supportedTasks` means the declared requirements were understood for the current evaluation; it does not certify the special behavior above. Exact counts can change when upstream definitions or the saved profile changes.

The [October 13 H4 audit](research/retained-unsupported-tasks-2026-10-13.md) inventories all 34 retained unsupported records, repairs 18 with exact evidence and leaves 16 members-only records excluded. It restores the F2P cosmetic runecrafter robe goal and preserves fail-closed behavior even for imported completion marks. The [H5 chain review](research/crafting-chains-2026-10-13.md) prevents conditional ingredients from becoming ordinary supplies through an independent second ingredient, and keeps Hide Partial Products separate from intermediate source availability.

## Verification

The [October 8 processing follow-up](research/switchover-processing-parity-2026-10-08.md) records current copied-save comparisons and regression checks. The older fixture counts and timings below predate staged source admission.

`node --test tests/tasks.test.mjs` passes **25 tests**. The fixtures cover AND/OR/counted aliases, exact starred labels, typed IDs and typed acquisition paths, fixed-point outputs and cycles, personal-versus-group completion, membership/trial caps and the Combat aggregate, unknown hard gates, quest XP, saved levels and maximums, manual items/equipment, migrated source unblocking, manually blocked interiors, source backlogs, optional primary modes, crafted-equipment paths, delayed output gates, Extra task priorities and all-reference compilation. The all-reference performance test uses synthetic geography and has no dependency on Player 1's private cache.

An additional read-only benchmark loaded the October 6 public QXA/QXB capture from `personal assistant/out/rs3-chunk-picker-audit-2026-10-06/evidence/public-map-fixtures.json`, imported explicit ownership, and ran the authored gameplay migration before evaluation. QXA had 136 unlocked bases and QXB 113. The final access correction produced these eligibility counts, with 34 unsupported rows per member:

| Member | Personal access | Shared access | Uncached personal/shared time |
| --- | ---: | ---: | ---: |
| Player 1 / QXA | 1,183 | 1,384 | 972 / 1,005 ms |
| Player 2 / QXB | 1,362 | 1,429 | 797 / 783 ms |

These counts include underlying source and intermediate tasks; they are not the shorter presented goal list or evidence of in-game completion.

On this Windows host with Node 24, compilation took about 365 ms. Evaluation took six fixed-point passes per member; the all-reference synthetic test was about one second. These timings vary with host load. The server should cache an evaluation until eligibility-affecting state changes, rather than recalculate it for every render or search keystroke.

An offline VM harness subsequently executed the retained original worker against the captured QXA personal-access payload and retained its output under `out/reference-comparison`. The VM allowed no network primitives and blocked its CDN `importScripts` request. That run took 12.657 seconds. It selected four ordinary skill goals: corrupt dragon weapon, corrupt dragon armour, infernal yew incense sticks and Falador's crumbling wall. All four are eligible in the authored engine. This verifies eligibility for those goals; exact frontier presentation is implemented separately.

The targeted differential also identified authored access errors around unsuffixed interior entrances and shared teleport destinations. Those are corrected in the separate access engine, with regressions. After saved challenge suppression, the original QXA Quest/Diary/Extra result is empty and the authored result has seven rows. Their causes are classified below:

| Authored-only goal | Exact original evidence | Intentional authored correction |
| --- | --- | --- |
| Damage Without Consequences; Poltergeist Pen Pal | `nonValids` reports `F2P` for Necromancy requirements 13 and 20. | Uses the Necromancy trial ceiling of 20. |
| Command Skeleton Warrior ability | `nonValids` reports `F2P` for Necromancy 20. | Uses the Necromancy trial ceiling of 20. |
| Steel mattock | `nonValids` reports `F2P` for Archaeology 20. | Uses the Archaeology trial ceiling of 20. |
| Breaking the Seal; Prison Break mystery completions | Both depend on the Barracks entrance. Its prerequisite `Clear the fort debris outside Kharid-et`, Archaeology 12, has exact `nonValids=["F2P"]`; the original Barracks is absent. | Uses the Archaeology trial ceiling of 20, which makes the declared entrance, loot table and mystery chains reachable. |
| Altar of War furniture plans | The plan item is missing in the original result. Its War's Retreat prerequisite, Combat 60, has exact `nonValids=["F2P"]`; Combat is omitted from the original free-skill list. | Does not classify the Combat progression aggregate as a five-level members trial skill. The declared retreat/shop chain becomes reachable. |

The final targeted offline VM capture took 11.071 seconds and retained these prerequisite blockers. This classifies the differences against captured reference behavior and declared metadata; it does not verify their execution in game. The reference baseline covers QXA personal access only; QXB and shared-access results have no equivalent original-worker capture. Exact frontier selection and generated BiS presentation are verified by their separate integration lanes.
