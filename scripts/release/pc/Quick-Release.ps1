# The short release path: GitHub runs the tests, this PC builds, probes and swaps.
#   Build:   Quick-Release.ps1 -Release rel10-abc1234 -Commit <sha>
#   Go live: Quick-Release.ps1 -GoLive -ReleaseDir <folder> -ExpectLive <live id>
# Go-live still needs the owner's OK for each release. A swap back is the same
# -GoLive call naming the previous release's folder.
# Paths come from .local/quick-release.json (never committed):
#   { "Repo": "...", "Current": ".../current.json", "Releases": "...", "Operator": ".../operator", "WatchdogLog": "..." }
# Each release builds its game data from its own core and carries only the art
# pack from live. When that data differs from live, the go-live also switches
# the save's dataset binding, after proving the swap both ways on the latest save.
[CmdletBinding(DefaultParameterSetName = 'Build')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Build')][string]$Release,
    [Parameter(Mandatory, ParameterSetName = 'Build')][string]$Commit,
    [Parameter(Mandatory, ParameterSetName = 'GoLive')][switch]$GoLive,
    [Parameter(Mandatory, ParameterSetName = 'GoLive')][string]$ReleaseDir,
    [Parameter(Mandatory, ParameterSetName = 'GoLive')][string]$ExpectLive,
    [string]$Config,
    [ValidateRange(10, 300)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0
# Windows PowerShell leaves $PSScriptRoot empty in parameter defaults.
if (-not $Config) { $Config = Join-Path $PSScriptRoot '../../../.local/quick-release.json' }

$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
foreach ($name in 'Repo', 'Current', 'Releases', 'Operator', 'WatchdogLog') {
    if (-not $settings.PSObject.Properties[$name] -or -not $settings.$name) { throw "quick-release.json needs $name." }
}
$node = (Get-Command node -ErrorAction Stop).Source
$builder = Join-Path $PSScriptRoot 'quick-build.mjs'
$clock = [Diagnostics.Stopwatch]::StartNew()

if (-not $GoLive) {
    & $node $builder build --repo $settings.Repo --commit $Commit --current $settings.Current --releases $settings.Releases --release $Release
    if ($LASTEXITCODE) { throw 'Build refused; nothing live changed.' }
    $receipt = Get-Content -LiteralPath (Join-Path (Join-Path $settings.Releases $Release) 'quick-build.json') -Raw | ConvertFrom-Json
    if ($receipt.transition) { 'DATA CHANGES: the go-live also switches the save to the new data, after checking the latest save again.' }
    "READY FOR GO-LIVE: $Release ($([int]$clock.Elapsed.TotalSeconds)s). Go live with -GoLive -ReleaseDir $(Join-Path $settings.Releases $Release) -ExpectLive <live id> after approval."
    return
}

. (Join-Path $settings.Operator 'Operator-Common.ps1')
. (Join-Path $settings.Operator 'ReleaseV2-Common.ps1')
$dir = Assert-OperatorPath $ReleaseDir -Directory
if (Test-Path -LiteralPath (Join-Path $dir 'quick-build.json')) {
    & $node $builder verify --repo $settings.Repo --release-dir $dir | Out-Null
    if ($LASTEXITCODE) { throw 'Release changed since its build; build a new one.' }
}
$live = Read-ReleaseV2Pointer $settings.Current -ForStop
if ($live.pointer.releaseId -cne $ExpectLive) { throw 'The live release is not the expected one.' }
$candidate = Read-ReleaseV2Pointer (Join-Path $dir 'pointer.json')
if ($candidate.sha256 -ceq $live.sha256) { throw 'That release is already live.' }
Assert-ReleaseV2CandidateLayout $candidate
# Data and rules-text packs differ per release; prepare-swap has matched their data.
Assert-ReleaseV2Transition $candidate.context $live.context -PackUpgrade
if (Test-Path -LiteralPath (Join-Path $live.context.localDir 'release-pack-transition.json')) { throw 'A pack transition journal is pending; use the full release path.' }
# Which data binding the save needs after the swap, proven again on the latest
# save before anything stops. Empty when the data matches live.
$prepared = (& $node $builder prepare-swap --current $settings.Current --release-dir $dir) -join "`n"
if ($LASTEXITCODE) { throw 'The save check for this swap refused; nothing live changed.' }
$rebind = (ConvertFrom-Json $prepared).binding
$bindingPath = $live.context.config.dataDir + '.dataset.json'
if ($null -ne $rebind -and $rebind.path -ine $bindingPath) { throw 'The save check named another save.' }
# Swap back target: the exact pointer bytes that are live now.
$back = Join-Path $dir ('previous-pointer.' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '.json')
[IO.File]::Copy($live.path, $back, $false)
$previous = Read-ReleaseV2Pointer $back -ForStop
if ($previous.sha256 -cne $live.sha256) { throw 'Live pointer changed while it was saved.' }

$tick = $null; $owner = $null; $paused = $false; $rebound = $false; $swapped = $false; $phase = 'ownership'
$pause = Join-Path $live.context.localDir 'picker-paused'
try {
    # The watchdog takes the same tick lock, so it cannot restart anything mid-swap.
    $tick = [IO.File]::Open((Join-Path $live.context.localDir 'watchdog-tick.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $owner = Enter-OperatorLock $live.context
    $null = Assert-ReleaseV2SamePointer $live -ForStop
    $null = Assert-ReleaseV2SamePointer $candidate
    Set-Content -LiteralPath $pause -Value ([DateTime]::UtcNow.ToString('o')); $paused = $true
    $phase = 'stop'
    Stop-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner
    Assert-OperatorStoreReleased $live.context
    if ($null -ne $rebind) {
        # Binding before pointer: if this stops halfway, the old release refuses
        # the new binding at startup rather than opening it.
        $phase = 'binding'
        Set-ReleaseV2Binding $bindingPath $rebind.fromSha256 ([Convert]::FromBase64String($rebind.toBase64)) $rebind.toSha256 ([ref]$rebound)
    }
    $phase = 'pointer'
    $null = Assert-ReleaseV2SamePointer $live -ForStop
    Set-ReleaseV2Pointer $live $candidate ([ref]$swapped)
    $phase = 'start'
    Start-OperatorCore $candidate.context $TimeoutSeconds -PreservePause -LockOwner $owner
    $committed = Read-ReleaseV2Pointer $settings.Current
    if ($committed.sha256 -cne $candidate.sha256) { throw 'Live pointer changed during startup.' }
    if ($null -ne $rebind -and (Get-ReleaseV2Hash $bindingPath) -cne $rebind.toSha256) { throw 'Save binding changed during startup.' }
    Remove-Item -LiteralPath $pause; $paused = $false
} catch {
    $cause = $_.Exception.Message
    $restored = $false
    if ($paused) {
        try {
            if ($swapped) {
                # Stop the candidate if it got as far as a runtime record, then point back.
                if (Test-Path -LiteralPath $candidate.context.runtimeFile) { Stop-OperatorCore $candidate.context $TimeoutSeconds -PreservePause -LockOwner $owner }
                Assert-OperatorStoreReleased $candidate.context
                $now = Read-ReleaseV2Pointer $settings.Current -ForStop
                Set-ReleaseV2Pointer $now $previous ([ref]$null)
            } elseif (Test-Path -LiteralPath $live.context.runtimeFile) {
                $runtime = Read-OperatorJson $live.context.runtimeFile
                # Only a picker still serving under a running record is kept as it is.
                # One that is draining, gone or marked stopping is waited out and started fresh.
                if ($runtime.state -cne 'running' -or -not (Test-OperatorListeners $live.context $runtime)) { Stop-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner }
            }
            # The swap-back probe proved the previous release opens what the new one wrote.
            if ($rebound -and (Get-ReleaseV2Hash $bindingPath) -ceq $rebind.toSha256) {
                Set-ReleaseV2Binding $bindingPath $rebind.toSha256 ([Convert]::FromBase64String($rebind.fromBase64)) $rebind.fromSha256 ([ref]$null)
            }
            Start-OperatorCore $live.context $TimeoutSeconds -PreservePause -LockOwner $owner
            $runtime = Read-OperatorJson $live.context.runtimeFile
            if ($runtime.state -cne 'running' -or -not (Test-OperatorListeners $live.context $runtime)) { throw 'Previous release did not come back with its listeners.' }
            Remove-Item -LiteralPath $pause -ErrorAction SilentlyContinue
            $restored = $true
        } catch { $cause += ' / swap back failed: ' + $_.Exception.Message }
    }
    if ($restored) { throw "Go-live refused at $phase, previous release restored: $cause" }
    if ($paused) { throw "Go-live refused at $phase; the watchdog is paused and nothing is running. Inspect before anything else: $cause" }
    throw "Go-live refused at $phase before anything stopped: $cause"
} finally {
    if ($null -ne $owner) { $owner.Dispose() }
    if ($null -ne $tick) { $tick.Dispose() }
}

$after = Read-ReleaseV2Pointer $settings.Current
$runtime = Read-OperatorJson $after.context.runtimeFile
if (-not (Test-OperatorListeners $after.context $runtime)) { throw 'Live listeners are not owned by the new release; inspect before anything else.' }
"live now $($after.pointer.releaseId); both listeners owned by it$(if ($null -ne $rebind) { '; save switched to its data' }) ($([int]$clock.Elapsed.TotalSeconds)s)"
'watchdog tail:'; Get-Content -LiteralPath $settings.WatchdogLog -Tail 3
'RELEASE LIVE'
