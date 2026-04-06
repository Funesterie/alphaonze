FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:/app/node_modules/.bin:$PATH

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash python3 python3-venv ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir piper-tts

COPY . .

EXPOSE 8080

CMD ["bash", "start.sh"]
