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

## Registry

MP1 provides `openRegistry` in `app/storage/registry.mjs`. It is an operator-side
storage API; HTTP routing, sign-in, gameplay stores and account sessions do not
use it yet. Its required `registryDir`, `pickerRoot` and `tombstoneDir` are
disjoint operator-controlled roots, canonicalized before locking. Keep the ledger
outside both picker backups and restorable registry checkpoints, and retain it
when restoring either. Never restore or prune it along with an older checkpoint.
An existing registry without its ledger fails closed.

The registry and ledger each hold a lifetime writer lock. Contenders fail with
`REGISTRY_LOCKED`; callers can retry after the current writer closes. A kernel
mutex serializes owner-file acquisition and recovery, and releases on process
death. Only a provably dead local PID permits automatic owner-file recovery;
foreign, live, reused or unverifiable PIDs require operator inspection. File
writes use exclusive mode-0600 temporaries, file fsync, atomic rename and parent
directory fsync. Newly created directory ancestors are synced too. Windows uses
the existing bounded rename retry convention; directory fsync is best effort
where Windows does not support it. Storage failures or an injected crash leave
the instance requiring restart; `close()` drains accepted mutations and releases
both locks. Validation and capacity rejections leave the writer usable.

`ensureIdentity`, `findIdentity`, `linkIdentity` and `unlinkIdentity` maintain an
in-memory provider-subject index rebuilt from the durable account rows. Supported
providers match current sign-in (`discord`, `google`), with one identity per
provider per account. Linking is explicit and conflicts never merge accounts.
`getAccount` returns explicit `{ pickerId, role, memberId }` memberships. Owner
and player member IDs must belong to that picker's recorded member list; viewers
use `null`. `attachMembership` and `removeMembership` update those grants, with
removal also dropping matching capability hashes. An owned default's owner
cannot be detached independently of deletion. All returned records are copies.

`firstLogin(provider, subject)` creates or resumes the account's sole owned
default; `ensureDefaultPicker(accountId)` performs the same provisioning for an
existing account. A default records one neutral `owner` member. Provisioning:

1. Persist the account, then reserve a random 128-bit picker ID in the external
   issued-ID ledger. A reservation abandoned before the registry write stays
   burned; allocation also refuses surviving directories and sibling bindings.
2. In one registry write, record the picker, its owner membership and the account's
   default pointer, with `provisioning: reserved` and `lifecycle: active`.
3. Create `<pickerRoot>/<pickerId>`, refusing symlinks and non-directories. Sync
   it and its parent, then persist `provisioning: ready`.

Restart reconciles tombstones first, then resumes reserved directories under the
same ID. Parallel calls serialize through one mutation queue; separate processes
must acquire the single writer before calling. The optional injected `crashPoint`
receives `account-recorded`, `id-reserved`, `registry-reserved`,
`directory-created`, `directory-synced` and `registry-ready`; synthetic tests exit
a child process at every boundary and reopen its files. `ready` means registry
and directory readiness only. A later store integration must initialize
`createGroupState` with this neutral owner and empty progress, and validate the
recorded members against loaded game state before admitting gameplay. MP1 never
loads packs or copies another picker's progress.

`pickerDirectory(pickerId)` accepts only a registered, well-formed ID and derives
the path from the operator root. It is also available during deletion for purge;
path resolution alone does not authorize admission. Admission must check active
lifecycle, ready provisioning and the selected membership.

For the sole existing shared exception, configure `legacyDir` to its existing
directory, separate from all three roots. `readLegacyAccounts` in
`app/storage/registry-legacy.mjs` reads today's schema-1 `accounts.json` without
writing it, together with the same directory's `invites.json`, also read only. The
caller supplies the two member IDs verified against the existing save. A
membership is kept only if `accountPrincipal` would still honour it: its
invitation exists, is not revoked or administrative, is claimed by that account
and matches its player and role. Revocation leaves memberships in
`accounts.json`, so this check is what keeps revoked access out. The plan reports
only a `droppedMemberships` count. It retains account IDs, provider links and
the surviving grants; duplicate invitation grants collapse to the same explicit grant.
`registerLegacy(plan)` registers one `legacy-shared` picker and imports the plan
atomically. It is idempotent for unchanged grants, rejects identity conflicts and
deleted account IDs, and neither opens nor modifies the existing save. Its path
comes only from `legacyDir`, and its memberships never consume a default slot.
Removing a legacy membership or deleting a participant leaves the shared data
and other participants intact. This is an operator import, not a sign-up API.

`setCapability({ kind, hash, pickerId, accountId, memberId })`,
`resolveCapability(kind, hash)` and `revokeCapability(kind, hash)` maintain a
durable, lightweight hash index for `plugin-key` and `overlay-capability`.
Hashes must be lowercase SHA-256 hex; raw secrets are not stored. A hash cannot
be rebound within its kind while indexed. Each entry requires a matching membership, and
plugin keys cannot bind viewers. Resolution reads the index without opening a
store; it blocks tombstoned scopes even between the ledger write and registry
cleanup. Later handlers must still validate the credential's local record,
expiry and revocation, and recheck scope before asynchronous delivery or writes.

`beginPickerDeletion` durably records `{ pickerId, lifecycle: deleting,
deletingAt, deletedAt: null }` outside restorable data before dropping memberships
and indexed capabilities. The default slot remains occupied while deleting.
The caller must revoke sidecars/sessions, drain the runtime, then remove the
owned directory and sibling binding. `completePickerDeletion` refuses completion
while either exists; it durably advances to `deleted` before clearing the slot.
Both steps are idempotent, and IDs are never reallocated. The registry does not
purge data or claim erasure of retained backups. Legacy shared data cannot be
completed through the owned-directory purge API.

`deleteAccount` first records an account-ID tombstone and deleting tombstones for
its owned pickers, then removes its providers, memberships and indexed hashes.
`reconcileTombstones` applies the same rules to a restored registry checkpoint,
returning blocked picker IDs (including ones absent from that checkpoint) and
deleted account IDs. Startup performs reconciliation before exposing indexes or
resuming provisioning. Restored directories for blocked IDs must be quarantined
or purged before any store opens. The external ledger is authoritative; never
discard it to make a restored checkpoint load.

`caps` can override positive-integer limits: `accounts` (1,000), live/deleting
`pickers` (1,000), `membershipsPerAccount` (1,000), `membersPerPicker` (100),
`capabilities` (10,000), `capabilitiesPerPicker` (100), `issuedPickerIds`
(1,000,000) and `retiredAccounts` (1,000,000). Allocation and record writes reject
capacity overflow; lowering a cap below existing usage refuses startup. Ledger
capacity must be raised before further allocations/deletions when exhausted;
never prune issued IDs or tombstones to free capacity. These are storage bounds,
not measured public-service capacity or substitutes for later runtime quotas.

### MP1 validation and measurements

Measured on Linux, Node 24.19.0, against START
`9995140f3d0211500f2fe4f2555132b900f7eb8a`. All 585 existing app files have
identical hashes; three registry modules are added and remain unimported by the
server. Synthetic registry tests: 24 passed, zero failed. Final quick suite:
2,469 passed, zero failed, 68 skipped, 68.2 seconds. Full suite: 5,605 passed,
zero failed, 140 skipped, 269.1 seconds. No test was weakened or newly skipped.

The existing `scripts/perf/picker-footprint.mjs` ran three times per checkout,
sequentially, with an empty synthetic source, bundled open-f2p, process workers,
port 0 and `--idle-ms 250`. Each run measures the default two-member case and a
fresh solo. Values are median [minimum–maximum] across the three runs; each
two-member timing is first reduced to that run's member median. Peak memory is
the harness's sampled process-tree RSS. Store sizes were identical before/after:
247,335 bytes for the default case and 246,609 bytes for solo.

| Synthetic case / measurement | START | MP1 |
| --- | --- | --- |
| Two members, cold tasks (ms) | 215.8 [213.7–216.7] | 214.4 [214.1–235.6] |
| Two members, repeat tasks (ms) | 7.54 [7.45–10.08] | 8.05 [6.76–10.05] |
| Two members, roll pool (ms) | 8.17 [7.85–8.65] | 9.94 [8.03–11.00] |
| Two members, peak RSS (MiB) | 108.13 [108.00–108.17] | 108.20 [107.98–108.73] |
| Solo, cold tasks (ms) | 215.9 [192.2–218.7] | 204.6 [194.9–209.3] |
| Solo, repeat tasks (ms) | 13.59 [7.19–14.69] | 7.74 [6.76–9.78] |
| Solo, roll pool (ms) | 6.10 [6.07–8.02] | 8.63 [8.52–9.61] |
| Solo, peak RSS (MiB) | 106.00 [105.97–108.60] | 107.84 [107.39–108.45] |

A separate three-process synthetic measurement opens an empty registry,
sequentially calls `firstLogin` for 100 distinct accounts, resumes all 100
defaults, resolves one capability 100,000 times, then closes and reopens the
registry. There is no START registry API to benchmark. Median [minimum–maximum]:
initial open 7.27 [7.15–10.44] ms; provisioning 285.9 [251.4–294.3] ms;
default resumption 0.512 [0.440–0.534] ms; capability lookups 138.6
[132.3–140.5] ms; reopen 5.78 [4.43–5.82] ms; lifetime process peak RSS
57.74 [57.37–58.28] MiB. Each run produced 53,566 registry bytes and
3,767 ledger bytes. These small fixtures provide a regression baseline; capacity
measurement must include the later integrated runtime and representative packs.

The real-save calculator gate remains unrun: START contains its contract but no
`tools/calc-check` implementation. Full Phase 1 acceptance and the lane-wide
footprint document update remain integration gates before a merge to main.

## MP2 picker context

Baseline is START `4d2b779de1b712c81830d3c8021e0292e073dec0` on
`lane/multiplayer`. `createPickerContext({ pickerId, dataDir, runtime, ... })` in
`app/picker-context.mjs` is the private resource boundary. The server creates
exactly one, with ID `legacy`, and every application request goes through
`contextFor(request)` before dispatch. This introduces no registry, sign-in
routing, picker selection or new storage format. Existing legacy filenames,
directories and the sibling backup-status location are unchanged. Other contexts
use their own backup-status directory, overridable only by a trusted caller.
Stateless HTTP helpers and permission tables are in `picker-context-http.mjs`;
the established server exports are preserved.

### Resource ownership audit

| Contract resource | MP2 owner and boundary |
| --- | --- |
| Store, writer lock, current state, write queue | The context's `store` instance from `openStore`; one writer per physical directory remains enforced. |
| Revisions, history, Undo, replacement, mutation serialization | Revision/history/Undo/restore state is inside that store; `mutationQueue` and claim cleanup belong to the context. |
| Action sessions, receipts, acknowledgements and retries | The store owns its durable action ledger and acknowledgement sidecar; neither revision nor request ID selects another context. |
| Private state/static fields, custom tasks, aliases, evidence, rules, notes, progress | Each store owns its current snapshot, serialization/static-field references and on-disk static/history/backup namespaces. No private fields are interned across contexts. |
| Response, identity, task, calculation and preview caches | `responseCache`, `identityLookup`, `savedTaskResults`, `calculationSnapshot`, both progress-preview maps, roll/Sandbox/ranking caches and private scheduling bookkeeping are context-local. Immutable asset/reference caches remain shared runtime resources. |
| SSE subscribers and revocation | `clients`, `clientCredentials`, heartbeats, broadcasts and invitation reauthentication belong to the context; overlay streams belong to its overlay controller. |
| Plugin keys, reports, fragments, sequencing, evidence | Context-owned `gamePlugin` owns its key, progress, achievement and item controllers, assemblies, sequence/rate/status maps and retained task bytes. RuneMetrics member/name caching is the explicit exception below. |
| Invitations, overlays, feedback, usage | The context constructs its account/invitation/sign-in/overlay/feedback controllers and `usageStorage`. `openUsageRoute` receives that storage and the shared usage admission function from the context; standalone callers keep their existing defaults. |
| Backups, binding, status, restore scope | Context creation verifies the dataset binding; all retained/uploaded restore handlers use its store/dataset. Backup status receives its explicit directory. Store backup/static/history directories and snapshot spool paths derive only from this trusted data directory. The directory-keyed snapshot coordinator is the explicit exception below. |

Dataset/world/topology, rule definitions, verified pack/reference/static assets,
calculator scheduler/pool, and service-wide rate/stream/usage admission budgets
are caller-owned shared runtime resources. Usage's existing limits, error bodies,
headers and `usage.json` format are unchanged; the global usage budget is created
once per server runtime and is not renewed by opening or closing a context.

### Close and drain

`close()` synchronously stops HTTP admission and calls `store.close`, which
synchronously rejects new direct store writes with its existing closed-store
error. Already accepted store writes finish durably. Queued HTTP operations that
have not entered the store receive an explicit stopping refusal. Private timers
and streams stop first; the store's `beforeUnlock` callback then drains accepted
handlers/readers, mutation and claim cleanup queues, readiness work, plugin and
sidecar flushes, local calculation/compression jobs and borrowed warm queues.
Private caches/references are cleared before the writer lock is released.
`beforeUnlock` continues to accept a promise and additionally accepts a callback
that runs after the store queues drain. Closing a context never closes or cancels
the shared calculator.

### Remaining work and reasons

- **Calculator namespaces and eviction:** completed by MP3 below. Calculator
  jobs, snapshots, reuse and delivery now carry picker identity, and context close
  abandons only its own jobs. MP4 below adds authenticated routing and bounded
  context eviction; fair sharing remains later work.
- **RuneMetrics member/name cache:** `app/integrations/runemetrics.mjs` remains
  unchanged because its replacement is landing on main. The context owns its
  progress client and preview map, but that integration's cache/lifecycle must be
  reconciled with the replacement before enabling multiple routed pickers.
- **Snapshot coordination registry:** `app/storage/snapshot.mjs` still keeps the
  process-wide directory-keyed barrier registry so direct store/sidecar writes and
  operator snapshot callers rendezvous on the same barrier. Entries have separate
  active sets/gates per resolved data directory and retain no game snapshot when
  idle. Passing barrier ownership through operator APIs and evicting idle entries
  is a later lifecycle refinement; removing the shared rendezvous here would break
  snapshot consistency for existing direct callers.
- **Compatibility references and engine caches:** the existing server handle still
  exposes its explicit store reference for callers that inspect a closed store.
  Core world/transport caches retain their existing world/input scope; core is
  outside this task's allowed files. MP4 retains only the non-evictable legacy
  compatibility handle; evicted contexts drop their store references. No new
  private interning is introduced.
- **Registry/authentication integration and Phase 1 acceptance:** MP4 below
  completes opt-in provisioning, session/plugin routing and bounded eviction.
  Browser switching/logout reconciliation, deletion, tombstone recovery, operator
  tooling and the complete Phase 1 gate remain later tasks. Production sign-up
  remains off pending owner approval.

### Validation and measurements

Measured on Linux, Node 24.19.0. START quick: 2,470 passed, zero failed,
68 skipped. START full: 5,613 passed, zero failed, 140 skipped. MP2 adds 15
synthetic context tests, classified as quick/open-f2p; no existing tests or
expectations are changed. Final quick: **2,485 passed, zero failed, 68 skipped**
(112.73 seconds). Focused context/live-swap/plugin/usage checks: **34 passed,
zero failed**. The previously failing shutdown file, run alone unchanged:
**seven passed, zero failed**.

Final full: **5,628 passed, zero failed, 140 skipped** (444.18 seconds).
Both suite pass totals equal START plus the 15 new tests; skip counts are
unchanged. The graceful-shutdown regression also passes inside the full suite.

The private gate uses fresh temporary copies and the same 10 successful reads,
sequentially at each revision: full/play state, history, browser plugin status,
full/play tasks for each member, and native plugin status for each member.
SHA-256 comparison: **10 routes, zero differences**. SHA-256 of the JSON array
of response digests in request order:
`7915e8d9ce92d4d7ee81265e44d5694e97e1a6b88f7d6595c368b2cf095453c0`.
The full-state body is 16,213,564 bytes with SHA-256
`c2416e6b4f65e4f8468aac0177392a64d2de402680a44225dc14050ad3970a4f`.
The gate uses identical injected save timestamps and a temporary fixed
`performance.now()` preload in HTTP/calculator processes to make elapsed-time
metadata deterministic. No fields are removed, rounded or normalized. These
clock controls exist only in the temporary gate process.

The RSS comparison uses fresh copies, process workers, port 0, disabled unsolicited
prediction warming and the same injected save clock, with **normal elapsed-time
clocks**. Three independent processes per revision run alternately START/MP2,
one measurement server at a time. Samples are for the HTTP process, excluding
calculator children. Each process records startup RSS, runs two identical
full-GC/event-loop checkpoints, reads the full state once, records RSS, and repeats
those GC checkpoints. This records both collection timing and retained-memory
sizes. Lifetime peaks include pre-checkpoint allocations. Values are median
[minimum–maximum]; MiB means 1,048,576 bytes.

| Measurement | START | MP2 |
| --- | --- | --- |
| Startup RSS before GC, MiB | 1150.24 [1127.64–1162.65] | 1099.31 [1090.23–1106.49] |
| Startup RSS after GC, MiB | 924.22 [901.30–935.98] | 872.82 [863.90–880.75] |
| First full-state RSS before GC, MiB | 1010.22 [1006.30–1034.98] | 984.69 [977.40–993.75] |
| First full-state RSS after GC, MiB | 948.04 [944.05–972.73] | 922.58 [915.15–931.45] |
| Lifetime peak RSS, MiB | 1272.71 [1265.30–1286.41] | 1236.67 [1226.88–1242.47] |
| Startup duration, ms | 16390.00 [16224.00–17088.00] | 17328.00 [16483.00–18543.00] |
| First full-state duration, ms | 173.00 [160.00–192.00] | 161.00 [158.00–186.00] |

The earlier approximately 28 MiB startup increase does **not** reproduce in this
alternating three-run comparison. Post-GC startup live heap medians are 551.95
MiB at START and 550.70 MiB at MP2; physical V8 heap sizes are 703.37 and 687.54
MiB. Retained array-buffer sizes are identical: 30.66 MiB at startup and 46.17 MiB
after the full read. Median post-GC anonymous RSS is 894.42 versus 842.74 MiB.
There is no extra retained context buffer or live-heap allocation accounting for
a 28 MiB addition. Committed heap capacity, allocator residency and collection
placement vary between processes; neither these three samples nor the earlier
samples establish a capacity limit or a performance improvement. The task gate
shows no meaningful added memory from context ownership.


## MP3 job keys

START is `400ed50a0ec47e1b9a5162185d54133afc3e5f27`. The shared scheduler now
provides `forPicker(pickerId)` handles. `pickerJobId` is the single mapping from
the server's `legacy` context to protocol ID `legacy-shared`; other accepted IDs
are `p_` followed by 32 lowercase hex digits. Every calculation and control
message carries that protocol identity. Worker callers omitting it continue to
use `legacy-shared`.

Revisions, task/prediction source revisions, unlock-reuse caches and prediction
subscriptions belong to a picker. Each shared lane keys pending/coalesced work,
full/play results and sent snapshots by picker. Worker state references use
`(pickerId, input)`; calculation inputs are namespaced at message admission for
nonlegacy pickers. Prewarm replacement, abort handlers, ranking cancellation,
saved-prediction followers, display rebinding, retirement and delivery guards
all check the owning picker. Existing lane counts, queue limits, deadlines and
snapshot/result budgets remain unchanged. Reuse caches have private entries and
share the existing total entry/byte budget; admission can evict another picker's
cached reuse bucket, but never reuse its results.

`PickerContext.close()` stops admission and synchronously calls its handle's
`cancelPicker()`. This cancels its queued and active waiters, signals its active
calculation, discards late results and removes its result caches and warm
subscriptions. Sent-snapshot hints are invalidated while retaining their LRU
positions until eviction, so references for other pickers remain coherent.
Cooperative active work keeps its physical slot until completion
or the existing watchdog; another picker's jobs are neither cancelled nor
retired. Store durability and accepted local work still drain before unlocking.
The old borrowed-queue polling wait is removed. A new handle can reopen a picker;
an abandoned handle stays fenced. There is still one production context and the
same shared queues; fair sharing and authenticated routing remain deferred.

The worker changes are self-contained message admission, state-reference keys
and per-request supersession checks, covered separately by
`tests/worker-picker-keys.test.mjs`. `tests/picker-jobs.test.mjs` covers two
contexts with separate temporary stores, colliding revisions/member IDs, reuse,
queue cancellation, late delivery, shared-LRU eviction and reopened handles.
Retiring obsolete or warm work also wakes surviving queued work on the replacement
worker without changing its position or deadline. The existing test files changed are
`tests/scheduler.test.mjs` and `tests/prediction-cache.test.mjs`: each exact
cancel-message expectation adds `pickerId: 'legacy-shared'`. No existing assertion is removed or loosened.


### MP3 validation and private gate

The private gate opens fresh temporary copies at START and MP3 with process
workers, identical injected save timestamps and a temporary fixed
`performance.now()` preload in both HTTP and calculator processes. It compares
raw response bytes without dropping or normalizing any field. Reads are
`/api/state`, `/api/state?view=play-v1`, `/api/history`, `/api/game-plugin`, full
and play task lists for each member, and authenticated native plugin status for
each member. Scratch plugin credentials are created only in those copies after
the browser plugin-status read.

**10 routes, zero differences.** SHA-256 of the JSON array of response digests in
request order is
`c47afae7f9ba70ef91bac677d788f01aa7982555547ded3fa99e0d9399a96189`.
Full-state response: 16,213,564 bytes, SHA-256
`f72cd9141b447e828e548a697ae8aaf602f1fe7ab27b0725ca58f4ff21664605`.
The rewritten save bodies also match: 766,470 bytes, SHA-256
`44cf36a23999b0e0ac4895b2b3a37011496ae177f23bbf99f711fbe95a09dc76`.
Both copies report 2 members and 23,939 saved tasks; the first full list contains
20,497 tasks. The private source checkout remains unchanged.


Final validation on Node 24.19.0:

| Suite | START passed / failed / skipped | MP3 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,485 / 0 / 68 | 2,503 / 0 / 68 |
| Full | 5,628 / 0 / 140 | 5,646 / 0 / 140 |

MP3 adds 18 tests across the two new files, classified quick/open-f2p. The final
quick run took 103.07 seconds and full took 402.28 seconds; START took 96.48 and
420.96 seconds. Focused scheduler/context/worker/residency/watchdog validation:
110 passed, zero failed. The separately corrected prediction-cache file:
23 passed, zero failed.

The first complete MP3 full run had two failures: the second exact cancel-message
expectation (subsequently updated only by adding the authorized picker field),
and an `ENOTEMPTY` teardown failure in the untouched
`tests/cache-game-data-objects.test.mjs`. That file passed alone, 10 tests with
zero failures, and passed in the final full rerun. No test was weakened or newly
skipped. Both existing test files edited are listed above.


### MP3 timing and memory

Three fresh processes per revision run alternately START/MP3, after all test
processes have exited, with one measurement server at a time. Every trial uses a
fresh temporary save copy, process workers, port 0, disabled unsolicited prediction
warming, identical injected save timestamps and normal elapsed-time clocks. Cold
start includes server module import, creation, listen and receipt of the first
full task-list body. A save toggles one saved task backlog preference through the
HTTP command route; the next request reads that member's full task list. Copying
the input and closing the server are outside these durations. The same 20,497
full-list tasks are returned before and after each save in all six runs.

Values are median [minimum–maximum]. RSS is sampled every 20 ms and at phase
boundaries; process-tree RSS includes the HTTP process and calculator child.
These are sampled peaks rather than a service-capacity estimate.

| Measurement | START | MP3 |
| --- | --- | --- |
| Cold start to full tasks, ms | 17,650.2 [17,250.1–17,822.8] | 17,830.5 [17,811.1–18,132.9] |
| Save response, ms | 3,090.4 [2,947.7–3,165.8] | 3,064.9 [2,839.8–3,112.2] |
| Next full task list, ms | 2,945.2 [2,853.7–3,083.0] | 2,736.6 [2,665.4–2,942.2] |
| Save through next full list, ms | 6,042.0 [5,801.6–6,249.1] | 5,730.5 [5,576.6–6,054.5] |
| Peak process-tree RSS, MiB | 2,470.81 [2,460.52–2,520.04] | 2,470.36 [2,467.14–2,483.95] |
| Peak HTTP-process RSS, MiB | 1,258.51 [1,187.51–1,288.81] | 1,251.41 [1,181.51–1,259.08] |

The cold-start median is 1.02% higher with overlapping ranges; the save-to-list
median is 5.16% lower and peak process-tree memory is effectively unchanged.
These three-run samples show no material single-picker regression or added memory
footprint, and do not establish a throughput improvement. Cooperative cancellation
still relies on the existing watchdog for synchronous work; fair sharing and
registry/authentication integration remain later tasks.

## MP4 routing

START is `475d6166a118edc08ed1c8cdb95921228feef1ac`. The server option is
`createServer({ multiPicker: { registryDir, pickerRoot, tombstoneDir,
maxOpenContexts: 8, idleCloseMs: 600000 } })`; both limits have those defaults.
The three roots remain disjoint operator paths. There is no CLI/environment
switch or production configuration change. Without the option, dispatch still
calls the original single legacy context directly and opens no registry.

With the option, startup opens the registry and idempotently registers the
existing shared exception using its validated member IDs and live account and invitation
grants. It refuses an existing account file whose invitation file is missing.
The registry's legacy picker retains no owner and consumes no private default
slot. An explicit duo invitation, or a provider subject with a live legacy invitation
membership, follows the existing sign-in/session path. Other subjects without
an invitation call `firstLogin`; only the
registry allocates account IDs, default ownership and directories. Every legacy identity creation, invite claim and provider link checks subject
ownership in the global registry before writing legacy records. Successful
legacy account mutations refresh `registerLegacy` in the same serialized mutation
before issuing a session, including accounts created after startup. Sign-in
receives this operation through `pickerRouting`; file paths remain in the server.
An identity owned by a different registry account is refused with a clear sign-in
page and no legacy account write. Startup still fails closed on real conflicts.

One session issuer remains in the legacy context's invitation sidecar. New
hash-only sessions add `accountId`, `pickerId` and provider, and every resolution
checks the registry's active, ready picker and current membership/provider link.
They grant ordinary owner gameplay authority, never operator `admin`. The
session endpoint returns the two bindings for these sessions only, along with
the same sign-in mode, configured providers and account/provider fields as legacy
account sessions. Private contexts use the legacy issuer's session view only;
they do not create another OAuth flow. Gameplay
History uses the existing member-scoped `invite` actor schema with the account
UUID as its pseudonymous actor ID; it requires no core schema change. Sign-out
revokes the original issuer's session, including after context eviction/restart.
START cannot read the extended session records after this option has issued
sessions; reverting the application version requires an operator session reset.
The updated application can turn routing off and refuses those sessions.

Private contexts start with one neutral member and empty progress from
`createGroupState`, independently of legacy defaults, prepared state and imports.
Every owned directory gets a sibling dataset binding before its first gameplay
read; an unbound nonempty directory is refused. Dataset identity and member IDs
are checked at every load/write, including restore.
Only registry-derived IDs reach `pickerDirectory`. Legacy remains resident.
`maxOpenContexts` includes legacy; a value of one cleanly refuses private context
admission with retryable 503. Acquisitions/evictions serialize, include contexts
still draining in the bound, and update request LRU order. Capacity eviction
takes the least recently used idle context only; while every resident context
has an active request or upload, a newcomer gets a retryable 503 rather than
waiting inside the shared acquisition queue for a busy picker to drain. Capacity
eviction can end an SSE stream; an open stream prevents idle eviction. Idle timers run after
the last active request/stream. A request during close waits for draining and
reopens under a new handle. `PickerContext.close()` fences admission, drains
accepted writes, explicitly refuses unaccepted queued HTTP work, cancels only
its MP3 jobs, ends its streams and drops its private references. Server shutdown
closes private contexts, then the legacy session issuer, then the registry.

Supported optional selectors are query/body `pickerId` or `picker`, headers
`X-Picker-Id` or `X-Picker`, and `/pickers/:id/...` or `/api/pickers/:id/...`.
They must all equal the credential's bound picker, including nested body fields.
URL, query and header conflicts are refused before any context opens. The router
never buffers ordinary JSON. Each JSON body reader (`bodyJSON` and the overlay
reader) runs the router's registered check on the parsed object, after the
selected context's own route, role, origin and size admission and before the
handler uses the body. A body conflict can therefore open only the caller's own
picker; the named picker never opens. Legacy uses
`legacy` as its request scope. Matching routing envelope fields are removed
before ordinary route schema checks. Unauthenticated requests reach legacy without body
parsing. Legacy backup uploads also stay unread until the legacy handler admits
them. For owned backups, URL and header selectors pass first; the selected
context checks the owner role, origin and its shared import guard before the
streaming parser runs. Legacy checks parsed selectors within its own admitted
backup path. Parsed body selectors pass before gameplay handling,
and the guard stays held through parsing and execution, releasing on failure.
Authenticated GET/HEAD bodies are refused. Authentication is checked again inside
the selected context.

Plugin key issuance writes the local key and its hash-to-account/picker/member
registry entry before returning a secret. Failed indexing revokes the local key;
a crash leaving an unindexed key cannot authenticate it. Indexed keys select
exactly one private context and recheck registry scope both before local private
reads and inside queued plugin mutations. Local expiry/revocation checks still
apply. Existing plugin keys use a lightweight check against the already-open
legacy key store and can reach only legacy; no dormant store scan occurs.
Cookies and keys with conflicting picker scopes are refused. Key revocation first
authorizes and durably revokes the local key, then reads its hash from that
selected context's key file and calls the existing registry `revokeCapability`
API before returning success. Only that scoped account/member capability is
removed. Repeated revocation is safe; an interrupted/failed index removal can be
retried, while the local key already refuses access. No registry schema/API or
plugin-key store API change is needed.

Owners retain ordinary commands and gameplay export and can preview/restore a
compatible gameplay backup in their selected context. Restores cannot change
its recorded member IDs or import credentials. Raw snapshots, shutdown/restart,
account administration and invitation/overlay management remain private operator
routes. Retained backup IDs, action sessions, receipts, acknowledgements,
revisions, caches and restores use only the selected store's namespaces.

### Changed files and security review

| File | Change and trusted resolution boundary |
| --- | --- |
| `app/server.mjs` | Opt-in registry lifetime, legacy registration and a lazy context factory. The factory receives IDs only from authenticated router acquisition, creates neutral state, verifies membership, and derives storage paths through the registry. Global runtime/admission/calculators remain shared. |
| `app/picker-router.mjs` | Single enabled-mode HTTP boundary, `contextFor`, session/key scope, selector/body admission, capability indexing/rechecks, serialized LRU/idle close and reopen. No request ID supplies a store path. OAuth endpoints use only the single issuer's authentication and invitation handlers. A signed-in private account opening a duo invite receives the same clear joining refusal page. |
| `app/picker-context.mjs` | Context authentication adapter for every API, usage, overlay administrator check, delivery check, queued write and SSE revocation check; native plugin scope hook; explicit owner gameplay restore; store member identity guard supplied by the server. SSE client sets and broadcasts remain local. |
| `app/picker-context-http.mjs` | Weak request-local parsed-body handoff, preserving ordinary limits and avoiding re-reading admitted bodies. No private response cache is shared. |
| `app/signin.mjs` | Recoverable first-login provisioning, bound session issuance, registry-aware linking, and the existing legacy membership exception. Provider subjects come only from the verified OAuth exchange. |
| `app/storage/invites.mjs` | Extended session validation/issuance and registry-backed principal checks. Legacy master tokens and invite sessions retain their original legacy scope. This is the only changed account, invite and session storage module; `accounts.mjs` and `storage/registry.mjs` are unchanged. |
| `app/game-plugin.mjs` | Key indexing before secret delivery, capability removal on revoke, and registry authorization at native key admission/queued execution, in addition to the local key check. No plugin calculation/gameplay behavior changes. |
| `tests/picker-routing.test.mjs`, `tests/picker-routing-crash.test.mjs` | Synthetic HTTP/OAuth acceptance and real callback process-death/recovery coverage with temporary roots and neutral players. No private inputs. |
| `scripts/test-selection.mjs` | Classifies both new files quick/open-f2p. No existing test expectations changed. |

The final review covered every context/store factory, authentication adapter,
plugin key admission/issuance/revalidation, legacy overlay capability handler,
backup/restore namespace, queued browser/plugin mutation and SSE subscription,
broadcast and heartbeat. Context/store/key/stream selection derives from the
session or key, and request selectors can only confirm that scope. Legacy
capabilities never choose another context. Existing local handlers still verify
member/object IDs within that context. All shared limits are the original
server-owned limiters; opening or evicting a picker does not reset them.

### Acceptance and remaining scope

The new HTTP tests cover independent empty games with colliding members and
revisions, mutations/completion/reload, task reads, cross-picker command/history/
export/SSE/plugin refusal before store creation, URL/body/header conflicts,
plugin restart isolation, concurrent first-login callbacks, six provisioning
interruption points, legacy account/master/invite compatibility, operator
refusal, sign-out, owner restore, linked-identity conflicts, idle/capacity close,
stream isolation and an accepted write deliberately held across shutdown
eviction. Capacity eviction skips the busy picker, the queued successor receives
503 at shutdown, and both confirmed games survive restart. Synthetic on-disk namespaces deliberately collide action
request/receipt scopes and retained backup IDs without copying either game into
the other. Eighteen HTTP tests include thrown provisioning interruptions and graceful
restart. Six more tests terminate the actual OAuth callback process at each
MP1 durable boundary, then recover through sign-in and HTTP in a fresh process.
Both recovery paths produce one owned picker, no inherited progress and unchanged
shared ownership; MP1's storage-level process-exit coverage remains unchanged.

Out of scope: browser account/picker switching and clearing client state on
logout; owner capability UI; fair sharing
between pickers; RuneMetrics client reconciliation with G15; and opening sign-up
in production. Public launch still needs the owner's approval and the remaining
Phase 1 browser/operator/limit work. MP5 below completes deletion and runtime tombstone handling. Default residency limits are
configuration bounds, not a measured public service capacity.

### Initial MP4 validation and private gate (before follow-up 1)

Node 24.19.0; both initial required suites ran in order after the initial app changes.
No existing tests or expectations were edited, loosened or skipped. The 24 new
tests are all quick/open-f2p. The untouched START checkout is the comparison,
not a cached main ref.

| Suite | START passed / failed / skipped | MP4 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,511 / 0 / 68 | 2,535 / 0 / 68 |
| Full | 5,658 / 0 / 140 | 5,682 / 0 / 140 |

START quick/full durations were 78.17/342.55 seconds; final MP4 durations were
70.69/264.53 seconds. Focused acceptance: 24 passed, zero failed, zero skipped.
These suite runtimes are verification records, not performance comparisons.

The private compatibility gate uses a fresh temporary save copy per process,
process workers, identical injected store timestamps and a fixed
`performance.now()` preload in both HTTP and calculator processes. It compares
complete raw response bytes without removing or normalizing fields. The same
10 routes as MP3 cover full/play state, history, browser plugin status, full/play
task lists for both members, and native plugin status for both members. Keys are
minted only in the temporary copies, after browser plugin status is captured.
START is compared with MP4 with the option absent and then present.

**10 responses per run, zero differences in either comparison.** The response
digest-array SHA-256 is
`770860c24f1ee6cbbf4aa885cb8c8193737c58bac640cb2c63be8b7da5669ada`;
the total response size is 83,606,217 bytes. Full-state response: 16,213,564 bytes,
SHA-256 `f72cd9141b447e828e548a697ae8aaf602f1fe7ab27b0725ca58f4ff21664605`.
The rewritten save is identical in all runs: 766,470 bytes, SHA-256
`44cf36a23999b0e0ac4895b2b3a37011496ae177f23bbf99f711fbe95a09dc76`.
The private source checkout has zero changed files.

### MP4 timing and memory

Three alternating START/MP4 fresh-process pairs use fresh temporary copies,
process workers, port zero, disabled prediction prewarming and normal clocks.
The option is absent for all six timing trials. No test processes compete during
these trials. Cold start includes module import, create/listen and receiving the
first full task-list body. A save toggles one saved task backlog preference
through the command route, then immediately reads the same member's full list.
Input copying and shutdown are outside these durations. All before/after list
counts are 20,497. Values are median [minimum–maximum].

| Measurement | START | MP4 |
| --- | --- | --- |
| Cold start through full task list, ms | 11,271.37 [10,930.20–11,424.94] | 11,664.31 [11,046.52–11,693.61] |
| Save response, ms | 1,842.79 [1,757.61–1,941.20] | 1,805.54 [1,793.01–1,936.16] |
| Next full task list, ms | 1,824.91 [1,776.06–1,872.33] | 1,818.55 [1,761.08–1,884.84] |
| Save through next full task list, ms | 3,667.69 [3,533.67–3,813.53] | 3,611.56 [3,566.62–3,821.00] |
| Sampled peak HTTP-process RSS, MiB | 1,311.25 [1,259.05–1,311.39] | 1,309.96 [1,307.93–1,318.23] |

The cold median increases 3.49%; save-through-list decreases 1.53%. Ranges
overlap, and these three samples establish neither a throughput improvement nor
a service capacity estimate. Timings are specific to this environment and
should not be compared directly with earlier MP3 machine runs.

A separate fresh MP4 process with the option present serves task reads with two
extra owned pickers open, for three resident contexts. Sampled peak HTTP RSS is
**1,554.42 MiB**; HTTP plus calculator child processes peak at **2,741.40 MiB**.
Sampling runs every 20 ms and at response boundaries. This environment omits
`/proc` child lists; the verified extra-context run records Node fork/spawn PIDs
and reads their RSS directly. Timing trials report only the verified HTTP RSS.
This is one extra-context observation with a shared calculator pool, not a
per-picker memory cost or a safe concurrency limit.

The feature remains off by default. The remaining-work list above and the
explicit MP4 exclusions still apply before any production sign-up decision.

### MP4 follow-up 1

The review found that an explicit duo invitation could fall into default-picker
provisioning, and that legacy account writes after startup could conflict with
or remain unknown to the registry. Explicit invite callbacks now keep the
original invite path, including replacement invitations after revocation.
Registry ownership is checked before creating a legacy identity, claiming onto
an existing account or linking a legacy provider. A different owner gets:
“This sign-in already has its own picker. Joining the shared game with it is not
available yet.” The legacy record stays unchanged. A server-owned `syncLegacy`
callback re-reads the validated account/invite plan and calls `registerLegacy`
after successful legacy account writes in the same serialized mutation. The
registry's original 409 conflict checks are unchanged. `/join/` uses the single
legacy invitation issuer, so an already signed-in private owner also gets a
clear refusal without opening an unrelated gameplay handler.

Plugin revocation now removes its hash capability through the existing
`revokeCapability` operation after local revocation. The public local key record
redacts the hash, so the hook reads the selected context's durable key record;
no caller-supplied hash or filename is accepted. Removal verifies picker,
account and member scope, preserves other active keys, and supports retries.
`storage/registry.mjs` is unchanged: its existing read-only `findIdentity` and
capability revoke operation suffice.

Follow-up changes are confined to `signin.mjs`, `server.mjs`,
`picker-context.mjs`, `picker-router.mjs`, key-scoping code in `game-plugin.mjs`,
`tests/picker-routing.test.mjs` and this MP4 section. The two-provider synthetic
fixture replaces its old pre-auth cookie as a browser would. Six added tests
cover new and replacement duo invitations, refusing a solo subject without a
legacy write, immediate provider linking after startup and restart, refusing a
provider already owned elsewhere, and removing only a revoked key's capability.
Focused routing/crash validation: **30 passed, zero failed, zero skipped**.

The follow-up duo gate reruns the same 10 raw-byte reads from fresh temporary
copies at START, then with the option absent and present. Both comparisons have
**zero differences**. Each run has 83,606,217 response bytes, digest-array SHA-256
`770860c24f1ee6cbbf4aa885cb8c8193737c58bac640cb2c63be8b7da5669ada`.
The rewritten save has 766,470 bytes and SHA-256
`44cf36a23999b0e0ac4895b2b3a37011496ae177f23bbf99f711fbe95a09dc76`.
The private source checkout has zero changed files. Initial MP4 timing/memory
measurements above are retained; this follow-up does not claim new performance
measurements. Production sign-up remains off.

Final follow-up validation on Node 24.19.0 ran quick, then full, entirely after
the app changes:

| Suite | Reviewed MP4 passed / failed / skipped | Follow-up passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,535 / 0 / 68 | 2,541 / 0 / 68 |
| Full | 5,682 / 0 / 140 | 5,688 / 0 / 140 |

Quick took 84.84 seconds; full took 267.83 seconds. Both totals add exactly the
six new regressions, with no existing assertion loosened or test skipped.


### MP4 follow-up 2

All four enabled-routing review findings are fixed. Anonymous requests bypass
router body parsing and reach the unchanged legacy admission path. Legacy backup
requests also reach legacy unread. Owned backup uploads take the context's
existing single-import guard after checking current owner authority and origin,
then one slot of a process-wide owned-import budget (`maxConcurrentImports`,
default 1); when the budget is full they get a retryable 503 before any body
byte is read. Legacy keeps its own single guard outside that budget, so at most
one owned and one legacy backup parse at a time by default;
that same guard spans streaming parsing and the context handler. Parser admission
also enters the context drain set, so eviction cannot reopen a second parser
for the same picker while the first is still active. URL and header
selectors pass before admission, and body selectors pass before execution.
Legacy validates backup body selectors after its existing admission and parser,
before executing a restore. Refused uploads close their connection without
draining the body. Public ordinary
GET/HEAD visits carrying a forbidden administrator cookie reach legacy's existing
cookie-clear redirect; APIs and explicit bearer access still refuse it.

Private session responses delegate their account and sign-in fields to the
legacy issuer's session view, which already holds the configured provider list
and registry. Authentication endpoints remain on that issuer. No browser file
changes or additional OAuth state are required.

Legacy provider writes preflight both global subject ownership and the target
account's existing registry identity for that provider. A conflicting link
returns before either identity store changes. Unlink removes the provider from
both stores inside the existing serialized mutation. Startup validates every
planned subject owner before reconciling removals and calling `registerLegacy`.
Removal reconciliation applies only to matching legacy account IDs that already
have no owned default picker and only shared-picker memberships (including
none after revoked grants); registry-native
accounts are untouched. This also repairs an identity removed from legacy
storage offline or an unlink interrupted between the two durable writes. The
registry's original conflict checks remain intact.

Deleting a duo account, live or offline, retires its registry copy through
`deleteAccount`, so its subjects can rejoin through a fresh invitation. The legacy
plan lists every account in `accounts.json`, so a missing imported account was
deleted. Startup retires it before checking subject owners. Only accounts with at
least one membership, all of them in the shared picker, and no owned default
picker are retired. Accounts with an owned picker, interrupted first logins with
no membership, and every account when `accounts.json` itself is missing are left
alone. The live delete reuses the same startup synchronization. Retired account
IDs are permanent: restoring an older `accounts.json` that still lists one fails
closed at startup.

Follow-up edits are limited to `app/picker-router.mjs` (admission and public-page
recovery), `app/picker-context.mjs` (shared import admission, session view and
registry unlink), `app/server.mjs` (session-view wiring and startup reconciliation),
`app/signin.mjs` (provider conflict preflight), `tests/picker-routing.test.mjs`
(nine regression tests and dispatch capture), and this MP4 section, including
the two scanner-safe wording corrections in the changed-files table.
`app/web/account-panel.mjs` and `app/storage/registry.mjs` are unchanged.

The security reread covers router context selection, session and plugin-key
resolution, body admission, the context import guard, legacy authentication
recovery, session view delegation, serialized legacy provider writes and startup
reconciliation. Store paths, capability scope and stream routing still derive
only from authenticated credentials. Production sign-up and all earlier MP4
exclusions remain unchanged.

Follow-up 2 repeats the same 10 raw-response duo reads on fresh temporary save
copies at START, with the option absent, and with it present: **zero response,
size or rewritten-save differences** for both comparisons. Each run returns
83,606,217 bytes; digest-array SHA-256 is
`770860c24f1ee6cbbf4aa885cb8c8193737c58bac640cb2c63be8b7da5669ada`.
The rewritten save is 766,470 bytes, SHA-256
`44cf36a23999b0e0ac4895b2b3a37011496ae177f23bbf99f711fbe95a09dc76`.
The private checkout has zero changed files. Earlier performance measurements
remain the recorded measurements; this follow-up makes no new timing claim.

Final follow-up 2 validation on Node 24.19.0 ran quick, then full, after the last
app change. Quick: **2,550 passed, 0 failed, 68 skipped** (82.24 seconds).
Full: **5,697 passed, 0 failed, 140 skipped** (268.85 seconds). These are exactly
follow-up 1 plus nine new tests, or START plus the 39 routing and crash tests.
No existing assertions were loosened and no tests were skipped to obtain these
results. Added coverage includes unread anonymous/stale-credential uploads,
origin and role admission, per-picker import exclusion and draining through
capacity eviction, session account controls, public cookie recovery, provider
unlink/relink/restart, rejected links without identity writes, and offline
identity removal with both live and revoked legacy grants. The final raw-byte
duo gate was run against this app version with both option settings. All changes
are staged; the option remains off by default.


## MP5 deletion

START is `18aaca0ac37198c5ebed819ffa554a72dc1a3aca`. This feature uses
MP4's existing `multiPicker` server option. With it absent, the original
dispatcher, routes, credentials and gameplay behavior remain in use.
Production sign-up remains off.

`POST /api/picker/delete` and `POST /api/account/delete` take an empty JSON
object, require a signed-in account session and a valid request origin, and
recheck that same session after reading the bounded body and inside the deletion
queue. Picker deletion derives the picker ID from that session and verifies its
current owner membership and matching registry owner. Account deletion derives
only the account ID from the session; the registry finds all its owned default
pickers. Selectors can confirm the session's picker, never choose another target.
Operator bearer credentials, plugin keys alone and invitations cannot invoke
these owner capabilities. The shared picker, including the `legacy` HTTP scope,
cannot be deleted by this route or `beginPickerDeletion`.

Both success responses contain `status: "deleted"` and a `backups` object with
`retentionMs` and `message`. The separate server option
`createServer({ multiPicker: { ... }, backupRetentionMs })` has **no default**.
When supplied it must be a positive safe integer in milliseconds. It describes
the operator's finite retained-backup expiry policy; the app does not implement
service-backup expiry. Responses explicitly say retained backups are **not
erased immediately**. If the setting is absent, deletion still succeeds,
`retentionMs` is null and the message says the retention period is not configured.
Operators must implement and configure the disclosed expiry policy before public
launch. Gameplay backup retention is a different setting.

### Durable order and recovery

The MP1 external `tombstoneDir/ledger.json` remains the authoritative ledger;
there is no second restorable deletion database. Records contain only IDs,
deletion timestamps, lifecycle and optional purge progress. No provider subject,
name, game field, token or capability hash is added to tombstones. Existing
issued-ID reservations and retired-account records remain compatible. Writes
reuse the locked, mode-0600, fsync/rename/parent-fsync registry writer.
START's ledger reader refuses the added progress fields. An enabled-routing
rollback must use a version that understands them; never discard or edit the
external ledger to force an older reader to open it.

The sequence is: durably tombstone first; refuse account/picker admission through
the registry; synchronously fence streams before the registry cleanup write and
cancel only that picker's MP3 jobs; revoke local
invitations, plugin keys and overlays plus issuer sessions; drain accepted writes,
readers, calculations and sidecar flushes through context close; evict caches;
remove the owned directory and sync its parent; remove its sibling binding and
sync its parent; mark the picker deleted and clear the default slot. The ledger
records `revoked`, `drained`, `directory-removed`, `binding-removed` and `complete`.
Account tombstoning atomically includes every active owned picker, removes its
provider-subject/index grants and records pending issuer cleanup. Its completion
revokes claimed invitations and account sessions and removes its legacy account
row, when present. A later provider login creates a fresh account after account
deletion, or a fresh picker after picker-only deletion, with empty progress.

Startup reconciles the registry and purges every tombstoned owned directory and
binding before any owned context can open. It also initializes and cleans the
single legacy session issuer before legacy registration or HTTP listening, so a
restored account row cannot be imported or authenticated. Even completed records
are reapplied: restoring old directories, registry grants or issuer sessions must
not undo a deletion. Every purge operation is idempotent; an interruption is
completed on restart. Registry storage failures fail closed and require restart,
as in MP1. The post-acquisition check also refuses an open racing a tombstone.

For MP8, `reconcileTombstones({ registry, revokeSessions, drainPicker,
revokeAccount })` is exported from `app/storage/tombstones.mjs`. Keep the external
ledger when restoring a service checkpoint. Call reconciliation before opening
owned stores. A live caller must supply issuer revocation hooks and a
`drainPicker(id, phase)` hook: phase `revoke` synchronously fences delivery before
its first await and finishes durable sidecar revocation; phase `drain` closes and
evicts the context after accepted work finishes. Startup can omit the drain hook
when there are no live owned contexts. Issuer cleanup must finish before serving
requests. A live account-revocation hook must also fence retired credentials in
every resident membership, preserving other accounts' sessions. The HTTP path
does that synchronously immediately after the ledger write. This function is an operator integration API, not an HTTP restore API.

Owner uploads and retained restores remain gameplay-only and use the session's
active context. Old sessions cannot restore, selectors cannot address a deleted
picker, and a retained ID is resolved only inside the current store. An explicit
compatible gameplay upload into a fresh picker does not restore the deleted ID,
account, subjects, capabilities or ownership. The issued ID stays burned.

Shared-only account deletion removes account grants and claimed invitations;
it never closes, removes or mutates the shared gameplay store. Operator-issued
shared plugin/overlay credentials retain their existing scope. MP4's separate
live/offline duo-account retirement policy is preserved: its older account
records have no runtime-purge marker, and restoring those retired account IDs
still fails closed through legacy registration. Ordinary invitation revocation
also retains the established shared-game behavior.

### Changed files and security reread

| File | Change and target derivation |
| --- | --- |
| `app/storage/registry.mjs` | Minimal progress validation and writes, retired-account checks, deletion records and ledger-derived owned paths; rejects shared-picker tombstoning. Storage APIs remain operator-only. |
| `app/storage/tombstones.mjs` | Idempotent runtime/startup purge and explicit backup-retention disclosure; IDs and paths come only from the locked registry/ledger. |
| `app/picker-router-deletion.mjs` | The two owner routes and serialized deletion transaction; every HTTP target is derived and reauthenticated from the same account session. |
| `app/picker-router.mjs` | Selects the deletion handler without opening a store, fences opening races, and supplies context revocation/close hooks using registry-derived IDs. Shutdown waits for accepted deletions. |
| `app/picker-context.mjs` | Internal `fenceRevokedSessions`, `fenceDeletion`, `revokeDeletionSessions`, `revokeDeletedAccount` and `revokeDeletion` entry points; fences SSE, cancels MP3 work, revokes sidecars and reuses the established close/drain. |
| `app/server.mjs` | Opt-in startup reconciliation and retention-option wiring only. |
| `app/storage/invites.mjs` | `revokeDeletion({ pickerId, accountId, all })` removes issuer sessions and revokes claimed/all local invitations; retired accounts cannot authenticate even before cleanup. The trusted caller supplies ledger/session scope. |
| `app/storage/accounts.mjs` | Idempotent `revokeDeletion(accountId)` removes a ledger-selected legacy account row, with no gameplay mutation. |
| `app/game-plugin.mjs`, `app/plugin-keys.mjs` | Internal `revokeDeletion()` entry points revoke keys in the already selected owned context; no request-selected player/path or new plugin permission. |
| `app/overlays.mjs` | Internal `fenceDeletion()` and `revokeDeletion()` end local streams synchronously and durably revoke all local capabilities before close. |
| `tests/picker-deletion*.test.mjs`, `scripts/test-selection.mjs` | Synthetic HTTP and fresh-process recovery tests, classified quick/open-f2p. |

The security reread covered both HTTP deletions, each internal revocation entry
point above, queued authentication, context acquisition and eviction, startup
registration, provider-subject removal and gameplay restore. No deletion or
revocation endpoint accepts a target account ID, picker ID, member ID, hash or
filesystem path. Existing operator administration is unchanged.

### Acceptance and remaining work

The 27 new tests cover scoped/origin/body refusal; picker/account deletion;
stream and overlay closure with both pickers subscribed; key, invitation, cookie
and overlay refusal; durable local revocation before file removal; the paused
post-tombstone/pre-cleanup window; a held
accepted write; immediate revocation of an account's streams in another active
membership while preserving that picker's owner streams; a late MP3 result and
surviving B job; fresh empty login;
shared-game hash preservation; old uploaded/retained backups; restored registry,
issuer, directory and binding checkpoints; and real process death at 15 durable
picker/account checkpoints, followed by recovery and another lifecycle. Existing
assertions and skip classifications are unchanged.

Remaining work: browser deletion controls and switching/logout reconciliation
(MP6/follow-on UI), fair sharing and measured limits (MP7), operator backup expiry
and service-restore integration (MP8), RuneMetrics/G15 reconciliation, the full
lane acceptance gate, and the owner's decision before opening sign-up.


### MP5 validation and duo gate

Node 24.19.0. The final quick suite ran before the final full suite, both after
the last app edit. Focused deletion/recovery: **27 passed, 0 failed, 0 skipped**.
No existing test assertion or skip classification was changed.

| Suite | START passed / failed / skipped | MP5 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,553 / 0 / 68 | 2,580 / 0 / 68 |
| Full | 5,700 / 0 / 140 | 5,727 / 0 / 140 |

START quick/full took 73.22/267.36 seconds; final MP5 took 77.62/269.55 seconds.
Both pass totals equal START plus the 27 new tests. These are verification
runtimes, not performance trials.

The final duo gate uses fresh temporary copies, process workers, the same 10
read routes as MP4, identical injected store timestamps and a fixed
`performance.now()` preload in HTTP and calculator processes. Complete raw
response bytes are hashed without dropping or normalizing fields. It compares
START with the final change with `multiPicker` absent and then present.
**10 responses per run; 0 response differences and 0 rewritten-save differences
in both comparisons.** Each run returns 83,606,131 bytes, with digest-array
SHA-256 `67aa2720e6be6280624d8b79a2dd966d5d16d157fdfbc8b761f15eb727e2fc01`.
The full-state response is 16,213,478 bytes, SHA-256
`fcfeafdf1cfd701066bb4189a39138d8e9fd38900ea4ed57d113060b48499ddf`.
The rewritten save is 766,384 bytes, SHA-256
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
There are 0 changed files in the private checkout.

### MP5 timing and memory

Three fresh-process pairs alternate START/MP5 after all suites finish. Each
trial uses a fresh temporary copy, process workers, port zero, disabled
prediction prewarming, identical injected store timestamps and normal elapsed
clocks. `multiPicker` is absent. Cold time includes module import, create/listen,
the first full-state read and the first full task-list body. A command toggles
one saved task's backlog flag and immediately reads the same member's full task
list. Copying and shutdown are outside the timings. Every before/after list
contains 20,497 tasks. Peak HTTP RSS is sampled every 20 ms and at response
boundaries, then checked against the process lifetime high-water mark; calculator
children are excluded. Values are median [minimum–maximum].

| Measurement | START | MP5 |
| --- | --- | --- |
| Cold state and full tasks, ms | 11,765.39 [11,739.48–11,825.14] | 11,530.74 [11,466.00–11,619.26] |
| Save response, ms | 1,806.33 [1,783.31–1,855.16] | 1,827.17 [1,762.87–1,879.92] |
| Next full task list, ms | 1,940.15 [1,882.29–1,960.72] | 1,913.04 [1,827.41–1,981.73] |
| Save through next full list, ms | 3,746.50 [3,665.60–3,815.90] | 3,792.98 [3,590.29–3,808.91] |
| Peak HTTP RSS, MiB | 1,337.34 [1,323.83–1,403.18] | 1,357.30 [1,340.64–1,442.18] |

Save-through-list and RSS ranges overlap. These three pairs establish neither
a throughput improvement nor a service-capacity estimate. No calculator or
residency-limit behavior changed. The feature remains opt-in; retained-backup
expiry and whole-service restore remain operator work.

## MP6 browser

MP6 binds each browser document to the account and picker returned by its initial
`/api/session` read. The opt-in response adds `multiPicker: true` and
`pickerRoute`; it also supplies `pickerId` for legacy sessions, using the
registry's durable shared-picker ID. Private-account responses already contain
`accountId` and `pickerId`. `pickerRoute` is the authenticated router selector
(the shared context uses its existing `legacy` alias); it conveys no new grant.
With the option absent these additions are absent, the browser uses its original
storage keys, and session polling and picker selectors remain inactive.

The session read finishes before private startup reads or command recovery.
Enabled documents check the session before API traffic, every five seconds, on
focus, on pageshow and after a sign-out storage notification. API requests carry
`X-Picker-Id`, and SSE carries the same selector in its query, so a cookie change
between the check and dispatch cannot route an old command into another picker.
Account, picker, member or permission changes and expired sessions retire the
old document and reload. There is no in-place transfer of caches to a new game.
The account panel retains its existing layout, adds the active account and picker
IDs in enabled mode, and runs cleanup before its existing sign-out POST.

Game preference keys use `picker.scope.<pickerId>.` in local storage. Durable
outboxes use that prefix in session storage, and command ownership qualifies the
client ID with the picker ID for both Web Locks and the HTTP IndexedDB/probe
fallback. This scopes both ownership records and cross-tab ownership probes.
Old unscoped outboxes are never assigned to a picker: enabling the feature warns
about pending intentions and removes those records without replaying them.
Unscoped preferences are not imported into enabled picker scopes.

| Scope | Browser state |
| --- | --- |
| Picker | Remembered member; task-view, task-list, group personal and activity filters; completed-review date choice; hide-obtained choice; map activity layers, pin filters, travel lines and membership overlay; recent stickers; viewer preferences (including the theme/IDs record); usage opt-in. |
| Picker/document | Saved views, task/planning/prediction/inspection caches, drafts, previews, sandbox and review controllers, queued commands, durable recovery, save retry controls, SSE and reconnect/reconciliation timers. A retired document clears its visible game and caches, rejects late responses and cannot bind another picker. |
| Site UI | Map display sizes/count/place-label visibility; phone/dock layout; settings-section navigation; group-goal disclosure layout; map-control discovery; stream-safe display controls; update/roadmap read position. Saved member preferences remain in their existing server-side game state. |
| Session coordination | A per-tab active-scope/retirement marker and a site sign-out change notification. These carry coordination metadata, never commands or cached game views. |

Retirement blocks sending first, cancels durable retries and queued writes,
releases ownership, closes streams and timers, stops feedback/plugin/usage
activity, removes recovery controls, clears scoped local/session storage and the
old rendered game, then allows navigation. Late callbacks cannot repopulate
retired storage. Queued writes and durable unconfirmed intentions trigger an
explicit warning that queued changes were not sent, and that a request already
in flight may have arrived and needs a History check. Storage cleanup failure
blocks sign-out/account navigation; a retired marker forces cleanup again before
a later document loads, including a return to the same account and picker.

### Files

| File(s) | Change |
| --- | --- |
| `app/picker-context.mjs` | Additive enabled-mode session metadata only. |
| `app/web/screen-save-status.mjs` | Scoped storage adapter and document session/retirement coordinator, alongside existing save status in an already-served module. |
| `app/web/main.mjs`, `screen-panels.mjs` | Install and preserve the coordinator in the existing panel context; no new top-level screen-context fields or renderer dependencies. |
| `app/web/screen-startup.mjs` | Session-first bootstrap, scoped member/coordination storage, feedback disposal and sign-out hookup. |
| `app/web/account-panel.mjs` | Active account/picker details and pre-sign-out cleanup callback. |
| `app/web/live-swap-client.mjs` | Scoped outbox/ownership identifiers and terminal cancellation of queued/in-flight/retrying saves. The existing HTTP lock implementation receives the qualified ownership key. |
| `app/web/screen-commands.mjs` | Guard API reads/writes and durable traffic; track queued commands and sync applies. |
| `app/web/screen-live.mjs` | Scope SSE; close streams and cancel reconnect/reconciliation work at retirement. |
| `app/web/game-plugin.mjs` | Track queued applies/dismissals and dispose private plugin state/timers. |
| `app/web/screen-usage.mjs` | Scoped opt-in and guarded sends; enabled mode avoids unscoped beacons. |
| `app/web/backup-transfer.mjs`, `screen-dialogs.mjs` | Send backup downloads through the session guard. |
| `app/web/screen-settings.mjs`, `screen-controls.mjs`, `screen-map.mjs`, `screen-tasks.mjs` | Scope viewer/member/overlay/task preferences. |
| `app/web/task-view-preferences.mjs`, `task-filters.mjs`, `task-filters-model.mjs`, `duo-task-view.mjs` | Scope task and group filter storage. |
| `app/web/activity-filters.mjs`, `bis-preferences.mjs`, `completed-range-preference.mjs`, `sticker-picker.mjs` | Scope activity/review/equipment/sticker preferences. |
| `app/web/map.mjs`, `map-pins.mjs`, `map-activity-layers.mjs` | Scope travel/pin/activity choices; reread early-created game choices after session discovery. |
| `tests/picker-browser-session.test.mjs`, `scripts/test-selection.mjs` | 26 new VM/DOM/command regressions, explicitly classified quick. |

### Validation

Untouched START is `18aaca0ac37198c5ebed819ffa554a72dc1a3aca`.
Node is 24.19.0. START quick: 2,553 passed, 0 failed, 68 skipped
(72.27 seconds); START full: 5,700 passed, 0 failed, 140 skipped
(274.20 seconds). Final MP6 suite and duo-gate measurements are recorded below.

Residual limits: enabled mode adds a session preflight to API traffic and a
five-second session monitor. A network failure checking identity blocks that
request and retains recovery until identity can be established. Already-dispatched
writes cannot be recalled; the warning directs the user to History. No new
screen, signup, deletion flow, owner powers or gameplay behavior is introduced.

Final validation, run quick then full after the last app change:

| Suite | START passed / failed / skipped | MP6 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,553 / 0 / 68 | 2,579 / 0 / 68 |
| Full | 5,700 / 0 / 140 | 5,726 / 0 / 140 |

MP6 quick took 73.49 seconds; full took 266.52 seconds. Both totals add exactly
26 tests, with unchanged skips and no existing assertion weakened. The separate
account-panel, gallery, screen-model and browser-module dependency checks passed
34 tests, failed 0, skipped 0 (0.93 seconds). Standalone VM regressions remain
unchanged and pass in the full suite.

The option-absent duo gate ran three alternating START/MP6 pairs, one server and
its process calculators at a time, from a fresh temporary save/binding copy for
each run. It repeated MP4's 10 raw-response reads with identical injected store
timestamps and a fixed `performance.now()` preload in HTTP/calculator processes.
No response field was removed, normalized or rounded. Each run returned
83,606,131 bytes across 10 responses. All six runs had digest-array SHA-256
`67aa2720e6be6280624d8b79a2dd966d5d16d157fdfbc8b761f15eb727e2fc01`:
**0 response or size differences**. Rewritten saves were 766,384 bytes with
SHA-256 `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`:
**0 save differences**. The private source checkout had **0 changed files**.

These are compatibility-workload measurements under fixed response clocks, not
a browser latency benchmark or a claim of server performance improvement. Wall
time uses the real clock and includes copying, import, startup, reads and close.
Memory is sampled aggregate RSS of the HTTP process and its process calculators
at 50 ms intervals and response boundaries; it excludes test processes. No test
suite ran during these six trials.

| Measurement, median (minimum–maximum), 3 runs each | START | MP6 |
| --- | --- | --- |
| Compatibility workload wall time | 18.222 s (17.827–18.686) | 17.989 s (17.764–18.048) |
| Sampled peak aggregate RSS | 3,214.86 MiB (3,197.94–3,231.97) | 3,200.10 MiB (3,179.68–3,254.17) |

All changes are staged. The option stays off by default; opening public sign-up
and the remaining multiplayer-lane acceptance items remain outside MP6.

## MP9 owner controls

START is `4efebccc480e03cbee832660b20ab8bfd872a804`, the local multiplayer
base with MP5 and MP6 merged. Public sign-up remains off. With `multiPicker`
absent, account-panel markup, requests and storage behavior stay at START.

The enabled signed-in session adds exactly one field, `ownerControls`:
`{ role, shared, ownsDefaultPicker, backups: { retentionMs, message } }`.
The server derives role and picker kind from the registry membership, checks
whether this account has an active owned default, and reuses MP5's retention
disclosure verbatim. Existing account, picker and permission fields are unchanged.
The browser uses this field to show the current role and distinguish an owned
picker from the shared exception; write permission alone never implies ownership.

Owners get shortcuts to existing rules, preferences, gameplay export/compatible
restore and plugin-key tools, plus picker and account deletion. Owner gameplay
restore uses the whole owned game route rather than the legacy member-only route.
The shared picker has no picker-deletion button and no Leave capability. Its
account-deletion dialog says this removes the account's access and claimed
invitations while preserving the shared game and other player. If an account
also owns a default, the dialog discloses that its owned game is deleted too.
MP4's operator-only invitation/overlay administration remains unavailable to
owners. Process control, raw snapshots, cross-account administration and global
configuration acquire no new browser entry points or grants.

Each destructive dialog names the target, warns that deletion is irreversible,
and shows the server's retention text, including the unconfigured-policy message.
Confirmation first reads the signed-in session again and verifies its account,
picker, role and permissions, then sends an empty JSON object to MP5's existing
session-scoped route with the active picker selector. MP5 reauthenticates the
session after the body and inside its deletion queue; it requires no additional
OAuth challenge. No caller-supplied account or deletion target is sent.

While confirmation runs, the MP6 coordinator blocks other new API requests and
session-monitor checks, preventing a revocation poll from reloading before the
deletion receipt. Refusals release that temporary block without retiring the
page. Server messages are rendered as text. A retryable 503 offers a manual retry
and honors seconds or date forms of Retry-After; it never resends automatically.
Every retry checks the session again. Cancelled or replaced dialogs cannot send
a stale confirmation, and repeated clicks cannot submit concurrent deletions.

On success the browser immediately uses MP6's before-sign-out cleanup: stop
sending, reject queued commands, dispose streams and monitors, clear the old
picker's recovery/preferences and rendered game, and warn about unsent changes.
The receipt shows MP5's response retention message verbatim. Continue lands on
`/auth/signin`; MP5 has already revoked the session, so there is no second sign-out
request. A storage-cleanup failure blocks navigation and offers cleanup again
without repeating deletion. This does not promise immediate retained-backup
erasure or implement the operator's expiry policy.

Files: `app/server.mjs` adds the session field; `app/web/account-panel.mjs` owns
the controls and dialogs; `screen-startup.mjs` wires existing gameplay tools;
`screen-save-status.mjs` coordinates an in-progress account action;
`screen-dialogs.mjs` selects the owner's gameplay restore scope.
`gallery-dialog-coverage.json` records why destructive authentication dialogs
are exercised by synthetic tests rather than the read-only gallery.
`tests/picker-owner-ui.test.mjs` adds 16 synthetic browser/HTTP regressions and
`scripts/test-selection.mjs` classifies them quick/open-f2p. No new screen-context
field, static module dependency or existing test change is needed.

Final validation on Node 24.19.0 ran quick, then full, after the app changes.
The new owner file passes 16 tests; focused account/session/VM cache checks pass
56 tests and the gallery inventory passes 11, with zero failures. The first quick
attempt exposed the missing gallery registrations; the inventory now records
both dialogs without changing or weakening any test.

| Suite | START passed / failed / skipped | MP9 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,607 / 0 / 68 | 2,623 / 0 / 68 |
| Full | 5,754 / 0 / 140 | 5,770 / 0 / 140 |

Both totals are exactly START plus the 16 new tests, with unchanged skips.
START quick/full took 77.71/265.83 seconds; final MP9 took 79.29/270.94 seconds.
These suite durations are verification runtimes, not performance trials.

The duo gate ran three alternating START/MP9 pairs with the option absent,
then three pairs with it present. All 12 runs used fresh temporary save/binding
copies, process workers, the same 10 read routes as MP4, identical injected store
timestamps and a fixed performance clock in HTTP/calculator processes. Complete
raw responses were hashed without removing or normalizing fields.
**0 response differences across 60 paired reads; 0 size differences; 0 rewritten-save
differences across six pairs.** Each run returned 83,606,131 bytes, with digest-array
SHA-256 `67aa2720e6be6280624d8b79a2dd966d5d16d157fdfbc8b761f15eb727e2fc01`.
Each rewritten save was 766,384 bytes, SHA-256
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
The private source checkout has 0 changed files.

These are compatibility-workload measurements under fixed response clocks, not
browser interaction benchmarks or service-capacity estimates. Real wall time
includes module import, startup, reads and shutdown, excluding input copying.
Aggregate HTTP/calculator RSS is sampled every 50 ms and at response boundaries.
No test workloads ran during these trials. Values are median [minimum–maximum],
three fresh processes per version and option setting.

| Option / measurement | START | MP9 |
| --- | --- | --- |
| Absent, workload seconds | 18.04 [18.03–18.66] | 18.30 [18.08–18.68] |
| Absent, sampled peak RSS, MiB | 3,175.14 [3,148.89–3,249.57] | 3,198.73 [3,184.63–3,252.47] |
| Present, workload seconds | 17.79 [17.69–18.15] | 17.61 [17.50–18.38] |
| Present, sampled peak RSS, MiB | 3,222.07 [3,158.89–3,239.59] | 3,249.32 [3,101.45–3,265.95] |

All before/after ranges overlap. These samples establish no throughput improvement
or new concurrency limit. Retained-backup expiry remains the operator's
responsibility; the browser discloses the configured policy without promising
immediate erasure. Public sign-up and the remaining lane-wide acceptance items
remain outside MP9. All changes are staged.
