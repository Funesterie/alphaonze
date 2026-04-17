param()

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$bootstrapScript = Join-Path $launcherRoot 'bootstrap-ollama-gemma.ps1'
$localLauncher = Join-Path $launcherRoot 'a11-local.ps1'
$tunnelLauncher = Join-Path $launcherRoot 'start-cerbere-cloudflare-tunnel.ps1'

if (Test-Path -LiteralPath $bootstrapScript) {
  & $bootstrapScript
}

& $localLauncher desktop
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $tunnelLauncher
exit $LASTEXITCODE
