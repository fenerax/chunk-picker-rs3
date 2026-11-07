param([Parameter(Position=0)][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
# Keep native PowerShell ownership without loading host modules into the fresh
# sanitized profile. The exclusive owner file is the fixture's acquisition.
$ownerDirectory = [IO.Path]::Combine([IO.Path]::GetDirectoryName($PSScriptRoot), '.local', 'fixture-owner')
[void][IO.Directory]::CreateDirectory($ownerDirectory)
$ownerFile = [IO.Path]::Combine($ownerDirectory, 'owner.json')
$ownerStream = [IO.File]::Open($ownerFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$token = [Guid]::NewGuid().ToString('N')
try {
  $bytes = [Text.Encoding]::UTF8.GetBytes('{"pid":' + $PID + ',"token":"' + $token + '"}')
  $ownerStream.Write($bytes, 0, $bytes.Length)
  $ownerStream.Flush()
  $env:RS3_HEAVY_LOCK_PATH=$ownerDirectory
  $env:RS3_HEAVY_LOCK_PID=[string]$PID
  $env:RS3_HEAVY_LOCK_TOKEN=$token
  & $Command @Rest
  $result=$LASTEXITCODE
} finally {
  $ownerStream.Dispose()
  [IO.File]::Delete($ownerFile)
  [IO.Directory]::Delete($ownerDirectory)
}
exit $result
