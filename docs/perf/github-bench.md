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
The CI driver pins the server and calculator old-generation heaps to 1536 MiB
to leave memory for concurrent lanes, Chrome and native buffers on a standard
runner. This is an old-generation limit, not an RSS cap. Reports record it;
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

An omitted cold scenario still incurs initial-load conditioning for interactions.
Default arithmetic is 12 app/view trials × 90 seconds + 180 seconds for provisioning
and imports: about 21 minutes. These are planning estimates pending hosted runner
receipts, not measured costs. Larger dwell, extra scenarios and slower revisions
can exceed the default estimate; the workflow stops after 40 minutes.

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
An exited server fails the next browser probe immediately. Failure reports retain
its exit code/signal and the host Linux OOM-kill counter delta when available;
the counter describes the runner, so a signal alone does not prove an OOM kill.

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
once each, outside timing. It excludes Chrome and is not peak memory. Cold does
not flush OS file caches.

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
