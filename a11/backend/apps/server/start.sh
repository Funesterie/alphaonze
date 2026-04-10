#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -x /opt/janus-venv/bin/python ] && [ -z "${A11_JANUS_PYTHON_PATH:-}" ]; then
  export A11_JANUS_PYTHON_PATH=/opt/janus-venv/bin/python
fi

if [ -z "${A11_JANUS_DEVICE:-}" ] && [ "${A11_VISION_PROVIDER:-}" = "janus" ]; then
  if command -v nvidia-smi >/dev/null 2>&1; then
    export A11_JANUS_DEVICE=cuda
  else
    export A11_JANUS_DEVICE=cpu
  fi
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

echo "[A11] Starting backend from $SCRIPT_DIR"
exec node ./server.cjs
