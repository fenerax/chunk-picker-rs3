# Fixed process operations for the initial handover. No dot-source side effects.
param([Parameter(Mandatory=$true)][string]$Plan,
    [Parameter(Mandatory=$true)][ValidateSet('preflight','pause','unpause','stop-old','stopped','new-owned','old-owned','start-new','stop-new','start-old','secure','verify-security','hold-lock')][string]$Operation,
    [string]$Folder)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
. (Join-Path $PSScriptRoot 'Legacy-Stop.ps1')
try {
    $p = Read-OperatorJson (Assert-OperatorPath $Plan)
    $candidate = Read-OperatorConfig $p.candidateConfig.path -ForStop
    $previous = Read-OperatorConfig $p.previousConfig.path -ForStop
    Assert-OperatorRollbackPair $candidate $previous
    $pause = Join-Path $candidate.localDir 'picker-paused'
    function Assert-OldOwner {
        param([switch]$AllowStopping)
        $states = if ($AllowStopping) { @('running','stopping') } else { @('running') }
        $managed = Read-OperatorJson $previous.runtimeFile
        if ($managed.PSObject.Properties.Name -contains 'configHash') {
            if ($managed.configHash -cne $previous.configHash -or $managed.state -notin $states -or -not (Test-OperatorListeners $previous $managed)) { throw 'Previous managed owner refused.' }
            return
        }
        Assert-OperatorPin $p.oldHelpers.process
        . $p.oldHelpers.process.path
        $record = Read-PickerRuntime $previous.runtimeFile
        $process = Get-PickerRecordedProcess $record
        if (-not $record -or -not $record.processStartedAt -or -not $process -or
            -not (Test-PickerProcessOwnership $process $previous.config.coreRoot $previous.config.dataDir $previous.config.nodePath $record.processStartedAt)) { throw 'Old ownership refused.' }
        if ($record.hostAddress -ine $previous.config.host -or $record.port -ne $previous.config.port -or $record.state -notin $states) { throw 'Old listener or state differs.' }
        # Use the strict new validator for listeners and the exact current CIM timestamp,
        # after the matching old helper verified its original 2 ms timestamp tolerance.
        $proof = [pscustomobject]@{pid=[int]$record.pid;processStartedAt=([DateTime]$process.CreationDate).ToUniversalTime().ToString('o');configHash=$previous.configHash}
        if (-not (Test-OperatorListeners $previous $proof)) { throw 'Old listeners unavailable.' }
    }
    function Assert-NewOwner {
        $record = Read-OperatorJson $candidate.runtimeFile
        if (-not (Test-OperatorListeners $candidate $record)) { throw 'New listener ownership refused.' }
    }
    function Stop-OriginalWriter {
        if (Test-Path -LiteralPath $previous.runtimeFile) {
            $record = Read-OperatorJson $previous.runtimeFile
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)"
            if ($process) { Assert-OldOwner -AllowStopping }
            elseif ($record.projectRoot -ine $previous.config.coreRoot -or $record.dataDir -ine $previous.config.dataDir -or $record.executable -ine $previous.config.nodePath -or -not $record.processStartedAt) { throw 'Dead original record metadata differs.' }
            Assert-OperatorPin $p.oldHelpers.stop
            $null = Invoke-LegacyGracefulStop $p.oldHelpers.stop.path 300
        }
        Assert-OperatorStoreReleased $previous
        if (Test-Path -LiteralPath $previous.runtimeFile) { throw 'Original record remains.' }
    }
    function Set-Pause([bool]$Paused) {
        # Serialize with an entire watchdog tick, not just Start/Stop. Once pause returns,
        # an earlier tick cannot later resurrect the old or candidate writer.
        $tick = $null; $until = [DateTime]::UtcNow.AddSeconds(300)
        do {
            try { $tick = [IO.File]::Open((Join-Path $candidate.localDir 'watchdog-tick.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
            catch [IO.IOException] { Start-Sleep -Milliseconds 250 }
        } while (-not $tick -and [DateTime]::UtcNow -lt $until)
        if (-not $tick) { throw 'Watchdog tick still active.' }
        try {
            if ($Paused) {
                [IO.File]::WriteAllText($pause, 'M7 operator pause')
                $taskPlan = Read-OperatorJson $p.taskPlan.path
                if ($null -eq $taskPlan.mockDirectory) {
                    # The original watchdog predates watchdog-tick.lock. Wait for
                    # its scheduled invocation and any synchronous helper to drain,
                    # reasserting the marker after an old Start clears it.
                    do {
                        [IO.File]::WriteAllText($pause, 'M7 operator pause')
                        $task = Get-ScheduledTask -TaskName $taskPlan.watchdog.name -TaskPath $taskPlan.watchdog.taskPath
                        if ($task.State -ne 'Running') { break }
                        if ([DateTime]::UtcNow -ge $until) { throw 'Original watchdog is still running.' }
                        Start-Sleep -Milliseconds 250
                    } while ($true)
                    [IO.File]::WriteAllText($pause, 'M7 operator pause')
                }
            }
            elseif (Test-Path -LiteralPath $pause) { Remove-Item -LiteralPath $pause }
        } finally { $tick.Dispose() }
    }
    switch ($Operation) {
        'hold-lock' {
            # The coordinator keeps this child alive only during snapshot/bind.
            # Both original and companion launchers honor this exact file lock.
            if (-not (Test-Path -LiteralPath $pause)) { throw 'Pause required for the stopped-writer lease.' }
            $held = Enter-OperatorLock $candidate
            try {
                [Console]::Out.WriteLine('operator-lock-held'); [Console]::Out.Flush()
                $null = [Console]::In.ReadLine()
            } finally {
                # The legacy Start clears this marker before taking helper.lock.
                # Reassert it before releasing a stopped-writer critical section.
                try { [IO.File]::WriteAllText($pause, 'M7 operator pause') }
                finally { $held.Dispose() }
            }
        }
        'preflight' {
            Assert-OldOwner
            if (Test-Path -LiteralPath (Join-Path $previous.config.dataDir 'store.lock.recovery')) { throw 'Recovery lock remains.' }
            if (-not (Test-Path -LiteralPath (Join-Path $previous.config.dataDir 'store.lock'))) { throw 'Running writer storage lock missing.' }
            # Read-only sharing probe: do not create or truncate the live helper lock.
            $probe = [IO.File]::Open((Join-Path $previous.localDir 'helper.lock'), 'Open', 'Read', 'None')
            $probe.Dispose()
        }
        'pause' { Set-Pause $true }
        'unpause' { Set-Pause $false }
        'stop-old' {
            if (-not (Test-Path -LiteralPath $pause)) { throw 'Pause required.' }
            Stop-OriginalWriter
        }
        'stopped' { if (-not (Test-Path -LiteralPath $pause)) { throw 'Pause marker was removed.' }; Assert-OperatorStoreReleased $candidate; if (Test-Path -LiteralPath $candidate.runtimeFile) { throw 'Runtime record remains.' } }
        'new-owned' { Assert-NewOwner }
        'old-owned' { Assert-OldOwner }
        'start-new' {
            if (-not (Test-Path -LiteralPath $pause)) { throw 'Pause required.' }
            & (Join-Path $PSScriptRoot 'Start-Core.ps1') -Config $p.candidateConfig.path -PreservePause -TimeoutSeconds 300
        }
        'stop-new' {
            if (Test-Path -LiteralPath $candidate.runtimeFile) {
                $record = Read-OperatorJson $candidate.runtimeFile
                if ($record.PSObject.Properties.Name -contains 'configHash' -and $record.configHash -ceq $candidate.configHash) {
                    & (Join-Path $PSScriptRoot 'Stop-Core.ps1') -Config $p.candidateConfig.path -PreservePause -TimeoutSeconds 300
                } elseif ($record.state -eq 'stopping') { Stop-OriginalWriter }
                else { Assert-OldOwner; return }
            }
            Assert-OperatorStoreReleased $candidate
        }
        'start-old' {
            if (Test-Path -LiteralPath $previous.runtimeFile) { Assert-OldOwner; return }
            if (-not (Test-Path -LiteralPath $pause)) { throw 'Pause required.' }
            if (Test-Path -LiteralPath ($previous.config.dataDir + '.dataset.json')) {
                & (Join-Path $PSScriptRoot 'Start-Core.ps1') -Config $p.previousConfig.path -PreservePause -TimeoutSeconds 300
            } else {
                # An early abort can precede the binding step. Only the matching
                # original launcher may reopen its original unbound store. Start-Core
                # keeps its mandatory binding gate. Unsupported retention refuses.
                $c = $previous.config
                if ($null -ne $c.runtimeOptions.backupDays -or $null -ne $c.runtimeOptions.historyEntries) { throw 'Original launcher cannot express retention overrides.' }
                Assert-OperatorPin $p.oldHelpers.start
                $saved = @{}
                foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS','NODE_PATH') })) { $saved[$entry.Name]=$entry.Value; [Environment]::SetEnvironmentVariable($entry.Name,$null,'Process') }
                try {
                    $env:RS3_DATASET='duo-legacy'; $env:RS3_PACKS_DIR=$c.packsDir; $env:RS3_PACK_SELECTION=$c.selection.path; $env:RS3_PUBLIC_ORIGIN=$previous.origin
                    if ($null -ne $c.profile) { $env:RS3_DATASET_PROFILE=$c.profile.path; $env:RS3_DATASET_PROFILE_SHA256=$c.profile.sha256 }
                    if ($null -ne $c.addons) { $env:RS3_PRIVATE_ADDON=$c.addons.path; $env:RS3_PRIVATE_ADDON_SHA256=$c.addons.sha256 }
                    if ($null -ne $c.loopbackPort) { $env:RS3_LOOPBACK_PORT=[string]$c.loopbackPort }
                    if ($null -ne $c.runtimeOptions.workerIdleMs) { $env:RS3_WORKER_IDLE_MS=[string]$c.runtimeOptions.workerIdleMs }
                    if ($null -ne $c.runtimeOptions.taskWorkerMode) { $env:RS3_TASK_WORKER_MODE=$c.runtimeOptions.taskWorkerMode }
                    $arguments = '-NoProfile -NonInteractive -File "' + $p.oldHelpers.start.path + '" -HostAddress "' + $c.host + '" -Port "' + [string]$c.port + '" -ReadinessTimeoutSeconds 300'
                    Invoke-OperatorForeground -Executable (Join-Path $PSHOME 'pwsh.exe') -Arguments $arguments -TimeoutSeconds 320
                } finally {
                    foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS','NODE_PATH') })) { [Environment]::SetEnvironmentVariable($entry.Name,$null,'Process') }
                    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
                    Set-Pause $true
                }
            }
        }
        'secure' {
            $directory = Assert-OperatorPath $Folder -Directory
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
            function Test-SecuredAcl($Value) {
                $rules=@($Value.Access)
                if (-not $Value.AreAccessRulesProtected -or $rules.Count -ne 2 -or $Value.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity.Value) { return $false }
                $seen=@{}
                foreach($rule in $rules) {
                    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                    if($sid -notin @($identity.Value,'S-1-5-18') -or $rule.AccessControlType -ne 'Allow' -or $rule.IsInherited -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { return $false }
                    $seen[$sid]=$true
                }
                return $seen.Count -eq 2
            }
            # Avoid propagating a new DACL over active receipt files on every step.
            if(Test-SecuredAcl (Get-Acl -LiteralPath $directory)){ return }
            $acl = [Security.AccessControl.DirectorySecurity]::new()
            $acl.SetOwner($identity); $acl.SetAccessRuleProtection($true, $false)
            foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
                $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
            }
            Set-Acl -LiteralPath $directory -AclObject $acl
            if (-not (Test-SecuredAcl (Get-Acl -LiteralPath $directory))) { throw 'Snapshot ACL refused.' }
        }
        'verify-security' {
            $directory=Assert-OperatorPath $Folder -Directory
            $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            if (-not (Get-Acl -LiteralPath $directory).AreAccessRulesProtected) { throw 'Snapshot root inherits permissions.' }
            $items=@(Get-Item -LiteralPath $directory -Force)+@(Get-ChildItem -LiteralPath $directory -Recurse -Force)
            foreach($item in $items) {
                if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Snapshot link refused.'}
                $acl=Get-Acl -LiteralPath $item.FullName
                $rules=@($acl.Access);$seen=@{}
                if($rules.Count -ne 2 -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $identity){throw 'Snapshot owner or rule count differs.'}
                foreach($rule in $rules){
                    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
                    if($sid -notin @($identity,'S-1-5-18') -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'Snapshot grants unexpected access.'}
                    $seen[$sid]=$true
                }
                if($seen.Count -ne 2){throw 'Snapshot recovery access missing.'}
            }
        }
    }
} catch {
    # Fixed operation/type only: preserve a useful refusal category without
    # disclosing an exception message, configuration, origin or credential.
    $kind=$_.Exception.GetBaseException().GetType().Name.ToUpperInvariant() -replace '[^A-Z_]','_'
    [Console]::Out.WriteLine('M7_REFUSAL_' + $Operation.ToUpperInvariant().Replace('-','_') + '_' + $kind)
    [Console]::Out.Flush()
    Write-Error "Cutover process operation refused: $Operation. Inspect pinned inputs and exact ownership privately."
    exit 1
}
