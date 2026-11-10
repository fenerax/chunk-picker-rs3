# Owned format 2 memory spike

Question: do shared frozen rows/entries with flat per-group containers meet the
roughly 5 MiB retained-heap target, without rewriting core catalogue semantics?
This is a throwaway experiment. No production storage or core files change.

Run once from this checkout with Node 24.20+ within 24.x:

```sh
node --expose-gc scripts/perf/format2-memory-spike.mjs --out var/format2-memory-spike/development
```

The output must be inside `var/format2-memory-spike/`. Existing `started.json`
refuses an accidental repeat. There is no input/save path option. Each variant
gets a fresh child process with inherited `RS3_*`, `NODE_PATH` and `NODE_OPTIONS`
cleared, using the public `open-starter` dataset. Inputs are generated synthetic
records. Outputs include only numeric/source-hash results and a chart; generated
stores remain in ignored scratch subdirectories and are not uploaded by CI.

On the shared PC, acquire the shared heavy-work lock, require at least 5.5 GiB
free before starting this bounded spike, use BelowNormal priority and release
within ten minutes. The process RSS guard is 3.5 GiB. The
parent gives the complete local comparison nine minutes. Do not repeat it on the
PC. CI allows eight minutes per variant and 27 minutes for the comparison.

## What is compared

All variants call the actual `openStore`, state validation, archived-History load,
command reducer, History compaction, preimage backup and fsync paths. Exact,
asserted `registerHooks` substitutions exist only in benchmark child processes;
`--check` verifies all six transformed modules without starting a measurement.

- **A, current format 1:** normal static-field reads, independently parsed trees
  and existing serialized-field caches.
- **B, flat structural sharing:** ordinary task arrays and identity dictionaries
  reference frozen rows/entries/alias arrays from one base. Each group allocates
  its own flat dictionary containers once at open. Registration copies only the
  touched entry and aliases; no whole-dictionary copy occurs at registration.
  Group-owned containers are mutable in this optimistic prototype. Concurrent
  old snapshots are not supported or claimed. A correct immutable production
  implementation could cost more; this is a useful lower bound if B already fails.
- **C, only if B misses:** a minimal enumerable identity `CatalogueView`, with
  shared base dictionaries and sparse versioned edits. Task arrays and core's
  existing task indexes remain flat. Proxies bridge existing core reads for this
  experiment; they are not a proposed production interface. Validation still
  enumerates the complete logical dictionaries. No validation is skipped.

B/C write a clearly marked, compact prototype envelope; their benchmark saves
cannot be reopened by production. They omit full catalogue serialization caches
and include shared-base/sparse delta ownership in memory. Their temporary format
does not establish production crash safety, portable export or restore support.

Archive hydration in B/C clones the group fields and events, preserves the
catalogue references, and calls full owned-state validation instead of the public
whole-state JSON-cloning validator. This is a necessary sharing boundary even
for B. History guards, replay and command behavior remain the real core paths.

One common observation hook returns a revision acknowledgement instead of building
a full command-response clone. Timings cover **durable commit/ack**, excluding
HTTP, browser projection, roll-pool/calculator startup and response encoding. No
calculator process or full server context is created. Passing this spike is a
representation result, not proof that 50 complete server contexts meet the limit.

## Fixture and attribution

Each variant uses 24,000 tasks, exactly 100,000 aliases, four members, 1,000 hot
events and two archived segments containing 200 earlier events. Real note commands
create valid sparse Undo patches. Each group also has an assignment and a distinct
custom task. Format-1 static files are content addressed; hard links deduplicate
fixture disk bytes without sharing parsed JS objects in A.

Warm a small store/command path and force GC before the shared baseline. Open 50
stores sequentially and retain every handle. Force GC after each open. With all
50 still open, run a tick, note, Undo and unique generated-goal registration in
each group, then GC after each group. Run one simultaneous 50-group note batch,
then a note/Undo pair per group, and GC again. All stores close only after results
and equivalence checks finish.

Per-group heap is the paired open increment plus that group's command increment;
later batch/repeat growth is charged evenly to groups. Report p50/p95/max and an
OLS slope over cumulative attributed increments, with raw memory samples. These
are post-GC deltas, not heap-dominator measurements; JIT/GC noise can affect
outliers. Total heap/RSS, external and array-buffer bytes include the shared base.
Peak observations are operation boundaries, not a continuous peak sampler. There
are no child-worker heaps. The process RSS guard is 3.5 GiB.

The target requires p95 and mean at most 5 MiB/group; reject a measured group over
15 MiB or aggregate retained group heap over 750 MiB. Full logical-state and
History hashes must match for all 50 groups across variants. Final checks hydrate
archives and remove storage-only archive paths before hashing, outside the timing
and final retained-memory sample. Shared objects are checked after open and after
registration; the base must stay frozen and unchanged.

## Five fresh runs on Linux and Windows

The manual workflow creates ten isolated jobs: five comparisons on each OS. Each
comparison starts A/B (and, when needed, C) in fresh processes, with no cross-run
fixture/cache reuse. Node 24.21.0 and source hashes are recorded. Artifacts retain
raw samples, command/open wall and CPU distributions, hashes and the chart.

After this branch is published and the workflow is registered on the default
branch, trigger it with:

```sh
gh workflow run format2-memory-spike.yml --repo fenerax/chunk-picker-rs3 --ref perf/format2-memory-spike -f ref=perf/format2-memory-spike
```

GitHub requires a newly added `workflow_dispatch` workflow on the default branch
before its first dispatch. This spike does not push, dispatch or change that branch.
Do not treat a single development comparison as the five-run cross-platform result.

## Development result

One completed comparison on 2026-11-10: Windows x64, Node 24.21.0 / V8
13.6, i7-8700K (12 logical CPUs), 32 GiB RAM, BelowNormal. Two earlier
attempts stopped during fixture setup (missing world; duplicated inline/static
tasks); neither produced an opened-group result. No completed variant was rerun.
The shared heavy-work lock was released after the completed comparison.

[Raw measurements](format2-memory-spike-windows.json) retain all samples, host/runtime,
source hashes and all 50 final hashes per variant. The recorded parent commit is
`e255a69`; the measured working-tree harness is bound by its source hashes.
One change was made after measurement, so the committed
`scripts/perf/format2-memory-spike.mjs` no longer matches its recorded hash
(`366d5b91…`): the `host.v8` field now keeps only major.minor (the full
four-part V8 version tripped the repository's address scan), and the three
recorded `host.v8` values were trimmed the same way. No measurement, fixture or
variant code changed. The measured harness is that file with line 199 reading
`v8: process.versions.v8,`; restoring it reproduces the recorded hash. The other
three source hashes match the committed files. MiB means 1,048,576 bytes. Percentiles below are over
50 groups in one process per variant, **not** five-run confidence intervals.

| Option | Retained/group p50 | p95 | max | OLS slope/group | Mean/group | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A: format 1 | 45.45 MiB | 45.52 | 45.97 | 45.45 | 45.45 | Reject: above 15 |
| B: flat shared objects | 10.44 MiB | 10.66 | 10.75 | 10.42 | 10.43 | Misses 5 |
| C: sparse identity view | 2.91 MiB | 3.15 | 3.23 | 2.90 | 2.91 | Meets 5 locally |

| Option | Shared/runtime baseline heap | Final total heap | Final RSS | Observed peak RSS |
| --- | ---: | ---: | ---: | ---: |
| A | 33.25 MiB | 2,305.54 MiB | 2,598.87 MiB | 2,756.56 MiB |
| B | 38.69 MiB | 560.18 MiB | 773.25 MiB | 908.51 MiB |
| C | 38.68 MiB | 184.33 MiB | 381.50 MiB | 516.36 MiB |

Final external/array-buffer memory was 2.90/0.33 MiB in each process; array buffers
are included in external memory. There are zero child-worker heaps. Baselines
include the single generated base even in A; B/C also include shared lookup/key
indexes. Group-attributable heap totals are 2,272.29 / 521.49 / 145.65 MiB.

Durable commit/ack timings in milliseconds; CPU is process user+system CPU,
including runtime threads, so it can exceed wall time:

| Option | Operation | Wall p50 / p95 | CPU p50 / p95 |
| --- | --- | ---: | ---: |
| A | Open | 1,037.26 / 1,395.82 | 1,312 / 1,515 |
| A | Tick | 62.22 / 93.59 | 266 / 422 |
| A | Note | 47.85 / 63.71 | 125 / 188 |
| A | Undo | 787.73 / 981.00 | 844 / 984 |
| A | Generated registration + tick | 377.32 / 522.51 | 359 / 407 |
| B | Open | 610.36 / 1,089.38 | 671 / 953 |
| B | Tick | 66.90 / 118.67 | 63 / 109 |
| B | Note | 55.64 / 97.56 | 16 / 47 |
| B | Undo | 310.20 / 400.49 | 281 / 390 |
| B | Generated registration + tick | 86.85 / 121.53 | 47 / 79 |
| C | Open | 676.19 / 915.68 | 765 / 907 |
| C | Tick | 51.00 / 70.85 | 62 / 110 |
| C | Note | 43.98 / 64.09 | 16 / 47 |
| C | Undo | 428.50 / 522.57 | 423 / 531 |
| C | Generated registration + tick | 68.91 / 90.25 | 47 / 78 |

The simultaneous 50-note batch took wall/CPU 649/1,110 ms (A), 1,402/1,077 (B),
945/1,296 (C). The final note/Undo pair retained 154.92/168.74/166.39 KiB across
all 50 groups, respectively. That is about 3.1–3.4 KiB/group; new History and note
records plausibly explain it (inferred). One repeat cannot establish a leak-free
plateau. Repeat-pair timing distributions and boundary memory peaks are in JSON.

All 50 final logical-state hashes **and** ordered History hashes match across
A/B/C after archive hydration and full validation. Shared rows/entries remain
identical to frozen base objects after commands; generated entries never enter
the base. All source-anchor/syntax checks and workflow matrix checks pass.

## Decision and slice plan

**B is insufficient for the 5 MiB goal. C meets it in this store-only experiment.**
The B-to-C mean reduction is 7.52 MiB/group with task arrays/indexes unchanged.
This isolates the identity dictionaries as a sufficient place to introduce a
shared view for this fixture; it does not prove they dominate real server heaps.
Do not land the broad core rewrite merely because the design proposed it.

1. Keep slice 1: deterministic base builder/verifier; storage and dataset identity.
2. Revise slice 2 to a sparse identity view, touched-entry registration and explicit
   clone/materialization boundaries, while retaining flat task arrays and existing
   History/Undo row semantics. Estimate M–L, 350–650 changed lines including
   differential tests (inferred). Contracts: owned-state validation/immutability,
   exact History/Undo guards and portable JSON boundaries. The Proxy is throwaway.
   C's `structuredClone` incompatibility requires an audit before production use.
3. Keep slices 3–6: owned codec/publication, backup closure, lossless rebase and
   rollback inflater. No activation before their acceptance tests pass.
4. Keep slice 7 as a gate: shared calculator transport/cache and the complete
   50-server-context test, including responses and calculators. Run the ten hosted
   jobs above before landing production slices. C has about 1.85 MiB/group of p95
   headroom; this harness cannot show whether excluded server allocations fit.
5. Keep slices 8–9: additive browser negotiation, then retention/GC/tombstones.

If full contexts exceed 5 MiB/group, attribute that growth before broadening the
task/core view. Reject any attributable group above 15 MiB. Plugin wire changes
remain additive; legacy-shared and the rollback pin remain untouched. No production
slice, public API or storage-format implementation is included in this commit.
