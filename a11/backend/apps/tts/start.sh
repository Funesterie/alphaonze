#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PORT="${PORT:-8080}"
export MODEL_PATH="${MODEL_PATH:-$SCRIPT_DIR/fr_FR-siwis-medium.onnx}"

if [ -x "$SCRIPT_DIR/piper/piper" ]; then
  export PIPER_PATH="${PIPER_PATH:-$SCRIPT_DIR/piper/piper}"
  export LD_LIBRARY_PATH="$SCRIPT_DIR/piper${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export PATH="$SCRIPT_DIR/piper:$PATH"
fi

if [ -d "$SCRIPT_DIR/piper/espeak-ng-data" ]; then
  export ESPEAK_DATA_PATH="${ESPEAK_DATA_PATH:-$SCRIPT_DIR/piper/espeak-ng-data}"
else
  export ESPEAK_DATA_PATH="${ESPEAK_DATA_PATH:-$SCRIPT_DIR/espeak-ng-data}"
fi

if [ -z "${BASE_URL:-}" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  export BASE_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
fi

mkdir -p "$SCRIPT_DIR/out"

if [ ! -f "$MODEL_PATH" ]; then
  echo "[TTS] Model not found: $MODEL_PATH" >&2
  exit 1
fi

if [ ! -x "${PIPER_PATH:-}" ]; then
  if command -v piper >/dev/null 2>&1; then
    export PIPER_PATH="$(command -v piper)"
  else
    echo "[TTS] Piper binary not found. Expected \$PIPER_PATH or $SCRIPT_DIR/piper/piper" >&2
    exit 1
  fi
fi

echo "[TTS] Starting siwis.py"
echo "[TTS] PORT=$PORT"
echo "[TTS] MODEL_PATH=$MODEL_PATH"
echo "[TTS] PIPER_PATH=$PIPER_PATH"
echo "[TTS] ESPEAK_DATA_PATH=$ESPEAK_DATA_PATH"
echo "[TTS] BASE_URL=${BASE_URL:-auto}"

exec python3 "$SCRIPT_DIR/siwis.py"
