# Linux service and recovery kit

This kit prepares a single Linux writer for a future VPS. It installs nothing
when checked out. Provisioning, public/private ingress acceptance, off-host
delivery and a private-data rehearsal remain cutover work.

## Files and Windows equivalents

| Linux file | Responsibility | Existing Windows piece |
| --- | --- | --- |
| `scripts/linux/systemd/chunk-picker.service`, `serve.mjs`, `start-check.mjs` | Foreground writer, dedicated service account, pinned selection, graceful signals and guarded starts | Managed Start/Stop and runtime ownership |
| `chunk-picker-health.service` and `.timer`, `operator.mjs health` | Five-minute health checks, startup grace, worker recovery before writer recovery | Watchdog task and serialized tick |
| `chunk-picker-backup.service` and `.timer`, `operator.mjs backup` | Daily online recovery snapshot, portable export and UI status | Daily backup task and backup script |
| `recovery.mjs` | Full snapshot, hashes, restore and final stopped-save compatibility function | Backup/export helpers and the missing final Quick Release check |
| `operator.mjs deploy` | Online compatibility check, stopped byte comparison, binding/pointer selection, private readiness, guarded rollback | Quick Release handover portion |

Private-source Git bundles stay on the builder PC. The VPS recovery job does
not back up a source repository that is absent from the VPS.

## Local installation layout

Use Node 24.20.0 or a newer reviewed 24.x version, systemd, procps and util-linux (`flock`). Pin the
exact Node binary/version in the machine's deployment record. The examples use
`/usr/bin/node`; adjust every unit together if Node lives elsewhere.

Create a dedicated, non-login system account named `chunk-picker`. This is the
generic service identity in the templates. Keep tools and immutable release
trees owned by root and readable by that account. The service account must not
be able to change tools, releases, selected configuration, or the current
pointer. Restrict who can invoke the root operator commands.

| Location | Owner and use |
| --- | --- |
| `/opt/chunk-picker/tools` | Root-owned copy of this core's operator tooling |
| `/opt/chunk-picker/releases/<release>` | Root-owned immutable core, packs, profile and addon |
| `/etc/chunk-picker/runtime.env` | Root-owned environment file, readable by the service group |
| `/etc/chunk-picker/signin.env` | Optional local sign-in environment; protect provider secrets in separate secret files |
| `/etc/chunk-picker/operator.json` | Root-owned operator settings, readable by the service group |
| `/var/lib/chunk-picker/current.json` | Root-owned selected config pointer; parent owned by root |
| `/var/lib/chunk-picker/data/game` | Service-owned complete store; parent allows binding/status reads |
| `/var/lib/chunk-picker/data/game.dataset.json` | Sibling dataset binding, readable by the service |
| `/var/lib/chunk-picker/control` | Root-only transaction locks, maintenance evidence and activation journal |
| `/var/lib/chunk-picker/scratch` | Root-only disposable probe copies |
| `/var/backups/chunk-picker` | Root-only recovery snapshots, containing credentials |

Set `RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json` in `runtime.env`.
The units name environment **files** only; host values and credentials belong
in local configuration. Optional sign-in environment uses the app's existing
`RS3_SIGNIN` and provider client ID/secret-file settings. Worker mode is always
`process`, matching the current Windows model rather than Linux's thread default.

An operator settings file has this shape. Replace placeholders locally:

```json
{
  "service": "chunk-picker.service",
  "current": "/var/lib/chunk-picker/current.json",
  "dataDir": "/var/lib/chunk-picker/data/game",
  "controlDir": "/var/lib/chunk-picker/control",
  "scratchRoot": "/var/lib/chunk-picker/scratch",
  "backupDir": "/var/backups/chunk-picker",
  "keep": 30,
  "minFreeBytes": 16106127360
}
```

`current.json` and candidate pointer files use the existing pointer shape:

```json
{
  "config": {
    "path": "/opt/chunk-picker/releases/<release>/config.json",
    "sha256": "<config-file-sha256>"
  }
}
```

Release configs retain the existing `coreRoot`, `dataDir`, `packsDir`,
`selection`, `packs`, `profile`, `addons`, `host`, `port`, `loopbackPort`,
`publicOriginFile` and `runtimeOptions` fields. Each selection/pack/profile/addon
pin contains an absolute Linux `path` and `sha256`. Set `datasetId` explicitly
(`duo-legacy` for the private packed dataset). Set `host` to the restricted
private listener address and use distinct explicit listener ports. The additional
loopback listener always receives `loopbackRole: public`. Store the exact HTTPS
origin in `publicOriginFile`. No origin or credential is printed by this kit.

Generate target config bytes and pins after rebasing paths. A Windows receipt
does not attest a modified Linux config. Reject unverified uploads, symlinks and
hard links. Keep source runtime state outside immutable release roots. Source
identity scans exclude `.git`, `.local`, `var` and `node_modules`; these excluded
directories must contain no release code or required inputs. Configured input
pins are still verified separately.

Copy the five unit/timer files to the local systemd unit directory, review
paths and access, then run `systemd-analyze verify` on those files on the VPS.
After a staging rehearsal, reload systemd and enable the service and both
timers. Nothing in this repository enables a unit or changes the desktop tasks.
The daily timer runs at **04:00 Atlantic time** (`America/Moncton`), catches missed runs, without stopping
the writer. Rehearse the online path before enabling it.

## Shutdown and health recovery

`Restart=always` restarts the writer after any exit, including a clean
`/api/shutdown` or an unexpected exit code 0. A restart waits 15 seconds, and
the start rate is bounded. `systemctl stop` is the only way to keep the writer
stopped: systemd never undoes an explicit stop. After repeated start failures
the unit stays `failed` and needs inspection. The health timer does not start
an inactive service. Boot startup comes from the
enabled writer unit.

`KillMode=mixed` sends SIGTERM to the main Node process so its close path can
drain accepted writes, close authentication/plugin/overlay sidecars, stop its
workers and release the store. `SendSIGKILL=no` prevents systemd from forcibly
killing a writer after the 120-second stop deadline. A stuck drain needs
inspection. The operator requires an inactive/failed unit, zero main PID, an
empty cgroup or zero tasks, and absence of both store ownership files before
starting a replacement. It never deletes those files to make a stop pass.

Health allows five minutes for startup. It makes three health attempts, 15
seconds apart, then requests `/api/worker-restart` on the private listener and
waits up to 30 seconds. Only then does it stop the writer, verify release and
ownership, start the same service, and wait for private readiness. Credentials
are read from the store, sent only in an authorization header, and never put
in command arguments or diagnostics. Redirects are refused.

Health, backups, restores, deploys and VPS additions reviews share
`control/operation.lock`. Each new Linux lock records the PID, process start
identity and boot ID. Only an owner proven gone (missing process, reused PID or
previous boot) permits automatic recovery: the lock is retained as
`stale-operation.lock.<timestamp>-pid<n>` before continuing. A live owner, an
unreadable record or a legacy record without process identity stays busy.
A recent busy health tick exits quietly. After 30 minutes, measured from the
lock's modification time, health exits non-zero with the static line
"Operator lock held for over 30 minutes; inspect privately." Other concurrent
commands refuse with a static lock-busy reason.

`maintenance.json` survives failed transactions; health refuses while it remains.
Recovering a dead owner's lock does not clear maintenance or activation evidence.
Before clearing evidence, stop the timers, inspect the service/cgroup, ownership
files, selected pointer and `activation.json`, and reconcile the operation.
The persistent `operation.lock.recovery` file serializes stale-lock moves and
new lock creation with Linux `flock`, so recovery can never move a lock that
replaced the one it checked. The kernel releases that guard on process death.
Do not unlink that coordination file while commands may be running. If `flock`
is unavailable, acquisition and recovery refuse conservatively and the lock
stays busy. Do not run
manual service starts during an operator transaction. There is no crash-journal
replay.

The root `ExecStartPre` check also blocks boot/manual starts while transaction
evidence remains. An active operator can authorize one start with a short-lived
permit tied to its Linux process start identity, lock bytes and selected pointer.
The permit is consumed before startup. A crashed operator cannot authorize a
later start. The writer also requires existing state, credentials and binding;
it cannot silently initialize a replacement game.

## Backup and restore

Run root operator commands with the local `RS3_OPERATOR_CONFIG` environment
loaded, using this command shape:

```sh
node /opt/chunk-picker/tools/scripts/linux/operator.mjs backup
node /opt/chunk-picker/tools/scripts/linux/operator.mjs restore <recovery-directory>
node /opt/chunk-picker/tools/scripts/linux/operator.mjs deploy <candidate-pointer-file>
```

Backup stops an active service and verifies ownership release. It copies the
**whole store**, including access credentials, invitation/session records,
accounts and sign-in sidecars, plugin keys, overlays, action receipts,
feedback, usage, retained backups, archives, static blobs and empty directories.
It also copies the sibling binding. Ownership files cause refusal rather than
being copied or removed. Unknown future regular sidecars are preserved too.

A second disposable copy is opened with the selected release, without a
listener. Its own storage decoder creates and validates `portable.json`.
The recovery copy remains byte-for-byte unchanged. Every file gets a size and
SHA-256 in `manifest.json`; publication uses a directory rename on the backup
filesystem. Recovery snapshots are directories rather than ZIP archives, so
off-host transport must preserve the complete directory. Hashes detect damage;
they do not replace trusted storage or authenticated off-host transport.

Retention keeps `keep` completed snapshots by count. It prunes only matching,
fully verified recovery directories after a new snapshot passes. Unrelated or
incomplete snapshots are left for inspection. Free-space checks cover the backup
and scratch filesystems before copying, plus the backup reserve before
publication. The estimate reserves three times the store size for copying and
portable export; unusually large decoded exports can exceed that estimate.
Health reports a low-space warning independently of writer recovery.

`backup-status.json` and the nonsecret `backup-destination` marker are written
beside the data directory. Their permissions allow the service to read them.
The existing UI reads success/failure, size and last successful time unchanged.
Health warns when the last successful backup is missing or over two days old.
The UI's success means a verified **local** snapshot, not successful off-host
delivery. Route failed systemd jobs and age/disk warnings to an operator alert
channel before cutover; this kit only reports through the journal.

Restore requires a deliberately stopped unit and an empty data directory with
no sibling binding. It verifies the manifest, tests a disposable copy with the
selected release, then creates the binding and files exclusively and checks
every restored byte. It refuses existing games. A partial restore remains
stopped with maintenance evidence; inspect it and choose a new empty target.
The root command gives the verified store and binding back to the dedicated
service account. No restore automatically starts the writer.

Recovery backups contain reusable credentials. Keep directories private,
encrypt off-host copies, verify delivery separately, and rehearse a download
and restore. The local retained count is not an off-host retention policy.

## Final stopped-save compatibility and activation

`checkStoppedCompatibility()` in `scripts/linux/recovery.mjs` is the deployer
interface. Call it under the shared operation lock **after** graceful stop and
ownership verification, immediately before changing binding/pointer. Supply
the current and candidate `readRelease()` objects, `dataDir`, `scratchRoot`,
`minFreeBytes`, and an `assertStopped` callback that verifies service ownership.
An optional `candidateBinding` byte buffer supports an explicitly reviewed
binding transition; the command-line deploy currently keeps the binding.

The function opens four successive disposable copies: old, candidate, old,
candidate. Each uses its release's binding and storage decoder. It compares
canonical full portable documents, including progress, identities, history and
revision. Equal pack descriptors still run every probe. It rechecks the final
source store, binding, release code and input pins, and stopped ownership before
returning. The live save is never opened by a probe.

This is deliberately conservative. A migration that changes the logical
portable document is refused even if a human might approve it. Such transitions
need a separately reviewed preservation policy. The probes validate startup
and decoding, not HTTP task serving, browser behavior or external clients.

`deployStopped()` integrates this check with a stopped activation transaction.
It retains exact pointer/binding bytes in a root-only activation journal,
checks the expected current pointer before replacement, starts the selected
service, and verifies private readiness. A failed final check restarts the old
release with the save and pointer untouched. A failure after candidate startup
stops the candidate and rechecks reverse compatibility against the **latest**
save before restoring the old selection. If reverse compatibility or shutdown
fails, it leaves maintenance evidence and refuses to start another writer.
It never restores an older gameplay snapshot as an automatic rollback.

The pointer replacement uses expected-byte checks under the shared operator
lock. Binding and pointer are two writes with a recovery journal, not a single
filesystem transaction. The kit assumes all selection writers honor that lock.
After a process/machine crash, reconcile the journal manually with the service
stopped. A full upload verifier, acceptance receipt and automatic journal
recovery are outside this kit.

The same function could close the Windows Quick Release ordering gap if called
after its managed Stop and store-release checks, under its existing locks, and
before binding/pointer writes. That integration needs a Windows stopped-owner
adapter. This change does not edit the Windows operator or Quick Release.

## Rehearsal and remaining cutover work

Run only the focused synthetic tests:

```sh
node --test --test-timeout=60000 tests/linux-operator.test.mjs
```

They use `.local/linux-operator-tests` in the worktree and remove their scratch
directories. The recovery drill backs up, wipes, restores and verifies real
synthetic storage bytes. Compatibility tests use the real storage/server
decoder through tiny synthetic release adapters, including a candidate that
accepts an earlier revision and refuses the final stopped revision. Controller
tests simulate systemd to exercise worker-first recovery, stop refusal,
exclusion and failed reverse compatibility. They do not control a live service.

Before cutover, provision and validate the Linux units, permissions, actual
private dataset and artifacts; measure cgroup/worker RAM and graceful stop;
rehearse reboot, worker failure, backup, off-host recovery and rollback on Linux.
Configure the separate public/private ingress, TLS, origin, firewall, domain
and game-plugin endpoint; verify invitation, sign-in, OBS, plugin and browser
workflows. Select an off-host destination and alert channel. Add protected
current/previous/transition release pruning, candidate cleanup and journal/log
size limits in the host's operator configuration. This kit bounds backup count
and checks space; it does not prune release directories or configure journald.
Approve a cutover window and keep exactly one production writer throughout.


## Online backup and short deployments

`operator.mjs backup` requires an active writer with the private master-only
`POST /api/operator/snapshot` endpoint. Public ingress refuses it even with a
master credential; private admin invitations and cookie-only requests also
refuse it. The operator supplies a fresh UUID, never a caller-selected file
path. Credentials are read privately and sent only in an Authorization header.

Before enabling online operations, create the spool alongside the store. Its
parent stays root-owned; do not give the service write access to that parent:

```sh
sudo install -d -o chunk-picker -g chunk-picker -m 0700 /var/lib/chunk-picker/data/game.snapshots
```

Gameplay, retention, accounts, invitations, usage, feedback, plugin sidecars and
server mutation transactions share a write barrier. Shutdown-only retention and
plugin metadata flush before capture, while requests continue. Capture waits for
in-flight writes and pins all regular files and the sibling binding with open
file descriptors. New writes wait rather than fail. The default capture budget
is 1 second including drain, with at most 4096 files. Directory/file operations
are checked against the deadline; an individual stalled filesystem call cannot
be preempted. A timeout releases the barrier and fails the snapshot. It never
abandons an active commit. Reads continue throughout.

On Linux, replacement and unlink do not change a pinned inode. Windows retains
the write barrier until copying closes the descriptors, with the same cooperative
deadline, so queued writes never run into a pinned-file rename refusal. Bytes are copied
after releasing the write barrier, with a 1 MiB buffer and a 64 MiB spool
free-space floor. The operator takes ownership and copies to root-only scratch;
all subsequent hashes and decoder/portable probes run there. Backup publication,
`picker-recovery-v1`, pruning of verified older recoveries, and
`backup-status.json` remain unchanged. An online failure records failure, keeps
old recoveries and leaves the writer serving. There is **no automatic stopped
fallback**. Incomplete/timed-out spool directories are private evidence; inspect
and remove only confirmed completed/abandoned operation-owned directories.
Do not recursively clear the spool while a snapshot is running.

`backup --stopped` explicitly selects the previous stop/copy/probe/start path.
`deploy POINTER [VERIFIED_RECEIPT]` performs all four current/candidate/current/
candidate probes on an online snapshot before stopping. It then hashes the
complete stopped store plus binding and compares that exact identity with the
checked copy. If anything changed, it runs all four probes again while stopped.
Pointer CAS, immutable release checks, activation breadcrumb and reverse probes
against the latest candidate-written save are unchanged. It never restores an
old recovery after candidate startup. A failed online preparation causes no
start/stop. A failed stopped probe restarts the unchanged old selection. A failed
reverse check stays stopped with evidence.

The short path therefore applies to an unchanged final store. Active gameplay,
late ACKs, account/usage timestamps, pending plugin state or retention changes
can still select the conservative longer path. Never claim every deployment is
15 seconds. Measure graceful stop, byte comparison, release scans and readiness
on the actual VPS. `StartLimitBurst=3` over 300 seconds is unchanged: preparation
uses no starts, activation uses one, and a readiness rollback uses at most one
more. Readiness aborts on an exited writer before the 15-second automatic
restart delay can spend that rollback budget. Space repeated rehearsals by at least five minutes; never reset limits to
force a drill through.

### First installation and proxy

An older running release has no snapshot endpoint. The first feature release
must use the explicit bootstrap command `deploy POINTER VERIFIED_RECEIPT
--stopped` (or `deploy POINTER --stopped` without a staged receipt), after a
reviewed staging rehearsal. This one deployment retains the old stopped-probe
window. Subsequent releases and scheduled backups can use the online path.
Do not silently detect a 404 and stop production.

`docs/linux-Caddyfile.example` contains the proposed generic proxy config. The
host-specific operator kit must retain its real host names. The added directives
are inside the existing reverse_proxy block:

```caddyfile
lb_try_duration 30s
lb_try_interval 250ms
lb_retry_match {
    method GET HEAD
}
```

This holds connection failures across a normal restart. It does not turn an
upstream 503 response into an automatic proxy replay. Warm-up navigation receives
a script-free HTML page with a two-second automatic refresh, no-store, strict
CSP and Retry-After. API reads retry connection failures, interrupted response
bodies and short 503 delays, at most thirty attempts within a 45-second retry budget; aborts and long Retry-After
values remain bounded. SSE already reopens terminally closed streams. Saves
continue through the existing durable action-session outbox with the same
request ID, original revision and receipt; no mutation is replayed by the read
helper. Existing retry exhaustion keeps the pending save for explicit recovery.
SSE flush, indefinite streams and redacted logging stay intact.

Validate with Caddy 2.11.7 before installation. Keep the master listener private.
The game plugin's existing HTTP implementation retries 503 and connection
refusals with exponential delays (2 seconds up to 300 seconds); task reads have
a separate retry clock. No plugin changes are needed. An extended fallback
window can still exhaust a proxy/browser timeout; pending saves remain retained.

## Built PC release to VPS

The release transport never copies the PC store, bindings, tokens or operator
state. It uses the existing built immutable core/packs/profile/addons, validates
Quick Release's commit/pins locally, creates a manifest and tar, uploads to a
new directory, checks transfer hashes and archive entries, extracts to a new
root-owned release, verifies every file, rebases pins, and reads the Linux
candidate through `readRelease`. Linux listener/store/origin settings come from
the existing pinned current config. No origin-file contents are read or printed.
The `verified.json` receipt binds the candidate identity and previous pointer.
Activation checks that receipt again under the operator lock.

Example PowerShell (replace release, repo and output paths locally):

```powershell
node scripts/release/vps/release.mjs prepare --repo <core-repo> --release-dir <built-release> --out <new-private-output-dir>
node scripts/release/vps/release.mjs stage --out <private-output-dir> --host <ssh-alias> --upload /var/tmp/picker-upload-<release> --target /opt/chunk-picker/releases/<release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

Stage uploads and verifies only; it never starts/stops a service or changes the
selected pointer. PC Quick Release continues deriving additions from the PC save
for PC deployments. Those additions are not accepted for the VPS: its save may
already contain them. Install the reviewed operator tools, then derive the VPS
list from a copy of the newest verified recovery backup:

```powershell
node scripts/release/vps/release.mjs derive --host <ssh-alias> --upload /var/tmp/picker-upload-<release> --target /opt/chunk-picker/releases/<release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

This runs on the VPS under the operator lock. It verifies backup manifests,
ignores incomplete/corrupt recoveries, and refuses if no verified backup exists.
Only disposable copies are opened, through `checkStoppedCompatibility`'s four
current/candidate/current/candidate probes, with the candidate binding when its
pack changes. The live store and recovery backup are never opened by a probe.
The command prints the proposed list and its SHA-256 digest privately; keep
that output out of public logs. Review the entire list, including an empty list,
then repeat the same `derive` command with `--accept-additions <reviewed-digest>`.
Acceptance re-derives from the newest verified backup and requires the exact
digest. It binds the accepted list to the staged receipt. Nothing is accepted
by staging or by deriving without that flag.

Before activation, rehearse every release with a new data pack on a disposable
backup copy rebound to the candidate's pack. Keep the immutable backup unchanged;
its old binding must not be used to claim a successful candidate-pack rehearsal.
Follow the isolated staging/service checks below as well.

After review and rehearsal, explicitly activate:

```powershell
node scripts/release/vps/release.mjs activate --go-live --host <ssh-alias> --upload /var/tmp/picker-upload-<release> --target /opt/chunk-picker/releases/<release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

Activation re-derives the list on a fresh online snapshot and refuses any
difference from the accepted list before stopping. If the final stopped store
changed, all four probes run again against it before pointer/binding writes.
An unreviewed staged receipt refuses activation, including `stage --go-live`;
legacy receipts must be restaged to fresh paths and reviewed with the new tools.
Use the separate stage, derive, accept and activate steps. There is no default
host, credential or production destination. Uploads and failed candidate directories
are deliberately retained for review; do not overwrite/reuse their paths.
Quick Release's PC `-GoLive` now refuses an existing `picker-paused` marker before
candidate load or stop. Keep the paused rollback copy untouched; do not remove
that marker to ship a VPS release.

### Reviewed install and rehearsal order

These are future operator commands, not actions performed by this change.
Stage the release first. Use a disposable staging VPS with its own installed service/config, an immutable complete recovery copy and ports 8900–8999.
Never use production store paths for the staging rehearsal. Install the reviewed
operator tools before using the new commands; preserve old tools for rollback.
The selected writer code comes from the candidate release, not the tools tree.

1. Validate the candidate file/pin receipt; run CI's full Linux/Windows, private
   companion, release/recovery and coverage gates. Check real-dataset memory on
   staging with one workload at a time.
2. Run `scripts/linux/rehearse.mjs` as documented below on the isolated copy.
   Prove online backup/public refusal, unchanged and changed final-store paths,
   candidate-start failure, latest-save rollback, spool exhaustion and response
   loss. Measure hold/down times, not only total operator time.
3. Install tools and the backup unit on staging; preserve `/opt/node/bin/node`
   in unit substitutions. `systemd-analyze verify` all installed units. Test the
   root/service ownership handoff, start permits and start-limit behavior.
4. On production, after approval, stop/wait only the health and backup timers/
   oneshots before replacing tools. Do not stop the writer to install tools.
   Install the reviewed Caddyfile, validate as caddy, then reload Caddy. Preserve
   the existing credential redaction and SSE settings. Create the private spool.
5. Perform the one explicit stopped bootstrap deployment with its staged receipt.
   Check private ready/savesReady, public admin refusal, browser pending-command
   recovery, plugin and SSE recovery. Then run online backup and verify its
   recovery/export/status plus the existing off-host pull. Re-enable the timers
   only after those pass. Do not clear transaction evidence after a refusal.

The rehearsal helper accepts an immutable copied store and pointer and never
uses systemctl. Its fake controller closes and opens exactly one scratch writer;
ports must be free in 8900–8999. It measures online backup and same-release
prechecked deployment with real probes, then removes scratch in finally:

```sh
/opt/node/bin/node /opt/chunk-picker/tools/scripts/linux/rehearse.mjs --pointer /path/to/reviewed/pointer.json --source /path/to/immutable-recovery/store --scratch /path/to/new-private-scratch --port 8956
```

The helper does not prove systemd/Caddy timing or a real version transition.
Repeat the full operator commands on staging under its isolated systemd owner
before production approval. Neither command starts the paused PC picker.
