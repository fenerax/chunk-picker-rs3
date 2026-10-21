# Release references are single-file atomic commits. Dot-sourcing has no effects.
Set-StrictMode -Version Latest
# Retained helper installations predate frozen activation and need no new file
# for their unchanged rollback/recovery path.
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Frozen-Bundle.ps1')) { . (Join-Path $PSScriptRoot 'Frozen-Bundle.ps1') }

function New-ReleaseV2Clock {
    return [pscustomobject]@{ startedAt=[DateTime]::UtcNow; watch=[Diagnostics.Stopwatch]::StartNew(); phases=[Collections.Generic.List[object]]::new(); phase=$null; phaseStartedAt=$null; phaseElapsed=0.0; result=$null; startupHealth=$null }
}
function Set-ReleaseV2Phase($Clock, [string]$Name) {
    $now = [DateTime]::UtcNow; $elapsed = $Clock.watch.Elapsed.TotalMilliseconds
    if (-not [string]::IsNullOrEmpty($Clock.phase)) { $Clock.phases.Add([ordered]@{phase=$Clock.phase;startedAt=$Clock.phaseStartedAt.ToString('o');endedAt=$now.ToString('o');elapsedMs=[Math]::Round($elapsed-$Clock.phaseElapsed,3)}) }
    $Clock.phase=$Name; $Clock.phaseStartedAt=$now; $Clock.phaseElapsed=$elapsed
    return $Name
}
function Get-ReleaseV2Timings($Clock) {
    $null = Set-ReleaseV2Phase $Clock $null
    $slowest = $null
    foreach ($row in $Clock.phases) { if ($null -eq $slowest -or [double]$row.elapsedMs -gt [double]$slowest.elapsedMs) { $slowest=$row } }
    return [ordered]@{startedAt=$Clock.startedAt.ToString('o');endedAt=[DateTime]::UtcNow.ToString('o');elapsedMs=[Math]::Round($Clock.watch.Elapsed.TotalMilliseconds,3);slowestPhase=$(if($slowest){$slowest.phase}else{$null});phases=@($Clock.phases.ToArray());startupHealth=$Clock.startupHealth}
}

function Write-ReleaseV2ActivationReceipt([string]$ReleaseRoot, $Clock, $Result) {
    # Best-effort diagnostics may never replace the original refusal or prevent
    # restoration. Keep the stable receipt outside every sealed payload root.
    try {
        $root = Assert-OperatorPath $ReleaseRoot -Directory
        $local = Join-Path $root '.local'
        if (-not (Test-Path -LiteralPath $local)) { $null=New-Item -Path $local -ItemType Directory }
        $local = Assert-OperatorPath $local -Directory
        $Result.timings = Get-ReleaseV2Timings $Clock
        Write-ReleaseV2Journal (Join-Path $local 'activation-phases.json') $Result
        Write-Output ('Release timing totalSeconds ' + ([Math]::Round($Result.timings.elapsedMs / 1000, 3)).ToString([Globalization.CultureInfo]::InvariantCulture) + ' slowestPhase ' + $Result.timings.slowestPhase)
    } catch { }
}

function Invoke-ReleaseV2Managed([string]$CurrentRelease, [string]$CandidatePointer,
    [string]$CompanionRoot, [string]$Receipt, [string]$ReleaseRoot, [switch]$Rollback, [switch]$Recover, [switch]$DryRun, [int]$TimeoutSeconds = 60,
    [string]$PackCheckTool, [string]$PackCheckSha256, [string]$PackCheckIdentitySha256, [string]$FrozenSeal, [string]$FrozenSealSha256) {
    $bundle=$null; $clock=New-ReleaseV2Clock
    $null=Set-ReleaseV2Phase $clock 'preflight'
    $prior = Get-Variable -Name ReleaseV2FrozenPins -Scope Script -ErrorAction SilentlyContinue
    $priorPins = if ($null -ne $prior) { $prior.Value } else { $null }
    try {
        if ($FrozenSeal -or $FrozenSealSha256) {
            if (-not $FrozenSeal -or -not $FrozenSealSha256 -or $Rollback -or $Recover) { throw 'Frozen activation requires a forward release and both seal pins.' }
            $null=Set-ReleaseV2Phase $clock 'frozen-input-validation'
            $bundle=Open-ReleaseV2FrozenBundle $FrozenSeal $FrozenSealSha256
            $script:ReleaseV2FrozenPins=$bundle.files
            $null=Set-ReleaseV2Phase $clock 'preflight'
        }
        $parameters=@{}; foreach($key in $PSBoundParameters.Keys){if($key -notin @('FrozenSeal','FrozenSealSha256')){$parameters[$key]=$PSBoundParameters[$key]}}
        Invoke-ReleaseV2ManagedCore @parameters -FrozenBundle $bundle -PhaseClock $clock
        if (-not $DryRun) {
            Write-ReleaseV2ActivationReceipt $ReleaseRoot $clock $clock.result
        }
    } catch {
        if (-not $DryRun) {
            if ($null -eq $clock.result) { $clock.result=[ordered]@{phase=$clock.phase;storageChangesStarted=$false;previousReleaseRestored=$false;refused=$true;frozen=($null -ne $bundle)} }
            Write-ReleaseV2ActivationReceipt $ReleaseRoot $clock $clock.result
        }
        throw
    } finally { $script:ReleaseV2FrozenPins=$priorPins; if ($null -ne $bundle) { Close-ReleaseV2FrozenBundle $bundle } }
}

# An absent file is a valid observed state, compared as null.
function Get-ReleaseV2OptionalHash([string]$Path) { if (Test-Path -LiteralPath $Path) { return Get-ReleaseV2Hash (Assert-OperatorPath $Path) }; return $null }

function Get-ReleaseV2Hash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Read-ReleaseV2Pointer([string]$Path, [switch]$ForStop) {
    $file = Assert-OperatorPath $Path
    if ((Get-Item -LiteralPath $file).Length -gt 16384) { throw 'Release pointer is oversized.' }
    $hash = Get-ReleaseV2Hash $file
    $pointer = Read-OperatorJson $file
    Assert-OperatorFields $pointer @('schemaVersion', 'releaseId', 'config')
    if ($pointer.schemaVersion -ne 2 -or $pointer.releaseId -isnot [string] -or $pointer.releaseId -cnotmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$') { throw 'Invalid release pointer.' }
    Assert-OperatorPin $pointer.config
    $context = Read-OperatorConfig $pointer.config.path -ForStop:$ForStop
    Assert-OperatorPin $pointer.config
    if ((Get-ReleaseV2Hash $file) -cne $hash) { throw 'Release pointer changed while resolving.' }
    return [pscustomobject]@{ path = $file; sha256 = $hash; pointer = $pointer; context = $context }
}

function Assert-ReleaseV2SamePointer($Expected, [switch]$ForStop) {
    $current = Read-ReleaseV2Pointer $Expected.path -ForStop:$ForStop
    if ($current.sha256 -cne $Expected.sha256 -or $current.context.configHash -cne $Expected.context.configHash) { throw 'Release reference or origin changed.' }
    return $current
}

function Assert-ReleaseV2Transition($Candidate, $Previous, [switch]$PackUpgrade) {
    foreach ($key in 'nodePath', 'dataDir', 'host', 'port', 'loopbackPort', 'publicOriginFile') {
        if ($Candidate.config.$key -ine $Previous.config.$key) { throw 'Release must retain executable, storage, listeners, origin and packs.' }
    }
    if ($Candidate.origin -cne $Previous.origin) { throw 'Release origin changed.' }
    if ($Candidate.config.packsDir -ine $Previous.config.packsDir -and $Candidate.config.selection.path -ieq $Previous.config.selection.path) { throw 'Pack root changed without an independent selection.' }
    foreach ($pin in @('selection')) {
        if (-not $PackUpgrade -and $Candidate.config.$pin.sha256 -cne $Previous.config.$pin.sha256) { throw 'Release selection changed.' }
    }
    foreach ($kind in 'data', 'rulesText', 'art') {
        if (-not $PackUpgrade -and $Candidate.config.packs.$kind.sha256 -cne $Previous.config.packs.$kind.sha256) { throw 'Release pack changed.' }
    }
}

function Write-ReleaseV2Journal([string]$Path, $Journal) {
    $temp = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Journal | ConvertTo-Json -Depth 15))
        $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, ($Path + '.' + [Guid]::NewGuid().ToString('N') + '.previous')) }
        else { [IO.File]::Move($temp, $Path) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
}

function Set-ReleaseV2Binding([string]$Path, [string]$Expected, [byte[]]$Bytes, [string]$Target, [ref]$StorageChangesStarted) {
    $null = Assert-OperatorPath $Path
    if ((Get-ReleaseV2Hash $Path) -cne $Expected) { throw 'Binding compare-and-swap refused.' }
    $temp = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        $stream = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if ((Get-ReleaseV2Hash $temp) -cne $Target -or (Get-ReleaseV2Hash $Path) -cne $Expected) { throw 'Binding changed before replacement.' }
        # Pre-commit refusals above are recoverable; the atomic replacement may
        # mutate the binding even if the filesystem subsequently reports failure.
        if ($null -ne $StorageChangesStarted) { $StorageChangesStarted.Value = $true }
        [IO.File]::Replace($temp, $Path, ($Path + '.' + [Guid]::NewGuid().ToString('N') + '.previous'))
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
}

function Invoke-ReleaseV2PackCheck($Context, [string]$Tool, [string]$From, [string]$To, [string]$Transition, [string]$Output) {
    & $Context.config.nodePath $Tool check $From $To $Transition $Output *> ($Output + '.log')
    if ($LASTEXITCODE -ne 0) { throw 'Current save is incompatible with a retained selection.' }
    $result = Read-OperatorJson $Output
    if (-not $result.passed -or (-not $result.bothDirections -and -not ($result.PSObject.Properties.Name -contains 'rollbackTargetOpened' -and $result.rollbackTargetOpened))) { throw 'Required current-save evidence is absent.' }
}

function Assert-ReleaseV2CandidateLayout($Reference) {
    $directory = Split-Path -Parent $Reference.pointer.config.path
    if ($Reference.context.config.coreRoot -ine (Join-Path $directory 'core') -or
        (Split-Path -Parent $Reference.path) -ine $directory) { throw 'Candidate must retain an independent release root.' }
}

function Set-ReleaseV2Pointer($Previous, $Candidate, [ref]$StorageChangesStarted) {
    $null = Assert-ReleaseV2SamePointer $Previous -ForStop
    $null = Assert-ReleaseV2SamePointer $Candidate
    $temporary = $Previous.path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    # Never overwrite retained history. One atomic replacement commits config and identity together.
    $backup = $Previous.path + '.' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffff') + '-' + [Guid]::NewGuid().ToString('N') + '.previous'
    try {
        $bytes = [IO.File]::ReadAllBytes($Candidate.path)
        $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        if ((Get-ReleaseV2Hash $temporary) -cne $Candidate.sha256) { throw 'Candidate changed before pointer commit.' }
        if ($null -ne $StorageChangesStarted) { $StorageChangesStarted.Value = $true }
        [IO.File]::Replace($temporary, $Previous.path, $backup)
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}

function Assert-ReleaseV2AuthenticatedReady($Context, [int]$TimeoutSeconds) {
    $token = Get-OperatorToken $Context
    $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (Test-Path -LiteralPath $Context.runtimeFile) {
            $record = Read-OperatorJson $Context.runtimeFile
            if (Test-OperatorListeners $Context $record) {
                $health = $null
                try { $health = Invoke-RestMethod -Uri "http://$($Context.config.host):$($Context.config.port)/api/health" -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 1 } catch { }
                if ($health -and $health.ready -and (Test-OperatorListeners $Context $record)) {
                    $record.state = 'running'; Write-OperatorRuntime $Context $record
                    return
                }
            }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $until)
    throw 'Previous release authenticated readiness timed out.'
}

function Invoke-ReleaseV2ManagedCore([string]$CurrentRelease, [string]$CandidatePointer,
    [string]$CompanionRoot, [string]$Receipt, [string]$ReleaseRoot, [switch]$Rollback, [switch]$Recover, [switch]$DryRun, [int]$TimeoutSeconds = 60,
    [string]$PackCheckTool, [string]$PackCheckSha256, [string]$PackCheckIdentitySha256, $FrozenBundle, $PhaseClock) {
    $live = Read-ReleaseV2Pointer $CurrentRelease -ForStop
    $previous = $live
    $candidate = Read-ReleaseV2Pointer $CandidatePointer
    $journalPath = Join-Path $previous.context.localDir 'release-pack-transition.json'
    $journal = $null
    $journalBefore = $null
    $journalBeforeHash = $null
    $reversePending = $false
    if (Test-Path -LiteralPath $journalPath) {
        $null = Assert-OperatorPath $journalPath
        $journalBefore = [IO.File]::ReadAllBytes($journalPath)
        $hash = [Security.Cryptography.SHA256]::Create()
        try { $journalBeforeHash = ([BitConverter]::ToString($hash.ComputeHash($journalBefore))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
        if ((Get-ReleaseV2Hash $journalPath) -cne $journalBeforeHash) { throw 'Pack journal changed while resolving.' }
        $journal = Read-OperatorJson $journalPath
        if ((Get-ReleaseV2Hash $journalPath) -cne $journalBeforeHash) { throw 'Pack journal changed while resolving.' }
        if ($Recover) {
            if ($journal.currentPointer -ine $CurrentRelease -or $journal.candidatePointer -ine $CandidatePointer -or [bool]$journal.rollback -ne [bool]$Rollback) { throw 'Recovery does not identify the interrupted transaction.' }
            $previous = Read-ReleaseV2Pointer $journal.sourcePointer -ForStop
            if ($previous.sha256 -cne $journal.sourcePointerSha256 -or $candidate.sha256 -cne $journal.targetPointerSha256) { throw 'Recovery references changed.' }
        } elseif ($journal.state -ne 'ready') {
            if (-not $Rollback -or $journal.rollback -or $journal.currentPointer -ine $CurrentRelease) { throw 'Pending pack transition requires explicit recovery before any Start.' }
            # A failed forward Start must not force another forward Start before
            # rollback. Preserve its journal and use the retained new pointer as
            # the logical source, even when the observed pointer is still old.
            $source = Read-ReleaseV2Pointer $journal.sourcePointer -ForStop
            $forward = Read-ReleaseV2Pointer $journal.candidatePointer
            if ($source.sha256 -cne $journal.sourcePointerSha256 -or $forward.sha256 -cne $journal.targetPointerSha256 -or $candidate.sha256 -cne $source.sha256) { throw 'Pending rollback does not identify the original pair.' }
            Assert-OperatorPin $journal.transition
            $previous = $forward
            $reversePending = $true
        }
    } elseif ($Recover) { throw 'No pack journal to recover.' }
    if ($previous.path -ieq $candidate.path) { throw 'Candidate reference must be independent of the current pointer.' }
    Assert-ReleaseV2CandidateLayout $candidate
    $packUpgrade = $candidate.context.config.selection.sha256 -cne $previous.context.config.selection.sha256
    foreach ($kind in 'data','rulesText','art') { if ($candidate.context.config.packs.$kind.sha256 -cne $previous.context.config.packs.$kind.sha256) { $packUpgrade = $true } }
    Assert-ReleaseV2Transition $candidate.context $previous.context -PackUpgrade:$packUpgrade
    $companion = Assert-OperatorPath $CompanionRoot -Directory
    $release = Assert-OperatorPath $ReleaseRoot -Directory
    if ((Split-Path -Parent $candidate.pointer.config.path) -ine $release) { throw 'Release root differs from candidate configuration.' }
    $receiptPath = Assert-OperatorPath $Receipt
    $receiptHash = Get-ReleaseV2Hash $receiptPath
    $verify = Assert-OperatorPath (Join-Path $companion 'tools/verify-install.mjs')
    $identity = Assert-OperatorPath (Join-Path $companion 'tools/release-v2.mjs')
    $targetKit = Split-Path -Parent (Split-Path -Parent $release)
    # Old retained kits keep their original verification tooling and evidence.
    $verificationCompanion = if ($Rollback) { $targetKit } else { $companion }
    if ($null -ne $FrozenBundle) {
        Assert-ReleaseV2FrozenBundle $FrozenBundle $candidate $previous $receiptPath $release $verificationCompanion $live.sha256
        $null=Set-ReleaseV2Phase $PhaseClock 'frozen-platform-validation'
        $platformTool = Join-Path $verificationCompanion 'tools/frozen-release.mjs'
        Invoke-OperatorForeground $candidate.context.config.nodePath ('"' + $platformTool + '" platform ' + $FrozenBundle.seal.platformDigest) 120
        $null=Set-ReleaseV2Phase $PhaseClock 'preflight'
    }
    $transitionPath = if ($Rollback) { Join-Path (Split-Path -Parent $previous.pointer.config.path) 'pack-transition.json' } else { Join-Path $release 'pack-transition.json' }
    if ($Recover) { $transitionPath = $journal.transition.path }
    $transition = $null
    if ($packUpgrade) {
        $transitionPath = Assert-OperatorPath $transitionPath
        $transition = Read-OperatorJson $transitionPath
        $from = if ($Rollback) { $transition.newConfig } else { $transition.oldConfig }
        $to = if ($Rollback) { $transition.oldConfig } else { $transition.newConfig }
        Assert-OperatorPin $from; Assert-OperatorPin $to
        if ($from.path -ine $previous.pointer.config.path -or $from.sha256 -cne $previous.pointer.config.sha256 -or $to.path -ine $candidate.pointer.config.path -or $to.sha256 -cne $candidate.pointer.config.sha256) { throw 'Pack transition config pair differs.' }
        if ($Recover -or $reversePending) {
            Assert-OperatorPin $journal.transition
            if ($journal.transition.path -ine $transitionPath) { throw 'Pending transition evidence differs.' }
        }
    } elseif ($Recover) { throw 'Recovery requires a pack transition.' }
    $externalCheck = $null
    if ($PackCheckTool -or $PackCheckSha256 -or $PackCheckIdentitySha256) {
        if (-not $PackCheckTool -or $PackCheckSha256 -cnotmatch '^[a-f0-9]{64}$' -or $PackCheckIdentitySha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'External pack checker requires both exact module hashes.' }
        $externalCheck = Assert-OperatorPath $PackCheckTool
        Assert-OperatorPin ([pscustomobject]@{path=$externalCheck;sha256=$PackCheckSha256})
        Assert-OperatorPin ([pscustomobject]@{path=(Join-Path (Split-Path -Parent $externalCheck) 'release-identity.mjs');sha256=$PackCheckIdentitySha256})
        if ($null -ne $FrozenBundle) {
            Assert-ReleaseV2FrozenPin $FrozenBundle ([pscustomobject]@{path=$externalCheck;sha256=$PackCheckSha256})
            Assert-ReleaseV2FrozenPin $FrozenBundle ([pscustomobject]@{path=(Join-Path (Split-Path -Parent $externalCheck) 'release-identity.mjs');sha256=$PackCheckIdentitySha256})
        }
    }
    if ($DryRun) {
        [ordered]@{ operation = 'release-v2'; dryRun = $true; releaseId = $candidate.pointer.releaseId;
            rollback = [bool]$Rollback; stages = @('pause', 'identity-and-gates', 'owned-stop', 'verify-install', 'identity-and-gates', 'atomic-pointer', 'identity-and-gates', 'owned-start', 'authenticated-readiness') } | ConvertTo-Json
        return
    }
    $tick = $null; $owner = $null; $paused = $false; $log = $null
    $phase = Set-ReleaseV2Phase $PhaseClock 'ownership'; $ownedJournalHash = $null
    # An interrupted transaction may already have changed storage in a prior run.
    $storageChangesStarted = [bool]($Recover -or $reversePending)
    $bindingBeforeHash = $null
    $bindingPath = $previous.context.config.dataDir + '.dataset.json'
    try {
        $tick = [IO.File]::Open((Join-Path $previous.context.localDir 'watchdog-tick.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $owner = Enter-OperatorLock $previous.context
        $null = Assert-ReleaseV2SamePointer $live -ForStop
        $null = Assert-ReleaseV2SamePointer $candidate
        Assert-ReleaseV2Transition $candidate.context $previous.context -PackUpgrade:$packUpgrade
        $phase = Set-ReleaseV2Phase $PhaseClock 'pause'
        $observedJournalHash = if (Test-Path -LiteralPath $journalPath) { Get-ReleaseV2Hash $journalPath } else { $null }
        if ($observedJournalHash -cne $journalBeforeHash) { throw 'Pack journal changed before ownership.' }
        $bindingBeforeHash = Get-ReleaseV2OptionalHash $bindingPath
        $paused = $true
        Set-Content -LiteralPath (Join-Path $previous.context.localDir 'picker-paused') -Value ([DateTime]::UtcNow.ToString('o'))
        $logs = Join-Path $companion '.local'
        if (-not (Test-Path -LiteralPath $logs)) { $null = New-Item -ItemType Directory -Path $logs }
        $logs = Assert-OperatorPath $logs -Directory
        $log = Join-Path $logs ('release-v2-verify-' + [Guid]::NewGuid().ToString('N') + '.log')
        $identityArguments = @('assert-identity', '--kit', $verificationCompanion, '--release', $release)
        if (-not $Recover) { $identityArguments += @('--current', $CurrentRelease) }
        if ($Rollback) { $identityArguments += '--rollback' }
        $phase = Set-ReleaseV2Phase $PhaseClock 'identity-before-stop'
        if ($null -ne $FrozenBundle) { Assert-ReleaseV2FrozenInventory $FrozenBundle }
        else {
            & $candidate.context.config.nodePath $identity @identityArguments *> $log
            if ($LASTEXITCODE -ne 0) { throw 'Release identity or gate evidence refused before Stop.' }
        }
        # Recovery stops only the runtime named by the currently observed pointer.
        $phase = Set-ReleaseV2Phase $PhaseClock 'owned-stop'
        Stop-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner
        Assert-OperatorStoreReleased $live.context
        if (-not $Recover -and -not $packUpgrade -and $null -ne $journal) {
            Assert-OperatorPackJournal $live.context
        }
        $phase = Set-ReleaseV2Phase $PhaseClock 'verify-install'
        if ($null -eq $FrozenBundle) {
            & $candidate.context.config.nodePath $verify --core $candidate.context.config.coreRoot --companion $verificationCompanion --receipt $receiptPath *> $log
            if ($LASTEXITCODE -ne 0) { throw 'Installation verification refused.' }
        }
        $phase = Set-ReleaseV2Phase $PhaseClock 'references-after-stop'
        $null = Assert-ReleaseV2SamePointer $live -ForStop
        $null = Assert-ReleaseV2SamePointer $candidate
        if ((Get-ReleaseV2Hash $receiptPath) -cne $receiptHash) { throw 'Installation receipt changed.' }
        $phase = Set-ReleaseV2Phase $PhaseClock 'identity-after-stop'
        if ($null -eq $FrozenBundle) {
            & $candidate.context.config.nodePath $identity @identityArguments *>> $log
            if ($LASTEXITCODE -ne 0) { throw 'Release identity or gate evidence changed after Stop.' }
        }
        if ($packUpgrade) {
            Assert-OperatorLockOwner $previous.context $owner
            $phase = Set-ReleaseV2Phase $PhaseClock 'pack-check'
            $check = if ($externalCheck) { $externalCheck } else { Assert-OperatorPath (Join-Path $companion 'tools/release-pack-check.mjs') }
            if ($externalCheck) {
                Assert-OperatorPin ([pscustomobject]@{path=$externalCheck;sha256=$PackCheckSha256})
                Assert-OperatorPin ([pscustomobject]@{path=(Join-Path (Split-Path -Parent $externalCheck) 'release-identity.mjs');sha256=$PackCheckIdentitySha256})
            }
            $evidence = Join-Path $logs ('pack-compatibility-' + [Guid]::NewGuid().ToString('N') + '.json')
            Invoke-ReleaseV2PackCheck $candidate.context $check $previous.pointer.config.path $candidate.pointer.config.path $transitionPath $evidence
            Assert-OperatorStoreReleased $live.context
            Assert-OperatorLockOwner $previous.context $owner
            $phase = Set-ReleaseV2Phase $PhaseClock 'pre-commit-validation'
            $oldHash = if ($Rollback) { $transition.new.bindingSha256 } else { $transition.old.bindingSha256 }
            $newHash = if ($Rollback) { $transition.old.bindingSha256 } else { $transition.new.bindingSha256 }
            if (-not $Recover) {
                if ($reversePending) {
                    $observedBinding = Get-ReleaseV2Hash $bindingPath
                    $observedPointer = Get-ReleaseV2Hash $CurrentRelease
                    if ($observedBinding -notin @($transition.old.bindingSha256,$transition.new.bindingSha256) -or $observedPointer -notin @($journal.sourcePointerSha256,$journal.targetPointerSha256) -or ($observedPointer -ceq $journal.targetPointerSha256 -and $observedBinding -cne $transition.new.bindingSha256)) { throw 'Unknown interrupted forward pair; rollback paused.' }
                } elseif ((Get-ReleaseV2Hash $bindingPath) -cne $oldHash) { throw 'Binding changed before journal.' }
                $sourcePointer = $journalPath + '.' + [Guid]::NewGuid().ToString('N') + '.source-pointer.json'
                [IO.File]::Copy($previous.path, $sourcePointer, $false)
                $journal = [pscustomobject]@{ schemaVersion=1; state='journaled'; currentPointer=$CurrentRelease; candidatePointer=$CandidatePointer;
                    sourcePointer=$sourcePointer; sourcePointerSha256=$previous.sha256; targetPointerSha256=$candidate.sha256; rollback=[bool]$Rollback;
                    allowInversePartial=[bool]$reversePending;
                    transition=[pscustomobject]@{path=$transitionPath;sha256=(Get-ReleaseV2Hash $transitionPath)}; fromBindingSha256=$oldHash; toBindingSha256=$newHash;
                    evidence=[pscustomobject]@{path=$evidence;sha256=(Get-ReleaseV2Hash $evidence)} }
                $phase = Set-ReleaseV2Phase $PhaseClock 'journal-intent'
                $journalBytes = [Text.UTF8Encoding]::new($false).GetBytes(($journal | ConvertTo-Json -Depth 15))
                $hash = [Security.Cryptography.SHA256]::Create()
                try { $ownedJournalHash = ([BitConverter]::ToString($hash.ComputeHash($journalBytes))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
                Write-ReleaseV2Journal $journalPath $journal
            }
            # Recovery validates the latest save, which may include writes made
            # during the interrupted Start. Retain that exact fresh proof too.
            $journal.evidence = [pscustomobject]@{path=$evidence;sha256=(Get-ReleaseV2Hash $evidence)}
            $phase = Set-ReleaseV2Phase $PhaseClock 'pre-commit-validation'
            Assert-OperatorPin $journal.transition
            $bindingHash = Get-ReleaseV2Hash $bindingPath
            $pointerHash = Get-ReleaseV2Hash $CurrentRelease
            if ($bindingHash -notin @($oldHash,$newHash) -or $pointerHash -notin @($previous.sha256,$candidate.sha256)) { throw 'Unknown binding/pointer pair; recovery paused.' }
            $inverseAllowed = $journal.PSObject.Properties.Name -contains 'allowInversePartial' -and $journal.allowInversePartial -and $Rollback
            if ($pointerHash -ceq $candidate.sha256 -and $bindingHash -cne $newHash -and -not $inverseAllowed) { throw 'Impossible binding/pointer pair; recovery paused.' }
            if ($bindingHash -cne $newHash) {
                $bytes = if ($Rollback) { [Convert]::FromBase64String($transition.oldBindingBase64) } else { [Convert]::FromBase64String($transition.newBindingBase64) }
                # The setters mark the boundary immediately before atomic replacement,
                # after every recoverable pin, payload and compare-and-swap refusal.
                $phase = Set-ReleaseV2Phase $PhaseClock 'binding-commit'
                Set-ReleaseV2Binding $bindingPath $oldHash $bytes $newHash ([ref]$storageChangesStarted)
            }
            $journal.state='binding-swapped'
            if (-not $storageChangesStarted) {
                $journalBytes = [Text.UTF8Encoding]::new($false).GetBytes(($journal | ConvertTo-Json -Depth 15))
                $hash = [Security.Cryptography.SHA256]::Create()
                try { $ownedJournalHash = ([BitConverter]::ToString($hash.ComputeHash($journalBytes))).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
            }
            Write-ReleaseV2Journal $journalPath $journal
        }
        if ((Get-ReleaseV2Hash $CurrentRelease) -cne $candidate.sha256) {
            $phase = Set-ReleaseV2Phase $PhaseClock 'pointer-commit'
            if (-not $Recover -and -not $packUpgrade -and $null -ne $journal) {
                Assert-OperatorPackJournal $live.context
            }
            Set-ReleaseV2Pointer $live $candidate ([ref]$storageChangesStarted)
            if (-not $Recover -and -not $packUpgrade -and $null -ne $journal) {
                [IO.File]::Move($journalPath, ($journalPath + '.' + [Guid]::NewGuid().ToString('N') + '.completed.json'))
            }
        }
        if ($packUpgrade) { $journal.state='pointer-swapped'; Write-ReleaseV2Journal $journalPath $journal }
        $finalIdentityArguments = @('assert-identity', '--kit', $verificationCompanion, '--release', $release)
        if ($Rollback) { $finalIdentityArguments += '--rollback' }
        $phase = Set-ReleaseV2Phase $PhaseClock 'identity-before-start'
        if ($null -ne $FrozenBundle) { Assert-ReleaseV2FrozenInventory $FrozenBundle }
        else {
            & $candidate.context.config.nodePath $identity @finalIdentityArguments *>> $log
            if ($LASTEXITCODE -ne 0) { throw 'Release identity or gate evidence changed before Start.' }
        }
        if ($packUpgrade) { $journal.state='starting'; Write-ReleaseV2Journal $journalPath $journal }
        $phase = Set-ReleaseV2Phase $PhaseClock 'candidate-start-readiness'
        if ($packUpgrade) { Start-OperatorCore $candidate.context $TimeoutSeconds -PreservePause -LockOwner $owner -PackTransitionReady -PhaseClock $PhaseClock }
        else { Start-OperatorCore $candidate.context $TimeoutSeconds -PreservePause -LockOwner $owner -PhaseClock $PhaseClock }
        $phase = Set-ReleaseV2Phase $PhaseClock 'post-start-validation'
        $committed = Read-ReleaseV2Pointer $CurrentRelease
        if ($committed.sha256 -cne $candidate.sha256) { throw 'Committed release changed during startup.' }
        if ($packUpgrade) {
            if ((Get-ReleaseV2Hash $bindingPath) -cne $newHash) { throw 'Binding changed during startup.' }
            $journal.state='ready'; Write-ReleaseV2Journal $journalPath $journal
        }
        $phase = Set-ReleaseV2Phase $PhaseClock 'rollback-readiness'
        if ($null -ne $FrozenBundle) {
            Assert-ReleaseV2FrozenInventory $FrozenBundle
            $retained = Read-ReleaseV2Pointer $FrozenBundle.seal.rollback.pointer.path
            if ($retained.sha256 -cne $previous.sha256 -or $retained.context.configHash -cne $previous.context.configHash) { throw 'Retained rollback reference changed.' }
            Assert-ReleaseV2Transition $candidate.context $retained.context -PackUpgrade:$packUpgrade
            Assert-ReleaseV2FrozenPin $FrozenBundle $FrozenBundle.seal.rollback.config
            if ($packUpgrade) {
                # The latest save was opened both ways while stopped. Reopening
                # it here would contend with the new writer's exclusive lock.
                Assert-OperatorPin $journal.evidence
                $compatibility = Read-OperatorJson $journal.evidence.path
                if (-not $compatibility.passed -or -not $compatibility.bothDirections) { throw 'Retained rollback compatibility evidence is incomplete.' }
            }
        }
        $phase = Set-ReleaseV2Phase $PhaseClock 'unpause'
        # The release is committed and ready; a diagnostic write must not refuse it.
        $PhaseClock.result=[ordered]@{phase='ready';storageChangesStarted=$storageChangesStarted;previousReleaseRestored=$false;refused=$false;frozen=($null -ne $FrozenBundle)}
        Remove-Item -LiteralPath (Join-Path $candidate.context.localDir 'picker-paused')
        try { $PhaseClock.result.timings=Get-ReleaseV2Timings $PhaseClock; Write-ReleaseV2Journal ($log + '.result.json') $PhaseClock.result } catch { }
        Write-Output 'Managed release is ready; current pointer and runtime agree.'
    } catch {
        # Diagnostic IO must never prevent the service restoration attempt.
        if ($null -ne $log) { try { [IO.File]::WriteAllText(($log + '.failure.txt'), ($_.Exception.Message + "`n" + $_.ScriptStackTrace)) } catch { } }
        $refusalPhase = $phase
        $null = Set-ReleaseV2Phase $PhaseClock 'refusal-restoration'
        $restored = $false
        if ($paused -and -not $storageChangesStarted) {
            try {
                Assert-OperatorLockOwner $live.context $owner
                $null = Assert-ReleaseV2SamePointer $live -ForStop
                if ((Get-ReleaseV2OptionalHash $bindingPath) -cne $bindingBeforeHash) { throw 'Storage binding changed outside this handover.' }
                # Undo only our uncommitted intent; retain its bytes as refusal evidence.
                $actualJournalHash = if (Test-Path -LiteralPath $journalPath) { Get-ReleaseV2Hash $journalPath } else { $null }
                if ($actualJournalHash -cne $journalBeforeHash) {
                    if (-not $ownedJournalHash -or $actualJournalHash -cne $ownedJournalHash) { throw 'Unrecognized journal during restoration.' }
                    $retained = $journalPath + '.' + [Guid]::NewGuid().ToString('N') + '.refused'
                    if ($null -ne $journalBefore) {
                        $temporary = $retained + '.tmp'
                        try { [IO.File]::WriteAllBytes($temporary,$journalBefore); [IO.File]::Replace($temporary,$journalPath,$retained) }
                        finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
                    } else { [IO.File]::Move($journalPath,$retained) }
                }
                # A failed Stop may retain an exited runtime record. Clean only the
                # exact previous writer's record before starting its own configuration.
                if (Test-Path -LiteralPath $live.context.runtimeFile) {
                    $runtime = Read-OperatorJson $live.context.runtimeFile
                    if (-not (Get-OperatorOwnedProcess $live.context $runtime)) { Stop-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner }
                }
                Start-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner
                Assert-ReleaseV2AuthenticatedReady $live.context $TimeoutSeconds
                $null = Assert-ReleaseV2SamePointer $live -ForStop
                if ((Get-ReleaseV2OptionalHash $bindingPath) -cne $bindingBeforeHash) { throw 'Storage binding changed during restoration.' }
                $pausePath = Join-Path $live.context.localDir 'picker-paused'
                if (Test-Path -LiteralPath $pausePath) { Remove-Item -LiteralPath $pausePath }
                $restored = $true
            } catch {
                if ($null -ne $log) { try { [IO.File]::WriteAllText(($log + '.restore-failure.txt'), ($_.Exception.Message + "`n" + $_.ScriptStackTrace)) } catch { } }
            }
        }
        $PhaseClock.result=[ordered]@{phase=$refusalPhase;storageChangesStarted=$storageChangesStarted;previousReleaseRestored=$restored;refused=$true;frozen=($null -ne $FrozenBundle)}
        if ($null -ne $log) { try { $PhaseClock.result.timings=Get-ReleaseV2Timings $PhaseClock; Write-ReleaseV2Journal ($log + '.result.json') $PhaseClock.result } catch { } }
        if ($restored) { throw ('Managed release refused, previous release restored; phase=' + $refusalPhase + '. Authenticated readiness passed; watchdog pause cleared.') }
        if ($paused) { throw ('Managed release refused; phase=' + $refusalPhase + '; storageChangesStarted=' + $storageChangesStarted + '. Watchdog remains paused; inspect retained recovery evidence.') }
        throw ('Managed release could not obtain ownership or validate its references; phase=' + $refusalPhase + '.')
    } finally { if ($null -ne $owner) { $owner.Dispose() }; if ($null -ne $tick) { $tick.Dispose() } }
}
