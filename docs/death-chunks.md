# Death chunks v1

A candidate receives an advisory skull when its single slowest priced added obligation exceeds the focused member's personal threshold. The default is 1,000 active person-hours. Equality does not cross the threshold. Skulls do not blacklist candidates or change roll probabilities.

## Ownership and prediction

The task worker evaluates the same collection and equipment pipeline for ordinary tasks and hypothetical unlocks. It reuses one complete baseline per revision/member, then calls `predictChunk` for each requested candidate. Obligations come from the focused member's own reachable map; connected partner territory can supply faster methods and item sources. Partner skills and completion never become the focused member's account progress.

Estimates inspect the full hypothetical result alongside the prediction delta. Presentation filters do not waive obligations. Unsupported work, missing training methods, unknown input costs and unresolved drop probabilities remain visible. A priced route is a planning scenario; an unpriced alternative can change which route is fastest.

## Personal settings

Settings are sparse overrides in `member.preferences`, validated through the existing preference command, state validation, backups and undo:

| Key | Default | Meaning |
| --- | --- | --- |
| `deathThresholdHours` | 1000 | Positive finite threshold, at most one billion active person-hours |
| `defaultSecondsPerKill` | 60 | Positive finite **placeholder**, at most 86,400 seconds; replace with measured session time |
| `monsterSecondsPerKill` | `{}` | Exact source monster names, including variants, mapped to effective seconds per kill |
| `showDeathChunks` | `true` | Show advisory skulls on the current personal candidates |

Effective seconds per kill include fighting, respawns, movement, looting, banking and resupply. They are not an intrinsic monster speed. The app does not infer unknown drop chances from rarity labels.

## Drop model

For one required drop with admitted composed numeric probability `p`, expected kills are `1 / p` and expected hours are `secondsPerKill / (3600 * p)`. The fastest priced permitted source wins. Probability evidence comes from the existing source engine and `rates.mjs`; nested table probabilities are already composed. Display reciprocals are never parsed as authoritative estimates.

The secondary 95% acquisition point is `ceil(log(0.05) / log1p(-p))` kills, with `p = 1` handled as one kill. This is a probability point, not a deadline or uncertainty range for session speed. Zero, opaque or unsupported probabilities produce an unknown estimate. An item available through an unpriced non-drop route keeps that alternative visible.

## Training model and coverage

The 21 KB catalogue under `app/data/training/` records 21 method rows, 18 with timing profiles, and 16 pinned Wiki provenance records with URLs, revision IDs, retrieval dates, assumptions and licence attribution. Its first scope is normal, oak and willow log methods for Woodcutting, Firemaking and Fletching. These cover gathering, solo bonfires, unstrung bows, shafts and stocks. Three ordinary line-fire rows retain sourced XP but have no timing data, so they remain unpriced. Each priced segment uses XP per action, processing time and consumed-log acquisition, including explicit handling assumptions. Current recipe facts take precedence over stale calculator entries after the July 2026 rebalance.

The route uses post-unlock reachable repeatable methods, including connected partner sources, and advances at method level breakpoints. Reachable training ceilings are never treated as account XP. Where no measured XP ledger exists, the estimate labels its starting-progress scenario; personally completed level tasks can provide a lower bound. Missing bootstrap routes remain unknown.

Quoted gathering rates depend on the guide's gear, level and interaction assumptions. The source guide has an obsolete warning following Woodcutting changes; its context profiles are scenario rates, not verified duo throughput. This version does not reproduce a full hatchet/success/banking simulator. An additional two seconds per log for handling is an explicit sensitivity assumption, not a sourced measurement. Gathering and processing are shown separately, and neither unlimited inventory nor free supplies is inferred from source availability. In particular, oak-only Fletching charges logs as well as the sourced 14.7 XP cutting action: the level-15 to 99 scenario is about 2,783 hours. It remains unknown from level 1 if no bootstrap recipe is reachable.

## Background scope and cache

`GET /api/death-estimates?memberId=...` estimates the union of the current roll pool and valid selected candidates. Adding `chunkId=...` requests one known surface chunk on demand. It never scans all locked chunks to draw markers. Worker snapshots and candidate estimates have bounded caches keyed by state revision and member; catalogue/rate data is fixed for the worker's lifetime. State changes invalidate browser estimates. Responses for another member or revision are ignored, and later worker revisions cancel unfinished older batches.

Death estimates run through the reliability scheduler in a separate worker started on first demand. The lane admits one active request and at most two queued snapshots, with a 120-second request deadline including compilation/queue time, independent restart backoff and request-ID cancellation after disconnect or supersession. The ordinary task lane retains its eight-slot queue and 30-second deadline. Full cold batches cannot block its worker. The worker yields after baseline computation and between candidates; an already-running synchronous stage finishes before cooperative cancellation. A hung stage remains subject to the lane deadline. Cancelled partial results never enter the scheduler cache. Duplicated resident definitions and per-lane caches are the memory cost of this isolation.

The map draws skulls on the pin canvas above imported icons when pins are present, and on the state canvas otherwise. Hover text keeps death estimates alongside personal annotations, partner travel and pin labels. The chunk panel shows the largest priced duty, obligation breakdown, drop 95% points, training routes, provenance and unknown work. Hiding markers leaves on-demand details available.

## Verification and later versions

Run `npm test` for the complete suite and `npm run benchmark:death` for full-definition synthetic maps with 136 and 113 owned chunks. The benchmark uses checked-in definitions and an isolated temporary HTTP store on an ephemeral port. It measures a cold `/api/tasks` request while each member's cold death batch is active, asserts that ordinary tasks finish first, checks warm HTTP cache hits, then closes both workers and removes the temporary store. It reads no private saves. Fixture geometry is realistic in size; it is not either player's live map.

October 7, 2026 measurement on this Windows machine, after removing unused Activity Info and Current BiS view calculations from hypothetical predictions:

| Fixture member | Owned chunks | Current candidates | Cold batch | Cached batch |
| --- | ---: | ---: | ---: | ---: |
| Synthetic Player 1 | 136 | 4 | 46.20 s | 109 ms |
| Synthetic Player 2 | 113 | 8 | 70.89 s | 132 ms |

Worker startup/compilation was 5.70 seconds for the 23,925-row registered catalogue. Cached batches performed no baseline or hypothetical evaluations. Cold latency remains substantial because each candidate still runs the full task and equipment eligibility pipeline; caches and background execution keep this work out of browser rendering, but users must wait for initial skulls. The in-memory benchmark's 20 ms main-thread heartbeat continued during worker computation, with a maximum gap of 991 ms including setup and state/message cloning. This is not a browser frame-rate measurement or a guarantee of subsecond HTTP response time. These fixtures produced no skulls, 13 priced added obligations in total, and 63 missing-data details; regression fixtures separately exercise large drop and oak-only deaths.

The original death-branch `npm test` run passed **549 tests, zero failed, skipped or cancelled**, in 22.57 seconds. The feature added 45 tests: 22 estimation, 7 settings, 6 worker/API, 9 UI/controller and 1 map-paint regression. Existing browser and state fixtures were updated for the new modules/settings. Its test temporary files stayed under that worktree's `.local/death-verification/tmp`; test servers and benchmark workers were closed.

### Reliability merge measurement — October 7, 2026

The merged benchmark uses the actual HTTP scheduler and the same retained definitions and 136/113-chunk synthetic geography. A synthetic note changes revision and the conservative fingerprint between standalone and concurrent measurements without changing eligibility; every measured normal request is a cache miss with a fresh worker baseline.

| Synthetic member / candidates | Standalone tasks HTTP | Tasks worker during batch | Tasks HTTP during batch | Cold death batch HTTP |
| --- | ---: | ---: | ---: | ---: |
| Player 1 / 4 | 9.92 s | 7.53 s | 14.70 s | 26.82 s |
| Player 2 / 8 | 11.49 s | 5.87 s | 13.42 s | 35.36 s |

Both normal requests completed while the death lane still had an active request. Neither waited for the full batch, and neither used the task response cache. Server-side request durations during contention were 11.23/9.16 seconds; the HTTP figures above include transfer and JSON parsing. Warm death responses took 25/30 ms. Server startup took 7.19 seconds and registered 23,925 catalogue rows. The main-thread heartbeat's maximum gap was 4.03 seconds, so this establishes worker isolation rather than subsecond HTTP or browser responsiveness. CPU contention and large task response cloning/serialization still add latency. The second worker also retains its own definitions and caches. These are synthetic observations, not personal-map or remote-device acceptance.

Final merged `npm test`: **671 passed, zero failed, skipped or cancelled**, in 69.67 seconds, including the Windows helper fixtures. Added integration coverage checks independent death/foreground dispatch, chunk-list coalescing, bounded startup admissions, disconnect and supersession cancellation, partial-cache exclusion, isolated startup/runtime failure, shutdown during startup, timed cached predictions, hidden BiS duties, and skulls above pins with combined tooltip evidence. The benchmark and tests closed their isolated servers/workers and removed temporary death stores; the live picker on port 8788 was not restarted.

Later versions can add measured personal XP and throughput, more training skills, tool and level dependent gathering, finite inventory/shop stock, prerequisites and cross-skill preparation, quantities and variable drop stacks, pet/pity systems and joint collection models. A global optimal route, total duo workload, automatic exclusion and membership progression remain outside v1.

## Changed files

| Area | Files |
| --- | --- |
| Estimation and data | `app/tasks/time-estimates.mjs`, `app/data/training/methods.f2p.json` |
| Personal settings | `app/core/death-settings.mjs`, `app/core/preferences.mjs`, `app/web/death-settings.mjs`, `app/web/settings-panel.mjs` |
| Background computation | `app/tasks/worker.mjs`, `app/server.mjs` |
| Map and details | `app/web/death-chunks.mjs`, `app/web/map.mjs`, `app/web/main.mjs`, `app/web/style.css` |
| Feature regressions | `tests/time-estimates.test.mjs`, `tests/death-settings.test.mjs`, `tests/death-worker.test.mjs`, `tests/death-ui.test.mjs` |
| Existing integration fixtures | `tests/map.test.mjs`, `tests/map-overlay.test.mjs`, `tests/state.test.mjs`, `tests/web-browser.test.mjs` |
| Documentation and benchmark | `README.md`, `docs/death-chunks.md`, `scripts/benchmark-death.mjs`, `package.json` |
