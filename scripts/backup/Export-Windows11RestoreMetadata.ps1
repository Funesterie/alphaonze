param(
  [Parameter(Mandatory = $true)]
  [string]$BackupRoot
)

$ErrorActionPreference = "Stop"
$BackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
if (-not $BackupRoot.StartsWith("E:\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "BackupRoot must remain on E:"
}
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  throw "Backup root does not exist: $BackupRoot"
}

$metaRoot = Join-Path $BackupRoot "_meta\windows"
$privateRoot = Join-Path $BackupRoot "_private\windows"
$logRoot = Join-Path $BackupRoot "_logs"
New-Item -ItemType Directory -Force -Path $metaRoot, $privateRoot, $logRoot | Out-Null

function Invoke-PrivateCopy {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$RelativeDestination,
    [Parameter(Mandatory = $true)][string]$LogName
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return [pscustomobject]@{ source = $Source; exists = $false; ok = $true; note = "missing" }
  }

  $destination = Join-Path $privateRoot $RelativeDestination
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  & robocopy $Source $destination /E /XJ /COPY:DAT /DCOPY:DAT /R:1 /W:2 /NP /NFL /NDL "/LOG:$(Join-Path $logRoot $LogName)" | Out-Null
  $code = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  return [pscustomobject]@{
    source = $Source
    destination = $destination
    exists = $true
    ok = ($code -le 7)
    exitCode = $code
    note = if ($code -le 7) { "copied" } else { "robocopy_failed" }
  }
}

$copyResults = @(
  Invoke-PrivateCopy -Source "$env:APPDATA\Microsoft\Credentials" -RelativeDestination "AppData\Roaming\Microsoft\Credentials" -LogName "windows-credentials-roaming.log"
  Invoke-PrivateCopy -Source "$env:LOCALAPPDATA\Microsoft\Credentials" -RelativeDestination "AppData\Local\Microsoft\Credentials" -LogName "windows-credentials-local.log"
  Invoke-PrivateCopy -Source "$env:APPDATA\Microsoft\Protect" -RelativeDestination "AppData\Roaming\Microsoft\Protect" -LogName "windows-dpapi-protect.log"
  Invoke-PrivateCopy -Source "$env:APPDATA\Microsoft\Vault" -RelativeDestination "AppData\Roaming\Microsoft\Vault" -LogName "windows-vault-roaming.log"
  Invoke-PrivateCopy -Source "$env:LOCALAPPDATA\Microsoft\Vault" -RelativeDestination "AppData\Local\Microsoft\Vault" -LogName "windows-vault-local.log"
  Invoke-PrivateCopy -Source "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState" -RelativeDestination "WindowsTerminal\LocalState" -LogName "windows-terminal.log"
)

$uninstallRoots = @(
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$installedApps = foreach ($root in $uninstallRoots) {
  Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName } |
    Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation
}
$installedApps |
  Sort-Object DisplayName, DisplayVersion -Unique |
  ConvertTo-Json -Depth 3 |
  Set-Content -LiteralPath (Join-Path $metaRoot "installed-apps.json") -Encoding UTF8

$system = [ordered]@{
  exportedAt = (Get-Date).ToString("o")
  computerName = $env:COMPUTERNAME
  userName = $env:USERNAME
  userSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture
  culture = (Get-Culture).Name
  uiCulture = (Get-UICulture).Name
  timeZone = (Get-TimeZone).Id
  powershell = $PSVersionTable.PSVersion.ToString()
}
$system | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $metaRoot "system.json") -Encoding UTF8

$taskRoot = Join-Path $privateRoot "ScheduledTasks"
New-Item -ItemType Directory -Force -Path $taskRoot | Out-Null
$taskResults = foreach ($task in Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
  "$($_.TaskPath)$($_.TaskName)" -match "(?i)funesterie|nossen|a11|codex|kiro|chopper|qflush|agent"
}) {
  $safeName = ("$($task.TaskPath.Trim('\'))-$($task.TaskName)" -replace "[^A-Za-z0-9._-]", "_").Trim("_")
  try {
    Export-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath |
      Set-Content -LiteralPath (Join-Path $taskRoot "$safeName.xml") -Encoding UTF8
    [pscustomobject]@{ task = "$($task.TaskPath)$($task.TaskName)"; copied = $true }
  } catch {
    [pscustomobject]@{ task = "$($task.TaskPath)$($task.TaskName)"; copied = $false }
  }
}

$environmentExport = Join-Path $privateRoot "HKCU-Environment.reg"
& reg.exe export "HKCU\Environment" $environmentExport /y | Out-Null
$environmentExported = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $environmentExport))
$global:LASTEXITCODE = 0

$wifiRoot = Join-Path $privateRoot "WiFi"
New-Item -ItemType Directory -Force -Path $wifiRoot | Out-Null
& netsh.exe wlan export profile key=clear "folder=$wifiRoot" | Out-Null
$wifiProfiles = @(Get-ChildItem -LiteralPath $wifiRoot -Filter "*.xml" -File -ErrorAction SilentlyContinue).Count
$global:LASTEXITCODE = 0

$wingetPath = Join-Path $metaRoot "winget-packages.json"
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
$wingetExported = $false
if ($winget) {
  & winget.exe export --output $wingetPath --include-versions --accept-source-agreements --disable-interactivity | Out-Null
  $wingetExported = ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $wingetPath))
  $global:LASTEXITCODE = 0
}

$summary = [ordered]@{
  schema = "funesterie.windows11-restore-metadata.v1"
  exportedAt = (Get-Date).ToString("o")
  privateCopies = $copyResults
  scheduledTasks = $taskResults
  environmentRegistryExported = $environmentExported
  wifiProfileCount = $wifiProfiles
  wingetExported = $wingetExported
  warning = "The _private directory contains credentials and Wi-Fi material. Never paste or publish it."
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $metaRoot "summary.json") -Encoding UTF8

if (@($copyResults | Where-Object { -not $_.ok }).Count -gt 0) {
  exit 2
}
exit 0
