param([Parameter(Mandatory=$true)][string]$CurrentRelease,
    [Parameter(Mandatory=$true)][string]$CandidatePointer,
    [Parameter(Mandatory=$true)][string]$CompanionRoot,
    [Parameter(Mandatory=$true)][string]$Receipt,
    [Parameter(Mandatory=$true)][string]$ReleaseRoot,
    [switch]$Rollback, [switch]$Recover, [switch]$DryRun, [ValidateRange(1,300)][int]$TimeoutSeconds = 60,
    [string]$PackCheckTool, [string]$PackCheckSha256, [string]$PackCheckIdentitySha256,
    [string]$FrozenSeal, [string]$FrozenSealSha256)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
. (Join-Path $PSScriptRoot 'ReleaseV2-Common.ps1')
try { Invoke-ReleaseV2Managed @PSBoundParameters }
catch {
    if ($_.Exception.Message -like 'Managed release*') { Write-Error $_.Exception.Message }
    else { Write-Error 'Managed release refused; phase=preflight. No writer was stopped by this attempt; inspect private reference and pin evidence.' }
    exit 1
}
