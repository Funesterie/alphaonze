param(
  [string]$Url = "https://a11.funesterie.me",
  [string]$AppName = "A11 Client",
  [string]$InstallSlug = "A11Client",
  [string[]]$Aliases = @(),
  [string]$UpgradeCode = "",
  [string]$UpgradeName = "Maison",
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"

$safeSlug = ($InstallSlug -replace '[^a-zA-Z0-9._-]', '')
if (-not $safeSlug) {
  $safeSlug = "A11Client"
}

$installDir = Join-Path $env:LOCALAPPDATA $safeSlug
$scriptSource = Join-Path $PSScriptRoot "A11-Client.ps1"
$cliSource = Join-Path $PSScriptRoot "Kaen44-Cli.ps1"
$autonomousSource = Join-Path $PSScriptRoot "Install-Kaen44-Autonomous.ps1"
$iconSource = Join-Path $PSScriptRoot "assets\a11.ico"
$launcherPath = Join-Path $installDir "A11-Client.ps1"
$cliPath = Join-Path $installDir "Kaen44-Cli.ps1"
$autonomousPath = Join-Path $installDir "Install-Kaen44-Autonomous.ps1"
$iconPath = Join-Path $installDir "a11.ico"

if (-not (Test-Path -LiteralPath $scriptSource)) {
  throw "A11-Client.ps1 missing next to installer."
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath $scriptSource -Destination $launcherPath -Force
if (Test-Path -LiteralPath $cliSource) {
  Copy-Item -LiteralPath $cliSource -Destination $cliPath -Force
}
if (Test-Path -LiteralPath $autonomousSource) {
  Copy-Item -LiteralPath $autonomousSource -Destination $autonomousPath -Force
}

if (Test-Path -LiteralPath $iconSource) {
  Copy-Item -LiteralPath $iconSource -Destination $iconPath -Force
}

$config = [ordered]@{
  name = "A11 Client"
  appName = $AppName
  url = $Url
  aliases = @($Aliases)
  upgradeName = $UpgradeName
  specialUpgradeEnabled = -not [string]::IsNullOrWhiteSpace($UpgradeCode)
  guard = [ordered]@{
    enabled = $true
    mode = "transparent_limit"
    abusePlanPriceEur = 5
    adminEmail = "cellaurojeffrey@gmail.com"
    notifyAdminOnLimit = $true
    message = "Usage eleve detecte. Kaen44 passe en mode limite et peut proposer l'option Plus a 5 EUR."
  }
  installedAt = (Get-Date).ToString("o")
}
if (-not [string]::IsNullOrWhiteSpace($UpgradeCode)) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($UpgradeCode.Trim())
  $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant()
  $config.upgradeCodeSha256 = $hash
}
$config | ConvertTo-Json | Set-Content -Path (Join-Path $installDir "client.config.json") -Encoding UTF8

if (Test-Path -LiteralPath $cliPath) {
  foreach ($commandName in @("kaen44", "k44")) {
    $shimPath = Join-Path $installDir "$commandName.cmd"
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Kaen44-Cli.ps1" %*
"@ | Set-Content -LiteralPath $shimPath -Encoding ASCII
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathItems = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() })
  $alreadyInPath = $pathItems | Where-Object { $_.TrimEnd('\') -ieq $installDir.TrimEnd('\') }
  if (-not $alreadyInPath) {
    $nextPath = (@($pathItems + $installDir) -join ';')
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
    $env:Path = (@($env:Path, $installDir) -join ';')
  }
}

$shell = New-Object -ComObject WScript.Shell
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
Get-ChildItem -LiteralPath $startMenuDir -Filter "*.lnk" -ErrorAction SilentlyContinue | Remove-Item -Force

function New-A11Shortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`" -Url `"$Url`" -ProfileName `"$safeSlug`""
  $shortcut.WorkingDirectory = $installDir
  $shortcut.Description = $AppName
  if (Test-Path -LiteralPath $iconPath) {
    $shortcut.IconLocation = $iconPath
  }
  $shortcut.Save()
}

New-A11Shortcut -Path (Join-Path $startMenuDir "$AppName.lnk")

foreach ($alias in @($Aliases)) {
  $safeAlias = [string]$alias
  $safeAlias = $safeAlias.Trim()
  if ($safeAlias -and $safeAlias -ne $AppName) {
    New-A11Shortcut -Path (Join-Path $startMenuDir "$safeAlias.lnk")
  }
}

if (-not $NoDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  New-A11Shortcut -Path (Join-Path $desktop "$AppName.lnk")
}

$uninstallSource = Join-Path $PSScriptRoot "Uninstall-A11-Client.ps1"
if (Test-Path -LiteralPath $uninstallSource) {
  Copy-Item -LiteralPath $uninstallSource -Destination (Join-Path $installDir "Uninstall-A11-Client.ps1") -Force
}

$uninstallLauncher = Join-Path $installDir "Uninstall-$safeSlug.ps1"
@"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "`$PSScriptRoot\Uninstall-A11-Client.ps1" -AppName "$AppName" -InstallSlug "$safeSlug"
"@ | Set-Content -Path $uninstallLauncher -Encoding ASCII

$uninstallRegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$safeSlug"
New-Item -Path $uninstallRegistryPath -Force | Out-Null
Set-ItemProperty -Path $uninstallRegistryPath -Name DisplayName -Value $AppName
Set-ItemProperty -Path $uninstallRegistryPath -Name DisplayVersion -Value "0.1.0"
Set-ItemProperty -Path $uninstallRegistryPath -Name Publisher -Value "Funesterie"
Set-ItemProperty -Path $uninstallRegistryPath -Name InstallLocation -Value $installDir
Set-ItemProperty -Path $uninstallRegistryPath -Name DisplayIcon -Value $iconPath
Set-ItemProperty -Path $uninstallRegistryPath -Name URLInfoAbout -Value $Url
Set-ItemProperty -Path $uninstallRegistryPath -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstallLauncher`""
Set-ItemProperty -Path $uninstallRegistryPath -Name NoModify -Type DWord -Value 1
Set-ItemProperty -Path $uninstallRegistryPath -Name NoRepair -Type DWord -Value 1

Write-Host "$AppName installed."
Write-Host "URL: $Url"
Write-Host "Install dir: $installDir"
