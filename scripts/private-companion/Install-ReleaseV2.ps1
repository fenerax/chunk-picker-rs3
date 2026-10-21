# One-time reversible installation. DryRun performs no writes or scheduler changes.
[CmdletBinding(DefaultParameterSetName='Install')]
param([Parameter(Mandatory=$true,ParameterSetName='Install')][Parameter(Mandatory=$true,ParameterSetName='UpdateHelpers')][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true,ParameterSetName='Install')][string]$InitialPointer,
    [Parameter(Mandatory=$true,ParameterSetName='Install')][string]$WatchdogTaskName,
    [Parameter(Mandatory=$true,ParameterSetName='Install')][string]$BackupTaskName,
    [Parameter(Mandatory=$true,ParameterSetName='Restore')][switch]$Restore,
    [Parameter(Mandatory=$true,ParameterSetName='UpdateHelpers')][switch]$UpdateHelpers,
    [Parameter(Mandatory=$true,ParameterSetName='RestoreHelpers')][switch]$RestoreHelpers,
    [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Operator-Common.ps1')
. (Join-Path $PSScriptRoot 'ReleaseV2-Common.ps1')
. (Join-Path $PSScriptRoot 'Task-Common.ps1')
. (Join-Path $PSScriptRoot 'InstallV2-Common.ps1')
try { if ($UpdateHelpers -or $RestoreHelpers) { Invoke-ReleaseV2HelperUpdate @PSBoundParameters } else { Invoke-ReleaseV2Installation @PSBoundParameters } }
catch { Write-Error 'Release v2 installation refused. Retain installation snapshots and inspect exact task/file drift; no credential or origin is printed.'; exit 1 }
