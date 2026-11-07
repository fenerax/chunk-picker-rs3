# First Preview eligibility reuse

On a prediction baseline miss, the receiving calculator derives the selected
engine variant's exact `eligibilityInputKey` after task-fact projection, with
the same own-item queries used by ordinary evaluation and a picker scope. Its
request also carries the existing warm-result namespace: dataset, semantic
worker inputs, application source digest, Node and V8 versions. Revision or the
scheduler's task fingerprint alone cannot authorize a proof.

The scheduler tries the foreground lane's existing resident-only admission.
Busy, queued, sleeping, retired, unsupported and memory-constrained sources miss
immediately. Export only looks up an already compiled variant and its already
serialized proof. It never computes or serializes a result graph. A physically
shared single calculator cannot export while it runs Preview, so it falls back.

Import copies the packet into private backing storage, admits it through the
existing eligibility ledger without evicting anything, and uses the ordinary
private decoder and completion overlay on the subsequent evaluation. Bad keys,
namespaces, admission, decoding or transfers use the normal baseline path.
Hypothetical owner and partner calculations keep their complete fixed points.

## Memory and cancellation

The 384 MiB total, 128 MiB eligibility, 256 MiB combined snapshot, 192 MiB
snapshot-owner and 512-entry bounds are unchanged, as are per-variant limits.
One prediction producer permits one handoff. Before requesting any bytes the
receiver reserves eight transient copies, with 8 KiB envelope slack per copy,
inside the existing eligibility partition. The source's retained original is
already charged in its own ledger. The reservation covers thread/IPC relays,
serialization buffers, the broker and the receiver's private copy; the retained
import is charged separately. A proof can use at most one ninth of available
headroom, less slack. Larger proofs deliberately miss.

No parent-side proof cache exists. The broker immediately forwards or discards
the packet. A cancelled receiver retains its reservation until the already
started export settles, discards the late packet, releases the reservation and
returns cancellation before computing a baseline. Worker retirement releases
its entire ledger. Export does not alter the sender's retained proof.

`eligibilitySeeded` is non-enumerable scheduler metadata and a fixed boolean in
Live timings' first-Preview and partner events, persisted by the existing
allowlist. It adds no identifiers or result fields. Cached responses retain the
producer's flag; the existing `cached` flag distinguishes those observations.

## Verification and measurement

`tests/preview-proof-seed.test.mjs` uses the existing calculation canonicalizer
without changing its exclusions. The normal-size synthetic fixture contains
64 surface chunks, 2,048 generated challenges plus five dependency/cycle
controls, and two six-chunk maps. Every roll-pool candidate in both Group modes
compares full baselines, Preview delta/coverage/metrics, both members' full
post-unlock results, play/duo/sidebar projections, pools and ordered How/Why
evidence. Unit and protocol controls cover misses, mutation isolation,
cancellation, ledger admission and native process transport. Tests have one
outer guard and no sleeps or wall-clock assertions.

The **Preview proof sample** workflow runs
`node scripts/perf/preview-proof-seed.mjs` on hosted Node 24.20.0. It measures
one unseeded and one seeded first Preview on the identical fixture, each with
fresh calculators and a foreground baseline, and asserts the declared path and
complete canonical Preview equality. The interval includes prediction startup,
handoff and first owner reply. JSON output records source/runtime/fixture hashes,
stage durations and total milliseconds; the Actions summary contains the two
numbers. This is a synthetic demonstration, not the owner's real before/after
or a statistical latency gate. The script refuses ordinary local execution.
