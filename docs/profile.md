# Player profile

Open **Info → Profile** for a condensed, read-only view of either player. The
player chooser changes the profile without switching the map. View-only links
can use it, copy the summary, and open the recorded gear in Current BiS.

Levels are the saved account observations in `member.skillProgress`, including
Invention and levels above F2P caps. Unknown skills stay blank; total and combat
remain unknown until their required skills are recorded. F2P planning caps are
shown separately from real levels. The sync date comes from the last applied
RuneMetrics snapshot for the bound RuneScape name.

Completed tasks combine the player's personal completions and picker challenge
ticks, counting each canonical task once in the existing five task sections.
Partner completion never becomes a personal completion. Whole-quest progress
comes from `questProgress`, with the known catalogue filtered by the current F2P
content rule. Diaries and achievements show tasks marked done in the picker;
the app does not sync in-game diary tiers or rewards.

Gear uses `currentBiS.owned.recordedBest`, including personally recorded Obtain
tasks and items added by hand. Choose a style to see each slot. Weapons and
ammunition show one compatible recorded setup; Current BiS retains tied setups,
other records and reasons items cannot currently be ranked. The page does not
infer current inventory or equipped items.

The header counts the player's own unlocked chunks. When retained roll evidence
exists, it shows the first **recorded** unlock date, which is not a membership or
account creation date. Missing dates do not block the profile.

The dialog shares the BiS full-result loader and its current-revision caches;
reopening a cached profile does not request another task calculation. A first
open can hydrate full details from the existing endpoint. Roll-date reads are
cached by save revision. Sandbox asks the player to return to the saved game.
If a viewer's saved task list is ready before full gear details have been retained,
the profile still shows saved progress and explains that a player must open
Current BiS before gear details can appear. Refresh checks the existing cache.

The Discord summary has a clipboard fallback with selected, read-only text.
Focused model and fake-DOM tests cover missing data, count boundaries, gear,
switching, stale requests, caching and copy recovery. Browser acceptance uses
an isolated save copy at 1440 × 900 and 390 px, including a view-only invitation.
