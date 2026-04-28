# Script de configuration Stripe pour A11
# Usage: pwsh -File setup-stripe.ps1

Write-Host "=== Configuration Stripe pour A11 ===" -ForegroundColor Cyan
Write-Host ""

# 1. Installation du package Stripe
Write-Host "[1/3] Installation du package Stripe..." -ForegroundColor Yellow
npm install stripe
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erreur lors de l'installation de Stripe" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Package Stripe installé" -ForegroundColor Green
Write-Host ""

# 2. Vérification de la configuration
Write-Host "[2/3] Vérification de la configuration..." -ForegroundColor Yellow

$envFile = ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "❌ Fichier .env.local non trouvé" -ForegroundColor Red
    exit 1
}

$envContent = Get-Content $envFile -Raw

$hasStripeKey = $envContent -match "STRIPE_SECRET_KEY=.+"
$hasPriceId = $envContent -match "STRIPE_PRICE_ID=.+"
$hasWebhookSecret = $envContent -match "STRIPE_WEBHOOK_SECRET=.+"

if (-not $hasStripeKey) {
    Write-Host "⚠️  STRIPE_SECRET_KEY non configuré dans .env.local" -ForegroundColor Yellow
}
if (-not $hasPriceId) {
    Write-Host "⚠️  STRIPE_PRICE_ID non configuré dans .env.local" -ForegroundColor Yellow
}
if (-not $hasWebhookSecret) {
    Write-Host "⚠️  STRIPE_WEBHOOK_SECRET non configuré dans .env.local" -ForegroundColor Yellow
}

if ($hasStripeKey -and $hasPriceId -and $hasWebhookSecret) {
    Write-Host "✅ Configuration Stripe complète" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "📝 Configuration manuelle requise :" -ForegroundColor Cyan
    Write-Host "   1. Créer un compte Stripe : https://dashboard.stripe.com/register" -ForegroundColor White
    Write-Host "   2. Créer un produit (2,99€/mois)" -ForegroundColor White
    Write-Host "   3. Copier le price_id" -ForegroundColor White
    Write-Host "   4. Configurer le webhook" -ForegroundColor White
    Write-Host "   5. Copier le webhook_secret" -ForegroundColor White
    Write-Host "   6. Copier la clé secrète (sk_test_... ou sk_live_...)" -ForegroundColor White
    Write-Host "   7. Mettre à jour .env.local" -ForegroundColor White
}
Write-Host ""

# 3. Migration de la base de données
Write-Host "[3/3] Migration de la base de données..." -ForegroundColor Yellow

$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
    # Essayer de lire depuis .env.local
    $envLines = Get-Content $envFile
    foreach ($line in $envLines) {
        if ($line -match "^DATABASE_URL=(.+)$") {
            $databaseUrl = $matches[1]
            break
        }
    }
}

if (-not $databaseUrl) {
    Write-Host "⚠️  DATABASE_URL non configuré, migration SQL ignorée" -ForegroundColor Yellow
    Write-Host "   Exécuter manuellement : psql `$DATABASE_URL -f migrations/add-subscription-columns.sql" -ForegroundColor White
} else {
    Write-Host "Exécution de la migration SQL..." -ForegroundColor White
    
    # Vérifier si psql est disponible
    $psqlAvailable = Get-Command psql -ErrorAction SilentlyContinue
    if (-not $psqlAvailable) {
        Write-Host "⚠️  psql non disponible, migration SQL ignorée" -ForegroundColor Yellow
        Write-Host "   Installer PostgreSQL client ou exécuter manuellement" -ForegroundColor White
    } else {
        $migrationFile = "migrations/add-subscription-columns.sql"
        if (-not (Test-Path $migrationFile)) {
            Write-Host "❌ Fichier de migration non trouvé : $migrationFile" -ForegroundColor Red
        } else {
            psql $databaseUrl -f $migrationFile
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Migration SQL exécutée avec succès" -ForegroundColor Green
            } else {
                Write-Host "❌ Erreur lors de la migration SQL" -ForegroundColor Red
            }
        }
    }
}

Write-Host ""
Write-Host "=== Configuration terminée ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "📚 Documentation :" -ForegroundColor Cyan
Write-Host "   - Guide complet : STRIPE_INTEGRATION.md" -ForegroundColor White
Write-Host "   - Résumé : STRIPE_IMPLEMENTATION_SUMMARY.md" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Prochaines étapes :" -ForegroundColor Cyan
Write-Host "   1. Configurer les variables Stripe dans .env.local" -ForegroundColor White
Write-Host "   2. Tester avec Stripe Test Mode" -ForegroundColor White
Write-Host "   3. Déployer sur Railway" -ForegroundColor White
Write-Host "   4. Passer en mode production Stripe" -ForegroundColor White
Write-Host ""
