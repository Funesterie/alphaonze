$ErrorActionPreference = 'Stop'

$legacyPath = $PSCommandPath
$backendRoot = Split-Path -Parent $legacyPath
$workspaceRoot = Split-Path -Parent $backendRoot
$launcherPath = Join-Path $workspaceRoot 'launchers\start-all-a11.ps1'

if (-not (Test-Path $launcherPath)) {
  Write-Error "Launcher global introuvable: $launcherPath"
  exit 1
}

Write-Host "[A11 LOCAL] Redirection vers le launcher global: $launcherPath"
& $launcherPath @args
exit $LASTEXITCODE
