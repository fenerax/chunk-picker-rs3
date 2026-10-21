# Unlock calculation and browser profile — October 12, 2026

The one-second Unlock-to-current-tasks goal was reached in Player 2’s reviewed Personal workflow: all three samples are below one second, with median 909 ms and p90 961 ms. Player 1’s reviewed Personal median is 1,195 ms, and both reviewed Group medians remain above six seconds. The eight workflow cells are recorded; the initial Player 1 Group batch retains two completed Unlock samples because its third cold conditioning failed. This is a diagnosis of the existing application, with no measured implementation speedup.

The cold calculation is dominated by the task engine. Across 16 independent unlocks, the selected compact worker median is 5.582 seconds and the peer median is 5.494 seconds. The selected engine median is 4.442 seconds. Exact Preview reuse can avoid a selected calculation, but it does not precompute the peer. Player 1’s one-second Unlock-to-current-tasks goal remains unsupported for uncached calculations.

Full task responses add substantial serialization and parsing costs. Their roughly 58 MB of uncompressed JSON is separate from the roughly 592 kB sidebar/peer projections. Improving full hydration alone would not remove the compact engine cost.

## Inputs, scope and method

Measurements use Node v24.20.0, Windows, headless Chrome/154.0.8037.98 and a 1440×900 viewport at DPR 1. The retained browser environment records an Intel Core i7-8700K, 12 logical cores and 32 GiB RAM. These are localhost measurements on a shared host. CPU load and OS caches were not controlled; browser and Node batches were sequentially owned, while unrelated host activity remains a limitation.

The initial Player 1 baseline batches are busy-host evidence: root observed concurrent unrelated perf work and saturated host CPU, then held subsequent heavy runs until those jobs exited. This is observational context, not a measured causal adjustment. The Player 1/Player 2 timing gap cannot be attributed to the player alone; batch conditions and chunk choices also differ.

The fixture is the frozen `.local/speed-save` copy, with read-only map/game assets from the main checkout. The harness mutates scratch saves or in-memory state only. The original source snapshot and all referenced static files remain unchanged. This report contains IDs, counts, hashes and timings, without reproducing saved-state contents.

Browser runs condition each independent server/browser with a cold visit before Unlock. Personal settlement waits for selected tasks; Group settlement waits for the complete current duo. `--settlement tasks` does not wait for all advisories. Browser cold/terrain data and late background work are outside the Unlock milestone. The third initial Group repetition failed during cold conditioning with a peer `/api/tasks` HTTP 504, before a timed Unlock. Its two completed Unlock repetitions remain N=2 evidence; no replacement or three-run Group median is inferred.

`unlock-calc.mjs` hydrates and validates the copied fixture, reuses its current migration, then applies independent `set-chunk` commands in memory. It uses one native worker, never a writable store, server or browser. Each case evaluates selected compact, selected full, peer compact and peer full sequentially. Worker snapshot/result caches are cleared for each request; compiled definitions remain warm. The two baseline full results and three targeted inspector requests are outside the 16-case aggregates. This order limits attribution of differences between compact and full medians.

Native V8 sampling was enabled throughout the Node run with `--cpu-prof --cpu-prof-dir=.local/perf`; ordinary Node timings are therefore sampled-profile timings, not fully unprofiled timings. Three targeted inspector profiles were started afterward and excluded from the ordinary aggregates. Their profiler startup adds material overhead, documented below.

Every table entry labelled median / p90 uses nearest-rank p90; at N=3 it is the maximum, and at N=2 it is also the maximum. Per-stage medians need not add to the median total. Nested engine phases and inclusive CPU samples overlap.

## Browser results

`any` uses an ordinary eligible/selected choice and can benefit from automatic prewarming. The first Player 1 personal batch recorded prediction-cache evidence `[true, false, false]` for the same chunk 11575. It is a mixed warm/cold batch, not an all-cold baseline and not an explicit Preview workflow. A hit inferred from `hit=true` and `evaluationMs=0` is recorded separately from an explicit `unlockPredictionHit` field, which was absent on that first hit.

`unprepared` deliberately selects a locked surface chunk outside every candidate this member’s normal prewarmer can enqueue: selected choices, pending rolls and eligible roll-pool entries (`scripts/perf/page-load.mjs:588–596`). It requires Preview off and asserts a measured prediction miss after Unlock (`scripts/perf/page-load.mjs:607`). All six Player 2 unprepared samples pass that assertion. The mixed Player 1 default-`any` workflow is the warming race; it does not describe the new conservative `unprepared` option. `prepared` opens Preview and waits for its result before the timed Unlock, then asserts a measured prediction hit (`scripts/perf/page-load.mjs:608`). The normalized measurement accepts either explicit flags or the recorded hit/evaluation evidence. All 12 prepared samples pass. Preview time is excluded, so reviewed results do not establish immediate-Unlock latency or Preview-plus-Unlock cost.

The eight-case comparison uses the two fresh samples from Player 1’s default-`any` Personal batch. Its median is 11,150.7 ms and p90 11,443.8 ms, N=2. The complete mixed three-run workflow remains separately visible below; no run is discarded. Those fresh samples still use a normally warmable choice, whereas Player 2’s conservative unprepared samples use a choice outside the warmable set. Different players, choices and batch times prevent a causal before/after comparison between those rows.

| Batch | Member / view | Workflow | N | Selected tasks ms | Complete settlement ms | Saved ms | Reuse evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| speed-base-off | Player 1 / Personal | Any fresh subset, Preview off | 2 | 11,150.7 / 11,443.8 | 11,150.7 / 11,443.8 | 1,300.9 / 1,449.7 | [false,false] |
| speed-base-on | Player 1 / Group | Any fresh, Preview off | 2 | 12,821.5 / 15,061.3 | 14,326.5 / 18,071.5 | 3,483.7 / 5,831.6 | [false,false] |
| speed-base-player2-off | Player 2 / Personal | Unprepared, Preview off | 3 | 6,780.2 / 8,300.0 | 6,780.2 / 8,300.0 | 410.6 / 748.2 | [false,false,false] |
| speed-base-player2-on | Player 2 / Group | Unprepared, Preview off | 3 | 7,725.8 / 8,322.7 | 7,725.6 / 8,322.6 | 418.2 / 591.1 | [false,false,false] |
| speed-prepared-player1-off | Player 1 / Personal | Prepared, Preview on | 3 | 1,195.1 / 1,416.9 | 1,195.1 / 1,416.9 | 302.5 / 378.6 | [true,true,true] |
| speed-prepared-player1-on | Player 1 / Group | Prepared, Preview on | 3 | 1,006.7 / 2,734.1 | 7,157.1 / 13,320.5 | 362.5 / 967.6 | [true,true,true] |
| speed-prepared-player2-off | Player 2 / Personal | Prepared, Preview on | 3 | 909.2 / 960.6 | 909.2 / 960.6 | 242.0 / 249.6 | [true,true,true] |
| speed-prepared-player2-on | Player 2 / Group | Prepared, Preview on | 3 | 930.9 / 1,080.2 | 6,714.7 / 7,497.4 | 340.1 / 430.0 | [true,true,true] |

The original mixed workflow remains an ordinary-use observation with automatic warming:

| Whole mixed workflow | N | Selected/settled tasks ms | Saved ms | Reuse evidence |
| --- | --- | --- | --- | --- |
| Player 1 Personal, default any | 3 | 10,857.6 / 11,443.8 | 1,449.7 / 4,054.8 | [true,false,false] |


Prepared Player 1 Personal reaches current selected tasks at a median 1,195 ms, above the one-second goal. Prepared Group reaches selected rows at a median 1,007 ms and the complete duo at 7,157 ms; all three selected requests assert `unlockPredictionHit=true` with zero evaluation time. The first Group run reaches complete duo at 13,321 ms. Player 2’s prepared Group median is 6,715 ms with p90 7,497 ms, even though selected reuse succeeds in every run. Exact selected reuse therefore does not establish the Group goal. The small sub-millisecond reversal between selected/duo markers in Player 2’s immediate Group row comes from marker placement and does not establish an earlier partially settled result.

The completed prepared Group trace records no `/api/chunk-planning` request during Unlock. It records a death-estimate batch roughly 120–132 ms after selected paint while the peer still computes. This establishes advisory overlap, without isolating its effect on peer CPU time.

| Prepared Group run | Selected paint ms | Selected server request ms | Peer worker ms | Peer engine ms | Death request starts ms | Complete duo ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2,734.1 | 1,433.4 | 10,441.5 | 8,920.3 | 2,863.9 | 13,320.5 |
| 2 | 1,006.7 | 459.5 | 6,154.8 | 4,952.3 | 1,138.8 | 7,157.1 |
| 3 | 668.1 | 280.5 | 5,211.8 | 4,217.1 | 790.3 | 5,894.1 |

The first personal batch separates command, calculation and rendering as follows. These stages refer to individual requests; the first run was a cache hit.

| Run | Hit | Saved ms | Worker ms | Server request ms | Outside-worker residual ms | Body → selected paint ms | Foreground active before Unlock |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | true | 4,054.8 | 0.0 | 2,032.2 | 2,032.2 | 313.7 | 0 |
| 2 | false | 1,449.7 | 7,395.8 | 8,647.9 | 1,252.1 | 155.5 | 1 |
| 3 | false | 1,152.1 | 8,266.9 | 9,684.1 | 1,417.2 | 256.0 | 1 |

The two uncached request residuals are 1,252 and 1,417 ms, with foreground work active just before Unlock. The residual includes queue waiting, snapshot/dispatch costs and response handling; it is not a measured pure queue duration. The first hit still spends 2,032 ms in the server request and reaches selected paint at 7,485 ms, showing that zero worker evaluation is not zero end-to-end cost. Separate renderer read/parse and indexing timestamps are absent from these initial artifacts; body-to-paint is their combined observable tail.



## Browser critical-path stages

Each cell is median / p90. Labels M/R identify Player 1/Player 2, P/G identify Personal/Group, and fresh/prepared identify the workflow. The M/P fresh row uses the same N=2 subset as the eight-case table; the original mixed run remains above. Other rows use N=3 except the initial M/G fresh row, N=2. Absolute points are measured from the Unlock click.


| Case | Command headers ms | Saved ms | Selected task starts ms | Selected task headers ms | Selected body ends ms | Selected paint ms | Complete settlement ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M/P fresh (N=2) | 1,225.5 / 1,384.3 | 1,300.9 / 1,449.7 | 1,359.3 / 1,487.5 | 10,920.5 / 11,160.0 | 10,944.9 / 11,187.8 | 11,150.7 / 11,443.8 | 11,150.7 / 11,443.8 |
| M/G fresh (N=2) | 3,433.3 / 5,781.9 | 3,483.7 / 5,831.6 | 3,519.9 / 5,865.9 | 12,755.1 / 14,999.2 | 12,763.5 / 15,004.1 | 12,821.5 / 15,061.3 | 14,326.5 / 18,071.5 |
| R/P fresh (N=3) | 328.0 / 679.2 | 410.6 / 748.2 | 515.2 / 852.2 | 6,598.5 / 8,092.7 | 6,624.6 / 8,115.8 | 6,780.2 / 8,300.0 | 6,780.2 / 8,300.0 |
| R/G fresh (N=3) | 316.5 / 509.1 | 418.2 / 591.1 | 528.0 / 693.8 | 7,664.0 / 8,240.5 | 7,663.1 / 8,253.0 | 7,725.8 / 8,322.7 | 7,725.6 / 8,322.6 |
| M/P prepared (N=3) | 230.6 / 295.8 | 302.5 / 378.6 | 405.5 / 491.3 | 1,001.3 / 1,184.2 | 1,025.1 / 1,215.3 | 1,195.1 / 1,416.9 | 1,195.1 / 1,416.9 |
| M/G prepared (N=3) | 316.0 / 917.2 | 362.5 / 967.6 | 470.6 / 1,072.4 | 953.5 / 2,644.5 | 952.6 / 2,662.0 | 1,006.7 / 2,734.1 | 7,157.1 / 13,320.5 |
| R/P prepared (N=3) | 190.6 / 199.2 | 242.0 / 249.6 | 344.9 / 360.1 | 758.6 / 786.5 | 785.0 / 801.9 | 909.2 / 960.6 | 909.2 / 960.6 |
| R/G prepared (N=3) | 208.6 / 325.0 | 340.1 / 430.0 | 444.2 / 536.6 | 889.2 / 1,038.3 | 887.8 / 1,037.4 | 930.9 / 1,080.2 | 6,714.7 / 7,497.4 |
Durations below separate the HTTP request from the worker. The server-request residual is `requestMs − evaluationMs` and includes snapshot/dispatch/result costs as well as any queue wait. Fetch `jsonReadParseMs` includes remaining body arrival and browser scheduling, not only JSON parser CPU. Parse-to-paint contains indexing, acceptance, scheduling and rendering; it is a bounded observable residual, not pure rendering CPU.

Raw timing values are preserved; sub-millisecond negative body-transfer intervals, such as −0.9 ms, are approximately zero timing artifacts because the collector adds `timing.receiveHeadersEnd` to a `requestWillBeSent` start from a different timing basis, not negative physical transfer.

| Case | Selected HTTP duration ms | Server request ms | Worker ms | Request − worker ms | Body transfer ms | Read + parse ms | Parse → selected paint ms | Latest task body → settlement ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M/P fresh (N=2) | 9,585.6 / 9,956.6 | 9,166.0 / 9,684.1 | 7,831.3 / 8,266.9 | 1,334.6 / 1,417.2 | 24.4 / 27.7 | — | — | 205.8 / 256.0 |
| M/G fresh (N=2) | 9,243.6 / 9,349.0 | 8,900.7 / 9,164.3 | 7,957.0 / 8,027.9 | 943.7 / 1,278.2 | 8.4 / 11.9 | — | — | 52.8 / 58.7 |
| R/P fresh (N=3) | 6,109.4 / 7,263.6 | 5,934.1 / 7,103.1 | 5,810.5 / 6,381.7 | 123.6 / 721.4 | 23.0 / 26.0 | 86.3 / 94.5 | 112.0 / 120.9 | 174.2 / 184.2 |
| R/G fresh (N=3) | 7,222.4 / 7,559.2 | 7,127.4 / 7,508.0 | 7,032.9 / 7,426.0 | 82.0 / 94.5 | -0.9 / 12.5 | 13.9 / 26.9 | 55.3 / 66.2 | 69.6 / 74.5 |
| M/P prepared (N=3) | 619.7 / 724.0 | 496.7 / 558.1 | 0.0 / 0.0 | 496.7 / 558.1 | 31.1 / 35.9 | 106.0 / 116.3 | 101.7 / 116.3 | 170.0 / 201.6 |
| M/G prepared (N=3) | 482.0 / 1,589.6 | 459.5 / 1,433.4 | 0.0 / 0.0 | 459.5 / 1,433.4 | -0.9 / 17.5 | 15.5 / 38.4 | 41.8 / 51.1 | 46.6 / 47.4 |
| R/P prepared (N=3) | 424.9 / 457.0 | 329.4 / 363.8 | 0.0 / 0.0 | 329.4 / 363.8 | 15.3 / 26.4 | 66.5 / 84.5 | 68.2 / 107.5 | 124.2 / 158.7 |
| R/G prepared (N=3) | 481.4 / 500.8 | 464.4 / 479.3 | 0.0 / 0.0 | 464.4 / 479.3 | -0.9 / 15.3 | 10.2 / 24.2 | 31.4 / 33.3 | 42.8 / 44.0 |
Latest task body is the maximum completed `/api/tasks` body-end time, recomputed from the request records. It can differ from the summary’s start-order-based `lastBodyToPaint` when the peer finishes before selected tasks. Initial artifacts lack separate parse observations; their cells remain unrecorded rather than being estimated.

| Selected browser-request worker stage, ms | Engine | Collection | Equipment | Presentation | Current BiS | Activity Info |
| --- | --- | --- | --- | --- | --- | --- |
| M/P fresh (N=2) | 6,466.4 / 6,677.2 | 48.9 / 52.2 | 281.6 / 398.5 | 486.4 / 527.5 | 0.0 / 0.0 | 0.0 / 0.0 |
| M/G fresh (N=2) | 6,185.1 / 6,332.9 | 67.3 / 78.6 | 223.5 / 261.0 | 503.5 / 505.4 | 0.0 / 0.0 | 0.0 / 0.0 |
| R/P fresh (N=3) | 4,763.7 / 5,365.2 | 19.6 / 22.4 | 136.8 / 150.4 | 343.2 / 364.4 | 0.0 / 0.0 | 0.0 / 0.0 |
| R/G fresh (N=3) | 5,658.6 / 6,000.6 | 43.3 / 43.5 | 170.2 / 240.6 | 372.8 / 440.6 | 0.0 / 0.0 | 0.0 / 0.0 |
| M/P prepared (N=3) | — | — | — | — | — | — |
| M/G prepared (N=3) | — | — | — | — | — | — |
| R/P prepared (N=3) | — | — | — | — | — | — |
| R/G prepared (N=3) | — | — | — | — | — | — |
Prepared selected responses have zero worker evaluation and no fresh stage timings. Their unrecorded engine/view stages are shown as —; the request and browser costs remain measured. These browser-request stages are separate from the direct Node 16-case stages below.

| Group peer tail, ms | Peer HTTP duration | Peer worker | Peer engine | Peer read + parse | Latest parse → duo paint |
| --- | --- | --- | --- | --- | --- |
| M/G fresh (N=2) | 10,449.8 / 12,158.3 | — | — | — | — |
| R/G fresh (N=3) | 6,513.7 / 6,904.8 | 6,298.3 / 6,760.6 | 4,955.9 / 5,465.7 | 9.1 / 10.6 | 55.2 / 66.0 |
| M/G prepared (N=3) | 6,640.4 / 12,200.3 | 6,154.8 / 10,441.5 | 4,952.3 / 8,920.3 | 9.0 / 26.7 | 35.2 / 35.4 |
| R/G prepared (N=3) | 6,267.9 / 6,917.4 | 5,772.4 / 6,349.8 | 4,680.7 / 5,229.7 | 9.1 / 12.7 | 30.6 / 33.6 |
The initial Group artifact retains both task HTTP requests but lacks peer worker/read-parse response metadata. Its peer stage cells remain unrecorded. Later response observations identify members explicitly.

| Case | Long-task total ms | Worst long task ms | Selected wire bytes | Selected decoded bytes | Server RSS ready MiB | Server RSS after MiB |
| --- | --- | --- | --- | --- | --- | --- |
| M/P fresh (N=2) | 202.5 / 344.0 | 82.0 / 103.0 | 396,857 / 396,857 | 4,512,101 / 4,512,102 | 1,305.8 / 1,384.6 | 3,401.7 / 3,588.3 |
| M/G fresh (N=2) | 0.0 / 0.0 | 0.0 / 0.0 | 77,890 / 77,891 | 590,442 / 590,446 | 1,361.3 / 1,385.3 | 4,440.7 / 4,593.4 |
| R/P fresh (N=3) | 78.0 / 123.0 | 65.0 / 78.0 | 393,422 / 393,463 | 4,454,280 / 4,454,283 | 1,367.7 / 1,368.8 | 3,110.9 / 3,525.1 |
| R/G fresh (N=3) | 97.0 / 145.0 | 93.0 / 97.0 | 77,840 / 77,846 | 592,986 / 592,988 | 1,370.9 / 1,375.8 | 3,822.1 / 3,926.4 |
| M/P prepared (N=3) | 203.0 / 247.0 | 87.0 / 98.0 | 396,755 / 396,762 | 4,511,893 / 4,511,893 | 1,376.8 / 1,456.5 | 3,387.0 / 3,437.7 |
| M/G prepared (N=3) | 0.0 / 0.0 | 0.0 / 0.0 | 77,799 / 77,800 | 590,238 / 590,238 | 1,370.3 / 1,437.1 | 4,725.3 / 4,925.3 |
| R/P prepared (N=3) | 0.0 / 58.0 | 0.0 / 58.0 | 393,212 / 393,219 | 4,453,917 / 4,453,918 | 1,437.0 / 1,437.8 | 3,362.7 / 3,524.8 |
| R/G prepared (N=3) | 99.0 / 126.0 | 99.0 / 126.0 | 77,855 / 77,866 | 592,510 / 592,511 | 1,366.5 / 1,367.6 | 4,685.5 / 4,688.2 |
RSS ready/after are process snapshots, not idle measurements or continuous peaks. Wire bytes include network/header overhead and compression; decoded bytes describe the selected response. The separate Node sampled peak includes its benchmark consumer and worker.

### A measured roughly five-second unprepared path

Player 2 Personal run 3 unlocks chunk 7463 outside the warmable set. Its prediction miss is asserted. The retained summary records selected paint at 5,133.1 ms. The foreground lane is inactive with no queued task at the before-Unlock snapshot; the 70.3 ms request residual does not explain the roughly five-second total. Worker evaluation is 4,437.7 ms, including 3,752.8 ms in the engine, so compulsory calculation dominates this example. Background worker startup still makes the snapshot non-quiescent; the observation is not a controlled no-contention experiment.

| Chronology point | Since Unlock click, ms |
| --- | --- |
| Command response headers | 191.6 |
| Saved acknowledgement | 235.4 |
| Selected task request starts | 344.4 |
| Selected task response headers | 4,949.9 |
| Selected task body complete | 4,958.9 |
| Browser read/parse completes | 5,021.1 |
| Selected tasks painted | 5,133.1 |

| Measured duration | ms |
| --- | --- |
| Task HTTP duration | 4,614.5 |
| Server request | 4,508.0 |
| Worker evaluation | 4,437.7 |
| Server request outside worker | 70.3 |
| Engine | 3,752.8 |
| Collection | 18.1 |
| Equipment | 116.3 |
| Presentation | 250.6 |
| Other worker time, total minus named stages | 299.9 |
| Body transfer | 9.0 |
| Browser read + parse, overlaps body/scheduling | 71.1 |
| Read/parse end → selected paint | 112.0 |
The task request starts roughly 109 ms after Saved, matching the application’s 100 ms task-refresh scheduling delay. A 4.44-second worker result plus request/response and the final 112 ms parse-to-paint tail accounts for the observed path without assigning the delay to a speculative long queue. Browser/HTTP and worker clocks are different measurements; use their recorded intervals instead of summing overlapping phases.

## Worker stages

Each cell is median / p90 milliseconds, N=16. The compact selected request includes the Group sidebar projection. A Personal request would return ordinary play bytes and avoid that extra sidebar projection, measured here at 196 / 226 ms. The compact peer request includes the duo projection, 25 / 36 ms. Current BiS and Activity Info are omitted from compact worker requests.

| Stage | Selected compact | Peer compact | Selected full | Peer full |
| --- | --- | --- | --- | --- |
| Worker total | 5,582.2 / 6,604.5 | 5,494.1 / 6,956.3 | 6,530.1 / 7,717.9 | 6,367.7 / 7,025.1 |
| Task engine | 4,442.2 / 5,469.5 | 4,446.2 / 5,726.4 | 3,973.8 / 5,125.2 | 4,172.1 / 4,686.0 |
| Collection | 14.0 / 32.6 | 17.7 / 41.2 | 15.8 / 26.7 | 15.4 / 31.8 |
| Equipment | 154.4 / 206.1 | 163.9 / 239.7 | 146.7 / 184.5 | 151.5 / 278.0 |
| Presentation | 368.9 / 470.0 | 366.8 / 427.7 | 326.2 / 415.7 | 370.0 / 515.7 |
| Current BiS | 0.0 / 0.0 | 0.0 / 0.0 | 67.4 / 79.7 | 63.5 / 76.4 |
| Activity Info | 0.0 / 0.0 | 0.0 / 0.0 | 155.7 / 298.6 | 140.4 / 178.9 |
| Prediction | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |
| Death estimator | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 | 0.0 / 0.0 |

The fixed-point, access, source and provenance rows below are nested phase budgets inside the engine. Access evaluation includes its resource collection and diagnostic work. The final diagnostics-concatenation timer is only a few milliseconds; it does not include every earlier diagnostic call. This distinction matters because access diagnostic construction appears among the sampled CPU hot functions.

| Instrumented phase | Selected compact | Peer compact | Selected full | Peer full |
| --- | --- | --- | --- | --- |
| Inner fixed-point passes | 2,977.9 / 3,327.6 | 2,900.0 / 3,478.9 | 2,748.3 / 3,538.8 | 2,853.1 / 3,443.0 |
| Raw access evaluation | 1,641.2 / 2,021.6 | 1,515.8 / 1,927.2 | 1,525.9 / 1,852.1 | 1,509.3 / 1,830.7 |
| Base item-source derivation | 787.6 / 900.6 | 783.5 / 1,105.6 | 658.7 / 1,003.2 | 708.3 / 919.7 |
| Processing selection | 108.7 / 121.4 | 119.8 / 138.5 | 105.6 / 132.8 | 102.6 / 126.3 |
| Final task rows / provenance | 691.9 / 919.6 | 668.1 / 870.0 | 644.6 / 985.2 | 633.2 / 744.7 |
| Final diagnostic assembly | 3.0 / 3.7 | 3.0 / 4.8 | 3.5 / 18.3 | 3.0 / 4.3 |
| Worker state decode + JSON.parse | 223.2 / 288.0 | 230.4 / 325.3 | 234.5 / 577.5 | 238.0 / 277.3 |
| Personal play projection | 81.3 / 92.0 | 74.1 / 84.1 | 77.0 / 96.4 | 70.3 / 96.5 |
| Group sidebar projection | 196.1 / 226.0 | — | — | — |
| Peer duo projection | — | 25.1 / 36.3 | — | — |
| Result JSON.stringify + Buffer | 86.3 / 101.2 | 91.4 / 105.1 | 1,116.9 / 1,391.4 | 1,061.4 / 1,148.9 |
| Result stringify + shared-buffer copy | 88.9 / 105.0 | 95.1 / 110.1 | 1,150.6 / 1,436.8 | 1,099.1 / 1,206.1 |


## Input, response and memory costs

Input `JSON.stringify` reconstructs the entire calculation state for this diagnostic. Production storage retains immutable static serialized strings, so this is a cold upper-bound construction rather than a measured server saving. The separate shared-copy and decode times remain relevant to the existing transport. `roundTripMs − evaluationMs` includes dispatch/event-loop and response delivery; it is not pure transfer CPU. The calculation/transport total excludes response JSON parsing and all equality hashing.

| Outer stage, ms | Selected compact | Peer compact | Selected full | Peer full |
| --- | --- | --- | --- | --- |
| Cold input stringify + Buffer | 316.0 / 436.9 | 329.1 / 415.8 | 342.0 / 500.5 | 326.0 / 372.3 |
| Input SharedArrayBuffer copy | 9.3 / 15.7 | 9.6 / 12.1 | 9.6 / 15.7 | 9.0 / 10.8 |
| Worker transfer / dispatch residual | 1.2 / 49.6 | 1.1 / 69.4 | 1.8 / 56.6 | 1.0 / 13.1 |
| Worker request round trip | 5,583.2 / 6,654.2 | 5,496.5 / 6,957.6 | 6,531.2 / 7,718.8 | 6,370.0 / 7,049.8 |
| Response envelope assembly | 0.4 / 4.1 | 0.4 / 0.6 | 37.4 / 96.8 | 36.5 / 257.1 |
| Actual response decode + JSON.parse | 8.5 / 75.1 | 8.1 / 39.0 | 936.2 / 1,243.3 | 986.3 / 1,440.9 |
| Input + worker + response assembly | 5,925.7 / 7,154.3 | 5,853.8 / 7,378.0 | 6,946.2 / 8,315.7 | 6,752.1 / 7,453.9 |


| Uncompressed bytes | Selected compact | Peer compact | Selected full | Peer full |
| --- | --- | --- | --- | --- |
| Input state | 15,670,431 / 15,670,711 | 15,670,431 / 15,670,711 | 15,670,431 / 15,670,711 | 15,670,431 / 15,670,711 |
| Assembled response | 592,856 / 593,108 | 591,526 / 593,389 | 58,040,744 / 58,077,269 | 58,014,180 / 58,063,251 |

Full responses are about 98 times the sidebar/peer JSON size. Worker full-result serialization is about 1.1 seconds, and full-response parsing by the diagnostic parent consumer is roughly 0.94–0.99 seconds at the median. Those are direct diagnostic costs. The production HTTP server forwards the worker’s immutable JSON bytes and does not perform that parent-consumer parse; the browser parses received responses. The Node parse timing is not a production server-parse measurement. Ordinary selected Personal play responses are larger than sidebar projections but much smaller than raw full results. The initial browser Personal response decodes about 4.51 MB, while its compressed wire transfer is about 397 kB. The Group sidebar decodes about 590 kB and transfers about 78 kB. Compression is not modelled by the direct worker harness.

Startup is 10,179.8 ms from worker spawn to ready, including 6,498.2 ms of worker compilation. The startup access-index timer is 566.5 ms and definition decode/parse is 405.1 ms. Compilation is outside the scenario medians. Sampled whole-process peak RSS is 2,534.7 MiB, including the main thread and its one worker. It is not an OS high-water mark or a measurement of multiworker browser-server peaks.

## Fixed-point work

Each request records every inner capability pass and the seven generator-resume sites, including the final explanation pass. The engine still evaluates the complete closure after each unlock. The counter called `taskChecksDelta` is the number of `check(task)` calls after subtracting static-blocked checks inserted without a call. Cached failures and early returns count; these are not distinct tasks or complete requirement reevaluations. Dependency counters retain logical accounting even when a cached training failure skips the original dependency traversal.

| Counter / duration | Selected compact | Peer compact | Selected full | Peer full |
| --- | --- | --- | --- | --- |
| Inner passes / request | 25 / 27 | 25 / 27 | 25 / 27 | 25 / 27 |
| Task-check calls / request | 34,909 / 37,452 | 34,821 / 37,452 | 34,909 / 37,452 | 34,821 / 37,452 |
| Accounted dependency checks / request | 17,127 / 18,366 | 17,119 / 18,366 | 17,127 / 18,366 | 17,119 / 18,366 |
| Task-check calls / inner pass | 1,225 / 1,864 | 1,224 / 1,864 | 1,225 / 1,864 | 1,224 / 1,864 |
| Accounted dependency checks / pass | 686 / 818 | 686 / 818 | 686 / 818 | 686 / 818 |
| Individual inner pass time, ms | 43.3 / 292.3 | 45.4 / 282.4 | 40.8 / 272.4 | 39.3 / 265.5 |

There are 400 recorded inner passes in each lane/view aggregate. Per-request inner-pass counts range from 23 to 27. The data supports targeting repeated access and source work inside those passes while preserving the final explanation, provenance, source ordering and bounded cycle handling (`app/tasks/engine.mjs:1231–1315`).

## All 16 independent unlocks and partner effects

The baseline available/presented counts are Player 1 1,650 / 25 and Player 2 1,626 / 26. Presented counts are not a complete active-goal ledger. Every compact personal and emitted sidebar/peer projection matches projection from the corresponding fresh full calculation, with `elapsedMs` alone removed for comparison. That is 32 member-result comparisons across 16 unlocks. Partner ownership/progress and the original in-memory input remain unchanged.

No partner full result or duo projection is byte-equivalent to baseline in these cases. Fourteen cases leave every partner task row unchanged but change `partnerConnections`. Player 1 unlocking 13617 changes 195 partner task rows, and 13629 changes one. Available/presented peer counts remain unchanged in all cases. Counts therefore cannot justify skipping the peer calculation. The retained equality is full-versus-compact for the same post-unlock input, not before-versus-after identity.

| Unlocked by | Chunk | Own available / presented after | Peer available / presented after | Peer task rows changed | Peer changed fields | Peer full / duo unchanged |
| --- | --- | --- | --- | --- | --- | --- |
| player1 | 11575 | 1657 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player1 | 13617 | 1666 / 31 | 1626 / 26 | 195 | access, partnerConnections, items, training, presentation, activityInfo, diagnostics | false / false |
| player1 | 13629 | 1650 / 25 | 1626 / 26 | 1 | access, partnerConnections, diagnostics | false / false |
| player1 | 9771 | 1650 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player1 | 11057 | 1650 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player1 | 11058 | 1650 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player1 | 11061 | 1651 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player1 | 11062 | 1650 / 25 | 1626 / 26 | 0 | partnerConnections | false / false |
| player2 | 11834 | 1631 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 12080 | 1626 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 12088 | 1631 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 9771 | 1626 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 11057 | 1626 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 11058 | 1626 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 12090 | 1629 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |
| player2 | 11059 | 1626 / 26 | 1650 / 25 | 0 | partnerConnections | false / false |

The candidate set reserves eligible roll choices and arbitrary locked geometric neighbours outside the current pool. All 16 candidates happen to be geometric neighbours; they cover more than the ordinary roll pool. Per-case full and projection hashes, exact task-input signatures and counter samples remain in `.local/perf/speed-unlock-calc.json`.

Partner task changes follow the engine’s shared access calculation: it derives every owner’s sections and round-trip connections (`app/tasks/engine.mjs:520–546`), then uses reachable partner supplies and training in task status and explanations (`app/tasks/engine.mjs:1154–1163`). A hypothetical unlock evaluates only its requesting member (`app/core/planning.mjs:125–152`); `projectDuoPlayResult` filters that same result rather than calculating the other member (`app/duo-play-view.mjs:43–62`).

## Foreground work started by opening the chunk panel

Search starts in Chunks mode and builds a local index (`app/web/main.mjs:1214,1227–1229,530–545`). Its View action opens Chunk Info. The active saved tab alone renders (`app/web/main.mjs:1036,1071–1080`). A saved `defaultChunkinfo=challenges` opens Tasks; Clues follows the same lazy path. Opening either section triggers `ensurePlanningResult` and `/api/chunk-planning` (`app/web/chunk-planning.mjs:81–99`; `app/web/main.mjs:478–499`). The worker retains compact `includeViews=false`, then builds a complete planning index once (`app/tasks/worker.mjs:144–148,271–272`). This request does not build Current BiS or Activity Info.

Full hydration is a separate `/api/tasks` request without `view=play-v1`. It starts through item/equipment/training Search, a task-detail click or hover (`app/web/main.mjs:519,609–612,1223–1225`; `app/web/chunk-planning.mjs:54–60`). On a retained compact baseline, it appends Current BiS and Activity Info rather than rerunning the core engine (`app/tasks/worker.mjs:125–129,71–72`), then serializes the full result (`app/tasks/worker.mjs:293`).

Exact prediction promotion retains only response bytes in the HTTP scheduler. `admitPlayEvaluation` writes the main-thread play cache and never sends a baseline to the foreground worker (`app/tasks/scheduler.mjs:111–122,133–144,471–476`). The worker snapshots are keyed by revision, member and input (`app/tasks/worker.mjs:121–124`); a byte-only saved result therefore does not seed the new revision’s snapshot. If Tasks or Clues then requests fresh `/api/chunk-planning` and no independent request has populated that snapshot, the worker runs `evaluateFull(includeViews=false)`, including `evaluateCore`, before its planning index (`app/tasks/worker.mjs:55–58,124,144–148,271–272`). This is a concrete potential repeat of the full core calculation after a zero-evaluation task response. Compact play bytes lack the full task evidence needed to substitute for that engine baseline.

`acceptTaskResult` marks selected paint and immediately refreshes death work and reopens Chunk Info (`app/web/main.mjs:562–566`), while the peer can remain pending (`app/web/main.mjs:768–785`). Gate both fresh panel planning and unsolicited death until complete duo, or retain an exact, bounded planning projection from the fully settled candidate to avoid the repeat. This mechanism is conditional on opening Tasks/Clues. After an explicit Preview unlock, Preview disappears from the unlocked chunk’s tabs and the renderer normally falls back to Contents (`app/web/main.mjs:1030,1080`); the three prepared Group traces indeed contain no fresh planning request. Their observed overlap is death estimation.

Under tasks settlement, immediate Unlock preparation waits for the Unlock button and viewport, allowing a panel request to remain in flight (`scripts/perf/page-load.mjs:393,398–403`). The scheduler cannot dispatch the new saved task request while the foreground lane is active (`app/tasks/scheduler.mjs:354–355,512–514`). A superseding save rejects the old waiter but does not clear the active slot; synchronous work finishes before its response clears that slot (`app/tasks/scheduler.mjs:327–331,416–417,544–547`; `app/tasks/worker.mjs:244–245`). This is a source-supported explanation for part of the observed request residual. The old pending request route is not identified in the initial artifacts, so planning versus full hydration is not causally established there.

Foreground, peer, prediction and death lanes use separate workers and bounded queues (`app/tasks/scheduler.mjs:61,69–93,176–184`). They can still compete for CPU and independently compile/evaluate. Background prediction warming pauses during foreground work and automatic death batches (`app/server.mjs:496–507`), but selected task readiness can schedule death work 120 ms later while the peer is still pending (`app/web/main.mjs:1460`; `app/web/death-chunks.mjs:65–68`).

## Targeted worker CPU profiles

Self time is sampled time directly in a frame. Inclusive time adds descendants; it overlaps across rows and cannot be summed. The tables retain the top 25 of each ranking from `speed-summary.json`, including wrappers and profiler frames rather than silently removing them. Percentages use each profile’s complete sampled time. They are diagnostic samples under inspector and native profiling, not isolated unprofiled cost estimates.

Profile source shorthand: E = removed scratch `engine.mjs`, W = removed scratch `worker.mjs`, R = removed scratch `probe-runtime.mjs`. Other rows name the original application file. Lines are one-based V8 call-frame positions. The scratch directory was deleted after worker shutdown; its source hashes and transformation anchors remain in the calculation artifact.

### Native dispatch provenance

Following the raw CPU-profile parent IDs resolves native `dispatch` to `node:inspector` → runtime `post` → `startProfile` for almost all of its samples. The remaining native dispatch samples sit under `stopProfile`. This is profiler protocol/startup overhead, not the scheduler’s application dispatch function. A recommendation to optimize native dispatch would misread these profiles.

| Member / chunk | All sampled ms | Dispatch under startProfile ms | Dispatch under stopProfile ms | Other dispatch ms |
| --- | --- | --- | --- | --- |
| player1 / 11575 | 8,397.6 | 1,338.364 | 6.099 | 0.000 |
| player2 / 11834 | 7,748.5 | 1,559.075 | 1.517 | 0.000 |
| player1 / 13617 | 7,755.0 | 1,777.304 | 1.554 | 0.000 |


### Profile 1: player1, chunk 11575

Artifact: `.local/perf/speed-unlock-calc-unlock-1-11575.cpuprofile`. Sampled duration 8,397.6 ms; targeted request wall evaluation 8,392.8 ms.

Top 25 by self time:

| Rank | Function | Source | Self ms | Self % |
| --- | --- | --- | --- | --- |
| 1 | dispatch | V8/native | 1,344.5 | 16.01 |
| 2 | (garbage collector) | V8/native | 522.2 | 6.22 |
| 3 | evaluatePass | E:318 | 409.6 | 4.88 |
| 4 | collect | app/tasks/access.mjs:557 | 378.1 | 4.50 |
| 5 | (anonymous) | E:1134 | 365.3 | 4.35 |
| 6 | (anonymous) | W:238 | 338.0 | 4.03 |
| 7 | calculateAccess | app/tasks/access.mjs:278 | 289.4 | 3.45 |
| 8 | diagnostic | app/tasks/access.mjs:60 | 278.0 | 3.31 |
| 9 | check | E:775 | 212.7 | 2.53 |
| 10 | collectBaseItemSources | app/tasks/access.mjs:722 | 167.1 | 1.99 |
| 11 | add | app/tasks/access.mjs:731 | 155.3 | 1.85 |
| 12 | collectAccessResources | app/tasks/access.mjs:549 | 143.7 | 1.71 |
| 13 | addSource | E:888 | 121.1 | 1.44 |
| 14 | entries | app/tasks/access.mjs:23 | 112.4 | 1.34 |
| 15 | sourceKey | E:887 | 111.0 | 1.32 |
| 16 | markBaseSources | E:589 | 105.1 | 1.25 |
| 17 | selectPresentedTasks | app/tasks/presentation.mjs:70 | 101.0 | 1.20 |
| 18 | selectProcessingSources | app/tasks/processing.mjs:43 | 91.9 | 1.09 |
| 19 | flatten | app/tasks/access.mjs:800 | 90.8 | 1.08 |
| 20 | materialize | E:955 | 79.5 | 0.95 |
| 21 | observeCapabilityTask | E:412 | 75.6 | 0.90 |
| 22 | item | E:1218 | 64.6 | 0.77 |
| 23 | evaluatePartnerConnections | app/core/territory.mjs:14 | 64.1 | 0.76 |
| 24 | updateSkills | E:997 | 62.4 | 0.74 |
| 25 | add | app/tasks/access.mjs:362 | 61.4 | 0.73 |

Top 25 by inclusive time:

| Rank | Function | Source | Inclusive ms | Inclusive % |
| --- | --- | --- | --- | --- |
| 1 | (root) | V8/native | 8,397.6 | 100.00 |
| 2 | (anonymous) | W:249 | 6,527.6 | 77.73 |
| 3 | evaluateFull | W:81 | 5,762.0 | 68.61 |
| 4 | snapshotFor | W:123 | 5,762.0 | 68.61 |
| 5 | timed | W:55 | 5,729.0 | 68.22 |
| 6 | evaluateCore | W:60 | 5,159.1 | 61.44 |
| 7 | (anonymous) | W:62 | 5,136.5 | 61.17 |
| 8 | evaluate | E:1196 | 5,132.6 | 61.12 |
| 9 | evaluate | E:145 | 5,132.6 | 61.12 |
| 10 | engineEvaluation | R:31 | 5,132.6 | 61.12 |
| 11 | (anonymous) | E:146 | 5,132.6 | 61.12 |
| 12 | step | R:16 | 5,120.5 | 60.98 |
| 13 | evaluatePass | E:318 | 5,079.3 | 60.49 |
| 14 | measured | R:7 | 3,287.4 | 39.15 |
| 15 | refreshAccess | E:498 | 1,768.5 | 21.06 |
| 16 | calculateFreshAccess | E:520 | 1,713.1 | 20.40 |
| 17 | memoAccess | E:461 | 1,511.4 | 18.00 |
| 18 | calculateAccess | E:1328 | 1,488.1 | 17.72 |
| 19 | (anonymous) | E:1328 | 1,486.7 | 17.70 |
| 20 | calculateAccess | app/tasks/access.mjs:278 | 1,483.8 | 17.67 |
| 21 | dispatch | V8/native | 1,344.5 | 16.01 |
| 22 | post | R:41 | 1,344.5 | 16.01 |
| 23 | (anonymous) | R:41 | 1,344.5 | 16.01 |
| 24 | post | node:inspector:115 | 1,344.5 | 16.01 |
| 25 | startProfile | R:42 | 1,338.4 | 15.94 |


### Profile 2: player2, chunk 11834

Artifact: `.local/perf/speed-unlock-calc-unlock-2-11834.cpuprofile`. Sampled duration 7,748.5 ms; targeted request wall evaluation 7,748.2 ms.

Top 25 by self time:

| Rank | Function | Source | Self ms | Self % |
| --- | --- | --- | --- | --- |
| 1 | dispatch | V8/native | 1,560.6 | 20.14 |
| 2 | (anonymous) | E:1134 | 453.8 | 5.86 |
| 3 | evaluatePass | E:318 | 333.0 | 4.30 |
| 4 | diagnostic | app/tasks/access.mjs:60 | 289.5 | 3.74 |
| 5 | collect | app/tasks/access.mjs:557 | 273.3 | 3.53 |
| 6 | (garbage collector) | V8/native | 249.1 | 3.21 |
| 7 | (anonymous) | W:238 | 233.3 | 3.01 |
| 8 | calculateAccess | app/tasks/access.mjs:278 | 225.3 | 2.91 |
| 9 | check | E:775 | 217.4 | 2.81 |
| 10 | timed | W:55 | 150.4 | 1.94 |
| 11 | add | app/tasks/access.mjs:731 | 142.0 | 1.83 |
| 12 | entries | app/tasks/access.mjs:23 | 129.5 | 1.67 |
| 13 | collectBaseItemSources | app/tasks/access.mjs:722 | 123.9 | 1.60 |
| 14 | collectAccessResources | app/tasks/access.mjs:549 | 118.5 | 1.53 |
| 15 | addSource | E:888 | 106.3 | 1.37 |
| 16 | markBaseSources | E:589 | 100.3 | 1.29 |
| 17 | materialize | E:955 | 99.5 | 1.28 |
| 18 | createTaskFactsIndex | app/core/progress-index.mjs:6 | 94.8 | 1.22 |
| 19 | sourceKey | E:887 | 93.3 | 1.20 |
| 20 | hasItem | E:685 | 74.3 | 0.96 |
| 21 | selectProcessingSources | app/tasks/processing.mjs:43 | 70.2 | 0.91 |
| 22 | (anonymous) | W:223 | 69.9 | 0.90 |
| 23 | evaluatePartnerConnections | app/core/territory.mjs:14 | 60.0 | 0.77 |
| 24 | flatten | app/tasks/access.mjs:800 | 56.0 | 0.72 |
| 25 | observeCapabilityTask | E:412 | 55.9 | 0.72 |

Top 25 by inclusive time:

| Rank | Function | Source | Inclusive ms | Inclusive % |
| --- | --- | --- | --- | --- |
| 1 | (root) | V8/native | 7,748.5 | 100.00 |
| 2 | (anonymous) | W:249 | 5,929.6 | 76.53 |
| 3 | evaluateFull | W:81 | 5,305.1 | 68.47 |
| 4 | snapshotFor | W:123 | 5,305.1 | 68.47 |
| 5 | timed | W:55 | 5,274.2 | 68.07 |
| 6 | evaluateCore | W:60 | 4,776.7 | 61.65 |
| 7 | evaluate | E:1196 | 4,762.8 | 61.47 |
| 8 | (anonymous) | W:62 | 4,762.8 | 61.47 |
| 9 | evaluate | E:145 | 4,762.8 | 61.47 |
| 10 | engineEvaluation | R:31 | 4,762.8 | 61.47 |
| 11 | (anonymous) | E:146 | 4,762.8 | 61.47 |
| 12 | step | R:16 | 4,751.4 | 61.32 |
| 13 | evaluatePass | E:318 | 4,743.3 | 61.22 |
| 14 | measured | R:7 | 2,764.4 | 35.68 |
| 15 | dispatch | V8/native | 1,560.6 | 20.14 |
| 16 | post | R:41 | 1,560.6 | 20.14 |
| 17 | (anonymous) | R:41 | 1,560.6 | 20.14 |
| 18 | post | node:inspector:115 | 1,560.6 | 20.14 |
| 19 | startProfile | R:42 | 1,559.1 | 20.12 |
| 20 | refreshAccess | E:498 | 1,444.9 | 18.65 |
| 21 | calculateFreshAccess | E:520 | 1,393.5 | 17.98 |
| 22 | memoAccess | E:461 | 1,202.3 | 15.52 |
| 23 | (anonymous) | E:1328 | 1,191.3 | 15.37 |
| 24 | calculateAccess | E:1328 | 1,191.3 | 15.37 |
| 25 | calculateAccess | app/tasks/access.mjs:278 | 1,177.1 | 15.19 |


### Profile 3: player1, chunk 13617

Artifact: `.local/perf/speed-unlock-calc-unlock-3-13617.cpuprofile`. Sampled duration 7,755.0 ms; targeted request wall evaluation 7,754.4 ms.

Top 25 by self time:

| Rank | Function | Source | Self ms | Self % |
| --- | --- | --- | --- | --- |
| 1 | dispatch | V8/native | 1,778.9 | 22.94 |
| 2 | collectBaseItemSources | app/tasks/access.mjs:722 | 596.9 | 7.70 |
| 3 | (garbage collector) | V8/native | 546.9 | 7.05 |
| 4 | collectAccessResources | app/tasks/access.mjs:549 | 439.0 | 5.66 |
| 5 | (anonymous) | E:1134 | 388.0 | 5.00 |
| 6 | calculateAccess | app/tasks/access.mjs:278 | 301.8 | 3.89 |
| 7 | evaluatePass | E:318 | 258.2 | 3.33 |
| 8 | (anonymous) | W:238 | 216.0 | 2.79 |
| 9 | check | E:775 | 200.3 | 2.58 |
| 10 | entries | app/tasks/access.mjs:23 | 101.0 | 1.30 |
| 11 | diagnostic | app/tasks/access.mjs:60 | 95.0 | 1.22 |
| 12 | materialize | E:955 | 94.3 | 1.22 |
| 13 | projectPlayResult | app/play-view.mjs:73 | 85.2 | 1.10 |
| 14 | addSource | E:888 | 79.3 | 1.02 |
| 15 | markBaseSources | E:589 | 78.2 | 1.01 |
| 16 | sourceKey | E:887 | 75.4 | 0.97 |
| 17 | updateSkills | E:997 | 72.6 | 0.94 |
| 18 | selectPresentedTasks | app/tasks/presentation.mjs:70 | 70.9 | 0.91 |
| 19 | observeCapabilityTask | E:412 | 67.4 | 0.87 |
| 20 | outputItems | E:916 | 64.2 | 0.83 |
| 21 | decodeUTF8 | V8/native | 58.9 | 0.76 |
| 22 | (anonymous) | W:223 | 55.0 | 0.71 |
| 23 | (anonymous) | E:1330 | 52.5 | 0.68 |
| 24 | evaluatePartnerConnections | app/core/territory.mjs:14 | 51.4 | 0.66 |
| 25 | statusFlag | app/tasks/presentation.mjs:95 | 50.6 | 0.65 |

Top 25 by inclusive time:

| Rank | Function | Source | Inclusive ms | Inclusive % |
| --- | --- | --- | --- | --- |
| 1 | (root) | V8/native | 7,755.0 | 100.00 |
| 2 | (anonymous) | W:249 | 5,421.9 | 69.91 |
| 3 | evaluateFull | W:81 | 4,798.4 | 61.87 |
| 4 | snapshotFor | W:123 | 4,798.4 | 61.87 |
| 5 | timed | W:55 | 4,769.0 | 61.49 |
| 6 | evaluateCore | W:60 | 4,288.1 | 55.29 |
| 7 | evaluate | E:1196 | 4,270.5 | 55.07 |
| 8 | (anonymous) | W:62 | 4,270.5 | 55.07 |
| 9 | evaluate | E:145 | 4,270.5 | 55.07 |
| 10 | engineEvaluation | R:31 | 4,270.5 | 55.07 |
| 11 | (anonymous) | E:146 | 4,270.5 | 55.07 |
| 12 | step | R:16 | 4,260.2 | 54.93 |
| 13 | evaluatePass | E:318 | 4,246.1 | 54.75 |
| 14 | measured | R:7 | 2,631.7 | 33.94 |
| 15 | dispatch | V8/native | 1,778.9 | 22.94 |
| 16 | post | R:41 | 1,778.9 | 22.94 |
| 17 | (anonymous) | R:41 | 1,778.9 | 22.94 |
| 18 | post | node:inspector:115 | 1,778.9 | 22.94 |
| 19 | startProfile | R:42 | 1,777.3 | 22.92 |
| 20 | refreshAccess | E:498 | 1,348.0 | 17.38 |
| 21 | calculateFreshAccess | E:520 | 1,291.6 | 16.66 |
| 22 | memoAccess | E:461 | 1,132.0 | 14.60 |
| 23 | calculateAccess | E:1328 | 1,125.7 | 14.52 |
| 24 | (anonymous) | E:1328 | 1,122.6 | 14.48 |
| 25 | calculateAccess | app/tasks/access.mjs:278 | 1,121.1 | 14.46 |


### Mapping sampled scratch positions to retained source


| Profile position / function | Original source or instrumentation |
| --- | --- |
| E:318 evaluatePass | app/tasks/engine.mjs:317 |
| E:412 observeCapabilityTask | app/tasks/engine.mjs:411 |
| E:498 refreshAccess | app/tasks/engine.mjs:497 |
| E:520 calculateFreshAccess | app/tasks/engine.mjs:519 |
| E:589 markBaseSources | app/tasks/engine.mjs:588 |
| E:775 check | app/tasks/engine.mjs:774 |
| E:887 sourceKey / E:888 addSource | app/tasks/engine.mjs:886–887 |
| E:955 materialize / E:997 updateSkills | app/tasks/engine.mjs:954,996 |
| E:1134 anonymous task-row projection | app/tasks/engine.mjs:1130 |
| E:1196 evaluate / E:1218 item | app/tasks/engine.mjs:1189,1211 |
| E:1328 access wrapper / R measured, step | Generated scratch instrumentation in scripts/perf/unlock-calc.mjs:180–241 |
| W:60 evaluateCore / W:81 evaluateFull / W:123 snapshotFor | app/tasks/worker.mjs:55,76,118 |
| W state decode / W message handler / R startProfile | Original app/tasks/worker.mjs:222–245 plus generated probe instrumentation |

Offsets change after each inserted measurement block; a single line subtraction is not valid throughout a scratch file. Original access, processing, presentation and territory URLs were kept as absolute file URLs, so their displayed positions refer directly to retained source.

## Ranked optimization opportunities

These are proposals, not measured speedups. The ranges below are bounded planning estimates tied to observed stage budgets. Zero remains possible where contention, overlap or unchanged mandatory work can dominate. They must be checked with identical fixtures, ordinary and reviewed workflows, complete-duo settlement and whole-output equality. Do not add the estimates across nested stages or treat a moved cost as a reduction in total work.

“Output-identical by construction” refers to gameplay and projection fields with elapsed timing normalized. It describes the stated conservation condition, not a validated implementation or unchanged request timestamps.

| Rank | Concrete change | Exactness / risk | Bounded saving hypothesis |
| --- | --- | --- | --- |
| 1 | Gate BOTH fresh Tasks/Clues planning and unsolicited death batches until complete-duo readiness. Make obsolete planning cancellable between bounded steps. Alternatively retain an exact candidate planning projection under the full-state/member/chunk signature. | Deferring independent advisory dispatch until settled tasks is output-identical by construction when saved-input/revision fences are retained. Exact candidate planning retention additionally requires a complete projection and matching signature; compact rows cannot seed a full engine baseline. Neither implementation is validated here. | 0–1.4 s of the initial outside-worker residual is an upper budget, not a measured queue saving. An avoided planning rebaseline could remove up to the roughly 4.44 s measured selected engine budget when this path is requested, but prepared Group traces show no such request. Death overlap has no isolated numeric estimate. |
| 2 | Reuse immutable access/resource classifications and base-source lookup results where explicit traced task reads and ordered inputs prove equivalence. | Exactness not validated. Preserve all membership, section, transport, backlog and provenance dependencies; existing replay is evaluation-local. Whole-output comparisons are required. | A hypothetical 15–30% reduction of selected access time is about 0.25–0.49 s per cold solve; 15–30% of base-source time is about 0.12–0.24 s. Budgets may overlap and require profiling a prototype. |
| 3 | Reduce repeated source-key construction and final row/provenance work without changing source order or public explanations. | Exactness not validated. Requires complete output comparison, including diagnostics, duplicate sources and final-pass behavior. | A hypothetical 15–25% reduction of the 692 ms provenance phase is about 0.10–0.17 s per selected solve. Access diagnostic costs remain nested under rank 2. |
| 4 | Reuse the Group sidebar facts/index within projection rather than rebuilding equivalent evidence. | Exactness not validated. Projection equality and consumer coverage are required; Personal play responses do not pay this phase. | 0–196 ms per Group selected response is the measured phase ceiling. A 40–60% improvement would mean roughly 78–118 ms. |
| 5 | Provide exact bounded hydration for the evidence a details panel requests, and avoid repeated full-graph serialization/parsing. | A new hydration view is not proven equivalent. It requires projection comparisons and consumer coverage; retain the existing full API for callers that need it. | For full details only, a 25–50% reduction of roughly 1.1 s serialization and 0.94–0.99 s diagnostic-consumer parsing suggests a 0.5–1.0 s diagnostic budget. Real browser hydration has not been measured, and the server forwards bytes rather than paying that parse. It does not remove compact engine work or establish a one-second Unlock. |
| 6 | For an explicit reviewed candidate, separately evaluate and retain the peer’s complete hypothetical result under the exact full-state/member signature. Share exact completed candidate work across advisory lanes where their signatures match. | Completed full-signature peer precomputation is output-identical by construction for the same task input/member/view. It shifts CPU before Unlock and consumes bounded cache space; the proposed implementation is not validated here. | 0–5.49 s of peer computation could leave the post-save path when already complete. This is a moved measured peer budget, not a total-work saving or a reliable immediate-Unlock bound. |
| 7 | Retain immutable decoded static worker state across revisions with a versioned transport contract. | Immutable, versioned byte/decoded transport reuse is output-identical by construction when the bytes and all static versions match. Reject stale catalogues, identity and legacy inputs. The implementation, wake behavior and memory cost still need validation. | A hypothetical 20–50% reduction of the 223 ms worker state parse is about 45–112 ms. The 316 ms diagnostic parent stringify is already an upper-bound construction and cannot be claimed as production saving. |

Skipping the peer because available/presented counts or task rows are unchanged is unsafe: all 16 full and duo hashes change. Reusing by the member’s own map alone omits shared access and partner task facts. Returning task deltas in place of a settled full fixed point would omit provenance, diagnostics and dependency closure. Removing the final explanation pass would change public ordering and evidence. Broad cross-evaluation caches also need memory/complete-Group acceptance: the earlier engine-cache candidate regressed reviewed Group latency by 35.6% and was removed (`docs/performance.md:1233`).

## Verification and artifacts

All 16 calculation scenarios pass their oracle comparisons, including the 32 full/compact member projections and original/partner state invariants. All prepared/unprepared browser cache assertions pass for their respective workflows. Final harness validation reports 6/6 targeted tests passing, Node syntax checks passing and whitespace/diff checks passing. No owned scratch Node/Chrome process or scratch directory remains. These checks validate the harness and retained outputs; they do not establish exactness or speedups for the proposed optimizations.

### Artifacts and hashes

The calculation fixture and application source are verified unchanged by the harness. Browser and calculation aggregate-manifest recipes differ, so their SHA256 values are not directly comparable. All 212 files common to the initial browser and calculation manifests have identical per-file SHA256 hashes. The reports retain those file lists.

| Pinned input | SHA256 |
| --- | --- |
| Frozen state | 7d160d0f286693fc48be8b0f0db2170554d996bab97a867325bafe3e36cdff47 |
| Static dependency list | aff174187b09395f78d4b66d1de1932d1039ef9ecb0a3d1f1960bdaa53fa54af |
| Raw definitions | 9dd835266f381abaa4d14033abcd0b43a001fe96d7df0a7f046fcc8676d66553 |
| Effective definition bytes | 084a1e6a2f27d41c2e38cdf226da3847b7eaa1c3b2b7f820e11e8fbab4142f46 |
| Calculation app + reference manifest | 54c8dd4a2a1f51790e6a82da4ad23ae967b2e0e31ec8fc054984f44d078c0a07 |
| Initial browser app + reference manifest | ac2441e553d47dbee450689ca9e1e0092a022719085250be5aaa948e0de7a8fb |
| Measured calculation script | 5014c899bb77a0e1187bb3bbf6e63eb69dcdf7ae471bd404fe2d94bd8b150e65 |
| Scratch worker | 972d4281a8299896f539252192f5738a8f1cf9f3730966bf822ac9acee03b629 |
| Scratch engine | 387b5fd0d2bf7a9aedb612a2b40a3049ca192d2fb3f636ea53d74aeba82d9f50 |
| Scratch runtime | c218148f5e230a4e8095db2a69c7812c49190ad9afa57e4b82e36744d09dda08 |


| Local ignored artifact | SHA256 |
| --- | --- |
| .local/perf/speed-unlock-calc.json | a51bc50f572cc7b8ac47f2697d6f01d72a83e938f66e6bfd1fa213dbe002f866 |
| .local/perf/speed-summary.json | 73f26f6af322fd40fb6ade593dda28283b0483758ff7032ca8bf56da8f7dbaa0 |
| .local/perf/speed-base-off-2026-10-12T03-00-49-537Z.json | c01f690f9156ecc749e744ddf54e685039478f357d2dad2f5bac0509e66bb880 |
| .local/perf/speed-base-on-2026-10-12T03-01-27-925Z-partial.json | 13a0fe206a748b4334ed9aeb2c993cd78ee9ba877f3d734762e4694d5f712a92 |
| .local/perf/speed-unlock-calc-unlock-1-11575.cpuprofile | def1af0a0a4bf8a10ecae745ada9aaf2fb7308fd3aa3876150e05998060d6451 |
| .local/perf/speed-unlock-calc-unlock-2-11834.cpuprofile | 4f9c64f4d9a78ba7e760c941bbbaeee54679e6d881fcc39ceb46fa2780685eac |
| .local/perf/speed-unlock-calc-unlock-3-13617.cpuprofile | 2540e97b42ceda4b54183580a093bd3f3f3ae4e4aa1c95e74db36e300021ca0d |
| .local/perf/CPU.20261012.001132.38048.0.001.cpuprofile | 25bb8c9c5bc87217897d91ccf3a2c3f6b1e8da4f907027e80cfdaeacc0a84eec |
| .local/perf/CPU.20261012.001138.38048.1.002.cpuprofile | a6db17faba33186adb718ca87f986d85280c4112f9bc024119d051f27c2e8f41 |
| .local/perf/speed-base-player2-off-2026-10-12T03-31-57-215Z.json | 2bc38e5437709473772cebcc09f65d0c2d737b934436a12e5cf4abdcdd53dd4e |
| .local/perf/speed-base-player2-on-2026-10-12T03-35-06-224Z.json | 6a41cfcc62a474e09d3f59de479d57e1579837fa870e070906ee91b6073849d0 |
| .local/perf/speed-prepared-player1-off-2026-10-12T03-50-57-412Z.json | b2235f79db62a81cdecc6594252b3d373c71285917d86ddb24c5dbef8b2d0eba |
| .local/perf/speed-prepared-player1-on-2026-10-12T03-55-45-372Z.json | 65668613df82ccf8bb9c4363c3b5a76d93475ad452f5fb75b7fef269fe182602 |
| .local/perf/speed-prepared-player2-off-2026-10-12T03-58-32-641Z.json | 534f4a852db89c173b42d020c4b8eb58ccffb7dc169e25f571f8ee61c73cd913 |
| .local/perf/speed-prepared-player2-on-2026-10-12T04-02-18-681Z.json | 6ec40bed826f8fbcceb94fab90b9d53e770a12ba0e54172cbc1d28d9c975c3ea |

Final summary capture: 2026-10-12T04:07:15.794Z. All eight workflow cells are integrated; the initial Group failure remains explicit N=2 evidence. Native lifetime main/worker profiles remain retained alongside the three targeted profiles. No saved-state payload, CPU-profile bytes or private scratch save is committed with this document.

Application implementation is unchanged by this measurement work. The diagnostic supports engine/access/source work and foreground scheduling as the next areas to test; it establishes no deployed speedup.
