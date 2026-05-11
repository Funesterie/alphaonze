# 🚀 Guide rapide - Stripe + SonarQube

## Installation en 3 étapes

### 1️⃣ Installer Stripe

```bash
cd funesterie/a11/backend/apps/server
npm install stripe
```

### 2️⃣ Configurer Stripe

```bash
# Utiliser le script automatique
npm run stripe:setup

# Ou manuellement :
# 1. Créer un compte Stripe : https://dashboard.stripe.com/register
# 2. Créer un produit à 2,99€/mois
# 3. Configurer le webhook
# 4. Copier les clés dans .env.local
```

### 3️⃣ Analyser la sécurité

```bash
# Analyse locale (recommandé pour commencer)
npm run sonar:local

# Ou analyse distante (avec token)
npm run sonar
```

## Variables d'environnement

Ajouter dans `.env.local` :

```bash
# Stripe
STRIPE_SECRET_KEY=<STRIPE_SECRET_KEY>
STRIPE_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=<STRIPE_WEBHOOK_SECRET>

# SonarQube (optionnel)
SONAR_HOST_URL=https://sonarqube.server/
SONAR_TOKEN=your-token
```

## Migration SQL

```bash
psql $DATABASE_URL -f migrations/add-subscription-columns.sql
```

## Tests

```bash
# Tester avec les cartes Stripe de test
# Succès : 4242 4242 4242 4242
# Échec : 4000 0000 0000 0002

# Vérifier les routes protégées
curl -X POST http://localhost:3000/api/jobs/sd \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "un panda"}'

# Devrait retourner 403 si pas d'abonnement
```

## Documentation complète

- **Stripe** : `STRIPE_INTEGRATION.md`
- **SonarQube** : `SONARQUBE_STRIPE_SECURITY.md`
- **Résumé** : `INTEGRATION_COMPLETE.md`

## Support

Questions ? Consultez :

1. `INTEGRATION_COMPLETE.md` - Vue d'ensemble
2. `STRIPE_INTEGRATION.md` - Guide Stripe détaillé
3. `SONARQUBE_STRIPE_SECURITY.md` - Règles de sécurité

---

**Prêt à déployer !** 🎉
