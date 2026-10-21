param([Parameter(Mandatory=$true)][int]$RootPid)
$ErrorActionPreference = 'Stop'
# Sum working sets for this exact runner and all descendants, never by name.
# Includes renderer/utility descendants and the lightweight sampler itself.
while (Get-Process -Id $RootPid -ErrorAction SilentlyContinue) {
  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize)
  $owned = [System.Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($RootPid)
  do {
    $added = $false
    foreach ($row in $rows) {
      if ($owned.Contains([int]$row.ParentProcessId) -and $owned.Add([int]$row.ProcessId)) { $added = $true }
    }
  } while ($added)
  [long]$total = 0
  foreach ($row in $rows) { if ($owned.Contains([int]$row.ProcessId)) { $total += [long]$row.WorkingSetSize } }
  Write-Output ('{"rssBytes":' + $total + ',"processes":' + $owned.Count + '}')
  Start-Sleep -Seconds 2
}
