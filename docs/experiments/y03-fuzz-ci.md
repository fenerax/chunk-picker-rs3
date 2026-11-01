# Bounded public differential CI smoke: production validation

START: e431da314b682946c27f601ec78f17eab8a790eb. Branch: ci/y03-differential-smoke.
Node: v24.21.0. Accepted committed harness: ee577db73eb0d20f1563abd4c980b8f815f6a4b4.
Both calculator refs: e431da314b682946c27f601ec78f17eab8a790eb / e431da314b682946c27f601ec78f17eab8a790eb.
Application tree before and after: 4ca9356a6baac18e6fb8a573c81bf3f4b9adee00.

START had neither this harness nor a differential CI step; both absences were
checked before editing. This is a public CI improvement with no application,
calculator, dependency, release-data or lane-ownership changes. No private save
or pack was opened. No GitHub action, push, PR, production run or Wiki access
was performed.

## Changed files

- scripts/experiments/y03-fuzz-ci/generator.mjs: authored public definitions,
  deterministic PRNG, valid solo/duo states and nine-operation requests.
- bridge.mjs: cold/warm worker adapters and decoded full/play/duo/sidebar,
  sandbox and prepared/owner/partner reuse JSON; isolated fault injection.
- client.mjs: independent request deadlines, sampled/high-water RSS, final-reply
  checks and failures observed during retirement.
- semantic.mjs: reviewed normalization, hashes, difference paths and exit codes.
- shrink.mjs: bounded validity-preserving saved-state reduction.
- run.mjs: explicit local calculator refs, clean detached worktrees even for
  HEAD, reports/manifests, full failure prefixes, recorded-ref replay and cleanup.
- supervise.mjs and validate-report.mjs: independent process-group retirement,
  outer timeout, owned-path cleanup, diagnostics and strict acceptance checks.
- README.md beside those modules: commands, authoritative normalization policy,
  limits and finite detector claims.
- tests/y03-fuzz-ci.test.mjs: seven lightweight checks, with no real workers.
- tests/y03-fuzz-ci-integration.test.mjs: isolated controls/faults, resources,
  replay, changed committed refs and external cleanup.
- scripts/test-selection.mjs: quick units, full-only integration, solo admission.
- .github/workflows/test.yml: separate dependent public differential job.
- .github/workflows/differential.yml: pinned Node container, empty service
  environment, exact checkout Git trust, one explicit smoke, scheduled/manual
  deep, bounded timeouts and always-uploaded public diagnostics for 14 days.
- This document: final validation evidence.

Paths without a directory above are under scripts/experiments/y03-fuzz-ci/.
No smoke subprocess is hidden in quick. The public job uses no pack-fetch step,
private fixture mount or inherited secret/service environment. Container teardown
provides cleanup after supervisor SIGKILL; upload after cancellation remains
subject to runner availability.

## Validation

Targeted unit/classification files: 13 passed, 0 failed, 0 skipped.
Final isolated detector integration: 3 passed, 0 failed, 0 skipped;
100.181 seconds. Quick, run once: 2,988 passed, 0 failed, 68 skipped;
272.362 seconds. Full npm test was not run. Both workflow YAML files parsed,
and all differential step shell bodies passed bash syntax checking.

The detector checks required passing unmodified controls before status mismatch,
timeout and crash. Observed exits were 10/11/12; RSS and campaign budget exited
13/15. Fault-free prefix replay passed with two primary and two replay pairs.
Post-reply RSS and delayed retirement failure regressions passed. The mismatch
reduced 2216 to 2177 saved-state JSON bytes in 2 attempts;
censored: true. Reduced replay exited 10; no minimality is claimed.

The isolated committed calculator probe exited 10 with a known observable
counter difference. Main's calculator source stayed untouched. Exact refs:

- Reference: ee577db73eb0d20f1563abd4c980b8f815f6a4b4.
- Changed committed calculator: 15fc06297fa6b43db6f0df1c2a945a99851de750.
- Later harness-only commit: 576f4fd55ffb9bc665313ae5caa30cddc7bec310.

Replay after that later commit restored both recorded calculator refs and
exited 10. These test-only commits were made in an owned detached worktree,
then the worktree was removed. Missing local objects fail setup; no fetch or
HEAD substitution is performed.

External timeout and SIGTERM exited 124/143. Partial reports and logs survived;
SIGTERM also retained the already-written failure prefix. Owned scratch and
worktrees were removed, and no live owned process-group members remained.
Zombie entries are excluded from the live-process check because this sandbox's
PID 1 does not reap them. Hosted container teardown and artifact upload were
configured and reviewed, not executed here.

## Final-source public smoke measurements

Three serial controls executed the same calculator SHA on both sides. All
passed both process exit and the strict report gate: two completed cases,
29 primary plus 29 reverse replay pairs, exact refs/adapters/seeds and zero
errors, differences or noise. One state/result fingerprint across all runs.
No heavy work ran concurrently with these measurements.

| Run | Report wall seconds | Outer observed coordinator seconds | Cold / warm peak RSS bytes | Sampled coordinator + bridges peak bytes |
| --- | ---: | ---: | ---: | ---: |
| 1 | 55.892 | 55.965 | 430276608 / 381718528 | 1105211392 |
| 2 | 55.745 | 55.813 | 442204160 / 391827456 | 1161166848 |
| 3 | 56.078 | 56.144 | 425226240 / 400805888 | 1143808000 |

Median [min–max]:

- Report wall seconds: 55.892 [55.745–56.078].
- Outer observed coordinator seconds, including exit/cleanup: 55.965 [55.813–56.144].
- Cold request total seconds: 51.145 [50.500–51.162].
- Warm request total seconds: 0.498 [0.494–0.522].
- Cold peak RSS bytes: 430,276,608 [425,226,240–442,204,160].
- Warm peak RSS bytes: 391,827,456 [381,718,528–400,805,888].
- Sampled aggregate peak bytes: 1,143,808,000 [1,105,211,392–1,161,166,848].

START had no corresponding CI detector cost. Cold/warm are same-calculator
adapter costs, not before/after game implementation performance. The new gate
adds about a minute separately from ordinary quick tests. Cold totals include
worker bootstrap and retirement; retained-worker totals do not establish a
production game speedup. The recorded revision identifies the exact committed harness source measured
here; documentation and CI environment wiring do not alter those modules.

Fingerprints, using SHA-256 over JSON.stringify values (source text is JSON encoded):

- Adapter: 01fc2cf0fcd76abde6115f8c262347508a9178d478a20b22580c9da91b003306.
- Harness sources: f1eddaf670221e4e678f7ff71d756c84130ec738bd0190c919714b6e751cbe13.
- Dataset: 9debfc3f9e083fc5491a3c2a0d484b9c86b94eb096c17cc819f583d5be902dd4.
- Definitions: a7cc5edbe10007ee1d78d0c2b1588f9fc2839842022d93dda6711d8f4ce8b323.
- States: fddddc2d55416147a2f2b1fdb67b629ff0ad76eaca8e8cbfbf14ae9a44855488.
- Corpus: be0f4cc7814d744d2ecf450956abc4e0a9b3e54ac229daff628db3b924e8fecd.
- Results: 758503469a0e50ac0547b54b4e831e1472d935ca3bb8dd975c8888f4c5c9cbde.
- Normalization: worker-json-v1.

Raw local logs/reports were retained under /tmp/y03-production-validation;
the CI workflow retains corresponding public artifacts. Reproduction commands
and the normalization policy are in the harness README.

## Bounds and remaining limits

Smoke seeds are 19003/19004 and cover only 1/2 unlock-state sizes. The configured
12-state deep command adds 12/47/48, with seeds 19003/19004/19005, a 600-second
campaign budget and 12-minute outer timeout; it remains scheduled/manual and
was not run in this task. Smoke retains 5-second request deadlines, a 110-second
campaign budget including cleanup, a 3-minute outer timeout, 20 ms RSS sampling
and a 1,024 MiB high-water cap per bridge. Configured bridge/worker old-generation
ceilings are 256/512 MiB; pinned Node also propagates the stricter bridge CLI
heap cap into worker isolates. These are sampled guards, not cgroup guarantees.

This finite public oracle cannot establish shared game correctness, real-pack
scale, concurrent scheduling, HTTP/storage, cancellation/supersession or
compressed-byte behavior. Compression metadata and non-enumerable flags remain
outside comparison. Main's tools/calc-check was inspected and is unavailable;
it was not reported as passing. The conditional private eight-state calculator
gate did not apply because application/calculator source did not change.

Players will notice no gameplay change.

MERGE-CANDIDATE
