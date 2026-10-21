# Linux viewer-test stability, 2026-10-15

Runtime fix: `3c320b0`. Private profiler compatibility: `344fa72`.
No dependencies or UI changes.

## Failure and cause

WSL Ubuntu reproduced a native process abort on the second baseline iteration,
using the exported public tree from `a9cafd2`. The viewer file stopped after
five passing cases, without an assertion failure. V8 reported
`Check failed: (location_) != nullptr` in
`SourceTextModule::AsyncModuleExecutionFulfilled`; Node reported `SIGTRAP` and
the file-level `test failed` result. The baseline log is
[retained locally](../../.local/viewer-ci/linux-baseline/run-2.log).

The calculator sent `ready` inside its asynchronously evaluated module body.
The scheduler could then retire that worker while V8 was still completing ESM
fulfillment. Short idle intervals in the viewer fixtures exposed this boundary.
A real-worker regression test witnesses dynamic-import completion and readiness
in order. It failed before the fix on Windows Node 24 (`ready` first), and passes
after the fix (`module-evaluated` first).

Readiness now runs in `setImmediate`, after module fulfillment and message-handler
registration. The shared calculator entrypoint also fixes this boundary for
sibling server fixtures and process-hosted calculators. Existing forced-stop
deadlines and scheduler behavior remain.

The viewer retention scenario now awaits each player's existing `task-ready`
SSE event. This replaces both availability polling and the sole fixed 200 ms
wait. All result, permission, sleep and revision assertions remain. Fixture
ports are OS-assigned; HTTP requests handle rejection, and server shutdown
ends SSE clients and clears their heartbeat on connection close. No port-reuse
failure was observed.

## Verification

- Linux stress: 30/30 iterations, 720 passing cases, no failures. Each iteration
  used strict unhandled rejections, a 120-second test timeout, concurrency 3,
  and the viewer, server-reliability and HTTP-response files under the heavy lock.
- Private focused check: 23 passed, including worker-idle lifecycle cases.
- Private quick: 1,488 passed, one existing skip, zero failures on Node 24.20.0.
- The single private full run: 4,227 passed, two existing skips, one failure.
  The moved readiness message invalidated a private heap-profiler source anchor.
  `344fa72` updates that instrumentation for deferred readiness while retaining
  the archived inline-readiness layout. All three focused harness checks pass;
  they also verify that instrumentation preserves deferred readiness. The full
  run's viewer and native worker cases passed. The full suite was not repeated,
  honoring the one-run limit. Its [complete log](../../.local/viewer-ci/private-full.log)
  retains the original failure.
- Post-profiler focused checks: 10 passed across the harness and export-fixture
  contracts. Logs: [harness](../../.local/viewer-ci/heap-harness.log) and
  [combined checks](../../.local/viewer-ci/post-profiler-targeted.log).
- Public quick on Node 24.20.0: 1,140 passed, one existing skip, zero failures.
  [Log](../../.local/viewer-ci/public-quick.log).
- Public full on Node 24.20.0: 2,379 passed, one existing skip, zero failures,
  under the heavy lock. [Log](../../.local/viewer-ci/public-full.log).

The [stress export receipt](../../.local/viewer-ci/stress-export.json) records a
clean scan, one public commit, no remotes and runtime source `3c320b0`.
The [final HEAD export](../../.local/viewer-ci/fixed-export.json), from `344fa72`,
has the identical public tree and commit after the private profiler fix. Its
scan is also clean. Both disposable copied saves were deleted after export.
After the suites, the public tree remained clean with zero remotes. The export
directory was deleted; the [cleanup receipt](../../.local/viewer-ci/export-final-audit.json)
records the final public commit and tree digest. No owned Windows calculator or
server process remained. No browser session or screenshots were needed.

Linux here provides Node 22.22.2; Windows provides Node 24.20.0. Hosted Ubuntu
Node 24 was not run. The native Linux crash explains the same class of failure
as the supplied CI summary; without its native crash output, identifying that
exact CI incident remains an inference.
