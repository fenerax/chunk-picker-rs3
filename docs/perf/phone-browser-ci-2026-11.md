# Phone browser CI investigation — 3 November 2026

START `00e48b6aa95ecdb7308b73584e990c978ed91512`. Before #107: `c69240de830b73d42b8a4a8133fa4654a0a10e1c`.

All stores and states were synthetic. The lab checkout and private save were not opened. Runs used Node v24.21.0 and Chromium 154.0.8037.57 on Debian 13, one browser test file at a time.

**Phone timeout: flake.** Saved state is available while backup and task reads are still running; the delayed calculator caption can move the header by 45 pixels between hit testing and a native touch. Captured events also showed dock swipes landing on fixed phone tabs, leaving document momentum that consumed a later tap. The final harness waits for actual API completion and the caption’s final paint, accounts for tab occlusion, and observes scrolling ancestors before continuing; it keeps every original native interaction.

**Fresh backup warning: flake.** The backup-health read runs independently of state hydration, so “Saved” does not mean its warning has rendered. The failing first case uses a fresh profile, so no saved first-paint snapshot is available there. The harness now waits for the backup status to leave its checking state, then performs the unchanged visibility assertion; all 12 cases and 666 checks remain.

**ENOTEMPTY: flake.** The first pre-#107 short-height run passed all 666 checks and then failed removing the Chrome profile. A Browser.close acknowledgement precedes process exit, and signalling immediately can interrupt profile shutdown. The shared harness now waits for the owned process to exit, handles exit without a CDP acknowledgement, preserves its bounded termination fallback, and the two affected cleanup sites use rm with maxRetries: 5.

The calculator-feedback, backup-status, phone layout, and map-control discovery implementations responsible for these timings are unchanged between the two app revisions. App code, game rules, pools, and results were not changed by this fix.

File-level results below come from three baseline repetitions per revision and three final repetitions per browser file. Durations cover the whole test file, including browser startup, native interaction, and cleanup; they are not app-startup benchmarks.

| Revision | Browser file | Passing runs | Node test pass / fail | Median seconds | Min–max seconds |
| --- | --- | ---: | ---: | ---: | ---: |
| c69240d | phone-controls | 3/3 | 18 / 0 | 43.367 | 42.932–47.312 |
| c69240d | short-height | 2/3 | 2 / 1 | 178.994 | 176.064–180.843 |
| START | phone-controls | 3/3 | 18 / 0 | 41.652 | 39.636–43.234 |
| START | short-height | 3/3 | 3 / 0 | 188.507 | 178.857–201.820 |
| Final | phone-controls | 3/3 | 18 / 0 | 51.368 | 48.520–51.389 |
| Final | short-height | 3/3 | 3 / 0 | 180.524 | 172.522–184.533 |

The pre-#107 short-height failure was cleanup only: its 666 browser checks passed. The final short-height repetitions each completed all 666 checks, with zero failures and zero skipped cases. The final phone repetitions passed all 18 cases, with zero skipped cases.

An extra untouched START short-height run, used to check later browser failures, passed all 666 checks in 184.428 seconds; it is separate from the initial three-run comparison.

Controlled reproduction: `node scripts/perf/phone-startup-timing.mjs /path/to/checkout` passed against both untouched app revisions. Both reported the warning absent before its genuine response and present afterward, a 45-pixel calculator-caption shift, a missed native tap using the old coordinates, and zero browser exceptions. The phone test’s first case now holds genuine backup, stream, and calculator responses to exercise this ordering without response stubs or a timing sleep.

`node --test tests/cdp-scratch-port.test.mjs`: 6 passed, 0 failed. The new graceful-exit test was also run against START’s original helper and failed for the expected premature-cleanup reason (4 passed, 1 failed).

`npm run test:quick` ran once: 3444 passed, 0 failed, 68 skipped; duration 593.346 seconds. The full npm test suite was not run.

Changed files:

- `tests/phone-controls-browser.test.mjs`: settled native coordinates, delayed real startup responses, fixed-tab occlusion, ancestor momentum, descriptive readiness errors, and cleanup retries.
- `scripts/perf/short-height-browser.mjs`: await independent backup health before asserting the warning, and retry profile cleanup.
- `scripts/perf/cdp.mjs`: bounded graceful Chrome shutdown, including exit without an acknowledgement.
- `tests/cdp-scratch-port.test.mjs`: process-lifecycle coverage using synthetic transport fixtures; the existing file remains classified as quick.
- `scripts/perf/phone-startup-timing.mjs`: retained synthetic real-server reproduction of both startup layout races.

Limits: CI uses Ubuntu and Node 24.22 rather than this environment. The empty CI timeout does not identify its exact native step; matching that individual attempt to one of the locally captured mechanisms remains an inference. During diagnosis, earlier candidates produced five phone-case failures across four runs, which supplied the native hit-target and scrolling evidence. An experimental broader short-height wait also encountered one native key-event acknowledgement timeout and one startup timeout; their cause was not proven. That extra stream wait was removed from short-height because its warning check only needs backup health and the broader wait brought its successful run to 219.869 seconds against the existing 230-second child limit. Final repeated results are reported separately above; no timeout was increased and no check was weakened or skipped.
