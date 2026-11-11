# Acceptance-sized snapshot throughput

The #200 cold fallback repeatedly walked and encoded unchanged snapshots when
their graph exceeded the hot ceiling. Cold records now carry their measured
heap cost and canonical bytes across hydration. Refresh measures a changed
revision once; admission reuses that measurement. Promotion retains and charges
the existing byte allocation, and demotion reuses it. Lazy views, locations,
planning, Why, estimates and prediction state still invalidate the revision.
Forced refresh remains the explicit invalidation for in-place mutations.

The 128 MiB hot ceiling, 384 MiB worker ledger and existing owner limits stay
unchanged. The meter now charges V8-internalized property names once, including
64 bytes per name for its own retained registry. String values still pay every
UTF-16 reference charge; objects, properties and backing allocations retain
their conservative charges. The measured hot graph is **108.9 MiB**, rather
than the earlier approximately 145 MiB. One graph and fifty cold records fit
together: the final ledger was 357.0 MiB, with no snapshot eviction.

## Paired local probe

Main `a8cfa092` versus implementation `3eea11cd`, Node 24.20.0, Windows,
BelowNormal, sequential runs under the shared heavy lock. The same extended
`scripts/perf/admission-burst.mjs` ran both arms using its source-root argument:

```sh
RS3_DATASET=open-f2p node --expose-gc scripts/perf/admission-burst.mjs main.json 50 --acceptance-sized /path/to/main
RS3_DATASET=open-f2p node --expose-gc scripts/perf/admission-burst.mjs branch.json 50 --acceptance-sized
```

Both arms use 24,000 tasks, 100,000 aliases, 256 chunks, four members per group,
distinct assignments/completions/custom goals, the owned base/delta transport,
one process calculator and full approximately 29.9 MB responses. All fifty
group states stay resident. Full object access/parsing is exercised; no server,
stores, History workload or acceptance workflow is run. These are one paired
diagnostic, with small nearest-rank p95 samples, not hosted latency guarantees.

| Measurement | Main | Fix |
| --- | ---: | ---: |
| First calculation worker service | 6,074 ms | 2,736 ms |
| Cold worker service p95, 50 groups | 4,057 ms | 2,868 ms |
| Cold worker service maximum | 5,926 ms | 3,169 ms |
| Consecutive full worker service p95, 8 repeats | 6,629 ms | 379 ms |
| Consecutive full response wall p95, before parsing | 6,716 ms | 452 ms |
| Interleaved full worker service p95, 5 returns | 3,027 ms | 1,209 ms |
| Why response wall p95, 7 requests including index creation | 2,930 ms | 127 ms |
| Burst duration, 50 complete groups including object access | 165.21 s | 102.76 s |
| Burst response wall p95, including queue | 158.32 s | 98.30 s |
| Refusals / errors | 0 / 0 | 0 / 0 |
| Retained calculator-isolate heap | 139.18 MiB | 189.13 MiB |
| Retained controller + relay + calculator heap | 223.96 MiB | 277.36 MiB |
| Calculator retained ArrayBuffers | 146.74 MiB | 143.75 MiB |

Heap receipts follow two forced calculator collections and controller
collections outside latency samples; relay heap is sampled through the existing
process adapter. Keeping one hot graph adds about 53.4 MiB across the three
isolates, while cold backing storage remains bounded. The snapshot count changes
from 51 cold to 50 cold plus one hot. This preserves #200's bounded graph
retention, rather than retaining fifty decoded graphs.

The measured Why sample meets 0.3 s and cold worker p95 meets 3 s; the maximum
cold service is 3.17 s. Full warm responses exceed 0.3 s; queue-inclusive heavy
requests exceed 3 s. First
calculation wall time is 2.85 s, before its 0.27 s parse or 2.13 s worker startup,
so the 2 s cold-open target is not established. The unchanged **15 MiB
attributable-group / 750 MiB aggregate** gates still require the complete
store/History/growth workload; this calculator-only probe does not certify them.

## Fifty compact entries: evaluate separately

Worth prototyping, not implemented here. Share immutable task rows, definitions
and evidence; retain only per-group status/delta arrays and bounded indexes.
At most 2 MiB each gives a **100 MiB** pool for fifty groups, versus about
5.3 GiB of current conservative decoded-graph charges. Revalidate both memory
gates with stores and History included.

A compact full-result hit should aim for today's hot service, approximately
**0.38 s**, while eliminating the roughly 0.8–1.2 s cold-hydration path.
This is an estimate, not an implemented timing. Fifty 0.38 s requests still
consume about **19 s** on one lane; a 3 s queue-inclusive p95 needs approximately
60 ms service per request. Compact entries therefore need compact responses and
incremental calculation as well to meet sustained concurrency targets. Merely
increasing the full-graph entry count cannot meet the memory budget.

## Verification

The scoped 19-file inventory reports **196 passing cases and one Y03 harness
failure**. It covers serialized snapshots (including pass
counters and property-name accounting), snapshot wire, both prediction-output
files, prediction cache, play server, session residency, both calculation
equivalence files, owned calculator, calculation retention, engine cache worker
and snapshot, resident planning and GC, and both Q2 and Y03 differential pairs.
Linux integration detectors run in WSL with Node 24.20.0; the Windows Q2
integration attempt stops at its existing Linux `/proc` requirement. Y03's
1.5-second outer-deadline case failed on the Windows-mounted WSL checkout:
interrupted Git initialization left a locked worktree and cleanup returned 14
instead of 124. A narrow unchanged-main control reproduces that same error.
The complete Y03 integration hits the same assertion on WSL's native filesystem.
Its calculation, injected-defect and replay controls pass before that deadline
case. The unchanged harness is left outside this cache fix.
No broad test suite, acceptance dispatch, storage/admission edit or protected
worker/trace-anchor source change is included.
