# Format 2 everyday latency and catalogue admission

Initial investigation of main `daa221d9`, committed as `31923e2c`, 2026-11-11.
The approved follow-up implements shared/exclusive catalogue admission below.
It is not activated on real saves; activation remains a separate owner decision.
The requested owned-acceptance p95 below 300 ms still needs hosted measurement.
The shared/exclusive lease removes cross-group catalogue waiting in the reduced
probe, but its overlapping Undo walls remain above 300 ms. This change alone
does not establish the requested latency target.

## Original root cause

The owned acceptance command path does not await the calculator lane.
`exercise()` calls `store.commandSerialized()` for tick, note and Undo; it calls
`calculate()` only after those three commands finish. The harness does not
install `computeRollPool` or a preparation hook that invokes the calculator.

The cross-group wait is the shared **catalogue publication lease**:

1. `app/storage/store.mjs` wraps every enqueued command with `withCatalogue()`.
2. For format 2 this calls `ownedStorage.withLease()`.
3. `createPinnedStorage().withLease()` in `app/storage/owned-storage.mjs` chains
   work through `admissions.get(root)`. All fixture groups share that catalogue
   root, so their entire commands run serially.
4. The lease remains held through command application/validation, retained
   preimages, encoding, durable publication, subscriber notification and reply
   preparation. Format 1 has no such catalogue lease.

This is additional to each group's own revision queue. No shared fsync queue,
calculator admission or deferred task input is needed to reproduce the wait.
Filesystem work and compression do occupy part of the serialized section.

Repeated resident-state validation makes that section expensive. The serial
CPU profile is dominated by `validateStateCopy`, `assertJson`'s `visit`,
`uniqueRecords` and task validation. A representative traced command from the
initial probe spent 47.7 ms applying a tick, 44.2 ms applying a note, and 51.3 ms
applying Undo. Undo additionally spent 44.3 ms before application while loading
and validating archived History. Those are observations, not cost guarantees.
Sparse disk encoding took 0.08–0.16 ms in those samples; reply preparation took
about 1–4 ms. Moving only reply preparation would leave most of the lease cost.

## Reduced reproduction

`scripts/perf/everyday-latency.mjs` uses three command streams, one separate
uncached calculation, and an extra warmup group. It reuses the acceptance
fixture builder with 24,000 tasks, 100,000 aliases, four members and 256 chunks,
but only four live History entries and one archived event. It never runs the
50-group workload, starts an HTTP listener or accepts an existing save path.

Run with Node 24.20+ within 24.x, BelowNormal priority and the focused
`open-f2p` test environment with inherited pack/profile overrides cleared:

```sh
node --import ./scripts/perf/everyday-latency/trace.mjs scripts/perf/everyday-latency.mjs --out var/everyday-latency-fresh
```

The loader inserts observation calls in memory; it does not edit application
files. It refuses changed trace anchors. `results.json` contains command,
lease, publication and calculator events; `main.cpuprofile` covers the serial
commands. Synthetic stores remain in the selected output directory for
inspection. Use a fresh output directory for another experiment.

Baseline probe, Node 24.21.0, Windows shared PC, one owned process calculator:

| Workload | Tick wall range | Note wall range | Undo wall range | Maximum lease admission wait |
| --- | ---: | ---: | ---: | ---: |
| Serial commands | 69.5–79.7 ms | 59.7–61.8 ms | 104.2–115.7 ms | 1.8 ms |
| Three concurrent groups, no calculation | 59.1–178.0 ms | 174.5–176.4 ms | 226.3–338.7 ms | 209.5 ms |
| Three concurrent groups and a fresh calculation | 63.0–201.0 ms | 200.6–202.5 ms | 266.0–362.9 ms | 250.4 ms |

There are three samples per command per row. These are diagnostic ranges,
not an acceptance percentile estimate or a before/after improvement claim.
The fresh calculation took 2,103.3 ms. All nine overlapping commands finished
766.9 ms after dispatch, while the calculator continued for another 1,330.8 ms.
Only the two explicitly requested calculations (warmup and fresh) generated
calculator work messages. No everyday command dispatched calculator work.

The original causal experiment pauses group A at `memory-published`, after the durable
state has been published but before reply completion. Group B's lease request
observes an outstanding catalogue admission and cannot enter. B's revision
remains unchanged until A is released; it then commits exactly once. There
are zero calculator work messages during this experiment. These assertions
use event ordering and saved revisions, with no latency threshold.

An earlier probe reused the calculator's warm snapshot (702 ms calculation);
the next experiment used a different group to measure an uncached calculation
(2,028 ms). The final checked-in probe verifies the explicit queued-lease flag
and command/calculator message counts. These were distinct diagnostic cases,
not repeated test runs to assess flakiness.

## Original options, before save-path authorization

- Narrow catalogue admission to dependency publication, keeping command
  validation, preimage preparation and responses in each group's own queue.
  In the overlapping probe, 250.4 of the slowest Undo's 362.9 ms was spent
  entering the lease; its remaining observed interval was about 112.5 ms.
  Removing that wait is not a throughput guarantee: CPU and I/O still contend.
  This changes save sequencing and must preserve base publication, recovery
  capture, retained-base switching and cross-process exclusion.
- A shared/exclusive catalogue lease could admit independent existing-base
  saves together while retaining exclusive dependency publication and recovery.
  At diagnosis time this needed storage-admission authorization and deterministic
  concurrent-save, capture and crash tests. The approved implementation follows.
- Reusing validation of deeply immutable catalogue fields could reduce the
  serialized service cost. Any cache must preserve roster-sensitive assignment
  checks, identity migration and every History inverse check. This does not
  remove the cross-group dependency, and the 50-group target cannot be claimed
  from a three-group profile. No validation was skipped or cached in this work.

Adding a second calculator or preemption does not remove the measured lease
wait. Neither was implemented. The diagnostic commit changed no save/wire
format, acceptance gate, threshold, scheduler policy, port or save path.

## Initial diagnostic verification and evidence interpretation

Only `tests/owned-everyday-calculator-independence.test.mjs` was run locally.
Its outer case and two format subcases pass (3 passed, 0 failed/skipped), using
the complete `testRunPolicy` environment, BelowNormal priority and one worker.
The first invocation exposed a missing synthetic surface declaration; the
fixture was corrected before the passing invocation. No full suite or
flakiness loop was run.

The test deliberately withholds the sole calculator's completion until two
groups have each finished tick, note and Undo, including durable writes and
serialized replies. Injected application clocks do not advance. It checks one
deferred input load, one calculator message, durable-state equality with each
store, and exact logical saved-state/reply equality between formats 1 and 2.
It has one file-level outer guard, no per-subcase limits or timing assertions.
It pins calculator independence; it does not claim to fix catalogue contention.

The original acceptance evidence's concurrent command records have
`mainCpuMs`, `childCpuMs` and `cpuMs` set to `null`. Their slow wall samples
therefore cannot be directly compared with the reported CPU p95, which uses
other rounds. Child CPU observed across checkpoint intervals is not evidence
that a tick submitted calculator work. The reduced probe's message trace and
the held-calculator test establish causality without that inference. The
acceptance harness and its measurements were left unchanged.

## Shared/exclusive implementation and caller audit

`app/storage/catalogue-lease.mjs` now coordinates local readers and writers.
Each nonempty admission batch holds one unchanged `acquireProcessGuard()`
kernel endpoint for the whole catalogue root. Other processes still refuse
both modes, including stopped-store inflation and migration tools. Shared
admission is deliberately limited to groups in the same process; this change
does not introduce a second cross-process lock protocol or persistent lock file.

An admitted exclusive request runs alone. A queued exclusive request stops all
further shared admissions, including requests queued during guard acquisition.
Exclusives take FIFO turns before pending shared work. Aborting a queued writer
removes its fence; aborting a waiter never cancels another holder. Work already
admitted retains ownership until it finishes or throws. The kernel guard is
released when the batch drains and disappears on process death.

Reentrant exclusive scopes can reuse either mode; shared scopes can reuse
shared admission. Shared-to-exclusive upgrades fail before work runs. Entered
detached children (such as retention maintenance) keep their parent's permit
until they drain. Async context whose owner has ended must acquire fresh
admission. An uncertain kernel-release failure fails closed.

| Caller / scope | Mode | Preserved invariant |
| --- | --- | --- |
| `store.mjs` startup `withCatalogue` | Exclusive | Select/verify the pinned base; initialize, migrate, repair or publish startup dependencies under catalogue-wide exclusion. Existing format-2 bases establish publication durability before the handle becomes available. |
| `store.mjs` `enqueue` | Shared, existing durable base | Commands, Undo, replacement/transfer application, plugin currency/review, sessions, acknowledgements and freeze work retain the unchanged per-group revision queue and atomic write order. They cannot switch or publish bases while shared. |
| `store.mjs` `enqueueMaintenance` | Shared, existing durable base | Backup browsing, packing/pruning and History readers remain serialized by the group's maintenance queue; catalogue files are immutable. Capture still fences them with the group write barrier and exclusive catalogue admission. |
| `owned-storage.mjs` public `withLease` without a mode | Exclusive | Conservative compatibility for callers that relied on the former serial lease. |
| Public `withLease(..., {mode:'shared'})` first-publication scope | Exclusive for that entire scope | An unpublished or not-yet-directory-synced dependency keeps the command's original preimage → dependency → state publication order. Existing-base scopes can subsequently be shared; there is no mid-save upgrade. |
| `owned-storage.mjs` `writeState` | Shared with durable proof; otherwise exclusive | Existing-base renames verify the exact base identity before reference publication. A changed/missing dependency fails closed. First base publication keeps the exclusive path. An outer exclusive scope remains exclusive. |
| `owned-storage.mjs` `ensurePublished` / `publish` | Exclusive | Base creation, ancestry/base-directory sync and dependency durability remain excluded from concurrent shared saves. Inside an existing shared scope it can only verify an already durable dependency. |
| `owned-storage.mjs` `select` | Exclusive | The selected writer base cannot change during an in-flight shared save. Interrupted selection restores the previous in-memory pin. Retained readers do not change the active writer base. |
| `owned-storage.mjs` `activate` | Forced exclusive writer admission | A standby selects the final authoritative pin and enables writer publication while holding catalogue exclusion, even though its preceding reads were read-only. Shutdown is checked before enabling the writer and after asynchronous lease release, before store ownership is published. |
| `owned-rebase.mjs` stopped stage/reconcile wrapper | Exclusive | Group kernel ownership plus catalogue exclusion cover preimages, retained-base selection, dependency publication, binding/state renames and intent cleanup. |
| `owned-recovery.mjs` `withRecoveryLeases` | Exclusive, roots sorted | Acquire after group writers drain; hold all participating catalogue roots through dependency discovery, copying, validation and completion publication. |
| `owned-recovery.mjs` `installOwnedClosure` | Exclusive | Verify and publish restored pinned bases before any restored state references them. |
| Acceptance fixture publisher | Exclusive | Publish the synthetic immutable base once before measurement. No threshold or workload contract changes. |
| `inflate-owned-format-1.mjs` direct catalogue process guard | Exclusive kernel ownership, unchanged | Stopped migration owns all group guards and the same root guard; it refuses either live shared or exclusive admission. |
| `read` / `codec` and isolated read-only store handles | Immutable read / caller's admission | Verified base reads and codec construction publish no files. Isolated import/capture readers retain their pre-existing enclosing writer/capture authorization and cannot switch a writer's base. |

All `withLease` and `withCatalogue` call sites in application and public scripts
were audited. The per-group command queue, file lock, plugin-evidence locks,
atomic replacement sequence, preimage retention, save/wire formats and state
validation are unchanged. There is no validation cache in this change. No
deployment, real-save activation, push or acceptance-gate change is included.

## Reduced probe after the change

The before and after runs use the same synthetic shape and command sequence,
Node 24.21.0, `open-f2p`, one process calculator and BelowNormal priority.
The after probe held the approved shared test lock for 24.7 seconds. No run was
repeated to assess flakiness. Artifacts are kept in the worktree's ignored
`.local/f2-everyday/final-probe/` (before) and `after-probe/` directories.

Three groups overlapping one fresh calculation, three samples per action:

| Action | Before wall range | After wall range | Before lease wait range | After lease wait range |
| --- | ---: | ---: | ---: | ---: |
| Tick | 63.0–201.0 ms | 218.3–227.3 ms | 3.164–130.113 ms | 0.998–1.078 ms |
| Note | 200.6–202.5 ms | 178.2–190.4 ms | 129.342–139.240 ms | 0.016–0.027 ms |
| Undo | 266.0–362.9 ms | 398.7–407.2 ms | 140.528–250.436 ms | 0.017–0.029 ms |

Without a calculation, the after wall ranges are 144.8–151.1 ms for tick,
138.4–145.6 ms for note and 262.1–265.3 ms for Undo. Maximum lease wait is
0.922 ms, compared with 209.500 ms before. Serial after walls are 76.2–80.2,
66.3–73.1 and 117.6–121.3 ms respectively.

In the inverted pause experiment, B enters and commits revision 18 while A is
still paused after publishing its own revision 18. Before the change B remained
at revision 17 until A resumed. Both experiments send zero calculator messages.
The ordinary workload sends exactly two messages: warmup and fresh calculation.
The fresh calculation takes 3,034.8 ms after, compared with 2,103.3 ms before,
and continues for 2,215.0 ms after every overlapping command has completed.

Lease admission no longer explains the remaining command walls. Shared saves
still run validation on one main event loop and share filesystem work. The
serial CPU profiles in both runs have `validateStateCopy`, `assertJson`'s
`visit`, `uniqueRecords` and `validateTask` as their largest application sample
counts. The runs do not establish a total wall-time speedup: the tick and Undo
walls and the independent calculator wall are higher in the after run. No
validation is skipped or cached. Three samples cannot estimate the acceptance
p95, and the 50-group hosted acceptance target remains unverified.

## Changed files

| File | Purpose |
| --- | --- |
| `app/storage/catalogue-lease.mjs` | Shared/exclusive local admission, writer priority, reentrancy, cancellation and kernel-guard lifetime. |
| `app/storage/owned-storage.mjs` | Root admission, durability-dependent save mode, exclusive publication/selection/activation and interruption seams. |
| `app/storage/store.mjs` | Shared everyday scopes, exclusive startup and shutdown-safe asynchronous standby activation. |
| `app/storage/owned-rebase.mjs` | Explicit exclusive stopped rebase admission. |
| `scripts/linux/owned-recovery.mjs` | Explicit exclusive capture and restored-dependency publication. |
| `scripts/perf/owned-acceptance/fixture.mjs` | Explicit exclusive synthetic base publication; no measured workload or gate change. |
| `scripts/perf/everyday-latency.mjs`, `scripts/perf/everyday-latency/trace.mjs` | Trace the new admission wrapper and invert the paused-publication experiment. |
| `tests/catalogue-lease.test.mjs` | Deterministic admission ordering, writer starvation prevention, aborts, failures and async ownership. |
| `tests/owned-catalogue-concurrency.test.mjs`, `tests/helpers/catalogue-process-guard.mjs` | Cross-group save overlap, per-group ordering, cross-process refusal, consistent capture/selection and standby shutdown boundaries. |
| `tests/owned-catalogue-crash.test.mjs`, `tests/helpers/owned-catalogue-crash.mjs` | Process exit and thrown interruption at each new shared/exclusive admitted/releasing and base-selection seam, exact state/base bytes and recovery. |
| `docs/format2-everyday-latency.md` | Diagnosis, caller/invariant audit, measurements and verification record. |

## Focused verification

Ten distinct test files were run locally. Latest relevant runs pass 158 native
cases including outer cases, with no failures, skips, cancellations or todos:

| Test file | Passed |
| --- | ---: |
| `catalogue-lease.test.mjs` | 8 |
| `owned-catalogue-concurrency.test.mjs` | 7 |
| `owned-catalogue-crash.test.mjs` | 11 |
| `owned-everyday-calculator-independence.test.mjs` | 3 |
| `storage-owned-format2.test.mjs` | 31 |
| `owned-backup-closure.test.mjs` | 20 |
| `owned-rebase.test.mjs` | 32 |
| `storage-owned-load.test.mjs` | 16 |
| `live-swap-storage.test.mjs` | 18 |
| `storage-publication.test.mjs` | 12 |

Focused invocations apply the complete `testRunPolicy` environment, Node 24.21.0,
BelowNormal priority and `--test-concurrency=1`. Test batches acquire the approved
shared lock atomically with an owner record and release only their own record
and empty directory. Their lock holds were 35.9, 214.3, 50.9 and 51.4 seconds.
Affected files were rerun after implementation changes; there was no full suite
or repetition loop. New tests use event ordering, revisions and exact bytes,
with one generous outer guard per file and no per-case timing limits or retries.

The crash tests exit or throw at five new boundaries. Each case preserves exact
old or committed state bytes, preserves both retained base files when switching
pins, reopens successfully and saves the next revision. Existing format-1/2
tests preserve logical saved-state/reply equality, History/Undo preimages,
flag-off physical bytes, recovery closure and old rollback-loader behavior.
The reduced probe ran before the final standby-only shutdown check; that check
does not change its command or calculator paths. Full CI and hosted acceptance
remain required before landing or activation.
