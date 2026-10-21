# Pure ownership query: no launching, stopping, lock deletion or configuration IO.
Set-StrictMode -Version Latest
function Get-BridgeExactProcess($Record, $Expected) {
    if (-not $Record -or $Record.pid -isnot [int] -or $Record.pid -lt 1 -or -not $Record.processStartedAt) { throw 'Missing exact process identity.' }
    foreach ($key in @('configHash','topologyHash','kind','commandLine')) { if ($Record.$key -cne $Expected.$key) { throw 'Runtime record does not match the pinned process contract.' } }
    foreach ($key in @('executable','script')) { if ($Record.$key -ine $Expected.$key) { throw 'Runtime record does not match the pinned executable contract.' } }
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $($Record.pid)"
    if (-not $process) { return $null }
    if (-not $process.ExecutablePath -or $process.ExecutablePath -ine $Expected.executable -or $process.CommandLine -cne $Expected.commandLine -or
        ([DateTime]$process.CreationDate).ToUniversalTime().Ticks -ne [DateTime]::Parse($Record.processStartedAt).ToUniversalTime().Ticks) { throw 'PID, process start or command identity changed. No process action was taken.' }
    return $process
}
