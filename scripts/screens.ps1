# npm entrypoint: use the shared one-session light lock on this Windows host.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
if ($args -contains '--help' -or $args -contains '-h') {
  & node (Join-Path $PSScriptRoot 'screens.mjs') @args
  exit $LASTEXITCODE
}
$previousOwner = $env:RS3_SCREENS_LIGHT_PID
try {
  # Also support the usual explicit with-light.ps1 npm run screens invocation.
  # Re-enter only a lock held by an ancestor of this exact process tree.
  $common = (& git -C $taskRoot rev-parse --path-format=absolute --git-common-dir).Trim()
  $ownerFile = Join-Path (Split-Path $common -Parent) '.local/claude-tools/locks/light.lock/owner'
  $held = Get-Content -LiteralPath $ownerFile -Raw -ErrorAction SilentlyContinue
  $inherited = $false
  if ($held -match '^\s*light pid=(\d+) ') {
    $heldPid = [int]$Matches[1]
    $parents = @{}
    foreach ($processRow in Get-CimInstance Win32_Process) { $parents[[int]$processRow.ProcessId] = [int]$processRow.ParentProcessId }
    $ancestor = $PID
    for ($depth = 0; $depth -lt 64 -and $ancestor -gt 0; $depth++) {
      if ($ancestor -eq $heldPid) { $inherited = $true; break }
      if (!$parents.ContainsKey($ancestor)) { break }
      $ancestor = $parents[$ancestor]
    }
  }
  if ($inherited) {
    $env:RS3_SCREENS_LIGHT_PID = "$heldPid"
    & node (Join-Path $PSScriptRoot 'screens.mjs') @args
    exit $LASTEXITCODE
  }
  $env:RS3_SCREENS_LIGHT_PID = "$PID"
  & (Join-Path $taskRoot '.local/with-light.ps1') node (Join-Path $PSScriptRoot 'screens.mjs') @args
} finally { $env:RS3_SCREENS_LIGHT_PID = $previousOwner }
