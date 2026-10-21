param([Parameter(Mandatory=$true)][string]$Config, [Parameter(Mandatory=$true)][string]$PreviousConfig,
    [switch]$DryRun, [ValidateRange(1, 300)][int]$TimeoutSeconds = 60)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
try {
    # Validate both sides before touching the new process.
    $context = Read-OperatorConfig $Config -ForStop
    $previous = Read-OperatorConfig $PreviousConfig
    Assert-OperatorRollbackPair $context $previous
    if ($DryRun) { Show-OperatorPlan $context 'rollback-stop'; Show-OperatorPlan $previous 'rollback-start'; return }
    Stop-OperatorCore $context $TimeoutSeconds
    Start-OperatorCore $previous $TimeoutSeconds
} catch { Write-Error 'Rollback refused or incomplete. Inspect the matching runtime owner. Saves, credentials and revocations are never copied or overwritten.'; exit 1 }
