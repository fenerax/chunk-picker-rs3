# Picker browser performance harness

## Server-only route and save measurements

Run `server-routes.mjs` through the shared heavy-work wrapper with an explicit
frozen, scrubbed source under this worktree's ignored `.local/` directory:
Set `$heavyWrapper` to the shared `.local/claude-tools/with-heavy.ps1` in the
main checkout before running the command.

```powershell
powershell -NoProfile -File $heavyWrapper node scripts/perf/server-routes.mjs --source .local/bench-save --entry app/server.mjs --port 8958 --runs 3 --label after
```

`--entry` also accepts the baseline checkout's server. Alternate baseline and
candidate invocations using identical arguments and at least three repetitions
per revision. Reports under `.local/server-routes/` contain numeric measurements,
fixed route paths, input/source hashes and no response bodies or credentials.
Excluded source credentials and lock files stay unread and unchanged; each
disposable copy receives a fresh credential.
For an independent dataset, pass its existing public receipt with
`--source-binding PATH`. The observer copies its unchanged bytes to the owned
scratch store's sibling binding file and verifies the source hash before and
afterward. The receipt must be under ignored `.local/` and at most 64 KiB;
the application still validates its dataset identity.

The observer measures listening/readiness and first compact tasks, the same
store after restart, identity/gzip/Brotli state and task transport, conditional
requests, history pagination, safe application GET routes and plugin route
availability. Local reads include map-layer definitions, pool ranking, backlog
search, XP choices and roll statistics. Five note saves rotate fixed encoding headers and run alongside health
polls. FileHandle write/sync counters distinguish storage wait from the complete
save response; health latency and client polling delay are reported separately.
It also records worker compilation, cache counters, accelerated retirement and
compact/full wake requests, sampled process-tree RSS, server process CPU and main-isolate GC,
and event-loop delay. Wire-body bytes exclude HTTP headers/framing. Both
revisions use the same instrumentation. Idle server process CPU uses a separate quiet interval
after retirement, with periodic IPC memory sampling.
`retirement.wakeResident` describes the foreground lane only. Inspect the
separate lane diagnostics for prediction/duo/death residency; a successful full
task request's `worker` flag does not identify which lane handled it.

Shared-save synchronization covers `/api/state` reads and a bounded connection
to `/api/events`. The SSE probe records only the fixed pathname, response status,
TTFB, first-chunk time and first-chunk bytes, then immediately closes its owned
stream. Its deadline is ten seconds. It never accumulates or parses SSE content;
later revision broadcasts and delivery to another client remain unmeasured.
Original-picker synchronization is a separate provider-gated POST preview/apply
workflow with external fetches, deliberately excluded from this observer.
A 404 from the optional `/api/original-sync/status` GET leaves original-sync
feature availability unknown. Fixed registered plugin GET paths are measured
when present; parameterized routes and plugin writes are excluded.

`--prewarm off|on` defaults to off; `--idle-ms` defaults to 60000 and
`--save-count` to five. These are diagnostic settings, distinct from production's
ten-minute retirement. Scheduler clocks run normally. Server RSS is sampled
every 500 ms with a 1450 MiB
server safety stop; shorter unsampled peaks are possible. Keep the whole observer
process tree within the job's memory budget as well. CPU counters cover all server
process threads (thread pool, background GC and any worker threads), excluding
forked hosts. GC and event-loop observations cover the main isolate. Optional
public game/map inputs can be passed explicitly or inherited from the shared
wrapper; private add-on configuration is cleared.

RSS samples combine the main-process reading with asynchronous host replies;
they are not simultaneous process-tree peaks. Startup memory checkpoints observe
main-process phase boundaries, including concurrent initialization and GC. Their
`childMs` measures the checkpoint time; `fromSpawnMs` includes IPC delivery.

`--heap-mb 768` optionally bounds V8 old space in the server and its inherited
task hosts. The default leaves V8 unchanged. Match this setting across A/B runs;
its GC behavior can differ from default-memory operation. The RSS safety stop
still applies independently to the server tree.
The startup and idlemem harnesses accept the same bounded limit through
`RS3_PERF_HEAP_MB`; other harnesses can inherit the matching `NODE_OPTIONS`.
Both startup and idlemem continue clearing ambient `NODE_OPTIONS` before applying
this explicit limit and record it in their report.

The existing `warmstart.mjs --idle-ms MS` and `idlemem.mjs --idle-ms MS
--observe-idle-ms MS` preserve their original defaults but permit shorter,
explicitly labelled diagnostic windows. Both accept a bounded 8900–8999 port;
their legacy ports remain supported. `server-memory.mjs --port PORT` selects
its otherwise ephemeral listener. For browser runs,
`RS3_SCRATCH_SERVER_PORT` bounds the application listener to 8900–8999 and
`RS3_SCRATCH_CDP_PORT` separately bounds the owned Chrome debugger.

For restart timings without a browser, run the warmstart harness through the
shared heavy-work lock:

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/perf/warmstart.mjs --label after --source .local/warmstart-save --port 9121
```

Use a frozen local save copy with `store.lock` and `access-token` excluded. Each
idle/busy cell creates another disposable copy with a fresh credential, starts
one picker and removes the scratch store after verified shutdown. Busy means
the quick suite runs alongside startup and the first tasks/Preview. Reports
under `.local/warmstart/` contain numeric timings, task counts, cache/stage
metadata and RSS, never tokens or saved records. `--entry` selects a local
baseline module, `--condition idle|busy` repeats one cell, and `--defer-ms 30000`
measures a first request after thirty seconds of unattended preparation. The
default sends first requests immediately after store readiness. Repeated reads
record prepared response latency separately. RSS after used-worker warmup and
after completed thread retirement uses an explicitly accelerated 60-second idle
interval (production: ten minutes), with no forced GC. Initial compilation gets
the same five-minute allowance in both comparison cells.

Run from this worktree with Node 24 or newer and an installed Chrome executable. No package installation is needed.

```powershell
npm run perf -- --help
npm run perf -- --runs 3 --label baseline
npm run perf -- --runs 1 --label smoke --scenarios cold,reload,unlock
npm run perf -- --runs 1 --label terrain-review --scenarios cold,reload,cold-30mbps --screenshots on
```

Use a quiet machine for comparable baseline and after measurements. The harness prints progress and writes a timestamped JSON report plus readable Markdown tables under ignored `.local/perf/`. The JSON contains individual measurements, waterfalls, category totals, endpoint TTFB samples, long-task phase summaries, server process startup, worker compilation and server RSS. Median tables cover each requested scenario.

Defaults read `.local/duo`, `.local/map-assets` and `.local/game-data` from `C:/Users/User/Projects/chunk-picker-rs3`. The harness never contacts its server. `--source`, `--map-assets`, and `--game-data` can select another existing fixture and read-only asset directories. `--chrome` or `CHROME_PATH` selects Chrome. `--timeout` sets each measurement's deadline in milliseconds. `--runs` defaults to three. `--label` uses letters, numbers, underscores and hyphens.

`--terrain-assets PATH` selects the generated terrain bundle independently of the original map assets. It defaults to the map asset directory and reaches the scratch server through `RS3_TERRAIN_ASSETS_DIR`. The option is recorded in JSON. Both asset directories remain read-only.

`--screenshots on` saves PNG captures of the settled default view, maximum zoom, fixed 0.65 zoom, default view at device DPR 2, and a 390 × 844 CSS-pixel viewport under an ignored timestamped `.local/perf/*-screenshots-*` directory. The narrow viewport uses desktop Chrome with responsive dimensions; it does not emulate a phone's browser or touch input. Capture metadata records actual viewport size, map zoom, bounds and DPR; the app can cap its own map DPR below the device setting. Captures and view changes happen after the suite's measurements and RSS samples; screenshot requests do not enter measured waterfalls. This option defaults to `off`. With interaction scenarios selected, the default capture shows their final state. Screenshots can contain the private fixture's visible gameplay information; keep them local.

`--screenshots responsive` captures the settled desktop in the gray theme and a 390 × 844 view in the light theme, both at DPR 1. It avoids the full option's zoom and DPR 2 excursions, then restores desktop dimensions and the original theme. These temporary palette changes do not save a preference. Use this lighter option for mandatory desktop/narrow-viewport acceptance under memory constraints. Narrow viewport terrain still settles before capture; viewport changes can request any newly needed tiles.

`--idle-sample-ms MS` optionally adds a separate post-suite memory and wake probe (default 0/off; maximum 60000). It records normal RSS and whitelisted lane diagnostics, waits the exact requested interval without interaction, then records RSS, worker residency and queues. It reloads once with HTTP/result caches retained and ends at the requested personal or duo task milestone plus visible terrain. This reload always uses tasks settlement so background advisory tails do not extend its measured latency. It is recorded under `suite.idleSample`, outside ordinary scenario medians and totals. A fixed interval does not guarantee that advisory/prewarming queues finish: inspect `observedQuiescent`, queue depths and residency before describing the sample as idle. No forced GC or cancellation is used.

For a short worker-retirement experiment, set `RS3_WORKER_IDLE_MS` on the harness process and choose a longer sample interval. Use the same environment and frozen save for both revisions. Restore the environment afterward. Default production worker lifetime and short-timeout diagnostic runs are distinct evidence. Run separate `--group-view off` and `on` batches for personal and complete-duo cold/wake timing; one batch measures only its selected view.

```powershell
$previousWorkerIdle = $env:RS3_WORKER_IDLE_MS
try {
  $env:RS3_WORKER_IDLE_MS = '5000'
  npm run perf -- --source .local/workers-save --runs 3 --scenarios cold,reload,unlock --group-view off --settlement tasks --idle-sample-ms 10000 --screenshots on --label workers-personal
  npm run perf -- --source .local/workers-save --runs 3 --scenarios cold,reload,unlock --group-view on --settlement tasks --idle-sample-ms 10000 --screenshots on --label workers-group
} finally {
  if ($null -eq $previousWorkerIdle) { Remove-Item Env:RS3_WORKER_IDLE_MS -ErrorAction SilentlyContinue }
  else { $env:RS3_WORKER_IDLE_MS = $previousWorkerIdle }
}
```

`--cancellation-check on` runs a separate rapid pan/zoom probe after measurements and screenshots. It loads a native viewport, pans into adjacent regions at 30 Mbps/40 ms, then returns and zooms out after 20 ms. The per-suite diagnostic counts Chrome's actual `Network.loadingFailed` events with `canceled: true`; it reports how many native requests were still pending before returning. These requests never enter scenario totals or medians. A zero pending/canceled count means that run did not demonstrate cancellation. The option defaults to `off`.

`--prewarm on|off` controls the scratch server's prediction prewarming; it defaults to `on`, preserving normal application behavior. Use `off` as an explicit contention experiment with the same frozen input and quiet host. The option reaches `createServer({predictionPrewarm})` through the private child-process environment. JSON records the option snapshot, including source, assets, scenarios, timeout and executable. Probe and measurement behavior stay identical between variants.

`--unlock-preview on|off` defaults to `off`, preserving the immediate Unlock workflow. On clicks the chunk's actual Preview tab and waits for its displayed result before the measured Unlock click. The preview time is preparation, outside the Unlock milestone. Reports retain the option and explain the distinction: compare matching reviewed workflows, and report immediate Unlock separately. It never writes a prediction into the scratch save or pre-fills a cache through a test-only API.

`--unlock-dwell-ms MS` defaults to `0` and accepts integer milliseconds through
`60000`. After Search opens the locked chunk panel and its Unlock button is
present, the harness waits the requested interval before timing Unlock. Existing
terrain/settlement preparation still follows that wait, so the total panel-open
time can be longer. The wait stays outside Unlock milestones; JSON records both
requested and observed dwell under `unlock.preparation`. Positive dwell requires
`--unlock-pick any --unlock-preview off`: it measures ordinary panel consideration
with automatic preparation allowed and makes no hit/miss assertion. Use `3000`
for the three-second workflow. Explicit Preview (`prepared`) and the immediate
outside-pool miss (`unprepared`) remain separate measurements. Diagnostics just
before Unlock and after settlement retain bounded reuse counters, including
`compressedBytes` when the selected server publishes it. Missing counters are
`null` in lane snapshots, rather than measured zeroes.

```powershell
npm run perf -- --source .local/speed-save --runs 3 --scenarios unlock --unlock-member player1 --unlock-pick any --unlock-dwell-ms 3000 --group-view on --settlement tasks --label dwell-player1-group
```

`--unlock-member player1|player2` selects the player for Unlock (default `player1`).
Player 2 is selected with the existing member control before preparation; that switch
is outside the measured Unlock. JSON records the member and unlocked chunk ID.

`--unlock-pick any|prepared|unprepared` defaults to `any`, retaining the selected
locked choice or first roll-pool choice. `prepared` waits for the actual Preview
UI and requires a completed-prediction hit. `unprepared` picks a deterministic
locked surface chunk outside that player's selected choices, pending rolls and
roll pool, so ordinary prewarming cannot prepare it. It requires Preview off
and a measured prediction miss. Existing diagnostics expose counts rather than
completed chunk IDs; the harness uses `/api/state` and `/api/display-world` to
exclude the entire warmable set, without introducing a server API. A mismatched
hit/miss retains partial evidence and fails the batch. Each Unlock records lane
diagnostics immediately before clicking and after settlement. Missing hit flags
with positive fresh evaluation time are recorded as prediction misses. On the
current native worker, a zero-time hit after a changed task input identifies
exact prediction reuse; older servers without either signal retain `null`.

`--group-view off|on` selects the task view at document start, before startup calculation. It defaults to `off`. Off waits for the selected player's `tasks-shown`; on waits for `duo-tasks-shown`, emitted only after both current results have painted. Every scenario verifies the requested toggle. Reports record the view and task milestone. Calculation-stage metadata still describes the selected player's result; the duo milestone includes the partner wait and combined rendering.

`--task-milestone tasks|duo` overrides that event while preserving the requested group map mode. It defaults to `tasks` with group view off and `duo` with group view on; `duo` requires group view on. Use `--group-view on --task-milestone tasks` when measuring a legacy revision that supports the group map but emits only the selected player's task event. Keep the legacy selected-task and current complete-duo distinction explicit in comparisons.

`--cpu-profile off|on` defaults to `off`. On saves standard renderer CPU-profile JSON for requested scenarios under ignored `.local/perf/`; initial cold conditioning is not profiled unless cold is requested. Profile frame URLs retain pathname only, and the scenario report links its profile artifact. Profiling adds diagnostic overhead, so retain these runs separately from performance medians.

`--settlement idle|tasks` defaults to the existing `idle` policy. The `tasks` policy ends when the current task milestone, adopted/saved revision and visible terrain are ready, without waiting for background advisory requests to become idle. Advisories and prediction prewarming stay enabled. Initial conditioning and Unlock preparation use the same policy. Reports record pending requests at that boundary, and `networkIdleMs` remains null unless idle was observed. Network totals under `tasks` cover only that shorter observation window. Compare runs using the same settlement policy.

```powershell
npm run perf -- --source .local/groupview-save --runs 3 --scenarios reload,unlock --group-view off --settlement tasks --label groupview-off
npm run perf -- --source .local/groupview-save --runs 3 --scenarios reload,unlock --group-view on --settlement tasks --label groupview-on
```

If a batch fails, completed repetitions and completed scenarios from the failing repetition are retained in a `*-partial.json` report after cleanup. Its medians include only fully completed repetitions. A forcibly interrupted process cannot guarantee that report.

`--server-entry PATH` selects an existing `.mjs` server module inside this worktree. Every component is checked for symlinks/junctions, and the resolved path must remain inside the worktree. The default is the current `app/server.mjs`. For a paired comparison, an archived Git revision under `.local/perf-fixtures/` can supply its own server, frontend and tracked data while using the same copied gameplay fixture and read-only map/game assets. Pass its verified commit hash with `--server-revision`; otherwise the current worktree's Git HEAD is the revision label. Reports record the selected entry path, file SHA256 and revision label separately from the current harness checkout. `applicationSource` pins every file under the selected entry's `app/` directory and the available reference definitions/task-map files with SHA256 hashes; a successful batch verifies that manifest again after measurements. Nonstandard entries outside an `app/` directory explicitly retain only their entry fingerprint. Selecting a different server entry does not change browser probes or measurement rules.

Each repetition creates a disposable `.local/perf/scratch-*` directory. It copies the complete duo, including storage archives needed to hydrate compact state, but excludes `store.lock`, `invites.json`, `feedback.json`, and `access-token`. A fresh credential is generated for the scratch server. The source's state hash must stay unchanged during copying and across all repetitions. Symlinks/junctions in the source and scratch paths resolving outside the worktree are rejected. Scratch stores and Chrome profiles are deleted after both owned processes have exited; failed shutdown retains scratch rather than deleting an active store. Interrupting the Node process forcibly can leave scratch behind.

The server binds only `127.0.0.1` on an operating-system-assigned port; inherited public-origin and second-listener settings are cleared. Chrome runs headless with a new disposable profile and its own ephemeral CDP port. Ports 8788 through 8791 are rejected. No ordinary Chrome profile, existing browser tab, live picker, Tailscale configuration, or main-repository tracked file is changed. The map asset and game-data directories are shared for reads only.

Authentication happens through a redirect-free scratch join request. The harness sets the scratch session cookie through CDP, clears HTTP cache, and then navigates directly to `/`. This avoids warming the app during authentication. Cookies, tokens, request bodies and save contents never enter reports or console output. Request waterfalls retain pathname only, with no query strings.

Each request also records numeric `startMs`, `responseMs`, and `endMs` relative to its scenario's start. CDP request wall time is aligned with the document's `performance.timeOrigin`; subsequent response/end offsets use CDP monotonic elapsed time. An unavailable clock or event produces `null`. The clocks can differ slightly, so these offsets locate overlap without establishing exact causal attribution. Existing TTFB, duration, byte and milestone calculations are unchanged. Individual long tasks are retained as `{startMs, durationMs}` alongside totals and phase summaries.

`taskCalculation` records the first matching `tasks-shown` event's whitelisted cache hit flag, evaluation/request milliseconds, and numeric worker stage timings (engine, collection, equipment, presentation, current BiS, activity, prediction, death and total). Missing application instrumentation yields `null`; invalid or unavailable numeric fields remain `null`. This metadata describes the displayed task result and excludes later detail responses. No arbitrary cache fields, response headers or response bodies are retained.

When available, the harness's document-start probe also observes the app's
existing `Response.json()` call for `/api/tasks`, without parsing twice. It
retains only player/revision, whitelisted cache/stage fields, and JSON read/parse
start/end times under `taskResponses`. Matching response metadata supplies
`taskCalculation` when the app event omits a field. JSON read/parse time includes
waiting for the body and browser scheduling; it is not isolated parse CPU.
Response completion to task paint bounds subsequent indexing/rendering.

The default sequence is:

1. **cold**: fresh server and browser profile, empty browser HTTP cache.
2. **reload**: ordinary reload preserving browser HTTP cache and server calculation caches.
3. **switch-player2** and **switch-player1**: existing member selector, waiting for matching task results and visible terrain completion.
4. **unlock**: select `--unlock-member` (Player 1 by default), open Search, find a locked chunk according to `--unlock-pick`, open its existing panel, wait any requested `--unlock-dwell-ms`, then time the Unlock button through the next adopted/saved revision, refreshed tasks and map settlement. Only scratch gameplay changes.
5. **cold-30mbps**: another fresh server and profile restored from the same baseline, with CDP emulation at 30 Mbps upload/download and 40 ms latency.

`--scenarios` accepts a comma-separated subset of these names. The necessary initial load still runs before a selected interaction. Interactions follow the sequence above; selecting only `switch-player1` measures a change event on the already selected member. For realistic switching use both switch scenarios.

`--unlock-chunk 7463` fixes the chunk for paired prepared/unprepared cells. It
must be a locked surface chunk outside any pending offer. With `--unlock-pick
unprepared`, it must also be outside that player's selected/pending/roll-pool
warming candidates. Prepared mode waits for Preview on the same chunk; its
preparation remains outside the timed Unlock. Reports retain the explicit ID.

## Private unchanged-calculation reference

`unlock-equivalence.mjs --mode write --baseline-dir .local/baseline-395ceb0
--projection-dir .local/projection-f49a3fc` supports isolated `git archive`
copies under this worktree's ignored `.local`. Git text conversion can affect
archive exports; the ignored `.local/materialize-pinned-archives.py` restores
exact binary Git blobs and verifies the full relative-import graph, including
`scripts/lib/provenance-hash.mjs`. Both options are required
together and only in write mode. Every application, definition and copied-save
reader/runtime-helper blob is verified against the pinned commits and included
in the archive fingerprint before modules load.
The unchanged `395ceb0` worker/world calculates the full result; `f49a3fc`
loads the modern save, applies scenario commands and projects play/duo/sidebar
views, including the required skill requirements. The reference manifest pins
both sources separately. Comparison runs use the current application normally.
No saved fields or additional result fields are normalized away.

When `.local/with-heavy.ps1` owns the shared lock, it passes a random ownership
token and its PID. The equivalence script verifies those values against the
lock's owner files and its direct parent, and leaves cleanup to the wrapper.
Direct script runs still acquire and release their own exclusive lock.

The ignored `.local/dibs-browser-proof.mjs` adapter reuses the repository's
native CDP/server harness, as preferred by the Playwright skill for established
local scripts. Two disposable browser sessions select Player 1 and Player 2. After
Preview prepares 7463, Player 1's first Unlock request waits while Player 2 clicks a
Group claim button; the stale request then reaches the server. The proof checks
one claim-only conflict retry, both durable changes, prepared calculation reuse,
and the claim visible in both Group lists, and captures screenshots. All owned
servers and browsers close in `finally`. Run this proof separately from timing
cells through the same heavy-work wrapper; its injected wait is not latency
evidence.

The document-start probe collects paint timing and long tasks (browser threshold: 50 ms). Opt-in application events record `state-adopted`, `tasks-shown`, `terrain-drawn`, and `visible-tiles-loaded`. Normal app use leaves those probes disabled. Visible tile completion requires committed decoded/composed terrain for the viewport and reports failed visible tiles. Network idle requires 750 ms with no unfinished request, excluding the SSE event stream. Failed API/assets or task status abort a measurement.

Network groups are app code (HTML, JS modules and CSS), static data JSON, API (including definitions, rules, tasks, state and map-info), map tiles and other assets. Transfer bytes use CDP `encodedDataLength`, which includes response headers. Decoded body bytes use CDP data events with resource timing as fallback. Cached body bytes use encoded Content-Length/resource size; 304 responses count as revalidated cache use. Cache totals are not bytes avoided on the wire. TTFB uses CDP response timing; definitions and map reference endpoints may revalidate on reload. Missing endpoints or inapplicable milestones remain `null`/`—`. If Unlock reuses a fully loaded terrain viewport, its visible-tile milestone is zero and JSON flags `terrainAlreadyLoaded`; the state canvas and task results still refresh.

An additive `network.assetClasses` breakdown separates `terrain`, `legacyWorld` (the world PNG), `mapSpritesPins`, `icons`, `interiors`, and `other`. These disjoint classes sum to the same network totals; the historical categories remain unchanged. Every waterfall request also records its asset class. Each class's `lastCompletionMs` is its final successful, non-canceled request end relative to scenario start, with null for absent classes. It can precede visible composition. `terrainDiagnostics` records terrain request count, native tile request count, committed visible count and first/last request timing. With the application's optional viewport probe, it also records sanitized bounds, zoom, visible source paths and the exact requested-path intersection with the final viewport. Older application revisions leave those fields null. A request outside the final viewport may have served an earlier view. Request count minus committed visible count is a coverage diagnostic rather than an exact offscreen count: repeated sources, view changes and overview-based rendering can make them differ.

The collector reads the actual status from CDP `Network.responseReceivedExtraInfo`, which can report 304 even when `responseReceived` exposes the cached 200 response. Request waterfalls mark these entries `revalidated: true` and count them as cached. Earlier reports can undercount revalidation hits; their artifacts remain unchanged. This correction does not change wire bytes, decoded body bytes or TTFB calculations.

Encoded cached-body totals sum available Content-Length and ResourceTiming metadata. Revalidated responses can omit both, so this total is a lower bound rather than exact avoided wire bytes. JSON also retains each request's `cached` flag and `decodedBodyBytes`; summing decoded bytes for cached requests measures the consumed cached content independently. Wire bytes include revalidation headers and remain the transfer measure.

Cold means browser cache and server process startup. OS file caches and Chrome's host process caches are not flushed. RSS includes the Node server's worker threads and is sampled at ready and after the scenario sequence, not continuously. Worker warmup uses existing scheduler `compileMs`. First paint applies to navigation; an interaction does not create a new paint-timing entry. Long-task phases follow the actual observed milestone ordering. These headless localhost results do not verify a phone, public internet path, or Player 2's device.

Optional `startupVariantMs` and `startupStateResponseMs` report saved-rule preparation and initial play-state response preparation, including Brotli/gzip encoding, before the server binds. Existing spawn-to-ready time includes this work. Readiness IPC carries numeric timings when the server exposes them; the existing authenticated post-suite diagnostics capture supplies a fallback. Older servers produce `null`/`—`. The separate preparation table identifies work completed during startup; calculation, navigation and network measurement boundaries remain unchanged.

## Unlock calculation and CPU attribution

```powershell
node --cpu-prof --cpu-prof-dir=.local/perf scripts/perf/unlock-calc.mjs --source .local/speed-save --chunks-per-member 8 --profile-unlocks 3 --output .local/perf/speed-unlock-calc.json
```

Run this separately from the browser harness. It reads the frozen copied save
and verified static sidecars, migrates only in memory if needed, and starts one
native task worker with the server's corrected definition bytes and world.
Eight deterministic locked chunks per player include roll-pool choices and
several adjacent choices outside that pool where available. Every unlock starts
from the same baseline; partner ownership and progress are checked unchanged.
Console output lists chunk IDs, median/p90 stage times and sampled peak RSS.

The script instruments temporary worker/engine modules under `.local/perf/`,
with checked source anchors and original dependency URLs. Production source
is never edited; scratch modules are removed after worker termination. It times
fresh compact selected/sidebar and peer/duo calculations, then separate full
calculations including Current BiS and Activity Info. Compact/full projection
hashes must match, normalizing only elapsed time. Reports retain input/app
hashes, result sizes, partner deltas, per-pass fixed-point checks and inclusive
access, processing, source, explanation and serialization phase times.

State stringify is a cold upper bound: the server can reuse verified static
field strings. Transfer residual includes scheduling and cannot isolate kernel
message transfer. Phase timers overlap and must not be added to their parent
stage. No save, HTTP, background job or browser time is included. Default
measurements cover eight choices per member; three are allowed only for a
smaller CPU diagnostic with `--profile-unlocks`. Inspector profiles for two or
three extra unlocks run after ordinary measurements and are excluded from their
medians. Those worker `.cpuprofile` files include inspector startup overhead;
attribute that separately from application work. Inherited Node `--cpu-prof`
also samples the ordinary stage measurements and main-thread orchestration, so
those timings must be labelled as sampled-profile measurements. Output and
profiles stay ignored under `.local/perf/`; source/app hashes are rechecked.

## Duo byte compatibility

`duo-compatibility.mjs` compares an untouched checkout with a candidate, with
`multiPicker` absent and present. Supply absolute paths with `--baseline`,
`--candidate`, `--source` (a released two-member gameplay directory with its
sibling dataset binding), `--packs`, `--defaults`, and an absent `--out` JSON file.
For example, use temporary input/output paths outside both checkouts. The tool
copies gameplay into temporary directories before opening it and runs one
server/calculator workload at a time. It refuses external sync fetches.

The ten raw response comparisons cover full/play state, history, browser plugin
status, full/play tasks for each member and native plugin status for each member.
Native keys are minted only after browser plugin status has been captured.
The gate also compares rewritten state bytes and verifies the source-state hash.
The output contains counts, hashes, sizes, real wall duration and sampled peak
process-tree RSS, with no response bodies or credentials. Linux RSS sampling is
50 ms; short peaks may be missed. Each revision/mode has one sample, so these
are compatibility timings, not performance medians or capacity estimates.

`duo-compatibility-clock.mjs` fixes only `performance.now()` in HTTP and calculator
processes/isolates; store writes use an identical injected timestamp. No response
fields are stripped or normalized. A nonzero response, size or state difference
fails the command. Keep ordinary performance measurements separate from this
fixed-clock gate.
