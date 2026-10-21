# Proposed F2P finish line

Reviewed 2026-10-13 against this application's retained and corrected catalogue.
The default is an editable **draft**, not the duo's agreed membership condition.
It covers personally completed whole F2P quests and miniquests, practical skill
milestones, a durable equipment set for each combat style, and five notable
achievement objectives. It does not mean every F2P activity, RuneScore point,
cosmetic, pet, rare drop or level 99 has been completed.

`app/web/finish-line-model.mjs` reads the saved personal facts and already loaded
results. It reuses the Profile observation boundary, Helper skills/trial caps,
permanent identities and member fact projection. It never runs a task engine,
fetches an account or changes progress, chunks, rules or membership. Current
geography can make a goal inaccessible without removing it from this finish line.

## Quests and personal completion

The denominator comes from `definitions.challenges.Quest`, supplemented by
retained saved/current task records. Whole rows have `QuestPoints` and a whole
quest/miniquest/subquest completion label; unformatted whole records use the same
fallback as Profile. Members rows, quest steps and Archaeology mysteries are
excluded. Zero-point miniquests count: this follows the catalogue rather than
substituting quest points for a quest checklist. New whole F2P catalogue entries
join the draft automatically; stable `quest:<permanent task ID>` overrides survive
label changes. The baseline remains F2P even after the content rule changes.

Completion requires the player's own projected `completedTasks` or a
`questProgress` observation bound to her/his currently named RuneScape account.
A partner's completion, an engine `challengeSatisfied` flag and a quest challenge
tick cannot assert personal whole-quest completion. Missing evidence is labelled
unknown, rather than assuming the quest has or has not been completed in game.
The current sync record does not say whether the user applied the quest part of
a snapshot, so it cannot prove a negative quest observation.

Catalogue and observation boundaries are documented in [Profile](../profile.md),
[RuneMetrics](../runemetrics.md), [quest metadata evidence](cache-game-data.md)
and the [membership audit](membership-verification-2026-10-12.md). The model
expects the application's corrected definitions; it does not attempt a new
membership audit against the uncorrected upstream export at runtime.

## Skill targets

All 28 Helper skills are included. Invention is absent because it cannot be
trained in F2P. Observed levels may exceed these proposed stopping points. Skill
targets can be lowered or raised through 120, except that trial targets cannot
exceed the existing Helper cap.

| Skill | Default | Reason and evidence |
| --- | ---: | --- |
| Attack | 55 | Wield the repairable tier-55 Gravite melee weapons declared by the equipment catalogue. |
| Strength | 50 | A proposed combat readiness floor for late F2P encounters, not a claimed quest or equipment requirement. |
| Defence | 55 | Equip Gud raider chainbody; also covers rune +3, blue dragonhide and mystic armour. |
| Constitution | 50 | A proposed survivability floor, not a claimed quest or equipment requirement. |
| Ranged | 70 | Retained yew bow requirement; compatible F2P rune arrows cap damage while the bow retains its accuracy tier. |
| Prayer | 45 | Mystic Might for Hard Lumbridge's **Gods, Give Me Strength**. |
| Magic | 59 | Fire Blast for **Blast and Hellfire**; exceeds the Gravite weapon requirement of 55. |
| Runecrafting | 57 | **Not Waving But Drowning** requires crafting at least 100 water runes at once. |
| Crafting | 70 | Diamond amulet crafting for amulet of power; also covers blue dragonhide and Hard Lumbridge crafting. |
| Mining | 50 | Runite mining for the retained rune equipment/tool milestone. |
| Smithing | 50 | Rune bars and rune equipment, including +3 upgrades. Tier 53 is an item statistic, not a requirement for Smithing 53. |
| Fishing | 50 | Catch swordfish. |
| Cooking | 50 | Hard Lumbridge chocolate cake; swordfish cooking already unlocks at 45. |
| Firemaking | 60 | Burn a yew log for **Are Yew As Fired Up As I Am?** |
| Woodcutting | 70 | Cut yews yourself. The diary action does not itself require Woodcutting 70 when another group member supplies the log. |
| Fletching | 55 | Acadia longbow; the shortbow and acadia wood box unlock at 50. |
| Dungeoneering | 50 | A proposed rounded stopping point beyond the level-35 Gravite gate; sufficient tokens must still be earned. This is not a claim that level 50 exhausts F2P Dungeoneering. |

Agility, Herblore, Thieving, Farming, Hunter, Slayer, Divination and Summoning
default to their existing cap of **5**. Construction, Archaeology and Necromancy
default to **20**. These values are imported from `helperTrialCaps`, rather than
derived from current training ceilings or copied into a second rules system.

The level/action rows above are in the retained `challenges`, `equipment` and
reviewed [skill guide catalogue](skill-guides.md). Lumbridge requirements are
the explicit `Skills` maps in its seven Hard tasks. The [training catalogue](training-helper.md)
and [recent equipment corrections](cache-equipment-corrections.md) provide
related data provenance. A bounded Wiki check also confirmed that
[rune chainbody +3](https://runescape.wiki/w/Rune_chainbody_%2B_3) is made at
Smithing 50. Strength, Constitution and the rounded Dungeoneering target are
deliberate proposal choices; the UI explains this instead of presenting them as
researched hard unlocks.

## Durable equipment target

There is one checklist item per combat style, with the slot targets underneath.
Repairable Gravite weapons remain eligible. Temporary corrupt dragon weapons,
legacy event gear, account-age veteran capes and unverified new catalogue entries
do not set the default. In particular, the raw catalogue's havensilver rows lack
sufficient reviewed F2P obtainability evidence to replace the established durable
melee target. This is a documented coverage limit, not a claim that the raw
equipment table alone proves every item's F2P acquisition route.

| Slot | Melee | Ranged | Magic | Necromancy trial |
| --- | --- | --- | --- | --- |
| Head | Rune full/med helm +3 | Blue dragonhide coif | Mystic hat | Deathwarden hood T10 |
| Body | Gud raider chainbody | Blue dragonhide body | Mystic robe top | Deathwarden robe top T10 |
| Legs | Rune platelegs/plateskirt +3 | Blue dragonhide chaps | Mystic robe bottom | Deathwarden robe bottom T10 |
| Hands | Rune gauntlets +3 | Blue dragonhide vambraces | Mystic gloves | Deathwarden gloves T10 |
| Feet | Rune armoured boots +3 | Blue dragonhide boots | Mystic boots | Deathwarden boots T10 |
| Neck | Brawler's hook necklace | Farsight snap shot necklace | Arcane blast necklace | Amulet of power |
| Cape | Bladestorm drape | Arrowstorm drape | Spellstorm drape | Deathstorm drape |
| Ring | Explorer's ring 4 | Explorer's ring 4 | Explorer's ring 4 | Explorer's ring 4 |
| Weapons | Gravite 2h sword | Yew shortbow/longbow **with rune arrows** | Gravite staff **or** Gravite wand + orb | Death guard + skull lantern T10 |

The ranged bow uses the existing picker's coupled weapon/ammunition interpretation,
not a new DPS calculation. The Magic tied alternatives require an entire setup;
having only the wand does not complete its weapon component. Mystic colour
variants and blue dragonhide trim variants are accepted where the retained
equipment statistics agree. These are alternative obtained records, not a
claim that each cosmetic variant has its own F2P acquisition route.

Gud raider body supplies a melee damage bonus whereas rune platebody +3 is a
tank choice. The draft selects the ordinary damage-oriented setup. Specialist
prayer/tank sets, alternative shield loadouts and supplies are separate goals,
not additional combat-style checklist items. Two-handed setups do not need an
unused off-hand. Magic runes are supplies rather than equipped ammunition. No
pocket/aura objective is added without a supported permanent F2P acquisition
target. These decisions avoid manufacturing a requirement for an empty slot.

This is a reviewed durable target, not an assertion that it is the optimal DPS
setup for every enemy or that it includes every newly released item. Existing
[equipment ranking](../equipment.md) records scoring and set-effect limitations;
[equipment permanence](equipment-permanence.md) records the temporary/repairable
distinction. The catalogue's T10 Necromancy equipment and members-only upgrade
quest boundary retain a T10 target despite the level-20 trial cap; upgrading the
weapons is a different gate from gaining trial XP.

Gear evidence combines **own** `obtainedEquipment`, own projected Obtain-task
completions and current `currentBiS.owned.recordedObtained`/`recordedBest` output.
The obtainable plan never lowers the target or grants credit. Challenge-only
ticks and the partner's records do not grant an item. A result with the wrong
member ID (including its nested Current BiS ID) or state revision is rejected.
Recorded obtained gear does not assert present inventory or equipped slots.

## Notable achievements and custom goals

The defaults include the Beginner, Easy, Medium and Hard Lumbridge completion
rows, with permanent task IDs `002dbf`, `002dd3`, `002de0` and `002de8`, plus the
Stronghold of Security portal unlock `0040ec`. These are five existing F2P
objectives with useful milestones, rather than a new achievement catalogue.
The four diary tiers lead to explorer's ring 4. Earning the ring and completing
its achievement tier are separately inspectable goals; recording a reward does
not automatically tick an achievement.

Achievement credit uses the player's own projected completion or picker tick.
The status therefore means **recorded complete in the picker**, not independently
verified in-game RuneScore or achievement synchronization. Unrecorded completion
remains visibly unknown. A custom goal uses its own `completedBy` list and never
becomes an ordinary chunk task.

## Progress calculation and verification

Enabled checklist items have equal weight. A skill contributes
`min(observed level / target, 1)`. Binary quest/achievement/custom objectives
contribute zero or one. A gear style contributes completed target components
divided by its nine components; a weapon setup is one component and requires
every item in one compatible option. Missing personal facts contribute zero and
remain labelled unknown. Empty saved obtained lists mean zero recorded target
slots, not a claim of empty inventory.

Player percentages average these ratios. Each duo item uses both personal
completions and the smaller player ratio. The duo percentage averages those
item ratios, so fast progress on one account cannot finish the other account.
Disabled rows remain visible but leave every denominator. Displayed percentages
are floored and capped at 99 until every enabled item is done. No enabled goals,
or no players, produces zero rather than an artificial 100%.

The saved draft seam is `finishLine.items[id].enabled/target` plus
`finishLine.customItems[{id, text, completedBy}]`. The pure model returns five
groups, per-player summaries and a duo summary. Skill IDs use canonical skill
names, gear IDs use lowercase styles, quests and achievements use permanent
task IDs, and custom IDs use the separate `finish:` namespace.

`node --test --test-timeout=15000 tests/finish-line-model.test.mjs` passed 13
small-fixture tests. Coverage includes F2P whole-quest selection, permanent alias
projection, own/shared completion boundaries, unknown and mismatched observations,
trial overrides, locked-geography independence, coupled weapon alternatives,
wrong-player/stale results, explicit Obtain evidence, custom checks, exclusions,
input immutability and the zero/99/100 percentage boundaries. These are synthetic
model checks, not a live-account or browser acceptance claim.
