# 🔑 Comment récupérer les clés Stripe

## ⚠️ Important : Clé publique vs Clé secrète

Vous avez partagé une **clé publique** (`pk_live_...`), mais le backend a besoin de la **clé secrète** (`sk_live_...` ou `sk_test_...`).

### Différences

| Type             | Préfixe                        | Utilisation                  | Sécurité                       |
| ---------------- | ------------------------------ | ---------------------------- | ------------------------------ |
| **Clé publique** | `pk_live_...` ou `pk_test_...` | Frontend (JavaScript client) | Peut être exposée publiquement |
| **Clé secrète**  | `sk_live_...` ou `sk_test_...` | Backend (serveur)            | **NE JAMAIS exposer**          |

## 📋 Étapes pour récupérer la clé secrète

### 1. Aller sur le Dashboard Stripe

https://dashboard.stripe.com/

### 2. Aller dans "Développeurs" → "Clés API"

https://dashboard.stripe.com/apikeys

### 3. Choisir le mode

- **Mode Test** (recommandé pour commencer) : Clés commençant par `sk_test_...`
- **Mode Production** : Clés commençant par `sk_live_...`

### 4. Copier la clé secrète

1. Cliquer sur "Révéler la clé de test" ou "Révéler la clé active"
2. Copier la clé complète (commence par `sk_test_...` ou `sk_live_...`)
3. **Ne jamais partager cette clé !**

### 5. Ajouter dans .env.local

```bash
# Mode Test (recommandé pour commencer)
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_SECRETE_ICI

# Ou Mode Production
STRIPE_SECRET_KEY=sk_live_VOTRE_CLE_SECRETE_ICI
```

## 🎯 Récupérer toutes les clés nécessaires

### 1. Clé secrète (Backend)

- **Où** : Dashboard → Développeurs → Clés API
- **Format** : `sk_test_...` ou `sk_live_...`
- **Variable** : `STRIPE_SECRET_KEY`

### 2. Price ID (Produit)

- **Où** : Dashboard → Produits → Votre produit → Copier l'ID du prix
- **Format** : `price_...`
- **Variable** : `STRIPE_PRICE_ID`

Si vous n'avez pas encore créé de produit :

1. Aller sur https://dashboard.stripe.com/products
2. Cliquer sur "Ajouter un produit"
3. Remplir :
   - Nom : `A11 Premium - Génération d'images et vidéos`
   - Prix : `2,99 EUR`
   - Type : `Récurrent` → `Mensuel`
4. Enregistrer
5. Copier le `price_id`

### 3. Webhook Secret

- **Où** : Dashboard → Développeurs → Webhooks → Votre endpoint → Clé de signature
- **Format** : `whsec_...`
- **Variable** : `STRIPE_WEBHOOK_SECRET`

Si vous n'avez pas encore créé de webhook :

1. Aller sur https://dashboard.stripe.com/webhooks
2. Cliquer sur "Ajouter un endpoint"
3. URL : `http://localhost:3000/api/subscription/webhook` (pour le test local)
4. Sélectionner les événements :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Enregistrer
6. Copier le `webhook_secret`

## 📝 Configuration complète dans .env.local

```bash
# ============================================================
# Stripe - Abonnement Premium (2,99€/mois)
# ============================================================

# Clé secrète (BACKEND UNIQUEMENT - NE JAMAIS EXPOSER)
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_SECRETE

# ID du prix (produit à 2,99€/mois)
STRIPE_PRICE_ID=price_VOTRE_PRICE_ID

# Secret du webhook
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_WEBHOOK_SECRET

# URLs de redirection
STRIPE_SUCCESS_URL=https://alphaonze.funesterie.pro/subscription/success
STRIPE_CANCEL_URL=https://alphaonze.funesterie.pro/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://alphaonze.funesterie.pro/account
```

## ✅ Vérifier la configuration

```bash
cd funesterie/a11/backend/apps/server
npm run test:stripe
```

Vous devriez voir :

```
✅ Intégration Stripe complète et fonctionnelle
```

## 🔒 Sécurité

### ✅ À FAIRE

- Stocker les clés dans `.env.local` (gitignored)
- Utiliser le mode Test pour le développement
- Passer en mode Production uniquement pour le déploiement
- Rotation régulière des clés

### ❌ NE JAMAIS FAIRE

- Commiter les clés dans Git
- Partager les clés secrètes
- Utiliser les clés de production en développement
- Exposer les clés dans le code frontend

## 🆘 Aide

Si vous ne trouvez pas vos clés :

1. **Clé secrète** : https://dashboard.stripe.com/apikeys
2. **Price ID** : https://dashboard.stripe.com/products
3. **Webhook Secret** : https://dashboard.stripe.com/webhooks

Support Stripe : https://support.stripe.com/

---

**Note** : La clé publique (`pk_live_...`) que vous avez partagée est pour le frontend uniquement. Le backend a besoin de la clé secrète (`sk_live_...` ou `sk_test_...`).
