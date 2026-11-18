# Owner invitations: stage 2

Part of [#301](https://github.com/fenerax/chunk-picker-rs3/issues/301), building
on stage 1 / PR #302. Registry/authentication representation approval was given
on 2026-11-16. Gameplay schema 1, plugin 1.0.0 and legacy administrator invites
retain their formats and wire behavior. The ownerless legacy two-member picker
cannot issue these owner invitations and keeps its existing access.

## Approved stage boundary

Stage 2 admits a new character directly, or the initial character of an
**untouched onboarding solo**. The owner approved this boundary on 2026-11-18.
Untouched means all of the following at commit:

- The character was created by first provisioning (`requestId: initial`), is
  active, belongs to the accepting login and still has its original placement.
- The picker is an active, ready ordinary solo with only its designated owner
  seat, only the original `owner` member ID, and no other account/viewer grant
  or registered capability. No other admission is moving that character.
- The authoritative gameplay revision is still **zero**, with only that owner
  member and no gameplay History. Every gameplay command, including Undo,
  increments revision; reverting an edit never makes the picker untouched.
  The proof runs inside its serialized write queue after earlier writes settle.

A progressed character is disabled on the acceptance page, with this explanation:
“This character already has a map in progress. Choose a new character, or wait
until moving characters is available.” **New character** stays available.
An added solo is not an onboarding solo. Ownership of an established picker
never prevents the login from creating a new character in the invited group.

`stage2SourceEligible` and the source-write proof are the stage-3 seam. Moves of
established characters, leave/rejoin, Past maps, handover and character deletion
remain stage 3. Do not broaden eligibility before preserving readable/exportable
Past maps and fencing all previous credentials.

## Issuance, review and commit

The owner opens **Account → Invite players**. Creation checks owner character,
login, lifecycle, seat and record quotas under the registry queue. Pending
reservations and accepted transactions still installing their roster consume
seats. Occupied plus reserved cannot exceed five. A replacement changes the old
record to revoked and installs its replacement in one atomic publication; a
failure preserves the previous published state.

The owner copies and shares the link. There are no messaging integrations.
The secret is returned only by creation; listing returns status and dates.
The link uses the existing `/join/` redaction namespace and a `gin_` secret prefix. Its GET
exchanges the secret into the existing bounded, ten-minute HttpOnly preauth
continuation and redirects to `/auth/group-invite` with no-referrer/no-store.
OAuth state carries that continuation, never the admission secret to a provider.
First-ever login completes its solo provisioning before returning to review.
GET never consumes an invitation or changes placement. The unsigned preview
contains only invitation state and a group player count, not maps or identities.

The signed-in review shows the destination's current owner map geometry
(unlocked/blacklisted chunks and starting chunk), shared rules and map task-rule
overrides. The new slot starts from that geography and those rules, with empty
personal observations, checks, notes and pending selections. Other players'
private progress is not copied. Confirmation names the source retirement, if
any, and revocation of its pending invitations. A changed destination revision
requires a fresh review. The current identity, selected character, source proof,
issuer authority, expiry, quotas and reservation are checked again at commit.

The durable admission intent is the linearization point: it changes the invite
to accepted before expiry and records exactly one login, character and new
member ID. It keeps the reserved seat until roster installation and placement
finish. After this point the transaction must complete, even if seven days
elapse during recovery. Before it, `now >= expiresAt` refuses and releases the
reservation. A competing character cannot consume an accepted record.

Publication order:

1. For a new character, publish its issued ID to the non-reuse ledger.
2. Publish accepted invitation plus transaction and destination member allowlist.
   The source character's ordinary authentication/writes are fenced immediately.
   Destination edits are fenced until completion too, including after a
   recoverable publication error, so the reviewed map cannot change mid-join.
3. Install the destination gameplay member idempotently under its write queue.
   Normal state publication retains its previous backup. The existing daily
   progress-snapshot rule starts a new roster epoch; previous rows remain in
   that retained pre-admission backup. No schema field is added.
4. Publish the occupied seat, character placement and player membership together,
   release the reservation and clear the intent. Retire the untouched source
   picker and revoke its pending invites in this same registry publication.
5. Respond only after durable placement. Same-character retries return
   **Already joined**. Startup repairs outstanding intents before admission.

The source directory is retained without a writable membership. `retired` is
distinct from deletion; it neither recycles an ID nor creates a Past maps entry.
Retired onboarding directories still count in the non-deleted picker ceiling.
Other characters and the destination owner remain unchanged. A service checkpoint
refuses an unfinished admission rather than capturing a partial placement.

## Version, retention and recovery

The first owner invitation lazily upgrades the registry from **2 to 3**, after
syncing `registry.pre-invites-v2.json` under its existing writer lock. This is
a single-document atomic migration; the external ledger remains version **2**.
The preimage is linked from fully written, synced bytes and also acts as an
upgrade intent. Restart finishes it before servicing new writes. A mismatching
retained preimage refuses migration with a recovery-review message.
Schema-1 installations migrate through stage 1 first, preserving the reviewed
roster mapping and preimages. Restart never reuses an issued character ID.

Registry 3 adds `groupInvites` and the `retired` picker lifecycle. Each invitation
has an opaque UUID, SHA-256 secret hash, issuer login/character, group, reservation,
creation/seven-day expiry, distinct pending/accepted/expired/revoked state,
terminal time, accepting login/character, and nullable recovery transaction.
No plaintext admission secret is persisted. A missing/damaged transaction fails
validation rather than guessing a placement.

At most 10,000 invitations may be pending service-wide, 40 per issuing login
(also bounded by ten owned groups and four vacant seats each), and 20,000 records
including terminal metadata. Terminal records remain for 30 days. Cleanup visits
at most sixteen general records per call plus the selected picker's pending
reservations; it never removes an unfinished transaction. Deleting metadata
never makes an unknown hash valid. Issuer loss, ownership change and group
deletion make pending invites immediately unusable, independently of cleanup.
An accepted membership has no dependency on the invitation remaining usable.

Sanitized service checkpoints strip every invite hash and revoke pending offers,
as well as stripping provider identities and capabilities. Joined logins with
no owned default can reclaim their character collection through the existing
operator claim flow, retaining player authority. Restores cannot revive links.
Ordinary authentication sidecar/session retention is unchanged.

## Rollback limits

Stage-1 code rejects registry 3 with “Unsupported newer registry version. Use a
compatible release.” Older schema-1 readers also refuse it. Never lower the
version or delete fields in the live JSON to force an old binary to open it.

Stop and drain admission, retain a complete current checkpoint, current registry,
ledger, authentication sidecars and all gameplay directories, then prefer
repairing forward. Rolling back requires a reviewed restore of the pre-invite
population with matching gameplay and bindings. Keep post-upgrade groups,
placements, retired onboarding maps and invite receipts in recovery storage.
Keep the current ledger's issued IDs/tombstones authoritative, preserve invitation
revocations, and revoke incompatible sessions using a compatible reader. Never
restore an old authentication file or invitation hashes to revive access. The
preimage alone cannot undo admissions or roster writes made after upgrade.

## Verification

`owner-group-invites.test.mjs` covers synthetic rosters 1–5, concurrent claims,
strict source eligibility, quotas, expiry/revoke/replacement, retention, version
refusal, schema-1/2 migration including the legacy picker, sanitized reclaim and
crash/retry at every exported invitation publication seam.
`owner-group-invites-http.test.mjs` covers secret-free GET and OAuth continuation,
first solo before admission, explicit review, scoped owner operations, CSRF,
progress refusal, direct creation, durable retry and restart access.
`account-panel.test.mjs` exercises copy/replace/revoke and acceptance controls.
The two new entry files are timing-sensitive; hosted 50-first-pass receipts and
full CI remain required before landing. No deployment or beta-readiness claim.
