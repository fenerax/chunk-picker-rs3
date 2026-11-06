# Testing

From the checkout root, use Node.js 24.20.0 or a newer 24.x release and npm.
There are no dependencies to install. Tests use public repository inputs and synthetic/temporary stores;
no plugin, running picker, downloaded Wiki cache or personal save is required.
The journal rollback integration tests execute release `06e15939` in a temporary
Git worktree. CI fetches that pinned commit before the Linux suite. For a local
shallow checkout, fetch it with
`git fetch --no-tags --depth=1 origin 06e15939dbf73ecd1a0e7bc9c29088e0281ca11e`
to run those cases; otherwise they report an explicit local skip. The ordinary
frozen-loader fixture regressions still run without Git history.
Node 24.19.0 lacks the native `entryFile` test-event metadata used by the
coverage reporter: its synthetic coverage test fails with `Native coverage
count mismatch`. Upgrade to 24.20.0 or a newer 24.x before running the suites.

```sh
npm run test:quick
npm test
```

`npm run test:quick` selects reviewed small-fixture tests for state, commands,
Undo, History, settings, tasks, planning and browser controllers. Fake DOM tests
do not launch a browser. `npm test` selects top-level `tests/*.test.mjs`
files, including server, worker and large-data integration tests, except the
files classified `differential`. Those detector cases run with
`node scripts/test.mjs differential` in `.github/workflows/differential.yml`.
The coverage gate requires that job's native per-case report as well as the
Linux and Windows reports, so moving a test cannot silently drop its coverage.
Neither ordinary command is a substitute for trying the application in a real browser.

When testing inside a Linux container, run it with an init that reaps orphaned
child processes (for example Docker's `--init` option). The full suite checks
that a calculator exits when its parent disappears. A container without a
reaping init can leave that exited process as a zombie and fail
`tests/process-worker.test.mjs` even though the calculator stopped.

Both use `scripts/test.mjs` and the adaptive native Node test runner. Full starts
with two files and may grow to six; quick starts with two and caps at two by
default. Reviewed heavy files run alone. Every admitted worker reserves 1 GiB
above a **4 GiB free-memory floor**. With less than 5 GiB free, admission waits;
free memory before retrying if a run appears idle. Allow extra memory for test
children and browsers. Timing depends on the machine and selected tests; there
is no current portable 60-second quick guarantee.

`RS3_TEST_CONCURRENCY` accepts 1–6 and sets the cap for either suite. A value
above two can raise quick's cap too. For a lower cap in a POSIX shell:

```sh
RS3_TEST_CONCURRENCY=1 npm test
```

In PowerShell:

```powershell
$env:RS3_TEST_CONCURRENCY = '1'
npm test
Remove-Item Env:RS3_TEST_CONCURRENCY
```

Keep expensive test, browser and performance runs sequential. No ignored
`.local` PowerShell wrapper is needed for these npm commands. Some legacy
measurement scripts require maintainer-only wrappers or Windows tools; they
are not part of setup and there is no `npm run test:timing` script in this
package. To time the ordinary suite, use your shell's timing facility, such as
`time npm test` in a POSIX shell.

Each run normally shares a fresh native Node bytecode cache among its isolated
test processes and removes that owned cache afterward. Node validates cached
bytecode against source; imports initialize and assertions execute normally.
Explicit `NODE_COMPILE_CACHE` and `NODE_DISABLE_COMPILE_CACHE` settings are
respected. Tests needing optional inputs or platform-specific facilities may
report skips, including the real pinned-Wiki-cache rebuild when that cache is
absent. Synthetic offline generator tests still run. A skip is not a failure;
check the final pass/fail/skipped counts and the process exit status.

To inspect selection without executing tests:

```sh
npm run test:quick -- --list
npm test -- --list
```

## File telemetry

CI retains `test-ledger-<SHA>-<run ID>-<attempt>` and
`windows-ledger-<SHA>-<run ID>-<attempt>` artifacts for 35 days. The upload steps
use `always()`. `RS3_TEST_FILE_LEDGER` opts the ordinary runner into this small
append-only JSONL journal; Windows writes `windows-ledger.jsonl` in its work root.
Each newline-terminated record is written synchronously through one open file
descriptor, so killing the test process does not discard earlier receipts.
Uploading still requires a live Actions runner; loss of the VM cannot run an
artifact upload step.

The `rs3-file-ledger-v1` header binds the exact selected file inventory to
`sha` (the tested checkout SHA), `runId`, `runAttempt`, `lane` and `selectedAt`.
Admission/completion records have a repository-relative `file`, `attempt` (1 or
2), and a `value` patch. Materialize one receipt per selected file with:

```sh
node scripts/ci/file-ledger.mjs downloaded/test-ledger.jsonl
```

Each receipt has `file`, `firstAttempt` and nullable `retry`. Both attempts carry
`outcome`, `admittedAt`, `completedAt`, `queueWaitMs`, `processWallMs`, `fileWallMs`,
`bodyMs`, `datasetId`, `datasetDigest`, `datasets`, `solo`, `concurrency` and
`errors`. Queue wait starts when that scheduler invocation starts (retries get
their own wait); concurrency is the active file count at admission. Timing
units are milliseconds. `processWallMs - bodyMs` combines controller startup,
imports, hooks and teardown; it does not measure dataset loading separately.
The first runtime provider resolved by the entrypoint or a descendant supplies
the observed dataset identity and digest. Without a runtime provider, the
configured dataset ID is retained with a null digest and empty `datasets`;
model-only tests need not load a dataset just for telemetry.

The reader initializes every selected file as `not-admitted` and marks an
admitted file `interrupted` until it gets a completion. A missing final summary
or torn last line is supported. Windows retries populate `retry` without
replacing `firstAttempt`; the existing pass/FLAKY/fail policy is unchanged.
`errors` retains only bounded message/name/code/failureType/cause records.
Messages and primitive causes are always redacted. Names and failure types use
fixed public lists; codes use the current platform's Node `os.constants.errno`
names plus `ERR_ASSERTION`, `ERR_BUFFER_TOO_LARGE`, `ERR_INVALID_ARG_TYPE`,
`ERR_MODULE_NOT_FOUND`, `ERR_TEST_CANCELLED`, `ERR_TEST_FAILURE`,
`ERR_WORKER_INIT_FAILED`, `ERR_WORKER_OUT_OF_MEMORY` and `ERR_ZSTD_GENERIC`.
Every other error-field value becomes `[redacted]`, including numeric and boolean
payloads. No environment dump, stdout, stack or assertion payload is retained.

The final summary reports selected files, completed attempts and `overheadMs`:
measured ledger initialization, serialization, redaction and synchronous I/O,
plus native error transport and dataset receipt collection costs. This measures
instrumentation work, not a causal comparison of total job runtimes. Artifact
transfer time is separate. The targeted ledger test also benchmarks 750 files
against a two-second wall budget and kills a synthetic writer to verify partial
recovery. No full suite is needed to run that test.

## Adding tests

Create a top-level `tests/<name>.test.mjs`. It is automatically selected by full,
with shared execution and the lane's default dataset, on Linux CI. No registry
edit or classification approval is required. The coverage gate discovers the
same files and still requires every case to pass somewhere. Keep fixtures and
helpers free of the `.test.mjs` suffix unless they are independently runnable.

For a reviewed exception, put an optional comment on the first line of the test
(after a shebang, if present):

```js
// @test quick solo dataset=open-f2p
```

The suite tokens are `quick`, `full`, `differential`, and `engine-differential`.
Quick also runs in full; the differential suites are excluded from quick/full.
`solo` runs a file first and alone; `shared` is the default. `dataset=open-f2p`
sets the public dataset and removes the same pack, asset, authentication and
profile overrides as before; `dataset=default` inherits the lane environment.
Omitted fields retain defaults or existing compatibility exceptions. Duplicate
or unknown options are errors. Classification reads comments without importing
test modules. Later comments and strings have no effect.

Keep browser, performance, golden/reference comparison, large-data and
server/worker tests full-only unless their fixtures justify quick feedback.
Split `<name>.private.test.mjs` files inherit their counterpart's suite, as
before; dataset and solo settings belong to each entrypoint independently.
Windows CI retains its reviewed slice in `.github/windows-slice/run.mjs`.

`scripts/test-classification.mjs` owns the rules. Seven grouped compatibility
rows in `scripts/test-selection-exceptions.mjs` preserve pre-migration policies
without adding headers to hundreds of files. New tests never need entries
there; use file metadata for exceptions. Renaming or removing a file cannot
leave a missing-registration gate. The public export and private assemblies use
the same classifier; private selector copies are no longer mirrored or overlaid
when core supplies the automatic classifier. Historical pinned releases retain
their old selector support.

The migration comparison is reproducible against the exact pre-change commit:

```sh
node scripts/ci/compare-test-classification.mjs cde6e485
```

It compares suite membership, solo/shared, environment values and removals,
lanes, fixed-port exceptions, concurrency, CI graph and runner commands for
every existing entrypoint, and checks classification stays below one second.

Inspect storage defaults before running a test that writes files. Use isolated
synthetic saves and temporary directories; never point tests at a personal save.
Both suite commands check test sources for hard-coded ports in the 8000–9999
range during discovery, including full-only files during a quick run. Use
`port: 0` and read the bound address. The check covers literal options, listen
calls and simple constant bindings. The two explicitly reviewed front-door
fixtures in `scripts/test-classification.mjs` are exceptions because their lane
validation requires ports in 8900–8999.

## Focused checks and renderer contracts

For a named test file, inspect `testRunPolicy(name)` in `scripts/test-selection.mjs` and apply its complete environment, including cleared inherited pack variables. Many files use `RS3_DATASET=open-f2p`; a bare `node --test` can pass against a different rule catalogue. The suite CLI accepts suites and `--list`, not a file-selection flag. Use the adaptive runner API or a focused invocation with the matching policy when the task limits checks to named files.

Before pushing, fetch `origin/main` and run targeted tests for the changed
behavior, respecting any task-specific test limits. When adding a browser module
or static route, include `tests/server.test.mjs` and
`tests/browser-module-graph.test.mjs`. Targeted local checks still require the
complete CI gate.

On the shared PC, acquire the shared `heavy.lock` directory atomically with an
`owner.txt` before multi-file tests. Keep heavy steps sequential at BelowNormal
priority, pass `--test-concurrency=1`, and release the lock within ten minutes.
Use the complete `testRunPolicy` environment described above for focused checks.

## Linux CI shards

CI runs the complete Linux suite in four deterministic, time-balanced shards.
`npm test -- --shard=1/4 --list` inspects a partition. Each shard computes and
audits the complete partition before execution, rejecting omissions and duplicate
assignments. Timings supply weights, never inventory: every discovered full-suite
file remains assigned exactly once, including files absent from the timing table.
There is no preceding test stage or selective ordering.

A short `inputs` job populates pack, Wiki and frozen-checkout caches once before
fan-out. Shards restore the same keys, retain 15-minute timeouts, and stop on the
first failing file. Matrix fail-fast cancels sibling shards. Each shard retains
its own ledger and native coverage artifact. The coverage job requires successful
input preparation, all shards, Windows and differential jobs; it validates each
report against its exact assignment before applying the existing
every-case-passes-somewhere rule. Cancelled, missing or incomplete shards cannot
make coverage green. The Windows slice is unchanged.

Timings in `scripts/ci/test-timings.json` come from the complete Linux measurements
in public run `42294078968`. Regenerate from one recent complete Linux run with
`node scripts/ci/update-test-timings.mjs <ledger.jsonl> [...]`. The slowest passing
measurement per file supplies its weight and the median supplies new files.
Avoid retaining inflated maxima from older execution environments.

The original unsharded Linux job took about 25 minutes (22m39s in the recorded
baseline). Fresh weights predict about 6m14s execution per shard plus setup.
Actual wall time varies with memory admission and contention; hosted ledgers
validate the estimates. Static test selection is deferred to a separate follow-up
based on runtime traces of files each test actually loads and reads.

Published pack profiles control which data overlays CI sees. Source overlays do
not update already published packs.

When an extracted screen function adds `c.*` fields, update `app/web/screen-context.mjs` and every `screenFunctionSource` VM context that uses it, including `scripts/compare-cache-access.mjs`. Include `tests/cache-comparison.test.mjs` in the authorized focused checks; adjacent web tests alone can miss undeclared VM globals.

Release/practice and post-merge lanes share `scripts/private-companion/retry-policy.mjs`: one fresh isolated retry is enabled by default. Preserve that policy in execution identities and receipts. An initial failure followed by a passing isolated retry is prominently FLAKY, not an unqualified clean first pass.
