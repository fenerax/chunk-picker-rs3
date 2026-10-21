# If the desktop dies

Player 1, your daily ZIPs are in OneDrive under **personal → RS3 Chunk Picker backups**, currently `C:\Users\User\OneDrive - GroupeDesRoches\personal\RS3 Chunk Picker backups`. Choose the newest `rs3-chunk-picker-YYYY-MM-DD.zip` and download it fully. Backups run at **04:00 local time** while you are signed in, catching up after sleep. The picker must be running.

A ZIP contains both maps, progress, rules, notes, imported records and History, plus any feedback. The desktop's labelled previous saves live in `.local/duo/backups`; the ZIP excludes that collection. The helper also restores a labelled full `.json.gz`. Files over 32 MiB exceed the app's upload limit: use the helper for files or **Browse previous saves** for retained snapshots.

## Get running on a new Windows PC

1. Install **Node 24**, **PowerShell 7** and **Tailscale**. Sign into your OneDrive and Tailscale accounts. Recover the private project into `C:\Users\<you>\Projects\chunk-picker-rs3`, including `app`, `scripts`, `resources` and `reference`. No `npm install` is needed. For the same map/data, recover `.local/map-assets` and `.local/game-data` separately. They are outside Git and the ZIP; rebuilding needs extra source files.
2. Open PowerShell in that project. On a fresh checkout, run this, replacing the ZIP path:

   ```powershell
   New-Item -ItemType Directory .local -Force | Out-Null
   pwsh -NoProfile -File scripts/Restore-Picker.ps1 -BackupPath "C:\path\newest.zip" -TargetFolder ".local\duo"
   ./scripts/Start-Picker.ps1 -HostAddress 127.0.0.1
   Start-Process ("http://127.0.0.1:8788/join/" + (Get-Content .local/duo/access-token -Raw).Trim())
   ```

   Check both maps, completions and History. The helper refuses **every existing folder**. If `.local/duo` exists, restore elsewhere and review first. Omitting `-TargetFolder` creates a scratch folder under `.local`. Offline recovery preserves revision and historical Undo; replacing both maps in the app starts a new Undo boundary.
3. Follow [Funnel setup](sharing.md#enable-public-https-with-funnel). Put the new HTTPS origin in `.local/public-origin`; run `./scripts/Stop-Picker.ps1`, then `./scripts/Start-Picker.ps1` without `-HostAddress` to find the new Tailscale IP. Ignore the guide's old IP. Run `tailscale funnel --bg http://127.0.0.1:8789`; repeat the `Start-Process` line above with port **8789**. ZIPs exclude `access-token` and `invites.json`, so **issue new administrator and Player 2 invitations**. Complete directory recovery can preserve their secrets, but URLs need the new host. Test Player 2's link outside your home network.
4. Write the new OneDrive folder into `.local/backup-destination`. After verification, run `./scripts/Register-Backup.ps1` and `./scripts/Register-Watchdog.ps1`. Old tasks do not transfer; these run while signed in. Run `pwsh -File scripts/Backup-Picker.ps1` once and check `.local/backup.log`.

## What the drill proved

**13 October 2026: 1 minute 47 seconds**, including ZIP recovery (**5.25 seconds**) and server startup/checks (**12.87 seconds**), excluding installation, downloads and queueing. Revision **109** and **76 History entries** matched. Player 1: **158 unlocked / 128 challenge checks / 16 personal completions**; Player 2: **114 / 285 / 0**. Historical Undo and a sample labelled restore worked. Scratch data was deleted and the test server stopped. [Step timings and limits](research/restore-drill-2026-10-13.md).

You lose changes **after the last successful backup**, normally up to one day, longer after failures. ZIP recovery also loses old invitations and previous-save choices. Browser preferences need resetting. Keep a private off-machine copy of the stopped `.local/duo`, generated assets and project version for full recovery. Keep `static`, `history` and all `backups` together. OneDrive upload, a replacement PC and external Funnel access were not tested.
