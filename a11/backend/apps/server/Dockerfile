# A11 Backend - Dockerfile pour Podman/Docker
# Piper official binaries require glibc. Alpine/musl can start the binary but
# ONNX Runtime crashes during synthesis, so production uses Debian slim.
FROM node:20-bookworm-slim

# Métadonnées
LABEL maintainer="Jeffrey Cellauro <funeste38@gmail.com>"
LABEL description="A11 Backend - Assistant IA avec Stripe"
LABEL version="1.0.0"

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST_SERVER=0.0.0.0

# Installer les dépendances système nécessaires
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      espeak-ng \
      ffmpeg \
      g++ \
      make \
      postgresql-client \
      python3 \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de l'application
WORKDIR /app

# Piper TTS local fallback.
ARG PIPER_RELEASE=2023.11.14-2
ARG PIPER_VOICE_VERSION=v1.0.0
RUN mkdir -p /app/apps/tts/piper \
    && curl -L --fail --retry 3 \
      -o /tmp/piper_linux_x86_64.tar.gz \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_linux_x86_64.tar.gz" \
    && tar -xzf /tmp/piper_linux_x86_64.tar.gz -C /tmp \
    && cp -R /tmp/piper/. /app/apps/tts/piper/ \
    && chmod +x /app/apps/tts/piper/piper \
    && ln -sf /app/apps/tts/piper/piper /app/apps/tts/piper.exe \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/fr_FR-siwis-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/fr_FR-siwis-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/en_US-lessac-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/en_US-lessac-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/it_IT-paola-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/it/it_IT/paola/medium/it_IT-paola-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/it_IT-paola-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/es_ES-sharvard-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/es_ES-sharvard-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/de_DE-thorsten-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/apps/tts/de_DE-thorsten-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json" \
    && rm -rf /tmp/piper /tmp/piper_linux_x86_64.tar.gz

# Copier les fichiers package
COPY package*.json ./

# Installer les dependances avec les outils de patch, puis retirer le dev-only.
# Le postinstall applique les patches locaux via patch-package.
ARG JFROG_NPM_AUTH_TOKEN
ARG JFROG_NPM_REGISTRY=https://trialhnuk69.jfrog.io/artifactory/api/npm/funesterie-npm/
RUN set -eu; \
    if [ -n "${JFROG_NPM_AUTH_TOKEN:-}" ]; then \
      npm config set @funeste38:registry "${JFROG_NPM_REGISTRY}"; \
      auth_target="$(node -e "const u=new URL(process.env.JFROG_NPM_REGISTRY); console.log((u.host + u.pathname).replace(/\/$/, ''))")"; \
      npm config set "//$auth_target/:_authToken" "${JFROG_NPM_AUTH_TOKEN}"; \
    fi; \
    npm ci --include=dev; \
    npm prune --omit=dev; \
    npm config delete @funeste38:registry || true; \
    auth_target="$(node -e "const u=new URL(process.env.JFROG_NPM_REGISTRY); console.log((u.host + u.pathname).replace(/\/$/, ''))")"; \
    npm config delete "//$auth_target/:_authToken" || true

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
    CMD curl -f http://localhost:3000/health || exit 1

# Démarrer l'application
CMD ["node", "server.cjs"]
