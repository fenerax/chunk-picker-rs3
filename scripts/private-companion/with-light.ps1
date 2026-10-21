# Plain arguments preserve command flags such as node -e.
if ($args.Count -lt 1) { throw 'Usage: with-light.ps1 <command> [args...]' }
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Resource-Admission.ps1"
Invoke-ResourceAdmittedCommand -Lane light -Command $args[0] -CommandArguments @($args | Select-Object -Skip 1)
