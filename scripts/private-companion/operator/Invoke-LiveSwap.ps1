[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Topology,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$TopologySha256,
    [ValidateSet('swap','recover','bootstrap')][string]$Operation = 'recover',
    [switch]$ValidateOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This is a new topology entry point, never an alias for legacy Start/Stop.
# It neither installs tasks nor changes ingress, credentials, packs or saves.
function Get-BridgeHash([string]$File) { return (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
function Assert-BridgePin($Pin) {
    if (-not $Pin -or $Pin.sha256 -cnotmatch '^[a-f0-9]{64}$' -or -not [IO.Path]::IsPathRooted($Pin.path) -or (Get-BridgeHash $Pin.path) -cne $Pin.sha256) { throw 'Live swap pin refused.' }
    $current = [IO.Path]::GetFullPath($Pin.path)
    while ($current) {
        if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Live swap linked path refused.' }
        $parent = [IO.Directory]::GetParent($current); if (-not $parent) { break }; $current = $parent.FullName
    }
}
function Assert-BridgePrivate([string]$Path) {
    $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($rule in (Get-Acl -LiteralPath $Path).Access) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Live swap state and credential ACL must be private.' }
    }
}
Assert-BridgePin ([pscustomobject]@{path=$Topology;sha256=$TopologySha256})
if ($Topology -match '["\r\n]' -or $Topology -notmatch '^[A-Za-z]:[/\\]') { throw 'Explicit local topology path required.' }
$top = [IO.File]::ReadAllText($Topology) | ConvertFrom-Json
if ($top.schemaVersion -ne 2 -or $top.capability -cne 'bridgecore-local-pipe-v2' -or $top.legacyWatchdogMode -cne 'durable-pause') { throw 'Explicit live swap topology capability is required.' }
foreach ($key in @('Operator-Common.ps1','ReleaseV2-Common.ps1')) {
    $pin = $top.helpers.$key; Assert-BridgePin $pin
    if ([IO.Path]::GetFileName($pin.path) -cne $key) { throw 'Canonical helper filename differs.' }
}
Assert-BridgePin $top.identityModule
$sourceRoot = Split-Path -Parent $PSScriptRoot
$runtimeNames = @('live-swap/managed-runtime.mjs','live-swap/backend-lifecycle.mjs','live-swap/runtime-backend.mjs','live-swap/controller.mjs','live-swap/journal.mjs','live-swap/front-door.mjs','live-swap/ingress.mjs','operator/Bridge-Ownership.ps1','operator/live-swap-runtime.mjs','operator/live-swap-request.mjs','operator/Invoke-LiveSwap.ps1')
foreach ($name in $runtimeNames) {
    $pin = $top.runtimePins.$name; Assert-BridgePin $pin
    if ([IO.Path]::GetFullPath($pin.path) -ine [IO.Path]::GetFullPath((Join-Path $sourceRoot $name))) { throw 'Runtime pin is outside the selected drop-in.' }
}
. $top.helpers.'Operator-Common.ps1'.path
. $top.helpers.'ReleaseV2-Common.ps1'.path
. (Join-Path $PSScriptRoot 'Bridge-Ownership.ps1')
foreach ($command in @('Read-OperatorConfig','Read-ReleaseV2Pointer','Assert-ReleaseV2SamePointer','Set-ReleaseV2Pointer','Write-ReleaseV2Journal','Enter-OperatorLock','Assert-OperatorLockOwner','Assert-OperatorStoreReleased','Start-OperatorDetached')) {
    if (-not (Get-Command $command -CommandType Function -ErrorAction SilentlyContinue)) { throw 'Pinned canonical helpers lack the required live swap contract.' }
}
$null = Assert-OperatorPath $top.stateDir -Directory
$null = Assert-OperatorPath $top.dataDir -Directory
Assert-BridgePrivate $top.stateDir
Assert-BridgePrivate $top.controlTokenFile
Assert-BridgePrivate $Topology
Assert-OperatorPin $top.nodePin
$references = @{}; $contexts = @{}
foreach ($slot in @('old','next')) {
    Assert-OperatorPin $top.$slot.pointer
    $references[$slot] = Read-ReleaseV2Pointer $top.$slot.pointer.path
    $contexts[$slot] = $references[$slot].context
    if ($contexts[$slot].config.nodePath -ine $top.nodePin.path -or $contexts[$slot].config.dataDir -ine $top.dataDir -or $contexts[$slot].config.host -cne '127.0.0.1' -or $null -ne $contexts[$slot].config.loopbackPort) { throw 'Backend must use the exact save, node and loopback-only topology.' }
    foreach ($record in @($top.$slot.recordFile,$top.door.recordFile,$top.door.stateFile,$top.door.proofFile,$top.journal,$top.controlTokenFile)) {
        $null = Assert-OperatorAbsolute $record
        if ((Split-Path -Parent $record) -ine $top.stateDir) { throw 'Runtime state must remain in its private state directory.' }
    }
}
# The legacy invariant requires equal listeners; the dedicated topology uses
# different backend ports. Compare the invariant explicitly instead of mutating
# either canonical configuration to make the old transition helper pass.
foreach ($key in @('nodePath','dataDir','publicOriginFile','packsDir')) {
    if ($contexts.old.config.$key -ine $contexts.next.config.$key) { throw 'Offline transition required.' }
}
if ($contexts.old.origin -cne $contexts.next.origin -or $contexts.old.config.selection.sha256 -cne $contexts.next.config.selection.sha256 -or $contexts.old.config.coreRoot -ieq $contexts.next.config.coreRoot -or $contexts.old.config.port -eq $contexts.next.config.port) { throw 'Independent compatible backend slots required.' }
foreach ($key in @('data','rulesText','art')) { if ($contexts.old.config.packs.$key.sha256 -cne $contexts.next.config.packs.$key.sha256) { throw 'Pack transitions require the offline managed path.' } }
$currentPath = Assert-OperatorPath $top.currentPointer
function Get-BridgeDistinctPath([string]$Value) {
    $withoutDots = [regex]::Replace($Value,'(^|[\\/])\.{1,2}(?=[\\/])','/')
    if ($Value.Contains('~') -or $withoutDots -match '[. ]([\\/]|$)' -or ($Value -replace '^[A-Za-z]:','') -match ':') { throw 'Alternate Win32 path spelling cannot establish distinct runtime files.' }
    return [IO.Path]::GetFullPath($Value).ToLowerInvariant()
}
$mutableFiles = @($top.journal,$top.controlTokenFile,$top.door.stateFile,$top.door.recordFile,$top.door.proofFile,$top.old.recordFile,$top.next.recordFile,($top.journal+'.budget-blocked.json'))
$mutableFiles += @('active-runtime.json','bridgecore-paused','old.log','old-error.log','next.log','next-error.log','door.log','door-error.log') | ForEach-Object { Join-Path $top.stateDir $_ }
$mutableFiles += @('picker-paused','helper.lock','watchdog-tick.lock') | ForEach-Object { Join-Path $contexts.old.localDir $_ }
foreach ($mutableFile in $mutableFiles) {
    if (Test-Path -LiteralPath $mutableFile) {
        $mutableItem=Get-Item -LiteralPath $mutableFile -Force
        if ($mutableItem.LinkType -or ($mutableItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Runtime files cannot have linked aliases.' }
    }
}
$mutablePaths = @($mutableFiles | ForEach-Object { Get-BridgeDistinctPath $_ })
if (@($mutablePaths | Select-Object -Unique).Count -ne $mutablePaths.Count) { throw 'Mutable runtime paths must be distinct.' }
$currentCanonical = Get-BridgeDistinctPath $top.currentPointer
if ($currentCanonical -in $mutablePaths) { throw 'Current pointer cannot alias runtime state.' }
$immutableFiles = @($Topology,$top.old.pointer.path,$top.next.pointer.path,$references.old.pointer.config.path,$references.next.pointer.config.path,$top.nodePin.path,$top.identityModule.path)
$immutableFiles += @($top.helpers.PSObject.Properties.Value + $top.runtimePins.PSObject.Properties.Value) | ForEach-Object { $_.path }
foreach ($key in @('compatibilityEvidence','freezeBudgetEvidence','resourceEvidence')) { if ($top.PSObject.Properties.Name -contains $key) { $immutableFiles += $top.$key.path } }
foreach ($slot in @('old','next')) {
    $config = $contexts[$slot].config
    $immutableFiles += @($config.publicOriginFile,$config.selection.path,$config.packs.data.path,$config.packs.rulesText.path,$config.packs.art.path)
    foreach ($pin in @($config.profile,$config.addons) | Where-Object { $null -ne $_ }) { $immutableFiles += $pin.path }
}
$immutableFiles += @('state.json','access-token','store.lock','store.lock.recovery') | ForEach-Object { Join-Path $top.dataDir $_ }
$immutableFiles += $top.dataDir+'.dataset.json'
foreach ($immutable in $immutableFiles) {
    $canonical=Get-BridgeDistinctPath $immutable
    if ($canonical -eq $currentCanonical -or $canonical -in $mutablePaths) { throw 'Current pointer and runtime state cannot overwrite retained immutable inputs.' }
}
function Assert-BridgeInputs {
    Assert-BridgePin ([pscustomobject]@{path=$Topology;sha256=$TopologySha256})
    Assert-OperatorPin $top.nodePin
    foreach ($name in $runtimeNames) { Assert-BridgePin $top.runtimePins.$name }
    foreach ($slot in @('old','next')) {
        $null = Assert-ReleaseV2SamePointer $references[$slot]
        if ((Read-OperatorConfig $references[$slot].pointer.config.path).configHash -cne $contexts[$slot].configHash) { throw 'Configuration changed.' }
    }
}
Assert-BridgeInputs
if ($ValidateOnly) { Write-Output 'Live swap static pins and helper contracts validated. No process was started.'; return }

$tick = $null; $owner = $null; $child = $null; $committed = $null
$observations=@{}; $doorProofs=[ordered]@{schemaVersion=1;topologyHash=$TopologySha256;entries=@{}}
$pausePath = Join-Path $contexts.old.localDir 'picker-paused'
$bridgePause = Join-Path $top.stateDir 'bridgecore-paused'
function Set-BridgePause {
    Write-ReleaseV2Journal $pausePath ([ordered]@{schemaVersion=2;capability='bridgecore-local-pipe-v2';legacyWatchdogPaused=$true})
    Write-ReleaseV2Journal $bridgePause ([ordered]@{schemaVersion=2;paused=$true})
}
function Assert-BridgeHeld {
    if ($null -eq $script:tick -or -not $script:tick.CanWrite -or $null -eq $script:owner) { throw 'Managed locks are not held.' }
    Assert-OperatorLockOwner $contexts.old $script:owner
}
function Assert-BridgeLegacyAbsent {
    $pattern='(?i)(?:^|\s)--data-dir\s+"?'+[regex]::Escape($top.dataDir)+'"?(?:\s|$)'
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match $pattern }).Count) { throw 'A legacy writer still names this save. Its matching managed Stop is required.' }
}
function Get-BridgeRecord([string]$Kind) {
    $recordFile = if ($Kind -eq 'door') { $top.door.recordFile } else { $top.$Kind.recordFile }
    if (-not (Test-Path -LiteralPath $recordFile)) { return $null }
    $null = Assert-OperatorPath $recordFile
    return Read-OperatorJson $recordFile
}
function Get-BridgeProcess([string]$Kind) {
    if ($Kind -notin @('old','next','door')) { throw 'Unknown process slot.' }
    $record = Get-BridgeRecord $Kind
    if (-not $record) { return [ordered]@{state='absent'} }
    $configHash = if ($Kind -eq 'door') { $TopologySha256 } else { $contexts[$Kind].configHash }
    $runtimeScript = if ($Kind -eq 'door') { Join-Path $PSScriptRoot 'live-swap-runtime.mjs' } else { Join-Path $sourceRoot 'live-swap/runtime-backend.mjs' }
    # A mutable record alone must not authorize a foreign command line.
    $expectedArguments = if ($Kind -eq 'door') { '"' + $runtimeScript + '" door "' + $Topology + '" ' + $TopologySha256 } else { '"' + $runtimeScript + '" "' + $Topology + '" ' + $TopologySha256 + ' ' + $Kind }
    $expected=[pscustomobject]@{configHash=$configHash;topologyHash=$TopologySha256;kind=$Kind;executable=$top.nodePin.path;script=$runtimeScript;commandLine=('"' + $top.nodePin.path + '" ' + $expectedArguments)}
    $process=Get-BridgeExactProcess $record $expected
    if (-not $process) { return [ordered]@{state='dead'} }
    $binds = if ($Kind -eq 'door' -and $top.door.PSObject.Properties.Name -contains 'lanes') { @($top.door.lanes) }
        elseif ($Kind -eq 'door') { @([pscustomobject]@{host='127.0.0.1';port=$top.door.listen}) }
        else { @([pscustomobject]@{host='127.0.0.1';port=$contexts[$Kind].config.port}) }
    $allListeners = $true
    foreach ($bind in $binds) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $bind.port -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq $bind.host })
        if (@($listeners | Where-Object { $_.OwningProcess -ne $record.pid }).Count) { throw 'A configured listener belongs to a foreign process.' }
        if ($listeners.Count -ne 1) { $allListeners = $false }
    }
    $again = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)"
    if (-not $again -or $again.CommandLine -cne $record.commandLine -or ([DateTime]$again.CreationDate).ToUniversalTime().Ticks -ne [DateTime]::Parse($record.processStartedAt).ToUniversalTime().Ticks) { throw 'Process changed during listener inspection.' }
    return [ordered]@{state='owned';listeners=$allListeners;processIdentity=[ordered]@{pid=$record.pid;processStartedAt=$record.processStartedAt;configHash=$configHash}}
}
function Start-BridgeProcess([string]$Kind) {
    if ($Kind -ne 'door') { Assert-BridgeHeld }
    Assert-BridgeInputs
    $existing = Get-BridgeProcess $Kind
    if ($existing.state -eq 'owned') { return }
    $runtimeScript = if ($Kind -eq 'door') { Join-Path $PSScriptRoot 'live-swap-runtime.mjs' } else { Join-Path $sourceRoot 'live-swap/runtime-backend.mjs' }
    $arguments = if ($Kind -eq 'door') { '"' + $runtimeScript + '" door "' + $Topology + '" ' + $TopologySha256 } else { '"' + $runtimeScript + '" "' + $Topology + '" ' + $TopologySha256 + ' ' + $Kind }
    $saved = @{}
    foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS','NODE_PATH') })) { $saved[$entry.Name]=$entry.Value; [Environment]::SetEnvironmentVariable($entry.Name,$null,'Process') }
    try { $launched = Start-OperatorDetached -Executable $top.nodePin.path -Arguments $arguments -WorkingDirectory $sourceRoot -StandardOutput (Join-Path $top.stateDir ($Kind+'.log')) -StandardError (Join-Path $top.stateDir ($Kind+'-error.log')) }
    finally { foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') } }
    $launched.Handle | Out-Null
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($launched.Id)"
        if (-not $process -or $launched.HasExited) { throw 'Runtime exited before recording ownership.' }
        $record = [ordered]@{pid=[int]$launched.Id;processStartedAt=([DateTime]$process.CreationDate).ToUniversalTime().ToString('o');configHash=$(if($Kind -eq 'door'){$TopologySha256}else{$contexts[$Kind].configHash});topologyHash=$TopologySha256;kind=$Kind;executable=$top.nodePin.path;script=$runtimeScript;commandLine=$process.CommandLine}
        $recordFile = if ($Kind -eq 'door') { $top.door.recordFile } else { $top.$Kind.recordFile }
        Write-ReleaseV2Journal $recordFile $record
        $null = Get-BridgeProcess $Kind
    } catch {
        # Only this retained, freshly launched handle can be stopped. Never kill
        # a PID recovered from disk, even when its ownership is uncertain.
        if (-not $launched.HasExited) { $launched.Kill(); $null = $launched.WaitForExit(5000) }
        throw 'Could not record the freshly launched runtime.'
    } finally { $launched.Dispose() }
    # A large immutable tree may take longer than a scheduler tick to validate.
    # Connect without sending any secret, then let Node mutually authenticate.
    $pipePath = if ($Kind -eq 'door') { $top.door.controlPipe } else { $top.$Kind.controlPipe }
    if ($pipePath -cnotmatch '^\\\\\.\\pipe\\picker-bridge-[a-z0-9-]{16,100}$') { throw 'Invalid runtime pipe.' }
    $pipeName=$pipePath.Substring(9); $until=[DateTime]::UtcNow.AddSeconds(300); $connected=$false
    do {
        if ((Get-BridgeProcess $Kind).state -ne 'owned') { throw 'Recorded runtime exited before pipe readiness.' }
        $probe=[IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [IO.Pipes.PipeDirection]::InOut)
        try { $probe.Connect(100); $connected=$true } catch [TimeoutException] { } finally { $probe.Dispose() }
        if (-not $connected) { Start-Sleep -Milliseconds 100 }
    } while (-not $connected -and [DateTime]::UtcNow -lt $until)
    if (-not $connected) { throw 'Owned runtime pipe did not become ready.' }
}
function Assert-BridgeReleased($Released) {
    $staleMetadata=$false
    foreach ($name in @('store.lock','store.lock.recovery')) {
        $lockPath=Join-Path $top.dataDir $name
        if (-not (Test-Path -LiteralPath $lockPath)) { continue }
        $null=Assert-OperatorPath $lockPath; $lockOwner=Read-OperatorJson $lockPath
        if ($lockOwner.pid -isnot [int] -or $lockOwner.pid -lt 1 -or $lockOwner.startVerified -ne $true -or $lockOwner.host -ine [Net.Dns]::GetHostName()) { throw 'Store metadata owner is uncertain. No lock was deleted.' }
        $matched=$false
        foreach ($slot in @('old','next')) {
            $record=Get-BridgeRecord $slot
            if ($record -and $record.pid -eq $lockOwner.pid -and (Get-BridgeProcess $slot).state -eq 'dead' -and
                [DateTimeOffset]::Parse($record.processStartedAt).ToUnixTimeMilliseconds() -eq [DateTimeOffset]::Parse($lockOwner.startedAt).ToUnixTimeMilliseconds()) { $matched=$true }
        }
        if (-not $matched) { throw 'Store metadata is not owned by an exactly recorded dead backend.' }
        $staleMetadata=$true
    }
    foreach ($kind in @('old','next')) {
        $proof=$Released.$kind
        if ($proof.state -eq 'dead') { if ((Get-BridgeProcess $kind).state -notin @('dead','absent')) { throw 'Dead backend proof changed.' }; continue }
        if ($proof.state -ne 'stopped' -or $proof.listeners -ne $false -or -not $observations.ContainsKey($kind) -or
            ($proof.processIdentity | ConvertTo-Json -Compress) -cne ($observations[$kind].processIdentity | ConvertTo-Json -Compress)) { throw 'Fresh authenticated stopped-host proof is absent.' }
    }
    # Retain the canonical check for any legacy app/server.mjs writer naming the
    # save. Dedicated stopped runtime hosts name only the topology file.
    # Canonical legacy process/store checks ran before preparation under locks.
    # Fresh authenticated stopped-state proofs cover the known runtime hosts;
    # the real core's kernel guard remains the final activation authority.
}
function Commit-Bridge($Identity) {
    Assert-BridgeHeld
    Assert-BridgePin ([pscustomobject]@{path=$Topology;sha256=$TopologySha256})
    if ($Identity.slot -notin @('old','next')) { throw 'Unknown commit identity.' }
    $slot = [string]$Identity.slot; $reference = $references[$slot]; $context = $contexts[$slot]
    if ($Identity.configHash -cne $context.configHash -or $Identity.version -cne $top.$slot.version -or $Identity.coreTreeSha256 -cne $top.$slot.coreTreeSha256 -or $Identity.configPin.path -ine $reference.pointer.config.path -or $Identity.configPin.sha256 -cne $reference.pointer.config.sha256) { throw 'Commit identity differs from the pinned slot.' }
    $proof=$doorProofs.entries[$slot]
    if (-not $proof -or -not $observations.ContainsKey($slot) -or ($proof.processIdentity | ConvertTo-Json -Compress) -cne ($observations[$slot].processIdentity | ConvertTo-Json -Compress)) { throw 'No exact prewarmed process and listener proof.' }
    $live = Read-ReleaseV2Pointer $currentPath -ForStop
    if ($live.sha256 -notin @($references.old.sha256,$references.next.sha256)) { throw 'Current pointer is outside the retained pair.' }
    if ($live.sha256 -cne $reference.sha256) { Set-ReleaseV2Pointer $live $reference }
    # Dedicated pins never impersonate server-runtime.json expected by legacy
    # Start/Stop. Legacy watchdog remains durably paused for this topology.
    Write-ReleaseV2Journal (Join-Path $top.stateDir 'active-runtime.json') ([ordered]@{schemaVersion=2;topologyHash=$TopologySha256;identity=$Identity;processIdentity=$proof.processIdentity;currentPointerSha256=$reference.sha256})
    $script:committed = $slot
}

try {
    # Pause legacy recovery before any separate process can bind a listener.
    $tick=[IO.File]::Open((Join-Path $contexts.old.localDir 'watchdog-tick.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $owner=Enter-OperatorLock $contexts.old
    Set-BridgePause
    $owner.Dispose(); $owner=$null; $tick.Dispose(); $tick=$null
    $child=[Diagnostics.Process]::new(); $child.StartInfo=[Diagnostics.ProcessStartInfo]::new()
    $child.StartInfo.FileName=$top.nodePin.path
    $child.StartInfo.Arguments='"'+(Join-Path $PSScriptRoot 'live-swap-runtime.mjs')+'" '+$Operation+' "'+$Topology+'" '+$TopologySha256
    $child.StartInfo.UseShellExecute=$false; $child.StartInfo.CreateNoWindow=$true
    $child.StartInfo.RedirectStandardInput=$true; $child.StartInfo.RedirectStandardOutput=$true; $child.StartInfo.RedirectStandardError=$true
    foreach ($entry in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'RS3_*' -or $_.Name -in @('NODE_OPTIONS','NODE_PATH') })) { $child.StartInfo.EnvironmentVariables.Remove($entry.Name) }
    $null=$child.Start(); $child.Handle | Out-Null; $child.BeginErrorReadLine()
    while ($null -ne ($line=$child.StandardOutput.ReadLine())) {
        if ($line.Length -gt 131072) { throw 'Managed request is oversized.' }
        $request=Convert-OperatorJsonValue ($line | ConvertFrom-Json); $value=$null; $failed=$false
        try {
            switch ($request.method) {
                'acquire' {
                    if ($null -ne $owner -or $null -ne $tick) { throw 'Locks already held.' }
                    $tick=[IO.File]::Open((Join-Path $contexts.old.localDir 'watchdog-tick.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
                    $owner=Enter-OperatorLock $contexts.old; Assert-BridgeInputs; Assert-BridgeLegacyAbsent
                }
                'release' { Assert-BridgeHeld; $owner.Dispose();$owner=$null;$tick.Dispose();$tick=$null }
                'assertHeld' { Assert-BridgeHeld }
                'pause' { Assert-BridgeHeld; Set-BridgePause }
                'assertStoreReleased' { Assert-BridgeHeld; Assert-BridgeReleased $request.argument }
                'commit' { Commit-Bridge $request.argument }
                'unpause' { Assert-BridgeHeld; if (-not $committed) { throw 'No committed runtime.' }; Remove-Item -LiteralPath $bridgePause -ErrorAction SilentlyContinue }
                'inspect' { $slot=[string]$request.argument; $value=Get-BridgeProcess $slot; $observations[$slot]=$value }
                'pinDoorProof' {
                    Assert-BridgeHeld; $proof=$request.argument; $slot=[string]$proof.slot
                    if (-not $observations.ContainsKey($slot) -or $observations[$slot].state -ne 'owned' -or -not $observations[$slot].listeners -or
                        ($proof.processIdentity | ConvertTo-Json -Compress) -cne ($observations[$slot].processIdentity | ConvertTo-Json -Compress) -or $proof.listenerProof.port -ne $contexts[$slot].config.port -or $proof.listenerProof.host -cne '127.0.0.1' -or $proof.listenerProof.listening -ne $true) { throw 'OS-verified prewarm proof absent.' }
                    $doorProofs.entries[$slot]=$proof; Write-ReleaseV2Journal $top.door.proofFile $doorProofs
                }
                'start' { Start-BridgeProcess ([string]$request.argument) }
                'ensureDoor' { Start-BridgeProcess 'door'; $proof=Get-BridgeProcess 'door'; if ($proof.state -ne 'owned') { throw 'Door ownership is absent.' } }
                'heartbeat' { if (-not (Test-Path -LiteralPath $pausePath)) { throw 'Legacy recovery pause drifted.' } }
                'resourceAdmission' {
                    Assert-OperatorPin $top.resourceEvidence
                    $resource=Read-OperatorJson $top.resourceEvidence.path
                    if ($resource.measured -ne $true -or $resource.schemaVersion -ne 1 -or $resource.standbyPeakBytes -lt 1 -or $resource.reserveBytes -lt 1) { throw 'Measured resource evidence is absent.' }
                    $available=[long](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory * 1024
                    if ($available -lt ([long]$resource.standbyPeakBytes + [long]$resource.reserveBytes)) { throw 'Insufficient free memory for measured standby and retained reserve.' }
                }
                default { throw 'Unknown managed request.' }
            }
        } catch { $failed=$true; if ($null -ne $owner) { Set-BridgePause } }
        $response=if($failed){[ordered]@{id=$request.id;error='LIVE_SWAP_MANAGED_REFUSED'}}else{[ordered]@{id=$request.id;value=$value}}
        if ($child.HasExited) { break }
        $child.StandardInput.WriteLine(($response | ConvertTo-Json -Depth 30 -Compress)); $child.StandardInput.Flush()
    }
    $child.WaitForExit()
    if ($child.ExitCode -ne 0) { throw 'Live swap host requires recovery; ingress lease has closed.' }
} finally {
    # Managed dispatch is synchronous: no late pointer commit can continue
    # after streams are released, even when the controller dies mid-request.
    if ($null -ne $owner) { try { Set-BridgePause } finally { $owner.Dispose() } }
    if ($null -ne $tick) { $tick.Dispose() }
    if ($null -ne $child) { $child.StandardInput.Close(); $child.Dispose() }
}
