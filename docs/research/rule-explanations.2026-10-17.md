# Rule explanations — 17 October 2026

182 independently authored explanations cover 148 normal rules and 34 Advanced compatibility rules. The inventory includes 171 declared controls and 11 old names retained in the copied save.

## Storage and source tracing

- New copy: `checks/private-source/app/data/rule-explanations.2026-10-17.v1.json`. The list itself belongs to the private dataset, so neither its identities nor these explanations are bundled into the public core.
- Visible old descriptions and original More tooltips: `app/data/original-rules-ui.2026-10-08.v1.json`, section row `descriptionText`/`descriptionHtml` and `tooltips[].descriptionHtml`.
- Current definition descriptions and shared labels: `legacy-rules-text-values.2026-10-13.v1.json`, especially taskRuleDefinitions:presentation, authoredTaskRules:presentation and app/core/rules.mjs#rulePresentation.
- Public `settings.mjs`, `rules-model.mjs` and `rules-panel.mjs` load/render those private inputs. `rule-defaults.mjs` owns Automatic values, not the original prose.
- The captured catalogue now points to the new file. The private dataset input allowlist and pack builder carry it through the existing rules-text pack and digest-checked dataset JSON route. No installed packs, companion receipts, changelog or roadmap were changed.

## Behavior mismatches

These are documentation findings, not engine changes. Compatibility switches that do nothing are identified explicitly in their visible explanation. Each finding below cites the inspected callsites or private records.

- **Pouch**: Declared saved rule has no app consumer and no matching Category-tagged task. It does not generate essence-pouch goals. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/app/data/legacy-dataset-values.2026-10-13.v1.json:709`, `app/tasks/engine.mjs:404`.
- **InsidePOH**: Despite the house-wide name, the implemented gate only blocks InsidePOH Primary workbench tasks above level 1; it is not a blanket ban on all house content. Evidence: `app/tasks/engine.mjs:405`, `app/tasks/engine.mjs:860`.
- **Normal Farming**: This switch changes primary-training qualification, not general eligibility of every ordinary crop task. Farming products can remain available. Evidence: `app/tasks/engine.mjs:404`, `app/tasks/engine.mjs:992`, `app/tasks/activity.mjs:36`.
- **Shortcut**: This switch changes shortcut primary-training qualification; Shortcut Task separately controls active goal display. Evidence: `app/tasks/engine.mjs:992`, `app/tasks/presentation.mjs:187`.
- **Puro-Puro**: Enabled permits automatic area access; false blocks it. The retained behavior note saying the rule blocks automatic access is directionally misleading. Evidence: `app/tasks/access.mjs:387`.
- **Wield Crafted Items Override**: This compatibility toggle has no exact implementation and cannot override crafted-equipment admission. Evidence: `app/tasks/engine.mjs:1277`, `app/tasks/engine.mjs:725`.
- **Bakami**: All eight retained bakami catches use Categories instead of Category. The engine explicitly excludes records carrying Categories, so enabling Bakami cannot activate them. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/rs3-chunkpicker-chunkinfo-export.json:46050`, `app/tasks/engine.mjs:400`.
- **Secondary Primary**: The boolean admits methods explicitly tagged Secondary Primary. It does not change the separate probability cutoff or automatically bypass non-primary ingredient checks. Evidence: `app/tasks/engine.mjs:990`, `app/tasks/engine.mjs:993`, `app/tasks/rates.mjs:37`.
- **Secondary Primary Amount**: The primary-supply cutoff is configurable and is not fixed at 1/16. Source equality is controlled separately and defaults inclusive. Evidence: `app/tasks/rates.mjs:37`, `app/tasks/rates.mjs:41`.
- **Dungeoneering Journals**: The saved rule has no engine consumer or matching journal-task category. It currently adds no journal collection goals. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/app/data/legacy-dataset-values.2026-10-13.v1.json:100`, `app/tasks/engine.mjs:404`.
- **Manually Complete Tasks**: The saved switch has no engine or presentation consumer. Normal task completion controls are independent of it. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/app/data/legacy-dataset-values.2026-10-13.v1.json:107`, `app/tasks/presentation.mjs:136`.
- **HigherLander**: The saved switch has no engine or presentation consumer and no matching task category. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/app/data/legacy-dataset-values.2026-10-13.v1.json:109`, `app/tasks/engine.mjs:404`.
- **Secondary MTA**: The compatibility rule is declared unsupported; it does not relax Mage Training Arena rune-source requirements. Evidence: `app/tasks/engine.mjs:1277`.
- **Prayers**: The retained task category contains only the Smite use task; it does not generate a complete prayer-use checklist. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/rs3-chunkpicker-chunkinfo-export.json:55800`, `app/tasks/engine.mjs:404`.
- **All Droptables Nest**: The generator requires a matching Bird nest (...) loot task, but the retained task data has none, so the rule adds no goals. Evidence: `app/tasks/collection.mjs:190`, `app/tasks/collection.mjs:218`, `app/tasks/collection.mjs:335`.
- **Skiller**: Support is partial. Monster-drop sources, kill goals and Not Skiller tasks are excluded, but the engine explicitly reports that this is not an exact implementation. Evidence: `app/tasks/access.mjs:844`, `app/tasks/collection.mjs:307`, `app/tasks/engine.mjs:403`, `app/tasks/engine.mjs:1277`.
- **Quest Skill Reqs**: The saved switch has no independent consumer or matching category. Ordinary skill and quest dependency checks still apply. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/app/data/legacy-dataset-values.2026-10-13.v1.json:120`, `app/tasks/engine.mjs:859`.
- **Permanent Unlockables**: The switch gates declared Extra unlock goals, including rope racks and Innate Mastery. Separate Construction rope-rack recipes lack the category and remain eligible; declared enchantment item access is not proof that the enchantment was applied. Evidence: `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/rs3-chunkpicker-chunkinfo-export.json:11123`, `C:/Users/User/Projects/chunk-picker-rs3-private/checks/private-source/rs3-chunkpicker-chunkinfo-export.json:155382`, `app/tasks/engine.mjs:404`, `app/tasks/equipment.mjs:52`.
- **Not Daily DnD**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Costume Room**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Multiple Pickpockets**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **PvM Relics**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **KeyItem Bosses**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Misc Combat Achievements**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Hunter Marks Slayer**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Fill Costume Room**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Collection Log Bosses**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Collection Log Raids**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Collection Log Clues**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Collection Log Minigames**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Collection Log Other**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Stuffables**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Fill POH**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Primary Spawn**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Additional Money Unlockables**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Boss Level**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Cleaning herbs**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **DnD Skilling**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Forestry**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Full Healing**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Jars**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Kili Knowledge**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Partial Products**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **PvP Minigame**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **Superheat Furnace**: No exact supported authored behavior or matching task Category tag for this saved key; explanation explicitly states that it adds no task. Names are case-sensitive. Evidence: `app/tasks/engine.mjs:861`, `app/data/settings.mjs:134`.
- **PortSkills**: Twelve separate non-primary skill goals at level 90, one per port adventurer skill; this does not stop after the first port-qualifying skill. Evidence: `app/tasks/engine.mjs:861`, `app/tasks/presentation.mjs:283`.
- **F2P**: The visible F2P task-rule control writes shared content.f2p for both players. The legacy saved task-rule F2P value alone is overwritten during evaluation. Evidence: `app/web/rules-model.mjs:58`, `app/web/rules-panel.mjs:158`, `app/tasks/engine.mjs:386`.
- **tasks.cache-skill-guide**: All four reviewed generated tasks are informational milestones; the main guide switch alone with milestones disabled generates no tasks. Evidence: `app/tasks/engine.mjs:159`, `app/data/skill-guides.mjs:36`, `app/data/skill-guides.mjs:49`.
- **Hard Mode Bosses**: Exact authored effect is a task-category gate, not a universal boss-drop-source switch. Evidence: `app/tasks/engine.mjs:861`, `app/tasks/collection.mjs:305`.
- **Abilities**: Six listed ability-use skill rows carry Abilities; unlock collection rows use Unlock Abilities. Evidence: `app/tasks/engine.mjs:861`.
- **Combat Mastery achievements**: Some Combat achievements family rows also carry Combat Mastery achievements, so the tag excludes more than its similarly named family. Evidence: `app/tasks/engine.mjs:861`, `app/tasks/achievements.mjs:29`.
- **No RuneScore**: The engine gates exact Category tags; it does not dynamically classify every zero-score achievement. Evidence: `app/tasks/engine.mjs:861`.
- **Cleaning Herbs**: This controls display above level one; underlying recipes and outputs remain available. Evidence: `app/tasks/presentation.mjs:193`, `app/tasks/engine.mjs:861`.
- **Hide Partial Products**: This suppresses active display for tagged Partial skill rows above level one, without blocking recipe availability or source production. Evidence: `app/tasks/presentation.mjs:184`, `app/tasks/engine.mjs:1058`.
- **Rare Drop**: Turning this on admits all recorded rates; the configurable cutoff applies when it is off. The name alone does not explain that direction. Evidence: `app/tasks/access.mjs:761`, `app/tasks/engine.mjs:1001`.
- **Highest Level**: Controls which shared-ingredient recipes initially supply products. It is not simply a sort direction for the displayed skill list, and some special task links remain unsupported. Evidence: `app/tasks/processing.mjs:132`, `app/tasks/engine.mjs:1284`.
- **Boosting**: Fixed and percentage boosts are supported, but XP-based boost formulas are not. Reachable-level availability can differ from the requirement displayed for the target level. Evidence: `app/tasks/engine.mjs:814`, `app/tasks/presentation.mjs:156`.
- **BIS Skilling**: Ranks recorded equipment sets and priorities and keeps separate convenience upgrades. It does not compute one universal ranking of every skilling item. Evidence: `app/tasks/equipment.mjs:44`, `app/tasks/presentation.mjs:201`.
- **BIS Skilling Relics**: Shows listed relic goals, with incomplete interactions with skilling equipment. It does not select a best simultaneous relic setup or allocate monolith energy. Evidence: `app/tasks/equipment.mjs:52`.
- **Show Best in Slot Weight Tasks**: Compares usable recorded worn weights by ordinary equipment slot. Missing or ambiguous weights and coupled hand loadouts remain outside that comparison. Evidence: `app/tasks/equipment.mjs:430`, `app/tasks/equipment.mjs:438`.

## Factual correction

Golden Touch uses 2,000 vital sparks at the cited Wiki revisions, not about 3,000. The explanation does not assert a 200M Thieving XP requirement because that figure was not established by the reviewed sources.

## Validation

Core commit: `f47d520` on `ruleexplain`; no push. The public worktree is clean.

- Final schema: 182 entries; 148 normal plus 34 Advanced; 35 optional grind warnings; 143 distinct pinned Wiki revisions. What/example/warning limits are 340/280/200 characters, and What is limited to two sentences. Coverage includes the 11 saved compatibility names.
- Focused UI/schema: 41 passed, none failed. Pack round-trip fixtures also passed and assert that the new JSON belongs only in the rules-text pack.
- Public quick suite: 1,215 passed, 2 skipped, none failed (1,217 total).
- Public full suite, one run under the shared heavy lock: 2,473 passed, 2 skipped, none failed (2,475 total). The full run was required by the one-line server static-module allowlist entry; storage, engine and worker implementation are unchanged.
- Final private quick lane: 1,556 passed, 1 skipped, none failed (1,557 total).
- Public leak scanner: clean across all 679 public files, with the private identity corpus and reviewed baseline exceptions. An editorial eight-word-overlap comparison against retained descriptions/tooltips found zero overlaps.
- Final light-locked browser check used the real copied save with fresh scratch credentials. Port skills, ground-item spawns and permanent unlocks passed at 1440 and 390 px. Phone Rules search was also checked. No horizontal overflow or page-script errors. All seven screenshots were visually inspected across the two bounded inspection rounds.
- The server and browser were stopped. The copied save, copied private application, temporary private corpus and authoring scripts were deleted. Screenshots and verification logs remain under the worktree’s ignored `local` artifact area (named `.local` on disk).

Screenshots: `C:/Users/User/Projects/chunk-picker-rs3-core-wt/ruleexplain/.local/rule-explanation-screenshots/` contains `1440-ports.png`, `390-ports.png`, `1440-spawns.png`, `390-spawns.png`, `1440-permanent.png`, `390-permanent.png`, `390-rules-search.png`, and machine-readable `checks.json`.

The companion’s installed files, immutable packs, receipt, changelog and roadmap were not changed. The updated private source must be included in the next companion/rules-text pack build for the installed picker to show this copy.

## Ten samples

These are independently authored examples. The complete catalogue contains all 182 entries with per-entry revision links.

### Permanent unlocks

What it does: Adds goals for one-time upgrades that stay unlocked, such as building a rope rack or applying Innate Mastery to a weapon. Turning it off does not remove the separate rope-rack Construction goals.

Example: Building the Eagles’ Peak rope rack can become an unlock goal when its location and materials are reachable; the parallel Construction task is separate.

Grind warning: Innate Mastery uses a Shard of Genesis Essence, a hard-mode boss reward; these goals can take much longer than building a rope rack.

Sources: [Rope rack](https://runescape.wiki/w/Rope_rack?oldid=37170463), [Shard of Genesis Essence](https://runescape.wiki/w/Shard_of_Genesis_Essence?oldid=37206030).

### Travel using synced levels and quests

What it does: Checks travel using your recorded quest completions and skill levels imported by Sync levels. Missing levels can be estimated from training you can reach; runes, fares and route access still matter.

Example: A synced Magic level meeting Varrock Teleport, with its runes and required spellbook available, can add that destination without manually entering the level again.

Sources: [Varrock Teleport](https://runescape.wiki/w/Varrock_Teleport?oldid=37182128).

### Ground-item spawns

What it does: Treats ground-item spawns as a reliable enough ingredient supply to require skill training. It also lets spawned consumable gear compete in equipment goals; turning this off leaves the items obtainable.

Example: If white berries north of the Tirannwn lodestone are your only berry source, turning this off can remove the super defence training goal.

Sources: [White berries](https://runescape.wiki/w/White_berries?oldid=37134792), [Super defence](https://runescape.wiki/w/Super_defence?oldid=37021667).

### Secondary-source cutoff

What it does: Sets how common an ingredient drop must be before it can justify required training or consumable equipment goals. Enter a denominator or probability; zero accepts all known rates, and the inclusive switch decides whether equality passes.

Example: With a 1/16 cutoff, a super defence training goal needs its dropped white berries to pass that probability test; equality follows the inclusive switch.

Sources: [Super defence](https://runescape.wiki/w/Super_defence?oldid=37021667), [White berries](https://runescape.wiki/w/White_berries?oldid=37134792).

### Port skills

What it does: Allows a level-90 adventurer-unlock goal for each of the twelve listed port skills you can train. It does not stop after the first skill that lets you run voyages.

Example: Unlocking the Tengu through Agility 90 can remain a goal even after another skill already permits port voyages.

Grind warning: This can require several separate skills at 90 rather than a single port-entry skill.

Sources: [Player-owned port](https://runescape.wiki/w/Player-owned_port?oldid=37203306).

### Golden Touch and other former-sigil abilities

What it does: Allows the listed former-sigil ability unlock goals alongside Unlock Abilities. Each unlock permanently adds an ability, while its item and skill requirements still apply.

Example: Unlocking Golden Touch can become a goal when its codex is obtainable and Magic 55 is reachable.

Grind warning: Golden Touch needs 2,000 vital sparks. Collecting them through rare pickpocket rewards can take a long time.

Sources: [Golden Touch](https://runescape.wiki/w/Golden_Touch?oldid=37141927), [Golden Touch ability codex](https://runescape.wiki/w/Golden_Touch_ability_codex?oldid=36906326), [Menaphos market guard](https://runescape.wiki/w/Menaphos_market_guard?oldid=37202160).

### Rare drops

What it does: Allows item sources at every recorded drop rate. Turning it off removes sources that fail your rare-drop cutoff; another eligible source can keep the item available.

Example: An “obtain a goblin champion’s scroll” goal can appear with this on; a restrictive cutoff can remove it when no other eligible source exists.

Grind warning: Including very rare sources can create long, chance-based collection or equipment grinds.

Sources: [Goblin Champion's scroll](https://runescape.wiki/w/Goblin_Champion's_scroll?oldid=37014699).

### Time-gated activities

What it does: Allows listed tasks with daily, weekly, monthly or other time restrictions. The picker checks declared requirements but does not wait out their real-world timers.

Example: Constructing a monthly God Statue can become a Construction method when its Distraction and Diversion rule and location also allow it.

Grind warning: Enabling this can require waiting for an activity reset or limited availability.

Sources: [God Statues](https://runescape.wiki/w/God_Statues?oldid=37193709).

### Skiller restrictions

What it does: Excludes monster-drop item sources, kill-count goals and tasks marked unsuitable for skillers. This is partial support; it does not implement every restriction of a combat-free account.

Example: Turning this on removes chicken kill-count goals and chicken-drop sources such as feathers.

Sources: [Chicken](https://runescape.wiki/w/Chicken?oldid=37142047), [Feather](https://runescape.wiki/w/Feather?oldid=37112201).

### Automatic (the control)

What it does: Removes your personal override, then uses a shared or imported value, or the picker default if neither exists. The displayed Automatic value shows the result; it does not choose a difficulty or decide rules for you.

Example: If you saved Boosting On while Automatic shows Off, Use automatic removes your On choice and returns the setting to Off.

Evidence: `app/web/rules-model.mjs:87`, `app/web/rules-model.mjs:95`, `app/web/rules-review.mjs:75`.
