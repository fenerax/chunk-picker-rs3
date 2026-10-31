# Multiplayer into main: merge rehearsal

START and MAIN: `3b1577232a6a51f77de168497ee6d03ff8096353`.
LANE: `c299c4fa012a4ec4dd8075a0ba354018c8331867`.
Node v24.21.0. Local `gate` branch; merge staged but not committed or published.

## Conflict resolutions

Four conflicted files; no unresolved paths.

| File | Conflict and resolution |
| --- | --- |
| `app/server.mjs` | Main's browser data-route addition overlapped the lane's extraction of the request handler. Retain the lane's server/context structure and carry `/data/slayer-unlock-gates.mjs` into the allowlist in `app/picker-context.mjs`. Blindly retaining the lane hunk would lose this main route. |
| `app/game-plugin.mjs` | Both branches extend close cleanup. Keep main's active-location cleanup together with the lane's item-task, sequence, bucket, status and pending-handled cleanup. Main's other plugin-location changes merge normally. |
| `scripts/linux/operator.mjs` | Both branches replace CLI reporting. Preserve main's quiet skipped-health success and lock/maintenance/additions diagnostics, plus the lane's structured service command output and clear incompatible-legacy refusal. Main's lock deadline and reviewed-additions enforcement remain intact. |
| `scripts/test-selection.mjs` | Both add quick tests at the same insertion point. Keep all four entries. Main's full-only Slayer test classification also remains. |

The merge-specific application fix is the moved data-module route. No calculator-computation, rules, state-command, pack, changelog or roadmap edits are introduced relative to MAIN. Other incoming MAIN changes are retained.

`scripts/perf/duo-compatibility.mjs` adds optional `--extended` comparisons for session, gameplay export, retained-backup listing, backup status, rules and the moved browser module. `scripts/perf/README.md` documents it. Session bytes are compared with routing absent; enabled session bindings are intentional contract additions. Default gate behavior is unchanged; only counts, sizes, hashes, differences and measurements leave copied private inputs.

## Validation

The merged quick suite ran once, then the full suite once, after the application resolutions. No assertions or skip policies were weakened.

| Merged suite | Files | Passed | Failed | Skipped | TODO | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `npm run test:quick` | 310 | 2,819 | 0 | 68 | 0 | 196.41 |
| `npm test` | 657 | 5,989 | 0 | 140 | 0 | 464.37 |

All 18 P1 acceptance cases pass, including six process-death provisioning cases and executable P1.8 service recovery. There are no merge-created failures and no observed baseline failures under the configured per-file policies to attribute. Neither the socket nor PID-1 exception was needed. Unchanged LANE was retained as a baseline worktree; a second entire baseline suite was unnecessary because the merged suites had no failures.

Temporary baseline worktrees pin MAIN and LANE; the reference adapter/checker is pinned separately to `2856d0d8d19b49c4d36718bbb2cff1d61e080610`, as specified by the contract. No engine-lane files are added to this tree.

The calculator comparison uses the unmodified pinned reference adapter twice, with its `app` root linked to MAIN or the merged tree. Seed 17, default request caps, sequence 8 and serial calculators are preserved. Each routing mode prepares fresh server copies before checking the current state; the retained inventory contains 414 revisions. All four preparation opens preserve the original state SHA-256 `64de39c55452925587b87af05aa01507513263761bc407f54e81bcbb699acfdc`. Preparation uses the existing compatibility gate's injected store time; direct calculator comparisons use the checker's documented volatile-field rules.

## Option absent: evidence

Without `multiPicker`, `app/server.mjs:139` constructs no picker limiter, `:224` keeps the original worker options, `:389` skips registry construction, and `:478` dispatches directly to the legacy context. Sign-in still defaults to `off` at `:106`. A source inventory found MAIN's 141 HTTP route literals in the merged server/context helpers with zero missing literals; this supports route preservation but does not establish every route's semantics.

The untouched MAIN worktree's sign-in, backup/import, plugin routing and plugin read files cover 45 unique cases. The sign-in and plugin files passed all 37 cases. The backup file passed 8/0 when run alone under its default dataset policy. All corresponding cases also pass in the merged full suite. This checks PKCE/provider claims, session restart/revocation, invitation access, authorization/origin rules, gzip/export/import/restore conflicts and undo, plugin keys/report isolation and completion-location retention.

An initial extra MAIN invocation mistakenly forced all four files onto open-f2p: 39 passed and 6 backup cases failed because that file is not classified open-f2p. Its corrected default-policy standalone run passed 8/0 in 4.78 seconds. These six diagnostic failures were invocation errors, not merge or baseline application failures. No assertions, policies or application code were changed to correct the command.

The first extended-probe run also compared enabled session bytes to MAIN, which has no enabled routing. Its only difference was the documented session binding addition (1 body difference, 1 size difference of 90 bytes, 0 save differences); all ten original duo routes and the other five added routes matched. The reusable extension now checks exact session bytes in the absent mode, as requested, while acceptance tests continue to validate enabled bindings. The original checker and all standard comparisons are unchanged.

## Readiness and remaining work

These are the remaining qualifications after reading the entire contract and all four audit documents. Historical deferrals resolved by later sections are not presented as open bugs.

| Disposition | Item | Source |
| --- | --- | --- |
| Before enabling public sign-up | Owner approval is outstanding; keep sign-up disabled. The code defaults to sign-in off and no `multiPicker`. | `docs/rebuild-lanes.md:66`; `docs/audit/mp12-c2.md:110`; `app/server.mjs:106` |
| Before public launch | Implement and configure finite service/off-host backup expiry; disclose it through `backupRetentionMs`. Preserve external tombstones beyond every restorable backup. The app's disclosure is not an expiry implementation. | `docs/multi-picker-contract.md:151`, `:1009`, `:1016`; `docs/audit/mp12-c1.md:44` |
| Before enabling multiple routed pickers with source sync | Explicitly close the RuneMetrics/member-name-cache reconciliation note against the replacement. Current source creates the progress client per context, closes it, and clears local previews; P1.3 tests colliding preview isolation. The contract still records a prerequisite without an explicit resolution, so this is a documentation/review follow-up rather than a reproduced leak. | `docs/multi-picker-contract.md:429`, `:1118`; `app/picker-context.mjs:233`, `:2013`; `tests/phase1-acceptance.test.mjs:247` |
| Before production service recovery | Add a private operator identity-relink command/procedure. Recovery preserves memberships but excludes provider identities; without relinking, returning users get a fresh default. The acceptance test uses the storage API as a stand-in. | `docs/multi-picker-contract.md:1781`; `docs/audit/mp12-c1.md:28`, `:44` |
| Before service cutover | Build and exercise an isolated whole-service rehearsal with copied and repinned registry, picker roots and external ledger. The existing single-source rehearsal correctly refuses this configuration. | `docs/multi-picker-contract.md:2482`; `docs/linux-operator.md:518`; `docs/audit/mp12-c1.md:42` |
| Before rollback after enabling routing | Plan session resets and plugin-key resets for older binaries; require a ledger reader that understands deletion progress. Never discard ledger fields to make an old binary start. | `docs/multi-picker-contract.md:665`, `:1027`, `:1419` |
| Follow-up lifecycle refinement | Directory-keyed snapshot barrier entries are retained when idle. Ownership through operator APIs and idle-entry eviction remain deferred; preserve the shared rendezvous until replaced safely. | `docs/multi-picker-contract.md:433` |
| Follow-up compatibility review | The legacy compatibility handle and existing world/input-scoped core caches retain their original lifetime/scope. Evicted owned contexts drop their references. Core cache changes require their own lane. | `docs/multi-picker-contract.md:439` |
| Follow-up product scope | Owner invitation and overlay administration remains operator-only. Any expansion needs explicit scoped owner routes/UI; owner status must not imply operator administration. | `docs/multi-picker-contract.md:1317` |
| Follow-up version support | Phase 1 uses one dataset version per process. Simultaneous versions require an explicit runtime boundary and a global version-residency cap. | `docs/multi-picker-contract.md:93` |
| Before raising operating limits | Seven contexts/two calculators is the documented default. Eight mixed contexts exceed the conservative memory allowance; simultaneous saves, full views, rule diversity and eviction churn need separate measurements. Small footprint reruns do not establish service capacity. | `docs/multi-picker-contract.md:1875`, `:1885`, `:1894`, `:2105` |
| Follow-up scheduler limitation | An active synchronous calculation is not preempted; fair queues cannot guarantee a shorter latency than its completion/watchdog. | `docs/multi-picker-contract.md:1438`; `docs/audit/mp12-c2.md:18` |
| Follow-up performance | Historical cold CPU increase and state-response GC/serialization variation remain incompletely attributed. The single bulk-gzip-prefix proposal is unapplied and is not a proven regression repair. | `docs/multi-picker-contract.md:1694`, `:1747`, `:1753` |
| Follow-up operator scaling | Very large service copies can exceed the 120-second operator HTTP timeout and leave private spool evidence requiring inspection before retry. | `docs/multi-picker-contract.md:2204`, `:2433` |
| Follow-up resource-abuse measurements | Maximum-size import object-graph amplification is unmeasured. General bodies have no separate per-account concurrent-body count; raw socket/file-descriptor exhaustion was not attempted. | `docs/audit/mp12-c2.md:42`, `:43`, `:107` |
| Deployment-specific security follow-up | Installed private add-ons need the same source-binding review as core original sync. External proxy logging and live-provider OAuth integration are not established by the synthetic audits. | `docs/audit/mp12-a.md:24`, `:37`; `docs/audit/mp12-b.md:18` |
| Platform follow-up | Native Windows execution was unavailable for the pool/recovery work; the historical native alternate-UID/GID ownership check needed root. Synthetic filesystem/fault sweeps do not replace those platform checks. | `docs/multi-picker-contract.md:2069`, `:2579`, `:2784` |
| Recovery limitation to preserve | Ambiguous or older recovery journals require the named manual inspection/restart steps; do not infer successful installation from status or erase uncertain payloads. | `docs/multi-picker-contract.md:2718`, `:2732` |
| Follow-up measurement | Repeat representative solo timings: the fresh-solo cold median rose 4.83% in three synthetic pairs, with barely separated wall ranges and overlapping CPU ranges. No cause or capacity change is established. | `docs/perf/picker-footprint.md:679` |

Closed audit findings: MP12A-1 and MP12A-2 are fixed in MP13 (`docs/audit/mp12-a.md:43`); MP12B-1 is fixed in MP13 (`docs/audit/mp12-b.md:51`); MP12C2-1 and MP12C2-2 are fixed in MP14 (`docs/audit/mp12-c2.md:54`). C1 has no reproduced finding (`docs/audit/mp12-c1.md:10`). Older requests for authenticated routing, fair sharing, browser isolation, deletion, MP5 recovery integration and executable P1.8 coverage have later implementations; their old “pending” text is historical. The 414-state engine corpus remains an engine-lane gate, separate from the current-duo multiplayer gate (`docs/multi-picker-contract.md:1629`).

## Completed compatibility and measurement gates

Both direct checker modes passed: 1 state, 36 comparisons, 0 differences and 0 errors each. The extended HTTP gate passed in both modes: 16 paired raw responses absent and 15 present, 0 body/size/save differences. The four server preparation opens and all four HTTP saves preserve the source state hash. The private checkout has 0 changed files.

The full measurements, seed, hashes, durations, memory peaks and three-pair synthetic median/range table are in [picker-footprint.md](../perf/picker-footprint.md#multiplayermain-merge-rehearsal). Standard checker request caps and every test assertion remain unchanged. No check is skipped to obtain green.

MERGE-CANDIDATE for the staged rehearsal. READY-WITH-FOLLOWUPS: the remaining items above concern documented lifecycle/product work, deployment/recovery preparation and public enablement; public sign-up remains off.
