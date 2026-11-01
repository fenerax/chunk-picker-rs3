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
different native codec is safe. Other existing native compression paths are
outside the scope of this eligibility fix.

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
