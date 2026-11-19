# Group lifecycle: first and second parts of stage 3

Part of #301 (stage 3). The second part depends on draft #330's handover and
adds leave, owner removal, fresh-invite rejoin and frozen Past maps, following
[Groups and accounts](groups-and-accounts.md). General moves of established
characters, character deletion and final-character/group lifecycle are deferred.
Registry 4 is unreleased; the owner authorized extending that version rather
than introducing version 5. Deployment and the owner's final durable-format
decision remain separate gates. Gameplay save schema 1, issued-ID ledger 2 and
authentication sidecar formats retain their versions.

## Player journey and authority

Open **Account → Group ownership** while acting as the designated owner
character. Choose a specific existing member character and confirm. For another
login this creates a pending offer; that character's controlling login opens
the same control and explicitly accepts or declines. The owner can cancel.
Refreshing reads the durable offer; opening the dialog never changes ownership.
The original owner remains responsible until acceptance.

For another character in the same login, confirmation immediately designates
that character. The explanation states this before confirmation. The former
designated character becomes a player, including in this same-login case.
The final solo character has no successor; the control explains that another
character must join first. The ownerless two-member legacy picker cannot use
this workflow and keeps its existing access and IDs.

The one owner role, designated character, owner login, default-picker preferences
and pending invitation revocations publish together. The previous owner retains
player membership; maps, progress, history, character IDs, placements, occupied
seats and exact plugin/overlay scopes stay intact. A different owned default
is never replaced. No secret link is needed or generated for a handover.

Every API request authenticates current character/picker scope. Owner and
successor authority is checked again under the registry queue. Handover HTTP
mutations also hold that picker's existing durable mutation queue, ordering
handover with previously accepted restores/writes and rechecking the session
after a slow request body. Subsequent owner operations use current roles.
Invitation mutation checks include the designated character inside the registry
queue, so the former owner character loses that authority even within one login.
An unfinished group admission blocks handover until its existing recovery
completes, preserving the reviewed admission template.

## Disk representation and crash recovery

The first valid handover or departure lazily upgrades registry **3 → 4**. Installations on
version 1/2 first use their existing migration paths. Before publication, sync
an exact `registry.pre-handovers-v3.json` preimage, without replacing any
retained preimage. As in stage 2, that published preimage is also the upgrade
intent: restart completes it before ordinary repair or new writes. A conflicting
preimage refuses migration for recovery review. Stage-2 and earlier readers
clearly refuse registry 4 as a newer version.

This is one coherent v3→v4 upgrade: it initializes `handovers`, `departures`
and `pastMaps` together. The preimage filename and migration publication seams
retain #330's names. Restart completes a published preimage before accepting
ordinary writes. A handover-only development v4 file from #330 is not a
released format and is deliberately refused by this extended reader; preserve
any such synthetic development fixture before rebuilding it. Do not deploy
the parent reader against extended-v4 data or copy its preimage over live data.

Each `handovers` row stores:

- A client-generated UUID `id` used as the idempotency key, plus `pickerId`.
- `fromAccountId`, `fromCharacterId`, `toAccountId`, `toCharacterId`.
- `createdAt`, `status` (`pending`, `accepted`, `declined`, `cancelled`), and
  nullable `resolvedAt` (required for terminal rows).

There is at most one pending offer per picker. Receipts are retained without
automatic pruning, with a defensive 20,000-record ceiling; exhaustion refuses
new proposals without changing authority. Metadata exposes character IDs and
status only to authorized roster characters; it does not expose login identities.

Publication sequence:

1. Validate the current owner, exact successor, lifecycle, pending offer and
   admission state. Retain/sync the v3 preimage and atomically publish v4 if needed.
2. Atomically publish the pending proposal. A retry with the same ID and target
   returns its durable status; reuse for another target fails. For same-login
   designation, publish the accepted receipt and complete owner change here.
3. On accept, recheck both roster bindings and the original owner; atomically
   publish the accepted receipt, owner change, membership roles, default-pointer
   updates, and revocation/release of every pending group invitation. Decline
   or cancellation publishes only its terminal receipt.
4. Respond after the durable publication. A same-action retry returns its receipt;
   an incompatible response cannot change a terminal result.

The pending proposal is the durable intent. Resolution touches one registry
document, so interruption cannot leave roles, reservations or invitations partly
changed and needs no gameplay replay. Concurrent proposals have one pending
winner; accept/cancel/decline serialize to one terminal outcome. Restart loads
the published pending or terminal result. Sanitized recovery checkpoints cancel
pending offers as well as revoking pending admission links; they cannot restore
unaccepted ownership offers. Completed role changes and retry receipts survive.

## Rollback position

Do not lower the version or restore the preimage by itself after any lifecycle
operation. An older registry would revive former owner authority, departed
memberships and pending invitations, or lose a character's current placement.
Keep a complete current checkpoint, current registry and ledger, authentication
sidecars and every gameplay directory. Prefer forward repair. A rollback needs
a reviewed matching population/authority restore with incompatible sessions and
old admission links revoked. Keep newer issued IDs, tombstones, placements and
handover/departure receipts and every referenced immutable `past-maps/<UUID>.json`
file authoritative in recovery material, with matching gameplay directories.
Keep exact-slot credential revocations authoritative as well. The preimage is
an upgrade input, not a standalone rollback. This part does not change
any retention period or authorize a deployment.

## Leave, removal and rejoin publication

Account → Leave or remove member reviews the consequences, configured backup
retention and current roster revision before explicit confirmation. A solo
offers Join another group and allocates nothing. The designated owner must
complete Group ownership handover first, then leave as a player. The owner can
remove a non-owner; that login receives its own empty solo and Past maps entry.
The owner cannot read that private retained entry. The legacy two-slot shared
picker refuses ordinary departure and preserves its existing compatibility.

`departures` retains client UUID receipt IDs, controlling and acting account/
character IDs, source/destination picker and member slots, `left`/`removed`,
`createdAt` and nullable `completedAt`. `pastMaps` retains UUID, controlling
account/character, source picker/member, `left`/`removed`/`rejoined`, timestamp
and SHA-256 digest. Both arrays have a 20,000-row defensive ceiling and no
automatic deletion. Pending captures count against the map ceiling. Past maps
consume disk, not active-character quota. Existing member allowlists retain
old IDs; returning characters always get a fresh slot. Five occupied plus
reserved seats remains the maximum. Quota/validation refusal before intent
leaves the original placement usable; incomplete intent stays fenced/pending.

Departure publication, under the source's durable mutation queue:

1. Recheck character, designated owner authority for removal, exact placement,
   review revision, quotas and unfinished admissions. Reserve a fresh solo ID
   in a durable intent. The existing picker-creation rate budget applies to
   new attempts; receipt retries and startup recovery do not charge it again.
2. Add that ID to ledger 2; create/sync its directory and initialize an empty
   schema-1 solo. The intent counts against pending allocation limits and
   fences both placements. Existing accepted source writes finish first.
3. Write/sync an immutable portable schema-1 backup into registry-relative
   `past-maps/<receipt UUID>.json`, then publish metadata and its digest. Retry
   reuses a published snapshot file, even if metadata publication was interrupted.
4. Publish the source's active roster transition. Preserve task definitions
   and History with their historical member IDs; remove current contributions,
   departing claims and checks. Append a non-reversible `member-departed`
   History event using existing event/command/actor fields. Daily progress
   snapshots begin a new roster epoch; the complete prior series stays in the
   Past map and retained backup. History compaction keeps the small identity
   declarations while archiving unrelated events. Undo cannot cross the roster
   boundary or change registry authority. Restores refuse retired slot IDs.
5. Revoke exact old-slot plugin keys, overlays, then invite sessions, each as
   a durable sidecar publication. Close affected streams and clear transient
   previews, transfer reviews and cached calculations. Late operations must
   reauthorize scope/revision; browser success responses recheck the current
   account/character/picker/member tuple before publishing headers. Slow upstream
   previews recheck before retaining a review, so revoked scopes cannot repopulate
   cleared transient work. Account-wide login remains valid for other
   characters; the former document scope fails. No secret follows the character.
6. Atomically publish the new solo, character placement, exact membership and
   capability removal, freed source seat, default preference and completed
   receipt. Cancel pending handover offers involving the departed character.
   Only then report success. Concurrent attempts have one placement winner;
   same-request retry returns the original receipt. Restart completes intents.

Rejoining requires a fresh owner invitation. A solo created by a completed
departure is eligible even after making solo progress. The invitation intent
adds optional `transaction.pastMapId` (equal to its invitation UUID). It freezes
that solo into another Past map, revokes its exact credentials and installs a
fresh destination member using the existing stage-2 map/rules template, never
copying saved progress. Registry publication retires the solo and moves the
character once. The old consumed invitation cannot admit it again after a later
departure. Unrelated established solos/groups remain explicitly ineligible.

Past maps are account-authorized, read-only pages at `/past-maps`, with saved
chunk maps, notes, progress/settings, definitions, History and a complete JSON
download. Files are digest-checked on every read. No mutable gameplay store is
opened to display one. Service checkpoints include every referenced Past file
and verify its digest; stopped restore installs/verifies those files before
registry publication. Recovery's existing `picker-service-recovery-v1` inventory now
allows these referenced files. Capture prevents new placement intents throughout
the store-copy window and refuses already-pending departures/admissions.

## Verification boundary

`group-handovers.test.mjs` covers solo refusal, rosters 2–5 for same/other-login
handover, exact capabilities and unchanged gameplay bytes, concurrent winners,
admission fencing, retry and process exit before/after every proposal/resolution
publication and both migration seams. Migration includes the legacy picker;
sanitized recovery cancels pending offers and retains role changes.
`group-handovers-http.test.mjs` covers explicit confirmation, role refresh,
scope/CSRF failures, invitation revocation, former-owner restore refusal,
publication interruption, restart and same-request retry. These new files are
timing-sensitive and require the hosted 50-first-attempt stability proof on
relevant operating systems plus complete CI before landing. Account-panel
tests exercise the controls and uncertain-response request reuse.

This is synthetic/agent verification, not the outside-user beta acceptance gate.
The complete human acceptance gate remains open. General established-character
moves, character/slot tombstones and final-character/group deletion remain
unimplemented. The automated and browser evidence below uses synthetic data.

Local focused checks use Node 24.20.0, each entry's complete `testRunPolicy`
environment, one worker, BelowNormal priority and shared-PC leases under ten
minutes. The second part's new files cover 55 storage cases, 11 HTTP cases,
four gameplay cases and one capture/restore case. Storage process exits cover
all thirteen leave/removal publication seams and ten rejoin seams. HTTP
interruption/restart cases verify actual key/overlay/invite-session files,
and a gated upstream fetch verifies late preview refusal. Capture/restore
tests interrupt each new Past-file stage and the following registry publication.
These are deliberate fault injections, not timing retries. Adjacent handover,
invitation, registry, state, History, save-transfer, overlay, plugin, server,
browser-module, viewer-browser and gallery regressions are also checked.
The native chown-to-another-UID case in `linux-service-crash.test.mjs` is skipped
on this platform; the other service recovery sweeps pass. Full hosted CI and
50-first-attempt stability receipts are still required before landing.

Latest focused receipts across 29 affected entry files: **486 passed, zero
failed, one platform skip**, with no cancellations or todos. Earlier development
failures were corrected before these receipts; this is not the hosted stability
proof and does not erase the original parent routing failure below.

The parent #330 receipt retains an unresolved routing failure: the slow-upload
test received HTTP 503 instead of 200 at its then-line 870. Three bounded
diagnostic attempts on main `1fc5187` stopped earlier at calculator memory
admission (two insufficient-memory refusals and one restart-required result).
Two additional attempts on updated main `a923b3b` both passed the selected
slow-upload test. The stacked branch's complete routing file also passed
52 cases after integrating parent `6773793`. The original 503 was not
reproduced or diagnosed; passing samples do not establish its cause or stability.
The routing test was not changed by this part.

An isolated fake-OAuth server and incognito T3 preview browser exercised leave,
empty-solo Join guidance, fresh-owner-invite rejoin and Past maps at desktop
1920×1080 and phone 390×844. Both sizes completed real JSON downloads. The phone
journey saved a solo chunk before rejoin, then displayed that chunk in the
read-only frozen map; the downloaded document retained gameplay schema 1.
Past maps had no editing controls, and the inspected phone pages had no
horizontal overflow (390-pixel viewport; 375-pixel departure dialog). No runtime
errors appeared in the inspected snapshots. The new wording identifies the
specific ineligible character when a login also has an eligible returning solo.
The server, shared-PC lease and browser tab were closed. No live save or
personal account was used. Parent #330 separately exercised cross-login
offer/acceptance, cancellation, same-login designation and stale-owner refusal.
