# Never restores a snapshot or replaces accepted progress. One named step per call.
param([Parameter(Mandatory=$true)][string]$Plan,
    [Parameter(Mandatory=$true)][ValidateSet('pause','stop-new','verify-previous','restore-tasks','start-old','unpause')][string]$Step,
    [switch]$DryRun, [switch]$Retry)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'cutover-runbook.mjs'), '--plan', $Plan, '--step', $Step, '--rollback')
if ($DryRun) { $arguments += '--dry-run' }
if ($Retry) { $arguments += '--retry' }
& node @arguments
exit $LASTEXITCODE
