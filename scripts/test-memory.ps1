param([Parameter(Mandatory=$true)][int]$RunnerPid)
$ErrorActionPreference = 'Stop'
$peakBytes = 0L
$peakFiles = @()
$samples = 0
$observations = @()
$previousCpu = @{}
$previousAt = Get-Date
$logicalCpus = [Environment]::ProcessorCount
while (Get-Process -Id $RunnerPid -ErrorAction SilentlyContinue) {
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
  $owned = [Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($RunnerPid)
  do {
    $added = $false
    foreach ($node in $nodes) {
      if ($owned.Contains([int]$node.ParentProcessId)) {
        if ($owned.Add([int]$node.ProcessId)) { $added = $true }
      }
    }
  } while ($added)
  $bytes = 0L
  foreach ($node in $nodes) {
    if ($owned.Contains([int]$node.ProcessId)) { $bytes += [long]$node.WorkingSetSize }
  }
  if ($bytes -gt $peakBytes) {
    $peakBytes = $bytes
    $peakFiles = @($nodes | Where-Object { $owned.Contains([int]$_.ProcessId) -and [int]$_.ProcessId -ne $RunnerPid } | ForEach-Object {
      if ($_.CommandLine -match 'tests[\\/](?<testFile>[^"\s\\/]+\.test\.mjs)') { $Matches.testFile }
    })
  }
  $now = Get-Date
  $seconds = ($now - $previousAt).TotalSeconds
  $processes = @(Get-Process -ErrorAction SilentlyContinue)
  $external = @()
  $externalCpu = 0.0
  $ownedCpu = 0.0
  foreach ($process in $processes) {
    $cpu = $process.CPU
    if ($null -eq $cpu) { continue }
    $key = "$($process.Id):$($process.ProcessName)"
    if ($previousCpu.ContainsKey($key) -and $seconds -gt 0) {
      $delta = [Math]::Max([double]0, [double]($cpu - $previousCpu[$key]))
      if ($owned.Contains($process.Id)) { $ownedCpu += $delta }
      elseif ($delta -gt 0.01 -and $process.Id -ne $PID -and $process.ProcessName -ne 'Idle') {
        # Names/PIDs only: command lines can contain invitation credentials.
        $external += @{ pid=$process.Id; name=$process.ProcessName; cpuSeconds=$delta }
        $externalCpu += $delta
      }
    }
    $previousCpu[$key] = $cpu
  }
  $directTests = @($nodes | Where-Object { [int]$_.ParentProcessId -eq $RunnerPid -and $_.CommandLine -match '\.test\.mjs' })
  $os = Get-CimInstance Win32_OperatingSystem
  $observations += @{ at=$now.ToUniversalTime().ToString('o'); seconds=$seconds; workingSetBytes=$bytes;
    activeTestFiles=$directTests.Count; ownedNodeProcesses=$owned.Count; ownedCpuSeconds=$ownedCpu;
    freeMemoryBytes=[long]$os.FreePhysicalMemory * 1024;
    externalCpuSeconds=$externalCpu;
    externalTop=@($external | Sort-Object { $_.cpuSeconds } -Descending | Select-Object -First 5) }
  $previousAt = $now
  $samples++
  Start-Sleep -Seconds 2
}
@{ peakWorkingSetBytes=$peakBytes; peakFiles=$peakFiles; samples=$samples; intervalSeconds=2;
  logicalCpus=$logicalCpus; observations=$observations } | ConvertTo-Json -Compress -Depth 6
