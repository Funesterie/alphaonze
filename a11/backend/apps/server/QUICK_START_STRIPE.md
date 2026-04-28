# 🚀 Quick Start - Configuration Stripe

## Étape 1 : Créer un compte Stripe

1. Aller sur https://dashboard.stripe.com/register
2. Créer un compte (gratuit)
3. Activer le mode Test

## Étape 2 : Créer le produit

1. Dans le Dashboard Stripe, aller dans **Produits** → **Ajouter un produit**
2. Remplir :
   - **Nom** : `A11 Premium - Génération d'images et vidéos`
   - **Description** : `Accès illimité à la génération d'images et vidéos avec A11`
   - **Prix** : `2,99 EUR`
   - **Type de facturation** : `Récurrent`
   - **Période de facturation** : `Mensuel`
3. Cliquer sur **Enregistrer le produit**
4. **Copier le `price_id`** (commence par `price_...`)

## Étape 3 : Configurer le webhook

1. Dans le Dashboard Stripe, aller dans **Développeurs** → **Webhooks**
2. Cliquer sur **Ajouter un endpoint**
3. Remplir :
   - **URL de l'endpoint** : `https://api.funesterie.pro/api/subscription/webhook`
   - Pour le test local : `http://localhost:3000/api/subscription/webhook`
4. Sélectionner les événements :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Cliquer sur **Ajouter un endpoint**
6. **Copier le `webhook_secret`** (commence par `whsec_...`)

## Étape 4 : Récupérer la clé secrète

1. Dans le Dashboard Stripe, aller dans **Développeurs** → **Clés API**
2. **Copier la clé secrète** (commence par `sk_test_...` en mode test)
3. ⚠️ **Ne jamais partager cette clé !**

## Étape 5 : Configurer .env.local

Ouvrir `funesterie/a11/backend/apps/server/.env.local` et remplir :

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_SECRETE
STRIPE_PRICE_ID=price_VOTRE_PRICE_ID
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_WEBHOOK_SECRET
```

## Étape 6 : Exécuter la migration SQL

```bash
cd funesterie/a11/backend/apps/server
psql $DATABASE_URL -f migrations/add-subscription-columns.sql
```

Ou manuellement dans psql :

```sql
ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_active ON users(subscription_active);

UPDATE users
SET subscription_active = TRUE
WHERE role = 'admin';
```

## Étape 7 : Tester l'intégration

```bash
cd funesterie/a11/backend/apps/server
node test-stripe-integration.cjs
```

Vous devriez voir :

```
✅ Intégration Stripe complète et fonctionnelle
```

## Étape 8 : Démarrer le serveur

```bash
npm start
```

## Étape 9 : Tester avec une carte de test

Utiliser les cartes de test Stripe :

- **Succès** : `4242 4242 4242 4242`
- **Échec** : `4000 0000 0000 0002`
- **3D Secure** : `4000 0027 6000 3184`

Date d'expiration : N'importe quelle date future  
CVC : N'importe quel 3 chiffres  
Code postal : N'importe quel code

## Étape 10 : Tester les endpoints

### Créer une session de checkout

```bash
curl -X POST http://localhost:3000/api/subscription/create-checkout \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

### Vérifier le statut d'abonnement

```bash
curl -X GET http://localhost:3000/api/subscription/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Tester une route protégée (génération d'image)

```bash
curl -X POST http://localhost:3000/api/jobs/sd \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "un panda mignon"}'
```

Devrait retourner :

- **403 Forbidden** si pas d'abonnement
- **200 OK** si abonnement actif ou admin

## Webhooks en local (optionnel)

Pour tester les webhooks en local, utiliser Stripe CLI :

```bash
# Installer Stripe CLI
# https://stripe.com/docs/stripe-cli

# Écouter les webhooks
stripe listen --forward-to localhost:3000/api/subscription/webhook

# Dans un autre terminal, déclencher un événement de test
stripe trigger checkout.session.completed
```

## Passer en production

1. Dans le Dashboard Stripe, **activer le mode Production**
2. Créer le même produit en mode production
3. Configurer le webhook en production avec l'URL publique
4. Récupérer les nouvelles clés (commencent par `sk_live_...`)
5. Mettre à jour `.env.local` avec les clés de production
6. Déployer sur Railway

## Checklist finale

- [ ] Compte Stripe créé
- [ ] Produit créé (2,99€/mois)
- [ ] Webhook configuré
- [ ] Clés copiées dans `.env.local`
- [ ] Migration SQL exécutée
- [ ] Test d'intégration passé (`node test-stripe-integration.cjs`)
- [ ] Serveur démarré
- [ ] Endpoints testés
- [ ] Carte de test validée

## Aide

- **Documentation complète** : `STRIPE_INTEGRATION.md`
- **Résumé** : `INTEGRATION_COMPLETE.md`
- **Test** : `node test-stripe-integration.cjs`
- **Support Stripe** : https://support.stripe.com/

---

**Temps estimé** : 15-20 minutes  
**Difficulté** : Facile  
**Prérequis** : Compte Stripe (gratuit)
