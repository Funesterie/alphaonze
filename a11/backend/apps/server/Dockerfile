# syntax=docker/dockerfile:1.7
# A11 Backend - Dockerfile pour Podman/Docker
# Piper official binaries require glibc. Alpine/musl can start the binary but
# ONNX Runtime crashes during synthesis, so production uses Debian slim.
FROM node:20-bookworm-slim

# Métadonnées
LABEL maintainer="NOSSEN <contact@funesterie.me>"
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
      git \
      g++ \
      make \
      postgresql-client \
      python3 \
      python3-pip \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de l'application
WORKDIR /app

# Piper TTS local fallback.
ARG PIPER_RELEASE=2023.11.14-2
ARG PIPER_VOICE_VERSION=v1.0.0
ARG PIPER_RELEASE_BASE_URL=https://github.com/rhasspy/piper/releases/download
ARG PIPER_VOICE_BASE_URL=https://huggingface.co/rhasspy/piper-voices/resolve
ARG A11_CURL_RETRY=12
ARG A11_CURL_RETRY_DELAY=8
ARG A11_CURL_RETRY_MAX_TIME=900
RUN set -eu; \
    fetch() { \
      out="$1"; \
      url="$2"; \
      curl -L --fail --retry "${A11_CURL_RETRY}" --retry-all-errors \
        --retry-delay "${A11_CURL_RETRY_DELAY}" --retry-max-time "${A11_CURL_RETRY_MAX_TIME}" \
        --connect-timeout 20 --max-time 300 \
        -o "$out" "$url"; \
    }; \
    mkdir -p /app/apps/tts/piper \
    && fetch \
      /tmp/piper_linux_x86_64.tar.gz \
      "${PIPER_RELEASE_BASE_URL}/${PIPER_RELEASE}/piper_linux_x86_64.tar.gz" \
    && tar -xzf /tmp/piper_linux_x86_64.tar.gz -C /tmp \
    && cp -R /tmp/piper/. /app/apps/tts/piper/ \
    && chmod +x /app/apps/tts/piper/piper \
    && ln -sf /app/apps/tts/piper/piper /app/apps/tts/piper.exe \
    && fetch \
      /app/apps/tts/fr_FR-siwis-medium.onnx \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx" \
    && fetch \
      /app/apps/tts/fr_FR-siwis-medium.onnx.json \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json" \
    && fetch \
      /app/apps/tts/en_US-lessac-medium.onnx \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/en/en_US/lessac/medium/en_US-lessac-medium.onnx" \
    && fetch \
      /app/apps/tts/en_US-lessac-medium.onnx.json \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" \
    && fetch \
      /app/apps/tts/it_IT-paola-medium.onnx \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/it/it_IT/paola/medium/it_IT-paola-medium.onnx" \
    && fetch \
      /app/apps/tts/it_IT-paola-medium.onnx.json \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json" \
    && fetch \
      /app/apps/tts/es_ES-sharvard-medium.onnx \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx" \
    && fetch \
      /app/apps/tts/es_ES-sharvard-medium.onnx.json \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json" \
    && fetch \
      /app/apps/tts/de_DE-thorsten-medium.onnx \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx" \
    && fetch \
      /app/apps/tts/de_DE-thorsten-medium.onnx.json \
      "${PIPER_VOICE_BASE_URL}/${PIPER_VOICE_VERSION}/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json" \
    && rm -rf /tmp/piper /tmp/piper_linux_x86_64.tar.gz

# Copier les fichiers package
COPY package*.json ./

# Installer les dependances avec les outils de patch, puis retirer le dev-only.
# Railway V2 ne supporte pas les montages BuildKit `type=secret`; les dependances
# actuelles du backend se resolvent depuis le registre npm public.
RUN set -eu; \
    npm ci --include=dev; \
    npm prune --omit=dev

# Copier le code source
COPY . .

# NOSSEN: Le package mcp-bridge-tunnel est copié dans le contexte Docker
# par le script de release (redeploy-green.sh ou CI).
# mount-zen-gate.cjs le cherche à /app/packages/mcp-bridge-tunnel/index.cjs

# Optional Pink Ward / Janus runtime for GPU-enabled production images.
# Standard builds keep this disabled; docker-compose.vision.yml enables it.
ARG A11_INSTALL_JANUS=0
ARG A11_JANUS_TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ARG A11_JANUS_TORCH_PACKAGES="torch torchvision torchaudio"
RUN set -eu; \
    if [ "${A11_INSTALL_JANUS}" = "1" ]; then \
      python3 -m venv /opt/janus-venv; \
      /opt/janus-venv/bin/python -m ensurepip --upgrade || true; \
      /opt/janus-venv/bin/python -m pip install --no-cache-dir --upgrade pip setuptools wheel; \
      /opt/janus-venv/bin/python -m pip install --no-cache-dir --index-url "${A11_JANUS_TORCH_INDEX_URL}" ${A11_JANUS_TORCH_PACKAGES}; \
      /opt/janus-venv/bin/python -m pip install --no-cache-dir --extra-index-url "${A11_JANUS_TORCH_INDEX_URL}" -r tools/vision/requirements.txt; \
    fi

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
