# Script pour importer un dump Neo4j dans A11
# Usage: .\import-neo4j-dump.ps1 -DumpFile "chemin/vers/dump.dump"

param(
    [Parameter(Mandatory = $true)]
    [string]$DumpFile,
    [string]$DatabaseName = "a11-knowledge-graph",
    [string]$Neo4jHome = "C:\Users\$env:USERNAME\.Neo4jDesktop\relate-data\dbmss"
)

Write-Host "=== Import de dump Neo4j pour A11 ===" -ForegroundColor Cyan

# Vérifier que le fichier dump existe
if (-not (Test-Path $DumpFile)) {
    Write-Host "ERREUR: Fichier dump introuvable: $DumpFile" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Fichier dump trouvé: $DumpFile" -ForegroundColor Green

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

# Avertissement
Write-Host "`n⚠️  ATTENTION ⚠️" -ForegroundColor Yellow
Write-Host "L'import va:" -ForegroundColor Yellow
Write-Host "  1. Arrêter la base de données $DatabaseName (si elle tourne)" -ForegroundColor White
Write-Host "  2. Supprimer les données existantes" -ForegroundColor White
Write-Host "  3. Importer le dump" -ForegroundColor White
Write-Host "  4. Redémarrer la base de données" -ForegroundColor White
Write-Host "`nVoulez-vous continuer? (O/N)" -ForegroundColor Yellow
$confirm = Read-Host

if ($confirm -ne 'O' -and $confirm -ne 'o') {
    Write-Host "Import annulé" -ForegroundColor Yellow
    exit 0
}

# Arrêter Neo4j (si nécessaire)
Write-Host "`nArrêt de Neo4j..." -ForegroundColor Cyan
Write-Host "Veuillez arrêter manuellement la base '$DatabaseName' dans Neo4j Desktop" -ForegroundColor Yellow
Write-Host "Appuyez sur une touche quand c'est fait..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Importer le dump
Write-Host "`nImport du dump..." -ForegroundColor Cyan
Write-Host "Commande: $neo4jAdminPath database load --from-path=`"$DumpFile`" $DatabaseName --overwrite-destination=true" -ForegroundColor Gray

try {
    & $neo4jAdminPath database load --from-path="$DumpFile" $DatabaseName --overwrite-destination=true
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✓ Import réussi!" -ForegroundColor Green
    }
    else {
        Write-Host "`n✗ Import échoué (code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`nERREUR lors de l'import:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Instructions finales
Write-Host "`n=== Import terminé ===" -ForegroundColor Green
Write-Host "Prochaines étapes:" -ForegroundColor Cyan
Write-Host "1. Redémarrez la base '$DatabaseName' dans Neo4j Desktop" -ForegroundColor White
Write-Host "2. Testez la connexion: cd a11\backend\apps\server && npm run test:neo4j" -ForegroundColor White
Write-Host "3. Lancez A11" -ForegroundColor White

Write-Host "`nAppuyez sur une touche pour continuer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
