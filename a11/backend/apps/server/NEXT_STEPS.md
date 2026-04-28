# ✅ Prochaines étapes - Configuration Stripe

## Ce qui est fait ✅

- ✅ Stripe installé (v22.1.0)
- ✅ Migration SQL exécutée avec succès
- ✅ Colonnes créées dans la table `users` :
  - `stripe_customer_id`
  - `subscription_active`
  - `subscription_end_date`
- ✅ Index créés pour optimiser les requêtes
- ✅ Admin trouvé : `djeff@a11.local`

## Ce qu'il reste à faire 🎯

### 1. Récupérer la clé secrète Stripe (5 min)

**⚠️ Important** : Vous avez partagé une clé **publique** (`pk_live_...`), mais le backend a besoin de la clé **secrète** (`sk_live_...` ou `sk_test_...`).

**Comment faire** :

1. Aller sur https://dashboard.stripe.com/apikeys
2. Cliquer sur "Révéler la clé de test" (mode Test recommandé)
3. Copier la clé complète (commence par `sk_test_...`)
4. Ajouter dans `.env.local` :

```bash
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_SECRETE
```

📚 **Guide détaillé** : `GET_STRIPE_KEYS.md`

### 2. Créer le produit Stripe (3 min)

1. Aller sur https://dashboard.stripe.com/products
2. Cliquer sur "Ajouter un produit"
3. Remplir :
   - **Nom** : `A11 Premium - Génération d'images et vidéos`
   - **Prix** : `2,99 EUR`
   - **Type** : `Récurrent` → `Mensuel`
4. Enregistrer
5. Copier le `price_id` (commence par `price_...`)
6. Ajouter dans `.env.local` :

```bash
STRIPE_PRICE_ID=price_VOTRE_PRICE_ID
```

### 3. Configurer le webhook (3 min)

1. Aller sur https://dashboard.stripe.com/webhooks
2. Cliquer sur "Ajouter un endpoint"
3. URL : `http://localhost:3000/api/subscription/webhook` (pour le test local)
4. Sélectionner les événements :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Enregistrer
6. Copier le `webhook_secret` (commence par `whsec_...`)
7. Ajouter dans `.env.local` :

```bash
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_WEBHOOK_SECRET
```

### 4. Activer l'abonnement pour l'admin (1 min)

L'admin `djeff@a11.local` a actuellement `subscription_active = false`. Pour lui donner un accès illimité :

```bash
npm run db:migrate:stripe
```

Ou manuellement :

```sql
UPDATE users
SET subscription_active = TRUE
WHERE email = 'djeff@a11.local';
```

### 5. Tester l'intégration (2 min)

```bash
npm run test:stripe
```

Vous devriez voir :

```
✅ Intégration Stripe complète et fonctionnelle
```

### 6. Démarrer le serveur (1 min)

```bash
npm start
```

### 7. Tester avec une carte de test (5 min)

Utiliser les cartes de test Stripe :

- **Succès** : `4242 4242 4242 4242`
- **Échec** : `4000 0000 0000 0002`

Date d'expiration : N'importe quelle date future  
CVC : N'importe quel 3 chiffres

## Commandes utiles

```bash
# Tester l'intégration
npm run test:stripe

# Migration SQL
npm run db:migrate:stripe

# Démarrer le serveur
npm start

# Analyse de sécurité
npm run sonar:local
```

## Configuration finale dans .env.local

```bash
# ============================================================
# Stripe - Abonnement Premium (2,99€/mois)
# ============================================================

# Clé secrète (BACKEND - À RÉCUPÉRER)
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_SECRETE

# ID du prix (À CRÉER ET RÉCUPÉRER)
STRIPE_PRICE_ID=price_VOTRE_PRICE_ID

# Secret du webhook (À CRÉER ET RÉCUPÉRER)
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_WEBHOOK_SECRET

# URLs de redirection (déjà configurées)
STRIPE_SUCCESS_URL=https://alphaonze.funesterie.pro/subscription/success
STRIPE_CANCEL_URL=https://alphaonze.funesterie.pro/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://alphaonze.funesterie.pro/account
```

## Documentation

- **Guide des clés** : `GET_STRIPE_KEYS.md` ⭐
- **Quick Start** : `QUICK_START_STRIPE.md`
- **Commandes** : `COMMANDS_CHEATSHEET.md`
- **Documentation complète** : `STRIPE_INTEGRATION.md`

## Checklist

- [x] Stripe installé
- [x] Migration SQL exécutée
- [x] Colonnes créées
- [x] Index créés
- [ ] Clé secrète récupérée et configurée
- [ ] Produit créé (2,99€/mois)
- [ ] Webhook configuré
- [ ] Admin activé
- [ ] Test d'intégration passé
- [ ] Serveur démarré
- [ ] Carte de test validée

## Temps estimé restant

**~15 minutes** pour compléter la configuration

## Support

- **Clés Stripe** : `GET_STRIPE_KEYS.md`
- **Dashboard Stripe** : https://dashboard.stripe.com/
- **Support Stripe** : https://support.stripe.com/

---

**Prochaine étape** : Récupérer la clé secrète Stripe (`sk_test_...`) et l'ajouter dans `.env.local`

Consultez `GET_STRIPE_KEYS.md` pour un guide détaillé.
