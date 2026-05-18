param(
  [string]$OutDir = "E:\A11\ops\client-package",
  [string]$Url = "https://a11.funesterie.me",
  [string]$AppName = "A11 Client",
  [string]$InstallSlug = "A11Client",
  [string]$PackagePrefix = "A11-Client-Windows"
)

$ErrorActionPreference = "Stop"

$sourceRoot = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $sourceRoot "..\..")
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safePrefix = ($PackagePrefix -replace '[^a-zA-Z0-9._-]', '-')
if (-not $safePrefix) {
  $safePrefix = "A11-Client-Windows"
}
$packageName = "$safePrefix-$stamp"
$packageRoot = Join-Path $OutDir $packageName
$assetsDir = Join-Path $packageRoot "assets"
$personasSource = Join-Path $sourceRoot "personas"
$personasTarget = Join-Path $packageRoot "personas"

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
if (Test-Path -LiteralPath $personasSource) {
  New-Item -ItemType Directory -Force -Path $personasTarget | Out-Null
}

Copy-Item -LiteralPath (Join-Path $sourceRoot "A11-Client.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "Kaen44-Cli.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "Install-A11-Client.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "Install-Kaen44-Autonomous.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "Uninstall-A11-Client.ps1") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot "README.txt") -Destination $packageRoot -Force

$iconSource = Join-Path $repoRoot "a11desktoptauri\src-tauri\icons\icon.ico"
if (Test-Path -LiteralPath $iconSource) {
  Copy-Item -LiteralPath $iconSource -Destination (Join-Path $assetsDir "a11.ico") -Force
}

if (Test-Path -LiteralPath $personasSource) {
  Copy-Item -Path (Join-Path $personasSource "*") -Destination $personasTarget -Force
}

$manifest = [ordered]@{
  name = "A11 Client Windows"
  appName = $AppName
  installSlug = $InstallSlug
  url = $Url
  builtAt = (Get-Date).ToString("o")
  entrypoint = "Install-A11-Client.ps1"
}
$manifest | ConvertTo-Json | Set-Content -Path (Join-Path $packageRoot "manifest.json") -Encoding UTF8

$zipPath = Join-Path $OutDir "$packageName.zip"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageRoot "*") -DestinationPath $zipPath -Force

Write-Host "[A11 CLIENT] package ready: $packageRoot"
Write-Host "[A11 CLIENT] zip ready: $zipPath"
