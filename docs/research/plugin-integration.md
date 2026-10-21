# RS3 plugin integration research and preparation review

**For Player 1 and Player 2 — evidence cutoff: 2026-10-07.** Public sources were read live on October 7. Repository findings come from source inspection of a working tree being edited concurrently, not a frozen commit or a running-server acceptance test. Line links are navigation aids and may move.

**Recommendation:** prepare a versioned companion API, stable identifiers, player-bound credentials and a review inbox now. Keep the game adapter small and replaceable. The official Jagex plugin beta is real, but public developer access and a complete API contract are still pending. The intended chunk overlay and completion sync are plausible; neither the required coordinate coverage nor private-server access is guaranteed yet.

This task remained read-only in C:/Users/User/Projects/chunk-picker-rs3. No repository file was edited, created, moved or deleted; no git write command, server, test suite or download into the repository was run. This report is the sole requested output, outside the repository. No private .local save or invitation secret was read.

## 1. Public programme: facts, previews and unknowns

### Who runs it, language and timeline

**Verified:** this is Jagex's official RuneScape client integration, with community-authored plugins and Jagex review. It is not an RS3 version of the third-party RuneLite client. The January roadmap announced official support. June's check-in confirms Lua, RuneScape/RuneTek developers, dedicated community/moderation roles and an initial NDA developer group. It does not specify a Lua version, VM/JIT, standard-library access, threading or persistence contract. Sources: [Jagex announcement, 2026-01-19](https://www.jagex.com/news/an-ambitious-new-era-dawns-for-runescape-as-it-marks-its-25th-anniversary), [API Project Check-In, 2026-06-18](https://secure.runescape.com/m=news/api-project-check-in).

| Date | Verified milestone or announced plan |
| --- | --- |
| 2026-01-19 | Official plugin support announced in the 2026 roadmap. |
| 2026-06-18 | Lua and limited community developer involvement confirmed; technical foundations and documentation preparation underway. |
| 2026-08-06 | Official previews show Quest Helper, tile marking and Agility Helper functionality. |
| 2026-09-11 | Further previews cover loot/kill tracking and world highlights. |
| 2026-10-03 | RuneFest announcement schedules the player beta for October 6. |
| 2026-10-06 | Plugin Hub beta launches on beta world 204 with Quest Helper, Menu Entry Swapper, Tilemarkers, Entity Hider and Job Gauges. |
| Late October 2026 | Planned public developer/API opening, conditional on beta results; this is a target, not a completed release. |

Timeline sources: [August preview, published 2026-08-06](https://secure.runescape.com/m=news/api-plugin-previews--quest-helper), [September preview, published 2026-09-11](https://secure.runescape.com/m=news/api--plugins-september-preview), [RuneFest roadmap, published 2026-10-03](https://secure.runescape.com/m=news/runescape-2027-roadmap-), [beta launch, published 2026-10-06](https://secure.runescape.com/m=news/api-plugin-hub-beta-out-now).

The beta uses a separate save, fresh or imported from live. Mobile support is later. Public developer documentation, detailed review requirements and the AI-development policy remain forthcoming. These distinctions matter: testing an integration in the beta must not record progress against the duo's live maps. [Jagex beta launch, 2026-10-06](https://secure.runescape.com/m=news/api-plugin-hub-beta-out-now).

### What plugins can read and draw

The following table distinguishes advertised/available plugin behaviour from a published technical interface. **Unknown means no adequate public primary specification was found, not that the feature is impossible.** Searches covered official announcements and public developer repositories; no complete official function/event reference was located by the cutoff.

| Requested capability | Public evidence | Safe integration conclusion |
| --- | --- | --- |
| Player position, plane, current chunk/region | August previews automatic Agility course recognition and tile/3D markers. | Location-aware tools exist. Absolute player coordinates, plane numbering, region IDs, instance transforms and movement callbacks are undocumented. |
| Skills and XP | August previews Agility session XP and level-target estimates. | Some XP tracking is demonstrated. A complete all-skills snapshot, base versus boosted levels, XP units and callback coverage remain unknown. |
| Inventory/equipment/bank | September previews supplies consumed and items kept. | Item tracking is plausible; complete inventory/bank snapshots, slot changes, item variants and game IDs are not specified. |
| Quest progress/completion | Quest Helper provides contextual guidance; its developer acknowledges missing variables and inferred states in the launch article. | Some quest state is usable, but exhaustive authoritative completion access cannot be assumed. |
| Achievement/diary completion | No adequate official read-interface statement located. | Unknown. Prepare mapping and review logic without assuming a callback. |
| NPC kills | September's Drop Log preview tracks kills over time. | Preview-level capability, not a universal kill event or guaranteed attribution to a particular player/NPC ID. |
| Drops | September previews loot histories plus nearby item names, quantities, ownership filters and despawn timers. | Ground visibility, credited drop, pickup and possession must remain different facts. Completeness and identifiers are unknown. |
| Chat messages | No adequate official read-interface statement located. | Unknown; do not assume RuneLite-style chat events or send-chat privileges. |
| Game-world overlays | Tilemarkers is in the beta; August/September previews include 3D markers and paths plus NPC/container/dig highlights. | Integrated world highlighting is supported in specific tools. Arbitrary chunk polygons, drawing budgets and coverage remain unspecified. |
| Minimap overlays | Launch article describes a minimap menu action for tile-preset export. | Menu integration is evidenced. An arbitrary minimap chunk-overlay API is not established. |

Evidence for the preview rows: [August preview, 2026-08-06](https://secure.runescape.com/m=news/api-plugin-previews--quest-helper), [September preview, 2026-09-11](https://secure.runescape.com/m=news/api--plugins-september-preview). Quest-variable and minimap qualifications: [beta launch, 2026-10-06](https://secure.runescape.com/m=news/api-plugin-hub-beta-out-now). These sources describe behaviour, not stable signatures. In particular, the September preview is not proof that every advertised plugin is available in the initial beta.

### Networking, approval and account rules

**Verified:** HTTP access requires user permission. Exact request methods, allowed destinations, HTTPS requirements, localhost/Tailscale support and WebSockets are undocumented. Plugins require moderation; private/sideloaded distribution is not established. A plugin-specific data-export policy was not found. The October article also defers detailed review and AI-policy information. [Jagex beta launch, 2026-10-06](https://secure.runescape.com/m=news/api-plugin-hub-beta-out-now).

**Verified policy direction:** June supports clarity, usability and new game-mode ideas, while excluding automation and hidden-information prediction. Jagex's general rules prohibit software that performs gameplay for the player, examines/modifies game-world communications or uses altered game code; they also constrain excessive website requests. [June check-in, 2026-06-18](https://secure.runescape.com/m=news/api-project-check-in), [Rules of RuneScape, publication/update date not visible; accessed 2026-10-07](https://legal.jagex.com/docs/rules/rules-of-runescape).

**Inference:** highlighting the duo's declared access and sending observed progress to their own picker fits the stated planning/game-mode direction. Approval still depends on the actual plugin, exported data, permissions and UI. Drawing warnings does not authorize automated movement, blocking/control of game input, clicking, teleporting or gameplay execution. HTTP permission is not proof that every external-data-sharing design is approved. No blanket plugin-data-sharing ban was verified either.

**Rumour/unverified claims:** descriptions such as “RS3 RuneLite,” “all RuneLite plugins will work,” “all game state is available,” or “any local server/WebSocket is allowed” have no sufficient primary technical basis here. They should not become design assumptions. A creator's TOS-compliance claim for a separate client or tool is not Jagex approval.

## 2. Alt1 and other possible stopgaps

### Alt1 Toolkit

Alt1 is a third-party Windows toolkit from RuneApps/Skillbert. Apps are HTML/CSS/JavaScript webpages in Chromium, with per-domain screen-reading/game-state/overlay permissions. Its advertised “game state” permission is not evidence of a comprehensive structured client-state API. [Author landing page, undated](https://runeapps.org/alt1), [author help, undated](https://runeapps.org/alt1/help), [developer guide, posted 2015-06-02; edited 2025-12-26](https://runeapps.org/forums/viewtopic.php?id=101); all accessed 2026-10-07.

| Information/function | What the inspected Alt1 sources establish |
| --- | --- |
| Position/plane/chunk | No exposed player-coordinate or plane accessor found. rsX/rsY describe the client window's screen position; currentWorld is the server number. Neither is a game tile coordinate. |
| Skills/XP | Readers can recognize displayed XP drops/counters. This does not establish an invisible complete account-level/XP feed. |
| Inventory | Screen recognition is possible for visible UI; no structured inventory accessor was found. Item IDs, full quantities and bank coverage are not guaranteed. |
| Quests/achievements | Dialogue/chat recognition and manual steps can support suggestions. No complete quest/achievement state accessor found. |
| Kills/drops/chat | Chatbox OCR is available. Alt1's Droplogger is manually invoked over a take-item menu; it is not a generic universal NPC-kill stream. |
| Overlays | Native drawing uses 2D screen coordinates for text, lines, rectangles and images. World-anchored chunk borders and minimap transforms require additional unverified work. |

Technical evidence: [pinned native API](https://github.com/skillbert/alt1/blob/02bf42fb9ec4296a532edbdb619082d8a854ed1d/src/base/alt1api.ts), [XP reader](https://github.com/skillbert/alt1/blob/02bf42fb9ec4296a532edbdb619082d8a854ed1d/src/xpcounter/index.ts), [chat reader](https://github.com/skillbert/alt1/blob/02bf42fb9ec4296a532edbdb619082d8a854ed1d/src/chatbox/index.ts). Repository snapshot dated 2026-05-28; native API file last changed 2023-06-17. These are inspected public interfaces, not a claim about every capture implementation or private internal feature.

**Can an Alt1 app call a user-owned server?** Browser-style networking is a reasonable stopgap. A community quest helper explicitly documents localhost hosting and wiki CORS requests; Alt1's exposed API also includes a server-URL status daemon that periodically POSTs status. These demonstrate networking use, not a guaranteed generic game-state transport. [Quest helper README, last changed 2026-07-13; repository checked through 2026-08-04](https://github.com/Kiddsh9331/rs3-quest-helper), [pinned Alt1 API](https://github.com/skillbert/alt1/blob/02bf42fb9ec4296a532edbdb619082d8a854ed1d/src/base/alt1api.ts).

**Inference, untested here:** host the companion app and API at the same origin through Tailscale, preferably HTTPS, and submit selected observations using ordinary HTTP. A separate public/HTTPS app calling an HTTP local/Tailscale API can encounter CORS, mixed-content and local-network restrictions. Exact Alt1 Chromium behaviour and WebSocket support need a real-build test. Tailscale Serve provides private tailnet HTTPS hosting, but applying it to this picker is a deployment proposal. [Tailscale Serve docs, undated; accessed 2026-10-07](https://tailscale.com/kb/1312/serve), [Chrome Local Network Access explanation, 2025-06-09](https://developer.chrome.com/blog/local-network-access).

The existing picker has same-origin write checks and no cross-origin API allowance. Consequently, installing an independently hosted Alt1 app and directly calling today's command endpoint is not already a tested integration. Also, Player 2's localhost is Player 2's computer; he must reach Player 1's desktop through its tailnet address.

For safety attribution, RuneApps asserts compatibility with the rules. Secondary sources reproduce a historical Jmod statement from 2015-10-15, but its original comment was not independently retrieved in this run. Do not treat that as present-day blanket approval of every third-party app. [Historical thread, 2015-10-15, original comment unverified here](https://www.reddit.com/r/runescape/comments/3ovux7/the_alt1_toolkit_has_been_reviewed_by_jagex_and/), [current primary game rules, undated](https://legal.jagex.com/docs/rules/rules-of-runescape). The exposed OCR API was inspected; Alt1's complete capture internals were not audited.

**Recommended stopgap:** an Alt1 task/chunk-status panel, manual location selection, and carefully tested chat/XP observations submitted for review. Do not promise automatic precise chunk boundaries or authoritative full account state.

### Other relevant tools and public snapshots

| Tool | Relevance and limitation | Source/date |
| --- | --- | --- |
| Community RS3 Quest Helper / Quest Buddy | Useful OCR/manual quest workflow and example Alt1 app structure; not a complete authoritative quest API. | [Quest Helper repository](https://github.com/Kiddsh9331/rs3-quest-helper), repository through 2026-08-04; README 2026-07-13. |
| Clue Trainer | Substantial maintained Alt1 frontend; useful screen-reader patterns. Its official-plugin preview illustrates a move to integrated 3D highlighting. | [Repository](https://github.com/Leridon/cluetrainer), latest pre-cutoff commit 2026-09-21; [Jagex preview](https://secure.runescape.com/m=news/api--plugins-september-preview), 2026-09-11. |
| OpenLogger | Recognizes clue reward windows and exports results; not general combat loot tracking. Author reports maintenance mode and capture limitations. | [Repository](https://github.com/RedX1000/OpenLogger), latest pre-cutoff commit 2024-02-01; [release discussion](https://runeapps.org/forums/viewtopic.php?id=1442), 2022-04-03. |
| RuneKit | Linux/macOS Alt1-compatible host; no richer state contract, and author declares no intended maintenance. Low relevance to this Windows deployment. | [Repository](https://github.com/whs/runekit), latest pre-cutoff commit 2022-09-25. |
| Alt1 Electron | Experimental alternative host; replacement viability uncertain. | [Repository](https://github.com/skillbert/alt1-electron), latest pre-cutoff commit 2025-04-04. |
| Bolt / community ground-marker plugins | Relevant prior Lua/overlay work, including developers contributing to the official programme. Their separate APIs do not establish official Jagex API capabilities or account approval. | [Official developer collaboration](https://secure.runescape.com/m=news/api-plugin-previews--quest-helper), 2026-08-06; [Bolt ground-marker repository](https://github.com/J3sven/bolt-groundmarkers), undated rolling documentation, accessed 2026-10-07. |

**RuneMetrics needs a narrower claim than “retired.”** Jagex announced website decommissioning and a March 20 deadline for downloading retained Pro website data. Neither announcement proves every JSON endpoint was disabled. [January roadmap, 2026-01-19](https://secure.runescape.com/m=news/the-roadmap-that-changes-runescape-forever), [March update, 2026-03-02](https://secure.runescape.com/m=news/marchs-month-ahead--combat-style-modernisation).

**Verified live observation on 2026-10-07:** [Player 1's public profile endpoint](https://apps.runescape.com/runemetrics/profile/profile?user=exampleGIMab&activities=0) returned HTTP 200 with 29 skill rows; [her public quests endpoint](https://apps.runescape.com/runemetrics/quests?user=exampleGIMab) returned HTTP 200 with 364 quest rows. These endpoints are undated. This establishes availability and response shape for this account at inspection time, not a supported durability/latency contract, every account's visibility, or live event delivery.

**Recommendation/inference:** optionally use conservative, on-demand server-side skill/quest snapshots, with freshness, privacy failures and manual fallback. They cannot replace live position, inventory or kill/drop telemetry. Avoid aggressive polling, consistent with the general website-request rule.

## 3. Repository integration readiness

The requested README.md, PRODUCT.md, docs/architecture.md and app/server.mjs were opened first, followed by narrowly relevant source modules. Product semantics remain the basis: personal ownership/progress, partner access where legitimately connected, personal obligations from one's own chunks, and either player satisfying duo challenge requirements. [PRODUCT.md](../../PRODUCT.md:21).

### Identifier stability

| Entity | Current identity | Assessment for an external client |
| --- | --- | --- |
| Player | Local member.id, default player1/player2; name and optional sourceMapId qxa/qxb. | Good internal anchor if kept immutable. No verified character/account binding, character rename history or per-player source identity. |
| Base chunk | Positive integer string from retained definitions. | Relatively suitable coarse reference identifier. Names can change independently. The coordinate relationship to the official API still needs verification. |
| Section/interior | base-section strings and named interior keys/aliases. | Section topology is separate from plane/tile geometry. Named interiors are label-sensitive and need canonical IDs plus aliases. |
| Ordinary task | rs3: + URI-encoded NFC category + URI-encoded NFC raw label. | Deterministic for unchanged input, not a durable semantic ID across wording, markup or category edits. |
| Quest/achievement | Quest/Diary task records; BaseQuest text connects quest steps. | No game-native quest or achievement ID mapping. Whole completion and individual task/step identities must remain distinct. |
| Item/equipment/NPC/shop/source | Exact names and retained alias tables, sometimes annotated variants. | No integration-ready game-ID bridge. Similar names, noted/charged variants, different NPCs/shops and source context need explicit mappings. |
| Generated collection goal | Extra task IDs derived from source/item display labels, formatted rates and sometimes quantities. | Particularly fragile under source/rate corrections; current completion families do not solve historical rename migration. |
| History event | revision-N in this store. | Useful local ordering, not globally unique external-event identity or durable deduplication key. |

Source anchors: [player defaults](../../app/server.mjs:17), [state identifiers/allowlists](../../app/core/state.mjs:16), [chunk grid and interiors](../../app/data/world.mjs:1), [taskId](../../app/tasks/engine.mjs:8), [task compilation](../../app/tasks/engine.mjs:83), [collection identity](../../app/tasks/collection.mjs:31), [rate/quantity-dependent collection labels](../../app/tasks/collection.mjs:117).

A concrete failure mode: correcting a drop rate changes the raw collection label and therefore its ID. An old checked row can remain preserved in the catalogue/history while current evaluation generates a different ID. Preserving old data is valuable, but does not make the new goal recognize that old check. Migration resolves category-qualified legacy records and quarantines ambiguity; it is not a general rename/semantic-ID bridge. [Migration preservation](../../app/tasks/migration.mjs:169), [collection families](../../app/tasks/collection.mjs:122).

NFC normalization prevents differences from canonically equivalent Unicode representations; it does not stabilize a spelling correction or renamed task. Do not let plugins manufacture picker task IDs from game names.

### State commands, durability and undo

The reusable path is:

    authenticated request -> validated server translation
      -> queued store operation -> pure state command/reducer
      -> validated next state -> durable atomic replacement
      -> response and revision notification

Today POST /api/command takes command plus expectedRevision. applyCommand validates allowed fields, state and revision, increments revision, and writes a history event with undo deltas. Extra eventId/source/timestamp fields cannot simply be attached to existing commands. Repeating an otherwise identical assignment still adds a revision/history event. [Server command route](../../app/server.mjs:307), [command validation](../../app/core/state.mjs:697), [history creation](../../app/core/state.mjs:975).

The store checks revisions inside its serialized queue. It retains the preceding state, synchronizes a temporary file, renames it and updates memory/broadcasts only after persistence succeeds. This is the correct authority for reviewed external effects; a plugin should not edit state files or bypass it. Existing failure-injection tests are useful foundations, not evidence of full power-loss durability. [Atomic writing](../../app/storage/store.mjs:57), [queue/commit](../../app/storage/store.mjs:142), [command path](../../app/storage/store.mjs:209).

**Important distinctions:**

- complete-task records personal game completion. set-task-status.challengeCompleted records a challenge contribution. Importing old challenge checks does not prove personal quests/rewards. [Personal completion](../../app/core/state.mjs:866), [challenge status](../../app/core/state.mjs:765), [progress model](../../app/core/progress.mjs:1).
- Current obtainable items, potential training and derived points are planning results, not inventory, actual levels or current quest points. Passive/max skill controls explicitly describe training declarations. [Player controls](../../app/core/player-controls.mjs:1), [unconfirmed equipment/inventory](../../app/tasks/equipment.mjs:123).
- Strict state/member schemas have no external receipts, character binding, sequence tracking, actual XP snapshot or inventory snapshot. New typed facts need explicit schema/backup migration rather than reuse of unrelated declarations. [Allowed state/member fields](../../app/core/state.mjs:16).
- Undo targets the newest reversible command across the group, without actor filtering. Restore establishes a new undo boundary and archives prior histories. A background writer could affect what a manual Undo reverses. [Undo](../../app/core/state.mjs:957), [restore](../../app/storage/store.mjs:165).
- Every gameplay commit retains a full compressed prior-state backup. Sending frequent position/XP ticks through ordinary commands would grow history/backups and trigger needless work. [Backup retention](../../app/storage/store.mjs:91).

### Authentication and exposed server surfaces

The store creates a persistent random 32-byte invitation token. Cookie and Bearer authentication both use that shared token. It grants access to both players' state and broad edit/backup/restore operations; it identifies neither a person nor a plugin source. [Token storage](../../app/storage/store.mjs:110), [authentication](../../app/server.mjs:25).

The invitation cookie is HttpOnly and SameSite=Strict, without Secure. Server invitations and origin checks assume HTTP. JSON writes require same-origin browser requests, while Bearer clients may omit Origin. No scoped credentials, per-player authorization, revocation endpoint, actor attribution, integration rate limit or cross-origin OPTIONS/CORS handling is implemented in the inspected server. The 32 MiB general body cap is too generous for routine plugin events. [Origin/body checks](../../app/server.mjs:19), [invitation cookie](../../app/server.mjs:258).

| Existing surface | Purpose |
| --- | --- |
| GET /api/state, /api/health | Shared state and authoritative roll pools; readiness/revision. |
| GET /api/definitions, /api/task-map, /api/rules | Reference data, migration mapping and rule metadata/settings. |
| GET /api/tasks?memberId=..., /api/predict?memberId=...&chunkId=... | Per-member derived tasks and hypothetical unlock calculation. |
| GET /api/migration | Migration diagnostics. |
| GET /api/backup, /api/backups, /api/backups/:id | Portable/retained gameplay snapshots. |
| GET /api/events | Outbound server-sent revision notifications. It is not game-event ingestion or a WebSocket service. |
| POST /api/command | Revision-checked gameplay changes. |
| POST /api/profile/preview | Rule-profile preview. |
| POST /api/restore/preview, /api/restore, /api/import/preview, /api/import | Reviewed gameplay replacement/import workflows. |
| Authenticated static routes | Authored UI, selected modules and allowlisted assets. |

[Route inventory](../../app/server.mjs:269). No dedicated event inbox or reduced per-player overlay export exists today. Current source fingerprints gameplay while excluding revision/history/preferences for task evaluation; prediction uses revision. The architecture document's whole-revision-cache description is stale relative to this inspected source. [Current cache](../../app/server.mjs:223).

### Overlay readiness limit

The picker distinguishes ownership, accessible sections/interiors and roll candidates. It does not inspect the character or simulate collision tiles. Numeric regions use the retained 47-by-50 surface crop; named interiors can combine subareas, and section records describe connections rather than geometric polygons. [World model](../../app/data/world.mjs:1), [access evaluator](../../app/tasks/access.mjs:167), [documented limitations](../../docs/access-logic.md:1).

Consequently, the union of unlocked chunks is not a complete “can walk anywhere here” map. Partner ownership, personal section blocks, quest gates, membership boundaries and the confirmed there-and-back connectivity rule need separate handling. Export today's modeled evidence and uncertainty; do not certify exact tile-level access or infer it from a roll pool.

## 4. Preparation plan independent of the final plugin API

All routes, payloads and filenames below are **proposals**, not current implementation or official Jagex API types. Coordinate these changes with the agent currently editing the repository.

### A. Establish durable IDs and a mapping registry first

Mint immutable picker IDs for ordinary tasks and entities, stored explicitly in an authored registry. Labels, categories, upstream references and old label-derived IDs become metadata/aliases. Preserve legacy resolution during migration. Stable IDs can be opaque strings or deliberately assigned keys; a hash of the current label would retain the same defect.

Generated collection identities should use objective kind plus canonical source/item/variant IDs. Keep rates and formatted labels out of identity. Keep quantity in identity only when it distinguishes a genuinely different objective; thresholds/configuration belong in versioned goal semantics. “Kill X” also needs target-count/rule-version context so an observation is evaluated against the reviewed goal.

Add a versioned bridge table:

    external namespace + external ID + variant/context
      -> canonical picker entity
      -> explicit completion predicate / picker task IDs

Mappings must state evidence, mapping version, whole quest versus step, source requirements and ambiguity. Do not conflate a wiki page ID, legacy tasksMap code, game item ID and official API ID. Record authoritative native IDs when verified; prepare the namespace mechanism now rather than invent unknown official IDs.

Migrate completions, statuses/notes, saved task alternatives, completion families and historical undo references consistently. Preserve originals and quarantine unresolved/one-to-many conflicts. Retest backups and reload. Pilot a few quests, skills and collection goals before attempting the entire reference catalogue.

### B. Add per-player source credentials

Create a source record bound server-side to memberId and an explicitly reviewed character binding. Give each player's plugin installation a distinct revocable random credential; store only its hash, show the secret once, and track source ID, permissions, creation/revocation and last-seen status.

Initial scopes:

- chunk-status:read for the bound player's reduced export.
- events:submit for that source's observations.
- events:read-own for delivery receipts.

Plugins must have no roll, unlock, rule-edit, restore, backup or arbitrary command permission. Resolve memberId from the credential, reject mismatches, and never let a payload choose Player 2 using Player 1's token. Authentication identifies a claimed source; it does not cryptographically prove the game action occurred.

Keep the existing browser invitation for duo administration initially. It is shared administration, so review history should honestly record a selected reviewer/source rather than pretend it proves which human used it. Never expose secrets in URLs, gameplay backups, /api/state or logs. Add HTTPS-aware origin/cookie handling if HTTPS deployment is adopted.

### C. Add a durable staged event inbox

Proposed routes:

    POST /api/v1/integration/events
    GET  /api/v1/integration/events/:eventId
    GET  /api/v1/integration/inbox          (duo administration)
    POST /api/v1/integration/events/:id/preview
    POST /api/v1/integration/events/:id/accept
    POST /api/v1/integration/events/:id/reject

An envelope should contain schema version, durable client event ID, source-local session/sequence, observed time, environment (live/beta), character reference, event type, namespaced game identifiers, bounded payload and evidence method/confidence. The server adds receipt time and authenticated member/source. Reject beta observations for the live group by default.

Illustrative payload only:

    {
      "schemaVersion": 1,
      "eventId": "persisted-client-uuid",
      "sessionId": "client-session-uuid",
      "sequence": 42,
      "observedAt": "2026-10-07T19:00:00Z",
      "environment": "live",
      "characterRef": "reviewed-character-binding",
      "type": "quest-completed",
      "subject": { "namespace": "adapter.quest", "id": "verified-id" },
      "evidence": { "method": "api-observation", "confidence": "direct" }
    }

eventId stays unchanged through retries and reconnects. Deduplicate by sourceId + eventId inside the store queue, with a normalized payload hash. Same key/same payload returns its original receipt; same key/different payload fails. After a lost response, returning an already committed receipt must work even if the original gameplay revision is now stale.

Use a **private versioned disk envelope containing state and an integration ledger**, while keeping ordinary gameplay exports state-only. Pending receipt changes do not need gameplay revisions or undo entries. For acceptance, receipt status and gameplay effects must be written in the same atomic file replacement under the existing queue. Two separately written files would create a crash gap. Add a backward loader for today's disk envelope and a distinct operator recovery backup for ledger metadata.

Keep accepted receipts after gameplay Undo or Restore; mark their effects reverted/superseded. Retransmission must not restore undone progress. Gameplay restore should preserve the current ledger, while full disaster recovery must recover it or explicitly change the source generation and require resynchronization. Credential secrets stay outside portable exports.

Handle out-of-order snapshots without letting older observations overwrite newer facts. Do not discard a distinct one-time quest/drop event solely because its sequence is below the highest received sequence. Record gaps and request reconciliation where supported. Keep raw game observations distinct from task projections.

### D. Review mapped effects and apply through commands

| Event type | Initial handling after review |
| --- | --- |
| task-completed | High-level suggestion only, resolved against known canonical tasks and evidence. Never an arbitrary external command. Distinguish challenge check from personal action/completion. |
| level-reached | Record actual base level/XP, observation time and source in a new typed fact model. Map only explicit level predicates; do not overwrite passive/max training declarations or mark every recipe/activity complete. |
| item-obtained | Record item, quantity, acquisition kind and source if known. Inventory increase/trade/group-bank withdrawal does not prove a monster drop, shop purchase or crafted-item objective. |
| quest-completed | Update the correct personal whole-completion record. Do not copy quest points/rewards/completion to the partner or invent completion of distinct quest steps. |
| achievement-completed | Map exact achievement/diary scope; unfamiliar IDs remain pending. |
| npc-killed / drop-observed | Require event uniqueness and player/source attribution for kill-count or source-specific collection goals. A visible ground item is not necessarily obtained or credited to this player. |
| chunk-entered | Record/check a location observation and optionally notify of a restriction. Never unlock the chunk, widen candidates or grant teleport availability. Keep transient movement outside gameplay history. |

Review UI should show player/character, source and freshness, evidence method, resolved entity/task, mapping version, proposed personal/challenge effects and conflicts. Unmapped, uncertain or contradictory events remain pending. Inventory/skill absence is “unknown,” not a zero value.

Preview against current state and definitions. Acceptance uses expectedRevision plus mapping/definition version and revalidates inside the queue. If Player 2 changes the map or mappings change after preview, recompute the proposal. Where one observation has multiple effects, use a trusted atomic reducer/batch with one history entry, not several unrelated HTTP command calls.

Extend state validation deliberately for accepted game facts and command provenance. Reuse completion/status primitives for appropriate mapped effects; do not allow a source to submit arbitrary commands. Preserve the current distinction between personal progress and group challenge satisfaction. Make accepted effects undoable with visible external provenance; an append-only receipt is delivery history, not permanently active gameplay truth.

### E. Export a reduced per-player chunk-status contract

Proposed GET /api/v1/me/chunk-status uses the credential's bound player, not an unrestricted memberId parameter. Return contract version, state revision, definitions/mapping versions, evaluated time, policy version, coverage and deterministic chunk rows. Support ETag/304 and small polling initially; WebSockets are unnecessary for the first server contract.

Each row should include canonical chunk/section/area ID, ownership, partner ownership where relevant, modeled access, reachability/return-route evidence, reasons and geometry coverage. Separate allowed-by-house-rules from modeled route availability. Use explicit unknown/partial statuses for unsupported interiors, missing geometry, planes and ambiguous instances.

The export must preserve these invariants:

- Selected, pending, frontier and teleport-only candidates remain locked.
- Partner chunks do not create personal task obligations.
- Shared ownership does not copy personal section overrides, quests, membership or teleports.
- A known base with mixed/unknown subareas does not claim every tile is accessible.
- There-and-back connectivity is represented explicitly. If the engine cannot prove it, export that limitation.

Build the DTO/pure projection now using existing ownership and access logic. Validate surface coordinates against the real API before converting them to game tiles. Do not repurpose surfaceCoordinates: it returns artwork-grid coordinates. Exact section polygons, cave/plane mappings and instance transforms need a separate reviewed geometry layer.

Show cached overlay data as stale when disconnected; never interpret missing data as permission. An overlay is advisory. It does not prevent movement, and chunk-entered reports do not authorize walking or automatic input.

### F. Tests and acceptance criteria

Inspect and extend the existing state, storage, migration, collection, access and server suites. Existing coverage includes conflicts, injected persistence failure, ambiguous migration, completion scopes, authentication and revision notifications; these tests were read, not executed for this report. [Test directory](../../tests/server.test.mjs:70), [store tests](../../tests/storage.test.mjs:17), [migration tests](../../tests/migration.test.mjs:25).

Add focused cases:

1. Rename/category/markup/NFC collision and rate/quantity/source corrections preserve or visibly quarantine old evidence, including backups, saved alternatives and undo.
2. Wrong player/character, renamed character, revoked source, insufficient scope and attempted arbitrary command fail without mutation or secret disclosure.
3. Duplicate retries before/after restart; same-ID conflicting payload; response lost after commit; parallel acceptance; failure during persistence. Receipt and effects are always both committed or neither.
4. Older snapshots, sequence gaps, clock skew and distinct late events behave predictably; uncertain OCR and unknown mappings grant nothing.
5. Preview becomes stale after browser/partner edits or mapping updates; acceptance does not silently reuse the old proposal.
6. Quest completion stays personal; group-bank/trade/visible-drop observations do not complete a source-specific collection goal.
7. Undo/restore retain deduplication while reporting reverted effects; disaster recovery cannot silently replay old accepted observations.
8. Overlay excludes candidates/locked teleports; handles partner islands, return routes, personal gates, section blocks, mixed interiors, unsupported planes and stale/offline data.
9. Credential/body/rate/origin limits, malformed keys and unauthorized reads are enforced. Private ledger fields never appear in state or gameplay exports.
10. Synthetic event bursts have bounded inbox/history/backup growth and leave the manual save path responsive. Position updates cannot cause one full backup per frame.

First representative end-to-end fixture: Player 1's source submits a mapped quest completion twice; it stays pending until reviewed, applies once, leaves Player 2's personal quest state unchanged, notifies clients, survives restart, then remains deduplicated after Undo. A second fixture submits a locked chunk entry and proves no ownership/access mutation occurs.

Future tests may use isolated temporary data directories outside the active store. No live-game acceptance claim should be made until the actual adapter is tested on both characters and both machines.

## 5. Effort and work that must wait

Estimates are engineering judgment for one developer familiar with this repository, in productive person-days (about 6–8 hours each). They include focused tests for each feature; final cross-feature checks are separate. They assume a small pilot mapping set, not exhaustive manual curation of the retained dataset.

| Work package | Estimated effort | Dependency |
| --- | --- | --- |
| Stable entity/task registry, collection identities and pilot migration | 2–4 days | Start now; preserve existing saved/historical data. |
| Player-bound source credentials, scopes, revocation and character binding | 1–2 days | Start now; automatic character verification waits for API. |
| Private ledger, event schemas, deduplication and atomic acceptance/recovery | 2–3 days | Start now after ID and store-format decisions. |
| Review UI, typed accepted facts and mapped command projections | 1–2 days | Start now with synthetic/manual events. |
| Reduced chunk-status projection, versioning, ETag and uncertainty | 1–2 days | Start now; exact game-coordinate geometry waits. |
| Cross-feature failure/replay/security/load fixtures | 1–2 days | After the preceding changes; package unit tests already included above. |
| Operator/API documentation and recovery/retention defaults | 0.5 day | Start alongside implementation. |
| **Core preparation total** | **8.5–15.5 days** | Approximately 2–3 developer weeks; coordinate concurrent repository work. |
| Optional Alt1 panel/manual bridge plus one validated OCR reader | 1–3 additional days | Actual Alt1/browser compatibility and visible UI testing required. |
| Exhaustive game-ID/source/task mapping and interior geometry | Separate estimate after pilot | Dataset size/ambiguity could exceed the core preparation effort. |

**Wait for public API/docs and review rules:** official Lua adapter signatures; character identity; coordinate/plane/instance conversion; actual game IDs; event completeness and attribution; inventory/quest/achievement snapshots; POST/HTTPS/localhost/Tailscale and WebSocket capabilities; minimap/world drawing primitives; distribution/development mode; telemetry/export and AI-assisted development requirements.

Provisional later effort, with substantial uncertainty: 0.5–1 day capability spike after documentation; 2–5 days for a minimal approved adapter if ordinary HTTP and needed observations exist; 2–5 further days for a surface-only overlay if usable drawing/coordinates exist. Full interiors, instances, authoritative kill/drop attribution and approval lead time cannot be estimated responsibly yet. These are not part of the preparation total.

The first implementation milestone should therefore stop at a tested synthetic companion: stable pilot IDs, one credential per player, a reviewable/idempotent observation path, and a versioned chunk-status export with explicit coverage. The real plugin then supplies observations and renders the export through whatever approved API Jagex publishes.
