# Invite-only beta load trial

This is an opt-in synthetic HTTP harness, not a production capacity result or a
CI gate. It runs Node 24.20.0 or newer 24.x without dependencies. Run the full
trial on a disposable isolated host, preferably with a separate generator.
Never point it at a live service. It only accepts a target that implements the
credential-protected **synthetic harness control protocol**. The product has no
control routes added by this change.

## Short local smoke

On a shared machine, acquire the shared heavy-test lease, use BelowNormal
priority, one worker, and finish/release within ten minutes as described in
[testing](../testing.md). Do not run the full fixture or other benchmarks there.

```sh
node --test --test-concurrency=1 scripts/perf/beta/self-check.mjs
node scripts/perf/beta-load-trial.mjs --smoke --out .local/beta-smoke/receipt.json
```

The smoke runs five active groups, a separate small near-limit surrogate,
14 logins, 16 characters, 30 stored keys, 10 plugin clients/5 requests per
second, 2 product actions per second, 10-second ramps and 90-second steady
load. It retains 1,000 History events and ten snapshot-producing edits per
grown save (plus preserved pinned setup preimages). The full trial default is
300 snapshot-producing edits. Its catalogue (64 chunks/120 dependent tasks)
and 1 MiB large-save surrogate deliberately do **not** qualify for full-size
acceptance. All writes go into a new temporary synthetic tree, which is removed
after audit/shutdown. JSON receipts and bounded JSONL telemetry remain at the
requested output. Output files must be new. No credentials, host names or
absolute storage paths are written into the receipt.

## Isolated host and separate generator

Start the synthetic host in a clean checkout on the isolated machine. A new
control key file is created exclusively; transfer it privately to the generator.
These are synthetic credentials, but they permit stopping the trial. Bind only
on an isolated test network. Both the control port and the announced product
port must be reachable from the generator. The control endpoint does not proxy
measured traffic. Plain HTTP models application service time, not TLS or proxy
cost. The HTTPS gateway identity is supplied by a test-only listener adapter.

```sh
node scripts/perf/beta-load-trial.mjs --serve --host 0.0.0.0 --port 8990 \
  --key-file .local/synthetic-control.key --groups 50 --seed beta-1 \
  --max-open-contexts 128 --streams-global 512 --cold-global 4 \
  --cold-pending 256 --cold-per-account 2 --cold-deadline-ms 30000 \
  --plugin-global 256
```

On the generator, use the isolated host's address in place of this documentation
address. Driver seed/groups must match the host. The runtime settings in the
receipt come from the host; driver settings describe the offered workload.

```sh
node scripts/perf/beta-load-trial.mjs \
  --target http://host:8990 --key-file .local/synthetic-control.key \
  --groups 50 --seed beta-1 --seconds 3600 --actions 15 \
  --plugin-clients 150 --plugin-rate 75 --out .local/beta-1/receipt.json
```

Omit `--target` to launch a child host locally. Local child hosts always bind
loopback with OS-assigned ports. Every trial builds a new fixture and stops its
synthetic host at completion. Remove the obsolete control key after shutdown.
The harness has no save-directory, installed-release, provider-key or real
backup inputs. Ordinary product retention, journal durability, context idle
policy and worker admission remain enabled.

For settings sweeps repeat the command with new output/key files. Exposed
controls include `--max-open-contexts`, `--streams-global`, `--cold-global`,
`--cold-pending`, `--cold-per-account`, `--cold-deadline-ms`,
`--expensive-global`, `--plugin-global`, `--plugin-rate`, `--deadline-ms` and
`--max-in-flight`. Runtime defaults match the current product (including seven
contexts and 64 global streams); the example above supplies proposed trial
settings without changing product defaults. The receipt records the complete
resolved picker limits and cold-admission configuration, not just overrides.
`--limits-json '{"maxWaitersPerJob":32}'` can override any named
`MP7_DEFAULTS` limit, and `--admission-json '{"maxRetries":1200}'` can override
any `COLD_OPEN_ADMISSION` field. Unknown fields and nonpositive integers are
refused. JSON overrides take precedence over the corresponding shorthand flag.

## Population and schedule

The default is 50 active groups with sizes 1–5 and 150 logins. A seeded shuffle
and a repeating roster pattern supply more seats than logins, so some logins
have multiple characters. The setup uses real registry creation and invitation
consolidation APIs, accounts for initial solo pickers and retired source solos,
then issues synthetic account sessions and plugin keys offline. It does not
represent provider authentication throughput or runtime signup admission.
Random application IDs and credential entropy remain secure; the plan and
catalogue digests identify the reproducible logical fixture, not byte-identical
auth files. Seed, source SHA and dirty-tree status are recorded.

Approximately 25% of groups stay fresh and 75% grow. Grown states include
unlocks, skill/quest/item progress, private custom tasks, rule variants, around
1,000 History events, preserved pinned setup preimages and 300 real durable
snapshot-producing edits. Default retention may pack snapshots and archive
History. Actual retained counts and state digests are reported per group.
Earlier History is built after catalogue migration with `applyCommand` and supplied to `openStore` as
initial state; its inverses are valid but do not create another 1,000 snapshot
files. Only closed, task-owned synthetic gameplay directories are reinitialized
after invite provisioning. Pinned preimages from real setup replacements are
copied intact into those initialized stores before retention normalization.
No retention files are fabricated or pruned by the harness.

The generated catalogue defaults to 4,096 chunks, 23,939 tasks, dependency
depth eight and three cross-links. The existing calculator handshake and
migration helpers install the catalogue in the saved fixture before snapshots
are retained. Defaults also include 91,000 synthetic historical aliases and a
15.4 MB initial state target (`--aliases`, `--state-bytes`), reusing the older
public capacity profile's volume assumptions. Long historical labels supply
that volume; the dependency graph supplies executable work. These are explicit
synthetic assumptions, not calibrated real-player distributions. `--chunks`, `--tasks`,
`--history-events`, `--snapshots` and `--stored-keys` allow smaller experiments.
The separate large-save group defaults to roughly 200 MiB using synthetic
notes over the same catalogue (`--near-limit-mib`, maximum 207), near the 208 MiB source-save
limit. It is excluded from nominal cohorts and reported separately. Byte size
alone is not a realistic dependency-complexity calibration.

Scheduled arrivals are independent of completion: ramps request 25, 75 and
150 distinct logins, then steady load defaults to 15 product actions/s. A login
may need another document to keep each group active; people, documents and
groups have separate counts. Small fixtures explicitly cap the actual cohort.
Product actions use seeded shuffled
60-action blocks: 50% read/navigation/history, 20% task filters/explanations,
15% durable edits, 5% stable character selection, 8⅓% expensive work and 1⅔%
invitation create/revoke. Expensive work cycles through 40% task misses, 30%
Preview, 20% roll/accept and 10% pool/Undo. Each product action includes all its
HTTP prerequisites. Revision races and failed prerequisites remain visible;
writes are never automatically retried.

Plugin arrivals are jittered independently per operation and distributed across
clients, with a 40/40/20 report/status/tasks
mix at 75 requests/s by default. Five-second session checks are separate
arrivals. Synthetic upstream previews default to ten/minute, globally bounded
to two in flight; skipped arrivals are counted. The transport cycles through
success, private, unknown, malformed, oversized, timeout and 429 responses.
Reports carry a bounded durable item journal, retain unacknowledged events for
replay after restart, and audit committed journal acknowledgements on disk.
No fake transport ever falls back to a real provider.

Optional phases use `--phases` with a comma-separated list:

| Phase | Work |
| --- | --- |
| `headroom` | Build at least 100 groups; offer 200 logins and 20 actions/s. |
| `extra-tabs` | Add a second stream per online login, without counting extra people. |
| `cold` | Close/restart contexts and synchronize stream reconnects while arrivals continue. |
| `lifecycle` | Use a separately counted three-seat control group for leave/rejoin, handover and return, and character deletion; verify tombstones and revoked keys. |
| `overload` | Double the configured product and plugin arrival rates. |
| `restart` | Restart the synthetic application and replay ongoing plugin/session traffic with its existing durable state/keys. |
| `backup` | Capture the real online service checkpoint while arrivals continue; retain pause/capture timings. |
| `soak` | Continue nominal traffic for `--soak-seconds` (default 43,200). |

`--optional-seconds` defaults to 60. Example on an isolated host:

```sh
node scripts/perf/beta-load-trial.mjs --groups 50 --seconds 3600 \
  --max-open-contexts 128 --streams-global 512 --cold-global 4 \
  --cold-pending 256 --cold-deadline-ms 30000 --plugin-global 256 \
  --phases headroom,extra-tabs,cold,lifecycle,overload,restart,backup,soak \
  --soak-seconds 43200 --out .local/beta-full/receipt.json
```

For a separate host, pass fixture-affecting options (including `headroom`) to
`--serve` too. Run three independent seeds for the proposed three 60-minute
steady trials. A 2× overload is a beta envelope probe, not the separate
800-plugin-requests/s or 300–400-person acceptance proposal.

## Reading a receipt

HTTP completion measures dispatch through complete response consumption.
Scheduled-arrival completion includes generator delay and action prerequisites;
durable acknowledgement measures the successful command response separately.
Propagation measures acknowledgement through the first other authorized
character's connected stream. Events received before the HTTP response count
as zero; missing expected events fail the isolation/durability gate. Solo
documents without another character stream do not provide propagation samples.
No HTTP value is presented as usable-screen/render latency.

The in-process `testEventTransform` option adds the actual emitting context's
picker ID to SSE payloads so coinciding revisions cannot disguise foreign broadcasts.
It is the only product hook added for this harness, passed to legacy and owned
contexts by `createServer`, with no HTTP, CLI or settings-file exposure. The
default is absent and leaves event bytes unchanged. Request-local tags cannot
identify emissions from shared calculator callbacks reliably, which is why the
hook sits at the context emitter. Events without an emitter tag are counted as
untagged, not silently claimed verified.
State markers and rosters check response isolation. Final audit closes the app
and reopens durable stores to check every acknowledged revision and note token;
deleted characters must retain completed tombstones. The lifecycle phase checks stale
access immediately; restart tests retained authority. It does not claim a full
wrong-dataset restore or off-site recovery drill.

Per-phase histograms are bounded and report conservative upper percentiles
(approximately 1% buckets), counts and maxima. Requests, failures, 409 races,
429/503 refusals, missing Retry-After, timeouts, stream admission refusals and
generator drops have separate counters. Every unplanned established-stream
termination outside restart is conservatively counted as a possible capacity
eviction. The JSONL records request amplification, queue delays, admission
transitions, samples and generator CPU/RSS without cookies or keys.

Linux samples include process-tree CPU/RSS/swap, cgroup v2 limits and the HTTP
event-loop p99. RSS sums process hosts once; threads are not added twice.
Windows explicitly reports tree metrics unavailable and cannot pass the
resource gate from HTTP-process memory alone. Sampling can miss brief peaks.
The JSON receipt evaluates the proposed cheap/expensive/cold/switch/ack/event,
admission and resource budgets from [groups and accounts](../groups-and-accounts.md).
Unavailable metrics are **unmeasured**. `acceptance: unproven` is deliberate:
review raw failures, observation counts, all three steady trials, cold/recovery
and the long soak before making a beta capacity claim. A smoke only establishes
that the harness runs. Hardware-specific failures are evidence, not a reason
to raise the proposed budgets or alter product defaults.
