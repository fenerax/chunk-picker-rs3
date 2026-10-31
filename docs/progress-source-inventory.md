# G15 progress dependency inventory

START: `3b1577232a6a51f77de168497ee6d03ff8096353` (fetched main).
This describes the baseline, then the groundwork differences. No private gameplay inputs
were opened or used. The private-data README was read as required.

## Calls and consumers at START

There are exactly **two outbound RuneMetrics requests**, both inside
`app/integrations/runemetrics.mjs:createRuneMetricsClient().snapshot(member)`:

- GET `/runemetrics/profile/profile (player name, activities=0)`:
  account identity and skill IDs, levels, XP in tenths. No activities are requested.
- GET `/runemetrics/quests (player name)`:
  quest titles and completion statuses. No quest steps are inferred.

The pair runs concurrently, on explicit user demand, with one ten-second
request deadline, bounded responses, account checks, a three-minute per-binding
cache and shared concurrent work. No polling or browser-to-Jagex requests exist.
`progress-sources.mjs` is already the only app importer of the transport at
START; its `snapshot(member)` seam and `quest-mapping.mjs` are retained.
`previewRuneMetrics` remains a compatibility wrapper used by existing tests.

| Feature / files | Data use | When RuneMetrics fails at START |
| --- | --- | --- |
| Levels and XP: `runemetrics.mjs`, `progress-preview.mjs`, `core/state.mjs`, `core/game-progress.mjs` | Normalize IDs/XP, validate account and observations, save per-field provenance | Pair fails atomically; no partial snapshot or write. Existing values remain. Successful lower observations can be reviewed. |
| Quest completion: `quest-mapping.mjs`, `progress-preview.mjs`, `core/state.mjs` | Exact whole-quest mapping/aliases; add personal completions only | Existing completions/provenance remain. No steps, reward claims or challenge ticks are added. |
| Sync button, previews, Apply: `server.mjs`, `web/runemetrics.mjs`, `web/screen-commands.mjs`, `web/info-panels.mjs`, `web/screen-startup.mjs` | POST `/api/runemetrics/preview`, server-held revision-bound token, POST `/api/runemetrics/apply` | Private/unknown/rate/timeout/network/bad-response failures show an actionable error, without Apply. Sunset or HTTP 410 returns an informational placeholder. Apply requires a reviewed token; stale/name-changed reviews reject. |
| Dataset gating: `game-profile.mjs`, `web/dataset-features.mjs` | Compatibility `runeMetrics` feature/route names cover all sources | Feature availability is independent of upstream health. Viewers cannot sync. |
| Account profile: `web/profile-model.mjs`, `web/profile-view.mjs` | Bound saved levels/XP, totals/combat level, sync time and personal quests | Last-known values continue to display; missing levels remain unknown. Account rebinding invalidates web observations. |
| Eligibility/training/travel: `tasks/training-availability.mjs`, `tasks/activity.mjs`, `tasks/access.mjs`, helper/custom-task models, transport consumers | Saved bound levels and quest facts, subject to existing membership/planning caps | Last-known observations remain usable; absent observations use existing estimates/unknown behavior. No sync fetch is made by calculators. |
| Completed tasks, history and exports: `web/completed-model.mjs`, `web/completed-view.mjs`, `web/history-text.mjs`, `web/copy-lists.mjs` | Display saved personal completions, source attribution and applied sync events | Saved records remain; a failed preview adds no History event. |
| Quest points: `helper-progress.mjs`, `core/progress-timeline.mjs` | Sum pinned whole-quest catalogue points for personal completed tasks; never read profile quest-point totals | Saved counts remain; unavailable catalogue points are gaps, never invented zeros. |
| Timelines: `core/progress-timeline.mjs`, `core/progress-snapshots.mjs`, `storage/store.mjs`, web helper-progress models/views | Saved observations and History/Undo replay; complete skill sets required for total/combat levels | Existing series remain. Failed preview writes no point; missing skills leave gaps. |
| Roll stats: `core/roll-stats.mjs` | Map unlock History only; explicitly excludes both progress command types | No dependency on RuneMetrics or XP; stats continue unchanged. Progress can affect later eligibility through saved facts. |
| Onboarding: `web/setup-guide.mjs`, `web/screen-startup.mjs` | Starting-bank/theme/tour flow; optional Sync progress entry point | No RuneMetrics request or requirement in onboarding. Users can start/roll without syncing. |
| Plugin priority: `game-plugin.mjs`, `progress-sources.mjs` | Fresh accepted live reports override the entire web source for ten minutes | Fresh plugin still works. At expiry/restart, web could replace previously applied plugin fields. |

At START, HTTP 404 meant unknown player; JSON errors carried distinct
private/unknown/rate-limit meanings. HTTP 410 latched retirement. The dated
sunset suppressed cache and in-flight results and selected the replacement
placeholder. Transport errors did not mutate storage.

## Groundwork changes

See [Progress sources](progress-sources.md) for the provider contract, operator
switch, precedence, closure message, hiscores format and migration caveat.
Stored plugin evidence now wins per field indefinitely; fresh partial reports
can share one review with web fields. Hiscores only fills levels/XP on failure
when no plugin data exists, and cannot reduce known progress. Task catalogues,
pools, XP units for existing sources, plugin protocol and mapping are unchanged.

The actual replacement still needs its documented URLs, auth/privacy rules,
account checks, IDs/units/status conversions, cache/rate-limit policy and error
mapping implemented in `app/integrations/official-api.mjs`, plus synthetic contract fixtures. Configure
`officialApi`/`webSource` at the existing seam. Do not guess its unpublished API.

## Synthetic equivalence measurement

Run `node scripts/perf/progress-sync-comparison.mjs /path/to/START-checkout`.
It compares normalized snapshots, full previews/commands, and applied states
byte for byte on six synthetic cases, including missing/invalid fields and
unmapped quests. Fixed clocks eliminate timestamp noise. No live networking.

Node 24.21.0, seven timed corpus repetitions after warm-up:

| Measurement | START | G15 |
| --- | ---: | ---: |
| Median duration | 6.348 ms | 6.092 ms |
| Min–max | 6.205–7.138 ms | 4.847–8.277 ms |

Zero differences; 59,274 bytes; SHA-256
`f3e0f361ce9270c8458cd2fcd4df0f0b7d4753b855c6ef160e44396cb3ebb6dc`.
Whole comparison process peak RSS: 461,960 KiB (both module trees loaded).
These fixture timings do not measure real network latency or calculator memory;
the spread does not establish a performance improvement.

## Changed files

| Files | Change |
| --- | --- |
| `app/integrations/progress-sources.mjs` | Provider selection, failure routing, operator switch, per-field plugin supplement and fallback gate. |
| `app/integrations/official-api.mjs` | Isolated replacement placeholder; implement the real contract in this file. |
| `app/integrations/runemetrics.mjs` | Distinguish endpoint HTTP 404 from JSON unknown-player errors. |
| `app/integrations/hiscores.mjs` | Bounded RS3 lite adapter and strict skill parser. |
| `app/integrations/progress-preview.mjs` | Merge source reviews, protect plugin fields and reject fallback regressions. |
| `app/core/game-progress.mjs`, `app/core/state.mjs` | Hiscores provenance, atomic mixed-source validation/application and durable precedence. |
| `app/server.mjs` | Let the provider merge reports arriving during a fetch instead of discarding web fields. |
| `app/web/runemetrics.mjs` | Display the single closure message in available fallback reviews as well as unavailable results. |
| `app/web/history-text.mjs`, `app/web/helper-training.mjs` | Accurate source labels in existing text. |
| `tests/progress-fallback.test.mjs`, `tests/fixtures/progress-sources/` | Synthetic closure, precedence, switch, fallback and preservation cases. |
| `tests/progress-sources.test.mjs`, `tests/runemetrics-server.test.mjs`, `tests/runemetrics-web.test.mjs` | Existing seam/server/UI coverage adapted to field merging and the closure message; fake fallback, no live network. |
| `scripts/test-selection.mjs` | Classify the new small fixture test in quick. |
| `scripts/perf/progress-sync-comparison.mjs` | Repeatable START comparison and seven-run timing distribution. |
| `docs/progress-sources.md`, this file | Operator/adapter contract, complete dependency inventory, measurements and validation. |

## Validation

Node 24.21.0. Final focused files ran sequentially: progress-fallback **16/0**,
progress-sources **12/0**, runemetrics **16/0**, runemetrics-state **3/0**,
runemetrics-server **8/0**, runemetrics-web **19/0**, history-text **6/0**,
helper-training **35/0** (pass/fail; total **115/0**, no skips).

Final quick suite: **2,493 passed, 0 failed, 67 skipped**, 97.106 seconds.
An earlier quick run also passed; its following full run was deliberately
interrupted to isolate the replacement adapter before final sequential validation.

Final full suite: **5,663 passed, 0 failed, 139 skipped**, 377.220 seconds
(637 files, 5,802 cases, zero cancellations). Existing skip conditions were
unchanged. No socket or parent-death failure required baseline triage.
`git diff --check` passed. The final adapter layout also reproduced the exact
six-case equivalence bytes and SHA-256 above. All changes are staged.

Recommendation: **MERGE-CANDIDATE**. Live hiscores shape remains unverified;
the new Jagex adapter awaits its published contract. Older readers must be
upgraded before consuming the newly allowed provenance/command fields.
