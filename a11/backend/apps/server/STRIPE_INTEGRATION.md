# Intégration Stripe — Abonnement A11

## Vue d'ensemble

Système d'abonnement à 2,99€/mois pour accéder aux fonctionnalités de génération d'images et vidéos.

- **Forfait** : 2,99€/mois
- **Annulation** : À tout moment (fin de période en cours)
- **Accès** : Génération d'images (Stable Diffusion) et vidéos
- **Exception** : Les admins ont toujours accès sans abonnement

## Architecture

```
User → Frontend → Backend (3000) → Stripe API
                      ↓
                  PostgreSQL (subscription_active)
                      ↓
                  Middleware (requireSubscription)
                      ↓
                  Routes protégées (/api/jobs/sd, /api/mask, etc.)
```

## Configuration

### Variables d'environnement

Ajouter dans `.env.local` :

```bash
# Stripe Configuration
# STRIPE_SECRET_KEY is configured via the deployment secret store.
STRIPE_PRICE_ID=price_...                        # ID du prix créé dans Stripe Dashboard
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.
STRIPE_SUCCESS_URL=https://funesterie.me/subscription/success
STRIPE_CANCEL_URL=https://funesterie.me/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://funesterie.me/account
```

### Création du produit dans Stripe Dashboard

1. Aller sur [Stripe Dashboard](https://dashboard.stripe.com/)
2. Produits → Créer un produit
3. Nom : "A11 Premium - Génération d'images et vidéos"
4. Prix : 2,99€/mois (récurrent)
5. Copier le `price_id` (commence par `price_...`)
6. Configurer le webhook :
   - URL : `https://a11.funesterie.me/api/subscription/webhook`
   - Événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copier le `webhook_secret` (commence par `whsec_...`)

## Migration de la base de données

Exécuter le script SQL :

```bash
psql $DATABASE_URL -f migrations/add-subscription-columns.sql
```

Ou manuellement :

```sql
ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_active ON users(subscription_active);

UPDATE users
SET subscription_active = TRUE
WHERE role = 'admin' AND subscription_active IS NULL;
```

## API Endpoints

### 1. Créer une session de checkout

**POST** `/api/subscription/create-checkout`

Headers :

```
Authorization: Bearer <JWT_TOKEN>
```

Response :

```json
{
  "ok": true,
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

### 2. Créer une session du portail client

**POST** `/api/subscription/create-portal`

Headers :

```
Authorization: Bearer <JWT_TOKEN>
```

Response :

```json
{
  "ok": true,
  "url": "https://billing.stripe.com/p/session/..."
}
```

### 3. Récupérer le statut d'abonnement

**GET** `/api/subscription/status`

Headers :

```
Authorization: Bearer <JWT_TOKEN>
```

Response :

```json
{
  "ok": true,
  "active": true,
  "endDate": "2026-05-27T12:00:00.000Z",
  "stripeStatus": {
    "active": true,
    "status": "active",
    "currentPeriodEnd": 1748347200,
    "cancelAtPeriodEnd": false
  }
}
```

### 4. Webhook Stripe

**POST** `/api/subscription/webhook`

Headers :

```
stripe-signature: t=...,v1=...
Content-Type: application/json
```

Événements gérés :

- `checkout.session.completed` : Active l'abonnement
- `customer.subscription.created` : Crée l'abonnement
- `customer.subscription.updated` : Met à jour le statut
- `customer.subscription.deleted` : Désactive l'abonnement

## Routes protégées

Les routes suivantes nécessitent un abonnement actif (sauf pour les admins) :

- **POST** `/api/jobs/sd` - Génération d'images (Stable Diffusion)
- **POST** `/api/mask/*` - Génération d'images avec masque
- **POST** `/api/generate-mask` - Génération d'images avec masque sémantique
- **POST** `/api/image-atelier/*` - Atelier d'images

## Middleware de vérification

Le middleware `requireSubscription` vérifie :

1. Si l'utilisateur est admin → **Accès autorisé**
2. Si l'utilisateur est authentifié → Vérifier l'abonnement
3. Si `subscription_active = true` → **Accès autorisé**
4. Si `subscription_active = false` → **403 Forbidden**

Réponse en cas d'abonnement requis :

```json
{
  "error": "Abonnement requis",
  "message": "Cette fonctionnalité nécessite un abonnement actif (2,99€/mois)",
  "code": "SUBSCRIPTION_REQUIRED",
  "subscriptionUrl": "/api/subscription/create-checkout"
}
```

## Flux utilisateur

### 1. Inscription à l'abonnement

```
User → Frontend → POST /api/subscription/create-checkout
                      ↓
                  Stripe Checkout (paiement)
                      ↓
                  Webhook → UPDATE users SET subscription_active = true
                      ↓
                  Redirect → Success page
```

### 2. Génération d'image

```
User → Frontend → POST /api/jobs/sd
                      ↓
                  requireSubscription middleware
                      ↓
                  Vérification DB (subscription_active)
                      ↓
                  Si actif → Génération
                  Si inactif → 403 Forbidden
```

### 3. Gestion de l'abonnement

```
User → Frontend → POST /api/subscription/create-portal
                      ↓
                  Stripe Customer Portal
                      ↓
                  Annulation/Modification
                      ↓
                  Webhook → UPDATE users
```

## Tests

### Test local (sans Stripe)

Si `STRIPE_SECRET_KEY` n'est pas configuré :

- Les routes d'abonnement retournent `503 Service Unavailable`
- Le middleware `requireSubscription` laisse passer (mode dev)

### Test avec Stripe Test Mode

1. Utiliser les clés de test (`sk_test_...`)
2. Utiliser les cartes de test Stripe :
   - Succès : `4242 4242 4242 4242`
   - Échec : `4000 0000 0000 0002`
3. Utiliser [Stripe CLI](https://stripe.com/docs/stripe-cli) pour tester les webhooks localement :

```bash
stripe listen --forward-to localhost:3000/api/subscription/webhook
```

## Sécurité

- ✅ Validation de la signature Stripe sur les webhooks
- ✅ Vérification JWT sur toutes les routes d'abonnement
- ✅ Vérification de l'abonnement côté serveur (pas de confiance client)
- ✅ Clés Stripe stockées dans variables d'environnement (jamais en dur)
- ✅ SSL/TLS requis pour les webhooks en production

## Monitoring

Logs à surveiller :

```
[Stripe] Abonnement activé pour user <userId>
[Stripe] Abonnement mis à jour pour customer <customerId>: active
[Stripe] Abonnement annulé pour customer <customerId>
[Subscription] DB non disponible, vérification d'abonnement désactivée
[SubscriptionMiddleware] Erreur: ...
```

## Dépannage

### Webhook ne fonctionne pas

1. Vérifier que `STRIPE_WEBHOOK_SECRET` est configuré
2. Vérifier que l'URL du webhook est accessible publiquement
3. Vérifier les logs Stripe Dashboard → Webhooks → Tentatives

### Abonnement non activé après paiement

1. Vérifier que le webhook `checkout.session.completed` a été reçu
2. Vérifier que `metadata.userId` est présent dans la session
3. Vérifier les logs du serveur

### Utilisateur bloqué malgré abonnement actif

1. Vérifier `subscription_active` dans la DB : `SELECT subscription_active FROM users WHERE id = '<userId>'`
2. Vérifier que l'utilisateur n'est pas admin
3. Vérifier que `subscription_end_date` n'est pas dépassée

## Installation du package Stripe

```bash
cd funesterie/a11/backend/apps/server
npm install stripe
```

## Fichiers créés

- `lib/stripe-service.cjs` - Service Stripe (checkout, portail, statut)
- `routes/subscription.cjs` - Routes d'abonnement
- `middleware/check-subscription.cjs` - Middleware de vérification
- `migrations/add-subscription-columns.sql` - Migration SQL
- `STRIPE_INTEGRATION.md` - Documentation (ce fichier)

## Fichiers modifiés

- `server.cjs` :
  - Import des modules Stripe
  - Création du middleware `requireSubscription`
  - Montage des routes `/api/subscription`
  - Protection des routes de génération avec `requireSubscription`

## Prochaines étapes

1. ✅ Installer le package Stripe : `npm install stripe`
2. ✅ Exécuter la migration SQL
3. ✅ Configurer les variables d'environnement
4. ✅ Créer le produit dans Stripe Dashboard
5. ✅ Configurer le webhook
6. ✅ Tester en mode test
7. ✅ Déployer en production
8. ✅ Passer en mode production Stripe

## Support

Pour toute question ou problème :

- Documentation Stripe : https://stripe.com/docs
- Stripe Dashboard : https://dashboard.stripe.com/
- Logs serveur : `tail -f logs/a11-server.log`
