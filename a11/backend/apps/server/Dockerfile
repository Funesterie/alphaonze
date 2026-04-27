# A11 Backend - Dockerfile pour Podman/Docker
FROM node:20-alpine

# Métadonnées
LABEL maintainer="Jeffrey Cellauro <djeff@funesterie.pro>"
LABEL description="A11 Backend - Assistant IA avec Stripe"
LABEL version="1.0.0"

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST_SERVER=0.0.0.0

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    postgresql-client \
    curl

# Créer le répertoire de l'application
WORKDIR /app

# Copier les fichiers package
COPY package*.json ./

# Installer les dépendances de production
RUN npm ci --only=production --ignore-scripts

# Copier le code source
COPY . .

# Créer les répertoires nécessaires
RUN mkdir -p \
    /app/logs \
    /app/logs/supervisor \
    /app/runtime \
    /app/runtime/files \
    /app/runtime/files/uploads

# Exposer le port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Démarrer l'application
CMD ["node", "server.cjs"]
