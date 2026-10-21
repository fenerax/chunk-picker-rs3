# Register (or with -Remove, unregister) the per-user daily backup task for Backup-Picker.ps1.
# It runs at 04:00, or as soon as the PC is next on if it was asleep or off then.
param([switch]$Remove, [string]$At = '04:00')
$ErrorActionPreference = 'Stop'
$taskName = 'RS3 Chunk Picker daily backup'
if ($Remove) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Output "Removed '$taskName'." }
    else { Write-Output "'$taskName' is not registered." }
    exit 0
}
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'Backup-Picker.ps1'
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$pwsh`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$daily = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $daily -Settings $settings -Principal $principal -Description 'Saves a full RS3 chunk picker backup to the folder in .local/backup-destination (see scripts/Backup-Picker.ps1).' -Force | Out-Null
Write-Output "Registered '$taskName' daily at $At (catches up after sleep). Remove with ./scripts/Register-Backup.ps1 -Remove"
