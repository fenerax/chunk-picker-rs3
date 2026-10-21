# M7 preparation evidence

Date: 2026-10-15. This work prepares milestone 7 of the
[public/private split plan](public-private-split-plan-2026-10-13.md).
It does not execute the live cutover, repository move, publication or a push.
The existing hosted picker, live storage, selected packs and saved access remain
unchanged. The expanded shadow, browser/gallery checks and final private full
suite passed. Cutover remains a separate operator action.

The [development layout and operator procedure](public-core-m7-layout-2026-10-15.md)
defines the proposed public shared source, private companion, initial handover,
ongoing release commands, secured operational snapshot and rollback. The
[M6 report](public-core-shadow-2026-10-14.md) remains the previous accepted shadow
baseline; this report records the additional M7 preparation evidence.

## Public artifact identity

The final local artifact is
`C:/Users/User/Projects/chunk-picker-rs3-public-m7prep-final`.

| Identity | Value |
| --- | --- |
| Export source | `14a1834ddad7d1e7d7a76153109ae5fd25f37a43` |
| Public commit | `27ceb4f9a83fc74a6072eea5d14f5e3a79d8d7ba` |
| Public Git tree | `09ea518e159414ea7c167ac7ddaba74195c5abb6` |
| Output tree SHA-256 | `888f48c834aa8d7564f90ced26ac37cb4159727028470dda70f28e58a2ccf776` |
| Exported files | 643 |
| Fresh history | One commit; zero remotes |
| Installed profile SHA-256 | `73b71c61e21f4b496d95844340103f0fe598316c6ec9c0682e98ee4a9d4ae68f` |
| Installed addon manifest SHA-256 | `07ed88d49d8d84235aa01152ea74bb1760ee9dbd729940513e4be44848be1564` |

The [final export receipt](../../.local/m7prep/candidate-final.json) records a
clean scan and rejected planted-leak variants using seven private fingerprints. A
[re-export from source `057a81648915e0867c3b196e432a6644741cd593`](../../.local/m7prep/candidate-reexport.json)
produced the same 643-file bytes, output digest, Git tree and public commit.
The [comparison receipt](../../.local/m7prep/reexport-comparison.json) also records
a clean scanner and passing private negative checks. A final
[working-tree audit](../../.local/m7prep/final-artifact-audit.json) checked all
643 files, including ignored files, against the receipt. After removing only
93 synthetic binding sidecars left by the public tests, the tree has no extra,
missing or changed files. A byte-verified projection of those exact files
[scanned clean again](../../.local/m7prep/final-scan.json), with zero findings.
The [final source audit](../../.local/m7prep/current-public-input-audit.json)
also confirms all 643 public inputs still match after private-helper changes;
three Windows checkout files differ only by CRLF, with matching Git blobs.

## Private utilities and companion

The pinned executable addon restores all three M6 utility omissions: original
sync/import/migration review, development gallery, and private changelog/roadmap.
The shadow compares the complete runtime capabilities without normalizing away
those groups. [The runtime loader](../../app/private-addon.mjs) requires explicit
absolute `RS3_PRIVATE_ADDON` and SHA-256 selection; its private code/data payloads
are manifest-pinned. The inert dataset profile remains a separate pinned input.
An operator-selected addon executes trusted private code; it is not a sandbox
for untrusted extensions.

[The companion builder](../../scripts/build-private-companion.mjs) created
`.local/m7prep/companion` with the private source/test/tool complement. Shared
application source is taken from the public core for disposable check assemblies;
the private complement must not overwrite shared application files. Complete
private tests remain private, including the original scenarios behind public
fixture transformations. [Installation verification](../../.local/m7prep/verify-install.log)
passed for 15,398 manifest-listed pack payloads and the pinned profile/addon.
Rebuilding the [profile](../../.local/m7prep/companion-profile-build.log) and
[addon](../../.local/m7prep/companion-addon-build.log) from the companion without
the old repository produced the identical digests above. No installed pack was
rebuilt or selected for live use.

The executable workflow is in
[companion-check.mjs](../../scripts/private-companion/companion-check.mjs),
[verify-install.mjs](../../scripts/private-companion/verify-install.mjs), and
[gallery-check.mjs](../../scripts/private-companion/gallery-check.mjs).
[Ship-Core.ps1](../../scripts/private-companion/Ship-Core.ps1) preserves the ongoing
full-suite → stop → data verification → start sequence, with paired suites,
unchanged-revision checks and retained private stage logs. Start, Stop and
Rollback share exact process/listener ownership checks in
[Operator-Common.ps1](../../scripts/private-companion/Operator-Common.ps1).
Failed data verification leaves the writer stopped; rollback never copies an
older save over accepted progress.

Ship keeps immutable previous and candidate configurations separate when private
profile/addon pins change. The previous configuration identifies the current
writer for Stop; only the candidate is compared to the new companion receipt.
Both configurations and the shared revision are rechecked before Stop and Start.

## Recorded verification

| Check and retained evidence | Result |
| --- | --- |
| [Public quick](../../.local/m7prep/public-quick-final.log) | 1,125 passed; one optional skip; zero failures |
| [Public full](../../.local/m7prep/public-full.log) | 2,363 passed; one optional skip; zero failures |
| [Initial private quick](../../.local/m7prep/private-quick.log) | 1,435 passed; one optional skip; zero failures |
| [Companion-assembled private quick](../../.local/m7prep/companion-quick.log) | 1,439 passed; one optional skip; zero failures |
| [Final private quick after the operator fix](../../.local/m7prep/private-quick-final.log) | 1,440 passed; one optional skip; zero failures |
| [Focused runtime/operator checks](../../.local/m7prep/focused.log) | 22 passed |
| [Latest operator/companion tooling checks](../../.local/m7prep/operator-final-focused.log) | 10 passed |
| [Companion tooling checks](../../.local/m7prep/companion-focused.log) | Four passed |
| [Final previous/candidate release checks](../../.local/m7prep/operator-previous-config.log) | Seven passed; dry-run and pure mocked ownership checks only |
| [Heavy-locked dataset parity](../../.local/m7prep/dataset-parity-summary.json) | Passed; zero differences; both profiles unchanged after read-only startup; Undo restored both |
| [Heavy-locked expanded shadow](../../.local/m7prep/shadow-parity.json) | 61 paired hash comparisons; zero hash or count differences |
| [Desktop/phone browser workflows](../../.local/screens/m7prep/browser-report.json) | Passed at 1440 and 390 px; administrator, viewer, What's new, Roadmap and original-sync dialog |
| [M7 shadow gallery, plain/framed](../../.local/screens/m7prep/browser-report.json) | 95/95 passed in each mode using the existing gallery checker |
| [Final private full under the heavy lock](../../.local/m7prep/private-full.log) | 4,176 passed; two skips; zero failures; 1,016 seconds |
| [Private full source audit](../../.local/m7prep/private-full-source-audit.json) | All 8,938 tracked files unchanged throughout the suite |

Focused logs overlap; their counts are not added together or to suite totals.
Public totals cover the exported test inventory only. Excluded private scenarios
are not counted as public coverage, and optional skips remain unexecuted checks.
The companion quick result describes its disposable assembled source, not the
live deployment. No browser-loaded application code changed. A separate private
gallery rerun was therefore not required. The M7 shadow-gallery result above
uses the public artifact plus pinned addons.

The private full ran `node scripts/test.mjs full`, the exact runner used by
`npm test`, once. An earlier PowerShell wrapper stopped on an npm notice before
starting any tests; its test log was empty. Only operator helpers, their focused
tests and private documentation changed after the completed full run, with
separate focused checks; the application/runtime tested by the full suite is
unchanged.
The private skips were the optional pinned local cache rebuild and generated-PNG
artifact check; the public skip was that optional cache rebuild. Synthetic offline
coverage passed in both trees.

The paired shadow exercises startup, task order/status/blocked reasons and roll
pools, transport/training, commands, History/Undo, backup export/preview/restore,
stale writes, and private utilities. Both profiles retain these counts:

| Count | First member | Second member |
| --- | ---: | ---: |
| Tasks | 20,641 | 20,593 |
| Blocked tasks | 18,944 | 18,904 |
| Eligible rolls | 3 | 20 |
| Excluded rolls | 1 | 1 |

The shadow checks 111 installed-art routes and compares 149 resulting gameplay
files. Fresh administrator/member/viewer/revoked invitations and narrow overlay
scopes exercise access boundaries, including revocations after restore and
denial of addon routes/assets to overlays. Original sync preview/apply/Undo uses
recorded fixtures only, with 33 fixture reads per profile; no live original-service
fetch is part of that result. It does not establish current upstream availability.

Object keys are sorted and array order is retained. Only the receipt's listed
timing fields and ephemeral original-sync preview IDs are omitted from relevant
hashes. Authentication credentials, overlay credentials and operator telemetry
are excluded from gameplay-file equality and checked separately by access tests.
The complete capability set is compared exactly. Copied-save parity and fresh
test credentials do not establish the survival of actual hosted-device sessions.

The successful browser acceptance run used `.local/m7prep/browser.mjs` under
the shared light lock, one owned scratch server, a fresh disposable save copy
and fresh scratch credentials. The main browser checked both widths and dialog
workflows, then the exact existing
`C:/Users/User/Projects/chunk-picker-rs3/.local/claude-tools/scratch/gallery-check.mjs`
ran with `<origin> <inviteFile>`, plain and with `FRAMED=1`. All processes and
browser profiles were closed. The main-browser report records zero runtime
exceptions, console errors, outside requests, interception failures, allowed
continuation failures or failed image responses; 212 image responses loaded.
Sync used recorded fixtures only (33 reads). Viewers had no rendered write
controls, and neither width overflowed the page.

Reviewed screenshots are retained privately:

| View | 1440 px | 390 px |
| --- | --- | --- |
| Administrator | [Desktop](../../.local/screens/m7prep/admin-1440.png) | [Phone](../../.local/screens/m7prep/admin-390.png) |
| What's new | [Desktop](../../.local/screens/m7prep/updates-1440.png) | [Phone](../../.local/screens/m7prep/updates-390.png) |
| Roadmap | [Desktop](../../.local/screens/m7prep/roadmap-1440.png) | [Phone](../../.local/screens/m7prep/roadmap-390.png) |
| Original sync | [Desktop](../../.local/screens/m7prep/sync-1440.png) | [Phone](../../.local/screens/m7prep/sync-390.png) |
| Viewer | [Desktop](../../.local/screens/m7prep/viewer-1440.png) | [Phone](../../.local/screens/m7prep/viewer-390.png) |

The copied-save screenshots show the expected unconfigured-backup banner because
operational backup sidecars were not copied into that disposable server. The
cutover procedure retains the existing live sidecars. Earlier harness attempts
failed on readiness assumptions and a hidden viewer-control assertion; those
were corrected in the ignored harness without changing application code.

## Operator preparation and remaining gates

Start/Stop/Rollback dry runs used synthetic configuration and an explicitly bound
disposable layout. Ship dry runs used a clean synthetic Git checkout and inert
sentinel stage tools. They checked pins, safe summaries, unchanged fixture bytes,
revision/configuration refusal and no dry-run log creation. No real release
pipeline, stop, restart, rollback or storage overwrite was executed.

Read-only live inspection observed the existing listeners on ports 8788 and 8789
and read the saved origin privately. The actual `.local/duo.dataset.json` sibling
is absent, so live-config Start dry-run correctly refused the unbound store;
Stop's metadata-only dry run remained available. Preserve an existing binding
where present. Here, validating/creating the correct binding is a prerequisite
to a separately authorized live switch, with the writer stopped after a secured
full operational snapshot. It must not be manufactured during preparation or
bypassed by weakening Start. No live configuration or save was changed.

The disposable real-save copies and obsolete export candidates were removed;
the final public candidate, private companion, logs and screenshots remain for
review. No owned scratch server or browser was left running.

Actual cutover still requires the stopped-writer snapshot, original
matching helper handover, verified binding, unchanged packs/retention/backup and
origin/proxy configuration, existing credentials/sessions/revocations, and
representative acceptance before reopening writes. Player 2's actual remote-device
connection through his existing hosted access remains untested. The local shadow
cannot replace that check. No changelog or roadmap content is updated by this
preparation; any proposed entry remains a separate user-facing proposal.
