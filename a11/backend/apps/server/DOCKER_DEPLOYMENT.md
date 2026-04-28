# Guide de Déploiement Docker/Podman - A11 Backend

## 🐳 Build de l'Image

### Avec Docker

```bash
cd funesterie/a11/backend/apps/server

# Build l'image
docker build -t a11-backend:latest .

# Vérifier l'image
docker images | grep a11-backend
```

### Avec Podman

```bash
cd funesterie/a11/backend/apps/server

# Build l'image
podman build -t a11-backend:latest .

# Vérifier l'image
podman images | grep a11-backend
```

## 📦 Localisation de l'Image

### Docker

L'image est stockée dans le daemon Docker local :

```bash
# Lister les images
docker images

# Inspecter l'image
docker inspect a11-backend:latest

# Sauvegarder l'image en fichier .tar
docker save a11-backend:latest -o a11-backend.tar

# Charger l'image depuis un fichier
docker load -i a11-backend.tar
```

**Emplacement sur Windows :**

- `C:\ProgramData\Docker\` (Docker Desktop)
- Ou dans WSL2 : `/var/lib/docker/`

### Podman

L'image est stockée dans le storage Podman :

```bash
# Lister les images
podman images

# Inspecter l'image
podman inspect a11-backend:latest

# Sauvegarder l'image en fichier .tar
podman save a11-backend:latest -o a11-backend.tar

# Charger l'image depuis un fichier
podman load -i a11-backend.tar
```

**Emplacement sur Windows :**

- `C:\Users\<username>\.local\share\containers\storage\`
- Ou dans WSL2 : `~/.local/share/containers/storage/`

## 🚀 Déploiement

### 1. Préparer les Variables d'Environnement

```bash
# Copier le fichier exemple
cp .env.docker.example .env.docker

# Éditer avec vos vraies valeurs
nano .env.docker
```

### 2. Démarrer avec Docker Compose

```bash
# Démarrer
docker-compose --env-file .env.docker up -d

# Voir les logs
docker-compose logs -f a11-backend

# Arrêter
docker-compose down
```

### 3. Démarrer avec Podman Compose

```bash
# Démarrer
podman-compose --env-file .env.docker up -d

# Voir les logs
podman-compose logs -f a11-backend

# Arrêter
podman-compose down
```

### 4. Démarrer Manuellement (sans Compose)

#### Docker

```bash
docker run -d \
  --name a11-backend \
  -p 3000:3000 \
  --env-file .env.docker \
  -v a11-logs:/app/logs \
  -v a11-runtime:/app/runtime \
  --restart unless-stopped \
  a11-backend:latest
```

#### Podman

```bash
podman run -d \
  --name a11-backend \
  -p 3000:3000 \
  --env-file .env.docker \
  -v a11-logs:/app/logs \
  -v a11-runtime:/app/runtime \
  --restart unless-stopped \
  a11-backend:latest
```

## 🔍 Vérification

### Health Check

```bash
# Docker
docker ps
docker logs a11-backend
curl http://localhost:3000/api/health

# Podman
podman ps
podman logs a11-backend
curl http://localhost:3000/api/health
```

### Accéder au Container

```bash
# Docker
docker exec -it a11-backend sh

# Podman
podman exec -it a11-backend sh
```

## 📤 Exporter l'Image

### Pour Partager ou Déployer Ailleurs

```bash
# Docker
docker save a11-backend:latest | gzip > a11-backend-latest.tar.gz

# Podman
podman save a11-backend:latest | gzip > a11-backend-latest.tar.gz

# Sur la machine cible
gunzip -c a11-backend-latest.tar.gz | docker load
# ou
gunzip -c a11-backend-latest.tar.gz | podman load
```

### Push vers un Registry

```bash
# Tag l'image
docker tag a11-backend:latest registry.example.com/a11-backend:latest

# Push
docker push registry.example.com/a11-backend:latest

# Ou avec Podman
podman tag a11-backend:latest registry.example.com/a11-backend:latest
podman push registry.example.com/a11-backend:latest
```

## 🔧 Maintenance

### Mettre à Jour

```bash
# Rebuild l'image
docker build -t a11-backend:latest .

# Redémarrer le container
docker-compose down
docker-compose up -d

# Ou manuellement
docker stop a11-backend
docker rm a11-backend
docker run -d ... (même commande que ci-dessus)
```

### Nettoyer

```bash
# Supprimer le container
docker stop a11-backend
docker rm a11-backend

# Supprimer l'image
docker rmi a11-backend:latest

# Nettoyer les volumes (ATTENTION: supprime les données)
docker volume rm a11-logs a11-runtime

# Avec Podman
podman stop a11-backend
podman rm a11-backend
podman rmi a11-backend:latest
podman volume rm a11-logs a11-runtime
```

## 📊 Monitoring

### Logs

```bash
# Suivre les logs en temps réel
docker logs -f a11-backend

# Dernières 100 lignes
docker logs --tail 100 a11-backend

# Avec Podman
podman logs -f a11-backend
```

### Statistiques

```bash
# Docker
docker stats a11-backend

# Podman
podman stats a11-backend
```

## 🌐 Déploiement Production

### Railway

Railway supporte les Dockerfiles. Ajoutez simplement le Dockerfile à la racine de votre repo et Railway le détectera automatiquement.

### Autres Plateformes

- **Fly.io** : `fly launch` détecte le Dockerfile
- **Render** : Supporte Docker nativement
- **DigitalOcean App Platform** : Supporte Docker
- **AWS ECS/Fargate** : Push l'image vers ECR
- **Google Cloud Run** : Push l'image vers GCR
- **Azure Container Instances** : Push l'image vers ACR

## 🔐 Sécurité

### Variables Sensibles

Ne jamais commit `.env.docker` avec des vraies valeurs !

```bash
# Ajouter au .gitignore
echo ".env.docker" >> .gitignore
```

### Secrets Management

Pour la production, utilisez :

- **Docker Secrets** (Swarm)
- **Kubernetes Secrets**
- **HashiCorp Vault**
- **AWS Secrets Manager**
- **Azure Key Vault**

## 📝 Taille de l'Image

```bash
# Voir la taille
docker images a11-backend:latest

# Optimiser (déjà fait avec Alpine)
# L'image devrait faire ~200-300 MB
```

## ✅ Checklist de Déploiement

- [ ] Build l'image : `docker build -t a11-backend:latest .`
- [ ] Créer `.env.docker` avec les vraies valeurs
- [ ] Tester localement : `docker-compose up`
- [ ] Vérifier le health check : `curl http://localhost:3000/api/health`
- [ ] Tester l'authentification
- [ ] Tester Stripe
- [ ] Configurer les webhooks Stripe
- [ ] Push vers le registry (si applicable)
- [ ] Déployer en production
- [ ] Vérifier les logs
- [ ] Tester le flux complet

---

**Image créée avec succès !** 🎉

L'image Docker/Podman est maintenant disponible localement sous le nom `a11-backend:latest`.
