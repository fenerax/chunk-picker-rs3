# Invoke the unchanged matching old helper, while denying its timeout Kill branch.
# Dot-sourcing is inert. This adapter is only for the initial legacy handover.
function Invoke-LegacyGracefulStop([string]$Script, [int]$TimeoutSeconds = 300) {
    # The retained helper's only Get-Process call is its owned-process Kill path.
    # Keep its OS handle and timestamp checks but replace Kill with a refusal.
    # This never wraps or alters the picker process itself.
    function Get-Process {
        param([int]$Id, $ErrorAction)
        $native = Microsoft.PowerShell.Management\Get-Process -Id $Id -ErrorAction SilentlyContinue
        if (-not $native) { return $null }
        $null = $native.Handle
        $handle = [pscustomobject]@{ Handle=$native.Handle; StartTime=$native.StartTime; NativeHandleOwner=$native }
        $handle | Add-Member -MemberType ScriptMethod -Name Kill -Value { throw 'Legacy graceful stop timed out. Forced termination is disabled; inspect the retained writer and locks.' }
        return $handle
    }
    $LASTEXITCODE = 0
    & $Script -TimeoutSeconds $TimeoutSeconds
    if ($LASTEXITCODE -ne 0) { throw 'Matching original stop helper refused.' }
}
