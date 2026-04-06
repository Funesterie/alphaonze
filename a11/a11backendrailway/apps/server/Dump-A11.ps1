param(
    [string]$Root = (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))), # Racine canonique D:\funesterie\a11
    [string]$OutputDir = "$env:USERPROFILE\Desktop" # Où poser le zip
)

# Création nom + chemin du zip
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$zipName = "a11-dump-$ts.zip"
$zipPath = Join-Path $OutputDir $zipName

Write-Host "=== Dump A-11 ==="
Write-Host "Root      : $Root"
Write-Host "OutputDir : $OutputDir"
Write-Host "Zip       : $zipPath"
Write-Host ""

if (-not (Test-Path $Root)) {
    Write-Error "Dossier racine introuvable: $Root"
    exit 1
}

Push-Location $Root

# Fichiers/dossiers intéressants dans l'arborescence split actuelle
$paths = @(
    "a11backendrailway\apps\server\*",
    "a11backendrailway\apps\tts\*",
    "a11frontendnetlify\apps\web\*",
    "a11qflushrailway\src\*",
    "a11qflushrailway\docs\*",
    "a11llm\llm\*",
    "launchers\README.md",
    "launchers\start-all-a11.bat",
    "launchers\start-all-a11.ps1",
    "launchers\start-prod-a11.bat",
    "launchers\start-prod-a11.ps1"
) | Where-Object { Test-Path $_ }

if ($paths.Count -eq 0) {
    Write-Error "Aucun chemin valide à zipper. Vérifie que tu es bien dans le bon repo."
    Pop-Location
    exit 1
}

# Supprime un zip du même nom si déjà présent
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Write-Host "Fichiers inclus dans le dump :"
$paths | ForEach-Object { Write-Host "  - $_" }

Compress-Archive -Path $paths -DestinationPath $zipPath -Force

Pop-Location

Write-Host ""
Write-Host "✅ Dump A-11 créé:"
Write-Host "   $zipPath"
