# play-v1 corrected measurements

| Input SHA-256 | 40f4e8292a85eda1c52bf422598cd649f14285e47df46cc6d7fefd0bcdb7eefb |
| --- | --- |
| Node | 24.21.0 |
| Trials / censored | 30 / 0 |
| Before | a781c228f2f2aa1ea0f6ef9fe9eac491070e9ec9 |
| Seeds / pairs per seed / window ms | 17, 73, 211 / 5 / 24000 |
| Failure ceiling ms / p95-p99 allowance ms | 2000 / max(5, 10%) |
| Quantiles | median(per-trial nearest-rank) |
| Gate pass / fail | 1 / 0 |

| Seed | Endpoint | Samples B/C | Failures B/C | Actual p95 B→C ms | Actual p99 B→C ms | Ceiling p95 B→C ms | Ceiling p99 B→C ms | Actual p95/p99 gates | Ceiling p95/p99 gates | Ceiling before p95 range ms | After p95 max ms | Ceiling range gate | Actual before p95 range ms | Actual range gate |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | ---: |
| 17 | state | 400/400 | 116/0 | 44.5 → 64.0 | 71.2 → 77.5 | 2000.0 → 64.0 | 2000.0 → 77.5 | 0/1 | 1/1 | 2000.0–2000.0 | 109.9 | 1 | 41.9–60.5 | 0 |
| 17 | tasks | 60/60 | 6/0 | 68.7 → 80.9 | 68.7 → 80.9 | 2000.0 → 80.9 | 2000.0 → 80.9 | 0/0 | 1/1 | 2000.0–2000.0 | 90.0 | 1 | 64.4–82.3 | 0 |
| 17 | draft | 60/60 | 3/0 | 119.1 → 96.9 | 119.1 → 96.9 | 2000.0 → 96.9 | 2000.0 → 96.9 | 1/1 | 1/1 | 70.3–2000.0 | 140.5 | 1 | 70.3–335.4 | 1 |
| 73 | state | 400/400 | 92/0 | 46.0 → 74.7 | 55.0 → 95.7 | 2000.0 → 74.7 | 2000.0 → 95.7 | 0/0 | 1/1 | 2000.0–2000.0 | 85.1 | 1 | 43.0–49.0 | 0 |
| 73 | tasks | 60/60 | 9/0 | 70.4 → 61.2 | 70.4 → 61.2 | 2000.0 → 61.2 | 2000.0 → 61.2 | 1/1 | 1/1 | 2000.0–2000.0 | 72.0 | 1 | 51.9–96.8 | 1 |
| 73 | draft | 60/60 | 9/0 | 80.7 → 89.9 | 80.7 → 89.9 | 2000.0 → 89.9 | 2000.0 → 89.9 | 0/0 | 1/1 | 2000.0–2000.0 | 103.5 | 1 | 67.9–349.1 | 1 |
| 211 | state | 400/400 | 108/0 | 46.6 → 68.2 | 74.0 → 86.0 | 2000.0 → 68.2 | 2000.0 → 86.0 | 0/0 | 1/1 | 2000.0–2000.0 | 81.8 | 1 | 40.6–55.5 | 0 |
| 211 | tasks | 60/60 | 8/0 | 56.3 → 68.1 | 56.3 → 68.1 | 2000.0 → 68.1 | 2000.0 → 68.1 | 0/0 | 1/1 | 2000.0–2000.0 | 99.5 | 1 | 48.6–77.1 | 0 |
| 211 | draft | 60/60 | 6/0 | 287.1 → 87.2 | 287.1 → 87.2 | 2000.0 → 87.2 | 2000.0 → 87.2 | 1/1 | 1/1 | 2000.0–2000.0 | 89.9 | 1 | 80.8–351.2 | 1 |

| Mode | Quiet successes/scheduled | Attempts | Quiet refusals | Peak RSS MiB median [min, max] | Post-drain RSS MiB median [min, max] |
| --- | ---: | ---: | ---: | --- | --- |
| baseline | 1203/1560 | 13907 | 357 | 664.6 [645.9, 752.7] | 598.6 [557.7, 700.8] |
| candidate | 1560/1560 | 14723 | 0 | 774.9 [743.4, 925.6] | 765.0 [732.3, 922.9] |

| Seed / pair | Mode | Sample | Idle ms | Main MiB | Workers MiB | Tree MiB | Worker count | Process count |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 73/1 | baseline | post-drain | 0.0 | 326.9 | 261.3 | 588.2 | 2 | 3 |
| 73/1 | baseline | post-eviction | 610020.7 | 162.1 | 0.0 | 162.1 | 0 | 1 |
| 73/1 | candidate | post-drain | 0.0 | 389.5 | 350.5 | 740.1 | 2 | 3 |
| 73/1 | candidate | post-eviction | 610019.5 | 226.7 | 0.0 | 226.7 | 0 | 1 |

| Gate | Count |
| --- | ---: |
| actual95Pass | 3/9 |
| actual99Pass | 4/9 |
| ceiling95Pass | 9/9 |
| ceiling99Pass | 9/9 |
| Tasks/Draft actual before-range | 4/6 |
| Tasks/Draft ceiling before-range | 6/6 |
| Validation / descendants / OOM / guard | 0 / 0 / 0 / 0 |
| Post-drain / idle sample counts | 90 / 2 |
| Default context / worker idle ms | 600000 / 600000 |
| Idle interval / shortened-window overrides / forced GC | 610000 / 0 / 0 |
| Heap-live / allocator-slack attribution samples | 0 / 0 |
| Stable per-trial Tasks/Draft tail estimates | 0 |
| Per-trial Tasks/Draft samples | 12 / 12 |
