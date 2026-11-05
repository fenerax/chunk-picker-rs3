# Testing

From the checkout root, use Node.js 24.20.0 or a newer 24.x release and npm.
There are no dependencies to install. Tests use public repository inputs and synthetic/temporary stores;
no plugin, running picker, downloaded Wiki cache or personal save is required.
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
node scripts/ci/compare-test-classification.mjs 5136652
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
