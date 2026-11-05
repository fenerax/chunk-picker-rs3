# Platform API migration and useful data

Evidence checked November 4, 2026 against Jagex’s public documentation and read-only calls for two accounts checked privately. The Platform API is live. It serves websites and external tools independently of the in-game Client API and its plugin moderation process.

## Added in this migration

The picker now fetches levels and whole XP from main RS3 Hiscores and quest completion from Player Quests. It preserves review, apply, conflict handling, undo and older saved observations. It also saves and displays the new authoritative account quest-point total and maximum. Future Progress records use that total instead of adding catalogue awards. Quest readiness uses the reported current-account total when available, so historical awards or unmatched completions do not distort point requirements.

The new top-level quest-point fields are the most useful data addition. Jagex calculates them with the game’s rules, including retained historical Sheep Shearer points, the corresponding Myths of the White Lands adjustment, and Dimension of Disaster replays. Quest status alone cannot reliably reproduce that total. The global maximum does not mean a player’s F2P target or number of points obtainable within unlocked chunks.

Private live adapter checks returned 29 skills and 366 quest records for each of two accounts. No account values are retained here. The checks also exposed historical Hiscores names: Hitpoints means Constitution; Runecraft means Runecrafting.

## Further functionality the API could support

- A recent-activity panel could show typed events with reliable ISO timestamps, such as level-ups, completed quests and selected drops. The old RuneMetrics profile already exposed recent activities; the explicit event type and standard timezone-aware timestamp are improvements. Only the latest 20 events are returned, some kills and level-ups are batched, and data can lag ten minutes. Recording an event requires active membership and enabled event settings. Changes are not retroactive. Events should be optional so an F2P account can still sync levels and quests.
- A profile could show RuneScore, clue counts, ranks and overall XP from Hiscores. These values were available before; this migration does not present them as new Platform-only data. Activity IDs can shift, so a future adapter should distinguish activities by name. RuneScore does not establish which individual achievement was completed.
- Quest detail could show Jagex’s STARTED/NOT_STARTED state and reported eligibility alongside the picker’s access requirements. Status, eligibility, difficulty, members flags and per-quest awards already existed in RuneMetrics but the picker used only title/completion. `eligible` does not prove the player can reach every required chunk, has the needed items, or satisfies house rules.
- Numeric quest IDs can support provenance and future catalogue matching. The adapter retains them in its fetched snapshot. Persisted completions continue to use the picker’s existing task identities and conservative title mapping; numeric IDs alone do not establish a link to local task records.

These are candidate additions. The migration implements authoritative QP now; the activity feed and extra profile/quest-detail data remain future work.

## Limits and losses

The documented Platform modules do not provide inventory or bank contents, equipped items, comprehensive achievement/diary completion, quest-step state or live player coordinates. Those capabilities need another supported integration, such as a separately developed Client API plugin.

Hiscores loses RuneMetrics’ tenths-of-XP precision. Monthly XP has no direct replacement. Main Hiscores includes Group Ironmen, while the individual Ironman instance excludes them. A successful public event call does not change the picker’s F2P house-rule setting or prove the account will remain a member.

## Verification

Private read-only checks returned all 29 skills for two accounts, with no unmatched skills. Completed quests mapped 18 of 20 and 43 of 46; unmapped records remained available for review and did not prevent authoritative quest-point sync.

A separate private live server check exercised preview, apply, backup, restart and undo for two accounts using a temporary store. All steps passed; no personal save was changed. These private checks are background evidence from the source implementation. Public tests use invented display names and values and never call the live API.

The public port retains plugin priority, the explicit legacy retirement policy and the levels-only Hiscores fallback. Its focused verification is recorded in the pull request; no full-suite result is claimed.

## Sources

- [Launch announcement, November 4](https://secure.runescape.com/m=news/runescape-platform-api-out-now-)
- [Migration guide and November 10 RuneMetrics shutdown](https://developer.runescape.com/platform/modules/adventurers-log/migrating-from-runemetrics.html)
- [Player Quests, update delays and authoritative QP](https://developer.runescape.com/platform/modules/adventurers-log/player-quests.html)
- [Player Events, membership, privacy and batching](https://developer.runescape.com/platform/modules/adventurers-log/player-events.html)
- [Hiscores values and unstable activity IDs](https://developer.runescape.com/platform/modules/hiscores/index-lite.html)
- [Hiscores instance coverage](https://developer.runescape.com/platform/modules/hiscores/instances.html)
