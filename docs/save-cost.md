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

## Delta validation (phase 2)

`openStore({ deltaValidation: true })` opts in. The default is `false` in both
formats. No server launcher or environment variable enables it. Production
keeps the existing command path until a separate activation decision.

`app/core/delta-validation.mjs` owns a per-store `WeakSet` of certified roots.
Certification runs the full validator, owns its returned copy, and deeply
freezes it. A revision number, shallow freeze or reused catalogue cannot seed
a proof. There is no global group cache. The session's weak references do not
retain obsolete snapshots. Certification adds a full pass at startup and on
unrecognized roots; startup is outside the command measurements.

The fast path uses the existing `applyValidatedCommand`, including command
JSON checks, revision checks, gameplay validation and new inverse validation.
It applies only to notes, ticks whose original task IDs already exist and are
unchanged by identity resolution, and
Undo of the latest active note/tick with only the corresponding sparse member
patches. Tick Undo leaves must also address existing, unchanged task IDs.
Nonempty task claims disable it. Task registration, catalogue edits,
nonlatest Undo and complex inverses use the full path. Format 2 keeps the
existing resident command construction in that fallback, followed by full
validation; this preserves the codec's alias replacement order as well as its
logical values. Newly returned snapshots are frozen before acquiring a proof.

These restrictions let an everyday command reuse the baseline's catalogue,
identity registry and History checks. The new inverse restores the baseline's
gameplay exactly, so replaying it leads into the already checked Undo chain.
Undo of the latest active simple change removes that chain's first active
inverse and adds its paired marker. Older selective Undo retains full replay.
The existing core functions validate the changed member state, task references
and both inverse sides. Members are still copied and their small gameplay
projection is validated; this is not an optimization for unbounded member
dictionaries. The History array still has to be copied and serialized.

Hooks retain their detached full-validation boundary. Their returned roots,
publication metadata changes and retention trims have no inherited certificate;
the next command certifies them in full. Archive hydration still loads and
validates the complete merged History. Its certified result can enter command
application without a second resident-state validation. No archive cache,
History paging or save/wire format change was introduced.

### Invariant coverage

| Full-validator invariant | Delta path / fallback |
| --- | --- |
| JSON serializability, plain objects, symbols, cycles, unsafe keys, actor/source validation in preserved History | Full certification; deeply frozen shared trees; command and new-event JSON checks remain in core. |
| State/schema keys, revision bounds, rule resolution, diagnostics and normalization | Full certification; core checks command revision, timestamp and gameplay; authored revision/event construction preserves ordering. Unrecognized roots use full validation. |
| Duplicate tasks/members, roster-sensitive assignments, task shapes and identity dictionaries | The fast path changes none of these. Untrusted roots and every task-registration/edit path use full validation, including historical assignments. |
| Migration of aliases, claims, legacy stickers, provenance and plugin evidence | Full boundary before certification; catalogue/identity changes use the fallback. No normalization result is inferred from a hash or revision. |
| Member field shape, progression overlap, referenced completions/statuses/progress/alternatives, claims, goals/reviews/finish line | Core `validateCommandGameplay` and `prepareUndo` remain in use; immutable unchanged global fields retain certification. Claims and other command kinds use the full fallback. |
| History IDs, unique/monotonic revisions, actor/source, task timelines and historical references | Fully checked on certification. A fast append changes no older rows or timeline. New IDs/revisions are authored from a checked increment. |
| Every inverse kind, snapshot roster, both sparse sides, guarded reverse replay, paired Undo markers | Full certification checks all existing inverses. Core validates each new sparse inverse. The fast Undo restriction preserves the certified reverse chain; other Undo uses the full validator. |
| Archive overrides, invalidated claims, archive-boundary Undo | Existing hydration merges overrides/cancels invalidated claims before full certification. The storage differential case puts the only undoable event in an archive. |

### Differential verification

The full `applyCommand` / `validateState` implementation is the independent
oracle. `tests/delta-validation.test.mjs` runs three deterministic generated
streams in both flat and resident representations: 762 command pairs,
288 accepted and 474 rejected. After each accepted delta result it also runs
the full validator and compares exact logical state and History. Each command
checks that the previous snapshot survives unchanged. The adversarial matrix
tests duplicate rows/IDs, changed rosters and order, absent/historical assignees,
invalid JSON, alias migration, corrupt paths/sides/markers, and every inverse
component. A forged frozen root with a certified revision is refused.

`tests/storage-delta-validation.test.mjs` compares option off/on for both
formats with and without an archive, including identity migration on open,
an Undo whose target is archived, ticks with duplicate requested IDs, notes,
catalogue registration/edits, claims, Undo and reopen. It compares exact saved
envelope bytes, serialized replies and complete backup states after each
command. It also checks that a hook cannot introduce an absent assignee after
a hot command. These are bounded deterministic synthetic comparisons, not an
exhaustive enumeration of all JSON values.

The initial test invocation exposed invalid synthetic surface declarations and
a missing published base. After those fixture repairs, the byte comparison
exposed differing alias replacement order in the resident fallback. The final
fallback preserves the existing resident construction and the corrected files
pass. No retry policy, timing assertion or per-case deadline was added; each
new file has one generous outer guard.

### Review correction: exact task keys

Tick execution and catalogue registration use the original requested ID. The
previous gate admitted an alias whenever its resolved ID existed, allowing a
new alias row or alias-keyed progress to acquire a certificate. Admission now
requires the original ID to be present and equal to its resolved ID. Aliases
use the full fallback, including when both alias and canonical rows exist.
Execution does not normalize IDs in the fast path.

The identity/lookup audit also found that valid imported History can restore an
alias through a tick inverse's before-side. Fast Undo now applies the same
original-ID check to every task-status leaf. Object patches only carry
container-presence flags; they cannot introduce a task key.

| Audited lookup | Admission and execution |
| --- | --- |
| Tick IDs and catalogue registration | Both use the original ID's exact row; aliases and absent rows fall back before execution. The caller's catalogue cannot extend fast-path admission. |
| Tick Undo paths | Leaf keys must be present and unchanged by resolution; restoration uses those literal keys. Historical alias leaves fall back. |
| Members and sparse Undo member IDs | Exact ID equality in `findMember`; fast commands cannot change the roster or assignments. |
| Note chunk IDs and paths | Command syntax/world checks and note writes use the same original chunk ID. Sparse restoration uses literal path segments. |
| Undo target revision | The gate and core select the same latest active event; explicit revisions must match exactly. Other targets fall back. |
| Singular task IDs | Core resolves `payload.taskId`, but all three admitted command schemas reject that field. Commands that use it already fall back. |
| Certificates, task-row indexes and resident identities | Certificates and indexes use exact immutable root/array identities and original row IDs. Flat and resident registry lookups share `resolveSavedTaskId`; no revision-based identity proof is used. |

The added differential cases cover an alias tick without a catalogue row, an
alias-only caller catalogue row, saved alias and canonical rows together, a
mixed canonical/alias batch, and Undo restoring a historical alias. Each runs
in flat and resident core states and in both storage formats. Comparisons cover
acceptance, exact saved bytes, complete serialized replies and full-validator
output, including migration metadata and History. Starting states are checked
to be full-validation fixed points; accepted results must be canonical and
remain unchanged by full validation.

Before the correction, the four accepting alias cases reproduced mismatches
in each representation and format. After the correction, the two affected
files passed: `tests/delta-validation.test.mjs` 14/14 and
`tests/storage-delta-validation.test.mjs` 16/16, with no failures, cancellations
or skips. Each file ran once before and once after the code change, sequentially
under the shared PC lock at BelowNormal priority with `--test-concurrency=1`
and its complete `testRunPolicy` environment. No other test files or performance
probes were run for this correction.

### Before and after

Same probe, one completed option-on run, fresh synthetic directories and the
same lock/priority/runtime policy. Milliseconds of process CPU; first tick is
cold in each group. The complete option-on phase table follows the overview.

| Format | Live History | Tick before / after | Note before / after | Undo before / after |
| --- | ---: | ---: | ---: | ---: |
| 1 | 4 | 359 / 328 | 15 / 16 | 1157 / 922 |
| 1 | 200 | 406 / 406 | 15 / 31 | 923 / 1484 |
| 1 | 1000 | 297 / 469 | 15 / 31 | 1312 / 1578 |
| 1 | 5000 | 390 / 516 | 47 / 47 | 1156 / 1405 |
| 2 | 4 | 406 / 313 | 78 / 32 | 219 / 109 |
| 2 | 200 | 327 / 405 | 95 / 16 | 155 / 172 |
| 2 | 1000 | 469 / 391 | 172 / 31 | 311 / 266 |
| 2 | 5000 | 875 / 344 | 1062 / 78 | 1047 / 703 |

| Format | Live History | Command | Load/archive validation | Apply | Validate | Encode | Publish | Reply | Total |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 4 | tick | 0.0 | 32.0 | 0.0 | 125.0 | 62.0 | 109.0 | 328.0 |
| 1 | 4 | note | 0.0 | 0.0 | 0.0 | 0.0 | 16.0 | 0.0 | 16.0 |
| 1 | 4 | undo | 484.0 | 0.0 | 0.0 | 313.0 | 31.0 | 94.0 | 922.0 |
| 2 | 4 | tick | 16.0 | 0.0 | 0.0 | 16.0 | 15.0 | 266.0 | 313.0 |
| 2 | 4 | note | 0.0 | 0.0 | 0.0 | 0.0 | 32.0 | 0.0 | 32.0 |
| 2 | 4 | undo | 93.0 | 0.0 | 0.0 | 0.0 | 16.0 | 0.0 | 109.0 |
| 1 | 200 | tick | 0.0 | 15.0 | 0.0 | 203.0 | 47.0 | 141.0 | 406.0 |
| 1 | 200 | note | 0.0 | 0.0 | 0.0 | 0.0 | 31.0 | 0.0 | 31.0 |
| 1 | 200 | undo | 844.0 | 0.0 | 0.0 | 374.0 | 64.0 | 202.0 | 1484.0 |
| 2 | 200 | tick | 0.0 | 15.0 | 0.0 | 16.0 | 16.0 | 358.0 | 405.0 |
| 2 | 200 | note | 0.0 | 0.0 | 0.0 | 0.0 | 16.0 | 0.0 | 16.0 |
| 2 | 200 | undo | 141.0 | 0.0 | 16.0 | 0.0 | 0.0 | 15.0 | 172.0 |
| 1 | 1000 | tick | 0.0 | 15.0 | 0.0 | 203.0 | 79.0 | 172.0 | 469.0 |
| 1 | 1000 | note | 16.0 | 0.0 | 0.0 | 0.0 | 15.0 | 0.0 | 31.0 |
| 1 | 1000 | undo | 781.0 | 16.0 | 31.0 | 593.0 | 32.0 | 125.0 | 1578.0 |
| 2 | 1000 | tick | 0.0 | 0.0 | 0.0 | 15.0 | 32.0 | 344.0 | 391.0 |
| 2 | 1000 | note | 0.0 | 0.0 | 0.0 | 0.0 | 31.0 | 0.0 | 31.0 |
| 2 | 1000 | undo | 203.0 | 0.0 | 0.0 | 16.0 | 47.0 | 0.0 | 266.0 |
| 1 | 5000 | tick | 0.0 | 15.0 | 0.0 | 250.0 | 79.0 | 172.0 | 516.0 |
| 1 | 5000 | note | 0.0 | 0.0 | 0.0 | 0.0 | 47.0 | 0.0 | 47.0 |
| 1 | 5000 | undo | 780.0 | 0.0 | 0.0 | 313.0 | 78.0 | 234.0 | 1405.0 |
| 2 | 5000 | tick | 0.0 | 0.0 | 0.0 | 31.0 | 47.0 | 266.0 | 344.0 |
| 2 | 5000 | note | 15.0 | 0.0 | 0.0 | 16.0 | 31.0 | 16.0 | 78.0 |
| 2 | 5000 | undo | 624.0 | 0.0 | 0.0 | 0.0 | 63.0 | 16.0 | 703.0 |


The sub-20 ms command target is **not met**. At 1,000 live events, format-2
tick/note validation changes from 156/109 ms to below counter resolution.
The cold tick still spends 344 ms in reply preparation and 47 ms in encoding
and publication, for 391 ms total. The warm note takes 31 ms total. Undo takes
266 ms, including 203 ms loading/validating merged History. At 5,000 events
that load phase is 624 ms. Format 1 already used validated command baselines;
this run does not demonstrate an end-to-end improvement for it. Its cold
encoding and hydrated catalogue/identity costs remain substantial.

Archive hydration and History traversal remain proportional to History size.
Reducing that archive boundary to a bounded per-command cost needs a separate
History/Undo paging design. Work stops at this boundary as requested; there is
no save-format implementation or activation here. Cold catalogue encoding and
reply construction are separate remaining costs and would also need attention
before claiming the overall target. Single samples, GC/helper CPU attribution
and Windows counter resolution limit comparisons between asynchronous phases.

### Focused checks and commits

| Test file | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `tests/delta-validation.test.mjs` | 4 | 0 | 0 |
| `tests/storage-delta-validation.test.mjs` | 6 | 0 | 0 |
| `tests/state.test.mjs` | 59 | 0 | 0 |
| `tests/undo-safety.test.mjs` | 7 | 0 | 0 |
| `tests/storage-undo-safety.test.mjs` | 2 | 0 | 0 |
| `tests/owned-resident-state.test.mjs` | 16 | 0 | 0 |
| `tests/storage-owned-format2.test.mjs` | 31 | 0 | 0 |
| `tests/storage-owned-load.test.mjs` | 16 | 0 | 0 |
| `tests/migration-identity.test.mjs` | 9 | 0 | 0 |
| `tests/multisticker-state.test.mjs` | 12 | 0 | 0 |
| `tests/task-claims.test.mjs` | 41 | 0 | 0 |
| `tests/history-reader.test.mjs` | 3 | 0 | 0 |

206 cases passed across 12 distinct files; no failures or skips in the final
checks. There were 16 file invocations including the two earlier repair-driven
checks of the new files, never a retry loop. The ten existing regression files
ran once each. All test/probe work ran sequentially at BelowNormal priority
under the shared directory lock, with one test worker and the complete per-file
`testRunPolicy` environment. Each lock lease ended within ten minutes. No
server listener was started by the probe; tests use isolated synthetic stores.

Phase 1 was committed before optimization as `c25df82797701f90ddf3dc6068a18388ac9beae8`.
The phase-2 commit contains the default-off validator, local store integration,
differential tests and this report. No lease-admission file, acceptance gate,
save/wire schema, production setting or deployment was changed. No full suite,
hosted CI/stability loop, push or PR was run; complete CI remains for the
publication candidate. Raw synthetic probe outputs and focused logs remain in
the ignored `var/save-cost-{baseline,delta}/` and `.local/` directories.
