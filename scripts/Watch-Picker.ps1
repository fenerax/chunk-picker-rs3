# A cheap health tick never wakes an idle task worker. Deliberate Stop stays paused.
param([string]$HostAddress, [ValidateRange(1024, 65535)][int]$Port = 8788,
    [ValidateRange(1, 120)][int]$WorkerRecoveryTimeoutSeconds = 30,
    [ValidateRange(0, 120)][int]$HealthRetryDelaySeconds = 15)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Picker-Process.ps1')
$watchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$watchLocal = Join-Path $watchRoot '.local'
$watchData = Join-Path $watchLocal 'duo'
$watchLog = Join-Path $watchLocal 'watchdog.log'
$watchToken = $null
function Write-WatchLog([string]$Message) {
    # Helper output and exception text can contain credentials in several forms.
    $safe = $Message -replace '(?i)/join/[^\s"''<>]+', '/join/<token>'
    $safe = $safe -replace '(?i)Bearer\s+[^\s"''<>]+', 'Bearer <token>'
    if ($watchToken) { $safe = $safe.Replace($watchToken, '<token>') }
    $safe = $safe -replace '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])', '<token>'
    New-Item -ItemType Directory -Path $watchLocal -Force | Out-Null
    Add-Content -LiteralPath $watchLog -Value "$([DateTime]::Now.ToString('s')) $safe"
    if ((Get-Item -LiteralPath $watchLog).Length -gt 256KB) { Get-Content -LiteralPath $watchLog -Tail 500 | Set-Content -LiteralPath $watchLog }
}
function Start-WatchedPicker {
    $output = & (Join-Path $PSScriptRoot 'Start-Picker.ps1') -HostAddress $HostAddress -Port $Port 2>&1 | Out-String
    if ($output -notmatch 'Picker already (running|starting)') { Write-WatchLog $output.Trim() }
}
function Restart-WatchedPicker([string]$Reason) {
    # A deliberate stop during the recovery polls must still stay stopped.
    if (Test-Path -LiteralPath (Join-Path $watchLocal 'picker-paused')) { return }
    # Stop rechecks PID/start time and store identity, drains saves, and refuses an alien PID.
    Write-WatchLog "$Reason Restarting the owned picker through Stop then Start."
    try {
        $output = & (Join-Path $PSScriptRoot 'Stop-Picker.ps1') 2>&1 | Out-String
        if ($output.Trim()) { Write-WatchLog $output.Trim() }
    } catch {
        # A stop can finish and still throw (a console error while capturing output
        # once left the picker stopped and paused). Start only when the old process
        # is gone; a refused stop keeps its live process and stays as it is.
        Write-WatchLog "Stop reported: $($_.Exception.Message)"
        if (Get-PickerRecordedProcess (Read-PickerRuntime (Join-Path $watchLocal 'server-runtime.json'))) { return }
    }
    Start-WatchedPicker
}
function Get-WatchedHealth {
    Invoke-RestMethod -Method Get -Uri "$watchBase/api/health" -Headers @{ Authorization = "Bearer $watchToken" } -TimeoutSec 10
}
function Get-WatchedHealthPatiently {
    # This PC also runs builds and tests: one slow answer is not an outage.
    for ($attempt = 1; ; $attempt++) {
        try { return Get-WatchedHealth } catch { if ($attempt -ge 3) { throw } }
        if ($HealthRetryDelaySeconds) { Start-Sleep -Seconds $HealthRetryDelaySeconds }
    }
}
if (Test-Path -LiteralPath (Join-Path $watchLocal 'picker-paused')) { exit 0 }
if ($HostAddress -and $HostAddress -notmatch '^(?:127\.0\.0\.1|100\.\d+\.\d+\.\d+)$') { throw 'Use localhost or this computer''s private Tailscale IPv4 address.' }
if (-not $HostAddress) {
    # The scheduled default still waits for Tailscale rather than binding to localhost.
    $watchTailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $watchTailscale) { $HostAddress = ([string](& $watchTailscale ip -4 2>$null | Select-Object -First 1)).Trim() }
    if ($HostAddress -notmatch '^100\.\d+\.\d+\.\d+$') { Write-WatchLog 'Waiting for Tailscale before checking the picker.'; exit 0 }
}
try {
    $watchRecord = Read-PickerRuntime (Join-Path $watchLocal 'server-runtime.json')
    $watchProcess = Get-PickerRecordedProcess $watchRecord
    if ($watchProcess) {
        if (-not (Test-PickerProcessOwnership $watchProcess $watchRoot $watchData $watchRecord.executable $watchRecord.processStartedAt)) {
            throw 'The recorded PID no longer belongs to this picker. No process was stopped or started.'
        }
        if (-not $watchRecord.processStartedAt) { Start-WatchedPicker; exit 0 }
        if ($watchRecord.state -eq 'stopping') { exit 0 }
        $watchBase = "http://$($watchRecord.hostAddress):$($watchRecord.port)"
        # Preserve the actual managed listener when restarting it.
        $HostAddress = $watchRecord.hostAddress; $Port = [int]$watchRecord.port
        $watchToken = Get-PickerAccessToken $watchData
        if (-not $watchToken) { throw 'No valid picker credential is available for the health check.' }
        $health = $null
        try { $health = Get-WatchedHealthPatiently } catch {
            # Give a newly launched process time to bind, without disguising a dead listener forever.
            if ($watchRecord.state -eq 'starting' -and $watchRecord.startedAt -and
                ([DateTime]::UtcNow - [DateTime]::Parse($watchRecord.startedAt).ToUniversalTime()).TotalSeconds -lt 300) { exit 0 }
            Restart-WatchedPicker 'Picker HTTP health is unavailable.'; exit 0
        }
        if (-not $health.worker.stuck -and -not $health.worker.restartRequired) { exit 0 }
        if (Test-Path -LiteralPath (Join-Path $watchLocal 'picker-paused')) { exit 0 }
        Write-WatchLog 'Task worker needs recovery; requesting worker replacement.'
        $recovered = $false
        try {
            try {
                # Retirement can take longer than a cheap GET. A timeout does not
                # prove replacement failed: the server may still be finishing it.
                Invoke-RestMethod -Method Post -Uri "$watchBase/api/worker-restart" -Headers @{ Authorization = "Bearer $watchToken" } -ContentType 'application/json' -Body '{}' -TimeoutSec 30 | Out-Null
            } catch { Write-WatchLog "Worker replacement request failed: $($_.Exception.Message). Checking health before fallback." }
            if (Test-Path -LiteralPath (Join-Path $watchLocal 'picker-paused')) { exit 0 }
            $until = [DateTime]::UtcNow.AddSeconds($WorkerRecoveryTimeoutSeconds)
            do {
                try {
                    $health = Get-WatchedHealth
                    $recovered = $health.worker -and -not $health.worker.stuck -and -not $health.worker.restartRequired -and
                        -not $health.worker.recovering -and $health.worker.status -in @('ready', 'sleeping')
                } catch { $recovered = $false }
                if ($recovered) { break }
                Start-Sleep -Milliseconds 500
            } while ([DateTime]::UtcNow -lt $until)
        } catch { Write-WatchLog "Worker recovery check failed: $($_.Exception.Message)" }
        if ($recovered) { Write-WatchLog 'Task worker recovered; picker and saves remained running.' }
        else { Restart-WatchedPicker 'Task worker replacement did not recover within the deadline.' }
    } elseif (-not (Test-Path -LiteralPath (Join-Path $watchLocal 'picker-paused'))) { Start-WatchedPicker }
} catch { Write-WatchLog "Watchdog failed: $($_.Exception.Message)" }
