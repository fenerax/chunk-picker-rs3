# Multi-picker isolation contract

This is the contract for the next implementation phases. Phase 0 measures the
existing single-picker server; it adds no account provisioning or tenant routing.
Source references below were verified at core commit `6836123`.

## Identity and ownership

A picker is the boundary for a saved game, its members, and every private object
derived from that game. Its ID has format `p_` followed by 32 lowercase hexadecimal
digits from 128 random bits (`^p_[0-9a-f]{32}$`). Allocate it once in a durable
registry transaction. Keep it through restart, export/restore, eviction and moves
between hosts. Never reuse a deleted ID. Display names, provider subjects, member
IDs and directory names supplied by a client cannot select a filesystem path.
Existing task identity lookup at `app/server.mjs:1317` concerns game objects, not
this new picker ID. The current single default directory is selected at
`app/game-profile.mjs:6`; its dataset receipt is a sibling at
`app/dataset-binding.mjs:6`.

The server-wide account registry maps an account ID to explicit memberships:
`{ pickerId, role, memberId }`. Roles are `owner`, `player` and `viewer`. An owner
or player has a member ID validated within that picker; a viewer has no player
mutation authority. A member ID is local to its picker and may equal a member ID
in another picker. Account sign-in sessions identify the account; each request
must then select and authorize a membership. The current account file lives
inside one save (`app/storage/accounts.mjs:40`), and its memberships contain
invite ID, role and member ID without a picker (`app/storage/accounts.mjs:31`).
Invitations and sessions currently share one file (`app/storage/invites.mjs:75`)
and resolve principals there (`app/storage/invites.mjs:99`,
`app/storage/invites.mjs:230`). Those are extraction points, not global grants.

Each account gets at most one owned default picker. Concurrent first-login
callbacks must create or resume the same durable provisioning record, including
after a crash between registry and directory writes. Linked sign-in providers
remain one account. Start a new owned picker with `createGroupState` and one
neutral owner, empty progress and no copied private evidence
(`app/core/state.mjs:630`). Current startup can seed multiple default members
(`app/server.mjs:577`, `app/storage/store.mjs:806`); current sign-in requires a
claimed invitation (`app/signin.mjs:101`, `app/signin.mjs:120`,
`app/signin.mjs:262`). Neither behavior constitutes public provisioning.

The existing shared duo is the explicit exception. Register it as one
`legacy-shared` picker, preserve its established two memberships and their
permissions, and preserve its state, history and pinned inputs. Each established
participant may also own one private default picker. The shared legacy picker
does not consume that default ownership slot; arbitrary new shared pickers are
not permitted by this exception. Do not split or clone its progress to provision
accounts. The current members transition explicitly requires two players
(`app/core/state.mjs:2071`), the task peer lane validates a second member
(`app/server.mjs:1582`), and partner projections use the shared state
(`app/server.mjs:701`). Solo behavior must be reviewed separately.

## Shared runtime and private contexts

Share immutable game runtime data, pack/art files and verified manifests,
reference definitions, topology, rule definitions, static web assets, and a
bounded pool of compiled calculator engines. Compiled reuse is keyed by dataset
digest, code/engine version and rule configuration. Each calculator still owns
its own compiled heap. Current world construction occurs per server
(`app/server.mjs:475`, `app/server.mjs:482`); workers independently compile
engines (`app/tasks/worker.mjs:33`, `app/tasks/worker.mjs:53`). Shared serialized
bytes do not share parsed heaps (`app/tasks/shared-bytes.mjs:1`).

Each picker context owns these resources:

| Resource | Current single-picker assumption to replace |
| --- | --- |
| Store, lock, current state and write queue | One `openStore` at `app/server.mjs:585`; directory/lock and files at `app/storage/store.mjs:224`, `app/storage/store.mjs:232`, `app/storage/store.mjs:239`; current state at `app/storage/store.mjs:245` and write queue at `app/storage/store.mjs:318`. Keep one writer per directory. |
| Revisions, history, undo, backup replacement and mutation serialization | Revision checks at `app/storage/store.mjs:861`, history compaction at `app/storage/store.mjs:624`, replacement at `app/storage/store.mjs:950`, history reads at `app/storage/store.mjs:989`, one HTTP mutation queue at `app/server.mjs:834`. |
| Action sessions, receipts, acknowledgement and retry namespace | Files under the directory at `app/storage/store.mjs:244`; action-session dispatch uses the one store at `app/server.mjs:1721`. The same request ID or revision in two pickers has no shared meaning. |
| Private state/static fields, custom tasks, aliases, evidence, rules, notes and progress | Reusable fields at `app/storage/store.mjs:344`, compressed static storage at `app/storage/store.mjs:437`. A content hash does not make private provenance public or safe to intern as mutable state. |
| Response, identity, task, calculation and preview caches | State cache uses revision/view at `app/server.mjs:689`; one identity index at `app/server.mjs:705`, member task cache at `app/server.mjs:724`, calculation snapshot at `app/server.mjs:947`, progress previews at `app/server.mjs:651`. Keep these in the context or key every shared entry by picker ID and provenance. |
| SSE subscribers and revocation | One client set/broadcast at `app/server.mjs:715`, `app/server.mjs:717`, revocation check at `app/server.mjs:828`, stream route at `app/server.mjs:1678`. No private revision, task-ready, plugin or overlay event crosses a picker. |
| Plugin keys, reports, upload fragments, sequencing and evidence | One key file/hash lookup at `app/plugin-keys.mjs:41`, `app/plugin-keys.mjs:60`; state maps at `app/game-plugin.mjs:42`; evidence at `app/plugin-items.mjs:43`, `app/plugin-achievements.mjs:72`; member/name cache at `app/integrations/runemetrics.mjs:66`. |
| Invitations, overlay capabilities, feedback and usage records | Sidecars close over one directory/store at `app/server.mjs:617`, `app/server.mjs:621`, `app/server.mjs:625`; overlay file/subscribers at `app/overlays.mjs:89`, `app/overlays.mjs:94`; usage actors at `app/storage/usage.mjs:66`. |
| Backups, binding, backup status and restore scope | Snapshot barrier/spool/capture at `app/storage/snapshot.mjs:6`, `app/storage/snapshot.mjs:27`, `app/storage/snapshot.mjs:38`; sibling backup status at `app/storage/backup-status.mjs:59`. Give each picker distinct status and backup namespaces. |

Workers must carry picker ID and dataset digest with every job, snapshot, result,
cache entry, cancellation and error. Supersession is per picker. Current scheduler
revision state is singular (`app/tasks/scheduler.mjs:82`,
`app/tasks/scheduler.mjs:84`), as are worker revision and baseline caches
(`app/tasks/worker.mjs:150`, `app/tasks/worker.mjs:161`). Snapshot lookup currently
uses revision/input (`app/tasks/worker.mjs:274`, `app/tasks/worker.mjs:286`). A
higher revision in A must not cancel B. Recheck membership, dataset and revision
when delivering a result and immediately before committing a queued write. Drain
accepted writes, readers, plugin flushes and jobs before eviction; drop private
references and release the writer lock. SSE alone must not pin a heavy context.

Each picker records dataset ID, contract version, full digest and immutable
pack/profile/add-on pins. Restore requires compatible verified inputs; do not
rewrite provenance to make a mismatched save load. Existing binding verification
is at `app/dataset-binding.mjs:16`; independent backup checks are at
`app/game-profile.mjs:51`; original-source validation is at
`app/core/state.mjs:192`, `app/core/state.mjs:208`. The current module graph has one
provider per isolate (`app/dataset-runtime.mjs:1`) and refuses runtime switching
(`app/dataset-runtime.mjs:85`). Phase 1 can require one dataset version for public
pickers. Supporting multiple simultaneous versions requires an explicit runtime
boundary and a global version-residency cap.

## Authorization and powers

Dispatch in this order:

1. Parse the request and apply global body, connection and admission limits.
2. Authenticate the account session or capability hash through a lightweight
   global index; determine its picker and member/role scope.
3. Validate the optional requested picker against that trusted scope, check that
   the picker and membership are active, and apply account/picker quotas.
4. Acquire that picker context, then invoke its plugin, overlay or API handler.
5. Recheck authorization at asynchronous delivery and queued mutation execution.

Today plugin and overlay handlers run at `app/server.mjs:1193` and
`app/server.mjs:1194`, before normal browser authentication at
`app/server.mjs:1197`. They must resolve a trusted capability scope before touching
any private store, preview, cache or handler. A body-supplied picker/member ID,
unguessable object ID or gameplay hash is never authority. Plugin credentials
must bind picker, account and member; conflicting request selectors are refused.
Keep a hash-to-picker index so reports do not open every store. Existing report
authentication is at `app/game-plugin.mjs:405`, with linked-player checks at
`app/game-plugin.mjs:65`. Queued browser writes already reauthenticate at
`app/server.mjs:1718`; preserve and extend that check.

Owners may run ordinary game commands, set their picker's rules/preferences,
manage that picker's member invitations and capabilities, export gameplay,
preview/restore a compatible gameplay backup, and request deletion of their owned
picker. Players may run permitted gameplay commands for their linked member;
viewers can read only their authorized views. Keep an explicit command allowlist
and validate every referenced member/object inside the selected picker. Owners
cannot use another picker's retained backup or import account/capability records.

Private operator administration retains process shutdown/restart, deployments,
pack/profile installation, service diagnostics, cross-account administration,
raw credential-bearing snapshots, and whole-service backup/restore. Public
ownership must not imply today's `admin`. That role also requires private ingress
(`app/server.mjs:1192`, `app/server.mjs:1241`) and gates snapshots, account actions,
invitations and shutdown (`app/server.mjs:1705`, `app/server.mjs:1820`,
`app/server.mjs:1834`, `app/server.mjs:1871`). Define owner routes separately from
those operator routes.

## Deletion, recovery and limits

Deletion first writes a durable lifecycle tombstone and blocks new admission.
Revoke sessions, plugin keys, invitations and overlay capabilities; end streams;
cancel pending calculations; drain already accepted writes and flushes; evict
private caches; then remove the owned directory and its binding. Remove provider
subjects and account-index references when deleting an account. Removing a
membership in the legacy duo must not erase the shared game. Current account
deletion revokes sessions and deletes an account row only
(`app/server.mjs:1828`, `app/server.mjs:1830`); it does not implement this sequence.

Retained backups expire under an operator-configured finite retention period
that the deletion flow must disclose before public launch. Record the deletion
time and picker ID in a minimal tombstone ledger outside restorable picker data.
Tombstones outlive every backup that could contain the deleted picker; never
restore old provider subjects, capabilities or deleted ownership merely because
an older backup contains them. Reconcile tombstones before opening restored
stores, and make interrupted purge steps idempotent. Do not claim immediate
erasure from retained backups while those backups still exist.

Whole-service recovery includes a consistent registry/account checkpoint, picker
manifest, each binding and all required pack versions. Compatibility checks and
migrations run sequentially under the memory budget, record resumable progress,
and quarantine an incompatible picker without blocking unrelated games. Current
operations select one directory at `scripts/linux/runtime.mjs:18`,
`scripts/linux/serve.mjs:8`, `scripts/linux/operator.mjs:45`,
`scripts/linux/operator.mjs:136`, `scripts/linux/online.mjs:9`, and
`scripts/linux/recovery.mjs:117`. Current readiness describes one store/worker
(`app/server.mjs:1372`) and startup can warm its members
(`app/server.mjs:2357`). Service health must not hydrate every dormant picker.

Global limits cover resident contexts, calculator processes/threads and dataset
versions, queued snapshot/result bytes, cold-start concurrency, CPU/RSS, disk and
backup bytes, registration/provisioning, request bodies, SSE and total plugin
traffic. Per-account and per-picker limits cover expensive requests, fair queue
shares, outstanding jobs, save/history/import growth, invitations, capabilities
and streams. Apply both layers so extra keys, sessions or memberships cannot
bypass the global budget. Existing per-identity/global expensive request limits
are 600/1,200 per minute (`app/security/request.mjs:102`), streams are 16/64
(`app/security/request.mjs:143`), plugin keys allow three active keys per player
(`app/plugin-keys.mjs:67`) and four reports/second per key
(`app/game-plugin.mjs:63`). Current record caps in accounts, invitations/sessions
and keys (`app/storage/accounts.mjs:91`, `app/storage/invites.mjs:37`,
`app/plugin-keys.mjs:12`) are not capacity measurements. Do not recreate the
global limits once per context.

## Phase 1 acceptance tests

These tests belong to Phase 1, when real picker contexts exist. Phase 0 does not
pretend that two stores already provide authenticated tenant routing.

- Sign in two unrelated accounts A and B. Both pickers deliberately use the same
  member IDs and revision numbers. Each starts empty, mutates, rolls/checks a
  task, reloads, and sees only its own durable game.
- Try cross-picker command, task/query, conflict response, history, export,
  uploaded/retained restore, invitation, overlay, SSE and plugin access. Refuse
  every attempt before private data is returned or a destination handler runs.
  Include conflicting URL/body selectors and A's capability with B's member ID.
- Reuse request IDs, receipt IDs, preview IDs, backup IDs and revision numbers in
  both pickers. No deduplication, replay, undo, cache or restore crosses scope.
- Subscribe in both pickers, then revoke membership/delete A. A's streams close;
  no subsequent revision, worker, plugin or overlay event leaks to either side.
- Interleave jobs with colliding member/revision values; deliver stale results,
  cancel, crash/restart workers, and evict a context during a queued write.
  B's jobs and confirmed writes survive; stale A results cannot commit.
- Race first-login callbacks and crash provisioning between durable steps.
  Recover exactly one owned picker with no inherited progress. Preserve the
  existing shared duo and its separate private-default ownership slots.
- Switch account/picker or log out while browser commands are queued. Clear old
  views, streams, preferences and recovery state; never replay commands into the
  new picker. Current preferences and command ownership are site-wide
  (`app/web/screen-startup.mjs:82`, `app/web/http-session-lock.mjs:56`).
- Restore a service backup containing a deleted picker. Apply the tombstone,
  keep that picker absent and its credentials revoked, and recover B unchanged.
- Owners can exercise only the documented owner capabilities. Process control,
  raw snapshots, cross-account administration and global configuration remain
  private operator operations; global limits remain shared across both pickers.
