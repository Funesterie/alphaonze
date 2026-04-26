# Script pour installer le modèle d'embeddings Ollama pour A11
# Usage: .\install-embedding-model.ps1

Write-Host "=== Installation du modèle d'embeddings pour A11 ===" -ForegroundColor Cyan

# Vérifier si Ollama est installé
$ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue

if (-not $ollamaPath) {
    Write-Host "`nERREUR: Ollama n'est pas installé ou pas dans le PATH" -ForegroundColor Red
    Write-Host "Installez Ollama depuis: https://ollama.ai" -ForegroundColor Yellow
    Write-Host "Ou vérifiez que Ollama est dans votre PATH" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Ollama trouvé: $($ollamaPath.Source)" -ForegroundColor Green

# Vérifier si Ollama est en cours d'exécution
Write-Host "`nVérification du service Ollama..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -Method GET -TimeoutSec 5 -ErrorAction Stop
    Write-Host "✓ Ollama est en cours d'exécution" -ForegroundColor Green
}
catch {
    Write-Host "⚠ Ollama ne répond pas sur http://127.0.0.1:11434" -ForegroundColor Yellow
    Write-Host "Démarrage d'Ollama..." -ForegroundColor Cyan
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# Lister les modèles installés
Write-Host "`nModèles Ollama installés:" -ForegroundColor Cyan
ollama list

# Vérifier si nomic-embed-text est déjà installé
$models = ollama list | Out-String
if ($models -match "nomic-embed-text") {
    Write-Host "`n✓ Le modèle nomic-embed-text est déjà installé" -ForegroundColor Green
    Write-Host "`nPour activer les embeddings dans A11:" -ForegroundColor Cyan
    Write-Host "1. Ouvrez a11/backend/apps/server/.env.local" -ForegroundColor White
    Write-Host "2. Changez A11_ENABLE_EMBEDDINGS=false en A11_ENABLE_EMBEDDINGS=true" -ForegroundColor White
    Write-Host "3. Redémarrez A11" -ForegroundColor White
    exit 0
}

# Installer nomic-embed-text
Write-Host "`nInstallation du modèle nomic-embed-text..." -ForegroundColor Cyan
Write-Host "Cela peut prendre quelques minutes (téléchargement ~274 MB)..." -ForegroundColor Yellow

try {
    ollama pull nomic-embed-text
    
    Write-Host "`n✓ Modèle nomic-embed-text installé avec succès!" -ForegroundColor Green
    
    # Mettre à jour .env.local
    $envPath = "D:\projets\funesterie\a11\backend\apps\server\.env.local"
    if (Test-Path $envPath) {
        Write-Host "`nMise à jour de .env.local..." -ForegroundColor Cyan
        $envContent = Get-Content $envPath -Raw
        
        if ($envContent -match "A11_ENABLE_EMBEDDINGS=false") {
            $envContent = $envContent -replace "A11_ENABLE_EMBEDDINGS=false", "A11_ENABLE_EMBEDDINGS=true"
            Set-Content -Path $envPath -Value $envContent -NoNewline
            Write-Host "✓ A11_ENABLE_EMBEDDINGS activé dans .env.local" -ForegroundColor Green
        }
        else {
            Write-Host "⚠ A11_ENABLE_EMBEDDINGS déjà activé ou non trouvé" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n=== Installation terminée ===" -ForegroundColor Green
    Write-Host "Les embeddings sont maintenant activés pour A11." -ForegroundColor White
    Write-Host "Redémarrez A11 pour appliquer les changements." -ForegroundColor White
    
}
catch {
    Write-Host "`nERREUR lors de l'installation:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

Write-Host "`nAppuyez sur une touche pour continuer..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
