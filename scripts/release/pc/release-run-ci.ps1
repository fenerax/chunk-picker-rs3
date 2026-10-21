# CI-backed PC orchestration. Never invoke the legacy release-run.ps1 here.
# The current portable artifact cannot authorize exact kit gates: until the
# explicit CI consumer exists, normal preparation refuses before staging.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Release,
    [Parameter(Mandatory)][string]$Kit,
    [Parameter(Mandatory)][string]$ExpectLive,
    [Parameter(Mandatory)][string]$CandidateCommit,
    [string]$RunId = 'latest',
    [string]$Config = (Join-Path $PSScriptRoot '../../../.local/release-pc.json'),
    [string]$Checkout,
    [string]$Current,
    [string]$KitsRoot,
    [string]$WorkRoot,
    [string]$EvidenceDir,
    [string]$ExpectedEvidence,
    [string]$Request,
    [string]$Clock,
    [string]$WatchdogLog,
    [string]$Node,
    [string]$Ps,
    [string]$Gh = 'gh',
    [switch]$GoLive,
    [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version 3.0

function Now { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Step($name) { "== $name $(Now)"; $script:stepName = $name; $script:failureGate = $name; $script:stepStart = Now; $env:RS3_CLOCK_LANE = $name }
function Refuse($gate, $message, $cause = 'unknown') {
    # Preflight is read-only even on failure: no clock, workspace or download.
    # Normal refusals use the original runner's clock command and stop once.
    if (-not $PreflightOnly -and $Node -and $Clock) {
        try {
            & $Node $Clock fail "$Release-$Kit-$($script:stepName)" --scope stage --gate $gate --cause $cause --started $script:stepStart --release $Release --note $message 2>&1 | Out-Null
            if ($LASTEXITCODE) { Write-Warning 'Failure clock refused; release remains refused.' }
        } catch { Write-Warning 'Failure clock refused; release remains refused.' }
    }
    throw "$($script:stepName) refused: $message"
}
function Live { Get-Content -LiteralPath $Current -Raw | ConvertFrom-Json }
function FreeGB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1) }
function AssertLive {
    if ((Live).releaseId -ne $ExpectLive) { throw 'live-id refused.' }
}
function InvokeInputs($action) {
    $payload = $script:options | ConvertTo-Json -Depth 50 -Compress
    # stdin is transient; no preflight receipt/config is written to disk.
    $raw = @($payload | & $Node (Join-Path $PSScriptRoot 'ci-inputs.mjs') $action 2>&1)
    if ($LASTEXITCODE) {
        $message = 'CI inputs refused.'
        if ($raw.Count -eq 1 -and "$($raw[0])" -cmatch '^[a-z-]+ refused\.$') { $message = "$($raw[0])" }
        throw $message
    }
    return (($raw -join "`n") | ConvertFrom-Json)
}

$script:stepName = 'preflight'; $script:failureGate = 'preflight'; $script:stepStart = Now
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$savedEnvironment = @{}
foreach ($name in 'NODE_OPTIONS', 'RS3_CLOCK_LABEL', 'RS3_CLOCK_LANE') { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    # This is the only machine config. All of its paths can be overridden by
    # named parameters. Unknown keys fail rather than silently hiding a typo.
    $pathNames = @('Checkout', 'Current', 'KitsRoot', 'WorkRoot', 'EvidenceDir', 'ExpectedEvidence', 'Request', 'Clock', 'WatchdogLog', 'Node', 'Ps')
    if (Test-Path -LiteralPath $Config) {
        $settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
        foreach ($property in $settings.PSObject.Properties) {
            if ($property.Name -cnotin ($pathNames + 'Gh')) { throw 'config refused.' }
            if (-not $PSBoundParameters.ContainsKey($property.Name)) { Set-Variable -Name $property.Name -Value $property.Value }
        }
    } elseif ($PSBoundParameters.ContainsKey('Config')) { throw 'config refused.' }
    foreach ($name in $pathNames) {
        if (-not (Get-Variable $name -ValueOnly)) { throw 'config refused.' }
    }
    $env:NODE_OPTIONS = '--max-old-space-size=2048'
    $env:RS3_CLOCK_LABEL = $Release
    $script:options = @{
        release = $Release; kit = $Kit; expectLive = $ExpectLive; candidateCommit = $CandidateCommit; runId = $RunId
        checkout = $Checkout; current = $Current; kitsRoot = $KitsRoot; workRoot = $WorkRoot; evidenceDir = $EvidenceDir
        expectedEvidence = $ExpectedEvidence; request = $Request; clock = $Clock; watchdogLog = $WatchdogLog
        node = $Node; ps = $Ps; gh = $Gh; goLive = [bool]$GoLive
    }
    $checked = InvokeInputs 'preflight'
    if ($PreflightOnly) {
        'preflight ok: authenticated portable checks; releaseReady=false'
        if (-not $checked.consumerAvailable) { 'consumer integration pending; preparation and go-live remain refused.' }
        return
    }
    $script:options.approved = $checked
    $KitDir = $checked.kitDir; $candidate = $checked.candidatePath; $Previous = $checked.previous
    $ReleaseId = $checked.releaseId; $Evidence = $EvidenceDir

    if ($GoLive) {
        Step 'activation-admission'
        if ((FreeGB) -lt 4) { throw 'activation-memory refused.' }
        $null = InvokeInputs 'admit'
        AssertLive
        # Reused from release-run.ps1: the activation call, listener inspection
        # and watchdog checks are unchanged; WatchdogLog is now a parameter.
        Step 'go-live'
        & $Node "$KitDir/tools/release-v2.mjs" release --kit $KitDir --release $candidate --current $Current --evidence-dir $Evidence --public-ci-local-fallback
        if ($LASTEXITCODE) { $script:failureGate = 'promote'; throw 'Release refused; inspect private evidence before another operation.' }
        $after = Live
        $listeners = Get-NetTCPConnection -State Listen -LocalPort 8788, 8789 -ErrorAction SilentlyContinue | ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
            [pscustomobject]@{ port = $_.LocalPort; ownedByCandidate = ($proc.CommandLine -match [regex]::Escape("relpipe-v2-staged-$Kit")) }
        }
        "live now $($after.releaseId)"
        $listeners | ForEach-Object { "port $($_.port) owned by candidate: $($_.ownedByCandidate)" }
        if (@($listeners | Where-Object ownedByCandidate).Count -lt 2) { throw 'Live listeners are not both owned by the new release; inspect before anything else.' }
        # Retain the inherited row-count check above, and require each port too.
        if ($after.releaseId -ne $ReleaseId -or @(8788, 8789 | Where-Object { $port = $_; -not @($listeners | Where-Object { $_.port -eq $port -and $_.ownedByCandidate }).Count }).Count) {
            throw 'Live release or listener ownership refused; inspect before anything else.'
        }
        'watchdog tail:'; Get-Content -LiteralPath $WatchdogLog -Tail 3
        'RELEASE LIVE'
        return
    }

    Step 'stage'
    # This new consumer may stage/bind only. It cannot use legacy practice,
    # prepare or gates-only as a fallback. Missing kit evidence refuses.
    $null = InvokeInputs 'stage'

    Step 'dry-runs'
    AssertLive
    & $Ps -NoProfile -File "$KitDir/operator/Managed-ReleaseV2.ps1" -CurrentRelease $Current -CandidatePointer "$candidate/pointer.json" -CompanionRoot $KitDir -Receipt "$candidate/companion.json" -ReleaseRoot $candidate -DryRun
    if ($LASTEXITCODE) { $script:failureGate = 'forward-dry-run'; throw 'Forward handover dry run refused.' }
    & $Ps -NoProfile -File "$KitDir/operator/Managed-ReleaseV2.ps1" -CurrentRelease "$candidate/pointer.json" -CandidatePointer "$Previous/pointer.json" -CompanionRoot $KitDir -Receipt "$Previous/companion.json" -ReleaseRoot $Previous -Rollback -DryRun
    if ($LASTEXITCODE) { $script:failureGate = 'rollback-dry-run'; throw 'Rollback handover dry run refused.' }

    Step 'freeze'
    $null = InvokeInputs 'admit'
    AssertLive
    & $Node "$KitDir/tools/release-v2.mjs" freeze --kit $KitDir --release $candidate --current $Current --evidence-dir $Evidence
    if ($LASTEXITCODE) { throw 'Freeze refused; nothing live changed.' }
    AssertLive
    if (-not (Test-Path -LiteralPath "$candidate/frozen-bundle.json" -PathType Leaf)) { throw 'Frozen seal missing.' }
    Step 'ready'
    "READY FOR GO-LIVE: $ReleaseId. Reuse these inputs with -GoLive only after approval for this release."
} catch {
    # Native tools never supply the public note; keep paths and private values
    # in their existing private evidence. There are no retries or overrides.
    $message = 'Release refused; inspect private evidence before another operation.'
    if ($_.Exception.Message -cmatch '^[a-z-]+ refused\.$') { $message = $_.Exception.Message }
    Refuse $script:failureGate $message
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
