FROM node:22-bookworm-slim

ARG A11_INSTALL_JANUS=1

ENV NODE_ENV=production \
    A11_INSTALL_JANUS=${A11_INSTALL_JANUS} \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/opt/venv/bin:/app/node_modules/.bin:$PATH

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash python3 python3-venv ca-certificates libstdc++6 git ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir piper-tts

COPY . .

RUN /opt/venv/bin/pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r tools/sd/requirements.txt

RUN if [ "${A11_INSTALL_JANUS}" = "1" ]; then \
      python3 -m venv /opt/janus-venv \
      && /opt/janus-venv/bin/pip install --no-cache-dir -U pip \
      && JANUS_PYTHON_VERSION="$("/opt/janus-venv/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" \
      && echo "/opt/venv/lib/python${JANUS_PYTHON_VERSION}/site-packages" > "/opt/janus-venv/lib/python${JANUS_PYTHON_VERSION}/site-packages/a11_backend_sd_sitepackages.pth" \
      && if ! /opt/janus-venv/bin/pip install --no-cache-dir -r tools/vision/requirements.txt; then \
           echo "[A11] Warning: bundled Janus install failed during Docker build; continuing without local Janus runtime"; \
           rm -rf /opt/janus-venv; \
         fi; \
    fi

EXPOSE 8080

CMD ["bash", "start.sh"]
