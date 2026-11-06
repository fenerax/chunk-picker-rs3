# Per-task Why evidence

Baseline: `a2411c5a00f052bfdf8277b78d8d7b223b9524a6`. Synthetic inputs only;
Node 24.20.0 on Windows. This change targets transferred bytes and request
count. It makes no claim about wall time on a shared machine or production
hit rates. The seven-day live summary was not supplied or accessed.

The inline Why loader previously requested full tasks plus full definitions
before calling `explainTask`. It now first reads
`/api/task-why?view=display-v1` for one task, member and exact revision. The
existing Why-chain API keeps its original format. How already uses a separate
per-task API; both explanation controls now share an exact-revision cache guard.

The display carries only inputs used by `explainTask`, including the original
set-standing and needed-for-chain algorithms and their order. Rule descriptions
and location labels still come from the same browser models. Saved gzip
evidence is preferred; otherwise a writer reads an existing foreground or duo
calculator snapshot through picker-scoped scheduler admission. The pool operation
can borrow only an existing ready, idle physical calculator. Busy, retiring and
absent calculators return unavailable immediately, without allocator/wake-queue
admission. A miss does not evaluate tasks or create a lane. A viewer never
requests a worker.

The UTF-8 JSON envelope is capped at 65,536 bytes before IPC/HTTP. Missing or
oversized evidence falls back to the previous full-details loader without
truncation. Sandbox keeps that loader. HTTP and browser guards reject a changed
revision/member/scope; Why and How only paint an exact cached revision.

Saved display and Why-chain reads share an explicit context-owned parse cache.
It reserves `1024 + 32 * decodedBytes + compressedBackingBytes` before decoding,
inside the existing 48 MiB HTTP response-cache quota. This is a conservative
ownership charge, not an RSS measurement. A gzip trailer provides the admission
size; bounded native output and decoded-length validation reject forged sizes.
The general decoded limit is 1 MiB; writer display reads admit at most 256 KiB,
and saved Why-chain reads admit at most 2,048 task rows.
Invalidation clears timers and references on replacement, revision rebind,
eviction, expiry, deletion fence and close. Native in-flight decodes remain
pinned and charged until settlement; context close awaits that drain.

Traversal and allocation admission precede dependency-index construction, Set
scans and sorting. Writer display derivation admits at most 128 rows, 32,768
work units and a 512 KiB allocation estimate; isolated calculators admit at most
20,000 rows, 400,000 work units and an 8 MiB estimate. Work includes visited
strings, dependencies, blockers, diagnostics and worst-case dependent sorts.
Related-label output is bounded before mapping it. UTF-8/JSON escape counting
checks the envelope without allocating its serialization; oversized arrays and
strings are rejected by length before walking/copying them. Only matching boss
gates and the four gate fields consumed by the explanation are projected, using
the same gate selector as the full answer. Budget exhaustion returns unavailable
without truncation and leaves the full loader available.

There is no new worker cache or reusable projection index. The bounded index is
request-local. Successful scheduler replies are charged to its existing response
cache; misses are not cached. Snapshot ledger quotas, per-picker keys, fairness,
process isolation and normal list payloads are unchanged.

## Verification gates

Declared before execution:

- Equal complete explanation objects and rendered line order for locked,
  missing-requirement, set, source, boss-gate and Slayer-gate cases, both
  members, Group on/off, and skill/quest/diary/BiS/generated-style categories.
- Real HTTP/worker equality against full task results after compact selected
  and duo-peer lists, plus saved-gzip and read-only paths.
- Full-loader fallback on unsupported/unavailable evidence; old revisions
  rejected before and during a worker read and in the browser display cache.
- A hard 64 KiB envelope, no unrelated-catalogue growth, no added list fields,
  no full evaluation on a per-task miss, and picker isolation under colliding
  member/revision/input values.
- Shared parse-ledger admission/release, pinned native decodes, and WeakRef/GC
  collection while the owner remains reachable. GC is enabled only by this
  test's subprocess configuration. Both stale explanation controls are covered.
- Deterministic work/allocation counters for large unrelated graphs and oversized
  projections, plus a resident logical lane whose physical calculator has retired.
- Count gzip-accepted HTTP response-body bytes with the raw HTTP client and
  count calls. Separately report exact raw/gzip JSON sizes for the larger
  synthetic catalogue. Headers/TLS and live-site latency are outside the metric.

## Transfer evidence

The 4,000-unrelated-task synthetic catalogue is deliberately repetitive; its
compression ratio does not estimate production traffic. Its deterministic
JSON measurements are:

| Cold explanation supplement | Calls | Raw bytes | Gzip bytes |
| --- | ---: | ---: | ---: |
| Full tasks plus definitions | 2 | 10,167,475 | 96,804 |
| One task's evidence | 1 | 989 | 519 |

Adding those unrelated tasks and their definitions leaves the per-task reply
identical. Oversized related evidence falls back instead of silently dropping
explanation lines. This is a byte/call-count comparison, not a latency result.

The smaller synthetic cave fixture exercises actual authenticated HTTP reads
after compact lists, through both selected and duo-peer scheduling. A raw HTTP
client accepts gzip and counts response-body bytes as received; the server may
leave a small response uncompressed. Full-result timing fields can vary the
full supplement by a few bytes between runs. The final passing run measured:

| Group | Member | Full supplement: 2 calls | Per task: 1 call |
| --- | --- | ---: | ---: |
| Off | one | 11,271 bytes | 337 bytes |
| Off | two | 11,425 bytes | 335 bytes |
| On | one | 11,437 bytes | 277 bytes |
| On | two | 11,541 bytes | 285 bytes |

Projecting only matching boss gates removes unrelated gate/gear data from this
fixture while preserving the explanation. No byte sample is used as a wall-time
measurement or as a production-size estimate.

## Verification results

All 87 distinct focused tests pass across the appropriate dataset runs:
9 projection/loader/cache/budget tests, 2 real HTTP cases, 7 picker-isolation
tests, 6 selected scheduler tests, 7 existing Why component tests, 36
Why-chain/How UI tests, 10 HTTP-response tests, 3 saved-evidence owner tests,
6 task-provenance tests and 1 selected context-close test. The HTTP
cases each cover both members and include the old fallback and a save landing
during a worker read. The projection matrix compares 40 complete explanation
objects and rendered line order. `git diff --check` passes.

A separate headless Chromium smoke uses the repository's existing CDP test
support, a disposable synthetic server on port 0 and real process workers.
All four member/Group combinations pass: one narrow API read, zero full-task
or definitions supplement reads, no new evaluation, and zero browser
exceptions. The local smoke wrapper and run logs are ignored operator
artifacts; the committed synthetic tests reproduce the equality, transfer,
fallback, revision, size, accounting and isolation assertions.

No full suite, real save, live timing summary, production latency or RSS
benchmark, deployment, save-schema change or plugin-protocol change is part of
this evidence. Missing/evicted/oversized evidence adds the narrow probe before
using the old full path. The existing cache and process quotas are unchanged.

## Reproduction and test-harness corrections

Use Node 24.20.0, an isolated environment, and `--test-concurrency=1` for each
command. No production save or fixed picker port is needed. Set
`RS3_DATASET=open-f2p` for these synthetic HTTP and worker fixtures:

```sh
node --test --test-concurrency=1 tests/task-why-display.test.mjs tests/task-why-display-server.test.mjs tests/worker-picker-keys.test.mjs tests/task-why.test.mjs
node --test --test-concurrency=1 tests/saved-why-evidence.test.mjs tests/http-response.test.mjs
node --test --test-concurrency=1 --test-name-pattern="Why|shared cache quotas|duo lane validates|claim display revisions" tests/scheduler.test.mjs
node --test --test-concurrency=1 --test-name-pattern="deferred owned context eviction" tests/picker-calculator-cap.test.mjs
```

With the inherited/default dataset, the existing Why-chain and How UI checks
use their original synthetic fixtures:

```sh
node --test --test-concurrency=1 tests/task-why-chain.test.mjs tests/task-how-ui.test.mjs
node --test --test-concurrency=1 tests/task-provenance.test.mjs
```

Exploratory runs exposed harness errors, retained here rather than counted as
performance findings: clearing environment overrides with empty strings kept an
invalid loopback-role option; running legacy Agility expectations under F2P
changed their dataset; the HTTP fixture initially set a rule absent from the
F2P registry; and a direct store write needed the same compact-list refresh
that precedes full details in the UI. The browser probe initially clicked a
hover-only control before moving the pointer onto its row. The corrected runs
remove environment overrides, use the appropriate dataset/rules, settle the
compact list, and hover before clicking. Test timeouts are not latency samples.
The first bounded-work run also rejected valid fixture answers because its
preflight included entire unrelated boss-gate gear records. The final projection
uses the shared matching-gate selector and bounded UTF-8/escape counting; all
HTTP, worker-isolation and browser assertions then pass.
