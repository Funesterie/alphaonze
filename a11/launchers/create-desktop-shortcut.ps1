param()

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'A11 + Ollama.lnk'
$tunnelShortcutPath = Join-Path $desktopPath 'A11 Tunnel Cerbere.lnk'
$targetPath = Join-Path $launcherRoot 'a11-ollama-desktop.bat'
$tunnelTargetPath = $targetPath
$workingDirectory = $launcherRoot
$iconPath = Join-Path $launcherRoot '..\a11desktoptauri\src-tauri\icons\icon.ico'

if (-not (Test-Path -LiteralPath $targetPath)) {
  throw "Launcher introuvable: $targetPath"
}
if (-not (Test-Path -LiteralPath $tunnelTargetPath)) {
  throw "Launcher tunnel introuvable: $tunnelTargetPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.Description = 'Lance A11 local sur le bureau, reveille Ollama si besoin, sans tunnel.'
if (Test-Path -LiteralPath $iconPath) {
  $shortcut.IconLocation = $iconPath
}
$shortcut.Save()

$tunnelShortcut = $shell.CreateShortcut($tunnelShortcutPath)
$tunnelShortcut.TargetPath = $tunnelTargetPath
$tunnelShortcut.Arguments = '-WithTunnel'
$tunnelShortcut.WorkingDirectory = $workingDirectory
$tunnelShortcut.Description = 'Lance A11 avec le tunnel Cerbere explicitement.'
if (Test-Path -LiteralPath $iconPath) {
  $tunnelShortcut.IconLocation = $iconPath
}
$tunnelShortcut.Save()

Write-Host "[A11 LOCAL] Shortcut created: $shortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $tunnelShortcutPath"
