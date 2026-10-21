# Plain arguments preserve command flags such as node -e.
if ($args.Count -lt 1) { throw 'Usage: with-heavy.ps1 <command> [args...]' }
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/Resource-Admission.ps1"
Invoke-ResourceAdmittedCommand -Lane heavy -Command $args[0] -CommandArguments @($args | Select-Object -Skip 1)
