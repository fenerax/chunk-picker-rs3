# Installed Linux tools refresh

## Worker memory ceilings

`app/tasks/worker-limits.mjs` owns the memory policy. Every server-started
calculator (foreground tasks, combined view, Preview/ranking, death estimates,
area check and sandbox) uses the same 2,048 MiB V8 old-generation ceiling and
32 MiB young-generation setting. Native calculators use an owned process on
Linux as well as Windows, including the legacy scheduler path. The relay host
also gets explicit `--max-old-space-size=2048 --max-semi-space-size=16` flags.
This avoids a relay heap failure aborting the writer. It also releases native
allocator pages when a calculator retires.

Each calculator host reports combined relay/isolate RSS every 100 ms; above
3 GiB the parent immediately kills only that owned child. This catches native
allocations (Buffers, transport and compression) outside V8's heap limit.
RSS polling is an emergency guard, not a kernel hard limit: allocations can
overshoot between samples, and a blocked relay can delay a report. Retiring
processes remain charged to the shared pool until exit. The existing host
memory admission/residency budget still applies across all pickers and lanes;
these per-worker limits do not grant additional calculator slots or replace
that aggregate budget.

Both serialized import stages, upload parsing and backup/restore preparation
(including export), share the explicit 2,048/32 MiB isolate limits. Upload and
decompression quotas and the single active import queue remain in force.
An import OOM returns a bounded rejection without publishing records; the next
queued job can run. A calculator isolate OOM retains its error code across process IPC,
rejects affected requests with a retryable 503, and uses the existing bounded
recovery/restart budget. Saves stay in the writer.

The short-lived collection publisher has a separate 128 MiB old-generation /
16 MiB young-generation ceiling. Its input is shared backing memory, bounded
to 128 MiB by the existing collection quota. Publication failure disables this
optional cache; a memory failure writes a bounded journal warning, and the
calculator rebuilds normally. Its startup also refuses
inherited heap flags that would override its ceiling.

`RS3_TASK_WORKER_MODE=thread` remains a diagnostic opt-in with the same V8
limits, but it lacks process/native-allocation isolation and the per-child RSS
guard. Keep production on the default owned-process path. V8 process flags can
override `Worker.resourceLimits` even with an empty worker `execArgv`. Owned
hosts override inherited old/young heap flags with the policy values; import
and diagnostic calculator workers refuse an oversized effective V8 heap at
startup. Avoid larger global `NODE_OPTIONS`/`--max-old-space-size` settings
that would disable import jobs.

To repeat the synthetic memory measurements, take the shared heavy-work lock
first and run these separately with Node 24.x on Linux. All destinations must
be new, isolated directories; neither script reads an installed save or starts
a server. Reports contain numeric metadata only:

```sh
node --expose-gc scripts/perf/worker-memory-ceilings.mjs .local/memory-calculator-new
node --expose-gc scripts/perf/import-memory-ceilings.mjs .local/memory-import-new
node --expose-gc scripts/perf/publisher-memory-ceilings.mjs .local/memory-publisher-new
```

The calculator probe uses the existing deterministic scaled F2P pack generator
(scale 116, seed 1), two synthetic maps, startup, evaluation, Preview, roll pool,
ten death estimates, area check and sandbox. It records the owned process's
kernel `VmHWM` after each workload and the largest before-GC heap from both
host/isolate V8 traces; the separate heap readings are retained samples after GC.
It supplies explicit synthetic grid adjacency with cache walking/resources/
archaeology disabled; stub cache pins are not evidence of real cache geometry
or its memory.
The import probe parses a synthetic large portable backup and
checks backup, compressed export and replacement preparation in turn. Its
`getrusage` peak RSS includes the coordinator and worker together, providing a
conservative upper bound rather than claiming per-isolate RSS.
The publisher probe writes a maximum-sized 128 MiB shared collection through
temporary-file and persistent-store publication and
reports its finishing heap plus the coordinator/worker RSS high-water mark.
Run publication as an unprivileged user; the existing root cache-access
refusal stays in place.

Measurements on Linux x64 under WSL, Node 24.22.2, on 2026-11-06 (UTC),
with each probe holding the shared heavy-work lock:

| Workload | Largest observed V8 heap | Peak RSS | Scope |
| --- | ---: | ---: | --- |
| 129.9 MiB scaled pack, 5,830 chunks, 32,016 tasks; all seven stages | 534.4 MiB | 1,117.5 MiB | Calculator relay and isolate; largest single-isolate before-GC heap |
| 20,000 custom tasks, two maps, 2,000 notes of 36,000 ASCII bytes; all import stages | Not sampled separately | 1,112.0 MiB | Coordinator plus one import worker, including fixture creation |
| Maximum 128 MiB collection, temporary and persistent publication | 7.1 MiB at publication (not a transient heap peak) | 319.2 MiB | Coordinator plus publisher and shared input |

The 2,048 MiB old-generation ceiling is 3.8 times the calculator's observed
heap maximum; its 3,072 MiB RSS guard is 2.7 times observed owned-process RSS.
For imports, any one isolate's heap is bounded above by the measured total
process RSS, so 2,048 MiB gives at least 1.8 times that conservative observed
bound. The publisher hashes/writes already shared bytes without decoding the
graph; its 128 MiB old-generation allowance leaves room for module/runtime
overhead above the finishing heap sample, while the separate entry quota
bounds its native input/copies. These are synthetic workload measurements, not real private cache or
save measurements. Keep the aggregate host admission budget in place and
repeat the probes when catalogue or backup handling changes materially.

## Writer crash budget and health recovery

The writer unit permits **three starts in 300 seconds**, including failed
`ExecStartPre` attempts, with `Restart=always` and `RestartSec=15`. These limits
already existed; retain them when installing or overriding the unit. A rapid
crash loop reaches `Result=start-limit-hit` and stops. Its existing
`OnFailure=chunk-picker-notify@%n.service` still alerts on terminal failure.
Neither health nor its timer calls `reset-failed`. The health unit has only
`After=chunk-picker.service`, without a dependency that starts the writer.

Every five minutes, health skips inactive/failed writers and the first five
minutes of a new writer. For a running writer it checks readiness, retries,
then tries worker-only recovery. Before each recovery step it rechecks the
writer's systemd invocation and restart count. A crash, replacement or restart
during those waits ends that run without stopping or starting the writer.
Only the same still-running writer can reach the existing graceful stop,
ownership-release check and guarded start. The start-permit path also requires
a successful drain, the same main-process start timestamp and a normal zero
exit, plus stable stopped restart accounting (a controlled stop's reset to zero
is allowed). The retained main-process identity/exit fields prevent a cleared
invocation or failed-state flag from hiding a crash during the stop. Health never clears failed
state to get another start budget.

Maintenance, tools-transaction, activation and incomplete multi-picker
service-restore evidence fence health before requests and throughout recovery. The operator
lock, release identity check and `start-check.mjs` gate remain mandatory.
Interrupted operations require reconciliation; never remove locks or evidence
to make a timer or start succeed. Diagnose a rate-limited writer privately;
any deliberate retry/reset belongs to operator recovery after the cause and
transaction evidence have been reconciled. A skipped health run sends no
success dead-man ping; the monitor still observes the outage.

For a later approved installation, install the reviewed application release
for calculator changes **and** the verified tools package for `operator.mjs`,
using the refresh/rehearsal procedure below. Updating the application alone
does not update the installed health CLI. Unit files are installed separately:

1. Complete [install-day capture](#install-day-unit-capture) before replacing
   any unit. Record whether `chunk-picker-health.timer` was enabled/active and stop that
   timer. Wait for any active health/operator job to finish and prove ownership
   released using the existing procedure. Do not interrupt an operation or
   clear retained evidence.
2. From the reviewed source tree, install these units and reload systemd:

   ```sh
   sudo install -o root -g root -m 0644 scripts/linux/systemd/chunk-picker.service /etc/systemd/system/
   sudo install -o root -g root -m 0644 scripts/linux/systemd/chunk-picker-health.service /etc/systemd/system/
   sudo install -o root -g root -m 0644 scripts/linux/systemd/chunk-picker-health.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl cat chunk-picker.service chunk-picker-health.service chunk-picker-health.timer
   sudo systemctl show chunk-picker.service -p StartLimitIntervalUSec -p StartLimitBurst -p OnFailure -p Result
   ```

   Check effective drop-ins too: the start budget, start-check gate and alert
   must match this policy. Reloading does not restart the writer or clear its
   failed state. The unit edits in this change are explanatory comments.
3. After the verified tools switch and its receipts, restore the health timer
   only if it was previously active. An inactive writer stays inactive. Use the
   existing five-minute grace and private-readiness/health receipt checks; do
   not treat an exit-zero skipped run as successful recovery.

This procedure prepares a later install. Opening the tools-refresh PR does not
authorize installing it. First rehearse on a rented disposable machine; retain
its report and obtain the live-install decision separately. Use Node 24.20.0
or a newer 24.x release for local tooling; the disposable provisioner deliberately
pins 24.20.0. Keep the desktop writer stopped while server hosting is active.

## Package and release boundary

`node scripts/linux/tools-package.mjs build . ../tools-package` follows all static
imports, re-exports, literal dynamic imports, declared computed loaders and
URL-relative child entrypoints from the systemd and release entrypoints. Its
manifest lists each file's relative path, byte size and SHA-256. `toolsIdentity`
is SHA-256 over the canonical manifest body (everything except that digest).
Verification recomputes both hashes and the closure and rejects extra files,
missing dependencies, links and unmodeled computed imports. Read the generated
manifest for the exact inventory, including app helpers imported directly by tools. Unit
files are installed separately; none of their paths changes.

New manifests declare `contractVersion: 2`. The reviewed table in
`scripts/linux/tools-contracts.mjs` fixes the entrypoints, closure roots and CLI
probes for each supported version. Version 1 supports the earlier #128 package;
only its exact entry inventory may identify an unversioned manifest. Unknown
versions or changed inventories refuse even with recomputed hashes. Install,
rollback and recovery verify each package against its own contract, so an older
package does not need the newer alert or off-site CLIs. Add a new contract when
changing these requirements, retaining the historical contracts for rollback.

The selected release still supplies the application server and state decoder,
compatibility identity/dataset seams, calculator/worker modules and their
transitive dependencies. The prewarm launcher executes the selected release's
prewarm child. Profiles, packs and addons remain pinned release inputs. The
PC prepare/verify helper also loads build/check modules from its selected core.
The manifest records these computed-import boundaries; a tools package is not
a self-contained application release. Do not copy all of `app/` into tools.

The shared store identity policy excludes only `warm-store`. Snapshots also
omit ownership lock files. Account/provider records, invitations, plugin keys,
the master credential and opaque credential sidecars remain in the identity
and recovery validation.

## Disposable rehearsal

Provision an empty Debian or Ubuntu VM with SSH, passwordless root/sudo and a
configured SSH alias. Supply a trusted Linux Node **24.20.0** `.tar.xz` archive
for that VM's architecture and its independently reviewed SHA-256. The script
installs base packages and Node from this archive, so it needs no preinstalled
Node, project checkout, data pack, save or credential. No provider account or
VM purchase is automated.

1. Run from the clean committed source:
   `node scripts/linux/scratch-rehearsal.mjs <scratch-alias> <node-archive> <sha256>`.
   It refuses `picker-vps`, production DNS addresses, the SSH connection's
   production address, existing picker installs and any HTTP(S) listener or
   web-proxy configuration. DNS or SSH uncertainty refuses before provisioning.
2. The provisioner exports committed public source only, installs the matching
   units and complete tools package, and creates an invented open-starter game
   and fresh random credentials. It runs the normal bundle stage/rebase,
   installed-operator online backup, derive/accept, isolated rehearsal, health
   check, activation and pointer/private-readiness verification. Timers are
   enabled after the measured cycle.
3. Inspect `.local/tools-scratch/<run>/report.json`. It reports install identity,
   stopped-to-ready, the isolated rehearsal, and every derive/activation phase.
   Source, package, transaction and synthetic backup evidence remain on the
   disposable machine after failures. Destroy the rented VM after retaining the
   report; never repurpose it as a production installation.

For a first-install/legacy-rollback rehearsal, append
`--legacy-comparison <absolute-tools-comparison.json> --legacy-copies <absolute-installed-code-copy-directory> --legacy-baseline <full-pre-refresh-commit>`.
The provisioner reconstructs a code-only legacy tree from those archived copies
and public Git history. Every non-missing installed hash in the comparison must
match exactly; unavailable bytes refuse provisioning. Unlisted unit and probe
entrypoints come from the explicit baseline. No local configuration, save,
credential, or archived report is uploaded. The scratch machine verifies the
fixture again, starts its synthetic writer from the legacy **real directory**,
migrates forward, rolls back to that real directory, checks maintenance refusal,
runs legacy health and a verified online backup, confirms the writer PID did not
change, then refreshes tools again before the normal release cycle. The report's
`legacy` section records these results. The health check honors the legacy
five-minute startup grace. Timers remain disabled during switching.

The target for an unchanged persistent store is about **20–30 seconds** from
stopped to ready. That is an expectation, not a measured result of this change.
Player or credential-sidecar writes can still select all four stopped probes.
Synthetic timing cannot establish production timing or real-save compatibility.

## Later live-install steps

Keep each release's explicit activation decision separate from this tools-only
install. Do not stop timers or the writer to evade an install refusal. Resolve
the named condition or wait for its existing run to finish, then retry.

1. Check the merged source, its CI result, the disposable rehearsal report and
   the approved tools identity. Build the package in a new sibling directory,
   then run `node scripts/linux/tools-package.mjs verify ../tools-package`.
2. Read non-secret unit/config metadata through `ssh picker-vps`. Confirm the
   current tools path, Node, operator configuration and active release still
   match the reviewed plan. Confirm a current verified recovery backup and a
   separate restore drill; the installer neither creates nor exports a backup.
3. After live-install authorization, upload the complete package to a new
   private staging directory. Do not overlay the installed tools directory.
   On the server run the **staged** installer with the existing configuration:

   ```sh
   sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /var/tmp/tools-package/scripts/linux/tools-install.mjs install /opt/chunk-picker/tools /var/tmp/tools-package
   ```

   Staging paths are examples and must be new. The installer refuses an existing
   operation lock, maintenance marker, active/transitioning backup or health
   unit, activation/start-permit/transaction evidence, incomplete service
   recovery, unsafe ownership, or mismatched hashes. It uses the service mutex
   as well when multi-picker mode is selected.
4. Record the returned `tools-receipt-<id>.json` under the control directory.
   The installer copies into a new root-owned `tools-versions/<digest>-<id>`,
   synchronizes it, then atomically switches `/opt/chunk-picker/tools`. For the
   first migration, Linux `renameat2(RENAME_EXCHANGE)` swaps the real directory
   with a symlink in one step; Python 3 with libc `renameat2` and a supporting
   filesystem are required. The old directory is retained as `legacy-<id>`.
   Later switches use atomic symlink rename. Installed hashes and import closure
   are verified again after switching. A tools-only switch needs no unit edits
   or daemon reload. Once the alerts/off-site units have been installed, use
   [combined rollback](#combined-unit-timer-and-tools-rollback) instead: the new
   backup OnSuccess, monitor and failure hooks require the new tools.
   Identity checks always resolve the installed writer unit's `User`/`Group`
   through systemd and NSS. Optional numeric settings must match both exactly;
   they cannot supply an alternate account. This also applies to rollback,
   release staging, recovery ownership and the privileged start gate.
5. Recheck the private health/pointer metadata, units and receipt. The running
   writer continues its already loaded code and release; **no writer restart
   is required for install or rollback**. The next ordinary service start loads
   the selected tools. The installer never starts a second writer.
6. For a tools-only rollback with compatible units, run the installer from the
   retained staged package. For an alerts/off-site downgrade, this command is
   step 3 of the combined procedure below, not the whole rollback:

   ```sh
   sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /var/tmp/tools-package/scripts/linux/tools-install.mjs rollback /opt/chunk-picker/tools /var/lib/chunk-picker/control/tools-receipt-<id>.json
   ```

   Rollback requires the exact installed identity and unchanged previous tree;
   it atomically selects that retained tree and writes a new receipt. If a
   switch/verification fails, the installer attempts selection reversal only
   when ownership is provable. It retains maintenance and transaction evidence
   even after a successful reversal. Preserve every directory and receipt and
   reconcile privately before further operator or start actions. A crash record
   names both the temporary exchange path and retained legacy destination;
   neither an absent receipt nor an incomplete phase means success.
   Journal deletion is the commit boundary: the selected tree and successful
   receipt have been verified and published, and maintenance has been removed.
   A process killed after that deletion leaves the committed selection in place.
   Ordinary retries reclaim only a provably dead lock through guarded acquisition;
   a repeated committed rollback recognizes its matching successful receipt.
   Live, arbitrary or unverifiable locks are refused and retained.
   Legacy rollback uses the same `renameat2(RENAME_EXCHANGE)` syscall to put
   the retained real directory back at `tools`, since old main-module guards
   cannot execute through a symlink. There is no missing-path window. The
   exchange requires Python 3, libc `renameat2` and filesystem support; there
   is no two-rename fallback. Before selecting any rollback tree, every writer,
   start, health and backup entrypoint must exist and pass behavioral probes
   as the actual service account, at direct real paths for legacy tools.

   After an interruption, keep timers excluded and use the **retained staged
   installer**, with the same configuration, to restore the pre-switch selection:

   ```sh
   sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /var/tmp/tools-package/scripts/linux/tools-install.mjs recover /opt/chunk-picker/tools
   ```

   Recovery holds the operator lock, checks the journal, locates the old real
   directory at the original, temporary or retained path, verifies hashes,
   ownership, service access and all runtime probes, and atomically restores
   it. It also handles an interrupted legacy rollback by restoring the prior
   symlink. Re-running after an interrupted recovery recognizes the already
   restored tree. It durably writes a recovery receipt before removing the
   maintenance/transaction gates. The writer is never stopped or restarted. Unknown,
   modified or incomplete state stays fenced for private inspection.
   With no journal, recovery checks all remaining gates, root ownership, the
   current selection and service-account probes. It reports `no-pending-switch`
   with that selection and a matching successful receipt, when one exists.
   This status does not establish that the interrupted command succeeded.
   Maintenance or other pending evidence still causes a specific refusal.
   Keep unselected prepared version trees and exchange paths for inspection;
   recovery does not remove them.
7. During the next separately approved release, retain
   `control/phase-receipts/activate-<id>.json` and derive receipts. They include
   tools identity, drain, online/stopped copy and hash, each probe, pointer,
   start gate, started-to-ready and stopped-to-ready. A phase is written before
   starting and after finishing, so an interrupted phase remains `running`.
   Optional `release.mjs --phase-dir <local-directory>` adds local transport
   timings; those are distinct from writer downtime. Review refusals print only
   `lock`, `maintenance`, `receipt`, `newest backup` or `digest`.

## Install-day unit capture

Run in a root Bash shell before the first new unit is installed. Keep this shell
and its variables for the change. Use a new retained directory on every capture;
never overwrite the prior capture. No OS servicing, unit generator, configuration
manager or other operator may change picker units during capture or rollback.
Inspect systemctl cat first: linked unit/drop-in content outside systemd's unit
search paths must be captured separately with its metadata before proceeding.
Do not proceed with transient/generated picker units; reconcile their persistent
source first. The archive preserves masks, symlinks, drop-ins, modes, ownership,
ACLs and xattrs, including enablement links under targets.

```bash
set -euo pipefail
umask 077
capture=$(mktemp -d /var/lib/chunk-picker/unit-capture-XXXXXXXX)
systemd-analyze unit-paths > "$capture/unit-paths.txt"
while IFS= read -r dir; do
  [ ! -d "$dir" ] || readlink -e -- "$dir"
done < "$capture/unit-paths.txt" | sort -u > "$capture/roots.txt"
while IFS= read -r dir; do
  find "$dir" -name 'chunk-picker*' -prune -print0
done < "$capture/roots.txt" | sort -zu > "$capture/paths.nul"
: > "$capture/definitions.nul"
: > "$capture/enablement.nul"
while IFS= read -r -d '' entry; do
  case "$entry" in *.wants/*|*.requires/*|*.upholds/*) list=enablement;; *) list=definitions;; esac
  printf '%s\0' "$entry" >> "$capture/$list.nul"
done < "$capture/paths.nul"
tar --create --file="$capture/units.tar" --absolute-names \
  --acls --xattrs --numeric-owner --null --files-from="$capture/definitions.nul"
tar --create --file="$capture/enablement.tar" --absolute-names \
  --acls --xattrs --numeric-owner --null --files-from="$capture/enablement.nul"
systemctl list-unit-files 'chunk-picker*' --no-legend --no-pager > "$capture/unit-files.txt"
systemctl list-units 'chunk-picker*' --all --plain --no-legend --no-pager > "$capture/units.txt"
awk '{print $1}' "$capture/unit-files.txt" "$capture/units.txt" | sort -u > "$capture/names.txt"
while IFS= read -r unit; do
  case "$unit" in *@.*)
    printf 'Id=%s\nActiveState=not-applicable-template\n' "$unit"
    ;; *) systemctl show "$unit" -p Id -p LoadState -p UnitFileState -p ActiveState -p SubState;;
  esac
done < "$capture/names.txt" > "$capture/state.txt"
while read -r unit enabled preset; do
  case "$unit" in *@.*) ;; *.timer)
    active=$(systemctl show "$unit" -p ActiveState --value)
    case "$active" in active|inactive) ;; *) echo "Reconcile timer $unit: $active" >&2; exit 1;; esac
    printf '%s\t%s\t%s\n' "$unit" "$enabled" "$active"
  esac
done < "$capture/unit-files.txt" > "$capture/timers.tsv"
(cd "$capture"; sha256sum units.tar enablement.tar definitions.nul enablement.nul unit-paths.txt roots.txt paths.nul \
  unit-files.txt units.txt names.txt state.txt timers.tsv > SHA256SUMS)
chmod 0600 "$capture"/*
printf 'Retain capture: %s\n' "$capture"
```

Inspect both archive listings (`tar --list --absolute-names -f "$capture/units.tar"`
and the same command for enablement.tar) and SHA256SUMS before installing units.
Keep enablement.tar separate so schedules are restored only after tools. Record this capture path, the staged
installer path, approved package identity and exact tools install receipt in the
private change record. The directory is root-only (0700); keep it through the
rollback hold. Captured service active states are evidence, not instructions to
restart services. Preserve the running writer throughout.

## Combined unit, timer and tools rollback

Use this after the alerts/off-site units were installed. Credentials, configs,
restic binary/repository and all recovery evidence remain untouched. Never
delete locks or maintenance/transaction evidence, kill an owner, or restart the
writer to force a switch. On a refusal, retain the stopped schedules and
reconcile the named condition with the retained staged installer/recovery path.

1. Before changing anything, run the capture block again to retain the complete
   **new** unit set and intended timer states for re-install. Save its path as
   `forward`. Set `prior` to the install-day capture, and validate both checksum
   lists. Use literal retained paths from the change record:

   ```bash
   forward="$capture"
   prior=/var/lib/chunk-picker/unit-capture-PRIOR
   (cd "$prior"; sha256sum --check SHA256SUMS)
   (cd "$forward"; sha256sum --check SHA256SUMS)
   systemctl disable --now chunk-picker-monitor.timer chunk-picker-offhost.timer
   systemctl stop chunk-picker-backup.timer chunk-picker-health.timer
   # Drain jobs without stopping their services, including notification instances.
   while systemctl list-units 'chunk-picker*' --type=service \
     --state=active,activating,deactivating,reloading --plain --no-legend --no-pager \
     | awk '$1 != "chunk-picker.service" {found=1} END {exit !found}'; do
     sleep 1
   done
   systemctl list-jobs --no-pager
   ```

   Inspect queued jobs and wait for any picker job to finish before continuing.
   Confirm operation.lock and offhost.lock have no running owner, including
   direct CLI owners outside systemd. If an owner appears, wait for completion
   and repeat the checks. Do not delete a stale-looking record; guarded tools
   acquisition/recovery decides whether it can be reclaimed. Keep all four
   schedules stopped until tools and units match.

2. Restore exactly the captured unit files/drop-ins, removing matching entries
   that did not exist before. This removes new monitor/off-site/failure-hook
   units and drop-ins too. Only picker paths under systemd's search roots are
   removed; unrelated units are untouched. The writer remains running:

   ```bash
   restore="$prior"
   (cd "$restore"; sha256sum --check SHA256SUMS)
   # Include current roots so a newly introduced picker unit cannot survive.
   { cat "$restore/roots.txt"; systemd-analyze unit-paths; } > "$forward/restore-roots.raw"
   while IFS= read -r dir; do
     [ ! -d "$dir" ] || readlink -e -- "$dir"
   done < "$forward/restore-roots.raw" | sort -u > "$forward/restore-roots.txt"
   while IFS= read -r dir; do
     [ ! -d "$dir" ] || find "$dir" -name 'chunk-picker*' -prune -print0
   done < "$forward/restore-roots.txt" | sort -zu > "$forward/remove-paths.nul"
   while IFS= read -r -d '' entry; do rm -rf -- "$entry"; done < "$forward/remove-paths.nul"
   tar --extract --file="$restore/units.tar" --absolute-names \
     --acls --xattrs --numeric-owner --same-owner --same-permissions
   systemctl daemon-reload
   tar --compare --file="$restore/units.tar" --absolute-names
   ```

   Inspect `systemctl cat chunk-picker.service chunk-picker-backup.service
   chunk-picker-health.service`: legacy units must have no new OnSuccess or
   OnFailure CLI dependency. Compare the installed picker path list with the
   captured list, including drop-ins. Do not clear failed units as a substitute
   for investigating a failure.

3. Restore tools with the retained **new staged** installer, existing operator
   config and exact install receipt, using the rollback command above. Retain
   its new rollback receipt and verify the selected tree. If several later
   installs exist, follow their matching receipts newest first; never guess a
   legacy destination or alter a receipt. If interrupted, keep schedules stopped
   and use the staged recover command. Recovery alone does not complete the
   combined procedure; recheck both units and selection before proceeding.

4. Restore the captured enablement links now that tools and units match. Unit
   masks were preserved with their definitions in step 2. Verify enablement
   against the capture, then restore each captured timer's active state.
   This preserves enabled-but-stopped and disabled-but-active timers as well:

   ```bash
   tar --extract --file="$restore/enablement.tar" --absolute-names \
     --acls --xattrs --numeric-owner --same-owner --same-permissions
   systemctl daemon-reload
   tar --compare --file="$restore/enablement.tar" --absolute-names
   while IFS= read -r dir; do
     find "$dir" -name 'chunk-picker*' -prune -print0
   done < "$restore/roots.txt" | sort -zu > "$restore/restored-paths.nul"
   cmp "$restore/paths.nul" "$restore/restored-paths.nul"
   while read -r unit enabled active; do
     actual=$(systemctl is-enabled "$unit" 2>/dev/null || true)
     [ "$actual" = "$enabled" ] || { echo "Enablement mismatch: $unit" >&2; exit 1; }
     case "$active" in active) systemctl start "$unit";; inactive) systemctl stop "$unit";; esac
     [ "$(systemctl show "$unit" -p ActiveState --value)" = "$active" ]
   done < "$restore/timers.tsv"
   systemctl list-timers 'chunk-picker*' --all --no-pager
   ```

   Timers absent from the prior capture must remain absent and disabled. Check
   `systemctl list-unit-files 'chunk-picker*'` against unit-files.txt. Persistent
   timers may immediately start catch-up work; wait for its owner before tests.

5. Run a real `systemctl start chunk-picker-backup.service`; require a newly
   created recovery directory and verify it with the retained staged
   recovery.mjs `verifyBackup` export. A skipped command or old status file is
   insufficient. Wait until the writer has been up for at least five minutes
   (ActiveEnterTimestampMonotonic compared to /proc/uptime), then start
   chunk-picker-health.service. Require a fresh `Operator command completed.`
   journal entry and successful service result; legacy tools may not write the
   new health-status.json or dead-man ping. With new tools, also require fresh
   result=success and a health receipt. Confirm authenticated private health
   reports ready and savesReady, the writer PID/NRestarts match the baseline,
   no pending gates remain, and timer enablement/active state matches the
   capture. Inspect backup dependencies: no absent off-site CLI may be launched.

   For example, with `staged` set to the retained new package, this verifies
   **new** recovery directories and private readiness using existing exports.
   Run after timer catch-up work has drained, with RS3_OPERATOR_CONFIG exported:

   ```bash
   export RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json
   staged=/var/tmp/tools-package
   /opt/node/bin/node --input-type=module --eval "$(cat <<'NODE'
   import { readdir } from 'node:fs/promises';
   import { execFileSync } from 'node:child_process';
   import { pathToFileURL } from 'node:url';
   const root = process.argv[1];
   const load = name => import(pathToFileURL(`${root}/scripts/linux/${name}.mjs`));
   const { operatorSettings, readRelease } = await load('runtime');
   const { verifyBackup } = await load('recovery');
   const { privateRequest } = await load('operator');
   const settings = await operatorSettings(), before = await readdir(settings.backupDir);
   execFileSync('systemctl', ['start', 'chunk-picker-backup.service']);
   const fresh = (await readdir(settings.backupDir)).filter(n => n.startsWith('recovery-') && !before.includes(n));
   if (!fresh.length) throw Error('No new recovery backup');
   for (const name of fresh) await verifyBackup(`${settings.backupDir}/${name}`);
   const release = await readRelease(settings.current, settings.dataDir);
   let health = await privateRequest(release, '/api/health');
   if (!health.ready && health.worker?.status === 'sleeping') {
     const view = await privateRequest(release, '/api/state');
     await privateRequest(release, '/api/tasks?memberId=' + encodeURIComponent(view.state.members[0].id));
     health = await privateRequest(release, '/api/health');
   }
   if (!health.ready || !health.savesReady) throw Error('Writer not ready');
   console.log('Fresh backup verified; writer ready and savesReady');
   NODE
   )" "$staged"
   ```

   After the grace, record the time, run health and inspect only that run:

   ```bash
   since=$(date --iso-8601=seconds)
   systemctl start chunk-picker-health.service
   systemctl show chunk-picker-health.service -p Result -p ExecMainStatus
   journalctl -u chunk-picker-health.service --since "$since" --no-pager -o cat
   systemctl show chunk-picker.service -p MainPID -p NRestarts -p ActiveState
   ```

## Re-install after combined rollback

Keep OS servicing idle and use the same exclusion and owner-drain checks.
Stop the restored backup/health timers (and any other captured active picker
timers) without stopping services. Retain the rollback evidence.

1. Verify the approved retained package and use its staged tools-install.mjs
   `install /opt/chunk-picker/tools /var/tmp/tools-package` command with the
   existing configuration. Retain the new receipt; never copy tools in place.
2. Set `restore="$forward"` and repeat step 2's unit restoration block, omitting
   its first `restore="$prior"` assignment. This restores all ten new templates
   and their captured drop-ins exactly. Verify their root ownership/modes and
   loaded OnSuccess/OnFailure targets. Do not reinitialize restic or republish
   credentials/configs.
3. Repeat step 4 with `restore="$forward"` to restore intended enablement and
   activity for all four timers. Repeat step 5: real backup, automatic off-site
   completion, acted-on health after grace, private readiness, package/unit
   verification and intended timers. Require fresh backup/offhost/health success
   statuses and all three dead-man receipts; check live acceptance separately.
   Restore the recorded OS servicing state after verification.

# Independent server alerts and encrypted B2 recovery

This is a later deployment procedure. The alerts/off-site PR authorizes code and
review only. Obtain the live-install decision after CI and the disposable
rehearsal. Keep the existing PC copies. UptimeRobot is configured separately.
The current adapter supports the single-picker recovery format; it refuses
multi-picker mode rather than omit any service roots.

## Protection and retained copies

The private, dedicated B2 bucket has one lifecycle rule: retain hidden versions
for **31 days**, with no rule that hides files based on upload age. The VPS key
has only listBuckets, listFiles, readFiles and writeFiles, restricted to this
bucket and the chunk-picker/ prefix. It has no deleteFiles, writeBuckets,
writeKeys or retention-management authority. Its credential cannot permanently
remove existing versions or shorten their protection.

This follows restic **0.18.1** native B2 behavior. In upstream
internal/backend/b2/b2.go, Remove first attempts version deletion, then falls
back to Hide on an authorization failure. Overwrites and hide markers leave
previous versions recoverable. The 31-day clock starts when a version becomes
hidden, including an old pack referenced by a recent snapshot. The VPS runs
backup with restic's normal repository lock; check/snapshots use --no-lock.
All commands use --no-cache. Restic 0.18.1 backup ignores --no-lock, and a
non-dry-run forget rejects it, so flags are selected per command. Removing a B2
lock object with the upload key hides its version; it grants no permanent-delete
authority. A separate offhost.lock coordinates upload/init and trusted cleanup.
The VPS never runs forget or prune. A malicious VPS can hide or overwrite names, stop uploading, consume
storage or expose its own current secrets. It cannot erase the protected
versions. Recovery from a malicious hide/overwrite must reconstruct the
repository's **version view from before the incident**, not just run restic
against its damaged current view. Detect and recover within 31 days.

The clean-up key adds deleteFiles, with the same bucket/prefix restriction. It
stays in a 1Password recovery item, together with the repository password and a
copy of the upload credentials for interrupted setup recovery. Only the upload
credentials and repository password go to the VPS. Monthly trusted-PC cleanup
keeps **30 daily, 8 weekly and 12 monthly** snapshots, grouped by host and tags.
Until cleanup runs, extra snapshots consume storage; they are never pruned by
the VPS. Object Lock is not used: normal native B2 prune permanently deletes
versions, which would conflict with locked pack/index objects. Separating the
delete key keeps pruning explicit without giving the VPS that authority.

The restic archive and extracted binary checksums are pinned in
scripts/linux/restic.mjs for Linux x64/arm64 and the Windows x64 cleanup client.
They were checked against upstream v0.18.1 SHA256SUMS, with extracted binary
hashes calculated from the verified archives. The server checks the installed
binary hash before each run. Treat upgrading restic or changing lifecycle/key
capabilities as a new reviewed change.

## Inputs needed from the owner

Have a private Discord channel webhook, a Healthchecks project with a full API
key, a temporary B2 setup key, and an unlocked 1Password CLI session in the
chosen vault. Choose a globally unique private bucket name; the examples use
chunk-picker-backups. The setup key file is JSON with applicationKeyId and
applicationKey. It needs listBuckets/writeBuckets and listKeys/writeKeys/deleteKeys
for setup. The Healthchecks key file contains only its API key. Existing input
files belong in protected local storage. Generated keys and passwords are never
written to PC files or printed; subprocess output is captured. SSH uses the
existing picker-vps alias, with passwordless root/sudo and Python 3.

Cloud setup, secret installation, installed-key lookup and cleanup accept only
picker-vps. Before cloud mutations or sending credentials they require a local
private pin for the production SSH host key fingerprint and machine-id hash.
Run the explicit, read-only `capture-identity` operator step from
[setup safeguards](alerts-offsite.md) once before using these helpers. Capture
is never run by bootstrap or setup. All setup connections use strict checking
against the pinned key and verify the machine-id hash; missing pins or a scratch
identity refuse before any cloud mutation or credential transfer.
They also verify the root-owned, non-writable-by-others
/etc/chunk-picker/deployment.json marker:
`{"format":"picker-deployment-v1","role":"production","alias":"picker-vps"}`.
The bootstrap installation below creates it without replacing an existing value;
this role marker does not establish host identity.
An absent, linked, unsafe or different marker refuses setup. picker-scratch is
reserved for the account-free scratch rehearsal, with a local restic repository
and loopback notification receiver. Cloud setup and production credential
installation always refuse picker-scratch; do not copy production credentials
or recovery items there. Arbitrary aliases and address literals are refused.

Run only one setup process at a time. The scripts refuse duplicate names, weaker bucket lifecycle rules, broader keys,
conflicting installed values, or a lost independent recovery item. They do not
silently rotate credentials. Re-running after an interrupted remote credential
write reuses the values in 1Password. Keep access to that vault independently of
the VPS and this PC. Add a B2 usage alert with a $1 monthly budget.

## Install order

Do not enable the new timers until the credentials, configurations and receipt
tests below are complete. Commands in this section are for the later approved
installation. Never put credential values in a command, transcript or shell
history; use file contents/stdin. Do not remove maintenance evidence to make a
check pass.

1. Finish OS servicing and any required reboot before the change. Record the
   enablement/active state of apt-daily.timer, apt-daily-upgrade.timer and
   unattended-upgrades.service. Allow running apt/dpkg work to finish; do not
   interrupt it. During measurements, stop and runtime-mask the apt timers and
   stop unattended-upgrades only after servicing is idle. Restore their recorded
   state after verification, removing only masks added for this change. Record
   the writer PID and NRestarts; an unrelated restart invalidates continuity
   and downtime measurements.

   Pass the disposable rehearsal from this branch. It now installs the pinned
   restic binary, exercises monitor/notifier against a loopback HTTP receiver on
   an OS-assigned port, and backs up/restores/checks/prunes an encrypted **local** restic
   repository. No service account calls are made by that rehearsal. Its report
   includes alerts.restored, retentionChecked and notificationsReceived. It
   leaves synthetic evidence on the disposable host. This tests local encryption
   and recovery, not B2 policy enforcement or a human receiving a message.
2. Follow the tools-package build/verify and atomic install procedure above,
   using the merged stack's approved tools identity. Stage the complete matching committed public source under
   /var/tmp/chunk-alerts-source, including scripts/ops/install-restic.mjs and its
   imports, the systemd files and example configs. Use a fresh staging directory;
   export HEAD with git archive rather than copying an uncommitted checkout. Install Python 3, bzip2, util-linux and CA
   certificates if absent, then run on the server:

   ```sh
   sudo /usr/bin/node /var/tmp/chunk-alerts-source/scripts/ops/install-restic.mjs
   ```

   Prepare non-secret monitor.json and offhost.json in that fresh staging
   directory from the examples. Set the existing operator controlDir, backup
   filesystem and chosen bucket there, then publish through the installer:

   ```sh
   sudo /usr/bin/node /var/tmp/chunk-alerts-source/scripts/linux/bootstrap-alerts.mjs picker-vps /var/tmp/chunk-alerts-source/monitor.json /var/tmp/chunk-alerts-source/offhost.json
   ```

   Publication is atomic and create-only, or requires byte-for-byte agreement
   with an existing value. It explicitly sets file modes. Existing different
   configs refuse; reconcile their reviewed contents rather than recopy examples.
   Keep secrets out of these JSON files.
   Restic settings use repository b2:<bucket>:chunk-picker. The rebuild bundle
   includes /etc/chunk-picker (including secrets), the ten allowlisted units
   and their drop-ins, current pointer, selected release, pinned inputs and
   selected immutable tools version. Every selected pack and addon includes
   its manifest and every referenced payload, with hashes checked after copying.
   The manifest maps each original pin path to its staged manifest; restore its
   entire containing payload directory, preserving relative paths.
   Files outside the release or dedicated
   /opt/chunk-picker/packs root refuse the bundle. Store no unrelated data under
   /etc/chunk-picker. Staging budgets the snapshot and rebuild copies on their
   actual destination filesystem before copying and before each bounded write,
   preserving operator minFreeBytes (15 GiB in production). Insufficient space
   fails before upload and removes only this job's staging. Restic's cache is disabled;
   its temporary packs use a separate private TMPDIR on the budgeted filesystem.
   Pinned pack/concurrency options and a kernel file-size ceiling bound that
   allocation to 193 MiB above minFreeBytes. A space watcher aborts the owned
   upload before consuming the reserve and waits for exit before temp cleanup.
   See [setup safeguards](alerts-offsite.md) for the bound and failure policy.
3. Install the Discord webhook from a protected input file through the validated
   installer. It validates the complete URL before SSH, checks deployment identity,
   sends secrets only over stdin, and publishes root-owned 0600 files atomically:

   ```powershell
   node scripts/ops/setup-discord.mjs --key-file <webhook-file> --ssh picker-vps
   ```

   Empty/partial input fails without touching the destination. Existing values
   must agree. For a reviewed replacement, use the same command with --rotate;
   this is the explicit rotation action. Never pipe directly into a secret file.

4. On the PC, run the B2 setup script first, then Healthchecks. Arguments are
   file paths and non-secret labels, never key values:

   ```powershell
   node scripts/ops/setup-b2.mjs --key-file <temporary-setup-key-file> --ssh picker-vps --bucket chunk-picker-backups --vault <vault>
   node scripts/ops/setup-healthchecks.mjs --key-file <healthchecks-key-file> --ssh picker-vps
   ```

   B2 setup creates/verifies the private bucket and protection, saves and verifies
   the independent recovery item before publishing VPS credentials, and creates
   no PC key files. The root-only files are b2-account, b2-key and restic-password.
   Healthchecks idempotently creates/updates three named checks, then writes
   health-ping, backup-ping and offhost-ping only under the same server secrets
   directory. It prints none of their URLs. Health uses a 10-minute period plus
   30-minute grace; backup and off-site each use a 24-hour period plus 12-hour
   grace. Configure Discord/email recipients for all three in Healthchecks and
   verify their association. Revoke the temporary B2 setup key after verification.
5. Before replacing any unit, run [install-day capture](#install-day-unit-capture).
   Retain its directory and the tools install receipt together in the private
   change record. Inspect every effective ReadWritePaths with systemctl cat,
   including drop-ins. Confirm the operator's data/control, backupDir and
   scratchRoot directories exist with their reviewed ownership and permissions;
   the templates need /var/lib/chunk-picker and /var/backups/chunk-picker.
   Create missing directories from the approved configuration before starting
   units. Do not use a leading '-' to hide a missing required writable path.
   Fresh-machine namespace failures are setup failures, not successful probes.

   Install all ten matching unit/timer files with root ownership and mode 0644,
   including the writer's OnFailure change:

   ```sh
   sudo install -o root -g root -m 0644 /var/tmp/chunk-alerts-source/scripts/linux/systemd/chunk-picker*.service /etc/systemd/system/
   sudo install -o root -g root -m 0644 /var/tmp/chunk-alerts-source/scripts/linux/systemd/chunk-picker*.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

   LoadCredential supplies per-service credential files; runtime.env contains
   only the existing non-secret operator-config path and runtime settings.
   Initialize the new restic repository exactly once under a credential-bearing
   transient unit:

   ```sh
   sudo systemd-run --unit=chunk-picker-offhost-init --wait --collect --pipe -p EnvironmentFile=/etc/chunk-picker/runtime.env -p LoadCredential=b2-account:/etc/chunk-picker/secrets/b2-account -p LoadCredential=b2-key:/etc/chunk-picker/secrets/b2-key -p LoadCredential=restic-password:/etc/chunk-picker/secrets/restic-password /usr/bin/node /opt/chunk-picker/tools/scripts/linux/offhost-backup.mjs init
   ```

   Initialization refuses an existing repository. Never delete its config/key
   objects to retry. The setup scripts themselves are safe to re-run.
6. Verify picker-footprint.service is retired: inspect systemctl show for
   FragmentPath/Transient/ActiveState, systemctl cat, and list-timers; confirm
   no installed unit, drop-in, timer or operator workflow still invokes it. If
   that confirms the retained failure is only the retired transient harness:

   ```sh
   sudo systemctl reset-failed picker-footprint.service
   ```

   Retain any other failed unit for investigation; do not clear all failures.
7. Send a test notification and test ping explicitly:

   ```sh
   sudo systemd-run --unit=chunk-picker-alert-test --wait --collect --pipe -p LoadCredential=discord-webhook:/etc/chunk-picker/secrets/discord-webhook /usr/bin/node /opt/chunk-picker/tools/scripts/linux/notify.mjs test
   sudo systemd-run --unit=chunk-picker-ping-test --wait --collect --pipe -p LoadCredential=health-ping:/etc/chunk-picker/secrets/health-ping /usr/bin/node /opt/chunk-picker/tools/scripts/linux/ops-status.mjs ping health
   ```

   Confirm the test notification is actually visible on the owner's phone or
   desktop. Confirm the ping timestamp in Healthchecks, then use its integration
   test to deliver a notification and confirm human receipt. A successful HTTP
   response alone does not prove someone receives alerts. Record receipt time,
   channel and check name without URLs or values.
8. Run systemctl start chunk-picker-backup.service. OnSuccess starts the off-site
   service after the verified backup finishes; direct operator backup calls also
   request an upload after releasing the exclusion. The uploader holds it only
   for source selection and immutable, verified staging. It releases operation.lock
   before any restic/network work, so writer startup and local backups remain
   available while upload is slow, even if the original snapshot is pruned.
   offhost.lock spans the whole off-site job and fences cleanup. The application
   deadline is 30 minutes across steps; systemd limits startup to 35 minutes and
   teardown to 30 seconds. Confirm both
   services finish successfully and inspect their structured status privately.
   backup-status.json and offhost-status.json under controlDir must show success,
   a recent snapshotAt, and a recent off-site lastSuccessAt. Old manifests without
   capture time are excluded. A backup from another selected release refuses
   upload; make a fresh backup after activation. Failed upload/check retains
   local and existing remote restore points. Healthchecks ping failure never
   changes a successful job to failed.
   Before release derive or accept, wait for the automatic uploader to finish
   source selection and release operation.lock. Check the owner and retry a
   guarded refusal; never stop the owner or delete its lock. Waiting for the
   complete off-site service to become inactive is a conservative alternative.
   Record that wait separately from derive/accept and writer downtime.
9. Enable/start the backup, health, monitor and off-site timers:

   ```sh
   sudo systemctl enable --now chunk-picker-backup.timer chunk-picker-health.timer chunk-picker-monitor.timer chunk-picker-offhost.timer
   sudo systemctl start chunk-picker-health.service chunk-picker-monitor.service
   ```

   Wait at least five minutes from the writer's latest startup before requiring
   an acted-on health run. Within the grace, exit 0 can mean skipped. After the
   grace, start health again and require a fresh health-status.json with
   result=success (not skipped), a completion journal entry and a new health
   dead-man receipt. A PID change restarts the grace.

   The monitor observes every five minutes, even if health skips an inactive
   writer. It warns at 36-hour source/delivery age and escalates at 48 hours;
   checks both off-site capture time and delivery time; warns below 15 GiB disk
   and urgently alerts below 5 GiB; warns below 2 GiB available RAM for ten
   minutes and urgently alerts below 1 GiB. It reports failed units, durable
   operator faults, marker presence/abandonment and operations over 30 minutes.
   The retry timer runs hourly at minute 30 with up to five minutes jitter and
   Persistent=yes, independent of local backup success. It skips a busy operator
   and retries later. Observe one scheduled run and all three dead-man timestamps.

   Live acceptance also requires human receipt of the webhook and Healthchecks
   integration test, fresh external health/backup/off-site dead-man timestamps,
   verified B2 restricted-key capabilities and 31-day hidden-version lifecycle,
   and a recovery item retrievable independently of this server and PC. Record
   readiness/saves-ready, the selected tools identity, exact unit metadata and
   intended timer states, fresh verified local backup and remote restore/check
   evidence, and absence of pending operation/maintenance/transaction gates.
   Synthetic loopback receipts and local restic encryption do not satisfy the
   external or human acceptance checks.

Notification state is durable under controlDir, with deduplication, recovery
messages, at most four delivery attempts per ten minutes and at least 30 seconds
between attempts. A separate durable outbox retains unacknowledged incidents
and resolutions even when a fault clears during a delivery outage. Delivery is
at least once; an interruption after Discord accepts a message may duplicate it.
Producers atomically persist assertion/recovery mailboxes before trying the
sender lock. The fixed mailboxes and a compacted outbox bound storage during a
delivery outage. Pending events are capped at 96 events and 16 KiB, retaining
the oldest unresolved incident and newest state with an `N alerts were dropped`
summary. Corrupt state is atomically moved aside and the notifier sends the
fixed phrase `notifier state was reset` before resuming normal delivery.
Unreadable or partial monitor samples preserve unresolved faults and memory
history; only a successful observation confirms recovery. Unresolved critical/urgent faults repeat every six hours
(configurable within one to 24 hours); warnings repeat only on change. Messages
contain fixed categories only, without journal text, paths, machine names, IPs
or credentials. During a declared release, a root-owned release-window.json under
controlDir may contain startedAt/endsAt UTC timestamps for at most 30 minutes.
It suppresses writer/maintenance notifications only. Resource/job faults still
alert. Expired/invalid declarations alert until explicitly reconciled. The
monitor never deletes maintenance.json or other transaction evidence.

## Monthly cleanup and incident recovery

Use a trusted PC and a verified restic 0.18.1 client. Download/extract its release
archive; prune-b2.mjs checks the binary SHA-256 against the pin before accessing
credentials. Do not copy the clean-up key to the VPS. The script uses the key
and repository password only in child-process memory and disables the local
restic cache. It captures all repository output.

Prune and check use two backend connections (backup uses one). Their Linux temp
envelope is 225 MiB above the reserve. Windows cleanup uses space admission
instead of a fixed-size VHD: before deleting snapshots or repacking, it requires
free space on the temp volume for seven worst-case packs plus 1 MiB and the
1 GiB reserve. Each worst-case pack allows twice the larger of the full live
compressed/uncompressed blob volume, plus 128 bytes per blob and 1 MiB, with a
32 MiB minimum. Missing size evidence or insufficient space refuses cleanup.
This covers oversized tree blobs without relying on the 250 ms watcher to stop
writes at a quota. Keep the uploader paused/drained and avoid other disk-heavy
work on that volume during cleanup. See [budget details](alerts-offsite.md).

1. Allow any off-site run to finish, then run:

   ```sh
   sudo systemctl stop chunk-picker-offhost.timer
   sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /usr/bin/node /opt/chunk-picker/tools/scripts/linux/offhost-backup.mjs pause
   ```

   The pause command takes offhost.lock, so it refuses while an upload
   is in flight. Wait and retry; never kill an operation or delete its lock.
   Its durable declaration fences both scheduled and direct module uploads.
   The monitor reports this pause. Keep the declaration through cleanup.
2. On the PC:

   ```powershell
   node scripts/ops/prune-b2.mjs --ssh picker-vps --vault <vault> --item "Chunk picker B2 recovery chunk-picker-backups" --restic <absolute-restic-binary>
   ```

   It verifies deployment identity and refuses unless SSH metadata confirms the
   uploader has been drained and paused for the exact repository in the recovery item.
   It checks the repository, applies 30/8/12 retention and prune, then checks
   again. Failed cleanup leaves the uploader paused for explicit review.
3. After success, run:

   ```sh
   sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /usr/bin/node /opt/chunk-picker/tools/scripts/linux/offhost-backup.mjs resume
   sudo systemctl start chunk-picker-offhost.timer chunk-picker-offhost.service
   ```

   Verify a fresh off-site success and
   human alert recovery. Resume removes only the explicit off-site pause
   declaration. Keep the writer running
   throughout this maintenance. Set a monthly reminder outside this code change.

For suspected VPS compromise, revoke the upload key immediately, preserve B2
versions and stop lifecycle expiration through the trusted account. Use the
clean-up key only from a clean machine. Choose a cutoff before the incident;
list all versions/hide markers under chunk-picker/, select each name's latest
version at that cutoff, and copy those exact file IDs into a **new private
recovery bucket** using temporary recovery authority. Never repair the sole
repository in place or run prune first. This restores overwritten config,
keys, snapshots, indexes and packs as a consistent version view. Verify the
repository with restic check --read-data before selecting a snapshot. The
ordinary case needs the B2 repository, key and independently saved repository
password; a damaged version view additionally needs this B2 version recovery.

Quarterly, restore to disposable Linux with outbound integrations disabled.
On that recovery machine, load RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE,
B2_ACCOUNT_ID and B2_ACCOUNT_KEY from independent recovery credentials without
putting their values in shell history. After installing the pinned restic binary
at /usr/local/bin/restic, use the manual recovery entrypoint:

```sh
node scripts/linux/restore-offhost.mjs <snapshot-id> /absolute/recovery-target /absolute/recovery-temp 1073741824
```

Use a fresh disposable target. The last argument is the free-space reserve in
bytes (1 GiB here). The command checks full snapshot size plus reserve and the
193 MiB temp envelope before restoring, keeps temporary files bounded, and
allows restored files larger than 32 MiB. Do not wrap restore in the uploader's
prlimit --fsize ceiling. It never starts the writer or enables integrations.
Verify the snapshot's manifest/binding and rebuild-manifest inventory. Reinstall
Node and checksum-pinned restic; restore the selected release, pins and tools;
map their original paths from the encrypted manifest; restore /etc/chunk-picker
and units with root-only permissions and the service-owned store with its
binding. Rotate provider/webhook/invite credentials before enabling integrations.
Use test credentials and scratch ports to check representative reads,
calculation and a saved command, then record the source snapshot time and
recovery time. Do not point a drill at the production save or reuse its outbound
credentials. A local restic roundtrip is not a complete application restore drill.

# Using the private picker

The application uses Node.js 24.20.0 or a newer 24.x release and has no runtime package installation. It serves the authored `app/web` interface and local reference data. It never saves to the original author’s Firebase service.

## Start and share

Run `./scripts/Start-Picker.ps1` from the project. It starts a hidden Node process, keeps the durable state at `.local/duo/state.json`, and reports the address without invitation tokens. Open your saved private administrator link. Keep this link and `.local/server-runtime.json` private. Server logs also exclude invitation tokens. Use **Admin → Invite links** to create a separate **Player** invitation labelled `Player 2`, or **View only** for someone watching. Each player chooses her or his map from the Map control; player invitations permit editing both maps, while viewers cannot change the save.

The helper records its child PID and process creation time immediately, with a `starting` state. After ten seconds of slow readiness it prints a managed-starting message; run Start again for status or use Stop. A second Start reuses the owned child, including while it is starting, and does not launch a competitor. `-ReadinessTimeoutSeconds` changes this initial wait.

The Windows helper prefers the desktop’s existing Tailscale IPv4 address. Direct private access requires Tailscale and permission to reach the desktop. Optional public HTTPS through Funnel lets Player 2 use his invitation without Tailscale. [Sharing setup](sharing.md) gives the short admin-console, `RS3_PUBLIC_ORIGIN` and Funnel steps. The picker does not enable Funnel, grant machine access or change network policy. The private master credential is rejected through Funnel, including an existing master cookie; Player 1 can create an administrator invitation for public access.

If the desktop is sleeping or the picker process has stopped, both browsers show connection/save failure. Previously committed progress remains on disk. Run the start helper again when the desktop is available. `./scripts/Stop-Picker.ps1` verifies the recorded PID, process start time and project/store identity, requests authenticated graceful shutdown, and waits for queued saves. New saves are rejected during shutdown. Unfinished connections and the task worker have a ten-second server deadline; accepted saves finish before the store unlocks, with a separate ten-second deadline for transmitting their responses after the save queue drains. Stop waits twenty seconds by default (`-TimeoutSeconds` changes this) and clearly reports any forced stop. An unacknowledged save should be checked after restarting.

**Watchdog.** The existing per-user scheduled task ("RS3 Chunk Picker watchdog") runs `scripts/Watch-Picker.ps1` at logon and every five minutes. Each tick waits for Tailscale to have its `100.x` address, verifies the managed process, and makes an authenticated `/api/health` request. Healthy ticks are quiet. A sleeping task calculator is healthy: checking it does not load its data or wake it.

If a calculation or queued request has gone more than two minutes without progress, or automatic recovery has exhausted its retries, the watchdog first calls `/api/worker-restart` to replace only the affected calculator. The replacement request allows 30 seconds; even if it times out, the watchdog checks health for up to another 30 seconds before fallback. It uses Stop-Picker followed by Start-Picker only if recovery fails. An owned process whose health check fails three times in a row (10 seconds each, 15 seconds apart, so a busy PC is not mistaken for an outage) also uses Stop then Start; a newly starting process gets 5 minutes to bind. While a quick-release candidate builds (its `release-build-active.json` mark names a running build process, under an hour old), a process that fails health but still holds both listeners is left running and the tick logs that instead. If Stop finishes but reports an error, the watchdog still starts the picker once the old process is gone. Stop rechecks ownership and preserves durable saves.

Stop-Picker writes `.local/picker-paused`, so a deliberate stop stays stopped until the next Start-Picker. Restarts and failures go to `.local/watchdog.log`, with invitation and bearer tokens redacted. Registration is a separate operator action through Register-Watchdog; changing these scripts does not register or modify a scheduled task.

**Daily backup.** `./scripts/Backup-Picker.ps1` saves the picker's own full backup (both maps, progress, rules, notes and History; no access token or invitations) zipped as `rs3-chunk-picker-YYYY-MM-DD.zip` in the folder named on the first line of `.local/backup-destination`, keeping the newest 30. `./scripts/Register-Backup.ps1` runs it daily at 04:00 through a per-user scheduled task that catches up after sleep; results go to `.local/backup.log`. Unzip a file and restore the `.json` through **More → Export / Import**. The zip also holds `…-feedback.json`, a copy of `.local/duo/feedback.json`; to bring feedback back, stop the picker and copy it there as `feedback.json`. After restoring on a new machine, create new invitation links.

Admins see **Last backup** in More and Backup & Import, plus a calm notice when the latest run failed, the last successful run is over two days old, or no automatic destination is configured. Missing or unreadable run records also prompt a check. Player 2's non-admin invitation receives no backup notices or status data. The timestamp names the latest successful backup; a later failed attempt appears in the warning. Opening More or Backup refreshes the status, and visible admin pages check every 15 minutes. A portable download remains available while automatic backups need attention.

Backup-Picker atomically replaces `.local/backup-status.json` after success or failure. It records time, result, file name, byte size and save revision, retaining the last successful time after a failure. The server reads only bounded local metadata (and the last 64 KB of the old log when no status file exists). `/api/backup-status` requires administrator access and returns only times, outcome, size and a warning code, never destination paths, file names, credentials or save contents. A one-off `-Destination` does not configure the next scheduled run: write `.local/backup-destination` for that. Backups call `/api/backup` directly and work while all task calculators are asleep. Script failure logs redact credentials. No scheduled task changes are needed to use the updated scripts.

For foreground use or another machine:

```powershell
npm start -- --host 127.0.0.1 --port 8788
```

Use one server and one data directory for the group. Do not copy live state independently onto both computers and edit separate servers.

## Import existing progress

`npm run capture` performs scoped, read-only public GETs for maps QXA and QXB. It saves an ignored snapshot in `.local/imports/` with capture time, source version and SHA-256 metadata. Capturing does not alter either original map.

Open **Backup & Import**, choose the two-map snapshot, and select **Preview import / restore**. Review owner counts, additions, removals, rules and warnings before applying the replacement. A concurrent save invalidates the preview and must be reviewed again. Download a full backup first when replacing an already used group.

A fresh store may be initialized once at launch:

```powershell
./scripts/Start-Picker.ps1 -ImportPath './.local/imports/maps-<timestamp>.json'
```

Do not repeat the import on every launch. The server refuses it over existing gameplay. The normal helper thereafter loads the durable state.

Original checks become challenge completion, not observed personal quest/reward completion. Category-aware conversion resolves known duplicate task IDs. Unresolved records remain in the full backup and are visible through **View migration report**. They are never silently assigned to another task.

## Daily use

Choose Player 1 or Player 2’s map. **Group view** shows both owners; access sharing remains a separate rule. Click a chunk or use **Search** to view nested section contents, set its candidate state, add notes, adjust section/area access, or backlog a source. Sources and tasks have separate backlog controls.

**Pick Chunk** immediately unlocks one eligible chunk. **Roll 2** offers two locked choices; choose one, unlock both, or cancel. A single remaining candidate disables Roll 2. Pending choices and blacklists cannot be bypassed by a teleport.

Task checkboxes record that player’s challenge contribution. Task details offer a separate personal game-progress checkbox, backlog, favorite, note, all blockers and sources. The active list shows next goals; **All possible tasks** and Search retain the full available catalogue. Unsupported hard requirements appear when **Show blocked** is enabled and are described in calculation details.

Teleport confirmations belong to the selected player. Mark one usable only when that player can use it. Its destination becomes a roll candidate and stays locked until rolled. Consumable teleports default off. Lodestone travel does not automatically grant a new chunk.

**Chunk Rules** contains shared policies and the player’s saved task rules. Profiles export/import these settings with a preview and a single undoable application. F2P progression is a deliberate shared setting; the app does not advance membership automatically. **Predict tasks** is an isolated preview and never saves the hypothetical unlock.

## Saves and recovery

**History** filters by player and type of change and searches change sentences, names and note text. It starts with 150 changes; **Load older** reads another page, including archived history. A player filter includes changes made through that player's invitation and changes to that player's map. Advanced loads the original command details only when expanded. A save arriving during a read prompts **Refresh History**.

**Browse previous saves** labels each restore point with its recorded change, author when available and date. Revision numbers and file sizes are under Advanced → Save details. Older snapshots without a matching history entry say **Saved changes**; the original baseline says **Initial save**. Restoring still requires a preview. Selected snapshots are previewed and applied directly on the server, without downloading and uploading the full backup again.

Each command uses the expected shared revision. A conflicting save loads the current state, explains the conflict and leaves the rejected change unapplied. Review it and retry; the app never retries a roll automatically.

Committed writes use a queued transaction, a synchronized temporary file and atomic replacement. The prior state is retained under `.local/duo/backups/`. Backups and state files are not committed to Git. The default policy keeps all standalone snapshots from the last 90 days, older daily checkpoints, the baseline/latest snapshots and copies preceding restore/catalogue refresh. Other old snapshots are packed into verified compressed archives before standalone files are removed; every retained revision remains browsable. Recent history is bounded to roughly 1,000 events, extended when undo or a pending roll needs an older event. Complete history segments remain durable, and full backup downloads include them. Undo can still reach archived commands. Keep the entire data directory together, including `history/` and `backups/archives/`. Archival reduces repeated history and snapshot storage; it does not discard the sole copy of an event or revision. Set `npm start -- --backup-days 180 --history-entries 2000` for a larger recent window. Archives still grow with new gameplay, so monitor disk space and retain portable full backups elsewhere.

**Download full backup** produces a portable `.json.gz` gameplay backup including both players, rules, original records and history. Backup & Import accepts `.json` and `.json.gz` up to 256 MiB after decompression, including JSON extracted from the daily backup ZIP. It excludes authentication records in `.local/duo/invites.json` and the separate `.local/duo/access-token` master credential. Keep these private files separately for server-access recovery. Gameplay restore does not reset invitations, sessions or revocations. Restore requires a preview. A restore starts a new undo boundary; earlier live changes remain searchable in History, and imported history remains archived in backup provenance. Undo can reverse subsequent commands and cannot cross the restore boundary. See [large backup handling](backup-import.md) for limits and memory behavior.

Large catalogue, identity and migration fields are stored once as compressed, content-addressed files in `static/`. The private `state.json` and retained snapshots can reference these files. Startup and backup reads check their SHA-256 hashes and hydrate the complete state; missing or corrupt dependencies fail closed. Keep `static/` with the rest of the data directory when copying or recovering it. Use **Download full backup** for a standalone, portable compressed JSON file. Every command still synchronizes its previous-state backup and atomically replaces the current state before acknowledging the save. Periodic backup packing runs outside the command queue, and graceful shutdown drains it.

Command responses reuse unchanged large fields from their submitted revision instead of downloading the archives after every click. Such responses include `baseRevision` and `unchangedFields`; the browser combines them with that exact submitted snapshot, or fetches the complete current state if its baseline is unavailable. API clients should apply the same rule or request `/api/state`, which always returns the full state. Revision conflicts also return the full current state.

Malformed state is never replaced with an empty group. If startup fails, preserve the data directory, inspect `.local/server-error.log`, and restore a known full backup into a separate data directory before replacing anything. An OS-owned mutex prevents competing recovery attempts and releases automatically after a crash. Lock and recovery-marker records contain PID, process start time and host. Startup automatically recovers a provably stale local owner, including an interrupted recovery that already removed the original lock. A reused PID is distinguished by creation time. Foreign-host or unverifiable ownership fails closed. Legacy empty recovery markers are automatically removed only with a provably dead lock owner and an age of at least 30 seconds.

If ownership cannot be verified, preserve the complete data directory first. Inspect `store.lock` and `store.lock.recovery`, compare their host to this computer and compare the PID/start time to `Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"`. Stop the owned server with the helper if it is alive. Only after independently confirming that neither recorded owner can still write, move the lock and marker to timestamped review copies in the same data directory, then start once. Do not remove or replace `state.json`, history segments or backups to clear an ownership error. A copied directory from another host requires this explicit owner review; its foreign-host marker is not automatically declared stale.

After a computer restart the watchdog handles one case by itself. That case is a `store.lock` for this computer whose process start and lock creation both come before the last boot, with no `store.lock.recovery` marker and no process naming the data directory. The watchdog moves that lock to a `store.lock.restart-<UTC time>` review copy and starts the picker. A runtime record started before the last boot likewise no longer owns its PID, even if Windows has since given that PID to another process. The watchdog also handles a writer that exited without a restart, for example one ended with the app or session that launched it. That case is a `store.lock` for this computer whose PID and start time match the runtime record, created after that start, with no `store.lock.recovery` marker, no process naming the data directory and no process holding that PID. The watchdog moves it to a `store.lock.dead-<UTC time>` review copy and restarts the picker. Helpers now start the picker outside the calling job when Windows allows it, so closing that app or session no longer ends it. Every other lock still waits for the manual review above.

Task calculation recovery is separate from saving. The status line shows recovery or a required restart. The watchdog can now replace failed calculators after their three-attempt recovery budget is exhausted. An admin can also POST `{}` to `/api/worker-restart`; healthy and sleeping calculators remain untouched. Retired calculations return a retry message; acknowledged saves, maps and history stay in the running server. `/api/health` reports `ready: false` for a stall or exhausted recovery and `savesReady` separately. Its worker summary includes `stuck`, `recovering`, `restartRequired` and numeric active, queued and no-progress durations; it inspects only already existing calculators. Stage-completion progress messages contain only a request number. An authenticated GET to `/api/diagnostics` reports queue depth, failures, cache footprint and stage timing summaries without personal state or the invitation. Use the existing invitation session, and keep the access-token file private.

After a restart, the HTTP listener opens before the save and task catalogues are
ready. A private master-bearer health check returns HTTP 200 with
`status: "warming"`, `ready: false` and `savesReady: false`. Other requests receive
HTTP 503 and `Retry-After: 1`; commands are refused before their bodies are read
and are never queued. Retry after initialization finishes. The normal
authenticated handler takes over only after the store, migrations, initial
import and invitation sidecars are ready. Initialization failures close the
listeners and leave existing saves intact. A fresh store has no master health
credential until its access-token file is created.

Once saves are available, startup quietly prepares both full task lists and
both players' Preview baselines through the existing worker background queues.
Foreground requests take priority; queued warm work resumes after a quiet
second. Preparation changes no save or History. Existing pending/selected-chunk
prediction warming follows it. Background work neither extends the ten-minute
worker lifetime nor wakes a sleeping worker. Diagnostics expose `startupWarmup`,
numeric startup stage timings and `worker.retiring` (threads releasing memory).
Production worker startup has a five-minute allowance; request deadlines and
recovery limits are unchanged. Stopping during compilation cancels it; stopping
during a store operation waits for its safe completion before releasing the lock.

## Current limits

The reference dataset contains malformed aliases and missing gates; these are diagnosed and hard requirements fail closed. Ordinary equipment and coupled weapon recommendations are implemented; target-specific combat simulation, bespoke set bonuses, weight-only/skilling/relic equipment views and discretionary XP-choice editing remain outside current automatic scoring. Full feature coverage and evidence are in the parity and verification documents.

## Reliability verification

`npm test` includes worker crash/hang, queue/deadline/disconnect, shutdown/save-drain, capture argument and storage interruption/retention regressions. On Windows it also drives Pester-free PowerShell fixtures for slow startup, competitor refusal, process identity, graceful stop and forced-stop fallback. These fixtures use temporary stores and other localhost ports. They do not verify Tailscale reachability or operate the live duo store.

The synthetic retention regression runs 320 commands over 40 simulated days with a two-day backup window and ten-event history target. It retains all 320 prior revisions (55 standalone checkpoints and 265 packed snapshots), keeps 12 events in live history, and uses about 91 KB versus 718 KB with retention disabled: an 87% reduction. These deliberately short test windows differ from the conservative defaults.
