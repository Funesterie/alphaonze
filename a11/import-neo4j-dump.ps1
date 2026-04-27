# Script pour importer un dump Neo4j dans A11
# Usage: .\import-neo4j-dump.ps1 -DumpFile "C:\Users\cella\Desktop\a11-knowledge-graph-2026-04-26T23-54-11.dump"

param(
    [Parameter(Mandatory = $true)]
    [string]$DumpFile,
    [string]$DatabaseName = "a11-knowledge-graph",
    # Chemin réel de l'instance Neo4j Desktop (trouvé dans les logs)
    [string]$Neo4jBin = "C:\Users\$env:USERNAME\.Neo4jDesktop2\Data\dbmss\dbms-3c55be75-f0b8-4280-9649-0b4e818bf2f1\bin"
)

Write-Host "=== Import de dump Neo4j pour A11 ===" -ForegroundColor Cyan
Write-Host "Fichier dump : $DumpFile" -ForegroundColor Yellow
Write-Host "Base cible   : $DatabaseName" -ForegroundColor Yellow
Write-Host "Neo4j bin    : $Neo4jBin" -ForegroundColor Yellow

# Vérifier que le fichier dump existe
if (-not (Test-Path $DumpFile)) {
    Write-Host "`nERREUR: Fichier dump introuvable: $DumpFile" -ForegroundColor Red
    exit 1
}
Write-Host "`n✓ Fichier dump trouvé" -ForegroundColor Green

# Vérifier neo4j-admin
$neo4jAdmin = Join-Path $Neo4jBin "neo4j-admin.bat"
if (-not (Test-Path $neo4jAdmin)) {
    Write-Host "ERREUR: neo4j-admin.bat introuvable: $neo4jAdmin" -ForegroundColor Red
    Write-Host "Vérifiez le paramètre -Neo4jBin" -ForegroundColor Yellow
    exit 1
}
Write-Host "✓ neo4j-admin trouvé" -ForegroundColor Green

# Avertissement
Write-Host "`n⚠️  ATTENTION" -ForegroundColor Yellow
Write-Host "Arrêtez la base '$DatabaseName' dans Neo4j Desktop avant de continuer." -ForegroundColor Yellow
Write-Host "Appuyez sur une touche quand la base est arrêtée..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Extraire le répertoire du dump
$dumpDir = Split-Path $DumpFile -Parent

Write-Host "`nImport en cours..." -ForegroundColor Cyan
Write-Host "Commande: $neo4jAdmin database load --from-path=`"$dumpDir`" $DatabaseName --overwrite-destination=true" -ForegroundColor Gray

try {
    & $neo4jAdmin database load --from-path="$dumpDir" $DatabaseName --overwrite-destination=true

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✓ Import réussi!" -ForegroundColor Green
        Write-Host "`nProchaines étapes:" -ForegroundColor Cyan
        Write-Host "1. Redémarrez la base '$DatabaseName' dans Neo4j Desktop" -ForegroundColor White
        Write-Host "2. Testez: cd a11\backend\apps\server && npm run test:neo4j" -ForegroundColor White
    }
    else {
        Write-Host "`n✗ Import échoué (code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`nERREUR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`nAppuyez sur une touche pour quitter..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
