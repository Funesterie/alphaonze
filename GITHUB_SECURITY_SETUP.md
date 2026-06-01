# Configuration Sécurité GitHub — Checklist Complète

## ✅ Ce qui est fait (automatique)

- [x] `.gitignore` bloque tous les secrets (.env, .pem, .key, credentials.json)
- [x] Workflow TruffleHog scan les secrets dans l'historique git
- [x] Workflow npm audit vérifie les vulnérabilités des dépendances
- [x] SECURITY.md avec politique de divulgation responsable
- [x] Vulnérabilités high/critical patchées via `npm audit fix`

## 🔧 Ce que tu dois faire manuellement sur GitHub

### 1. Ajouter le secret Docker Hub

**URL** : https://github.com/Funesterie/alphaonze/settings/secrets/actions

Clique **"New repository secret"** :

- Name : `DOCKERHUB_TOKEN`
- Value : `<docker-hub-access-token>`

### 2. Activer Dependabot

**URL** : https://github.com/Funesterie/alphaonze/settings/security_analysis

Activer :

- ✅ **Dependabot alerts** — alertes sur les vulnérabilités
- ✅ **Dependabot security updates** — PRs automatiques pour patcher
- ✅ **Dependabot version updates** — PRs pour mettre à jour les dépendances

### 3. Activer Code Scanning (optionnel, recommandé)

**URL** : https://github.com/Funesterie/alphaonze/settings/security_analysis

Activer :

- ✅ **CodeQL analysis** — scan automatique du code pour détecter les failles

### 4. Configurer Branch Protection

**URL** : https://github.com/Funesterie/alphaonze/settings/branches

Ajouter une règle pour `master` :

- ✅ **Require a pull request before merging** (optionnel, si tu veux review)
- ✅ **Require status checks to pass** :
  - `secret-scan`
  - `dependency-audit`
- ✅ **Do not allow bypassing the above settings** (même pour les admins)

### 5. Activer Secret Scanning

**URL** : https://github.com/Funesterie/alphaonze/settings/security_analysis

Activer :

- ✅ **Secret scanning** — GitHub détecte automatiquement les secrets committés
- ✅ **Push protection** — bloque les push qui contiennent des secrets

### 6. Configurer les Notifications de Sécurité

**URL** : https://github.com/Funesterie/alphaonze/settings/notifications

Activer :

- ✅ **Security alerts** — email quand une vulnérabilité est détectée
- ✅ **Dependabot alerts** — email pour les dépendances vulnérables

### 7. Restreindre les Permissions des Workflows

**URL** : https://github.com/Funesterie/alphaonze/settings/actions

Configurer :

- **Workflow permissions** : `Read repository contents and packages permissions`
- ✅ **Allow GitHub Actions to create and approve pull requests** (pour Dependabot)

---

## 🔐 Ce que tu dois faire sur Render

### 1. Ajouter les Variables d'Environnement

**URL** : https://dashboard.render.com/ → a11-backend → Environment

Ajouter ces secrets :

| Key                     | Value                                                                                  | Source            |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| `JWT_SECRET`            | `<set-in-github-secret>`                                                              | Secret store      |
| `GROQ_API_KEY`          | `<set-in-github-secret>`                                                              | Secret store      |
| `TOGETHER_API_KEY`      | (à obtenir sur api.together.xyz)                                                       | Optionnel         |
| `XAI_API_KEY`           | `<set-in-github-secret>`                                                              | Secret store      |
| `STRIPE_SECRET_KEY`     | `<set-in-github-secret>`                                                              | Secret store      |
| `STRIPE_WEBHOOK_SECRET` | `<set-in-github-secret>`                                                              | Secret store      |
| `RESEND_API_KEY`        | `<set-in-github-secret>`                                                              | Secret store      |

**Minimum vital pour que A11 réponde** : `JWT_SECRET` + `GROQ_API_KEY`

### 2. Forcer un Redéploiement Propre

**URL** : https://dashboard.render.com/ → a11-backend → Manual Deploy

Clique **"Clear build cache & deploy"** pour forcer Render à utiliser le nouveau `render.yaml` (env: node au lieu de docker).

---

## 🐳 Ce que tu dois faire sur Docker Hub (optionnel)

Si tu veux utiliser Docker Hub au lieu de déployer depuis GitHub :

### 1. Rendre le repo Docker Hub public (ou upgrader)

**URL** : `https://hub.docker.com/repository/docker/<dockerhub-namespace>/a11/general`

Les repos Docker Hub privés nécessitent un plan payant. Si tu veux rester gratuit, rendre le repo public.

### 2. Attendre que GitHub Actions build l'image

Une fois le secret `DOCKERHUB_TOKEN` ajouté sur GitHub, le workflow va builder et pusher `<dockerhub-namespace>/a11:latest` automatiquement.

### 3. Déployer depuis Docker Hub sur Render

Créer un nouveau service Render :

- **Type** : Web Service
- **Source** : Docker Hub
- **Image** : `<dockerhub-namespace>/a11:latest`
- **Port** : 3000
- **Health Check** : `/health`

---

## 📊 Résumé des Actions Manuelles

| Plateforme     | Action                                       | Priorité      |
| -------------- | -------------------------------------------- | ------------- |
| **GitHub**     | Ajouter secret `DOCKERHUB_TOKEN`             | 🔴 Critique   |
| **GitHub**     | Activer Dependabot alerts                    | 🟡 Recommandé |
| **GitHub**     | Activer Secret scanning + Push protection    | 🟡 Recommandé |
| **GitHub**     | Activer CodeQL analysis                      | 🟢 Optionnel  |
| **Render**     | Ajouter `JWT_SECRET`                         | 🔴 Critique   |
| **Render**     | Ajouter `GROQ_API_KEY`                       | 🔴 Critique   |
| **Render**     | Ajouter autres secrets (Stripe, Resend, xAI) | 🟡 Recommandé |
| **Render**     | Clear build cache & deploy                   | 🔴 Critique   |
| **Docker Hub** | Rendre repo public (ou upgrader)             | 🟢 Optionnel  |

---

## 🚀 Ordre d'Exécution Recommandé

1. **GitHub** → Ajouter `DOCKERHUB_TOKEN` (30 secondes)
2. **GitHub** → Activer Dependabot + Secret scanning (2 minutes)
3. **Render** → Ajouter `JWT_SECRET` + `GROQ_API_KEY` (1 minute)
4. **Render** → Clear build cache & deploy (5 minutes)
5. **Tester** → https://a11.funesterie.me (vérifier que A11 répond)

---

**Status : Sécurité configurée côté code, actions manuelles requises sur les dashboards** ✅
