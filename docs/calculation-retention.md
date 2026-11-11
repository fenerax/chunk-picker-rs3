# Calculation cache retention

The controller retains transport bytes and parses only when a consumer requests
an object. Forwarding full/play bytes does not parse or memoize a result graph.

Each physical calculator keeps one most recently used decoded snapshot, shared
between its full and sandbox caches. Its hot set is bounded by both entry count
and **128 MiB of conservative heap charges**, inside the existing shared worker
and picker budgets. Older snapshots become LZ4-encoded V8 bytes. Serialization is
deferred until demotion, so unchanged hot reads neither decode nor rewrite the
snapshot. Hydrated hot entries also retain their canonical cold bytes, charging
the complete backing allocation in addition to the heap graph; repeat demotion
reuses those bytes. Deferred views, processing descriptors and aliases survive
hydration.
Validated prediction state is prepared lazily once per captured revision, charged
inside the snapshot and serialized on demotion. Candidate requests reuse that
state without retaining an opaque closure. The unused planning canonicalizer is
removed without changing index identity or cancellation.
Owned identity dictionaries become explicit plain data in prediction state and
deferred-view context, so heap measurement and cold serialization see their
complete logical contents. No extra projection cache retains them off-ledger.

Heap accounting walks producer-owned graphs, counting objects, properties,
array/reference slots, Map/Set storage, UTF-16 strings and entire backing
allocations, independently of serialized size. Aliased objects are counted once;
string values and shared definitions are conservatively overcharged. V8
internalized object property names are charged once per graph, including
conservative storage for the meter's own name registry. Lazy additions
extend the charge without walking the stable baseline again. Removed components
retain their charge as slack until demotion; forced refreshes start a fresh walk.
Unsupported graphs bypass reuse. Graphs too large for either heap budget stay as
bytes. `RS3_CALCULATOR_HOT_SNAPSHOTS=0` selects byte-only snapshots for diagnostics;
increasing the entry bound does not increase the 128 MiB hot heap ceiling.
Removing repeated property-name charges lets the acceptance-sized graph fit
without changing the ceiling. The shared worker/owner ledgers and the 15 MiB
attributable-group / 750 MiB aggregate acceptance gates stay unchanged.
Cold records preserve their measured heap cost as a scalar. Unchanged reads,
failed promotions and refresh/admission pairs reuse it and the canonical bytes;
content changes invalidate both once. Explicit forced refresh still marks
in-place changes such as same-size estimate replacements. See the
[acceptance-sized throughput comparison](snapshot-throughput.md).
Both cache instances resolve preserved snapshots through a shared, ledger-scoped
weak token registry. A rejected sandbox admission preserves the current baseline
even when its metadata belongs to the complete-result cache.

## Local synthetic measurements

Node 24.20.0, one BelowNormal process at a time, open-f2p environment, no server
or writable store. `scripts/perf/calculation-retention.mjs` uses the existing
hand-authored 20,560-task scale definitions, eight distinct cold groups and seven
warm actions on the most recent group (six different Why subjects, then play).
Nearest-rank p95 is the maximum of these small samples. GC checkpoints are outside
latency samples and use two collections separated by event-loop turns.

The comparison app is main `202cd5db6f2a25301d0647b07187bee85df5d747`.
Fetched main `da984d6c6481c4619ba8b1ef27bfca417b36f34b` has byte-identical
calculator/controller code; its only intervening change is in storage.

| Worker sample | Main | Bounded hot set |
| --- | ---: | ---: |
| Cold p95, eight groups | 942 ms | 1,301 ms |
| Warm p95, seven actions | 113 ms | 98 ms |
| Retained heap growth after eight cold groups | 138.66 MiB | 30.69 MiB |
| Retained heap growth after warm actions | 123.45 MiB | 32.03 MiB |
| Retained ArrayBuffer growth after warm actions | 1.53 MiB | 7.62 MiB |

Cold p95 increases by 359 ms (38%); it remains below the 3 s heavy-calculation
target. Warm p95 meets the approximately 150 ms target in this sample. One hot
graph is charged **117.00 MiB** after lazy Why indexing, well above measured heap
growth. The rest of the eight snapshots own bytes, about 0.871 MiB each.

After the prediction-reuse and cross-cache preservation fixes, one unpaired
sanity sample of the same harness measured warm p95 **96 ms**, cold p95
**1,214 ms**, worker heap growth **30.51 MiB** after eight cold groups and
**31.86 MiB** after warm actions, with one decoded graph retained. The paired
main/candidate figures above remain the comparison.

`scripts/perf/controller-retention.mjs` feeds the real scheduler identical full
and projected-play fixture bytes in both arms. Each of eight groups materializes
the full result, followed by one most-recent byte consumer and one object consumer.
The fixture has a 55.29 MiB full response and an 18.75 MiB play response, so the
ordinary 128 MiB result budget retains one entry in this sample.

| Controller sample | Main | Candidate |
| --- | ---: | ---: |
| Retained heap growth after eight groups and consumers | 69.33 MiB | approximately 0 MiB |
| Retained ArrayBuffer growth | 74.04 MiB | 74.04 MiB |
| Most-recent byte forwarding | 0.084 ms | 0.070 ms |
| Most-recent full-object materialization | 0.060 ms | 268 ms |
| Cold response + full-object p95, eight groups | 335 ms | 342 ms |

The candidate's raw heap delta is -0.58 MiB, reported as approximately zero
rather than a negative cache footprint. Full-object materialization deliberately
pays parsing cost on demand. Ordinary byte forwarding stays below 0.1 ms. The
full-object response fixture is substantially larger than the everyday play
projection; this probe does not include HTTP, save or browser latency.

### Profile before choosing the hot set

A separate diagnostic on the byte-only implementation attributed warm costs to:

| Request | Decompress | V8 deserialize | Other substantial work |
| --- | ---: | ---: | --- |
| First Why, 481 ms | 116 ms | 139 ms | Why index 24 ms; serialize 95 ms; compress 91 ms |
| Later Why, 229–412 ms | 59–144 ms | 159–289 ms | About 11 ms restoration/lookup |
| Warm play, 547 ms | 91 ms | 221 ms | Projection 96 ms; JSON output 130 ms |

Full evaluation, task-row rebuilding and presentation rebuilding were all zero
on these warm requests. The hot-set profile eliminated decoding and rewriting:
first Why took 42 ms (28 ms indexing), warm play 118 ms (25 ms projection and
93 ms JSON output). Instrumented profile timings are separate from the paired
uninstrumented latency sample above.

### Projection and limits

For one physical calculator and the same synthetic full-response mix, the
50-group **calculation-cache** projection is approximately **150 MiB including
backing buffers**: 32.03 MiB worker heap + 7.62 MiB worker backing growth +
74.04 MiB controller backing growth + 42 additional cold entries × 0.871 MiB.
Controller decoded heap remains approximately zero; worker decoded heap remains
bounded rather than growing per group. Entry/key overhead adds a small allowance.

This is distinct from the earlier whole-application investigation. Conservatively
adding one approximately 40 MiB graph to its 225–270 MiB estimate gives about
**265–310 MiB aggregate application heap**, depending on the separate storage fix.
That is a projection, not a new 50-group acceptance receipt or a per-group gate
proof. This PR does not enable that storage fix or change queue admission.

The worker probe runs the actual worker module behind a synthetic main-isolate
port so it can collect between requests. Eligibility compaction differs from
production worker threads. GC heap, backing allocations and RSS are different
measures; neither this small sample nor its projection establishes hosted RSS,
all-group hot latency or the application's acceptance gates.
This evaluate/Why probe does not measure large owned-dictionary prediction
preparation. Prepared prediction state adds its actual heap or wire charge to
the same unchanged hot-set, picker and worker ceilings.

## Verification

Initial optimization validation passed 103 tests in 11 targeted files: serialized snapshot accounting/aliasing,
100 retained-versus-zero-budget request pairs across deterministic edits,
resident-planning cancellation and GC/demotion, worker cache ownership/budgets,
calculation equivalence, Q2 comparator, worker timings, eligibility, planning and
the 20,560-task Why/How integration. No full suite, retries or acceptance dispatch.
GC proves the deliberate hot baseline is retained, then collectible after
demotion, while its planning bytes remain reusable.

The follow-up's expanded module/caller inventory, complete file list, outcomes,
main-source control failure and configuration-only interrupted extra are recorded
in [the validation report](calculation-retention-validation.md). No original
prediction-output assertion was changed. The owned-dictionary and preserved-token
regressions have deterministic coverage.

The pre-existing `unlock-calc.mjs` assertion compares raw
`projectPlayResult(full.result)` with a worker projection that also contains
`taskLocations`; unchanged main therefore fails before timings are written.
It is not fixed here. Worker instrumentation and scheduler y06 trace anchors
remain unchanged.
