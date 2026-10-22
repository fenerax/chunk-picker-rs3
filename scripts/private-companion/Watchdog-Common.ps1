# Private health tick. Dot-sourcing has no effects.
Set-StrictMode -Version Latest

function Write-CoreWatchLog($Context, [string]$Message) {
    # Callers use fixed messages only, never helper output or exception text.
    $path = Join-Path $Context.localDir 'watchdog.log'
    if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 256KB) {
        $tail = @(Get-Content -LiteralPath $path -Tail 500)
        [IO.File]::WriteAllLines($path, $tail, [Text.UTF8Encoding]::new($false))
    }
    Add-Content -LiteralPath $path -Value "$([DateTime]::Now.ToString('s')) $Message"
}

function Test-CoreWatchPaused($Context) { return Test-Path -LiteralPath (Join-Path $Context.localDir 'picker-paused') }

function Assert-CoreWatchUnoccupied($Context) {
    foreach ($port in @($Context.config.port, $Context.config.loopbackPort) | Where-Object { $null -ne $_ }) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count) { throw 'An unowned listener prevents startup.' }
    }
    Move-CoreWatchRestartLock $Context
    Assert-OperatorStoreReleased $Context
}

function Move-CoreWatchRestartLock($Context) {
    # A storage lock written before the last boot belongs to a server that the
    # restart ended. Only that exact, local, fully recorded case moves aside to
    # a review copy; anything else stays for Assert-OperatorStoreReleased to refuse.
    $dataDir = $Context.config.dataDir
    $lock = Join-Path $dataDir 'store.lock'
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf) -or (Test-Path -LiteralPath "$lock.recovery")) { return }
    $pattern = '(?i)(?:^|\s)--data-dir\s+"?' + [regex]::Escape($dataDir) + '"?(?:\s|$)'
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $pattern }).Count) { return }
    $text = [IO.File]::ReadAllText($lock)
    try {
        $owner = $text | ConvertFrom-Json
        foreach ($name in 'pid', 'host', 'startVerified', 'startedAt', 'createdAt') { if (-not $owner.PSObject.Properties[$name]) { return } }
        if (-not ($owner.pid -is [int] -or $owner.pid -is [long]) -or $owner.pid -lt 1 -or $owner.startVerified -isnot [bool] -or -not $owner.startVerified) { return }
        if ($owner.host -isnot [string] -or $owner.host -ine [Net.Dns]::GetHostName()) { return }
        if (-not (Test-OperatorBeforeBoot $owner.startedAt) -or -not (Test-OperatorBeforeBoot $owner.createdAt)) { return }
    } catch { return }
    $review = Join-Path $dataDir ('store.lock.restart-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
    [IO.File]::Move($lock, $review)
    if ([IO.File]::ReadAllText($review) -cne $text) { [IO.File]::Move($review, $lock); throw 'Storage lock changed while it moved.' }
    Write-CoreWatchLog $Context 'Moved a storage lock left from before the last restart to a review copy.'
}

function Assert-CoreWatchOwnership($Context, $Record) {
    $current = Read-OperatorJson $Context.runtimeFile
    if ($current.state -notin @('running', 'starting') -or $current.pid -ne $Record.pid -or $current.processStartedAt -cne $Record.processStartedAt -or $current.configHash -cne $Record.configHash) { throw 'Runtime changed or is stopping.' }
    $null = Get-OperatorOwnedProcess $Context $current
    $listeners = @(@{ address = $Context.config.host; port = $Context.config.port })
    if ($null -ne $Context.config.loopbackPort) { $listeners += @{ address = '127.0.0.1'; port = $Context.config.loopbackPort } }
    foreach ($listener in $listeners) {
        $sockets = @(Get-NetTCPConnection -State Listen -LocalPort $listener.port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq $listener.address })
        if (@($sockets | Where-Object { $_.OwningProcess -ne $Record.pid }).Count) { throw 'Configured listener is foreign.' }
    }
}

function Invoke-CoreWatchHelper($Context, [string]$Operation, [string]$Config, [string]$ConfigSha256,
    [ValidateRange(1,300)][int]$TimeoutSeconds = 120) {
    Assert-OperatorPin ([pscustomobject]@{ path = $Config; sha256 = $ConfigSha256 })
    if ($Operation -eq 'Start' -and (Test-CoreWatchPaused $Context)) { return }
    $shell = (Get-Process -Id $PID).Path
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot "$Operation-Core.ps1") + '" -Config "' + $Config + '" -PreservePause'
    Invoke-OperatorForeground -Executable $shell -Arguments $arguments -TimeoutSeconds $TimeoutSeconds
}

function Invoke-CoreWatchRequest($Context, $Record, [string]$Endpoint, [string]$Method = 'Get') {
    # Never read credentials or contact a responder until exact ownership and
    # both configured listener owners have been established for this request.
    Assert-CoreWatchOwnership $Context $Record
    if (-not (Test-OperatorListeners $Context $Record)) { throw 'Managed listener is unavailable.' }
    $token = Get-OperatorToken $Context
    if (-not (Test-OperatorListeners $Context $Record)) { throw 'Managed listener ownership changed.' }
    $request = @{ Method = $Method; Uri = "http://$($Context.config.host):$($Context.config.port)/api/$Endpoint";
        Headers = @{ Authorization = "Bearer $token" }; TimeoutSec = 10 }
    if ($Method -eq 'Post') { $request.TimeoutSec = 30; $request.ContentType = 'application/json'; $request.Body = '{}' }
    return Invoke-RestMethod @request
}

function Restart-CoreWatchWriter($Context, $Record, [string]$Config, [string]$ConfigSha256) {
    if (Test-CoreWatchPaused $Context) { return }
    # Recheck exact ownership after retries; unknown or stopping records never
    # authorize an automatic restart. Stop performs the final ownership check.
    Assert-CoreWatchOwnership $Context $Record
    $current = Read-OperatorJson $Context.runtimeFile
    if ($current.state -notin @('running', 'starting') -or $current.pid -ne $Record.pid -or $current.processStartedAt -cne $Record.processStartedAt) { throw 'Managed runtime changed during recovery.' }
    $null = Get-OperatorOwnedProcess $Context $current
    Write-CoreWatchLog $Context 'Restarting the verified writer through managed Stop and Start.'
    Invoke-CoreWatchHelper $Context 'Stop' $Config $ConfigSha256
    if (Test-CoreWatchPaused $Context) { return }
    Assert-CoreWatchUnoccupied $Context
    Invoke-CoreWatchHelper $Context 'Start' $Config $ConfigSha256
}

function Invoke-CoreWatchTick([string]$Config, [string]$ConfigSha256,
    [int]$WorkerRecoveryTimeoutSeconds = 30, [int]$HealthRetryDelaySeconds = 15, [string]$CurrentRelease) {
    $reference = $null
    if ($CurrentRelease) {
        $reference = Read-ReleaseV2Pointer $CurrentRelease -ForStop
        $Config = $reference.pointer.config.path
        $ConfigSha256 = $reference.pointer.config.sha256
    }
    Assert-OperatorPin ([pscustomobject]@{ path = $Config; sha256 = $ConfigSha256 })
    $context = Read-OperatorConfig $Config -ForStop
    # Cutover opens this same exclusive lock before setting picker-paused and
    # waits for any in-flight health/recovery operation to finish.
    try { $tickLock = [IO.File]::Open((Join-Path $context.localDir 'watchdog-tick.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { return }
    try {
        if ($null -ne $reference) {
            # Resolve again under the same lock used for the entire managed
            # transition. A tick never acts on a half-old, half-new release.
            $null = Assert-ReleaseV2SamePointer $reference -ForStop
        }
        if (Test-CoreWatchPaused $context) { return }
        # Pinned Tailscale listeners must wait for that exact address to return
        # after boot; never silently replace the configured address with loopback.
        if ($context.config.host -like '100.*' -and -not @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $context.config.host -ErrorAction SilentlyContinue).Count) {
            Write-CoreWatchLog $context 'Waiting for the pinned private listener address before checking the picker.'
            return
        }
        if (-not (Test-Path -LiteralPath $context.runtimeFile)) {
            Assert-CoreWatchUnoccupied $context
            Invoke-CoreWatchHelper $context 'Start' $Config $ConfigSha256
            return
        }
        $record = Read-OperatorJson $context.runtimeFile
        if ($record.state -notin @('running', 'starting')) { throw 'Runtime is stopping or unknown.' }
        $process = Get-OperatorOwnedProcess $context $record
        if (-not $process) {
            Assert-CoreWatchUnoccupied $context
            Invoke-CoreWatchHelper $context 'Stop' $Config $ConfigSha256
            if (-not (Test-CoreWatchPaused $context)) { Invoke-CoreWatchHelper $context 'Start' $Config $ConfigSha256 }
            return
        }
        $health = $null
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            if (Test-CoreWatchPaused $context) { return }
            try { $health = Invoke-CoreWatchRequest $context $record 'health'; break }
            catch {
                # An unavailable endpoint can be retried; changed ownership or
                # a stopping/unknown record aborts the tick immediately.
                Assert-CoreWatchOwnership $context $record
                if ($attempt -lt 3 -and $HealthRetryDelaySeconds) { Start-Sleep -Seconds $HealthRetryDelaySeconds }
            }
        }
        if (-not $health) {
            # New managed launches retain the previous five-minute startup grace.
            if ($record.state -eq 'starting' -and ([DateTime]::UtcNow - [DateTime]::Parse($record.processStartedAt).ToUniversalTime()).TotalSeconds -lt 300) { return }
            Restart-CoreWatchWriter $context $record $Config $ConfigSha256
            return
        }
        if (-not $health.worker.stuck -and -not $health.worker.restartRequired) { return }
        if (Test-CoreWatchPaused $context) { return }
        Write-CoreWatchLog $context 'Task worker needs recovery; requesting worker replacement.'
        try { $null = Invoke-CoreWatchRequest $context $record 'worker-restart' 'Post' }
        catch { Assert-CoreWatchOwnership $context $record; Write-CoreWatchLog $context 'Worker replacement request was unavailable; checking health before fallback.' }
        $until = [DateTime]::UtcNow.AddSeconds($WorkerRecoveryTimeoutSeconds)
        do {
            if (Test-CoreWatchPaused $context) { return }
            $recovered = $false
            try {
                $health = Invoke-CoreWatchRequest $context $record 'health'
                $recovered = $health.worker -and -not $health.worker.stuck -and -not $health.worker.restartRequired -and -not $health.worker.recovering -and $health.worker.status -in @('ready', 'sleeping')
            } catch { Assert-CoreWatchOwnership $context $record }
            if ($recovered) { Write-CoreWatchLog $context 'Task worker recovered; picker and saves remained running.'; return }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $until)
        Restart-CoreWatchWriter $context $record $Config $ConfigSha256
    } catch { Write-CoreWatchLog $context 'Watchdog refused recovery; inspect exact runtime ownership, listeners and pinned inputs.' }
    finally { $tickLock.Dispose() }
}
