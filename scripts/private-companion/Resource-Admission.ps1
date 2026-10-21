# Staged replacement only. Dot-sourcing performs no IO. This policy reserves
# memory before starting work; it never stops existing work under pressure.
Set-StrictMode -Version Latest

function New-ResourceAdmissionContext {
    $tools = 'C:\Users\User\Projects\chunk-picker-rs3\.local\claude-tools'
    return @{
        Root = Join-Path $tools 'locks/resource-admission-v2'
        HeavyLock = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'claude/C--Users-User-Projects-chunk-picker-rs3/981cc3e7-cbb2-4474-a361-2dc50f0e409b/scratchpad/speed-heavy.lock'))
        LightLock = Join-Path $tools 'locks/light.lock'
        FreeMemoryGiB = { (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).FreePhysicalMemory / 1MB }
    }
}

function Assert-ResourceAdmissionPath([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Admission paths must be absolute.' }
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Admission paths cannot contain links.' }
        }
        $parent = [IO.Directory]::GetParent($current)
        if (-not $parent) { break }
        $current = $parent.FullName
    }
}

function Open-ResourceAdmissionGate($Context) {
    foreach ($path in @($Context.Root, $Context.HeavyLock, $Context.LightLock)) { Assert-ResourceAdmissionPath $path }
    $null = New-Item -ItemType Directory -Path $Context.Root -Force -ErrorAction Stop
    $gate = Join-Path $Context.Root 'gate'
    Assert-ResourceAdmissionPath $gate
    try { return [IO.File]::Open($gate, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch [IO.IOException] {
        # Only sharing/locking violations mean another cooperating writer holds it.
        if (($_.Exception.HResult -band 65535) -in @(32,33)) { return $null }
        throw 'Cannot acquire resource admission gate.'
    }
}

function Get-ResourceProcessStart([int]$ProcessId) {
    try { return (Get-Process -Id $ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o') }
    catch { throw 'Resource admission has an unverifiable owner; manual inspection required.' }
}

function Read-ResourceAdmissionState($Context) {
    $file = Join-Path $Context.Root 'state.json'
    Assert-ResourceAdmissionPath $file
    if (-not (Test-Path -LiteralPath $file)) { return [pscustomobject]@{ schemaVersion=1; reservations=@() } }
    try {
        if ((Get-Item -LiteralPath $file).Length -gt 1048576) { throw 'Oversize state.' }
        $state = [IO.File]::ReadAllText($file) | ConvertFrom-Json
        if ($state.schemaVersion -ne 1 -or $null -eq $state.reservations) { throw 'Invalid state.' }
        $lanes = @(); $tokens = @()
        foreach ($entry in @($state.reservations)) {
            # PS7 can eagerly parse ISO JSON strings; PS5 leaves them as strings.
            if ($entry.processStartedAt -is [DateTime]) { $entry.processStartedAt = $entry.processStartedAt.ToUniversalTime().ToString('o') }
            $expected = if ($entry.lane -ceq 'heavy') { 4 } elseif ($entry.lane -ceq 'light') { 1 } else { throw 'Invalid lane.' }
            if ($entry.gib -ne $expected -or $entry.pid -isnot [ValueType] -or $entry.pid -le 0 -or $entry.pid -ne [int]$entry.pid -or $entry.token -cnotmatch '^[a-f0-9]{32}$' -or $entry.owner -isnot [string]) { throw 'Invalid reservation.' }
            if ($entry.lane -in $lanes -or $entry.token -in $tokens) { throw 'Duplicate reservation.' }
            if ((Get-ResourceProcessStart ([int]$entry.pid)) -cne $entry.processStartedAt) { throw 'Stale reservation.' }
            $lanes += $entry.lane; $tokens += $entry.token
        }
        return $state
    } catch { throw 'Resource admission state is stale or invalid; manual inspection required.' }
}

function Write-ResourceAdmissionState($Context, $State) {
    $file = Join-Path $Context.Root 'state.json'
    $temporary = Join-Path $Context.Root ([Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temporary, ($State | ConvertTo-Json -Depth 6 -Compress), [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $file) { [IO.File]::Replace($temporary, $file, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($temporary, $file) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Test-ResourceLaneOwner($Context, $Reservation) {
    $lanePath = if ($Reservation.lane -eq 'heavy') { $Context.HeavyLock } else { $Context.LightLock }
    Assert-ResourceAdmissionPath $lanePath
    $ownerFile = Join-Path $lanePath 'owner'
    Assert-ResourceAdmissionPath $ownerFile
    if (-not (Test-Path -LiteralPath $ownerFile -PathType Leaf)) { return $false }
    if (([IO.File]::ReadAllText($ownerFile)).Trim() -cne $Reservation.owner) { return $false }
    if ($Reservation.lane -eq 'heavy') {
        $jsonFile = Join-Path $lanePath 'owner.json'
        Assert-ResourceAdmissionPath $jsonFile
        try {
            $metadata = [IO.File]::ReadAllText($jsonFile) | ConvertFrom-Json
            if ($metadata.token -cne $Reservation.token -or $metadata.pid -ne $Reservation.pid -or $metadata.owner -cne $Reservation.owner) { return $false }
        } catch { return $false }
    }
    return $true
}

# Context injection is for isolated fixtures. Public wrappers accept only command
# arguments; no environment override can redirect production locks or telemetry.
function New-ResourceReservation([ValidateSet('heavy','light')][string]$Lane, $Context) {
    $gate = Open-ResourceAdmissionGate $Context
    if (-not $gate) { return $null }
    try {
        $state = Read-ResourceAdmissionState $Context
        foreach ($entry in @($state.reservations)) {
            if (-not (Test-ResourceLaneOwner $Context $entry)) { throw 'Admission lane ownership is ambiguous; manual inspection required.' }
        }
        foreach ($name in @('heavy','light')) {
            $lanePath = if ($name -eq 'heavy') { $Context.HeavyLock } else { $Context.LightLock }
            if (Test-Path -LiteralPath $lanePath) {
                # Old wrappers have no reservation record. Wait for their normal
                # release rather than guessing their outstanding memory budget.
                $ownerFile = Join-Path $lanePath 'owner'
                Assert-ResourceAdmissionPath $ownerFile
                $held = Get-Content -LiteralPath $ownerFile -Raw -ErrorAction Stop
                if ($held -notmatch 'pid=(\d+)' -or [long]$Matches[1] -gt [int]::MaxValue) { throw 'Admission lane has an unverifiable owner.' }
                $null = Get-ResourceProcessStart ([int]$Matches[1])
                if ($name -eq $Lane -or -not @($state.reservations | Where-Object lane -EQ $name).Count) { return $null }
            }
        }
        $budget = if ($Lane -eq 'heavy') { 4 } else { 1 }
        $reserved = 0
        foreach ($entry in @($state.reservations)) { $reserved += $entry.gib }
        $free = & $Context.FreeMemoryGiB
        if ($free -isnot [ValueType] -or [double]::IsNaN([double]$free) -or [double]::IsInfinity([double]$free) -or $free -lt 0) { throw 'Cannot verify free physical memory.' }
        if ($free -lt (3 + $reserved + $budget)) { return $null }
        $owner = if ($Lane -eq 'heavy') { "backlog pid=$PID $([DateTime]::UtcNow.ToString('o'))" } else { "light pid=$PID $([DateTime]::UtcNow.ToString('o'))" }
        $reservation = [pscustomobject]@{ lane=$Lane; gib=$budget; pid=$PID; processStartedAt=(Get-ResourceProcessStart $PID); token=[Guid]::NewGuid().ToString('N'); owner=$owner; startedAt=[DateTime]::UtcNow.ToString('o') }
        $lanePath = if ($Lane -eq 'heavy') { $Context.HeavyLock } else { $Context.LightLock }
        $null = New-Item -ItemType Directory -Path (Split-Path $lanePath) -Force
        try { $null = New-Item -ItemType Directory -Path $lanePath -ErrorAction Stop }
        catch { if (Test-Path -LiteralPath $lanePath -PathType Container) { return $null }; throw }
        try {
            Set-Content -LiteralPath (Join-Path $lanePath 'owner') -Value $owner -Encoding utf8
            if ($Lane -eq 'heavy') {
                @{ pid=$PID; script='.local/with-heavy.ps1'; startedAt=$reservation.startedAt; token=$reservation.token; owner=$owner } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $lanePath 'owner.json') -Encoding utf8
            }
            $state.reservations = @($state.reservations) + @($reservation)
            Write-ResourceAdmissionState $Context $state
            return $reservation
        } catch {
            if (Test-ResourceLaneOwner $Context $reservation) { Remove-Item -LiteralPath $lanePath -Recurse -Force }
            throw
        }
    } finally { $gate.Dispose() }
}

function Remove-ResourceReservation($Context, $Reservation) {
    $gate = $null
    while (-not $gate) { $gate = Open-ResourceAdmissionGate $Context; if (-not $gate) { Start-Sleep -Milliseconds 100 } }
    try {
        $state = Read-ResourceAdmissionState $Context
        $matching = @($state.reservations | Where-Object { $_.token -ceq $Reservation.token -and $_.pid -eq $PID -and $_.processStartedAt -ceq (Get-ResourceProcessStart $PID) -and $_.owner -ceq $Reservation.owner -and $_.lane -ceq $Reservation.lane })
        if ($matching.Count -ne 1 -or -not (Test-ResourceLaneOwner $Context $Reservation)) { throw 'Admission release refused: owner identity changed; manual inspection required.' }
        $lanePath = if ($Reservation.lane -eq 'heavy') { $Context.HeavyLock } else { $Context.LightLock }
        # Both lane and reservation are protected by the same gate. Leave state
        # fail-closed if filesystem cleanup cannot complete.
        Remove-Item -LiteralPath $lanePath -Recurse -Force -ErrorAction Stop
        $state.reservations = @($state.reservations | Where-Object token -CNE $Reservation.token)
        Write-ResourceAdmissionState $Context $state
    } finally { $gate.Dispose() }
}

function Invoke-ResourceAdmittedCommand([ValidateSet('heavy','light')][string]$Lane, [string]$Command, [string[]]$CommandArguments, $Context = (New-ResourceAdmissionContext)) {
    $reservation = $null; $announced = $false
    while (-not $reservation) {
        $reservation = New-ResourceReservation $Lane $Context
        if (-not $reservation) {
            if (-not $announced) { Write-Output 'Waiting for the shared work lane and memory reservation (3 GiB free floor).'; $announced = $true }
            Start-Sleep -Seconds 1
        }
    }
    $names = @('RS3_HEAVY_LOCK_PATH','RS3_HEAVY_LOCK_TOKEN','RS3_HEAVY_LOCK_PID','RS3_GAME_DATA_DIR','RS3_MAP_ASSETS_DIR','RS3_WORKER_IDLE_MS')
    $prior = @{}
    foreach ($name in $names) { $prior[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        if ($Lane -eq 'heavy') {
            $env:RS3_HEAVY_LOCK_PATH = $Context.HeavyLock
            $env:RS3_HEAVY_LOCK_TOKEN = $reservation.token
            $env:RS3_HEAVY_LOCK_PID = [string]$PID
        }
        $env:RS3_GAME_DATA_DIR = 'C:\Users\User\Projects\chunk-picker-rs3\.local\game-data'
        $env:RS3_MAP_ASSETS_DIR = 'C:\Users\User\Projects\chunk-picker-rs3\.local\map-assets'
        if ($Lane -eq 'light' -and -not $env:RS3_WORKER_IDLE_MS) { $env:RS3_WORKER_IDLE_MS = '20000' }
        # Native commands update the global automatic variable. A local variable
        # with this name would mask failures in Windows PowerShell and PS7.
        $global:LASTEXITCODE = 0
        & $Command @CommandArguments
        if ($global:LASTEXITCODE -ne 0) { throw "Admitted command failed with exit code $global:LASTEXITCODE." }
    } finally {
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $prior[$name], 'Process') }
        Remove-ResourceReservation $Context $reservation
    }
}
