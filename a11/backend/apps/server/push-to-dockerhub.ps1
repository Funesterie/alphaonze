#!/usr/bin/env pwsh
# Script de build et push vers Docker Hub
# Usage: .\push-to-dockerhub.ps1

$ErrorActionPreference = "Stop"

Write-Host "🐳 A11 Backend - Build et Push vers Docker Hub" -ForegroundColor Cyan
Write-Host ""

# Configuration
$IMAGE_NAME = "a11-backend"
$DOCKER_HUB_USER = "funeste38"
$DOCKER_HUB_REPO = "$DOCKER_HUB_USER/$IMAGE_NAME"
$VERSION = "v1.0.0"
$DATE_TAG = Get-Date -Format "yyyy-MM-dd"

# Vérifier si Docker est disponible
Write-Host "🔍 Vérification de Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker trouvé: $dockerVersion" -ForegroundColor Green
}
catch {
    Write-Host "❌ Docker n'est pas installé ou n'est pas dans le PATH" -ForegroundColor Red
    Write-Host "   Essai avec Podman..." -ForegroundColor Yellow
    try {
        $podmanVersion = podman --version
        Write-Host "✅ Podman trouvé: $podmanVersion" -ForegroundColor Green
        # Créer un alias docker -> podman
        Set-Alias -Name docker -Value podman -Scope Script
    }
    catch {
        Write-Host "❌ Ni Docker ni Podman ne sont disponibles" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Vérifier si on est dans le bon répertoire
if (-not (Test-Path "Dockerfile")) {
    Write-Host "❌ Dockerfile non trouvé. Assurez-vous d'être dans le répertoire du backend." -ForegroundColor Red
    exit 1
}

Write-Host "📦 Étape 1/5 : Build de l'image..." -ForegroundColor Cyan
Write-Host "   Commande: docker build -t $IMAGE_NAME`:latest ." -ForegroundColor Gray
docker build -t "$IMAGE_NAME`:latest" .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Échec du build" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build réussi" -ForegroundColor Green
Write-Host ""

# Vérifier si l'utilisateur est connecté à Docker Hub
Write-Host "🔐 Étape 2/5 : Vérification de la connexion Docker Hub..." -ForegroundColor Cyan
$loginCheck = docker info 2>&1 | Select-String "Username"

if (-not $loginCheck) {
    Write-Host "⚠️  Vous n'êtes pas connecté à Docker Hub" -ForegroundColor Yellow
    Write-Host "   Connexion en cours..." -ForegroundColor Yellow
    docker login
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Échec de la connexion" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Connecté à Docker Hub" -ForegroundColor Green
Write-Host ""

# Tag de l'image
Write-Host "🏷️  Étape 3/5 : Tag de l'image..." -ForegroundColor Cyan
Write-Host "   Tags à créer:" -ForegroundColor Gray
Write-Host "   - $DOCKER_HUB_REPO`:latest" -ForegroundColor Gray
Write-Host "   - $DOCKER_HUB_REPO`:$VERSION" -ForegroundColor Gray
Write-Host "   - $DOCKER_HUB_REPO`:$DATE_TAG" -ForegroundColor Gray

docker tag "$IMAGE_NAME`:latest" "$DOCKER_HUB_REPO`:latest"
docker tag "$IMAGE_NAME`:latest" "$DOCKER_HUB_REPO`:$VERSION"
docker tag "$IMAGE_NAME`:latest" "$DOCKER_HUB_REPO`:$DATE_TAG"

Write-Host "✅ Tags créés" -ForegroundColor Green
Write-Host ""

# Push vers Docker Hub
Write-Host "📤 Étape 4/5 : Push vers Docker Hub..." -ForegroundColor Cyan
Write-Host "   Cela peut prendre plusieurs minutes..." -ForegroundColor Yellow
Write-Host ""

Write-Host "   Push de $DOCKER_HUB_REPO`:latest..." -ForegroundColor Gray
docker push "$DOCKER_HUB_REPO`:latest"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Échec du push (latest)" -ForegroundColor Red
    exit 1
}

Write-Host "   Push de $DOCKER_HUB_REPO`:$VERSION..." -ForegroundColor Gray
docker push "$DOCKER_HUB_REPO`:$VERSION"

Write-Host "   Push de $DOCKER_HUB_REPO`:$DATE_TAG..." -ForegroundColor Gray
docker push "$DOCKER_HUB_REPO`:$DATE_TAG"

Write-Host "✅ Push réussi" -ForegroundColor Green
Write-Host ""

# Vérification
Write-Host "🔍 Étape 5/5 : Vérification..." -ForegroundColor Cyan
Write-Host "   URL Docker Hub: https://hub.docker.com/r/$DOCKER_HUB_REPO" -ForegroundColor Gray
Write-Host ""

# Afficher les images locales
Write-Host "📊 Images locales:" -ForegroundColor Cyan
docker images | Select-String -Pattern "$IMAGE_NAME|$DOCKER_HUB_REPO" | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
Write-Host ""

# Résumé
Write-Host "✅ Terminé avec succès!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Résumé:" -ForegroundColor Cyan
Write-Host "   Repository: $DOCKER_HUB_REPO" -ForegroundColor White
Write-Host "   Tags pushés:" -ForegroundColor White
Write-Host "   - latest" -ForegroundColor White
Write-Host "   - $VERSION" -ForegroundColor White
Write-Host "   - $DATE_TAG" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Pour utiliser l'image:" -ForegroundColor Cyan
Write-Host "   docker pull $DOCKER_HUB_REPO`:latest" -ForegroundColor White
Write-Host "   docker run -d -p 3000:3000 --env-file .env.docker $DOCKER_HUB_REPO`:latest" -ForegroundColor White
Write-Host ""
Write-Host "🌐 Voir sur Docker Hub:" -ForegroundColor Cyan
Write-Host "   https://hub.docker.com/r/$DOCKER_HUB_REPO" -ForegroundColor White
Write-Host ""
