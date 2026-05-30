Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$launcher = Join-Path $PSScriptRoot "funesterie-autostart.ps1"
if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Funesterie launcher introuvable: $launcher"
}

# Compatibility wrapper kept for the existing Windows scheduled task.
$env:A11_START_PODMAN = "1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
exit $LASTEXITCODE
