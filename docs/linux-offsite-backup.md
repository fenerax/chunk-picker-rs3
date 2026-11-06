# Daily off-site backup and release delivery

Delivery runs after each successful local backup, including on-demand release
backups. `operator.mjs backup` starts `chunk-picker-offhost.service` without
blocking the operator; `chunk-picker-backup.service` also has an `OnSuccess`
hook. The daily delivery timer runs at 04:30 America/Moncton, after the 04:00
local backup. A release still takes a fresh local backup and waits for delivery
status with both `snapshotAt` and `lastSuccessAt` newer than its backup start.
A systemd success alone does not establish freshness.

The verified local manifest's SHA-256 becomes a restore-point tag. Before
staging, delivery searches that tag in the repository. An existing point is
verified again without another upload, including when the previous process
finished backup but failed verification. New points use the fixed private
`offhost-stage` directory beneath `scratchRoot`, owned by `offhost.lock` and
removed on completion or before a retry. Abandoned staging is reclaimed before
admitting the next allocation, so a crash cannot consume the space needed for
its own cleanup.

Before recording delivery success, `restic dump <snapshot-id> / --archive tar`
reads the selected snapshot's complete metadata and file data with `--no-cache`
and `--no-lock`. The archive is drained without buffering, logging or saving
its contents. This catches missing packs behind stale indexes and corrupt
remote metadata, even when a shared cache is warm. Restic must retrieve and
authenticate every file blob needed to reconstruct the selected snapshot;
success does not rely on a directory listing or on a later daily check.
Verification downloads one complete snapshot, including the rebuild bundle,
but does not traverse older snapshots' trees or allocate another restored
copy. Its data transfer scales with the selected snapshot's size. An actual
application restore rehearsal remains a separate operator procedure.

The full repository check is a **separate daily service**, at 06:00
America/Moncton, with a two-hour command deadline and its own lock and status.
An attempt is recorded before launch; retries cannot run it more than once per
UTC date. It holds neither the upload lock nor the operator lock and cannot
fail the release freshness gate. It runs without `--with-cache` and with
`--no-cache`, so repository metadata must be fetched afresh rather than trusted
from the persistent cache. Upload and ordinary metadata operations retain the
private cache at `controlDir/restic-cache`, with free-space checks; integrity
commands bypass it. Standalone PC restic calls retain their existing
temporary/no-cache policy.

Both services use Nice 10, CPUWeight 20, IOWeight 20 and MemoryMax 2G. The cap
allows the observed 350–750 MiB working memory plus reclaimable page cache.
Failures log at most eight redacted stderr-tail lines, retaining only known
diagnostic phrases. Busy uploads log a reason and write
`offhost-last-skip.json`; contention on the operator lock also sets upload
status to `skipped`, without advancing success timestamps.

Pruning remains a PC-only, owner-approved operation through `prune-b2.mjs`.
Its retention still keeps 30 daily, eight weekly and twelve monthly points.
Grouping is by host, because per-point identity tags must not each get their
own retention group. No delete-capable credential is added to the server.
Pause delivery and stop/drain the daily check before approved PC pruning.

## Deployment runbook (not performed by this change)

Use an approved, scanned source export of the merged commit at
`/var/tmp/chunk-picker-offsite-core`, root-owned and not writable by the service
account. The tools package directory below must be absent. These commands run
as root; they refresh tools without restarting the picker.

1. Stop timer admission, then wait for all existing backup, health and off-site
   service jobs to finish. Do not kill a lock owner or clear transaction files.
   On an upgrade where the daily check already exists, stop its timer and wait
   for that service too.

   ```sh
   systemctl stop chunk-picker-backup.timer chunk-picker-health.timer chunk-picker-offhost.timer
   systemctl show chunk-picker-backup.service chunk-picker-health.service chunk-picker-offhost.service -p ActiveState -p MainPID
   ```

2. Build and verify a complete tools package, then install the units before
   switching tools (the new recovery bundle includes the daily-check units).

   ```sh
   source=/var/tmp/chunk-picker-offsite-core
   package=/var/tmp/chunk-picker-offsite-tools
   /usr/bin/node "$source/scripts/linux/tools-package.mjs" build "$source" "$package"
   /usr/bin/node "$source/scripts/linux/tools-package.mjs" verify "$package"
   install -m 0644 "$source/scripts/linux/systemd/chunk-picker-backup.service" /etc/systemd/system/
   install -m 0644 "$source/scripts/linux/systemd/chunk-picker-offhost.service" "$source/scripts/linux/systemd/chunk-picker-offhost.timer" /etc/systemd/system/
   install -m 0644 "$source/scripts/linux/systemd/chunk-picker-offhost-check.service" "$source/scripts/linux/systemd/chunk-picker-offhost-check.timer" /etc/systemd/system/
   env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /usr/bin/node "$package/scripts/linux/tools-install.mjs" install /opt/chunk-picker/tools "$package"
   systemctl daemon-reload
   ```

   If the tools installer refuses, retain its evidence and reconcile the
   refusal before resuming. Do not replace individual installed scripts.

3. Resume timers and prove on-demand delivery using a fresh local backup.

   ```sh
   systemctl enable --now chunk-picker-backup.timer chunk-picker-health.timer chunk-picker-offhost.timer chunk-picker-offhost-check.timer
   systemctl start chunk-picker-backup.service
   systemctl start chunk-picker-offhost.service
   systemctl show chunk-picker-offhost.service -p ActiveState -p Result -p ExecMainStatus
   cat /var/lib/chunk-picker/control/backup-status.json /var/lib/chunk-picker/control/offhost-status.json
   systemctl list-timers chunk-picker-backup.timer chunk-picker-offhost.timer chunk-picker-offhost-check.timer
   journalctl -u chunk-picker-offhost.service -u chunk-picker-offhost-check.service -n 40 --no-pager
   ```

   Require `result: success`, no faults, and an off-site `snapshotAt` matching
   the fresh local backup. A busy skip requires another on-demand delivery
   after the owner exits. The separate daily check has its own
   `offhost-check-status.json`; it is not a release acceptance requirement.

Roughly twenty redundant hourly snapshots already stored can be thinned later
with `prune-b2.mjs`, using the PC's existing delete authority and the owner's OK.
