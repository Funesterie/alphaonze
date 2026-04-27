param()

$ErrorActionPreference = 'Stop'

$launcherRoot = Split-Path -Parent $PSCommandPath
$desktopPath = [Environment]::GetFolderPath('Desktop')
$localShortcutPath = Join-Path $desktopPath 'Local.lnk'
$prodShortcutPath = Join-Path $desktopPath 'Prod.lnk'
$stopShortcutPath = Join-Path $desktopPath 'Stop tout.lnk'
$localTargetPath = Join-Path $launcherRoot 'start-local-a11.bat'
$prodTargetPath = Join-Path $launcherRoot 'start-online-a11.bat'
$stopTargetPath = Join-Path $launcherRoot 'stop-all-a11.bat'
$workingDirectory = $launcherRoot
$iconPath = Join-Path $launcherRoot '..\a11desktoptauri\src-tauri\icons\icon.ico'

$obsoleteShortcutNames = @(
  'A11 Local.lnk',
  'A11 Local + Ollama.lnk',
  'A11 Online.lnk',
  'Stop A11 local.lnk',
  'A11 + Ollama.lnk',
  'A11 Tunnel Cerbere.lnk',
  'A11 Dragon Repo.lnk',
  '📁 DOSSIER A11.lnk',
  '🧹 A11 Nettoyer Logs.lnk',
  'Funesterie Commit Push Tout.lnk',
  'FUNESTERIE Workspace.lnk'
)

if (-not (Test-Path -LiteralPath $localTargetPath)) {
  throw "Launcher local introuvable: $localTargetPath"
}
if (-not (Test-Path -LiteralPath $prodTargetPath)) {
  throw "Launcher prod introuvable: $prodTargetPath"
}
if (-not (Test-Path -LiteralPath $stopTargetPath)) {
  throw "Launcher stop introuvable: $stopTargetPath"
}

foreach ($shortcutName in $obsoleteShortcutNames) {
  $shortcutPath = Join-Path $desktopPath $shortcutName
  if (Test-Path -LiteralPath $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  }
}

$shell = New-Object -ComObject WScript.Shell
$localShortcut = $shell.CreateShortcut($localShortcutPath)
$localShortcut.TargetPath = $localTargetPath
$localShortcut.WorkingDirectory = $workingDirectory
$localShortcut.Description = 'Lance A11 local et Ollama.'
if (Test-Path -LiteralPath $iconPath) {
  $localShortcut.IconLocation = $iconPath
}
$localShortcut.Save()

$prodShortcut = $shell.CreateShortcut($prodShortcutPath)
$prodShortcut.TargetPath = $prodTargetPath
$prodShortcut.WorkingDirectory = $workingDirectory
$prodShortcut.Description = 'Verifie Railway/Netlify puis ouvre A11 en production.'
if (Test-Path -LiteralPath $iconPath) {
  $prodShortcut.IconLocation = $iconPath
}
$prodShortcut.Save()

$stopShortcut = $shell.CreateShortcut($stopShortcutPath)
$stopShortcut.TargetPath = $stopTargetPath
$stopShortcut.WorkingDirectory = $workingDirectory
$stopShortcut.Description = 'Arrete la stack locale A11.'
if (Test-Path -LiteralPath $iconPath) {
  $stopShortcut.IconLocation = $iconPath
}
$stopShortcut.Save()

Write-Host "[A11 LOCAL] Shortcut created: $localShortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $prodShortcutPath"
Write-Host "[A11 LOCAL] Shortcut created: $stopShortcutPath"
