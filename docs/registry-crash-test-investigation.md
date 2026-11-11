# Registry provisioning crash-test investigation

The `directory-created` case failed its 30-second deadline at `786d0803`. Replaying it did not turn that failure into a pass. The old run recorded no await phase, so the exact OS operation pending at cancellation cannot be recovered from that log. One subsequent diagnostic run with async-resource logging completed; it did not reproduce the stall. It is diagnostic evidence, not a stability receipt or proof of the historical syscall.

Static comparison proves that the test's whole-workflow deadline and its dependency on child output-pipe closure predate the accounting change. The deadline covers process startup, abrupt exit, filesystem publication, recovery, another sign-in, another restart and cleanup. The rewritten count/index code adds no asynchronous wait. These facts identify harness risks; they do not prove what caused the historical timeout or that its cause predates this branch. No production deadlock was reproduced. The root-cause investigation remains unresolved.

## Comparison with the base

`git rev-parse <revision>:<path>` gives the same blob in `8cf8e7ca` and `786d0803` for each of these files:

| File | Identical blob |
| --- | --- |
| `tests/registry.test.mjs` | `dcbbd00ebefd06932b6b389d109b35e5a89c7a1a` |
| `app/storage/registry-lock.mjs` | `8734b3a715090141d53b123e9366d5ce370eaa88` |
| `app/storage/publication.mjs` | `88d056a7efdc53f5dfa4384644fe6c1e5fed2f6e` |

The `directory-created` seam follows an awaited picker `mkdir` and `lstat`, before the directory syncs and the ready-record write. Both revisions use that exact order. The old test calls `process.exit(86)` at the seam, then waits for the child's `close` event, which also depends on output-pipe closure. It does not record the seam, exit or recovery phase while waiting. Its child starts no descendants.

## Await trace in both revisions

The rows below include the awaited callees, including cleanup. The base and accounting revision have the same asynchronous edges on this path.

| Phase | Awaited operations and possible wait |
| --- | --- |
| Fixture and child | Parent `mkdtemp`; spawn and `once(child, 'close')`. OS filesystem/process/pipe completion has no application deadline. |
| Open roots | For each root, `durableDirectory`: `mkdir`, directory `open`/`sync`/`close` for a finite ancestor walk. Then `realpath` for the three roots. No legacy-directory branch is selected. |
| Acquire two writer guards | `realpath`, named-pipe/abstract-socket `listen`, lock-record `readFile`; for a dead recorded PID, `unlink`. Publish ownership using the JSON write sequence below, then `link`, parent sync, temporary `unlink`. A live guard refuses immediately with `REGISTRY_LOCKED`; it does not queue a lease waiter. |
| Load and reconcile | Registry and ledger `readFile` each await open/read/close. Validation, reconciliation, caps and index construction are synchronous. Relink-retirement recovery returns immediately for this fixture. |
| Publish JSON | `open` temporary file, `writeFile`, file `sync`, file `close`, replacement `rename`, parent directory `open`/`sync`/`close`, and temporary `unlink` in `finally`. Windows replacement retry is finite: at most six delays of 20, 40, 80, 160, 320 and 640 ms. Individual OS filesystem calls have no application deadline. |
| Initial sign-in | Queue continuation from a resolved promise; account JSON write; `account-recorded` callback; two allocation `lstat` checks; ledger write; `id-reserved` callback; reserved registry write; `registry-reserved` callback. Callbacks are synchronous exits only at the selected crash point. |
| `directory-created` | Picker `mkdir`, picker `lstat`, crash callback. The process exits before the following directory syncs and ready write. File handles from preceding publications have already been closed. Kernel guards deliberately remain owned until process death. |
| Parent recovery open | Open roots, reclaim the dead owner's two guards, load/reconcile, publish ledger and registry, then resume the reserved picker. `mkdir` reports `EEXIST`; `lstat` validates the directory; the unset crash callback resolves; sync picker and parent; unset callback resolves; publish ready registry; unset callback resolves. |
| Later sign-in and restart | `firstLogin` saves the existing account, then returns the ready picker. `close` awaits the settled operation queue and both guard releases. Releases await ownership `readFile`, lock `unlink`, parent sync and guard `close` in `finally`. Reopen repeats root/guard/load/publication work; ready provisioning adds no directory work. Final cleanup closes and removes the synthetic tree. |

The old and new save functions both await `writeRegistryJson`. The new count proposal, count commit, membership index and provider/capability indexes are ordinary synchronous functions. This fixture has one account, one picker and no capabilities; their loops have finite inputs on this path. No limiter is imported on the registry path. There is no new pending count promise, lease wait or limiter callback to explain a recovery deadlock. Identical asynchronous edges do not prove which edge was pending when the historical test timed out.

## Rebuilt test and retained assertions

The six provisioning cases now use an owned IPC child. It acknowledges the selected seam and stays there. The parent verifies both guard records belong to that child and that a competing open refuses, kills that exact child, and observes its `exit` before opening recovery. Cleanup is registered before waiting, destroys the stderr pipe after exit, and kills the child on assertion failure. The child exits on parent IPC disconnect. Recovery no longer waits for output-pipe `close`. The six whole-workflow deadlines were deleted; no replacement deadline, clock assertion or retry was added. The existing focused runner's file budget remains a safety boundary for an actual stuck process or OS operation. This rebuild removes the pipe-close dependency and adds controlled filesystem-wait coverage; it is not a demonstrated fix for the unknown historical stall.

| Original coverage | Replacement coverage |
| --- | --- |
| Crash at all six provisioning seams | Same six cases, each with an acknowledged seam and observed forced process death. |
| Account/issued-ID cardinality and reserved picker ID | Same assertions after confirmed death. |
| Same picker becomes ready; no extra directory or contents | Same assertions after recovery. |
| Same ID survives a second restart/sign-in | Same assertion. |
| Writer ownership during interruption | Added assertions for both guard PIDs and refusal while the child is alive. |
| Recovery blocked on directory metadata | Added a controlled `lstat` promise gate. Assert the picker remains reserved and no ID is issued while held. Always release in `finally`, then verify ready state, cardinality and restart. No elapsed time is involved. |

`picker-limits.mjs` has no interval or timer. Expiry reads the injected clock when a request arrives and reclaims at most 16 bucket entries. A new async-hooks assertion verifies that construction, key changes, issuance/release and window rollover across separate instances create zero `Timeout` resources. There is no timer requiring `unref` or a limiter close method. The diagnostic logger's own unreferenced interval was explicitly cleared on exit and is not production code.

The owner requires hosted first-attempt stability receipts for rebuilt tests. Local single-run verification does not replace that landing gate.
