# Store response release (flag off)

`openStore({ releaseCommandResponses: true })` opts into releasing command
responses from the gameplay and maintenance sequencing tails and invalidating obsolete store response
projections, calculation snapshots and full/play pools as soon as a new state
is published. The option defaults to `false`, requires a boolean and has no
environment or production caller wiring. Owner approval is required before
go-live.

The caller still receives the original operation promise, including its exact
result or rejection. Only the internal queue tails settle to `undefined` on
either outcome. Both tails attach one reaction to the same operation, so the
next command, freeze and close retain the existing settlement boundary.

Invalidation follows successful publication in command/cleanup/replace,
prepared-import, action-session and standby-activation paths. Failed writes
leave the current response roots intact. Previously captured caller snapshots
remain immutable and usable; weakly keyed field serialization remains shared.
No History/Undo retention, disk preimages, encoding, validation, atomic writes,
backup retention or durability policy changes. Backup read results are also
released from the maintenance tail. HTTP representation caches and their
external buffer budgets are separate from these store-owned references.

With the flag omitted or false, the original response-bearing queue tail and
lazy pool/projection invalidation remain in use. Targeted synthetic tests
compare both flags, cover format 1 and owned format 2, gate overlapping commands
at `beforeCommit`, inject an exact rejection, inspect synced state temporaries,
compare publication IO order, check durable backup preimages and reopen state.
Test-only source instrumentation observes actual queue/cache roots without a
production diagnostic API. The queue result is checked structurally on every
runner; `--expose-gc` additionally checks response collection with a WeakRef.
