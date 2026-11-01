# play-v1 correction

| Protocol | Count / hash / duration |
| --- | --- |
| START / before | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |
| Seeds | 17 / 73 / 211 |
| Matched pairs per seed | 5 / 5 / 5 |
| Trials / simultaneous workloads | 30 / 1 |
| Arrival window | 24 s |
| Budget | 45 min |
| Failure ceiling | 2000 ms |
| p95 / p99 allowance | max(5 ms, 10%) |
| Default context / worker eviction | 600000 ms / 600000 ms |
| Post-drain samples per trial | 3 |
| Idle sample seed / pair / modes | 73 / 1 / 2 |
| No-traffic interval before idle sample | 610000 ms |
| Idle samples / other primary trials | 2 / 28 |
| Idle overrides / forced collections | 0 / 0 |
| Hard-limit changes / production changes in correction | 0 / 0 |
| Sample RSS guard / interval | 3072 MiB / 50 ms |
| Private input reads / copied-save reads | 0 / 0 |

| Result | Count / duration / size |
| --- | ---: |
| Corrected selectors / corrected test requests | 3 / 2 |
| Complete compact response body differences | 0 |
| Trials / censored | 30 / 0 |
| Duration / budget | 2170014 ms / 2700000 ms |
| Quiet completions before / scheduled | 1203 / 1560 |
| Quiet completions after / scheduled | 1560 / 1560 |
| Quiet refusals before / after | 357 / 0 |
| Quiet timeouts / local shedding after | 0 / 0 |
| Actual p95 / p99 gates | 3/9 / 4/9 |
| Ceiling p95 / p99 gates | 9/9 / 9/9 |
| Tasks/Draft actual p95 maximum within before range | 4/6 |
| Seed-17 Tasks actual p95 maximum before / after | 82.2746 ms / 90.0235 ms |
| Seed-211 Tasks actual p95 maximum before / after | 77.1254 ms / 99.5242 ms |
| Comparison attempts / quiet attempts | 28630 / 3120 |
| Validation / descendants / OOM / guard | 0 / 0 / 0 / 0 |
| Post-drain samples / post-eviction samples | 90 / 2 |
| Post-eviction matched pairs | 1 |
| Post-eviction main RSS difference | +64.6 MiB |
| Post-eviction worker count before / after | 0 / 0 |
| Heap-live / allocator-slack attribution samples | 0 / 0 |
| Production files / correction differences | 613 / 0 |
| Hard-limit differences / new design changes | 0 / 0 |
| Private reads / copied-save reads | 0 / 0 |
| 120-second / high-tier reruns | 0 / 0 |
| New test files / classification changes | 0 / 0 |

| Tests | Pass | Fail | Skip | Duration ms |
| --- | ---: | ---: | ---: | ---: |
| Context | 17 | 0 | 0 | 1235.853407 |
| Focused, 11 files | 160 | 0 | 0 | 16468.153134 |
| Current script syntax, files | 2 | 0 | 0 | — |
| Correction quick / full suite runs | 0 | 0 | 0 | — |

| Source / artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| scripts/perf/y06/admission.mjs | 23773 | f6fb91f9daec0f297735411c94866973cd4a8d47565dbf5aef0fc0607a0956fd |
| scripts/perf/y06/play-view-report.mjs | 6924 | 2a6137cde7928c397c9edbd9af0c98872bd9622e3bfab934c2cc9afb70f135c3 |
| tests/picker-context.test.mjs | 30554 | 8064d97c76abc3dcbc78417b6d401bedd394ae1cad7bf506a9958c15ed991273 |
| docs/experiments/y06-admission-fairness.play-v1-primary.results.json | 6793851 | 40f4e8292a85eda1c52bf422598cd649f14285e47df46cc6d7fefd0bcdb7eefb |
| docs/experiments/y06-admission-fairness.play-v1-measurements.md | 3696 | 06764d7a5f96945f4c9b688439dca484c1a7e17237cfe16596710c0be08882c6 |
| docs/experiments/y06-admission-fairness.play-v1-measurements.results.json | 8034 | 9a15b3679f1ddb88ceb5eef12853b29b98cdaf44a2133488a1f6c3f00cdb3d9c |

NEEDS-WORK

Players get fewer refused play requests, with some longer reads.
