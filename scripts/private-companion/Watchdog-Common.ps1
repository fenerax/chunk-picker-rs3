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

function Get-CoreWatchRefusalReason($ErrorRecord) {
    # Name a refusal only by a fixed `throw '...'` sentence from the operator's
    # own scripts. Any other exception text can carry paths, URLs or tokens.
    $message = $ErrorRecord.Exception.Message
    if ($message) {
        foreach ($name in 'Operator-Common.ps1', 'ReleaseV2-Common.ps1', 'Watchdog-Common.ps1') {
            $path = Join-Path $PSScriptRoot $name
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
            foreach ($node in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.ThrowStatementAst] }, $true)) {
                $value = if ($null -ne $node.Pipeline) { $node.Pipeline.GetPureExpression() } else { $null }
                if ($value -is [Management.Automation.Language.StringConstantExpressionAst] -and $value.Value -ceq $message) { return "Reason: $message" }
            }
        }
    }
    return "Reason: an unexpected error (details withheld; $(Get-CoreWatchErrorFingerprint $ErrorRecord))."
}

function Get-CoreWatchErrorFingerprint($ErrorRecord) {
    # Identify an unexpected error by its type, codes and where it was raised,
    # never by message text. Each part keeps only name characters.
    $safe = { param($Value) ("$Value" -replace '[^A-Za-z0-9._-]', '') -replace '^(.{0,80}).*$', '$1' }
    $exception = $ErrorRecord.Exception
    $parts = @(& $safe $exception.GetType().FullName)
    $parts += 'HResult 0x{0:X8}' -f $exception.HResult
    if ($exception.PSObject.Properties['NativeErrorCode']) { $parts += 'native ' + (& $safe $exception.NativeErrorCode) }
    $parts += 'category ' + (& $safe $ErrorRecord.CategoryInfo.Category)
    $invocation = $ErrorRecord.InvocationInfo
    if ($invocation) {
        $where = if ($invocation.ScriptName) { (& $safe (Split-Path -Leaf $invocation.ScriptName)) + ':' + [int]$invocation.ScriptLineNumber } else { 'line ' + [int]$invocation.ScriptLineNumber }
        # A cmdlet error names its cmdlet; a throw names only its enclosing
        # function, as the first frame of the script stack trace.
        $command = if ($invocation.MyCommand) { & $safe $invocation.MyCommand.Name }
            elseif ("$($ErrorRecord.ScriptStackTrace)" -match '^at ([^,\r\n]+),') { & $safe $Matches[1] } else { '' }
        $parts += $(if ($command) { "in $command at $where" } else { "at $where" })
    }
    return $parts -join ', '
}

function Test-CoreWatchPaused($Context) { return Test-Path -LiteralPath (Join-Path $Context.localDir 'picker-paused') }

function Test-CoreWatchReleaseBuild($Context) {
    # Quick-Release marks a candidate build, whose heavy work can starve health
    # checks. The mark holds only while that exact build process (PID and
    # creation time) still runs, and for at most an hour; anything else is unproven.
    $path = Join-Path $Context.localDir 'release-build-active.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    try {
        $marker = [IO.File]::ReadAllText($path) | ConvertFrom-Json
        if (-not ($marker.pid -is [int] -or $marker.pid -is [long]) -or $marker.pid -lt 1) { return $false }
        $age = [DateTime]::UtcNow - (ConvertTo-OperatorUtc $marker.startedAt)
        if ($age -lt [TimeSpan]::FromMinutes(-1) -or $age -gt [TimeSpan]::FromMinutes(60)) { return $false }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$marker.pid)" -OperationTimeoutSec $script:OperatorQueryTimeoutSec -ErrorAction Stop
        if (-not $process) { return $false }
        return ([DateTime]$process.CreationDate).ToUniversalTime().Ticks -eq (ConvertTo-OperatorUtc $marker.processStartedAt).Ticks
    } catch { return $false }
}

function Assert-CoreWatchUnoccupied($Context, $DeadRecord = $null) {
    foreach ($port in @($Context.config.port, $Context.config.loopbackPort) | Where-Object { $null -ne $_ }) {
        if (@(Get-OperatorListenSockets $port).Count) { throw 'An unowned listener prevents startup.' }
    }
    Move-CoreWatchRestartLock $Context
    if ($null -ne $DeadRecord) { Move-CoreWatchDeadRecordLock $Context $DeadRecord }
    Assert-OperatorStoreReleased $Context
}

function Read-CoreWatchLocalLock($Context) {
    # The storage lock text and owner when it is complete, local and the only
    # trace of a writer: no recovery marker and no process naming the data dir.
    $dataDir = $Context.config.dataDir
    $lock = Join-Path $dataDir 'store.lock'
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf) -or (Test-Path -LiteralPath "$lock.recovery")) { return $null }
    $pattern = '(?i)(?:^|\s)--data-dir\s+"?' + [regex]::Escape($dataDir) + '"?(?:\s|$)'
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -OperationTimeoutSec $script:OperatorQueryTimeoutSec -ErrorAction Stop | Where-Object { $_.CommandLine -match $pattern }).Count) { return $null }
    $text = [IO.File]::ReadAllText($lock)
    try {
        $owner = $text | ConvertFrom-Json
        foreach ($name in 'pid', 'host', 'startVerified', 'startedAt', 'createdAt') { if (-not $owner.PSObject.Properties[$name]) { return $null } }
        if (-not ($owner.pid -is [int] -or $owner.pid -is [long]) -or $owner.pid -lt 1 -or $owner.startVerified -isnot [bool] -or -not $owner.startVerified) { return $null }
        if ($owner.host -isnot [string] -or $owner.host -ine [Net.Dns]::GetHostName()) { return $null }
    } catch { return $null }
    return [pscustomobject]@{ path = $lock; text = $text; owner = $owner }
}

function Move-CoreWatchLockAside($Context, $Lock, [string]$Kind, [string]$Message) {
    $review = Join-Path $Context.config.dataDir ("store.lock.$Kind-" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
    [IO.File]::Move($Lock.path, $review)
    if ([IO.File]::ReadAllText($review) -cne $Lock.text) { [IO.File]::Move($review, $Lock.path); throw 'Storage lock changed while it moved.' }
    Write-CoreWatchLog $Context $Message
}

function Move-CoreWatchRestartLock($Context) {
    # A storage lock written before the last boot belongs to a server that the
    # restart ended. Only that exact, local, fully recorded case moves aside to
    # a review copy; anything else stays for Assert-OperatorStoreReleased to refuse.
    $lock = Read-CoreWatchLocalLock $Context
    if ($null -eq $lock) { return }
    try { if (-not (Test-OperatorBeforeBoot $lock.owner.startedAt) -or -not (Test-OperatorBeforeBoot $lock.owner.createdAt)) { return } } catch { return }
    Move-CoreWatchLockAside $Context $lock 'restart' 'Moved a storage lock left from before the last restart to a review copy.'
}

function Move-CoreWatchDeadRecordLock($Context, $Record) {
    # A writer killed without a restart (for example with the session that
    # launched it) leaves its lock behind. It moves aside only when the lock
    # names the runtime record's own PID and start time and no process holds
    # that PID any more; a reused PID still waits for manual review.
    $lock = Read-CoreWatchLocalLock $Context
    if ($null -eq $lock) { return }
    try {
        if ($lock.owner.pid -ne $Record.pid) { return }
        $started = (ConvertTo-OperatorUtc $Record.processStartedAt).Ticks
        if ([Math]::Abs((ConvertTo-OperatorUtc $lock.owner.startedAt).Ticks - $started) -ge [TimeSpan]::TicksPerMillisecond) { return }
        if ((ConvertTo-OperatorUtc $lock.owner.createdAt).Ticks -lt $started) { return }
    } catch { return }
    if (@(Get-CimInstance Win32_Process -Filter "ProcessId = $($Record.pid)" -OperationTimeoutSec $script:OperatorQueryTimeoutSec -ErrorAction Stop).Count) { return }
    Move-CoreWatchLockAside $Context $lock 'dead' 'Moved the storage lock of the recorded writer, which has exited, to a review copy.'
}

function Assert-CoreWatchOwnership($Context, $Record) {
    $current = Read-OperatorJson $Context.runtimeFile
    if ($current.state -notin @('running', 'starting') -or $current.pid -ne $Record.pid -or $current.processStartedAt -cne $Record.processStartedAt -or $current.configHash -cne $Record.configHash) { throw 'Runtime changed or is stopping.' }
    $null = Get-OperatorOwnedProcess $Context $current
    $listeners = @(@{ address = $Context.config.host; port = $Context.config.port })
    if ($null -ne $Context.config.loopbackPort) { $listeners += @{ address = '127.0.0.1'; port = $Context.config.loopbackPort } }
    foreach ($listener in $listeners) {
        $sockets = @(Get-OperatorListenSockets $listener.port | Where-Object { $_.LocalAddress -eq $listener.address })
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
    # A slow picker that still holds both listeners is left serving while a
    # release candidate builds; a writer without them recovers as before.
    if ((Test-CoreWatchReleaseBuild $Context) -and (Test-OperatorListeners $Context $current)) {
        Write-CoreWatchLog $Context 'Health check failed during a release build; the serving picker was left running.'
        return
    }
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
    $step = 'checking the live release'
    try {
        if ($null -ne $reference) {
            # Resolve again under the same lock used for the entire managed
            # transition. A tick never acts on a half-old, half-new release.
            $null = Assert-ReleaseV2SamePointer $reference -ForStop
        }
        if (Test-CoreWatchPaused $context) { return }
        # Pinned Tailscale listeners must wait for that exact address to return
        # after boot; never silently replace the configured address with loopback.
        if ($context.config.host -like '100.*' -and -not @(Get-OperatorNetQuery 'Get-NetIPAddress' @{ AddressFamily = 'IPv4'; IPAddress = $context.config.host }).Count) {
            Write-CoreWatchLog $context 'Waiting for the pinned private listener address before checking the picker.'
            return
        }
        if (-not (Test-Path -LiteralPath $context.runtimeFile)) {
            Assert-CoreWatchUnoccupied $context
            Invoke-CoreWatchHelper $context 'Start' $Config $ConfigSha256
            return
        }
        $step = 'reading the runtime record'
        $record = Read-OperatorJson $context.runtimeFile
        if ($record.state -notin @('running', 'starting', 'stopping')) { throw 'Runtime record state is unknown.' }
        $step = 'checking the recorded writer'
        # Throws on a reused PID, a changed start time or command; null only when
        # no process holds the PID or the record predates the last boot.
        $process = Get-OperatorOwnedProcess $context $record
        # A Stop that timed out leaves its record at stopping. The writer can
        # still take the shutdown later and exit; until it has, nothing moves.
        if ($record.state -eq 'stopping' -and $process) { throw 'The recorded writer is still stopping.' }
        if (-not $process) {
            $step = 'replacing the exited writer'
            Assert-CoreWatchUnoccupied $context $record
            if ($record.state -eq 'stopping') { Write-CoreWatchLog $context 'The recorded writer exited after a Stop that did not finish; clearing its stopping record through managed Stop and starting the picker.' }
            else { Write-CoreWatchLog $context 'The recorded writer exited; clearing its record through managed Stop and starting the picker.' }
            Invoke-CoreWatchHelper $context 'Stop' $Config $ConfigSha256
            if (-not (Test-CoreWatchPaused $context)) { Invoke-CoreWatchHelper $context 'Start' $Config $ConfigSha256 }
            return
        }
        $step = 'checking health'
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
            $step = 'restarting the unhealthy writer'
            Restart-CoreWatchWriter $context $record $Config $ConfigSha256
            return
        }
        if (-not $health.worker.stuck -and -not $health.worker.restartRequired) { return }
        if (Test-CoreWatchPaused $context) { return }
        $step = 'recovering the task worker'
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
        $step = 'restarting the writer after worker recovery'
        Restart-CoreWatchWriter $context $record $Config $ConfigSha256
    } catch { Write-CoreWatchLog $context ("Watchdog refused recovery while $step. " + (Get-CoreWatchRefusalReason $_) + ' Inspect exact runtime ownership, listeners and pinned inputs.') }
    finally { $tickLock.Dispose() }
}
