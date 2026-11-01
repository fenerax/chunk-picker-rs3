# Matched public admission measurements

> Historical round-1 interpretation: survivor-only latency gates are superseded by the [round-2 all-attempt rejudgment](y06-admission-fairness.round2-measurements.md) and [causal follow-up](y06-admission-fairness.round2.md). Original numeric evidence is retained.

Node 24.21.0; cpu.max 400000 100000; memory.max 17179869184 bytes. Harness SHA-256 2b88413a5b46ab7265857fc62584d9559fa2c63547dbbaca2e1829e80125d4db; runtime SHA-256 709e70ad73be999f02729eae9676f81875699ffbb26704ed97caf550fdd452d7.

## Primary: 24-second arrivals

Harness SHA-256: 2b88413a5b46ab7265857fc62584d9559fa2c63547dbbaca2e1829e80125d4db.

30 completed trials; 0 censored entries. Nearest-rank cross-trial p50 values [minimum–maximum] below summarize per-trial statistics, not pooled percentiles or confidence intervals. Successful-only percentiles exclude refusals; all-attempt values include them. Short draft/task p95/p99 often equal observed maxima.

| Seed | Mode | Trials | Quiet success / scheduled | Quiet min picker completion % | Storm success / attempts | Retries (all roles) | Peak tree MiB | Post-drain MiB | CPU core-s |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- | --- |
| 17 | baseline | 5 | 416 / 520 | 0.0 [0.0–0.0] | 35 / 100 | 276 | 664.8 [649.3–712.6] | 597.1 [591.4–704.7] | 19.2 [19.1–21.1] |
| 17 | candidate | 5 | 520 / 520 | 100.0 [100.0–100.0] | 100 / 100 | 277 | 690.5 [667.0–730.5] | 661.5 [587.6–692.9] | 20.3 [17.4–21.1] |
| 73 | baseline | 5 | 419 / 520 | 0.0 [0.0–0.0] | 35 / 100 | 279 | 663.6 [643.1–696.5] | 614.2 [589.1–663.6] | 19.6 [18.0–20.2] |
| 73 | candidate | 5 | 520 / 520 | 100.0 [100.0–100.0] | 100 / 100 | 269 | 676.4 [662.6–782.3] | 646.2 [594.0–709.4] | 21.4 [18.2–21.9] |
| 211 | baseline | 5 | 406 / 520 | 0.0 [0.0–0.0] | 35 / 100 | 274 | 683.5 [632.2–725.5] | 628.5 [574.8–647.2] | 19.9 [19.0–21.1] |
| 211 | candidate | 5 | 520 / 520 | 100.0 [100.0–100.0] | 100 / 100 | 278 | 709.6 [653.4–741.1] | 667.2 [631.4–708.6] | 20.9 [19.1–22.8] |

| Mode | Endpoint | Success samples / all attempts | Successful p50 | Successful p95 | Successful p99 | All-attempt p50 | All-attempt p95 | All-attempt p99 |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| baseline | state | 916 / 1200 | 20.2 [19.2–23.1] | 34.2 [29.5–40.2] | 44.6 [36.4–55.8] | 19.0 [17.4–21.0] | 31.3 [28.7–35.3] | 44.6 [36.4–55.8] |
| baseline | tasks | 163 / 180 | 31.5 [19.6–35.4] | 46.6 [40.8–74.9] | 46.6 [40.8–74.9] | 29.2 [18.1–35.4] | 46.6 [40.8–74.9] | 46.6 [40.8–74.9] |
| baseline | draft | 162 / 180 | 37.7 [29.0–44.7] | 78.7 [43.2–275.4] | 78.7 [43.2–275.4] | 37.0 [23.9–42.1] | 78.7 [43.2–275.4] | 78.7 [43.2–275.4] |
| candidate | state | 1200 / 1200 | 22.2 [19.5–25.4] | 52.7 [40.9–64.1] | 74.7 [57.6–93.9] | 22.2 [19.5–25.4] | 52.7 [40.9–64.1] | 74.7 [57.6–93.9] |
| candidate | tasks | 180 / 180 | 31.8 [28.4–35.8] | 52.7 [43.5–302.6] | 52.7 [43.5–302.6] | 31.8 [28.4–35.8] | 52.7 [43.5–302.6] | 52.7 [43.5–302.6] |
| candidate | draft | 180 / 180 | 41.6 [35.8–68.1] | 152.4 [59.6–343.9] | 152.4 [59.6–343.9] | 41.6 [35.8–68.1] | 152.4 [59.6–343.9] | 152.4 [59.6–343.9] |

Latency gates, candidate median per-trial successful p95 versus baseline + max(5 ms, 10%):

- Seed 17, state: 34.2 → 46.6 ms; threshold 39.2 ms; FAIL.
- Seed 17, tasks: 48.2 → 59.7 ms; threshold 53.2 ms; FAIL.
- Seed 17, draft: 78.7 → 95.0 ms; threshold 86.5 ms; FAIL.
- Seed 73, state: 34.2 → 53.2 ms; threshold 39.2 ms; FAIL.
- Seed 73, tasks: 46.6 → 49.7 ms; threshold 51.6 ms; PASS.
- Seed 73, draft: 186.3 → 287.9 ms; threshold 204.9 ms; FAIL.
- Seed 211, state: 36.5 → 52.7 ms; threshold 41.5 ms; FAIL.
- Seed 211, tasks: 45.9 → 57.7 ms; threshold 50.9 ms; FAIL.
- Seed 211, draft: 59.4 → 204.1 ms; threshold 65.3 ms; FAIL.

Candidate quiet failures: 0. >300 ms quiet successful endpoint observations (trial/endpoint maxima): 5.

- Trial 7, candidate, seed 17, pair 4, draft: 315.7 ms; cold admission service max 51.2, foreground calculator service max 25.4, oldest sampled calculator queue 283.8, exact advisory wait/service maxima — / — ms. These trial-wide maxima do not attribute individual requests.
- Trial 16, candidate, seed 73, pair 3, draft: 309.8 ms; cold admission service max 44.3, foreground calculator service max 33.5, oldest sampled calculator queue 305.6, exact advisory wait/service maxima — / — ms. These trial-wide maxima do not attribute individual requests.
- Trial 20, candidate, seed 73, pair 5, draft: 343.9 ms; cold admission service max 42.8, foreground calculator service max 37.0, oldest sampled calculator queue 276.1, exact advisory wait/service maxima — / — ms. These trial-wide maxima do not attribute individual requests.
- Trial 26, candidate, seed 211, pair 3, tasks: 302.6 ms; cold admission service max 279.8, foreground calculator service max 37.2, oldest sampled calculator queue 266.9, exact advisory wait/service maxima — / — ms. These trial-wide maxima do not attribute individual requests.
- Trial 30, candidate, seed 211, pair 5, draft: 310.5 ms; cold admission service max 49.3, foreground calculator service max 34.1, oldest sampled calculator queue 276.8, exact advisory wait/service maxima — / — ms. These trial-wide maxima do not attribute individual requests.

Steady role totals (successes / scheduled attempts; reasons include intentional noisy disconnects):

- baseline, noisy: 11385 / 12263; `{"success":11385,"disconnect":829,"cold-open":48,"calculator-admission-unattributed":1}`.
- baseline, light: 652 / 720; `{"success":652,"cold-open":68}`.
- baseline, idle: 589 / 840; `{"success":589,"cold-open":251}`.
- candidate, noisy: 11567 / 12425; `{"success":11567,"disconnect":824,"Picker admission account-full. Wait a moment and retry.":34}`.
- candidate, light: 720 / 720; `{"success":720}`.
- candidate, idle: 840 / 840; `{"success":840}`.

Quiet steady reason totals:

- baseline: `{"success":1241,"cold-open":319}`.
- candidate: `{"success":1560}`.

Candidate exact cold-acquisition telemetry (storm, steady and probes combined):

- waitMs: 1647 released acquisitions; per-trial p95 180.3 [159.4–196.3] ms; observed maximum 279.3 ms.
- serviceMs: 1647 released acquisitions; per-trial p95 34.4 [27.2–39.5] ms; observed maximum 279.8 ms.
- Events: `{"queued":1649,"started":1647,"completed":1646,"released":1647,"account-full":34,"cancelled":3}`. Peak pending 15; active 1; final pending total 0.
- baseline exact factory service p95 30.9 [26.2–37.4] ms; foreground calculator queue p95 0.1 [0.1–0.1] ms; foreground service p95 4.9 [4.3–5.5] ms. Primary advisory wait remains sampled; long runs add exact advisory intervals.
- candidate exact factory service p95 29.3 [24.6–36.3] ms; foreground calculator queue p95 0.1 [0.0–0.1] ms; foreground service p95 4.7 [4.0–5.6] ms. Primary advisory wait remains sampled; long runs add exact advisory intervals.

Validation differences 0; drain failures 0; post-drain samples 90 (required 90); normal-close descendants 0; OOM / OOM kills 0 / 0; guard breaches 0; sampled context maximum 7; calculator host maximum 2.
## Long: 120-second arrivals

Harness SHA-256: 4ade833a527d672604f0c97b33e77d2e1bc5dd01bf08079a852754d21eff5ccd.

10 completed trials; 0 censored entries. Nearest-rank cross-trial p50 values [minimum–maximum] below summarize per-trial statistics, not pooled percentiles or confidence intervals. Successful-only percentiles exclude refusals; all-attempt values include them. Short draft/task p95/p99 often equal observed maxima.

| Seed | Mode | Trials | Quiet success / scheduled | Quiet min picker completion % | Storm success / attempts | Retries (all roles) | Peak tree MiB | Post-drain MiB | CPU core-s |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- | --- |
| 17 | baseline | 2 | 731 / 1040 | 0.0 [0.0–0.0] | 14 / 40 | 335 | 748.1 [748.1–752.9] | 704.0 [704.0–719.7] | 61.2 [61.2–62.7] |
| 17 | candidate | 2 | 944 / 1040 | 80.0 [80.0–80.0] | 40 / 40 | 338 | 770.1 [770.1–776.8] | 682.0 [682.0–718.9] | 65.3 [65.3–66.6] |
| 73 | baseline | 2 | 761 / 1040 | 0.0 [0.0–0.0] | 14 / 40 | 336 | 753.8 [753.8–767.7] | 728.1 [728.1–760.8] | 60.2 [60.2–66.0] |
| 73 | candidate | 2 | 943 / 1040 | 78.3 [78.3–80.0] | 40 / 40 | 335 | 773.8 [773.8–886.8] | 662.4 [662.4–747.7] | 67.9 [67.9–68.4] |
| 211 | baseline | 1 | 371 / 520 | 0.0 [0.0–0.0] | 7 / 20 | 167 | 780.3 [780.3–780.3] | 743.9 [743.9–743.9] | 60.2 [60.2–60.2] |
| 211 | candidate | 1 | 472 / 520 | 80.0 [80.0–80.0] | 20 / 20 | 169 | 773.7 [773.7–773.7] | 762.7 [762.7–762.7] | 62.1 [62.1–62.1] |

| Mode | Endpoint | Success samples / all attempts | Successful p50 | Successful p95 | Successful p99 | All-attempt p50 | All-attempt p95 | All-attempt p99 |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| baseline | state | 1539 / 2000 | 20.0 [19.3–20.8] | 33.6 [31.0–35.1] | 39.7 [37.0–47.5] | 18.6 [18.0–19.3] | 32.2 [29.7–33.3] | 38.9 [37.0–43.4] |
| baseline | tasks | 168 / 300 | 29.0 [26.0–33.6] | 51.6 [40.7–56.6] | 55.4 [46.8–59.9] | 17.4 [16.5–18.8] | 46.0 [35.7–51.7] | 55.4 [46.8–59.9] |
| baseline | draft | 156 / 300 | 40.6 [38.0–44.6] | 232.1 [117.3–359.7] | 309.9 [276.8–375.3] | 21.2 [20.8–23.6] | 66.8 [56.3–184.3] | 309.9 [276.8–375.3] |
| candidate | state | 2000 / 2000 | 22.4 [21.7–22.6] | 51.2 [49.3–60.0] | 67.0 [60.4–101.3] | 22.4 [21.7–22.6] | 51.2 [49.3–60.0] | 67.0 [60.4–101.3] |
| candidate | tasks | 180 / 300 | 31.6 [29.9–33.7] | 65.6 [59.4–94.2] | 72.5 [66.3–96.3] | 21.9 [20.8–22.7] | 57.2 [50.0–60.5] | 72.5 [66.3–96.3] |
| candidate | draft | 179 / 300 | 43.4 [43.1–48.1] | 252.6 [103.4–329.8] | 304.7 [132.3–344.4] | 28.1 [27.5–31.3] | 183.8 [79.8–233.3] | 304.7 [132.3–344.4] |

Latency gates, candidate median per-trial successful p95 versus baseline + max(5 ms, 10%):

- Seed 17, state: 31.0 → 49.3 ms; threshold 36.0 ms; FAIL.
- Seed 17, tasks: 47.5 → 65.6 ms; threshold 52.5 ms; FAIL.
- Seed 17, draft: 234.4 → 252.6 ms; threshold 257.8 ms; PASS.
- Seed 73, state: 33.5 → 53.0 ms; threshold 38.5 ms; FAIL.
- Seed 73, tasks: 40.7 → 59.4 ms; threshold 45.7 ms; FAIL.
- Seed 73, draft: 222.3 → 103.4 ms; threshold 244.5 ms; PASS.
- Seed 211, state: 33.6 → 51.2 ms; threshold 38.6 ms; FAIL.
- Seed 211, tasks: 53.5 → 61.2 ms; threshold 58.9 ms; FAIL.
- Seed 211, draft: 117.3 → 207.1 ms; threshold 129.0 ms; FAIL.

Candidate quiet failures: 241. >300 ms quiet successful endpoint observations (trial/endpoint maxima): 6.

- Trial 2, candidate, seed 17, pair 1, draft: 304.7 ms; cold admission service max 66.9, foreground calculator service max 49.5, oldest sampled calculator queue 332.3, exact advisory wait/service maxima 402.2 / 69.8 ms. These trial-wide maxima do not attribute individual requests.
- Trial 3, baseline, seed 73, pair 1, draft: 309.9 ms; cold admission service max —, foreground calculator service max 44.5, oldest sampled calculator queue 343.5, exact advisory wait/service maxima 363.0 / 62.3 ms. These trial-wide maxima do not attribute individual requests.
- Trial 5, baseline, seed 211, pair 1, draft: 331.4 ms; cold admission service max —, foreground calculator service max 51.4, oldest sampled calculator queue 291.7, exact advisory wait/service maxima 407.1 / 70.5 ms. These trial-wide maxima do not attribute individual requests.
- Trial 7, baseline, seed 17, pair 1, draft: 375.3 ms; cold admission service max —, foreground calculator service max 40.1, oldest sampled calculator queue 359.3, exact advisory wait/service maxima 406.9 / 78.3 ms. These trial-wide maxima do not attribute individual requests.
- Trial 8, candidate, seed 17, pair 1, draft: 344.4 ms; cold admission service max 46.1, foreground calculator service max 49.2, oldest sampled calculator queue 343.4, exact advisory wait/service maxima 349.5 / 66.4 ms. These trial-wide maxima do not attribute individual requests.
- Trial 10, candidate, seed 73, pair 1, draft: 319.3 ms; cold admission service max 71.7, foreground calculator service max 36.3, oldest sampled calculator queue 335.5, exact advisory wait/service maxima 402.7 / 69.7 ms. These trial-wide maxima do not attribute individual requests.

Steady role totals (successes / scheduled attempts; reasons include intentional noisy disconnects):

- baseline, noisy: 10841 / 12695; `{"success":10841,"disconnect":838,"request-rate-unattributed":942,"cold-open":73,"calculator-admission-unattributed":1}`.
- baseline, light: 869 / 1200; `{"success":869,"cold-open":109,"request-rate-unattributed":221,"calculator-admission-unattributed":1}`.
- baseline, idle: 994 / 1400; `{"success":994,"cold-open":406}`.
- candidate, noisy: 10874 / 12696; `{"success":10874,"disconnect":842,"request-rate-unattributed":956,"Picker admission account-full. Wait a moment and retry.":24}`.
- candidate, light: 959 / 1200; `{"success":959,"request-rate-unattributed":240,"calculator-admission-unattributed":1}`.
- candidate, idle: 1400 / 1400; `{"success":1400}`.

Quiet steady reason totals:

- baseline: `{"success":1863,"cold-open":515,"request-rate-unattributed":221,"calculator-admission-unattributed":1}`.
- candidate: `{"success":2359,"request-rate-unattributed":240,"calculator-admission-unattributed":1}`.

Candidate exact cold-acquisition telemetry (storm, steady and probes combined):

- waitMs: 2419 released acquisitions; per-trial p95 34.2 [27.2–35.2] ms; observed maximum 281.4 ms.
- serviceMs: 2419 released acquisitions; per-trial p95 33.8 [32.9–35.9] ms; observed maximum 75.7 ms.
- Events: `{"queued":2430,"started":2419,"completed":2415,"released":2419,"account-full":24,"cancelled":15}`. Peak pending 15; active 1; final pending total 0.
- baseline exact factory service p95 29.2 [28.0–30.8] ms; foreground calculator queue p95 0.0 [0.0–0.1] ms; foreground service p95 4.6 [4.1–4.9] ms. Primary advisory wait remains sampled; long runs add exact advisory intervals.
- candidate exact factory service p95 30.6 [30.0–33.5] ms; foreground calculator queue p95 0.1 [0.1–0.1] ms; foreground service p95 4.8 [4.6–5.1] ms. Primary advisory wait remains sampled; long runs add exact advisory intervals.
- baseline exact advisory queue p95 137.4 [120.2–235.4] ms and maximum 407.1 ms; advisory service p95 18.1 [17.2–19.3] ms and maximum 78.3 ms; 10767 observed completed jobs.
- candidate exact advisory queue p95 229.8 [64.3–234.7] ms and maximum 444.3 ms; advisory service p95 18.1 [17.3–20.2] ms and maximum 69.8 ms; 10835 observed completed jobs.

Validation differences 0; drain failures 0; post-drain samples 30 (required 30); normal-close descendants 0; OOM / OOM kills 0 / 0; guard breaches 0; sampled context maximum 7; calculator host maximum 2.

Primary declared gate: FAIL. Long gate: FAIL. Tail attribution lacks individual HTTP/job correlation; unexplained candidate >300 ms tails are conservatively failures.
