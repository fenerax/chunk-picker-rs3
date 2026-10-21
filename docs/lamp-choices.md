# XP lamps and choosable quest rewards

XP choices are personal training assumptions. A saved selection contributes the
reward's XP when its source task is available in that player's task calculation.
It does not change observed account XP, record a quest completion, complete a
challenge, unlock a chunk or grant a repeatable primary training method.

## Retained original behavior

The original picker saves choices in
`chunkinfo.assignedXpRewards[category][task label][skill]`, with amounts aggregated
by skill. `None` represents an unused choice. Labels and keys go through the
original Firebase encoding; the recreation decodes them without changing the
preserved `legacy.maps` record.

`reference/original-picker/index.js`, `openXpRewardModalWithFormat` and
`openXpRewardModal` (lines 4906–4996), expand non-skill `XpReward` selectors such
as `Any`, `Anyx3`, and `Attack|Strengthx2` into individual choices. Each repeated
slot has the amount attached to that selector. Repeated choices can target the
same skill. Ordinary skill keys are fixed XP rewards, excluded from the chooser.
The original dialog offers `None` and allowed skills, aggregates the selected
amounts, and also toggles its challenge checkbox. The recreation's editor keeps
the XP allocation separate from challenge and personal quest completion.

The original worker's `skillQuestXp` calculation (lines 3649–3698) combines
fixed and assigned XP and converts totals to passive reachable skill levels.
Before this editor, the authored engine already read retained assignments in
`updatePoints`, gated by source task validity, and capped the resulting passive
levels. The editor preserves that authored imported-save behavior: choices
replace only the chosen source's imported allocation, retain all fixed rewards,
and participate in the existing eligibility fixed point. Undo restores the prior
allocation and its prior effect on task eligibility.

## Model and command

`app/core/xp-choices.mjs` owns the reward model:

- `buildXpChoiceCatalogue(definitions, taskCatalogue)` returns a trusted Map
  keyed by task identity, joining `rawLabel` and category to retained `XpReward`.
  Reward metadata stays outside the ordinary identity catalogue.
- `buildXpChoiceView(state, memberId, catalogue)` returns the player's reward
  rows with labels, source kinds, mode availability, imported provenance,
  aggregate allocation and individual `{index, amount, skills, selection}` slots.
- `resolveXpChoices` gives authored selections precedence, then imported totals,
  then unset slots. Equal interchangeable slots are recovered in canonical
  order. Inconsistent or ambiguous totals remain visible for review; unmatched
  imported sources are read-only rows with no writable identity.
- `xpRewardSlots`, `validateXpChoices` and `xpChoiceAllocation` share slot
  expansion, command validation and aggregation with the task engine.

The command is:

```js
{ type: 'set-xp-choices', memberId, taskId, choices: ['Mining', null, 'Fishing'] }
```

`choices` contains exactly one canonical skill or `null` per selectable reward
slot. `null` means **Not chosen yet** and contributes no XP. An all-null save
explicitly clears the source's imported contribution. The member field
`xpChoices[taskId]` holds that ordered array. Imported aggregates stay unchanged
in `legacy.maps` and travel with portable backups.

The trusted server passes `xpChoiceCatalogue` and the ordinary `taskCatalogue`
through the durable store to `applyValidatedCommand`; commands cannot supply
their own reward metadata. Standard revision conflicts, History, typed sparse
Undo, backup validation and restore warnings apply. Player invitations can edit
their own member; administrators can edit either. View invitations use the
authenticated read endpoint and cannot issue the command.

The authenticated read route is `GET /api/xp-choices?memberId=<id>`.

## Player control

Open **XP choices** from **Info → Profile → Levels**, or **Activity Info**.
The dialog switches players without switching the map, searches reward sources,
and gives each source its own **Save choices** button. Repeated rewards have
separate skill fields and **Not chosen yet** contributes no XP. In F2P mode,
unassigned members sources are hidden while saved members choices remain visible.
Unknown imported sources show their original allocation as read-only text.
Viewer links and another player's invitation show selections without source
editing controls. Revision conflicts keep the draft and offer **Refresh choices**.

## Membership and data limits

The shared `content.f2p` rule sets membership mode. F2P choices exclude Invention
and members-only sources reject allocated skills. Trial skills remain selectable
and the existing engine caps their reachable levels at 5, or 20 for Construction,
Archaeology and Necromancy. Switching mode preserves existing choices. A source
blocked by access, requirements or membership contributes no XP.

### Source membership audit — 2026-10-13

The reward catalogue classifies the **source**, rather than guessing membership
from the skills a lamp can train. It uses the selected retained definitions
(`app/data/original-data.2026-10-13.v1.json`) and trusted task identities:

1. A reward's `Not F2P`, a trusted task's membership flag, or its record's
   `Not F2P` makes the reward members-only.
2. `BaseQuest` inherits the matching quest's membership. Required `Tasks`
   inherit membership recursively, with a cycle guard. Unknown dependencies
   provide no membership evidence.
3. For Diary rewards only, every declared claim chunk must have a known numeric
   base absent from `walkableChunksF2P` before geography proves members-only.
   A free base, an unknown base, an interior or missing F2P area data prevents
   that inference. Quest locations do not determine quest membership.
4. Four exact category/label exceptions fill the remaining retained-data gaps.
   They apply only to XP reward catalogue metadata, never to engine definitions.

| Manual source | Evidence |
| --- | --- |
| Quest: `~|Beneath Scabaras' Sands|~ Complete the quest` | Existing `app/data/source-membership.2026-10-08.v1.json`, verified Task membership; [Wiki revision 37173764](https://runescape.wiki/w/Special:PermanentLink/37173764). |
| Diary: `~|Varrock Achievements#Easy|~ Complete the Easy Achievements` | Members area-task set; [Wiki revision 37049743](https://runescape.wiki/w/Special:PermanentLink/37049743). |
| Diary: `~|Wilderness Achievements#Easy|~ Complete the Easy Achievements` | Members area-task set; [Wiki revision 37049744](https://runescape.wiki/w/Special:PermanentLink/37049744). |
| Diary: `~|Wilderness Achievements#Medium|~ Complete the Medium Achievements` | Same Wilderness evidence; its F2P claim region does not make the reward earnable in F2P. |

Of 124 recognized choosable sources, **107 are members-only and 17 are F2P**.
For quests, retained flags identify 58 members sources and the exception adds
one. For diaries, required-task membership identifies 43 of 48 members sources;
geography adds Fremennik Easy and Karamja Easy; the three manual rows complete
the set. All four Lumbridge tiers remain editable: Beginner, Easy, Medium and
Hard. [Lumbridge revision 37049719](https://runescape.wiki/w/Special:PermanentLink/37049719)
identifies it as the only Area Tasks set free players can fully complete.

The members diary families are Ardougne, Daemonheim, Desert, Falador, Fremennik,
Karamja, Morytania, Seers' Village, Tirannwn, Underworld, Varrock and Wilderness.
Underworld Easy is members-only even though Necromancy has a level-20 F2P trial:
its [antique lamp, revision 36461843](https://runescape.wiki/w/Special:PermanentLink/36461843),
requires membership. Trial-skill levels alone cannot establish lamp membership.
Bounded Wiki API batches checked the diary-family membership and these edge
cases; no upstream picker or live save was changed.

The 13 F2P quest sources are Beneath Cursed Tides, Death Plateau, The Death of
Chivalry, Demon Slayer, Gower Quest, Gunnar's Ground, Missing, Presumed Death,
Myths of the White Lands, Stolen Hearts, Three's Company (unabridged saga),
Vampyre Slayer, Violet is Blue and Violet is Blue Too. The
[Three's Company saga, revision 37182560](https://runescape.wiki/w/Special:PermanentLink/37182560),
and [Missing, Presumed Death lamp, revision 37006843](https://runescape.wiki/w/Special:PermanentLink/37006843),
confirm those two easily mistaken F2P cases. No other retained category currently
has a recognized choosable selector; future lamps use the same flag, quest and
required-task rules without a blanket category exclusion.

In F2P, the existing dialog filter hides unset members sources. Saved authored
or imported members choices remain visible as read-only text and stay in the
save. Switching to members restores their editing controls. The trusted command
validator rejects new non-null member allocations in F2P. The correction changes
neither retained definitions nor task eligibility, XP amounts, saved allocations,
revision handling, History or Undo. Existing task-engine source-validity gates
continue to decide whether a saved allocation contributes XP.

The retained `XpReward` fields do not provide per-lamp minimum skill levels or
claiming requirements. The editor therefore exposes the declared selector and
amount without inventing those facts; this is a picker-assumption editor, not a
complete in-game lamp inventory. Unknown selectors are excluded from editing;
the retained `Craft` typo is not inferred to mean `Crafting`. An imported
allocation for an excluded source remains visible as an unmatched read-only row.
Imported aggregate records can lose the order of differing lamps;
the editor shows ambiguous totals and requires explicit replacement choices.

### Membership correction verification

The correction's focused run passed **53 tests** across the XP model, web, state
and server tests, prediction fingerprints and area checks. The quick suite
passed **1,127 tests**. No test files were added; the extended model/web files
already belong to `scripts/test-selection.mjs`'s quick group. The full suite was
skipped under this job's shared rule: no server, storage, engine, worker or
`app/data` code changed.

Before/after complete JSON from six prediction fixtures and three area-check
fixtures is byte-identical, with **zero changed leaves**. The six existing
prediction fingerprints also pass unchanged. The area scenarios cover F2P,
a members draft and an empty selection. These are synthetic full-output
fixtures, not a live-save eligibility audit. Reproduction and evidence are in
`.local/lampdata-output-audit.mjs` and
`.local/screens/lampdata-output-comparison.json`; the output SHA-256 is
`558a0c7970e7981bb2ec486372254347a037c33b430b6dafe2a68951df1bb418`.

The final locked browser session used code revision `c500a16` and a disposable
copy of the private duo save. Its authenticated API confirmed 124 sources,
107 members and 17 F2P. A non-null members allocation was rejected in F2P;
ordinary revision-checked commands on the copy then saved an Underworld Easy
choice in members mode and switched back to F2P. The dialog retained that
choice as read-only text and omitted unset members sources. Searching Lumbridge
showed all four F2P rewards with editing controls.

The visually inspected captures are
`.local/screens/lampdata-f2p-desktop-1440.png` (1440 × 900) and
`.local/screens/lampdata-f2p-phone-390.png` (390 × 844). Both show the F2P dialog
filtered to Lumbridge, with no horizontal page overflow. These are desktop
Chrome viewport checks, not physical-phone or in-game lamp-claim tests.
`.local/screens/lampdata-verification.json` records the checks without
credentials. The first capture attempt failed during Chrome startup; its
processes and copy were cleaned up before the retry. Both final captures ran
in one locked session, with one server on 9231 and Chrome on 9232. Both were
stopped and the copied save was deleted. The dialog markup and CSS were left
unchanged for the parallel accessibility job.

## Original editor verification

`tests/xp-choices-model.test.mjs` covers selector counts, restrictions, membership,
encoded imports, equivalent repeated lamps, contradictory totals and unmatched
imported sources. `tests/xp-choices-state.test.mjs` covers immutable revision
commands, trusted metadata, backup/restore, sparse Undo, allocation replacement,
fixed XP, source validity, trial caps, player isolation and gameplay cache
invalidation. These use synthetic in-memory state and a small task definition
fixture; they do not read or write a live save.

`tests/xp-choices-web.test.mjs` covers the forms, read-only views, unavailable
saved skills, ambiguous import clearing, stale dialogs and conflict recovery.
`tests/xp-choices-server.test.mjs` exercises trusted catalogue validation, player
authorization, viewer reads, stale revisions, History, restart persistence and
owner-only Undo on an isolated temporary store.

Desktop (1440 × 900) and phone (390 × 844) captures are in
`.local/screens/lamps-desktop-1440.png` and
`.local/screens/lamps-phone-390.png`. They use a disposable copy of the private
duo save and show the imported Demon Slayer reward. The local verification
script excludes credentials and deletes its copied save after server/browser
shutdown. These captures check responsive desktop Chrome, not a physical phone.

The copied-save browser checks passed for both entry points, saving a revision
and History event, Undo restoring the imported allocation, and a viewer showing
choices without editing controls. `.local/screens/lamps-verification.json`
records the source and viewport checks without credentials.

The single final full-suite run reported 3,601 passed, 8 failed and 1 skipped
(3,610 total). Seven failures exposed a missing factory registration in the
shared screen fixture; one exposed the missing authenticated static route for
`core/xp-choices.mjs`. Both were corrected. The five affected integration files
then passed all 274 tests, including the module dependency audit and XP API.
The full suite was not repeated, respecting the job's one-run limit. Its sole
skipped test checks generated PNG assets, outside this feature.
The final quick suite passed all 990 tests.
