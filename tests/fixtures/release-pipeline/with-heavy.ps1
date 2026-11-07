param([Parameter(Position=0)][string]$Command,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)
$ErrorActionPreference = 'Stop'
$ownerDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/fixture-owner'
New-Item -ItemType Directory -Path $ownerDirectory -ErrorAction Stop | Out-Null
$token = [Guid]::NewGuid().ToString('N')
@{pid=$PID;token=$token} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ownerDirectory 'owner.json')
$env:RS3_HEAVY_LOCK_PATH=$ownerDirectory
$env:RS3_HEAVY_LOCK_PID=[string]$PID
$env:RS3_HEAVY_LOCK_TOKEN=$token
try { & $Command @Rest; $result=$LASTEXITCODE }
finally { Remove-Item -LiteralPath $ownerDirectory -Recurse -Force }
exit $result
