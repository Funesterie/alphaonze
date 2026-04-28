# 🚀 Déploiement A11 Backend sur Render

## Pourquoi Render ?

- ✅ **Gratuit** : Tier gratuit généreux (750h/mois)
- ✅ **Docker natif** : Support Dockerfile out-of-the-box
- ✅ **Auto-deploy** : Déploiement automatique depuis GitHub
- ✅ **Databases** : PostgreSQL, Redis inclus
- ✅ **Simple** : Configuration plus simple que Railway

## 📋 Prérequis

1. Compte Render : https://render.com/
2. Repository GitHub : `Funesterie/alphaonze` (déjà fait ✅)
3. Dockerfile prêt : `a11/backend/apps/server/Dockerfile` (déjà fait ✅)

## 🎯 Étapes de Déploiement

### 1. Créer un Web Service sur Render

1. **Va sur Render Dashboard** : https://dashboard.render.com/
2. **Clique sur "New +"** → **"Web Service"**
3. **Connecte ton repo GitHub** :
   - Sélectionne `Funesterie/alphaonze`
   - Autorise Render à accéder au repo

### 2. Configuration du Service

#### Paramètres de Base

```
Name: a11-backend
Region: Frankfurt (EU Central) ou Oregon (US West)
Branch: master
Root Directory: a11/backend/apps/server
```

#### Build & Deploy

```
Environment: Docker
Dockerfile Path: ./Dockerfile
Docker Build Context Directory: .
Docker Command: (laisser vide, utilise CMD du Dockerfile)
```

#### Instance Type

```
Free (512 MB RAM, partagé)
ou
Starter ($7/mois, 512 MB RAM, dédié)
```

### 3. Variables d'Environnement

Ajoute ces variables dans **Environment** :

#### 🔐 Stripe (Production)

```bash
STRIPE_SECRET_KEY=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
STRIPE_PRICE_ID=price_1TQwxHHkqLcMgv548uBa6GDZ
STRIPE_WEBHOOK_SECRET=whsec_f0sF58jvmkKQroqTl009quZAlXyakCDG
STRIPE_SUCCESS_URL=https://alphaonze.funesterie.pro/subscription/success
STRIPE_CANCEL_URL=https://alphaonze.funesterie.pro/subscription/cancel
STRIPE_PORTAL_RETURN_URL=https://alphaonze.funesterie.pro/account
```

#### 🔑 JWT & Security

```bash
JWT_SECRET=f564db4d80721484148880ee27f31a29f3e4fc005ee7f17b9026bf10a32aa7c6
JWT_EXPIRY=7d
NEZ_SECURITY_MODE=production
```

#### 🌐 CORS & URLs

```bash
CORS_ORIGINS=https://alphaonze.funesterie.pro,https://a11-backend.onrender.com
APP_URL=https://alphaonze.funesterie.pro
```

#### 📧 Email (Resend)

```bash
RESEND_API_KEY=re_gKNVuJrr_C3zBtFZ2SPcNRJSK1hUcmUnp
EMAIL_FROM=A11 <a11@funesterie.pro>
```

#### 🗄️ Databases

**Option A : Utiliser les databases Railway existantes**

```bash
DATABASE_URL=postgresql://postgres:KTQeQfOkaNNwMKDYXXfKvmedvMAXqQsh@shuttle.proxy.rlwy.net:35544/railway
REDIS_URL=redis://default:IQYcttEyxVnnhpSYUwxPRFOFxgliNzgh@shuttle.proxy.rlwy.net:27694
```

**Option B : Créer des databases Render (recommandé)**

1. **PostgreSQL** :
   - Dashboard → "New +" → "PostgreSQL"
   - Name: `a11-postgres`
   - Plan: Free
   - Copie l'URL interne : `postgresql://...`
   - Ajoute : `DATABASE_URL=<url_copiée>`

2. **Redis** :
   - Dashboard → "New +" → "Redis"
   - Name: `a11-redis`
   - Plan: Free (25 MB)
   - Copie l'URL interne : `redis://...`
   - Ajoute : `REDIS_URL=<url_copiée>`

#### 🤖 LLM Configuration

```bash
A11_LLM_PROVIDER=openai
OPENAI_API_KEY=<ta_clé_openai>
DEFAULT_MODEL=gpt-4o-mini
A11_LLM_TIMEOUT_MS=60000
```

#### ⚙️ Backend Config

```bash
PORT=3000
HOST_SERVER=0.0.0.0
NODE_ENV=production
BACKEND=render
A11_ENABLE_QFLUSH=0
MANAGE_CERBERE=false
MANAGE_TTS=false
```

### 4. Déployer

1. **Clique sur "Create Web Service"**
2. Render va :
   - Cloner le repo
   - Builder l'image Docker
   - Déployer le container
   - Exposer l'URL : `https://a11-backend.onrender.com`

### 5. Configurer le Webhook Stripe

1. **Va sur Stripe Dashboard** : https://dashboard.stripe.com/webhooks
2. **Ajoute un endpoint** :
   - URL : `https://a11-backend.onrender.com/api/subscription/webhook`
   - Events : `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
3. **Copie le signing secret** (commence par `whsec_...`)
4. **Mets à jour** `STRIPE_WEBHOOK_SECRET` sur Render

### 6. Mettre à Jour le Frontend

Dans `a11/frontend/apps/web/.env.production` (ou Netlify env vars) :

```bash
VITE_API_URL=https://a11-backend.onrender.com
VITE_API_BASE_URL=https://a11-backend.onrender.com
```

Redéploie le frontend sur Netlify.

## 🔍 Vérification

### Health Check

```bash
curl https://a11-backend.onrender.com/health
```

Réponse attendue :

```json
{ "status": "ok" }
```

### Test Auth

```bash
curl -X POST https://a11-backend.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Djeff","password":"1991"}'
```

### Test Subscription Status

```bash
curl https://a11-backend.onrender.com/api/subscription/status \
  -H "Authorization: Bearer <ton_token>"
```

## 📊 Monitoring

### Logs

Dashboard → Ton service → **Logs** (temps réel)

### Metrics

Dashboard → Ton service → **Metrics** (CPU, RAM, requêtes)

### Alerts

Dashboard → Ton service → **Settings** → **Alerts**

## 🔄 Auto-Deploy

Render redéploie automatiquement à chaque push sur `master` :

```bash
git add .
git commit -m "feat: update backend"
git push origin master
```

Render détecte le push et redéploie en ~2-5 minutes.

## 💰 Coûts

### Plan Free

- ✅ **750h/mois** (suffisant pour 1 service 24/7)
- ✅ **PostgreSQL** : 1 GB, 90 jours de rétention
- ✅ **Redis** : 25 MB
- ⚠️ **Sleep après 15min d'inactivité** (réveil en ~30s)

### Plan Starter ($7/mois)

- ✅ **Pas de sleep**
- ✅ **512 MB RAM dédié**
- ✅ **Meilleure performance**

## 🆚 Render vs Railway

| Feature         | Render      | Railway        |
| --------------- | ----------- | -------------- |
| **Prix Free**   | 750h/mois   | $5 crédit/mois |
| **Sleep**       | Oui (15min) | Non            |
| **Docker**      | Natif       | Natif          |
| **Databases**   | Incluses    | Incluses       |
| **Auto-deploy** | Oui         | Oui            |
| **UI**          | Simple      | Moderne        |

**Recommandation** : Render pour le tier gratuit, Railway pour la production payante.

## 🐛 Troubleshooting

### Build Failed

- Vérifie que `Root Directory` = `a11/backend/apps/server`
- Vérifie que `Dockerfile Path` = `./Dockerfile`
- Vérifie les logs de build

### Service Crash

- Vérifie les logs : Dashboard → Service → Logs
- Vérifie les variables d'environnement
- Vérifie que `DATABASE_URL` est valide

### 502 Bad Gateway

- Le service démarre peut-être encore (attends 1-2 min)
- Vérifie que `PORT=3000` et `HOST_SERVER=0.0.0.0`
- Vérifie le health check : `/health`

### Webhook Stripe ne fonctionne pas

- Vérifie l'URL du webhook sur Stripe Dashboard
- Vérifie que `STRIPE_WEBHOOK_SECRET` est correct
- Teste avec Stripe CLI : `stripe listen --forward-to https://a11-backend.onrender.com/api/subscription/webhook`

## 🎯 Prochaines Étapes

1. ✅ Créer le service Render
2. ✅ Configurer les variables d'environnement
3. ✅ Déployer
4. ✅ Configurer le webhook Stripe
5. ✅ Mettre à jour le frontend
6. ✅ Tester l'intégration complète

---

**Besoin d'aide ?** Consulte la doc Render : https://render.com/docs
