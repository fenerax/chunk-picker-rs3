# Session residency and offered Preview preparation

START: a9e2cd27b744e529fc44df8e917b966a6387423a. Linux, Node 24.21.0,
process workers. Written by Codex.

## Policy and implementation

START retires logical lanes after ten minutes without interactive calculation.
Background work does not renew that clock. Its optional physical calculator pool
also has a ten-minute timer. Ready task results, prediction deltas and prepared
owner/partner task bytes have separate bounded caches. `retireWarm` and
`yieldForInteractive` distinguish unsolicited work from a producer that has
already served Preview; that producer remains requested until its partner ends.
The pooled cancellation grace is 25 ms. Those protections remain in place.

START already prepares pending and selected choices before ranking candidates,
interleaves members, and uses picker-scoped prediction keys. Preparation could
remain behind a task-list gate even when no list request was running. A roll
that changed only choices did not independently restart that plan. A tight
fairness allowance could also reject the next candidate after early Preview,
without another notification when partner preparation finally released admission.

The candidate adds:

- `app/tasks/session-residency.mjs`: request/SSE leases, memory-derived defaults
  and numeric diagnostics. Thirty minutes of recent activity plus ten minutes of
  idle grace; an open writable SSE stream renews interest until it closes, then
  the ten-minute grace starts. Viewer and monitoring reads do not renew leases.
- `app/tasks/calculator-pool.mjs`: a shared physical-worker cap, conservative
  reservations including starting/retiring workers, Linux process RSS sampling,
  and eviction of idle or expendable workers by the last served picker's activity.
  Already-retiring workers prevent replacement allocation until exit. Background
  completion cannot extend the session deadline. Shared compiled calculators
  stay available while any player session is active, within the memory budget.
- `app/tasks/scheduler.mjs`: small integrations for leases, lane sleep, and a
  preparation-complete notification. Picker caps, round-robin admission, cache
  keys, `served()`, reuse, yield grace and cancellation rules remain intact.
- `app/storage/store.mjs`: cheap pending-offer metadata and choice-change
  notifications, without hydrating a calculation state or changing saved bytes.
- `app/picker-context.mjs`: authenticated activity/SSE wiring; pending offers
  bypass unrequested-list/startup gates, while actual interactive work and the
  quiet window still win. Choice changes cancel obsolete unsolicited work and
  restart the plan. Final preparation notifications refill bounded admission. Each
  offered choice receives at most one automatic completed attempt per input/plan,
  so oversized/evicted responses cannot create a retry loop.
- `app/game-plugin.mjs`: authenticated plugin traffic renews session interest,
  including saved task-list reads; it still starts no calculator work.
- `app/server.mjs`: enable bounded residency for native calculators. Custom
  factories opt in explicitly; `taskWorkerOptions.residency: false` opts out.
- `scripts/perf/keep-warm.mjs`: calculator-only session and memory experiment.
  `scripts/perf/picker-footprint.mjs` explicitly isolates its forced-sleep profile
  from session residency so its existing cold/warm contract remains valid.
  Tests cover initial residency, multiple streams, close/cancel, expiry,
  background priority, memory pressure, delayed termination, offer readiness,
  fairness refill, authentication and viewer isolation. The new test file is
  classified in `scripts/test-selection.mjs`.

Both the browser's `/api/predict` and `/api/prediction-intent` and the plugin's
prediction peeks continue through the existing task-input/canonical-revision
prediction key. Browser intents still represent explicit requested work. Pool
ranking remains interest-driven and follows offered/selected choices. Accepting
an offer still reuses the prepared pair only after its complete task fingerprint
matches the committed save; the existing eager refresh remains in place.

## Resource controls

| Control | Default |
| --- | --- |
| `RS3_SESSION_ACTIVE_MS` | 1800000 |
| `RS3_SESSION_IDLE_MS` | 600000 |
| `RS3_CALCULATOR_RESERVATION_BYTES` | 2147483648 |
| `RS3_CALCULATOR_MEMORY_BYTES` | Derived below |
| `RS3_MAX_RESIDENT_CALCULATORS` | At most 4, reduced by memory |

The memory budget is the smaller of 60% of effective total RAM and available RAM
minus a reserve of min(2 GiB, 25% of total), clamped to zero. There is no 2 GiB
floor. Effective total honors Node's constrained-memory observation; available
RAM also honors Node's available-memory observation. Environment and explicit
budget overrides can lower this ceiling but cannot raise it. Each live slot
reserves max(configured reservation, observed RSS). The final cap is also bounded
by any existing `maxCalculators` setting and floor(budget/reservation). An 11 GiB
host with 8.5 GiB free yields a 6.5 GiB budget and three resident slots. A 2 GiB
host with 1 GiB available yields a 0.5 GiB budget. Below one full reservation,
keep-warm and all prepare-ahead are disabled: requested work uses at most one
calculator, subject to the actual RSS ceiling and the original idle lifetime.
An SSE lease cannot extend that lifetime. A zero budget refuses calculator
startup without allocating a worker. Several pickers share these slots, rather
than allocating one calculator per picker. Diagnostics expose limits, actual
RSS, eviction and emergency counts. Session/stream counters are scoped to the
authenticated picker; only the internal scheduler exposes global counters.
The existing `RS3_WORKER_IDLE_MS`
remains a fallback for session idle grace; `RS3_SESSION_IDLE_MS` takes precedence.
Viewer expiry tests use a short session window and retain their sleep assertions.

The RSS ceiling is enforced against requested work too. Native residency uses
owned process workers on every platform, including when thread mode would
otherwise be selected. The pool samples Linux process RSS every 100 ms and at
admission/completion; process-host RSS reports provide the Windows fallback
without waiting for a synchronous calculator to answer. Starting and retiring
processes remain charged until exit. Admission queues work while the charged
memory exceeds the ceiling; it cannot start a replacement beside a retiring
process. Unrequested production and advisory graphs are reclaimed before
foreground. Advisory admission reserves foreground headroom and cannot evict
foreground to start another advisory job. Interactive work can yield unsolicited
producers across groups.

An actual RSS breach permanently disables keep-warm and prepare-ahead for that
pool's lifetime. Expendable work goes first; if that is insufficient, requested
advisory jobs, then foreground jobs, are atomically cancelled and their process
is force-killed. Affected request waiters receive retryable HTTP 503 errors;
even an unfinished partner of a served Preview cannot bypass this emergency
bound. Queued requested work keeps its admission order and deadlines. Ordinary
yielding, sleep, cancellation grace and `served()` protection remain unchanged
outside this emergency. A sampled RSS guard cannot prevent allocations between
samples; the OS/server reserve absorbs that detection window. Service-manager
limits remain appropriate as the final OS allocation limit.

Prepare-ahead also requires recent authenticated writable activity or a current
writable SSE stream for that picker. Saved offers at startup, viewers and
diagnostic polling cannot establish this interest. The server checks before
hydrating a preparation plan, and the pool checks again at dispatch. Small-host
and emergency modes reject optional admission entirely.

## Measurement method

Five fresh processes per policy; no concurrent heavy campaigns. The save is read
from a temporary copy using plain filesystem reads, checksum verification and
state validation. The harness forbids server/store/context imports. No credentials
are created. Actual requests, worker compilation and CPU time run normally;
5/15/30-minute gaps and session expiry advance an injected idle clock.

The initial full task lists and pool are calculated first. The scenario creates
one pending choice from that pool, with disjoint selected/pending sets. Before
measures unprepared Preview; after schedules ordinary low-priority preparation
after a one-second quiet interval. Preview opens after a fixed 15 seconds of
think time; both readiness lead time and actual click wait are reported, including
any unfinished preparation. This isolates cold versus prepared paths, including clients without
browser intents. Existing browser-intent/prepared-cache cases can already be warm
on START; this is not a claim that every START browser session incurs a cold wait.

Both members' post-accept compact lists are read after partner preparation ends.
Full lists are primed before each independent gap. The after session holds a
writable SSE-equivalent lease throughout. Six additional picker identities then
exercise the same state and shared resources, followed by all four lanes at once.
The final candidate uses three slots, a 2 GiB reservation and a fixed 6.5 GiB
worker budget, matching the derived VPS profile. A preceding five-run tuning
profile allowed four slots with 1.25 GiB reservations; its measured per-worker
high-water mark reached 1.882 GiB, motivating the final reservation and cap.
Memory is sampled from Linux /proc every 50 ms, including worker high-water marks;
parent RSS includes canonical-hash verification overhead. Final idle sampling
waits for calculator retirement after session expiry.

## Evidence

Candidate: `ca39046f21202be0c94bfe094bac3978ed8208eb`. Four-CPU quota, 16 GiB container limit; the final calculator controls simulate the 11 GiB VPS profile. No OS file-cache drop between fresh processes.

### Correctness

- Focused final regression set: 320 passed, 0 failed, 0 skipped (61.719 s).
- Q2 START versus candidate: 1548 / 1548 pairs, 1247 successful result pairs, 301 matching negative-case error pairs; 0 differences, 0 harness errors. Inputs verified; all nine operations have successful coverage.
- Q2 fixture harvest: 30 passed, 0 failed; 12 synthetic cases. Wall 125.082 s; sampled process-group peak 1235.297 MiB.
- Q2 corpus SHA-256: `f7a25da9fe8085f6f75c465d741d2001d76ae28ae5e7dfa4a20db7101ea9ce2b`.
- Lab result comparison: 110 complete canonical request/stress pairs over five trials per policy, 0 hash differences, 0 count differences. All ten trials use identical source, normalized-state and dataset hashes.
- Ordered request/count/hash corpus SHA-256: `c12f45bcb09ab55a7560e873dc4e4eedd06ad3e6de85f573d603c583b6f85f85`.
- Input safety: 431 copied files; 0 credential files; 0 tracked lab checkout changes; source/copy/recorded-source hash differences 0. One source hash, one normalized-state hash and one dataset hash across all ten main trials. State-file size: 766384 bytes.
- `npm run test:quick`, once: 3432 passed, 1 failed, 68 existing skips (3501 cases; 720.529 s). The synthetic footprint benchmark waited for forced sleep while the new session policy retained its calculator. Isolated reproduction: 0 passed, 1 failed; untouched START: 1 passed, 0 failed.
- `scripts/perf/picker-footprint.mjs` now explicitly opts out of session residency in its cold-start measurement profile, alongside its existing prewarm controls. The test assertions are unchanged. Post-fix isolated result: 1 passed, 0 failed (8.144 s). The quick suite was run once as requested; it was not repeated after this benchmark-only repair. Application sources remain identical to the Q2-verified and lab-measured candidate.

### Lab input and complete result hashes

Source SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.

Normalized calculation-state SHA-256: `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1`.

Dataset SHA-256: `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`.

Input counts: 2 members, 23939 source tasks, 2594 world chunks. Indices below identify array positions only.

| Complete canonical result | Count | SHA-256 |
| --- | ---: | --- |
| Initial full evaluate 0 | 20544 | `984a731fa7d9a74140697b01a51b64db7d7494355d56c6efe11ca78df1fbec78` |
| Initial full evaluate 1 | 20560 | `6e773611c6a8bebd4c0c2bb672daebd01d280347c07b762eedb2d41b40153135` |
| Roll pool | 7 | `843c53c04700947b65567dc46d8714458fdba830f893e54fb17f4fbf63ee0562` |
| Offered prediction | 13 | `e865cb4cf07b5c27e42617819a0fbb6b749c153dfa57687dccafb7c4bc54ba26` |
| Accepted play evaluate 0 | 20544 | `6f0371e868240023e36d8352301a1e1b538326fd92d393528c5b5c193450e238` |
| Accepted play evaluate 1 | 20560 | `d1386cc2e6f20867bd054977d4290c90f5a494c42029f80dea891bdc175a9529` |
| Accepted full evaluate 0 | 20544 | `b0b139019e25d798ba803497e1a1b5e7cde7126f5438ce3aefc9923377bf2077` |
| Accepted full evaluate 1 | 20560 | `6654597f7ee6a52c924fad84114ed608fd1569c94ba24039d0e9a6ece345d605` |
| Stress prediction | 0 | `d58077c60cedb8ddb38aea7ebe9bff6d83525a4b43cb33c2cce1cf87cc739dd1` |
| Stress death estimates | 1 | `a139053382a5324b42b22af341d2e9840f98166f81dc030f754a9156e4392efd` |

Full-list primes and gap reads have the corresponding accepted-full hash. Stress foreground and peer reads have the accepted-full-0 and accepted-play-1 hashes. Hashing uses the existing calc-check canonicalizer and unchanged volatile exclusions, covering the complete result for each requested view.

### Timings

Milliseconds, five fresh processes per column: median [minimum–maximum]. These are calculator/scheduler timings including result access for canonical verification. HTTP transport and browser paint are outside this harness.

| Request | START | Candidate |
| --- | ---: | ---: |
| Cold initial full list, index 0 | 9566.778 [8144.427–10631.837] | 8645.398 [7949.903–16266.567] |
| Cold initial full list, index 1 | 3947.953 [3692.935–4249.213] | 3999.519 [3794.791–4152.218] |
| First Preview click, 15 s lead | 16376.301 [15535.056–19014.944] | 2839.546 [1972.659–18461.204] |
| Post-accept compact list, index 0 | 22.827 [20.453–27.928] | 24.536 [18.771–393.156] |
| Post-accept compact list, index 1 | 25.011 [20.230–30.987] | 24.593 [23.874–38.305] |
| Full list after 5 min gap, index 0 | 0.478 [0.300–0.524] | 0.608 [0.540–0.832] |
| Full list after 5 min gap, index 1 | 0.349 [0.265–0.386] | 0.770 [0.399–1.036] |
| Full list after 15 min gap, index 0 | 12318.833 [11826.243–17667.600] | 0.477 [0.440–0.896] |
| Full list after 15 min gap, index 1 | 3966.288 [3607.895–4346.645] | 0.464 [0.376–0.588] |
| Full list after 30 min gap, index 0 | 12681.905 [11811.389–14945.290] | 0.461 [0.331–0.964] |
| Full list after 30 min gap, index 1 | 3594.772 [3350.513–4950.208] | 0.338 [0.309–0.458] |
| Owner delta ready after roll, including quiet interval | — | 18031.006 [17259.814–34079.379] |

The final Preview calls report `hit=1` in all five runs: they join the existing in-flight producer. Completed owner deltas were ready within the nominal 15-second lead in 0/5 runs. The first cold preparation therefore remains a visible wait when Preview opens early; the cache-hit flag alone must not be read as a ready-response hit. Opening after preparation is covered by the native server cache-hit tests.

Both post-accept projections are already prepared on START with #105; this run confirms their fast reuse is preserved. The large residency win is the 15/30-minute gap, where START sleeps and recompiles while the candidate retains its current full results.

### Resident memory

MiB, five fresh processes: median [minimum–maximum]. RSS includes hosting processes and calculator threads exactly once. The parent includes large input/result objects retained for hash verification.

| Measurement | START | Candidate |
| --- | ---: | ---: |
| Sampled aggregate peak RSS | 6819.258 [6246.301–6972.234] | 5588.402 [5386.852–6240.484] |
| Largest single-worker high-water RSS | 1683.508 [1575.156–1815.898] | 1743.629 [1721.258–1808.109] |
| Worker RSS after first Preview | 2301.250 [2258.961–2463.141] | 2332.141 [2282.859–2482.949] |
| Worker RSS after 5 min gap | 2581.539 [2519.715–2631.305] | 2616.430 [2568.402–2653.629] |
| Worker RSS after 15 min gap | 0.000 [0.000–1078.832] | 2616.430 [2568.402–2653.629] |
| Worker RSS after 30 min gap | 1010.723 [0.000–1094.738] | 2616.430 [2568.402–2653.629] |
| Worker RSS during seven-picker/four-lane stress | 5030.988 [4659.715–5205.574] | 3777.074 [3537.812–4362.750] |
| Parent RSS after expiry | 1675.805 [1565.930–1766.660] | 1845.664 [1551.199–1863.242] |
| Worker RSS after expiry | 0.000 [0.000–0.000] | 0.000 [0.000–0.000] |

Final physical calculator peaks: [3, 3, 3, 3, 3]; all equal the configured cap of 3. Maximum reserved bytes at stress: 6442450944 against budget 6979321856. Native evictions in these runs: 0. Fake-budget tests force eviction and prove that retirement cannot over-allocate replacements or repeatedly evict another useful worker.

Gap memory samples are taken 50 ms after the idle-clock jump; START can still have a process retiring at that point. Final expiry sampling waits for real exit.

Keeping two calculators resident through active gaps spends roughly their summed RSS to remove cold waits. The final stress also exercises the third slot. All worker RSS is released after expiry in every trial. These measurements replace a private server/store footprint run, which is forbidden because it creates credentials.

### Commands and checks

Review-fix validation on Windows, with synthetic fixtures only, run one command
at a time (no full suite):

- Required seven-file regression command: 129 passed, 0 failed, 0 skipped
  (36.883 s), including all of `prediction-cache.test.mjs`.
- Calculator-pool consumers found with `git grep -l calculator-pool tests`, plus
  scheduler, warmstart-scheduler, picker-fairness-isolation, process-worker and
  process-worker-transport: 150 passed, 0 failed, 0 skipped (16.567 s). This run
  also repeats session-residency, so the two counts overlap.
- New regressions cover the 6.5 GiB foreground/advisory pressure case,
  cross-group and compiling-producer preemption, growing requested RSS,
  a served Preview partner, startup RSS, delayed exit/admission, small/zero
  budgets, immediate force-kill, picker-private counters and inactive saved
  offers. Game calculation implementations are unchanged.

The following checks and performance commands describe the original candidate:

The six touched/added test files are `session-residency.test.mjs`,
`picker-context.test.mjs`, `plugin-reads.test.mjs`, `prediction-server.test.mjs`,
`storage.test.mjs` and `viewer-permissions.test.mjs`. They cover leases, bounded
memory/retirement, writable and viewer traffic, plugin authentication, pending
offers and one-job refill with oversized responses.

The focused run also includes workers-idle, prediction-cache, picker-calculator-cap, picker-fairness-isolation, warmstart-scheduler, server-reliability, idle-memory-server, startup-warmup, test-selection, storage-play, storage-undo-safety, scheduler, unlock-reuse and plugin-reads-server. No full npm test run.

Reproduction uses Node 24.20+ with the ordinary dataset/packs/defaults environment and process workers. Supply a copied temporary save; neither command opens a store or server.

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/keep-warm.mjs --root <START-worktree> --data-dir /tmp/<copied-save> --policy before --runs 5 --output /tmp/before.json
node scripts/perf/keep-warm.mjs --root <candidate-checkout> --data-dir /tmp/<copied-save> --policy after --runs 5 --output /tmp/after.json
node scripts/experiments/q2-diff-engine/supervise.mjs --reference-ref a9e2cd27b744e529fc44df8e917b966a6387423a --candidate-ref ca39046f21202be0c94bfe094bac3978ed8208eb --out /tmp/q2
npm run test:quick
```

Remaining cold paths: a first advisory calculator after restart/true expiry, memory or response-cache eviction, a newly requested unoffered hypothetical input, and opening before preparation completes. The review fixes enforce an RSS breach by emergency cancellation rather than allowing requested work to grow until completion. A real elapsed idle soak and an OVH run remain useful follow-ups.


## Limits

The review fixes add process RSS telemetry and forced retirement; they do not
change engine results, game rules, data files, browser code, changelog or roadmap.
The performance measurements above describe the original candidate and have not
been rerun for these safety fixes. Private HTTP/plugin and normal-store footprint checks were skipped: those
checks create credentials and are prohibited for these inputs. Calculator-only memory/session
measurements replace that private check. Physical hard limits should still be
provided by the service manager. Real elapsed 30-minute soak and OVH deployment
are outside this sandbox run; no deployment or GitHub write was performed.
