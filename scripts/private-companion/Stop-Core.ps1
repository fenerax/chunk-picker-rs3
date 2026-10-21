param([Parameter(Mandatory=$true)][string]$Config, [switch]$DryRun, [switch]$PreservePause,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 30)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
try {
    $context = Read-OperatorConfig $Config -ForStop
    if ($DryRun) { Show-OperatorPlan $context 'stop'; return }
    Stop-OperatorCore $context $TimeoutSeconds -PreservePause:$PreservePause
} catch { Write-Error 'Stop refused. Verify the exact runtime owner, input pins and storage lock; no forced termination or lock deletion is attempted.'; exit 1 }
