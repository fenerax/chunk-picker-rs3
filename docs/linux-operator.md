# Linux service and recovery kit

This kit prepares a single Linux writer for a future VPS. It installs nothing
when checked out. Provisioning, public/private ingress acceptance, off-host
delivery and a private-data rehearsal remain cutover work.

## Files and Windows equivalents

| Linux file | Responsibility | Existing Windows piece |
| --- | --- | --- |
| `scripts/linux/systemd/chunk-picker.service`, `serve.mjs`, `start-check.mjs` | Foreground writer, dedicated service account, pinned selection, graceful signals and guarded starts | Managed Start/Stop and runtime ownership |
| `chunk-picker-health.service` and `.timer`, `operator.mjs health` | Five-minute health checks, startup grace, worker recovery before writer recovery | Watchdog task and serialized tick |
| `chunk-picker-backup.service` and `.timer`, `operator.mjs backup` | Daily stopped-store recovery snapshot, portable export and UI status | Daily backup task and backup script |
| `recovery.mjs` | Full snapshot, hashes, restore and final stopped-save compatibility function | Backup/export helpers and the missing final Quick Release check |
| `operator.mjs deploy` | Stop, final compatibility check, binding/pointer selection, private readiness, guarded rollback | Quick Release handover portion |

Private-source Git bundles stay on the builder PC. The VPS recovery job does
not back up a source repository that is absent from the VPS.

## Local installation layout

Use Node 24.20.0 or a newer reviewed 24.x version, systemd and procps. Pin the
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
The daily timer runs at **04:00 Atlantic time** (`America/Moncton`), catches missed runs, and briefly stops
the writer. Choose the actual maintenance window before enabling it.

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

Health, backups, restores and deploys share `control/operation.lock`. A busy
health tick skips. Other concurrent commands refuse. `maintenance.json`
survives failed transactions; health will refuse while it remains. An
interrupted operation lock also remains. Before clearing either file, stop the
timers, inspect the service/cgroup, ownership files, selected pointer and
`activation.json`, and reconcile the operation. Do not run manual service
starts during an operator transaction. There is no automatic lock stealing or
crash-journal replay.

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
