# Picker scenario measurements

`scripts/perf/scenarios.mjs` measures startup ready, both Group lists from
launch, a 50-chunk Area check, Rules preview, and an immediate unlock with both
lists refreshed. Six subsequent check/uncheck revisions exercise retention.
It requires the shared heavy lock and explicit disposable benchmark inputs.
The live save and installed application are never used as writable stores.

Each trial starts a fresh server, uses one starting chunk per member and the
same seeded roll, and disables prediction prewarming. The panels precede the
roll/unlock. Group time includes startup; the separate list interval is also
recorded. This sequence differs from older interaction runs, so comparisons
use freshly matched baseline trials rather than the older quoted unlock time.

Three trials per source variant alternate forward/reverse/forward. A private
driver admits runs only after two quiet five-second whole-system CPU windows
and checks two further windows after all scratch processes exit. Loaded runs
are excluded and retried with a fresh store. Source manifests, input/dataset
hashes, Node version, full normalized response hashes and raw timings remain in
the private benchmark output. CPU-profile runs are excluded from timing tables.

Main RSS is the process high-water mark, including the embedded HTTP client.
Combined worker RSS is sampled every 250 ms across owned calculator processes.
The sampler registers processes when their scheduler listeners are installed,
before readiness, so cold initialization is included. The seconds campaign used
the earlier ready/message registration; its RSS samples are diagnostic only.
Separate alternating memory trials use identical production source with this
earlier registration in every variant. Their complete response hashes must also
match the seconds campaign.
They are separate peaks and need not occur together. These are process memory
measurements, rather than an object-retention or heap-size guarantee.

The original `scripts/perf/map-growth.mjs` also runs in alternating trials with
a 1536 MiB heap limit and a 1500 MiB worker RSS stop. Walking stops at the
reachable component boundary; no claim is made about unreachable checkpoints.

An experimental exact-Set obligation footprint was rejected: tracking appeared
as a major self-time frame and slowed the matched unlock. A smaller conservative
fingerprint memo is described in [obligation memo](obligation-memo.md). The task
and source data model remains unchanged. Fresh-engine equivalence tests disable
both reuse layers and retain cyclic, growth and retraction coverage.
