# Character registry: stage 1 design

Stage 1 implementation for [issue #301](https://github.com/fenerax/chunk-picker-rs3/issues/301).
The issue records owner approval of the registry/authentication representation
change on 2026-11-16. Gameplay save schema 1 and existing authentication-sidecar
retention stay unchanged. Owner invitations belong to stage 2; moves, Past maps,
handover and character deletion belong to stage 3.

The owner separately approved the interim deletion refusal on 2026-11-16:
picker/account deletion affecting characters is unavailable until stage 3.
The HTTP boundary (including private account administration) refuses it and the
account panels disable those controls.
Existing operator tombstones and recovery still reconcile; this adds no
character-deletion operation.

## Registry representation and reader version

Use `registry.json` schemaVersion 2. Keep account, picker and gameplay member
IDs. Add a character collection with opaque, randomly generated character IDs,
controlling account ID, optional declared RuneScape name, lifecycle and one
placement `{ pickerId, memberId }`. Keep bindings outside gameplay exports.
Keep the original creation name separately for immutable request-ID replay.
A post-commit roster projection updates the displayed name before responding,
retries on receipt replay and reconciles on picker open, preserving schema 1.
The complete rename, plugin-key reconfirmation and cache-fencing workflow
remains P10/P11 follow-up.
Each live occupied seat references exactly one character, and both directions
of the binding must agree before publication or request authorization.

Each ordinary picker records its designated owner character. Its controlling
login is the picker owner. Several pickers may have the same owner login;
`defaultPickerId` ceases to be an ownership invariant. Store first-provisioning
completion separately from a remembered character preference. An empty returning
login must reach Add character without allocating another default automatically.

Represent occupied and reserved seats separately from `memberIds`, which remains
the historical/import allowlist. A reserved seat has a reservation ID, an invite
ID field and no character or playable member. Stage 1 initializes reservations
empty and validates their shape and `occupied + reserved <= 5`; it exposes no
invite issuer or acceptance operation. Preserve the ownerless, two-member
`legacy-shared` exception and its existing access.

Count pending character allocations against the per-login and service character
limits. Keep the ten-character login limit, independent service character cap,
five-seat product bound and existing defensive member/membership bounds separate.
Refusals preserve records and maps.

Version the external non-reuse ledger to 2 when adding issued character IDs and
reserved character-retirement fields. Retain all existing issued picker IDs,
account retirements and picker tombstones. Stage 1 must not expose character
deletion. Sanitized service recovery must retain character/seat/owner bindings
and provisioning intents while stripping identities and usable credentials.

Current schema-1 readers require version 1 and reject unknown fields in both
documents (`app/storage/registry.mjs`, `validate` and `validateLedger`). They
therefore refuse these version-2 documents rather than treating them as old
registries. Their existing diagnostic is `Invalid registry document.`; this
change cannot retrofit a different diagnostic into an already shipped binary.
The new reader should report an unsupported newer version explicitly before
writing. Validate that refusal against an unmodified schema-1 reader in tests.

## Migration and mapping review

Run migration under the existing registry and ledger writer locks, before
publishing indexes or admitting requests. Validate both source documents first.
Write a durable pre-migration copy of both documents before changing either.
Record source digests and the complete proposed mapping in a durable migration
intent so retries reuse the same character IDs.

Map each unambiguous established player slot to its controlling login. Preserve
viewer memberships without creating characters. Preserve the legacy picker's
IDs, maps and permissions without assigning an ordinary owner. Read established
inline gameplay `state.members` roster/name metadata from the durable document;
the storage codecs keep that field inline. The registry member
allowlist alone cannot distinguish an active imported member from an unused
historical ID. Names, source map codes and matching progress never establish
ownership. Unnamed characters remain valid.

Conflicting claims to one slot, unclaimed imported members and ambiguous
memberships stop migration for review before publication. Report account,
picker and member IDs and the conflicting claims in the local migration report;
exclude provider subjects, credentials and private gameplay from diagnostics.
Retain source bytes and proposed mappings. Do not resolve conflicts by array
order or make a partial migration appear successful. A reviewed mapping must
match the recorded source digests before it can be applied.

The intent records publication progress for the versioned ledger and registry.
Startup resumes an interrupted publication before normal validation/exposure,
using only the recorded source and target digests. Unexpected bytes refuse
recovery. Reopening an already migrated pair performs no new allocation.

## Provisioning and character selection

First sign-in records one durable provisioning intent for the login's initial
character, solo picker and owner seat. Add character uses a caller request ID
scoped to the authenticated login. Retrying that request returns or resumes the
same allocation. Reserve quotas and IDs before filesystem creation; publish the
character, occupied seat, owner relationship and membership together. Pending
allocations are unavailable to gameplay. Directory creation/sync and ready
publication resume after restart. A success response requires a durable ready
placement. Provider profile names never become RuneScape names.

The switcher reads registry metadata without opening every picker. Each entry
shows character/name, group, count, role and availability, with a neutral
disambiguator for matching labels. Duplicate normalized RuneScape names within
one login require a warning and explicit acknowledgement. Matching retains the
existing trim, case and underscore rules and grants no ownership authority.

Use account authentication plus an immutable document character scope. Resolve
an authorized requested character first, then an authorized remembered character;
otherwise show the character menu. Never choose the first membership when
several slots are possible. Invalid explicit selections fail clearly. Keep tabs
independent and reauthorize the exact character/picker/member tuple on each
request. Switching does not issue another durable login session or change
existing sidecar retention. Legacy sessions retain their existing access bounds.

Use full document navigation. Reuse the command receipt, pending-write and
teardown guards; scope browser persistence by login, character, picker, member
and dataset. An uncertain write pauses switching for reconciliation. Preserve
validated OAuth return targets and pending invites; stage 1 must not consume an
owner invite or implement a move as a shortcut.

## Rollback

1. Stop service admission and drain accepted writes. Keep a complete current
   service checkpoint, both current metadata documents, the migration intent
   and the pre-migration copies before changing releases.
2. Prefer repairing forward with a version-2 reader. An older release cannot
   open version-2 metadata or groups/characters created after migration; the
   owner accepted that limit in #301.
3. For a rollback to the old service population, use a stopped, reviewed restore
   of the pre-migration registry and its matching gameplay/bindings. Keep all
   post-migration groups and metadata in retained recovery storage. Do not
   downgrade the live JSON in place or copy only an old registry over new state.
   Older authentication readers also refuse the new `accountScope` session
   field. Revoke these incompatible sessions with the new reader before the
   rollback, retaining a current sidecar checkpoint. Keep current invitation
   revocations and all compatible sessions and expiry dates; never restore an
   old authentication sidecar that could revive access. This is explicit session
   revocation during rollback, with no change to ordinary sidecar retention.
4. Keep every current picker/account tombstone and issued picker ID authoritative.
   An operator must produce and validate a schema-1 ledger projection containing
   those entries before the old reader starts; retain the full version-2 ledger
   for a later forward recovery. Never restore an old ledger over newer deletion
   or issuance history. Refuse rollback if this reconciliation cannot be proved.
5. Retain higher explicit registry cap overrides needed by the old reader. Check
   the intended release, dataset bindings, original IDs and synthetic access
   isolation before restoring admission. Gameplay schema and authentication
   retention do not change during rollback.

## Interim deletion decision (approved 2026-11-16)

Refuse picker/account deletion whenever it would affect a character until stage
3 supplies character deletion and its recovery rules. The response explains
that maps and access are unchanged; the account panel disables affected controls.
This separate product approval resolves the question originally recorded in PR
#302. Format approval alone did not authorize the interim behavior.

The existing low-level tombstone APIs remain for operator recovery, including
reconciliation of deletions begun by previous releases and sanitized restores.
They are not new self-service character lifecycle endpoints. Character deletion,
moves, handover, Past maps and owner invitations remain deferred.

## Verification

Use synthetic rosters of sizes 1, 2, 3, 4 and 5, including several same-login
characters in one group. Cover exact selection, invalid/mismatched targets,
independent tabs, unavailable/empty-login selection and duplicate-name review.
Exercise today's registry migration, viewers, legacy two-member access, ambiguous
claims and unchanged gameplay bytes. Interrupt and retry every durable migration
and provisioning seam, including after publication but before the response.
Assert stable IDs, one ready placement, quota accounting and retained preimages.

Run focused registry, sign-in, routing, account-panel, switching and recovery
checks with each file's `testRunPolicy`, one worker and the shared-PC lease.
New browser modules/routes also require the server and browser-module-graph
checks. Explore the UI against an isolated synthetic server. Update only the
launch-readiness rows actually completed; full CI remains required for landing.

### Assertion map for the interim deletion boundary

The former successful self-service deletion assertions cannot describe stage 1:
the approved behavior is now refusal before fencing or mutation. Their coverage
is carried as follows; this does not claim the stage-3 deletion workflow exists.

| Earlier assertion | Stage-1 coverage |
| --- | --- |
| Session/origin/field/target validation; option absent | `picker-deletion.test.mjs` retains those assertions, including refusing a foreign picker without opening it. |
| Picker/account deletion, stream closure, key revocation and unrelated picker isolation | Refusal cases assert unchanged registry/gameplay/key bytes, live streams and usable credentials; `phase1-acceptance` P1.4 covers overlay delivery. Existing operator tombstones still revoke and purge through `picker-deletion-crash.test.mjs`. |
| Account subjects, all owned pickers and old credentials removed | Self-service now preserves them. Operator account retirement and non-reuse remain in registry, crash and stopped recovery tests. |
| Retained backups/checkpoints cannot resurrect deleted maps or credentials | Stopped operator tombstones drive `phase1-acceptance` P1.8, `picker-audit-c1` restore cases and `linux-multi-picker` recovery tests, instead of calling the paused HTTP endpoint. |
| Legacy account deletion preserves the shared game | The refusal preserves shared gameplay bytes and access in `picker-deletion.test.mjs`; operator retirement remains covered separately. |
| Owner deletion dialogs clear queued commands/storage and land signed out | `picker-owner-ui` instead checks disabled controls and server refusal with the active document, queued changes, storage, shared game and credentials preserved across restart. Browser-session tests retain teardown on switching; successful character deletion returns in stage 3. |
| Accepted writes drain, active calculator cancels, late delivery is discarded, streams fence before registry cleanup | Refused deletion must do none of these. Routing tests retain accepted writes; P1.5 retains worker-crash/late-delivery isolation; browser-session tests retain queue/stream teardown on switching. Successful live character-deletion fencing/drain must return with stage 3. |
| Key quota releases after deletion | `picker-limits-http` proves refusal preserves quotas, then stopped operator tombstones release them. |
| Logout/rotation and OAuth across deletion | Audit B retains token rotation/logout and proves refusal preserves other sessions; audit C1 proves an in-progress sign-in retains the same principal after refusal. |

New/rebuilt timing-sensitive entrypoints still require the hosted 50-first-pass
proof per relevant OS, and the complete CI gate, before landing. Local focused
runs and browser exploration do not replace those receipts.
