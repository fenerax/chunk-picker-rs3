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
on the budgeted filesystem. Pack size is 16 MiB, B2 connections and read
concurrency are one, and GOMAXPROCS is one. The reviewed implementation has two
data packers, two tree packers, one blocked queue item and one uploading pack.
Pack targets may overshoot, so util-linux prlimit enforces a 32 MiB file ceiling.
The disk envelope is six times 32 MiB plus 1 MiB for allocation and directory
overhead: **193 MiB above minFreeBytes**. A larger individual tree fails safely.
Admission checks that filesystem; a 250 ms watcher preserves an additional full
envelope between checks and kills the owned process on lost headroom or failed
space observations. Cancellation waits for process closure before temp cleanup.
Source copies and remote restore points are never deleted by this path.
Install bzip2 and util-linux before installing/running the pinned binary.

Scratch rehearsals and trusted-PC cleanup use the same guard. All commands
disable caching and override TMPDIR, TMP, TEMP and RESTIC_CACHE_DIR with private
paths. PC cleanup reserves 1 GiB plus the pack envelope on the temp filesystem.
Windows uses a sampled per-file/total temp budget and reserve watcher; its byte
ceiling is not kernel-enforced. Linux retains the hard prlimit ceiling.

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

The pending outbox keeps the first incident and newest state per category,
including a recovery after a short outage. It has caps of 96 events and 16 KiB
of encoded pending data; the complete fixed-shape state stays below 32 KiB.
Compaction counts omitted transitions. If the cap requires further eviction,
it protects the oldest unresolved incident and newest state. Delivery includes
the fixed summary `N alerts were dropped`; the counter clears only after a
successful send. Discord messages stay below 1900 characters and retain the
existing four-attempts-per-ten-minutes limit.
