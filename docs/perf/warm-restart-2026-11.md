# Warm restart, November 2026

START: `a9e2cd27b744e529fc44df8e917b966a6387423a`.
Linux, Node v24.21.0, process calculators, no npm dependencies or Rust.

Persist the definition-derived collection and complete immutable calculator
replies, rather than trying to serialize executable engines or live snapshots.
The server defaults to `dataDir/warm-store`. Its two independent partitions
reserve 256 MiB for at most two collection graphs and 256 MiB for at most 254
replies. Every entry is limited to 128 MiB. Startup/publication pruning removes
files older than seven days and enforces both capacity limits. These
are shared limits, independent of player count. Reads retain no additional LRU.

Collection keys retain the existing dataset digest, definition bytes, options,
preparation stages, application `.mjs` source digest, Node and V8 versions.
Reply keys also cover every semantic worker input, including world and extra
rules, then the complete hydrated calculation state, exact revision, picker,
member, task input, request arguments and projection flags. Requested Preview
progress frames are replayed before the final paired reply. Different inputs
miss; equivalent objects with different serialization order may also miss.

Each file has a versioned header, length, key and SHA-256. Readers reject symlink file entries,
oversized files, truncated bodies, changed checksums and invalid serialization.
Publication uses a private temporary file and rename. Nonblocking cross-process
writer locks bound pending writes; dead writers' remnants are reclaimed after
one minute. Pruning reserves space before writing, including temporary bytes.
No new native compression handles are constructed in terminable calculators.
Root preparation gives created files the service directory's ownership.

| State lost at restart | Decision |
| --- | --- |
| Prepared collection | Persist the existing validated graph; restore for foreground and advisory calculators. |
| Compiled task engine | Rebuild executable closures and saved-rule variants. |
| Per-player snapshots | Rebuild live indexes when computation is needed; restore complete full/play replies for exact requests. |
| Obligation cache | Evaluation-local, already recreated during ordinary evaluations; never persist object-keyed traversal state. |
| Prediction cache | Persist the completed delta and both reusable task projections together. Cancelled/incomplete computations are not published. |
| Pool-ranking rows | Rebuild from restored predictions through the existing summary observer and queues. |
| Summaries | Activity/equipment summaries travel in persisted replies. Small ranking summaries are recomputed. |

Existing startup task queues remain responsible for admission, quiet windows,
foreground priority and idle deadlines. This adds no independent keep-warm or
recency policy; W1 can use the persistence layer without changing its policy.
No cache eagerly loads every player's state at startup.

VPS prepare/stage still only build and verify the candidate. Online deployment
now prepares the candidate calculator against the captured copy, before stopping
the writer. It warms at most eight members, full/play/sidebar/peer views, and
one eligible Preview each, using one process calculator at reduced OS priority and a 180-second outer
budget. Older candidates or failed preparation fall back to ordinary startup.
An intervening save revision deliberately misses. `rehearse` uses this same
online deployment path. Service-wide recency selection remains a scheduling
concern; the online helper targets the single-picker release path.

Warm artifacts are excluded from online single-store snapshots, stopped save
identity and stopped recovery copies. They cannot force a stopped compatibility
re-probe, enter a portable recovery, or race save snapshot enumeration. Existing
service gameplay exports already use an allowlist that excludes them. Portable
and compatibility probes disable persistence so disposable per-picker copies
do not retain independent cache budgets.

Files:

- `app/tasks/warm-store.mjs`: bounded atomic file storage, integrity and pruning.
- `app/tasks/warm-results.mjs`: exact namespaces, request keys and reply transport restoration.
- `app/tasks/prepared-collection.mjs`: persistent graph references; temporary behavior remains available.
- `app/tasks/worker.mjs`: small restore/publication hooks after snapshot resolution.
- `app/tasks/scheduler.mjs`: persistent directory and graph sharing between native lanes.
- `app/server.mjs`: default directory under the data directory; `taskWorkerOptions.warmStoreDirectory: false` disables persistence.
- `app/storage/snapshot.mjs`: omit disposable warm files from the writer snapshot.
- `scripts/linux/prewarm.mjs`: calculator-only online preparation from a copied save.
- `scripts/linux/operator.mjs`: invoke preparation before the writer pause.
- `scripts/linux/runtime.mjs`, `scripts/private-companion/release-pack-check.mjs`: disable persistence in recovery probes.
- `scripts/linux/files.mjs`, `scripts/linux/recovery.mjs`: omit warm artifacts from save inventories/copies.
- `scripts/perf/warm-restart.mjs`: repeatable cold/warm, component, CPU, RSS, disk and hash probe.
- `tests/warm-store.test.mjs`, `tests/warm-candidate.test.mjs`, `tests/warm-restart-worker.test.mjs`, `tests/warm-restart-server.test.mjs`: integrity, bounds, key invalidation, interrupted publication and actual server restoration.
- `tests/linux-operator.test.mjs`, `tests/online-snapshot.test.mjs`: deployment ordering and recovery exclusion.
- `scripts/test-selection.mjs`: classify the added tests.

## Measurements and correctness

All timing summaries use five fresh Node processes per number, median [min–max].
The calculator-only probe validates a disposable save copy and verifies complete
results sequentially. Task-list elapsed time includes canonical verification;
Preview elapsed time is the previous verified pool timestamp plus the first
owner-ready delay. Request durations exclude result verification. These are
calculator measurements, not private HTTP or systemd lifecycle measurements.
CPU includes input loading and, for the complete workload, hash verification.
Idle RSS is sampled two seconds after the workload. No server or normal store
was opened against a private copy.

Input counts: 2 members, 23939 stored tasks, 2594 world chunks.

- Dataset SHA-256: `3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`.
- Copied source SHA-256: `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
- Hydrated calculation state SHA-256: `13654556cfd6def495fcf18b96f3a481dfc9af7a13dd0a55ab19f4f87eb646c1`.

Full canonical reference results (existing volatile exclusions unchanged):

| Member index | Request | Count | SHA-256 |
| ---: | --- | ---: | --- |
| 1 | Full tasks | 20544 | `984a731fa7d9a74140697b01a51b64db7d7494355d56c6efe11ca78df1fbec78` |
| 1 | Play tasks | 20544 | `096950678635b177b03c5e180a411bae542a30fc0f34cabad00eac1c3952e2f3` |
| 1 | Roll pool | 7 | `843c53c04700947b65567dc46d8714458fdba830f893e54fb17f4fbf63ee0562` |
| 1 | Preview | 13 | `e865cb4cf07b5c27e42617819a0fbb6b749c153dfa57687dccafb7c4bc54ba26` |
| 2 | Full tasks | 20560 | `6e773611c6a8bebd4c0c2bb672daebd01d280347c07b762eedb2d41b40153135` |
| 2 | Play tasks | 20560 | `26767affb920394d3d211ff3c438b2b66a37101a2be124eccec1ee97c116c726` |
| 2 | Roll pool | 30 | `99430fb0880d7b7dd91a1d0eae182b84ad934a53233f12f7f41b29f134dfa584` |
| 2 | Preview | 0 | `07c34c3a203f6a195fb6447e6d4dd6c00c6ee3e0cbadcacf3133f001914777d7` |

Q2 compared START with START plus the staged code/test patch, using the explicit
`--candidate-patch` control; no candidate commit or remote action was needed.
Patch SHA-256: `7726f6d5e94c056e705f3c866cc5a760e10055cc3a03cfc1be6a4b029679c079`.
Both corpus sources and all 9 operations had successful results:
1548/1548 pairs, 1247 successful result pairs,
301 matching negative-case pairs, 0 differences and 0 harness errors.
Fixture harvest: 30 passed, 0 failed.
The supervisor completed with exit 0 in 140.23 s;
peak sampled process-group RSS 1203.85 MiB.
Corpus SHA-256: `10684cf617bb97c4056f78ec34d1de2904c3aa03c0545ac3b3ffa47d2174f027`.



| Measurement | START cold | Candidate cold | Candidate warm |
| --- | ---: | ---: | ---: |
| Process start → ready, s | 14.30 [12.99–61.58] | 15.32 [14.39–20.60] | 13.08 [12.45–17.32] |
| Process start → verified first task list, s | 29.37 [26.26–83.26] | 31.03 [28.76–46.84] | 16.00 [15.78–20.15] |
| Process start → first Preview, s | 42.70 [38.43–98.76] | 43.54 [41.41–60.38] | 20.16 [19.75–24.53] |
| First task-list request, s | 13.62 [11.98–20.12] | 13.90 [12.32–24.42] | 1.57 [1.46–1.90] |
| First Preview request → owner ready, s | 8.68 [7.99–11.84] | 8.26 [7.89–11.36] | 1.30 [1.16–1.49] |
| Ready compilation, s | 2.88 [2.84–6.61] | 4.26 [3.60–5.69] | 2.55 [2.38–3.49] |
| CPU through ready, core s | 21.35 [19.77–81.22] | 23.93 [23.15–36.04] | 20.31 [19.53–26.17] |
| CPU through workload, core s | 111.66 [101.29–184.46] | 138.90 [105.64–147.61] | 46.83 [45.12–50.62] |
| Worker peak RSS, MiB | 1798.07 [1721.39–1945.47] | 1616.91 [1497.10–1793.18] | 936.78 [902.27–965.67] |
| Worker idle RSS, MiB | 1775.32 [1714.00–1856.59] | 1591.84 [1489.03–1793.18] | 845.17 [809.62–900.39] |
| Probe parent peak RSS, MiB | 1174.46 [1159.75–1317.31] | 1242.28 [1213.36–1253.85] | 1208.44 [1180.19–1246.88] |
| Probe parent idle RSS, MiB | 937.59 [930.32–1092.93] | 1069.29 [1025.81–1148.93] | 963.54 [955.14–993.19] |
| Persistent artifact bytes | 0 [0–0] | 173363950 [173363901–173363974] | 173363901 [173363901–173363901] |

Each cold candidate sample uses an empty store; warm samples use artifacts
published by the final code. All samples in the reported groups are retained.
Cold candidates include graph/reply publication. Raw request transport and full
canonical verification make the probe parent substantial; its RSS/CPU is not an
HTTP-server footprint. Initial dataset loading and executable compilation still
run. Cold publication adds work, reflected in the cold CPU column.

The measured warm store contains 9 files and 173363901 bytes:
1 collection file (85781709 bytes) and
8 reply files (87582192 bytes).
Application source SHA-256: `032aed006f5b3a102089b907b1fd3fb961f85c4ef6a8242e9a4727dc74b01f9e`.

Component probe, five fresh START processes, no persistent results:

| Rebuild component | Median [min–max], ms |
| --- | ---: |
| Saved-rule engine preparation | 1555.04 [1475.85–2224.53] |
| First-player engine/fixed-point work after preparation | 6248.51 [6095.92–8342.97] |
| Second-player engine work | 2454.57 [2269.78–2622.46] |
| Repeated snapshot engine work | 0.00 [0.00–0.00] |
| First full request after preparation | 9281.88 [8959.98–11545.09] |
| Repeated full request | 1546.03 [1464.67–1724.80] |

Obligation traversal caches are evaluation-local; their work is included in the
engine phase rather than presented as a separately persistent cache. Ready
compilation includes collection/catalogue work, not just one engine function.

Ranking projections from restored real-size deltas, five processes per row:

| Pool rows | Checked rows | Summary bytes | Summary, ms | Ranking remember/read, ms |
| ---: | ---: | ---: | ---: | ---: |
| 7 | 1 | 455 | 0.92 [0.64–1.00] | 0.79 [0.63–4.40] |
| 30 | 1 | 163 | 0.30 [0.18–1.27] | 0.14 [0.14–8.01] |

Across the five cold and five warm candidate runs, all 80 full canonical answers
match the recorded START hashes: 0 differences. All 40 serialized task-view
buffer comparisons against the cold seed are byte-identical: 0 differences.
The 20 paired reuse comparisons have 0 differences. Warm requests perform
0 engine evaluations. Complete Preview progress/final sequence equivalence is
also covered by the process-worker test. No canonical exclusions were added.

Validation:

- Targeted integration/regression run: 157 passed, 0 failed, 1 existing skip.
- Final protocol/server/probe rerun: 5 passed, 0 failed.
- Final online-preparation/priority tests: 3 passed, 0 failed.
- `npm run test:quick`, once: 3434 passed, 0 failed, 68 existing skips; 664.39 s.
- No full `npm test` run, as requested.
- Copied-state difference count: 0. Credential-file count in the private copy: 0.
  Changed entries in the lab checkout: 0.

Risks and remaining integration:

- Exact revision/input changes or opening migrations deliberately miss. Online
  preparation cannot promise hits after an intervening writer change.
- Unpersisted operations and new Preview candidates rebuild live snapshots and
  closures on demand. Cached replies do not recreate those executable graphs.
- W1 owns recent-player selection and continued warming. The online prewarm
  helper targets the single-picker deploy path; service-wide selection remains
  a separate policy integration.
- No private server/store, private HTTP timing, or actual VPS/systemd deployment
  was run. Those checks were skipped under the private-data rules. Confirm the
  lifecycle timing on the VPS before treating the laboratory numbers as an SLA.


## Review fixes

Collection file bodies are validated by the calculator, not by the server's
worker-launch path. A separate short-lived publisher thread validates returned
collection bytes and publishes persistent or temporary files. Publication is
bounded to one pending entry per preparation owner; foreground launches do not
await it. Missing or corrupt files still rebuild normally, and a failed restore
can return the rebuilt collection for replacement.

Root publishers prepare service-owned lock directories and owner files before
atomically exposing `.write-lock`. This also covers interruption between
creation and ownership correction. Stale unpublished lock stages are reclaimed;
failed acquisition is reported once per store instance rather than silently
failing on every later publication/prune. Process calculators inherit service
stderr so these warnings reach the journal.

Traversal audit (`inventory`/`walk` under `scripts/linux` and `app/storage`):

- Service checkpoint gameplay copies omit `warm-store` before enumeration,
  matching the existing single-store snapshot exclusion. Service recovery
  copies, identities, installation comparisons and listings also exclude it.
- Stopped single-store copies/identities already exclude it; restored-store
  verification and the offline rehearsal's initial copy now do so as well.
  Compatibility/derive probes run on these filtered copies with persistence
  disabled.
- Remaining inventories inspect immutable release trees, pack payloads,
  already-filtered snapshots/backup manifests, or stopped ownership-repair
  trees. Backup manifest verification remains complete so unexpected files
  cannot be hidden by cache exclusions.

Regression fixtures use synthetic collection padding, intercepted parent-thread
body I/O/hashing, emulated root/service ownership, dead-owner lock metadata and
invalid warm-tree entries. They require no private saves or live VPS.

Review-fix validation on Windows, Node v26.13.0: the seven requested warm-store,
restart, candidate, snapshot, operator and prediction-cache files plus
`prepared-collection`, `linux-multi-picker`, `linux-service-crash` and
`linux-recovery-paths` ran with test concurrency 1. The batch had 209 passes,
one existing root-only skip and one pre-existing unconditional `process.getuid`
fixture failure. That fixture now uses the neighboring portable UID/GID
fallback; its focused rerun passed (1/1), giving 210 passing cases and one skip.
No full suite or live Linux/VPS check was run.

### Follow-up review fixes

Each published lock now has a unique owner-file token. Removing that exact
token atomically claims a dead lock for reclamation; another reclaimer that
observed the same owner skips if the token is gone. New locks never reuse the
legacy `owner` filename, so older PID-only locks remain reclaimable without
letting a delayed reclaimer delete a replacement writer's metadata. Live stages
retain their tokens even after a minute. Root publishers still transfer stage
and token ownership to the service user before exposing the lock.

Calculators retain the original file-preparation flag before dropping transfer
inputs. File-backed replacements validate their collection before the ready
message, including when the ready catalogue is omitted. A body-validation miss
returns the rebuilt preparation for publication even when the header was valid
and `collectPreparedCollection` was false. The next calculator can restore the
repaired file. Calculation logic is unchanged.

Regression tests control two reclaimers after they read the same dead PID,
hold the winning writer with an active temp file, and verify exclusive writing
and preservation of that file for tokenized and legacy locks. A separate process
worker test changes only the collection body, preserving the header and length,
then checks identical cold results, repair publication and a warm restore.

Follow-up validation on Windows, Node v26.13.0: `warm-store` (12),
`prepared-collection` (14) and `warm-restart-worker` (3) passed sequentially:
29 passed, 0 failed, 0 skipped, about 15 seconds for the final run. Both reported
bugs were also reproduced by running the new regressions against the original
implementations. Ownership checks emulate root/service UIDs; no live Linux/VPS
check or performance benchmark was run.

Written by Codex.
