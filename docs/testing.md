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
do not launch a browser. `npm test` selects every top-level `tests/*.test.mjs`
file, including server, worker and large-data integration tests. Neither command
is a substitute for trying the application in a real browser.

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

## Adding tests

`scripts/test-selection.mjs` is the classification source. Add a cheap test's
filename to `quickTests` after inspecting its imports and fixtures. Keep browser,
performance, golden/reference comparison, large-data and server/worker tests
full-only. Integration families have named patterns; the remaining full-only
files are listed explicitly. A new file outside those patterns fails either
command until it is classified, so additions cannot silently miss quick feedback.
Quick entries take precedence over patterns, allowing a reviewed fake DOM or
small-fixture test from an integration family to participate.

The selection tests check required quick coverage, full-suite preservation and
failure on unknown filenames. Remove or rename the corresponding classification
when deleting or renaming a test, including any `soloTests` or `openF2PTests`
policy entry. Keep fixtures and helper modules free of the `.test.mjs` suffix
unless they are independently runnable tests.

Inspect storage defaults before running a test that writes files. Use isolated
synthetic saves and temporary directories; never point tests at a personal save.
Both suite commands check test sources for hard-coded ports in the 8000–9999
range during discovery, including full-only files during a quick run. Use
`port: 0` and read the bound address. The check covers literal options, listen
calls and simple constant bindings. The two explicitly reviewed front-door
fixtures in `scripts/test-selection.mjs` are exceptions because their lane
validation requires ports in 8900–8999.
