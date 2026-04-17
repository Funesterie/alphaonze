param()

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$desktopPath = [Environment]::GetFolderPath('Desktop')
$localShortcutPath = Join-Path $desktopPath 'A11 Local.lnk'
$ollamaShortcutPath = Join-Path $desktopPath 'A11 Local + Ollama.lnk'
$onlineShortcutPath = Join-Path $desktopPath 'A11 Online.lnk'
$stopShortcutPath = Join-Path $desktopPath 'Stop A11 local.lnk'
$localTargetPath = Join-Path $launcherRoot 'a11-local.bat'
$ollamaTargetPath = Join-Path $launcherRoot 'a11-ollama-desktop.bat'
$onlineTargetPath = Join-Path $launcherRoot 'start-online-a11.bat'
$stopTargetPath = Join-Path $launcherRoot 'a11-local.bat'
$workingDirectory = $launcherRoot
$iconPath = Join-Path $launcherRoot '..\a11desktoptauri\src-tauri\icons\icon.ico'

if (-not (Test-Path -LiteralPath $localTargetPath)) {
  throw "Launcher local introuvable: $localTargetPath"
}
if (-not (Test-Path -LiteralPath $ollamaTargetPath)) {
  throw "Launcher Ollama introuvable: $ollamaTargetPath"
}
if (-not (Test-Path -LiteralPath $onlineTargetPath)) {
  throw "Launcher online introuvable: $onlineTargetPath"
}
if (-not (Test-Path -LiteralPath $stopTargetPath)) {
  throw "Launcher stop introuvable: $stopTargetPath"
}

$shell = New-Object -ComObject WScript.Shell
$localShortcut = $shell.CreateShortcut($localShortcutPath)
$localShortcut.TargetPath = $localTargetPath
$localShortcut.Arguments = 'desktop'
$localShortcut.WorkingDirectory = $workingDirectory
$localShortcut.Description = 'Lance la stack locale A11 dans sa fenetre dediee.'
if (Test-Path -LiteralPath $iconPath) {
  $localShortcut.IconLocation = $iconPath
}
$localShortcut.Save()

$ollamaShortcut = $shell.CreateShortcut($ollamaShortcutPath)
$ollamaShortcut.TargetPath = $ollamaTargetPath
$ollamaShortcut.WorkingDirectory = $workingDirectory
$ollamaShortcut.Description = 'Lance A11 local et reveille Ollama si besoin.'
if (Test-Path -LiteralPath $iconPath) {
  $ollamaShortcut.IconLocation = $iconPath
}
$ollamaShortcut.Save()

$onlineShortcut = $shell.CreateShortcut($onlineShortcutPath)
$onlineShortcut.TargetPath = $onlineTargetPath
$onlineShortcut.WorkingDirectory = $workingDirectory
$onlineShortcut.Description = 'Verifie Railway/Netlify puis ouvre A11 en production.'
if (Test-Path -LiteralPath $iconPath) {
  $onlineShortcut.IconLocation = $iconPath
}
$onlineShortcut.Save()

$stopShortcut = $shell.CreateShortcut($stopShortcutPath)
$stopShortcut.TargetPath = $stopTargetPath
$stopShortcut.Arguments = 'stop'
$stopShortcut.WorkingDirectory = $workingDirectory
$stopShortcut.Description = 'Arrete proprement la stack locale A11 geree par le launcher.'
if (Test-Path -LiteralPath $iconPath) {
  $stopShortcut.IconLocation = $iconPath
}
$stopShortcut.Save()

Write-Host "[A11 LOCAL] Shortcut created: $localShortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $ollamaShortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $onlineShortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $stopShortcutPath"
