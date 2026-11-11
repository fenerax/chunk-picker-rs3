# Everyday save CPU

## Baseline (phase 1)

Measured once on the shared Windows PC with Node 24.20.0, BelowNormal
priority, exclusive `heavy.lock` ownership and a nine-minute outer guard.
Base: `daa221d9` (`origin/main`). No server, calculator, personal inputs or
acceptance gates are involved. The first setup invocation failed before any
commands ran (missing publisher directory); the corrected invocation below
is the sole completed baseline run.

Run from the repository root:

```sh
node --import ./scripts/perf/save-cost/trace.mjs scripts/perf/save-cost.mjs --out var/save-cost-baseline
```

The probe creates one group per shape/format, then runs tick, note and Undo
serially, once each. The acceptance catalogue has 24,000 tasks, 100,000 aliases,
four members, 256 chunks, one assigned base row and one assigned custom row.
History sizes below count **live** events; each group also has two archived
segments of 100 events. Undo reverses the measured note and exercises the
existing archive hydration boundary even though its target is live.

All numbers are milliseconds from `process.cpuUsage()`, including user and
system CPU, partitioned into exclusive phases by a diagnostic loader. Nested
state/command validators count as Validate; validation during archive
hydration counts as Load. Publish includes preimages, dependency preparation,
retention, optional evidence and durable publication; Reply includes browser
projection, pools and response serialization. Apply includes command copying
and inverse construction. Setup/open/close are excluded. No phase is wall time.
Node's process counter includes native helper-thread CPU (notably compression);
it is a conservative process-level proxy for the main-thread command cost,
not an isolated JavaScript-thread profiler. There are no calculator children.
Windows counter granularity is approximately 15–16 ms here: zeros are below
counter resolution, not proof of zero work. These single samples are diagnostic,
not percentiles or evidence of a precise sub-20 ms bound.

The first tick includes cold static-field encoding, identity lookup and reply
cache construction. Notes reuse those caches. Undo in format 1 reconstructs
the detached catalogue/registry during hydration and can pay those costs again.
No warmup commands or repeated measurement rounds hide those costs.

Format-2 validation and apply/copy work grow with live History. Undo's load
phase grows with the combined archived/live History and performs full
validation. Encoding, backup/retention and reply serialization also traverse
History; cold catalogue/registry costs are largely independent of History.
GC/native compression accounting can land in a later asynchronous phase, so
one large phase sample does not establish a separate causal slope.

<!-- BASELINE_TABLE -->
| Format | Live History | Command | Load/archive validation | Apply | Validate | Encode | Publish | Reply | Total |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4 | tick | 0.0 | 0.0 | 0.0 | 172.0 | 47.0 | 140.0 | 359.0 |
| 1 | 4 | note | 0.0 | 0.0 | 0.0 | 0.0 | 15.0 | 0.0 | 15.0 |
| 1 | 4 | undo | 438.0 | 110.0 | 0.0 | 421.0 | 78.0 | 110.0 | 1157.0 |
| 2 | 4 | tick | 0.0 | 0.0 | 63.0 | 16.0 | 15.0 | 312.0 | 406.0 |
| 2 | 4 | note | 0.0 | 0.0 | 63.0 | 0.0 | 15.0 | 0.0 | 78.0 |
| 2 | 4 | undo | 78.0 | 47.0 | 47.0 | 0.0 | 47.0 | 0.0 | 219.0 |
| 1 | 200 | tick | 0.0 | 0.0 | 0.0 | 141.0 | 93.0 | 172.0 | 406.0 |
| 1 | 200 | note | 0.0 | 0.0 | 0.0 | 0.0 | 15.0 | 0.0 | 15.0 |
| 1 | 200 | undo | 470.0 | 15.0 | 0.0 | 297.0 | 31.0 | 110.0 | 923.0 |
| 2 | 200 | tick | 0.0 | 16.0 | 46.0 | 0.0 | 15.0 | 250.0 | 327.0 |
| 2 | 200 | note | 0.0 | 32.0 | 47.0 | 0.0 | 16.0 | 0.0 | 95.0 |
| 2 | 200 | undo | 77.0 | 0.0 | 63.0 | 0.0 | 15.0 | 0.0 | 155.0 |
| 1 | 1000 | tick | 0.0 | 0.0 | 0.0 | 141.0 | 46.0 | 110.0 | 297.0 |
| 1 | 1000 | note | 15.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 15.0 |
| 1 | 1000 | undo | 500.0 | 0.0 | 0.0 | 594.0 | 93.0 | 125.0 | 1312.0 |
| 2 | 1000 | tick | 0.0 | 15.0 | 156.0 | 16.0 | 16.0 | 266.0 | 469.0 |
| 2 | 1000 | note | 0.0 | 32.0 | 109.0 | 0.0 | 31.0 | 0.0 | 172.0 |
| 2 | 1000 | undo | 140.0 | 16.0 | 94.0 | 0.0 | 61.0 | 0.0 | 311.0 |
| 1 | 5000 | tick | 0.0 | 16.0 | 0.0 | 203.0 | 62.0 | 109.0 | 390.0 |
| 1 | 5000 | note | 0.0 | 0.0 | 0.0 | 0.0 | 47.0 | 0.0 | 47.0 |
| 1 | 5000 | undo | 610.0 | 0.0 | 0.0 | 359.0 | 62.0 | 125.0 | 1156.0 |
| 2 | 5000 | tick | 0.0 | 78.0 | 406.0 | 16.0 | 46.0 | 329.0 | 875.0 |
| 2 | 5000 | note | 15.0 | 94.0 | 453.0 | 15.0 | 470.0 | 15.0 | 1062.0 |
| 2 | 5000 | undo | 594.0 | 47.0 | 359.0 | 16.0 | 31.0 | 0.0 | 1047.0 |
