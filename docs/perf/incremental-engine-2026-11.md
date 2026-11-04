# Incremental engine: November 2026 design and baseline

START `ddc88da9f40a6466bb081dd4f4b3cc988fd16596`.

**Phase 1: PARTIAL — evidence only.** Application code was unchanged at that
stage. The Phase 1 measurements below remain the original baseline. The
[Phase 2 follow-up](#phase-2-final-projection) records the opt-in implementation
and its separate before/after populations. Diagnostic probes never supply
calculator results.

**Phase 2: SHIP the opt-in projection slice.** Cold Preview engine time improves
13.7% against the explicit Phase 2 reference control; both correctness gates
report zero differences. The reference remains the default. The shadow stays
unwired; full distributions, historical-baseline comparison and risks follow
in the Phase 2 section.

## Measurement boundary

Linux x86-64, Node 24.21.0, process calculators, a 4-CPU quota and 16 GiB memory
limit. This is not the production 6-vCPU/11-GiB VPS. Real-pack calculators run
sequentially. Every timing population has five fresh parent processes, each with
a fresh process calculator. Diagnostic profiles are separate one-run populations.
An idle sample follows two seconds without a request, without forced GC.

The save is copied into `/tmp` before use. The harnesses read JSON and static
references through the filesystem, verify checksums and validate/import the state,
then send states to ordinary calculator workers. No server, normal store, token,
invitation or key is created on that copy. No backup is opened through storage.
Only numeric metadata, hashes and public source symbols are retained in evidence.

Cold Preview means the first prediction after a cold roll-pool request, with no
previous list evaluation. Repeat means the same candidate in the same calculator;
it includes partner projections and reuse bytes. Neither request wall includes
startup or the preceding pool request. The combined cold path reports their
per-run sum separately. Engine timing is nested within wall timing;
`predictionMs` overlaps owner engine work and must not be added to `engineMs`.

The mixed harness evaluates both initial lists, pools and a prediction before
accepting one offered roll through the ordinary pure command. Its refresh keeps
the worker's existing eligibility caches but bypasses scheduler reuse. This is
not a refresh after an unpreviewed roll or a durable-storage/browser measurement.
Player 1's independently cold list is measured separately: a list after player
0 benefits from already compiled variants. The wake harness separately measures
a replacement calculator after retiring its seed and retaining the catalogue.
Full-result transport costs differ from compact list transport costs.

All timing cells are seconds, median [min–max], **n = 5**. After is unmeasured because no runtime candidate is implemented. Raw numeric evidence: [JSON](incremental-engine-2026-11.json).

| Workload | Baseline wall | Baseline engineMs / 1000 | After |
| --- | ---: | ---: | --- |
| Cold Preview | 9.029 [9.018–9.942] | 6.497 [6.240–6.879] | — |
| Repeat Preview | 1.292 [1.262–1.392] | 0.461 [0.377–0.491] | — |
| First compact list, player 0 | 6.000 [5.288–6.213] | 4.973 [4.455–5.179] | — |
| First compact list, player 1 after player 0 | 2.144 [2.050–2.316] | 1.546 [1.478–1.634] | — |
| First compact list, player 1 independently cold | 3.805 [3.441–3.978] | 2.705 [2.529–2.809] | — |
| Post-accept refresh, player 0 | 1.773 [1.601–2.290] | 0.181 [0.170–0.279] | — |
| Post-accept refresh, player 1 | 0.731 [0.717–0.805] | 0.205 [0.189–0.212] | — |
| Post-accept refresh, both jobs | 2.504 [2.319–3.057] | 0.392 [0.360–0.473] | — |
| Cold roll pool | 3.927 [3.711–4.241] | Not separately timed | — |
| Startup + pool + cold Preview | 14.990 [14.710–16.422] | Not separately timed | — |

The cold-pool row must not be interpreted as zero engine work: its transport baseline is timed under `rollPoolMs`. Replacement wake readiness is 2.175 [2.135–2.437] s; seed readiness is 3.907 [3.829–4.055] s. These wake figures are a separate harness population, not the cold Preview startup figure.

| Workload | Worker peak MiB | Worker idle MiB | Parent peak MiB | Parent idle MiB |
| --- | ---: | ---: | ---: | ---: |
| preview | 1548.1 [1540.2–1552.8] | 1528.9 [1521.1–1533.8] | 1053.2 [1013.5–1058.6] | 1003.5 [907.0–1009.1] |
| wake | 1574.9 [1553.5–1595.2] | 1349.5 [1330.6–1370.1] | 1005.3 [1004.4–1016.9] | 910.1 [909.1–921.7] |

Peak is Linux VmHWM for Preview and 25-ms RSS sampling for wake. Mixed-workload worker VmHWM is 1751.7 [1580.3–1820.5] MiB; its incomplete idle population is excluded. Harness parent RSS includes parsed definitions, input state and returned results/catalogues; these are not service-wide capacity forecasts. Extra production cache memory: **0 bytes**. No after-RSS or incremental-memory measurement is claimed.

### Diagnostic phase partition

One inspector/phase run per case; these times are not the five-run benchmark population. The table partitions worker engineMs using depth-0 evaluation rows plus compile time. Setup includes nested transport-disabled baseline evaluations; the nested detail below must not be added to the table. `Other` includes fact projection, cache serialization/deserialization, completion overlay, engine envelope overhead and processing coordination.

| Case | Engine total ms | Compile | Prepare | Pass setup | Fixed point | Processing selection | Final projection | Other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold full list | 5429.2 | 736.6 | 643.8 | 2320.8 | 192.6 | 64.0 | 1301.1 | 170.3 |
| Cold Preview | 7397.9 | 0.0 | 0.0 | 2613.6 | 754.2 | 180.6 | 3404.1 | 445.4 |
| Accepted refresh 0 | 186.8 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 186.8 |
| Accepted refresh 1 | 199.9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 199.9 |
| Repeat Preview | 452.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 452.5 |

In the cold full-list run, setup contains a nested 1775.4-ms baseline, including 1377.5 ms of final projection. Cold Preview contains four evaluations: three top-level and one nested 1523.0-ms transport baseline. Across its non-overlapping final projections, 4610.8 ms is spent rebuilding public rows, sources, obligations and equipment; fixed-point loops total 936.3 ms and processing selection 219.3 ms. This includes the nested baseline already charged to setup above. Both accepted refreshes and both repeat-Preview engine calls hit exact eligibility caches, with zero pass replays. All diagnostic requests recorded zero dropped evaluation rows.

The cold Preview CPU samples attribute 1216.7 ms of self time to obligation-cache `evaluate`, 303.2 ms to `mask`, 735.8 ms to `check`, 771.8 ms to GC and 537.2 ms to V8 serialization. These are samples over the entire prediction job, not exclusive engine-phase measurements. Instrumented source line numbers can differ from the original; full public function/module labels are retained in JSON.

A design that only skips capability discovery still rebuilds roughly 4.61 s of final projection in this diagnostic case. Reusing half of that work would budget 2.31 s before dependency-validation/copy overhead; the reusable fraction has **not** been measured. Source/access memoization can target the remaining setup/closure work, but those envelopes are not entirely source collection. First-list and exact-cache-hit savings cannot be inferred from a cold-candidate result.


## Where work is already reused

Source map: [engine](../../app/tasks/engine.mjs),
[access](../../app/tasks/access.mjs),
[processing](../../app/tasks/processing.mjs),
[prediction](../../app/core/planning.mjs),
[eligibility cache](../../app/tasks/eligibility-cache.mjs) and
[automatic transport](../../app/core/automatic-transport.mjs).

- `engine.mjs:createTaskEngine` keeps rule variants, compiled task records,
  identities, alias expansions, producer relationships and capability seeds.
  `prepareEvaluation` prepares each selected variant once. A revision does not
  recreate these structures. A first evaluation can still compile a variant
  that readiness did not select.
- `buildAccessIndex` keeps geography, reverse edges, aliases and resource
  catalogues. Compatible variants share an index only when all relevant
  definition branches have matching identity and environment.
- `eligibility-cache.mjs:eligibilityInputKey` already reuses exact capability
  inputs across revisions and overlays challenge satisfaction afterwards.
  Its travel fingerprint deliberately includes completion, backlogs, aliases,
  personal controls, source overrides, member order and shared member facts.
  A revision number alone is not an invalidation reason.
- `automatic-transport.mjs:baselineFor` shares the configured compiled engine
  and retains two exact input signatures. A hypothetical signature cannot
  borrow another candidate's supplies. These transport-disabled evaluations
  also occur inside roll-pool computation, outside worker `engineMs` accounting.
- `computeEligibility` retains immutable access, base-source, membership,
  table-expansion and publication memo data **inside one evaluation**. It resumes
  its generator only for monotone processing growth, then performs a fresh
  final pass. Retraction, mode changes or unstable closure restart discovery.
- Worker snapshots and unlock reuse already save exact complete results and
  projections. Refresh following Preview therefore has less remaining engine
  work than a cold candidate. Replacing those hits with delta evaluation can
  be slower than keeping them.

## What a chunk can affect, and exact dependency boundaries

`planning.mjs:predictionFromBaseline` copies the member, adds the unlocked base,
removes it from selected/blacklisted entries, and handles pending-roll and initial
section choices. Other members and definition data are initially unchanged.
Engine capability fingerprints omit pool-only selected/blacklist choices; the
pool still needs its own rule inputs. Do not reuse a pool under an engine-only key.
An accepted command also changes revision/history and can change those choices.
Compare relevant facts, not object identity or revision arithmetic.

| Fact family | Exact references available in the implementation | Required propagation |
| --- | --- | --- |
| Location/area access | `buildAccessIndex` nodes, aliases, reverse gated edges, base/section topology, resource and retained compatibility mappings; `taskUnlocks` source/location gates | Base ownership → entered sections/components → area gates, sources and partner connectivity. Gate-task changes can revisit old edges. |
| Literal task prerequisites | Compiled `requirements`, `dependencies`, `completedDependencies`, personal alternatives, source-location clauses and alias counts | Both positive and negative reads; each distinct alternative and count; personal completion remains separate from ordinary eligibility. |
| Item/source availability | `producers`, `outputGates`, expanded `skillItems`/drop-table leaves, shop stock, spawns and item/source task gates in `access.mjs` | Source → item → consumers and producer obligations; preserve location, quantity/rate, membership, ownership, primary/multi mode and ordered provenance. |
| Skill reachability | `Primary`, skill needs, observed/passive/cap overrides, boosts, XP rewards and allocations | One new training method can change every consumer of that skill. Aggregate point/total-level gates also propagate. |
| Processing selection | `processing.mjs` root ingredients, category/input groups, effective levels, duplicates, per-skill frontiers and promotion prerequisites | Dirty the whole competing group, its frontier and downstream outputs. An extra source can retract a recipe. |
| Travel and sharing | Transport route/fare/activation requirements, transport-disabled baselines, partner connections and source ownership | Dirty every affected member, including an unchanged partner's proof; preserve travel's independent baseline to prevent self-support. |
| Other global gates | Boss gear/observations, Slayer releases, rule switches, membership, source backlogs, set winners, presentation policies | Explicit typed global dependencies or full fallback. A local chunk filter cannot cover these implicitly. |

The existing access read trace (`sameTaskReads`, `memoAccess`) records task
membership reads and observes whole ordered-set iteration. Its key omits many
state facts because replay is confined to one evaluation. Persisting that trace
unchanged across states would be incorrect. `obligation-cache.mjs` footprints
protect recursive visiting-path intersections; they do **not** certify unchanged
spatial access, item ownership or source policies. That cache is deliberately
cleared on source/ownership/primary changes and fixed-point iterations.

A complete dependency graph must be built from expanded references and explicit
handler reads, rather than geographic distance or text matching. A typed reader
must record failed `has`/lookup calls as well as successful ones. Iteration,
`size`, ordered source lists and aggregate skill/point/frontier reads require
whole-container or aggregate version tokens. Reverse edges must include
competing producers and gates on supply tables, not just task `Chunks` fields.
Unknown aliases, duplicate task keys, unclassified handler reads, opaque callbacks
or incomplete graph construction invalidate the affected capsule and force full
evaluation. Unsupported tasks retain their existing semantics; no graph guess
may make them available.

## Options and expected savings

These are engineering budgets, not measured speedups. First-list misses have no
base result to seed. Warm repeat/refresh savings are bounded by their measured
remaining engine time; their presentation/collection/transport work remains.

| Option | Cold Preview / different candidate | First list | Accepted refresh / repeat | Memory and risk |
| --- | --- | --- | --- | --- |
| Reuse the compiled engine across revisions | Already implemented; no additional saving from merely retaining it | Deferred variant preparation remains cold work | Already implemented | No new memory; cannot explain the remaining waits. Prepared worker startup would be a separate lifecycle change. |
| Seed the fixed point from base eligibility and append new facts | Could remove discovery work in a truly monotone subgraph; fresh final projection still required | No seed, essentially zero saving | Existing exact hits are preferable | Retains a large capability graph. Unsafe without retraction/support tracking: new sources can remove old admissions or change their order/provenance. Reject this slice as currently specified. |
| Memoised source/location contributions with dependency validation, then full ordered closure/projection | Lower-risk first implementation; can save unchanged access/base-source collection. It does not eliminate task scans or all transport baselines | Compiled static tables may help, but no measured budget is claimed | Usually little advantage over exact caches | Bound immutable contribution buffers and dirty tokens; clone mutable source records. Requires exact negative gate reads, whole-container tokens and source order preservation. |
| Complete dependency graph with dirty marking and retraction | Largest potential: avoid unaffected capability checks/discovery for owner and partner; always rebuild canonical final explanations initially | Must build graph; may be neutral or slower on a cold list | Useful on an uncached accepted state, not automatically on existing cache hits | Highest implementation/proof cost. Track SCCs, competing recipe groups, global aggregates and dependency completeness; otherwise fall back. |

The best next *implementation experiment* is dependency-validated immutable
source/access contributions, retaining the existing fixed-point and final
projection. First build a shadow read graph and measure hit rate and size.
This task does not promote it to a runtime path: the current traces are not a
complete cross-state dependency contract. The broader dirty evaluator should
follow only if that experiment demonstrates sufficient coverage and savings.

## Memory and invalidation design

Proposed admission ceiling: **256 MiB extra per calculator**, shared across all
pickers/members and variants, below the approximate 300-MiB budget. For example,
64 MiB static dependency arrays, 128 MiB total base/contribution buffers and
64 MiB dirty/support data. These are ceilings, not measured object-size estimates.
Use charged backing buffers/typed arrays and an entry cap, not an unbounded map
of full JS result/replay graphs. Include keys, metadata and retained references in
accounting; do not assume serialized size equals heap/RSS. Decline admission when
the bound cannot be established, and measure both temporary peak and idle RSS.
No extra production memory is introduced by this evidence-only change.

Keep at most one base capsule per player and a global LRU/byte ceiling. The key
must include dataset digest, compiled variant/definition identity, picker/member
identity, projected relevant state and evaluation options. Changing dataset,
roster, member identity or variant drops the capsule. Mutable injected definitions
need a verified frozen/versioned projection; object identity alone cannot attest
that their dependency graph is unchanged, so otherwise decline admission. A changed member input
replaces the previous base only after a complete evaluation; candidate branches
must never overwrite their base. Removal, blacklist/pool changes, source/task
backlogs, rule changes and ambiguous deltas initially take the full path and
replace/drop stale state as appropriate. Repeated byte-identical capability
inputs continue to prefer the existing exact cache.

Missing dependency/schema coverage, a mismatched digest, a truncated graph,
an exceeded memory/iteration budget or uncertain ordering must discard staged
work and run the ordinary full evaluation. No partially evaluated rows may
escape. `RS3_INCREMENTAL_ENGINE=0` must force the full reference path in a future
implementation; rollout should default to reference in accordance with the lane
gate. The switch is not added here because there is no incremental runtime path.

Publish capsules atomically after successful completion; cancellation/termination
loses only speculative in-memory work. Do not persist private state or hold new
native compression handles. Worker termination must remain safe between any two
instructions. App-level cache lifecycle changes would need a small named worker
hook, not scheduler/server rewrites; none is made in this task.

## Identity proof required before Phase 2 can ship

1. Q2 must compare START with the candidate across its synthetic corpus and full
   selected fixture harvest, preserving existing canonicalization and floors.
   Public gameplay counters remain significant: reducing physical checks must
   not silently change their observable logical accounting or weaken the gate.
2. A separate self-check mode must compute incremental and forced-full results
   on the exact same state/options, canonicalize through the existing comparator,
   and compare the complete result, pools, owner/partner predictions and reuse
   projections. How/Why evidence and order are part of the comparison; equal
   available task IDs alone are insufficient. On mismatch, discard the candidate
   capsule, return the full result and fail the campaign with counts/hashes only.
   Do not add new volatile exclusions.
3. Enumerate every pool candidate for every member, then several multi-step
   accepted-roll sequences. Rebuild pools each step, include additions/removals,
   and report only candidate/sequence/result counts, hashes and differences.
   Run private states through validated filesystem readers and ordinary workers
   only. Use sequential calculators or explicitly admit enough memory.
4. Synthetic tests must cover skill/item sources, area gates, quest steps,
   circular competing recipes, absent alternatives becoming present, partner
   propagation, source-order changes, removals/backlogs/blacklists, dataset and
   member changes, options, force-off, fallback and eviction/invalidation.
5. Demonstrate five fresh before/after runs for every requested workload, plus
   retained/temporary peak and idle RSS. Self-check/inspector runs stay outside
   timing populations. Keep the switch off unless all correctness gates pass.

No incremental implementation exists here, so the all-candidate/sequences
self-check, fallback/invalidation tests and before/after saving are **outstanding**.
The preload comparison below validates diagnostics, not incremental correctness.

## Reproduction and validation

Set the ordinary dataset/pack/defaults selectors externally and point
`RS3_IE1_DATA_DIR` at a copied save inside `/tmp/perfwalk/`. The wake reader
requires that scratch-directory segment. Use a clean output directory each time.
Run sequentially; the original `engine-profile.mjs` CLI is not used because its
main-thread path starts a server. Its isolate-only inspector preload is reused.

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/hotspots-engine.mjs --data-dir "$RS3_IE1_DATA_DIR" --out /tmp/ie1-mixed --runs 5
node scripts/perf/preview-engine.mjs --data-dir "$RS3_IE1_DATA_DIR" --output /tmp/ie1-preview.json --runs 5
node scripts/perf/worker-wake.mjs --data-dir "$RS3_IE1_DATA_DIR" --output /tmp/ie1-wake.json --runs 5 --omit-ready
node scripts/perf/hotspots-engine.mjs --data-dir "$RS3_IE1_DATA_DIR" --out /tmp/ie1-member-1 --runs 5 --fresh-member 1
node scripts/perf/hotspots-engine.mjs --data-dir "$RS3_IE1_DATA_DIR" --out /tmp/ie1-profile-full --runs 1 --profile --phases --result-hashes
node scripts/perf/hotspots-engine.mjs --data-dir "$RS3_IE1_DATA_DIR" --out /tmp/ie1-profile-preview --runs 1 --profile --phases --fresh-preview --result-hashes
```

The mixed baseline keeps the harness's ordinary coarse trace spans; it does not
use inspector sampling or the new source transform. `--phases` loads a
calculator-isolate diagnostic probe. It times compile, preparation, pass setup,
fixed-point loops, processing selection and final projection, records evaluation
depth/cache hits and caps output at 64 evaluation rows per reply. Suspended
generator time is excluded. How replay outside `evaluate` is intentionally not
partitioned; its ordinary results are still compared. The recorder retains only timing, numeric counters and cache metadata. Missing/ambiguous source anchors refuse the profile.

- Focused profiler, test-selection and selection-contract tests: **13 passed,
  0 failed**. This includes a synthetic worker preload comparison for evaluate,
  prediction/reuse and How, plus timing/exception/bounds/anchor checks.
- Ordinary versus instrumented real-input calculator responses: **28 hash pairs,
  0 differences** across the mixed workload, including projections, pools,
  prediction reuse, refresh, How, planning, sandbox, area check and estimates.
  Aggregate canonical hash on both sides:
  `13922de2040d1fc08c888a133bd25fe1ee0e416ce9c84629bbabe596cd8045ef`.
  Existing canonical exclusions are unchanged. This control uses one candidate;
  it is not the future exhaustive incremental self-check.
- Public Q2 START versus START plus candidate patch: **1548/1548 pairs,
  0 differences**, 1247 successful result pairs and 301 matching negative-case
  pairs. Twelve synthetic cases and the full selected fixture harvest (30 tests,
  30 passed, 0 failed); successful coverage of all nine operations. Supervisor
  wall **116.998 s**, sampled process-group peak **1282.8 MiB**.
  Candidate patch SHA-256:
  `e1143123a38524761173447a620f9290323cd9bdc8e0ba8d7539872ed4ecb2c0`.
  Corpus SHA-256:
  `b4badf3dc8a0082bcef4108c314d34af24ad22fa1513484f31c03bebfb9f43b5`.
  All executable changes were included; subsequent report/evidence edits are
  documentation only. Application code is unchanged, so this is regression
  coverage of tooling changes, not proof of an incremental implementation.
- `npm run test:quick`, once: **3607 passed, 0 failed, 68 skipped**
  (3675 cases, 448.972 s). No test was weakened or skipped to obtain this result.
- Private audit: **542 files, 0 differences**; copied save **431 files,
  0 differences, 0 credential artifacts**. Full audit hashes are in JSON.
- No full `npm test`, no server/store on the private copy, no GitHub/network
  operation, no edits to app code or shared scheduler/worker/server hot spots.

Remaining risks are the unimplemented dependency completeness/retraction model,
unknown dirty fraction, final-explanation reuse, logical counter accounting and
unmeasured extra RSS. The source-anchored phase probe needs maintenance when the
engine changes; its test fails rather than silently profiling a different phase.


Recommendation: **NEEDS-WORK** for IE1 implementation. **PARTIAL**.

## Phase 2: final projection

This follow-up optimizes the existing evaluator without adding a dirty-marking
execution path. `RS3_FINAL_PROJECTION=1` opts in; **the default is the reference
path**, as required by the engine lane. `RS3_FINAL_PROJECTION=0` forces the
reference even if an injected engine requests `projectionFast: true`. Activation
for production is a separate release decision. Phase 2 numeric evidence is in
[incremental-engine-phase2-2026-11.json](incremental-engine-phase2-2026-11.json).

### What final projection actually spends

Separate inspector runs instrument the final projection window and the builders
inside it. Builder timings include probe overhead and are diagnostic, not the
five-run latency population. A cold Preview projects four evaluations; the first
full list projects two, including the transport baseline. Values below sum those
windows, in milliseconds.

| Builder | Cold Preview before | After | Cold full list before | After |
| --- | ---: | ---: | ---: | ---: |
| Obligation proofs | 2947.47 | 1876.85 | 1855.72 | 1300.84 |
| Check/blockers | 593.60 | 508.07 | 366.98 | 348.92 |
| Public source arrays | 101.83 | 91.57 | 45.86 | 46.22 |
| Source policies | 64.31 | 56.82 | 28.61 | 28.98 |
| Partner evidence | 111.75 | 77.80 | 39.72 | 45.67 |
| Row construction | 337.39 | 282.72 | 188.03 | 165.74 |
| Rewards and explanation evidence | 100.27 | 51.89 | 46.46 | 24.12 |
| Primary projection | 108.91 | 62.64 | 32.74 | 33.90 |
| Equipment/storage | 10.26 | 8.04 | 4.54 | 5.48 |
| Processing/serialization context | 92.71 | 89.16 | 71.37 | 42.49 |
| Unknown-drop warnings | 678.61 | 630.29 | 534.87 | 338.65 |

The obligation cache originally applies the generic recursive footprint machinery
to literal spatial predicates, repeatedly hashing visiting paths. A 4096-entry
FIFO also churns during a 20436-row catalogue projection. Boolean own-item
obligations eagerly build all producer descriptors before a matcher can accept a
witness. Zero-reward rows spread the entire row just to test for finite rewards.
These operations explain more time than equipment or public source projection.

Projection-only CPU samples support that diagnosis: generic obligation-cache
`evaluate` fell from 1113.14 to 148.31 ms, `mask` from 519.23 to 214.51 ms, while
the new literal cache accounts for 279.33 ms. Projection GC samples fell from
561.30 to 377.32 ms. These are sampled CPU attribution, not additive wall phases.

The existing exact eligibility cache already reuses an identical nested
transport-baseline projection. Different owner, territory or task-input
signatures are genuinely different inputs; a revision-only cache would be
incorrect. This change accelerates each required projection rather than adding
another cross-revision cache. The same implementation serves nested baselines.

Serialization remains material. During the request, the explicit `node:v8`
serializer is `retainResult` in `eligibility-cache.mjs`, which retains a private
proof for later evaluation/How; the worker's explicit V8 serialization is only
at ready/catalogue time. Thus the roughly 532 ms sample is not evidence that
omitting a worker reply field would remove that cost. Existing worker transports
already send immutable JSON buffers; omitting fields or interning public mutable rows would require a
separate protocol/aliasing proof. No field, evidence array, worker message, How or
Why output is removed. No scheduler, worker, server or renderer code changes.
The small prediction JSON body is 17306 bytes in both diagnostic runs; it does
not represent the much larger prepared owner/partner payloads.

### Safe implementation and bounds

`app/tasks/engine.mjs` makes four opt-in changes:

- Literal spatial/clue obligations use a dedicated cache entry whose only
  path-dependent read is its own task key. The engine selects this path only
  when `computeObligation` returns before recursive item/dependency branches.
- The existing pass-local obligation cache retains at most
  `max(4096, min(catalogue.length, 32768))` entries. Clear points are unchanged.
- Root calls allocate a visiting Set only after checking an established positive
  proof. Boolean producer matching yields descriptors in catalogue order and
  stops only after all independent source constraints have witnesses. Public
  source arrays still contain every source.
- Finite-reward projection skips absent rewards and supplies only the three
  fields its pure projector reads, avoiding a full row spread.

`app/tasks/obligation-cache.mjs` adds `evaluateLeaf`. It propagates the task-key
read into any enclosing recursive footprint, checks the exact visiting Set
before a hit, and never publishes a guarded result. Generic recursive tasks use
the unchanged cache algorithm; hash collisions only reject reuse. Missing or
ambiguous recursive structure takes that generic path. No dependency graph or
new dataset-spanning cache is consulted, so an unrelated dataset cannot supply
an entry. All entries belong to one evaluation pass and disappear when it ends;
state changes, removals, backlogs, roster changes and new datasets retain the
existing invalidation boundary. The separate key-mask map remains capped at
32768 entries. No native compression handles or lifecycle resources are added.

### Five fresh runs, reference versus opt-in

Same Linux/Node/process-worker boundary as Phase 1, with sequential real
calculators and no profiling during timing runs. The reference cohort explicitly
sets the switch to 0; the candidate sets it to 1. Neither cohort is the older
Phase 1 population. Before source hashes precede the literal-cache refinement;
the disabled branch still runs the reference algorithm. Released-pack dataset
and input hashes match across both cohorts. All 28 mixed-workload result-hash
sets, including sampled How and Why, match across all ten runs. Q2 separately
uses its existing source attestation for code-bound synthetic datasets; no
comparator, volatile-field rule or coverage floor changes. The private
forced-reference check compares the same sources with the switch off and on.

Seconds, median [min–max], n = 5 per cell. Wall excludes startup and the preceding
pool request. Engine time is nested in wall time. Refresh retains Preview reuse
as in Phase 1 and is not an unpreviewed refresh.

| Workload | Wall before | Wall after | Engine before | Engine after |
| --- | ---: | ---: | ---: | ---: |
| Cold Preview | 10.081 [9.460–11.943] | 8.746 [8.378–9.591] | 7.102 [6.678–8.483] | 6.131 [5.860–6.489] |
| Repeat Preview | 1.334 [1.295–1.405] | 1.411 [1.316–1.523] | 0.460 [0.420–0.485] | 0.484 [0.469–0.504] |
| First list, player 0 | 5.587 [5.258–10.433] | 5.375 [4.864–5.414] | 4.571 [4.301–6.438] | 4.420 [3.875–4.477] |
| First list, player 1 after player 0 | 1.819 [1.773–5.000] | 2.069 [1.759–2.111] | 1.384 [1.350–4.406] | 1.385 [1.329–1.401] |
| First list, player 1 independently cold | 3.809 [3.555–6.762] | 3.599 [3.412–11.157] | 2.673 [2.606–5.735] | 2.546 [2.521–8.968] |
| Post-accept refresh, player 0 | 1.983 [1.819–2.006] | 1.866 [1.720–2.049] | 0.282 [0.188–0.329] | 0.347 [0.194–0.378] |
| Post-accept refresh, player 1 | 1.098 [0.774–3.179] | 0.760 [0.746–1.280] | 0.214 [0.203–0.258] | 0.203 [0.202–0.221] |
| Post-accept refresh, both (per-run sum) | 3.094 [2.641–5.162] | 2.810 [2.466–3.146] | 0.486 [0.446–0.552] | 0.549 [0.397–0.580] |
| Cold roll pool before any list | 4.083 [3.927–5.078] | 3.799 [3.604–3.832] | 0 | 0 |
| Pool after lists, player 0 | 0.596 [0.541–0.661] | 0.565 [0.522–0.584] | 0 | 0 |
| Pool after lists, player 1 | 1.234 [1.193–1.721] | 1.296 [1.186–1.449] | 0 | 0 |

The per-run sum of cold pool plus Preview is 14.388 [13.469–15.996] s
before and 12.577 [12.072–13.405] s after. Including calculator startup,
those sums are 16.636 [15.565–18.091] and 14.656 [14.092–15.583] s.
Startup alone is 2.096 [2.037–2.248] versus 2.079 [2.020–2.178] s.
Parent dataset loading before calculator creation is outside these sums.

Roll-pool work has its own timing path and reports zero `engineMs`; that does not
mean the pool is free. Cold Preview engine improves 13.7%, wall 13.3%. List gains
are modest. Repeat Preview wall regresses 5.7%, and the second shared list 13.8%;
this slice does not improve already reused results. Refresh engine medians also
do not improve in aggregate. The independent second-list after population has
an outlier; it is retained. Five unpaired runs with these spreads cannot prove
an improvement for every workload or extrapolate a production VPS latency. The
historical untouched-START Phase 1 Preview median was 6.497 s engine / 9.029 s
wall, lower than this Phase 2 forced-reference cohort; the candidate medians are
5.6% / 3.1% below that historical population. Those are separate populations,
not additional paired samples. The 13.7% / 13.3% figures use the explicitly
reported Phase 2 control, and should not be read as a production promise.

### Memory

MiB, median [min–max], n = 5. Peak is Linux VmHWM; idle is RSS after two seconds
without a request and without forced GC. Mixed runs include full-result hashes,
How, Why, planning and other operations, so they exceed the smaller Preview
population and the historical Phase 1 workload.

| Calculator population | Peak before | Peak after | Idle before | Idle after |
| --- | ---: | ---: | ---: | ---: |
| Cold/repeat Preview | 1536.83 [1531.69–1570.68] | 1614.46 [1599.42–1624.16] | 1517.81 [1512.68–1551.64] | 1595.48 [1580.46–1605.07] |
| Mixed | 2344.84 [1894.06–2607.16] | 2528.52 [2443.36–2727.45] | 2192.66 [1887.65–2411.22] | 2358.70 [2279.96–2523.36] |
| Independent player 1 list | 953.04 [949.00–1065.80] | 988.14 [917.98–1026.09] | 945.63 [897.03–954.58] | 944.23 [901.72–962.68] |

Median calculator increases are 77.63 MiB Preview peak and 183.68 MiB mixed peak;
idle increases are 77.67 and 166.04 MiB. The mixed maxima differ by 120.29 MiB.
These cohort comparisons are under 300 MiB, not per-run paired guarantees.
Allocator/GC behavior contributes to RSS; the actual new cache is a bounded Map,
not a retained result graph. Parent peak/idle values are also retained in JSON;
mixed parent median peak changes 1235.25 to 1237.21 MiB, idle 1174.62 to 1172.40.

Whole-request CPU attribution also shows the limit of this slice: sampled V8
serialization is 531.83 ms before and 557.19 ms after; whole-request GC is
935.93 and 1027.70 ms even though GC inside projection falls. These one-run
samples do not establish a whole-request GC improvement. Across prepared and
final messages, owner reuse is deliberately published early and remains in the
final reply for ordinary clients. The process transport already deduplicates
aliased shared buffers within each message. Changing publication across messages
needs a protocol-level contract; this slice leaves it intact.

### Correctness and reproduction

Q2 compares untouched START with a candidate exported from START plus the full
working-tree patch. Since the application defaults to reference and Q2 forbids
inherited experimental environment flags, the **owned Q2 candidate patch only**
changes the new default expression from `=== '1'` to `!== '0'`. This one-line
activation is recorded with patch and source hashes in the JSON evidence. The
working tree still defaults to reference. Input materialization, the comparator,
volatile-field exclusions and successful-operation coverage floors are unchanged.
The full harvest is used, not a selected subset.

Q2 completed **1548/1548 pairs, zero differences, zero errors**: 1247 successful
result pairs and 301 matching negative pairs; 174 synthetic and 1374 harvest
requests. All 30 harvest tests passed. The successful requests cover all nine
required operations.

The initial projection/cache/profile and related tests passed **54/54**, zero
failures or skips. The initial `npm run test:quick` passed **3614**, failed
**0**, skipped **68** (3682 total). No full `npm test` was run. The later command-history regression raised the focused set to 55/55. Synthetic
tests cover chunk/skill/item sources, area and quest gates, removal/blacklist/backlog,
roster/shared-access changes, changed definitions, large producer catalogues,
independent source-policy witnesses, cycles, forced footprint collisions, entry
bounds, explicit cache clears, result-mutation isolation, cold uncached reference
parity and the forced-off switch. The copied-save reader rejects invalid
checksums and escaping static references without opening storage. New tests are
classified in `scripts/test-selection.mjs`; no renderer imports or `c.*` fields
are introduced.

Calculator-only commands, after configuring the released dataset and copying the
save to `/tmp`, are:

```sh
RS3_FINAL_PROJECTION=0 node scripts/perf/preview-engine.mjs --data-dir /tmp/ie1/game --output /tmp/ie1/before.json --runs 5
RS3_FINAL_PROJECTION=1 node scripts/perf/preview-engine.mjs --data-dir /tmp/ie1/game --output /tmp/ie1/after.json --runs 5
node scripts/perf/final-projection-check.mjs --data-dir /tmp/ie1/game --out /tmp/ie1/check.json
RS3_FINAL_PROJECTION=1 node --test tests/final-projection.test.mjs tests/obligation-cache.test.mjs
npm run test:quick
```

Every shell must select Node 24.20+ first. The check runs ordinary process
calculators with flags 0 and 1, canonicalizing complete responses,
prepared reuse bytes and sampled How/Why. It reports only counts/hashes. Its
sequence clock is deterministic, offers and accepts use the real pure commands,
and each independent sequence has a fresh picker scope. Prediction requests use the worker's supported ordinary-state
transport when switching snapshots. An initial harness attempt used the wrong
transport and was discarded. A second attempt hand-edited offers between
commands; validation correctly rejected stale Undo history. The real command
sequence now has a synthetic regression test. Neither failed attempt is counted
as correctness evidence. Sequences run before the exhaustive candidate sweep
to expose command-harness errors early. The default runs one calculator at a
time. Optional `--parallel` admits two verification calculators only after
checking both Linux available memory and cgroup spare memory against 10 GiB;
timing populations never use that mode.

The completed private self-check has **809 matching canonical pairs, zero
differences**, spanning all **37 candidates** across **2 members** (pool counts
**7, 30**), **3 sequences / 9 accepted rolls per path**, **527 worker responses**,
**282 How** and **282 Why** checks per path. Complete owner/partner prepared reuse
payloads and full-list transports are decoded before hashing. Why/How subjects
are sampled at three visible-row indices per inspected member, not every row's
possible How query. The aggregate hashes are identical:

`edc980b91e47f84fcb2d3c05a63b6bea4b6b30ed47493c4132d96b93d78f949e`

This verification used the memory-admitted parallel option; latency and RSS
populations above remained sequential. The application source hashes are the
same ones used for the candidate measurements and Q2.

### B: source/access read graph, measurement only

This work began after A's exhaustive identity check passed. No application module
imports the graph, and no runtime result comes from it. An explicit calculator
preload instruments ordinary full computations in memory. Production engine,
access, scheduler, worker and server files have no shadow hooks.

The recorder in `scripts/perf/source-access-shadow.mjs` observes only actual
computations that miss the existing per-evaluation source/access memo. It records:

- Whole raw-access contributions scoped to the dataset digest and compiled index
  identity, keyed by the existing exact `eligibilityInputKey`, the existing raw
  access options key and resolved rules. Both positive/negative task reads and
  any ordered whole-task-Set read are validated.
- Whole base-source collections keyed by `baseItemSourceView` and resolved rules,
  plus their task-read footprints. The view includes hidden per-location spawn
  quantities with their original type tags. The full result hash includes item
  and source iteration order and diagnostics.
- Finer source contributions keyed by the data's typed source references. Spawn
  roots use item/location/quantity cells; monster and object roots use their
  referenced locations. Shop roots include normal stock locations and the exact
  declared task-stock selectors and location-admission bits. Complete rules and
  backlogs and the completed task-footprint hash are computed once per collection. Every root conservatively retains the
  whole collector's positive/negative task footprint, rather than guessing which
  gates belong to which source. Newly admitted source events are hashed in their
  original per-root emission order, including empty contributions.

Every observation still computes the full value and compares its hash against
any predicted hit. No value is read back from the trace. The LRU keeps one dependency-footprint
version per input key; differing capability stages can replace one another.
Together with the intentionally broad root footprint, this makes fine-source
hit rates conservative for this policy, not a ceiling on a future local-gate
graph. Unknown scopes or
inconsistent dependency information decline a hit. A changed digest/compiled
identity, location, quantity, rule, backlog, task-read value or required Set order
cannot reuse the old contribution. Synthetic tests exercise these boundaries,
bounded storage, mismatch detection and ordinary worker output parity with and
without the preload.

The LRU retains at most 4096 entries and 32 MiB of serialized signature/dependency
metadata. That byte count is not an RSS claim. Entries retain hashes and task
footprints, not states or result graphs. Retaining actual replay payloads, cloning them and
preserving global ordering would add costs not covered by this metadata budget.
Temporary source-event captures are
released immediately after observation. Dataset/index identities are weakly
held. Request IDs distinguish reuse between requests from reuse within the same
request; neither is a revision-based validity key.

This is a read-graph feasibility measurement, not a latency population. The
sweep evaluates both members for every initial pool candidate. Diagnostic wall times and observer overhead cannot be used as an
after-latency claim. Two preliminary diagnostic
runs were stopped while removing repeated invariant/whole-state encoding. An
exact-signature sweep then lost its process during an environment restart after
32 candidates. Only the subsequent completed sweep is evidence; its recorder
atomically checkpoints numeric/hash metadata after every candidate. All A timing populations were
already complete before these diagnostics.

The finer source-event trace does not establish a replay algorithm for merging
roots into global item/source order, diagnostics, ownership, primary annotations,
public task rows or How/Why. Whole-source hashes validate the entire collector;
root-event hashes validate only the stated contribution. A broad dirty evaluator
remains unimplemented.

```sh
RS3_FINAL_PROJECTION=1 node scripts/perf/shadow-source-graph.mjs --data-dir /tmp/ie1/game --out /tmp/ie1/shadow.json
node --test tests/source-access-shadow.test.mjs
```

The completed sweep covers **37 candidates**, **76 full evaluations** and **78
requests**, with **0 hash mismatches, 0 faults, 0 ambiguous cases and 0 fallback
observations**. The input hashes match A's self-check. The table subtracts the
initial pool/base-list prefix, so it measures the 74 candidate evaluations only.
An attempt is a lookup whose last recorded input was from another request or
which has never been recorded; same-request hits are excluded from the rates.

| Contribution | Observations | Cross-request hits / attempts | Hit rate | Hit rate by encoded contribution bytes | Mismatches |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whole raw access | 1523 | 142 / 1051 | 13.51% | 7.69% | 0 |
| Whole base sources | 359 | 45 / 252 | 17.86% | 19.51% | 0 |
| Fine source roots | 49795 | 1219 / 10453 | 11.66% | 32.87% | 0 |

Fine roots also have 9912 same-request hits and 30374 empty observations.
There are 37734 dependency-declined root lookups. These figures reflect the
whole-collector footprint and single-version policy described above; no LRU
eviction occurred. Finer root-local gate footprints and multiple proof versions
could improve that rate, but their benefit is unmeasured.

The final graph has **2292 entries / 6632361 bytes** of serialized metadata; peak
is **6646161 bytes (6.338 MiB)**, below the 32-MiB cap. The trace checksum is:

`2d33e3e4fe5d62087224b46876cadaab057d90f8adc6a441b348cf823e711e3e`

The canonical ordinary-result stream checksum is:

`43374dc5e1ca9db03718d34b8a4fee6d1ee34d74067a1f22b099eeef3fb2dde3`

This single diagnostic takes 343.316 s. Calculator peak/idle RSS is
2238.67 / 2111.66 MiB; parent peak/idle is 860.37 / 685.07 MiB. This is a
complete-sweep footprint, not an isolated before/after RSS delta for the graph.
The completed run uses one calculator after the public suites finish. Earlier
discarded runs shared the machine with public validation; they supply no rates
or timing evidence.

Across candidate evaluations, all base-source collection takes 1564.79 ms.
The predicted whole-source hits cover only **272.35 ms**, about **7.36 ms per
candidate pair**, before lookup/clone costs. Raw-access predicted hits cover
5163.94 ms of inclusive spans; those calls can nest, including transport baseline
work, so this is not additive or a demonstrated saving. Observer work is
4246.99 ms over the candidate portion. That includes full-output hashing for
self-validation and is not an estimate of a future cache's lookup cost. Root
byte-hit rates cannot be converted into saved CPU without per-root timings.

**Judgment:** source/access caching alone is not the next engine priority from
these numbers. Exact whole-source reuse is feasible, but the observed work is
small beside seconds of final projection. Access reuse needs a cloning/hidden
metadata proof and non-overlapping timing before implementation. The broad root
footprint/version policy also limits what this experiment says about a finer
graph. This does not justify a full dirty evaluator; a future investigation
should measure row/obligation dependencies first. The shadow remains unwired.

### Final validation, files and recommendation

The final focused set passes **59/59**, and the recorder recheck **4/4**. The
opt-in quick suite passes **3619**, fails **0**, skips **68** (3687 total). The
earlier default quick run passed 3614 before the five additional harness/shadow
tests existed. Q2 was repeated on the expanded snapshot: again **1548 pairs,
0 differences, 0 errors**, including the complete **30/30** fixture harvest.
The application hashes still match the measured/self-checked source. Subsequent
recorder-only hashing/checkpoint changes pass their focused tests and the full
37-candidate operational sweep. No comparator or coverage gate was weakened.

Private audit: **542 files, 0 differences** in the lab checkout; **431 files,
0 differences** in the disposable copy; **0 credential artifacts**. The sorted
lab manifest hash before and after is identical:

`83eb6fc927d8b8d49734931392a34e4512c520cab04ad8f0556f81b0ba608589`

Changed files, grouped for review:

- `app/tasks/engine.mjs`, `app/tasks/obligation-cache.mjs`: the opt-in projection
  slice and pass-local literal-proof cache. Shared hotspots
  `app/tasks/scheduler.mjs`, `app/tasks/worker.mjs`, `app/server.mjs`: **no edits**.
- `scripts/perf/final-projection-builders.mjs`, `incremental-engine-probe.mjs`,
  `hotspots-engine.mjs`: separate diagnostic builder/window profiling.
- `scripts/perf/calculator-input.mjs`, `calculator-sequences.mjs`,
  `final-projection-check.mjs`: validated filesystem inputs, ordinary in-memory
  roll/accept commands and forced-reference canonical verification.
- `scripts/perf/source-access-shadow.mjs`, `source-access-shadow-probe.mjs`,
  `shadow-source-graph.mjs`: bounded, explicitly preloaded shadow measurement.
- `tests/final-projection.test.mjs`, `tests/source-access-shadow.test.mjs`,
  `scripts/test-selection.mjs`: parity, invalidation, bounds, command-history and
  trace tests, classified in quick/open-F2P. No renderer imports or `c.*` fields.
- The original phase recorder, profile tests and Phase 1 JSON are retained.
  This Markdown report gains Phase 2; the separate Phase 2 JSON keeps raw numeric
  populations, source hashes, summaries and correctness evidence.

**Historical Phase 2 recommendation, superseded by the Phase 3 gate below: MERGE-CANDIDATE. SHIP the opt-in projection slice.** The new path is proven
identical on both required gates and improves cold Preview. Repeat/shared-list
wall regressions and cohort variation remain explicit; reference stays the
default and production activation requires the separate lane release decision.
The shadow is evidence only and supplies no runtime path.

## Phase 3: warm-path and memory gate

The phase 3 brief authorizes default activation only after the slice wins or is
neutral across all measured workloads, retains exact outputs, and adds at most
40 MiB idle RSS per calculator. Until those gates have been measured, the slice
remains opt-in and `RS3_FINAL_PROJECTION=0` remains the forced reference.

The new `scripts/perf/final-projection-ab.mjs` driver runs balanced adjacent
reference/candidate pairs, reversing AB to BA on alternate blocks. Every arm
starts a fresh parent and process calculator. All warm operations within a trial
retain the existing request order. The three populations are isolated Preview,
the mixed two-member calculator, and independently cold member 1. Each gets ten
pairs (twenty fresh calculators), serially, with no concurrent benchmarks or
tests. The original five-run phase 2 populations remain historical evidence.

For each metric, report the two medians and full ranges, and a deterministic
10,000-resample paired bootstrap 95% interval for the difference of medians.
Resampling selects whole adjacent pairs. This controls session drift without
pretending that overlapping ranges demonstrate equivalence. A practical
neutrality margin is the larger of 2% of reference latency and 25 ms; an upper
confidence bound above that margin is inconclusive for activation, even if a
zero-difference null hypothesis cannot be rejected. Memory is reported as RSS,
not inferred from serialized byte counts. The idle sample follows the existing
two-second wait. Explicit-GC diagnostics are separate from latency populations
and do not change the production collector policy.

### Rechecking the Phase 2 slice

All 60 fresh trials completed: ten adjacent pairs per population. The following
numbers compare the unchanged Phase 2 candidate against its forced reference,
in seconds. Intervals are for candidate minus reference. All ranges retain every
run; no outliers were removed.

| Workload | Reference median [range] | Phase 2 slice median [range] | Change | Bootstrap 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Cold Preview engine | 7.377 [6.418–9.069] | 6.484 [5.970–7.766] | -12.1% | [-1.313, -0.182] |
| Cold Preview wall | 10.454 [8.977–13.259] | 9.298 [8.574–10.864] | -11.1% | [-1.548, +0.075] |
| Repeat Preview wall | 1.383 [1.166–1.548] | 1.488 [1.230–1.602] | +7.6% | [-0.077, +0.196] |
| First list, member 0 | 6.045 [5.435–6.238] | 5.581 [4.981–6.770] | -7.7% | [-0.759, -0.300] |
| Independent first list, member 1 | 3.983 [3.337–4.315] | 3.848 [3.655–4.120] | -3.4% | [-0.297, +0.071] |
| Second shared list | 2.090 [1.882–2.234] | 2.096 [1.776–2.923] | +0.3% | [-0.181, +0.171] |
| Refresh, member 0 | 2.029 [1.847–5.687] | 2.068 [1.792–2.683] | +2.0% | [-0.605, +0.264] |
| Refresh, member 1 | 1.136 [0.896–1.269] | 1.064 [0.743–1.343] | -6.3% | [-0.237, +0.040] |
| Cold roll pool | 4.393 [3.736–4.942] | 4.084 [3.539–4.497] | -7.0% | [-0.696, +0.114] |
| Pool after lists, member 0 | 0.583 [0.536–0.710] | 0.583 [0.540–0.661] | +0.0% | [-0.073, +0.050] |
| Pool after lists, member 1 | 1.429 [1.205–2.735] | 1.366 [1.191–1.625] | -4.4% | [-0.268, +0.100] |

The two original warm regressions are not established by these intervals:
repeat Preview remains slower at the median, with an interval spanning zero;
the second shared list moves only +0.3% at the median. This is uncertainty,
not evidence of equivalence. The cold engine saving is reproduced.

The memory gate does fail for isolated Preview: +63.6 MiB idle RSS, with the
entire interval above 40 MiB. Mixed idle RSS is +165.2 MiB at the median, with a
wide interval spanning zero. The independent-list population stays close.
Worker-process memory below includes its relay host and calculator isolate.
Values and difference intervals are MiB.

| Population / sample | Reference median [range] | Phase 2 slice median [range] | Difference interval |
| --- | ---: | ---: | ---: |
| Preview peak | 1554.605 [1524.164–1580.133] | 1618.207 [1589.270–1687.090] | [+52.730, +93.398] |
| Preview idle | 1535.643 [1505.387–1561.289] | 1599.273 [1570.059–1668.148] | [+52.516, +93.301] |
| Mixed peak | 2466.139 [2353.098–2593.586] | 2630.357 [2153.027–2753.934] | [-99.418, +248.738] |
| Mixed idle | 2288.938 [2204.496–2400.824] | 2454.139 [2146.383–2530.383] | [-73.303, +237.348] |
| Independent list peak | 962.154 [949.969–1045.148] | 967.193 [950.715–1055.395] | [-26.926, +43.893] |
| Independent list idle | 943.111 [934.863–952.074] | 944.342 [940.590–954.293] | [-1.131, +9.285] |

### Allocation diagnosis and the selected fix

Separate explicit-GC diagnostics use one fresh calculator per arm and population.
They do not supply latency or ordinary-idle RSS claims. The preload counts weakly
observed pass maps and warning-graph scratch, live private-proof backing bytes,
path copies, cache hits and isolate heap sizes. No heap contents are dumped.
Every diagnostic has zero live pass maps and zero live warning-graph scratch
after collection. Retained calculator-isolate heap differs by only 2.09 MiB for
Preview, 0.48 MiB for mixed, and less than 0.01 MiB for the independent list.
Preview retains exactly 71,028,961 private-proof bytes in both arms; independent
lists retain exactly 26,850,893. Mixed proofs differ by 12 bytes across five live
buffers. The resident-memory difference tracks allocation/collection history
and unused heap capacity, with little difference in live data. These single-pair
diagnostics explain ownership; the ten-pair unprofiled populations establish
ordinary RSS.

The Phase 2 Preview population performs 5,231,711 recursive visiting-Set copies,
despite 4,403,823 literal-cache hits and 617,772 generic-cache hits. Mixed performs
9,246,186 such copies, with 7,784,262 literal and 1,090,941 generic hits. Independent
lists perform 25,575 copies. These are whole-workload diagnostic counts, including
the pool, cold/repeat Preview and list requests, not counts for one projection.

The selected runtime change stays in `engine.mjs` and `obligation-cache.mjs`:

- Recursive calls lend their path to the read-only cache lookup. A miss receives
  the same independent mutable Set that the previous eager copy supplied.
- An absent root path means the existing empty path. Root cache hits allocate no
  Set. Literal hits merge their guard bit only when an enclosing proof needs it.
- A shared `(task, path)` evaluator replaces per-query thunks on the optimized
  path. The cache's optional boolean argument controls copying on computation;
  omitted or non-boolean arguments retain the zero-argument thunk API.
- One module-level iterator factory replaces per-query generator functions and
  descriptor closures. Empty producer catalogues return the same false result.
- Completed projections release the pass cache, key masks and positive root
  proofs before subsequent builders. How's subject projection also releases them.

Cache lookup cannot mutate the visiting path. Its fingerprint is calculated
before computation. Moving the copy into the miss therefore preserves the exact
path used by every computed branch, including caller cycle guards. Parent
footprints still receive all reads from cached children. Guard results still
cannot overwrite independent proofs. The existing cache bounds and invalidation
points remain, with an earlier terminal release. No new cache survives an
evaluation, member switch or dataset change. The forced reference keeps its eager
producer path, ordinary generic proofs and legacy thunk calls.

The first allocation pilot reduces recursive copies to 218,617 (−95.8%), with
identical cache-call/hit counts, eight matching response hashes and zero live pass
maps after collection. The final candidate also removes the per-hit thunk.
Warning/equipment builders and serialized result fields keep their existing
algorithms. There are no app edits to scheduler, worker or server, no new imports
or `c.*` fields for renderers, and no added native compression handles.

An environment restart separated the baseline cohort from candidate work. The
saved 60 trials and six diagnostics were verified afterwards. Node remains
24.21.0; Linux quotas remain four CPUs and 16 GiB. Each new comparison uses its
own interleaved reference arm, avoiding a comparison of unpaired sessions.

### First allocation cohort and confirmation plan

The first ten pairs use the shared-evaluator candidate. Units are seconds.

| Workload | Reference median [range] | Candidate median [range] | Change | Bootstrap 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Cold Preview engine | 7.287 [6.501–8.579] | 5.951 [5.426–12.033] | -18.3% | [-2.343, -0.644] |
| Cold Preview wall | 10.244 [9.032–11.865] | 8.867 [8.044–18.199] | -13.4% | [-3.038, -0.268] |
| Repeat Preview wall | 1.417 [1.258–1.821] | 1.434 [1.183–1.997] | +1.2% | [-0.192, +0.258] |
| First list, member 0 | 5.768 [5.175–6.941] | 4.720 [4.279–14.833] | -18.2% | [-1.450, -0.025] |
| Independent first list, member 1 | 3.785 [3.220–4.534] | 3.798 [3.209–4.289] | +0.3% | [-0.351, +0.284] |
| Second shared list | 2.046 [1.694–2.852] | 1.946 [1.746–2.777] | -4.9% | [-0.311, +0.154] |
| Mixed repeat Preview | 1.240 [1.165–1.589] | 1.401 [1.181–1.867] | +13.0% | [-0.061, +0.423] |
| Cold roll pool | 4.441 [3.789–6.240] | 3.909 [3.574–5.850] | -12.0% | [-0.911, -0.161] |

Combined two-member refresh is 3.073 [2.640–4.163] to 2.863 [2.346–3.626] seconds
(−6.8%; interval −0.568 to −0.075 seconds). The cold gains are established in this
cohort. Warm estimates remain imprecise; the mixed repeat's +13.0% median needs
confirmation. Every observation remains, including the 18.199-second cold
Preview and 14.833-second first-list outliers.

Median ordinary-idle differences are −6.35 MiB for Preview, +7.66 MiB for mixed,
and +9.90 MiB for the independent list. All are within the 40 MiB median target;
mixed RSS still has a wide interval. Allocation diagnostics on the final code
reduce mixed copies from 9,246,186 to 390,781 and independent-list copies from
25,575 to 2,869. All cache-call/hit counters match the previous candidate exactly,
with zero live pass maps or warning-graph scratch after collection.

An additional ten complete pairs per population started with frozen app code. The first ten are kept
as a separate snapshot; the extended population retains all twenty pairs. This
extension addresses the warm-path uncertainty without removing samples or
changing workloads. Its bootstrap intervals are exploratory. Across the two code
cohorts, all 38 full-reference response hashes also match, covering the same
inputs and the mixed population's sampled How/Why responses.


### Final twenty-pair result and decision

The cold/first labels retain the Phase 2 request boundaries: cold Preview is
the first prediction after the pool request needed to choose a candidate. Its
wall time excludes calculator startup and that preceding pool request; those
are recorded separately. Each arm still starts a fresh calculator. Mixed
workloads keep their prior list, pool, prediction and accepted-refresh order.

All 120 trials completed, twenty adjacent pairs per population. A second
environment restart interrupted the extended cohort after 110 trials. The
checkpoint contained 55 complete pairs and no orphaned arms. Source and input
hashes, Node 24.21.0, four-CPU quota and 16 GiB RAM quota were verified before
resuming the remaining five pairs. No observations or pairs were removed.
The extra ten pairs were collected to resolve warm-path uncertainty; intervals
from this extended cohort are exploratory, with the original ten-pair subset
retained above.

The following table uses seconds. Intervals describe candidate minus reference.

| Workload | Reference median [range] | Candidate median [range] | Change | Bootstrap 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Cold Preview engine | 7.345 [6.501–8.579] | 5.568 [5.156–12.033] | -24.2% | [-2.055, -1.371] |
| Cold Preview wall | 10.297 [9.032–11.865] | 8.655 [7.688–18.199] | -15.9% | [-2.021, -1.300] |
| Repeat Preview wall | 1.412 [1.243–1.821] | 1.399 [1.139–1.997] | -1.0% | [-0.076, +0.041] |
| First list, member 0 | 5.941 [5.122–10.437] | 4.896 [4.227–14.833] | -17.6% | [-1.418, -0.646] |
| Independent first list, member 1 | 3.792 [3.220–4.534] | 3.784 [3.209–4.440] | -0.2% | [-0.163, +0.164] |
| Second shared list | 2.061 [1.694–2.852] | 1.957 [1.746–2.777] | -5.1% | [-0.254, +0.091] |
| Mixed repeat Preview | 1.274 [1.113–1.691] | 1.366 [1.157–2.985] | +7.2% | [-0.015, +0.240] |
| Refresh, member 0 | 1.965 [1.791–2.546] | 1.878 [1.596–2.729] | -4.4% | [-0.186, -0.012] |
| Refresh, member 1 | 1.108 [0.756–2.372] | 1.057 [0.718–1.326] | -4.7% | [-0.304, +0.080] |
| Combined refresh | 3.092 [2.640–4.163] | 2.882 [2.346–3.787] | -6.8% | [-0.301, -0.048] |
| Cold roll pool | 4.371 [3.782–6.240] | 3.869 [3.377–5.850] | -11.5% | [-0.626, -0.370] |
| Pool after lists, member 0 | 0.570 [0.505–0.723] | 0.579 [0.511–1.181] | +1.6% | [-0.037, +0.044] |
| Pool after lists, member 1 | 1.331 [1.093–1.612] | 1.314 [1.017–1.665] | -1.3% | [-0.216, +0.127] |

The cold gains survive the extended cohort. Repeat Preview's point estimate is
now slightly faster, but its upper bound is 41 ms, above the 28 ms practical
neutrality margin. The independent first list and second shared list have upper
bounds of 164 ms and 91 ms, above their 76 ms and 41 ms margins. Mixed repeat
Preview is +7.2% at the median, with a -15 to +240 ms interval. No warm slowdown
is established at 95% confidence, but neutrality is also not established. It
would be misleading to turn a failure to reject zero into a claim of equivalence.

Exact list/pool/result cache hits bypass evaluatePass and therefore all projection
cache/iterator setup. This change adds no work to those hit handlers. Their
latencies can still depend on earlier allocation and GC history. The remaining
mixed-repeat variation has not been attributed to a particular collector phase
or serialization step; that remains an open question, not a measured cause.
No reply fields or serialized payload formats were changed.

Worker RSS below includes the process relay and calculator isolate; parent RSS
is the measurement caller, reported separately. Units are MiB. The ordinary idle
sample follows two seconds without explicit GC. All median idle extras meet the
40 MiB target. Mixed RSS intervals remain wide, so the target is established for
the observed medians, not as a per-run upper bound or a three-hour residency test.

| Population / sample | Reference median [range] | Candidate median [range] | Change | Difference interval |
| --- | ---: | ---: | ---: | ---: |
| Preview peak | 1544.729 [1330.965–1570.070] | 1547.293 [1446.664–1570.789] | +0.2% | [-9.367, +15.490] |
| Preview idle | 1525.699 [1312.082–1550.984] | 1528.332 [1427.617–1551.770] | +0.2% | [-9.516, +15.570] |
| Mixed peak | 2441.889 [2196.812–2656.707] | 2440.408 [2132.254–2597.844] | -0.1% | [-121.299, +144.910] |
| Mixed idle | 2285.295 [2067.906–2458.922] | 2276.777 [2089.961–2407.332] | -0.4% | [-104.531, +113.438] |
| Independent list peak | 959.625 [933.168–1035.625] | 969.754 [940.852–1101.922] | +1.1% | [-11.055, +34.539] |
| Independent list idle | 945.230 [921.539–981.102] | 947.041 [928.355–993.754] | +0.2% | [-6.426, +11.930] |
| Preview parent peak | 1056.029 [1044.535–1558.312] | 1057.930 [1030.059–1563.711] | +0.2% | [-7.777, +17.570] |
| Preview parent idle | 1004.594 [953.641–1508.648] | 1008.553 [980.363–1514.250] | +0.4% | [-3.695, +21.230] |
| Mixed parent peak | 1238.418 [1216.617–1250.348] | 1235.055 [1216.105–1249.906] | -0.3% | [-8.625, +3.895] |
| Mixed parent idle | 1174.762 [1163.805–1184.996] | 1171.279 [1163.344–1183.527] | -0.3% | [-7.240, +2.844] |
| Independent list parent peak | 880.236 [864.039–1018.094] | 880.678 [864.074–897.941] | +0.1% | [-20.809, +18.836] |
| Independent list parent idle | 840.094 [834.629–848.426] | 839.809 [834.027–843.793] | -0.0% | [-1.289, +0.453] |

**Recommendation: KEEP OFF. PARTIAL.** The allocation slice has a larger cold
saving and fixes the measured idle-memory penalty, but the warm neutrality gate
is unresolved. `RS3_FINAL_PROJECTION=1` remains an experimental opt-in;
`RS3_FINAL_PROJECTION=0` forces the reference even when the constructor requests
the slice. No production default was changed. Do not open a default-on PR from
these results. A further attempt needs warm-window GC/serialization attribution
and an adequately powered fixed-size confirmation cohort; it should not begin a
broader dirty-marking evaluator.


### Phase 3 reproduction and proof coverage

Use Node 24.20 or later (these runs used 24.21.0). Prepare a validated save copy
under `/tmp` and set the dataset, packs, game-defaults and process-worker
environment as described in the input checkout. Do not open a store or server.
With `COPIED_GAME` and `MEASUREMENT_DIR` pointing to temporary directories:

```sh
node scripts/perf/final-projection-ab.mjs --data-dir "$COPIED_GAME" --out "$MEASUREMENT_DIR" --runs 20
```

The driver resumes by completed arm, verifies app-source and state-file hashes,
and refuses changed sources or inputs. Latency trials never enable the memory
preload. For a separate diagnostic, invoke the existing Preview or hotspots trial
with `--expose-gc --import ./scripts/perf/final-projection-memory.mjs`; set
`RS3_WORKER_MEMORY_PROBE_IMPORT` to the file URL of
`scripts/perf/final-projection-memory-probe.mjs` for the hotspots trial, also
loading `./scripts/perf/profile-stack/bootstrap.mjs` with `--import` and setting
`RS3_PROFILE=1` and `RS3_PROFILE_DIR` to an existing temporary trace directory. This
preload is an anchor-validated diagnostic for this slice, not a general profiler
for arbitrary historical engine sources.

The allocation change also reduces work inside the nested transport baseline.
Cold Preview's reported baseline component falls from 3.723 [3.156–4.980] to
3.187 [2.715–7.142] seconds (difference interval -0.684 to -0.368 seconds), and
its hypothetical component falls from 3.731 [3.266–4.600] to
2.718 [2.330–3.754] seconds (interval -1.155 to -0.852 seconds). These components
are nested timings and must not be added to engineMs. Equipment and warning
builder algorithms remain unchanged; no additional improvement is claimed for
them, and no cross-evaluation baseline cache was added.

The new `final-projection-ab.test.mjs` is classified in both quick and open-F2P
selection sets. It verifies balanced-pair grouping and deterministic bootstrap
behavior, including incomplete pairs. Added engine/cache cases cover independent
sibling paths, cycle guards, optional empty paths, release/invalidation and the
legacy thunk API. Existing projection tests cover the original hard fixtures and
forced-reference override. No renderer imports or `c.*` fields were added.

Q2 was rerun from START against this candidate with one exported-patch default
substitution to activate the candidate in Q2's clean environment. The working
tree remains off by default. The corpus has 12 cases and the complete fixture
harvest has 30 passed, zero failed and zero skipped. All 1,548 request pairs
completed: 1,247 successful-result pairs and 301 matching negative/error pairs,
with zero differences and zero harness errors. Coverage includes evaluate,
roll pool, prediction, death estimates, planning, sandbox, area checks, rule
preparation and How. No comparator, volatile-field list or coverage floor was
changed.

Q2 corpus SHA256:
`d1e5223a024f4c94fabe023df950c07a1347d61c35542de9063ab0c2ee1f7c8e`.
Activated exported-patch SHA256:
`2bc8aaf36e66b3cfbce5555242b5b35c9163f10c3a1d7a3647c1d4b04e440f01`.
The numeric artifact records the working and activated engine hashes separately.

All 800 adjacent response/hash comparisons in the final measurement cohort also
match. These are a timing-cohort sanity check; the exhaustive private forced-path
check is a separate gate. The private-input audit finds zero differences across
542 original files, zero differences across 431 copied files, and zero new files
in the copy. No private store/server was opened or credentials created.


The final focused run passed 104 tests with zero failures (67 open-F2P fixtures
and 37 fixtures under their selected legacy profile). An earlier manual command
forced the latter fixtures onto open-F2P and recorded 100 passed / 3 failed;
correct per-file profiles resolved that invocation error. The final quick suite,
run once with the candidate enabled, recorded 3,623 passed / 1 failed / 68 skipped
in 1,257,336 ms. Its single failure is
`tests/rule-explanations.test.mjs`, the selected-catalogue coverage assertion at
line 47. Isolated candidate and untouched START runs both recorded 3 passed /
1 failed at that same assertion, under the same Node and dataset environment.
This pre-existing catalogue failure needs separate investigation; the test and
catalogue were left unchanged. No full `npm test` was run.


The final calculator-only forced-reference self-check completed with zero
differences across 809 canonical comparisons. It covered all 37 roll-pool
candidates across two members (pool counts 7 and 30), plus three accepted-roll
sequences of depth three: nine accepted rolls per path. Each path produced
527 worker responses, including 282 How requests, plus 282 local Why results.
How and Why cover three selected visible rows per member inspection; these are
sampled queries, not every possible task query. All returned full-result rows, pools, predictions, prepared replies and reuse
payloads enter the canonical comparison.
Two ordinary process calculators ran concurrently only for this correctness
check, after a 10 GiB spare-memory admission check; latency measurements remained
serial. Duration was 1,540,476 ms.

Both aggregate hashes, also identical to the Phase 2 result:
`edc980b91e47f84fcb2d3c05a63b6bea4b6b30ed47493c4132d96b93d78f949e`.

The final private-input audit again recorded 542 original files and 431 copied
files, zero differences and zero new copied files. Its sorted root-relative
manifest SHA256 (compact JSON encoding without leading path separators) is
`f88c66fae057432a3827d612c710fe90d91b98afafd09f1671d629568a906163`
before and after. No private credentials were created. Runtime edits are confined
to `app/tasks/engine.mjs` and `app/tasks/obligation-cache.mjs`; scheduler, worker
and server have zero app edits. No new native compression handles were added.
Termination discards pass-local scratch along with the calculator process.
The Phase 2 shadow trace remains unwired.

The paired samples, confidence intervals, source hashes, diagnostic ownership
counts and both proof summaries are in
[`incremental-engine-phase3-2026-11.json`](incremental-engine-phase3-2026-11.json).
They retain every run and allow the bootstrap summaries to be recomputed.

**Final Phase 3 recommendation: KEEP OFF. NEEDS-WORK. PARTIAL.** The cold saving
and lower allocation churn are proven, and median idle extras meet the target.
Warm neutrality, three-hour idle behavior and the remaining mixed-repeat
variation are unresolved. The separate pre-existing catalogue assertion also
keeps this quick-suite invocation from green. Production activation remains off.


## Phase 4: fixed warm cohort and projection decision

START `e7d108886e8f2619dd9ee2b4cf6b1ebf2b4d204a`. **KEEP OFF. NEEDS-WORK. PARTIAL.**
Both user-facing sequences win, but the Preview warm intervals do not establish
the required 5% bound. The reference remains the default; `RS3_FINAL_PROJECTION=1`
opts in and `RS3_FINAL_PROJECTION=0` forces the reference.

The size was fixed at **48 adjacent pairs per workload** before collecting data:
192 pairs / 384 fresh process calculators, alternating AB/BA order. One reader
parent retained prepared inputs; calculators and all requests ran serially,
without concurrent tests or diagnostics. Linux x86-64, Node 24.21.0, four CPUs,
16 GiB memory quota. App sources stayed fixed; no additional GC fix was attempted.
Every arm and completed workload summary was checkpointed, with all observations
retained. The deterministic 10,000-resample bootstrap selects whole pairs and
estimates the difference of arm medians. The paired-median/range column describes
the individual observed differences. All table values are seconds.

| Workload | Reference median [range] | Candidate median [range] | Difference of medians | Paired difference median [range] | Bootstrap 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repeat Preview | 1.454 [1.287–2.020] | 1.512 [1.307–1.880] | +0.058 | +0.052 [-0.279–+0.400] | [-0.010, +0.104] |
| Mixed repeat Preview | 1.416 [1.148–1.803] | 1.404 [1.203–2.003] | -0.012 | +0.052 [-0.506–+0.632] | [-0.090, +0.108] |
| Independent first list, member 1 | 3.827 [3.426–4.545] | 3.785 [3.361–5.479] | -0.042 | -0.056 [-0.800–+0.934] | [-0.115, +0.094] |
| Second shared list | 2.247 [1.989–3.034] | 2.111 [1.908–2.768] | -0.136 | -0.095 [-1.020–+0.697] | [-0.200, -0.043] |

The 5% upper limits are 72.7 ms for Preview, 70.8 ms for mixed Preview,
191.4 ms for the independent list and 112.4 ms for the shared list. The first two
interval upper bounds are 104.1 and 107.6 ms, so those gates fail. Neither interval
establishes a slowdown at 95%; neither establishes the requested warm bound.
The independent and shared-list bounds pass.

The sequence clock starts immediately before the cold request and stops on the
first repeat/second shared response. Startup and the preceding Preview pool
request are excluded. There is no forced collection or response hashing between
these requests. Shared lists are requested directly for member 0 then member 1;
the older shared harness's intervening member-0 replay and encoding are omitted.
Mixed Preview retains its earlier list/replay/encoding/pool/prediction order.

| Workload | Reference median [range] | Candidate median [range] | Difference of medians | Paired difference median [range] | Bootstrap 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold Preview then first repeat | 12.394 [10.712–14.963] | 10.672 [9.150–12.855] | -1.722 | -1.662 [-4.337–+0.176] | [-1.993, -1.370] |
| Cold first list then second shared list | 8.147 [7.370–10.593] | 7.177 [6.520–8.241] | -0.970 | -0.975 [-3.819–+0.096] | [-1.181, -0.789] |

Both total-wall intervals lie below zero. All **192 canonical response-hash
pairs match, zero differences**, including final transported reuse payloads,
using the existing comparator. This timing sanity check does not replace the
earlier Q2/exhaustive proofs supplied with the brief; those were not rerun for
this KEEP OFF decision.

Worker-process VmHWM medians [full ranges], in MiB, are:

- Repeat Preview: 1482.9 [1276.0–1551.9] → 1495.4 [1247.2–1556.4].
- Mixed repeat Preview: 1598.3 [1415.4–1746.4] → 1711.5 [1422.5–1755.5].
- Independent first list, member 1: 961.6 [937.9–1043.7] → 963.1 [942.9–1033.8].
- Second shared list: 1224.6 [1060.6–1249.9] → 1220.4 [1070.5–1266.8].

The mixed peak median rises by 113.2 MiB. These are peaks of the measured warm
populations, including preparation, and are not retained-memory or idle claims.

**Supplied controls, not rerun here:** one-hour idle end-RSS extras were +9.1 MiB
Preview and +4.0 MiB mixed, both below 40 MiB. Earlier 10-pair GC controls found
natural first-repeat differences of +258 ms Preview / +267 ms mixed. Diagnostic
collection reduced these to +30 ms [−38, +72] / +10 ms [−61, +38]; control requests
entered zero evaluator passes. This supports allocation/GC history as a cause.
The current unprofiled median gaps are +58 / −12 ms, so the earlier large median
cost was not reproduced. Raw historical artifacts were unavailable; the JSON
marks these supplied summaries as historical. No production `gc()` or flag was
added. Idle passes and both sequences win, but the warm bounds require KEEP OFF.

Reproduce after copying and validating the save under `/tmp`, using the external
dataset, packs and defaults selectors described by the private input checkout:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/projection-warm.mjs --data-dir "$COPIED_GAME" --out /tmp/phase4/warm --evidence "$PWD/docs/perf/incremental-engine-phase4-2026-11.json"
node scripts/perf/projection-summary.mjs --root /tmp/phase4 --out "$PWD/docs/perf/incremental-engine-phase4-2026-11.json"
```

Input reads used filesystem checksums and state validation, followed by ordinary
calculator workers. No private store/server or credentials were created. Runtime
changes are exactly the supplied slice in `app/tasks/engine.mjs` and
`app/tasks/obligation-cache.mjs`; the default remains off.

Evidence, including every arm, paired ranges, bootstrap intervals, source/input
hashes, peak memory and the supplied controls:
[incremental-engine-phase4-2026-11.json](incremental-engine-phase4-2026-11.json).


Validation: **70 passed, 0 failed, 0 skipped** across 12 focused projection,
engine, cache and selection files (28 open-F2P cases / 42 selected legacy cases).
The candidate-enabled quick suite ran **once**: **3,631 passed, 1 failed,
68 skipped**, 3,700 total, 425.200 s. Its only failure is the selected catalogue
coverage assertion in `tests/rule-explanations.test.mjs:47`. Isolated candidate
and untouched START runs each recorded **3 passed / 1 failed** at that same
assertion, confirming the supplied sandbox-only failure. No test or pack was
changed to hide it; no full `npm test` was run.

Final audit: **542 original files / 431 copied files, zero differences, zero new
or removed files, zero credential artifacts**. All four recorded application
source hashes still match the measurement signature. Remaining risks are the
unresolved warm bounds and transient mixed peak-memory increase; historical GC
and idle summaries were supplied rather than independently repeated here.

**Final Phase 4 decision: KEEP OFF. NEEDS-WORK. PARTIAL.**


## Default-on proofs

START `e7d108886e8f2619dd9ee2b4cf6b1ebf2b4d204a`, Node 24.21.0. The owner
approved default activation, superseding the historical KEEP OFF release decision
above. These are correctness proofs of the supplied default-on slice; no further
runtime or performance changes were made. Every candidate runs with
`RS3_FINAL_PROJECTION` unset. The self-check reference alone sets it to 0.

- **Q2:** untouched START (the supplied current-main checkout) versus START plus
  the exported candidate patch, without an activation substitution. Cached
  origin/main was not used. The unchanged phase-3 recipe uses 12 synthetic cases
  and the complete selected fixture harvest: 30 passed, 0 failed, 0 skipped.
  **1,548/1,548 pairs, 0 differences, 0 harness errors**: 1,246 successful results
  and 302 matching negative pairs; 174 synthetic and 1,374 harvest requests, with
  successful coverage of all nine operations. Comparator, exclusions and floors
  are unchanged. Final corpus SHA256:
  `21485beb98657349badafa310adaaef459e93c1cb9b2f33490a4248f359bf378`.
  Exported-patch SHA256:
  `cc55c7e3fc790c49e173b133e8c6838dfa000bad2cdad5086b5ecabd6a682c06`.
  The initial Q2 run also passed 1,548 pairs with zero differences/errors; the
  final run includes the completed regression test. Subsequent edits are this report only.
- **Forced-reference self-check:** **809 comparisons, 0 differences**, all
  **37 candidates / 2 members** (pool counts **7, 30**), **3 sequences / 9 accepted
  rolls per path**, **527 worker responses, 282 How and 282 Why per path**.
  Full results, owner/partner predictions, prepared replies and decoded reuse
  payloads use the existing canonical comparison. How/Why use the same three
  visible-row indices as phase 3. Both aggregate hashes exactly match phase 3:
  `edc980b91e47f84fcb2d3c05a63b6bea4b6b30ed47493c4132d96b93d78f949e`.
  `--candidate-default` leaves the candidate switch unset; `--parallel` admitted
  two ordinary process calculators only after the existing 10-GiB memory check.
- **Tests:** 15 focused projection/engine/cache/selection files: **110 passed,
  0 failed, 0 skipped** (78 open-F2P / 32 selected legacy cases). The completed
  default-on quick suite: **3,632 passed, 1 failed, 68 skipped, 0 cancelled**
  (3,701 total). Its only failure is `tests/rule-explanations.test.mjs:47`.
  Isolated candidate and untouched START each reproduce **3 passed / 1 failed**
  at that assertion with the same normal test defaults. No test assumed an old
  opt-in default. `tests/final-projection.test.mjs` adds one behavioral probe
  proving default execution uses projection and 0 uses reference, including an
  explicit opt-in override. Its existing quick/open-F2P classification applies.
  No test, catalogue or comparison policy was weakened; no full npm test ran.

An earlier quick invocation mistakenly inherited the copied-save defaults file.
It was stopped: **2,049 passed, 3 failed, 2 cancelled, 32 skipped**. With normal
test defaults, the three affected synthetic fixtures pass **3/3** on both trees.
Only the corrected completed quick run above supplies the suite gate.

Final filesystem audit: **542 original files / 431 copied files, 0 differences,
0 added or removed files, 0 credential artifacts**. The original manifest SHA256
is unchanged at `7e3697921366f2c960ab93e5502e8710501eff785aae46980eeb6176da50af8c`;
the copied manifest is unchanged at `cd61ec309add4e4a817ddca7c217f90629c7b957c8acd84132e2ec8b20df67f6`.
Private inputs were validated from filesystem reads under /tmp and sent to
ordinary calculator workers; no private store/server was opened or credentials created.

Correctness-job diagnostics (one final run each): Q2 **118.659 s /
1268.83 MiB** sampled owned-group peak; self-check
**1607.417 s / 6915.82 MiB** sampled group peak.
The respective samplers use 50 ms and 100 ms intervals. Jobs overlapped other
correctness work; these are not before/after latency or per-calculator residency
measurements. No new timing cohorts, medians or spread estimates are claimed.
Historical warm bounds and transient memory risks were not remeasured.

Reproduce Q2 with all RS3 selectors unset, the START ref and an ordinary exported
working-tree patch using the existing Q2 supervisor recipe. After selecting the
released inputs and preparing a validated /tmp copy, reproduce the private proof:

`node scripts/perf/final-projection-check.mjs --data-dir "$COPIED_GAME" --out /tmp/default-on-check.json --candidate-default --parallel`

**Recommendation: MERGE-CANDIDATE. SHIP.**
