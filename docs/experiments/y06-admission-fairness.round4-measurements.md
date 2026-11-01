# play-v1 corrected measurements

| Input SHA-256 | 361b2dcb65b19d0ab4d4cce14edfbe369a6a469d3b81b55165e61f080eae567c |
| --- | --- |
| Node | 24.21.0 |
| --expose-gc before / after | 1 / 1 |
| Trials / censored | 30 / 0 |
| Before | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |
| Seeds / pairs per seed / window ms | 17, 73, 211 / 5 / 24000 |
| Failure ceiling ms / p95-p99 allowance ms | 2000 / max(5, 10%) |
| Quantiles | median(per-trial nearest-rank) |
| Gate pass / fail | 1 / 0 |

| Seed | Endpoint | Samples B/C | Failures B/C | Actual p95 B→C ms | Actual p99 B→C ms | Ceiling p95 B→C ms | Ceiling p99 B→C ms | Actual p95/p99 gates | Ceiling p95/p99 gates | Ceiling before p95 range ms | After p95 max ms | Ceiling range gate | Actual before p95 range ms | Actual range gate |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: |
| 17 | state | 400/400 | 112/0 | 43.8 → 63.7 | 55.5 → 85.4 | 2000.0 → 63.7 | 2000.0 → 85.4 | 0/0 | 1/1 | 2000.0–2000.0 | 70.1 | 1 | 35.8–46.5 | 0 |
| 17 | tasks | 60/60 | 3/0 | 70.2 → 65.9 | 70.2 → 65.9 | 2000.0 → 65.9 | 2000.0 → 65.9 | 1/1 | 1/1 | 64.8–2000.0 | 89.3 | 1 | 64.8–79.0 | 0 |
| 17 | draft | 60/60 | 6/0 | 120.8 → 86.6 | 120.8 → 86.6 | 2000.0 → 86.6 | 2000.0 → 86.6 | 1/1 | 1/1 | 2000.0–2000.0 | 92.6 | 1 | 71.3–203.3 | 1 |
| 73 | state | 400/400 | 101/0 | 44.8 → 73.8 | 67.9 → 94.6 | 2000.0 → 73.8 | 2000.0 → 94.6 | 0/0 | 1/1 | 2000.0–2000.0 | 79.9 | 1 | 41.0–51.3 | 0 |
| 73 | tasks | 60/60 | 10/0 | 61.1 → 70.9 | 61.1 → 70.9 | 2000.0 → 70.9 | 2000.0 → 70.9 | 0/0 | 1/1 | 2000.0–2000.0 | 83.4 | 1 | 52.5–123.1 | 1 |
| 73 | draft | 60/60 | 9/0 | 85.4 → 72.3 | 85.4 → 72.3 | 2000.0 → 72.3 | 2000.0 → 72.3 | 1/1 | 1/1 | 2000.0–2000.0 | 100.4 | 1 | 64.5–279.4 | 1 |
| 211 | state | 400/400 | 100/0 | 45.3 → 70.4 | 73.0 → 103.5 | 2000.0 → 70.4 | 2000.0 → 103.5 | 0/0 | 1/1 | 2000.0–2000.0 | 86.8 | 1 | 42.0–52.6 | 0 |
| 211 | tasks | 60/60 | 5/0 | 59.7 → 63.1 | 59.7 → 63.1 | 2000.0 → 63.1 | 2000.0 → 63.1 | 1/1 | 1/1 | 2000.0–2000.0 | 98.3 | 1 | 56.9–68.7 | 0 |
| 211 | draft | 60/60 | 8/0 | 90.1 → 98.7 | 90.1 → 98.7 | 2000.0 → 98.7 | 2000.0 → 98.7 | 1/1 | 1/1 | 2000.0–2000.0 | 155.0 | 1 | 58.1–315.5 | 1 |

| Mode | Quiet successes/scheduled | Attempts | Quiet refusals | Peak RSS MiB median [min, max] | Post-drain RSS MiB median [min, max] |
| --- | ---: | ---: | ---: | --- | --- |
| baseline | 1206/1560 | 13958 | 354 | 679.6 [649.0, 713.7] | 647.6 [581.9, 711.5] |
| candidate | 1560/1560 | 14690 | 0 | 773.7 [739.1, 786.4] | 760.1 [739.1, 775.3] |

| Seed / pair | Mode | Sample | Idle ms | Main MiB | Workers MiB | Tree MiB | Worker count | Process count |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 73/1 | baseline | post-drain | 0.0 | 383.6 | 279.5 | 663.1 | 2 | 3 |
| 73/1 | baseline | post-eviction | 610060.8 | 194.9 | 0.0 | 194.9 | 0 | 1 |
| 73/1 | candidate | post-drain | 0.0 | 361.4 | 377.7 | 739.1 | 2 | 3 |
| 73/1 | candidate | post-eviction | 610028.5 | 149.8 | 0.0 | 149.8 | 0 | 1 |

| Gate | Count |
| --- | ---: |
| actual95Pass | 5/9 |
| actual99Pass | 5/9 |
| ceiling95Pass | 9/9 |
| ceiling99Pass | 9/9 |
| Tasks/Draft actual before-range | 4/6 |
| Tasks/Draft ceiling before-range | 6/6 |
| Validation / descendants / OOM / guard | 0 / 0 / 0 / 0 |
| Post-drain / idle sample counts | 90 / 2 |
| Default context / worker idle ms | 600000 / 600000 |
| Idle interval / shortened-window overrides / forced GC | 610000 / 0 / 0 |
| Post-idle V8 counter / native-allocator trace samples | 2 / 0 |
| Stable per-trial Tasks/Draft tail estimates | 0 |
| Per-trial Tasks/Draft samples | 12 / 12 |
