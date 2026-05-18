# 🚀 Déployer A11 sur Render MAINTENANT

## ⚡ Déploiement Rapide (5 minutes)

### Étape 1 : Créer le Service via Blueprint

**Clique ici** : https://dashboard.render.com/select-repo?type=blueprint

1. **Connecte ton compte GitHub**
2. **Sélectionne le repo** : `Funesterie/alphaonze`
3. **Render détecte automatiquement** `render.yaml`
4. **Clique sur "Apply"**

Render va créer automatiquement :

- ✅ Web Service (a11-backend)
- ✅ PostgreSQL (a11-postgres)
- ✅ Redis (a11-redis)

### Étape 2 : Configurer les Secrets (2 minutes)

Dashboard → a11-backend → Environment → Add Secret :

```bash
# JWT
# JWT_SECRET is configured via the deployment secret store.

# OpenAI (OBLIGATOIRE)
# OPENAI_API_KEY is configured via the deployment secret store.

# Stripe
# STRIPE_SECRET_KEY is configured via the deployment secret store.
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.

# Email
# RESEND_API_KEY is configured via the deployment secret store.
```

### Étape 3 : Attendre le Déploiement (2-5 minutes)

Render va :

1. Cloner le repo
2. Builder l'image Docker
3. Démarrer le container
4. Exposer l'URL : `https://a11-backend.onrender.com`

### Étape 4 : Tester

```bash
# Health check
curl https://a11-backend.onrender.com/health

# Devrait retourner:
{"status":"ok"}
```

### Étape 5 : Configurer le Frontend

**Netlify** → Site settings → Environment variables :

```bash
VITE_API_URL=https://a11-backend.onrender.com
VITE_API_BASE_URL=https://a11-backend.onrender.com
```

Redéploie le frontend.

### Étape 6 : Configurer le Webhook Stripe

1. **Stripe Dashboard** : https://dashboard.stripe.com/webhooks
2. **Add endpoint** :
   - URL : `https://a11-backend.onrender.com/api/subscription/webhook`
   - Events : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
3. **Copie le signing secret** et mets à jour `STRIPE_WEBHOOK_SECRET` sur Render

---

## ✅ C'est Tout !

**URLs Finales** :

- Backend : `https://a11-backend.onrender.com`
- Frontend : `https://a11.funesterie.me`
- Health : `https://a11-backend.onrender.com/health`

**Configuration** :

- ✅ Docker : Automatique
- ✅ PostgreSQL : Render (gratuit)
- ✅ Redis : Render (gratuit)
- ✅ LLM : OpenAI (gpt-4o-mini)
- ✅ Stripe : Configuré
- ✅ Email : Resend

---

## 🐛 Troubleshooting

### Service ne démarre pas

**Vérifie les logs** : Dashboard → Service → Logs

**Erreurs communes** :

- `OPENAI_API_KEY` manquant → Ajoute-le dans Environment
- `DATABASE_URL` invalide → Vérifie que PostgreSQL est créé
- Port déjà utilisé → Render gère ça automatiquement

### 502 Bad Gateway

- Le service démarre peut-être encore (attends 1-2 min)
- Vérifie que `PORT=3000` et `HOST_SERVER=0.0.0.0`
- Vérifie le health check : `/health`

### Webhook Stripe ne fonctionne pas

- Vérifie l'URL du webhook sur Stripe Dashboard
- Vérifie que `STRIPE_WEBHOOK_SECRET` est correct
- Teste avec Stripe CLI : `stripe listen --forward-to https://a11-backend.onrender.com/api/subscription/webhook`

---

## 📊 Monitoring

**Logs en temps réel** : Dashboard → Service → Logs

**Metrics** : Dashboard → Service → Metrics (CPU, RAM, requêtes)

**Alerts** : Dashboard → Service → Settings → Alerts

---

## 💰 Coûts

**Plan Free** :

- ✅ 750h/mois (suffisant pour 1 service 24/7)
- ✅ PostgreSQL : 1 GB, 90 jours de rétention
- ✅ Redis : 25 MB
- ⚠️ Sleep après 15min d'inactivité (réveil en ~30s)

**Plan Starter ($7/mois)** :

- ✅ Pas de sleep
- ✅ 512 MB RAM dédié
- ✅ Meilleure performance

---

## 🔄 Auto-Deploy

Chaque push sur `master` redéploie automatiquement :

```bash
git add .
git commit -m "feat: nouvelle fonctionnalité"
git push origin master
```

Render détecte le push et redéploie en ~2-5 minutes.

---

**Prêt à déployer ?** 🚀

[Déployer Maintenant](https://dashboard.render.com/select-repo?type=blueprint)
