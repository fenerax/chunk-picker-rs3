# Shared ownership checks for the Windows start/stop helpers.
function Enter-PickerHelperLock {
    param([string]$Directory, [int]$TimeoutSeconds = 5)
    $pickerLockPath = Join-Path $Directory 'helper.lock'
    $pickerLockUntil = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try { return [IO.File]::Open($pickerLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] { Start-Sleep -Milliseconds 100 }
    } while ([DateTime]::UtcNow -lt $pickerLockUntil)
    throw 'Another picker helper is changing process ownership. Retry in a moment.'
}

function Write-PickerRuntime {
    param([string]$Path, $Record)
    $pickerTemporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $pickerPreviousRuntime = "$pickerTemporary.previous"
    try {
        [IO.File]::WriteAllText($pickerTemporary, ($Record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        # Windows PowerShell 5 binds a null backup argument as an empty path.
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($pickerTemporary, $Path, $pickerPreviousRuntime) }
        else { [IO.File]::Move($pickerTemporary, $Path) }
    } finally {
        if (Test-Path -LiteralPath $pickerTemporary) { Remove-Item -LiteralPath $pickerTemporary }
        if (Test-Path -LiteralPath $pickerPreviousRuntime) { Remove-Item -LiteralPath $pickerPreviousRuntime }
    }
}

function Read-PickerRuntime {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $pickerRecord = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        if (-not $pickerRecord -or [int]$pickerRecord.pid -lt 1) { throw 'Invalid process id.' }
        if ($pickerRecord.hostAddress -notmatch '^(?:127\.0\.0\.1|100\.\d+\.\d+\.\d+)$' -or [int]$pickerRecord.port -lt 1024 -or [int]$pickerRecord.port -gt 65535) {
            throw 'Invalid private listener address.'
        }
        # PowerShell 7 turns ISO timestamps into DateTime; keep the round-trip text form written by Start-Picker.
        foreach ($pickerField in 'processStartedAt', 'startedAt') {
            if ($pickerRecord.$pickerField -is [DateTime]) { $pickerRecord.$pickerField = $pickerRecord.$pickerField.ToUniversalTime().ToString('o') }
        }
        return $pickerRecord
    } catch { throw 'The picker runtime record is malformed. Inspect .local/server-runtime.json before starting or stopping.' }
}

function Test-PickerProcessOwnership {
    param($Process, [string]$Root, [string]$DataDirectory, [string]$NodePath, [string]$StartedAt)
    if (-not $Process -or -not $Process.CommandLine) { return $false }
    $pickerServerPattern = '(?i)(?:^|\s)"?' + [regex]::Escape((Join-Path $Root 'app\server.mjs')) + '"?(?:\s|$)'
    $pickerDataPattern = '(?i)(?:^|\s)--data-dir\s+"?' + [regex]::Escape($DataDirectory) + '"?(?:\s|$)'
    if ($Process.CommandLine -notmatch $pickerServerPattern -or $Process.CommandLine -notmatch $pickerDataPattern) { return $false }
    if ($NodePath -and $Process.ExecutablePath -and $Process.ExecutablePath -ine $NodePath) { return $false }
    if ($StartedAt) {
        try {
            $pickerExpected = [DateTime]::Parse($StartedAt).ToUniversalTime()
            $pickerActual = ([DateTime]$Process.CreationDate).ToUniversalTime()
            if ([Math]::Abs(($pickerExpected - $pickerActual).TotalMilliseconds) -gt 2) { return $false }
        } catch { return $false }
    }
    return $true
}

function Get-PickerRecordedProcess {
    param($Record)
    if (-not $Record) { return $null }
    return Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Record.pid)" -ErrorAction Stop
}

function Get-PickerAccessToken {
    param([string]$DataDirectory)
    $pickerTokenPath = Join-Path $DataDirectory 'access-token'
    if (-not (Test-Path -LiteralPath $pickerTokenPath)) { return $null }
    $pickerToken = (Get-Content -LiteralPath $pickerTokenPath -Raw).Trim()
    if ($pickerToken -notmatch '^[A-Za-z0-9_-]{43}$') { return $null }
    return $pickerToken
}
