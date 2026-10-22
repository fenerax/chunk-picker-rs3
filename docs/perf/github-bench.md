# GitHub app A/B benchmarks

The public runner uses one harness checkout to measure two application checkouts.
It imports the same checksum-verified backup into two fresh data directories, then
alternates A, B, A, B for the requested repetitions, pairing each group view
before moving to the next. Group off and Group on use independent server/browser sessions. The default is three trials
per app/view. Raw harness files and disposable stores stay outside the artifact.

```sh
node scripts/ci/perf-bench.mjs --a-dir ../base --b-dir ../candidate \
  --save /tmp/bench-save.json --packs-dir /tmp/packs/tree \
  --scenarios cold,reload,unlock,cold-30mbps,panels,search --runs 3 \
  --output-dir .local/perf/gh-report
```

Node 24 and Chrome are required; no npm install is needed. `CHROME_PATH` or
`--chrome` selects Chrome. Servers use 8960, Chrome CDP 8961, and import reserves
8968 without listening. Run local measurements through the shared heavy wrapper.
Hosted Linux uses `--no-sandbox --disable-dev-shm-usage`, matching the existing
gallery CI lane; each scalar sample records these effective extra flags.
The CI driver sets `RS3_TASK_WORKER_MODE=process` for imports and measurements,
matching the Windows production topology. Each calculator runs in an owned child
process; reports record the worker policy. Direct `npm run perf` retains the
platform default. Compare samples with the same worker topology.
The CI driver pins the server old-generation heap to 3072 MiB and each calculator
process to 1536 MiB. Imports and app/view trials run sequentially: the previous
server and its calculators exit before another arm starts. This leaves room for
Chrome, calculator heaps and native buffers on the hosted runner. These are
old-generation limits, not RSS caps. Reports record them;
compare runs with the same heap policy. Direct `npm run perf` keeps Node's
default unless `--server-heap-mib N` is supplied.
`--save-sha256` accepts a different explicitly pinned synthetic fixture. Production
defaults to the approved scrubbed-v2 SHA256, checked before either import.
`--dataset open-f2p` is available for a small synthetic smoke; CI uses `duo-legacy`.

`scripts/ci/perf-bench-config.mjs` owns the scenario catalogue, defaults and cost
estimates. A future `score.mjs --against` adapter can consume `measurementPlan()`
without changing workflow requests. Optional request settings are `groupViews`,
`unlockMember`, `unlockPick`, `unlockPreview`, `unlockDwellMs`, `settlement`,
`timeoutMs` and `screenshots`. Unknown fields fail validation. Screenshots default
to false; CPU profiling stays off. Default settlement waits for tasks and terrain.
The CI default Unlock choice is `unprepared`, outside the warm pool, so the
headline includes fresh calculation. Use `unlockPick: "any"` for the ordinary
roll-pool path. Preview and positive dwell requests retain `any` unless a pick
is explicit. Direct PC harness defaults remain unchanged.

| Scenario | Estimated seconds per app/view | Boundary |
| --- | ---: | --- |
| cold | 25 | fresh server, browser and empty HTTP cache to tasks/terrain |
| reload | 4 | reload to current task paint |
| unlock | 10 | preparation, then click to current task paint |
| cold-30mbps | 40 | separate fresh load at 30 Mbps / 40 ms |
| panels | 8 | Chunk Info and Possible Tasks content plus two frames |
| search | 3 | public location query to populated results plus two frames |
| switch-player2 / switch-player1 | 5 each | selected member's current results |
| note-save (opt-in) | 20 | synthetic note on a note-free unlocked chunk: Save click to command acknowledgement and to current task paint at the new revision, worker receipts recorded; then the clear is measured the same way as `note-clear` and must restore the copied save |
| personal-filter (opt-in) | 25 | Group view only: duo personal filter group → not-done → only-player → group, each change to the next duo task mark plus two stable frames; Group off rows are null (missing) |

An omitted cold scenario still incurs initial-load conditioning for interactions.
Default arithmetic is 12 app/view trials × 90 seconds + 180 seconds for provisioning
and imports: about 21 minutes. Full A/A run `39710173014` verified this budget:
20m26s driver time and 21m08s job time. Larger dwell, extra
scenarios and slower revisions can exceed the default estimate; the workflow
stops after 40 minutes.

The runner writes `perf-report.json`, `perf-report.md` and a short step-summary
table. Each metric has medians, min–max, sample counts and B−A. Lower is better.
At least three complete samples and strictly disjoint observed ranges are needed
for a win/loss. Overlap is noise; absent instrumentation is missing. An n=1 smoke
cannot establish a speed change. Individual scalar samples remain in JSON.
Failure reports include the app/run/view, child exit status, failing stage and
scenario, error class, allowlisted message and source basenames/line numbers.
The stderr tail accepts only known harness diagnostics. Unrecognized messages,
JSON bodies, request payloads and arbitrary app/Chrome output are withheld.
Chrome startup failures distinguish sandbox and debugger-port errors. Unknown
failures still retain source locations without publishing the exception text.
The driver prints total/free runner memory and CPU count once, without host names.
The server samples numeric RSS, heap, external and array-buffer usage every second
and at readiness/explicit RSS probes, including its actual V8 heap limit. Reports retain the
last sample and independent sampled maxima; a busy event loop can delay sampling.
An exited server fails the next browser probe immediately. Failure reports retain
its exit code/signal and the host Linux OOM-kill counter delta when available;
the counter describes the runner, so a signal alone does not prove an OOM kill.
V8 heap-limit/out-of-memory stderr is reduced to a fixed diagnostic phrase.

Unlock records click → task fetch → worker calculation receipt → completion →
paint, with each interval separately. Worker timestamps come from the same
harness preload in both apps. Browser/worker epoch clocks align the intervals;
cross-process clock uncertainty remains. Task paint means the matching DOM event
plus two animation frames; Group on waits for both lists. Cached calculations may
have no worker start/done. Those fields stay null. An estimate based on existing
server timing is labelled separately and never substitutes for an observation.
The request-to-start offset is signed: Unlock handling can start calculation
before the browser fetches tasks. A negative value records that overlap rather
than discarding the worker event. The four parts still sum to click-to-paint.
An HTTP cache hit can serve the result of fresh post-click calculation; the
sample's scalar observations retain both facts.
RSS includes HTTP-process samples and a separate total adding calculator processes
once each, outside timing. Sampled HTTP-process peaks exclude calculator processes
and Chrome; total-after RSS is a snapshot, not peak memory. Cold does
not flush OS file caches.

## Hosted verification receipts

All receipts below used the same app in both arms, `a0ec3ea`. Earlier native-thread
receipts remain separate from the current process-worker policy.

Run `39710173014`, tools `060e6dc`, passed the complete default request: three
repetitions per arm/view, both group views, all six default scenarios, 12 complete
trials. Driver time was 1226.022 seconds; the job took 21m08s. The runner reported
7933 MiB RAM, 6534 MiB free at start and 2 CPUs. Server/calculator heaps were
3072/1536 MiB. Only two of the six newly authorized requests were needed.

The table pools the identical A and B apps: six samples per cell, shown as median
[min–max]. The range is the observed A/A noise envelope, not a confidence interval
or a guaranteed threshold for future runner machines. Individual A/B medians,
ranges, all 184 metric rows and scalar samples remain in the report artifact.
Marginal medians of the Unlock parts need not add to the headline median.

| Observation | Group off: median [min–max] | Group on: median [min–max] |
| --- | ---: | ---: |
| Unlock click → request (ms) | 211.6 [200.0–386.3] | 206.7 [147.2–237.9] |
| Request → worker receipt (ms) | 2880.9 [2217.6–3142.8] | 2415.3 [2057.1–2865.3] |
| Worker calculation (ms) | 2559.9 [1841.4–3139.7] | 4657.2 [3677.6–4958.3] |
| Worker completion → paint (ms) | 125.3 [100.6–148.2] | 55.1 [48.9–117.9] |
| Unlock click → paint (ms) | 5824.7 [4545.9–6606.9] | 7282.1 [6044.4–8113.9] |
| Cold task paint (ms) | 5718.3 [5446.1–6614.7] | 12335.6 [11255.8–12930.8] |
| Reload task paint (ms) | 2950.5 [2777.2–3402.7] | 2129.0 [1690.6–2958.9] |
| Cold 30 Mbps task paint (ms) | 6823.8 [6719.0–7201.2] | 13819.7 [13171.5–15457.7] |
| Chunk Info paint (ms) | 93.5 [83.7–140.0] | 122.8 [106.5–228.0] |
| Possible Tasks paint (ms) | 20743.3 [19149.9–23327.6] | 20631.4 [19475.9–21590.3] |
| Search paint (ms) | 164.8 [163.8–173.6] | 165.9 [164.5–195.7] |
| Total server/calculator RSS after (MiB) | 4662.3 [4517.4–4696.5] | 5535.0 [5436.6–5732.6] |
| Sampled HTTP-process peak RSS (MiB) | 1562.4 [1514.3–1594.8] | 1662.4 [1633.7–1692.8] |
| Sampled HTTP-process peak heap used (MiB) | 953.9 [900.5–955.1] | 990.8 [966.2–1012.8] |

All headline timings have three observations per arm/view and overlapping A/B
ranges. No headline timing is missing. The report has 159 noise rows, 21
unavailable/inapplicable rows, and four disjoint auxiliary ranges (one win, three
losses). Since A equals B, these auxiliary verdicts are A/A variation, not app
improvements or regressions. Unavailable rows cover network idle under task
settlement, duo events with Group off, interaction first paint and the unused
estimated calculation start. All 12 Unlock samples observed fresh worker
calculations, even though the subsequent HTTP task responses were cache hits.

Maximum sampled HTTP-process RSS was 1692.8 MiB and heap used was 1012.8 MiB.
Maximum observed total-after server/calculator RSS was 5732.6 MiB (5.60 GiB).
The combined process-tree peak and Chrome RSS are not measured. The full sequence
fits the observed runner with process calculators; the earlier trap cannot be
conclusively attributed because its V8 heap samples were not captured.

Run `39708806472`, tools `060e6dc`, passed cold → reload → unprepared Unlock,
Group off, once per arm. Driver time was 185.959 seconds; the job took 3m54s.
The runner reported 7938 MiB total memory, 6473 MiB free at start and 2 CPUs.
This verified the process-worker policy with server/calculator heaps of
3072/1536 MiB. The previous uninstrumented trap's precise cause remains unproven;
the new policy completes the sequence that failed before.

| Current policy observation | A (n=1) | B (n=1) |
| --- | ---: | ---: |
| Click → task fetch (ms) | 344.1 | 301.8 |
| Task fetch → worker receipt (ms) | 5347.0 | 5708.2 |
| Worker calculation (ms) | 4674.6 | 3957.0 |
| Worker completion → paint (ms) | 246.8 | 408.2 |
| Click → paint (ms) | 10612.6 | 10375.2 |
| Sampled HTTP-process peak RSS (MiB) | 1564.2 | 1586.9 |
| Sampled HTTP-process peak heap used (MiB) | 954.7 | 953.5 |
| Total server/calculator RSS after (MiB) | 2629.5 | 2658.8 |

These single samples establish completion, not a noise floor or speed change.

Run `39704315859`, using tools `edbe1b5`, completed one unprepared Unlock per arm,
Group off, with the 1536 MiB heap policy. Driver time was 177.259 seconds; the job
took 3m34s. Worker intervals below are derived from retained matching worker
receipt/completion observations. Both task HTTP responses were cache hits while
fresh post-click worker calculations were observed.

| Unlock observation | A (n=1) | B (n=1) |
| --- | ---: | ---: |
| Click → task fetch (ms) | 280.800 | 365.600 |
| Worker receipt from click (ms) | 264.333 | 356.008 |
| Worker completion from click (ms) | 5209.201 | 5216.403 |
| Task fetch → worker receipt (ms, signed) | −16.467 | −9.592 |
| Worker calculation (ms) | 4944.868 | 4860.396 |
| Worker completion → paint (ms) | 1228.299 | 1368.097 |
| Click → paint (ms) | 6437.500 | 6584.500 |
| Total server RSS after (MiB) | 2244.35 | 2236.73 |

Reload-only run `39703358815` also completed, with Group off and n=1 per arm,
using Node's default heap policy. Task paint was 4528.0 / 5212.3 ms for A / B;
driver time was 147.782 seconds. Neither short run establishes a speed change or
an A/A noise floor.

The final full request, run `39705763652`, requested three repetitions and both
views with unprepared Unlock. It failed during A1/Group-off Unlock after cold and
reload, with server `SIGTRAP` and host OOM-kill counter delta `0`. Driver time was
195.122 seconds; the job took 4m10s. It produced zero complete app/view trials.
The cause of the fatal trap is unresolved; the process-worker policy is an
isolation change, not a demonstrated cure.

The original request plus seven new requests exhausted the earlier eight-request
budget. A further six-request budget was approved for this continuation. The two
new requests passed: the short process-mode receipt and the complete default A/A
receipt above. Four requests remain unused.

## Private workflow

The private workflow and local helper live outside this public checkout in the
operator's `perf-gh` tools directory. Claude installs `perf-bench.yml` at
`.github/workflows/perf-bench.yml` on the private repository's orphan `bench/tools`
commit. That commit needs this complete tools tree, including `.github/packs`,
`scripts/perf`, `scripts/ci`, `app` and their relative imports. Each run branch is
that tools commit plus one request commit adding `bench/request.json`:

```json
{"base":"<full SHA>","candidate":"<full SHA>","scenarios":["cold","reload","unlock","cold-30mbps","panels","search"],"runs":3,"options":{}}
```

The workflow checks out both SHAs from the private repository, fetches the pinned
public release packs using the existing verified fetcher, and downloads the save
from the private release using the read-only token. It uploads only the two scalar
reports as `perf-report` for 14 days. Explicitly requested screenshots use a
separate artifact. Save bytes, data directories and raw harness reports are never
artifact paths.

The local helper takes `--repo-dir`, `--base`, `--candidate`, optional comma-separated
`--scenarios`, `--runs`, `--label`, `--options JSON`, `--tools-from SHA` and `--wait`. It checks commit
reachability, author/committer noreply identity and the required private-corpus
scan before transporting commits. Code uses non-branch `refs/bench/cand/*` refs,
so transporting it cannot start unrelated push-triggered workflows. Only the
request uses `refs/heads/bench/run/*`. All pushes use explicit non-force refspecs
to the fixed private HTTPS endpoint. With `--wait`, it watches
the exact request commit and downloads `perf-report` into `.local/perf/gh/<run id>`.
Its isolated bare-repository tests perform no GitHub calls.

`--tools-from` updates runner code without changing `bench/tools`: the helper
checks the source commit's reachability, attribution and corpus scan using the
same rules as the candidate. It takes that source tree, removes every workflow,
and restores only `perf-bench.yml` from the fetched orphan `bench/tools`. The
request commit still has `bench/tools` as its sole parent. This lets short debug
requests exercise a committed runner fix before the next full noise-floor run.

For direct harness use, `npm run perf -- --source COPY --packs-dir PACKS_TREE`
selects public packs; the selection defaults to `PACKS_TREE/selection.json`.
`RS3_DATASET=duo-legacy`, `RS3_PACKS_DIR` and `RS3_PACK_SELECTION` also work for
the calculation, paired, equivalence and interaction scripts. Existing legacy
directory defaults remain available when packs are not selected.
