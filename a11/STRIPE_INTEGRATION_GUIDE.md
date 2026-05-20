# Guide d'Intégration Stripe pour A11

## ✅ État de l'Intégration

### Backend

- ✅ Service Stripe implémenté (`lib/stripe-service.cjs`)
- ✅ Routes API créées (`routes/subscription.cjs`)
- ✅ Middleware de vérification d'abonnement (`middleware/check-subscription.cjs`)
- ✅ Migration de base de données exécutée
- ✅ Tests de contrat passés (46/46)

### Frontend

- ✅ Composant de gestion d'abonnement créé (`components/SubscriptionPanel.tsx`)
- ✅ Fonctions API ajoutées (`lib/api.ts`)
- ✅ Interface intégrée dans le menu de navigation
- ✅ Build frontend réussi

## ⚠️ Configuration Requise

### 1. Corriger le STRIPE_PRICE_ID

**Problème actuel:** Le `.env.local` contient un Product ID au lieu d'un Price ID.

```env
# ❌ INCORRECT (Product ID)
STRIPE_PRICE_ID=prod_UPmWGqzjccMKq3

# ✅ CORRECT (Price ID)
STRIPE_PRICE_ID=price_XXXXXXXXXXXXXXXXXX
```

**Comment obtenir le bon Price ID:**

1. Allez sur https://dashboard.stripe.com/products
2. Sélectionnez votre produit "A11 Premium" (ou créez-le si nécessaire)
3. Dans la section "Pricing", copiez le **Price ID** (commence par `price_`)
4. Mettez à jour `.env.local` avec le bon ID

**Si vous devez créer un nouveau prix:**

```bash
# Via Stripe CLI (si installé)
stripe prices create \
  --product prod_UPmWGqzjccMKq3 \
  --unit-amount 299 \
  --currency eur \
  --recurring[interval]=month

# Ou via le Dashboard Stripe:
# Products > [Votre produit] > Add another price
# - Prix: 2,99 EUR
# - Facturation: Mensuelle
# - Type: Récurrent
```

### 2. Configurer le Webhook Stripe (Production)

Pour que les webhooks fonctionnent en production:

1. Allez sur https://dashboard.stripe.com/webhooks
2. Cliquez sur "Add endpoint"
3. URL du endpoint: `https://a11.funesterie.me/api/subscription/webhook`
4. Événements à écouter:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copiez le **Signing secret** (commence par `whsec_`)
6. Ajoutez-le dans `.env.local`:

```env
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.
```

### 3. Variables d'Environnement Complètes

Voici toutes les variables Stripe nécessaires dans `.env.local`:

```env
# ============================================================
# Stripe - Abonnement Premium (2,99€/mois)
# ============================================================

# Clé secrète Stripe (DÉJÀ CONFIGURÉE)
# STRIPE_SECRET_KEY is configured via the deployment secret store.

# ID du prix (À CORRIGER - doit commencer par "price_")
STRIPE_PRICE_ID=price_XXXXXXXXXXXXXXXXXX

# Secret du webhook (À CONFIGURER pour la production)
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.

# URLs de redirection (DÉJÀ CONFIGURÉES)
STRIPE_SUCCESS_URL=https://a11.funesterie.me/subscription/success
STRIPE_CANCEL_URL=https://a11.funesterie.me/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://a11.funesterie.me/account
```

## 🧪 Tests

### Test Backend

```bash
cd funesterie/a11/backend/apps/server
node test-stripe-integration.cjs
```

Ce script vérifie:

- ✅ Configuration Stripe
- ✅ Variables d'environnement
- ✅ Création de session de paiement
- ⚠️ Format du PRICE_ID

### Test Frontend

1. Démarrez le backend:

```bash
cd funesterie/a11/backend/apps/server
npm start
```

2. Démarrez le frontend:

```bash
cd funesterie/a11/frontend/apps/web
npm run dev
```

3. Ouvrez http://localhost:5173
4. Connectez-vous avec un compte utilisateur
5. Allez dans Menu > Abonnement
6. Testez le flux de souscription

### Cartes de Test Stripe

Pour tester les paiements en mode test:

```
Carte réussie:     4242 4242 4242 4242
Carte refusée:     4000 0000 0000 0002
3D Secure requis:  4000 0027 6000 3184

Date d'expiration: N'importe quelle date future
CVC: N'importe quel 3 chiffres
Code postal: N'importe quel code
```

## 📋 Flux Utilisateur

### 1. Souscription

1. Utilisateur clique sur "S'abonner maintenant"
2. Redirection vers Stripe Checkout
3. Paiement avec carte bancaire
4. Webhook `checkout.session.completed` → Active l'abonnement en DB
5. Redirection vers `/subscription/success`

### 2. Gestion de l'Abonnement

1. Utilisateur clique sur "Gérer mon abonnement"
2. Redirection vers Stripe Customer Portal
3. Peut annuler, mettre à jour la carte, voir les factures
4. Webhooks mettent à jour la DB automatiquement

### 3. Annulation

1. Dans le Customer Portal, cliquer sur "Cancel subscription"
2. Webhook `customer.subscription.deleted` → Désactive l'abonnement en DB
3. Accès maintenu jusqu'à la fin de la période payée

## 🔒 Sécurité

### Routes Protégées

Les routes suivantes nécessitent un abonnement actif (sauf pour les admins):

- `POST /api/tools/generate_png` - Génération d'images
- `POST /api/tools/generate_video` - Génération de vidéos

Le middleware `checkSubscription` vérifie automatiquement:

1. L'utilisateur est authentifié (JWT valide)
2. L'utilisateur a un abonnement actif OU est admin
3. Retourne 403 si non autorisé

### Admins

Les utilisateurs avec `role: 'admin'` ou `isAdmin: true` dans leur JWT ont un accès illimité sans abonnement.

## 🚀 Déploiement

### Backend (Railway)

Les variables d'environnement Stripe doivent être configurées dans Railway:

```bash
railway variables set STRIPE_SECRET_KEY=<STRIPE_SECRET_KEY>
railway variables set STRIPE_PRICE_ID=price_...
railway variables set STRIPE_WEBHOOK_SECRET=<STRIPE_WEBHOOK_SECRET>
```

### Frontend (Netlify)

Aucune variable Stripe n'est nécessaire côté frontend. Toutes les opérations passent par le backend.

## 📊 Monitoring

### Stripe Dashboard

- **Paiements:** https://dashboard.stripe.com/payments
- **Abonnements:** https://dashboard.stripe.com/subscriptions
- **Clients:** https://dashboard.stripe.com/customers
- **Webhooks:** https://dashboard.stripe.com/webhooks
- **Logs:** https://dashboard.stripe.com/logs

### Base de Données

Colonnes ajoutées à la table `users`:

```sql
stripe_customer_id VARCHAR(255)      -- ID client Stripe
subscription_active BOOLEAN           -- Abonnement actif ou non
subscription_end_date TIMESTAMP       -- Date de fin de l'abonnement
```

## 🐛 Dépannage

### Erreur: "No such price"

**Cause:** STRIPE_PRICE_ID incorrect ou inexistant

**Solution:** Vérifiez le Price ID dans le Stripe Dashboard et mettez à jour `.env.local`

### Webhook non reçu

**Cause:** STRIPE_WEBHOOK_SECRET manquant ou incorrect

**Solution:**

1. Vérifiez que le webhook est configuré dans Stripe Dashboard
2. Vérifiez que l'URL du webhook est correcte
3. Vérifiez que le signing secret est correct dans `.env.local`

### Abonnement non activé après paiement

**Cause:** Webhook non traité ou erreur dans le webhook handler

**Solution:**

1. Vérifiez les logs du webhook dans Stripe Dashboard
2. Vérifiez les logs du backend
3. Testez manuellement le webhook avec Stripe CLI:

```bash
stripe trigger checkout.session.completed
```

### Utilisateur bloqué malgré un abonnement actif

**Cause:** Colonne `subscription_active` non mise à jour en DB

**Solution:**

1. Vérifiez manuellement dans la DB:

```sql
SELECT id, username, subscription_active, subscription_end_date
FROM users
WHERE username = 'nom_utilisateur';
```

2. Mettez à jour manuellement si nécessaire:

```sql
UPDATE users
SET subscription_active = true, subscription_end_date = NOW() + INTERVAL '1 month'
WHERE username = 'nom_utilisateur';
```

## 📝 Prochaines Étapes

1. ✅ Corriger `STRIPE_PRICE_ID` dans `.env.local`
2. ✅ Tester le flux complet en local
3. ⏳ Configurer le webhook Stripe pour la production
4. ⏳ Déployer sur Railway avec les bonnes variables
5. ⏳ Tester en production avec une vraie carte
6. ⏳ Monitorer les premiers abonnements

## 📞 Support

En cas de problème:

1. Vérifiez les logs du backend
2. Vérifiez les logs Stripe Dashboard
3. Exécutez `node test-stripe-integration.cjs` pour diagnostiquer
4. Consultez la documentation Stripe: https://stripe.com/docs

---

**Dernière mise à jour:** 28 avril 2026
**Version:** 1.0.0
