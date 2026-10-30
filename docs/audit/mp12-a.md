# MP12A: picker isolation and information leaks

START: `828cf30cb36e00e45d6ca25c6acd42bac5200460`.
Synthetic providers, temporary roots and synthetic dataset defaults only. No private save or pack was opened.

| id | severity | route or file:line | attacker steps | impact | suggested fix | test name |
| --- | --- | --- | --- | --- | --- | --- |
| MP12A-1 (Fixed in MP13) | P2 | `app/dataset-catalogues.mjs:11`; `app/picker-context.mjs:915,1692` | Sign in to an owned picker; GET `/api/dataset-runtime` or `/data/dataset-runtime.json`; read `gameDefaults`. | Shared-game member IDs, names, external map bindings and master label are serialized into an unrelated owner's response. Local game defaults are operator data, not a public catalogue. | Build the browser payload with picker-safe neutral defaults for owned contexts. Keep any required legacy defaults behind legacy authorization; check both routes and client consumers. | MP12A-1: owned picker dataset responses omit shared-game identity and map bindings |
| MP12A-2 (Fixed in MP13) | P1 | `app/server.mjs:419`; `app/picker-context.mjs:1490,1627`; `app/integrations/original-sync.mjs:104,161` | On an installation with original sync enabled, export the owned backup; set its member `sourceMapId` to a shared configured map binding (exposed by MP12A-1); restore it; POST `/api/original-sync/preview` with `{}`. | The unrelated owner receives shared original-map gameplay, including notes, task observations and selections. The owned context inherits the operator’s source integration; its source binding is trusted from uploaded gameplay. This reads the configured external source, not the shared picker’s local save. The source uses public upstream REST branches, so this is an application isolation/privacy failure rather than a bypass of upstream authentication. Disabled original sync is unaffected. | Keep legacy original sync unavailable in owned contexts, or authorize source bindings from a trusted per-picker configuration. Do not let restored state grant source access; check member-restore/import too. | MP12A-2: restoring a source binding cannot read the shared original maps |

Counts: P0 **0**, P1 **1**, P2 **1**, P3 **0**. Both findings fail at their security assertion under the required TODO markers. No app code was changed. Keep public sign-up off pending fixes and owner approval.

## Checked areas found sound

- Credential-derived picker selection: `picker-router.mjs:94–171` takes acquisition IDs from session/key scope; the new route matrix makes 564 selector checks across all 94 registered GET/POST routes against both query names, both header names and both path forms, and verifies no target state file is created.
- Existence and ID confusion: foreign picker, account, random and legacy selectors return the same 403 body; a foreign plugin object ID and an absent ID both return the same 404; test names `every registered HTTP route…` and `foreign plugin IDs…`.
- Body and upload routing: nested ordinary selectors, gzip restore/member-restore and uploaded backup selectors return 403 without revision changes; test `nested selectors and gzip or uploaded backups…`; existing routing tests also cover unread admission and serialized upload guards.
- Ordinary state, history, session, coordination, health, diagnostics and revision-conflict errors: new response test checks expected status, private cache headers, absence of the other account/picker and note, and absence of subject/email/hash fields. Session exposes only the caller's account and linked provider list.
- Browser/plugin credential separation: new plugin test covers foreign key revocation, key listing, cookie/key scope conflict, native status/tasks/report selectors, ordinary API refusal and continued validity of the target key; existing routing/context tests cover reports, revocation and restart.
- Overlay and operator routes: new test uses a dedicated synthetic overlay key as a positive control, refuses owned cookies on overlay data/events, and refuses the administration routes for accounts, invites, overlays, usage, backup status, master links, snapshots, shutdown and restart. Existing overlay file covers dedicated scope, archive reads, revocation and SSE shutdown.
- Store, history, Undo, retained backups, exports, action sessions and receipts: `picker-routing.test.mjs` and `picker-context.test.mjs` pass colliding member/revision/request/backup-ID isolation tests, independent exports/restores and reopen checks. `store.mjs:1226` validates retained IDs and canonical backup containment within the selected store.
- Streams and private caches: passing context/routing tests cover separate SSE delivery and revocation, task/preview/cache isolation and capacity eviction; selectors on stream routes also pass the route matrix.
- Static and dataset-input paths: reviewed `picker-context.mjs:1661–1804`, `dataset-catalogues.mjs:4` and `picker-context-http.mjs` containment helpers; explicit route/catalogue allowlists and canonical paths select shared assets, not picker storage. The separate runtime-default leak is MP12A-1.
- Logs and error sanitization: reviewed routing/context/sign-in/plugin/overlay code; no provider/account identifier logging was found. Provider failures become a generic sign-in message (`signin.mjs:146–173`), router internal errors are generic (`picker-router.mjs:225`), context 500/ENOENT responses are generic and invitation URLs are redacted (`picker-context.mjs:1815–1826`). This is source review, not a claim about an external proxy's logs.

## Validation

Node 24.19.0. Each focused file ran separately: routing **37 passed / 0 failed**, context **15 / 0**, overlays **9 / 0**. The new file has **5 passing checks and 2 failing TODO findings**. No tests were weakened or skipped.

Single final quick run: `RS3_TEST_CONCURRENCY=1 npm run test:quick` — **2,669 passed / 0 failed / 68 skipped / 2 TODO**, 300 files, **249.36 seconds**, exit 0. Its unchanged START files contribute **2,664 passes**; the new file adds exactly **5**, with no additional skips. This baseline contribution is counted from the unchanged files in the same run, not a second baseline-suite invocation. Node prints the two expected TODO assertion failures under its “failing tests” footer; they are not suite failures.

The focused files total **66 passed / 0 failed / 2 TODO**. The route matrix covers 94 method/route pairs and 564 selector refusals. Full `npm test` was not run: this audit-only brief requests quick once at the end, and app code is unchanged. No performance change or before/after median, spread or peak-memory claim is made.

## Outside my scope

- Shared worker health/diagnostics report aggregate queue/cache/timing activity; resource fairness and overload resilience belong to the parallel audit areas and were not stress-tested here.
- OAuth protocol/CSRF/browser persistence, deletion recovery, and private add-on internals were not audited here; their picker-facing routing and authorization boundaries were inspected. MP12A-2 reproduces the public-core original-sync integration when enabled; an installed add-on implementation needs the same source-binding review.

Recommendation: **NEEDS-WORK** before public sign-up. These artifacts contain evidence and suggested fixes only.

## MP13 resolution

MP12A-1 and MP12A-2 are **Fixed in MP13**. The original evidence above is
retained. Their TODO markers are removed. The focused file now has ten passing
checks, including neutral-default browser startup, exact legacy dataset bytes
with routing absent/present, and option-absent source sync. Owned source preview
and sync commands refuse access after restore or member restore; original-format
import retains its existing dataset-identity refusal. Final suite and duo-gate
results are recorded in the MP13 contract and footprint notes.
