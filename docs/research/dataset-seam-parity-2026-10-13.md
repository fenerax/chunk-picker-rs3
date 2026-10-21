# Dataset seam verification — 2026-10-13

Milestone 2 supplies only `duo-legacy`, dataset contract 1. The pre-code
inventory is in [dataset-seam-inventory-2026-10-13.md](dataset-seam-inventory-2026-10-13.md);
operator instructions are in [data-packs.md](../data-packs.md).

The transcription audit compared all 110 logical values from the original
HEAD modules with the recombined 119 encoded contract/presentation keys.
They match, including Map/Set insertion order and own undefined properties.
The one undefined value is `MAP_CORRECTIONS[2].oldValue`, for chunk `8495`.
IDs, aliases and registry rows were not regenerated or renamed. Protected
source JSON, original reference bytes, resources, changelog and roadmap are
unchanged.

## Final parity

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/dataset-parity.mjs
```

The final run passed all **112** hash comparisons, with no differences.
Tracked and freshly built `1.0.0` pack profiles ran sequentially under the
heavy lock, starting from the same frozen disposable capture. Clock and
random inputs were controlled. The expected Advanced version change and
packed flags were asserted separately; all other dataset status fields match.

| Check | Tracked | Pack |
| --- | --- | --- |
| Member 0 tasks | 20,641 | 20,641 |
| Member 1 tasks | 20,593 | 20,593 |
| Read-only gameplay bytes unchanged | Yes | Yes |
| Revision before → after read-only startup | 120 → 120 | 120 → 120 |
| Gameplay migration unchanged | Yes | Yes |
| Undo restored original gameplay | Yes | Yes |
| Peak sampled process-tree working set | 3,172,020,224 bytes (2.95 GiB) | 3,132,456,960 bytes (2.92 GiB) |
| Profile-process maxRSS | 2,152,428 KiB | 2,110,204 KiB |

Comparisons cover full task results and ID/status/order, aliases, source and
access evidence, roll pools, BiS, transport, Mining/Woodcutting/Fishing plans,
rule keys/values/defaults/wording, API and browser catalogue payloads, a normal
revision-checked note command, History and Undo. Object keys are sorted;
arrays retain their order. Only `metrics.elapsedMs`, `timingMs` and cache
`evaluationMs`/`requestMs` are omitted. Cache hit flags remain compared.

Process-tree memory is the largest sampled sum of live profile/calculator
working sets, sampled about once per second; it can miss shorter spikes.
`maxRSS` is the profile process only. The report does not include the live
picker or unrelated machine processes.

The capture excludes the lock, access token and aggregate usage telemetry.
An earlier attempt encountered usage counts incompatible with this branch's
operational event catalogue. The final profiles use fresh usage storage;
no gameplay comparison was relaxed. Gameplay state, journal, static fields
and backups retain their captured bytes. Authentication, invitations,
feedback and usage are outside the gameplay-byte comparison, as documented
in the operator guide. The original save was never written. All scratch
captures, profile saves and test packs were removed in `finally`.

## Test record

The full suite ran once under the heavy lock with one test file at a time:
**4,010 tests: 3,972 passed, 37 failed, 1 skipped**. Failures exposed native
cache wiring and data-only rule-context bugs, fixture assumptions about
implicit native capabilities and mutable environment variables, direct-import
browser assertions, late metadata behavior and an input fingerprint race
during development. These were corrected.

A serial corrective run covered every failed file and additional worker
regressions: **454 tests, 451 passed, 3 failed**. Its browser VM harness and
one synthetic equipment fixture were corrected; each passed an immediate
focused rerun. Its remaining warmup failure was fixed by retaining the
existing scheduler request/warmup key format.

The final serial heavy targeted run passed **98/98** across provider/startup,
section geometry, equipment preview, world, real process workers, worker
timings, warm startup and duo lanes. A subsequent binding regression also
passed: a storage junction cannot bypass the physical directory's sibling
binding; verification and binding leave exact save/receipt bytes and directory
entries untouched. Missing ordinary storage directories remain supported.
The final complete provider fixture file passed **22/22**, including that
binding regression. Final `npm run test:quick` passed **1,305/1,305** and
confirmed test classification. Syntax checks covered 180 changed/new modules;
the final worker/provider/binding changes also passed their executable checks.
No owned test server or calculator remained after cleanup.

The full suite was not repeated after corrections, following the shared
one-run rule. Claude's merged-batch full run remains the final integration
check. No screenshots were needed: the only visible change is the dataset
line in Settings → Advanced. No independent public dataset, public export,
real pack installation or live-picker change was performed.
