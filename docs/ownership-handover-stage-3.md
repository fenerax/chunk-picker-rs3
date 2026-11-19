# Group lifecycle: stage 3

Part of #301 (stage 3). Handover, leave, owner removal, fresh-invite rejoin and
frozen Past maps are followed by character, final-group and login deletion,
following [Groups and accounts](groups-and-accounts.md). General moves of
established characters remain deferred. The owner approved registry **4 → 5**
and external ledger **2 → 3**, including migration and restore reconciliation.
Gameplay save schema 1 and authentication sidecar formats keep their versions.
Deployment, retention-policy publication and outside-user acceptance remain
separate gates. The earlier verification receipts below describe their own
commits, before the deletion implementation.

## Deletion state machine

**Account → Delete character / Delete picker / Delete account** opens a review
of every character ID/name and group ID affected. The character menu also offers
Delete login, including for an empty login. Review discloses configured backup
retention and what remains. Final-group deletion needs its own checkbox.
Opening a review allocates nothing and deletes nothing.

Only a controlling login deletes a character. A designated owner must complete
handover before deleting that character while any other character remains,
including another character of the same login. A final character must explicitly
include its group. Group deletion requires the designated owner and refuses
while another login has any character there; remove those characters through
the existing empty-solo/Past-map path, or hand over ownership first. Login
deletion reviews its complete collection and requires every necessary handover.
Provider loss never chooses a successor. Character deletion leaves the login
and its other characters available; deleting the last character leaves an
explicitly empty login, without automatic replacement on sign-in.

The review token binds the session, account, exact selection, complete roster
and target list, and map revisions. Confirmation drains/rechecks reviewed maps,
then rechecks the session and full list inside the registry queue. A registry
intent fences all target groups before final drains, which run one context at
a time so a ten-character login stays within the residency cap. Already
accepted writes settle before cleanup. Another membership, ownership or map
change requires a fresh review. A lost response retains the same request and
pauses browser saves/polling until its result is recovered.

Publication and recovery:

1. Complete the two-file migration below, then publish the deletion intent,
   deleted-character IDs and exact retired slot bindings in external ledger 3.
   Copy the intent into registry 5. The ledger wins if that copy is interrupted.
2. Under each group's existing mutation queue, remove deleted characters from
   surviving gameplay rosters through `departMember`. Keep other maps and
   historical attribution; remove current access, supplies, checks and claims.
   Existing schema-1 History creates a non-reversible roster boundary. Final
   groups are drained/purged through the existing picker tombstone path instead.
3. Reuse `revokeDepartedMember` for the exact slot's plugin keys, overlay links,
   invitation sessions, streams, reviews/previews and cached results. Other
   characters' keys and account-wide login remain usable. No credential follows
   a deleted character. Pending ownership offers involving it are cancelled;
   pending invitations issued by a deleted owner/group are revoked and released.
4. Publish completion in the external ledger, including final-group tombstones
   and an account tombstone only for login deletion. Reconcile registry roles,
   seats, memberships, defaults and capability indexes. Then finish the existing
   picker/account purge and only report success after revocation/drain completes.
   Existing operator account retirement retains its separate cascade.

Receipts retain UUID, action, controlling account, selected character/group,
final-group acknowledgement, exact target bindings, final groups, creation and
completion timestamps. Registry 5 adds `deletions`; ledger 3 adds `slots` and
`deletions`, and populates its formerly reserved `characters` array. Character
tombstones are `{characterId, deletedAt}`; slot retirements are
`{pickerId, memberId, characterId, retiredAt}`. Historical retired solos lacking
a recorded character use a null character ID rather than guessing identity.
The deletion-receipt ceiling is 20,000; issued/retired character IDs and retired
slots have separate default ceilings of 1,000,000. Exhaustion never recycles IDs.
HTTP receipts also retain a one-way `receiptProof`, binding the review token,
original session cookie and exact selection. It can recover only that completed
receipt after restart/session removal; it cannot authorize another deletion or
gameplay access. Sanitized registry checkpoints omit this proof, and restores
obtain it only from the retained live ledger. Review tokens and cookies are
never written to these records.

## Registry 5 / ledger 3 migration and restore

Startup upgrades existing lifecycle registries through registry 4. A fresh
stage-1 registry upgrades before its first deletion or binding retirement;
new departures and joins cannot retire a slot without external ledger 3.
Retain and sync exact, non-overwriting `registry.pre-retirements-v4.json` and
`ledger.pre-retirements-v2.json` preimages. A published registry preimage starts
upgrade recovery. Publish `retirement-migration.json` containing source digests
and complete targets, publish ledger 3 first, registry 5 second, then mark the
intent complete. Restart verifies source/target bytes and resumes each seam;
conflicting retained preimages or changed sources refuse startup. Readers
refuse unknown future registry/ledger versions, and older releases refuse these
new versions. Preimages are upgrade inputs, never standalone rollback files.

The live external ledger is authoritative when an older registry/gameplay
checkpoint is restored. Never replace it with an older backup. Reconciliation
removes completed deleted characters, memberships and capabilities and restores
the ledger's receipts. Startup replays cleanup and exact credential revocation
for completed receipts too, before listening, because restored gameplay and
sidecars may predate deletion. Ordinary imports and backups cannot put retired
slot IDs back into the live roster. Departures and rejoin after migration also
publish old-slot retirement to the ledger before their new placement.

If an older registry would reactivate a moved character's retired binding, or
would restore an owner deleted after handover, recovery refuses and requires
the current character/owner mapping. It never invents a destination, successor
or active binding from gameplay. Preserve current registry and ledger, every
referenced Past map, matching gameplay and sidecars for forward repair. This
change does not alter off-host checkpoint transport; that work is separate.

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
The complete human acceptance gate remains open. This earlier receipt predates
character/slot tombstones and final-character/group deletion, now described
above. General established-character moves remain deferred. The automated and
browser evidence below uses synthetic data.

Local focused checks use Node 24.20.0, each entry's complete `testRunPolicy`
environment, one worker, BelowNormal priority and shared-PC leases under ten
minutes. At `d569757`, the second part's new files covered 57 storage cases,
11 HTTP cases, 13 gameplay cases, three browser cases and one capture/restore
case. Storage process exits cover
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

The original implementation receipt at `d195228` across 29 affected entry files
was **486 passed, zero
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

## Review follow-up

The three P2 findings on #331 have regressions that fail on the corresponding
original code. Per-player goal inverses now validate against each departure
epoch's roster; the historical identity union remains available for old task
references. Tests cover rosters 2–5, repeated departures, checks, Undo, portable
round-trips and compacted History across restart.

Departure first drains pending saves under a reversible admission/polling gate.
A definite refusal releases that gate and keeps the document and confirmation.
A lost response keeps saves, polling and character switches paused until the
same request resolves. The cached dialog retains its selected target,
confirmation and request ID when closed/reopened. Only known success triggers
destructive teardown and navigation. Real-browser tests cover stale-review
refusal, failure before the request reaches the server, and loss of a success
response after the server commits. The latter two retry the same request and
verify one departure/Past map, including on phone-sized viewports.

The departure actor label replaces control characters, trims and bounds to 80
characters, then uses a safe fallback if empty. Original display names remain
unchanged in Past maps. The lifecycle audit found no other raw display-name
to History/registry-label conversion: invitation/rejoin use the validated,
trimmed 1–12-character canonical RuneScape name; handover records IDs and uses
those canonical names only for presentation. A combined restored-name handover,
departure and rejoin test verifies that boundary.

Recovery also completes an already-persisted older departure with its empty
destination and frozen Past map published, where the old build would fail while
preparing the invalid actor. It retains the same receipt/destination, preserves
the full saved name, and remains readable after another restart. These fixes
add no durable fields or migration and leave registry 4, ledger 2 and gameplay
schema 1 unchanged. The first review-fix receipt at `d569757` covers 14 files: **307 passed,
zero failures, no skips**. Hosted CI and fresh stability proof remain required.

## Re-review recovery fixes

Admission now checks pending transactions in both directions inside the registry
queue. A solo with an incoming admission cannot rejoin elsewhere, and a group
with an outgoing move cannot accept another member. Concurrent attempts have
one winner before either second intent is published.

For overlapping intents written by older builds, recovery keeps the incoming
admission and the solo's designated owner. It removes only the outgoing move's
unplaced destination projection through the normal backed-up departure boundary,
revokes that slot's credentials, then publishes the invitation as revoked and
releases its reservation. Issued IDs, retained backups and any frozen Past map
remain. The original transaction remains the recovery intent until cancellation
publishes. Restart can resume after projection removal, each credential sidecar,
or terminal registry publication, including when an older recovery already
finished the incoming admission. No successor is selected or credential revived.

Usage reads validate against retained allocated member IDs; new usage submissions
follow the current roster, including newly joined members. Restart fixtures also
retain plugin achievement suppression, live/beta/unknown item and bank evidence,
journal commit ledgers, currency metadata, plugin keys, overlays and invite sessions. Those other sidecar readers
validate saved ID syntax independently of the current roster; live operations
recheck membership. Progress-source observations and multipart assemblies are
memory-only and are cleared by existing departure fencing.

Task assignments remain historical. Restore and roster mapping read departed-ID
declarations from existing incoming History/provenance archives, without replaying
their inverses or interpreting unrelated previous-save History. Current claims
and per-player goals remain restricted to the live roster. Command/Undo
validation preserves that split. Roster mapping refuses a collision between a
historical departed ID and a destination player, rather than silently giving
that player the former assignment.

These fixes add no durable fields or versions: cancellation uses existing
revoked-invitation, backup and departure-History shapes; usage schema 1,
gameplay schema 1, registry 4 and ledger 2 remain unchanged. The forward-repair
rollback position above still applies. Reverting to the affected builds can
reintroduce the overlap and reject historical usage/assignments; do not treat
such a downgrade as a repair.

The final re-review receipt is **304 passed, zero failures, no skips across 17
affected files**. It includes 90 departure storage cases, 14 departure HTTP
cases, 14 gameplay cases and six usage-storage cases, plus state, transfer,
History, invitations, goals, server/module loading and browser checks. The 26
older-conflict recovery combinations cover both destination projection states,
both incoming placement states, pre-publication interruption and every following
roster/credential/registry seam. Actual HTTP server startup completes recovery.
Restore/import cases cover rosters 2–5, repeated restores, remapping, reassignment
Undo and restart; another HTTP journey restores and imports the exported save.
The existing desktop/phone refusal and same-request network-retry browser tests
also pass. All three reviewed failures were reproduced before their fixes.
Full hosted CI and a new 50-first-attempt stability receipt remain required.
At that earlier commit launch-readiness was **55 shipped / 37 partial / 17
missing**. The deletion, rename and off-site tooling updates bring the current table to **68 shipped /
28 partial / 13 missing**; human/operations gates remain separate.

## Initial deletion verification

The initial deletion change's focused receipt, before the review fixes below, is **460 passed, zero failures or skips
across 27 distinct entry files**. It includes 38 deletion storage cases, 15 authenticated
HTTP cases, six stopped-recovery/operator-retirement cases and two new browser
journeys. Process exits cover both migration preimages, the retained migration
intent, both version publications, deletion intent/registry completion and the
roster/key/overlay/session seams. A post-publication I/O fault verifies that an
uncertain migration fences its writer until restart. Restores cover pending and
completed deletion, older registry/gameplay, obsolete moved bindings and old
owner mappings. Other checks cover ten-character logins, quota refusal, exact
stream/key/overlay/invitation-session revocation and late preview refusal.

The browser journeys use isolated synthetic accounts and headless Chrome at
2560×1440 and 390×844. Both explicitly confirm final-character/group deletion,
lose the success response, close/reopen the confirmation, retry the same UUID
and reach the empty-login menu. The retained form stays checked, one deletion
receipt exists, and neither viewport has horizontal overflow. Empty-login
deletion review remains available. Existing departure browser regressions pass.
The owner UI regressions also verify that closing/changing a dialog while saves
drain prevents POST, a 503 respects Retry-After without automatic retries, and
failed browser cleanup can be retried without sending another deletion.
The existing gallery browser check also passes with a real synthetic sample
opened directly and inside a frame, covering module startup and gallery guards.

Replaced-test coverage is retained as follows:

| Previous checks | Current checks |
| --- | --- |
| `picker-deletion`: interim blanket refusal | Unconfirmed/legacy refusal preserves maps, keys and streams; `character-deletions-http` exercises the allowed character, final-group and login lifecycles. |
| `picker-audit-b`: session deletion token, stale login and queued expiry | Session/cookie-bound review tokens reject missing, forged, foreign and other-session confirmations. Expiry is rechecked after queue waits; completion retries return the same durable receipt. |
| `picker-owner-ui`: old confirmation/preflight, cancellation and cleanup | The reviewed list needs both acknowledgements. Scope changes/closed dialogs cannot POST, drain gates serialize actions, definite refusal restores usability, uncertainty retains the UUID, and cleanup retry sends no second deletion. Non-multi-picker markup/sign-out parity remains checked. |
| `picker-routing`: signed-out deep-link denial wording | Both providers still preserve the requested link and return 403 for another or missing group. The page now explains unavailable access and links to the login's character menu; the old generic-text assertion is replaced by checks for that explanation and menu. |
| Handover/invitation version and migration checks | Explicit synthetic old-format fixtures retain the earlier preimage, legacy/gameplay preservation and crash assertions. Current expectations include registry 5; unknown future-version checks use registry 6 and ledger 4. |

All local checks use Node 24.20.0, each entry's complete `testRunPolicy`
environment, one worker, BelowNormal priority and shared-PC leases under ten
minutes. The mechanical UI detector reports no findings. This is synthetic
verification; complete hosted CI and fresh 50-first-attempt stability receipts
remain required before landing. No live save, deployment or human acceptance
is covered by these results.

The complete **400-file quick selection** was exercised locally in sequential,
lease-bounded batches. The original third batch reached its lease limit during
`picker-routing`; continuation resumed that file and covered the remaining
selection. Its old generic denial-text assertion was updated to the explanatory
page above, then all 52 routing cases passed. One unchanged Windows failure
remains: `projection-measurements.test.mjs` calls `rss` in
`scripts/perf/projection-warm.mjs`, which reads Linux `/proc/<pid>/status`.
Platform and private-harness skips remain reported. This is not an all-green
quick-suite receipt; complete hosted CI and stability proof are still required.

## PR #334 review fixes

Pending login-deletion receipts in the live ledger now fence character and
owned-group allocation inside the registry queue. This covers Add character,
first-login/default provisioning, invitation creation and acceptance, departure
solos and new legacy bindings. The character/placement writer also checks the
fence before publishing new issued IDs. Startup does not provision a deleting
login's reserved groups. Tests compare registry/ledger bytes after refusals,
resume the intent after restart and verify the surviving login remains usable.

A completed deletion retry returns its retained receipt without opening any
group, purging or replaying credential cleanup. New Progress previews and restore
reviews created by survivors remain usable. Startup recovery still replays
completed records before listening, as required when restoring older gameplay
or sidecars; unfinished client requests resume only their own transaction.

Pending login receipts reserve retired-account capacity until completion. Every
ledger writer honors that reservation, including operator account retirement.
Character and slot retirement records already consume their capacity with the
intent. Exhaustion of any of these three ceilings refuses before a new intent,
roster change or credential revocation. These reservations use existing receipt
records and introduce no new durable fields or versions. The strict defaults
assertion explicitly includes `retiredSlots: 1000000`.

The branch includes rename authority from #333. Departure/deletion revocation
also uses its exact `revokeMemberPluginKeys` helper after revoking the slot's
sidecar keys. The controlling-login rename checks and both normalized-name and
formatting-only behavior remain covered by the rename tests.

The five files cancelled by shard 2's original cap assertion all pass directly:
`training-planner` (23), `scheduling-server` (10), `storage-reader-purity` (4),
`cache-topology-application` (12) and `picker-properties` (15), for **64 passing
cases** with no skips or cancellations. The property case retains all 1,000
fixed-seed saves. New review regressions cover allocation fencing, receipt
purity, capacity reservations and unchanged state after cap refusal; HTTP tests
exercise a concurrent Add character and surviving Progress/restore reviews.

### Integration with off-site service recovery (#335)

Service recovery v2 retains the complete ledger as opaque, versioned,
digest-pinned bytes. Registry 5 remains responsible for interpreting ledger 3;
capture, clean-host initialization and rehearsal never discard its character,
slot or receipt records. Reconciliation operates on a disposable ledger copy
under the live ledger's lock and preserves the authoritative bytes.

The registry supplies a transient roster projection to recovery probes and
quarantine release. It excludes retired slots while retaining the historical
member-ID allowlist in the checkpoint. Comparing gameplay against the entire
allowlist incorrectly quarantined a valid post-deletion map. This projection
adds no durable field or version and does not interpret ledger records in the
transport layer.

`character-deletion-offsite.test.mjs` creates a real joined character, deletes
it from a surviving group, captures and uploads the service pair, initializes
a missing target ledger through the `restore-clean` path, and verifies its
bytes against the captured digest. It removes the original roots and runs
the captured decoder and a real isolated service rehearsal from the downloaded
pair, including fresh-key revocation. Both restored targets reject the deleted
character and retired slot after an older registry checkpoint is installed.
The end-to-end case and the six deletion-recovery cases pass locally.

The current quick selection contains **401 files**. Review-fix receipts plus
post-merge reruns cover the full inventory, with unchanged passing receipts
reused and the affected service-recovery files rerun. All 401 files completed;
400 passed and the existing Windows-only `projection-measurements` failure
remains (`rss` reads Linux `/proc/<pid>/status`). Platform/private-harness skips
remain visible. Validation used Node 24, one worker, BelowNormal priority and
sequential shared-PC leases. This remains a local receipt with that explicit
failure; full hosted CI and stability proof are required before landing.

### Re-review: pending intents, retirement capacity and older backups

Login deletion now checks the login's complete in-flight lifecycle, including
accepted invitations whose new character has no placement yet, incoming/outgoing
admissions, departures/removals, pending handovers and provisioning. The check
runs again inside the registry queue, before publishing the deletion intent.
Operator account/picker retirement and relink's source-account retirement also
refuse overlapping lifecycle work; settled operator retirement retains its
existing owned-group cascade.

Pending departures and existing-character invitation moves reserve their source
slots against the retired-slot ceiling. Every lifecycle registry/ledger writer
counts the union of retired slots and pending source bindings. Finishing a move
converts its reservation into the existing ledger record without consuming a
second slot; cancellation releases the reservation. Operator retirement and
relink preflight also reserve their eventual character/slot records before a
tombstone or identity move can become durable. No new durable fields or versions
are introduced.

For service restore, the registry projects authoritative member removals from
the live ledger into transient probe input. The captured runtime applies the
existing departure History boundary to the disposable staged store before its
portable export and roster comparison. Completed and unfinished deletions are
handled, as are retired non-live bindings. The same path serves legacy preflight,
ordinary picker restore and quarantine release; source backups and authoritative
ledger bytes remain intact. Obsolete owner/move mappings still require recovery
of the current registry rather than inventing succession.

The re-review regressions cover stale login-deletion confirmation after pending
new/existing-character invitation acceptance, pending handover/departure
participation, cross-intent slot capacity held across restart, and unchanged
registry/ledger/gameplay after capacity refusal. A real-runtime pre-deletion
backup restores after completed or pending non-owner deletion and releases from
quarantine, preserving the surviving owner's map and earlier History.

Focused re-review validation passes: **226 lifecycle cases**, **19 HTTP deletion
cases**, and an overlapping **58-case migration/capacity rerun** after migration
preflight changed. All **four real-runtime older-backup cases** pass, including
interrupted install and quarantine-release retry with one departure History
boundary. The existing off-site capture, missing-ledger clean restore and real
rehearsal proof passes again, as do off-site/tool-package/owned-closure checks
with their reported platform skips. Full hosted CI and stability proof remain
required before landing.

The fresh re-review quick inventory covers **401 files: 399 passed, two failed**.
`linux-multi-picker` encountered Windows `EPERM` during an atomic synthetic
registry rename in the dormant-picker health case; `projection-measurements`
still reads Linux `/proc/<pid>/status`. The plugin-items file's first attempt
hit the shared-PC lease limit. Subsequent bounded name-selected executions
include a complete **274-case pass with no skips**, matching its unchanged case
inventory; the interrupted attempt remains recorded. All files are accounted
for, with platform/private-harness skips retained. This is not a green local
quick receipt; full hosted CI and stability proof remain required.
