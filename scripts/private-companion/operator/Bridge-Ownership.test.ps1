Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Bridge-Ownership.ps1')
$node=(Get-Command node.exe).Source
$child=[Diagnostics.Process]::new(); $child.StartInfo=[Diagnostics.ProcessStartInfo]::new()
$child.StartInfo.FileName=$node; $child.StartInfo.Arguments='-e "setTimeout(()=>{},30000)"'
$child.StartInfo.UseShellExecute=$false; $child.StartInfo.CreateNoWindow=$true
$null=$child.Start(); $child.Handle | Out-Null
$checks=0
try {
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
    $record=[pscustomobject]@{pid=[int]$child.Id;processStartedAt=([DateTime]$process.CreationDate).ToUniversalTime().ToString('o');executable=$node;commandLine=$process.CommandLine;configHash=('a'*64);topologyHash=('b'*64);kind='test';script='tiny-inline-fixture'}
    $expected=$record | Select-Object configHash,topologyHash,kind,executable,commandLine,script
    if ((Get-BridgeExactProcess $record $expected).ProcessId -ne $child.Id) { throw 'Exact child identity failed.' }; $checks++
    foreach ($field in @('processStartedAt','configHash','commandLine')) {
        $changed=$record | Select-Object *
        if ($field -eq 'processStartedAt') { $changed.$field=[DateTime]::Parse($record.$field).AddMilliseconds(1).ToString('o') } else { $changed.$field='changed' }
        $refused=$false; try { $null=Get-BridgeExactProcess $changed $expected } catch { $refused=$true }
        if (-not $refused) { throw 'Changed process identity was accepted.' }; $checks++
    }
    # This is only the retained child handle created by this disposable test.
    $child.Kill(); $null=$child.WaitForExit(5000)
    if ($null -ne (Get-BridgeExactProcess $record $expected)) { throw 'Verified dead child was not observed dead.' }; $checks++
    [ordered]@{checks=$checks;passed=$true;servers=0;foreignProcessActions=0} | ConvertTo-Json -Compress
} finally { if (-not $child.HasExited) { $child.Kill(); $null=$child.WaitForExit(5000) }; $child.Dispose() }
