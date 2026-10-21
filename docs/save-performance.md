# Save command performance

Measured on Windows with Node 24.19, comparing commit `80aaf88` with this fix. Each run started the CLI on a fresh, isolated copy of the same real save, used a loopback ephemeral port, and sent authenticated commands with the current revision and matching Origin. Gzip was enabled. Map assets were read from the existing cache. No live server or save was modified.

The save was approximately 25.9 MB, with about 24,000 catalogue rows and 91,000 aliases. Its active history contained only eight events, so history compaction did not cause this regression.

## End-to-end results

Times include receipt of the complete HTTP response body; JSON parsing is shown separately. Commands ran in order after initial state/definitions loading. The chunk started locked and was selected, then cleared with status `locked`.

| Command | Before response | After response | Before JSON parse | After JSON parse |
| --- | ---: | ---: | ---: | ---: |
| Set preference | 12,973 ms | 109 ms | 321 ms | 3 ms |
| Select chunk | 9,239 ms | 103 ms | 246 ms | 2 ms |
| Clear chunk | 8,758 ms | 96 ms | 268 ms | 1 ms |

Earlier reproduction under concurrent machine load took approximately 18–26 seconds for a preference command, consistent with the reported regression. The final paired runs above used the same measurement method. These are local observations, not hardware-independent latency guarantees.

The requested theme value `gray` is invalid at `80aaf88`; the successful preference benchmark used the supported grayscale theme `mono`.

Fresh-copy startup fell from 12,690 ms to 6,756 ms, including first-time creation of static sidecars. Already-current migration is checked once instead of repeatedly cloning, validating, and projecting the complete save. The static fingerprint is prepared before readiness.

## Request-stage profile

In-memory instrumentation wrapped the original and changed functions without adding profiling code to production. The preference request gives the clearest comparison. Nested measurements overlap and must not be summed.

| Stage | Before | After |
| --- | ---: | ---: |
| Command application, including validation and undo delta | 5,002 ms | 19 ms |
| Validation copies, nested across the request | 1,700 ms / 15 calls | 4 ms for changed gameplay |
| JSON cloning, nested across the request | 3,681 ms / 21 calls | 3 ms for mutable fields/new event |
| Migration/preparation | 1,822 ms | <1 ms |
| Undo delta calculation, nested in application | 73 ms | 2 ms |
| History compaction | <1 ms, below threshold | <1 ms, below threshold |
| Previous-state backup, including gzip and synchronized write | 1,058 ms | 9 ms |
| Atomic current-state write | 1,746 ms | 14 ms |
| Full current-state serialization | 311 ms | Skipped; compact document only |
| Full-state return/subscriber copies | 1,331 ms | Skipped |
| Gameplay fingerprint, nested in subscriber | 483 ms | <1 ms |
| Revision broadcast and task-worker supersession | 1,230 ms | <1 ms |
| Roll pools / command response snapshot | 27 ms | 27 ms |
| Response serialization/compression | 830 ms | 6 ms |
| Total instrumented server command | 12,632 ms | 77 ms |

Alias migration was repeatedly checked in the old preparation stage. Ordinary preference/chunk commands now reuse an already migrated, fully validated baseline; task ID resolution and new registrations still validate their identities. Task-worker supersession is measured above; task re-evaluation runs separately and is not awaited by the save response. Periodic backup packing was not due in these three requests and now uses a separate maintenance queue.

Compaction also preserves the validated static trees instead of revalidating the entire save. A separate synthetic run with a 6 MiB provenance field measured a compaction-triggering store command at 112 ms: history archival 13 ms, prior backup 11 ms, changed provenance serialization/hash/compression/write 74 ms, and current atomic write 14 ms. This measurement excludes response transfer and parsing. Full history export and undo across that archive are covered by the storage regression test.

## Why the fix stays durable

The old request repeatedly traversed and copied the entire catalogue, alias registry, and exact migration archives, then rewrote and backed up a roughly 25 MB snapshot. Those costs applied even when changing one preference.

Storage now owns a validated baseline, copies mutable gameplay fields, and shares unchanged immutable trees. Public imports, hooks, and undo retain full validation. New undo events are isolated from editable gameplay; large catalogue undo restoration uses one index rather than repeated catalogue scans. Static fingerprints and field JSON are cached by private immutable object identity.

Large static fields use synchronized, hash-checked, content-addressed sidecars. Before acknowledging a command, storage synchronizes the preceding snapshot backup and atomically replaces the current compact snapshot. Referenced sidecars are written first and retained. Downloads and retained-backup reads hydrate a full portable state; missing or corrupt dependencies fail closed. Packing retains the existing checkpoints/pinned snapshots and drains on graceful shutdown.

Command responses omit only unchanged large fields, anchored to `baseRevision`. The browser merges the exact submitted snapshot and falls back to a full GET if it cannot. Conflicts and GETs return full state. The browser waits for its command queue before handling revision notifications, preventing its own save notification from starting a redundant full-state download.

## Regression coverage

`tests/command-performance.test.mjs` creates an approximately 25.6 MiB state with 24,000 tasks, 90,000 aliases, thousands of statuses per player, and 1,200 history events. It measures complete preference/select/clear responses with a generous 5-second threshold for shared CI machines, and independently asserts that ordinary commands perform zero whole-state JSON copies. The focused run measured 232/181/180 ms.

The same test checks exact retained-field reconstruction, immutable undo guards, backup contents, sidecar hashes, revision-conflict durability, and restart recovery. Focused storage/state tests also exercise atomic-write failures, retention packing, alias registration, undo, migration hooks, and corrupt or missing sidecars.

Full validation: `npm test` passed all 792 tests, with zero failures, cancellations, or skips (144.7 seconds). Under that parallel suite load, the synthetic preference/select/clear commands took 1,781/771/1,009 ms, below the generous regression threshold, with zero whole-state JSON copies. The private reproduction copies and logs were deleted after profiling.
