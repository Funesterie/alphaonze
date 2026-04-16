param()

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'A11 Local.lnk'
$targetPath = Join-Path $launcherRoot 'a11-desktop.bat'
$workingDirectory = $launcherRoot
$iconPath = Join-Path $launcherRoot '..\a11desktoptauri\src-tauri\icons\icon.ico'

if (-not (Test-Path -LiteralPath $targetPath)) {
  throw "Launcher introuvable: $targetPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.Description = 'Lance A11 local avec Ollama, TTS et image locale.'
if (Test-Path -LiteralPath $iconPath) {
  $shortcut.IconLocation = $iconPath
}
$shortcut.Save()

Write-Host "[A11 LOCAL] Shortcut created: $shortcutPath"
