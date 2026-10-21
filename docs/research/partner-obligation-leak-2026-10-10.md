# Partner task access review, 2026-10-10

Player 2's Daemonheim tasks are legitimate. Removing **13882 East Daemonheim Castle** leaves him with **13626 West Daemonheim Castle**, which contains both ordinary dungeon doors and the Dungeoneering tutor, and **13625 Daemonheim Fremennik Camp**, which contains the reward shop. The requested counterexample does not establish a partner task leak. No access calculation, gameplay data, save migration or prediction golden was changed.

## Evidence and scope

The starting application is `a823c08a5b0adb5da98be8a65ed000fa7f67e537` on `codex/leak`. The frozen copied save is revision **97**, with **158** personally unlocked chunks for Player 1 and **114** for Player 2. Removing only Player 2's `13882` leaves his requested **113** chunks. `state.history` was cleared in the private experiments. The copied store includes the static archives needed to hydrate its compact state; reading `state.json` alone is insufficient.

All writes and throwaway processes stayed in this worktree. The main checkout's game data and map assets were read-only inputs. The main save, tracked files, live server and Tailscale were untouched. Temporary picker listeners used ephemeral localhost ports outside 8788–8791 and ran sequentially. Private save contents and credentials are excluded from this report.

The [pinned source manifest](partner-obligation-leak-evidence.2026-10-10.v1.json) records 23 Wiki revisions, their timestamps, exact-revision API URLs and SHA-256 hashes of the fetched full wikitext. Bounded direct MediaWiki API requests succeeded after the web tool reported the Wiki blocked by robots.txt. The manifest retains source metadata without copying large passages. Jagex's boat-removal update was also opened independently. These are public-source and application checks, with no in-game observation.

## Player 2's personal route

| Place or action | Player 2's remaining personal chunk | Evidence |
| --- | --- | --- |
| Reach the camp from the peninsula | 13624 → 13625-1 | The retained personal entry chain uses 13624/13881 into 13625-1; neither needs 13882. |
| Reach the castle courtyard | 13625-1 → 13626-1 | Both chunks remain personally unlocked, and both selectors are present in Player 2's personal access calculation. |
| Obtain a ring | 13626-1 | Tutor at (3452,3720), region 13626. |
| Enter a floor | 13626-1 | Both doors at (3444,3723) and (3455,3723), region 13626. East Castle starts at x=3456. |
| Buy gravite equipment and other token rewards | 13625-1 | The personal source table contains `Shop:Daemonheim Rewards` and Marmaros here. |
| Return using a ring | 13625 | Ring landing (3442,3694), region 13625. The ring remains personal and nontradeable. |

The [entrance scenery, revision 37042361](https://runescape.wiki/w/Dungeon_entrance_(Daemonheim)?oldid=37042361) is F2P and quest-free. [Dungeoneering, revision 37168496](https://runescape.wiki/w/Dungeoneering?oldid=37168496) describes the two courtyard entrances, obtaining the ring from the tutor and forming a party, including a solo party. Floor progression still requires the character's Dungeoneering level and previous-floor completion. [Tutor, revision 37146895](https://runescape.wiki/w/Dungeoneering_tutor?oldid=37146895) and [ring, revision 37155981](https://runescape.wiki/w/Ring_of_kinship?oldid=37155981) pin their positions and acquisition.

Player 2 also personally retains 13627 North-West Coast, 13880 Resource Area and 13881 Docks. His personal route to the tutor, shop and ordinary doors does not require East Castle. The picker models achievable training and supplies; task availability is not a claim that he already holds the ring or has completed every floor.

## Why sharing affects the calculation

The exact retained-data chain is:

1. `chunks['13626'].Sections['1'].Connect['59'] = true`.
2. `chunks['59'].Name = 'Dungeons of Daemonheim'`.
3. `buildAccessIndex()` resolves that numeric alias and builds the west entrance's interior connection independently of the interior's backlink to `13882`.
4. A separate retained task, **Access the Dungeons of Daemonheim**, requires **both** `13626-1` and `13882-1`. The interior's `UnlocksArea` record depends on that task.
5. Sharing admits Player 1's connected east half into Player 2's resource/training access. The retained access task passes there, while its personal-task flag is false because Player 2 does not own both halves.
6. Once that access task passes, Player 2's **own west entrance** admits the dungeon to his personal access calculation. With 13882 removed, the recorded personal `entranceSources['Dungeons of Daemonheim']` contains only **13626-1**. Personal floor tasks then have an owned location, and personal reward-shop tasks have an owned shop.

This explains the apparent leak: a partner connection helps a stricter retained entrance task pass, but the resulting floor/shop tasks have legitimate personal locations. With sharing switched off in the 13882-removed copy, that retained AND requirement blocks the floor chain. That is a false negative compared with the Wiki's west doors; it is not proof that Player 2 needs Player 1's chunks to enter in the game. This job stops at the requested legitimate-route finding and leaves that broader retained entrance-task correction for separate work.

Player 2's personal-task flags therefore need not match with sharing on/off: the retained gate can change which of his own interiors the calculation admits. Those changes were checked against verified personal routes, rather than counted automatically as partner task leaks.

The access rule already separates the two maps. `calculateAccess()` seeds personal bases from `member.unlocked`; `refreshAccess()` keeps partner capability in a separate `access` value; spatial task ownership reads `ownAccess`. Item-only tasks follow personal source or producer lineage, and task aggregates follow personal dependencies. `worldPartnerConnections()` serves map display rather than creating task ownership. No personal manual teleport or legacy area override was needed to explain this case. Sources: [access calculation](../../app/tasks/access.mjs), [task calculation](../../app/tasks/engine.mjs), [map connection projection](../../app/data/world-connections.mjs).

## Current F2P travel checks

The Wiki's current F2P ways to first reach Daemonheim are Wilderness walking and the Taverley boat. A ring can then return the player to the camp. Player 2 already owns the camp, castle and docks in this experiment, so no new transport assumption is required for his ordinary doors.

The [Taverley ship, revision 36653177](https://runescape.wiki/w/Fremennik_ship_(Taverley)?oldid=36653177) uses Bryll's dialogue; the scenery itself is decorative. [Bryll, revision 37182272](https://runescape.wiki/w/Bryll_Thoksdottir?oldid=37182272) places that departure in 11317, and the [shipmaster transcript, revision 36874984](https://runescape.wiki/w/Transcript:Fremennik_shipmaster?oldid=36874984) records the return. The [Wilderness route, revision 37168496](https://runescape.wiki/w/Dungeoneering?oldid=37168496) must still stay inside allowed chunks and have a return route under the duo's rules. Neither game route authorizes walking through unclaimed land.

The historical Lumbridge swamp/Al Kharid outbound boat was removed on **17 November 2025**, according to [Jagex's patch](https://secure.runescape.com/m=news/going-home-to-lumbridge--amascut-4k-enrage---this-week-in-runescape) and the [jetty, revision 37133179](https://runescape.wiki/w/Al_Kharid_jetty?oldid=37133179). Some broad location/Shadow Reef pages retain conflicting outbound wording. No replacement outbound route was verified. A documented return to Al Kharid alone is insufficient for a round trip. The [lodestone network, revision 37199016](https://runescape.wiki/w/Lodestone_Network?oldid=37199016) has no surface Daemonheim lodestone. Members/progression-gated routes are excluded from this F2P conclusion.

Teleports retain the house rule: they can add future roll choices, but cannot unlock a destination. Player 2's west doors, tutor and shop are already in personally unlocked chunks.

## Every changed task in the 13882 experiment

The authenticated `/api/tasks?memberId=…` checks used the copied store twice, once current and once with only Player 2's east half removed. Both runs used identical application code and revision 97. Availability below means `status === 'available'` with the personal-task flag set. The active column also excludes hidden and already satisfied tasks.

| Player | Current chunks | Removed-copy chunks | Available current → removed | Active current → removed |
| --- | ---: | ---: | ---: | ---: |
| Player 1 | 158 | 158 | 1,650 → 1,650 | 1,067 → 1,067 |
| Player 2 | 114 | 113 | 1,626 → 1,625 | 1,044 → 1,043 |

There are **no status changes** for either player. Player 1 has **no task ownership changes**. Player 2 has exactly these six ownership changes, all true → false:

| Task | Status in both copies | Why Player 2 loses the personal task |
| --- | --- | --- |
| Archaeology: Excavate communal space | Blocked | The dig spot is in his removed east half; its members-only outputs already block it for F2P. |
| Archaeology: Complete the On the Threshold of the Mind research | Blocked | Its east-castle source is removed; level 103 already exceeds the F2P Archaeology cap. |
| Quest: Remains of the Necrolord 2 | Blocked | This retained step needs the east-castle location; the quest already requires membership. |
| Nonskill: Daemonheim - Depths excavation site | Blocked | The recorded entrance is in the east half; its bracelet/research requirements already block it. |
| Nonskill: Eastern marmaros Daemonheim mine. | Blocked | The eastern mine's chunk is removed; the task already requires membership. |
| Nonskill: Access the Dungeons of Daemonheim | Available | Its retained task explicitly requires both castle halves. It becomes a voluntary shared activity, while Player 2 keeps a legitimate west dungeon entrance. |

This table is the complete API difference in `(status, obligation)`, not a sample. The [sanitized comparison receipt](partner-task-save-comparison.2026-10-10.v1.json) records all six task IDs, counts and SHA-256 fingerprints of the input, task runtime and result fields. **Setting Up**, **It's Dangerous to go Alone**, **Kitchen Aid**, **The Lone Dungeoneer**, the gravite weapon goals and **Enter the Al Kharid resource dungeon** remain available personal tasks. The Al Kharid goal has its own location; Dungeoneering training comes from Player 2's west entrance. Broad Daemonheim-related counts depend on which rewards, hidden tasks, completed tasks and skill-guide rows are included; the reported 52-row search is not an ownership test.

Because task/access runtime and gameplay data did not change, the current copied-save lists before/after this job remain identical for both players, as do the removed-copy lists. The single lost active Player 2 task above comes solely from the requested ownership experiment.

## Reverse check and regression coverage

Every retained task's personal-task flag was compared with sharing on/off for Player 1, in both copied-save variants. **No flag changes** occurred. Her entire personal access result also matched exactly with sharing off. Four additional active tasks become achievable with shared supplies/training; that changes whether her own tasks can be done, without adding Player 2's chunk tasks. Existing collection/equipment tests separately guard partner-only monster/shop goals and equipment provenance. No Player 1 task sourced only from Player 2's territory was found in this review.

The four availability changes are identical in both save variants. Each is already a personal task with sharing off, where it is blocked:

| Player 1's task | Why sharing helps |
| --- | --- |
| Craft an unfinished wooden brooch | The dwarven army axe supply supports the brooch recipe using her personal material sources. |
| Craft a lapis lazuli brooch | The same supply supports the preceding wooden-brooch recipe. |
| Mine with a dwarven army axe | The calculation explicitly reports axe supplies from connected partner chunks; her mining locations remain personal. |
| Chop with a dwarven army axe | The calculation explicitly reports axe supplies from connected partner chunks; her woodcutting locations remain personal. |

The new synthetic tests in [partner-interior-access.test.mjs](../../tests/partner-interior-access.test.mjs) cover a personal numeric-alias entrance whose interior backlink points to the partner's chunk, for both players with sharing on/off. They also cover a partner-only interior: its items and activities can be used, while spatial, monster, item, recipe and diary tasks remain outside the player's personal list. The synthetic alias fixture isolates connection/provenance behavior; it does not reproduce the retained two-half AND gate described above.

## Verification and performance

`npm test -- --test-concurrency=1` passed the full suite: **2,135 passed, 1 skipped, 0 failed**, out of 2,136 tests, in 475.36 seconds. The existing skipped test checks generated PNG assets absent from this worktree. Both new synthetic tests passed. Serial execution limited simultaneous test services. Prediction goldens remain unchanged. `git diff --check` passed.

The default `npm run perf` run used one frozen-copy repetition, normal prewarming and the cold/reload/player-switch/unlock scenarios. Cold tasks appeared in **9,337 ms** and reload tasks in **1,318 ms**. The Player 2 switch showed tasks in **6,915 ms**, but `/api/death-estimates` returned **504**, so the harness correctly rejected the run. The failure receipt is `.local/perf/partner-leak-review-failed.json`; the complete console log is `.local/leak-research/perf.log`.

A single retry with the documented `--prewarm off` option completed all five scenarios successfully on the same frozen input. Node was v24.20.0 and Chrome was 154.0.8037.97, at 1440 × 900, DPR 1. These are single-repetition observations:

| Scenario | Tasks shown (ms) | Network idle (ms) |
| --- | ---: | ---: |
| Cold | 12,085 | 52,203 |
| Reload | 998 | 2,363 |
| Switch to Player 2 | 5,127 | 121,192 |
| Switch to Player 1 | 620 | 1,586 |
| Unlock and refreshed tasks | 6,956 | 25,852 |

The retry's Player 2 advisory request lasted **115,150 ms**. Server RSS was **1,395 MiB** at ready and **4,045 MiB** after the scenario sequence; the harness then closed its server, browser and workers and deleted the scratch store/profile. These existing costs remain material on the everyday desktop. No additional benchmark retries were run.

Reports: `.local/perf/partner-leak-review-prewarm-off-2026-10-10T05-19-46-179Z.json` and matching `.md`. Both timing batches are retained, including the failed default run and slower retry cold load. The task/access runtime and retained gameplay data were verified byte-identical to the starting Git revision; only the changelog changes player-facing runtime text. There is no new calculation path to regress. This is not a paired performance improvement claim or a three-run comparison against the 10% budget. The default timeout and slow advisories remain outside this no-leak job's scope.

Browser captures show Player 2's 113-chunk copy, with **Setting Up** still active through his west entrance. Desktop uses the gray theme; the 390px capture uses the light theme. Both show the diary task and its two crafting/smithing methods, with no horizontal overflow. They are local headless observations rather than checks of Player 2's phone:

- `.local/leak-research/screenshots/player2-without-13882-desktop-gray.png`
- `.local/leak-research/screenshots/player2-without-13882-390px-light.png`

The private copied store and hydrated state snapshots were deleted after checking. Browser scratch profiles and every owned throwaway server were closed. No push, rebase, merge or live deployment was performed.
