# Register (or with -Remove, unregister) the per-user scheduled task that runs Watch-Picker.ps1
# at logon and every five minutes. It runs only while this user is signed in and needs no password.
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'RS3 Chunk Picker watchdog'
if ($Remove) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Output "Removed '$taskName'." }
    else { Write-Output "'$taskName' is not registered." }
    exit 0
}
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$script = Join-Path $PSScriptRoot 'Watch-Picker.ps1'
# conhost --headless keeps the five-minute tick from flashing a console window.
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless `"$pwsh`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory (Split-Path $PSScriptRoot)
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$atLogon.Delay = 'PT1M'
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $atLogon, $every -Settings $settings -Principal $principal -Description 'Restarts the RS3 chunk picker after a crash or reboot (see scripts/Watch-Picker.ps1).' -Force | Out-Null
Write-Output "Registered '$taskName': at logon and every 5 minutes. Remove with ./scripts/Register-Watchdog.ps1 -Remove"
