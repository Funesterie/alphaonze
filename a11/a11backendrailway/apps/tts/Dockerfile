FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates libatomic1 libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
RUN chmod +x /app/start.sh /app/piper/piper /app/piper/piper_phonemize

ENV PYTHONUNBUFFERED=1
ENV PORT=8080
ENV MODEL_PATH=/app/fr_FR-siwis-medium.onnx
ENV PIPER_PATH=/app/piper/piper
ENV ESPEAK_DATA_PATH=/app/piper/espeak-ng-data
ENV LD_LIBRARY_PATH=/app/piper
ENV PATH=/app/piper:${PATH}

EXPOSE 8080

CMD ["./start.sh"]
