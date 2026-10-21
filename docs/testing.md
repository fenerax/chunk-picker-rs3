# Testing

`npm run test:quick` runs the reviewed small-fixture tests with Node's native test
runner and two concurrent test files. It targets less than about 60 seconds on
the Windows desktop. It covers state and commands, Undo, History wording,
Settings and Chunk Rules, task filters, completion and Helper models, planning,
Sandbox, and cheap map, sticker and task controllers and utilities. Fake DOM
tests do not launch a browser.

Use quick while iterating on the covered logic and controllers. On 2026-10-15,
Node v24.20.0 passed 1,458 tests with one existing optional-cache skip in 100.8
seconds under background load. The 60-second target is not established for the
current private tree; imported private modules still validate their dataset.

`npm test` runs every top-level `tests/*.test.mjs` file in isolated Node processes.
It runs three files at a time through Node's standard test CLI. The October 15
quiet run took 8m21s: 4,197 passes and two existing optional-input skips across
419 files, with a sampled Node peak of 2,709 MiB. Set `RS3_TEST_CONCURRENCY` (1-8)
to change concurrency for one run. The three-file default bounds memory beside
the live picker; see [test-speed.md](test-speed.md). Use it before completing a
broad change. Browser acceptance and performance commands remain separate;
passing quick tests does not establish
full-data calculation, server integration, browser or performance readiness.

Each run normally shares a fresh native Node bytecode cache among its isolated
test processes and removes that owned cache afterward. Node validates cached
bytecode against source; imports initialize and assertions execute normally.
Explicit `NODE_COMPILE_CACHE` and `NODE_DISABLE_COMPILE_CACHE` settings are
respected. Reviewed immutable server fixtures reuse their selected provider;
dataset selection, tampering and startup-failure checks still resolve fresh ones.

To inspect selection without executing tests:

```powershell
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
when deleting or renaming a test. Keep fixtures and helper modules free of the
`.test.mjs` suffix unless they are independently runnable tests.

Inspect storage defaults before running a test that writes files. Use isolated
synthetic saves and temporary directories; never point tests at a personal save.
On this shared Windows workspace, timing, full-suite and browser runs use the
local `.local/with-heavy.ps1` wrapper so expensive checks do not overlap.

Both suite commands reject hard-coded test ports in the 8000–9999 range during
discovery, including full-only files during a quick run. Use `port: 0` and read
the bound address. The check covers literal options, listen calls and simple
constant bindings; no exceptions are currently needed.

For whole-file wall time and rough peak memory, use the shared lock:

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 npm run test:timing -- comparison
```

Reports go to `.local/test-speed/<label>.json`; [test-speed.md](test-speed.md)
records the measured baseline, concurrency choice and before/after ranking.
To measure a focused group instead of the full suite, append explicit
`tests/<file>.test.mjs` paths after the concurrency. The report labels that run
as targeted; it does not establish full-suite speed or memory.
