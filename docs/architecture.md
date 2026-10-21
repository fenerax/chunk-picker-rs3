# Architecture and rule authoring

The authored picker uses native ES modules, Node.js 22 or newer, and Node's test runner without runtime packages. Pure core modules share state and rule behavior between the browser, server, inspector and tests. The private server owns persistence; the browser sends commands and displays derived results.

## Boundaries

| Boundary | Responsibility | Current files |
| --- | --- | --- |
| Reference adapter | Index base chunks, named areas, surface crop, four geometric neighbors and section topology; report malformed references | `app/data/world.mjs` |
| Rule registry/evaluator | Typed settings, candidate/exclusion hooks, reason attribution, sampling and completion policy | `app/core/rules.mjs` |
| Versioned state | Ownership, selections/pending choices, immutable commands, revision checks, backups and restore preview | `app/core/state.mjs` |
| Planning | Declarative rule-profile export/preview/application and isolated hypothetical unlocks | `app/core/planning.mjs` |
| Gameplay migration | Decode saved records, resolve category-qualified task IDs and convert each map owner once | `app/tasks/migration.mjs` |
| Permanent identity | Keep authored task/entity tokens, generated objective identities and historical aliases; provide read-only lookup | `app/data/identity-registry.mjs`, `app/tasks/identity.mjs`, `app/data/legacy-task-history.json` |
| Access and sources | Reachable sections/interiors, gates, manual overrides, resource collections and source backlogs | `app/tasks/access.mjs` |
| Task calculation | Compile requirements; evaluate a fixed point for items, potential training, points and explained availability | `app/tasks/engine.mjs` |
| Task/equipment presentation | Select next goals and alternatives; derive obtainable equipment/loadouts and recommendation tasks | `app/tasks/presentation.mjs`, `app/tasks/equipment.mjs` |
| Calculation worker and scheduler | Keep definitions resident; bound snapshots, deadlines, coalescing, recovery and cache outside the save queue | `app/tasks/worker.mjs`, `app/tasks/scheduler.mjs` |
| Durable store | Exclusive process lock, queued revision checks, synchronized temporary writes, atomic replacement and retained backups | `app/storage/store.mjs` |
| Invitation access | Hashed invite/session sidecar, atomic writes, revocation, local proxy trust, public origins and rate limits | `app/storage/invites.mjs`, `app/security/request.mjs` |
| Private server | Session/invitation access, APIs, authoritative roll pools, worker caching, static assets and revision events | `app/server.mjs` |
| Browser interface | Layered canvas map, member switching, task/search/content controls, notes, rules, teleports, history and recovery | `app/web/main.mjs`, `app/web/map.mjs`, `app/web/index.html`, `app/web/style.css` |
| Inspection/capture | Read-only local inspection/benchmarks and scoped public-map capture into ignored snapshots | `app/cli.mjs`, `app/capture-maps.mjs` |

The application reads the retained definition JSON, task mapping and artwork as reference inputs. It does not load upstream `reference/original-picker/index.js`, `reference/original-picker/worker.js`, jQuery, Lodash or Firebase clients. Named interior `Connect` records describe access; they do not automatically become teleport roll edges.

## Where the main screen code lives

`app/web/main.mjs` creates one screen context, installs the feature callbacks and
starts the screen. Add feature work to the matching module below. Factories take
that explicit context; they import existing collaborators, never another screen
factory. Saved views, request guards and display caches keep one owner and their
existing limits. Register new browser modules in the server's static allow-list.

| Module under `app/web/` | What belongs here |
| --- | --- |
| `screen-context.mjs` | Shared screen values, initial defaults and bounded caches |
| `screen-ui.mjs` | DOM helpers, notices, save status and opt-in performance marks |
| `screen-settings.mjs` | Selected player, preference lookup and applying appearance |
| `screen-commands.mjs` | API calls, queued saves, optimistic chunk changes, RuneMetrics apply and adopting state |
| `screen-roll.mjs` | Roll buttons, offered choices, confirmation and new-task popup |
| `screen-map.mjs` | Saved-screen rendering, map counts, legend and membership overlay |
| `screen-loading.mjs` | Task requests, freshness guards, planning/detail loads and worker readiness |
| `screen-tasks.mjs` | Personal/group task lists, filters, row painting, hovers and backlog forms |
| `screen-task-dialogs.mjs` | Task/item details, sources and alternative methods |
| `screen-chunks.mjs` | Chunk dock, tabs, context menu, contents, access, notes and Preview |
| `screen-dialogs.mjs` | Dialog lifecycle, Search, Teleports, backups and map sources |
| `screen-history.mjs` | History filters, paged reads and on-demand change details |
| `screen-live.mjs` | Server-sent updates and reconnect status |
| `screen-startup.mjs` | Initial data/session loading, map setup and startup order |
| `screen-controls.mjs` | Toolbar/menu listeners, member switching, task-filter controls, shortcuts and responsive sizing |
| `screen-panels.mjs` | Context adapters for existing Settings, Rules, information, Sandbox and other panels |

Browser test harnesses read the actual screen import graph through
`tests/browser-screen-harness.mjs`, retaining their existing collaborator mocks.
New screen modules are discovered through imports rather than individual stubs.

## Permanent task and goal identity

Identity is separate from presentation and objective configuration. The authored registry assigns opaque hexadecimal tokens once; labels, categories, upstream keys and equipment formatting are metadata. A token is never reminted or reused when its definition is renamed, corrected or removed.

| Identity | Form | Meaning |
| --- | --- | --- |
| Ordinary task | `rs3:task:<opaque token>` | One explicitly registered task, independent of category and label spelling. |
| Item, monster, shop or output entity | `rs3:entity:<opaque token>` | One explicitly registered reference entity; its kind and names live in registry metadata. These are picker IDs, not asserted native game IDs. |
| Generated goal | `rs3:goal:<objective kind>:<entity token>[:<entity token>…]` | An objective over permanent source/item entities. Equipment goals use the item; collection goals use objective kind, source and item; Kill X uses the monster. |

Drop rates, quantities, configured kill counts and formatted labels never enter a goal ID. Different quantity/rate rows for the same source/item objective share identity and retain their historical aliases. A correction changes displayed metadata and evaluation rules. A genuinely new objective needs a new objective kind or an explicit identity decision; changing the semantics must not accidentally mint IDs through a formatter. Personal progress and challenge contributions remain separate state fields even when they address the same permanent objective.

`app/data/identity-registry.mjs` is authored data. Task tuples contain `[id, category, rawLabel, previousLabels?]`; an old task label can also retain its old category. Entity tuples contain `[id, kind, name, previousNames?]`. `scripts/update-identities.mjs` retains every existing row and allocates new tokens above the previous maximum. Rename with `--rename-task <existingId> <category> <fullRawLabel>` or `--rename-entity <existingId> <kind> <newName>`; these operations retain the preceding spelling as an alias. An authored definition may carry `PickerId` or `PickerEntityId` to identify an existing row explicitly. Regeneration cannot infer whether an unfamiliar spelling represents a rename or a new objective; supply the existing ID when renaming.

Legacy `userTasks` receive a `rs3:task:custom:<opaque token>` once during import, with the preceding label ID retained in the saved registry. Existing explicit manual IDs such as `custom:<UUID>` already have permanent identity and stay unchanged. Unregistered definitions used by synthetic fixtures retain a clearly unregistered compatibility ID; production definition maintenance must run `node scripts/update-identities.mjs` to mint its task/entity rows. Compact source/equipment bindings decode historical goal labels without enumerating every possible rate or quantity. The maintenance command refreshes these bindings and retains removed sources and older names.

The old `rs3:<category>:<raw label>` IDs and the original `t_*` decoders remain aliases. `buildIdentityIndex(catalogue, {savedRegistry, taskMap, history})` compiles an index once at catalogue/import boundaries. Alias and permanent-ID resolution use indexed lookups instead of scanning task labels during each calculation. Category context disambiguates the 35 reused upstream `t_*` codes; ambiguity without enough context is reported for review. State `identityRegistry` holds materialized entries, aliases and unresolved records, so portable backups retain mappings discovered while playing or importing.

`scripts/updateTasksMap.js` recreates the upstream display-label catalogue without changing archival `reference/original-picker/tasksMap.json`. It writes current labels to `app/data/legacy-task-current.json` and an independent durable ledger to `app/data/legacy-task-history.json`. The ledger's `mappings` retains all label/code associations, `tombstones` lists labels absent from the current catalogue, and `conflicts` retains alternate codes previously assigned to one label. Allocation advances past every historical code; removal never frees a code. History is replaced atomically before the current catalogue, so an interrupted update cannot leave a newly published decoder without its history.

The authenticated read-only route `GET /api/ids/<URL-encoded permanent ID>` returns `{schemaVersion, id, label, kind, category?, aliases}` with current catalogue metadata and retained aliases. Unknown permanent IDs return 404; non-permanent IDs return 400. The pure `buildIdentityIndex().lookup(id)` API supplies the same lookup inside the application. There is no integration write path or game-ID mapping implied by this endpoint.

## State semantics

State schema version 1 contains group rules, members, the minimal task catalogue, history and optional legacy/provenance records. Each member owns independent `unlocked`, `selected`, `pendingRoll`, `blacklisted`, `completedTasks` and `teleports` arrays. Optional maps hold notes, task status/rules, section/area overrides and source backlogs.

Personal stickers use ordered lists of up to six `{id, type, color, text}` records per chunk, with empty lists masking inherited markers. Add, edit by ID, remove by ID and clear commands use the same revision/history/undo boundary; `set-sticker` retains replace-all compatibility. See [stickers.md](stickers.md) for migration, drawing and picker hooks.

`selected` is the saved manual candidate pool; `pendingRoll` holds offered choices. Roll 1 immediately unlocks its result. Roll 2 waits for choosing one, Pick for me, unlocking both, or cancelling. Choosing one returns the other to selected; cancellation returns both. Oversized rolls fail before drawing randomness. Sampling uses cryptographic rejection sampling without replacement.

Accepting a pending choice requires the current world and a known surface chunk, including for random-start offers. Unlocking both validates both destinations before changing ownership. Restored unknown choices remain saved for review; acceptance fails with the offending ID. These checks preserve random-start section seeding and do not reapply ordinary candidate-generation filters to an existing offer.

Own reachable access defines obligations. Shared capability adds only partner sections with a legitimate round trip, without rewriting ownership. One task fixed point tracks own source lineage alongside capability; consumer projections do not reevaluate the whole engine. See [access-logic.md](access-logic.md). `completedTasks` records actual personal game progress; `taskStatus.challengeCompleted` records challenge contributions. Completion policy controls group satisfaction without copying another member's progress. Task evaluation distinguishes potential training/production from observed personal completion.

Usable teleports contribute locked candidate destinations and can establish travel legs to already-unlocked partner territory. They do not unlock a base, expose locked resources or infer account progress. Availability is manually confirmed per member, with personal scope as the default. Group scope is an explicit optional rule; consumable teleports default off.

Neighbor modes are implemented separately:

- `manual` uses saved selections and teleport candidates; enabled neighbor generation adds filtered gray neighbors after ordinary unlocks.
- `frontier` derives geometric neighbors of accessible unlocked bases.
- `accessible` requires a candidate section edge to an accessible whole base or reachable section. It expands nonzero sections, respects personal true/false overrides, keeps F2P filtering and follows the original automatic mode's walkable-filter bypass.

Explicit selections bypass terrain/F2P generation filters. Known-world/surface bounds, existing access, pending choices, personal blacklists and custom exclusions still apply. Section/area `null` commands remove authored overrides and return to automatic access. Source backlog `false` is a durable unmasking override rather than deletion.

## Commands, migration and durable saves

`applyCommand` validates command keys, values, current state and resulting state. It returns a new state with one higher revision and an event. Commands cover rolling/choices, chunk edits, notes, task registration/status/progress/rules, profiles, teleports, section/area access, source backlogs and undo.

Known task-rule values use the shared validators in `app/data/settings.mjs`. Toggles require booleans; `Kill X Amount` requires a positive safe integer. Rare-drop and secondary-primary amounts, plus worker aliases `rareDropNum`, `rareDropThreshold` and `secondaryPrimaryNum`, accept finite probabilities in `(0, 1]`, positive denominators or valid fractional rates. The documented upstream `0`/`1/0` unlimited-rarity sentinel remains supported. Unknown task-rule IDs retain their existing JSON-primitive behavior. `set-task-rule` and profile application through `set-profile` reject invalid values atomically.

State load, backup restore and legacy import preserve malformed primitive task-rule values. Validation derives `provenance.taskRuleDiagnostics` with `invalid-task-rule` records identifying the member or source map, rule, original value and review detail. Restore previews and legacy import warnings surface those records. Diagnostics are recomputed without accumulating duplicates; undo can restore an invalid historical value for review. Task evaluation reports active invalid rules and uses local defaults without rewriting the saved records: `1/1000` for rare drops and `1/1` for primary drop sources. Structural state errors, such as non-primitive member rule values, continue to fail validation; raw malformed legacy records remain in legacy data.

Undo stores typed before/after deltas for changed member fields and dictionary entries, plus individual catalogue rows and their positions. It preserves optional-field absence and checks that the current values match before applying an inverse. Existing full-member/catalogue snapshots remain readable. Undo walks backward across its own markers while revisions increase; historical references are checked against the catalogue at that point. Sparse history avoids copying every task or every personal status for each checkbox.

The durable store enforces `expectedRevision` inside its shared write queue. It retains the prior state as a compressed backup, writes and synchronizes a temporary file, renames it into place, and then acknowledges the committed revision. Failed writes leave the preceding durable state available. One exclusively locked data directory is the authority for both browsers. An OS-owned mutex serializes ownership and is released by the kernel after a crash. Lock and recovery-marker records identify the owning PID, process start time and host. Complete owner records are synchronized before exclusive publication; stale local owners can be recovered, while foreign or uncertain ownership requires operator review. Revision conflicts return current state/pools for review and retry; server-sent revision events notify connected browsers of committed changes.

Import and restore have preview APIs. Application uses the reviewed revision, so another committed edit invalidates that replacement. Replacement starts a new undo boundary; incoming and previous histories/provenance are archived, and the preceding full state remains in retained backups. Portable backups use a versioned `rs3-chunk-picker` envelope. Malformed files fail validation rather than initializing an empty group.

Legacy import preserves allowlisted gameplay under `legacy.maps` while excluding credential fields. Server preparation adds the compiled task/equipment catalogue and performs category-aware migration. Known checks become challenge status, not personal quest evidence. Notes, task rules, backlogs and manual access controls move into personal fields. Unresolved records and mapping provenance remain available through the migration report.

Permanent-ID projection also handles saved completion arrays, task statuses (including notes, backlog, favourites and challenge checks), saved alternatives and historical command/undo references. It leaves raw imported maps intact and archives the complete original task rows, members and history under `provenance.taskIdentityMigration.archives` whenever projection changes them. `conversions` records the original key, permanent key and path. Conflicting alias values retain their original evidence in that provenance; explicit permanent-key values take precedence in the active projection. Unknown or ambiguous keys remain present, gain a review row when needed, and appear in migration/restore warnings. The identity report counts records retained actively or in the archive and reports `lostRecords`; this preservation is distinct from claiming that every old record was unambiguously resolved. See [migration.md](migration.md) for the reversible migration contract.

Migration schema version 2 is separate from state schema version 1. It records converted `(memberId, sourceMapId)` pairs under `legacy.gameplayMigration.migratedMembers`. Conversion is not repeated after a player clears an imported check or restores automatic access. Existing authored values, including explicit false source backlogs, take precedence. Matching saved neighbor settings migrate into group policy; differing settings produce a review warning.

Retention defaults to 1,000 recent history events (a soft limit extended for undo dependencies and pending offers) and 90 days of standalone backups plus older daily checkpoints. History segments are synchronized before their events leave live state; undo and portable backup exports hydrate the complete history. Older intermediate snapshots move into verified compressed packs before their standalone files are removed, preserving every retained revision. Baseline, latest, restore and catalogue-refresh snapshots stay standalone. `createServer({retention})` and CLI `--backup-days` / `--history-entries` configure the policy; `retention: false` disables maintenance. History segments and snapshot packs remain durable dependencies of the data directory.

## Invitations and public proxy boundary

The private master credential remains in `access-token`. Separate invitations and opaque sessions live in the private `invites.json` sidecar, outside gameplay commands, snapshots, portable backups, restore, undo and reference sync. Tokens contain 256 random bits; only SHA-256 token/session digests persist. A join token is accepted only at `/join/<token>` and establishes a session cookie. Sessions expire after 30 days, with at most 32 active sessions per invitation. Revocation immediately rejects every session attached to that invitation.

Invitations permit editing both maps; an administrator capability additionally gates create/list/revoke and private master-link retrieval. The session label is recorded for convenient history attribution. Holding a link is the authentication claim; the label is not verified personal identity. View-only invitations and personal identity verification remain outside the current server.

Master credentials work only through loopback or Tailscale source ranges (`100.64.0.0/10`, `fd7a:115c:a1e0::/48`). Public requests reject master join, bearer and cookie credentials. Forwarded protocol and client address are trusted only from loopback or the server's exact bound Tailscale address. Broad tailnet ranges are private client sources, not trusted proxies; any Funnel marker disables master credentials. `RS3_PUBLIC_ORIGIN` defines the HTTPS origin for generated public invitations and public mutation validation. HTTPS/Funnel sessions use Secure, HttpOnly, SameSite=Lax cookies; authentication responses use no-referrer and no-store, with HSTS on HTTPS. Failed joins and unauthenticated traffic have separate per-client limits.

The server supplies `actor` as a trusted option to `store.command`, `commandSerialized`, `replace` and `previewReplacement`. A History actor retains only `{kind, label, inviteId?}`; commands cannot supply credentials or override attribution. HTTP mutations and revocations share a queue, so a completed revocation rejects subsequent queued writes. `store.close({beforeUnlock})` rejects new gameplay writes immediately while retaining the data-directory lock until authentication writes also drain. Last-use timestamps update on joins and at most once per minute during session activity.

`GET /api/session` exposes current session capabilities. Administrator routes are `GET/POST /api/invites`, `POST /api/invites/:id/revoke` and `GET /api/admin/master-link`. [sharing.md](sharing.md) describes proxy evidence, default limits and operator setup; [operator-guide.md](operator-guide.md) covers gameplay recovery.

## Add a rule

Register metadata and candidate/exclusion hooks in one definition. Hooks are trusted authored functions; imported strings and JSON profiles are never executed. `resolve` rejects unknown group IDs and invalid values.

For example, an authored launch module under `scripts/` can pass its registry to the server:

```js
import { createRuleRegistry, evaluateRollPool } from '../app/core/rules.mjs';
import { createServer } from '../app/server.mjs';

const reviewedChunks = new Set(['12348', '12349']); // Example only.
const registry = createRuleRegistry([{
  id: 'house.excludeWilderness',
  label: 'Exclude configured Wilderness chunks',
  description: 'Exclude the locally reviewed set when enabled.',
  type: 'boolean',
  default: false,
  priority: 60,
  exclude({ value, candidateId }) {
    return value && reviewedChunks.has(candidateId)
      ? 'Excluded by the configured Wilderness house rule.'
      : null;
  },
}]);

// Optional direct evaluation of an already loaded state/world:
// evaluateRollPool(world, state, 'player1', registry);
const application = await createServer({ registry });
await application.listen();
console.log(application.inviteUrl);
```

Definitions support boolean, enum, string and finite-number settings. A `candidates(context)` hook returns an iterable of `{id, detail}` records. An `exclude(context)` hook returns a reason, an array of reasons, or null. Hooks receive resolved settings, their own value, world, state, member, and accessible IDs. Exclusions win over candidate sources; output reasons identify their rule. Priorities and IDs provide deterministic evaluation order.

Custom hooks receive defensive read-only state/world snapshots. Map/Set facades retain lookup, iteration and `instanceof` while rejecting mutation; stored arrays/objects are cloned and frozen. Keep hooks deterministic and test enabled/disabled behavior, conflicts, scope, explanations and input immutability.

`createServer({registry})` uses that registry for authoritative server roll pools, store validation, commands, backups and profile previews. `/api/rules` sends metadata/defaults to the browser, whose controls can edit registered settings. Functions remain on the server; worker/client transfer strips executable hooks. The task worker receives custom metadata for state/profile validation. Roll hooks do not alter its task/source requirement graph.

Direct callers must pass the same registry to state validation, commands, backup import/export and planning operations. Saved custom settings require their definition on a later launch; unknown IDs fail validation. JSON rule profiles already export, preview and atomically replace group settings plus the target member's task-rule overrides. Omitted group IDs revert to registered defaults. See [planning.md](planning.md) for APIs and replacement semantics.

New combinations of existing settings need only a profile. New roll behavior needs a registered hook. New task/source behavior needs an authored resolver with access, migration and explanation tests. A general task/source plugin API with dependency declarations remains future work.

## Calculation and caching

Each worker compiles immutable definitions into permanent tasks, generated goals, access/source indices and normalized requirement/dependency records. Each uncached evaluation runs a fixed point: newly reachable sources, produced items, valid tasks, potential training and points feed later passes. Unsupported hard metadata fails closed with diagnostics. Task presentation and equipment calculation follow eligibility in the same worker.

All four worker lanes (foreground, lazy group peer, death estimates and prediction)
sleep after `RS3_WORKER_IDLE_MS` without interactive use (default 600000 ms).
Requests and their completion reset that lane's idle timer; background predictions
do not. Shutdown stops unrequested warming, waits for any active request to finish,
detaches the worker generation and clears serialized result/snapshot caches.
New requests enter the existing bounded queue and wait for termination before
starting one replacement. Sleeping never consumes the crash restart budget.
The server drops rebuildable task, response and static caches, compressed
reference variants and saved-field JSON memos, retaining raw reference bytes,
saved state, durable sidecar references and stable task identities. SSE remains
open; saves never await a worker.
Fake-clock lifecycle tests cover active/queued work and close/wake races.

Predictions export compact personal, group-peer and group-sidebar projections of
the complete hypothetical calculation. The exact task-input fingerprint covers
the full state except top-level revision, history and provenance, and each
member's selected, pendingRoll and blacklisted roll bookkeeping. Maps, personal
progress, rules, overrides, saved task facts, catalogues, identity resolution and
legacy gameplay remain in the signature. A matching durable saved unlock can
serve those exact bytes without another calculation. By default the existing
32 MiB prediction quota is split into 16 MiB for prediction responses and 16 MiB
for reusable compact projections; likely choices precede the bulk pool. Explicit
Preview refreshes a retained entry's priority and recency. New explicit choices
can replace older explicit choices; equal-priority bulk choices retain the early
pool policy. Origin keys count toward the same byte limit.
Full detail panels hydrate on demand, and unrelated changes miss conservatively.

Foreground task, chunk-planning and explicit Preview admission pauses queued
warming while allowing its active candidate to finish. Preview completion leaves
the same one-second quiet window for an immediate Unlock. Only saved task
completion releases the new-revision foreground gate. At a new save, obsolete
Preview waiters are rejected; an already
active prediction from the immediately preceding revision can remain available
only to saved-result followers. `followSavedPrediction` follows the same member
and races that producer against an ordinary foreground or group-peer evaluation.
The producer wins only after its complete projections prove the exact saved
task-input signature and current revision. A mismatch or producer failure leaves
the fresh calculation available; a second save supersedes the follower. The race
detaches only its losing waiter, preserving other coalesced requests. A selected
member never waits for a queued partner prediction. This reuses complete fixed
points, not incremental calculation or partial task patches.

`Secondary Primary` permits a task carrying that tag to be considered as a primary method. Its starred item inputs must still have primary sources at the configured cutoff, and disabled primary-method categories remain excluded. Outputs from a non-primary recipe cannot seed primary training in later production chains.

The scheduler caches up to eight results per lane by a conservative gameplay fingerprint, member, request type and transport view; predictions also include revision and chunk. Compact and full requests have separate cache keys while sharing the worker's core calculation snapshot. Display preferences, revision, history and storage archive references do not invalidate ordinary task facts. Simultaneous equivalent requests coalesce, and HTTP requesters share one snapshot per revision. Interactive calculations use one worker, at most eight queued snapshots and a 30-second end-to-end deadline. Death estimates use a separate worker, started on first demand, with one active request, at most two queued snapshots and a 120-second end-to-end deadline including startup. Their cache/coalescing key also includes the requested chunk list. A cold advisory batch cannot occupy the interactive worker or queue. Each worker has independent compilation, caches and recovery state.

New gameplay revisions discard obsolete pending work and Preview responses, with the narrowly scoped active-prediction follower described above; disconnected waiters detach independently. Queued abandoned work is removed immediately. Active abandonment or supersession sends a request-ID cancellation control to the worker, and death batches check it after baseline work and between candidates. A synchronous calculation already running finishes before cooperative cancellation is handled. Discarded or partial results are never cached, and the active watchdog remains armed to terminate a hung worker.

Worker failure or an active deadline terminates the failed generation and retries compilation with exponential backoff (250 ms, capped at 5 seconds), allowing three restarts per lane per server lifetime. Foreground health reports degraded recovery or restart-required exhaustion while saves remain available; a death-only failure leaves interactive tasks ready and is exposed separately in `worker.death` and diagnostic `deathLane`. Worker status events update the browser status line. Startup compilation has a separate 30-second deadline per attempt. The authenticated `/api/diagnostics` endpoint returns each lane's queue/counter summaries, worker health, serialized cache bytes and aggregated calculation stage durations, including `deathMs`; it contains no member identifiers, saved state, error payloads or invitation token.

Static modules, JSON, CSS and API reference data negotiate memoized Brotli/gzip representations with a strong ETag for each encoding. Responses are private. Content-digest asset paths may be immutable; dates and version labels alone use revalidation. State and rules representations are cached by revision, with bounded response caches. Authentication still precedes every route and conditional response. Ordinary calculation responses retain accurate per-request cache/timing metadata and use private no-store; their stable result bytes are cached in the scheduler.

Production startup binds an early dispatcher before opening the store or compiling
workers. Private master-bearer health reads report warming; every other request
is refused with 503 until store, import and auth initialization succeeds. No save
body is read or queued. The dispatcher shares listener/socket ownership with the
normal server, closes on initialization failure and cancels initial worker
compilation on shutdown. The CLI still enters through `app/server.mjs`; its
static module imports precede this first bind.

After handoff, native workers prepare the saved skill-guide variant and initial
compressed play-state response asynchronously. A quiet startup controller admits
both full task lists, then compact Preview baselines, using existing bounded
worker warm queues and immutable shared state transport. Real requests
promote/coalesce matching work; background completion leaves idle clocks alone.
The controller does not write saves, reconcile claims or create death/duo lanes.
Pending/selected predictions resume afterward. Direct `createServer` callers
retain their preparation-before-listen contract; `startServer` selects production
early listening. Diagnostics separate catalogue, worker/reference, store, auth,
variant and state-response timings. Optional preparation failures preserve saves
and worker recovery. Full state, backups and optional reference data remain
demand loaded. Later revisions select a new response cache key. Within an
evaluation, permanently blocked tasks skip repeated blocker allocation during
eligibility passes; final explanation still runs the original checks in order
and preserves metric counters.

The browser requests `view=play-v1` for state, commands and other state-bearing saves/review conflicts, and for foreground tasks. The default APIs and full backups retain their full format. Display state omits archival provenance, retains custom catalogue rows and rows addressed by either member's saved facts, and materializes their identity candidates/category metadata, including competing aliases. False and empty saved overrides remain references. All computed task identities remain in the task view, including hidden/blocked rows; detailed records and sources load through the full API on demand. `GET /api/history` returns current history and the previous restore history. Storage owns coherent command snapshots; unchanged projected fields merge only against the acknowledged base revision. Projected task and identity contents, rather than source-array identity, determine whether a command can omit them.

Native evaluate workers send immutable JSON in SharedArrayBuffers. Compact requests serialize only play bytes; default full requests retain full/play bytes. The scheduler caches them without parsing or stringifying the complete result on the HTTP event loop, and exposes a lazy result getter for consumers such as training. Native foreground inputs also use shared JSON assembled from the store's memoized field strings, avoiding a large object clone on the request path. Each captured revision retains its member metadata and fingerprint; the worker validates and parses a bounded snapshot once. Worker errors clear the scheduler's snapshot knowledge so later requests resend their bytes. Direct worker callers, custom factories and advisory protocols retain object inputs. Input projections omit only history and archival provenance; legacy gameplay fields and saved identity resolution remain intact. Compact and advisory baselines skip Current BiS/Activity Info. A private WeakMap retains their panel inputs so a later full request appends those views without repeating the core calculation.

Within a fixed-point evaluation, raw access records the task gates it actually reads and is reused while those values remain unchanged. A changed short-circuiting gate triggers a fresh calculation and captures newly visited dependencies. Set iteration falls back to tracking the entire ordered Set. Mutable access containers are copied before Slayer restrictions and produced objects alter them. Guide variants share compiled access indexes only when the access-relevant definition branches and environment switches are identical. Catalogue alias indexes batch only the saved references needed by a member; resolution caches remain local to one projection, preserving canonical false/empty overrides and observing the next snapshot's aliases.

`GET /api/display-world` projects the server's corrected world for map display. The browser hydrates small Maps/Sets instead of importing and constructing the resource, archaeology, identity and walking-policy catalogues. Startup requests `GET /api/definitions?view=display-v1`, containing only the exact chunk definitions; full definitions load in parallel with an explicit full calculation view. Chunk search builds the same index lazily in small slices. Resource contents retain the fields displayed by the UI; the complete evidence stays server-side. Play pools contain authoritative partner connections computed by the existing rules wrapper. A WeakMap sidecar keeps the full world's local resolver out of custom rule hook snapshots. Optimistic ownership previews retain the last acknowledged connection snapshot until the save response arrives.

Terrain starts independently of optional pins/provenance. Later pin attachment retains decoded terrain. Task rows render in small slices; collapsed lists keep exact counts and populate on opening. `GET /api/chunk-planning` returns the selected location's exact task associations, clue markers and access from the cached calculation. Its shared pure index preserves the previous browser algorithm; it avoids transferring every task's full evidence for an open chunk tab. Planning waits for the foreground task list and checks member/revision/chunk scope. Item/equipment/training search and detailed evidence load when selected, with member/revision/dialog guards. Repeated ready notifications do not cancel foreground requests. Skull batches wait for the current task list, and disabled markers do not start a batch.

Prediction prewarming remains enabled, but waits for the first foreground task response after a state load or new revision and for at least one second of foreground quiet. An abandoned state load releases its wait after fifteen seconds. Startup task/Preview preparation begins after a quiet second; saved candidate prediction warming has an initial ten-second grace and waits for that preparation. Explicit prediction requests remain immediate. Predictions evaluate a separate frozen hypothetical state without adding commands or persisting the unlock; the exact complete-result reuse and active-producer race described above apply only after a durable save. Idle warming does not extend a lane's lifetime or independently wake a lane after its interactive-use window expires. Incremental reverse-dependency invalidation and partial patches remain future work.

Group view paints the selected member's current task rows as soon as they are
available, ahead of an unfinished peer, and labels the combined list as updating.
The complete-duo milestone waits for both current results and their rendered rows.
Task-row actions remain guarded until the combined view is current. Sleeping keeps
the browser's existing list visible; a request that wakes a calculator shows
“Waking up the task calculator…” while saves remain independent.

Authenticated `POST /api/shutdown` acknowledges stopping, rejects new mutations and closes the listener. Already queued saves drain before the store releases its lock; their connections stay protected during the durable transaction, then have a separate ten-second transmission deadline. Other unfinished connections and worker termination have a 10-second deadline. The Windows Stop helper requests this shutdown and waits up to 20 seconds before an explicitly reported forced stop.

The map separates artwork, state and hover canvas layers. Rendering, browser interaction and server/task calculation are distinct measurement stages.

## Measurement and validation

Actual commands, timings, source inputs and acceptance status belong in [verification.md](verification.md); feature coverage and limits are in [parity.md](parity.md). Roll eligibility, uncached task evaluation, warm responses and whole-browser interaction must be measured separately. This architecture document does not set an unverified latency budget.

Repeated page-load and interaction measurements, transfer/cache breakdowns and
latency targets are recorded in [performance.md](performance.md).

[identity-verification.md](identity-verification.md) records permanent-ID conservation, historical decoder coverage and the paired task-calculation/alias benchmark.

Native tests cover synthetic fixtures, captured/reference records, commands, migration, worker/server behavior, storage and recovery. The inspector and capture tools do not alter an original live map. Neither synthetic checks nor a dated capture establish continuing account progress or second-device network reachability.
