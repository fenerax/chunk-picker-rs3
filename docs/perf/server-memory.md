# Server memory at a large dataset

The live game uses a private pack of about 130 MB of JSON. These tools build a
public stand-in of the same size and measure the server, its task workers and
unlock times on synthetic saves.

## Tools

- `scripts/perf/scale-server.mjs <dir> [--mib 130 | --copies N]` writes a
  runnable copy of `app/` (plus `scripts/lib/`) whose `open-f2p` dataset is the
  public batch tiled into N synthetic copies. Each copy gets new cell keys,
  coordinates, identities and names; copies are joined at the starting cell.
  The output is deterministic. No game-cache or original-picker data is used;
  copied rows keep their RuneScape Wiki provenance (CC BY-NC-SA 3.0). 122
  copies are about 130 MiB. Tests use `writeScaledApp(tempDir, { copies })`.
- `scripts/perf/server-memory.mjs` starts the server from that copy on port 0
  with temporary storage, then samples `process.memoryUsage()` for the main
  process and every task worker (worker heap, the worker process's rss and its
  relay host) at startup, idle, after 10 chunk unlocks, after a task
  recalculation and once the workers sleep. Unlocks alternate between chunks
  whose Preview was prepared in the background and chunks that were not.
  Run it with the probe preload:

  ```
  node --expose-gc --import ./scripts/perf/worker-memory-probe.mjs \
    scripts/perf/server-memory.mjs --app-dir <dir>/app --mode process --out report.json
  ```

  `--snapshots <dir>` also writes heap snapshots; `scripts/perf/heap-summary.mjs`
  summarizes one by type and size without printing values.

`--mode process` matches Windows, where every calculator lane is its own
process. Samples follow a forced collection, so they compare retained memory.
The trial drives the server from its own process, so main figures include the
small trial client.

## What was held more than once

Heap snapshots at 30 copies (about 32 MiB) showed, by retained size:

| Owner | Before | Notes |
| --- | --- | --- |
| Main: two dataset providers | 70.8 + 70.0 MiB of 242 MiB | `dataset-runtime.mjs` keeps its import-time provider alive through its top-level `await`; `createServer` then resolved and kept a second equal one |
| Main: definition bytes | 6.3 MiB twice | One Buffer for HTTP, one SharedArrayBuffer copy for workers |
| Process worker host | 29–69 MiB of buffers | The host relays every saved state and result but almost never collects garbage |
| Each worker process | definition bytes kept for life | `workerData` held the transfer copy after parsing |
| Each worker: parsed save states | up to 4 | Each carries the whole identity registry; only the newest two are used |

## Changes

- `createServer` keeps the import-time provider when a second resolution is
  equivalent (same digest and same worker selection): `reuseEquivalentDataset`
  in `app/startup.mjs`.
- Main holds definition bytes once, as a Buffer view over the SharedArrayBuffer
  that native workers receive (`app/tasks/shared-bytes.mjs`).
- Workers drop their definition input after parsing (`app/tasks/worker.mjs`).
- Process hosts start with `--expose-gc` and run one major collection 500 ms
  after relaying at least 1 MiB (`app/tasks/relay-collector.mjs`). The pause
  is on the relay thread only, never the calculator.
- IPC sends shared bytes as views; serialization copies them once
  (`app/tasks/process-worker-transport.mjs`).
- The scheduler and workers keep two parsed save states instead of four, in
  lockstep (`STATE_SNAPSHOT_LIMIT`, `app/tasks/state-transfer.mjs`).

`app/idle-memory.mjs` is unchanged and still runs after all lanes sleep.

## Results

Linux, Node 24, process workers (as on Windows), synthetic two-player save.
MiB; "→" is before → after. Each worker cell is rss / heap / external.

**130 MiB dataset (122 copies)**

| Phase | Main rss | Main heap | Main external | Workers | Total rss |
| --- | --- | --- | --- | --- | --- |
| Startup | 1289 → 974 (−24%) | 541 → 375 | 385 → 175 | 1062/450/196 → 988/450/196 | 2351 → 1962 (−17%) |
| Idle | 1297 → 983 (−24%) | 584 → 418 | 279 → 131 | 1059/450/190 → 985/450/190 | 2356 → 1968 (−16%) |
| After 10 unlocks | 1700 → 1435 (−16%) | 581 → 415 | 329 → 154 | 1769/716/263 + 1591/638/261 → 1307/555/261 + 1631/630/263 | 5059 → 4373 (−14%) |
| After recalculation | 1770 → 1427 (−19%) | 623 → 457 | 365 → 360 | 1902/634/262 + 1623/635/262 → 1658/549/262 + 1259/546/262 | 5294 → 4344 (−18%) |
| Workers asleep | 1228 → 977 (−20%) | 550 → 384 | 290 → 142 | – | 1228 → 977 (−20%) |

The main heap falls by 30% and its external memory by about half in every
phase. Linux rss moves less and varies between runs: glibc keeps freed medium
buffers in its heap. An earlier pair measured 1262 → 865 MiB (−31%) with workers
asleep. With glibc's mmap threshold pinned (`MALLOC_MMAP_THRESHOLD_=131072`,
closer to how Windows returns large blocks) it was 1081 → 810 MiB (−25%).
Worker processes also lose their relay garbage (host buffers 32–132 → 0.2 MiB).

Unlocks (median of five each; the prepared time is the save itself):

| | Before | After |
| --- | --- | --- |
| Prepared chunk | 3165 ms | 2800 ms |
| Unprepared chunk | 5985 ms | 5469 ms |
| Recalculation, both players | 24.0 s | 21.2 s |
| Startup to first task list | 14.1 s | 13.7 s |

**Public open-f2p dataset**: main rss 125 → 124 MiB at startup and 121 → 116 MiB
with workers asleep; unlock medians 34 → 30 ms prepared and 57 → 56 ms otherwise.

The trial keeps worker lanes awake for 120 s (`RS3_WORKER_IDLE_MS`). A lane's
sleep clears its prepared unlock results; with 20 s some full-scale Previews were
discarded before use, which looked like slow prepared unlocks in both versions.

## Not changed here

The dataset load path belongs to separate work. The largest remaining items are
there:

- Every isolate (main and each worker) resolves its own provider. The open-f2p
  provider keeps its parsed batch and a serialized Buffer of every catalogue,
  about 70 MiB at 30 copies and about half of each process's heap at 130 MiB.
  Lazy bytes and parsing, or sharing verified bytes with workers, would cut
  this in every process.
- `dataset-runtime.mjs` retains its import-time provider forever, and
  `createServer` still resolves (then discards) a second one, which costs
  startup time and a transient peak.
- A launcher that passes its own resolved `dataset` to `createServer` skips
  this reuse and keeps two providers; it should pass `selectedDataset` or let
  `createServer` resolve.
- For packed data, each worker launch re-reads and JSON-validates every pack
  input although the main process already verified their digests.
