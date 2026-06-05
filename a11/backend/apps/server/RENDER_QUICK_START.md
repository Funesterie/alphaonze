# Deploiement rapide sur Render

## Statut actuel: fallback uniquement

La production Funesterie ne doit pas tourner principalement sur Render.

Route principale:

```text
Cloudflare -> Hetzner -> Caddy -> backend local
```

Render sert seulement de fallback API temporaire. Ne pas y router le chat, la voix, la vision, la video, Qflush ou Ollama en fonctionnement normal.

## Option 1 : Blueprint de secours

### Étape 1 : Commit le Blueprint

```bash
cd D:\projets\funesterie
git add a11/backend/apps/server/render.yaml
git commit -m "feat: Add Render blueprint"
git push origin master
```

### Étape 2 : Déployer via Blueprint

1. **Va sur** : https://dashboard.render.com/select-repo?type=blueprint
2. **Connecte le repo** : `Funesterie/alphaonze`
3. **Render détecte automatiquement** `render.yaml`
4. **Clique sur "Apply"**

Render va créer automatiquement :

- ✅ Web Service (a11-backend)
- ✅ PostgreSQL (a11-postgres)
- ✅ Redis (a11-redis)

### Étape 3 : Configurer les Secrets

Dashboard → a11-backend → Environment :

```bash
# Set the session signing secret in Render.
# OPENAI_API_KEY is configured via the deployment secret store.
# STRIPE_SECRET_KEY is configured via the deployment secret store.
STRIPE_PRICE_ID=price_1TQwxHHkqLcMgv548uBa6GDZ
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.
# RESEND_API_KEY is configured via the deployment secret store.
```

### Étape 4 : Déployer

Render redéploie automatiquement. Attends 2-5 minutes.

---

## Option 2 : Manuel (Plus de Contrôle)

### Étape 1 : Créer le Web Service

1. **Dashboard** : https://dashboard.render.com/
2. **New +** → **Web Service**
3. **Connecte** : `Funesterie/alphaonze`
4. **Configure** :
   ```
   Name: a11-backend
   Region: Frankfurt
   Branch: master
   Root Directory: a11/backend/apps/server
   Environment: Docker
   Dockerfile Path: ./Dockerfile
   Plan: Free
   ```

### Étape 2 : Créer PostgreSQL

1. **New +** → **PostgreSQL**
2. **Configure** :
   ```
   Name: a11-postgres
   Database: a11
   Region: Frankfurt
   Plan: Free
   ```
3. **Copie** l'Internal Connection String

### Étape 3 : Créer Redis

1. **New +** → **Redis**
2. **Configure** :
   ```
   Name: a11-redis
   Region: Frankfurt
   Plan: Free
   ```
3. **Copie** l'Internal Connection String

### Étape 4 : Configurer les Variables

Dashboard → a11-backend → Environment → Add Environment Variable :

```bash
# Backend
NODE_ENV=production
PORT=3000
HOST_SERVER=0.0.0.0
BACKEND=render-fallback
A11_DEPLOY_ROLE=fallback

# Security
NEZ_SECURITY_MODE=production
# JWT_SECRET is configured via the deployment secret store.
JWT_EXPIRY=7d

# CORS
CORS_ORIGINS=https://a11.funesterie.me
APP_URL=https://a11.funesterie.me

# Databases (colle les URLs copiées)
DATABASE_URL=<postgresql_internal_url>
REDIS_URL=<redis_internal_url>

# LLM
A11_LLM_PROVIDER=openai
# OPENAI_API_KEY is configured via the deployment secret store.
DEFAULT_MODEL=gpt-4o-mini
A11_LLM_TIMEOUT_MS=60000

# Stripe
# STRIPE_SECRET_KEY is configured via the deployment secret store.
STRIPE_PRICE_ID=price_1TQwxHHkqLcMgv548uBa6GDZ
# STRIPE_WEBHOOK_SECRET is configured via the deployment secret store.
STRIPE_SUCCESS_URL=https://a11.funesterie.me/subscription/success
STRIPE_CANCEL_URL=https://a11.funesterie.me/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://a11.funesterie.me/account

# Email
# RESEND_API_KEY is configured via the deployment secret store.
EMAIL_FROM=A11 <a11@funesterie.me>

# Features
A11_ENABLE_QFLUSH=0
MANAGE_CERBERE=false
MANAGE_TTS=false
```

### Étape 5 : Déployer

Clique sur **"Manual Deploy"** → **"Deploy latest commit"**

---

## ✅ Vérification

### 1. Health Check

```bash
curl https://a11-backend.onrender.com/health
```

### 2. Test Login

```bash
curl -X POST https://a11-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}'
```

### 3. Configurer Stripe Webhook

1. **Stripe Dashboard** : https://dashboard.stripe.com/webhooks
2. **Add endpoint** :
   - URL : `https://a11.funesterie.me/api/subscription/webhook`
   - Events : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
3. **Copie le signing secret** et mets à jour `STRIPE_WEBHOOK_SECRET`

### 4. Mettre à Jour le Frontend

Le frontend doit garder les domaines publics Caddy :

```bash
VITE_API_URL=https://a11.funesterie.me
VITE_API_BASE_URL=https://a11.funesterie.me
```

Ne pointe vers `onrender.com` que pendant un failover temporaire documente.

---

## 🎯 URL Finale

- **Backend API principale** : `https://a11.funesterie.me`
- **Fallback API Render** : `https://a11-backend.onrender.com`
- **Frontend** : `https://a11.funesterie.me`
- **Health principale** : `https://a11.funesterie.me/health`
- **Health fallback** : `https://a11-backend.onrender.com/health`

---

## 📝 Notes

- **Free tier** : Le service sleep après 15min d'inactivité (réveil en ~30s), donc il ne convient pas au runtime principal.
- **Upgrade** : $7/mois pour éviter le sleep
- **Auto-deploy** : Push sur `master` → redéploiement automatique
- **Logs** : Dashboard → Service → Logs (temps réel)

---

**C'est tout !** 🚀
