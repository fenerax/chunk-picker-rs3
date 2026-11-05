# Account progress sync

Open **Activity Info → Progress sync**, check the selected player's saved RuneScape name, then choose **Sync progress**. The default web source is the RuneScape Platform API. RuneMetrics closes on **10 November 2026**. Accepted plugin observations still win per skill and quest; the existing levels-only Hiscores fallback remains available when the web source fails and no plugin evidence exists.

## Endpoints and mapping

The server requests main RS3 Hiscores JSON at `https://secure.runescape.com/m=hiscore/index_lite.json?player=NAME` and Player Quests at `https://secure.runescape.com/m=adventurers-log/api/v1/playerQuests/NAME`. Main Hiscores includes Group Ironmen. Requests are on demand, paired atomically, bounded to one MiB per reply, and use a ten-second deadline. Successful pairs are cached per member and account for three minutes; concurrent requests share work. Failed pairs are not cached. Returned account names must match the saved binding.

Hiscores uses **one-based skill IDs**, with ID zero reserved for Overall. The adapter verifies each recognized ID against its name; historical Hitpoints and Runecraft map to Constitution and Runecrafting. XP is whole XP, with no division by ten. Rank minus one can still accompany usable levels and XP; negative level/XP rows and unknown skills remain unapplied and visible for review. Old RuneMetrics snapshots retain their zero-based IDs and tenths-of-XP conversion in the diagnostic compatibility adapter.

Player Quests supplies numeric quest IDs and title/status records. The existing conservative whole-quest title map remains authoritative: steps, rewards, ambiguous titles and replacement quests never gain completion through a fuzzy match. Unmatched titles stay visible for review. Missing or incomplete quests never remove saved completion.

The response's top-level `qp` and `qp_max` appear in the sync preview only. They are not saved. Profile, Progress and quest readiness keep the existing completion-derived quest-point estimates.

## Review, persistence and compatibility

The authenticated `POST /api/runemetrics/preview` and `/api/runemetrics/apply` routes and `apply-runemetrics` command retain their compatibility names. Preview writes nothing. Apply uses a server-held ten-minute token and the reviewed revision; shared-state or account changes require a fresh review. Cancel leaves progress alone. One apply is one undoable command. Backups, restart and sparse undo preserve observations and optional-field absence.

New Platform skill and quest observations save the existing `source: "official-api"`, `fetchedAt` and `runescapeName` provenance so the main release can load them on rollback. The command records `source: "platform-api"` for the sync history label. Skills and quests remain in `skillProgress` and `questProgress`; `runeMetricsSync` remains the last web-sync field. No quest-point field or provenance extension is added. Older RuneMetrics, official API, Hiscores and plugin observations remain readable. Plugin facts retain member-bound provenance even when overlaid on web snapshots. Planning caps and manual controls keep their existing meaning; challenge checkmarks and partner facts are unchanged.

See [Progress sources](progress-sources.md) for source selection, the retained explicit legacy retirement policy and plugin precedence.

## Limits and verification

The Platform API does not provide inventory or bank contents, equipped items, comprehensive achievement/diary completion, quest steps or live coordinates. Hiscores loses RuneMetrics' tenths-of-XP precision. Activities and extra profile data are not imported by this migration.

Public contract fixtures use invented display names and values. Fake-fetch tests cover malformed replies, account mismatch, errors, timeout, cache isolation, mapping and quest totals. Authenticated temporary-store tests cover review/apply, stale revisions, backup, restart and undo. No automated test calls the live Platform API or reads a personal save. Platform API, RuneMetrics and Hiscores responses are limited to 1 MiB of streamed bytes before UTF-8 decoding; oversized Content-Length headers are refused before reading the body.
