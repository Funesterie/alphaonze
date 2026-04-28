# Script d'analyse SonarQube pour A11 Backend
# Usage: pwsh -File run-sonar-analysis.ps1

param(
    [string]$SonarUrl = "https://sonarqube.server/",
    [string]$SonarToken = "",
    [switch]$Local = $false
)

Write-Host "=== Analyse SonarQube pour A11 Backend ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier si sonar-scanner est installé
$sonarScanner = Get-Command sonar-scanner -ErrorAction SilentlyContinue
if (-not $sonarScanner) {
    Write-Host "❌ sonar-scanner non trouvé" -ForegroundColor Red
    Write-Host ""
    Write-Host "Installation requise :" -ForegroundColor Yellow
    Write-Host "  1. Télécharger : https://docs.sonarqube.org/latest/analysis/scan/sonarscanner/" -ForegroundColor White
    Write-Host "  2. Ajouter au PATH" -ForegroundColor White
    Write-Host "  3. Ou utiliser : npm install -g sonarqube-scanner" -ForegroundColor White
    exit 1
}

# Lire les variables depuis .env.local si disponible
$envFile = ".env.local"
if (Test-Path $envFile) {
    Write-Host "📄 Lecture de .env.local..." -ForegroundColor Yellow
    $envContent = Get-Content $envFile
    foreach ($line in $envContent) {
        if ($line -match "^SONAR_HOST_URL=(.+)$") {
            $SonarUrl = $matches[1]
        }
        if ($line -match "^SONAR_TOKEN=(.+)$") {
            $SonarToken = $matches[1]
        }
    }
}

# Mode local (sans authentification)
if ($Local) {
    Write-Host "🔍 Mode local (sans authentification)" -ForegroundColor Yellow
    Write-Host ""
    
    sonar-scanner `
        -Dsonar.projectKey=a11-backend-server `
        -Dsonar.sources=. `
        -Dsonar.host.url=http://localhost:9000
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Analyse terminée avec succès" -ForegroundColor Green
        Write-Host "📊 Résultats : http://localhost:9000/dashboard?id=a11-backend-server" -ForegroundColor Cyan
    }
    else {
        Write-Host ""
        Write-Host "❌ Erreur lors de l'analyse" -ForegroundColor Red
        exit 1
    }
}
else {
    # Mode distant (avec authentification)
    if (-not $SonarToken) {
        Write-Host "❌ Token SonarQube requis" -ForegroundColor Red
        Write-Host ""
        Write-Host "Options :" -ForegroundColor Yellow
        Write-Host "  1. Passer le token : -SonarToken 'your-token'" -ForegroundColor White
        Write-Host "  2. Ajouter dans .env.local : SONAR_TOKEN=your-token" -ForegroundColor White
        Write-Host "  3. Utiliser mode local : -Local" -ForegroundColor White
        exit 1
    }
    
    Write-Host "🔍 Analyse vers : $SonarUrl" -ForegroundColor Yellow
    Write-Host ""
    
    sonar-scanner `
        -Dsonar.projectKey=a11-backend-server `
        -Dsonar.sources=. `
        -Dsonar.host.url=$SonarUrl `
        -Dsonar.login=$SonarToken
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Analyse terminée avec succès" -ForegroundColor Green
        Write-Host "📊 Résultats : $SonarUrl/dashboard?id=a11-backend-server" -ForegroundColor Cyan
    }
    else {
        Write-Host ""
        Write-Host "❌ Erreur lors de l'analyse" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=== Analyse terminée ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "🔍 Points à vérifier :" -ForegroundColor Cyan
Write-Host "   - Sécurité (Security Hotspots)" -ForegroundColor White
Write-Host "   - Bugs critiques" -ForegroundColor White
Write-Host "   - Vulnérabilités" -ForegroundColor White
Write-Host "   - Code Smells" -ForegroundColor White
Write-Host "   - Couverture de tests" -ForegroundColor White
Write-Host ""
