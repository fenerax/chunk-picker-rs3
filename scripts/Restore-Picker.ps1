# Restore a daily ZIP or portable full JSON/JSON.GZ into a new folder, offline.
# Existing folders are always refused. This script never starts/stops a picker.
param(
    [Parameter(Mandatory=$true)][string]$BackupPath,
    [string]$TargetFolder
)
$ErrorActionPreference = 'Stop'
$restoreRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$restoreLocal = Join-Path $restoreRoot '.local'
$restoreStage = $null
$restoreArchive = $null
$restoreLimit = 256MB
function Assert-RestoreOrdinaryPath([string]$Path) {
    $restoreCursor = [IO.Path]::GetFullPath($Path)
    while ($restoreCursor) {
        $restoreItem = Get-Item -LiteralPath $restoreCursor -Force -ErrorAction Stop
        if ($restoreItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected staging path.' }
        $restoreCursor = [IO.Path]::GetDirectoryName($restoreCursor)
    }
}
try {
    $restoreInput = Get-Item -LiteralPath $BackupPath -ErrorAction Stop
    # OneDrive regular files also carry ReparsePoint. They are read-only inputs;
    # refuse actual link redirects, while allowing OneDrive to hydrate the ZIP.
    if ($restoreInput.PSIsContainer -or $restoreInput.LinkType -in @('SymbolicLink', 'Junction') -or $restoreInput.Length -gt $restoreLimit) { throw 'Choose a regular backup file under 256 MiB.' }
    if (-not $TargetFolder) {
        New-Item -ItemType Directory -Path $restoreLocal -Force | Out-Null
        $TargetFolder = Join-Path $restoreLocal "restore-$([DateTime]::Now.ToString('yyyyMMdd-HHmmss'))-$([guid]::NewGuid().ToString('N'))"
    }
    $TargetFolder = [IO.Path]::GetFullPath($TargetFolder)
    if (Test-Path -LiteralPath $TargetFolder) { throw 'Target already exists. Choose a new folder; this helper never replaces a save.' }
    $restoreDocument = $restoreInput.FullName
    $restoreFeedback = $null
    if ($restoreInput.Extension -ieq '.zip') {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $restoreArchive = [IO.Compression.ZipFile]::OpenRead($restoreInput.FullName)
        # Allow only Backup-Picker's exact flat pair; never extract paths or credentials.
        $restoreEntries = @($restoreArchive.Entries)
        $restoreGameplay = @($restoreEntries | Where-Object { $_.FullName -cmatch '^rs3-chunk-picker-\d{4}-\d{2}-\d{2}\.json$' })
        if ($restoreGameplay.Count -ne 1 -or $restoreEntries.Count -gt 2) { throw 'ZIP must contain one daily full backup and optional matching feedback.' }
        $restoreFeedbackName = $restoreGameplay[0].FullName.Replace('.json', '-feedback.json')
        $restoreSeen = @{}
        $restoreTotal = 0L
        foreach ($restoreEntry in $restoreEntries) {
            if ($restoreEntry.FullName -cne $restoreGameplay[0].FullName -and $restoreEntry.FullName -cne $restoreFeedbackName) { throw 'Unexpected ZIP entry.' }
            if ($restoreSeen.ContainsKey($restoreEntry.FullName)) { throw 'Duplicate ZIP entry.' }
            $restoreSeen[$restoreEntry.FullName] = $true
            $restoreTotal += $restoreEntry.Length
            if ($restoreEntry.Length -gt $restoreLimit -or $restoreTotal -gt $restoreLimit) { throw 'Unpacked backup exceeds 256 MiB.' }
        }
        $restoreStage = Join-Path ([IO.Path]::GetTempPath()) "rs3-restore-$([guid]::NewGuid().ToString('N'))"
        Assert-RestoreOrdinaryPath ([IO.Path]::GetDirectoryName($restoreStage))
        New-Item -ItemType Directory -Path $restoreStage | Out-Null
        foreach ($restoreEntry in $restoreEntries) {
            $restoreFile = Join-Path $restoreStage $restoreEntry.FullName
            $restoreReader = $restoreEntry.Open()
            $restoreWriter = [IO.File]::Open($restoreFile, [IO.FileMode]::CreateNew)
            try {
                $restoreBuffer = [byte[]]::new(65536)
                $restoreWritten = 0L
                while (($restoreRead = $restoreReader.Read($restoreBuffer, 0, $restoreBuffer.Length)) -gt 0) {
                    $restoreWritten += $restoreRead
                    if ($restoreWritten -gt $restoreEntry.Length -or $restoreWritten -gt $restoreLimit) { throw 'Unpacked backup exceeds its declared size.' }
                    $restoreWriter.Write($restoreBuffer, 0, $restoreRead)
                }
                if ($restoreWritten -ne $restoreEntry.Length) { throw 'Incomplete ZIP entry.' }
            } finally { $restoreReader.Dispose(); $restoreWriter.Dispose() }
        }
        $restoreDocument = Join-Path $restoreStage $restoreGameplay[0].FullName
        if ($restoreSeen.ContainsKey($restoreFeedbackName)) { $restoreFeedback = Join-Path $restoreStage $restoreFeedbackName }
    } elseif ($restoreInput.Name -notmatch '\.json(?:\.gz)?$') { throw 'Choose a daily ZIP or portable full JSON/JSON.GZ backup.' }
    $restoreArguments = @((Join-Path $PSScriptRoot 'restore-picker.mjs'), '--backup', $restoreDocument, '--target', $TargetFolder)
    if ($restoreFeedback) { $restoreArguments += @('--feedback', $restoreFeedback) }
    & node @restoreArguments
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed; no existing save was changed.' }
} finally {
    if ($restoreArchive) { $restoreArchive.Dispose() }
    if ($restoreStage -and (Test-Path -LiteralPath $restoreStage)) {
        $restoreResolved = [IO.Path]::GetFullPath($restoreStage)
        if ([IO.Path]::GetDirectoryName($restoreResolved) -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($restoreResolved) -notmatch '^rs3-restore-[a-f0-9]{32}$') { throw 'Refusing cleanup outside the owned staging directory.' }
        Assert-RestoreOrdinaryPath $restoreResolved
        Remove-Item -LiteralPath $restoreResolved -Recurse -Force
    }
}
