# Eligibility cache compression and worker retirement

The fix is based on profiler commit `c9036ea543872e7cc808bfc4cdf27ad0a77f551c`.
Initial checkout START: `5c984be5add5c28e5e0887f9e365c34841aa7b7c`.
All checks use Node v24.21.0. No private state or packs are used.

## Cause and containment

In Node v24.21.0, [`lib/zlib.js:939–953`](https://github.com/nodejs/node/blob/v24.21.0/lib/zlib.js#L939)
creates a native `ZstdCompress` handle, reads `pledgedSrcSize`, allocates the
write-state array, and then calls `handle.init()`. Worker termination can stop
JavaScript in that gap. Environment cleanup destroys the handle, and
[`CompressionStream::Close()`](https://github.com/nodejs/node/blob/v24.21.0/src/node_zlib.cc#L469)
asserts `init_done_` at line 477. This aborts the containing process; JavaScript
`catch` cannot contain it. Native zstd context initialization failures are a
different path: `ZstdStream::Init()` calls `InitStream()` (setting `init_done_`)
before attempting context initialization or setting compression parameters.
No resource limit is needed to reproduce the pre-init termination abort.

`compactResult()` is reachable both from deferred idle compaction and during
small/oversized proof admission. A reply is therefore not a safe boundary for
retirement. Eligibility compression now returns the raw buffer in every worker
thread, and workers do not schedule idle compaction callbacks. Process-mode
calculators also execute inside a worker thread, so the same guard applies.
Main-thread direct callers retain the existing compression behavior.

Raw buffers continue through the same admission, full-backing-store accounting,
LRU eviction and private deserialization paths. Proofs that no longer fit are
returned normally without retention. Tasks and result projections are unchanged.
This trades compression savings for earlier eviction under memory pressure.

Moving compression before the reply or into an awaited idle job would still
leave forced cancellation, shutdown and watchdog termination able to hit the
gap. A scheduler-only handshake would also miss direct worker users such as
the differential bridge. A codec substitution is not justified: Node's zlib and
Brotli constructors also construct a native handle separately from `init()`.
This change removes eligibility zstd construction rather than asserting that a
different native codec is safe. The follow-up below removes the other native
compression paths reachable from calculator workers.

## Deterministic regression

The three added cases in `tests/engine-cache-eligibility.test.mjs` exercise idle,
small and oversized admissions in disposable subprocesses. A test-only options
getter pauses the real zstd constructor precisely after native handle creation
and before initialization. The parent then calls `Worker.terminate()`.
Unmodified main fails all three cases with the exact native assertion. Fixed
workers never enter that constructor; the tests check raw byte accounting,
round-trip results, oversized bypass and eviction, then retire the worker.
The getter widens a real termination window; it is not a production input.

## Measurements and validation

Pending the five baseline and five fixed smoke repetitions. Raw public evidence
is kept outside the checkout in `/tmp/rs3-zstd-evidence`.

The reusable synthetic capacity experiment is:

```sh
node scripts/perf/eligibility-worker-retention.mjs PUBLIC_ROOT OUTPUT_JSON 5
```

It uses fresh processes, 32 distinct proofs with repetitive 120,000-byte
payloads, and 8 MiB / 512 KiB eligibility budgets. It reports cold/warm duration,
retained backing bytes, entry/hit counts and process peak RSS. This is an
explicit compression-sensitive capacity example, not a prediction of real-save
hit rates. Each sample waits for idle work and natural worker exit; baseline
compression is not interrupted. RSS includes the process and its worker.

## Prediction and packed-dataset follow-up

The follow-up starts at `19f9d5425b962ca0a0c53a8905eb81ca147d073a`.
Validation uses Windows and Node v24.22.1. All new fixtures are synthetic;
player labels are `Player 1` and `Player 2`.

`app/tasks/worker.mjs` formerly called `gzipSync()` three times for each
prediction owner and partner. It now sends the same raw shared JSON projections
without compressed copies. `createUnlockResultCache()` already has a raw-input
admission path in `app/tasks/unlock-reuse.mjs`, called by the main-thread
scheduler for owner progress, completed pairs and saved-prediction races. That
path now performs the compression. Stale messages discarded by the scheduler
no longer incur worker gzip work.

The encoding is unchanged: remove the last object brace, compute `crc32` and
`rawLength` for that prefix, and gzip at level 1 with `Z_SYNC_FLUSH`. Cache
admission retains those bytes and releases the raw shared projections. HTTP
suffix composition still appends raw deflate bytes and the combined CRC/length
trailer. Tests compare every compressed byte and metadata field against the old
encoding, restore the exact JSON, and exercise suffix composition, completed
pairs, owner-first progress and saved-unlock races. The internal worker message
omits optional gzip fields; HTTP output and calculator protocol parts keep their
formats. The differential bridge consumes raw reuse parts already.

`app/datasets.mjs` formerly gunzipped each packed `.json.gz` input again during
worker startup. A main-thread `resolveDataset()` still hashes every input,
gunzips with the existing 128 MiB output limit, and checks the entire JSON syntax
before returning its provider. Only successful resolution can return
`workerSelection()`. For packed providers that descriptor now includes
`validatedGzipInputs`, with the path, compressed length and SHA-256 of each
checked gzip input. `app/server.mjs` supplies `dataset.workerSelection()` and
`dataset.digest` to its scheduler; the calculator bundle exporter and
differential corpus builder use the same provider method.

Workers still read and hash every input against the pinned manifest, check its
size and file stability, and validate the computed dataset digest. They skip
gunzip only when the input's path, length and hash match an inherited receipt.
Missing receipts or a missing dataset digest fail closed with
`DATASET_PACK_INVALID`, without creating a native decoder. Changed bytes fail
the existing hash check even if a receipt is retained. A main-thread caller
cannot use supplied receipts to skip syntax validation. These descriptors are
trusted parent-to-worker configuration, not an authentication mechanism for
untrusted callers. Custom packed-worker callers must first resolve their
provider on the main thread and forward its selection. A worker can forward
the checked descriptor to a nested calculator thread without decoding again.

Both changes apply to a native thread and to the thread inside
`ProcessWorker`. Killing a process host remains available, but normal host
shutdown calls `Worker.terminate()` and therefore needs the same protection.

### Remaining codec audit

The `app/` search covers zlib imports and gzip/gunzip, deflate/inflate,
Brotli and zstd construction. Calculator worker paths reach:

- `eligibility-cache.mjs`: the existing `isMainThread` guard prevents zstd
  compression and idle jobs in workers. Its private compressed-buffer set is
  empty in worker isolates, so decoding raw worker proofs creates no decoder.
- `unlock-reuse.mjs`: workers call only `createTaskReuseFingerprint()`. The
  result-cache factory, admission gzip and lazy gunzip are called by the
  main-thread scheduler. Importing zlib itself creates no compression handle.
- `datasets.mjs`: packed gzip inputs use the receipt checks above.

`core/chunk-sections.mjs` is imported by `server.mjs` and
`picker-context.mjs`, neither of which is imported by the calculator workers.
The web chunk-section module is a separate browser module. The only application
caller of `training/banking-routes.mjs` is `picker-context.mjs`, so its
`inflateRawSync()` also stays on the main thread. HTTP representations,
picker-context suffix compression, task-why decoding, backup transfer and
storage/history codecs are server-side paths outside the worker import graph.
There are no further Brotli or zstd construction sites in `app/`.
An import walk across the task worker, bundle adapter and differential host
resolved 159 modules and confirmed those exclusions. The differential host
also imports `calculator/reference/codec.mjs` for plain JSON parsing; it never
calls that module's `unpackParts()` gzip decoder.

### Deterministic reproduction

`tests/worker-native-zlib.test.mjs` runs six disposable subprocesses: owner,
partner and packed startup, each with the actual thread and process adapters.
A preload wraps the real gzip/gunzip function, passing an options getter for
`rejectGarbageAfterEnd`. Node reads it while evaluating `handle.init()` arguments
after constructing `binding.Zlib`. The getter posts a boundary message and
blocks; the parent terminates the worker. The partner case permits the owner's
first three gzip calls before pausing the partner's first call. Process-host
stderr is exposed only by the harness to retain native assertion evidence.

Before changing production code, all six cases emitted:

```text
Terminating at real native pre-init boundary: owner|partner|dataset
# Assertion failed: init_done_ && "close before init"
tests 6
pass 0
fail 6
duration_ms 10372.6181
```

Thread subprocesses exited 134. Process-mode hosts exited 134, which the outer
test subprocess reported as failure (exit 1). After the fix all six pass; the
getter is never entered. Fixed prediction tests also check exact main-thread
gzip bytes, CRC/length and JSON restoration, then terminate the worker.
Fixed dataset tests reach ready using the main-validated synthetic pack.
The final harness also rejects all other zlib/Brotli/zstd constructors and
functions in workers. Its six fixed cases took 9.71 seconds total,
0.64–3.19 seconds each. Each subprocess has a 15-second timeout.

### Main-thread admission cost

Run the small benchmark sequentially at low priority on a shared PC:

```sh
node scripts/perf/prediction-gzip-main.mjs 40
```

It measures the existing cache's actual raw admission path: owner progress
(three gzip calls), then the final owner/partner pair (six gzip calls). It uses
deterministic varied synthetic task JSON, five warmups and 40 measured samples
at each size. Sidebar projections contain half the task rows. This includes
recompressing the owner when the final pair replaces the progress entry, and
includes CRC computation and cache staging/accounting. It measures synchronous
main-thread blocking, not end-to-end prediction latency or real-save sizes.

Measured at below-normal process priority on this shared Windows PC:

| Play bytes per owner | Sidebar bytes per owner | Owner progress p95 (ms) | Final pair p50 / p95 / max (ms) | Progress + pair p95 (ms) |
| ---: | ---: | ---: | ---: | ---: |
| 16,543 | 8,304 | 0.388 | 0.584 / 0.898 / 1.435 | 1.383 |
| 131,112 | 65,704 | 1.144 | 1.611 / 2.380 / 2.976 | 3.338 |
| 1,048,567 | 524,286 | 8.012 | 12.552 / 15.198 / 15.787 | 22.314 |

Large projections therefore add measurable event-loop blocking. Owner progress
and final-pair admission happen in separate message callbacks; the last column
adds their measured synchronous costs. This bounded synthetic experiment does
not establish production latency percentiles. Asynchronous main-thread gzip
could reduce blocking later, but requires keeping admission ordering and saved
prediction races intact; it is not needed to remove native worker construction.

### Targeted validation

All runs used `node --test`, one test file process at a time
(`--test-concurrency=1` for multi-file commands), at below-normal priority.
The full suite and private tests were not run.

- `dataset-packs.test.mjs` and `unlock-reuse.test.mjs`: 57 passed.
- `engine-cache-eligibility.test.mjs`, `calc-check.test.mjs`,
  `datasets.test.mjs`, `dataset-bootstrap.test.mjs`, `dataset-profile.test.mjs`,
  `dataset-startup.test.mjs`, `test-selection.test.mjs`,
  `test-selection-contract.test.mjs`, `test-run-policy.test.mjs`: 83 passed.
- With `RS3_DATASET=open-f2p`: `prediction-output.test.mjs`,
  `prediction-cache.test.mjs`, `prediction-server.test.mjs`,
  `unlock-reuse.test.mjs`, `process-worker.test.mjs`,
  `process-worker-transport.test.mjs`, `calculator-bundle-worker.test.mjs`,
  `engine-cache-worker.test.mjs`, `worker-timings.test.mjs`,
  `scheduler.test.mjs`, `scheduling-server.test.mjs`,
  `warmstart-scheduler.test.mjs`, `worker-watchdog.test.mjs`: 198 passed.
- `worker-native-zlib.test.mjs`: 6 passed after fixing production code;
  the same final harness produced six native abort assertions against the
  original production files at `19f9d54`, then those files were restored.

Raw output and benchmark JSON are retained in the implementation worktree's
ignored `.local/zlib-evidence/` directory (`before.txt`, `after.txt`,
`changed-tests.txt`, `core-tests.txt`, `worker-tests.txt`, `benchmark.json`).
