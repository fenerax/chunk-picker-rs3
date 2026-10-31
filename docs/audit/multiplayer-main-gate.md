# Multiplayer into main: final integration gate

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
