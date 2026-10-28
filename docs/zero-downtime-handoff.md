# Online backup and short-restart handoff

Implementation branch: `job/zero-downtime`. Base:
`3dbb1f73e62b8e8df748116dab43533af3af6629`.

Nothing has been pushed or installed. The production VPS was inspected read-only
for directory ownership and service settings. No production process, service,
timer, Caddy, firewall or store changed. The paused PC picker and private
companion were untouched. No subagents were used.

## Changed behavior and review locations

- `app/storage/snapshot.mjs:13`: shared, nested-safe mutation barrier. Gameplay,
  retention, server transactions and all durable sidecar queues participate.
  `:37`: one bounded capture per writer, pinned file descriptors, post-hold
  copying, complete sibling binding, no locks/hard links, private spool.
- `app/server.mjs:1705`: private master bearer-only snapshot endpoint; public and
  standby/frozen writers refuse. Shutdown-only maintenance flushes beforehand.
- `scripts/linux/online.mjs:9`: root takes over and verifies the service snapshot,
  copies it into private scratch, and cleans completed operation-owned spools.
- `scripts/linux/operator.mjs:87`: stopped-store identity selects whether probes
  are needed. `:130`: online four-probe preparation; `:144`: online recovery
  creation. Default backup never stops the writer; `backup --stopped` remains.
  The activation breadcrumb, binding/pointer CAS, reverse probes and latest-save
  rollback remain strict. An exited candidate aborts readiness before automatic
  restarts spend the rollback start budget. Three starts / 300 seconds remains.
- `app/startup.mjs:54`: script-free, self-refreshing warm-up HTML for navigation.
  `app/web/live-swap-client.mjs:337`: bounded GET retries only for the picker's
  own restart 503s (`PICKER_WARMING`, `PICKER_UPDATING`). Busy 503s, refusals and
  lost bodies stay single-dispatch (review change; Caddy covers refused dials).
  The existing command outbox and SSE reconnect remain the save protections.
- `scripts/release/vps/release.mjs:11`, `bundle.mjs:46`: prepare, upload, verify,
  rebase and review; activation requires explicit `--go-live`. A receipt pins the
  candidate and expected previous pointer. No PC store is transported.
- `scripts/release/pc/Quick-Release.ps1:65`: an existing pause refuses PC go-live
  before loading the candidate or stopping anything.
- `scripts/linux/rehearse.mjs:19`: disposable copied-store rehearsal with exactly
  one scratch writer and real decoder probes; no systemctl. It cleans scratch.
- `docs/linux-operator.md:268`: operating rules, bootstrap limit and release usage.
  New tests are classified as quick in `scripts/test-selection.mjs`.

## Measurements and checks

The local end-to-end rehearsal used **open-starter plus 70 MiB of synthetic
ballast**, ports 8956/8957, one writer at a time, with real snapshot, recovery
verification, four compatibility probes and a same-release activation:

| Measurement | Observed |
| --- | ---: |
| Longest write hold across backup/deploy captures | 125.83 ms |
| Online backup total, writer serving throughout | 6.89 s |
| Writer down, stop through candidate ready | 4.85 s |

These are Windows synthetic-fixture measurements. They do not establish the
private game's Linux startup time, a version transition, systemd or Caddy retry
behavior. Scratch was removed and all rehearsal listeners were closed.
The private staging snapshot was **not** replayed: its required data/rules-text
pack versions are missing from the approved read-only pack cache. No packs were
copied and no old PC release was started.

The final focused run passed **81/81 tests**, including the additional
exited-candidate budget check, snapshot concurrency and fifteen-second read
recovery. Existing tests cover lost command
acknowledgements, exact request-ID replay, 503 Retry-After and SSE reconnection.
New tests cover concurrent real writes plus sidecars, nested maintenance,
budget/ID failures, public refusal, warm-up HTML, reads, deployment decisions,
recovery/status contracts, transport staging and executed PowerShell pause guard.

`npm run test:quick` was run with concurrency 1 (284 files planned). It was stopped
after approximately five minutes to respect the everyday-PC budget; no failure
had been reported before stopping. **This is not a complete quick-suite pass.**
CI must complete quick/full, Linux and Windows operator/release rehearsals,
private companion quick/full behavior, coverage and secret scanning. No full
suite or browser session was run locally. No screenshot was needed to verify
the warm-up HTTP response; its content/CSP/refresh are covered directly.

Caddy 2.11.7 validated the actual host-specific proposed kit file. It emitted only
the existing redundant X-Forwarded-For advisory. The kit file is outside this
repository; `docs/linux-Caddyfile.example` is its generic reviewed copy.

## Exact Caddy addition

Inside the existing `reverse_proxy 127.0.0.1:8789` block:

```diff
 reverse_proxy 127.0.0.1:8789 {
+    # Hold connection failures across a short writer restart. Only reads may
+    # retry after an upstream exchange; commands use durable app receipts.
+    lb_try_duration 30s
+    lb_try_interval 250ms
+    lb_retry_match {
+        method GET HEAD
+    }
```

SSE flush/indefinite streams, host/header policy, access-log filtering and
credential-path log suppression are unchanged. A real upstream 503 is handled
by the app/page/client, not replayed by Caddy. POST retries after ambiguous
transport loss belong to the durable command protocol.

## Commands for the reviewing installer

All following commands are **future actions for Claude after review and the
owner's approval**. Replace `<release>`, local build/output paths and the verified
recovery directory. Preserve the existing Node path and exact host-specific
Caddyfile. Do not run a second heavy private workload on the serving VPS without
verified memory headroom; a disposable staging VPS clone is the preferred full
systemd rehearsal environment.

First, prepare and stage the already-built PC release from the reviewed core:

```powershell
node scripts/release/vps/release.mjs prepare --repo <core-repo> --release-dir <project>/.local/releases/<release> --out <new-private-bundle>
node scripts/release/vps/release.mjs stage --out <private-bundle> --host <staging-ssh-alias> --upload /var/tmp/picker-upload-<release> --target /opt/chunk-picker/releases/<release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

On staging, exercise the copied-store helper before any activation. It never
controls the installed service or opens its real store for writes:

```sh
sudo /opt/node/bin/node /opt/chunk-picker/releases/<release>/core/scripts/linux/rehearse.mjs --pointer /opt/chunk-picker/releases/<release>/pointer.json --source /var/backups/chunk-picker/<verified-recovery>/store --scratch /var/tmp/picker-rehearsal-<release> --port 8956
```

For the following full service rehearsal, use the **disposable staging VPS**,
which owns its own `chunk-picker.service`, paths and store. The operator kit has
a fixed service name; an alternate config alone does not isolate it from a
production service on the same machine. Run the same install sequence below on
staging first. Verify the unchanged/changed store decisions, a failed candidate,
latest-save rollback, public refusal, private readiness, spool ownership/full-disk
failure, off-host backup pull, SSE and plugin. Space repeated starts by five
minutes; never reset StartLimit to force rehearsal starts.

After staging passes, stage the same built release to the production alias:

```powershell
node scripts/release/vps/release.mjs stage --out <private-bundle> --host <production-ssh-alias> --upload /var/tmp/picker-upload-<release> --target /opt/chunk-picker/releases/<release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

On the target machine, review the receipt and ensure no transaction is pending.
The commands below stop timers only; an in-flight oneshot must finish normally.
Do not kill an operator or remove its evidence. Keep old tools for rollback.

```sh
set -eu
rel='<release>'
sudo systemctl stop chunk-picker-health.timer chunk-picker-backup.timer
for unit in chunk-picker-health.service chunk-picker-backup.service; do
  if sudo systemctl is-active --quiet "$unit"; then
    echo 'Operator still running; wait for its normal completion and review evidence.' >&2
    exit 1
  fi
done
for evidence in operation.lock maintenance.json activation.json start-permit.json; do
  sudo test ! -e "/var/lib/chunk-picker/control/$evidence"
done
sudo test ! -e /opt/chunk-picker/tools-zero-downtime
# The service runs as chunk-picker and must read its tools; staging already
# locked the release tree to root:chunk-picker 0750/0640, so cp -a keeps that.
sudo install -d -o root -g chunk-picker -m 0750 /opt/chunk-picker/tools-zero-downtime
sudo cp -a "/opt/chunk-picker/releases/$rel/core/." /opt/chunk-picker/tools-zero-downtime/
sudo test ! -e /opt/chunk-picker/tools-before-zero-downtime
sudo mv /opt/chunk-picker/tools /opt/chunk-picker/tools-before-zero-downtime
sudo mv /opt/chunk-picker/tools-zero-downtime /opt/chunk-picker/tools
sudo install -d -o chunk-picker -g chunk-picker -m 0700 /var/lib/chunk-picker/data/game.snapshots
sed 's|/usr/bin/node|/opt/node/bin/node|g' /opt/chunk-picker/tools/scripts/linux/systemd/chunk-picker-backup.service | sudo tee /etc/systemd/system/chunk-picker-backup.service >/dev/null
sudo systemd-analyze verify /etc/systemd/system/chunk-picker.service /etc/systemd/system/chunk-picker-backup.service /etc/systemd/system/chunk-picker-backup.timer /etc/systemd/system/chunk-picker-health.service /etc/systemd/system/chunk-picker-health.timer
sudo systemctl daemon-reload
# Upload only the reviewed proposed host-specific Caddyfile to this path first.
# A copy from Windows may carry CRLF line endings; strip them before installing.
sudo sh -c "tr -d '\r' < /var/tmp/Caddyfile.zero-downtime > /var/tmp/Caddyfile.zero-downtime.lf"
sudo -u caddy caddy validate --config /var/tmp/Caddyfile.zero-downtime.lf --adapter caddyfile
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-zero-downtime
sudo install -o root -g root -m 0644 /var/tmp/Caddyfile.zero-downtime.lf /etc/caddy/Caddyfile
sudo systemctl reload caddy
# Explicit one-time bootstrap: the old running release has no snapshot endpoint.
sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /opt/chunk-picker/tools/scripts/linux/operator.mjs deploy "/opt/chunk-picker/releases/$rel/pointer.json" "/var/tmp/picker-upload-$rel/verified.json" --stopped
sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /opt/chunk-picker/tools/scripts/linux/operator.mjs backup
sudo env RS3_OPERATOR_CONFIG=/etc/chunk-picker/operator.json /opt/node/bin/node /opt/chunk-picker/tools/scripts/linux/operator.mjs health
# Verify the new recovery manifest/export/status and the existing off-host pull,
# browser save recovery, SSE, plugin and private/public permissions before this:
sudo systemctl start chunk-picker-health.timer chunk-picker-backup.timer
```

The first bootstrap still incurs the stopped compatibility window. Caddy's
30-second retry window cannot hide that entire first installation or a later
changed-store fallback. Announce that one reviewed bootstrap window. Subsequent
normal activations use the online preparation path:

```powershell
node scripts/release/vps/release.mjs activate --go-live --host <production-ssh-alias> --upload /var/tmp/picker-upload-<next-release> --target /opt/chunk-picker/releases/<next-release> --operator-config /etc/chunk-picker/operator.json --tools-root /opt/chunk-picker/tools --node /opt/node/bin/node
```

The Lua plugin was inspected read-only. `plugins/chunk-picker/net.lua:263`
handles non-401 failures, including 503 and connection refusal, with 2/4/8-second
backoff capped at 300 seconds. Task-list reads have a separate retry clock. The
plugin was not changed.

## Proposed private records

Changelog title: **Backups stay online; smoother updates**

- Daily backups keep the picker available.
- Updates check the copied save before a short restart when the save stays unchanged.
- Open pages reconnect and pending saves keep their original confirmation IDs.
- Built releases can be staged and verified for the VPS before approval.

Roadmap: Rehearse and install online recovery plus verified VPS releases; retain
the conservative changed-save rollback path.

## Risks and remaining acceptance

The live private game's timing and Linux descriptor/ownership/systemd/Caddy
behavior still need staging evidence. Late writes or shutdown changes select the
full stopped probes, deliberately. The 1-second capture deadline is cooperative
between filesystem calls, not a hard kernel-I/O deadline. Windows retains the write barrier through copy and descriptor close, avoiding
pinned-file rename failures. The measured Windows hold includes that copy; Linux
releases immediately after pinning.
An interrupted snapshot/upload retains private evidence and needs reconciliation;
there is no automatic stale-lock/spool/failed-release cleanup. The Caddy proposal
was syntax-validated, not exercised against a real restart locally. The quick
suite is incomplete within the PC budget, and all heavier CI/private/release
gates remain pending. Nothing here authorizes activation of the paused PC copy.


The installed worktree hook could not scan and blocked commit with
`Git operation refused (cat-file)`. Its worktree-only `core.hooksPath` was unset
as authorized. The explicit pre-merge privacy/identity/path gate must still run
against the pinned base; its final result is recorded in the implementation reply.


The explicit gate was run against the pinned base and returned
`tree-scan-failed`. Diagnosis: the unchanged canonical policy selects 150,542,189
bytes of eligible blobs, but its single Git cat-file call permits only 75,497,472
output bytes. This is a scanner transport-limit failure, not privacy clearance.
The scanner, corpus, policy and base were not changed. The owning tooling must
be repaired and the exact committed candidate rechecked before merge. Commit
author and committer were verified as the required noreply identity.
