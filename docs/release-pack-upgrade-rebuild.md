# Release-pack upgrade rebuild obligations

Baseline: `6c521a1` (current origin/main when branched). All 33 original native
case names remain unchanged, each with duplicate-name occurrence **1**, kind
**test**. The 29 PowerShell cases remain Windows pass / Linux platform skip;
the four portable cases remain pass on both OSes. Dataset inputs are authored
synthetic releases, digests and saves. No additional skip is introduced.
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
checker and test stage runner also used exit before output-stream close.
The test harness additionally rewrote an already-used release to make its
negative startup case and retried filesystem cleanup. The replacement removes
each of these defects without attributing every receipt to one of them.

The checker binds port 0 once, acknowledges spawned → ready → probe → closed,
then joins the child's close event. Errors retain exit code, signal, original
spawn exception and stderr tail. Controlled lifecycle tests place stderr after
exit and refuse report reads before close. A native witness executes the actual
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
| 9 | upgrade process-exit before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 10 | upgrade process-exit after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 11 | upgrade process-exit after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 12 | upgrade process-exit after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 13 | upgrade process-exit during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 14 | rollback interruption before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 15 | rollback interruption after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 16 | rollback interruption after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 17 | rollback interruption after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 18 | rollback interruption during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 19 | rollback interruption unknown-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 20 | rollback interruption uncertain-owner: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 21 | rollback interruption failed-verification: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 22 | rollback process-exit before-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 23 | rollback process-exit after-journal: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 24 | rollback process-exit after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 25 | rollback process-exit after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 26 | rollback process-exit during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: real exit 75 + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 27 | rollback interruption pending-after-binding: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 28 | rollback interruption pending-after-pointer: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 29 | rollback interruption pending-during-start: reconcile under ownership, preserve current save | `assertStageRecovery`: named fault + recovery; exact pointer/binding/save/runtime, lock and pause assertions |
| 30 | compatibility uses separate packed startup processes, checks latest save both ways and refuses changed identity/binding | owned forward/reverse/refusal fixtures; four distinct PIDs and ordered acknowledgements; exact descriptors, progress and source hashes; stale evidence refusal |
| 31 | declared saved identity additions are exact and newly dataset-authored | unchanged exact additions/aliases/retargeting/missing/duplicate/newly-authored assertions |
| 32 | saved progress preservation allows only appended catalogue bookkeeping and retains every existing event | unchanged history prefix, type, archive, task and authoritative progress assertions |
| 33 | daily progress counts may recount only the latest day or start a new one; past days and real progress stay exact | unchanged latest-day recount, earlier-day prefix, roster, authoritative progress and legacy report assertions |

Three additional portable cases exercise authentic packed server/store/process
workers under each pack and controlled child exit/stream-close/error order. The resulting
entry has 36 cases: 36 execute on Windows; seven execute and the original 29 skip
on Linux. The existing release-pipeline HTTP adapter now derives its invitation
port from the bound address, so it remains valid when the checker uses port 0.

## Acceptance evidence

See the PR body for measured before/after file times, three independent
temporary mutation outcomes and immutable-head hosted stability receipts.
No mutation, local proof runner, retry, timeout increase, quarantine or new
workflow is part of this change.
