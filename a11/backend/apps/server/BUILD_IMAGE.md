# 🐳 Guide de Build de l'Image A11 Backend

## ✅ Fichiers Créés

Tous les fichiers nécessaires pour Docker/Podman ont été créés :

```
funesterie/a11/backend/apps/server/
├── Dockerfile                  # Configuration de l'image
├── .dockerignore              # Fichiers à exclure
├── docker-compose.yml         # Orchestration
├── .env.docker.example        # Variables d'environnement exemple
├── DOCKER_DEPLOYMENT.md       # Guide complet de déploiement
└── BUILD_IMAGE.md            # Ce fichier
```

## 🚀 Étapes pour Builder l'Image

### Option 1 : Avec Podman (Recommandé)

1. **Démarrer Podman Machine** (si pas déjà fait)

   ```powershell
   podman machine init
   podman machine start
   ```

2. **Builder l'image**

   ```powershell
   cd D:\projets\funesterie\a11\backend\apps\server
   podman build -t a11-backend:latest .
   ```

3. **Vérifier l'image**
   ```powershell
   podman images | Select-String "a11-backend"
   ```

### Option 2 : Avec Docker Desktop

1. **Installer Docker Desktop** (si pas installé)
   - Télécharger : https://www.docker.com/products/docker-desktop/
   - Installer et démarrer Docker Desktop

2. **Builder l'image**

   ```powershell
   cd D:\projets\funesterie\a11\backend\apps\server
   docker build -t a11-backend:latest .
   ```

3. **Vérifier l'image**
   ```powershell
   docker images | Select-String "a11-backend"
   ```

## 📍 Où Trouver l'Image Après le Build

### Avec Podman

**Emplacement sur Windows :**

```
C:\Users\cella\.local\share\containers\storage\overlay-images\
```

**Commandes utiles :**

```powershell
# Lister les images
podman images

# Inspecter l'image
podman inspect a11-backend:latest

# Sauvegarder en fichier .tar
podman save a11-backend:latest -o a11-backend.tar

# L'image sera dans :
# D:\projets\funesterie\a11\backend\apps\server\a11-backend.tar
```

### Avec Docker

**Emplacement sur Windows :**

```
C:\ProgramData\Docker\windowsfilter\
```

**Commandes utiles :**

```powershell
# Lister les images
docker images

# Inspecter l'image
docker inspect a11-backend:latest

# Sauvegarder en fichier .tar
docker save a11-backend:latest -o a11-backend.tar

# L'image sera dans :
# D:\projets\funesterie\a11\backend\apps\server\a11-backend.tar
```

## 🧪 Tester l'Image Localement

### 1. Créer le fichier .env.docker

```powershell
# Copier l'exemple
Copy-Item .env.docker.example .env.docker

# Éditer avec tes vraies valeurs
notepad .env.docker
```

### 2. Démarrer le Container

**Avec Podman :**

```powershell
podman run -d `
  --name a11-backend `
  -p 3000:3000 `
  --env-file .env.docker `
  a11-backend:latest
```

**Avec Docker :**

```powershell
docker run -d `
  --name a11-backend `
  -p 3000:3000 `
  --env-file .env.docker `
  a11-backend:latest
```

### 3. Vérifier

```powershell
# Voir les logs
podman logs -f a11-backend
# ou
docker logs -f a11-backend

# Tester l'API
curl http://localhost:3000/api/health
```

## 📦 Exporter l'Image pour Déploiement

### Créer une Archive

```powershell
# Avec Podman
podman save a11-backend:latest | gzip > a11-backend-latest.tar.gz

# Avec Docker
docker save a11-backend:latest | gzip > a11-backend-latest.tar.gz
```

**L'archive sera dans :**

```
D:\projets\funesterie\a11\backend\apps\server\a11-backend-latest.tar.gz
```

### Charger l'Image sur une Autre Machine

```powershell
# Décompresser et charger
gunzip -c a11-backend-latest.tar.gz | podman load
# ou
gunzip -c a11-backend-latest.tar.gz | docker load
```

## 🌐 Déployer sur Railway

Railway détecte automatiquement le Dockerfile !

1. **Commit les fichiers Docker**

   ```powershell
   git add Dockerfile .dockerignore docker-compose.yml
   git commit -m "feat(docker): Add Docker support for A11 backend"
   git push origin master
   ```

2. **Railway va automatiquement :**
   - Détecter le Dockerfile
   - Builder l'image
   - Déployer le container

3. **Configurer les variables d'environnement dans Railway**
   - Aller sur le dashboard Railway
   - Ajouter toutes les variables de `.env.docker.example`

## 📊 Informations sur l'Image

**Taille estimée :** ~200-300 MB (Alpine Linux + Node.js 20)

**Contenu :**

- Node.js 20 (Alpine)
- Backend A11 complet
- Dépendances de production
- Health check intégré

**Ports exposés :**

- 3000 (API HTTP)

**Volumes recommandés :**

- `/app/logs` - Logs de l'application
- `/app/runtime` - Fichiers runtime

## 🔧 Dépannage

### Podman ne démarre pas

```powershell
# Réinitialiser la machine
podman machine stop
podman machine rm
podman machine init
podman machine start
```

### Docker ne démarre pas

- Vérifier que Docker Desktop est lancé
- Redémarrer Docker Desktop
- Vérifier WSL2 (si sur Windows)

### Build échoue

```powershell
# Nettoyer le cache
podman system prune -a
# ou
docker system prune -a

# Rebuild
podman build --no-cache -t a11-backend:latest .
```

## ✅ Checklist

- [ ] Podman ou Docker installé et démarré
- [ ] Naviguer vers `D:\projets\funesterie\a11\backend\apps\server`
- [ ] Exécuter `podman build -t a11-backend:latest .` (ou `docker build`)
- [ ] Attendre la fin du build (~5-10 minutes)
- [ ] Vérifier avec `podman images` (ou `docker images`)
- [ ] L'image `a11-backend:latest` apparaît dans la liste
- [ ] Optionnel : Sauvegarder en .tar avec `podman save`

---

## 📍 Réponse à ta Question

**Où est l'image pour Podman ?**

Après le build avec `podman build -t a11-backend:latest .`, l'image est stockée dans :

```
C:\Users\cella\.local\share\containers\storage\overlay-images\
```

Pour l'exporter en fichier .tar (plus facile à manipuler) :

```powershell
cd D:\projets\funesterie\a11\backend\apps\server
podman save a11-backend:latest -o a11-backend.tar
```

Le fichier `a11-backend.tar` sera créé dans le répertoire actuel et tu pourras :

- Le copier ailleurs
- Le charger sur une autre machine
- Le push vers un registry

**Taille du fichier .tar :** ~200-300 MB

---

**Prêt à builder !** 🚀

Exécute simplement :

```powershell
cd D:\projets\funesterie\a11\backend\apps\server
podman build -t a11-backend:latest .
```
