# G15 progress providers

Base: `3b1577232a6a51f77de168497ee6d03ff8096353` (fetched main, START).
No private save or pack content is used in this change's fixtures or measurements.

## Inventory at START

There are exactly two RuneMetrics network calls, both in
`app/integrations/runemetrics.mjs`, launched together on demand:

- `GET /runemetrics/profile/profile (player name, activities=0)`:
  account name and skill ID, level, XP (tenths of XP).
- `GET /runemetrics/quests (player name)`:
  quest title and completion status. No separate quest-point request.

The paired result has a three-minute, per-member/account memory cache and shared
in-flight work. Both responses must validate before caching. Timeout is ten
seconds. At START, HTTP 410 or 10 November 2026 retires RuneMetrics, including
cached and in-flight responses, and returns the official-API placeholder.
Other failures return a typed error; none write state. Private/unknown accounts,
rate limiting, invalid responses and account mismatches have specific errors.
Fresh accepted plugin reports take priority over the entire web snapshot at
START; their ten-minute freshness is tracked separately per skill and quest set.

| Feature and code | Data dependency | Failure behaviour at START |
| --- | --- | --- |
| Provider routing: `progress-sources.mjs`, `server.mjs` | Paired profile/quests; fresh accepted plugin reports | Plugin replaces the whole snapshot; otherwise retirement returns an unavailable message, other errors propagate. |
| Sync button and Activity Info: `web/runemetrics.mjs`, `web/screen-startup.mjs`, `web/info-panels.mjs` | `/api/runemetrics/preview` and `/api/runemetrics/apply` | An error or unavailable result has no Apply token. Previously applied facts remain. No background fetch. |
| Review: `progress-preview.mjs`, server preview cache | Normalized skills, XP, completed quests, revision and account binding | No partial paired response. Unknown/missing/invalid skills are omitted with review reasons. A successful lower skill observation is shown as a decrease. Expired or conflicting reviews cannot apply. |
| Quest identity: `quest-mapping.mjs` | Completed titles mapped to whole-quest tasks, explicit aliases | Ambiguous/unmatched titles remain unticked; no guessed identity or completion removal. |
| Personal levels and XP: `core/state.mjs`, `core/game-progress.mjs`, `web/helper-model.mjs`, `web/helper-training.mjs`, `tasks/training-availability.mjs` | Valid, account-bound observations; plugin observations belong to member ID | Existing values remain usable. Missing account observations stay unknown; manual training controls remain separate. |
| Quests, task availability, completion lists | Additive personal completion/provenance, read by engine and completed models | Existing completions remain; failure does not untick anything. |
| Quest points: `helper-progress.mjs`, `core/progress-timeline.mjs` | Pinned whole-quest point mapping plus personal completed tasks | Saved points remain; no live quest-point total is fetched. Steps and challenge ticks do not award points. |
| Progress timelines: `core/progress-timeline.mjs`, daily snapshots | Saved skill observations, dated quest provenance, reversible history | Existing history/daily samples remain. Incomplete skill coverage produces unknown total/combat levels. No fabricated observation date. |
| Roll stats: `core/roll-stats.mjs` | Saved map/roll history, not RuneMetrics responses | No network dependency. Sync commands are non-map events; failure cannot create rolls or map changes. |
| Onboarding and feature gates: `web/setup-guide.mjs`, `game-profile.mjs` | Setup choices and capability-gated sync routes/commands | Setup has no RuneMetrics request and continues without progress. Sync remains a separate, explicit action. |
| History, restore, backups: `core/state.mjs`, storage, `web/history-text.mjs` | Applied facts, source, dates and undo patches | Fetch failures create no progress command/history entry. Existing facts round-trip and remain undoable. |

Only the provider seam imports the RuneMetrics integration. The browser module
with the same filename is a review controller, not an upstream API client.

## Provider contract and precedence

Each adapter implements `snapshot(member)` and optionally `close()`. A successful
snapshot contains `source`, `sourceLabel`, ISO UTC `fetchedAt`, `cached`,
`skills: [{skill, level, xp}]` (actual XP), and
`quests: [{title, status}]` (`COMPLETED`, `STARTED`, `NOT_STARTED`). Missing rows
mean unknown, never deletion. Unavailable adapters may return
`{available:false, source, sourceLabel, message}`. Adapters never mutate saves.

`createRuneMetricsSource` wraps the legacy paired client in that contract.
`createProgressSources` is the sole routing boundary; preview/apply stays common.

Accepted live plugin rows override individual matching web rows. Persisted
`skillProgress` and completed `questProgress` with matching plugin member
provenance also win after restart, disconnection or a web account rename.
Unreported fields can come from the healthy web source. Quest title matching
uses the same canonical aliases as preview mapping. Plugin `STARTED` suppresses
a conflicting web completion in a new preview; existing saved completions are
never removed. Each plugin row retains its original observation date, including
sparse reports. Mixed commands validate optional per-row plugin provenance
atomically; normal web-only command bytes remain unchanged.

The server reapplies the overlay after awaiting fetches, covering plugin reports
that arrive during the request. Neither the plugin nor its protocol changes.
Unapplied live observations retain the existing ten-minute memory lifetime;
applied personal observations are durable.

## Closure, switch and hiscores

HTTP 404/410 retire the RuneMetrics client for the process. DNS/refused/closed
connection failures also use the closure message but can recover on a later
request. JSON account errors remain account errors. The announced date alone no
longer disables RuneMetrics: it is used until it answers 404 or 410. Set `RS3_RUNEMETRICS_ENABLED=0` in the server's
service environment and restart the service to disable it without a release.
Other/unset values enable it until retirement. The routing option
`runeMetricsEnabled` also accepts a runtime predicate; it is checked on each
request and again before accepting a cached/in-flight result.

The one status message, also shown above an applicable fallback review, is:

> RuneMetrics has closed; levels and quests come from the game plugin until the new Jagex API is connected

If RuneMetrics fails and **no live or persisted plugin observations exist**,
`hiscores.mjs` tries the official RS3 endpoint
`https://secure.runescape.com/m=hiscore/index_lite.ws?player=…`.
It reads the overall `rank,total-level,XP` row, then 29 `rank,level,XP` rows in
skill-ID order, ignoring trailing activities. XP is already actual XP. Unranked
skills are omitted; malformed, incomplete or out-of-range responses fail closed.
It provides no quests. A fallback row that lowers either saved level or XP is
omitted, and preview repeats this check against the latest saved state to
cover concurrent progress saves. Existing quests, completions and all omitted
skills remain intact.
Failure of both sources yields no applicable snapshot for closure failures;
ordinary RuneMetrics errors retain their existing meaning if fallback also fails.

Both adapters have bounded timeouts and abort requests. Hiscores is on-demand,
without a background refresh or cache. Tests inject synthetic responses only.
A live probe using the synthetic-safe name `Player x` was denied by the sandbox
proxy (HTTP 403 CONNECT). The documented lite format is **not live-verified**.

## Replacement API work remaining

Implement `createOfficialApiSource` in `app/integrations/official-api.mjs`,
supplying normalized skill and quest rows with `source: 'official-api'`. The router automatically tries it after RuneMetrics closes.
The existing server `progressSources` option can also force
`webSource: 'official-api'` before closure. Preview, personal
provenance, backups, history, training and timelines already accept this source.
The API's URLs, authentication, response fields, XP units, account binding,
privacy/errors, pagination and limits must be confirmed from the real docs.
Add synthetic adapter fixtures once the contract is known; do not guess now.

## Byte comparison and measurements

Run `RS3_DATASET=open-f2p node scripts/perf/progress-sync.mjs . /tmp/sync.json`.
The checked-in synthetic golden was captured on untouched START before app
edits. Two cases cover empty saved observations and an existing observation
with a decrease. Comparison includes the full preview, apply command, saved
members and history, with fixed dates and a synthetic account.

Both results: 12,286 bytes, SHA-256
`b36c637e0bc84758494de0a4d85a54f60097a20e9d0fc7353c9de8d2add0d962`;
zero byte differences. Node v24.21.0, seven samples after one warm-up:

| | Median | Min–max | Process peak RSS |
| --- | --- | --- | --- |
| START | 3.588 ms | 2.890–6.240 ms | 72,499,200 bytes |
| Rebuild | 3.092 ms | 1.968–24.085 ms | 71,925,760 bytes |

These are tiny synthetic sync-path timings, not calculator benchmarks or a
performance claim. No private-save measurements were required.


## Changed files and validation

| Files | Change |
| --- | --- |
| `app/integrations/progress-sources.mjs` | Common routing, field precedence, persisted plugin reuse, closure handling and fallback selection. |
| `app/integrations/runemetrics.mjs` | Normalized provider adapter; missing endpoints retire alongside Gone responses. |
| `app/integrations/hiscores.mjs` | New bounded, levels/XP-only RS3 lite adapter. |
| `app/integrations/official-api.mjs` | Isolated replacement adapter placeholder, selected automatically after closure. |
| `app/integrations/progress-source-policy.mjs` | Shared closure message. |
| `app/integrations/progress-preview.mjs` | Per-row plugin provenance, source/message forwarding and latest-state fallback protection. |
| `app/core/game-progress.mjs`, `app/core/state.mjs` | Validate/persist hiscores and mixed plugin provenance, preserving backups and undo. |
| `app/server.mjs` | Reapply plugin overlay after asynchronous fetching. |
| `app/web/runemetrics.mjs` | Show the single closure message for usable fallback reviews too. |
| `app/web/helper-training.mjs`, `app/web/history-text.mjs`, `app/web/info-panels.mjs` | Truthful hiscores source labels. |
| `tests/progress-providers.test.mjs`, `tests/fixtures/progress/` | Synthetic provider/failure/regression fixtures and 21 focused cases. |
| `tests/progress-sources.test.mjs`, `tests/runemetrics-server.test.mjs`, `tests/runemetrics-web.test.mjs` | Updated precedence assertions, offline fallback injection, durable fallback apply and one-message UI coverage. |
| `scripts/test-selection.mjs` | Full-only classification and public-dataset policy for the new regression file. |
| `scripts/perf/progress-sync.mjs` | Retained synthetic comparison/timing harness. |
| `docs/g15-progress-providers.md` | Inventory, contract, operations and adapter handoff. |

Node v24.21.0 throughout. Focused files ran individually; final focused results:
106 passed, 0 failed across eight files. Initial focused failures from the wrong
dataset setting and updated precedence assertions were corrected before the
required suites. No test was weakened or skipped to obtain a pass.

- Quick, once: 289 files; 2,477 passed, 0 failed, 67 skipped; 99.368 seconds.
- Full, once: 637 files; 5,669 passed, 0 failed, 139 skipped; 395.089 seconds.

The final review additions were verified by rerunning the affected focused files
and by the full suite. No local-socket or parent-death failures needed a START
worktree comparison. The final synthetic byte comparison has zero differences.

Remaining external validation: live hiscores format and the replacement API's
actual contract. No plugin/protocol, task rules, pools, changelog or roadmap
changes are included.


## G15 triage completion

Fix base (START): `528287b14947ce3ef70585878e6bf2e99fbfbbec`.
Healthy-source reference main: `3b1577232a6a51f77de168497ee6d03ff8096353`.
No private save was opened or copied for this work. Tests use synthetic fixtures;
the standard duo test lane reads the released packs without changing them.

`progress-sources.mjs` now checks `progressBelongsToMember` before blocking a
hiscores decrease. `progress-preview.mjs` repeats the binding check against the
latest state and exempts rows carrying plugin provenance from this filter.
The existing validation of per-row provenance still applies atomically.

Regression cases in `tests/progress-providers.test.mjs`:

| Test | Fails on START | Result after fix |
| --- | --- | --- |
| hiscores routing compares decreases only with the current account binding | yes | pass |
| hiscores preview compares decreases only with the current account binding | yes | pass |
| plugin rows arriving during hiscores fallback retain authoritative decreases | yes | pass |
| the off switch changed during a fetch discards its late successful reply | no | pass; already fixed on this branch |
| older live plugin skills and quest statuses cannot overwrite newer saved observations | no | pass; timestamp precedence already fixed on this branch |

The first three fail on untouched START (22 passed, 3 failed) and pass with the
fixes (25 passed, 0 failed). The switch case already existed; the saved-versus-live
plugin case adds explicit coverage of both skill values and quest status.

`scripts/perf/progress-sync-comparison.mjs` ports all six synthetic cases from
g15a and includes the existing two cases from `progress-sync.mjs`. Run with:

```sh
RS3_DATASET=open-f2p node scripts/perf/progress-sync-comparison.mjs /tmp/g15-main
```

The harness reports each case separately and compares serialized snapshots,
previews, commands and applied state for the six new cases; the original two
retain their complete preview/command, member and history comparisons.

| Case | Main bytes | Final bytes | Byte differences |
| --- | --- | --- | --- |
| Empty observations | 5,825 | 5,825 | 0 |
| Saved observation decrease | 6,522 | 6,522 | 0 |
| Sparse skills | 8,763 | 8,763 | 0 |
| All skills | 18,891 | 18,891 | 0 |
| No quests | 7,810 | 7,810 | 0 |
| Unmapped quest | 7,970 | 7,970 | 0 |
| Invalid and unknown skills | 8,003 | 8,003 | 0 |
| No skills | 7,971 | 7,971 | 0 |

All eight also match START. Combined size: 71,755 bytes; SHA-256:
`a29e471cddaf6d16792ecb05d3695535a77f62ee7e96523f6d0a811c15b6f3bd`.
Node v24.21.0, seven samples after an initial corpus comparison:

| Comparison | Before median (min–max) | After median (min–max) | Combined process peak RSS |
| --- | --- | --- | --- |
| Main / final | 6.656 ms (5.297–7.567) | 5.932 ms (5.239–7.254) | 82,416 KiB |
| START / final | 6.958 ms (5.045–9.788) | 6.547 ms (5.128–8.926) | 82,396 KiB |

RSS covers both module trees in one process, not separate before/after peaks.
These small synthetic timings do not establish a performance improvement.
The existing external questions remain: live hiscores format and the future
replacement API contract. No plugin protocol or calculator behavior changes.


### Final triage validation

Node v24.21.0 throughout. The affected provider file ran by itself, followed by
individual source and server checks: 25 + 12 + 9 = 46 passed, 0 failed.
An initial optional server invocation used the wrong open-f2p environment and
was stopped after two failures; its required duo-dataset rerun passed all nine.
No new test file was added, so the existing full-only classification applies.

Required suites each ran once, quick first, then full, with the runner's existing
per-file dataset policy and process workers:

| Suite | Passed | Failed | Skipped | Duration |
| --- | --- | --- | --- | --- |
| Quick (289 files) | 2,477 | 0 | 67 | 156.927 s |
| Full (637 files) | 5,664 | 3 | 139 | 619.642 s |

All three full-suite failures reproduce in standalone file invocations on both
the final code and START. Their tests and application paths were left unchanged:

| File | Final rerun passed / failed / skipped | START passed / failed / skipped | Evidence |
| --- | --- | --- | --- |
| `tests/art-pack-server.test.mjs` | 0 / 1 / 6 | 0 / 1 / 6 | Same dataset-binding rejection at the synthetic route-family case. |
| `tests/cache-resources-server.test.mjs` | 0 / 1 / 0 | 0 / 1 / 0 | Same assertion at line 29. |
| `tests/map-assets-server.test.mjs` | 0 / 1 / 0 | 0 / 1 / 0 | Entire test process terminates. The cgroup memory-kill counter rises from 1 to 3 across the two reruns; limit 16 GiB. |

The map file's termination prevents its individual cases from being reported,
so full-suite case totals are lower than a completed run of every file.
No tests were weakened or newly skipped. The full gate remains red due to these
START failures; resolving their test environment/resource setup is separate from
the progress-provider fixes. The private checkout has zero changed files.
