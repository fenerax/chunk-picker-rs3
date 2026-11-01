# Bounded public differential smoke

Linux `/proc`, Git and Node 24.20+ required; CI pins 24.21.0. No dependencies,
network fetch, private packs, save files or server. All inherited `RS3_*` values
are rejected. Calculator code always runs in owned clean detached worktrees,
including HEAD, with empty pack/map/data directories. Untracked application or
`.local` files in the harness checkout cannot contaminate the comparison.

Commit the harness before acceptance. Resolve both calculator SHAs explicitly:

```sh
sha=$(git rev-parse HEAD)
node scripts/experiments/y03-fuzz-ci/supervise.mjs --profile smoke --reference-ref "$sha" --candidate-ref "$sha" --out /tmp/public-smoke
node --test tests/y03-fuzz-ci.test.mjs
node scripts/test.mjs differential
```

The first is the sole routine CI smoke: same committed calculator SHA, cold
worker per request versus a retained warm worker. Quick tests contain generator,
normalization, PRNG, shrinker and report validation checks, with no real workers.
The differential-only integration file tests faults and lifecycle contracts.
It runs in `.github/workflows/differential.yml`'s Detector integration step,
outside both ordinary suites. Its native per-case report is required by the
coverage gate alongside the Linux and Windows reports; skipped detectors are
uncovered unless an exact reviewed exception applies. The differential job
waits for the main test job to pass before consuming another hosted runner.
Different committed implementations are supported by passing two local refs;
missing objects, operations or dataset compatibility fail setup. No fetch or
fallback to HEAD occurs. The separately committed harness SHA, calculator SHAs,
adapter/source digests, dataset digest, normalization version, corpus/state/result
hashes, seeds, counts and limits appear in the report and manifest.

Smoke uses seeds 19003/19004, two states, 29 primary and 29 reverse replay pairs.
It covers only 1/2 unlocked-state sizes, solo/duo owners, all nine operations,
both evaluation views, both returned duo projections, and decoded prediction
prepared/owner/partner reuse JSON. Deep uses 19003/19004/19005, twelve states,
174 primary plus 174 replay pairs, and adds 12/47/48 unlocked-state sizes. Use
`--profile deep` for the scheduled/manual campaign; it is not a PR gate.
Primary pairs alternate AB/BA; reverse replay runs BA. Cold replay resends saved
state; warm replay uses the recorded snapshot reference. Each side is compared
to its own first reply. The oracle detects cache divergence and observable
committed differences; it cannot establish common-mode game correctness.

## Maintained normalization policy: worker-json-v1

`semantic.mjs` sorts object keys and preserves array order, errors, statuses and
semantic counters. It excludes exactly:

- Root envelope `id`, `timingMs`, `evaluationMs`: request identifier and stage
  durations emitted by `app/tasks/worker.mjs`.
- `elapsedMs` directly inside nested `metrics` objects: evaluation duration
  emitted by `app/tasks/engine.mjs` and copied into projections/reuse payloads.
- `result.cache`: advisory hit/evaluation telemetry from sandbox, death-estimates
  and area-check worker paths. Other counters remain significant.

The adapter decodes `resultJSON`, `playJSON`, `duoJSON`, `duoSidebarJSON`,
`sandboxJSON`, and all prepared/owner/partner reuse JSON before normalization.
Current sandbox requests use the object transport; root `resultCache` is not
excluded. Other fields named cache, elapsedMs, id or timingMs remain significant
outside the specified paths. Compression bytes/metadata and non-enumerable flags
are explicitly outside this oracle. Policy changes require review and detector
integration tests. This is not the lane comparator.

## Bounds, evidence and cleanup

Requests have an external parent deadline of 5 seconds including worker startup.
RSS is sampled every 20 ms and includes Linux VmHWM, capped at 1,024 MiB per
bridge (worker threads included). Bridge/worker old-generation limits are
256/512 MiB configured ceilings. On pinned Node, the bridge CLI heap cap also
constrains worker isolates; the effective old-generation ceiling is no greater
than 256 MiB. A final-reply or retirement RSS violation fails. Sampling can
overshoot; this is not a cgroup guarantee. Historical public synthetic evidence
peaked at 1,166,094,336 aggregate sampled bytes; allow runner overhead above that.
No production-game speedup or fixed production timing threshold is claimed.

Campaign budgets include setup/replay/reduction/cleanup: 110 seconds smoke, 600 seconds
deep. The independent supervisor enforces 3/12 minute outer deadlines and kills
only its owned process group on timeout, SIGTERM, SIGINT and completion. CI uses
an ephemeral job container so runner teardown disposes of children even after
supervisor SIGKILL. External worktree cleanup is limited to validated owned
paths. Reports, logs, manifest, prefix and optional reduced witness are outside
the removed scratch directory, uploaded with `always()` and 14-day retention.
Upload after cancellation is best effort, subject to runner availability.

Exit codes: 0 pass, 10 difference, 11 request timeout, 12 worker/bridge crash,
13 RSS, 14 setup/protocol, 15 campaign budget, 16 engine error/cancellation,
17 replay noise. Supervisor external timeout exits 124; interruption exits 143.
Only exit 0 plus a strict parsed report with exact refs/adapters/seeds/counts,
`complete: true`, zero differences/errors/noise and intact budgets passes CI.
Missing, malformed or partial reports fail.

Direct fault/replay examples (each fault first requires a passing control):

```sh
node scripts/experiments/y03-fuzz-ci/run.mjs --reference-ref "$sha" --candidate-ref "$sha" --fault mismatch --cases 1 --shrink-attempts 2 --out /tmp/public-fault
node scripts/experiments/y03-fuzz-ci/run.mjs --replay /tmp/public-fault/reduced.json --shrink-attempts 0 --out /tmp/public-replay
node scripts/experiments/y03-fuzz-ci/run.mjs --replay /tmp/public-fault/failure.json --fault none --shrink-attempts 0 --out /tmp/public-control
```

Replay restores recorded local calculator SHAs after later harness-only commits;
explicit overrides must match. Full public prefixes are written before reduction.
The validity-preserving shrinker keeps the request owner and one unlock, with
12 attempts by default. Exhaustion is censored; global minimality is never
claimed. Sequence-dependent failures keep their prefix without requiring a
reduced case. Definitions/request shrinking is outside scope.

Finite detector limits: common-mode bugs, absent mechanics, real-pack scale,
concurrent scheduling, HTTP/storage, cancellation/supersession, cross-picker
cache isolation, and compressed-byte behavior. The unavailable main calc-check
and private eight-state calculator gates remain independent; this harness-only
integration changes no calculator source and needs no private data.
