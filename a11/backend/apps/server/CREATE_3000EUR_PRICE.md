# 💰 Créer un Prix Stripe à 3000€

## Option 1 : Via Stripe Dashboard (Recommandé)

### Étape 1 : Créer le Produit

1. **Va sur** : https://dashboard.stripe.com/products
2. **Clique sur** : "+ Add product"
3. **Remplis** :
   ```
   Name: A11 Premium Enterprise
   Description: Accès complet à A11 avec support prioritaire et fonctionnalités avancées
   ```

### Étape 2 : Créer le Prix

Dans la section **Pricing** :

```
Model: Recurring
Price: 3000.00 EUR
Billing period: Monthly
```

### Étape 3 : Copier l'ID du Prix

Une fois créé, copie l'ID du prix (commence par `price_...`)

Exemple : `price_1TQxxxHkqLcMgv54xxxxxxxxx`

### Étape 4 : Mettre à Jour les Variables d'Environnement

#### Local (`.env.local`)

```bash
STRIPE_PRICE_ID=price_1TQxxxHkqLcMgv54xxxxxxxxx
```

#### Render (`render.yaml`)

Mets à jour le blueprint :

```yaml
- key: STRIPE_PRICE_ID
  value: price_1TQxxxHkqLcMgv54xxxxxxxxx
```

#### Netlify (Frontend)

Si tu affiches le prix dans le frontend, mets à jour :

```bash
VITE_STRIPE_PRICE_AMOUNT=3000
VITE_STRIPE_PRICE_CURRENCY=EUR
```

---

## Option 2 : Via Stripe CLI

### Prérequis

Installe Stripe CLI : https://stripe.com/docs/stripe-cli

### Créer le Produit et le Prix

```bash
# Login
stripe login

# Créer le produit
stripe products create \
  --name "A11 Premium Enterprise" \
  --description "Accès complet à A11 avec support prioritaire et fonctionnalités avancées"

# Copie le product ID (prod_xxx)

# Créer le prix
stripe prices create \
  --product prod_xxx \
  --unit-amount 300000 \
  --currency eur \
  --recurring[interval]=month

# Copie le price ID (price_xxx)
```

**Note** : `unit-amount` est en centimes, donc 3000€ = 300000 centimes

---

## Option 3 : Via API (Script Node.js)

Crée un fichier `create-3000eur-price.cjs` :

```javascript
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

async function createEnterprisePrice() {
  try {
    // Créer le produit
    const product = await stripe.products.create({
      name: "A11 Premium Enterprise",
      description:
        "Accès complet à A11 avec support prioritaire et fonctionnalités avancées",
    });

    console.log("✅ Produit créé:", product.id);

    // Créer le prix
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 300000, // 3000€ en centimes
      currency: "eur",
      recurring: {
        interval: "month",
      },
    });

    console.log("✅ Prix créé:", price.id);
    console.log("\n📋 Copie cet ID dans ton .env.local :");
    console.log(`STRIPE_PRICE_ID=${price.id}`);

    return price;
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    throw error;
  }
}

createEnterprisePrice();
```

Exécute :

```bash
cd a11/backend/apps/server
node create-3000eur-price.cjs
```

---

## 🔄 Mettre à Jour le Blueprint Render

Une fois le prix créé, mets à jour `render.yaml` :

```yaml
# Stripe
- key: STRIPE_SECRET_KEY
  sync: false # Secret, à configurer manuellement
- key: STRIPE_PRICE_ID
  value: price_1TQxxxHkqLcMgv54xxxxxxxxx # ⬅️ TON NOUVEAU PRICE ID
- key: STRIPE_WEBHOOK_SECRET
  sync: false # Secret, à configurer manuellement
```

Commit et push :

```bash
git add a11/backend/apps/server/render.yaml
git commit -m "feat: Update Stripe price to 3000 EUR"
git push origin master
```

---

## 🎯 Vérification

### Test Local

```bash
curl -X POST http://localhost:3000/api/subscription/create-checkout \
  -H "Authorization: Bearer <ton_token>" \
  -H "Content-Type: application/json"
```

### Test Stripe Dashboard

1. Va sur : https://dashboard.stripe.com/test/prices
2. Vérifie que le prix 3000€ existe
3. Clique dessus pour voir les détails

---

## 💡 Recommandations

### Prix Suggérés

- **Starter** : 2,99€/mois (particuliers)
- **Pro** : 29€/mois (professionnels)
- **Enterprise** : 3000€/mois (entreprises)

### Créer Plusieurs Prix

Tu peux créer plusieurs prix et laisser l'utilisateur choisir :

```javascript
// Frontend
const PLANS = [
  { id: "price_starter", name: "Starter", price: 2.99 },
  { id: "price_pro", name: "Pro", price: 29 },
  { id: "price_enterprise", name: "Enterprise", price: 3000 },
];
```

### Afficher le Prix dans le Frontend

Mets à jour `SubscriptionPanel.tsx` :

```typescript
const SUBSCRIPTION_PRICE = '3000€';
const SUBSCRIPTION_PERIOD = 'mois';

// Dans le JSX
<p>Abonnement Premium : {SUBSCRIPTION_PRICE}/{SUBSCRIPTION_PERIOD}</p>
```

---

## 🐛 Troubleshooting

### Erreur "Invalid price"

- Vérifie que le `STRIPE_PRICE_ID` commence par `price_`
- Vérifie que le prix existe dans ton dashboard Stripe
- Vérifie que tu utilises la bonne clé (test vs live)

### Erreur "No such product"

- Le produit a peut-être été supprimé
- Recrée le produit et le prix

### Prix en centimes

Stripe utilise toujours les centimes :

- 2,99€ = 299 centimes
- 29€ = 2900 centimes
- 3000€ = 300000 centimes

---

**Prêt à facturer 3000€/mois !** 💰🚀
