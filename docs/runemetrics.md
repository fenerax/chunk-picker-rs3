# RuneMetrics personal progress sync

Progress sync now chooses fresh live plugin observations first and retires
RuneMetrics on 10 November 2026. See [Progress sources](progress-sources.md) for
priority, the calm unavailable state, the API publication check and adapter setup.
The RuneMetrics transport and compatibility storage described below still apply.

Open **Activity Info**, check the selected player's RuneScape name, then choose **Sync progress**. Review the level and XP changes, personal quest completions and unmatched items. **Apply** saves one revision-checked, undoable batch; **Cancel** leaves gameplay unchanged. Names default to Player 1's `exampleGIMab` and Player 2's `twosamplegim` and can be edited there (1–12 ASCII letters, numbers, spaces, underscores or hyphens).

The server uses the existing private invitation authentication and same-origin write checks:

- `POST /api/runemetrics/preview` with `{memberId}` fetches a paired snapshot and returns a review token, current revision, diffs, counts and unmatched items. It never writes progress.
- `POST /api/runemetrics/apply` with `{previewId, expectedRevision}` applies the server-held proposal through the state store's `apply-runemetrics` command. Changing any shared state requires a fresh review; substituting a newer revision does not bypass that check. Tokens expire after ten minutes, are consumed on success and disappear on server restart.
- `set-runescape-name` edits a member's account binding through the ordinary command endpoint.

Only these Jagex URLs are requested, server-side, for the saved account binding:

- [Profile](https://apps.runescape.com/runemetrics/profile/profile?user=exampleGIMab&activities=0): `/runemetrics/profile/profile?user=NAME&activities=0`.
- [Quests](https://apps.runescape.com/runemetrics/quests?user=exampleGIMab): `/runemetrics/quests?user=NAME`.

There is no polling. Paired successful snapshots are cached in memory per member/name for three minutes; simultaneous requests share a fetch. Requests have a ten-second deadline and descriptive `RS3ChunkPicker/0.1` User-Agent. Failed or partial snapshots are not cached. Private profiles, unknown names, request limits, malformed responses, timeout and network failure produce actionable errors without changing state. Fetching is asynchronous and does not hold the save queue.

## Mapping and personal facts

RuneMetrics skill IDs are zero-based and independent of response order: `0 Attack, 1 Defence, 2 Strength, 3 Constitution, 4 Ranged, 5 Prayer, 6 Magic, 7 Cooking, 8 Woodcutting, 9 Fletching, 10 Fishing, 11 Firemaking, 12 Crafting, 13 Smithing, 14 Mining, 15 Herblore, 16 Agility, 17 Thieving, 18 Slayer, 19 Farming, 20 Runecrafting, 21 Hunter, 22 Construction, 23 Summoning, 24 Dungeoneering, 25 Divination, 26 Invention, 27 Archaeology, 28 Necromancy`. Raw XP is in tenths; the picker saves `xp / 10`, retaining decimal XP. The [pinned converter](https://github.com/villermen/runescape-lookup-commons/blob/e3782faa15d804aedcd8f518dd2c2dc7a68bf306/src/Service/PlayerDataFetcher.php#L127-L134) and [skill enum](https://github.com/villermen/runescape-lookup-commons/blob/e3782faa15d804aedcd8f518dd2c2dc7a68bf306/src/HighScore/Rs3Skill.php#L7-L37) corroborate these units/IDs; both captured profiles contain all 29 IDs.

Quest matching normalizes Unicode, case, spacing and punctuation. It selects only whole quest/miniquest/subquest completion records with `QuestPoints`, using the definition's `BaseQuest` and explicit completion suffix, or exact bare-title completion records in custom catalogues. Steps, rewards and Archaeology mysteries are excluded. Ambiguous/missing titles remain unmatched. The explicit spelling alias `Vampire Slayer` → `Vampyre Slayer` supports that renamed title. Historical `Prince Ali Rescue` and `Doric's Quest` do not complete their replacement quests: Jagex described [two new Ozan quests](https://secure.runescape.com/m=news/ozan-quest-double-bill), and [What's Mine is Yours](https://secure.runescape.com/m=news/whats-mine-is-yours) can be completed separately by former Doric's Quest completers.

Applied observations live in `member.skillProgress` and `member.questProgress`, with `source: "runemetrics"`, `fetchedAt` and `runescapeName` on every fact; `member.runeMetricsSync` records the last applied snapshot. Quest task IDs are added only to that member's `completedTasks`. Skill observations feed personal eligibility, subject to the existing planning and membership caps. The original observed level/XP stays intact even above a cap. Manual primary/passive/max-level controls retain their values. Challenge checkmarks, partner progress, membership, teleports, ownership and quest steps are unchanged. Readiness can use current personal whole completion as evidence for stages required on every declared completion route, without saving stage checkmarks or granting stage outputs; see `docs/questfilters.md`. As in existing completion policy, real personal completion can satisfy an obligation without adding a challenge checkmark.

The preview displays level/XP decreases as well as increases. It adds completed quests; absence or incomplete status never removes saved completion. Applying also refreshes provenance for matched facts whose values have not changed. Undo restores facts, last-sync metadata and optional-field absence together; backups and reload retain them.

## Recorded coverage and limits

Four live requests on **2026-10-07** returned HTTP 200. Profile objects contain `name`, `skillvalues: [{id, level, xp, rank}]` and aggregate/activity fields. Quest objects contain `quests: [{title, status, difficulty, members, questPoints, userEligible}]` and `loggedIn`; observed statuses are `COMPLETED`, `STARTED`, `NOT_STARTED`. Fixtures in `tests/fixtures/runemetrics/` retain only profile name/skill IDs/levels/XP and quest titles/statuses, with capture metadata. Error fixtures are explicitly synthetic; tests make no live calls.

| Player | Skills mapped | Quest rows returned | Completed titles matched | Completed titles unmatched |
| --- | ---: | ---: | ---: | ---: |
| Player 1 | 29/29 | 364 | 12/13 | 1: Unstable Foundations |
| Player 2 | 29/29 | 364 | 36/37 | 1: Unstable Foundations |

The retained catalogue has 349 unique eligible whole-completion titles. Counts above concern completed RuneMetrics titles, including already saved personal completion; the preview's proposed additions exclude already completed tasks. RuneMetrics' retired website does not provide a supported availability/freshness guarantee for these surviving endpoints. There is no achievement, quest-step, inventory, reward, live-position or event sync. Unknown/new skills and quests require explicit mapping updates; no fuzzy match grants progress. Account names are user-maintained bindings rather than verified ownership. Automated verification covers fixtures, commands, persistence, conflicts and UI behavior, not live gameplay or Player 2's second-device access.
