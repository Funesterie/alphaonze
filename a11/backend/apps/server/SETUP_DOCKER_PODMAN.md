# 🐳 Installation et Configuration Docker/Podman

## ⚠️ Problème Actuel

Ni Docker ni Podman ne sont correctement configurés sur ta machine.

## 🔧 Solutions

### Option 1 : Installer Docker Desktop (Recommandé - Plus Simple)

#### Avantages

- Interface graphique
- Configuration automatique
- Pas besoin de WSL complexe
- Fonctionne immédiatement

#### Installation

1. **Télécharger Docker Desktop**
   - Va sur : https://www.docker.com/products/docker-desktop/
   - Télécharge la version Windows
   - Taille : ~500 MB

2. **Installer**
   - Lance l'installeur
   - Accepte les paramètres par défaut
   - Redémarre si demandé

3. **Démarrer Docker Desktop**
   - Lance l'application "Docker Desktop"
   - Attends que l'icône devienne verte (Docker is running)

4. **Vérifier**

   ```powershell
   docker --version
   docker ps
   ```

5. **Builder et Pusher**

   ```powershell
   cd D:\projets\funesterie\a11\backend\apps\server

   # Build
   docker build -t a11-backend:latest .

   # Login
   docker login
   # Username: <dockerhub-username-or-namespace>
   # Password: [ton mot de passe Docker Hub]

   # Tag
   docker tag a11-backend:latest <dockerhub-namespace>/a11-backend:latest

   # Push
   docker push <dockerhub-namespace>/a11-backend:latest
   ```

### Option 2 : Réparer Podman (Plus Complexe)

#### Problème Actuel

Podman nécessite WSL2 qui semble avoir un problème.

#### Étapes de Réparation

1. **Vérifier WSL**

   ```powershell
   wsl --status
   wsl --list --verbose
   ```

2. **Installer/Mettre à jour WSL**

   ```powershell
   wsl --install
   # ou
   wsl --update
   ```

3. **Redémarrer**
   Redémarre ton PC

4. **Réinitialiser Podman**

   ```powershell
   # Supprimer l'ancienne machine
   podman machine rm podman-machine-default

   # Réinitialiser
   podman machine init

   # Démarrer
   podman machine start
   ```

5. **Vérifier**
   ```powershell
   podman --version
   podman ps
   ```

### Option 3 : Utiliser Railway Directement (Sans Docker Local)

#### Avantages

- Pas besoin de Docker/Podman local
- Railway build l'image automatiquement
- Plus simple pour le déploiement

#### Étapes

1. **Commit le Dockerfile**

   ```powershell
   cd D:\projets\funesterie
   git add a11/backend/apps/server/Dockerfile
   git add a11/backend/apps/server/.dockerignore
   git commit -m "feat(docker): Add Dockerfile for Railway deployment"
   git push origin master
   ```

2. **Railway va automatiquement**
   - Détecter le Dockerfile
   - Builder l'image
   - Déployer le container

3. **Configurer les variables d'environnement**
   - Va sur le dashboard Railway
   - Ajoute toutes les variables de `.env.local`

## 🎯 Recommandation

**Pour toi, je recommande l'Option 1 (Docker Desktop)** car :

- ✅ Installation simple et rapide
- ✅ Interface graphique intuitive
- ✅ Pas de problèmes WSL
- ✅ Fonctionne immédiatement
- ✅ Gratuit pour usage personnel

## 📦 Alternative : Build sur une Autre Machine

Si tu as accès à une autre machine (Linux, Mac, ou Windows avec Docker) :

1. **Copier les fichiers**
   - Copie le dossier `a11/backend/apps/server/` sur l'autre machine

2. **Builder**

   ```bash
   cd a11/backend/apps/server
   docker build -t <dockerhub-namespace>/a11-backend:latest .
   ```

3. **Login et Push**
   ```bash
   docker login
   docker push <dockerhub-namespace>/a11-backend:latest
   ```

## 🌐 Utiliser Docker Hub Build (Automatique)

Docker Hub peut builder automatiquement depuis GitHub :

1. **Va sur Docker Hub**
   - https://hub.docker.com/

2. **Créer un Automated Build**
   - Connecte ton compte GitHub
   - Sélectionne le repo `funesterie`
   - Configure le build :
     - Dockerfile location : `/a11/backend/apps/server/Dockerfile`
     - Build context : `/a11/backend/apps/server/`

3. **Docker Hub va automatiquement**
   - Builder l'image à chaque push sur GitHub
   - Publier l'image sur `<dockerhub-namespace>/a11-backend:latest`

## ✅ Prochaines Étapes

### Si tu choisis Docker Desktop (Recommandé)

1. Télécharge et installe Docker Desktop
2. Démarre Docker Desktop
3. Exécute :
   ```powershell
   cd D:\projets\funesterie\a11\backend\apps\server
   .\push-to-dockerhub.ps1
   ```

### Si tu choisis Railway Direct

1. Commit le Dockerfile :

   ```powershell
   git add a11/backend/apps/server/Dockerfile
   git commit -m "feat: Add Dockerfile"
   git push
   ```

2. Railway va builder automatiquement

### Si tu choisis Docker Hub Automated Build

1. Va sur https://hub.docker.com/
2. Configure l'automated build depuis GitHub
3. Push sur GitHub déclenche le build automatique

## 🆘 Besoin d'Aide ?

Si tu as des questions ou des problèmes :

1. Vérifie les logs d'erreur
2. Consulte la documentation Docker : https://docs.docker.com/
3. Consulte la documentation Podman : https://podman.io/

---

**Choisis l'option qui te convient le mieux !** 🚀

Ma recommandation : **Docker Desktop** (Option 1) - C'est le plus simple et rapide.
