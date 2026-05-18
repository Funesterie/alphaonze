# 📝 Cheatsheet - Commandes utiles

## Installation

```bash
cd funesterie/a11/backend/apps/server

# Installer les dépendances
npm install

# Vérifier que Stripe est installé
npm list stripe
```

## Configuration Stripe

```bash
# Script automatique (recommandé)
npm run stripe:setup

# Test de l'intégration
npm run test:stripe

# Migration SQL
psql $DATABASE_URL -f migrations/add-subscription-columns.sql
```

## Développement

```bash
# Démarrer le serveur
npm start
# ou
npm run dev

# Démarrer le routeur LLM
npm run dev:router
```

## Tests

```bash
# Tests de contrats
npm run test:contracts

# Tests E2E
npm run test:e2e:artifact

# Test Neo4j
npm run test:neo4j

# Test Stripe
npm run test:stripe
```

## Analyse de qualité

```bash
# Analyse SonarQube locale
npm run sonar:local

# Analyse SonarQube distante
npm run sonar

# Avec paramètres personnalisés
pwsh -File run-sonar-analysis.ps1 -SonarUrl "https://your-sonar.com" -SonarToken "token"
```

## Base de données

```bash
# Initialiser la DB
npm run db:init

# Migration Stripe
psql $DATABASE_URL -f migrations/add-subscription-columns.sql

# Vérifier les colonnes
psql $DATABASE_URL -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' AND column_name LIKE 'stripe%' OR column_name LIKE 'subscription%';"

# Activer l'abonnement pour un admin
psql $DATABASE_URL -c "UPDATE users SET subscription_active = TRUE WHERE role = 'admin';"
```

## Stripe Dashboard

```bash
# Ouvrir le Dashboard Stripe
start https://dashboard.stripe.com/

# Ouvrir les webhooks
start https://dashboard.stripe.com/webhooks

# Ouvrir les produits
start https://dashboard.stripe.com/products

# Ouvrir les clés API
start https://dashboard.stripe.com/apikeys
```

## Stripe CLI (optionnel)

```bash
# Installer Stripe CLI
# https://stripe.com/docs/stripe-cli

# Login
stripe login

# Écouter les webhooks en local
stripe listen --forward-to localhost:3000/api/subscription/webhook

# Déclencher un événement de test
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted

# Voir les logs
stripe logs tail
```

## Endpoints API

### Abonnement

```bash
# Créer une session de checkout
curl -X POST http://localhost:3000/api/subscription/create-checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Créer une session du portail client
curl -X POST http://localhost:3000/api/subscription/create-portal \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# Vérifier le statut d'abonnement
curl -X GET http://localhost:3000/api/subscription/status \
  -H "Authorization: Bearer $TOKEN"

# Webhook (appelé par Stripe)
# POST http://localhost:3000/api/subscription/webhook
```

### Routes protégées (nécessitent abonnement)

```bash
# Génération d'image
curl -X POST http://localhost:3000/api/jobs/sd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "un panda mignon"}'

# Vérifier le statut du job
curl -X GET http://localhost:3000/api/jobs/sd/JOB_ID \
  -H "Authorization: Bearer $TOKEN"
```

## Logs

```bash
# Voir les logs en temps réel
tail -f logs/a11-server.log

# Filtrer les logs Stripe
tail -f logs/a11-server.log | grep "\[Stripe\]"

# Filtrer les logs Subscription
tail -f logs/a11-server.log | grep "\[Subscription\]"

# Filtrer les erreurs
tail -f logs/a11-server.log | grep "ERROR"
```

## Déploiement Railway

```bash
# Build (pas nécessaire pour le backend)
npm run railway:build

# Variables d'environnement à configurer sur Railway
# - STRIPE_SECRET_KEY
# - STRIPE_PRICE_ID
# - STRIPE_WEBHOOK_SECRET
# - DATABASE_URL (déjà configuré)

# Déployer
git push railway master
```

## Debugging

```bash
# Vérifier les variables d'environnement
node -e "console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'NOT SET')"
node -e "console.log('STRIPE_PRICE_ID:', process.env.STRIPE_PRICE_ID ? 'SET' : 'NOT SET')"
node -e "console.log('STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET ? 'SET' : 'NOT SET')"

# Tester la connexion à la DB
npm run test:neo4j

# Vérifier les diagnostics
node --check server.cjs
node --check lib/stripe-service.cjs
node --check routes/subscription.cjs
node --check middleware/check-subscription.cjs
```

## Cartes de test Stripe

```bash
# Succès
4242 4242 4242 4242

# Échec
4000 0000 0000 0002

# 3D Secure requis
4000 0027 6000 3184

# Fonds insuffisants
4000 0000 0000 9995

# Carte expirée
4000 0000 0000 0069

# CVC incorrect
4000 0000 0000 0127
```

## Nettoyage

```bash
# Supprimer node_modules
rm -rf node_modules

# Réinstaller
npm install

# Nettoyer les logs
rm -rf logs/*.log

# Nettoyer le cache npm
npm cache clean --force
```

## Documentation

```bash
# Ouvrir la documentation
start QUICK_START_STRIPE.md
start STRIPE_INTEGRATION.md
start INTEGRATION_COMPLETE.md
start SONARQUBE_STRIPE_SECURITY.md
```

## Raccourcis utiles

```bash
# Tout en un : test + démarrage
npm run test:stripe && npm start

# Analyse + démarrage
npm run sonar:local && npm start

# Setup complet
npm run stripe:setup && npm run test:stripe && npm start
```

## Variables d'environnement importantes

```bash
# Stripe
# STRIPE_SECRET_KEY is configured via the deployment secret store.
STRIPE_PRICE_ID=price_...
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.

# URLs de redirection
STRIPE_SUCCESS_URL=https://a11.funesterie.me/subscription/success
STRIPE_CANCEL_URL=https://a11.funesterie.me/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://a11.funesterie.me/account

# SonarQube (optionnel)
SONAR_HOST_URL=https://sonarqube.server/
SONAR_TOKEN=your-token

# Database
DATABASE_URL=postgresql://...
```

## Aide rapide

- **Quick Start** : `QUICK_START_STRIPE.md`
- **Documentation complète** : `STRIPE_INTEGRATION.md`
- **Sécurité** : `SONARQUBE_STRIPE_SECURITY.md`
- **Résumé** : `INTEGRATION_COMPLETE.md`
- **Support Stripe** : https://support.stripe.com/
- **Docs Stripe** : https://stripe.com/docs

---

**Tip** : Ajouter ces commandes à vos alias shell pour un accès rapide !
