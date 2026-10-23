# Using the private picker

The application uses Node.js 22 or newer and has no runtime package installation. It serves the authored `app/web` interface and local reference data. It never saves to the original author’s Firebase service.

## Start and share

Run `./scripts/Start-Picker.ps1` from the project. It starts a hidden Node process, keeps the durable state at `.local/duo/state.json`, and reports the address without invitation tokens. Open your saved private administrator link. Keep this link and `.local/server-runtime.json` private. Server logs also exclude invitation tokens. Use **Admin → Invite links** to create a separate **Player** invitation labelled `Player 2`, or **View only** for someone watching. Each player chooses her or his map from the Map control; player invitations permit editing both maps, while viewers cannot change the save.

The helper records its child PID and process creation time immediately, with a `starting` state. After ten seconds of slow readiness it prints a managed-starting message; run Start again for status or use Stop. A second Start reuses the owned child, including while it is starting, and does not launch a competitor. `-ReadinessTimeoutSeconds` changes this initial wait.

The Windows helper prefers the desktop’s existing Tailscale IPv4 address. Direct private access requires Tailscale and permission to reach the desktop. Optional public HTTPS through Funnel lets Player 2 use his invitation without Tailscale. [Sharing setup](sharing.md) gives the short admin-console, `RS3_PUBLIC_ORIGIN` and Funnel steps. The picker does not enable Funnel, grant machine access or change network policy. The private master credential is rejected through Funnel, including an existing master cookie; Player 1 can create an administrator invitation for public access.

If the desktop is sleeping or the picker process has stopped, both browsers show connection/save failure. Previously committed progress remains on disk. Run the start helper again when the desktop is available. `./scripts/Stop-Picker.ps1` verifies the recorded PID, process start time and project/store identity, requests authenticated graceful shutdown, and waits for queued saves. New saves are rejected during shutdown. Unfinished connections and the task worker have a ten-second server deadline; accepted saves finish before the store unlocks, with a separate ten-second deadline for transmitting their responses after the save queue drains. Stop waits twenty seconds by default (`-TimeoutSeconds` changes this) and clearly reports any forced stop. An unacknowledged save should be checked after restarting.

**Watchdog.** The existing per-user scheduled task ("RS3 Chunk Picker watchdog") runs `scripts/Watch-Picker.ps1` at logon and every five minutes. Each tick waits for Tailscale to have its `100.x` address, verifies the managed process, and makes an authenticated `/api/health` request. Healthy ticks are quiet. A sleeping task calculator is healthy: checking it does not load its data or wake it.

If a calculation or queued request has gone more than two minutes without progress, or automatic recovery has exhausted its retries, the watchdog first calls `/api/worker-restart` to replace only the affected calculator. The replacement request allows 30 seconds; even if it times out, the watchdog checks health for up to another 30 seconds before fallback. It uses Stop-Picker followed by Start-Picker only if recovery fails. An owned process whose health check fails three times in a row (10 seconds each, 15 seconds apart, so a busy PC is not mistaken for an outage) also uses Stop then Start; a newly starting process gets 5 minutes to bind. While a quick-release candidate builds (its `release-build-active.json` mark names a running build process, under an hour old), a process that fails health but still holds both listeners is left running and the tick logs that instead. If Stop finishes but reports an error, the watchdog still starts the picker once the old process is gone. Stop rechecks ownership and preserves durable saves.

Stop-Picker writes `.local/picker-paused`, so a deliberate stop stays stopped until the next Start-Picker. Restarts and failures go to `.local/watchdog.log`, with invitation and bearer tokens redacted. Registration is a separate operator action through Register-Watchdog; changing these scripts does not register or modify a scheduled task.

**Daily backup.** `./scripts/Backup-Picker.ps1` saves the picker's own full backup (both maps, progress, rules, notes and History; no access token or invitations) zipped as `rs3-chunk-picker-YYYY-MM-DD.zip` in the folder named on the first line of `.local/backup-destination`, keeping the newest 30. `./scripts/Register-Backup.ps1` runs it daily at 04:00 through a per-user scheduled task that catches up after sleep; results go to `.local/backup.log`. Unzip a file and restore the `.json` through **More → Backup & Import**. The zip also holds `…-feedback.json`, a copy of `.local/duo/feedback.json`; to bring feedback back, stop the picker and copy it there as `feedback.json`. After restoring on a new machine, create new invitation links.

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
