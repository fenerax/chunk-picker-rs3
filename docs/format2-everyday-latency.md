# Format 2 everyday latency: save admission blocker

Investigation of main `daa221d9`, 2026-11-11. No application change was made.
The requested owned-acceptance p95 below 300 ms remains unproven and unresolved.
Implementation stopped at the task's explicit restriction on save-path changes.

## Root cause

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

Final probe, Node 24.21.0, Windows shared PC, one owned process calculator:

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

The causal experiment pauses group A at `memory-published`, after the durable
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

## Options requiring a broader change

- Narrow catalogue admission to dependency publication, keeping command
  validation, preimage preparation and responses in each group's own queue.
  In the overlapping probe, 250.4 of the slowest Undo's 362.9 ms was spent
  entering the lease; its remaining observed interval was about 112.5 ms.
  Removing that wait is not a throughput guarantee: CPU and I/O still contend.
  This changes save sequencing and must preserve base publication, recovery
  capture, retained-base switching and cross-process exclusion.
- A shared/exclusive catalogue lease could admit independent existing-base
  saves together while retaining exclusive dependency publication and recovery.
  This is a storage-admission design change; no implementation or speedup is
  claimed. It needs deterministic concurrent-save, capture and crash tests.
- Reusing validation of deeply immutable catalogue fields could reduce the
  serialized service cost. Any cache must preserve roster-sensitive assignment
  checks, identity migration and every History inverse check. This does not
  remove the cross-group dependency, and the 50-group target cannot be claimed
  from a three-group profile. No validation was skipped or cached in this work.

Adding a second calculator or preemption does not remove the measured lease
wait. Neither was implemented. No save/wire format, acceptance gate, threshold,
scheduler policy, port or application save path was changed.

## Verification and evidence interpretation

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
