# Character registry: stage 1 design

Proposed implementation for [issue #301](https://github.com/fenerax/chunk-picker-rs3/issues/301).
The issue records owner approval of the registry/authentication representation
change on 2026-11-16. Gameplay save schema 1 and existing authentication-sidecar
retention stay unchanged. Owner invitations belong to stage 2; moves, Past maps,
handover and character deletion belong to stage 3.

This PR currently contains design only. Implementation is paused on the deletion
question below. No launch-readiness row is complete as a result of this note.

## Registry representation and reader version

Use `registry.json` schemaVersion 2. Keep account, picker and gameplay member
IDs. Add a character collection with opaque, randomly generated character IDs,
controlling account ID, optional declared RuneScape name, lifecycle and one
placement `{ pickerId, memberId }`. Keep bindings outside gameplay exports.
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
gameplay roster/name metadata through the storage reader; the registry member
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
4. Keep every current picker/account tombstone and issued picker ID authoritative.
   An operator must produce and validate a schema-1 ledger projection containing
   those entries before the old reader starts; retain the full version-2 ledger
   for a later forward recovery. Never restore an old ledger over newer deletion
   or issuance history. Refuse rollback if this reconciliation cannot be proved.
5. Retain higher explicit registry cap overrides needed by the old reader. Check
   the intended release, dataset bindings, original IDs and synthetic access
   isolation before restoring admission. Gameplay schema and authentication
   retention do not change during rollback.

## Contract question: deletion during stages 1 and 2

**Should stage 1 temporarily refuse existing picker/account deletion whenever
it would affect a character, until stage 3 supplies character deletion and its
recovery rules?** If existing deletion must remain available, which interim
character and placement behavior is approved?

The final deletion contract is explicit, but the interim behavior is not.
`app/picker-router-deletion.mjs` currently gathers every active owned picker for
account deletion; `app/storage/registry.mjs` retires them together. After Add
character allows several owned groups, keeping that cascade without character
handling can leave surviving character records without a live placement or
remove a group containing another login's character. The account panel also
describes a single owned picker. Even deleting a solo picker now requires a
decision about its character, since active characters must always have a group.

The proposed interim behavior is a server-side refusal with a clear explanation
and matching unavailable controls. It would preserve existing maps, memberships,
keys and sessions. It would temporarily remove an existing self-service action,
so this note asks for that product decision instead of inferring it from the
format approval. Implementing character deletion, moves or handover here would
cross the explicitly deferred stage-3 boundary. No deletion behavior has changed
in this PR.

## Planned verification after the question is settled

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
