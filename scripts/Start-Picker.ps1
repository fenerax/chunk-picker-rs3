param([string]$HostAddress, [int]$Port = 8788, [string]$ImportPath,
    [ValidateRange(1, 300)][int]$ReadinessTimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Picker-Process.ps1')
$pickerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pickerLocal = Join-Path $pickerRoot '.local'
$pickerData = Join-Path $pickerLocal 'duo'
$pickerRuntime = Join-Path $pickerLocal 'server-runtime.json'
$pickerNode = (Get-Command node -ErrorAction Stop).Source
Remove-Item -LiteralPath (Join-Path $pickerLocal 'picker-paused') -ErrorAction SilentlyContinue
# Optional saved public origin (Funnel sharing) so every restart keeps it; the environment wins.
$pickerOriginFile = Join-Path $pickerLocal 'public-origin'
if (-not $env:RS3_PUBLIC_ORIGIN -and (Test-Path -LiteralPath $pickerOriginFile)) { $env:RS3_PUBLIC_ORIGIN = (Get-Content -LiteralPath $pickerOriginFile -TotalCount 1).Trim() }
# Funnel can only proxy to loopback, so public sharing also listens on 127.0.0.1 at the next port.
if ($env:RS3_PUBLIC_ORIGIN -and -not $env:RS3_LOOPBACK_PORT) { $env:RS3_LOOPBACK_PORT = [string]($Port + 1) }
if (-not $HostAddress) {
    $pickerTailscale = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $pickerTailscale) {
        $pickerIpLines = & $pickerTailscale ip -4 2>$null
        $pickerTailscaleExit = $LASTEXITCODE
        $pickerIp = ([string]($pickerIpLines | Select-Object -First 1)).Trim()
        if ($pickerTailscaleExit -eq 0 -and $pickerIp -match '^100\.\d+\.\d+\.\d+$') { $HostAddress = $pickerIp }
    }
    if (-not $HostAddress) { $HostAddress = '127.0.0.1' }
}
if ($HostAddress -notmatch '^(?:127\.0\.0\.1|100\.\d+\.\d+\.\d+)$') { throw 'Use localhost or this computer''s private Tailscale IPv4 address.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Choose a port from 1024 through 65535.' }
New-Item -ItemType Directory -Path $pickerLocal -Force | Out-Null
$pickerLock = Enter-PickerHelperLock $pickerLocal
try {
    $pickerPrevious = Read-PickerRuntime $pickerRuntime
    $pickerRunning = Get-PickerRecordedProcess $pickerPrevious
    if (Test-PickerProcessOwnership $pickerRunning $pickerRoot $pickerData $pickerNode $pickerPrevious.processStartedAt) {
        # Upgrade a legacy helper record only after matching the owned command.
        if (-not $pickerPrevious.processStartedAt) {
            $pickerPrevious | Add-Member -NotePropertyName processStartedAt -NotePropertyValue ([DateTime]$pickerRunning.CreationDate).ToUniversalTime().ToString('o') -Force
            $pickerPrevious | Add-Member -NotePropertyName executable -NotePropertyValue $pickerNode -Force
            Write-PickerRuntime $pickerRuntime $pickerPrevious
        }
        $pickerEngineMessage = ''
        if ($pickerPrevious.state -ne 'stopping') {
            $pickerExistingToken = Get-PickerAccessToken $pickerData
            if ($pickerExistingToken) {
                $pickerExistingHealth = $null
                try { $pickerExistingHealth = Invoke-RestMethod -Uri "http://$($pickerPrevious.hostAddress):$($pickerPrevious.port)/api/health" -Headers @{ Authorization = "Bearer $pickerExistingToken" } -TimeoutSec 1 }
                catch { # The owned server is still starting.
                }
                if ($pickerExistingHealth.ready -or $pickerExistingHealth.savesReady) {
                    $pickerPrevious | Add-Member -NotePropertyName state -NotePropertyValue 'running' -Force
                    $pickerPrevious | Add-Member -NotePropertyName url -NotePropertyValue "http://$($pickerPrevious.hostAddress):$($pickerPrevious.port)/join/$pickerExistingToken" -Force
                    Write-PickerRuntime $pickerRuntime $pickerPrevious
                    if (-not $pickerExistingHealth.ready) { $pickerEngineMessage = " Task engine status: $($pickerExistingHealth.status)." }
                }
            }
        }
        $pickerMessage = if ($pickerPrevious.url) { "Address: http://$($pickerPrevious.hostAddress):$($pickerPrevious.port). Use your saved private administrator link." } else { 'Inspect .local/server.log for startup status.' }
        $pickerState = if ($pickerPrevious.state) { $pickerPrevious.state } else { 'running' }
        Write-Output "Picker already $pickerState (PID $($pickerPrevious.pid)).$pickerEngineMessage $pickerMessage"
        exit 0
    }
    # Recover management when a helper was interrupted between launch and recording.
    # Refuse a competitor even if the runtime record was removed by hand.
    $pickerOwnedServer = (Join-Path $pickerRoot 'app\server.mjs').Replace('\', '\\').Replace("'", "\'")
    $pickerCandidates = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' AND CommandLine LIKE '%$pickerOwnedServer%'" | Where-Object {
        Test-PickerProcessOwnership $_ $pickerRoot $pickerData $pickerNode
    })
    if ($pickerCandidates.Count -gt 0) {
        if ($pickerCandidates.Count -gt 1) { throw 'Multiple picker processes already use this store. Inspect them before starting another.' }
        $pickerExisting = $pickerCandidates[0]
        if ($pickerExisting.CommandLine -match '(?i)(?:^|\s)--host\s+"?(127\.0\.0\.1|100\.\d+\.\d+\.\d+)"?(?:\s|$)') { $HostAddress = $Matches[1] }
        if ($pickerExisting.CommandLine -match '(?i)(?:^|\s)--port\s+"?(\d+)"?(?:\s|$)') { $Port = [int]$Matches[1] }
        Write-PickerRuntime $pickerRuntime @{ pid = $pickerExisting.ProcessId; processStartedAt = ([DateTime]$pickerExisting.CreationDate).ToUniversalTime().ToString('o');
            state = 'starting'; hostAddress = $HostAddress; port = $Port; projectRoot = $pickerRoot; dataDir = $pickerData; executable = $pickerNode }
        Write-Output "A picker already owns this store (PID $($pickerExisting.ProcessId)); recorded it for Stop. Inspect .local/server.log for startup status. No second server was started."
        exit 0
    }
    # One major collection after all calculators retire returns unreachable
    # shared buffers and heap pages; no GC runs on a gameplay request.
    $pickerArguments = @('--expose-gc', ('"' + (Join-Path $pickerRoot 'app\server.mjs') + '"'), '--host', $HostAddress, '--port', [string]$Port, '--data-dir', ('"' + $pickerData + '"'))
    if ($ImportPath) { $pickerArguments += @('--import', ('"' + [IO.Path]::GetFullPath($ImportPath) + '"')) }
    $pickerLog = Join-Path $pickerLocal 'server.log'
    $pickerErrorLog = Join-Path $pickerLocal 'server-error.log'
    $pickerProcess = Start-Process -FilePath $pickerNode -ArgumentList $pickerArguments -WorkingDirectory $pickerRoot -WindowStyle Hidden -RedirectStandardOutput $pickerLog -RedirectStandardError $pickerErrorLog -PassThru
    $pickerRecord = @{ pid = $pickerProcess.Id; processStartedAt = $pickerProcess.StartTime.ToUniversalTime().ToString('o'); state = 'starting';
        hostAddress = $HostAddress; port = $Port; startedAt = [DateTime]::UtcNow.ToString('o'); projectRoot = $pickerRoot; dataDir = $pickerData; executable = $pickerNode }
    try { Write-PickerRuntime $pickerRuntime $pickerRecord }
    catch {
        # A process that could not be recorded must not be left unmanaged.
        $pickerProcess.Refresh()
        if (-not $pickerProcess.HasExited) { $pickerProcess.Kill(); $pickerProcess.WaitForExit(5000) | Out-Null }
        throw
    }
} finally { $pickerLock.Dispose() }

$pickerUntil = [DateTime]::UtcNow.AddSeconds($ReadinessTimeoutSeconds)
do {
    $pickerProcess.Refresh()
    if ($pickerProcess.HasExited) { throw "The recorded picker exited during startup. Inspect .local/server-error.log (PID $($pickerRecord.pid))." }
    $pickerToken = Get-PickerAccessToken $pickerData
    if ($pickerToken) {
        $pickerHealth = $null
        try {
            $pickerHealth = Invoke-RestMethod -Uri "http://${HostAddress}:$Port/api/health" -Headers @{ Authorization = "Bearer $pickerToken" } -TimeoutSec 1
        } catch { # Readiness can take longer than one request timeout.
        }
        if ($pickerHealth.ready -or $pickerHealth.savesReady) {
            $pickerUrl = "http://${HostAddress}:$Port/join/$pickerToken"
            $pickerMayAnnounceReady = $false
            $pickerLock = Enter-PickerHelperLock $pickerLocal
            try {
                $pickerCurrent = Read-PickerRuntime $pickerRuntime
                if ($pickerCurrent.pid -eq $pickerRecord.pid -and $pickerCurrent.processStartedAt -eq $pickerRecord.processStartedAt -and $pickerCurrent.state -ne 'stopping') {
                    $pickerRecord.state = 'running'; $pickerRecord.url = $pickerUrl
                    Write-PickerRuntime $pickerRuntime $pickerRecord
                    $pickerMayAnnounceReady = $true
                }
            } finally { $pickerLock.Dispose() }
            if (-not $pickerMayAnnounceReady) { Write-Output 'Picker shutdown already started. No second server was started.'; exit 0 }
            $pickerEngineMessage = if ($pickerHealth.ready) { '' } else { " Task engine status: $($pickerHealth.status)." }
            Write-Output "Private picker running.$pickerEngineMessage Address: http://${HostAddress}:$Port. Use your saved private administrator link."
            exit 0
        }
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $pickerUntil)
Write-Output "Picker is still starting (PID $($pickerRecord.pid)); its starting state is recorded and Stop-Picker.ps1 can stop it. Inspect .local/server.log and .local/server-error.log. Run Start-Picker.ps1 again for its status; it will not start a competitor."
