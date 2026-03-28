param(
  [switch]$SkipUiBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$srcTauriRoot = Join-Path $projectRoot 'src-tauri'
$releaseRoot = Join-Path $srcTauriRoot 'target\release'
$artifactRoot = Join-Path $projectRoot 'artifacts\A11 Local Portable'
$resourceSource = Join-Path $projectRoot 'resources\a11-local'
$resourceTarget = Join-Path $artifactRoot 'resources\a11-local'

$syncArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $PSScriptRoot 'sync-local-package.ps1')
)

if ($SkipUiBuild) {
  $syncArgs += '-SkipUiBuild'
}

& powershell.exe @syncArgs
if ($LASTEXITCODE -ne 0) {
  throw 'La preparation des resources desktop a echoue.'
}

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

$cargoExe = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $cargoExe) {
  throw "cargo.exe introuvable. Verifie l'installation Rust dans $cargoBin."
}

Push-Location $srcTauriRoot
try {
  & $cargoExe.Source build --release
  if ($LASTEXITCODE -ne 0) {
    throw 'Le build cargo --release a echoue.'
  }
}
finally {
  Pop-Location
}

$exeSource = Join-Path $releaseRoot 'a11_local_desktop.exe'
$dllSource = Join-Path $releaseRoot 'a11_local_desktop_lib.dll'

foreach ($requiredPath in @($exeSource, $dllSource, $resourceSource)) {
  if (-not (Test-Path $requiredPath)) {
    throw "Artefact requis introuvable: $requiredPath"
  }
}

if (Test-Path $artifactRoot) {
  Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $artifactRoot 'resources') | Out-Null

Copy-Item -LiteralPath $exeSource -Destination (Join-Path $artifactRoot 'a11_local_desktop.exe') -Force
Copy-Item -LiteralPath $dllSource -Destination (Join-Path $artifactRoot 'a11_local_desktop_lib.dll') -Force

$copyArgs = @($resourceSource, $resourceTarget, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
& robocopy @copyArgs | Out-Null
$copyExit = $LASTEXITCODE
if ($copyExit -gt 7) {
  throw "La copie du runtime portable a echoue (robocopy exit $copyExit)."
}

$readmePath = Join-Path $artifactRoot 'README.txt'
@'
A11 Local Portable

1. Lancez a11_local_desktop.exe
2. Le shell desktop demarre la stack locale A11
3. Les resources runtime sont dans resources\a11-local

Note:
- Ce bundle portable embarque la stack locale utile au desktop.
- Les installateurs Tauri natifs (NSIS/MSI) restent limites par la taille du runtime local complet.
'@ | Set-Content -Path $readmePath -Encoding ascii

Write-Host "[A11 DESKTOP] portable ready: $artifactRoot"
