param([string]$FixtureRoot, [string]$Mode, [string]$Name, [string]$EncodedArguments)
$ErrorActionPreference = 'Stop'
$arguments = @(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedArguments))))
$invoke = @{}
for ($index = 0; $index -lt $arguments.Count; $index += 2) { $invoke[$arguments[$index].TrimStart('-')] = $arguments[$index + 1] }
$clock = [pscustomobject]@{ now = [DateTime]'2026-01-01T00:00:00Z' }
$now = { $clock.now }.GetNewClosure()
$awaitFile = {
    param([string]$Name)
    $file = Join-Path $FixtureRoot $Name
    $watcher = [IO.FileSystemWatcher]::new($FixtureRoot)
    $subscriptions = @()
    try {
        foreach ($eventName in @('Created', 'Changed', 'Renamed')) {
            $id = [Guid]::NewGuid().ToString('N')
            $subscriptions += $id
            $null = Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier $id
        }
        $watcher.EnableRaisingEvents = $true
        while (-not (Test-Path -LiteralPath $file)) {
            $event = Wait-Event
            Remove-Event -EventIdentifier $event.EventIdentifier
        }
    } finally {
        $watcher.Dispose()
        foreach ($id in $subscriptions) { Unregister-Event -SourceIdentifier $id; Remove-Event -SourceIdentifier $id -ErrorAction SilentlyContinue }
    }
}.GetNewClosure()
$wait = {
    param($Milliseconds)
    if ($Name -eq 'Start-Picker.ps1') {
        if ($Mode -eq 'slow') {
            & $awaitFile 'fixture-started'
            $clock.now = $clock.now.AddSeconds(301)
        } else { & $awaitFile 'fixture-ready' }
    } else {
        & $awaitFile 'fixture-ready'
        if (-not (Test-Path -LiteralPath (Join-Path $FixtureRoot 'shutdown-requested'))) { return }
        if ($Mode -eq 'forced') { $clock.now = $clock.now.AddSeconds(301) }
        else {
            [IO.File]::WriteAllText((Join-Path $FixtureRoot 'allow-drain'), 'release the accepted save')
            $runtime = Get-Content -LiteralPath (Join-Path $FixtureRoot '.local/server-runtime.json') -Raw | ConvertFrom-Json
            $owned = Get-Process -Id $runtime.pid -ErrorAction SilentlyContinue
            if ($owned) { $owned.WaitForExit() }
        }
    }
}.GetNewClosure()
$waitForExit = { param($Process, $Milliseconds) $Process.WaitForExit(); return $true }
& (Join-Path $FixtureRoot "scripts\$Name") @invoke -Clock $now -Wait $wait -WaitForExit $waitForExit
