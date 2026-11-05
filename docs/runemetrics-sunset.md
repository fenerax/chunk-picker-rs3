# RuneMetrics shutdown audit

Audited against main on 5 November 2026, ahead of the announced 10 November shutdown. No live account, save or upstream request was used.

| Surface | Remaining dependency and action |
| --- | --- |
| Application network | `progress-sources.mjs` was the only caller of the paired RuneMetrics client. Platform failures retried it on every explicit sync unless HTTP 404/410 had retired it. Removed that client and fallback entirely. Platform API supplies levels, XP and completed quests. |
| Configuration and custom adapters | Legacy `webSource: 'runemetrics'`, default `official-api` and the old `runeMetrics` options now use Platform. Retired enable switches cannot re-enable the dead host. Explicit custom adapters remain available. |
| Browser and HTTP routes | `web/runemetrics.mjs`, `/api/runemetrics/preview`, `/api/runemetrics/apply`, capability names and `apply-runemetrics` are compatibility identifiers. They call the shared progress provider, never the retired host. Current labels describe progress/Platform sync. |
| Saved progress and consumers | `skillProgress`, `questProgress`, `runeMetricsSync`, History, timelines, helper/training, task readiness, profiles, backup, restore and Undo still accept old provenance. No migration, deletion or automatic rewrite of saved facts is needed. |
| Plugin | Picker-side plugin code uses the canonical observed skill list, not RuneMetrics. The companion repository has no RuneMetrics request; its only text match is the privacy scanner's legacy URL pattern. No protocol or plugin release change is required. |
| Scripts | Synthetic progress comparison/timing scripts now return Platform fixtures. Cache quest extraction uses core skill ordering. Other mentions are saved provenance, task availability, privacy scanning or historical research, not network calls. |
| Tests and export inventory | Live-client cases now exercise Platform contracts and failure handling with invented responses. Legacy snapshot normalization moved to a network-free test helper. Saved-state/rollback fixtures and scanner detection examples intentionally remain. The export inventory follows the moved helper. |
| Docs and product data | Current progress-source docs and G15 roadmap describe Platform and mark the migration done. Changelog records removal of the fallback. Dated audits/research and older changelog entries remain historical evidence; the G15 implementation record links here. |

## Shutdown behavior

RuneMetrics HTTP 404/410, HTML, DNS failure or timeout has no effect: no application or script fetches that service, including before the date, after restart or through legacy configuration. There is no retirement probe, timer or retry to a dead host.

If Platform itself fails, the paired snapshot is discarded. Accepted live/persisted plugin rows retain priority. Without plugin facts, levels-only Hiscores may fill progress but cannot lower a current-account saved observation. Missing quest data never removes completion. If all sources fail, preview returns HTTP 200 with `available: false`, a neutral message and no Apply token. Ordinary map actions and saves continue. Fetching writes no progress or history; only a separately reviewed apply can do so. A later explicit sync can recover.

## Field coverage

Every field imported from RuneMetrics has a replacement: account name, skill identity, level and XP from main RS3 Hiscores JSON; quest title/completion from Player Quests. Official quest totals remain preview-only. Hiscores uses whole XP rather than tenths. Retirement does not rewrite saved observations; future web snapshots show their whole-XP values for explicit review and apply. Plugin XP keeps its precision. Inventory, equipment, coordinates, activities and comprehensive achievements/quest steps were never imported from RuneMetrics. Plugin/manual progress remains their existing source. No feature needs a new RuneMetrics-only field.

## Verification

Synthetic tests cover both web aliases around the closure date; repeated 404/410, HTML, timeout and DNS failure with requests restricted to the replacement host; neutral authenticated HTTP previews without tokens; ordinary saves during outages; plugin precedence; levels-only fallback; unchanged saved facts; cache/single-flight, account binding, byte limits, backup/restart and Undo. The full suite and upstream services are not exercised locally.
