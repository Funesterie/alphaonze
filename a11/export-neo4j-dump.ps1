# Script pour exporter un dump Neo4j depuis A11
# Usage: .\export-neo4j-dump.ps1

param(
    [string]$OutputPath = "D:\projets\funesterie\Neo4j Desktop 2\neo4j-db-dump-$(Get-Date -Format 'yyyyMMdd-HHmmss')",
    [string]$DatabaseName = "a11-knowledge-graph",
    # Chemin réel de l'instance Neo4j Desktop (trouvé dans les logs)
    [string]$Neo4jBin = "C:\Users\$env:USERNAME\.Neo4jDesktop2\Data\dbmss\dbms-3c55be75-f0b8-4280-9649-0b4e818bf2f1\bin"
)

Write-Host "=== Export de dump Neo4j pour A11 ===" -ForegroundColor Cyan
Write-Host "Base source  : $DatabaseName" -ForegroundColor Yellow
Write-Host "Destination  : $OutputPath" -ForegroundColor Yellow
Write-Host "Neo4j bin    : $Neo4jBin" -ForegroundColor Yellow

# Vérifier neo4j-admin
$neo4jAdmin = Join-Path $Neo4jBin "neo4j-admin.bat"
if (-not (Test-Path $neo4jAdmin)) {
    Write-Host "ERREUR: neo4j-admin.bat introuvable: $neo4jAdmin" -ForegroundColor Red
    exit 1
}
Write-Host "`n✓ neo4j-admin trouvé" -ForegroundColor Green

# Créer le répertoire de sortie
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
Write-Host "✓ Répertoire créé: $OutputPath" -ForegroundColor Green

# Avertissement
Write-Host "`n⚠️  Arrêtez la base '$DatabaseName' dans Neo4j Desktop avant de continuer." -ForegroundColor Yellow
Write-Host "Appuyez sur une touche quand la base est arrêtée..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host "`nExport en cours..." -ForegroundColor Cyan

try {
    & $neo4jAdmin database dump --to-path="$OutputPath" $DatabaseName

    if ($LASTEXITCODE -eq 0) {
        $dumpFiles = Get-ChildItem -Path $OutputPath -Filter "*.dump" | Sort-Object LastWriteTime -Descending
        if ($dumpFiles.Count -gt 0) {
            $dumpFile = $dumpFiles[0]
            $sizeMB = [math]::Round($dumpFile.Length / 1MB, 2)
            Write-Host "`n✓ Export réussi!" -ForegroundColor Green
            Write-Host "✓ Fichier: $($dumpFile.FullName)" -ForegroundColor Green
            Write-Host "✓ Taille : $sizeMB MB" -ForegroundColor Green
        }
    }
    else {
        Write-Host "`n✗ Export échoué (code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host "`nERREUR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`nAppuyez sur une touche pour quitter..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
