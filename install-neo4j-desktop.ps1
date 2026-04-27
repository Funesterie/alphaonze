# Script d'installation Neo4j Desktop avec emplacement personnalisé
# Usage: .\install-neo4j-desktop.ps1

param(
    [string]$InstallerPath = "D:\projets\funesterie\neo4j-desktop-2.1.4-x64.exe",
    [string]$InstallDir = "D:\projets\funesterie\Neo4j Desktop 2",
    [switch]$Silent = $true
)

Write-Host "=== Installation Neo4j Desktop ===" -ForegroundColor Cyan
Write-Host "Installateur: $InstallerPath" -ForegroundColor Yellow
Write-Host "Destination: $InstallDir" -ForegroundColor Yellow

# Vérifier que l'installateur existe
if (-not (Test-Path $InstallerPath)) {
    Write-Host "ERREUR: Installateur introuvable à $InstallerPath" -ForegroundColor Red
    exit 1
}

# Créer le répertoire de destination s'il n'existe pas
if (-not (Test-Path $InstallDir)) {
    Write-Host "Création du répertoire: $InstallDir" -ForegroundColor Green
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Paramètres d'installation silencieuse pour NSIS
# /S = Silent mode
# /D= = Installation directory (DOIT être le dernier paramètre, sans guillemets)
$arguments = @(
    "/S"  # Mode silencieux
)

# Le répertoire d'installation DOIT être le dernier argument et sans guillemets
$installCommand = "& `"$InstallerPath`" /S /D=$InstallDir"

Write-Host "`nLancement de l'installation..." -ForegroundColor Green
Write-Host "Commande: $installCommand" -ForegroundColor Gray

try {
    # Lancer l'installation
    Start-Process -FilePath $InstallerPath -ArgumentList "/S", "/D=$InstallDir" -Wait -NoNewWindow
    
    Write-Host "`n✓ Installation terminée!" -ForegroundColor Green
    
    # Vérifier que l'installation a réussi
    $neo4jExe = Join-Path $InstallDir "Neo4j Desktop.exe"
    if (Test-Path $neo4jExe) {
        Write-Host "✓ Neo4j Desktop trouvé: $neo4jExe" -ForegroundColor Green
    } else {
        Write-Host "⚠ Neo4j Desktop.exe non trouvé dans $InstallDir" -ForegroundColor Yellow
        Write-Host "L'installation peut avoir utilisé un chemin par défaut." -ForegroundColor Yellow
    }
    
    # Mettre à jour le .env.local avec le bon chemin
    $envPath = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
    if (Test-Path $envPath) {
        Write-Host "`nMise à jour de .env.local..." -ForegroundColor Cyan
        $envContent = Get-Content $envPath -Raw
        
        # Vérifier si NEO4J_DESKTOP_PATH existe déjà
        if ($envContent -match "NEO4J_DESKTOP_PATH=") {
            $envContent = $envContent -replace "NEO4J_DESKTOP_PATH=.*", "NEO4J_DESKTOP_PATH=$InstallDir"
        } else {
            # Ajouter après la section Neo4j
            $envContent = $envContent -replace "(NEO4J_DATABASE=.*)", "`$1`nNEO4J_DESKTOP_PATH=$InstallDir"
        }
        
        Set-Content -Path $envPath -Value $envContent -NoNewline
        Write-Host "✓ .env.local mis à jour" -ForegroundColor Green
    }
    
    Write-Host "`n=== Prochaines étapes ===" -ForegroundColor Cyan
    Write-Host "1. Lancez Neo4j Desktop depuis: $neo4jExe" -ForegroundColor White
    Write-Host "2. Créez une nouvelle base de données locale" -ForegroundColor White
    Write-Host "3. Utilisez les credentials par défaut:" -ForegroundColor White
    Write-Host "   - Username: neo4j" -ForegroundColor Gray
    Write-Host "   - Password: neo4j" -ForegroundColor Gray
    Write-Host "4. La base sera accessible sur bolt://localhost:7687" -ForegroundColor White
    
} catch {
    Write-Host "`nERREUR lors de l'installation:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Configuration SSH (optionnel) ===" -ForegroundColor Cyan
Write-Host "Pour accéder à Neo4j via SSH tunnel:" -ForegroundColor White
Write-Host "ssh -L 7687:localhost:7687 user@remote-server" -ForegroundColor Gray
Write-Host "`nPour A11, le protocole Bolt (port 7687) est utilisé directement." -ForegroundColor Yellow
