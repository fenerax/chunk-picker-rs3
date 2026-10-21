# Initial handover only. Claude invokes one named step at a time.
param([Parameter(Mandatory=$true)][string]$Plan,
    [Parameter(Mandatory=$true)][ValidateSet('preflight','pause','stop-old','snapshot','bind','start-new','verify','register-tasks','unpause')][string]$Step,
    [switch]$DryRun, [switch]$Retry)
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'cutover-runbook.mjs'), '--plan', $Plan, '--step', $Step)
if ($DryRun) { $arguments += '--dry-run' }
if ($Retry) { $arguments += '--retry' }
& node @arguments
exit $LASTEXITCODE
