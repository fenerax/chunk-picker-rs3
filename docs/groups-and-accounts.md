# Groups and accounts

Product contract, 2026-11-08. Capacity plan, step 1.

This document defines the intended account and group product. It does not describe features as already shipped. The owner decisions in Settled scope and in the final section are settled. Remaining rules are the proposed contract. Numerical quotas and performance gates are proposals until adopted and tested.

The code audit uses local `origin/main` at `3df54499e0002aede31e88f6ad281842bef0b249`, without fetching or checking out that ref. All `file:line` citations refer to that revision. Relevant existing contracts are `PRODUCT.md`, `docs/multi-picker-contract.md`, `docs/sharing.md`, `docs/runemetrics.md`, `docs/progress-sources.md`, `docs/plugin-api.md`, `docs/members-transition.md`, `docs/save-schema.md` and `docs/storage-contract.md`. Earlier implementation-stage descriptions remain evidence about those stages; this document supplies the new product rules.

Only source and documentation were inspected. No credential files, account records, saves, live APIs or server state were read. All examples are synthetic. This document authorizes no implementation, migration, deployment or public sign-up. Changes to durable save, registry or authentication formats, and to recovery contracts, require the owner's OK before implementation.

### Staged beta (owner decision, 2026-11-11)

Start with a capped, invite-only beta of roughly 25–50 groups after the [launch basics](launch-readiness.md) pass, within a load-tested envelope of about 100 active groups. Keep 2,000 active player characters as the design ceiling, to be proven before caps rise beyond demonstrated capacity. This replaces “prove 2,000 before any public launch.” Public sign-up itself still needs the owner's explicit OK. The larger workload and gates below remain the eventual capacity proof, not a prerequisite for this smaller beta. Entity quotas are safety ceilings, not evidence that their populations have been load-tested.

## Settled scope

- Design for about 2,000 player accounts, 500–1,000 groups and up to about 200 people online at once, on one server. Immutable game data is stored once and shared.
- A group has 1–5 player characters, including solo play and every RS3 Group Ironman size.
- First sign-in automatically creates a picker. Its owner invites friends by link; friends join that picker.
- A Discord or Google sign-in reaches one login account containing several RuneScape characters. Each character belongs to exactly one group/picker. One menu switches between their pickers.
- Retain both existing sign-in providers. Several characters never require several provider logins or remembering a separate secret URL for each map.

For example, one login contains Character A, Character B and Character C. Each can belong to a different group. Signing in once shows all three and opens the selected character's saved map.

## Entities and invariants

| Entity | Meaning and exact relationship |
| --- | --- |
| Sign-in identity | A provider plus its opaque subject. Each identity belongs to exactly one login account. A login may link one Discord identity and one Google identity. Provider names, email addresses and RuneScape names never identify a login account. Linking a second provider requires an authenticated account session; identities already belonging to different logins are not automatically merged. |
| Login account | The person-facing container for identities, characters and access. It has a stable internal account ID. It can own several groups and can contain zero characters after explicit deletion. A returning sign-in does not recreate a deliberately deleted character or group. |
| RuneScape character | A new durable app entity with a stable, opaque `characterId`, one controlling login, an optional declared RuneScape display name, and one current placement. Every active character has exactly one placement, including a character whose RuneScape name has not yet been entered. Deleted characters have no active placement. A character is not an OAuth identity. |
| Group/picker | One saved game and isolation boundary: roster, personal maps, shared rules, group views, history and private evidence. It retains a stable registry-issued `pickerId`. An ordinary active group has exactly one owner login represented by a designated owner character in its roster. A login may own several groups through different characters. |
| Member slot | The gameplay position `(pickerId, memberId)`. It holds that character's map, tasks, progress, preferences and sync evidence. A live occupied slot binds exactly one character, whose controlling login supplies its access. A character binds exactly one live slot. A vacant invite reservation contains no character or playable map. A departed slot is historical and cannot be reassigned with its old progress to a newcomer. |
| Invite | A single-use admission offer for one group and one vacant seat, issued by its owner. It has an opaque ID, a hash of its secret, issuer, group, reservation, creation/expiry times and status. Acceptance records the accepting login and character. It grants admission, never ownership, provider linking or operator privileges. |

The placement invariant is `characterId -> (loginAccountId, pickerId, memberId)`. The inverse live slot binding must agree. A name edit, provider change or ownership transfer never changes the character ID. A move changes placement, not identity. A member ID is local to its picker; the same text in two pickers conveys no shared identity or authority.

The product limit is five occupied characters per group, with one occupied character sufficient for a solo group. Pending invite reservations also consume available seats: `occupied + reserved <= 5`. Historical slots, spectators and sessions are not additional players. Public owner invitations in this contract create player access only. Existing viewer/overlay capabilities remain separately scoped and do not acquire character or owner authority.

Several characters belonging to one login may occupy the same group (owner decision Q2). Each consumes a seat and needs explicit character selection. Being signed in as that login must never select an arbitrary first slot.

Group ownership governs invitations, handover and group deletion. It does not grant private administration, provider changes for other logins or plugin keys for another person's character. Existing collaborative gameplay permissions remain a separate command policy. Changing a character's name binding, moving/deleting it and issuing its plugin keys require its controlling login, with an explicitly selected character. A group owner cannot take over another member's character.

### Mapping today's records

Today's registry account is the starting point for the login account. It already stores provider identities and memberships `{pickerId, role, memberId}` (`app/storage/registry.mjs:59`, `:69`). It has no character collection, stable character ID or one-group-per-character constraint. The older per-save account store instead uses `{id, inviteId, role, memberId}` memberships with no picker ID (`app/storage/accounts.mjs:31`). Those records describe access, not distinct RuneScape characters.

Today, the closest thing to a character is a gameplay `state.members[]` record. Its optional `runescapeName` is the web-sync binding; `name` is a display label, and `sourceMapId` identifies an imported original-picker map. None is a stable character identity (`app/core/state.mjs:44`, `:705`, `:1921`). Plugin credentials bind to this member ID, not to an independently authenticated RuneScape account (`app/plugin-keys.mjs:66`).

Preserve existing account, picker and member IDs when introducing characters. Create a character binding for each unambiguous established player slot and connect it to its controlling login. Keep the existing member as its gameplay record; do not copy its map into a fresh blank member. Unclaimed imported members need an explicit claim/mapping review. If several old accounts claim the same slot, or one login has several ambiguous memberships, stop that mapping for review. Never merge by display name, source map code or matching progress. Existing viewer memberships do not create characters.

The legacy shared picker is a compatibility exception with two established members and no ordinary owner today. Preserve its IDs, maps and access. Turning it into an ordinary transferable group needs an explicit owner assignment and reviewed migration; its special two-member registration is not a template for new groups.

The new character entity, character-to-slot binding, per-character lifecycle/tombstones and group-invite records require a reviewed registry/authentication representation. This contract does not prescribe JSON field layout or silently add fields to gameplay schema 1. Portable gameplay import must never import login ownership, identities, invitations or working credentials.

## Lifecycle

### First sign-in and adding characters

1. Successful Discord or Google sign-in resolves the identity to a login. For a genuinely new login, automatically provision one character, one solo picker and its occupied owner slot. Use a neutral label until the person enters a RuneScape name. Do not infer it from the provider profile.
2. Provisioning is idempotent and recoverable. Retrying a callback completes the same allocation. No success page may expose a half-created character, picker or slot. Quota refusal explains the failure without replacing an existing map.
3. If the first visit carried an invite, retain the invitation through sign-in and present acceptance after automatic provisioning. The new character can move from its empty solo picker to the invited group. Retiring that empty picker is disclosed in the acceptance review. Do not defer or omit the automatic first picker.
4. A returning login opens the explicitly requested authorized character, otherwise its last available character. If it has none, show Add character. A remembered selection is a preference, not authority and not a requirement to retain an owned default forever.
5. Add character normally creates a new character with a new solo picker. From an invitation, Add character can create it directly in the destination as part of acceptance; the first-sign-in rule has already been fulfilled. Enforce all quotas before making it live. Creating a second or third character never replaces another map.

Character creation and naming are separate. A character with no saved RuneScape name can use its map and manual controls; web sync remains unavailable until a valid name is supplied. The current validator trims and accepts 1–12 ASCII letters, digits, spaces, hyphens or underscores. Matching trims, treats underscores as spaces and ignores case (`app/core/game-progress.mjs:21`, `:28`). Preserve these rules until a separately tested change is needed.

The RuneScape name is self-declared. Optional on-demand Platform API lookup checks whether public progress can be fetched under that name and whether both returned names match. Hiscores echoes the query and Player Quests independently returns a name; neither proves that the signed-in person controls the RuneScape character (`app/integrations/platform-api.mjs:33`, `:85`). Do not display an ownership-verified badge or require a successful lookup to retain a map. Private, missing, unranked, unavailable and rate-limited responses leave character creation and existing progress intact.

A login cannot claim another person's app character by typing its RuneScape name. Do not enforce global ownership or merge accounts by normalized names: names are mutable and ownership is unverified. Warn about a duplicate name within the same login and require explicit acknowledgement before retaining a second record. The one-group rule is enforceable for app character IDs; it cannot prove uniqueness of real game characters across unrelated logins with today's integrations.

Progress sync keeps preview/apply, current-revision checks, returned-name checks and plugin precedence. A successful lookup alone imports nothing. Today's three-minute cache, paired fetch and ten-second deadline are integration behavior, not identity verification. Plugin reports also do not prove RuneScape ownership: the accepted report has no RuneScape account identifier (`app/integrations/game-plugin.mjs:17`). The user must configure the correct character's key in the game plugin.

### Invitations

Proposed invitation policy: seven-day lifetime, single use, one live invite per reserved vacant seat. These are product defaults, separate from request-rate limits.

- **Create:** only the current owner can reserve an available seat. The server checks current ownership, group lifecycle, available seats and quotas inside the serialized operation. Creation never exposes an existing occupied slot as claimable. Return the secret link once; store only its hash. Replacing a lost invite revokes the old one before reserving its replacement.
- **Send:** the owner copies and shares the link herself. The picker does not send Discord messages, email or contacts requests. The link contains an admission secret, not a gameplay password. Hide it from logs, referrers and analytics; remove it from the address after exchange into bounded sign-in/acceptance state.
- **Open:** opening the link displays a limited group preview and sign-in/character selection. GET does not join, consume it or move a character. It cannot reveal private maps or the roster's login identities. A login already owning a picker remains eligible.
- **Accept:** the signed-in person selects an existing character or Add character, sees the destination and any source-map/rule consequences, then confirms. Recheck invite status, expiry, issuer authority, quotas, source placement and destination capacity at commit. A character already in the destination produces an idempotent Already joined result only for its original successful acceptance; it does not consume another seat.
- **Commit:** consume the invite, convert its reservation into the occupied character slot and update placement as one recoverable operation. A retry by the same login/character repairs or returns that result. A different character cannot reuse it. Concurrent claims have one winner; unsuccessful claims leave maps and reservations consistent.
- **Expire:** at `now >= expiresAt`, acceptance fails even if background cleanup has not run. Release the reservation. Signing in before expiry is insufficient; acceptance must commit before expiry. Reissuing creates a new secret and lifetime.
- **Revoke:** the owner can revoke any pending invite immediately, releasing its seat. Deleted groups, owner handover and owner loss of authority invalidate their pending invites. Expiry or revocation of a consumed invitation does not remove an established character. Membership removal is a separate leave/removal operation, never an implicit consequence of an admission link expiring.

Pending, accepted, expired and revoked are distinct statuses. Proposed retention for terminal invite metadata is 30 days, with a bounded record ceiling; deleting old terminal metadata never makes its unknown secret acceptable again. Do not change existing authentication-sidecar retention as an incidental cleanup during implementation.

### Moving or leaving a group

Owner decision Q3 (2026-11-08): **a character that changes group takes on the destination's map. Its previous map is kept, never merged and never deleted.**

Every active character remains in a group. Leave therefore places it in a new, empty solo picker owned by the same login. Accepting another group's invite places it directly in that group without an intermediate solo picker. A solo character's Leave control offers Join another group rather than creating endless identical solo groups.

On joining, the character occupies a new member slot in the destination group and plays from that group's current map and shared rules. Nothing from its previous map is copied, merged or imported into the destination: no chunks, notes, task checks, personal rules, custom definitions or evidence. Show this before confirmation, with the destination's current map summary.

The previous map is preserved:
- **Leaving a group with other characters:** the group keeps its map and full history. The departed character's past contribution stays as historical attribution. It no longer contributes current access, supplies, completion or task obligations.
- **Leaving a solo picker:** the solo picker is kept as is and no longer writable.
- In both cases the character's login gets a read-only **Past maps** entry showing that map as it was at the moment of leaving. Past maps can be viewed and exported, never edited, and they don't count toward the active character limit.
- Retention of past maps follows the existing recovery policy. There is no silent map erasure.

Clear transient selections, pending roll offers, previews, task claims and calculated results when placement changes; do not reroll or auto-accept an old offer.

Reserve the destination slot before fencing the source. Freeze the affected character's writes, settle accepted writes, freeze the past-map snapshot, publish the new placement and then revoke the old membership and credentials. Persist enough transaction state to resume after interruption. At no point may two writable slots represent the same character, or may a success response refer to a placement that isn't durable. Other groups continue operating. If quotas or validation fail before commit, keep the original placement usable. Cross-store uncertainty stays explicitly pending and recoverable, never a successful partial move.

The previous `(pickerId, memberId)` is never handed to a newcomer with its old data. Empty-default retirement and every picker issued during onboarding count in capacity measurements.

An owner can remove a non-owner character from the group. The removed character gets a new empty solo picker and a Past maps entry of the group map at removal, with a clear receipt for its login. Removal never deletes the character or hands its map to the owner. It must reserve the destination first; when resources are unavailable, refuse the operation rather than strand the character. Owner-scoped removals are new product behavior requiring implementation review.

Gameplay Undo never restores provider access, group membership, ownership or revoked keys. A completed move is reversed only by a new move (for example rejoining by invite), which again starts from the destination's map. Historical map restoration keeps the current character/login mapping and cannot duplicate an active character.

### Owner leaving and handover

The owner is a login acting through a designated roster character. If that character leaves while other characters remain, complete handover first. If the same login has another character in the group, it may designate that character without transferring the login's ownership.

For another login, the current owner proposes a specific existing member character, and its controlling login explicitly accepts. Until acceptance the original owner retains responsibility. Commit one owner, downgrade the former owner to player if staying, invalidate pending invitations and recheck sessions/roles. Outstanding owner operations from the former owner fail after commit. Handover does not move maps or change character IDs, picker ID or existing player memberships. Decline/cancel leaves ownership unchanged. Do not choose a successor by roster order or last activity.

The final character does not leave an ownerless active group. It either keeps that solo group or moves/deletes it through the reviewed lifecycle. A login deletion is blocked while it owns a group containing another login's characters, until handover completes. Losing a provider does not automatically trigger handover; use the linked second provider or a separate operator recovery process.

### Deletion

| Requested deletion | Exact behavior |
| --- | --- |
| Character | Only its controlling login can confirm it. Require handover first if it is the designated owner character of a surviving group. Fence writes and revoke that character's access, keys and transient work. Remove its current gameplay contribution; retain historical attribution/recovery material according to the disclosed existing policy. If it is the group's final character, explicitly include group deletion. Other characters in the login stay available. Deleting the last character leaves an empty login; later sign-in does not silently allocate a replacement. |
| Group | Only its current owner can request it, and only when every remaining character belongs to the owner's login. Otherwise the owner first hands over ownership, or removes the other characters (each gets a new empty solo picker and a Past maps entry). Then tombstone and drain the group. Group deletion never deletes another person's character or map. A combined Delete my character and its solo group action must state both targets. |
| Login | Confirm the full character/group list after reauthentication/session recheck. Complete handover for every owned group containing another login's characters before allowing deletion. Delete this login's characters and any groups containing only its deleted characters; remove its identities, sessions, memberships and all issued capabilities. Other logins' characters and surviving group data remain. Do not treat today's default-picker cascade as sufficient. |

Deletion is a recoverable fenced operation with durable tombstones written outside restorable gameplay. A deleted account, character, slot binding or picker ID is never reused or reactivated by an older restore. Stream closure and revocation complete before reporting success; already accepted durable gameplay remains accounted for in the final state. A retry returns completion or resumes the same deletion.

Show the actual configured backup-retention disclosure before confirmation. Immediate access revocation is distinct from physical expiry of historical/backup copies. This contract changes no existing retention period and promises no immediate erasure from already retained backups. A public release needs a reviewed character-deletion and recovery policy as part of the format approval.

### Character name changes

Only the controlling login changes its character's RuneScape binding. Keep character ID, picker ID, map and history. Show the old/new declared names and explain that the app cannot authenticate a rename or distinguish it reliably from choosing a different game character. Never automatically follow or claim a reassigned old name.

Update the canonical character name and member projection consistently. Invalidate all pending web-sync previews and name-keyed caches. Recheck the binding after every fetch and immediately before apply. Preserve saved observations as historical evidence; do not silently rewrite their recorded names. Web observations bound to the old name are not current evidence for the new name under today's provenance rules. The review must make that visible and require a fresh sync. A changed-name response from the API cannot rebind the character automatically.

Plugin observations remain member-bound under today's protocol and therefore cannot verify a rename. For the proposed contract, changing the normalized name requires reconfirming that character's plugin setup and revoking its existing keys before new reports are accepted. Existing accepted evidence remains historical; no observations from another slot or login are copied by matching names. Pure case/underscore formatting changes recognized as the same normalized name need no identity move or key revocation, but still invalidate outstanding previews to avoid mixed labels.

## Switching and stable links

The switcher lists every non-deleted character controlled by the current login, including unnamed characters. Each entry shows character label, declared RuneScape name when supplied, group label, player count and owner/player role. Use a neutral disambiguator when labels match. The current selection is explicit. Add character is in this menu; linking another provider is a separate account action. Loading the menu reads registry metadata and does not hydrate every picker.

Selecting a character opens its current picker with that exact slot as the acting character. A group's map/member selector can still inspect other permitted group maps; inspection does not change the acting identity. The switcher is account-wide, not a list limited to the current picker. Show unavailable/deleting characters as unavailable and offer another available character; never open a different map silently.

Proposed paths, with opaque placeholders rather than names or credentials:

```text
/characters/<characterId>                         stable personal-map entry
/pickers/<pickerId>/                             stable group entry
/pickers/<pickerId>/?character=<characterId>      explicit acting character
/join/<inviteSecret>                            temporary admission link only
```

The personal-map entry resolves the character's current placement after authentication, including after a move or rename. The group path always denotes that group; it never follows a person's move into another group's private data. A former member opening an old group link gets an access message and a link to her own character menu, without the new destination being disclosed to unrelated visitors. An explicit mismatched group/character link fails clearly instead of opening a default. Retired/deleted group paths remain unavailable. Preserve existing registered picker IDs and legacy root/member links through authenticated resolution; do not make a fresh map at an old URL.

Opening a stable link after sign-in returns to that same authorized target. A provider callback retains a validated same-origin destination and the selected character. A URL selects a target but never grants access. Every request authorizes current login, character, picker, member and role; all path, query, header and body selectors must agree. A plugin key stays bound to its original slot and cannot follow browser selection.

Use a full document navigation for switching initially. Before navigation, stop admitting old commands, resolve any in-flight write's existing receipt and stop queued unsent commands. If a write outcome is unknown, pause the switch and offer receipt/history reconciliation; never resend a roll as a new request. Unsent edits stay identified with their old character and are never submitted to the new one. A user may explicitly discard unsent edits after the warning.

On switch or access revocation, teardown must:

1. Close the old event stream and cancel reconnect timers, refresh/poll jobs, plugin browser panels, feedback/usage work and background interests belonging to that document.
2. Abort fetches, uploads, calculation requests and preview requests. Advance the document generation so late callbacks, body reads, worker replies and ignored aborts cannot render or mutate the new screen.
3. Clear private in-memory state, map/task/Why/How/Preview results, cached responses, dialogs, retained display snapshots and old action receipts/outbox handles from the active document. Browser persistence and command ownership must be scoped by account, character, picker, member, dataset and applicable revision, rather than member ID/revision alone. Account-wide cosmetic preferences may survive.
4. Load fresh authorized session/placement metadata, then state and stream for the chosen character. Never use a previous group's cached result as a temporary new-group view. Server caches remain isolated or fully keyed; switching one browser does not flush another member's valid server cache or close that group's other streams.

Two tabs may select different characters without changing each other's acting identity, even within the same group. Prefer account authentication with independently authorized document/character scopes rather than one mutable account-wide selected-picker cookie. Sign-out, account deletion and membership revocation still invalidate all affected documents. Existing teardown/generation guards are foundations to extend, not missing features to rebuild wholesale.

## Population counting and limits

For capacity acceptance, interpret “2,000 players” as **2,000 active app character records occupying player slots**. Count each character once, even when offline, unnamed or controlled by a login with other characters. Also report distinct login accounts separately. This resolves measurement terminology without asserting that self-declared names prove 2,000 distinct real game accounts.

At 500 groups the average is four characters; at 1,000 groups it is two. Neither group count follows from the number of logins. First sign-in can temporarily produce 2,000 solo groups before invitation consolidation. Count those groups, reserved/incomplete provisions and groups awaiting deletion; do not size only the final joined population. Deleted historical records and retained backups are reported separately from active counts and still consume storage.

“200 people online” means 200 distinct authenticated logins active during the measured interval. Count browser documents, SSE connections, selected characters and plugin clients separately. Switching a character does not count as another person; one login with several tabs can generate several streams and workloads.

### Proposed durable quotas

Quotas apply before allocation or move. Refusal preserves existing maps. Limits are independent ceilings, not a promise that every maximum combination meets the performance target. Operator headroom is not an invitation to advertise a larger tested population.

| Quantity | Today | Proposed contract/configuration at the target |
| --- | --- | --- |
| Characters per login | No character entity or cap | 10 active characters (Q1); pending creations count until committed/cancelled. Deleted tombstones do not consume the active quota. |
| Groups per login | Registry `membershipsPerAccount=1000`; one owned default enforced structurally | At most 10 distinct player groups, derived from at most 10 characters each in one group. Owning a group counts as participating; repeated characters in one group use separate seats but one distinct-group count. No separate unlimited group-creation entitlement. |
| Login records service-wide | Registry `accounts=1000` | 3,000 active login records, allowing the 2,000-character scenario with every character under a separate login. The older per-save 1,000-account store must not be the sign-up authority. |
| Character records service-wide | Absent | 3,000 active characters, including unnamed first characters. Test 2,000 nominal and exercise quota refusal separately. |
| Non-deleted pickers | Registry `pickers=1000` | 3,500, covering the 2,000-solo onboarding peak, headroom and pending deletions. Test that peak as well as the 500/1,000 steady populations. This revises the capacity report's tentative 2,500 ceiling to account for the settled automatic-first-picker model. |
| Player seats per group | Registry `membersPerPicker=100`; no gameplay product bound | 1–5 occupied characters; occupied plus reserved seats at most 5. This is a new live-roster constraint. Do not equate it with the registry's accumulated member-ID allowlist. |
| Registry member IDs per picker | 100, including IDs accumulated by import/reservation | Retain 100 as a defensive representation bound initially; enforce five live players separately. Safe compaction or a different historical-ID representation needs review. Reaching 100 refuses further allocation without dropping historical data. |
| Registry memberships per account | 1,000 | Retain the 1,000-record defensive bound initially; add a separate limit of 10 live player-character bindings. Preserve/migrate legacy viewer access separately; do not lower the raw bound to 10 and invalidate those records. One membership is not necessarily one distinct group. |
| Issued picker IDs / retired account IDs | 1,000,000 / 1,000,000 | Retain both non-reuse bounds and external ledger. Proposed new issued-character-ID and retired-character-ID bounds: 1,000,000 each, with equivalent non-resurrection protection. Never recycle IDs to release quota. |
| Pending invitations | No seat-reservation or expiry cap; 1,000 total invite records per store | One per vacant reserved seat, at most four in a solo group and 40 across a login's 10 solo groups; 10,000 pending service-wide. Seven-day expiry. |
| All new group-invite records | Existing store's 1,000 includes terminal records indefinitely | Proposed 20,000 service-wide including terminal metadata; retain terminal metadata 30 days, then bounded cleanup. Refuse creation at the bound without disturbing memberships. New invite storage must not inherit a single central 1,000-record bottleneck. |
| Sessions | 30 days, at most 32 per account/invite; central document hard bound 10,000 | Proposed 10 retained sessions per login and 40,000 service-wide, including legacy sessions. Preserve 30-day expiry; prune expired sessions and evict the oldest of that login when issuing its eleventh. A character switch must not accumulate another durable login session each time. |
| Plugin keys | Three active per player; picker limiter 3/account, 6/picker, 192/global | Three per character, 30/login, 15/group, 9,000/global for the proposed 3,000-character ceiling. Count stored non-revoked keys even when offline. Test 6,000 keys for 2,000 characters. |
| Plugin key record file | 1,000 total records per picker, including revoked | Retain initially; the maximum live roster needs only 15 active. Alert before exhaustion and refuse further issuance safely. No silent pruning of authentication records to make the load test pass. |
| Registry capabilities | 10,000 global / 100 per picker, includes plugin keys and overlays | Proposed 20,000 global / retain 100 per picker. Budget 9,000 possible active plugin hashes plus separately bounded existing overlay capabilities. Capability presence never overrides current placement/tombstones. |

Source anchors: registry caps and enforcement at `app/storage/registry.mjs:17`, `:157`; imported allowlist growth at `:392`; legacy account bound at `app/storage/accounts.mjs:17`, `:92`; invite/session bounds at `app/storage/invites.mjs:37`, `:115`, `:203`; key-file bounds at `app/plugin-keys.mjs:12`, `:64`; plugin quota defaults at `app/security/picker-limits.mjs:11`.

### Proposed runtime admission configuration

These settings protect traffic and memory; they do not replace durable entity quotas. Start with the following candidate, measure it on scratch, and record any subsequent change. Do not raise unrelated limits merely to obtain a passing result.

| Existing setting | Current default | Proposed test setting or rule |
| --- | --- | --- |
| `streamsPerAccount / PerPicker / Global` | 16 / 32 / 64 | Retain 16 / 32; global 512. Nominal 200 streams, separate 400-stream two-tab test. |
| `pluginRequestsPerKey / PerAccount / PerPicker / Global` | 4 / 16 / 32 / 128 per second | Retain 4 / 16 / 32; global 256. This admits 100/s nominal and 200/s heavy smoothly; 800/s is overload with expected rejection. Multiple characters share their login's budget. |
| `invitationsPerAccount / PerPicker / Global` | 10 / 20 / 100 per minute | Retain all three creation-rate budgets; add the pending-seat/record quotas above. Consumption/expiry does not replenish the same minute's rate bucket. |
| `registrationsPerAccount / Global` | 3 / 30 per minute | Retain; “per account” here charges client/identity admission, not characters owned. Do not call a 2,000-user signup burst nominal. |
| `provisioningPerAccount / Global` | 3 / 30 per minute | Retain initially, extend accounting to Add character and lifecycle-created pickers. Reserve legitimate multi-character group-deletion moves as one bounded operation with fair scheduling; do not partially delete after a rate refusal. |
| `expensivePerAccount / PerPicker / Global` | 600 / 600 / 1,200 per minute | Retain for the proposed action mix. Count underlying charged HTTP calls as well as product actions; revise only with measured amplification. |
| `maxOutstandingJobsPerPicker / maxWaitersPerJob` | 4 / 64 | Retain fairness initially. Queues must drain at the offered miss rate; these values do not prove throughput. |
| `coldStartsPerAccount / Global` | 1 / 1 | Retain one per login; trial four global concurrent opens after memory admission is in place. Measure rather than granting all reconnects unlimited opens. |
| Router `maxOpenContexts / idleCloseMs` | 7 including legacy / 600,000 ms | Trial 128 including legacy / retain 600,000 ms after per-context/global memory work. It must support 100 active groups without repeated capacity-driven stream loss. Test larger churn separately; never pre-open every dormant group. |
| Cold admission `maxPending / perAccount / deadlineMs` | 64 / 2 / 2,000 | Trial 256 / retain 2 / 30,000 for the separate cold-storm envelope. Report queue time. Cold latency gates remain binding; a longer timeout cannot excuse missing them. |
| Body budgets: request / account / picker / global | 256 / 256 / 256 / 512 MiB | Retain; ordinary route-specific smaller limits still apply, including 16 KiB plugin reports. Bound simultaneous large imports separately. |
| Import body global / idle / total | 384 MiB / 30 s / 600 s | Retain. Router owned-import concurrency stays one initially. |
| `limitWindowMs / pluginWindowMs / limitMaxAccounts` | 60,000 / 1,000 / 10,000 | Retain. Preserve shared accounting across all of a login's characters and deleted/dormant key lifecycle. |
| Pending OAuth attempts | 1,000, ten-minute expiry | Retain. Attempts are not registered logins; provider callbacks retain the selected return target and invite safely. |

Runtime anchors: `app/security/picker-limits.mjs:7`, `:22`, `:118`, `:146`; `app/picker-router.mjs:23`; `app/picker-admission.mjs:5`; `app/signin.mjs:11`. Foreground calculator concurrency, queue sizes and worker memory need the later performance work; keeping their defaults unchanged is not a capacity commitment.

## Proposed acceptance workload and gates

All numbers in this section are proposals. They define a later experiment, not current performance. Use disposable scratch infrastructure, a separate load generator where possible, synthetic full-size catalogues/states and fake OAuth/Platform/Hiscores responses. No production API or account load is needed. Record the exact source, configuration, hardware, fixture seed/digests and generator utilization. Production-equivalent persistence, retention and backup work stay enabled.

### Population and concurrency

- Run both 2,000-character layouts: 500 four-player groups and 1,000 two-player groups. Also cover sizes 1, 3 and 5. One exact mixed 500-group layout is 50 solo, 50 two-player, 50 three-player, 50 four-player and 300 five-player groups: 2,000 characters total.
- Use both 2,000 distinct logins and a multiple-character distribution: 800 logins with one character plus 400 with three, giving 1,200 logins and 2,000 characters. Include same-login characters sharing a group (Q2), and a login at the 10-character cap.
- Proposed state mix: 25% fresh groups and 75% grown groups with broad unlocks, personal skill/quest/item progress, private custom tasks and distinct rule variants. Give grown groups about 1,000 recent History events and 300 retained snapshots, including pinned and packed history. Calibrate catalogue size and dependency complexity against permitted aggregate measurements; equal JSON byte counts alone are insufficient. Include a separately reported near-import-limit group.
- Separately exercise first-sign-in growth to 2,000 solo pickers, invitation consolidation to 500/1,000 groups, pending/deleting groups and restart during provisioning/moves. Do not leave extra defaults out of the reported totals.
- Ramp 25, 50, 100, then 200 distinct online logins across 100 active groups, normally two documents per group and one SSE per document. Cover all five simultaneous players in selected groups. Dormant groups remain unopened. A separate test adds two tabs per login, for 400 SSE connections, without counting 400 people.
- Store 6,000 active synthetic plugin keys while only 200 plugin clients are online. Rotate active groups through the full population, including simultaneous writes to one group, late replies, same member IDs/revisions in different groups and character switches during delayed requests.

### Offered actions

Steady browser workload: **20 product actions/second across 200 people**, an average ten seconds between actions per person. Product actions include all their resulting HTTP requests; measure that amplification and the five-second session checks separately.

| Share | Action and purpose |
| --- | --- |
| 50% | Warm state, map/task-page navigation, retained Play/task reads and history reads. |
| 20% | Filters, personal/group task views and How/Why reads with varied valid parameters. |
| 15% | Durable note/check/progress edits, with intentional same-group revision races tracked separately. |
| 5% | Character switches/stable-link opens, including same-login different-group and same-group characters. |
| 8 1/3% | Distinct expensive calculations: full task misses, Preview, roll-pool work and roll/accept sequences. At 20 actions/s this is about 100 expensive actions/minute, or one per active group/minute. Use unique state/rule variations so cache hits cannot replace the intended misses. |
| 1 2/3% | Invite create/accept/revoke/expiry, Add character, leave, handover and rename workflows. Return fixtures to a bounded population through their real lifecycle outside measured action latency where necessary; never silently disable quotas. |

Within expensive actions, propose 40% task-list misses, 30% Preview, 20% roll/accept and 10% pool/Undo-after-review work. Measure their individual latency and request counts; an accept is not automatically retried as a fresh roll. Separate sustained expensive-only throughput and a synchronized cold/reconnect burst from the session workload.

Add 200 plugin clients with jitter: report every five seconds, status every five seconds and tasks every ten seconds, **100 requests/s nominal** in total. Run a separate **200 requests/s heavy** phase and short **800 requests/s overload** phase. Include multipart startup bursts, durable journal acknowledgements, replay after restart and slow clients. Plugin reads must not secretly trigger full calculation for every poll.

Add ten synthetic web-sync previews/minute, at two simulated upstream calls per uncached Platform pair, plus a separate 200-preview burst. Exercise successful, private, unknown-name, malformed, oversized, timeout and 429/Retry-After responses. The test does not establish a live upstream allowance. Live rollout must use a documented bounded global sync budget/coalescing policy respecting that allowance; failures preserve maps and saved progress.

### Pass/fail proposals

| Gate | Proposed passing result |
| --- | --- |
| Isolation and durability | Zero cross-group or cross-character unauthorized responses/events/writes, zero lost acknowledged saves/journal facts, zero revived tombstoned identities/groups/characters/keys, zero accepted wrong-dataset restores. Stable links reach the same map after sign-out/in, rename, provider linking, handover and move. |
| Cheap/warm interaction | Authenticated metadata/state/retained Play reads and durable ordinary command acknowledgements: p95 <= 1 s, p99 <= 2 s. |
| Expensive warm work | Task/Preview/roll calculation including queueing: p95 <= 3 s, p99 <= 8 s, reported separately by operation and cache class. |
| Cold work | First full-size list/Preview and cold character-map readiness: p95 <= 15 s, p99 <= 30 s. Warm switch to a usable map: p95 <= 2 s, p99 <= 5 s. These include authorization and complete response/render readiness where measured by a browser. |
| Event propagation | Durable change acknowledgement to the other authorized browser's event receipt: p95 <= 1 s, p99 <= 2 s. Old streams never receive events for the newly selected character's unrelated group. |
| Nominal admission | Unexpected 429/503/timeouts below 0.1% of valid offered requests. Count all failures; intentionally stale revisions and deliberate quota/expiry tests get separate denominators. No recurring healthy-stream disconnections from context eviction. |
| Resource headroom | Average CPU <= 65%, event-loop-delay p99 <= 50 ms; service plus overlapping backup peak memory below 80% of physical RAM after OS reservation; no sustained swap, OOM, nominal memory-guard retirements or steadily growing queues/RSS. |
| Overload | At 300–400 people / 150–200 active groups or 800 plugin requests/s, bounded fair 429/503 with Retry-After, bounded memory/disk/queues and no lost confirmed work. Return to nominal latency within five minutes after excess arrivals stop. |
| Recovery and backup overlap | Proposed off-site RPO <= 24 h, single-group recovery <= 15 min, whole-service gameplay recovery <= 4 h. Account/character access reclaim is measured separately and included before claiming full service recovery. Capture write-pause p95 <= 1 s, maximum <= 5 s. Retained history remains readable and restored tombstones/placements remain authoritative. |

Measure open-loop scheduled-arrival-to-completion latency, including queue wait and rejected/timed-out work, alongside representative browser sessions. Separate HTTP completion, durable acknowledgement and usable-screen time. Use three independent 60-minute steady trials after stated warm-up, enough observations for each reported percentile, a separate cold-storm run and a 12–24-hour soak. Include capture, off-site verification, retention, churn and restart/recovery overlap. Report failures and unsupported limits. Passing a tiny fixture or increasing deadlines does not prove the target.

## Gaps against current code

The table identifies the concrete enforcement points and missing product operations found in this audit. “Save” means durable gameplay representation; registry, authentication sidecars and recovery contracts are named separately. A behavior-only change can still require migration testing. Every Yes/conditional durable-format or recovery change needs owner OK before implementation; approving this document alone does not approve those migrations.

| Gap and source at the audited ref | Required change | Format/recovery consequence |
| --- | --- | --- |
| No character entity or placement invariant. Registry admits only account/membership/picker fields; member has a name binding but no character identity. `app/storage/registry.mjs:39`, `:59`, `:72`; `app/core/state.mjs:44`. | Introduce stable character ownership and one live slot binding, plus controlled existing-member mapping. Enforce inverse uniqueness; do not identify by name. | Registry: **Yes**. Save: no new field required if binding stays outside gameplay; adding `characterId` to member/export is a separate **Yes**. Recovery: **Yes**, character mapping and tombstones. |
| Exactly one owned picker per login is structurally required. Every active owned picker must equal the account's `defaultPickerId`. `app/storage/registry.mjs:75`, `:84`, `:239`. | Several owned groups through several characters; remembered selection cannot be an ownership invariant. Preserve initial automatic creation and its crash recovery. | Registry: **Yes** (ownership/default model). Save: no necessary field change. Recovery: **Yes**. |
| First login provisions one neutral `owner` member, without a character; returning firstLogin ensures a default again. `app/storage/registry.mjs:244`, `:384`; `app/server.mjs:455`. | Atomically/recoverably create initial character and picker once; distinguish first-ever provisioning from explicit deletion/zero-character login. | Registry: **Yes**. Save: existing member shape can initialize it. Recovery: **Yes** for initial-character intent. |
| Sign-in routes special invites through the older per-save account path and rejects an identity already having its own picker. `app/signin.mjs:105`, `:112`, `:299`, `:354`. | Existing and new logins may accept group invitations for a chosen character; retain pending invite/return target through OAuth. | Registry/auth invite data: **Yes**. OAuth in-memory destination alone: no format change. Save: no for authentication itself. |
| Callback normally issues a picker session then redirects to `/`; sign-in form claims an invite with an account, with no character choice. `app/signin.mjs:139`, `:291`, `:304`; `app/signin-page.mjs:25`. | Character selection and authorized stable-target return; account-wide character menu. | UI/redirect: no. Durable session representation: **conditional**, see next row. |
| Picker sessions store account/picker/provider only; principal chooses the first picker membership and labels it Player 1. `app/storage/invites.mjs:47`, `:98`, `:101`, `:155`. | Authenticate an exact character/slot and allow independent tabs. Membership order cannot select the acting character. | Auth sidecar: **Yes** if storing character/member scope or replacing picker-bound sessions; request-level scope alone may avoid new session fields. Registry binding: **Yes** regardless. Save: no. |
| Router derives selected picker from the credential; URL selectors only assert equality. It blocks owned-picker `/auth/claim`. `app/picker-router.mjs:136`, `:167`, `:173`, `:176`, `:202`. | Authorized character selection and stable character resolver; preserve selector agreement and capability isolation. | Routing: no gameplay format change; session/registry changes as above. |
| No Add character/switcher/leave/handover UI in the account panel. Owner session metadata describes one owned default. `app/web/account-panel.mjs:30`, `:34`, `:74`; `app/server.mjs:420`, `:423`. | Account-wide character list, current acting character and group lifecycle controls derived from registry authority. | UI/API metadata: no. Underlying registry lifecycle: **Yes**. |
| Browser supports one immutable picker scope per document and tears down on session change; storage prefixes omit character. `app/web/screen-save-status.mjs:39`, `:41`, `:68`, `:88`, `:119`, `:181`, `:225`; `app/web/screen-live.mjs:8`. | Reuse full-document teardown; add character-aware scoping, stable selection and independent-tab authorization. Reconcile pending writes before voluntary switching. | Browser cache/outbox version: **conditional** local representation change; Save/registry: no for teardown itself. Durable session: conditional as above. |
| Owner invitations are unavailable: invite list/create/player/revoke require private admin. `app/picker-context.mjs:906`, `:1063`, `:1652`, `:1660`, `:1666`. | Separate owner-scoped group admission from operator administration. Never relax `requireAdmin` globally. | Authorization alone: no. New invite data: **Yes**, next row. |
| Existing invite schema has no picker/character, expiry or reservation; claims bind an account. Revoke invalidates sessions, so link lifetime and membership lifetime are coupled. `app/storage/invites.mjs:39`, `:143`, `:197`, `:222`; `app/signin.mjs:133`. | Single-use expiring seat reservations, accepted character binding and independent persistent membership. | Auth/invite or registry format: **Yes**. Save: no for pending invites; acceptance/move has consequences below. Recovery: **Yes**. |
| Registry membership attachment neither creates a character nor prevents two logins controlling the same slot; reservations only grow a member allowlist. `app/storage/registry.mjs:392`, `:402`, `:405`. | Enforce character/slot uniqueness, five live players including seat reservations, and compatible roster installation. | Registry: **Yes** for character/reservation data. Save: existing member array can represent 1–5; added lifecycle markers would be **Yes**. |
| No general leave/move/handover transaction. Removing an owner membership is refused, while state-open checks require assigned members to remain present. `app/storage/registry.mjs:410`, `:412`; `app/server.mjs:462`, `:467`, `:477`. | Recoverable placement transfer, explicit succession and safe current-roster/reference updates across stores. | Registry/transaction records: **Yes**. Save: **conditional**, new roster-history/evidence references or export metadata are **Yes**; moving existing member fields alone need not change their schema. Recovery: **Yes**. |
| Account retirement tombstones all owned pickers; self-service deletion cascades directly and picker deletion drains that group. `app/storage/registry.mjs:252`, `:465`, `:483`; `app/picker-router-deletion.mjs:46`, `:51`; `app/web/account-panel.mjs:87`. | Handover block, separate character deletion, preserve others' maps on group deletion, clear exact scopes. | Registry/character ledger: **Yes**. Save: conditional roster/history representation. Recovery: **Yes**, no revival from old backups. |
| Legacy shared picker is ownerless, exactly two slots, nondeletable through ordinary routes. `app/storage/registry.mjs:54`, `:420`, `:466`. | Preserve as a compatibility exception; assign owner and map characters explicitly before ordinary lifecycle can apply. Do not remove its guard globally. | Registry migration: **Yes** if converted. Save: no necessary member-field change. Recovery: **Yes**. |
| Gameplay `go-members` demands exactly two; bank helper rejects more than two and enumerates only first/second assignments; UI also blocks non-duos. `app/core/state.mjs:2182`; `app/core/members-start.mjs:11`, `:115`; `app/web/members-start.mjs:154`. | Support all sizes 1–5 end to end, including setup-start using the same helper. Keep per-character maps and personal eligibility. For “different”, minimize unavoidable shared banks across the full roster and sample valid minimum-overlap assignments; for “independent”, sample each pool independently. | Save: no planned schema change; starts/options already use member arrays. Verify old History/Undo/replay. New saved rule/options would need separate OK. Registry: no for algorithm alone. |
| Name edit changes only the member field; web evidence belongs to the recorded name while plugin evidence belongs to member ID. Sync checks mid-fetch name but not a new character placement. `app/core/state.mjs:1921`, `:1934`; `app/core/game-progress.mjs:37`; `app/picker-context.mjs:1698`, `:1702`, `:1728`. | Controlling-login rename, consistent canonical name projection, placement/name generation fencing and plugin reconfirmation. Do not relabel old evidence as verified new-name evidence. | Registry canonical name/version: **Yes**. Save: existing `runescapeName` can remain; persisted rename aliases or provenance migration would be **Yes**. |
| Plugin key is per member; routing index binds account/picker/member, with no character or placement generation. Account deletion comments explicitly allow some legacy shared keys to remain usable. `app/plugin-keys.mjs:66`; `app/picker-router.mjs:250`, `:258`; `app/security/picker-limits.mjs:137`; `app/game-plugin.mjs:794`. | Resolve the tuple to the current character and fence on leave/delete/rename; revoke sidecar and global index consistently. No key follows the switcher or changes owner silently. | No key-format change required if current tuple plus registry validation suffices. Adding character/generation to stored keys/index is **Yes**. Deletion/recovery behavior: **Yes** review. |
| Per-player key ceiling is currently wired to `pluginKeysPerAccount`. Raising the login allowance to 30 would also allow 30 keys for one character. `app/game-plugin.mjs:41`; `app/plugin-keys.mjs:64`. | Separate the three-per-character ceiling from the 30-per-login aggregate quota. | Configuration/API wiring: no Save/registry/key-record format change required. |
| Default entity/session/key/stream caps reject target populations or traffic. `app/storage/registry.mjs:17`; `app/storage/accounts.mjs:17`; `app/storage/invites.mjs:37`, `:119`; `app/security/picker-limits.mjs:10`, `:11`, `:12`. | Apply and measure the proposed caps above, including offline keys, multiple characters and retained sessions. Keep new pending/active/history counts distinct. | Config-only registry caps: no schema change. Hard-coded auth record/session-limit changes need reader/rollback review; new counted entities are **Yes** registry/auth changes. |
| Seven contexts and single cold-open admission cannot sustain 100 browser-active groups without churn; cold admission expires at two seconds. `app/picker-router.mjs:23`, `:92`; `app/security/picker-limits.mjs:16`; `app/picker-admission.mjs:5`. | Later memory/admission work and measured residency configuration; do not claim target support by raising limits alone. | Save/registry: no if runtime-only. |
| Current scheduler setup does not establish the sustained miss throughput in the proposed workload. `app/tasks/scheduler.mjs:103`, `:150`, `:560`. | Later fair calculation-concurrency work and end-to-end throughput proof at 100 expensive actions/minute. | Save/registry: no for internal scheduling alone. |
| Immutable runtime inputs are shared, but store static blobs still live under each picker and serialize reusable fields separately. `app/storage/store.mjs:117`, `:380`, `:399`; `app/picker-context.mjs:98`. | Capacity-plan shared public catalogue descriptor/reader; keep group-specific overrides, private evidence and history isolated. | Save/storage descriptor and backup dependency closure: **Yes**; owner OK belongs to later capacity-plan steps. |
| Sanitized registry recovery currently strips identities and capabilities but has no character/placement/invite lifecycle to preserve. `app/storage/registry.mjs:513`, `:517`. | Restore stable character-to-slot/owner relationships and pending transaction safety without reviving secrets. Reclaim the login's whole character collection, not only one default. | Registry/recovery contract: **Yes**. Portable gameplay remains credential-free. |

Some code uses “duo” names while iterating the full member array, for example `app/web/duo-tasks.mjs:23`; a filename alone is not evidence of a two-player restriction. Conversely, two roll choices (`app/core/state.mjs:2166`) are a roll rule, not a two-player cap. Test personal/group access, task aggregation, goals, starts, imports, restore and Undo for every roster size 1–5 before claiming support; do not assume that removing the explicit guards proves general gameplay correctness.

## Product decisions (owner, 2026-11-08)

| Question | Decision |
| --- | --- |
| Q1. Characters per login | Up to 10 active characters, so at most 10 distinct groups per login. Configurable cap. Past maps don't count. |
| Q2. Several characters from one login in the same group | Allowed. Each occupies one of the five seats and is selected explicitly. |
| Q3. Map when a character changes group | The character takes on the destination group's map. Its previous map is kept as a read-only Past maps entry, never merged or deleted. |
