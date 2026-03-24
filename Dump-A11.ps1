param(
    [string]$Root = "D:\A11",                       # Racine de ton monorepo A-11
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

# Fichiers/dossiers intéressants (code, pas les node_modules & co)
$paths = @(
    "apps\server\*",
    "apps\web\*",
    "A11.VisualStudio\*",
    "llm-router.cjs",
    "tools\*",
    "src\*",
    "start-a11-system.ps1",
    "Start-A11-LaunchAll.ps1",
    "start-all.ps1",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".env.example"
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
