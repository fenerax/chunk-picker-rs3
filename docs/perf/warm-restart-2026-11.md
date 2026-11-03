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
Only non-root processes publish cache artifacts; see **Root and ownership** below.

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
prepares the candidate calculator against the captured copy, before stopping
the writer. Root deployments run this child as the service account, using the
protected snapshot access described below. It warms at most eight members,
full/play/sidebar/peer views, and
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

The original root ownership-transfer scheme is superseded by **Root and ownership**
below. Non-root writers publish nonempty locks atomically. Stale unpublished lock stages are reclaimed;
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
retain their tokens even after a minute. Root publication is now refused as
described below.

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

### Thread termination lock cleanup

Lock metadata now records the PID, thread ID and a random worker-instance ID;
legacy PID-only owners remain readable. The parent assigns the instance ID
before launching each native calculator or collection publisher and registers
its store directories. On the worker's `exit` event, the parent removes only
tokens matching that exited instance, including unpublished stages. Cleanup
unlinks the observed unique token before removing its directory, so a delayed
cleanup cannot delete a replacement writer's lock. It never reclaims a thread
based on age alone. Dead-process reclamation retains the one-minute threshold,
and root access is now refused as described below.

This uses parent-owned cleanup rather than a heartbeat: synchronous hashing and
filesystem calls can block a worker's heartbeat, while `exit` proves that the
thread can no longer write. No acquisition message needs to win a race against
termination. The operational instance ID is excluded from result namespaces so
new calculator instances can restore persisted replies.

Synthetic regressions pause actual thread calculators (direct lane and pooled)
and the separate collection publisher while their lock and temp file are held.
After aging the lock beyond one minute, contenders still skip without pruning
the active file. Terminating the owner allows immediate publication in the same
process; calculator recovery is bounded to five seconds and persisted replies
restore on the next instance. Cleanup tests also cover instance/thread matching,
unpublished stages and replacement tokens. Both existing simultaneous-reclaimer
regressions and the process-termination recovery test remain passing.

Validation on Windows, Node v26.13.0, one test file at a time: `warm-store`
(14), `prepared-collection` (15), `warm-restart-worker` (5) and the focused
`scheduler` tests (43): 77 passed, 0 failed, 0 skipped, about 25 seconds for
the final runs. No server, private data, full suite or live Linux/VPS check was
used. Calculation logic is unchanged.

## Root and ownership

Security-fix START: `7585d4d3e5304ad8355263504ae8454dbf276caa`.
Root cache creation, publication, lock acquisition/cleanup, pruning and reads
are refused before filesystem access, with one warning per module instance.
Existing handles recheck the UID. Results, collection preparation and its
publisher enforce the same boundary, including temporary-file fallback. Root
reads are misses: no service-controlled cache path is safe to traverse as root.
All warm-store ownership-transfer calls were removed; no warm-store `chown`
or `chmod` operations remain, so no descriptor-based ownership repair is needed.

Root online deployment now launches optional prewarm as the service account
before stopping the writer. Identity comes only from trusted configuration:
explicit numeric `serviceUid` and `serviceGid` settings supplied together take
precedence; otherwise `/usr/bin/systemctl show` supplies the service's `User`
and `Group`, resolved through `/usr/bin/getent`. An unset `Group` uses the
account's primary group. The operator's configured `chunk-picker.service` is
queried even with explicit IDs so `DynamicUser` is always refused. Missing,
duplicate, malformed, unresolved or root identities skip this optional work.
The commands have fixed environments, five-second timeouts and bounded output.
No live-directory owner or ancestor is consulted to choose IDs, so replacing
that directory or its ancestors cannot select a different service account.
No live-store contents, warm-store paths or ownership are touched by root in
this preparation.

The captured copy must be root-owned under a protected root-owned parent and
ancestors, with no group/world write access (root-owned sticky ancestors above
the private parent are allowed). The launcher opens its directory and entries
with `O_NOFOLLOW`, checks descriptor ownership/type and refuses hard-linked
files. Only these snapshot descriptors receive `fchown(0, serviceGid)` and
read-only modes: directories 0550, files 0440. The private parent's permissions
stay unchanged. The child receives the opened directory as fd 3 and reads
`/proc/self/fd/3`, bypassing root-only ancestor traversal without exposing the
scratch tree. Protected parents prevent service symlink swaps; descriptor
operations pin the inodes being changed. Nothing is chowned or chmodded under
the persistent data directory. The service identity remains independent of
filesystem ownership, and the child guard continues to refuse root cache access.

Node's numeric `uid` and `gid` spawn options drop privileges before candidate
code executes. On Linux, libuv clears supplementary groups using
`setgroups(0, NULL)` before setting gid/uid, leaving only the primary service
group effective. Because libuv tolerates `EPERM` from that group-clearing call,
a built-in Node `--import` guard checks the resulting uid, primary gid and all
supplementary groups before any candidate module loads. Unexpected identity or
extra groups fail closed, including on capability-restricted systems. The child
uses `runtimeEnvironment(..., { probe: true })`,
with `HOME` set to the service-owned data directory instead of root's home.
This also works with older prewarm scripts; candidates with no script skip it
before any identity lookup or snapshot inspection. Linux children, including
non-root launches, start detached in their own process group; calculator
descendants inherit it. The reduced OS priority remains. The 180-second outer
budget starts when the launcher is entered. It covers the script check, the identity
lookup, snapshot preparation, spawn and the child, so a slow or hung
preparation step returns a miss at the deadline without spawning. Five seconds
are reserved for termination: 175 seconds after entry the
launcher sends `SIGKILL` to the entire group, waits for child closure and group
exit for up to five seconds, and returns a miss by the outer deadline. Killed orphan zombies may await
init reaping, but cannot execute or write. An early parent exit also kills any
remaining group members. Child failure, identity/permission refusal and timeout
are optional misses; cleanup finishes
before the writer stops, so prewarm never extends the writer pause. Non-root
operators retain their original identity, environment, input path and stdio.

Direct root calculator entry points and runtime persistence still refuse root.
Non-root locking, unique tokens, parent cleanup after thread exit and dead-writer
reclamation are unchanged. Checkpoint, recovery and rehearsal exclusions remain
intact. Gameplay logic is unchanged. Synthetic regressions cover service spawn
identity, inherited snapshot reads, refusal paths, timeout/failure deployment
continuation, unchanged non-root inputs and absence of live-store permission
mutations. A real Linux regression starts a child and a grandchild that ignores
`SIGTERM`, then verifies both have terminated within the bounded timeout.
UID/ownership changes are emulated; no real root deployment is tested.

The Linux CI descriptor-read failure was in that test's privilege emulation:
it removed spawn's `uid`/`gid` options, so libuv never cleared the Ubuntu
runner's supplementary groups. The unchanged production import guard rejected
those groups and exited before candidate imports or snapshot reads. The positive
real-child fixture now emulates group clearing as well as uid/gid changes;
the negative fixture still proves unexpected groups prevent candidate imports.
Descriptor ownership emulation also masks write bits consistently with lstat,
so a permissive fixture umask cannot cause an unrelated snapshot refusal.

For an installation already at the task base, replace these installed operator
tool files (the release tree alone does not update them):

- `/opt/chunk-picker/tools/scripts/linux/operator.mjs`
- `/opt/chunk-picker/tools/scripts/linux/prewarm.mjs`

The local imports (`scripts/linux/files.mjs`, `scripts/linux/runtime.mjs` and
`app/tasks/warm-store.mjs`, with their existing imports) already exist at the
base and are unchanged by this fix. No additional installed tool files or
systemd unit changes are needed. The selected candidate still supplies its own
`scripts/linux/prewarm.mjs` and calculator imports.

Historical synthetic launcher microprobe on Node v24.21.0: five fresh parent
processes per revision, START `c98ddd775fc4bc3be5d977de1db4b376519e6bbc` versus
the original service-UID launcher, before this trusted-identity/timeout follow-up.
Root ownership and permission changes were emulated; the child used the current
non-root uid/gid through real spawn options and read one synthetic file through
the inherited descriptor. It performed no calculator work. Times are medians
[min–max]; RSS is the maximum observed across the five trials.

| Launcher measurement | START | After |
| --- | ---: | ---: |
| Successful child runs | 0/5 (root skip) | 5/5 |
| Duration, ms | 0.087 [0.086–0.124] | 38.15 [31.40–61.80] |
| Parent peak RSS, KiB | 34,688 | 35,024 |
| Child peak RSS, KiB | No child | 29,124 |

These measure launching and descriptor access only, not calculator cold-start
savings or real service privilege changes. No private data or live server was
used. The targeted six-file test run passed 84 tests, failed 0 and skipped the
existing Windows-only test on Linux. `npm run test:quick` ran once: 3,572 passed,
0 failed, 68 skipped across 353 files, in 354.15 seconds. No full suite was run.

Local follow-up validation on Windows, Node v26.13.0: only `warm-candidate`,
`linux-operator`, `online-snapshot`, `warm-store` and the new, full-only
`prewarm-process-tree` test file were run, with test concurrency 1. Of 98 tests,
71 passed and 27 Linux cases skipped; none failed (75.82 seconds). Neither npm
suite was run. After the final cleanup and fixture edits, `warm-candidate`
was rerun: 19 passed, 18 Linux skips, 0 failed (0.72 seconds), including the
new spawn-error regression. The five files now cover 99 distinct cases:
72 passed, 27 Linux skips. The real process-tree regression, descriptor reads and UID/GID
drop checks require Linux CI; no real service-identity drop or Linux execution
was performed on this Windows machine. All inputs were synthetic.

Current regression names (parameter suffixes shown in braces):

- `root prewarm uses only the service uid/gid and a read-only snapshot descriptor: configured={false,true}`
- `trusted systemd identity resolves the primary group when Group is unset`
- `explicit service settings win over systemd account names without NSS lookups`
- `trusted service identity refuses {missing,ambiguous unit,ambiguous account,root uid,root gid,DynamicUser,partial settings,invalid number,lookup failure}`
- `data-directory {symlink,owner} swap cannot choose the prewarm identity`
- `root prewarm skips an ambiguous identity or unsafe copy: {root uid,root gid,missing identity,ambiguous identity,DynamicUser,partial settings,unprotected snapshot}`
- `inherited snapshot descriptor reads copied state and static inputs in a real child`
- `root prewarm reserves termination time inside the 180 second budget`
- `root prewarm counts a slow identity lookup inside the same 180 second budget`
- `root prewarm abandons a hung identity lookup at the budget without spawning`
- `prewarm waits for exit after SIGKILL but never exceeds the outer budget`
- `prewarm spawn errors with no PID return a miss without signalling`
- `prewarm timeout kills a real child and SIGTERM-ignoring grandchild within the whole-tree budget`
- `non-root launcher leaves identity, HOME, input path and stdio unchanged`
- `root spawn guard refuses unexpected {uid,supplementary groups} before candidate imports`
- `root prewarm refuses unsafe snapshot entries without permission changes to live paths: {symlink,hard link,live-store overlap}`
- `root launcher skips older candidates without a prewarm script before inspecting the store`
- `root online deploy proceeds after optional prewarm miss: {missing identity,ambiguous identity,root uid,root gid,DynamicUser,failed child,timed-out child,spawn error}`

The requested branch diff and all Linux mutation calls were audited. Remaining
path-based ownership/permission calls already exist on fetched main
(`c69240de830b73d42b8a4a8133fa4654a0a10e1c`): `online.mjs`
(snapshot ownership), `operator.mjs` and `service-operator.mjs` (stopped ownership
repair), `service-recovery.mjs` (reconciliation ownership), and `recovery.mjs`
(restore permissions). They are not repaired in this change, as requested;
those older operations warrant a separate descriptor-anchoring audit, including
ownership-repair inventories that can encounter an existing cache. Existing
rename/removal calls in `files.mjs`, checkpoint/recovery, rehearsal, service
locks and start checks also predate this branch. No new root warm-store
mutation remains in this branch's added paths.

Synthetic microprobe: five fresh Node v24.21.0 processes per revision, 100
512-byte non-root put/get pairs each, then emulated root creation, publication,
reads and cleanup. Chown was intercepted, never performed. Medians [min–max]:

| Measurement | Security-fix START | Fixed |
| --- | ---: | ---: |
| Root filesystem calls | 64 [64–64] | 0 [0–0] |
| Root chown calls | 5 [5–5] | 0 [0–0] |
| Root probe, ms | 1.455 [1.415–1.649] | 0.178 [0.138–1.396] |
| Non-root roundtrip, ms | 0.356 [0.321–0.416] | 0.218 [0.159–0.340] |
| Process peak RSS, MiB | 39.50 [39.23–39.75] | 38.34 [37.71–38.71] |

These small synthetic timings do not establish production calculator speed.
No private inputs, real root process or live VPS deployment was used for this fix.

Requested-file validation accounts for 339 passing cases and 10 existing
platform skips after focused reruns. The initial runs had two failures in the
new publisher spy (it blocked Node's public source loader); the corrected cache
files passed 37/37. Four additional cases failed under an incorrect F2P override;
all four passed with their declared default dataset, and the F2P failures were
also reproduced on untouched security-fix START. No skips were added.

`npm run test:quick`, once: 3459 passed, 0 failed, 68 existing skips;
695.18 seconds. No full `npm test` was run.

Written by Codex.
