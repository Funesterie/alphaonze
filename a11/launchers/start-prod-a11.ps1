param(
  [switch]$NoOpen,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$onlineLauncher = Join-Path $launcherRoot 'start-online-a11.ps1'

if (-not (Test-Path $onlineLauncher)) {
  throw "Launcher online introuvable: $onlineLauncher"
}

Write-Host '[A11 PROD] start-prod-a11.ps1 est maintenant un wrapper vers start-online-a11.ps1.'
Write-Host '[A11 PROD] La structure canonique garde le local dans a11\\runtime et la prod sur Netlify/Railway.'

$argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $onlineLauncher)
if ($NoOpen) {
  $argsList += '-NoOpen'
}

& powershell @argsList
$exitCode = $LASTEXITCODE

if (-not $NoPause) {
  [void](Read-Host 'Appuie sur Entree pour fermer ce lanceur')
}

exit $exitCode
