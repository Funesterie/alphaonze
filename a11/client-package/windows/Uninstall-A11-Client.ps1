param(
  [string]$AppName = "A11 Client",
  [string]$InstallSlug = "A11Client"
)

$ErrorActionPreference = "Stop"

$safeSlug = ($InstallSlug -replace '[^a-zA-Z0-9._-]', '')
if (-not $safeSlug) {
  $safeSlug = "A11Client"
}

$installDir = Join-Path $env:LOCALAPPDATA $safeSlug
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
$uninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$safeSlug"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath) {
  $pathItems = @($userPath -split ';' | Where-Object {
    $_ -and ($_.TrimEnd('\') -ine $installDir.TrimEnd('\'))
  })
  [Environment]::SetEnvironmentVariable("Path", ($pathItems -join ';'), "User")
}

if (Test-Path -LiteralPath $desktopShortcut) {
  Remove-Item -LiteralPath $desktopShortcut -Force
}

if (Test-Path -LiteralPath $startMenuDir) {
  Remove-Item -LiteralPath $startMenuDir -Recurse -Force
}

if (Test-Path -LiteralPath $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

if (Test-Path -LiteralPath $uninstallRegistryPath) {
  Remove-Item -LiteralPath $uninstallRegistryPath -Recurse -Force
}

Write-Host "$AppName uninstalled."
