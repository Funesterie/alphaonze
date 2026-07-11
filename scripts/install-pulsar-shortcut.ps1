# Pulsar v5 — Raccourci clavier Windows
# Au lieu de Ctrl+V, presse le raccourci pour compresser ce qui est dans le presse-papier
# 
# Installation: Ce script crée un raccourci sur le Bureau qui lance Pulsar v5 Clipboard
# Associe le raccourci à une touche (ex: Ctrl+Shift+P)

$projectRoot = "C:\Users\cella\OneDrive\Documents\funesterie\alphaonze"
$scriptPath = "$projectRoot\scripts\pulsar-v5-clipboard.cjs"
$shell = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = "$desktopPath\Pulsar v5 - Compression.lnk"

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "node"
$shortcut.Arguments = "`"$scriptPath`" --quality 46.7"
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "C:\Windows\System32\shell32.dll,13"
$shortcut.Description = "Pulsar v5 - Compresse le fichier vidéo dans le presse-papier (CQ 46.7)"
$shortcut.HotKey = "^+P"  # Ctrl+Shift+P
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Output "Raccourci cree: $shortcutPath"
Write-Output "Raccourci clavier: Ctrl+Shift+P"
Write-Output "Qualite: CQ 46.7 (ultra compression)"
Write-Output ""
Write-Output "Utilisation:"
Write-Output "  1. Copier un fichier video (Ctrl+C dans l'explorateur)"
Write-Output "  2. Presser Ctrl+Shift+P (au lieu de Ctrl+V)"
Write-Output "  3. Le fichier est compresse avec Pulsar v5"
Write-Output "  4. Le chemin du fichier compresse est mis dans le presse-papier"
