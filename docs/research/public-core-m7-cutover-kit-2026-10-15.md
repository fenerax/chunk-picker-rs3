# M7 initial cutover kit (preparation only)

This kit implements the [layout plan](public-core-m7-layout-2026-10-15.md).
Claude owns the live switch. No script in this work was run against the live
picker, its helpers or Task Scheduler for mutation. Task XML was exported by
read-only calls into this worktree's `.local/m7kit/watchdog.xml` and `backup.xml`.
Keep those exports private and retain them with the eventual operator plan.

The current published checkout is **not yet a usable M7 source**. Read the source
identity and rehearsal evidence below before preparing a live plan. A local
rehearsal patch is not publication or permission to publish.

## Delivered operator commands

The companion builder carries all private PowerShell helpers and `cutover-*.mjs`
modules into `operator/`. It retains the old five commands and adds:

| Command | Purpose |
| --- | --- |
| `Watch-Core.ps1 -Config <file> -ConfigSha256 <hash>` | Pinned managed health tick, using only `Start-Core` / `Stop-Core` |
| `Register-CoreTasks.ps1 -Plan <tasks.json> [-DryRun]` | Preserve XML settings/principals/triggers; replace only watchdog Exec action |
| `Restore-CoreTasks.ps1 -Plan <tasks.json> [-DryRun]` | Restore both original XML definitions, including backup's unchanged action |
| `Cutover-Live.ps1 -Plan <cutover.json> -Step <name> [-DryRun] [-Retry]` | Execute exactly one initial handover step |
| `Rollback-Live.ps1 -Plan <cutover.json> -Step <name> [-DryRun] [-Retry]` | Execute exactly one recovery step without restoring any save |

`Start-Core` and `Stop-Core` accept `-PreservePause`; the coordinator and watchdog
use it. Everyday manual Start/Stop retain their original pause behavior. Set
everyday shortcuts to the companion pair with the immutable candidate config.
The restored old watchdog can recognize a managed previous-code record because
the original root, data directory, executable, host, port and creation time remain
present. Do not launch the old root-derived Start after accepting M7.

The watchdog retains three cheap health attempts, 15-second retry gaps, the
five-minute initial startup grace, worker replacement before whole-writer restart,
30-second worker recovery polling, Tailscale availability wait, deliberate pause,
and bounded `.local/watchdog.log`. Sleeping calculators stay asleep on healthy
ticks. Runtime options and `--expose-gc` stay in the pinned launcher. A missing,
foreign, stopping or mismatched owner never authorizes an authenticated request
or a guessed process adoption. A stale exact managed record is cleared only
through matching Stop after confirming the process, listeners and store are free.

Daily backup needs **no new script or action**. Its existing old-checkout script
reads the same `.local/duo/access-token`, `.local/backup-destination`, status/log
sidecars and runtime record. The new record retains `hostAddress` and `port`.
The daily trigger, retention, destination and old script remain unchanged. This
portable daily ZIP still omits credentials; the stopped-writer operational snapshot
is a separate prerequisite. Restore-Picker was read only and remains unchanged.

## Prepare immutable inputs before downtime

1. Resolve the published-source mismatch below. Pin a clean public core whose
   entire exported file inventory and bytes match the reviewed redesign export,
   including addon/bootstrap/server/gallery behavior and test classification.
   Do not overlay private shared application files into the core. Build an absent
   companion using this branch's builder, copied immutable packs and its private
   leak corpus. Verify that candidate/core/companion release identities agree.
2. Run public full and private full for that exact source under the shared heavy
   lock, and the private gallery in plain and framed modes under the light lock.
   Retain their logs. This coordinator never runs suites or substitutes rehearsal
   sentinels for those results. Confirm clean unchanged HEAD before downtime.
3. Inspect the actual old launcher and environment, ownership record, watchdog,
   startup entries, daily backup, Tailscale Funnel proxy, exact cookie origin,
   worker/retention settings and art overrides. Record that the previous code can
   read current storage. Check both proposed root destinations are absent before
   installing them. Agree an idle maintenance window with both members; the pause
   marker controls the watchdog, **not HTTP writes**. The server has no new
   maintenance-write mode. An accepted command changes the authoritative save and
   must be retained during rollback. Check activity again if users resume.
4. Prepare `candidate.json` and `previous.json` using the exact schema in the
   layout plan. Retain the old data parent, exact saved origin, host/listeners,
   live selection and manifest paths/digests, worker/idle and retention settings.
   Previous points at the old checkout. Candidate points at the new public core
   and pinned companion profile/addon. Do not create the absent binding yet.
   Do not put any origin or access link in logs. Keep config files immutable.
5. Copy the exported task XML into the companion's private local area; verify its
   hashes against the exports and current tasks. Create the task and cutover plans
   below. A pin is exactly `{ "path": "<absolute file>", "sha256": "<64 lowercase hex>" }`.
   Compute pins locally with `Get-FileHash`; do not paste file contents to the console.

Task plan schema (all fields required; `mockDirectory` is `null` for live):

```json
{
  "schemaVersion": 1,
  "watchdog": { "name": "RS3 Chunk Picker watchdog", "taskPath": "\\", "xml": "<pin of original watchdog.xml>" },
  "backup": { "name": "RS3 Chunk Picker daily backup", "taskPath": "\\", "xml": "<pin of original backup.xml>" },
  "config": "<pin of candidate.json>",
  "watchScript": "<pin of companion/operator/Watch-Core.ps1>",
  "pwshPath": "<absolute existing pwsh.exe>",
  "workingDirectory": "<absolute companion root>",
  "mockDirectory": null
}
```

Quoted `<pin ...>` entries above stand for JSON pin objects, not literal strings.
Both registration helpers print the exact name, current Actions/Triggers XML and
desired Actions/Triggers XML on `-DryRun`. They refuse drift outside the original
and intended definitions. Settings, principals and triggers come from the original
XML, including the original start boundaries and five-minute repetition. Backup
is byte-identical. Partial registration attempts restore the two originals where
the current definition is still one of the two accepted states; unexpected drift
stays untouched and blocks acceptance. Restore does not depend on intact candidate
code, config payload or watchdog bytes. It still verifies original XML pins.

Cutover plan schema (all fields required):

```json
{
  "schemaVersion": 1,
  "mode": "live",
  "candidateConfig": "<pin>",
  "previousConfig": "<pin>",
  "companionRoot": "<absolute private companion>",
  "oldHelpers": { "start": "<pin of old scripts/Start-Picker.ps1>", "stop": "<pin of old scripts/Stop-Picker.ps1>", "process": "<pin of old scripts/Picker-Process.ps1>" },
  "bindingCli": "<pin of retained private scripts/bind-dataset.mjs>",
  "taskPlan": "<pin of tasks.json>",
  "snapshotRoot": "<absent unique folder under LOCALAPPDATA/RS3ChunkPicker/Snapshots>",
  "receiptDir": "<absent unique folder under companion/.local>",
  "idleMinutes": 5,
  "gates": "<pin of external release evidence JSON>",
  "inspection": "<pin of deployment inspection JSON>",
  "hostedAcceptance": "<absolute future hosted-acceptance.json outside operator code directory>"
}
```

`gates` has `schemaVersion:1`, `mode:"live"`, `coreRevision`, SHA-256 values
`companionSha256` (companion.json bytes), `candidateSha256`, `previousSha256`, and
`checks`. Checks contains `publicFull`, `privateFull`, `galleryPlain`, `galleryFramed`;
each has `passed:true`, matching `coreRevision`, and `log` as an existing hash pin.
These are operator attestations linked to actual reviewed results, not self-testing
proofs. Never manufacture successful results or reuse a different release's logs.

`inspection` has `schemaVersion:1`, `mode:"live"`, `previousSha256`, and `verified`
with true values for `launcher`, `runtimeOwnership`, `environment`,
`startupAndWatchdog`, `backupSchedule`, `funnelProxy`, `cookieOrigin`, `retention`,
`artOverrides`, and `previousStorageCompatibility`. Keep the underlying evidence
private. If an actual deployment option cannot be represented, stop preparation
and add reviewed launcher support before downtime.

Only after the new writer starts, verify Player 2's **existing actual hosted-device
session**. He retains his current link and installs nothing. The automated
`verify` step checks admin/member/viewer sessions and overlays with fresh scratch
credentials. Save `hostedAcceptance` with `schemaVersion:1`, the candidate config's
`candidateSha256`, `checkedAt` as current ISO UTC, and
`existingPlayer2HostedSession:true`. No links/tokens go in that receipt.
The coordinator requires a timestamp after new startup and no later than now,
then pins these receipt bytes in run state. Keep them unchanged through unpause.
A local scratch session does not establish this evidence.

## Claude's checked sequence

Run the registration helper and first cutover step with `-DryRun` before downtime.
Dry runs make no lock/receipt, read no token values and contact no server. They
validate the release/config pins and scheduler definitions. Dry runs obey the
same step order; they do not manufacture successful earlier steps.

Invoke each row separately with `Cutover-Live.ps1 -Plan <cutover.json> -Step <name>`.
Inspect the bounded JSON receipt before invoking the next row.

| Step | Gate and action | Recovery if stopping here |
| --- | --- | --- |
| `preflight` | Exact source, suites/gallery/log pins, installation and inspection; original process/listeners; helper lock sharing probe; store lock required, recovery lock absent; every retained command timestamp older than N minutes | Original writer unchanged; rollback returns to original pause/task state |
| `pause` | Set original parent marker; drain any original scheduled watchdog invocation; serialize new ticks | Rollback keeps original writer and restores original pause state |
| `stop-old` | Check idle metadata again; invoke matching pinned old Stop; verify no runtime, writer, storage or recovery lock remains | Exact original helper can reopen an unbound early-abort store; no save copy |
| `snapshot` | ACL-protected complete data + sibling binding if present + sidecars/configs/task XML + preserved pre-stop runtime; inventories/digests/source stability/readback | Retain snapshot for recovery; rollback never restores it automatically |
| `bind` | Reverify secured snapshot, immutable companion and live pack payloads, writer/locks absent; run actual retained binding CLI with pinned profile | Binding stays with the dataset; previous compatibility must pass |
| `start-new` | Snapshot and binding checked; companion Start with explicit pinned config and PreservePause | Rollback stops exact new owner and starts compatible previous code on same store |
| `verify` | Authenticated readiness, both members' tasks/pools, every installed-art route/HEAD, new admin/member/viewer cookies, overlay scope/denials/revocation; no successful gameplay command | Revoke probes; remain paused; rollback retains authoritative progress/access records |
| `register-tasks` | Real existing hosted-session receipt required; exact new owner; register intended watchdog action and unchanged backup | Restore exact original task XML; stop-new/start-old recovery |
| `unpause` | Recheck hosted receipt, exact new owner and intended task definitions; clear original parent marker | Rollback pauses first, then restores the original runtime layout |

Snapshots are restricted to local AppData outside repositories and synced folders.
They include the complete data tree: credentials/invitations/sessions/revocations,
overlays, journals, static state, History and in-directory backups. Sidecars include
origin, runtime logs, backup destination/status/log, watchdog log and pause marker;
configs retain exact runtime/retention/selection settings. Original task XML,
old helper bytes, gate/inspection records and preserved pre-stop ownership are
included. The snapshot directory disables inherited ACLs and allows only this
user and SYSTEM; every file is opened and hashed again for recovery access. No
snapshot content is printed. Keep a live snapshot after acceptance.

`state.json` under the protected receipt directory records plan/tool hashes,
the exact origin-file digest, initial pause state and started/completed/failed receipt, duration and safe result
for every attempt. A failed or interrupted step cannot be silently skipped;
`-Retry` is explicit and checks current preconditions again. The lock file blocks
concurrent calls. After a process crash, verify the coordinator is gone and inspect
the receipt/runtime privately before removing only its `operation.lock`. Do not
edit an active plan or its operator code. A partial snapshot directory is retained
and refused rather than overwritten; roll back and prepare a new run if necessary.

Snapshot and binding hold the original parent's `helper.lock` for their complete
stopped-writer critical section. Both old and new launcher pairs honor that lock.
The pause is checked and reasserted before releasing it. A manual launcher that
wins a later gap makes the next ownership/storage gate refuse; no second writer
or live binding is inferred. Foreground helpers are awaited by process exit, so
a background picker inheriting a pipe cannot keep the coordinator waiting after
its launcher has finished. Only bounded, redacted status reaches the console.

The legacy Stop adapter invokes the unchanged pinned original helper, preserving
its process/timestamp/command checks, while replacing only the timeout process
handle's Kill method with a refusal. A timeout leaves the original writer/record
for inspection; it cannot forcibly terminate the picker. Managed Stop is also
graceful-only. Neither path deletes storage locks or adopts an unrelated process.

## Rollback without replacing progress

Invoke these separately with `Rollback-Live.ps1 -Plan <same cutover.json> -Step`:
`pause`, `stop-new`, `verify-previous`, `restore-tasks`, `start-old`, `unpause`.
Forward execution stays disabled once rollback begins. Candidate payload damage
does not block rollback's metadata-only exact-owner stop lane. Previous retained
inputs and storage compatibility must still validate. Missing ownership/config
evidence requires private manual inspection; never guess the writer.

The same data directory, selected packs, origin, listeners and backup sidecars
remain authoritative. The binding is never removed, and no snapshot is copied
over progress, credentials, invitations or revocations. If previous code cannot
read current storage, keep the writer paused/stopped, retain a secured post-cutover
snapshot and reconcile accepted commands and revocations before any separately
authorized restore. No automatic restore/restart follows a failed gate.

Before `bind`, an unbound early-abort store is restarted only through its matching
old launcher with explicit clean pinned environment. That launcher cannot express
nondefault CLI retention; such a deployment refuses this early restart and needs
reviewed support before cutover. Its built-in Start clears pause temporarily; the
coordinator reasserts pause on return. After binding, the companion Start launches
the previous code with PreservePause. Unpause requires the previous owner and
original task definitions and restores an originally paused watchdog to paused.

## Published source identity

The disposable `chunk-picker-rs3-core` clone was taken from
`https://github.com/fenerax/chunk-picker-rs3`, published commit
`88f8b775ce346c821387528ce833a51a4e79e260`. Redesign HEAD's reviewed export is
`79ac5e81684e38df7d9e39af9724f2fa6d9dfbd4`, with 646 files. The unmodified clone
fails the companion installation check. Its differences are:

- `app/dataset-bootstrap.mjs`, `app/gallery-route.mjs`, `app/server.mjs`,
  `scripts/start-independent-game.mjs` and `scripts/test-selection.mjs` differ.
- `app/private-addon.mjs` and `tests/private-addon.test.mjs` are absent.

The rehearsal applies only the exact reviewed **public export** bytes to its
disposable clone and makes a local commit there. It retains the public-only delta
as `.local/m7kit/published-to-redesign.patch`. No remote or publication is changed.
Before live preparation, the chosen clean core must have the same complete file
inventory and bytes as that reviewed export; a matching version label alone is
insufficient. Recheck this comparison if redesign HEAD changes.

Build the companion from the matching private source with this branch's builder,
the selected immutable packs and a seeded private scanner corpus. It needs the
private source complement and test runner/classification, profile, addon, copied
packs, verification tools and the complete operator kit. Keep shared app files
only in the public core. Preserve the original live pack paths in both runtime
configs even though the builder also copies packs into the companion.

## Reproducible disposable rehearsal

`scripts/rehearse-m7-cutover.mjs` requires the inherited heavy-lock owner, explicit
live read-only input paths, exported task XML, a redesign source and report path.
It clones only into a generated worktree-local folder, copies live data excluding
`access-token`, both lock names, invites and overlays, then creates fresh scratch
credentials. It copies manifest-listed packs, uses a free 8900–8999 listener pair,
a scratch origin, private copied old code/helpers and mock task names. It first
probes an unbound early-abort stop/restart through the original helper and the
bounded foreground wrapper. It then runs every forward step, a healthy real
watchdog tick, the unchanged daily backup and every rollback step, then
gracefully stops its one scratch writer and deletes the copy, clone, packs,
companion and protected scratch snapshot. No real task registration occurs.

```powershell
powershell -NoProfile -File .local/with-heavy.ps1 node scripts/rehearse-m7-cutover.mjs --live-data C:/Users/User/Projects/chunk-picker-rs3/.local/duo --packs-dir C:/Users/User/Projects/chunk-picker-rs3/.local/packs --redesign C:/Users/User/Projects/chunk-picker-rs3-wt/redesign --task-exports C:/Users/User/Projects/chunk-picker-rs3-wt/m7kit/.local/m7kit --report C:/Users/User/Projects/chunk-picker-rs3-wt/m7kit/.local/m7kit/rehearsal.json
```

Verification logs are private in `.local/m7kit/`:

- `focused.log`: 42/42 passed, including dry-run redaction/immutability, ordering,
  failure/retry, exact ownership, task drift/partial rollback, protected snapshots,
  fresh role revocation, the actual verification CLI and PS5/PS7 foreground waits.
- `private-quick.log`: 1,481 passed, one optional skip, zero failures.
- `tasks-unchanged.json`: both live task definitions still equal their original
  exports. No real registration was attempted.

No shared application, storage, engine, worker or data source was changed. The
full suite and browser screenshots were therefore not run for this operator kit.
The live plan still requires the separate release's full-suite and gallery gates.

## Completed rehearsal receipts

The final run is `.local/m7kit/rehearsal-final.json`: **passed**, 9/9 forward
steps and 6/6 rollback steps, 24 minutes 43.455 seconds including cloning,
installation checks, backup and cleanup. The additional unbound early-abort
restart passed in 36.485 seconds. All 17 copied operator files matched the
tested worktree bytes. The patched disposable core matched all 646 reviewed
export files exactly; the seeded public scanner reported zero findings.

| Direction / step | Seconds | Receipt result |
| --- | ---: | --- |
| Cutover `preflight` | 162.386 | Pins, external rehearsal attestations, locks, exact old owner, idle metadata and scheduler dry run checked |
| Cutover `pause` | 0.841 | Watchdog pause established |
| Cutover `stop-old` | 6.341 | Matching original helper stopped the copied writer gracefully |
| Cutover `snapshot` | 9.615 | 158 files; protected ACLs, inventory/digests and recovery read-back verified |
| Cutover `bind` | 153.470 | Stopped-writer lease, secured snapshot, install/payload checks and explicit dataset binding passed |
| Cutover `start-new` | 31.539 | Pinned public core plus companion started and became ready |
| Cutover `verify` | 703.898 | Both members' tasks/pools; 111 art routes via GET/HEAD and ETags; fresh admin/member/viewer sessions and scoped overlay; every scratch credential revoked; gameplay unchanged |
| Cutover `register-tasks` | 4.001 | Intended definitions applied to the mock scheduler only |
| Cutover `unpause` | 4.712 | Intended task definitions and new owner rechecked; pause cleared |
| Rollback `pause` | 0.798 | Pause established |
| Rollback `stop-new` | 8.797 | Exact new writer stopped; store released |
| Rollback `verify-previous` | 2.718 | Previous-code dataset/storage binding compatible |
| Rollback `restore-tasks` | 1.316 | Original XML restored byte for byte in the mock backend |
| Rollback `start-old` | 27.332 | Previous code started on the same bound data directory |
| Rollback `unpause` | 5.004 | Previous owner and original task definitions rechecked; original pause state restored |

The real healthy `Watch-Core` tick preserved its runtime ownership record. The
unchanged copied `Backup-Picker.ps1` completed using the new runtime record and
the scratch backup destination. Rollback preserved the save revision and fresh
root credential, and applied no snapshot over progress. Focused tests separately
verify that newly accepted progress bytes survive rollback.

The harness stopped its final previous-code writer and verified that it was gone.
It deleted the clone, export, data, copied packs, companion, mock tasks, scratch
backups and protected snapshot. Only private reports, original task XML exports
and the public-only source delta remain. Earlier refused rehearsals also cleaned
their copies. They exposed missing disposable support files, HTTPS/local request
origin requirements, protected-directory ACL repeatability, PowerShell 7 JSON
types, inherited native pipes and a verification CLI import cycle; the final
focused tests cover these authored orchestration failures.

This result establishes the local copy workflow. It does **not** establish
Player 2's hosted-device reachability, real Task Scheduler registration permissions,
the actual Funnel proxy/startup environment, or the separate full-suite/gallery
release gates. Rehearsal release/inspection attestations were explicitly synthetic
and cannot be used in a live plan. Keep the published-source mismatch above as
a live cutover blocker until the chosen core matches the reviewed export.
