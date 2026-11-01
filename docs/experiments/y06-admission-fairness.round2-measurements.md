# Round 2: all-attempt rejudgment

Failure-as-observed includes each refusal/timeout at time to failure. Failure-as-never-served replaces it with 2000 ms. Values are nearest-rank cross-trial p50 of trial endpoint p95/p99; bracketed figures are per-trial ranges. Historical raw samples were not retained: ceiling values below are proved from counts and quantile ranks, never interpolated.

| Seed | Endpoint | Scheduled B/C | Failures B/C | Observed p95 B → C (ms) | Observed p99 B → C (ms) | Ceiling p95 B → C (ms) | Ceiling p99 B → C (ms) | Observed p95 gate | Ceiling p95 gate |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |
| 17 | state | 400/400 | 97/0 | 31.4 → 46.6 | 48.2 → 68.5 | 2000.0 → 46.6 | 2000.0 → 68.5 | FAIL | PASS |
| 17 | tasks | 60/60 | 4/0 | 48.2 → 59.7 | 48.2 → 59.7 | 2000.0 → 59.7 | 2000.0 → 59.7 | FAIL | PASS |
| 17 | draft | 60/60 | 3/0 | 78.7 → 95.0 | 78.7 → 95.0 | 2000.0 → 95.0 | 2000.0 → 95.0 | FAIL | PASS |
| 73 | state | 400/400 | 87/0 | 31.4 → 53.2 | 44.6 → 75.4 | 2000.0 → 53.2 | 2000.0 → 75.4 | FAIL | PASS |
| 73 | tasks | 60/60 | 6/0 | 46.6 → 49.7 | 46.6 → 49.7 | 2000.0 → 49.7 | 2000.0 → 49.7 | PASS | PASS |
| 73 | draft | 60/60 | 8/0 | 186.3 → 287.9 | 186.3 → 287.9 | 2000.0 → 287.9 | 2000.0 → 287.9 | FAIL | PASS |
| 211 | state | 400/400 | 100/0 | 29.4 → 52.7 | 41.5 → 74.7 | 2000.0 → 52.7 | 2000.0 → 74.7 | FAIL | PASS |
| 211 | tasks | 60/60 | 7/0 | 45.9 → 57.7 | 45.9 → 57.7 | 2000.0 → 57.7 | 2000.0 → 57.7 | FAIL | PASS |
| 211 | draft | 60/60 | 7/0 | 59.4 → 204.1 | 59.4 → 204.1 | 2000.0 → 204.1 | 2000.0 → 204.1 | FAIL | PASS |

Observed-response-time gates: 1/9 pass. Completion-aware ceiling gates: 9/9 pass. The round-1 survivor-only rejection is superseded: its apparent service regression disappears when unserved work is charged at the deadline. Fast refusals still make observed-response-time tails smaller on baseline; that is not faster service.

The original 319 quiet losses are retained, not imputed as successful work. Candidate has zero quiet losses in these primary trials. P99 also improves under the ceiling in all nine groups.
