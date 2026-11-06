# Chunk planning on a resident foreground baseline

The first Possible Tasks request follows the settled task list. Previously it
always entered the prediction lane, whose cold snapshot path called
`evaluateFull` again. Planning can now borrow the idle foreground calculator
and build against its existing snapshot.

Admission is opportunistic: the foreground lane must be ready with no active,
queued, or warming work. A pooled lane can borrow only its previous idle
physical calculator, with no pending pool admissions. It never allocates or
waits for a calculator. The worker checks the picker, captured revision,
member, task input and rule key before building; a miss follows the existing
prediction path.

A foreground request atomically cancels resident planning, including when its
own response is cached. The builder checks cancellation between locations and
tasks, and yields between slices so worker control messages can run. It
publishes no partial index. The planning waiter falls back to prediction;
disconnected or superseded waiters retain their ordinary errors. Cooperative
cancellation keeps the foreground calculator resident. Every resident
cancellation also arms the existing 25 ms retirement grace, in pooled and
unpooled modes. A producer stuck in native work retires without waiting for
its reply or ordinary calculation deadline; replacement still waits for
physical termination.

Rejected source candidates and selector scans check cancellation too. Charging
checks around native measurement and throughout reference-byte and row scans,
then commits the ledger metadata together. Cancellation before that commit
removes the new index and preserves the previous charge. Projection checks
each row and yields between slices. Native segments that cannot cooperate
remain covered by the retirement watchdog.

Completed indexes pass through `trackPlanningIndex` and the existing snapshot
cache refresh. Their bytes belong to the foreground picker's existing owner
share. If the enlarged snapshot cannot fit, normal eviction releases it.
There is no additional lane, calculator, cache, budget or persisted field.
The retained canonicalizer is created in a separate factory containing only
the definition aliases. Ledger eviction callbacks also use a separate factory;
neither shares the builder or measurement scope holding request callbacks.

## Synthetic verification

Verified from base `a2411c5a00f052bfdf8277b78d8d7b223b9524a6` using Node
24.20.0, each selected file's test policy and `--test-concurrency=1`:

- `resident-planning.test.mjs`: 29 passed.
- `resident-planning-gc.test.mjs`: 2 passed.
- `chunk-planning.test.mjs`: 11 passed.
- `scheduler.test.mjs`: 53 passed.
- `engine-cache-snapshot.test.mjs`: 24 passed.
- `picker-calculator-cap.test.mjs`: 29 passed.
- `picker-fairness-isolation.test.mjs`: 16 passed.
- `worker-picker-keys.test.mjs`: 6 passed.

Total: 170 passed, zero failed or skipped. The resident, GC and snapshot-cache
files also pass with `NODE_V8_COVERAGE` enabled: 55 additional passing cases.
No full suite was run.

`tests/resident-planning.test.mjs` loads a file-based test probe inside real
calculators. It counts calls at `evaluateFull`, records physical worker
selection, and compares retained snapshot charges with the native graph
measurement and the existing ledger. The probe adds no production protocol
fields or runtime instrumentation.

The resident list-plus-planning sequence requires one full evaluation in total
and no prediction calculator. A cold prediction oracle computes its own
baseline; its planning response must equal the resident response, including
row order, evidence, hidden task fields, clues and access. Coverage includes
both members, base and section locations, shared JSON state transport, direct
threads, one/two-calculator pools and owned calculator processes.

Miss cases cover changed revision, member, input, rules and picker, plus cache
eviction. Queue fixtures cover active/queued foreground work and pending pool
admissions. A synchronization barrier pauses a partly built index until an
actual foreground request cancels it; both thread and process cancellation
must discard that partial index. Abandonment must not start prediction.
Ledger assertions cover successful growth, cancellation and owner-limit
eviction.

Another picker's foreground request interrupts scan, charge and projection
barriers in both pooled and unpooled modes. Cooperative workers retain their
calculator; deliberately stuck workers retire after one controlled 25 ms
grace without a reply. These tests drive the scheduler clock and inspect
dispatch/retirement events, rather than asserting elapsed PC time.

The GC test supplies its own `--expose-gc` child configuration and runs the
worker module behind a synthetic port. Weak references verify that request
state is collectible after full views materialize, including JSON-hydrated
state after transfer-cache eviction, while the completed index stays resident.

The owner-limit fixture uses a fixed synthetic engine `elapsedMs` before
sizing its exact budget. Previously it copied another calculator's charge:
equal-length serialized doubles can contain different numbers of `0x5e`
bytes, which the conservative reference bound charges by four extra bytes
each. A deterministic regression proves that difference. The fixture already
awaits the final worker response; its original retained/evicted assertions
remain unchanged under ordinary execution and V8 coverage.

These checks establish work removal and equivalence, not a wall-time gain.
The historical scale-400 e2 timings and the resident-index timings in
[`engine-profile.md`](engine-profile.md#after-ordinary-request-types) explain
the mechanism; they are not measurements of this change. No live save,
real-size timing run, RSS comparison or user-facing latency gate was used.
