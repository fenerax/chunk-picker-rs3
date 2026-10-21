param([Parameter(Mandatory=$true)][string]$Plan, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
. (Join-Path $PSScriptRoot 'Task-Common.ps1')
try { Invoke-CoreTaskRestoration (Read-CoreTaskPlan $Plan -ForRestore) -DryRun:$DryRun }
catch { Write-Error 'Task restoration refused or failed. Inspect pinned plan inputs and exact task drift; keep cutover paused until both definitions are verified.'; exit 1 }
