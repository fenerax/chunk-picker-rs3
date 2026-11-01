# Round 4

| Protocol | Count / hash / duration |
| --- | --- |
| START | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |
| Attribution seed / pairs / seconds | 73 / 1 / 24 |
| Attribution budget | 25 min |
| Attribution GC flags | 0 |
| Snapshot stages per mode | 1 |
| Snapshot RSS inclusion in primary campaign | 0 |
| Primary seeds / pairs / seconds | 17,73,211 / 5 / 24 |
| Primary budget | 45 min |
| Primary --expose-gc flags before / after | 1 / 1 |
| Primary manual collection calls | 0 |
| Default context / calculator idle | 600000 ms / 600000 ms |
| Post-idle no-traffic interval | 610000 ms |
| Peak RSS guard / interval | 3072 MiB / 50 ms |
| Quiet client bound / deadline | 2 / 5000 ms |
| Admission deadline | 2000 ms |
| Calculator hosts / contexts / queue | 2 / 7 / 8 |
| Per-account / global quota per 60000 ms | 600 / 1200 |
| Post-idle main RSS difference allowance | +10 MiB |
| Linux service --expose-gc flags | 1 |
| Historical comparison --expose-gc flags | 0 |
| Private / copied-save reads | 0 / 0 |

| Result | Count / duration / difference |
| --- | ---: |
| Original no-GC attribution trials / censored | 2 / 0 |
| Main-process heap snapshots / private snapshots | 2 / 0 |
| No-GC post-idle main RSS difference before cleanup | +4030464 bytes |
| Collected no-GC heapUsed difference | +213088 bytes |
| Collected no-GC arrayBuffers difference | -65536 bytes |
| Historical +64.6-MiB capture heap snapshots | 0 |
| Historical exact-retainer attributions | 0 |
| Candidate-only V8 retainers at least 64 MiB | 0 |
| Harness admission observer records before / after | 0 / 450 |
| Harness observer-record shallow bytes after | 36000 |
| Admission groups Map shallow bytes / final pending | 32 / 0 |
| Additional live SharedArrayBuffers | 0 |
| Cancellation-grace retained values / shallow bytes | 0 / 0 |
| Service-profile primary trials / censored | 30 / 0 |
| Primary duration / budget | 2165859 ms / 2700000 ms |
| Primary quiet successes before / scheduled | 1206 / 1560 |
| Primary quiet successes after / scheduled | 1560 / 1560 |
| Quiet refusals before / after | 354 / 0 |
| Actual p95 / p99 gates | 5/9 / 5/9 |
| Ceiling p95 / p99 gates | 9/9 / 9/9 |
| Tasks/Draft actual before-range gates | 4/6 |
| Post-idle main RSS before / after | 204419072 / 157061120 bytes |
| Post-idle main RSS difference | -47357952 bytes |
| Post-idle main RSS gate | 1/1 |
| Automatic idle collections before / after | 1 / 1 |
| Primary manual collections / snapshots | 0 / 0 |
| Post-drain RSS samples / post-idle pairs | 90 / 1 |
| Post-idle owned contexts before / after | 0 / 0 |
| Post-idle worker count before / after | 0 / 0 |
| State p95 admission wait difference | +34.234 ms |
| State p99 admission wait difference | +47.674 ms |
| State projection under cold factory before / after, p95 | 4.230 / 0.000 ms |
| State projection on request before / after, p95 | 0.000 / 5.656 ms |
| State request calculator queue before / after, p95 | 0.000 / 0.021 ms |
| State request calculator service before / after, p95 | 0.000 / 4.159 ms |
| State envelope serialization before / after, p95 | 0.026 / 0.031 ms |
| Required body work removed by relocation | 0 |
| State-body eager relocation comparisons | 0 |
| Larger State/storage redesign implementations | 0 |
| New permanent context / cache entitlements | 0 / 0 |
| Validation / stale / cross-picker / descendant / OOM / guard differences | 0 / 0 / 0 / 0 / 0 / 0 |
| Source app files checked / changed in Round 4 | 613 / 2 |
| Calculator computation / protocol changed files | 0 / 0 |
| Private reads / copied-save reads | 0 / 0 |
| New test files / classification changes | 0 / 0 |
| Native allocator tracing / historical heap captures | 0 / 0 |
| Isolated per-change memory-effect comparisons | 0 |
| Equal-work memory-saving claims | 0 |

| Round-4 production file | Change count |
| --- | ---: |
| app/picker-context.mjs: completed readiness/warmup handles cleared on close | 2 |
| app/picker-context.mjs: count-only resource observer | 1 |
| app/tasks/scheduler.mjs: pending/state/grace counters | 3 |
| tests/picker-calculator-cap.test.mjs: open/defer/cancel/evict regression | 1 |
| Closed context count fields asserted empty | 8 × 9 |
| Cancelled-job grace timers after completion | 0 |

| Tests | Pass | Fail | Skip | Duration ms |
| --- | ---: | ---: | ---: | ---: |
| Narrow, 2 files | 46 | 0 | 0 | 5430.454128 |
| Focused, 11 files | 161 | 0 | 0 | 16664.022637 |
| Quick, 1 run | 3031 | 0 | 68 | 244295.428941 |
| Current JavaScript syntax, 8 files | 8 | 0 | 0 | — |
| Full test suite runs | 0 | 0 | 0 | — |

| Picker completion | Fraction / count |
| --- | ---: |
| baseline minimum quiet completion / unserved picker-trials | 0.000000 / 45 |
| candidate minimum quiet completion / unserved picker-trials | 1.000000 / 0 |

| Source / artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| app/picker-context.mjs | 168627 | 65567058e0fd914cb42e74614d2e2413b12831597349bd4fdcba875c6f5191ab |
| app/tasks/scheduler.mjs | 82817 | 6ab9b9b5823cbab7968d512766fd9ba959d8043da5f5d794315712cc663088ba |
| tests/picker-calculator-cap.test.mjs | 32081 | 0326efb39ffea7c4372ab4839b1e0e2c41a59e5b130b123e5aa645cac7690049 |
| scripts/perf/y06/admission.mjs | 25093 | 8e45018f0f36574ae89f129cd77aaa0402371fc9bfeb87cc923fb49238f7eeaa |
| scripts/perf/y06/trace.mjs | 7204 | ebc31d1ee97b493697ced02ccdffe20cf99cf518dc272a0a365be7f4915a2bda |
| scripts/perf/y06/play-view-report.mjs | 7054 | 6d116802ca921c6de935fea6d7388f24064784b86a93b4b667ff94aad52de324 |
| scripts/perf/y06/heap-diff.mjs | 5703 | 9cb3dd6086ea659def041efc746179fff82e27441ca26897dfe1f48e27019624 |
| scripts/perf/y06/round4-report.mjs | 7222 | 34c190c4b81f8150f25536f0ee06d5ae96cdff50a5ca89c45e5f4570ae394dbe |
| docs/experiments/y06-admission-fairness.round4-attribution.results.json | 523248 | 0b099fc76cda78b6e1e5278b26ddb91d9a49d33536fc6e075ba5357e34d30d53 |
| docs/experiments/y06-admission-fairness.round4-details.md | 6165 | 290a83624005576ad4567aaa2c9261b16bd54fba0e3e49f247db19d21b1a8166 |
| docs/experiments/y06-admission-fairness.round4-details.results.json | 15988 | d745d72c51536d76363c87bb91d3997fc76031328ef08c3a59bdaea9d5bd6367 |
| docs/experiments/y06-admission-fairness.round4-heap.results.json | 178205 | d5599ed7d631cf0da97e8ebd235977b40a06926f273c3fa2418406245e2a8866 |
| docs/experiments/y06-admission-fairness.round4-measurements.md | 3743 | 42256a4d1475129024c3d2a4632c48290beef0461bbd6be327c6a80ae25ff432 |
| docs/experiments/y06-admission-fairness.round4-measurements.results.json | 8034 | 945a3c2548d971792dc8d251e3a6fdb6734a92ca1ad9c3d1a1c5b6f1cfd32ec5 |
| docs/experiments/y06-admission-fairness.round4-primary.results.json | 7758349 | 361b2dcb65b19d0ab4d4cce14edfbe369a6a469d3b81b55165e61f080eae567c |
| docs/experiments/y06-admission-fairness.round4-task-tails.results.json | 613 | 4b45771e5688975bdbe2b7cd342513e32089146d6f75b335d36ab402d5087cdc |

NEEDS-WORK

Players get fewer refused play requests, with some longer reads.
