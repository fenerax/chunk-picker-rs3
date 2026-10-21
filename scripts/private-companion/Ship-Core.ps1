# Ongoing releases after the initial M7 operator handover. No Git mutation.
param([Parameter(Mandatory=$true)][string]$Config,
    [string]$PreviousConfig,
    [Parameter(Mandatory=$true)][string]$CoreRoot,
    [Parameter(Mandatory=$true)][string]$CompanionRoot,
    [Parameter(Mandatory=$true)][string]$HeavyLock,
    [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')

function Get-ReleaseRevision([string]$Root) {
    $revision = @(& git --no-optional-locks -c core.fsmonitor=false -C $Root rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $revision.Count -ne 1 -or $revision[0] -cnotmatch '^[a-f0-9]{40,64}$') { throw 'Invalid core revision.' }
    $dirty = @(& git --no-optional-locks -c core.fsmonitor=false -C $Root status --porcelain --untracked-files=no 2>$null)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count) { throw 'Core tracked files must be clean.' }
    $null = & git --no-optional-locks -c core.fsmonitor=false -C $Root ls-files --error-unmatch -- app/server.mjs scripts/test.mjs 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Core entrypoints must be tracked.' }
    return [string]$revision[0]
}

function Assert-ReleaseInputs($Context, [string]$Root, [string]$Companion) {
    if ($Context.config.coreRoot -ine $Root) { throw 'Configured core differs from release core.' }
    $receiptPath = Assert-OperatorPath (Join-Path $Companion 'companion.json')
    $receipt = Read-OperatorJson $receiptPath
    if ($receipt.schemaVersion -ne 1 -or (Assert-OperatorAbsolute $receipt.coreRoot) -ine $Root) { throw 'Companion core differs from release core.' }
    if (-not $Context.config.profile -or -not $Context.config.addons -or $Context.config.profile.sha256 -cne $receipt.profile.sha256 -or $Context.config.addons.sha256 -cne $receipt.addons.sha256) { throw 'Companion profile/addon differs from configured pins.' }
    foreach ($kind in 'data', 'rulesText', 'art') {
        if ($Context.config.packs.$kind.sha256 -cne $receipt.packs.$kind.sha256) { throw 'Companion pack differs from configured pin.' }
    }
}

function Invoke-ReleaseStage([string]$Name, [string]$Executable, [string[]]$Arguments, [string]$LogDirectory) {
    Write-Output "Release stage: $Name"
    # Tests and application tools can print private identities or links. Keep terminal output bounded.
    & $Executable @Arguments *> (Join-Path $LogDirectory ($Name + '.log'))
    if ($LASTEXITCODE -ne 0) { throw 'Release stage failed.' }
}

function Assert-ReleaseTransition($Candidate, $Previous) {
    # Ship is an ongoing release in one checkout. Cross-root cutover/rollback has a separate procedure.
    foreach ($key in 'coreRoot', 'dataDir', 'host', 'port', 'loopbackPort', 'publicOriginFile', 'packsDir') {
        if ($Candidate.config.$key -ine $Previous.config.$key) { throw 'Release must retain core, storage, listeners, origin and packs.' }
    }
    if ($Candidate.origin -cne $Previous.origin -or $Candidate.config.selection.path -ine $Previous.config.selection.path -or $Candidate.config.selection.sha256 -cne $Previous.config.selection.sha256) { throw 'Release must retain exact origin and selection.' }
    foreach ($kind in 'data', 'rulesText', 'art') {
        if ($Candidate.config.packs.$kind.path -ine $Previous.config.packs.$kind.path -or $Candidate.config.packs.$kind.sha256 -cne $Previous.config.packs.$kind.sha256) { throw 'Release must retain each pinned pack.' }
    }
    # Profile/addon pins may advance. The unchanged previous config still identifies the running writer.
}

function Assert-ReleaseContextsUnchanged($Candidate, $Previous, [string]$CandidatePath, [string]$PreviousPath, [string]$Root, [string]$Companion) {
    $current = Read-OperatorConfig $CandidatePath
    $stopping = Read-OperatorConfig $PreviousPath -ForStop
    if ($current.configHash -cne $Candidate.configHash -or $stopping.configHash -cne $Previous.configHash) { throw 'Candidate or previous configuration changed during release.' }
    Assert-ReleaseInputs $current $Root $Companion
    Assert-ReleaseTransition $current $stopping
}

$stage = 'preflight'
try {
    $context = Read-OperatorConfig $Config
    $stopSelection = if ($PreviousConfig) { 'previous' } else { 'candidate' }
    if (-not $PreviousConfig) { $PreviousConfig = $Config }
    $stopContext = Read-OperatorConfig $PreviousConfig -ForStop
    $core = Assert-OperatorPath $CoreRoot -Directory
    $companion = Assert-OperatorPath $CompanionRoot -Directory
    $heavy = Assert-OperatorPath $HeavyLock
    if ([IO.Path]::GetExtension($heavy) -ine '.ps1') { throw 'Use an explicit PowerShell heavy-lock wrapper.' }
    Assert-ReleaseInputs $context $core $companion
    Assert-ReleaseTransition $context $stopContext
    $publicTest = Assert-OperatorPath (Join-Path $core 'scripts/test.mjs')
    $privateTest = Assert-OperatorPath (Join-Path $companion 'tools/companion-check.mjs')
    $verify = Assert-OperatorPath (Join-Path $companion 'tools/verify-install.mjs')
    $stop = Assert-OperatorPath (Join-Path $PSScriptRoot 'Stop-Core.ps1')
    $start = Assert-OperatorPath (Join-Path $PSScriptRoot 'Start-Core.ps1')
    $revision = Get-ReleaseRevision $core
    $stages = @('public-full', 'private-full', 'revision-check', 'stop', 'verify-data', 'revision-check', 'start')
    if ($DryRun) {
        [ordered]@{ operation = 'ship'; dryRun = $true; coreRevision = $revision; stopConfiguration = $stopSelection; stages = $stages } | ConvertTo-Json -Depth 3
        return
    }
    $local = Join-Path $companion '.local'
    if (-not (Test-Path -LiteralPath $local)) { $null = New-Item -ItemType Directory -Path $local }
    $local = Assert-OperatorPath $local -Directory
    $logs = Join-Path $local ('ship-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $logs
    $shell = Join-Path $PSHOME 'powershell.exe'
    $stage = 'public-full'
    Invoke-ReleaseStage $stage $shell @('-NoProfile', '-NonInteractive', '-File', $heavy, $context.config.nodePath, $publicTest, 'full') $logs
    $stage = 'private-full'
    Invoke-ReleaseStage $stage $shell @('-NoProfile', '-NonInteractive', '-File', $heavy, $context.config.nodePath, $privateTest, '--core', $core, '--lane', 'full') $logs
    $stage = 'revision-check'
    if ((Get-ReleaseRevision $core) -cne $revision) { throw 'Core revision changed during verification.' }
    Assert-ReleaseContextsUnchanged $context $stopContext $Config $PreviousConfig $core $companion
    $stage = 'stop'
    Invoke-ReleaseStage $stage $shell @('-NoProfile', '-NonInteractive', '-File', $stop, '-Config', $PreviousConfig) $logs
    $stage = 'verify-data'
    Invoke-ReleaseStage $stage $context.config.nodePath @($verify, '--core', $core, '--companion', $companion) $logs
    $stage = 'revision-check'
    if ((Get-ReleaseRevision $core) -cne $revision) { throw 'Core revision changed after stop.' }
    Assert-ReleaseContextsUnchanged $context $stopContext $Config $PreviousConfig $core $companion
    $stage = 'start'
    Invoke-ReleaseStage $stage $shell @('-NoProfile', '-NonInteractive', '-File', $start, '-Config', $Config) $logs
    Write-Output "Release complete at revision $revision."
} catch {
    # Do not restart after a failed sync, undo accepted progress, or expose child output.
    Write-Error "Release refused or stopped at stage $stage. Inspect private configuration and run the failed verification separately for its private log. No automatic recovery was attempted."
    exit 1
}
