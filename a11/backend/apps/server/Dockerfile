# syntax=docker/dockerfile:1.7
# A11 Backend - Dockerfile pour Podman/Docker
# Piper official binaries require glibc. Alpine/musl can start the binary but
# ONNX Runtime crashes during synthesis, so production uses Debian slim.
FROM node:24-trixie-slim AS npm-deps

ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Native npm modules may need a compiler during install. Keep build tools out
# of the final runtime image.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      g++ \
      make \
      python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --include=dev \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:24-trixie-slim AS piper-assets

WORKDIR /app

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

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

FROM node:24-trixie-slim

# Métadonnées
LABEL maintainer="NOSSEN <contact@funesterie.me>"
LABEL description="A11 Backend - Assistant IA avec Stripe"
LABEL version="1.0.0"

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST_SERVER=0.0.0.0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Installer les dépendances système nécessaires
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      espeak-ng \
      ffmpeg \
      libatomic1 \
      postgresql-client \
      python3 \
      python3-venv \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de l'application
WORKDIR /app

# Copier le code source
COPY package*.json ./
COPY --from=npm-deps /app/node_modules ./node_modules
COPY --from=piper-assets /app/apps/tts /app/apps/tts
COPY . .

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
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Démarrer l'application
CMD ["node", "server.cjs"]
