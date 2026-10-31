# Registry SQLite trial

START: `5fce2f3984a4fdf1ea3ab4fe8935733045e3c478`.
Node v24.21.0; built-in SQLite 3.53.4. Trial only: `registryBackend` defaults
to `json`; no production configuration selects SQLite. The external ledger,
gameplay, service backup format, operator journals and Linux kit stay unchanged.

**Not merged.** Only this record is on the lane. The trial code (the backend
boundary, `app/storage/registry-backend.mjs`, the parametrized tests and
`scripts/perf/registry-trial.mjs`) is kept on branch `sc2/sqlite-trial-code`,
one commit on START, so a later experiment can start from it. File and test
names below refer to that branch.

Follow-up found here, independent of SQLite: with JSON, a missing
`registry.json` beside a surviving deletion ledger starts an empty registry
instead of refusing (see the paragraph that begins "START actually permits").

## Settings and boundary

SQLite settings: WAL, synchronous FULL, busy_timeout 5000 ms,
wal_autocheckpoint 1000 pages (automatic passive checkpoints); normal final
writable-connection close attempts a checkpoint. A reader can defer checkpointing;
the WAL remains authoritative and is never manually removed.
The database and side files live in the owned registry root, with a 0600 main
file. Assume a local filesystem with working fsync and SQLite locking; network
filesystems are not supported. FULL WAL commit flushes before acknowledgement;
initial database creation also flushes the parent directory. SQLite errors poison
the registry until restart, including uncertain post-commit errors.

Both backends provide internal open/readView/commit/close operations. Domain
validation and cap checks run inside the SQLite write transaction, SQL uniqueness
constraints guard indexes, and public synchronous reads retain committed detached
caches. Registry and ledger lifetime locks remain mandatory. The ledger is still
separate JSON and commits before registry cleanup. Existing SQLite files must
validate before any schema/settings changes; missing expected files refuse startup.
No automatic JSON import or fallback is provided. Fresh opt-in roots are opened
with `openRegistry({ ...roots, registryBackend: 'sqlite' })`; omitting the option
continues to select JSON. SQLite uses `application_id = 0x52533352` and
`user_version = 1`, six normalized tables (metadata, accounts, pickers, identities,
memberships, capabilities), stable ordinal columns, foreign keys and unique
indexes. A transaction-held generation comparison rejects an unexpected writer.
Trial roots are disposable and backend selection must remain explicit on every
open; reopening a SQLite root as JSON is unsupported. There is no backend-switch
or restore-import workflow in this scope. This adapter currently replaces all
rows per commit; it does not optimize writes.
Existing databases pass application/schema version, quick_check, foreign-key and
domain validation before changing persistent settings. No migration is attempted.

Recovery export uses a consistent SQL read transaction and the existing sanitized
schemaVersion 1 projection, then releases the transaction before asynchronous
backup work. No database pathname is copied while live. The unchanged Linux kit
is JSON-only; enabling SQLite there requires a separate compatibility project.

## Evidence

The existing registry file is parametrized: 50/50 passed (25 per backend).
The added backend file passed 17/17, including SIGKILL before/after commit and
ledger-before-registry deletion for both backends, injected uncertain failures,
missing-database refusal, SQL uniqueness/cap rollback, and 60 sanitized read cuts
while a separate process continuously committed correlated account/picker rows.
The writer advanced between cuts; every cut retained one epoch across tables.
The first added-file run had 7 passes / 6 failures from test cleanup ordering;
that fixture was fixed, the isolated rerun passed 13/13, and the completed file
(including later checkpoint and async-hook cases) passed 17/17.
Injected SQLITE_FULL errors test uncertain outcome handling; they do not simulate
physical disk exhaustion or host power loss.

Default JSON byte comparison against START: **0 differences across 5 cuts**,
including identity link/unlink and ledger-first picker/account deletion. Registry
and ledger bytes are compared together, with generated IDs and identical inputs.
The existing OAuth crash file passed 12/12 (six per backend), and the existing
deletion crash file passed 30/30 (15 per backend), including every purge stage.
Public checkpoint tests also prove queue exclusion and detached recovery data.
A preliminary quick run exposed a commit-hook compatibility bug: the new hooks
reused the existing async provisioning callback without its context argument.
The stalled file was terminated after diagnosis; that run has no complete suite
summary. Synchronous `commitPoint` instrumentation is now separate, preserving
all existing async `crashPoint` names and context. The affected deletion file
passed 13/13 in isolation; two explicit async-hook regressions are in the 17-case
backend file. No test was skipped or weakened. This instrumentation correction
leaves the measured no-hook workload unchanged.
Final quick suite: **2,826 passes / 0 failures / 67 skips** (2,893 tests,
306 files), 200.979 s. The full suite ran once: **5,974 passes / 0 failures /
139 skips** (6,113 tests, 652 files), 526.202 s. No tests were cancelled and no
TODOs remain in either completed suite. JSON duo gate: **0 response / 0 size / 0 saved-state differences** across
20 paired response reads and both routing settings. SQLite duo gate: **0 response / 0 size / 0 saved-state differences** across
20 paired response reads and both routing settings. The private checkout has
**0 changed files** after both gates.

START actually permits a missing registry.json with a surviving ledger to start
an empty registry. That behavior remains unchanged for JSON. As explicitly
required by this trial, SQLite is stricter: a surviving ledger or JSON image
makes a missing database fatal. Missing ledgers and corrupt documents still
refuse startup for both backends.

## SC1 risks

1. Deletion resurrection: covered for the registry trial by ledger-first SIGKILL,
   stale-checkpoint rollback, ID reservation, immediate capability filtering and
   missing/corrupt ledger tests. The ledger remains outside the database and
   every export. Physical power-loss testing remains open.
2. Incomplete backups: consistent transaction cuts and sanitization demonstrated
   under continuous writes; live pathname copying is never used by the adapter.
   Service restore/import, allowlists, ownership and legacy pending intents still
   require their own integration before production can select SQLite.
3. Journal/filesystem/startup ownership: existing locks and provisioning saga
   retained; Linux direct JSON bypasses and restore import remain outside this trial.

## Three-run measurements

Command (Node 24.21.0):

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
git worktree add --detach /tmp/sc2-start 5fce2f3984a4fdf1ea3ab4fe8935733045e3c478
node scripts/perf/registry-trial.mjs --baseline /tmp/sc2-start --out /tmp/sc2-measurements.json
```

Three fresh child processes per backend and size, alternating JSON/SQLite, one
workload at a time without tests running. Every pair uses the same generated
registry: one identity, one owned ready picker and one owner membership per
account, no capabilities. Synthetic IDs are generated, never account-ID literals.
This measures registry metadata; calculators and gameplay are absent. Filesystem
and module caches are warm from seeding; module import time is excluded. Open includes startup validation/reconciliation and
the existing startup rewrite. After eight warmup commits, 40 measured commits
alternate linking/unlinking a synthetic second provider on one account. Each run
has twenty batches of 1,000 synchronous identity lookups; read timing includes
validation and detached copying. RSS is the child's Linux maxRSS, including
seeding and warmup, without an external memory sampler.

Each cell is the median of three run statistics **[minimum–maximum]**. Within-run
median and p95 statistics use nearest-rank quantiles; the displayed median/range
is across three runs.
Disk size includes the main database plus live WAL/SHM (or registry.json), excludes
the lock, and is logical file length, not allocated block usage. The external
ledger is identical per size: 437 / 37,067 / 370,067 bytes. No tuning followed
these results. This is a whole-registry transaction trial; row-delta writes are
not measured.

| Accounts | Backend | Open ms | Commit median ms | Commit p95 ms | Read median µs | Peak RSS MiB | Live registry MiB |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | json | 10.046 [9.380–10.052] | 0.780 [0.779–0.823] | 1.314 [1.293–1.317] | 3.714 [3.711–3.738] | 45.824 [45.316–46.152] | 0.005 [0.005–0.005] |
| 10 | sqlite | 10.210 [10.133–14.358] | 0.391 [0.379–0.417] | 0.759 [0.733–1.009] | 3.622 [3.535–3.769] | 48.504 [46.945–48.543] | 2.997 [2.997–2.997] |
| 1000 | json | 57.728 [56.454–59.151] | 16.209 [15.730–17.195] | 20.554 [20.551–24.304] | 3.890 [3.839–4.293] | 162.875 [159.270–163.277] | 0.502 [0.502–0.502] |
| 1000 | sqlite | 83.397 [82.493–83.440] | 24.401 [24.238–24.493] | 27.259 [26.165–28.426] | 4.165 [3.927–4.265] | 119.969 [117.969–121.113] | 5.535 [5.535–5.535] |
| 10000 | json | 589.633 [581.596–615.890] | 185.804 [183.172–188.481] | 213.469 [212.307–215.139] | 4.273 [4.018–4.326] | 435.637 [431.391–439.168] | 5.025 [5.025–5.025] |
| 10000 | sqlite | 927.511 [913.194–964.335] | 322.281 [311.989–323.487] | 339.937 [333.493–344.192] | 4.245 [4.197–4.337] | 437.945 [435.816–441.898] | 16.787 [16.787–16.787] |

At 10,000 accounts SQLite median commit latency is 1.73× JSON and open time is
1.57× JSON; read cost and peak RSS are similar, and live registry size is 3.34×.
SQLite wins small-registry commit latency and reduces peak RSS at 1,000 accounts,
but these results do not justify a production migration. Keep JSON as the default.

Recommendation: STOP-HERE for rollout; the optional adapter is a reviewable
MERGE-CANDIDATE trial, with production restore integration, actual disk exhaustion
and host power-loss evidence still open. A later row-delta experiment would need
an explicit performance objective and the same correctness gates.

## Final duo gate

The available multiplayer gate, `scripts/perf/duo-compatibility.mjs`, ran once for
each candidate backend against untouched START, sequentially after the suites.
The engine-lane `tools/calc-check` tree is absent at START. Each gate compares ten
complete response bodies and the rewritten save in each of two routing settings.
START uses JSON; the candidate uses the selected backend when routing is enabled.
The harness copies inputs into temporary roots, supplies the required dataset,
packs, defaults and process-worker settings, freezes response clocks in all
processes, and retains every response field. Its duration uses a real clock.

Across 40 paired response reads and four saved-state comparisons: **0 response,
0 size and 0 saved-state differences**. All eight runs returned 83,606,131 bytes;
each save is 766,384 bytes with the source hash unchanged. Ordered response digest:
`1b4583763d891cc5bbada4fcdcab6b7eff6aebf5f38bfb93d098c08f7e4a60ba`.
Source and rewritten save SHA-256:
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
The private checkout has 0 changed files. No private contents enter this report.

These are single-run checker timings, not performance medians; no spread is
estimated. Peak RSS is a 50 ms process-tree sample and can miss short peaks.

| Candidate backend | Routing enabled (count) | START duration s | Candidate duration s | START peak RSS MiB | Candidate peak RSS MiB | Difference count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| json | 0 | 34.027 | 26.904 | 1230.445 | 1220.773 | 0 |
| json | 1 | 26.283 | 32.443 | 1207.062 | 1116.680 | 0 |
| sqlite | 0 | 34.415 | 27.228 | 1211.980 | 1228.645 | 0 |
| sqlite | 1 | 27.096 | 27.356 | 1222.629 | 1209.008 | 0 |

SC1 risk disposition: deletion ordering and sanitized consistent-cut export pass
within this registry-only trial. Production journal/filesystem/startup integration
remains open, including the seven direct JSON bypasses, schema-versioned import,
backend switching and old pending intent compatibility. Actual disk exhaustion
and host power loss remain untested; injected failures are explicitly identified
above. JSON remains the production default.
