# Desktop restore drill — 13 October 2026

Completed on `codex/restore`, based on application commit `340a137`, with
Node **24.20.0** and Chrome **154.0.8037.98**. The live picker on port 8788,
existing backups and scheduled tasks were read-only throughout. No app UI,
server, storage, engine, worker or application-data files changed.

## Backup found and checked

The configured destination is
`C:\Users\User\OneDrive - GroupeDesRoches\personal\RS3 Chunk Picker backups`.
`scripts/Backup-Picker.ps1`, `.local/backup-destination`, `.local/backup.log`,
`.local/backup-status.json` and the scheduled-task definition agree. The task
runs at 04:00 local time while the user is signed in and catches up after sleep;
it requires a running picker. The log's first failed attempt on October 8 was
followed by a successful retry. All six daily ZIPs from October 8–13 are present,
totalling **26,322,753 bytes** (25.1 MiB).

Newest: `rs3-chunk-picker-2026-10-13.zip`, **4,643,680 bytes** (4.4 MiB),
success recorded at **04:00 local / 07:00 UTC**, revision **109**. Its single
gameplay JSON is **38,146,462 bytes** (36.4 MiB). No feedback file existed in the
live save, so none was expected in this ZIP. Synthetic fixtures separately
verified feedback recovery.

## Verified recovery

The helper restored directly from the OneDrive ZIP into a new worktree-local
folder. OneDrive marks this regular file as a reparse point; the reader accepts
cloud-managed inputs while refusing actual symbolic-link/junction redirects.
Target and temporary-cleanup paths refuse redirected ancestors.

A separate copy of the complete live data directory excluded the lock, recovery
marker, master credential, invitations and temporary files. Its offline export
at revision 109 matched the restored portable state in full, including History
and fields hydrated from the live `static/` sidecars. The source live revision
was also 109, so no historical fallback was needed. The restored picker started
on **127.0.0.1:9111** and reported both `ready` and `savesReady`.

| Player | Unlocked | Challenge checks | Personal completions |
| --- | ---: | ---: | ---: |
| Player 1 | 158 | 128 | 16 |
| Player 2 | 114 | 285 | 0 |

The helper's `completed` output counts the saved personal `completedTasks`
entries. Challenge checks are separate `taskStatus.challengeCompleted` flags;
the full-state comparison and the app's replacement preview confirmed these
too. All **76 saved History entries** survived. The imported revision-109 change
was successfully undone through the revision-checked command endpoint.

No labelled backup existed in the live store. On the disposable server, the
ordinary **Go members** command created **Before going members** at scratch
revision 111. Undo reversed the members start. That pinned JSON.GZ also reopened
through the offline helper. In the browser, **Backup & Import → Browse previous
saves → Preview selected snapshot → Apply reviewed replacement** restored it.
Both maps, rules and saved gameplay matched its pre-transition state, excluding
the expected new revision, History boundary, provenance and progress observation.

## Timings

Both attempted runs used `.local/with-heavy.ps1`. The first restored and started
successfully, then stopped at the oversized JSON upload. Its server and scratch
data were cleaned up before the complete run. All screenshots came from one
browser/server session in the complete run.

| Complete-run step | Seconds |
| --- | ---: |
| Find/check newest ZIP and checksums | 0.08 |
| Restore ZIP offline | 5.25 |
| Copy live save and compare at backup revision | 6.94 |
| Start server, health and counts | 12.87 |
| History, imported Undo, upload-limit check and retained restore | 30.01 |
| Create/Undo labelled backup and restore it offline | 16.69 |
| Open recovered picker and History in Chrome | 3.76 |
| Restore labelled backup through the app, capture both sizes | 31.13 |
| Stop browser/server and delete scratch data | 0.24 |
| Verify source ZIPs and live save unchanged | 0.07 |
| **Total** | **107.04** |

These are local recovery times, excluding installation, cloud downloading,
fixture tests and the shared-lock queue. Prediction prewarming was disabled for
the drill; this is not a production performance benchmark. The server used the
desktop's existing `.local/game-data` and `.local/map-assets` read-only via the
shared wrapper's environment. Replacement-PC operation without those assets
was not established.

## Limits and concerns

- The expanded full backup exceeds both the frontend's **32 MiB file limit**
  (`screen-dialogs.mjs`, `readJSON`) and the server's **32 MiB request limit**
  (`server.mjs`, `MAX_BODY`). A real preview upload returned **HTTP 413**.
  The new offline helper handles this file; retained snapshot IDs work in the
  app without uploading the large document. The shared UI/server limits were
  deliberately left for a separate change.
- Daily ZIPs contain portable gameplay/History, not the retained previous-save
  collection, invitations, master credential, project source, generated geometry
  or map assets. Preserve these separately and privately for full machine
  recovery. The portable state itself needs no missing `static/` or `history/`
  sidecars: the complete comparison proved they were hydrated into the export.
- OneDrive upload completion, a new machine, Tailscale/Funnel internet reachability
  and preserved-authentication recovery were not tested. The local ZIPs were
  fresh and their sizes were reasonable. Failed runs can extend the usual
  one-day loss window; the backup script does not retry a failed run itself.
- Existing-folder replacement is deliberately unsupported. The helper has no
  `-ReplaceLive` switch and refuses every existing target. It never stops a
  picker or changes scheduled tasks.

## Checks and retained evidence

**8/8** synthetic fixture tests passed, with no skips. They cover JSON/gzip
(including uppercase extension), exact portable roundtrips, History and Undo,
feedback rollback, default fresh destinations, existing-folder protection,
junction refusal, ZIP traversal/duplicates/credentials/size rejection and error
redaction. **859/859** quick-suite tests passed. Full-suite count: **not run**;
only scripts, fixtures, test classification and documentation changed. The new
integration fixture is explicitly classified as full-only for later merged runs.

Screenshots were visually inspected at 1440×900 and 390×844. The phone had no
horizontal overflow. The scratch server's missing-backup notice is expected:
the real desktop's backup configuration was not copied or changed.

Ignored local evidence:

- `.local/restore-drill-report.json`: complete counts, timings and checks.
- `.local/restore-drill-first-report.json`: initial attempted-run record.
- `.local/screens/restore-desktop-1440-history.png`.
- `.local/screens/restore-desktop-1440-labelled-preview.png`.
- `.local/screens/restore-phone-390.png`.

All owned servers and Chrome processes stopped, port 9111 had no listener, and
all restored/comparison saves and browser profiles were removed. The six source
ZIPs and the live `state.json` remained byte-for-byte unchanged. No credential or
invitation token was printed or retained in the report/screenshots.
