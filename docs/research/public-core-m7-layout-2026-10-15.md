# M7 shared source and private operator layout

Date: 2026-10-15. This is preparation for milestone 7. No live cutover,
deployment entrypoint change, pack selection change, remote creation or
publication is established by these helpers or this document.

The [split plan](public-private-split-plan-2026-10-13.md),
[M6 evidence and cutover procedure](public-core-shadow-2026-10-14.md), and
[export contract](../public-export.md) remain the acceptance baseline. The new
source checkout must come from a reviewed public export with fresh public
history. Never copy the old repository's object database or remote settings.

## Proposed directories and ownership

Use these absolute locations at cutover, after checking that the two new
destinations are absent. These names are a proposal; the code accepts explicit
absolute roots and does not infer a live save from its own location.

```text
C:/Users/User/Projects/
  chunk-picker-rs3-core/                 public shared-code source
    app/                                shared application and independent data
    tests/                              public synthetic and independent tests
    scripts/                            public build/test tooling
    docs/                               reviewed public documentation
    .git/                               fresh public history only
  chunk-picker-rs3-private/              private companion, never public-exported
    packs/selection.json                copied immutable selection
    packs/<id>/<version>/pack.json       verified manifests and listed payloads
    profile.json                        pinned inert catalogue/default profile
    addons/                             pinned private utility manifest/payloads
    checks/private-source/              excluded inputs, tooling and private tests
      app/                              only excluded private modules/data
      tests/                            complete private scenarios
      scripts/                          private tools and private test selection
      docs/                             excluded research and project records
    tools/companion-check.mjs            disposable integration assembly/runner
    operator/                           start/stop/rollback helpers + local configs
    release-gate/                       private scanner corpus and release evidence
    companion.json                      private source/pack/profile/addon receipt
    .local/                             ignored scratch assemblies and logs
  chunk-picker-rs3/                      old source/history retained read only
    .local/duo/                         unchanged live storage
    .local/duo.dataset.json              required sibling binding; absent at prep
    .local/public-origin                existing origin, never printed
    .local/backup-destination            existing backup destination
    .local/backup-status.json            existing backup status
    .local/server-runtime.json          same operator ownership record location
    .local/helper.lock                  same operator serialization lock
    .local/picker-paused                existing watchdog pause marker
```

Shared application changes belong in `chunk-picker-rs3-core` once M7 is accepted.
Do not maintain shared application copies in the companion or continue editing
the old source tree. Private changelog/roadmap records remain under the private
source portion and in the pinned addon built from them. Pack input research,
scanner fingerprints/negative corpus, captures, receipts and private integration
tests stay private. Secrets, operator JSON, live runtime state and saves remain
local only; generated evidence and scratch output are ignored. Before publishing
any source, run the existing leak gate against the complete proposed public
artifact and inspect its fresh history.

Build an absent companion with the private tool:

```powershell
node scripts/build-private-companion.mjs --public-root C:/Users/User/Projects/chunk-picker-rs3-core --packs-dir C:/Users/User/Projects/chunk-picker-rs3/.local/packs --output C:/Users/User/Projects/chunk-picker-rs3-private
```

The builder copies and verifies manifest-listed pack payloads and creates the
profile/addon and private complement. It does not select the copied packs for
the live picker. The operator configs for the first cutover retain the existing
live selection under the old checkout's `.local/packs`; copied companion packs
support private checks. Keep both selections byte equivalent and keep earlier
immutable versions available.

Run checks against the current shared source:

```powershell
node C:/Users/User/Projects/chunk-picker-rs3-private/tools/companion-check.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --lane quick
powershell -NoProfile -File C:/Users/User/Projects/chunk-picker-rs3/.local/with-heavy.ps1 node C:/Users/User/Projects/chunk-picker-rs3-private/tools/companion-check.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --lane full
```

The full command requires a valid inherited heavy-lock owner. The runner builds
a temporary integration tree from the selected public core and the private
complement, runs the private lane, and removes the assembly. Private application
modules may fill excluded paths; they must never replace shared application
modules. Private tests retain the complete original scenarios and private test
classification, including variants of sanitized public tests. The assembly is
generated verification material, never another maintained application checkout.
The original private test runner is retained beside its classification so the
public runner cannot force private integration checks onto the independent game.
Historical test dependencies include the archived JSON bundles and six small
retained icon provenance sources; these stay in the private complement.

Edit private records under `checks/private-source/app/data/` and private utility
sources under their existing private complement paths. Rebuild into absent
private outputs using the current core, without reopening the old repo:

```powershell
node C:/Users/User/Projects/chunk-picker-rs3-private/tools/companion-check.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --lane addon --output C:/Users/User/Projects/chunk-picker-rs3-private/addons-next
node C:/Users/User/Projects/chunk-picker-rs3-private/tools/companion-check.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --lane profile --output C:/Users/User/Projects/chunk-picker-rs3-private/profile-next.json
```

These commands print the new hash and leave the previous selection intact.
Review outputs, then explicitly update companion/operator pins and repeat parity
and release gates. The first M7 data sync verifies unchanged immutable packs.
A future dataset-input change needs a separately built pack version and dataset
parity before changing those pins; this preparation does not rebuild or select
replacement runtime packs.

Run the private gallery through its companion tool under the shared light lock:

```powershell
powershell -NoProfile -File C:/Users/User/Projects/chunk-picker-rs3/.local/with-light.ps1 node C:/Users/User/Projects/chunk-picker-rs3-private/tools/gallery-check.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --checker C:/Users/User/Projects/chunk-picker-rs3-private/tools/gallery-browser-check.mjs
```

The copied browser checker remains unchanged. The gallery tool stages only its
required private inputs, runs plain and `FRAMED=1` checks, and removes its scratch
tree. All 95 previews in each mode remain the M6
baseline until a reviewed gallery change updates that count.

## Operator configuration

The private helpers are `Start-Core.ps1`, `Stop-Core.ps1`, `Rollback-Core.ps1`,
`Ship-Core.ps1` and their shared `Operator-Common.ps1`. Keep the five files together. They require
Windows PowerShell, Node, explicit JSON configuration and existing bound storage.
They never initialize a fresh game or create a credential. The configuration is
local operator state and must not enter public history.

Read-only preparation found that the actual live `duo.dataset.json` sibling is
absent. The helpers deliberately require bound storage for Start. Preserve an
existing binding when present. Here, validating/creating the correct binding
receipt is a cutover prerequisite with the writer stopped, after the secured
snapshot, under a separately authorized live switch. Do not manufacture it
during preparation or bypass the Start check. Stop can still validate ownership
metadata without that binding.

The following is a future cutover command, not a preparation step, and has not
been executed against live storage. Only after the verified writer has stopped,
both storage/recovery locks are absent and the secured full snapshot is checked,
run the retained private binding CLI with the candidate's explicit pinned profile
and unchanged live pack selection:

```powershell
$bindingConfig = Get-Content -LiteralPath C:/Users/User/Projects/chunk-picker-rs3-private/operator/candidate-v2.json -Raw | ConvertFrom-Json
foreach ($lockName in 'store.lock', 'store.lock.recovery') {
    if (Test-Path -LiteralPath (Join-Path $bindingConfig.dataDir $lockName)) { throw 'Writer lock remains; binding refused.' }
}
$env:RS3_DATASET = 'duo-legacy'
$env:RS3_DATASET_PROFILE = $bindingConfig.profile.path
$env:RS3_DATASET_PROFILE_SHA256 = $bindingConfig.profile.sha256
& $bindingConfig.nodePath C:/Users/User/Projects/chunk-picker-rs3/scripts/bind-dataset.mjs --data-dir $bindingConfig.dataDir --packs-dir $bindingConfig.packsDir --selection $bindingConfig.selection.path
if ($LASTEXITCODE -ne 0) { throw 'Dataset binding failed; keep the writer stopped.' }
```

The CLI verifies the selected dataset/profile and writes only its sibling
receipt. It does not stop a writer or establish that the snapshot exists; those
are mandatory operator preconditions. Check that the resulting receipt matches
the pinned dataset before the first Start. Do not substitute a no-pack provider
or hand-write a digest. Keep the saved candidate configuration immutable.

Each configuration has these exact fields:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `coreRoot` | Absolute checkout containing `app/server.mjs` |
| `dataDir` | Existing absolute `C:/Users/User/Projects/chunk-picker-rs3/.local/duo` |
| `nodePath` | Existing absolute Node executable |
| `host`, `port` | Actual current private listener address and `8788` |
| `loopbackPort` | Actual current secondary port, ordinarily `8789`, or explicit `null` |
| `publicOriginFile` | Existing `public-origin` under the data directory's parent |
| `packsDir` | Existing absolute live pack root; do not silently substitute companion copies |
| `selection` | `{ "path": "<absolute selection.json>", "sha256": "<64 lowercase hex>" }` |
| `packs` | Object with `data`, `rulesText`, `art`, each an absolute manifest path and SHA-256 pin |
| `profile` | Absolute profile path and SHA-256 pin, or explicit `null` for the previous ordinary private provider |
| `addons` | Absolute addon manifest path and SHA-256 pin, or explicit `null` for previous code without the addon |
| `runtimeOptions` | Exactly `taskWorkerMode`, `workerIdleMs`, `backupDays`, `historyEntries`; process/thread worker mode and positive integer limits, or `null` to retain application defaults |

Pin records always have exactly `path` and `sha256`. Pack paths must be the
selection's corresponding `<packsDir>/<id>/<version>/pack.json`, and hashes must
agree. The application separately validates pack contracts/payloads and the
profile/addon contract before opening storage. Do not add arbitrary environment
variables, preloads or command-line options. The launcher clears inherited
`RS3_*`, `NODE_OPTIONS` and `NODE_PATH` for its child, then supplies the explicit
selection and runtime options before imports. Check all actual deployed options
before creating configs; add reviewed support before cutover if the deployment
uses an option this schema cannot express. Existing art overrides require a
separate byte-equivalence review before they can be omitted in favor of packs.

Set the saved origin without changing its exact value. The helper reads it from
the existing sidecar, uses it for the child, and binds it into the configuration
hash. Do not put the origin or administrator/member/viewer/overlay links in
terminal output, receipts intended for publication, or this document. Both
configs must retain the same origin file, network configuration and pack
selection. Keep backup destination/status/logs and scheduled backup arguments
pointing to their existing paths. Their location follows the original data
parent rather than the new code root.

```powershell
powershell -NoProfile -File <private-operator>/Start-Core.ps1 -Config <absolute-new-config.json> -DryRun
powershell -NoProfile -File <private-operator>/Stop-Core.ps1 -Config <absolute-new-config.json> -DryRun
powershell -NoProfile -File <private-operator>/Rollback-Core.ps1 -Config <absolute-new-config.json> -PreviousConfig <absolute-previous-config.json> -DryRun
```

Dry runs only read configuration, input metadata and lock presence and print a bounded
summary with origin redacted. They do not acquire/create a helper lock, write a
runtime record, read the access-token value, contact a server, start a process
or prove storage availability at a later live switch. This preparation tests
them only on synthetic configuration. Start verifies pin contents and refuses
links/junctions. Stop validates pinned configuration metadata without requiring
the current pack/profile/addon payloads to remain intact. Rollback uses that stop
validation for the new code and full start validation for previous code before
touching the new process. All paths must be fully qualified local drive paths;
unrecognized configuration fields are refused.

Live operations serialize using the original parent's `helper.lock`. Start
refuses a storage/recovery lock or any Node command naming the same explicit
data directory. It does not recover or delete stale locks. Managed operations
bind the configuration hash, executable, server/data paths, listener arguments,
PID and exact CIM process creation time. Before an authenticated health or
shutdown request, both configured listening socket owners must match the exact
recorded PID; the process timestamp is rechecked around that query. Stop sends
authenticated graceful shutdown only to its verified configured writer. A timeout retains the process
and ownership record and blocks rollback; no forced stop or process adoption
occurs. A malformed/legacy runtime record requires the matching old helper and
operator inspection, not an inferred process match.

## Cutover gate and release pipeline

The current read-only `ship.ps1` has the sequence full tests, unchanged-revision
check, fast-forward main, stop, local save copy, pack sync, start and health check.
Its unencrypted save copy and current root-derived launchers do not constitute
the M7 operational snapshot or new deployment layout. Do not execute it against
the new layout unchanged.

The replacement release pipeline must preserve the full-suite → stop → data
sync → start ordering and add the paired public/private gates:

For ongoing releases after the initial managed M7 handover, use:

```powershell
powershell -NoProfile -File C:/Users/User/Projects/chunk-picker-rs3-private/operator/Ship-Core.ps1 -Config C:/Users/User/Projects/chunk-picker-rs3-private/operator/candidate-v2.json -PreviousConfig C:/Users/User/Projects/chunk-picker-rs3-private/operator/accepted-v1.json -CoreRoot C:/Users/User/Projects/chunk-picker-rs3-core -CompanionRoot C:/Users/User/Projects/chunk-picker-rs3-private -HeavyLock C:/Users/User/Projects/chunk-picker-rs3/.local/with-heavy.ps1 -DryRun
```

The dry run reads configuration/pins, the companion receipt and Git state. It
prints only the current revision and fixed stage names, creates no log directory,
and executes none of the stages. Removing `-DryRun` executes public full through
the explicit heavy-lock wrapper, private full through that wrapper, revision and
configuration checks, managed Stop, installation/data-sync verification, another
revision/configuration check, and managed Start. The exact sync gate is:

```powershell
node C:/Users/User/Projects/chunk-picker-rs3-private/tools/verify-install.mjs --core C:/Users/User/Projects/chunk-picker-rs3-core --companion C:/Users/User/Projects/chunk-picker-rs3-private
```

Create a new configuration filename whenever private profile/addon pins change.
Keep both the running configuration and candidate files byte for byte, including
the saved origin they bind. `-Config` selects the candidate validated against the
new companion receipt. `-PreviousConfig` selects the unchanged configuration
used to start the current writer; Stop validates its metadata and exact runtime
ownership without requiring old profile/addon payloads to remain intact. It is
never compared against the new companion receipt. If pins/configuration are
unchanged, omit `-PreviousConfig` and Ship uses `-Config` for both operations.

Ship allows different profile/addon pins while requiring both configurations to
retain the same core root, data directory, listener addresses/ports, origin file
and exact origin, live pack root, selection path/digest and manifest paths/digests.
It rechecks both immutable configuration hashes before Stop and before Start.
Keep the previous file and its retained compatible inputs for rollback after
acceptance; do not update its pins in place. The release helper requires matching
candidate/core/companion roots and candidate profile/addon/pack digests.
Configured live pack paths may differ from copied
companion paths; their selected manifest digests must agree. The shared checkout
must have clean tracked files and tracked application/test entrypoints. HEAD
must remain unchanged throughout the release. The helper performs no pull,
merge, push or source update. Each executed stage retains stdout/stderr under
`companion/.local/ship-<UTC>-<unique-id>/<stage>.log`; console output is bounded
stage status. If a suite fails, the running writer remains in place. If data-sync
verification fails after Stop, the writer stays stopped. No automatic restart,
pack mutation or save restore follows a failed gate. The gallery command above
remains a separate required release check before calling Ship.

Ship handles only an already managed post-M7 runtime. The initial switch must
use the original matching stop helper manually, as follows:

1. Pin the public source revision and private companion/input receipts. Run
   public full and private full for that exact revision under the shared heavy
   lock. Verify the revision did not move. Run the private gallery in plain and
   framed modes under the light lock. Retain private logs and both release
   identities. Full suites are gates, never inferred from a synthetic dry run.
2. Before downtime, inspect the actual old launcher, runtime record, environment,
   watchdog/startup entries, backup schedule, Tailscale Funnel proxy and cookie
   origin configuration. Prepare new and previous configs. Update the everyday
   startup/stop pair and watchdog configuration only as part of an authorized
   live cutover; otherwise the watchdog may relaunch old code. Keep the old
   pair and code available for rollback.
3. Stop the original writer through its matching verified old stop helper.
   Confirm its process and storage/recovery locks are gone. Keep writers and
   watchdog paused while taking the secured full operational snapshot below.
4. Perform the existing private data-sync gate against the candidate revision.
   For this cutover, synchronization is verification: retain the already pinned
   selection and immutable pack bytes. Any requested changed pack needs its own
   verified new version and parity gate; never rewrite an installed version or
   silently keep stale data after a failed sync. A sync failure aborts startup.
5. Start the new configured code with explicit `--data-dir`, host, ports,
   retention options, pinned profile/addon and unchanged selection. Verify
   authenticated readiness, both members' tasks/pools, installed art,
   administrator/member/viewer sessions and overlays before reopening writes.
   Verify Player 2's actual existing hosted-device session; the M6 local shadow did
   not establish his remote reachability. He keeps his existing link and
   installs nothing.
6. Record acceptance and freeze shared application edits in the old tree. Shared
   fixes now land as patches in the public source and pass both verification
   lanes before deployment. Publication remains a separate authorized action.

The secured snapshot is a prerequisite to step 5. With the writer stopped,
capture the complete live directory and any existing sibling binding plus the original
parent's operational sidecars/configuration. Include access-token, invitations,
sessions and revocations, overlays, journals, static state, archived History,
backups, backup destination/status/log, exact origin and runtime/retention and
scheduled-backup configuration. Store credentials under access-controlled local
or encrypted backup storage outside public repositories; verify the snapshot's
inventory/digests and recovery access without displaying its content. A normal
gameplay export omits credentials and cannot substitute for this snapshot.
These helpers intentionally do not copy or restore a snapshot.

## Rollback without replacing progress

Before reopening writes, check previous-code storage compatibility. Rollback
first validates both complete configurations, then stops the exact new process
and verifies storage lock release. It starts previous code with the same data
directory, selected packs, origin, listeners and operational sidecars. It copies
no save and overwrites no gameplay, credentials, invitations or revocations.
If an unrelated helper wins the gap between stop and start, normal runtime and
storage checks refuse a second writer.

Accepted post-cutover progress remains authoritative. If the previous code
cannot read the current storage, stop and retain a secured post-cutover snapshot,
then reconcile accepted commands and access revocations before any separately
authorized restore. Never automatically restore the pre-cutover snapshot over
new progress. If graceful stop times out, inspect the recorded process and
private logs; rollback must remain blocked until the writer and locks are gone.

Focused verification belongs in `tests/operator-cutover.test.mjs`, classified as
private quick tooling. It checks dry-run immutability/redaction, invalid pins and
configuration refusal, syntax, and exact process-ownership validation with
synthetic mocked process records. Live start/stop, hosted reachability, scheduler
handover and real-save rollback remain cutover checks.
