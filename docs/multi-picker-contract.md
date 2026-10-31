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
| Plugin keys, reports, fragments, sequencing, evidence | Context-owned `gamePlugin` owns its key, progress, achievement and item controllers, assemblies, sequence/rate/status maps and retained task bytes. Web-provider caches and plugin observations are context-local as resolved against G15 below. |
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
- **RuneMetrics member/name cache — closed against G15:** each context calls
  `createProgressSources` independently. Its RuneMetrics adapter constructs its
  own client with member/name-keyed cache, pending requests and abort controllers;
  identical bindings in different pickers never share that cache. The default
  official-API adapter is stateless and the default Hiscores adapter owns its
  abort controllers per client. Context close calls `progressClient.close()` and
  clears its preview map; it cannot close another context's provider. Injected
  provider objects remain operator-supplied test/integration dependencies and
  must not introduce shared private caches. G15's `mergePluginProgress` also runs
  after the fetch against the latest member and this context's plugin snapshot,
  preserving plugin provenance and web fields when a report arrives mid-fetch.
  The replacement seam and sunset/fallback policy are retained unchanged. The
  colliding-binding context test and G15 provider/server tests cover cache,
  preview, close and reconciliation behavior.
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
lane acceptance gate, and the owner's decision before opening sign-up. This is
the historical MP5 list; G15 reconciliation is closed by the context-owned
provider/cache resolution above.


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

## MP7 fairness and limits

MP7 starts at `18aaca0ac37198c5ebed819ffa554a72dc1a3aca`. All new
behavior requires `createServer({ multiPicker: { ... } })`. Omitting that option
retains the START scheduler, rate/stream admission and plugin-key/report limits.
Public sign-up remains off by default.

The server constructs one `createPickerLimits` instance and supplies it to the
router and every context. Context eviction, new sessions, extra memberships and
extra plugin keys never create a fresh global budget. Authenticated account IDs
are the account boundary across picker memberships. Capability-only legacy
traffic without an account is conservatively grouped by picker; indexed and
known plugin keys use their owning account. New enabled-mode keys retain a private issuer account ID in their key sidecar;
it is omitted from public key records. Existing legacy keys without that binding
charge every account registered to that player, so ambiguous ownership cannot
reset a quota across restart. Revoke and reissue these keys to remove that
conservative grouping. START cannot read the optional issuer field: rolling back
after enabled-mode issuance requires resetting those plugin keys, in addition
to the MP4 session-reset requirement. Global active-key
accounting is reconstructed at startup by reading lightweight key sidecars,
without opening dormant gameplay contexts. Pending key issuance reserves its
slot before persistence; failed issuance releases it, and durable revocation
frees the slot. Existing active keys are not automatically revoked when a bound
is lowered; new issuance remains refused until usage falls below the bound.

Every calculator lane uses the MP3 picker identity and round-robin dispatch
among waiting pickers. Within a picker, requested work takes precedence over
warming. A picker may have at most `maxOutstandingJobsPerPicker` distinct jobs
across all lanes, with a further per-lane ceiling of half that lane's queue
bound, rounded down with a minimum of one. This leaves admission room for a
quiet picker. Existing global lane queues, snapshot/result byte budgets,
watchdogs and worker counts remain in force. Coalesced requests have a bounded
number of waiters. Cancellation, revision supersession, stale result rejection,
worker recovery and context draining retain their MP3/MP4 scope. Work already
executing keeps its physical worker until completion or the existing watchdog;
round-robin sharing does not preempt a synchronous calculator. A single active
picker has no artificial inter-job delay.

The following are flat fields of `multiPicker`. Values are positive safe
integers; rates use fixed windows. These defaults are admission bounds, not
measured capacity. EN6 can replace the values in `MP7_DEFAULTS` in
`app/security/picker-limits.mjs` once its measurements are reviewed.

| Fields | Defaults |
| --- | --- |
| `maxOutstandingJobsPerPicker`, `maxWaitersPerJob` | 4, 64 |
| `expensivePerAccount`, `expensivePerPicker`, `expensiveGlobal` | 600, 600, 1,200 per window |
| `streamsPerAccount`, `streamsPerPicker`, `streamsGlobal` | 16, 32, 64 concurrent |
| `pluginKeysPerAccount`, `pluginKeysPerPicker`, `pluginKeysGlobal` | 3, 6, 192 active, including pending issuance |
| `pluginRequestsPerKey`, `pluginRequestsPerAccount`, `pluginRequestsPerPicker`, `pluginRequestsGlobal` | 4, 16, 32, 128 per plugin window |
| `invitationsPerAccount`, `invitationsPerPicker`, `invitationsGlobal` | 10, 20, 100 creations per window |
| `registrationsPerAccount`, `registrationsGlobal` | 3, 30 per window |
| `provisioningPerAccount`, `provisioningGlobal` | 3, 30 attempts per window |
| `coldStartsPerAccount`, `coldStartsGlobal` | 1, 1 concurrent admissions |
| `bodyBytesPerRequest`, `bodyBytesPerAccount`, `bodyBytesPerPicker`, `bodyBytesGlobal` | 268,435,456; 268,435,456; 268,435,456; 536,870,912 bytes |
| `limitWindowMs`, `pluginWindowMs`, `limitMaxAccounts` | 60,000 ms; 1,000 ms; 10,000 |

Registration has both pre-authentication client admission at provider sign-in
start and verified provider-subject admission before new-account creation.
Provisioning uses the account ID once allocated; interrupted provisioning can
be retried under the same budget, and ready-picker sign-ins do not consume
provisioning tokens. Invitation limits cover creation rate; the existing durable
record caps still apply. Cold-start leases cover opening and queued opening
admissions, release on success/failure, and refuse excess work before the factory
runs. The existing serialized residency transition still opens at most one
context at a time even if a larger cold-start bound is configured.

Body limits count wire bytes across JSON iterators, streaming backup parsers
and handlers that drain bodies. Declared bytes reserve global admission before
authentication and account/picker admission before context acquisition. Actual
streamed bytes consume that reservation; undeclared excess is checked at ingress
before parser delivery. Unused reservations release when handling finishes.
Account/picker/global byte reservations also enforce concurrent in-flight bounds
across window rollovers. The rate totals use the ordinary limit window; the
per-request byte maximum is independent. Existing smaller route-specific and
decompressed-backup limits continue to apply. Unauthenticated traffic shares
its client bucket and the legacy picker bucket. Live accounting buckets are
never evicted to reset a budget; overflow shares bounded fallback buckets.

New capacity refusals use 429, or 503 for cold starts, with `Retry-After` and
advice to wait, close streams, revoke keys, reduce uploads or slow plugin polling.
Rate checks validate every layer before charging any layer. Streams release on
finish or disconnect exactly once. Residency and authority checks remain in
the router; these budgets never grant access.

Changed files: `app/tasks/scheduler.mjs` adds fair dispatch and outstanding/waiter
admission. `app/security/picker-limits.mjs` owns the server budgets and default
configuration. `app/server.mjs` only constructs and passes the enabled-mode
settings/instance. `app/picker-router.mjs` wires body, registration and cold-start
admission. `app/picker-context.mjs` wires account-aware expensive requests,
streams, invitations, provisioning and plugin limits. `app/game-plugin.mjs` and
`app/plugin-keys.mjs` wire account/global key reservations and traffic, retaining
the old path when disabled. Three new synthetic test files are classified
quick/open-f2p in `scripts/test-selection.mjs`.

### MP7 validation and compatibility gate

Final validation on Node 24.19.0 ran quick and then full after all app changes.
All 33 new tests are synthetic, quick/open-f2p. Existing tests and expectations
are unchanged; no test was weakened or newly skipped.

| Suite | START passed / failed / skipped | MP7 passed / failed / skipped |
| --- | --- | --- |
| Quick | 2,553 / 0 / 68 | 2,586 / 0 / 68 |
| Full | 5,700 / 0 / 140 | 5,733 / 0 / 140 |

START quick/full durations were 72.24/266.08 seconds; final MP7 durations were
75.52/266.06 seconds. These suite runtimes are validation records, not performance
comparisons. The focused limit/issuer review passed 18 tests with no failures.
Coverage includes colliding members/revisions, stale delivery, cancellation,
worker crash/restart, eviction across an accepted write, cross-membership/account
budgets, extra sessions and keys, pending key issuance, restart accounting,
chunked/piped bodies, upload reservations across window rollover and cold-start
factory exclusion.

The final full-suite flooding test uses 20 independent samples per mode, a
64-slot synthetic queue, a 32-job picker cap and 2 ms simulated calculator work.
A flooding picker submits 32 distinct jobs; a quiet picker submits one. FIFO
p95 queue wait is **75.89 ms [68.87–77.56 ms observed range]**; fair p95 is
**5.67 ms [3.99–10.56 ms observed range]**. The quiet picker waits behind at most
one queued flooding job, plus the already executing job. The final quick run
independently records 70.82/4.32 ms p95. These measure queue sharing with test
doubles, not production calculator throughput or EN6 capacity.

The private compatibility gate uses fresh temporary copies, process workers,
identical injected save timestamps and fixed `performance.now()` in HTTP and
calculator processes. It compares all response bytes without normalization,
using the same 10 responses as MP4. START is compared against final MP7 with
`multiPicker` absent and present: **zero response, size or rewritten-save
differences in both comparisons**. Each run returns 83,606,217 bytes;
digest-array SHA-256 is
`770860c24f1ee6cbbf4aa885cb8c8193737c58bac640cb2c63be8b7da5669ada`.
The rewritten save has 766,470 bytes, SHA-256
`44cf36a23999b0e0ac4895b2b3a37011496ae177f23bbf99f711fbe95a09dc76`.
The private source checkout has zero changed files.


### MP7 timing and memory

Three alternating START/MP7-off/MP7-on fresh-process rounds use fresh temporary
copies, process workers, port zero, disabled unsolicited prediction warming,
identical injected store timestamps and normal elapsed-time clocks. All test
processes have exited before these trials. Copying and shutdown are outside the
measurements. Cold start includes module import, server creation/listen and the
first full task list. The save toggles one saved task backlog preference through
HTTP, followed immediately by the same full list. All nine before/after pairs
return 20,497 tasks. Each metric is reduced independently; values are median
[minimum–maximum] across three processes per configuration.

RSS is sampled every 20 ms and at response boundaries. Process-tree samples
include the HTTP process and calculator child PIDs recorded at fork/spawn;
thread heaps belong to their hosting child process. These are sampled peaks,
not a service capacity estimate.

| Measurement | START | MP7 option absent | MP7 option present |
| --- | --- | --- | --- |
| Cold start through first full list, ms | 11,368.24 [11,288.81–11,590.35] | 11,427.14 [11,303.85–11,486.10] | 11,351.03 [11,336.25–11,407.51] |
| Save response, ms | 1,781.74 [1,693.71–1,786.37] | 1,810.56 [1,729.96–1,877.84] | 1,823.43 [1,758.10–1,840.32] |
| Next full task list, ms | 1,868.74 [1,811.38–1,871.93] | 1,863.62 [1,820.34–1,894.43] | 1,864.36 [1,825.15–1,868.76] |
| Save through next full list, ms | 3,597.75 [3,562.46–3,653.67] | 3,674.17 [3,550.30–3,772.28] | 3,692.20 [3,583.25–3,704.69] |
| Sampled peak HTTP RSS, MiB | 1,309.15 [1,275.00–1,328.55] | 1,306.23 [1,275.91–1,327.61] | 1,298.64 [1,276.41–1,319.05] |
| Sampled peak process-tree RSS, MiB | 2,607.55 [2,545.01–2,661.08] | 2,572.29 [2,560.67–2,659.95] | 2,598.62 [2,560.50–2,625.46] |

Save-through-list medians increase 2.12% with the option absent and 2.63% with it
present. Both ranges overlap START; the enabled median is 0.49% above the disabled
median, within the observed run-to-run spread. These three-sample comparisons
show no regression beyond observed variation and do not establish a throughput
improvement or public-service capacity. Sampled peak memory is within the START
range in both settings.

Remaining limits: synchronous active calculator work relies on the existing
watchdog rather than preemption; cold opens remain serialized; ambiguous old
legacy keys conservatively share candidate-account quotas; and START rollback
after issuer-bearing key creation requires resetting those keys. EN6 must still
supply reviewed capacity numbers before public deployment. Deletion, browser UI,
operator tooling and production sign-up policy remain outside MP7. No private
inputs or scratch measurement scripts were added to this repository. All changes
are staged for collection, with no push or pull request.

## Phase 1 acceptance map

MP10 uses combined START `341f81648a3f8d0e308420f99250a7a624362189`
(MP9 including MP6/MP5, merged with MP7). The comparison main is
`1c978e30d73a7a9cad0184e11b06376635438c6b`. Application files are
unchanged after START. Public sign-up remains switched off.

All executable cases use the real `createServer` with `multiPicker` enabled,
synthetic OAuth sign-in and HTTP. Public fixtures deliberately collide member IDs
and revisions. Controlled worker transports make stale delivery/crash ordering
deterministic while retaining the real scheduler, router, contexts and limits.
Browser cases execute the session module in a VM and the actual durable command
client against HTTP sessions; they hold ownership before dispatch and change the
cookie or sign out. The preview case enables the public fixture's progress
features, uses public response fixtures and temporarily forces proposal UUID
allocation to collide, restoring randomness before writes. No private input is
used in tests.

| Phase 1 bullet | Combined acceptance test(s) | Earlier focused coverage |
| --- | --- | --- |
| Two unrelated accounts, empty colliding members/revisions, mutate/check/reload | `phase1-acceptance.test.mjs`: P1.1 | MP4 `picker-routing.test.mjs`; MP2 `picker-context.test.mjs` |
| Cross-picker commands, tasks/queries, conflicts, history, export, uploads/retained restore, invitations, overlays, SSE and plugin; conflicting selectors | P1.2 | MP4 `picker-routing.test.mjs`; MP5 `picker-deletion.test.mjs`; MP7 `picker-limits-http.test.mjs` |
| Reused request/receipt/preview/backup IDs and revisions; replay, undo, caches and restore stay scoped | Both P1.3 cases | MP4 `picker-routing.test.mjs`; MP3 `picker-jobs.test.mjs`, `worker-picker-keys.test.mjs`; existing `action-receipts.test.mjs`, `runemetrics-server.test.mjs` |
| Both subscribed; revoke/delete A, close its streams and prevent later revision/worker/plugin/overlay leakage | P1.4 | MP5 `picker-deletion.test.mjs`; MP4 `picker-routing.test.mjs` |
| Interleaved colliding jobs, stale delivery, cancellation/crash/restart and eviction during queued writes; B survives | Both P1.5 cases | MP3 `picker-jobs.test.mjs`; MP4 `picker-routing.test.mjs`; MP5 `picker-deletion.test.mjs`; MP7 `picker-fairness-isolation.test.mjs` |
| Racing/crashed provisioning, one empty default, unchanged shared exception and separate ownership slots | P1.6; `phase1-acceptance-crash.test.mjs`: six P1.6 process-death boundaries | MP1 `registry.test.mjs`; MP4 `picker-routing.test.mjs`, `picker-routing-crash.test.mjs` |
| Browser switch/logout during queued commands clears views/streams/preferences/recovery without replay | Both P1.7 cases | MP6 `picker-browser-session.test.mjs`; MP9 `picker-owner-ui.test.mjs` |
| Service backup containing a deleted picker honors tombstones, revoked credentials and unchanged B | P1.8 (MP8 service backup, HTTP deletion, stopped restore, MP15 operator code, OAuth reclaim, real server reopen) | MP8 `linux-multi-picker.test.mjs`, `linux-service-crash.test.mjs`; MP1 `registry.test.mjs`; MP5 `picker-deletion.test.mjs`, `picker-deletion-crash.test.mjs` cover checkpoint reconciliation, not MP8 service restoration |
| Owner capabilities stay scoped; operator powers remain private; global budgets shared | P1.9 | MP4 `picker-routing.test.mjs`; MP7 `picker-limits-http.test.mjs`, `picker-limits.test.mjs`, `picker-fairness-isolation.test.mjs`; MP9 `picker-owner-ui.test.mjs` |

The new files are explicitly quick/open-f2p in `scripts/test-selection.mjs`.
MP8 (PR #35) is merged into this branch. P1.8 is executable; see the P1.8\nfollow-up below. The historical run records that follow describe the earlier skip.
No application bug has been identified by the executable acceptance cases.

### MP10 lane gates

The checker and unchanged reference adapter come from engine commit
`2856d0d8d19b49c4d36718bbb2cff1d61e080610` in a separate worktree.
No checker files enter this branch. Scratch adapter directories link their
`app` roots to the pinned main and START worktrees, permitting **direct
cross-tree reference-versus-candidate comparisons**. The self-reference/report
hash fallback is not used.

This checker has no named duo mode. The duo workload here selects the current
saved snapshot with `limits.save: 1`, seed 17, all default request caps, sequence
8 and serial calculators. Its inventory contains 414 retained states; **1 state
is checked per comparison**. **The multiplayer checker gate passes.** The 414-state engine gate runs as
48 Cloud shards before the first engine merge to main and is outside this lane. Fresh gameplay copies and matching bindings are opened
and closed by the real server first: main without routing, then START without
or with `multiPicker`. All four preparation opens have 0 state-hash differences.
The adapter itself has no `multiPicker` setting; the option selects the server
preparation path. The acceptance suite above exercises routing and scheduler
isolation through HTTP.

| Direct comparison | States checked | Comparisons | Differences | Errors |
| --- | --- | --- | --- | --- |
| Main against START, option absent | 1 | 36 | 0 | 0 |
| Main against START, option present | 1 | 36 | 0 | 0 |

Both reports have manifest SHA-256
`e820a65517c544267fce264904a612855aebe72fc7e1ca139718a5b7ac86c5b4`
and state-ID SHA-256
`78ede83a331763a6a92414ff0b5f6f94c1d6e8855f80152df16673529bd8e87e`:
0 corpus/state-ID differences. A public external-adapter smoke comparison also
checks 1 state with 0 differences and 0 errors. Historical engine coverage
remains separate from these current-duo comparisons.

Validation on Node 24.19.0 (passed / failed / skipped / TODO):

| Suite | START | MP10 |
| --- | --- | --- |
| Quick | 2,661 / 0 / 68 / 0 | 2,678 / 0 / 69 / 0 |
| Full | 5,808 / 0 / 140 / 0 | 5,825 / 0 / 141 / 0 |

Totals increase by exactly 18 cases: 17 executable passes and the P1.8 external
coverage marker for MP8, PR #35. There are 0 TODO cases.
START quick/full took 78.731/268.819 seconds. The original MP10 run took
82.407/292.448 seconds with P1.8 pending. After the MP8 coverage marker update,
quick/full were rerun: 89.120/277.020 seconds.
Acceptance cases: 17 passed, 0 failed, 1 external-coverage skip, 0 TODO. The existing footprint regression
also passes after the harness addition (1 passed, 0 failed), and the new flag
completes both synthetic trials with numeric reports. No existing tests changed.

Save preservation uses fresh temporary copies, process workers and an identical
fixed store clock to exclude clock-driven retention. Main, START without routing
and START with routing each preserve the exact 766,384-byte state through open,
close, reopen and close: SHA-256
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`
before and after every open. Each retains 2 members and 23,939 saved tasks;
there are 0 hash differences across configurations. A separate wall-clock check
at all three configurations adds 1 field, removes 0 fields and changes 0 existing
leaves; it produces 766,470 bytes at every configuration. This also occurs on
main and is why the exact-hash comparison fixes the store clock. No source files
in the private checkout were modified.

Footprint results and their method are recorded in the Multiplayer lane section
of `docs/perf/picker-footprint.md`. The current-duo comparisons above have
0 differences and pass the multiplayer gate. Service recovery is covered by\nP1.8 against MP8; the historical engine gate belongs to the engine lane. These measurements do not authorize
opening public sign-up.

### MP10 regression attribution follow-up

The footprint section now includes a balanced repeat with the option absent
and present, branch bisection probes and paired parent/child confirmation.
Values are median [minimum–maximum], three primary runs per configuration.

| Metric | Main | START option absent | START option present |
| --- | --- | --- | --- |
| Cold task wall time, ms | 5777.4 [5745.0–5907.9] | 5791.4 [5742.7–5994.3] | 5926.5 [5883.5–5986.3] |
| Cold combined CPU, core-seconds | 10.498 [10.329–10.558] | 10.345 [10.242–10.981] | 10.905 [10.702–10.951] |
| First full state CPU, core-seconds | 0.670 [0.583–0.686] | 0.782 [0.611–0.836] | 0.756 [0.498–0.854] |

The cold-CPU bisection candidate is MP5
`c19cef6d738f547875fa1dea1d4d96ff7227d8f8`: its parent measures
10.679 [10.642–10.823] core-seconds and MP5 measures
11.054 [10.935–11.453], a 3.51% increase with separated ranges.
The initial suspect was `createPickerContext()` resource lifetime/GC; the
requested cold-function follow-up below does not substantiate that hypothesis. Both task branches and the independent
MP6 branch were probed; non-monotonic branch results prevent assigning every
combined-lane difference solely to MP5.

The harness `rollPool` interval sends already-prepared pools in the first full
state envelope. It records 0 calculator CPU in every follow-up interval.
Profiles point to GC and the shared `fieldJSON()` serializer; the relevant
serializer/caller source has 0 differences between main and START. State-response
CPU rises in both option settings, with overlapping ranges, so no introducing
commit is established for that metric. Full probe/profile evidence and wider
scouting ranges remain in `docs/perf/picker-footprint.md`.

All previously staged test/harness changes are retained. The final rerun counts
above include the P1.8 external-coverage skip replacing its earlier TODO.
The checker results cover 1 current state and 36 comparisons per option, with
0 differences and 0 errors. They do not claim historical engine coverage.
Service recovery is covered by P1.8 against MP8. Cold-CPU attribution is an
investigation target, with no app fix.


### MP10 cold-function follow-up and final disposition

The confirmed multiplayer corpus is the current duo snapshot. Both direct
main-versus-START checker modes **pass**: 1 state, 36 comparisons, 0 differences,
0 errors each. The 414-state corpus belongs to the engine lane, run as 48 Cloud
shards before its first merge to main. Service recovery honoring MP5 tombstones
was then covered by MP8, PR #35, before it merged; P1.8 now executes (below).

Native `--cpu-prof` runs compare MP5 `c19cef6` with immediate parent `d6ef7f1`,
three fresh process-mode runs per tree in alternating pair order. All six stay
under the 3,500 MiB RSS guard and produce 54 isolate profiles. Only cold task
HTTP intervals are compared. The full method, top-function self-time table,
resource counters and proposal are in `docs/perf/picker-footprint.md`.

| Instrumented cold metric, median [minimum–maximum], 3 runs | Parent | MP5 |
| --- | --- | --- |
| Combined CPU, core-seconds | 10.855 [10.835–11.297] | 11.424 [11.018–11.429] |
| HTTP main-thread CPU, core-seconds | 0.514 [0.510–0.541] | 0.560 [0.491–0.607] |
| Idle HTTP heap, MiB | 421.772 [420.176–421.777] | 421.783 [420.218–421.814] |

The combined median rises 5.24% under profiling, with overlapping ranges.
The largest relevant positive named-function deltas are `serializedState()`
(+15.0 ms) and engine `check()` (+14.8 ms), both with overlapping ranges.
`createCompiledTaskEngine()` (+9.2 ms) and `ownItemOrigin()` (+10.6 ms)
have separated sampled ranges but unchanged source; they do not explain the
earlier 0.375 core-second gap. Native helper-thread CPU is outside these
isolate profiles. No changed MP5 function is proven to cause +3.51%.

Cold-window ledger reads are 0 across all 12 evaluations; both trees have
1 active HTTP timer and 7 process event listeners. Heap/GC ranges overlap,
with only 11,920 bytes median idle-heap difference. The earlier retained-context
hypothesis is withdrawn. State-response `fieldJSON()`/GC remains unattributed;
no further work on it is included.

The concrete unapplied proposal targets `gzipSavedTaskResult()` in
`app/picker-context-http.mjs` and `rememberTaskResultWork()` / full-task HTTP
sending in `app/picker-context.mjs`: compress the shared bulk JSON prefix once,
then finish separate tiny retained/live metadata suffixes using the existing
single-member gzip prefix/CRC technique. Preserve metadata, negotiation,
retention limits and deletion fences. Three isolated helper calibrations give
0.048120 [0.046407–0.048252] core-seconds per bulk pass. The gross saving target is about
0.048 core-seconds per eligible full response before prefix/CRC overhead; this is a measured cost bound for a
proposal, not an implemented saving or proof of the MP5 regression's cause.
It does not promise to recover the whole +3.51%.

Final suites: quick 2,678 passed / 0 failed / 69 skipped / 0 TODO; full
5,825 / 0 / 141 / 0. No application bug was found. No app/checker code changed
after START. The remaining performance item is the proposal above.
Recommendation: **MERGE-CANDIDATE**.

### MP10 P1.8 executable follow-up

After MP8 (PR #35) merged, the P1.8 skip became an executable case in
`phase1-acceptance.test.mjs`. Accounts A and B sign in through synthetic OAuth and
write notes. A stopped `captureServiceCheckpoint` is taken while the real server
is closed. A is then deleted over HTTP. With the server closed again,
`restoreServiceStopped` restores into empty roots against the live tombstone
ledger (1 picker excluded, 0 credentials restored). The recovered roots are
swapped in and the real server reopens. A's picker stays deleted with no
directory, A's session and plugin key return 401, and A's next sign-in gets a
fresh empty default.

B's account, membership, default picker and revision come back unchanged. The
service format excludes provider identities by design. MP15 supplies the operator
claim-code path: the stopped operator issues B a private link; B first signs in
to an empty default, then claims the restored account through synthetic OAuth.
The empty account is retired and purged, its external tombstone survives, and B
opens the restored picker at the same revision. A then signs in fresh and gets
a new empty default. The test no longer relinks identities directly.

Acceptance cases: 18 passed, 0 failed, 0 skipped, 0 TODO
(`phase1-acceptance.test.mjs` plus `phase1-acceptance-crash.test.mjs`, Node 24.19.0).## MP11 calculator cap

START is `0ef05ce1ac44cee956e4ce64b8295ce62d879479`, the multiplayer lane
with MP7 merged. `createServer({ multiPicker: { ... , maxCalculators: 2 } })`
now owns one calculator pool for its entire lifetime. `maxCalculators` defaults
to **2** and must be a positive safe integer. All contexts borrow picker-keyed
handles from the same scheduler. Foreground, prediction/Sandbox/side work,
death estimates, duo peer work and rule preparation all consume this one cap.
Starting, executing, idle and retiring physical calculators count towards it;
replacement allocation waits for a proven exit. The operator diagnostics add
`calculators: { limit, resident, peak, active, retiring, waiting }`; use these
physical counts instead of summing logical lane residency. A rejected termination keeps
its slot counted until an exit event proves it is gone.

### Where the four calculators came from

At START, `createTaskScheduler` eagerly creates its foreground `createWorkerLane`
and lazily creates prediction, death and duo lanes. Each lane's `launch` calls
its own worker factory. `ProcessWorker` forks a relay host, which creates one
calculator thread; native thread mode creates that thread directly. A host and
its one calculator thread represent one calculator, not two independent engines.
The contexts already share this scheduler through `runtime.taskWorker` and
`forPicker`; opening a context does **not** create another scheduler. EN6's
**2 contexts / 4 calculators** row activates all four lanes through HTTP. It is
four lane-owned calculators shared by two contexts, not two calculators per
context. At eight contexts the same four independent compiled heaps were still
possible, exceeding EN6's memory allowance with headroom.

`app/tasks/calculator-pool.mjs` now owns physical workers. Logical lanes borrow
one calculator from their group for a single job and return it on completion.
Every picker shares the foreground calculator; the remaining slots are shared
by prediction, death and duo lanes. At cap **1**, that one calculator serves
both groups. At larger caps, advisory jobs queue within their shared group
instead of occupying the foreground calculator: keeping advisory graphs off it
preserves interactive cache residency and the measured memory envelope. A group
waiting for compilation cannot block another group with a ready calculator.
No individual picker owns or reserves a calculator. Advisory lanes share
calculators rather than each compiling another engine. The existing
one-active-job-per-logical-lane topology remains; this does not introduce two
parallel foreground lanes or claim EN6's raw foreground-pool throughput.
The pool uses the primary worker factory and one dataset input; lane-specific
factory hooks retain their original behavior in uncapped mode.

### Priority, isolation and lifecycle

Pool admission selects interactive work before queued warming, then rotates
among picker identities. Each logical lane also prioritizes interactive work
across picker identities, with MP7 round-robin sharing within that priority.
MP7's cross-lane outstanding-job and waiter limits remain shared. An interactive
request can displace its own queued warming in another lane when its admission
share is full. No new queue or unbounded snapshot backlog is added by the pool:
its waiting records refer to the existing bounded lane queues.

An unrequested active warm-up yields when it blocks interactive work in its
logical lane, or when interactive work in another lane waits at a full pool.
Retirement cancels that producer and preserves other queued jobs and their
original deadlines. The physical slot remains occupied until exit; a calculator
already serving request/reuse waiters finishes under the established watchdog.
A cold replacement can therefore add compilation latency after preemption.
Context close/eviction still fences its own handle and cancels only its MP3
jobs. Closing a context does not close the shared pool. Server shutdown closes
the logical lanes and then drains all physical calculators.

Physical request IDs are unique across lanes; replies restore the logical ID
only for the owning lease and matching picker. Progress and prepared-prediction
messages retain the lease until the final response. Cancel IDs are translated
only within that lease; supersession remains picker-scoped. Existing lane
caches, unlock reuse, result views, deadlines and byte budgets remain in place.
Snapshot hints belong to each physical calculator and follow its two-entry LRU
across all logical lanes. Borrowing a different calculator uses its own hints
and resends a body when needed; context cancellation invalidates that picker
on every calculator while preserving the other LRU positions. Hints retain only
keys, transport kind and revision, with no additional private state bodies.
A logical lane seeing a picker for the first time does not invalidate another
lane's valid physical hints.

The option-absent server retains START's native factories, lane counts,
admission, snapshot references and dispatch path. `app/server.mjs` only passes
the cap when `multiPicker` is present. Neither `app/tasks/worker.mjs` nor
`docs/calculator-protocol.md` changes; no shared protocol pull request is needed.
The implementation changes are in the scheduler, the new pool and that small
server wiring. The new `tests/picker-calculator-cap.test.mjs` is classified
quick/open-f2p in `scripts/test-selection.mjs`.

### Context default and capacity boundary

The default is **7 open contexts**, including the shared picker, with a default
cap of **2 calculators**. START's numeric default was already eight; it lacked
an enforceable calculator premise. EN6's four-calculator operating point
supported only two grown contexts with the requested headroom. MP11 increases
that measured operating envelope while replacing the unsupported numeric
default with a value validated against the additional mixed workload below.
An explicit `maxOpenContexts: 8` remains available.

EN6 follow-up 2 suggested eight grown contexts with two calculators for its
quiescent-advisory newcomer schedule. MP11's primary rerun at eight also meets
that schedule's latency and memory bounds. A separate eight-context pilot
issues an owned death request alongside a shared prediction before the normal
lane activations and newcomer. Its cold/warm p95 is **5.78 / 0.854 s**, sampled
peak **6702.8 MiB**, but summed kernel HWM **7104.7 MiB**, above the **6963.2 MiB**
allowance after the 2 GiB OS reserve and 20% total-RAM headroom. This is one
pilot, not a population percentile estimate. The same mixed schedule at seven
passes all three runs; its detailed median/range table follows.

This stronger workload determines the default, rather than applying EN6's
conditional eight-context recommendation to every advisory arrival pattern.
Eight contexts are still covered by the cap/isolation tests and the primary
measurement matrix. More simultaneous saves, full-view requests, rule diversity
and eviction/reopening churn need separate capacity measurements. Extra CPU
does not justify raising the calculator cap: EN6's four-picker raw cold p95
increased from **3.91 s** with two to **4.42 / 5.27 s** with three/four.

### Validation and measurements

The new tests exercise eight simultaneously open temporary contexts with steady
work in every logical lane at caps **1, 2 and 3**, interactive priority within
and across lanes, active warming retirement, cross-lane per-picker admission,
context close and share reuse, delayed exit/crash recovery, stale and wrong-picker
replies, snapshot reassignment, rejected termination, bootstrap abort/retry,
native process/thread execution, and the unchanged uncapped four-lane topology.
All synthetic member names use `Player x`.

The private duo gate uses fresh temporary copies, process workers, fixed
`performance.now()` in HTTP/calculator processes and identical store timestamps.
For both option settings it compares START with MP11 across the established
**10** raw responses without normalization: **0 response differences, 0 size
differences and 0 rewritten-save differences**. Every run returns **83,606,063
bytes**; digest-array SHA-256 is
`24f0f05b68d1020a8bbc53b18ee5203891b7d3808f8f73907ad063191ee232c5`.
Rewritten state: **766,384 bytes**, SHA-256
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
No private input is added to the public checkout.

#### MP11 capacity reproduction and results

The unmodified EN6 server harness runs from its own worktree, pointed at START
or the MP11 checkout. Harness SHA-256:
`7216d6d7bba81e8bcae1d0be8d369085654852350ac2c5028b750097e4fdd541`.
Final changed-app inventory: **4** sorted `{file,bytes,sha256}` records
(router, server, pool and scheduler), compact-JSON SHA-256
`f9c07837ef284d2fc5c0cd5eb7e365f66b4b8b0a0c88bd51b4bab4a73e037018`.
No application source is edited in the EN6 worktree.

`node /tmp/en6/scripts/perf/multi-picker-server-capacity.mjs --runtime CHECKOUT
--packs "$PACKS" --defaults "$DEFAULTS" --source "$SOURCE" --output /tmp/report.json
--counts 2,4,8 --shape grown --runs 3 --lanes 4 --direct-last`

EN6 predates MP7's sign-in budget. A temporary Node load adapter changes only
the harness's synthetic registration quota to **10,000 per client**, equally
for both versions. A first setup-only **429** was excluded before any timing.
The option-absent control uses **1** context and **3** runs: setup still
provisions through routing, then the timed application's `multiPicker` is
undefined. The mixed schedule adds an owned death request alongside a shared
prediction before the ordinary four lane activations and newcomer. The default
is measured at **7** contexts under that schedule; the **8**-context mixed pilot
above is separate. Neither adapter changes application quotas or calculator code.

Node **24.19.0**, Linux x86-64, **4-core** cgroup quota, **16 GiB** experiment
memory. Fresh processes and temporary save copies per trial; warm OS file
caches; no forced GC. Three repetitions per reported cell, rotating the primary
context counts. Final accepted timing trials do not overlap tests or other
benchmarks. Two baseline trials near a focused regression run were discarded
and replaced with quiet runs of the same configuration. Exploratory candidate
runs and pilots do not enter the comparison medians.

N includes the shared context. Primary cases explicitly allow **8** resident
contexts, open/evaluate N−1, activate every logical lane, then time the last
context's first task request directly. Quiescent advisory activation finishes
before that newcomer. Cold/warm columns summarize each trial's nearest-rank
p95, then report the median **[minimum–maximum]** across three trials. Cold has
only N samples per trial, so these p95s are empirical maxima, not population
tail guarantees. RSS covers server plus calculator descendants, sampled every
**50 ms** with process discovery every **250 ms**. Peak is the maximum over
opening/evaluation/repeat phases. HWM adds server and calculator kernel maxima,
a conservative bound whose individual peaks need not coincide. Shutdown is
outside these request-phase measurements.

Source/dataset/defaults/pack-pin and normalized-size difference counts are **0**
across the comparison reports. Each grown input has **2** members, a logical
backup of **70,394,809 bytes**, and a compact normalized state of **765,849 bytes**;
seed normalization has **0** logical hash differences. Whole-backup hashes vary
because ordinary startup adds a daily progress observation timestamp. That
metadata is excluded by the calculator snapshot builder; it must not be treated
as a changed task input. The private compatibility gate fixes the clock and
compares all raw response bytes independently.

Dataset digest:
`3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`.
Defaults SHA-256:
`1ab931d329b526e55b6283ed401b929023e7153e3e1dcd04604d85de8b4fabf0`.
The **2** pack hashes are
`5e23b5dfb1bf1ed265e7ef1d6edbc9067a820418baa5781e6f3c13864e781da1` and
`dfe952dccd200dbad0fde4082cc823f7f2c40a7e9edf9a43898acace7092d077`.

| Contexts | Version | Cold p95 ms | Warm p95 ms | Whole-tree peak MiB | HWM sum MiB | Calculator peak |
| ---: | --- | --- | --- | --- | --- | ---: |
| 2 | START | 8196.8 [7892.6–8271.3] | 21.2 [13.1–29.0] | 6308.2 [6275.7–6343.4] | 6624.8 [6603.9–6683.0] | 4 |
| 2 | MP11 | 8138.4 [8035.4–8151.2] | 14.2 [14.1–52.6] | 4510.7 [4292.7–4554.8] | 4840.9 [4665.0–4895.1] | 2 |
| 4 | START | 5727.3 [5579.1–5781.8] | 25.8 [23.0–71.3] | 7084.0 [7064.7–7165.0] | 7405.7 [7392.0–7489.4] | 4 |
| 4 | MP11 | 5782.5 [5719.7–5851.4] | 20.2 [16.8–210.9] | 5177.2 [5142.6–5185.2] | 5520.7 [5456.9–5530.6] | 2 |
| 8 | START | 6000.1 [5822.4–7298.8] | 862.0 [707.4–918.3] | 8439.3 [8395.3–8478.1] | 8760.8 [8722.0–8812.1] | 4 |
| 8 | MP11 | 6139.9 [6103.8–6315.0] | 728.7 [691.3–876.8] | 6513.6 [6460.3–6517.9] | 6860.4 [6835.6–6870.6] | 2 |

Option absent, the unchanged shared picker with all four lanes activated:

| Version | Cold p95 ms | Warm p95 ms | Whole-tree peak MiB | HWM sum MiB | Calculator peak |
| --- | --- | --- | --- | --- | ---: |
| START | 1532.0 [1423.8–1567.9] | 8.1 [6.8–9.0] | 5218.2 [5135.7–5254.8] | 5730.5 [5585.4–5792.8] | 4 |
| MP11 | 1504.1 [1501.4–1571.9] | 6.8 [6.7–7.0] | 5214.8 [5210.0–5249.0] | 5693.7 [5688.3–5737.8] | 4 |

The option-absent cold medians differ by **-1.8%** with overlapping ranges;
median peak RSS differs by **-0.07%**. The warm difference is
**1.3 ms**. These are within observed process/GC noise;
there is no claim of a live-path speedup. Both versions have one foreground
calculator during opening and four after lane activation.

Default configuration under the stronger mixed schedule:

| Contexts / cap | Cold p95 ms | Warm p95 ms | Whole-tree peak MiB | HWM sum MiB |
| --- | --- | --- | --- | --- |
| 7 / 2 | 5919.3 [5911.7–6228.3] | 812.1 [626.2–865.9] | 6311.6 [6289.0–6343.3] | 6726.7 [6667.1–6774.0] |

Every enabled primary and mixed trial has one physical calculator during
opening and two after advisory activation, with **0** observations above the
cap. The allocator peak diagnostics and delayed/rejected-termination tests
cover allocation transitions that periodic RSS sampling could miss. The mixed
maximum HWM is **6774.0 MiB**, retaining **189.2 MiB** inside the specified
headroom allowance. Raising the default or cap needs another workload-specific
measurement. At the default cap, advisory calculations serialize through one
shared calculator; an interactive foreground list remains independent of that
queue. Preempting unrequested work can require a cold replacement. These limits
do not promise latency for seven simultaneous saves or arbitrary rule variants.

#### MP11 final suite gate

Both required suites ran in order after the final application changes.

| Suite | START passed / failed / skipped | MP11 passed / failed / skipped | START / MP11 seconds |
| --- | --- | --- | --- |
| Quick | 2,646 / 0 / 68 | 2,667 / 0 / 68 | 77.87 / 79.94 |
| Full | 5,793 / 0 / 140 | 5,814 / 0 / 140 | 267.36 / 271.61 |

Exactly **21** new tests, all quick/open-f2p. The final focused cap file passes
**21 / 21**, with **0** failures. Existing tests and assertions changed: **0**;
new skips: **0**. No failing-file or START-failure reproductions were needed
for either final suite. Source checkout modifications in the private inputs:
**0**. Private named-value/path matches in added public text: **0**.

No calculator protocol, worker message-handler, engine, core, web, integration,
changelog, roadmap or operator-tool files change. There is no protocol pull
request dependency. The seven-context default is deliberately based on the
mixed workload's conservative RSS bound; an eight-context override retains
the documented quiescent-workload qualification.

### MP11 PR #37 review round 1

Review START is `8c590b744ab1e15dc539f78265d0f17cb5c500e5`. Two fixes
stay behind the existing calculator-pool option:

- Advisory allocation counts starting, resident and retiring advisory slots
  against **cap minus one** when the cap exceeds one. Foreground can allocate
  its reserved capacity after its idle calculator exits. Candidate selection
  considers a group that can allocate as well as groups with ready workers, so
  an advisory request waiting on its busy group cannot block foreground startup.
  Idle advisory calculators cannot consume foreground's final available slot.
  Cap one still shares one calculator across all lanes; interactive priority
  and the existing warm-work preemption remain in place.
- Lane admission enforces `maxQueue` while a ready pooled lane waits for a
  physical lease. Overflow keeps the existing **429** error, retry metadata and
  rejected counter; coalesced waiters continue sharing an admitted job. The
  uncapped admission condition retains its START behavior.

Regression evidence: the foreground-idle test fails on START because advisory
allocation takes the vacated slot (**2** residents instead of **1**). Both queue
regressions fail before the scheduler fix with depth **6** against limit **2**;
with the fix they retain depth **2** and record **4** refusals, exercising both
fair and legacy error shapes. The added uncapped test passes on START and the
final code with identical expected response bytes, immediate foreground/queued
job dispatch, independent lane workers and START's active-plus-queue bound.
The tests use mock timers and synthetic workers without platform-specific
process or filesystem assumptions. Windows execution was not available here.

Final validation, one focused file at a time followed by one quick-suite run:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Calculator cap file | 25 | 0 | 0 |
| Existing scheduler file | 43 | 0 | 0 |
| Existing server limit file | 9 | 0 | 0 |
| START uncapped tests, including the added byte assertion | 2 | 0 | 0 |
| Quick suite, 81.11 seconds | 2,689 | 0 | 68 |

There are **4** added tests in the already classified cap file. No existing
assertions or skips change. The full suite was not rerun for this review round,
following the requested short-run gate. No server, worker protocol, engine or
live-duo configuration changes are needed.

One fresh-process **8**-context grown-save trial per version repeats EN6's
four-lane, direct-last schedule from its separate worktree, after all tests
finish. It uses the same harness hash and synthetic registration-only adapter
as above, temporary save copies, process workers and the default cap **2**.
All other application limits remain at their defaults. Node **24.19.0**,
**4** core quota and **16 GiB** memory; no concurrent calculator experiment.

| Measurement | Review START | Review fixes |
| --- | ---: | ---: |
| Cold p95, ms | 6,237.8 | 6,100.4 |
| Warm p95, ms | 978.9 | 754.1 |
| Peak sampled process-tree RSS, MiB | 6,641.9 | 6,537.1 |
| Conservative summed kernel HWM, MiB | 6,996.2 | 6,974.6 |
| Calculators: opened / pre-newcomer / evaluated / repeated | 1 / 2 / 2 / 2 | 1 / 2 / 2 / 2 |
| Maximum observed calculators | 2 | 2 |

These are single trials, not repeated-run medians or evidence of a latency
improvement. Neither trial exercises the old foreground-idle deadlock or
queue overflow, which the synthetic regressions cover directly. Both HWM
bounds remain slightly above the existing **6,963.2 MiB** eight-context
allowance; the seven-context default and eight-context qualification remain
unchanged. Stable source, dataset, defaults, pack-pin, member-count and size
difference counts are **0**. Whole-shape hash differences: **1**, with the
startup-observation qualification already documented above.

The two changed application files have sorted `{file,bytes,sha256}` inventory
hashes, compact JSON SHA-256: START
`0cc0239102a2e44b003289c669adc7b3c297ba4d04f3848c15a99c317416fdae`,
final `b4bae7d696d336136e2ea070fa79c3b3a3a57c50c83bc54b18c7d4035ec8e243`.

## MP13 audit fixes

MP12A-2: Only the legacy picker can create or use the operator’s original-sync client. Owned contexts refuse preview and sync commands, including after whole-save restore, member restore or original-format import. Source bindings remain gameplay metadata and grant no integration authority. The legacy integration path is unchanged.

MP12A-1: Both dataset-runtime routes in owned contexts return an empty default roster, a neutral administrator label and disabled original-sync controls. Browser startup takes the actual roster from authenticated state; a synthetic startup regression checks selection and rendering with these defaults. Legacy contexts retain the exact serialized dataset payload, with and without multiPicker.

MP12B-1: Account-deletion confirmation requests a random, opaque token from the authenticated session preflight, bound to that account and session for five minutes. The browser submits it with the deletion, and the serialized deletion queue checks and consumes it before any tombstone or purge. Missing, mismatched, expired or reused tokens return 409 without deleting anything. The existing 403 selector fence between distinct owned pickers and all option-absent routes remain intact. Tokens are memory-only, bounded to 1,000 pending sessions and disappear on restart.

Final validation on Node 24.19.0: quick **2,686 passed / 0 failed / 68 skipped /
0 TODO** (258.41 seconds), then full **5,834 / 0 / 140 / 0** (869.19 seconds).
The first quick run had 2,656 passes and 30 failures: headless context fixtures
omit the optional browser payload, and account-deletion crash fixtures needed
the new confirmation body. Headless construction is preserved; the context
regression now requires source-sync refusal, and every crash checkpoint still
runs with a valid confirmation. Those focused files subsequently passed
69 checks with zero failures. A prematurely started full run was interrupted
at 67 passed / 0 failed / 7 skipped / 1 cancelled before the final runs above.
Existing MP6/MP9, option-absent, legacy source-sync and byte-payload checks pass.
No new test file was added; the existing audit files retain their classifications.

The duo compatibility checker reports **0 response, size and rewritten-save differences** with multiPicker absent and present (20 paired reads). Every run returns 83,606,131 bytes, and every saved state remains 766,384 bytes with the source-state SHA-256 unchanged. The private checkout has 0 changed files. Three alternating synthetic footprint pairs, medians/ranges, sampled peak RSS and the single-sample duo timings are recorded in [picker-footprint.md](perf/picker-footprint.md#mp13-audit-fixes-footprint-and-duo-compatibility). The reusable comparison scripts live under `scripts/perf/`. Public sign-up remains off; audit part C is untouched.

## MP8 operator tooling

START: `18aaca0ac37198c5ebed819ffa554a72dc1a3aca`. The feature remains
opt-in. Set the same `multiPicker.registryDir`, `pickerRoot` and `tombstoneDir`
in the pinned Linux release config and the operator config. Roots, legacy,
control, scratch, backup and snapshot spool paths must be absolute and disjoint.
`runtime.mjs` passes the option only to the live application, never to an
individual offline recovery probe. No environment or public sign-up default changes.

### Checkpoint and export boundary

`app/storage/snapshot.mjs` adds `withDirectoryBarriers`; the original
`withStoreWrite`, `snapshotStore` and every single-directory caller are unchanged.
Service capture uses that additive API for one picker at a time. Accepted writes
finish before that picker's copy; its queued writes resume after copying/syncing.
A drain deadline abandons capture, not an accepted write.

`app/picker-router-checkpoint.mjs` briefly queues new routed requests while
the registry/account checkpoint and picker roster are captured in the registry
mutation queue. It does not wait for HTTP responses or context residency work. There is no copying, hashing, syncing or pack reading under this
global barrier. Requests resume before the first picker copy, and unrelated
stores keep accepting writes. Global barrier and request-wait durations are
reported by private health and the snapshot result. The router diff contains
only coordinator construction, admission/release and its exported handle.
The registry adds the read-only `withRecoveryCheckpoint(callback)` and
`registryRecoveryDocument(document)` without changing schema or mutations.

The roster fixes which IDs can enter the backup. Gameplay has a separate
consistent cut for each picker, rather than one simultaneous cross-picker cut.
At final reconciliation, newly created IDs stay excluded and IDs no longer
active are recorded `absent` in the manifest; their staged files are removed.
Restore projects those absent scopes out of the checkpoint and never initializes
replacement games for them. This manifest projection reads no tombstone ledger;
MP5 remains responsible for authoritative tombstone decisions during recovery.

Behind the option, `/api/operator/service-snapshot` requires the real private
listener policy and a master Bearer credential. Public listeners, forwarding
markers, cookies and ordinary owner sessions cannot grant access. The response
contains only operation ID, hold duration and picker count. The private spool
is under the existing snapshot namespace and `online.mjs` takes ownership and
copies it to operator scratch before publication. There is no stopped fallback.

The new `picker-service-recovery-v1` format carries a sanitized registry/account
checkpoint, picker IDs and kinds, each dataset binding, initialized status,
gameplay data, and verified selected pack manifests **and their declared payloads**.
It includes pinned selection/profile/add-on manifests. It copies only reviewed
gameplay roots: state, static, history, backups, plugin achievement IDs and plugin
item evidence. It excludes provider identities, capabilities, sign-in/account
sidecars, invitations, sessions, plugin keys, access tokens, overlay links,
feedback and usage. Unknown sidecars are excluded by default. Registry account
IDs and explicit memberships survive; authentication must be established anew
through the MP15 private operator claim-code command. No credentials are imported from a service backup.
The live tombstone ledger is never included or replaced.

The existing single-directory `picker-recovery-v1` backup still includes the
entire raw store, including credential-bearing sidecars and the access token.
That pre-existing behavior and its tests are unchanged. Such raw recoveries must
remain private; this task adds no transfer or off-host operation.

Capture streams and synchronizes files under each picker's barrier, then hashes
and publishes the service manifest after all picker barriers have released.
`globalBarrierMs` and request-wait counts/max/total describe the short admission
barrier; `pickerBarriers[].heldMs` records each individual copy's hold (including
writer drain). The compatible `heldMs` field now means global barrier duration.
The 30-second deadlines bound registry checkpoint completion and individual
writer drain. A very large copy can still
exceed the operator's 120-second HTTP timeout and leave private spool evidence;
inspect it before retrying. Service retention prunes only verified `service-*`
recoveries and never legacy recoveries.

### Health and recovery

Private health retains legacy store revision, schema and worker diagnostics and
adds registry readiness, total/active picker counts, resident/dormant context
counts and checkpoint state. Counting reads only the registry and router map.
Startup and warm-up still prepare legacy only; no health request prepares dormant
members or stores. Public health cannot expose the service report.

`scripts/linux/service-recovery.mjs` verifies the service manifest, then stages,
probes/migrates and installs one picker at a time. Each real probe is a child
process that exits before the next starts. Restored member IDs must match the
registry. It records backup/release/target identity, installation intent, file
hashes and completed/quarantined results in a synced progress journal. A resume
requires the same backup, release and targets; completed files are rechecked.
Store and binding renames can resume independently. Partial recovery blocks
the privileged `start-check.mjs` gate before the writer starts. The unprivileged
`serve.mjs` does not read private operator recovery state.

An incompatible **owned** picker moves to private operator quarantine and gets
an unbound, nonempty placeholder at its registered directory. That prevents MP4
from initializing an empty replacement under the same ID. Other owned restores
continue. Reports contain only IDs, status, file counts and byte sizes. Explicit
quarantine release rechecks compatibility, membership and stopped ownership.

Legacy is never quarantined. Before changing any live target, restore probes
and migrates the shared duo on an operator scratch copy, even if an owned picker
appears first in the manifest. Incompatibility refuses the whole restore with
`LEGACY_RESTORE_INCOMPATIBLE`, a clear operator message and nonzero CLI exit.
Existing legacy, picker and registry data remain untouched. Successful preflight
is journaled and reused on resume. No startup or session code change is needed.

**MP5 integration call site:** `reconcileServiceRecoveryTombstones` in
`service-recovery.mjs` now uses MP5's registry reconciliation and exported purge
function. It opens a disposable sanitized checkpoint registry against the target's
live external ledger. It never copies a ledger from a backup, creates a missing
live ledger, or infers tombstones from checkpoint lifecycle rows. Planning precedes
even the legacy probe; its returned `apply` operation runs MP5 cleanup only after
legacy compatibility and destination checks succeed. Both restore and quarantine
release use this adapter. The MP5 integration test is enabled; see MP8b below.
Recovery publishes the effective checkpoint and skips all excluded picker IDs.

### Commands and files

`operator.mjs list`, `inspect PICKER_ID` and `quarantine-release PICKER_ID` are
private CLI operations under the existing operator configuration. Restore and
release require a deliberately stopped service. Online backup uses the service
endpoint; `backup --stopped` explicitly drains/stops all writers first. Ownership
checks cover both registry locks and every registered picker, including legacy.
`service-lock.mjs` reuses the existing kernel-backed registry-lock primitive in a
separate operator-control namespace. A killed local operator can resume recovery
once its PID is provably dead; live, foreign and unverifiable owner evidence is
refused. Health skips a busy operator. The single-picker lock path is unchanged.

Service deploy uses sequential stopped compatibility probes for all initialized,
unquarantined pickers and retains pointer CAS, receipt checks and reverse probes.
Changing dataset/pack/profile/add-on pins in-place is explicitly refused; install
compatible pinned inputs and use the sequential recovery path for those changes.
The single-source rehearsal script refuses service configuration before touching
its registry; a complete service rehearsal must independently copy and repin
every service root, including the external ledger.
Process control and raw snapshots acquire no public or owner route.

Changed operator files: `runtime.mjs`, `serve.mjs`, `operator.mjs`, `online.mjs`,
`start-check.mjs`, the safety guard in `rehearse.mjs`, and the new
`service-checkpoint.mjs`, `service-recovery.mjs`, `service-operator.mjs` and
`service-lock.mjs`. `tests/linux-multi-picker.test.mjs` is classified quick and
uses only synthetic temporary roots and neutral players.

### Initial MP8 validation and private gate

Node 24.19.0. Required suites ran quick, then full. No existing tests were edited,
weakened or skipped. The 16 new cases comprise 15 active tests and one explicitly
pending MP5 integration case. All original Linux operator/snapshot cases pass.
Focused operator/snapshot validation: 48 passed, zero failed, one existing
platform skip and one pending MP5 case.

| Suite | START passed / failed / skipped / pending | MP8 passed / failed / skipped / pending |
| --- | --- | --- |
| Quick | 2,553 / 0 / 68 / 0 | 2,568 / 0 / 68 / 1 |
| Full | 5,700 / 0 / 140 / 0 | 5,715 / 0 / 140 / 1 |

START quick/full durations: 72.62/275.92 seconds. MP8: 83.16/276.23 seconds.
START's first full attempt had one unrelated transient plugin-sidecar failure;
that unchanged file passed 21/0 alone, and the complete START repeat passed
5,700/0. The MP8 full run passed without a repeat.

The private gate uses fresh temporary copies, process calculators and the option
absent. Three paired runs compare the same 10 raw successful response bodies:
full/play state, history, browser plugin status, full/play tasks per member and
native plugin status per member. Fixed save timestamps and a fixed
`performance.now()` preload in HTTP/calculator processes make timing metadata
deterministic; no response fields are removed or normalized. Every comparison
has **zero differences**, including all 30 paired response comparisons.

Before/after response-checkpoint SHA-256 (the JSON array of response hash/size
records):
`dc66077f41df0edfcd2dacf24b9c6737b09fbce89d9b699aea198e489835bccb`.
Response bytes per run: **83,606,063**.

Three backup/restore trials per revision use the real offline app decoder and
portable import validation on disposable probe copies. The original raw store
is backed up and restored without startup writes. The identity is SHA-256 of the
encoded sorted file inventory plus the sibling binding's SHA-256. Before and
after, at both revisions:
`2cd41ad09957f03e3c7cfc42b75c043485c6f179d2af49ba64aac592213479b4`.
There are **431 store files** (plus one sibling binding), **82,007,295 store bytes**,
and **zero differences**. Recovery payload size: **197,282,005 bytes**. The private
source checkout has **zero changed files**.

Values below are median [minimum–maximum], three fresh-process samples per side.
Route trials alternate START/MP8 after both suites complete. Backup START trials
preceded the MP8 trials and overlapped some synthetic verification work; these
are validation timings, not evidence of a performance improvement. The gate's
offline probes run sequentially in the gate process; RSS includes that process
and its live calculator children, sampled every 20 ms. These numbers do not
measure production service-restore memory or establish a many-picker capacity.

| Measurement | START | MP8 |
| --- | --- | --- |
| Route gate elapsed, ms | 18,719.79 [18,268.89–18,766.39] | 18,375.23 [17,932.58–18,750.48] |
| Backup, ms | 12,738.15 [12,403.49–12,757.93] | 12,018.80 [11,654.63–12,178.22] |
| Restore, ms | 12,161.05 [12,105.59–13,030.93] | 11,817.05 [11,629.70–13,371.72] |
| Route gate sampled peak RSS, MiB | 3,265.47 [3,227.79–3,299.61] | 3,252.09 [3,227.88–3,255.55] |
| Backup/restore gate sampled peak RSS, MiB | 2,943.58 [2,911.02–3,055.84] | 2,367.80 [2,327.54–3,117.77] |

The initial measurements above predate the follow-up below. MP5 remains a
pending integration hook. Legacy refusal and short global admission are now
implemented as described above. Same-dataset service deployment is supported, while pack
changes and a full service rehearsal remain explicit recovery/integration work.
The live single-duo option remains absent by default.

### MP8 follow-up: legacy refusal and short global checkpoints

The staged MP8 implementation is retained. This follow-up closes the legacy and
admission gaps without changing startup or session behavior:

- `service-recovery.mjs` probes legacy on scratch before changing any live
  restore target, regardless of manifest order. Incompatibility throws
  `LEGACY_RESTORE_INCOMPATIBLE`; `operator.mjs` prints the fixed operator message
  and exits nonzero. Legacy never enters quarantine. Owned failures still do.
- `picker-router-checkpoint.mjs` now holds global admission only for the registry
  queue's metadata checkpoint and bounded binding-receipt reads. It waits for
  neither unrelated HTTP responses nor context acquisition/eviction. Requests
  queued at this gate resume before data copying. Their wait count/max/total are
  cumulative since process startup; `globalBarrierMs` describes the latest gate.
- `service-checkpoint.mjs` fixes the initial roster, copies and syncs one picker
  under its own barrier, then reconciles against a fresh registry checkpoint.
  New IDs stay out. Deleted IDs are marked `absent` and their copied data is
  removed. Restore projects these absent scopes out without recreating them.
- The router's context-open call uses the same per-picker barrier: cold
  initialization cannot write into a directory while that directory is copied.
- The existing MP5 stub, its named call site and pending test remain. There is no
  MP5 import or independent tombstone implementation. The integrating task must
  wire that hook before production service recovery/release.

Two additional tests bring the file to 18 cases: 17 active and one pending MP5
case. They prove legacy refusal leaves live registry/picker/legacy inventories
unchanged, and exercise creation after the roster plus deletion during and after
copying. The race test also proves unrelated admission/writes continue while a
copy is held, and cold initialization of that picker waits. The coordinator test
proves unrelated HTTP/residency work cannot extend the global gate. No START
case was changed, weakened or skipped.

Focused Linux/snapshot/routing/recovery: **86 passed, zero failed**, one existing
platform skip and one pending MP5 case. The required final suites ran quick,
then full against the final implementation:

| Suite | START passed / failed / skipped / pending | Final MP8 passed / failed / skipped / pending |
| --- | --- | --- |
| Quick | 2,553 / 0 / 68 / 0 | 2,570 / 0 / 68 / 1 |
| Full | 5,700 / 0 / 140 / 0 | 5,717 / 0 / 140 / 1 |

Final quick/full durations: **85.72/274.58 seconds**. Each pass count is START
plus 17 active tests; skip counts are unchanged. Both final suites passed on
their first run after the metadata-only global gate change.

#### Three-run barrier probe

Each trial opens a fresh temporary duo copy with process calculators and the
option enabled. An accepted HTTP write is held to race the snapshot with
concurrent read traffic, without a fixed sleep. Metadata and unrelated session
reads complete while that write is still held; only the duo's own copy barrier
waits for it. Thus the per-picker duration includes the accepted write draining
and the durable copy. Clocks are normal. One context is open in every trial.
The number of requests observed waiting is **13 [12–16]**.

Values are median [minimum–maximum], three fresh-process trials, with no test
suite competing. RSS samples include HTTP and calculator child processes every
20 ms; these workload measurements do not establish service capacity.

| Measurement | Final MP8 |
| --- | --- |
| Global metadata barrier, ms | 5.95 [5.60–6.46] |
| Maximum request wait for global barrier, ms | 4.19 [3.76–4.55] |
| Total request wait for global barrier, ms | 22.53 [22.19–27.46] |
| Duo per-picker barrier, ms | 2,292.25 [2,218.44–2,324.07] |
| Sampled HTTP + calculator peak RSS, MiB | 2,334.29 [2,201.60–2,359.50] |

#### Repeated option-absent private gate

Three fresh-copy START/final route pairs use the same fixed clocks and 10 raw
successful bodies described above. **30 paired comparisons, zero differences.**
Before/after response-checkpoint SHA-256 remains
`dc66077f41df0edfcd2dacf24b9c6737b09fbce89d9b699aea198e489835bccb`;
response size per run is **83,606,063 bytes**. No fields are normalized away.

Three backup/restore trials per side use fresh copies and real offline
app/portable-import validation, sequentially after the suites. Before and after:
**431 store files** plus one sibling binding, **82,007,295 store bytes**, and
**zero differences**. The sorted-inventory-plus-binding identity remains
`2cd41ad09957f03e3c7cfc42b75c043485c6f179d2af49ba64aac592213479b4`.
Recovery payload size is **197,282,442 bytes**. The private checkout has **zero
changed files**. Each row is median [minimum–maximum] from three fresh processes:

| Measurement | START | Final MP8 |
| --- | --- | --- |
| Route gate elapsed, ms | 18,422.05 [18,386.96–18,455.99] | 18,477.12 [18,165.30–18,830.42] |
| Backup, ms | 12,308.40 [12,229.61–12,721.84] | 12,332.83 [12,140.43–12,345.20] |
| Restore, ms | 11,950.13 [11,904.23–12,210.92] | 12,078.26 [11,984.08–12,229.39] |
| Route sampled peak RSS, MiB | 3,270.74 [3,172.24–3,285.56] | 3,236.37 [3,235.95–3,302.46] |
| Backup/restore sampled peak RSS, MiB | 3,069.36 [2,899.18–3,084.46] | 2,861.46 [2,351.67–3,023.98] |

The earlier raw-backup timings used fixed store timestamps too; these repeated
backup trials use normal store timestamps on disposable probe copies. The raw
backed-up/restored source remains byte-identical. These validation timings make
no performance-improvement claim. The operator's 120-second total snapshot
request timeout still applies to a sufficiently large service, although copying
no longer holds global admission. MP5 wiring is the intentionally deferred
integration item; the legacy quarantine/startup gap is closed by refusal.


### MP8b: MP5 recovery integration

START2 is `ead0a6313210ca979ebe54f5e8afb07d4ffdf84d`, the integrated
operator branch containing MP4 through MP6. No router, startup, session, gameplay,
registry, or single-picker operator path changes are needed. The integrated router
retains both `checkpoint.open(id, () => openContext(id))` and the lifecycle recheck.

`scripts/linux/service-recovery.mjs` replaces the fail-closed stub with MP5's
`openRegistry`, `registry.reconcileTombstones()` and the exported
`reconcileTombstones` from `app/storage/tombstones.mjs`. Registry copies contain
only the sanitized checkpoint. Planning uses disposable picker directories, so
MP1 provisioning cannot touch live games before legacy compatibility passes. Both
planning and application open the **target's existing ledger in place**, under
MP1's writer lock and validation; an absent or invalid ledger refuses recovery.
The adapter preserves the live ledger and existing issuer sidecars' original
UID/GID across atomic writes, including failure paths, so a root-run operator
does not strand the service behind root-owned mode-0600 files. Reserved-directory
provisioning completes only in planning scratch; application cannot provision
unrelated live directories while refusing quarantine release.
No backup ledger is read or installed. MP5 determines blocked picker IDs and
retired accounts; the returned checkpoint removes retired account grants and
all provider identities and capabilities. A legacy tombstone refuses recovery.

After preflight and empty-destination checks, the adapter reopens the checkpoint
against that same authoritative ledger, calls MP5's idempotent purge, and obtains
an updated checkpoint. Owned directories and bindings are removed by MP5. The
legacy issuer's existing invitation/session and account sidecars are revoked using
their storage APIs, without opening gameplay or starting a calculator. Missing
issuer files stay missing. Account cleanup also covers older retired-account
records without runtime progress markers. Other accounts' sessions and shared
operator capabilities retain their scope. No credential from a service backup is
copied or reintroduced. An incompatible legacy never reaches this application
phase, so refusal leaves live registry, picker and legacy data untouched.

Restore repeats reconciliation on every resume before any store probe, excludes
newly tombstoned IDs even if a previous attempt installed their directories, and
removes their migration scratch. Its checkpoint publication journals old/new
hashes so an interrupted publication or a newer ledger decision can safely update
only its own prior checkpoint. Quarantine release applies the same MP5 cleanup and
refuses an excluded scope before probing or installing anything. Retained private
quarantine payloads remain subject to operator retention and cannot override a
ledger decision. Keep the service stopped throughout both operations.

`scripts/linux/rehearse.mjs` still refuses multi-picker configuration. Its interface
accepts one source store and copies only that store and binding; it does not copy
and repin the registry, all owned directories and external ledger. Lifting that
refusal would risk opening or purging source service roots. The refusal now names
that concrete limitation. Single-picker rehearsals are unchanged.

`tests/linux-multi-picker.test.mjs` enables the pending MP5 integration case and
adds post-backup deletion, interrupted recovery with a newer tombstone, and
invalid-ledger/fabricated-lifecycle cases. The integration case also checks stale
issuer revocation and repeat quarantine-release refusal, while the existing
successful quarantine-release and incompatible-legacy tests now use the real
adapter. Synthetic no-op injection remains only in unrelated isolated tests.
The existing file remains classified in the quick suite. There are no new test
files and no pending MP5 tests.

The recovery tests now pin a separate temporary release from tracked public files.
Other full-suite tests create temporary directories directly in the checkout;
using that changing checkout as an immutable release made the existing MP8
release checks fail intermittently. The pinned copy keeps those same release
identity checks enabled and runs the real recovery decoder from immutable inputs.
Ledger-owner preservation is checked during real reconciliation; root-run CI also
uses a ledger owned by a different UID/GID to exercise atomic replacement.

#### MP8b validation

| Suite | START2 total / skipped / pending | Final total / passed / failed / skipped / pending |
| --- | --- | --- |
| Quick | 2,697 / 68 / 1 | 2,700 / 2,632 / 0 / 68 / 0 |
| Full | 5,916 / 140 / 1 | 5,919 / 5,779 / 0 / 140 / 0 |

The delta is three new cases plus the enabled MP5 integration case; no tests
were skipped or weakened. Final quick/full durations were 118.01/307.45 seconds.
The final focused recovery file passed 21/0 with no skips or pending cases;
focused Linux operator/snapshot verification also passed 54/0 with one existing
platform skip before the final ownership extension. The complete final suites
cover that extension. Existing single-picker Linux test files, all app files,
and test selection are unchanged from START2. No real-save or pack measurement
was needed for this script-only integration; the MP8 private measurements above
remain historical and are not claimed as new MP8b runs.

START2 quick passed 2,628/0. Its untouched full run passed 5,773 with two
intermittent Linux failures; the untouched Linux file then passed 17/0 with its
one pending case. The first integration full run similarly had one intermittent
failure, and its standalone file rerun passed 21/0. The immutable release fixture
above addresses the concurrent checkout-writing interaction; final quick and
full both pass without retries. No socket/parent-death exception was needed.


### MP8 review round 4

START is `31ca5e0c8e1856f7c2e9a120b03b41637a472816`, including MP7 and
the Windows/merge fixes. The unprivileged `serve.mjs` no longer traverses the
root-only operator control directory. The privileged `start-check.mjs` gate
continues to refuse incomplete service recovery before systemd starts the writer.

A service backup now **refuses any active quarantined picker** under that
picker's storage barrier. This choice retains the existing backup format and
prevents capture from silently dropping the initialization fence and the payload
stored in private operator quarantine. Release the quarantine with compatible
inputs or explicitly delete the owned picker before retrying a backup. Online
capture checks only the live initialization marker, without reading root-only
operator data. A failed capture removes its incomplete spool and preserves the
quarantine payload and fence. Deleted scopes still reconcile as absent.

Install intent now records a private staging directory beside the legacy or owned
picker destination. The migrated store and binding are copied and synced there
before either atomic rename; the journal remains under controlDir. Partial copies
can restart from the retained migration source, store/binding rename windows
resume by recorded hashes, and older intents whose source or store rename is
still in controlDir can be upgraded. Completed and excluded scopes remove their
sibling staging directory. Destination free-space checks include the extra copy.
The same installer is used by quarantine release, so controlDir and picker roots
may reside on separate filesystems. Windows file sync handles remain writable.

Owned acquisition waits for its per-picker checkpoint gate before entering the
shared residency queue. Residency, closed state and lifecycle are checked again
inside that queue, and the existing post-factory lifecycle check remains. Thus a
checkpointed dormant picker cannot stall unrelated resident handlers. MP7's cold
lease is still acquired before waiting or calling the factory; a refusal calls no
factory. The MP7 router fixture's pickerDirectory mapping is retained unchanged.

Stopped-service ownership checks now acquire both registry-root locks through
MP1's kernel-backed lockRegistry proof, reclaiming only provably dead local
owners before checking stores. Live kernel owners, foreign hosts and malformed
owner records still refuse; partial acquisition is released on every failure.
A regression kills a child during real MP5 reconciliation, then verifies that
retry can clear its stale ledger lock while live and foreign owners remain
untouched. No custom PID inference or weakened store-lock handling was added.

Round-4 validation used one test file at a time, then the quick suite once.
Each of the five new regressions failed before its corresponding fix and passed
afterward. The complete multi-picker file passed 26/0; the unchanged MP7 limits
file passed 12/0, including refusal before factory invocation; the existing
Linux operator file passed 23/0. These focused files total 61 passed, no failures,
skips or pending cases. Quick passed 2,690 with zero failures, 68 existing skips
and zero pending cases (2,758 total), in 102.37 seconds. No full-suite run was
requested for this review round. Tests simulate permission denial and cross-device
rename on every platform rather than depending on POSIX file modes. Native
Windows execution was not available in this environment.

The START Windows syncRecoveryTree r+ fix, JSON plugin-key fixture, and MP7
pickerDirectory fixture are retained. OPS1's scripts/linux/files.mjs and
scripts/linux/operator.mjs were not edited. No new test file needed classification.

### MP8 crash points

Hooks run immediately **before** the labelled mutation. A fault at hook k leaves
steps 1 through k-1 durable; tests also fault at the next hook to exercise the
state immediately after each step. Labels are stable and may repeat per picker,
file or journal save. This table describes a deliberately stopped service with
unchanged backup, release, targets and external tombstone ledger. MP5 owns the
idempotent deletion steps inside reconciliation; this table covers its operator
call boundary, not a second implementation of MP5.

`R` means **resumes to the same result** after validating journal identities and
on-disk digests. `F` means **refuses: OPERATOR_ACTION_REQUIRED**, followed by the
named manual step. Keep the service stopped for every manual step. Never delete
an uncertain payload: move it aside for inspection, or restore the exact bytes
from the verified backup. Source backups are never modified. Partial staging
copies may coexist with their verified source; final results retain one payload
location per eligible picker. Tombstoned payloads remain in the backup only,
under MP5's existing deletion contract.

Tests below refer to `tests/linux-service-crash.test.mjs`: C = capture sweep,
S = restore sweep, Q = release sweep, O = ownership sweep, A = ambiguous evidence.
The sweeps learn the hook count, fault at every call on fresh tiny fixtures,
retry, perform the named manual step on refusal, and compare final registry,
picker/binding identities, quarantine records and journal phase. A final
successful retry covers death immediately after the last mutation.

#### Service backup capture

| Step label | Disk immediately after step | Same-input rerun | Test |
| --- | --- | --- | --- |
| `capture.spool` | Spool parent exists. | R | C |
| `capture.target` | Snapshot directory exists without completion. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.pickers` | Empty picker container exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.gameplay` | A partial or complete gameplay copy exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.binding` | Copied binding exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.inputs` | Input container exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.input-directory` | Input pack directory exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.input-copy` | Copied input or pack payload exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.absent-store` | A newly absent picker copy has been removed. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.absent-binding` | Its copied binding has been removed. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.registry` | Sanitized registry copy exists. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.manifest` | Verified manifest exists, completion receipt absent. | F: Move the snapshot aside after checking source stores; then rerun. | C |
| `capture.complete` | Verified snapshot and completion receipt exist. | R | C |
| `capture.failed-cleanup` | Failed capture spool removed; live sources intact. | R | C |

#### Shared MP5 operator adapter (planning, then application)

MP5's existing storage API owns its internal registry/ledger writes and purge
ordering. Hooks below cover the operator's own durable steps and each storage
API call boundary; they do not instrument writes inside app/storage. Planning
scratch contains sanitized metadata and disposable directories, never gameplay.

| Step label | Disk immediately after step | Same-input rerun | Test |
| --- | --- | --- | --- |
| `reconcile.control` | Operator control parent exists. | R | S, Q |
| `reconcile.scratch` | Disposable reconciliation directory exists. | R | S, Q |
| `reconcile.directories` | Scratch registry/picker directories or live picker parent exist. | R | S, Q |
| `reconcile.checkpoint` | Sanitized scratch checkpoint exists. | R | S, Q |
| `reconcile.registry` | MP5 registry API reconciles scratch metadata against the live ledger. | R | S, Q |
| `reconcile.purge` | MP5 purge API has applied its idempotent exclusions. | R | S, Q |
| `reconcile.ownership` | Original ledger/issuer ownership restored where needed. | R | S, Q |
| `reconcile.cleanup` | Disposable reconciliation scratch removed. | R | S, Q |

#### Service restore: preparation, per-picker install and quarantine, publication

| Step label | Disk immediately after step | Same-input rerun | Test |
| --- | --- | --- | --- |
| `restore.archive` | Completed journal archived; targets must pass empty checks. | R | S |
| `restore.directories` | Control/work or target parent directories exist. | R | S |
| `restore.legacy-reset` | Disposable unjournaled legacy probe stage removed. | R | S |
| `restore.legacy-copy` | Legacy probe store or binding copied. | R | S |
| `restore.reconcile` | MP5 applied authoritative exclusions and purge. | R | S |
| `restore.prepared` | Prepared journal records verified legacy preflight. | R | S |
| `restore.stage-reset` | Disposable pending owned stage removed. | R | S |
| `restore.stage-directory` | Pending owned stage directory exists. | R | S |
| `restore.stage-copy` | Owned probe store or binding copied. | R | S |
| `install.stage-directory` | Sibling stage exists, but journal may not name it yet. | F: Move the unjournaled sibling stage aside after checking target and source; then rerun. | S, Q, A |
| `install.stage-intent` | Journal names sibling stage and expected digests. | R | S, Q |
| `install.reset-store` | Incomplete sibling store removed; verified source retained. | R | S, Q |
| `install.reset-binding` | Incomplete sibling binding removed; verified source retained. | R | S, Q |
| `install.copy-store` | Partial or complete sibling store copied from retained migration source. | R: staged file subset digests are checked against retained source. | S, Q, A |
| `install.copy-binding` | Sibling binding copied from retained source. | R | S, Q |
| `install.ready` | Journal records ready sibling store and binding digests. | R | S, Q |
| `install.remove-target` | Empty destination removed; ready sibling retained. | R | S, Q |
| `install.rename-store` | Store at target; binding still staged. | R | S, Q |
| `install.rename-binding` | Store and binding at target. | R | S, Q |
| `install.restored` | Journal records restored status after digest verification. | R | S, Q |
| `install.cleanup` | Sibling stage removed after installed bytes verified or MP5 exclusion proved. | R | S, Q |
| `quarantine.directory` | Quarantine parent exists. | R | S |
| `quarantine.intent` | Journal records quarantining status and payload digests. | R | S |
| `quarantine.rename-store` | Store moved into quarantine; binding may remain staged. | R | S, A |
| `quarantine.rename-binding` | Quarantine store and binding installed. | R | S |
| `quarantine.placeholder-directory` | Empty fenced destination directory exists. | R | S |
| `quarantine.placeholder` | Initialization fence records picker ID. | R | S |
| `quarantine.record` | Quarantine record exists. | R | S |
| `quarantine.complete` | Journal records quarantined status after verification. | R | S |
| `restore.stage-cleanup` | Migration stage removed after install/quarantine/exclusion. | R | S |
| `restore.excluded` | Journal records authoritative tombstone exclusion. | R | S |
| `restore.registry-intent` | Journal records old and new registry digests. | R | S |
| `restore.registry-publish` | Effective registry atomically published. | R | S |
| `restore.complete` | Journal phase is complete. | R | S |

#### Quarantine release

The install steps above also apply between `release.remove-marker` and
`release.installed`. They are tested by both sweeps and counted once in the
shared install table.

| Step label | Disk immediately after step | Same-input rerun | Test |
| --- | --- | --- | --- |
| `release.reconcile` | MP5 exclusions applied before any installation. | R | Q |
| `release.stage-directory` | Release stage directory exists. | R | Q |
| `release.reset-store` | Unjournaled probe store removed; quarantine retained. | R | Q |
| `release.reset-binding` | Unjournaled binding removed; quarantine retained. | R | Q |
| `release.reset-portable` | Disposable probe output removed. | R | Q |
| `release.copy-store` | Probe store copied from quarantine. | R | Q |
| `release.copy-binding` | Probe binding copied. | R | Q |
| `release.intent` | Journal records installing status and checked digests. | R | Q |
| `release.remove-marker` | Fence removed; installing journal and payloads retained. | R | Q |
| `release.installed` | Journal records installed status after target verification. | R | Q, A |
| `release.remove-quarantine` | Quarantine payload removed; installed bytes verified. | R | Q |
| `release.remove-binding` | Quarantine binding removed. | R | Q |
| `release.remove-record` | Quarantine record removed; installed journal retained. | R | Q |
| `release.stage-cleanup` | One disposable probe file removed. | R | Q |
| `release.complete` | Journal records released status. | R | Q |

A release journal records whether its probe changed the staged store or binding.
A release digest mismatch names the existing target, binding and staging paths
to preserve, then gives literal placeholder, quarantine-record and pending
release-journal JSON so the same release copies and probes quarantine again.
It leaves an intact quarantine source in place; if cleanup consumed either
endpoint, preserve any survivor and restore both from an offline quarantine copy
matching the printed pre-probe digests first. Without those retained bytes,
manual source recovery is required; a verified service backup is not promised
to contain the release journal's post-probe bytes. Service-restore repairs are
unchanged.

#### Ownership repair

| Step label | Disk immediately after step | Same-input rerun | Test |
| --- | --- | --- | --- |
| `ownership.change` | One inventoried file, root, legacy binding or ledger has the requested UID/GID. | R: repeats the idempotent chown to the same UID/GID. | O |

#### Evidence that cannot be proved

These are refusal conditions rather than additional durable steps. They apply
at any table row: a partial sibling copy whose files fail source digest checks (move the sibling store aside after checking migration source), a changed installed/staged digest, a missing migration source
before destination readiness, both/neither quarantine rename endpoints, an
unrecognized registry digest, or a release cleanup journal whose target no longer
matches. Each throws `OPERATOR_ACTION_REQUIRED` and names the affected path and
manual step. Restore exact expected bytes from the verified backup or retained
source and rerun; move an unexpected endpoint aside for inspection first. Never
infer successful installation from status alone. A tests these refusals and the
manual recovery. A conflicting released journal with a new quarantine record requires moving the journal aside after checking quarantine. Quarantine cleanup also refuses an unverified retained payload, naming its path to move aside after checking the installed target. Older quarantine rows without payload digests require moving their quarantine store and binding aside for inspection and setting only that picker row to pending, preserving other completed rows. The older missing-source upgrade is deliberately removed;
normal split store/binding rename resume and completed-journal archival remain
because their identities can be verified.

#### Rerun decisions

- Removed the older missing-source install upgrade: a target digest alone does
  not establish the missing migration source and binding intent. Repopulate the
  source explicitly before retrying.
- Removed automatic reset of a released journal when a quarantine record exists:
  that combination cannot establish a new quarantine generation. Archive the
  journal only after inspecting quarantine.
- Removed status-only acceptance of quarantined payloads and release cleanup:
  both installed and retained bytes must match recorded digests before cleanup.
  Older quarantine rows without digests require the named per-picker restart.
- Removed deletion of unexplained nonempty sibling stages or changed partial
  copies: move them aside for inspection instead of discarding their bytes.
- Kept partial-copy restart only when the retained source digest matches and
  every staged entry is an exact subset of its inventory. Split store/binding
  renames and cleanup resume only with the expected on-disk hashes.
- Kept pending probe-stage rebuild from the verified backup, and completed
  capture retry only after verifying its manifest. These stages are disposable
  copies; neither path replaces the source backup.
- Kept registry publication using the journal's old/new digest set, and archival
  of a completed restore journal followed by fresh empty-target checks. Neither
  accepts an unrelated live registry or overwrites a populated target.
- Kept MP5 reconciliation from the authoritative external ledger and repeated
  ownership repair to the same UID/GID: these existing APIs are idempotent.

#### Crash-point validation

START: `5139bdbee36d8d8f3d620bfb5396ed4a29a07937`, Node 24.19.0.
The specification was staged before code changes. There are **72 unique table
rows: 60 resume and 12 refuse**. Capture has 14 (3/11); the shared MP5 adapter
has 8 (8/0); restore/install/quarantine/publication has 34 (33/1); release has
15 (15/0); ownership has 1 (1/0). Counts in parentheses are resume/refuse.
Including shared rows, restore covers 42 (41/1) and release covers 35 (34/1).

The small fixtures contain at most three pickers and use a stub probe. Counting
runs discover 23 capture calls, 7 failed-capture calls, 63 restore calls,
69 completed-journal archive calls, 50 release calls and 9 ownership calls:
**221 injected faults**, plus successful completed-operation retries. Every
unique table label is checked against the labels actually swept. Ambiguous
state tests additionally exercise manual recovery without deleting uncertain
bytes. The verified backup and source bytes remain unchanged; each eligible
picker has exactly one final payload location. Authoritatively tombstoned
payloads remain in the backup only.

| Validation | Passed | Failed | Skipped | Duration, seconds |
| --- | ---: | ---: | ---: | ---: |
| New crash file | 17 | 0 | 1 | 37.68 |
| Existing Linux multi-picker file | 30 | 0 | 0 | 89.01 |
| Existing Linux operator file | 23 | 0 | 0 | 9.99 |
| Quick | 2,758 | 0 | 69 | 226.84 |
| Full | 5,906 | 0 | 141 | 581.27 |

The new skip is `ownership native chown to another UID/GID`, which requires
root; this process runs without root. The ownership fault sweep still runs
with an injected chown function and checks every expected path and UID/GID.
Focused files ran individually, followed by quick and full. An environment
reconnect interrupted the first full attempt before totals; that partial run
reported one failure in the unchanged chunk-planning UI file. Its standalone
rerun passed 10/0, and the complete full rerun above passed without failures.
No assertions were weakened or existing tests skipped. No private inputs or
performance benchmark were needed for this service-only task. MP5's internal
storage mutations remain behind its existing API boundary; the new hooks cover
the operator-owned steps and those API calls, as specified in the table.

## MP15 account reclaim

START: `5fce2f3984a4fdf1ea3ab4fe8935733045e3c478`. Public sign-up remains off
and all reclaim behavior requires `multiPicker`; the option-absent sign-in and
shared duo routes retain their existing behavior.

Run `node scripts/linux/operator.mjs relink-code ACCOUNT_ID` using the pinned
service configuration. An active service issues through the private master
Bearer endpoint `/api/operator/relink-code`. A deliberately stopped service
checks writer ownership, opens the registry, issues, closes and repairs service
ownership. Maintenance evidence blocks issuance. No provider subject is supplied.
The command returns and prints one private claim link. Relay it privately;
application diagnostics and tests never log the link or its code.

Codes contain 256 random bits, expire after 24 hours, and are stored only as
SHA-256 hashes with account ID and expiry in the registry. Reissuing replaces
that account's previous code. Service recovery checkpoints exclude codes, provider identities and capabilities.
A raw stopped checkpoint with pending retirement intent refuses with 409. Restart
the service to replay the intent into the external ledger before taking a backup;
the checkpoint must never silently discard that intent.
Missing, retired, identity-linked or unavailable target accounts cannot receive
codes. Used, expired, revoked or malformed codes and a target that gained an
identity return 409 without registry or ledger writes.

The claim link sets short-lived server-side preauth state and redirects to a
clean address. The existing sign-in page, CSS, provider buttons, OAuth state,
PKCE, cookie binding, provider validation and unauthenticated rate budget apply.
No provider receives the claim code. Cancellation preserves claim state for a
retry. Success states that the account was reclaimed and links to the picker;
refusal explains that the operator can supply a new link.

An unlinked identity attaches to the target. An identity with only its empty
default can move: the router holds that picker's mutation queue, checks revision
0, then the registry checks exactly one owner membership and no other owned
pickers. Gameplay committed or queued first causes 409 and preserves the code.
Other memberships, additional owned pickers and unavailable sources also refuse.
The registry rechecks the code, target and identity owner inside its own queue.

One atomic registry replacement moves the identity, consumes the code and
records retirement intent. The committed source is fenced synchronously. The
same retirement helper as normal account deletion writes the external ledger;
normal MP5 reconciliation revokes sessions and capabilities, drains the picker,
purges data and marks deletion complete. Startup finishes any committed intent
before provisioning or exposing accounts. Retired IDs and issued picker IDs
remain in the external ledger and cannot be reused. A crash before the registry
commit retains the old identity and code; a crash after it retains the new
identity and consumed code, with retirement resumed on restart. A failed
post-commit operation requires registry restart.

Synthetic coverage lives in `account-reclaim.test.mjs` (classified quick),
`phase1-acceptance.test.mjs` and `linux-multi-picker.test.mjs`. There are process
kills at the four claim boundaries and seven normal deletion boundaries.
P1.8 exercises stopped issuance, a post-restore empty account, OAuth reclaim,
same-revision restored access, source retirement and A's independent fresh picker.
Both configured providers, concurrent claims, cancellation, private operator
admission, rate limits and a gameplay-write race have executable cases.

Final validation on Node 24.21.0 includes the stopped-checkpoint guard:

| Suite | Passed | Failed | Skipped | TODO | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quick | 2,790 | 0 | 67 | 0 | 231.90 |
| Full | 5,938 | 0 | 139 | 0 | 607.35 |

Each suite ran once on the final implementation. Both executed all 18
`account-reclaim.test.mjs` cases, including the 11 process kills and the stopped
checkpoint regression. There were 0 cancelled tests and no failure reruns.
A synthetic interruption had reproduced 1 pending retirement becoming 0 in a
sanitized checkpoint and restoring 1 source account with 0 external retirements.
The final guard refuses that export until registry replay records the retirement
in the external ledger. The focused guard run also passed 18/0/0/0.

Other focused files passed: registry 25/0, Linux multi-picker operator/recovery
35/0, routing 37/0, sign-in server/provider 24/0 and 2/0, acceptance 19/0.
Four direct comparisons of existing sign-in HTML against START had 0 differences.
The existing option-absent and legacy tests passed in both initial suites.

| Refusal | Exact test name |
| --- | --- |
| Missing, retired, deleted-picker or identity-linked issuance target | `MP15 issue refuses missing, retired, deleted-picker and linked accounts` |
| Used, expired, revoked or malformed code | `MP15 used, expired, revoked and malformed codes refuse without registry or ledger writes` |
| Target gained an identity or was retired | `MP15 target gaining an identity or being retired refuses without changes` |
| Source has another membership or owned picker | `MP15 source with another membership or owned picker refuses without changes` |
| Source has committed gameplay | `MP15 identity with gameplay refuses 409 and leaves both accounts and code unchanged` |
| Gameplay write queued before the claim | `MP15 gameplay queued before a claim wins and the claim changes nothing` |
| Concurrent reuse | `MP15 concurrent claims consume once and link exactly one identity` |
| Public or owner attempts to issue | `MP15 public and owner callers cannot issue codes; option-absent reclaim stays unavailable` |
| Exhausted sign-in rate budget | `MP15 accepted and refused claim routes share the sign-in rate limit` |
| Stopped checkpoint would discard pending retirement | `MP15 stopped checkpoint refuses pending retirement until registry replay records the external ledger` |

The final-code duo checker passed with **0 response / 0 size / 0 saved-state
differences** with routing absent and present, across **20** paired reads.
The private checkout had **0** changed files, and the source-state hash stayed
unchanged. Three alternating synthetic footprint pairs, ranges, reported peak
RSS and the final-code checker's single-sample timings are recorded in
[picker-footprint.md](perf/picker-footprint.md#mp15-account-reclaim).
The synthetic footprint pairs preceded the final checkpoint guard; the complete
quick/full suites and both duo modes were subsequently rerun with that guard
included. These measurements do not establish production capacity or a speed
change.

A crash after the registry commit can consume a code before the browser receives
success. Normal sign-in then opens the reclaimed account; registry startup replays
retirement and MP5 finishes purge. The final quick/full suites and both duo
checker modes pass with the checkpoint guard included. The disposition is
**MERGE-CANDIDATE**. Public sign-up remains off.

### MP15 adversarial review

Review START: `fbb1ec3ef92597587a77310f25d12bc49df844ce`.
The entire lane diff and surrounding admission, OAuth, mutation, retirement and
checkpoint paths were inspected. Six new synthetic regressions fail on START.

| Severity | START location | Failing scenario | Regression coverage | Status |
| --- | --- | --- | --- | --- |
| P2 | `app/storage/registry.mjs:293` and `:339` | Another active membership lets a deleting/deleted restored default pass target checks. A claim consumes the code and moves the identity before session selection fails, or provisions an unrelated replacement. | `account-reclaim.test.mjs`: issue/claim unavailable-default cases, including completed deletion; `phase1-acceptance.test.mjs`: deleted-target callback preserves registry and ledger bytes. | Fixed |
| P2 | `app/storage/registry.mjs:355` | Claiming with one of two linked providers retires the source account and silently removes its other identity. That provider subsequently provisions another account. | `account-reclaim.test.mjs`: two-provider source refuses without writes; `phase1-acceptance.test.mjs`: both sign-ins retain the source account and the code remains usable. | Fixed |
| P2 | `scripts/linux/service-operator.mjs:105` | A refused stopped issuance skips ownership repair after opening the registry has replaced mode-0600 files as the operator. A root invocation leaves the service unable to read them. | `linux-multi-picker.test.mjs`: refused issuance repairs registry and ledger ownership, using distinct POSIX IDs under root. | Fixed |

Issuance and claim now require an active, ready owned default on the target.
Accounts with only shared memberships refuse; this path cannot restore the
separate legacy invitation credentials. Sources with multiple linked providers
also refuse without writes rather than splitting their sign-ins. Moving multiple providers together remains a separate recovery
enhancement.
Stopped issuance resolves the service identity before opening the registry and
repairs ownership in a finally block, including issuance and registry-open errors.

Review validation on Node 24.21.0:

| Run | Passed | Failed | Skipped | Seconds |
| --- | ---: | ---: | ---: | ---: |
| Six regressions against exact START application code | 0 | 6 | 0 | 1.60 |
| Six regressions after fixes | 6 | 0 | 0 | 2.00 |
| All three touched test files | 78 | 0 | 0 | 72.15 |
| Quick suite (`npm run test:quick`) | 2,835 | 0 | 68 | 180.64 |
| Full suite (`npm test`) | 5,983 | 0 | 140 | 438.75 |

The touched files cover 21 reclaim tests, 36 Linux operator/recovery tests and
21 acceptance tests. All runs had zero cancelled tests and zero TODOs. No
existing test was weakened or skipped. An initial run of the new multi-provider
HTTP test hit its fixture's sign-in-attempt limit during follow-up logins; the
final test uses the existing higher-budget fixture option to verify both
providers, separately from the existing admission-limit tests.

The final review compatibility check had **0 response / 0 size / 0 saved-state
differences** across **20 paired reads**, with routing absent and present. The
private checkout had **0 changed files** and an unchanged source-state hash.
Three alternating footprint pairs and the compatibility timings are recorded in
[picker-footprint.md](perf/picker-footprint.md#mp15-adversarial-review-fixes).
All three P2 findings are fixed; no P1 findings or unresolved regressions remain.
The review recommendation is **MERGE-CANDIDATE**. Public sign-up remains off.




## MP14 resource-abuse fixes

MP12C2-2: durable deletion fences cancel unfinished request bodies belonging to the deleted picker before draining its accepted work. Picker-local revocation and close waits run outside the global residency queue; closing entries cannot become capacity-eviction victims. Existing accepted-write and crash recovery guarantees still apply.

MP12C2-1: owned import and restore bodies arrive completely under MP7 byte reservations before acquiring the global parser slot. `multiPicker.importBodyIdleMs` defaults to 30,000 ms and accepts a positive integer override; a body with no arriving bytes for that interval receives 408 and releases admission. The timer renews on each chunk and stops at body completion. Concurrent slow owners do not occupy parser slots; a parser/apply slot that is actually busy still returns 503 with Retry-After 5. Option-absent and shared legacy backup handling remain unchanged. While an owned backup body is still arriving, its bytes also count against `multiPicker.importBodyBytesGlobal` (default 384 MiB, kept below `bodyBytesGlobal`). Held uploads from any number of accounts therefore cannot take the last 128 MiB of the global body budget that ordinary writes use: an upload that would exceed the import budget gets 429 before its body is read. Every chunk renews the idle timer, so `multiPicker.importBodyTotalMs` (default 600,000 ms) also ends a trickled body with 408. The router receives an owned backup body after authorization (owner role, origin, one receipt per picker) but before it acquires the picker's context, so slow bodies from many accounts cannot keep every private context slot active; deleting the picker cuts off a body still arriving. Context admission, the process-wide parser slot and parsing follow once the body is complete.
