param([Parameter(Mandatory=$true)][string]$Config, [switch]$DryRun, [switch]$PreservePause,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
try {
    $context = Read-OperatorConfig $Config -ForDryRun:$DryRun
    if ($DryRun) { Show-OperatorPlan $context 'start'; return }
    Start-OperatorCore $context $TimeoutSeconds -PreservePause:$PreservePause
} catch { Write-Error 'Start refused. Inspect configuration pins, existing runtime ownership and private operator documentation. No credential or origin is printed.'; exit 1 }
