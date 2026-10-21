param([Parameter(Mandatory = $true)][string]$FixtureRoot,
    [Parameter(Mandatory = $true)][ValidateSet('slow', 'graceful', 'forced', 'owner', 'degraded')][string]$Mode,
    [Parameter(Mandatory = $true)][int]$Port)
$ErrorActionPreference = 'Stop'
$pickerRuntimePath = Join-Path $FixtureRoot '.local\server-runtime.json'
$pickerShell = (Get-Command powershell.exe).Source
$pickerInitial = $null

function Assert-PickerCondition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-PickerHelper {
    param([string]$Name, [string[]]$Arguments = @(), [bool]$ExpectFailure = $false)
    $pickerCall = [Guid]::NewGuid().ToString('N')
    $pickerOut = Join-Path $FixtureRoot "$pickerCall.stdout"
    $pickerErr = Join-Path $FixtureRoot "$pickerCall.stderr"
    $pickerArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $FixtureRoot "scripts\$Name") + '"')) + $Arguments
    $pickerInvocation = Start-Process -FilePath $pickerShell -ArgumentList $pickerArgs -WindowStyle Hidden -RedirectStandardOutput $pickerOut -RedirectStandardError $pickerErr -PassThru
    $pickerInvocation.Handle | Out-Null
    # Start-Process -Wait waits for descendants too; the managed Node child must
    # remain running after Start exits, so wait only for this helper invocation.
    Assert-PickerCondition ($pickerInvocation.WaitForExit(90000)) 'Helper invocation did not return within 90 seconds.'
    $pickerInvocation.Refresh()
    $pickerText = [string](Get-Content -LiteralPath $pickerOut -Raw) + [string](Get-Content -LiteralPath $pickerErr -Raw)
    Assert-PickerCondition ($pickerText -notmatch '(?i)(?:/|%2f)join(?:/|%2f)[A-Za-z0-9_-]{12,}') 'Helper stdout and stderr must exclude invitation credentials.'
    if ($ExpectFailure) { Assert-PickerCondition ($pickerInvocation.ExitCode -ne 0) "Expected helper rejection: $pickerText" }
    else { Assert-PickerCondition ($pickerInvocation.ExitCode -eq 0) "Helper failed: $pickerText" }
    return $pickerText
}

try {
    $pickerStart = Invoke-PickerHelper 'Start-Picker.ps1' @('-HostAddress', '127.0.0.1', '-Port', [string]$Port, '-ReadinessTimeoutSeconds', $(if ($Mode -eq 'slow') { '1' } else { '5' }))
    $pickerInitial = Get-Content -LiteralPath $pickerRuntimePath -Raw | ConvertFrom-Json
    Assert-PickerCondition ($pickerInitial.pid -gt 0 -and $pickerInitial.processStartedAt) 'The process must be recorded with its creation time.'
    Assert-PickerCondition ([bool](Get-Process -Id $pickerInitial.pid -ErrorAction SilentlyContinue)) 'Recorded child is not running.'
    Assert-PickerCondition ($pickerInitial.projectRoot -eq $FixtureRoot) 'The runtime must record its owning project.'
    if ($Mode -eq 'slow') {
        Assert-PickerCondition ($pickerInitial.state -eq 'starting') 'Slow readiness must retain a starting record.'
        Assert-PickerCondition ($pickerStart -match 'still starting.*recorded') 'Slow readiness must explain that Stop can manage the process.'
        $pickerAgain = Invoke-PickerHelper 'Start-Picker.ps1' @('-HostAddress', '127.0.0.1', '-Port', [string]$Port, '-ReadinessTimeoutSeconds', '1')
        Assert-PickerCondition ($pickerAgain -match 'already starting') 'Second start must refuse a competing child.'
        Assert-PickerCondition (@(Get-Content -LiteralPath (Join-Path $FixtureRoot 'starts.ndjson')).Count -eq 1) 'Second start launched a competitor.'
        Remove-Item -LiteralPath $pickerRuntimePath
        $pickerRecovered = Invoke-PickerHelper 'Start-Picker.ps1' @('-HostAddress', '127.0.0.1', '-Port', [string]$Port)
        Assert-PickerCondition ($pickerRecovered -match 'already owns this store') 'A missing ownership record must be recovered without a competitor.'
        Assert-PickerCondition (@(Get-Content -LiteralPath (Join-Path $FixtureRoot 'starts.ndjson')).Count -eq 1) 'Ownership recovery launched a competitor.'
        [IO.File]::WriteAllText((Join-Path $FixtureRoot 'allow-ready'), 'ready')
    } else {
        # A managed starting result is valid when the full suite briefly starves
        # Node on Windows. Synchronize with authenticated readiness before testing
        # graceful/forced stop, and refresh ownership through the same Start helper.
        $pickerHealthUntil = [DateTime]::UtcNow.AddSeconds(60)
        $pickerManagedId = $pickerInitial.pid
        $pickerFixtureHealth = $null
        do {
            $pickerTokenPath = Join-Path $FixtureRoot '.local\duo\access-token'
            if (Test-Path -LiteralPath $pickerTokenPath) {
                $pickerFixtureToken = (Get-Content -LiteralPath $pickerTokenPath -Raw).Trim()
                try { $pickerFixtureHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Headers @{ Authorization = "Bearer $pickerFixtureToken" } -TimeoutSec 5 }
                catch { $pickerFixtureHealth = $null }
                if ($pickerFixtureHealth.ready -or $pickerFixtureHealth.savesReady) {
                    if ($pickerInitial.state -ne 'running' -or -not $pickerInitial.url) {
                        $pickerStart += Invoke-PickerHelper 'Start-Picker.ps1' @('-HostAddress', '127.0.0.1', '-Port', [string]$Port, '-ReadinessTimeoutSeconds', '1')
                        $pickerInitial = Get-Content -LiteralPath $pickerRuntimePath -Raw | ConvertFrom-Json
                        Assert-PickerCondition ($pickerInitial.pid -eq $pickerManagedId) 'Readiness refresh must keep the same managed process.'
                    }
                    if ($pickerInitial.state -eq 'running' -and $pickerInitial.url) { break }
                }
            }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $pickerHealthUntil)
        Assert-PickerCondition ([bool]($pickerFixtureHealth.ready -or $pickerFixtureHealth.savesReady)) 'The disposable server did not become authenticated-ready within 60 seconds.'
        Assert-PickerCondition ($pickerInitial.state -eq 'running' -and $pickerInitial.url) 'Authenticated readiness must produce a running record and invitation.'
        Assert-PickerCondition (([Uri]$pickerInitial.url).AbsolutePath -eq "/join/$pickerFixtureToken") 'Protected runtime retrieval must retain the administrator invitation.'
        Assert-PickerCondition (@(Get-Content -LiteralPath (Join-Path $FixtureRoot 'starts.ndjson')).Count -eq 1) 'Readiness refresh launched a competitor.'
    }
    if ($Mode -eq 'degraded') {
        Assert-PickerCondition ($pickerStart -match 'Task engine status: restart-required') 'Save-ready degraded health must explain the task engine status.'
    }
    if ($Mode -eq 'owner') {
        foreach ($pickerInvalidTime in @($null, 'invalid-date')) {
            $pickerInvalid = Get-Content -LiteralPath $pickerRuntimePath -Raw | ConvertFrom-Json
            $pickerInvalid.processStartedAt = $pickerInvalidTime
            $pickerInvalid | ConvertTo-Json | Set-Content -LiteralPath $pickerRuntimePath -Encoding UTF8
            $pickerInvalidRefused = Invoke-PickerHelper 'Stop-Picker.ps1' @('-TimeoutSeconds', '1') $true
            Assert-PickerCondition ($pickerInvalidRefused -match 'does not have a valid process creation time') 'Stop must require recorded process creation time.'
            Assert-PickerCondition ([bool](Get-Process -Id $pickerInitial.pid -ErrorAction SilentlyContinue)) 'Stop killed a process without a valid creation-time record.'
            $pickerInitial | ConvertTo-Json | Set-Content -LiteralPath $pickerRuntimePath -Encoding UTF8
        }
        $pickerWrong = Get-Content -LiteralPath $pickerRuntimePath -Raw | ConvertFrom-Json
        $pickerWrong.processStartedAt = ([DateTime]::Parse($pickerWrong.processStartedAt)).AddDays(-1).ToString('o')
        $pickerWrong | ConvertTo-Json | Set-Content -LiteralPath $pickerRuntimePath -Encoding UTF8
        $pickerRefused = Invoke-PickerHelper 'Stop-Picker.ps1' @('-TimeoutSeconds', '1') $true
        Assert-PickerCondition ($pickerRefused -match 'start time no longer belongs') 'Stop must identify ownership/start-time mismatch.'
        Assert-PickerCondition ([bool](Get-Process -Id $pickerInitial.pid -ErrorAction SilentlyContinue)) 'Stop killed a PID with the wrong creation time.'
        Assert-PickerCondition (-not (Test-Path -LiteralPath (Join-Path $FixtureRoot 'shutdown-requested'))) 'Stop contacted a process whose creation time did not match.'
        $pickerInitial | ConvertTo-Json | Set-Content -LiteralPath $pickerRuntimePath -Encoding UTF8
    }
    $pickerStopped = Invoke-PickerHelper 'Stop-Picker.ps1' @('-TimeoutSeconds', $(if ($Mode -eq 'forced') { '5' } else { '12' }))
    Assert-PickerCondition (-not (Get-Process -Id $pickerInitial.pid -ErrorAction SilentlyContinue)) 'Stop left its child running.'
    Assert-PickerCondition (-not (Test-Path -LiteralPath $pickerRuntimePath)) 'Stop left a stale runtime record.'
    Assert-PickerCondition (Test-Path -LiteralPath (Join-Path $FixtureRoot 'shutdown-requested')) 'Stop must request authenticated graceful shutdown.'
    if ($Mode -eq 'forced') {
        Assert-PickerCondition ($pickerStopped -match 'forcing the owned process') 'The bounded fallback must explain its forced stop.'
        Assert-PickerCondition (-not (Test-Path -LiteralPath (Join-Path $FixtureRoot 'save-drained'))) 'The uncooperative fixture unexpectedly drained.'
    } else {
        Assert-PickerCondition (Test-Path -LiteralPath (Join-Path $FixtureRoot 'save-drained')) 'Stop must wait for the fixture save queue to drain.'
        Assert-PickerCondition ($pickerStopped -notmatch 'forcing the owned process') 'A cooperative process was force-killed.'
    }
    foreach ($pickerLogName in @('server.log', 'server-error.log')) {
        $pickerLoggedText = [string](Get-Content -LiteralPath (Join-Path $FixtureRoot ".local\$pickerLogName") -Raw -ErrorAction SilentlyContinue)
        Assert-PickerCondition ($pickerLoggedText -notmatch '(?i)(?:/|%2f)join(?:/|%2f)[A-Za-z0-9_-]{12,}') 'Server logs must exclude invitation credentials.'
    }
    Write-Output "PASS $Mode"
} finally {
    # Only the process launched by this unique fixture may be cleaned up on failure.
    if (-not $pickerInitial -and (Test-Path -LiteralPath $pickerRuntimePath)) {
        $pickerInitial = Get-Content -LiteralPath $pickerRuntimePath -Raw | ConvertFrom-Json
    }
    if ($pickerInitial) {
        $pickerRemaining = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$pickerInitial.pid)" -ErrorAction SilentlyContinue
        if ($pickerRemaining -and $pickerRemaining.CommandLine.Contains((Join-Path $FixtureRoot 'app\server.mjs'))) {
            Stop-Process -Id $pickerRemaining.ProcessId -ErrorAction SilentlyContinue
        }
    }
}
