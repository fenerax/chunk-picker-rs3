# Launch readiness

Audit date: 2026-11-11. Source baseline: `daa221d931ef6dd1c4dd725821ecf0e80faf071c` (local `origin/main`). Evidence below is repository source, not a claim about the deployed version, real users or measured server capacity. Rows labelled “launch change” cite this branch; other source anchors remain pinned to the baseline. Missing rows cite the existing schema or handler that lacks the required behavior. The contract's older audit citations refer to a different revision.

The owner decided on 2026-11-11 to open an invite-only beta of roughly 25–50 groups once the launch basics pass, inside a load-tested envelope of about 100 active groups. The 2,000-character design ceiling must be proven before admission rises beyond demonstrated capacity. Public sign-up still requires her explicit OK. No release, live setting or sign-up change is authorized by this checklist.

`shipped` means the cited code implements the stated row; `partial` means only part of that behavior exists; `missing` means the required operation, entity or proof is absent. A shipped source row does not pass a human or operations gate. Counts cover the 109 contract rows below, not the launch gates: **24 shipped, 42 partial, 43 missing**.

## Launch-basics gates

Owners below are responsible roles; no outside tester or operator has been booked by this document.

| Gate | Owner | Status and acceptance evidence still needed |
| --- | --- | --- |
| Account and key caps | Core implementation | Partial. Registry and key caps implemented and tested in this branch. Character-dependent caps and legacy invite sign-up authority remain open. |
| First sign-in → invite → character switch → leave/rejoin, rosters 1–5 | Core implementation; the owner accepts the journey | Blocked. Character identity, owner invites, switcher, moves and non-duo starts are incomplete. Run the complete journey for each size with isolated synthetic data. |
| Timed multi-picker restore from off-site backup | Private operations owner | Unverified. Restore an off-site capture into isolated roots, time access reclaim and gameplay recovery, verify several pickers, history, keys/tombstones and dataset closure. Record source, backup, elapsed times and failures. Public recovery proposals are not a completed drill. |
| Verified alert delivery | Private operations owner | Unverified. Trigger a synthetic actionable failure and retain the actual delivery receipt and recovery result. Alert code alone does not prove delivery. |
| Abuse: sign-up rate and picker creation | Core implementation; private operations configures | Partial. Existing rate buckets plus launch registry/beta refusal tests are present. No Add character or lifecycle-allocation path yet. Baseline `app/security/picker-limits.mjs:146`; launch `tests/launch-registry-caps.test.mjs:1`. |
| Abuse: invites and plugin keys | Core implementation | Partial. Rate/key accounting exists; seat reservations and new invite storage are absent. See `app/security/picker-limits.mjs:118`, `app/storage/invites.mjs:203`. |
| Abuse: storage per login | Core implementation; private operations sets budget | Missing. Upload byte budgets are traffic bounds, not retained disk quotas. Define accounting for maps, history, private evidence and past maps without deleting records. See `app/security/picker-limits.mjs:159`. |
| Beta cap on new groups/pickers | Core implementation; the owner or private operations chooses live cap | Implemented in branch. Refusal, existing sign-ins, pending recovery and lowered caps tested; live cap remains unset. Private operations sets it only in a later authorized release. |
| Understandable overload refusals | Core implementation; outside tester checks wording | Partial. Most admission paths have messages and Retry-After; OAuth/session exhaustion remains generic. See `app/picker-router.mjs:314`, `app/signin.mjs:87`, `app/storage/invites.mjs:119`. |
| Bug-report route | Core implementation; private operations triages | Partial. In-app feedback exists, including own-report reads; verify discoverability, operator receipt and follow-up in beta. See `app/picker-context.mjs:1081`, `app/picker-context.mjs:1643`, `app/web/feedback.mjs:1`. |
| Usability test outside the duo | The owner recruits one outside tester; core implementation fixes blockers | Unverified. Observe the full journey, error recovery and bug reporting. Agent-authored tests and duo use do not satisfy this gate. |
| About 100 active groups load-tested; admission stays within proof | Capacity track owner; the owner accepts envelope | Unverified here. Capture source/configuration, workload, hardware, failures, recovery and backup overlap. Entity caps alone prove no throughput. |
| Public sign-up | The owner | Closed pending the owner's explicit OK, independently of beta and capacity results. |

## Accounts, characters and groups

| ID | Contract behavior | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| A01 | Discord/Google opaque provider subjects identify a login; at most one identity from each provider; conflicting logins never merge automatically | shipped | `app/storage/registry.mjs:59`, `app/storage/registry.mjs:197`, `app/signin.mjs:107`. |
| A02 | Provider linking requires a current authenticated session; no email/name authority | shipped | `app/signin.mjs:107`, `app/signin.mjs:299`, `app/storage/registry.mjs:197`. |
| A03 | Stable login ID; zero-character login survives explicit deletion without reprovisioning | partial | Stable IDs exist; `firstLogin` ensures a default again. No character collection: `app/storage/registry.mjs:59`, `app/storage/registry.mjs:384`. |
| A04 | Stable opaque character ID, controlling login and exactly one live placement with inverse uniqueness; names never establish ownership | missing | Strict registry/account/member fields have no character or placement entity: `app/storage/registry.mjs:39`, `app/storage/registry.mjs:59`, `app/core/state.mjs:46`. |
| A05 | Stable group ID and isolated gameplay, roster, history and evidence | shipped | Registry-issued ID/directories and credential-selected routing: `app/storage/registry.mjs:219`, `app/storage/registry.mjs:342`, `app/picker-router.mjs:167`. |
| A06 | Exactly one owner login through a designated character; several owned groups per login | partial | Exactly one owned default is enforced; no owner-character binding: `app/storage/registry.mjs:75`, `app/storage/registry.mjs:84`, `app/storage/registry.mjs:239`. |
| A07 | Live slot binds one character; departed slot cannot be reassigned with its progress; reservations have no playable map | missing | Member allowlist/memberships do not express placement or historical/vacant slots: `app/storage/registry.mjs:69`, `app/storage/registry.mjs:392`, `app/storage/registry.mjs:402`. |
| A08 | 1–5 live characters, occupied plus reserved ≤5; same-login characters can share a group with explicit acting selection | missing | No live-seat/reservation accounting or character selection: `app/storage/registry.mjs:17`, `app/storage/invites.mjs:98`. |
| A09 | Owners control invites/handover/deletion without operator power or another login's character/key authority | partial | Owned deletion and member-key authorization exist; invite creation still requires private admin: `app/picker-router-deletion.mjs:52`, `app/game-plugin.mjs:792`, `app/picker-context.mjs:1668`. |
| A10 | Preserve existing account/picker/member IDs and maps; review ambiguous character mappings; viewers create no characters | missing | No character migration exists; legacy import preserves IDs/access only: `app/storage/registry.mjs:420`, `app/storage/registry-legacy.mjs:1`. |
| A11 | Preserve ownerless two-slot legacy compatibility and ordinary deletion guard | shipped | `app/storage/registry.mjs:54`, `app/storage/registry.mjs:420`, `app/storage/registry.mjs:466`. Ordinary group conversion remains unimplemented. |
| A12 | Portable gameplay excludes identities, ownership, invites and usable credentials | shipped | Recovery sanitization is explicit; gameplay member fields exclude auth: `app/storage/registry.mjs:513`, `app/core/state.mjs:46`. |
| A13 | Per-character access/tasks/supplies/maps, goals, imports/restore and Undo work for all roster sizes 1–5 | partial | Array-based state exists, but members transition demands a duo and bank helper rejects >2: `app/core/state.mjs:2275`, `app/core/members-start.mjs:11`. Full workflow proof is missing. |

## Provisioning and RuneScape names

| ID | Contract behavior | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| P01 | First sign-in creates a neutral character, solo picker and owner slot without provider-profile naming | partial | Neutral `owner` slot and picker exist; character entity does not: `app/storage/registry.mjs:244`, `app/server.mjs:460`. |
| P02 | Idempotent recoverable first provisioning; no half-created success; quota refusal preserves existing maps | partial | Picker crash recovery and admission preflight exist; no character transaction. Launch change: `app/storage/registry.mjs:398`, `tests/launch-registry-caps.test.mjs:1`; baseline crash cases: `tests/registry.test.mjs:67`. |
| P03 | Invite survives sign-in; initial solo picker is created first, then reviewed retirement/move | missing | Invites use the older account path instead of first provisioning: `app/signin.mjs:299`, `app/signin.mjs:307`. |
| P04 | Return to requested/last authorized character; Add character when empty; remembered selection is no authority | missing | Callback redirects to `/`, one default, no character menu: `app/signin.mjs:305`, `app/web/account-panel.mjs:28`. |
| P05 | Add character creates another solo picker, or directly joins invite after first onboarding; quotas checked before publication | missing | Only `ensureDefaultPicker` exists: `app/storage/registry.mjs:401`, `app/web/account-panel.mjs:28`. |
| P06 | Unnamed member can play manually; sync requires trimmed 1–12 ASCII letters/digits/spaces/hyphens/underscores; case/underscore equivalence retained | shipped | Optional name and validation/matching: `app/core/state.mjs:781`, `app/core/game-progress.mjs:21`, `app/core/game-progress.mjs:28`, `app/integrations/platform-api.mjs:86`. |
| P07 | Public lookup validates returned names, imports nothing by itself, does not prove ownership; private/missing/rate/unavailable leaves progress intact | shipped | Fetch-only snapshot and returned-name validation: `app/integrations/platform-api.mjs:33`, `app/integrations/platform-api.mjs:85`; preview endpoint: `app/picker-context.mjs:1718`. |
| P08 | Names never merge/claim accounts; duplicate within login needs warning and acknowledgement | partial | Login authority uses provider subjects; no character collection/duplicate-name review: `app/storage/registry.mjs:197`, `app/web/account-panel.mjs:28`. |
| P09 | Sync preview/apply, revision/name checks and plugin precedence; paired fetch, 3-minute cache, 10-second deadline | shipped | `app/picker-context.mjs:1718`, `app/core/state.mjs:2026`, `app/core/game-progress.mjs:37`, `app/integrations/platform-api.mjs:97`, `app/integrations/platform-api.mjs:101`. |
| P10 | Controlling-login rename keeps character/map/history; canonical projection and fetch/apply fencing | partial | Member name command and fetch check exist; no canonical character or placement generation: `app/core/state.mjs:2014`, `app/picker-context.mjs:1718`. |
| P11 | Old-name observations remain historical; no API-driven rebind; normalized name change revokes keys/reconfirms plugin; formatting-only change invalidates previews | partial | Name-bound web/member-bound plugin provenance exists; rename does not revoke keys: `app/core/game-progress.mjs:35`, `app/core/state.mjs:2014`, `app/game-plugin.mjs:809`. |

## Invitations

| ID | Contract behavior | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| I01 | Owner-only player invite for a vacant reserved seat; serialized ownership/lifecycle/seat/quota check | missing | Admin-only existing invites have no seat reservations: `app/picker-context.mjs:1668`, `app/storage/invites.mjs:39`. |
| I02 | Opaque ID, hash-only secret shown once, issuer/group/reservation/expiry/status and accepting character | partial | ID/hash/one-time secret exist; new metadata absent: `app/storage/invites.mjs:39`, `app/storage/invites.mjs:203`. |
| I03 | Seven-day expiry, single use, one pending invite per vacant seat; replacement revokes old invite first | missing | Existing invitations have revoke/claimed fields but no expiry/reservation/replacement operation: `app/storage/invites.mjs:39`, `app/storage/invites.mjs:143`. |
| I04 | Owner copies link; no automatic messages; secrets hidden in logs/referrers/address after bounded exchange | partial | Token redaction and preauth exchange exist; owner flow absent: `app/storage/invites.mjs:19`, `app/signin.mjs:25`, `app/signin.mjs:351`, `app/picker-context.mjs:959`. |
| I05 | GET only previews group/sign-in/character choice, never consumes/moves; no private data; existing picker owners eligible | partial | GET does not perform a character move, but older join/session exchange and owner conflict remain: `app/picker-context.mjs:951`, `app/signin.mjs:351`. No limited group preview. |
| I06 | Explicit acceptance selects existing/new character and reviews destination/source map/rules; recheck all authority, expiry, quotas and placement at commit | missing | Account claim has no character or destination-map review: `app/signin.mjs:125`, `app/signin-page.mjs:25`. |
| I07 | Recoverable consume/reservation/placement transaction; one concurrent winner; same-character retry is Already joined; other character cannot reuse | partial | Account claim is serialized/idempotent, but no seat/placement transaction: `app/storage/invites.mjs:143`, `app/signin.mjs:125`. |
| I08 | Expiry at commit releases seat; revoke/handover/deletion invalidates pending invite immediately without removing established membership | missing | Existing revoke invalidates claimed invitation sessions; no independent membership lifetime or expiry: `app/storage/invites.mjs:222`. |
| I09 | Pending/accepted/expired/revoked distinct; 30-day terminal retention, bounded cleanup never revives secrets | missing | No expired status or new invitation metadata/cleanup: `app/storage/invites.mjs:39`, `app/storage/invites.mjs:203`. |

## Leave, rejoin, handover and deletion

| ID | Contract behavior | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| L01 | Leave allocates empty solo; joining takes destination map/rules without copying old progress; solo Leave offers Join | missing | No placement/move operation: `app/storage/registry.mjs:401`, `app/web/account-panel.mjs:28`. |
| L02 | Previous group/history retained; solo becomes read-only; departure removes current contribution and retains historical attribution | missing | Membership removal only filters registry access/capabilities: `app/storage/registry.mjs:410`. |
| L03 | Read-only exportable Past maps snapshot at leave; no active-character charge; existing retention disclosure | missing | No past-map entity/UI: `app/storage/registry.mjs:59`, `app/web/account-panel.mjs:28`. |
| L04 | Clear transient offers/previews/claims/calculations; reserve destination, fence/drain source, persist recoverable transaction; no double-writable placement or partial success | missing | No move transaction or character fencing: `app/storage/registry.mjs:410`, `app/picker-router.mjs:218`. |
| L05 | Owner removal gives non-owner a new empty solo and past-map receipt; resource refusal keeps original usable | missing | No owner removal workflow: `app/web/account-panel.mjs:28`, `app/storage/registry.mjs:410`. |
| L06 | Undo never changes auth/membership/ownership/keys; reverse completed move only through another move; restore keeps current mapping | partial | Auth is external to gameplay; no character move/restore invariant: `app/core/state.mjs:46`, `app/storage/registry.mjs:69`. |
| L07 | Handover required before owner character leaves; may designate same-login roster character; other login explicitly accepts | missing | Owner membership removal is refused; no succession API: `app/storage/registry.mjs:410`, `app/web/account-panel.mjs:28`. |
| L08 | One owner after handover, old owner operations fail, pending invites revoked; decline/cancel preserves authority | missing | Owner/default invariant exists but no handover state: `app/storage/registry.mjs:84`, `app/storage/registry.mjs:402`. |
| L09 | Final character never leaves ownerless group; login deletion blocked until handover if others remain; provider loss is not succession | missing | Account retirement cascades owned pickers without this roster policy: `app/storage/registry.mjs:252`, `app/picker-router-deletion.mjs:46`. |
| D01 | Character-only deletion by controlling login, handover first, revoke exact scopes, retain history; explicit final-group deletion; last deletion leaves empty login | missing | No character deletion or tombstones: `app/storage/registry.mjs:39`, `app/picker-router-deletion.mjs:23`. |
| D02 | Group deletion owner-only and allowed only when all surviving characters belong to owner; others first handed over/removed with preserved maps | partial | Owner-only deletion exists, without character ownership check: `app/picker-router-deletion.mjs:52`. |
| D03 | Login deletion rechecks session and complete target list, requires handovers, removes all exact scopes, preserves other logins' maps | partial | Session confirmation/tombstones/purge exist; full character/handover policy missing: `app/picker-router-deletion.mjs:31`, `app/picker-router-deletion.mjs:46`. |
| D04 | Durable external picker/account tombstones prevent resurrection/reuse; recoverable fencing/drain/revocation before success | shipped | `app/storage/registry.mjs:94`, `app/storage/registry.mjs:219`, `app/picker-router-deletion.mjs:47`, `app/picker-router-deletion.mjs:55`; restore/reuse test: `tests/registry.test.mjs:103`. |
| D05 | Character and slot-binding tombstones survive restores; exact character revocation across streams and keys | missing | Ledger supports only pickers/accounts: `app/storage/registry.mjs:21`. |
| D06 | Disclose actual backup retention before deletion; no promise of immediate removal from retained backups | shipped | `app/picker-router-deletion.mjs:8`, `app/web/account-panel.mjs:89`. Character-specific public recovery policy remains missing under D01/D05. |

## Sessions, switching, links and plugin keys

| ID | Contract behavior | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| S01 | Account-wide character menu with labels/name/group/count/role, disambiguation/current selection/Add character, registry-only metadata | missing | Current account menu shows one account/picker/role: `app/web/account-panel.mjs:28`, `app/server.mjs:420`. |
| S02 | Exact acting character separate from inspected map; unavailable selections explained; no silent default | missing | Principal selects first picker membership and Player 1: `app/storage/invites.mjs:98`. |
| S03 | Stable `/characters/<id>`, `/pickers/<id>/` and explicit character links resolve authorized placement after moves/rename; old groups never follow moves | partial | Picker prefix/selector agreement exists; no character resolver: `app/picker-router.mjs:173`, `app/picker-router.mjs:176`. |
| S04 | Same-origin authorized return target survives OAuth; mismatch/deleted/former-member links explain access and offer own menu; preserve old IDs/links | partial | Picker IDs survive, access fails clearly; callback opens root and no character menu: `app/storage/registry.mjs:219`, `app/picker-router.mjs:176`, `app/signin.mjs:305`. |
| S05 | Each request checks current login/character/picker/member/role and agreement of path/query/header/body; URL never grants access | partial | Picker/body/credential checks exist, character scope absent: `app/picker-router.mjs:136`, `app/picker-router.mjs:176`, `app/picker-router.mjs:201`. |
| S06 | Full document switch stops commands, reconciles uncertain receipts, scopes unsent edits and allows explicit discard without reroll | partial | Session-change admission/abort/pending guards exist; voluntary character switching missing: `app/web/screen-save-status.mjs:89`, `app/web/screen-save-status.mjs:133`. |
| S07 | Teardown closes streams/timers/jobs/panels, aborts fetches/uploads/workers, rejects late callbacks, clears private state/dialogs/caches/outbox | partial | Existing session teardown/generation foundations exist; no character transition coverage: `app/web/screen-save-status.mjs:89`, `app/web/screen-live.mjs:8`. |
| S08 | Browser persistence keyed by account/character/picker/member/dataset/revision; new screen never flashes old private cache; server caches stay isolated | partial | Picker prefixes and late-response checks exist; character not represented: `app/web/screen-save-status.mjs:39`, `app/web/screen-save-status.mjs:146`. |
| S09 | Independent tabs select different same/different-group characters; affected sign-out/deletion/revocation invalidates documents | partial | Revocation guards exist; durable session is picker-bound, not independent acting-character scope: `app/storage/invites.mjs:47`, `app/storage/invites.mjs:155`, `app/web/screen-save-status.mjs:68`. |
| K01 | Hash-only plugin key remains bound to original member/picker; browser selection cannot move it; request rechecks current membership | shipped | `app/plugin-keys.mjs:66`, `app/picker-router.mjs:248`, `app/picker-router.mjs:258`. No ownership verification is implied. |
| K02 | Leave/delete/rename fence old placement keys, revoke both sidecar/index; keys never change owner; old evidence stays historical | partial | Revoke and picker deletion exist; no character placement and rename revocation: `app/game-plugin.mjs:809`, `app/picker-router.mjs:261`, `app/core/state.mjs:2014`. |
| K03 | Beta observations cannot tick live progress; automatic live ticks retain Undo; plugin report does not authenticate RuneScape ownership | shipped | Existing plugin report/command handling: `app/game-plugin.mjs:662`, `app/integrations/game-plugin.mjs:17`. This task must preserve plugin 1.0.0 wire behavior. |

## Durable quotas and refusal behavior

| ID | Contract limit | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| Q01 | 10 active characters/login including pending; tombstones/past maps excluded | missing | No character entity: `app/storage/registry.mjs:59`. |
| Q02 | ≤10 distinct live player groups/login derived from characters; repeated same-group characters count seats separately; legacy viewers preserved | missing | Raw memberships are not characters/groups: `app/storage/registry.mjs:69`, `app/storage/registry.mjs:17`. |
| Q03 | 3,000 active logins service-wide; older 1,000-account store is not sign-up authority | partial | Launch change: central registry now allows 3,000 with refusal/restart tests: `app/storage/registry.mjs:17`, `app/storage/registry.mjs:202`, `tests/launch-registry-caps.test.mjs:1`. Legacy invite sign-in still uses the older 1,000-account path: baseline `app/storage/accounts.mjs:17`, `app/signin.mjs:307`. Unifying it requires the later account/invite work. |
| Q04 | 3,000 active characters, including unnamed | missing | No durable character storage: `app/storage/registry.mjs:39`. |
| Q05 | 3,500 non-deleted pickers, including reserved provisioning and deleting; onboarding peaks counted | shipped | Launch change: `app/storage/registry.mjs:17`, `app/storage/registry.mjs:158`, `app/storage/registry.mjs:213`; actual 3,500-record boundary and restart: `tests/launch-registry-caps.test.mjs:1`. Capacity/performance proof remains separate. |
| Q06 | 1–5 occupied seats; occupied + reserved ≤5 | missing | Member-ID allowlist is not a live-seat model: `app/storage/registry.mjs:392`, `app/storage/invites.mjs:39`. |
| Q07 | Retain defensive 100 member IDs/picker; refuse without dropping history | shipped | `app/storage/registry.mjs:17`, `app/storage/registry.mjs:157`, `app/storage/registry.mjs:392`. |
| Q08 | Retain defensive 1,000 memberships/login; do not confuse it with 10 live character bindings | shipped | `app/storage/registry.mjs:17`, `app/storage/registry.mjs:157`. Character-specific bound remains Q01/Q02. |
| Q09 | Retain 1,000,000 issued picker IDs and retired account IDs/external non-reuse ledger | shipped | `app/storage/registry.mjs:17`, `app/storage/registry.mjs:21`, `app/storage/registry.mjs:219`. |
| Q10 | 1,000,000 issued/retired character IDs with non-resurrection | missing | No character ledger: `app/storage/registry.mjs:21`. |
| Q11 | One pending invite/vacant seat; ≤4/solo group, ≤40/login, 10,000/global, 7-day expiry | missing | No new invite reservation/expiry storage: `app/storage/invites.mjs:39`. |
| Q12 | 20,000 new group-invite records/global, 30-day terminal retention; refuse safely without pruning memberships | missing | Existing 1,000-record store retained indefinitely: `app/storage/invites.mjs:203`. |
| Q13 | 30-day sessions; 10 retained/login, 40,000 global including legacy; expired cleanup/oldest-login eviction; switching adds none | partial | 30-day expiry/cleanup exists; 32 per login/invite and 10,000 document bound remain: `app/storage/invites.mjs:11`, `app/storage/invites.mjs:84`, `app/storage/invites.mjs:115`. |
| Q14 | 3 active plugin keys/character (current member-slot proxy), separate from login aggregate | partial | Launch change separates `pluginKeysPerCharacter=3` from login allowance in both admission and sidecar issuance: `app/security/picker-limits.mjs:11`, `app/security/picker-limits.mjs:82`, `app/game-plugin.mjs:41`. Exact durable-character enforcement still awaits A04; present scope is `(pickerId, memberId)`. |
| Q15 | 30 active plugin keys/login, 15/group, 9,000/global; offline non-revoked and pending issuance counted; restart reconstructs counts | shipped | Launch change: `app/security/picker-limits.mjs:11`, `app/security/picker-limits.mjs:82`, `app/security/picker-limits.mjs:104`, `app/security/picker-limits.mjs:133`; default boundaries, 9,000 offline keys, no record loss and reconstruction: `tests/launch-plugin-caps.test.mjs:1`; real server restart/revocation: `tests/picker-limits-http.test.mjs:119`. |
| Q16 | Keep 1,000 key records/picker including revoked; safe refusal, alert before exhaustion; no silent auth pruning | partial | Bound and understandable refusal exist; advance operator alert missing: `app/plugin-keys.mjs:12`, `app/plugin-keys.mjs:65`. |
| Q17 | 20,000 global registry capabilities (keys/overlays); retain 100/picker; presence never overrides membership/tombstone | shipped | Launch change: `app/storage/registry.mjs:17`, `app/storage/registry.mjs:158`; existing scope checks remain baseline `app/picker-router.mjs:248`. Actual 20,000-global and 100-per-picker boundary preservation/restart are covered by `tests/launch-registry-caps.test.mjs:1`. |
| Q18 | Configurable beta cap on new pickers/groups, unset by default; preserve existing data/IDs/recovery | shipped | Launch change: `app/storage/registry.mjs:127`, `app/storage/registry.mjs:213`, `tests/launch-registry-caps.test.mjs:1`. Flat `multiPicker.betaPickerCap`, positive integer when set, counts all non-deleted pickers including legacy; checked only on allocation. Lowering it permits existing sign-in, pending recovery and deletion. |
| Q19 | Every refusal is understandable and preserves existing records, maps and IDs; limits are not capacity proof | partial | Launch registry refusals identify the exhausted limit and preserve records: `app/storage/registry.mjs:158`, `tests/launch-registry-caps.test.mjs:1`. Generic session/OAuth exhaustion remains baseline `app/storage/invites.mjs:119`, `app/signin.mjs:87`; missing character/lifecycle limits prevent a complete claim. |

## Runtime limits and eventual capacity proof

These rows retain every proposed runtime bound. They are separate from durable entity quotas and from the smaller staged-beta proof. No setting is raised merely to claim capacity.

| ID | Contract setting or proof | Status | Evidence and remaining work |
| --- | --- | --- | --- |
| R01 | SSE 16/login, 32/group, proposed 512/global; 200 nominal and separate 400-stream case | partial | 16/32/64 and release accounting: `app/security/picker-limits.mjs:10`, `app/security/picker-limits.mjs:111`. |
| R02 | Plugin requests 4/key, 16/login, 32/group per second, proposed 256/global; 100 nominal/200 heavy/800 overload | partial | 4/16/32/128, 1-second window: `app/security/picker-limits.mjs:12`, `app/security/picker-limits.mjs:119`. |
| R03 | Invitation creation 10/login, 20/group, 100/global per minute; expiry/consumption does not refill bucket | shipped | `app/security/picker-limits.mjs:13`, `app/security/picker-limits.mjs:118`. New durable invite quotas remain missing. |
| R04 | Registration 3/client or identity, 30/global per minute; no nominal mass-signup burst | shipped | `app/security/picker-limits.mjs:14`, `app/security/picker-limits.mjs:146`, `app/security/picker-limits.mjs:153`. |
| R05 | Provisioning 3/login, 30/global per minute, extend to Add character/lifecycle allocations with atomic fair batch | partial | First-login/default wrapper exists; no character lifecycle: `app/security/picker-limits.mjs:15`, `app/security/picker-limits.mjs:147`. |
| R06 | Expensive requests 600/login, 600/group, 1,200/global per minute; measure HTTP amplification | partial | Bounds shipped, action amplification not proven: `app/security/picker-limits.mjs:9`, `app/picker-context.mjs:1009`. |
| R07 | Outstanding jobs 4/group, waiters 64/job; later sustained miss-throughput proof | partial | Defaults exist, no 100-active-group proof here: `app/security/picker-limits.mjs:8`, `app/tasks/scheduler.mjs:103`. |
| R08 | Cold opens 1/login; trial 4/global after memory admission | partial | 1/1 and leases: `app/security/picker-limits.mjs:16`, `app/security/picker-limits.mjs:117`. |
| R09 | Trial 128 open contexts including legacy; retain 600,000-ms idle; no nominal active-stream churn | partial | Current residency is 7/600,000: `app/picker-router.mjs:23`. |
| R10 | Cold queue trial 256 pending, 2/login, 30,000-ms deadline; report queue wait | partial | 64/2/2,000 defaults: `app/picker-admission.mjs:5`. Longer deadline is not latency proof. |
| R11 | Request/login/group/global body budgets 256/256/256/512 MiB, smaller route limits including 16 KiB plugin reports | shipped | `app/security/picker-limits.mjs:17`, `app/security/picker-limits.mjs:159`, `app/game-plugin.mjs:684`. |
| R12 | Owned imports global 384 MiB, 30-s idle, 600-s total, one parser/import at a time | shipped | `app/security/picker-limits.mjs:21`, `app/picker-router.mjs:23`, `app/picker-router.mjs:289`. |
| R13 | Retain 60-s request/1-s plugin windows and 10,000 account bucket bound with shared accounting across memberships | shipped | `app/security/picker-limits.mjs:22`, `app/security/picker-limits.mjs:41`, `app/security/picker-limits.mjs:50`. Character lifecycle still absent. |
| R14 | OAuth 1,000 pending attempts, 10-minute expiry; safe invite/return-target retention | partial | Attempt limit/expiry/invite retention exist; selected-character return target missing: `app/signin.mjs:11`, `app/signin.mjs:87`, `app/signin.mjs:340`. |
| R15 | Fair understandable 429/503, Retry-After; bounded queues/memory/disk; no lost confirmed work; overload recovers in ≤5 minutes | partial | Request refusals/Retry-After exist; end-to-end overload recovery and disk bounds unproven: `app/security/picker-limits.mjs:30`, `app/picker-router.mjs:314`. |
| R16 | 2,000 active characters separately from logins; include unnamed/offline/pending/deleting/initial solos, reserve/history counts; documents/SSE/plugins are not people | missing | No character population model/proof: `app/storage/registry.mjs:39`. Existing lists can count logins/pickers only. |
| R17 | Both 500×4 and 1,000×2 plus sizes 1/3/5; 2,000-login and 1,200-login multichar layouts; 10-character/same-group cases | missing | Required placement/character entity absent: `app/storage/registry.mjs:59`. Synthetic capacity work is a separate track. |
| R18 | 25% fresh/75% grown, ~1,000 history events/300 retained snapshots including pinned/packed, full catalogue complexity/near-import-limit case | missing | This audit contains no qualifying trial receipt; fixture specification: `docs/groups-and-accounts.md:233`. |
| R19 | 25→50→100→200 online logins over 100 active groups; selected five-player groups; separate 400-stream case, dormant groups unopened | missing | No qualifying envelope proof in this change; residency default: `app/picker-router.mjs:23`. |
| R20 | 20 product actions/s; 50/20/15/5/8⅓/1⅔% read/filter/write/switch/expensive/lifecycle mix; ~100 expensive actions/minute with 40/30/20/10% misses/Preview/roll/pool mix | missing | Character/lifecycle actions unavailable; no qualifying sustained trial: `app/web/account-panel.mjs:28`, `app/tasks/scheduler.mjs:103`. |
| R21 | 6,000 stored keys, 200 online plugin clients, jittered report/status/tasks at 5/5/10 s; multipart/replay/restart/slow clients; separate 200/s and 800/s phases | missing | Accounting foundations exist, target proof absent: `app/security/picker-limits.mjs:95`, `app/security/picker-limits.mjs:119`. |
| R22 | 10 synthetic sync previews/minute and 200-preview burst, paired fetch/coalescing and upstream failures; bounded live global sync allowance | partial | Per-member cache/coalescing/failures exist; no global live allowance or target proof: `app/integrations/platform-api.mjs:85`. |
| R23 | Zero unauthorized data/events/writes, lost acknowledgements, revived tombstones or wrong-dataset restores; stable links through all lifecycle changes | partial | Picker authorization/tombstones exist; character lifecycle and complete proof absent: `app/picker-router.mjs:176`, `app/storage/registry.mjs:94`. |
| R24 | Warm cheap p95≤1s/p99≤2s; expensive p95≤3s/p99≤8s; cold readiness p95≤15s/p99≤30s; warm switch p95≤2s/p99≤5s | missing | No qualifying workload receipt; proposals: `docs/groups-and-accounts.md:262`. Unit tests must not assert timing. |
| R25 | Event propagation p95≤1s/p99≤2s; unexpected nominal failures <0.1%; no healthy-stream capacity eviction | missing | No qualifying workload receipt; proposals: `docs/groups-and-accounts.md:265`. |
| R26 | CPU≤65%, event-loop p99≤50ms; service+backup peak below 80% RAM after OS reservation; no swap/OOM/growth | missing | No qualifying workload receipt; proposals: `docs/groups-and-accounts.md:267`. |
| R27 | Overload 300–400 people/150–200 active groups or 800 plugin req/s; bounded fair refusal and ≤5-minute recovery | missing | No qualifying overload receipt: `docs/groups-and-accounts.md:268`. |
| R28 | Off-site RPO≤24h, group restore≤15min, service gameplay≤4h; access reclaim separate; capture pause p95≤1s/max≤5s | missing | No timed off-site drill receipt in this audit: `docs/groups-and-accounts.md:269`. |
| R29 | Open-loop arrival latency, HTTP/durable/usable-screen distinction; three 60-min trials, cold storm and 12–24h soak with capture/retention/churn/restart | missing | Required experiment specification has no matching result in this change: `docs/groups-and-accounts.md:271`. |
| R30 | Immutable game data stored once; bounded shared calculation resources, isolated picker/private data; full recovery closure | partial | Shared runtime inputs exist, per-picker static blobs remain: `app/picker-context.mjs:98`, `app/storage/store.mjs:117`. Storage/performance changes are outside this task. |

## Release and representation boundary

This branch adopts the 3,000 active registry-login, 3,500 non-deleted picker and 20,000 registry-capability defaults. Flat `multiPicker` key settings are `pluginKeysPerCharacter=3` (member-slot scope until characters exist), `pluginKeysPerAccount=30`, `pluginKeysPerPicker=15` and `pluginKeysGlobal=9000`. Existing operator overrides take precedence. `multiPicker.betaPickerCap` is omitted by default and accepts a positive integer when set. Its count includes the legacy shared picker, reserved provisioning and deleting pickers; deleted tombstones do not consume it. It is an admission cap, so lowering it does not evict groups or block recovery/deletion. This task sets no live value.

These are auth/registry limit changes without new record fields or schema versions. Reader/rollback review must include the older registry defaults of 1,000 accounts, 1,000 pickers and 10,000 capabilities: after growing beyond those values, an older binary needs compatible explicit registry caps before it can open the registry. Keep the higher allowances during rollback; never truncate the registry or non-reuse ledger to satisfy an old default. Session and invitation formats/limits and the 1,000-record plugin-key file bound are unchanged. No 3,000-character cap is implemented because there is no character entity.

Account, picker and plugin-key quota changes ship through a normal release later. Do not flip live configuration. Preserve gameplay saves, registry/auth record shapes, external non-reuse ledger, plugin 1.0.0 wire behavior, and the raw member/membership/key-file defensive bounds. A character entity, seat reservations, past maps, lifecycle transactions or new recovery representation needs separate approval and implementation. No record may be silently pruned or ID recycled to make a cap pass.

The largest blockers are the character/placement model, owner invitations, switching/leave/rejoin, safe handover/deletion, roster sizes 1–5, retained storage accounting, the timed off-site restore and actual alert delivery, the outside-duo test and the measured beta envelope. This checklist starts the launch track; it does not declare the beta ready.

### Security follow-up: cap accounting and key churn

Registry cap enforcement now builds membership, member-slot, per-picker capability and global counts at startup, then validates and publishes only each mutation's changes after its durable write. Ordinary saves validate changed records and update indexes instead of rescanning the registry. Plugin-key admission also maintains login, group, member-slot and global counts incrementally, including pending issuance, cancellation, revocation and picker deletion. Legacy issuer lookup uses a membership index. Startup still reconstructs and validates the complete registry and offline key population.

The existing fixed-window limiter also covers combined plugin-key create/revoke attempts: `multiPicker.keyChangesPerAccount=12` per login across groups and `multiPicker.keyChangesPerMember=12` per `(pickerId, memberId)`, using `limitWindowMs=60000`. Authorized attempts are charged before storage work, including repeated revocations and creations refused by the active-key quota. Revocation does not refund this budget. Refusals return HTTP 429 with `Retry-After` and a request to wait before creating or revoking another key. Private administrator revocations use the administrator's login/fallback picker scope and an administrator member bucket. These in-memory windows reset on server restart, matching existing invite and registration limits. Rate-bucket cleanup visits at most 16 entries per request, with lazy expiry of selected buckets.

The sweep found and removed the global key scan in `picker-limits.mjs`; `game-plugin.mjs` uses those indexed quotas. Its remaining key lookups, sidecar validation and per-member active-key check concern one picker's existing 1,000-record key file, independent of the global population. Registry JSON persistence still copies/serializes the existing array representation; deletion reconciliation can visit all affected memberships and keys. This follow-up removes full-registry cap/validation/index rebuilds from ordinary saves without changing save or wire formats, and makes no wall-time or measured-capacity claim. No live setting changes are made.

## Focused verification for this branch

Node.js 24.20.0, each file's complete `testRunPolicy` environment, one worker, BelowNormal priority and the shared PC `heavy.lock`. Six distinct files, synthetic data and fake OAuth only; no full suite, repeated-run stability loop, timing assertion or live load test. The final relevant runs passed all 83 cases without skips or cancellations.

| Test file | Result | Coverage |
| --- | --- | --- |
| `tests/launch-registry-caps.test.mjs` | 7 passed | Actual 3,000-login, 3,500-picker and 20,000-capability boundaries; preserved bytes; restart; beta concurrency/lowering/recovery/deletion; non-reuse; retained 100-capability picker bound. |
| `tests/registry.test.mjs` | 30 passed | Existing provisioning crash recovery, identity isolation, external ledger, rollback/tombstones, defensive caps and legacy compatibility. |
| `tests/launch-plugin-caps.test.mjs` | 8 passed | Separate three-per-slot, 30-per-login, 15-per-group and 9,000-global defaults; offline/restarted counts; pending reservations; 1,000 historical-record refusal without pruning; existing key authentication. |
| `tests/picker-limits.test.mjs` | 12 passed | Validated configuration, shared rate/key/body admission, reservations, deletion accounting and legacy ambiguous issuers. |
| `tests/picker-limits-http.test.mjs` | 13 passed | Real server sign-in refusals preserve registry, ledger and saved notes through restart; three-key member limit stays separate from 30/login; revocation, rate and body limits. |
| `tests/game-plugin-routes.test.mjs` | 13 passed | Existing key management, credential/origin isolation, report/read routes, progress review, journals and sidecar recovery. |

The first HTTP run had four failures because the new synthetic Discord subjects used text instead of the provider fixture's required numeric IDs. Correcting those fixtures produced the passing run above; no production change was needed for those failures. The registry-cap file was rerun after adding the actual capability-boundary case. Whitespace checks also passed. Hosted CI/stability receipts and deployment verification remain future release work.

### Security follow-up verification

The follow-up used the same Node version, per-file environment, shared lock, BelowNormal priority and `--test-concurrency=1`. Synthetic fixtures only. It exercised 111 cases across eight files. The registry timeout invalidated its earlier all-passed claim; replay is not a pass:

| Test file | Historical result |
| --- | --- |
| `tests/registry-cap-accounting.test.mjs` | 2 |
| `tests/launch-registry-caps.test.mjs` | 7 |
| `tests/registry.test.mjs` | 29 passed; 1 timed out. Replay does not qualify. |
| `tests/account-reclaim.test.mjs` | 21 |
| `tests/launch-plugin-caps.test.mjs` | 10 |
| `tests/picker-limits.test.mjs` | 14 |
| `tests/picker-limits-http.test.mjs` | 14 |
| `tests/game-plugin-routes.test.mjs` | 13 |

Seeded differential sequences compare registry and plugin quota indexes with independent full rescans after synthetic create, revoke, delete and restart steps, including pending issuance/cancellation and membership removal. At 3,000 logins, 3,500 pickers and 20,000 capabilities, cap-admission proxies prohibit unrelated array-entry reads; actual capability saves report one changed capability. At 9,000 active plugin keys, refusal checks one quota row, revocation updates four, and issuance checks/updates eight. These are operation-count assertions, with no wall-time assertion. Implementation anchors: `app/storage/registry-caps.mjs:6`, `app/storage/registry.mjs:197`, `app/security/picker-limits.mjs:105`, `app/game-plugin.mjs:797`.

The new overflow-expiry regression initially exposed a limiter bucket reset after bounded cleanup; retaining the live shared overflow window fixed it, and all 14 limiter cases then passed. The existing registry crash-recovery case (`directory-created`) hit its 30-second test timeout. Its later replay was incorrectly counted as passing verification. That claim is withdrawn. The test was subsequently rebuilt; the await trace, evidence limits and assertion map are in [the crash-test investigation](registry-crash-test-investigation.md). No live data or capacity benchmark was used.

### Crash-test rebuild verification

Each of the eight affected files was run once after the rebuild, under the same shared lock, BelowNormal priority, Node 24.20.0, per-file environment and `--test-concurrency=1`. This run is **not all passing**: 112 passed and one failed, with no cancellations or skips.

| Test file | Single-run result |
| --- | --- |
| `tests/registry.test.mjs` | 31 passed, including all six acknowledged crash seams and the held-metadata recovery test |
| `tests/picker-limits.test.mjs` | 15 passed, including zero timer resources across limiter instances |
| `tests/registry-cap-accounting.test.mjs` | 2 passed |
| `tests/launch-registry-caps.test.mjs` | 7 passed |
| `tests/account-reclaim.test.mjs` | 21 passed |
| `tests/launch-plugin-caps.test.mjs` | 10 passed |
| `tests/picker-limits-http.test.mjs` | 13 passed; 1 failed |
| `tests/game-plugin-routes.test.mjs` | 13 passed |

The HTTP failure was `extra sessions share expensive account limits and unrelated accounts share the global budget`: the second account's first task request returned 503 where line 101 expected 200. The assertion did not retain the response body, so its cause is unresolved. That file was not replayed. After the fail-fast wrapper stopped, the remaining route file was run once separately. This failure and the missing historical await-level evidence remain explicit limits on readiness; the earlier diagnostic run is not counted as passing verification. No production code, live setting or timeout was raised. Hosted stability and full CI remain required before landing.
