# Alert and off-site setup safeguards

These commands prepare operator tooling; installation and live receipt tests
remain separate operator steps. Never put host identity values or credentials in
the public checkout or its logs.

Before cloud setup, independently establish the production SSH key in the
operator's local known_hosts. Then run the explicit, remotely read-only command:

```powershell
node scripts/ops/deployment-identity.mjs capture-identity picker-vps $env:PICKER_DEPLOYMENT_IDENTITY_FILE
```

Set `PICKER_DEPLOYMENT_IDENTITY_FILE` to an absolute private local JSON path
outside this public repository. Its parent must already exist. Without the
variable, setup reads `~/.config/chunk-picker/deployment-identity.json`.
Capture refuses to overwrite a pin. It compares the negotiated ed25519
fingerprint with the remote public host key and records that key, its SHA-256
fingerprint and the SHA-256 of the trimmed `/etc/machine-id`. Inspect and trust
the operator's destination before this one-time capture. No capture or live
connection is performed by tests.

Every setup helper verifies the pinned key through a private, exclusive
known_hosts database with StrictHostKeyChecking=yes, then checks the machine-id
hash before any cloud mutation or credential transfer. Connections cannot reuse
an existing SSH control socket. The deployment marker remains an additional
role check; bootstrap cannot establish trust. Scratch capture uses picker-scratch
and a separate `~/.config/chunk-picker/scratch-identity.json`; its role/alias can
never pass production verification. Do not copy a scratch pin to production.

Restic 0.18.1 uses temporary packs even with --no-cache. The uploader sets
TMPDIR to a fresh private directory under the configured scratchRoot/restic-tmp
on the budgeted filesystem. Pack size is 16 MiB, backup B2 connections and read
concurrency are one, and GOMAXPROCS is one. Prune and check use two backend
connections; repacking requires at least two. The reviewed implementation has two
data packers, two tree packers, one blocked queue item and one uploading pack per
connection. The same connection policy applies to local recovery/test repositories.
Pack targets may overshoot, so util-linux prlimit enforces a 32 MiB file ceiling
only for backup, prune (including forget --prune), init and check temp packs.
The disk envelope is six times 32 MiB plus 1 MiB for allocation and directory
overhead: **193 MiB above minFreeBytes** for one connection; prune/check reserve
seven slots, **225 MiB above minFreeBytes**. A larger individual tree fails safely.
Admission checks that filesystem; a 250 ms watcher preserves an additional full
envelope between checks and kills the owned process on lost headroom or failed
space observations. Cancellation waits for process closure before temp cleanup.
Source copies and remote restore points are never deleted by this path.
Install bzip2 and util-linux before installing/running the pinned binary.

Scratch rehearsals and trusted-PC cleanup use the same guard. All commands
disable caching and override TMPDIR, TMP, TEMP and RESTIC_CACHE_DIR with private
paths. PC cleanup reserves 1 GiB plus the pack envelope on the temp filesystem.
Windows has no kernel file ceiling. Before prune or forget --prune can mutate
anything, it reads raw-data stats for every snapshot and refuses unless the temp
volume can hold seven worst-case packs plus 1 MiB and the reserve. A worst-case
pack is the larger of 32 MiB and twice the entire compressed/uncompressed live
blob volume (whichever is larger), plus 128 bytes per blob and 1 MiB. This
deliberately conservative allowance covers oversized input trees, compression,
encryption and headers without assuming every pack stops at its target size.
Missing/invalid stats or insufficient space refuse before snapshot deletion.
Sampling remains an additional early-abort check, not the capacity bound. The
uploader must remain paused/drained so the repository cannot grow during cleanup.
Linux retains the hard prlimit pack ceiling and its smaller bounded envelope.
Restore payloads are exempt from that ceiling. Before writing, the guard resolves
the snapshot selector to one immutable ID, obtains its full restore-size stats,
and admits the destination only with that size plus the temp envelope and reserve
free. TMPDIR retains its per-file/total budget and watcher; the destination is
also watched for lost reserve. The manual recovery command in the operator guide
uses this same guard, including for files larger than 32 MiB.

Notification producers publish private, atomic mailboxes before trying the
delivery lock. Each fixed category has separate assertion-severity and recovery
mailboxes, plus at most one claimed copy of each during delivery. Identical
transitions coalesce; a recovery cannot overwrite evidence of an incident.
The fixed category vocabulary bounds the spool independently of outage length.
Claimed entries are removed only after the outbox is durable. Corrupt JSON or
invalid state first publishes a fixed reset intent, fsyncing its file and parent
directory before renaming the corrupt evidence aside. Every run replays that
intent into the outbox; it is acknowledged only after the outbox is durable.
The fixed `notifier state was reset` alert therefore survives a crash during
quarantine. A crash after remote acceptance may replay an alert.

Release-window handling covers the monitor's writer categories, its aggregate
failed-unit predicate and the writer OnFailure hook. Only the writer is excluded
from the aggregate during a valid window; other/unknown failed units still alert.
Health recovery skips inactive writers and busy release locks; a skipped health
tick is not a health failure. Actual health, backup, off-site, operator and
resource faults remain visible through both status monitoring and failure hooks.
Missing, invalid or expired windows never authorize writer suppression. Existing
outbox incidents and independent dead-man checks retain their evidence; declaring
a release does not erase earlier failures or manufacture a successful health ping.

The pending outbox keeps the first incident and newest state per category,
including a recovery after a short outage. It has caps of 96 events and 16 KiB
of encoded pending data; the complete fixed-shape state stays below 32 KiB.
Compaction counts omitted transitions. If the cap requires further eviction,
it protects the oldest unresolved incident and newest state. Delivery includes
the fixed summary `N alerts were dropped`; the counter clears only after a
successful send. Discord messages stay below 1900 characters and retain the
existing four-attempts-per-ten-minutes limit.
