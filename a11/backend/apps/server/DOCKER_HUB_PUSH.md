# 🐳 Push vers Docker Hub - A11 Backend

## 📋 Prérequis

- Compte Docker Hub : `<dockerhub-namespace>`
- Image buildée localement : `a11-backend:latest`
- Docker ou Podman installé

## 🔐 Connexion à Docker Hub

### Avec Docker

```powershell
docker login
# Username: <dockerhub-username-or-namespace>
# Password: [ton mot de passe Docker Hub]
```

### Avec Podman

```powershell
podman login docker.io
# Username: <dockerhub-username-or-namespace>
# Password: [ton mot de passe Docker Hub]
```

## 🏷️ Tag de l'Image

### Option 1 : Tag Latest (Recommandé pour Production)

```powershell
# Avec Docker
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
```

### Option 2 : Tag avec Version

```powershell
# Avec Docker
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.0
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.0
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
```

### Option 3 : Tag avec Date

```powershell
# Avec Docker
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:2026-04-28
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:2026-04-28
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
```

## 📤 Push vers Docker Hub

### Push Latest

```powershell
# Avec Docker
docker push <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman push <dockerhub-namespace>/a11-backend:latest
```

### Push avec Version

```powershell
# Avec Docker
docker push <dockerhub-namespace>/a11-backend:v1.0.0
docker push <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman push <dockerhub-namespace>/a11-backend:v1.0.0
podman push <dockerhub-namespace>/a11-backend:latest
```

## ✅ Vérification

### Sur Docker Hub

1. Aller sur https://hub.docker.com/r/<dockerhub-namespace>/a11-backend
2. Vérifier que l'image apparaît
3. Vérifier les tags disponibles

### En Ligne de Commande

```powershell
# Avec Docker
docker search <dockerhub-namespace>/a11-backend

# Avec Podman
podman search <dockerhub-namespace>/a11-backend
```

## 📥 Pull de l'Image (Pour Tester)

```powershell
# Avec Docker
docker pull <dockerhub-namespace>/a11-backend:latest

# Avec Podman
podman pull <dockerhub-namespace>/a11-backend:latest
```

## 🚀 Utilisation de l'Image Publique

### Docker Run

```powershell
docker run -d `
  --name a11-backend `
  -p 3000:3000 `
  --env-file .env.docker `
  <dockerhub-namespace>/a11-backend:latest
```

### Podman Run

```powershell
podman run -d `
  --name a11-backend `
  -p 3000:3000 `
  --env-file .env.docker `
  <dockerhub-namespace>/a11-backend:latest
```

### Docker Compose

Modifier `docker-compose.yml` :

```yaml
services:
  a11-backend:
    image: <dockerhub-namespace>/a11-backend:latest # Au lieu de build: .
    container_name: a11-backend
    # ... reste de la config
```

## 📊 Gestion des Versions

### Stratégie de Tagging Recommandée

```powershell
# Build
docker build -t a11-backend:latest .

# Tag multiple
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.0
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:stable

# Push tous les tags
docker push <dockerhub-namespace>/a11-backend:latest
docker push <dockerhub-namespace>/a11-backend:v1.0.0
docker push <dockerhub-namespace>/a11-backend:stable
```

### Tags Suggérés

- `latest` - Dernière version stable
- `v1.0.0` - Version sémantique
- `stable` - Version stable actuelle
- `dev` - Version de développement
- `2026-04-28` - Version datée

## 🔄 Mise à Jour de l'Image

### 1. Rebuild

```powershell
cd D:\projets\funesterie\a11\backend\apps\server
docker build -t a11-backend:latest .
```

### 2. Re-tag

```powershell
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.1
```

### 3. Push

```powershell
docker push <dockerhub-namespace>/a11-backend:latest
docker push <dockerhub-namespace>/a11-backend:v1.0.1
```

## 🗑️ Supprimer une Image de Docker Hub

Les images ne peuvent être supprimées que depuis le site web :

1. Aller sur https://hub.docker.com/r/<dockerhub-namespace>/a11-backend
2. Cliquer sur "Manage Repository"
3. Aller dans "Tags"
4. Supprimer le tag souhaité

## 📝 Description Docker Hub

Ajoute cette description sur Docker Hub :

````markdown
# A11 Backend - Assistant IA avec Stripe

Backend Node.js pour A11 (AlphaOnze), un assistant IA modulaire avec :

- 🤖 Support LLM (Ollama, OpenAI)
- 💳 Intégration Stripe (abonnements)
- 🔐 Authentification JWT
- 📧 Email (Resend)
- 🗄️ PostgreSQL + Redis
- 🎨 Génération d'images/vidéos

## Quick Start

```bash
docker run -d \
  --name a11-backend \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e STRIPE_SECRET_KEY=sk_... \
  # JWT_SECRET is configured via the deployment secret store.
  <dockerhub-namespace>/a11-backend:latest
```
````

## Documentation

https://github.com/Funesterie/funesterie

## Support

Email: djeff@funesterie.me

````

## 🔒 Sécurité

### Image Publique vs Privée

**Actuellement : Publique** (gratuit sur Docker Hub)

Pour rendre l'image privée :
1. Aller sur https://hub.docker.com/r/<dockerhub-namespace>/a11-backend/settings
2. Cliquer sur "Make Private"
3. Confirmer

**Note :** Les repos privés sont limités sur le plan gratuit Docker Hub.

### Secrets

⚠️ **IMPORTANT** : L'image ne contient PAS de secrets !

Les secrets sont passés via :
- Variables d'environnement (`--env-file`)
- Docker secrets
- Kubernetes secrets

## 📦 Commandes Complètes (Copy-Paste)

### Build, Tag et Push (Tout en Un)

```powershell
# 1. Build
cd D:\projets\funesterie\a11\backend\apps\server
docker build -t a11-backend:latest .

# 2. Login (si pas déjà fait)
docker login

# 3. Tag
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.0

# 4. Push
docker push <dockerhub-namespace>/a11-backend:latest
docker push <dockerhub-namespace>/a11-backend:v1.0.0

# 5. Vérifier
docker search <dockerhub-namespace>/a11-backend
````

### Avec Podman

```powershell
# 1. Build
cd D:\projets\funesterie\a11\backend\apps\server
podman build -t a11-backend:latest .

# 2. Login
podman login docker.io

# 3. Tag
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
podman tag a11-backend:latest <dockerhub-namespace>/a11-backend:v1.0.0

# 4. Push
podman push <dockerhub-namespace>/a11-backend:latest
podman push <dockerhub-namespace>/a11-backend:v1.0.0

# 5. Vérifier
podman search <dockerhub-namespace>/a11-backend
```

## 🌐 URL de l'Image

Une fois pushée, l'image sera disponible à :

```
docker.io/<dockerhub-namespace>/a11-backend:latest
```

Ou simplement :

```
<dockerhub-namespace>/a11-backend:latest
```

## ✅ Checklist

- [ ] Image buildée localement
- [ ] Connecté à Docker Hub (`docker login`)
- [ ] Image taguée (`docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest`)
- [ ] Image pushée (`docker push <dockerhub-namespace>/a11-backend:latest`)
- [ ] Vérification sur https://hub.docker.com/r/<dockerhub-namespace>/a11-backend
- [ ] Test pull (`docker pull <dockerhub-namespace>/a11-backend:latest`)
- [ ] Description ajoutée sur Docker Hub

---

**Prêt à push !** 🚀

Commande rapide :

```powershell
docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest
docker push <dockerhub-namespace>/a11-backend:latest
```
