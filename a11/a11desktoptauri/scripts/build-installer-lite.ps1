param(
  [switch]$SkipUiBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path $tauriCli)) {
  throw "Tauri CLI introuvable. Lance d'abord 'npm install' dans $projectRoot."
}

$syncArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $PSScriptRoot 'sync-local-package.ps1'),
  '-LiteInstaller'
)

if ($SkipUiBuild) {
  $syncArgs += '-SkipUiBuild'
}

& powershell.exe @syncArgs
if ($LASTEXITCODE -ne 0) {
  throw "La preparation du runtime installer-lite a echoue."
}

Push-Location $projectRoot
try {
  & $tauriCli build
  if ($LASTEXITCODE -ne 0) {
    throw "Le build Tauri installer-lite a echoue."
  }
}
finally {
  Pop-Location
}

$nsisDir = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis'
$artifactDir = Join-Path $projectRoot 'artifacts\A11 Local Installer Lite'

if (-not (Test-Path $nsisDir)) {
  throw "Le dossier NSIS attendu est introuvable: $nsisDir"
}

if (Test-Path $artifactDir) {
  Remove-Item -LiteralPath $artifactDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

& robocopy $nsisDir $artifactDir /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
$copyExit = $LASTEXITCODE
if ($copyExit -gt 7) {
  throw "La copie des artefacts NSIS a echoue (robocopy exit $copyExit)."
}

Write-Host "[A11 DESKTOP] installer-lite ready: $artifactDir"
