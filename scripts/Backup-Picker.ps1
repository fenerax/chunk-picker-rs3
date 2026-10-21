# Daily off-machine backup of the portable gameplay save and separate feedback.
# Destination comes from -Destination or the first line of .local/backup-destination.
param([string]$Destination, [ValidateRange(1, 365)][int]$Keep = 30)
$ErrorActionPreference = 'Stop'
$backupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupLocal = Join-Path $backupRoot '.local'
$backupLog = Join-Path $backupLocal 'backup.log'
$backupStatus = Join-Path $backupLocal 'backup-status.json'
$runAt = [DateTime]::UtcNow.ToString('o')
$lastSuccessAt = $null
$token = $null
$work = $null
$target = $null
$parsed = $null

function Protect-BackupMessage([string]$Message) {
    if ($token) { $Message = $Message.Replace($token, '[redacted]') }
    $Message = $Message -replace '(?i)(Bearer\s+)\S+', '$1[redacted]'
    $Message = $Message -replace '(?i)([?&](?:token|key|invite|access_token)=)[^\s&#]+', '$1[redacted]'
    $Message = $Message -replace '[\r\n]+', ' '
    if ($Message.Length -gt 1000) { $Message = $Message.Substring(0, 1000) + ' [truncated]' }
    return $Message
}
function Write-BackupLog([string]$Message) {
    Add-Content -LiteralPath $backupLog -Value "$([DateTime]::Now.ToString('s')) $(Protect-BackupMessage $Message)"
}
function Write-BackupStatus([string]$Result, $Size = $null) {
    $status = [ordered]@{ version = 1; lastRunAt = $runAt; result = $Result; fileName = $null;
        byteSize = $Size; revision = $null; lastSuccessAt = $lastSuccessAt }
    if ($Result -eq 'success') {
        $status.fileName = [IO.Path]::GetFileName($target)
        $status.revision = $parsed.state.revision
        $status.lastSuccessAt = $runAt
    }
    $statusTemporary = Join-Path $backupLocal "backup-status-$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($statusTemporary, ($status | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($statusTemporary, $backupStatus, $true)
    } finally { if (Test-Path -LiteralPath $statusTemporary) { Remove-Item -LiteralPath $statusTemporary } }
}

try {
    New-Item -ItemType Directory -Path $backupLocal -Force | Out-Null
    if (Test-Path -LiteralPath $backupStatus) {
        try {
            $previous = Get-Content -LiteralPath $backupStatus -Raw | ConvertFrom-Json
            $previousSuccess = [DateTimeOffset]::MinValue
            if ($previous.lastSuccessAt -is [DateTime]) {
                $lastSuccessAt = $previous.lastSuccessAt.ToUniversalTime().ToString('o')
            } elseif ([DateTimeOffset]::TryParse([string]$previous.lastSuccessAt, [ref]$previousSuccess)) {
                $lastSuccessAt = $previousSuccess.UtcDateTime.ToString('o')
            }
        } catch { }
    }
    if (-not $Destination) {
        $destinationFile = Join-Path $backupLocal 'backup-destination'
        if (-not (Test-Path -LiteralPath $destinationFile)) { throw 'No backup destination: pass -Destination or write it to .local/backup-destination.' }
        $Destination = (Get-Content -LiteralPath $destinationFile -TotalCount 1).Trim()
    }
    if ([string]::IsNullOrWhiteSpace($Destination)) { throw 'The backup destination is empty.' }
    $Destination = [IO.Path]::GetFullPath($Destination)
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $runtime = Get-Content -LiteralPath (Join-Path $backupLocal 'server-runtime.json') -Raw | ConvertFrom-Json
    $token = (Get-Content -LiteralPath (Join-Path $backupLocal 'duo/access-token') -TotalCount 1).Trim()
    $stamp = "rs3-chunk-picker-$([DateTime]::Now.ToString('yyyy-MM-dd'))"
    $work = Join-Path $backupLocal "backup-run-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $work | Out-Null
    $staged = Join-Path $work "$stamp.json"
    Invoke-WebRequest -Uri "http://$($runtime.hostAddress):$($runtime.port)/api/backup" -Headers @{ Authorization = "Bearer $token" } -OutFile $staged -TimeoutSec 120 | Out-Null
    $parsed = Get-Content -LiteralPath $staged -Raw | ConvertFrom-Json -AsHashtable
    if ($parsed.format -ne 'rs3-chunk-picker' -or -not $parsed.state.members) { throw 'The picker returned something other than a full backup.' }
    $parts = @($staged)
    $feedbackSource = Join-Path $backupLocal 'duo/feedback.json'
    if (Test-Path -LiteralPath $feedbackSource) {
        $feedbackCopy = Join-Path $work "$stamp-feedback.json"
        Copy-Item -LiteralPath $feedbackSource -Destination $feedbackCopy
        $parts += $feedbackCopy
    }
    $archive = Join-Path $work "$stamp.zip"
    Compress-Archive -LiteralPath $parts -DestinationPath $archive -CompressionLevel Optimal
    $target = Join-Path $Destination "$stamp.zip"
    Move-Item -LiteralPath $archive -Destination $target -Force
    # Prune only direct regular files in the explicit destination with our exact name.
    $destinationPrefix = $Destination.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $old = Get-ChildItem -LiteralPath $Destination -File | Where-Object { $_.Name -match '^rs3-chunk-picker-\d{4}-\d{2}-\d{2}\.zip$' -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
        Sort-Object Name -Descending | Select-Object -Skip $Keep
    foreach ($file in $old) {
        $resolved = [IO.Path]::GetFullPath($file.FullName)
        if (-not $resolved.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to prune a file outside the backup destination.' }
        Remove-Item -LiteralPath $resolved
    }
    $size = (Get-Item -LiteralPath $target).Length
    Write-BackupStatus 'success' $size
    $lastSuccessAt = $runAt
    Write-BackupLog "Saved $(Split-Path $target -Leaf) ($([math]::Round($size / 1KB)) KB, revision $($parsed.state.revision))."
    Write-Output "Saved $target ($([math]::Round($size / 1KB)) KB, revision $($parsed.state.revision))."
} catch {
    $message = Protect-BackupMessage $_.Exception.Message
    Write-BackupStatus 'failed'
    Write-BackupLog "Backup failed: $message"
    throw "Backup failed: $message"
} finally {
    # Local work directory cleanup is non-recursive and checks its owning parent.
    if ($work -and (Test-Path -LiteralPath $work)) {
        $resolvedWork = [IO.Path]::GetFullPath($work)
        if ([IO.Path]::GetDirectoryName($resolvedWork) -eq $backupLocal -and [IO.Path]::GetFileName($resolvedWork) -match '^backup-run-[a-f0-9]{32}$') {
            Get-ChildItem -LiteralPath $resolvedWork -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
            Remove-Item -LiteralPath $resolvedWork
        }
    }
}
