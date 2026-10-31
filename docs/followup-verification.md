# Review follow-up, October 7, 2026

This follows Player 1's first-pass review. The prior readiness claim was premature; a complete source inventory establishes remaining work rather than proving full parity.

## Changes

Temple of Amascut (`12592`) is walkable terrain in the retained lists but has no recorded connection from geometric neighbours `12336`/`12593`. Its only recorded entry is `12848`. Automatic adjacency now requires a reachable connection, honors personal section blocks at both ends, and leaves explicit selections and confirmed personal teleports independent. Read-only evaluation of the original live revision 1 reduces each pool from 9 to 7, removing Temple and Harpoon Shore. This is evidence from the retained topology, not independent verification of all game routes.

Ownership uses full coloured frames and named badges, with split frames and “Both”/“M+R” for overlap. Selected and pending states retain their own indicators. The three-canvas map still renders only the viewport.

Current BiS separates obtainable gear, shared source access, who satisfied a challenge, and personally recorded obtain evidence. The recorded view ranks only personally recorded gear currently eligible in the engine. It does not infer inventory, current levels, equipped slots or transferable quest rewards. Actual personal completion can satisfy the applicable obligation without copying personal progress or manufacturing explicit challenge checkmarks.

Activity Info has Skills, Quests, Achievements, Activities, Slayer and Clues tabs. Source details and requirements resolve lazily from canonical task records; lists are searchable and paginated. Personal manual-primary, passive-level, maximum-level and Slayer-lock controls affect planning without copying progress to another member. Slayer assignment planning uses reachable training, quests that are completed or available, and manually declared lock floors/caps. Assignments that need an unfinished quest name it with “after …”. See [Slayer assignment chances](slayer-assignments.md) for the separate planning and right-now warnings. Saved training and Every Drop alternative choices are retained; explicit Automatic masks only the focused member's choice.

The settings audit inventories 27 top-level settings, four nested neighbour flags and 152 distinct original/historical rule IDs. All 26 scalar settings have consumers; the nested neighbour object maps to shared rules. Nine themes, high-visibility fog/borders, personal stickers and starting flags, five recent rolls, actual-result roll presentation and completion styling are connected. Starting flags are annotations and never unlock chunks. The setup wizard and some detailed behaviours remain adaptations; see [settings-audit.md](settings-audit.md).

Current BiS adds tank comparisons, declared skilling priorities and ties, relic/unlock prerequisites and slot/coupled-loadout upgrade paths in both obtainable and personally recorded views. Weight comparisons explicitly report the lack of exported weight data. Inventory, transferable rewards, set-effect simulation and relic-energy optimization are not inferred.

Kill X, Every Drop, All Droptables and All Shops generators use admitted sources and personal controls. Every Drop selects one goal per item with exact alternate-source choices. Completion families respect any/all/personal scopes while keeping exact personal completion separate. A derived potential catalogue of 132,831 identities is held outside saved state: checking or choosing one new goal registers only its lightweight identity. Imports resolve referenced dynamic identities without persisting the whole catalogue or replaying converted checks.

## Verification scope

An isolated copy of `.local/duo/state.json` supplied real gameplay for browser tests. It has its own invitation and port 8789. All setting changes, random rolls, forfeits and undo tests ran against that copy. The live store was neither replaced nor imported again.

Browser checks covered both BiS tabs, all six Activity tabs and six specialist tabs, both players, preference persistence, all nine themes, starting markers without ownership changes, sticker editing and icon routes, personal level edits with exact undo, cancelled roll confirmation, visible rule coverage, desktop rendering and 390×844 layout without horizontal overflow. Random rolls, Roll 2, new-goal popups, random forfeits and undo passed on the copy. Testing caught and repaired a mobile pending-panel overlap with Undo and preserved scroll positions that could hide a newly opened panel's tabs. A final Every Drop browser workflow produced 505 active goals for 505 distinct items, saved a personal alternative source without inventing completion or changing Player 2, and restored both members and the catalogue exactly with undo. Clues/Possible Tasks preference defaults and declared location evidence passed through the real UI. Numeric chunk search now prioritizes exact IDs and clears stale results during debounce.

Functional regressions cover stale task-dialog member binding after a roster change, sidebar/BiS agreement on personal evidence, percentages independent of hiding checked rows, zero drop thresholds, migrated rule precedence, topology admission, and new preference/rolling/forfeit persistence. Exact module-route tests verify every browser import is authenticated and served.

The final full `npm test` run passed 326 tests with zero failures or skips, in 23.78 seconds while browser work was also running. A later small numeric-search/debounce correction passed syntax checks and the real browser workflow. Closed, replaced or member-invalidated panel requests suppress obsolete errors; current request failures still propagate, with both behaviours covered by functional panel tests.

The task cache now fingerprints all gameplay inputs while excluding only display preferences, revision and command history. A saved display preference reuses the same facts at the new revision; personal completion or another gameplay field invalidates the cache. This is tested with two members and revision changes. The browser also reuses its current calculation for confirmed display-only saves and their undo, and cancels superseded downloads.

Read-only profiling removed duplicated Activity Info source evidence, reducing one measured response from 81.7 MB to 56.8 MB uncompressed and 7.47 MB to 5.12 MB with gzip level 1. Current BiS postprocessing fell from about 211 ms to 14–30 ms. Shared evaluation took roughly 1 second and the additional personal-access pass about 0.7–0.9 seconds before serialization. These are stage measurements; they are not an end-to-end performance guarantee. Large source paths still dominate the response and require further transport optimization.

With all four collection rules enabled in an in-memory copy, Player 1 produced 7,442 collection rows and Player 2 7,441, with no generation diagnostics. Compact completion groups and one peer list per representative reduced the collection portion from 42.45 MB to approximately 10.79 MB. Player 1's active Every Drop list had 510 rows for 510 distinct items. Recursive quantities use consistent declared composition rather than retaining inconsistent upstream Thieving arithmetic.

Player 2's actual computer/network access remains untested; two local browser contexts do not establish second-device readiness.

## Final live deployment

The final build started on the existing private address `http://<tailscale-ip>:8788/` at `2026-10-07T14:01:25Z`, preserving the original invitation and using the existing store without another import. Read-only acceptance verified both players' BiS views, all six specialist and Activity tabs, 29 skill summaries per player, all scalar settings enabled, nine theme choices, correct numeric Temple search and 390×844 layout without horizontal overflow. No browser JavaScript errors were recorded.

Both pools contain seven choices and exclude Temple. Saved gameplay remains revision 1: Player 1 has 136 unlocked and 13 selected chunks, Player 2 113 unlocked and 20 selected, and the union is 153. The live store SHA256 before and after deployment and browser verification is unchanged: `48E1B0E4E41AA77E9DF5104154F190B63F85F3A13092A28DE304DB437649E568`. The live error log is empty.

The final live server reported 4.14 seconds for Player 1's worker evaluation and 3.83 seconds for Player 2's; a cached Player 1 request reported 36.63 ms, and Player 2's uncached request reported 5.27 seconds. Request timings are server measurements and exclude browser transfer/parsing/rendering. They do not establish a speed comparison against the original site, and large task responses remain a transport limitation.

This build remains a beta with explicit source-data and detailed parity limits. Player 2 needs access to the Tailscale network to open this private deployment from his own computer; that access has not been granted or tested here.
