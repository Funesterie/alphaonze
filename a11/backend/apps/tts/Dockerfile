FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates libatomic1 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi \
    && pip install --no-cache-dir piper-tts
RUN chmod +x /app/start.sh \
    && if [ -f /app/piper/piper ]; then chmod +x /app/piper/piper; fi \
    && if [ -f /app/piper/piper_phonemize ]; then chmod +x /app/piper/piper_phonemize; fi

ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV MODEL_PATH=/app/fr_FR-siwis-medium.onnx
ENV PIPER_PATH=/usr/local/bin/piper
ENV ESPEAK_DATA_PATH=/app/piper/espeak-ng-data
ENV LD_LIBRARY_PATH=/app/piper
ENV PATH=/app/piper:${PATH}

EXPOSE 8080

CMD ["./start.sh"]
