# One-time installation primitives. No IO until explicitly invoked.
Set-StrictMode -Version Latest

function Get-ReleaseV2ExistingTask([string]$Name) {
    if ($Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9 _.-]{0,127}$') { throw 'Invalid explicit task name.' }
    $target = [pscustomobject]@{ name = $Name; taskPath = '\' }
    return Get-CoreTaskCurrentXml ([pscustomobject]@{ mockDirectory = $null }) $target
}

function Get-ReleaseV2InstallFiles([string]$SourceRoot) {
    $operator = Assert-OperatorPath (Join-Path $SourceRoot 'operator') -Directory
    $names = @('Operator-Common.ps1', 'Watchdog-Common.ps1', 'ReleaseV2-Common.ps1', 'Task-Common.ps1',
        'Start-Core.ps1', 'Stop-Core.ps1', 'Watch-Core.ps1', 'Managed-ReleaseV2.ps1', 'Install-ReleaseV2.ps1', 'InstallV2-Common.ps1')
    return @($names | ForEach-Object {
        $path = Assert-OperatorPath (Join-Path $operator $_)
        [pscustomobject]@{ name = $_; path = $path; sha256 = Get-ReleaseV2Hash $path }
    })
}

function Assert-ReleaseV2InstalledFiles($Snapshot, [string]$Root) {
    foreach ($file in $Snapshot.files) {
        Assert-OperatorFields $file @('name', 'sha256')
        if ($file.name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9.-]+\.ps1$') { throw 'Invalid snapshot filename.' }
        Assert-OperatorPin ([pscustomobject]@{ path = Join-Path (Join-Path $Root 'operator') $file.name; sha256 = $file.sha256 })
    }
}

function Invoke-ReleaseV2Installation([string]$SourceRoot, [string]$InstallRoot, [string]$InitialPointer,
    [string]$WatchdogTaskName, [string]$BackupTaskName, [switch]$Restore, [switch]$DryRun) {
    $root = Assert-OperatorAbsolute $InstallRoot
    if ($Restore) {
        $root = Assert-OperatorPath $root -Directory
        $snapshot = Read-OperatorJson (Assert-OperatorPath (Join-Path $root 'installation.json'))
        Assert-OperatorFields $snapshot @('schemaVersion', 'files', 'taskPlan', 'initialConfigHash', 'wasPaused')
        if ($snapshot.schemaVersion -ne 2) { throw 'Invalid installation snapshot.' }
        # Recovery trusts retained plan/XML pins, not the possibly broken new
        # operator payload that this operation is meant to retire.
        Assert-OperatorPin $snapshot.taskPlan
        $plan = Read-CoreTaskPlan (Join-Path $root 'task-plan.json') -ForRestore
        $reference = Read-ReleaseV2Pointer (Join-Path $root 'current.json') -ForStop
        # Restoring an old task action after a release would select wrong code.
        # Require explicit managed rollback to the initial configuration first.
        if ($reference.context.configHash -cne $snapshot.initialConfigHash) { throw 'Restore requires the initial managed release configuration.' }
        if ($DryRun) { Invoke-CoreTaskRestoration $plan -DryRun; return }
        $tick = $null; $owner = $null
        try {
            $tick = [IO.File]::Open((Join-Path $reference.context.localDir 'watchdog-tick.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $owner = Enter-OperatorLock $reference.context
            $null = Assert-ReleaseV2SamePointer $reference -ForStop
            if (Test-Path -LiteralPath $reference.context.runtimeFile) { $null = Get-OperatorOwnedProcess $reference.context (Read-OperatorJson $reference.context.runtimeFile) }
            Set-Content -LiteralPath (Join-Path $reference.context.localDir 'picker-paused') -Value 'release-v2-restore'
            Invoke-CoreTaskRestoration $plan
            # The retained original task may already have pinned an older
            # configuration before installation. Restore XML exactly, but require
            # explicit review before allowing that old task to recover a writer.
            Write-Output 'Original scheduled tasks restored; watchdog remains paused. Installed files and snapshots retained.'
        } finally { if ($null -ne $owner) { $owner.Dispose() }; if ($null -ne $tick) { $tick.Dispose() } }
        return
    }
    if (Test-Path -LiteralPath $root) { throw 'Installation requires an absent destination; retained installations are never overwritten.' }
    $parent = Assert-OperatorPath (Split-Path -Parent $root) -Directory
    $source = Assert-OperatorPath $SourceRoot -Directory
    $files = @(Get-ReleaseV2InstallFiles $source)
    $reference = Read-ReleaseV2Pointer $InitialPointer -ForStop
    if ($WatchdogTaskName -ieq $BackupTaskName) { throw 'Task names must be distinct.' }
    $originalWatch = Get-ReleaseV2ExistingTask $WatchdogTaskName
    $originalBackup = Get-ReleaseV2ExistingTask $BackupTaskName
    $null = Read-CoreTaskXml $originalWatch; $null = Read-CoreTaskXml $originalBackup
    if (Test-Path -LiteralPath $reference.context.runtimeFile) {
        $record = Read-OperatorJson $reference.context.runtimeFile
        if ($record.state -notin @('running', 'starting')) { throw 'Initial runtime must be managed.' }
        $null = Get-OperatorOwnedProcess $reference.context $record
    }
    if ($DryRun) {
        [ordered]@{ operation = 'install-release-v2'; dryRun = $true; files = $files.Count;
            tasksSnapshotted = 2; tasksChanged = 1; retainedTriggers = $true; initialReleaseId = $reference.pointer.releaseId;
            restoreSupported = $true } | ConvertTo-Json
        return
    }
    $tick = $null; $owner = $null; $created = $false; $registered = $false; $plan = $null
    $pause = Join-Path $reference.context.localDir 'picker-paused'
    $wasPaused = Test-Path -LiteralPath $pause
    try {
        $tick = [IO.File]::Open((Join-Path $reference.context.localDir 'watchdog-tick.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $owner = Enter-OperatorLock $reference.context
        $null = Assert-ReleaseV2SamePointer $reference -ForStop
        if (-not (Test-CoreTaskXmlEqual (Get-ReleaseV2ExistingTask $WatchdogTaskName) $originalWatch) -or
            -not (Test-CoreTaskXmlEqual (Get-ReleaseV2ExistingTask $BackupTaskName) $originalBackup)) { throw 'Task drift before installation.' }
        Set-Content -LiteralPath $pause -Value 'release-v2-install'
        $null = New-Item -ItemType Directory -Path $root; $created = $true
        $operator = Join-Path $root 'operator'; $null = New-Item -ItemType Directory -Path $operator
        foreach ($file in $files) {
            Assert-OperatorPin ([pscustomobject]@{ path = $file.path; sha256 = $file.sha256 })
            [IO.File]::WriteAllBytes((Join-Path $operator $file.name), [IO.File]::ReadAllBytes($file.path))
        }
        $current = Join-Path $root 'current.json'
        [IO.File]::WriteAllBytes($current, [IO.File]::ReadAllBytes($reference.path))
        $watchXml = Join-Path $root 'watchdog-original.xml'; $backupXml = Join-Path $root 'backup-original.xml'
        [IO.File]::WriteAllText($watchXml, $originalWatch, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($backupXml, $originalBackup, [Text.UTF8Encoding]::new($false))
        $planValue = [ordered]@{ schemaVersion = 2;
            watchdog = @{ name = $WatchdogTaskName; taskPath = '\'; xml = @{ path = $watchXml; sha256 = Get-ReleaseV2Hash $watchXml } };
            backup = @{ name = $BackupTaskName; taskPath = '\'; xml = @{ path = $backupXml; sha256 = Get-ReleaseV2Hash $backupXml } };
            config = @{ path = $current; sha256 = Get-ReleaseV2Hash $current };
            watchScript = @{ path = Join-Path $operator 'Watch-Core.ps1'; sha256 = Get-ReleaseV2Hash (Join-Path $operator 'Watch-Core.ps1') };
            pwshPath = (Get-Process -Id $PID).Path; workingDirectory = $root; mockDirectory = $null }
        $planPath = Join-Path $root 'task-plan.json'
        [IO.File]::WriteAllText($planPath, ($planValue | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
        $snapshot = [ordered]@{ schemaVersion = 2; files = @($files | ForEach-Object { @{ name = $_.name; sha256 = $_.sha256 } });
            taskPlan = @{ path = $planPath; sha256 = Get-ReleaseV2Hash $planPath }; initialConfigHash = $reference.context.configHash; wasPaused = [bool]$wasPaused }
        [IO.File]::WriteAllText((Join-Path $root 'installation.json'), ($snapshot | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
        Assert-ReleaseV2InstalledFiles (Read-OperatorJson (Join-Path $root 'installation.json')) $root
        Assert-OperatorPin ([pscustomobject]$snapshot.taskPlan)
        $plan = Read-CoreTaskPlan $planPath
        Invoke-CoreTaskRegistration $plan; $registered = $true
        if (-not $wasPaused) { Remove-Item -LiteralPath $pause }
        Write-Output 'Release v2 operator installed and task actions verified; original task snapshots retained.'
    } catch {
        # Registration already restores accepted original XML on failure. If a
        # later operation fails, restore the tasks explicitly; never delete files.
        if ($registered -and $null -ne $plan) { Invoke-CoreTaskRestoration $plan }
        if (-not $created -and -not $wasPaused -and (Test-Path -LiteralPath $pause)) { Remove-Item -LiteralPath $pause }
        throw 'Installation failed; retain snapshots and keep watchdog paused for explicit recovery.'
    } finally { if ($null -ne $owner) { $owner.Dispose() }; if ($null -ne $tick) { $tick.Dispose() } }
}

# Existing installs retain task XML, installation receipts and current pointer.
# Helper updates own both locks and journal file pins before replacing bytes.
function Get-ReleaseV2HelperTasks([string]$Root, $Installation) {
    Assert-OperatorPin $Installation.taskPlan
    $plan = Read-CoreTaskPlan (Join-Path $Root 'task-plan.json') -ForRestore
    foreach ($target in @(Get-CoreTaskTargets $plan)) {
        $xml = Get-CoreTaskCurrentXml $plan $target
        if (-not (Test-CoreTaskXmlEqual $xml $target.desiredXml)) { throw 'Installed task action or triggers drifted.' }
    }
    return $plan
}

function Assert-ReleaseV2HelperFileSet($Files) {
    $names=@('Operator-Common.ps1','Watchdog-Common.ps1','ReleaseV2-Common.ps1','Task-Common.ps1','Start-Core.ps1','Stop-Core.ps1','Watch-Core.ps1','Managed-ReleaseV2.ps1','Install-ReleaseV2.ps1','InstallV2-Common.ps1')
    if (@($Files).Count -ne $names.Count -or @($Files.name | Select-Object -Unique).Count -ne $names.Count) { throw 'Invalid helper file set.' }
    foreach ($file in $Files) {
        Assert-OperatorFields $file @('name','sha256')
        if ($file.name -cnotin $names -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid helper file pin.' }
    }
}

function Read-ReleaseV2HelperState([string]$Root, $Installation) {
    $file = Join-Path $Root 'helper-current.json'
    if (-not (Test-Path -LiteralPath $file)) { return [pscustomobject]@{ files=$Installation.files; state='baseline'; snapshot=$null } }
    $null = Assert-OperatorPath $file
    $state = Read-OperatorJson $file
    Assert-OperatorFields $state @('schemaVersion','files','state','snapshot')
    if ($state.schemaVersion -ne 1 -or $state.state -notin @('deploying','ready')) { throw 'Invalid helper update state.' }
    Assert-OperatorPin $state.snapshot
    return $state
}

function Invoke-ReleaseV2HelperUpdate([string]$SourceRoot, [string]$InstallRoot, [switch]$UpdateHelpers, [switch]$RestoreHelpers, [switch]$DryRun) {
    if ([bool]$UpdateHelpers -eq [bool]$RestoreHelpers) { throw 'Select exactly one helper operation.' }
    $root = Assert-OperatorPath $InstallRoot -Directory
    $installationPath = Assert-OperatorPath (Join-Path $root 'installation.json')
    $installationHash = Get-ReleaseV2Hash $installationPath
    $installation = Read-OperatorJson $installationPath
    if ($installation.schemaVersion -ne 2) { throw 'Existing schema 2 installation required.' }
    $state = Read-ReleaseV2HelperState $root $installation
    Assert-ReleaseV2HelperFileSet $state.files
    $statePath = Join-Path $root 'helper-current.json'
    $stateHash = if (Test-Path -LiteralPath $statePath) { Get-ReleaseV2Hash $statePath } else { $null }
    $plan = Get-ReleaseV2HelperTasks $root $installation
    $reference = Read-ReleaseV2Pointer (Join-Path $root 'current.json') -ForStop
    if (Test-Path -LiteralPath $reference.context.runtimeFile) { $null = Get-OperatorOwnedProcess $reference.context (Read-OperatorJson $reference.context.runtimeFile) }
    $snapshot = $null
    if ($RestoreHelpers) {
        if ($state.state -eq 'baseline') { throw 'No helper update to restore.' }
        $snapshot = Read-OperatorJson $state.snapshot.path
        Assert-OperatorFields $snapshot @('schemaVersion','files','previousState','previousStateSha256','wasPaused','pauseBase64','pointerSha256')
        if ($snapshot.schemaVersion -ne 1) { throw 'Invalid helper snapshot.' }
        Assert-ReleaseV2HelperFileSet $snapshot.files
        if ($snapshot.pointerSha256 -cne $reference.sha256) { throw 'Helper restore requires the release selected before the helper update.' }
        $snapshotRoot = Split-Path -Parent $state.snapshot.path
        if ((Split-Path -Parent $snapshotRoot) -ine $root -or (Split-Path -Leaf $snapshotRoot) -cnotmatch '^helper-backup-[a-f0-9]{32}$') { throw 'Helper snapshot outside installation.' }
        Assert-ReleaseV2InstalledFiles $snapshot $snapshotRoot
        if ($snapshot.previousState -and (Get-ReleaseV2StringHash $snapshot.previousState) -cne $snapshot.previousStateSha256) { throw 'Previous helper state changed.' }
        $files = @($snapshot.files | ForEach-Object { [pscustomobject]@{name=$_.name;sha256=$_.sha256;path=(Join-Path (Join-Path $snapshotRoot 'operator') $_.name)} })
        foreach ($file in $state.files) {
            $old = @($snapshot.files | Where-Object { $_.name -ceq $file.name })
            $actual = Get-ReleaseV2Hash (Assert-OperatorPath (Join-Path (Join-Path $root 'operator') $file.name))
            if ($old.Count -ne 1 -or ($actual -cne $file.sha256 -and ($state.state -ne 'deploying' -or $actual -cne $old[0].sha256))) { throw 'Installed helper hash drift.' }
        }
    } else {
        if ($state.state -eq 'deploying') { throw 'Interrupted update requires helper restore.' }
        Assert-ReleaseV2InstalledFiles $state $root
        $source = Assert-OperatorPath $SourceRoot -Directory
        $kitPath = Assert-OperatorPath (Join-Path $source 'kit.json')
        $kitHash = Get-ReleaseV2Hash $kitPath
        $kit = Read-OperatorJson $kitPath
        if (-not ($kit.PSObject.Properties.Name -contains 'operatorFiles')) { throw 'Kit lacks helper pins.' }
        $files = @(Get-ReleaseV2InstallFiles $source)
        foreach ($file in $files) {
            $pin = @($kit.operatorFiles | Where-Object { $_.name -ceq $file.name })
            if ($pin.Count -ne 1 -or $pin[0].sha256 -cne $file.sha256) { throw 'Source helper hash drift.' }
        }
        if (@($state.files).Count -ne $files.Count -or @($files | Where-Object { $_.name -cnotin @($state.files.name) }).Count) { throw 'Helper file set changed.' }
    }
    if ($DryRun) {
        [ordered]@{ operation=$(if ($RestoreHelpers) {'restore-release-v2-helpers'} else {'update-release-v2-helpers'}); dryRun=$true; files=$files.Count; releaseId=$reference.pointer.releaseId;
            ownership=@('watchdog-tick','helper'); tasksChanged=0; retainedActions=$true; retainedTriggers=$true; restart=$false; restoreSupported=$true } | ConvertTo-Json
        return
    }
    $tick=$null; $owner=$null; $writing=$false
    $pause = Join-Path $reference.context.localDir 'picker-paused'
    $wasPaused = Test-Path -LiteralPath $pause
    $pauseBytes = if ($wasPaused) { [IO.File]::ReadAllBytes((Assert-OperatorPath $pause)) } else { [byte[]]@() }
    try {
        $tick=[IO.File]::Open((Join-Path $reference.context.localDir 'watchdog-tick.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $owner=Enter-OperatorLock $reference.context
        $null=Assert-ReleaseV2SamePointer $reference -ForStop
        if ((Get-ReleaseV2Hash $installationPath) -cne $installationHash) { throw 'Installation changed.' }
        $actualStateHash=if (Test-Path -LiteralPath $statePath) { Get-ReleaseV2Hash $statePath } else { $null }
        if ($actualStateHash -cne $stateHash) { throw 'Helper state changed.' }
        $null=Get-ReleaseV2HelperTasks $root $installation
        if (Test-Path -LiteralPath $reference.context.runtimeFile) { $null=Get-OperatorOwnedProcess $reference.context (Read-OperatorJson $reference.context.runtimeFile) }
        if ($RestoreHelpers) {
            Assert-OperatorPin $state.snapshot
            Assert-ReleaseV2InstalledFiles $snapshot $snapshotRoot
            foreach ($file in $state.files) {
                $old=@($snapshot.files | Where-Object { $_.name -ceq $file.name })
                $actual=Get-ReleaseV2Hash (Assert-OperatorPath (Join-Path (Join-Path $root 'operator') $file.name))
                if ($actual -cne $file.sha256 -and ($state.state -ne 'deploying' -or $actual -cne $old[0].sha256)) { throw 'Helper drift under ownership.' }
            }
        } else {
            Assert-ReleaseV2InstalledFiles $state $root
            if ((Get-ReleaseV2Hash $kitPath) -cne $kitHash) { throw 'Source kit changed.' }
        }
        foreach ($file in $files) { Assert-OperatorPin ([pscustomobject]@{path=$file.path;sha256=$file.sha256}) }
        $writing=$true
        [IO.File]::WriteAllText($pause,'release-v2-helper-update')
        if (-not $RestoreHelpers) {
            $snapshotRoot=Join-Path $root ('helper-backup-'+[Guid]::NewGuid().ToString('N'))
            $null=New-Item -ItemType Directory -Path (Join-Path $snapshotRoot 'operator')
            foreach ($file in $state.files) {
                Assert-OperatorLockOwner $reference.context $owner
                $from=Assert-OperatorPath (Join-Path (Join-Path $root 'operator') $file.name)
                [IO.File]::Copy($from,(Join-Path (Join-Path $snapshotRoot 'operator') $file.name),$false)
            }
            Assert-ReleaseV2InstalledFiles $state $snapshotRoot
            $previousState=if (Test-Path -LiteralPath $statePath) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($statePath)) } else { '' }
            $snapshot=[ordered]@{schemaVersion=1;pointerSha256=$reference.sha256;files=$state.files;previousState=$previousState;previousStateSha256=(Get-ReleaseV2StringHash $previousState);wasPaused=[bool]$wasPaused;pauseBase64=$(if ($wasPaused) {[Convert]::ToBase64String($pauseBytes)} else {''})}
            $snapshotPath=Join-Path $snapshotRoot 'snapshot.json'
            [IO.File]::WriteAllText($snapshotPath,($snapshot|ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
            $state=[pscustomobject]@{schemaVersion=1;files=@($files|ForEach-Object {@{name=$_.name;sha256=$_.sha256}});state='deploying';snapshot=@{path=$snapshotPath;sha256=(Get-ReleaseV2Hash $snapshotPath)}}
            Write-ReleaseV2Journal $statePath $state
        }
        if ($RestoreHelpers) { $state.state='deploying'; Write-ReleaseV2Journal $statePath $state }
        foreach ($file in $files) {
            Assert-OperatorLockOwner $reference.context $owner
            Assert-OperatorPin ([pscustomobject]@{path=$file.path;sha256=$file.sha256})
            $target=Assert-OperatorPath (Join-Path (Join-Path $root 'operator') $file.name)
            [IO.File]::WriteAllBytes($target,[IO.File]::ReadAllBytes($file.path))
            Assert-OperatorPin ([pscustomobject]@{path=$target;sha256=$file.sha256})
        }
        $null=Assert-ReleaseV2SamePointer $reference -ForStop
        $null=Get-ReleaseV2HelperTasks $root $installation
        if ($RestoreHelpers) {
            if ($snapshot.previousState) { [IO.File]::WriteAllBytes($statePath,[Convert]::FromBase64String($snapshot.previousState)) }
            else { Remove-Item -LiteralPath $statePath }
            $wasPaused=[bool]$snapshot.wasPaused; $pauseBytes=[Convert]::FromBase64String($snapshot.pauseBase64)
        } else { $state.state='ready'; Write-ReleaseV2Journal $statePath $state }
        if ($wasPaused) { [IO.File]::WriteAllBytes($pause,$pauseBytes) } else { Remove-Item -LiteralPath $pause }
        [ordered]@{operation=$(if ($RestoreHelpers) {'restore-release-v2-helpers'} else {'update-release-v2-helpers'});files=$files.Count;releaseId=$reference.pointer.releaseId;tasksChanged=0;restart=$false;ownershipHeld=$true;verified=$true}|ConvertTo-Json
    } catch {
        if ($writing) { [IO.File]::WriteAllText((Join-Path $root 'helper-update.failure.txt'),($_.Exception.Message+"`n"+$_.ScriptStackTrace)); throw 'Helper update interrupted; retain snapshots and pause, then use RestoreHelpers after drift review.' }
        throw
    } finally { if ($null -ne $owner) {$owner.Dispose()}; if ($null -ne $tick) {$tick.Dispose()} }
}

function Get-ReleaseV2StringHash([string]$Text) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() } finally {$hash.Dispose()}
}
