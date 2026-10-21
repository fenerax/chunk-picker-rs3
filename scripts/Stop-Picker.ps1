param([ValidateRange(1, 300)][int]$TimeoutSeconds = 20)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Picker-Process.ps1')
$pickerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pickerLocal = Join-Path $pickerRoot '.local'
$pickerData = Join-Path $pickerLocal 'duo'
$pickerRuntime = Join-Path $pickerLocal 'server-runtime.json'
# A deliberate stop pauses the watchdog (Watch-Picker.ps1) until the next Start-Picker.ps1.
if (Test-Path -LiteralPath $pickerLocal) { Set-Content -LiteralPath (Join-Path $pickerLocal 'picker-paused') -Value ([DateTime]::Now.ToString('s')) }
if (-not (Test-Path -LiteralPath $pickerRuntime)) { Write-Output 'No managed picker process is recorded.'; exit 0 }
$pickerLock = Enter-PickerHelperLock $pickerLocal
try {
    $pickerRecord = Read-PickerRuntime $pickerRuntime
    if (-not $pickerRecord) { Write-Output 'No managed picker process is recorded.'; exit 0 }
    try {
        if (-not $pickerRecord.processStartedAt) { throw 'Missing creation time.' }
        $pickerRecordedStart = [DateTime]::Parse($pickerRecord.processStartedAt).ToUniversalTime()
    } catch { throw 'The runtime record does not have a valid process creation time. Run Start-Picker.ps1 to refresh its ownership record before stopping.' }
    $pickerProcess = Get-PickerRecordedProcess $pickerRecord
    if ($pickerProcess -and -not (Test-PickerProcessOwnership $pickerProcess $pickerRoot $pickerData $pickerRecord.executable $pickerRecord.processStartedAt)) {
        throw 'The recorded PID or start time no longer belongs to this picker. No process was stopped.'
    }
    if (-not $pickerProcess) {
        Remove-Item -LiteralPath $pickerRuntime
        Write-Output 'Picker is already stopped. Its durable state will load on the next start.'
        exit 0
    }
    $pickerRecord | Add-Member -NotePropertyName state -NotePropertyValue 'stopping' -Force
    Write-PickerRuntime $pickerRuntime $pickerRecord
} finally { $pickerLock.Dispose() }

Write-Output 'Requesting picker shutdown and waiting for queued saves to finish.'
$pickerUntil = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$pickerShutdownAccepted = $false
do {
    $pickerProcess = Get-PickerRecordedProcess $pickerRecord
    if (-not $pickerProcess) { break }
    if (-not (Test-PickerProcessOwnership $pickerProcess $pickerRoot $pickerData $pickerRecord.executable $pickerRecord.processStartedAt)) {
        # An exiting process briefly reports no command line; after an accepted shutdown, recheck before alarming.
        if ($pickerShutdownAccepted) { Start-Sleep -Milliseconds 500; if (-not (Get-PickerRecordedProcess $pickerRecord)) { break } }
        throw 'The recorded PID changed owner while waiting. No process was stopped.'
    }
    if (-not $pickerShutdownAccepted) {
        $pickerToken = Get-PickerAccessToken $pickerData
        if ($pickerToken) {
            try {
                $pickerReply = Invoke-RestMethod -Method Post -Uri "http://$($pickerRecord.hostAddress):$($pickerRecord.port)/api/shutdown" -Headers @{ Authorization = "Bearer $pickerToken" } -ContentType 'application/json' -Body '{}' -TimeoutSec 1
                $pickerShutdownAccepted = $pickerReply.status -eq 'stopping'
            } catch { # A starting process may not have bound its listener yet; retry within the deadline.
            }
        }
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $pickerUntil)

$pickerProcess = Get-PickerRecordedProcess $pickerRecord
if ($pickerProcess) {
    if (-not (Test-PickerProcessOwnership $pickerProcess $pickerRoot $pickerData $pickerRecord.executable $pickerRecord.processStartedAt)) {
        throw 'The recorded PID changed owner at the shutdown deadline. No process was stopped.'
    }
    $pickerKillHandle = Get-Process -Id $pickerProcess.ProcessId -ErrorAction SilentlyContinue
    if ($pickerKillHandle) {
        # Hold the OS handle and recheck creation time so PID reuse between the
        # CIM ownership check and termination cannot select another process.
        $pickerKillHandle.Handle | Out-Null
        if ([Math]::Abs(($pickerKillHandle.StartTime.ToUniversalTime() - $pickerRecordedStart).TotalMilliseconds) -gt 2) {
            throw 'The recorded PID changed owner before forced stop. No process was stopped.'
        }
        Write-Warning "Picker did not finish shutdown within $TimeoutSeconds seconds; forcing the owned process to stop. A save that was not acknowledged may need recovery from its durable state or backups."
        $pickerKillHandle.Kill()
        if (-not $pickerKillHandle.WaitForExit(5000)) { throw 'The picker did not exit after forced stop; ownership record was retained.' }
    }
}
$pickerLock = Enter-PickerHelperLock $pickerLocal
try {
    $pickerCurrent = Read-PickerRuntime $pickerRuntime
    if ($pickerCurrent -and $pickerCurrent.pid -eq $pickerRecord.pid -and $pickerCurrent.processStartedAt -eq $pickerRecord.processStartedAt) {
        Remove-Item -LiteralPath $pickerRuntime
    }
} finally { $pickerLock.Dispose() }
Write-Output 'Picker stopped. Its durable state will load on the next start.'
