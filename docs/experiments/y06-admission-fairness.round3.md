# Round 3

| Item | Count / duration / hash |
| --- | --- |
| Branch | perf/y06-admission-fairness |
| Original START | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |
| Round-2 checkpoint | d64eef2275f3b7591b2d5e4831c209a66c2fbc64 |
| Node | 24.21.0 |
| CPU quota / memory ceiling | 4 / 16 GiB |
| Noisy / light / idle accounts | 2 / 4 / 14 |
| Noisy streams per account / reply pacing | 4 / 150 ms |
| Cancellation cadence / delay / retry | 13 / 2 ms / 1000 ms |
| Light / idle intervals | 2000 / 6000 ms |
| Quiet in-flight bound per picker | 2 |
| Measurement budget | 30 min |
| Short pairs / seed | 5 |
| Seeds | 17,73,211 |
| Seed-73 long pairs | 1 |
| Arrival windows | 24 s / 120 s |
| Contexts / calculators | 7 / 2 |
| Cold global / account leases | 1 / 1 |
| Cold pending global / account | 64 / 2 |
| Cold deadline / retry interval / maximum retries | 2000 ms / 25 ms / 80 |
| Account / picker / global request quota | 600 / 600 / 1200 per 60 s |
| Calculator queue / picker outstanding jobs | 8 / 4 |
| Client deadline / drain deadline | 5000 ms / 5000 ms |
| RSS guard / sampling interval / post-drain samples | 3072 MiB / 50 ms / 3 |
| Cancelled pooled-job grace candidate | 25 ms |
| Phase-0 attribution windows | 1 × 24 s, seed 73, before only |
| Private-path accesses / copied-save reads | 0 / 0 |

| Authorized candidate file | Candidate change |
| --- | --- |
| app/tasks/scheduler.mjs | 25 ms cooperative cancellation grace; hard-retirement fallback |
| app/picker-context.mjs | demand-loaded owned-context play response preparation |
| app/server.mjs | owned-context preparation option |

Five interleaved pairs per seed; failure-at-observed-time and failure-at-2000-ms
both retained. Nine p95 gates: after <= before + max(5 ms, 10%). Tasks/Draft p95
also <= before maximum. Per-request p95/p99 attribution separates admission,
context-opening components, calculator queue, calculator service and host startup
overlap. All three seeds use the same five-pair method. All attempts and quiet
failures remain counted. No changed hard limit, private input or copied-save
reader. All prior-round evidence retained. Finite larger redesign: report only.

| Trace attribution | Interval / count |
| --- | --- |
| Admission/residency | acquisition − factory − eviction |
| Context open | factory interval; store/auth/variant/play components |
| Calculator queue | queued → started, request and factory stages separate |
| Host startup | union(allocate → ready) ∩ calculator queue |
| Calculator service | started → final reply |
| Rank rows | per-trial endpoint p95 and p99 requests |
| Outlier retention | every quiet failure and every success ≥250 ms |
| Nested interval addition | 0 |
| Application files added in round 3 | 0 |
| Application files changed in round 3 | 3 |
| Calculator computation / protocol files changed | 0 / 0 |
| New production tests | 4 |
| Enlarged hard limits | 0 |

`app/tasks/scheduler.mjs`: cancelled pooled jobs retain the existing host for
25 ms; cooperative completion dispatches queued work; fallback retirement keeps
the physical slot until exit. Grace timers clear on completion, failure, restart,
sleep and shutdown. Cancellation also pumps already-queued work.

`app/picker-context.mjs` and `app/server.mjs`: owned readiness retains rule
preparation and defers the play response. The state route prepares the existing
revision-keyed response on demand. Default context preparation remains eager.
No storage or calculator-pool application change.

Before/after component durations describe rank-selected requests. The two
contained changes are measured together; independent effect sizes are not
claimed. Noisy arrivals remain closed-loop; RSS and CPU are not equal-work
speedups. Tasks/Draft have 12 samples per short trial: their p95/p99 are maxima.
The 120-second comparison remains separate; 1 pair is partial long-run coverage.

| Schedule seed | Window s | Scheduled quiet | Arrival SHA-256 |
| ---: | ---: | ---: | --- |
| 17 | 24 | 104 | 33c0b716baccaab6dfc0758c3cb3fe40ece3ca79bf219fd967b0fdc23addc0a4 |
| 17 | 120 | 520 | 540b5cc48f0b5b33168f42300d19d29b8368e623cd7c3f293b916427f6b8a6d6 |
| 73 | 24 | 104 | b46cd0c47e27803299c2103ead3c33716c62e92629bbbccbd835d084000353d6 |
| 73 | 120 | 520 | ed6801532dcbacc422b8b5298d8122ff8bc8c399fc274d24eb1acfb3fbb889bb |
| 211 | 24 | 104 | 4985cf897dff6c162ebfb92856a861b78dde150637fde274e16b4f54fb162a07 |
| 211 | 120 | 520 | 744f87d8c72d6e8bcb9683c4e75c3b2f2a58ef75d7dbe9798e78cb30203c2d48 |

Arrival schedule changed lines versus round 2: 0. Schedule hashes cover the
ordered synthetic picker-index/due-ms/endpoint triples; no response timings.

| Primary gate | Count |
| --- | ---: |
| Completed short trials / censored | 30 / 0 |
| Completed matched pairs per seed | 5 / 5 / 5 |
| Quiet scheduled / successes before | 1560 / 1560 |
| Quiet scheduled / successes after | 1560 / 1560 |
| Actual p95 / p99 gates | 9/9 / 9/9 |
| Ceiling p95 / p99 gates | 9/9 / 9/9 |
| Tasks/Draft p95 maximum within before maximum | 6/6 |
| Candidate quiet maximum duration | 123.94 ms |
| Quiet refusal / timeout / local shedding counts | 0 / 0 / 0 |
| Primary attempts | 28998 |
| Primary wall duration | 955.591 s |
| Primary drain RSS samples | 90/90 |
| Candidate advisory allocations / retirements | 15 / 0 |
| Before advisory allocations / retirements | 134 / 119 |
| Candidate grace starts / cancelled completions | 123 / 673 |
| Validation / post-close child / OOM / RSS-guard differences | 0 / 0 / 0 / 0 |

| Seed-73 p95/p99 rank attribution | Before ms | After ms | Difference ms |
| --- | ---: | ---: | ---: |
| Tasks total | 84.9 | 62.0 | -22.9 |
| Tasks context open | 51.7 | 16.0 | -35.8 |
| Tasks admission/residency wait | 0.4 | 11.5 | +11.1 |
| Tasks calculator queue | 0.0 | 0.0 | 0.0 |
| Tasks calculator service | 22.3 | 28.2 | +5.9 |
| Draft total | 232.9 | 77.0 | -155.9 |
| Draft calculator queue | 190.6 | 8.0 | -182.6 |
| Draft host-start overlap inside queue | 97.2 | 0.0 | -97.2 |
| Draft context open | 26.6 | 25.9 | -0.7 |
| Draft calculator service | 30.5 | 31.5 | +0.9 |

Tasks: context opening dominates the before rank rows. Draft: advisory queue
wait and replacement-host startup dominate. Neither has an admission-deadline
wake-up. Direct play-preparation removal is 6.6 ms in the seed-73 Tasks rank rows;
remaining store/auth duration differences are observed, not individually
attributed. Rank-row medians and their differences are not additive.

| Primary RSS MiB, median [min–max] | Before | After |
| --- | --- | --- |
| Peak | 726.9 [679.7–757.7] | 759.9 [696.1–770.8] |
| Post-drain | 677.2 [640.9–732.5] | 747.3 [686.8–760.5] |

Full numeric quantiles, all nine gates, per-rank intervals and spreads:
[measurements](y06-admission-fairness.round3-measurements.md).
All rank rows and every quiet failure/success ≥250 ms:
[attribution](y06-admission-fairness.round3-attribution.results.json).

| Seed-73 120-second pair | Before | After |
| --- | ---: | ---: |
| Quiet successes / scheduled | 473/520 | 469/520 |
| State failures / attempts | 0/400 | 0/400 |
| Tasks failures / attempts | 23/60 | 24/60 |
| Draft failures / attempts | 24/60 | 27/60 |
| Global-quota quiet refusals | 47 | 51 |
| Global counter / quota at every quiet refusal | 1200/1200 | 1200/1200 |
| Quiet account maximum / quota at refusal | 9/600 | 8/600 |
| Quiet cold queue/account/deadline/lease refusals | 0 | 0 |
| Quiet calculator refusals | 0 | 0 |
| State actual p95 / p99 ms | 110.7/137.9 | 72.8/108.2 |
| Tasks actual p95 / p99 ms | 80.3/101.0 | 74.4/99.6 |
| Draft actual p95 / p99 ms | 299.3/353.3 | 78.6/85.3 |
| Tasks ceiling p95 / p99 ms | 2000/2000 | 2000/2000 |
| Draft ceiling p95 / p99 ms | 2000/2000 | 2000/2000 |
| Advisory allocations | 28 | 1 |
| Peak RSS MiB | 764.8 | 795.2 |
| Post-drain RSS MiB | 726.0 | 784.8 |
| Valid drain RSS samples | 3/3 | 3/3 |
| Validation / post-close children / OOM differences | 0/0/0 | 0/0/0 |

Global-quota losses remain deliberate overload: an exhausted 1200-unit window
cannot admit another expensive request under the unchanged policy. No cold
admission or calculator share caused these 98 losses. The after count is 4 higher
in this single pair; closed-loop noisy work differs. Fast refusals do not prove
service: ceiling Tasks/Draft p95/p99 stays 2000 ms. Quiet reservations would trade noisy admissions for lower quiet quota losses.
Estimated redesign scope: 1 budget-owner module (`app/security/picker-limits.mjs`)
and at least 2 accounting/HTTP test files, followed by repeated quota-window
measurement. Global/account limits would remain 1200/600. Implementation and
measured effect size: 0; no such quota-policy change is implemented or claimed.
Long repetition coverage is 1 pair, not 5 pairs. Larger lifecycle redesign: 0.

| Round-3 changed file | Change / count |
| --- | --- |
| app/picker-context.mjs | owned play-preparation option |
| app/server.mjs | owned preparation deferred |
| app/tasks/scheduler.mjs | 25-ms grace, cancellation pump, exact timer cleanup |
| tests/picker-calculator-cap.test.mjs | 3 correct cancellation/retirement/shutdown tests |
| tests/picker-context.test.mjs | 1 deferred/eager response-equivalence test |
| scripts/perf/y06/admission.mjs | source-hash inventory 3 → 6; arrival changes 0 |
| scripts/perf/y06/trace.mjs | context component and host lifecycle probes |
| scripts/perf/y06/round3-report.mjs | actual/ceiling/success quantiles; rank attribution; bounds guards |
| docs/experiments/y06-admission-fairness.round3.md | protocol, counts, attribution, limits |
| docs/experiments/y06-admission-fairness.round3-measurements.md | generated endpoint and component tables |
| docs/experiments/y06-admission-fairness.round3-attribution.results.json | generated rank rows and every ≥250-ms quiet tail/failure |
| docs/experiments/y06-admission-fairness.round3-primary.results.json | 30 comparison trials |
| docs/experiments/y06-admission-fairness.round3-long.results.json | 2 comparison trials |
| docs/experiments/y06-admission-fairness.round3-phase0.results.json | 1 before-only attribution diagnostic |
| docs/experiments/y06-admission-fairness.round3-smoke.results.json | 1 after-only 8-second diagnostic |

| Verification boundary | Count |
| --- | ---: |
| Comparison attempts / quiet scheduled | 35197 / 4160 |
| Comparison trials / censored | 32 / 0 |
| Comparison drain RSS samples | 96/96 |
| Recorded diagnostics / comparison trials | 2 / 32 |
| Measurement wall duration, diagnostics included | 1261.359 s |
| Measurement budget | 1800 s |
| Reported sensitive-value keys | 0 |
| Frozen application hash sets | 2 |
| Earlier-round numeric changed files | 0 |
| New test files requiring classification | 0 |
| Private-path accesses / copied-save reads | 0 / 0 |
| Private calculator / capacity comparisons | 0 / 0 |
| High-tier / hours-long comparisons | 0 / 0 |
| Deployment / push / PR actions | 0 / 0 / 0 |

RSS median differences: peak +33.0 MiB, post-drain +70.1 MiB in the primary
comparison. Work counts differ, so no equal-work RSS/CPU saving is claimed.
Private capacity and hours-long retention coverage remain 0. Calculator
computation and protocol changed files remain 0; HTTP validation differences
are 0, without a full semantic-corpus claim.

Reproduction uses the frozen round-2 checkpoint and public inputs only:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
git worktree add --detach /tmp/y06-r3-before d64eef2275f3b7591b2d5e4831c209a66c2fbc64
node scripts/perf/y06/admission.mjs --baseline /tmp/y06-r3-before --out /tmp/y06-r3-primary.json --pairs 5 --seeds 17,73,211 --seconds 24 --trace --budget-minutes 30
node scripts/perf/y06/admission.mjs --baseline /tmp/y06-r3-before --out /tmp/y06-r3-long.json --pairs 1 --seeds 73 --seconds 120 --trace --budget-minutes 6
node scripts/perf/y06/round3-report.mjs --primary docs/experiments/y06-admission-fairness.round3-primary.results.json --long docs/experiments/y06-admission-fairness.round3-long.results.json
```

| Artifact / source | Bytes | SHA-256 |
| --- | ---: | --- |
| app/picker-context.mjs | 168232 | 1fbf1b0cc2027e2810fc5332540bc61072c27cf6c4a661d7aa8c8c75c824d680 |
| app/server.mjs | 42560 | ccb98cc63725d15739134cb1b604e53170f52106cfd8e579ee4afaa4a57ddd6d |
| app/tasks/scheduler.mjs | 82627 | 4434764088e4641fec765c73dc9da0edba3a976ddc00e3191cab47432df380da |
| tests/picker-calculator-cap.test.mjs | 29710 | 2aa8326c346014fc3fd9febc41879b00836667c7b32d8f52181629a87e950c48 |
| tests/picker-context.test.mjs | 30446 | 411ffab68a9a5f09d16f22c925759c62bdbd04ce8bd6789e49cafd83bb2b2465 |
| scripts/perf/y06/admission.mjs | 23019 | 75d9eb925f5420549e5cebbec5a3c7f1a6bca5b873b808d45f774fdb2a5a23d3 |
| scripts/perf/y06/trace.mjs | 6737 | 3c1055edbb634cd66ddeba5eccfaf9f8db2278376f20381d3e312d4bac2d6ec1 |
| scripts/perf/y06/round3-report.mjs | 15077 | 0fea6b875965b25a848874c52700f6d674d00165c1ec40697faad9035f7c5f9a |
| docs/experiments/y06-admission-fairness.round3-primary.results.json | 3533778 | f69fe5d9812a9e2adbfbca66106a4a229a151d2c75cdfa02082838d5ad8ab82f |
| docs/experiments/y06-admission-fairness.round3-long.results.json | 1014902 | 75afa32567e523457e4cf7807ce73ca56cf35ac7fe6220df8f8dd175b1b04aaf |
| docs/experiments/y06-admission-fairness.round3-phase0.results.json | 116994 | bae8d455c9c5bd9a0545a1c0b4e767febae793d207aec4d491e24df5abd73012 |
| docs/experiments/y06-admission-fairness.round3-smoke.results.json | 59448 | a8ca491484e1f293e72589c392b1ee5d717e36bb9e22c4b9f66ba9f351698a6f |
| docs/experiments/y06-admission-fairness.round3-attribution.results.json | 297298 | 20ec5626402cb8f5ee06cdc0d17425e2848c030ba248bfe92cf2c6b2f2131508 |
| docs/experiments/y06-admission-fairness.round3-measurements.md | 33324 | 4bc792aa077df5ed8ff88f929d7c63c2ca97e55fe2d27f39bd0d89f8dcf96836 |

| Tests | Pass | Fail | Skip | Duration ms |
| --- | ---: | ---: | ---: | ---: |
| Before-patch cooperative-retention reproduction | 0 | 1 expected | 0 | 812.5 |
| Narrow context/cap/retirement/fairness | 69 | 0 | 0 | 4934.8 |
| Final focused 11 files | 160 | 0 | 0 | 16773.1 |
| Quick, 1 run | 3030 | 0 | 68 | 241200.1 |
| Changed JavaScript syntax, 8 files | 8 | 0 | 0 | — |
| Full suite runs | 0 | 0 | 0 | — |

Focused files: `picker-admission.test.mjs`, `picker-limits.test.mjs`,
`picker-routing.test.mjs`, `picker-limits-http.test.mjs`,
`picker-calculator-cap.test.mjs`, `picker-fairness-isolation.test.mjs`,
`picker-context.test.mjs`, `advisory-retirement.test.mjs`,
`startup-warmup.test.mjs`, `startup-timing.test.mjs`, `test-selection.test.mjs`.

The 4 new correct tests cover cooperative reuse, 25-ms fallback with a real-exit
slot barrier and late reply, shutdown/late timer cleanup, and deferred/eager
revision-correct state equality. The before-patch retention assertion fails;
all final focused and quick assertions pass. An initial narrow run had 68 pass /
1 failure from an uninitialized fake-worker termination flag; initializing its
existing lifecycle state fixed the fixture. No assertion was weakened.

READY

Players see shorter Tasks and Draft waits while other sessions cancel work.

## Raw result files

The raw `*.results.json` files these reports cite (about 10 MB, all from synthetic Cloud runs) are not committed, to keep the repository small. The maintainer keeps them locally. Each file's size and SHA-256:

| File | Bytes | SHA-256 |
|---|---:|---|
| `y06-admission-fairness.cycles.results.json` | 60,669 | `84c69469c7d16b1c551f89c98e5e2388a76783c382649935c702ceb44c0a2527` |
| `y06-admission-fairness.long.results.json` | 311,854 | `93352f7bf9fc7c2a51c199e7871d01da4dc852451eb452436be6c5ef44775908` |
| `y06-admission-fairness.primary.results.json` | 890,453 | `b5c825fafd8f0477415aeb3240ab3be33029e78176f8aecb570163b911627e4e` |
| `y06-admission-fairness.reproduction.results.json` | 28,949 | `6c37eb4b8e8b7cb71b4a6d72e18c468e7efa5a235e056989287bb415aab032f7` |
| `y06-admission-fairness.round2-confirm.results.json` | 398,603 | `a2905d5201c656969ce71907590943403841e963e8fc7c12e3680e9057b84e79` |
| `y06-admission-fairness.round2-long.results.json` | 1,734,322 | `69d236f5576a2e108c0d9c571ccced65ebb37ccbf135f21352890351e3d26a3c` |
| `y06-admission-fairness.round2-primary.results.json` | 1,804,587 | `f6359860b6ce2c86d39ab1e96499bec894d0e6d50b3f806d320e33f8218c0f95` |
| `y06-admission-fairness.round3-attribution.results.json` | 297,298 | `20ec5626402cb8f5ee06cdc0d17425e2848c030ba248bfe92cf2c6b2f2131508` |
| `y06-admission-fairness.round3-long.results.json` | 1,014,902 | `75afa32567e523457e4cf7807ce73ca56cf35ac7fe6220df8f8dd175b1b04aaf` |
| `y06-admission-fairness.round3-phase0.results.json` | 116,994 | `bae8d455c9c5bd9a0545a1c0b4e767febae793d207aec4d491e24df5abd73012` |
| `y06-admission-fairness.round3-primary.results.json` | 3,533,778 | `f69fe5d9812a9e2adbfbca66106a4a229a151d2c75cdfa02082838d5ad8ab82f` |
| `y06-admission-fairness.round3-smoke.results.json` | 59,448 | `a8ca491484e1f293e72589c392b1ee5d717e36bb9e22c4b9f66ba9f351698a6f` |
