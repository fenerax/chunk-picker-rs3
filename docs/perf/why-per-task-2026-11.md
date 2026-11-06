# Per-task Why evidence

Baseline: `a2411c5a00f052bfdf8277b78d8d7b223b9524a6`. Synthetic inputs only;
Node 24.20.0 on Windows. This change targets transferred bytes and request
count. It makes no claim about wall time on a shared machine or production
hit rates. The seven-day live summary was not supplied or accessed.

The inline Why loader previously requested full tasks plus full definitions
before calling `explainTask`. It now first reads
`/api/task-why?view=display-v1` for one task, member and exact revision. The
existing Why-chain API keeps its original format. How already uses a separate
per-task API; all explanation controls now share provisional-cache painting.

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
revision/member/scope. Cached answers from the same scope may paint immediately,
including an older revision, only with a visible `Updating…` label. A live
answer replaces both. Failure, refusal, close, permission changes and stale
responses remove the provisional content; it never becomes a current answer.

Saved display and Why-chain reads share an explicit context-owned parse cache.
It reserves `1024 + 32 * decodedBytes + compressedBackingBytes` before decoding,
inside the existing 48 MiB HTTP response-cache quota. This is a conservative
ownership charge, not an RSS measurement. A gzip trailer provides the admission
size; bounded native output and decoded-length validation reject forged sizes.
The general decoded limit is 1 MiB; writer display reads admit at most 256 KiB,
and saved Why-chain reads admit at most 2,048 task rows.
These are writer admission limits, not answer limits. A refusal carries
`TASK_WHY_UNAVAILABLE`; both task and Slayer disclosures then load validated full
details and definitions and call the same `buildWhyChain` as the full path.
Already-loaded full details are reused. Retry also repeats the full fallback,
and exact member/revision/scope guards reject stale full details before building
or painting an answer.
Invalidation clears timers and references on replacement, revision rebind,
eviction, expiry, deletion fence and close. Native in-flight decodes remain
pinned and charged until settlement; context close awaits that drain.

Writer display derivation admits at most 128 rows, 32,768 work units and a
512 KiB allocation estimate. Larger saved results go directly to the isolated
calculator snapshot probe instead of being parsed/scanned on the writer.
The calculator lazily builds a task-ID, dependency and set-membership index once
per immutable baseline, with a 100,000-row / 16-million-work-unit / 32 MiB
construction budget. It attaches that index through the existing snapshot
ledger before reuse. Native serialization charges the complete index graph,
conservatively including duplicate charges for referenced baseline rows. The
index shares the snapshot's picker ownership, admission, replacement and eviction;
there is no separate retaining cache. A failed admission marks the index
unavailable and preserves the full fallback.

Per-task calculator reads use the selected dependency/set buckets, with 400,000
work units and an 8 MiB allocation estimate; total catalogue row count does not
reject a selected task. Traversal and sorting costs are checked before allocating
filtered/sorted buckets. Work includes visited strings, blockers, diagnostics and
dependent sorts, plus cancellation checkpoints during index construction.
Related-label output is bounded before mapping it. UTF-8/JSON escape counting
checks the envelope without allocating its serialization; oversized arrays and
strings are rejected by length before walking/copying them. Only matching boss
gates and the four gate fields consumed by the explanation are projected, using
the same gate selector as the full answer. Budget exhaustion returns unavailable
without truncation and leaves the full loader available.

Successful scheduler replies are charged to its existing response cache; misses
are not cached. Snapshot ledger quotas, per-picker keys, fairness, process
isolation and normal list payloads are unchanged. The merge with `3b138b1` keeps
resident foreground planning, its cancellation watchdog and planning charges.
Both optional resident operations share idle physical-slot admission checks.
This change adds no saved JSON fields or data-directory files, so the save-surface
manifest requires no new entries.

## Verification gates

Declared before execution:

- Equal complete explanation objects and rendered line order for locked,
  missing-requirement, set, source, boss-gate and Slayer-gate cases, both
  members, Group on/off, and skill/quest/diary/BiS/generated-style categories.
- Real HTTP/worker equality against full task results after compact selected
  and duo-peer lists, plus saved-gzip and read-only paths.
- Full-loader fallback on unsupported/unavailable evidence; old live responses
  rejected before and during a worker read. Cached evidence paints only as a
  visibly provisional preview, then is replaced or removed.
- A hard 64 KiB envelope, no unrelated-catalogue growth, no added list fields,
  no full evaluation on a per-task miss, and picker isolation under colliding
  member/revision/input values.
- Shared parse-ledger admission/release, pinned native decodes, and WeakRef/GC
  collection while the owner remains reachable. GC is enabled only by this
  test's subprocess configuration. Provisional previews for Why, How and the
  chain disclosure cover replacement, failure, refusal, close and late responses.
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
| Off | one | 11,266 bytes | 337 bytes |
| Off | two | 11,423 bytes | 335 bytes |
| On | one | 11,441 bytes | 277 bytes |
| On | two | 11,531 bytes | 285 bytes |

Projecting only matching boss gates removes unrelated gate/gear data from this
fixture while preserving the explanation. No byte sample is used as a wall-time
measurement or as a production-size estimate.

A representative synthetic calculator catalogue has 20,560 tasks, descriptions
of ordinary length, chunk gates and dependency fan-out of fifteen siblings.
Its full task JSON is 57,970,672 bytes. The authenticated HTTP test measures:

| Explanation supplement | Calls | Transferred body bytes |
| --- | ---: | ---: |
| Full tasks plus definitions | 2 | 1,273,715 |
| One task's Why evidence | 1 | 282 |
| One task's How proof | 1 | 789 |

Both selected Why answers and How equal the full-path answers; no full-result
request or new evaluation occurs during those three narrow reads. The same
index is reused and charged 30,850,605 bytes to the snapshot owner. Independent
selected-read counters on a 20,560-task shape use 362–2,381 work units and
produce 324–581 raw bytes per answer.

The separate Lumbridge-only `duo-legacy`-scale regression has 20,436 tasks and
25,587,703 raw JSON bytes. Both task and Slayer chain requests refuse bounded
writer decoding, then recover through the full loader with answers identical
to `buildWhyChain`. Each cold fallback uses one refused narrow call plus the
two full supplement calls; its resulting chain is 2,991 or 3,059 raw bytes.
These loader counts and JSON sizes are separate from HTTP transfer measurements.
Adversarial dependency fan-out refuses within the selected-read budget before
sorting/serialization, and full details still answer. Oversized selected inputs
refuse before their elements are read or a projection is allocated.

## Verification results

All 188 distinct focused cases pass across the appropriate dataset runs.
Verification covers projection/loader/cache/budget tests, real HTTP
reads, picker isolation, selected scheduler/context-close tests, existing Why
components, Why-chain/How UI, HTTP responses, saved-evidence ownership and
task provenance. The scale tests add full-path equality, charged index reuse,
bounded adversarial work, task/Slayer fallback and disclosure retry recovery.
The HTTP cave cases each cover both members and include the old fallback and
a save landing during a worker read. The projection matrix compares 40
complete explanation objects and rendered line order. Merge verification also
runs all 29 resident-planning cases, 2 resident GC cases, 24 snapshot-ledger
cases and the 5 save-surface checks. The existing instant-screens tests are
unchanged; 18 new shared-preview cases verify replacement and removal for all
three explanation controls. `git diff --check` passes.

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
node --test --test-concurrency=1 tests/task-why-scale.test.mjs tests/task-why-scale-server.test.mjs
node --test --test-concurrency=1 tests/engine-cache-snapshot.test.mjs tests/resident-planning.test.mjs tests/resident-planning-gc.test.mjs
node --test --test-concurrency=1 --test-name-pattern="Why|shared cache quotas|duo lane validates|claim display revisions" tests/scheduler.test.mjs
node --test --test-concurrency=1 --test-name-pattern="deferred owned context eviction" tests/picker-calculator-cap.test.mjs
```

With the inherited/default dataset, the existing Why-chain and How UI checks
use their original synthetic fixtures:

```sh
node --test --test-concurrency=1 tests/task-why-chain.test.mjs tests/task-how-ui.test.mjs
node --test --test-concurrency=1 tests/explanation-preview.test.mjs tests/instant-screens.test.mjs
node --test --test-concurrency=1 tests/task-provenance.test.mjs
node --test --test-concurrency=1 tests/save-surface.test.mjs
node --test --test-concurrency=1 --test-name-pattern="Slayer" tests/info-panels.test.mjs
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
The merged save-surface fixture uses the default rule registry, so its check is
run with the default dataset rather than the F2P worker-fixture environment.
The browser smoke also selects the current Why control atomically after hover;
member/Group changes can replace a row between coordinate sampling and dispatch.
