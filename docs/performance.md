# Page load and interaction performance

The [October 13 warmstart measurements](research/warmstart-2026-10-13.md)
separate early health, immediate cold calculations, quiet first use and worker
retirement memory. Early health responds while saves initialize; quiet startup
prepares both full task lists through the existing background queues.

The [October 13 idle-memory measurements](research/idle-memory-2026-10-13.md)
trace RSS that remained after worker exit. Windows calculators now run in owned
processes, with one collection after every lane retires. Immediate idle RSS is
3,381 → 614 MiB; after ten more idle minutes it is 973 → 616 MiB in the paired
copied-save run. Current compact and compressed full lists survive within their
existing quotas. The first unchanged compact list after idle is 7,346 → 88 ms,
without allocating a calculator. Startup is 2.77 s longer and sampled peak RSS
is 3.5% higher in this single pair; see the report for per-isolate counters,
accelerated retirement, GC pause and cache freshness limits.

## Speed merge verification — October 12, 2026

The resolved tree combines `claude/redesign` at `f49a3fc` with
`codex/speed` at `fd1186e`. Prepared owner/partner results, compressed caching,
foreground-first scheduling and early browser reads retain task dibs, Map
display, Roadmap and the More menu. Claim and display saves preserve the
prediction quiet window, task-input signatures and preparation requests.

Verification ran in this worktree. The real duo save was copied to
`.local/merge-save`, excluding `store.lock`; its state SHA-256 was
`c5f3a5744238d2f9d43355c3e49b40109823c9221d1419ee0611f25e1f14928d`.
Heavy commands and every browser run used `.local/with-heavy.ps1` and the
shared lock. Browser/server instances used disposable saves and ephemeral
loopback ports, excluding 8788–8791.

The targeted set passed **534/534**, with no failures or skips. An additional
permission/claim-server check passed **26/26** after the full suite caught a
missing explicit write permission for `/api/prediction-intent`. Final
`npm test` passed **2,723 of 2,724**, with zero failures or cancellations in
339.94 seconds. The sole skip checks generated skill-icon PNGs, which are
optional local assets absent from this worktree.

The exact oracle passed **138/138 with zero differences** on the final app.
The unchanged calculation engine is pinned to `395ceb0`; the input reader and
play/duo/sidebar projections are pinned to redesign `f49a3fc`, supporting the
current save's progress snapshots, claims and completion identities. Both
archives were materialized from verified Git blobs inside this worktree.
Only `elapsedMs` and `timingMs` are excluded; counters, ordering and all other
result/projection content remain exact. The final manifest is
`.local/perf/merge-compare-final/manifest.json`, with app/input fingerprint
`3af9ea85587ce992eea9a93307d9c156ea21dbd2e2cc1f83f88c18a385d1a346`.

The native browser harness measured chunk **7463**, three fresh-server runs
per cell, task settlement and complete-duo settlement with Group on. Prepared
runs wait for the actual Preview; unprepared runs assert cache misses. All
24 samples share the frozen save and browser-harness application fingerprint
`a2f6f422b0e8cf1f1e261b0de654890a197a75702d40832b4d3144456fb8bd45`.
Numbers are **median / nearest-rank p90 seconds** (p90 is the maximum at n=3):

| Player | Group | Prepared: speed → merge | Unprepared: speed → merge |
| --- | --- | --- | --- |
| Player 1 | Off | 0.30/0.37 → 0.34/0.35 | 2.48/2.70 → 2.50/2.76 |
| Player 1 | On | 0.32/0.32 → 0.27/0.48 **flag** | 3.33/3.38 → 3.68/3.69 |
| Player 2 | Off | 0.42/0.44 → 0.34/0.38 | 2.32/2.38 → 2.36/2.39 |
| Player 2 | On | 0.29/0.31 → 0.26/0.27 | 3.64/3.68 → 3.42/3.48 |

Every prepared sample settles under 0.5 seconds. The sole >15% flag is
Player 1/Group-on prepared p90, **+50.0%**; its median improves 16.4%. Both
players still have prepared hits and zero evaluation time in the slow sample.
Most extra delay precedes state adoption: command TTFB is 356.8 ms, compared
with 187.2/146.7 ms in the other runs. The trace does not establish the cause,
so the threshold breach remains an unresolved timing risk. Other cells stay
within 15% for both median and p90. Reports and source/sample checks are in
`.local/perf/merge-timing-summary.json` and the eight `merge-{prepared,unprepared}-*`
reports. These desktop localhost measurements do not establish public-device
latency.

The browser concurrency check passed with separate assigned Player 1 and Player 2
sessions. Player 1's prepared Unlock request was held until Player 2 claimed
“Obtain a Brawler's hook necklace” through his Group list. The stale Unlock
received one `409` with `claimOnlyChanges: true`, retried once, and returned
`200`. At final revision 102, both task responses have
`unlockPredictionHit: true` and `evaluationMs: 0`; both lists display Player 2's
claim, both tabs show “Saved”, and neither has a visible error. The evidence
and two captures are `merge-dibs-proof-2026-10-12T18-17-29-091Z-evidence.json`
and `merge-dibs-proof-{player1,player2}-2026-10-12T18-17-29-091Z.png` under
`.local/perf/`.

The race adapter checks exact final-revision responses. The ordinary harness
reports its first task milestone after a click, which can describe the
intermediate claim revision in this deliberately held two-save race; that
caused an initial false cache-miss assertion. The native one-save timing cells
above have no intermediate save. The app was unchanged during this diagnosis.
Every owned server/browser and scratch directory closed, the frozen save
remained byte-identical, and `.local/merge-save` was deleted after verification.

## Dibs second review — October 12

The previous recorded fixed-build medians were **984 ms reload**, **6,160 ms
Unlock**, and **3,720 MiB server RSS** (+5.5% against that earlier redesign
base). The second review merges `claude/redesign` at
`ac7e378b6681d3714c64c6fa2f6524d0000f22a6` and keeps the exact revision-97
snapshot, SHA-256 `8761c7e352db88b5e7fbf45995a5b1a2f6718d2868997315f7d6d803df8859c6`.

Five complete matched pairs compare the previous `a49238c` commit with the
repaired build. Three pairs run before/after; two run after/before. Every run
has its own disposable localhost server and Chrome profile, Group view,
complete-duo task settlement, and prediction warming off. Every reload hits
the task-result cache; every fresh Unlock misses it. Read-only game data and
map assets come from the main checkout.

| Check | Previous commit, remeasured | Second review | Change |
| --- | ---: | ---: | ---: |
| Reload tasks, median ms | 1,281 | 1,142 | −10.9% |
| Fresh Unlock tasks, median ms | 6,065 | 5,725 | −5.6% |
| Post-suite server RSS, median MiB | 3,696 | 3,600 | −2.6% |

Against the previously recorded numbers, the new medians are **+16.0% reload**,
**−7.1% Unlock**, and **−3.2% RSS**. The matched comparison meets the approximate
10% margin; the older reload number alone does not. This busy-desktop sample
has substantial timing variation: matched reloads range **959–6,508 ms** on
the unchanged previous commit and **1,038–3,321 ms** on the repaired build.
RSS remains a post-suite process sample, rather than a continuous peak.

The initial isolated three-run current batch measured **1,207 / 5,229 ms** and
**3,661 MiB**. The first three matched pairs measured **984 → 1,142 ms reload**
(+16.0%), **5,477 → 5,274 ms Unlock**, and **3,696 → 3,647 MiB RSS**. That reload
result triggered the reverse-order repeat, with no application changes between
batches. All five complete pairs are included in the final medians above.
The repeat's third after run is retained but unpaired: the next before run
was refused when another job occupied the benchmark slot. It is excluded by
the complete-pair rule, regardless of its result.

The reload trace places the first three-pair delay before startup API requests.
In pair 3, the last browser module completes **302.5 → 444.5 ms**; save adoption
is **461.4 → 621.9 ms**, while adoption-to-duo-tasks is **523.0 → 519.7 ms**.
Both builds request 84 application files and the exact same 585,108 decoded
save bytes. There are no extra module dependencies or pre-adoption long tasks;
Roadmap data remains lazy. These traces support repeating the baseline before
changing production startup code, but do not establish a universal device bound.

One earlier contended batch was closed after detecting other benchmark servers.
Its partial report is retained, excluded from the matched comparison, and its
owned server/browser/scratch directory were closed. The reports under
`.local/perf/` are `dibs-second-quiet-*`, `dibs-second-pair-{before,after}-*`,
`dibs-second-check-{before,after}-*`, and `dibs-second-final-*-partial.json`.
The concise final report is `.local/dibs-second-final-paired-summary.json`.
Previous app SHA-256 is
`94dcb217418dfc7a75664dd7d9c72e2435101da049ad82f4eae05fc971720678`;
repaired app SHA-256 is
`1605c3f0dfe80b4aa7822e3005794ee8b6139d53ff8062b3599095529bb0c4a0`.

Claim-only saves preserve an already scheduled prediction warm-up. Cleanup
does no archive reads, preparation hooks, backup or retention work. It adjusts
recent History and saves small private cancellation watermarks; actual Undo or
export later adjusts archived claim inverses. Frozen catalogue rows are shared
with their Map, and new saved tasks do not duplicate catalogue completion lists.
Task responses still await none of this work. The copied save and browser
scratch directories are removed after verification; [duo-task-view.md](duo-task-view.md)
records the desktop/390px captures and 265 ms partner update.

Final full `npm test -- --test-concurrency=1`: **2,582 passed**, zero failures,
cancellations or skips, **749.29 seconds**. All 246 application/reference files
match the measured repaired source hash. Prediction goldens, provenance hashing
and `.gitattributes` LF rules are unchanged. The private frozen save copy is deleted.

## Dibs review fixes — October 12

The comparison base is `claude/redesign` at
`2fda5bd3da51629443af03acc41197ef35afa9c5`, including Helper Progress and
view-only links. Both versions use the frozen revision-97 copy with state SHA-256
`8761c7e352db88b5e7fbf45995a5b1a2f6718d2868997315f7d6d803df8859c6`.
Runs use Group view, the complete-duo task milestone, task settlement, and
prediction warming off. Every reload is a result-cache hit and every fresh
Unlock a miss. One server and Chrome profile run at a time, then close.

Three alternating base/fixed pairs give these medians:

| Check | claude/redesign | Fixed dibs | Change |
| --- | ---: | ---: | ---: |
| Reload tasks, ms | 1,302 | 984 | −24.4% |
| Fresh Unlock tasks, ms | 5,928 | 6,160 | +3.9% |
| Post-suite server RSS, MiB | 3,526 | 3,720 | +5.5% |

These comparisons meet the approximately 10% regression margin. RSS is a
post-suite process sample, not a continuous peak. Fresh Unlock remains above
the existing three-second target. Localhost measurements do not establish
Player 2's device or internet timing.

The initial separate three-run batches measured 1,042 → 1,048 ms reload,
5,896 → 7,003 ms Unlock (+18.8%), and 3,578 → 3,673 MiB RSS. This triggered
the alternating repeat; no source changes were made between batches. Initial
Unlock ranges were 4,752–7,436 ms base and 6,185–7,947 ms fixed. In the paired
repeat they were 4,956–7,275 ms base and 5,097–6,830 ms fixed. Most timing
variation occurs in the existing calculation; the collection step takes
14–29 ms. All runs remain available, including the initial slower batch.

Reports under `.local/perf/` are `dibs-fix-before-2026-10-12T06-12-30-832Z`,
`dibs-fix-after-2026-10-12T06-22-57-262Z`, and
`dibs-fix-pair-{before,after}-{1,2,3}-*`. The concise paired report is
`.local/dibs-fix-paired-summary.json`. Base app SHA-256 is
`e4e9cb6145caae3bd9215e30bf11c3e6e3c301d35f531300d68aa7dba281f939`;
fixed app SHA-256 is
`94dcb217418dfc7a75664dd7d9c72e2435101da049ad82f4eae05fc971720678`.

Claims add no work to task-response delivery. The guarded cleanup test holds
its write indefinitely while task requests finish, then injects a failed write
and confirms later reads still work. With no claims, no claim projection is
parsed. Background checks use existing saved-result bytes, discard temporary
compact projections before writing, and retain no extra parsed full results.
No task worker work is added by a claim.

Full `npm test -- --test-concurrency=1`: **2,533 passed**, zero failures or
skips, 456.23 seconds. All 245 application/reference files match the measured
source hashes. Copied-save session, viewer, Undo, live and screenshot checks
are recorded in [duo-task-view.md](duo-task-view.md).

## Task dibs — October 12

Three before and three final repetitions use the same frozen revision-97 save
(SHA-256 `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`),
Group view, the complete-duo task milestone and task settlement. Prediction
warming is off to compare fresh Unlock calculations: every Unlock is a cache
miss, and every reload a cache hit. Each disposable localhost server and Chrome
profile runs alone and closes before the next one. Read-only game data and map
assets come from the main checkout.

| Check | Before | Final | Change |
| --- | ---: | ---: | ---: |
| Reload tasks, median ms | 1,373 | 1,461 | +6.4% |
| Fresh Unlock tasks, median ms | 9,041 | 9,643 | +6.7% |
| Post-suite server RSS, median MiB | 3,422 | 3,381 | −1.2% |

All measured changes meet the approximately 10% regression margin. RSS is a
process sample, not a continuous peak. The unchanged full-calculation Unlock
still exceeds the separate three-second target. These busy-desktop localhost
samples do not establish Player 2's device or internet timing.

An intermediate batch measured reload at 1,651 ms (+20.3%) and Unlock at
8,792 ms. Its claim-facts join parsed the entire play-state JSON, including large
History records, on task reads. The final join clones only the small fields it
needs, retains the existing thin duo projection and returns early on unchanged
reloads. Claims are excluded from worker snapshots and both task fingerprints;
claim saves and live notifications rebase existing browser task results. The
copied-save claim check observes zero additional task requests and **891 ms**
from a Player 2 invite command starting to his badge appearing in Player 1's browser.

Reports under `.local/perf/` retain each repetition, fixture and source hashes:

- `dibs-before-2026-10-12T03-54-43-299Z`: archived base
  `5d4c3697aed810cdce1a9fbe877ca2c4fda08e12`, app SHA-256
  `dba46c489b6445f25188e2680c590c300ebfaa38c44ff56773521de17d03c6c8`.
- `dibs-after-2026-10-12T04-14-42-043Z`: intermediate join, app SHA-256
  `548d6a08557790a3fa02adc7224dc6af4c90c554f7032412cbd9accfb4fc51ba`.
- `dibs-final-2026-10-12T04-22-13-207Z`: small join, app SHA-256
  `9a34630ff2a6a6ad500978a0118679e2a8f5a0184ccce7dcd1da16a52e256bf2`.
- `dibs-complete-2026-10-12T05-25-06-172Z`: complete final code, app SHA-256
  `77f05adb9133a896eaac037c8aad06cbfa7f026ba00ff72d4d248ee8805a46c2`.

The earlier small-join batch measured 1,426 ms reload, 7,610 ms Unlock and
3,573 MiB RSS. The complete batch above includes the minute clock, personal
completion display, deterministic cleanup, Undo and live-admission guards.
Its individual reloads are 1,960 / 1,461 / 1,236 ms; Unlock is
12,271 / 9,643 / 8,251 ms. All samples are retained in the medians despite the
busy desktop variation. Focused tests cover restart, later preferences,
takeovers, older Undo and the 15-second warm admission gate; a claim neither
recalculates tasks nor starts predictions.
Full `npm test -- --test-concurrency=1`: **2,384 passed**, zero failures or skips,
643.44 seconds. Prediction goldens and provenance data are unchanged. Browser evidence and both
players' before/after identity checks are in [duo-task-view.md](duo-task-view.md).

## Backup screen merge — October 12

The backup hooks now use `screen-context`, `screen-startup`, `screen-dialogs`
and `screen-controls`; `main.mjs` remains the 34-line composition file. The
calculation and backup/watchdog code is unchanged from `58351fb`.

Three-run comparisons use the frozen revision-97 save, personal view and task
settlement. With prediction warming off on both temporary servers, task medians
were reload 2,717 → 1,549 ms, Player 2 8,108 → 5,811 ms and Player 1 701 → 472 ms.
These controlled timings meet the approximately 10% band; server RSS at
readiness/after was 1,376 / 2,315 → 1,378 / 2,138 MiB (+0.1% / -7.6%).

Normal warming remains a separate, unconfirmed timing gate on the busy host:
the first baseline was 1,938 / 5,902 / 1,828 ms, its repeat 2,929 / 6,365 / 424 ms,
and the merged build 3,331 / 8,793 / 1,403 ms (reload / Player 2 / Player 1). A host CPU
sample reached 100%, with 7.9 GiB free of 31.95 GiB. Normal RSS medians were
1,378 / 2,738 → 1,384 / 2,766 MiB (+0.4% / +1.0%). All five batches and every
repetition are retained; none had failed requests. These observations do not
establish a causal speedup or slowdown, and normal warming needs a quiet-host
recheck before claiming that timing gate passes. Unlock, Group view and
throttled-network timing were outside this merge check.

Full `npm test`: 2,357 tests, 2,356 passed, zero failed/cancelled, one existing
generated-PNG check skipped, 606.88 seconds. Detailed source hashes and local
report paths are in the [backup review](research/backups-watchdog-2026-10-11.md#main-screen-merge--october-12).

The [October 11 backup and watchdog review](research/backups-watchdog-2026-10-11.md)
compares three candidate and three quiet-baseline runs on the same copied
revision-97 save, with normal prewarming, personal view and task settlement.
Task medians were reload 1,004 → 911 ms, Player 2 switch 4,985 → 4,682 ms and Player 1
switch 419 → 380 ms. All selected timings meet the approximately 10% regression
gate. Server RSS at readiness/after was 1,368 / 2,495 → 1,436 / 2,489 MiB
(+5.0% / -0.2%). The review retains an earlier busy baseline separately, plus
source hashes, all repetitions, copied-save preservation and desktop/390px
captures. Host load varied; the timing differences do not establish a speedup
caused by this change. Unlock, complete Group view and throttled-network timing
were not part of this comparison.

## Helper Progress — October 12

Progress is lazy and reads counts directly from the saved state, without a task
evaluation, worker or resident cache. Numeric daily tuples stay outside map
responses, calculation snapshots and gameplay fingerprints. The copied save's
first daily row is **165 bytes**; 3,660 duo rows are tested below 400 KB. Unchanged
same-day counts do not rewrite the state or observation timestamp on restart.

`npm run perf` compared archived `441b835ae040f919141fc979ad7749b7c129f3f9`
with the Progress candidate. Both used frozen revision 97, personal view,
prewarming off, `--scenarios cold,reload,unlock --settlement tasks`, two separate
server/Chrome repetitions per version, run serially. Game/map assets were read
only from the main checkout. Node was 24.20.0 and Chrome 154.0.8037.98. Helper
stayed closed in these scenarios. Median milliseconds:

| Check | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cold: tasks and visible terrain ready | 10,938 | 10,547 | -3.6% |
| Reload: tasks and visible terrain ready | 2,842 | 2,927 | +3.0% |
| Uncached Unlock: tasks ready | 8,042 | 7,257 | -9.8% |
| Sampled readiness RSS, MiB | 1,392 | 1,366 | -1.9% |
| Sampled post-suite RSS, MiB | 2,386 | 2,623 | +9.97% |

All measured readiness and sampled RSS comparisons are within the approximately
10% regression band; post-suite RSS is near its upper edge. These are localhost
observations on the everyday desktop, not a causal speedup claim. RSS samples
are neither continuous peaks nor idle-memory measurements. The uncached Unlock
three-second target remains unmet. No phone hardware, public-network or
Helper-open memory benchmark is claimed.

Provenance and ignored evidence:

- Frozen state SHA-256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Before app manifest: `270dda46d35af8a55b84555ffa8cd167c0d45aeceee3ad3a0221f0ae5caa76db`.
- Measured candidate app manifest: `e31710dd0151fa163eb03ed602406d84ff9d317b6827e4e1c798dd1ff03ef2f8`.
- Reports: `.local/perf/progress-before-2026-10-12T04-50-50-464Z.{json,md}`
  and `.local/perf/progress-after-2026-10-12T05-10-19-041Z.{json,md}`.
  `.local/progress-perf-summary.json` retains aggregation inputs.
- Post-measurement polish changes the lazy Helper stylesheet: numeric alignment,
  narrow table padding/wrapping and SVG label size. It was not requested by these
  closed-Helper scenarios. A trailing blank line was also removed from the new
  snapshot validator; backend behaviour and task inputs match the measured
  version. The source manifests retain every individual file hash.
- `.local/progress-browser-report.json` records both players and duo totals,
  six dark/gray/light captures at 1440px and 390px, zero page overflow, numeric
  alignment and rendered chart text of at least 12px, no browser exceptions,
  no save commands, unchanged gameplay hash/revision, and the portable daily row.

The first full test run found an unnecessary same-day snapshot timestamp write
on restart. That was fixed and covered by a same-count no-write regression.
Prediction goldens, reference-data hashes and `.gitattributes` are unchanged.

Final serial `npm test`: 2,400 tests, 2,399 passed, zero failures/cancellations,
one existing generated-PNG skip (752.30s). Owned scratch servers and Chrome
processes are closed; private save copies and archived source have been removed.


## Viewer links — October 12

Viewer links cannot submit writes, fresh task calculations, predictions or
RuneMetrics reviews. They read results a player already loaded, including after
the calculator sleeps. Retention has separate 32 MiB compact-list and 16 MiB
compressed-detail limits. Both copied-save lists use 8,960,022 bytes and both
full details use 10,263,247 bytes, rather than retaining two roughly 58 MB full
JSON buffers. Uncompressed full reads stream inflation; ordinary browsers read
one retained gzip stream. Display-only saves update a revision header without
recompressing the details or waking a worker.

Three baseline and three candidate repetitions ran serially on the same frozen
revision-97 save, Node 24.20.0 and Chrome 154.0.8037.98. Both batches use
`--scenarios cold,reload,switch-player2,switch-player1,unlock --settlement tasks
--prewarm off`, personal view, default worker lifetime and the same read-only
game/map assets. These are editor workflows, checking that player performance
does not regress. Median task milestones are milliseconds.

| Check | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cold load | 11,653 | 8,470 | -27.3% |
| Reload | 3,074 | 1,475 | -52.0% |
| Switch to Player 2 | 7,345 | 5,679 | -22.7% |
| Switch to Player 1 | 871 | 438 | -49.7% |
| Unlock | 12,402 | 6,638 | -46.5% |

All five task timings pass the approximately 10% regression gate. Server RSS
at readiness is 1,388 → 1,369 MiB; post-suite RSS is 2,654 → 2,687 MiB (+1.3%).
These are process samples, not continuous peaks. The everyday host was busy;
the timing differences do not establish a causal speedup. The small visible-tile
milestone on the cached Player 1 switch changed from 44 to 55 ms, about one frame;
its task milestone improved. Unlock still exceeds the separate three-second
target. No prediction goldens or `.gitattributes` rules changed.

The real-browser viewer check used a five-second worker idle interval to verify
sleeping reads, separately from the performance batches. It opened task details,
Edgeville (12342)'s saved note, History and Activity Info; changed local theme,
chunk IDs and map selection; and revoked the temporary viewer. The calculator
stayed asleep with unchanged request counters, zero browser writes, zero costly
viewer requests and no JavaScript errors. Desktop gray (1440×900) and 390px light
(390×844) have no horizontal overflow. The viewer can inspect task labels after
both lists settle; their disabled ticks remain visible.

The copied save stays at revision 97: Player 1 158 unlocked / 1,650 possible /
25 active tasks before and after; Player 2 114 / 1,626 / 26. Examples remain Player 1's
gravite melee weapon and anchovy pizza, and Player 2's gravite magic and ranged
weapons. Both notes, selected chunks and personal completion records are
unchanged. Funnel-origin headers, Secure cookies, refusal and revocation are
covered by localhost proxy fixtures. The live picker and public network path
were not changed or used for acceptance.

Final `npm test -- --test-concurrency=1`: 2,365 passed, zero failed, one optional
generated-PNG asset check skipped (`SKILL_ICON_ASSET_ROOT` unset), 2,366 total
in 750.3 seconds. Focused viewer/browser checks passed 140/140, Windows launcher
checks 5/5, and player-loading/privacy compatibility checks 18/18. Imported
alias notes remain readable; current selected-player tasks can open while the
other list is waiting, with stale views disabled.

The copied gameplay directory, baseline archive and disposable browser profiles
were removed. All owned browser, picker and performance processes were stopped;
the ignored screenshots and measurement reports remain available.

Provenance and ignored artifacts:

- Frozen state SHA-256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Baseline commit `5d4c3697aed810cdce1a9fbe877ca2c4fda08e12`; app SHA-256 `dba46c489b6445f25188e2680c590c300ebfaa38c44ff56773521de17d03c6c8`.
- Candidate app SHA-256 `70bd9393bd919809d79a2f889499750559ec4014da0b64f2127150c0dd369e40`; the harness verifies source unchanged across each batch.
- Performance JSON/Markdown pairs: `.local/perf/viewer-before-2026-10-12T03-54-43-397Z` and `.local/perf/viewer-complete-2026-10-12T05-12-24-767Z`.
- Browser evidence: `.local/check/viewer-checks.json`, `viewer-desktop-gray.png`, `viewer-mobile-390px-light.png`.
## Saved Unlock preparation — October 12, 2026

**Prepared Unlock settles both players in under one second. Fresh Unlock still
needs faster calculation.** Predictions now finish the owner's complete result
and then the partner's result for the same post-unlock save. Opening a locked
chunk or receiving a roll starts quiet preparation on the existing prediction
worker. Saved task reads run ahead of obsolete planning/detail/death work;
matching save notifications start selected and, with Group on, peer reads while
the write acknowledgement arrives. No newly fetched task rows publish before
the acknowledgement is adopted.

The comparison pins baseline `395ceb0` and scheduler checkpoint `103f53f`, with
the unchanged calculation code. Each cell has three fresh localhost
server/browser suites, run serially under the shared heavy-process lock with
the same revision-97 frozen save and read-only game/map assets. `npm run perf`
uses `scripts/perf/page-load.mjs`; the retained batches invoked that entry directly.
Settlement is the complete task list, including both players with Group on.
Preview preparation and the three-second panel dwell are outside the Unlock
clock. Corresponding before/after runs match all three chosen chunk IDs. Times
are **median / p90 seconds, before → after**:

| Player | Group | After Preview | Immediate unprepared | Panel open for 3 seconds |
| --- | --- | --- | --- | --- |
| Player 1 | Off | 1.63 / 2.08 → 0.38 / 0.46 | 7.30 / 7.47 → 5.13 / 6.43 | 6.59 / 6.92 → 4.13 / 5.21 |
| Player 1 | On | 7.53 / 7.99 → 0.31 / 0.31 | 7.78 / 8.32 → 3.93 / 4.62 | 9.74 / 12.70 → 5.47 / 5.64 |
| Player 2 | Off | 1.37 / 7.08 → 0.49 / 0.59 | 5.09 / 5.19 → 3.67 / 4.03 | 5.62 / 5.97 → 5.80 / 6.36 |
| Player 2 | On | 4.37 / 4.58 → 0.42 / 0.45 | 6.75 / 6.95 → 5.54 / 5.90 | 7.08 / 8.31 → 6.33 / 6.46 |

Prepared selected-player hits are 3/3 in all four cells, and prepared Group peer
hits are 3/3 in both Group cells. Immediate and dwell runs have zero hits for
either player: three seconds did not finish preparation on this calculation
checkpoint. No median regressed beyond 10%; Player 2's personal dwell median rose
3.3%. Three repetitions on the busy everyday desktop describe these observations,
not a statistical guarantee or the untested combination with the engine job.

Across 36 runs per source, ready RSS median/p90/max is
1,378.74/1,439.48/1,451.55 → 1,435.04/1,438.48/1,446.49 MiB; after-task RSS is
3,699.85/4,576.83/4,747.62 → 2,830.77/3,949.76/4,088.09 MiB. These are snapshots,
not continuous peaks. One additional Group warm probe per source sampled after
60 seconds without interaction: RSS 4,733.37 → 4,940.37 MiB (+4.4%), and after a
task-settled reload 4,847.73 → 5,074.06 MiB. Both prediction queues were still
active; this does not establish quiescent idle memory or full-pool completion.

The 32 MiB prediction allowance remains bounded: 16 MiB for Preview responses
and 16 MiB for compressed reusable task projections, each with at most 256
entries. The Unlock matrix retained at most 1,440,328 compressed bytes for a
complete pair (11,331,741 bytes of equivalent raw JSON). The warm probe retained
five pairs / ten member entries: 7,210,329 compressed bytes, equivalent to
56,678,455 raw bytes, plus 49,788 bytes of Preview responses. The raw totals are
logical sizes, not retained raw copies. Completed owner/partner pairs are
admitted and evicted together; explicit choices take priority over pool warming. The
whole pool need not fit simultaneously in the quota. Owner-then-partner order
leaves each finished candidate fully prepared before work moves to another.

Read-only save checks matched 24 complete prepared/fresh projections across
both players and all three views, ignoring only elapsed time. Burthorpe (11575)
changes Player 1's Possible Tasks 1,650 → 1,657, Player 2's 1,626 → 1,626. Anya's Tent
(17201) changes Player 2's 1,626 → 1,627, Player 1's 1,650 → 1,650. Abbey of St. Elspeth
Citharede (13617) changes Player 1's 1,650 → 1,666 and active tasks 25 → 31,
including One Piercing Note and Wiggle Room; Player 2 stays at 1,626 possible / 26
active while 195 complete task rows change. Partner ownership/progress and the
frozen source remain unchanged. Exact signatures authorize reuse; every miss
still runs a complete fixed-point calculation.

The second permitted full `npm test` run passed at `feb2f77`: 2,379 tests,
2,378 passed, one generated-PNG check skipped, no failures/cancellations,
357.75 seconds. Later advisory-retirement and browser handoff changes passed
123 scheduler/reuse/lifecycle checks, 35 server checks and 191 browser/harness
checks (349 total), plus the final browser matrix and frozen-save checks.
The two-full-run cap was retained, so a full suite at `103f53f` remains unrun.
Prediction goldens, `.gitattributes`, `main.mjs` and the calculation modules are
unchanged. No screenshots or changelog were required for this job.

Remaining limits: fresh and three-second dwell Unlock still exceed one second;
active ordinary selected/peer calculation is synchronous and cannot be
preempted, although queued obsolete work and side work are isolated. A later
uncached save can still wait behind that active selected-player pass. Combining
these changes with the separate calculation job requires fresh validation.

Retained provenance (older/partial candidate checkpoints are excluded):

- Frozen state SHA256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Baseline app/reference manifest SHA256: `dba46c489b6445f25188e2680c590c300ebfaa38c44ff56773521de17d03c6c8`.
- Final app/reference manifest SHA256: `509cf734da2a19638ffa321c0d025d6f9cf953e3159532c3cfc147fa081eed60`.
- `.local/sched-results.json` SHA256: `c8da4c9d3ed5e7a9b20240b0567188efb9972b5be09962f470f303d769f9e9a9`.
- `.local/sched-latest-table.md` and `.local/sched-final-table.md` retain per-cell report paths and hashes; JSON/waterfalls remain under `.local/perf/`.
- Warm reports: `sched-pool-memory-before-2026-10-12T10-46-27-269Z` / `sched-pool-memory-after-2026-10-12T10-48-25-287Z` in `.local/perf/`.
- Exact checks: `.local/check/sched-pair-default.json` / `.local/check/sched-pair-13617.json`; full/focused test logs remain under `.local/`.

## Main screen split — October 12

The F5 refactor reduces `main.mjs` from 1,471 to 34 lines without changing
screen functions, text, styles, calculation code or cache limits. An independent
normalized-source review matched all 96 non-start functions, initial values and
startup with its extracted control bindings inlined. Browser harnesses follow
the screen import graph; the two scripts that read main-screen functions also
follow the new layout.

All batches use the same frozen revision-97 save, Node 24.20.0, Chrome
154.0.8037.98, personal view and task settlement. Each batch has three separate
localhost servers and browser profiles, run serially. Game data and map assets
are read only from the main checkout. Times below are median milliseconds.

| Check | Before | After | Change |
| --- | ---: | ---: | ---: |
| Normal reload, repeated baseline | 2,315 | 1,128 | -51.3% |
| Normal switch to Player 2, repeated baseline | 5,453 | 5,420 | -0.6% |
| Normal switch to Player 1, repeated baseline | 412 | 416 | +1.1% |
| Controlled fresh Unlock, prediction warming off | 6,081 | 5,340 | -12.2% |

These matching-work comparisons stay inside the approximately 10% band.
Controlled fresh Unlock has zero result-cache hits and positive calculation
time in every repetition on both versions. Its post-suite server RSS is
2,372 → 2,556 MiB (+7.8%); readiness RSS is 1,377 → 1,438 MiB (+4.4%).
Normal post-suite RSS is 3,691 → 3,762 MiB (+1.9%) against the repeated baseline.
These are process samples, not continuous peaks or idle memory.

Normal Unlock remains cache-dependent and does **not** establish a 10% timing
gate: the original baseline is 5,456 ms with two cache hits, the repeated
baseline is 7,626 ms with one hit, and the after batch is 9,071 ms with no hits.
The raw increases are 66.2% and 19.0%, respectively. All runs are retained;
the warming-off comparison isolates fresh work without changing application
settings or production scheduling. The busy everyday host and different reuse
rates prevent a causal speedup or slowdown claim. Unlock still exceeds the
separate three-second target.

The copied-save browser checks cover desktop gray and 390px light, both players,
Roll 2, unlock, Undo, Group view, task filters, Teleports and Settings. Player 1's
Burthorpe (11575) unlock and Player 2's 11834 unlock were undone. Ownership and task
rows return to Player 1 158 unlocked / 1,650 possible / 25 active and Player 2
114 / 1,626 / 26. Examples remain Player 1's gravite melee weapon and anchovy pizza,
and Player 2's gravite magic and ranged weapons. No JavaScript console errors were
observed. Expected HTTP 409 rejections of superseded task, chunk-planning and
death-estimate reads are retained separately from errors. The temporary checker
was corrected for display-only saves and Search's separate View buttons;
completed checks were reused, with the remaining checks run on a fresh copy.

Full `npm test`: 2,331 tests, 2,330 passed, zero failed/cancelled, one existing
generated-PNG check skipped, 1,055.21 seconds. Prediction goldens and
`.gitattributes` are unchanged. No changelog entry: nothing visible changed.

Provenance and ignored artifacts:

- Frozen state SHA-256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Archived base `d229b032a5c80ec331498a5979e7c316f5d1e7a3`; app SHA-256 `ac2441e553d47dbee450689ca9e1e0092a022719085250be5aaa948e0de7a8fb`.
- Measured refactor app SHA-256 `dba46c489b6445f25188e2680c590c300ebfaa38c44ff56773521de17d03c6c8`; captured before committing, with source verified unchanged after each batch.
- JSON/Markdown pairs under `.local/perf/`: `split-before-2026-10-12T02-57-06-817Z`, `split-after-2026-10-12T03-31-10-751Z`, `split-before-paired-2026-10-12T03-36-02-597Z`, `split-fresh-before-2026-10-12T03-39-47-740Z`, `split-fresh-after-2026-10-12T03-41-25-930Z`.
- Browser evidence: `.local/check/browser-checks.json`, `desktop-gray.png` (1440×900), `mobile-390px-light.png` (390×844), both DPR 1.

All owned servers and browsers are closed and private save copies are removed.
The live picker, Tailscale and main checkout were not changed.
## Helper — October 12

Helper adds a lazy read-only page, without another resident worker or data cache.
The normal map loads its small shell; section code, charts, catalogue and drop
options load only when opened. Closing clears requests, temporary drafts, drop
rows, plans and the visible-result reference. Graphs read the existing task result.
The compact task response now retains small numeric cross-skill requirements.

`npm run perf` compared archived base `d229b032a5c80ec331498a5979e7c316f5d1e7a3`
with the Helper candidate, using the same frozen save, read-only game/map assets,
Node 24.20.0 and Chrome 154.0.8037.98. Runs used personal view, prewarming off,
`--scenarios cold,reload,unlock --settlement tasks`, 1440×900 DPR 1, 30 Mbps and
40ms simulated latency. Servers and browser profiles ran serially and closed
between runs. These are localhost measurements on a busy everyday desktop;
they do not establish a speedup or cover default Group/prewarming behavior.

The first three-run batches had task medians **9,125 → 10,628ms cold**,
**1,601 → 2,880ms reload** and **7,607 → 8,312ms Unlock**. Cold/reload exceeded
the 10% gate in that batch. Reload request TTFB changed **442 → 472ms**; much of
the wall-time difference occurred after the request. No task evaluation logic
changed. To check host/order variation, the repeat order was fixed before running:
**before A, after A, after B, before B**, one fresh server/profile per suite.
Every repetition, including the early slower results, is retained.

Counterbalanced medians (two runs per variant), in milliseconds:

| Milestone | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cold: tasks and visible terrain ready | 9,945 | 6,986 | -29.8% |
| Reload: tasks and visible terrain ready | 2,389 | 2,381 | -0.3% |
| Unlock: tasks ready | 7,992 | 7,256 | -9.2% |
| Reload: tasks shown | 1,442 | 1,075 | -25.4% |
| Sampled server RSS after, MiB | 2,457 | 2,383 | -3.0% |

Readiness is the later of task rendering and visible terrain loading, calculated
per run before taking its median. All three repeated readiness comparisons and
sampled RSS stay within the approximately 10% regression limit. Transfer bytes
increase **0.3% cold**, **1.3% reload** and **1.2% Unlock**. The uncached Unlock
three-second target remains unmet. No phone hardware or Helper-open memory
benchmark is claimed; responsive screenshots are separate browser checks.

Provenance retained in every report:

- Frozen state SHA-256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Archived base app manifest: `ac2441e553d47dbee450689ca9e1e0092a022719085250be5aaa948e0de7a8fb`;
  server entry: `0513eb230e9502a8e157bdf52ff9d07b7e8eaa01df6ea8a2b4e2f9a28332feac`.
- Measured candidate app manifest: `f173267dc0fd30434f6187efd91ec5eabc2c828833ab7e3480dd06d9a7cb4007`;
  server entry: `954d0f9f6931d889e9b5ec5df7e4bfb51b87c1ec704697920303be01f687708c`.
  Later fixes affect only lazy Helper goal text, input drafts and target refresh;
  they are not exercised by these closed-Helper scenarios. The server/task changes
  are the measured version. Reports include individual file hashes.
- Initial batches: `.local/perf/helper-before-off-2026-10-12T03-23-08-008Z.{json,md}`
  and `.local/perf/helper-after-off-2026-10-12T03-26-59-445Z.{json,md}`.
- Repeat reports: `.local/perf/helper-paired-before-a-2026-10-12T03-31-42-086Z.{json,md}`,
  `helper-paired-after-a-2026-10-12T03-32-29-936Z.{json,md}`,
  `helper-paired-after-b-2026-10-12T03-33-25-076Z.{json,md}` and
  `helper-paired-before-b-2026-10-12T03-35-04-441Z.{json,md}`.
  `.local/helper-perf-summary.json` retains the aggregation.

An initial Group/prewarming-on baseline timed out waiting for cold readiness;
its incomplete result remains in
`.local/perf/helper-before-2026-10-12T02-50-46-976Z-partial.json` and is not a
completed baseline comparison. Prediction goldens, reference-data provenance
hashes and `.gitattributes` are unchanged. [helper.md](helper.md) records the
read-only copied-save checks and desktop/390px captures.

Final serial `npm test`: 2,379 tests, 2,378 passed, zero failed/cancelled and one
existing generated-PNG check skipped (773.68s). Owned scratch servers and browser
processes closed; the private save copy and archived base source were removed.
Ignored reports, source hashes and screenshots remain in this worktree.

The [October 10 partner-access review](research/partner-obligation-leak-2026-10-10.md)
leaves task/access runtime unchanged. Its single-repetition prewarming-off check
completed all five scenarios; it also retains the default run's death-estimate
504 and the retry's 115-second Player 2 advisory request. These are observations of
existing costs, without a before/after performance claim.

The [October 10 duo coordination review](research/duonow-2026-10-10.md) compares
three baseline and three candidate runs on the same frozen revision-97 save.
Normal prewarming stayed on, group view was off and settlement waited for tasks.
Task medians in milliseconds were cold 10,874 → 7,476, reload 2,545 → 1,146,
Player 2 switch 7,480 → 5,025, Player 1 switch 547 → 444 and Unlock 7,871 → 5,150.
All five task medians meet the approximately 10% regression gate. Server RSS after
the run was 3,898 → 3,842 MiB. Unlock remains above the separate 3-second target.
The review retains every run, source fingerprints, small paint variations and
the desktop/390px browser checks; the everyday host was busy, so the timing
differences do not establish a causal speedup.

## Active Task filters — October 10

The display-only filters compare archived base `7d69492` with clean candidate
`6497b41`. Each personal/Group batch has three fresh localhost servers and browser
profiles, run serially with no test suite alongside them. Both sides use Node
24.20.0, Chrome 154.0.8037.97, normal advisory prewarming, the same frozen save,
and `--scenarios reload,unlock --settlement tasks`. The selected gate compares
Reload and Unlock task milestones. Times below are median milliseconds.

| View / task milestone | Before | After | Change |
| --- | ---: | ---: | ---: |
| Personal reload | 2,251 | 1,336 | -40.6% |
| Personal Unlock → tasks | 8,455 | 7,772 | -8.1% |
| Group reload | 1,259 | 1,025 | -18.6% |
| Group Unlock → tasks | 7,648 | 6,942 | -9.2% |

All four selected medians meet the 10% regression gate. The after reloads meet
the two-second target; Unlock remains above the three-second target. Individual
personal reloads are 1,205 / 1,336 / 4,272 ms and Group reloads are
1,022 / 1,025 / 2,551 ms. All repetitions, including the slower ones, remain in
the reports. Candidate workflows have zero failed requests or visible tiles.
These headless localhost results describe the measured desktop.

Median server RSS at readiness/after is 1,437 / 3,091 → 1,378 / 3,090 MiB for
personal view and 1,367 / 4,229 → 1,378 / 4,183 MiB for Group view. Median worst
reload browser long tasks are 161 → 174 ms personal and 164 → 168 ms Group.
Folded categories avoid constructing their rows; open categories paint 70 rows
before Show more. Debounced searches reuse the selected duo rows, and saved-pin
indexes avoid scanning favorites for every row.

The baseline app comes from `git archive 7d69492`, selected with
`--server-entry .local/perf-fixtures/baseline/app/server.mjs`. The baseline
reports' dirty flag belongs to the measurement worktree, whose filter edits
were in progress; the measured app came from the pinned base. Candidate reports
record the clean implementation commit. Both inputs retain state SHA-256
`7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
Server-entry SHA-256 is
`5917dfac730efcc0f11cc63daab629164533c2412ae43866a3ae02ba17334edd` before and
`95d25e9f5260c59fc0671f883a8436b61f0cc8d7bd295b5cceb0be991e15acb7` after.
The source copy is hash checked, all scratch processes and profiles are closed,
and the frozen save copy is deleted after verification. Game data and map assets
are read only from the main checkout. Prediction goldens are unchanged.

Reports retain all per-run startup, request, tile and long-task measurements:

- `.local/perf/taskfilters-before-off-2026-10-10T05-16-10-871Z.{json,md}`
- `.local/perf/taskfilters-after-off-2026-10-10T05-46-43-080Z.{json,md}`
- `.local/perf/taskfilters-before-on-2026-10-10T05-21-15-293Z.{json,md}`
- `.local/perf/taskfilters-after-on-2026-10-10T05-49-54-557Z.{json,md}`

An initial baseline startup failure has no completed measurements and remains in
`.local/perf/taskfilters-before-off-2026-10-10T05-10-30-546Z-partial.json`.
The [filter verification](private/task-filters.md#verification) records copied-save
identity parity, the 2,252-test full pass, and desktop/390px captures.

The [October 9 data-accuracy review](research/data-accuracy-2026-10-09.md)
records paired deployed-main and candidate browser measurements for the skill
milestone, War's Retreat, transport and icon corrections, using the same frozen
save and three repetitions per batch. It retains every completed timing batch,
including slower measurements and the final deferred icon-painting comparison.

The [Achievement rule review](research/achievement-rules-2026-10-09.md) compares
deployed `2930ca8` with `a780dcb` on the same revision-50 copied save. Each batch
uses three fresh servers/browser profiles on ephemeral localhost ports, with
read-only game data and map assets. Tasks-shown medians in milliseconds:

| Scenario | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cold first tasks | 7,097 | 5,826 | -17.9% |
| Reload tasks | 1,297 | 881 | -32.1% |
| Switch to Player 2 | 5,535 | 3,030 | -45.3% |
| Switch to Player 1 | 301 | 293 | -2.7% |
| Unlock to refreshed tasks | 3,271 | 2,995 | -8.4% |

None of these task milestones regresses beyond 10%. Individual after Unlock
runs are 2,995 / 2,773 / 3,621 ms; the median meets the 3-second target.
Worst main-thread long-task medians are 125 ms cold and 114 ms on reload,
compared with 157 / 181 ms before. Network idle includes background death and
prediction advisories and is measured separately from refreshed tasks.
The reports retain every repetition at
`.local/perf/achievement-before-2026-10-09T22-41-32-522Z.json` and
`.local/perf/achievement-after-2026-10-09T22-59-18-814Z.json`.
A subsequent validation-order guard only changes malformed Any values; the
measured save contains valid booleans and performs the same eligibility and
dependency evaluation. Later changes also simplify explanatory rule notes.
These are headless localhost measurements, rather than real phone/Funnel timings.

The [processing performance repair](research/switchover-processing-performance-2026-10-09.md)
retains `4a8020a`'s source eligibility while removing repeated full engine replay.
Same-save final medians were **2.27s** for first tasks, **2.03s** for the Unlock
command and refreshed tasks, and **8.81s** for a cold pool prediction,
compared with **10.23s / 9.71s / 23.56s** for the regressed commit.
Engine evaluation is within 10% of deployed `bcfd9a3` in all three cases.
The browser reload benchmark shows tasks in **0.699s**; full output parity
matches on both maps before and after the test Unlock. The report separates
request latency, engine/worker timing and warm browser rendering.

The subsequent [first-visit terrain measurements](terrain-performance.md) use
the deployed `e9183dc` application as their paired baseline and a frozen save.
They isolate terrain tiles, the legacy world image, sprites/pins, icons and
interiors, and document the offline WebP overview bundle and its installation.

The measurement harness is separate from `npm test`:

```powershell
npm run perf -- --runs 3 --label baseline
```

It requires Node 24 and Chrome. See [the harness instructions](../scripts/perf/README.md)
for options and metric definitions. Reports contain medians and every individual
run as JSON, plus a Markdown table, under ignored `.local/perf/`.

Each repetition copies the same private save into a disposable folder within this
worktree, removes its lock and invitation sidecar, and starts its own loopback
server and headless browser profile. Authentication uses a new scratch credential.
The harness checks the source snapshot hash before and after copying and between
repetitions. It deletes the copy and profile after their processes stop. Neither
the original save nor the live picker is used by a test server. Map assets and
game data are read from their configured read-only directories.

Cold first visits have an empty HTTP cache, a fresh server and a fresh task worker.
Reloads retain browser HTTP cache and server calculations. The throttled first
visit uses 30 Mbps throughput and 40 ms CDP latency at 1440 × 900, DPR 1. This
approximates transfer constraints; it does not measure actual Funnel overhead or
Player 2's device. OS file caches are not flushed. Run benchmarks without the test
suite or other deliberate CPU workloads in parallel.

The interaction runs switch from Player 1 to Player 2 and back, then unlock a chunk
through the UI in the copied save. They wait for the task result for the selected
member and acknowledged revision. They include durable saving, response transfer,
parsing and rendering. A server evaluation time alone is not this latency.

Milestones distinguish first paint, adopted state, the Saved indicator, drawn
terrain, the task list, committed visible tiles, and network idle. Optional probes
record metadata only when the harness opts in before navigation. Network idle
excludes the persistent SSE stream and waits for 750 ms without pending requests.
Transfer bytes are CDP encoded bytes, including response headers; cache reuse is
reported separately. TTFB includes request scheduling and network latency, so it
is not pure server CPU time. Browser long tasks use the standard 50 ms threshold
and are assigned to the milestone phase in which they started.

The final collector uses CDP's response extra-info event to identify an actual
304 when the ordinary response event exposes a cached 200. Earlier reports can
undercount revalidated cache hits; their wire bytes, TTFB and milestone values
are unchanged. Cache-hit counts from those reports are not directly comparable
with the corrected final counts.

## Targets

| Workflow | Target |
| --- | ---: |
| Local reload: tasks shown | < 2 s |
| Local reload: terrain drawn | < 1.5 s |
| Local reload: unchanged transfer | < 3 MB |
| Cold first visit at 30 Mbps: tasks shown | < 6 s |
| Unlock to current tasks | < 3 s |
| Worst main-thread long task | ≤ 200 ms |

Measured results and implementation comparisons follow below. Complete saves,
backups, History and Undo remain server-owned; transport projections must not
discard their stored evidence.

## Initial baseline: deployed a306b40

Captured 2026-10-08T18:33:08.350Z; Node v24.20.0; Chrome/154.0.8037.97.

Medians across independent repetitions. Times are milliseconds; transfer/cache sizes are KiB.

| Scenario | N | Paint | Saved | Adopted | Terrain | Tasks | Visible tiles | Idle | Requests | KiB | Cached N | Cached KiB | Long N | Long total | Long worst |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold | 3 | 688 | 4,827 | 4,826 | 6,427 | 28,362 | 30,011 | 85,476 | 988 | 56,664 | 1 | 0 | 12 | 3,718 | 1,317 |
| reload | 3 | 120 | 4,954 | 4,953 | 5,524 | 8,526 | 10,520 | 10,765 | 985 | 33,210 | 916 | 21,741 | 12 | 2,851 | 868 |
| switch-player2 | 3 | — | — | — | 108 | 10,591 | 108 | 74,255 | 34 | 4,924 | 0 | 0 | 4 | 1,508 | 802 |
| switch-player1 | 3 | — | — | — | 81 | 2,763 | 81 | 3,550 | 4 | 4,461 | 2 | 2 | 4 | 1,541 | 900 |
| unlock | 3 | — | 193 | 193 | — | 13,952 | 0 | 66,124 | 7 | 8,886 | 3 | 3 | 7 | 3,321 | 1,059 |
| cold-30mbps | 3 | 840 | 15,155 | 15,154 | 26,138 | 40,584 | 65,418 | 101,418 | 987 | 56,664 | 0 | 0 | 11 | 3,674 | 1,228 |

| Scenario | State TTFB | Definitions | Rules | Tasks | Map info | Manifest | Pins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold | 2,186 | 1,146 | 1,858 | 5,442 | 2,484 | 1,906 | 21 |
| reload | 2,590 | 1,463 | 2,286 | 1,588 | 2 | 2,319 | 13 |
| switch-player2 | — | — | — | 8,777 | — | — | — |
| switch-player1 | — | — | — | 1,048 | — | — | — |
| unlock | — | — | — | 11,818 | — | — | — |
| cold-30mbps | 2,844 | 1,401 | 2,235 | 2,029 | 4,123 | 2,387 | 46 |

Advisory request duration (included in network idle): cold 80,059 ms; reload 60 ms; switch-player2 73,298 ms; switch-player1 36 ms; unlock 65,099 ms; cold-30mbps 82,222 ms.

| Scenario | Category | Requests | Transfer KiB | Decoded KiB | Cached N | Cached body KiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| cold | appCode | 49 | 3,821 | 3,795 | 0 | 0 |
| cold | dataJson | 11 | 20,067 | 20,063 | 0 | 0 |
| cold | api | 9 | 10,565 | 98,496 | 0 | 0 |
| cold | mapTiles | 783 | 21,872 | 21,474 | 0 | 0 |
| cold | otherAssets | 136 | 339 | 268 | 1 | 0 |
| reload | appCode | 49 | 3,821 | 3,795 | 0 | 0 |
| reload | dataJson | 11 | 20,067 | 20,063 | 0 | 0 |
| reload | api | 7 | 9,321 | 98,496 | 0 | 0 |
| reload | mapTiles | 783 | 0 | 21,474 | 783 | 21,474 |
| reload | otherAssets | 135 | 2 | 268 | 133 | 267 |
| switch-player2 | appCode | 0 | 0 | 0 | 0 | 0 |
| switch-player2 | dataJson | 0 | 0 | 0 | 0 | 0 |
| switch-player2 | api | 2 | 4,516 | 51,926 | 0 | 0 |
| switch-player2 | mapTiles | 30 | 404 | 389 | 0 | 0 |
| switch-player2 | otherAssets | 2 | 3 | 2 | 0 | 0 |
| switch-player1 | appCode | 0 | 0 | 0 | 0 | 0 |
| switch-player1 | dataJson | 0 | 0 | 0 | 0 | 0 |
| switch-player1 | api | 2 | 4,461 | 51,564 | 0 | 0 |
| switch-player1 | mapTiles | 0 | 0 | 0 | 0 | 0 |
| switch-player1 | otherAssets | 2 | 0 | 2 | 2 | 2 |
| unlock | appCode | 0 | 0 | 0 | 0 | 0 |
| unlock | dataJson | 0 | 0 | 0 | 0 | 0 |
| unlock | api | 4 | 8,886 | 102,824 | 0 | 0 |
| unlock | mapTiles | 0 | 0 | 0 | 0 | 0 |
| unlock | otherAssets | 3 | 0 | 3 | 3 | 3 |
| cold-30mbps | appCode | 49 | 3,821 | 3,795 | 0 | 0 |
| cold-30mbps | dataJson | 11 | 20,067 | 20,063 | 0 | 0 |
| cold-30mbps | api | 9 | 10,565 | 98,496 | 0 | 0 |
| cold-30mbps | mapTiles | 783 | 21,872 | 21,474 | 0 | 0 |
| cold-30mbps | otherAssets | 135 | 339 | 268 | 0 | 0 |

Server process spawn → localhost ready: 12,903 ms; foreground worker compilation: 4,488 ms.
Server RSS ready / after: 1,180 / 6,169 MiB.

The three repetitions used the same source snapshot. All 18 measurements passed;
all six disposable server/browser suites shut down and their scratch folders were
removed. The full initial test suite passed: 1,534 passed, one skipped, no failures
(1,535 tests). Raw waterfalls and phase timings are in the ignored timestamped
JSON alongside the readable report.

These repeated results are slower than the earlier rough profiler figures on
this host. Other ongoing work can affect CPU and memory pressure; no unrelated
process was altered. Compare repeated medians and retain that limitation when
interpreting improvements.

The baseline separates a drawn fallback map from fully committed viewport tiles.
The 2 KiB rules response waits over two seconds on reload, while app/data modules
retransfer about 23 MiB. These point to event-loop work and cache policy as well
as task evaluation. Death estimates explain most of the cold and unlock network
idle tail; their durations remain visible instead of being excluded.

## Paired comparison inputs

The live source save advanced while optimisation was in progress. Its original
bytes could not be reconstructed from a retained backup, so the initial table
above remains a historical capture. It is not the denominator for the final
before/after comparison.

The paired measurements run the committed baseline (`ec5dfc7`, containing the
measurement probes but the deployed application behaviour) and the optimised
application against the same frozen revision-27 fixture. The fixture was
reconstructed from its backup and verified storage references. The harness
records its state SHA256, the selected server entry SHA256, and the selected
revision separately. Baseline application code is archived inside this worktree;
both variants use the current harness and the same read-only external assets.
The private fixture and archived code are removed after the comparison. Only
scalar reports remain in `.local/perf/`.

The first optimized three-run checkpoint (`8099b1e`) passed the reload and Unlock
targets: tasks appeared in 919 ms on reload and 2,853 ms after Unlock; reload
terrain appeared in 849 ms with 920 KiB transferred. Its actual worst long task
across all 18 measurements was 167 ms. The throttled task median was still
7,360 ms, so that checkpoint was not accepted as the final result.

A subsequent profile used the compact protocol actually requested by the browser.
Preparing its 19.1 MB calculation input took 317 ms, and synchronous worker
dispatch took another 127 ms. Sampled parent CPU attributed 301 ms to the clone
and 126 ms to dispatch. Worker samples attributed 253 ms to collection alias
indexing and 475 ms to fresh access calculation. This motivated shared serialized
inputs, selective alias indexing and tracking only task gates actually read by
access. Full real-save results still matched for both members after those changes.
The next throttled smoke reached 6,549 ms, with a 190 ms worst browser long task;
it still missed the six-second target and prompted another focused iteration.

The prepared-startup smoke then reached 5,804 ms with a 123 ms worst long task.
Its 8,392 ms server-ready time includes 388 ms to compile the saved guide variant
and 119 ms to prepare the initial play-state response. This moves necessary work
before navigation; it does not eliminate that work. The engine also avoids
reallocating fixed blockers on every eligibility pass, preserving final detailed
explanations and all counters. Three-run measurements determine final acceptance;
these single-run checkpoints explain the choices, not the final claim.

## Verified paired results

The final application and harness are commit
`9929fccf162c73b1a44f07458fd8f9650cd20897`, measured with a clean worktree and
prewarming enabled. Baseline and final reports are respectively
`.local/perf/paired-baseline-2026-10-08T19-11-58-054Z.{json,md}` and
`.local/perf/optimized-verified-2026-10-08T21-00-39-722Z.{json,md}`.
Each has three repetitions of all six scenarios, using the same fixture,
Node v24.20.0, Chrome/154.0.8037.97 and viewport/throttle settings.

All 18 optimized measurements passed, with zero failed visible tiles or requests.
Every individual reload, Unlock and throttled task measurement also satisfies
its target. Times below are median milliseconds, before → after. First paint
applies only to navigation; member switching neither adopts nor saves state.
Unlock retains its already committed terrain.

| Scenario | Paint | Saved | Adopted | Terrain | Tasks | Visible tiles | Network idle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 600 → 624 | 3,789 → 488 | 3,788 → 486 | 5,324 → 1,525 | 21,222 → 5,817 | 10,367 → 6,094 | 59,147 → 41,788 |
| Reload | 76 → 92 | 3,005 → 315 | 3,004 → 314 | 3,309 → 800 | 6,174 → 914 | 7,945 → 4,840 | 8,164 → 5,046 |
| Switch Player 2 | — | — | — | 74 → 10 | 8,487 → 2,224 | 75 → 10 | 49,387 → 38,540 |
| Switch Player 1 | — | — | — | 66 → 9 | 1,973 → 281 | 66 → 9 | 2,774 → 1,217 |
| Unlock | — | 123 → 126 | 123 → 126 | Retained | 9,707 → 2,271 | 0 → 0 | 38,865 → 32,672 |
| Cold, 30 Mbps | 676 → 660 | 12,096 → 1,083 | 12,095 → 1,072 | 16,624 → 6,051 | 27,407 → 5,304 | 36,963 → 20,412 | 66,868 → 45,003 |

Wire sizes are KiB including headers. Long-task counts/totals/worst are medians;
the final column is the actual maximum across all three runs of that scenario.
The global actual maximum falls from 1,337 ms to **135 ms**, passing the 200 ms
limit in every run.

| Scenario | Requests | Wire KiB | Cached requests | Long count | Long total ms | Median worst ms | Actual maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 988 → 953 | 56,664 → 24,754 | 1 → 1 | 12 → 6 | 3,223 → 456 | 1,137 → 132 | 1,337 → 135 |
| Reload | 985 → 953 | 33,210 → 920 | 916 → 949 | 10 → 4 | 2,107 → 297 | 667 → 118 | 870 → 126 |
| Switch Player 2 | 34 → 32 | 4,924 → 809 | 0 → 0 | 4 → 1 | 1,330 → 54 | 632 → 54 | 815 → 60 |
| Switch Player 1 | 4 → 12 | 4,461 → 409 | 2 → 10 | 4 → 1 | 1,108 → 53 | 580 → 53 | 648 → 93 |
| Unlock | 7 → 4 | 8,886 → 500 | 3 → 0 | 7 → 0 | 2,801 → 0 | 761 → 0 | 993 → 0 |
| Cold, 30 Mbps | 987 → 954 | 56,664 → 24,754 | 0 → 2 | 8 → 3 | 2,191 → 217 | 665 → 108 | 882 → 125 |

Reload reuses or revalidates 949 of 953 requests, representing **51,612,780
decoded body bytes** in each run. The report's 15,530 KiB encoded cached-body
median is a lower bound: revalidated responses can omit encoded body metadata
from both CDP headers and ResourceTiming. It is not an exact avoided-wire total.
Wire transfer itself is measured independently and is 942,523 bytes at the
median. Earlier cache-hit counts have the extra-info caveat described above.

Category cells are **wire KiB / request count**, before → after. Map tiles include
the world PNG. Private revalidation adds headers to unchanged PNG requests while
keeping their bodies cached.

| Scenario | App code | Data JSON | API | Map tiles | Other assets |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 3,821 / 49 → 197 / 37 | 20,067 / 11 → 471 / 4 | 10,565 / 9 → 1,801 / 8 | 21,872 / 783 → 21,957 / 783 | 339 / 136 → 328 / 121 |
| Reload | 3,821 / 49 → 24 / 37 | 20,067 / 11 → 2 / 4 | 9,321 / 7 → 407 / 8 | 0 / 783 → 473 / 783 | 2 / 135 → 15 / 121 |
| Switch Player 2 | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 | 4,516 / 2 → 401 / 2 | 404 / 30 → 408 / 30 | 3 / 2 → 0 / 0 |
| Switch Player 1 | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 | 4,461 / 2 → 403 / 2 | 0 / 0 → 0 / 0 | 0 / 2 → 6 / 10 |
| Unlock | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 | 8,886 / 4 → 500 / 4 | 0 / 0 → 0 / 0 | 0 / 3 → 0 / 0 |
| Cold, 30 Mbps | 3,821 / 49 → 197 / 37 | 20,067 / 11 → 471 / 4 | 10,565 / 9 → 1,801 / 8 | 21,872 / 783 → 21,957 / 783 | 339 / 135 → 328 / 122 |

Endpoint TTFB medians are milliseconds, before → after. Every request's TTFB and
offsets remain in JSON. Baseline cold workflows contain two cancelled task
requests, and baseline Unlock contains two completed task requests; optimized
workflows issue one. Aggregate task TTFB therefore does not compare equivalent
calculations. Cache-hit evaluation/stage timings describe the original
calculation; `requestMs` describes the current hit. Pins now wait for compression
before headers but transfer far fewer bytes, independently of terrain startup.

| Scenario | State | Definitions | Rules | Tasks | Map info | Manifest | Pins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 1,693 → 7 | 979 → 98 | 1,535 → 87 | 3,916 → 5,181 | 1,374 → 851 | 1,563 → 248 | 10 → 685 |
| Reload | 1,609 → 4 | 797 → 4 | 1,444 → 7 | 1,516 → 124 | 2 → 2 | 1,464 → 93 | 8 → 1 |
| Switch Player 2 | — | — | — | 6,927 → 2,003 | — | — | — |
| Switch Player 1 | — | — | — | 730 → 50 | — | — | — |
| Unlock | — | — | — | 7,840 → 2,031 | — | — | — |
| Cold, 30 Mbps | 1,823 → 47 | 1,172 → 79 | 1,641 → 69 | 1,140 → 3,857 | 1,797 → 523 | 1,705 → 157 | 50 → 534 |

Long-task phase totals below are medians in milliseconds, before → after. A phase
ends at the named milestone and starts at the preceding observed milestone;
their order can differ between runs. Phase medians need not sum to the median
total. The 135 ms maximum occurs after Saved and before terrain in a cold run.

| Scenario | Ending at Saved | Terrain drawn | Tasks shown | Visible tiles | Settled |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 1,086 → 56 | 300 → 248 | 1,938 → 116 | 0 → 0 | 0 → 0 |
| Reload | 807 → 0 | 183 → 247 | 990 → 0 | 0 → 0 | 0 → 0 |
| Switch Player 2 | — | 71 → 0 | 1,258 → 54 | 0 → 0 | 0 → 0 |
| Switch Player 1 | — | 64 → 0 | 1,034 → 53 | 0 → 0 | 0 → 0 |
| Unlock | 55 → 0 | — | 1,409 → 0 | — | 1,259 → 0 |
| Cold, 30 Mbps | 960 → 0 | 245 → 0 | 1,029 → 217 | 0 → 0 | 0 → 0 |

| Server process metric | Baseline median | Final median |
| --- | ---: | ---: |
| Spawn to HTTP ready | 9,459 ms | 8,912 ms |
| Base foreground worker compilation | 3,281 ms | 2,781 ms |
| Saved-rule variant preparation, included in ready | — | 381 ms |
| Initial play-state response preparation, included in ready | — | 136 ms |
| RSS at ready | 1,221 MiB | 1,247 MiB |
| RSS after scenarios | 6,230 MiB | 5,470 MiB |

The steady reload and interaction targets pass, and throttled tasks appear in
5.30 s. Complete cold viewport tiles still require 20.41 s at 30 Mbps: about
22 MB of PNG terrain dominates cold transfer. Advisory calculations also remain
visible in network idle. Final advisory duration medians are 35,061 ms cold,
41 ms reload, 35,355 ms switching to Player 2, 22 ms switching back, 29,040 ms after
Unlock and 38,817 ms throttled. These are retained measurements of remaining
work, separate from the completed foreground UI.

## Payload and calculation checks

The real-save audit compares archived baseline code with the optimised code,
using separate native evaluations for both members. Entire full result hashes,
including task order, diagnostics, access, equipment and activity panels, match
after excluding only elapsed/timing/cache metadata. Full state and portable
backup hashes also match. The sparse browser projection agrees with the original
fact projection and progress indexes in any/all/personal completion modes.
This fixture has no actual-completion or completion-family facts; synthetic
regressions cover those cases, ambiguity and canonical false/empty overrides.

Payload sizes below are body bytes, not the harness's wire-byte totals. Gzip uses
level 1 and Brotli quality 4. Sizes are decimal MB/KB, rounded.

| Payload | Full raw | Play raw | Full gzip | Play Brotli |
| --- | ---: | ---: | ---: | ---: |
| State | 25.96 MB | 3.81 MB | 3.67 MB | 375 KB |
| Player 1 task result | 52.42 MB | 4.49 MB | 4.53 MB | 386 KB |
| Player 2 task result | 52.69 MB | 4.47 MB | 4.58 MB | 386 KB |
| Selected locked chunk planning | — | 807 KB | — | 84 KB |

The full task array alone is about 41 MB, mostly detailed requirements and
source/explanation data. The initial browser view retains every computed row's
identity, status and completion-family facts, with visual fields only where
needed. Explicit detail views retain the full response. Persisted catalogue rows
fall from 23,926 to 400 in play-state: custom tasks and every row addressed by
either member's saved completion/status/alternative references, including false
or empty values and ambiguous candidates. The materialized identity overlay is
44 KB raw / 3 KB Brotli. The remaining legacy data stays intact because display
and compatibility consumers still read it; history is only about 45 KB raw.

Focused chunk planning returns the same location associations, evidence, clue
markers and access as the previous full browser index. The audit checks the
measured locked chunk, an interior, a section and a numeric alias for both members.
An open default Tasks tab now waits for compact tasks and requests that location's
planning data rather than automatically fetching the full catalogue again.

The CPU profiles exclude startup compilation and sample one foreground request.
It identified repeated access refreshes, first-use variant compilation, saved
fact projection, full serialization and compact-row copying. Access is reused
inside an evaluation until an observed task gate changes; mutable results
are copied before Slayer restrictions or produced objects alter them. Compiled
guide variants share an access index only with identical relevant definition
branches and environment switches. Fact-resolution caches are invocation-local.
Compact worker requests serialize only play JSON; a later full request appends
BiS/Activity views from retained private inputs without repeating core evaluation.

The harness refinements preserve individual request and long-task offsets, plus
whitelisted calculation timings for the displayed result. They do not change the
milestone or transfer calculations used by the paired baseline.

## Changes retained and alternatives evaluated

Static text and reference API responses negotiate Brotli, gzip or identity, with
memoized asynchronous compression and strong ETags for the selected bytes.
Unchanged responses revalidate with 304; only filenames carrying a content digest
receive immutable caching. All responses remain private, and authentication runs
before cached GET, HEAD and 304 responses. Bounded caches include retained encoded
bytes. Dynamic task responses keep current timing metadata and `private, no-store`
while reusing serialized worker bytes internally.

Startup now requests the corrected display world and chunk-only definitions,
instead of importing the authored world, identity registry and resource datasets
into the browser. State, rules, definitions, terrain manifest, pins and map info
start independently where possible. Pins arriving later preserve decoded terrain.
Full definitions and task evidence load together when a detailed view needs them.
Chunk search builds its original index lazily in short slices. Task rendering
yields between small batches and leaves closed lists unbuilt until opened.

Foreground requests have priority over autonomous prediction warming, including
a ten-second initial admission window and a bounded wait for a new revision's
first task request. Explicit prediction requests remain available immediately.
Calculation snapshots omit archival trees, and native foreground inputs reuse
memoized field strings in a shared buffer rather than cloning the object. Compact
and full worker responses have separate cache keys. Focused planning avoids a
second full-result download when the default Chunk Info Tasks tab refreshes after
Unlock.

The selected saved rule variant and initial play-state encodings are prepared
before HTTP readiness. Diagnostics and the harness report both costs separately;
spawn-to-ready includes them. These optional warm-ups preserve saves and worker
recovery if interrupted. Shared-input regressions cover captured revisions,
mixed object/serialized callers, bounded snapshot eviction and safe resends
after errors. Two independently invited clients receive both commits over SSE
and merge own and peer play-state deltas coherently.

Several alternatives were narrowed or rejected:

- Disabling prewarming reduced contention but still missed cold and Unlock
  targets in the intermediate run. Prewarming remains enabled with foreground
  priority rather than changing normal prediction behavior.
- Skipping BiS/Activity alone saved about 105 ms in the profiled evaluation. The
  larger opportunities were access refreshes, fact projection and serialization;
  full views now append lazily without repeating the core calculation.
- Removing visible Wiki/raw-label fields would change links and icons. They stay
  in visible rows; hidden rows retain completion facts and get display evidence
  when their planning view opens.
- History was only about 45 KB and was not the source of the multi-megabyte state.
  The large legacy display data remains because compatibility consumers use it.
- Date/version names are revalidated rather than treated as content hashes.
  Task HTTP 304s were also rejected because per-request timing metadata changes.
- The existing category limit plus incremental rendering was sufficient; a new
  virtualized list was not needed. The terrain queue already prioritizes the
  viewport, so these changes preserve its coverage and ordering.
- Hypothetical prediction results are not promoted across actual transitions;
  their state and view completeness differ. Access reuse is confined to an exact
  evaluation and invalidates when an access gate changes.
- Starting tasks before state adoption would save only 60–70 ms in the recorded
  waterfall, too little to justify another stale-request path.
- A shared cache of normalized challenge templates was not added: compilation
  accounted for only 117 ms in the compact profile, while custom overlays and
  root-level requirement promotion would require a broader invalidation contract.
  Base item source collection also retains its existing inputs and semantics.

PNG terrain remains the largest cold transfer. These runs measure complete
visible tile loading and advisory network tails as well as the faster foreground
map and task milestones.

## Validation

The complete `npm test` suite passes: 1,633 passed, one skipped, zero failures
(1,634 tests; 229,592 ms). Temporary test storage is scoped to this worktree's
`.local/test-tmp`. The existing skip checks generated skill-icon PNG bytes,
hashes, dimensions and native alpha when the optional asset root is installed;
that asset root is absent in this worktree. There are 99 more tests than the
initial baseline. Added regressions cover compression/encoding negotiation,
private cached authentication and revocation, GET/HEAD/304, compact payloads and
deltas, sparse completion facts, full-result upgrades, planning evidence, access
gate changes, lazy definitions/search, incremental rendering and stale requests.
Shared-input coverage includes malformed metadata/UTF-8, object/serialized
interleaving, captured-revision coherence and error/eviction recovery. Preparation
tests preserve exact task outputs and counters, authenticated warmed routes,
two-client SSE deltas and durable saves during a worker interruption.

The first complete run exposed four outdated renderer-harness assumptions. The
comparison VM now supplies incremental-render globals and observes cached list
membership for closed disclosures; the terrain fixture initializes pin dirty
state and scheduling. Their original completion, privacy and subscription
assertions remain intact. Cache-header expectations changed deliberately to
require private responses and validators for the selected encoding.

The real-save native audit verifies full task results for both members, full
state and backups, sparse any/all/personal progress, and four planning locations
per member. Existing golden prediction outputs remain unchanged. LF checks and
`git diff --check` pass; `.gitattributes` is unchanged.

The final native audit is
`.local/perf/native-parity-postchanges-2026-10-08T21-02-58-270Z.json`, against
clean commit `9929fccf162c73b1a44f07458fd8f9650cd20897`. Both members' complete
result hashes match the archived baseline with array order preserved, excluding
only `cache`, `timing`, `timingMs` and `metrics.elapsedMs`. Full state and portable
backup hashes match as well. Decoding the 19,107,695-byte shared calculation input
reproduces the object input exactly, including captured revision, member order,
fingerprint, tasks, identities and legacy fields. The earlier projection audit
also checks progress modes and planning locations described above.

After measurement and parity checks, the private frozen fixture, archived code
and its archive file were deleted. `.local/perf/final-cleanup.json` records zero
remaining measurement processes and scratch directories. Ignored scalar reports,
CPU profiles and test logs remain for inspection. No private save was committed;
the main checkout, original duo, live listeners and Tailscale were untouched.

## Changed files

The branch changes 66 tracked files relative to deployed `a306b40`. Application
changes cover transport, worker calculation, sparse projections and browser
startup/rendering; the remaining files document the harness and add regressions.
Changes to `app/web/main.mjs` and `app/server.mjs` concern performance. Interior
tab/invite styling and Restore/Import administrator policy were not edited.

```text
README.md
app/core/map-markers.mjs
app/core/player-controls.mjs
app/core/progress-index.mjs
app/core/progress.mjs
app/core/rule-registry.mjs
app/core/rules.mjs
app/core/task-alternatives.mjs
app/data/cache-topology.mjs
app/data/map-pins.mjs
app/data/surface-grid.mjs
app/data/world-connections.mjs
app/data/world.mjs
app/display-world.mjs
app/http-response.mjs
app/play-view.mjs
app/server.mjs
app/storage/store.mjs
app/tasks/access.mjs
app/tasks/chunk-planning-index.mjs
app/tasks/engine.mjs
app/tasks/fact-projection.mjs
app/tasks/gameplay-compat.mjs
app/tasks/migration.mjs
app/tasks/scheduler.mjs
app/tasks/worker.mjs
app/web/chunk-planning.mjs
app/web/death-chunks.mjs
app/web/main.mjs
app/web/map-pins.mjs
app/web/map-terrain.mjs
app/web/map.mjs
app/web/settings-panel.mjs
docs/architecture.md
docs/performance.md
docs/sharing.md
package.json
scripts/compare-cache-access.mjs
scripts/perf/README.md
scripts/perf/cdp.mjs
scripts/perf/network-collector.mjs
scripts/perf/page-load.mjs
scripts/perf/probe.mjs
scripts/perf/server.mjs
tests/archmaps-server.test.mjs
tests/cache-pin-application.test.mjs
tests/chunk-planning.test.mjs
tests/chunk-sections-map.test.mjs
tests/death-ui.test.mjs
tests/display-world.test.mjs
tests/engine-hotspots.test.mjs
tests/http-response.test.mjs
tests/icons-server.test.mjs
tests/light-facts.test.mjs
tests/map-pin-filters.test.mjs
tests/map.test.mjs
tests/perf-network-collector.test.mjs
tests/play-server.test.mjs
tests/play-view.test.mjs
tests/prediction-server.test.mjs
tests/scheduler.test.mjs
tests/server.test.mjs
tests/storage-play.test.mjs
tests/web-browser.test.mjs
tests/web-personal.test.mjs
tests/worker-timings.test.mjs
```

## Sandbox verification, October 9, 2026

The sandbox branch starts from deployed `2930ca8`. Measurements use a frozen
revision-50 copy inside the sandbox worktree, Node 24 and the same native
reference/map assets read-only. Disposable servers use random localhost ports;
each scratch store and Chrome profile is deleted after its run.

The two-step experiment unlocks `13882`, then `13617`, without changing the saved
revision. Added goals include the Arcane blast necklace, Gravite knife,
Citharede hood and One Piercing Note.

| Player | Active tasks | Possible tasks | Roll pool | First step | Two-step draft | Cached repeat |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Player 1 | 12 → 45 | 1,586 → 1,675 | 8 → 6 | 4,048 ms | 4,435 ms | 550 ms |
| Player 2 | 12 → 43 | 1,573 → 1,647 | 21 → 19 | 3,700 ms | 3,998 ms | 282 ms |

**The under-3-second sandbox step target is not met on this fresh sequence.**
The engine alone takes 2,534–3,384 ms. Shared compact response transport,
memoized projections/task indexes and bounded roll-pool caches reduce wrapper
work, but they do not reuse the engine's invocation-local processing/access
closure across different drafts. No engine eligibility or prediction golden
changes were made. Empty-draft opening, measured separately, takes 14,150 ms
for Player 1 and 4,382 ms for Player 2; this includes advisory-worker preparation.
Earlier warmed candidate scans took about 2.3–3.2 seconds for these individual
unlocks, so those scans do not establish the target for a fresh sequence.

The successful full smoke report is `.local/sandbox-smoke-report.json`;
`nativeSequenceReused` is false. It verifies byte-identical scratch gameplay
state, unchanged History and frozen source, challenge checking and Undo, exact
restoration of saved task labels/counts and map counts after Exit, disabled save
controls, evaluation-only POSTs and zero browser runtime errors. The native
endpoint result also passes a hydrated map-model regression that requires
authoritative partner connections.

The final full `npm test` run passes: **2,007 passed, 1 skipped, 0 failed**
(2,008 tests, 313.3 seconds). The existing generated-skill-icon PNG verification
is skipped without its asset-root setting. `.local/sandbox-final-test.log` retains the run. Prediction goldens and
`.gitattributes` are unchanged; `git diff --check` passes.

Captures for visual review are `.local/screenshots/sandbox-desktop.png`
(1440×900, dark), `sandbox-phone.png` (390px, light), and
`sandbox-phone-gray.png` (390px, gray). All three have no horizontal page
overflow; the two phone captures include the task list below the map. The
browser smoke stubs only death estimates; the normal performance comparison
retains ordinary advisory behavior. These are headless desktop checks with
phone viewport emulation.

The first normal page-performance comparison uses three repetitions of all six
default `npm run perf` scenarios, with prediction prewarming on. Task milestones
are medians in milliseconds; unlock means the saved command through refreshed
tasks, with terrain retained.

| Scenario | Deployed `2930ca8` | Sandbox branch | Change |
| --- | ---: | ---: | ---: |
| Cold visit | 7,125 | 8,403 | +17.9% |
| Reload | 1,063 | 1,151 | +8.3% |
| Switch to Player 2 | 5,078 | 4,295 | −15.4% |
| Switch to Player 1 | 323 | 362 | +12.2% |
| Unlock → refreshed tasks | 3,564 | 4,088 | +14.7% |
| Cold, 30 Mbps / 40 ms | 7,297 | 8,379 | +14.8% |

This initial series exceeds the requested roughly 10% band in several scenarios.
Its reports are `.local/perf/sandbox-baseline-2026-10-09T22-45-24-853Z.json`
and `sandbox-final-2026-10-09T23-26-42-930Z.json`, with corresponding Markdown
reports. All measured scenarios complete without failure. The original baseline's
first repetition overlapped earlier native checks; later repetitions were quieter.
The baseline cold milestone ranges from 5,734 to 9,592 ms, so the batches are
insufficient to distinguish a small regression from host variation.

The added browser modules/styles transfer about 10 KiB on a cold visit (three
additional requests). Median server RSS rises from 1,422 to 1,427 MiB at readiness
and 5,417 to 5,484 MiB after the suite. Median foreground compilation rises from
3,249 to 4,014 ms. Cold engine time rises from 4,276 to 5,365 ms; the regular
engine calculation functions are unchanged by this branch.

Supplementary comparisons alternate baseline/current, reverse the order in the
second pair, and retain every run. Three-second post-exit host samples show
87–94% CPU load, 7.5–10.4 GiB free RAM out of 31.9 GiB, and active `rs2client`,
idle-game and other Node processes. The scalar snapshots are
`.local/perf/sandbox-host-context-pair2-current.json` and
`sandbox-host-context-pair2-baseline.json`. No unrelated process was stopped.

The supplementary three-pair medians are:

| Scenario | Deployed `2930ca8` | Sandbox branch | Change |
| --- | ---: | ---: | ---: |
| Cold visit | 7,270 | 7,731 | +6.3% |
| Reload | 1,079 | 963 | −10.7% |
| Switch to Player 2 | 3,250 | 4,386 | +34.9% |
| Switch to Player 1 | 302 | 388 | +28.5% |
| Unlock → refreshed tasks | 3,257 | 5,969 | +83.3% |
| Cold, 30 Mbps / 40 ms | 10,008 | 8,955 | −10.5% |

All six reports are retained in order in
`.local/perf/sandbox-paired-comparison.json` (baseline/current, current/baseline,
baseline/current), including all individual milestones and engine stages:

```text
sandbox-pair1-baseline-2026-10-09T23-31-01-308Z.json
sandbox-pair1-current-2026-10-09T23-35-01-821Z.json
sandbox-pair2-current-2026-10-09T23-40-26-325Z.json
sandbox-pair2-baseline-2026-10-09T23-44-46-529Z.json
sandbox-pair3-baseline-2026-10-09T23-50-57-324Z.json
sandbox-pair3-current-2026-10-09T23-56-25-761Z.json
```

All paired scenarios complete without errors. Baseline unlock alone ranges from
2,923 to 8,669 ms; no outlier is discarded. The final post-exit sample still shows
85% CPU load and 7.1 GiB free RAM, with other active game, Node and OneDrive
processes. The observed slowdowns exceed the requested band, and host variation
prevents a reliable estimate of the branch's contribution. **The roughly 10%
normal-performance limit is not verified.** A quiet-host comparison remains
necessary for normal performance; the fresh sandbox-step target needs further
engine-owned optimization.

Paired median server RSS is 1,430 → 1,426 MiB at readiness and 6,110 → 5,902 MiB
after the suite; foreground compilation is 4,957 → 5,177 ms. Worst browser long
tasks have paired medians of 147 → 142 ms cold, 138 → 118 ms on reload, and
0 → 61 ms after unlock. `.local/perf/sandbox-host-context-final.json` retains the
final scalar host sample.

The frozen save hash remains unchanged throughout. The live source's state hash
changed during measurements; its cause is unverified, and the benchmarks perform
no live-store writes. Every comparison uses the frozen copy.

After verification, the private frozen save copy is deleted. All benchmark-owned
processes, scratch stores and browser profiles are closed and removed. Reports
and screenshots remain under ignored `.local/`, along with the baseline Git
archive/code used for comparison; no private save is committed.

## Merge context, 2026-10-10

The historical sections below retain separate copied-save measurements from the
Group view branch (`1c3e290`) and redesign branch (`af6e307`) before their merge.
Their timings, settings, input hashes and source fingerprints describe those
recorded reviews. They are not measurements of the merged application.

## Merged-tree verification, 2026-10-10

The merged tree **does not meet the approximately 10% regression gate**:
Group on Unlock is 48.4% slower than its matching redesign map-on baseline.
Group off and both reload medians meet that gate. Times are median milliseconds
across three repetitions; percentages use the unrounded JSON values.

| Mode | Scenario | Redesign `af6e307` | Merged `c3bd7bd` | Change |
| --- | --- | ---: | ---: | ---: |
| Off | Reload → selected tasks | 726 | 715 | −1.5% |
| Off | Unlock → selected tasks | 5,081 | 3,203 | −37.0% |
| On | Reload → task milestone | 742 | 703 | −5.3% |
| On | Unlock → task milestone | 3,368 | 4,999 | +48.4% |

On retains the group map but changes selected-player `tasks-shown` to complete
`duo-tasks-shown`; Off retains selected tasks. No off-versus-on overhead is inferred.
Every merged reload sample meets two seconds; all six Unlock samples exceed three
seconds. Complete-duo conditioning is 9,148 / 11,452 / 10,542 ms in rounded logs;
cold visits were not selected report scenarios.

Four serial batches after the full test suite use normal prewarming and tasks
settlement, on one immutable revision-96 copy: two members, 158 / 114 unlocked,
2 / 19 selected, 105 files, 37,072,742 bytes. All 24 requested measurements and
12 conditioning visits complete with zero observed request/visible-tile failures.
Owned servers/profiles close and scratch is removed. Full source, app and harness
fingerprints match before/after.

The immutable source/driver select Player 1's locked chunk `11575` without pool
fallback and verify member/revision readiness; per-suite chunk/member queries are
not retained in successful reports.

ON's inferred peer finishes 561–650 ms before selected. Selected engine median
grows 2,109 → 3,079 ms; final-response-to-paint shrinks 75 → 32 ms, with no Unlock
long task after Saved. The observed delay precedes selected response; its cause
and carried-over background work are not isolated. The summary retains request
durations, stages and pending-work evidence.

The candidate includes reviewed changelog/CSS refinements on `c3bd7bd`.
Archived `af6e307` has 8,134 files verified byte-identical to Git blobs after
correcting archive line endings. SHA-256 inputs:

- State: `1140d5ca54b4b530bc5aff098f84b80587d0c0965b5b78178a87384d213c9d66`.
- Archived / merged server entry: `bee152c5dd7f70f1f6d5b84aad66275c39cc9bdf76778805d945af3a5f666032` /
  `5917dfac730efcc0f11cc63daab629164533c2412ae43866a3ae02ba17334edd`.
- Merged app tree: `3ecb9820cd09bd2a93abd8da4261437088347b6e71951fc260b9a0bc8cd29462`.
- Harness tree: `ddf9ea13bfe425b237eb21cd457bb9d034b9d95c3d28e216790dce44e8b1cebb`.

Exact manifests remain in `.local/groupview-merge-perf-{prep,sources}.json`.
The commands use read-only main map/game data and the same copied source:

```powershell
$perfArgs = @('--source', '.local/groupview-merge-save', '--runs', '3', '--scenarios', 'reload,unlock', '--settlement', 'tasks', '--prewarm', 'on', '--map-assets', 'C:/Users/User/Projects/chunk-picker-rs3/.local/map-assets', '--game-data', 'C:/Users/User/Projects/chunk-picker-rs3/.local/game-data')
npm run perf -- @perfArgs --group-view off --label groupmerge-redesign-off --server-entry .local/groupview-merge-redesign/app/server.mjs --server-revision af6e307ca20d597e1c6dede5c2e465a7db7773f9
npm run perf -- @perfArgs --group-view on --task-milestone tasks --label groupmerge-redesign-on --server-entry .local/groupview-merge-redesign/app/server.mjs --server-revision af6e307ca20d597e1c6dede5c2e465a7db7773f9
npm run perf -- @perfArgs --group-view off --label groupmerge-merged-off --server-entry app/server.mjs --server-revision c3bd7bd029a9d96cda45c9f7d2f15a0959b771e5
npm run perf -- @perfArgs --group-view on --label groupmerge-merged-on --server-entry app/server.mjs --server-revision c3bd7bd029a9d96cda45c9f7d2f15a0959b771e5
```

Original JSON/Markdown reports, logs and host snapshots remain under `.local/perf/`:

- `groupmerge-redesign-off-2026-10-10T04-47-55-678Z.{json,md}`.
- `groupmerge-redesign-on-2026-10-10T04-49-25-072Z.{json,md}`.
- `groupmerge-merged-off-2026-10-10T04-50-52-036Z.{json,md}`.
- `groupmerge-merged-on-2026-10-10T04-52-51-337Z.{json,md}`.
- `groupmerge-comparison-2026-10-10T04-54-33-840Z.{json,md}` retains every sample,
  trace diagnosis, report hashes and before/after input checks.

Node v24.20.0, Chrome/154.0.8037.97, 1440 × 900, DPR 1. Batch-start CPU is
28 / 26 / 16 / 12%, with 9.34–9.66 GiB free RAM. Fixed ordering, ambient load and
unflushed OS caches limit attribution. Tasks settlement omits network idle;
phone/Funnel timing, concurrency and throttled first visits remain unmeasured.

## Combined duo task view, 2026-10-09

The comparison starts from deployed `c9d765b`, with the frozen revision-73 input
SHA256 `b7d0313182e16dd81897f62f0b29d5b22b0e8f49953e5409ed4a6954b032053e`.
Player 1 has 151 unlocked chunks and Player 2 113. Personal presented lists stay
6 → 6 for each player; Group view shows 7 unique rows, 5 shared. No eligibility,
map, prediction golden or retained data/provenance changes are made.

The first three-run baseline retains ordinary network-idle settlement:
reload → tasks is 1,610 ms and unlock → refreshed tasks is 9,771 ms.
Its artifact is
`.local/perf/groupview-before-2026-10-10T01-21-38-567Z.json` and the corresponding
Markdown report. Background advisory tails make idle settlement much later than
the task milestone: 5,155 ms on reload and 66,660 ms after unlock. This baseline
is retained separately from the task-settlement comparison below.

The additive `--settlement tasks` policy waits for refreshed tasks, the saved
revision and visible terrain, leaving background advisories and prediction
prewarming enabled. Group off measures `tasks-shown`; group on measures
`duo-tasks-shown`, only after both current results have painted. Each three-run
batch uses the same frozen input and task-settlement policy. Initial conditioning
and Unlock preparation follow that policy too. Network observations end at that
boundary, so they cannot be compared with idle-settlement network totals.

The initial sequential batches, before early partner-request admission, report:

| Task milestone | Deployed baseline | Group off | Group on |
| --- | ---: | ---: | ---: |
| Reload | 971 ms | 936 ms (−3.6%) | 1,304 ms (+34.3%) |
| Unlock → refreshed tasks | 6,314 ms | 7,238 ms (+14.6%) | 6,265 ms (−0.8%) |

All 18 requested reload/unlock measurements and nine cold conditioning visits
across the three batches succeed. The roughly 10% band is not verified by these batches. Baseline
unlock runs are 7,911 / 6,270 / 6,314 ms; Group off is 6,255 / 7,238 / 8,595 ms;
Group on is 12,164 / 6,265 / 6,241 ms. No run is discarded. Host occupancy varies
from 95.6% CPU / 3.20 GB free RAM before baseline to 69.6% / 10.67 GB before off,
and 68.2% / 4.43 GB before on. These conditions prevent a clean causal estimate.

The retained reports are
`groupview-task-baseline-2026-10-10T01-47-30-076Z.json`,
`groupview-task-off-2026-10-10T01-49-52-598Z.json` and
`groupview-task-on-2026-10-10T01-52-13-261Z.json`, under `.local/perf/`, with
matching Markdown tables and logs. `groupview-task-comparison.json` combines
their medians and host scalars.

The client then admits the partner fetch alongside the selected foreground
request while Group view is on, removing the chained cached-response wait.
At this stage both results still use the existing worker and exact-input member
caches. A second comparison rotates baseline/off/on order
across three rounds, so each condition occurs first, second and third once.

The second comparison retains all samples in
`.local/perf/groupview-rotating-comparison.{json,md}`. Median reload is
878 → 870 ms with Group off (−0.9%), and unlock is 5,379 → 5,528 ms (+2.8%).
Group on takes 1,244 ms on reload and 12,005 ms after unlock. This comparison
uses the old map-off baseline for both new modes; it identifies added work but
does not compare the existing map-on workload like for like. It fails the group
performance target. Both cached requests start together, but two compact
catalogues add transfer, decoding and selection work. Their last-response-to-
paint gap has a median of 354 ms, versus 178 ms at baseline.

The next implementation memoizes unchanged union selection and moves explicit
peer calculations to a lazy, bounded independent worker. Successful compact
results are promoted into the ordinary bounded foreground cache, without
parsing them or computing full details. The normal path creates no peer worker.
Legacy map-on baseline measurements use `--group-view on --task-milestone tasks`;
the new complete duo uses `--group-view on --task-milestone duo`. Both retain
the same task-settlement policy and frozen input.

The first two matched map-on attempts retain failed reload reports. Cached peer
responses arriving first exposed an empty-admission loop: the controller waited
for the selected result by repeatedly resolving an already-complete peer load,
starving the browser's pending selected response. The guard now exits once all
partners are cached, leaving selected loading to the foreground controller.
Both early loader paths have response-order regressions. The optional worker
peer projection cuts its decoded body from 4.43 MB to 577 KB while retaining
saved, competing-alias and completion-family evidence. Ordinary compact/full
bytes and prediction goldens remain unchanged.

A matched four-condition comparison then rotates three repetitions each of
baseline/current with Group view off/on. All 12 suites succeed; no samples are
discarded. The pre-coalescing evidence is retained in
`.local/perf/groupview-matched-final-summary.{json,md}`, with the ordering,
runtime-source hashes, per-run host scalars and all underlying reports.

| Task milestone | Deployed off | Current off | Deployed map-on | Current duo-on |
| --- | ---: | ---: | ---: | ---: |
| Reload | 721 ms | 741 ms (+2.7%) | 782 ms | 952 ms (+21.9%) |
| Unlock → refreshed tasks | 3,963 ms | 3,909 ms (−1.4%) | 4,018 ms | 4,651 ms (+15.7%) |

Off reload ranges are 658–803 / 703–787 ms; off unlock ranges are
3,651–5,326 / 3,847–6,094 ms. On reload ranges are 695–875 / 916–969 ms;
on unlock ranges are 3,813–4,138 / 4,485–4,946 ms. The normal path meets
the requested margin in this comparison; the complete duo path does not.
Median server RSS after the suite is 3.382 → 3.364 GB off and
3.267 → 4.476 GB on. The lazy extra worker therefore adds about 1.21 GB
on this save once used; it stays resident until shutdown.

For matched on reload, state adoption is 270 → 341 ms, selected request
duration is 312 → 371 ms, and last task response → displayed tasks is
220 → 229 ms. On unlock, selected request/evaluation is
3,623/2,948 → 4,219/3,162 ms; response → display is 93 ms for both.
All reload calculations hit caches with selected request overhead below
0.5 ms. Peer per-request engine timing is not captured, so it is not inferred
from body sizes. A separate opt-in CPU profile samples about 18 ms inside
duo selection on this actual save; profiled timings are excluded from medians.

The next client change coalesces successful pair publication: an early partner
waits for the selected foreground result without an incomplete render, and a
successful peer no longer rebuilds the sidebar again in its promise cleanup.
Scoped failures still render Retry. Group mode also skips unused personal
active-goal filtering and sorting; completed/backlog counts and the entire
Group-off selector path remain in place. The post-change comparison uses
separate retained reports rather than replacing these results.

The three post-coalescing matched on pairs all succeed, but still fail the
reload budget: median 750 → 1,100 ms (+46.6%), ranges 732–787 / 913–1,154 ms.
Unlock is 4,541 → 5,010 ms (+10.3%), ranges 4,135–6,384 / 4,544–5,529 ms.
The evidence is `.local/perf/groupview-coalesced-summary.{json,md}`, with all
source hashes, ordering, host samples and individual reports retained. Server
RSS after is 3.324 → 4.503 GB. On reload, state adoption is 310 → 415 ms,
selected request duration 290 → 472 ms (TTFB 66 → 132 ms), and last response
→ tasks 151 → 256 ms. The thin peer completes in about 46 ms. Selected
cached request overhead remains below 0.6 ms, so another engine-cache lookup
does not explain the large catalogue transfer/decode cost.

The subsequent change adds an explicit foreground `duo-sidebar-v1` projection
only for Group view. Its worker first decides normal personal Completed and
Backlog rows with the full facts index, then retains them alongside presented,
custom, saved-alias and family evidence. It stores both small display bytes and
unchanged normal compact bytes in the same bounded cache. Ordinary off requests
generate no additional projection. An older normal cache entry falls back to
its full compact bytes without rerunning the engine. Turning Group view off
restores a matching normal browser result or reloads the normal cached catalogue;
thin results cannot populate All possible tasks or Show blocked in personal mode.
Both response orders and off transitions have browser regressions.

The final small-foreground comparison rotates three baseline/current pairs for
each mode. All 12 suites succeed, with background advisories and default
prewarming enabled; every sample, including outliers, is retained in
`.local/perf/groupview-thinforeground-summary.{json,md}`. The matching raw
reports, ordering, runtime-source hashes and host samples use the
`groupview-thinforeground` prefix.

| Task milestone | Deployed off | Current off | Deployed map-on | Current duo-on |
| --- | ---: | ---: | ---: | ---: |
| Reload | 748 ms | 837 ms (+11.9%) | 891 ms | 925 ms (+3.8%) |
| Unlock → refreshed tasks | 4,483 ms | 5,384 ms (+20.1%) | 5,118 ms | 5,893 ms (+15.1%) |

Off reload ranges are 739–763 / 803–1,036 ms; off unlock ranges are
3,941–5,101 / 4,122–6,744 ms. On reload ranges are 763–897 / 850–2,829 ms;
on unlock ranges are 4,943–6,383 / 5,260–8,006 ms. This batch meets the
group reload margin but does not verify the requested overall roughly 10%
bound. The earlier matched normal-mode comparison passes; this final normal
batch does not. Host occupancy rises from 18.3% CPU / 14.06 GB free RAM at
the first baseline to 53.6% / 11.25 GB before the second current-on suite,
and reaches 78.2–78.3% before later suites. These observations establish
variation, rather than proving its cause or justifying discarded samples.

On cached reload, the selected body is approximately 574 KB decoded / 76.5 KB
on the wire, versus the unchanged 4.43 MB normal compact response. Its median
request duration is 39.6 ms and TTFB 23.3 ms; the peer is 577 KB / 76.5 KB,
56.5 ms / 28.6 ms. The final on-unlock median selected worker evaluation is
4,074 → 3,898 ms, while request duration is 4,656 → 5,540 ms and the last
task body → displayed pair is 92 → 45 ms. The additional delay is outside
the measured worker evaluation; these independent medians cannot identify
a queue, serialization or host-contention cause. The third on pair alone
has unlock 5,118 → 5,260 ms (+2.8%); it remains one retained pair, not a
replacement for the three-pair result.

Median server RSS after the final suite is 3.368 → 3.323 GB off and
3.318 → 4.437 GB on. The extra worker still costs about 1.12 GB once used.
One current-on cold conditioning visit takes 14.6 s, so cached reload
measurements do not describe first-use startup. A quieter repeat is needed
before claiming the performance requirement is met.

The final supplemental repeat starts only after the full test suite closes.
Three retained preflight CPU samples across 15 seconds are 19.6 / 29.7 / 17.1%,
with 13.72–13.74 GB free RAM. It repeats the same 12-suite rotation and default
background behavior without changing other processes. All suites succeed and
all owned servers, browsers and scratch stores close. The evidence is
`.local/perf/groupview-quiet-summary.{json,md}`, its preflight record, ordering,
source hashes and all `groupview-quiet-r1` through `r3` reports and logs.

| Task milestone | Deployed off | Current off | Deployed map-on | Current duo-on |
| --- | ---: | ---: | ---: | ---: |
| Reload | 734 ms | 739 ms (+0.7%) | 775 ms | 697 ms (−10.0%) |
| Unlock → refreshed tasks | 3,696 ms | 3,810 ms (+3.1%) | 4,461 ms | 4,609 ms (+3.3%) |

Percentages use the unrounded report medians. Off reload ranges are
664–824 / 719–854 ms; off unlock ranges are 3,639–4,786 / 3,581–4,239 ms.
On reload ranges are 669–779 / 685–703 ms; on unlock ranges are
3,857–5,329 / 4,455–4,754 ms. Every final median meets the requested roughly
10% margin. The first on-unlock pair alone increases 15.5%, and later pre-suite
CPU samples range from 15.9 to 42.6%, including two above 30%. Qualification
at startup therefore does not establish continuously quiet conditions or a
device-independent bound. The earlier failed and loaded-host comparisons
remain above; no sample is dropped or substituted.

Median RSS after is 3.264 → 3.246 GB off and 3.246 → 4.459 GB on, an extra
1.21 GB for the lazy worker once used. On cold conditioning task milestones
are approximately 5,112 → 10,493 ms, from the rounded progress logs rather
than requested-scenario medians. First-use startup retains this cost.
On unlock, selected worker evaluation is 3,499 → 3,325 ms, selected request
duration is 4,027 → 4,336 ms, and the request-minus-evaluation gap is
711 → 930 ms. These independent medians do not identify the delay's cause.
Every current selected unlock response uses the small projection; each peer
finishes before the selected response, and body → complete pair is 31–32 ms.

## Automatic travel verification, October 9, 2026

The final comparison meets the roughly 10% regression gate for the selected
normal workflows: all three task-showing medians improve. The median cold and
reload targets pass; the **three-second Unlock target remains unmet** at 4.648 s.
The [copied-save travel report](research/automatic-travel-real-save-2026-10-09.md)
separately verifies unchanged roll, task and reachable-scope identities for both
players in all three settings scenarios.

The baseline is archived deployed `c9d765b`; the candidate is the frozen current
application with automatic travel and transport access enabled. Each batch has
three fresh disposable localhost servers and Chrome profiles, using Node
v24.20.0, Chrome/154.0.8037.97, and the same read-only game data/map assets.
The two fixture envelopes differ only in `travel.automatic=true` and
`access.transport=true`; every other saved value and static reference matches.
Consumable teleports stay off. Ordinary prediction prewarming remains on.

The selected scenarios are cold visit, reload and Unlock. Member switching,
30 Mbps throttling, phone/Funnel timing and second-player concurrency are not
measured in this batch. Root-held report workers and heavy test jobs were paused
during benchmarking; unrelated processes were not managed. An ambient host
sample around 02:57 UTC showed approximately 48% CPU load and 9.5 GiB free RAM
of 31.9 GiB. The host was not universally quiet, and OS file caches were not
flushed. These measurements establish the gate for this comparison, rather than
a universal performance guarantee.

Times below are median milliseconds, rounded for display. Percentages use the
unrounded JSON medians.

| Tasks shown | Deployed, N=3 | Automatic and access enabled, N=3 | Change |
| --- | ---: | ---: | ---: |
| Cold visit | 11,122 | 6,241 | -43.9% |
| Reload | 1,589 | 1,361 | -14.4% |
| Unlock → refreshed tasks | 7,640 | 4,648 | -39.2% |

All individual task milestones appear below in run order, including every
outlier; none was discarded. Values are milliseconds.

| Scenario | Deployed runs [1; 2; 3] | Enabled runs [1; 2; 3] |
| --- | --- | --- |
| Cold visit | [10,761; 11,122; 16,431] | [8,155; 5,426; 6,241] |
| Reload | [1,589; 1,585; 2,151] | [3,044; 1,361; 1,281] |
| Unlock → refreshed tasks | [8,978; 7,640; 7,211] | [5,645; 4,036; 4,648] |

The targets used for this automatic-travel check are cold tasks ≤10 s, reload
tasks ≤2 s and Unlock → current tasks ≤3 s. All three cold runs satisfy the
10-second target. Reload's 1.361 s median satisfies its target, but the first
3.044 s reload does not. Every Unlock run exceeds three seconds. The median
regression gate and these absolute latency targets are separate results.

All nine candidate workflows complete with zero failed requests and zero failed
visible tiles. Terrain and network-idle milestones remain distinct; ordinary
death/prediction advisories stay included in idle. Table values are median ms;
the long-task column gives each scenario's median worst browser long task.

| Scenario | Terrain, before → after | Network idle | Longest advisory request | Worst long task |
| --- | ---: | ---: | ---: | ---: |
| Cold visit | 8,269 → 2,644 | 75,172 → 44,820 | 63,506 → 37,691 | 184 → 114 |
| Reload | 3,210 → 2,193 | 5,302 → 2,376 | 1,308 → 152 | 188 → 138 |
| Unlock → refreshed tasks | Retained | 52,793 → 37,353 | 44,213 → 32,426 | 78 → 52 |

The actual maximum browser long task across all nine candidate workflows is
**176 ms**, below 200 ms. Cold transfer is 4,472 KiB versus 4,466 KiB, with two
additional app-code requests. Reload transfers 437 KiB versus 435 KiB.

The candidate's median Unlock reaches Saved at 729 ms; its displayed task
request takes 3,696 ms, including 3,159 ms of engine work. The full
4,648 ms milestone includes the command, save acknowledgement, calculation,
transfer and rendering. Reload is a task-result cache hit: median server request
time is 1.57 ms. Its retained evaluation/stage timing describes the original cold
calculation, not reload CPU time.

Server spawn-to-ready improves from 26,435 to 16,022 ms. Median foreground
compilation is 3,663 ms, selected-rule preparation 1,131 ms and initial play-state
preparation 594 ms. Median RSS is 1,386 / 4,284 MiB at readiness/after, versus
baseline 1,381 / 5,505 MiB.

The implementation bounds exact automatic baseline results to two entries per
engine and memoizes route graphs within an evaluation. A conservative physical
no-op proof skips supply derivation when transport cannot change the exact
reachable scope. Built-in roll checks skip redundant automatic inclusion work
for destinations already fully eligible or unconditionally excluded, including
strict physical access endpoints. Separately verified roll-only destination
certificates retain their own path. The full route API remains unchanged.
Background automatic prewarming pauses while death work is pending or active.
These changes preserve requirements and personal controls; the final six
copied-save calculations retain 16 usable routes per player, seven strict access
and nine roll-only, with unchanged eligible rolls, tasks and own/shared scopes.
Redundant Home/access inclusion reasons for Player 1's already-eligible Burthorpe
are deliberately omitted, while its walking reasons and usable route remain.

Earlier checkpoints are retained, including unsuccessful results:

| Checkpoint | N / configuration | Cold tasks | Reload tasks | Unlock tasks | Result |
| --- | --- | ---: | ---: | ---: | --- |
| First diagnostic | Partial cold, prewarming on | 18,466 | — | — | HTTP 504 from death estimates; rejected |
| Later enabled diagnostic | Partial cold, prewarming on | 14,212 | — | — | HTTP 504 from death estimates; rejected |
| Prewarming disabled | 1, prewarming off | 13,511 | 800 | 25,021 | Diagnostic, not normal configuration |
| Scheduling retry | 1, prewarming on | 10,803 | 2,937 | 19,596 | Reload/Unlock exceed regression band |
| Initial no-op proof | 3, prewarming on | 6,235 | 1,674 | 9,068 | Unlock +18.7%; regression gate failed |
| Final strict pool pruning | 3, prewarming on | 6,241 | 1,361 | 4,648 | Selected median regression gate met |

The retained fingerprints identify the measured source and inputs:

- Baseline: `.local/perf/teleports-deployed-2026-10-10T01-42-48-711Z.{json,md}`;
  original state SHA-256 `b7d0313182e16dd81897f62f0b29d5b22b0e8f49953e5409ed4a6954b032053e`.
- Final: `.local/perf/teleports-automatic-final-2026-10-10T02-59-51-392Z.{json,md}`;
  enabled state SHA-256 `c99cf3aac27be2ea34596bac4148eed59274794d8f9b880c3e8c2cf94e6ae7f8`.
- Final server-entry SHA-256: `3e664f38d7917be099b7ac5ed71161b1fc9ed08a37f00f285f933f249a5bb06a`.
- Final evaluator source hashes and changed-file manifest are in
  [the read-only comparison](research/automatic-travel-real-save-2026-10-09.md#input-integrity-and-verification),
  captured 2026-10-10T02:54:08.187Z; tracked app-diff SHA-256
  `7062fd492f949062b5b7b11713d9d68e4db63e3add5c7fa293e54f0aecfa0b56`.
- Earlier complete reports:
  `teleports-automatic-no-prewarm-2026-10-10T02-16-40-744Z`,
  `teleports-automatic-scheduled-2026-10-10T02-22-38-932Z` and
  `teleports-automatic-proof-2026-10-10T02-51-10-705Z`, each with JSON/Markdown
  under `.local/perf/`.
- Failed captures: `.local/perf/teleports-automatic-diagnostic-failed.json` and
  `.local/perf/teleports-automatic-final-failed.json`.

## Worker idle lifetime and exact unlock reuse — October 10, 2026

The measurements and test counts in this section cover the October 10 checkpoint.
[Current implementation details](task-performance.md#worker-lifecycle-and-exact-unlock-reuse--october-10-2026)
describe later scheduling and transport changes.

**Reviewed selected tasks meet three seconds; uncached Unlock still misses it.**
Final matched reload/Unlock medians stay within the 10% regression band, but
reviewed complete-Group Unlock remains above three seconds. Short-idle probes
confirm retirement of every started worker, and the full test suite passes.

Node v24.20.0 and headless Chrome 154.0.8037.97 ran the current `npm run perf`
harness against an archived baseline and candidate source in this worktree.
Each suite copied the same frozen private save into ignored `.local/perf/`
scratch storage, excluding lock/invitation/feedback/access-token sidecars and
generating its own credential. Assets were shared for read-only access from
the main repository. Owned suites ran serially on ephemeral `127.0.0.1` ports,
excluding 8788–8791, with disposable Chrome profiles and process-owned cleanup.
The host remained shared and busy; unrelated work and unflushed OS caches limit
attribution. These are localhost observations, not device or Funnel validation.

All table entries use three independent repetitions per view, normal prewarming
and `--settlement tasks`. Cold startup conditions every suite before reload and
Unlock. Baselines did not request cold-task scenarios; final batches did. Network
idle is outside this settlement boundary; do not compare its shorter totals with
earlier idle-settlement totals. Personal waits for the selected task list; Group
waits for the complete current duo. Selected rows can paint before that duo event.

**Immediate** Unlock does not first open Preview. **Reviewed** Unlock opens and
waits for Preview before the timed Unlock click. Preview preparation is excluded
from the reported Unlock latency; the two workflows are separate comparisons.
The reviewed result cannot establish immediate-Unlock performance or the cost
of Preview plus Unlock.

| Checkpoint | Workflow / view | Reload tasks ms | Unlock tasks ms |
| --- | --- | ---: | ---: |
| Original baseline | Immediate / personal | 1,590 | 6,789 |
| Original baseline | Immediate / Group | 1,338 | 9,879 |
| Early candidate | Immediate / personal | 2,273 | 8,231 |
| Paired baseline | Reviewed / personal | 1,307 | 7,184 |
| Paired baseline | Reviewed / Group | 1,000 | 4,430 |
| Engine-cache candidate, rejected | Reviewed / personal | 1,143 | 1,219 |
| Engine-cache candidate, rejected | Reviewed / Group | 958 | 6,009 |
| Reduced candidate checkpoint | Reviewed / Group | 963 | 4,979 |
| Reduced candidate before Preview quiet | Reviewed / Group | 993 | 6,196 |
| Final Preview quiet | Reviewed / personal | 977 | 840 |
| Final Preview quiet | Reviewed / Group | 981 | 4,765 |
| Final | Immediate / personal | 762 | 4,817 |
| Final | Immediate / Group | 846 | 4,407 |

The engine-cache candidate's complete-Group median regressed 35.6% against its
reviewed baseline, exceeding the 10% band, despite fast selected rows. Those
access indexes, cross-evaluation expansion plans and lazy task-source changes
were removed. The reduced checkpoint paints selected Unlock rows at a median
866 ms, but complete-Group Unlock is still 12.4% above the paired baseline and
above three seconds. A run whose application source changed during measurement
was rejected by the source-manifest check and is not acceptance evidence. The
single `workers-race-probe` report is diagnostic, not a three-run comparison.

The subsequent reduced checkpoint's complete-Group median was 6,196 ms.
Explicit Preview now pauses queued warming, preserves its active coalesced
producer, and establishes the existing one-second foreground quiet interval.
A controlled-worker server test verifies queued cancellation, active completion,
the pending-Preview pause and post-response quiet. The final Group median is
4,764.8 ms versus 4,430.1 ms baseline (+7.56%); selected rows paint at 618.6 ms.
This supports the scheduling change as a performance hypothesis, not a causal
measurement of background CPU contention. Reviewed personal Unlock is 840.2 ms.
Both reviewed batches record one reuse hit in each of three runs and zero fresh
selected evaluation time. Immediate batches record zero reuse hits in all three
runs and positive evaluation times: their 4,816.9/4,407.1 ms personal/Group
Unlock medians still miss three seconds, including selected Group readiness.

Final cold-task medians are 6,155/14,811 ms personal/complete Group for reviewed
batches and 5,553/11,009 ms for immediate batches. These unthrottled cold results
have no requested baseline counterparts and establish no before/after cold gate.
All twelve final suites complete with zero failed API/asset requests.
Immediate normal-use RSS is 3,098.1 → 3,109.8 MiB personal (+0.38%) and
4,031.0 → 4,214.1 MiB Group (+4.54%); these are post-suite process samples,
not idle memory or continuous peaks. The prediction quota remains 32 MiB total.

The October 10 implementation sleeps foreground, group-peer, death and prediction
workers after interactive inactivity; the default interval is ten minutes.
Sleeping releases rebuildable caches, preserves saves and browser rows, and
waits for worker termination before replacement. Exact complete hypothetical
projections share a 16 MiB reuse quota alongside a 16 MiB prediction-response
quota. Saved-input signatures retain all task inputs except revision, history,
provenance and roll bookkeeping. A preserved active prediction can race fresh
saved calculation; stale Preview responses still reject, and no partial result
is promoted. Group view paints current selected rows while its peer updates.

Provenance and retained artifacts (JSON/Markdown pairs under `.local/perf/`):

- Frozen state SHA256: `7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47`.
- Baseline revision `7d69492e8616e9b110ff9422534e57d0d088ed4e`; app manifest `a4e6cb8d84ad39d9404c03d6e5017feb37a3e6f777740bcbc0864fffa553aa1a`; server entry `5917dfac730efcc0f11cc63daab629164533c2412ae43866a3ae02ba17334edd`. The first personal baseline predates the aggregate manifest.
- Immediate baseline: `workers-before-off-2026-10-10T05-15-12-077Z` and `workers-before-on-2026-10-10T05-19-25-462Z`.
- Early candidate: `workers-after-off-2026-10-10T05-36-06-867Z`, app manifest `83268ccc1699ca57b6ca45eb6f260f14982a77da0ec79d17f68339d8be23c6bb`.
- Reviewed baseline: `workers-reviewed-before-off-2026-10-10T05-44-33-087Z` and `workers-reviewed-before-on-2026-10-10T05-51-19-970Z`.
- Rejected candidate: `workers-reviewed-after-off-2026-10-10T05-47-42-659Z` and `workers-reviewed-after-on-2026-10-10T05-54-56-612Z`, app manifest `e5d89549f169944a247f44ee1eb6f8a7d62c6a7a6e1baa5adfdde1465c467b75`.
- Reduced Group checkpoint: `workers-final-reviewed-on-2026-10-10T05-58-50-490Z`, app manifest `bece303957eba4db55bea77ea47431f06aea0419685600d3f6619f162fe1c5e0`.
- Earlier candidate server-entry hash: `639c915a85f2eb7d04eb794121dbbc413b9f4519772502c8033bd532dc392193`. Aggregate manifests distinguish scheduler/worker changes.
- Pre-quiet checkpoint: `workers-complete-reviewed-on-2026-10-10T06-08-07-368Z`.
- Final reviewed: `workers-preview-quiet-off-2026-10-10T06-15-41-489Z` and `workers-preview-quiet-on-2026-10-10T06-13-10-145Z`.
- Final immediate: `workers-final-immediate-off-2026-10-10T06-17-20-710Z` and `workers-final-immediate-on-2026-10-10T06-19-49-443Z`.
- All four final batches share app manifest `2e21c50eac58a04ca8129c9ee8a151a44a5ecac0dba4a659bf2a94545399f2ce` and server-entry hash `62abc1a30863ff5df15daaf1a98a4a3621781cd2266c8f32f1b356ac6182194a`.

The read-only copied-save proof `.local/check/worker-unlocks-final.json` reports
`allEquivalent: true`: both player unlock scenarios have equal task-input
signatures and all six personal/peer/sidebar projection comparisons match fresh
saved calculations, normalizing elapsed time only. Its app-only tuple hash
`9c9e0ca364dd13a4d9cadc1405c8841cc7d07de20360d9c2bfc821733ce2f078`
uses a different manifest format from the browser reports and is not their hash.

| Copied-save unlock | Player 1 possible / active tasks | Player 2 possible / active tasks |
| --- | --- | --- |
| Player 1: Burthorpe (11575) | 1,650 → 1,657 / 25 → 25 | 1,626 → 1,626 / 26 → 26 |
| Player 2: Anya's Tent (17201) | 1,650 → 1,650 / 25 → 25 | 1,626 → 1,627 / 26 → 26 |

The unchanged active lists include Player 1's gravite melee weapon and anchovy
pizza, and Player 2's gravite magic and ranged weapons. Partner ownership and
personal progress are unchanged in both independent unlock scenarios.

### Short-idle observations

These single-run probes use `RS3_WORKER_IDLE_MS=10000` and a fixed 50-second
observation without interaction, forced GC or cancellation. They exercise the
same app manifest `2e21c50eac58a04ca8129c9ee8a151a44a5ecac0dba4a659bf2a94545399f2ce`.
They are diagnostics, not three-run medians or a measurement of the production
600000 ms default. A fake-clock test separately verifies that default's full
ten-minute lifetime.

| View | Ready RSS MiB | Normal-use RSS MiB | After-wait RSS MiB | After-wake RSS MiB | Worker state at wait boundary |
| --- | ---: | ---: | ---: | ---: | --- |
| Personal | 1,438.4 | 3,101.7 | 691.4 | 1,659.4 | Foreground, prediction and death sleeping/nonresident; duo never created |
| Group | 1,436.1 | 4,244.5 | 857.8 | 2,861.3 | All four lanes sleeping/nonresident |

| View | Actual wait ms | Selected wake tasks ms | Complete duo wake tasks ms | Visible terrain ms | Selected task-cache hit |
| --- | ---: | ---: | ---: | ---: | --- |
| Personal | 50,004.0 | 9,641.6 | — | 1,736.1 | No |
| Group | 50,008.7 | 9,849.8 | 9,849.8 | 2,005.4 | No |

At both wait snapshots all created lanes are nonresident with empty
caches and no active or queued work. This instantaneous snapshot does not prove
continuous inactivity throughout the wait. Earlier 20-second personal/Group
probes are partial-retirement checkpoints: death remains resident despite empty
queues. Its advisory is scheduled 120 ms after task rendering; a result completes
during the observation and resets that lane's own idle clock. Those reports do
not retain the exact completion time.

Wake reload retains browser HTTP cache and settles at tasks/visible tiles,
excluding later advisories. It rebuilds server task state after retirement and
misses the selected task cache; it is neither ordinary warm reload nor a fresh
browser's cold first visit. Its latency is outside the ordinary scenario medians.
Retained reports: `workers-idle-all-off-2026-10-10T06-29-18-055Z` and
`workers-idle-all-on-2026-10-10T06-31-11-743Z`.
Settled personal screenshots are under
`.local/perf/workers-idle-all-off-screenshots-2026-10-10T06-27-52-588Z/`:
`run-1-normal-desktop-gray.png` (1440×900) and
`run-1-normal-mobile-390px-light.png` (390×844), both DPR 1.
Group captures use the same filenames under
`.local/perf/workers-idle-all-on-screenshots-2026-10-10T06-29-38-065Z/`.

Immediate Unlock can arrive before prediction worker compilation and its
separate baseline calculation have finished. Exact reuse therefore cannot
reliably satisfy the uncached three-second target; further work is needed. No
incremental evaluator or partial-output engine is implemented in this change.

October 10 final `npm test`: 2,256 tests, 2,255 passed, zero failed/cancelled, one existing
generated-PNG check skipped, in 283.59 seconds. Fake-clock tests cover all four
lanes, the full default interval, in-flight/queued requests, abandoned warming,
termination/wake races and long timer intervals. Server tests preserve durable
saves and the same SSE connection across sleep, and verify cache rebuilding;
prediction tests compare complete outputs and exercise superseded saves,
coalesced races, disconnects and bounded retention. Browser tests cover waking
text and selected Group rows before the peer finishes. Prediction goldens and
`.gitattributes` remain unchanged.

All owned measurement servers and Chrome processes closed. Harness scratch-save
directories were removed, and the private `.local/workers-save` copy was deleted
after the final real-save checks. Reports, hashes and screenshots remain ignored
in this worktree. The live picker and main checkout were not changed. The
uncached three-second target remains unmet.

## Map display — October 12, 2026

The new live size controls show no observed reload regression against their
worktree baseline. Node v24.20.0 and headless Chrome 154.0.8037.98 ran
`npm run perf -- --source .local/duo --runs 3 --scenarios reload --settlement tasks`
serially for baseline and candidate. Both used normal prewarming, personal view,
the same frozen copied save, and read-only main-checkout game/map assets. Each
repetition started one isolated localhost server and disposable Chrome profile,
then stopped both. Protected ports, the live picker and Tailscale were untouched.

| Median measure | Before | Map display | Change |
| --- | ---: | ---: | ---: |
| Reload tasks | 3,084 ms | 1,235 ms | −59.9% |
| Reload visible terrain | 4,339 ms | 2,389 ms | −44.9% |
| Reload long-task total | 531 ms | 492 ms | −7.3% |
| Reload transfer | 461 KiB | 463 KiB | +0.4% |
| Server spawn to ready | 22,803 ms | 18,281 ms | −19.8% |
| Server RSS ready / after | 1,366 / 2,037 MiB | 1,364 / 1,804 MiB | −0.1% / −11.4% |

All six measured reloads completed without failed API or asset requests. The two
new frontend files add two app-code requests; no new task work is introduced.
The host was shared and busy, and caches were not flushed between batches, so
the faster candidate timings do not establish a speedup caused by this panel.
These measurements cover warm personal-view reload only; Group view and phone
dimensions were checked separately for visual behavior, not timed here.

The first final-source attempt stopped when Chrome's CDP probe timed out during
its second cold conditioning visit. Its one completed reload (3,308ms tasks,
5,145ms visible terrain) remains in the partial report and is not the regression
comparison. Cleanup completed before the successful same-settings three-run retry.
An earlier complete candidate batch preceded the overflow-artwork cache fix and
is superseded by the final-source retry above.

The browser-only size probe performed forty rapid changes to each slider. It
observed one state redraw, one marker redraw, zero terrain redraws and zero API
requests. Ownership, selected chunks, pending rolls, rank order, revision,
History and both players' active task counts were unchanged. Saved appearance
controls retain their existing command path and are outside that local-only
probe. [Map display](map-display.md#copied-save-check--october-12-2026) records
the 1440px/390px theme, sticker and dual-flag checks.

Provenance and ignored artifacts:

- Baseline source: `f20a2cdac2e8f418e6a14fe426638e2f2b2785b1`, archived inside this
  worktree for measurement. Candidate source: this worktree based on that commit.
- Frozen state SHA256: `c5f3a5744238d2f9d43355c3e49b40109823c9221d1419ee0611f25e1f14928d`.
- Baseline app manifest: `d26c3b8af9ffef47a6abc933858ed6466e83f2fc678cc21f8bfab0437be6e7a7`;
  candidate: `2408ae40bb9da87e5c1f262b76f5e48f895f135328ad922259291463abe0e2d5`.
- Baseline server entry: `c2b7d8045d0720cffe6bacb180b4f0454608d3437b767910ff8b813e14b27ad9`;
  candidate: `df64c06504bc0d8e999893ed0c2fed313c54e98b180fabcd90eb270ced48586b`.
- JSON/Markdown pairs: `.local/perf/display-before-2026-10-12T07-49-26-250Z`
  and `.local/perf/display-final-retry-2026-10-12T08-27-02-215Z`.
- Earlier candidate: `.local/perf/display-after-2026-10-12T08-04-25-036Z`;
  stopped final attempt: `.local/perf/display-after-final-2026-10-12T08-22-10-892Z-partial.json`.
- Visual assertions and captures: `.local/display-visual-check.json`,
  `.local/display-viewer-check.json` and
  `.local/display-screenshots/` (private, ignored).

Prediction goldens and `.gitattributes` remain unchanged. Private copied saves,
scratch profiles and owned browser/server processes were removed after checks.
Final `npm test`: 2,480 tests, 2,479 passed, zero failures, one existing
generated-PNG check skipped (732.37 seconds).
