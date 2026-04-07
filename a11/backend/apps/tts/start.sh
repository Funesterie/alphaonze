#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export PORT="${PORT:-8080}"
export MODEL_PATH="${MODEL_PATH:-$SCRIPT_DIR/fr_FR-siwis-medium.onnx}"

if [ -z "${ONNX_MODEL_URL:-}" ] && [ -n "${MODEL_URL_BASE:-}" ]; then
  model_name="$(basename "$MODEL_PATH")"
  export ONNX_MODEL_URL="${MODEL_URL_BASE%/}/$model_name"
fi

download_model_if_missing() {
  if [ -f "$MODEL_PATH" ]; then
    return 0
  fi

  if [ -z "${ONNX_MODEL_URL:-}" ]; then
    return 1
  fi

  echo "[TTS] Model missing, downloading from ONNX_MODEL_URL"
  python3 - "$MODEL_PATH" "$ONNX_MODEL_URL" <<'PY'
import pathlib
import sys
import urllib.request

target = pathlib.Path(sys.argv[1])
url = sys.argv[2]
target.parent.mkdir(parents=True, exist_ok=True)
request = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Mozilla/5.0 Codex/A11 Railway TTS",
        "Accept": "*/*",
    },
)
with urllib.request.urlopen(request) as response, target.open("wb") as handle:
    handle.write(response.read())
PY
}

resolve_piper_path() {
  local configured="${PIPER_PATH:-}"
  local candidates=(
    "$configured"
    "$SCRIPT_DIR/piper/piper"
    "$SCRIPT_DIR/piper"
    "$SCRIPT_DIR/piper.exe"
  )

  for candidate in "${candidates[@]}"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ] && [ ! -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v piper >/dev/null 2>&1; then
    command -v piper
    return 0
  fi

  return 1
}

if [ -d "$SCRIPT_DIR/piper" ]; then
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

if ! download_model_if_missing && [ ! -f "$MODEL_PATH" ]; then
  echo "[TTS] Model not found: $MODEL_PATH" >&2
  echo "[TTS] Set MODEL_PATH to a bundled model or ONNX_MODEL_URL to download it at startup." >&2
  exit 1
fi

if ! resolved_piper="$(resolve_piper_path)"; then
  echo "[TTS] Piper binary not found. Expected \$PIPER_PATH or $SCRIPT_DIR/piper/piper" >&2
  exit 1
fi
export PIPER_PATH="$resolved_piper"

echo "[TTS] Starting siwis.py"
echo "[TTS] PORT=$PORT"
echo "[TTS] MODEL_PATH=$MODEL_PATH"
echo "[TTS] PIPER_PATH=$PIPER_PATH"
echo "[TTS] ESPEAK_DATA_PATH=$ESPEAK_DATA_PATH"
echo "[TTS] BASE_URL=${BASE_URL:-auto}"

exec python3 "$SCRIPT_DIR/siwis.py"
