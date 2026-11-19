# Ownership handover: first part of stage 3

Part of #301 (stage 3). This is the independently usable handover prerequisite
for the lifecycle in [Groups and accounts](groups-and-accounts.md). Registry
representation approval is recorded in #301 (2026-11-16). This part does not
implement leave, established-character moves, rejoin, Past maps, member removal
or character deletion. Their readiness rows stay open. Gameplay save schema 1,
the issued-ID ledger version 2 and authentication sidecar formats are unchanged.

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

The first valid handover lazily upgrades registry **3 → 4**. Installations on
version 1/2 first use their existing migration paths. Before publication, sync
an exact `registry.pre-handovers-v3.json` preimage, without replacing any
retained preimage. As in stage 2, that published preimage is also the upgrade
intent: restart completes it before ordinary repair or new writes. A conflicting
preimage refuses migration for recovery review. Stage-2 and earlier readers
clearly refuse registry 4 as a newer version.

Registry 4 adds a top-level `handovers` array. Each row stores:

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

Do not lower the version or restore the preimage by itself after handover.
An older registry would revive former owner authority and pending invitations.
Keep a complete current checkpoint, current registry and ledger, authentication
sidecars and every gameplay directory. Prefer forward repair. A rollback needs
a reviewed matching population/authority restore with incompatible sessions and
old admission links revoked. Keep newer issued IDs, tombstones, placements and
handover receipts authoritative in recovery material. This part does not change
any retention period or authorize a deployment.

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
The full invite/switch/leave/rejoin journey remains blocked on the unimplemented
move and Past maps lifecycle, including snapshot retention/export, credential
revocation, historical contributions, owner removal and character tombstones.

Local focused checks used Node 24.20.0, each entry's complete `testRunPolicy`
environment, one worker, BelowNormal priority and the shared-PC lock in leases
under ten minutes. Latest results across thirteen distinct files: **262 passed,
one failed**, no skips/cancellations. The new storage/HTTP cases passed 30/30 and
3/3; account-panel passed 16/16. Character registry, owner invites (storage/HTTP),
registry, server, browser-module graph, invitation/session storage, account
reclaim and gallery checks passed. Picker routing passed 49 cases and failed
`a slow backup upload is received outside residency; another picker is served
meanwhile`: line 870 received HTTP 503 instead of 200 on another picker's cold
state request. The assertion did not retain the response body, so the precise
503 source remains unresolved. That test was not retried or changed; this is
not an all-green result and does not establish whether the failure predates
this branch. Full hosted CI and stability receipts remain required.

An isolated synthetic server with fake OAuth and an incognito T3 preview browser
exercised cancellation, cross-login offer/acceptance, invitation revocation,
same-login designation and former-owner invitation refusal (403). The dialog
was inspected at desktop 1920×1080 and phone 390×844; the phone document had
390-pixel scroll width and a 375-pixel dialog. No runtime errors appeared in
the inspected snapshots. Both server and tab were closed. No live save or
personal account was used; leave/rejoin/Past maps browser journeys remain open.
