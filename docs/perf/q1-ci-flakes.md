# Q1 CI flakes

START: `c185bd7c932d96642506b10c3c0935fb689b7d02`.
Branch: `ci/q1-flakes`. Public inputs only; no lab-data files were opened.
Node 24.21.0; Chromium 154.0.8037.57; Linux, CPU quota 4, memory limit 16 GiB.

## Reproduction

Run from the repository root, once at START and once with the changes:

```sh
export PATH=/opt/codex/cua_node/bin:$PATH
node --version
node scripts/perf/q1-flakes.mjs /tmp/q1-before 20 1
# After applying the changes, choose a new output directory:
node scripts/perf/q1-flakes.mjs /tmp/q1-after 20 1
```

The harness runs four independent loops alongside one continuous CPU burner.
Each loop launches Node with `--test-concurrency=4` and process isolation.
The browser loop selects the reported two-member pointer case; chunk planning
and lock recovery run their whole files. The fourth loop selects the recovery
scenario in `postmerge-retry-policy.test.mjs`, which creates the synthetic
`tests/opaque.test.mjs`. TAP logs and a JSON summary go outside the checkout.
Incomplete exploratory batches with four burners are excluded from these results.

## Causes and changes

- `tests/setup-guide-browser.test.mjs`: the setup timer started before navigation
  finished, and initial focus was checked immediately after `Page.bringToFront`.
  Navigation, foreground focus and layout complete independently. Wait for the
  load event, foreground focus and two rendering frames; use rendering frames
  instead of the 300 ms sleep. Preserve all focus/visibility/modal/close assertions
  and add diagnostics identifying which focus predicate failed.
  **Limit:** the exact reported initial-focus assertion did not fail in the
  baseline's 20 runs. Both observed browser failures were the initial setup
  readiness timeout at START line 62. Foreground/frame synchronization addresses
  the scheduling hazard, but its relationship to that exact CI failure remains
  unconfirmed.
- `tests/chunk-planning.test.mjs`: a single `setImmediate` does not finish an
  index that yields when its 8 ms budget expires. Four baseline runs failed the
  map-choice/fallback assertions. Observe the fake DOM's completed replacement;
  retain every content assertion. Force multiple index slices in the map test
  so it covers this schedule on an idle machine too. Applying just that forced
  clock to the old test fails before the panel is ready.
- `tests/linux-lock-recovery.test.mjs`: a fixed 50 ms hold can expire before the
  other seven contenders settle. Hold the winner until those promises settle.
  The lock code is unchanged. A Cloud draft also refused a lock that vanished
  during a contender's owner read, but review showed that was a serial
  re-acquire after the owner released, not overlapping critical sections, and
  refusing it could fail a daily backup with `EEXIST`. It was dropped.
- `tests/opaque.test.mjs` does not exist in the test tree. The recovery scenario
  in `tests/postmerge-retry-policy.test.mjs` generates it in a temporary repository
  and deliberately makes its synthetic runner fail once, then pass on retry.
  Its FLAKY warning is expected. No change to that test or retry/skip policy.
- `scripts/perf/q1-flakes.mjs`: reusable public-only load runner and TAP summaries.

## Why the public runner did not report FLAKY

At START, `scripts/test.mjs` calls `runAdaptive` directly. Neither it nor
`scripts/adaptive-test-runner.mjs` implements an isolated retry. The diagnostic
`FLAKY: initial failure passed once in isolation` is emitted by the private
companion release and post-merge runners through `retryFailedFilesOnce`.
Thus the retry did not apply to public failures 1–3; the missing label does not
show that they failed in isolation. The opaque warning comes from the synthetic
post-merge retry-policy coverage that the public suite itself executes.

## Results

| File/case | Before failures | After failures | Before median seconds (min–max) | After median seconds (min–max) |
| --- | ---: | ---: | ---: | ---: |
| `setup-guide-browser` | 2/20 | 0/20 | 13.19 (10.51–33.97) | 12.87 (9.81–18.94) |
| `chunk-planning` | 4/20 | 0/20 | 2.63 (0.92–6.98) | 1.18 (0.58–2.45) |
| `linux-lock-recovery` | 3/20 | 0/20 | 9.09 (7.17–29.08) | 8.33 (7.30–11.56) |
| `postmerge-retry-policy` | 0/20 | 0/20 | 7.24 (4.61–35.11) | 7.04 (3.94–16.48) |

The browser's before failures were startup timeouts, not the reported initial-focus
assertion (0/20 before and 0/20 after for that exact assertion). The retry fixture
emitted its deliberate opaque FLAKY warning in 20/20 runs both before and after.
These are loaded test-file wall times, including startup and teardown, not
application performance measurements. Memory footprint was not benchmarked.

The baseline batch passed 411 cases and failed 9; the after batch passed 460 and
failed 0. The two added lock regression cases account for 40 extra cases across
20 runs. Before the production fix those regressions failed 0-pass/2-fail;
after the fix they passed in every load run. An earlier focused run of chunk
planning, lock recovery and lock publication passed 31/31.

Final focused validation ran the three touched test files plus lock publication
and all three retry-policy scenarios: **38 passed, 0 failed, 0 skipped**, in
37.03 seconds. This includes all four browser member/input combinations.
`node --check` on all changed JavaScript files and `git diff --check` passed.

An additional diagnostic quick run incorrectly forced `RS3_DATASET=open-f2p`
for every file, including legacy catalogue tests. It was interrupted after
1174 passed, 68 failed, 2 cancelled and 13 skipped (134.86 seconds). Those results
are not the required default-environment quick gate; no tests were weakened or
skipped to accommodate that configuration mistake.

The required default-environment `npm run test:quick` completed all 342 files:
**3399 passed, 1 failed, 0 cancelled, 68 skipped**, in **963.93 seconds**.
The sole failure was the unchanged
`tests/picker-audit-c2.test.mjs:151` case, "MP14: import bodies time out on idle,
renew on bytes, and release picker admission". It sends bytes after fixed 120 ms
sleeps against a 200 ms idle deadline, making load sensitivity a plausible cause;
the public runner's IPC reduced the reported assertion error to `{}`.

The whole C2 file was rerun once in isolation using its reviewed
`RS3_DATASET=open-f2p` policy: **11 passed, 0 failed, 0 skipped**, in **10.85 seconds**.
It did not fail alone, so the sandbox fallback requiring a START comparison on
persistent isolated failure did not apply. This does not establish its precise
failure cause. No changes were made to that file.

Follow-up needed: reproduce the C2 idle-renewal assertion under load and replace
its fixed send timing with controlled clock/event synchronization in
`tests/picker-audit-c2.test.mjs:151`. That is outside the four reported Q1 cases.
The quick gate is not green; C2 and the unreproduced exact initial-focus failure
remain open. Recommendation: **NEEDS-WORK**. Status: **PARTIAL**.
