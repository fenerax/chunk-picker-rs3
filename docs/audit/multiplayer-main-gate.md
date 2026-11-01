# Multiplayer into main: final integration gate


## Current gate: option absent against MAIN with G15 (2026-10-31)

START: `977cc9e36b62d2f4e00d33fe6ceb17f5c2884b84`.
MAIN: `18c5af810136e784519fb72a46f53c5e391d0a9a`.
Both requested refs were fetched, branch `gates` was reset to START, and
`git merge-base --is-ancestor origin/main HEAD` passed. Node **v24.21.0** was
checked in every shell. This is the requested **step 3 only** rerun. No full
suite, quick suite, routing-enabled gate or calculator-checker rerun was made;
the orchestrator reports CI already passed on this START. Only this audit changes.

**READY.** The earlier option-absent blocker used MAIN before G15. Current MAIN
contains G15, and the core/progress-provider files behind those differences
match START exactly. The previous 404-to-200 fallback and web-request differences
are G15 behavior present on both sides, not a lane regression. The historical
blocked dispositions below are superseded by this result.

### Exact parity evidence

| Check | MAIN | START | Differences / failures |
| --- | --- | --- | --- |
| API/auth/data literal inventory | 119 literals | All 119 retained | 0 missing |
| Copied-save open, close, reopen, close | 772,989 bytes; 435 gameplay files | Same bytes and content-hash inventory | 0 save, reopen or content-hash differences |
| Option-absent extended real-save HTTP | 16 responses, all 200 | 16 responses, all 200 | 0 status, raw-body, size or save differences |
| Synthetic guarded-route matrix | 32 responses | 32 responses | 0 status or raw-body differences |
| Nine focused test files | 109 passed, 0 failed, 0 skipped | 109 passed, 0 failed, 0 skipped | 0 failures, cancellations or TODOs |
| Ordinary synthetic progress-sync traces | 8 traces | 8 traces | 0 byte differences |
| Fresh live-plugin progress probe | 2 web requests | 2 web requests | 0 snapshot-byte differences |
| Synthetic fallback `/api/runemetrics/preview` | 200, 2 upstream requests, 1 skill row | 200, 2 upstream requests, 1 skill row | 0 status or raw-body differences |

The route matrix covers GET and POST with and without administrator authorization
for `/api/operator/relink-code`, `/api/operator/service-snapshot`,
`/api/picker/delete`, `/api/account/delete`, `/auth/claim`, `/auth/reclaim`,
`/auth/reclaim/signin`, and `/auth/reclaim/done`. It verifies that the additional
multiplayer route surface preserves option-absent responses. The static inventory
is supporting coverage, not a semantic proof of every possible request.

The nine focused files are `signin-server.test.mjs`, `signin-provider.test.mjs`,
`backup-import-server.test.mjs`, `plugin-reads-server.test.mjs`,
`game-plugin-routes.test.mjs`, `runemetrics-server.test.mjs`,
`progress-sources.test.mjs`, `runemetrics.test.mjs`, and
`progress-providers.test.mjs`. These exercise sign-in, saved-state/import/restore,
backups, plugin endpoints and progress sync under each tree's normal test policy.
They took **34.26 / 31.90 seconds** on MAIN / START. Sign-in remains off by default;
registry and picker-limit creation remain conditional on `multiPicker`; this
comparison omits that option entirely.

### Real-save comparison method and counts

Every server opened a temporary copy. The source remains **766,384 bytes**,
SHA-256 `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
MAIN and START independently perform the same normal catalogue refresh and
produce **772,989 bytes**, SHA-256
`29cdb0ffbbcaeb43becf13560efd6ad29c13671d8b1776e6d017ca54ed837c5f`.
Each result is stable after reopening; the **435-file** gameplay content-hash
inventories match exactly, including retained history and backup contents.

The extended HTTP comparison uses fresh copies of the same MAIN-prepared input,
which gives both trials identical retained backup IDs. It compares full/play
state, history, browser plugin status, session, gameplay export, backup listing,
backup status, rules, the data-module route, both members' full/play tasks and
native plugin status. The existing public compatibility harness was copied to
scratch, restricted to option absent, and instrumented to retain response status.
All response bytes remain intact. Its existing performance-clock preload and
identical store clock are retained. It compares **170,530,354 response bytes per
side**, with **0** status, body-hash, size or rewritten-save differences; the
prepared source hash is unchanged. This is step 3 evidence, not a new claim about
the routing-enabled or calculator gates on this START.

### Targeted G15 probes and measurements

Both revisions' fresh-plugin snapshots are **2,909 bytes**, SHA-256
`9872123c87c9bb1b3e24c0f1784f12a3b4736144756bca3661b83ef5df8ddf81`.
The synthetic fallback HTTP bodies are **531 bytes**, SHA-256
`a23794f4e12cb302bfdb10765b0a0d07a862620570580c6781c48c5931ed5903`.
The HTTP fixture supplies an identical fixed clock and UUID on both sides so
preview IDs are deterministic; no response fields are removed or normalized.
Both probes pass exact equality assertions, including the expected **200**
fallback status. There is no remaining differing route or introducing commit
to attribute.

The existing ordinary sync comparison matches **71,755 bytes**, SHA-256
`a29e471cddaf6d16792ecb05d3695535a77f62ee7e96523f6d0a811c15b6f3bd`.
Seven synthetic repetitions give MAIN median **7.046 [5.601–7.837] ms** and START
**6.274 [5.505–8.139] ms** (min–max), with combined-process peak RSS
**84,252 KiB**. The real-save HTTP trials took **32.24 / 35.52 seconds**;
harness-reported sampled process-tree RSS peaks were
**1,604,743,168 / 1,472,499,712 bytes**, MAIN / START. Those one-sample compatibility
observations include fixed clocks and some overlapping focused-test activity;
they are not a performance or capacity conclusion. Memory was checked against
the **16 GiB** limit before overlapping small synthetic checks.

The private checkout has **0 changed files**; its source hash remains unchanged.
No private inputs or response bodies were copied into the public repository.
Temporary drivers and private copies were removed. Public sign-up remains off.
All requested step 3 comparisons pass; no application change was necessary.

MERGE-CANDIDATE

READY


## Previous gate rerun against pre-G15 MAIN (historical)

START: `746766b55628b16431c6436c7cb16ba91e128f8e`.
MAIN: `18c9ecdd8bf2df7cc03ee06fe9a3cff91b2dba3d`.
The requested refs were fetched, local branch `gates` was created from the lane,
and `git merge-base --is-ancestor origin/main HEAD` passed. All commands used
Node **v24.21.0**. Nothing was pushed. This rerun changes only this audit.
The earlier test and pack-input blockers below are superseded by these results.

### Required full suite

`npm test` ran once: **663 files, 6,137 passed, 0 failed, 140 skipped**, no
cancellations or TODOs, in **533.69 seconds**. There were no failures requiring
standalone attribution on MAIN, and no socket or PID-1 exceptions were needed.
No application or test files changed, so the application-change quick-suite
requirement did not apply; no additional full or quick run was made.

### Real-duo checker and startup preservation

The unchanged checker and reference adapter are pinned to
`2856d0d8d19b49c4d36718bbb2cff1d61e080610` in temporary roots. Their application
roots point directly to exact MAIN and START. Seed **17**, default request caps,
sequence **8**, `limits.save: 1`, and serial reference/candidate calculators were
used. As in the earlier multiplayer gate, routing selects the server preparation
path; the adapter itself has no routing option. Each preparation was opened,
closed, reopened and closed with process workers and identical fixed store time.

| Routing in preparation | States | Comparisons | Differences | Errors | Duration (s) | Reported calculator peak RSS, MAIN / START (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Absent | 1 | 36 | 0 | 0 | 388.72 | 5,423.21 / 5,837.71 |
| Present | 1 | 36 | 0 | 0 | 395.70 | 5,666.72 / 5,261.17 |

Both engine-version hashes, in both runs, are
`3a137c4d14b5ea378ffdb32dcb4436ac6752a9e8de8f39f89c68d654d90c43eb`.
Corpus manifest SHA-256, routing absent:
`0a754d53948a192d45c868ecefc30779bc5d0aba374328a9c366d69b605dc0c4`;
routing present:
`99fbb6be87276d25cd3ac5c43ba77e3536b29d4e4029445e35affaafca17597c`.
The inventories contain **415** retained states and **0** uncovered history
revisions; only the current state is selected. This is the multiplayer gate,
not a full-history engine gate. The manifest includes backup filenames; independent
startup creates one random backup ID, so these inventory hashes differ despite
**0 content-hash inventory differences**.

The source is **766,384 bytes**, SHA-256
`64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`.
Current MAIN performs a catalogue refresh. All four configurations produce the
same **772,989-byte** result, SHA-256
`29cdb0ffbbcaeb43becf13560efd6ad29c13671d8b1776e6d017ca54ed837c5f`.
There are **0 cross-tree save differences** and **0 reopen differences** across
all eight open/close cycles. The serialized source-to-MAIN comparison counts
**37 additions, 0 removals and 23 changed values**; START is identical to MAIN.
All **431** source gameplay files remain present; each prepared tree has **435**
files, **4 added files, 0 missing source files and 1 changed source file**.
The prepared gameplay trees have **0 content-hash inventory differences**;
relative to the first preparation, each subsequent tree has **1 missing and
1 extra path**, the generated backup ID, with **0 changed hashes at common paths**.
The original private checkout has **0 changed files** and its source hash is
unchanged. No private input entered this repository.

### Extended HTTP gate

The existing `scripts/perf/duo-compatibility.mjs --extended` ran against exact
MAIN and START in both routing modes. Its source was the copied save after
MAIN's normal refresh above, so every trial started with identical retained
backup IDs. Fresh private copies were made for every trial. No response fields
were removed or normalized; the existing performance-clock preload and identical
store clock were used. The prepared source hash remained unchanged.

| Routing | Paired responses | Response / size / save differences | Response bytes per side | MAIN / START duration (s) | Harness-reported sampled tree RSS, MAIN / START (MiB) |
| --- | ---: | --- | ---: | ---: | ---: |
| Absent | 16 | 0 / 0 / 0 | 170,530,354 | 30.41 / 29.80 | 1,532.68 / 1,448.73 |
| Present | 15 | 0 / 0 / 0 | 170,530,196 | 29.76 / 30.85 | 1,447.63 / 1,533.89 |

All four final saves remain **772,989 bytes** with the prepared source hash above.
These are one-sample compatibility timings with fixed clocks, not performance
medians or capacity measurements. Calculators were serial in the direct checker;
the enabled HTTP workload used its normal pool within the checked **16 GiB** limit.

### Option absent: passing coverage and a remaining difference

The route inventory finds **119** API/auth/data literals in MAIN's server and
**0 missing** from START's server/context/router helpers. This is supporting
coverage, not semantic proof. Sign-in still defaults to off; registry and picker
limits remain conditional on `multiPicker`, and the absent path dispatches to
the legacy context. The extended gate above checks state, history, tasks,
session, export, retained backups, backup status, rules, data-module and plugin
reads with **0 differences**.

Eight focused files ran separately on each tree under its normal test policy:
`signin-server.test.mjs`, `signin-provider.test.mjs`,
`backup-import-server.test.mjs`, `plugin-reads-server.test.mjs`,
`game-plugin-routes.test.mjs`, `runemetrics-server.test.mjs`,
`progress-sources.test.mjs`, and `runemetrics.test.mjs`.
MAIN: **83 passed / 0 failed / 0 skipped**, **29.57 seconds**.
START: **84 passed / 0 failed / 0 skipped**, **30.67 seconds**.
These cover sign-in, save/import/restore, plugin endpoints and progress sync,
but each tree's tests encode its own provider behavior.

The existing synthetic `progress-sync-comparison.mjs` matches **8 traces**, with
**0 byte differences**, **71,755 bytes**, SHA-256
`a29e471cddaf6d16792ecb05d3695535a77f62ee7e96523f6d0a811c15b6f3bd`.
Seven timing repetitions give MAIN median **6.674 [6.365–8.302] ms** and START
**7.291 [6.031–10.385] ms** (brackets are min–max); combined-process peak RSS is
**91,820 KiB**. This small synthetic path is not a real-pack footprint benchmark.

However, exact option-absent parity with MAIN **does not hold**. Two additional
synthetic comparisons reproduce G15 changes already present in START:

- With a fresh live plugin observation, MAIN returns it without fetching the
  web (**0 requests**); START fetches and overlays web data (**2 requests**).
  Snapshot hashes differ: MAIN
  `f0f9a2ab12335ea7b004d278cf74c99c969ab532718f6c0adb7cf41c17b15e36`, START
  `16fdcf09750612c9d5423a238bc604236e6f4ff6eab9ad760ce16e7c4126c9cd`.
- A synthetic HTTP `/api/runemetrics/preview` request, with no `multiPicker`,
  receives a provider 404 and a configured synthetic Hiscores fallback.
  MAIN returns **404** with **0** skill rows; START returns **200** with **1**.
  Both make **2** upstream requests. This is **1 differing HTTP case**.
  The probe uses the same default dataset as the progress-server tests; an
  initial open-f2p setup refused this capability with **422 on both sides**
  before any provider request and was not used as parity evidence.

These differences follow `app/integrations/progress-sources.mjs` and the
unconditional progress-client construction in the legacy context. They are
existing G15 behavior, not a failing merge resolution. The previous gate used
MAIN+G15 as its compatibility baseline; this task explicitly requires exact MAIN.
No core/integration behavior or assertions were changed to hide the difference.

### Historical disposition

The inherited red-suite and missing-input blockers are closed: the full suite,
both real-duo checker modes, and the extended HTTP gate all pass. **BLOCKED** on
the requested exact-MAIN option-absent progress-sync guarantee.

Required resolution: land the reviewed G15 behavior on MAIN through its owning
change, or explicitly amend the gate brief to allow those provider differences,
then rerun against the agreed baseline. G15 also changes
`app/core/state.mjs`, `app/core/game-progress.mjs`, and
`app/integrations/progress-sources.mjs`; those core/integration files are outside
this multiplayer gate's ownership, so no G15 behavior repair was attempted here.
Public sign-up
remains disabled. Historical launch/operations deferrals below remain separate
from this compatibility blocker.

NEEDS-WORK

BLOCKED

## Previous gate record (historical)

START: `3b1577232a6a51f77de168497ee6d03ff8096353`.
LANE: `c325f31fb9812cfc6b44e9b08279e4af7ee60fd0`.
MAIN: `a46ec91806327e01ef0e24d1f6947497b3a6c04b`.
G15: `fd262bb746e9eef10b1a3471489ab001b6e287f0` (not an ancestor of MAIN).
Node v24.21.0. Local branch `mp-main`; nothing published.

The main and G15 merges were resolved sequentially, then consolidated into one
real merge with LANE, MAIN and the exact G15 commit as parents. The comparison
baseline is a separate untouched MAIN worktree with G15 merged in. The
rehearsal tree at `68a0765dfcb1700d77ad281c43f6d361685a8a16` supplies the earlier
resolutions and this audit's readiness inventory.

## Conflicts and resolutions

| Merge | File | Resolution |
| --- | --- | --- |
| MAIN | `app/server.mjs` | Reuse rehearsal extraction; preserve MP15 reclaim routing. Main's new saved-task-details error and public code move into `app/picker-context.mjs`, alongside the rehearsal's Slayer data-module allowlist fix. |
| MAIN | `app/game-plugin.mjs` | Rehearsal union of main's active-location cleanup and the lane's sequence, bucket, status, task and pending cleanup. |
| MAIN | `app/web/backup-transfer.mjs` | Keep main's streaming preparation, cancellation and upload-progress transport plus the lane's injectable scoped backup download. Session transport fix described below. |
| MAIN | `app/web/duo-task-view.mjs` | Keep main's read-only row behavior and the lane's picker-scoped storage. |
| MAIN | `app/web/screen-dialogs.mjs` | Keep main's cancellation, progress and duplicate-submit prevention together with the lane's owner restore scope/warnings and scoped download. |
| MAIN | `scripts/linux/operator.mjs` | Rehearsal CLI union, extended for MP15 `relink-code`; quiet skipped health, main's lock/maintenance/additions diagnostics and the lane's structured service output/refusal all remain. |
| MAIN | `scripts/test-selection.mjs` | Union all classifications from both sides, including main's latest correction/integrity files and MP15 account reclaim. |
| MAIN | `tests/backup-transfer.test.mjs` | Retain both owned upload wire/decompression bounds and main's cancellation/progress tests without weakening assertions. |
| G15 | `app/server.mjs` | Keep extracted server. Import/use G15 `mergePluginProgress` in `app/picker-context.mjs`, where each context owns `createProgressSources`; retain G15 provider modules and policy unchanged. |
| G15 | `scripts/test-selection.mjs` | Union G15 provider classification with all multiplayer files. |

Review also caught a cleanly merged regression: the new XHR upload branch in
`screen-commands.mjs` bypassed picker-session preflight, binding and cancellation.
`screen-save-status.mjs` now accepts an explicit transport inside its existing
session wrapper; `backup-transfer.mjs` dispatches XHR through that wrapper and
copies `Headers` correctly. Normal option-absent XHR progress behavior and the
original injected-fetch argument remain.
The scoped XHR test checks the header, preflight refusal after a picker switch,
and in-flight abort when the document retires. An additional fallback test checks
that the caller-supplied fetch survives the same transport wrapper without XHR.
The G15 context test checks
identical bindings, independent web caches, preview refusal and independent close.

The registry, picker router, sign-in, service recovery and service operator files
that implement SC3, MP8C and MP15 match LANE exactly. MP15 server reclaim hunks
are retained in the resolved server. No calculator-computation or pack changes are introduced
by the resolutions. Incoming main/G15 core behavior is retained; changelog and
roadmap receive no integration edits.

## Validation

An intermediate quick suite ran 313 files: **2,906 passed, 1 failed, 68 skipped** in
230.99 seconds. The
initial quick run, before the upload repair, passed 2,905 with 1 failure and 68
skips in 239.65 seconds. Its sole failure is the pre-existing viewer assertion in
`tests/chunk-tabs.test.mjs:129`: the viewer row is now a status span while the
assertion still expects a disabled checkbox. The file fails 5/1 alone in the
merged tree, on exact MAIN, and on MAIN+G15, with the same assertion; it passes
6/0 on exact LANE. The relevant test/UI files are unchanged by G15. No assertion
or skip policy is weakened to hide it.

The 8 focused option-absent MAIN+G15 files pass 93/0 with no skips in 31.23
seconds: sign-in server/provider, backup/import, plugin reads/routes, RuneMetrics
server, provider policy and progress-source cases.


The full run's six prediction-golden failures also reproduce alone on exact
MAIN. Standalone `prediction-output.private.test.mjs`: merged 1/6, MAIN 1/6,
LANE 7/0, with no skips. These are synthetic fixture hash snapshots, not
real-save comparisons. The task-reference assertion also reproduces alone (merged and MAIN 24/1;
LANE 25/0). The engine implementation and golden assertions remain
unchanged by this integration. The current-duo direct checker remains a separate
required comparison against MAIN+G15.

| Failure attribution | Merged standalone pass/fail | Exact MAIN | Exact LANE |
| --- | ---: | ---: | ---: |
| `chunk-tabs.test.mjs` viewer assertion | 5 / 1 | 5 / 1 | 6 / 0 |
| `prediction-output.private.test.mjs` golden snapshots | 1 / 6 | 1 / 6 | 7 / 0 |
| `tasks.test.mjs` full-reference assertion | 24 / 1 | 24 / 1 | 25 / 0 |
| `presentation.private.test.mjs` presentation assertions | 4 / 2 | 4 / 2 | 6 / 0 |
| `processing-chains.test.mjs` partial-products assertion | 8 / 1 | 8 / 1 | 9 / 0 |
| `web-browser.test.mjs` under its open-f2p policy | 337 / 1 | 336 / 1 | 335 / 0 |

The first full diagnostic was interrupted after the standalone browser file
confirmed a stalled non-XHR backup fixture: the first session-wrapper repair
had lost its caller-supplied fetch. The correction preserves the original third
fetch argument and adds the session wrapper separately. The complete unchanged
browser fixture file then passed **338/0**, and the two focused upload/session
files passed **41/0**. Required quick/full suites were restarted after this last
application correction; final complete results are recorded below.

### Final required suites

The final quick suite ran 313 files: **2,907 passed, 1 failed, 68 skipped**, no
cancellations or TODOs, in **243.27 seconds**. The only failure is MAIN's viewer
assertion above. The final full suite ran 663 files: **6,125 passed, 12 failed, 140 skipped**,
no cancellations or TODOs, in **573.53 seconds**. All 18 P1 acceptance cases pass.
All 12 failures reproduce on exact MAIN; no remaining merge-created test failure
was observed. The native socket/PID-1 exceptions were not needed.

The suite-policy browser rerun has **337 passed / 1 failed** in 124.10 seconds.
Its additional failure is `simple rule toggles queue after local saves and use
the resulting revision`; exact MAIN also fails this case under the existing
open-f2p policy (**336/1**, 124.71 seconds), while exact LANE passes **335/0**
in 4.96 seconds. The bare direct browser run's
338/0 result uses its default dataset and is not substituted for the policy run.
This is a sixth failure-attribution file, not an upload regression; the backup
cancellation and viewer-details cases pass under the suite policy as well.

## Option absent: evidence

`app/server.mjs` still defaults sign-in to off, creates picker limits and registry
only with `multiPicker`, passes original worker options without it, and dispatches
directly to the legacy context when routing is absent. A route inventory of
MAIN+G15's server found 116 API/auth/data route literals; 0 are missing from the
merged server/context/router helpers. This inventory supports coverage but is
not a semantic proof. The focused baseline and merged suites cover sign-in,
save/backup/import, plugin routing and progress-sync behavior. The extended HTTP
gate is configured for exact raw responses and saved bytes, but remains blocked
as described below. Reclaim routes remain gated.

## Real-data compatibility blocker

The supplied released selection has **95 required inputs, 1 missing required
input and 0 extra inputs** against current MAIN's catalogue. Exact LANE loads
it successfully (dataset SHA-256
`3768ecbd4197cab2f42241ebd631904d2871bded05858a0bcb535eeba0b1898f`).
Exact MAIN, MAIN+G15 and the merged tree each refuse it with
`DATASET_PACK_INVALID` before opening a store. The public change adding a
required input is in MAIN's `app/dataset-inputs.mjs`; this is not a merge conflict
or a G15 change.

Both direct checker attempts stop with **0 states, 0 comparisons and 1 error**
each. The extended HTTP gate stops during baseline startup, with **0 paired
responses**; neither routing mode has a passing real-data result. These are
blocked gates, not zero-difference passes. No calculator results or real-pack
performance measurements are claimed. The initial copied preparation directory
was never opened. No validation, corpus cap, golden snapshot or dataset binding
was changed to get around this refusal.

A compatible released selection and matching save binding must be supplied for
current MAIN, or the dataset owner must resolve MAIN's catalogue compatibility.
Changing dataset allowlists, rebuilding private releases or repinning real save
bindings is outside this integration's scope. The public/private checkouts are
kept separate. The private checkout has 0 changed files.

### Supplementary public-input comparison

A separate generated open-f2p comparison passes **6 states, 107 comparisons,
0 differences and 0 errors**, with seed 17, default request caps, sequence 8 and
serial calculators. The generated-state sample cap is explicitly 6; this is
supplementary coverage, not the required real-duo gate or an engine full-corpus
claim. The unchanged checker/reference adapter is pinned to
`2856d0d8d19b49c4d36718bbb2cff1d61e080610`; scratch adapter roots point to
MAIN+G15 and the merged app. Manifest SHA-256:
`d92f751dde1e4e7d5c3123c4adb3f91d90166b14ef43dbbe7cf6d10b67d98fd8`.
Both engine-version hashes are
`3a137c4d14b5ea378ffdb32dcb4436ac6752a9e8de8f39f89c68d654d90c43eb`.
Elapsed duration is 3.97 seconds; reported calculator RSS peaks are
302,993,408 / 303,779,840 bytes. This ran alongside tests and is correctness
coverage, not a performance comparison. Real-data validation attempts had
1,215,827,968 bytes resident against a 17,179,869,184-byte container limit before
starting; no two real calculators ran concurrently (validation refused first).

## Readiness and remaining work

| Disposition | Item | Source |
| --- | --- | --- |
| Before merge / real-data gates | Supply a released selection and binding compatible with current MAIN, then rerun the checker in both routing modes and extended HTTP gate. Current attempts never reach comparisons. | Real-data compatibility blocker above |
| Before merge / core CI | Resolve MAIN's inherited viewer, prediction-golden, task-reference, presentation, processing and suite-policy browser assertion failures in their owning changes. This integration preserves them and has no reproduced merge-created failure. | Standalone attribution table above |
| Before enabling public sign-up | Owner approval is outstanding; keep sign-up disabled. The code defaults to sign-in off and no `multiPicker`. | `docs/rebuild-lanes.md`; `docs/audit/mp12-c2.md`; `app/server.mjs` |
| Before public launch | Implement and configure finite service/off-host backup expiry; disclose it through `backupRetentionMs`. Preserve external tombstones beyond every restorable backup. The app's disclosure is not an expiry implementation. | `docs/multi-picker-contract.md`; `docs/audit/mp12-c1.md` |
| Closed by this merge with G15 | Each context constructs and closes its own provider client and preview map. RuneMetrics caches/pending requests are local; default official API is stateless and Hiscores abort controllers are local. Post-fetch plugin reconciliation uses G15 against the latest local member. | `docs/multi-picker-contract.md`, G15 reconciliation note; `app/picker-context.mjs`; `tests/picker-context.test.mjs`; `tests/runemetrics-server.test.mjs` |
| Closed by SC3 | Startup refuses a missing registry beside a used external ledger; the registry is never silently recreated across that boundary. | `app/storage/registry.mjs`; `tests/registry.test.mjs` |
| Closed by MP8C | Quarantine-release digest repair uses its release journal, preserved probed source/binding and explicit manual reset. It does not reinstall pre-probe backup bytes under post-probe digests. | `scripts/linux/service-recovery.mjs`; `tests/linux-multi-picker.test.mjs` |
| Closed by MP15 | Private `relink-code` issuance and the OAuth reclaim flow restore identity links after recovery. Codes are single-use, expiring and excluded from backups. Empty-default retirement is serialized and gameplay-bearing sources refuse. Option-absent reclaim remains unavailable. | `docs/multi-picker-contract.md`, MP15; `tests/account-reclaim.test.mjs`; `tests/phase1-acceptance.test.mjs` |
| Before service cutover | Build and exercise an isolated whole-service rehearsal with copied and repinned registry, picker roots and external ledger. The existing single-source rehearsal correctly refuses this configuration. | `docs/multi-picker-contract.md`; `docs/linux-operator.md`; `docs/audit/mp12-c1.md` |
| Before rollback after enabling routing | Plan session resets and plugin-key resets for older binaries; require a ledger reader that understands deletion progress. Never discard ledger fields to make an old binary start. | `docs/multi-picker-contract.md` |
| Follow-up lifecycle refinement | Directory-keyed snapshot barrier entries are retained when idle. Ownership through operator APIs and idle-entry eviction remain deferred; preserve the shared rendezvous until replaced safely. | `docs/multi-picker-contract.md` |
| Follow-up compatibility review | The legacy compatibility handle and existing world/input-scoped core caches retain their original lifetime/scope. Evicted owned contexts drop their references. Core cache changes require their own lane. | `docs/multi-picker-contract.md` |
| Follow-up product scope | Owner invitation and overlay administration remains operator-only. Any expansion needs explicit scoped owner routes/UI; owner status must not imply operator administration. | `docs/multi-picker-contract.md` |
| Follow-up version support | Phase 1 uses one dataset version per process. Simultaneous versions require an explicit runtime boundary and a global version-residency cap. | `docs/multi-picker-contract.md` |
| Before raising operating limits | Seven contexts/two calculators is the documented default. Eight mixed contexts exceed the conservative memory allowance; simultaneous saves, full views, rule diversity and eviction churn need separate measurements. Small footprint reruns do not establish service capacity. | `docs/multi-picker-contract.md` |
| Follow-up scheduler limitation | An active synchronous calculation is not preempted; fair queues cannot guarantee a shorter latency than its completion/watchdog. | `docs/multi-picker-contract.md`; `docs/audit/mp12-c2.md` |
| Follow-up performance | Historical cold CPU increase and state-response GC/serialization variation remain incompletely attributed. The single bulk-gzip-prefix proposal is unapplied and is not a proven regression repair. | `docs/multi-picker-contract.md` |
| Follow-up operator scaling | Very large service copies can exceed the 120-second operator HTTP timeout and leave private spool evidence requiring inspection before retry. | `docs/multi-picker-contract.md` |
| Follow-up resource-abuse measurements | Maximum-size import object-graph amplification is unmeasured. General bodies have no separate per-account concurrent-body count; raw socket/file-descriptor exhaustion was not attempted. | `docs/audit/mp12-c2.md` |
| Deployment-specific security follow-up | Installed private add-ons need the same source-binding review as core original sync. External proxy logging and live-provider OAuth integration are not established by the synthetic audits. | `docs/audit/mp12-a.md`; `docs/audit/mp12-b.md` |
| Platform follow-up | Native Windows execution was unavailable for the pool/recovery work; the historical native alternate-UID/GID ownership check needed root. Synthetic filesystem/fault sweeps do not replace those platform checks. | `docs/multi-picker-contract.md` |
| Recovery limitation to preserve | Ambiguous or older recovery journals require the named manual inspection/restart steps; do not infer successful installation from status or erase uncertain payloads. | `docs/multi-picker-contract.md` |
| Follow-up measurement | Repeat representative solo timings on full inputs. The historical 4.83% fresh-solo increase remains incompletely attributed; this merge's small synthetic rerun does not establish real-pack capacity or resolve that cause. | `docs/perf/picker-footprint.md` |

Closed audit findings remain closed: MP12A-1, MP12A-2 and MP12B-1 by MP13; MP12C2-1 and MP12C2-2 by MP14. C1 has no reproduced finding. MP15 closes identity relinking; this integration closes G15 reconciliation. Historical deferrals resolved by later sections are not open bugs. Public sign-up remains disabled.


## Measurements and disposition

The required footprint rerun is recorded in
[picker-footprint.md](../perf/picker-footprint.md#multiplayermain-integration-on-current-lane).
Three alternating synthetic pairs use normal clocks with all tests finished.
Two-member cold full-task median is 313.23 [296.80–347.80] ms before and
309.15 [290.37–316.81] ms after. Median sampled tree RSS is
109.28 [109.11–110.00] / 109.80 [109.79–109.93] MiB. Fresh-solo cold median is
325.37 [287.54–331.38] / 309.00 [298.87–332.34] ms, with median sampled tree RSS
107.71 [107.37–108.13] / 108.84 [107.50–110.20] MiB. Ranges overlap; this does not
establish a speed improvement or real-pack capacity.

**BLOCKED** for merge readiness: 12 inherited MAIN assertion failures must be
resolved in their owning changes, and compatible released inputs/binding must
be supplied before both real-duo checker modes and extended HTTP can pass.
The implementation, conflict resolutions and synthetic evidence are committed
for review. No engine/data fix, weakened test or validation bypass is included.
The private checkout has 0 changed files. Public sign-up stays off.

NEEDS-WORK
