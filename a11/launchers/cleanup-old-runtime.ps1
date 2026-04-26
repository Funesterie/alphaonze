# cleanup-old-runtime.ps1
# Nettoie l'ancien répertoire runtime et conserve uniquement le nouveau

param(
    [switch]$Backup,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$oldRuntime = "D:\projets\funesterie\runtime"
$newRuntime = "D:\projets\funesterie\a11\runtime"

Write-Host "=== Nettoyage de l'ancien Runtime ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier que le nouveau runtime existe
if (-not (Test-Path $newRuntime)) {
    Write-Host "ERREUR: Le nouveau runtime n'existe pas: $newRuntime" -ForegroundColor Red
    exit 1
}

# Vérifier que l'ancien runtime existe
if (-not (Test-Path $oldRuntime)) {
    Write-Host "L'ancien runtime n'existe pas. Rien à nettoyer." -ForegroundColor Green
    exit 0
}

Write-Host "Ancien runtime trouvé:" -ForegroundColor Yellow
Write-Host "  Chemin: $oldRuntime" -ForegroundColor Gray

# Analyser le contenu
$oldFiles = Get-ChildItem -Path $oldRuntime -Recurse -File
$oldSize = ($oldFiles | Measure-Object -Property Length -Sum).Sum / 1MB

Write-Host "  Fichiers: $($oldFiles.Count)" -ForegroundColor Gray
Write-Host "  Taille: $([math]::Round($oldSize, 2)) MB" -ForegroundColor Gray
Write-Host ""

Write-Host "Nouveau runtime (actif):" -ForegroundColor Green
Write-Host "  Chemin: $newRuntime" -ForegroundColor Gray

$newFiles = Get-ChildItem -Path $newRuntime -Recurse -File
$newSize = ($newFiles | Measure-Object -Property Length -Sum).Sum / 1MB

Write-Host "  Fichiers: $($newFiles.Count)" -ForegroundColor Gray
Write-Host "  Taille: $([math]::Round($newSize, 2)) MB" -ForegroundColor Gray
Write-Host ""

# Vérifier les dates de dernière modification
$oldLastModified = ($oldFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
$newLastModified = ($newFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime

Write-Host "Dernière modification:" -ForegroundColor Yellow
Write-Host "  Ancien runtime: $oldLastModified" -ForegroundColor Gray
Write-Host "  Nouveau runtime: $newLastModified" -ForegroundColor Gray
Write-Host ""

if ($newLastModified -lt $oldLastModified) {
    Write-Host "ATTENTION: L'ancien runtime a des fichiers plus récents!" -ForegroundColor Red
    Write-Host "Vérifiez que le nouveau runtime est bien le répertoire actif." -ForegroundColor Yellow
    Write-Host ""
    if (-not $Force) {
        $confirm = Read-Host "Continuer quand même? (oui/non)"
        if ($confirm -ne "oui") {
            Write-Host "Opération annulée." -ForegroundColor Yellow
            exit 0
        }
    }
}

# Backup si demandé
if ($Backup) {
    $backupFile = "D:\projets\funesterie\runtime_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
    Write-Host "Création d'une sauvegarde..." -ForegroundColor Yellow
    Write-Host "  Destination: $backupFile" -ForegroundColor Gray
    
    try {
        Compress-Archive -Path $oldRuntime -DestinationPath $backupFile -Force
        $backupSize = (Get-Item $backupFile).Length / 1MB
        Write-Host "  ✓ Sauvegarde créée ($([math]::Round($backupSize, 2)) MB)" -ForegroundColor Green
    }
    catch {
        Write-Host "  ✗ Erreur lors de la sauvegarde: $_" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Confirmation
if (-not $Force) {
    Write-Host "ATTENTION: Cette opération va supprimer définitivement l'ancien runtime." -ForegroundColor Yellow
    Write-Host "  Chemin: $oldRuntime" -ForegroundColor Yellow
    Write-Host "  Fichiers: $($oldFiles.Count)" -ForegroundColor Yellow
    Write-Host "  Taille: $([math]::Round($oldSize, 2)) MB" -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "Êtes-vous sûr de vouloir continuer? (oui/non)"
    if ($confirm -ne "oui") {
        Write-Host "Opération annulée." -ForegroundColor Yellow
        exit 0
    }
    Write-Host ""
}

# Supprimer l'ancien runtime
Write-Host "Suppression de l'ancien runtime..." -ForegroundColor Yellow
try {
    Remove-Item -Path $oldRuntime -Recurse -Force
    Write-Host "  ✓ Ancien runtime supprimé" -ForegroundColor Green
}
catch {
    Write-Host "  ✗ Erreur lors de la suppression: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Vérification
Write-Host "Vérification..." -ForegroundColor Yellow

if (Test-Path $oldRuntime) {
    Write-Host "  ✗ ERREUR: L'ancien runtime existe encore" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Ancien runtime supprimé" -ForegroundColor Green

if (-not (Test-Path $newRuntime)) {
    Write-Host "  ✗ ERREUR: Le nouveau runtime n'existe plus" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Nouveau runtime présent" -ForegroundColor Green

Write-Host ""
Write-Host "=== Nettoyage terminé avec succès ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Runtime actif: $newRuntime" -ForegroundColor Green
Write-Host ""

if ($Backup) {
    Write-Host "Sauvegarde disponible: $backupFile" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "Prochaines étapes:" -ForegroundColor White
Write-Host "  1. Redémarrer le backend A11" -ForegroundColor Gray
Write-Host "  2. Vérifier que tout fonctionne correctement" -ForegroundColor Gray
Write-Host "  3. Tester la génération de fichiers" -ForegroundColor Gray
