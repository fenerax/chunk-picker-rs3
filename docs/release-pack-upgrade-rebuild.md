# Release-pack upgrade rebuild obligations

Baseline: `6c521a1` (current origin/main when branched). All 33 original native
case names remain unchanged, each with duplicate-name occurrence **1**, kind
**test**. The 29 PowerShell cases remain Windows pass / Linux platform skip;
the four portable cases remain pass on both OSes. Dataset inputs are authored
synthetic releases, digests and saves. No original case gains a skip.
The entry retains its full-suite, shared-execution, inherited-dataset policy;
compatibility children explicitly select their owned synthetic `duo-legacy`
packs. The native witnesses generate scale-1, seed-1 packs at versions
`1.0.0-old` and `1.0.0-new`; no operator inputs are used.

Baseline working-file SHA-256 (CRLF on Windows): `1cc0ab97d693195f40c2ef64b5612fb91a07181d09340de51db7e9a70d5b0f63`.
The Git baseline supplies the full source closure; release descriptors in the
controlled stage matrix retain digests `1` × 64 and `2` × 64 and revision 41.
The protocol matrix retains revision 9 and explicitly refuses latest revision 10.

## Root-cause evidence

First-attempt logs were requested with `gh run view RUN --attempt 1 --log-failed`.
Both workflows succeeded after internal Windows retries, so that command returns
no failed-job log. Their complete attempt-1 logs show:

| Run | Tested merge checkout | First native result | Isolated retry |
|---|---|---|---|
| 41955724209 | `cee18edcd0bb162ba7fcdcf29a8b8c49f615ca25` | 32/33; compatibility case `[object Object]`; 99.5 s | 33/33; 89.2 s |
| 41689200771 | `508bca43dadc153a99490e9547c7a2d9530f074b` | 32/33; compatibility case `[object Object]`; 104.9 s | 33/33; 94.2 s |

Those merge identities come from the checkout log, not the API PR-head SHA.
Neither historical receipt retains the child exception. They do **not** prove
one historical cause. The old implementation contains a product defect in the
compatibility/startup checker: free-port discovery relinquishes ownership before
the actual listen. Concurrent probes can select the same port. The product
checker and test stage runner also discarded stderr arriving after exit.
The test harness additionally rewrote an already-used release to make its
negative startup case and retried filesystem cleanup. The replacement removes
each of these defects without attributing every receipt to one of them.

The checker binds port 0 once, acknowledges spawned → ready → probe → closed,
then joins exit with a bounded stderr drain (or earlier close). Errors retain exit code, signal, original
spawn exception and stderr tail. Controlled lifecycle tests place stderr after
exit and refuse report reads before close or the controlled drain bound. A native witness executes the actual
current server/store/process-worker modules through owned release entrypoints,
with unique generated synthetic packs and a revision-17 save containing
synthetic progress. The checkout source stays immutable; fresh processes
isolate its module state.

## Exact old → new map

Every original identity below maps to the **same native case name** in
`tests/release-pack-upgrade-v2.test.mjs`. The stage executor moves to
`tests/helpers/release-pack-stages.mjs`; no product transition assertion is
replaced by a model of the transition.

| # | Original and replacement native case name | Replacement assertions |
|---:|---|---|
| 1 | upgrade interruption before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 2 | upgrade interruption after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 3 | upgrade interruption after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 4 | upgrade interruption after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 5 | upgrade interruption during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 6 | upgrade interruption unknown-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 7 | upgrade interruption uncertain-owner: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 8 | upgrade interruption failed-verification: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 9 | upgrade process-exit before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 10 | upgrade process-exit after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 11 | upgrade process-exit after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 12 | upgrade process-exit after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 13 | upgrade process-exit during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 14 | rollback interruption before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 15 | rollback interruption after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 16 | rollback interruption after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 17 | rollback interruption after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 18 | rollback interruption during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 19 | rollback interruption unknown-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 20 | rollback interruption uncertain-owner: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 21 | rollback interruption failed-verification: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 22 | rollback process-exit before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 23 | rollback process-exit after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 24 | rollback process-exit after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 25 | rollback process-exit after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 26 | rollback process-exit during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: hard nonzero termination + crash marker + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 27 | rollback interruption pending-after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 28 | rollback interruption pending-after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 29 | rollback interruption pending-during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 30 | compatibility uses separate packed startup processes, checks latest save both ways and refuses changed identity/binding | owned forward/reverse/refusal fixtures; four distinct PIDs and ordered acknowledgements; exact descriptors, progress and source hashes; stale evidence refusal |
| 31 | declared saved identity additions are exact and newly dataset-authored | unchanged exact additions/aliases/retargeting/missing/duplicate/newly-authored assertions |
| 32 | saved progress preservation allows only appended catalogue bookkeeping and retains every existing event | unchanged history prefix, type, archive, task and authoritative progress assertions |
| 33 | daily progress counts may recount only the latest day or start a new one; past days and real progress stay exact | unchanged latest-day recount, earlier-day prefix, roster, authoritative progress and legacy report assertions |

Three additional portable cases exercise authentic packed server/store/process
workers under each pack and controlled child exit/stream-close/error order. The resulting
entry initially had 36 cases. Five watchdog regressions bring it to 41 cases:
41 execute on Windows; eleven execute and 30 skip on Linux (the original 29 stage
cases and the new Windows process-tree witness). The existing release-pipeline HTTP adapter now derives its invitation
port from the bound address, so it remains valid when the checker uses port 0.

## Bounded failure after review

Review found a product regression in the rebuilt watchdog: killing the direct
child did not settle its promise if a descendant kept stderr open. A controlled
regression first failed against `1ce4198` because completion remained pending
after the watchdog fired, without any real-time delay.

`joinChild` now records exit code/signal independently and completes on exit,
allowing at most 100 ms for late stderr or earlier close. Inherited stderr EOF
is never a prerequisite for completion. The existing 180-second probe watchdog
also rejects independently of close. Windows timeout invokes bounded `taskkill /T /F`; POSIX probes use an
owned process group. Timeout also attempts a direct kill, destroys owned stdio, disconnects IPC and
unrefs the direct child even when kill fails or throws. It retains original
stderr and shutdown errors. A timeout cannot establish ownership release:
`checkPackTransition` preserves its scratch store and records its path in the
error and failure evidence. Test fixture teardown also preserves release inputs
when their child cannot be joined. If the stderr drain expires after a successful
acknowledged exit, remaining owned handles/processes are shut down and scratch
is retained; the report is still checked normally. The result/evidence names the
retained scratch directory. Pipe EOF alone cannot invalidate a successful probe.

The PowerShell stage executor was the only other newly introduced close-only
child waiter. It shares `joinChild` with a deadline matching its existing
30-second case deadline. Controlled tests cover no subsequent close, zero/nonzero
exit, signal exit, missing exit, failed/throwing kill, late close, retained scratch
save/failure evidence, and retained stage fixture teardown. No deadline increases
or real-time timeout waits are used for these regressions. The Windows tree
witness launches a synthetic parent and stderr-inheriting descendant, opens an
observer handle on that descendant, fires the injected watchdog, and joins the
descendant's actual exit. It covers both a live root and an already-exited root.
The leaf is explicitly detached and an observer confirms it is still alive after
root exit and before the controlled watchdog. The exited-root variant withholds
close through the endpoint seam. Descendant exit is
still verified through the actual process handle; closing the parent's pipe
alone cannot satisfy it.

`taskkill` can refuse an already-absent root. Cleanup also stops recorded
descendants through held process handles after checking their creation times,
so a recycled PID cannot address another session's process. Query and shutdown
commands have independent hard bounds. Their outcomes remain in the failure;
timeout/cancellation still fails with retained storage. A successful probe whose
stderr drain expires also retains storage conservatively.

Case cancellation now reaches both stage children and packed probes. An overall
case deadline stops its active child immediately instead of waiting for a later
per-child deadline. A controlled cancellation test verifies stage name, PID,
exit-without-close metadata and the descendant snapshot in its refusal.
Windows failures collect only the child parent chain using bounded
`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ...'` queries. A failed
query is recorded explicitly. Original failure details also go to stderr because
native test cancellation can replace the thrown error with a generic timeout.

## Hosted Windows investigation after review

The earlier deadlock diagnosis was not established by the evidence. Run
`42339076066`, job `128302665787`, at `918b01d` still failed after the hard-kill
change, including the throw-only `upgrade interruption before-journal` case.
Its script-entry marker is `04:36:05.7955856Z`; preflight is
`04:36:32.5595241Z`: 26.764 seconds elapsed before preflight. The 30-second
case deadline cancelled a still-running process. That is a test-harness timing
defect; `exited=false` and `closed=false` do not prove a deadlock. Prior run
`42336759588`, job `128295358293`, identified ten crash stages, but could not
distinguish slowness from deadlock. The hard-kill injector remains to preserve
unambiguous crash semantics.

Stage execution now owns one reusable Windows PowerShell host per file for
throw/recovery requests, with fresh function/script scope and an independent
fixture for every request. Ten hard-crash injections retain separate processes.
This reduces stage-host starts and common-library loads from 39 to 11 per file.
The shared host acknowledges completion on both stderr and stdout before any
fixture is released, and exits once at file teardown. An escaped fixture
function is refused before another request. Source copies preserve the actual
product functions; only timestamp statements around the nested Frozen-Bundle
dot-source and tick-lock acquisition are added.

Timestamped stderr markers delimit each explicit module import, each dot-source
(including Frozen-Bundle), fixture override setup, helper/tick lock acquisition,
every product phase, and request completion. Successful stage timing diagnostics
are retained by the existing stability runner too. No new workflow is added.
The old log cannot subdivide the observed 26.764 seconds; the next instrumented
GitHub Windows run must provide that breakdown rather than attributing it to
imports without measurement.

Per-case 30-second deadlines and real stage timers are removed. A single
10-minute emergency guard owns the whole file and reports/cleans up through the
existing cancellation diagnostics. It is a catastrophic hang guard, not a
performance assertion or a reset-on-progress poll. Requests are accepted only
after their acknowledgements and assertions; crash processes still require
nonzero exit plus their durable marker. Native packed startup and the existing
checker watchdog remain intact; #164 still owns that checker lifecycle.

The crash injector now writes its marker synchronously, then invokes
`[System.Diagnostics.Process]::GetCurrentProcess().Kill()`. This preserves a
hard crash without running finally blocks. Before recovery, the test requires
both a nonzero integer exit code and the exact crash marker. A startup failure
before the injection cannot satisfy those checks. Recovery, ownership, pause,
pointer, binding and save assertions are unchanged, as are all 33 original
case names. Existing stage and process diagnostics remain.

PR #164 owns the separate complete `runProbe` lifecycle fix. No lifecycle code
changes in this follow-up; after #164 merges, this branch will rebase and keep
its implementation as the base, with this PR's witnesses and injection seams.

Run `42327351951`, attempt 1, tested merge
`d68caac6c63c17a02865d0e03397e85bb3a9df7d` (PR head `1ce4198`). Seven Windows
shards failed their first assigned repetition. Job `128265689653` is Windows-1;
job `128265689612` is Windows-8. The latter's first timeout occurs approximately
33 seconds after file admission. The first 29 cases exercise stages without
starting a picker or calculator; the log cannot identify the timed-out case.
Its receipt reports 805082 ms, invalid/missing native counts
and timeout errors. It does not prove an inherited calculator pipe caused the
hosted failure. The uploaded receipts redact child details and the job log does
not include failed case names or stage/process phases.
Both logs contain two groups of five timeouts approximately 40–45 seconds apart,
matching the number and ordering of the ten crash cases, each of which launches
PowerShell twice. This is a diagnostic lead, not proof of the responsible case
or of module loading, antivirus, file locks or a surviving descendant.

A local run through the same adaptive runner and `laneEnvironment`, including
isolated home, temp and compile cache, passed 39/39 in 266.4 seconds before the
additional process-tree witness. The direct local run passed 39/39 in 198.8
seconds. This does not establish the hosted cause or a 50-repetition proof.
Stage stderr now retains named product phases; child diagnostics independently
record PID, exit time, close time, exit status, signal and tree-shutdown result.
The case owner emits original failures even when native case cancellation would
otherwise obscure them. Packed-probe errors also include acknowledged protocol
phases and timestamps.

The exact Windows workflow entrypoint (`.github/windows-slice/run.ps1
-Stability`, piped output, repository-root cwd with no spaces, Node 24.20.0 and
the isolated lane environment) reproduced a local failure before the final
descendant-cleanup change. Repetition 1 passed 41/41 in 261.296 seconds;
repetition 2 failed on its first attempt in 246.342 seconds. The old-pack native
witness reached its existing 30-second case deadline. Its completed report and
saved timing file show successful task serving followed by incomplete shutdown.
The diagnostic found a calculator child and console host; the root disappeared
before taskkill ran, and neither descendant remained alive when inspected later.
This proves that taskkill of an absent root is insufficient, not that a worker
remained permanently orphaned. The optional publisher memory-ceiling warning
does not establish the cause of the shutdown delay. Fixtures and the failed
first-attempt receipt were retained; the batch stopped without retry.

The earlier comparison with PR #164's run `42333821316` suggested a shared
pipe-EOF completion issue. That is a separate release-checker risk covered by
#164. The later named stage diagnostics above supersede it as the explanation
for these ten hosted crash-injection hangs.

The owner subsequently replaced the local-loop requirement: targeted files run
once locally, while the existing GitHub Linux and Windows stability jobs are the
proof of record. No further local repetition loop runs. The hosted cause is now
identified; the next ordinary Windows stability run must confirm the hard-kill
correction with 50/50. A local pass does not replace that proof.

## Acceptance evidence

The shared-host rebuild passed 41/41 in 110.415 seconds wall on Windows.
Stability tooling passed 12/12; repository provenance passed 1/1. Each affected
entry ran once under the heavy lock, BelowNormal, Node 24.20.0, one worker.
The trace confirms 39 stage executions across 11 processes. Local median import
times were 35 ms (Management) and 19 ms (Utility); dot-source medians were 24 ms
(Operator), 53 ms (ReleaseV2, including Frozen-Bundle) and 17 ms (Frozen-Bundle).
Fixture override setup median was 1 ms. These local measurements do not explain
the hosted 26.764-second delay; the instrumented hosted breakdown is pending.

Earlier hard-kill-only correction, retained as failed evidence:

The hard-kill correction's one targeted Windows run took 216.021 seconds
wall: 40 passed, one timeout/cancellation, exit 1. All ten crash-injection/recovery
cases passed. The separate existing Windows descendant-cleanup witness reached
its 30-second deadline waiting for its independent PowerShell exit observer.
Cancellation killed that observer (exitCode null); the log does not establish
why it remained pending. The failed receipt is retained without retry. Lifecycle
and real-process cleanup remain owned by #164, pending its merge and rebase.
Repository provenance passed 1/1. Each targeted file ran once, under the heavy
lock at BelowNormal priority, using Node 24.20.0 and one test worker.

Before this correction, the exit-plus-drain entry passed 41/41 on Windows in
162.193 seconds.
A temporary mutation restoring close-only drain settlement failed on its first
attempt in 0.340 seconds with `exit drain must settle without close`; the restored
controlled lifecycle check passed 1/1 in 0.342 seconds. This uses injected timers
and one controlled event turn, not a real-time timeout or condition poll.

See the PR body for measured before/after file times, three independent
temporary mutation outcomes and immutable-head hosted stability receipts.
No mutation, local proof runner, retry, timeout increase, quarantine or new
workflow is part of this change.
