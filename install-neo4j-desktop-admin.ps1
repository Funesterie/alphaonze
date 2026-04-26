# Script d'installation Neo4j Desktop avec élévation automatique
# Ce script demande les privilèges administrateur si nécessaire

param(
    [string]$InstallerPath = "D:\projets\funesterie\neo4j-desktop-2.1.4-x64.exe",
    [string]$InstallDir = "D:\projets\funesterie\Neo4j Desktop 2"
)

# Vérifier si on est déjà administrateur
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "=== Élévation des privilèges requise ===" -ForegroundColor Yellow
    Write-Host "Relancement du script en tant qu'administrateur..." -ForegroundColor Cyan
    
    # Relancer le script avec élévation
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallerPath `"$InstallerPath`" -InstallDir `"$InstallDir`""
    Start-Process powershell.exe -ArgumentList $arguments -Verb RunAs -Wait
    
    Write-Host "`nAppuyez sur une touche pour continuer..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

# À partir d'ici, on est administrateur
Write-Host "=== Installation Neo4j Desktop (Administrateur) ===" -ForegroundColor Cyan
Write-Host "Installateur: $InstallerPath" -ForegroundColor Yellow
Write-Host "Destination: $InstallDir" -ForegroundColor Yellow

# Vérifier que l'installateur existe
if (-not (Test-Path $InstallerPath)) {
    Write-Host "`nERREUR: Installateur introuvable à $InstallerPath" -ForegroundColor Red
    Write-Host "Appuyez sur une touche pour quitter..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Créer le répertoire de destination s'il n'existe pas
if (-not (Test-Path $InstallDir)) {
    Write-Host "`nCréation du répertoire: $InstallDir" -ForegroundColor Green
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Write-Host "`nLancement de l'installation..." -ForegroundColor Green
Write-Host "Cela peut prendre quelques minutes..." -ForegroundColor Gray

try {
    # Lancer l'installation en mode silencieux
    $process = Start-Process -FilePath $InstallerPath -ArgumentList "/S", "/D=$InstallDir" -Wait -PassThru -NoNewWindow
    
    if ($process.ExitCode -eq 0) {
        Write-Host "`n✓ Installation terminée avec succès!" -ForegroundColor Green
        
        # Vérifier que l'installation a réussi
        $neo4jExe = Join-Path $InstallDir "Neo4j Desktop.exe"
        if (Test-Path $neo4jExe) {
            Write-Host "✓ Neo4j Desktop trouvé: $neo4jExe" -ForegroundColor Green
        }
        else {
            Write-Host "⚠ Neo4j Desktop.exe non trouvé dans $InstallDir" -ForegroundColor Yellow
            Write-Host "Recherche dans les emplacements par défaut..." -ForegroundColor Yellow
            
            # Chercher dans les emplacements par défaut
            $defaultPaths = @(
                "$env:LOCALAPPDATA\Programs\Neo4j Desktop\Neo4j Desktop.exe",
                "$env:ProgramFiles\Neo4j Desktop\Neo4j Desktop.exe",
                "${env:ProgramFiles(x86)}\Neo4j Desktop\Neo4j Desktop.exe"
            )
            
            foreach ($path in $defaultPaths) {
                if (Test-Path $path) {
                    Write-Host "✓ Trouvé dans: $path" -ForegroundColor Green
                    $neo4jExe = $path
                    $InstallDir = Split-Path $path -Parent
                    break
                }
            }
        }
        
        # Mettre à jour le .env.local avec le bon chemin
        $envPath = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
        if (Test-Path $envPath) {
            Write-Host "`nMise à jour de .env.local..." -ForegroundColor Cyan
            $envContent = Get-Content $envPath -Raw
            
            # Vérifier si NEO4J_DESKTOP_PATH existe déjà
            if ($envContent -match "NEO4J_DESKTOP_PATH=") {
                $envContent = $envContent -replace "NEO4J_DESKTOP_PATH=.*", "NEO4J_DESKTOP_PATH=$InstallDir"
            }
            else {
                # Ajouter après la section Neo4j
                $envContent = $envContent -replace "(NEO4J_DATABASE=.*)", "`$1`nNEO4J_DESKTOP_PATH=$InstallDir"
            }
            
            Set-Content -Path $envPath -Value $envContent -NoNewline
            Write-Host "✓ .env.local mis à jour" -ForegroundColor Green
        }
        
        Write-Host "`n=== Prochaines étapes ===" -ForegroundColor Cyan
        Write-Host "1. Lancez Neo4j Desktop depuis: $neo4jExe" -ForegroundColor White
        Write-Host "2. Créez un nouveau projet 'A11'" -ForegroundColor White
        Write-Host "3. Créez une base de données locale 'a11-knowledge-graph'" -ForegroundColor White
        Write-Host "4. Utilisez les credentials par défaut:" -ForegroundColor White
        Write-Host "   - Username: neo4j" -ForegroundColor Gray
        Write-Host "   - Password: neo4j" -ForegroundColor Gray
        Write-Host "5. Testez la connexion: cd a11\backend\apps\server && npm run test:neo4j" -ForegroundColor White
        
        Write-Host "`nConsultez NEO4J_SETUP.md pour plus de détails." -ForegroundColor Cyan
        
    }
    else {
        Write-Host "`n✗ L'installation a échoué avec le code: $($process.ExitCode)" -ForegroundColor Red
    }
    
}
catch {
    Write-Host "`nERREUR lors de l'installation:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host "`nAppuyez sur une touche pour quitter..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
