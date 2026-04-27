#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

janus_runtime_ready() {
  local python_bin="$1"
  if [ -z "$python_bin" ] || [ ! -x "$python_bin" ]; then
    return 1
  fi
  "$python_bin" -c "import janus.models" >/dev/null 2>&1
}

if [ -x /opt/janus-venv/bin/python ] && [ -z "${A11_JANUS_PYTHON_PATH:-}" ]; then
  if janus_runtime_ready /opt/janus-venv/bin/python; then
    export A11_JANUS_PYTHON_PATH=/opt/janus-venv/bin/python
  else
    echo "[A11] Bundled Janus runtime unavailable; continuing without local Janus venv"
  fi
fi

if [ -z "${A11_JANUS_DEVICE:-}" ] && [ "${A11_VISION_PROVIDER:-}" = "janus" ]; then
  export A11_JANUS_DEVICE=cpu
fi

if [ -z "${A11_JANUS_MODEL_DIR:-}" ] && [ -z "${A11_JANUS_MODEL_ID:-}" ] && [ "${A11_VISION_PROVIDER:-}" = "janus" ]; then
  if [ "${A11_JANUS_DEVICE:-cpu}" = "cpu" ]; then
    export A11_JANUS_MODEL_ID=deepseek-ai/Janus-Pro-1B
  elif [ -z "${A11_JANUS_PREFER_LATEST:-}" ]; then
    export A11_JANUS_PREFER_LATEST=true
  fi
fi

if [ -n "${A11_JANUS_PYTHON_PATH:-}" ]; then
  echo "[A11] Janus python: ${A11_JANUS_PYTHON_PATH}"
fi
if [ -n "${A11_JANUS_MODEL_DIR:-}" ]; then
  echo "[A11] Janus model dir: ${A11_JANUS_MODEL_DIR}"
elif [ -n "${A11_JANUS_MODEL_ID:-}" ]; then
  echo "[A11] Janus model id: ${A11_JANUS_MODEL_ID}"
fi
if [ -n "${A11_JANUS_DEVICE:-}" ]; then
  echo "[A11] Janus device: ${A11_JANUS_DEVICE}"
fi

echo "[A11] Running DB schema migration..."
node ./init-db.cjs || echo "[A11] WARNING: init-db.cjs failed — continuing anyway"

echo "[A11] Starting backend from $SCRIPT_DIR"
exec node ./server.cjs
