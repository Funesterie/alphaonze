FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PORT=5002
ENV A11_VOICE_OUT_DIR=/app/out
ENV A11_VOICE_MODEL=/app/models/fr_FR-siwis-medium.onnx
ENV A11_VOICE_CONFIG=/app/models/fr_FR-siwis-medium.onnx.json
ENV A11_PIPER_BIN=/app/piper/piper
ENV A11_ESPEAK_DATA=/app/piper/espeak-ng-data

ARG PIPER_RELEASE=2023.11.14-2
ARG PIPER_VOICE_VERSION=v1.0.0

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      espeak-ng \
      ffmpeg \
      libatomic1 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/piper /app/models /app/out \
    && curl -L --fail --retry 3 \
      -o /tmp/piper_linux_x86_64.tar.gz \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}/piper_linux_x86_64.tar.gz" \
    && tar -xzf /tmp/piper_linux_x86_64.tar.gz -C /tmp \
    && cp -R /tmp/piper/. /app/piper/ \
    && chmod +x /app/piper/piper \
    && curl -L --fail --retry 3 \
      -o /app/models/fr_FR-siwis-medium.onnx \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx" \
    && curl -L --fail --retry 3 \
      -o /app/models/fr_FR-siwis-medium.onnx.json \
      "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_VERSION}/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json" \
    && rm -rf /tmp/piper /tmp/piper_linux_x86_64.tar.gz

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5002/health', timeout=5).read()" || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5002"]
