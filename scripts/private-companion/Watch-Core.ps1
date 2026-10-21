# Legacy tasks pin one config; v2 tasks resolve the stable atomic release pointer.
param([Parameter(Mandatory=$true,ParameterSetName='Pinned')][string]$Config,
    [Parameter(Mandatory=$true,ParameterSetName='Pinned')][ValidatePattern('^[a-f0-9]{64}$')][string]$ConfigSha256,
    [Parameter(Mandatory=$true,ParameterSetName='Current')][string]$CurrentRelease,
    [ValidateRange(1,120)][int]$WorkerRecoveryTimeoutSeconds = 30,
    [ValidateRange(0,120)][int]$HealthRetryDelaySeconds = 15)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
. (Join-Path $PSScriptRoot 'Watchdog-Common.ps1')
. (Join-Path $PSScriptRoot 'ReleaseV2-Common.ps1')
try { Invoke-CoreWatchTick @PSBoundParameters }
catch { Write-Error 'Watchdog refused. Inspect the pinned configuration and exact managed runtime ownership.'; exit 1 }
