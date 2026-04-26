# Script pour exporter un dump Neo4j depuis A11
# Usage: .\export-neo4j-dump.ps1 -OutputPath "chemin/vers/export"

param(
    [string]$OutputPath = ".\neo4j-dumps",
    [string]$DatabaseName = "a11-knowledge-graph",
    [string]$Neo4jHome = "C:\Users\$env:USERNAME\.Neo4jDesktop\relate-data\dbmss"
)

Write-Host "=== Export de dump Neo4j pour A11 ===" -ForegroundColor Cyan

# Créer le répertoire de sortie s'il n'existe pas
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "✓ Répertoire créé: $OutputPath" -ForegroundColor Green
}

# Vérifier que Neo4j Desktop est installé
if (-not (Test-Path $Neo4jHome)) {
    Write-Host "ERREUR: Neo4j Desktop non trouvé dans $Neo4jHome" -ForegroundColor Red
    Write-Host "Ajustez le paramètre -Neo4jHome si nécessaire" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Neo4j Desktop trouvé" -ForegroundColor Green

# Lister les instances Neo4j disponibles
Write-Host "`nInstances Neo4j disponibles:" -ForegroundColor Cyan
$dbmss = Get-ChildItem -Path $Neo4jHome -Directory
foreach ($dbms in $dbmss) {
    Write-Host "  - $($dbms.Name)" -ForegroundColor Gray
}

# Demander quelle instance utiliser
Write-Host "`nQuelle instance Neo4j voulez-vous utiliser?" -ForegroundColor Yellow
Write-Host "Entrez le nom de l'instance (ou appuyez sur Entrée pour la première):" -ForegroundColor Yellow
$instanceName = Read-Host

if ([string]::IsNullOrWhiteSpace($instanceName)) {
    $instanceName = $dbmss[0].Name
    Write-Host "Utilisation de l'instance par défaut: $instanceName" -ForegroundColor Cyan
}

$instancePath = Join-Path $Neo4jHome $instanceName

if (-not (Test-Path $instancePath)) {
    Write-Host "ERREUR: Instance introuvable: $instancePath" -ForegroundColor Red
    exit 1
}

# Trouver neo4j-admin
$neo4jAdminPath = Join-Path $instancePath "bin\neo4j-admin.bat"

if (-not (Test-Path $neo4jAdminPath)) {
    Write-Host "ERREUR: neo4j-admin.bat introuvable dans $instancePath\bin" -ForegroundColor Red
    exit 1
}

Write-Host "✓ neo4j-admin trouvé: $neo4jAdminPath" -ForegroundColor Green

# Générer un nom de fichier avec timestamp
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dumpFileName = "${DatabaseName}-${timestamp}.dump"
$dumpFilePath = Join-Path $OutputPath $dumpFileName

# Avertissement
Write-Host "`n⚠️  ATTENTION ⚠️" -ForegroundColor Yellow
Write-Host "Pour exporter, la base de données doit être arrêtée." -ForegroundColor Yellow
Write-Host "Veuillez arrêter manuellement la base '$DatabaseName' dans Neo4j Desktop" -ForegroundColor Yellow
Write-Host "Appuyez sur une touche quand c'est fait..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Exporter le dump
Write-Host "`nExport du dump..." -ForegroundColor Cyan
Write-Host "Destination: $dumpFilePath" -ForegroundColor Gray
Write-Host "Commande: $neo4jAdminPath database dump --to-path=`"$OutputPath`" $DatabaseName" -ForegroundColor Gray

try {
    & $neo4jAdminPath database dump --to-path="$OutputPath" $DatabaseName
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✓ Export réussi!" -ForegroundColor Green
        
        # Trouver le fichier dump créé
        $dumpFiles = Get-ChildItem -Path $OutputPath -Filter "*.dump" | Sort-Object LastWriteTime -Descending
        if ($dumpFiles.Count -gt 0) {
            $actualDumpFile = $dumpFiles[0].FullName
            Write-Host "✓ Fichier dump: $actualDumpFile" -ForegroundColor Green
            
            $fileSize = (Get-Item $actualDumpFile).Length / 1MB
            Write-Host "✓ Taille: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
        }
    }
    else {
        Write-Host "`n✗ Export échoué (code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`nERREUR lors de l'export:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Instructions finales
Write-Host "`n=== Export terminé ===" -ForegroundColor Green
Write-Host "Vous pouvez maintenant:" -ForegroundColor Cyan
Write-Host "1. Redémarrer la base '$DatabaseName' dans Neo4j Desktop" -ForegroundColor White
Write-Host "2. Partager le dump avec d'autres instances A11" -ForegroundColor White
Write-Host "3. Utiliser le dump comme backup" -ForegroundColor White

Write-Host "`nPour importer ce dump ailleurs:" -ForegroundColor Cyan
Write-Host ".\import-neo4j-dump.ps1 -DumpFile `"$actualDumpFile`"" -ForegroundColor Gray

Write-Host "`nAppuyez sur une touche pour continuer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
